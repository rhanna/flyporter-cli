# FlyPorter staff-travel CLI

A fetch-only Node.js CLI for retrieving Porter staff-travel flight availability and standby
requests. It uses a persistent cookie jar and does not use Playwright or attempt to bypass
Cloudflare verification.

## Requirements

- Node.js 20 or newer
- An authorized Porter staff-travel account

## Install

```sh
npm install
npm link
```

## Authenticate

Pass credentials directly:

```sh
flyporter auth --username YOUR_USERNAME --password YOUR_PASSWORD
```

Or create a `.env` file:

```dotenv
FLYPORTER_USERNAME=YOUR_USERNAME
FLYPORTER_PASSWORD=YOUR_PASSWORD
```

Then run:

```sh
flyporter auth
```

The CLI stores only the cookie jar, not the username or password. On macOS the default session
path is `~/Library/Application Support/flyporter/session.json`; set
`FLYPORTER_SESSION_FILE` to override it. The session file is created with owner-only permissions.

If Cloudflare requires human verification, authentication exits with a clear error. The CLI does
not solve or bypass the challenge.

## Search Porter

```sh
flyporter search porter YUL YTO 2026-06-18
flyporter search porter YUL YTO 2026-06-18 --json
```

Terminal output masks employee, reference employee, and VIPorter identifiers. `--json` returns
the complete normalized records, including those identifiers, for authorized scripting use.

Airport or city codes must contain three letters. Dates must use `YYYY-MM-DD`.

## Other-airline search

```sh
flyporter search other-airline YUL LHR 2026-06-18
```

This command currently reports an unsupported-operation error. The supplied recording only
contains the short-lived MyIDTravel SSO redirect, not the MyIDTravel search request and response
flow needed to implement this safely.

## Development

```sh
npm test
npm run lint
```

HAR files are ignored because they may contain active cookies, SSO tokens, credentials, and
personally identifying standby data.
