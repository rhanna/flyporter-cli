# Coding Standards

## Formatting
- Use the existing JavaScript style: 2 spaces, double quotes, and semicolons.
- Aim for 100-character lines; avoid unrelated formatting changes.
- Run `npm run lint` to check the rules in [eslint.config.js](../eslint.config.js).
- The repo has no Prettier configuration or `npm run format` command.

## Naming
- Files: kebab-case, e.g. `browser-session.js`.
- Functions: camelCase, e.g. `getDefaultChromeProfilePath`.
- Classes: PascalCase, e.g. `ChromeBrowser`.
- Constants: SCREAMING_SNAKE, e.g. `DEFAULT_CDP_PORT`.

## Patterns to Follow
- Use JavaScript ES modules and explicit local `.js` import extensions.
- Follow the existing modules in `src/`; the executable entrypoint belongs in `bin/`.
- Handle errors explicitly using the domain error classes where appropriate.
- Prefer early returns over nested if/else.
- Preserve Chrome ownership of cookies and the distinction between launched and attached sessions.

## Patterns to Avoid
- Prefer named exports from application modules; preserve existing config conventions.
- Avoid magic strings when a shared constant makes the contract clearer.
- Do not introduce cookie export, credential storage, or challenge-bypass behavior.
- Do not put HAR contents, tokens, profile data, or real standby identifiers into docs or fixtures.

## Refactoring
- Refactor only when it reduces current-task complexity.
- Keep behavior-preserving refactors separate when possible.
- Avoid style-only churn in unrelated files.
