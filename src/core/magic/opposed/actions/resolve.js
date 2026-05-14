/**
 * src/core/magic/opposed/actions/resolve.js
 *
 * Block and ward resolution handlers for magic opposed tests.
 */

import { getDefenderOutcome, setMagicDefenderDamage } from "../schema.js";
import { getOrCreateSharedSpellDamage, computeSpellDamageShared, spellNeedsEffectApplication } from "../spell-helpers.js";
import { getSpellCost, getSpellDamageType } from "../../magicka-utils.js";
import { getBlockValue } from "../../../combat/mitigation.js";
import { resolveHitLocationForTarget } from "../../../combat/combat-utils.js";
import { getActiveWardSpell } from "../../../combat/ward-defense.js";
import { listEquippedShields } from "../../../items/shield-utils.js";
import { buildMagicCastContextRows } from "../cast-context.js";

function buildMagicDamageComponents(spell, damageType, damageInfo = null) {
  if (Array.isArray(damageInfo?.components) && damageInfo.components.length) {
    return damageInfo.components
      .map((component) => ({
        source: String(component?.source ?? "spell"),
        sourceLabel: String(component?.sourceLabel ?? spell?.name ?? "Spell"),
        damageType: String(component?.damageType ?? damageType ?? "magic").trim().toLowerCase() || "magic",
        amount: Math.max(0, Number(component?.amount ?? 0) || 0),
      }))
      .filter((component) => component.amount > 0);
  }
  const components = [];
  const normalizedType = String(damageType ?? "magic").trim().toLowerCase() || "magic";
  const baseDamage = Number(damageInfo?.baseDamage ?? damageInfo?.damageValue ?? 0) || 0;
  if (baseDamage > 0) {
    components.push({
      source: "spell",
      sourceLabel: String(spell?.name ?? "Spell"),
      damageType: normalizedType,
      amount: baseDamage,
    });
  }
  const overloadBonus = Number(damageInfo?.overloadBonus ?? 0) || 0;
  if (overloadBonus > 0) {
    components.push({
      source: "overload",
      sourceLabel: "Overload Bonus",
      damageType: normalizedType,
      amount: overloadBonus,
    });
  }
  const elementalBonus = Number(damageInfo?.elementalBonus ?? 0) || 0;
  if (elementalBonus > 0) {
    components.push({
      source: "elemental-bonus",
      sourceLabel: String(damageInfo?.elementalBonusLabel ?? "Elemental Bonus"),
      damageType: normalizedType,
      amount: elementalBonus,
    });
  }
  return components;
}

function _getResolvedMagicCost(data, spell) {
  const castLevel = data?.attacker?.spellOptions?.castLevel ?? null;
  const fallbackCost = Number(getSpellCost(spell, castLevel) ?? 0) || 0;
  return Number(data?.attacker?.mpSpent ?? data?.context?.mpSpent ?? fallbackCost) || 0;
}

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
  const shields = listEquippedShields(defenderActor, { includeBuckler: false, allowLegacy: true });
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
  const effectiveDamageType = String(damageInfo?.damageType ?? damageType ?? "magic").trim().toLowerCase() || "magic";
  const damageValue = Number(damageInfo?.damageValue ?? 0) || 0;
  const rollHTML = damageInfo?.rollHTML ?? "";
  const castContext = buildMagicCastContextRows(data?.attacker ?? {}, spell);

  // Get Block Rating (magic damage treats BR as half, round up, unless magic BR exists)
  const br = getBlockValue(shield, effectiveDamageType);
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
    panelMetadata: castContext.rows,
    damageComponents: buildMagicDamageComponents(spell, effectiveDamageType, damageInfo),
    applied: blocked ? true : false,
    blockResult,
    applyPayload: {
      targetUuid: defenderActor.uuid,
      targetName: defenderActor.name,
      magic: "1",
    },
    _magicPayload: {
      damage: appliedDamage,
      damageType: effectiveDamageType,
      spellUuid: spell.uuid ?? "",
      casterUuid: attacker.uuid ?? "",
      casterTokenUuid: data.attacker?.tokenUuid ?? "",
      hitLocation: resolvedShieldArm,
      isCritical,
      source: spell.name,
      magicCost: _getResolvedMagicCost(data, spell),
      rollHTML,
      isOverloaded: Boolean(damageInfo?.isOverloaded),
      overloadBonus: Number(damageInfo?.overloadBonus ?? 0) || 0,
      isOvercharged: Boolean(damageInfo?.isOvercharged),
      overchargeTotals: Array.isArray(damageInfo?.overchargeTotals) ? damageInfo.overchargeTotals : null,
      elementalBonus: Number(damageInfo?.elementalBonus ?? 0) || 0,
      elementalBonusLabel: String(damageInfo?.elementalBonusLabel ?? ""),
      damageComponents: buildMagicDamageComponents(spell, effectiveDamageType, damageInfo),
      actualCost: _getResolvedMagicCost(data, spell),
      originalCastWorldTime: Number(data.context?.originalCastWorldTime ?? game?.time?.worldTime ?? 0) || 0,
      defenseType: "block",
      isDamaging: !blocked,
      needsEffects: !blocked && Boolean(spellNeedsEffectApplication(spell)),
      castContext,
      spellOptions: data?.attacker?.spellOptions ?? null,
      scalingChoices: data?.attacker?.spellOptions?.castLevel ? { level: data.attacker.spellOptions.castLevel } : null,
      castSource: data?.attacker?.castSource ?? null,
      itemCastContext: data?.context?.itemCastContext ?? null,
      magickaSpend: {
        consumed: _getResolvedMagicCost(data, spell),
        remaining: Number(data?.context?.mpRemaining ?? 0) || 0,
        refund: Number(data?.context?.mpRefund ?? 0) || 0
      },
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

  // Prefer the Ward spell actually paid for during the defense step.
  const wardSpellUuid = String(defender?.wardSpellUuid ?? "").trim();
  const resolvedWardDoc = wardSpellUuid ? await ctx?._uuidResolver?.resolve?.(wardSpellUuid) : null;
  const wardSpell = resolvedWardDoc?.documentName === "Item" ? resolvedWardDoc : getActiveWardSpell(defenderActor);
  if (!wardSpell) {
    ui.notifications.warn("No active Ward spell found on the defender.");
    return;
  }
  const wardBR = Math.max(0, Number(wardSpell?.system?.spell_str ?? 0) || 0);
  const wardName = String(defender?.wardSpellName ?? wardSpell?.name ?? "Ward");

  // Roll spell damage
  const spellOptions = data.attacker.spellOptions ?? {};
  const damageType = getSpellDamageType(spell);
  const isCritical = Boolean(data.attacker.result?.isCriticalSuccess);
  const sharedDamage = await getOrCreateSharedSpellDamage({ data, attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
  const damageInfo = sharedDamage ?? await computeSpellDamageShared({ attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
  const effectiveDamageType = String(damageInfo?.damageType ?? damageType ?? "magic").trim().toLowerCase() || "magic";
  const damageValue = Number(damageInfo?.damageValue ?? 0) || 0;
  const rollHTML = damageInfo?.rollHTML ?? "";
  const castContext = buildMagicCastContextRows(data?.attacker ?? {}, spell);

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
    panelMetadata: castContext.rows,
    damageComponents: buildMagicDamageComponents(spell, effectiveDamageType, damageInfo),
    applied: blocked ? true : false,
    wardResult,
    applyPayload: {
      targetUuid: defenderActor.uuid,
      targetName: defenderActor.name,
      magic: "1",
    },
    _magicPayload: {
      damage: appliedDamage,
      damageType: effectiveDamageType,
      spellUuid: spell.uuid ?? "",
      casterUuid: attacker.uuid ?? "",
      casterTokenUuid: data.attacker?.tokenUuid ?? "",
      hitLocation: resolvedWardArm,
      isCritical,
      source: spell.name,
      magicCost: _getResolvedMagicCost(data, spell),
      rollHTML,
      isOverloaded: Boolean(damageInfo?.isOverloaded),
      overloadBonus: Number(damageInfo?.overloadBonus ?? 0) || 0,
      isOvercharged: Boolean(damageInfo?.isOvercharged),
      overchargeTotals: Array.isArray(damageInfo?.overchargeTotals) ? damageInfo.overchargeTotals : null,
      elementalBonus: Number(damageInfo?.elementalBonus ?? 0) || 0,
      elementalBonusLabel: String(damageInfo?.elementalBonusLabel ?? ""),
      damageComponents: buildMagicDamageComponents(spell, effectiveDamageType, damageInfo),
      actualCost: _getResolvedMagicCost(data, spell),
      originalCastWorldTime: Number(data.context?.originalCastWorldTime ?? game?.time?.worldTime ?? 0) || 0,
      defenseType: "ward",
      isDamaging: !blocked,
      needsEffects: !blocked && Boolean(spellNeedsEffectApplication(spell)),
      castContext,
      spellOptions: data?.attacker?.spellOptions ?? null,
      scalingChoices: data?.attacker?.spellOptions?.castLevel ? { level: data.attacker.spellOptions.castLevel } : null,
      castSource: data?.attacker?.castSource ?? null,
      itemCastContext: data?.context?.itemCastContext ?? null,
      magickaSpend: {
        consumed: _getResolvedMagicCost(data, spell),
        remaining: Number(data?.context?.mpRemaining ?? 0) || 0,
        refund: Number(data?.context?.mpRefund ?? 0) || 0
      },
    },
  };
  setMagicDefenderDamage(data, defender, dmgData);
  // Clear needsBlockResolution so the button disappears
  outcome.needsBlockResolution = false;
  await ctx._updateCard(message, data);
}
