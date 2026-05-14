/**
 * src/core/magic/opposed/actions/defender-roll.js
 *
 * Defender roll handlers for magic opposed tests:
 *  - handleDefenderRoll           (block / evade / ward)
 *  - handleDefenderNoDefense      (non-banked no-defense path)
 *  - handleDefenderCharacteristicTest
 *  - computeEvadeTNWithBreakdown
 *  - computeBlockTNWithBreakdown
 */

import { doTestRoll } from "../../../../utils/degree-roll-helper.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { ActionEconomy } from "../../../combat/action-economy.js";
import { isActorInStartedCombatEncounter } from "../../../combat/combat-scope.js";
import { getActiveWardSpell } from "../../../combat/ward-defense.js";
import { computeSpellAttemptMagickaCost, consumeSpellMagicka } from "../../magicka-utils.js";
import { resolveToken } from "../schema.js";
import { executeCharacteristicDefense } from "../../characteristic-defense-service.js";
import { buildMagicCastContext } from "../cast-context.js";
import { hasCondition } from "../../../conditions/condition-engine.js";
import { markDefenderNoDefense } from "../../../combat/opposed/actions/eligibility.js";
import { isWarfareUnitActorType } from "../../../actors/types.js";
import { postMagicOpposedSubRoll } from "../subrolls.js";

/**
 * Compute evade TN with breakdown.
 * @param {Actor} defender
 * @returns {{finalTN: number, breakdown: Array, modifiers: Array}}
 */
export function computeEvadeTNWithBreakdown(defender) {
  // Warfare Units don't evade individually in standard combat.
  if (isWarfareUnitActorType(defender?.type)) {
    return { finalTN: 0, breakdown: [], modifiers: [] };
  }

  const sys = defender?.system ?? {};

  let baseTN = 0;
  let baseLabel = "Base TN";

  if (defender?.type === "NPC") {
    baseTN = Number(sys?.professions?.evade ?? sys?.professionsWound?.evade ?? 0) || 0;
  } else {
    const evadeSkill = defender?.items?.find((i) => i.type === "skill" && String(i.name ?? "").toLowerCase() === "evade")
      ?? defender?.items?.find((i) => i.type === "skill" && String(i.name ?? "").toLowerCase().includes("evade"))
      ?? null;
    baseTN = Number(evadeSkill?.system?.value ?? 0) || 0;
    if (!baseTN) {
      baseTN = Number(sys?.professions?.evade ?? sys?.professionsWound?.evade ?? 0) || 0;
    }
    if (!baseTN) {
      baseTN = Number(defender?.system?.characteristics?.agi?.total ?? defender?.system?.characteristics?.agi?.value ?? 0) || 0;
      baseLabel = "Agility";
    }
  }

  const fatiguePenalty = Number(defender?.system?.fatigue?.penalty ?? 0) || 0;
  const carryPenalty = Number(defender?.system?.carry_rating?.penalty ?? 0) || 0;
  const woundPenalty = Number(defender?.system?.woundPenalty ?? 0) || 0;

  const breakdown = [
    { label: baseLabel, value: baseTN, keepZero: true },
    { label: "Fatigue Penalty", value: fatiguePenalty },
    { label: "Carry Penalty", value: carryPenalty },
    { label: "Wound Penalty", value: woundPenalty }
  ];

  const finalTN = Math.max(0, baseTN + fatiguePenalty + carryPenalty + woundPenalty);
  return { finalTN, breakdown, modifiers: breakdown };
}

/**
 * Compute block TN with breakdown.
 * @param {Actor} defender
 * @returns {{finalTN: number, breakdown: Array, modifiers: Array}}
 */
export function computeBlockTNWithBreakdown(defender) {
  const sys = defender?.system ?? {};

  let baseTN = Number(sys?.professions?.combat ?? sys?.professionsWound?.combat ?? 0) || 0;
  let baseLabel = "Combat Profession";
  if (!baseTN && defender?.type !== "NPC") {
    const styles = (defender?.items ?? []).filter((i) => i.type === "combatStyle");
    const best = styles.sort((a, b) => (Number(b?.system?.value ?? 0) || 0) - (Number(a?.system?.value ?? 0) || 0))[0] ?? null;
    const v = Number(best?.system?.value ?? 0) || 0;
    if (v) {
      baseTN = v;
      baseLabel = "Combat Style";
    }
  }

  const fatiguePenalty = Number(defender?.system?.fatigue?.penalty ?? 0) || 0;
  const carryPenalty = Number(defender?.system?.carry_rating?.penalty ?? 0) || 0;
  const woundPenalty = Number(defender?.system?.woundPenalty ?? 0) || 0;

  const breakdown = [
    { label: baseLabel, value: baseTN, keepZero: true },
    { label: "Fatigue Penalty", value: fatiguePenalty },
    { label: "Carry Penalty", value: carryPenalty },
    { label: "Wound Penalty", value: woundPenalty }
  ];

  const finalTN = Math.max(0, baseTN + fatiguePenalty + carryPenalty + woundPenalty);
  return { finalTN, breakdown, modifiers: breakdown };
}

/**
 * Handle defender roll actions (block/evade/ward).
 * @param {object} ctx - Context object
 * @param {string} action - Action type (defender-roll-block, defender-roll-evade, defender-roll-ward)
 * @returns {Promise<object|undefined>}
 */
export async function handleDefenderRoll(ctx, action) {
  const { message, data, attacker, defender, defenderActor, defenderIndex, workflow, batchedUpdate } = ctx;

  if (defender?.result || defender?.noDefense) return;

  if (hasCondition(defenderActor, "helpless")) {
    markDefenderNoDefense(defender, "Helpless");
    await workflow._resolveOutcome(message, data, attacker, defenderActor, { defenderIndex, batchedUpdate, spell: ctx.spell ?? null });
    return data;
  }

  const apCost = Number(defender?.apCost ?? 1) || 1;
  const currentAP = Number(defenderActor?.system?.action_points?.value ?? 0) || 0;
  const defenderInStartedCombat = isActorInStartedCombatEncounter(defenderActor, {
    tokenUuid: defender?.tokenUuid ?? null,
    combatantId: defender?.combatantId ?? null
  });
  if (defenderInStartedCombat && currentAP < apCost) {
    ui.notifications.info("No Action Points available for defense; resolving as No Defense.");
    defender.noDefense = true;
    defender.defenseType = "-";
    defender.tn = null;
    defender.result = { rollTotal: 0, isSuccess: false, degree: 0, isCriticalSuccess: false, isCriticalFailure: false };
    await workflow._resolveOutcome(message, data, attacker, defenderActor, { defenderIndex, batchedUpdate, spell: ctx.spell ?? null });
    return data;
  }

  const defenseType = (action === "defender-roll-block") ? "block" : (action === "defender-roll-ward") ? "ward" : "evade";
  const defenseLabel = defenseType.charAt(0).toUpperCase() + defenseType.slice(1);
  const wardSpell = defenseType === "ward" ? getActiveWardSpell(defenderActor) : null;
  if (defenseType === "ward" && !wardSpell) {
    ui.notifications.warn("No active Ward spell found on the defender.");
    return;
  }

  let wardAttemptCost = 0;
  if (wardSpell) {
    const wardCostInfo = computeSpellAttemptMagickaCost(defenderActor, wardSpell, {});
    wardAttemptCost = Math.max(0, Number(wardCostInfo?.cost ?? 0) || 0);
    const currentMagicka = Number(defenderActor?.system?.magicka?.value ?? 0) || 0;
    if (currentMagicka < wardAttemptCost) {
      ui.notifications.warn(`Not enough Magicka to use ${wardSpell?.name ?? "Ward"}. Required: ${wardAttemptCost}, Available: ${currentMagicka}.`);
      return;
    }
  }

  const apSpentOk = await ActionEconomy.spendAP(defenderActor, apCost, {
    reason: `Defense (${defenseLabel})`,
    silent: false,
    tokenUuid: defender?.tokenUuid ?? null,
    combatantId: defender?.combatantId ?? null
  });
  if (!apSpentOk) return;

  if (wardSpell) {
    const wardSpend = await consumeSpellMagicka(defenderActor, wardSpell, {});
    if (!wardSpend?.ok) {
      try {
        if (defenderInStartedCombat) await requestUpdateDocument(defenderActor, { "system.action_points.value": currentAP });
      } catch (_e) {
        // best-effort
      }
      return;
    }
    defender.wardSpellUuid = String(wardSpell?.uuid ?? "");
    defender.wardSpellName = String(wardSpell?.name ?? "Ward");
    defender.wardMpSpent = Number(wardSpend?.consumed ?? wardAttemptCost) || 0;
    defender.wardMpRemaining = Number(wardSpend?.remaining ?? defenderActor?.system?.magicka?.value ?? 0) || 0;
  }

  const tnObj = (defenseType === "block" || defenseType === "ward") ? computeBlockTNWithBreakdown(defenderActor) : computeEvadeTNWithBreakdown(defenderActor);
  const manualMod = Number(defender?.declared?.manualMod ?? 0) || 0;
  const circumstanceMod = Number(defender?.declared?.circumstanceMod ?? 0) || 0;
  if (manualMod) {
    tnObj.breakdown = Array.isArray(tnObj.breakdown) ? tnObj.breakdown : [];
    tnObj.breakdown.push({ label: "Manual Modifier", value: manualMod });
  }
  if (circumstanceMod) {
    tnObj.breakdown = Array.isArray(tnObj.breakdown) ? tnObj.breakdown : [];
    tnObj.breakdown.push({ label: "Circumstance Modifier", value: circumstanceMod });
  }
  tnObj.modifiers = tnObj.breakdown;
  tnObj.finalTN = Math.max(0, Number(tnObj.finalTN ?? 0) + manualMod + circumstanceMod);
  const defenseTN = Number(tnObj.finalTN ?? 0) || 0;

  const result = await doTestRoll(defenderActor, {
    target: defenseTN,
    allowLucky: true,
    allowUnlucky: true
  });

  await postMagicOpposedSubRoll({
    roll: result.roll,
    actor: defenderActor,
    flavor: `<b>${defenseLabel}</b> vs ${data.attacker.spellName}`,
    parentMessageId: message.id,
    stage: "defender",
    defenderIndex
  });

  defender.result = result;
  defender.defenseType = defenseLabel;
  defender.tn = tnObj;

  await workflow._resolveOutcome(message, data, attacker, defenderActor, { defenderIndex, batchedUpdate, spell: ctx.spell ?? null });
  return data;
}

/**
 * Handle defender no defense action.
 * @param {object} ctx - Context object
 * @returns {Promise<object|undefined>}
 */
export async function handleDefenderNoDefense(ctx) {
  const { message, data, attacker, defender, defenderActor, defenderIndex, bankMode, workflow, batchedUpdate } = ctx;

  // This action should only be called in NON-banked mode
  // In banked mode, No Defense is committed and result is set immediately
  if (bankMode) {
    console.warn("UESRPG | defender-no-defense called in banked mode - this should not happen");
    return;
  }

  // No defense does not cost AP.
  if (defender?.result || defender?.noDefense) return;

  markDefenderNoDefense(defender, "No Defense");
  defender.defenseType = "-";
  defender.tn = null;
  defender.result = { rollTotal: 0, isSuccess: false, degree: 0, isCriticalSuccess: false, isCriticalFailure: false };

  await workflow._resolveOutcome(message, data, attacker, defenderActor, { defenderIndex, batchedUpdate, spell: ctx.spell ?? null });
  return data;
}

/**
 * Handle defender characteristic test action.
 * @param {object} ctx - Context object
 * @returns {Promise<object|undefined>}
 */
export async function handleDefenderCharacteristicTest(ctx) {
  const { message, data, attacker, defender, defenderActor, defenderIndex, workflow, batchedUpdate } = ctx;

  if (defender?.result || defender?.noDefense) return;

  // Characteristic defense doesn't cost AP - it's a saving throw
  // Use ctx.spell (resolved by dispatch) — ctx.attacker is the Actor doc, not the data object.
  const spell = ctx.spell ?? (data.attacker?.spellUuid ? await ctx._uuidResolver.resolve(data.attacker.spellUuid) : null);
  if (!spell) {
    ui.notifications.error("Cannot resolve characteristic defense: spell not found.");
    return;
  }

  // Validate characteristic defense configuration before rolling
  const spellConfig = spell.system?.engine?.characteristicDefense;
  const chaKey = String(spellConfig?.defenderCharacteristic ?? "").toLowerCase();
  if (!chaKey || !defenderActor.system?.characteristics?.[chaKey]) {
    const label = chaKey || "(missing)";
    ui.notifications.warn(`Characteristic defense: defender has no characteristic "${label}". Check spell configuration.`);
    console.warn("UESRPG | handleDefenderCharacteristicTest: invalid characteristic key", { chaKey, spell: spell.name, defender: defenderActor.name });
    // Fall through — executeCharacteristicDefense will use "end" as default
  }

  // Execute the characteristic defense test WITHOUT posting to chat (handled by opposed card)
  const defResult = await executeCharacteristicDefense(defenderActor, spell, {
    caster: attacker,
    attacker: data?.attacker ?? {},
    castContext: buildMagicCastContext(data?.attacker ?? {}, spell, { actor: attacker }),
    targetToken: resolveToken(data?.attacker?.tokenUuid),
    rollContext: data?.context?.rollContext,
    postToChat: false
  });
  if (!defResult) {
    ui.notifications.error("Characteristic defense test failed to execute.");
    return;
  }

  // Post the roll to chat as a separate 3D dice card (like opposed combat tests)
  await postMagicOpposedSubRoll({
    roll: defResult.roll,
    actor: defenderActor,
    flavor: `<b>${defResult.characteristicLabel} Save</b>`,
    parentMessageId: message.id,
    stage: "defender",
    defenderIndex
  });

  // Store result in defender entry (format matching doTestRoll output)
  defender.result = {
    rollTotal: Number(defResult.roll.total ?? 0),
    isSuccess: Boolean(defResult.success),
    degree: Number(defResult.degree ?? 0),
    isCriticalSuccess: Boolean(defResult.criticalSuccess),
    isCriticalFailure: Boolean(defResult.criticalFailure),
    roll: defResult.roll
  };
  defender.defenseType = "characteristic-save";
  defender.characteristicLabel = defResult.characteristicLabel;
  defender.tn = defResult.tnData;

  await workflow._resolveOutcome(message, data, attacker, defenderActor, { defenderIndex, batchedUpdate, spell });
  return data;
}
