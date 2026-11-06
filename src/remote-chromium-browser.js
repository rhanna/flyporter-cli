// @ts-check
import { chromium } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";
import { ChromeBrowser } from "./browser.js";
import { SessionStore } from "./resident-session.js";
import { createReporter } from "./diagnostics.js";
import {
  AuthenticationError,
  RemoteResponseError,
  SessionExpiredError,
} from "./errors.js";

const STAFF = "https://www.flyporter.com/en-ca/staff";
const STAFF_SEARCH = `${STAFF}/searchflight`;
const LOGIN = "https://www.flyporter.com/en-ca/login";
const USERNAME = "#txtVIPorterUsername";
const PASSWORD = "#txtVIPorterPassword";
const SUBMIT = '[id="8_SubmitLogin"]';

// Self-contained: Playwright serializes this function into the remote page.
export function inspectLoginPage() {
  const visible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    return (
      el.getBoundingClientRect().height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  };
  const body = document.body?.innerText || "";
  const porter = location.origin === "https://www.flyporter.com";
  const staff = porter && /^\/en-ca\/staff(?:\/|$)/i.test(location.pathname);
  const challenge =
    /just a moment|verify you are human|performing security verification|verifying you are human/i.test(
      document.title + " " + body.slice(0, 2000),
    ) ||
    Array.from(
      document.querySelectorAll(
        'iframe[src*="captcha"],iframe[src*="challenges.cloudflare.com"],.g-recaptcha,.h-captcha',
      ),
    ).some(visible);
  const rejected =
    porter &&
    /incorrect (?:username|password)|invalid (?:username or password|email or password|login credentials)|password (?:is incorrect|is invalid)|unable to log you in|credentials (?:are incorrect|are invalid)/i.test(
      body,
    );
  const mfa =
    porter &&
    (visible(document.querySelector('input[autocomplete="one-time-code"]')) ||
      /two[- ](?:step|factor)|multi[- ]factor|enter (?:the |your )?(?:verification|security|one[- ]time) code/i.test(
        body,
      ));
  const ready =
    staff &&
    !challenge &&
    !mfa &&
    visible(document.querySelector("#departureCity")) &&
    Boolean(document.querySelector("#booking-widget")) &&
    !visible(document.querySelector('input[type="password"]'));
  const staffEntry =
    staff &&
    !challenge &&
    !mfa &&
    visible(document.querySelector('a[href="/en-ca/staff/searchflight"]')) &&
    !visible(document.querySelector('input[type="password"]'));
  return {
    signedIn: ready || staffEntry,
    ready,
    login:
      porter &&
      visible(document.querySelector("#txtVIPorterUsername")) &&
      visible(document.querySelector("#txtVIPorterPassword")),
    challenge,
    rejected,
    mfa,
    temporaryError:
      /server encountered a temporary error|your web error code/i.test(body),
  };
}

// Chromium may advertise its internal/loopback host. Keep the configured tunnel/private
// authority and use only the browser target path from discovery.
export async function resolveRemoteEndpoint(config, fetchImpl = fetch) {
  const base = new URL(config.endpoint);
  if (["ws:", "wss:"].includes(base.protocol)) return base.href;
  const prefix = base.pathname.replace(/\/$/, "");
  const discovery = new URL(base);
  discovery.pathname = `${prefix}/json/version`;
  const response = await fetchImpl(discovery, {
    redirect: "error",
    signal: AbortSignal.timeout(config.timeout),
    // Direct Chromium rejects DNS Host headers; HTTPS proxies need their configured host.
    headers: base.protocol === "http:" ? { Host: "localhost" } : {},
  });
  if (!response.ok)
    throw new Error(`CDP discovery returned HTTP ${response.status}.`);
  const socket = new URL((await response.json()).webSocketDebuggerUrl);
  if (
    !["ws:", "wss:"].includes(socket.protocol) ||
    socket.username ||
    socket.password ||
    socket.search ||
    socket.hash ||
    !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(socket.pathname)
  ) {
    throw new Error("CDP discovery did not return a browser target.");
  }
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${prefix}${socket.pathname}`;
  return base.href;
}

export class RemoteChromiumBrowser extends ChromeBrowser {
  constructor(config, connection, context, page, report, stderr) {
    super({ connection, context, page, timeoutMs: config.timeout });
    this.config = config;
    this.report = report;
    this.stderr = stderr;
    this.closed = false;
    this.closePromise = null;
    this.abort = new AbortController();
  }

  static async open(
    config,
    report,
    stderr,
    { chromiumImpl = chromium, fetchImpl = fetch } = {},
  ) {
    let connection;
    let context;
    let page;
    try {
      const endpoint = await resolveRemoteEndpoint(config, fetchImpl);
      connection = await chromiumImpl.connectOverCDP(endpoint, {
        timeout: config.timeout,
      });
      context = connection.contexts()[0];
      if (!context)
        throw new Error("Persistent Chromium has no default browser context.");
      page = await context.newPage();
      page.setDefaultTimeout(config.timeout);
      return new RemoteChromiumBrowser(
        config,
        connection,
        context,
        page,
        report,
        stderr,
      );
    } catch (cause) {
      if (connection)
        await disconnectRemote(connection, page, context).catch(() => {});
      throw new RemoteResponseError(
        "Could not attach to persistent Chromium. Check the private endpoint or SSH tunnel.",
        { cause },
      );
    }
  }

  onDisconnected(callback) {
    this.connection.on("disconnected", callback);
    if (!this.connection.isConnected()) callback();
    return () => this.connection.off("disconnected", callback);
  }

  async state() {
    if (this.closed || !this.connection.isConnected())
      throw new RemoteResponseError("Remote browser disconnected.");
    try {
      return await this.page.evaluate(inspectLoginPage);
    } catch (error) {
      // Login navigation can replace the execution context between polls.
      if (
        /execution context was destroyed|cannot find context/i.test(
          error.message,
        )
      )
        return {};
      throw error;
    }
  }

  async waitState(deadline, predicate) {
    while (Date.now() < deadline) {
      const state = await this.state();
      if (state.temporaryError)
        throw new RemoteResponseError(
          "Porter returned a temporary server-error page.",
        );
      if (state.rejected)
        throw new AuthenticationError(
          "Porter rejected the login credentials; no retry was submitted.",
        );
      if (predicate(state)) return state;
      await sleep(
        Math.min(500, Math.max(0, deadline - Date.now())),
        undefined,
        { signal: this.abort.signal },
      );
    }
    return null;
  }

  async handoff(
    deadline,
    predicate = (state) => state.ready || state.signedIn,
  ) {
    if (Date.now() >= deadline)
      throw new AuthenticationError(
        "Authentication timed out before login handoff.",
      );
    await this.page.bringToFront();
    this.stderr.write(
      `Human sign-in required. Open the Chromium desktop:\n${this.config.desktopUrl}\nUse the foreground Porter tab to complete verification/MFA and sign in. Leave Chromium running.\n`,
    );
    const state = await this.waitState(deadline, predicate);
    if (!state)
      throw new AuthenticationError(
        "Interactive authentication did not complete before timeout.",
      );
    return state;
  }

  async authenticate({ timeoutMs = this.config.authTimeout } = {}) {
    const deadline = Date.now() + timeoutMs;
    const navigate = (url) =>
      this.page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: Math.max(
          1,
          Math.min(this.config.timeout, deadline - Date.now()),
        ),
      });
    // Establish/refresh the staff session before accessing its booking widget. Porter can
    // serve a temporary-error page for a direct searchflight visit after idle expiry.
    await navigate(STAFF);
    let state = this.config.username
      ? await this.waitState(
          Math.min(deadline, Date.now() + 15000),
          (s) => s.ready || s.signedIn || s.login || s.challenge || s.mfa,
        )
      : await this.state();
    if (state?.ready) return { authenticated: true };
    if (state?.signedIn) {
      // Staff landing and search pages differ; confirm the actual booking controls below.
    } else if (!this.config.username || state?.challenge || state?.mfa) {
      await this.handoff(deadline);
    } else {
      if (!state?.login) {
        await navigate(LOGIN);
        state = await this.waitState(
          Math.min(deadline, Date.now() + 15000),
          (s) => s.login || s.challenge || s.mfa,
        );
      }
      if (state?.login && !state.challenge && !state.mfa) {
        // Fill once, submit once. The password is never included in an event or handoff URL.
        const actionTimeout = () =>
          Math.max(1, Math.min(this.config.timeout, deadline - Date.now()));
        await this.page
          .locator(USERNAME)
          .fill(this.config.username, { timeout: actionTimeout() });
        await this.page
          .locator(PASSWORD)
          .fill(this.config.password, { timeout: actionTimeout() });
        await this.report.capture("01-credentials-entered");
        await this.page.locator(SUBMIT).click({
          timeout: Math.max(
            1,
            Math.min(this.config.timeout, deadline - Date.now()),
          ),
        });
        state = await this.waitState(
          Math.min(deadline, Date.now() + 15000),
          (s) => s.ready || s.signedIn || s.challenge || s.mfa,
        );
      }
      if (state?.challenge || state?.mfa) await this.handoff(deadline);
      else if (!state?.ready && !state?.signedIn) {
        throw new AuthenticationError(
          "Automatic login was not confirmed; no retry was submitted. Check credentials and Porter staff access.",
        );
      }
    }
    await navigate(STAFF_SEARCH);
    const verified = await this.waitState(
      Math.min(deadline, Date.now() + 15000),
      (s) => s.ready || s.challenge || s.mfa,
    );
    if (verified?.challenge || verified?.mfa)
      await this.handoff(deadline, (s) => s.ready);
    else if (!verified?.ready)
      throw new AuthenticationError(
        "Porter staff search controls were not confirmed before timeout.",
      );
    await this.report.capture("02-authenticated");
    return { authenticated: true };
  }

  reauthenticate(options) {
    return this.authenticate(options);
  }

  async keepAlive() {
    const result = await this.page.evaluate(async (timeout) => {
      const response = await fetch("https://www.flyporter.com/en-ca/staff", {
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
      await response.text();
      return { url: response.url, status: response.status };
    }, this.config.timeout);
    if (new URL(result.url).origin !== "https://www.flyporter.com")
      throw new SessionExpiredError();
    return result;
  }

  async waitForChallengeToClear() {
    const state = await this.state();
    if (state.temporaryError)
      throw new RemoteResponseError(
        "Porter returned a temporary server-error page.",
      );
    if (state.challenge)
      await this.handoff(
        Date.now() + this.config.authTimeout,
        (s) => s.challenge === false,
      );
  }

  async searchStaffAvailability(query) {
    await this.report.capture("03-before-search");
    const response = await super.searchStaffAvailability(query);
    // Shared normalization checks the JSON; reject malformed journey collections as well.
    if (response.status >= 200 && response.status < 300) {
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new RemoteResponseError("Malformed staff availability JSON.");
      }
      if (
        !Array.isArray(payload?.searchResults) ||
        payload.searchResults.some(
          (item) => !Array.isArray(item?.AvailableJourneys),
        )
      )
        throw new RemoteResponseError("Unexpected staff availability data.");
    }
    await this.report.capture("04-search-response");
    return response;
  }

  close() {
    if (!this.closePromise) {
      this.closed = true;
      this.abort.abort();
      this.closePromise = disconnectRemote(
        this.connection,
        this.page,
        this.context,
      );
    }
    return this.closePromise;
  }
}

async function disconnectRemote(connection, page, context) {
  let timer;
  try {
    if (connection.isConnected() && page && !page.isClosed()) {
      await Promise.race([
        // Closing the final headed tab can exit Chromium. Leave it blank instead.
        context?.pages &&
        context.pages().filter((tab) => !tab.isClosed()).length === 1
          ? page.goto("about:blank", { timeout: 5000 })
          : page.close({ runBeforeUnload: false }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Remote tab cleanup timed out.")),
            5000,
          );
        }),
      ]);
    }
  } finally {
    clearTimeout(timer);
    // Playwright close on connectOverCDP disconnects the client; never send CDP Browser.close.
    await connection.close();
  }
}

export async function openRemoteChromiumSession(
  config,
  stderr,
  {
    open = RemoteChromiumBrowser.open,
    store = new SessionStore(config.stateDir),
  } = {},
) {
  const unlock = await store.lock();
  let browser;
  try {
    const report = await createReporter(config, () => browser?.page, stderr);
    browser = await open(config, report, stderr);
    return {
      browser,
      report,
      store,
      async finish() {
        try {
          await browser.close();
        } finally {
          await unlock();
        }
      },
    };
  } catch (error) {
    try {
      await browser?.close();
    } finally {
      await unlock();
    }
    throw error;
  }
}
