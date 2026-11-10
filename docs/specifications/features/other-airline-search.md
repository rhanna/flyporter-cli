# Other-airline Search Spec

## Responsibility

Search myIDTravel through Porter SSO for authorized account-holder R2 standby travel on explicit
carriers, across local Chrome, persistent remote Chromium and Browserless BAP.
Owned by `src/other-airline.js`, `src/myidtravel-controls.js`, adapter operations and
`src/other-airline-output.js`. See the [architecture](../../architecture/other-airline.md).

## Behavior

- Require comma-separated two-character alphanumeric airline codes from explicit `--airline` or,
  when omitted, `FLYPORTER_AIRLINES` (e.g. `UA,AA,DL`). The explicit option replaces favourites,
  including explicitly empty input which fails validation. Resolve in the calling CLI, then
  trim/uppercase/deduplicate in user order before browser/IPC access. Reject missing/blank lists,
  invalid codes, empty entries and ALL. Route/date validation matches Porter.
- Reuse dotenv loading: exported shell variables override `.env`. Search and resident interfaces
  receive the resolved normalized list; residents never resolve favourites from their environment.
- Search one-way for the unique eligible employee, with no companions or profile modifications.
  Read account data only inside the browser; traveller-selection API handles the selection flow.
- Resolve the R2 status ID dynamically and search every returned carrier/status cabin in returned
  order, sequentially. No cabin parameter or hardcoded exhaustive cabin list.
- Read one fresh full schedule response per cabin. Validate success, query criteria and nested
  flight/segment collections; successful empty results are successful coverage.
- Default `query.selectableOnly` to true; `--all-flights` sets it to false. After full response
  validation/normalization and before merging/details, retain only flight-level `selectable === true`
  records independently for each carrier/cabin. False, absent and unknown values are excluded.
  Keep itineraries with any qualifying cabin and only qualifying cabin records, preserving order.
  Requestability, colours and segment flags do not determine selectability. `--all-flights` restores
  unfiltered records. No new request fields, browser UI interactions or environment setting.
  All-filtered schedules remain successful empty coverage; never fetch details for excluded records.
- Optional `--stops <count>` sets numeric `query.maxStops`, a non-negative safe integer (0 means
  nonstop). Omission leaves results unlimited. After full schedule normalization, exclude itineraries
  exceeding the maximum or with unknown stop counts before merging/details, preserving order and
  successful empty coverage. Counts include segment connections plus published within-segment stops.
  Combine with selectability; `--all-flights` still respects the stop limit. Requests are unchanged.
- Optional details request published loads and flight details. Validate segment identity/context;
  preserve successful data after enrichment failure. No booking, flight selection, selling or payment.
- Retain partial results and structured stage errors; exit 6 for incomplete requested coverage.
  Authentication, unresolved challenges and transport failures skip remaining work without replay.
- Residents serialize searches with maintenance, advertise providers and restore Porter afterwards.
  Recoverable failures preserve usability; fatal results are delivered before shutdown.
  Advertise `other-airline-selectable-only` in descriptor capabilities; reject default-filter
  requests to older residents before submission with restart instructions, without fallback/replay.
  Explicit `--all-flights` can use older residents advertising the other-airline provider.

## Data Model

`{ query, searchedAt, complete, searches, flights }`, with `fatal: true` on unusable sessions.
Query contains route/date, ordered airlines, details flag and resolved `selectableOnly` boolean.
Optional numeric `query.maxStops` records a specified stop limit. Residents advertise `max-stops`
and clients reject explicit limits without that capability before submission, with restart instructions.
Coverage entries identify airline, cabin (null when discovery is unknown), success/partial/failed/skipped status, operation timestamp
and optional sanitized `error`/`errors` identifying carrier/cabin/stage/code.

Itineraries merge only within the searched airline by ordered segment numbers, actual airports and
scheduled departures. Each contains normalized flight numbers, actual route/times/stops, segments,
and `cabins`. Segment routes, carriers, equipment, codeshares and timestamp offsets survive.
Cabin records retain independent chance, eligibility, actual compartment, segment indicators,
booking-class raw quantities/relevance flags and retrieval timestamps. Negative/missing/placeholders
are undisclosed inventory, never exact empty-seat totals. No cross-cabin overall indicator is invented.
Missing cabin records do not mean zero availability. Details retain per-segment, per-cabin/carrier
load/seat/standby information, capped fields, update/retrieval times and unknowns.

Cabin table cells show only HIGH/MID/LOW mapped to GREEN/YELLOW/RED (UNKNOWN when unpublished);
JSON retains site values, segment indicators and inventory. Tables never print passenger
names or free text. Detailed JSON can contain personal data; account profiles/session/SSO fields
are excluded by browser-side allowlists. Synthetic fixtures contain no real passenger data.

## Known Risks

- React/Redux provider state names, site storage keys, returned choice ordering and private JSON
  endpoints are changeable integration contracts. No live success is claimed from browser doubles.
- No endpoint was available for live remote Chromium checks; local CDP was absent and BAP required
  configuration was missing. All-backend live cabin/detail/resident acceptance remains outstanding.
- Discovery failure cannot enumerate undiscovered cabins; coverage records the failed carrier instead.
- Published inventory and indicators do not guarantee boarding; keep-alive cannot extend server limits.
