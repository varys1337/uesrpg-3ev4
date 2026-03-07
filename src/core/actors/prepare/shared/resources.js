/**
 * Shared deterministic resource + AE application helpers.
 * These helpers keep legacy lane semantics unchanged.
 */

const asNumber = (v) => Number(v ?? 0);

function valueAllowsOvercap(valueLane) {
  return (valueLane?.override != null) || (Number(valueLane?.add ?? 0) !== 0);
}

export function applyHpResourceWithAEs(actorSystemData, hpAE) {
  const base = (hpAE.base.override != null)
    ? asNumber(hpAE.base.override)
    : (asNumber(actorSystemData.hp.base) + asNumber(hpAE.base.add));
  const bonus = (hpAE.bonus.override != null)
    ? asNumber(hpAE.bonus.override)
    : (asNumber(actorSystemData.hp.bonus) + asNumber(hpAE.bonus.add));

  actorSystemData.hp.base = base;
  actorSystemData.hp.bonus = bonus;

  const computedMax = asNumber(base) + asNumber(bonus);
  actorSystemData.hp.max = (hpAE.max.override != null)
    ? asNumber(hpAE.max.override)
    : (computedMax + asNumber(hpAE.max.add));

  if (hpAE.value.override != null) actorSystemData.hp.value = asNumber(hpAE.value.override);
  else if (hpAE.value.add) actorSystemData.hp.value = asNumber(actorSystemData.hp.value) + asNumber(hpAE.value.add);

  const allowOvercap = valueAllowsOvercap(hpAE.value);
  if (allowOvercap) actorSystemData.hp.value = Math.max(0, asNumber(actorSystemData.hp.value));
  else actorSystemData.hp.value = Math.clamp(asNumber(actorSystemData.hp.value), 0, asNumber(actorSystemData.hp.max));
}

export function applyMagickaResourceWithAEs(actorSystemData, mAE) {
  const bonus = (mAE.bonus.override != null)
    ? asNumber(mAE.bonus.override)
    : (asNumber(actorSystemData.magicka.bonus) + asNumber(mAE.bonus.add));
  actorSystemData.magicka.bonus = bonus;

  const computedMax = asNumber(actorSystemData.magicka.max) + asNumber(mAE.base.add);
  const withAdd = computedMax + asNumber(mAE.max.add);
  actorSystemData.magicka.max = (mAE.max.override != null) ? asNumber(mAE.max.override) : withAdd;

  if (mAE.value.override != null) actorSystemData.magicka.value = asNumber(mAE.value.override);
  else if (mAE.value.add) actorSystemData.magicka.value = asNumber(actorSystemData.magicka.value) + asNumber(mAE.value.add);

  const allowOvercap = valueAllowsOvercap(mAE.value);
  if (allowOvercap) actorSystemData.magicka.value = Math.max(0, asNumber(actorSystemData.magicka.value));
  else actorSystemData.magicka.value = Math.clamp(asNumber(actorSystemData.magicka.value), 0, asNumber(actorSystemData.magicka.max));
}

export function applyStaminaResourceWithAEs(actorSystemData, sAE) {
  const bonus = (sAE.bonus.override != null)
    ? asNumber(sAE.bonus.override)
    : (asNumber(actorSystemData.stamina.bonus) + asNumber(sAE.bonus.add));
  actorSystemData.stamina.bonus = bonus;

  const computedMax = asNumber(actorSystemData.stamina.max) + asNumber(sAE.base.add);
  const withAdd = computedMax + asNumber(sAE.max.add);
  actorSystemData.stamina.max = (sAE.max.override != null) ? asNumber(sAE.max.override) : withAdd;

  if (sAE.value.override != null) actorSystemData.stamina.value = asNumber(sAE.value.override);
  else if (sAE.value.add) actorSystemData.stamina.value = asNumber(actorSystemData.stamina.value) + asNumber(sAE.value.add);

  const allowOvercap = valueAllowsOvercap(sAE.value);
  if (allowOvercap) actorSystemData.stamina.value = Math.max(0, asNumber(actorSystemData.stamina.value));
  else actorSystemData.stamina.value = Math.clamp(asNumber(actorSystemData.stamina.value), 0, asNumber(actorSystemData.stamina.max));
  return { allowOvercap };
}

export function applyLuckResourceWithAEs(actorSystemData, lAE) {
  const bonus = (lAE.bonus.override != null)
    ? asNumber(lAE.bonus.override)
    : (asNumber(actorSystemData.luck_points.bonus) + asNumber(lAE.bonus.add));
  actorSystemData.luck_points.bonus = bonus;

  const computedMax = asNumber(actorSystemData.luck_points.max) + asNumber(lAE.base.add);
  const withAdd = computedMax + asNumber(lAE.max.add);
  actorSystemData.luck_points.max = (lAE.max.override != null) ? asNumber(lAE.max.override) : withAdd;

  if (lAE.value.override != null) actorSystemData.luck_points.value = asNumber(lAE.value.override);
  else if (lAE.value.add) actorSystemData.luck_points.value = asNumber(actorSystemData.luck_points.value) + asNumber(lAE.value.add);

  const allowOvercap = valueAllowsOvercap(lAE.value);
  if (allowOvercap) actorSystemData.luck_points.value = Math.max(0, asNumber(actorSystemData.luck_points.value));
  else actorSystemData.luck_points.value = Math.clamp(asNumber(actorSystemData.luck_points.value), 0, asNumber(actorSystemData.luck_points.max));
}

export function isResourceValueOvercapAllowed(valueLane) {
  return valueAllowsOvercap(valueLane);
}
