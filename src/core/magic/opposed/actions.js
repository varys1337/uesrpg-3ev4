/**
 * @module opposed-actions
 * src/core/magic/opposed/actions.js
 *
 * Consolidated opposed action handlers: dispatch, defend, resolve.
 *
 * Merges:
 *  - actions/banked-roll.js    → autoRollBanked
 *  - actions/defender-roll.js  → handleDefenderRoll, handleDefenderNoDefense, handleDefenderCharacteristicTest
 *  - actions/defender-commit.js → handleDefenderCommit
 *  - actions/dispatch.js       → dispatchAction
 *  - actions/resolve.js        → handleBlockResolve, handleWardResolve
 *
 * attacker.js remains a separate module (not merged).
 *
 * Target: Foundry VTT v13.351
 */

// ── External imports ─────────────────────────────────────────────────────────

// Schema / util (same directory)
import {
  getMessageState,
  selectDefenderEntry,
  isBankChoicesEnabledForData,
  markResolutionPhase,
  allDefendersCommitted,
  getDefenderEntries,
  getDefenderOutcome,
  ensureBankedScaffold,
  setMagicDefenderDamage
} from "./schema.js";

import { resolveActor, requireUserCanRollActor, resolveToken } from "./schema.js";
import { getOrCreateSharedSpellDamage, computeSpellDamageShared, spellNeedsEffectApplication } from "./spell-helpers.js";

// Attacker actions (kept separate)
import { handleAttackerCommit, handleAttackerRoll } from "./actions/attacker.js";

// Combat subsystem
import { doTestRoll } from "../../../utils/degree-roll-helper.js";
import { ActionEconomy } from "../../combat/action-economy.js";
import { hasEquippedShield } from "../../combat/tn.js";
import { hasActiveWard, getWardBlockRating, getActiveWardSpell } from "../../combat/ward-defense.js";
import { getBlockValue } from "../../combat/mitigation.js";
import { resolveHitLocationForTarget } from "../../combat/combat-utils.js";

// Magic subsystem
import { executeCharacteristicDefense, computeCharacteristicDefenseTN } from "../characteristic-defense-service.js";
import { getSpellDamageType } from "../magicka-utils.js";
import { applyMagicDamage } from "../damage-application.js";
import { applySpellEffectsToTarget } from "../effects/spell-effects.js";
import { applyRuntimePreRollToTN, applyRuntimePostRollToResult } from "../../traits/features/rule-element-runtime.js";

import { customDialog } from "../../../utils/dialog-v2-helper.js";

// Centralized card updater (single source of truth for card persistence).
import { updateCard } from "./updater.js";

// ── Constants ────────────────────────────────────────────────────────────────

const _FLAG_NS = "uesrpg-3ev4";

/**
 * Dispatch action to appropriate handler.
 * @param {ChatMessage} message
 * @param {string} action
 * @param {object} opts
 * @param {object} workflow - Reference to MagicOpposedWorkflow
 * @param {Function} renderCard - Card rendering function
 * @returns {Promise<void>}
 */
export async function dispatchAction(message, action, opts, workflow, renderCard) {
  const data = getMessageState(message);
  if (!data) return;

  const attacker = resolveActor(data.attacker.actorUuid);
  const { defender, defenderIndex, defenders } = selectDefenderEntry(data, opts);
  const defenderActor = resolveActor(defender?.actorUuid);

  if (!attacker || !defenderActor) {
    ui.notifications.warn("Could not resolve actors.");
    return;
  }

  const bankMode = isBankChoicesEnabledForData(data);

  // Build context object for handlers
  const ctx = {
    message,
    data,
    attacker,
    defender,
    defenderActor,
    defenderIndex,
    defenders,
    isMulti: defenders.length > 1,
    bankMode,
    opts,
    workflow,
    spell: null, // Will be resolved as needed by handlers
    // Helper functions
    resolveActor,
    _updateCard: (msg, d) => updateCard(msg, d, renderCard),
    _markResolutionPhase: markResolutionPhase,
    _allDefendersCommitted: allDefendersCommitted
  };

  // Resolve spell if needed
  if (data.attacker?.spellUuid) {
    ctx.spell = await fromUuid(data.attacker.spellUuid);
    if (!ctx.spell && (action === "attacker-roll" || action === "block-resolve" || action === "ward-resolve" || action === "defender-characteristic-test")) {
      ui.notifications.error("Could not resolve spell.");
      return;
    }
  }

  // Permission checks
  const isAttackerAction = action === "attacker-commit" || action === "attacker-roll";
  const isDefenderAction = action.startsWith("defender-");

  if (isAttackerAction && !requireUserCanRollActor(game.user, attacker)) return;
  if (isDefenderAction && !requireUserCanRollActor(game.user, defenderActor)) return;
  if ((action === "block-resolve" || action === "ward-resolve") && !requireUserCanRollActor(game.user, defenderActor)) return;

  // Dispatch to appropriate handler
  switch (action) {
    case "attacker-commit":
      return await handleAttackerCommit(ctx);

    case "attacker-roll":
      return await handleAttackerRoll(ctx);

    case "defender-commit-block":
    case "defender-commit-evade":
    case "defender-commit":
    case "defender-commit-characteristic":
    case "defender-commit-nodefense":
      return await handleDefenderCommit(ctx, action);

    case "defender-roll-block":
    case "defender-roll-evade":
    case "defender-roll-ward":
      return await handleDefenderRoll(ctx, action);

    case "defender-characteristic-test":
      return await handleDefenderCharacteristicTest(ctx);

    case "defender-no-defense":
      return await handleDefenderNoDefense(ctx);

    case "block-resolve":
      return await handleBlockResolve(ctx);

    case "ward-resolve":
      return await handleWardResolve(ctx);

    default:
      console.warn(`UESRPG | Unknown magic opposed action: ${action}`);
      return;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Banked Roll (from actions/banked-roll.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Auto-roll when all sides have committed (banked mode).
 *
 * Safeguards (mirroring combat orchestrator pattern):
 *  - Claim-ID protocol prevents duplicate auto-roll runs across clients.
 *  - Fresh state re-read after each roll prevents stale-data clobbering.
 *  - Sequential dispatch prevents cross-lane lost-update races.
 *
 * @param {ChatMessage} message
 * @param {object} workflow - Reference to MagicOpposedWorkflow
 * @param {Function} _updateCard - Card update function (injected dependency)
 * @returns {Promise<void>}
 */
export async function autoRollBanked(message, workflow, _updateCard) {
  let data = foundry.utils.deepClone(getMessageState(message));
  if (!data) return;

  // For banking: require ALL defenders to be committed before rolling
  if (!allDefendersCommitted(data)) return;

  const attacker = resolveActor(data.attacker.actorUuid);
  if (!attacker) return;

  // ── Claim-ID protocol ──────────────────────────────────────────────────
  // Prevent duplicate auto-roll runs if two runners attempt simultaneously.
  data.context = data.context ?? {};
  if (data.context.autoRollStarted) return;

  const claimId = foundry.utils.randomID();
  data.context.autoRollStarted = true;
  data.context.autoRollClaimId = claimId;
  data.context.autoRollStartedAt = Date.now();
  data.context.autoRollStartedBy = game.user.id;

  await _updateCard(message, data);

  // Verify we still own the claim after the persisted update.
  const freshAfterClaim = foundry.utils.deepClone(getMessageState(message));
  if (freshAfterClaim?.context?.autoRollClaimId && freshAfterClaim.context.autoRollClaimId !== claimId) return;

  // ── Roll attacker if not yet rolled ────────────────────────────────────
  if (!freshAfterClaim?.attacker?.result) {
    await workflow.handleAction(message, "attacker-roll");
  }

  // ── Roll defender lanes sequentially ───────────────────────────────────
  // Re-read fresh state to determine how many defenders exist.
  let currentData = foundry.utils.deepClone(getMessageState(message));
  if (!currentData) return;
  const defenderCount = getDefenderEntries(currentData).length;

  for (let idx = 0; idx < defenderCount; idx++) {
    // Re-read fresh state at the start of each iteration to avoid stale data.
    currentData = foundry.utils.deepClone(getMessageState(message));
    if (!currentData) return;

    const currentDefenders = getDefenderEntries(currentData);
    const def = currentDefenders[idx];
    if (!def) continue;

    const defActor = resolveActor(def?.actorUuid);
    if (!defActor) continue;

    // No-defense with result but no outcome → resolve immediately.
    if (def?.noDefense && def?.result && !getDefenderOutcome(currentData, def)) {
      await workflow._resolveOutcome(message, currentData, attacker, defActor, { defenderIndex: idx });
      continue;
    }

    // Needs a roll → dispatch the appropriate action.
    if (!def?.result && !def?.noDefense) {
      const defenseAction = def?.defenseType === "characteristic-save"
        ? "defender-characteristic-test"
        : def?.defenseType === "block"
          ? "defender-roll-block"
          : def?.defenseType === "ward"
            ? "defender-roll-ward"
            : "defender-roll-evade";
      await workflow.handleAction(message, defenseAction, { defenderIndex: idx });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Defender Roll (from actions/defender-roll.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle defender roll actions (block/evade).
 * @param {object} ctx - Context object
 * @param {string} action - Action type (defender-roll-block, defender-roll-evade)
 * @returns {Promise<void>}
 */
export async function handleDefenderRoll(ctx, action) {
  const { message, data, attacker, defender, defenderActor, defenderIndex, workflow } = ctx;

  if (defender?.result || defender?.noDefense) return;

  const apCost = Number(defender?.apCost ?? 1) || 1;
  const currentAP = Number(defenderActor?.system?.action_points?.value ?? 0) || 0;
  if (currentAP < apCost) {
    ui.notifications.warn("Not enough Action Points to defend against the spell.");
    return;
  }

  const defenseType = (action === "defender-roll-block") ? "block" : (action === "defender-roll-ward") ? "ward" : "evade";
  const defenseLabel = defenseType.charAt(0).toUpperCase() + defenseType.slice(1);

  const apSpentOk = await ActionEconomy.spendAP(defenderActor, apCost, { reason: `Defense (${defenseLabel})`, silent: false });
  if (!apSpentOk) return;

  const tnObj = (defenseType === "block" || defenseType === "ward") ? computeBlockTNWithBreakdown(defenderActor) : computeEvadeTNWithBreakdown(defenderActor);
  const manualMod = Number(defender?.declared?.manualMod ?? 0) || 0;
  const circumstanceMod = Number(defender?.declared?.circumstanceMod ?? 0) || 0;
  if (manualMod) {
    tnObj.breakdown = Array.isArray(tnObj.breakdown) ? tnObj.breakdown : [];
    tnObj.breakdown.push({ label: "Manual Modifier", value: manualMod });
  }
  if (circumstanceMod) {
    tnObj.breakdown = Array.isArray(tnObj.breakdown) ? tnObj.breakdown : [];
    tnObj.breakdown.push({ label: "Combat Circumstance", value: circumstanceMod });
  }
  tnObj.modifiers = tnObj.breakdown;
  tnObj.finalTN = Math.max(0, Number(tnObj.finalTN ?? 0) + manualMod + circumstanceMod);
  const attackerToken = resolveToken(data?.attacker?.tokenUuid);
  const runtimeDefenseItem = (() => {
    if (defenseType === "ward") return getActiveWardSpell(defenderActor);
    if (defenseType !== "block") return null;
    return Array.from(defenderActor?.items ?? []).find((i) =>
      (i?.type === "armor" || i?.type === "item")
      && i?.system?.equipped === true
      && Boolean(i?.system?.isShieldEffective ?? i?.system?.isShield)
    ) ?? null;
  })();
  applyRuntimePreRollToTN({
    actor: defenderActor,
    targetActor: attacker,
    targetToken: attackerToken,
    item: runtimeDefenseItem,
    rollContext: data?.context?.rollContext,
    workflow: "magic",
    side: "defender",
    attackMode: "magic",
    defenseType,
    tn: tnObj
  });
  const defenseTN = Number(tnObj.finalTN ?? 0) || 0;

  const result = await doTestRoll(defenderActor, {
    target: defenseTN,
    allowLucky: true,
    allowUnlucky: true
  });

  await applyRuntimePostRollToResult({
    actor: defenderActor,
    targetActor: attacker,
    targetToken: attackerToken,
    item: runtimeDefenseItem,
    rollContext: data?.context?.rollContext,
    workflow: "magic",
    side: "defender",
    attackMode: "magic",
    defenseType,
    result,
    allowPrompt: true
  });

  await result.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
    flavor: `<b>${defenseLabel}</b> vs ${data.attacker.spellName}`,
    flags: { [_FLAG_NS]: { magicOpposedMeta: { parentMessageId: message.id, stage: "defender", defenderIndex } } }
  });

  defender.result = result;
  defender.defenseType = defenseLabel;
  defender.tn = tnObj;

  await workflow._resolveOutcome(message, data, attacker, defenderActor, { defenderIndex });
}

/**
 * Handle defender no defense action.
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function handleDefenderNoDefense(ctx) {
  const { message, data, attacker, defender, defenderActor, defenderIndex, bankMode, workflow } = ctx;

  // This action should only be called in NON-banked mode
  // In banked mode, No Defense is committed and result is set immediately
  if (bankMode) {
    console.warn("UESRPG | defender-no-defense called in banked mode - this should not happen");
    return;
  }

  // No defense does not cost AP.
  if (defender?.result || defender?.noDefense) return;

  defender.noDefense = true;
  defender.defenseType = "-";
  defender.tn = null;
  defender.result = { rollTotal: 0, isSuccess: false, degree: 0, isCriticalSuccess: false, isCriticalFailure: false };

  await workflow._resolveOutcome(message, data, attacker, defenderActor, { defenderIndex });
}

/**
 * Handle defender characteristic test action.
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function handleDefenderCharacteristicTest(ctx) {
  const { message, data, attacker, defender, defenderActor, defenderIndex, workflow } = ctx;

  if (defender?.result || defender?.noDefense) return;

  // Characteristic defense doesn't cost AP - it's a saving throw
  // Use ctx.spell (resolved by dispatch) — ctx.attacker is the Actor doc, not the data object.
  const spell = ctx.spell ?? (data.attacker?.spellUuid ? await fromUuid(data.attacker.spellUuid) : null);
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
    targetToken: resolveToken(data?.attacker?.tokenUuid),
    rollContext: data?.context?.rollContext,
    postToChat: false
  });
  if (!defResult) {
    ui.notifications.error("Characteristic defense test failed to execute.");
    return;
  }

  // Post the roll to chat as a separate 3D dice card (like opposed combat tests)
  await defResult.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
    flavor: `<b>${defResult.characteristicLabel} Save</b>`,
    flags: { "uesrpg-3ev4": { magicOpposedMeta: { parentMessageId: message.id, stage: "defender", defenderIndex } } }
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

  await workflow._resolveOutcome(message, data, attacker, defenderActor, { defenderIndex });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Defender Commit (from actions/defender-commit.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sync defender object back to the correct data structure entry.
 * @private
 */
function syncDefenderToData(data, defender, defenderIndex) {
  if (defenderIndex != null && Array.isArray(data.defenders)) {
    data.defenders[defenderIndex] = defender;
  }
  // Always update data.defender for consistency (schema pattern)
  data.defender = defender;
}

/** @private */
async function promptDefenseCommitChoice(defenderActor) {
  const canBlock = hasEquippedShield(defenderActor);
  const canWard = hasActiveWard(defenderActor);
  return await customDialog({
    title: "Commit Defense",
    content: `
      <div class="uesrpg-adv-dialog uesrpg-adv-dialog--magic-commit">
        <div class="uesrpg-dialog-section-header">Defense Type</div>
        <div class="uesrpg-adv-grid">
          <label class="uesrpg-adv-choice">
            <input type="radio" name="defenseType" value="evade" checked/>
            <span class="uesrpg-adv-choice__label">
              <span class="uesrpg-adv-choice__title">Evade</span>
              <span class="uesrpg-adv-choice__desc">Use Evade TN.</span>
            </span>
          </label>
          <label class="uesrpg-adv-choice${canBlock ? "" : " disabled"}"${canBlock ? "" : ' style="opacity:0.5;pointer-events:none;"'}>
            <input type="radio" name="defenseType" value="block" ${canBlock ? "" : "disabled"}/>
            <span class="uesrpg-adv-choice__label">
              <span class="uesrpg-adv-choice__title">Block</span>
              <span class="uesrpg-adv-choice__desc">${canBlock ? "Use Block TN." : "Requires equipped shield."}</span>
            </span>
          </label>
          <label class="uesrpg-adv-choice${canWard ? "" : " disabled"}" style="grid-column:span 2;${canWard ? "" : "opacity:0.5;pointer-events:none;"}">
            <input type="radio" name="defenseType" value="ward" ${canWard ? "" : "disabled"}/>
            <span class="uesrpg-adv-choice__label">
              <span class="uesrpg-adv-choice__title">Ward</span>
              <span class="uesrpg-adv-choice__desc">${canWard ? "BR = Spell Strength. Power Block incompatible." : "Requires active Ward spell."}</span>
            </span>
          </label>
        </div>
        <div class="form-group">
          <label>Manual Modifier</label>
          <input type="number" name="manualMod" value="0" step="1" />
        </div>
        <div class="form-group">
          <label>Circumstance</label>
          <select name="circumstanceMod">
            <option value="0" selected>—</option>
            <option value="-10">Minor Disadvantage (-10)</option>
            <option value="-20">Disadvantage (-20)</option>
            <option value="-30">Major Disadvantage (-30)</option>
          </select>
        </div>
      </div>
    `,
    classes: ["uesrpg-attack-declare"],
    buttons: {
      confirm: {
        icon: '<i class="fas fa-check"></i>',
        label: "Commit",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const defenseTypeRaw = String(root?.querySelector('[name="defenseType"]:checked')?.value ?? "evade");
          const defenseType = (defenseTypeRaw === "block" && canBlock) ? "block"
            : (defenseTypeRaw === "ward" && canWard) ? "ward"
            : "evade";
          const manualMod = Number(root?.querySelector('[name="manualMod"]')?.value ?? 0) || 0;
          const circumstanceMod = Number(root?.querySelector('[name="circumstanceMod"]')?.value ?? 0) || 0;
          return { defenseType, manualMod, circumstanceMod };
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel",
        callback: () => null
      }
    },
    defaultButton: "confirm",
    width: 520,
  });
}

/**
 * Handle defender commit actions (banked mode).
 * @param {object} ctx - Context object
 * @param {string} action - Action type
 * @returns {Promise<void>}
 */
export async function handleDefenderCommit(ctx, action) {
  const { message, data, attacker, defender, defenderActor, bankMode, _updateCard } = ctx;

  if (!bankMode) return;
  if (defender?.result || defender?.noDefense) return;

  let selectedDefense = null;
  let selectedManualMod = 0;
  let selectedCircumstanceMod = 0;

  if (action === "defender-commit-characteristic") {
    // Characteristic defense: no choice needed, spell already defines the characteristic
    selectedDefense = "characteristic-save";

    // Pre-calculate TN for immediate display (before roll)
    // Use ctx.spell (resolved by dispatch) — ctx.attacker is the Actor doc, not data.
    const spell = ctx.spell ?? (data.attacker?.spellUuid ? await fromUuid(data.attacker.spellUuid) : null);
    if (spell) {
      const tnData = computeCharacteristicDefenseTN(defenderActor, spell);
      if (tnData) {
        applyRuntimePreRollToTN({
          actor: defenderActor,
          targetActor: attacker,
          targetToken: resolveToken(data?.attacker?.tokenUuid),
          item: spell,
          rollContext: data?.context?.rollContext,
          workflow: "magic",
          side: "defender",
          attackMode: "magic",
          defenseType: "characteristic-save",
          tn: tnData
        });
        defender.tn = {
          finalTN: tnData.finalTN,
          baseTN: tnData.baseTN,
          totalMod: tnData.totalMod,
          breakdown: tnData.breakdown
        };
        defender.characteristicLabel = tnData.chaLabel;
      }
    }
  } else if (action === "defender-commit") {
    const picked = await promptDefenseCommitChoice(defenderActor);
    if (!picked) return;
    selectedDefense = picked.defenseType;
    selectedManualMod = Number(picked.manualMod ?? 0) || 0;
    selectedCircumstanceMod = Number(picked.circumstanceMod ?? 0) || 0;
  }

  // CRITICAL: Sync defender modifications back to data structure before validation
  const { defenderIndex } = ctx;
  syncDefenderToData(data, defender, defenderIndex);

  // Gate commit if defender cannot currently pay the AP cost for their chosen defense.
  // CRITICAL: No Defense and Characteristic Save do NOT cost AP, so skip the check.
  const isNoDefenseAction = action === "defender-commit-nodefense";
  const isCharacteristicAction = action === "defender-commit-characteristic";
  if (game.combat && !isNoDefenseAction && !isCharacteristicAction) {
    const apCost = Number(defender?.apCost ?? 1) || 1;
    const currentAP = Number(foundry.utils.getProperty(defenderActor, "system.action_points.value") ?? 0);
    if (currentAP < apCost) {
      ui.notifications.warn(`Not enough Action Points to commit defense (${currentAP}/${apCost}).`);
      return;
    }
  }

  ensureBankedScaffold(data);

  // Store defense choice
  if (isNoDefenseAction) {
    defender.defenseType = "none";
    defender.noDefense = true;

    // CRITICAL FIX: Set result immediately so _autoRollBanked doesn't call defender-no-defense again
    defender.tn = { finalTN: 0, baseTN: 0, totalMod: 0, breakdown: [{ key: "base", label: "No Defense", value: 0, source: "base" }] };
    defender.result = { rollTotal: 0, isSuccess: false, degree: 0, isCriticalSuccess: false, isCriticalFailure: false };
  } else {
    const defenseType = selectedDefense ?? ((action === "defender-commit-block") ? "block" : "evade");
    defender.defenseType = defenseType;
    defender.noDefense = false;
    defender.declared = {
      manualMod: selectedManualMod,
      circumstanceMod: selectedCircumstanceMod
    };
  }

  defender.banked.committed = true;
  defender.banked.committedAt = Date.now();
  defender.banked.committedBy = game.user.id;

  // Sync final state back to data structure before card update
  syncDefenderToData(data, defender, defenderIndex);

  await _updateCard(message, data);

  // Auto-roll is triggered solely via the updateChatMessage hook path
  // (maybeAutoRollBanked) to prevent duplicate runs.
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Block & Ward Resolve (from actions/resolve.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle block resolve action.
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function handleBlockResolve(ctx) {
  const { message, data, attacker, defender, defenderActor, spell } = ctx;

  const outcome = getDefenderOutcome(data, defender);
  if (!outcome || !outcome.needsBlockResolution) {
    ui.notifications.warn("Block resolution is only available when the defender wins by blocking (both passed).");
    return;
  }

  // Get equipped shield
  const shields = defenderActor.items?.filter(i => {
    if (!(i.type === "armor" || i.type === "item")) return false;
    if (i.system?.equipped !== true) return false;
    if (!Boolean(i.system?.isShieldEffective ?? i.system?.isShield)) return false;
    const shieldType = String(i.system?.shieldType || "normal").toLowerCase();
    if (shieldType === "buckler") return false;
    return true;
  }) ?? [];
  const shield = shields[0] ?? null;
  if (!shield) {
    ui.notifications.warn("No equipped shield found on the defender.");
    return;
  }

  // Roll spell damage
  const spellOptions = data.attacker.spellOptions ?? {};
  const damageType = getSpellDamageType(spell);
  const isCritical = Boolean(data.attacker.result?.isCriticalSuccess);
  const sharedDamage = await getOrCreateSharedSpellDamage({ data, attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
  const damageInfo = sharedDamage ?? await computeSpellDamageShared({ attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
  const damageValue = Number(damageInfo?.damageValue ?? 0) || 0;
  const rollHTML = damageInfo?.rollHTML ?? "";

  // Get Block Rating (magic damage treats BR as half, round up, unless magic BR exists)
  const br = getBlockValue(shield, damageType);
  const blocked = damageValue <= br;

  const shieldArm = "Left Arm";
  const resolvedShieldArm = resolveHitLocationForTarget(defenderActor, shieldArm);
  const appliedDamage = blocked ? 0 : damageValue;

  // Store block result and damage data inline on the parent card
  const blockResult = { blocked, blockRating: br, shieldName: shield?.name ?? "Shield", isAoE: false };
  const dmgData = {
    rolled: true,
    mode: "block",
    finalDamage: appliedDamage,
    damageString: rollHTML,
    hitLocation: blocked ? "—" : resolvedShieldArm,
    weaponName: spell.name,
    weaponImg: spell.img ?? "",
    qualityPillsHtml: "",
    applied: blocked ? true : false,
    blockResult,
    applyPayload: {
      targetUuid: defenderActor.uuid,
      targetName: defenderActor.name,
      magic: "1",
    },
    _magicPayload: {
      damage: appliedDamage,
      damageType,
      spellUuid: spell.uuid ?? "",
      casterUuid: attacker.uuid ?? "",
      hitLocation: resolvedShieldArm,
      isCritical,
      source: spell.name,
      magicCost: Number(data.attacker?.mpSpent ?? data.context?.mpSpent ?? spell.system?.cost ?? 0),
      rollHTML,
      isOverloaded: Boolean(damageInfo?.isOverloaded),
      overloadBonus: Number(damageInfo?.overloadBonus ?? 0) || 0,
      isOvercharged: Boolean(damageInfo?.isOvercharged),
      overchargeTotals: Array.isArray(damageInfo?.overchargeTotals) ? damageInfo.overchargeTotals : null,
      elementalBonus: Number(damageInfo?.elementalBonus ?? 0) || 0,
      elementalBonusLabel: String(damageInfo?.elementalBonusLabel ?? ""),
      actualCost: Number(data.attacker?.mpSpent ?? data.context?.mpSpent ?? spell.system?.cost ?? 0),
      originalCastWorldTime: Number(data.context?.originalCastWorldTime ?? game?.time?.worldTime ?? 0) || 0,
      defenseType: "block",
      isDamaging: !blocked,
      needsEffects: !blocked && Boolean(spellNeedsEffectApplication(spell)),
    },
  };
  setMagicDefenderDamage(data, defender, dmgData);
  // Clear needsBlockResolution so the button disappears
  outcome.needsBlockResolution = false;
  await ctx._updateCard(message, data);
}

/**
 * Handle ward resolve action for magic opposed workflow.
 * Ward uses Spell Strength as BR for all damage types. Power Block is incompatible.
 * @param {object} ctx - Context object
 * @returns {Promise<void>}
 */
export async function handleWardResolve(ctx) {
  const { message, data, attacker, defender, defenderActor, spell } = ctx;

  const outcome = getDefenderOutcome(data, defender);
  if (!outcome || !outcome.needsBlockResolution) {
    ui.notifications.warn("Ward resolution is only available when the defender wins by warding (both passed).");
    return;
  }

  // Get active Ward spell and its BR
  const wardSpell = getActiveWardSpell(defenderActor);
  if (!wardSpell) {
    ui.notifications.warn("No active Ward spell found on the defender.");
    return;
  }
  const wardBR = getWardBlockRating(defenderActor);
  const wardName = wardSpell.name ?? "Ward";

  // Roll spell damage
  const spellOptions = data.attacker.spellOptions ?? {};
  const damageType = getSpellDamageType(spell);
  const isCritical = Boolean(data.attacker.result?.isCriticalSuccess);
  const sharedDamage = await getOrCreateSharedSpellDamage({ data, attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
  const damageInfo = sharedDamage ?? await computeSpellDamageShared({ attacker, spell, spellOptions, isCritical, damageType, parentMessageId: message.id });
  const damageValue = Number(damageInfo?.damageValue ?? 0) || 0;
  const rollHTML = damageInfo?.rollHTML ?? "";

  // Ward BR applies equally to ALL damage types (no halving)
  const br = wardBR;
  const blocked = damageValue <= br;

  const wardArm = "Left Arm";
  const resolvedWardArm = resolveHitLocationForTarget(defenderActor, wardArm);
  const appliedDamage = blocked ? 0 : damageValue;

  // Store ward result and damage data inline on the parent card
  const wardResult = { blocked, wardBR: br, wardName, isAoE: false };
  const dmgData = {
    rolled: true,
    mode: "ward",
    finalDamage: appliedDamage,
    damageString: rollHTML,
    hitLocation: blocked ? "—" : resolvedWardArm,
    weaponName: spell.name,
    weaponImg: spell.img ?? "",
    qualityPillsHtml: "",
    applied: blocked ? true : false,
    wardResult,
    applyPayload: {
      targetUuid: defenderActor.uuid,
      targetName: defenderActor.name,
      magic: "1",
    },
    _magicPayload: {
      damage: appliedDamage,
      damageType,
      spellUuid: spell.uuid ?? "",
      casterUuid: attacker.uuid ?? "",
      hitLocation: resolvedWardArm,
      isCritical,
      source: spell.name,
      magicCost: Number(data.attacker?.mpSpent ?? data.context?.mpSpent ?? spell.system?.cost ?? 0),
      rollHTML,
      isOverloaded: Boolean(damageInfo?.isOverloaded),
      overloadBonus: Number(damageInfo?.overloadBonus ?? 0) || 0,
      isOvercharged: Boolean(damageInfo?.isOvercharged),
      overchargeTotals: Array.isArray(damageInfo?.overchargeTotals) ? damageInfo.overchargeTotals : null,
      elementalBonus: Number(damageInfo?.elementalBonus ?? 0) || 0,
      elementalBonusLabel: String(damageInfo?.elementalBonusLabel ?? ""),
      actualCost: Number(data.attacker?.mpSpent ?? data.context?.mpSpent ?? spell.system?.cost ?? 0),
      originalCastWorldTime: Number(data.context?.originalCastWorldTime ?? game?.time?.worldTime ?? 0) || 0,
      defenseType: "ward",
      isDamaging: !blocked,
      needsEffects: !blocked && Boolean(spellNeedsEffectApplication(spell)),
    },
  };
  setMagicDefenderDamage(data, defender, dmgData);
  // Clear needsBlockResolution so the button disappears
  outcome.needsBlockResolution = false;
  await ctx._updateCard(message, data);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Defense TN Calculation (merged from defense-tn.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute evade TN with breakdown.
 * @param {Actor} defender
 * @returns {{finalTN: number, breakdown: Array, modifiers: Array}}
 */
export function computeEvadeTNWithBreakdown(defender) {
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
