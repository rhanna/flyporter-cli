// @ts-check
import { ChromeBrowser } from "./browser.js";
import { authenticateInteractively } from "./auth.js";
import { openBapSession } from "./bap-session.js";
import { openCdpSession } from "./cdp-browser.js";

export async function openBrowser(backend, purpose, config, stderr) {
  if (backend === "bap") return openBapSession(config, stderr);
  if (backend === "browserless-cdp") return openCdpSession(config, stderr);
  const browser =
    purpose === "search"
      ? await ChromeBrowser.connectRequired()
      : purpose === "auth"
        ? await ChromeBrowser.launch()
        : await ChromeBrowser.connectOrLaunch();
  return {
    browser,
    async finish() {
      await browser.close();
    },
  };
}

export function authenticateBrowser(backend, browser, options) {
  return backend !== "local"
    ? browser.authenticate(options)
    : authenticateInteractively(browser, options);
}
