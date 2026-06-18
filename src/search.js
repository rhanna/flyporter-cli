import { SessionExpiredError, RemoteResponseError } from "./errors.js";
import { extractForm } from "./html.js";
import { validateAirportCode, validateDate } from "./validation.js";

const BASE_URL = "https://www.flyporter.com";
const SEARCH_PAGE_URL = `${BASE_URL}/en-ca/staff/searchflight`;
const AVAILABILITY_URL = `${BASE_URL}/en-ca/flight/GetFlightAvailabilityStaffTravel`;

export async function searchPorter(browser, { origin, destination, date }) {
  const departure = validateAirportCode(origin, "Origin");
  const arrival = validateAirportCode(destination, "Destination");
  const departureDate = validateDate(date);

  const pageResponse = await browser.get(SEARCH_PAGE_URL, {
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  assertAuthenticatedUrl(pageResponse.url);
  const html = await pageResponse.text();

  await establishStaffSearch(browser, html, {
    origin: departure,
    destination: arrival,
    date: departureDate,
  });

  const response = await browser.post(AVAILABILITY_URL, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/json; charset=UTF-8",
      origin: BASE_URL,
      referer: `${BASE_URL}/en-ca/flight/book-your-travel`,
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify(buildAvailabilityRequest(departure, arrival, departureDate)),
  });
  assertAuthenticatedUrl(response.url);

  if (!response.ok) {
    throw new RemoteResponseError(`Porter availability search failed with HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new RemoteResponseError("Porter returned malformed availability data.", { cause });
  }
  return normalizeAvailability(payload, { origin: departure, destination: arrival, date: departureDate });
}

async function establishStaffSearch(browser, html, { origin, destination, date }) {
  const form = extractForm(html, /\/staff\/select(?:\?|$)/i);
  const values = form.values;
  setFormValue(values, "DepartStations", origin);
  setFormValue(values, "ArrivalStations", destination);
  setFormValue(values, "TripType", "OneWay");
  setFormValue(values, "DepartDate", date.replaceAll("-", "/"));
  setFormValue(values, "ArrivalDate", "");
  setFormValue(values, "FareClasses", values.get("FareClasses") || "R");
  setFormValue(values, "LoyaltyFilter", values.get("LoyaltyFilter") || "0");
  setFormValue(values, "ClassOfServiceNames", values.get("ClassOfServiceNames") || "ZP");
  setFormValue(values, "SearchType", values.get("SearchType") || "JumpSeat");

  const url = new URL(form.action, SEARCH_PAGE_URL);
  const response = await browser.request(url, {
    method: form.method,
    headers: {
      accept: "text/html,application/xhtml+xml",
      "content-type": "application/x-www-form-urlencoded",
      origin: BASE_URL,
      referer: SEARCH_PAGE_URL,
    },
    body: values,
  });
  assertAuthenticatedUrl(response.url);
  if (!response.ok) {
    throw new RemoteResponseError(`Porter staff search setup failed with HTTP ${response.status}.`);
  }
}

function setFormValue(values, name, value) {
  values.delete(name);
  values.set(name, value);
}

export function buildAvailabilityRequest(origin, destination, date) {
  return [
    {
      DepartureStation: origin,
      ArrivalStation: destination,
      BeginDate: date,
      EndDate: date,
      CarrierCode: null,
      FlightNumber: null,
      FlightType: 5,
      PaxCount: 1,
      Dow: 1024,
      CurrencyCode: "CAD",
      DiscountCode: null,
      PromotionCode: "",
      AvailabilityType: 1,
      SourceOrganization: null,
      MaximumConnectingFlights: 20,
      AvailabilityFilter: 0,
      FareClassControl: 1,
      InboundOutbound: 2,
      TimeWindowsTotalMinutes: 0,
      FareTypes: ["N"],
      ProductClasses: ["ZP"],
      FareClasses: null,
      PaxPriceTypes: [{ PaxDiscountCode: null, PaxType: "ADT", Id: 0 }],
      JourneySortKeys: [4],
      IncludeTaxesAndFees: false,
      FareRuleFilter: 0,
      LoyaltyFilter: 0,
      PaxResidentCountry: "CA",
      selectedJourneySellKey: null,
      selectedFareSellKey: null,
      RemoveFareTypesAfterSubmit: null,
      NavitaireIncludeTaxesAndFees: true,
      SameDaySearch: false,
      FromLowFareSelection: false,
      DepartureStationName: null,
      ArrivalStationName: null,
      FlightSearchType: 0,
      Id: 0,
    },
  ];
}

export function normalizeAvailability(payload, query) {
  if (!payload || !Array.isArray(payload.searchResults)) {
    throw new RemoteResponseError("Porter returned an unexpected availability response.");
  }

  const flights = payload.searchResults.flatMap((result) =>
    (result.AvailableJourneys || []).map((journey) => normalizeJourney(journey)),
  );

  return {
    query,
    searchedAt: new Date().toISOString(),
    flights,
  };
}

function normalizeJourney(journey) {
  const segments = Array.isArray(journey.Segments) ? journey.Segments : [];
  const standbyLegs = Array.isArray(journey.StandbyData) ? journey.StandbyData : [];
  const standby = standbyLegs.flatMap((leg) =>
    (leg.PassengerList || []).map((passenger) => ({
      employeeId: passenger.EmployeeID ?? null,
      referenceEmployeeId: passenger.RefEmployeeID ?? null,
      viporterNumber: passenger.VIPorterNumber ?? null,
      priorityCode: passenger.PriorityCode ?? null,
      fareBasisCode: passenger.FareBasisCode ?? null,
      otherAirline: Boolean(passenger.isOA),
      inventoryLeg: normalizeInventoryLeg(leg.InventoryLegKey),
    })),
  );

  return {
    journeyKey: journey.JourneySellKey ?? null,
    flightNumbers: segments.map(formatFlightNumber),
    origin: journey.DepartureStation ?? segments[0]?.DepartureStation ?? null,
    destination: journey.ArrivalStation ?? segments.at(-1)?.ArrivalStation ?? null,
    scheduledDeparture: journey.formattedSTD ?? journey.STD ?? null,
    scheduledArrival: journey.formattedSTA ?? journey.STA ?? null,
    estimatedDeparture: journey.formattedETD ?? journey.ETD ?? null,
    estimatedArrival: journey.formattedETA ?? journey.ETA ?? null,
    equipment: [...new Set(segments.map((segment) => segment.EquipmentType).filter(Boolean))],
    stops: journey.Stops ?? Math.max(0, segments.length - 1),
    emptySeats: journey.EmptySeats ?? null,
    listedPassengerCount: journey.PassengerCount ?? standby.length,
    canBeSold: Boolean(journey.CanBeSold),
    international: Boolean(journey.International),
    standbyAvailability: standbyLegs.map((leg) => ({
      inventoryLeg: normalizeInventoryLeg(leg.InventoryLegKey),
      total: leg.Availability ?? null,
      classic: leg.ClassicAvailability ?? null,
      reserve: leg.ReserveAvailability ?? null,
      specialServices: (leg.SegmentSSRs || []).map((ssr) => ({
        code: ssr.SSRNestCode ?? null,
        capacity: ssr.MinLegLid ?? null,
        available: ssr.MinLegAvailable ?? null,
      })),
    })),
    standby,
    segments: segments.map((segment) => ({
      flightNumber: formatFlightNumber(segment),
      origin: segment.DepartureStation ?? null,
      destination: segment.ArrivalStation ?? null,
      scheduledDeparture: segment.formattedSTD ?? segment.STD ?? null,
      scheduledArrival: segment.formattedSTA ?? segment.STA ?? null,
      equipment: segment.EquipmentType ?? null,
      operatingCarrier: segment.OperatingCarrier ?? null,
      codeShare: Boolean(segment.IsCodeShareFlight),
    })),
  };
}

function formatFlightNumber(segment) {
  const designator = segment?.FlightDesignator || {};
  return `${designator.CarrierCode || ""}${designator.FlightNumber || ""}` || null;
}

function normalizeInventoryLeg(leg) {
  if (!leg) return null;
  return {
    origin: leg.DepartureStation ?? null,
    destination: leg.ArrivalStation ?? null,
    departure: leg.DepartureDate ?? null,
    flightNumber: `${leg.CarrierCode || ""}${leg.FlightNumber || ""}` || null,
  };
}

function assertAuthenticatedUrl(url) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.includes("/login") || pathname.includes("/viporter/sign-in")) {
    throw new SessionExpiredError();
  }
}
