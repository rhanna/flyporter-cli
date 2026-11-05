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

## Self-hosted CDP Behavior

- `--browser browserless-cdp` adds a third backend; BAP remains default. Connect through
  `playwright-core` to `BROWSERLESS_CDP_ENDPOINT`; never discover or launch local Chrome.
- `BROWSERLESS_CDP_PUBLIC_URL` is the public debugger base; `BROWSERLESS_CDP_TOKEN` falls back to
  the existing Browserless token aliases. Endpoints must be credential-free URLs without queries.
- One owned page/browser spans login, heartbeats and searches. Browserless free Chromium
  `v2.58.1` is the source-reviewed deployment example; no Enterprise CDP extensions are required.
- CDP launch uses supported `launch` JSON with `headless:false` by default. The image's Xvfb
  supplies a display. `BROWSERLESS_CDP_HEADLESS=true` restores headless mode in a separate scope.
- Viewer auto-selection uses native Chrome for loopback HTTP public URLs and the web viewer
  otherwise. `BROWSERLESS_CDP_VIEWER=chrome|web|auto` overrides it; forced Chrome requires loopback
  HTTP. Native links use 127.0.0.1 and include authentication only inside encoded `ws`.
- Shared `src/resident-session.js` owns restricted state, locks, IPC and serial queues for BAP/CDP.
  Backend-specific hashed scopes prevent cross-backend session access. CDP requires a resident;
  searches do not create a new browser or retain disconnected sessions.
- Shutdown sends CDP `Browser.close` and disconnects; partial initialization attempts the same.
  Lost transports terminate the workflow without replaying searches. No cookies are exported.

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
