/**
 * @module magic/effects/spell-effect-metadata
 *
 * Shared metadata builder for spell-generated Active Effects.
 *
 * Tier 1 = normalized spell/cast context fields that later automation can
 * safely consume without re-deriving from chat cards or transient workflow state.
 *
 * Tier 2 = source-channel metadata for enchantment / stored-spell casts so
 * automation can distinguish actor-magicka casts from item-backed casts.
 */

import { buildMagicCastContext } from "../opposed/cast-context.js";
import { normalizeCastSourceCostMode, resolveItemContextFromCastSource } from "../opposed/cast-source.js";
import { getSpellCost, getSpellLevel } from "../magicka-utils.js";

function _str(value) {
  return String(value ?? "").trim();
}

function _num(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return fallback;
}

function _numericOrNull(value) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  if (n === Infinity) return Infinity;
  return null;
}

function _positiveInt(value, fallback = null) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return fallback;
}

function _clone(value) {
  if (value == null) return null;
  try {
    return foundry.utils.deepClone(value);
  } catch (_err) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_err2) {
      return value;
    }
  }
}

function _normalizeTargetUuids(targetUuids = []) {
  if (!Array.isArray(targetUuids)) return [];
  return targetUuids.map(u => _str(u)).filter(Boolean);
}

function _normalizeMagickaSpend(magickaSpend, fallbackConsumed = 0) {
  if (!magickaSpend || typeof magickaSpend !== "object") return null;
  return {
    consumed: _num(magickaSpend.consumed, fallbackConsumed),
    remaining: _num(magickaSpend.remaining, 0),
    refund: _num(magickaSpend.refund, 0),
    source: _str(magickaSpend.source) || null
  };
}

function _normalizeCastContext(castContext, spellLevel) {
  const baseLevel = _positiveInt(castContext?.baseLevel, spellLevel) ?? spellLevel;
  const castLevel = _positiveInt(castContext?.castLevel, baseLevel) ?? baseLevel;
  const spellStrengthValue = _positiveInt(castContext?.spellStrengthValue, null);
  return {
    baseLevel,
    castLevel,
    hasHigherCastLevel: Boolean(castContext?.hasHigherCastLevel ?? (castLevel > baseLevel)),
    spellStrengthValue
  };
}

export function buildUpkeepGroupKey({ casterUuid, casterTokenUuid, spellUuid, originalCastWorldTime }) {
  const cUuid = _str(casterUuid);
  const tUuid = _str(casterTokenUuid);
  const sUuid = _str(spellUuid);
  const castTime = _num(originalCastWorldTime, Number.NaN);
  if (!cUuid || !sUuid || !Number.isFinite(castTime)) return "";
  return `${cUuid}::${tUuid || "-"}::${sUuid}::${Math.floor(castTime)}`;
}

export function parseUpkeepGroupKey(groupKey) {
  const parts = _str(groupKey).split("::");
  const legacy = parts.length < 4;
  return {
    casterUuid: parts[0] || "",
    casterTokenUuid: legacy ? "" : (parts[1] === "-" ? "" : (parts[1] || "")),
    spellUuid: legacy ? (parts[1] || "") : (parts[2] || ""),
    originalCastWorldTime: _num(legacy ? parts[2] : parts[3], 0)
  };
}

function _buildCastSourceMetadata(castSource = null, itemCastContext = null) {
  const sourceType = _str(castSource?.type).toLowerCase() || "spell";
  if (sourceType !== "enchantment") {
    return {
      castSourceType: sourceType,
      castSourceCostMode: sourceType === "spell" ? "magicka" : null,
      resourceMode: sourceType === "spell" ? "magicka" : null,
      resourceSource: sourceType === "spell" ? "actorMagicka" : null,
      isEnchantmentCast: false,
      enchantmentId: null,
      enchantmentItemUuid: null,
      enchantmentSourceLane: null,
      enchantmentSlotId: null
    };
  }

  const itemCtx = resolveItemContextFromCastSource(castSource, itemCastContext);
  const itemUuid = _str(itemCastContext?.itemUuid ?? castSource?.itemUuid ?? itemCtx?.item?.uuid) || null;
  const sourceLane = _str(itemCastContext?.sourceLane ?? castSource?.sourceLane ?? itemCtx?.sourceLane ?? "workshop").toLowerCase() || null;
  const slotId = _str(itemCastContext?.slotId ?? castSource?.spellSlotId ?? castSource?.enchantSpellSlotId ?? itemCtx?.slotId) || null;
  const costMode = normalizeCastSourceCostMode(castSource);
  const enchantmentId = itemUuid && slotId ? `${itemUuid}::${sourceLane ?? "workshop"}::${slotId}` : null;

  return {
    castSourceType: sourceType,
    castSourceCostMode: costMode,
    resourceMode: costMode,
    resourceSource: costMode === "soul"
      ? "enchantmentSoulPool"
      : costMode === "magicka"
        ? "actorMagicka"
        : "none",
    isEnchantmentCast: true,
    enchantmentId,
    enchantmentItemUuid: itemUuid,
    enchantmentSourceLane: sourceLane,
    enchantmentSlotId: slotId
  };
}

/**
 * Build normalized spell-effect metadata flags.
 *
 * @param {object} params
 * @param {Actor|null} params.casterActor
 * @param {Item|null} params.spell
 * @param {object|null} [params.castContext]
 * @param {object|null} [params.spellOptions]
 * @param {object|null} [params.scalingChoices]
 * @param {object|null} [params.castSource]
 * @param {object|null} [params.itemCastContext]
 * @param {object|null} [params.magickaSpend]
 * @param {object|null} [params.durationData]
 * @param {string|null} [params.casterTokenUuid]
 * @param {string[]|null} [params.targetUuids]
 * @param {number|null} [params.actualCost]
 * @param {number|null} [params.costPaid]
 * @param {number|null} [params.originalCastWorldTime]
 * @param {number|null} [params.castWorldTime]
 * @returns {object}
 */
export function buildSpellEffectMetadataFlags({
  casterActor = null,
  spell = null,
  castContext = null,
  spellOptions = null,
  scalingChoices = null,
  castSource = null,
  itemCastContext = null,
  magickaSpend = null,
  durationData = null,
  casterTokenUuid = null,
  targetUuids = null,
  actualCost = null,
  costPaid = null,
  originalCastWorldTime = null,
  castWorldTime = null
} = {}) {
  const spellLevel = _positiveInt(getSpellLevel(spell), 1) ?? 1;
  const clonedSpellOptions = _clone(spellOptions);
  const clonedScalingChoices = _clone(scalingChoices);

  const derivedCastContext = castContext && typeof castContext === "object"
    ? _normalizeCastContext(castContext, spellLevel)
    : buildMagicCastContext(
      {
        spellLevel,
        actorUuid: _str(casterActor?.uuid),
        spellOptions: clonedSpellOptions ?? null,
        scalingChoices: clonedScalingChoices ?? null
      },
      spell,
      { actor: casterActor }
    );

  const normalizedCastContext = _normalizeCastContext(derivedCastContext, spellLevel);
  const resolvedActualCost = _num(actualCost ?? costPaid ?? getSpellCost(spell, normalizedCastContext.castLevel) ?? spell?.system?.cost ?? 0, 0);
  const resolvedOriginalCastWorldTime = _num(originalCastWorldTime ?? castWorldTime ?? game?.time?.worldTime ?? 0, 0);
  const resolvedDurationSeconds = _numericOrNull(durationData?.seconds);
  const resolvedDurationRounds = _numericOrNull(durationData?.rounds);
  const resolvedDurationStartTime = _numericOrNull(durationData?.startTime);
  const resolvedDurationStartRound = _numericOrNull(durationData?.startRound);
  const resolvedDurationStartTurn = _numericOrNull(durationData?.startTurn);
  const resolvedTargetUuids = _normalizeTargetUuids(targetUuids);
  const castSourceMeta = _buildCastSourceMetadata(castSource, itemCastContext);

  return {
    spellEffectMetadataVersion: 1,
    spellEffectMetadataTier: 2,
    spellUuid: _str(spell?.uuid),
    spellName: _str(spell?.name),
    spellSchool: _str(spell?.system?.school),
    spellLevel,
    baseLevel: normalizedCastContext.baseLevel,
    castLevel: normalizedCastContext.castLevel,
    hasHigherCastLevel: normalizedCastContext.hasHigherCastLevel,
    spellStrengthValue: normalizedCastContext.spellStrengthValue,
    casterUuid: _str(casterActor?.uuid),
    casterTokenUuid: _str(casterTokenUuid) || null,
    actualCost: resolvedActualCost,
    costPaid: _num(costPaid, resolvedActualCost),
    originalCastWorldTime: resolvedOriginalCastWorldTime,
    durationSeconds: resolvedDurationSeconds,
    durationRounds: resolvedDurationRounds,
    durationStartTime: resolvedDurationStartTime,
    durationStartRound: resolvedDurationStartRound,
    durationStartTurn: resolvedDurationStartTurn,
    targetUuids: resolvedTargetUuids,
    upkeepGroupKey: buildUpkeepGroupKey({
      casterUuid: casterActor?.uuid,
      casterTokenUuid,
      spellUuid: spell?.uuid,
      originalCastWorldTime: resolvedOriginalCastWorldTime
    }),
    castContext: _clone(normalizedCastContext),
    spellOptions: clonedSpellOptions,
    scalingChoices: clonedScalingChoices,
    castSource: _clone(castSource),
    itemCastContext: _clone(itemCastContext),
    magickaSpend: _normalizeMagickaSpend(magickaSpend, resolvedActualCost),
    ...castSourceMeta
  };
}
