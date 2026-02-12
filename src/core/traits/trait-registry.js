/**
 * @module traits/trait-registry
 * @description Trait data registry — damage-type maps, resistance/weakness parsing,
 * and derived-data helpers for trait items.
 *
 * Target: Foundry VTT v13.351
 */

import { CONDITION_KEYS as CANONICAL_CONDITION_KEYS } from "../conditions/index.js";

const DAMAGE_TYPE_MAP = {
  // RAW: "Resistance (Normal Weapons, X)" is treated as Physical resistance.
  // We map it to a dedicated resistance lane (physicalR).
  physical: { label: "Physical", resistanceKey: "physicalR", damageType: "physical" },
  fire: { label: "Fire", resistanceKey: "fireR", damageType: "fire" },
  frost: { label: "Frost", resistanceKey: "frostR", damageType: "frost" },
  shock: { label: "Shock", resistanceKey: "shockR", damageType: "shock" },
  poison: { label: "Poison", resistanceKey: "poisonR", damageType: "poison" },
  magic: { label: "Magic", resistanceKey: "magicR", damageType: "magic" },
  silver: { label: "Silver", resistanceKey: "silverR", damageType: "silver" },
  sunlight: { label: "Sunlight", resistanceKey: "sunlightR", damageType: "sunlight" },
  disease: { label: "Disease", resistanceKey: "diseaseR", damageType: "disease" }
};

// Condition immunities (Immunity (Paralysis, Panic, Horror), etc.).
// These are not damage types; they gate application of ActiveEffect-backed conditions.
// NOTE: This is intentionally a conservative list matching the system condition keys.
const LEGACY_CONDITION_TYPE_MAP = {
  blinded: { label: "Blinded", conditionKey: "blinded" },
  deafened: { label: "Deafened", conditionKey: "deafened" },
  crippled: { label: "Crippled", conditionKey: "crippled" },
  silenced: { label: "Silenced", conditionKey: "silenced" },
  stunned: { label: "Stunned", conditionKey: "stunned" },
  dazed: { label: "Dazed", conditionKey: "dazed" },
  entangled: { label: "Entangled", conditionKey: "entangled" },
  hidden: { label: "Hidden", conditionKey: "hidden" },
  prone: { label: "Prone", conditionKey: "prone" },
  bleeding: { label: "Bleeding", conditionKey: "bleeding" },
  burning: { label: "Burning", conditionKey: "burning" },
  poisoned: { label: "Poisoned", conditionKey: "poisoned" },
  panic: { label: "Panic", conditionKey: "panic" },
  horror: { label: "Horror", conditionKey: "horror" },
  paralysis: { label: "Paralysis", conditionKey: "paralysis" }
};

function _humanizeConditionKey(key) {
  const raw = String(key ?? "").trim();
  if (!raw) return "";
  return raw
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

let _CONDITION_TYPE_MAP = null;
let _CONDITION_TYPE_MAP_SOURCE = "unset";

function _getConditionTypeMap() {
  let canonical = [];
  try {
    canonical = Array.isArray(CANONICAL_CONDITION_KEYS) ? CANONICAL_CONDITION_KEYS : [];
  } catch (_e) {
    canonical = [];
  }

  if (_CONDITION_TYPE_MAP && (_CONDITION_TYPE_MAP_SOURCE === "canonical" || !canonical.length)) {
    return _CONDITION_TYPE_MAP;
  }

  if (canonical.length) {
    const map = {};
    for (const key of canonical) {
      const k = String(key ?? "").trim().toLowerCase();
      if (!k) continue;
      const legacy = LEGACY_CONDITION_TYPE_MAP[k];
      map[k] = {
        label: legacy?.label ?? _humanizeConditionKey(k),
        conditionKey: legacy?.conditionKey ?? k
      };
    }

    _CONDITION_TYPE_MAP = { ...LEGACY_CONDITION_TYPE_MAP, ...map };
    _CONDITION_TYPE_MAP_SOURCE = "canonical";
    return _CONDITION_TYPE_MAP;
  }

  if (!_CONDITION_TYPE_MAP) {
    _CONDITION_TYPE_MAP = { ...LEGACY_CONDITION_TYPE_MAP };
    _CONDITION_TYPE_MAP_SOURCE = "legacy";
  }

  return _CONDITION_TYPE_MAP;
}

const CATEGORY_KEYS = ["resistance", "weakness", "immunity"];
const CONDITION_KEY_ALIASES = {
  paralysis: "paralyzed"
};

export const TRAIT_REGISTRY = {
  resistance: { label: "Resistance", types: DAMAGE_TYPE_MAP },
  weakness: { label: "Weakness", types: DAMAGE_TYPE_MAP },
  // Immunity supports both damage-type immunities and condition immunities.
  get immunity() {
    return { label: "Immunity", types: { ...DAMAGE_TYPE_MAP, ..._getConditionTypeMap() } };
  }
};

function _normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function _normalizeToken(value) {
  return _normalizeKey(value).replace(/[\s._-]+/g, "");
}

function _tokenizeForMatch(value) {
  return _normalizeKey(value).split(/[^a-z0-9]+/g).filter(Boolean);
}

function _tokensContainAll(tokens, desired) {
  if (!desired.length) return true;
  const set = new Set(tokens);
  for (const t of desired) {
    if (!set.has(t)) return false;
  }
  return true;
}

function _normalizeCategory(value) {
  const key = _normalizeKey(value).replace(/[\s_-]+/g, "");
  return CATEGORY_KEYS.includes(key) ? key : "";
}

function _normalizeDamageType(value) {
  const raw = _normalizeKey(value).replace(/[\s_-]+/g, "");
  if (!raw) return "";

  // Physical resistance aliases found in RAW text and legacy compendia.
  // Examples: "Normal Weapons", "Normal Weapon".
  if (["normalweapons", "normalweapon", "physical"].includes(raw)) return "physical";

  for (const key of Object.keys(DAMAGE_TYPE_MAP)) {
    if (key.replace(/[\s_-]+/g, "") === raw) return key;
  }
  return "";
}

function _normalizeConditionType(value) {
  const raw = _normalizeKey(value).replace(/[\s_-]+/g, "");
  if (!raw) return "";
  const alias = CONDITION_KEY_ALIASES[raw];
  const conditionMap = _getConditionTypeMap();
  if (alias && conditionMap[alias]) return alias;
  for (const key of Object.keys(conditionMap)) {
    if (key.replace(/[\s_-]+/g, "") === raw) return key;
  }
  return "";
}

function _parseTraitKey(traitKey = "", traitParam = "") {
  const keyRaw = _normalizeKey(traitKey).replace(/[/:]+/g, ".");
  const paramRaw = _normalizeKey(traitParam);
  if (!keyRaw && !paramRaw) return null;

  let category = "";
  let type = "";

  if (keyRaw.includes(".")) {
    const [cat, ...rest] = keyRaw.split(".");
    category = _normalizeCategory(cat);
    // Type resolution depends on category: immunity supports both damage and condition types.
    const rawType = rest.join(".");
    if (category === "immunity") {
      type = _normalizeDamageType(rawType) || _normalizeConditionType(rawType);
    } else {
      type = _normalizeDamageType(rawType);
    }
  } else {
    category = _normalizeCategory(keyRaw);
    if (category === "immunity") {
      type = _normalizeDamageType(paramRaw) || _normalizeConditionType(paramRaw);
    } else {
      type = _normalizeDamageType(paramRaw);
    }
  }

  if (!category || !type) return null;
  // "type" can be a damage type or a condition type (immunity only).
  const def = DAMAGE_TYPE_MAP[type] ?? _getConditionTypeMap()[type];
  if (!def) return null;

  return { category, type, def };
}

function _isIncorporealTrait(traitKey = "", traitParam = "") {
  const keyRaw = _normalizeKey(traitKey).replace(/[/:]+/g, ".");
  const parts = keyRaw.split(".").filter(Boolean);
  if (parts.includes("incorporeal")) return true;
  return _normalizeKey(traitParam) === "incorporeal";
}

function _getTraitSignature(item) {
  const keyRaw = _normalizeKey(item?.system?.traitKey ?? "").replace(/[/:]+/g, ".");
  const paramRaw = _normalizeKey(item?.system?.traitParam ?? "");
  return {
    keyRaw,
    paramRaw,
    keyFlat: _normalizeToken(keyRaw),
    paramFlat: _normalizeToken(paramRaw),
  };
}

function _matchesTraitSignature(sig, key, param = null) {
  const desiredKeyRaw = _normalizeKey(key).replace(/[/:]+/g, ".");
  const desiredKeyFlat = _normalizeToken(desiredKeyRaw);
  if (!desiredKeyFlat) return false;

  const keyTokens = _tokenizeForMatch(sig.keyRaw);
  const paramTokens = _tokenizeForMatch(sig.paramRaw);
  const allTokens = keyTokens.concat(paramTokens);
  const desiredKeyTokens = _tokenizeForMatch(desiredKeyRaw);

  if (param != null && param !== "") {
    const desiredParamRaw = _normalizeKey(param);
    const desiredParamFlat = _normalizeToken(desiredParamRaw);
    if (!desiredParamFlat) return false;
    const desiredParamTokens = _tokenizeForMatch(desiredParamRaw);

    if (_tokensContainAll(keyTokens, desiredKeyTokens) && _tokensContainAll(paramTokens, desiredParamTokens)) return true;
    if (_tokensContainAll(allTokens, desiredKeyTokens) && _tokensContainAll(allTokens, desiredParamTokens)) return true;

    if (sig.keyFlat === desiredKeyFlat && sig.paramFlat === desiredParamFlat) return true;
    if (sig.keyFlat === `${desiredKeyFlat}${desiredParamFlat}`) return true;
    if (sig.keyRaw === `${desiredKeyRaw}.${desiredParamRaw}`) return true;
    return false;
  }

  if (_tokensContainAll(keyTokens, desiredKeyTokens)) return true;
  if (_tokensContainAll(paramTokens, desiredKeyTokens)) return true;
  if (_tokensContainAll(allTokens, desiredKeyTokens)) return true;

  if (sig.keyFlat === desiredKeyFlat) return true;
  if (sig.paramFlat === desiredKeyFlat) return true;
  if (sig.keyRaw.split(".").includes(desiredKeyRaw)) return true;
  return false;
}

function _buildEmptyProfile() {
  const base = {
    resistance: {},
    weakness: {},
    immunity: {},
    immunityConditions: {},
    flags: { incorporeal: false, undead: false, skeletal: false, undeadBloodless: false }
  };
  for (const key of Object.keys(DAMAGE_TYPE_MAP)) {
    base.resistance[key] = 0;
    base.weakness[key] = 0;
    base.immunity[key] = false;
  }
  for (const key of Object.keys(_getConditionTypeMap())) {
    base.immunityConditions[key] = false;
  }
  return base;
}

function _isValidTraitProfile(profile) {
  if (!profile || typeof profile !== "object") return false;
  if (!profile.resistance || !profile.weakness || !profile.immunity || !profile.immunityConditions) return false;
  if (!profile.flags || typeof profile.flags !== "object") return false;

  for (const key of Object.keys(DAMAGE_TYPE_MAP)) {
    if (!Object.prototype.hasOwnProperty.call(profile.resistance, key)) return false;
    if (!Object.prototype.hasOwnProperty.call(profile.weakness, key)) return false;
    if (!Object.prototype.hasOwnProperty.call(profile.immunity, key)) return false;
  }
  for (const key of Object.keys(_getConditionTypeMap())) {
    if (!Object.prototype.hasOwnProperty.call(profile.immunityConditions, key)) return false;
  }

  return true;
}

export function getResistanceKeyForTraitType(typeKey) {
  return DAMAGE_TYPE_MAP[typeKey]?.resistanceKey ?? null;
}

export function collectTraitDamageModifiers(items = []) {
  const profile = _buildEmptyProfile();
  const list = Array.isArray(items) ? items : Array.from(items ?? []);

  for (const item of list) {
    if (!item) continue;
    const itemType = String(item.type ?? "");
    if (!["trait", "talent", "power"].includes(itemType)) continue;

    const traitKey = item.system?.traitKey ?? "";
    const traitParam = item.system?.traitParam ?? "";
    if (_isIncorporealTrait(traitKey, traitParam)) {
      profile.flags.incorporeal = true;
      continue;
    }

    const sig = _getTraitSignature(item);
    if (_matchesTraitSignature(sig, "undead")) {
      profile.flags.undead = true;
      if (_matchesTraitSignature(sig, "undead", "bloodless")) {
        profile.flags.undeadBloodless = true;
      }
    }
    if (_matchesTraitSignature(sig, "skeletal")) {
      profile.flags.skeletal = true;
    }
    if (_matchesTraitSignature(sig, "undead", "bloodless")) {
      profile.flags.undeadBloodless = true;
    }

    const resolved = _parseTraitKey(traitKey, traitParam);
    if (!resolved) continue;

    const { category, type } = resolved;
    const value = Number(item.system?.traitValue);

    if (category === "immunity") {
      // Immunity can target either a damage type or a condition.
      if (Object.prototype.hasOwnProperty.call(profile.immunity, type)) {
        profile.immunity[type] = true;
      } else if (Object.prototype.hasOwnProperty.call(profile.immunityConditions, type)) {
        profile.immunityConditions[type] = true;
      }
      continue;
    }

    if (!Number.isFinite(value) || value === 0) continue;

    // Chapter 4 stacking: "Traits with X use the highest X."
    // Resistance and Weakness values use highest-wins, not summation.
    const current = Number(profile[category][type] ?? 0) || 0;
    profile[category][type] = Math.max(current, value);
  }

  return profile;
}

export function getActorTraitDamageProfile(actor) {
  const profile = actor?.system?.ui?.traitAutomation;
  if (profile && typeof profile === "object" && _isValidTraitProfile(profile)) return profile;
  return collectTraitDamageModifiers(actor?.items ?? []);
}

export function applyTraitDerived(actorSystemData, traitProfile) {
  if (!actorSystemData || typeof actorSystemData !== "object") return;
  if (!_isValidTraitProfile(traitProfile)) return;

  actorSystemData.traits = actorSystemData.traits ?? {};
  const resistances = actorSystemData.traits.resistance = actorSystemData.traits.resistance ?? {};
  const immunities = actorSystemData.traits.immunity = actorSystemData.traits.immunity ?? {};

  for (const [typeKey, value] of Object.entries(traitProfile.resistance ?? {})) {
    const v = Number(value);
    if (!Number.isFinite(v)) continue;
    resistances[typeKey] = v;
  }

  for (const [conditionKey, isImmune] of Object.entries(traitProfile.immunityConditions ?? {})) {
    if (isImmune !== true) continue;
    immunities[conditionKey] = true;
  }
}

export function isActorImmuneToDamageType(actor, damageType) {
  const key = _normalizeDamageType(damageType);
  if (!key) return false;
  if ((key === "poison" || key === "disease") && isActorUndead(actor)) return true;
  const profile = getActorTraitDamageProfile(actor);
  return profile?.immunity?.[key] === true;
}

export function isActorImmuneToCondition(actor, conditionKey) {
  const k = _normalizeConditionType(conditionKey);
  if (!actor || !k) return false;

  // Allow ActiveEffects or sheet-derived flags to set condition immunities without requiring item parsing.
  // ActiveEffect values are often strings; treat any non-zero numeric value as "true".
  try {
    const raw = actor?.system?.traits?.immunity?.[k];
    if (raw === true) return true;
    if (raw === false || raw == null) {
      // keep evaluating (traits/talents/powers may still grant immunity)
    } else {
      const n = Number(raw);
      if (Number.isFinite(n)) return n !== 0;
      const s = String(raw).trim().toLowerCase();
      if (s === "true" || s === "yes" || s === "on") return true;
    }
  } catch (_e) {}

  const profile = getActorTraitDamageProfile(actor);
  return profile?.immunityConditions?.[k] === true;
}

export function isActorIncorporeal(actor) {
  const profile = getActorTraitDamageProfile(actor);
  return profile?.flags?.incorporeal === true;
}

export function isActorSkeletal(actor) {
  const profile = getActorTraitDamageProfile(actor);
  return profile?.flags?.skeletal === true;
}

export function isActorUndead(actor) {
  const profile = getActorTraitDamageProfile(actor);
  return profile?.flags?.undead === true || profile?.flags?.skeletal === true;
}

export function isActorUndeadBloodless(actor) {
  const profile = getActorTraitDamageProfile(actor);
  return profile?.flags?.undeadBloodless === true;
}

export function hasActorTrait(actor, key, { param = null } = {}) {
  if (!actor) return false;
  for (const item of (actor.items ?? [])) {
    if (!item) continue;
    if (!["trait", "talent", "power"].includes(String(item.type ?? ""))) continue;
    const sig = _getTraitSignature(item);
    if (_matchesTraitSignature(sig, key, param)) return true;
  }
  return false;
}

export function getActorTraitValue(actor, key, { param = null, mode = "sum" } = {}) {
  if (!actor) return 0;
  const useMax = String(mode ?? "sum").toLowerCase() === "max";
  let total = 0;
  let max = 0;
  let found = false;

  for (const item of (actor.items ?? [])) {
    if (!item) continue;
    if (!["trait", "talent", "power"].includes(String(item.type ?? ""))) continue;
    const sig = _getTraitSignature(item);
    if (!_matchesTraitSignature(sig, key, param)) continue;
    const value = Number(item.system?.traitValue);
    if (!Number.isFinite(value)) continue;
    found = true;
    if (useMax) {
      if (value > max) max = value;
    } else {
      total += value;
    }
  }

  return useMax ? (found ? max : 0) : total;
}

export function getDiseaseResistancePercent(actor) {
  const legacy = Number(actor?.system?.resistance?.diseaseR ?? 0) || 0;
  const traitValue = getActorTraitValue(actor, "diseaseResistance", { mode: "sum" });
  const total = Math.max(0, legacy + Number(traitValue || 0));
  return Math.min(100, total);
}

export function getResistanceBonusOptions(actor) {
  const profile = getActorTraitDamageProfile(actor);
  const resist = profile?.resistance ?? {};
  const out = [];

  for (const [typeKey, def] of Object.entries(DAMAGE_TYPE_MAP)) {
    const value = Number(resist?.[typeKey] ?? 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    out.push({
      key: typeKey,
      label: def?.label ?? typeKey,
      value,
      bonus: value * 10
    });
  }

  return out;
}
