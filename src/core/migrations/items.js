/**
 * Items migration / normalization (v13-safe, no ApplicationV2 dependency).
 *
 * Scope:
 * - World Items (game.items)
 * - Embedded Items on Actors (game.actors[].items)
 *
 * Notes:
 * - Compendia are not auto-migrated here.
 * - This is a lightweight normalization pass intended to be safe to run on every startup.
 */

import { applyDefaults } from "./apply-defaults.js";
import { DEFAULTS } from "./item-defaults.generated.js";
import { SYSTEM_ID, UESRPG } from "../constants.js";
import { getWeaponBaseReachState } from "../homebrew/reach-length/weapon.js";
import { getMigrationState, setMigrationState, getSystemVersionString } from "./state.js";

const MODULE_ID = SYSTEM_ID;
const _RETIRED_SOCIAL_ITEM_TYPES = new Set(["language", "faction"]);
const _combatLegacyItemStats = {
  weaponsEnhancedFromQualities: 0,
  weaponsEnhancedFromRange: 0,
};

/** @typedef {"melee"|"ranged"} AttackMode */

const _NON_NUMERIC_ALLOWLIST = {
  weapon: ["damage", "damage2", "damage3"],
  armor: [],
  shield: [],
  ammunition: []
};

function _isNonNumericString(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !Number.isFinite(Number(trimmed));
}

function _extractFirstNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/[-+]?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function _inferTypedLaneFromText(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const map = [
    ["sunlight", "sunlight"],
    ["silver", "silver"],
    ["disease", "disease"],
    ["poison", "poison"],
    ["frost", "frost"],
    ["shock", "shock"],
    ["fire", "fire"],
    ["magic", "magic"],
  ];
  for (const [needle, out] of map) {
    if (raw.includes(needle)) return out;
  }
  return null;
}

function _parseLegacyTypedNumeric(value) {
  const number = _extractFirstNumber(value);
  const type = _inferTypedLaneFromText(value);
  return { number, type };
}

function _applyLegacyArmorTypedFields(system) {
  if (!system || typeof system !== "object") return false;
  let changed = false;
  const numericArmorFields = ["magic_ar", "special_ar", "armor", "blockRating", "magic_br"];

  for (const key of numericArmorFields) {
    const raw = system[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "number" && Number.isFinite(raw)) continue;

    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) {
        system[key] = 0;
        changed = true;
        continue;
      }

      const asNum = Number(trimmed);
      if (Number.isFinite(asNum)) {
        system[key] = asNum;
        changed = true;
        continue;
      }

      const parsed = _parseLegacyTypedNumeric(trimmed);
      if (parsed.number !== null) {
        system[key] = parsed.number;
        changed = true;
        if (parsed.type && !String(system.special_ar_type ?? "").trim()) {
          system.special_ar_type = parsed.type;
          changed = true;
        }
        continue;
      }
    }

    system[key] = 0;
    changed = true;
  }

  const sat = String(system.special_ar_type ?? "").trim().toLowerCase();
  const valid = new Set(["", "fire", "frost", "shock", "poison", "disease", "magic", "silver", "sunlight"]);
  if (!valid.has(sat)) {
    system.special_ar_type = _inferTypedLaneFromText(sat) ?? "";
    changed = true;
  }

  return changed;
}

function _supportedItemTypes() {
  const supported = new Set(Object.keys(DEFAULTS?.itemSystem ?? {}));
  supported.add("equipment");
  supported.add("item");
  return supported;
}

async function _cleanupRetiredSocialItems() {
  let worldDeleted = 0;
  let actorDeleted = 0;
  let actorsTouched = 0;

  const worldIds = (game?.items?.contents ?? [])
    .filter((item) => _RETIRED_SOCIAL_ITEM_TYPES.has(String(item?.type ?? "").toLowerCase()))
    .map((item) => item.id)
    .filter(Boolean);

  if (worldIds.length) {
    worldDeleted = worldIds.length;
    await Item.deleteDocuments(worldIds);
  }

  for (const actor of game?.actors?.contents ?? []) {
    const embeddedIds = (actor?.items?.contents ?? [])
      .filter((item) => _RETIRED_SOCIAL_ITEM_TYPES.has(String(item?.type ?? "").toLowerCase()))
      .map((item) => item.id)
      .filter(Boolean);

    if (!embeddedIds.length) continue;
    actorsTouched += 1;
    actorDeleted += embeddedIds.length;
    await actor.deleteEmbeddedDocuments("Item", embeddedIds);
  }

  return {
    worldDeleted,
    actorDeleted,
    actorsTouched,
    totalDeleted: worldDeleted + actorDeleted,
  };
}

function _debugEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, "migrationDebug");
  } catch (_e) {
    return false;
  }
}

function _itemHasTransferEffects(item) {
  try {
    const effects = item?.effects?.contents ?? item?.effects ?? [];
    return Array.isArray(effects) && effects.some((e) => {
      const obj = typeof e?.toObject === "function" ? e.toObject() : e;
      return !!(obj?.transfer);
    });
  } catch (_e) {
    return false;
  }
}

function _normalizeEnchantLevel(item, sys = {}) {
  const update = {};
  const raw = sys.enchant_level;
  const n = Number(raw);

  if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) {
    update["system.enchant_level"] = 0;
    return update;
  }

  // Legacy artifact: some imports/migrations defaulted enchant_level to 1.
  // If the item has no transfer Active Effects, treat it as unenchanted.
  if (n === 1 && !_itemHasTransferEffects(item)) {
    update["system.enchant_level"] = 0;
  }

  return update;
}

function _repairWeaponReachFromSafeFallback(system = {}, flags = {}, { attackMode = null } = {}) {
  let changed = false;
  const currentReach = Number(system?.reach ?? 0);
  const hasCurrentReach = Number.isFinite(currentReach) && currentReach > 0;
  const baseReach = getWeaponBaseReachState(
    { type: "weapon", system, flags, attackMode },
    { attackMode, includeLegacyFallback: true }
  );

  if (!hasCurrentReach && baseReach.max > 0) {
    system.reach = baseReach.max;
    changed = true;
  }

  const structured = Array.isArray(system?.qualitiesStructured) ? system.qualitiesStructured : [];
  const filtered = structured.filter((quality) => String(quality?.key ?? "").trim().toLowerCase() !== "reach");
  if (filtered.length !== structured.length) {
    system.qualitiesStructured = filtered;
    changed = true;
  }

  return changed;
}

function _stripRichText(raw = "") {
  return String(raw ?? "")
    .replace(/@Compendium\[[^\]]+\]\{([^}]+)\}/g, "$1")
    .replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _parseRangeTriplet(text) {
  if (!text) return null;
  const m = String(text).match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  return { short: Number(m[1]) || 0, medium: Number(m[2]) || 0, long: Number(m[3]) || 0 };
}

function _hasQualityKey(structured = [], key = "") {
  const target = String(key ?? "").toLowerCase();
  if (!target || !Array.isArray(structured)) return false;
  return structured.some((q) => String(q?.key ?? q ?? "").toLowerCase() === target);
}

function _hasQualityTrait(traits = [], key = "") {
  const target = String(key ?? "").toLowerCase();
  if (!target || !Array.isArray(traits)) return false;
  return traits.some((t) => String(t ?? "").toLowerCase() === target);
}

function _ensureBooleanQuality(nextTraits, nextStructured, key) {
  let changed = false;
  if (!_hasQualityTrait(nextTraits, key)) {
    nextTraits.push(key);
    changed = true;
  }
  if (!_hasQualityKey(nextStructured, key)) {
    nextStructured.push({ key, value: true });
    changed = true;
  }
  return changed;
}

function _applyLegacyWeaponCombatShape(sys = {}) {
  const update = {};
  let qualitiesEnhanced = false;
  let rangeEnhanced = false;

  const legacyRaw = _stripRichText(sys.qualities ?? "");
  const hasLegacyText = Boolean(legacyRaw);

  const existingStructured = Array.isArray(sys.qualitiesStructured) ? sys.qualitiesStructured : [];
  const existingTraits = Array.isArray(sys.qualitiesTraits) ? sys.qualitiesTraits : [];
  const nextStructured = existingStructured.slice();
  const nextTraits = existingTraits.slice();

  const hasCanonicalQualityData = existingStructured.length > 0 || existingTraits.length > 0;
  if (hasLegacyText && !hasCanonicalQualityData) {
    const lower = legacyRaw.toLowerCase();
    const booleanQualityPatterns = [
      ["thrown", /\bthrown\b/i],
      ["sling", /\bsling\b/i],
      ["runed", /\bruned\b/i],
      ["flail", /\bflail\b/i],
      ["entangling", /\bentangling\b/i],
      ["twoHanded", /\b(two[\s-]*hand(?:ed)?|2h)\b/i],
      ["small", /\bsmall\b/i],
      ["dueling", /\bduel(?:ing)?\b/i],
      ["shieldSplitter", /\bshield[\s-]*splitter\b/i],
      ["concussive", /\bconcussive\b/i],
    ];

    for (const [key, pattern] of booleanQualityPatterns) {
      if (!pattern.test(lower)) continue;
      if (_ensureBooleanQuality(nextTraits, nextStructured, key)) qualitiesEnhanced = true;
    }

    const reloadMatch = lower.match(/\breload\s*\(\s*(\d+)\s*\)/i);
    if (reloadMatch) {
      const reloadValue = Number(reloadMatch[1]) || 0;
      if (!_hasQualityTrait(nextTraits, "reload")) {
        nextTraits.push("reload");
        qualitiesEnhanced = true;
      }
      const reloadIndex = nextStructured.findIndex((q) => String(q?.key ?? "").toLowerCase() === "reload");
      if (reloadIndex >= 0) {
        const existingValue = Number(nextStructured[reloadIndex]?.value);
        if (!Number.isFinite(existingValue)) {
          nextStructured[reloadIndex] = { ...nextStructured[reloadIndex], key: "reload", value: reloadValue };
          qualitiesEnhanced = true;
        }
      } else {
        nextStructured.push({ key: "reload", value: reloadValue });
        qualitiesEnhanced = true;
      }
    }
  }

  if (qualitiesEnhanced) {
    if (nextStructured.length) update["system.qualitiesStructured"] = nextStructured;
    if (nextTraits.length) update["system.qualitiesTraits"] = nextTraits;
  }

  const hasRangeField = typeof sys.range === "string" && sys.range.trim().length > 0;
  const parsedFromRangeField = _parseRangeTriplet(sys.range);
  const rangedTriplet = legacyRaw.match(/\bRanged\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*\)/i);
  const thrownTriplet = legacyRaw.match(/\bThrown\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*\)/i);

  if (!hasRangeField && rangedTriplet) {
    update["system.range"] = `${Number(rangedTriplet[1]) || 0}/${Number(rangedTriplet[2]) || 0}/${Number(rangedTriplet[3]) || 0}`;
    rangeEnhanced = true;
  }

  const hasThrownShort = Number.isFinite(Number(sys.thrownShort));
  const hasThrownMed = Number.isFinite(Number(sys.thrownMed));
  const hasThrownLong = Number.isFinite(Number(sys.thrownLong));
  if (thrownTriplet && (!hasThrownShort || !hasThrownMed || !hasThrownLong)) {
    if (!hasThrownShort) update["system.thrownShort"] = Number(thrownTriplet[1]) || 0;
    if (!hasThrownMed) update["system.thrownMed"] = Number(thrownTriplet[2]) || 0;
    if (!hasThrownLong) update["system.thrownLong"] = Number(thrownTriplet[3]) || 0;
    rangeEnhanced = true;
  }

  const hasValidAttackMode = sys.attackMode === "melee" || sys.attackMode === "ranged";
  if (!hasValidAttackMode && (rangedTriplet || thrownTriplet || parsedFromRangeField)) {
    update["system.attackMode"] = "ranged";
    rangeEnhanced = true;
  }

  return { update, qualitiesEnhanced, rangeEnhanced };
}

/**
 * Best-effort, deterministic inference of weapon attack mode from existing weapon data.
 *
 * We only infer "ranged" when we have explicit signals. Otherwise we return null
 * so the caller can apply the legacy default (currently melee).
 *
 * @param {Item} item
 * @param {object} sys
 * @returns {"melee"|"ranged"|null}
 */
function _inferAttackMode(item, sys = {}) {
  // 1) Structured qualities: explicit ranged signals
  const structured = Array.isArray(sys.qualitiesStructured) ? sys.qualitiesStructured : [];
  const sKeys = new Set(structured.map((q) => String(q?.key ?? "").toLowerCase()).filter(Boolean));
  if (sKeys.has("reload") || sKeys.has("thrown")) return "ranged";

  // 2) Explicit thrown range fields (newer schema)
  const ts = Number(sys.thrownShort ?? 0);
  const tm = Number(sys.thrownMed ?? 0);
  const tl = Number(sys.thrownLong ?? 0);
  if ([ts, tm, tl].some((n) => Number.isFinite(n) && n > 0)) return "ranged";

  // 3) Trait pills: explicit ranged identifiers (sling, etc.)
  const traits = Array.isArray(sys.qualitiesTraits) ? sys.qualitiesTraits : [];
  const tSet = new Set(traits.map((t) => String(t).toLowerCase()));
  if (tSet.has("sling")) return "ranged";

  // 4) Category-ish fields: deterministic keyword mapping (only promotes to ranged)
  const cat = String(sys.item_cat ?? sys.category ?? "").trim().toLowerCase();
  const style = String(sys.combatStyle ?? sys.skill ?? "").trim().toLowerCase();
  const name = String(item?.name ?? "").trim().toLowerCase();

  const hay = `${cat} ${style} ${name}`;
  // NOTE: These are only used to promote to ranged. If none match, we do not guess.
  const rangedKeywords = ["bow", "crossbow", "arbalest", "sling", "marksman", "archery", "ranged"];
  if (rangedKeywords.some((k) => hay.includes(k))) return "ranged";

  return null;
}

function _normalizeWeaponSystem(item, sys = {}) {
  const update = {};
  const combatLegacy = _applyLegacyWeaponCombatShape(sys);
  Object.assign(update, combatLegacy.update);
  if (combatLegacy.qualitiesEnhanced) _combatLegacyItemStats.weaponsEnhancedFromQualities += 1;
  if (combatLegacy.rangeEnhanced) _combatLegacyItemStats.weaponsEnhancedFromRange += 1;

  const inferredSys = foundry.utils.deepClone(sys ?? {});
  for (const [k, v] of Object.entries(update)) {
    if (!k.startsWith("system.")) continue;
    const path = k.slice("system.".length);
    if (!path || path.startsWith("-=")) continue;
    foundry.utils.setProperty(inferredSys, path, v);
  }

  // Fix legacy typo: equippped -> equipped
  if (Object.prototype.hasOwnProperty.call(sys, "equippped") && !Object.prototype.hasOwnProperty.call(sys, "equipped")) {
    update["system.equipped"] = !!sys.equippped;
  }
  if (Object.prototype.hasOwnProperty.call(sys, "equippped")) {
    update["system.-=equippped"] = null;
  }

  // Ensure attackMode exists (melee|ranged).
  // Legacy assumption in this system has been melee unless explicitly ranged.
  const hasValidAttackMode = inferredSys.attackMode === "melee" || inferredSys.attackMode === "ranged";
  if (!hasValidAttackMode) {
    const inferred = _inferAttackMode(item, inferredSys);
    if (inferred) update["system.attackMode"] = inferred;
    else update["system.attackMode"] = "melee";

    // Debug-only diagnostics when we had to fall back.
    if (!inferred && _debugEnabled()) {
      const ident = `${item?.type ?? "item"}:${item?.name ?? item?.id ?? "<unknown>"}`;
      console.warn(`${MODULE_ID} | attackMode inference fallback (defaulted to melee) for ${ident}`);
    }
  }

  // Ensure quality/material defaults
  if (!sys.qualityLevel) update["system.qualityLevel"] = "common";
  if (!sys.material) update["system.material"] = "standard";

  // Ensure structured qualities array
  if (!Array.isArray(sys.qualitiesStructured)) update["system.qualitiesStructured"] = [];
  if (Object.prototype.hasOwnProperty.call(sys, "damageInstances")) update["system.-=damageInstances"] = null;

  try {
    const repairedSystem = foundry.utils.deepClone(inferredSys);
    if (_repairWeaponReachFromSafeFallback(repairedSystem, item?.flags ?? {}, { attackMode: repairedSystem.attackMode })) {
      if (repairedSystem.reach !== inferredSys.reach) {
        update["system.reach"] = repairedSystem.reach;
      }

      const originalStructured = Array.isArray(inferredSys.qualitiesStructured) ? inferredSys.qualitiesStructured : [];
      const repairedStructured = Array.isArray(repairedSystem.qualitiesStructured) ? repairedSystem.qualitiesStructured : [];
      if (JSON.stringify(repairedStructured) !== JSON.stringify(originalStructured)) {
        update["system.qualitiesStructured"] = repairedStructured;
      }
    }
  } catch (_e) {
    // Ignore and continue; migration must be best-effort and non-blocking.
  }

  // Reach bounds: Reach is a numeric field (max reach). Minimum reach is optional (0 for none).
  if (sys.reachMin === undefined || sys.reachMin === null || sys.reachMin === "") update["system.reachMin"] = 0;
  else {
    const n = Number(sys.reachMin);
    if (!Number.isFinite(n) || n < 0) update["system.reachMin"] = 0;
  }

  Object.assign(update, _normalizeEnchantLevel(item, sys));

  return update;
}

/**
 * Backfill armorValues.{full,partial} from legacy single-lane fields.
 * Called during migration only. Uses ARMOR_PROFILES to infer the alternate lane where possible.
 * After migration, runtime never reads ARMOR_PROFILES for armor items.
 *
 * @param {object} sys - armor item system data (cloned)
 * @param {object} update - update object to append to
 */
function _backfillArmorValues(sys, update) {
  // If already migrated, skip.
  const existing = sys.armorValues;
  const hasFullLane    = existing?.full    && typeof existing.full    === "object";
  const hasPartialLane = existing?.partial && typeof existing.partial === "object";
  if (hasFullLane && hasPartialLane) return;

  const nativeClass = String(sys.armorClass || "partial").toLowerCase() === "full" ? "full" : "partial";
  const altClass    = nativeClass === "full" ? "partial" : "full";

  // Authored lane: read from legacy root fields.
  const authoredArmor    = Number(sys.armor     ?? 0) || 0;
  const authoredMagicAR  = Number(sys.magic_ar  ?? 0) || 0;
  const authoredSpecialAR = Number(sys.special_ar ?? 0) || 0;
  const authoredSpecialType = String(sys.special_ar_type ?? "").trim().toLowerCase();

  const authoredLane = {
    armor:           authoredArmor,
    magic_ar:        authoredMagicAR,
    special_ar:      authoredSpecialAR,
    special_ar_type: authoredSpecialType,
  };

  // Alternate lane: try legacy ARMOR_PROFILES for a best-effort seed.
  // Falls back to cloning the authored lane and logging a note.
  const materialKey = String(sys.material || "").trim();
  const altProfile  = UESRPG?.ARMOR_PROFILES?.[altClass]?.[materialKey] ?? null;
  let altLane;

  if (altProfile && altProfile.ar != null) {
    altLane = {
      armor:           Number(altProfile.ar      ?? 0) || 0,
      magic_ar:        Number(altProfile.magicAR ?? 0) || 0,
      special_ar:      0,
      special_ar_type: String(altProfile.magicARType ?? "").trim().toLowerCase(),
    };
  } else {
    // Inference not possible — clone authored lane and note.
    altLane = { ...authoredLane };
    if (_debugEnabled()) {
      console.log(
        `${MODULE_ID} | armorValues migration: no profile for ${altClass}/${materialKey} on "${sys.name ?? "?"}", cloned ${nativeClass} lane as fallback.`
      );
    }
  }

  const newArmorValues = {
    [nativeClass]: hasFullLane && nativeClass === "full"
      ? existing.full
      : hasPartialLane && nativeClass === "partial"
        ? existing.partial
        : authoredLane,
    [altClass]: hasFullLane && altClass === "full"
      ? existing.full
      : hasPartialLane && altClass === "partial"
        ? existing.partial
        : altLane,
  };

  update["system.armorValues"] = newArmorValues;
}

function _normalizeArmorSystem(item, sys = {}) {
  const update = {};

  if (!sys.qualityLevel) update["system.qualityLevel"] = "common";
  if (!sys.material) update["system.material"] = "standard";
  if (!sys.weightClass) update["system.weightClass"] = "none";

  if (!Array.isArray(sys.qualitiesStructured)) update["system.qualitiesStructured"] = [];

  // Backfill armorValues lanes from legacy root fields.
  _backfillArmorValues(sys, update);

  const locationKeys = ["Head", "Body", "RightArm", "LeftArm", "RightLeg", "LeftLeg"];
  const categoryToCoverage = {
    head: { Head: true },
    body: { Body: true },
    l_arm: { LeftArm: true },
    r_arm: { RightArm: true },
    l_leg: { LeftLeg: true },
    r_leg: { RightLeg: true },
    shield: { LeftArm: true, RightArm: true },
  };
  const normalizeHitLocations = (raw) => {
    const out = Object.fromEntries(locationKeys.map((k) => [k, false]));
    const source = (raw && typeof raw === "object") ? raw : {};
    let hasAnyBoolean = false;

    for (const key of locationKeys) {
      if (typeof source[key] === "boolean") {
        out[key] = source[key] === true;
        hasAnyBoolean = true;
      }
    }
    return { out, hasAnyBoolean };
  };

  const current = normalizeHitLocations(sys?.hitLocations);
  const isLegacyAllTrue = locationKeys.every((k) => current.out[k] === true);
  if (!current.hasAnyBoolean || isLegacyAllTrue) {
    const category = String(sys?.category ?? "").trim().toLowerCase();
    const seeded = categoryToCoverage[category];
    if (seeded) {
      current.out = Object.fromEntries(locationKeys.map((k) => [k, seeded[k] === true]));
    }
  }

  const existing = sys?.hitLocations ?? {};
  const needsHitLocationUpdate = locationKeys.some((k) => existing[k] !== current.out[k]);
  if (needsHitLocationUpdate) {
    update["system.hitLocations"] = current.out;
  }

  if (Object.prototype.hasOwnProperty.call(sys, "hitLocationStates")) {
    update["system.-=hitLocationStates"] = null;
  }

  Object.assign(update, _normalizeEnchantLevel(item, sys));

  return update;
}

function _normalizeShieldSystem(item, sys = {}) {
  const update = {};

  if (!sys.qualityLevel) update["system.qualityLevel"] = "common";
  if (!sys.material) update["system.material"] = "standard";
  if (!sys.weightClass) update["system.weightClass"] = "none";
  if (!sys.shieldType) update["system.shieldType"] = "normal";
  if (!Array.isArray(sys.qualitiesStructured)) update["system.qualitiesStructured"] = [];

  Object.assign(update, _normalizeEnchantLevel(item, sys));
  return update;
}

function _normalizeAmmoSystem(item, sys = {}) {
  const update = {};
  if (Object.prototype.hasOwnProperty.call(sys, "pricePer10")) update["system.-=pricePer10"] = null;
  if (Object.prototype.hasOwnProperty.call(sys, "pricePerShot")) update["system.-=pricePerShot"] = null;

  if (!sys.arrowType) update["system.arrowType"] = "none";
  if (sys.damageType == null) update["system.damageType"] = "";

  if (!Array.isArray(sys.qualitiesStructured)) update["system.qualitiesStructured"] = [];

  Object.assign(update, _normalizeEnchantLevel(item, sys));

  return update;
}

async function _processWorldItems(modeLabel, { silent = false } = {}) {
  const supportedTypes = _supportedItemTypes();
  const updates = [];
  const legacyPlanned = [];
  for (const item of game.items.contents) {
    if (!supportedTypes.has(item.type)) continue;
    const update = _normalizeItemSystem(item);
    if (update) {
      update._id = item.id;
      updates.push(update);
      if (item.type === "item" && update.type === "equipment") {
        legacyPlanned.push(item.id);
      }
    }
  }

  if (updates.length) {
    if (!silent) console.log(`${MODULE_ID} | ${modeLabel} ${updates.length} world item(s)`);
    await Item.updateDocuments(updates, { diff: false });
  }

  return {
    plannedLegacyConversions: legacyPlanned.length,
  };
}

async function _processActorItems(modeLabel, { silent = false } = {}) {
  const supportedTypes = _supportedItemTypes();
  let plannedLegacyConversions = 0;
  for (const actor of game.actors.contents) {
    const updates = [];
    const typeChangeUpdates = [];
    for (const item of actor.items.contents) {
      if (!supportedTypes.has(item.type)) continue;
      const update = _normalizeItemSystem(item);
      if (update) {
        update._id = item.id;
        if (Object.prototype.hasOwnProperty.call(update, "type") && String(update.type ?? "") !== String(item.type ?? "")) {
          typeChangeUpdates.push({ item, update });
        } else {
          updates.push(update);
        }
        if (item.type === "item" && update.type === "equipment") {
          plannedLegacyConversions += 1;
        }
      }
    }

    if (updates.length) {
      if (!silent) console.log(`${MODULE_ID} | ${modeLabel} ${updates.length} item(s) on actor ${actor.name}`);
      await actor.updateEmbeddedDocuments("Item", updates, { diff: false });
    }

    if (typeChangeUpdates.length) {
      if (!silent) console.log(`${MODULE_ID} | ${modeLabel} ${typeChangeUpdates.length} type-conversion item(s) on actor ${actor.name}`);

      const directUpdates = typeChangeUpdates.map(({ update }) => {
        const clean = { _id: update._id, type: update.type, system: update.system ?? {} };
        if (Object.prototype.hasOwnProperty.call(update, "system.-=equippped")) {
          clean["system.-=equippped"] = null;
        }
        return clean;
      });

      let remainingFallback = [];
      try {
        await actor.updateEmbeddedDocuments("Item", directUpdates, { diff: false, recursive: false });
      } catch (err) {
        remainingFallback = typeChangeUpdates;
        if (_debugEnabled()) {
          console.warn(`${MODULE_ID} | Direct embedded type-conversion update failed, using recreate/delete fallback`, {
            actor: actor.name,
            err,
          });
        }
      }

      if (!remainingFallback.length) {
        const lingering = typeChangeUpdates.filter(({ item }) => actor.items.get(item.id)?.type === "item");
        remainingFallback = lingering;
      }

      if (remainingFallback.length) {
        for (const { item, update } of remainingFallback) {
          try {
            const source = item.toObject();
            delete source._id;
            source.type = update.type;
            source.system = update.system ?? source.system ?? {};
            await actor.createEmbeddedDocuments("Item", [source], { keepId: false });
            await actor.deleteEmbeddedDocuments("Item", [item.id]);
          } catch (err) {
            if (_debugEnabled()) {
              console.warn(`${MODULE_ID} | Embedded type-conversion fallback failed`, {
                actor: actor.name,
                item: item.name,
                itemId: item.id,
                err,
              });
            }
          }
        }
      }
    }
  }

  return { plannedLegacyConversions };
}

function _collectLegacyItemReferences() {
  const refs = [];
  for (const item of game.items.contents ?? []) {
    if (item?.type === "item") refs.push(`WorldItem:${item.id}:${item.name ?? ""}`);
  }
  for (const actor of game.actors.contents ?? []) {
    for (const item of actor.items.contents ?? []) {
      if (item?.type === "item") refs.push(`ActorItem:${actor.id}:${actor.name ?? ""}:${item.id}:${item.name ?? ""}`);
    }
  }
  return refs;
}

async function _repairLegacyItemTypeCutoverIfNeeded() {
  const before = _collectLegacyItemReferences();
  if (!before.length) {
    return { attempted: false, beforeCount: 0, afterCount: 0, remaining: [] };
  }

  await _processWorldItems("Repairing", { silent: true });
  await _processActorItems("Repairing", { silent: true });
  const after = _collectLegacyItemReferences();

  return {
    attempted: true,
    beforeCount: before.length,
    afterCount: after.length,
    remaining: after,
  };
}

async function _backfillScrollCastingControlsWorld(defaultRequireTraining, defaultConsumeMagicka, defaultConsumeOnCast = true) {
  const updates = [];
  for (const item of game.items.contents) {
    if (item?.type !== "scroll") continue;
    const hasRequireTraining = item.system?.requireSchoolTraining !== undefined;
    const hasConsumeMagicka = item.system?.consumeMagicka !== undefined;
    const hasConsumeOnCast = item.system?.consumeOnCast !== undefined;
    if (hasRequireTraining && hasConsumeMagicka && hasConsumeOnCast) continue;

    const update = { _id: item.id };
    if (!hasRequireTraining) update["system.requireSchoolTraining"] = defaultRequireTraining;
    if (!hasConsumeMagicka) update["system.consumeMagicka"] = defaultConsumeMagicka;
    if (!hasConsumeOnCast) update["system.consumeOnCast"] = defaultConsumeOnCast;
    updates.push(update);
  }

  if (updates.length) {
    console.log(`${MODULE_ID} | Backfilling scroll casting controls for ${updates.length} world scroll(s)`);
    await Item.updateDocuments(updates, { diff: false });
  }
}

async function _backfillScrollCastingControlsActorItems(defaultRequireTraining, defaultConsumeMagicka, defaultConsumeOnCast = true) {
  for (const actor of game.actors.contents) {
    const updates = [];
    for (const item of actor.items.contents) {
      if (item?.type !== "scroll") continue;
      const hasRequireTraining = item.system?.requireSchoolTraining !== undefined;
      const hasConsumeMagicka = item.system?.consumeMagicka !== undefined;
      const hasConsumeOnCast = item.system?.consumeOnCast !== undefined;
      if (hasRequireTraining && hasConsumeMagicka && hasConsumeOnCast) continue;

      const update = { _id: item.id };
      if (!hasRequireTraining) update["system.requireSchoolTraining"] = defaultRequireTraining;
      if (!hasConsumeMagicka) update["system.consumeMagicka"] = defaultConsumeMagicka;
      if (!hasConsumeOnCast) update["system.consumeOnCast"] = defaultConsumeOnCast;
      updates.push(update);
    }

    if (updates.length) {
      console.log(`${MODULE_ID} | Backfilling scroll casting controls for ${updates.length} scroll(s) on actor ${actor.name}`);
      await actor.updateEmbeddedDocuments("Item", updates, { diff: false });
    }
  }
}

function _readScrollCastingDefaults() {
  let defaultRequireTraining = false;
  let defaultConsumeMagicka = false;
  const defaultConsumeOnCast = true;

  try { defaultRequireTraining = game.settings.get(MODULE_ID, "scrollRequiresTraining") === true; }
  catch (_e) { /* no-op */ }
  try { defaultConsumeMagicka = game.settings.get(MODULE_ID, "scrollConsumesMagicka") === true; }
  catch (_e) { /* no-op */ }

  return { defaultRequireTraining, defaultConsumeMagicka, defaultConsumeOnCast };
}

async function _runLegacyItemRepairPasses({ state, currentVersion }) {
  try {
    const socialCleanup = await _cleanupRetiredSocialItems();
    const repaired = await _repairLegacyItemTypeCutoverIfNeeded();
    if (!repaired.attempted && socialCleanup.totalDeleted === 0) return;

    if (socialCleanup.totalDeleted > 0 || state.socialItemRetirementCleanup !== currentVersion) {
      state.socialItemRetirementCleanup = currentVersion;
    }
    state.itemLegacyRepair = currentVersion;
    await setMigrationState(state);

    if (repaired.afterCount > 0 && _debugEnabled()) {
      console.warn(`${MODULE_ID} | Legacy item->equipment self-repair could not clear all docs`, {
        before: repaired.beforeCount,
        remaining: repaired.afterCount,
        references: repaired.remaining,
      });
      return;
    }

    if (socialCleanup.totalDeleted > 0 && _debugEnabled()) {
      console.log(`${MODULE_ID} | Retired social item cleanup complete`, socialCleanup);
      return;
    }

    if (_debugEnabled()) {
      console.log(`${MODULE_ID} | Legacy item->equipment self-repair complete`, {
        converted: Math.max(0, repaired.beforeCount - repaired.afterCount),
        remaining: repaired.afterCount,
      });
    }
  } catch (err) {
    console.error(`${MODULE_ID} | Legacy item self-repair failed`, err);
    ui.notifications?.error?.("UESRPG item migration self-repair failed; check console for details.");
  }
}

async function _runSocialRetirementCleanupPass({ state, currentVersion }) {
  const cleanup = await _cleanupRetiredSocialItems();
  console.log(`${MODULE_ID} | Social item retirement cleanup`, cleanup);
  state.socialItemRetirementCleanup = currentVersion;
}

async function _runVersionedItemMigrationPass({ state, currentVersion }) {
  _combatLegacyItemStats.weaponsEnhancedFromQualities = 0;
  _combatLegacyItemStats.weaponsEnhancedFromRange = 0;

  const migrationTelemetry = {
    converted: 0,
    skipped: 0,
    failures: 0,
  };

  const legacyBefore = _collectLegacyItemReferences();
  const worldResult = await _processWorldItems("Migrating");
  const actorResult = await _processActorItems("Migrating");
  const legacyAfter = _collectLegacyItemReferences();

  migrationTelemetry.converted = Number(worldResult?.plannedLegacyConversions ?? 0) + Number(actorResult?.plannedLegacyConversions ?? 0);
  migrationTelemetry.skipped = Math.max(0, legacyBefore.length - migrationTelemetry.converted);
  migrationTelemetry.failures = legacyAfter.length;

  console.log(`${MODULE_ID} | Combat legacy weapon migration summary`, {
    weaponsEnhancedFromQualities: _combatLegacyItemStats.weaponsEnhancedFromQualities,
    weaponsEnhancedFromRange: _combatLegacyItemStats.weaponsEnhancedFromRange
  });
  console.log(`${MODULE_ID} | Legacy item->equipment migration telemetry`, migrationTelemetry);
  if (legacyAfter.length && _debugEnabled()) {
    console.warn(`${MODULE_ID} | Stale legacy item docs remain after migration`, {
      remaining: legacyAfter.length,
      references: legacyAfter,
    });
  }

  state.items = currentVersion;
}

async function _runScrollCastingBackfillPass({
  state,
  currentVersion,
  defaults,
  needsScrollCastingBackfill,
  needsScrollConsumeOnCastBackfill,
}) {
  const { defaultRequireTraining, defaultConsumeMagicka, defaultConsumeOnCast } = defaults;
  await _backfillScrollCastingControlsWorld(defaultRequireTraining, defaultConsumeMagicka, defaultConsumeOnCast);
  await _backfillScrollCastingControlsActorItems(defaultRequireTraining, defaultConsumeMagicka, defaultConsumeOnCast);

  if (needsScrollCastingBackfill) {
    state.scrollCastingControls = currentVersion;
  }
  if (needsScrollConsumeOnCastBackfill) {
    state.scrollConsumeOnCast = currentVersion;
  }
}

export async function migrateItemsIfNeeded() {
  // Lightweight normalization pass; safe to run on every startup.
  if (!game.user.isGM) return;
  const currentVersion = getSystemVersionString();
  const state = getMigrationState();
  const needsSocialRetirementCleanup = state?.socialItemRetirementCleanup !== currentVersion;
  const needsItemMigration = state?.items !== currentVersion;
  const needsScrollCastingBackfill = state?.scrollCastingControls !== currentVersion;
  const needsScrollConsumeOnCastBackfill = state?.scrollConsumeOnCast !== currentVersion;
  if (!needsSocialRetirementCleanup && !needsItemMigration && !needsScrollCastingBackfill && !needsScrollConsumeOnCastBackfill) {
    await _runLegacyItemRepairPasses({ state, currentVersion });
    return;
  }

  const defaults = _readScrollCastingDefaults();

  try {
    if (needsSocialRetirementCleanup) {
      await _runSocialRetirementCleanupPass({ state, currentVersion });
    }

    if (needsItemMigration) {
      await _runVersionedItemMigrationPass({ state, currentVersion });
    }

    if (needsScrollCastingBackfill || needsScrollConsumeOnCastBackfill) {
      await _runScrollCastingBackfillPass({
        state,
        currentVersion,
        defaults,
        needsScrollCastingBackfill,
        needsScrollConsumeOnCastBackfill,
      });
    }

    // Record migration version after a successful pass.
    await setMigrationState(state);
  } catch (err) {
    console.error(`${MODULE_ID} | Item migration failed`, err);
    ui.notifications?.error?.("UESRPG item migration failed; check console for details.");
  }
}

// ---------------------------------------------------------------------------
// Always-safe normalization (not version-gated)
// ---------------------------------------------------------------------------

function _deepCloneSystem(sys) {
  try {
    return foundry?.utils?.deepClone ? foundry.utils.deepClone(sys ?? {}) : structuredClone(sys ?? {});
  } catch (_e) {
    return JSON.parse(JSON.stringify(sys ?? {}));
  }
}

function _ensureArmorItemCatNonBreaking(system) {
  // Non-breaking guardrail: template.json defines armor.item_cat as a mapping object,
  // but runtime code expects a string category in some places.
  // Normalization must NOT convert types.
  if (!Object.prototype.hasOwnProperty.call(system, "item_cat")) {
    system.item_cat = "";
    return true;
  }
  return false;
}

function _applyLegacyGuardrails(item, system) {
  const update = { changed: false, deleteEquippped: false };
  const itemType = String(item?.type ?? "").toLowerCase();
  const usesPhysicalGuardrails = new Set(["item", "equipment", "weapon", "armor", "shield", "ammunition"]);

  // Fix legacy typo: equippped -> equipped
  if (Object.prototype.hasOwnProperty.call(system, "equippped")) {
    if (!Object.prototype.hasOwnProperty.call(system, "equipped")) {
      system.equipped = !!system.equippped;
      update.changed = true;
    }
    try {
      delete system.equippped;
    } catch (_e) {
      // ignore
    }
    update.deleteEquippped = true;
    update.changed = true;
  }

  if (!usesPhysicalGuardrails.has(itemType)) return update;

  try {
    if (_repairWeaponReachFromSafeFallback(system, item?.flags ?? {}, { attackMode: system.attackMode })) {
      update.changed = true;
    }
  } catch (_e) {
    // best-effort only
  }

  // reachMin sanitize (numeric, >= 0)
  if (system.reachMin === undefined || system.reachMin === null || system.reachMin === "") {
    system.reachMin = 0;
    update.changed = true;
  } else {
    const n = Number(system.reachMin);
    if (!Number.isFinite(n) || n < 0) {
      system.reachMin = 0;
      update.changed = true;
    }
  }

  // enchant_level sanitize: invalid => 0, and strip legacy "1" without transfer effects
  try {
    const raw = system.enchant_level;
    const n = Number(raw);
    if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) {
      system.enchant_level = 0;
      update.changed = true;
    } else if (n === 1 && !_itemHasTransferEffects(item)) {
      system.enchant_level = 0;
      update.changed = true;
    }
  } catch (_e) {
    // ignore
  }

  return update;
}

function _applySystemUpdateObject(system, updateObject = {}) {
  for (const [k, v] of Object.entries(updateObject ?? {})) {
    if (!k.startsWith("system.")) continue;
    const path = k.slice("system.".length);
    if (!path) continue;
    if (path.startsWith("-=")) continue;
    foundry.utils.setProperty(system, path, v);
  }
}

function _normalizeItemSystem(item) {
  const sourceType = item?.type;
  let type = sourceType === "item" ? "equipment" : sourceType;
  if (!type) return null;
  const sourceSystem = _deepCloneSystem(item.system);
  const isLegacyArmorShield = (
    sourceType === "armor" && (
      sourceSystem?.isShield === true ||
      String(sourceSystem?.item_cat ?? "").trim().toLowerCase() === "shield" ||
      String(sourceSystem?.category ?? "").trim().toLowerCase() === "shield"
    )
  );
  if (isLegacyArmorShield) type = "shield";
  const hasDefaults = Object.prototype.hasOwnProperty.call(DEFAULTS?.itemSystem ?? {}, type);
  if (!hasDefaults && type !== "equipment") return null;

  const currentSystem = sourceSystem;
  let preChanged = false;
  if (sourceType === "armor" || type === "armor") {
    preChanged = _applyLegacyArmorTypedFields(currentSystem) || preChanged;
  }
  let system = currentSystem;
  let defaultsChanged = false;
  if (hasDefaults) {
    const ignorePaths = (DEFAULTS.__meta?.ignorePathsByType?.[type] ?? []).slice();
    const allowNonNumeric = _NON_NUMERIC_ALLOWLIST[type] ?? [];
    for (const key of allowNonNumeric) {
      if (_isNonNumericString(currentSystem[key])) ignorePaths.push(key);
    }
    const defaultsResult = applyDefaults(
      currentSystem,
      DEFAULTS.itemSystem[type],
      { coerce: true, ignorePaths, clone: false }
    );
    system = defaultsResult.result;
    defaultsChanged = defaultsResult.changed;
  }

  let changed = Boolean(defaultsChanged || preChanged);
  let deleteEquippped = false;

  if (type === "weapon") {
    const wUpdate = _normalizeWeaponSystem(item, system);
    if (Object.keys(wUpdate).length) {
      _applySystemUpdateObject(system, wUpdate);
      changed = true;
      if (Object.prototype.hasOwnProperty.call(wUpdate, "system.-=equippped")) deleteEquippped = true;
    }
  }

  if (type === "armor") {
    const aUpdate = _normalizeArmorSystem(item, system);
    if (Object.keys(aUpdate).length) {
      _applySystemUpdateObject(system, aUpdate);
      changed = true;
    }
    if (_ensureArmorItemCatNonBreaking(system)) changed = true;
  }

  if (type === "shield") {
    const sUpdate = _normalizeShieldSystem(item, system);
    if (Object.keys(sUpdate).length) {
      _applySystemUpdateObject(system, sUpdate);
      changed = true;
    }
  }

  if (type === "ammunition") {
    const ammoUpdate = _normalizeAmmoSystem(item, system);
    if (Object.keys(ammoUpdate).length) {
      _applySystemUpdateObject(system, ammoUpdate);
      changed = true;
    }
  }

  // Legacy guardrails (shared)
  const legacy = _applyLegacyGuardrails(item, system);
  if (legacy.changed) changed = true;
  if (legacy.deleteEquippped) deleteEquippped = true;

  if (!changed && !deleteEquippped && sourceType === type) return null;

  const update = { system };
  if (sourceType !== type) update.type = type;
  if (deleteEquippped) update["system.-=equippped"] = null;
  return update;
}

export async function normalizeItems() {
  if (!game.user.isGM) return;
  try {
    await _processWorldItems("Normalizing");
    await _processActorItems("Normalizing");
  } catch (err) {
    console.error(`${MODULE_ID} | Item normalization failed`, err);
    ui.notifications?.error?.("UESRPG item normalization failed; check console for details.");
  }
}
