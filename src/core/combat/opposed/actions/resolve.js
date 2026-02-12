/**
 * src/core/combat/opposed/actions/resolve.js
 * Defender advantage and block resolution handlers
 */

import { _resolveDoc } from "../helpers/docs.js";
import { _canControlActor, _opposedFlags } from "../helpers/util.js";
import { _getDefenderOutcome, _getDefenderAdvantage, _getDefenderResolutionState, _getDefenderDamage, _setDefenderDamage } from "../schema.js";
import { applyOverextendEffect as _applyOverextendEffect, applyOverwhelmEffect as _applyOverwhelmEffect } from "../effects.js";
import { promptDefenderAdvantage as _promptDefenderAdvantage } from "../dialogs/defender.js";
import { getSpecialActionById } from "../../../config/special-actions.js";
import { listEquippedShields as _listEquippedShields } from "../helpers/utility.js";
import { weaponHasQuality as _weaponHasQuality, asNumber as _asNumber, getPreferredWeaponUuid as _getPreferredWeaponUuid } from "../helpers/workflow.js";
import { getDamageTypeFromWeapon } from "../../combat-utils.js";
import { getBlockValue } from "../../mitigation.js";
import { DAMAGE_TYPES } from "../../damage-automation.js";
import { rollWeaponDamage as _rollWeaponDamage } from "../damage/roller.js";
import { _promptWeaponAndAdvantages, _ensureResolvedForPostActions } from "../../opposed-workflow.js";
import { getHitLocationFromRoll, resolveHitLocationForTarget } from "../../combat-utils.js";
import { getActiveStaminaEffect, consumeStaminaEffect, STAMINA_EFFECT_KEYS } from "../../../stamina/stamina-dialog.js";
import { UESRPG } from "../../../constants.js";
import { selectEquippedRangedWeapon } from "../helpers/select-equipped-ranged-weapon.js";
import { inflateSharedDamage as _inflateSharedDamage, buildSharedDamagePayload as _buildSharedDamagePayload } from "./damage.js";
import { _buildApplyPayload, _emitInlineDamageRollMessage } from "./damage.js";
import { getWardBlockRating, getActiveWardSpell } from "../../ward-defense.js";

/**
 * Handle defender advantage resolution
 * @param {Object} ctx - Context object with all required data
 */
export async function handleDefenderAdvantage(ctx) {
  const { message, data, attacker, defender, defenderData, defenderIndex, defenders, isMulti, aToken, dToken, bankMode, isAoE, opts, _updateCard } = ctx;

  const resolvedOk = await _ensureResolvedForPostActions(message, data, { defenderIndex });
  if (!resolvedOk) {
    ui.notifications.warn("Defender Advantage can only be resolved after the opposed test is resolved and the defender wins.");
    return;
  }

  const outcome = _getDefenderOutcome(data, data.defender);
  if (!outcome || outcome.winner !== "defender") {
    ui.notifications.warn("Defender Advantage can only be resolved after the opposed test is resolved and the defender wins.");
    return;
  }
  // If the defender chose No Defense, they are treated as having failed and cannot utilize Advantage.
  if (data.defender?.noDefense === true || String(data.defender?.defenseType ?? "none") === "none") {
    ui.notifications.warn("No Defense was chosen; defender cannot resolve Advantage.");
    return;
  }
  // Counter-Attack and Block have their own dedicated resolution actions.
  const dt = String(data.defender?.defenseType ?? "none");
  if (dt === "counter" || dt === "block") {
    ui.notifications.warn("This defense type has a dedicated resolution action.");
    return;
  }

  if (!_canControlActor(defender) && !game.user.isGM) {
    ui.notifications.warn("You do not have permission to resolve Advantage for this defender.");
    return;
  }

  const advantage = _getDefenderAdvantage(data, data.defender) ?? { attacker: 0, defender: 0 };
  const advCount = Number(advantage.defender ?? 0);
  if (!Number.isFinite(advCount) || advCount <= 0) {
    ui.notifications.warn("No Advantage is available to resolve for the defender.");
    return;
  }

  // Prevent double-resolution.
  const resolutionState = _getDefenderResolutionState(data, data.defender);
  if (resolutionState.defenderAdvantage.resolved === true || resolutionState.advantageSpent?.defender === true) {
    ui.notifications.warn("Defender Advantage has already been resolved.");
    return;
  }

  const attackerResolved = _resolveDoc(data?.attacker?.actorUuid);
  if (!attackerResolved) {
    ui.notifications.warn("Attacker could not be resolved.");
    return;
  }

  const choice = await _promptDefenderAdvantage({
    defenderActor: defender,
    attackerActor: attackerResolved,
    advantageCount: advCount,
    defenderTokenUuid: data.defender?.tokenUuid ?? null,
    opponentTokenUuid: data.attacker?.tokenUuid ?? null
  });

  // If the dialog was closed, do not mark as spent.
  if (!choice) return;

  resolutionState.advantageSpent.defender = true;
  resolutionState.advantageResolution.defender = { 
    overextend: Boolean(choice.overextend), 
    overwhelm: Boolean(choice.overwhelm),
    specialActionsSelected: Array.isArray(choice.specialActionsSelected) ? choice.specialActionsSelected.slice() : []
  };

  resolutionState.defenderAdvantage = {
    resolved: true,
    choice: { 
      overextend: Boolean(choice.overextend), 
      overwhelm: Boolean(choice.overwhelm),
      specialActionsSelected: Array.isArray(choice.specialActionsSelected) ? choice.specialActionsSelected.slice() : []
    },
    resolvedAt: Date.now(),
    resolvedBy: game.user.id,
  };

  await _updateCard(message, data);

  // Apply mechanical effects now (only when Resolve Advantage is clicked).
  if (choice.overextend) {
    await _applyOverextendEffect(attackerResolved, {
      defenderUuid: defender.uuid,
      defenderTokenUuid: data.defender?.tokenUuid ?? null,
      opponentTokenUuid: data.attacker?.tokenUuid ?? null,
      doubleEffect: Boolean(choice.overextendDouble)
    });
  }
  if (choice.overwhelm) {
    await _applyOverwhelmEffect(attackerResolved, { defenderUuid: defender.uuid });
  }

  // Execute Special Advantage automation for defender (free + auto-win)
  if (Array.isArray(choice.specialActionsSelected) && choice.specialActionsSelected.length > 0) {
    try {
      const { showSpecialAdvantageDialog, executeSpecialAction } = await import("../../special-actions-helper.js");
      
      for (const saId of choice.specialActionsSelected) {
        const advChoice = await showSpecialAdvantageDialog(saId);
        if (!advChoice) continue;

        if (advChoice.mode === "autowin") {
          // Auto-Win: consume 1 AP, skip test, auto-succeed
          const { ActionEconomy } = await import("../../action-economy.js");
          const def = getSpecialActionById(saId);
          await ActionEconomy.spendAP(defender, 1, { 
            reason: `Special Advantage: ${def?.name} (Auto-Win)`, 
            silent: false 
          });

          const result = await executeSpecialAction({
            specialActionId: saId,
            actor: defender,
            target: attackerResolved ?? null,
            isAutoWin: true,
            opposedResult: { winner: "defender" }
          });

          if (result.success) {
            await ChatMessage.create({
              user: game.user.id,
              speaker: ChatMessage.getSpeaker({ actor: defender }),
              content: `<div class="uesrpg-special-action-advantage"><b>Special Advantage (Auto-Win):</b><p>${result.message}</p></div>`,
              style: CONST.CHAT_MESSAGE_STYLES.OTHER
            });
          }
        } else if (advChoice.mode === "free") {
          // Free Action: 0 AP, initiate test with dropdown selection
          const attackerTokenUuid = data.attacker?.tokenUuid ?? null;
          const defenderTokenUuid = data.defender?.tokenUuid ?? null;
          const attackerToken = attackerTokenUuid ? fromUuidSync(attackerTokenUuid)?.object : null;
          const defenderToken = defenderTokenUuid ? fromUuidSync(defenderTokenUuid)?.object : null;

          // Defender initiates, so swap attacker/defender roles
          if (attackerToken && defenderToken) {
            const { SkillOpposedWorkflow } = await import("../../../skills/opposed-workflow.js");
            const def = getSpecialActionById(saId);
            
            const saMessage = await SkillOpposedWorkflow.createPending({
              attackerTokenUuid: defenderToken?.document?.uuid ?? defenderToken?.uuid,
              defenderTokenUuid: attackerToken?.document?.uuid ?? attackerToken?.uuid,
              attackerSkillUuid: null,  // Let user choose from dropdown in card
              attackerSkillLabel: `${def?.name} (Special Action)`
            });

            const state = saMessage?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state;
            if (state) {
              state.specialActionId = saId;
              state.allowCombatStyle = true;
              state.isFreeAction = true;

              await saMessage.update({
                flags: {
                  "uesrpg-3ev4": {
                    skillOpposed: {
                      version: state.version ?? 1,
                      state
                    }
                  }
                }
              });
            }

            ui.notifications.info(`Special Advantage: ${def?.name} used as free action.`);
          }
        }
      }
    } catch (err) {
      console.error("UESRPG | Failed to execute Special Advantage automation", err);
    }
  }

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: defender, token: dToken?.document ?? null }),
    content: `<div class="ues-opposed-card" style="padding:6px;">
      <b>Defender Advantage Resolved.</b>
    </div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    rollMode: game.settings.get("core", "rollMode"),
    flags: _opposedFlags(message.id, "defender-advantage"),
  });
}

/**
 * Handle block resolution (defender won via block)
 * @param {Object} ctx - Context object with all required data
 */
export async function handleBlockResolve(ctx) {
  const { message, data, attacker, defender, defenderData, defenderIndex, defenders, isMulti, aToken, dToken, bankMode, isAoE, opts, _updateCard } = ctx;

  const resolvedOk = await _ensureResolvedForPostActions(message, data, { defenderIndex });
  if (!resolvedOk) {
    ui.notifications.warn("Block resolution is only available when the opposed test is resolved.");
    return;
  }

  const outcome = _getDefenderOutcome(data, data.defender);
  if (!outcome || outcome.winner !== "defender" || (data.defender.defenseType ?? "none") !== "block") {
    ui.notifications.warn("Block resolution is only available when the defender wins by blocking.");
    return;
  }
  if (!_canControlActor(defender) && !game.user.isGM) {
    ui.notifications.warn("You do not have permission to resolve this block.");
    return;
  }

  // Idempotency guard
  const existingBlockDamage = _getDefenderDamage(data, data.defender);
  if (existingBlockDamage?.rolled === true) {
    ui.notifications.warn("Block has already been resolved for this target.");
    return;
  }

  const isAoECheck = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
  // Shared damage is only appropriate for AoE workflows. Multi-defender (e.g., Mighty Cleave)
  // rolls damage per target by RAW.
  const shareDamage = isAoECheck;
  let sharedDamage = shareDamage ? (data.context?.sharedDamage ?? null) : null;
  const sharedSelection = shareDamage ? (data.context?.sharedDamageSelection ?? null) : null;

  const shields = _listEquippedShields(defender);
  const shield = shields[0] ?? null;
  if (!shield) {
    ui.notifications.warn("No equipped shield found on the defender.");
    return;
  }

  // Roll the incoming attack damage (attacker weapon selection).
  const attackMode = String(data.context?.attackMode ?? "melee").toLowerCase();
  const ctxWeaponUuid = String(data.context?.weaponUuid ?? "").trim();
  let ctxWeaponMode = "";
  if (ctxWeaponUuid) {
    try {
      const w = await fromUuid(ctxWeaponUuid);
      ctxWeaponMode = String(w?.system?.attackMode ?? "").toLowerCase();
    } catch (_e) {
      ctxWeaponMode = "";
    }
  }
  const isRanged = String(attackMode ?? "").toLowerCase() === "ranged" || String(ctxWeaponMode ?? "").toLowerCase() === "ranged";
  const rangedWeapon = isRanged ? (selectEquippedRangedWeapon(attacker) ?? null) : null;
  const rangedWeaponUuid = isRanged
    ? (String(data.context?.weaponUuid ?? "").trim()
      || String(data.context?.lastWeaponUuid ?? "").trim()
      || String(rangedWeapon?.uuid ?? "")
      || String(_getPreferredWeaponUuid(attacker, { meleeOnly: false }) ?? "").trim())
    : "";

  if (isRanged && !rangedWeaponUuid) {
    ui.notifications.warn("No equipped ranged weapon could be resolved for this attack.");
    return;
  }

  const selection = sharedSelection
    ?? (sharedDamage?.weaponUuid ? { weaponUuid: sharedDamage.weaponUuid } : null)
    ?? (isRanged ? { weaponUuid: rangedWeaponUuid } : null)
    ?? await _promptWeaponAndAdvantages({
      attackerActor: attacker,
      attackMode,
      advantageCount: 0,
      attackerTokenUuid: data.attacker?.tokenUuid ?? null,
      opponentTokenUuid: data.defender?.tokenUuid ?? null,
      defaultWeaponUuid: data.context?.lastWeaponUuid ?? _getPreferredWeaponUuid(attacker, { meleeOnly: false }) ?? null,
    });
  if (!selection) return;

  if (shareDamage && !sharedSelection) {
    data.context = data.context ?? {};
    data.context.sharedDamageSelection = foundry.utils.deepClone(selection);
    await _updateCard(message, data);
  }

  const weapon = await fromUuid(selection.weaponUuid);
  if (!weapon) {
    ui.notifications.warn("Selected weapon could not be resolved.");
    return;
  }

  const reuseShared = Boolean(sharedDamage && sharedDamage.mode === "weapon" && (!sharedDamage.weaponUuid || sharedDamage.weaponUuid === weapon?.uuid));
  const dmg = reuseShared
    ? _inflateSharedDamage(sharedDamage)
    : await _rollWeaponDamage({ weapon, preConsumedAmmo: data.attacker?.preConsumedAmmo ?? null, context: data.context ?? null });
  if (!dmg) return;
  if (shareDamage && (!sharedDamage || sharedDamage.mode !== "weapon")) {
    sharedDamage = _buildSharedDamagePayload({ mode: "weapon", dmg, weaponUuid: weapon?.uuid ?? null, damageType: getDamageTypeFromWeapon(weapon) });
    data.context = data.context ?? {};
    data.context.sharedDamage = sharedDamage;
    await _updateCard(message, data);
  }
  const damageType = getDamageTypeFromWeapon(weapon);
  await _emitInlineDamageRollMessage({
    actor: attacker,
    token: aToken,
    dmg,
    label: `${weapon?.name ?? "Weapon"} - Incoming Damage Roll`,
    parentMessageId: message.id,
    stage: "block-damage-roll-inline",
  });
  const hitLocation = resolveHitLocationForTarget(defender, getHitLocationFromRoll(data.attacker?.result?.rollTotal ?? 100));
  if (isAoECheck) {
    const forcedLoc = data?.context?.forcedHitLocation ?? "Body";
    const hitLocationAoE = resolveHitLocationForTarget(defender, forcedLoc);
    const reducedDamage = Math.ceil(Number(dmg.finalDamage) / 2);
    const attackHidden = data.context?.attackFromHidden === true;
    const ammoUuid = data.attacker?.preConsumedAmmo?.ammoUuid ?? "";

    const damageObj = {
      rolled: true,
      mode: "block",
      finalDamage: dmg.finalDamage,
      damageString: dmg.damageString ?? "",
      rollATotal: dmg.rollATotal ?? null,
      rollBTotal: dmg.rollBTotal ?? null,
      hitLocation: hitLocationAoE,
      weaponName: weapon.name,
      weaponImg: weapon.img,
      weaponUuid: weapon.uuid ?? "",
      damageType,
      qualityPillsHtml: "",
      extraNoteHtml: `<b>Defense:</b> Block (${shield?.name ?? "Shield"})`,
      blockResult: {
        blocked: false,
        isAoE: true,
        reducedDamage,
        shieldName: shield?.name ?? "Shield",
      },
      applyPayload: _buildApplyPayload({
        targetUuid: defender.uuid,
        targetName: dToken?.name ?? defender.name,
        attackerActorUuid: attacker.uuid,
        weaponUuid: weapon.uuid ?? "",
        ammoUuid,
        damage: reducedDamage,
        damageType,
        hitLocation: hitLocationAoE,
        attackMode,
        attackHidden,
        source: weapon.name,
        buttonLabel: `Apply Block Damage → ${dToken?.name ?? defender.name}`,
      }),
      applied: false,
    };
    _setDefenderDamage(data, data.defender, damageObj);
    await _updateCard(message, data);
    return;
  }

  let br = getBlockValue(shield, damageType);
  
  // Check for Power Block stamina effect (only for physical damage)
  const powerBlockEffect = getActiveStaminaEffect(defender, STAMINA_EFFECT_KEYS.POWER_BLOCK);
  const isPowerBlockActive = powerBlockEffect && String(damageType).toLowerCase() === DAMAGE_TYPES.PHYSICAL;
  if (isPowerBlockActive) {
    const originalBR = br;
    br = br * 2;
    await consumeStaminaEffect(defender, STAMINA_EFFECT_KEYS.POWER_BLOCK, {
      message: `Shield BR doubled: ${originalBR} → ${br} (physical damage only)`
    });
  }
  
  const shieldSplitter = _weaponHasQuality(weapon, "shieldSplitter");
  if (shieldSplitter) br = Math.max(0, Math.ceil(_asNumber(br) / 2));
  const blocked = dmg.finalDamage <= br;

  if (blocked) {
    const damageObj = {
      rolled: true,
      mode: "block",
      finalDamage: dmg.finalDamage,
      damageString: dmg.damageString ?? "",
      rollATotal: dmg.rollATotal ?? null,
      rollBTotal: dmg.rollBTotal ?? null,
      hitLocation,
      weaponName: weapon.name,
      weaponImg: weapon.img,
      weaponUuid: weapon.uuid ?? "",
      damageType,
      qualityPillsHtml: "",
      extraNoteHtml: `<b>Defense:</b> Block (${shield?.name ?? "Shield"})`,
      blockResult: {
        blocked: true,
        blockRating: br,
        shieldSplitter: Boolean(shieldSplitter),
        shieldName: shield?.name ?? "Shield",
      },
      applied: false,
    };
    _setDefenderDamage(data, data.defender, damageObj);
    await _updateCard(message, data);
    return;
  }

  // RAW: if damage exceeds BR, take full damage to shield arm.
  const shieldArm = "Left Arm";

  const resolvedShieldArm = resolveHitLocationForTarget(defender, shieldArm);

  const damageObj = {
    rolled: true,
    mode: "block",
    finalDamage: dmg.finalDamage,
    damageString: dmg.damageString ?? "",
    rollATotal: dmg.rollATotal ?? null,
    rollBTotal: dmg.rollBTotal ?? null,
    hitLocation: resolvedShieldArm,
    weaponName: weapon.name,
    weaponImg: weapon.img,
    weaponUuid: weapon.uuid ?? "",
    damageType,
    qualityPillsHtml: "",
    extraNoteHtml: `<b>Defense:</b> Block (${shield?.name ?? "Shield"})`,
    blockResult: {
      blocked: false,
      penetrated: true,
      blockRating: br,
      shieldSplitter: Boolean(shieldSplitter),
      shieldName: shield?.name ?? "No Shield",
    },
    applyPayload: _buildApplyPayload({
      targetUuid: defender.uuid,
      targetName: dToken?.name ?? defender.name,
      attackerActorUuid: attacker.uuid,
      weaponUuid: weapon.uuid ?? "",
      ammoUuid: data.attacker?.preConsumedAmmo?.ammoUuid ?? "",
      damage: dmg.finalDamage,
      damageType,
      hitLocation: resolvedShieldArm,
      attackMode,
      attackHidden: data.context?.attackFromHidden === true,
      source: weapon.name,
      buttonLabel: `Apply Block Damage → ${dToken?.name ?? defender.name}`,
    }),
    applied: false,
  };
  _setDefenderDamage(data, data.defender, damageObj);
  await _updateCard(message, data);
}

/**
 * Handle ward resolution for the defender.
 * Ward acts like a shield block but uses the Ward spell's Spell Strength as BR
 * (both Physical and Magical). Power Block is incompatible with Ward.
 *
 * @param {Object} ctx - Context object with all required data
 */
export async function handleWardResolve(ctx) {
  const { message, data, attacker, defender, defenderData, defenderIndex, defenders, isMulti, aToken, dToken, bankMode, isAoE, opts, _updateCard } = ctx;

  const resolvedOk = await _ensureResolvedForPostActions(message, data, { defenderIndex });
  if (!resolvedOk) {
    ui.notifications.warn("Ward resolution is only available when the opposed test is resolved.");
    return;
  }

  const outcome = _getDefenderOutcome(data, data.defender);
  if (!outcome || outcome.winner !== "defender" || (data.defender.defenseType ?? "none") !== "ward") {
    ui.notifications.warn("Ward resolution is only available when the defender wins by warding.");
    return;
  }
  if (!_canControlActor(defender) && !game.user.isGM) {
    ui.notifications.warn("You do not have permission to resolve this ward.");
    return;
  }

  // Idempotency guard
  const existingWardDamage = _getDefenderDamage(data, data.defender);
  if (existingWardDamage?.rolled === true) {
    ui.notifications.warn("Ward has already been resolved for this target.");
    return;
  }

  // Get active Ward spell and its BR (= Spell Strength)
  const wardSpell = getActiveWardSpell(defender);
  if (!wardSpell) {
    ui.notifications.warn("No active Ward spell found on the defender.");
    return;
  }
  const wardBR = getWardBlockRating(defender);
  const wardName = wardSpell.name ?? "Ward";

  const isAoECheck = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
  const shareDamage = isAoECheck;
  let sharedDamage = shareDamage ? (data.context?.sharedDamage ?? null) : null;
  const sharedSelection = shareDamage ? (data.context?.sharedDamageSelection ?? null) : null;

  // Roll the incoming attack damage (attacker weapon selection).
  const attackMode = String(data.context?.attackMode ?? "melee").toLowerCase();
  const ctxWeaponUuid = String(data.context?.weaponUuid ?? "").trim();
  let ctxWeaponMode = "";
  if (ctxWeaponUuid) {
    try {
      const w = await fromUuid(ctxWeaponUuid);
      ctxWeaponMode = String(w?.system?.attackMode ?? "").toLowerCase();
    } catch (_e) {
      ctxWeaponMode = "";
    }
  }
  const isRanged = String(attackMode ?? "").toLowerCase() === "ranged" || String(ctxWeaponMode ?? "").toLowerCase() === "ranged";
  const rangedWeapon = isRanged ? (selectEquippedRangedWeapon(attacker) ?? null) : null;
  const rangedWeaponUuid = isRanged
    ? (String(data.context?.weaponUuid ?? "").trim()
      || String(data.context?.lastWeaponUuid ?? "").trim()
      || String(rangedWeapon?.uuid ?? "")
      || String(_getPreferredWeaponUuid(attacker, { meleeOnly: false }) ?? "").trim())
    : "";

  if (isRanged && !rangedWeaponUuid) {
    ui.notifications.warn("No equipped ranged weapon could be resolved for this attack.");
    return;
  }

  const selection = sharedSelection
    ?? (sharedDamage?.weaponUuid ? { weaponUuid: sharedDamage.weaponUuid } : null)
    ?? (isRanged ? { weaponUuid: rangedWeaponUuid } : null)
    ?? await _promptWeaponAndAdvantages({
      attackerActor: attacker,
      attackMode,
      advantageCount: 0,
      attackerTokenUuid: data.attacker?.tokenUuid ?? null,
      opponentTokenUuid: data.defender?.tokenUuid ?? null,
      defaultWeaponUuid: data.context?.lastWeaponUuid ?? _getPreferredWeaponUuid(attacker, { meleeOnly: false }) ?? null,
    });
  if (!selection) return;

  if (shareDamage && !sharedSelection) {
    data.context = data.context ?? {};
    data.context.sharedDamageSelection = foundry.utils.deepClone(selection);
    await _updateCard(message, data);
  }

  const weapon = await fromUuid(selection.weaponUuid);
  if (!weapon) {
    ui.notifications.warn("Selected weapon could not be resolved.");
    return;
  }

  const reuseShared = Boolean(sharedDamage && sharedDamage.mode === "weapon" && (!sharedDamage.weaponUuid || sharedDamage.weaponUuid === weapon?.uuid));
  const dmg = reuseShared
    ? _inflateSharedDamage(sharedDamage)
    : await _rollWeaponDamage({ weapon, preConsumedAmmo: data.attacker?.preConsumedAmmo ?? null, context: data.context ?? null });
  if (!dmg) return;
  if (shareDamage && (!sharedDamage || sharedDamage.mode !== "weapon")) {
    sharedDamage = _buildSharedDamagePayload({ mode: "weapon", dmg, weaponUuid: weapon?.uuid ?? null, damageType: getDamageTypeFromWeapon(weapon) });
    data.context = data.context ?? {};
    data.context.sharedDamage = sharedDamage;
    await _updateCard(message, data);
  }
  const damageType = getDamageTypeFromWeapon(weapon);
  await _emitInlineDamageRollMessage({
    actor: attacker,
    token: aToken,
    dmg,
    label: `${weapon?.name ?? "Weapon"} - Incoming Damage Roll`,
    parentMessageId: message.id,
    stage: "ward-damage-roll-inline",
  });
  const hitLocation = resolveHitLocationForTarget(defender, getHitLocationFromRoll(data.attacker?.result?.rollTotal ?? 100));

  // Ward BR: Spell Strength applies equally to all damage types (no halving for magic).
  // Power Block is incompatible with Ward — do NOT check for Power Block.
  let br = wardBR;

  // Shield Splitter does NOT apply to Ward (it targets physical shields, not magical wards).

  if (isAoECheck) {
    const forcedLoc = data?.context?.forcedHitLocation ?? "Body";
    const hitLocationAoE = resolveHitLocationForTarget(defender, forcedLoc);
    const reducedDamage = Math.ceil(Number(dmg.finalDamage) / 2);
    const attackHidden = data.context?.attackFromHidden === true;
    const ammoUuid = data.attacker?.preConsumedAmmo?.ammoUuid ?? "";

    const damageObj = {
      rolled: true,
      mode: "ward",
      finalDamage: dmg.finalDamage,
      damageString: dmg.damageString ?? "",
      rollATotal: dmg.rollATotal ?? null,
      rollBTotal: dmg.rollBTotal ?? null,
      hitLocation: hitLocationAoE,
      weaponName: weapon.name,
      weaponImg: weapon.img,
      weaponUuid: weapon.uuid ?? "",
      damageType,
      qualityPillsHtml: "",
      extraNoteHtml: `<b>Defense:</b> Ward (${wardName}, BR ${wardBR})`,
      wardResult: {
        blocked: false,
        isAoE: true,
        reducedDamage,
        wardBR,
        wardName,
      },
      applyPayload: _buildApplyPayload({
        targetUuid: defender.uuid,
        targetName: dToken?.name ?? defender.name,
        attackerActorUuid: attacker.uuid,
        weaponUuid: weapon.uuid ?? "",
        ammoUuid,
        damage: reducedDamage,
        damageType,
        hitLocation: hitLocationAoE,
        attackMode,
        attackHidden,
        source: weapon.name,
        buttonLabel: `Apply Ward Damage → ${dToken?.name ?? defender.name}`,
      }),
      applied: false,
    };
    _setDefenderDamage(data, data.defender, damageObj);
    await _updateCard(message, data);
    return;
  }

  const blocked = dmg.finalDamage <= br;

  if (blocked) {
    const damageObj = {
      rolled: true,
      mode: "ward",
      finalDamage: dmg.finalDamage,
      damageString: dmg.damageString ?? "",
      rollATotal: dmg.rollATotal ?? null,
      rollBTotal: dmg.rollBTotal ?? null,
      hitLocation,
      weaponName: weapon.name,
      weaponImg: weapon.img,
      weaponUuid: weapon.uuid ?? "",
      damageType,
      qualityPillsHtml: "",
      extraNoteHtml: `<b>Defense:</b> Ward (${wardName}, BR ${wardBR})`,
      wardResult: {
        blocked: true,
        wardBR,
        wardName,
      },
      applied: false,
    };
    _setDefenderDamage(data, data.defender, damageObj);
    await _updateCard(message, data);
    return;
  }

  // RAW: if damage exceeds Ward BR, take full damage to Left Arm (as with shield).
  const wardArm = "Left Arm";
  const resolvedWardArm = resolveHitLocationForTarget(defender, wardArm);

  const damageObj = {
    rolled: true,
    mode: "ward",
    finalDamage: dmg.finalDamage,
    damageString: dmg.damageString ?? "",
    rollATotal: dmg.rollATotal ?? null,
    rollBTotal: dmg.rollBTotal ?? null,
    hitLocation: resolvedWardArm,
    weaponName: weapon.name,
    weaponImg: weapon.img,
    weaponUuid: weapon.uuid ?? "",
    damageType,
    qualityPillsHtml: "",
    extraNoteHtml: `<b>Defense:</b> Ward (${wardName}, BR ${wardBR})`,
    wardResult: {
      blocked: false,
      penetrated: true,
      wardBR,
      wardName,
    },
    applyPayload: _buildApplyPayload({
      targetUuid: defender.uuid,
      targetName: dToken?.name ?? defender.name,
      attackerActorUuid: attacker.uuid,
      weaponUuid: weapon.uuid ?? "",
      ammoUuid: data.attacker?.preConsumedAmmo?.ammoUuid ?? "",
      damage: dmg.finalDamage,
      damageType,
      hitLocation: resolvedWardArm,
      attackMode,
      attackHidden: data.context?.attackFromHidden === true,
      source: weapon.name,
      buttonLabel: `Apply Ward Damage → ${dToken?.name ?? defender.name}`,
    }),
    applied: false,
  };
  _setDefenderDamage(data, data.defender, damageObj);
  await _updateCard(message, data);
}
