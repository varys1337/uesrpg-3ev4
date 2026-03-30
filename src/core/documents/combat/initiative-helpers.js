export function numericOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getLuckBonus(actor) {
  if (!actor) return 0;
  const rawBonus = actor?.system?.characteristics?.lck?.bonus;
  const fromBonus = Number(rawBonus);
  if (rawBonus !== undefined && rawBonus !== null && Number.isFinite(fromBonus)) return fromBonus;
  if (String(actor?.type ?? "").toLowerCase() === "npc") return 0;
  return Math.floor(numericOr(actor?.system?.characteristics?.lck?.total, 0) / 10);
}

export function getPcPrecedence(actor) {
  return String(actor?.type ?? "") === "Player Character" ? 1 : 0;
}

export function getCombatSensesInitiativeRating(actor) {
  const prcBonus = Number(actor?.system?.characteristics?.prc?.bonus ?? 0) || 0;
  return (2 * prcBonus) + 2;
}

export function getInitiativeTieBreakTuple(combatant, initiativeValue = combatant?.initiative) {
  const actor = combatant?.actor ?? null;
  const initiativeTotal = numericOr(initiativeValue, Number.NEGATIVE_INFINITY);
  const initiativeRating = numericOr(actor?.system?.initiative?.value, 0);
  const luckBonus = getLuckBonus(actor);
  const pcPrecedence = getPcPrecedence(actor);
  const stableId = String(combatant?.id ?? combatant?._id ?? "");
  return [initiativeTotal, initiativeRating, luckBonus, pcPrecedence, stableId];
}

export function compareInitiativeTuples(a, b) {
  if (a[0] !== b[0]) return b[0] - a[0];
  if (a[1] !== b[1]) return b[1] - a[1];
  if (a[2] !== b[2]) return b[2] - a[2];
  if (a[3] !== b[3]) return b[3] - a[3];
  return String(a[4]).localeCompare(String(b[4]), undefined, { numeric: true, sensitivity: "base" });
}

export function compareProjectedInitiativeEntries(a, b) {
  return compareInitiativeTuples(a?.tuple ?? [], b?.tuple ?? []);
}
