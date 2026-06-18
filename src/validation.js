import { ValidationError } from "./errors.js";

export function validateAirportCode(value, label) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new ValidationError(`${label} must be a three-letter airport or city code.`);
  }
  return code;
}

export function validateDate(value) {
  const date = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new ValidationError("Date must use YYYY-MM-DD format.");

  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() + 1 !== Number(match[2]) ||
    parsed.getUTCDate() !== Number(match[3])
  ) {
    throw new ValidationError("Date is not a valid calendar date.");
  }
  return date;
}
