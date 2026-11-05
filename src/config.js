// @ts-check
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ValidationError } from "./errors.js";

export function selectBackend(value = process.env.FLYPORTER_BROWSER || "bap") {
  if (!["local", "bap", "browserless-cdp"].includes(value)) {
    throw new ValidationError("Browser must be local, bap or browserless-cdp.");
  }
  return value;
}

export function loadCdpConfig(env = process.env) {
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
  const endpoint = url("BROWSERLESS_CDP_ENDPOINT", ["ws:", "wss:"]);
  if (endpoint.pathname.includes("/devtools/")) {
    throw new ValidationError(
      "BROWSERLESS_CDP_ENDPOINT must create a new browser (root, /chromium or /chrome), not attach to an existing DevTools target.",
    );
  }
  const publicUrl = url("BROWSERLESS_CDP_PUBLIC_URL", ["http:", "https:"]);
  const headless =
    env.BROWSERLESS_CDP_HEADLESS?.trim().toLowerCase() || "false";
  if (!["0", "1", "false", "true"].includes(headless)) {
    throw new ValidationError(
      "BROWSERLESS_CDP_HEADLESS must be 0, 1, false or true.",
    );
  }
  const viewer = env.BROWSERLESS_CDP_VIEWER || "auto";
  const localViewer =
    publicUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(publicUrl.hostname);
  if (
    !["auto", "chrome", "web"].includes(viewer) ||
    (viewer === "chrome" && !localViewer)
  ) {
    throw new ValidationError(
      "BROWSERLESS_CDP_VIEWER must be auto, web or chrome (chrome requires an HTTP localhost/127.0.0.1 public URL).",
    );
  }
  const token =
    env.BROWSERLESS_CDP_TOKEN ||
    env.BROWSERLESS_TOKEN ||
    env.BROWSERLESS_API_TOKEN;
  if (!token?.trim())
    throw new ValidationError(
      "Missing BROWSERLESS_CDP_TOKEN; configure it in .env.",
    );
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
  const scope = createHash("sha256")
    .update(
      JSON.stringify([
        "browserless-cdp",
        endpoint.href,
        publicUrl.href,
        token,
        username || "interactive",
        ["1", "true"].includes(headless),
      ]),
    )
    .digest("hex")
    .slice(0, 16);
  return {
    backend: "browserless-cdp",
    token,
    username,
    password,
    endpoint: endpoint.href,
    publicUrl: publicUrl.href,
    headless: ["1", "true"].includes(headless),
    viewer: viewer === "auto" ? (localViewer ? "chrome" : "web") : viewer,
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
