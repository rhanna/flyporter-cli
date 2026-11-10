import test from "node:test";
import assert from "node:assert/strict";
import { maskIdentifier, renderSearchTable } from "../src/output.js";

test("masks identifiers except their final four characters", () => {
  assert.equal(maskIdentifier("12345678"), "****5678");
  assert.equal(maskIdentifier("123"), "***");
  assert.equal(maskIdentifier(null), "-");
});

test("terminal output never exposes complete standby identifiers", () => {
  const output = renderSearchTable({
    query: { origin: "YUL", destination: "YTZ", date: "2026-06-18" },
    flights: [
      {
        flightNumbers: ["PD2486"],
        origin: "YUL",
        destination: "YTZ",
        scheduledDeparture: "2026-06-18T20:55:00",
        scheduledArrival: "2026-06-18T22:20:00",
        equipment: ["Dash 8"],
        availableSeats: 30,
        porterClassicSeats: 24,
        porterReserveSeats: 6,
        emptySeats: 30,
        standby: [
          {
            priorityCode: "C4",
            fareBasisCode: "YIDZH1R2",
            otherAirline: false,
            employeeId: "12345678",
            referenceEmployeeId: "87654321",
            viporterNumber: "1122334455",
          },
        ],
      },
    ],
  });
  assert.doesNotMatch(output, /12345678|87654321|1122334455/);
  assert.match(output, /\*{4}5678/);
  assert.match(output, /C4/);
  assert.doesNotMatch(output, /Equipment|Dash 8/);
  assert.match(output, /2026-06-18 20:55/);
  assert.match(output, /2026-06-18 22:20/);
  assert.doesNotMatch(output, /2026-06-18T/);
  assert.match(output, /Available/);
  assert.match(output, /Classic/);
  assert.match(output, /Reserve/);
});
