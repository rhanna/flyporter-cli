# FlyPorter staff-travel CLI

Retrieve Porter staff flight availability and existing standby requests as masked terminal tables
or normalized JSON. Choose Browserless BAP (default), self-hosted Browserless CDP or local Playwright/Chrome.
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

# Save JSON to a file; errors still print to stderr.
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

## Foreground keep-alive — BAP and local

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

## Self-hosted Browserless CDP on Coolify

Use `--browser browserless-cdp` for the **free** Browserless Chromium image. The CLI uses
Playwright CDP, not BAP or Enterprise LiveURL. It attempts automatic login once when credentials
are configured; challenges, MFA or unconfirmed login produce a **LIVE LOGIN LINK** to the exact
remote page in the built-in DevTools viewer. No automatic CAPTCHA solver is used in this mode.

Configure the CLI's `.env` (do not put tokens in either URL):

```dotenv
FLYPORTER_BROWSER=browserless-cdp
# Internal Docker address, or wss://browserless.example.com/chromium from outside Coolify.
BROWSERLESS_CDP_ENDPOINT=ws://browserless:3000/chromium
BROWSERLESS_CDP_PUBLIC_URL=https://browserless.example.com
BROWSERLESS_CDP_TOKEN=your_self_hosted_token
# Optional: set both for automatic login, or remove all credential aliases for manual login.
PORTER_USERNAME=your_porter_username
PORTER_PASSWORD="your_porter_password"
FLYPORTER_DEBUG=0
```

The CDP token falls back to `BROWSERLESS_TOKEN`, then `BROWSERLESS_API_TOKEN`. Porter credentials use
those same aliases documented above. A partially configured username/password is rejected. No local
Chrome installation or Browserless cloud account is needed. `BAP_RECONNECT_TIMEOUT_MS` does not apply.

```sh
# Process 1, on the Hermes server: login, then keep this process running.
flyporter --browser browserless-cdp auth

# Process 2, on that same server and with the same configuration:
flyporter --browser browserless-cdp search porter YTZ YUL 2026-11-05 --json

# Alternatively, authenticate and maintain for at most 30 minutes, including startup:
flyporter --browser browserless-cdp session keep-alive --interval 60 --duration 1800
```

When a login link is printed, open it in your browser. In DevTools, click **Toggle screencast**
(the screen icon, usually at the top left) if the remote page is not visible. Click/type in the
screencast to complete CAPTCHA, MFA and sign-in. The CLI waits for staff search controls; the page
simply leaving the login URL is insufficient. Close the viewer after the CLI confirms authentication.
The link includes the self-hosted API token and grants browser control; share it only with the intended
user. It can remain usable while the session runs and is not a separately expiring Enterprise LiveURL.
Do not paste it into diagnostics or shared logs.

Automatic login is submitted once. A recognized rejection fails without retries. Other unconfirmed
login states fall back to the viewer after up to 15 seconds. `auth --timeout` and keep-alive's
`--auth-timeout` default to 600 seconds for authentication. The default heartbeat is 60 seconds;
intervals must be at least 30 and below 120. On confirmed expiry, queued browser operations pause
while the same authentication flow runs again. A submitted search is never replayed automatically.

Searches and heartbeats share one remote page through restricted, authenticated **local** IPC.
Run Hermes, the resident command and searches as the same OS user on the same server; they are
not a cross-machine API. Searches fail with instructions if no resident process is running. Keep
`.env`, the working directory and `FLYPORTER_STATE_DIR` consistent across processes. Stop the
resident with Ctrl-C; it attempts to close the owned remote browser even if a viewer is attached.
Cookies stay in the remote browser; this backend does not retain disconnected sessions.

### Coolify service setup

Deploy a dedicated Docker Compose service, route your chosen HTTPS domain to container port 3000,
and set `BROWSERLESS_CDP_TOKEN` as a Coolify secret. The example pins the upstream `v2.58.1` image;
its session metadata/DevTools routes were source-reviewed, but live screencast interaction must be
verified on your deployment before relying on unattended searches.

```yaml
services:
  browserless:
    image: ghcr.io/browserless/chromium:v2.58.1
    restart: unless-stopped
    shm_size: "2gb"
    environment:
      TOKEN: ${BROWSERLESS_CDP_TOKEN:?Set a self-hosted Browserless token}
      EXTERNAL: https://browserless.example.com
      ENABLE_DEBUGGER: "true"
      TIMEOUT: "-1"
      CONCURRENT: "1"
    expose:
      - "3000"
```

Attach the service and Hermes to the same Docker network if using the internal endpoint. Set
`EXTERNAL` and `BROWSERLESS_CDP_PUBLIC_URL` to the actual user-reachable address, not localhost.
The reverse proxy must forward WebSocket upgrades for the connection and `/devtools/page/...`
routes, and allow the resident connection to remain open. Browserless's session timeout and proxy
idle timeout are separate from Porter authentication: `TIMEOUT=-1` removes the Browserless absolute
session deadline for this dedicated service, but it does not extend Porter's TTL. The resident
process owns cleanup; if it is forcibly killed while a viewer remains attached, close the viewer
and inspect/stop the orphan session in Browserless. Keep-alive cannot override absolute Porter expiry.

If the viewer is missing, the CLI reports a compatibility error. Check the pinned image,
`ENABLE_DEBUGGER`, token, proxy paths and `EXTERNAL`. Free Chromium can still be blocked by
Cloudflare or other challenges even with human interaction; no clearance is guaranteed.

See [Browserless's free Docker documentation](https://docs.browserless.io/enterprise/open-source).

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
| `flyporter auth`                                               | BAP login check; local/CDP login followed by maintenance | `--timeout <seconds>` (600); `--interval <seconds>` (local 240/CDP 60)                               |
| `flyporter session keep-alive`                                 | Maintain the selected backend in the foreground                     | `--interval <seconds>` (BAP/CDP 60, local 240); `--auth-timeout <seconds>` (600); `--duration <seconds>` |
| `flyporter search porter <origin> <destination> <date>`        | Retrieve one-way staff availability                                 | `--json`                                                                                            |
| `flyporter search other-airline <origin> <destination> <date>` | Currently unsupported                                               | Exits with code 7                                                                                   |

`--browser bap|local|browserless-cdp` is a global option. To see the installed CLI's help:

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
| Challenge or login failure                               | Enable debugging (below) to capture artifacts. Check Browserless solver access and Porter credentials/MFA; the CLI does not repeatedly submit failed logins.     |
| Session could not be resumed                             | Expired references normally cause a fresh login. If the command fails, inspect its diagnostics and retry manually after checking the provider connection. |
| No fresh availability response or Porter temporary error | Enable debugging (below) to capture a failure screenshot. Do not interpret a failed search as zero available seats.                                                                 |
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

BAP and self-hosted CDP debug logging, screenshots and control metadata are **disabled by default**, including on failure.
Normal command output, errors and keep-alive status remain available. To investigate a BAP command:

```sh
FLYPORTER_DEBUG=1 flyporter search porter YTZ YUL 2026-11-05
```

Or set `FLYPORTER_DEBUG=1` in `.env` while investigating; reset it to `0` afterward. Values `true`
and `false` are also accepted. For searches served by foreground keep-alive, enable debugging on
**the keep-alive process** when starting it; the resident browser owns diagnostic capture.

When enabled, the remote backends write numbered PNGs, control metadata and redacted JSONL events under
`artifacts/<timestamp>-<pid>` (override with `ARTIFACTS_DIR`). Logs go to stderr, preserving JSON stdout.
Screenshot events include `screenshotMs` for the mask-and-image portion of capture.
Inputs are masked for screenshots. Metadata omits input values, cookies, raw HTML and response bodies;
session endpoints, configured secrets and solve tokens are not logged. Screenshots may still contain
account or standby information elsewhere on the page; treat artifacts as sensitive. Artifacts and
dotenv files are gitignored. Capture failures are logged separately; masking failure skips the image.

Each enabled snapshot adds four remote operations (mask, screenshot, restore and metadata),
so capturing every workflow step adds latency. Ordinary runs skip all of this work. Authentication,
CAPTCHA detection/solving, page loads and autocomplete still require remote operations. Reusing a
session avoids credential entry; foreground keep-alive also avoids reconnect/setup for each search.
`BAP_RECONNECT_TIMEOUT_MS=60000` retains a disconnected session; it does not make a successful command
wait 60 seconds before exiting. Operation timeouts are ceilings for individual calls, not a total
command deadline, so a failing workflow can take longer than `BAP_TIMEOUT_MS` across multiple calls.

The supported BAP solver distinguishes absent, solved, failed and unknown outcomes (logged in debug mode). A successful solver
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
