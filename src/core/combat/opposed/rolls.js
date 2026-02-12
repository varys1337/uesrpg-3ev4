/**
 * src/core/combat/opposed/rolls.js
 * Roll execution and validation extracted from opposed-workflow.js monolith
 */

import { isDebugEnabled } from "../../../utils/debug.js";

/**
 * Normalize a user/system-provided dice expression into something safe for Foundry's Roll parser.
 * @param {string} expr - Dice expression to normalize
 * @returns {string} Normalized expression
 */
export function normalizeDiceExpression(expr) {
  const raw = String(expr ?? "").trim();
  if (!raw) return "0";

  // Legacy annotation / import artefact
  if (/uses\s+nat\.?\s*weapon/i.test(raw)) return "0";

  // Handle alternate damage formats like: "1d8 (1d10)" -> prefer the base
  const paren = raw.match(/^(.+?)\s*\((.+?)\)\s*$/);
  const base = paren ? String(paren[1]).trim() : raw;

  // Normalize unicode minus/en-dash to ASCII hyphen
  const ascii = base.replace(/[\u2012\u2013\u2014\u2212]/g, "-");

  // Remove non-roll characters, keep basic math, dice letters, parentheses and whitespace
  let cleaned = ascii.replace(/[^0-9dDkKfFhHlL+\-*/().,\s@]/g, " ").trim();

  // Normalize decimal comma to dot (common in some locales)
  cleaned = cleaned.replace(/(\d),(\d)/g, "$1.$2");

  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Strip trailing operators or punctuation
  cleaned = cleaned.replace(/[+\-*/.,\s]+$/g, "").trim();

  // Strip leading operators
  cleaned = cleaned.replace(/^[+\-*/.,\s]+/g, "").trim();

  return cleaned || "0";
}

/**
 * Safely evaluate a roll formula with normalization and fallback
 * @param {string} formula - Formula to evaluate
 * @param {Object} opts - Options
 * @returns {Promise<Roll>} Evaluated Roll instance
 */
export async function safeEvaluateRoll(formula, { allowUnvalidated = false } = {}) {
  const f = normalizeDiceExpression(formula);
  if (isDebugEnabled("opposedDebugFormula") && String(formula ?? "").trim() !== f) {
    // eslint-disable-next-line no-console
    console.log("UESRPG Opposed | Formula normalized", { original: String(formula ?? ""), normalized: f });
  }
  const ok = (typeof Roll?.validate === "function") ? Roll.validate(f) : true;
  if (!ok && !allowUnvalidated) {
    console.warn(`UESRPG Opposed | Invalid roll formula "${String(formula)}" -> normalized "${f}". Falling back to 0.`);
    const r = new Roll("0");
    await r.evaluate();
    return r;
  }
  try {
    const r = new Roll(f);
    await r.evaluate();
    return r;
  } catch (err) {
    console.warn(`UESRPG Opposed | Failed to evaluate roll "${String(formula)}" -> normalized "${f}". Falling back to 0.`, err);
    const r = new Roll("0");
    await r.evaluate();
    return r;
  }
}
