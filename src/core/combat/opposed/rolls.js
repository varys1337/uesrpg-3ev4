import { normalizeDiceExpression } from '../../documents/item-utils.js';
export { normalizeDiceExpression };
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


/**
 * Safely evaluate a roll formula with normalization and fallback
 * @param {string} formula - Formula to evaluate
 * @param {Object} opts - Options
 * @returns {Promise<Roll>} Evaluated Roll instance
 */
export async function safeEvaluateRoll(formula, { allowUnvalidated = false } = {}) {
  const f = normalizeDiceExpression(formula);
  if (isDebugEnabled("opposedDebugFormula") && String(formula ?? "").trim() !== f) {
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
