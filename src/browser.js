import { myidtravelExpression, parseMyidtravelResult, waitMyidtravelReady } from "./myidtravel-browser.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import {
  AuthenticationError,
  CloudflareChallengeError,
  RemoteResponseError,
} from "./errors.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_CDP_PORT = 9223;

export class Browser {
  async request() {
    throw new Error("Browser.request() must be implemented");
  }

  async get(url, options = {}) {
    return this.request(url, { ...options, method: "GET" });
  }

  async post(url, options = {}) {
    return this.request(url, { ...options, method: "POST" });
  }

  async close() {}
}

export class ChromeBrowser extends Browser {
  constructor({
    context,
    page,
    owner = false,
    attachedPage = false,
    browserProcess = null,
    connection = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    super();
    this.context = context;
    this.page = page;
    this.owner = owner;
    this.attachedPage = attachedPage;
    this.browserProcess = browserProcess;
    this.connection = connection;
    this.timeoutMs = timeoutMs;
    this.otherAirlineActive = false;
  }

  static async launch({
    profilePath = getDefaultChromeProfilePath(),
    port = getChromeDebugPort(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headless = false,
    chromiumImpl = chromium,
  } = {}) {
    await fs.mkdir(profilePath, { recursive: true, mode: 0o700 });
    const executable = await findChromeExecutable();
    const args = [
      `--user-data-dir=${profilePath}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--start-maximized",
    ];
    if (headless) args.push("--headless=new");
    args.push("about:blank");

    let browserProcess;
    try {
      browserProcess = spawn(executable, args, {
        stdio: "ignore",
        detached: true,
      });
      browserProcess.unref();
      await waitForDebugEndpoint(port, browserProcess, timeoutMs);
    } catch (cause) {
      browserProcess?.kill();
      throw new AuthenticationError(
        "Chrome could not start with the FlyPorter profile. Stop any existing keep-alive process and try again.",
        { cause },
      );
    }

    let connection;
    try {
      connection = await chromiumImpl.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 5000,
      });
    } catch (cause) {
      browserProcess.kill();
      throw new AuthenticationError("Chrome started, but the CLI could not connect to it.", { cause });
    }

    const context = connection.contexts()[0];
    const page = selectPage(context.pages()) || (await context.newPage());
    page.setDefaultTimeout(timeoutMs);
    return new ChromeBrowser({
      context,
      page,
      owner: true,
      browserProcess,
      connection,
      timeoutMs,
    });
  }

  static async connect({
    port = getChromeDebugPort(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    chromiumImpl = chromium,
  } = {}) {
    const endpoint = `http://127.0.0.1:${port}`;
    let connection;
    try {
      connection = await chromiumImpl.connectOverCDP(endpoint, { timeout: 1500 });
    } catch {
      return null;
    }
    const context = connection.contexts()[0];
    if (!context) {
      await connection.close();
      return null;
    }
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    return new ChromeBrowser({
      context,
      page,
      attachedPage: true,
      connection,
      timeoutMs,
    });
  }

  static async connectOrLaunch(options = {}) {
    return (await ChromeBrowser.connect(options)) || ChromeBrowser.launch(options);
  }

  static async connectRequired(options = {}) {
    const browser = await ChromeBrowser.connect(options);
    if (!browser) {
      throw new AuthenticationError(
        "No authenticated FlyPorter Chrome session is running. Start `flyporter auth` and leave it running.",
      );
    }
    return browser;
  }

  async myidtravel(args) {
    try {
      return parseMyidtravelResult(
        await this.page.evaluate(myidtravelExpression({ ...args, timeout: this.timeoutMs })),
      );
    } catch (error) {
      if (error instanceof RemoteResponseError) throw error;
      throw new RemoteResponseError("myIDTravel transport failed.", {
        code: "TRANSPORT_ERROR",
      });
    }
  }

  async openOtherAirline() {
    this.otherAirlineActive = true;
    // Do not read/export the SSO URL, response headers or account-page HTML.
    try {
      await this.page.goto("https://www.flyporter.com/en-ca/staff/otherairlines", {
        waitUntil: "domcontentloaded",
        timeout: this.timeoutMs,
      });
    } catch {
      throw new RemoteResponseError("myIDTravel navigation failed.", { code: "TRANSPORT_ERROR" });
    }
    await this.waitForChallengeToClear();
    await waitMyidtravelReady(this, this.timeoutMs);
  }

  async discoverOtherAirlineCabins(airline) {
    return (await this.myidtravel({ action: "discover", airline })).cabins;
  }

  searchOtherAirlineSchedule(query) {
    return this.myidtravel({ ...query, action: "schedule" });
  }

  otherAirlineDetails(query, segments) {
    return this.myidtravel({ ...query, segments, action: "details" });
  }

  async restorePorter() {
    await this.goto("https://www.flyporter.com/en-ca/staff/searchflight");
    await this.page.waitForFunction(
      () => location.origin === "https://www.flyporter.com" &&
        location.pathname === "/en-ca/staff/searchflight" &&
        Boolean(document.querySelector("#booking-widget #departureCity")) &&
        !document.querySelector('input[type="password"]'),
      undefined,
      { timeout: this.timeoutMs },
    );
    this.otherAirlineActive = false;
  }

  async goto(url) {
    let response;
    try {
      response = await this.page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.timeoutMs,
      });
      await this.waitForChallengeToClear();
    } catch (cause) {
      if (cause instanceof CloudflareChallengeError) throw cause;
      throw new RemoteResponseError(`Chrome navigation failed for ${new URL(url).pathname}.`, { cause });
    }

    return new BrowserResponse({
      url: this.page.url(),
      status: response?.status() ?? 200,
      headers: response ? await response.allHeaders() : {},
      body: await this.page.content(),
    });
  }

  async request(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    if (method === "GET") return this.goto(String(url));

    await this.waitForChallengeToClear();
    const input = {
      url: String(url),
      method,
      headers: sanitizeBrowserHeaders(options.headers),
      body: serializeBody(options.body),
    };

    let result;
    try {
      result = await this.page.evaluate(async (request) => {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          credentials: "include",
          redirect: "follow",
        });
        return {
          url: response.url,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text(),
        };
      }, input);
    } catch (cause) {
      throw new RemoteResponseError(`Chrome XHR failed for ${new URL(url).pathname}.`, { cause });
    }
    return new BrowserResponse(result);
  }

  async keepAlive(url = "https://www.flyporter.com/en-ca/staff") {
    const result = await this.page.evaluate(async (target) => {
      const response = await fetch(target, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        headers: { accept: "text/html,application/xhtml+xml" },
      });
      await response.text();
      return { url: response.url, status: response.status };
    }, url);
    return result;
  }

  async getStaffSearchHtml({ timeoutMs = 20_000 } = {}) {
    await this.page
      .waitForFunction(
        () =>
          Boolean(
            document.querySelector(
              'form[action*="/staff/select"], input[name="chkPassengers"], input[name="SearchType"]',
            ),
          ),
        undefined,
        { timeout: timeoutMs },
      )
      .catch(() => {});
    return this.page.content();
  }

  async searchStaffAvailability({
    origin,
    destination,
    date,
    searchPageUrl = "https://www.flyporter.com/en-ca/staff/searchflight",
  }) {
    await this.goto(searchPageUrl);
    const currentPath = new URL(this.page.url()).pathname.toLowerCase();
    if (currentPath.includes("/login") || currentPath.includes("/viporter/sign-in")) {
      return new BrowserResponse({
        url: this.page.url(),
        status: 401,
        body: "",
      });
    }

    try {
      await this.page.waitForFunction(
        () => {
          const widget = document.querySelector("#booking-widget");
          const vm = globalThis.ko?.dataFor(widget);
          if (!vm?.datePicker || !vm?.setSelectedLocationFrom || !vm?.submit) return false;
          const currentUser = typeof vm.stCurrentUser === "function" ? vm.stCurrentUser() : null;
          return Boolean(
            widget.querySelector('input[name="checkbox"]') ||
              currentUser?.CustomerNumber ||
              currentUser?.customerNumber,
          );
        },
        undefined,
        { timeout: 30_000 },
      );
    } catch (cause) {
      throw new RemoteResponseError(
        "The Porter staff booking widget did not finish loading.",
        { cause },
      );
    }

    const responsePromise = this.page.waitForResponse(
      (response) => response.url().includes("/flight/GetFlightAvailabilityStaffTravel"),
      { timeout: this.timeoutMs },
    );

    try {
      await this.page.evaluate(
        async ({ from, to, departureDate }) => {
          const widget = document.querySelector("#booking-widget");
          const vm = globalThis.ko.dataFor(widget);
          vm.changeFlightTypeTrigger(vm.CONST.FLIGHT_TYPE_ONE_WAY);
          vm.setSelectedLocationFrom(from);
          vm.setSelectedLocationTo(to);

          const currentUser = typeof vm.stCurrentUser === "function" ? vm.stCurrentUser() : null;
          const customerNumber =
            widget.querySelector('input[name="checkbox"]')?.value ||
            currentUser?.CustomerNumber ||
            currentUser?.customerNumber;
          if (!customerNumber) throw new Error("No eligible staff passenger was available.");

          if (typeof vm.selectedPassengers === "function") {
            vm.selectedPassengers([customerNumber]);
          }
          if (typeof vm.selectedStaffNumbers === "function") {
            vm.selectedStaffNumbers(customerNumber);
          }

          await new Promise((resolve) => {
            vm.datePicker.setState(
              {
                startDate: globalThis.moment(departureDate),
                endDate: null,
                isRoundTrip: false,
              },
              resolve,
            );
          });
          vm.submit();
        },
        { from: origin, to: destination, departureDate: date },
      );
    } catch (cause) {
      responsePromise.catch(() => {});
      throw new RemoteResponseError("The Porter staff booking widget could not submit the search.", {
        cause,
      });
    }

    let response;
    try {
      response = await responsePromise;
    } catch (cause) {
      throw new RemoteResponseError(
        "Porter did not return a staff availability response before the search timed out.",
        { cause },
      );
    }

    return new BrowserResponse({
      url: response.url(),
      status: response.status(),
      headers: await response.allHeaders(),
      body: await response.text(),
    });
  }

  async waitForChallengeToClear() {
    const deadline = Date.now() + this.timeoutMs;
    while (await isChallengePage(this.page)) {
      if (Date.now() >= deadline) throw new CloudflareChallengeError();
      await this.page.waitForTimeout(500);
    }
  }

  async close() {
    if (this.owner) {
      await this.connection?.close().catch(() => {});
      if (this.browserProcess && this.browserProcess.exitCode === null) {
        this.browserProcess.kill("SIGTERM");
      }
      return;
    }
    if (this.attachedPage && !this.page.isClosed()) await this.page.close();
    // For connectOverCDP(), Browser.close() disconnects this Playwright client
    // without terminating the externally launched Chrome process.
    await this.connection?.close().catch(() => {});
  }
}

export class BrowserResponse {
  constructor({ url, status, headers = {}, body = "" }) {
    this.url = url;
    this.status = status;
    this.headers = createSafeResponseHeaders(headers);
    this.body = body;
    this.ok = status >= 200 && status < 300;
  }

  async text() {
    return this.body;
  }

  async json() {
    return JSON.parse(this.body);
  }

  clone() {
    return new BrowserResponse({
      url: this.url,
      status: this.status,
      headers: Object.fromEntries(this.headers.entries()),
      body: this.body,
    });
  }
}

function createSafeResponseHeaders(input) {
  const headers = new Headers();
  const entries = input instanceof Headers ? input.entries() : Object.entries(input);
  for (const [name, rawValue] of entries) {
    // Chrome owns and persists response cookies. Exposing Set-Cookie through
    // the Fetch Headers API is unnecessary, and Playwright may combine
    // multiple values with newlines, which the API correctly rejects.
    if (name.toLowerCase() === "set-cookie") continue;
    const value = String(rawValue).replace(/[\r\n]+/g, ", ");
    headers.append(name, value);
  }
  return headers;
}

export function getDefaultChromeProfilePath({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  if (env.FLYPORTER_CHROME_PROFILE) return path.resolve(env.FLYPORTER_CHROME_PROFILE);
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "flyporter", "chrome-profile");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "flyporter", "chrome-profile");
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "flyporter", "chrome-profile");
}

export function getChromeDebugPort(env = process.env) {
  const value = Number(env.FLYPORTER_CHROME_DEBUG_PORT || DEFAULT_CDP_PORT);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : DEFAULT_CDP_PORT;
}

export async function findChromeExecutable({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const candidates = env.FLYPORTER_CHROME_PATH
    ? [env.FLYPORTER_CHROME_PATH]
    : platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ]
      : platform === "win32"
        ? [
            path.join(env.PROGRAMFILES || "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
            path.join(
              env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
              "Google/Chrome/Application/chrome.exe",
            ),
            path.join(
              env.LOCALAPPDATA || path.join(home, "AppData/Local"),
              "Google/Chrome/Application/chrome.exe",
            ),
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next platform-specific location.
    }
  }
  throw new AuthenticationError(
    "Google Chrome was not found. Install Chrome or set FLYPORTER_CHROME_PATH.",
  );
}

function selectPage(pages) {
  return pages.find((page) => page.url().includes("flyporter.com")) || pages[0];
}

function serializeBody(body) {
  if (body === undefined || body === null) return undefined;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof body === "string") return body;
  throw new TypeError("Chrome request bodies must be strings or URLSearchParams.");
}

function sanitizeBrowserHeaders(input) {
  const headers = new Headers(input);
  for (const name of ["host", "origin", "referer", "user-agent", "cookie", "content-length"]) {
    headers.delete(name);
  }
  return Object.fromEntries(headers.entries());
}

async function isChallengePage(page) {
  if (page.url().includes("/cdn-cgi/challenge-platform/")) return true;
  return page
    .evaluate(() => {
      const content = `${document.title || ""}\n${document.body?.innerText?.slice(0, 1200) || ""}`;
      return /just a moment|verify you are human|performing security verification/i.test(content);
    })
    .catch(() => false);
}

async function waitForDebugEndpoint(port, browserProcess, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 15_000);
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error(`Chrome exited with code ${browserProcess.exitCode}.`);
    }
    try {
      const response = await fetch(endpoint);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome debugging endpoint did not open on port ${port}.`);
}
