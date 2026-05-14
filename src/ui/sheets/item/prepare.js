/**
 * src/ui/sheets/item/prepare.js
 * Data preparation helpers for item sheet getData()
 */

import { UESRPG } from "../../../core/constants.js";
import { getCachedSetting } from "../../../core/config/settings-cache.js";
import {
  WEAPON_QUALITY_LABELS,
  WEAPON_MATERIAL_LABELS,
  AMMO_ARROW_TYPE_LABELS,
  ARMOR_WEIGHT_CLASS_LABELS,
  ARMOR_CLASS_LABELS,
  SPELL_SCHOOL_LABELS,
  TRAINING_RANK_LABELS,
  ARMOR_MATERIAL_LABELS,
  SHIELD_TYPE_LABELS,
  ITEM_QUALITY_LABELS,
  resolveQualityCatalog,
  RELIGION_DOMAIN_LABELS,
  INVOCATION_CIRCLE_LABELS,
} from "../../../core/config/label-catalog.js";
import { getReligionDomain } from "../../../core/religion/domain-registry.js";
import { getActorRitualDomainItems } from "../../../core/religion/ritual-domains.js";
import { SPECIAL_ACTIONS } from "../../../core/config/special-actions.js";
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
import { cachedEnrichHTML } from "../../../utils/enrich-cache.js";
import { t } from "../../../utils/i18n.js";
import { getAllCharacteristicOptions } from "../../../utils/maps/characteristics.js";
import { STRIKE_ENCHANTMENTS_CATALOG } from "../../../data/strike-enchantments-catalog.js";
import { localizeStrikeEnchantment } from "../../../data/spell-i18n.js";
import { getEffectByKey } from "../../../core/alchemy/effects.js";
import { buildAlchemyProductEffectSlots } from "./item-sheet-alchemy-effects.js";
import {
  getWeaponBaseReachState,
  getWeaponReachBoundsEffective,
  isReachLengthHomebrewEnabled,
  getReachLengthModel,
} from "../../../core/homebrew/reach-length/weapon.js";
import { buildActorSheetEffectView } from "../v2/shared/sheet-context.js";
import { buildStoredSpellOptionState } from "../../shared/stored-spell-options.js";
import { getKnownSpellScalingLevels } from "../../../core/magic/magicka-utils.js";

function _buildStoredSpellLevelOptions(spellLike, currentLevel) {
  const levels = Array.from(new Set(
    (getKnownSpellScalingLevels(spellLike) ?? [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b)
  ));
  if (!levels.length) return [];
  const selected = Number(currentLevel) > 0 ? Number(currentLevel) : levels[0];
  return levels.map((value) => ({ value, label: String(value), selected: value === selected }));
}

function _coerceStoredSpellLevel(currentLevel, levelOptions) {
  const level = Number(currentLevel);
  if (Array.isArray(levelOptions) && levelOptions.length > 0) {
    const allowed = new Set(levelOptions.map((entry) => Number(entry?.value)).filter((value) => Number.isFinite(value) && value > 0));
    if (allowed.has(level)) return level;
    return Number(levelOptions[0]?.value ?? 1) || 1;
  }
  return Math.max(1, level || 1);
}

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
  const itemDoc = sheet.document;
  const actorDoc = itemDoc?.actor ?? null;
  const itemData = data.item;
  const itemType = data.item ? data.item.type : null;

  // Convenience flags for templates.
  data.canEditReloadAPCost = Boolean(
    data.editable &&
    data.item?.type === "weapon" &&
    String(data.item?.system?.attackMode ?? "").toLowerCase() === "ranged"
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
        const spellStrengthFormula = String(
          l.spellStrengthFormula
          ?? l.spellStrength
          ?? l.spell_str
          ?? l.strength
          ?? l.value
          ?? ""
        ).trim();
        const damageType = String(
          l.damageType
          ?? data.item?.system?.damageType
          ?? "none"
        ).trim().toLowerCase() || "none";
        return {
          ...l,
          known: l.known !== false && l.known !== "false",
          damageType,
          spellStrengthFormula,
          duration
        };
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
      data.spellEngine = normalizeSpellConfig(itemDoc);
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
    data.selectedDefenseModel = itemDoc?.system?.isDirect ? "direct" : data.spellEngine.defenseModel;
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
      data.coverageReport = getSpellCoverageReport(itemDoc);
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
      data.enableSpellRecipes = getCachedSetting("enableSpellRecipes") === true;
    } catch (_e) {
      data.enableSpellRecipes = false;
    }

    const alchemyEffectFlags = itemDoc?.flags?.["uesrpg-3ev4"]?.alchemyEffect ?? {};
    data.canConfigureAlchemyEffectTags = Boolean(itemDoc?.isOwned);
    data.alchemyEffectFlags = {
      potion: Boolean(alchemyEffectFlags?.potion),
      toxin: Boolean(alchemyEffectFlags?.toxin),
    };
  }

  if (itemType === "invocation") {
    data.religionDomainOptions = RELIGION_DOMAIN_LABELS;
    data.invocationCircleOptions = INVOCATION_CIRCLE_LABELS;
    data.item.system.aspectsText = Array.isArray(data.item.system.aspects)
      ? data.item.system.aspects.join(", ")
      : "";
    data.item.system.tnDomainKey = String(data.item.system.tnDomainKey ?? "").trim().toLowerCase();
    const ownedRitualDomains = actorDoc ? Object.entries(getActorRitualDomainItems(actorDoc)) : [];
    const invocationTnDomainOptions = { "": "Prepared Domain" };
    if (ownedRitualDomains.length) {
      for (const [domainKey, ritualItem] of ownedRitualDomains) {
        invocationTnDomainOptions[domainKey] = ritualItem?.name || getReligionDomain(domainKey)?.ritualSkillName || `Ritual [${RELIGION_DOMAIN_LABELS[domainKey] ?? domainKey}]`;
      }
    } else {
      for (const [domainKey, label] of Object.entries(RELIGION_DOMAIN_LABELS)) {
        const ritualSkillName = getReligionDomain(domainKey)?.ritualSkillName || `Ritual [${label}]`;
        invocationTnDomainOptions[domainKey] = ritualSkillName;
      }
    }
    data.invocationTnDomainOptions = invocationTnDomainOptions;
  }

  // --------------------------------------------
  // Armor: Effective Weight Class (derived)
  // --------------------------------------------
  if (data.item && (data.item.type === "armor" || data.item.type === "shield")) {
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
  data.weaponQualityOptions = WEAPON_QUALITY_LABELS;
  data.weaponMaterialOptions = WEAPON_MATERIAL_LABELS;
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
    disease: "Disease",
    magic: "Magic",
    silver: "Silver",
    sunlight: "Sunlight",
    healing: "Healing",
    temporaryhealing: "Temporary Healing"
  };

  // Normalize damageInstances for rendering (spells only)
  if (itemType === "spell") {
    const rawInstances = data.item?.system?.damageInstances;
    data.item.system.damageInstances = Array.isArray(rawInstances)
      ? rawInstances.filter(i => i && typeof i === "object").map(i => ({
          formula: String(i.formula ?? ""),
          type: String(i.type ?? "none"),
          label: String(i.label ?? "")
        }))
      : [];
  }
  data.armorWeightClassOptions = ARMOR_WEIGHT_CLASS_LABELS;
  data.ammoArrowTypeOptions = AMMO_ARROW_TYPE_LABELS;
  data.armorMaterialOptions = ARMOR_MATERIAL_LABELS;
  data.armorClassOptions = ARMOR_CLASS_LABELS;
  data.shieldTypeOptions = SHIELD_TYPE_LABELS;
  data.spellSchoolOptions = SPELL_SCHOOL_LABELS;
  data.skillRankOptions = TRAINING_RANK_LABELS;
  data.characteristicOptionList = getAllCharacteristicOptions(actorDoc);
  data.characteristicOptions = Object.fromEntries(
    data.characteristicOptionList.map(({ key, label }) => [key, label])
  );
  
  // Activation options for traits/talents/powers
  data.talentActionTypeOptions = {
    passive: t("UESRPG.Sheets.Feature.ActionType.Passive", "Passive"),
    action: t("UESRPG.Sheets.Feature.ActionType.Action", "Action"),
    reaction: t("UESRPG.Sheets.Feature.ActionType.Reaction", "Reaction")
  };
  data.traitActionTypeOptions = {
    passive: t("UESRPG.Sheets.Feature.ActionType.Passive", "Passive"),
    action: t("UESRPG.Sheets.Feature.ActionType.Action", "Action"),
    reaction: t("UESRPG.Sheets.Feature.ActionType.Reaction", "Reaction")
  };
  data.powerActionTypeOptions = {
    passive: t("UESRPG.Sheets.Feature.ActionType.Passive", "Passive"),
    action: t("UESRPG.Sheets.Feature.ActionType.Action", "Action"),
    reaction: t("UESRPG.Sheets.Feature.ActionType.Reaction", "Reaction")
  };
  
  data.activationUsagePeriodOptions = {
    "": t("UESRPG.Sheets.Feature.UsagePeriod.NotSet", "\u2014 Not Set \u2014"),
    encounter: t("UESRPG.Sheets.Feature.UsagePeriod.Encounter", "Encounter"),
    shortRest: t("UESRPG.Sheets.Feature.UsagePeriod.ShortRest", "Short Rest"),
    longRest: t("UESRPG.Sheets.Feature.UsagePeriod.LongRest", "Long Rest"),
    day: t("UESRPG.Sheets.Feature.UsagePeriod.Day", "Day")
  };
  data.activationHitLocationModeOptions = {
    roll: t("UESRPG.Sheets.Feature.HitLocationMode.Roll", "Roll Location"),
    manual: t("UESRPG.Sheets.Feature.HitLocationMode.Manual", "Manual Location")
  };
  data.activationDamageModeOptions = {
    none: t("UESRPG.Sheets.Feature.DamageMode.None", "None"),
    manual: t("UESRPG.Sheets.Feature.DamageMode.Manual", "Manual"),
    healing: t("UESRPG.Sheets.Feature.DamageMode.Healing", "Healing"),
    temporary: t("UESRPG.Sheets.Feature.DamageMode.Temporary", "Temporary HP")
  };
  data.activationDamageTypeOptions = {
    physical: t("UESRPG.Sheets.Feature.DamageType.Physical", "Physical"),
    fire: t("UESRPG.Sheets.Feature.DamageType.Fire", "Fire"),
    frost: t("UESRPG.Sheets.Feature.DamageType.Frost", "Frost"),
    shock: t("UESRPG.Sheets.Feature.DamageType.Shock", "Shock"),
    poison: t("UESRPG.Sheets.Feature.DamageType.Poison", "Poison"),
    disease: t("UESRPG.Sheets.Feature.DamageType.Disease", "Disease"),
    magic: t("UESRPG.Sheets.Feature.DamageType.Magic", "Magic")
  };

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

  const rawCatalog = (coreByType && itemType)
    ? (coreByType[itemType] || (itemType === "shield" ? coreByType.armor : null) || UESRPG.QUALITIES_CATALOG)
    : UESRPG.QUALITIES_CATALOG;
  data.qualitiesCatalog = resolveQualityCatalog(rawCatalog, ITEM_QUALITY_LABELS);
  // Template compatibility: newer sheets reference `coreQualitiesCatalog`.
  data.coreQualitiesCatalog = data.qualitiesCatalog;

  // Armor cleanup: ensure weapon-only "Silver" never appears in armor qualities UI, regardless of
  // which catalog export a world is using.
  if ((itemType === "armor" || itemType === "shield") && Array.isArray(data.coreQualitiesCatalog)) {
    data.coreQualitiesCatalog = data.coreQualitiesCatalog.filter(q => q && q.key !== "silver");
    data.qualitiesCatalog = data.coreQualitiesCatalog;
  }

  // Trait catalog (type-specific) with selected flags.
  const traitsSrc = (data.item && data.item.system) ? data.item.system.qualitiesTraits : null;
  const traits = Array.isArray(traitsSrc) ? traitsSrc : [];
  const rawTraitCatalog = (traitsByType && itemType) ? (traitsByType[itemType] || []) : [];
  const traitCatalog = resolveQualityCatalog(rawTraitCatalog, ITEM_QUALITY_LABELS);
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

    data.activationDamageQualitiesCatalog = resolveQualityCatalog(
      Array.isArray(weaponCoreCatalog) ? weaponCoreCatalog : [], ITEM_QUALITY_LABELS
    );
    data.activationDamageSelectedToggle = activationSelectedToggle;
    data.activationDamageSelectedValue = activationSelectedValue;

    const activationTraitKeys = activationTraits.map(t => String(t ?? "")).filter(Boolean);
    data.activationDamageTraitsCatalog = resolveQualityCatalog(
      Array.isArray(weaponTraitCatalog) ? weaponTraitCatalog : [], ITEM_QUALITY_LABELS
    ).map(t => ({
      ...t,
      selected: activationTraitKeys.includes(t.key)
    }));
    data.activationDamageTraitsSelected = activationTraitKeys.reduce((acc, k) => {
      acc[k] = true;
      return acc;
    }, {});
  }

  // --------------------------------------------
  // Feature Config (Traits/Talents/Powers)
  // --------------------------------------------
  if (itemType && ["trait", "talent", "power"].includes(itemType)) {
    data.featureConfig = getFeatureConfig(itemDoc);
    data.featureOptions = getFeatureConfigOptions();
    data.featureCapabilities = getFeatureConfigCapabilities(itemType);
  }

  // Active Effects list for templates (plain objects)
  data.effects = itemDoc?.effects ? itemDoc.effects.contents.map(buildActorSheetEffectView) : [];

  // --------------------------------------------
  // Combat Style: Active status + Special Actions registry
  // --------------------------------------------
  if (itemType === "combatStyle") {
    const te = Array.isArray(data.item?.system?.trainedEquipment) ? data.item.system.trainedEquipment : [];
    data.item.system.trainedEquipment = Array.from({ length: 10 }, (_, i) => String(te[i] ?? "").trim());
  }

  if (itemType === "combatStyle" && itemDoc?.isOwned && actorDoc) {
    const activeStyleId = actorDoc.getFlag("uesrpg-3ev4", "activeCombatStyleId");
    data.isActiveCombatStyle = (activeStyleId === itemDoc.id);
    data.specialActionsRegistry = SPECIAL_ACTIONS;
  }

  // --------------------------------------------
  // Weapon: Ammunition selection options
  // --------------------------------------------
  if (itemType === "weapon" && itemDoc?.isOwned && actorDoc) {
    const ammoItems = actorDoc.itemTypes?.ammunition ?? [];
    data.ammoOptions = ammoItems.map(ammo => ({
      value: ammo.id,
      label: `${ammo.name}${ammo.system.quantity ? ` (${ammo.system.quantity})` : ''}`
    }));
  } else if (itemType === "weapon") {
    // Unowned weapon (world item): provide empty array
    data.ammoOptions = [];
  }

  // --------------------------------------------
  // Weapon: Homebrew Reach & Length Overhaul fields
  // --------------------------------------------
  if (itemType === "weapon") {
    data.homebrewReachLengthEnabled = isReachLengthHomebrewEnabled();
    data.homebrewReachModel = getReachLengthModel();

    const attackMode = String(itemDoc?.system?.attackMode ?? "melee").toLowerCase();
    const baseReach = getWeaponBaseReachState(itemDoc, { attackMode, includeLegacyFallback: true });
    const effectiveReach = getWeaponReachBoundsEffective(itemDoc);

    data.weaponSheetPersistedReachMinValue = baseReach.min ?? 0;
    data.weaponSheetPersistedReachValue = baseReach.max ?? 0;
    data.weaponSheetHeaderReachValue = effectiveReach.max ?? data.weaponSheetPersistedReachValue;
  }

  // --------------------------------------------
  // Weapon / Armor: Enchantment display (read-only)
  // Written by the Enchanting Workshop; surfaced here for the item sheet Attributes tab.
  // --------------------------------------------
  if (itemType === "weapon" || itemType === "armor" || itemType === "shield" || itemType === "ammunition" || itemType === "equipment" || itemType === "item") {
    const enc = itemDoc?.flags?.["uesrpg-3ev4"]?.enchanting ?? null;
    data.uiSpellcastingConfig = await _buildSpellcastingUiConfig(itemDoc);
    if (enc?.version === 2 && enc.enchantType) {
      data.enchantmentDisplay = _buildEnchantmentDisplay(enc, itemDoc);
    } else {
      data.enchantmentDisplay = null;
    }
  } else if (itemType === "scroll") {
    data.uiSpellcastingConfig = await _buildSpellcastingUiConfig(itemDoc);
  }

  // --------------------------------------------
  // Generic Item: Alchemy ingredient data (flag-based)
  // Identifies items that serve as alchemy ingredients via flags["uesrpg-3ev4"].alchemy.
  // --------------------------------------------
  if (itemType === "equipment" || itemType === "item") {
    const alchemyFlags = itemDoc?.flags?.["uesrpg-3ev4"]?.alchemy ?? null;
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
              const label = String(e.effectLabel ?? e.spellName ?? "").trim();
              return {
                key: String(e.effectKey ?? ""),
                label: label || def?.label || String(e.effectKey ?? e.spellUuid ?? ""),
                school: String(e.school ?? def?.school ?? ""),
                spellLevel: Number(e.spellLevel ?? 1),
                effectSource: String(e.effectSource ?? "catalog"),
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
        effectSlots: buildAlchemyProductEffectSlots(itemDoc, actorDoc),
        canManageEffects: Boolean(data.editable && itemDoc?.isOwner !== false),
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
        const localizedCatalogEntry = localizeStrikeEnchantment(catalogEntry);
        return {
          label: localizedCatalogEntry.label,
          paramSummary: _buildParamSummary(localizedCatalogEntry, e),
        };
      })
      .filter(Boolean);
  } else if (enc.enchantType === "cast") {
    const castPool = enc.cast?.pool ?? { value: chargeValue, max: chargeMax };
    const spellRows = Array.isArray(enc.cast?.spells) ? enc.cast.spells : [];
    effects = spellRows.map((s) => ({
      label: String(s?.label ?? "Stored Spell"),
      paramSummary: `${_formatSpellcastingCostSummary(s)}, BS ${Number(s?.bindingStrength ?? 0)}`
    }));
    if (!effects.length) {
      effects = [{ label: "No stored spells", paramSummary: "" }];
    }
    return {
      typeLabel,
      useCharges: true,
      chargeValue: Number(castPool.value ?? chargeValue ?? 0),
      chargeMax: Number(castPool.max ?? chargeMax ?? 0),
      effects
    };
  } else if (enc.enchantType === "constant") {
    effects = [{ label: "See Enchanting Workshop for effect details", paramSummary: "" }];
  }

  return { typeLabel, useCharges, chargeValue, chargeMax, effects };
}

function _normalizeCostMode(value) {
  const raw = String(value ?? "soul").trim().toLowerCase();
  if (raw === "magicka" || raw === "none") return raw;
  return "soul";
}

function _normalizeSkipCastingTest(value) {
  return value !== false;
}

function _formatSpellcastingCostSummary(slot) {
  const mode = _normalizeCostMode(slot?.costMode);
  if (mode === "magicka") return "MP";
  if (mode === "none") return "No Cost";
  return `Soul ${Number(slot?.cost ?? 0)}`;
}

async function _buildSpellcastingUiConfig(item) {
  const flags = item?.flags?.["uesrpg-3ev4"] ?? {};
  const ext = flags?.itemSpellcasting ?? {};
  const legacy = flags?.enchanting?.cast ?? {};
  const legacyType = String(flags?.enchanting?.enchantType ?? "").trim().toLowerCase();
  const usingLegacyExtensionData = !Object.keys(ext ?? {}).length && legacyType !== "cast"
    && (Object.prototype.hasOwnProperty.call(legacy, "isSpellcastingEnabled") || Array.isArray(legacy?.spells));
  const source = usingLegacyExtensionData ? legacy : ext;
  const slots = Array.isArray(source?.slots) ? source.slots : (Array.isArray(source?.spells) ? source.spells : []);
  const enabled = source?.enabled === true;
  const usesChargePool = !usingLegacyExtensionData;
  const poolValue = usesChargePool
    ? Number(item?.system?.charge?.value ?? source?.pool?.value ?? 0)
    : Number(source?.pool?.value ?? item?.system?.charge?.value ?? 0);
  const poolMax = usesChargePool
    ? Number(item?.system?.charge?.max ?? source?.pool?.max ?? 0)
    : Number(source?.pool?.max ?? item?.system?.charge?.max ?? 0);
  const modeOptions = {
    soul: "Soul Energy",
    magicka: "Magicka",
    none: "No Cost"
  };
  const actor = item?.actor ?? null;
  const canSelectKnownSpells = !!actor;
  const noSpellHint = canSelectKnownSpells
    ? t("UESRPG.Sheets.Item.NoActorSpellsAvailable", "No actor-owned spells available.")
    : t("UESRPG.Sheets.Item.StoredSpellSelectDisabledHint", "Attach this item to an actor to choose from owned spells.");
  const preparedSlots = await Promise.all(slots.map(async (slot, index) => {
    const snapshot = slot?.snapshot && typeof slot.snapshot === "object" ? slot.snapshot : null;
    const spellState = await buildStoredSpellOptionState({
      actor,
      selectedUuid: String(slot?.spellUuid ?? "").trim(),
      storedSpellSnapshot: snapshot,
      slot
    });
    const spellLike = spellState?.resolvedSpell ?? snapshot ?? null;
    const prevAttributes = Array.isArray(slot?.attributes) ? slot.attributes.join(", ") : String(slot?.attributes ?? "");
    const levelOptions = _buildStoredSpellLevelOptions(spellLike, slot?.level ?? snapshot?.system?.level ?? 1);
    const statusClass = String(spellState?.statusClass ?? "").trim() || (spellState?.hasStoredSpell ? "stored" : "unassigned");
    const skipCastingTest = _normalizeSkipCastingTest(slot?.skipCastingTest);
    return {
      index,
      id: String(slot?.id ?? ""),
      enabled: slot?.enabled !== false,
      skipCastingTest,
      source: String(slot?.source ?? "conventional").trim().toLowerCase() === "unconventional" ? "unconventional" : "conventional",
      label: String(slot?.label ?? spellState.selectedSpellName ?? snapshot?.name ?? "Stored Spell"),
      spellUuid: String(slot?.spellUuid ?? ""),
      actorSpellItemId: String(slot?.actorSpellItemId ?? ""),
      spellOptions: spellState.options,
      selectedSpellUuid: spellState.selectedUuid,
      selectedSpellName: spellState.selectedSpellName,
      selectedSpellLabel: spellState.selectedSpellLabel,
      selectedSpellSummary: spellState.selectedSpellSummary,
      hasSelectedSpellOption: Boolean(spellState.selectedOption),
      level: _coerceStoredSpellLevel(slot?.level ?? snapshot?.system?.level ?? 1, levelOptions),
      levelOptions,
      hasLevelOptions: levelOptions.length > 0,
      cost: Number(slot?.cost ?? snapshot?.system?.cost ?? 0),
      bindingStrength: Number(slot?.bindingStrength ?? 0),
      costMode: _normalizeCostMode(slot?.costMode),
      costSummary: _formatSpellcastingCostSummary(slot),
      castTestStatusLabel: skipCastingTest
        ? t("UESRPG.Sheets.Item.SkipCastingTestStatus", "No test")
        : t("UESRPG.Sheets.Item.CastingTestRequiredStatus", "Test required"),
      castTestSummary: skipCastingTest
        ? t("UESRPG.Sheets.Item.SkipCastingTestSummary", "Cast enchantment skips the casting test.")
        : t("UESRPG.Sheets.Item.CastingTestRequiredSummary", "Cast enchantment uses the normal casting test."),
      attributesText: prevAttributes,
      isResolved: spellState.resolvedSpell != null,
      isStored: statusClass === "stored",
      isMissing: statusClass === "missing",
      isUnassigned: statusClass === "unassigned",
      isSelectable: spellState.canSelectKnownSpells,
      canPick: spellState.canSelectKnownSpells,
      availableSpellCount: spellState.availableSpellCount,
      dropZoneHint: spellState.hasStoredSpell
        ? t("UESRPG.Sheets.Item.StoredSpellReplaceHint", "Drop another spell here to replace it.")
        : t("UESRPG.Sheets.Item.StoredSpellDropHint", "Drop a spell here to store it."),
      storedSpellStatusLabel: spellState.statusLabel || (spellState.resolvedSpell
        ? t("UESRPG.Sheets.Item.StoredSpellResolved", "Resolved")
        : (statusClass === "missing"
          ? t("UESRPG.Sheets.Item.StoredSpellMissing", "Missing / unresolved")
          : (statusClass === "stored"
            ? t("UESRPG.Sheets.Item.StoredSpellStored", "Stored snapshot")
            : t("UESRPG.Sheets.Item.NoSpellSelectedYet", "No spell selected yet")))),
      statusLabel: spellState.statusLabel || (spellState.resolvedSpell
        ? t("UESRPG.Sheets.Item.StoredSpellResolved", "Resolved")
        : (statusClass === "missing"
          ? t("UESRPG.Sheets.Item.StoredSpellMissing", "Missing / unresolved")
          : (statusClass === "stored"
            ? t("UESRPG.Sheets.Item.StoredSpellStored", "Stored snapshot")
            : t("UESRPG.Sheets.Item.NoSpellSelectedYet", "No spell selected yet")))),
      noSpellHint,
    };
  }));
  return {
    canConfigure: true,
    enabled,
    hasLegacyCastEnchantment: flags?.enchanting?.version === 2 && legacyType === "cast",
    usingLegacyExtensionData,
    poolValue,
    poolMax,
    modeOptions,
    sourceOptions: {
      conventional: t("UESRPG.Sheets.Item.ConventionalStoredSpell", "Conventional"),
      unconventional: t("UESRPG.Sheets.Item.UnconventionalStoredSpell", "Unconventional"),
    },
    slots: preparedSlots,
    hasSlots: slots.length > 0,
    canCast: enabled && slots.some((s) => s?.enabled !== false),
    canSelectKnownSpells,
    noSpellHint,
  };
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
    parts.push(`${catalogEntry.paramLabels?.sl ?? "SL"} ${effectEntry.sl}`);
  }
  if (effectEntry.y != null && catalogEntry.paramKeys?.includes("y")) {
    parts.push(`${catalogEntry.paramLabels?.y ?? "Amount"} ${effectEntry.y}`);
  }
  if (effectEntry.type != null && catalogEntry.paramKeys?.includes("type")) {
    parts.push(`${catalogEntry.paramLabels?.type ?? "Target"}: ${effectEntry.type}`);
  }
  return parts.join(", ");
}
