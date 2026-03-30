const VALID_REPLACEMENT_CHARACTERISTICS = new Set(["str", "end", "agi", "int", "wp", "prc", "prs", "lck"]);

function _chaCalc(actorContext, actorData, key) {
  return Math.floor(Number(actorContext._getCharacteristicTotal(actorData, key) ?? 0) / 10) * 3;
}

export function calculateSpeed(actorContext, actorData) {
  const ctx = actorContext._getPrepareCtx();
  let speed = Number(actorData?.system?.speed?.base ?? 0);
  if ((ctx?.halfSpeedItems?.length ?? 0) >= 1) speed = Math.ceil(speed / 2);

  let ignoreArmorSpeedPenalty = false;
  try { ignoreArmorSpeedPenalty = actorContext._hasTalentCached("wallofsteel"); } catch (_e) { ignoreArmorSpeedPenalty = false; }
  if (!ignoreArmorSpeedPenalty && ctx?.hasEquippedTowerShield) speed = Math.max(0, speed - 1);
  return speed;
}

export function calculateInitiative(actorContext, actorData) {
  const attribute = actorContext._getPrepareCtx()?.traitsAndTalents ?? [];
  let init = Number(actorData?.system?.initiative?.base ?? 0);

  const reIniChar = actorData?.system?._reOverrides?.["system.initiative.replaceCharacteristic"] ?? null;
  if (reIniChar && reIniChar !== "none") {
    const ch = String(reIniChar).toLowerCase();
    if (VALID_REPLACEMENT_CHARACTERISTICS.has(ch)) return _chaCalc(actorContext, actorData, ch);
  }

  for (const item of attribute) {
    const ch = String(item?.system?.replace?.ini?.characteristic ?? "none").toLowerCase();
    if (VALID_REPLACEMENT_CHARACTERISTICS.has(ch)) init = _chaCalc(actorContext, actorData, ch);
  }
  return init;
}

export function calculateWoundThreshold(actorContext, actorData) {
  const attribute = actorContext._getPrepareCtx()?.traitsAndTalents ?? [];
  let wound = Number(actorData?.system?.wound_threshold?.base ?? 0);

  const reWtChar = actorData?.system?._reOverrides?.["system.wound_threshold.replaceCharacteristic"] ?? null;
  if (reWtChar && reWtChar !== "none") {
    const ch = String(reWtChar).toLowerCase();
    if (VALID_REPLACEMENT_CHARACTERISTICS.has(ch)) return _chaCalc(actorContext, actorData, ch);
  }

  for (const item of attribute) {
    const ch = String(item?.system?.replace?.wt?.characteristic ?? "none").toLowerCase();
    if (VALID_REPLACEMENT_CHARACTERISTICS.has(ch)) wound = _chaCalc(actorContext, actorData, ch);
  }
  return wound;
}

export function calculateFatiguePenalty(actorContext, actorData) {
  const level = Number(actorData?.system?.fatigue?.level || 0);
  let hasEnduring = false;
  try { hasEnduring = actorContext._hasTalentCached("enduring"); } catch (_e) { hasEnduring = false; }
  const reHalfFatigue = Boolean(actorData?.system?._reFlags?.halfFatiguePenalty);
  const halved = (actorContext._getPrepareCtx()?.halfFatiguePenaltyItems?.length ?? 0) >= 1 || hasEnduring || reHalfFatigue;
  return level * (halved ? -5 : -10);
}

export function hasHalfWoundPenalty(actorContext, actorData) {
  let hasUnstoppable = false;
  try { hasUnstoppable = actorContext._hasTalentCached("unstoppable"); } catch (_e) { hasUnstoppable = false; }
  const reHalfWound = Boolean(actorData?.system?._reFlags?.halfWoundPenalty);
  return Boolean(actorContext._getPrepareCtx()?.hasHalfWoundPenaltyItem) || hasUnstoppable || reHalfWound;
}

export function determineIbToMp(actorContext, actorData) {
  const actorIntBonus = Number(actorData?.system?.characteristics?.int?.bonus || 0);
  let total = 0;

  for (const item of actorContext._getPrepareCtx()?.addIbToMpItems ?? []) {
    total += actorIntBonus * Number(item?.system?.addIntToMPMultiplier || 0);
  }

  try {
    if (actorContext._hasTalentCached("depthofunderstanding")) total += actorIntBonus * 5;
  } catch (_e) {}

  return total;
}

export function calculateAddedHalfSpeed(actorContext, actorData) {
  const ctx = actorContext._getPrepareCtx();
  const hasHalfSpeedItem = (ctx?.addHalfSpeedItems?.length ?? 0) > 0;
  const isWereCroc = (ctx?.wereCrocodileFormItems?.length ?? 0) > 0;

  if (isWereCroc && hasHalfSpeedItem) return Number(actorData?.system?.speed?.base || 0);
  if (!isWereCroc && hasHalfSpeedItem) {
    return Math.ceil(Number(actorData?.system?.speed?.value || 0) / 2) + Number(actorData?.system?.speed?.base || 0);
  }
  if (isWereCroc && !hasHalfSpeedItem) return Math.ceil(Number(actorData?.system?.speed?.base || 0) / 2);
  return Number(actorData?.system?.speed?.value || 0);
}
