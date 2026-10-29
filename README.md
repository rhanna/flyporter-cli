# FlyPorter staff-travel CLI

Retrieve Porter staff flight availability and existing standby requests as masked terminal tables
or normalized JSON. Choose Browserless BAP (default) or the original local Playwright/Chrome backend.
No booking or purchasing operations are implemented. Other-airline search remains unsupported.

## Install and configure

Requires Node.js 20+ and npm 11.10+ for the BAP SDK. Local mode additionally needs Google Chrome.

```sh
npm install
npm link
# Fresh setup only: preserve an existing .env.
cp .env.example .env
```

Set `BROWSERLESS_TOKEN`, `PORTER_USERNAME` and `PORTER_PASSWORD` for BAP. The default endpoint is
`wss://production-sfo.browserless.io/stealth/bql`; Browserless stealth/CAPTCHA access is required.
Keep tokens out of the endpoint. Shell environment variables take precedence over `.env`.
`BROWSERLESS_API_TOKEN`, `FLYPORTER_USERNAME`/`FLYPORTER_PASSWORD`, and `USERNAME`/`PASSWORD` are
supported aliases, in that order after the canonical names. Quote dotenv values containing `#`.

## Search

```sh
flyporter search porter YTZ YUL 2026-11-05
flyporter search porter YTZ YUL 2026-11-05 --json
```

BAP resumes a recently retained session or creates one and logs in once. Each workflow uses one
remote browser/page for authentication, form interaction and availability capture. Searches select
one-way travel and the account-holder passenger. Airport/city codes require three letters and dates
require a valid `YYYY-MM-DD` calendar date. Use a future date for real searches.

Terminal tables mask employee, reference employee and VIPorter identifiers. `--json` returns the
complete normalized records, including those identifiers, for authorized scripting. Debug messages
go to stderr so JSON stdout remains machine-readable. Missing/stale/malformed availability responses
are failures; the CLI does not report success solely because a form was submitted.

## Session reuse and authentication

```sh
flyporter auth
```

In BAP mode, this performs a login check and exits. Successful auth and standalone searches retain
the browser for `BAP_RECONNECT_TIMEOUT_MS` (default **60000**, one minute) after disconnecting.
The next call can reuse it. Set this to `0` to close immediately. Session references are stored with
restricted permissions under `~/.config/flyporter/<account-scope>`; override the parent directory with
`FLYPORTER_STATE_DIR`. Account, token and endpoint changes select a different cache scope.

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
flyporter session keep-alive
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
