import { computeSkillTN } from "../skills/skill-tn.js";
import { computeTN } from "./tn.js";
import { renderTNSummary, bindTNEstimates } from "../../ui/shared/tn-presentation.js";
/**
 * src/core/combat/special-actions-helper.js
 * 
 * Full automation for Special Actions (Chapter 5) with:
 * - Interactive opposed test cards with action buttons
 * - Combat Style OR Skill choice for both attacker and defender
 * - Special Advantage mode selection (Free Action OR Auto-Win)
 * - Active Effect automation using system condition engine
 */

import { applyCondition, removeCondition } from "../conditions/condition-engine.js";
import { toggleInCloseBetweenActors } from "../conditions/in-close.js";
import {
  getSpecialActionById,
  buildSpecialActionTestChoicesForActor,
  getSpecialActionTestOption,
  getSpecialActionTestOptionKeys
} from "./combat-style-utils.js";
import { ActionEconomy } from "./action-economy.js";
import { isActorInStartedCombatEncounter } from "./combat-scope.js";
import { TimeService, buildEffectDuration } from "../time/index.js";
import { customDialog, confirmDialog } from "../../utils/dialog-v2-helper.js";
import { _resolveActorViaToken, _resolveDoc } from "./opposed/helpers/docs.js";
import { getWeaponRangeBands } from "./opposed/helpers/combat.js";
import { getTokenRangeMeasurementMode, measureTokenDistance } from "./opposed/range.js";
import { itemHasToken, getEquippedSnareWeapon } from "./damage/tokens.js";
import { createOpposedCardUpdater } from "../opposed/shared/card-persistence.js";
import { requestUpdateDocument, doesUserOwnActor } from "../../utils/authority-proxy.js";
import { doTestRoll, resolveOpposed } from "../../utils/degree-roll-helper.js";
import { SYSTEM_ID, FLAG_SCOPE } from "../system/namespace.js";
import { getFlagValueWithFallback } from "../system/flags.js";
import { resolveUnusualCombatSkillLimit } from "./unusual-combat.js";
import { tf } from "../../utils/i18n.js";
import { getOutcomeApplicationMode } from "../config/outcome-application-policy.js";
import { createSpecialActionOperation, specialActionIntent, specialActionEligibility, validateSpecialActionOperation, getSpecialActionStage } from "./special-action-operations.js";
import { materializeSpecialActionOutcome } from "./special-action-outcomes.js";
import { ChatOutcomeApplicationService, persistChatOutcomes, isManagedChatOutcomeContext, getChatOutcomeReceipt, describeChatOutcome } from "../../application/combat/chat-outcome-application-service.js";
import { withActionResult } from "../../application/action-results.js";
import { stableStringify } from "../../utils/authority-proxy/shared.js";
const HOOKED_ACTION_IDS = new Set(["disarm", "trip", "takeWeapon", "take-weapon"]);
const _GRAPPLE_ACTION_LOCKS = new Set();
const _updateSpecialActionCard = createOpposedCardUpdater({ scope: SYSTEM_ID, key: "specialActionOpposed", version: 1,
  family: "skills", render: _renderSpecialActionCard });
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

/** Bash and Trip cannot target a creature larger than the acting character. */
export function isSpecialActionTargetSizeAllowed(actor, target) {
  return _sizeIndex(target?.system?.size) <= _sizeIndex(actor?.system?.size);
}

// Bind a range decision to the actual token positions, scene scale and weapon.
// The document snapshot can also be checked by an authority viewing another scene.
function _snareRangeFingerprint(actorToken, targetToken, weapon) {
  const a = actorToken?.document ?? actorToken;
  const b = targetToken?.document ?? targetToken;
  const scene = a?.parent;
  if (!a?.uuid || !b?.uuid || !scene || scene !== b.parent || !weapon) return null;
  const point = token => ({ uuid: token.uuid, x: token.x, y: token.y, elevation: token.elevation,
    width: token.width, height: token.height });
  const grid = scene.grid;
  return stableStringify({ scene: scene.uuid, attacker: point(a), target: point(b),
    grid: { type: grid?.type, size: grid?.size, distance: grid?.distance, units: grid?.units,
      diagonals: grid?.diagonals }, measurementMode: getTokenRangeMeasurementMode(),
    weapon: { uuid: weapon.uuid, thrown: itemHasToken(weapon, "thrown"),
      reach: weapon.system?.reach ?? null, bands: getWeaponRangeBands(weapon) } });
}

/** Reject stale Snare cards without relying on the authority's currently viewed canvas. */
export function isSnareActionCurrent({ actor, target, weaponUuid, rangeSnapshot, actorTokenUuid, targetTokenUuid } = {}) {
  const weapon = getEquippedSnareWeapon(actor, weaponUuid);
  if (!weapon || !target || !isSpecialActionTargetSizeAllowed(actor, target) || !rangeSnapshot?.fingerprint
    || rangeSnapshot.actorTokenUuid !== actorTokenUuid || rangeSnapshot.targetTokenUuid !== targetTokenUuid) return false;
  const a = _resolveDoc(actorTokenUuid);
  const b = _resolveDoc(targetTokenUuid);
  if (a?.documentName !== "Token" || b?.documentName !== "Token" || a.actor?.uuid !== actor?.uuid
    || b.actor?.uuid !== target?.uuid) return false;
  return _snareRangeFingerprint(a, b, weapon) === rangeSnapshot.fingerprint;
}

/** Choose a Snare weapon before committing a Bash or Trip action. */
export async function chooseSnareSpecialAction({ specialActionId, actor, targetToken, actorToken, sourceWeaponUuid = null } = {}) {
  if (!["bash", "trip"].includes(specialActionId)) return { weaponUuid: null };
  const weapons = Array.from(actor?.items ?? []).filter(item => item.type === "weapon"
    && item.system?.equipped === true && itemHasToken(item, "snare"));
  if (!weapons.length) return { weaponUuid: null };
  const selected = await customDialog({
    title: `${getSpecialActionById(specialActionId)?.name ?? "Special Action"}: Weapon`, layout: "form",
    content: `<p>Choose a Snare weapon or use the normal unarmed action.</p><label>Weapon <select name="snareWeapon"><option value="">Normal unarmed action</option>${weapons.map(item => `<option value="${_escapeHtml(item.id)}"${item.uuid === sourceWeaponUuid ? " selected" : ""}>${_escapeHtml(item.name)}</option>`).join("")}</select></label>`,
    buttons: {
      confirm: { label: "Continue", callback: root => String(root?.querySelector('[name="snareWeapon"]')?.value ?? "") },
      cancel: { label: "Cancel", callback: () => null }
    }, defaultButton: "confirm"
  });
  if (selected === null || selected === undefined) return null;
  if (!selected) return { weaponUuid: null };
  const weapon = actor.items?.get?.(selected);
  if (!weapon || weapon.type !== "weapon" || weapon.system?.equipped !== true || !itemHasToken(weapon, "snare")) {
    ui.notifications?.warn?.("The selected Snare weapon is no longer equipped.");
    return null;
  }
  if (!targetToken?.actor || !isSpecialActionTargetSizeAllowed(actor, targetToken.actor)) {
    ui.notifications?.warn?.("Bash and Trip require a target that is not larger than the acting character.");
    return null;
  }
  const a = actorToken?.document ?? actorToken;
  const b = targetToken?.document ?? targetToken;
  const fingerprint = _snareRangeFingerprint(a, b, weapon);
  if (!fingerprint || a.actor?.uuid !== actor?.uuid || b.actor?.uuid !== targetToken.actor.uuid) {
    ui.notifications?.warn?.("Select the acting and target tokens on the same scene before using a Snare weapon.");
    return null;
  }
  const distance = canvas?.scene?.uuid === a.parent?.uuid ? measureTokenDistance(actorToken, targetToken) : null;
  const units = String(a.parent?.grid?.units ?? "").trim().toLowerCase();
  const metersPerUnit = ["m", "meter", "meters", "metre", "metres"].includes(units) ? 1
    : ["ft", "foot", "feet"].includes(units) ? 0.3048 : null;
  const distanceMeters = Number.isFinite(distance) && metersPerUnit != null ? distance * metersPerUnit : null;
  const bands = getWeaponRangeBands(weapon);
  const maxRange = itemHasToken(weapon, "thrown") ? Number(bands?.long || bands?.medium || 0) : Number(weapon.system?.reach ?? 0);
  if (distanceMeters == null || !(maxRange > 0) || distanceMeters > maxRange) {
    const detail = distance == null || !(maxRange > 0)
      ? "The distance or weapon range could not be determined."
      : `The measured distance is ${distance} ${units || "scene units"} and the weapon's listed range is ${maxRange} meters.${metersPerUnit == null ? " The scene units cannot be converted automatically." : ""}`;
    const proceed = await confirmDialog({ title: "Snare range: GM decision",
      content: `<p>${_escapeHtml(detail)}</p><p>The Snare rule removes the usual 2 meter limit but does not specify a maximum for this Special Action. Ask the GM to decide whether the weapon can reach the target before continuing.</p>`,
      yesLabel: game.user.isGM ? "Allow" : "GM has allowed", noLabel: "Cancel" });
    if (proceed !== true) return null;
  }
  const rangeSnapshot = { actorTokenUuid: a.uuid, targetTokenUuid: b.uuid, fingerprint };
  if (!isSnareActionCurrent({ actor, target: targetToken.actor, weaponUuid: weapon.uuid, rangeSnapshot,
    actorTokenUuid: a.uuid, targetTokenUuid: b.uuid })) {
    ui.notifications?.warn?.("The Snare weapon or target changed. Start the Special Action again.");
    return null;
  }
  return { weaponUuid: weapon.uuid, rangeSnapshot };
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

async function _stampConditionSource(actor, conditionKey, sourceTag, context) {
  if (!actor || !conditionKey || !sourceTag) return;
  const effect = (actor.effects ?? []).find((e) => {
    if (e?.disabled) return false;
    return getFlagValueWithFallback(e, "condition.key") === conditionKey;
  });
  if (!effect) return;
  const existing = String(getFlagValueWithFallback(effect, "condition.source") ?? "").trim();
  if (existing === sourceTag) return;
  await context.stage(`condition.${conditionKey}.source`, async () => {
    context.requireCurrent();
    if (!await requestUpdateDocument(effect, { [`flags.${FLAG_SCOPE}.condition.source`]: sourceTag })) throw new Error("Condition source update was not confirmed.");
    return { ok: true, effectUuids: [effect.uuid] };
  }, { documents: [actor, effect] });
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
    layout: "workflow",
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
    layout: "workflow",
    title: `Special Advantage: ${def.name}`,
    render: (_event, dialog) => bindTNEstimates(dialog.element, () => [{ key: "test",
      status: dialog.element.querySelector('[name="advMode"]:checked')?.value === "autowin" ? "Auto-Win" : null,
      reason: "The test is selected in the next step." }]),
    content: `
      <div style="padding: 10px;">
        ${renderTNSummary(def.name)}
        <p>You are using <strong>${def.name}</strong> as a Special Advantage.</p>
        <p>Choose how to use it:</p>
        <div>
          <div style="margin: 10px 0;">
            <label class="uesrpg-adv-choice uesrpg-choice-bar">
              <input type="radio" name="advMode" value="free" checked><span class="uesrpg-adv-choice__label"><strong>Free Action</strong> - No AP cost, but roll opposed test normally</span>
</label>
          </div>
          <div style="margin: 10px 0;">
            <label class="uesrpg-adv-choice uesrpg-choice-bar">
              <input type="radio" name="advMode" value="autowin"><span class="uesrpg-adv-choice__label"><strong>Auto-Win</strong> - Automatically win the opposed test (still costs AP if not using as advantage)</span>
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
export async function showPreTestChoiceDialog({ specialActionId, actor, opponentActor = null, attackerActor = null, isDefender = false, snare = false }) {
  const def = getSpecialActionById(specialActionId);
  if (!def) return null;

  const side = isDefender ? "defender" : "attacker";
  const choices = buildSpecialActionTestChoicesForActor(actor, { specialActionId, side, snare })
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
      ${renderTNSummary(choices.map((choice, index) => ({ key: `special-${index}`, label: choice.label })))}
      <p><b>Special Action: ${_escapeHtml(def.name)}</b></p>
      <p>Choose your ${isDefender ? 'defense' : 'test'}:</p>
      <div style="margin: 12px 0;">
        ${choices.map(opt => `
          <label class="uesrpg-adv-choice uesrpg-choice-bar">
            <input type="radio" name="testChoice" value="${_escapeHtml(opt.value)}" data-skill-uuid="${_escapeHtml(opt.skillUuid)}" ${opt.checked ? 'checked' : ''} />
            <span class="uesrpg-adv-choice__label"><b>${_escapeHtml(opt.label)}</b></span>
          </label>
        `).join('')}
      </div>
    </div>
  `;

  try {
    const result = await customDialog({
      layout: "workflow",
      title: `Special Action: ${def.name}`,
      content,
      render: (_event, dialog) => bindTNEstimates(dialog.element, () => choices.map((choice, index) => {
        if (specialActionId === "grapple" && !opponentActor) return { key: `special-${index}`, reason: "Select an opponent to estimate Grapple." };
        const computed = computeSpecialActionChoiceTN({ actor, opponentActor, attackerActor, specialActionId, isAttacker: !isDefender, choice: { testType: choice.value, skillUuid: choice.skillUuid } });
        return { key: `special-${index}`, result: computed.tn, reason: computed.reason };
      })),
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
function _getSpecialActionOptionLabels(specialActionId, side, snare = false) {
  const keys = getSpecialActionTestOptionKeys(specialActionId, side, { snare });
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
function _getTestOptions(specialActionId, side, snare = false) {
  const lane = (side === "defender") ? "defender" : "attacker";
  return _getSpecialActionOptionLabels(specialActionId, lane, snare);
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

  const attackerOptions = _getTestOptions(specialActionId, "attacker", Boolean(data.snareWeaponUuid));
  const defenderOptions = _getTestOptions(specialActionId, "defender", Boolean(data.snareWeaponUuid));

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

  const snare = await chooseSnareSpecialAction({ specialActionId, actor: attacker, actorToken: attackerToken, targetToken: defenderToken });
  if (!snare) return null;

  const data = {
    specialActionId,
    isFreeAction,
    snareWeaponUuid: snare.weaponUuid,
    snareRangeSnapshot: snare.rangeSnapshot ?? null,
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
export function resolveSpecialActionOpposedResult(attackerResult, defenderResult) {
  const outcome = resolveOpposed(attackerResult, defenderResult);
  // Chapter 5: any critical on both sides leaves neither attack nor defense resolved.
  const attackerCritical = Boolean(attackerResult?.isCriticalSuccess || attackerResult?.isCriticalFailure);
  const defenderCritical = Boolean(defenderResult?.isCriticalSuccess || defenderResult?.isCriticalFailure);
  return attackerCritical && defenderCritical ? { winner: "tie", reason: "both sides roll a critical" } : outcome;
}

export async function handleSpecialActionCardAction(message, action) {
  try {
    const data = foundry.utils.deepClone(message.flags?.[SYSTEM_ID]?.specialActionOpposed?.state);
    if (!data) return;

    const { specialActionId, attacker, defender, isFreeAction } = data;
    const def = getSpecialActionById(specialActionId);
    if (!def) return;

    const isAttacker = action === "attacker-roll";
    const side = isAttacker ? attacker : defender;
    const actor = _resolveActorViaToken(side.actorUuid, side.tokenUuid);

    if (!actor || !doesUserOwnActor(game.user, actor)) {
      ui.notifications.warn("Could not resolve actor for this action.");
      return;
    }

    // Check if already rolled
    if (side.result) {
      ui.notifications.warn(`${side.name} has already rolled.`);
      return;
    }

    // Show legal test choice dialog for this side.
    const attackerActor = _resolveActorViaToken(attacker.actorUuid, attacker.tokenUuid);
    const opponentActor = _resolveActorViaToken(isAttacker ? defender.actorUuid : attacker.actorUuid, isAttacker ? defender.tokenUuid : attacker.tokenUuid);
    const snareTarget = _resolveActorViaToken(defender.actorUuid, defender.tokenUuid);
    if (data.snareWeaponUuid && !isSnareActionCurrent({ actor: attackerActor, target: snareTarget, weaponUuid: data.snareWeaponUuid,
      rangeSnapshot: data.snareRangeSnapshot, actorTokenUuid: attacker.tokenUuid, targetTokenUuid: defender.tokenUuid })) {
      ui.notifications.warn("The Snare weapon or target is no longer eligible; start a new Special Action.");
      return;
    }
    const choice = await showPreTestChoiceDialog({
      opponentActor,
      attackerActor,
      specialActionId,
      actor,
      isDefender: !isAttacker,
      snare: Boolean(data.snareWeaponUuid)
    });

    if (!choice) return;
    if (!doesUserOwnActor(game.user, actor)) {
      ui.notifications.warn("You no longer have permission to roll for this actor.");
      return;
    }
    const latest = message.flags?.[SYSTEM_ID]?.specialActionOpposed?.state;
    const sideKey = isAttacker ? "attacker" : "defender";
    if (!latest || latest[sideKey]?.result || latest.snareWeaponUuid !== data.snareWeaponUuid) {
      ui.notifications.warn("The Special Action card changed. Review it before rolling.");
      return;
    }
    if (data.snareWeaponUuid) {
      const latestAttacker = _resolveActorViaToken(latest.attacker?.actorUuid, latest.attacker?.tokenUuid);
      const latestDefender = _resolveActorViaToken(latest.defender?.actorUuid, latest.defender?.tokenUuid);
      if (!isSnareActionCurrent({ actor: latestAttacker, target: latestDefender, weaponUuid: data.snareWeaponUuid,
        rangeSnapshot: latest.snareRangeSnapshot, actorTokenUuid: latest.attacker?.tokenUuid, targetTokenUuid: latest.defender?.tokenUuid })) {
        ui.notifications.warn("The Snare weapon or target changed. Start a new Special Action.");
        return;
      }
    }

    // Perform roll
    let rollResult;
    let testLabel;
    let consumeConcussiveAfterRoll = false;
    const computed = computeSpecialActionChoiceTN({ actor, opponentActor, attackerActor, specialActionId, isAttacker, choice });
    if (!computed.tn) { ui.notifications?.warn?.(computed.reason); return; }
    consumeConcussiveAfterRoll = computed.consumeConcussiveAfterRoll;
    testLabel = computed.testLabel;
    rollResult = await doTestRoll(actor, { rollFormula: "1d100", target: computed.tn.finalTN, allowLucky: true, allowUnlucky: true });

    if (!doesUserOwnActor(game.user, actor)) {
      ui.notifications.warn("Permission changed during the roll. Review the action before retrying.");
      return;
    }

    const afterRoll = message.flags?.[SYSTEM_ID]?.specialActionOpposed?.state;
    if (data.snareWeaponUuid && (!afterRoll || afterRoll.snareWeaponUuid !== data.snareWeaponUuid
      || afterRoll.snareRangeSnapshot?.fingerprint !== data.snareRangeSnapshot?.fingerprint
      || !isSnareActionCurrent({ actor: attackerActor, target: snareTarget,
        weaponUuid: data.snareWeaponUuid, rangeSnapshot: data.snareRangeSnapshot,
        actorTokenUuid: attacker.tokenUuid, targetTokenUuid: defender.tokenUuid }))) {
      ui.notifications.warn("The Snare weapon or range changed during the roll. Start a new Special Action.");
      return;
    }

    // Update side with result
    if (consumeConcussiveAfterRoll) {
      await _consumeConcussiveNextBashBonus(actor);
    }

    await _updateSpecialActionCard(message, fresh => {
      const sideKey = isAttacker ? "attacker" : "defender";
      if (fresh[sideKey]?.result) return fresh;
      fresh[sideKey] = { ...fresh[sideKey], result: rollResult, testLabel };
      fresh.context ??= {};
      fresh.context.specialActionOperationsVersion = 1;
      const data = fresh;
      const { attacker, defender } = data;
      // Check if both have rolled
      if (attacker.result && defender.result) {
        // Resolve outcome
        const opposedResult = resolveSpecialActionOpposedResult(attacker.result, defender.result);

        const outcomeText = opposedResult.winner === "attacker"
          ? `${attacker.name} wins!`
          : (opposedResult.winner === "defender" ? `${defender.name} wins!` : "Tie!");

        // Save the resolved result; the outcome service owns its effects.
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
          data.outcome = {
            ...opposedResult,
            text: outcomeText,
            effectMessage: "Outcome resolved; application pending."
          };
        } else {
          data.outcome = {
            ...opposedResult,
            text: outcomeText,
            effectMessage: null
          };
        }
      }

      return fresh;
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
export async function prepareSpecialActionOutcome({ specialActionId, actor, target, isAutoWin = false, opposedResult = null,
  operation = null, operationId = null, sourceMessage = null, sourceKind = "standalone", resultRevision = 1, slot = "action",
  signature = "", actorTokenUuid = null, targetTokenUuid = null, followUp = null, launch = null, activation = null } = {}) {
  const payload = specialActionIntent({ specialActionId, actorUuid: actor?.uuid, targetUuid: target?.uuid,
    isAutoWin, opposedResult, actorTokenUuid, targetTokenUuid, followUp, launch,
    activation: activation ? { actionType: activation.actionType ?? "secondary" } : null });
  operation ??= createSpecialActionOperation({ sourceUuid: sourceMessage?.uuid ?? `submission:${operationId ?? foundry.utils.randomID(24)}`,
    sourceKind, resultRevision, slot, signature, payload });
  const outcome = materializeSpecialActionOutcome({ operation, payload,
    targetUuid: ["arise", "resist"].includes(specialActionId) ? actor?.uuid : target?.uuid ?? actor?.uuid,
    autoEligible: getOutcomeApplicationMode() === "automatic" });
  const invalid = validateSpecialActionOperation(outcome);
  if (invalid) throw new Error(invalid);
  return outcome;
}

export async function postSpecialActionOutcome(options = {}) {
  const result = await submitSpecialActionOutcome(options);
  const message = result.messageId ? game.messages?.get(result.messageId) : null;
  const outcome = message?.flags?.[SYSTEM_ID]?.chatOutcomes?.entries?.find(entry => entry.id === result.outcomeId);
  const evidence = outcome ? describeChatOutcome(message, outcome) : null;
  return withActionResult(result, { owner: "specialActions", scope: "application",
    status: result.status === "failed" ? "rejected" : result.status === "waitingGM" ? "pending" : result.status,
    commitment: result.status === "needsReview" ? "uncertain" : evidence?.commitment ?? "none",
    accepted: Boolean(message), reason: result.message,
    references: { ...evidence?.references, operationId: result.operationId, outcomeId: result.outcomeId, messageId: result.messageId } });
}

async function submitSpecialActionOutcome(options = {}) {
  if (options.operationId && !options.operation) {
    const source = (game.messages?.contents ?? []).find(candidate => candidate.flags?.[SYSTEM_ID]?.chatOutcomes?.entries?.some(entry => entry.id === options.operationId));
    const entry = source?.flags?.[SYSTEM_ID]?.chatOutcomes?.entries?.find(candidate => candidate.id === options.operationId);
    if (!entry) return { success: false, status: "needsReview", operationId: options.operationId,
      message: "The previous submission could not be found. Reload and inspect durable messages before submitting another action." };
    options = { ...options, operation: entry.operation, sourceMessage: source };
  }
  let outcome;
  try { outcome = await prepareSpecialActionOutcome(options); }
  catch (error) { return { success: false, status: "rejected", operationId: options.operationId ?? options.operation?.id ?? null, message: String(error.message ?? error) }; }
  let message = options.sourceMessage ?? (game.messages?.contents ?? []).find(candidate => candidate.flags?.[SYSTEM_ID]?.chatOutcomes?.entries?.some(entry => entry.id === outcome.id));
  const previous = message?.flags?.[SYSTEM_ID]?.chatOutcomes?.entries?.find(entry => entry.id === outcome.id);
  if (previous && stableStringify(previous.operation?.intent) !== stableStringify(outcome.operation.intent)) {
    return { success: false, status: "rejected", operationId: outcome.id, message: "The operation ID is bound to different choices." };
  }
  if (!message && (options.operationId || options.operation)) return { success: false, status: "needsReview", operationId: outcome.id,
    message: "The previous submission could not be found. Inspect durable messages before submitting another action." };
  try {
    if (!previous) message = await persistChatOutcomes({ message, actor: options.actor, entries: [outcome],
      content: `<div class="uesrpg-special-action-outcome"><b>Special Action:</b><p>${_escapeHtml(getSpecialActionById(options.specialActionId)?.name ?? "Special Action")}</p></div>` });
    if (!message) throw new Error("The special-action card was not confirmed.");
    await ChatOutcomeApplicationService.onMessagePersisted(message);
    const receipt = getChatOutcomeReceipt(message, outcome);
    const saved = message.flags?.[SYSTEM_ID]?.chatOutcomes?.entries?.find(entry => entry.id === outcome.id);
    const status = receipt?.status ?? saved?.status ?? "pending";
    const blocked = status === "applied" && receipt?.result?.skipped === true
      && getSpecialActionStage(receipt.stages, "advantage.ap")?.result?.paid === false;
    return { success: !blocked && !["partial", "failed"].includes(status), status: blocked ? "blocked" : status === "applied" ? "complete" : status === "partial" ? "needsReview" : status,
      operationId: outcome.id, outcomeId: outcome.id, messageId: message.id, replayed: Boolean(previous),
      message: receipt?.result?.message ?? "Special Action submitted; application is controlled by the outcome setting." };
  } catch (error) {
    return { success: false, status: "needsReview", operationId: outcome.id, outcomeId: outcome.id, messageId: message?.id ?? null,
      message: `The submission was not confirmed. Inspect operation ${outcome.id} before retrying. ${error.message}` };
  }
}

export async function executeChatOutcome(outcome, context) {
  if (!isManagedChatOutcomeContext(context)) throw new Error("Special Action effects require the managed outcome owner.");
  const invalid = validateSpecialActionOperation(outcome);
  if (invalid) throw Object.assign(new Error(invalid), { committed: false });
  const payload = outcome.payload;
  if (payload.launch?.mode === "autowin" && payload.launch.apCost !== 1) throw Object.assign(new Error("The Special Advantage quote is invalid."), { committed: false });
  if (["skillOpposed", "specialActionOpposed"].includes(outcome.operation.sourceKind) && outcome.operation.sourceUuid !== context.message.uuid) throw Object.assign(new Error("The outcome belongs to a different source card."), { committed: false });
  const actor = _resolveActorViaToken(payload.actorUuid, payload.actorTokenUuid);
  const target = _resolveActorViaToken(payload.targetUuid, payload.targetTokenUuid);
  if (!actor || (payload.targetUuid && !target)) throw Object.assign(new Error("The Special Action actors are unavailable."), { committed: false });
  const snare = payload.snare ?? (payload.launch?.context?.snareWeaponUuid ? {
    weaponUuid: payload.launch.context.snareWeaponUuid, rangeSnapshot: payload.launch.context.snareRangeSnapshot
  } : null);
  if (snare && (!["bash", "trip"].includes(payload.specialActionId)
    || !isSnareActionCurrent({ actor, target, ...snare, actorTokenUuid: payload.actorTokenUuid, targetTokenUuid: payload.targetTokenUuid }))) {
    throw Object.assign(new Error("The Snare weapon or target is no longer eligible. Review the Special Advantage before retrying."), { committed: false });
  }
  context.assertSnareCurrent = () => {
    if (snare && !isSnareActionCurrent({ actor, target, ...snare,
      actorTokenUuid: payload.actorTokenUuid, targetTokenUuid: payload.targetTokenUuid })) {
      throw Object.assign(new Error("The Snare weapon or range changed during application; review any completed stages."), { committed: false });
    }
  };
  if (specialActionEligibility(payload) === "none") return { success: false, skipped: true, message: "This result has no Special Action effect." };
  if (payload.followUp === "inCloseFailure") {
    const { executeInCloseFailureReaction } = await import("../skills/opposed-workflow/core/helpers.js");
    return await executeInCloseFailureReaction(actor, target, context) ?? { ok: true, skipped: true, message: "No eligible Attack of Opportunity." };
  }
  if (payload.activation) {
    const { executeActivation, buildSpecialActionActivation } = await import("../system/activation/index.js");
    const activation = await context.stage("activation", () => executeActivation({ actor,
      activation: buildSpecialActionActivation({ actionType: payload.activation.actionType, apCost: 1, requiresTarget: false }),
      label: getSpecialActionById(payload.specialActionId)?.name, renderChat: false, context: { targets: [] },
      requireConfirmed: true, operationGuard: context.requireCurrent }), { documents: [actor], lockDocuments: false });
    if (activation.skipped) return { success: false, skipped: true, message: "Special Action activation was rejected." };
  }
  if (payload.launch) {
    const paid = await context.stage("advantage.ap", async () => {
      context.assertSnareCurrent();
      return { ok: true, paid: await ActionEconomy.spendAP(actor, payload.launch.apCost, { reason: payload.launch.reason, requireConfirmed: true,
        tokenUuid: payload.actorTokenUuid }) };
    }, { documents: [actor] });
    if (!paid.paid) return { success: false, skipped: true, message: "Insufficient Action Points for Special Advantage." };
    if (payload.launch.mode === "free") {
      return context.stage("advantage.card", async () => {
        context.assertSnareCurrent();
        const { SkillOpposedWorkflow } = await import("../skills/opposed-workflow/index.js");
        const child = await SkillOpposedWorkflow.createPending({ attackerTokenUuid: payload.actorTokenUuid,
          defenderTokenUuid: payload.targetTokenUuid, attackerSkillUuid: null,
          attackerSkillLabel: `${getSpecialActionById(payload.specialActionId)?.name} (Special Action)`,
          specialActionContext: { ...payload.launch.context, id: payload.specialActionId },
          specialActionOperation: { version: 1, operationId: outcome.id, step: "advantage.card" },
          whisper: Array.from(context.message.whisper ?? [], user => typeof user === "string" ? user : user.id), blind: context.message.blind === true });
        if (!child) throw new Error("The free Special Action card was not confirmed.");
        return { ok: true, success: true, messageId: child.id, message: "Free Special Action test created." };
      }, { documents: [actor] });
    }
  }
  let prepared = null;
  if (payload.specialActionId === "grapple") {
    if (_getGrappleSizeResult(actor, target).blocked) return { success: false, skipped: true, message: `${actor.name} cannot grapple ${target?.name}: target is too large.` };
    const preparation = await context.stage("grapple.prepare", async () => {
      const alreadyControlled = _isTargetGrappledByActor(target, actor);
      return { ok: true, prepared: { alreadyControlled, grappleChoice: alreadyControlled ? await _showGrappleFollowUpChoice() : null } };
    }, { documents: [target] });
    prepared = preparation.prepared;
  }
  return _applySpecialAction({ ...payload, actor, target, prepared, context });
}

/** Public compatibility entrypoint: effects always enter the persisted application owner. */
export async function executeSpecialAction(options = {}) {
  return postSpecialActionOutcome(options);
}

async function _applySpecialAction({
  specialActionId,
  actor,
  target,
  isAutoWin = false,
  opposedResult = null,
  prepared = null,
  context
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
      return await _executeArise({ actor, winner, actorName, isAutoWin, context });
    case "bash":
      return await _executeBash({ actor, target, winner, actorName, targetName, isAutoWin, prepared, context });
    case "blindOpponent":
      return await _executeBlindOpponent({ actor, target, winner, actorName, targetName, isAutoWin, context });
    case "disarm":
      return await _executeDisarm({ actor, target, winner, actorName, targetName, isAutoWin });
    case "feint":
      return await _executeFeint({ actor, target, winner, actorName, targetName, isAutoWin, context });
    case "forceMovement":
      return await _executeForceMovement({ actor, target, winner, actorName, targetName, isAutoWin });
    case "grapple":
      return await _executeGrapple({ actor, target, winner, actorName, targetName, isAutoWin, prepared, context });
    case "resist":
      return await _executeResist({ actor, target, winner, actorName, targetName, isAutoWin, context });
    case "trip":
      return await _executeTrip({ actor, target, winner, actorName, targetName, isAutoWin, context });
    case "inClose":
      return await _executeInClose({ actor, target, actorName, targetName, isAutoWin, context });
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
    const result = await postSpecialActionOutcome({
      specialActionId,
      actor,
      target: null,
      isAutoWin: false,
      opposedResult: { winner: "attacker" }
    });

    return result;
  }

  // Other Special Actions require a target
  if (!target) {
    ui.notifications.warn(`${def.name} requires a targeted token.`);
    return null;
  }

  // Create interactive opposed test card
  const message = await createSpecialActionOpposedTest({
    specialActionId,
    attackerToken: actorToken,
    defenderToken: targetToken,
    isFreeAction: false
  });

  return message ? { success: true, message: "Special Action test initiated." } : null;
}

/**
 * Create Acrobatics test card for Bash follow-up.
 * Target must pass to avoid becoming Prone.
 * @param {Actor} target - The actor who was bashed
 */
async function _createBashAcrobaticsTest(target, context) {
  const acrobatics = resolveUnusualCombatSkillLimit(target, "Acrobatics");
  if (!(Number(acrobatics?.tn) > 0)) {
    const warning = tf("UESRPG.DefectUpdate.BashNoAcrobatics", { actor: target.name }, `${target.name} has no Acrobatics skill or NPC physical profession. Apply Prone manually if they fail.`);
    ui.notifications.warn(warning);
    return { prone: false, message: warning };
  }

  // Find target's token
  const targetToken = canvas.tokens?.placeables?.find(t => t.actor?.uuid === target.uuid) ?? null;

  const result = await doTestRoll(target, {
    rollFormula: "1d100",
    target: Number(acrobatics.tn),
    allowLucky: true,
    allowUnlucky: true
  });
  context.assertSnareCurrent?.();

  // Post the roll to chat
  const recipients = Array.from(context.message.whisper ?? [], user => typeof user === "string" ? user : user.id);
  const rollMessage = await result.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: target, token: targetToken?.document ?? null }),
    flavor: tf("UESRPG.DefectUpdate.BashFlavor", {}, "Acrobatics — Bash Follow-Up (avoid Prone)"),
    whisper: recipients,
    blind: context.message.blind === true,
    flags: { [SYSTEM_ID]: { specialActionOperation: { version: 1, operationId: context.operation.id, step: "bash.prepare" } } },
  }, { messageMode: context.message.blind ? "blind" : recipients.length ? "gm" : "public" });
  if (!rollMessage || rollMessage.flags?.[SYSTEM_ID]?.specialActionOperation?.operationId !== context.operation.id) throw new Error("The Bash follow-up roll message was not confirmed.");

  // Apply Prone if they failed
  if (!result.isSuccess) {
    return { prone: true, messageId: rollMessage.id, rollTotal: result.rollTotal, message: tf("UESRPG.DefectUpdate.BashFailure", { actor: target.name }, `${target.name} fails the Acrobatics test and falls Prone.`) };
  }
  return { prone: false, messageId: rollMessage.id, rollTotal: result.rollTotal, message: tf("UESRPG.DefectUpdate.BashSuccess", { actor: target.name }, `${target.name} passes the Acrobatics test and avoids falling Prone.`) };
}

// ============================================================================
// EXECUTORS
// ============================================================================

async function _applyManagedCondition(context, actor, key, source) {
  return context.stage(`condition.${key}.apply`, async () => {
    context.assertSnareCurrent?.();
    const effect = await applyCondition(actor, key, { source, requireConfirmed: true, operationGuard: () => {
      context.requireCurrent();
      context.assertSnareCurrent?.();
    },
      operationMarker: { version: 1, operationId: context.operation.id, step: `condition.${key}.apply` } });
    return { ok: true, skipped: !effect, effectUuids: effect ? [effect.uuid] : [] };
  }, { documents: [actor] });
}

async function _removeManagedCondition(context, actor, key) {
  return context.stage(`condition.${key}.remove`, async () => {
    await removeCondition(actor, key, { requireConfirmed: true, operationGuard: context.requireCurrent });
    return { ok: true };
  }, { documents: [actor] });
}

async function _executeArise({ actor, winner, actorName, isAutoWin, context }) {
  if (winner === "attacker" || isAutoWin) {
    await _removeManagedCondition(context, actor, "prone");
    return {
      success: true,
      message: `${actorName} arises without provoking an attack of opportunity.`
    };
  }
  return { success: false, message: `${actorName} fails to arise.` };
}

async function _executeBash({ actor, target, winner, actorName, targetName, isAutoWin, prepared, context }) {
  if (winner === "attacker" || isAutoWin) {
    // Remove 1 AP
    const apResult = await context.stage("bash.ap", async () => {
      context.assertSnareCurrent?.();
      const tokenUuid = context.outcome.payload.targetTokenUuid;
      const tracked = isActorInStartedCombatEncounter(target, { tokenUuid });
      const paid = await ActionEconomy.spendAP(target, 1, { reason: "bashed", silent: true, requireConfirmed: true, tokenUuid });
      return { ok: true, paid, prepared: { tracked } };
    }, { documents: [target] });

    // Create Acrobatics test card for target (RAW: must pass to avoid Prone)
    const preparation = await context.stage("bash.prepare", async () => {
      context.assertSnareCurrent?.();
      return { ok: true, prepared: { bashResult: prepared?.bashResult ?? await _createBashAcrobaticsTest(target, context) } };
    }, { documents: [target] });
    const bashFollowUp = preparation.prepared.bashResult;
    if (bashFollowUp.prone) await _applyManagedCondition(context, target, "prone", "bash-failed-acrobatics");

    return {
      success: true,
      message: `${actorName} bashes ${targetName}! ${apResult.prepared?.tracked ? (apResult.paid ? "Loses 1 AP." : "No AP was available to remove.") : "No AP was deducted outside tracked combat."} ${bashFollowUp.message} (Manual: move token back 1m)`
    };
  }
  return { success: false, message: `${actorName}'s bash fails.` };
}

async function _executeBlindOpponent({ actor, target, winner, actorName, targetName, isAutoWin, context }) {
  if (winner === "attacker" || isAutoWin) {
    const roundSeconds = Math.max(1, Number(TimeService.getRoundTimeSeconds?.() ?? 6) || 6);
    const duration = buildEffectDuration({
      actor: target,
      rounds: 1,
      seconds: roundSeconds,
      preferCombat: true
    });

    const applied = await _applyManagedCondition(context, target, "blinded", "blindOpponent");
    if (applied.skipped) return { success: false, skipped: true, message: `${targetName} is immune to Blinded; no condition applied.` };

    const effect = target.effects.find(e =>
      !e.disabled &&
      (getFlagValueWithFallback(e, "condition.key") === "blinded")
    );
    if (effect) {
      const parent = effect.parent;
      if (parent) {
        await context.stage("blinded.duration", async () => {
          if (!await requestUpdateDocument(effect, { duration })) throw new Error("Blinded duration update was not confirmed.");
          return { ok: true, effectUuids: [effect.uuid] };
        }, { documents: [target, effect] });
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

async function _executeFeint({ actor, target, winner, actorName, targetName, isAutoWin, context }) {
  if (winner === "attacker" || isAutoWin) {
    const roundSeconds = Math.max(1, Number(TimeService.getRoundTimeSeconds?.() ?? 6) || 6);
    const duration = buildEffectDuration({
      actor: target,
      rounds: 1,
      seconds: roundSeconds,
      preferCombat: true
    });

    const applied = await _applyManagedCondition(context, target, "feinted", "feint");
    if (applied.skipped) return { success: false, skipped: true, message: `${targetName} is immune to Feinted; no condition applied.` };

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
        await context.stage("feinted.metadata", async () => {
          if (!await requestUpdateDocument(effect, effectUpdates)) throw new Error("Feint metadata update was not confirmed.");
          return { ok: true, effectUuids: [effect.uuid] };
        }, { documents: [target, effect] });
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

async function _executeGrapple({ actor, target, winner, actorName, targetName, isAutoWin, prepared, context }) {
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
    const alreadyControlled = prepared?.alreadyControlled ?? _isTargetGrappledByActor(target, actor);
    const ownerTag = _grappleOwnerTag(actor);

    if (alreadyControlled) {
      const followUp = prepared ? prepared.grappleChoice ?? "" : await _showGrappleFollowUpChoice();
      if (followUp === "takedown") {
        await _applyManagedCondition(context, target, "prone", "Grapple: Takedown");
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

    await _applyManagedCondition(context, target, "restrained", ownerTag);
    await _applyManagedCondition(context, target, "grappled", ownerTag);
    await _stampConditionSource(target, "restrained", ownerTag, context);
    await _stampConditionSource(target, "grappled", ownerTag, context);

    return {
      success: true,
      message: `${actorName} grapples ${targetName}. ${targetName} is Restrained.`,
    };
  } finally {
    _GRAPPLE_ACTION_LOCKS.delete(lockKey);
  }
}

async function _executeResist({ actor, target, winner, actorName, targetName, isAutoWin, context }) {
  if (winner === "attacker" || isAutoWin) {
    await _removeManagedCondition(context, actor, "restrained");
    await _removeManagedCondition(context, actor, "grappled");
    await _removeManagedCondition(context, actor, "blinded");

    return {
      success: true,
      message: `${actorName} escapes!`
    };
  }
  return { success: false, message: `${actorName} fails to resist.` };
}

async function _executeTrip({ actor, target, winner, actorName, targetName, isAutoWin, context }) {
  if (winner === "attacker" || isAutoWin) {
    const applied = await _applyManagedCondition(context, target, "prone", "trip");
    if (applied.skipped) return { success: false, skipped: true, message: `${targetName} is immune to Prone; no condition applied.` };
    return {
      success: true,
      message: `${actorName} trips ${targetName}, making them Prone.`
    };
  }
  return { success: false, message: `${actorName} fails to trip ${targetName}.` };
}

async function _executeInClose({ actor, target, actorName, targetName, isAutoWin, context }) {
  if (!actor || !target) {
    return { success: false, message: "In Close requires both attacker and defender actors." };
  }

  const result = await toggleInCloseBetweenActors(actor, target, { requireOneMeterForEntry: true, outcomeContext: context,
    actorTokenUuid: context.outcome.payload.actorTokenUuid, targetTokenUuid: context.outcome.payload.targetTokenUuid });
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

/** Pure resolver shared by the legacy test-choice prompt and its roll. */
function computeSpecialActionChoiceTN({ actor, opponentActor, attackerActor, specialActionId, isAttacker, choice }) {
  let consumeConcussiveAfterRoll = false;
  let tn;
    let specialActionTNMod = 0;
    if (isAttacker && specialActionId === "bash") {
      const bonus = _getConcussiveNextBashBonus(actor);
      if (bonus > 0) {
        specialActionTNMod += bonus;
        consumeConcussiveAfterRoll = true;
      }
    }
    if (isAttacker && specialActionId === "grapple") {
      const sizeRule = _getGrappleSizeResult(actor, opponentActor);
      if (sizeRule.blocked) {
        return { reason: "Grapple failed: target is two or more size categories larger." };
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
      // Chapter 5: Size-to-hit modifier should apply to the attacker side of Special Actions.
      // This helper uses computeTN as a generic "Combat Style TN" resolver for both sides.
      // To avoid incorrectly applying size-to-hit to the defender roll, only pass opponent size
      // when the current side is the attacker.

      tn = computeTN({
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

    } else {
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
          return { reason: "Select a legal skill for this Special Action." };
        }

        tn = computeSkillTN({
          actor,
          skillItem,
          difficultyKey: "average",
          manualMod: 0
        });
        tn.finalTN = Math.max(0, Number(tn.finalTN ?? 0) + specialActionTNMod);
        tn.totalMod = Number(tn.totalMod ?? 0) + specialActionTNMod;
      }

    }
    return { tn, consumeConcussiveAfterRoll, testLabel: String(choice.testType || selectedItem?.name || (isCombatStyleTest ? "Combat Style" : "Skill")) };
}
