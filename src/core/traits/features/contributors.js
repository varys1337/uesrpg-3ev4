/**
 * @module traits/features/contributors
 * @description Emit FeatureMods for Trait, Talent, and Power items.
 *
 * Consolidated from the former `trait-contributors.js`, `talent-contributors.js`,
 * and `power-contributors.js`.  Shared constants (`ITEM_BONUS_FIELDS`,
 * `RESIST_FIELDS`) and shared helpers (`_emitItemBonusMods`,
 * `_emitCharacteristicOverrides`) are now defined once.
 *
 * Design invariants:
 *  - Pure read — never mutates documents.
 *  - Deterministic — same items in → same mods out.
 *  - Follows Chapter 4 stacking rules.
 *
 * Target: Foundry VTT v13.351
 */

import { makeFeatureMod, FEATURE_DOMAINS, STACKING_MODES, normalizeFeatureKey } from "./feature-mod.js";
import { getTalentItem, hasTalent, normalizeTalentKey, resolveTalentSlug } from "../talents-api.js";
import { canApplyCharGenGatedImperialTalents } from "../racial-talents.js";
import { getTraitNumericBonuses } from "../trait-registry.js";
import { isPassiveFeatureActive } from "./feature-config.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Shared constants
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Item-level numeric bonus fields shared by traits, talents, and powers.
 * Each entry maps an item `system.*` field to a FeatureMod domain + path.
 * @type {ReadonlyArray<{field: string, domain: string, path: string, stacking: string}>}
 */
const ITEM_BONUS_FIELDS = Object.freeze([
  { field: "hpBonus",     domain: FEATURE_DOMAINS.HP,              path: "system.hp.bonus",              stacking: STACKING_MODES.ADD },
  { field: "mpBonus",     domain: FEATURE_DOMAINS.MP,              path: "system.magicka.bonus",         stacking: STACKING_MODES.ADD },
  { field: "spBonus",     domain: FEATURE_DOMAINS.SP,              path: "system.stamina.bonus",         stacking: STACKING_MODES.ADD },
  { field: "lpBonus",     domain: FEATURE_DOMAINS.LP,              path: "system.luck_points.bonus",     stacking: STACKING_MODES.ADD },
  { field: "wtBonus",     domain: FEATURE_DOMAINS.WOUND_THRESHOLD, path: "system.wound_threshold.bonus", stacking: STACKING_MODES.ADD },
  { field: "speedBonus",  domain: FEATURE_DOMAINS.SPEED,           path: "system.speed.bonus",           stacking: STACKING_MODES.ADD },
  { field: "iniBonus",    domain: FEATURE_DOMAINS.INITIATIVE,      path: "system.initiative.bonus",      stacking: STACKING_MODES.ADD },
  { field: "swimBonus",   domain: FEATURE_DOMAINS.SPEED,           path: "system.speed.swimBonus",       stacking: STACKING_MODES.ADD },
  { field: "flyBonus",    domain: FEATURE_DOMAINS.SPEED,           path: "system.speed.flyBonus",        stacking: STACKING_MODES.ADD },
]);

/**
 * Resistance fields shared by traits, talents, and powers.
 * @type {ReadonlyArray<{field: string, path: string}>}
 */
const RESIST_FIELDS = Object.freeze([
  { field: "natToughnessR", path: "system.resistance.natToughness" },
  { field: "diseaseR",  path: "system.resistance.diseaseR"  },
  { field: "fireR",     path: "system.resistance.fireR"     },
  { field: "frostR",    path: "system.resistance.frostR"    },
  { field: "shockR",    path: "system.resistance.shockR"    },
  { field: "poisonR",   path: "system.resistance.poisonR"   },
  { field: "magicR",    path: "system.resistance.magicR"    },
  { field: "silverR",   path: "system.resistance.silverR"   },
  { field: "sunlightR", path: "system.resistance.sunlightR" },
]);


// ═══════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Emit FeatureMods for item-level bonus fields (hpBonus, resistances, etc.).
 * Used by all three contributor types.
 *
 * @param {Item}   item   - The item to read bonus fields from.
 * @param {object} source - FeatureMod source descriptor.
 * @returns {FeatureMod[]}
 */
function _emitItemBonusMods(item, source) {
  const traitBonuses = getTraitNumericBonuses(item);
  const sys = { ...(item?.system ?? {}), ...traitBonuses };
  const mods = [];
  const itemNameKey = normalizeFeatureKey(item.name ?? "");

  if (["stunted-magicka", "stunted-magica"].includes(itemNameKey)) {
    mods.push(makeFeatureMod({
      domain: FEATURE_DOMAINS.FLAG,
      path: "flag.stuntedMagicka",
      mode: "boolean",
      value: true,
      source,
      rule: { chapter: 4, name: "Stunted Magicka", stacking: STACKING_MODES.ANY },
    }));
  }

  for (const { field, domain, path, stacking } of ITEM_BONUS_FIELDS) {
    const val = Number(sys[field] ?? 0);
    if (!Number.isFinite(val) || val === 0) continue;
    mods.push(makeFeatureMod({
      domain,
      path,
      mode: "add",
      value: val,
      source,
      rule: { chapter: 4, name: `${item.name}: ${field}`, stacking: Object.hasOwn(traitBonuses, field)
        && field !== "mpBonus" ? STACKING_MODES.HIGHEST : stacking },
    }));
  }

  for (const { field, path } of RESIST_FIELDS) {
    const val = Number(sys[field] ?? 0);
    if (!Number.isFinite(val) || val === 0) continue;
    mods.push(makeFeatureMod({
      domain: FEATURE_DOMAINS.RESISTANCE,
      path,
      mode: "add",
      value: val,
      source,
      rule: { chapter: 4, name: `${item.name}: ${field}`, stacking: field === "natToughnessR" ? STACKING_MODES.HIGHEST : STACKING_MODES.ADD },
    }));
  }

  return mods;
}

/**
 * (#3) Emit FeatureMods for ONLY non-resistance item bonus fields (hpBonus, speedBonus, etc.).
 * Used by trait contributors when the category resolves via traitKey, so that non-resistance
 * bonus fields (hpBonus, etc.) are not silently dropped alongside the category-specific emission.
 *
 * @param {Item}   item   - The item to read bonus fields from.
 * @param {object} source - FeatureMod source descriptor.
 * @returns {FeatureMod[]}
 */
function _emitNonResistBonusMods(item, source) {
  const traitBonuses = getTraitNumericBonuses(item);
  const sys = { ...(item?.system ?? {}), ...traitBonuses };
  const mods = [];

  for (const { field, domain, path, stacking } of ITEM_BONUS_FIELDS) {
    const val = Number(sys[field] ?? 0);
    if (!Number.isFinite(val) || val === 0) continue;
    mods.push(makeFeatureMod({
      domain,
      path,
      mode: "add",
      value: val,
      source,
      rule: { chapter: 4, name: `${item.name}: ${field}`, stacking: Object.hasOwn(traitBonuses, field)
        && field !== "mpBonus" ? STACKING_MODES.HIGHEST : stacking },
    }));
  }

  return mods;
}

/**
 * Emit characteristic-replacement override mods (IR / WT characteristic swap).
 * Shared by talents and powers.
 *
 * @param {object} sys    - `item.system`
 * @param {Item}   item   - The item (for name).
 * @param {object} source - FeatureMod source descriptor.
 * @param {FeatureMod[]} mods - Array to push into (mutated).
 */
function _emitCharacteristicOverrides(sys, item, source, mods) {
  if (sys.replace?.ini?.characteristic && sys.replace.ini.characteristic !== "none") {
    mods.push(makeFeatureMod({
      domain: FEATURE_DOMAINS.INITIATIVE,
      path: "system.initiative.replaceCharacteristic",
      mode: "set",
      value: sys.replace.ini.characteristic,
      source,
      rule: { chapter: 4, name: `${item.name}: IR uses ${sys.replace.ini.characteristic}`, stacking: STACKING_MODES.OVERRIDE },
    }));
  }

  if (sys.replace?.wt?.characteristic && sys.replace.wt.characteristic !== "none") {
    mods.push(makeFeatureMod({
      domain: FEATURE_DOMAINS.WOUND_THRESHOLD,
      path: "system.wound_threshold.replaceCharacteristic",
      mode: "set",
      value: sys.replace.wt.characteristic,
      source,
      rule: { chapter: 4, name: `${item.name}: WT uses ${sys.replace.wt.characteristic}`, stacking: STACKING_MODES.OVERRIDE },
    }));
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Trait contributor
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Exported so that the stacking reducer and inspector can reference these.
 */
export const TRAIT_STACKING_META = Object.freeze({
  "resistance.physical":   { stacking: STACKING_MODES.HIGHEST, label: "Resistance (Physical)" },
  "resistance.fire":       { stacking: STACKING_MODES.HIGHEST, label: "Resistance (Fire)" },
  "resistance.frost":      { stacking: STACKING_MODES.HIGHEST, label: "Resistance (Frost)" },
  "resistance.shock":      { stacking: STACKING_MODES.HIGHEST, label: "Resistance (Shock)" },
  "resistance.poison":     { stacking: STACKING_MODES.HIGHEST, label: "Resistance (Poison)" },
  "resistance.magic":      { stacking: STACKING_MODES.HIGHEST, label: "Resistance (Magic)" },
  "resistance.silver":     { stacking: STACKING_MODES.HIGHEST, label: "Resistance (Silver)" },
  "resistance.sunlight":   { stacking: STACKING_MODES.HIGHEST, label: "Resistance (Sunlight)" },
  "resistance.disease":    { stacking: STACKING_MODES.HIGHEST, label: "Disease Resistance" },

  "weakness.physical":     { stacking: STACKING_MODES.HIGHEST, label: "Weakness (Physical)" },
  "weakness.fire":         { stacking: STACKING_MODES.HIGHEST, label: "Weakness (Fire)" },
  "weakness.frost":        { stacking: STACKING_MODES.HIGHEST, label: "Weakness (Frost)" },
  "weakness.shock":        { stacking: STACKING_MODES.HIGHEST, label: "Weakness (Shock)" },
  "weakness.poison":       { stacking: STACKING_MODES.HIGHEST, label: "Weakness (Poison)" },
  "weakness.magic":        { stacking: STACKING_MODES.HIGHEST, label: "Weakness (Magic)" },
  "weakness.silver":       { stacking: STACKING_MODES.HIGHEST, label: "Weakness (Silver)" },
  "weakness.sunlight":     { stacking: STACKING_MODES.HIGHEST, label: "Weakness (Sunlight)" },
  "weakness.disease":      { stacking: STACKING_MODES.HIGHEST, label: "Weakness (Disease)" },

  "immunity":              { stacking: STACKING_MODES.ANY, label: "Immunity" },

  "flag.undead":           { stacking: STACKING_MODES.ANY, label: "Undead" },
  "flag.skeletal":         { stacking: STACKING_MODES.ANY, label: "Skeletal" },
  "flag.incorporeal":      { stacking: STACKING_MODES.ANY, label: "Incorporeal" },
  "flag.undeadBloodless":  { stacking: STACKING_MODES.ANY, label: "Undead (Bloodless)" },
  "flag.stuntedMagicka":   { stacking: STACKING_MODES.ANY, label: "Stunted Magicka" },
});

// ─── Trait damage type maps ──────────────────────────────────────────

const RESISTANCE_KEY_MAP = {
  physical:  "physicalR",
  fire:      "fireR",
  frost:     "frostR",
  shock:     "shockR",
  poison:    "poisonR",
  magic:     "magicR",
  silver:    "silverR",
  sunlight:  "sunlightR",
  disease:   "diseaseR",
};

// ─── Trait key parsing ───────────────────────────────────────────────

const CATEGORY_KEYS = ["resistance", "weakness", "immunity"];

const PHYSICAL_ALIASES = new Set(["normalweapons", "normalweapon", "physical"]);

const DAMAGE_TYPES = new Set([
  "physical", "fire", "frost", "shock", "poison", "magic", "silver", "sunlight", "disease",
]);

const TRAIT_CONDITION_TYPES = new Set([
  "blinded", "deafened", "crippled", "silenced", "stunned", "dazed",
  "entangled", "hidden", "prone", "bleeding", "burning", "poisoned",
  "panic", "horror", "paralysis",
]);

function _norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

function _normFlat(v) {
  return _norm(v).replace(/[\s._-]+/g, "");
}

function _parseCategory(raw) {
  const flat = _normFlat(raw);
  return CATEGORY_KEYS.includes(flat) ? flat : "";
}

function _parseDamageType(raw) {
  const flat = _normFlat(raw);
  if (!flat) return "";
  if (PHYSICAL_ALIASES.has(flat)) return "physical";
  return DAMAGE_TYPES.has(flat) ? flat : "";
}

function _parseConditionType(raw) {
  const flat = _normFlat(raw);
  return TRAIT_CONDITION_TYPES.has(flat) ? flat : "";
}

/**
 * Emit FeatureMods for a single Trait item.
 *
 * @param {Actor}  actor  The owning actor (for context, not mutated).
 * @param {Item}   item   The trait item.
 * @returns {FeatureMod[]}
 */
export function contributeTraitMods(actor, item) {
  if (!item || String(item.type ?? "") !== "trait") return [];

  const sys = item.system ?? {};
  const traitKey = _norm(sys.traitKey ?? "");
  const traitParam = _norm(sys.traitParam ?? "");
  const keyFlat = _normFlat(traitKey);
  const paramFlat = _normFlat(traitParam);
  const traitValue = Number(sys.traitValue);

  const source = {
    type: "trait",
    key: normalizeFeatureKey(`${traitKey}.${traitParam}`),
    itemName: item.name ?? "",
    itemUuid: item.uuid ?? "",
    itemId: item.id ?? "",
  };

  const mods = [];

  // ── Incorporeal flag ──
  if (_normFlat(traitKey).includes("incorporeal") || _normFlat(traitParam) === "incorporeal") {
    mods.push(makeFeatureMod({
      domain: FEATURE_DOMAINS.FLAG,
      path: "flag.incorporeal",
      mode: "boolean",
      value: true,
      source,
      rule: { chapter: 4, name: "Incorporeal", stacking: STACKING_MODES.ANY },
    }));
    // (#3) Also emit non-resistance bonus fields (hpBonus, speedBonus, etc.)
    // so they are not silently dropped when the flag takes the early return.
    mods.push(..._emitNonResistBonusMods(item, source));
    return mods;
  }

  // ── Undead / Skeletal / Bloodless flags ──
  if (keyFlat === "undead" || keyFlat.includes("undead")) {
    mods.push(makeFeatureMod({
      domain: FEATURE_DOMAINS.FLAG,
      path: "flag.undead",
      mode: "boolean",
      value: true,
      source,
      rule: { chapter: 4, name: "Undead", stacking: STACKING_MODES.ANY },
    }));

    if (paramFlat === "bloodless" || keyFlat.includes("bloodless")) {
      mods.push(makeFeatureMod({
        domain: FEATURE_DOMAINS.FLAG,
        path: "flag.undeadBloodless",
        mode: "boolean",
        value: true,
        source,
        rule: { chapter: 4, name: "Undead (Bloodless)", stacking: STACKING_MODES.ANY },
      }));
    }
  }

  if (keyFlat === "skeletal" || keyFlat.includes("skeletal")) {
    mods.push(makeFeatureMod({
      domain: FEATURE_DOMAINS.FLAG,
      path: "flag.skeletal",
      mode: "boolean",
      value: true,
      source,
      rule: { chapter: 4, name: "Skeletal", stacking: STACKING_MODES.ANY },
    }));
  }

  // ── Disease Resistance (percentage, non-damage-type) ──
  if (keyFlat.includes("diseaseresistance") || (keyFlat === "diseaseresistance")) {
    const pct = Number.isFinite(traitValue) ? traitValue : 0;
    if (pct > 0) {
      mods.push(makeFeatureMod({
        domain: FEATURE_DOMAINS.RESISTANCE,
        path: "system.resistance.diseaseR",
        mode: "add",
        value: pct,
        source,
        rule: { chapter: 4, name: "Disease Resistance (%)", stacking: STACKING_MODES.HIGHEST },
      }));
    }
    // (#3) Also emit non-resistance bonus fields alongside the disease resistance.
    mods.push(..._emitNonResistBonusMods(item, source));
    return mods;
  }

  // ── Parse category.type (resistance/weakness/immunity) ──
  let category = "";
  let typeRaw = "";

  if (traitKey.includes(".") || traitKey.includes("/") || traitKey.includes(":")) {
    const parts = traitKey.replace(/[/:]+/g, ".").split(".");
    category = _parseCategory(parts[0]);
    typeRaw = parts.slice(1).join(".");
  } else {
    category = _parseCategory(traitKey);
    typeRaw = traitParam;
  }

  if (!category) {
    // Not a standard resistance/weakness/immunity trait — emit item bonus mods
    return _emitItemBonusMods(item, source);
  }

  // ── Immunity ──
  if (category === "immunity") {
    const dmgType = _parseDamageType(typeRaw);
    const condType = dmgType ? "" : _parseConditionType(typeRaw);

    if (dmgType) {
      mods.push(makeFeatureMod({
        domain: FEATURE_DOMAINS.IMMUNITY,
        path: `immunity.${dmgType}`,
        mode: "boolean",
        value: true,
        source,
        rule: { chapter: 4, name: `Immunity (${dmgType})`, stacking: STACKING_MODES.ANY },
      }));
    } else if (condType) {
      mods.push(makeFeatureMod({
        domain: FEATURE_DOMAINS.IMMUNITY,
        path: `immunity.condition.${condType}`,
        mode: "boolean",
        value: true,
        source,
        rule: { chapter: 4, name: `Immunity (${condType})`, stacking: STACKING_MODES.ANY },
      }));
    }
    // (#3) Also emit non-resistance bonus fields alongside immunity.
    mods.push(..._emitNonResistBonusMods(item, source));
    return mods;
  }

  // ── Resistance / Weakness (X-trait) ──
  const damageType = _parseDamageType(typeRaw);
  if (!damageType) {
    return _emitItemBonusMods(item, source);
  }

  if (!Number.isFinite(traitValue) || traitValue === 0) {
    // (#3) Still emit non-resistance bonus fields even if trait value is zero.
    mods.push(..._emitNonResistBonusMods(item, source));
    return mods;
  }

  const metaKey = `${category}.${damageType}`;
  const meta = TRAIT_STACKING_META[metaKey];
  const stacking = meta?.stacking ?? STACKING_MODES.HIGHEST;

  const resKey = RESISTANCE_KEY_MAP[damageType];
  const pathSuffix = resKey ?? `${damageType}R`;

  if (category === "resistance") {
    mods.push(makeFeatureMod({
      domain: FEATURE_DOMAINS.RESISTANCE,
      path: `system.resistance.${pathSuffix}`,
      mode: "add",
      value: traitValue,
      source,
      rule: { chapter: 4, name: meta?.label ?? `Resistance (${damageType})`, stacking },
    }));
  } else if (category === "weakness") {
    mods.push(makeFeatureMod({
      domain: FEATURE_DOMAINS.WEAKNESS,
      path: `system.weakness.${pathSuffix}`,
      mode: "add",
      value: traitValue,
      source,
      rule: { chapter: 4, name: meta?.label ?? `Weakness (${damageType})`, stacking },
    }));
  }

  // (#3) Emit non-resistance bonus fields alongside category-specific mods.
  // This ensures hpBonus, speedBonus, etc. are not lost when the trait resolves
  // to a resistance/weakness/immunity category via traitKey.
  mods.push(..._emitNonResistBonusMods(item, source));

  return mods;
}


// ═══════════════════════════════════════════════════════════════════════════════
// Talent contributor
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * (#6) Racial talent passive effects (Chapter 4).
 * Numeric bonuses that were previously hardcoded in `applyRacialTalentDerivedBonuses()`
 * are now emitted as FeatureMods for Feature Inspector visibility and proper stacking.
 *
 * Non-numeric effects (disease immunity flag, Histskin swim×2) remain in racial-talents.js.
 * Imperial talents (Red Diamond / Imperial Luck) compute dynamically in contributeTalentMods.
 */
const RACIAL_TALENT_EFFECTS = Object.freeze({
  "childofthesap": [
    { domain: FEATURE_DOMAINS.SPEED, path: "system.speed.bonus", mode: "add", value: 1, stacking: STACKING_MODES.ADD, label: "Child of the Sap (+1 Speed)" },
  ],
  "naturesblessing": [
    { domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.diseaseR", mode: "add", value: 25, stacking: STACKING_MODES.ADD, label: "Nature's Blessing (+25 Disease R)" },
    { domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.poisonR", mode: "add", value: 1, stacking: STACKING_MODES.ADD, label: "Nature's Blessing (+1 Poison R)" },
  ],
  "sonsofskyrim": [
    { domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.frostR", mode: "add", value: 1, stacking: STACKING_MODES.ADD, label: "Sons of Skyrim (+1 Frost R)" },
    { domain: FEATURE_DOMAINS.WOUND_THRESHOLD, path: "system.wound_threshold.bonus", mode: "add", value: 1, stacking: STACKING_MODES.ADD, label: "Sons of Skyrim (+1 WT)" },
  ],
});

function _singleActiveTalent(actor, slug) {
  const matches = Array.from(actor?.items ?? []).filter(item => item?.type === "talent"
    && isPassiveFeatureActive(item) && resolveTalentSlug(item.name) === slug);
  return matches.length === 1 ? matches[0] : null;
}

const RACIAL_BASE_TRAIT_NAMES = Object.freeze({
  resilient: /^resilient(?:-\d+)?(?:-racial)?$/,
  tough: /^tough(?:-\d+)?(?:-racial)?$/,
  powerwell: /^power-well(?:-\d+)?(?:-racial)?$/,
  diseaseresistance: /^disease-resistance(?:-\d+)?(?:-racial)?$/,
});

function _singleActiveNamedTrait(actor, trait) {
  const matches = Array.from(actor?.items ?? []).filter(item => {
    if (item?.type !== "trait" || !isPassiveFeatureActive(item)) return false;
    const name = normalizeTalentKey(item.name);
    const key = normalizeTalentKey(item.system?.traitKey).replaceAll("-", "");
    return key === trait || RACIAL_BASE_TRAIT_NAMES[trait]?.test(name) === true;
  });
  return matches.length === 1 ? matches[0] : null;
}

function _singleActiveResistance(actor, type) {
  const pattern = type === "poison" ? /^resistance-poison(?:-\d+)?(?:-racial)?$/
    : type === "magic" ? /^resistance-magic(?:-\d+)?(?:-racial)?$/
      : type === "frost" ? /^resistance-frost(?:-\d+)?(?:-racial)?$/ : null;
  if (!pattern) return null;
  const matches = Array.from(actor?.items ?? []).filter(item => {
    if (item?.type !== "trait" || !isPassiveFeatureActive(item)) return false;
    const name = normalizeTalentKey(item.name);
    const key = normalizeTalentKey(item.system?.traitKey);
    const param = normalizeTalentKey(item.system?.traitParam);
    return pattern.test(name) || key === `resistance-${type}` || (key === "resistance" && param === type);
  });
  return matches.length === 1 ? matches[0] : null;
}

function _resistanceTraitValue(item, field) {
  const key = normalizeTalentKey(item?.system?.traitKey);
  return Number(key ? item?.system?.traitValue : item?.system?.[field]);
}

function _diseaseTraitValue(item) {
  const key = normalizeTalentKey(item?.system?.traitKey).replaceAll("-", "");
  return Number(key === "diseaseresistance" ? item?.system?.traitValue : item?.system?.diseaseR);
}

function _racialPassiveIsEligible(actor, item, slug, effect) {
  const selected = _singleActiveTalent(actor, slug);
  if (!selected || (selected !== item && selected.id !== item.id)) return false;
  const sys = item.system ?? {};
  if (slug === "childofthesap") return Number(sys.speedBonus ?? 0) === 0;
  if (slug === "naturesblessing" && effect.path === "system.resistance.diseaseR") {
    return Number(sys.diseaseR ?? 0) === 0 && _diseaseTraitValue(_singleActiveNamedTrait(actor, "diseaseresistance")) === 50;
  }
  if (slug === "naturesblessing" && effect.path === "system.resistance.poisonR") {
    return Number(sys.poisonR ?? 0) === 0 && _resistanceTraitValue(_singleActiveResistance(actor, "poison"), "poisonR") === 1;
  }
  if (slug === "sonsofskyrim" && effect.path === "system.resistance.frostR") {
    return Number(sys.frostR ?? 0) === 0 && _resistanceTraitValue(_singleActiveResistance(actor, "frost"), "frostR") === 2;
  }
  if (slug === "sonsofskyrim" && effect.path === "system.wound_threshold.bonus") {
    const tough = _singleActiveNamedTrait(actor, "tough");
    return Number(sys.wtBonus ?? 0) === 0 && Number(getTraitNumericBonuses(tough).wtBonus ?? tough?.system?.wtBonus) === 1;
  }
  return true;
}

/**
 * (#6) Helper: look up the Star of the West SP bonus from the actor's trait items.
 * The race menu's embedded trait carries a "(Racial)" suffix. A missing or
 * disabled trait must not give either upgrade an invented base to enhance.
 */
function _getStarOfTheWestBonus(actor) {
  if (!actor) return null;
  for (const it of (actor.items ?? [])) {
    if (!it || String(it.type ?? "") !== "trait" || !isPassiveFeatureActive(it)) continue;
    if (["star-of-the-west", "star-of-the-west-racial"].includes(normalizeTalentKey(it.name))) {
      const value = Number(it.system?.spBonus ?? 0);
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    }
  }
  return null;
}

/**
 * Talents with deterministic passive effects (Chapter 4).
 * Each entry maps a normalized talent slug to its contributions.
 */
const PASSIVE_TALENT_EFFECTS = {
  "untouchable": {
    note: "WT = 3×LB (override; computed in prepare)",
    domain: FEATURE_DOMAINS.WOUND_THRESHOLD,
    path: "system.wound_threshold.override",
    mode: "set",
    stacking: STACKING_MODES.OVERRIDE,
    label: "Untouchable (WT = 3×LB)",
  },
  "enduring": {
    note: "Halve fatigue penalties",
    domain: FEATURE_DOMAINS.MISC,
    path: "system.fatigue.halvePenalty",
    mode: "boolean",
    stacking: STACKING_MODES.ANY,
    label: "Enduring (halve fatigue penalties)",
    value: true,
  },
  "unstoppable": {
    note: "Halve passive wound penalties",
    domain: FEATURE_DOMAINS.MISC,
    path: "system.wounds.halvePenalty",
    mode: "boolean",
    stacking: STACKING_MODES.ANY,
    label: "Unstoppable (halve wound penalties)",
    value: true,
  },
  "wallofsteel": {
    note: "Ignore armor speed penalties",
    domain: FEATURE_DOMAINS.SPEED,
    path: "system.speed.ignoreArmorPenalty",
    mode: "boolean",
    stacking: STACKING_MODES.ANY,
    label: "Wall of Steel (ignore armor speed penalties)",
    value: true,
  },
};

/**
 * Emit FeatureMods for a single Talent item.
 *
 * @param {Actor}  actor  The owning actor (read-only context).
 * @param {Item}   item   The talent item.
 * @returns {FeatureMod[]}
 */
export function contributeTalentMods(actor, item) {
  if (!item || String(item.type ?? "") !== "talent") return [];

  const sys = item.system ?? {};
  const talentSlug = resolveTalentSlug(item.name);

  const source = {
    type: "talent",
    key: talentSlug,
    itemName: item.name ?? "",
    itemUuid: item.uuid ?? "",
    itemId: item.id ?? "",
  };

  const mods = [];

  // ── Item-level bonus fields ──
  mods.push(..._emitItemBonusMods(item, source));

  // ── Known passive effects ──
  const passiveEntry = PASSIVE_TALENT_EFFECTS[talentSlug];
  if (passiveEntry) {
    let value = passiveEntry.value;

    // Dynamic value for Untouchable: 3 × LB
    if (talentSlug === "untouchable") {
      const lckBonus = Math.max(0, Math.floor(Number(actor?.system?.characteristics?.lck?.total ?? 0) / 10));
      value = 3 * lckBonus;
    }

    if (value !== undefined && value !== null) {
      mods.push(makeFeatureMod({
        domain: passiveEntry.domain,
        path: passiveEntry.path,
        mode: passiveEntry.mode,
        value,
        source,
        rule: { chapter: 4, name: passiveEntry.label, stacking: passiveEntry.stacking },
      }));
    }
  }

  // ── (#6) Racial talent passive effects ──
  const racialSource = {
    type: "talent",
    key: `racial-talent:${talentSlug}`,
    itemName: item.name ?? "",
    itemUuid: item.uuid ?? "",
    itemId: item.id ?? "",
  };

  const racialEffects = RACIAL_TALENT_EFFECTS[talentSlug];
  if (racialEffects) {
    for (const effect of racialEffects) {
      if (!_racialPassiveIsEligible(actor, item, talentSlug, effect)) continue;
      mods.push(makeFeatureMod({
        domain: effect.domain,
        path: effect.path,
        mode: effect.mode,
        value: effect.value,
        source: racialSource,
        rule: { chapter: 4, name: effect.label, stacking: effect.stacking },
      }));
    }
  }

  // The standard Orsimer race supplies Resilient (3) and Tough (1). Only
  // calculate these upgrades when their base values and explicit talent bonus
  // fields are unambiguous; edited traits and duplicates need GM review.
  if (talentSlug === "wrothgarian" || talentSlug === "malacathsfury") {
    const selected = _singleActiveTalent(actor, talentSlug);
    const wrothgarian = _singleActiveTalent(actor, "wrothgarian");
    const resilient = _singleActiveNamedTrait(actor, "resilient");
    const resilientHp = Number(resilient?.system?.hpBonus);
    const explicitHp = Number(sys.hpBonus ?? 0);
    const wrothgarianHp = Number(wrothgarian?.system?.hpBonus ?? 0);
    const isSelected = selected && (selected === item || selected.id === item.id);
    if (isSelected && resilient && wrothgarian && explicitHp === 0) {
      const needsUpgrade = talentSlug === "wrothgarian"
        ? resilientHp === 3
        : (resilientHp === 3 && (wrothgarianHp === 0 || wrothgarianHp === 2))
          || (resilientHp === 5 && wrothgarianHp === 0);
      if (needsUpgrade) mods.push(makeFeatureMod({
        domain: FEATURE_DOMAINS.HP, path: "system.hp.bonus", mode: "add", value: 2,
        source: racialSource, rule: { chapter: 4, name: `${item.name} (+2 Resilient HP)`, stacking: STACKING_MODES.ADD },
      }));
    }
    if (talentSlug === "wrothgarian" && isSelected && Number(sys.wtBonus ?? 0) === 0) {
      const tough = _singleActiveNamedTrait(actor, "tough");
      const toughValue = Number(getTraitNumericBonuses(tough).wtBonus ?? tough?.system?.wtBonus);
      if (tough && toughValue === 1) mods.push(makeFeatureMod({
        domain: FEATURE_DOMAINS.WOUND_THRESHOLD, path: "system.wound_threshold.bonus", mode: "add", value: 1,
        source: racialSource, rule: { chapter: 4, name: "Wrothgarian (+1 Tough)", stacking: STACKING_MODES.ADD },
      }));
    }
  }

  if (talentSlug === "highmen") {
    const selected = _singleActiveTalent(actor, "highmen");
    const poison = _singleActiveResistance(actor, "poison");
    const poisonValue = _resistanceTraitValue(poison, "poisonR");
    if (selected && (selected === item || selected.id === item.id) && poison
      && poisonValue === 3 && Number(sys.poisonR ?? 0) === 0) {
      mods.push(makeFeatureMod({
        domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.poisonR", mode: "add", value: 1,
        source: racialSource, rule: { chapter: 4, name: "High Men (+1 Poison Resistance)", stacking: STACKING_MODES.ADD },
      }));
    }
  }

  if (talentSlug === "lionheart" || talentSlug === "bloodofaldmeris") {
    const selected = _singleActiveTalent(actor, talentSlug);
    const isSelected = selected && (selected === item || selected.id === item.id);
    if (isSelected) {
      const well = _singleActiveNamedTrait(actor, "powerwell");
      const wellValue = Number(getTraitNumericBonuses(well).mpBonus ?? well?.system?.mpBonus);
      const standardWell = talentSlug === "lionheart" ? 10 : 20;
      if (well && wellValue === standardWell && Number(sys.mpBonus ?? 0) === 0) {
        mods.push(makeFeatureMod({
          domain: FEATURE_DOMAINS.MP, path: "system.magicka.bonus", mode: "add", value: 10,
          source: racialSource, rule: { chapter: 4, name: `${item.name} (additional Power Well 10)`, stacking: STACKING_MODES.ADD },
        }));
      }
      if (talentSlug === "lionheart" && Number(sys.magicR ?? 0) === 0) {
        const resistance = _singleActiveResistance(actor, "magic");
        const value = _resistanceTraitValue(resistance, "magicR");
        if (resistance && value === 2) mods.push(makeFeatureMod({
          domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.magicR", mode: "add", value: 1,
          source: racialSource, rule: { chapter: 4, name: "Lionheart (+1 Magic Resistance)", stacking: STACKING_MODES.ADD },
        }));
      }
      if (talentSlug === "bloodofaldmeris" && Number(sys.diseaseR ?? 0) === 0) {
        const resistance = _singleActiveNamedTrait(actor, "diseaseresistance");
        const value = _diseaseTraitValue(resistance);
        if (resistance && value === 50) mods.push(makeFeatureMod({
          domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.diseaseR", mode: "add", value: 25,
          source: racialSource, rule: { chapter: 4, name: "Blood of Aldmeris (+25 Disease Resistance)", stacking: STACKING_MODES.ADD },
        }));
      }
    }
  }

  // (#6) Imperial: Red Diamond / Imperial Luck — dynamic SP computation
  if (talentSlug === "reddiamond" || talentSlug === "imperialluck") {
    const imperialSource = {
      type: "talent",
      key: `racial-talent:${talentSlug}`,
      itemName: item.name ?? "",
      itemUuid: item.uuid ?? "",
      itemId: item.id ?? "",
    };
    const gated = canApplyCharGenGatedImperialTalents(actor, {
      warnTalentName: talentSlug === "imperialluck" ? "Imperial Luck" : "Red Diamond"
    });
    const firstTalent = getTalentItem(actor, talentSlug);
    const isFirstTalent = firstTalent === item || Boolean(firstTalent?.id && firstTalent.id === item.id);
    const superseded = talentSlug === "reddiamond" && hasTalent(actor, "imperialluck");
    if (gated && isFirstTalent && !superseded) {
      const desiredFromStar = talentSlug === "imperialluck" ? 3 : 2;
      const currentFromStar = _getStarOfTheWestBonus(actor);
      const delta = currentFromStar == null ? 0 : Math.max(0, desiredFromStar - currentFromStar);
      if (delta > 0) {
        mods.push(makeFeatureMod({
          domain: FEATURE_DOMAINS.SP,
          path: "system.stamina.bonus",
          mode: "add",
          value: delta,
          source: imperialSource,
          rule: { chapter: 4, name: `${item.name} (+${delta} SP)`, stacking: STACKING_MODES.ADD },
        }));
      }
    }
  }

  // ── Characteristic bonus overrides ──
  _emitCharacteristicOverrides(sys, item, source, mods);

  return mods;
}


// ═══════════════════════════════════════════════════════════════════════════════
// Power contributor
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Emit FeatureMods for a single Power item.
 *
 * @param {Actor}  actor  The owning actor (read-only context).
 * @param {Item}   item   The power item.
 * @returns {FeatureMod[]}
 */
export function contributePowerMods(actor, item) {
  if (!item || String(item.type ?? "") !== "power") return [];

  const sys = item.system ?? {};

  const source = {
    type: "power",
    key: normalizeFeatureKey(item.name),
    itemName: item.name ?? "",
    itemUuid: item.uuid ?? "",
    itemId: item.id ?? "",
  };

  const mods = [];

  // ── Item-level bonus fields ──
  mods.push(..._emitItemBonusMods(item, source));

  // ── Characteristic bonus overrides ──
  _emitCharacteristicOverrides(sys, item, source, mods);

  return mods;
}
