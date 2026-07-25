import * as cheerio from "cheerio";
import { RemoteResponseError } from "./errors.js";

export function extractVerificationToken(html) {
  const $ = cheerio.load(html);
  const token = $('input[name="__RequestVerificationToken"]').first().attr("value");
  if (!token) {
    throw new RemoteResponseError("The Porter page did not contain an anti-forgery token.");
  }
  return token;
}

export function extractForm(html, actionPattern) {
  const $ = cheerio.load(html);
  let form = $("form")
    .filter((_, element) => actionPattern.test($(element).attr("action") || ""))
    .first();

  if (!form.length) {
    form = $("form")
      .filter((_, element) =>
        Boolean(
          $(element).find(
            'input[name="chkPassengers"], input[name="SearchType"], input[name="ClassOfServiceNames"]',
          ).length,
        ),
      )
      .first();
  }

  let controls = form;
  let action = form.attr("action");
  let method = (form.attr("method") || "GET").toUpperCase();

  if (!form.length) {
    controls = $(
      'input[name="__RequestVerificationToken"], input[name="chkPassengers"], ' +
        'input[name="SearchType"], input[name="ClassOfServiceNames"], ' +
        'input[name="FareClasses"], input[name="LoyaltyFilter"]',
    );
    if (!controls.length) {
      throw new RemoteResponseError("The Porter staff search form could not be found.");
    }
    action = "/en-ca/staff/select";
    method = "POST";
  }

  const values = new URLSearchParams();
  const fields = form.length ? form.find("input, select, textarea") : controls;
  fields.each((_, element) => {
    const field = $(element);
    const name = field.attr("name");
    if (!name || field.is(":disabled")) return;

    if (field.is("input")) {
      const type = (field.attr("type") || "text").toLowerCase();
      if ((type === "checkbox" || type === "radio") && !field.is(":checked")) return;
      values.append(name, field.attr("value") || "");
      return;
    }

    if (field.is("select")) {
      const selected = field.find("option:selected").first();
      values.append(name, selected.attr("value") || selected.text() || "");
      return;
    }

    values.append(name, field.text() || "");
  });

  if (!values.has("chkPassengers")) {
    const passenger = fields.filter('input[name="chkPassengers"]').first().attr("value");
    if (passenger) values.set("chkPassengers", passenger);
  }

  return {
    action,
    method,
    values,
  };
}
