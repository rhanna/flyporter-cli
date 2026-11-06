# Output and Privacy Spec

## Responsibility

Render normalized availability as terminal tables, or emit full JSON through the CLI.
Owned by [src/output.js](../../../src/output.js) and [src/cli.js](../../../src/cli.js).
Existing coverage: [output tests](../../../test/output.test.js).

## Behavior

- Default output includes the query heading and flight table: flight numbers, route, scheduled
  departure/arrival, equipment, total/classic/reserve seats, and standby array length.
- Include a standby table only when standby records exist. Columns include flight, priority,
  fare basis, other-airline flag, and masked employee/reference/VIPorter identifiers.
- Null, undefined, or empty values render as a dash. Preserve numeric zero.
  Dates replace T with a space and truncate to 16 characters without timezone conversion.
- Empty results still render the heading/table headers and append "No flights found."
- Identifiers of up to four characters are fully masked. Longer identifiers retain the final
  four characters, prefixed with at least four asterisks.
- `--json` serializes the complete normalized result with two-space indentation and a newline.
  It does not apply masking or remove identifiers.

## Data Model

- Input is the result contract in the [availability spec](porter-availability-search.md).
- Table rendering formats strings; it does not modify normalized result records.
- Masking is a presentation function, not a data transformation applied to JSON.
- BAP/remote Chromium screenshots, control metadata and debug events default to disabled, including on failure.
  `FLYPORTER_DEBUG=1` (or `true`) enables them on the browser-owning process; `0`/`false` disables them.
  Disabled reporting performs no filesystem, stderr or remote-browser diagnostic work. Normal errors
  and authentication/CAPTCHA/results verification remain active. Enabled artifacts are gitignored
  under `artifacts/<timestamp>-<pid>`.
  Screenshot capture requires successful input masking; otherwise it is skipped.
  Logs redact credentials, token encodings, solve tokens and reconnect endpoints. Control metadata
  omits input values, cookies, raw HTML and response bodies. Diagnostics never enter JSON stdout.

## Known Risks

- Remote Chromium handoff prints the configured desktop URL on stderr without embedded tokens
  or credentials. Desktop authentication is separate from Porter login; CDP remains private.
  Persistent remote profiles contain authenticated browser state and must be protected.

- JSON and redirected JSON files contain personal identifiers and must be handled accordingly.
- Terminal masking is limited to the three identifier columns, not every possible sensitive field.
- Standby counts reflect flattened records and may include repeated people across legs.
- Date formatting is textual, not locale-aware or timezone-aware.
