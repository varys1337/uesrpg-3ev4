/**
 * Shared TN helpers for Warfare Unit Discipline-based tests.
 */

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Build a Discipline TN object with a summed breakdown that matches the current
 * derived warfare discipline value before transient action/effect modifiers.
 *
 * @param {SimpleActor} actor
 * @param {object} [options]
 * @param {number} [options.manualModifier=0]
 * @param {boolean} [options.joinFray=false]
 * @param {Array<{label:string,value:number}>} [options.extraBreakdown=[]]
 * @returns {{baseTN:number, finalTN:number, totalMod:number, breakdown:Array<{label:string,value:number}>}}
 */
export function buildWarfareDisciplineTN(actor, {
  manualModifier = 0,
  joinFray = false,
  extraBreakdown = [],
} = {}) {
  const sys = actor?.system ?? {};
  const derived = sys._derived ?? {};
  const breakdown = [];

  const currentValue = Math.max(0, _num(sys.stats?.discipline?.value, 0));
  const baseDiscipline = _num(sys.stats?.discipline?.base, 0);
  const permanentBonus = _num(sys.stats?.discipline?.bonus, 0);
  const commanderBonus = _num(derived.commanderBonus, 0);
  const persistentEntries = Array.isArray(derived.disciplineEntries) ? derived.disciplineEntries : [];

  let running = 0;
  if (baseDiscipline) {
    breakdown.push({ label: "Base Discipline", value: baseDiscipline });
    running += baseDiscipline;
  }
  if (permanentBonus) {
    breakdown.push({ label: "Permanent Discipline Bonus", value: permanentBonus });
    running += permanentBonus;
  }
  if (commanderBonus) {
    breakdown.push({ label: "Commander Bonus", value: commanderBonus });
    running += commanderBonus;
  }
  for (const entry of persistentEntries) {
    const value = _num(entry?.value, NaN);
    if (!Number.isFinite(value) || value === 0) continue;
    breakdown.push({ label: String(entry?.label ?? "Discipline Modifier"), value });
    running += value;
  }

  const derivedAdjustment = currentValue - running;
  if (derivedAdjustment) {
    breakdown.push({ label: "Derived Adjustment", value: derivedAdjustment });
    running += derivedAdjustment;
  }

  const transient = [];
  if (joinFray) transient.push({ label: "Join the Fray", value: 10 });
  for (const entry of (extraBreakdown ?? [])) {
    const value = _num(entry?.value, NaN);
    if (!Number.isFinite(value) || value === 0) continue;
    transient.push({ label: String(entry?.label ?? "Modifier"), value });
  }
  const manual = _num(manualModifier, 0);
  if (manual) transient.push({ label: "Manual Modifier", value: manual });

  const transientTotal = transient.reduce((sum, entry) => sum + _num(entry.value, 0), 0);
  breakdown.push(...transient);

  const unclamped = currentValue + transientTotal;
  const finalTN = Math.max(0, unclamped);
  if (finalTN !== unclamped) {
    breakdown.push({ label: "Minimum TN Clamp", value: finalTN - unclamped });
  }

  return {
    baseTN: currentValue,
    finalTN,
    totalMod: finalTN - currentValue,
    breakdown,
  };
}
