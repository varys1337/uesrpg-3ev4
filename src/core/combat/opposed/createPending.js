/**
 * src/core/combat/opposed/createPending.js
 * Create pending opposed workflow
 */

import { safeUpdateChatMessage } from "../../../utils/chat-message-socket.js";
import { _resolveDoc, _resolveActor, _resolveToken, _resolveItemViaActor } from "./helpers/docs.js";
import { getPreferredWeaponUuid as _getPreferredWeaponUuid, inferAttackModeFromPreferredWeapon as _inferAttackModeFromPreferredWeapon } from "./helpers/workflow.js";
import { _renderCard } from "./render.js";
import { _findEnabledEffectByUesrpgKey, _logDebug } from "./helpers/util.js";
import { buildRollContext } from "../../rules/roll-context.js";
import { applyHybridPendingState, getCombatDomain, prepareHybridPendingData } from "./hybrid.js";
import { createAttackTraceId } from "../attack-tracker-diagnostics.js";
import { resolveCombatantForActor } from "../../../utils/document-resolution.js";

export async function createPending(cfg = {}) {
    const aDoc = _resolveDoc(cfg.attackerTokenUuid) ?? _resolveDoc(cfg.attackerActorUuid) ?? _resolveDoc(cfg.attackerUuid);
    const aToken = _resolveToken(aDoc);
    const attacker = _resolveActor(aDoc);

    const defenderRefs = [];
    const addDefenderRef = (ref) => {
      if (!ref) return;
      if (typeof ref === "string") defenderRefs.push(ref);
      else if (ref?.uuid) defenderRefs.push(ref.uuid);
    };

    if (Array.isArray(cfg.defenders)) {
      for (const def of cfg.defenders) {
        addDefenderRef(def?.tokenUuid ?? def?.actorUuid ?? def?.uuid ?? def);
      }
    }
    if (Array.isArray(cfg.defenderTokenUuids)) {
      for (const ref of cfg.defenderTokenUuids) addDefenderRef(ref);
    }
    if (Array.isArray(cfg.defenderActorUuids)) {
      for (const ref of cfg.defenderActorUuids) addDefenderRef(ref);
    }
    addDefenderRef(cfg.defenderTokenUuid ?? cfg.defenderActorUuid ?? cfg.defenderUuid);

    const defenderEntries = [];
    const seen = new Set();
    for (const ref of defenderRefs) {
      const dDoc = _resolveDoc(ref);
      const dToken = _resolveToken(dDoc);
      const dActor = _resolveActor(dDoc);
      if (!dActor) continue;
      const key = dToken?.document?.uuid ?? dToken?.uuid ?? dActor.uuid;
      if (seen.has(key)) continue;
      seen.add(key);

      defenderEntries.push({
        actorUuid: dActor.uuid,
        tokenUuid: dToken?.document?.uuid ?? null,
        combatantId: resolveCombatantForActor(game?.combat ?? null, dActor, {
          tokenUuid: dToken?.document?.uuid ?? dToken?.uuid ?? null,
          actorUuid: dActor.uuid,
          combatId: game?.combat?.id ?? null
        })?.id ?? null,
        tokenName: dToken?.name ?? null,
        name: dActor.name,
        label: null,
        testLabel: null,
        defenseLabel: null,
        target: null,
        defenseType: null,
        result: null,
        noDefense: false,
        banked: { committed: false, committedAt: null, committedBy: null },
        tn: null,
        outcome: null,
        advantage: null
      });
    }

    if (!attacker || defenderEntries.length === 0) {
      ui.notifications.warn("Opposed test requires both an attacker and at least one defender (token or actor).");
      return null;
    }

    const defenderActors = defenderEntries.map((entry) => _resolveActor(entry.actorUuid)).filter(Boolean);
    const hybridInfo = prepareHybridPendingData(attacker, defenderActors, cfg);
    if (hybridInfo?.error) {
      ui.notifications.warn(hybridInfo.error);
      return null;
    }

    // Chapter 5 (Defensive Stance): Attack limit reduced to 0 until next Turn.
    // Prevent creating a pending attack when Defensive Stance is active.
    if (String(cfg.mode ?? "attack") === "attack" && _findEnabledEffectByUesrpgKey(attacker, "defensiveStance")) {
      ui.notifications.warn("Defensive Stance is active: you cannot attack until your next Turn.");
      return null;
    }

    const baseTarget = Number(cfg.attackerTarget ?? 0);

    // Seed the opposed context with a weapon UUID.
    //
    // Default behavior: use the attacker's preferred equipped weapon.
    // Override behavior (cfg.weaponUuid): used by sheet quick-actions to ensure
    // the pending card reflects the clicked weapon and that the Declare dialog
    // preselects the correct weapon.
    //
    // This is required for deterministic range band TN modifiers and weapon-quality gating
    // (e.g., Flail) during DefenseDialog, before any damage-resolution step.
    let seededWeaponUuid = "";
    if (cfg.weaponUuid) {
      try {
        const w = _resolveItemViaActor(cfg.weaponUuid, attacker);
        if (w && w.documentName === "Item" && w.type === "weapon") {
          seededWeaponUuid = w.uuid;
        }
      } catch (_e) {
        seededWeaponUuid = "";
      }
    }
    if (!seededWeaponUuid) seededWeaponUuid = _getPreferredWeaponUuid(attacker, { meleeOnly: false }) || "";
    const seededAttackMode = cfg.attackMode ? String(cfg.attackMode) : await _inferAttackModeFromPreferredWeapon(attacker);

    const isAoE = Boolean(cfg?.aoe?.isAoE || cfg?.context?.aoe?.isAoE || cfg?.isAoE);
    const isFollowUpStrike = Boolean(cfg?.followUpStrike);
    const isReactionAttack = Boolean(cfg?.isReactionAttack);
    const skipApDeduction = Boolean(cfg?.skipAttackerAPDeduction || isFollowUpStrike);
    const skipAttackCountIncrement = Boolean(cfg?.skipAttackCountIncrement || isFollowUpStrike);
    const isFreeActionAttack = Boolean(cfg?.isFreeActionAttack || isFollowUpStrike);
    const rollContext = buildRollContext({
      actor: attacker,
      targetActor: defenderEntries[0]?.actorUuid ? _resolveActor(defenderEntries[0].actorUuid) : null,
      testType: "attack",
      attackMode: seededAttackMode || "melee"
    });

    const data = {
        context: {
          attackTraceId: String(cfg?.attackTraceId ?? "").trim() || createAttackTraceId("opposed"),
          schemaVersion: 1,
          createdAt: Date.now(),
          createdBy: game.user.id,
          updatedAt: Date.now(),
          updatedBy: game.user.id,
          phase: 'pending',
          waitingSince: null,
          weaponUuid: seededWeaponUuid || null,
          attackMode: seededAttackMode || "melee",
          forcedHitLocation: isAoE ? "Body" : (cfg.forcedHitLocation ?? null),
          aoe: cfg?.aoe ? foundry.utils.deepClone(cfg.aoe) : undefined,
          isAoE: cfg?.isAoE ?? undefined,
          activation: cfg.activation ?? null,
          activationPrepaidBaseAttackAP: Boolean(cfg?.activationPrepaidBaseAttackAP),
          skipAttackerAPDeduction: skipApDeduction,
          skipAttackCountIncrement,
          isFreeActionAttack,
          isReactionAttack,
            followUpStrike: isFollowUpStrike
              ? {
                  active: true,
                  penalty: -20,
                  freeAttack: true,
                  ignoresRoundLimit: Boolean(cfg?.followUpStrikeIgnoresRoundLimit ?? true),
                  sourceWeaponUuid: cfg?.followUpStrikeSourceWeaponUuid ?? null
                }
              : undefined,
          bankChoicesEnabled: true,
          rollContext,
          rollOptions: Array.isArray(rollContext?.rollOptions) ? rollContext.rollOptions.slice() : [],
          autoRollRequested: false,
        autoRollRequestedAt: null,
        autoRollRequestedBy: null,
        autoRollStarted: false,
        autoRollStartedAt: null,
        autoRollStartedBy: null
      },
      status: "pending",
      mode: cfg.mode ?? "attack",
      attacker: {
        actorUuid: attacker.uuid,
        tokenUuid: aToken?.document?.uuid ?? null,
        combatantId: resolveCombatantForActor(game?.combat ?? null, attacker, {
          tokenUuid: aToken?.document?.uuid ?? aToken?.uuid ?? null,
          actorUuid: attacker.uuid,
          combatId: game?.combat?.id ?? null
        })?.id ?? null,
        tokenName: aToken?.name ?? null,
        name: attacker.name,
        combatDomain: getCombatDomain(attacker),
        label: cfg.attackerLabel ?? "Attack",
        itemUuid: cfg.attackerItemUuid ?? cfg.itemUuid ?? null,
        baseTarget,
        hasDeclared: false,
        banked: { committed: false, committedAt: null, committedBy: null },
        variant: "normal",
        variantMod: 0,
        manualMod: 0,
        totalMod: 0,
        target: baseTarget,
        tn: null,
        result: null
      },
      defender: defenderEntries[0] ?? {},
      defenders: defenderEntries,
      outcome: null
    };

    applyHybridPendingState(data, hybridInfo);
    if (hybridInfo?.enabled && hybridInfo.defenderDomain === "warfare" && defenderActors[0]) {
      const holdActive = Boolean(defenderActors[0]?.effects?.find?.((effect) =>
        !effect?.disabled && effect?.flags?.uesrpg?.key === "holdNextDefend"
      ));
      data.defender.hybrid = {
        ...(data.defender.hybrid ?? {}),
        holdActive,
      };
      if (Array.isArray(data.defenders) && data.defenders[0]) {
        data.defenders[0].hybrid = {
          ...(data.defenders[0].hybrid ?? {}),
          holdActive,
        };
      }
    }

    const message = await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: attacker, token: aToken?.document ?? null }),
      content: _renderCard(data, ""),
      flags: { "uesrpg-3ev4": { opposed: data } }
    });

    await safeUpdateChatMessage(message, { content: _renderCard(data, message.id) });

    _logDebug("createPending", {
      messageId: message.id,
      attackerUuid: data.attacker.actorUuid,
      defenderUuid: data.defender.actorUuid,
      mode: data.mode
    });

    return message;
  }
