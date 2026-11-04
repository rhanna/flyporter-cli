import { AuthenticationError, SessionExpiredError } from "./errors.js";

const STAFF_URL = "https://www.flyporter.com/en-ca/staff";

export async function authenticateInteractively(
  browser,
  { timeoutMs = 10 * 60 * 1000, onWaiting = () => {} } = {},
) {
  await browser.goto(STAFF_URL);
  if (isStaffUrl(browser.page.url())) return { authenticated: true };

  onWaiting();
  try {
    await browser.page.waitForURL((url) => isStaffUrl(url.href), {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    });
    await browser.waitForChallengeToClear();
  } catch (cause) {
    throw new AuthenticationError(
      "Interactive authentication did not reach the Porter staff page before timing out.",
      { cause },
    );
  }
  return { authenticated: true };
}

export async function verifyKeepAliveResult(result) {
  if (!result || !isStaffUrl(result.url)) {
    throw new SessionExpiredError(
      "The Porter session expired. Authentication is required again.",
    );
  }
  if (result.status < 200 || result.status >= 400) {
    throw new AuthenticationError(`Porter keep-alive failed with HTTP ${result.status}.`);
  }
  return true;
}

export function isStaffUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname === "/en-ca/staff" || pathname.startsWith("/en-ca/staff/");
  } catch {
    return false;
  }
}
