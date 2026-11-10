# Testing Strategy

## File Location

- Tests: `test/*.test.js`, using Node.js's built-in test runner and strict assertions.
- Fixtures: `test/fixtures/`.
- Tests use browser doubles and local fixtures; there is no separate integration-test directory.

## Rules

- Run a focused test with `node --test test/<module>.test.js` when changing a module.
- Run `npm test` and `npm run lint` before marking a task done.
- Add or update tests for changed behavior and new classes where useful.
- Prefer focused tests near the affected code.
- Run the smallest useful test first, then broader checks when risk is higher.
- For documentation-only changes, verify links and claims against source and existing tests.
- Document any skipped tests and why.
- Do not treat passing browser doubles as verification of the live Porter website.
- Run `npm run check` for JSDoc/SDK integration checking and `npm run format:check` for changed
  integration files. `npm run format` formats those files without unrelated local-code churn.
- Live authentication/search checks require an authorized account and Browserless access for BAP,
  or interactive Chrome for local mode. Clearly distinguish simulated tests from live evidence.
  They are not part of the automated suite.
