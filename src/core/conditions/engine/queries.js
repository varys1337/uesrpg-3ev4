import { getConditionIndex } from "./index-cache.js";
import {
  coreStatusAliasesForKey,
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

function fallbackHasConditionByName(actor, key) {
  const normalized = normalizeConditionKey(key);
  if (!normalized) return false;
  if (findCoreStatusEffect(actor, normalized)) return true;

  const aliases = new Set(coreStatusAliasesForKey(normalized));
  return getEffectsArray(actor).some((effect) => {
    const name = String(effect?.name ?? "").trim().toLowerCase();
    for (const alias of aliases) {
      if (name === alias || name.startsWith(`${alias} (`) || name.startsWith(`${alias} `)) return true;
    }
    return false;
  });
}

export function hasCondition(actor, key) {
  const normalized = normalizeConditionKey(key);
  if (!actor || !normalized) return false;
  return Boolean(findConditionEffect(actor, normalized) || fallbackHasConditionByName(actor, normalized));
}
