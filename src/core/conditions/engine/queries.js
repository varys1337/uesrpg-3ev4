import { getConditionIndex } from "./index-cache.js";
import { FLAG_SCOPE } from "../constants.js";
import { isEffectCurrentlyApplicable } from "../../active-effects/collect.js";
import {
  coreStatusAliasesForKey,
  effectHasCoreStatus,
  findCoreStatusEffect,
  getEffectsArray,
  normalizeConditionKey,
} from "./selectors.js";

export function findConditionEffect(actor, key) {
  const normalized = normalizeConditionKey(key);
  if (!normalized || !actor) return null;

  const index = getConditionIndex(actor);
  const fromFlag = index.byFlag.get(normalized);
  if (fromFlag?.length) return fromFlag[0];

  const fromCore = index.byCore.get(normalized);
  return fromCore?.[0] ?? null;
}

export function findAllConditionEffects(actor, key) {
  const normalized = normalizeConditionKey(key);
  if (!normalized || !actor) return [];

  const index = getConditionIndex(actor);
  return [
    ...(index.byFlag.get(normalized) ?? []),
    ...(index.byCore.get(normalized) ?? []),
  ];
}

function conditionNameMatches(effect, aliases) {
  const name = String(effect?.name ?? "").trim().toLowerCase();
  return aliases.some(alias => name === alias || name.startsWith(`${alias} (`) || name.startsWith(`${alias} `));
}

function fallbackHasConditionByName(actor, key) {
  const normalized = normalizeConditionKey(key);
  if (!normalized) return false;
  if (findCoreStatusEffect(actor, normalized)) return true;

  const aliases = coreStatusAliasesForKey(normalized);
  return getEffectsArray(actor).some(effect => conditionNameMatches(effect, aliases));
}

/** Check conditions on effects currently applied to this Actor, including transferred effects. */
export function hasAppliedCondition(actor, key, effects = actor?.appliedEffects ?? []) {
  const normalized = normalizeConditionKey(key);
  if (!actor || !normalized) return false;
  const aliases = coreStatusAliasesForKey(normalized);
  return effects.some(effect => {
    if (effect?.active === false || !isEffectCurrentlyApplicable(effect)) return false;
    const conditionKey = normalizeConditionKey(effect.getFlag?.(FLAG_SCOPE, "condition")?.key);
    return conditionKey === normalized || aliases.some(alias => effectHasCoreStatus(effect, alias))
      || conditionNameMatches(effect, aliases);
  });
}

export function hasCondition(actor, key) {
  const normalized = normalizeConditionKey(key);
  if (!actor || !normalized) return false;
  return Boolean(findConditionEffect(actor, normalized) || fallbackHasConditionByName(actor, normalized));
}
