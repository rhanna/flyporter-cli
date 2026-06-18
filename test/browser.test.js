import test from "node:test";
import assert from "node:assert/strict";
import { FetchCookieBrowser } from "../src/browser.js";
import { CloudflareChallengeError } from "../src/errors.js";

test("persists cookies across requests and serialized sessions", async () => {
  const seenCookies = [];
  const fetchImpl = async (_url, options) => {
    seenCookies.push(new Headers(options.headers).get("cookie"));
    const response = new Response("ok", {
      headers: seenCookies.length === 1 ? { "set-cookie": "session=test-value; Path=/" } : {},
    });
    Object.defineProperty(response, "url", { value: String(_url) });
    return response;
  };

  const browser = new FetchCookieBrowser({ fetchImpl });
  await browser.get("https://example.test/start");
  await browser.get("https://example.test/finish");
  assert.equal(seenCookies[1], "session=test-value");

  const restoredCookies = [];
  const restored = FetchCookieBrowser.fromSession(browser.serializeSession(), {
    fetchImpl: async (_url, options) => {
      restoredCookies.push(new Headers(options.headers).get("cookie"));
      return new Response("ok");
    },
  });
  await restored.get("https://example.test/finish");
  assert.equal(restoredCookies[0], "session=test-value");
});

test("detects Cloudflare challenge responses", async () => {
  const browser = new FetchCookieBrowser({
    fetchImpl: async () =>
      new Response("<title>Just a moment...</title>", {
        status: 403,
        headers: { server: "cloudflare" },
      }),
  });
  await assert.rejects(() => browser.get("https://example.test"), CloudflareChallengeError);
});
