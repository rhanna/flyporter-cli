import test from "node:test";
import assert from "node:assert/strict";
import { authenticateInteractively, isStaffUrl, verifyKeepAliveResult } from "../src/auth.js";
import { SessionExpiredError } from "../src/errors.js";

test("recognizes Porter staff URLs", () => {
  assert.equal(isStaffUrl("https://www.flyporter.com/en-ca/staff"), true);
  assert.equal(isStaffUrl("https://www.flyporter.com/en-ca/staff/searchflight"), true);
  assert.equal(isStaffUrl("https://www.flyporter.com/en-ca/login"), false);
});

test("interactive auth returns immediately for an authenticated profile", async () => {
  const browser = {
    page: { url: () => "https://www.flyporter.com/en-ca/staff" },
    async goto() {},
  };
  await assert.doesNotReject(() => authenticateInteractively(browser));
});

test("interactive auth waits for the staff page after login", async () => {
  let currentUrl = "https://www.flyporter.com/en-ca/login";
  let waited = false;
  const browser = {
    page: {
      url: () => currentUrl,
      async waitForURL(predicate) {
        currentUrl = "https://www.flyporter.com/en-ca/staff";
        assert.equal(predicate(new URL(currentUrl)), true);
        waited = true;
      },
    },
    async goto() {},
    async waitForChallengeToClear() {},
  };
  await authenticateInteractively(browser);
  assert.equal(waited, true);
});

test("keep-alive detects login redirects", async () => {
  await assert.rejects(
    () => verifyKeepAliveResult({ url: "https://www.flyporter.com/en-ca/login", status: 200 }),
    SessionExpiredError,
  );
});
