// @ts-check

export const CONTROL_ATTRIBUTE = "data-porter-poc";

// Runs in the remote browser. Keep this function self-contained.
export function discoverControl(field, override) {
  const patterns = {
    username: /user.?name|email|employee|staff.?id|vip.?orter.?number/i,
    password: /password/i,
    "login-submit": /^(log\s*in|sign\s*in|login)$/i,
    "one-way": /one[\s-]*way/i,
    origin:
      /origin|departure.?airport|departing.?from|^from$|^from\s|^departure.?city/i,
    destination: /destination|arrival.?airport|arriving.?at|^to$|^to\s/i,
    "departure-date": /depart.*date|date.*depart|outbound|^departure$/i,
    "search-submit": /search.*flight|find.*flight|^search$/i,
  };
  const candidates = Array.from(
    document.querySelectorAll(
      override ||
        (field === "one-way"
          ? "*"
          : 'input:not([type="hidden"]), select, button, a, [role="button"], label'),
    ),
  ).filter((el) => {
    const rect = el.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      getComputedStyle(el).visibility !== "hidden"
    );
  });
  const matches = candidates.filter((el) => {
    if (override) return true;
    if (field === "one-way")
      return (
        el.childElementCount === 0 &&
        /^one[\s-]*way$/i.test(el.textContent?.trim() || "")
      );
    const input = el;
    const text = [
      el.getAttribute("aria-label"),
      el.getAttribute("placeholder"),
      el.id,
      el.getAttribute("name"),
      ...Array.from(input.labels || []).map((label) => label.textContent),
      el.tagName === "INPUT"
        ? input.type === "submit"
          ? input.value
          : ""
        : el.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (field === "password") return input.type === "password";
    if (
      ["username", "origin", "destination", "departure-date"].includes(field) &&
      !["INPUT", "SELECT"].includes(el.tagName)
    )
      return false;
    if (field.endsWith("submit")) {
      return ["BUTTON", "A"].includes(el.tagName) || input.type === "submit"
        ? patterns[field].test(el.textContent?.trim() || input.value || "")
        : false;
    }
    return patterns[field].test(text);
  });
  // A radio and its label describe the same action. Prefer the label for native clicks.
  const preferred =
    field === "one-way" ? matches.filter((el) => el.tagName === "LABEL") : [];
  const found = preferred.length ? preferred : matches;
  if (!found.length) return null;
  if (found.length !== 1)
    throw new Error(`Ambiguous ${field}; set its PORTER_*_SELECTOR.`);
  found[0].setAttribute("data-porter-poc", field);
  return `[data-porter-poc="${field}"]`;
}

export function controlExpression(field, override) {
  return `(${discoverControl.toString()})(${JSON.stringify(field)}, ${JSON.stringify(override) || "undefined"})`;
}

/** @param {import("@browserless.io/bap-ts").Page} page */
export async function findControl(page, field, override) {
  const result = await page.evaluate(controlExpression(field, override));
  if (!result)
    throw new Error(
      `Cannot find ${field}; inspect artifacts and set its PORTER_*_SELECTOR.`,
    );
  return result;
}

/** @param {import("@browserless.io/bap-ts").Page} page */
export async function enterText(page, selector, value) {
  // Clear existing text before BAP's native typing; its focus click can reset text selection.
  await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!(el instanceof HTMLInputElement) || el.readOnly || el.disabled)
      throw new Error('Expected an editable input; configure a selector for the actual input.');
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles:true }));
    el.select();
  })()`);
  await page.type(selector, value, { visible: true });
}

/** @param {import("@browserless.io/bap-ts").Page} page */
export async function enterDate(page, selector, iso, formatted) {
  const native = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!(el instanceof HTMLInputElement) || el.type !== 'date') return 'no';
    if (el.disabled || el.readOnly) throw new Error('Date input is not editable.');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(iso)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (el.value !== ${JSON.stringify(iso)} || !el.checkValidity())
      throw new Error('Departure date was rejected.');
    return 'yes';
  })()`);
  if (native !== "yes") await enterText(page, selector, formatted);
}

/** @param {import("@browserless.io/bap-ts").Page} page */
export async function enterAirport(page, selector, code, option) {
  const value = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!(el instanceof HTMLSelectElement)) return null;
    const matches = Array.from(el.options).filter(o =>
      o.value.toUpperCase() === ${JSON.stringify(code)} ||
      new RegExp('\\\\b' + ${JSON.stringify(code)} + '\\\\b').test(o.text));
    if (matches.length !== 1) throw new Error('Airport select option missing or ambiguous.');
    return matches[0].value;
  })()`);
  if (value !== null) {
    await page.select(selector, value);
    return;
  }
  await enterText(page, selector, code);
  if (option) {
    await page.click(option, { visible: true });
    return;
  }
  const optionExpression = `(() => {
    const matches = Array.from(document.querySelectorAll('[role="option"], .ui-menu-item, .tt-suggestion'))
      .filter(el => el.getBoundingClientRect().height > 0 &&
        new RegExp('\\\\b' + ${JSON.stringify(code)} + '\\\\b').test(el.textContent || ''));
    if (matches.length !== 1) return false;
    matches[0].setAttribute('data-porter-airport-option', 'selected');
    return true;
  })()`;
  const needsOption = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return el?.getAttribute('role') === 'combobox' || el?.hasAttribute('aria-autocomplete')
      || el?.classList.contains('ui-autocomplete-input') ? 'yes' : 'no';
  })()`);
  if (needsOption === "yes") {
    await page.waitForFunction(`() => ${optionExpression}`);
    await page.click('[data-porter-airport-option="selected"]', {
      visible: true,
    });
    await page.evaluate(
      `document.querySelector('[data-porter-airport-option]')?.removeAttribute('data-porter-airport-option')`,
    );
  }
}
