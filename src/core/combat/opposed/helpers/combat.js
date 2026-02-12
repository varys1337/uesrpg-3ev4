/**
 * src/core/combat/opposed/helpers/combat.js
 * Weapon utilities and range/reach calculation helpers
 * Extracted from opposed-workflow.js monolith (Phase 5)
 */

import { getAttackModeFromWeapon, getEffectiveWeaponHands } from "../../combat-utils.js";
import { weaponHasQuality as _weaponHasQuality } from "./workflow.js";
import { _normalizeKey } from "./util.js";
import { _measureTokenDistance } from "./docs.js";

// ====== WEAPON UTILITIES ======

/**
 * Get all equipped weapons for an actor (from binding + equipped flag)
 */
export function getEquippedWeaponItems(actor) {
  const weaponMap = new Map();
  const addWeapon = (it) => {
    if (!it || it.type !== 'weapon') return;
    if (!it.id) return;
    weaponMap.set(String(it.id), it);
  };

  try {
    const ew = actor?.system?.equippedWeapons;
    const boundIds = [
      ew?.primaryWeapon?.id,
      ew?.secondaryWeapon?.id,
      ew?.equippedWeapons?.primaryWeapon?.id,
      ew?.equippedWeapons?.secondaryWeapon?.id
    ].filter(Boolean);

    for (const id of boundIds) {
      const bound = actor?.items?.get?.(id);
      if (bound) addWeapon(bound);
    }
  } catch (_e) {
    // ignore
  }

  for (const it of (actor?.items ?? [])) {
    if (!it || it.type !== 'weapon') continue;
    if (!it.system || !Object.prototype.hasOwnProperty.call(it.system, 'equipped')) continue;
    if (it.system.equipped === true) addWeapon(it);
  }

  return Array.from(weaponMap.values());
}

/**
 * Get equipped one-handed melee weapons for an actor
 */
export function getEquippedOneHandMeleeWeapons(actor) {
  const weapons = [];
  for (const it of (actor?.items ?? [])) {
    if (!it || it.type !== "weapon") continue;
    if (it.system?.equipped !== true) continue;
    const mode = getAttackModeFromWeapon(it);
    if (String(mode ?? "").toLowerCase() !== "melee") continue;
    const hands = getEffectiveWeaponHands(it);
    if (Number(hands) !== 1) continue;
    weapons.push(it);
  }
  return weapons;
}

/**
 * Get the other weapon in a dual-wield setup (for talents like Dual-Wield Master)
 */
export function getOtherDualWieldWeaponUuid(actor, currentWeaponUuid) {
  const weapons = getEquippedOneHandMeleeWeapons(actor);
  if (weapons.length < 2) return null;
  const cur = String(currentWeaponUuid ?? "");
  const other = weapons.find(w => String(w.uuid) !== cur) ?? null;
  return other?.uuid ?? null;
}

/**
 * Check if weapon has a specific trait in legacy free-text qualities field
 */
export function weaponHasTraitText(weapon, traitKey) {
  // Fallback for legacy weapons where traits are stored as free-text in system.qualities.
  const target = _normalizeKey(traitKey);
  if (!target) return false;
  const raw = String(weapon?.system?.qualities ?? "");
  if (!raw) return false;

  const text = raw
    .replace(/@Compendium\[[^\]]+\]\{([^}]+)\}/g, "$1")
    .replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = text
    .split(/[^A-Za-z0-9]+/)
    .map(t => _normalizeKey(t))
    .filter(Boolean);

  if (tokens.includes(target)) return true;

  // Last resort substring for edge-case legacy exports.
  const legacy = _normalizeKey(text);
  return !!(legacy && legacy.includes(target));
}

// ====== RANGE BAND PARSING ======

/**
 * Parse range triplet from string like "10/30/60"
 */
function _parseRangeTriplet(text) {
  if (!text) return null;
  const m = String(text).match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  return {
    close: Number(m[1]) || 0,
    effective: Number(m[2]) || 0,
    long: Number(m[3]) || 0
  };
}

/**
 * Parse range bands from legacy weapon free-text qualities
 */
export function parseRangeBandsFromWeapon(weapon) {
  // Chapter 7 formatting in compendium exports commonly embeds:
  //   "Ranged (7/27/52)" or "Thrown (3/8/16)" inside system.qualities as rich text.
  const raw = String(weapon?.system?.qualities ?? "");
  if (!raw) return null;

  const text = raw
    .replace(/@Compendium\[[^\]]+\]\{([^}]+)\}/g, "$1")
    .replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const mRanged = text.match(/\bRanged\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*\)/i);
  const mThrown = text.match(/\bThrown\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*\)/i);

  const ranged = mRanged
    ? { close: Number(mRanged[1]), effective: Number(mRanged[2]), long: Number(mRanged[3]) }
    : null;
  const thrown = mThrown
    ? { close: Number(mThrown[1]), effective: Number(mThrown[2]), long: Number(mThrown[3]) }
    : null;

  return { ranged, thrown };
}

/**
 * Get weapon range bands (close/medium/long) from weapon data
 */
export function getWeaponRangeBands(weapon) {
  const sys = weapon?.system ?? {};

  // Preferred: derived range bands (effective first), as computed in src/core/documents/item.js.
  // That lane uses close/effective/long keys; this workflow uses close/medium/long.
  const src = sys.rangeBandsDerivedEffective ?? sys.rangeBandsDerived ?? null;
  if (src && Number.isFinite(Number(src.long))) {
    return {
      kind: src.kind ?? null,
      source: src.source ?? null,
      close: Number(src.close) || 0,
      medium: Number(src.medium ?? src.effective) || 0,
      long: Number(src.long) || 0,
      rangeMod: Number(src.rangeMod) || 0,
      display: src.display ?? null
    };
  }

  // Secondary: explicit system.range (common on legacy items) in "S/M/L" format.
  // NOTE: This is distinct from Reach; ranged weapons should populate system.range.
  const fromRangeField = _parseRangeTriplet(sys.range);
  if (fromRangeField && Number.isFinite(Number(fromRangeField.long))) {
    return {
      kind: "ranged",
      source: "rangeField",
      close: Number(fromRangeField.close) || 0,
      medium: Number(fromRangeField.effective) || 0,
      long: Number(fromRangeField.long) || 0,
      rangeMod: 0,
      display: `${Number(fromRangeField.close)}/${Number(fromRangeField.effective)}/${Number(fromRangeField.long)}`
    };
  }

  // Legacy fallback: parse bands from free-text qualities for weapons that were not migrated.
  const parsed = parseRangeBandsFromWeapon(weapon);
  if (!parsed) return null;

  const isThrown = weapon ? (_weaponHasQuality(weapon, "thrown") || weaponHasTraitText(weapon, "thrown")) : false;
  const b = isThrown ? (parsed.thrown ?? null) : (parsed.ranged ?? null);
  if (!b || !Number.isFinite(Number(b.long))) return null;

  return {
    kind: isThrown ? "thrown" : "ranged",
    source: "qualities",
    close: Number(b.close) || 0,
    medium: Number(b.effective) || 0,
    long: Number(b.long) || 0
  };
}

// ====== RANGE CONTEXT COMPUTATION ======

/**
 * Compute ranged attack context (distance, band, TN modifier)
 */
export function computeRangedRangeContext({ attackerToken, defenderToken, weapon }) {
  const bands = getWeaponRangeBands(weapon);
  if (!bands) return null;

  const distance = _measureTokenDistance(attackerToken, defenderToken);
  if (distance == null) return {
    distance: null,
    band: null,
    tnMod: 0,
    close: Number(bands.close) || 0,
    medium: Number(bands.medium) || 0,
    long: Number(bands.long) || 0,
    outOfRange: false,
    reason: "no-distance"
  };

  const close = Number(bands.close) || 0;
  const medium = Number(bands.medium) || 0;
  const long = Number(bands.long) || 0;

  if (long > 0 && distance > long) {
    return { distance, band: "out", tnMod: 0, close, medium, long, outOfRange: true, reason: "out-of-range" };
  }

  if (close > 0 && distance <= close) {
    return { distance, band: "close", tnMod: +10, close, medium, long, outOfRange: false };
  }
  if (medium > 0 && distance <= medium) {
    return { distance, band: "medium", tnMod: 0, close, medium, long, outOfRange: false };
  }
  // Long band includes any distance up to (and including) long.
  return { distance, band: "long", tnMod: -20, close, medium, long, outOfRange: false };
}

// ====== REACH MECHANICS ======

/**
 * Get weapon reach bounds (min/max)
 */
export function getWeaponReachBounds(weapon) {
  const sys = weapon?.system ?? {};
  const max = Number(sys.reach ?? 0);
  const min = Number(sys.reachMin ?? 0);
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0
  };
}

/**
 * Compute melee reach context (distance, min/max reach, in-range check)
 */
export function computeMeleeReachContext({ attackerToken, defenderToken, weapon }) {
  const { min, max } = getWeaponReachBounds(weapon);
  if (!(min > 0) && !(max > 0)) return null;

  const distance = _measureTokenDistance(attackerToken, defenderToken);
  if (distance == null) {
    return { distance: null, min, max, inRange: true, reason: "no-distance" };
  }

  // Minimum reach (e.g., polearms). RAW: cannot attack targets closer than min.
  if (min > 0 && distance < min) {
    return { distance, min, max, inRange: false, reason: "too-close" };
  }

  // Maximum reach: cannot attack beyond max.
  if (max > 0 && distance > max) {
    return { distance, min, max, inRange: false, reason: "too-far" };
  }

  return { distance, min, max, inRange: true, reason: null };
}
