/**
 * src/core/combat/opposed/actions/defender-roll.js
 * Defender No Defense and Defender Roll handlers for opposed workflow
 * Extracted from actions.js (lines 1241-1300, 1301-1755)
 */

import { doTestRoll } from "../../../../utils/degree-roll-helper.js";
import { 
  _getDefenderEntries, 
  _getDefenderOutcome, 
  _setDefenderOutcome, 
  _setDefenderAdvantage 
} from "../schema.js";
import { _canControlActor, _emitSuppressedSubRollDice, _logDebug, _opposedFlags, _safeGetSetting } from "../helpers/util.js";
import { _resolveItemViaActor } from "../helpers/docs.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { 
  getTokenMovementAction as _getTokenMovementAction,
  asNumber as _asNumber,
  collectDefenseSensorySituationalMods as _collectDefenseSensorySituationalMods,
  weaponHasQuality as _weaponHasQuality,
  getPreferredWeaponUuid as _getPreferredWeaponUuid,
  applyAoEEvadeOutcome as _applyAoEEvadeOutcome,
  getDefenseGatingContext as _getDefenseGatingContext,
  maybeSetAoEEvadeEscape as _maybeSetAoEEvadeEscape
} from "../helpers/workflow.js";
import { resolveOutcomeRAW as _resolveOutcomeRAW, computeAdvantageRAW as _computeAdvantageRAW } from "../outcome-resolution.js";
import { _cleanupAutoRollContext } from "../banking/state.js";
import { canDefenderRoll, markDefenderIneligibleForHidden, markDefenderNoDefense } from "./eligibility.js";
import { DefenseDialog } from "../../defense-dialog.js";
import { computeTN } from "../../tn.js";
import { getDefenseTalentOverrides, applyDefenderTalentTNMods, applyCombatTalentDoSAdjustments, getEvadeOverrideContext } from "../../../traits/combat-talents.js";
import { _promptUnstoppableMightUsage, _hasUnstoppableMightEligibleWeapons, _getGladiatorContext, _getFreeDefenseReactionContext, _markGladiatorFreeReactionUsed } from "../helpers/talents.js";
import { computeDefenseAvailability, normalizeDefenseType } from "../../defense-options.js";
import { applyHyperAwarenessToResult } from "../../../traits/awareness-talents.js";
import { hasTalent } from "../../../traits/talents-api.js";
import { shouldDeferEvadeApForStepAside } from "../../../traits/mobility-talents.js";
import { ActionEconomy } from "../../action-economy.js";
import { hasEquippedShield, listCombatStyles } from "../../tn.js";
import { breakAimChainIfPresent as _breakAimChainIfPresent, consumeInspireHeroismEffect as _consumeInspireHeroismEffect } from "../effects.js";
import { consumeFreeNextDefenseCommit } from "../../activation-state-flags.js";
import { canUseWardDefense, getPreferredWardDefenseSpell } from "../../ward-defense.js";
import { applyRuntimePreRollToTN, applyRuntimePostRollToResult, evaluateREDefenseOverrides } from "../../../traits/features/rule-element-runtime.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { applyLengthPenaltyToTN } from "../../../homebrew/reach-length/weapon.js";
import { FLAG_SCOPE } from "../../../system/namespace.js";
import { getFlagValueWithFallback } from "../../../system/flags.js";
import { listEquippedShields, hasEquippedShieldType } from "../../../items/shield-utils.js";
import {
  buildHybridWarfareTn,
  getHybridDomain,
  isHybridOpposed,
  promptHybridWarfareDefense,
  rollHybridWarfareTest
} from "../hybrid.js";

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
      const choiceUuid = String(choice?.weaponUuid ?? "").trim();
      if (choiceUuid) {
        const chosen = _resolveItemViaActor(choiceUuid, defender);
        if (chosen?.type === "weapon" && chosen?.parent?.id === defender?.id) return chosen;
      }
      const preferredUuid = _getPreferredWeaponUuid(defender, { meleeOnly: true }) || "";
      if (preferredUuid) {
        const preferred = _resolveItemViaActor(preferredUuid, defender);
        if (preferred?.type === "weapon" && preferred?.parent?.id === defender?.id) return preferred;
      }
    }
  } catch (_e) {
    return null;
  }
  return null;
}

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
 * Handle defender-nodefense action
 * @param {Object} ctx - Context: { message, data, attacker, defender, defenderData, defenderIndex, defenders, isMulti, aToken, dToken, bankMode, isAoE, opts }
 */
export async function handleDefenderNoDefense(ctx) {
  const { message, data, attacker, defender, defenderData, defenderIndex, dToken, _updateCard } = ctx;

  if (data.defender.result || data.defender.noDefense) return;
  if (!_canControlActor(defender)) {
    ui.notifications.warn("You do not have permission to choose defender actions.");
    return;
  }

  data.defender.noDefense = true;
  data.defender.defenseType = "none";
  data.defender.label = "No Defense";
  data.defender.testLabel = "No Defense";
  data.defender.defenseLabel = "No Defense";
  data.defender.target = 0;
  data.defender.tn = { finalTN: 0, baseTN: 0, totalMod: 0, breakdown: [{ key: "base", label: "No Defense", value: 0, source: "base" }] };
  data.defender.result = { rollTotal: 100, target: 0, isSuccess: false, degree: 1 };

  // Resolve immediately if the attacker already rolled.
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

  _logDebug("defenderNoDefense", {
    defenderUuid: data.defender.actorUuid,
    attackerUuid: data.attacker.actorUuid
  });

  // Create a lightweight workflow marker message so an active GM (or the card author
  // if no GM is present) can reliably bank the defender choice into the parent card.
  // This is required because ChatMessage update permissions are restrictive for
  // non-GM users editing another user's message.
  try {
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: defender, token: dToken?.document ?? null }),
      content: `<div class="ues-opposed-card" style="padding:6px;"><b>No Defense</b> declared.</div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      rollMode: game.settings.get("core", "rollMode"),
      flags: _opposedFlags(message.id, "defender-nodefense", { defenderIndex })
    });
  } catch (err) {
    console.warn("UESRPG | opposed-workflow | failed to create defender-nodefense marker", err);
  }

  await _updateCard(message, data);
}

/**
 * Handle defender-roll action
 * @param {Object} ctx - Context: { message, data, attacker, defender, defenderData, defenderIndex, defenders, isMulti, aToken, dToken, bankMode, isAoE, opts }
 */
export async function handleDefenderRoll(ctx) {
  const { message, data, defenderIndex, aToken, _updateCard } = ctx;
  const { attacker, defender, defenderData, dToken } = ctx;

  if (isHybridOpposed(data) && getHybridDomain(data, "defender", defender) === "warfare") {
    if (data.defender.result || data.defender.noDefense) return;
    if (!_canControlActor(defender)) {
      ui.notifications.warn("You do not have permission to roll for the defender.");
      return;
    }
    const choice = await promptHybridWarfareDefense(defender, attacker);
    if (!choice) return;
    const tn = buildHybridWarfareTn(defender, { modifier: choice.modifier }, {
      joinFray: String(data?.context?.hybrid?.reason ?? "") === "join-fray",
    });
    data.defender.defenseType = "warfare";
    data.defender.label = "Discipline Defense";
    data.defender.defenseLabel = "Discipline Defense";
    data.defender.testLabel = "Discipline";
    data.defender.target = Number(tn.finalTN ?? 0) || 0;
    data.defender.targetLabel = `${data.defender.target}`;
    data.defender.tn = tn;
    data.defender.hybrid = {
      ...(data.defender.hybrid ?? {}),
      modifier: Number(choice.modifier ?? 0) || 0,
    };
    const res = await rollHybridWarfareTest(defender, data.defender.target);
    data.defender.result = {
      rollTotal: res.rollTotal,
      target: data.defender.target,
      isSuccess: res.isSuccess,
      degree: res.degree,
      textual: res.textual,
      isCriticalSuccess: false,
      isCriticalFailure: false,
    };

    if (data.attacker?.result) {
      const baseOutcome = _resolveOutcomeRAW(data, data.defender) ?? { winner: "tie", text: "" };
      const outcome = _applyAoEEvadeOutcome(data, baseOutcome);
      _setDefenderOutcome(data, data.defender, outcome);
      const advantage = _computeAdvantageRAW(data, outcome, data.defender);
      _setDefenderAdvantage(data, data.defender, advantage);
      const allResolved = _getDefenderEntries(data).every(def => Boolean(_getDefenderOutcome(data, def)));
      if (allResolved) {
        data.status = "resolved";
        data.context = data.context ?? {};
        data.context.phase = "resolved";
        if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
        _cleanupAutoRollContext(data.context);
      }
    }

    await _updateCard(message, data);
    return;
  }

  if (data.defender.result || data.defender.noDefense) return;

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

      await _updateCard(message, data);

      // Remove Feinted after it's been used
      const { removeCondition } = await import("../../../conditions/condition-engine.js");
      await removeCondition(defender, "feinted");

      ui.notifications.info(`${defender.name} is Feinted and cannot defend against ${attacker.name}!`);
      return;
    }
  }

  if (!_canControlActor(defender)) {
    ui.notifications.warn("You do not have permission to roll for the defender.");
    return;
  }

  const eligibility = canDefenderRoll(defender, data.context);
  if (!eligibility.allowed) {
    const reason = String(eligibility.reason ?? "Unavailable");
    if (eligibility.isHidden) {
      markDefenderIneligibleForHidden(data.defender);
    } else {
      markDefenderNoDefense(data.defender, reason);
    }
    await _updateCard(message, data);
    return;
  }
  const defenderMovementAction = _getTokenMovementAction(dToken);


  // Attacker weapon traits can restrict eligible defense options (e.g., Flail cannot be parried/countered).
  // Keep this deterministic and schema-safe.
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

  // Combat talent: Fearsome (OPTIONAL) — the defender may use Persuade(Strength) in place of Evade
  // when taking an Evade reaction against melee attacks.
  // We do NOT auto-apply this override; we prompt right after the defender selects "Evade".
  const fearsomeContext = getEvadeOverrideContext({
    defender,
    attackMode: data.context?.attackMode ?? "melee"
  });

  const interceptAllowed = Array.isArray(defenderData?.defenderIntercept?.allowedDefenseTypes)
    ? defenderData.defenderIntercept.allowedDefenseTypes
    : null;
  let allowedDefenseTypes = ctx.isAoE ? ["block", "evade"] : null;
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
  // label is used for roll flavor (e.g. "Parry — Defender Roll")
  data.defender.label = choice.label;
  data.defender.defenseLabel = choice.label;

  // For the chat card, "Test" must reflect the *actual test rolled*:
  //  - Evade: Evade
  //  - Parry/Block/Counter: the chosen Combat Style/Profession item name
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
    // Fallback: keep something readable rather than repeating the defense label.
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

  // Combat talents that modify defender TN outside the base TN computation.
  // (Lightning Reflexes: Parry vs ranged at -20)
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
        const doc = _resolveItemViaActor(uuid, attacker);
        return doc?.type === "weapon" ? doc : null;
      } catch { return null; }
    })();
    const defenderWeapon = (() => {
      try {
        const choiceUuid = String(choice?.weaponUuid ?? "").trim();
        if (choiceUuid) {
          const doc = _resolveItemViaActor(choiceUuid, defender);
          if (doc?.type === "weapon" && String(doc?.system?.attackMode ?? "melee").toLowerCase() === "melee") return doc;
        }
        for (const item of (defender?.items ?? [])) {
          if (item.type !== "weapon") continue;
          if (!item.system?.equipped) continue;
          if (String(item.system?.attackMode ?? "").toLowerCase() === "melee") return item;
        }
        return null;
      } catch { return null; }
    })();
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

  _logDebug("defenderDeclare", {
    defenderUuid: data.defender.actorUuid,
    attackerUuid: data.attacker.actorUuid,
    defenseType: data.defender.defenseType,
    tn
  });

  // Defender "none" is handled by the separate button, but keep safe.
  if (choice.defenseType === "none") {
    data.defender.noDefense = true;
    data.defender.result = { rollTotal: 100, target: 0, isSuccess: false, degree: 1 };
    await _updateCard(message, data);
  } else {
    const res = await doTestRoll(defender, { rollFormula: "1d100", target: data.defender.target, allowLucky: true, allowUnlucky: true });

    // Hyper Awareness: Evade tests may choose rolled DoS or Observe rank.
    if (choice.defenseType === "evade") {
      await applyHyperAwarenessToResult(defender, "Evade", res, { allowPrompt: true });
    }

    // Step Aside (Chapter 4): AoO Evade costs 0 AP unless the Evade test fails.
    const stepAside = defenderData?.stepAside ?? data.defender?.stepAside ?? null;
    if (stepAside?.deferredAp === 1 && choice.defenseType === "evade" && res.isSuccess !== true) {
      const ok = await ActionEconomy.spendAP(defender, 1, { reason: "reaction:evade:stepAsideFail", silent: true });
      stepAside.paid = Boolean(ok);
      stepAside.paidAt = Date.now();
      defenderData.stepAside = stepAside;
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
        defenseType: choice.defenseType,
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
      defenseType: String(choice?.defenseType ?? ""),
      testLabel: String(data?.defender?.testLabel ?? data?.defender?.label ?? ""),
      result: res,
      allowPrompt: true
    });

    const postSubRolls = _safeGetSetting("uesrpg-3ev4", "opposedPostSubRollMessages", true);
    if (postSubRolls) {
      // IMPORTANT: The defender may not have permission to update the parent opposed card
      // (ChatMessage authored by the attacker). We therefore include the computed TN and
      // defense choice metadata in the roll message flags so the GM/author banking hook can
      // accurately commit the defender lane into the parent card.
      await res.roll.toMessage({
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

    data.defender.result = {
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

    await _consumeInspireHeroismEffect(defender);

    // Dueling Weapon: grants +1 Degree of Success on successful Parry or Counter-Attack.
    if (res.isSuccess && (choice.defenseType === "parry" || choice.defenseType === "counter")) {
      try {
        const hasBuckler = hasEquippedShieldType(defender, "buckler", { allowLegacy: true });
        if (hasBuckler && choice.defenseType === "parry") {
          data.defender.result.degree = Math.max(1, (Number(data.defender.result.degree) || 1) + 1);
          data.defender.result.bucklerBonus = 1;
          data.defender.result.textual = `${data.defender.result.degree} DoS`;
        }

        const defWUuid = _getPreferredWeaponUuid(defender, { meleeOnly: true }) || "";
        if (defWUuid) {
          const defW = _resolveItemViaActor(defWUuid, defender);
          if (defW?.type === "weapon" && _weaponHasQuality(defW, "dueling")) {
            data.defender.result.degree = Math.max(1, (Number(data.defender.result.degree) || 1) + 1);
            data.defender.result.duelingBonus = 1;
            // Keep the displayed DoS/DoF string consistent with the modified degree.
            data.defender.result.textual = data.defender.result.isSuccess
              ? `${data.defender.result.degree} DoS`
              : `${data.defender.result.degree} DoF`;
          }
        }
      } catch (err) {
        console.warn("UESRPG | opposed-workflow | dueling weapon bonus lookup failed", err);
      }
    }

    // Combat talents: DoS adjustments already applied before roll message posting.
    await _maybeSetAoEEvadeEscape(data, data.defender, defender);
    
    // Resolve immediately if the attacker has already rolled.
    // For multi-defender scenarios, resolve all defenders who have rolled.
    if (data.attacker?.result) {
      const originalDefender = data.defender;
      const defenders = _getDefenderEntries(data);
      let resolvedAny = false;

      for (const def of defenders) {
        if (!def) continue;
        if (!(def.result || def.noDefense)) continue;
        if (_getDefenderOutcome(data, def)) continue;

        data.defender = def;
        const baseOutcome = _resolveOutcomeRAW(data, def) ?? { winner: "tie", text: "" };
        const outcome = _applyAoEEvadeOutcome(data, baseOutcome, def);
        _setDefenderOutcome(data, def, outcome);
        const advantage = _computeAdvantageRAW(data, outcome, def);
        _setDefenderAdvantage(data, def, advantage);
        await _maybeGrantConcussiveNextBash(attacker, data, advantage);
        resolvedAny = true;
      }

      if (resolvedAny) {
        const allResolved = defenders.every(def => Boolean(_getDefenderOutcome(data, def)));
        if (allResolved) {
          data.status = "resolved";
          data.context = data.context ?? {};
          data.context.phase = "resolved";
          if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
          _cleanupAutoRollContext(data.context);
        }
      }

      data.defender = originalDefender;
    }
    
    await _updateCard(message, data);
  }
}
