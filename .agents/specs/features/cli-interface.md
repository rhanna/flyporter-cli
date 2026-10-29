# CLI Interface Spec

## Responsibility

Expose commands, validation, options, output selection, and process error reporting.
Owned by [bin/flyporter.js](../../../bin/flyporter.js),
[src/cli.js](../../../src/cli.js), [validation](../../../src/validation.js), and
[errors](../../../src/errors.js).
Existing validation coverage: [validation tests](../../../test/validation.test.js).
Additional CLI integration coverage: [CLI tests](../../../test/cli.test.js).

## Behavior

| Command | Options and behavior |
| --- | --- |
| `flyporter auth` | --timeout seconds (600), --interval seconds (240, local only); BAP checks login then retains/disconnects, local remains resident. |
| `flyporter session keep-alive` | --auth-timeout seconds (600), --interval seconds (BAP 60/local 240), optional --duration seconds; foreground maintenance on either backend. |
| `flyporter search porter <origin> <destination> <date>` | --json selects full JSON; otherwise tables. BAP uses resident/reconnect/fresh session; local attaches to running Chrome. |
| `flyporter search other-airline <origin> <destination> <date>` | Validate arguments, then raise unsupported-command error; no MyIDTravel search occurs. |

- Commander supplies help and version (0.1.0), command parsing, and help after parser errors.
- dotenv loads local environment configuration when the CLI module loads.
- Global `--browser bap|local` overrides `FLYPORTER_BROWSER`, defaulting to BAP. Never fall back
  automatically between backends. Local mode does not require Browserless credentials.
- BAP diagnostics use stderr; search stdout contains only the selected output format.
- Airport/city codes are trimmed and uppercased, then must match exactly three ASCII letters.
  There is no lookup against a real airport catalog.
- Dates are trimmed, require YYYY-MM-DD, and must round-trip as a valid UTC calendar date.
  Validation does not reject dates merely because they are in the past.
- Timeout and interval values must be finite positive numbers; intervals require at least 30 seconds.
  Fractional seconds are accepted.
- Domain errors write `Error [CODE]: message` to stderr and set process.exitCode.
  Unexpected errors are rethrown. Commander parsing errors follow Commander's own handling.
- Success output uses stdout; session refreshes are logged with ISO timestamps.
  Reauthentication notices use stderr.

## Data Model

| Domain error code | Default exit status |
| --- | --- |
| FLYPORTER_ERROR | 1 |
| AUTHENTICATION_FAILED | 2 |
| SESSION_EXPIRED | 3 |
| CLOUDFLARE_CHALLENGE | 4 |
| INVALID_ARGUMENT | 5 |
| REMOTE_RESPONSE_ERROR | 6 |
| UNSUPPORTED_COMMAND | 7 |

Error classes carry message, code, exitCode, and optional cause. Constructor options can override
the defaults. Search results follow the [availability contract](porter-availability-search.md);
formatting follows the [output contract](output-and-privacy.md).
The CLI run function accepts argv and injectable stdout/stderr streams.

## Known Risks

- Other-airline search is deliberately unsupported because its request flow is unavailable.
- Local search requires a resident Chrome session; starting a new browser from a saved profile is
  not a substitute for the running process.
- `auth` and `session keep-alive` share the resident workflow but differ in launch/attachment policy.
- Domain-error handling does not convert all possible runtime errors into structured CLI errors.
