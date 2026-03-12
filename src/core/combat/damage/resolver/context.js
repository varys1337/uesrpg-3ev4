/**
 * src/core/combat/damage/resolver/context.js
 *
 * Damage context builder - normalizes resolver payloads into canonical damage contexts.
 *
 * Responsibilities:
 *  - Extract and normalize raw damage, damage type, hit location
 *  - Resolve weapon/ammo references from UUIDs
 *  - Shape options object for damage-automation
 *  - Toggle known boolean options deterministically
 */

import { normalizeHitLocation, normalizeDamageType, asNumber } from "./normalize.js";
import { DAMAGE_TYPES } from "../../damage-automation.js";
import { _resolveItemViaActor } from "../../opposed/helpers/docs.js";

/**
 * Build the canonical damage context from a resolver payload.
 * @param {object} payload
 * @returns {{rawDamage:number, damageType:string, options:object}}
 */
export function buildDamageContext(payload = {}) {
  const rawDamage = asNumber(payload.rawDamage ?? payload.damage ?? 0);
  const dosBonus = asNumber(payload.dosBonus ?? 0);
  const penetration = asNumber(payload.penetration ?? 0);
  const damagedValue = Math.max(0, asNumber(payload.damagedValue ?? 0));
  const hitLocation = normalizeHitLocation(payload.hitLocation ?? payload.location ?? "Body");
  const damageType = normalizeDamageType(payload.damageType ?? DAMAGE_TYPES.PHYSICAL);
  const attackModeRaw = String(payload.attackMode ?? "").trim().toLowerCase();
  const movementActionRaw = String(payload.movementAction ?? "").trim().toLowerCase();
  const attackFromHidden = (typeof payload.attackFromHidden === "boolean")
    ? payload.attackFromHidden
    : (String(payload.attackFromHidden ?? "").trim() === "1" ? true : (String(payload.attackFromHidden ?? "").trim() === "0" ? false : null));
  const parsedComponents = (() => {
    const raw = payload?.damageComponents;
    const source = typeof raw === "string"
      ? (() => {
        try { return JSON.parse(raw); } catch (_e) { return null; }
      })()
      : raw;
    if (!Array.isArray(source)) return null;
    const out = source
      .map((c) => {
        const amount = asNumber(c?.amount ?? 0);
        if (!(amount > 0)) return null;
        return {
          amount,
          damageType: normalizeDamageType(c?.damageType ?? damageType),
          hitLocation: normalizeHitLocation(c?.hitLocation ?? hitLocation),
          source: String(c?.source ?? "").trim() || null,
          sourceLabel: String(c?.sourceLabel ?? "").trim() || "Attack",
          sourceItemUuid: String(c?.sourceItemUuid ?? "").trim() || null,
        };
      })
      .filter(Boolean);
    return out.length ? out : null;
  })();

  let weapon = payload.weapon ?? null;
  const fallbackActor = payload.attackerActor ?? null;
  if (!weapon && payload.weaponUuid) {
    try {
      weapon = _resolveItemViaActor(payload.weaponUuid, fallbackActor) ?? null;
    } catch (_err) {
      weapon = null;
    }
  }
  if (!weapon && payload.sourceItemUuid) {
    try {
      weapon = _resolveItemViaActor(payload.sourceItemUuid, fallbackActor) ?? null;
    } catch (_err) {
      weapon = null;
    }
  }
  if (!weapon && payload.sourceItem) {
    weapon = payload.sourceItem;
  }

  let ammo = payload.ammo ?? null;
  if (!ammo && payload.ammoUuid) {
    try {
      ammo = _resolveItemViaActor(payload.ammoUuid, fallbackActor) ?? null;
    } catch (_err) {
      ammo = null;
    }
  }
  if (!ammo && payload.ammoId && weapon?.actor?.items?.get) {
    const ammoId = String(payload.ammoId ?? "").trim();
    if (ammoId) {
      ammo = weapon.actor.items.get(ammoId) ?? null;
    }
  }

  const options = {
    // Damage-automation options (kept stable)
    ignoreReduction: payload.ignoreReduction === true,
    penetrateArmorForTriggers: payload.penetrateArmorForTriggers === true,
    forcefulImpact: payload.forcefulImpact === true,
    pressAdvantage: payload.pressAdvantage === true,
    source: payload.source ?? "Unknown",
    hitLocation,
    dosBonus,
    penetration,
    damagedValue,

    // Optional enrichment
    weapon,
    attackerActor: payload.attackerActor ?? null,
    ammo,
    attackMode: attackModeRaw || null,
    movementAction: movementActionRaw || null,
    attackFromHidden,
    magicSource: payload.magicSource === true,
    chatContext: (payload.chatContext && typeof payload.chatContext === "object")
      ? foundry.utils.deepClone(payload.chatContext)
      : null,
  };

  _toggleKnownOption(payload, options, "ignoreArmor");
  _toggleKnownOption(payload, options, "ignoreResistance");

  return { rawDamage, damageType, options, components: parsedComponents };
}

/**
 * Internal helper: copy known boolean option from payload to options if present.
 * @param {object} payload
 * @param {object} options
 * @param {string} key
 */
function _toggleKnownOption(payload, options, key) {
  if (payload && Object.prototype.hasOwnProperty.call(payload, key)) {
    options[key] = payload[key];
  }
}
