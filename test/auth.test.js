import test from "node:test";
import assert from "node:assert/strict";
import { authenticate } from "../src/auth.js";
import { AuthenticationError } from "../src/errors.js";

test("authenticates with anti-forgery token and credentials", async () => {
  let submitted;
  const browser = {
    async get() {
      return response('<input name="__RequestVerificationToken" value="csrf-token">', {
        url: "https://www.flyporter.com/en-ca/login",
      });
    },
    async post(_url, options) {
      submitted = options.body;
      return response("<html>staff</html>", {
        url: "https://www.flyporter.com/en-ca/staff",
      });
    },
  };
  await authenticate(browser, { username: "employee", password: "secret" });
  assert.equal(submitted.get("__RequestVerificationToken"), "csrf-token");
  assert.equal(submitted.get("VIPorterNumberOrEmailOrUsername"), "employee");
  assert.equal(submitted.get("Password"), "secret");
});

test("rejects missing credentials", async () => {
  await assert.rejects(
    () => authenticate({}, { username: "", password: "" }),
    AuthenticationError,
  );
});

function response(body, { url, status = 200 } = {}) {
  const result = new Response(body, { status });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
