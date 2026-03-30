import {
  computeEffectCost,
  computeUpkeepDuration,
  effectHasUpkeep,
  getEffectByKey,
  getEffectToxinOverrides,
} from "./effects.js";
import { ALCHEMY_DEFAULT_ICON, cloneAlchemyData } from "./shared.js";
import { computeEffectiveStrength } from "./workflow-actor.js";
import {
  actorKnowsSpellUuid,
  findActorSpellByUuid,
  getActorKnownAlchemyEffects,
  getSpellAlchemyAttributes,
  getSpellLevelOptions,
} from "./workflow-known-effects.js";
import { ALCHEMY_TOOL_RX, getActorItemsArray } from "./utils.js";
import { resolveSpellProfile } from "../magic/spell-profile.js";
import {
  getSpellDamageFormula,
  getSpellDamageType,
  isHealingSpell,
} from "../magic/magicka-utils.js";
import { classifySpellForRouting } from "../magic/spell-runtime.js";
import { spellNeedsEffectApplication } from "../magic/opposed/spell-helpers.js";

export function normalizeRecipeSlot(slot) {
  const effectSource = String(slot?.effectSource ?? (slot?.spellUuid ? "spell" : "catalog")).trim().toLowerCase() || "catalog";
  return {
    ingredientId: slot?.ingredientId ?? null,
    effectSource,
    effectKey: effectSource === "catalog" ? String(slot?.effectKey ?? "").trim() || null : null,
    spellUuid: effectSource === "spell" ? String(slot?.spellUuid ?? "").trim() || null : null,
    spellLevel: Math.max(1, Number(slot?.spellLevel ?? 1) || 1),
    params: slot?.params ?? {},
  };
}

function _slotHasSelectedEffect(slot) {
  const normalized = normalizeRecipeSlot(slot);
  if (!normalized.ingredientId) return false;
  return normalized.effectSource === "spell"
    ? Boolean(normalized.spellUuid)
    : Boolean(normalized.effectKey);
}

export function getFilledAlchemySlots(recipe) {
  return (recipe?.slots ?? []).map(normalizeRecipeSlot).filter(_slotHasSelectedEffect);
}

export function getUniquenessIdentifier(slot) {
  const normalized = normalizeRecipeSlot(slot);
  return normalized.effectSource === "spell"
    ? `spell:${normalized.spellUuid ?? ""}`
    : `catalog:${normalized.effectKey ?? ""}`;
}

export function getSlotIdentifier(slot) {
  const normalized = normalizeRecipeSlot(slot);
  return normalized.effectSource === "spell"
    ? `spell:${normalized.spellUuid ?? ""}:${normalized.spellLevel ?? 1}`
    : `catalog:${normalized.effectKey ?? ""}:${normalized.spellLevel ?? 1}`;
}

function _scaleSpellDuration(duration, multiplier) {
  if (!duration) return null;
  const unit = String(duration.unit ?? "").trim();
  if (!unit || unit === "instant" || unit === "permanent") return duration;
  return {
    value: Math.max(1, Math.floor(Number(duration.value ?? 0) * Math.max(1, multiplier))),
    unit,
  };
}

function _buildAlchemySpellSnapshot(spell, { spellLevel = 1, cost = 0, finalDuration = null } = {}) {
  if (!spell) return null;

  const snapshot = cloneAlchemyData(spell.toObject?.(false) ?? spell);
  snapshot.name = String(snapshot.name ?? spell.name ?? "Alchemy Spell");
  snapshot.type = "spell";
  snapshot.img = snapshot.img ?? spell.img ?? ALCHEMY_DEFAULT_ICON;
  snapshot.uuid = String(snapshot.uuid ?? spell.uuid ?? "").trim();
  snapshot.id = snapshot.id ?? spell.id ?? null;
  snapshot.effects = Array.isArray(snapshot.effects) ? snapshot.effects : [];
  snapshot.system = snapshot.system ?? {};
  snapshot.system.level = Math.max(1, Number(spellLevel ?? snapshot.system.level ?? 1) || 1);
  snapshot.system.cost = Math.max(0, Number(cost ?? snapshot.system.cost ?? 0) || 0);

  const formula = String(getSpellDamageFormula(spell, snapshot.system.level) ?? "").trim();
  if (formula) snapshot.system.damageFormula = formula;

  if (finalDuration) {
    snapshot.system.duration = {
      value: Math.max(0, Number(finalDuration.value ?? 0) || 0),
      unit: String(finalDuration.unit ?? "rounds"),
    };
    snapshot.system.hasUpkeep = Boolean(snapshot.system.hasUpkeep) || Boolean(finalDuration);
  }

  return snapshot;
}

export function buildDirectAlchemyPayloadForSpell(spell, {
  mode = "potion",
  spellLevel = 1,
  cost = 0,
  finalDuration = null,
} = {}) {
  if (!spell || spell.type !== "spell") {
    return { ok: false, reason: "Only spell items can be serialized into alchemy effects." };
  }

  const normalizedMode = String(mode ?? "potion").trim().toLowerCase();
  const routing = classifySpellForRouting(spell);
  const damageType = String(getSpellDamageType(spell) ?? "").trim().toLowerCase();
  const healing = Boolean(isHealingSpell(spell)) || damageType === "temporaryhealing" || damageType === "temporary healing";
  const snapshot = _buildAlchemySpellSnapshot(spell, { spellLevel, cost, finalDuration });
  const hasEffects = Array.isArray(snapshot?.effects) && snapshot.effects.length > 0;
  const hasEffectPayload = hasEffects
    || Boolean(snapshot?.system?.hasUpkeep)
    || Boolean(snapshot?.system?.hasOverTime)
    || Boolean(snapshot?.system?.hasBuffer)
    || Boolean(snapshot?.system?.duration?.value)
    || Boolean(spellNeedsEffectApplication(snapshot));

  if (normalizedMode === "potion") {
    if (routing.isAttack || routing.isCharacteristicDefense) {
      return { ok: false, reason: `${spell.name} is an offensive or defended spell and cannot be consumed as a direct potion effect.` };
    }

    if (healing) {
      return {
        ok: true,
        payload: {
          applicationKind: "healing",
          spellUuid: String(spell.uuid ?? "").trim(),
          spellSnapshot: snapshot,
          spellLevel: Math.max(1, Number(spellLevel ?? 1) || 1),
          damageType,
          formula: String(snapshot?.system?.damageFormula ?? "").trim(),
          finalDuration,
        },
      };
    }

    if (hasEffectPayload) {
      return {
        ok: true,
        payload: {
          applicationKind: "spellEffects",
          spellUuid: String(spell.uuid ?? "").trim(),
          spellSnapshot: snapshot,
          spellLevel: Math.max(1, Number(spellLevel ?? 1) || 1),
          damageType,
          finalDuration,
        },
      };
    }

    return { ok: false, reason: `${spell.name} does not define a direct consumable effect payload for potion use.` };
  }

  if (normalizedMode === "toxin") {
    if (routing.isAttack || healing) {
      return { ok: false, reason: `${spell.name} cannot be serialized as a direct toxin effect.` };
    }

    if (hasEffectPayload) {
      return {
        ok: true,
        payload: {
          applicationKind: "spellEffects",
          spellUuid: String(spell.uuid ?? "").trim(),
          spellSnapshot: snapshot,
          spellLevel: Math.max(1, Number(spellLevel ?? 1) || 1),
          damageType,
          finalDuration,
        },
      };
    }

    return { ok: false, reason: `${spell.name} does not define a direct on-hit toxin payload.` };
  }

  return { ok: false, reason: `Alchemy mode "${normalizedMode}" is not supported for spell serialization.` };
}

function _buildSpellDescriptor(actor, slot, ingredient = null, talents = null, mode = "potion") {
  const normalized = normalizeRecipeSlot(slot);
  if (!actorKnowsSpellUuid(actor, normalized.spellUuid)) return null;
  const spell = findActorSpellByUuid(actor, normalized.spellUuid);
  if (!spell) return null;

  const levelOptions = getSpellLevelOptions(spell);
  const profile = resolveSpellProfile(spell, actor, { level: normalized.spellLevel });
  const duration = profile?.duration?.isInstant
    ? null
    : {
      value: Number(profile?.duration?.value ?? 0),
      unit: String(profile?.duration?.unit ?? ""),
    };
  const cost = Math.max(0, Number(profile?.cost?.final ?? profile?.cost?.attempt ?? spell?.system?.cost ?? 0) || 0);
  const effectiveStrength = ingredient ? computeEffectiveStrength(ingredient, actor, { talents }) : null;
  const upkeepMultiplier = duration && effectiveStrength != null && cost > 0
    ? Math.max(1, Math.floor(effectiveStrength / cost))
    : 1;
  const finalDuration = _scaleSpellDuration(duration, upkeepMultiplier);
  const directPayloadResult = buildDirectAlchemyPayloadForSpell(spell, {
    mode,
    spellLevel: normalized.spellLevel,
    cost,
    finalDuration,
  });

  return {
    identifier: `spell:${spell.uuid}`,
    effectSource: "spell",
    effectKey: null,
    spellUuid: spell.uuid,
    effectLabel: spell.name,
    school: String(profile?.metadata?.school ?? spell?.system?.school ?? "").toLowerCase(),
    attributes: getSpellAlchemyAttributes(spell),
    spellLevel: normalized.spellLevel,
    levelOptions,
    slMin: levelOptions[0] ?? 1,
    slMax: levelOptions[levelOptions.length - 1] ?? 1,
    cost,
    baseDuration: duration,
    finalDuration,
    hasUpkeep: Boolean(profile?.classification?.hasUpkeep) || Boolean(duration),
    toxinOverrides: {},
    params: normalized.params ?? {},
    compatible: Boolean(directPayloadResult?.ok),
    invalidReason: directPayloadResult?.ok ? "" : String(directPayloadResult?.reason ?? "").trim(),
    directPayload: directPayloadResult?.ok ? directPayloadResult.payload : null,
  };
}

function _buildCatalogDescriptor(actor, slot, ingredient, talents) {
  const normalized = normalizeRecipeSlot(slot);
  const effectData = getEffectByKey(normalized.effectKey);
  if (!effectData) return null;

  const effectiveStrength = ingredient ? computeEffectiveStrength(ingredient, actor, { talents }) : null;
  const cost = computeEffectCost(normalized.effectKey, normalized.spellLevel);
  const finalDuration = ingredient && effectHasUpkeep(normalized.effectKey) && effectiveStrength != null
    ? computeUpkeepDuration(normalized.effectKey, effectiveStrength, cost)
    : null;
  const [slMin, slMax] = effectData.slRange ?? [1, 7];

  return {
    identifier: `catalog:${effectData.key}`,
    effectSource: "catalog",
    effectKey: effectData.key,
    spellUuid: null,
    effectLabel: effectData.label,
    school: String(effectData.school ?? "").toLowerCase(),
    attributes: Array.isArray(effectData.attributes) ? effectData.attributes.slice() : [],
    spellLevel: normalized.spellLevel,
    levelOptions: [],
    slMin,
    slMax,
    cost,
    baseDuration: effectData.baseDuration ?? null,
    finalDuration,
    hasUpkeep: effectHasUpkeep(normalized.effectKey),
    toxinOverrides: getEffectToxinOverrides(normalized.effectKey),
    params: normalized.params ?? {},
    compatible: true,
    invalidReason: "",
    directPayload: {
      applicationKind: "catalog",
      effectKey: effectData.key,
    },
  };
}

export function getAlchemyInventoryState(actor, { items = null } = {}) {
  const actorItems = Array.isArray(items) ? items : getActorItemsArray(actor);
  return {
    toolsPresent: actorItems.some((item) => ALCHEMY_TOOL_RX.test(item?.name ?? "")),
  };
}

export function getActorAlchemySpellEffects(actor, mode) {
  const wantedMode = String(mode ?? "").trim().toLowerCase();
  if (!["potion", "toxin"].includes(wantedMode)) return [];

  return getActorKnownAlchemyEffects(actor)
    .filter((entry) => entry.valid && entry.spell)
    .map((entry) => {
      const levelOptions = getSpellLevelOptions(entry.spell);
      return {
        effectSource: "spell",
        spellUuid: entry.spell.uuid,
        spellId: entry.spell.id,
        key: `spell:${entry.spell.uuid}`,
        value: `spell:${entry.spell.uuid}`,
        label: entry.spell.name,
        school: String(entry.spell?.system?.school ?? "").toLowerCase(),
        attributes: getSpellAlchemyAttributes(entry.spell),
        levelOptions,
        slMin: levelOptions[0] ?? 1,
        slMax: levelOptions[levelOptions.length - 1] ?? 1,
        sourceType: entry.sourceType,
        sourceLabel: entry.sourceLabel,
      };
    });
}

export function resolveAlchemyEffectDescriptor(actor, slot, { ingredient = null, talents = null, mode = "potion" } = {}) {
  const normalized = normalizeRecipeSlot(slot);
  if (normalized.effectSource === "spell") return _buildSpellDescriptor(actor, normalized, ingredient, talents, mode);
  return _buildCatalogDescriptor(actor, normalized, ingredient, talents);
}
