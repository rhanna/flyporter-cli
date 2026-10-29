# FlyPorter staff-travel CLI

Retrieve Porter staff flight availability and existing standby requests as masked terminal tables
or normalized JSON. Choose Browserless BAP (default) or the original local Playwright/Chrome backend.
No booking or purchasing operations are implemented. Other-airline search remains unsupported.

## Quick start: Browserless BAP

You need Node.js 20+, npm 11.10+, a Browserless token with stealth/CAPTCHA access, and an authorized
Porter staff-travel account. BAP runs the browser remotely; Google Chrome is only required for local mode.

**1. Install from the repository root.**

```sh
npm install
npm link
# Create .env only if one does not already exist.
test -f .env || cp .env.example .env
```

**2. Edit `.env` with your own credentials.** The minimum configuration is:

```dotenv
FLYPORTER_BROWSER=bap
BROWSERLESS_TOKEN=your_browserless_token
PORTER_USERNAME=your_porter_username
PORTER_PASSWORD="your_porter_password"
```

Keep running commands from the repository root: `.env` is loaded from the current working directory,
even when you installed the global `flyporter` command with `npm link`. Use the same configuration
in both terminals when sharing a session. If you do not want to use `npm link`, replace `flyporter`
with `node bin/flyporter.js` in the examples below.

**3. Run a search.** Authentication happens automatically; a separate `auth` command is optional.

```sh
flyporter search porter YTZ YUL 2026-11-05
```

Replace `YTZ`, `YUL` and `2026-11-05` with your departure code, arrival code and a future travel date.
The command prints confirmed availability, an explicit no-flights result, or an error.

### Connection and credential settings

Set `BROWSERLESS_TOKEN`, `PORTER_USERNAME` and `PORTER_PASSWORD` for BAP. The default endpoint is
`wss://production-sfo.browserless.io/stealth/bql`; Browserless stealth/CAPTCHA access is required.
Keep tokens out of the endpoint. Shell environment variables take precedence over `.env`.
`BROWSERLESS_API_TOKEN`, `FLYPORTER_USERNAME`/`FLYPORTER_PASSWORD`, and `USERNAME`/`PASSWORD` are
supported aliases, in that order after the canonical names. Quote dotenv values containing `#`.

## Search

```sh
# Departure code, arrival code, date; one-way travel.
flyporter search porter YTZ YUL 2026-11-05

# Machine-readable output, including full standby identifiers.
flyporter search porter YTZ YUL 2026-11-05 --json

# Save JSON to a file; diagnostics still print to stderr.
flyporter search porter YTZ YUL 2026-11-05 --json > flights.json
```

BAP resumes a recently retained session or creates one and logs in once. Each workflow uses one
remote browser/page for authentication, form interaction and availability capture. Searches select
one-way travel and the account-holder passenger. Airport/city codes require three letters and dates
require a valid `YYYY-MM-DD` calendar date. Use a future date for real searches.

Terminal tables mask employee, reference employee and VIPorter identifiers. `--json` returns the
complete normalized records, including those identifiers, for authorized scripting. Debug messages
go to stderr so JSON stdout remains machine-readable. Missing/stale/malformed availability responses
are failures; the CLI does not report success solely because a form was submitted.

The flight table includes flight number, route, departure/arrival times, equipment, available seats,
Classic/Reserve seats and standby count. A separate standby table appears when records exist.
Seat counts are a snapshot at search time and do not guarantee travel. The saved JSON file includes
unmasked identifiers, so handle it as personal data.

## Session reuse and authentication

```sh
flyporter auth
```

In BAP mode, this performs a login check and exits. Successful auth and standalone searches retain
the browser for `BAP_RECONNECT_TIMEOUT_MS` (default **60000**, one minute) after disconnecting.
The next call can reuse it. Set this to `0` to close immediately. Session references are stored with
restricted permissions under `~/.config/flyporter/<account-scope>`; override the parent directory with
`FLYPORTER_STATE_DIR`. Account, token and endpoint changes select a different cache scope.

Configure the reuse window in `.env` (values are **milliseconds**):

```dotenv
# Retain a disconnected browser for 60 seconds after a successful command.
BAP_RECONNECT_TIMEOUT_MS=60000
```

Or disable reuse for a single search:

```sh
BAP_RECONNECT_TIMEOUT_MS=0 flyporter search porter YTZ YUL 2026-11-05
```

This reuse window is separate from foreground keep-alive. Ordinary searches do not start a background
process or send heartbeats after exiting.

Porter authentication is verified when reconnecting. Expired Browserless sessions are discarded;
expired Porter authentication prompts one automated login attempt. There are no automatic retries
of failed login submissions or flight searches. A busy standalone session fails clearly rather than
allowing concurrent browser manipulation. `BROWSERLESS_PROFILE` is not used; cookies are not exported.

**Billing:** retained idle time continues consuming Browserless units, and a reconnect starts another
billable connection. The retention window does not extend Porter's authentication lifetime or your
Browserless plan's absolute session limit. Requested retention beyond plan limits fails explicitly.
See [Browserless reconnects](https://docs.browserless.io/bap/session-management/reconnects) and
[unit consumption](https://docs.browserless.io/overview/unit-consumption).

## Foreground keep-alive — both backends

```sh
# Terminal 1, from the configured repository directory:
flyporter session keep-alive

# Terminal 2, from the same directory:
flyporter search porter YTZ YUL 2026-11-05
```

Stop Terminal 1 with **Ctrl-C** when finished. To limit how long it runs, use `--duration`
(values are **seconds**):

```sh
# Refresh every minute and stop after five minutes, including startup.
flyporter session keep-alive --interval 60 --duration 300
```

Leave this command running and issue searches from another terminal. BAP maintains one paid remote
session and routes searches through authenticated local IPC. Searches and heartbeats run serially.
It defaults to a 60-second heartbeat; intervals must be at least 30 and below 120 seconds because
Porter's session expires after approximately two minutes. `--auth-timeout` defaults to 600 seconds.
`--duration` stops after that many seconds, including startup; omission runs until Ctrl-C.

BAP keep-alive bills continuously while running, plus any CAPTCHA/proxy charges. A detected Porter
expiry permits one reauthentication attempt; failed reauthentication or a lost remote session ends
the resident workflow. It does not recreate browsers indefinitely or replay an interrupted search.
Ctrl-C, duration expiry and failures attempt closure and remove the resident descriptor. A normal
resident shutdown does not retain the browser for later reuse.

## Local Playwright/Chrome mode

```sh
flyporter --browser local auth
# In another terminal:
flyporter --browser local search porter YTZ YUL 2026-11-05 --json
# Or start the resident workflow explicitly:
flyporter --browser local session keep-alive --interval 180 --duration 300
```

Set `FLYPORTER_BROWSER=local` to make local mode the default. An explicit `--browser` overrides it.
Local auth opens a dedicated Chrome profile; complete Cloudflare verification and login interactively.
Leave Chrome and the resident command running. Searches attach to that process because Porter uses
session-only cookies. Auth defaults to `--timeout 600 --interval 240`; keep-alive defaults to 240
seconds, with a minimum interval of 30. Search cleanup disconnects without terminating resident Chrome.
Keep-alive cannot override server-side absolute expiry.

The default macOS profile is `~/Library/Application Support/flyporter/chrome-profile`. Existing
`FLYPORTER_CHROME_PROFILE`, `FLYPORTER_CHROME_DEBUG_PORT` (9223), and `FLYPORTER_CHROME_PATH` settings
remain supported. Credentials and Browserless configuration are not required for local mode.

To select local mode for all commands, set `FLYPORTER_BROWSER=local` in `.env`. To select it for one
command, put `--browser local` before the command as shown above. Use `--browser bap` to explicitly
select Browserless instead.

## Command reference

| Command                                                        | Purpose                                                             | Options                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `flyporter auth`                                               | BAP login check, or local interactive login followed by maintenance | `--timeout <seconds>` (600); `--interval <seconds>` (240, local only)                               |
| `flyporter session keep-alive`                                 | Maintain the selected backend in the foreground                     | `--interval <seconds>` (BAP 60/local 240); `--auth-timeout <seconds>` (600); `--duration <seconds>` |
| `flyporter search porter <origin> <destination> <date>`        | Retrieve one-way staff availability                                 | `--json`                                                                                            |
| `flyporter search other-airline <origin> <destination> <date>` | Currently unsupported                                               | Exits with code 7                                                                                   |

`--browser bap|local` is a global option. To see the installed CLI's help:

```sh
flyporter --help
flyporter auth --help
flyporter session keep-alive --help
flyporter search porter --help
```

## Troubleshooting

| Message or symptom                                       | What to do                                                                                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flyporter: command not found`                           | Run `npm link`, or use `node bin/flyporter.js` from the repository root.                                                                                  |
| Missing token or credentials                             | Check `.env` in your current directory and the setting names above. Local mode does not need BAP credentials.                                             |
| Local search says no Chrome session is running           | Start `flyporter --browser local auth`, finish sign-in and leave that terminal and Chrome open.                                                           |
| BAP session is busy                                      | Let the active command finish, or use searches from another terminal while `session keep-alive` is running.                                               |
| Challenge or login failure                               | Inspect the printed artifact directory. Check Browserless solver access and Porter credentials/MFA; the CLI does not repeatedly submit failed logins.     |
| Session could not be resumed                             | Expired references normally cause a fresh login. If the command fails, inspect its diagnostics and retry manually after checking the provider connection. |
| No fresh availability response or Porter temporary error | Inspect the failure screenshot. Do not interpret a failed search as zero available seats.                                                                 |
| BAP interval is rejected                                 | Use at least 30 and less than 120 seconds, for example `--interval 60`.                                                                                   |

For scripts, success exits with `0`. Domain errors print `Error [CODE]: message` to stderr:

| Exit code | Meaning                                       |
| --------- | --------------------------------------------- |
| 1         | General CLI/parser error                      |
| 2         | Authentication failed                         |
| 3         | Session expired                               |
| 4         | Browser challenge was not cleared             |
| 5         | Invalid argument or configuration             |
| 6         | Remote response, transport or cleanup failure |
| 7         | Unsupported operation                         |

## Diagnostics and limitations

BAP writes numbered PNGs, control metadata and redacted JSONL events under `artifacts/<timestamp>-<pid>`.
Inputs are masked for screenshots. Metadata omits input values, cookies, raw HTML and response bodies;
session endpoints, configured secrets and solve tokens are not logged. Screenshots may still contain
account or standby information elsewhere on the page; treat artifacts as sensitive. Artifacts and
dotenv files are gitignored. Capture failures are logged separately; masking failure skips the image.

The supported BAP solver records absent, solved, failed and unknown outcomes. A successful solver
response is followed by a check that recognized challenge markers have cleared. CAPTCHAs, MFA,
invalid credentials and staff-access restrictions may block a run. No solver guarantees clearance.
`BAP_CAPTCHA_TIMEOUT_MS` controls detection waiting; it is not a guaranteed total solve-time limit.
`BAP_TIMEOUT_MS` controls browser operations. Optional selectors/date formatting are in `.env.example`.
The BAP operation timeout also caps individual authentication operations even when the overall CLI
authentication timeout is longer. A resumed transport that fails before credentials/search submission
may be replaced once; a submitted search is never replayed automatically.

The BAP implementation reuses controls from the proof of concept at `../flyporter-cli-2`,
and follows the official [SDK migration](https://docs.browserless.io/bap/migrate),
[network](https://docs.browserless.io/bap/network-control), and
[CAPTCHA](https://docs.browserless.io/bap/bot-detection/captchas) APIs. Read-only Porter calendars use
the site's existing date-picker API. New upstream widget layouts may need selector changes.

## Development and verification

```sh
npm test
npm run check
npm run lint
npm run format:check
```

`npm run format` formats changed integration files without reformatting unrelated local code.
Type checking covers the added/changed JavaScript integration modules using JSDoc and SDK types.
Tests use local DOM fixtures and browser doubles; they do not authenticate against Porter.
Live evidence and remaining limitations are recorded in `.agents/tasks.md`.
