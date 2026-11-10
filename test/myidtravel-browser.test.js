import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ChromeBrowser } from "../src/browser.js";
import { RemoteChromiumBrowser } from "../src/remote-chromium-browser.js";
import { BapBrowser } from "../src/bap-browser.js";
import { myidtravelExpression } from "../src/myidtravel-browser.js";

function fixture() {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://www.myidtravel.com/myidtravel/rui/",
    runScripts: "outside-only",
  });
  const w = dom.window;
  w.AbortSignal = AbortSignal;
  w.localStorage.setItem("csrf", "secret-csrf");
  w.sessionStorage.setItem("tabId", "secret-tab");
  const travellers = [
    { id: 1, name: "SYNTHETIC HOLDER", lastName: "TEST", isEmployee: true },
    { id: 2, name: "SYNTHETIC DEPENDENT", preselected: true },
  ];
  w.document.getElementById("root").__reactContainer$test = {
    child: {
      memoizedProps: {
        value: {
          store: {
            getState: () => ({
              login: { loginData: { travellers, accessMode: "LEISURE" } },
            }),
          },
        },
      },
    },
  };
  const calls = [];
  let count = 0;
  w.fetch = async (path, options) => {
    const body = JSON.parse(options.body);
    calls.push({ path, body });
    assert.equal(body.csrf, "secret-csrf");
    assert.equal(body.tabId, "secret-tab");
    assert.equal(options.credentials, "include");
    let data = { success: true };
    if (path.endsWith("travellerselection"))
      data = {
        success: true,
        eligibleAgreements: [{ airline: body.airline }],
        travelStatus: [
          {
            id: 77,
            name: "R2 Standby",
            metaKindOfTravel: "R2",
            allowedCompartments:
              body.airline === "TS" ? ["Q", "Y"] : ["Y", "W", "C"],
          },
        ],
      };
    if (path.endsWith("flightschedule")) {
      count++;
      data = {
        success: true,
        csrf: "do-not-export",
        profile: travellers,
        routings: [
          {
            routingInfo: {
              from: { code: body.routings[0].origin },
              to: { code: body.routings[0].destination },
              departure: body.routings[0].date,
              compartment: body.routings[0].compartment,
            },
            flights: [],
          },
        ],
      };
    }
    return { status: 200, ok: true, json: async () => data };
  };
  const page = { evaluate: async (expression) => w.eval(expression) };
  return { w, calls, page, travellers, count: () => count };
}
for (const backend of ["local", "remote-chromium", "bap"]) {
  test(`${backend}: browser-owned dynamic carrier/cabin selection and fresh schedule requests`, async () => {
    const f = fixture();
    const b =
      backend === "bap"
        ? new BapBrowser({ timeout: 1000 }, {}, f.page, {})
        : backend === "local"
          ? new ChromeBrowser({ page: f.page })
          : new RemoteChromiumBrowser(
              { timeout: 1000 },
              {},
              {},
              f.page,
              {},
              {},
            );
    assert.deepEqual(await b.discoverOtherAirlineCabins("TS"), ["Q", "Y"]);
    assert.deepEqual(f.calls.at(-1).body.travellers, [1]);
    assert.equal(f.travellers[1].preselected, true); // Selection does not edit profiles.
    const q = {
      airline: "TS",
      cabin: "Q",
      origin: "YYZ",
      destination: "YVR",
      date: "2026-11-12",
    };
    for (let n = 0; n < 2; n++) {
      const result = await b.searchOtherAirlineSchedule(q);
      assert.deepEqual(result.routings[0].flights, []);
      assert.doesNotMatch(
        JSON.stringify(result),
        /csrf|secret|SYNTHETIC|profile/,
      );
    }
    assert.equal(f.count(), 2);
    assert.equal(f.calls.at(-1).body.travelType, "ONE_WAY");
    assert.equal(f.calls.at(-1).body.routings[0].travelStatus, 77);
    assert.deepEqual(
      f.calls.map((c) => c.path),
      [
        "/myidtravel/json/booking/preparebooking",
        "/myidtravel/json/booking/travellerselection",
        "/myidtravel/json/booking/flightschedule",
        "/myidtravel/json/booking/flightschedule",
      ],
    );
    await assert.rejects(b.searchOtherAirlineSchedule({ ...q, cabin: "F" }));
    await assert.rejects(b.discoverOtherAirlineCabins("ALL"));
    assert.equal(f.calls.length, 4);
  });
}
test("account-holder ambiguity, authentication and challenges fail before submission", async () => {
  const f = fixture();
  f.travellers.push({ id: 3, isEmployee: true });
  let result = JSON.parse(
    await f.page.evaluate(
      myidtravelExpression({ action: "discover", airline: "WS" }),
    ),
  );
  assert.equal(result.error.code, "REMOTE_RESPONSE_ERROR");
  assert.equal(f.calls.length, 0);
  f.w.document.title = "Just a moment";
  result = JSON.parse(
    await f.page.evaluate(myidtravelExpression({ action: "ready" })),
  );
  assert.equal(result.error.code, "CLOUDFLARE_CHALLENGE");
  f.w.document.title = "myIDTravel";
  f.w.localStorage.removeItem("csrf");
  f.travellers.pop();
  result = JSON.parse(
    await f.page.evaluate(
      myidtravelExpression({ action: "discover", airline: "WS" }),
    ),
  );
  assert.equal(result.error.code, "SESSION_EXPIRED");
  assert.equal(f.calls.length, 0);
});
test("HTTP and transport failures are classified without exporting server messages", async () => {
  const f = fixture();
  for (const mode of ["http", "transport", "malformed", "auth"]) {
    f.w.fetch = async () => {
      if (mode === "transport") throw new Error("sensitive request");
      return {
        status: mode === "auth" ? 403 : 500,
        ok: false,
        json: async () => ({ secret: "sensitive" }),
      };
    };
    if (mode === "malformed")
      f.w.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("sensitive");
        },
      });
    const value = JSON.parse(
      await f.page.evaluate(
        myidtravelExpression({ action: "discover", airline: "WS" }),
      ),
    );
    assert.equal(
      value.error.code,
      {
        http: "REMOTE_RESPONSE_ERROR",
        transport: "TRANSPORT_ERROR",
        malformed: "REMOTE_RESPONSE_ERROR",
        auth: "SESSION_EXPIRED",
      }[mode],
    );
    assert.doesNotMatch(JSON.stringify(value), /sensitive/);
  }
});

test("details normalize published loads, capped values, seat availability and standby separately", async () => {
  const f = fixture();
  const b = new ChromeBrowser({ page: f.page });
  await b.discoverOtherAirlineCabins("WS");
  const seen = [];
  f.w.fetch = async (path, options) => {
    seen.push({ path, body: JSON.parse(options.body) });
    const data = path.endsWith("flightLoad")
      ? {
          success: true,
          segments: [
            {
              airline: "WS",
              flightNumber: "101",
              origin: "YYZ",
              destination: "YVR",
              departureDateTime: "2026-11-13T04:30:00Z",
              cacheLastUpdate: "2026-11-12T10:00Z",
              flightLoadEntries: [
                {
                  compartmentKey: "C",
                  available: 9,
                  availableCapped: "9+",
                  waitlist: null,
                },
              ],
            },
          ],
        }
      : {
          success: true,
          csrf: "hidden",
          segments: [
            {
              flightNumber: "WS101",
              originCity: { code: "YYZ" },
              destinationCity: { code: "YVR" },
              departure: "2026-11-12T23:30-0500",
              availableSeatDetails: {
                availableSeatDetailEntries: [{ cabin: "C", seatsRemaining: 0 }],
              },
              standbyList: {
                listAsText: "unfiltered text",
                standbyListEntries: [
                  {
                    passenger: "SYNTHETIC PASSENGER",
                    priority: "R2",
                    cabin: "C",
                    remark: "unfiltered private remark",
                    groupPnrId: "hidden",
                  },
                ],
              },
            },
          ],
        };
    return { ok: true, status: 200, json: async () => data };
  };
  const segments = [
    {
      flightNumber: "WS101",
      simpleFlightNumber: "101",
      marketingCarrier: "WS",
      origin: "YYZ",
      destination: "YVR",
      scheduledDeparture: "2026-11-12T23:30-0500",
      scheduledArrival: "2026-11-13T01:30-0800",
      kindOfTravel: "R2",
      travelStatus: "STANDBY",
    },
  ];
  const q = { airline: "WS", cabin: "C" };
  const detail = await b.otherAirlineDetails(q, segments);
  assert.equal(detail.status, "success");
  assert.equal(detail.segments[0].flightLoad.loads[0].availableCapped, "9+");
  assert.equal(detail.segments[0].flightLoad.loads[0].waitlist, null);
  assert.equal(
    detail.segments[0].flightDetails.seatAvailability[0].seatsRemaining,
    0,
  );
  assert.equal(
    detail.segments[0].flightDetails.standby[0].passenger,
    "SYNTHETIC PASSENGER",
  );
  assert.doesNotMatch(
    JSON.stringify(detail),
    /unfiltered|hidden|groupPnr|csrf/,
  );
  assert.deepEqual(
    seen.map((s) => s.path),
    ["/myidtravel/json/flightLoad", "/myidtravel/json/flightDetails"],
  );
  assert.equal(seen[0].body.flights[0].compartment, "C");
  const original = f.w.fetch;
  f.w.fetch = async (path, options) =>
    path.endsWith("flightDetails")
      ? { ok: false, status: 500 }
      : original(path, options);
  const partial = await b.otherAirlineDetails(q, segments);
  assert.equal(partial.status, "partial");
  assert.equal(partial.segments[0].flightLoad.loads[0].availableCapped, "9+");
  assert.equal(partial.segments[0].flightDetails, null);
  assert.equal(partial.errors[0].stage, "flightDetails");
  f.w.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, segments: [] }),
  });
  const unknown = await b.otherAirlineDetails(q, segments);
  assert.equal(unknown.status, "success");
  assert.equal(unknown.segments[0].flightLoad, null);
  f.w.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      segments: [
        {
          flightNumber: "101",
          origin: "YYZ",
          destination: "YVR",
          departureDateTime: "2026-11-14T04:30:00Z",
        },
      ],
    }),
  });
  assert.equal((await b.otherAirlineDetails(q, segments)).status, "partial");
});

for (const backend of ["local", "remote-chromium", "bap"]) {
  test(`${backend}: SSO waits for account state and restores verified Porter controls`, async () => {
    const f = fixture();
    const calls = [];
    const report = {
      capture: async () => calls.push("capture"),
      event: async () => {},
    };
    const b =
      backend === "bap"
        ? new BapBrowser({ timeout: 1000 }, {}, f.page, report)
        : backend === "local"
          ? new ChromeBrowser({ page: f.page })
          : new RemoteChromiumBrowser(
              { timeout: 1000 },
              {},
              {},
              f.page,
              report,
              {},
            );
    const navigation = async (url) => {
      calls.push(url);
    };
    if (backend === "bap") {
      f.page.goto = navigation;
      b.solve = async () => b.report.capture("suppressed-account-data");
      b.hasStaffAccess = async () => {
        calls.push("verify-porter");
        return true;
      };
    } else {
      b.goto = navigation;
      f.page.goto = navigation;
      b.waitForChallengeToClear = async () => {};
      f.page.waitForFunction = async () => calls.push("verify-porter");
    }
    await b.openOtherAirline();
    assert.equal(b.otherAirlineActive, true);
    assert.equal(
      calls[0],
      "https://www.flyporter.com/en-ca/staff/otherairlines",
    );
    assert.ok(!calls.includes("capture"));
    await b.restorePorter();
    assert.equal(b.otherAirlineActive, false);
    assert.ok(
      calls.includes("https://www.flyporter.com/en-ca/staff/searchflight"),
    );
    assert.equal(calls.at(-1), "verify-porter");
  });
}
