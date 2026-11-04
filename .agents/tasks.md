# Tasks

## Active

No active tasks.

## Backlog

- [ ] Verify self-hosted CDP against the user's Coolify deployment when its endpoint is available.
  - Confirm the generated DevTools link supports screencast clicks/typing and manual login;
    verify two heartbeats, a separate CLI flight search on the same browser and remote cleanup.
  - No self-hosted endpoint or Docker executable was available during implementation. The
    free-image source and simulated tests do not establish live viewer/CAPTCHA compatibility.

- [ ] Review existing ESLint/Cheerio dependency-chain advisories separately.
  - Verification: `npm audit` reports 9 advisories (8 high, 1 moderate) through ESLint and
    Cheerio/Undici; no automatic dependency upgrades were included in the browser migration.

## Done

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
