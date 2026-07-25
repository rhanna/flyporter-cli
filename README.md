# FlyPorter staff-travel CLI

A Node.js CLI for retrieving Porter staff-travel flight availability and standby requests. It
uses a dedicated persistent Google Chrome profile so Cloudflare verification, Porter login state,
and XHR requests remain in the same real browser environment.

## Requirements

- Node.js 20 or newer
- Google Chrome
- An authorized Porter staff-travel account

## Install

```sh
npm install
npm link
```

## Authenticate

```sh
flyporter auth
```

The command opens visible Chrome using a dedicated profile. Complete Cloudflare verification and
sign in normally. After the staff page loads, leave the command and Chrome window running. It
maintains the session and exposes that exact browser to search commands. Use another terminal for
searches and press `Ctrl-C` in the authentication terminal when finished.

Chrome is started as a normal browser process and the CLI attaches through a fixed debugging
port. It is not launched with Playwright's automation flags, so `navigator.webdriver` remains
false.

On macOS the default profile is:

```text
~/Library/Application Support/flyporter/chrome-profile
```

Override the profile or local Chrome debugging port with:

```dotenv
FLYPORTER_CHROME_PROFILE=/absolute/path/to/chrome-profile
FLYPORTER_CHROME_DEBUG_PORT=9223
```

The CLI does not copy Chrome cookies into Node.js and does not attempt to bypass Cloudflare.

## Keep the session active

```sh
flyporter session keep-alive
```

This is an explicit alias for running the resident session workflow. Normally `flyporter auth`
already authenticates and keeps the session active.

Choose a different interval, with a minimum of 30 seconds:

```sh
flyporter session keep-alive --interval 180
```

This reduces idle expiry but cannot override an absolute server-side session lifetime. If Porter
expires the session, the staff login page is opened and the keep-alive process waits for
interactive sign-in again.

Stop the resident session with `Ctrl-C`.

## Search Porter

```sh
flyporter search porter YUL YTO 2026-06-18
flyporter search porter YUL YTO 2026-06-18 --json
```

Searches require the authenticated Chrome process to be running. They attach to that exact
process; they do not open a fresh browser because Porter uses session-only cookies.

Terminal output masks employee, reference employee, and VIPorter identifiers. `--json` returns
the complete normalized records, including those identifiers, for authorized scripting use.

Airport or city codes must contain three letters. Dates must use `YYYY-MM-DD`.

## Other-airline search

```sh
flyporter search other-airline YUL LHR 2026-06-18
```

This currently reports an unsupported-operation error. The supplied recording contains the
short-lived MyIDTravel SSO redirect but not the MyIDTravel search flow.

## Development

```sh
npm test
npm run lint
```

HAR files are ignored because they may contain active cookies, SSO tokens, credentials, and
personally identifying standby data.
