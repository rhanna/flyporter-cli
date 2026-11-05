import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createProgram } from "../src/cli.js";
// The CLI imports dotenv. Keep default-backend tests independent of the developer's .env.
const inheritedBackend = process.env.FLYPORTER_BROWSER;
delete process.env.FLYPORTER_BROWSER;
after(() => {
  if (inheritedBackend === undefined) delete process.env.FLYPORTER_BROWSER;
  else process.env.FLYPORTER_BROWSER = inheritedBackend;
});
function fixture(overrides = {}) {
  let out = "",
    err = "";
  const calls = [];
  const config = { token: "token", username: "user", password: "password" };
  const browser = { config };
  const deps = {
    loadBapConfig: () => config,
    loadCdpConfig: () => config,
    residentSearch: async () => null,
    openBrowser: async (backend, purpose) => {
      calls.push([backend, purpose]);
      return {
        browser,
        finish: async (success) => calls.push(["finish", success]),
      };
    },
    authenticateBrowser: async () => calls.push(["auth"]),
    searchPorter: async () => ({
      query: { origin: "YTZ", destination: "YUL", date: "2026-11-05" },
      flights: [],
    }),
    ...overrides,
  };
  const io = {
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  };
  return {
    program: createProgram(io, deps),
    calls,
    output: () => out,
    error: () => err,
  };
}
test("default BAP search preserves pure JSON stdout and closes successfully", async () => {
  const f = fixture();
  await f.program.parseAsync([
    "node",
    "flyporter",
    "search",
    "porter",
    "YTZ",
    "YUL",
    "2026-11-05",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(f.output()).flights, []);
  assert.deepEqual(f.calls, [["bap", "search"], ["auth"], ["finish", true]]);
});

test("CDP search requires a resident and never opens an unauthenticated browser", async () => {
  const f = fixture();
  await assert.rejects(
    f.program.parseAsync([
      "node",
      "flyporter",
      "--browser",
      "browserless-cdp",
      "search",
      "porter",
      "YTZ",
      "YUL",
      "2026-11-05",
    ]),
    /resident session/,
  );
  assert.deepEqual(f.calls, []);
  const g = fixture({ residentSearch: async () => ({ flights: [] }) });
  await g.program.parseAsync([
    "node",
    "flyporter",
    "--browser",
    "browserless-cdp",
    "search",
    "porter",
    "YTZ",
    "YUL",
    "2026-11-05",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(g.output()).flights, []);
  assert.deepEqual(g.calls, []);
});

test("CDP auth starts resident maintenance after login and rejects unsafe intervals", async () => {
  const f = fixture();
  await assert.rejects(
    f.program.parseAsync([
      "node",
      "flyporter",
      "--browser",
      "browserless-cdp",
      "auth",
      "--interval",
      "120",
    ]),
    /< 120/,
  );
  assert.deepEqual(f.calls, []);
  const g = fixture({
    startResident: async () => {
      throw new Error("resident-started");
    },
  });
  // Reaching startResident after auth proves auth is resident for CDP (BAP auth is one-shot).
  await assert.rejects(
    g.program.parseAsync([
      "node",
      "flyporter",
      "--browser",
      "browserless-cdp",
      "auth",
    ]),
    /resident-started/,
  );
  assert.deepEqual(g.calls.slice(0, 2), [
    ["browserless-cdp", "auth"],
    ["auth"],
  ]);
});

test("CDP duration expiry interrupts pending authentication and closes without starting a resident", async () => {
  let rejectLogin,
    closed = false,
    finished = false;
  const pendingLogin = new Promise((_resolve, reject) => {
    rejectLogin = reject;
  });
  const f = fixture({
    openBrowser: async () => ({
      browser: {
        close: async () => {
          closed = true;
          rejectLogin(new Error("closed"));
        },
      },
      finish: async (success, options) => {
        finished = true;
        assert.equal(success, false);
        assert.equal(options.retain, false);
      },
    }),
    authenticateBrowser: () => pendingLogin,
    startResident: async () =>
      assert.fail("Must not start resident after interrupted auth"),
  });
  await f.program.parseAsync([
    "node",
    "flyporter",
    "--browser",
    "browserless-cdp",
    "session",
    "keep-alive",
    "--duration",
    "0.02",
  ]);
  assert.equal(closed, true);
  assert.equal(finished, true);
});
test("explicit local selection preserves attachment and skips automated auth", async () => {
  const f = fixture();
  await f.program.parseAsync([
    "node",
    "flyporter",
    "--browser",
    "local",
    "search",
    "porter",
    "YTZ",
    "YUL",
    "2026-11-05",
  ]);
  assert.deepEqual(f.calls, [
    ["local", "search"],
    ["finish", true],
  ]);
});
test("BAP auth is one-shot and resident search does not open another session", async () => {
  const f = fixture();
  await f.program.parseAsync(["node", "flyporter", "auth"]);
  assert.deepEqual(f.calls, [["bap", "auth"], ["auth"], ["finish", true]]);
  const g = fixture({ residentSearch: async () => ({ flights: [] }) });
  await g.program.parseAsync([
    "node",
    "flyporter",
    "search",
    "porter",
    "YTZ",
    "YUL",
    "2026-11-05",
    "--json",
  ]);
  assert.deepEqual(g.calls, []);
});
test("invalid intervals and durations fail before connecting", async () => {
  for (const args of [
    ["--interval", "120"],
    ["--duration", "-1"],
  ]) {
    const f = fixture();
    await assert.rejects(
      f.program.parseAsync([
        "node",
        "flyporter",
        "session",
        "keep-alive",
        ...args,
      ]),
    );
    assert.deepEqual(f.calls, []);
  }
});
test("failed search closes without retaining the session", async () => {
  const f = fixture({
    searchPorter: async () => {
      throw new Error("failed");
    },
  });
  await assert.rejects(
    f.program.parseAsync([
      "node",
      "flyporter",
      "search",
      "porter",
      "YTZ",
      "YUL",
      "2026-11-05",
    ]),
  );
  assert.deepEqual(f.calls.at(-1), ["finish", false]);
});

test("foreground BAP keep-alive honors duration, reports billing and closes without retention", async () => {
  let stopped = false,
    closed = false;
  const calls = [];
  const f = fixture({
    openBrowser: async () => ({
      browser: {
        config: {},
        keepAlive: async () => ({
          url: "https://www.flyporter.com/en-ca/staff",
          status: 200,
        }),
        close: async () => {
          closed = true;
        },
      },
      finish: async (success, options) => calls.push({ success, ...options }),
    }),
    startResident: async () => ({
      heartbeat: async () => ({
        url: "https://www.flyporter.com/en-ca/staff",
        status: 200,
      }),
      stop: async () => {
        stopped = true;
      },
    }),
  });
  await f.program.parseAsync([
    "node",
    "flyporter",
    "session",
    "keep-alive",
    "--duration",
    "0.02",
  ]);
  assert.equal(stopped, true);
  assert.equal(closed, true);
  assert.equal(calls[0].retain, false);
  assert.match(f.error(), /paid remote browser/);
});
