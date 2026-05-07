import { SYSTEM_ROLL_FORMULA } from "../../core/constants.js";
import { isNPC, resolveCriticalFlags } from "../../core/rules/npc-rules.js";
import { getNpcThreatDegreeModifier } from "../../core/rules/npc-threat-templates.js";

function applyThreatDegreeModifier(actor, isSuccess, degree, meta) {
  if (!isSuccess) return degree;
  const threatTemplateDegreeMod = getNpcThreatDegreeModifier(actor);
  if (threatTemplateDegreeMod !== 0 && meta) meta.threatTemplateDegreeMod = threatTemplateDegreeMod;
  return Math.max(1, degree + threatTemplateDegreeMod);
}

/**
 * Core DoS/DoF helper logic with minimal dependencies.
 */
export async function doTestRoll(actor, { rollFormula = SYSTEM_ROLL_FORMULA, target = 0, allowLucky = true, allowUnlucky = true } = {}) {
  const roll = await new Roll(rollFormula).evaluate();
  const total = Number(roll.total);

  const actorIsNPC = isNPC(actor);
  const crit = resolveCriticalFlags(actor, total, { allowLucky, allowUnlucky });
  const isCriticalSuccess = crit.isCriticalSuccess;
  const isCriticalFailure = crit.isCriticalFailure;

  const tn = Number(target || 0);
  let isSuccess = (total <= tn);
  if (isCriticalSuccess) isSuccess = true;
  if (isCriticalFailure) isSuccess = false;

  let degree = 0;
  if (isSuccess) {
    const baseDos = Math.max(1, Math.floor(total / 10));
    let tnTensBonus = 0;
    if (tn > 100) {
      tnTensBonus = Math.floor((tn % 100) / 10);
    }
    degree = baseDos + tnTensBonus;
  } else {
    const diff = Math.max(0, total - tn);
    degree = 1 + Math.floor(diff / 10);
  }

  const meta = {
    actorId: actor?.id,
    actorName: actor?.name,
    actorIsNPC
  };
  degree = applyThreatDegreeModifier(actor, isSuccess, degree, meta);

  return {
    roll,
    rollTotal: total,
    target: tn,
    isSuccess,
    isCriticalSuccess,
    isCriticalFailure,
    degree,
    textual: isSuccess ? `${degree} DoS` : `${degree} DoF`,
    meta
  };
}

/**
 * Compute a deterministic DoS/DoF result from an already-known d100 total.
 */
export function computeResultFromRollTotal(actor, { rollTotal = 0, target = 0, allowLucky = true, allowUnlucky = true } = {}) {
  const total = Number(rollTotal);
  const tn = Number(target || 0);

  const actorIsNPC = isNPC(actor);
  const crit = resolveCriticalFlags(actor, total, { allowLucky, allowUnlucky });
  const isCriticalSuccess = crit.isCriticalSuccess;
  const isCriticalFailure = crit.isCriticalFailure;

  let isSuccess = (total <= tn);
  if (isCriticalSuccess) isSuccess = true;
  if (isCriticalFailure) isSuccess = false;

  let degree = 0;
  if (isSuccess) {
    const baseDos = Math.max(1, Math.floor(total / 10));
    let tnTensBonus = 0;
    if (tn > 100) tnTensBonus = Math.floor((tn % 100) / 10);
    degree = baseDos + tnTensBonus;
  } else {
    const diff = Math.max(0, total - tn);
    degree = 1 + Math.floor(diff / 10);
  }

  const meta = {
    actorId: actor?.id,
    actorName: actor?.name,
    actorIsNPC
  };
  degree = applyThreatDegreeModifier(actor, isSuccess, degree, meta);

  return {
    roll: null,
    rollTotal: total,
    target: tn,
    isSuccess,
    isCriticalSuccess,
    isCriticalFailure,
    degree,
    textual: isSuccess ? `${degree} DoS` : `${degree} DoF`,
    meta
  };
}

/**
 * Format a DoS/DoF string consistently across the system.
 */
export function formatDegree(result) {
  if (!result) return "-";
  return result.isSuccess ? `${result.degree} DoS` : `${result.degree} DoF`;
}

/**
 * Format the visible outcome label for a result, preferring critical flags.
 *
 * @param {object} result
 * @param {object} [options]
 * @param {boolean} [options.uppercase]
 * @returns {string}
 */
export function formatResultOutcomeLabel(result, { uppercase = false } = {}) {
  if (!result) return uppercase ? "UNKNOWN" : "Unknown";

  let label = "Failure";
  if (result.isCriticalSuccess === true) label = "Critical Success";
  else if (result.isCriticalFailure === true) label = "Critical Failure";
  else if (result.isSuccess === true) label = "Success";

  return uppercase ? label.toUpperCase() : label;
}

/**
 * Format an outcome label with optional DoS/DoF text.
 *
 * @param {object} result
 * @param {object} [options]
 * @param {boolean} [options.uppercase]
 * @param {boolean} [options.includeDegree]
 * @param {"paren"|"dash"} [options.degreeStyle]
 * @returns {string}
 */
export function formatResultSummary(result, { uppercase = false, includeDegree = true, degreeStyle = "paren" } = {}) {
  const label = formatResultOutcomeLabel(result, { uppercase });
  if (!includeDegree || !result) return label;

  const degreeText = formatDegree(result);
  if (!degreeText || degreeText === "-") return label;

  if (degreeStyle === "dash") return `${label} — ${degreeText}`;
  return `${label} (${degreeText})`;
}

/**
 * Resolve an opposed test between attacker and defender results.
 */
export function resolveOpposed(aResult, dResult) {
  if (!aResult || !dResult) {
    return { winner: "tie", reason: "unresolved (missing result)" };
  }

  const A = aResult;
  const D = dResult;

  const aIsCritSuccess = Boolean(A.isCriticalSuccess ?? false);
  const dIsCritSuccess = Boolean(D.isCriticalSuccess ?? false);
  const aIsCritFailure = Boolean(A.isCriticalFailure ?? false);
  const dIsCritFailure = Boolean(D.isCriticalFailure ?? false);

  if (aIsCritSuccess && !dIsCritSuccess) return { winner: "attacker", reason: "attacker critical success" };
  if (dIsCritSuccess && !aIsCritSuccess) return { winner: "defender", reason: "defender critical success" };
  if (aIsCritSuccess && dIsCritSuccess) return { winner: "tie", reason: "both critical success (roll-off required)" };

  if (aIsCritFailure && !dIsCritFailure) return { winner: "defender", reason: "attacker critical failure" };
  if (dIsCritFailure && !aIsCritFailure) return { winner: "attacker", reason: "defender critical failure" };
  if (aIsCritFailure && dIsCritFailure) return { winner: "tie", reason: "both critical failure" };

  const aIsSuccess = Boolean(A.isSuccess ?? false);
  const dIsSuccess = Boolean(D.isSuccess ?? false);

  if (aIsSuccess && !dIsSuccess) return { winner: "attacker", reason: "attacker success" };
  if (dIsSuccess && !aIsSuccess) return { winner: "defender", reason: "defender success" };

  if (aIsSuccess && dIsSuccess) {
    const aDegree = Number(A.degree ?? 0);
    const dDegree = Number(D.degree ?? 0);
    if (aDegree > dDegree) return { winner: "attacker", reason: `attacker higher DoS (${aDegree} vs ${dDegree})` };
    if (dDegree > aDegree) return { winner: "defender", reason: `defender higher DoS (${dDegree} vs ${aDegree})` };
    return { winner: "tie", reason: "equal DoS" };
  }

  if (!aIsSuccess && !dIsSuccess) {
    const aDegree = Number(A.degree ?? 0);
    const dDegree = Number(D.degree ?? 0);
    if (aDegree < dDegree) return { winner: "attacker", reason: `attacker lower DoF (${aDegree} vs ${dDegree})` };
    if (dDegree < aDegree) return { winner: "defender", reason: `defender lower DoF (${dDegree} vs ${aDegree})` };
    return { winner: "tie", reason: "equal DoF" };
  }

  return { winner: "tie", reason: "unresolved" };
}
