import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { buildAvailabilityRequest, normalizeAvailability, searchPorter } from "../src/search.js";

const fixture = JSON.parse(
  await fs.readFile(new URL("./fixtures/availability.json", import.meta.url), "utf8"),
);

test("builds the recorded staff availability request contract", () => {
  const request = buildAvailabilityRequest("YUL", "YTO", "2026-06-18");
  assert.equal(request.length, 1);
  assert.equal(request[0].FlightType, 5);
  assert.equal(request[0].FareTypes[0], "N");
  assert.equal(request[0].ProductClasses[0], "ZP");
  assert.equal(request[0].BeginDate, "2026-06-18");
});

test("normalizes flight and standby records", () => {
  const result = normalizeAvailability(fixture, {
    origin: "YUL",
    destination: "YTO",
    date: "2026-06-18",
  });
  const flight = result.flights[0];
  assert.deepEqual(flight.flightNumbers, ["PD2486"]);
  assert.equal(flight.availableSeats, 30);
  assert.equal(flight.porterClassicSeats, 30);
  assert.equal(flight.porterReserveSeats, 0);
  assert.equal(flight.emptySeats, 30);
  assert.equal(flight.standby.length, 2);
  assert.equal(flight.standby[0].employeeId, "12345678");
  assert.equal(flight.standby[0].priorityCode, "C4");
  assert.equal(flight.standbyAvailability[0].classic, 30);
});

test("uses the most constrained leg for connecting staff availability", () => {
  const payload = structuredClone(fixture);
  const journey = payload.searchResults[0].AvailableJourneys[0];
  journey.StandbyData.push({
    InventoryLegKey: {
      DepartureStation: "YTZ",
      ArrivalStation: "YOW",
      CarrierCode: "PD",
      FlightNumber: "123",
    },
    Availability: 8,
    ClassicAvailability: 6,
    ReserveAvailability: 2,
    PassengerList: [],
    SegmentSSRs: [],
  });

  const flight = normalizeAvailability(payload, {
    origin: "YUL",
    destination: "YOW",
    date: "2026-06-18",
  }).flights[0];

  assert.equal(flight.availableSeats, 8);
  assert.equal(flight.porterClassicSeats, 6);
  assert.equal(flight.porterReserveSeats, 0);
});

test("uses the site's native staff booking flow when the browser supports it", async () => {
  let submitted;
  const browser = {
    async searchStaffAvailability(query) {
      submitted = query;
      return response(JSON.stringify(fixture), {
        url: "https://www.flyporter.com/en-ca/flight/GetFlightAvailabilityStaffTravel",
        headers: { "content-type": "application/json" },
      });
    },
  };

  const result = await searchPorter(browser, {
    origin: "yul",
    destination: "yto",
    date: "2026-06-20",
  });

  assert.equal(submitted.origin, "YUL");
  assert.equal(submitted.destination, "YTO");
  assert.equal(result.flights[0].flightNumbers[0], "PD2486");
});

test("performs staff form setup before availability request", async () => {
  const calls = [];
  const browser = {
    async get(url) {
      calls.push({ method: "GET", url });
      return response(
        `
          <form method="post" action="/en-ca/staff/select">
            <input name="__RequestVerificationToken" value="token">
            <input name="chkPassengers" value="employee-key">
            <input name="FareClasses" value="R">
            <input name="ClassOfServiceNames" value="ZP">
          </form>
        `,
        { url: "https://www.flyporter.com/en-ca/staff/searchflight" },
      );
    },
    async request(url, options) {
      calls.push({ method: options.method, url: String(url), options });
      return response("", { url: "https://www.flyporter.com/en-ca/flight/book-your-travel" });
    },
    async getStaffSearchHtml() {
      return `
        <form method="post" action="/en-ca/staff/select">
          <input name="__RequestVerificationToken" value="token">
          <input name="chkPassengers" value="employee-key">
          <input name="FareClasses" value="R">
          <input name="ClassOfServiceNames" value="ZP">
        </form>
      `;
    },
    async post(url, options) {
      calls.push({ method: "POST", url, options });
      if (url.endsWith("/BuildFlightSearch") || url.endsWith("/LowFareSearch")) {
        return response("{}", {
          url,
          headers: { "content-type": "application/json" },
        });
      }
      return response(JSON.stringify(fixture), {
        url: "https://www.flyporter.com/en-ca/flight/GetFlightAvailabilityStaffTravel",
        headers: { "content-type": "application/json" },
      });
    },
  };

  const result = await searchPorter(browser, {
    origin: "YUL",
    destination: "YTO",
    date: "2026-06-18",
  });

  assert.equal(result.flights.length, 1);
  assert.equal(calls.length, 6);
  const formBody = calls[1].options.body;
  assert.equal(formBody.get("DepartStations"), "YUL");
  assert.equal(formBody.get("ArrivalStations"), "YTO");
  assert.equal(formBody.get("DepartDate"), "2026/06/18");
  assert.equal(formBody.get("chkPassengers"), "employee-key");
  assert.equal(calls[2].url, "https://www.flyporter.com/en-ca/flight/book-your-travel");
  assert.equal(calls[3].url, "https://www.flyporter.com/en-ca/flight/BuildFlightSearch");
  assert.equal(calls[3].options.body.get("DepartDate"), "2026/06/18");
  assert.equal(calls[4].url, "https://www.flyporter.com/en-ca/flight/LowFareSearch");
  assert.equal(JSON.parse(calls[5].options.body)[0].DepartureStation, "YUL");
});

function response(body, { url, headers = {}, status = 200 } = {}) {
  const result = new Response(body, { status, headers });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
