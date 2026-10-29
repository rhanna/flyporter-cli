# Architecture Overview

## System Shape

A local JavaScript ES-module CLI with a resident Chrome session and short-lived search commands.
Chrome is spawned as a normal process, then controlled with Playwright Core over CDP.
The dedicated profile persists browser state; session-only cookies require Chrome to remain alive.
There is no server deployment or application database.

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

## Request Flow

- **Resident authentication:** `auth` launches Chrome with a dedicated profile and debugging port,
  navigates to the staff page, waits for interactive login, then refreshes the session.
  `session keep-alive` first tries attachment and otherwise launches Chrome.
  The loop performs a credentialed page-side GET, verifies the resulting staff path/status,
  then sleeps. Failures invoke reauthentication when supplied.
- **Search:** validate arguments, attach over CDP, and create a separate tab in the shared context.
  The concrete Chrome adapter drives Porter's Knockout booking widget, selects a staff passenger
  and one-way itinerary, submits, and captures the staff availability response.
  Search normalization feeds either masked tables or full JSON. Finally close the search tab
  and disconnect the local client while leaving the resident Chrome process running.
- **Alternative adapter contract:** when `searchStaffAvailability` is absent, search extracts
  the staff form, submits staff selection, follows the booking page, initializes
  `BuildFlightSearch` and `LowFareSearch`, then requests staff availability.
  This is not an automatic retry after native-widget failure.
- **Shutdown:** SIGINT/SIGTERM abort the heartbeat loop. Cleanup of a launched/owned browser
  disconnects and terminates its process; an attached browser closes its own tab and disconnects.
  Signal handling does not immediately cancel in-progress authentication or navigation.

GET operations navigate the page; other generic requests use credentialed browser-side fetch.
Chrome supplies restricted request headers and cookies. Response wrappers omit Set-Cookie and
normalize header newlines. Domain errors are rendered by the CLI with codes and exit statuses;
unexpected errors propagate.

## External Dependencies

- Google Chrome: real browser state, interactive login, local CDP endpoint.
- `playwright-core`: CDP attachment, page control, and response capture.
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
