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
  const result = await searchOtherAirline(f.browser, query);
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
  assert.match(table, /GREEN/);
  assert.match(table, /YELLOW/);
  assert.match(table, /RED/);
  assert.doesNotMatch(table, /\b(?:HIGH|MID|LOW|favourable|moderate)\b/);
  assert.match(table, /not returned/);
  const itineraryRows = table.split("\n\n")[1].split("\n").slice(2);
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
  const result = await searchOtherAirline(f.browser, query);
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
