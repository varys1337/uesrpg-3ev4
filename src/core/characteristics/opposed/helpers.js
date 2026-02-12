/**
 * src/core/characteristics/opposed/helpers.js
 * Outcome resolution for characteristic opposed tests
 */

import { resolveOpposed } from "../../../utils/degree-roll-helper.js";

/**
 * Resolve the outcome of a characteristic opposed test.
 * @param {object} data - The card state
 * @returns {object|null} { winner, reason, text }
 */
export function _resolveOutcome(data) {
  if (!data?.attacker?.result || !data?.defender?.result) return null;
  const out = resolveOpposed(data.attacker.result, data.defender.result);
  const aName = data.attacker.name ?? "Attacker";
  const dName = data.defender.name ?? "Defender";
  const aChar = String(data.attacker.charKey ?? "").toUpperCase();
  const dChar = String(data.defender.charKey ?? "").toUpperCase();
  const text = out.winner === "attacker"
    ? `${aName} wins — ${aChar} beats ${dChar}.`
    : (out.winner === "defender"
      ? `${dName} wins — ${dChar} beats ${aChar}.`
      : `Tie — no one gains advantage.`);
  return { ...out, text };
}

/**
 * Compute the target number for a characteristic test.
 * @param {Actor} actor
 * @param {string} charKey - Characteristic key (e.g. "wp")
 * @param {number} [manualMod=0]
 * @param {number} [ssModifier=0] - Spell Strength modifier applied to target's TN
 * @returns {{ finalTN: number, baseTN: number, breakdown: Array<{label: string, value: number}> }}
 */
export function computeCharacteristicTN(actor, charKey, manualMod = 0, ssModifier = 0) {
  const chars = actor?.system?.characteristics ?? {};
  const charData = chars[charKey];
  const baseTN = Number(charData?.total ?? charData?.value ?? 0);

  const breakdown = [
    { label: `${String(charKey).toUpperCase()} Base`, value: baseTN }
  ];

  let finalTN = baseTN;

  if (manualMod) {
    finalTN += manualMod;
    breakdown.push({ label: "Manual Modifier", value: manualMod });
  }

  if (ssModifier) {
    finalTN += ssModifier;
    breakdown.push({ label: "Spell Strength Modifier", value: ssModifier });
  }

  return { finalTN: Math.max(0, finalTN), baseTN, breakdown };
}
