import { stripVTControlCharacters } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import {
  searchOtherAirline,
  validateAirlines,
  normalizeOtherAirlineSchedule,
} from "../src/other-airline.js";
import { renderOtherAirlineTable } from "../src/other-airline-output.js";

export const query = {
  origin: "YYZ",
  destination: "YVR",
  date: "2026-11-12",
  airlines: ["WS", "TS"],
};
export function schedule(cabin, flights = ["WS101"], airline = "WS") {
  return {
    success: true,
    routings: [
      {
        routingInfo: {
          from: { code: "YYZ" },
          to: { code: "YVR" },
          departure: query.date,
          compartment: cabin,
        },
        flights: flights.map((number) => ({
          chance: cabin === "Y" ? "LOW" : "HIGH",
          selectable: cabin !== "Y",
          requestable: true,
          compartment: cabin,
          segments: [
            {
              flightNumber: number,
              simpleFlightNumber: number.slice(2),
              from: { code: "YYZ" },
              to: { code: "YVR" },
              departure: "2026-11-12T23:30-0500",
              arrival: "2026-11-13T01:30-0800",
              aircraft: "737",
              operatingAirline: { code: "AC" },
              marketingAirline: { code: airline },
              stopQuantity: 0,
              chance: "MID",
              compartment: cabin,
              jseats: [
                {
                  bookingClass: "Z",
                  quantity: cabin === "Y" ? "0" : "-1",
                  relevant4Request: true,
                  compartment: cabin,
                  chance: "LOW",
                },
              ],
            },
          ],
        })),
      },
    ],
  };
}
function fixture(overrides = {}) {
  const calls = [];
  return {
    calls,
    browser: {
      openOtherAirline: async () => calls.push("open"),
      discoverOtherAirlineCabins: async (a) => {
        calls.push(["discover", a]);
        return ["Y", "W", "C"];
      },
      searchOtherAirlineSchedule: async ({ airline, cabin }) => {
        calls.push([airline, cabin]);
        return schedule(
          cabin,
          cabin === "Y" ? ["WS101"] : ["WS101", "WS999"],
          airline,
        );
      },
      otherAirlineDetails: async () => ({ status: "success", segments: [] }),
      restorePorter: async () => calls.push("restore"),
      ...overrides,
    },
  };
}
test("airline validation rejects implicit coverage and preserves normalized order", () => {
  assert.deepEqual(validateAirlines(" ts,WS,ts,2l "), ["TS", "WS", "2L"]);
  for (const value of [undefined, "", "ALL", "WS,", ",WS", "W S", "W", []])
    assert.throws(() => validateAirlines(value));
});
test("all dynamic cabins are searched sequentially; premium-only flights survive merging", async () => {
  const f = fixture();
  const result = await searchOtherAirline(f.browser, {
    ...query,
    selectableOnly: false,
  });
  assert.deepEqual(f.calls, [
    "open",
    ["discover", "WS"],
    ["WS", "Y"],
    ["WS", "W"],
    ["WS", "C"],
    ["discover", "TS"],
    ["TS", "Y"],
    ["TS", "W"],
    ["TS", "C"],
    "restore",
  ]);
  assert.equal(result.complete, true);
  assert.equal(result.flights.length, 4);
  assert.deepEqual(
    result.flights[0].cabins.map((c) => c.cabin),
    ["Y", "W", "C"],
  );
  assert.deepEqual(
    result.flights[1].cabins.map((c) => c.cabin),
    ["W", "C"],
  );
  assert.equal(result.flights[0].cabins[0].chance, "LOW");
  assert.equal(result.flights[0].cabins[1].chance, "HIGH");
  assert.equal(result.flights[0].cabins[0].selectable, false);
  assert.equal(result.flights[0].cabins[1].selectable, true);
  assert.equal(
    result.flights[0].cabins[0].segments[0].inventory[0].disclosed,
    true,
  );
  assert.equal(
    result.flights[0].cabins[1].segments[0].inventory[0].disclosed,
    false,
  );
  result.flights[0].cabins[1].chance = "MID";
  const beforeRendering = structuredClone(result);
  const table = renderOtherAirlineTable(result);
  assert.deepEqual(
    table.split("\n\n")[1].split("\n")[0].trim().split(/ {2,}/).slice(6),
    ["Economy", "Premium Economy", "Business"],
  );
  assert.doesNotMatch(table, /Coverage|Failed stage/);
  assert.match(table, /GREEN/);
  assert.match(table, /YELLOW/);
  assert.match(table, /RED/);
  assert.doesNotMatch(table, /\b(?:HIGH|MID|LOW|favourable|moderate)\b/);
  assert.match(table, /not returned/);
  const itineraryRows = table.split("\n\n")[1].split("\n").slice(2);
  assert.deepEqual(itineraryRows[0].trim().split(/ {2,}/).slice(3, 5), [
    "2026-11-12 23:30",
    "2026-11-13 01:30",
  ]);
  assert.doesNotMatch(table, /2026-11-12T23:30|2026-11-13T01:30|-0500|-0800/);
  assert.deepEqual(itineraryRows[0].trim().split(/ {2,}/).slice(6), [
    "RED",
    "YELLOW",
    "GREEN",
  ]);
  for (const row of itineraryRows) {
    for (const cell of row.trim().split(/ {2,}/).slice(6)) {
      assert.match(cell, /^(GREEN|YELLOW|RED|UNKNOWN|not returned)$/);
    }
  }
  assert.doesNotMatch(table, /Z:0|undisclosed|;|\*/);
  assert.deepEqual(result, beforeRendering);
  assert.doesNotMatch(
    table,
    /Classic|Reserve|Equipment|eligible:|requestable:/,
  );
});
test("empty successful searches, recoverable errors and failed details retain results", async () => {
  const f = fixture({
    searchOtherAirlineSchedule: async ({ airline, cabin }) => {
      if (airline === "WS" && cabin === "W")
        throw new Error("secret-profile-data");
      return schedule(cabin, cabin === "Y" ? [] : ["WS999"]);
    },
    otherAirlineDetails: async () => {
      throw new Error("session-secret");
    },
  });
  const result = await searchOtherAirline(f.browser, {
    ...query,
    details: true,
    selectableOnly: false,
  });
  assert.equal(result.complete, false);
  assert.deepEqual(
    result.searches.map((s) => s.status),
    ["success", "failed", "partial", "success", "partial", "partial"],
  );
  assert.equal(result.flights.length, 2);
  assert.equal(f.calls.at(-1), "restore");
  assert.doesNotMatch(JSON.stringify(result), /session-secret|secret-profile/);
  assert.match(renderOtherAirlineTable(result), /INCOMPLETE COVERAGE/);
  assert.match(renderOtherAirlineTable(result), /Failed stage/);
  assert.match(
    renderOtherAirlineTable(result),
    /WS {2,}Premium Economy {2,}failed/,
  );
});
test("fatal search failure skips remaining operations and never replays", async () => {
  let submissions = 0;
  const f = fixture({
    searchOtherAirlineSchedule: async ({ cabin }) => {
      submissions++;
      if (cabin === "W")
        throw Object.assign(new Error("transport"), {
          code: "TRANSPORT_ERROR",
        });
      return schedule(cabin);
    },
  });
  const result = await searchOtherAirline(f.browser, {
    ...query,
    selectableOnly: false,
  });
  assert.equal(result.fatal, true);
  assert.equal(submissions, 2);
  assert.equal(result.flights.length, 1);
  assert.deepEqual(
    result.searches.map((s) => s.status),
    ["success", "failed", "skipped", "skipped"],
  );
  assert.ok(!f.calls.includes("restore"));
});
test("fatal details failure retains schedule and skips subsequent details/cabins", async () => {
  const f = fixture({
    otherAirlineDetails: async () => {
      throw Object.assign(new Error(), { code: "SESSION_EXPIRED" });
    },
  });
  const result = await searchOtherAirline(f.browser, {
    ...query,
    details: true,
    selectableOnly: false,
  });
  assert.equal(result.flights.length, 1);
  assert.equal(result.searches[0].status, "partial");
  assert.equal(result.searches[1].status, "skipped");
});
test("normalization preserves alternate-airport connections, codeshares and offset overnight times", () => {
  const p = schedule("C");
  const first = p.routings[0].flights[0].segments[0];
  first.from.code = "YTZ";
  first.to.code = "YYC";
  first.codeshare = "AC";
  p.routings[0].flights[0].segments.push({
    ...first,
    flightNumber: "WS201",
    from: { code: "YYC" },
    to: { code: "YVR" },
    departure: "2026-11-13T01:30-0700",
    arrival: "2026-11-13T02:30-0800",
  });
  const [flight] = normalizeOtherAirlineSchedule(p, {
    ...query,
    airline: "WS",
    cabin: "C",
  });
  assert.equal(flight.origin, "YTZ");
  assert.equal(flight.stops, 1);
  assert.equal(flight.scheduledArrival, "2026-11-13T02:30-0800");
  assert.equal(flight.segments[0].operatingCarrier, "AC");
  for (const mutate of [
    (p) => (p.success = false),
    (p) => (p.routings[0].routingInfo.compartment = "Y"),
    (p) => (p.routings[0].flights[0].segments = []),
    (p) => (p.routings[0].flights = null),
  ]) {
    const broken = structuredClone(p);
    mutate(broken);
    assert.throws(() =>
      normalizeOtherAirlineSchedule(broken, {
        ...query,
        airline: "WS",
        cabin: "C",
      }),
    );
  }
});

test("detail partial coverage retains independent successful data and never renders names or free text", async () => {
  const f = fixture({
    discoverOtherAirlineCabins: async () => ["Y"],
    otherAirlineDetails: async () => ({
      status: "partial",
      errors: [{ code: "REMOTE_RESPONSE_ERROR", stage: "flightLoad" }],
      segments: [
        {
          flightNumber: "WS101",
          flightDetails: {
            standby: [{ passenger: "SYNTHETIC NAME", remark: "private text" }],
          },
        },
      ],
    }),
  });
  const result = await searchOtherAirline(f.browser, {
    ...query,
    details: true,
    selectableOnly: false,
  });
  assert.equal(result.complete, false);
  assert.equal(result.searches[0].status, "partial");
  assert.equal(result.searches[0].errors[0].stage, "details:flightLoad");
  assert.equal(
    result.flights[0].cabins[0].details.segments[0].flightDetails.standby
      .length,
    1,
  );
  assert.doesNotMatch(
    renderOtherAirlineTable(result),
    /SYNTHETIC NAME|private text/,
  );
});

test("different scheduled segment departures stay separate within a carrier", async () => {
  const f = fixture({
    discoverOtherAirlineCabins: async () => ["Y", "C"],
    searchOtherAirlineSchedule: async ({ cabin }) => {
      const p = schedule(cabin);
      if (cabin === "C")
        p.routings[0].flights[0].segments[0].departure =
          "2026-11-13T23:30-0500";
      return p;
    },
  });
  const result = await searchOtherAirline(f.browser, {
    ...query,
    airlines: ["WS"],
    selectableOnly: false,
  });
  assert.equal(result.flights.length, 2);
});

test("raw inventory quantities remain independent; undisclosed values are never zero", () => {
  const p = schedule("C");
  const values = [0, "0", -1, "-1", null, undefined, "-", "", "9+"];
  p.routings[0].flights[0].segments[0].jseats = values.map((quantity, i) => ({
    bookingClass: `B${i}`,
    quantity,
    relevant4Request: i === 0,
    configured4Request: true,
  }));
  const [flight] = normalizeOtherAirlineSchedule(p, {
    ...query,
    airline: "WS",
    cabin: "C",
  });
  const inventory = flight.cabins[0].segments[0].inventory;
  assert.deepEqual(
    inventory.map((v) => v.disclosed),
    [true, true, false, false, false, false, false, false, false],
  );
  assert.equal(inventory[2].quantity, -1);
  assert.equal(inventory[5].quantity, null);
  assert.equal(inventory[8].quantity, "9+");
});

test("cabin names appear in flight, coverage and detail tables while unknown codes survive", async () => {
  const f = fixture({
    discoverOtherAirlineCabins: async () => ["F", "Q"],
    otherAirlineDetails: async () => ({
      status: "success",
      segments: [
        {
          flightNumber: "WS101",
          flightLoad: { loads: [{ compartmentKey: "F", available: 1 }] },
          flightDetails: {
            seatAvailability: [{ cabin: "F", seatsRemaining: 1 }],
          },
        },
      ],
    }),
  });
  const result = await searchOtherAirline(f.browser, {
    ...query,
    airlines: ["WS"],
    details: true,
    selectableOnly: false,
  });
  const before = structuredClone(result);
  const table = renderOtherAirlineTable(result);
  assert.deepEqual(
    table.split("\n\n")[1].split("\n")[0].trim().split(/ {2,}/).slice(6),
    ["First", "Q"],
  );
  assert.doesNotMatch(table, /Coverage|Failed stage/);
  assert.match(table, /WS {2,}WS101 {2,}First/);
  assert.match(table, /First available:1/);
  assert.match(table, /First remaining:1/);
  assert.deepEqual(result, before);
  for (const status of ["partial", "failed", "skipped"]) {
    const incomplete = structuredClone(result);
    incomplete.complete = false;
    incomplete.searches[1].status = status;
    const coverage = renderOtherAirlineTable(incomplete);
    assert.match(coverage, /Failed stage/);
    assert.match(coverage, /WS {2,}First {2,}success/);
    assert.match(coverage, new RegExp(`WS {2,}Q {2,}${status}`));
  }
});

test("selectable default filters per carrier/cabin before merging and details in stable order", async () => {
  for (const selectableOnly of [undefined, false]) {
    const details = [];
    const f = fixture({
      discoverOtherAirlineCabins: async () => ["Y", "C"],
      searchOtherAirlineSchedule: async ({ cabin, airline }) => {
        const payload = schedule(
          cabin,
          ["WS101", "WS102", "WS103", "WS104", "WS105", "WS106"],
          airline,
        );
        const flights = payload.routings[0].flights;
        for (const [index, value] of [
          false,
          null,
          "true",
          1,
          true,
          true,
        ].entries()) {
          flights[index].selectable = value;
          flights[index].chance = "HIGH";
          flights[index].requestable = true;
        }
        delete flights[1].selectable;
        if (cabin === "C") flights[0].selectable = true;
        // Flight-level selectability is authoritative, regardless of request/segment flags.
        flights[4].chance = "LOW";
        flights[4].requestable = false;
        flights[4].segments[0].visibleButNotSelectable = true;
        return payload;
      },
      otherAirlineDetails: async ({ airline, cabin }, segments) => {
        details.push([airline, cabin, segments[0].flightNumber]);
        return { status: "success", segments: [] };
      },
    });
    const result = await searchOtherAirline(f.browser, {
      ...query,
      selectableOnly,
      details: true,
    });
    assert.equal(result.query.selectableOnly, selectableOnly !== false);
    assert.equal(result.complete, true);
    assert.ok(result.searches.every((s) => s.status === "success"));
    const numbers =
      selectableOnly === false
        ? ["WS101", "WS102", "WS103", "WS104", "WS105", "WS106"]
        : ["WS105", "WS106", "WS101"];
    assert.deepEqual(
      result.flights.map((f) => [f.searchedAirline, f.flightNumbers[0]]),
      query.airlines.flatMap((a) => numbers.map((n) => [a, n])),
    );
    for (const flight of result.flights) {
      assert.deepEqual(
        flight.cabins.map((c) => c.cabin),
        selectableOnly !== false && flight.flightNumbers[0] === "WS101"
          ? ["C"]
          : ["Y", "C"],
      );
    }
    assert.deepEqual(
      details,
      query.airlines.flatMap((a) =>
        ["Y", "C"].flatMap((c) =>
          (selectableOnly === false
            ? numbers
            : c === "Y"
              ? ["WS105", "WS106"]
              : ["WS101", "WS105", "WS106"]
          ).map((n) => [a, c, n]),
        ),
      ),
    );
    if (selectableOnly !== false) {
      assert.doesNotMatch(renderOtherAirlineTable(result), /WS102|WS103|WS104/);
      assert.doesNotMatch(JSON.stringify(result), /WS102|WS103|WS104/);
    }
  }
});

test("fully filtered schedules are successful empty coverage with no details", async () => {
  const f = fixture({
    discoverOtherAirlineCabins: async () => ["Y"],
    otherAirlineDetails: async () =>
      assert.fail("Excluded flights must not request details"),
  });
  const result = await searchOtherAirline(f.browser, {
    ...query,
    details: true,
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.flights, []);
  assert.deepEqual(
    result.searches.map((s) => s.status),
    ["success", "success"],
  );
  assert.match(renderOtherAirlineTable(result), /No flights found/);
  assert.equal(f.calls.at(-1), "restore");
});

test("malformed excluded flights still fail full schedule validation", async () => {
  for (const breakSchedule of [
    (p) => {
      p.routings[0].routingInfo.compartment = "C";
    },
    (p) => {
      p.routings[0].flights[1].segments = [];
    },
    (p) => {
      delete p.routings[0].flights[1].segments[0].arrival;
    },
  ]) {
    const f = fixture({
      discoverOtherAirlineCabins: async () => ["Y"],
      searchOtherAirlineSchedule: async () => {
        const payload = schedule("Y", ["WS101", "WS102"]);
        payload.routings[0].flights[0].selectable = true;
        breakSchedule(payload);
        return payload;
      },
      otherAirlineDetails: async () =>
        assert.fail("Invalid schedules must not request details"),
    });
    const result = await searchOtherAirline(f.browser, {
      ...query,
      details: true,
    });
    assert.equal(result.complete, false);
    assert.deepEqual(result.flights, []);
    assert.ok(
      result.searches.every(
        (s) => s.status === "failed" && s.error.stage === "schedule",
      ),
    );
  }
});

test("availability labels use white text on matching backgrounds without shifting columns or changing data", async () => {
  const f = fixture({
    discoverOtherAirlineCabins: async () => ["Y", "W", "C", "Q"],
  });
  const result = await searchOtherAirline(f.browser, {
    ...query,
    selectableOnly: false,
  });
  result.flights[0].cabins[1].chance = "MID";
  result.flights[0].cabins[3].chance = null;
  const before = structuredClone(result);
  const plain = renderOtherAirlineTable(result);
  const colored = renderOtherAirlineTable(result, { color: true });
  for (const [label, background] of [
    ["GREEN", 42],
    ["YELLOW", 43],
    ["RED", 41],
  ]) {
    assert.ok(colored.includes(`\x1b[97;${background}m${label}\x1b[0m`));
  }
  assert.equal(stripVTControlCharacters(colored), plain);
  assert.doesNotMatch(plain, /\x1b/);
  assert.match(colored, /UNKNOWN/);
  assert.doesNotMatch(colored, /\x1b\[[\d;]+m(?:UNKNOWN|not returned)/);
  assert.deepEqual(result, before);
});
