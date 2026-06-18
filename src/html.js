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
  const form = $("form")
    .filter((_, element) => actionPattern.test($(element).attr("action") || ""))
    .first();

  if (!form.length) {
    throw new RemoteResponseError("The Porter staff search form could not be found.");
  }

  const values = new URLSearchParams();
  form.find("input, select, textarea").each((_, element) => {
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

  return {
    action: form.attr("action"),
    method: (form.attr("method") || "GET").toUpperCase(),
    values,
  };
}
