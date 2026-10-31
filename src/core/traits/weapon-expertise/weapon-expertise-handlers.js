/**
 * @module traits/weapon-expertise/weapon-expertise-handlers
 * @description Weapon Expertise talent automation — interceptor functions.
 *
 * Design:
 *  - Same interceptor pattern as combat-talents.js: export pure/async functions
 *    that callers invoke at specific combat pipeline milestones.
 *  - No hooks registered here; functions are imported and called directly.
 *  - Uses the existing condition service for supported mutations.
 *
 * Integration points (callers):
 *  - Pre-TN:       applyWeaponExpertiseAttackerPreTN()  → called from attacker.js
 *  - Damage mods:  applyWeaponExpertiseDamageModifiers() → called from resolve.js
 *  - Post-damage:  applyWeaponExpertisePostDamageEffects() → called from resolve.js
 *  - WT delta:     getWeaponExpertiseWTDelta()            → called from resolve.js
 *  - Passive info: collectWeaponExpertiseNotes()          → called from chat display
 */

import { hasTalent } from "../talents-api.js";
import { applyBleeding } from "../../conditions/condition-engine.js";
import {
  isWeaponExpertiseActive,
  weaponMatchesTalent,
  weaponMatchesAny,
  isWeaponThrown,
  isWeaponHandToHand
} from "./weapon-expertise-helpers.js";
import { WEAPON_EXPERTISE } from "./weapon-expertise-map.js";
import { _num as _asNumber, _lower, _buildSituationalMod } from "../_primitives.js";

// ---- Pre-TN Phase (Attacker-Side) ----

/**
 * Apply pre-TN talent modifiers from Weapon Expertise talents.
 *
 * Called at the same pipeline point as applyAttackerTalentPreTN() in attacker.js.
 *
 * Implemented:
 *  - Executioner: All Out Attack bonus → +30 (add +10 on top of normal +20)
 *  - Viper's Eye: Precision Strike with spear → only -10 penalty (add +10 to cancel half of -20)
 *
 * @param {object} params
 * @param {Actor} params.attacker
 * @param {object} params.declaration - { variant, weapon, ... }
 * @param {object[]} params.situationalMods - mutable array of situational mods
 * @param {Item} [params.weapon] - the weapon being used (if available)
 * @param {string|null} [params.attackMode] - declared attack mode
 */
export function applyWeaponExpertiseAttackerPreTN({ attacker, declaration, situationalMods, weapon, attackMode = null } = {}) {
  if (!attacker || !declaration || !Array.isArray(situationalMods)) return;

  const variant = _lower(declaration?.variant ?? "");

  // Executioner: All Out Attack with greataxe/scimitar → bonus to +30 (add +10)
  if (variant === "allout") {
    if (weapon && isWeaponExpertiseActive(attacker, weapon, "executioner", attackMode)) {
      if (!situationalMods.some(m => String(m?.key ?? "") === "talent:executioner-aoa")) {
        situationalMods.push(_buildSituationalMod(
          "talent:executioner-aoa",
          "Executioner (All Out Attack +30)",
          +10
        ));
      }
    }
  }

  // Viper's Eye: Precision Strike with spear → only -10 (add +10 to offset -20 → -10)
  if (variant === "precision") {
    if (weapon && isWeaponExpertiseActive(attacker, weapon, "viperseye", attackMode)) {
      const penaltyAlreadyRemoved = situationalMods.some(m => ["talent:precise", "talent:eyeofnight"].includes(String(m?.key ?? "")));
      if (!penaltyAlreadyRemoved && !situationalMods.some(m => String(m?.key ?? "") === "talent:viperseye-precision")) {
        situationalMods.push(_buildSituationalMod(
          "talent:viperseye-precision",
          "Viper's Eye (Precision -10 only)",
          +10
        ));
      }
    }
  }
}

// ---- Damage Modifiers ----

/**
 * Apply damage modifiers from Weapon Expertise talents.
 *
 * Called at the same pipeline point as applyTalentDamageModifiers() in resolve.js.
 * Mutates damageContext to add bonus damage and notes.
 *
 * Implemented:
 *  - Bruiser and Dart Thrower: manual thrown-damage reminders
 *  - Executioner: note about +1d4 to STR bonus for quality during AoA (informational — dice expression)
 *  - Knife Fighter: note about +1d4 on Penetrate Armor advantage
 *  - Pugilist: manual reminder for its Hand to Hand quality value
 *  - Hammerblow and Death by a Thousand Cuts: manual choice reminders
 *  - From Oblivion's Heart: flag for Bleeding(1) on wound (automated in post-damage)
 *  - Red Legion Throw and Whirling School: manual resolution reminders
 *
 * @param {object} params
 * @param {Actor} params.attacker
 * @param {Actor} [params.target]
 * @param {Item} params.weapon
 * @param {object} params.damageContext - mutable damage context with talentDamageBonus, talentNotes, etc.
 * @param {object} [params.attackData] - extra attack context like variant, isAllOutAttack, hitLocation, etc.
 */
export function applyWeaponExpertiseDamageModifiers({ attacker, target, weapon, damageContext, attackData } = {}) {
  if (!attacker || !weapon || !damageContext) return;

  // Ensure talentNotes array exists
  damageContext.talentNotes = Array.isArray(damageContext.talentNotes) ? damageContext.talentNotes : [];

  const isThrown = isWeaponThrown(weapon);
  const isH2H = isWeaponHandToHand(weapon);
  const attackMode = attackData?.attackMode ?? null;
  const variant = _lower(attackData?.variant ?? "");
  const isAllOutAttack = (variant === "allout" || variant === "all-out" || variant === "alloutattack" ||
    Boolean(attackData?.isAllOutAttack));

  // These bonuses belong to the attack's damage, not a separately mitigated
  // damage component. The caller cannot always establish a thrown attack here.
  if (isThrown && hasTalent(attacker, "bruiser") && weaponMatchesAny(weapon, ["handaxe"])) {
    damageContext.talentNotes.push("Bruiser: For a thrown axe attack, include the Strength bonus in damage manually instead of Dart Thrower's Agility bonus; resolve mitigation once with the GM.");
  }

  if (isThrown && hasTalent(attacker, "darthrower")) {
    const hasBruiserOnAxe = hasTalent(attacker, "bruiser") && weaponMatchesAny(weapon, ["handaxe"]);
    if (!hasBruiserOnAxe) {
      damageContext.talentNotes.push("Dart Thrower: For a thrown attack, include the Agility bonus in damage manually; resolve mitigation once with the GM.");
    }
  }

  // --- Executioner: +1d4 STR bonus for Splitting/Slashing during All Out Attack ---
  if (isAllOutAttack && isWeaponExpertiseActive(attacker, weapon, "executioner", attackMode)) {
    // This is a dice expression bonus — we can note it; the extra 1d4 is informational
    // since the system's damage formula parsing handles the base quality values.
    // Add a flat approximation (+2 average of 1d4) or note for the player to roll manually.
    damageContext.talentNotes.push(
      "Executioner: +1d4 added to STR bonus for Splitting/Slashing quality (roll manually)."
    );
    damageContext.talentNotes.push(
      "Executioner: Foes suffer -20 to Shock tests from wounds."
    );
  }

  // The quality's armor-dependent trigger and cap must not become flat damage.
  if (isH2H && hasTalent(attacker, "pugilist")) {
    damageContext.talentNotes.push("Pugilist: Increase the applicable Slashing or Crushing quality value by 1; resolve manually, including its armor restriction.");
  }

  // --- Knife Fighter: +1d4 on Penetrate Armor advantage ---
  if (hasTalent(attacker, "knifefighter") && weaponMatchesTalent(weapon, "knifefighter")) {
    const isPenetrateArmor = (variant === "penetrate" || variant === "penetratearmor" ||
      Boolean(attackData?.isPenetrateArmor));
    if (isPenetrateArmor) {
      damageContext.talentNotes.push(
        "Knife Fighter: +1d4 bonus damage for Penetrate Armor (roll manually)."
      );
    }
  }

  // The choice and the Endurance test are resolved manually.
  if (isWeaponExpertiseActive(attacker, weapon, "hammerblow", attackMode)) {
    if (isAllOutAttack) {
      damageContext.talentNotes.push(
        "Hammerblow: On a hit, the attacker may choose 1 SP loss or an END(+0) test; only a failed test causes Dazed. Resolve the choice and test manually."
      );
    } else {
      damageContext.talentNotes.push(
        "Hammerblow: On a hit, the attacker may choose to make the target lose 1 SP; resolve manually."
      );
    }
  }

  // --- Bruiser: All Out Attack with mace → target loses 1 SP on damage ---
  if (isAllOutAttack && hasTalent(attacker, "bruiser") && weaponMatchesAny(weapon, ["mace"])) {
    damageContext.talentNotes.push(
      "Bruiser (All Out Attack + Mace): If the target takes damage after mitigation, resolve the 1 SP loss manually. Inspect prior changes before applying it."
    );
  }

  // --- Bearded Warrior: on damage, may move target 1m ---
  if (isWeaponExpertiseActive(attacker, weapon, "beardedwarrior", attackMode)) {
    damageContext.talentNotes.push(
      "Bearded Warrior: On ≥1 damage after mitigation, may move target 1m (cannot increase distance)."
    );
    damageContext._beardedWarriorActive = true;
  }

  // --- Death by a Thousand Cuts: the attacker may choose Bleeding(1) ---
  if (isWeaponExpertiseActive(attacker, weapon, "deathbyathousandcuts", attackMode)) {
    damageContext.talentNotes.push(
      "Death by a Thousand Cuts: After at least 1 damage following mitigation, the attacker may choose to apply Bleeding(1) manually."
    );
  }

  // --- From Oblivion's Heart: on wound, apply Bleeding(1) ---
  if (isWeaponExpertiseActive(attacker, weapon, "fromoblivionsheart", attackMode)) {
    damageContext.talentNotes.push(
      "From Oblivion's Heart: If attack inflicts a wound, target gains Bleeding(1)."
    );
    damageContext._fromOblivionsHeartActive = true;
  }

  // The location-specific condition and shield tracking require manual resolution.
  if (isWeaponExpertiseActive(attacker, weapon, "redlegionthrow", attackMode)) {
    damageContext.talentNotes.push(
      "Red Legion Throw: If a thrown javelin deals damage after mitigation, record the speared body or limb and treat it as crippled until the javelin is removed; resolve manually."
    );
  }

  // --- Whirling School: precision strike with bola → wrap effect ---
  if (isWeaponExpertiseActive(attacker, weapon, "whirlingschool", attackMode)) {
    if (variant === "precision" || variant === "precisionstrike") {
      damageContext.talentNotes.push(
        "The Whirling School: If this was the special Precision Strike and it hit, resolve the chosen neck or legs effect manually, even if no damage was dealt."
      );
    }
  }

  // --- Collect passive quality notes for any active weapon expertise ---
  _appendPassiveNotes(attacker, weapon, damageContext, attackMode);
}

/**
 * Append passive quality modification notes for active weapon expertise talents.
 * These are informational reminders shown in the damage report.
 * @private
 */
function _appendPassiveNotes(attacker, weapon, damageContext, attackMode = null) {
  if (!attacker || !weapon || !damageContext) return;

  for (const [slug, def] of Object.entries(WEAPON_EXPERTISE)) {
    if (!def.passive?.length) continue;
    if (!isWeaponExpertiseActive(attacker, weapon, slug, attackMode)) continue;

    for (const note of def.passive) {
      const prefixed = `${def.label}: ${note}`;
      if (!damageContext.talentNotes.includes(prefixed)) {
        damageContext.talentNotes.push(prefixed);
      }
    }
  }
}

// ---- Wound Threshold Modifier ----

/**
 * Get weapon expertise WT delta for an attacker's weapon.
 *
 * Implemented:
 *  - Monster Hunter: WT -1 when attacking a Large or larger target with a pike.
 *
 * @param {object} params
 * @param {Actor} params.attacker
 * @param {Actor} params.target
 * @param {Item} params.weapon
 * @returns {number} WT delta (negative = lower WT for target)
 */
export function getWeaponExpertiseWTDelta({ attacker, target, weapon } = {}) {
  if (!attacker || !target || !weapon) return 0;

  // Monster Hunter: WT -1 with pike
  if (["large", "huge", "enormous"].includes(_lower(target.system?.size))
    && isWeaponExpertiseActive(attacker, weapon, "monsterhunter")) {
    return -1;
  }

  return 0;
}

// ---- Post-Damage Effects ----

export function hasWeaponExpertisePostDamageEffects({ attacker, target, weapon, damageContext, damageApplied, woundTriggered } = {}) {
  if (!attacker || !target || !weapon || !damageContext) return false;
  const dmg = _asNumber(damageApplied, 0);
  return Boolean(damageContext._fromOblivionsHeartActive && woundTriggered
    || dmg >= 1 && damageContext._beardedWarriorActive);
}

/**
 * Apply post-damage effects from Weapon Expertise talents.
 * Called after damage is resolved and applied to the target.
 *
 * Implemented:
 *  - From Oblivion's Heart: apply Bleeding(1) on wound
 *  - Bearded Warrior: note in chat about move option
 *
 * @param {object} params
 * @param {Actor} params.attacker
 * @param {Actor} params.target
 * @param {Item} params.weapon
 * @param {object} params.damageContext
 * @param {number} params.damageApplied - actual damage taken after mitigation
 * @param {boolean} params.woundTriggered - whether a wound was inflicted
 * @returns {{ notes: string[], bleedingApplied: boolean }}
 */
export async function applyWeaponExpertisePostDamageEffects({
  attacker,
  target,
  weapon,
  damageContext,
  damageApplied,
  woundTriggered
} = {}) {
  const notes = [];
  let bleedingApplied = false;
  let bleedingUnconfirmed = false;
  const dmg = _asNumber(damageApplied, 0);

  if (!hasWeaponExpertisePostDamageEffects({ attacker, target, weapon, damageContext, damageApplied, woundTriggered })) return { notes, bleedingApplied };

  // From Oblivion's Heart: apply Bleeding(1) on wound
  if (damageContext._fromOblivionsHeartActive && woundTriggered) {
    try {
      if (typeof applyBleeding === "function") {
        const applied = await applyBleeding(target, 1, { source: "From Oblivion's Heart", requireConfirmed: true });
        if (applied) {
          notes.push("From Oblivion's Heart: Bleeding(1) applied (wound inflicted).");
          bleedingApplied = true;
        } else {
          notes.push("From Oblivion's Heart: Bleeding was not applied; the target may be immune or bloodless.");
        }
      }
    } catch (err) {
      console.warn("UESRPG | Weapon Expertise: Failed to apply Bleeding for From Oblivion's Heart:", err);
      bleedingUnconfirmed = true;
      notes.push("From Oblivion's Heart: Bleeding could not be confirmed. Inspect the target's conditions before retrying or resolving it manually.");
    }
  }

  // Bearded Warrior: move option
  if (damageContext._beardedWarriorActive && dmg >= 1) {
    notes.push(
      `Bearded Warrior: ${attacker.name} may move ${target.name} 1 meter ` +
      `in any direction (cannot increase distance from ${attacker.name}).`
    );
  }

  return { notes, bleedingApplied, failed: bleedingUnconfirmed };
}

// ---- Passive Notes Collector ----

/**
 * Collect all applicable Weapon Expertise passive notes for a given actor + weapon.
 * Useful for display in chat cards or tooltips.
 *
 * @param {Actor} actor
 * @param {Item} weapon
 * @param {object} [options]
 * @param {string[]} [options.slugs] Restrict the reminders to these talents.
 * @param {string|null} [options.attackMode] Restrict reminders to the declared mode.
 * @returns {string[]}
 */
export function collectWeaponExpertiseNotes(actor, weapon, { slugs = null, attackMode = null } = {}) {
  if (!actor || !weapon) return [];

  const notes = [];

  for (const [slug, def] of Object.entries(WEAPON_EXPERTISE)) {
    if (Array.isArray(slugs) && !slugs.includes(slug)) continue;
    if (slug === "pugilist" && !isWeaponHandToHand(weapon)) continue;
    if (slug === "darthrower" && !isWeaponThrown(weapon)) continue;
    if (!isWeaponExpertiseActive(actor, weapon, slug, attackMode)) continue;

    // Add passive quality notes
    for (const note of (def.passive ?? [])) {
      notes.push(`${def.label}: ${note}`);
    }

    // Add active effect notes
    for (const note of (def.notes ?? [])) {
      notes.push(`${def.label}: ${note}`);
    }
  }

  return notes;
}
