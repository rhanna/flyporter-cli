# Tasks

## Active

No active tasks.

## Backlog

- [ ] Review existing ESLint/Cheerio dependency-chain advisories separately.
  - Verification: `npm audit` reports 9 advisories (8 high, 1 moderate) through ESLint and
    Cheerio/Undici; no automatic dependency upgrades were included in the browser migration.

## Done

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
