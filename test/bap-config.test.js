import assert from "node:assert/strict";
import test from "node:test";
import { loadBapConfig, selectBackend, redact } from "../src/config.js";
import { heartbeat } from "../src/cli.js";
const env = {
  BROWSERLESS_TOKEN: "a-token",
  FLYPORTER_USERNAME: "staff",
  FLYPORTER_PASSWORD: "secret",
};
test("BAP defaults, credential compatibility and reconnect configuration", () => {
  const config = loadBapConfig(env);
  assert.equal(config.username, "staff");
  assert.equal(config.reconnectTimeout, 60000);
  assert.equal(config.debug, false);
  assert.match(config.endpoint, /stealth\/bql$/);
  assert.equal(selectBackend("bap"), "bap");
  assert.equal(selectBackend("local"), "local");
  assert.throws(() => selectBackend("other"));
  assert.equal(
    loadBapConfig({ ...env, PORTER_USERNAME: "new" }).username,
    "new",
  );
  assert.equal(
    loadBapConfig({ ...env, BAP_RECONNECT_TIMEOUT_MS: "0" }).reconnectTimeout,
    0,
  );
  for (const value of ["-1", "NaN", "0.5"])
    assert.throws(() =>
      loadBapConfig({ ...env, BAP_RECONNECT_TIMEOUT_MS: value }),
    );
  assert.equal(heartbeat("60", "bap"), 60);
  for (const value of ["29", "120", "240"])
    assert.throws(() => heartbeat(value, "bap"));
  assert.equal(heartbeat("240", "local"), 240);
});
test("debugging is explicitly opt-in with validated configuration", () => {
  for (const value of ["1", "true", " TRUE "]) {
    assert.equal(loadBapConfig({ ...env, FLYPORTER_DEBUG: value }).debug, true);
  }
  for (const value of ["", "0", "false"]) {
    assert.equal(
      loadBapConfig({ ...env, FLYPORTER_DEBUG: value }).debug,
      false,
    );
  }
  assert.throws(
    () => loadBapConfig({ ...env, FLYPORTER_DEBUG: "yes" }),
    /FLYPORTER_DEBUG/,
  );
});
test("endpoint validation and redaction never echo configured secrets", () => {
  for (const endpoint of [
    "invalid",
    "https://example.com/bql",
    "wss://example.com/bql?token=oops",
  ])
    assert.throws(() =>
      loadBapConfig({ ...env, BROWSERLESS_ENDPOINT: endpoint }),
    );
  const secret = 'pass#"word';
  const text = redact(
    `${secret} ${encodeURIComponent(secret)} ${JSON.stringify(secret)} wss://example.com/stealth/bql/secret-id?token=oops`,
    [secret],
  );
  assert.ok(!text.includes(secret));
  assert.ok(!text.includes("secret-id"));
  assert.ok(!text.includes("oops"));
});
