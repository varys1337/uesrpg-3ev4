/**
 * src/core/enchanting/runtime/strike-runtime.js
 *
 * Strike Enchantment Runtime — on-hit combat integration.
 *
 * Responsibilities:
 *  - Inspect weapon strike enchantment flags and collect per-hit effects.
 *  - Return typed damage components (fire/frost/shock) ready for the resolve pipeline.
 *  - Return non-damage side effects (drain, absorb, condition, soulTrap, dispel, disintegrate)
 *    for deferred application via the uesrpgDamageApplied hook.
 *  - Handle charge consumption for the "Charged Strike Variant" setting.
 *
 * Called from: src/core/combat/damage/resolver/resolve.js
 * Hook consumer: src/core/enchanting/runtime/strike-on-hit.js
 *
 * Target: Foundry VTT v13.351
 */

import { STRIKE_ENCHANTMENTS_CATALOG } from "../../../data/strike-enchantments-catalog.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../../constants.js";
import { isDebugEnabled } from "../../../utils/debug.js";

// ---------------------------------------------------------------------------
// O(1) catalog lookup
// ---------------------------------------------------------------------------

/**
 * Pre-built Map for O(1) strike enchantment lookup by key.
 * Built once at module init; never mutated.
 * @type {Map<string, object>}
 */
const STRIKE_ENCHANTMENTS_BY_KEY = new Map(
  STRIKE_ENCHANTMENTS_CATALOG.map(e => [e.key, e])
);

/**
 * Resolve a stored effect key to its canonical catalog key.
 *
 * Handles the historical naming inconsistency between the catalog key
 * ("absorpHealth", original) and any world data that may use the correctly
 * spelled variant ("absorbHealth"). Does NOT migrate stored data — only
 * applied during lookup.
 *
 * @param {string} key
 * @returns {string}
 */
function _resolveStrikeKey(key) {
  // "absorbHealth" (correctly spelled) → "absorpHealth" (catalog's historical key).
  if (key === "absorbHealth") return "absorpHealth";
  return key;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read and validate enchanting flags from a weapon item.
 * @param {Item} weapon
 * @returns {object|null} The strike enchantment config, or null if not applicable.
 */
function _getStrikeEnc(weapon) {
  if (!weapon || weapon.documentName !== "Item") return null;
  const enc = weapon.flags?.[SYSTEM_ID]?.enchanting ?? null;
  if (!enc || enc.version !== 2 || enc.enchantType !== "strike") return null;
  if (!Array.isArray(enc.strike?.effects) || enc.strike.effects.length === 0) return null;
  return enc;
}

/**
 * Check if there is sufficient charge to fire the enchantment.
 * When useCharges is false, enchantment fires unconditionally.
 * @param {Item} weapon
 * @param {object} enc - Validated strike enc object
 * @returns {boolean}
 */
function _hasCharge(weapon, enc) {
  if (!enc.strike.useCharges) return true;
  const chargeValue = Number(weapon.system?.charge?.value ?? 0);
  return chargeValue > 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect strike enchantment effects that should fire on a successful hit.
 *
 * Returns:
 *  - damageComponents: typed damage entries ready for the resolve.js components array.
 *    Each entry has: { kind, amount, damageType, applyDefenderAdjust, sourceLabel }
 *  - sideEffects: non-damage effects for deferred application (drain, condition, etc.).
 *    Each entry has: { effectType, key, sl, y, type, catalog, weaponName, attackerActorId }
 *  - chargeConsumptionNeeded: true if charge should be decremented after damage is applied.
 *
 * @param {Item} weapon
 * @param {Actor|null} attackerActor
 * @returns {{ damageComponents: object[], sideEffects: object[], chargeConsumptionNeeded: boolean }}
 */
export function collectStrikeEnchantmentEffects(weapon, attackerActor) {
  const empty = { damageComponents: [], sideEffects: [], chargeConsumptionNeeded: false };

  const enc = _getStrikeEnc(weapon);
  if (!enc) return empty;

  if (!_hasCharge(weapon, enc)) {
    if (isDebugEnabled()) {
      console.debug("UESRPG | Strike enchantment skipped — no charge remaining on", weapon.name);
    }
    return empty;
  }

  const damageComponents = [];
  const sideEffects = [];
  const weaponName = weapon.name ?? "Enchanted Weapon";
  const attackerActorId = attackerActor?.id ?? null;
  const attackerActorUuid = attackerActor?.uuid ?? null;

  for (const effect of enc.strike.effects) {
    const catalogEntry = STRIKE_ENCHANTMENTS_BY_KEY.get(_resolveStrikeKey(effect.key));
    if (!catalogEntry) {
      console.warn(`UESRPG | Strike enchantment key "${effect.key}" not found in catalog — skipping.`);
      continue;
    }

    if (catalogEntry.effectType === "damage" && catalogEntry.damageType) {
      // Fire, frost, shock: add as typed damage component in the resolve pipeline.
      // Amount = SL stored on the effect (from the enchanting workshop).
      const amount = Number(effect.sl ?? 0);
      if (amount <= 0) continue;

      damageComponents.push({
        kind: "enchant",
        amount,
        damageType: catalogEntry.damageType,
        applyDefenderAdjust: false,
        sourceLabel: `${weaponName} — ${catalogEntry.label}`,
        breakdown: { enchantKey: effect.key, sl: effect.sl },
      });
    } else {
      // Drain, absorb, condition, soulTrap, dispel, disintegrate:
      // Collect for deferred application via uesrpgDamageApplied hook.
      sideEffects.push({
        effectType: catalogEntry.effectType,
        key: effect.key,
        sl: Number(effect.sl ?? 0),
        y: Number(effect.y ?? 0),
        type: effect.type ?? null,
        catalog: catalogEntry,
        weaponName,
        attackerActorId,
        attackerActorUuid,
      });
    }
  }

  const chargeConsumptionNeeded = enc.strike.useCharges === true;

  return { damageComponents, sideEffects, chargeConsumptionNeeded };
}

/**
 * Decrement the weapon's strike enchantment charge by 1 after a successful hit.
 * No-op if the weapon does not use the Charged Strike Variant.
 *
 * Must be called AFTER damage is applied (post uesrpgDamageApplied hook).
 *
 * @param {Item} weapon
 * @returns {Promise<void>}
 */
export async function consumeStrikeCharge(weapon) {
  const enc = _getStrikeEnc(weapon);
  if (!enc || enc.strike.useCharges !== true) return;

  const currentCharge = Number(weapon.system?.charge?.value ?? 0);
  if (currentCharge <= 0) return; // Nothing to consume (should not fire, but safe guard).

  const newCharge = Math.max(0, currentCharge - 1);
  await requestUpdateDocument(weapon, { "system.charge.value": newCharge });

  if (isDebugEnabled()) {
    console.debug(`UESRPG | Strike enchantment charge consumed on "${weapon.name}": ${currentCharge} → ${newCharge}`);
  }
}
