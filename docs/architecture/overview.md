# Architecture Overview

## System Shape

A JavaScript ES-module CLI with Browserless BAP (default), self-hosted CDP and local Chrome adapters.
Local Chrome is spawned normally and controlled over CDP. BAP uses a stealth BrowserQL WebSocket
and keeps one remote page for authentication and each search. There is no hosted application or
database. Foreground BAP maintenance exposes authenticated local IPC for other CLI invocations.

## Main Modules

| Module | Responsibility |
| --- | --- |
| [bin/flyporter.js](../../bin/flyporter.js) | Invoke the CLI with process arguments. |
| [src/cli.js](../../src/cli.js) | Commands, dotenv loading, validation, signals, output and domain errors. |
| [src/browser.js](../../src/browser.js) | Chrome discovery, launch/attachment, navigation, page-side requests, native booking widget, response wrapper and cleanup. |
| [src/auth.js](../../src/auth.js) | Interactive login and heartbeat result validation. |
| [src/session.js](../../src/session.js) | Heartbeat loop and reauthentication callbacks. |
| [src/search.js](../../src/search.js) | Adapter selection, form/request flow and normalized availability records. |
| [src/html.js](../../src/html.js) | Cheerio form and anti-forgery token extraction helpers. |
| [src/output.js](../../src/output.js) | Availability/standby tables and identifier masking. |
| [src/validation.js](../../src/validation.js) | Airport/city code and calendar-date validation. |
| [src/errors.js](../../src/errors.js) | Domain error codes and process exit statuses. |
| [src/browser-factory.js](../../src/browser-factory.js) | Select adapters and authentication policy. |
| [src/bap-browser.js](../../src/bap-browser.js) | Actual BAP API operations, authentication, solver outcomes and fresh response capture. |
| [src/bap-controls.js](../../src/bap-controls.js) | Self-contained remote control expressions and proof-of-concept input helpers. |
| [src/bap-session.js](../../src/bap-session.js) | BAP ownership and reconnect lifecycle; compatibility reexports of shared resident APIs. |
| [src/resident-session.js](../../src/resident-session.js) | Restricted state, ownership locks, serialized resident operations and authenticated local IPC for BAP/CDP. |
| [src/cdp-browser.js](../../src/cdp-browser.js) | Self-hosted Playwright CDP adapter, one-shot automatic login, exact-target DevTools handoff and owned-browser shutdown. |
| [src/config.js](../../src/config.js) | Backend/config validation, credential aliases and secret redaction. |
| [src/diagnostics.js](../../src/diagnostics.js) | Opt-in masked screenshots, control metadata and redacted JSONL events (`FLYPORTER_DEBUG=1`). |

## Request Flow

- **Self-hosted CDP:** `auth` or `session keep-alive` acquires an isolated backend lock, connects to
  Browserless with Playwright CDP, and creates one owned page. Automatic credential submission is
  attempted once when configured; missing credentials, detected challenges or an unconfirmed login
  trigger manual DevTools handoff. Target ID is matched against `/sessions`; only configured public
  and internal origins are accepted. User-facing links carry the instance token, are printed to
  stderr only when needed and are not persisted. Staff search controls must be confirmed.
- **CDP resident:** the shared IPC queue serializes 60-second heartbeats, searches and authentication.
  A confirmed expiry permits bounded reauthentication, pausing pending searches. Searches require
  a resident on the same server/OS user and reuse the local adapter's native Porter search method.
  No disconnected retention is used. Transport loss ends the workflow; shutdown sends Browser.close
  before disconnecting so an attached viewer does not intentionally retain the owned browser.

Debug reporting defaults to a no-op: no diagnostic browser calls, files or stderr events, including
on failure. `FLYPORTER_DEBUG=1` enables reporting on the browser-owning process; resident searches
use that process's setting. Normal errors and status messages remain available.

- **BAP standalone:** select backend/config, try resident IPC first for searches, otherwise lock the
  account-scoped state directory. Consume a nonexpired reconnect endpoint, or open a new session
  if unavailable. Verify staff authentication and log in at most once. Search with native BAP
  interactions, preserving one-way, passenger, airports/autocomplete and dates. Capture a fresh
  availability response body and pass BrowserResponse to shared normalization/output.
- **BAP release:** successful standalone workflows request `BAP_RECONNECT_TIMEOUT_MS` (60000 by
  default), atomically cache endpoint/expiry, then close the client. Zero disables retention.
  Resumption disarms inherited retention until the next successful release. Failures disarm
  retention and attempt closure; references and locks are cleaned up.
- **BAP resident:** `session keep-alive` acquires ownership and publishes a restricted descriptor
  with PID, Unix socket/Windows pipe and random IPC credential. Searches and heartbeat/reauthentication
  run in a serial queue. Normal stop removes descriptor/socket and closes without retaining.
  `--duration` and signals interrupt remote calls through transport closure. A failed resident search,
  heartbeat transport failure, or failed reauthentication ends the process; requests are not replayed.
- BAP cache defaults to `~/.config/flyporter/<scope>`; scope hashes token, account and endpoint.
  Override the parent with `FLYPORTER_STATE_DIR`. Directories use 0700 and state files 0600 on POSIX.
  No account password, Browserless token or cookies are persisted there. A live owner lock rejects
  competing standalone commands; dead PID locks are recoverable.
- BAP retention is billable idle time, distinct from Porter's authentication expiry and Browserless
  absolute session limit. There is no background maintenance outside explicit foreground keep-alive.

- **Local resident authentication:** `auth` launches Chrome with a dedicated profile and debugging port,
  navigates to the staff page, waits for interactive login, then refreshes the session.
  `session keep-alive` first tries attachment and otherwise launches Chrome.
  The loop performs a credentialed page-side GET, verifies the resulting staff path/status,
  then sleeps. Failures invoke reauthentication when supplied.
- **Local search:** validate arguments, attach over CDP, and create a separate tab in the shared context.
  The concrete Chrome adapter drives Porter's Knockout booking widget, selects a staff passenger
  and one-way itinerary, submits, and captures the staff availability response.
  Search normalization feeds either masked tables or full JSON. Finally close the search tab
  and disconnect the local client while leaving the resident Chrome process running.
- **Alternative adapter contract:** when `searchStaffAvailability` is absent, search extracts
  the staff form, submits staff selection, follows the booking page, initializes
  `BuildFlightSearch` and `LowFareSearch`, then requests staff availability.
  This is not an automatic retry after native-widget failure.
- **Local shutdown:** SIGINT/SIGTERM abort the heartbeat loop. Cleanup of a launched/owned browser
  disconnects and terminates its process; an attached browser closes its own tab and disconnects.
  Signal handling does not immediately cancel in-progress authentication or navigation.

Local GET operations navigate the page; other generic requests use credentialed browser-side fetch.
Chrome supplies restricted request headers and cookies. Response wrappers omit Set-Cookie and
normalize header newlines. Domain errors are rendered by the CLI with codes and exit statuses;
unexpected errors propagate.

## External Dependencies

- Google Chrome: real browser state, interactive login, local CDP endpoint.
- `playwright-core`: CDP attachment, page control, and response capture.
- `@browserless.io/bap-ts`: supported BrowserQL interactions, CAPTCHA solving, captured response
  bodies and reconnects. BAP evaluation takes self-contained code and returns string/null, not
  Playwright argument passing or object deserialization. Types are checked against the SDK.
- `commander`: command parsing and help.
- `dotenv`: local environment configuration.
- `cheerio`: HTML form parsing for the alternative adapter path.
- Porter staff pages and flight endpoints: live authentication and availability contracts.
  Native search depends on site-provided Knockout and Moment globals.
- Node.js test runner, ESLint, and `globals`: development verification.

## Architecture Subfiles

This overview covers the current module structure. Detailed behavioral contracts live in the
[project specification](../../.agents/specs/project.md) and its linked feature specifications.
Create architecture subfiles only when implemented detail justifies a separate document.
