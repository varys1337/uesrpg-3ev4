/**
 * src/core/combat/defense-options.js
 *
 * Canonical defense option availability computation for the opposed workflow.
 *
 * Goals:
 *  - Deterministic, context-driven gating (no DOM state).
 *  - Single source of truth for "is this defense option legal right now?".
 *  - Safe fallback selection when an illegal option is requested.
 *
 * This module intentionally contains ONLY the already-implemented gating
 * semantics:
 *  - Ranged attacks cannot be Parried or Counter-Attacked.
 *  - Magic attacks cannot be Parried or Counter-Attacked.
 *  - Flail attacks cannot be Parried or Counter-Attacked.
 *  - Entangling attacks cannot be Parried or Blocked.
 *  - A Small weapon cannot Parry/Counter against a Two-Handed weapon.
 *  - Block requires either an equipped shield or an eligible Ward spell.
 */

/**
 * @typedef {object} DefenseAvailability
 * @property {{evade: boolean, parry: boolean, block: boolean, counter: boolean}} allowed
 * @property {{evade: string[], parry: string[], block: string[], counter: string[]}} reasons
 * @property {{isRangedAttack: boolean, isMagicAttack: boolean, attackerHasFlail: boolean, attackerHasEntangling: boolean, smallVsTwoHandedGate: boolean, shieldOk: boolean, wardOk: boolean, blockSources: {shield: boolean, ward: boolean}}} gates
 */

function _asBool(v) {
  return Boolean(v);
}

function _lower(v) {
  return String(v ?? "").trim().toLowerCase();
}

/**
 * Compute which defense options are legal for a given attack context.
 *
 * @param {object} params
 * @param {string} params.attackMode - "melee" | "ranged" | "magic" (free text tolerated)
 * @param {{flail?: boolean, entangling?: boolean, isTwoHanded?: boolean}|null} params.attackerWeaponTraits
 * @param {boolean} params.defenderHasSmallWeapon
 * @param {boolean} params.defenderHasShield
 * @param {string[]|null} params.allowedDefenseTypes
 * @returns {DefenseAvailability}
 */
export function computeDefenseAvailability({
  attackMode,
  attackerWeaponTraits,
  defenderHasSmallWeapon,
  defenderHasShield,
  defenderHasWard = false,
  allowedDefenseTypes,
  // Talent / feature overrides (schema-safe; optional)
  allowParryRanged = false
} = {}) {
  const mode = _lower(attackMode);
  const isRangedAttack = (mode === "ranged");
  const isMagicAttack = (mode === "magic");

  const attackerHasFlail = _asBool(attackerWeaponTraits?.flail);
  const attackerHasEntangling = _asBool(attackerWeaponTraits?.entangling);
  const attackerIsTwoHanded = _asBool(attackerWeaponTraits?.isTwoHanded);
  const smallVsTwoHandedGate = _asBool(defenderHasSmallWeapon) && attackerIsTwoHanded;

  const shieldOk = _asBool(defenderHasShield);
  const wardOk = _asBool(defenderHasWard);

  const reasons = {
    evade: [],
    parry: [],
    block: [],
    counter: []
  };

  // Evade is always available within the current opposed workflow semantics.
  const allowed = {
    evade: true,
    parry: true,
    block: shieldOk || wardOk,
    counter: true
  };

  if (!allowed.block) {
    reasons.block.push("Requires an equipped shield or eligible Ward spell.");
  }

  // Entangling (RAW): cannot be parried or blocked.
  if (attackerHasEntangling) {
    allowed.block = false;
    allowed.parry = false;
    reasons.block.push("Entangling attacks cannot be blocked.");
    reasons.parry.push("Entangling attacks cannot be parried.");
  }

  // Parry restrictions.
  if (isRangedAttack) {
    if (!allowParryRanged) {
      allowed.parry = false;
      reasons.parry.push("Ranged attacks cannot be parried.");
    }
  }
  if (isMagicAttack) {
    allowed.parry = false;
    reasons.parry.push("Magic attacks cannot be parried.");
  }
  if (attackerHasFlail) {
    allowed.parry = false;
    reasons.parry.push("Flail attacks cannot be parried.");
  }
  if (smallVsTwoHandedGate) {
    allowed.parry = false;
    reasons.parry.push("A Small weapon cannot Parry against a two-handed weapon.");
  }

  // Counter-Attack restrictions.
  // Note: Entangling does not explicitly forbid Counter-Attack in RAW.
  if (isRangedAttack) {
    allowed.counter = false;
    reasons.counter.push("Ranged attacks cannot be counter-attacked.");
  }
  if (isMagicAttack) {
    allowed.counter = false;
    reasons.counter.push("Magic attacks cannot be counter-attacked.");
  }
  if (attackerHasFlail) {
    allowed.counter = false;
    reasons.counter.push("Flail attacks cannot be counter-attacked.");
  }
  if (smallVsTwoHandedGate) {
    allowed.counter = false;
    reasons.counter.push("A Small weapon cannot Counter-Attack against a two-handed weapon.");
  }

  const allowedSet = Array.isArray(allowedDefenseTypes) && allowedDefenseTypes.length
    ? new Set(allowedDefenseTypes.map(_lower))
    : null;
  if (allowedSet) {
    // Back-compat: treating "ward" as a flavor of block source, not a top-level defense lane.
    if (allowedSet.has("ward")) allowedSet.add("block");
    for (const key of Object.keys(allowed)) {
      if (!allowedSet.has(key)) {
        allowed[key] = false;
        reasons[key].push("Not available for this attack.");
      }
    }
  }

  return {
    allowed,
    reasons,
    gates: {
      isRangedAttack,
      isMagicAttack,
      attackerHasFlail,
      attackerHasEntangling,
      smallVsTwoHandedGate,
      shieldOk,
      wardOk,
      blockSources: {
        shield: shieldOk,
        ward: wardOk
      }
    }
  };
}

/**
 * Normalize a requested defenseType to a legal option.
 *
 * @param {string} requested
 * @param {DefenseAvailability} availability
 * @param {string} [fallback="evade"]
 * @returns {string}
 */
export function normalizeDefenseType(requested, availability, fallback = "evade") {
  const req = _lower(requested) || "evade";
  const fb = _lower(fallback) || "evade";
  const allowed = availability?.allowed ?? null;
  if (!allowed) return "evade";

  const isAllowed = (k) => Boolean(allowed?.[k]);

  if (isAllowed(req)) return req;
  if (isAllowed(fb)) return fb;
  // Hard fallback: within our semantics, evade should always be allowed.
  if (isAllowed("evade")) return "evade";

  // If we ever reach here, choose the first allowed option in a stable order.
  for (const k of ["block", "parry", "counter"]) {
    if (isAllowed(k)) return k;
  }
  return "evade";
}
