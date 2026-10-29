import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  SessionStore,
  openBapSession,
  serialQueue,
  startResident,
  residentSearch,
} from "../src/bap-session.js";
import { loadBapConfig } from "../src/config.js";
async function setup(t, timeout = "60000") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "porter-state-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = loadBapConfig({
    BROWSERLESS_TOKEN: "token",
    PORTER_USERNAME: "user",
    PORTER_PASSWORD: "password",
    FLYPORTER_STATE_DIR: dir,
    ARTIFACTS_DIR: path.join(dir, "artifacts"),
    BAP_RECONNECT_TIMEOUT_MS: timeout,
  });
  await fs.mkdir(config.stateDir, { recursive: true });
  return { config, store: new SessionStore(config.stateDir) };
}
test("state permissions, exclusive locking and stale PID recovery", async (t) => {
  const { store } = await setup(t);
  const release = await store.lock();
  await assert.rejects(store.lock(), /busy/);
  await release();
  await store.write("lock.json", { pid: 2147483647 });
  const unlock = await store.lock();
  await unlock();
  await store.write("reconnect.json", { endpoint: "secret" });
  if (process.platform !== "win32") {
    assert.equal(
      (await fs.stat(store.file("reconnect.json"))).mode & 0o777,
      0o600,
    );
    assert.equal((await fs.stat(store.directory)).mode & 0o777, 0o700);
  }
});
test("reuse, expired references and reconnect failure create the correct session", async (t) => {
  const { config, store } = await setup(t);
  await store.init();
  for (const scenario of ["resume", "expired", "unavailable"]) {
    await store.write("reconnect.json", {
      endpoint: config.endpoint + "/saved",
      expiresAt: Date.now() + (scenario === "expired" ? -1 : 60000),
    });
    const calls = [];
    let closed = 0;
    const handle = await openBapSession(
      config,
      { write: () => {} },
      {
        store,
        open: async (_c, _r, endpoint) => {
          calls.push(endpoint);
          if (scenario === "unavailable" && endpoint)
            throw new Error("expired");
          return {
            page: { reconnect: async () => {} },
            retain: async () => config.endpoint + "/new",
            close: async () => closed++,
          };
        },
      },
    );
    await handle.finish(true);
    assert.equal(closed, 1);
    assert.equal(
      (await store.read("reconnect.json")).endpoint,
      config.endpoint + "/new",
    );
    assert.equal(calls.length, scenario === "unavailable" ? 2 : 1);
    assert.equal(
      calls[0],
      scenario === "expired" ? undefined : config.endpoint + "/saved",
    );
  }
});
test("disabled reuse and workflow failure disarm reconnect and close", async (t) => {
  for (const success of [true, false]) {
    const { config, store } = await setup(t, "0");
    const calls = [];
    const handle = await openBapSession(
      config,
      { write: () => {} },
      {
        store,
        open: async () => ({
          page: { reconnect: async (o) => calls.push(o.timeout) },
          close: async () => calls.push("close"),
        }),
      },
    );
    await handle.finish(success);
    assert.deepEqual(calls, [0, "close"]);
    assert.equal(await store.read("reconnect.json"), null);
  }
});
test("release failure still closes and unlocks", async (t) => {
  const { config, store } = await setup(t);
  let closed = 0;
  const handle = await openBapSession(
    config,
    { write: () => {} },
    {
      store,
      open: async () => ({
        page: { reconnect: async () => {} },
        retain: async () => {
          throw new Error("retain failed");
        },
        close: async () => closed++,
      }),
    },
  );
  await assert.rejects(handle.finish(true));
  assert.equal(closed, 1);
  const release = await store.lock();
  await release();
});
test("serial queue prevents overlap and survives rejected tasks", async () => {
  const enqueue = serialQueue();
  const calls = [];
  const a = enqueue(async () => {
    calls.push(1);
    await new Promise((r) => setTimeout(r, 5));
    calls.push(2);
    throw new Error("failed");
  });
  const b = enqueue(async () => calls.push(3));
  await assert.rejects(a);
  await b;
  assert.deepEqual(calls, [1, 2, 3]);
});
test("resident IPC searches share the owner and shutdown removes descriptor", async (t) => {
  const { config, store } = await setup(t);
  const controller = new AbortController();
  let searches = 0;
  const browser = {
    keepAlive: async () => ({
      url: "https://www.flyporter.com/en-ca/staff",
      status: 200,
    }),
    searchStaffAvailability: async () => {
      searches++;
      return {
        url: "https://www.flyporter.com/en-ca/flight/GetFlightAvailabilityStaffTravel",
        ok: true,
        json: async () => ({ searchResults: [] }),
      };
    },
  };
  const service = await startResident(
    { browser, store, report: { capture: async () => {} } },
    config,
    controller.signal,
    (error) => assert.fail(error),
  );
  try {
    const result = await residentSearch(config, {
      origin: "YTZ",
      destination: "YUL",
      date: "2099-12-01",
    });
    assert.deepEqual(result.flights, []);
    assert.equal(searches, 1);
  } finally {
    await service.stop();
  }
  assert.equal(await store.read("resident.json"), null);
});

test("resident rejects an invalid IPC credential without issuing a search", async (t) => {
  const { config, store } = await setup(t);
  let searches = 0;
  const service = await startResident(
    {
      browser: { searchStaffAvailability: async () => searches++ },
      store,
      report: {},
    },
    config,
    new AbortController().signal,
    () => {},
  );
  try {
    const descriptor = await store.read("resident.json");
    await store.write("resident.json", { ...descriptor, secret: "wrong" });
    await assert.rejects(residentSearch(config, {}), {
      code: "AUTHENTICATION_FAILED",
    });
    assert.equal(searches, 0);
  } finally {
    await service.stop();
  }
});
test("resident heartbeat reauthenticates exactly once after a confirmed expiry", async (t) => {
  const { config, store } = await setup(t);
  let attempts = 0,
    logins = 0;
  const browser = {
    keepAlive: async () => ({
      url:
        ++attempts === 1
          ? "https://www.flyporter.com/en-ca/login"
          : "https://www.flyporter.com/en-ca/staff",
      status: 200,
    }),
    reauthenticate: async () => {
      logins++;
    },
  };
  const service = await startResident(
    { browser, store, report: {} },
    config,
    new AbortController().signal,
    () => {},
  );
  try {
    await service.heartbeat(1000);
    assert.equal(logins, 1);
    assert.equal(attempts, 2);
  } finally {
    await service.stop();
  }
});

test("encrypted Browserless reconnect route prefixes are accepted without exposing them", async (t) => {
  const { config, store } = await setup(t);
  await store.init();
  const endpoint = new URL(config.endpoint);
  endpoint.pathname = "/e/encrypted-session" + endpoint.pathname + "/saved";
  await store.write("reconnect.json", {
    endpoint: endpoint.href,
    expiresAt: Date.now() + 60000,
  });
  let resumed;
  const handle = await openBapSession(
    config,
    { write: () => {} },
    {
      store,
      open: async (_c, _r, url) => {
        resumed = url;
        return { page: { reconnect: async () => {} }, close: async () => {} };
      },
    },
  );
  await handle.finish(false);
  assert.equal(resumed, endpoint.href);
});

test("interrupted remote transport releases local ownership without another remote mutation", async (t) => {
  const { config, store } = await setup(t);
  let closed = 0;
  const handle = await openBapSession(
    config,
    { write: () => {} },
    {
      store,
      open: async () => ({
        closed: true,
        page: {
          reconnect: async () =>
            assert.fail("closed transport must not be mutated"),
        },
        close: async () => closed++,
      }),
    },
  );
  await handle.finish(false, { retain: false });
  assert.equal(closed, 1);
  const release = await store.lock();
  await release();
});
