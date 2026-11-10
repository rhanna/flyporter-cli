// @ts-check
import { renderTable } from "./output.js";

const guidance = (value) =>
  ({
    HIGH: "GREEN",
    MID: "YELLOW",
    LOW: "RED",
    GREEN: "GREEN",
    YELLOW: "YELLOW",
    RED: "RED",
  })[value] || "UNKNOWN";
const published = (value) =>
  Number.isFinite(Number(value)) && Number(value) < 0
    ? "undisclosed"
    : safe(value);
const safe = (value) =>
  String(value ?? "?").replace(/[\x00-\x1f\x7f-\x9f]/g, "");

export function renderOtherAirlineTable(result) {
  const cabins = [
    ...new Set(result.searches.map((s) => s.cabin).filter(Boolean)),
  ];
  const rows = result.flights.map((flight) => [
    safe(flight.searchedAirline),
    flight.flightNumbers.map(safe).join("/"),
    flight.segments
      .map((s) => `${safe(s.origin)}-${safe(s.destination)}`)
      .join("/"),
    safe(flight.scheduledDeparture),
    safe(flight.scheduledArrival),
    safe(flight.stops),
    ...cabins.map((cabin) => {
      const data = flight.cabins.find((c) => c.cabin === cabin);
      if (!data) {
        const operation = result.searches.find(
          (s) => s.airline === flight.searchedAirline && s.cabin === cabin,
        );
        if (!operation) return "not offered";
        return ["success", "partial"].includes(operation.status)
          ? "not returned"
          : operation.status;
      }
      return guidance(data.chance);
    }),
  ]);
  const sections = [
    `${result.complete ? "" : "INCOMPLETE COVERAGE — "}Other-airline R2 standby: ${result.query.origin} → ${result.query.destination} on ${result.query.date}`,
    renderTable(
      [
        "Carrier",
        "Flights",
        "Actual route",
        "Departure",
        "Arrival",
        "Stops",
        ...cabins,
      ],
      rows,
    ),
    "Indicators are guidance, not boarding guarantees. Cabin inventory and eligibility are available in JSON.",
  ];
  if (!result.flights.length)
    sections.push("No flights found in successful searches.");
  sections.push(
    renderTable(
      ["Carrier", "Cabin", "Coverage", "Failed stage"],
      result.searches.map((s) => [
        safe(s.airline),
        safe(s.cabin),
        s.status,
        s.error?.stage || s.errors?.map((e) => e.stage).join(",") || "-",
      ]),
    ),
  );
  if (result.query.details) {
    const details = result.flights.flatMap((flight) =>
      flight.cabins.flatMap((cabin) => {
        const detail = cabin.details;
        if (!detail || !["success", "partial"].includes(detail.status))
          return [
            [
              flight.searchedAirline,
              flight.flightNumbers.join("/"),
              cabin.cabin,
              detail?.status || "unknown",
              "unknown",
              "unknown",
            ],
          ];
        return detail.segments.map((s) => [
          flight.searchedAirline,
          s.flightNumber,
          cabin.cabin,
          s.flightLoad?.loads
            ?.map(
              (l) =>
                `${safe(l.compartmentKey)} available:${published(l.availableCapped ?? l.available)} waitlist:${published(l.waitlist)}`,
            )
            .join(" / ") || "unknown",
          s.flightDetails?.seatAvailability
            ?.map(
              (v) =>
                `${safe(v.cabin)} remaining:${published(v.seatsRemaining)}`,
            )
            .join(" / ") || "unknown",
          s.flightDetails?.standby
            ? String(s.flightDetails.standby.length)
            : "unknown",
        ]);
      }),
    );
    sections.push(
      renderTable(
        [
          "Carrier",
          "Flight",
          "Cabin",
          "Published load",
          "Seat availability",
          "Published standby entries",
        ],
        details,
      ),
    );
  }
  return sections.join("\n\n");
}
