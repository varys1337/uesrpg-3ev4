/**
 * @module traits/weapon-expertise/weapon-expertise-handlers
 * @description Weapon Expertise talent automation — interceptor functions.
 *
 * Design:
 *  - Same interceptor pattern as combat-talents.js: export pure/async functions
 *    that callers invoke at specific combat pipeline milestones.
 *  - No hooks registered here; functions are imported and called directly.
 *  - Permission-safe: uses requestUpdateDocument for mutations.
 *
 * Integration points (callers):
 *  - Pre-TN:       applyWeaponExpertiseAttackerPreTN()  → called from attacker.js
 *  - Damage mods:  applyWeaponExpertiseDamageModifiers() → called from resolve.js
 *  - Post-damage:  applyWeaponExpertisePostDamageEffects() → called from resolve.js
 *  - WT delta:     getWeaponExpertiseWTDelta()            → called from resolve.js
 *  - Passive info: collectWeaponExpertiseNotes()          → called from chat display
 */

import { hasTalent } from "../talents-api.js";
import { itemHasToken } from "../../combat/damage-automation.js";
import { applyBleeding, applyCondition } from "../../conditions/condition-engine.js";
import { getAttackModeFromWeapon, getEffectiveWeaponHands } from "../../combat/combat-utils.js";
import {
  isWeaponExpertiseActive,
  weaponMatchesTalent,
  weaponMatchesAny,
  resolveWeaponKey,
  isWeaponThrown,
  isWeaponHandToHand,
  getCharBonus
} from "./weapon-expertise-helpers.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { WEAPON_EXPERTISE } from "./weapon-expertise-map.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { _num as _asNumber, _lower, _buildSituationalMod } from "../_primitives.js";

/**
 * Deduct SP from a target actor (forced loss, not voluntary spend).
 * Uses authority-proxy for permission safety.
 * @param {Actor} target
 * @param {number} amount
 * @returns {Promise<boolean>}
 */
async function _deductTargetSP(target, amount) {
  if (!target) return false;
  const n = Math.max(0, Math.trunc(Number(amount) || 0));
  if (n <= 0) return false;
  const cur = Number(target.system?.stamina?.value ?? 0);
  const next = cur - n;
  const ok = await requestUpdateDocument(target, { "system.stamina.value": next });
  return !!ok;
}

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
 */
export function applyWeaponExpertiseAttackerPreTN({ attacker, declaration, situationalMods, weapon } = {}) {
  if (!attacker || !declaration || !Array.isArray(situationalMods)) return;

  const variant = _lower(declaration?.variant ?? "");

  // Executioner: All Out Attack with greataxe/scimitar → bonus to +30 (add +10)
  if (variant === "allout" || variant === "all-out" || variant === "alloutattack") {
    if (weapon && isWeaponExpertiseActive(attacker, weapon, "executioner")) {
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
  if (variant === "precision" || variant === "precisionstrike") {
    if (weapon && isWeaponExpertiseActive(attacker, weapon, "viperseye")) {
      if (!situationalMods.some(m => String(m?.key ?? "") === "talent:viperseye-precision")) {
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
 *  - Bruiser: +STR bonus to thrown axes
 *  - Dart Thrower: +AGI bonus to all thrown weapons
 *  - Executioner: note about +1d4 to STR bonus for quality during AoA (informational — dice expression)
 *  - Knife Fighter: note about +1d4 on Penetrate Armor advantage
 *  - Pugilist: +1 to Slashing/Crushing value of H2H weapons (flat +1 damage)
 *  - Hammerblow: flags for SP loss / Dazed (automated in post-damage)
 *  - Death by a Thousand Cuts: flag for Bleeding(1) (automated in post-damage)
 *  - From Oblivion's Heart: flag for Bleeding(1) on wound (automated in post-damage)
 *  - Red Legion Throw: flag for Crippled/Speared (automated in post-damage)
 *  - Whirling School: flag for bola wrap dialog (automated in post-damage)
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

  const weaponKey = resolveWeaponKey(weapon);
  const attackMode = getAttackModeFromWeapon(weapon);
  const isThrown = isWeaponThrown(weapon);
  const isH2H = isWeaponHandToHand(weapon);
  const variant = _lower(attackData?.variant ?? "");
  const isAllOutAttack = (variant === "allout" || variant === "all-out" || variant === "alloutattack" ||
    Boolean(attackData?.isAllOutAttack));

  // --- Bruiser: +STR bonus to thrown axes ---
  if (isThrown && hasTalent(attacker, "bruiser") && weaponMatchesAny(weapon, ["handaxe"])) {
    const sb = getCharBonus(attacker, "str");
    if (sb > 0) {
      damageContext.talentDamageBonus = _asNumber(damageContext.talentDamageBonus, 0) + sb;
      damageContext.talentNotes.push(`Bruiser: +${sb} damage (STR bonus for thrown axes)`);
    }
  }

  // --- Dart Thrower: +AGI bonus to all thrown weapons ---
  // Only if Bruiser did NOT already apply STR bonus for this throwing attack
  // (Bruiser replaces Dart Thrower's AGI bonus for thrown axes)
  if (isThrown && hasTalent(attacker, "darthrower")) {
    const hasBruiserOnAxe = hasTalent(attacker, "bruiser") && weaponMatchesAny(weapon, ["handaxe"]);
    if (!hasBruiserOnAxe) {
      const ab = getCharBonus(attacker, "agi");
      if (ab > 0) {
        damageContext.talentDamageBonus = _asNumber(damageContext.talentDamageBonus, 0) + ab;
        damageContext.talentNotes.push(`Dart Thrower: +${ab} damage (AGI bonus for thrown weapons)`);
      }
    }
  }

  // --- Executioner: +1d4 STR bonus for Splitting/Slashing during All Out Attack ---
  if (isAllOutAttack && isWeaponExpertiseActive(attacker, weapon, "executioner")) {
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

  // --- Pugilist: +1 to Slashing/Crushing value of H2H weapons ---
  if (isH2H && hasTalent(attacker, "pugilist")) {
    damageContext.talentDamageBonus = _asNumber(damageContext.talentDamageBonus, 0) + 1;
    damageContext.talentNotes.push("Pugilist: +1 to Slashing/Crushing (H2H weapon)");
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

  // --- Hammerblow: target loses 1 SP on hit ---
  if (isWeaponExpertiseActive(attacker, weapon, "hammerblow")) {
    if (isAllOutAttack) {
      damageContext.talentNotes.push(
        "Hammerblow (All Out Attack): Target must test END(+0) or gain Dazed condition."
      );
    } else {
      damageContext.talentNotes.push(
        "Hammerblow: Target loses 1 Stamina Point on hit."
      );
    }
    // Flag for post-damage processing
    damageContext._hammerblowActive = true;
    damageContext._hammerblowAllOut = isAllOutAttack;
  }

  // --- Bruiser: All Out Attack with mace → target loses 1 SP on damage ---
  if (isAllOutAttack && hasTalent(attacker, "bruiser") && weaponMatchesAny(weapon, ["mace"])) {
    damageContext.talentNotes.push(
      "Bruiser (All Out Attack + Mace): Target loses 1 SP if damage dealt after mitigation."
    );
    damageContext._bruiserMaceAOA = true;
  }

  // --- Bearded Warrior: on damage, may move target 1m ---
  if (isWeaponExpertiseActive(attacker, weapon, "beardedwarrior")) {
    damageContext.talentNotes.push(
      "Bearded Warrior: On ≥1 damage after mitigation, may move target 1m (cannot increase distance)."
    );
    damageContext._beardedWarriorActive = true;
  }

  // --- Death by a Thousand Cuts: on ≥1 damage, apply Bleeding(1) ---
  if (isWeaponExpertiseActive(attacker, weapon, "deathbyathousandcuts")) {
    damageContext.talentNotes.push(
      "Death by a Thousand Cuts: On ≥1 damage after mitigation, apply Bleeding(1)."
    );
    damageContext._deathByThousandCutsActive = true;
  }

  // --- From Oblivion's Heart: on wound, apply Bleeding(1) ---
  if (isWeaponExpertiseActive(attacker, weapon, "fromoblivionsheart")) {
    damageContext.talentNotes.push(
      "From Oblivion's Heart: If attack inflicts a wound, target gains Bleeding(1)."
    );
    damageContext._fromOblivionsHeartActive = true;
  }

  // --- Red Legion Throw: on damage → Speared (Crippled) ---
  if (isWeaponExpertiseActive(attacker, weapon, "redlegionthrow")) {
    damageContext.talentNotes.push(
      "Red Legion Throw: On damage after mitigation → hit location is Speared (Crippled)."
    );
    damageContext._redLegionThrowActive = true;
  }

  // --- Whirling School: precision strike with bola → wrap effect ---
  if (isWeaponExpertiseActive(attacker, weapon, "whirlingschool")) {
    if (variant === "precision") {
      damageContext.talentNotes.push(
        "The Whirling School: Bola wrap — choose neck (SP drain) or legs (Immobilized)."
      );
      damageContext._whirlingSchoolActive = true;
    }
  }

  // --- Collect passive quality notes for any active weapon expertise ---
  _appendPassiveNotes(attacker, weapon, damageContext);
}

/**
 * Append passive quality modification notes for active weapon expertise talents.
 * These are informational reminders shown in the damage report.
 * @private
 */
function _appendPassiveNotes(attacker, weapon, damageContext) {
  if (!attacker || !weapon || !damageContext) return;

  for (const [slug, def] of Object.entries(WEAPON_EXPERTISE)) {
    if (!def.passive?.length) continue;
    if (!isWeaponExpertiseActive(attacker, weapon, slug)) continue;

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
 *  - Monster Hunter: WT -1 when attacking with a pike.
 *    (RAW: Large+ creatures WT is treated as one lower. We apply universally and note the condition.)
 *
 * @param {object} params
 * @param {Actor} params.attacker
 * @param {Item} params.weapon
 * @param {string} [params.attackMode]
 * @returns {number} WT delta (negative = lower WT for target)
 */
export function getWeaponExpertiseWTDelta({ attacker, weapon, attackMode } = {}) {
  if (!attacker || !weapon) return 0;

  // Monster Hunter: WT -1 with pike
  if (isWeaponExpertiseActive(attacker, weapon, "monsterhunter")) {
    return -1;
  }

  return 0;
}

// ---- Post-Damage Effects ----

/**
 * Apply post-damage effects from Weapon Expertise talents.
 * Called after damage is resolved and applied to the target.
 *
 * Implemented:
 *  - Death by a Thousand Cuts: apply Bleeding(1) on ≥1 damage
 *  - From Oblivion's Heart: apply Bleeding(1) on wound
 *  - Hammerblow: auto SP loss (non-AoA) or auto Dazed condition (AoA)
 *  - Bearded Warrior: note in chat about move option
 *  - Bruiser (mace AoA): auto SP loss on damage
 *  - Red Legion Throw: auto Crippled (Speared) on damage
 *  - Whirling School: dialog prompt → auto Immobilized (legs) or SP drain note (neck)
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
  const dmg = _asNumber(damageApplied, 0);

  if (!attacker || !target || !weapon || !damageContext) return { notes, bleedingApplied };

  // Death by a Thousand Cuts: apply Bleeding(1) on ≥1 damage
  if (damageContext._deathByThousandCutsActive && dmg >= 1) {
    try {
      if (typeof applyBleeding === "function") {
        await applyBleeding(target, 1);
        notes.push("Death by a Thousand Cuts: Bleeding(1) applied.");
        bleedingApplied = true;
      }
    } catch (err) {
      console.warn("UESRPG | Weapon Expertise: Failed to apply Bleeding for Death by a Thousand Cuts:", err);
      notes.push("Death by a Thousand Cuts: Bleeding(1) should be applied manually.");
    }
  }

  // From Oblivion's Heart: apply Bleeding(1) on wound
  if (damageContext._fromOblivionsHeartActive && woundTriggered) {
    try {
      if (typeof applyBleeding === "function") {
        await applyBleeding(target, 1);
        notes.push("From Oblivion's Heart: Bleeding(1) applied (wound inflicted).");
        bleedingApplied = true;
      }
    } catch (err) {
      console.warn("UESRPG | Weapon Expertise: Failed to apply Bleeding for From Oblivion's Heart:", err);
      notes.push("From Oblivion's Heart: Bleeding(1) should be applied manually.");
    }
  }

  // Hammerblow: SP loss (non-AoA) or Dazed condition (AoA)
  if (damageContext._hammerblowActive) {
    if (damageContext._hammerblowAllOut) {
      try {
        if (typeof applyCondition === "function") {
          await applyCondition(target, "dazed", {
            source: `${attacker.name} — Hammerblow (All Out Attack)`
          });
          notes.push(
            `Hammerblow (All Out Attack): Dazed applied to ${target.name}. ` +
            `Removal: END(+10) as Free Action each round.`
          );
        }
      } catch (err) {
        console.warn("UESRPG | Weapon Expertise: Failed to apply Dazed for Hammerblow:", err);
        notes.push(
          `Hammerblow (All Out Attack): ${target.name} should gain Dazed condition (apply manually). ` +
          `Removal: END(+10) as Free Action each round.`
        );
      }
    } else {
      const ok = await _deductTargetSP(target, 1);
      if (ok) {
        notes.push(`Hammerblow: ${target.name} lost 1 Stamina Point.`);
      } else {
        notes.push(`Hammerblow: ${target.name} should lose 1 SP (apply manually).`);
      }
    }
  }

  // Bearded Warrior: move option
  if (damageContext._beardedWarriorActive && dmg >= 1) {
    notes.push(
      `Bearded Warrior: ${attacker.name} may move ${target.name} 1 meter ` +
      `in any direction (cannot increase distance from ${attacker.name}).`
    );
  }

  // Bruiser mace AoA: SP loss
  if (damageContext._bruiserMaceAOA && dmg >= 1) {
    const ok = await _deductTargetSP(target, 1);
    if (ok) {
      notes.push(`Bruiser (All Out Attack + Mace): ${target.name} lost 1 Stamina Point.`);
    } else {
      notes.push(`Bruiser (All Out Attack + Mace): ${target.name} should lose 1 SP (apply manually).`);
    }
  }

  // Red Legion Throw: apply Crippled (Speared)
  if (damageContext._redLegionThrowActive && dmg >= 1) {
    try {
      if (typeof applyCondition === "function") {
        await applyCondition(target, "crippled", {
          source: `${attacker.name} — Red Legion Throw (Speared)`
        });
        notes.push(
          `Red Legion Throw: ${target.name}'s hit location is Speared (Crippled). ` +
          `Removal: Free Action → Bleeding(1), or Secondary Action STR test.`
        );
      }
    } catch (err) {
      console.warn("UESRPG | Weapon Expertise: Failed to apply Crippled for Red Legion Throw:", err);
      notes.push(
        `Red Legion Throw: ${target.name} should gain Crippled (Speared) condition (apply manually).`
      );
    }
  }

  // Whirling School: prompt for bola wrap location, apply condition
  if (damageContext._whirlingSchoolActive && dmg >= 1) {
    try {
      const wrapTarget = await customDialog({
        title: "The Whirling School \u2014 Bola Wrap",
        content:
          `<p>Where does <strong>${attacker.name}</strong> wrap the bola ` +
          `around <strong>${target.name}</strong>?</p>`,
        buttons: {
          legs: { label: "Legs (Immobilized)", callback: () => "legs" },
          neck: { label: "Neck (1 SP/round)", callback: () => "neck" }
        },
        default: "legs"
      }) ?? "legs";

      if (wrapTarget === "legs") {
        if (typeof applyCondition === "function") {
          await applyCondition(target, "immobilized", {
            source: `${attacker.name} — Whirling School (Bola)`
          });
          notes.push(
            `The Whirling School: Bola wraps ${target.name}'s legs → Immobilized. ` +
            `Removal: Primary Action, +0 STR test by target or ally within 1m.`
          );
        }
      } else {
        notes.push(
          `The Whirling School: Bola wraps ${target.name}'s neck → loses 1 SP/round (does not stack). ` +
          `Removal: Primary Action, +0 STR test by target or ally within 1m.`
        );
      }
    } catch (err) {
      console.warn("UESRPG | Weapon Expertise: Failed to apply Whirling School effect:", err);
      notes.push(
        `The Whirling School: ${target.name} should gain Immobilized or SP drain (apply manually).`
      );
    }
  }

  return { notes, bleedingApplied };
}

// ---- Passive Notes Collector ----

/**
 * Collect all applicable Weapon Expertise passive notes for a given actor + weapon.
 * Useful for display in chat cards or tooltips.
 *
 * @param {Actor} actor
 * @param {Item} weapon
 * @returns {string[]}
 */
export function collectWeaponExpertiseNotes(actor, weapon) {
  if (!actor || !weapon) return [];

  const notes = [];

  for (const [slug, def] of Object.entries(WEAPON_EXPERTISE)) {
    if (!isWeaponExpertiseActive(actor, weapon, slug)) continue;

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
