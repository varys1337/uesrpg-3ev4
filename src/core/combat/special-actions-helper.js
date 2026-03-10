/**
 * src/core/combat/special-actions-helper.js
 * 
 * Full automation for Special Actions (Chapter 5) with:
 * - Interactive opposed test cards with action buttons
 * - Combat Style OR Skill choice for both attacker and defender
 * - Special Advantage mode selection (Free Action OR Auto-Win)
 * - Active Effect automation using system condition engine
 */

import { hasCondition, applyCondition, removeCondition } from "../conditions/condition-engine.js";
import { toggleInCloseBetweenActors } from "../conditions/in-close.js";
import {
  getSpecialActionById,
  buildSpecialActionTestChoicesForActor,
  getSpecialActionTestOption,
  getSpecialActionTestOptionKeys
} from "./combat-style-utils.js";
import { ActionEconomy } from "./action-economy.js";
import { TimeService, buildEffectDuration } from "../time/index.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { _resolveActorViaToken } from "./opposed/helpers/docs.js";
import { safeUpdateChatMessage } from "../../utils/chat-message-socket.js";
import { requestUpdateDocument, requestUpdateEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../system/namespace.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { getFlagValueWithFallback } from "../system/flags.js";
const HOOKED_ACTION_IDS = new Set(["disarm", "trip", "takeWeapon", "take-weapon"]);
const _GRAPPLE_ACTION_LOCKS = new Set();
const _GRAPPLE_OWNER_PREFIX = "grappleOwner:";
const _SIZE_INDEX = Object.freeze({
  puny: 0,
  tiny: 1,
  small: 2,
  standard: 3,
  large: 4,
  huge: 5,
  enormous: 6,
});

function _normalizeSizeKey(size) {
  const raw = String(size ?? "standard").trim().toLowerCase();
  if (raw === "punity") return "puny";
  return Object.prototype.hasOwnProperty.call(_SIZE_INDEX, raw) ? raw : "standard";
}

function _sizeIndex(size) {
  return _SIZE_INDEX[_normalizeSizeKey(size)] ?? _SIZE_INDEX.standard;
}

function _getGrappleSizeResult(attacker, defender) {
  const attackerSize = _sizeIndex(attacker?.system?.size);
  const defenderSize = _sizeIndex(defender?.system?.size);
  const delta = attackerSize - defenderSize;
  if (delta <= -2) {
    return { blocked: true, modifier: 0, reason: "Target is two or more size categories larger." };
  }
  if (delta < 0) {
    return { blocked: false, modifier: -30, reason: "Target is larger." };
  }
  return { blocked: false, modifier: 0, reason: "" };
}

function _grappleOwnerTag(actor) {
  return `${_GRAPPLE_OWNER_PREFIX}${String(actor?.uuid ?? actor?.id ?? "").trim()}`;
}

async function _stampConditionSource(actor, conditionKey, sourceTag) {
  if (!actor || !conditionKey || !sourceTag) return;
  const effect = (actor.effects ?? []).find((e) => {
    if (e?.disabled) return false;
    return getFlagValueWithFallback(e, "condition.key") === conditionKey;
  });
  if (!effect) return;
  const existing = String(getFlagValueWithFallback(effect, "condition.source") ?? "").trim();
  if (existing === sourceTag) return;
  await requestUpdateDocument(effect, {
    [`flags.${FLAG_SCOPE}.condition.source`]: sourceTag,
  });
}

function _isTargetGrappledByActor(target, actor) {
  if (!target || !actor) return false;
  const ownerTag = _grappleOwnerTag(actor);
  return (target.effects ?? []).some((effect) => {
    if (effect?.disabled) return false;
    const key = String(getFlagValueWithFallback(effect, "condition.key") ?? "").trim().toLowerCase();
    if (key !== "restrained" && key !== "grappled") return false;
    const source = String(getFlagValueWithFallback(effect, "condition.source") ?? "").trim();
    return source === ownerTag;
  });
}

async function _showGrappleFollowUpChoice() {
  const choice = await customDialog({
    title: "Grapple Follow-Up",
    content: `<div style="display:flex;flex-direction:column;gap:8px;">
      <p style="margin:0;">Target is already grappled by you. Choose a follow-up action:</p>
    </div>`,
    buttons: {
      takedown: { label: "Takedown", callback: () => "takedown" },
      move: { label: "Move", callback: () => "move" },
      attack: { label: "Attack", callback: () => "attack" },
      cancel: { label: "Cancel", callback: () => null },
    },
    defaultButton: "takedown",
    rejectClose: false,
  });
  return String(choice ?? "");
}

function _itemHasQualityToken(item, key) {
  const wanted = String(key ?? "").trim().toLowerCase();
  if (!item || !wanted) return false;
  const structured = Array.isArray(item.system?.qualitiesStructuredInjected)
    ? item.system.qualitiesStructuredInjected
    : (Array.isArray(item.system?.qualitiesStructured) ? item.system.qualitiesStructured : []);
  const traits = Array.isArray(item.system?.qualitiesTraitsInjected)
    ? item.system.qualitiesTraitsInjected
    : (Array.isArray(item.system?.qualitiesTraits) ? item.system.qualitiesTraits : []);
  return structured.some(q => String(q?.key ?? q ?? "").toLowerCase() === wanted)
    || traits.some(t => String(t ?? "").toLowerCase() === wanted);
}

function _getPreferredWeapon(actor) {
  if (!actor) return null;
  const fromBindingIds = [
    actor?.system?.equippedWeapons?.primaryWeapon?.id,
    actor?.system?.equippedWeapons?.secondaryWeapon?.id,
    actor?.system?.equippedWeapons?.equippedWeapons?.primaryWeapon?.id,
    actor?.system?.equippedWeapons?.equippedWeapons?.secondaryWeapon?.id
  ].filter(Boolean);
  for (const id of fromBindingIds) {
    const it = actor.items?.get?.(id);
    if (it?.type === "weapon") return it;
  }
  return (actor.items ?? []).find(i => i?.type === "weapon" && i?.system?.equipped === true) ?? null;
}

function _getConcussiveNextBashBonus(actor) {
  const raw = actor?.getFlag?.(SYSTEM_ID, "combat.concussiveNextBash");
  if (typeof raw === "number") return Math.max(0, Number(raw) || 0);
  if (raw && typeof raw === "object") return Math.max(0, Number(raw?.bonus ?? 0) || 0);
  return 0;
}

async function _consumeConcussiveNextBashBonus(actor) {
  if (!actor) return;
  await requestUpdateDocument(actor, { [`flags.${SYSTEM_ID}.combat.-=concussiveNextBash`]: null });
}

/**
 * Simple HTML escape to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function _escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Show Special Advantage mode selection dialog.
 * @param {string} specialActionId 
 * @returns {Promise<{mode: "free"|"autowin"}|null>}
 */
export async function showSpecialAdvantageDialog(specialActionId) {
  const def = getSpecialActionById(specialActionId);
  if (!def) return null;

  return customDialog({
    title: `Special Advantage: ${def.name}`,
    content: `
      <div style="padding: 10px;">
        <p>You are using <strong>${def.name}</strong> as a Special Advantage.</p>
        <p>Choose how to use it:</p>
        <div>
          <div style="margin: 10px 0;">
            <label>
              <input type="radio" name="advMode" value="free" checked>
              <strong>Free Action</strong> - No AP cost, but roll opposed test normally
            </label>
          </div>
          <div style="margin: 10px 0;">
            <label>
              <input type="radio" name="advMode" value="autowin">
              <strong>Auto-Win</strong> - Automatically win the opposed test (still costs AP if not using as advantage)
            </label>
          </div>
        </div>
      </div>
    `,
    buttons: {
      confirm: {
        label: "Confirm",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const selected = root?.querySelector('input[name="advMode"]:checked')?.value ?? "free";
          return { mode: selected };
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    defaultButton: "confirm",
  });
}

/**
 * Show test choice dialog BEFORE creating opposed card (NEW PRE-CHOICE FLOW).
 * Returns: { testType: "combatStyle" | "athletics" | "evade" | etc., skillUuid: "..." }
 * @param {Object} options
 * @param {string} options.specialActionId - Special action ID
 * @param {Actor} options.actor - Actor making the choice
 * @param {boolean} options.isDefender - Whether this is for the defender
 * @returns {Promise<{testType: string, skillUuid: string}|null>}
 */
export async function showPreTestChoiceDialog({ specialActionId, actor, isDefender = false }) {
  const def = getSpecialActionById(specialActionId);
  if (!def) return null;

  const side = isDefender ? "defender" : "attacker";
  const choices = buildSpecialActionTestChoicesForActor(actor, { specialActionId, side })
    .map((choice, idx) => ({
      value: String(choice?.testType ?? ""),
      label: String(choice?.label ?? choice?.skillUuid ?? "Test"),
      skillUuid: String(choice?.skillUuid ?? ""),
      checked: idx === 0
    }))
    .filter(choice => Boolean(choice.skillUuid));

  if (choices.length === 0) {
    ui.notifications.warn(`${actor.name} has no valid options for ${def.name}. Check that they have the required Combat Styles or Skills.`);
    return null;
  }

  // Only show dialog if there are multiple choices
  if (choices.length === 1) {
    return {
      testType: choices[0].value,
      skillUuid: choices[0].skillUuid
    };
  }

  const content = `
    <div class="uesrpg-special-action-test-choice">
      <p><b>Special Action: ${_escapeHtml(def.name)}</b></p>
      <p>Choose your ${isDefender ? 'defense' : 'test'}:</p>
      <div style="margin: 12px 0;">
        ${choices.map(opt => `
          <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <input type="radio" name="testChoice" value="${_escapeHtml(opt.value)}" data-skill-uuid="${_escapeHtml(opt.skillUuid)}" ${opt.checked ? 'checked' : ''} />
            <span><b>${_escapeHtml(opt.label)}</b></span>
          </label>
        `).join('')}
      </div>
    </div>
  `;

  try {
    const result = await customDialog({
      title: `Special Action: ${def.name}`,
      content,
      buttons: {
        ok: {
          label: "Confirm",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const selected = root?.querySelector('input[name="testChoice"]:checked');
            const testType = selected?.value;
            const skillUuid = selected?.dataset?.skillUuid;
            
            return { testType, skillUuid };
          }
        },
        cancel: { label: "Cancel", callback: () => null }
      },
      default: "ok",
      width: 400
    });

    return result ?? null;
  } catch (_e) {
    return null;
  }
}

/**
 * Get available test option labels for a Special Action side.
 * @param {string} specialActionId
 * @param {"attacker"|"defender"} side
 * @returns {string[]}
 */
function _getSpecialActionOptionLabels(specialActionId, side) {
  const keys = getSpecialActionTestOptionKeys(specialActionId, side);
  const labels = [];
  for (const key of keys) {
    const opt = getSpecialActionTestOption(key);
    if (opt?.label) labels.push(String(opt.label));
  }
  return labels;
}

/**
 * Get available test options for a Special Action.
 * @param {string} specialActionId
 * @param {"attacker"|"defender"} side
 * @returns {string[]}
 */
function _getTestOptions(specialActionId, side) {
  const lane = (side === "defender") ? "defender" : "attacker";
  return _getSpecialActionOptionLabels(specialActionId, lane);
}

/**
 * Render interactive Special Action card HTML.
 * @param {Object} data - Card data
 * @param {string} messageId - Chat message ID
 * @returns {string}
 */
function _renderSpecialActionCard(data, messageId) {
  const { specialActionId, attacker, defender, isFreeAction } = data;
  const def = getSpecialActionById(specialActionId);
  const name = def?.name ?? "Special Action";

  const attackerOptions = _getTestOptions(specialActionId, "attacker");
  const defenderOptions = _getTestOptions(specialActionId, "defender");

  const attackerOptionsText = attackerOptions.join(", ");
  const defenderOptionsText = defenderOptions.join(", ");

  const attackerSection = attacker.result
    ? `<div><strong>${attacker.name}:</strong> ${attacker.testLabel} - ${attacker.result.isSuccess ? 'Success' : 'Failure'} (${attacker.result.rollTotal}/${attacker.result.target})</div>`
    : `<div><strong>${attacker.name}:</strong> <button class="ues-special-action-btn" data-ues-special-action="attacker-roll">Roll Test</button> (${attackerOptionsText})</div>`;

  const defenderSection = defender.result
    ? `<div><strong>${defender.name}:</strong> ${defender.testLabel} - ${defender.result.isSuccess ? 'Success' : 'Failure'} (${defender.result.rollTotal}/${defender.result.target})</div>`
    : `<div><strong>${defender.name}:</strong> <button class="ues-special-action-btn" data-ues-special-action="defender-roll">Roll Opposed</button> (${defenderOptionsText})</div>`;

  let outcomeSection = '';
  if (attacker.result && defender.result && data.outcome) {
    outcomeSection = `
      <div style="margin-top: 12px; padding: 8px; background: rgba(0,0,0,0.1); border-radius: 4px;">
        <strong>Outcome:</strong> ${data.outcome.text}
        ${data.outcome.effectMessage ? `<br><em>${data.outcome.effectMessage}</em>` : ''}
      </div>
    `;
  }
  const notes = Array.isArray(data.notes) ? data.notes.map((note) => String(note ?? "").trim()).filter(Boolean) : [];
  const notesSection = notes.length
    ? `<div style="margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 4px;">
        ${notes.map((note) => `<div style="font-size:12px; line-height:1.35;">${_escapeHtml(note)}</div>`).join("")}
      </div>`
    : "";

  const freeText = isFreeAction ? '<div style="font-style: italic; font-size: 12px; opacity: 0.8;">(Special Advantage: Free Action)</div>' : '';

  return `
    <div class="uesrpg-special-action-card" style="padding: 12px; border: 1px solid #999; border-radius: 4px; background: rgba(255,255,255,0.05);">
      <h3 style="margin: 0 0 8px 0;">Special Action: ${name}</h3>
      ${freeText}
      <div style="margin: 8px 0;">
        ${attackerSection}
      </div>
      <div style="margin: 8px 0;">
        ${defenderSection}
      </div>
      ${outcomeSection}
      ${notesSection}
    </div>
  `;
}

/**
 * Create an interactive opposed test card for a Special Action.
 * @param {Object} options
 * @param {string} options.specialActionId
 * @param {Token} options.attackerToken
 * @param {Token} options.defenderToken
 * @param {boolean} options.isFreeAction
 * @returns {Promise<ChatMessage>}
 */
export async function createSpecialActionOpposedTest({
  specialActionId,
  attackerToken,
  defenderToken,
  isFreeAction = false
}) {
  const def = getSpecialActionById(specialActionId);
  if (!def) return null;

  const attacker = attackerToken?.actor ?? null;
  const defender = defenderToken?.actor ?? null;

  if (!attacker || !defender) {
    ui.notifications.warn("Could not resolve attacker or defender.");
    return null;
  }

  const data = {
    specialActionId,
    isFreeAction,
    attacker: {
      name: attacker.name,
      actorUuid: attacker.uuid,
      tokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
      result: null,
      testLabel: null
    },
    defender: {
      name: defender.name,
      actorUuid: defender.uuid,
      tokenUuid: defenderToken.document?.uuid ?? defenderToken.uuid,
      result: null,
      testLabel: null
    },
    outcome: null
  };

  const content = _renderSpecialActionCard(data, "pending");

  const message = await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: attacker, token: attackerToken.document ?? null }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      [SYSTEM_ID]: {
        specialActionOpposed: {
          state: data
        }
      }
    }
  });

  return message;
}

/**
 * Handle Special Action card button clicks.
 * @param {ChatMessage} message
 * @param {string} action - "attacker-roll" or "defender-roll"
 */
export async function handleSpecialActionCardAction(message, action) {
  try {
    // Import helpers once at the start
    const { doTestRoll, resolveOpposed } = await import("../../utils/degree-roll-helper.js");
    
    const data = message.flags?.[SYSTEM_ID]?.specialActionOpposed?.state;
    if (!data) return;

    const { specialActionId, attacker, defender, isFreeAction } = data;
    const def = getSpecialActionById(specialActionId);
    if (!def) return;

    const isAttacker = action === "attacker-roll";
    const side = isAttacker ? attacker : defender;
    const actor = _resolveActorViaToken(side.actorUuid, side.tokenUuid);

    if (!actor) {
      ui.notifications.warn("Could not resolve actor for this action.");
      return;
    }

    // Check if already rolled
    if (side.result) {
      ui.notifications.warn(`${side.name} has already rolled.`);
      return;
    }

    // Show legal test choice dialog for this side.
    const choice = await showPreTestChoiceDialog({
      specialActionId,
      actor,
      isDefender: !isAttacker
    });

    if (!choice) return;

    // Perform roll
    let rollResult;
    let testLabel;
    let consumeConcussiveAfterRoll = false;
    const attackerActor = _resolveActorViaToken(attacker.actorUuid, attacker.tokenUuid);
    let specialActionTNMod = 0;
    if (isAttacker && specialActionId === "bash") {
      const bonus = _getConcussiveNextBashBonus(actor);
      if (bonus > 0) {
        specialActionTNMod += bonus;
        consumeConcussiveAfterRoll = true;
      }
    }
    if (isAttacker && specialActionId === "grapple") {
      const defenderActor = _resolveActorViaToken(defender.actorUuid, defender.tokenUuid);
      const sizeRule = _getGrappleSizeResult(actor, defenderActor);
      if (sizeRule.blocked) {
        ui.notifications?.warn?.("Grapple failed: target is two or more size categories larger.");
        return;
      }
      specialActionTNMod += Number(sizeRule.modifier ?? 0) || 0;
    }
    if (!isAttacker && HOOKED_ACTION_IDS.has(specialActionId)) {
      const atkWeapon = _getPreferredWeapon(attackerActor);
      if (atkWeapon && _itemHasQualityToken(atkWeapon, "hooked")) {
        specialActionTNMod -= 10;
      }
    }
    const selectedSkillUuid = String(choice.skillUuid ?? "").trim();
    const selectedItem = (actor?.items ?? []).find(i => String(i?.uuid ?? "") === selectedSkillUuid || String(i?.id ?? "") === selectedSkillUuid) ?? null;
    const isCombatStyleTest = selectedSkillUuid.startsWith("prof:combat") || selectedItem?.type === "combatStyle";

    if (isCombatStyleTest) {
      const { computeTN } = await import("./tn.js");
      // Chapter 5: Size-to-hit modifier should apply to the attacker side of Special Actions.
      // This helper uses computeTN as a generic "Combat Style TN" resolver for both sides.
      // To avoid incorrectly applying size-to-hit to the defender roll, only pass opponent size
      // when the current side is the attacker.
      const opponentActor = isAttacker
        ? _resolveActorViaToken(defender.actorUuid, defender.tokenUuid)
        : null;

      const tn = computeTN({
        actor,
        role: "attacker",
        styleUuid: selectedSkillUuid,
        variant: "normal",
        manualMod: 0,
        circumstanceMod: 0,
        situationalMods: [],
        context: {
          attackMode: "melee",
          opponentActor: isAttacker ? (opponentActor ?? null) : null,
          opponentUuid: isAttacker ? (opponentActor?.uuid ?? null) : null,
          selfSize: actor?.system?.size,
          opponentSize: (isAttacker && specialActionId !== "grapple") ? (opponentActor?.system?.size ?? null) : null
        }
      });
      tn.finalTN = Math.max(0, Number(tn.finalTN ?? 0) + specialActionTNMod);
      tn.totalMod = Number(tn.totalMod ?? 0) + specialActionTNMod;

      rollResult = await doTestRoll(actor, {
        rollFormula: "1d100",
        target: tn.finalTN,
        allowLucky: true,
        allowUnlucky: true
      });
      testLabel = String(choice.testType || "Combat Style");
    } else {
      let tn = null;

      if (selectedSkillUuid.startsWith("prof:")) {
        const key = selectedSkillUuid.slice(5);
        const sys = actor?.system ?? {};
        const base = Number(sys?.professions?.[key] ?? sys?.professionsWound?.[key] ?? 0) || 0;
        const fatiguePenalty = Number(sys?.fatigue?.penalty ?? 0) || 0;
        const carryPenalty = Number(sys?.carry_rating?.penalty ?? 0) || 0;
        const woundPenalty = Number(sys?.woundPenalty ?? 0) || 0;
        const finalTN = Math.max(0, base + fatiguePenalty + carryPenalty + woundPenalty);
        tn = { finalTN, baseTN: base, totalMod: fatiguePenalty + carryPenalty + woundPenalty, breakdown: [] };
      } else {
        const skillItem = selectedItem?.type === "skill" ? selectedItem : null;
        if (!skillItem) {
          ui.notifications.warn(`${actor.name} has no legal skill selection for ${def.name}.`);
          return;
        }

        const { computeSkillTN } = await import("../skills/skill-tn.js");
        tn = computeSkillTN({
          actor,
          skillItem,
          difficultyKey: "average",
          manualMod: 0
        });
        tn.finalTN = Math.max(0, Number(tn.finalTN ?? 0) + specialActionTNMod);
        tn.totalMod = Number(tn.totalMod ?? 0) + specialActionTNMod;
      }

      rollResult = await doTestRoll(actor, {
        rollFormula: "1d100",
        target: tn.finalTN,
        allowLucky: true,
        allowUnlucky: true
      });
      testLabel = String(choice.testType || selectedItem?.name || "Skill");
    }

    // Update side with result
    side.result = rollResult;
    side.testLabel = testLabel;
    if (consumeConcussiveAfterRoll) {
      await _consumeConcussiveNextBashBonus(actor);
    }

    // Check if both have rolled
    if (attacker.result && defender.result) {
      // Resolve outcome
      let opposedResult = resolveOpposed(attacker.result, defender.result);

      // Chapter 5 (Combat Criticals): if both sides roll any critical (success or failure),
      // neither attack nor defense resolves.
      const aCrit = Boolean(attacker.result?.isCriticalSuccess || attacker.result?.isCriticalFailure);
      const dCrit = Boolean(defender.result?.isCriticalSuccess || defender.result?.isCriticalFailure);
      if (aCrit && dCrit) {
        opposedResult = { winner: "tie", reason: "both sides roll a critical" };
      }

      const outcomeText = opposedResult.winner === "attacker"
        ? `${attacker.name} wins!`
        : (opposedResult.winner === "defender" ? `${defender.name} wins!` : "Tie!");

      // Execute Special Action effects
      const attackerActor = _resolveActorViaToken(attacker.actorUuid, attacker.tokenUuid);
      const defenderActor = _resolveActorViaToken(defender.actorUuid, defender.tokenUuid);
      
      if (!attackerActor || !defenderActor) {
        console.error("UESRPG | Special Action: Could not resolve actors for effect execution");
        data.outcome = {
          ...opposedResult,
          text: outcomeText,
          effectMessage: "Error: Could not resolve actors"
        };
      } else if (opposedResult.winner === "attacker") {
        const executionResult = await executeSpecialAction({
          specialActionId,
          actor: attackerActor,
          target: defenderActor,
          isAutoWin: false,
          opposedResult
        });

        data.outcome = {
          ...opposedResult,
          text: outcomeText,
          effectMessage: executionResult.success ? executionResult.message : null
        };
      } else {
        data.outcome = {
          ...opposedResult,
          text: outcomeText,
          effectMessage: null
        };
      }
    }

    // Update message
    await safeUpdateChatMessage(message, {
      content: _renderSpecialActionCard(data, message.id),
      [`flags.${SYSTEM_ID}.specialActionOpposed.state`]: data
    });

  } catch (err) {
    console.error("UESRPG | Special Action card action failed", err);
    ui.notifications.error("Special Action failed. Check console for details.");
  }
}

/**
 * Execute Special Action effects.
 * @param {Object} options
 * @param {string} options.specialActionId
 * @param {Actor} options.actor
 * @param {Actor} options.target
 * @param {boolean} options.isAutoWin
 * @param {Object} options.opposedResult
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function executeSpecialAction({
  specialActionId,
  actor,
  target,
  isAutoWin = false,
  opposedResult = null
} = {}) {
  const def = getSpecialActionById(specialActionId);
  if (!def) {
    return { success: false, message: "Unknown Special Action." };
  }

  const actorName = actor?.name ?? "Actor";
  const targetName = target?.name ?? "Target";
  const winner = isAutoWin ? "attacker" : (opposedResult?.winner ?? null);

  switch (specialActionId) {
    case "arise":
      return await _executeArise({ actor, winner, actorName, isAutoWin });
    case "bash":
      return await _executeBash({ actor, target, winner, actorName, targetName, isAutoWin });
    case "blindOpponent":
      return await _executeBlindOpponent({ actor, target, winner, actorName, targetName, isAutoWin });
    case "disarm":
      return await _executeDisarm({ actor, target, winner, actorName, targetName, isAutoWin });
    case "feint":
      return await _executeFeint({ actor, target, winner, actorName, targetName, isAutoWin });
    case "forceMovement":
      return await _executeForceMovement({ actor, target, winner, actorName, targetName, isAutoWin });
    case "grapple":
      return await _executeGrapple({ actor, target, winner, actorName, targetName, isAutoWin });
    case "resist":
      return await _executeResist({ actor, target, winner, actorName, targetName, isAutoWin });
    case "trip":
      return await _executeTrip({ actor, target, winner, actorName, targetName, isAutoWin });
    case "inClose":
      return await _executeInClose({ actor, target, actorName, targetName, isAutoWin });
    default:
      return { success: false, message: `No automation for ${def.name}.` };
  }
}

/**
 * Initiate Special Action from character sheet.
 * @param {Object} options
 * @param {string} options.specialActionId
 * @param {Actor} options.actor
 * @param {Actor} options.target
 * @param {Token} options.actorToken
 * @param {Token} options.targetToken
 * @returns {Promise<Object>}
 */
export async function initiateSpecialActionFromSheet({
  specialActionId,
  actor,
  target,
  actorToken = null,
  targetToken = null
} = {}) {
  const def = getSpecialActionById(specialActionId);
  if (!def) {
    ui.notifications.warn("Unknown Special Action.");
    return null;
  }

  // Arise doesn't need a target
  if (specialActionId === "arise") {
    const result = await executeSpecialAction({
      specialActionId,
      actor,
      target: null,
      isAutoWin: false,
      opposedResult: { winner: "attacker" }
    });

    if (result.success) {
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor, token: actorToken?.document ?? null }),
        content: `<div class="uesrpg-special-action-outcome"><b>Special Action:</b><p>${result.message}</p></div>`,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    }
    return result;
  }

  // Other Special Actions require a target
  if (!target) {
    ui.notifications.warn(`${def.name} requires a targeted token.`);
    return null;
  }

  // Create interactive opposed test card
  await createSpecialActionOpposedTest({
    specialActionId,
    attackerToken: actorToken,
    defenderToken: targetToken,
    isFreeAction: false
  });

  return { success: true, message: "Special Action test initiated." };
}

/**
 * Create Acrobatics test card for Bash follow-up.
 * Target must pass to avoid becoming Prone.
 * @param {Actor} target - The actor who was bashed
 */
async function _createBashAcrobaticsTest(target) {
  // Find Acrobatics skill (exact match, case-insensitive)
  const acrobatics = target.items.find(i => 
    i.type === "skill" && 
    String(i.name || "").trim().toLowerCase() === "acrobatics"
  );

  if (!acrobatics) {
    ui.notifications.warn(`${target.name} has no Acrobatics skill. Apply Prone manually if they fail.`);
    return `${target.name} has no Acrobatics skill. Apply Prone manually if they fail.`;
  }

  // Find target's token
  const targetToken = canvas.tokens?.placeables?.find(t => t.actor?.uuid === target.uuid) ?? null;

  // Create a simple skill test card (not opposed, just a single roll)
  const { computeSkillTN } = await import("../skills/skill-tn.js");
  const { doTestRoll } = await import("../../utils/degree-roll-helper.js");
  
  const tn = computeSkillTN({
    actor: target,
    skillItem: acrobatics,
    difficultyKey: "average",
    manualMod: 0,
    useSpecialization: false,
    situationalMods: []
  });

  const result = await doTestRoll(target, {
    rollFormula: "1d100",
    target: tn.finalTN,
    allowLucky: true,
    allowUnlucky: true
  });

  // Post the roll to chat
  await result.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: target, token: targetToken?.document ?? null }),
    flavor: `Acrobatics — Bash Follow-Up (avoid Prone)`,
    rollMode: game.settings.get("core", "rollMode")
  });

  // Apply Prone if they failed
  if (!result.isSuccess) {
    await applyCondition(target, "prone", { source: "bash-failed-acrobatics" });
    return `${target.name} fails the Acrobatics test and falls Prone.`;
  }
  return `${target.name} passes the Acrobatics test and avoids falling Prone.`;
}

// ============================================================================
// EXECUTORS
// ============================================================================

async function _executeArise({ actor, winner, actorName, isAutoWin }) {
  if (winner === "attacker" || isAutoWin) {
    await removeCondition(actor, "prone");
    return {
      success: true,
      message: `${actorName} arises without provoking an attack of opportunity.`
    };
  }
  return { success: false, message: `${actorName} fails to arise.` };
}

async function _executeBash({ actor, target, winner, actorName, targetName, isAutoWin }) {
  if (winner === "attacker" || isAutoWin) {
    // Remove 1 AP
    await ActionEconomy.spendAP(target, 1, { reason: "bashed", silent: true });

    // Create Acrobatics test card for target (RAW: must pass to avoid Prone)
    const bashFollowUp = await _createBashAcrobaticsTest(target);

    return {
      success: true,
      message: `${actorName} bashes ${targetName}! Knocked back 1m, loses 1 AP. ${bashFollowUp} (Manual: move token back 1m)`
    };
  }
  return { success: false, message: `${actorName}'s bash fails.` };
}

async function _executeBlindOpponent({ actor, target, winner, actorName, targetName, isAutoWin }) {
  if (winner === "attacker" || isAutoWin) {
    const roundSeconds = Math.max(1, Number(TimeService.getRoundTimeSeconds?.() ?? 6) || 6);
    const duration = buildEffectDuration({
      actor: target,
      rounds: 1,
      seconds: roundSeconds,
      preferCombat: true
    });

    await applyCondition(target, "blinded", { source: "blindOpponent" });

    const effect = target.effects.find(e =>
      !e.disabled &&
      (getFlagValueWithFallback(e, "condition.key") === "blinded")
    );
    if (effect) {
      const parent = effect.parent;
      if (parent) {
        await requestUpdateEmbeddedDocuments(parent, "ActiveEffect", [{ _id: effect.id, duration }]);
      }
    }

    return {
      success: true,
      message: `${actorName} blinds ${targetName} for 1 round.`
    };
  }
  return { success: false, message: `${actorName} fails to blind ${targetName}.` };
}

async function _executeDisarm({ actor, target, winner, actorName, targetName, isAutoWin }) {
  if (winner === "attacker" || isAutoWin) {
    return {
      success: true,
      message: `${actorName} disarms ${targetName}! Weapon can be taken or flung 1d4m. (Manual: unequip weapon)`
    };
  }
  return { success: false, message: `${actorName} fails to disarm ${targetName}.` };
}

async function _executeFeint({ actor, target, winner, actorName, targetName, isAutoWin }) {
  if (winner === "attacker" || isAutoWin) {
    const roundSeconds = Math.max(1, Number(TimeService.getRoundTimeSeconds?.() ?? 6) || 6);
    const duration = buildEffectDuration({
      actor: target,
      rounds: 1,
      seconds: roundSeconds,
      preferCombat: true
    });

    await applyCondition(target, "feinted", { source: "feint" });

    const effect = target.effects.find(e =>
      !e.disabled &&
      (getFlagValueWithFallback(e, "condition.key") === "feinted")
    );

    if (effect) {
      const effectUpdates = {
        duration,
        [`flags.${FLAG_SCOPE}.condition.attackerUuid`]: actor.uuid
      };
      const parent = effect.parent;
      if (parent) {
        await requestUpdateEmbeddedDocuments(parent, "ActiveEffect", [{ _id: effect.id, ...effectUpdates }]);
      }
    }

    return {
      success: true,
      message: `${actorName} feints! ${targetName} cannot defend against ${actorName}'s next melee attack.`
    };
  }
  return { success: false, message: `${actorName}'s feint fails.` };
}

async function _executeForceMovement({ actor, target, winner, actorName, targetName, isAutoWin }) {
  if (winner === "attacker" || isAutoWin) {
    return {
      success: true,
      message: `${actorName} forces movement! Both move up to 3m in same direction (Manual: adjust tokens).`
    };
  }
  return { success: false, message: `${actorName} fails to force movement.` };
}

async function _executeGrapple({ actor, target, winner, actorName, targetName, isAutoWin }) {
  if (!(winner === "attacker" || isAutoWin)) {
    return { success: false, message: `${actorName} fails to grapple ${targetName}.` };
  }

  const sizeRule = _getGrappleSizeResult(actor, target);
  if (sizeRule.blocked) {
    return { success: false, message: `${actorName} cannot grapple ${targetName}: target is too large.` };
  }

  const lockKey = `${String(actor?.uuid ?? actor?.id ?? "")}|${String(target?.uuid ?? target?.id ?? "")}|grapple`;
  if (_GRAPPLE_ACTION_LOCKS.has(lockKey)) {
    return { success: false, message: "Grapple is already resolving for this pair." };
  }
  _GRAPPLE_ACTION_LOCKS.add(lockKey);

  try {
    const alreadyControlled = _isTargetGrappledByActor(target, actor);
    const ownerTag = _grappleOwnerTag(actor);

    if (alreadyControlled) {
      const followUp = await _showGrappleFollowUpChoice();
      if (followUp === "takedown") {
        await applyCondition(target, "prone", { source: "Grapple: Takedown" });
        return {
          success: true,
          message: `${actorName} performs Takedown on ${targetName}. ${targetName} is now Prone.`,
        };
      }
      if (followUp === "move") {
        return {
          success: true,
          message: `${actorName} uses Grapple (Move). Move both tokens together as appropriate.`,
        };
      }
      if (followUp === "attack") {
        return {
          success: true,
          message: `${actorName} uses Grapple (Attack) against ${targetName}. Resolve the attack in the normal attack workflow.`,
        };
      }
      return { success: false, message: `${actorName} cancels the grapple follow-up action.` };
    }

    await applyCondition(target, "restrained", { source: ownerTag });
    await applyCondition(target, "grappled", { source: ownerTag });
    await _stampConditionSource(target, "restrained", ownerTag);
    await _stampConditionSource(target, "grappled", ownerTag);

    return {
      success: true,
      message: `${actorName} grapples ${targetName}. ${targetName} is Restrained.`,
    };
  } finally {
    _GRAPPLE_ACTION_LOCKS.delete(lockKey);
  }
}

async function _executeResist({ actor, target, winner, actorName, targetName, isAutoWin }) {
  if (winner === "attacker" || isAutoWin) {
    await removeCondition(actor, "restrained");
    await removeCondition(actor, "grappled");
    await removeCondition(actor, "blinded");

    return {
      success: true,
      message: `${actorName} escapes!`
    };
  }
  return { success: false, message: `${actorName} fails to resist.` };
}

async function _executeTrip({ actor, target, winner, actorName, targetName, isAutoWin }) {
  if (winner === "attacker" || isAutoWin) {
    await applyCondition(target, "prone", { source: "trip" });
    return {
      success: true,
      message: `${actorName} trips ${targetName}, making them Prone.`
    };
  }
  return { success: false, message: `${actorName} fails to trip ${targetName}.` };
}

async function _executeInClose({ actor, target, actorName, targetName, isAutoWin }) {
  if (!actor || !target) {
    return { success: false, message: "In Close requires both attacker and defender actors." };
  }

  const result = await toggleInCloseBetweenActors(actor, target, { requireOneMeterForEntry: true });
  if (!result.success) {
    return { success: false, message: result.message };
  }

  if (result.left) {
    return { success: true, message: `${actorName} leaves In Close with ${targetName}.` };
  }

  return {
    success: true,
    message: `${actorName} ${isAutoWin ? "automatically enters" : "enters"} In Close with ${targetName}.`
  };
}
