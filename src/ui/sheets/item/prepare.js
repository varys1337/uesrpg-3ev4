/**
 * src/ui/sheets/item/prepare.js
 * Data preparation helpers for item sheet getData()
 */

import { UESRPG } from "../../../core/constants.js";
import { SPECIAL_ACTIONS } from "../../../core/combat/combat-style-utils.js";
import {
  normalizeSpellConfig,
  getStackingPolicyOptions,
  getOwnershipPolicyOptions,
  getDispelStrengthOptions,
  getTargetingModeOptions,
  getEffectRecipeModeOptions,
  getConjureModeOptions,
  getBindingCharacteristicOptions,
  getDisintegrateTargetOptions,
  getDrainTypeOptions,
  getDefenseModelOptions,
  getCharacteristicDefenseSuccessOptions,
  getCharacteristicDefenseFailureOptions,
  getConsequenceConditionOptions,
  getSpellCoverageReport
} from "../../../core/magic/spell-config.js";
import { getSpellRelevantKeys } from "../../../core/active-effects/modifier-registry.js";
import {
  getFeatureConfig,
  getFeatureConfigOptions,
  getFeatureConfigCapabilities
} from "../../../core/traits/features/feature-config.js";
import {
  getRuleElements,
  getRuleElementOptions,
  getRuleElementTypesByFamily,
  RULE_ELEMENT_TYPES,
  CONDITION_TYPES,
  getRuleElementRuntimeSupport,
  validateRuleElement
} from "../../../core/traits/features/rule-elements.js";
import { getRuleElementRuntimeSettingsState } from "../../../core/traits/features/rule-element-runtime.js";
import { cachedEnrichHTML } from "../../../utils/enrich-cache.js";
import { STRIKE_ENCHANTMENTS_CATALOG } from "../../../data/strike-enchantments-catalog.js";
import { getEffectByKey } from "../../../core/alchemy/effects.js";

/**
 * Prepare item sheet data for rendering
 *
 * @param {ItemSheet} sheet
 * @param {object} data - Base data from super.getData()
 * @returns {Promise<object>} Enhanced data object for template
 */
export async function prepareItemSheetData(sheet, data) {
  data.dtypes = ["String", "Number", "Boolean"];
  data.isGM = game.user.isGM;
  // Fall back to sheet.isEditable if a caller didn't provide it.
  if (typeof data.editable !== "boolean") data.editable = Boolean(sheet.isEditable);
  const itemData = data.item;
  const itemType = data.item ? data.item.type : null;

  // Convenience flags for templates.
  data.canEditReloadAPCost = Boolean(
    data.editable &&
    data.item?.type === "weapon" &&
    String(data.item?.system?.attackMode ?? "").toLowerCase() === "ranged" &&
    data.item?.system?.gmOverride?.useBaseStats === true
  );

  // Enrich Description (cached per sheet instance)
  const _enrichFn = foundry.applications.ux.TextEditor.implementation.enrichHTML;
  const _enrich = (raw) => _enrichFn(raw || "");
  data.item.system.enrichedDescription = await cachedEnrichHTML(
    sheet, "desc", itemData.system.description ?? "", _enrich
  );

  // --------------------------------------------
  // Spell: normalize scaling levels for sheet rendering
  // --------------------------------------------
  if (itemType === "spell") {
    const rawLevels = data.item?.system?.scaling?.levels;
    let levels = [];
    if (Array.isArray(rawLevels)) levels = rawLevels;
    else if (rawLevels && typeof rawLevels === "object") levels = Object.values(rawLevels);

    const fallbackDurationUnit = data.item?.system?.duration?.unit || "instant";
    data.item.system.scaling.levels = levels
      .filter(l => l && typeof l === "object")
      .map(l => {
        const duration = (l.duration && typeof l.duration === "object")
          ? {
              value: Number(l.duration.value) || 0,
              unit: String(l.duration.unit ?? fallbackDurationUnit)
            }
          : {
              value: Number(l.duration) || 0,
              unit: fallbackDurationUnit
            };
        return { ...l, duration };
      });

    // ── Spell Engine configurator data ──

    // ── Normalize overTimeEntries for rendering ──
    // Use overTimeEntries if present, otherwise wrap legacy overTime into a single entry.
    {
      const rawEntries = data.item?.system?.overTimeEntries;
      if (Array.isArray(rawEntries) && rawEntries.length > 0) {
        data.overTimeEntries = rawEntries.filter(e => e && typeof e === "object");
      } else {
        const ot = data.item?.system?.overTime;
        if (ot && typeof ot === "object" && data.item?.system?.hasOverTime) {
          data.overTimeEntries = [ot];
        } else {
          data.overTimeEntries = [];
        }
      }
    }

    try {
      data.spellEngine = normalizeSpellConfig(sheet.item);
    } catch (err) {
      console.warn("prepareItemSheetData: normalizeSpellConfig failed", err);
      // Provide safe fallback so the template doesn't crash
      data.spellEngine = {
        targeting: { mode: "single", maxTargets: 1 },
        effects: { recipes: [], stackingPolicy: "replace", ownershipPolicy: "target" },
        persistence: { dispelStrength: "level", dispelFixedValue: 0 },
        summon: { actorUuid: "", quantity: 1 },
        conjure: { mode: "none", itemUuid: "", itemLabel: "", actorUuid: "", actorLabel: "", bindingCharacteristic: "wp", bindingModifier: 0, summonItems: null, summonActors: null },
        disintegrate: { enabled: false, target: "armor" },
        drain: { enabled: false, type: "none", transferToCaster: false },
        defenseModel: "opposed",
        characteristicDefense: { defenderCharacteristic: "end", modifierMode: "spellStrength", modifierFormula: "", onSuccess: "negate", onFailure: "consequences" },
        consequences: { staminaDelta: 0, healthDelta: 0, magickaDelta: 0, applyCondition: "", description: "" },
        cloak: { enabled: false, range: 1, excludeSelf: true, requireAttackTest: false, useSpellDamage: true }
      };
    }

    // Option lists for spell engine selects
    data.targetingModeOptions = getTargetingModeOptions();
    data.stackingPolicyOptions = getStackingPolicyOptions();
    data.ownershipPolicyOptions = getOwnershipPolicyOptions();
    data.dispelStrengthOptions = getDispelStrengthOptions();
    data.effectRecipeModeOptions = getEffectRecipeModeOptions();
    data.conjureModeOptions = getConjureModeOptions();
    data.bindingCharacteristicOptions = getBindingCharacteristicOptions();
    data.disintegrateTargetOptions = getDisintegrateTargetOptions();
    data.drainTypeOptions = getDrainTypeOptions();
    data.defenseModelOptions = getDefenseModelOptions();
    data.charDefModifierModeOptions = { spellStrength: "Spell Strength (SS)", formula: "Custom Formula" };
    data.charDefSuccessOptions = getCharacteristicDefenseSuccessOptions();
    data.charDefFailureOptions = getCharacteristicDefenseFailureOptions();
    data.consequenceConditionOptions = getConsequenceConditionOptions();

    // Modifier key options for recipe builder { key: label }
    const spellKeys = getSpellRelevantKeys();
    data.modifierKeyOptions = {};
    for (const entry of spellKeys) {
      data.modifierKeyOptions[entry.key] = entry.label || entry.key;
    }

    // Coverage report for QA tab
    try {
      data.coverageReport = getSpellCoverageReport(sheet.item);
    } catch (err) {
      console.warn("prepareItemSheetData: getSpellCoverageReport failed", err);
      data.coverageReport = [];
    }

    // ── Advanced modules enabled count (for badge in Advanced Options) ──
    {
      let count = 0;
      const se = data.spellEngine;
      if (se.disintegrate?.enabled) count++;
      if (se.drain?.enabled) count++;
      if (se.cloak?.enabled) count++;
      if (data.item?.system?.isRuneSpell) count++;
      if (data.item?.system?.isZonePersistent) count++;
      if (data.item?.system?.hasOverTime) count++;
      if (data.item?.system?.isSummonSpell) count++;
      if (data.item?.system?.hasBuffer) count++;
      if (data.item?.system?.school === "conjuration" && se.conjure?.mode && se.conjure.mode !== "none") count++;
      data.advancedModulesCount = count;
    }

    // ── Spell Recipes (Experimental) setting guard ──
    try {
      data.enableSpellRecipes = game.settings.get("uesrpg-3ev4", "enableSpellRecipes") === true;
    } catch (_e) {
      data.enableSpellRecipes = false;
    }
  }

  // --------------------------------------------
  // Armor: Effective Weight Class (derived)
  // --------------------------------------------
  if (data.item && data.item.type === "armor") {
    const base = (data.item.system && data.item.system.weightClass != null) ? data.item.system.weightClass : "none";
    const quality = (data.item.system && data.item.system.qualityLevel != null) ? data.item.system.qualityLevel : "common";
    const order = ["none", "light", "medium", "heavy", "superheavy", "crippling"];
    let i = order.indexOf(base);
    if (i === -1) i = 0;
    if (quality === "inferior") i += 1;
    else if (quality === "superior") i -= 1;
    i = Math.max(0, Math.min(order.length - 1, i));
    data.item.system.effectiveWeightClass = order[i];
  }

  // --------------------------------------------
  // Item option lists for selects (v13-safe)
  // --------------------------------------------
  data.weaponQualityOptions = UESRPG.WEAPON_QUALITY_LEVELS;
  data.weaponMaterialOptions = UESRPG.WEAPON_MATERIALS;
  // Weapon handedness (RAW support). Stored in system.hands.
  // NOTE: selectOptions serializes option keys as strings; downstream usage should cast via Number().
  data.weaponHandednessOptions = {
    0: "—",
    1: "1H",
    1.5: "1.5H",
    2: "2H"
  };
  data.attackModeOptions = { melee: "Melee", ranged: "Ranged" };

  // Damage type options for damage instances UI (weapons + spells)
  data.damageTypeOptions = {
    none: "None",
    physical: "Physical",
    fire: "Fire",
    frost: "Frost",
    shock: "Shock",
    poison: "Poison",
    magic: "Magic",
    silver: "Silver",
    sunlight: "Sunlight",
    healing: "Healing"
  };

  // Normalize damageInstances for rendering (weapons + spells)
  if (itemType === "spell" || itemType === "weapon") {
    const rawInstances = data.item?.system?.damageInstances;
    data.item.system.damageInstances = Array.isArray(rawInstances)
      ? rawInstances.filter(i => i && typeof i === "object").map(i => ({
          formula: String(i.formula ?? ""),
          type: String(i.type ?? "none"),
          label: String(i.label ?? "")
        }))
      : [];
  }
  data.armorWeightClassOptions = UESRPG.ARMOR_WEIGHT_CLASSES;
  data.ammoArrowTypeOptions = UESRPG.AMMO_ARROW_TYPES;
  data.ammoMaterialOptions = UESRPG.AMMO_MATERIALS;
  data.armorMaterialOptions = UESRPG.ARMOR_MATERIALS;
  data.armorClassOptions = UESRPG.ARMOR_CLASSES;
  data.shieldTypeOptions = UESRPG.SHIELD_TYPES;
  
  // Activation options for traits/talents/powers
  data.talentActionTypeOptions = {
    passive: "Passive",
    action: "Action",
    reaction: "Reaction"
  };
  data.traitActionTypeOptions = {
    passive: "Passive",
    action: "Action",
    reaction: "Reaction"
  };
  data.powerActionTypeOptions = {
    passive: "Passive",
    action: "Action",
    reaction: "Reaction"
  };
  
  data.activationUsagePeriodOptions = {
    "": "\u2014 Not Set \u2014",
    encounter: "Encounter",
    shortRest: "Short Rest",
    longRest: "Long Rest",
    day: "Day"
  };
  data.activationHitLocationModeOptions = {
    roll: "Roll Location",
    manual: "Manual Location"
  };
  data.activationDamageModeOptions = {
    none: "None",
    manual: "Manual",
    healing: "Healing",
    temporary: "Temporary HP"
  };
  data.activationDamageTypeOptions = {
    physical: "Physical",
    fire: "Fire",
    frost: "Frost",
    shock: "Shock",
    poison: "Poison",
    disease: "Disease",
    magic: "Magic"
  };

  // --------------------------------------------
  // Ammunition: Derived Price Per Shot
  // --------------------------------------------
  if (data.item && data.item.type === "ammunition") {
    const p10 = Number((data.item.system && data.item.system.pricePer10 != null) ? data.item.system.pricePer10 : 0);
    data.item.system.pricePerShot = Math.round((p10 / 10) * 100) / 100;
  }

  // --------------------------------------------
  // Structured Qualities v1 (shared)
  // --------------------------------------------
  // Structured qualities: show a type-specific "core" grid + a set of togglable "other traits".

  // NOTE: support multiple export locations/names from earlier patches so sheets never silently render empty.
  // Canonical in this repo is QUALITIES_CORE_BY_TYPE and TRAITS_BY_TYPE.
  const coreByType =
    (UESRPG.CONSTANTS && UESRPG.CONSTANTS.QUALITIES_CORE_BY_TYPE) ||
    UESRPG.QUALITIES_CORE_BY_TYPE ||
    (UESRPG.CONSTANTS && UESRPG.CONSTANTS.QUALITIES_CATALOG_BY_TYPE) ||
    UESRPG.QUALITIES_CATALOG_BY_TYPE;

  const traitsByType =
    (UESRPG.CONSTANTS && UESRPG.CONSTANTS.TRAITS_BY_TYPE) ||
    UESRPG.TRAITS_BY_TYPE ||
    (UESRPG.CONSTANTS && UESRPG.CONSTANTS.QUALITIES_TRAITS_BY_TYPE) ||
    UESRPG.QUALITIES_TRAITS_BY_TYPE;

  data.qualitiesCatalog = (coreByType && itemType) ? (coreByType[itemType] || UESRPG.QUALITIES_CATALOG) : UESRPG.QUALITIES_CATALOG;
  // Template compatibility: newer sheets reference `coreQualitiesCatalog`.
  data.coreQualitiesCatalog = data.qualitiesCatalog;

  // Armor cleanup: ensure weapon-only "Silver" never appears in armor qualities UI, regardless of
  // which catalog export a world is using.
  if (itemType === "armor" && Array.isArray(data.coreQualitiesCatalog)) {
    data.coreQualitiesCatalog = data.coreQualitiesCatalog.filter(q => q && q.key !== "silver");
    data.qualitiesCatalog = data.coreQualitiesCatalog;
  }

  // Trait catalog (type-specific) with selected flags.
  const traitsSrc = (data.item && data.item.system) ? data.item.system.qualitiesTraits : null;
  const traits = Array.isArray(traitsSrc) ? traitsSrc : [];
  const traitCatalog = (traitsByType && itemType) ? (traitsByType[itemType] || []) : [];
  data.traitsCatalog = traitCatalog.map(t => ({ ...t, selected: traits.includes(t.key) }));
  data.traitsSelected = traits.reduce((acc, k) => {
    acc[k] = true;
    return acc;
  }, {});

  const structuredSrc = (data.item && data.item.system) ? data.item.system.qualitiesStructured : null;
  const structured = Array.isArray(structuredSrc) ? structuredSrc : [];
  const selectedToggle = {};
  const selectedValue = {};
  for (const q of structured) {
    if (!q || !q.key) continue;
    // If a structured quality exists it is "on". Some qualities may optionally carry a numeric X value.
    selectedToggle[q.key] = true;
    if (typeof q.value === "number") selectedValue[q.key] = q.value;
  }
  data.qualitiesSelectedToggle = selectedToggle;
  data.qualitiesSelectedValue = selectedValue;

  // --------------------------------------------
  // Activation Damage Qualities (Talents/Traits/Powers)
  // --------------------------------------------
  if (itemType && ["trait", "talent", "power"].includes(itemType)) {
    const weaponCoreCatalog = (coreByType && coreByType.weapon)
      ? coreByType.weapon
      : (UESRPG.QUALITIES_CORE_BY_TYPE?.weapon ?? UESRPG.QUALITIES_CATALOG ?? []);
    const weaponTraitCatalog = (traitsByType && traitsByType.weapon) ? traitsByType.weapon : [];

    const activationDamage = data.item?.system?.activation?.damage ?? {};
    const activationStructured = Array.isArray(activationDamage.qualitiesStructured) ? activationDamage.qualitiesStructured : [];
    const activationTraits = Array.isArray(activationDamage.qualitiesTraits) ? activationDamage.qualitiesTraits : [];

    const activationSelectedToggle = {};
    const activationSelectedValue = {};
    for (const q of activationStructured) {
      if (!q || !q.key) continue;
      activationSelectedToggle[q.key] = true;
      if (typeof q.value === "number") activationSelectedValue[q.key] = q.value;
    }

    data.activationDamageQualitiesCatalog = Array.isArray(weaponCoreCatalog) ? weaponCoreCatalog : [];
    data.activationDamageSelectedToggle = activationSelectedToggle;
    data.activationDamageSelectedValue = activationSelectedValue;

    const activationTraitKeys = activationTraits.map(t => String(t ?? "")).filter(Boolean);
    data.activationDamageTraitsCatalog = (Array.isArray(weaponTraitCatalog) ? weaponTraitCatalog : []).map(t => ({
      ...t,
      selected: activationTraitKeys.includes(t.key)
    }));
    data.activationDamageTraitsSelected = activationTraitKeys.reduce((acc, k) => {
      acc[k] = true;
      return acc;
    }, {});
  }

  // --------------------------------------------
  // Feature Config + Rule Elements (Traits/Talents/Powers)
  // --------------------------------------------
  if (itemType && ["trait", "talent", "power"].includes(itemType)) {
    data.featureConfig = getFeatureConfig(sheet.item);
    data.featureOptions = getFeatureConfigOptions();
    data.featureCapabilities = getFeatureConfigCapabilities(itemType);

    // Rule Elements
    const runtimeSupport = getRuleElementRuntimeSupport();
    const runtimeSettings = getRuleElementRuntimeSettingsState();
    const workflowEnabled = runtimeSettings?.enabled ?? {};

    data.ruleElements = getRuleElements(sheet.item).map((element) => {
      const support = runtimeSupport?.[element.type] ?? { status: "planned", workflows: ["all"], phases: [] };
      const elementWorkflows = Array.isArray(element?.workflows) && element.workflows.length ? element.workflows : ["all"];
      const scopedWorkflows = elementWorkflows.includes("all")
        ? ["skill", "characteristic", "combat", "magic"]
        : elementWorkflows;
      const supportWorkflows = Array.isArray(support?.workflows) && support.workflows.length
        ? support.workflows
        : ["all"];
      const supportedScopedWorkflows = supportWorkflows.includes("all")
        ? scopedWorkflows
        : scopedWorkflows.filter((wf) => supportWorkflows.includes(wf));
      const workflowSupported = supportWorkflows.includes("all") || supportedScopedWorkflows.length > 0;
      const runtimeOffByWorkflow = supportedScopedWorkflows.length > 0
        ? supportedScopedWorkflows.every((wf) => !workflowEnabled?.[wf])
        : false;
      const validation = validateRuleElement(element);
      const supportStatus = String(support?.status ?? "planned");
      let runtimeStatus = supportStatus;
      let runtimeReason = "";

      if (supportStatus !== "informational" && !workflowSupported) {
        runtimeStatus = "unsupportedInWorkflow";
        runtimeReason = "Type is not executable in the selected workflow scope.";
      } else if (supportStatus !== "informational" && runtimeOffByWorkflow) {
        runtimeStatus = "disabledBySetting";
        runtimeReason = "Selected workflow scope is disabled by world runtime settings.";
      }

      return {
        ...element,
        runtimeStatus,
        runtimeReason,
        runtimeSupport: support,
        validation
      };
    });

    data.ruleElementOptions = getRuleElementOptions();
    data.ruleElementTypesByFamily = getRuleElementTypesByFamily();
    data.ruleElementRuntimeSupport = runtimeSupport;
    data.ruleElementRuntimeSettings = runtimeSettings;

    // Lookup maps for the template (type key → label/icon/description)
    const reLabels = {};
    const reIcons = {};
    const reDescriptions = {};
    for (const [key, def] of Object.entries(RULE_ELEMENT_TYPES)) {
      reLabels[key] = def.label;
      reIcons[key] = def.icon;
      reDescriptions[key] = def.description;
    }
    data.ruleElementLabels = reLabels;
    data.ruleElementIcons = reIcons;
    data.ruleElementDescriptions = reDescriptions;
    data.ruleElementStatusLabels = {
      active: "Active",
      planned: "Planned",
      informational: "Informational",
      disabledBySetting: "Disabled by Setting",
      unsupportedInWorkflow: "Unsupported in Workflow"
    };

    // Condition label lookup
    const condLabels = {};
    for (const [key, def] of Object.entries(CONDITION_TYPES)) {
      condLabels[key] = def.label;
    }
    data.conditionLabels = condLabels;
  }

  // Active Effects list for templates (plain objects)
  data.effects = (sheet.item && sheet.item.effects) ? sheet.item.effects.contents.map(e => e.toObject()) : [];

  // --------------------------------------------
  // Combat Style: Active status + Special Actions registry
  // --------------------------------------------
  if (itemType === "combatStyle") {
    const te = Array.isArray(data.item?.system?.trainedEquipment) ? data.item.system.trainedEquipment : [];
    data.item.system.trainedEquipment = Array.from({ length: 10 }, (_, i) => String(te[i] ?? "").trim());
  }

  if (itemType === "combatStyle" && sheet.item?.isOwned && sheet.actor) {
    const activeStyleId = sheet.actor.getFlag("uesrpg-3ev4", "activeCombatStyleId");
    data.isActiveCombatStyle = (activeStyleId === sheet.item.id);
    data.specialActionsRegistry = SPECIAL_ACTIONS;
  }

  // --------------------------------------------
  // Weapon: Ammunition selection options
  // --------------------------------------------
  if (itemType === "weapon" && sheet.item?.isOwned && sheet.actor) {
    const ammoItems = sheet.actor.itemTypes?.ammunition ?? [];
    data.ammoOptions = ammoItems.map(ammo => ({
      value: ammo.id,
      label: `${ammo.name}${ammo.system.quantity ? ` (${ammo.system.quantity})` : ''}`
    }));
  } else if (itemType === "weapon") {
    // Unowned weapon (world item): provide empty array
    data.ammoOptions = [];
  }

  // --------------------------------------------
  // Weapon / Armor: Enchantment display (read-only)
  // Written by the Enchanting Workshop; surfaced here for the item sheet Attributes tab.
  // --------------------------------------------
  if (itemType === "weapon" || itemType === "armor" || itemType === "ammunition") {
    const enc = sheet.item?.flags?.["uesrpg-3ev4"]?.enchanting ?? null;
    if (enc?.version === 2 && enc.enchantType) {
      data.enchantmentDisplay = _buildEnchantmentDisplay(enc, sheet.item);
    } else {
      data.enchantmentDisplay = null;
    }
  }

  // --------------------------------------------
  // Generic Item: Alchemy ingredient data (flag-based)
  // Identifies items that serve as alchemy ingredients via flags["uesrpg-3ev4"].alchemy.
  // --------------------------------------------
  if (itemType === "item") {
    const alchemyFlags = sheet.item?.flags?.["uesrpg-3ev4"]?.alchemy ?? null;
    data.isAlchemyIngredient = alchemyFlags?.kind === "ingredient";
    data.isAlchemyProduct = ["potion", "poison", "toxin"].includes(String(alchemyFlags?.kind ?? ""));

    data.alchemyData = data.isAlchemyIngredient
      ? {
          kind: alchemyFlags.kind ?? "ingredient",
          school: alchemyFlags.school ?? "",
          strengthBase: Number(alchemyFlags.strengthBase ?? 0),
          depthBase: Number(alchemyFlags.depthBase ?? 0),
        }
      : null;

    // Alchemy product (potion / poison / toxin) summary for the generic item sheet.
    if (data.isAlchemyProduct) {
      const kind = String(alchemyFlags?.kind ?? "");
      const effects = Array.isArray(alchemyFlags?.effects)
        ? alchemyFlags.effects
            .filter((e) => e && typeof e === "object")
            .map((e) => {
              const def = getEffectByKey(e.effectKey);
              return {
                key: String(e.effectKey ?? ""),
                label: def?.label ?? String(e.effectKey ?? ""),
                school: def?.school ?? String(e.school ?? ""),
                spellLevel: Number(e.spellLevel ?? 1),
              };
            })
        : [];

      data.alchemyProduct = {
        kind,
        backfired: Boolean(alchemyFlags?.backfired),
        poisonLevel: Number(alchemyFlags?.poisonLevel ?? 1),
        damageFormula: String(alchemyFlags?.damageFormula ?? "1d4"),
        durationRounds: Number(alchemyFlags?.durationRounds ?? 10),
        maxHits: Number(alchemyFlags?.maxHits ?? 3),
        effects,
        brewedAt: alchemyFlags?.brew?.brewedAt ?? null,
        alchemyRank: alchemyFlags?.brew?.alchemyRank ?? null,
      };
    } else {
      data.alchemyProduct = null;
    }
  }

  return data;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Build a display-safe enchantment summary from the item's enchanting flags.
 * Supports: strike enchantments (v2). Cast and constant stubs.
 *
 * @param {object} enc - weapon.flags["uesrpg-3ev4"].enchanting
 * @param {Item} item
 * @returns {object} displayable enchantment summary
 */
function _buildEnchantmentDisplay(enc, item) {
  const typeLabels = {
    strike: "Strike",
    cast: "Cast",
    constant: "Constant",
  };

  const typeLabel = typeLabels[enc.enchantType] ?? enc.enchantType;
  const useCharges = enc.strike?.useCharges === true
    || enc.cast?.useCharges === true
    || false;
  const chargeValue = Number(item?.system?.charge?.value ?? 0);
  const chargeMax = Number(item?.system?.charge?.max ?? 0);

  let effects = [];

  if (enc.enchantType === "strike" && Array.isArray(enc.strike?.effects)) {
    effects = enc.strike.effects
      .map(e => {
        const catalogEntry = STRIKE_ENCHANTMENTS_CATALOG.find(c => c.key === e.key);
        if (!catalogEntry) return null;
        return {
          label: catalogEntry.label,
          paramSummary: _buildParamSummary(catalogEntry, e),
        };
      })
      .filter(Boolean);
  } else if (enc.enchantType === "cast" || enc.enchantType === "constant") {
    // Cast and constant: show stub — full effect details live in the workshop.
    effects = [{ label: "See Enchanting Workshop for effect details", paramSummary: "" }];
  }

  return { typeLabel, useCharges, chargeValue, chargeMax, effects };
}

/**
 * Format a human-readable parameter summary string for a strike effect.
 * @param {object} catalogEntry
 * @param {object} effectEntry - The per-effect data stored in flags
 * @returns {string}
 */
function _buildParamSummary(catalogEntry, effectEntry) {
  const parts = [];
  if (effectEntry.sl != null && catalogEntry.paramKeys?.includes("sl")) {
    parts.push(`SL ${effectEntry.sl}`);
  }
  if (effectEntry.y != null && catalogEntry.paramKeys?.includes("y")) {
    parts.push(`Amount ${effectEntry.y}`);
  }
  if (effectEntry.type != null && catalogEntry.paramKeys?.includes("type")) {
    parts.push(`Target: ${effectEntry.type}`);
  }
  return parts.join(", ");
}
