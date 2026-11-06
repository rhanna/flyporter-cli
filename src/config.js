// @ts-check
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ValidationError } from "./errors.js";

export function selectBackend(value = process.env.FLYPORTER_BROWSER || "bap") {
  if (value === "browserless-cdp") {
    throw new ValidationError(
      "browserless-cdp was replaced by remote-chromium. Configure REMOTE_CHROMIUM_ENDPOINT and REMOTE_CHROMIUM_DESKTOP_URL; Browserless CDP settings are no longer used.",
    );
  }
  if (!["local", "bap", "remote-chromium"].includes(value)) {
    throw new ValidationError("Browser must be local, bap or remote-chromium.");
  }
  return value;
}

export function loadRemoteChromiumConfig(env = process.env) {
  const url = (key, protocols) => {
    try {
      const value = new URL(env[key]);
      if (
        !protocols.includes(value.protocol) ||
        value.username ||
        value.password ||
        value.search ||
        value.hash
      )
        throw new Error();
      return value;
    } catch {
      throw new ValidationError(
        `${key} must be a credential-free ${protocols.join("/")} URL without query or fragment.`,
      );
    }
  };
  const endpoint = url("REMOTE_CHROMIUM_ENDPOINT", [
    "http:",
    "https:",
    "ws:",
    "wss:",
  ]);
  const websocket = ["ws:", "wss:"].includes(endpoint.protocol);
  if (
    (websocket &&
      !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(endpoint.pathname)) ||
    (!websocket && endpoint.pathname.includes("/devtools/"))
  ) {
    throw new ValidationError(
      "REMOTE_CHROMIUM_ENDPOINT must be an HTTP CDP base URL or a browser-level /devtools/browser/<id> WebSocket URL, never a page target.",
    );
  }
  if (!websocket) endpoint.pathname = endpoint.pathname.replace(/\/$/, "");
  const desktopUrl = url("REMOTE_CHROMIUM_DESKTOP_URL", ["http:", "https:"]);
  const first = (...keys) =>
    keys.map((key) => env[key]).find((value) => value?.trim());
  const username = first("PORTER_USERNAME", "FLYPORTER_USERNAME", "USERNAME");
  const password = first("PORTER_PASSWORD", "FLYPORTER_PASSWORD", "PASSWORD");
  if (Boolean(username) !== Boolean(password)) {
    throw new ValidationError(
      "Configure both Porter username and password, or neither for interactive login.",
    );
  }
  const debug = env.FLYPORTER_DEBUG?.trim().toLowerCase() || "0";
  if (!["0", "1", "false", "true"].includes(debug)) {
    throw new ValidationError("FLYPORTER_DEBUG must be 0, 1, false or true.");
  }
  // A persistent endpoint has one profile/account: credential changes must not bypass its lock.
  const scope = createHash("sha256")
    .update(JSON.stringify(["remote-chromium", endpoint.href]))
    .digest("hex")
    .slice(0, 16);
  return {
    backend: "remote-chromium",
    username,
    password,
    endpoint: endpoint.href,
    desktopUrl: desktopUrl.href,
    timeout: 60000,
    authTimeout: 600000,
    debug: ["1", "true"].includes(debug),
    artifactsDir: path.resolve(env.ARTIFACTS_DIR || "artifacts"),
    stateDir: path.join(
      env.FLYPORTER_STATE_DIR ||
        path.join(os.homedir(), ".config", "flyporter"),
      scope,
    ),
  };
}

export function loadBapConfig(env = process.env) {
  const required = (...keys) => {
    const value = keys.map((key) => env[key]).find((value) => value?.trim());
    if (!value)
      throw new ValidationError(`Missing ${keys[0]}; configure it in .env.`);
    return value;
  };
  const integer = (key, fallback, min = 1) => {
    const value = Number(env[key] || fallback);
    if (!Number.isSafeInteger(value) || value < min) {
      throw new ValidationError(`${key} must be an integer >= ${min}.`);
    }
    return value;
  };
  const debug = env.FLYPORTER_DEBUG?.trim().toLowerCase() || "0";
  if (!["0", "1", "false", "true"].includes(debug)) {
    throw new ValidationError("FLYPORTER_DEBUG must be 0, 1, false or true.");
  }
  const token = required("BROWSERLESS_TOKEN", "BROWSERLESS_API_TOKEN");
  const username = required(
    "PORTER_USERNAME",
    "FLYPORTER_USERNAME",
    "USERNAME",
  );
  const password = required(
    "PORTER_PASSWORD",
    "FLYPORTER_PASSWORD",
    "PASSWORD",
  );
  let endpoint;
  try {
    endpoint = new URL(
      env.BROWSERLESS_ENDPOINT ||
        "wss://production-sfo.browserless.io/stealth/bql",
    );
  } catch {
    throw new ValidationError("Invalid BROWSERLESS_ENDPOINT.");
  }
  if (
    endpoint.protocol !== "wss:" ||
    !endpoint.pathname.endsWith("/bql") ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new ValidationError(
      "BROWSERLESS_ENDPOINT must be a credential-free wss:// URL ending in /bql.",
    );
  }
  const selectors = {
    username: "#txtVIPorterUsername",
    password: "#txtVIPorterPassword",
    "login-submit": '[id="8_SubmitLogin"]',
    "one-way": undefined,
    origin: "#departureCity",
    destination: "#arrivalCty",
    "departure-date":
      "#bookingWidgetDateRangePickerStart, #bookingWidgetSingleDatePicker",
    "search-submit": "#submitFlighSearch",
  };
  for (const key of Object.keys(selectors)) {
    selectors[key] =
      env[`PORTER_${key.toUpperCase().replaceAll("-", "_")}_SELECTOR`] ||
      selectors[key];
  }
  const dateFormat = env.PORTER_DATE_FORMAT || "MM/DD/YYYY";
  if (!["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"].includes(dateFormat)) {
    throw new ValidationError("Unsupported PORTER_DATE_FORMAT.");
  }
  // Separate cached sessions by account, token and endpoint without storing those secrets.
  const scope = createHash("sha256")
    .update(JSON.stringify([endpoint.href, token, username]))
    .digest("hex")
    .slice(0, 16);
  return {
    token,
    username,
    password,
    endpoint: endpoint.href,
    selectors,
    dateFormat,
    scope,
    debug: debug === "1" || debug === "true",
    timeout: integer("BAP_TIMEOUT_MS", 60000),
    captchaTimeout: integer("BAP_CAPTCHA_TIMEOUT_MS", 10000),
    reconnectTimeout: integer("BAP_RECONNECT_TIMEOUT_MS", 60000, 0),
    passengerSelector:
      env.PORTER_PASSENGER_SELECTOR || 'input[name="checkbox"]',
    originOption: env.PORTER_ORIGIN_OPTION_SELECTOR,
    destinationOption: env.PORTER_DESTINATION_OPTION_SELECTOR,
    resultsSelector: env.PORTER_RESULTS_SELECTOR || "",
    artifactsDir: path.resolve(env.ARTIFACTS_DIR || "artifacts"),
    stateDir: path.join(
      env.FLYPORTER_STATE_DIR ||
        path.join(os.homedir(), ".config", "flyporter"),
      scope,
    ),
  };
}

export function redact(value, secrets = []) {
  let text = String(value);
  for (const secret of [...secrets]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    for (const variant of [
      secret,
      JSON.stringify(secret).slice(1, -1),
      encodeURIComponent(secret),
    ]) {
      text = text.replaceAll(variant, "[REDACTED]");
    }
  }
  return text.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/g, (url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname.includes("/bql/") ? "/bql/[REDACTED]" : parsed.pathname}`;
    } catch {
      return "[REDACTED URL]";
    }
  });
}

export function formatDate(iso, format) {
  const [year, month, day] = iso.split("-");
  return format.replace("YYYY", year).replace("MM", month).replace("DD", day);
}
