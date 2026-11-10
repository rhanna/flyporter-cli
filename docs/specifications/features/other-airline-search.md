# Other-airline Search Spec

## Responsibility

Search myIDTravel through Porter SSO for authorized account-holder R2 standby travel on explicit
carriers, across local Chrome, persistent remote Chromium and Browserless BAP.
Owned by `src/other-airline.js`, `src/myidtravel-controls.js`, adapter operations and
`src/other-airline-output.js`. See the [architecture](../../architecture/other-airline.md).

## Behavior

- Require comma-separated two-character alphanumeric airline codes; trim/uppercase/deduplicate in
  user order. Reject empty values/entries and ALL. Route/date validation matches Porter.
- Search one-way for the unique eligible employee, with no companions or profile modifications.
  Read account data only inside the browser; traveller-selection API handles the selection flow.
- Resolve the R2 status ID dynamically and search every returned carrier/status cabin in returned
  order, sequentially. No cabin parameter or hardcoded exhaustive cabin list.
- Read one fresh full schedule response per cabin. Validate success, query criteria and nested
  flight/segment collections; successful empty results are successful coverage.
- Optional details request published loads and flight details. Validate segment identity/context;
  preserve successful data after enrichment failure. No booking, flight selection, selling or payment.
- Retain partial results and structured stage errors; exit 6 for incomplete requested coverage.
  Authentication, unresolved challenges and transport failures skip remaining work without replay.
- Residents serialize searches with maintenance, advertise providers and restore Porter afterwards.
  Recoverable failures preserve usability; fatal results are delivered before shutdown.

## Data Model

`{ query, searchedAt, complete, searches, flights }`, with `fatal: true` on unusable sessions.
Query contains route/date, ordered airlines and details flag. Coverage entries identify airline,
cabin (null when discovery is unknown), success/partial/failed/skipped status, operation timestamp
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
