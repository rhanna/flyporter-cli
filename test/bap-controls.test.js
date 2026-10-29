import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  controlExpression,
  enterAirport,
  enterDate,
} from "../src/bap-controls.js";

function fixture(html) {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://www.flyporter.com/",
  });
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return {
      width: 100,
      height: this.hasAttribute("hidden") ? 0 : 30,
    };
  };
  const selections = [];
  const clicks = [];
  const page = {
    evaluate: async (code) => {
      const value = dom.window.eval(code);
      return value === undefined || value === null ? null : String(value);
    },
    select: async (_selector, value) => {
      selections.push(value);
    },
    type: async (selector, value) => {
      dom.window.document.querySelector(selector).value = value;
    },
    waitForFunction: async (code) => assert.ok(dom.window.eval(`(${code})()`)),
    click: async (selector) => {
      clicks.push(selector);
    },
  };
  return { dom, page, selections, clicks };
}

test("serialized discovery finds visible labelled inputs and rejects ambiguity", () => {
  const { dom } = fixture(
    '<input id="email" hidden><label for="user">Username</label><input id="user"><input type="password">',
  );
  assert.equal(
    dom.window.eval(controlExpression("username")),
    '[data-porter-poc="username"]',
  );
  dom.window.document.body.insertAdjacentHTML(
    "beforeend",
    '<input name="email">',
  );
  assert.throws(
    () => dom.window.eval(controlExpression("username")),
    /Ambiguous/,
  );
  assert.equal(
    dom.window.eval(controlExpression("username", "#user")),
    '[data-porter-poc="username"]',
  );
});

test("airport selection matches a code embedded in the option label", async () => {
  const { page, selections } = fixture(
    '<select id="airport"><option value="montreal">Montréal (YUL)</option><option value="toronto">Toronto (YTZ)</option></select>',
  );
  await enterAirport(page, "#airport", "YUL");
  assert.deepEqual(selections, ["montreal"]);
});

test("airport autocomplete chooses a visible exact code and does not match a longer code", async () => {
  const { page, clicks } = fixture(
    '<input id="airport" role="combobox"><div role="option">Bad (YULX)</div><div role="option">Montréal (YUL)</div>',
  );
  await enterAirport(page, "#airport", "YUL");
  assert.deepEqual(clicks, ['[data-porter-airport-option="selected"]']);
});

test("native and text dates use their respective representations", async () => {
  const { dom, page } = fixture(
    '<input id="date" type="date"><input id="text">',
  );
  await enterDate(page, "#date", "2099-12-01", "12/01/2099");
  await enterDate(page, "#text", "2099-12-01", "12/01/2099");
  assert.equal(dom.window.document.querySelector("#date").value, "2099-12-01");
  assert.equal(dom.window.document.querySelector("#text").value, "12/01/2099");
});

test("Porter Twitter Typeahead options support exact airport codes", async () => {
  const { page, clicks } = fixture(
    '<input id="airport" role="combobox"><div class="tt-suggestion">Wrong (YULX)</div><div class="tt-suggestion">Montreal (YUL)</div>',
  );
  await enterAirport(page, "#airport", "YUL");
  assert.deepEqual(clicks, ['[data-porter-airport-option="selected"]']);
});
