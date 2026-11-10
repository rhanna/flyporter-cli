// @ts-check
import { RemoteResponseError } from "./errors.js";
import { myidtravelOperation } from "./myidtravel-controls.js";

export function parseMyidtravelResult(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RemoteResponseError("Invalid myIDTravel browser response.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RemoteResponseError("Invalid myIDTravel browser response.");
  if (value.error)
    throw new RemoteResponseError("myIDTravel browser operation failed.", {
      code: value.error.code,
    });
  return value;
}

// Adapter methods own navigation/evaluation. Shared orchestration never accesses raw page APIs.
export async function waitMyidtravelReady(browser, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await browser.myidtravel({ action: "ready" })).ready) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new RemoteResponseError("myIDTravel account controls did not load.");
}

export function myidtravelExpression(args) {
  return `(${myidtravelOperation.toString()})(${JSON.stringify(args)})`;
}
