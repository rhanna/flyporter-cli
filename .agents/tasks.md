# Tasks

## Active

- [ ] Make the self-hosted Docker workflow usable after live challenge-loop diagnostics.
  - Test supported headed Chromium launch, emit the verified local native mouse-capable viewer
    link directly, preserve bounded authentication and confirm actual staff access/search if possible.
  - Implemented: headed launch default (`BROWSERLESS_CDP_HEADLESS=false`), separate mode scope,
    configurable auto/web/chrome viewer selection, corrected native link and mouse instructions.
    All 85 tests, lint, type checking, formatting, whitespace and relative-link checks pass.
  - Live: v2.58.1's Xvfb is running and headed mode removes HeadlessChrome from the user agent.
    First isolated probe reached credential entry but failed handoff because the temporary container
    lacked EXTERNAL; it was cleaned up. Corrected probe submitted once and handed off at a challenge.
    User confirmed native mouse input works but the headed challenge still loops. The test process
    was stopped, owned browser closed and temporary container removed. No heartbeat/search checks
    ran because authentication never succeeded. Comparing alternative libraries before more integration.
    Evidence: artifacts/2026-11-04T22-42-57.803Z-98113 and
    artifacts/2026-11-04T22-44-40.655Z-98159. No successful authentication/search claimed yet.

## Backlog

- [ ] Verify self-hosted CDP against the user's Coolify deployment when its endpoint is available.
  - Confirm the generated DevTools link supports screencast clicks/typing and manual login;
    verify two heartbeats, a separate CLI flight search on the same browser and remote cleanup.
  - No self-hosted endpoint or Docker executable was available during implementation. The
    free-image source and simulated tests do not establish live viewer/CAPTCHA compatibility.
  - Local finding (2026-11-04): User reached the built-in screencast but Cloudflare's iframe did not
    accept clicks. An isolated v2.58.1 cross-origin iframe fixture reproduced lost input with the
    bundled viewer's legacy touch path; normal mouse input clicked the same iframe button.
    Child targets reject Emulation.setEmitTouchEventsForMouse. Current upstream DevTools uses
    Input.dispatchMouseEvent with a mouse/touch selector. Native Chrome DevTools is a proposed
    workaround; the user's Cloudflare challenge and native viewer have not been verified.
  - Native-viewer disconnect diagnostic: Logs show reconnect requests for an already-closed page
    target after the approximately 600-second auth lifetime. Authenticated handshake probes against
    the current Porter target accepted both `http://localhost:3000` and `devtools://devtools` origins,
    and no-Origin requests. Do not add a wildcard origin flag based on the generic DevTools error.
    Use a fresh target/link after restarting auth; a longer auth timeout can allow manual testing.
  - Follow-up: The provided target was still active. An isolated Chrome 156 native frontend probe
    identified a CSP block for ws://localhost; using ws://127.0.0.1 and omitting the extra top-level
    token parameter connected successfully (one WebSocket, 265 received protocol messages, no console
    errors). Preserve token inside the encoded ws value. README records the corrected local workaround.
    This verifies native connectivity, not successful Cloudflare clearance.
  - User confirmed native mouse input works, but challenges loop. Live read-only page diagnostics
    show HeadlessChrome in the user agent, navigator.webdriver=true, cookies enabled, touchPoints=0
    and a visible challenge. Browserless logs show repeated HTTP 403 responses for staff search.
    Current free-image runtime has not achieved clearance. Cloudflare documents automated browsers
    as unsupported for production challenges. Investigate a headed runtime or use existing local/BAP
    paths; do not report authentication/search success or infer that repeated clicks solve the loop.

- [ ] Review existing ESLint/Cheerio dependency-chain advisories separately.
  - Verification: `npm audit` reports 9 advisories (8 high, 1 moderate) through ESLint and
    Cheerio/Undici; no automatic dependency upgrades were included in the browser migration.

## Done

- [x] Correct the pinned Browserless image's timeout setup after immediate HTTP 408 failures.
  - Cause: v2.58.1 passes `TIMEOUT=-1` to queue's truthy timer guard, so setTimeout fires immediately.
    README now uses `TIMEOUT=0`, which disables that timer in this version.
  - Live verification (2026-11-04): Started an isolated local v2.58.1 container with TIMEOUT=0,
    connected through real Playwright CDP, opened about:blank and confirmed the connection remained
    alive. Closed the remote browser and removed the temporary container. No Porter login/search
    or viewer interaction was performed. Source reviewed queue, limiter, router and config behavior;
    diff whitespace check passed. Application code unchanged; automated tests were not rerun.

- [x] Add self-hosted Browserless CDP with automatic login and interactive DevTools handoff.
  - Branch: `feat/browserless-cdp`; kept separate from main. BAP remains default; local/BAP tests preserved.
  - Behavior: Third adapter uses Playwright CDP and reuses the verified local Porter search flow.
    Optional credentials are submitted once; challenges/MFA/unconfirmed login offer a sensitive
    exact-target debugger link, while recognized rejection fails. Authentication verifies staff
    controls. Auth remains resident with configurable 60-second heartbeats and optional bounded
    keep-alive duration; expiry pauses queued work for reauthentication. Searches require the
    resident. Shared restricted state, locking and IPC moved to `src/resident-session.js` with BAP
    compatibility reexports. Transport loss fails explicitly; cleanup attempts CDP Browser.close.
  - Docs: Environment example, README Coolify service/configuration and usage, architecture and
    existing feature specs updated. Source-reviewed free Chromium v2.58.1 routes; no Enterprise APIs.
  - Verification: All 82 automated tests pass, including automatic/manual/rejected/expired auth,
    owned-target discovery, URL encoding/validation, missing viewer, no replay, bounded shutdown,
    IPC sharing/serialization and cleanup. ESLint, type checking, scoped formatting, diff whitespace,
    64 relative Markdown links and configured-secret scan pass. No dependencies added.
  - Live: Not run; no configured self-hosted service or Docker executable. No live artifacts created,
    no booking/purchase, and no new promise that the free image clears Cloudflare. Live follow-up above.

- [x] Investigate command latency and make BAP debugging/screenshots opt-in.
  - Behavior: `FLYPORTER_DEBUG=1`/`true` enables redacted events, masked screenshots and control
    metadata. Default reporting does no diagnostic filesystem, stderr or remote-browser work,
    including on failures. Normal errors/status and authentication/CAPTCHA/results checks remain.
    Resident capture uses the owner's setting. Enabled screenshot events include timing.
  - Analysis: Existing live logs `artifacts/2026-10-29T23-39-53.788Z-79727/` and
    `artifacts/2026-10-29T23-40-57.934Z-79801/` show 16 and 11 snapshots (64 and 44 remote diagnostic
    calls) over logged spans of 43.45 and 29.90 seconds. These are partial workflow spans,
    not isolated screenshot timings or a measured speedup. Login/navigation, CAPTCHA solving,
    autocomplete and serial remote calls also contribute. Reconnect retention does not sleep;
    individual timeout ceilings can accumulate on failures.
  - Verification: All 64 simulated tests, ESLint, type checking, formatting and diff checks pass.
    Tests verify no diagnostic work by default, explicit enablement, masking order and redaction.
    No new live search or before/after speed benchmark was run for this change.

- [x] Expand README usage instructions for setup, searches, backend selection and sessions.
  - Behavior: Added a minimal BAP setup, automatic-login search walkthrough, JSON export,
    configurable reuse examples, two-terminal keep-alive instructions, local-mode selection,
    command reference, troubleshooting and exit-code descriptions.
  - Verification: Compared commands/options against actual CLI help and configuration; all 61
    tests and ESLint pass. README formatting, relative links and diff whitespace checks pass.
    Live searches were not rerun for this documentation-only change.

- [x] Add BAP as default alongside local Playwright, reconnect reuse and foreground keep-alive.
  - Branch: `feat/migrate-browser-to-bap`; kept separate from the default branch.
  - Behavior: Both adapters preserve normalized tables/JSON and error codes. BAP retains a
    configurable 60000 ms reconnect window, or closes immediately at zero. Foreground keep-alive
    supports both backends, serializes BAP searches/heartbeats through authenticated local IPC,
    and supports duration limits. Local Playwright and its tests remain available.
  - Verification: 61 automated tests pass, including DOM-executed remote expressions, solver
    outcomes, stale/malformed results, credential redaction, lifecycle failures, locking, IPC,
    expiry recovery, calendar state and shutdown. JSDoc/SDK type check, ESLint, scoped formatting
    check and documentation links pass. These tests are simulated, not live-site evidence.
  - Live verification (2026-10-29 UTC): Login, supported Cloudflare solving and staff access
    succeeded. YTZ-YUL search for 2026-11-05 confirmed three flights with seat counts. A subsequent
    independent CLI invocation logged `session-resumed`, skipped credential entry and completed
    another search. Foreground keep-alive served two separate CLI JSON searches, each with three
    flights, with two heartbeat reports; SIGINT exited zero. A separate two-second duration run
    exited zero with the corrected transport cleanup path. No booking or purchasing occurred.
  - Evidence: `artifacts/2026-10-29T23-23-52.805Z-78785/` (standalone results),
    `artifacts/2026-10-29T23-25-46.802Z-78888/` (reconnect),
    `artifacts/2026-10-29T23-29-28.640Z-79055/` (resident searches and repeated screenshots),
    `artifacts/2026-10-29T23-33-14.583Z-79377/` (bounded shutdown). Artifacts are gitignored.
  - Findings: Live controls required Twitter Typeahead suggestions and the single-date picker
    selector; Porter's calendar must commit React state, not just typed text. Exact station codes
    are reaffirmed through the existing local adapter's verified view-model methods. Reconnect
    endpoints may include encrypted route prefixes. Passive Cloudflare interstitials must clear
    even when the solver reports no widget.
  - Limits: Earlier runs hit Porter temporary-error pages, unresolved challenges and one resumed
    WebSocket RSV1 framing error. They failed explicitly and attempted cleanup. An unusable resumed
    transport can recover once before credential/search submission; searches are never replayed.
    Provider absolute session limits still apply. Expiry recovery and no-availability are simulated
    test cases; Windows and the local Chrome backend were not newly live-tested in this migration.

- [x] Integrate the coding-agent framework and document existing behavior.
  - Context: Imported the pinned template, adapted repo-specific instructions, and populated
    the project spec, five feature specs, and architecture overview without runtime changes.
  - Files: `AGENTS.md`, `.agents/`, `docs/architecture/overview.md`.
  - Verification: `npm test` passed all 28 tests; `npm run lint` passed. Checked all 14
    Markdown files for valid relative links and verified the four required feature-spec headings.
    Documentation was reviewed against source and existing tests; tracked application files
    were unchanged.
  - Skipped: Live Porter login/search checks; documentation-only changes do not require an
    authenticated account or Chrome session, and automated tests do not verify the live site.

---

Convention: when starting a task, move it to Active and add relevant context.
When done, move it to Done with verification notes.
