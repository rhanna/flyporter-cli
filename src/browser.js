import fetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";
import { CloudflareChallengeError, RemoteResponseError } from "./errors.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

  serializeSession() {
    throw new Error("Browser.serializeSession() must be implemented");
  }
}

export class FetchCookieBrowser extends Browser {
  constructor({ jar = new CookieJar(), fetchImpl = globalThis.fetch, userAgent = DEFAULT_USER_AGENT } = {}) {
    super();
    this.jar = jar;
    this.fetch = fetchCookie(fetchImpl, jar);
    this.userAgent = userAgent;
  }

  static fromSession(session, options = {}) {
    const serializedJar = session?.cookieJar;
    const jar = serializedJar ? CookieJar.fromJSON(serializedJar) : new CookieJar();
    return new FetchCookieBrowser({ ...options, jar });
  }

  async request(url, options = {}) {
    const headers = new Headers(options.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", this.userAgent);
    if (!headers.has("accept-language")) headers.set("accept-language", "en-CA,en;q=0.9");
    if (!headers.has("accept")) headers.set("accept", "*/*");

    let response;
    try {
      response = await this.fetch(url, { redirect: "follow", ...options, headers });
    } catch (cause) {
      throw new RemoteResponseError(`Network request failed for ${new URL(url).pathname}.`, { cause });
    }

    await assertNotCloudflareChallenge(response);
    return response;
  }

  serializeSession() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      cookieJar: this.jar.toJSON(),
    };
  }
}

export async function assertNotCloudflareChallenge(response) {
  const mitigated = response.headers.get("cf-mitigated");
  const server = response.headers.get("server")?.toLowerCase();
  const potentiallyChallenged =
    mitigated === "challenge" ||
    ((response.status === 403 || response.status === 503) && server?.includes("cloudflare"));

  if (!potentiallyChallenged) return;

  const body = await response.clone().text();
  if (
    mitigated === "challenge" ||
    /just a moment|verify you are human|challenge-platform|cf-chl-/i.test(body)
  ) {
    throw new CloudflareChallengeError();
  }
}
