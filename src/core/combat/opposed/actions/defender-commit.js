/**
 * src/core/combat/opposed/actions/defender-commit.js
 * Defender commit & roll handlers for banked-choice workflow
 */

import { doTestRoll } from "../../../../utils/degree-roll-helper.js";
import { _getDefenderOutcome, _setDefenderOutcome, _setDefenderAdvantage, _getDefenderEntries, _isMultiDefender } from "../schema.js";
import { _getBankCommitState, _allDefendersCommitted, _cleanupAutoRollContext } from "../banking/state.js";
import { resolveOutcomeRAW as _resolveOutcomeRAW, computeAdvantageRAW as _computeAdvantageRAW } from "../outcome-resolution.js";
import { applyAoEEvadeOutcome as _applyAoEEvadeOutcome, getTokenMovementAction as _getTokenMovementAction } from "../helpers/workflow.js";
import { _canControlActor, _emitSuppressedSubRollDice, _logDebug, _opposedFlags, _safeGetSetting } from "../helpers/util.js";
import { removeCondition } from "../../../conditions/condition-engine.js";
import { canDefenderRoll, markDefenderIneligibleForHidden, markDefenderNoDefense } from "./eligibility.js";
import { getDefenseTalentOverrides, applyDefenderTalentTNMods, getEvadeOverrideContext } from "../../../traits/combat-talents.js";
import { hasTalent } from "../../../traits/talents-api.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { _hasUnstoppableMightEligibleWeapons, _promptUnstoppableMightUsage, _getGladiatorContext, _getFreeDefenseReactionContext, _markGladiatorFreeReactionUsed } from "../helpers/talents.js";
import { DefenseDialog } from "../../defense-dialog.js";
import { getDefenseGatingContext as _getDefenseGatingContext } from "../helpers/workflow.js";
import { hasEquippedShield } from "../../tn.js";
import { computeDefenseAvailability, normalizeDefenseType } from "../../defense-options.js";
import { ActionEconomy } from "../../action-economy.js";
import { breakAimChainIfPresent as _breakAimChainIfPresent, consumeInspireHeroismEffect as _consumeInspireHeroismEffect } from "../effects.js";
import { listCombatStyles, computeTN } from "../../tn.js";
import { collectDefenseSensorySituationalMods as _collectDefenseSensorySituationalMods, asNumber as _asNumber, getPreferredWeaponUuid as _getPreferredWeaponUuid, weaponHasQuality as _weaponHasQuality } from "../helpers/workflow.js";
import { _resolveItemViaActor } from "../helpers/docs.js";
import { applyHyperAwarenessToResult } from "../../../traits/awareness-talents.js";
import { applyCombatTalentDoSAdjustments } from "../../../traits/combat-talents.js";
import { shouldDeferEvadeApForStepAside } from "../../../traits/mobility-talents.js";
import { consumeFreeNextDefenseCommit } from "../../activation-state-flags.js";
import { canUseWardDefense, getPreferredWardDefenseSpell } from "../../ward-defense.js";
import { applyRuntimePreRollToTN, applyRuntimePostRollToResult, evaluateREDefenseOverrides } from "../../../traits/features/rule-element-runtime.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { applyLengthPenaltyToTN } from "../../../homebrew/reach-length/weapon.js";
import { FLAG_SCOPE } from "../../../system/namespace.js";
import { getFlagValueWithFallback } from "../../../system/flags.js";
import { cloneFlagState } from "../../../../utils/clone.js";
import { commitLaneToFreshCardState } from "../../../opposed/shared/fresh-commit.js";
import { listEquippedShields, hasEquippedShieldType } from "../../../items/shield-utils.js";

/** @private — Clone current opposed flag state from a live message for lane-commit merging. */
function _readCombatOpposedFlagState(fm) {
  const raw = fm?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
  return raw ? cloneFlagState(raw) : null;
}

/**
 * @private — Apply defender-lane and context mutations onto a fresh flag state.
 * Preserves the attacker lane and other defenders from live state.
 */
function _applyDefenderLaneToFresh(freshData, data, defenderIndex) {
  const t = freshData ?? data;
  t.defender = foundry.utils.mergeObject(t.defender ?? {}, data.defender ?? {}, { overwrite: true, insertKeys: true });
  t.context = foundry.utils.mergeObject(t.context ?? {}, data.context ?? {}, { overwrite: true, insertKeys: true });
  if (data.status) t.status = data.status;
  if (data.outcome != null) t.outcome = data.outcome;
  const di = Number(defenderIndex ?? 0);
  if (Number.isFinite(di) && di >= 0 && Array.isArray(data.defenders) && Array.isArray(t.defenders) && t.defenders[di] && data.defenders[di]) {
    t.defenders[di] = foundry.utils.mergeObject(t.defenders[di], data.defenders[di], { overwrite: true, insertKeys: true });
  }
  return t;
}

// ── Homebrew: Reach & Length Overhaul helpers ─────────────────────────────

/**
 * Resolve the defender's active weapon for the Length Penalty calculation.
 * Tries choice.weaponUuid first, then falls back to the first equipped melee weapon.
 *
 * @param {Actor} defender
 * @param {object} choice - Defender commit choice object
 * @returns {Item|null}
 */
function _resolveDefenderWeapon(defender, choice) {
  try {
    const choiceUuid = String(choice?.weaponUuid ?? "").trim();
    if (choiceUuid) {
      const doc = _resolveItemViaActor(choiceUuid, defender);
      if (doc?.type === "weapon" && String(doc?.system?.attackMode ?? "melee").toLowerCase() === "melee") return doc;
    }
    // Fallback: first equipped melee weapon
    for (const item of (defender?.items ?? [])) {
      if (item.type !== "weapon") continue;
      if (!item.system?.equipped) continue;
      if (String(item.system?.attackMode ?? "").toLowerCase() === "melee") return item;
    }
    return null;
  } catch {
    return null;
  }
}

function _resolveRuntimeDefenseItem(defender, choice = null, defenseType = null) {
  try {
    const resolvedDefenseType = String(defenseType ?? choice?.defenseType ?? "").trim().toLowerCase();
    const blockSource = String(choice?.blockSource ?? "").trim().toLowerCase();
    if (resolvedDefenseType === "block" && blockSource === "ward") {
      return getPreferredWardDefenseSpell(defender);
    }
    if (resolvedDefenseType === "block" && hasEquippedShield(defender)) {
      const shield = listEquippedShields(defender, { includeBuckler: false, allowLegacy: true })[0] ?? null;
      if (shield) return shield;
    }

    if (resolvedDefenseType === "parry" || resolvedDefenseType === "counter") {
      return _resolveDefenderWeapon(defender, choice);
    }
  } catch (_e) {
    return null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

async function _maybeGrantConcussiveNextBash(attacker, data, advantage) {
  try {
    if (!attacker || Number(advantage?.attacker ?? 0) <= 0) return;
    if (String(data?.context?.attackMode ?? "melee").toLowerCase() !== "melee") return;
    const weaponUuid = String(data?.context?.weaponUuid ?? "").trim();
    if (!weaponUuid) return;
    const weapon = _resolveItemViaActor(weaponUuid, attacker);
    if (!weapon || weapon.type !== "weapon") return;
    if (!_weaponHasQuality(weapon, "concussive")) return;
    await requestUpdateDocument(attacker, {
      [`flags.${FLAG_SCOPE}.combat.concussiveNextBash`]: {
        bonus: 20,
        grantedAt: Date.now(),
        sourceWeaponUuid: weapon.uuid ?? null
      }
    });
  } catch (err) {
    console.warn("UESRPG | Concussive bonus grant failed", err);
  }
}

/**
 * Handle defender-commit-nodefense action
 * @param {Object} ctx - Context: { message, data, attacker, defender, defenderData, defenderIndex, defenders, isMulti, aToken, dToken, bankMode, isAoE, opts }
 */
export async function handleDefenderCommitNoDefense(ctx) {
  const { message, data, defender, defenderData, bankMode, isAoE, _updateCard } = ctx;

  if (!bankMode) {
    ui.notifications.warn("Banked choices are not enabled for this opposed test.");
    return;
  }

  if (data.defender.result || data.defender.noDefense) return;

  if (data.defender?.banked?.committed === true) {
    ui.notifications.warn("Defender has already committed a defense choice.");
    return;
  }

  if (!_canControlActor(defender)) {
    ui.notifications.warn("You do not have permission to choose defender actions.");
    return;
  }

  data.defender.banked = data.defender.banked ?? {};
  data.defender.banked.committed = true;
  data.defender.banked.committedAt = Date.now();
  data.defender.banked.committedBy = game.user.id;

  data.defender.noDefense = true;
  data.defender.defenseType = "none";
  data.defender.label = "No Defense";
  data.defender.testLabel = "No Defense";
  data.defender.defenseLabel = "No Defense";
  data.defender.target = 0;
  data.defender.tn = { finalTN: 0, baseTN: 0, totalMod: 0, breakdown: [{ key: "base", label: "No Defense", value: 0, source: "base" }] };
  data.defender.result = { rollTotal: 100, target: 0, isSuccess: false, degree: 1 };

  // If the attacker has already rolled, resolve this defender immediately.
  const currentOutcome = _getDefenderOutcome(data, data.defender);
  if (data.attacker?.result && !currentOutcome) {
    const baseOutcome = _resolveOutcomeRAW(data, data.defender) ?? { winner: "tie", text: "" };
    const outcome = _applyAoEEvadeOutcome(data, baseOutcome);
    _setDefenderOutcome(data, data.defender, outcome);
    const advantage = _computeAdvantageRAW(data, outcome, data.defender);
    _setDefenderAdvantage(data, data.defender, advantage);
    await _maybeGrantConcussiveNextBash(attacker, data, advantage);

    const allResolved = _getDefenderEntries(data).every(def => Boolean(_getDefenderOutcome(data, def)));
    if (allResolved) {
      data.status = "resolved";
      data.context = data.context ?? {};
      data.context.phase = "resolved";
      if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
      _cleanupAutoRollContext(data.context);
    }
  }

  _logDebug("defenderCommitNoDefense", {
    defenderUuid: data.defender.actorUuid,
    attackerUuid: data.attacker.actorUuid
  });

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

  // Fresh-state re-read: apply only defender lane + context onto live state to preserve
  // any attacker-side commit that arrived while this handler was running.
  await commitLaneToFreshCardState({
    message,
    readState: _readCombatOpposedFlagState,
    mutate: (s) => _applyDefenderLaneToFresh(s, data, ctx.defenderIndex),
    updateCard: _updateCard,
    fallbackData: data,
  });

  // Auto-roll is triggered by the updateChatMessage hook → maybeAutoRollBanked.
  // No direct _autoRollBanked call needed here.

  return;
}

/**
 * Handle defender-commit action (commit defense choice)
 * @param {Object} ctx - Context: { message, data, attacker, defender, defenderData, defenderIndex, defenders, isMulti, aToken, dToken, bankMode, isAoE, opts }
 */
export async function handleDefenderCommit(ctx) {
  const { message, data, defenderIndex, aToken, bankMode, isAoE, _updateCard } = ctx;
  const { attacker, defender, defenderData, dToken } = ctx;

  // CORRECTED: Feint gating - force No Defense if Feinted by this specific attacker
  const feintedEffect = defender.effects.find(e => 
    !e.disabled && 
    (getFlagValueWithFallback(e, "key") === "feinted" || getFlagValueWithFallback(e, "condition.key") === "feinted")
  );

  if (feintedEffect) {
    const feintedByUuid = getFlagValueWithFallback(feintedEffect, "attackerUuid")
      ?? getFlagValueWithFallback(feintedEffect, "condition.attackerUuid");
    
    if (feintedByUuid && feintedByUuid === attacker.uuid) {
      // RAW: treat next melee attack as if attacker were Hidden
      // Implementation: force No Defense
      data.defender.banked = data.defender.banked ?? {};
      data.defender.banked.committed = true;
      data.defender.banked.committedAt = Date.now();
      data.defender.banked.committedBy = "system";
      data.defender.banked.forced = true;
      data.defender.banked.reason = "feinted";

      data.defender.noDefense = true;
      data.defender.defenseType = "none";
      data.defender.label = "No Defense (Feinted)";
      data.defender.testLabel = "No Defense";
      data.defender.defenseLabel = "No Defense";
      data.defender.target = 0;
      data.defender.tn = {
        finalTN: 0,
        baseTN: 0,
        totalMod: 0,
        breakdown: [{ key: "base", label: "No Defense (Feinted)", value: 0, source: "base" }]
      };
      data.defender.result = { rollTotal: 100, target: 0, isSuccess: false, degree: 1 };

      await commitLaneToFreshCardState({
        message,
        readState: _readCombatOpposedFlagState,
        mutate: (s) => _applyDefenderLaneToFresh(s, data, defenderIndex),
        updateCard: _updateCard,
        fallbackData: data,
      });

      // Remove Feinted after it's been used
      await removeCondition(defender, "feinted");

      ui.notifications.info(`${defender.name} is Feinted and cannot defend against ${attacker.name}!`);
      return;
    }
  }

  if (!bankMode) {
    ui.notifications.warn("Banked choices are not enabled for this opposed test.");
    return;
  }

  if (data.defender.result || data.defender.noDefense) return;

  if (data.defender?.banked?.committed === true) {
    ui.notifications.warn("Defender has already committed a defense choice.");
    return;
  }

  if (!_canControlActor(defender)) {
    ui.notifications.warn("You do not have permission to choose defender actions.");
    return;
  }

  // Check eligibility using centralized helper
  const eligibility = canDefenderRoll(defender, data.context);
  
  // Chapter 5 (Restrained): cannot defend.
  // Chapter 5 (Hidden): if the attacker struck from Hidden, the defender cannot attempt defense.
  if (!eligibility.allowed) {
    const reason = eligibility.reason ?? "Unknown";

    data.defender.banked = data.defender.banked ?? {};
    data.defender.banked.committed = true;
    data.defender.banked.committedAt = Date.now();
    data.defender.banked.committedBy = "system";
    data.defender.banked.forced = true;
    data.defender.banked.reason = String(reason).toLowerCase();

    if (eligibility.isHidden) {
      markDefenderIneligibleForHidden(data.defender);
    } else {
      markDefenderNoDefense(data.defender, reason);
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

    // Fresh-state re-read: apply only defender lane + context onto live state.
    await commitLaneToFreshCardState({
      message,
      readState: _readCombatOpposedFlagState,
      mutate: (s) => _applyDefenderLaneToFresh(s, data, defenderIndex),
      updateCard: _updateCard,
      fallbackData: data,
    });

    // Auto-roll is triggered by the updateChatMessage hook → maybeAutoRollBanked.

    return;
  }

  const defenderMovementAction = _getTokenMovementAction(dToken);

  const { attackerWeaponTraits, defenderHasSmallWeapon } = await _getDefenseGatingContext({ attacker, defender, data });
  data.context = data.context ?? {};
  data.context.attackerWeaponTraits = {
    ...(data.context.attackerWeaponTraits ?? {}),
    ...attackerWeaponTraits
  };

  // Combat talent: Lightning Reflexes (allow Parry vs ranged weapon attacks, at -20).
  const defenseTalentOverrides = getDefenseTalentOverrides({
    defender,
    attackMode: data.context?.attackMode ?? "melee",
    attackerWeaponTraits
  });

  // Rule Element: defenseOverride — when the legacy interceptor yields to RE, consume
  // the RE-sourced override so the defense dialog still knows about allowed options.
  if (!defenseTalentOverrides.allowParryRanged) {
    const reDefOverrides = evaluateREDefenseOverrides({ defender, attackMode: data.context?.attackMode ?? "melee" });
    if (reDefOverrides.allowParryRanged) {
      defenseTalentOverrides.allowParryRanged = true;
      defenseTalentOverrides.parryRangedTNMod = reDefOverrides.parryRangedTNMod || -20;
    }
  }

  // Combat talent: Fearsome (OPTIONAL) – the defender may use Persuade(Strength) in place of Evade
  // when taking an Evade reaction against melee attacks.
  // We do NOT auto-apply this override; we prompt right after the defender selects "Evade".
  const fearsomeContext = getEvadeOverrideContext({
    defender,
    attackMode: data.context?.attackMode ?? "melee"
  });

  const interceptAllowed = Array.isArray(defenderData?.defenderIntercept?.allowedDefenseTypes)
    ? defenderData.defenderIntercept.allowedDefenseTypes
    : null;
  let allowedDefenseTypes = isAoE ? ["block", "evade"] : null;
  if (interceptAllowed) {
    allowedDefenseTypes = allowedDefenseTypes
      ? allowedDefenseTypes.filter((t) => interceptAllowed.includes(t))
      : Array.from(interceptAllowed);
  }

  // Unstoppable Might (Chapter 4): prompt for special wield usage to gate Parry/Counter.
  const umEligible = hasTalent(defender, "unstoppablemight") && _hasUnstoppableMightEligibleWeapons(defender);
  const allowsParryCounter = !allowedDefenseTypes || allowedDefenseTypes.includes("parry") || allowedDefenseTypes.includes("counter");
  if (umEligible && allowsParryCounter) {
    const useSpecial = await _promptUnstoppableMightUsage({ actorName: defender.name, purpose: "defense" });
    if (useSpecial) {
      const base = ["evade", "block"]; // block will be disabled automatically if no shield
      allowedDefenseTypes = allowedDefenseTypes
        ? allowedDefenseTypes.filter((t) => base.includes(t))
        : base;
      data.defender.unstoppableMight = { disallowParryCounter: true };
    }
  }

  const gladiatorCtx = _getGladiatorContext({
    defender,
    defenderToken: dToken,
    attackMode: data.context?.attackMode ?? "melee"
  });

  const choice = await DefenseDialog.show(defender, {
    attackerActor: attacker,
    attackerContext: data.attacker,
    attackerWeaponTraits,
    defenderHasSmallWeapon,
    allowedDefenseTypes,
    allowParryRanged: defenseTalentOverrides.allowParryRanged,
    gladiator: gladiatorCtx?.triggered ? gladiatorCtx : null,
    context: {
      opponentUuid: attacker?.uuid ?? null,
      attackMode: data.context?.attackMode ?? "melee",
      movementAction: defenderMovementAction
    }
  });
  if (!choice) return;
  if (String(choice?.defenseType ?? "").toLowerCase() === "ward") {
    choice.defenseType = "block";
    choice.blockSource = "ward";
    choice.label = "Ward";
  }

  // Fearsome (OPTIONAL): if Evade was selected and Fearsome is available, prompt for which test to roll.
  let fearsomeTNOverride = null;
  if (choice.defenseType === "evade" && fearsomeContext?.fearsome?.available) {
    const usePersuade = await customDialog({
      title: "Fearsome",
      content: `
        <div class="uesrpg">
          <p><b>${defender.name}</b> may use <b>Persuade (Strength)</b> in place of <b>Evade</b> when taking an Evade reaction against melee attacks.</p>
          <p>Choose which test to roll for this reaction.</p>
        </div>
      `,
      buttons: {
        evade: { label: "Use Evade", callback: () => false },
        persuade: { label: "Use Persuade (Strength)", callback: () => true }
      },
      defaultButton: "evade",
    });

    if (usePersuade === true) {
      fearsomeTNOverride = fearsomeContext.fearsome.payload;
      data.defender.fearsomeChoice = "persuade";
    } else {
      data.defender.fearsomeChoice = "evade";
    }
  }

  // Defense option availability normalization (single canonical rules-layer).
  // This is a defensive server-side validation: UI already prevents illegal selection,
  // but we do not trust client-side input.
  try {
    const availability = computeDefenseAvailability({
      attackMode: data.context?.attackMode ?? "melee",
      attackerWeaponTraits,
      defenderHasSmallWeapon,
      defenderHasShield: hasEquippedShield(defender),
      defenderHasWard: canUseWardDefense(defender),
      attackerActor: attacker,
      defenderActor: defender,
      allowedDefenseTypes,
      allowParryRanged: defenseTalentOverrides.allowParryRanged
    });
    const requested = String(choice.defenseType ?? "evade");
    const normalized = normalizeDefenseType(requested, availability, "evade");
    if (normalized !== requested) {
      ui.notifications.warn("Selected defense option is not available for this attack. Defaulting to Evade.");
      choice.defenseType = "evade";
      choice.label = "Evade";
      choice.styleUuid = null;
      choice.styleId = null;
    }
  } catch (err) {
    console.warn("UESRPG | opposed-workflow | defense option normalization failed", err);
  }

  // RAW: Defensive reactions cost Action Points unless an explicit feature states otherwise.

  // Default: any defense choice other than No Defense costs 1 AP.

  // Spend immediately upon selecting the defense choice to prevent later desync.

  if (choice.defenseType && choice.defenseType !== "none") {
    const gladiatorFreeRequested = gladiatorCtx?.mode === "updated"
      ? Boolean(choice?.gladiatorFree)
      : (gladiatorCtx?.mode === "original");
    const gladiatorFree = Boolean(gladiatorCtx?.triggered && gladiatorCtx?.available && gladiatorFreeRequested);
    const freeCtx = _getFreeDefenseReactionContext({
      defenderData,
      defenderActor: defender,
      messageId: message?.id ?? null,
      gladiator: gladiatorFree ? gladiatorCtx?.roundCtx : null
    });

    const attackerLabel = String(data?.attacker?.label ?? data?.attacker?.attackerLabel ?? data?.attacker?.name ?? "");
    const deferStepAside = shouldDeferEvadeApForStepAside({
      defender,
      defenseType: choice.defenseType,
      attackerLabel
    });

    if (freeCtx.free) {
      if (freeCtx.source === "defender-activation") {
        let consumed = await consumeFreeNextDefenseCommit(defender, { messageId: message?.id ?? null });
        if (!consumed) {
          consumed = await consumeFreeNextDefenseCommit(defender, { messageId: null });
        }
        if (consumed) {
          defenderData.defenderTalentFreeDefense = {
            source: consumed.source ?? "Defender",
            consumedAt: Date.now(),
            messageId: consumed.messageId ?? message?.id ?? null
          };
        } else {
          const ok = await ActionEconomy.spendAP(defender, 1, { reason: `reaction:${choice.defenseType}`, silent: true });
          if (!ok) {
            ui.notifications.warn(`${defender.name} does not have enough Action Points to perform a defensive reaction. Choose No Defense instead.`);
            return;
          }
        }
      } else if (freeCtx.source === "gladiator" && freeCtx.gladiatorCtx) {
        await _markGladiatorFreeReactionUsed(defender, freeCtx.gladiatorCtx);
        defenderData.gladiator = { freeReactionApplied: true, ...freeCtx.gladiatorCtx };
      }
    } else if (deferStepAside) {
      defenderData.stepAside = { deferredAp: 1, deferredAt: Date.now() };
      data.defender.stepAside = defenderData.stepAside;
    } else {
      const ok = await ActionEconomy.spendAP(defender, 1, { reason: `reaction:${choice.defenseType}`, silent: true });
      if (!ok) {
        ui.notifications.warn(`${defender.name} does not have enough Action Points to perform a defensive reaction. Choose No Defense instead.`);
        return;
      }
    }
  }


  if (choice.defenseType && choice.defenseType !== "none") {

    // RAW: Any reaction other than continuing to Aim or firing breaks the Aim chain.

    await _breakAimChainIfPresent(defender);

  }
  data.defender.defenseType = choice.defenseType;
  data.defender.blockSource = (choice.defenseType === "block")
    ? String(choice?.blockSource ?? "shield").toLowerCase()
    : null;
  data.defender.styleUuid = (
    choice.defenseType === "evade"
    || choice.defenseType === "none"
    || (choice.defenseType === "block" && data.defender.blockSource === "ward")
  )
    ? null
    : (choice.styleUuid ?? choice.styleId ?? null);
  data.defender.label = choice.label;
  data.defender.defenseLabel = choice.label;

  if (choice.defenseType === "evade") {
    data.defender.testLabel = "Evade";
  } else if (choice.defenseType === "block" && data.defender.blockSource === "ward") {
    data.defender.testLabel = "Ward";
  } else if (choice.styleUuid || choice.styleId) {
    const styleUuid = choice.styleUuid ?? choice.styleId;
    const styles = listCombatStyles(defender);
    const style = styles.find(s => s.uuid === styleUuid) ?? null;
    data.defender.testLabel = style?.name ?? "(Combat Style)";
  } else {
    data.defender.testLabel = "(Combat Style)";
  }

  const manualMod = _asNumber(choice.manualMod ?? 0);
  const circumstanceMod = _asNumber(choice.circumstanceMod ?? 0);
  const situationalMods = _collectDefenseSensorySituationalMods(choice, defender);
  const tn = computeTN({
    actor: defender,
    role: "defender",
    defenseType: choice.defenseType,
    styleUuid: choice.styleUuid ?? choice.styleId ?? null,
    manualMod,
    circumstanceMod,
    situationalMods,
    context: {
      opponentUuid: attacker?.uuid ?? null,
      attackMode: data.context?.attackMode ?? "melee",
      movementAction: defenderMovementAction,
    ...(choice.defenseType === "block"
      ? {
        blockSource: data.defender.blockSource ?? "shield",
        wardSpell: data.defender.blockSource === "ward" ? getPreferredWardDefenseSpell(defender) : null
      }
      : {}),
    ...(fearsomeTNOverride ? { tnOverride: fearsomeTNOverride } : {})
    }
  });

  // Apply defender-side TN mods from combat talents (e.g., Lightning Reflexes ranged parry -20).
  applyDefenderTalentTNMods({
    defender,
    defenseType: choice.defenseType,
    attackMode: data.context?.attackMode ?? "melee",
    tn,
    attackerWeaponTraits
  });

  const runtimeDefenseItem = _resolveRuntimeDefenseItem(defender, choice, choice.defenseType);

  applyRuntimePreRollToTN({
    actor: defender,
    targetActor: attacker ?? null,
    targetToken: aToken ?? null,
    item: runtimeDefenseItem,
    rollContext: data?.context?.rollContext,
    workflow: "combat",
    side: "defender",
    attackMode: String(data?.context?.attackMode ?? ""),
    defenseType: String(choice?.defenseType ?? ""),
    tn
  });

  // ── Homebrew: Reach & Length — Length Penalty TN injection ────────────────
  {
    const attackerWeapon = (() => {
      try {
        const uuid = String(data?.context?.weaponUuid ?? "").trim();
        if (!uuid) return null;
        const doc = fromUuidSync(uuid);
        return doc?.type === "weapon" ? doc : null;
      } catch { return null; }
    })();
    const defenderWeapon = _resolveDefenderWeapon(defender, choice);
    const mode = String(data?.context?.attackMode ?? "melee").toLowerCase();
    const attackerMelee = String(attackerWeapon?.system?.attackMode ?? "").toLowerCase() === "melee";
    const defenderMelee = String(defenderWeapon?.system?.attackMode ?? "").toLowerCase() === "melee";
    if (mode === "melee" && attackerMelee && defenderMelee) {
      applyLengthPenaltyToTN({
        tn,
        ownWeapon: defenderWeapon,
        opponentWeapon: attackerWeapon,
        ownerToken: dToken ?? null,
        opponentToken: aToken ?? null,
        ownerActor: defender ?? null,
        ownRole: "defender"
      });
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  data.defender.target = tn.finalTN;
  const declaredMod = (Number(manualMod) || 0) + (Number(circumstanceMod) || 0);
  data.defender.targetLabel = declaredMod
    ? `${tn.finalTN} (${declaredMod >= 0 ? "+" : ""}${declaredMod})`
    : `${tn.finalTN}`;
  data.defender.tn = tn;

  _logDebug("defenderCommit", {
    defenderUuid: data.defender.actorUuid,
    attackerUuid: data.attacker.actorUuid,
    defenseType: data.defender.defenseType,
    tn
  });

  // Defender "none" is not expected via the dialog, but keep deterministic.
  if (choice.defenseType === "none") {
    data.defender.noDefense = true;
    data.defender.defenseType = "none";
    data.defender.label = "No Defense";
    data.defender.testLabel = "No Defense";
    data.defender.defenseLabel = "No Defense";
    data.defender.target = 0;
    data.defender.tn = { finalTN: 0, baseTN: 0, totalMod: 0, breakdown: [{ key: "base", label: "No Defense", value: 0, source: "base" }] };
    data.defender.result = { rollTotal: 100, target: 0, isSuccess: false, degree: 1 };
  }

  data.defender.banked = data.defender.banked ?? {};
  data.defender.banked.committed = true;
  data.defender.banked.committedAt = Date.now();
  data.defender.banked.committedBy = game.user.id;

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

  // Fresh-state re-read: apply only defender lane + context onto live state to preserve
  // any attacker-side commit that arrived while the defense dialog was open.
  await commitLaneToFreshCardState({
    message,
    readState: _readCombatOpposedFlagState,
    mutate: (s) => _applyDefenderLaneToFresh(s, data, defenderIndex),
    updateCard: _updateCard,
    fallbackData: data,
  });

  // Auto-roll is triggered by the updateChatMessage hook → maybeAutoRollBanked.

  return;
}

/**
 * Handle defender-roll-committed action (roll defense after committing)
 * @param {Object} ctx - Context: { message, data, attacker, defender, defenderData, defenderIndex, defenders, isMulti, aToken, dToken, bankMode, isAoE, opts }
 */
export async function handleDefenderRollCommitted(ctx) {
  const { message, data, attacker, defender, defenderIndex, aToken, dToken, bankMode, batchedUpdate, _updateCard } = ctx;

  if (!bankMode) {
    ui.notifications.warn("Banked choices are not enabled for this opposed test.");
    return;
  }

  if (data.defender.result || data.defender.noDefense) return;

  if (!_canControlActor(defender)) {
    ui.notifications.warn("You do not have permission to roll for the defender.");
    return;
  }

  const bank = _getBankCommitState(data);

  // For multi-defender: require ALL defenders to be committed before rolling
  if (!bank.bothCommitted || !_allDefendersCommitted(data)) {
    ui.notifications.warn(_isMultiDefender(data) 
      ? "All participants must commit their choices before rolling." 
      : "Both sides must commit their choices before rolling.");
    return;
  }

  const t = Number(data.defender?.target ?? data.defender?.tn?.finalTN ?? NaN);
  if (!Number.isFinite(t)) {
    ui.notifications.warn("Defender has not committed a defense declaration yet.");
    return;
  }

  const dt = String(data.defender?.defenseType ?? "");
  if (!dt || dt === "none") {
    ui.notifications.warn("Defender has committed No Defense (or no defense type). No roll is required.");
    return;
  }

  const runtimeDefenseItem = _resolveRuntimeDefenseItem(
    defender,
    {
      weaponUuid: data.defender?.weaponUuid ?? null,
      defenseType: data.defender?.defenseType ?? null,
      blockSource: data.defender?.blockSource ?? null
    },
    data.defender?.defenseType ?? null
  );

  const committedTn = (data.defender?.tn && typeof data.defender.tn === "object")
    ? data.defender.tn
    : { finalTN: Number(data.defender?.target ?? 0) || 0 };
  applyRuntimePreRollToTN({
    actor: defender,
    targetActor: attacker ?? null,
    targetToken: aToken ?? null,
    item: runtimeDefenseItem,
    rollContext: data?.context?.rollContext,
    workflow: "combat",
    side: "defender",
    attackMode: String(data?.context?.attackMode ?? ""),
    defenseType: String(data?.defender?.defenseType ?? ""),
    tn: committedTn
  });
  data.defender.tn = committedTn;
  data.defender.target = Number(committedTn?.finalTN ?? data.defender?.target ?? 0) || 0;

  // Roll committed defense lane.
  const res = await doTestRoll(defender, { rollFormula: "1d100", target: Number(data.defender.target), allowLucky: true, allowUnlucky: true });

  // Hyper Awareness: Evade tests may choose rolled DoS or Observe rank.
  if (String(data.defender.defenseType ?? "") === "evade") {
    await applyHyperAwarenessToResult(defender, "Evade", res, { allowPrompt: true });
  }

  // Step Aside (Chapter 4): AoO Evade costs 0 AP unless the Evade test fails.
  const stepAside = data.defender?.stepAside ?? null;
  if (stepAside?.deferredAp === 1 && String(data.defender.defenseType ?? "") === "evade" && res.isSuccess !== true) {
    const ok = await ActionEconomy.spendAP(defender, 1, { reason: "reaction:evade:stepAsideFail", silent: true });
    stepAside.paid = Boolean(ok);
    stepAside.paidAt = Date.now();
    data.defender.stepAside = stepAside;
    if (!ok) {
      ui.notifications?.warn?.(`${defender.name} could not pay the deferred AP cost for Step Aside after failing the Evade reaction.`);
    }
  }

  // Combat talents: post-roll DoS adjustments (bonus DoS / skill-rank replacement prompts).
  // Run before posting the roll message so we can propagate the choice to the banking path.
  try {
    const adj = await applyCombatTalentDoSAdjustments({
      attacker,
      defender,
      attackerToken: aToken,
      defenderToken: dToken,
      side: "defender",
      result: res,
      defenseType: data.defender.defenseType,
      styleUuid: data.defender?.styleUuid ?? null,
      testLabel: data.defender.testLabel ?? data.defender.label ?? null,
      allowPrompt: true
    });
    if (Array.isArray(adj?.notes) && adj.notes.length) {
      res.talentNotes = adj.notes;
    }
  } catch (err) {
    console.warn("UESRPG | combat talent DoS adjustment (defender) failed", err);
  }

  await applyRuntimePostRollToResult({
    actor: defender,
    targetActor: attacker ?? null,
    targetToken: aToken ?? null,
    item: runtimeDefenseItem,
    rollContext: data?.context?.rollContext,
    workflow: "combat",
    side: "defender",
    attackMode: String(data?.context?.attackMode ?? ""),
    defenseType: String(data?.defender?.defenseType ?? ""),
    testLabel: String(data?.defender?.testLabel ?? data?.defender?.label ?? ""),
    result: res,
    allowPrompt: true
  });

  const postSubRolls = _safeGetSetting("uesrpg-3ev4", "opposedPostSubRollMessages", true);
  let rollMessage = null;
  if (postSubRolls) {
    rollMessage = await res.roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: defender, token: dToken?.document ?? null }),
      flavor: `${data.defender.label} \u2014 Defender Roll`,
      rollMode: game.settings.get("core", "rollMode"),
      flags: _opposedFlags(message.id, "defender-roll", {
        defenderIndex,
        commit: {
          defender: {
            defenseType: data.defender.defenseType,
            blockSource: data.defender.blockSource ?? null,
            styleUuid: data.defender.styleUuid ?? null,
            label: data.defender.label,
            defenseLabel: data.defender.defenseLabel,
            testLabel: data.defender.testLabel,
            target: data.defender.target,
            targetLabel: data.defender.targetLabel,
            tn: data.defender.tn,
            talentDoSChoice: res?.talentDoSChoice ?? null,
            talentDoSChoiceSource: res?.talentDoSChoiceSource ?? null,
            hyperAwarenessChoice: res?.hyperAwarenessChoice ?? null
          }
        }
      })
    });
  } else {
    _emitSuppressedSubRollDice(res.roll, { rollMode: game.settings.get("core", "rollMode") });
  }

  // NOTE: Mid-handler applyExternalRollMessage removed (race condition fix).
  // The handler writes data.defender.result directly below and calls _updateCard.
  // The createChatMessage hook path in external-roll.js remains as a fallback for
  // non-banking workflows and cross-client edge cases.

  // Write roll results directly into the parent card data.
  // Previously relied entirely on applyExternalRollMessage, but concurrent
  // attacker+defender banking from _autoRollBanked causes race conditions.
  // Writing directly ensures the card always receives the defender's result.
  data.defender.result = {
    rollTotal: res.rollTotal,
    target: Number(data.defender.target),
    isSuccess: res.isSuccess,
    degree: res.degree,
    textual: res.textual,
    isCriticalSuccess: res.isCriticalSuccess,
    isCriticalFailure: res.isCriticalFailure,
    talentDoSChoice: res?.talentDoSChoice ?? null,
    talentDoSChoiceSource: res?.talentDoSChoiceSource ?? null,
    ...(res?.hyperAwarenessChoice != null ? { hyperAwarenessChoice: res.hyperAwarenessChoice } : {}),
    ...(Array.isArray(res?.talentNotes) && res.talentNotes.length ? { talentNotes: res.talentNotes } : {})
  };
  await _consumeInspireHeroismEffect(defender);
  if (data.defender.result.isSuccess && String(data.defender?.defenseType ?? "").toLowerCase() === "parry") {
    try {
      const hasBuckler = hasEquippedShieldType(defender, "buckler", { allowLegacy: true });
      if (hasBuckler) {
        data.defender.result.degree = Math.max(1, (Number(data.defender.result.degree) || 1) + 1);
        data.defender.result.bucklerBonus = 1;
        data.defender.result.textual = `${data.defender.result.degree} DoS`;
      }
    } catch (err) {
      console.warn("UESRPG | opposed-workflow | buckler bonus lookup failed (commit path)", err);
    }
  }
  data.defender.rolledAt = Date.now();
  if (rollMessage?.id) data.defender.rollMessageId = rollMessage.id;

  if (batchedUpdate) return data;
  // Fresh-state re-read: apply defender result + context onto live state to preserve
  // any attacker-side state that committed during the roll phase.
  await commitLaneToFreshCardState({
    message,
    readState: _readCombatOpposedFlagState,
    mutate: (s) => _applyDefenderLaneToFresh(s, data, defenderIndex),
    updateCard: _updateCard,
    fallbackData: data,
  });
  return data;
}
