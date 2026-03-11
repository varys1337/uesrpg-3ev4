/**
 * src/core/active-effects/transfer.js
 *
 * Deterministic "transfer" semantics for Item Active Effects.
 * This system does not rely on implicit Foundry transfer application in roll pipelines.
 *
 * Design goals:
 *  - Explicit, predictable, and type-gated application
 *  - Backward compatible with existing item data (no schema migrations required)
 *  - Forward compatible for spells: spell effects may be enabled later via an explicit "active" flag
 *
 * NOTE: This module is UI-layer agnostic and does not depend on sheet or app classes.
 */

/**
 * Determine whether a transfer=true Active Effect on an Item should be considered active for the Actor.
 *
 * Current v1 rules:
 *  - talent / trait / power: always active (passive features)
 *  - weapon / armor / shield: active only when item.system.equipped === true
 *  - spell: inactive unless the item is explicitly marked active via one of:
 *      item.system.active, item.system.isActive, item.flags.uesrpg?.activeSpell
 *    (these fields can be introduced later without rewriting this function)
 *  - other item types: inactive by default (conservative; we whitelist types deliberately)
 */

import { getRuntimeSystemId } from "../system/namespace.js";

// Module-level cache for the passive-transfer setting. Invalidated on settings
// change so we avoid re-parsing the setting string on every isTransferEffectActive
// call (~60+ per actor per prepare cycle).
let _passiveTypesCache = null;
let _passiveTypesCacheRaw = undefined;

function getPassiveTransferItemTypes() {
  try {
    const raw = game?.settings?.get?.(getRuntimeSystemId(), "passiveTransferItemTypes") ?? "";
    // Return cached result if the underlying setting value hasn't changed.
    if (_passiveTypesCache !== null && raw === _passiveTypesCacheRaw) return _passiveTypesCache;
    _passiveTypesCacheRaw = raw;
    _passiveTypesCache = new Set(
      String(raw)
        .split(",")
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
    );
    return _passiveTypesCache;
  } catch (_e) {
    return new Set();
  }
}

export function isTransferEffectActive(actor, item, effect) {
  if (!effect?.transfer) return false;
  if (effect?.disabled) return false;
  if (!item) return false;

  const type = String(item.type ?? "").toLowerCase();
  const passiveTypes = getPassiveTransferItemTypes();

  // If configured as passive-transfer, it's always active while owned (in inventory).
  if (passiveTypes.has(type)) return true;

  // PASSIVE FEATURE TYPES: ALWAYS ACTIVE
  // Talents, Traits, and Powers are inherent character abilities.
  // They do NOT require equipment status - they are always "on".
  // These represent passive character features like racial abilities, learned talents, etc.
  // Exception: if suppressSelfTransfer is enabled, the item's AEs should NOT
  // apply to the owning actor (they are meant to be transferred to targets instead).
  if (type === "talent" || type === "trait" || type === "power") {
    try {
      const suppress = item.getFlag?.(getRuntimeSystemId(), "featureConfig")?.suppressSelfTransfer
        ?? item.getFlag?.("uesrpg-3ev4", "featureConfig")?.suppressSelfTransfer;
      if (suppress === true) return false;
    } catch (_e) { /* safe fallback — allow transfer */ }
    return true;
  }
  
  // EQUIPMENT TYPES: REQUIRE EQUIPPED STATUS
  // Weapons and armor must be equipped to provide their active effects.
  const equipped = item?.system?.equipped;

  if (type === "weapon") return _isWeaponEquippedForActor(actor, item);
  if (type === "armor" || type === "shield") return equipped === true;
  
  // SPELL EFFECTS: EXPLICIT ACTIVATION ONLY
  // Spells may carry Item Active Effects, but they should not be implicitly "always on".
  // We activate spell transfer effects only when the spell is explicitly marked active.
  // Supported activation lanes (non-migrating):
  //  - item.flags.<systemId>.activeSpell (preferred; sheet checkbox)
  //  - item.system.active / item.system.isActive (legacy/compat)
  if (type === "spell") {
    const scope = getRuntimeSystemId();
    const flagActive = item.getFlag?.(scope, "activeSpell") ?? foundry.utils.getProperty(item, `flags.${scope}.activeSpell`);
    const sysActive = item?.system?.active ?? item?.system?.isActive;
    return flagActive === true || sysActive === true;
  }


  // Conservative default: do not apply unless explicitly supported.
  return false;
}
/**
 * Determine whether a weapon item is considered "equipped" for transfer AE purposes.
 *
 * This system tracks equipped weapons via Actor.system.equippedWeapons.{primaryWeapon,secondaryWeapon}.id
 * (legacy nested variants may exist in some data). We also honor item.system.equipped where present.
 *
 * @param {any} actor
 * @param {any} item
 * @returns {boolean}
 */
function _isWeaponEquippedForActor(actor, item) {
  if (!actor || !item) return false;

  // 1) Explicit per-item equipped flag (if your item schema supports it)
  if (item?.system?.equipped === true) return true;

  const itemId = item?.id;
  if (!itemId) return false;

  // 2) System weapon binding (primary/secondary)
  const ew = actor?.system?.equippedWeapons;

  // Common shape: actor.system.equippedWeapons.primaryWeapon.id
  const primary = ew?.primaryWeapon?.id;
  const secondary = ew?.secondaryWeapon?.id;
  if (primary === itemId || secondary === itemId) return true;

  // Legacy nested shape: actor.system.equippedWeapons.equippedWeapons.primaryWeapon.id
  const nested = ew?.equippedWeapons;
  const nPrimary = nested?.primaryWeapon?.id;
  const nSecondary = nested?.secondaryWeapon?.id;
  if (nPrimary === itemId || nSecondary === itemId) return true;

  return false;
}


// Backward-compatible alias for callers.
export const isItemEffectActive = isTransferEffectActive;
