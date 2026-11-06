# FlyPorter staff-travel CLI

Retrieve Porter staff flight availability and existing standby requests as masked terminal tables
or normalized JSON. Choose Browserless BAP (default), persistent remote Chromium or local Playwright/Chrome.
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

## Persistent remote Chromium on Coolify

Select `--browser remote-chromium` to attach to a continuously running
[jlesage/chromium](https://github.com/jlesage/docker-chromium/tree/v26.08.2) browser.
Docker owns Chromium and its `/config` profile. The CLI creates its own tab in the existing default
context, then closes only that tab and disconnects. If it becomes the last open tab, cleanup leaves it blank
to avoid exiting headed Chromium. Other tabs and the browser remain running.
No local Chrome installation, Browserless token or automatic CAPTCHA solver is required.

### Test locally before Coolify

Start the isolated, loopback-only service (desktop authentication is disabled for this local test):

```sh
docker compose -p flyporter-local -f deploy/compose.chromium.local.yaml up -d
```

Open `http://127.0.0.1:15800` for the Chromium desktop. In a dedicated terminal at the repository
root, select its CDP port without changing `.env` or local Chrome configuration:

```sh
export FLYPORTER_BROWSER=remote-chromium
export REMOTE_CHROMIUM_ENDPOINT=http://127.0.0.1:19222
export REMOTE_CHROMIUM_DESKTOP_URL=http://127.0.0.1:15800
# Use a short path: Unix sockets have a platform-specific path-length limit.
export FLYPORTER_STATE_DIR=/tmp/flyporter-local-state
node bin/flyporter.js auth --timeout 600
node bin/flyporter.js search porter YTZ YUL 2026-11-12 --json
node bin/flyporter.js session keep-alive --interval 60 --duration 180
```

Existing Porter credentials in `.env` still apply. Complete any verification in the foreground
Porter tab in the desktop. Replace the search date with a future date. Run searches from another
terminal with the same environment if testing resident IPC during keep-alive. Chromium should remain
running after each command exits. Stop/start the service while preserving its profile with:

```sh
docker compose -p flyporter-local -f deploy/compose.chromium.local.yaml stop
docker compose -p flyporter-local -f deploy/compose.chromium.local.yaml start
```

The profile survives in a separate named volume. Porter login can still expire or require login
after restart. Do not add `-v` to `docker compose down` unless you intend to delete that profile.

### Deploy the browser

1. Create a Docker Compose service in Coolify using [deploy/compose.chromium.yaml](deploy/compose.chromium.yaml).
   Set `CHROMIUM_DESKTOP_USERNAME` and `CHROMIUM_DESKTOP_PASSWORD` as Coolify secrets. These protect
   the desktop; they are separate from your Porter credentials.
2. Route an **HTTPS** domain such as `https://chromium.example.com:5800` to the `chromium` service
   (5800 is the upstream container port). Enable HTTPS redirection and WebSocket forwarding in
   Coolify. Do not publish port 5800 directly. The example terminates TLS at Coolify and permits
   desktop authentication over HTTP only on the private proxy-to-container connection. Never use
   this upstream HTTP configuration without the HTTPS proxy.
3. Retain the named `chromium-config` volume mounted at `/config` across redeployments. It holds
   Chromium's profile, cookies and application settings. The image runs as UID/GID 1000 by default;
   set `CHROMIUM_USER_ID`/`CHROMIUM_GROUP_ID` to the owner if using an existing bind mount instead.
   One profile is intended for one Porter account. Keep it private and do not commit it.
4. The example binds CDP to **VPS loopback only**, on port 9222. From the machine running the CLI,
   open a tunnel and leave it running:

   ```sh
   ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:9222:127.0.0.1:9222 user@your-vps
   ```

   A CLI container on the same private Docker network can instead use `http://chromium:9222`.
   Connect it to the browser service's actual Coolify network; service DNS is network-scoped.
   CDP is unauthenticated and grants browser control. Do not route it through a public domain.
   The CLI does not create or manage SSH tunnels.

### Configure and use the CLI

```dotenv
FLYPORTER_BROWSER=remote-chromium
REMOTE_CHROMIUM_ENDPOINT=http://127.0.0.1:9222
REMOTE_CHROMIUM_DESKTOP_URL=https://chromium.example.com
PORTER_USERNAME=your_porter_username
PORTER_PASSWORD="your_porter_password"
FLYPORTER_DEBUG=0
```

Both URLs are required and must omit embedded credentials, query strings and fragments. The endpoint
accepts HTTP(S) discovery or a browser-level `ws(s)://.../devtools/browser/<id>` address. Prefer HTTP:
its browser ID is rediscovered after restarts, and internal advertised addresses are rewritten through
the configured private endpoint. Desktop URLs are ordinary links, without CDP tokens.
Porter credential aliases above still apply. Configure both username and password or neither.

```sh
# Independent search: attach, authenticate, search once and disconnect.
flyporter --browser remote-chromium search porter YTZ YUL 2026-11-05 --json

# Optional login check; exits after authentication.
flyporter --browser remote-chromium auth --timeout 600

# Optional foreground maintenance, for at most 30 minutes including startup.
flyporter --browser remote-chromium session keep-alive --interval 60 --duration 1800
```

Authentication first opens the staff landing page to establish or refresh the staff session, then
verifies the search page. It reuses authenticated state or submits configured credentials once.
Recognized rejection fails immediately. CAPTCHA, MFA or absent credentials print the desktop URL
on stderr and wait for interaction in the **foreground Porter tab**. Sign into the desktop, complete
verification and Porter login there, and leave Chromium running. A successful login requires Porter's
exact origin and visible staff search controls. Inconclusive automatic login fails after a bounded
confirmation wait (up to 15 seconds); it does not retry or silently switch to manual login.
Authentication defaults to 600 seconds; use `auth --timeout` or keep-alive `--auth-timeout` to change it.
Standalone searches use the default authentication deadline. Partial credentials fail validation.

Searches do not require keep-alive. When a resident is available on the same machine/OS user and
with the same endpoint/state directory, searches reuse its serialized IPC queue. Otherwise a command
attaches independently, with endpoint-scoped local ownership locking. Concurrent independent commands
fail busy; there is no cross-machine lock. Use a consistent endpoint and one controlling CLI machine.
Keep-alive defaults to 60 seconds (`30 <= interval < 120`); confirmed expiry permits bounded
reauthentication. A submitted search is never replayed. Ctrl-C, duration expiry and failures remove
local session ownership and disconnect, preserving the Docker browser.

The volume persists browser state, but Porter may still expire authentication, and session-only
cookies may not survive a browser restart. No successful Cloudflare clearance is promised.
Live Coolify desktop input, Porter login, two heartbeats and independent searches must be verified
on the deployed service. Automated doubles and local container checks alone do not establish this.

The former `browserless-cdp` mode has been removed. Replace it with `remote-chromium` and the two
`REMOTE_CHROMIUM_*` settings above; remove `BROWSERLESS_CDP_*` settings. BAP remains the default,
and `--browser local` retains its existing behavior. Local/remote consolidation is deferred until
remote operation is verified.

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
| `flyporter auth`                                               | BAP/remote Chromium login check; local login followed by maintenance | `--timeout <seconds>` (600); `--interval <seconds>` (local auth only: 240)                               |
| `flyporter session keep-alive`                                 | Maintain the selected backend in the foreground                     | `--interval <seconds>` (BAP/remote Chromium 60, local 240); `--auth-timeout <seconds>` (600); `--duration <seconds>` |
| `flyporter search porter <origin> <destination> <date>`        | Retrieve one-way staff availability                                 | `--json`                                                                                            |
| `flyporter search other-airline <origin> <destination> <date>` | Currently unsupported                                               | Exits with code 7                                                                                   |

`--browser bap|local|remote-chromium` is a global option. To see the installed CLI's help:

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

BAP and remote Chromium debug logging, screenshots and control metadata are **disabled by default**, including on failure.
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
