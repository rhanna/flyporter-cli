# Project Spec

## Overview

FlyPorter is a Node.js 20+ command-line application for authorized Porter staff-travel users.
It retrieves one-way flight availability and existing standby passenger records through Browserless
BAP (default) or the retained local Playwright/Chrome backend. See the [CLI spec](features/cli-interface.md).

## Purpose

Expose Porter staff availability as terminal tables or normalized JSON for scripting.
Local users authenticate interactively. BAP uses environment credentials and supported CAPTCHA
solving, with bounded reconnect reuse or explicit foreground maintenance. The CLI does not create bookings or
standby requests. Other-airline search is exposed as an unsupported command.

## Architecture

- [CLI orchestration](../../src/cli.js) uses Commander and loads environment configuration with dotenv.
- [Browser adapter](../../src/browser.js) launches normal Chrome or attaches via local CDP,
  keeping navigation, cookies, and page-side requests in the same browser.
- [Authentication](../../src/auth.js) and [session management](../../src/session.js) implement
  interactive login and periodic session refresh.
- [Search](../../src/search.js) drives availability retrieval and normalization;
  [HTML helpers](../../src/html.js) support the form-based adapter path.
- [Output](../../src/output.js), [validation](../../src/validation.js), and
  [errors](../../src/errors.js) provide presentation and shared contracts.
- Chrome's dedicated profile is the persistent store. There is no application database,
  hosted service, queue, or Node.js cookie store.
- The backend factory selects local Chrome or `src/bap-browser.js`. BAP control helpers adapt
  the proof of concept; `src/bap-session.js` owns restricted session references, locking and
  authenticated local IPC. `src/diagnostics.js` captures masked screenshots and redacted events.
  Browserless owns remote cookies; account credentials are not cached.

See the [architecture overview](../../docs/architecture/overview.md) for execution flows.

## Key Constraints

- Requires Node.js >=20, npm >=11.10 for BAP, and an authorized staff-travel account.
  Local mode additionally requires Google Chrome; BAP requires Browserless token/stealth access.
- Local searches attach to running Chrome; BAP searches use a resident process or resume/create
  a remote session. Successful standalone BAP commands default to 60000 ms billable idle retention;
  `BAP_RECONNECT_TIMEOUT_MS=0` disables reuse. This does not extend Porter's approximately two-minute TTL.
- Browsers own authentication state. Local mode waits for human verification; BAP uses supported
  solver outcomes and verifies challenge clearance. Neither exports cookies into Node.js.
- Environment settings: `FLYPORTER_CHROME_PROFILE`, `FLYPORTER_CHROME_DEBUG_PORT`
  (default 9223), and `FLYPORTER_CHROME_PATH`. See [browser session](features/browser-session.md).
- Terminal output masks identifiers; JSON includes full normalized identifiers.
  See [output and privacy](features/output-and-privacy.md).
- External booking-widget and response contracts may change. Keep-alive cannot override
  server-side absolute expiry. Other-airline/MyIDTravel search is not implemented.
- Keep secrets, Chrome profiles, HAR recordings, and real passenger data out of tracked artifacts.

## Common Workflows

1. Install with `npm install` and `npm link`.
2. Configure BAP credentials and run `flyporter auth` for a one-shot login check, or use
   `flyporter --browser local auth` and complete interactive sign-in, leaving it running.
3. In another terminal run `flyporter search porter YUL YTO YYYY-MM-DD`;
   add `--json` for machine-readable output.
4. Use `flyporter session keep-alive` for foreground maintenance on either backend. BAP defaults
   to 60-second heartbeats (30 <= interval < 120); local defaults to 240 seconds (minimum 30).
   Optional `--duration` bounds runtime. BAP announces continuous billing before connecting.
5. Stop the resident command with Ctrl-C; cleanup depends on whether it launched Chrome.
6. For development, run `npm test`, `npm run lint`, `npm run check`, and `npm run format:check`.

Feature specifications:
[browser](features/browser-session.md),
[authentication and keep-alive](features/authentication-and-keep-alive.md),
[search](features/porter-availability-search.md),
[output](features/output-and-privacy.md), and
[CLI](features/cli-interface.md).
