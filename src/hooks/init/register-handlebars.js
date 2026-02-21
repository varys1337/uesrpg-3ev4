/**
 * Register Handlebars helpers used by the system.
 */
export function registerHandlebarsHelpers() {
  // Greater than or equal helper for attack counter styling
  Handlebars.registerHelper("gte", function (a, b) {
    return a >= b;
  });

  // Equality helper for template comparisons
  Handlebars.registerHelper("eq", function (a, b) {
    return a === b;
  });

  // Logical OR — used in alchemy/enchanting templates.
  // Handlebars sub-expressions only support one return value, so OR needs explicit registration.
  Handlebars.registerHelper("or", function (...args) {
    // Last argument is the Handlebars options hash — drop it.
    const values = args.slice(0, -1);
    return values.some(Boolean);
  });

  // Numeric comparison helpers.
  Handlebars.registerHelper("lt", function (a, b) { return Number(a) < Number(b); });
  Handlebars.registerHelper("gt", function (a, b) { return Number(a) > Number(b); });

  Handlebars.registerHelper("includes", function (arr, value) {
    return Array.isArray(arr) ? arr.includes(value) : false;
  });

  Handlebars.registerHelper("json", function (value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch (_e) {
      return "";
    }
  });
}
