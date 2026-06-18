import test from "node:test";
import assert from "node:assert/strict";
import { extractForm, extractVerificationToken } from "../src/html.js";

test("extracts anti-forgery token", () => {
  assert.equal(
    extractVerificationToken('<input name="__RequestVerificationToken" value="token-123">'),
    "token-123",
  );
});

test("extracts successful form fields without unchecked choices", () => {
  const html = `
    <form method="post" action="/en-ca/staff/select">
      <input type="hidden" name="__RequestVerificationToken" value="token">
      <input type="checkbox" name="chkPassengers" value="employee-key" checked>
      <input type="checkbox" name="ignored" value="no">
      <select name="SearchType">
        <option value="Other">Other</option>
        <option value="JumpSeat" selected>Jump seat</option>
      </select>
    </form>
  `;
  const form = extractForm(html, /\/staff\/select/);
  assert.equal(form.method, "POST");
  assert.equal(form.action, "/en-ca/staff/select");
  assert.equal(form.values.get("chkPassengers"), "employee-key");
  assert.equal(form.values.get("ignored"), null);
  assert.equal(form.values.get("SearchType"), "JumpSeat");
});
