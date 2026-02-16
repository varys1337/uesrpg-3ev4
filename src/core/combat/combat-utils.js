/**
 * src/core/combat/combat-utils.js
 *
 * UESRPG 3e v4 — Combat utilities (Foundry VTT v13).
 *
 * This file was restored after an automated cleanup removed/mismerged the
 * original exports used by the opposed workflow and various sheets.
 *
 * Design constraints:
 *  - No schema changes
 *  - Deterministic, defensive behavior
 *  - Prefer explicit system fields when present; fall back to qualities/traits
 */

import { DAMAGE_TYPES, itemHasToken } from "./damage-automation.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";

const _KNOWN_DAMAGE_TYPES = new Set(Object.values(DAMAGE_TYPES).map((v) => String(v).toLowerCase()));
// Source-capability tags that should not override physical weapon damage type.
// These tags are used for incorporeal/resistance interactions, not typed damage lanes.
const _SOURCE_ONLY_DAMAGE_TAGS = new Set(["magic", "silver", "silvered", "runed"]);

/**
 * Infer damage type from a weapon item.
 *
 * Priority order:
 *  1) Explicit system fields (damageType, damage_type, damage_typeEffective, etc.)
 *  2) Structured qualities / traits containing a known damage type token
 *  3) Default to physical
 *
 * @param {Item|null} weapon
 * @returns {string} One of DAMAGE_TYPES.* values (lowercase string).
 */
export function getDamageTypeFromWeapon(weapon) {
  if (!weapon) return DAMAGE_TYPES.PHYSICAL;

  const sys = weapon.system ?? {};

  // 1) Explicit fields (some worlds may have legacy/custom data here).
  const explicitCandidates = [
    sys.damageType,
    sys.damage_type,
    sys.damageTypeEffective,
    sys.damage_typeEffective,
    sys.damage_type_effective,
    sys.damage?.type,
    sys.damage?.damageType,
  ].filter(Boolean);

  for (const c of explicitCandidates) {
    const v = String(c).trim().toLowerCase();
    if (v && _KNOWN_DAMAGE_TYPES.has(v)) return v;
  }

  // 2) Derive from qualities/traits.
  const tokens = [];

  const qInjected = Array.isArray(sys.qualitiesStructuredInjected) ? sys.qualitiesStructuredInjected : null;
  const qBase = Array.isArray(sys.qualitiesStructured) ? sys.qualitiesStructured : null;
  const structured = qInjected ?? qBase ?? [];

  for (const q of structured) {
    if (!q) continue;
    // common shapes: {key}, {name}, string
    if (typeof q === "string") tokens.push(q);
    else {
      if (q.key) tokens.push(q.key);
      if (q.name) tokens.push(q.name);
      if (q.label) tokens.push(q.label);
    }
  }

  const traits = Array.isArray(sys.qualitiesTraits) ? sys.qualitiesTraits : [];
  for (const t of traits) {
    if (!t) continue;
    tokens.push(String(t));
  }

  const normalized = tokens
    .map((t) => String(t).trim().toLowerCase())
    .filter(Boolean);

  // Recognize direct matches first.
  // Skip source-only tags so "Magic"/"Runed"/"Silvered" weapons remain physical unless
  // an explicit damage-type field says otherwise.
  for (const t of normalized) {
    if (_SOURCE_ONLY_DAMAGE_TAGS.has(t)) continue;
    if (_KNOWN_DAMAGE_TYPES.has(t)) return t;
  }

  // Recognize common composite labels (e.g. "fire damage", "magic (x)").
  for (const t of normalized) {
    if (_SOURCE_ONLY_DAMAGE_TAGS.has(t)) continue;
    for (const dt of _KNOWN_DAMAGE_TYPES) {
      if (_SOURCE_ONLY_DAMAGE_TAGS.has(dt)) continue;
      if (t.includes(dt)) return dt;
    }
  }

  return DAMAGE_TYPES.PHYSICAL;
}

/**
 * Get all damage instances for a weapon, including the base damage from existing fields.
 * Returns an array suitable for per-instance rolling, each with {formula, type, label}.
 * When no damageInstances are configured, wraps the base damage as a single entry.
 * @param {Item} weapon
 * @returns {Array<{formula: string, type: string, label: string}>}
 */
export function getWeaponDamageInstances(weapon) {
  const instances = [];

  // Primary instance from existing damage fields
  const baseDamage = String(
    weapon?.system?.damage3Effective ?? weapon?.system?.damage3
    ?? weapon?.system?.damage2Effective ?? weapon?.system?.damage2
    ?? weapon?.system?.damageEffective ?? weapon?.system?.damage ?? "0"
  );
  const primaryType = getDamageTypeFromWeapon(weapon);
  if (baseDamage && baseDamage !== "0") {
    instances.push({
      formula: baseDamage,
      type: primaryType,
      label: "Base"
    });
  }

  // Additional configured instances
  const extra = weapon?.system?.damageInstances;
  if (Array.isArray(extra)) {
    for (const inst of extra) {
      const formula = String(inst?.formula ?? "").trim();
      if (!formula) continue;
      instances.push({
        formula,
        type: String(inst?.type ?? "physical").toLowerCase(),
        label: String(inst?.label ?? "").trim()
      });
    }
  }

  return instances;
}

/**
 * Infer attack mode from a weapon item.
 *
 * @param {Item|null} weapon
 * @returns {"melee"|"ranged"|""}
 */
export function getAttackModeFromWeapon(weapon) {
  if (!weapon) return "";
  const sys = weapon.system ?? {};
  const modeRaw = String(sys.attackMode ?? sys.weaponType ?? sys.type ?? "").toLowerCase();
  if (modeRaw.includes("ranged")) return "ranged";
  if (itemHasToken(weapon, "thrown")) return "ranged";
  if (modeRaw.includes("melee")) return "melee";
  return "melee";
}

/**
 * Resolve weapon handedness in a way that supports "hand-and-a-half" weapons.
 *
 * Contract:
 *  - system.hands is a numeric enum-ish value:
 *      0  = unspecified
 *      1  = 1H
 *      1.5 = hand-and-a-half (versatile)
 *      2  = 2H
 *  - For hand-and-a-half weapons, the *effective* handedness depends on whether the
 *    weapon is currently being wielded in two hands (system.weapon2H).
 *
 * Heuristic (requested): when 1 < hands < 2, treat it as 1.5H and derive the
 * effective handedness from weapon2H:
 *  - weapon2H true  => effective 2H
 *  - weapon2H false => effective 1H
 *
 * @param {Item|null} weapon
 * @returns {{
 *   hands: number,
 *   isHandAndAHalf: boolean,
 *   effectiveHands: 0|1|2,
 *   isOneHanded: boolean,
 *   isTwoHanded: boolean
 * }}
 */
export function getEffectiveWeaponHands(weapon) {
  const raw = Number(weapon?.system?.hands ?? 0);
  const hands = Number.isFinite(raw) ? raw : 0;

  const isHandAndAHalf = (hands > 1 && hands < 2);
  const wield2H = Boolean(weapon?.system?.weapon2H);

  // Hand-and-a-half is a *category*; effective is determined by wield state.
  if (isHandAndAHalf) {
    const effectiveHands = wield2H ? 2 : 1;
    return {
      hands,
      isHandAndAHalf: true,
      effectiveHands,
      isOneHanded: effectiveHands === 1,
      isTwoHanded: effectiveHands === 2
    };
  }

  const isTwoHanded = hands >= 2;
  const isOneHanded = (hands > 0 && hands <= 1);
  /** @type {0|1|2} */
  const effectiveHands = isTwoHanded ? 2 : (isOneHanded ? 1 : 0);

  return {
    hands,
    isHandAndAHalf: false,
    effectiveHands,
    isOneHanded,
    isTwoHanded
  };
}

const DASH_FLAG_SCOPE = "uesrpg-3ev4";
const DASH_FLAG_KEY = "dashContext";

function _getTokenCenterPoint(token) {
  return token?.center ?? token?.object?.center ?? null;
}

/**
 * Record dash start data for an actor's active tokens.
 *
 * @param {Actor} actor
 * @param {{tokens?: Token[]}} [opts]
 * @returns {Promise<boolean>}
 */
export async function recordDashStart(actor, { tokens = null } = {}) {
  if (!actor) return false;
  let list = Array.isArray(tokens) ? tokens : null;
  if (!list || !list.length) {
    list = actor.getActiveTokens?.(true) ?? [];
  }
  if (!list.length) {
    list = actor.getActiveTokens?.() ?? [];
  }
  if (!list.length) return false;

  const speed = Number(actor.system?.speed?.value ?? 0) || 0;
  const combat = (game.combat && game.combat.started) ? game.combat : null;

  const base = {
    at: Date.now(),
    speed,
    sceneId: canvas?.scene?.id ?? null
  };

  if (combat) {
    base.combatId = combat.id;
    base.round = Number(combat.round ?? 0) || 0;
    base.turn = Number(combat.turn ?? 0) || 0;
  }

  for (const token of list) {
    const center = _getTokenCenterPoint(token);
    if (!center) continue;
    const payload = { ...base, tokenId: token.id, x: center.x, y: center.y };
    const doc = token?.document ?? token;
    if (!doc) continue;
    await requestUpdateDocument(doc, { [`flags.${DASH_FLAG_SCOPE}.${DASH_FLAG_KEY}`]: payload });
  }

  return true;
}

/**
 * Read dash context from a token or token document.
 *
 * @param {Token|TokenDocument|null} token
 * @returns {object|null}
 */
export function getTokenDashContext(token) {
  const doc = token?.document ?? token;
  if (!doc) return null;
  try {
    const raw = (typeof doc.getFlag === "function")
      ? doc.getFlag(DASH_FLAG_SCOPE, DASH_FLAG_KEY)
      : doc?.flags?.[DASH_FLAG_SCOPE]?.[DASH_FLAG_KEY];
    return (raw && typeof raw === "object") ? raw : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Clear dash context for a token or token document.
 *
 * @param {Token|TokenDocument|null} token
 * @returns {Promise<boolean>}
 */
export async function clearTokenDashContext(token) {
  const doc = token?.document ?? token;
  if (!doc) return false;
  try {
    await requestUpdateDocument(doc, { [`flags.${DASH_FLAG_SCOPE}.-=${DASH_FLAG_KEY}`]: null });
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Resolve hit location from a d100 attack roll (or an explicit d10 roll).
 *
 * RAW mapping (Chapter 5: Advanced Mechanics):
 * - Use the ones digit of the attack roll (or a d10; count 10 as 0).
 *   1-5 Body
 *   6   Right Leg
 *   7   Left Leg
 *   8   Right Arm
 *   9   Left Arm
 *   0   Head
 *
 * @param {number} rollTotal
 * @returns {"Body"|"RightLeg"|"LeftLeg"|"RightArm"|"LeftArm"|"Head"}
 */
export function getHitLocationFromRoll(rollTotal) {
  const n = Number(rollTotal);
  const ones = Number.isFinite(n) ? Math.abs(Math.trunc(n)) % 10 : 0;

  switch (ones) {
    case 0: return "Head";
    case 6: return "RightLeg";
    case 7: return "LeftLeg";
    case 8: return "RightArm";
    case 9: return "LeftArm";
    default: return "Body"; // 1-5
  }
}

const _HIT_LOCATION_CANONICAL = new Set(["Head", "Body", "RightArm", "LeftArm", "RightLeg", "LeftLeg"]);

/**
 * Normalize a hit location string (chat cards / UI inputs / legacy values).
 *
 * Accepts:
 * - Canonical keys: Head, Body, RightArm, LeftArm, RightLeg, LeftLeg
 * - Human labels: "Right Arm", "Left Leg", etc.
 * - Legacy tokens: r_arm, l_leg, etc.
 * - Digit strings: "0"-"9" (mapped via getHitLocationFromRoll semantics)
 *
 * @param {Actor|null} _targetActor currently unused (reserved for future coverage checks)
 * @param {string|number|null} raw
 * @returns {"Head"|"Body"|"RightArm"|"LeftArm"|"RightLeg"|"LeftLeg"}
 */
export function resolveHitLocationForTarget(_targetActor, raw) {
  if (raw === null || raw === undefined || raw === "") return "Body";

  // If a numeric digit was provided (e.g. from UI), apply RAW digit mapping.
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return getHitLocationFromRoll(raw);
  }

  const s0 = String(raw).trim();
  if (!s0) return "Body";

  // Digit string support ("10" counts as 0).
  if (/^\d+$/.test(s0)) {
    const v = Number(s0);
    if (Number.isFinite(v)) return getHitLocationFromRoll(v);
  }

  // Canonical exact.
  if (_HIT_LOCATION_CANONICAL.has(s0)) return s0;

  const s = s0.toLowerCase().replace(/[_\s-]+/g, "");
  const map = {
    head: "Head",
    body: "Body",
    rightarm: "RightArm",
    leftarm: "LeftArm",
    rightleg: "RightLeg",
    leftleg: "LeftLeg",
    rarm: "RightArm",
    larm: "LeftArm",
    rleg: "RightLeg",
    lleg: "LeftLeg",
  };

  const mapped = map[s];
  if (mapped && _HIT_LOCATION_CANONICAL.has(mapped)) return mapped;

  // Final fallback.
  return "Body";
}
