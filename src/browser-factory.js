// @ts-check
import { ChromeBrowser } from "./browser.js";
import { authenticateInteractively } from "./auth.js";
import { openBapSession } from "./bap-session.js";

export async function openBrowser(backend, purpose, config, stderr) {
  if (backend === "bap") return openBapSession(config, stderr);
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
  return backend === "bap"
    ? browser.authenticate(options)
    : authenticateInteractively(browser, options);
}
