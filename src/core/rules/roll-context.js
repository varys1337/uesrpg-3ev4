/**
 * src/core/rules/roll-context.js
 *
 * Standard RollContext contract used by rule-element runtime.
 */

import { buildBaseRollOptions } from "./roll-options.js";

export const ROLL_CONTEXT_VERSION = 1;

function _safeUuid(doc) {
  if (!doc) return null;
  const uuid = String(doc?.uuid ?? "").trim();
  return uuid || null;
}

function _safeSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9:_-]/g, "") || null;
}

function _cloneExtra(extra) {
  if (!(extra && typeof extra === "object")) return null;
  if (typeof foundry !== "undefined" && foundry?.utils?.deepClone) {
    return foundry.utils.deepClone(extra);
  }
  if (typeof structuredClone === "function") {
    return structuredClone(extra);
  }
  return { ...extra };
}

/**
 * Build a serializable roll context object.
 *
 * @param {object} params
 * @returns {object}
 */
export function buildRollContext({
  actor = null,
  targetToken = null,
  targetActor = null,
  item = null,
  testType = "",
  skillItem = null,
  characteristicKey = "",
  attackMode = "",
  attackVariant = "",
  defenseType = "",
  damageStage = "",
  damageType = "",
  extra = null
} = {}) {
  const resolvedTargetActor = targetActor ?? targetToken?.actor ?? null;
  const rollOptionSet = buildBaseRollOptions({
    actor,
    target: resolvedTargetActor,
    item,
    testType,
    skillItem,
    characteristicKey,
    attackMode,
    attackVariant,
    defenseType
  });

  return {
    version: ROLL_CONTEXT_VERSION,
    createdAt: Date.now(),
    actorUuid: _safeUuid(actor),
    targetUuid: _safeUuid(resolvedTargetActor),
    targetTokenUuid: _safeUuid(targetToken?.document ?? targetToken ?? null),
    itemUuid: _safeUuid(item),
    testType: _safeSlug(testType),
    skillSlug: _safeSlug(skillItem?.name ?? skillItem?.system?.skillName ?? null),
    characteristicKey: _safeSlug(characteristicKey),
    attackMode: _safeSlug(attackMode),
    attackVariant: _safeSlug(attackVariant),
    defenseType: _safeSlug(defenseType),
    damageStage: _safeSlug(damageStage),
    damageType: _safeSlug(damageType),
    rollOptions: Array.from(rollOptionSet.values()),
    extra: _cloneExtra(extra)
  };
}
