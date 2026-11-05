# Authentication and Keep-alive Spec

## Responsibility

Own interactive authentication and resident session refresh in
[src/auth.js](../../../src/auth.js) and [src/session.js](../../../src/session.js).
Command orchestration is in [src/cli.js](../../../src/cli.js).
Existing coverage: [auth tests](../../../test/auth.test.js) and
[session tests](../../../test/session.test.js).

## BAP Behavior

- `auth` logs in once, confirms staff entitlement, retains the configured reconnect window, and exits.
- `session keep-alive` holds a paid remote session until Ctrl-C or `--duration` seconds, including
  startup. Default heartbeat is 60 seconds; require `30 <= interval < 120`.
- BAP search uses a resident process if available, otherwise resumes or opens a remote session.
  Resume verifies authentication; Porter expiry permits a single credential submission.
- CAPTCHA outcomes are absent, solved, failed or unknown. Explicit Cloudflare markers select the
  supported Cloudflare solver; otherwise auto-detect without waiting for an absent widget.
  A separate bounded wait requires challenge markers to disappear, including passive interstitials.
- No duplicate login submission within an invocation. A resident heartbeat may reauthenticate once
  after confirmed expiry; failure exits rather than retrying indefinitely.
- Invalid credentials, MFA, missing staff access, challenges, and provider session loss fail explicitly.
- IPC uses a restricted Unix socket or Windows named pipe plus a random credential in the restricted
  resident descriptor. Shutdown removes the descriptor and closes the remote connection.

## Self-hosted CDP Behavior

- Credentials use the existing Porter aliases, but are optional as a pair. Missing both triggers
  manual sign-in; partial credentials fail configuration validation.
- Submit at most once per authentication attempt. Recognized credential rejection fails; CAPTCHA,
  MFA or no confirmed outcome within 15 seconds triggers interactive handoff. No automatic solver.
- Generate the exact page's built-in DevTools link using CDP target ID plus authenticated
  `/sessions` metadata; validate source origins, target and viewer resource before printing.
  The link includes the instance token, is sensitive, and is never stored/logged as a diagnostic.
- Local HTTP defaults to a native `devtools://` link for Google Chrome. Its nested WebSocket
  uses 127.0.0.1 to satisfy native DevTools CSP and omits the redundant top-level token. Handoff
  instructions specify Use mouse: the pinned image's legacy touch input failed ordinary iframe tests.
- The user enables DevTools screencast, signs in and closes the viewer. Success requires the exact
  Porter origin, staff route and visible search controls. A staff landing page alone is insufficient.
- `auth` remains resident. `auth --timeout` and keep-alive `--auth-timeout` default to 600 seconds;
  heartbeats default to 60 seconds, requiring 30 <= interval < 120. Keep-alive supports duration.
- Confirmed expiry pauses the serial queue while reauthentication runs on the same page. Pending
  searches are not submitted until authentication completes; submitted searches are never replayed.
- Live viewer input and Porter clearance depend on the deployed image/proxy and are not guaranteed.

## Local Chrome Behavior

- Navigate to `https://www.flyporter.com/en-ca/staff`. Return immediately if the resulting
  pathname is /en-ca/staff or begins /en-ca/staff/.
- Otherwise notify the caller, wait for a matching staff URL, and wait for the challenge to clear.
  The default authentication wait is 600 seconds. Failure in this waiting stage raises
  `AuthenticationError`; navigation errors can propagate separately.
- Staff URL recognition checks pathname, not hostname.
- Keep-alive performs a credentialed, no-store GET of the staff page in the browser.
  A missing result or non-staff path raises `SessionExpiredError`; a staff result with status
  outside 200–399 raises `AuthenticationError`.
- The loop sends a heartbeat immediately, reports success, and sleeps for the interval.
  Default is 240 seconds; CLI intervals must be finite positive numbers of at least 30 seconds.
- On any heartbeat/verification error, call onExpired. If reauthentication is provided,
  await it and retry immediately; otherwise propagate the error.
  A failed reauthentication propagates.
- `auth` launches Chrome; `session keep-alive` attaches first or launches if unavailable.
  Both authenticate before entering the loop and supply interactive reauthentication callbacks.
- SIGINT/SIGTERM abort the loop/sleep. Finally remove signal handlers and close the adapter
  according to [browser ownership](browser-session.md).

## Data Model

- Authentication returns `{ authenticated: true }`.
- Heartbeat results are `{ url, status }`.
- Loop inputs include intervalMs, AbortSignal, onHeartbeat, onExpired, and reauthenticate.
  Callbacks report state; no session record is stored by Node.js.

## Known Risks

- Keep-alive reduces idle expiry but cannot override an absolute server-side lifetime.
- The loop treats transport and verification failures as reasons to reauthenticate.
- Abort does not interrupt an in-progress browser call or authentication wait.
- A matching staff pathname is the implementation's authentication signal, not an independent
  verification of account identity or permissions.
