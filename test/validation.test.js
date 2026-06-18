import test from "node:test";
import assert from "node:assert/strict";
import { ValidationError } from "../src/errors.js";
import { validateAirportCode, validateDate } from "../src/validation.js";

test("airport codes are normalized", () => {
  assert.equal(validateAirportCode(" yul ", "Origin"), "YUL");
});

test("invalid airport codes are rejected", () => {
  assert.throws(() => validateAirportCode("YULX", "Origin"), ValidationError);
});

test("valid dates are accepted", () => {
  assert.equal(validateDate("2026-06-18"), "2026-06-18");
});

test("invalid calendar dates are rejected", () => {
  assert.throws(() => validateDate("2026-02-30"), ValidationError);
  assert.throws(() => validateDate("06/18/2026"), ValidationError);
});
