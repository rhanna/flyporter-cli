# Project Spec

## Overview

FlyPorter is a Node.js 20+ command-line application for authorized Porter staff-travel users.
It retrieves one-way flight availability and existing standby passenger records through a
dedicated Google Chrome session. See the [CLI spec](features/cli-interface.md) for commands.

## Purpose

Expose Porter staff availability as terminal tables or normalized JSON for scripting.
Users complete login and Cloudflare verification interactively and leave a resident session
running while issuing searches from another terminal. The CLI does not create bookings or
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

See the [architecture overview](../../docs/architecture/overview.md) for execution flows.

## Key Constraints

- Requires Node.js >=20, installed Google Chrome, and an authorized staff-travel account.
- Searches attach to a running Chrome process; a profile alone does not preserve session-only cookies.
- Chrome owns authentication state. The application waits for human verification rather than
  bypassing challenges or copying cookies into Node.js.
- Environment settings: `FLYPORTER_CHROME_PROFILE`, `FLYPORTER_CHROME_DEBUG_PORT`
  (default 9223), and `FLYPORTER_CHROME_PATH`. See [browser session](features/browser-session.md).
- Terminal output masks identifiers; JSON includes full normalized identifiers.
  See [output and privacy](features/output-and-privacy.md).
- External booking-widget and response contracts may change. Keep-alive cannot override
  server-side absolute expiry. Other-airline/MyIDTravel search is not implemented.
- Keep secrets, Chrome profiles, HAR recordings, and real passenger data out of tracked artifacts.

## Common Workflows

1. Install with `npm install` and `npm link`.
2. Run `flyporter auth`, complete login in Chrome, and leave both running.
3. In another terminal run `flyporter search porter YUL YTO YYYY-MM-DD`;
   add `--json` for machine-readable output.
4. Use `flyporter session keep-alive` to attach to an existing Chrome session or launch one,
   authenticate, and refresh it. Complete login again when requested.
5. Stop the resident command with Ctrl-C; cleanup depends on whether it launched Chrome.
6. For development, run `npm test` and `npm run lint`.

Feature specifications:
[browser](features/browser-session.md),
[authentication and keep-alive](features/authentication-and-keep-alive.md),
[search](features/porter-availability-search.md),
[output](features/output-and-privacy.md), and
[CLI](features/cli-interface.md).
