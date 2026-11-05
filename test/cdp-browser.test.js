import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  CdpBrowser,
  buildViewerUrl,
  buildChromeViewerUrl,
  inspectLoginPage,
  openCdpSession,
} from "../src/cdp-browser.js";
import { loadCdpConfig, selectBackend } from "../src/config.js";
import {
  SessionStore,
  startResident,
  residentSearch,
} from "../src/resident-session.js";

const env = {
  BROWSERLESS_CDP_ENDPOINT: "ws://browserless:3000/chromium",
  BROWSERLESS_CDP_PUBLIC_URL: "https://browser.example.test",
  BROWSERLESS_CDP_TOKEN: "token#&?x",
  PORTER_USERNAME: "staff",
  PORTER_PASSWORD: "private-password",
};
const config = loadCdpConfig(env);
const row = {
  type: "page",
  id: "ABC-123",
  devtoolsFrontendUrl: "/devtools/inspector.html?ws=old",
  webSocketDebuggerUrl: "wss://browser.example.test/devtools/page/ABC-123",
};

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
    goto: async (url) => calls.push(["goto", url]),
    locator: (selector) => ({
      fill: async () => calls.push(["fill", selector]),
      click: async () => calls.push(["click", selector]),
    }),
  };
  const report = { capture: async (step) => calls.push(["capture", step]) };
  let output = "";
  const browser = new CdpBrowser(config, connection, {}, page, report, {
    write: (s) => {
      output += s;
    },
  });
  browser.state = async () => states.shift() || {};
  browser.waitState = async (_deadline, predicate) => {
    const state = states.shift();
    if (state?.rejected)
      throw new Error("Porter rejected the login credentials");
    return state && predicate(state) ? state : null;
  };
  browser.loginLink = async () => {
    calls.push("link");
    return "https://browser.example.test/sensitive";
  };
  return { browser, page, connection, calls, output: () => output };
}

test("CDP config is isolated, supports aliases/manual login, and validates URLs/credentials", () => {
  assert.equal(selectBackend("browserless-cdp"), "browserless-cdp");
  assert.equal(config.debug, false);
  assert.equal(config.authTimeout, 600000);
  assert.equal(config.headless, false);
  assert.equal(config.viewer, "web");
  const manual = loadCdpConfig({
    ...env,
    PORTER_USERNAME: "",
    PORTER_PASSWORD: "",
  });
  assert.equal(manual.username, undefined);
  assert.notEqual(manual.stateDir, config.stateDir);
  const aliases = loadCdpConfig({
    ...env,
    PORTER_USERNAME: "",
    PORTER_PASSWORD: "",
    FLYPORTER_USERNAME: "staff",
    FLYPORTER_PASSWORD: "private-password",
  });
  assert.equal(aliases.stateDir, config.stateDir);
  assert.equal(
    loadCdpConfig({
      ...env,
      BROWSERLESS_CDP_TOKEN: "",
      BROWSERLESS_TOKEN: "fallback",
    }).token,
    "fallback",
  );
  for (const patch of [
    { PORTER_PASSWORD: "" },
    { PORTER_USERNAME: "" },
    { BROWSERLESS_CDP_ENDPOINT: "https://browserless/chromium" },
    { BROWSERLESS_CDP_ENDPOINT: "ws://browserless?token=secret" },
    {
      BROWSERLESS_CDP_ENDPOINT:
        "ws://browserless/devtools/browser/other-session",
    },
    { BROWSERLESS_CDP_PUBLIC_URL: "https://user:pass@browserless" },
    { BROWSERLESS_CDP_TOKEN: "" },
    { FLYPORTER_DEBUG: "maybe" },
    { BROWSERLESS_CDP_HEADLESS: "maybe" },
    { BROWSERLESS_CDP_VIEWER: "chrome" },
    { BROWSERLESS_CDP_VIEWER: "unknown" },
  ])
    assert.throws(() => loadCdpConfig({ ...env, ...patch }));
});

test("headed/headless sessions are isolated and viewer defaults follow the public address", () => {
  const headless = loadCdpConfig({ ...env, BROWSERLESS_CDP_HEADLESS: "true" });
  assert.equal(headless.headless, true);
  assert.notEqual(headless.stateDir, config.stateDir);
  for (const hostname of ["localhost", "127.0.0.1"]) {
    const local = loadCdpConfig({
      ...env,
      BROWSERLESS_CDP_PUBLIC_URL: `http://${hostname}:3000`,
    });
    assert.equal(local.viewer, "chrome");
    assert.equal(
      loadCdpConfig({
        ...env,
        BROWSERLESS_CDP_PUBLIC_URL: `http://${hostname}:3000`,
        BROWSERLESS_CDP_VIEWER: "web",
      }).viewer,
      "web",
    );
  }
});

test("native viewer uses the CSP-permitted loopback host and keeps authentication inside ws", () => {
  const web = new URL("http://localhost:3000/devtools/inspector.html");
  const ws = new URL("ws://localhost:3000/devtools/page/ABC-123");
  ws.searchParams.set("token", config.token);
  web.searchParams.set("ws", ws.href.replace(/^ws:\/\//, ""));
  web.searchParams.set("token", config.token);
  const native = new URL(buildChromeViewerUrl(web.href));
  assert.equal(native.protocol, "devtools:");
  assert.deepEqual([...native.searchParams.keys()], ["ws"]);
  const nested = new URL(`ws://${native.searchParams.get("ws")}`);
  assert.equal(nested.hostname, "127.0.0.1");
  assert.equal(nested.searchParams.get("token"), config.token);
  assert.equal(nested.pathname, "/devtools/page/ABC-123");
  assert.throws(() =>
    buildChromeViewerUrl(
      "https://browser.example.test/devtools/inspector.html",
    ),
  );
  const unsafe = new URL(web);
  unsafe.searchParams.set("ws", "other.example/devtools/page/ABC-123");
  assert.throws(() => buildChromeViewerUrl(unsafe.href));
});

test("CDP opening sends actual supported launch options and the token separately", async () => {
  for (const headless of [false, true]) {
    const f = fixture();
    let endpoint;
    const page = {
      setDefaultTimeout: () => {},
      setViewportSize: async () => {},
    };
    f.connection.contexts = () => [{ newPage: async () => page }];
    const browser = await CdpBrowser.open(
      { ...config, headless },
      {},
      {},
      {
        chromiumImpl: {
          connectOverCDP: async (url) => {
            endpoint = new URL(url);
            return f.connection;
          },
        },
      },
    );
    assert.deepEqual(JSON.parse(endpoint.searchParams.get("launch")), {
      headless,
    });
    assert.equal(endpoint.searchParams.get("token"), config.token);
    await browser.close();
  }
});

test("viewer links encode both authentications and map to the exact public target", () => {
  const url = new URL(buildViewerUrl(config, row, "ABC-123"));
  assert.equal(url.origin, "https://browser.example.test");
  assert.equal(url.searchParams.get("token"), config.token);
  const ws = new URL(`wss://${url.searchParams.get("wss")}`);
  assert.equal(ws.pathname, "/devtools/page/ABC-123");
  assert.equal(ws.searchParams.get("token"), config.token);
  const prefixed = new URL(
    buildViewerUrl(
      { ...config, publicUrl: "https://browser.example.test/tools/" },
      row,
      "ABC-123",
    ),
  );
  assert.equal(prefixed.pathname, "/tools/devtools/inspector.html");
  for (const patch of [
    { devtoolsFrontendUrl: "https://evil.example/devtools/inspector.html" },
    { webSocketDebuggerUrl: "wss://evil.example/devtools/page/ABC-123" },
    { webSocketDebuggerUrl: "wss://browser.example.test/devtools/page/OTHER" },
    { devtoolsFrontendUrl: "/unrelated" },
  ])
    assert.throws(() =>
      buildViewerUrl(config, { ...row, ...patch }, "ABC-123"),
    );
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
  assert.ok(!f.calls.includes("link"));
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
    assert.ok(f.calls.includes("link"));
    assert.equal(
      f.calls.filter((c) => c[0] === "click" || c[0] === "fill").length,
      0,
    );
    assert.match(f.output(), /LIVE LOGIN LINK/);
    assert.ok(!f.output().includes(config.password));
  }
});

test("post-submit CAPTCHA or unconfirmed/MFA login hands off without resubmission", async () => {
  for (const pending of [{ challenge: true }, {}]) {
    const f = fixture([
      { login: true },
      pending,
      { signedIn: true },
      { ready: true },
    ]);
    await f.browser.authenticate();
    assert.equal(f.calls.filter((c) => c[0] === "click").length, 1);
    assert.equal(f.calls.filter((c) => c === "link").length, 1);
  }
});

test("rejected credentials and missing staff controls never succeed or retry", async () => {
  const f = fixture([{ login: true }, { rejected: true }]);
  await assert.rejects(f.browser.authenticate(), /rejected/);
  assert.equal(f.calls.filter((c) => c[0] === "click").length, 1);
  assert.ok(!f.calls.includes("link"));
  const g = fixture([{ signedIn: true }, {}]);
  await assert.rejects(g.browser.authenticate(), /controls/);
});

test("interactive timeout is bounded, and browser close terminates remote browser exactly once", async () => {
  const f = fixture();
  await assert.rejects(f.browser.handoff(Date.now() + 1000), /timeout/);
  assert.equal(
    await CdpBrowser.prototype.waitState.call(
      f.browser,
      Date.now() - 1,
      () => true,
    ),
    null,
  );
  await f.browser.close();
  await f.browser.close();
  assert.equal(f.calls.filter((c) => c === "Browser.close").length, 1);
  assert.equal(f.calls.filter((c) => c === "disconnect").length, 1);
});

test("login discovery selects only the owned target and rejects missing/duplicate pages", async () => {
  for (const rows of [[row], [], [row, row], [{ ...row, id: "OTHER" }]]) {
    const f = fixture();
    f.browser.context = {
      newCDPSession: async () => ({
        send: async () => ({ targetInfo: { targetId: "ABC-123" } }),
        detach: async () => {},
      }),
    };
    const requests = [];
    f.browser.fetchImpl = async (url) => {
      requests.push(String(url));
      return { ok: true, json: async () => rows };
    };
    if (rows.length === 1 && rows[0].id === "ABC-123") {
      const link = await CdpBrowser.prototype.loginLink.call(f.browser);
      assert.match(link, /devtools\/inspector/);
      assert.equal(new URL(requests[0]).pathname, "/sessions");
      assert.equal(requests.length, 2);
    } else
      await assert.rejects(
        CdpBrowser.prototype.loginLink.call(f.browser),
        /debugger/,
      );
    assert.equal(f.output(), "");
  }
});

test("partial CDP initialization closes remote browser, and session failures release locks", async () => {
  const f = fixture();
  f.connection.contexts = () => [
    {
      newPage: async () => {
        throw new Error("page failed");
      },
    },
  ];
  await assert.rejects(
    CdpBrowser.open(
      config,
      {},
      {},
      { chromiumImpl: { connectOverCDP: async () => f.connection } },
    ),
    /Could not open/,
  );
  assert.ok(f.calls.includes("Browser.close"));
  const root = await mkdtemp(path.join(tmpdir(), "porter-cdp-state-"));
  const store = new SessionStore(root);
  try {
    await assert.rejects(
      openCdpSession(
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
    const handle = await openCdpSession(
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
    CdpBrowser.prototype.waitState.call(
      f.browser,
      Date.now() + 1000,
      () => true,
    ),
    { code: "AUTHENTICATION_FAILED" },
  );
  const g = fixture([{ temporaryError: true }]);
  await assert.rejects(
    CdpBrowser.prototype.waitState.call(
      g.browser,
      Date.now() + 1000,
      () => true,
    ),
    { code: "REMOTE_RESPONSE_ERROR" },
  );
  const h = fixture();
  await h.browser.close();
  await assert.rejects(
    CdpBrowser.prototype.state.call(h.browser),
    /disconnected/,
  );
  const pending = fixture();
  const polling = CdpBrowser.prototype.waitState.call(
    pending.browser,
    Date.now() + 10000,
    () => false,
  );
  pending.browser.abort.abort();
  await assert.rejects(polling, { name: "AbortError" });
});

test("missing session API or viewer resource fails handoff without printing secrets", async () => {
  for (const failViewer of [false, true]) {
    const f = fixture();
    f.browser.context = {
      newCDPSession: async () => ({
        send: async () => ({ targetInfo: { targetId: "ABC-123" } }),
        detach: async () => {},
      }),
    };
    let requests = 0;
    f.browser.fetchImpl = async () => ({
      ok: failViewer && ++requests === 1,
      json: async () => [row],
    });
    await assert.rejects(CdpBrowser.prototype.loginLink.call(f.browser), {
      code: "AUTHENTICATION_FAILED",
    });
    assert.equal(f.output(), "");
  }
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
    assert.ok(!descriptor.includes(config.token));
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
