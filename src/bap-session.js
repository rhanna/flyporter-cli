// @ts-check
import { BapBrowser } from "./bap-browser.js";
import { createReporter } from "./diagnostics.js";
import { RemoteResponseError } from "./errors.js";
import { SessionStore } from "./resident-session.js";
export {
  SessionStore,
  serialQueue,
  startResident,
  residentSearch,
} from "./resident-session.js";

export async function openBapSession(
  config,
  stderr,
  { store = new SessionStore(config.stateDir), open = BapBrowser.open } = {},
) {
  const unlock = await store.lock();
  let browser;
  let report;
  try {
    report = await createReporter(config, () => browser?.page, stderr);
    const saved = await store.read("reconnect.json");
    await store.remove("reconnect.json");
    let endpoint;
    if (saved?.expiresAt > Date.now()) {
      try {
        const candidate = new URL(saved.endpoint);
        const base = new URL(config.endpoint);
        if (
          candidate.protocol === "wss:" &&
          candidate.host === base.host &&
          // Browserless may prefix reconnect routes with an encrypted /e/... path.
          candidate.pathname.includes(`${base.pathname}/`) &&
          !candidate.username &&
          !candidate.password &&
          !candidate.search &&
          !candidate.hash
        )
          endpoint = candidate.href;
      } catch {
        await report.event("invalid-session-reference", {
          action: "fresh-session",
        });
      }
    }
    if (endpoint) {
      try {
        browser = await open(config, report, endpoint);
        await report.event("session-resumed");
      } catch {
        await report.event("session-expired", { action: "fresh-session" });
      }
    }
    if (!browser) browser = await open(config, report);
    return {
      browser,
      report,
      store,
      async finish(success, { retain = true } = {}) {
        let failure;
        try {
          if (browser.closed) {
            // Signal/duration shutdown already closed the disarmed transport.
            await store.remove("reconnect.json");
          } else if (success && retain && config.reconnectTimeout > 0) {
            const endpoint = await browser.retain(config.reconnectTimeout);
            await store.write("reconnect.json", {
              endpoint,
              expiresAt: Date.now() + config.reconnectTimeout,
            });
            await report.event("session-retained", {
              timeoutMs: config.reconnectTimeout,
            });
          } else {
            await store.remove("reconnect.json");
            // Disarm a reconnect grace period inherited from an earlier invocation.
            await browser.page.reconnect({ timeout: 0 });
          }
        } catch (error) {
          failure = error;
          await store.remove("reconnect.json");
          try {
            await browser.page.reconnect({ timeout: 0 });
          } catch {
            /* close below is still mandatory */
          }
        } finally {
          try {
            await browser.close();
          } catch (error) {
            failure ||= error;
          }
          await unlock();
        }
        if (failure)
          throw new RemoteResponseError("Browserless session release failed.", {
            cause: failure,
          });
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
