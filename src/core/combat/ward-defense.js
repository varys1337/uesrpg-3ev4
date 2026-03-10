/**
 * src/core/combat/ward-defense.js
 *
 * Ward spell defense utility functions.
 */

import { isActorTrainedInMagicSchool } from "../magic/magicka-utils.js";
const _WARD_NAME_PATTERN = /\bward\b/i;

/**
 * List eligible Ward spells for defense.
 *
 * @param {Actor} actor
 * @returns {Item[]}
 */
export function listEligibleWardSpells(actor) {
  if (!actor?.items) return [];
  const out = [];
  for (const item of actor.items) {
    if (!_isEligibleWardSpell(actor, item)) continue;
    out.push(item);
  }

  // Deterministic ordering: strongest spell_str first, then name, then id.
  out.sort((a, b) => {
    const aSS = Math.max(0, Number(a?.system?.spell_str ?? 0) || 0);
    const bSS = Math.max(0, Number(b?.system?.spell_str ?? 0) || 0);
    if (bSS !== aSS) return bSS - aSS;
    const aName = String(a?.name ?? "");
    const bName = String(b?.name ?? "");
    const nameCmp = aName.localeCompare(bName);
    if (nameCmp !== 0) return nameCmp;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });

  return out;
}

/**
 * Get the preferred Ward spell for defense.
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function getPreferredWardDefenseSpell(actor) {
  const spells = listEligibleWardSpells(actor);
  return spells[0] ?? null;
}

/**
 * Detect whether the actor can use Ward for defense.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function canUseWardDefense(actor) {
  return Boolean(getPreferredWardDefenseSpell(actor));
}

/**
 * Get the Ward spell's Block Rating (= Spell Strength) for the preferred Ward.
 * Ward provides equal Physical and Magical BR (unlike normal shields).
 *
 * @param {Actor} actor
 * @param {string} [damageType="physical"] - Ignored for Ward (same BR for all types).
 * @returns {number} The Block Rating (Spell Strength), or 0 if no eligible Ward.
 */
export function getWardBlockRating(actor, damageType = "physical") {
  const ward = getPreferredWardDefenseSpell(actor);
  if (!ward) return 0;
  return Math.max(0, Number(ward.system?.spell_str ?? 0) || 0);
}

/**
 * Back-compat alias: get the preferred Ward spell item on the actor (if any).
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function getActiveWardSpell(actor) {
  return getPreferredWardDefenseSpell(actor);
}

/**
 * Back-compat alias: detect whether the actor can use Ward for defense.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasActiveWard(actor) {
  return canUseWardDefense(actor);
}

function _isEligibleWardSpell(actor, item) {
  if (item?.type !== "spell") return false;

  const name = String(item.name ?? "").trim();
  const slug = String(item.system?.slug ?? item.system?.key ?? "").trim().toLowerCase();
  const profileId = String(item.system?.profileId ?? item.system?.effectId ?? item.system?.spellId ?? "").trim().toLowerCase();
  const defenseModel = String(item.system?.defenseModel ?? "").trim().toLowerCase();
  const wardEngine = item.system?.engine?.ward;
  const wardIdentity = String(wardEngine?.type ?? wardEngine?.id ?? wardEngine ?? "").trim().toLowerCase();

  const isWard =
    _WARD_NAME_PATTERN.test(name)
    || slug.includes("ward")
    || profileId.includes("ward")
    || defenseModel.includes("ward")
    || wardIdentity.includes("ward");
  if (!isWard) return false;

  // Preserve existing casting/training gate semantics if school is configured.
  const school = String(item?.system?.school ?? "").trim();
  if (school) {
    try {
      if (!isActorTrainedInMagicSchool(actor, school)) return false;
    } catch (_e) {
      // If training resolver fails, keep the spell eligible rather than hard-failing defense availability.
    }
  }

  return true;
}
