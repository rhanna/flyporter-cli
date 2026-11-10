// @ts-check
import { validateAirportCode, validateDate } from "./validation.js";
import { ValidationError } from "./errors.js";

export function validateAirlines(value) {
  const codes = (
    Array.isArray(value) ? value : String(value ?? "").split(",")
  ).map((code) => String(code).trim().toUpperCase());
  if (!codes.length || codes.some((code) => !/^[A-Z0-9]{2}$/.test(code)))
    throw new ValidationError(
      "Set --airline or FLYPORTER_AIRLINES to comma-separated two-character airline codes; empty values, empty entries and ALL are not supported.",
    );
  return [...new Set(codes)];
}

export function otherAirlineQuery(query) {
  return {
    origin: validateAirportCode(query.origin, "Origin"),
    destination: validateAirportCode(query.destination, "Destination"),
    date: validateDate(query.date),
    airlines: validateAirlines(query.airlines),
    details: query.details === true,
    selectableOnly: query.selectableOnly !== false,
  };
}

export function isFatalOtherAirlineError(error) {
  return [
    "AUTHENTICATION_FAILED",
    "SESSION_EXPIRED",
    "CLOUDFLARE_CHALLENGE",
    "TRANSPORT_ERROR",
  ].includes(error?.code);
}

function coverageError(error, airline, cabin, stage) {
  // Remote error text can contain profiles, server HTML or session values. Use fixed messages.
  return {
    airline,
    cabin,
    stage,
    code: isFatalOtherAirlineError(error)
      ? error.code
      : "REMOTE_RESPONSE_ERROR",
    message: `myIDTravel ${stage} failed.`,
  };
}

export async function searchOtherAirline(browser, input) {
  const query = otherAirlineQuery(input);
  const result = {
    query,
    searchedAt: new Date().toISOString(),
    complete: true,
    searches: [],
    flights: [],
  };
  const merged = new Map();
  let fatal;
  try {
    try {
      await browser.openOtherAirline();
    } catch (error) {
      fatal = error;
    }
    for (const airline of query.airlines) {
      if (fatal) {
        result.searches.push({
          airline,
          cabin: null,
          status: "skipped",
          error: coverageError(fatal, airline, null, "access"),
        });
        continue;
      }
      let cabins;
      try {
        cabins = await browser.discoverOtherAirlineCabins(airline);
        if (
          !Array.isArray(cabins) ||
          !cabins.length ||
          cabins.some((c) => typeof c !== "string" || !c)
        )
          throw new Error("No eligible cabins");
        cabins = [...new Set(cabins)];
      } catch (error) {
        result.searches.push({
          airline,
          cabin: null,
          status: "failed",
          error: coverageError(error, airline, null, "discovery"),
        });
        if (isFatalOtherAirlineError(error)) fatal = error;
        continue;
      }
      for (const cabin of cabins) {
        const operation = {
          airline,
          cabin,
          status: "success",
          searchedAt: new Date().toISOString(),
        };
        result.searches.push(operation);
        if (fatal) {
          operation.status = "skipped";
          operation.error = coverageError(fatal, airline, cabin, "schedule");
          continue;
        }
        let flights;
        try {
          const payload = await browser.searchOtherAirlineSchedule({
            ...query,
            airline,
            cabin,
          });
          operation.retrievedAt = new Date().toISOString();
          flights = normalizeOtherAirlineSchedule(
            payload,
            {
              ...query,
              airline,
              cabin,
            },
            operation.retrievedAt,
          );
        } catch (error) {
          operation.status = "failed";
          operation.error = coverageError(error, airline, cabin, "schedule");
          if (isFatalOtherAirlineError(error)) fatal = error;
          continue;
        }
        for (const flight of flights) {
          if (query.selectableOnly && flight.cabins[0].selectable !== true)
            continue;
          const key = JSON.stringify([
            airline,
            flight.segments.map((s) => [
              s.flightNumber,
              s.origin,
              s.destination,
              s.scheduledDeparture,
            ]),
          ]);
          const existing = merged.get(key);
          if (existing) existing.cabins.push(...flight.cabins);
          else {
            merged.set(key, flight);
            result.flights.push(flight);
          }
          if (query.details) {
            try {
              if (fatal) throw fatal;
              flight.cabins[0].details = await browser.otherAirlineDetails(
                { ...query, airline, cabin },
                flight.segments,
              );
              const details = flight.cabins[0].details;
              if (details.status !== "success") {
                operation.status = "partial";
                for (const error of details.errors || [
                  { code: "REMOTE_RESPONSE_ERROR", stage: "details" },
                ]) {
                  (operation.errors ||= []).push(
                    coverageError(
                      error,
                      airline,
                      cabin,
                      `details:${error.stage}`,
                    ),
                  );
                  if (isFatalOtherAirlineError(error)) fatal = error;
                }
              }
            } catch (error) {
              operation.status = "partial";
              const detailError = coverageError(
                error,
                airline,
                cabin,
                "details",
              );
              (operation.errors ||= []).push(detailError);
              flight.cabins[0].details = {
                status: fatal ? "skipped" : "failed",
                error: detailError,
              };
              if (isFatalOtherAirlineError(error)) fatal = error;
            }
          }
        }
      }
    }
  } finally {
    if (!fatal) {
      try {
        await browser.restorePorter();
      } catch (error) {
        fatal = error;
        result.searches.push({
          airline: null,
          cabin: null,
          status: "failed",
          error: coverageError(error, null, null, "restore"),
        });
      }
    }
  }
  result.complete = result.searches.every((s) => s.status === "success");
  // Access failures also need a failed record (rather than only skipped searches).
  if (fatal && result.searches.every((s) => s.status === "skipped")) {
    result.searches.unshift({
      airline: null,
      cabin: null,
      status: "failed",
      error: coverageError(fatal, null, null, "access"),
    });
  }
  if (fatal) result.fatal = true;
  return result;
}

const pick = (value, keys) =>
  Object.fromEntries(keys.map((key) => [key, value?.[key] ?? null]));
export function normalizeOtherAirlineSchedule(
  payload,
  query,
  retrievedAt = new Date().toISOString(),
) {
  if (
    payload?.success !== true ||
    !Array.isArray(payload.routings) ||
    payload.routings.length !== 1
  )
    throw new Error("Invalid flight schedule");
  const routing = payload.routings[0];
  const info = routing.routingInfo;
  if (
    info?.from?.code !== query.origin ||
    info?.to?.code !== query.destination ||
    info.departure !== query.date ||
    info.compartment !== query.cabin ||
    !Array.isArray(routing.flights)
  )
    throw new Error("Flight schedule criteria mismatch");
  return routing.flights.map((flight) => {
    if (!Array.isArray(flight.segments) || !flight.segments.length)
      throw new Error("Missing segments");
    const segments = flight.segments.map((s) => {
      if (
        !s.flightNumber ||
        !s.from?.code ||
        !s.to?.code ||
        !s.departure ||
        !s.arrival
      )
        throw new Error("Invalid segment");
      return {
        flightNumber: s.flightNumber,
        simpleFlightNumber: s.simpleFlightNumber ?? null,
        origin: s.from.code,
        destination: s.to.code,
        scheduledDeparture: s.departure,
        scheduledArrival: s.arrival,
        equipment: s.aircraft ?? null,
        stops: s.stopQuantity ?? null,
        operatingCarrier: s.operatingAirline?.code ?? null,
        marketingCarrier: s.marketingAirline?.code ?? null,
        ticketingCarrier: s.ticketingAirline?.code ?? null,
        codeShare: s.codeshare ?? null,
        travelStatus: s.travelStatus ?? null,
        kindOfTravel: s.kindOftravelId ?? s.kindOfTravel ?? null,
        travelMode: s.travelMode ?? null,
      };
    });
    return {
      searchedAirline: query.airline,
      flightNumbers: segments.map((s) => s.flightNumber),
      origin: segments[0].origin,
      destination: segments.at(-1).destination,
      scheduledDeparture: segments[0].scheduledDeparture,
      scheduledArrival: segments.at(-1).scheduledArrival,
      stops: segments.every((s) => typeof s.stops === "number")
        ? segments.length - 1 + segments.reduce((n, s) => n + s.stops, 0)
        : null,
      segments,
      cabins: [
        {
          cabin: query.cabin,
          retrievedAt,
          ...pick(flight, [
            "chance",
            "selectable",
            "requestable",
            "compartment",
          ]),
          segments: flight.segments.map((s) => ({
            ...pick(s, [
              "chance",
              "bookableSeats",
              "compartment",
              "compartmentAdjusted",
              "visibleButNotSelectable",
              "showTotalAvailableSeats",
            ]),
            inventory: (s.jseats ?? []).map((b) => ({
              ...pick(b, [
                "bookingClass",
                "quantity",
                "closed",
                "relevant4Request",
                "configured4Request",
                "compartment",
                "chance",
              ]),
              disclosed:
                b.quantity !== null &&
                b.quantity !== undefined &&
                /^\d+$/.test(String(b.quantity)),
            })),
          })),
        },
      ],
    };
  });
}
