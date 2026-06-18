import { AuthenticationError, SessionExpiredError } from "./errors.js";
import { extractVerificationToken } from "./html.js";

const BASE_URL = "https://www.flyporter.com";
const LOGIN_URL = `${BASE_URL}/en-ca/login?ReturnUrl=%2Fen-ca%2Fstaff`;
const SIGN_IN_URL = `${BASE_URL}/en-ca/login/sign-in?isTravelAgent=False`;
const STAFF_URL = `${BASE_URL}/en-ca/staff`;

export async function authenticate(browser, { username, password }) {
  if (!username || !password) {
    throw new AuthenticationError(
      "Username and password are required. Use --username/--password or FLYPORTER_USERNAME/FLYPORTER_PASSWORD.",
    );
  }

  const loginResponse = await browser.get(LOGIN_URL, {
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  const loginHtml = await loginResponse.text();
  const token = extractVerificationToken(loginHtml);

  const body = new URLSearchParams({
    __RequestVerificationToken: token,
    VIPorterNumberOrEmailOrUsername: username,
    Password: password,
    LoginButton: "Sign In",
  });

  const response = await browser.post(SIGN_IN_URL, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "content-type": "application/x-www-form-urlencoded",
      origin: BASE_URL,
      referer: LOGIN_URL,
    },
    body,
  });

  if (!isStaffUrl(response.url)) {
    const bodyText = await response.text();
    const detail = extractLoginError(bodyText);
    throw new AuthenticationError(detail || "Porter rejected the supplied credentials.");
  }

  await verifyAuthenticatedResponse(response);
  return { authenticated: true, username };
}

export async function verifyAuthenticated(browser) {
  const response = await browser.get(STAFF_URL, {
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  await verifyAuthenticatedResponse(response);
  return true;
}

async function verifyAuthenticatedResponse(response) {
  if (!isStaffUrl(response.url) || response.url.includes("/login")) {
    throw new SessionExpiredError();
  }
  if (!response.ok) {
    throw new AuthenticationError(`Porter staff access failed with HTTP ${response.status}.`);
  }
}

function isStaffUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().startsWith("/en-ca/staff");
  } catch {
    return false;
  }
}

function extractLoginError(html) {
  const match = html.match(
    /<(?:div|span)[^>]+(?:validation-summary-errors|field-validation-error)[^>]*>([\s\S]*?)<\/(?:div|span)>/i,
  );
  return match?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
