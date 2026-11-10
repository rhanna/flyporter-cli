import { stripVTControlCharacters } from "node:util";

export function renderSearchTable(result) {
  const flightRows = result.flights.map((flight) => [
    flight.flightNumbers.join("/"),
    `${flight.origin}-${flight.destination}`,
    formatDateTime(flight.scheduledDeparture),
    formatDateTime(flight.scheduledArrival),
    displayValue(flight.availableSeats),
    displayValue(flight.porterClassicSeats),
    displayValue(flight.porterReserveSeats),
    String(flight.standby.length),
  ]);

  const sections = [
    `Porter staff availability: ${result.query.origin} → ${result.query.destination} on ${result.query.date}`,
    renderTable(
      [
        "Flight",
        "Route",
        "Departure",
        "Arrival",
        "Available",
        "Classic",
        "Reserve",
        "Standby",
      ],
      flightRows,
    ),
  ];

  const standbyRows = result.flights.flatMap((flight) =>
    flight.standby.map((passenger) => [
      flight.flightNumbers.join("/"),
      passenger.priorityCode || "-",
      passenger.fareBasisCode || "-",
      passenger.otherAirline ? "yes" : "no",
      maskIdentifier(passenger.employeeId),
      maskIdentifier(passenger.referenceEmployeeId),
      maskIdentifier(passenger.viporterNumber),
    ]),
  );

  if (standbyRows.length) {
    sections.push(
      "Standby requests",
      renderTable(
        ["Flight", "Priority", "Fare basis", "OA", "Employee", "Reference", "VIPorter"],
        standbyRows,
      ),
    );
  }

  if (!result.flights.length) sections.push("No flights found.");
  return sections.join("\n\n");
}

export function maskIdentifier(value) {
  if (value === null || value === undefined || value === "") return "-";
  const string = String(value);
  if (string.length <= 4) return "*".repeat(string.length);
  return `${"*".repeat(Math.max(4, string.length - 4))}${string.slice(-4)}`;
}

export function renderTable(headers, rows) {
  const normalized = rows.map((row) => row.map(displayValue));
  const visibleLength = (value) => stripVTControlCharacters(String(value ?? "")).length;
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...normalized.map((row) => visibleLength(row[index]))),
  );
  const format = (row) => row.map((cell, index) => {
    const value = String(cell ?? "");
    return value.padEnd(widths[index] + value.length - visibleLength(value));
  }).join("  ");
  return [format(headers), format(widths.map((width) => "-".repeat(width))), ...normalized.map(format)].join(
    "\n",
  );
}

export function formatDateTime(value) {
  if (!value) return "-";
  return String(value).replace("T", " ").slice(0, 16);
}

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}
