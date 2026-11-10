// @ts-check
// This function is serialized into either browser. It must have no module closures.
// Session/profile state never crosses the browser boundary. Only allowlisted availability does.
export async function myidtravelOperation(args) {
  const runtime =
    /** @type {Window & { __flyporterMyid?: { airline: string, status: number, cabins: string[] } }} */ (
      window
    );
  const fail = (code) => {
    throw Object.assign(new Error("myIDTravel operation failed."), { code });
  };
  const pick = (value, keys) =>
    Object.fromEntries(
      keys.map((key) => {
        const field = value?.[key];
        return [
          key,
          ["string", "number", "boolean"].includes(typeof field) ? field : null,
        ];
      }),
    );
  const code = (value) => (value ? { code: value.code } : null);
  try {
    if (location.origin !== "https://www.myidtravel.com")
      fail("SESSION_EXPIRED");
    if (
      /just a moment|verify you are human/i.test(
        document.title + document.body?.innerText,
      )
    )
      fail("CLOUDFLARE_CHALLENGE");
    const post = async (path, body) => {
      const csrf = localStorage.getItem("csrf");
      const tabId = sessionStorage.getItem("tabId");
      if (!csrf || !tabId) fail("SESSION_EXPIRED");
      let response;
      try {
        response = await fetch(`/myidtravel/json/${path}`, {
          method: "POST",
          credentials: "include",
          redirect: "error",
          cache: "no-store",
          headers: { "Content-Type": "application/json;charset=utf-8" },
          body: JSON.stringify({ ...body, csrf, tabId }),
          signal: AbortSignal.timeout(args.timeout || 60000),
        });
      } catch {
        fail("TRANSPORT_ERROR");
      }
      if (response.status === 401 || response.status === 403)
        fail("SESSION_EXPIRED");
      if (!response.ok) fail("REMOTE_RESPONSE_ERROR");
      let data;
      try {
        data = await response.json();
      } catch {
        fail("REMOTE_RESPONSE_ERROR");
      }
      if (data.timeout === true) fail("SESSION_EXPIRED");
      if (data.success !== true) fail("REMOTE_RESPONSE_ERROR");
      return data;
    };
    const store = () => {
      const root = document.getElementById("root");
      const key =
        root &&
        Object.keys(root).find(
          (k) =>
            k.startsWith("__reactContainer$") || k.startsWith("__reactFiber$"),
        );
      const start = root?.[key];
      const stack = [start?.stateNode?.current || start?.current || start];
      const seen = new Set();
      while (stack.length && seen.size < 50000) {
        const fiber = stack.pop();
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        const candidate =
          fiber.memoizedProps?.store || fiber.memoizedProps?.value?.store;
        if (candidate?.getState) return candidate;
        stack.push(fiber.child, fiber.sibling, fiber.alternate);
      }
      return null;
    };
    if (args.action === "ready") {
      const data = store()?.getState()?.login?.loginData;
      return JSON.stringify({ ready: !!data?.travellers?.length });
    }
    if (args.action === "discover") {
      if (!/^[A-Z0-9]{2}$/.test(args.airline)) fail("INVALID_ARGUMENT");
      const login = store()?.getState()?.login?.loginData;
      const holders = login?.travellers?.filter(
        (t) =>
          (t.isEmployee || t.employee) &&
          !t.disabledByPermission &&
          !t.disabledByInvalidPtc,
      );
      if (holders?.length !== 1) fail("REMOTE_RESPONSE_ERROR");
      const holder = holders[0];
      await post("booking/preparebooking", {
        accessMode: login.accessMode,
        containerInformations: [
          { identifier: "TripCreationPrepareData" },
          { identifier: "FlightScheduleQuery" },
        ],
      });
      const selection = await post("booking/travellerselection", {
        airline: args.airline,
        travellers: [holder.id],
        travelPartners: [],
        buddyTravellers: [],
        dynamicTravellers: [],
        travelPartnersOnDuty: [],
        jubileeRetireeTravellingCompanions: [],
        travellerAttributes: [
          {
            traveller: holder.id,
            ...pick(holder, [
              "salutation",
              "gender",
              "middleName",
              "name",
              "lastName",
              "dateOfBirth",
            ]),
          },
        ],
      });
      if (
        !Array.isArray(selection.eligibleAgreements) ||
        !selection.eligibleAgreements.some((a) => a.airline === args.airline)
      )
        fail("REMOTE_RESPONSE_ERROR");
      const status = selection.travelStatus?.find(
        (s) => s.metaKindOfTravel === "R2",
      );
      if (!status) fail("REMOTE_RESPONSE_ERROR");
      const allowed = status.allowedCompartments?.length
        ? status.allowedCompartments
        : selection.availableCompartmentsEmploying;
      if (
        !Array.isArray(allowed) ||
        !allowed.length ||
        allowed.some((c) => typeof c !== "string" || !c)
      )
        fail("REMOTE_RESPONSE_ERROR");
      // The server supplies account/carrier/status-specific compartments. No exhaustive cabin list.
      runtime.__flyporterMyid = {
        airline: args.airline,
        status: status.id,
        cabins: [...new Set(allowed)],
      };
      return JSON.stringify({ cabins: runtime.__flyporterMyid.cabins });
    }
    const context = runtime.__flyporterMyid;
    if (
      !context ||
      context.airline !== args.airline ||
      !context.cabins.includes(args.cabin)
    )
      fail("REMOTE_RESPONSE_ERROR");
    if (args.action === "schedule") {
      const data = await post("booking/flightschedule", {
        airline: args.airline,
        routings: [
          {
            origin: args.origin,
            destination: args.destination,
            date: args.date,
            travelStatus: context.status,
            compartment: args.cabin,
            time: "00:00",
          },
        ],
        nonStop: false,
        filterCodesharedFlights: null,
        travelType: "ONE_WAY",
        sevenDaySearchRequested: false,
      });
      if (!Array.isArray(data.routings)) fail("REMOTE_RESPONSE_ERROR");
      return JSON.stringify({
        success: true,
        routings: data.routings.map((r) => ({
          routingInfo: r.routingInfo && {
            ...pick(r.routingInfo, [
              "departure",
              "compartment",
              "kindOfTravel",
            ]),
            from: code(r.routingInfo.from),
            to: code(r.routingInfo.to),
          },
          flights: Array.isArray(r.flights)
            ? r.flights.map((f) => ({
                ...pick(f, [
                  "chance",
                  "selectable",
                  "requestable",
                  "compartment",
                ]),
                segments: Array.isArray(f.segments)
                  ? f.segments.map((s) => ({
                      ...pick(s, [
                        "flightNumber",
                        "simpleFlightNumber",
                        "departure",
                        "arrival",
                        "aircraft",
                        "stopQuantity",
                        "codeshare",
                        "travelStatus",
                        "kindOftravelId",
                        "kindOfTravel",
                        "travelMode",
                        "chance",
                        "bookableSeats",
                        "compartment",
                        "compartmentAdjusted",
                        "visibleButNotSelectable",
                        "showTotalAvailableSeats",
                      ]),
                      from: code(s.from),
                      to: code(s.to),
                      operatingAirline: code(s.operatingAirline),
                      marketingAirline: code(s.marketingAirline),
                      ticketingAirline: code(s.ticketingAirline),
                      jseats: Array.isArray(s.jseats)
                        ? s.jseats.map((b) =>
                            pick(b, [
                              "bookingClass",
                              "quantity",
                              "closed",
                              "relevant4Request",
                              "configured4Request",
                              "compartment",
                              "chance",
                            ]),
                          )
                        : [],
                    }))
                  : null,
              }))
            : null,
        })),
      });
    }
    if (args.action === "details") {
      const results = [];
      const errors = [];
      let fatalCode;
      for (const segment of args.segments) {
        const flight = {
          airline: segment.marketingCarrier || segment.operatingCarrier,
          flightNumber:
            segment.simpleFlightNumber ||
            segment.flightNumber.replace(/^[A-Z0-9]{2}/, ""),
          departureDateTime: segment.scheduledDeparture,
          arrivalDateTime: segment.scheduledArrival,
          origin: segment.origin,
          destination: segment.destination,
          stopQuantity: segment.stops,
          kindOfTravel: segment.kindOfTravel,
          travelMode: segment.travelMode,
          travelStatus: segment.travelStatus,
          compartment: args.cabin,
        };
        const entries = {};
        for (const endpoint of ["flightLoad", "flightDetails"]) {
          try {
            if (fatalCode) fail(fatalCode);
            const data = await post(endpoint, {
              flights: [flight],
              skipCache: false,
            });
            if (!Array.isArray(data.segments)) fail("REMOTE_RESPONSE_ERROR");
            const match = data.segments.find((s) => {
              const origin = s.origin ?? s.originCity?.code;
              const destination = s.destination ?? s.destinationCity?.code;
              const departure = s.departureDateTime ?? s.departure;
              const responseCarrier = s.airline?.code ?? s.airline;
              const carrierMatches =
                !responseCarrier ||
                [flight.airline, segment.operatingCarrier].includes(
                  responseCarrier,
                );
              const number = String(
                s.simpleFlightNumber ?? s.flightNumber,
              ).replace(/\s/g, "");
              return (
                carrierMatches &&
                origin === segment.origin &&
                destination === segment.destination &&
                new Date(departure).getTime() ===
                  new Date(segment.scheduledDeparture).getTime() &&
                [flight.flightNumber, segment.flightNumber].includes(number)
              );
            });
            // Empty published detail collections mean unknown, never zero.
            if (!match && data.segments.length) fail("REMOTE_RESPONSE_ERROR");
            const loadKeys = [
              "compartmentKey",
              "available",
              "availableCapped",
              "sold",
              "capacity",
              "authorized",
              "nonRevenue",
              "confirmed",
              "standby",
              "waitlist",
              "forecast",
              "currentAvailability",
              "currentFlightLoadAvailability",
              "fullyBooked",
              "chance",
            ];
            const list =
              match?.flightLoadEntries ??
              match?.flightLoad?.flightLoadEntries ??
              match?.flightLoad?.flightLoad ??
              (Array.isArray(match?.flightLoad) ? match.flightLoad : null);
            entries[endpoint] = match
              ? {
                  ...pick(match, [
                    "cacheLastUpdate",
                    "cacheExpireDate",
                    "overallChance",
                  ]),
                  loads: list?.map((v) => pick(v, loadKeys)) ?? null,
                  inventory:
                    match.jseats?.map((v) =>
                      pick(v, [
                        "bookingClass",
                        "quantity",
                        "closed",
                        "relevant4Request",
                        "configured4Request",
                        "compartment",
                        "chance",
                      ]),
                    ) ?? null,
                  seatAvailability:
                    match.availableSeatDetails?.availableSeatDetailEntries?.map(
                      (v) =>
                        pick(v, [
                          "cabin",
                          "authorizedSeats",
                          "checkedInRevenue",
                          "clearedNonRevenue",
                          "seatsRemaining",
                        ]),
                    ) ?? null,
                  bookingSituation:
                    match.bookingSituation?.bookingSituationEntries?.map((v) =>
                      pick(v, [
                        "compartmentKey",
                        "productFlightX1Closed",
                        "bookedR6DutyClosed",
                        "jubileeRetirementFlightClosed",
                        "bookedAvR1Closed",
                        "compartment",
                        "productFlight",
                        "bookedR6Duty",
                        "retirementFlight",
                        "bookedAvR1",
                      ]),
                    ) ?? null,
                  standby:
                    match.standbyList?.standbyListEntries?.map((v) =>
                      pick(v, [
                        "priority",
                        "passenger",
                        "cabin",
                        "countedPosition",
                        "totalPassengersListed",
                        "flightStatus",
                      ]),
                    ) ?? null,
                }
              : null;
          } catch (error) {
            const errorCode = error.code || "REMOTE_RESPONSE_ERROR";
            errors.push({
              code: errorCode,
              stage: endpoint,
              flightNumber: segment.flightNumber,
            });
            entries[endpoint] = null;
            if (
              [
                "TRANSPORT_ERROR",
                "SESSION_EXPIRED",
                "CLOUDFLARE_CHALLENGE",
                "AUTHENTICATION_FAILED",
              ].includes(errorCode)
            )
              fatalCode = errorCode;
          }
        }
        results.push({
          flightNumber: segment.flightNumber,
          origin: segment.origin,
          destination: segment.destination,
          departure: segment.scheduledDeparture,
          cabin: args.cabin,
          searchedAirline: args.airline,
          retrievedAt: new Date().toISOString(),
          ...entries,
        });
      }
      return JSON.stringify({
        status: errors.length ? "partial" : "success",
        segments: results,
        errors,
      });
    }
    fail("REMOTE_RESPONSE_ERROR");
  } catch (error) {
    return JSON.stringify({
      error: { code: error.code || "REMOTE_RESPONSE_ERROR" },
    });
  }
}
