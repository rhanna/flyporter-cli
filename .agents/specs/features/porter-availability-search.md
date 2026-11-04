# Porter Availability Search Spec

## Responsibility

Retrieve one-way Porter staff availability and normalize journey, segment, and standby data.
Owned by [src/search.js](../../../src/search.js), the native flow in
[src/browser.js](../../../src/browser.js), and [HTML helpers](../../../src/html.js).
Existing coverage: [search tests](../../../test/search.test.js),
[HTML tests](../../../test/html.test.js), and
[availability fixture](../../../test/fixtures/availability.json).

## Behavior

- BAP follows the proof-of-concept's observed login and search controls using its actual SDK.
  It selects one-way/account-holder travel, exact-code airport options, and a verified departure date.
  Native/text dates use the input helpers; Porter's read-only calendar uses its existing view-model API.
- BAP retrieves captured `GetFlightAvailabilityStaffTravel` bodies explicitly and compares captured
  response counts before/after submission. A previous response alone cannot satisfy a new search.
  A fresh successful, structurally valid response confirms flights or explicit empty availability;
  malformed/missing bodies and timeouts fail. Optional results selectors add visible-container checks.
- BAP returns the same BrowserResponse contract to the existing normalizer; no flight or standby
  output fields are removed. Serialized code is tested outside local closures without transpiler helpers.

- Validate and normalize origin, destination, and date before requesting availability.
- When the adapter exposes searchStaffAvailability, use it. For local Chrome:
  Navigate to /en-ca/staff/searchflight; detect login/sign-in redirects; wait up to 30 seconds
  for the Knockout booking widget and eligible staff passenger.
- Set one-way trip, origin, destination, passenger selection, and Moment-backed departure date.
  Submit through the site's view model and capture GetFlightAvailabilityStaffTravel.
  Widget loading, submission, and response timeouts produce remote-response errors.
- Only adapters without the native method use the form/request path. Extract the staff form
  by action or staff controls; if absent, use recognized standalone controls and default to
  POST /en-ca/staff/select. Preserve form fields, including any anti-forgery token and passenger.
  Ignore disabled and unchecked fields, with a first-passenger fallback.
- Override route/date and one-way fields; use existing fare/search values or defaults
  R, 0, ZP, and JumpSeat. Follow the booking URL when appropriate, then call
  /en-ca/flight/BuildFlightSearch, /LowFareSearch, and /GetFlightAvailabilityStaffTravel.
- Login or VIPorter sign-in response paths raise session-expired errors. Failed HTTP stages
  produce remote-response errors with a bounded server-message excerpt: tags/whitespace are
  stripped for non-JSON messages, token-like strings of 32+ characters redacted, length capped at 240.
- Reject malformed JSON and payloads without a searchResults array.
  Flatten available journeys across search results; an empty array produces no flights.
- Seat totals use the minimum numeric leg availability; when absent, use the minimum
  numeric fare StandbySeatsCount/AvailableCount, then numeric EmptySeats, then null.
  Classic and reserve each use the minimum numeric leg value or null.

## Data Model

- Input: `{ origin, destination, date }`.
- Output: `{ query, searchedAt, flights }`; searchedAt is an ISO timestamp at normalization.
- Flight records contain journeyKey, flightNumbers, origin/destination, scheduled and estimated
  departure/arrival, distinct equipment values, stops, availableSeats, porterClassicSeats,
  porterReserveSeats, emptySeats, listedPassengerCount, canBeSold, international,
  standbyAvailability, standby, and segments.
- Standby records contain employeeId, referenceEmployeeId, viporterNumber, priorityCode,
  fareBasisCode, otherAirline, and inventoryLeg. Records are flattened per leg without deduplication.
- Inventory legs contain origin, destination, departure, and flightNumber.
  Per-leg availability contains inventoryLeg, total/classic/reserve, and specialServices
  (code, capacity, available).
- Segments contain flightNumber, route, scheduled times, equipment, operatingCarrier, and codeShare.
  Missing optional values generally become null, empty arrays, or boolean false as coded.
- The form-based availability request is a single-item array with matching BeginDate/EndDate,
  FlightType 5, PaxCount 1, CAD currency, FareTypes ["N"], and ProductClasses ["ZP"].
  The full recorded contract is defined by buildAvailabilityRequest in the source.

## Known Risks

- Self-hosted CDP reuses the local native booking-widget flow on the resident remote page, with
  explicit fresh-response capture and additional validation of `AvailableJourneys` arrays.
  Resident heartbeats, searches and authentication are serialized. Failed searches are not replayed.

- Native flow depends on private site globals, view-model methods, selectors, and response URLs.
- The form path is an alternative adapter contract, not a recovery path after native failure.
- Upstream nested collections are not comprehensively schema-validated.
- Per-leg standby entries may represent the same person more than once; counts are not unique people.
- Normalized records retain identifiers. Seat values describe availability at search time,
  not a booking guarantee. This workflow does not create or modify standby requests.
