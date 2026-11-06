import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  RemoteChromiumBrowser,
  resolveRemoteEndpoint,
  inspectLoginPage,
  openRemoteChromiumSession,
} from "../src/remote-chromium-browser.js";
import { loadRemoteChromiumConfig, selectBackend } from "../src/config.js";
import {
  SessionStore,
  startResident,
  residentSearch,
} from "../src/resident-session.js";

const env = {
  REMOTE_CHROMIUM_ENDPOINT: "http://chromium:9222",
  REMOTE_CHROMIUM_DESKTOP_URL: "https://browser.example.test",
  PORTER_USERNAME: "staff",
  PORTER_PASSWORD: "private-password",
};
const config = loadRemoteChromiumConfig(env);

function fixture(states = []) {
  const calls = [];
  const connection = new EventEmitter();
  let connected = true;
  connection.isConnected = () => connected;
  connection.newBrowserCDPSession = async () => ({
    send: async (command) => {
      calls.push(command);
      connected = false;
      connection.emit("disconnected");
    },
  });
  connection.close = async () => {
    connected = false;
    calls.push("disconnect");
  };
  const page = {
    isClosed: () => false,
    close: async () => calls.push("close-tab"),
    bringToFront: async () => calls.push("foreground"),
    goto: async (url) => calls.push(["goto", url]),
    locator: (selector) => ({
      fill: async () => calls.push(["fill", selector]),
      click: async () => calls.push(["click", selector]),
    }),
  };
  const report = { capture: async (step) => calls.push(["capture", step]) };
  let output = "";
  const browser = new RemoteChromiumBrowser(
    config,
    connection,
    {},
    page,
    report,
    {
      write: (s) => {
        output += s;
      },
    },
  );
  browser.state = async () => states.shift() || {};
  browser.waitState = async (_deadline, predicate) => {
    const state = states.shift();
    if (state?.rejected)
      throw new Error("Porter rejected the login credentials");
    return state && predicate(state) ? state : null;
  };
  return { browser, page, connection, calls, output: () => output };
}

test("remote config requires private CDP/desktop URLs and paired optional credentials", () => {
  assert.equal(selectBackend("remote-chromium"), "remote-chromium");
  assert.throws(
    () => selectBackend("browserless-cdp"),
    /replaced.*REMOTE_CHROMIUM_ENDPOINT/,
  );
  assert.equal(selectBackend(), "bap");
  assert.equal(config.debug, false);
  assert.equal(config.authTimeout, 600000);
  const manual = loadRemoteChromiumConfig({
    ...env,
    PORTER_USERNAME: "",
    PORTER_PASSWORD: "",
  });
  assert.equal(manual.username, undefined);
  assert.equal(manual.stateDir, config.stateDir);
  const aliases = loadRemoteChromiumConfig({
    ...env,
    PORTER_USERNAME: "",
    PORTER_PASSWORD: "",
    FLYPORTER_USERNAME: "staff",
    FLYPORTER_PASSWORD: "private-password",
  });
  assert.equal(aliases.username, "staff");
  assert.equal(aliases.stateDir, config.stateDir);
  assert.notEqual(
    loadRemoteChromiumConfig({
      ...env,
      REMOTE_CHROMIUM_ENDPOINT: "http://other:9222",
    }).stateDir,
    config.stateDir,
  );
  for (const patch of [
    { PORTER_PASSWORD: "" },
    { PORTER_USERNAME: "" },
    { REMOTE_CHROMIUM_ENDPOINT: "" },
    { REMOTE_CHROMIUM_ENDPOINT: "ftp://chromium" },
    { REMOTE_CHROMIUM_ENDPOINT: "http://chromium?token=secret" },
    { REMOTE_CHROMIUM_ENDPOINT: "ws://chromium/devtools/page/other" },
    { REMOTE_CHROMIUM_ENDPOINT: "http://chromium/devtools/browser/id" },
    { REMOTE_CHROMIUM_ENDPOINT: "http://user:pass@chromium" },
    { REMOTE_CHROMIUM_DESKTOP_URL: "" },
    { REMOTE_CHROMIUM_DESKTOP_URL: "https://user:pass@chromium" },
    { REMOTE_CHROMIUM_DESKTOP_URL: "javascript:alert(1)" },
    { FLYPORTER_DEBUG: "maybe" },
  ])
    assert.throws(() => loadRemoteChromiumConfig({ ...env, ...patch }));
  const direct = loadRemoteChromiumConfig({
    ...env,
    REMOTE_CHROMIUM_ENDPOINT: "ws://127.0.0.1:9222/devtools/browser/ABC-123",
  });
  assert.match(direct.endpoint, /browser\/ABC-123$/);
});

test("discovery rewrites internal browser sockets through the configured private endpoint", async () => {
  for (const endpoint of [
    "http://chromium:9222/",
    "https://private.example/cdp/",
  ]) {
    const base = new URL(endpoint);
    const socket = await resolveRemoteEndpoint(
      { ...config, endpoint },
      async (url, options) => {
        assert.equal(url.href, endpoint + "json/version");
        assert.equal(options.redirect, "error");
        assert.equal(
          options.headers.Host,
          base.protocol === "http:" ? "localhost" : undefined,
        );
        return {
          ok: true,
          json: async () => ({
            webSocketDebuggerUrl:
              "ws://localhost:9223/devtools/browser/ABC-123",
          }),
        };
      },
    );
    assert.equal(
      socket,
      `${base.protocol === "https:" ? "wss:" : "ws:"}//${base.host}${base.pathname.replace(/\/$/, "")}/devtools/browser/ABC-123`,
    );
  }
  const direct = "ws://127.0.0.1:9222/devtools/browser/ABC-123";
  assert.equal(
    await resolveRemoteEndpoint({ ...config, endpoint: direct }, () =>
      assert.fail(),
    ),
    direct,
  );
  for (const value of [
    "ws://local/devtools/page/id",
    "https://local/devtools/browser/id",
    "ws://local/devtools/browser/id?token=bad",
    "invalid",
  ]) {
    await assert.rejects(
      resolveRemoteEndpoint(config, async () => ({
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: value }),
      })),
    );
  }
  await assert.rejects(
    resolveRemoteEndpoint(config, async () => ({ ok: false, status: 403 })),
    /403/,
  );
});

test("opening uses the existing default context and closes only its own tab", async () => {
  const f = fixture();
  const context = { newPage: async () => f.page };
  f.page.setDefaultTimeout = () => {};
  f.connection.contexts = () => [context];
  f.connection.newContext = () =>
    assert.fail("must not create isolated context");
  const browser = await RemoteChromiumBrowser.open(
    config,
    {},
    {},
    {
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          webSocketDebuggerUrl: "ws://localhost:9223/devtools/browser/ABC-123",
        }),
      }),
      chromiumImpl: {
        connectOverCDP: async (url, options) => {
          assert.equal(options.headers.Host, "localhost");
          assert.equal(url, "ws://chromium:9222/devtools/browser/ABC-123");
          return f.connection;
        },
      },
    },
  );
  assert.equal(browser.context, context);
  await browser.close();
  await browser.close();
  assert.deepEqual(f.calls, ["close-tab", "disconnect"]);
});

test("page inspection requires Porter origin, controls and cleared challenges", () => {
  const dom = new JSDOM(
    '<body><div id="booking-widget"></div><input id="departureCity"></body>',
    {
      url: "https://www.flyporter.com/en-ca/staff/searchflight",
      runScripts: "outside-only",
    },
  );
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    height: 30,
  });
  const inspect = () => dom.window.eval(`(${inspectLoginPage.toString()})()`);
  try {
    assert.equal(inspect().ready, true);
    dom.window.document.title = "Verify you are human";
    assert.equal(inspect().ready, false);
    assert.equal(inspect().challenge, true);
    dom.window.document.title = "";
    const code = dom.window.document.createElement("input");
    code.autocomplete = "one-time-code";
    dom.window.document.body.append(code);
    assert.equal(inspect().mfa, true);
    assert.equal(inspect().ready, false);
    code.remove();
    dom.reconfigure({ url: "https://evil.example/en-ca/staff/searchflight" });
    assert.equal(inspect().ready, false);
    dom.reconfigure({ url: "https://www.flyporter.com/en-ca/login" });
    dom.window.document.body.innerText = "Invalid username or password";
    assert.equal(inspect().rejected, true);
  } finally {
    dom.window.close();
  }
});

test("automatic login submits once, verifies controls, and does not print a viewer link", async () => {
  const f = fixture([{ login: true }, { signedIn: true }, { ready: true }]);
  await f.browser.authenticate();
  assert.equal(f.calls.filter((c) => c[0] === "click").length, 1);
  assert.ok(!f.calls.includes("foreground"));
  assert.equal(f.output(), "");
});

test("existing staff access skips credentials and viewer", async () => {
  const f = fixture([{ ready: true }]);
  await f.browser.authenticate();
  assert.equal(f.calls.length, 1);
});

test("missing credentials and pre-login challenges hand off without submitting", async () => {
  for (const manual of [true, false]) {
    const f = fixture([
      { challenge: true },
      { signedIn: true },
      { ready: true },
    ]);
    if (manual)
      f.browser.config = {
        ...config,
        username: undefined,
        password: undefined,
      };
    await f.browser.authenticate();
    assert.ok(f.calls.includes("foreground"));
    assert.equal(
      f.calls.filter((c) => c[0] === "click" || c[0] === "fill").length,
      0,
    );
    assert.match(f.output(), /Chromium desktop/);
    assert.ok(!f.output().includes(config.password));
  }
});

test("post-submit CAPTCHA or MFA login hands off without resubmission", async () => {
  for (const pending of [{ challenge: true }, { mfa: true }]) {
    const f = fixture([
      { login: true },
      pending,
      { signedIn: true },
      { ready: true },
    ]);
    await f.browser.authenticate();
    assert.equal(f.calls.filter((c) => c[0] === "click").length, 1);
    assert.equal(f.calls.filter((c) => c === "foreground").length, 1);
  }
});

test("rejected credentials and missing staff controls never succeed or retry", async () => {
  const f = fixture([{ login: true }, { rejected: true }]);
  await assert.rejects(f.browser.authenticate(), /rejected/);
  assert.equal(f.calls.filter((c) => c[0] === "click").length, 1);
  assert.ok(!f.calls.includes("foreground"));
  const g = fixture([{ signedIn: true }, {}]);
  await assert.rejects(g.browser.authenticate(), /controls/);
});

test("interactive timeout is bounded, and cleanup disconnects without terminating Chromium", async () => {
  const f = fixture();
  await assert.rejects(f.browser.handoff(Date.now() + 1000), /timeout/);
  assert.equal(
    await RemoteChromiumBrowser.prototype.waitState.call(
      f.browser,
      Date.now() - 1,
      () => true,
    ),
    null,
  );
  await f.browser.close();
  await f.browser.close();
  assert.equal(f.calls.filter((c) => c === "Browser.close").length, 0);
  assert.equal(f.calls.filter((c) => c === "disconnect").length, 1);
});

test("partial CDP initialization disconnects without terminating remote browser, and session failures release locks", async () => {
  const f = fixture();
  f.connection.contexts = () => [
    {
      newPage: async () => {
        throw new Error("page failed");
      },
    },
  ];
  await assert.rejects(
    RemoteChromiumBrowser.open(
      config,
      {},
      {},
      {
        chromiumImpl: { connectOverCDP: async () => f.connection },
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            webSocketDebuggerUrl: "ws://localhost:9223/devtools/browser/id",
          }),
        }),
      },
    ),
    /Could not attach/,
  );
  assert.deepEqual(f.calls, ["disconnect"]);
  const root = await mkdtemp(path.join(tmpdir(), "porter-cdp-state-"));
  const store = new SessionStore(root);
  try {
    await assert.rejects(
      openRemoteChromiumSession(
        { ...config, stateDir: root },
        {},
        {
          store,
          open: async () => {
            throw new Error("open failed");
          },
        },
      ),
      /open failed/,
    );
    assert.deepEqual(await readdir(root), []);
    const handle = await openRemoteChromiumSession(
      { ...config, stateDir: root },
      {},
      {
        store,
        open: async () => ({
          close: async () => {
            throw new Error("close failed");
          },
        }),
      },
    );
    await assert.rejects(handle.finish(), /close failed/);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real auth polling rejects errors, bounds waits and notices transport loss", async () => {
  const f = fixture([{ rejected: true }]);
  await assert.rejects(
    RemoteChromiumBrowser.prototype.waitState.call(
      f.browser,
      Date.now() + 1000,
      () => true,
    ),
    { code: "AUTHENTICATION_FAILED" },
  );
  const g = fixture([{ temporaryError: true }]);
  await assert.rejects(
    RemoteChromiumBrowser.prototype.waitState.call(
      g.browser,
      Date.now() + 1000,
      () => true,
    ),
    { code: "REMOTE_RESPONSE_ERROR" },
  );
  const h = fixture();
  await h.browser.close();
  await assert.rejects(
    RemoteChromiumBrowser.prototype.state.call(h.browser),
    /disconnected/,
  );
  const pending = fixture();
  const polling = RemoteChromiumBrowser.prototype.waitState.call(
    pending.browser,
    Date.now() + 10000,
    () => false,
  );
  pending.browser.abort.abort();
  await assert.rejects(polling, { name: "AbortError" });
});

test("CDP search accepts explicit empty availability and rejects malformed journey collections", async () => {
  for (const payload of [
    { searchResults: [] },
    { searchResults: [{}] },
    "bad-json",
  ]) {
    const f = fixture([{}]);
    f.page.goto = async () => null;
    f.page.url = () => "https://www.flyporter.com/en-ca/staff/searchflight";
    f.page.content = async () => "";
    f.page.waitForFunction = async () => {};
    f.page.evaluate = async () => {};
    f.page.waitForResponse = async () => ({
      url: () =>
        "https://www.flyporter.com/en-ca/flight/GetFlightAvailabilityStaffTravel",
      status: () => 200,
      allHeaders: async () => ({}),
      text: async () =>
        typeof payload === "string" ? payload : JSON.stringify(payload),
    });
    const action = f.browser.searchStaffAvailability({
      origin: "YTZ",
      destination: "YUL",
      date: "2099-12-01",
    });
    if (payload.searchResults?.length === 0)
      assert.deepEqual((await (await action).json()).searchResults, []);
    else await assert.rejects(action, { code: "REMOTE_RESPONSE_ERROR" });
  }
});

test("CDP resident pauses searches for authentication, serializes heartbeats and handles disconnection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "porter-cdp-ipc-"));
  const settings = { ...config, stateDir: root };
  const store = new SessionStore(root);
  await store.init();
  let releaseLogin;
  const login = new Promise((resolve) => {
    releaseLogin = resolve;
  });
  let startedLogin;
  const loginStarted = new Promise((resolve) => {
    startedLogin = resolve;
  });
  const f = fixture();
  let beats = 0,
    searches = 0;
  f.browser.keepAlive = async () => ({
    status: 200,
    url:
      ++beats === 1
        ? "https://www.flyporter.com/en-ca/login"
        : "https://www.flyporter.com/en-ca/staff",
  });
  f.browser.reauthenticate = async (options) => {
    assert.equal(options.timeoutMs, config.authTimeout);
    startedLogin();
    await login;
  };
  f.browser.searchStaffAvailability = async () => {
    searches++;
    return {
      ok: true,
      url: "https://www.flyporter.com/en-ca/flight/GetFlightAvailabilityStaffTravel",
      json: async () => ({ searchResults: [] }),
    };
  };
  let fatal;
  const service = await startResident(
    { browser: f.browser, store, report: { capture: async () => {} } },
    settings,
    new AbortController().signal,
    (error) => {
      fatal = error;
    },
  );
  try {
    const request = residentSearch(settings, {
      origin: "YTZ",
      destination: "YUL",
      date: "2099-12-01",
    });
    await loginStarted;
    const heartbeat = service.heartbeat(config.authTimeout);
    assert.equal(beats, 1);
    assert.equal(searches, 0);
    releaseLogin();
    assert.deepEqual((await request).flights, []);
    await heartbeat;
    assert.equal(searches, 1);
    assert.equal(beats, 2);
    const descriptor = JSON.stringify(await store.read("resident.json"));
    assert.ok(!descriptor.includes(config.endpoint));
    assert.ok(!descriptor.includes(config.password));
    f.connection.emit("disconnected");
    assert.equal(fatal.code, "REMOTE_RESPONSE_ERROR");
  } finally {
    releaseLogin();
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(f.connection.listenerCount("disconnected"), 0);
});

test("unconfirmed automatic login fails without desktop handoff or resubmission", async () => {
  const f = fixture([{ login: true }, {}]);
  await assert.rejects(
    f.browser.authenticate(),
    /Automatic login was not confirmed/,
  );
  assert.equal(f.calls.filter((c) => c[0] === "click").length, 1);
  assert.equal(f.output(), "");
});

test("no default context and failures after tab creation disconnect safely", async () => {
  for (const missing of [true, false]) {
    const f = fixture();
    f.connection.contexts = () =>
      missing ? [] : [{ newPage: async () => f.page }];
    f.page.setDefaultTimeout = () => {
      throw new Error("initialization failed");
    };
    await assert.rejects(
      RemoteChromiumBrowser.open(
        { ...config, endpoint: "ws://localhost:9222/devtools/browser/id" },
        {},
        {},
        {
          chromiumImpl: { connectOverCDP: async () => f.connection },
        },
      ),
      /Could not attach/,
    );
    assert.deepEqual(
      f.calls,
      missing ? ["disconnect"] : ["close-tab", "disconnect"],
    );
  }
});

test("tab-close failure still disconnects; already-closed tabs are left alone", async () => {
  const f = fixture();
  f.page.close = async () => {
    throw new Error("tab close failed");
  };
  await assert.rejects(f.browser.close(), /tab close failed/);
  assert.deepEqual(f.calls, ["disconnect"]);
  const g = fixture();
  g.page.isClosed = () => true;
  await g.browser.close();
  assert.deepEqual(g.calls, ["disconnect"]);
});

test("cleanup leaves the last headed tab blank instead of exiting Chromium", async () => {
  const f = fixture();
  f.browser.context = { pages: () => [f.page] };
  await f.browser.close();
  assert.deepEqual(f.calls, [["goto", "about:blank"], "disconnect"]);
});

test("authentication enters through staff before search, without probing an expired booking page", async () => {
  const f = fixture([{ signedIn: true }, { ready: true }]);
  await f.browser.authenticate();
  assert.deepEqual(
    f.calls.filter((c) => c[0] === "goto"),
    [
      ["goto", "https://www.flyporter.com/en-ca/staff"],
      ["goto", "https://www.flyporter.com/en-ca/staff/searchflight"],
    ],
  );
  assert.equal(f.calls.filter((c) => c[0] === "click").length, 0);
});

test("staff pathname alone is not authentication while the landing page loads", () => {
  const dom = new JSDOM("<body><div>Loading</div></body>", {
    url: "https://www.flyporter.com/en-ca/staff",
    runScripts: "outside-only",
  });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    height: 30,
  });
  const inspect = () => dom.window.eval(`(${inspectLoginPage.toString()})()`);
  try {
    assert.equal(inspect().signedIn, false);
    dom.window.document.body.innerHTML =
      '<a href="/en-ca/staff/searchflight">Book a Flight</a>';
    assert.equal(inspect().signedIn, true);
    assert.equal(inspect().ready, false);
    dom.window.document.body.innerHTML += '<input type="password">';
    assert.equal(inspect().signedIn, false);
  } finally {
    dom.window.close();
  }
});

test("genuine staff-entry server errors fail before any login submission or search navigation", async () => {
  const f = fixture([{ temporaryError: true }]);
  f.browser.waitState = RemoteChromiumBrowser.prototype.waitState.bind(
    f.browser,
  );
  await assert.rejects(f.browser.authenticate(), /temporary server-error/);
  assert.deepEqual(f.calls, [
    ["goto", "https://www.flyporter.com/en-ca/staff"],
  ]);
});

async function withDiscoveryServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("real HTTP discovery sends localhost on the wire and rewrites the internal browser address", async () => {
  let requests = 0;
  await withDiscoveryServer(
    (request, response) => {
      requests++;
      assert.equal(request.url, "/private/json/version");
      assert.equal(request.headers.host, "localhost");
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          webSocketDebuggerUrl: "ws://localhost:9223/devtools/browser/ABC-123",
        }),
      );
    },
    async (base) => {
      assert.equal(
        await resolveRemoteEndpoint({
          ...config,
          endpoint: `${base}/private/`,
        }),
        `${base.replace("http:", "ws:")}/private/devtools/browser/ABC-123`,
      );
    },
  );
  assert.equal(requests, 1);
});

test("HTTP discovery does not follow redirects and rejects server errors", async () => {
  for (const status of [302, 500]) {
    let requests = 0;
    await withDiscoveryServer(
      (_request, response) => {
        requests++;
        response.writeHead(status, { Location: "/another-target" });
        response.end("not a browser target");
      },
      async (endpoint) => {
        await assert.rejects(
          resolveRemoteEndpoint({ ...config, endpoint }),
          new RegExp(`HTTP ${status}`),
        );
      },
    );
    assert.equal(requests, 1);
  }
});

test("HTTP discovery bounds oversized responses and aborts stalled requests", async () => {
  await withDiscoveryServer(
    (_request, response) => {
      response.end(Buffer.alloc(64 * 1024 + 1, "x"));
    },
    async (endpoint) => {
      await assert.rejects(
        resolveRemoteEndpoint({ ...config, endpoint }),
        /exceeded 64 KiB/,
      );
    },
  );
  await withDiscoveryServer(
    () => {},
    async (endpoint) => {
      await assert.rejects(
        resolveRemoteEndpoint({ ...config, endpoint, timeout: 50 }),
        { code: "ABORT_ERR" },
      );
    },
  );
});

test("direct private WebSockets override Host while TLS WebSockets retain proxy routing", async () => {
  for (const protocol of ["ws:", "wss:"]) {
    const f = fixture();
    f.page.setDefaultTimeout = () => {};
    f.connection.contexts = () => [{ newPage: async () => f.page }];
    const endpoint = `${protocol}//chromium:9222/devtools/browser/ABC-123`;
    const browser = await RemoteChromiumBrowser.open(
      { ...config, endpoint },
      {},
      {},
      {
        chromiumImpl: {
          connectOverCDP: async (url, options) => {
            assert.equal(url, endpoint);
            assert.deepEqual(
              options.headers,
              protocol === "ws:" ? { Host: "localhost" } : undefined,
            );
            return f.connection;
          },
        },
        fetchImpl: () =>
          assert.fail("Direct WebSockets do not use HTTP discovery"),
      },
    );
    await browser.close();
  }
});
