# Browser Session Spec

## Responsibility

Own Chrome discovery, dedicated profile configuration, local CDP attachment, browser-side
requests, challenge waiting, and cleanup in [src/browser.js](../../../src/browser.js).
Existing coverage: [browser tests](../../../test/browser.test.js).

## Behavior

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
- Challenge detection is heuristic. The error's legacy wording mentions fetch-only sessions
  and session import, but the current CLI exposes neither workflow.
- Cleanup catches disconnect failures; it is not a guarantee of successful remote termination.
