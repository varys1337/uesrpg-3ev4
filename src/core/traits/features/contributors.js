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
import { normalizeTalentKey, resolveTalentSlug } from "../talents-api.js";
import { isREAuthoritative, getRuleElements } from "./rule-elements.js";
import { canApplyCharGenGatedImperialTalents } from "../racial-talents.js";

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
  const sys = item?.system ?? {};
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
      rule: { chapter: 4, name: `${item.name}: ${field}`, stacking },
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
      rule: { chapter: 4, name: `${item.name}: ${field}`, stacking: STACKING_MODES.ADD },
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
  const sys = item?.system ?? {};
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
      rule: { chapter: 4, name: `${item.name}: ${field}`, stacking },
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
// (#5) Rule Element authority helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check whether an item has an enabled Rule Element whose target matches a given
 * actor system path. When true, the hardcoded passive effect for that path should
 * yield (skip emission) so the RE-driven value takes precedence without stacking
 * conflicts.
 *
 * @param {Item}   item       - The feature item.
 * @param {string} targetPath - The actor system path (e.g. "system.wtBonus").
 * @returns {boolean}
 */
function _hasRECoveringPath(item, targetPath) {
  if (!item || !targetPath) return false;
  const elements = getRuleElements(item);
  if (!elements.length) return false;
  for (const el of elements) {
    if (el?.enabled === false) continue;
    const type = String(el?.type ?? "");
    if (type === "flatModifier" || type === "overrideValue" || type === "booleanFlag") {
      if (String(el?.target ?? "") === targetPath) return true;
    }
  }
  return false;
}

/**
 * Determine if a passive talent effect should be skipped because the item has
 * an RE that covers its path. Falls back to the broader `isREAuthoritative`
 * check as a safety net.
 *
 * @param {Item}   item          - The talent item.
 * @param {object} passiveEntry  - Entry from PASSIVE_TALENT_EFFECTS.
 * @returns {boolean} True if the hardcoded effect should yield to an RE.
 */
function _shouldYieldPassiveToRE(item, passiveEntry) {
  if (!item || !passiveEntry) return false;

  // Direct path match: if any RE targets the same path, yield.
  if (passiveEntry.path && _hasRECoveringPath(item, passiveEntry.path)) return true;

  // Broader check: if any RE of the matching family type exists, yield.
  if (passiveEntry.mode === "boolean" && isREAuthoritative(item, "booleanFlag")) return true;
  if (passiveEntry.mode === "set" && isREAuthoritative(item, "overrideValue")) return true;

  return false;
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
  const keyFlat = _normFlat(traitKey);
  const paramFlat = _normFlat(traitParam);

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
  "malacathsfury": [
    { domain: FEATURE_DOMAINS.HP, path: "system.hp.bonus", mode: "add", value: 2, stacking: STACKING_MODES.ADD, label: "Malacath's Fury (+2 HP)" },
  ],
});

/**
 * (#6) Helper: look up the Star of the West SP bonus from the actor's trait items.
 * Mirrors the logic previously in racial-talents.js `_getStarOfTheWestBonus`.
 */
function _getStarOfTheWestBonus(actor) {
  if (!actor) return 0;
  for (const it of (actor.items ?? [])) {
    if (!it || String(it.type ?? "") !== "trait") continue;
    if (normalizeTalentKey(it.name) === "star-of-the-west") {
      return Math.max(0, Number(it.system?.spBonus ?? 0));
    }
  }
  return 0;
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
  // (#5) Check RE authority: if the talent has an RE covering the same path,
  // skip the hardcoded emission (let the RE-driven value take precedence).
  const passiveEntry = PASSIVE_TALENT_EFFECTS[talentSlug];
  if (passiveEntry && !_shouldYieldPassiveToRE(item, passiveEntry)) {
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
    if (gated) {
      const desiredFromStar = talentSlug === "imperialluck" ? 3 : 2;
      const currentFromStar = _getStarOfTheWestBonus(actor);
      const delta = Math.max(0, desiredFromStar - currentFromStar);
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
