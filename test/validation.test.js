import test from "node:test";
import assert from "node:assert/strict";
import { ValidationError } from "../src/errors.js";
import { validateAirportCode, validateDate, validateMaxStops } from "../src/validation.js";

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

test("maximum stops accepts zero and whole counts, rejecting malformed or unsafe input", () => {
  assert.equal(validateMaxStops(undefined), undefined);
  for (const value of [0, "0", 1, " 2 "]) assert.equal(validateMaxStops(value), Number(value));
  for (const value of [-1, "-1", 0.5, "1.5", "1e2", "", " ", "abc", null, true, NaN, Infinity, 9007199254740992]) {
    assert.throws(() => validateMaxStops(value), /non-negative whole number/);
  }
});
