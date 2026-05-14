/**
 * Combat quick action handlers for actor sheets.
 * 
 * Shared across actor sheet modules.
 * 
 * This module contains the large combat quick action handler that was extracted
 * from actor-sheet.js for better maintainability and performance.
 */

import { buildCollapsedActionCardHtml, getAimStateFromEffect, getEnabledEffectByKey, resolveTokenForActor, resolveTokenForCombatActor, spendActionPoints } from "../../combat-actions-utils.js";
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
import { isActorInStartedCombatEncounter } from "../../../../core/combat/combat-scope.js";
import { setLastMeleeWeaponForActor } from "../../../canvas/reach-visualizer-state.js";
import { hasOpponentWithTalentInMeleeRange } from "../../../../core/traits/combat-proximity.js";
import { getWeaponCombatCapabilities, recordDashStart } from "../../../../core/combat/combat-utils.js";
import { hasTalent } from "../../../../core/traits/talents-api.js";
import { AimAudit } from "../../../../core/combat/aim-audit.js";
import { isActorBlockedFromAoOAgainstTarget } from "../../../../core/traits/mobility-talents.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { requestUpdateDocument, requestDeleteEmbeddedDocuments } from "../../../../utils/authority-proxy.js";
import { safeUpdateChatMessage } from "../../../../utils/chat-message-socket.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";
import { _num } from "../../../../utils/coerce.js";
import { executeSpecialAction } from "../../../../core/combat/special-actions-helper.js";
import { applySprintBonus, applyPowerDrawBonus } from "../../../../core/stamina/stamina-integration-hooks.js";
import {
  ensureBurningTurnActionAllowed,
  attemptExtinguishBurning,
  getConditionValue
} from "../../../../core/conditions/condition-engine.js";
import { resolveSurpriseState } from "../../../../core/combat/surprise-state.js";
import { getFearActionRestrictions } from "../../../../core/fear/index.js";
import { getMovementActionLegality } from "../../../../core/combat/movement-rules.js";
import { drinkPotion, applyAlchemyToTarget, pickAlchemyCoatingTarget } from "../../../../core/alchemy/runtime.js";
import { getActorCapabilityFlag } from "../../../../core/active-effects/modifier-evaluator.js";
import { buildGenericAEExpiry } from "../../../../core/active-effects/expiry.js";
import { buildEffectChange } from "../../../../utils/compat.js";

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

  const _deleteEffect = async (effect) => {
    if (!effect) return;
    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);
    } catch (err) {
      console.warn("UESRPG | Sheet quick action failed to delete effect", { actor: actor?.uuid, effectId: effect?.id, err });
    }
  };

  const breakAimChainIfPresent = async () => {
    const ef = getEnabledEffectByKey(actor, "aim");
    if (!ef) return;
    await _deleteEffect(ef);
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
      return;
    }

    if (at === "reaction") {
      if (!ensureReactionAllowed()) return;
    } else if (!(await ensureTurnActionAllowed("grapple"))) {
      return;
    }

    const targets = Array.from(game.user.targets ?? []);
    const targetToken = targets[0] ?? null;
    if (!targetToken) {
      ui.notifications?.warn?.("Grapple requires a targeted token.");
      return;
    }

    const lockKey = [
      String(actor?.uuid ?? actor?.id ?? ""),
      specialId,
      String(at || "primary"),
      String(targetToken?.document?.uuid ?? targetToken?.uuid ?? "none"),
    ].join("|");
    if (_specialActionLaunchLocks.has(lockKey)) {
      ui.notifications?.warn?.("Grapple is already being started.");
      return;
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
      if (!activationResult.ok) return;

      let actorToken = canvas.tokens?.controlled?.[0] ?? null;
      if (!actorToken) {
        actorToken = canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;
      }

      const attackerStyleCtx = resolveStyleForCombatTest(actor, { actorTypeFallback: true });
      const defenderStyleCtx = resolveStyleForCombatTest(targetToken?.actor ?? null, { actorTypeFallback: true });

      const message = await SkillOpposedWorkflow.createPending({
        attackerTokenUuid: actorToken?.document?.uuid ?? actorToken?.uuid,
        defenderTokenUuid: targetToken?.document?.uuid ?? targetToken?.uuid,
        attackerSkillUuid: attackerStyleCtx?.styleUuid ?? null,
        attackerSkillLabel: "Grapple"
      });

      const state = message?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state;
      if (!state) return;

      state.specialActionId = specialId;
      state.allowCombatStyle = true;
      state.specialActionContext = {
        id: specialId,
        source: "grapple-action",
        attackerStyleUuid: attackerStyleCtx?.styleUuid ?? null,
        defenderStyleUuid: defenderStyleCtx?.styleUuid ?? null
      };

      await safeUpdateChatMessage(message, {
        flags: {
          "uesrpg-3ev4": {
            skillOpposed: {
              version: state.version ?? 1,
              state
            }
          }
        }
      });
    } finally {
      _specialActionLaunchLocks.delete(lockKey);
    }
  };

  const launchInCloseAction = async () => {
    const specialId = "inClose";
    const at = String(btn?.dataset?.actionType ?? "secondary").toLowerCase();

    if (at === "reaction") {
      if (!ensureReactionAllowed()) return;
    } else if (!(await ensureTurnActionAllowed("inClose"))) {
      return;
    }

    const targets = Array.from(game.user.targets ?? []);
    const targetToken = targets[0] ?? null;
    if (!targetToken) {
      ui.notifications?.warn?.("In Close requires a targeted token.");
      return;
    }

    const lockKey = [
      String(actor?.uuid ?? actor?.id ?? ""),
      specialId,
      String(at || "secondary"),
      String(targetToken?.document?.uuid ?? targetToken?.uuid ?? "none"),
    ].join("|");
    if (_specialActionLaunchLocks.has(lockKey)) {
      ui.notifications?.warn?.("In Close is already being started.");
      return;
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
      if (!activationResult.ok) return;

      let actorToken = canvas.tokens?.controlled?.[0] ?? null;
      if (!actorToken) {
        actorToken = canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;
      }

      const attackerStyleCtx = resolveStyleForCombatTest(actor, { actorTypeFallback: true });
      const defenderStyleCtx = resolveStyleForCombatTest(targetToken?.actor ?? null, { actorTypeFallback: true });

      const message = await SkillOpposedWorkflow.createPending({
        attackerTokenUuid: actorToken?.document?.uuid ?? actorToken?.uuid,
        defenderTokenUuid: targetToken?.document?.uuid ?? targetToken?.uuid,
        attackerSkillUuid: attackerStyleCtx?.styleUuid ?? null,
        attackerSkillLabel: "In Close"
      });

      const state = message?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state;
      if (!state) return;

      state.specialActionId = specialId;
      state.allowCombatStyle = true;
      state.specialActionContext = {
        id: specialId,
        source: "in-close-action",
        attackerStyleUuid: attackerStyleCtx?.styleUuid ?? null,
        defenderStyleUuid: defenderStyleCtx?.styleUuid ?? null
      };

      await safeUpdateChatMessage(message, {
        flags: {
          "uesrpg-3ev4": {
            skillOpposed: {
              version: state.version ?? 1,
              state
            }
          }
        }
      });
    } finally {
      _specialActionLaunchLocks.delete(lockKey);
    }
  };

  switch (action) {
    case "specialAction": {
      const specialId = btn?.dataset?.specialId;
      const at = String(btn?.dataset?.actionType ?? "").toLowerCase();
      const def = getSpecialActionById(specialId);
      const title = def ? `Special Action: ${def.name}` : "Special Action";

      if (!def) {
        ui.notifications?.warn?.("Unknown Special Action.");
        return;
      }

      if (at === "primary" && !isSpecialActionUsableNow(actor, "primary")) {
        ui.notifications?.warn?.("This Primary Special Action is only available on your Turn.");
        return;
      }

      if (at === "reaction") {
        if (!ensureReactionAllowed()) return;
      } else if (!(await ensureTurnActionAllowed(`special:${specialId ?? "unknown"}`))) {
        return;
      }

      const requiresTarget = specialId !== "arise";
      const targets = Array.from(game.user.targets ?? []);
      const targetToken = targets[0] ?? null;
      if (!targetToken && requiresTarget) return;

      const lockKey = [
        String(actor?.uuid ?? actor?.id ?? ""),
        String(specialId ?? ""),
        String(at || "primary"),
        String(targetToken?.document?.uuid ?? targetToken?.uuid ?? "none"),
      ].join("|");
      if (_specialActionLaunchLocks.has(lockKey)) {
        ui.notifications?.warn?.("This special action is already being started.");
        return;
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

      const activationResult = await executeActivation({
        actor,
        activation,
        label: title,
        renderChat: false,
        context: { targets: game.user?.targets }
      });
      if (!activationResult.ok) return;

      let actorToken = canvas.tokens?.controlled?.[0] ?? null;
      if (!actorToken) {
        actorToken = canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;
      }

      if (specialId === "arise") {
        const result = await executeSpecialAction({
          specialActionId: specialId,
          actor,
          target: null,
          isAutoWin: false,
          opposedResult: { winner: "attacker" }
        });

        if (result.success) {
          await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="uesrpg-special-action-outcome"><b>Special Action:</b><p>${result.message}</p></div>`,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
          });
        }
        return;
      }

      const attackerStyleCtx = resolveStyleForCombatTest(actor, { actorTypeFallback: true });
      const defenderStyleCtx = resolveStyleForCombatTest(targetToken?.actor ?? null, { actorTypeFallback: true });
      const attackerSkillUuid = attackerStyleCtx?.styleUuid ?? null;

      const message = await SkillOpposedWorkflow.createPending({
        attackerTokenUuid: actorToken?.document?.uuid ?? actorToken?.uuid,
        defenderTokenUuid: targetToken?.document?.uuid ?? targetToken?.uuid,
        attackerSkillUuid,
        attackerSkillLabel: `${def.name} (Special Action)`
      });

      const state = message?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state;
      if (state) {
        state.specialActionId = specialId;
        state.allowCombatStyle = true;
        state.specialActionContext = {
          id: specialId,
          source: "combat-quick-action",
          attackerStyleUuid: attackerStyleCtx?.styleUuid ?? null,
          defenderStyleUuid: defenderStyleCtx?.styleUuid ?? null
        };

        await safeUpdateChatMessage(message, {
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

      } finally {
        _specialActionLaunchLocks.delete(lockKey);
      }
      return;
    }

    case "grapple": {
      await launchGrappleAction();
      return;
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
        return `<option value="${c.uuid}"${selected}>${c.label}</option>`;
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
      if (!(await ensureTurnActionAllowed("use-item"))) return;
      const candidates = actor.items.filter(i => {
        const consumable = Boolean(i?.system?.consumable);
        const type = String(i?.type ?? "");
        const isPhysical = type === "equipment" || type === "container";
        return consumable && isPhysical;
      });

      if (!candidates.length) {
        await postActionCard(
          "Use Item",
          "<p>No consumable Items were found on this actor.</p>"
        );
        return;
      }

      const options = candidates.map(i => `<option value="${i.id}">${i.name}</option>`).join("");
      const content = `
        <div class="uesrpg-use-item-form">
          <div class="form-group">
            <label>Item</label>
            <select name="itemId">${options}</select>
          </div>
        </div>
      `;

      return customDialog({
        title: "Use Item",
        content,
        yes: {
          label: "Use",
          callback: async (html) => {
            const el = html instanceof HTMLElement ? html : html?.[0];
            const itemId = el?.querySelector("select[name='itemId']")?.value;
            const item = actor.items.get(itemId);
            if (!item) {
              ui.notifications.warn("Selected item could not be found.");
              return;
            }

            // Alchemy products: resolve via the alchemy runtime workflows.
            const alchemyKind = item?.flags?.["uesrpg-3ev4"]?.alchemy?.kind;
            const isAlchemyProduct = alchemyKind === "potion" || alchemyKind === "poison" || alchemyKind === "toxin";

            if (isAlchemyProduct && (alchemyKind === "poison" || alchemyKind === "toxin")) {
              // Select target first; only spend AP if the player commits.
              const targetItem = await pickAlchemyCoatingTarget(actor);
              if (!targetItem) return;

              if (!(await spendActionPoints(actor, 1, { reason: "Use Item" }))) return;
              await breakAimChainIfPresent();
              await applyAlchemyToTarget(actor, item, targetItem);
              return;
            }

            if (isAlchemyProduct && alchemyKind === "potion") {
              if (!(await spendActionPoints(actor, 1, { reason: "Use Item" }))) return;
              await breakAimChainIfPresent();
              await drinkPotion(actor, item);
              return;
            }

            // Default consumable flow (non-alchemy): spend AP and post a card.
            if (!(await spendActionPoints(actor, 1, { reason: "Use Item" }))) return;
            await breakAimChainIfPresent();
            await postActionCard("Use Item", `<p>${item.name}</p>`);
          }
        },
        no: { label: "Cancel" },
        defaultButton: "yes"
      });
    }

    case "reload-weapon": {
      event.preventDefault();
      if (!(await ensureTurnActionAllowed("reload-weapon"))) return;

      const rangedWeapon = actor.items.find(i =>
        i.type === "weapon" &&
        i.system?.equipped === true &&
        getWeaponCombatCapabilities(i).requiresReload
      );

      if (!rangedWeapon) {
        ui.notifications.warn("No equipped ranged weapon to reload.");
        return;
      }

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

      const powerDrawReduction = Math.max(0, Math.trunc(_num(await applyPowerDrawBonus(actor, rangedWeapon), 0)));
      const hasRapidReload = hasTalent(actor, "rapidreload") || hasTalent(actor, "dualrapidreloadfighter");
      const talentReloadReduction = hasRapidReload ? 1 : 0;
      // Reload 0 = free (RAW: Power Draw reduces by 1; reaching 0 means the reload is free).
      const effectiveReloadCost = Math.max(0, reloadCost - powerDrawReduction - talentReloadReduction);
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
        if (powerDrawReduction > 0) reductionParts.push(`Power Draw -${powerDrawReduction}`);
        if (talentReloadReduction > 0) reductionParts.push(`Rapid Reload -${talentReloadReduction}`);
        const reductionNote = reductionParts.length ? `<p class="u-text-muted u-text-sm">${reductionParts.join(", ")} applied to base cost ${reloadCost}</p>` : "";

        const options = Array.from({ length: maxSpendable }, (_, i) => i + 1)
          .map(n => `<option value="${n}"${n === maxSpendable ? " selected" : ""}>${n} AP${n >= remaining ? " (completes reload)" : ""}</option>`)
          .join("");

        apToSpend = await customDialog({
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

      const numericSpend = isFreeReload
        ? 0
        : Math.max(0, Math.min(Math.trunc(_num(apToSpend, 0)), enforceActionEconomy ? currentAP : remaining, remaining));
      const newAP = (isFreeReload || !enforceActionEconomy) ? currentAP : Math.max(0, currentAP - numericSpend);
      const newProgress = isFreeReload ? 0 : Math.max(0, currentProgress + numericSpend);
      const reloadComplete = isFreeReload || newProgress >= effectiveReloadCost;

      if (enforceActionEconomy && !isFreeReload) {
        await requestUpdateDocument(actor, { "system.action_points.value": newAP });
      }

      if (reloadComplete) {
        await requestUpdateDocument(rangedWeapon, {
          "system.reloadState.isLoaded": true,
          "system.reloadState.reloadProgress": 0,
        });
      } else {
        await requestUpdateDocument(rangedWeapon, {
          "system.reloadState.reloadProgress": newProgress,
        });
      }

      const powerDrawNote = powerDrawReduction > 0 ? `<p><em>Power Draw bonus: -${powerDrawReduction} AP</em></p>` : "";
      const talentNote = talentReloadReduction > 0 ? `<p><em>Rapid Reload: -${talentReloadReduction} AP</em></p>` : "";
      const remainingNeeded = Math.max(0, remaining - numericSpend);
      const statusLine = reloadComplete
        ? `<p><strong>${rangedWeapon.name} is now loaded!</strong></p>`
        : `<p>Reload progress: <strong>${newProgress} / ${effectiveReloadCost} AP</strong> spent. ${remainingNeeded} AP still needed.</p>`;

      await ChatMessage.create({
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
              <p><em>AP Spent: ${isFreeReload ? "Free" : numericSpend}</em></p>
              ${powerDrawNote}${talentNote}
              ${statusLine}
              <p>Remaining AP: ${newAP}</p>
            </div>
          </div>
        `,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });

      ui.notifications.info(reloadComplete
        ? `${rangedWeapon.name} fully reloaded.`
        : `Spent ${numericSpend} AP toward reloading ${rangedWeapon.name} (${newProgress}/${effectiveReloadCost}).`
      );
      return;
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
      await launchInCloseAction();
      return;
    }

    default:
      return;
  }
});
