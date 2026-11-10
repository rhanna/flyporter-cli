# Other-airline search

`src/cli.js` resolves other-airline codes from a defined `--airline` option or otherwise
`FLYPORTER_AIRLINES`, loaded by existing dotenv behavior (exported shell values win). Explicit
input replaces the whole list, even when empty. `otherAirlineQuery` validates routes/dates and
trims, uppercases and deduplicates codes before backend configuration, browser or resident access.
The normalized list crosses standalone search and IPC interfaces; residents validate the supplied
query without consulting their own favourites. Missing/blank or malformed lists fail validation.

`src/other-airline.js` calls adapter methods:
`openOtherAirline`, `discoverOtherAirlineCabins`, `searchOtherAirlineSchedule`, `otherAirlineDetails`
and `restorePorter`. Chrome implements these through Playwright; remote Chromium inherits them.
BAP implements its own navigation/evaluation and supported challenge policy. Shared orchestration
never accesses backend pages. There is no fallback or submitted-search replay.

SSO enters at Porter's `/en-ca/staff/otherairlines` redirect. A bounded readiness poll reads the
myIDTravel React/Redux provider's `login.loginData` inside the browser. The unique enabled employee
is selected, regardless of dependent preselection. The browser posts `booking/preparebooking`
and `booking/travellerselection`, using unchanged account-holder attributes and no companions.
This drives the traveller-selection API directly, avoiding profile edits and dependence on visible
traveller dialogs. It validates the selected carrier against eligible agreements and resolves the
R2 travel-status ID plus allowed compartments from the response. Cabin order is the server's returned
choice order; there is no exhaustive hardcoded cabin list.

Each operation issues one fresh credentialed browser-side POST to `booking/flightschedule` with
explicit carrier, cabin, route, date, dynamically resolved R2 status and `ONE_WAY`. The complete
JSON response is read, independent of visible cards. Normalization requires successful, matching
routing/cabin/date criteria and valid nested flights/segments. Empty flight arrays are successful.
Only allowlisted availability data crosses the browser boundary; cookies, CSRF, tab IDs, login and
profile attributes stay inside the browser. CSRF/tab values are read from site-owned storage per
request; the command persists none. Diagnostic captures on the myIDTravel access path are suppressed.

Shared orchestration resolves `query.selectableOnly` to true unless explicitly false (CLI
`--all-flights`). After normalizing the full schedule, it excludes records whose flight-level
`selectable` is not exactly true, before merging or requesting details. This applies independently
per carrier/cabin and preserves first qualifying itinerary order and qualifying cabin order.
Requestability, colours and segment flags are not filter inputs. Fully excluded schedules retain
successful empty coverage. Both tables and JSON use the filtered result; JSON includes the boolean.
The browser request contract is unchanged, and there is no filter environment setting.

Optional `query.maxStops` is validated as a non-negative safe integer before browser access.
After full normalization, orchestration filters normalized stop counts before merging/details;
unknown counts are excluded under a limit. A normalized count adds segment connections and
published within-segment stops. Omission means unlimited stops. `--all-flights` only disables
selectability, so the stop limit still applies. Ordering and successful empty coverage are preserved.

With details enabled, each itinerary's segments request `flightLoad` and `flightDetails` separately,
using the marketing/operating flight context and searched cabin. Returned segment route, flight
number and departure instant must match; no cross-carrier/cabin cache is used. Published loads,
seat availability, booking situation and standby entries are projected separately. Empty detail
collections are unknown. Capped values and update timestamps survive. Unfiltered information/remark
text and session fields are excluded. Passenger names can occur in detailed JSON, never tables.
Successful enrichment survives failure of the other endpoint; schedule results survive all enrichment
failures. Negative booking-class quantities retain their raw values with `disclosed: false`.

Carriers and cabins execute sequentially. Itineraries merge only within the searched carrier using
ordered segment flight numbers, actual airports and departure strings. Each cabin retains its own
flight/segment/class indicators, eligibility, inventory and retrieval timestamp. No absent cabin
record or overall cross-cabin colour is invented. Both table renderers share `formatDateTime` from
`src/output.js`, displaying source local departure/arrival times as YYYY-MM-DD HH:MM without
changing normalized timestamps or offsets. Tables show only the cabin-level HIGH/MID/LOW mapped to GREEN/YELLOW/RED (UNKNOWN when
unpublished); segment indicators, inventory and eligibility remain in JSON.
The calling CLI enables indicator colours only for terminal stdout, unless `TERM=dumb` or a
nonempty `NO_COLOR` disables them, for both standalone and resident results. The renderer uses
bright white foreground on matching ANSI backgrounds for GREEN/YELLOW/RED and resets each label;
unknown/coverage labels stay plain. Shared `renderTable` ignores ANSI controls when measuring and
padding cells. Rendering never adds escape sequences to normalized records or JSON.

`searches` tracks success/partial/failed/skipped coverage and sanitized carrier/cabin/stage errors;
`complete` is true only for successful requested coverage. Discovery failures use `cabin: null`
because no cabin set is known. Authentication/challenge/transport failures stop work and mark the
remaining discovered operations (or undiscovered airlines) skipped. Fatal results carry `fatal: true`
so the CLI disarms retention and residents stop after delivery. Other incomplete results exit 6
while keeping the resident usable. Restoration failures retain collected results but are fatal.

Resident IPC defaults missing provider fields to Porter. Descriptors advertise `porter` and
`other-airline`, with `other-airline-selectable-only` in `capabilities`. Clients reject unsupported
old descriptors before sending other-airline requests. Default filtering additionally requires that
capability before connecting/submitting; errors instruct restarting keep-alive or using
`--all-flights`. Explicit unfiltered queries can use older other-airline-capable residents.
Descriptors also advertise `max-stops` for both providers. Explicit stop limits require that
capability before submission, otherwise clients instruct restarting keep-alive without fallback or
replay. Validation precedes browser operations. Existing locks and queues serialize heartbeat/search/SSO
work. Porter is restored and search controls verified after recoverable operations. Heartbeats remain
Porter-only. Multi-carrier IPC has no Porter-sized aggregate timeout: individual browser operations
remain bounded, and disconnection never triggers independent replay.

The request contract is informed by the repository's private recording and the public myIDTravel
application bundle inspected during implementation. React provider/state names, storage keys,
response schemas and returned cabin ordering are private site contracts and can change. Live
acceptance is pending on all three backends; synthetic DOM/adapter tests are not site verification.
