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

test("finds the staff search form by its controls when the action is generated dynamically", () => {
  const html = `
    <form method="post">
      <input name="__RequestVerificationToken" value="token">
      <input type="radio" name="chkPassengers" value="employee-key">
      <input name="ClassOfServiceNames" value="ZP">
      <input name="SearchType" value="JumpSeat">
    </form>
  `;
  const form = extractForm(html, /\/staff\/select/);
  assert.equal(form.values.get("chkPassengers"), "employee-key");
  assert.equal(form.values.get("SearchType"), "JumpSeat");
});

test("builds the staff select submission from standalone asynchronous controls", () => {
  const html = `
    <main>
      <input name="__RequestVerificationToken" value="token">
      <input name="chkPassengers" value="employee-key">
      <input name="ClassOfServiceNames" value="ZP">
      <input name="SearchType" value="JumpSeat">
    </main>
  `;
  const form = extractForm(html, /\/staff\/select/);
  assert.equal(form.action, "/en-ca/staff/select");
  assert.equal(form.method, "POST");
  assert.equal(form.values.get("__RequestVerificationToken"), "token");
  assert.equal(form.values.get("chkPassengers"), "employee-key");
});
