import { setTimeout as sleep } from "node:timers/promises";
import { verifyKeepAliveResult } from "./auth.js";

export async function runKeepAlive(
  browser,
  {
    intervalMs = 4 * 60 * 1000,
    signal,
    onHeartbeat = () => {},
    onExpired = () => {},
    reauthenticate,
  } = {},
) {
  while (!signal?.aborted) {
    try {
      const result = await browser.keepAlive();
      await verifyKeepAliveResult(result);
      onHeartbeat(result);
    } catch (error) {
      onExpired(error);
      if (!reauthenticate) throw error;
      await reauthenticate(error);
      continue;
    }

    try {
      await sleep(intervalMs, undefined, { signal });
    } catch (error) {
      if (error.name === "AbortError") return;
      throw error;
    }
  }
}
