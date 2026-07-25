import test from "node:test";
import assert from "node:assert/strict";
import { SessionExpiredError } from "../src/errors.js";
import { runKeepAlive } from "../src/session.js";

test("keep-alive sends heartbeats until aborted", async () => {
  const controller = new AbortController();
  let heartbeats = 0;
  const browser = {
    async keepAlive() {
      return { url: "https://www.flyporter.com/en-ca/staff", status: 200 };
    },
  };
  await runKeepAlive(browser, {
    intervalMs: 1,
    signal: controller.signal,
    onHeartbeat() {
      heartbeats += 1;
      if (heartbeats === 2) controller.abort();
    },
  });
  assert.equal(heartbeats, 2);
});

test("keep-alive can reauthenticate and continue after expiry", async () => {
  const controller = new AbortController();
  let attempts = 0;
  let reauthentications = 0;
  const browser = {
    async keepAlive() {
      attempts += 1;
      if (attempts === 1) {
        return { url: "https://www.flyporter.com/en-ca/login", status: 200 };
      }
      controller.abort();
      return { url: "https://www.flyporter.com/en-ca/staff", status: 200 };
    },
  };
  await runKeepAlive(browser, {
    intervalMs: 1,
    signal: controller.signal,
    reauthenticate: async (error) => {
      assert.ok(error instanceof SessionExpiredError);
      reauthentications += 1;
    },
  });
  assert.equal(reauthentications, 1);
  assert.equal(attempts, 2);
});
