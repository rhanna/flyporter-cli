import test from "node:test";
import assert from "node:assert/strict";
import {
  BrowserResponse,
  ChromeBrowser,
  getChromeDebugPort,
  getDefaultChromeProfilePath,
} from "../src/browser.js";
import { AuthenticationError } from "../src/errors.js";

test("uses a dedicated macOS Chrome profile", () => {
  assert.equal(
    getDefaultChromeProfilePath({ platform: "darwin", env: {}, home: "/Users/test" }),
    "/Users/test/Library/Application Support/flyporter/chrome-profile",
  );
});

test("supports Chrome profile and debug-port overrides", () => {
  assert.equal(
    getDefaultChromeProfilePath({
      platform: "darwin",
      env: { FLYPORTER_CHROME_PROFILE: "/tmp/porter-profile" },
      home: "/Users/test",
    }),
    "/tmp/porter-profile",
  );
  assert.equal(getChromeDebugPort({ FLYPORTER_CHROME_DEBUG_PORT: "9333" }), 9333);
  assert.equal(getChromeDebugPort({ FLYPORTER_CHROME_DEBUG_PORT: "invalid" }), 9223);
});

test("executes POST requests as credentialed page-side fetch", async () => {
  let evaluated;
  const page = {
    async evaluate(_callback, input) {
      evaluated = input;
      return {
        url: input.url,
        status: 200,
        headers: { "content-type": "application/json" },
        body: '{"ok":true}',
      };
    },
    url: () => "https://www.flyporter.com/en-ca/staff",
  };
  const browser = new ChromeBrowser({ context: {}, page });
  browser.waitForChallengeToClear = async () => {};

  const response = await browser.post("https://www.flyporter.com/api", {
    headers: {
      "content-type": "application/json",
      origin: "https://www.flyporter.com",
      cookie: "secret=value",
    },
    body: '{"query":true}',
  });

  assert.equal(evaluated.method, "POST");
  assert.equal(evaluated.body, '{"query":true}');
  assert.equal(evaluated.headers["content-type"], "application/json");
  assert.equal(evaluated.headers.cookie, undefined);
  assert.deepEqual(await response.json(), { ok: true });
});

test("browser response implements the search response contract", async () => {
  const response = new BrowserResponse({
    url: "https://example.test",
    status: 200,
    headers: { "content-type": "application/json" },
    body: '{"value":1}',
  });
  assert.equal(response.ok, true);
  assert.equal(await response.text(), '{"value":1}');
  assert.deepEqual(await response.clone().json(), { value: 1 });
});

test("browser response ignores Playwright's newline-joined set-cookie header", () => {
  const response = new BrowserResponse({
    url: "https://www.flyporter.com/en-ca/staff",
    status: 200,
    headers: {
      "content-type": "text/html",
      "set-cookie":
        "culture=en-CA; path=/; secure; HttpOnly\n__RequestVerificationToken=token; path=/; secure; HttpOnly",
    },
    body: "<html></html>",
  });

  assert.equal(response.headers.get("content-type"), "text/html");
  assert.equal(response.headers.has("set-cookie"), false);
});

test("search attachment requires a running Chrome session", async () => {
  const chromiumImpl = {
    async connectOverCDP() {
      throw new Error("not running");
    },
  };
  await assert.rejects(
    () => ChromeBrowser.connectRequired({ chromiumImpl }),
    AuthenticationError,
  );
});

test("attached browser cleanup closes its tab and local CDP connection", async () => {
  let pageClosed = false;
  let connectionClosed = false;
  const browser = new ChromeBrowser({
    context: {},
    page: {
      isClosed: () => false,
      async close() {
        pageClosed = true;
      },
    },
    attachedPage: true,
    connection: {
      async close() {
        connectionClosed = true;
      },
    },
  });

  await browser.close();
  assert.equal(pageClosed, true);
  assert.equal(connectionClosed, true);
});
