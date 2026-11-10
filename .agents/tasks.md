# Tasks

## Active

None.

## Backlog

- [ ] Live-accept other-airline automatic cabin coverage on all three backends.
  - Remote Chromium: configured CDP endpoint refused connection (ECONNREFUSED), including an
    unsandboxed check. Local Chrome: no running CDP session. BAP: required configuration missing.
  - Verify carrier-specific account-holder/R2 selection, returned cabin order against displayed
    choices, traveller-selection flow, all cabins/premium-only results, sequential WS/TS searches,
    published details, subsequent Porter searches and resident reuse/cleanup. No booking actions.
  - Implementation uses the recorded request contracts and current public application state; React
    provider/state/storage/private endpoint compatibility needs live confirmation. Synthetic DOM,
    adapter and IPC coverage is not evidence of successful live myIDTravel access.

- [ ] Verify remote Chromium against the user's Coolify deployment when its endpoint is available.
  - Deploy deploy/compose.chromium.yaml, verify protected desktop input and Porter automatic/manual
    login, two heartbeats, independent searches and reattachment after CLI exit. Verify synthetic
    profile state across container restart; allow Porter reauthentication if needed.
  - No deployed endpoint was supplied. Local jlesage runtime, profile persistence, authenticated
    staff controls, independent/IPC searches and heartbeat/shutdown behavior are verified below.
    Coolify TLS/desktop authentication, VPS connectivity and CAPTCHA/MFA input still need live checks.
  - Local/remote mode consolidation remains deferred until remote operation is live-verified.

- [ ] Review existing ESLint/Cheerio dependency-chain advisories separately.
  - Verification: `npm audit` reports 9 advisories (8 high, 1 moderate) through ESLint and
    Cheerio/Undici; no automatic dependency upgrades were included in the browser migration.

## Done

- [x] Show only one colour in each other-airline cabin table cell.
  - Removed repeated segment indicators, booking-class quantities and relevance markers; cabin
    cells now show GREEN/YELLOW/RED (UNKNOWN when unpublished). Missing coverage labels remain
    distinct. JSON inventory, eligibility and segment indicators are unchanged.
  - Updated README/specs/architecture and rendering assertions for exact cell values and unchanged
    result data. Focused tests, all 116 tests, lint, type checking, formatting and whitespace pass.
    No live search needed for this presentation-only change.

- [x] Implement carrier-specific other-airline search with automatic R2 cabin coverage.
  - Required normalized/deduplicated airline codes, no ALL/cabin option; account-holder SSO,
    dynamic travel-status/cabin discovery and fresh full schedule requests on local/remote/BAP.
    Browser-owned requests use the traveller-selection API without editing profiles or booking.
  - Separate cabin indicators, inventory/relevance/eligibility/retrieval times; itinerary merging
    scoped to searched carrier and ordered actual segments. Published load/detail/standby projections
    preserve unknowns/caps/timestamps; failed enrichment retains successful data and schedules.
  - Coverage statuses and structured stage errors retain partial results, skip after fatal errors,
    and exit 6 when incomplete. Provider-aware IPC detects older residents, serializes operations,
    restores Porter after recoverable failures and delivers fatal results before shutdown. No replay.
  - Tables use GREEN/YELLOW/RED, omit eligibility/requestability text (retained in JSON), and omit
    equipment/Porter columns. Names/free text are excluded from tables; browser-side allowlists and
    suppressed myIDTravel diagnostic capture protect profiles/session/SSO data. Details JSON can
    contain personal passenger data. README, specs and architecture describe behavior and limits.
  - Verification: 116 tests, lint, type checking, scoped formatting and whitespace checks pass.
    Tests include all three adapter expression/navigation contracts, dynamic premium cabins,
    connections/alternate airports/offsets/codeshares, zero vs unknown, empty/partial/fatal searches,
    details/context validation, IPC compatibility/recovery/cleanup and no replay/booking actions.
  - Live acceptance remains the explicit backlog item above; no successful live search is claimed.

- [x] Remove equipment from table-mode flight search output.
  - Removed the Equipment header and row value; normalized equipment remains available in JSON.
    Extended existing rendering assertions and updated README/output spec.
  - Focused output tests, all 93 tests, lint and diff whitespace pass. No live browser check:
    this changes terminal presentation only.

- [x] Recognize Porter's explicit "please verify your login credentials" rejection.
  - Added the observed rejection phrase, including whitespace/line-break variations, to remote
    page inspection. Existing polling now fails immediately instead of timing out as unconfirmed;
    generic "Oops" errors remain distinct and no credential submission is retried.
  - Extended DOM regressions; all 93 tests, lint, type checking, formatting and diff whitespace pass.
    No new live credential attempts were made. This improves classification, not account validation;
    Hermes's effective credential pair must still be checked by the user.

- [x] Fix remote CDP discovery and attachment over Docker DNS hostnames.
  - Reproduced native Node 25 fetch ignoring Host: localhost; numeric loopback masked the problem
    in earlier local tests. A separate Docker client on Node 24.22.2 reproduced HTTP 500 over
    chromium:9222. Real Chromium also rejects DNS Host headers during the WebSocket handshake.
  - HTTP discovery now uses native node:http to preserve Host, bounded to 64 KiB and the existing
    abort deadline, without redirects. Private ws attachment explicitly sends Host: localhost;
    HTTPS/WSS retain proxy host routing. No dependencies, browser launch flags or exposed ports added.
  - Verification: All 93 tests, lint, type checking, formatting and whitespace checks pass. Added
    on-wire HTTP header, status/redirect, size/abort and WebSocket header regressions. A separate
    Docker client attached through chromium:9222 and evaluated JavaScript successfully after fixing
    both stages. Temporary client removed; existing Chromium preserved. No Porter login/search run.
  - Evidence: artifacts/docker-dns-cdp-2026-11-06T01-57-33Z/result.json. README, architecture and
    browser spec describe the fix. Hermes/VPS deployment remains pending.

- [x] Rewrite README setup/use instructions for all three browser modes.
  - Added mode comparison/navigation, shared install/config precedence, separate BAP/local Chrome/
    remote Chromium walkthroughs, local Docker and Coolify setup, authentication/search examples,
    and shared keep-alive/ownership/concurrency/configuration/troubleshooting references.
  - Clarified that local auth stays resident, remote auth exits, Docker lifecycle remains manual,
    resident searches are serialized, local searches use separate tabs, and exported shell settings
    override .env. Examples use a future date and a short local socket-state path.
  - Verification: Compared behavior/defaults with source, CLI help, .env.example, Compose files and
    SDK engine requirements. Both Compose configurations validate; 10 heading links and 3 relative
    README links, Markdown formatting and diff whitespace pass. All 89 tests and ESLint pass.
    Application behavior unchanged; no new live Porter searches were required or performed.

- [x] Measure stopped-container startup for the existing local Chromium service.
  - Cached jlesage/chromium:v26.08.2 and existing named profile volume; Docker daemon already running.
    Shutdown: 3.674s; from start invocation: Docker start returned 0.517s,
    desktop HTTP ready 1.639s, CDP discovery ready 6.132s,
    real adapter attachment/new tab/JavaScript evaluation ready 6.865s.
  - Measured one stop/start with a monotonic clock and 100 ms polling (requests have bounded timeouts).
    No image download or Porter login/search included. Browser left running; profile mount unchanged.
    Evidence: artifacts/chromium-startup-2026-11-06T00-10-53.203Z/result.json.
  - No application changes; automated suite not rerun for this operational measurement.

- [x] Fix recurring remote Chromium temporary errors caused by direct search-page startup.
  - Reproduced direct searchflight authentication failing with Porter's temporary-error page.
    Visiting /en-ca/staff first then searchflight succeeded with visible staff controls.
  - Authentication now starts at the staff landing page, then verifies search controls. A visible
    staff-booking link or search controls is required for a signed-in state; the staff route alone
    no longer skips login while the page loads. No retries, search replay or local/BAP changes.
  - Added regressions for navigation order, loading landing pages and genuine server failures.
    All 89 tests, lint, type checking, formatting and diff whitespace checks pass.
  - Live: Fixed auth and YTZ-YUL search for 2026-11-12 succeeded; after at least 150 seconds without
    keep-alive a new standalone search succeeded again with the same three flights and 19/35/36 seats.
    This verifies idle startup, not forced invalidation of all account cookies or CAPTCHA/MFA input.
    Evidence: artifacts/local-chromium-live-2026-11-05/ and
    artifacts/2026-11-05T23-53-55.290Z-10190/. Local Docker browser remains running.

- [x] Live-test persistent remote Chromium locally before Coolify.
  - Added deploy/compose.chromium.local.yaml with loopback desktop/CDP on 15800/19222 and a
    separate named profile volume; README includes local commands. Existing .env/local Chrome unchanged.
  - Runtime: Pulled jlesage/chromium:v26.08.2 (Chrome/151.0.7922.108). An isolated smoke container
    verified HTTP discovery, desktop resource, default-context attachment, browser/unrelated-tab
    survival, shared state on reattachment and synthetic localStorage persistence across container
    restart. Smoke container/volume removed. Evidence: artifacts/remote-chromium-smoke-2026-11-05T23-18-13.172Z/result.json.
  - Porter: Confirmed actual staff search controls. Two independent YTZ-YUL searches for 2026-11-12
    each returned PD2471/PD2477/PD2487 with 19/35/36 available seats. A separate CLI search through
    resident IPC returned the same flights. Maintenance reported three 60-second heartbeats and
    exited zero after 150 seconds. Same browser process remained available; descriptor, socket and
    ownership lock were removed. Final independent search after shutdown also succeeded.
  - Findings: Initial attempts returned Porter's temporary-error page (5FWZU3); later verification
    succeeded after staff/login inspection. No automatic retry loop was added. A long workspace
    state path caused macOS socket listen EINVAL; the local workflow now uses /tmp/flyporter-local-state.
  - No CAPTCHA/MFA desktop interaction was verified in the successful run. No bookings/purchases.
    Full search JSON is private/gignored; summaries omit standby identifiers. Evidence:
    artifacts/local-chromium-live-2026-11-05/ and artifacts/2026-11-05T23-21-39.064Z-8048/.
  - Local Compose config, README relative links and diff whitespace pass. Application code is
    unchanged in this test task; the preceding implementation passed all 86 automated tests/checks.
    flyporter-local-chromium-1 remains running for the user's local testing; no resident CLI remains.

- [x] Replace Browserless CDP with persistent remote Chromium on Coolify.
  - Behavior: New separate remote-chromium mode, private HTTP/browser-WebSocket CDP attachment to
    the existing default context, independent searches with automatic authentication, optional
    resident IPC/keep-alive, exact-origin staff controls, and protected desktop handoff for CAPTCHA,
    MFA or absent credentials. Credential rejection/inconclusive automatic login fails without retries.
    Cleanup closes only its own tab and disconnects; the last headed tab is blanked to preserve
    Chromium. No browser launch, isolated context, CDP Browser.close or cookie export.
  - Compatibility: BAP remains default and local behavior is unchanged. Removed browserless-cdp
    reports migration instructions. Shared resident orchestration remains in place; no dependencies added.
  - Deployment/docs: Pinned jlesage/chromium:v26.08.2 Compose service with persistent /config,
    supervised browser/container restart, desktop authentication behind Coolify HTTPS and loopback
    CDP/SSH instructions. README, environment example, architecture and feature/project specs updated.
  - Verification: All 86 automated tests, ESLint, type checking, scoped formatting, diff whitespace,
    Compose validation, 65 relative Markdown links and configured-secret checks pass. Tests cover
    default-context ownership, tunnel discovery, auth handoff/failures, resident serialization,
    partial cleanup, no replay, disconnect-only behavior and the last-tab edge case.
  - Live acceptance remains the explicit backlog item above; no Coolify/Porter success claimed.

- [x] Retire the Browserless CDP challenge-loop investigation in favor of remote Chromium.
  - Superseded by the jlesage migration below; no Browserless clearance/search success claimed.
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

- [x] Archive superseded Browserless CDP deployment diagnostics.
  - The backend was replaced by remote-chromium. The following records describe the retired path.
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
