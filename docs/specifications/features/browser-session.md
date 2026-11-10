# Browser Session Spec

## Responsibility

Own backend selection, BAP lifecycle and local Chrome discovery, profile configuration, CDP attachment, browser-side
requests, challenge waiting, and cleanup in [src/browser.js](../../../src/browser.js).
Existing coverage: [browser tests](../../../test/browser.test.js).

## BAP Behavior

- BAP is the default; `--browser local` overrides `FLYPORTER_BROWSER` and the default.
- `src/bap-browser.js` owns actual SDK operations; `src/browser-factory.js` selects the adapter.
  Shared orchestration does not assume BAP is Playwright-compatible.
- One remote page/session spans login and search. Configure the token, endpoint, credentials,
  selectors and timeouts through the environment; aliases are documented in `.env.example`.
- Standalone success retains the remote session for `BAP_RECONNECT_TIMEOUT_MS` (60000 by default).
  Zero disables retention. Reconnect endpoint/expiry are cached with mode 0600 in an account-scoped
  0700 directory under `~/.config/flyporter`, configurable with `FLYPORTER_STATE_DIR`.
- Session access is locked. Dead process locks can be recovered. Expired/unavailable reconnects
  use a fresh session; authentication is checked again. No cookies or account credentials are cached.
- A resident BAP process owns its page. Authenticated local IPC carries searches from other CLI
  calls; searches and heartbeat/reauthentication operations are serialized.
- All SDK connections attempt closure, including errors and partial initialization. Failed and
  resident workflows disarm retention; successful standalone workflows retain only the configured TTL.
- Browserless retention and Porter expiry are independent, and idle retention/reconnections bill.
  Provider absolute session limits cannot be extended by heartbeats.

## Remote Chromium Behavior

- `--browser remote-chromium` replaces `browserless-cdp`; BAP remains default and local behavior
  is unchanged. The removed name produces migration instructions, never an implicit fallback.
- `REMOTE_CHROMIUM_ENDPOINT` is a private HTTP(S) CDP base or browser-level WebSocket URL;
  `REMOTE_CHROMIUM_DESKTOP_URL` is a user-reachable HTTP(S) desktop. Both are required and
  reject embedded credentials, queries and fragments. Page-target endpoints are rejected.
- `src/remote-chromium-browser.js` attaches through Playwright to the existing default context,
  creating one command-owned tab. It never launches a browser or creates an isolated context.
- HTTP discovery reads `/json/version`, validates its browser path and rewrites it through the
  configured endpoint authority for Docker/SSH forwarding. HTTP uses native Node HTTP with
  Host: localhost because native fetch can discard that override; the private ws handshake also
  sends Host: localhost. HTTPS/WSS retain the configured host for private TLS proxy routing.
  HTTP discovery is abortable, rejects responses above 64 KiB and never follows redirects.
- Coolify deployment uses `jlesage/chromium:v26.08.2`, persistent `/config`, automatic restart,
  a protected HTTPS desktop on upstream port 5800, and private CDP on port 9222.
- Authentication initializes the staff landing page before searchflight. Only a visible staff
  booking link or search controls confirms login; path-only matches do not skip credential checks.
- Standalone searches authenticate and run without a resident. Optional foreground keep-alive
  shares restricted local IPC and a serial queue; searches reuse that resident when available.
- State is scoped by backend and endpoint, independent of credentials/desktop URL. Local locks
  prevent concurrent owners; endpoint aliases and other machines are not coordinated.
- Shutdown aborts polling, bounds owned-tab cleanup to five seconds and disconnects Playwright
  even after partial initialization/tab-close failure. A last owned tab is blanked rather than
  closed to avoid exiting headed Chromium. It never sends CDP Browser.close or
  terminates Chromium. Other tabs and the remote profile remain browser-owned; no cookie export.
- No Browserless tokens, launch options, discovery APIs or DevTools handoff links are used.

## Local Chrome Behavior

- Launch normal Chrome with a dedicated user-data directory and remote debugging port,
  without Playwright's automation launch flags. Default CLI launch is visible.
- Discover Chrome from platform-specific locations, or use `FLYPORTER_CHROME_PATH` exclusively
  when set. Missing Chrome raises an authentication error.
- `FLYPORTER_CHROME_PROFILE` overrides the profile and resolves relative paths to absolute paths.
  Defaults are `~/Library/Application Support/flyporter/chrome-profile` on macOS,
  `%LOCALAPPDATA%/flyporter/chrome-profile` on Windows (with a home/AppData/Local fallback),
  and `$XDG_CONFIG_HOME/flyporter/chrome-profile` elsewhere (with a ~/.config fallback).
- `FLYPORTER_CHROME_DEBUG_PORT` accepts integers 1–65535; invalid values fall back to 9223.
  Clients attach at `http://127.0.0.1:<port>`.
- `connect` returns null when CDP is unavailable or has no context, otherwise creates a new tab.
  `connectOrLaunch` launches on null; `connectRequired` raises an authentication error on null.
  Attachment itself does not verify a Porter login.
- Default browser timeout is five minutes. Startup endpoint polling is capped at 15 seconds;
  launch CDP connection uses five seconds, and attachment uses 1.5 seconds.
- GET navigates the current page. Other requests use page-side fetch with credentials included
  and redirects followed. Bodies accept strings, URLSearchParams, or no body.
- Strip host, origin, referer, user-agent, cookie, and content-length headers from generic
  request inputs so Chrome supplies browser-controlled values.
- Wait for recognized challenge URL/title/body markers to clear, polling every 500 ms;
  timeout raises `CloudflareChallengeError`. No automated challenge bypass is implemented.
- Closing an owned browser disconnects and terminates the spawned process.
  Closing an attached browser closes its new tab and disconnects the client, preserving Chrome.

## Data Model

- `Browser` provides request/get/post/close; `ChromeBrowser` adds navigation, keep-alive,
  staff HTML and native availability operations.
- `BrowserResponse` exposes url, status, headers, body, a 2xx-only ok flag, text(), json(),
  and clone(). Set-Cookie is omitted and other header newlines are normalized.
- Chrome owns profile and cookie state. There is no application cookie export or cookie jar.

## Known Risks

- Profile files and the local debugging endpoint provide access to authenticated browser state.
- A persistent profile does not guarantee session-only cookies survive browser termination.
- A configured port can point to an unrelated Chrome session; attachment uses its first context.
- Local challenge detection is heuristic; BAP solver failure/unknown outcomes stop the workflow.
- Cleanup catches disconnect failures; it is not a guarantee of successful remote termination.

## Other-airline adapter operations

All adapters expose separate SSO, cabin discovery, schedule, detail and Porter restoration methods.
Playwright and BAP evaluations run the same self-contained browser-side request/projection function.
The account holder and dynamic R2/carrier cabin choices come from site state and traveller-selection
responses. Browser-owned session values never enter output. Access diagnostics are suppressed on
myIDTravel pages. See [other-airline search](other-airline-search.md) and the
[architecture contract](../../architecture/other-airline.md).
