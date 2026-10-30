import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { BapBrowser, captchaOutcome } from "../src/bap-browser.js";
import { loadBapConfig } from "../src/config.js";
import { createReporter } from "../src/diagnostics.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const config = loadBapConfig({
  BROWSERLESS_TOKEN: "token",
  PORTER_USERNAME: "user",
  PORTER_PASSWORD: "password",
  BAP_TIMEOUT_MS: "30",
});
function fixture({
  loginFailure = false,
  stale = false,
  malformed = false,
  empty = false,
} = {}) {
  const dom = new JSDOM("", {
    url: "https://www.flyporter.com/en-ca/login",
    runScripts: "outside-only",
  });
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return { width: 100, height: this.hidden ? 0 : 30 };
  };
  let authenticated = false,
    submissions = 0,
    searches = 0,
    closed = 0;
  const events = [];
  const responses = [];
  const report = {
    event: async (step, details) => events.push({ step, ...details }),
    capture: async (step) => events.push({ step }),
  };
  const page = {
    preferences: async () => {},
    setViewport: async () => {},
    goto: async (url) => {
      if (!authenticated) {
        dom.reconfigure({ url: "https://www.flyporter.com/en-ca/login" });
        dom.window.document.body.innerHTML =
          '<input id="txtVIPorterUsername"><input id="txtVIPorterPassword" type="password"><button id="8_SubmitLogin">Log in</button>';
      } else {
        dom.reconfigure({ url });
        dom.window.document.body.innerHTML =
          '<button>One way</button><input name="checkbox" type="checkbox"><input id="departureCity"><input id="arrivalCty"><input id="bookingWidgetDateRangePickerStart" type="date"><button id="submitFlighSearch">Search</button>';
      }
    },
    url: async () => dom.window.location.href,
    evaluate: async (code) => {
      assert.doesNotMatch(code, /__name/);
      const value = await dom.window.eval(code);
      return value == null ? null : String(value);
    },
    solve: async () => ({ found: false, solved: false, error: null }),
    waitForFunction: async (code) =>
      assert.ok(await dom.window.eval(`(${code})()`)),
    waitForSelector: async () => {},
    type: async (selector, value) => {
      dom.window.document.querySelector(selector).value = value;
    },
    check: async (selector) => {
      dom.window.document.querySelector(selector).checked = true;
    },
    click: async (selector) => {
      const el = dom.window.document.querySelector(selector);
      if (el.id === "8_SubmitLogin") {
        submissions++;
        if (!loginFailure) {
          authenticated = true;
          dom.reconfigure({ url: "https://www.flyporter.com/en-ca/staff" });
          dom.window.document.body.innerHTML = "";
        }
      }
      if (el.id === "submitFlighSearch") {
        searches++;
        if (!stale)
          responses.push({
            url: "https://www.flyporter.com/en-ca/flight/GetFlightAvailabilityStaffTravel",
            status: 200,
            body: malformed
              ? "bad"
              : JSON.stringify({
                  searchResults: empty
                    ? []
                    : [
                        {
                          AvailableJourneys: [
                            {
                              JourneySellKey: "key",
                              Segments: [],
                              StandbyData: [],
                            },
                          ],
                        },
                      ],
                }),
          });
      }
    },
    response: async () => [...responses],
    reconnect: async () => ({
      browserQLEndpoint: "https://example.com/stealth/bql/session",
    }),
  };
  const sdk = {
    close: async () => {
      closed++;
    },
  };
  return {
    dom,
    page,
    sdk,
    report,
    events,
    browser: new BapBrowser(config, sdk, page, report),
    counts: () => ({ submissions, searches, closed }),
  };
}
test("CAPTCHA outcomes are explicit and tokens are never logged", async () => {
  for (const [result, expected] of [
    [{ found: false, solved: false }, "none"],
    [{ found: true, solved: true }, "solved"],
    [{ found: true, solved: false }, "failed"],
    [{ found: null, solved: null }, "unknown"],
    [{ found: false, solved: true }, "unknown"],
    [
      { found: false, solved: false, error: "Could not find the captcha" },
      "none",
    ],
  ]) {
    assert.equal(captchaOutcome(result), expected);
    const f = fixture();
    f.page.solve = async () => ({ ...result, token: "never-log" });
    if (["none", "solved"].includes(expected)) await f.browser.solve("test");
    else
      await assert.rejects(f.browser.solve("test"), {
        code: "CLOUDFLARE_CHALLENGE",
      });
    assert.ok(!JSON.stringify(f.events).includes("never-log"));
  }
});
test("simulated login and search execute self-contained remote expressions", async () => {
  const f = fixture();
  await f.browser.authenticate();
  const result = await f.browser.searchStaffAvailability({
    origin: "YTZ",
    destination: "YUL",
    date: "2099-12-01",
  });
  assert.equal((await result.json()).searchResults.length, 1);
  assert.deepEqual(f.counts(), { submissions: 1, searches: 1, closed: 0 });
  await f.browser.close();
  await f.browser.close();
  assert.equal(f.counts().closed, 1);
});
test("failed login is not submitted twice", async () => {
  const f = fixture({ loginFailure: true });
  await assert.rejects(f.browser.authenticate(), {
    code: "AUTHENTICATION_FAILED",
  });
  await assert.rejects(f.browser.authenticate(), {
    code: "AUTHENTICATION_FAILED",
  });
  assert.equal(f.counts().submissions, 1);
});
test("fresh empty availability succeeds; stale and malformed results fail", async () => {
  for (const scenario of [
    { empty: true },
    { stale: true },
    { malformed: true },
  ]) {
    const f = fixture(scenario);
    await f.browser.authenticate();
    const action = f.browser.searchStaffAvailability({
      origin: "YTZ",
      destination: "YUL",
      date: "2099-12-01",
    });
    if (scenario.empty)
      assert.deepEqual((await (await action).json()).searchResults, []);
    else await assert.rejects(action, { code: "REMOTE_RESPONSE_ERROR" });
  }
});
test("partial SDK initialization always attempts closure", async () => {
  let closed = 0;
  await assert.rejects(
    BapBrowser.open(config, { event: async () => {} }, config.endpoint, () => ({
      newPage: async () => {
        throw new Error("failed");
      },
      close: async () => {
        closed++;
      },
    })),
  );
  assert.equal(closed, 1);
});
test("screenshot is skipped if credential masking fails, and logs redact secrets", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "porter-report-"));
  let screenshots = 0;
  try {
    const report = await createReporter(
      { ...config, debug: true, artifactsDir: directory },
      () => ({
        evaluate: async () => {
          throw new Error("password token");
        },
        screenshot: async () => {
          screenshots++;
        },
      }),
      { write: () => {} },
    );
    await report.capture("failed");
    assert.equal(screenshots, 0);
    const log = await readFile(
      path.join(report.directory, "events.jsonl"),
      "utf8",
    );
    assert.ok(!log.includes("password"));
    assert.ok(!log.includes("token"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Porter calendar state is committed instead of merely typing into its text field", async () => {
  const f = fixture();
  await f.browser.authenticate();
  let selected;
  const picker = {
    state: {},
    setState(state, callback) {
      this.state = state;
      selected = state.startDate;
      callback();
    },
  };
  f.dom.window.moment = (value) => ({
    format: () => (typeof value === "string" ? value : value.format()),
  });
  const route = [];
  f.dom.window.ko = {
    dataFor: () => ({
      datePicker: picker,
      setSelectedLocationFrom: (code) => route.push(code),
      setSelectedLocationTo: (code) => route.push(code),
    }),
  };
  f.dom.window.document.body.insertAdjacentHTML(
    "afterbegin",
    '<div id="booking-widget"></div>',
  );
  await f.browser.searchStaffAvailability({
    origin: "YTZ",
    destination: "YUL",
    date: "2099-12-01",
  });
  assert.deepEqual(route, ["YTZ", "YUL"]);
  assert.equal(selected.format(), "2099-12-01");
  assert.equal(picker.state.isRoundTrip, false);
});

test("a passive challenge cannot be mistaken for a successful no-CAPTCHA outcome", async () => {
  const f = fixture();
  f.dom.window.document.title = "Just a moment";
  await assert.rejects(f.browser.solve("challenge"), {
    code: "CLOUDFLARE_CHALLENGE",
  });
  assert.ok(
    f.events.some((event) => event.reason === "challenge-still-visible"),
  );
});

test("an expired resumed transport recovers once before any credential submission", async () => {
  const { TimeoutError } = await import("@browserless.io/bap-ts");
  const stale = fixture(),
    fresh = fixture();
  stale.browser.resumed = true;
  stale.page.goto = async () => {
    throw new TimeoutError("expired session");
  };
  let opens = 0;
  stale.browser.openFresh = async () => {
    opens++;
    return fresh.browser;
  };
  await stale.browser.authenticate();
  assert.equal(opens, 1);
  assert.equal(stale.counts().submissions, 0);
  assert.equal(fresh.counts().submissions, 1);
  assert.equal(stale.counts().closed, 1);
});

test("a missing solver response or provider error never reports successful clearance", async () => {
  const f = fixture();
  f.page.solve = async () => null;
  await assert.rejects(f.browser.solve("missing"), {
    code: "CLOUDFLARE_CHALLENGE",
  });
  assert.equal(
    captchaOutcome({
      found: false,
      solved: false,
      error: "Solving is not enabled for this account",
    }),
    "failed",
  );
});
