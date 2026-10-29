// @ts-check
import Browserless, {
  ConnectionError,
  TimeoutError,
} from "@browserless.io/bap-ts";
import { setTimeout as sleep } from "node:timers/promises";
import { Browser, BrowserResponse } from "./browser.js";
import {
  AuthenticationError,
  CloudflareChallengeError,
  RemoteResponseError,
  SessionExpiredError,
} from "./errors.js";
import {
  controlExpression,
  findControl,
  enterText,
  enterAirport,
  enterDate,
} from "./bap-controls.js";
import { formatDate } from "./config.js";

export const STAFF_SEARCH_URL =
  "https://www.flyporter.com/en-ca/staff/searchflight";
const AVAILABILITY_GLOB = "*GetFlightAvailabilityStaffTravel*";

export function captchaOutcome(result) {
  // The live service can include a "could not find captcha" diagnostic with found:false.
  // Its explicit detection flags distinguish that from a failed solve.
  if (
    result?.found === false &&
    result?.solved === false &&
    (!result.error ||
      /could not find (?:the )?captcha|no captcha (?:found|detected)/i.test(
        result.error,
      ))
  )
    return "none";
  if (result?.error) return "failed";
  if (result?.solved === true && result?.found !== false) return "solved";
  if (result?.found === true && result?.solved === false) return "failed";
  return "unknown";
}

export class BapBrowser extends Browser {
  constructor(config, sdk, page, report) {
    super();
    this.config = config;
    this.sdk = sdk;
    /** @type {import("@browserless.io/bap-ts").Page} */
    this.page = page;
    this.report = report;
    this.loginSubmitted = false;
    this.closed = false;
    this.closePromise = null;
    this.resumed = false;
    this.openFresh = () => BapBrowser.open(this.config, this.report);
  }

  static async open(
    config,
    report,
    endpoint = config.endpoint,
    connect = Browserless.connect,
  ) {
    const sdk = connect({
      browserWSEndpoint: endpoint,
      token: config.token,
      timeout: config.timeout,
    });
    try {
      const page = await sdk.newPage();
      const browser = new BapBrowser(config, sdk, page, report);
      browser.resumed = endpoint !== config.endpoint;
      await page.preferences({ timeout: config.timeout });
      await page.setViewport({ width: 1440, height: 1000 });
      if (browser.resumed) await page.reconnect({ timeout: 0 });
      return browser;
    } catch (error) {
      try {
        await sdk.close();
      } catch (cleanup) {
        await report.event("cleanup-failed", { error: cleanup.message });
      }
      throw new AuthenticationError(
        "Browserless session could not be opened.",
        { cause: error },
      );
    }
  }

  async solve(step) {
    await this.report.capture(`${step}-before-captcha`);
    const siteError = await this.page.evaluate(
      `String(/server encountered a temporary error|your web error code/i.test(document.body?.innerText || ''))`,
    );
    if (siteError === "true")
      throw new RemoteResponseError(
        "Porter returned its temporary server-error page; no login or search retry was submitted.",
      );
    let result;
    try {
      const cloudflare = await this.page
        .evaluate(`String(/just a moment|verify you are human|performing security verification|verifying you are human/i.test(
        (document.title || '') + ' ' + (document.body?.innerText?.slice(0,1500) || '')))`);
      result = await this.page.solve({
        ...(cloudflare === "true" ? { type: "cloudflare" } : {}),
        wait: cloudflare === "true",
        timeout: this.config.captchaTimeout,
      });
    } catch (cause) {
      await this.report.event(step, {
        outcome: "unknown",
        error: cause.message,
      });
      throw new CloudflareChallengeError({ cause });
    }
    const outcome = captchaOutcome(result);
    await this.report.event(step, {
      outcome,
      found: result?.found,
      solved: result?.solved,
      error: result?.error,
    });
    if (outcome === "failed" || outcome === "unknown") {
      throw new CloudflareChallengeError({
        cause: new Error(`CAPTCHA outcome: ${outcome}`),
      });
    }
    // A passive Cloudflare interstitial can be visible even when solve() found no widget.
    // Do not navigate away or treat authentication as complete while it is still active.
    try {
      await this.page.waitForFunction(
        `() => !/just a moment|verify you are human|performing security verification|verifying you are human/i.test(
        (document.title || '') + ' ' + (document.body?.innerText?.slice(0,1500) || ''))`,
        { timeout: this.config.timeout },
      );
    } catch (cause) {
      await this.report.event(step, {
        outcome: "unknown",
        reason: "challenge-still-visible",
      });
      throw new CloudflareChallengeError({ cause });
    }
    await this.report.capture(`${step}-after-captcha`);
    return outcome;
  }

  async waitControl(field, timeout = this.config.timeout) {
    await this.page.waitForFunction(
      `() => Boolean(${controlExpression(field, this.config.selectors[field])})`,
      { timeout },
    );
    return findControl(this.page, field, this.config.selectors[field]);
  }

  async authenticate({ timeoutMs = this.config.timeout } = {}) {
    timeoutMs = Math.min(timeoutMs, this.config.timeout);
    // An actual staff navigation verifies authentication on every invocation/reconnect.
    try {
      await this.page.goto(
        this.resumed
          ? STAFF_SEARCH_URL
          : "https://www.flyporter.com/en-ca/login",
        { waitUntil: "domContentLoaded", timeout: timeoutMs },
      );
    } catch (cause) {
      if (
        this.resumed &&
        !this.loginSubmitted &&
        (cause instanceof ConnectionError || cause instanceof TimeoutError)
      ) {
        // A reconnect socket can open just before the provider's absolute session deadline.
        // Recover once, before submitting any credentials or search in the stale session.
        await this.report.event("resumed-session-unavailable", {
          action: "fresh-session",
        });
        await this.close();
        const fresh = await this.openFresh();
        this.sdk = fresh.sdk;
        this.page = fresh.page;
        this.closed = false;
        this.closePromise = null;
        this.resumed = false;
        return this.authenticate({ timeoutMs });
      }
      throw new RemoteResponseError(
        "Porter authentication navigation failed.",
        { cause },
      );
    }
    await this.solve("01-staff-access");
    if (await this.hasStaffAccess()) return { authenticated: true };
    if (this.loginSubmitted)
      throw new AuthenticationError(
        "Porter authentication expired after a login attempt; no duplicate submission was made.",
      );
    if (!/\/login|\/viporter\/sign-in/i.test(await this.page.url())) {
      await this.page.goto("https://www.flyporter.com/en-ca/login", {
        waitUntil: "domContentLoaded",
        timeout: timeoutMs,
      });
      await this.solve("02-login-page");
    }
    try {
      const username = await this.waitControl("username", timeoutMs);
      const password = await this.waitControl("password", timeoutMs);
      await enterText(this.page, username, this.config.username);
      await enterText(this.page, password, this.config.password);
      await this.report.capture("03-credentials-entered");
      this.loginSubmitted = true;
      await this.page.click(await this.waitControl("login-submit"), {
        visible: true,
      });
      await this.solve("04-login-submitted");
      await this.page.waitForFunction(
        `() => location.hostname === 'www.flyporter.com'
        && !/\\/login|\\/viporter\\/sign-in/i.test(location.pathname)
        && !Array.from(document.querySelectorAll('input[type="password"]')).some(el => el.getBoundingClientRect().height > 0)`,
        { timeout: timeoutMs },
      );
      await this.page.goto(STAFF_SEARCH_URL, {
        waitUntil: "domContentLoaded",
        timeout: timeoutMs,
      });
      await this.solve("05-login-complete");
      if (!(await this.hasStaffAccess()))
        throw new Error("Staff entitlement not confirmed.");
      return { authenticated: true };
    } catch (cause) {
      if (cause instanceof CloudflareChallengeError) throw cause;
      throw new AuthenticationError(
        "Porter login or staff access was not confirmed. Check credentials, MFA and staff entitlement.",
        { cause },
      );
    }
  }

  async hasStaffAccess() {
    const url = new URL(await this.page.url());
    if (
      url.hostname !== "www.flyporter.com" ||
      !url.pathname.startsWith("/en-ca/staff")
    )
      return false;
    await this.waitControl("origin");
    return true;
  }

  async keepAlive() {
    const text = await this.page.evaluate(`(async () => {
      const response = await fetch('https://www.flyporter.com/en-ca/staff', {
        credentials:'include', cache:'no-store', redirect:'follow'
      });
      await response.text();
      return JSON.stringify({url:response.url,status:response.status});
    })()`);
    if (!text)
      throw new RemoteResponseError("No heartbeat response from Browserless.");
    return JSON.parse(text);
  }

  async reauthenticate(options) {
    // Called only once following a confirmed expiry; failed login exits the resident loop.
    this.loginSubmitted = false;
    return this.authenticate(options);
  }

  async searchStaffAvailability({ origin, destination, date }) {
    const page = this.page;
    if ((await page.url()) !== STAFF_SEARCH_URL) {
      await page.goto(STAFF_SEARCH_URL, { waitUntil: "domContentLoaded" });
    }
    await this.solve("06-search-page");
    if (!(await this.hasStaffAccess())) throw new SessionExpiredError();
    await page.click(await this.waitControl("one-way"), { visible: true });
    // The account holder is the first eligible checkbox, matching the existing CLI.
    const passenger = await page.evaluate(`(() => {
      const el = Array.from(document.querySelectorAll(${JSON.stringify(this.config.passengerSelector)}))
        .find(el => el.getBoundingClientRect().height > 0 && !el.disabled);
      if (!el) throw new Error('No eligible staff passenger.');
      el.setAttribute('data-flyporter-passenger','selected'); return '[data-flyporter-passenger="selected"]';
    })()`);
    if (!passenger)
      throw new RemoteResponseError("No eligible staff passenger.");
    await page.check(passenger, { visible: true });
    await this.report.capture("07-trip-passenger");
    await enterAirport(
      page,
      await this.waitControl("origin"),
      origin,
      this.config.originOption,
    );
    await this.report.capture("08-origin");
    await enterAirport(
      page,
      await this.waitControl("destination"),
      destination,
      this.config.destinationOption,
    );
    await this.report.capture("09-destination");
    const dateSelector = await this.waitControl("departure-date");
    // Porter uses a React calendar behind an editable-looking text field. Typing text
    // alone does not commit its state. Reuse the existing local adapter's verified API.
    const widgetDate = await page.evaluate(`(async () => {
      const widget = document.querySelector('#booking-widget');
      const vm = widget && globalThis.ko?.dataFor(widget);
      if (!vm?.datePicker?.setState || !globalThis.moment) return 'unavailable';
      // Preserve exact station/city codes even when the autocomplete groups nearby airports.
      if (vm.setSelectedLocationFrom && vm.setSelectedLocationTo) {
        vm.setSelectedLocationFrom(${JSON.stringify(origin)});
        vm.setSelectedLocationTo(${JSON.stringify(destination)});
      }
      await new Promise(resolve => vm.datePicker.setState({
        startDate:globalThis.moment(${JSON.stringify(date)}), endDate:null, isRoundTrip:false
      },resolve));
      const selected = vm.datePicker.state?.startDate;
      if (!selected || globalThis.moment(selected).format('YYYY-MM-DD') !== ${JSON.stringify(date)})
        throw new Error('Porter calendar did not accept the requested date.');
      return 'set';
    })()`);
    if (widgetDate !== "set") {
      await enterDate(
        page,
        dateSelector,
        date,
        formatDate(date, this.config.dateFormat),
      );
    }
    await this.report.capture("10-search-filled");
    // BAP includes previously captured traffic: record its size before this submission.
    const before = await page.response({
      url: [AVAILABILITY_GLOB],
      wait: false,
      body: true,
    });
    await page.click(await this.waitControl("search-submit"), {
      visible: true,
    });
    await this.solve("11-search-submitted");
    const deadline = Date.now() + this.config.timeout;
    let response;
    while (Date.now() < deadline) {
      const records = await page.response({
        url: [AVAILABILITY_GLOB],
        wait: false,
        body: true,
      });
      if (records.length > before.length) {
        response = records.at(-1);
        break;
      }
      await sleep(250);
    }
    if (!response?.body || !response.url || !response.status) {
      throw new RemoteResponseError(
        "No fresh staff availability response was captured before timeout.",
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new RemoteResponseError(
        `Porter availability returned HTTP ${response.status}.`,
      );
    }
    let payload;
    try {
      payload = JSON.parse(response.body);
    } catch (cause) {
      throw new RemoteResponseError("Malformed staff availability JSON.", {
        cause,
      });
    }
    if (
      !Array.isArray(payload?.searchResults) ||
      payload.searchResults.some(
        (item) => !Array.isArray(item?.AvailableJourneys),
      )
    )
      throw new RemoteResponseError("Unexpected staff availability data.");
    // A fresh explicit empty availability payload is the authoritative no-flights state.
    const flights = payload.searchResults.flatMap(
      (item) => item.AvailableJourneys || [],
    );
    if (this.config.resultsSelector && flights.length) {
      await page.waitForSelector(this.config.resultsSelector, {
        visible: true,
      });
    }
    await this.report.capture("12-confirmed-results");
    await this.report.event("results-confirmed", {
      flights: flights.length,
      noAvailability: flights.length === 0,
    });
    return new BrowserResponse({
      url: response.url,
      status: response.status,
      body: response.body,
    });
  }

  async retain(timeout) {
    const session = await this.page.reconnect({ timeout });
    if (!session.browserQLEndpoint)
      throw new RemoteResponseError(
        "Browserless did not return a reconnect endpoint.",
      );
    return session.browserQLEndpoint.replace(/^https:/, "wss:");
  }

  async close() {
    if (!this.closePromise) {
      this.closed = true;
      this.closePromise = this.sdk.close();
    }
    return this.closePromise;
  }
}
