/**
 * @file Attacker action handler for opposed workflow
 * Handles attacker-roll, attacker-commit, and attacker-roll-committed actions
 */

import { canAttackerRoll, markAttackFromHidden, applyPostAttackState, markDefenderIneligibleForHidden } from "./eligibility.js";
import { doTestRoll } from "../../../../utils/degree-roll-helper.js";
import { ensureBurningTurnActionAllowed } from "../../../conditions/condition-engine.js";
import { hasTalent } from "../../../traits/talents-api.js";
import { listCombatStyles, computeTN, variantMod as computeVariantMod } from "../../tn.js";
import { applyCombatTalentDoSAdjustments, applyAttackerTalentPreTN } from "../../../traits/combat-talents.js";
import { applyRacialTalentAttackPreTN } from "../../../traits/racial-talents.js";
import { applyWeaponExpertiseAttackerPreTN } from "../../../traits/weapon-expertise/index.js";
import { AttackTracker } from "../../attack-tracker.js";
import { ActionEconomy } from "../../action-economy.js";
import { isActorSkeletal } from "../../../traits/trait-registry.js";
import { applyDamageResolved } from "../../damage-resolver.js";
import { getAttackModeFromWeapon, getDamageTypeFromWeapon, getHitLocationFromRoll, resolveHitLocationForTarget } from "../../combat-utils.js";

// Internal helpers from various opposed modules
import { _canControlActor, _emitSuppressedSubRollDice, _findEnabledEffectByUesrpgKey, _logDebug, _opposedFlags, _safeGetSetting } from "../helpers/util.js";
import { _resolveItemViaActor } from "../helpers/docs.js";
import { _getBankCommitState, _allDefendersCommitted, _getDefenderEntries } from "../banking/state.js";
import { 
  collectSensorySituationalMods as _collectSensorySituationalMods,
  weaponHasQuality as _weaponHasQuality,
  getPreferredWeaponUuid as _getPreferredWeaponUuid,
  getTokenMovementAction as _getTokenMovementAction,
  getContextAttackMode,
  inferAttackModeFromPreferredWeapon as _inferAttackModeFromPreferredWeapon,
  preConsumeAttackAmmo as _preConsumeAttackAmmo
} from "../helpers/workflow.js";
import { _variantLabel, _circumstanceLabel } from "../render.js";
import { 
  _getUnstoppableMightWeaponEligibility,
  _promptUnstoppableMightUsage,
  _maybeApplyMightyCleave,
  _maybeEnableFollowUpStrike
} from "../helpers/talents.js";
import { attackerDeclareDialog as _attackerDeclareDialog } from "../dialogs/attacker.js";
import { 
  computeRangedRangeContext as _computeRangedRangeContext,
  computeMeleeReachContext as _computeMeleeReachContext
} from "../helpers/combat.js";
import {
  consumeOneShotAdvantageEffects as _consumeOneShotAdvantageEffects,
  consumeInspireHeroismEffect as _consumeInspireHeroismEffect,
  consumeOrBreakAimAfterAttack as _consumeOrBreakAimAfterAttack,
  consumeHiddenAfterAttack as _consumeHiddenAfterAttack
} from "../effects.js";
import { markWeaponNeedsReload as _markWeaponNeedsReload } from "../damage/ammunition.js";
import { rollWeaponDamage as _rollWeaponDamage } from "../damage/roller.js";
import { applyRuntimePreRollToTN, applyRuntimePostRollToResult } from "../../../traits/features/rule-element-runtime.js";
import { applyLengthPenaltyToTN } from "../../../homebrew/reach-length/weapon.js";
import { cloneFlagState } from "../../../../utils/clone.js";
import { commitLaneToFreshCardState } from "../../../opposed/shared/fresh-commit.js";
import { maybeHandleUnusualCombatAttackFailure } from "../../unusual-combat.js";

/** @private — Clone current opposed flag state from a live message for lane-commit merging. */
function _readCombatOpposedFlagState(fm) {
  const raw = fm?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
  return raw ? cloneFlagState(raw) : null;
}

/**
 * Handle attacker actions: roll, commit, or roll-committed
 * @param {string} action - One of: "attacker-roll", "attacker-commit", "attacker-roll-committed"
 * @param {object} ctx - Context object containing workflow state
 * @param {ChatMessage} ctx.message - The opposed card message
 * @param {object} ctx.data - The opposed workflow data (message.flags.uesrpg-3ev4.opposed)
 * @param {Actor} ctx.attacker - The attacking actor
 * @param {Actor} ctx.defender - The defending actor (primary defender)
 * @param {object} ctx.defenderData - The defender's data structure from ctx.data.defenders[0]
 * @param {number} ctx.defenderIndex - Index of the primary defender in ctx.data.defenders array
 * @param {object[]} ctx.defenders - All defender data structures (ctx.data.defenders)
 * @param {boolean} ctx.isMulti - Whether this is a multi-defender opposed test
 * @param {Token} ctx.aToken - Attacker token (may be null)
 * @param {Token} ctx.dToken - Primary defender token (may be null)
 * @param {boolean} ctx.bankMode - Whether banked-choice mode is enabled
 * @param {boolean} ctx.isAoE - Whether this is an area-of-effect attack
 * @param {object} ctx.opts - Additional options passed to the workflow
 */
export async function handleAttackerAction(action, ctx) {
  const { message, data, attacker, defender, defenderData, defenderIndex, defenders, isMulti, aToken, dToken, bankMode, isAoE, batchedUpdate, opts, _updateCard } = ctx;

  const isCommit = action === "attacker-commit";
  const isRollCommitted = action === "attacker-roll-committed";

  if (data.attacker.result) return;

  if (isCommit && !bankMode) {
    ui.notifications.warn("Banked choices are not enabled for this opposed test.");
    return;
  }

  if (!_canControlActor(attacker)) {
    ui.notifications.warn("You do not have permission to roll for the attacker.");
    return;
  }

  const bank = bankMode ? _getBankCommitState(data, data.defender) : null;
  if (isRollCommitted) {
    if (!bankMode) {
      ui.notifications.warn("Banked choices are not enabled for this opposed test.");
      return;
    }
    if (!bank?.bothCommitted) {
      ui.notifications.warn("Both sides must commit their choices before rolling.");
      return;
    }
    if (!data.attacker.hasDeclared || !Number.isFinite(Number(data.attacker.target))) {
      ui.notifications.warn("Attacker has not committed an attack declaration yet.");
      return;
    }
  }

  // Eligibility checks (Restrained, Defensive Stance, etc.)
  const attackerEligibility = canAttackerRoll(attacker, data.context);
  if (!attackerEligibility?.allowed) {
    ui.notifications.warn(`${attacker.name} cannot attack${attackerEligibility?.reason ? ` (${attackerEligibility.reason})` : ""}.`);
    return;
  }

  if (!data?.context?.isReactionAttack) {
    const burningGate = await ensureBurningTurnActionAllowed(attacker, { actionId: "attack" });
    if (!burningGate.allowed) {
      ui.notifications.warn(`${attacker.name} fails to act while burning.`);
      return;
    }
  }

  // Banked commit preflight gate:
  // - Do not offer/accept dead commits when base AP is unavailable.
  // - Do not allow commit when attack limit is already reached this round.
  if (isCommit && game.combat) {
    const baseApCost = (String(data.mode ?? "attack") === "attack" && !data?.context?.isFreeActionAttack) ? 1 : 0;
    const currentAP = Number(foundry.utils.getProperty(attacker, "system.action_points.value") ?? 0);
    if (currentAP < baseApCost) {
      ui.notifications.warn(`Not enough Action Points to commit attack (${currentAP}/${baseApCost}).`);
      return;
    }

    try {
      if (AttackTracker.hasExceededLimit(attacker, { attackMode: String(data?.context?.attackMode ?? "").toLowerCase() })) {
        const warning = AttackTracker.getLimitWarning(attacker, { attackMode: String(data?.context?.attackMode ?? "").toLowerCase() })
          || "Attack limit reached for this round.";
        ui.notifications.warn(warning);
        return;
      }
    } catch (err) {
      console.warn("UESRPG | Attack limit commit check failed", err);
    }
  }

  let decl = null;
  let pendingApCost = Number(data.attacker?.pendingApCost ?? 0) || 0;

  const ensureCommittedAttackerState = () => {
    data.attacker = data.attacker ?? {};
    const tn = (data.attacker?.tn && typeof data.attacker.tn === "object") ? data.attacker.tn : null;
    const target = Number(tn?.finalTN ?? data.attacker?.target ?? NaN);
    if (!Number.isFinite(target)) return false;

    data.attacker.hasDeclared = true;
    data.attacker.variant = String(data.attacker?.variant ?? "normal");
    data.attacker.variantLabel = data.attacker.variantLabel ?? _variantLabel(data.attacker.variant);
    data.attacker.variantMod = Number(data.attacker?.variantMod ?? computeVariantMod(data.attacker.variant) ?? 0) || 0;
    data.attacker.baseTarget = Number(tn?.baseTN ?? data.attacker?.baseTarget ?? 0) || 0;
    data.attacker.totalMod = Number(tn?.totalMod ?? data.attacker?.totalMod ?? (target - data.attacker.baseTarget)) || 0;
    data.attacker.target = target;
    data.attacker.tn = tn ?? {
      finalTN: target,
      baseTN: data.attacker.baseTarget,
      totalMod: data.attacker.totalMod,
      breakdown: []
    };
    return true;
  };

  if (!isRollCommitted) {
    // One dialog only: (optional) combat style selector + attack variant + manual modifier.
    const styles = listCombatStyles(attacker);
    const selectedStyleUuid = styles.find(s => s.uuid === data.attacker.itemUuid)?.uuid ?? styles[0]?.uuid ?? data.attacker.itemUuid ?? null;

    // Attack type is inferred from the currently preferred weapon (automatic; no manual override).
    data.context = data.context ?? {};
    data.context.attackMode = await _inferAttackModeFromPreferredWeapon(attacker);

    // Mark attack from hidden state
    markAttackFromHidden(data.context, attacker);

    decl = await _attackerDeclareDialog(attacker, data.attacker.label ?? "Attack", {
      styles,
      selectedStyleUuid,
      defaultWeaponUuid: data.context?.weaponUuid ?? null,
      defaultVariant: data.attacker.variant ?? "normal",
      defaultManual: data.attacker.manualMod ?? 0,
      defaultCirc: data.attacker.circumstanceMod ?? 0,
      attackerToken: aToken ?? null,
      defenderToken: dToken ?? null
    });
    if (!decl) return;

    // Persist the declared weapon selection into the opposed context for downstream automation
    // (range, traits, damage previews, etc.). This is a non-schema-breaking addition.
    data.context.weaponUuid = decl.weaponUuid || data.context.weaponUuid || null;
    if (data.context.weaponUuid) {
      data.context.lastWeaponUuid = data.context.weaponUuid;
    }
    const isAoEAttack = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
    if (String(decl.variant ?? "") === "precision") {
      data.context.forcedHitLocation = String(decl.precisionLocation ?? "Body");
    } else if (!isAoEAttack) {
      data.context.forcedHitLocation = null;
    }

    if (String(decl.variant ?? "") === "coup") {
      data.context.coupMode = String(decl.coupMode ?? "lethal").toLowerCase();
    }

    // Normalize attackMode from the explicitly selected weapon.
    let declaredWeapon = null;
    if (data.context.weaponUuid) {
      try {
        const w = _resolveItemViaActor(data.context.weaponUuid, attacker);
        if (w?.type === "weapon") {
          declaredWeapon = w;
          data.context.attackMode = String(getAttackModeFromWeapon(w) || "melee").toLowerCase();
        }
      } catch (_e) {
        // No-op; keep previously inferred mode.
      }
    }

    // Early gate: block unloaded ranged weapons before committing the attack.
    if (declaredWeapon && data.context.attackMode === "ranged") {
      const reloadState = declaredWeapon.system?.reloadState;
      if (reloadState?.requiresReload && !reloadState?.isLoaded) {
        ui.notifications.warn(`${declaredWeapon.name} must be reloaded before attacking.`);
        return;
      }
    }

    // Unstoppable Might (Chapter 4): prompt for special wield usage (explicit confirmation).
    data.context.unstoppableMight = null;
    if (declaredWeapon && hasTalent(attacker, "unstoppablemight")) {
      const attackMode = String(declaredWeapon.system?.attackMode ?? "melee").toLowerCase();
      const wCtx = _getUnstoppableMightWeaponEligibility(declaredWeapon);
      if (attackMode === "melee" && wCtx.eligible) {
        const useSpecial = await _promptUnstoppableMightUsage({ actorName: attacker.name, purpose: "attack" });
        data.context.unstoppableMight = { active: Boolean(useSpecial), weaponUuid: declaredWeapon.uuid };
      }
    }

    const attackerMovementAction = _getTokenMovementAction(aToken);

    // IMPORTANT: Do not spend AP until after we have produced a real roll message.
    // This prevents AP loss if the workflow fails before resolving the roll.
    // AP: any attack costs 1 AP; variant AP cost is additive (e.g., All Out Attack is +1 AP).
    const baseApCost = (String(data.mode ?? "attack") === "attack" && !data?.context?.isFreeActionAttack) ? 1 : 0;
    const extraApCost = Number(decl.apCost ?? 0) || 0;
    pendingApCost = baseApCost + extraApCost;

    // Thunder Charge (simplified): talent-driven dialog toggle waives All Out AP surcharge.
    try {
      if (String(decl.variant ?? "") === "allOut" && Boolean(decl.thunderChargeToggle) && hasTalent(attacker, "thundercharge")) {
        pendingApCost = Math.max(0, pendingApCost - 1);
        data.context = data.context ?? {};
        data.context.thunderCharge = {
          consumed: true,
          consumedAt: Date.now(),
          reason: "all-out-surcharge-waived",
          source: "dialog-toggle"
        };
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: attacker, token: aToken?.document ?? null }),
          content: `<div class="uesrpg"><b>Thunder Charge</b>: All Out surcharge waived for this attack.</div>`,
          style: CONST.CHAT_MESSAGE_STYLES.OTHER
        });
      }
    } catch (err) {
      console.warn("UESRPG | Thunder Charge application failed", err);
    }

    // If the attacker selected a different combat style, switch base TN + label now.
    if (decl.styleUuid && decl.styleUuid !== data.attacker.itemUuid) {
      const chosen = styles.find(s => s.uuid === decl.styleUuid) ?? null;
      if (chosen) {
        data.attacker.itemUuid = chosen.uuid;
        data.attacker.label = chosen.name;
      }
    }

    const manualMod = Number(decl.manualMod) || 0;
    const circumstanceMod = Number(decl.circumstanceMod) || 0;
    const situationalMods = _collectSensorySituationalMods(decl, attacker);

    // Follow-up Strike (Chapter 4): on a failed dual-wield attack, spend 1 SP to make a free follow-up
    // attack with the other weapon at -20, which does not count toward attacks per round.
    if (data?.context?.followUpStrike?.active) {
      situationalMods.push({
        key: "talent:followupstrike",
        label: "Follow-up Strike",
        value: -20,
        source: "talent"
      });
      data.context.isFreeActionAttack = true;
      data.context.skipAttackerAPDeduction = true;
      data.context.skipAttackCountIncrement = true;
    }

    // Range computation for ranged attacks.
    // Rules (Chapter 7): Close = +10, Medium = +0, Long = -20, beyond Long = cannot attack.
    // Reach computation for melee attacks.
    // RAW: weapons with a minimum reach (e.g., 2-3m) cannot attack targets closer than their minimum.
    // RAW: weapons cannot attack targets beyond their maximum reach.
    {
      let weapon = null;
      try {
        if (data.context.weaponUuid) weapon = _resolveItemViaActor(data.context.weaponUuid, attacker);
      } catch (_e) {
        weapon = null;
      }

      // Mighty Cleave (Chapter 4): optional second target for All Out Attack while wielding a weapon in two hands.
      // This must be selected at declaration time, rolls once, and each defender defends separately.
      if (String(data.context?.attackMode ?? "melee") === "melee") {
        await _maybeApplyMightyCleave({
          data,
          attacker,
          attackerToken: aToken,
          primaryDefenderToken: dToken,
          weapon,
          declaration: decl
        });
      }

      if (String(data.context?.attackMode ?? "melee") === "ranged") {
        const rangeCtx = _computeRangedRangeContext({ attackerToken: aToken, defenderToken: dToken, weapon });
        if (rangeCtx) {
          data.context.range = {
            ...rangeCtx,
            weaponUuid: weapon?.uuid ?? data.context?.weaponUuid ?? null
          };
          data.context.rangeTnMod = Number(rangeCtx.tnMod ?? 0) || 0;
          if (rangeCtx.outOfRange) {
            const wName = weapon?.name ? ` (${weapon.name})` : "";
            const rangeDetail = rangeCtx.long > 0
              ? `Distance ${Math.round(rangeCtx.distance)} > Long ${rangeCtx.long}.`
              : `Distance ${Math.round(rangeCtx.distance)} > Medium ${rangeCtx.medium} (no long range).`;
            ui.notifications.warn(`Target is out of range${wName}. ${rangeDetail}`);
            return;
          }
          // Range TN mod is applied inside computeTN() via context.rangeContext — no situationalMods push needed.
        }
      }

      if (String(data.context?.attackMode ?? "melee") === "melee") {
        const reachCtx = _computeMeleeReachContext({ attackerToken: aToken, defenderToken: dToken, weapon });
        if (reachCtx) {
          data.context.reach = reachCtx;
          if (!reachCtx.inRange) {
            const wName = weapon?.name ? ` (${weapon.name})` : "";
            const d = reachCtx.distance == null ? "?" : Math.round(reachCtx.distance * 10) / 10;
            if (reachCtx.reason === "too-close") {
              ui.notifications.warn(`Target is too close${wName}. Distance ${d} < Min Reach ${reachCtx.min}.`);
              return;
            }
            if (reachCtx.reason === "too-far") {
              ui.notifications.warn(`Target is out of reach${wName}. Distance ${d} > Reach ${reachCtx.max}.`);
              return;
            }
          }
        }
      }
    }
      if (String(data.context?.attackMode ?? "melee") === "ranged" && defender && isActorSkeletal(defender)) {
        situationalMods.push({ key: "skeletal", label: "Skeletal (ranged)", value: -20 });
      }

      // Hard Target (Chapter 4): ranged attacks against this defender suffer -20 until the start of their next turn.
      if (String(data.context?.attackMode ?? "melee") === "ranged" && defender && _findEnabledEffectByUesrpgKey(defender, "hardTarget")) {
        situationalMods.push({ key: "talent:hardtarget", label: "Hard Target", value: -20, source: "talent" });
      }

    // Combat talent: Precise (cancel Precision Strike penalty).
    // This is implemented as a +20 situational modifier when the attacker chose the
    // precision variant and has the Precise talent.
    applyAttackerTalentPreTN({ attacker, declaration: decl, situationalMods });
    applyRacialTalentAttackPreTN({ attacker, declaration: decl, situationalMods });

    // Weapon Expertise pre-TN modifiers (Executioner AoA bonus, Viper's Eye precision).
    applyWeaponExpertiseAttackerPreTN({ attacker, declaration: decl, situationalMods, weapon: declaredWeapon });

    const tn = computeTN({
      actor: attacker,
      role: "attacker",
      styleUuid: data.attacker.itemUuid,
      variant: decl.variant,
      manualMod,
      circumstanceMod,
      situationalMods,
      context: {
        opponentUuid: defender?.uuid ?? null,
        opponentActor: defender ?? null,
        opponentSize: defender?.system?.size ?? null,
        attackMode: data.context?.attackMode ?? "melee",
        itemUuid: data.context?.weaponUuid ?? null,
        selfSize: attacker?.system?.size ?? null,
        movementAction: attackerMovementAction,
        // Range band context — consumed inside computeTN() to add the range TN entry to breakdown.
        rangeContext: data.context?.range ?? null
      }
    });
    data.context = data.context ?? {};
    data.context.attackerMovementAction = attackerMovementAction || null;

    const finalTN = tn.finalTN;
    const totalMod = tn.totalMod;
    const vMod = computeVariantMod(decl.variant);

    data.attacker.hasDeclared = true;
    data.attacker.variant = decl.variant;
    data.attacker.variantLabel = _variantLabel(decl.variant);
    data.attacker.variantMod = vMod;
    data.attacker.manualMod = manualMod;
    data.attacker.circumstanceMod = circumstanceMod;
    data.attacker.circumstanceLabel = _circumstanceLabel(circumstanceMod);
    data.attacker.totalMod = totalMod;
    data.attacker.baseTarget = tn.baseTN;
    data.attacker.target = finalTN;
    data.attacker.tn = tn;
    data.attacker.pendingApCost = pendingApCost;
    data.attacker.pendingApVariant = decl.variant;

    // ── Homebrew: Reach & Length — LP injection (attacker side) ──────────────
    if (
      String(data.context?.attackMode ?? "melee").toLowerCase() === "melee"
      && declaredWeapon?.type === "weapon"
      && String(declaredWeapon?.system?.attackMode ?? "melee").toLowerCase() === "melee"
    ) {
      let defenderWeaponForLP = null;
      try {
        for (const item of (defender?.items ?? [])) {
          if (item.type !== "weapon") continue;
          if (!item.system?.equipped) continue;
          if (String(item.system?.attackMode ?? "").toLowerCase() === "melee") {
            defenderWeaponForLP = item;
            break;
          }
        }
      } catch (_e) { /* no-op */ }
      const lpApplied = applyLengthPenaltyToTN({
        tn,
        ownWeapon: declaredWeapon,
        opponentWeapon: defenderWeaponForLP,
        ownerToken: aToken ?? null,
        opponentToken: dToken ?? null,
        ownerActor: attacker ?? null,
        ownRole: "attacker"
      });
      if (lpApplied) {
        data.attacker.target = tn.finalTN;
        data.attacker.totalMod = tn.totalMod;
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    _logDebug("attackerDeclare", {
      attackerUuid: data.attacker.actorUuid,
      defenderUuid: data.defender.actorUuid,
      attackVariant: data.attacker.variant,
      tn
    });

    // Banked-choice mode: stop after declaration; do not roll until both sides have committed.
    if (isCommit) {
      data.attacker.banked = data.attacker.banked ?? {};
      data.attacker.banked.committed = true;
      data.attacker.banked.committedAt = Date.now();
      data.attacker.banked.committedBy = game.user.id;

      // Chapter 5 (Hidden): enemies cannot defend against attacks made by hidden characters.
      // To avoid deadlocks in banked mode, force the defender lane to No Defense immediately.
      if (data.context?.attackFromHidden === true) {
        for (const def of defenders) {
          markDefenderIneligibleForHidden(def);
        }
      }

      // Auto-request GM roll when ALL participants have committed (banking workflow)
      const b = _getBankCommitState(data, data.defender);
      if (b.bothCommitted && _allDefendersCommitted(data)) {
        data.context = data.context ?? {};
        if (!data.context.autoRollRequested) {
          data.context.autoRollRequested = true;
          data.context.autoRollRequestedAt = Date.now();
          data.context.autoRollRequestedBy = game.user.id;
        }
      }

      // Fresh-state re-read: apply only attacker lane + context onto live state to preserve
      // any defender-side commit that arrived while the dialog was open.
      await commitLaneToFreshCardState({
        message,
        readState: _readCombatOpposedFlagState,
        mutate: (_t) => {
          _t.attacker = foundry.utils.mergeObject(_t.attacker ?? {}, data.attacker, { overwrite: true, insertKeys: true });
          _t.context = foundry.utils.mergeObject(_t.context ?? {}, data.context, { overwrite: true, insertKeys: true });
          if (data.context?.attackFromHidden === true && Array.isArray(data.defenders) && Array.isArray(_t.defenders)) {
            for (let _di = 0; _di < data.defenders.length; _di++) {
              if (_t.defenders[_di] && data.defenders[_di]) {
                _t.defenders[_di] = foundry.utils.mergeObject(_t.defenders[_di], data.defenders[_di], { overwrite: true, insertKeys: true });
              }
            }
          }
        },
        updateCard: _updateCard,
        fallbackData: data,
      });

      // Auto-roll is triggered by the updateChatMessage hook → maybeAutoRollBanked.
      // No direct _autoRollBanked call needed here.

      return;
    }
  }

  if (isRollCommitted && !ensureCommittedAttackerState()) {
    ui.notifications.warn("Attacker has not committed an attack declaration yet.");
    return;
  }

  // At this point we are rolling (either standard workflow or banked roll).
  let finalTN = Number(data.attacker.target ?? 0) || 0;
  const attackerTn = (data.attacker?.tn && typeof data.attacker.tn === "object")
    ? data.attacker.tn
    : { finalTN };
  const runtimeWeapon = (() => {
    const weaponUuid = String(data?.context?.weaponUuid ?? "").trim();
    if (!weaponUuid) return null;
    try {
      const doc = _resolveItemViaActor(weaponUuid, attacker);
      return doc?.documentName === "Item" ? doc : null;
    } catch (_e) {
      return null;
    }
  })();

  applyRuntimePreRollToTN({
    actor: attacker,
    targetActor: defender ?? null,
    targetToken: dToken ?? null,
    item: runtimeWeapon,
    rollContext: data?.context?.rollContext,
    workflow: "combat",
    side: "attacker",
    attackMode: String(data?.context?.attackMode ?? ""),
    attackVariant: String(data?.attacker?.variant ?? ""),
    tn: attackerTn
  });
  data.attacker.tn = attackerTn;
  finalTN = Number(attackerTn?.finalTN ?? finalTN) || finalTN;
  data.attacker.target = finalTN;

  // Re-sync flat display fields so the card renderer shows the RE-adjusted TN.
  // The renderer computes `finalA = baseTarget + totalMod` for the TN header; without
  // this sync, it reads the stale pre-RE values set during the declaration phase.
  data.attacker.totalMod = Number(attackerTn?.totalMod ?? data.attacker.totalMod ?? 0);
  data.attacker.baseTarget = Number(attackerTn?.baseTN ?? data.attacker.baseTarget ?? 0);

  // Attack-per-round gating (RAW + talent/GM overrides via AttackTracker).
  // Baseline: 2 attacks per round.
  // Dual Wielder / Dual Fighter: passive max 3.
  // GM may override current/max on the sheet.
  try {
    const attackModeNow = String(data?.context?.attackMode ?? "").toLowerCase();

    // Resolve current weapon to an embedded Item id for attack-cap context.
    let weaponIdNow = "";
    const weaponUuidNow = String(data?.context?.weaponUuid ?? "").trim();
    if (weaponUuidNow) {
      try {
        const w = _resolveItemViaActor(weaponUuidNow, attacker);
        if (w?.documentName === "Item") weaponIdNow = String(w.id);
      } catch (_e) {
        weaponIdNow = "";
      }
    }

    const limit = AttackTracker.getAttackLimit(attacker, {
      attackMode: attackModeNow,
      weaponId: weaponIdNow
    });
    const count = AttackTracker.getAttackCount(attacker);
    if (count >= limit) {
      const warning = AttackTracker.getLimitWarning(attacker, {
        attackMode: attackModeNow,
        weaponId: weaponIdNow
      });
      if (warning) ui.notifications?.warn?.(warning);
      return;
    }
  } catch (err) {
    console.warn("UESRPG | Attack limit check failed", err);
  }

  // Consume ammunition at attack time (per system rules and project direction).
  // Hard requirement: ranged (non-thrown) attacks must have ammo even if no damage card is ever produced.
  const ammoOk = await _preConsumeAttackAmmo(attacker, data);
  if (!ammoOk) return;

  // Mark weapon as needing reload immediately after successful ammunition consumption (ranged attacks only).
  // This ensures reload state is properly tracked before the attack roll executes.
  const attackMode = getContextAttackMode(data?.context);
  if (attackMode === "ranged") {
    try {
      // Weapon UUID priority: preConsumedAmmo (cached) > context (declared) > preferred (equipped)
      const weaponUuid = (data.attacker?.preConsumedAmmo?.weaponUuid 
        ?? String(data?.context?.weaponUuid ?? "")) 
        || _getPreferredWeaponUuid(attacker, { meleeOnly: false }) 
        || "";
      if (weaponUuid) {
        const weapon = _resolveItemViaActor(weaponUuid, attacker);
        if (weapon && weapon.type === "weapon") {
          await _markWeaponNeedsReload(weapon);
        }
      }
    } catch (err) {
      console.warn("UESRPG | Failed to mark weapon as needing reload after attack", err);
    }
  }

  // Perform a real Foundry roll + message so Dice So Nice triggers.
  const res = await doTestRoll(attacker, { rollFormula: "1d100", target: finalTN, allowLucky: true, allowUnlucky: true });

  // Combat talents: post-roll DoS adjustments (bonus DoS / skill-rank replacement prompts).
  // Run before posting the roll message so we can propagate the choice to the banking path.
  try {
    const adj = await applyCombatTalentDoSAdjustments({
      attacker,
      defender,
      attackerToken: aToken,
      defenderToken: dToken,
      side: "attacker",
      result: res,
      defenseType: "",
      styleUuid: data.attacker.itemUuid ?? null,
      testLabel: data.attacker.label ?? data.attacker.testLabel ?? null,
      weaponUuid: data?.context?.weaponUuid ?? null,
      allowPrompt: true
    });
    if (Array.isArray(adj?.notes) && adj.notes.length) {
      res.talentNotes = adj.notes;
    }
  } catch (err) {
    console.warn("UESRPG | combat talent DoS adjustment (attacker) failed", err);
  }

  await applyRuntimePostRollToResult({
    actor: attacker,
    targetActor: defender ?? null,
    targetToken: dToken ?? null,
    item: runtimeWeapon,
    rollContext: data?.context?.rollContext,
    workflow: "combat",
    side: "attacker",
    attackMode: String(data?.context?.attackMode ?? ""),
    attackVariant: String(data?.attacker?.variant ?? ""),
    testLabel: String(data?.attacker?.label ?? ""),
    result: res,
    allowPrompt: true
  });

  const postSubRolls = _safeGetSetting("uesrpg-3ev4", "opposedPostSubRollMessages", true);
  if (postSubRolls) {
    await res.roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: attacker, token: aToken?.document ?? null }),
      flavor: `${data.attacker.label} \u2014 Attacker Roll`,
      rollMode: game.settings.get("core", "rollMode"),
      flags: _opposedFlags(message.id, "attacker-roll", {
        commit: {
          attacker: {
            hasDeclared: true,
            variant: data.attacker.variant,
            variantLabel: data.attacker.variantLabel,
            variantMod: data.attacker.variantMod,
            manualMod: data.attacker.manualMod,
            circumstanceMod: data.attacker.circumstanceMod,
            circumstanceLabel: data.attacker.circumstanceLabel,
            totalMod: data.attacker.totalMod,
            baseTarget: data.attacker.baseTarget,
            target: data.attacker.target,
            tn: data.attacker.tn,
            itemUuid: data.attacker.itemUuid,
            label: data.attacker.label,
            talentDoSChoice: res?.talentDoSChoice ?? null,
            talentDoSChoiceSource: res?.talentDoSChoiceSource ?? null
          }
        }
      })
    });
  } else {
    _emitSuppressedSubRollDice(res.roll, { rollMode: game.settings.get("core", "rollMode") });
  }

  // Flail (Chapter 7): a critical failure with a flail attack hits the attacker.
  if (res.isCriticalFailure === true) {
    try {
      const flailWeapon = runtimeWeapon
        ?? (String(data?.context?.weaponUuid ?? "").trim()
          ? _resolveItemViaActor(String(data.context.weaponUuid).trim(), attacker)
          : null);
      const hasFlail = Boolean(flailWeapon?.type === "weapon" && _weaponHasQuality(flailWeapon, "flail"));
      if (hasFlail) {
        const selfLocRoll = await (new Roll("1d100")).evaluate();
        const selfLocRaw = getHitLocationFromRoll(Number(selfLocRoll?.total ?? 100));
        const selfHitLocation = resolveHitLocationForTarget(attacker, selfLocRaw);
        const selfDmg = await _rollWeaponDamage({
          weapon: flailWeapon,
          preConsumedAmmo: data.attacker?.preConsumedAmmo ?? null,
          context: data.context ?? null
        });
        if (selfDmg && Number(selfDmg.finalDamage ?? 0) > 0) {
          await applyDamageResolved(attacker, {
            damage: Number(selfDmg.finalDamage),
            damageType: getDamageTypeFromWeapon(flailWeapon) || "physical",
            hitLocation: selfHitLocation,
            damagedValue: Number(selfDmg.damagedValue ?? 0) || 0,
            source: `${flailWeapon.name} (Flail Critical Failure)`,
            weapon: flailWeapon,
            attackerActor: attacker,
            attackMode: String(data?.context?.attackMode ?? "melee"),
            movementAction: data?.context?.attackerMovementAction ?? _getTokenMovementAction(aToken)
          });
        }
      }
    } catch (err) {
      console.warn("UESRPG | Flail critical-failure self-hit automation failed", err);
    }
  }

  // NOTE: Mid-handler applyExternalRollMessage removed (race condition fix).
  // The handler writes data.attacker.result directly below and calls _updateCard.
  // The createChatMessage hook path in external-roll.js remains as a fallback for
  // non-banking workflows and cross-client edge cases.

  // Consume one-shot Advantage-derived effects after they have been applied to this attack test.
  // RAW: Press Advantage / Overextend apply to the next attack test within 1 round.
  await _consumeOneShotAdvantageEffects(attacker, {
    opponentUuid: defender?.uuid ?? null,
    attackMode: String(data?.context?.attackMode ?? "melee")
  });

  await _consumeInspireHeroismEffect(attacker);

  // RAW: Aim bonus applies to the next ranged attack with the aimed weapon/spell.
  // Taking any other action breaks the chain; firing the aimed item consumes it.
  await _consumeOrBreakAimAfterAttack(attacker, {
    attackMode: String(data?.context?.attackMode ?? "melee"),
    itemUuid: data.context?.weaponUuid ?? null
  });

  // Spend AP only after the attack roll has been successfully executed and posted.
  // This avoids losing AP on cancelled/failed workflows.
  // Skip AP deduction if it was already consumed (e.g., Attack of Opportunity).
  const skipAP = Boolean(data.context?.skipAttackerAPDeduction);
  pendingApCost = Number(data.attacker?.pendingApCost ?? pendingApCost) || 0;
  const apVariant = String(data.attacker?.pendingApVariant ?? data.attacker.variant ?? "normal");
  let apOk = true;
  if (pendingApCost > 0 && !skipAP) {
    apOk = await ActionEconomy.spendAP(attacker, pendingApCost, { reason: `attackVariant:${apVariant}`, silent: true });
    if (!apOk) {
      ui.notifications.warn("Insufficient Action Points to perform this attack.");
    }
  }
  
  // Increment attack counter after AP is spent successfully
  // This ensures attacks only count if they were properly resourced
  if (apOk && !data?.context?.skipAttackCountIncrement) {
    try {
      await AttackTracker.incrementAttacks(attacker);
      const usedWeaponId = await AttackTracker.recordWeaponUse(
        attacker,
        data?.context?.weaponUuid ?? data?.attacker?.preConsumedAmmo?.weaponUuid ?? null
      );

      // Post-attack limit warnings (uses current AttackTracker limits and GM overrides).
      const warn = AttackTracker.getLimitWarning(attacker, {
        attackMode,
        weaponId: usedWeaponId
      });
      if (warn) ui.notifications?.warn?.(warn);
    } catch (err) {
      console.error("UESRPG | Failed to increment attack counter", { actor: attacker?.uuid, err });
      // Don't break the workflow if attack tracking fails
    }
  }
  
  // Write roll results directly into the parent card data.
  // Previously, the isRollCommitted path relied entirely on applyExternalRollMessage
  // to bank results via hook/direct call, but concurrent attacker+defender banking
  // from _autoRollBanked causes race conditions where updates overwrite each other.
  // Writing directly ensures the card always receives the attacker's result.
  data.attacker.result = {
    rollTotal: res.rollTotal,
    target: res.target,
    isSuccess: res.isSuccess,
    degree: res.degree,
    textual: res.textual,
    isCriticalSuccess: res.isCriticalSuccess,
    isCriticalFailure: res.isCriticalFailure,
    talentDoSChoice: res?.talentDoSChoice ?? null,
    talentDoSChoiceSource: res?.talentDoSChoiceSource ?? null,
    ...(Array.isArray(res?.talentNotes) && res.talentNotes.length ? { talentNotes: res.talentNotes } : {})
  };

  data.context = data.context ?? {};
  const unusualState = data.context.unusualCombat ?? {};
  if (data.attacker.result.isSuccess === false && unusualState.attackerFailureHandled !== true) {
    const followUp = await maybeHandleUnusualCombatAttackFailure({
      attacker,
      attackerToken: aToken,
      movementAction: data.context?.attackerMovementAction ?? _getTokenMovementAction(aToken),
    });
    if (followUp?.handled) {
      unusualState.attackerFailureHandled = true;
      unusualState.attackerFailureMode = String(followUp.mode ?? "");
      unusualState.attackerFailureOutcome = String(followUp.outcome ?? "");
      data.context.unusualCombat = unusualState;
    }
  }

  // Combat talents: DoS adjustments already applied before roll message posting.

  // Follow-up Strike (Chapter 4): on a failed dual-wield attack, allow spending 1 SP to create
  // a free follow-up attack with the other weapon at -20.
  await _maybeEnableFollowUpStrike({ data, attacker, attackerResult: data.attacker.result });

  // Chapter 5 (Hidden): enemies cannot defend against attacks made by hidden characters.
  if (data.context?.attackFromHidden === true) {
    for (const def of _getDefenderEntries(data)) {
      markDefenderIneligibleForHidden(def);
    }
  }

  // RAW: attacking causes the Hidden condition to be lost immediately after the attack.
  await applyPostAttackState(attacker, data.context, data);

  if (batchedUpdate && isRollCommitted) return data;
  // Fresh-state re-read: apply attacker result + context onto live state to preserve
  // any defender-side commit that arrived during the roll phase.
  await commitLaneToFreshCardState({
    message,
    readState: _readCombatOpposedFlagState,
    mutate: (_t) => {
      _t.attacker = foundry.utils.mergeObject(_t.attacker ?? {}, data.attacker, { overwrite: true, insertKeys: true });
      _t.context = foundry.utils.mergeObject(_t.context ?? {}, data.context, { overwrite: true, insertKeys: true });
      if (Array.isArray(data.defenders) && Array.isArray(_t.defenders)) {
        for (let _di = 0; _di < data.defenders.length; _di++) {
          if (_t.defenders[_di] && data.defenders[_di]) {
            _t.defenders[_di] = foundry.utils.mergeObject(_t.defenders[_di], data.defenders[_di], { overwrite: true, insertKeys: true });
          }
        }
      }
    },
    updateCard: _updateCard,
    fallbackData: data,
  });
  return data;
}
