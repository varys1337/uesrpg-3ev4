/**
 * @module magic/opposed/outcome-resolution
 *
 * src/core/magic/opposed/outcome-resolution.js
 *
 * Outcome resolution logic for magic opposed workflow.
 * Handles direct casts, healing, opposed tests, damage application, and effect application.
 */

import { resolveOpposed } from "../../../utils/degree-roll-helper.js";
import { getSpellCost, getSpellDamageFormula, getSpellDamageType, rollSpellHealing } from "../magicka-utils.js";

import { getHitLocationFromRoll } from "../../combat/combat-utils.js";
import { getOrCreateSharedSpellDamage, computeSpellDamageShared, spellNeedsDeferredDirectApplication, spellNeedsEffectApplication, isHealingType, isTemporaryHealingType, maybeResolveAoEEvadeEscape } from "./spell-helpers.js";
import { setDefenderOutcome, markResolutionPhase, setMagicDefenderDamage } from "./schema.js";
import { trySpellReflect } from "../spell-runtime.js";
import { isCharacteristicDefense, executeCharacteristicDefense, processCharacteristicDefenseOutcome } from "../characteristic-defense-service.js";
import { createDebugLogger } from "../_primitives.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { buildMagicCastContextRows } from "./cast-context.js";
import { postMagicOpposedSubRoll } from "./subrolls.js";

const _spellDebug = createDebugLogger("spellCastingDebug");
function _buildMagicDamageComponents(spell, damageType, damageInfo = null, targetTotal = null) {
  if (Array.isArray(damageInfo?.components) && damageInfo.components.length) {
    const components = damageInfo.components
      .map((component) => ({
        source: String(component?.source ?? "spell"),
        sourceLabel: String(component?.sourceLabel ?? spell?.name ?? "Spell"),
        damageType: String(component?.damageType ?? damageType ?? "magic").trim().toLowerCase() || "magic",
        amount: Math.max(0, Number(component?.amount ?? 0) || 0),
      }))
      .filter((component) => component.amount > 0);
    const desired = Number(targetTotal);
    const current = components.reduce((sum, component) => sum + component.amount, 0);
    if (!Number.isFinite(desired) || desired <= 0 || current <= 0 || desired === current) return components;
    let remaining = Math.max(0, Math.floor(desired));
    return components.map((component, index) => {
      if (index === components.length - 1) return { ...component, amount: remaining };
      const amount = Math.min(remaining, Math.max(0, Math.round((component.amount / current) * desired)));
      remaining -= amount;
      return { ...component, amount };
    }).filter((component) => component.amount > 0);
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

/**
 * Build a damage data object suitable for `_buildDamagePanel()`.
 * All complex data for deferred application is stored in `_magicPayload`.
 *
 * @param {object} opts
 * @returns {object}
 */
function _buildMagicDamageData({
  mode = "weapon",
  finalDamage,
  damageString = "",
  hitLocation = "Body",
  spell,
  target,
  attacker,
  data,
  isCritical = false,
  damageType = "",
  damageInfo = null,
  isTemporary = false,
  defenseType = "",
  isDamaging = true,
  blockResult = null,
  wardResult = null,
}) {
  const isHealing = mode === "healing";
  const effectiveDamageType = String(damageInfo?.damageType ?? damageType ?? "").trim().toLowerCase();
  const hasBuffer = Boolean(spell?.system?.hasBuffer && spell?.system?.buffer?.type && spell.system.buffer.type !== "none");
  const actualCost = Number(
    data?.attacker?.mpSpent
    ?? data?.context?.mpSpent
    ?? getSpellCost(spell, data?.attacker?.spellOptions?.castLevel ?? null)
    ?? spell?.system?.cost
    ?? 0
  );
  const originalCastWorldTime = Number(data?.context?.originalCastWorldTime ?? game?.time?.worldTime ?? 0) || 0;
  const castContext = buildMagicCastContextRows(data?.attacker ?? {}, spell, { actor: attacker });

  return {
    rolled: true,
    mode,
    finalDamage,
    damageString,
    hitLocation,
    weaponName: spell?.name ?? "Spell",
    weaponImg: spell?.img ?? "",
    qualityPillsHtml: "",
    panelMetadata: castContext.rows,
    damageComponents: _buildMagicDamageComponents(spell, effectiveDamageType, damageInfo, finalDamage),
    applied: false,
    blockResult: blockResult ?? null,
    wardResult: wardResult ?? null,
    applyPayload: {
      targetUuid: target?.uuid ?? "",
      targetName: target?.name ?? "Target",
      magic: "1",
    },
    _magicPayload: {
      damage: finalDamage,
      damageType: effectiveDamageType || "",
      spellUuid: spell?.uuid ?? "",
      casterUuid: attacker?.uuid ?? "",
      casterTokenUuid: data?.attacker?.tokenUuid ?? "",
      hitLocation,
      isCritical,
      source: spell?.name ?? "Spell",
      magicCost: actualCost,
      rollHTML: damageInfo?.rollHTML ?? damageString ?? "",
      isOverloaded: Boolean(damageInfo?.isOverloaded),
      overloadBonus: Number(damageInfo?.overloadBonus ?? 0) || 0,
      isOvercharged: Boolean(damageInfo?.isOvercharged),
      overchargeTotals: Array.isArray(damageInfo?.overchargeTotals) ? damageInfo.overchargeTotals : null,
      elementalBonus: Number(damageInfo?.elementalBonus ?? 0) || 0,
      elementalBonusLabel: String(damageInfo?.elementalBonusLabel ?? ""),
      damageComponents: _buildMagicDamageComponents(spell, effectiveDamageType, damageInfo, finalDamage),
      actualCost,
      originalCastWorldTime,
      defenseType,
      isDamaging,
      isHealing,
      isTemporary,
      needsEffects: Boolean(spell && (spellNeedsEffectApplication(spell) || hasBuffer)),
      castContext,
      spellOptions: data?.attacker?.spellOptions ?? null,
      scalingChoices: data?.attacker?.spellOptions?.castLevel ? { level: data.attacker.spellOptions.castLevel } : null,
      castSource: data?.attacker?.castSource ?? null,
      itemCastContext: data?.context?.itemCastContext ?? null,
      magickaSpend: {
        consumed: Number(data?.attacker?.mpSpent ?? actualCost ?? 0) || 0,
        remaining: Number(data?.context?.mpRemaining ?? 0) || 0,
        refund: Number(data?.context?.mpRefund ?? 0) || 0
      },
    },
  };
}

async function _buildDeferredDirectApplicationData({
  message,
  data,
  attacker,
  defender,
  defenderEntry,
  spell,
  isCritical = false,
  defenseType = "",
}) {
  if (!spellNeedsDeferredDirectApplication(spell)) return null;

  const damageType = getSpellDamageType(spell);
  const effectiveDefenseType = String(defenseType ?? defenderEntry?.defenseType ?? "").trim().toLowerCase();

  if (isHealingType(damageType)) {
    const healRoll = await rollSpellHealing(spell, { isCritical });
    const healValue = Number(healRoll.total) || 0;
    const rollHTML = await healRoll.render();
    const isTemporaryHealing = isTemporaryHealingType(damageType);

    const healDmgData = _buildMagicDamageData({
      mode: "healing",
      finalDamage: healValue,
      damageString: rollHTML,
      hitLocation: "Body",
      spell,
      target: defender,
      attacker,
      data,
      isCritical,
      damageType,
      isTemporary: isTemporaryHealing,
      defenseType: effectiveDefenseType,
      isDamaging: false,
    });
    setMagicDefenderDamage(data, defenderEntry, healDmgData);

    return {
      healingApplied: isTemporaryHealing ? null : healValue,
      healingRollHTML: isTemporaryHealing ? null : rollHTML,
      tempHealingApplied: isTemporaryHealing ? healValue : null,
      tempHealingRollHTML: isTemporaryHealing ? rollHTML : null,
    };
  }

  const damageFormula = getSpellDamageFormula(spell, null, { actor: attacker });
  const isDamaging = Boolean(damageFormula && damageFormula !== "0" && damageType !== "none");
  if (isDamaging) {
    const spellOptions = data.attacker.spellOptions ?? {};
    const sharedDamage = await getOrCreateSharedSpellDamage({
      data,
      attacker,
      spell,
      spellOptions,
      isCritical,
      damageType,
      targetActor: defender,
      parentMessageId: message.id
    });
    const damageInfo = sharedDamage ?? await computeSpellDamageShared({
      attacker,
      spell,
      spellOptions,
      isCritical,
      damageType,
      targetActor: defender,
      parentMessageId: message.id
    });
    const damageValue = Number(damageInfo?.damageValue ?? 0) || 0;
    const rollHTML = damageInfo?.rollHTML ?? "";

    const dmgData = _buildMagicDamageData({
      finalDamage: damageValue,
      damageString: rollHTML,
      hitLocation: "Body",
      spell,
      target: defender,
      attacker,
      data,
      isCritical,
      damageType,
      damageInfo,
      defenseType: effectiveDefenseType,
      isDamaging: true,
    });
    setMagicDefenderDamage(data, defenderEntry, dmgData);
    return null;
  }

  const effectsOnlyData = _buildMagicDamageData({
    finalDamage: 0,
    damageString: "",
    hitLocation: "Body",
    spell,
    target: defender,
    attacker,
    data,
    isCritical,
    damageType,
    defenseType: effectiveDefenseType,
    isDamaging: false,
  });
  effectsOnlyData.effectsOnly = true;
  setMagicDefenderDamage(data, defenderEntry, effectsOnlyData);
  return null;
}

/**
 * Resolve direct undefendable spell outcome.
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function resolveDirectUndefendable(ctx) {
  const { message, data, attacker, defender, defenderEntry, spell, _updateCard } = ctx;
  const aResult = data.attacker.result;
  const isCritical = Boolean(aResult?.isCriticalSuccess);
  const castOk = Boolean(aResult?.isSuccess);

  const outcome = {
    winner: castOk ? "attacker" : "defender",
    attackerDegree: aResult?.degree ?? 0,
    defenderDegree: 0,
    attackerWins: castOk,
    damageApplied: castOk,
    text: castOk
      ? `${attacker.name} casts ${spell.name} directly on ${defender.name}.`
      : `${attacker.name} fails to cast ${spell.name}.`
  };
  setDefenderOutcome(data, defenderEntry, outcome);

  // Only apply effects if casting was successful
  if (!castOk) {
    markResolutionPhase(data);
    await _updateCard(message, data);
    return;
  }

  // ── Spell Reflect check (before damage/healing/effects) ──
  const reflectResult = await trySpellReflect(defender, spell, attacker);
  if (reflectResult.reflected) {
    outcome.spellReflected = true;
    if (reflectResult.behavior === "cancel") {
      outcome.text = `${attacker.name} casts ${spell.name} on ${defender.name}, but the spell is reflected and has no net effect.`;
      markResolutionPhase(data);
      await _updateCard(message, data);
      return;
    }
  }
  const effectiveTarget = reflectResult.reflected && reflectResult.behavior === "redirect" ? attacker : defender;

  const damageType = getSpellDamageType(spell);

  _spellDebug("UESRPG | _resolveOutcome: directUndefendable spell", {
    spellName: spell.name,
    rawDamageType: spell?.system?.damageType,
    damageType,
    isHealingType: isHealingType(damageType),
    defender: defender.name
  });

  // ── Healing: roll and apply immediately (includes temporary healing) ──
  if (isHealingType(damageType)) {
    const healRoll = await rollSpellHealing(spell, { isCritical });
    const healValue = Number(healRoll.total) || 0;
    const rollHTML = await healRoll.render();
    
    const isTemporaryHealing = isTemporaryHealingType(damageType);
    
    _spellDebug("UESRPG | _resolveOutcome: Healing spell details", {
      spellName: spell.name,
      damageType,
      normalizedDamageType: String(damageType || "").toLowerCase().trim(),
      isTemporaryHealing,
      healValue,
      defender: defender.name
    });
    
    // Store healing info in data for chat card display
    if (isTemporaryHealing) {
      outcome.tempHealingApplied = healValue;
      outcome.tempHealingRollHTML = rollHTML;
    } else {
      outcome.healingApplied = healValue;
      outcome.healingRollHTML = rollHTML;
    }
    
    _spellDebug("UESRPG | _resolveOutcome: Calling applyMagicHealing", {
      defender: defender.name,
      healValue,
      isTemporary: isTemporaryHealing,
      source: spell.name
    });

    const healDmgData = _buildMagicDamageData({
      mode: "healing", finalDamage: healValue, damageString: rollHTML,
      hitLocation: "Body", spell, target: effectiveTarget, attacker, data,
      isCritical, damageType, isTemporary: isTemporaryHealing, isDamaging: false,
    });
    setMagicDefenderDamage(data, defenderEntry, healDmgData);
    
    _spellDebug("UESRPG | _resolveOutcome: applyMagicHealing completed");
  }

  // ── Damage: roll and apply (damageType "none" suppresses damage even with a formula) ──
  else {
    const damageFormula = getSpellDamageFormula(spell, null, { actor: attacker });
    const isDamaging = Boolean(damageFormula && damageFormula !== "0" && damageType !== "none");

    if (isDamaging) {
      const spellOptions = data.attacker.spellOptions ?? {};
      const sharedDamage = await getOrCreateSharedSpellDamage({ data, attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
      const damageInfo = sharedDamage ?? await computeSpellDamageShared({ attacker, spell, spellOptions, isCritical, damageType, targetActor: effectiveTarget, parentMessageId: message.id });
      const damageValue = Number(damageInfo?.damageValue ?? 0) || 0;
      const rollHTML = damageInfo?.rollHTML ?? "";

      const dmgData = _buildMagicDamageData({
        finalDamage: damageValue, damageString: rollHTML,
        hitLocation: "Body", spell, target: effectiveTarget, attacker, data,
        isCritical, damageType, damageInfo, isDamaging: true,
      });
      setMagicDefenderDamage(data, defenderEntry, dmgData);
    }
  }

  markResolutionPhase(data);
  await _updateCard(message, data);
}

/**
 * Resolve legacy direct spell outcome (no test, auto-success).
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function resolveDirectNoTest(ctx) {
  const { message, data, attacker, defender, defenderEntry, spell, _updateCard } = ctx;
  const aResult = data.attacker.result;
  const isCritical = Boolean(aResult?.isCriticalSuccess);
  const castOk = Boolean(aResult?.isSuccess);

  const outcome = {
    winner: castOk ? "attacker" : "defender",
    attackerDegree: aResult?.degree ?? 0,
    defenderDegree: 0,
    attackerWins: castOk,
    damageApplied: castOk,
    text: castOk
      ? `${attacker.name} casts ${spell.name} directly on ${defender.name}.`
      : `${attacker.name} fails to cast ${spell.name}.`
  };
  setDefenderOutcome(data, defenderEntry, outcome);

  // Only apply effects if casting was successful
  if (!castOk) {
    markResolutionPhase(data);
    await _updateCard(message, data);
    return;
  }

  // ── Spell Reflect check (before damage/healing/effects) ──
  const reflectResult = await trySpellReflect(defender, spell, attacker);
  if (reflectResult.reflected) {
    outcome.spellReflected = true;
    if (reflectResult.behavior === "cancel") {
      outcome.text = `${attacker.name} casts ${spell.name} on ${defender.name}, but the spell is reflected and has no net effect.`;
      markResolutionPhase(data);
      await _updateCard(message, data);
      return;
    }
  }
  const effectiveTarget = reflectResult.reflected && reflectResult.behavior === "redirect" ? attacker : defender;

  const damageType = getSpellDamageType(spell);

  // ── Healing: roll and apply immediately (includes temporary healing) ──
  if (isHealingType(damageType)) {
    const healRoll = await rollSpellHealing(spell, { isCritical });
    const healValue = Number(healRoll.total) || 0;
    const rollHTML = await healRoll.render();
    
    const isTemporaryHealing = isTemporaryHealingType(damageType);
    
    _spellDebug("UESRPG | _resolveOutcome: Healing spell details (directNoTest)", {
      spellName: spell.name,
      rawDamageType: spell?.system?.damageType,
      damageType,
      normalizedDamageType: String(damageType || "").toLowerCase().trim(),
      isTemporaryHealing,
      healValue,
      defender: defender.name
    });
    
    // Store healing info in data for chat card display
    if (isTemporaryHealing) {
      outcome.tempHealingApplied = healValue;
      outcome.tempHealingRollHTML = rollHTML;
    } else {
      outcome.healingApplied = healValue;
      outcome.healingRollHTML = rollHTML;
    }
    
    _spellDebug("UESRPG | _resolveOutcome: Calling applyMagicHealing (directNoTest)", {
      defender: defender.name,
      healValue,
      isTemporary: isTemporaryHealing,
      source: spell.name
    });

    const healDmgData = _buildMagicDamageData({
      mode: "healing", finalDamage: healValue, damageString: rollHTML,
      hitLocation: "Body", spell, target: effectiveTarget, attacker, data,
      isCritical, damageType, isTemporary: isTemporaryHealing, isDamaging: false,
    });
    setMagicDefenderDamage(data, defenderEntry, healDmgData);
  }

  // ── Damage: roll and apply (damageType "none" suppresses damage even with a formula) ──
  else {
    const damageFormula = getSpellDamageFormula(spell, null, { actor: attacker });
    const isDamaging = Boolean(damageFormula && damageFormula !== "0" && damageType !== "none");

    if (isDamaging) {
      const spellOptions = data.attacker.spellOptions ?? {};
      const sharedDamage = await getOrCreateSharedSpellDamage({ data, attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
      const damageInfo = sharedDamage ?? await computeSpellDamageShared({ attacker, spell, spellOptions, isCritical, damageType, targetActor: effectiveTarget, parentMessageId: message.id });
      const damageValue = Number(damageInfo?.damageValue ?? 0) || 0;
      const rollHTML = damageInfo?.rollHTML ?? "";

      const dmgData = _buildMagicDamageData({
        finalDamage: damageValue, damageString: rollHTML,
        hitLocation: "Body", spell, target: effectiveTarget, attacker, data,
        isCritical, damageType, damageInfo, isDamaging: true,
      });
      setMagicDefenderDamage(data, defenderEntry, dmgData);
    }
  }

  markResolutionPhase(data);
  await _updateCard(message, data);
}

/**
 * Resolve healing direct spell outcome.
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function resolveHealingDirect(ctx) {
  const { message, data, attacker, defender, defenderEntry, spell, _updateCard } = ctx;
  const aResult = data.attacker.result;
  const isCritical = Boolean(aResult?.isCriticalSuccess);
  const castOk = Boolean(aResult?.isSuccess);

  const outcome = {
    winner: castOk ? "attacker" : "defender",
    attackerDegree: aResult?.degree ?? 0,
    defenderDegree: 0,
    attackerWins: castOk,
    damageApplied: castOk,
    text: castOk
      ? `${attacker.name} successfully casts ${spell.name} on ${defender.name}.`
      : `${attacker.name} fails to cast ${spell.name}.`
  };
  setDefenderOutcome(data, defenderEntry, outcome);

  if (castOk) {
    // ── Spell Reflect check (before healing application) ──
    const reflectResult = await trySpellReflect(defender, spell, attacker);
    if (reflectResult.reflected) {
      outcome.spellReflected = true;
      if (reflectResult.behavior === "cancel") {
        outcome.text = `${attacker.name} casts ${spell.name} on ${defender.name}, but the spell is reflected and has no net effect.`;
        await _updateCard(message, data);
        return;
      }
    }
    const effectiveTarget = reflectResult.reflected && reflectResult.behavior === "redirect" ? attacker : defender;

    const healRoll = await rollSpellHealing(spell, { isCritical });
    const healValue = Number(healRoll.total) || 0;
    const rollHTML = await healRoll.render();
    
    const damageType = getSpellDamageType(spell);
    const isTemporaryHealing = isTemporaryHealingType(damageType);
    
    _spellDebug("UESRPG | _resolveOutcome: Healing direct spell details", {
      spellName: spell.name,
      rawDamageType: spell?.system?.damageType,
      damageType,
      normalizedDamageType: String(damageType || "").toLowerCase().trim(),
      isTemporaryHealing,
      healValue,
      defender: defender.name
    });
    
    // Store healing info in data for chat card display
    if (isTemporaryHealing) {
      outcome.tempHealingApplied = healValue;
      outcome.tempHealingRollHTML = rollHTML;
    } else {
      outcome.healingApplied = healValue;
      outcome.healingRollHTML = rollHTML;
    }
    
    _spellDebug("UESRPG | _resolveOutcome: Calling applyMagicHealing (healingDirect)", {
      defender: defender.name,
      healValue,
      isTemporary: isTemporaryHealing,
      source: spell.name
    });

    const healDmgData = _buildMagicDamageData({
      mode: "healing", finalDamage: healValue, damageString: rollHTML,
      hitLocation: "Body", spell, target: effectiveTarget, attacker, data,
      isCritical, damageType, isTemporary: isTemporaryHealing, isDamaging: false,
    });
    setMagicDefenderDamage(data, defenderEntry, healDmgData);
  }

  markResolutionPhase(data);
  await _updateCard(message, data);
}

async function _resolveDirectDeferred(ctx, { textBuilder } = {}) {
  const { message, data, attacker, defender, defenderEntry, spell, _updateCard } = ctx;
  const aResult = data.attacker.result;
  const isCritical = Boolean(aResult?.isCriticalSuccess);
  const castOk = Boolean(aResult?.isSuccess);

  const outcome = {
    winner: castOk ? "attacker" : "defender",
    attackerDegree: aResult?.degree ?? 0,
    defenderDegree: 0,
    attackerWins: castOk,
    damageApplied: castOk,
    text: typeof textBuilder === "function"
      ? textBuilder({ castOk, attacker, defender, spell })
      : (castOk
        ? `${attacker.name} casts ${spell.name} directly on ${defender.name}.`
        : `${attacker.name} fails to cast ${spell.name}.`)
  };
  setDefenderOutcome(data, defenderEntry, outcome);

  if (!castOk) {
    markResolutionPhase(data);
    await _updateCard(message, data);
    return;
  }

  const reflectResult = await trySpellReflect(defender, spell, attacker);
  if (reflectResult.reflected) {
    outcome.spellReflected = true;
    if (reflectResult.behavior === "cancel") {
      outcome.text = `${attacker.name} casts ${spell.name} on ${defender.name}, but the spell is reflected and has no net effect.`;
      markResolutionPhase(data);
      await _updateCard(message, data);
      return;
    }
  }

  const effectiveTarget = reflectResult.reflected && reflectResult.behavior === "redirect" ? attacker : defender;
  const appliedMeta = await _buildDeferredDirectApplicationData({
    message,
    data,
    attacker,
    defender: effectiveTarget,
    defenderEntry,
    spell,
    isCritical,
    defenseType: defenderEntry?.defenseType ?? ""
  });

  if (appliedMeta?.healingApplied != null) {
    outcome.healingApplied = appliedMeta.healingApplied;
    outcome.healingRollHTML = appliedMeta.healingRollHTML;
  }
  if (appliedMeta?.tempHealingApplied != null) {
    outcome.tempHealingApplied = appliedMeta.tempHealingApplied;
    outcome.tempHealingRollHTML = appliedMeta.tempHealingRollHTML;
  }

  markResolutionPhase(data);
  await _updateCard(message, data);
}

async function resolveDirectUndefendableDeferred(ctx) {
  return _resolveDirectDeferred(ctx, {
    textBuilder: ({ castOk, attacker, defender, spell }) => castOk
      ? `${attacker.name} casts ${spell.name} directly on ${defender.name}.`
      : `${attacker.name} fails to cast ${spell.name}.`
  });
}

async function resolveDirectNoTestDeferred(ctx) {
  return _resolveDirectDeferred(ctx, {
    textBuilder: ({ castOk, attacker, defender, spell }) => castOk
      ? `${attacker.name} casts ${spell.name} directly on ${defender.name}.`
      : `${attacker.name} fails to cast ${spell.name}.`
  });
}

async function resolveHealingDirectDeferred(ctx) {
  return _resolveDirectDeferred(ctx, {
    textBuilder: ({ castOk, attacker, defender, spell }) => castOk
      ? `${attacker.name} successfully casts ${spell.name} on ${defender.name}.`
      : `${attacker.name} fails to cast ${spell.name}.`
  });
}

/**
 * Resolve opposed test outcome.
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function resolveOpposedTest(ctx) {
  const { message, data, attacker, defender, defenderEntry, spell, isAoE, forcedHitLocation, _updateCard } = ctx;
  const aResult = data.attacker.result;
  const castOk = Boolean(aResult?.isSuccess);

  // If casting test failed, spell doesn't reach the target — no reflect needed
  if (!castOk) {
    const outcome = {
      winner: "defender",
      attackerDegree: aResult?.degree ?? 0,
      defenderDegree: 0,
      attackerWins: false,
      damageApplied: false,
      text: `${attacker.name} fails to cast ${spell.name}.`
    };
    setDefenderOutcome(data, defenderEntry, outcome);
    markResolutionPhase(data);
    await _updateCard(message, data);
    return;
  }

  // ── Spell Reflect check (supersedes opposed resolution entirely) ──
  const reflectResult = await trySpellReflect(defender, spell, attacker);
  if (reflectResult.reflected) {
    const reflectOutcome = {
      winner: "attacker",
      attackerDegree: 0,
      defenderDegree: 0,
      attackerWins: true,
      damageApplied: reflectResult.behavior === "redirect",
      spellReflected: true,
      text: reflectResult.behavior === "cancel"
        ? `${defender.name} reflects ${spell.name} — no net effect.`
        : `${defender.name} reflects ${spell.name} back at ${attacker.name}!`
    };
    setDefenderOutcome(data, defenderEntry, reflectOutcome);

    if (reflectResult.behavior === "cancel") {
      markResolutionPhase(data);
      await _updateCard(message, data);
      return;
    }

    // "redirect" — apply spell to caster as if it hit (no opposed test needed)
    const effectiveTarget = attacker;
    const isCritical = false; // reflected spells are not critical
    const damageFormula = getSpellDamageFormula(spell, null, { actor: attacker });
    const damageType = getSpellDamageType(spell);
    const isDamaging = Boolean(damageFormula && damageFormula !== "0" && damageType !== "none");

    if (isDamaging) {
      const spellOptions = data.attacker.spellOptions ?? {};
      const sharedDamage = await getOrCreateSharedSpellDamage({ data, attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
      const damageInfo = sharedDamage ?? await computeSpellDamageShared({ attacker, spell, spellOptions, isCritical, damageType, targetActor: effectiveTarget, parentMessageId: message.id });
      const damageValue = Number(damageInfo?.damageValue ?? 0) || 0;
      const rollHTML = damageInfo?.rollHTML ?? "";

      const dmgData = _buildMagicDamageData({
        finalDamage: damageValue, damageString: rollHTML,
        hitLocation: "Body", spell, target: effectiveTarget, attacker, data,
        isCritical, damageType, damageInfo, isDamaging: true,
      });
      setMagicDefenderDamage(data, defenderEntry, dmgData);
    }

    markResolutionPhase(data);
    await _updateCard(message, data);
    return;
  }

  const dResult = defenderEntry.result;

  // Chapter 5 (Combat Criticals): if both sides roll any critical (success or failure),
  // neither attack nor defense resolves.
  const aCrit = Boolean(aResult?.isCriticalSuccess || aResult?.isCriticalFailure);
  const dCrit = Boolean(dResult?.isCriticalSuccess || dResult?.isCriticalFailure);
  if (aCrit && dCrit) {
    const finalOutcome = {
      winner: "tie",
      reason: "both sides roll a critical",
      attackerWins: false,
      damageApplied: false,
      blockHalfDamage: false,
      defenderWinsByBlock: false,
      needsBlockResolution: false,
      aoeEvadeEscaped: false,
      aoeEvadeFailed: false,
      text: `Both sides roll a critical — neither attack nor defense resolves.`
    };
    setDefenderOutcome(data, defenderEntry, finalOutcome);
    await _updateCard(message, data);
    return;
  }

  const outcome = resolveOpposed(aResult, dResult);
  const defenseType = String(defenderEntry.defenseType ?? "").toLowerCase();
  const isBlock = defenseType === "block";
  const isWard = defenseType === "ward";
  const isEvade = defenseType === "evade";
  
  // RAW: When both pass and defender blocks (or wards), defender wins regardless of DoS
  const bothPassed = Boolean(aResult?.isSuccess && dResult?.isSuccess);
  const defenderWinsByBlock = bothPassed && (isBlock || isWard);
  
  // Override outcome if both passed and defender blocked
  const finalOutcomeWinner = defenderWinsByBlock ? "defender" : outcome.winner;
  
  const defenderBlock = (isAoE && finalOutcomeWinner === "defender" && (isBlock || isWard)) || defenderWinsByBlock;
  const defenderEvade = isAoE && finalOutcomeWinner === "defender" && isEvade;
  let aoeEvadeEscaped = null;

  if (defenderEvade && Boolean(aResult?.isSuccess)) {
    aoeEvadeEscaped = await maybeResolveAoEEvadeEscape({ data, defenderEntry, defenderActor: defender });
  }

  const attackerWins = finalOutcomeWinner === "attacker";
  // For AoE blocks when both pass: apply half damage
  // For non-AoE blocks when both pass: need to resolve block with BR check
  const applyOnBlock = isAoE && defenderBlock && Boolean(aResult?.isSuccess);
  const applyOnEvadeFail = defenderEvade && aoeEvadeEscaped === false && Boolean(aResult?.isSuccess);
  const damageApplied = attackerWins || applyOnBlock || applyOnEvadeFail;

  const defenseVerb = isWard ? "wards" : "blocks";

  const resultText = attackerWins
    ? `${spell.name} hits ${defender.name}.`
    : (defenderBlock
      ? (isAoE && applyOnBlock
        ? `${defender.name} ${defenseVerb} ${spell.name}, taking half damage.`
        : `${defender.name} ${defenseVerb} ${spell.name}.`)
      : (defenderEvade
        ? (aoeEvadeEscaped === true
          ? `${defender.name} evades ${spell.name} and escapes the area.`
          : (aoeEvadeEscaped === false
            ? `${defender.name} evades ${spell.name} but remains in the area, taking full damage.`
            : `${defender.name} evades ${spell.name}.`))
        : `${defender.name} defends against ${spell.name}.`));

  const finalOutcome = {
    ...outcome,
    winner: finalOutcomeWinner,
    attackerWins,
    damageApplied,
    blockHalfDamage: applyOnBlock,
    defenderWinsByBlock: defenderWinsByBlock,
    needsBlockResolution: defenderWinsByBlock && !isAoE,
    aoeEvadeEscaped: aoeEvadeEscaped === true,
    aoeEvadeFailed: aoeEvadeEscaped === false,
    text: resultText
  };
  setDefenderOutcome(data, defenderEntry, finalOutcome);

  if (damageApplied) {
    const isCritical = Boolean(aResult?.isCriticalSuccess);
    const hitLocation = forcedHitLocation || (isAoE ? "Body" : getHitLocationFromRoll(Number(aResult?.rollTotal ?? 0)));

    const damageFormula = getSpellDamageFormula(spell, null, { actor: attacker });
    const damageType = getSpellDamageType(spell);
    const isDamaging = Boolean(damageFormula && damageFormula !== "0" && damageType !== "none");

    if (isDamaging) {
      const spellOptions = data.attacker.spellOptions ?? {};
      const sharedDamage = await getOrCreateSharedSpellDamage({ data, attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
      const damageInfo = sharedDamage ?? await computeSpellDamageShared({ attacker, spell, spellOptions, isCritical, damageType, targetActor: defender, parentMessageId: message.id });
      const damageValue = Number(damageInfo?.damageValue ?? 0) || 0;
      const appliedDamage = applyOnBlock ? Math.ceil(damageValue / 2) : damageValue;
      const rollHTML = damageInfo?.rollHTML ?? "";

      const dmgData = _buildMagicDamageData({
        finalDamage: appliedDamage, damageString: rollHTML,
        hitLocation, spell, target: defender, attacker, data,
        isCritical, damageType, damageInfo, isDamaging: true,
        defenseType: String(defenderEntry.defenseType ?? ""),
      });
      setMagicDefenderDamage(data, defenderEntry, dmgData);
    } else if (attackerWins) {
      // Non-damaging spell hits: build a minimal panel for effects-only application
      const dmgData = _buildMagicDamageData({
        finalDamage: 0, damageString: "",
        hitLocation, spell, target: defender, attacker, data,
        isCritical, damageType: getSpellDamageType(spell), isDamaging: false,
        defenseType: String(defenderEntry.defenseType ?? ""),
      });
      dmgData.effectsOnly = true;
      setMagicDefenderDamage(data, defenderEntry, dmgData);
    }
  }

  markResolutionPhase(data);
  await _updateCard(message, data);
}

/**
 * Resolve a spell that uses characteristic defense (save-like model).
 * The caster's casting roll has already succeeded; the defender rolls a
 * characteristic save.  On save success the spell is negated/halved; on
 * failure spell damage and effects are applied normally.
 *
 * @param {object} ctx - Standard resolution context
 * @returns {Promise<void>}
 */
async function resolveWithCharacteristicDefense(ctx) {
  const { message, data, attacker, defender, defenderEntry, spell, isAoE, forcedHitLocation, _updateCard } = ctx;
  const aResult = data.attacker.result;
  const isCritical = Boolean(aResult?.isCriticalSuccess);
  const castOk = Boolean(aResult?.isSuccess);

  // If the caster failed, nothing to defend against
  if (!castOk) {
    const outcome = {
      winner: "defender",
      attackerDegree: aResult?.degree ?? 0,
      defenderDegree: 0,
      attackerWins: false,
      damageApplied: false,
      text: `${attacker.name} fails to cast ${spell.name}.`
    };
    setDefenderOutcome(data, defenderEntry, outcome);
    markResolutionPhase(data);
    await _updateCard(message, data);
    return;
  }

  // ── Spell Reflect check (before save) ──
  const reflectResult = await trySpellReflect(defender, spell, attacker);
  if (reflectResult.reflected) {
    const reflectOutcome = {
      winner: "attacker",
      attackerDegree: aResult?.degree ?? 0,
      defenderDegree: 0,
      attackerWins: true,
      damageApplied: reflectResult.behavior === "redirect",
      spellReflected: true,
      text: reflectResult.behavior === "cancel"
        ? `${defender.name} reflects ${spell.name} — no net effect.`
        : `${defender.name} reflects ${spell.name} back at ${attacker.name}!`
    };
    setDefenderOutcome(data, defenderEntry, reflectOutcome);

    if (reflectResult.behavior === "cancel") {
      markResolutionPhase(data);
      await _updateCard(message, data);
      return;
    }

    // "redirect" — apply full spell to caster (no save for reflected spells)
    const effectiveTarget = attacker;
    await _applyCharDefDamageAndEffects(ctx, effectiveTarget, isCritical, reflectOutcome);
    markResolutionPhase(data);
    await _updateCard(message, data);
    return;
  }

  // ── Execute characteristic defense save ──
  // If the defender already rolled via the chat card button (handleDefenderCharacteristicTest),
  // use their stored result instead of rolling a second time.
  let defResult;
  // Guard: if the defender was stamped with noDefense=true (e.g. isDirect spells in
  // the directNoDefense block), the stored result is a placeholder — not a real roll.
  // In that case, ignore the preRolled data and execute the actual characteristic save.
  const preRolled = defenderEntry?.result
    && defenderEntry?.defenseType === "characteristic-save"
    && defenderEntry?.tn
    && !defenderEntry?.noDefense;
  _spellDebug("UESRPG | resolveWithCharacteristicDefense:", {
    preRolled: Boolean(preRolled),
    hasResult: Boolean(defenderEntry?.result),
    defenseType: defenderEntry?.defenseType,
    hasTN: Boolean(defenderEntry?.tn),
    defender: defender?.name
  });
  if (preRolled) {
    // Reconstruct defResult from stored defender data
    const config = (await import("../spell-config.js")).normalizeSpellConfig(spell);
    const charDef = config?.characteristicDefense;
    defResult = {
      success: Boolean(defenderEntry.result.isSuccess),
      criticalSuccess: Boolean(defenderEntry.result.isCriticalSuccess),
      criticalFailure: Boolean(defenderEntry.result.isCriticalFailure),
      rollTotal: Number(defenderEntry.result.rollTotal ?? 0),
      target: Number(defenderEntry.tn?.finalTN ?? defenderEntry.tn ?? 0),
      degree: Number(defenderEntry.result.degree ?? 0),
      characteristic: charDef?.defenderCharacteristic || "end",
      characteristicLabel: defenderEntry.characteristicLabel ?? "CHA",
      characteristicTotal: Number(defenderEntry.tn?.baseTN ?? 0),
      modifier: Number(defenderEntry.tn?.totalMod ?? 0),
      onSuccess: charDef?.onSuccess ?? "negate",
      onFailure: charDef?.onFailure ?? "consequences",
      result: defenderEntry.result,
      roll: defenderEntry.result.roll
    };
  } else {
    defResult = await executeCharacteristicDefense(defender, spell, {
      caster: attacker,
      attacker: data?.attacker ?? {},
      castContext: buildMagicCastContextRows(data?.attacker ?? {}, spell, { actor: attacker }),
      postToChat: false
    });
    if (defResult) {
      // Store the actual defense result and TN on the defender entry so the
      // chat card re-renders with correct data instead of stale placeholders.
      defenderEntry.result = {
        rollTotal: Number(defResult.rollTotal ?? 0),
        isSuccess: Boolean(defResult.success),
        degree: Number(defResult.degree ?? 0),
        isCriticalSuccess: Boolean(defResult.criticalSuccess),
        isCriticalFailure: Boolean(defResult.criticalFailure)
      };
      defenderEntry.tn = defResult.tnData;
      defenderEntry.characteristicLabel = defResult.characteristicLabel;
      defenderEntry.noDefense = false;
      defenderEntry.defenseType = "characteristic-save";

      // Post the roll to chat for 3D dice and audit trail
      try {
        await postMagicOpposedSubRoll({
          roll: defResult.roll,
          actor: defender,
          flavor: `<b>${defResult.characteristicLabel} Save</b>`,
          parentMessageId: message.id,
          stage: "characteristic-defense"
        });
      } catch (_chatErr) {
        console.warn("UESRPG | Failed to post characteristic defense roll to chat", _chatErr);
      }
    }
  }
  if (!defResult) {
    // If save execution fails (edge case), treat as undefended
    _spellDebug("UESRPG | resolveWithCharacteristicDefense: save execution returned null, treating as undefended");
    const fallbackOutcome = {
      winner: "attacker",
      attackerDegree: aResult?.degree ?? 0,
      defenderDegree: 0,
      attackerWins: true,
      damageApplied: true,
      text: `${spell.name} hits ${defender.name} (no save available).`
    };
    setDefenderOutcome(data, defenderEntry, fallbackOutcome);
    await _applyCharDefDamageAndEffects(ctx, defender, isCritical, fallbackOutcome);
    markResolutionPhase(data);
    await _updateCard(message, data);
    return;
  }

  // ── Process save outcome via consequence engine ──
  const saveOutcome = await processCharacteristicDefenseOutcome(defender, spell, defResult, { caster: attacker, suppressChat: true });

  if (saveOutcome?.resisted) {
    // Full resist — no damage, no effects
    const resistOutcome = {
      winner: "defender",
      attackerDegree: aResult?.degree ?? 0,
      defenderDegree: defResult.degree ?? 0,
      attackerWins: false,
      damageApplied: false,
      characteristicDefense: true,
      saveSuccess: true,
      text: `${defender.name} resists ${spell.name}! (${defResult.characteristicLabel} save succeeded)`
    };
    setDefenderOutcome(data, defenderEntry, resistOutcome);
    markResolutionPhase(data);
    await _updateCard(message, data);
    return;
  }

  // Save failed or halved — apply damage/effects
  const applyDamage = !saveOutcome?.halved || saveOutcome?.applyDamage !== false;
  const halveDamage = Boolean(saveOutcome?.halved);

  const hitOutcome = {
    winner: "attacker",
    attackerDegree: aResult?.degree ?? 0,
    defenderDegree: defResult.degree ?? 0,
    attackerWins: true,
    damageApplied: applyDamage,
    characteristicDefense: true,
    saveSuccess: false,
    saveHalved: halveDamage,
    text: halveDamage
      ? `${defender.name} partially resists ${spell.name} (halved).`
      : `${spell.name} hits ${defender.name}! (${defResult.characteristicLabel} save failed)`
  };
  setDefenderOutcome(data, defenderEntry, hitOutcome);

  if (applyDamage) {
    await _applyCharDefDamageAndEffects(ctx, defender, isCritical, hitOutcome, halveDamage);
  }

  markResolutionPhase(data);
  await _updateCard(message, data);
}

/**
 * Shared helper: apply spell damage and effects for characteristic defense outcomes.
 * @private
 */
async function _applyCharDefDamageAndEffects(ctx, effectiveTarget, isCritical, outcome, halveDamage = false) {
  const { data, attacker, spell, isAoE, forcedHitLocation, defenderEntry } = ctx;
  const hitLocation = forcedHitLocation || (isAoE ? "Body" : getHitLocationFromRoll(Number(data.attacker.result?.rollTotal ?? 0)));

  const damageFormula = getSpellDamageFormula(spell, null, { actor: attacker });
  const damageType = getSpellDamageType(spell);
  const isDamaging = Boolean(damageFormula && damageFormula !== "0" && damageType !== "none");

  if (isHealingType(damageType)) {
    // Characteristic defense on healing spells: apply healing
    const healRoll = await rollSpellHealing(spell, { isCritical });
    const healValue = Number(healRoll.total) || 0;
    const rollHTML = await healRoll.render();
    const isTemporaryHealing = isTemporaryHealingType(damageType);
    const appliedHeal = halveDamage ? Math.ceil(healValue / 2) : healValue;

    if (isTemporaryHealing) {
      outcome.tempHealingApplied = appliedHeal;
      outcome.tempHealingRollHTML = rollHTML;
    } else {
      outcome.healingApplied = appliedHeal;
      outcome.healingRollHTML = rollHTML;
    }

    const healDmgData = _buildMagicDamageData({
      mode: "healing", finalDamage: appliedHeal, damageString: rollHTML,
      hitLocation, spell, target: effectiveTarget, attacker, data,
      isCritical, damageType, isTemporary: isTemporaryHealing, isDamaging: false,
      defenseType: "characteristic-save",
    });
    setMagicDefenderDamage(data, defenderEntry, healDmgData);
  } else if (isDamaging) {
    const spellOptions = data.attacker.spellOptions ?? {};
    const sharedDamage = await getOrCreateSharedSpellDamage({ data, attacker, spell, spellOptions, isCritical, damageType, parentMessageId: ctx?.message?.id ?? null });
    const damageInfo = sharedDamage ?? await computeSpellDamageShared({ attacker, spell, spellOptions, isCritical, damageType, targetActor: effectiveTarget, parentMessageId: ctx?.message?.id ?? null });
    const damageValue = Number(damageInfo?.damageValue ?? 0) || 0;
    const appliedDamage = halveDamage ? Math.ceil(damageValue / 2) : damageValue;
    const rollHTML = damageInfo?.rollHTML ?? "";

    const dmgData = _buildMagicDamageData({
      finalDamage: appliedDamage, damageString: rollHTML,
      hitLocation, spell, target: effectiveTarget, attacker, data,
      isCritical, damageType, damageInfo, isDamaging: true,
      defenseType: "characteristic-save",
    });
    setMagicDefenderDamage(data, defenderEntry, dmgData);
  }

}

/**
 * Main outcome resolution router.
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function resolveOutcome(ctx) {
  const { data, attacker, spell, skipAttackerSideEffects = false } = ctx;

  // Track last spell cast time/uuid for RAW upkeep restriction (no-duration spells).
  const aResult = data.attacker.result;
  if (!skipAttackerSideEffects && aResult?.success) {
    try {
      await requestUpdateDocument(attacker, {
        [`flags.${FLAG_SCOPE}.lastSpellCastWorldTime`]: game.time.worldTime,
        [`flags.${FLAG_SCOPE}.lastSpellCastSpellUuid`]: spell.uuid
      });
    } catch (err) {
      console.warn("UESRPG | Failed to set last spell cast flags", err);
    }
  }

  // Route to appropriate resolution handler

  // Characteristic defense (save-like): replaces standard opposed defense.
  // Must be checked BEFORE directUndefendable/healingDirect to catch spells
  // that are also marked Direct but use characteristic defense.
  if (spell && isCharacteristicDefense(spell)) {
    return await resolveWithCharacteristicDefense(ctx);
  }

  if (Boolean(data.context?.directUndefendable)) {
    return await resolveDirectUndefendableDeferred(ctx);
  }

  if (Boolean(data.context?.directNoTest)) {
    return await resolveDirectNoTestDeferred(ctx);
  }

  if (Boolean(data.context?.healingDirect)) {
    return await resolveHealingDirectDeferred(ctx);
  }

  // Default: opposed test
  return await resolveOpposedTest(ctx);
}
