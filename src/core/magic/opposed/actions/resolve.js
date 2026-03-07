/**
 * src/core/magic/opposed/actions/resolve.js
 *
 * Block and ward resolution handlers for magic opposed tests.
 */

import { getDefenderOutcome, setMagicDefenderDamage } from "../schema.js";
import { getOrCreateSharedSpellDamage, computeSpellDamageShared, spellNeedsEffectApplication } from "../spell-helpers.js";
import { getSpellDamageType } from "../../magicka-utils.js";
import { getBlockValue } from "../../../combat/mitigation.js";
import { resolveHitLocationForTarget } from "../../../combat/combat-utils.js";
import { getActiveWardSpell, getWardBlockRating } from "../../../combat/ward-defense.js";

/**
 * Handle block resolve action.
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function handleBlockResolve(ctx) {
  const { message, data, attacker, defender, defenderActor, spell } = ctx;

  const outcome = getDefenderOutcome(data, defender);
  if (!outcome || !outcome.needsBlockResolution) {
    ui.notifications.warn("Block resolution is only available when the defender wins by blocking (both passed).");
    return;
  }

  // Get equipped shield
  const shields = defenderActor.items?.filter(i => {
    if (!(i.type === "armor" || i.type === "item")) return false;
    if (i.system?.equipped !== true) return false;
    if (!Boolean(i.system?.isShieldEffective ?? i.system?.isShield)) return false;
    const shieldType = String(i.system?.shieldType || "normal").toLowerCase();
    if (shieldType === "buckler") return false;
    return true;
  }) ?? [];
  const shield = shields[0] ?? null;
  if (!shield) {
    ui.notifications.warn("No equipped shield found on the defender.");
    return;
  }

  // Roll spell damage
  const spellOptions = data.attacker.spellOptions ?? {};
  const damageType = getSpellDamageType(spell);
  const isCritical = Boolean(data.attacker.result?.isCriticalSuccess);
  const sharedDamage = await getOrCreateSharedSpellDamage({ data, attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
  const damageInfo = sharedDamage ?? await computeSpellDamageShared({ attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
  const damageValue = Number(damageInfo?.damageValue ?? 0) || 0;
  const rollHTML = damageInfo?.rollHTML ?? "";

  // Get Block Rating (magic damage treats BR as half, round up, unless magic BR exists)
  const br = getBlockValue(shield, damageType);
  const blocked = damageValue <= br;

  const shieldArm = "Left Arm";
  const resolvedShieldArm = resolveHitLocationForTarget(defenderActor, shieldArm);
  const appliedDamage = blocked ? 0 : damageValue;

  // Store block result and damage data inline on the parent card
  const blockResult = { blocked, blockRating: br, shieldName: shield?.name ?? "Shield", isAoE: false };
  const dmgData = {
    rolled: true,
    mode: "block",
    finalDamage: appliedDamage,
    damageString: rollHTML,
    hitLocation: blocked ? "—" : resolvedShieldArm,
    weaponName: spell.name,
    weaponImg: spell.img ?? "",
    qualityPillsHtml: "",
    applied: blocked ? true : false,
    blockResult,
    applyPayload: {
      targetUuid: defenderActor.uuid,
      targetName: defenderActor.name,
      magic: "1",
    },
    _magicPayload: {
      damage: appliedDamage,
      damageType,
      spellUuid: spell.uuid ?? "",
      casterUuid: attacker.uuid ?? "",
      hitLocation: resolvedShieldArm,
      isCritical,
      source: spell.name,
      magicCost: Number(data.attacker?.mpSpent ?? data.context?.mpSpent ?? spell.system?.cost ?? 0),
      rollHTML,
      isOverloaded: Boolean(damageInfo?.isOverloaded),
      overloadBonus: Number(damageInfo?.overloadBonus ?? 0) || 0,
      isOvercharged: Boolean(damageInfo?.isOvercharged),
      overchargeTotals: Array.isArray(damageInfo?.overchargeTotals) ? damageInfo.overchargeTotals : null,
      elementalBonus: Number(damageInfo?.elementalBonus ?? 0) || 0,
      elementalBonusLabel: String(damageInfo?.elementalBonusLabel ?? ""),
      actualCost: Number(data.attacker?.mpSpent ?? data.context?.mpSpent ?? spell.system?.cost ?? 0),
      originalCastWorldTime: Number(data.context?.originalCastWorldTime ?? game?.time?.worldTime ?? 0) || 0,
      defenseType: "block",
      isDamaging: !blocked,
      needsEffects: !blocked && Boolean(spellNeedsEffectApplication(spell)),
    },
  };
  setMagicDefenderDamage(data, defender, dmgData);
  // Clear needsBlockResolution so the button disappears
  outcome.needsBlockResolution = false;
  await ctx._updateCard(message, data);
}

/**
 * Handle ward resolve action for magic opposed workflow.
 * Ward uses Spell Strength as BR for all damage types. Power Block is incompatible.
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function handleWardResolve(ctx) {
  const { message, data, attacker, defender, defenderActor, spell } = ctx;

  const outcome = getDefenderOutcome(data, defender);
  if (!outcome || !outcome.needsBlockResolution) {
    ui.notifications.warn("Ward resolution is only available when the defender wins by warding (both passed).");
    return;
  }

  // Get active Ward spell and its BR
  const wardSpell = getActiveWardSpell(defenderActor);
  if (!wardSpell) {
    ui.notifications.warn("No active Ward spell found on the defender.");
    return;
  }
  const wardBR = getWardBlockRating(defenderActor);
  const wardName = wardSpell.name ?? "Ward";

  // Roll spell damage
  const spellOptions = data.attacker.spellOptions ?? {};
  const damageType = getSpellDamageType(spell);
  const isCritical = Boolean(data.attacker.result?.isCriticalSuccess);
  const sharedDamage = await getOrCreateSharedSpellDamage({ data, attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
  const damageInfo = sharedDamage ?? await computeSpellDamageShared({ attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
  const damageValue = Number(damageInfo?.damageValue ?? 0) || 0;
  const rollHTML = damageInfo?.rollHTML ?? "";

  // Ward BR applies equally to ALL damage types (no halving)
  const br = wardBR;
  const blocked = damageValue <= br;

  const wardArm = "Left Arm";
  const resolvedWardArm = resolveHitLocationForTarget(defenderActor, wardArm);
  const appliedDamage = blocked ? 0 : damageValue;

  // Store ward result and damage data inline on the parent card
  const wardResult = { blocked, wardBR: br, wardName, isAoE: false };
  const dmgData = {
    rolled: true,
    mode: "ward",
    finalDamage: appliedDamage,
    damageString: rollHTML,
    hitLocation: blocked ? "—" : resolvedWardArm,
    weaponName: spell.name,
    weaponImg: spell.img ?? "",
    qualityPillsHtml: "",
    applied: blocked ? true : false,
    wardResult,
    applyPayload: {
      targetUuid: defenderActor.uuid,
      targetName: defenderActor.name,
      magic: "1",
    },
    _magicPayload: {
      damage: appliedDamage,
      damageType,
      spellUuid: spell.uuid ?? "",
      casterUuid: attacker.uuid ?? "",
      hitLocation: resolvedWardArm,
      isCritical,
      source: spell.name,
      magicCost: Number(data.attacker?.mpSpent ?? data.context?.mpSpent ?? spell.system?.cost ?? 0),
      rollHTML,
      isOverloaded: Boolean(damageInfo?.isOverloaded),
      overloadBonus: Number(damageInfo?.overloadBonus ?? 0) || 0,
      isOvercharged: Boolean(damageInfo?.isOvercharged),
      overchargeTotals: Array.isArray(damageInfo?.overchargeTotals) ? damageInfo.overchargeTotals : null,
      elementalBonus: Number(damageInfo?.elementalBonus ?? 0) || 0,
      elementalBonusLabel: String(damageInfo?.elementalBonusLabel ?? ""),
      actualCost: Number(data.attacker?.mpSpent ?? data.context?.mpSpent ?? spell.system?.cost ?? 0),
      originalCastWorldTime: Number(data.context?.originalCastWorldTime ?? game?.time?.worldTime ?? 0) || 0,
      defenseType: "ward",
      isDamaging: !blocked,
      needsEffects: !blocked && Boolean(spellNeedsEffectApplication(spell)),
    },
  };
  setMagicDefenderDamage(data, defender, dmgData);
  // Clear needsBlockResolution so the button disappears
  outcome.needsBlockResolution = false;
  await ctx._updateCard(message, data);
}
