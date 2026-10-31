/**
 * Combat quick action handlers for actor sheets.
 * 
 * Shared across actor sheet modules.
 * 
 * This module contains the large combat quick action handler that was extracted
 * from actor-sheet.js for better maintainability and performance.
 */

import { buildCollapsedActionCardHtml, getAimStateFromEffect, getEnabledEffectByKey, resolveTokenForActor, resolveTokenForCombatActor, spendActionPoints, spendActionPointsResult } from "../../combat-actions-utils.js";
import { withActionResult, actionResultFromEvidence, aggregateActionResults } from "../../../../application/action-results.js";
import { createOrUpdateStatusEffect } from "../../../../core/active-effects/status-effect.js";
import { buildEffectDuration } from "../../../../core/time/effect-duration.js";
import { executeActivation, buildSpecialActionActivation } from "../../../../core/system/activation/index.js";
import { SkillOpposedWorkflow } from "../../../../core/skills/opposed-workflow/index.js";
import {
  getSpecialActionById,
  getExplicitActiveCombatStyleItem,
  isSpecialActionUsableNow,
  resolveStyleForCombatTest
} from "../../../../core/combat/combat-style-utils.js";
import { OpposedWorkflow } from "../../../../core/combat/opposed-workflow.js";
import { getActorCombatStep, isActorCombatStepCurrent, isActorInStartedCombatEncounter } from "../../../../core/combat/combat-scope.js";
import { setLastMeleeWeaponForActor } from "../../../canvas/reach-visualizer-state.js";
import { hasOpponentWithTalentInMeleeRange } from "../../../../core/traits/combat-proximity.js";
import { getWeaponCombatCapabilities, recordDashStart } from "../../../../core/combat/combat-utils.js";
import { hasTalent } from "../../../../core/traits/talents-api.js";
import { AimAudit } from "../../../../core/combat/aim-audit.js";
import { isActorBlockedFromAoOAgainstTarget } from "../../../../core/traits/mobility-talents.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { requestUpdateDocument, requestDeleteEmbeddedDocuments } from "../../../../utils/authority-proxy.js";
import { acquireLock, releaseLock } from "../../../../utils/authority-proxy/shared.js";
import { safeUpdateChatMessage } from "../../../../utils/chat-message-socket.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";
import { _num } from "../../../../utils/coerce.js";
import { executeSpecialAction, chooseSnareSpecialAction, isSnareActionCurrent } from "../../../../core/combat/special-actions-helper.js";
import { applySprintBonus, hasPendingPowerDraw } from "../../../../core/stamina/stamina-integration-hooks.js";
import {
  ensureBurningTurnActionAllowed,
  attemptExtinguishBurning,
  getConditionValue
} from "../../../../core/conditions/condition-engine.js";
import { resolveSurpriseState } from "../../../../core/combat/surprise-state.js";
import { getFearActionRestrictions } from "../../../../core/fear/index.js";
import { getMovementActionLegality } from "../../../../core/combat/movement-rules.js";
import { PHYSICAL_ITEM_TYPES } from "../../../../core/items/inventory-encumbrance.js";
import { drinkPotion, applyAlchemyToTarget, pickAlchemyCoatingTarget } from "../../../../core/alchemy/runtime.js";
import { COATING_AUTOMATION_PAUSED, COATING_MANUAL_GUIDANCE } from "../../../../core/alchemy/shared.js";
import { getCoreArcaneItemUse, showCoreArcaneItemUse } from "../../../../core/magic/arcane-item-use.js";
import { getActorCapabilityFlag } from "../../../../core/active-effects/modifier-evaluator.js";
import { buildGenericAEExpiry } from "../../../../core/active-effects/expiry.js";
import { buildEffectChange } from "../../../../utils/compat.js";
import { t } from "../../../../utils/i18n.js";

const _specialActionLaunchLocks = new Set();

/**
 * Handle Combat tab quick-action buttons.
 * 
 * Supported actions:
 * - specialAction (requires specialId + targeted token for most)
 * - attack (requires weaponId + targeted token)
 * - disengage, delay, defensive-stance, aim, dash, hide, use-item, reload-weapon, attack-of-opportunity
 * 
 * @param {object} sheet - The actor sheet instance
 * @param {Event} event - The click event
 * @returns {Promise<void>}
 */
export const onCombatQuickAction = asyncGuardSheet(async function onCombatQuickAction(event, target) {
  event.preventDefault();

  const btn = target ?? event.currentTarget;
  const action = btn?.dataset?.combatAction;
  if (!action) return;

  const actor = this.actor;
  const specialEvidence = { owner: "sheetSpecialAction", scope: "test submission and application", confirmed: false, uncertain: false,
    pending: false, references: { actorUuid: actor?.uuid } };
  const specialResult = () => withActionResult({ ok: false }, actionResultFromEvidence({ ...specialEvidence, blocked: !specialEvidence.pending }));

  // Local helpers
  const postActionCard = async (title, bodyHtml) => {
    const speaker = ChatMessage.getSpeaker({ actor });
    const content = buildCollapsedActionCardHtml(title, bodyHtml);
    return ChatMessage.create({ user: game.user.id, speaker, content, style: CONST.CHAT_MESSAGE_STYLES.OTHER });
  };

  const requireAP = async (title, apCost = 1) => {
    return spendActionPoints(actor, apCost, { reason: title });
  };

  const upsertSimpleEffect = async ({ key, name, icon, changes, flags = {}, statusId = null, duration = null }) => {
    const mergedFlags = {
      ...(flags ?? {}),
      uesrpg: { ...(flags?.uesrpg ?? {}), key }
    };

    return createOrUpdateStatusEffect(actor, {
      statusId,
      name,
      img: icon,
      duration: duration ?? {},
      changes: Array.isArray(changes) ? changes : [],
      flags: mergedFlags
    });
  };

  const buildTemporaryDuration = ({ rounds = null, turns = null, seconds = null } = {}) => {
    return buildEffectDuration({ actor, rounds, turns, seconds });
  };

  const ensureTurnActionAllowed = async (actionId, { allowExtinguish = false } = {}) => {
    const surprise = resolveSurpriseState(actor, { combatContext: game.combat });
    if (surprise.onlyReactions) {
      ui.notifications?.warn?.(`${actor.name} is surprised and may only take reactions until their first turn passes.`);
      return false;
    }

    const fear = getFearActionRestrictions(actor);
    if (fear?.blockActions === true) {
      ui.notifications?.warn?.(`${actor.name} cannot take actions due to fear effects.`);
      return false;
    }

    const burning = await ensureBurningTurnActionAllowed(actor, {
      actionId,
      allowExtinguish
    });
    if (!burning.allowed) {
      ui.notifications?.warn?.(`${actor.name} fails to act while burning.`);
      return false;
    }

    return true;
  };

  const ensureReactionAllowed = () => {
    const fear = getFearActionRestrictions(actor);
    if (fear?.blockReactions === true) {
      ui.notifications?.warn?.(`${actor.name} cannot take reactions due to fear effects.`);
      return false;
    }
    return true;
  };

  const _deleteEffect = async (effect, { requireConfirmed = false } = {}) => {
    if (!effect) return;
    try {
      const confirmed = await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);
      if (requireConfirmed && !confirmed) throw new Error("Aim removal was not confirmed. Inspect before retrying.");
    } catch (err) {
      console.warn("UESRPG | Sheet quick action failed to delete effect", { actor: actor?.uuid, effectId: effect?.id, err });
      if (requireConfirmed) throw err;
    }
  };

  const breakAimChainIfPresent = async (options = {}) => {
    const ef = getEnabledEffectByKey(actor, "aim");
    if (!ef) return;
    await _deleteEffect(ef, options);
  };

  const resolveCombatStyleForAttack = () => {
    const preferred = getExplicitActiveCombatStyleItem(actor)?.uuid ?? null;
    const styleCtx = resolveStyleForCombatTest(actor, {
      preferredStyleUuid: preferred,
      actorTypeFallback: true
    });
    if (!styleCtx) return null;
    return {
      styleUuid: styleCtx.styleUuid,
      styleName: styleCtx.styleName,
      base: Number(styleCtx.base ?? 0) || 0
    };
  };

  const launchGrappleAction = async () => {
    const specialId = "grapple";
    const at = String(btn?.dataset?.actionType ?? "primary").toLowerCase();

    if (at === "primary" && !isSpecialActionUsableNow(actor, "primary")) {
      ui.notifications?.warn?.("Grapple is only available on your Turn when used as a Primary action.");
      return specialResult();
    }

    if (at === "reaction") {
      if (!ensureReactionAllowed()) return specialResult();
    } else if (!(await ensureTurnActionAllowed("grapple"))) {
      return specialResult();
    }

    const targets = Array.from(game.user.targets ?? []);
    const targetToken = targets[0] ?? null;
    if (!targetToken) {
      ui.notifications?.warn?.("Grapple requires a targeted token.");
      return specialResult();
    }

    const lockKey = [
      String(actor?.uuid ?? actor?.id ?? ""),
      specialId,
      String(at || "primary"),
      String(targetToken?.document?.uuid ?? targetToken?.uuid ?? "none"),
    ].join("|");
    if (_specialActionLaunchLocks.has(lockKey)) {
      ui.notifications?.warn?.("Grapple is already being started.");
      return specialResult();
    }
    _specialActionLaunchLocks.add(lockKey);

    try {
      const activation = buildSpecialActionActivation({
        actionType: at === "reaction" ? "reaction" : "action",
        apCost: 1,
        requiresTarget: true
      });

      const activationResult = await executeActivation({
        actor,
        activation,
        label: "Grapple",
        renderChat: false,
        context: { targets: game.user?.targets }
      });
      specialEvidence.confirmed ||= activationResult.actionResult.commitment === "confirmed";
      specialEvidence.uncertain ||= activationResult.actionResult.commitment === "uncertain";
      if (!activationResult.ok) return activationResult;

      let actorToken = canvas.tokens?.controlled?.[0] ?? null;
      if (!actorToken) {
        actorToken = canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;
      }

      const attackerStyleCtx = resolveStyleForCombatTest(actor, { actorTypeFallback: true });
      const defenderStyleCtx = resolveStyleForCombatTest(targetToken?.actor ?? null, { actorTypeFallback: true });

      specialEvidence.uncertain = true;
      const message = await SkillOpposedWorkflow.createPending({
        attackerTokenUuid: actorToken?.document?.uuid ?? actorToken?.uuid,
        defenderTokenUuid: targetToken?.document?.uuid ?? targetToken?.uuid,
        attackerSkillUuid: attackerStyleCtx?.styleUuid ?? null,
        attackerSkillLabel: "Grapple"
      });
      specialEvidence.references.messageId = message?.id;

      const state = foundry.utils.deepClone(message?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state);
      if (!state) return specialResult();

      state.specialActionId = specialId;
      state.allowCombatStyle = true;
      state.specialActionContext = {
        id: specialId,
        source: "grapple-action",
        attackerStyleUuid: attackerStyleCtx?.styleUuid ?? null,
        defenderStyleUuid: defenderStyleCtx?.styleUuid ?? null
      };

      const saved = await safeUpdateChatMessage(message, {
        flags: {
          "uesrpg-3ev4": {
            skillOpposed: {
              version: state.version ?? 1,
              state
            }
          }
        }
      });
      specialEvidence.uncertain = !saved;
      specialEvidence.pending = saved === true;
    } finally {
      _specialActionLaunchLocks.delete(lockKey);
    }
  return specialResult();
  };

  const launchInCloseAction = async () => {
    const specialId = "inClose";
    const at = String(btn?.dataset?.actionType ?? "secondary").toLowerCase();

    if (at === "reaction") {
      if (!ensureReactionAllowed()) return specialResult();
    } else if (!(await ensureTurnActionAllowed("inClose"))) {
      return specialResult();
    }

    const targets = Array.from(game.user.targets ?? []);
    const targetToken = targets[0] ?? null;
    if (!targetToken) {
      ui.notifications?.warn?.("In Close requires a targeted token.");
      return specialResult();
    }

    const lockKey = [
      String(actor?.uuid ?? actor?.id ?? ""),
      specialId,
      String(at || "secondary"),
      String(targetToken?.document?.uuid ?? targetToken?.uuid ?? "none"),
    ].join("|");
    if (_specialActionLaunchLocks.has(lockKey)) {
      ui.notifications?.warn?.("In Close is already being started.");
      return specialResult();
    }
    _specialActionLaunchLocks.add(lockKey);

    try {
      const activation = buildSpecialActionActivation({
        actionType: at === "reaction" ? "reaction" : "secondary",
        apCost: 1,
        requiresTarget: true
      });

      const activationResult = await executeActivation({
        actor,
        activation,
        label: "In Close",
        renderChat: false,
        context: { targets: game.user?.targets }
      });
      specialEvidence.confirmed ||= activationResult.actionResult.commitment === "confirmed";
      specialEvidence.uncertain ||= activationResult.actionResult.commitment === "uncertain";
      if (!activationResult.ok) return activationResult;

      let actorToken = canvas.tokens?.controlled?.[0] ?? null;
      if (!actorToken) {
        actorToken = canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;
      }

      const attackerStyleCtx = resolveStyleForCombatTest(actor, { actorTypeFallback: true });
      const defenderStyleCtx = resolveStyleForCombatTest(targetToken?.actor ?? null, { actorTypeFallback: true });

      specialEvidence.uncertain = true;
      const message = await SkillOpposedWorkflow.createPending({
        attackerTokenUuid: actorToken?.document?.uuid ?? actorToken?.uuid,
        defenderTokenUuid: targetToken?.document?.uuid ?? targetToken?.uuid,
        attackerSkillUuid: attackerStyleCtx?.styleUuid ?? null,
        attackerSkillLabel: "In Close"
      });
      specialEvidence.references.messageId = message?.id;

      const state = message?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state;
      if (!state) return specialResult();

      state.specialActionId = specialId;
      state.allowCombatStyle = true;
      state.specialActionContext = {
        id: specialId,
        source: "in-close-action",
        attackerStyleUuid: attackerStyleCtx?.styleUuid ?? null,
        defenderStyleUuid: defenderStyleCtx?.styleUuid ?? null
      };

      const saved = await safeUpdateChatMessage(message, {
        flags: {
          "uesrpg-3ev4": {
            skillOpposed: {
              version: state.version ?? 1,
              state
            }
          }
        }
      });
      specialEvidence.uncertain = !saved;
      specialEvidence.pending = saved === true;
    } finally {
      _specialActionLaunchLocks.delete(lockKey);
    }
  return specialResult();
  };

  switch (action) {
    case "specialAction": {
      const specialId = btn?.dataset?.specialId;
      const at = String(btn?.dataset?.actionType ?? "").toLowerCase();
      const def = getSpecialActionById(specialId);
      const title = def ? `Special Action: ${def.name}` : "Special Action";

      if (!def) {
        ui.notifications?.warn?.("Unknown Special Action.");
        return specialResult();
      }

      if (at === "primary" && !isSpecialActionUsableNow(actor, "primary")) {
        ui.notifications?.warn?.("This Primary Special Action is only available on your Turn.");
        return specialResult();
      }

      if (at === "reaction") {
        if (!ensureReactionAllowed()) return specialResult();
      } else if (!(await ensureTurnActionAllowed(`special:${specialId ?? "unknown"}`))) {
        return specialResult();
      }

      const requiresTarget = specialId !== "arise";
      const targets = Array.from(game.user.targets ?? []);
      const targetToken = targets[0] ?? null;
      if (!targetToken && requiresTarget) return specialResult();

      let snareWeaponUuid = null;
      let snareRangeSnapshot = null;
      let snareActorToken = null;
      if (["bash", "trip"].includes(specialId)) {
        const actorToken = resolveTokenForCombatActor(actor, { sheetToken: this.token ?? null, requireUnambiguous: true });
        const choice = await chooseSnareSpecialAction({ specialActionId: specialId, actor, actorToken, targetToken });
        if (!choice) return specialResult();
        snareWeaponUuid = choice.weaponUuid;
        snareRangeSnapshot = choice.rangeSnapshot ?? null;
        if (snareWeaponUuid) {
          if (!actorToken) {
            ui.notifications?.warn?.("Select an unambiguous attacker token before using a Snare weapon.");
            return specialResult();
          }
          snareActorToken = actorToken;
        }
      }

      const lockKey = [
        String(actor?.uuid ?? actor?.id ?? ""),
        String(specialId ?? ""),
        String(at || "primary"),
        String(targetToken?.document?.uuid ?? targetToken?.uuid ?? "none"),
      ].join("|");
      if (_specialActionLaunchLocks.has(lockKey)) {
        ui.notifications?.warn?.("This special action is already being started.");
        return specialResult();
      }
      _specialActionLaunchLocks.add(lockKey);

      try {
        const activationType = (at === "secondary" || at === "reaction" || at === "free")
          ? at
          : "action";
      const activation = buildSpecialActionActivation({
        actionType: activationType,
        apCost: 1,
        requiresTarget
      });

      if (specialId === "arise") {
        const result = await executeSpecialAction({ specialActionId: specialId, actor, target: null,
          isAutoWin: false, opposedResult: { winner: "attacker" }, activation });
        if (!result.actionResult.accepted || ["partial", "needsReview"].includes(result.actionResult.status)) ui.notifications?.warn?.(result.message);
        return result;
      }

      const snareStillCurrent = () => !snareWeaponUuid || isSnareActionCurrent({ actor, target: targetToken?.actor,
        weaponUuid: snareWeaponUuid, rangeSnapshot: snareRangeSnapshot,
        actorTokenUuid: snareActorToken?.document?.uuid ?? snareActorToken?.uuid,
        targetTokenUuid: targetToken?.document?.uuid ?? targetToken?.uuid });
      if (!snareStillCurrent()) {
        ui.notifications?.warn?.("The Snare weapon or range changed. Start a new Special Action.");
        return specialResult();
      }

      const activationResult = await executeActivation({
        actor,
        activation,
        label: title,
        renderChat: false,
        context: { targets: game.user?.targets }
      });
      specialEvidence.confirmed ||= activationResult.actionResult.commitment === "confirmed";
      specialEvidence.uncertain ||= activationResult.actionResult.commitment === "uncertain";
      if (!activationResult.ok) return activationResult;
      if (!snareStillCurrent()) {
        specialEvidence.uncertain = true;
        ui.notifications?.warn?.("The Snare weapon or range changed during activation. Review any action cost before retrying.");
        return specialResult();
      }

      let actorToken = snareActorToken ?? canvas.tokens?.controlled?.[0] ?? null;
      if (!actorToken) {
        actorToken = canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;
      }

      const attackerStyleCtx = resolveStyleForCombatTest(actor, { actorTypeFallback: true });
      const defenderStyleCtx = resolveStyleForCombatTest(targetToken?.actor ?? null, { actorTypeFallback: true });
      const attackerSkillUuid = attackerStyleCtx?.styleUuid ?? null;

      specialEvidence.uncertain = true;
      const message = await SkillOpposedWorkflow.createPending({
        attackerTokenUuid: actorToken?.document?.uuid ?? actorToken?.uuid,
        defenderTokenUuid: targetToken?.document?.uuid ?? targetToken?.uuid,
        attackerSkillUuid,
        attackerSkillLabel: `${def.name} (Special Action)`
      });
      specialEvidence.references.messageId = message?.id;

      const state = message?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state;
      if (state) {
        state.specialActionId = specialId;
        state.allowCombatStyle = true;
        state.specialActionContext = {
          id: specialId,
          source: "combat-quick-action",
          attackerStyleUuid: attackerStyleCtx?.styleUuid ?? null,
          defenderStyleUuid: defenderStyleCtx?.styleUuid ?? null,
          snareWeaponUuid,
          snareRangeSnapshot
        };

        const saved = await safeUpdateChatMessage(message, {
          flags: {
            "uesrpg-3ev4": {
              skillOpposed: {
                version: state.version ?? 1,
                state
              }
            }
          }
        });
      specialEvidence.uncertain = !saved;
      specialEvidence.pending = saved === true;
      }

      } finally {
        _specialActionLaunchLocks.delete(lockKey);
      }
      return specialResult();
    }

    case "grapple": {
      return launchGrappleAction();
    }

    case "attack": {
      if (!(await ensureTurnActionAllowed("attack"))) return;

      if (actor?.effects?.some((e) => !e.disabled && e?.flags?.uesrpg?.key === "defensiveStance")) {
        ui.notifications?.warn?.("Defensive Stance is active: you cannot attack until your next Turn.");
        return;
      }

      const weaponId = btn?.dataset?.weaponId;
      if (!weaponId) {
        ui.notifications.warn("No weapon configured for this action.");
        return;
      }

      const weapon = actor.items.get(weaponId);
      if (!weapon) {
        ui.notifications.warn("Selected weapon could not be found on this actor.");
        return;
      }

      const attackerToken = resolveTokenForCombatActor(actor, {
        sheetToken: this.token ?? null,
        requireUnambiguous: true
      });
      if (!attackerToken) {
        ui.notifications.warn("Select the acting token for this sheet or reduce the actor to one owned token before attacking.");
        return;
      }

      const defenderTokens = Array.from(game?.user?.targets ?? []);
      if (!defenderTokens.length) {
        ui.notifications.warn("Please target an enemy token.");
        return;
      }

      const styleCtx = resolveCombatStyleForAttack();
      if (!styleCtx) {
        ui.notifications.warn("No Combat Style found on this actor.");
        return;
      }

      const base = Number(styleCtx.base ?? 0) || 0;
      const fatiguePenalty = Number(actor.system?.fatigue?.penalty ?? 0) || 0;
      const carryPenalty = Number(actor.system?.carry_rating?.penalty ?? 0) || 0;
      const woundPenalty = Number(actor.system?.woundPenalty ?? 0) || 0;
      const tn = base + fatiguePenalty + carryPenalty + woundPenalty;

      const label = String(btn?.dataset?.label ?? "Attack");
      const weaponItem = actor?.items?.get?.(weaponId);
      const explicitAttackMode = String(btn?.dataset?.attackMode ?? "").trim().toLowerCase();
      const attackMode = (explicitAttackMode === "melee" || explicitAttackMode === "ranged")
        ? explicitAttackMode
        : String(getWeaponCombatCapabilities(weaponItem).attackMode || "melee").toLowerCase();

      if (attackMode === "melee") {
        try { void setLastMeleeWeaponForActor(actor.id, weaponId); } catch (_e) { /* no-op */ }
      }

      await OpposedWorkflow.createPending({
        attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
        defenderTokenUuids: defenderTokens.map(t => t?.document?.uuid ?? t?.uuid).filter(Boolean),
        attackerActorUuid: actor.uuid,
        attackerItemUuid: styleCtx.styleUuid,
        attackerLabel: `${label} - ${styleCtx.styleName}`,
        attackerTarget: tn,
        mode: "attack",
        attackMode,
        weaponUuid: weapon.uuid
      });
      return;
    }

    case "disengage": {
      if (!(await ensureTurnActionAllowed("disengage"))) return;
      const movementGate = getMovementActionLegality(actor, { actionId: "disengage" });
      if (!movementGate.allowed) {
        ui.notifications.warn(`${actor.name} cannot move (${movementGate.reasons[0]}).`);
        return;
      }
      const selfToken = resolveTokenForActor(actor);
      if (selfToken && hasOpponentWithTalentInMeleeRange(selfToken, "unrelenting", {
        actorPredicate: (opponentActor) => getActorCapabilityFlag(opponentActor, "flags.uesrpg-3ev4.combat.preventEnemyDisengage")
      })) {
        ui.notifications.warn("Disengage is prevented by Unrelenting (opponent in melee range).");
        return;
      }
      if (!(await requireAP("Disengage", 1))) return;
      await breakAimChainIfPresent();
      await postActionCard(
        "Disengage",
        "<p>The character can use this action to retreat from combat with an enemy. If they move out of an enemy's engagement range during this Turn then the attack of opportunity reaction or other delayed actions/reactions may not be taken against them.</p>"
      );
      return;
    }

    case "delay": {
      if (!(await ensureTurnActionAllowed("delay"))) return;
      await breakAimChainIfPresent();
      await postActionCard(
        "Delay Turn",
        "<p>The character declares a set of circumstances in which they will act. The character then skips their Turn and may insert their delayed Turn into the order as a reaction if the conditions are met.</p><p><b>RAW:</b> Declaring Delay does not spend AP.</p>"
      );
      return;
    }

    case "defensive-stance": {
      if (!(await ensureTurnActionAllowed("defensive-stance"))) return;
      if (!(await requireAP("Defensive Stance", 1))) return;
      await breakAimChainIfPresent();
      await postActionCard(
        "Defensive Stance",
        "<p><strong>Effect:</strong> +10 on defensive tests until your next Turn. Your Attack limit is reduced to 0 until your next Turn.</p>"
      );

      const combat = game.combat ?? null;
      const expiry = combat?.started
        ? buildGenericAEExpiry({ mode: "source-next-turn-start", sourceActor: actor, targetActor: actor, combat })
        : null;
      const duration = {};
      await upsertSimpleEffect({
        key: "defensiveStance",
        name: "Defensive Stance",
        icon: "systems/uesrpg-3ev4/images/Icons/heroicDefense.webp",
        statusId: "uesrpg-action-defensive-stance",
        duration,
        changes: [
          buildEffectChange({ key: "system.modifiers.combat.defenseTN.total", type: "add", value: 10, priority: 20 }),
        ],
        flags: {
          uesrpg: {
            source: "action",
            ...(expiry?.metadata ? { ae: expiry.metadata } : {})
          }
        }
      });
      return;
    }

    case "aim": {
      if (!(await ensureTurnActionAllowed("aim"))) return;
      const candidates = [];
      try {
        const weapons = (actor.itemTypes?.weapon ?? []).filter((w) => Boolean(w?.system?.equipped));

        const rangedOrThrownWeapons = weapons.filter((w) => getWeaponCombatCapabilities(w).rangedCapable);

        for (const w of rangedOrThrownWeapons) {
          const capabilities = getWeaponCombatCapabilities(w);
          const labelPrefix = capabilities.thrown && capabilities.explicitAttackMode !== "ranged" ? "Weapon (Thrown)" : "Weapon";
          candidates.push({ uuid: w.uuid, label: `${labelPrefix}: ${w.name}`, kind: "weapon" });
        }
      } catch (_e) {
        // no-op
      }

      try {
        const spells = actor.itemTypes?.spell ?? [];
        const boltSpells = spells.filter((s) => String(s.system?.form ?? "").toLowerCase().includes("bolt"));
        for (const s of boltSpells) candidates.push({ uuid: s.uuid, label: `Bolt Spell: ${s.name}`, kind: "spell" });
      } catch (_e) {
        // no-op
      }

      if (!candidates.length) {
        ui.notifications?.warn?.("No ranged weapons or Bolt spells are available to Aim.");
        return;
      }

      const existing = getEnabledEffectByKey(actor, "aim");
      const prevState = getAimStateFromEffect(existing);
      const prevItemUuid = String(prevState.itemUuid ?? "");
      const prevStacks = Number(prevState.stacks ?? 0) || 0;

      const options = candidates.map((c) => {
        const selected = prevItemUuid && c.uuid === prevItemUuid ? " selected" : "";
        return `<option value="${foundry.utils.escapeHTML(c.uuid)}"${selected}>${foundry.utils.escapeHTML(c.label)}</option>`;
      }).join("");
      const defaultSelectedUuid = String(
        (prevItemUuid && candidates.some((c) => c.uuid === prevItemUuid) ? prevItemUuid : (candidates[0]?.uuid ?? ""))
      ).trim() || null;

      let selectedUuid = defaultSelectedUuid;
      if (candidates.length >= 2) {
        const content = `
          <div class="uesrpg-aim-form">
            <div class="form-group">
              <label>Aim At</label>
              <select name="aimItemUuid">${options}</select>
            </div>
          </div>
        `;

        selectedUuid = await customDialog({
          layout: "workflow",
          title: "Aim",
          width: 520,
          content,
          yes: {
            label: "Aim",
            callback: (html) => {
              const el = html instanceof HTMLElement ? html : html?.[0];
              const uuid = el?.querySelector("select[name='aimItemUuid']")?.value;
              return String(uuid ?? "").trim() || null;
            }
          },
          no: { label: "Cancel" },
          defaultButton: "yes"
        });
      }

      if (!selectedUuid) return;

      if (!(await requireAP("Aim", 1))) return;

      const isContinuingSame = prevItemUuid && selectedUuid === prevItemUuid;
      const nextStacks = Math.min(3, (isContinuingSame ? prevStacks : 0) + 1);
      const nextBonus = nextStacks * 10;

      AimAudit.applyStack(actor, { stacks: nextStacks, itemUuid: selectedUuid });

      await postActionCard(
        "Aim",
        `<p><strong>Effect:</strong> +${nextBonus} to the next ranged attack with the aimed weapon/spell (stacks up to +30 if you continue aiming consecutively). If you take any other action or reaction (other than continuing to Aim or firing the aimed weapon/spell), the Aim chain is broken and the bonus is lost.</p>`
      );

      const duration = buildTemporaryDuration({ rounds: 9999, seconds: 604800 });
      await upsertSimpleEffect({
        key: "aim",
        name: "Aim",
        icon: "systems/uesrpg-3ev4/images/Icons/hardTarget.webp",
        statusId: "uesrpg-action-aim",
        duration,
        changes: [
          buildEffectChange({ key: "system.modifiers.combat.attackTN", type: "add", value: nextBonus, priority: 20 }),
        ],
        flags: {
          uesrpg: {
            source: "action",
            aim: { stacks: nextStacks, itemUuid: selectedUuid },
            conditions: { attackMode: "ranged", itemUuid: selectedUuid }
          }
        }
      });
      return;
    }

    case "dash": {
      if (!(await ensureTurnActionAllowed("dash"))) return;
      const movementGate = getMovementActionLegality(actor, { actionId: "dash" });
      if (!movementGate.allowed) {
        ui.notifications.warn(`${actor.name} cannot Dash (${movementGate.reasons[0]}).`);
        return;
      }
      if (!(await requireAP("Dash", 1))) return;
      await breakAimChainIfPresent();
      
      const sprintEffect = await applySprintBonus(actor);
      const speed = actor.system?.speed?.value ?? 0;
      const movement = sprintEffect ? speed * 2 : speed;
      
      const baseDescription = "The character can use this action in order to move up to their Speed";
      const sprintNote = sprintEffect ? " (2× Speed from Sprint effect)" : "";
      const turnDescription = "If this is done on their Turn, this movement is added to their base movement for that Turn. This action can be used to allow a character to move several times their Speed during a round.";
      const sprintDetails = sprintEffect ? `<p><b>Sprint Active:</b> Movement up to ${movement} meters</p>` : "";
      
      await postActionCard(
        "Dash",
        `<p>${baseDescription}${sprintNote}. ${turnDescription}</p>${sprintDetails}`
      );
      await recordDashStart(actor);
      return;
    }

    case "hide": {
      if (!(await ensureTurnActionAllowed("hide"))) return;
      if (!(await requireAP("Hide", 1))) return;
      await breakAimChainIfPresent();
      await postActionCard(
        "Hide",
        "<p>The character can use this action to attempt to hide from foes. If anyone might detect them while they do this, they must make a Stealth skill test opposed by the Observe of anyone who might spot them. On success, they gain the Hidden condition.</p>"
      );
      return;
    }

    case "use-item": {
      const useResult = (value, cost = null) => withActionResult(value, cost
        ? aggregateActionResults([cost, value], { owner: "sheetItemUse", scope: "AP and item workflow", references: { actorUuid: actor.uuid } })
        : value.actionResult);
      const stopUse = (evidence = {}) => withActionResult({ ok: false }, actionResultFromEvidence({ owner: "sheetItemUse", scope: "AP and item workflow",
        ...evidence, references: { actorUuid: actor.uuid } }));
      const candidates = actor.items.filter(i => {
        const consumable = Boolean(i?.system?.consumable);
        const type = String(i?.type ?? "");
        const isPhysical = PHYSICAL_ITEM_TYPES.includes(type) && i?.system?.isPhysicalObject !== false;
        return consumable && isPhysical;
      });

      if (!candidates.length) {
        await postActionCard(
          "Use Item",
          "<p>No consumable Items were found on this actor.</p>"
        );
        return stopUse({ blocked: true, reason: "No consumable Items were found." });
      }

      const options = candidates
        .map((item) => `<option value="${foundry.utils.escapeHTML(item.id)}">${foundry.utils.escapeHTML(item.name)}</option>`)
        .join("");
      const content = `
        <div class="uesrpg-use-item-form">
          <div class="form-group">
            <label for="uesrpg-use-item-select">${t("UESRPG.Dialogs.UseItem.Item", "Item")}</label>
            <select id="uesrpg-use-item-select" name="itemId">${options}</select>
          </div>
        </div>
      `;

      let useStarted = false;
      const selected = await customDialog({
        layout: "workflow",
        title: t("UESRPG.Dialogs.UseItem.Title", "Use Item"),
        content,
        yes: {
          label: t("UESRPG.Dialogs.UseItem.Use", "Use"),
          callback: async (html) => {
            useStarted = true;
            const el = html instanceof HTMLElement ? html : html?.[0];
            const itemId = el?.querySelector("select[name='itemId']")?.value;
            const item = actor.items.get(itemId);
            if (!item) {
              ui.notifications.warn("Selected item could not be found.");
              return stopUse({ rejected: true });
            }

            // Alchemy products: resolve via the alchemy runtime workflows.
            const alchemyKind = item?.flags?.["uesrpg-3ev4"]?.alchemy?.kind;
            const isAlchemyProduct = alchemyKind === "potion" || alchemyKind === "poison" || alchemyKind === "toxin";

            // The generic shortcut only spends AP and posts a name. Do not
            // present that as an arcane Item's source-specific procedure.
            const arcaneRule = !isAlchemyProduct && getCoreArcaneItemUse(item);
            if (arcaneRule) {
              await showCoreArcaneItemUse(item, arcaneRule);
              return stopUse({ blocked: true, reason: "This arcane Item requires manual resolution; no shortcut cost was charged." });
            }

            if (alchemyKind !== "potion" && !(await ensureTurnActionAllowed("use-item"))) return stopUse({ blocked: true });

            if (isAlchemyProduct && (alchemyKind === "poison" || alchemyKind === "toxin")) {
              if (COATING_AUTOMATION_PAUSED) {
                ui.notifications.warn(COATING_MANUAL_GUIDANCE);
                return stopUse({ blocked: true, reason: COATING_MANUAL_GUIDANCE });
              }
              const targetItem = await pickAlchemyCoatingTarget(actor);
              if (!targetItem) return stopUse({ cancelled: true });
              const cost = await spendActionPointsResult(actor, 1, { reason: "Use Item" });
              if (!cost.value) return useResult({ ok: false, actionResult: cost.actionResult });
              await breakAimChainIfPresent({ requireConfirmed: true });
              return useResult(await applyAlchemyToTarget(actor, item, targetItem), cost);
            }

            if (isAlchemyProduct && alchemyKind === "potion") {
              // Potion use owns its own action cost across all sheet and chat entry points.
              return useResult(await drinkPotion(actor, item));
            }

            // Default consumable flow (non-alchemy): spend AP and post a card.
            const cost = await spendActionPointsResult(actor, 1, { reason: "Use Item" });
            if (!cost.value) return useResult({ ok: false, actionResult: cost.actionResult });
            await breakAimChainIfPresent({ requireConfirmed: true });
            const message = await postActionCard("Use Item", `<p>${item.name}</p>`);
            return useResult(withActionResult({ ok: Boolean(message), messageId: message?.id }, actionResultFromEvidence({
              owner: "sheetItemUse", scope: "ordinary item report", uncertain: !message?.id, references: { messageId: message?.id, itemUuid: item.uuid } })), cost);
          }
        },
        no: { label: t("UESRPG.Buttons.Cancel", "Cancel") },
        defaultButton: "yes",
        classes: ["uesrpg-use-item-dialog"],
        width: 480,
        resizable: true,
      });
      return selected?.actionResult ? selected : stopUse({ cancelled: !useStarted, uncertain: useStarted });
    }

    case "reload-weapon": {
      event.preventDefault();
      const reloadCombatStep = getActorCombatStep(actor);

      const rangedWeapon = actor.items.find(i =>
        i.type === "weapon" &&
        i.system?.equipped === true &&
        getWeaponCombatCapabilities(i).requiresReload
      );

      if (!rangedWeapon) {
        ui.notifications.warn("No equipped ranged weapon to reload.");
        return;
      }
      const hasReloadPowerDraw = () => hasPendingPowerDraw(actor, actor.items.get(rangedWeapon.id) ?? rangedWeapon);

      const reloadState = rangedWeapon.system?.reloadState ?? {};
      const reloadCost = Math.max(0, Math.trunc(_num(reloadState.reloadAPCost, 0)));

      if (!reloadState.requiresReload || reloadCost === 0) {
        ui.notifications.info(`${rangedWeapon.name} does not require reloading.`);
        return;
      }

      if (reloadState.isLoaded) {
        ui.notifications.info(`${rangedWeapon.name} is already loaded.`);
        return;
      }

      if (hasReloadPowerDraw()) {
        ui.notifications.warn("A Power Draw reload needs GM resolution. Inspect the weapon, pending effect and reload progress; this shortcut did not spend AP or consume Power Draw.");
        return;
      }
      const hasRapidReload = hasTalent(actor, "rapidreload") || hasTalent(actor, "dualrapidreloadfighter");
      if (hasRapidReload) {
        ui.notifications.warn("Rapid Reload needs manual resolution. Reduce the weapon's Reload quality by one to a minimum of zero; inspect AP, reload progress, ammunition and previous chat before recording the reload or retrying.");
        return;
      }
      const talentReloadReduction = hasRapidReload ? 1 : 0;
      const effectiveReloadCost = Math.max(0, reloadCost - talentReloadReduction);
      const isFreeReload = effectiveReloadCost === 0;

      const currentAP = Math.max(0, Math.trunc(_num(actor.system?.action_points?.value, 0)));
      const enforceActionEconomy = isActorInStartedCombatEncounter(actor);
      const currentProgress = Math.min(
        reloadCost,
        Math.max(0, Math.trunc(_num(reloadState.reloadProgress, 0)))
      );
      const remaining = Math.max(0, effectiveReloadCost - currentProgress);

      if (enforceActionEconomy && !isFreeReload && currentAP < 1) {
        ui.notifications.warn(`You have no AP remaining to spend on reloading ${rangedWeapon.name}.`);
        return;
      }

      // Determine how many AP to spend this action.
      let apToSpend;
      if (isFreeReload) {
        apToSpend = 0;
      } else if (!enforceActionEconomy) {
        apToSpend = remaining;
      } else if (effectiveReloadCost <= 1 && remaining <= 1) {
        // Single-AP reload — no dialog needed.
        apToSpend = 1;
      } else {
        // Multi-AP reload: ask the actor how many AP to spend this turn.
        const maxSpendable = Math.max(0, Math.min(currentAP, remaining));
        const progressLabel = currentProgress > 0
          ? ` (${currentProgress}/${effectiveReloadCost} AP already spent)`
          : "";

        const reductionParts = [];
        if (talentReloadReduction > 0) reductionParts.push(`Rapid Reload -${talentReloadReduction}`);
        const reductionNote = reductionParts.length ? `<p class="u-text-muted u-text-sm">${reductionParts.join(", ")} applied to base cost ${reloadCost}</p>` : "";

        const options = Array.from({ length: maxSpendable }, (_, i) => i + 1)
          .map(n => `<option value="${n}"${n === maxSpendable ? " selected" : ""}>${n} AP${n >= remaining ? " (completes reload)" : ""}</option>`)
          .join("");

        apToSpend = await customDialog({
          layout: "workflow",
          title: `Reload — ${rangedWeapon.name}`,
          content: `
            <div class="uesrpg-dialog-form">
              <p>Total reload cost: <strong>${effectiveReloadCost} AP</strong>${progressLabel}</p>
              ${reductionNote}
              <p>Remaining to complete: <strong>${remaining} AP</strong></p>
              <div class="form-group">
                <label>AP to spend this action</label>
                <select name="apSpend">${options}</select>
              </div>
            </div>`,
          buttons: {
            confirm: {
              label: "Spend AP",
              callback: (html) => {
                const root = html instanceof HTMLElement ? html : html?.[0];
                const spend = Math.max(0, Math.trunc(_num(root?.querySelector?.("[name=apSpend]")?.value, 0)));
                return Math.max(1, spend);
              }
            },
            cancel: { label: "Cancel", callback: () => null },
          },
          defaultButton: "confirm",
        });

        if (apToSpend == null) return; // Cancelled
      }

      // The pending benefit may have appeared while the selection dialog was open.
      if (hasReloadPowerDraw()) {
        ui.notifications.warn("Power Draw became active while reloading was being selected. The GM must resolve the reload; this shortcut spent no AP and did not consume the benefit.");
        return;
      }

      const reloadIsCurrent = () => {
        const liveWeapon = actor.items.get(rangedWeapon.id);
        const liveState = liveWeapon?.system?.reloadState;
        return isActorCombatStepCurrent(actor, reloadCombatStep)
          && liveWeapon?.uuid === rangedWeapon.uuid && liveWeapon.system?.equipped === true
          && liveState?.requiresReload === true && liveState.isLoaded !== true
          && Math.max(0, Math.trunc(_num(liveState.reloadAPCost, 0))) === reloadCost
          && Math.min(reloadCost, Math.max(0, Math.trunc(_num(liveState.reloadProgress, 0)))) === currentProgress
          && (hasTalent(actor, "rapidreload") || hasTalent(actor, "dualrapidreloadfighter")) === hasRapidReload;
      };
      if (!reloadIsCurrent()) {
        ui.notifications.warn("The combat step, weapon or reload details changed. This shortcut spent no AP; inspect the current state before starting again.");
        return;
      }

      const reloadLock = `sheet-reload:${actor.uuid}:${rangedWeapon.uuid}`;
      if (!await acquireLock(reloadLock, { wait: false })) {
        ui.notifications.warn("A reload for this weapon is already being processed on this client.");
        return;
      }
      try {
        if (!(await ensureTurnActionAllowed("reload-weapon"))) return;
        if (!reloadIsCurrent() || hasReloadPowerDraw()) {
          ui.notifications.warn("The combat step, weapon or Power Draw changed before reload payment. Inspect the current state; this shortcut spent no AP.");
          return;
        }
        const numericSpend = isFreeReload
          ? 0
          : Math.max(0, Math.min(Math.trunc(_num(apToSpend, 0)), enforceActionEconomy ? currentAP : remaining, remaining));
        const newProgress = isFreeReload ? 0 : Math.max(0, currentProgress + numericSpend);
        const reloadComplete = isFreeReload || newProgress >= effectiveReloadCost;

        if (enforceActionEconomy && numericSpend > 0) {
          const payment = await spendActionPointsResult(actor, numericSpend, { reason: "Reload" });
          if (!payment.value) {
            ui.notifications.warn("Reload stopped because AP payment was not confirmed. Inspect AP before retrying if the payment result is uncertain.");
            return;
          }
        }
        if (!reloadIsCurrent() || hasReloadPowerDraw()) {
          ui.notifications.warn("The reload state changed after payment began. AP may already have been spent; inspect AP, the weapon and Power Draw before retrying.");
          return;
        }

        let weaponUpdated = false;
        const liveWeapon = actor.items.get(rangedWeapon.id);
        try {
          if (reloadComplete) {
            weaponUpdated = await requestUpdateDocument(liveWeapon, {
              "system.reloadState.isLoaded": true,
              "system.reloadState.reloadProgress": 0,
            });
          } else {
            weaponUpdated = await requestUpdateDocument(liveWeapon, {
              "system.reloadState.reloadProgress": newProgress,
            });
          }
        } catch (_error) {
          weaponUpdated = false;
        }
        if (!weaponUpdated) {
          ui.notifications.warn("Reload progress was not confirmed. AP may already have been spent; inspect AP and the weapon before retrying.");
          return;
        }

        const talentNote = talentReloadReduction > 0 ? `<p><em>Rapid Reload: -${talentReloadReduction} AP</em></p>` : "";
        const remainingNeeded = Math.max(0, remaining - numericSpend);
        const statusLine = reloadComplete
          ? `<p><strong>${rangedWeapon.name} is now loaded!</strong></p>`
          : `<p>Reload progress: <strong>${newProgress} / ${effectiveReloadCost} AP</strong> spent. ${remainingNeeded} AP still needed.</p>`;

        let reloadMessage = null;
        try {
          reloadMessage = await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `
            <div class="uesrpg-chat-card">
              <header class="card-header">
                <img src="${rangedWeapon.img}" width="36" height="36"/>
                <h3>${reloadComplete ? "Reload Complete" : "Reloading…"}</h3>
              </header>
              <div class="card-content">
                <p><strong>${actor.name}</strong> ${reloadComplete ? "reloads" : "continues reloading"} <strong>${rangedWeapon.name}</strong>.</p>
                <p><em>${enforceActionEconomy ? `AP Spent: ${isFreeReload ? "Free" : numericSpend}` : "Outside tracked combat; no AP charged."}</em></p>
                ${talentNote}
                ${statusLine}
                <p>Remaining AP: ${Math.max(0, Math.trunc(_num(actor.system?.action_points?.value, 0)))}</p>
              </div>
            </div>
            `,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
          });
        } catch (_error) {
          reloadMessage = null;
        }
        if (!reloadMessage?.id) {
          ui.notifications.warn("Reload was updated, but its chat report was not confirmed. Inspect AP, the weapon and chat before retrying.");
          return;
        }

        ui.notifications.info(reloadComplete
          ? `${rangedWeapon.name} fully reloaded.`
          : `Spent ${numericSpend} AP toward reloading ${rangedWeapon.name} (${newProgress}/${effectiveReloadCost}).`
        );
        return;
      } finally {
        releaseLock(reloadLock);
      }
    }

    case "extinguish-burning": {
      if (!(await ensureTurnActionAllowed("extinguish-burning", { allowExtinguish: true }))) return;
      const burningValue = Number(getConditionValue(actor, "burning") ?? 0) || 0;
      if (burningValue <= 0) {
        ui.notifications?.warn?.("You are not currently burning.");
        return;
      }
      if (!(await requireAP("Put Out Fire", 1))) return;
      await breakAimChainIfPresent();

      const result = await attemptExtinguishBurning(actor);
      if (!result?.ok) {
        ui.notifications?.warn?.("You are not currently burning.");
        return;
      }

      await postActionCard(
        "Put Out Fire",
        result.success
          ? "<p>The flames are extinguished. You fall prone.</p>"
          : "<p>You fail to extinguish the flames and fall prone.</p>"
      );
      return;
    }

    case "attack-of-opportunity": {
      if (!ensureReactionAllowed()) return;
      const weaponId = actor.sheetCombatQuick?.meleeWeaponId ?? null;
      if (!weaponId) {
        ui.notifications.warn("No melee weapon equipped for Attack of Opportunity.");
        return;
      }

      const weapon = actor.items.get(weaponId);
      if (!weapon) {
        ui.notifications.warn("Equipped weapon could not be found.");
        return;
      }

      const attackerToken = resolveTokenForCombatActor(actor, {
        sheetToken: this.token ?? null,
        requireUnambiguous: true
      });
      if (!attackerToken) {
        ui.notifications.warn("Select the acting token for this sheet or reduce the actor to one owned token before attacking.");
        return;
      }

	      const defenderTokens = Array.from(game?.user?.targets ?? []);
	      if (!defenderTokens.length) {
	        ui.notifications.warn("Please target an enemy token for Attack of Opportunity.");
	        return;
	      }

	      const allowedTargets = defenderTokens.filter((t) => {
	        const targetActor = t?.actor ?? null;
	        if (!targetActor) return false;
	        if (isActorBlockedFromAoOAgainstTarget(actor, targetActor)) {
	          ui.notifications?.warn?.(`${actor.name} cannot make an Attack of Opportunity against ${targetActor.name} right now.`);
	          return false;
	        }
	        return true;
	      });

	      if (!allowedTargets.length) return;

      const currentAP = Number(actor?.system?.action_points?.value ?? 0);
      if (isActorInStartedCombatEncounter(actor) && currentAP < 1) {
        ui.notifications.warn(`${actor.name} does not have enough Action Points (${currentAP}/1).`);
        return;
      }

      const attackMode = "melee";
      
      const styleCtx = resolveCombatStyleForAttack();
      if (!styleCtx) {
        ui.notifications.warn("No Combat Style found on this actor.");
        return;
      }

      const base = Number(styleCtx.base ?? 0) || 0;
      const fatiguePenalty = Number(actor.system?.fatigue?.penalty ?? 0) || 0;
      const carryPenalty = Number(actor.system?.carry_rating?.penalty ?? 0) || 0;
      const woundPenalty = Number(actor.system?.woundPenalty ?? 0) || 0;
      const tn = base + fatiguePenalty + carryPenalty + woundPenalty;

	      await OpposedWorkflow.createPending({
	        attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
	        defenderTokenUuids: allowedTargets.map(t => t?.document?.uuid ?? t?.uuid).filter(Boolean),
	        attackerActorUuid: actor.uuid,
	        attackerItemUuid: styleCtx.styleUuid,
	        attackerLabel: `Attack of Opportunity - ${styleCtx.styleName}`,
	        attackerTarget: tn,
        mode: "attack",
        attackMode,
        weaponUuid: weapon.uuid,
        isReactionAttack: true,
        skipAttackerAPDeduction: false
      });
      return;
    }

    case "inClose": {
      // Homebrew Reach & Length Overhaul: run as a skill-opposed special action.
      return launchInCloseAction();
    }

    default:
      return;
  }
});
