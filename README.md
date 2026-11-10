# FlyPorter staff-travel CLI

Retrieve one-way Porter staff flight availability and existing standby records as masked terminal
tables or normalized JSON. The CLI does not book flights, purchase tickets or create standby requests.
Other-airline/myIDTravel searches use explicit carriers and automatic account-holder R2 cabin coverage.

## Choose a browser mode

| Mode                                                    | Browser runs in                                    | Login                                                                  | What you need                                                            |
| ------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`bap`](#mode-1-browserless-bap) — default              | Browserless cloud                                  | Automatic, with the provider's supported CAPTCHA solver                | Browserless stealth/BAP access, token and Porter credentials             |
| [`local`](#mode-2-local-google-chrome)                  | Google Chrome on your computer                     | Interactive in the Chrome window                                       | Installed Google Chrome and an authorized Porter account                 |
| [`remote-chromium`](#mode-3-persistent-docker-chromium) | A persistent Docker container, locally or on a VPS | Automatic when credentials are configured; desktop handoff when needed | Docker Chromium, a private CDP endpoint and a browser-accessible desktop |

All three modes return the same flight/standby output. They differ in setup, authentication and browser
lifetime. **`remote-chromium` also covers Docker running on your own computer**; `local` means the
separate, existing Google Chrome workflow.

- [Install and configure](#install-and-configure)
- [Mode 1: Browserless BAP](#mode-1-browserless-bap)
- [Mode 2: Local Google Chrome](#mode-2-local-google-chrome)
- [Mode 3: Persistent Docker Chromium](#mode-3-persistent-docker-chromium)
- [Keep-alive and concurrent commands](#keep-alive-and-concurrent-commands)
- [Search output](#search-output)
- [Troubleshooting](#troubleshooting)

## Install and configure

Use Node.js 20+; BAP additionally requires npm 11.10+. Run these commands from the repository root:

```sh
npm install
npm link
# Preserve an existing .env; create one only if missing.
test -f .env || cp .env.example .env
```

`npm link` installs the `flyporter` command. Without it, replace `flyporter` with
`node bin/flyporter.js` in every example. Docker Compose files belong to the repository, so use the
repository root for Docker commands too.

Edit `.env` using the configuration for your chosen mode below. **`.env` is loaded from the current
working directory**, including when using the linked command. Keep credentials out of Git.

Browser selection follows this order:

1. Explicit `--browser bap|local|remote-chromium`.
2. `FLYPORTER_BROWSER` in your environment or `.env`.
3. `bap` by default.

Exported shell variables override `.env`. If you previously exported settings while testing, changing
`.env` will not replace them; unset those variables or open a fresh terminal. There is no automatic
fallback between modes.

Examples below use `2026-12-01`. Replace it with your intended **future travel date**. Origin and
destination must be three-letter airport/city codes, and dates must use `YYYY-MM-DD`.

## Mode 1: Browserless BAP

### Setup

You need a Browserless token with stealth/BAP and supported CAPTCHA-solving access, plus your Porter
staff credentials. Neither Docker nor local Chrome is needed.

Set these values in `.env`:

```dotenv
FLYPORTER_BROWSER=bap
BROWSERLESS_TOKEN=your_browserless_token
BROWSERLESS_ENDPOINT=wss://production-sfo.browserless.io/stealth/bql
PORTER_USERNAME=your_porter_username
PORTER_PASSWORD="your_porter_password"
BAP_RECONNECT_TIMEOUT_MS=60000
```

`BROWSERLESS_ENDPOINT` is optional when using the default shown above. It must be a credential-free
`wss://` URL ending in `/bql`; do not put the token in it. Quote passwords containing `#`.

### Authenticate and search

A search authenticates automatically; you do not need to run `auth` first:

```sh
flyporter --browser bap search porter YTZ YUL 2026-12-01
flyporter --browser bap search porter YTZ YUL 2026-12-01 --json
```

For an optional login check:

```sh
flyporter --browser bap auth
```

BAP `auth` exits after confirming login. Successful standalone commands retain the remote browser
for **60,000 milliseconds (one minute)** by default, allowing a later command to reconnect. Porter
login is checked again on reuse. To close immediately instead:

```dotenv
BAP_RECONNECT_TIMEOUT_MS=0
```

No background heartbeat runs after a standalone command exits. For a continuously maintained session,
run this in one terminal and search from another:

```sh
flyporter --browser bap session keep-alive --interval 60
```

**Billing:** BAP keep-alive and disconnected retention consume provider resources; reconnects and
CAPTCHA/proxy usage may incur additional charges. Normal keep-alive shutdown closes the remote browser
without retaining it. Provider absolute session limits and Porter expiry still apply. See
[Browserless reconnects](https://docs.browserless.io/bap/session-management/reconnects) and
[unit consumption](https://docs.browserless.io/overview/unit-consumption).

## Mode 2: Local Google Chrome

### Setup

Install Google Chrome. Browserless tokens and environment-stored Porter credentials are not required;
you sign in through the Chrome window.

Select local mode in `.env` if you want it as your default:

```dotenv
FLYPORTER_BROWSER=local
```

The CLI uses a dedicated Chrome profile and debugging port, separate from your normal browser profile.
Optional overrides are:

```dotenv
FLYPORTER_CHROME_DEBUG_PORT=9223
# Set only if you need a custom profile or Chrome executable.
# FLYPORTER_CHROME_PROFILE=/absolute/path/to/flyporter-profile
# FLYPORTER_CHROME_PATH=/absolute/path/to/chrome
```

On macOS, the default profile is `~/Library/Application Support/flyporter/chrome-profile`.

### Authenticate and search in two terminals

**Terminal 1:** start Chrome and complete Porter login/verification in the opened window:

```sh
flyporter --browser local auth --interval 60
```

Wait for successful authentication, then leave this terminal and Chrome running. Unlike BAP and
remote Chromium, **local `auth` continues into foreground keep-alive**.

**Terminal 2:** from the same repository directory and with the same profile/port settings:

```sh
flyporter --browser local search porter YTZ YUL 2026-12-01
flyporter --browser local search porter YTZ YUL 2026-12-01 --json
```

Searches attach to the running Chrome instance, use their own tab, then close that tab and disconnect.
They do not launch Chrome themselves. A saved profile alone is not a substitute for a running,
authenticated browser.

Instead of `auth`, you can explicitly start maintenance, attaching to an existing Chrome instance
or launching one when absent:

```sh
flyporter --browser local session keep-alive --interval 60 --duration 1800
```

Ctrl-C stops maintenance. If that command launched Chrome, cleanup also terminates that Chrome
process. If it attached to an existing browser, cleanup closes its own tab and leaves Chrome running.

## Mode 3: Persistent Docker Chromium

This mode uses [jlesage/chromium](https://github.com/jlesage/docker-chromium/tree/v26.08.2), with its
profile stored in `/config`. You can run the same image locally or on Coolify.

Docker owns the browser lifecycle. **Start the container yourself before running the CLI.** The CLI
currently does not launch Docker, manage SSH tunnels or shut down idle containers. Each command
attaches to the existing default browser context and owns only its tab. Cleanup disconnects and
preserves Chromium; if its tab is the last open one, it leaves the tab blank instead of closing it.

### Option A: Run Docker locally

You need Docker with Compose. Start the local service from the repository root:

```sh
docker compose -p flyporter-local -f deploy/compose.chromium.local.yaml up -d
```

Wait for Chromium to start. Check CDP connectivity:

```sh
curl --fail http://127.0.0.1:19222/json/version
```

A successful response contains browser information and `webSocketDebuggerUrl`. Open
[http://127.0.0.1:15800](http://127.0.0.1:15800) for the desktop. This local Compose file binds both
ports to loopback and disables desktop authentication; do not expose this configuration publicly.

Configure `.env`:

```dotenv
FLYPORTER_BROWSER=remote-chromium
REMOTE_CHROMIUM_ENDPOINT=http://127.0.0.1:19222
REMOTE_CHROMIUM_DESKTOP_URL=http://127.0.0.1:15800
PORTER_USERNAME=your_porter_username
PORTER_PASSWORD="your_porter_password"
# A short state path avoids Unix socket path-length limits during keep-alive.
FLYPORTER_STATE_DIR=/tmp/flyporter-local-state
```

The named volume `flyporter-local_chromium-local-config` preserves the profile across container
stop/start. To stop or resume the service:

```sh
docker compose -p flyporter-local -f deploy/compose.chromium.local.yaml stop
docker compose -p flyporter-local -f deploy/compose.chromium.local.yaml start
```

Do not add `-v` to `docker compose down` unless you intend to delete the profile volume. Browser state
persists, but Porter authentication can expire or require login after a browser restart.

### Option B: Run Docker on Coolify

1. Create a Compose service using [deploy/compose.chromium.yaml](deploy/compose.chromium.yaml).
   Set `CHROMIUM_DESKTOP_USERNAME` and `CHROMIUM_DESKTOP_PASSWORD` as Coolify secrets. These protect
   the desktop and are separate from your Porter credentials.
2. Route your public HTTPS desktop domain, for example `https://chromium.example.com`, to container
   port **5800**. Enable HTTPS redirection and WebSocket forwarding. Keep upstream HTTP confined to
   the private Coolify proxy network; the example permits HTTP desktop authentication only because
   Coolify terminates HTTPS. Do not publish port 5800 directly.
3. Preserve the `chromium-config` volume mounted at `/config` when redeploying. If replacing it with
   an existing bind mount, set `CHROMIUM_USER_ID`/`CHROMIUM_GROUP_ID` to its owner (default 1000/1000).
4. Keep CDP private. The supplied file binds VPS port 9222 to **VPS loopback only**. From your CLI
   machine, open this SSH tunnel and leave its terminal running:

   ```sh
   ssh -N -o ExitOnForwardFailure=yes \
     -L 127.0.0.1:9222:127.0.0.1:9222 user@your-vps
   ```

Configure the CLI machine's `.env`:

```dotenv
FLYPORTER_BROWSER=remote-chromium
REMOTE_CHROMIUM_ENDPOINT=http://127.0.0.1:9222
REMOTE_CHROMIUM_DESKTOP_URL=https://chromium.example.com
PORTER_USERNAME=your_porter_username
PORTER_PASSWORD="your_porter_password"
```

Check the tunnel with `curl --fail http://127.0.0.1:9222/json/version`. A CLI container on the same
private Docker network may use `http://chromium:9222` instead; attach it to the browser service's
actual Coolify network. CDP grants browser control without authentication, so do not give it a public
port or domain. The desktop URL must be reachable by the person completing login.

### Authenticate and search with either Docker setup

Run an optional login check, or go straight to a search:

```sh
flyporter --browser remote-chromium auth --timeout 600
flyporter --browser remote-chromium search porter YTZ YUL 2026-12-01
flyporter --browser remote-chromium search porter YTZ YUL 2026-12-01 --json
```

Both `auth` and standalone searches exit when finished. **No separate keep-alive process is required
for searches.** Authentication visits the staff landing page before verifying the search page, reuses
existing browser state, or submits configured credentials once.

CAPTCHA, MFA or absent credentials print the desktop URL on stderr. Open it and complete sign-in in
the foreground Porter tab while the CLI waits. There is no automatic CAPTCHA solver in this mode.
For entirely manual login, remove both Porter credentials and all their aliases from the environment
and `.env`; a partial username/password pair is rejected.

Recognized credential rejection fails immediately. Inconclusive automatic login fails after a bounded
confirmation wait; it does not resubmit credentials or silently switch to manual login. Authentication
defaults to 600 seconds; `auth --timeout` and keep-alive `--auth-timeout` override that deadline for
those commands. Standalone searches use the default authentication deadline.

Both remote URLs are required and must omit credentials, query strings and fragments. The endpoint
accepts an HTTP(S) CDP base or a browser-level `ws(s)://.../devtools/browser/<id>` URL, never a page
target. Prefer HTTP discovery so browser IDs are refreshed after restarts. Browserless tokens and
`BAP_RECONNECT_TIMEOUT_MS` do not apply to this mode.

Local Docker authentication, searches, keep-alive and profile persistence have been live-tested.
Coolify/VPS connectivity, protected desktop input and CAPTCHA/MFA interaction still require deployment
verification. The old `browserless-cdp` backend was replaced by `remote-chromium`; remove its old
`BROWSERLESS_CDP_*` settings when migrating.

## Keep-alive and concurrent commands

Keep-alive is a **foreground CLI process** that authenticates and periodically requests Porter's staff
page using browser-owned cookies. Docker running by itself does not maintain the Porter login.

| Mode              | Default interval | Allowed interval                  | What happens when maintenance stops                             |
| ----------------- | ---------------- | --------------------------------- | --------------------------------------------------------------- |
| `bap`             | 60 seconds       | At least 30 and below 120 seconds | Remote browser is closed without disconnected retention         |
| `local`           | 240 seconds      | At least 30 seconds               | CLI-launched Chrome is terminated; attached Chrome is preserved |
| `remote-chromium` | 60 seconds       | At least 30 and below 120 seconds | CLI tab/connection is cleaned up; Docker Chromium stays running |

For example, with either Docker setup configured above:

**Terminal 1:**

```sh
flyporter --browser remote-chromium session keep-alive --interval 60
```

Wait for `Session refreshed`, then leave that terminal running.

**Terminal 2:** from the same directory, with the same endpoint and state-directory configuration:

```sh
flyporter --browser remote-chromium search porter YTZ YUL 2026-12-01 --json
```

To stop maintenance after 30 minutes instead of waiting for Ctrl-C:

```sh
flyporter --browser remote-chromium session keep-alive --interval 60 --duration 1800
```

`--duration` is in seconds and includes startup/authentication. `--auth-timeout` defaults to 600
seconds. Confirmed expiry permits reauthentication; authentication/transport failures can end the
workflow. Keep-alive reduces idle expiry but cannot override Porter's absolute session lifetime.

BAP and remote Chromium search commands discover an existing resident through authenticated **local
IPC**. Use the same machine, OS user and state-directory configuration; remote Chromium also requires
the same endpoint, and BAP the same account/token/endpoint scope. Searches and heartbeats share one
page and execute serially. You can submit multiple commands while maintenance runs, but they queue;
this is not parallel search execution. Without a resident, competing standalone commands fail with
“Browser session is busy.” Local Chrome searches use separate tabs and do not use this IPC queue.

The owner creates a restricted `lock.json` with its process ID and releases it on normal cleanup.
Locks from exited processes can normally be recovered. State defaults to `~/.config/flyporter/<scope>`;
`FLYPORTER_STATE_DIR` changes its parent. Use a short path on Unix to avoid socket path-length errors.
Locks are local; separate machines or different endpoint/state aliases do not coordinate access.
Cookies stay in the browser and account credentials are not cached in these state files.

## Search output

```sh
# Example using BAP; select your configured mode explicitly.
flyporter --browser bap search porter YTZ YUL 2026-12-01
flyporter --browser bap search porter YTZ YUL 2026-12-01 --json
# Save full JSON; status/errors remain on stderr for searches.
flyporter --browser bap search porter YTZ YUL 2026-12-01 --json > flights.json
```

Tables show route, flight numbers, departure/arrival, seat counts and standby counts. Equipment
is available in JSON output.
Employee, reference employee and VIPorter identifiers are masked in terminal tables. **JSON includes
full normalized identifiers**, so handle exported files as personal data. An empty result is reported
as no flights; missing, stale or malformed responses are errors rather than empty availability.
Seat counts describe availability at search time, not a booking guarantee. Submitted searches are not
replayed automatically.

### Other airlines

Use explicit two-character airline codes. The command reuses Porter authentication through the
`/staff/otherairlines` SSO flow; it needs no separate myIDTravel credentials or settings.
It searches one-way R2 standby travel for the account holder, discovering the account/carrier/status
cabin choices from myIDTravel. Airlines execute in your order, cabins in the returned choice order,
sequentially. There is no cabin option and `ALL` is rejected.

```sh
flyporter search other-airline YYZ YVR 2026-11-12 --airline WS
flyporter search other-airline YYZ YVR 2026-11-12 --airline WS,TS
flyporter --browser remote-chromium search other-airline YYZ YVR 2026-11-12 --airline WS --details --json
```

Tables show one itinerary per searched airline with actual segment routes, departure/arrival times in `YYYY-MM-DD HH:MM`, stops
and one colour indicator per cabin. Times retain their source local time; full timestamps and offsets
remain in JSON. Tables label cabins Economy, Premium Economy, Business and First
instead of Y, W, C and F; JSON retains the codes. Inventory and segment indicators remain in JSON. Indicators are `GREEN` (site `HIGH`), `YELLOW` (`MID`) and
`RED` (`LOW`), with `UNKNOWN` for unpublished indicators. They are guidance, not boarding guarantees.
JSON retains independent eligibility fields and booking-class quantities. Fare buckets must not be added or
interpreted as exact empty-seat totals. Negative, missing and placeholder quantities are undisclosed;
raw values remain in JSON. A flight missing from a successful cabin search is **not returned**, not
zero seats. Cabins outside the discovered coverage are **not offered**.

`--details` adds published loads, seat availability and standby information when available. Tables
omit passenger names and free text. **Detailed JSON can contain personal passenger data**; protect
saved files. Session values, SSO payloads and account profiles are excluded from results.

JSON retains `{ query, searchedAt, flights }` and adds `complete` and per-airline/cabin `searches`
with `success`, `partial`, `failed` or `skipped` status and structured stage errors. A successful empty
search is successful coverage. Incomplete searches/details print collected results and exit **6**;
tables prominently show incomplete coverage. The coverage table appears only when an operation is
partial, failed or skipped; it is hidden when every search succeeds. Unknown coverage is never reported as zero availability.
Authentication, unresolved challenge and transport failures stop subsequent operations without replay.
Startup/authentication/configuration errors retain the existing exit behavior.

BAP/remote Chromium resident searches use the existing serial queue. Restart an older keep-alive
process if it reports unsupported providers. Recoverable failures restore Porter before maintenance
continues; fatal failures deliver collected results before shutdown. The workflow only prepares
searches and requests schedules/details; it never selects flights or advances into booking/payment.

The implementation uses recorded request contracts and current myIDTravel application state.
Live cabin coverage, details and resident reuse on all three backends still need acceptance checks;
see [.agents/tasks.md](.agents/tasks.md). Synthetic browser tests do not establish live-site success.

## Configuration reference

See [.env.example](.env.example) for the full list of settings.

| Settings                                                                           | Applies to            | Purpose                                                  |
| ---------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------- |
| `FLYPORTER_BROWSER`                                                                | All modes             | Default backend; explicit `--browser` wins               |
| `PORTER_USERNAME`, `PORTER_PASSWORD`                                               | BAP / remote Chromium | Required for BAP; optional as a pair for remote Chromium |
| `BROWSERLESS_TOKEN`, `BROWSERLESS_ENDPOINT`                                        | BAP                   | Provider token and BQL endpoint                          |
| `BAP_RECONNECT_TIMEOUT_MS`                                                         | BAP                   | Disconnected retention in milliseconds; 0 disables it    |
| `BAP_TIMEOUT_MS`, `BAP_CAPTCHA_TIMEOUT_MS`                                         | BAP                   | Browser operation and CAPTCHA-detection timeouts         |
| `PORTER_*_SELECTOR`, `PORTER_DATE_FORMAT`                                          | BAP                   | Optional site-control overrides                          |
| `FLYPORTER_CHROME_PROFILE`, `FLYPORTER_CHROME_DEBUG_PORT`, `FLYPORTER_CHROME_PATH` | Local Chrome          | Profile, debugging port and executable overrides         |
| `REMOTE_CHROMIUM_ENDPOINT`, `REMOTE_CHROMIUM_DESKTOP_URL`                          | Remote Chromium       | Private CDP endpoint and human-accessible desktop        |
| `FLYPORTER_STATE_DIR`                                                              | BAP / remote Chromium | Parent directory for scoped locks/session references     |
| `FLYPORTER_DEBUG`, `ARTIFACTS_DIR`                                                 | BAP / remote Chromium | Opt-in diagnostics and artifact destination              |

Porter credential aliases are `FLYPORTER_USERNAME`/`FLYPORTER_PASSWORD`, then `USERNAME`/`PASSWORD`;
canonical `PORTER_*` names win. `BROWSERLESS_API_TOKEN` is the fallback token alias for BAP.

## Command reference

| Command                                                        | Behavior / options                                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flyporter auth`                                               | BAP/remote Chromium: login check and exit. Local: login and foreground maintenance. `--timeout` defaults to 600 seconds; local `--interval` defaults to 240. |
| `flyporter session keep-alive`                                 | Foreground maintenance. `--interval`, `--auth-timeout` (600 seconds), optional `--duration` in seconds.                                                      |
| `flyporter search porter <origin> <destination> <date>`        | One-way availability; `--json` emits complete normalized records.                                                                                            |
| `flyporter search other-airline <origin> <destination> <date>` | Required `--airline WS,TS`; automatic cabin coverage; optional `--details`, `--json`.                                                                                                                              |

Put `--browser bap|local|remote-chromium` before the command. Inspect installed help with:

```sh
flyporter --help
flyporter auth --help
flyporter session keep-alive --help
flyporter search porter --help
flyporter search other-airline --help
```

## Troubleshooting

| Symptom                                                         | Check / action                                                                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flyporter: command not found`                                  | Run `npm link` or use `node bin/flyporter.js` from the repository root.                                                                                                                                 |
| Editing `.env` has no effect                                    | Check your working directory and unset matching exported shell variables.                                                                                                                               |
| Missing BAP token/credentials                                   | Check the selected backend and the BAP configuration above. Local Chrome needs neither; remote Chromium needs its two URLs.                                                                             |
| No local Chrome session                                         | Start `flyporter --browser local auth --interval 60`, complete sign-in and leave it running.                                                                                                            |
| Cannot attach to persistent Chromium                            | Start the Docker service; verify the configured CDP port with `/json/version`. For Coolify, check the SSH tunnel or private network.                                                                    |
| CDP discovery/handshake returns HTTP 500 with a Docker hostname | Update FlyPorter: earlier discovery used native fetch, which could discard Chromium's required Host override. Test discovery with `curl --fail -H 'Host: localhost' http://chromium:9222/json/version`. |
| Desktop inaccessible                                            | Local Docker uses port 15800. Coolify uses the protected HTTPS domain routed to container port 5800, with WebSocket forwarding.                                                                         |
| Browser session is busy                                         | Wait for the standalone owner to finish, or run searches through a foreground keep-alive resident. Do not remove a live owner's lock.                                                                   |
| `listen EINVAL` / socket path error                             | Use a short `FLYPORTER_STATE_DIR`, such as `/tmp/flyporter-local-state`, consistently in both terminals.                                                                                                |
| CAPTCHA/MFA                                                     | Remote Chromium: complete it in the foreground desktop tab. Local: use the Chrome window. BAP: check supported solver access.                                                                           |
| Invalid credentials / unconfirmed automatic login               | Check the configured credentials. The CLI does not repeatedly submit failed logins.                                                                                                                     |
| Porter temporary error / no fresh availability                  | Enable diagnostics below and inspect the failure. Do not interpret it as zero seats.                                                                                                                    |
| Keep-alive interval rejected                                    | BAP/remote Chromium require `30 <= interval < 120`; local requires at least 30 seconds.                                                                                                                 |
| Old `browserless-cdp` selection rejected                        | Switch to `remote-chromium` and replace `BROWSERLESS_CDP_*` settings with the new endpoint/desktop settings.                                                                                            |

Success exits with code 0. Failures print `Error [CODE]: message` on stderr:

| Exit code | Meaning                                       |
| --------- | --------------------------------------------- |
| 1         | General CLI/parser error                      |
| 2         | Authentication failure                        |
| 3         | Session expired                               |
| 4         | Browser challenge not cleared                 |
| 5         | Invalid arguments/configuration               |
| 6         | Remote response, transport or cleanup failure |
| 7         | Unsupported operation                         |

### Diagnostics

BAP and remote Chromium diagnostics are disabled by default, including on failure. To enable redacted
events, masked screenshots and control metadata for a standalone command:

```sh
FLYPORTER_DEBUG=1 flyporter --browser remote-chromium auth
```

For searches served by keep-alive, enable debugging on the **keep-alive process**:

```sh
FLYPORTER_DEBUG=1 flyporter --browser remote-chromium session keep-alive --interval 60
```

Artifacts are gitignored under `artifacts/<timestamp>-<pid>` (override with `ARTIFACTS_DIR`); diagnostic
messages go to stderr. Values `0`, `1`, `false` and `true` are accepted. Reset debugging after use:
screenshots add browser calls and latency, and may contain account/standby information despite input
masking. Metadata omits input values, cookies, raw HTML and response bodies. Treat artifacts as private.
Local Chrome does not use this diagnostic reporter.

## Development and verification

```sh
npm test
npm run lint
npm run check
npm run format:check
```

`npm run format` formats the integration files listed in package.json. Tests use local DOM fixtures and
browser doubles; they do not authenticate against Porter. Live evidence and remaining limitations are
recorded in [.agents/tasks.md](.agents/tasks.md).
