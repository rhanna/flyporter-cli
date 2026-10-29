# Tasks

## Active

No active tasks.

## Backlog

No follow-up implementation work is scheduled by this documentation integration.

## Done

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
