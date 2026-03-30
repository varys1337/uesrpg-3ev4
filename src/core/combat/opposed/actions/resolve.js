/**
 * src/core/combat/opposed/actions/resolve.js
 * Defender advantage and block resolution handlers
 */

import { _resolveDoc, _resolveActorViaToken, _resolveItemViaActor } from "../helpers/docs.js";
import { _canControlActor } from "../helpers/util.js";
import { _getDefenderOutcome, _getDefenderAdvantage, _getDefenderResolutionState, _getDefenderDamage, _setDefenderDamage } from "../schema.js";
import { applyOverextendEffect as _applyOverextendEffect, applyOverwhelmEffect as _applyOverwhelmEffect } from "../effects.js";
import { promptDefenderAdvantage as _promptDefenderAdvantage } from "../dialogs/defender.js";
import { getSpecialActionById } from "../../combat-style-utils.js";
import { listEquippedShields as _listEquippedShields } from "../helpers/utility.js";
import { weaponHasQuality as _weaponHasQuality, asNumber as _asNumber, getPreferredWeaponUuid as _getPreferredWeaponUuid } from "../helpers/workflow.js";
import { getAttackModeFromWeapon, getDamageTypeFromWeapon } from "../../combat-utils.js";
import { getBlockValue } from "../../mitigation.js";
import { DAMAGE_TYPES } from "../../damage-automation.js";
import { rollWeaponDamage as _rollWeaponDamage } from "../damage/roller.js";
import { _ensureResolvedForPostActions } from "../../opposed-workflow.js";
import { promptWeaponAndAdvantages as _promptWeaponAndAdvantages } from "../dialogs/attacker.js";
import { getHitLocationFromRoll, resolveHitLocationForTarget } from "../../combat-utils.js";
import { getActiveStaminaEffect, consumeStaminaEffect, STAMINA_EFFECT_KEYS } from "../../../stamina/stamina-effects.js";
import { UESRPG } from "../../../constants.js";
import { selectEquippedRangedWeapon } from "../helpers/select-equipped-ranged-weapon.js";
import { inflateSharedDamage as _inflateSharedDamage, buildSharedDamagePayload as _buildSharedDamagePayload } from "./damage.js";
import { _buildApplyPayload, _emitInlineDamageRollMessage } from "./damage.js";
import { getWardBlockRating, getActiveWardSpell } from "../../ward-defense.js";
import { safeUpdateChatMessage } from "../../../../utils/chat-message-socket.js";
import { ActionEconomy } from "../../action-economy.js";

function _pushAdvantageMarker(data, { actor = null, actorUuid = null, tokenUuid = null, kind = "advantage" } = {}) {
  data.context = data.context ?? {};
  const resolvedActorUuid = String(actorUuid ?? actor?.uuid ?? "").trim();
  const resolvedTokenUuid = String(tokenUuid ?? "").trim();
  const actorName = String(actor?.name ?? "Actor").trim() || "Actor";
  const markerKey = [kind, resolvedActorUuid || actorName, resolvedTokenUuid].filter(Boolean).join(":");
  const current = Array.isArray(data.context.advantageMarkers) ? data.context.advantageMarkers.slice() : [];
  if (current.some((marker) => String(marker?.key ?? "").trim() === markerKey)) return;
  current.push({
    key: markerKey,
    kind,
    actorUuid: resolvedActorUuid || null,
    tokenUuid: resolvedTokenUuid || null,
    label: "Advantage Resolved"
  });
  data.context.advantageMarkers = current.slice(-8);
}

function _resolveAttackerDeclaredWeapon(attacker, data) {
  const candidates = [
    String(data?.context?.weaponUuid ?? "").trim(),
    String(data?.context?.lastWeaponUuid ?? "").trim(),
    String(data?.attacker?.preConsumedAmmo?.weaponUuid ?? "").trim(),
  ].filter(Boolean);

  for (const uuid of candidates) {
    try {
      const weapon = _resolveItemViaActor(uuid, attacker);
      if (weapon?.type === "weapon") return weapon;
    } catch (_e) {
      // Continue through fallbacks.
    }
  }

  return null;
}

function _resolveIncomingAttackWeapon(attacker, data, { isRanged = false } = {}) {
  const declared = _resolveAttackerDeclaredWeapon(attacker, data);
  if (declared) return declared;

  if (isRanged) {
    const ranged = selectEquippedRangedWeapon(attacker) ?? null;
    if (ranged?.type === "weapon") return ranged;
  }

  const preferredUuid = String(_getPreferredWeaponUuid(attacker, { meleeOnly: false }) ?? "").trim();
  if (!preferredUuid) return null;
  try {
    const preferred = _resolveItemViaActor(preferredUuid, attacker);
    return preferred?.type === "weapon" ? preferred : null;
  } catch (_e) {
    return null;
  }
}

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
  const advantageSource = String(advantage?.source ?? "");
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

  const attackerResolved = _resolveActorViaToken(data?.attacker?.actorUuid, data?.attacker?.tokenUuid);
  if (!attackerResolved) {
    ui.notifications.warn("Attacker could not be resolved.");
    return;
  }

  const choice = await _promptDefenderAdvantage({
    defenderActor: defender,
    attackerActor: attackerResolved,
    advantageCount: advCount,
    defenderTokenUuid: data.defender?.tokenUuid ?? null,
    opponentTokenUuid: data.attacker?.tokenUuid ?? null,
    styleUuidForKnown: data.defender?.styleUuid ?? null
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
            _pushAdvantageMarker(data, {
              actor: defender,
              actorUuid: data.defender?.actorUuid ?? null,
              tokenUuid: data.defender?.tokenUuid ?? null,
              kind: "defender-special-advantage"
            });
          }
        } else if (advChoice.mode === "free") {
          if (advantageSource === "buckler-parry-win") {
            const def = getSpecialActionById(saId);
            const paid = await ActionEconomy.spendAP(defender, 1, {
              reason: `Buckler Parry-Win: Special Advantage (${def?.name ?? saId})`,
              silent: true
            });
            if (!paid) {
              ui.notifications.warn(`${defender.name} does not have enough Action Points to use Special Action Advantage from a buckler parry-win.`);
              continue;
            }
          }

          // Free Action: 0 AP, initiate test with dropdown selection
          const attackerTokenUuid = data.attacker?.tokenUuid ?? null;
          const defenderTokenUuid = data.defender?.tokenUuid ?? null;
          const attackerToken = attackerTokenUuid ? _resolveDoc(attackerTokenUuid)?.object : null;
          const defenderToken = defenderTokenUuid ? _resolveDoc(defenderTokenUuid)?.object : null;

          // Defender initiates, so swap attacker/defender roles
          if (attackerToken && defenderToken) {
            const { SkillOpposedWorkflow } = await import("../../../skills/opposed-workflow/index.js");
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
              state.specialActionContext = {
                id: saId,
                source: "advantage-defender-free",
                attackerStyleUuid: data.defender?.styleUuid ?? null,
                defenderStyleUuid: data.attacker?.itemUuid ?? null,
                sourceWeaponUuid: String(_getPreferredWeaponUuid(defender, { meleeOnly: false }) ?? "").trim() || null
              };

              await safeUpdateChatMessage(saMessage, {
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
  _pushAdvantageMarker(data, {
    actor: defender,
    actorUuid: data.defender?.actorUuid ?? null,
    tokenUuid: data.defender?.tokenUuid ?? null,
    kind: "defender-advantage"
  });
  await _updateCard(message, data);
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

  if (!game.user.isGM) {
    ui.notifications.warn("Block resolution requires GM permissions.");
    return;
  }

  const outcome = _getDefenderOutcome(data, data.defender);
  const defType = String(data.defender?.defenseType ?? "none").toLowerCase();
  const blockSource = String(data.defender?.blockSource ?? "").toLowerCase();
  const isWardBlock = (defType === "ward") || (defType === "block" && blockSource === "ward");

  if (!outcome || outcome.winner !== "defender" || (defType !== "block" && defType !== "ward")) {
    ui.notifications.warn("Block resolution is only available when the defender wins by blocking.");
    return;
  }
  if (isWardBlock) {
    return await handleWardResolve(ctx);
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
  const hasExplicitContextMode = Boolean(
    String(data?.context?.attackMode ?? "").trim() || String(data?.context?.attackType ?? "").trim()
  );
  const ctxWeaponUuid = String(data.context?.weaponUuid ?? "").trim();
  let ctxWeaponMode = "";
  if (ctxWeaponUuid) {
    try {
      const w = _resolveItemViaActor(ctxWeaponUuid, attacker);
      ctxWeaponMode = String(getAttackModeFromWeapon(w) ?? "").toLowerCase();
    } catch (_e) {
      ctxWeaponMode = "";
    }
  }
  const isRanged = hasExplicitContextMode
    ? String(attackMode ?? "").toLowerCase() === "ranged"
    : String(ctxWeaponMode ?? "").toLowerCase() === "ranged";
  const rangedWeapon = isRanged ? _resolveIncomingAttackWeapon(attacker, data, { isRanged: true }) : null;
  const rangedWeaponUuid = isRanged ? String(rangedWeapon?.uuid ?? "").trim() : "";

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
      defaultWeaponUuid: _resolveIncomingAttackWeapon(attacker, data, { isRanged })?.uuid
        ?? data.context?.lastWeaponUuid
        ?? _getPreferredWeaponUuid(attacker, { meleeOnly: false })
        ?? null,
      styleUuidForKnown: data.attacker?.itemUuid ?? null,
    });
  if (!selection) return;

  // Guard: DialogV2.wait() may resolve with the action string instead of the
  // callback's return value in some edge cases. Detect and recover.
  if (typeof selection !== "object" || selection === null) {
    console.warn("UESRPG | block-resolve: selection is not an object (got", typeof selection, JSON.stringify(selection), ") — treating as canceled.");
    return;
  }

  if (shareDamage && !sharedSelection) {
    data.context = data.context ?? {};
    data.context.sharedDamageSelection = foundry.utils.deepClone(selection);
    await _updateCard(message, data);
  }

  // Resolve weapon: prefer dialog selection, fall back to context/preferred weapon.
  let blockWeaponUuid = selection.weaponUuid || "";
  if (!blockWeaponUuid) {
    blockWeaponUuid = String(_resolveIncomingAttackWeapon(attacker, data, { isRanged })?.uuid ?? "").trim();
    if (blockWeaponUuid) {
      console.debug("UESRPG | block-resolve: selection.weaponUuid was empty, using fallback:", blockWeaponUuid);
    }
  }
  const weapon = blockWeaponUuid ? _resolveItemViaActor(blockWeaponUuid, attacker) : null;
  if (!weapon) {
    console.warn("UESRPG | Block-resolve weapon UUID failed to resolve:", blockWeaponUuid || "(none)", "| selection:", JSON.stringify(selection?.weaponUuid), "| attacker:", attacker?.name);
    ui.notifications.warn("Selected weapon could not be resolved. The weapon may have been deleted or unequipped.");
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
      damageComponents: [dmg.weaponComponent, dmg.ammoComponent]
        .filter((c) => c && Number(c.amount ?? 0) > 0)
        .map((c) => ({
          source: c.source ?? null,
          sourceLabel: c.sourceLabel ?? null,
          sourceItemUuid: c.sourceItemUuid ?? null,
          damageType: c.damageType ?? damageType,
          amount: Number(c.amount ?? 0) || 0,
          hitLocation: hitLocationAoE,
        })),
      applyPayload: _buildApplyPayload({
        targetUuid: defender.uuid,
        targetName: dToken?.name ?? defender.name,
        attackerActorUuid: attacker.uuid,
        weaponUuid: weapon.uuid ?? "",
        ammoUuid,
        damage: reducedDamage,
        damageType,
        hitLocation: hitLocationAoE,
        damagedValue: dmg.damagedValue ?? 0,
        attackMode,
        attackHidden,
        source: weapon.name,
        damageComponents: [dmg.weaponComponent, dmg.ammoComponent]
          .filter((c) => c && Number(c.amount ?? 0) > 0)
          .map((c) => ({
            source: c.source ?? null,
            sourceLabel: c.sourceLabel ?? null,
            sourceItemUuid: c.sourceItemUuid ?? null,
            damageType: c.damageType ?? damageType,
            amount: Number(c.amount ?? 0) || 0,
            hitLocation: hitLocationAoE,
          })),
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
    damageComponents: [dmg.weaponComponent, dmg.ammoComponent]
      .filter((c) => c && Number(c.amount ?? 0) > 0)
      .map((c) => ({
        source: c.source ?? null,
        sourceLabel: c.sourceLabel ?? null,
        sourceItemUuid: c.sourceItemUuid ?? null,
        damageType: c.damageType ?? damageType,
        amount: Number(c.amount ?? 0) || 0,
        hitLocation: resolvedShieldArm,
      })),
    applyPayload: _buildApplyPayload({
      targetUuid: defender.uuid,
      targetName: dToken?.name ?? defender.name,
      attackerActorUuid: attacker.uuid,
      weaponUuid: weapon.uuid ?? "",
      ammoUuid: data.attacker?.preConsumedAmmo?.ammoUuid ?? "",
      damage: dmg.finalDamage,
      damageType,
      hitLocation: resolvedShieldArm,
      damagedValue: dmg.damagedValue ?? 0,
      attackMode,
      attackHidden: data.context?.attackFromHidden === true,
      source: weapon.name,
      damageComponents: [dmg.weaponComponent, dmg.ammoComponent]
        .filter((c) => c && Number(c.amount ?? 0) > 0)
        .map((c) => ({
          source: c.source ?? null,
          sourceLabel: c.sourceLabel ?? null,
          sourceItemUuid: c.sourceItemUuid ?? null,
          damageType: c.damageType ?? damageType,
          amount: Number(c.amount ?? 0) || 0,
          hitLocation: resolvedShieldArm,
        })),
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
  const defType = String(data.defender?.defenseType ?? "none").toLowerCase();
  const blockSource = String(data.defender?.blockSource ?? "").toLowerCase();
  const isWardDefense = (defType === "ward") || (defType === "block" && blockSource === "ward");
  if (!outcome || outcome.winner !== "defender" || !isWardDefense) {
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
  const hasExplicitContextMode = Boolean(
    String(data?.context?.attackMode ?? "").trim() || String(data?.context?.attackType ?? "").trim()
  );
  const ctxWeaponUuid = String(data.context?.weaponUuid ?? "").trim();
  let ctxWeaponMode = "";
  if (ctxWeaponUuid) {
    try {
      const w = _resolveItemViaActor(ctxWeaponUuid, attacker);
      ctxWeaponMode = String(getAttackModeFromWeapon(w) ?? "").toLowerCase();
    } catch (_e) {
      ctxWeaponMode = "";
    }
  }
  const isRanged = hasExplicitContextMode
    ? String(attackMode ?? "").toLowerCase() === "ranged"
    : String(ctxWeaponMode ?? "").toLowerCase() === "ranged";
  const rangedWeapon = isRanged ? _resolveIncomingAttackWeapon(attacker, data, { isRanged: true }) : null;
  const rangedWeaponUuid = isRanged ? String(rangedWeapon?.uuid ?? "").trim() : "";

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
      defaultWeaponUuid: _resolveIncomingAttackWeapon(attacker, data, { isRanged })?.uuid
        ?? data.context?.lastWeaponUuid
        ?? _getPreferredWeaponUuid(attacker, { meleeOnly: false })
        ?? null,
      styleUuidForKnown: data.attacker?.itemUuid ?? null,
    });
  if (!selection) return;

  // Guard: DialogV2.wait() may resolve with the action string instead of the
  // callback's return value in some edge cases. Detect and recover.
  if (typeof selection !== "object" || selection === null) {
    console.warn("UESRPG | ward-resolve: selection is not an object (got", typeof selection, JSON.stringify(selection), ") — treating as canceled.");
    return;
  }

  if (shareDamage && !sharedSelection) {
    data.context = data.context ?? {};
    data.context.sharedDamageSelection = foundry.utils.deepClone(selection);
    await _updateCard(message, data);
  }

  // Resolve weapon: prefer dialog selection, fall back to context/preferred weapon.
  let wardWeaponUuid = selection.weaponUuid || "";
  if (!wardWeaponUuid) {
    wardWeaponUuid = String(_resolveIncomingAttackWeapon(attacker, data, { isRanged })?.uuid ?? "").trim();
    if (wardWeaponUuid) {
      console.debug("UESRPG | ward-resolve: selection.weaponUuid was empty, using fallback:", wardWeaponUuid);
    }
  }
  const weapon = wardWeaponUuid ? _resolveItemViaActor(wardWeaponUuid, attacker) : null;
  if (!weapon) {
    console.warn("UESRPG | Ward-resolve weapon UUID failed to resolve:", wardWeaponUuid || "(none)", "| selection:", JSON.stringify(selection?.weaponUuid), "| attacker:", attacker?.name);
    ui.notifications.warn("Selected weapon could not be resolved. The weapon may have been deleted or unequipped.");
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
      damageComponents: [dmg.weaponComponent, dmg.ammoComponent]
        .filter((c) => c && Number(c.amount ?? 0) > 0)
        .map((c) => ({
          source: c.source ?? null,
          sourceLabel: c.sourceLabel ?? null,
          sourceItemUuid: c.sourceItemUuid ?? null,
          damageType: c.damageType ?? damageType,
          amount: Number(c.amount ?? 0) || 0,
          hitLocation: hitLocationAoE,
        })),
      applyPayload: _buildApplyPayload({
        targetUuid: defender.uuid,
        targetName: dToken?.name ?? defender.name,
        attackerActorUuid: attacker.uuid,
        weaponUuid: weapon.uuid ?? "",
        ammoUuid,
        damage: reducedDamage,
        damageType,
        hitLocation: hitLocationAoE,
        damagedValue: dmg.damagedValue ?? 0,
        attackMode,
        attackHidden,
        source: weapon.name,
        damageComponents: [dmg.weaponComponent, dmg.ammoComponent]
          .filter((c) => c && Number(c.amount ?? 0) > 0)
          .map((c) => ({
            source: c.source ?? null,
            sourceLabel: c.sourceLabel ?? null,
            sourceItemUuid: c.sourceItemUuid ?? null,
            damageType: c.damageType ?? damageType,
            amount: Number(c.amount ?? 0) || 0,
            hitLocation: hitLocationAoE,
          })),
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
    damageComponents: [dmg.weaponComponent, dmg.ammoComponent]
      .filter((c) => c && Number(c.amount ?? 0) > 0)
      .map((c) => ({
        source: c.source ?? null,
        sourceLabel: c.sourceLabel ?? null,
        sourceItemUuid: c.sourceItemUuid ?? null,
        damageType: c.damageType ?? damageType,
        amount: Number(c.amount ?? 0) || 0,
        hitLocation: resolvedWardArm,
      })),
    applyPayload: _buildApplyPayload({
      targetUuid: defender.uuid,
      targetName: dToken?.name ?? defender.name,
      attackerActorUuid: attacker.uuid,
      weaponUuid: weapon.uuid ?? "",
      ammoUuid: data.attacker?.preConsumedAmmo?.ammoUuid ?? "",
      damage: dmg.finalDamage,
      damageType,
      hitLocation: resolvedWardArm,
      damagedValue: dmg.damagedValue ?? 0,
      attackMode,
      attackHidden: data.context?.attackFromHidden === true,
      source: weapon.name,
      damageComponents: [dmg.weaponComponent, dmg.ammoComponent]
        .filter((c) => c && Number(c.amount ?? 0) > 0)
        .map((c) => ({
          source: c.source ?? null,
          sourceLabel: c.sourceLabel ?? null,
          sourceItemUuid: c.sourceItemUuid ?? null,
          damageType: c.damageType ?? damageType,
          amount: Number(c.amount ?? 0) || 0,
          hitLocation: resolvedWardArm,
        })),
      buttonLabel: `Apply Ward Damage → ${dToken?.name ?? defender.name}`,
    }),
    applied: false,
  };
  _setDefenderDamage(data, data.defender, damageObj);
  await _updateCard(message, data);
}
