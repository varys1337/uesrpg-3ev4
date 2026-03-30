/**
 * src/core/luck/luck-workflow.js
 *
 * RAW Chapter 1 - Luck Point spending and permanent Luck burning.
 */

import { requestUpdateDocument, requestUpdateChatMessage } from "../../utils/authority-proxy.js";
import { customDialog, confirmDialog } from "../../utils/dialog-v2-helper.js";
import { doTestRoll, formatDegree, formatResultOutcomeLabel, formatResultSummary } from "../../utils/degree-roll-helper.js";
import { SYSTEM_ID } from "../constants.js";
import { getMessageIdFromContextLi } from "../../utils/chat/contextmenu.js";
import { applyLuckResultMutation, canMutateLuckResult } from "./result-reresolution.js";
import { canUseLuck } from "../rules/npc-rules.js";
import {
  canUserActOnLuckActor,
  getLuckWhisperRecipients,
  resolveLuckActor,
  resolveLuckActorFromSpeaker,
} from "./actor-resolution.js";
import { classifyLuckMessage } from "./message-classification.js";
import { getLuckRollMode } from "./roll-mode.js";
import { escapeLuckHtml, pickLuckSide } from "./side-selection.js";
import { getLuckBurnStarsignProfile } from "../traits/starsigns/index.js";

const ROLL_FORMULA = "1d100";
const MANUAL_BURN_LUCK_OPTIONS = Object.freeze([
  {
    id: "burn1",
    cost: 1,
    title: "Burn 1 Luck",
    effectText: "Add a degree of success to a successful test. This can be done multiple times for a given test.",
    confirmTitle: "Burn 1 Luck",
    confirmLabel: "Burn 1 Luck",
  },
  {
    id: "burn3",
    cost: 3,
    title: "Burn 3 Luck",
    effectText: "Reroll a failed test. This may only be done once for a given test and cannot reroll Critical Failures.",
    confirmTitle: "Burn 3 Luck",
    confirmLabel: "Burn 3 Luck",
  },
  {
    id: "burn5",
    cost: 5,
    title: "Burn 5 Luck",
    effectText: "Negate the effects of a critical failure. This must be done immediately after the test is rolled.",
    confirmTitle: "Burn 5 Luck",
    confirmLabel: "Burn 5 Luck",
  },
  {
    id: "burn10",
    cost: 10,
    title: "Burn 10 Luck",
    effectText: "Ignore the effects of a wound. Alternatively, with GM permission, survive death at great cost until the encounter ends.",
    confirmTitle: "Burn 10 Luck",
    confirmLabel: "Burn 10 Luck",
  },
]);

function _esc(str) {
  return escapeLuckHtml(str);
}

function _classifyMessage(message) {
  return classifyLuckMessage(message);
}

function _resolveActor(_message, uuid) {
  return resolveLuckActor(uuid);
}

function _resolveActorFromSpeaker(message) {
  return resolveLuckActorFromSpeaker(message);
}

function _getWhisperRecipients(actor) {
  return getLuckWhisperRecipients(actor);
}

function _canUserActOnActor(actor) {
  return canUserActOnLuckActor(actor);
}

async function _pickSide(info, opts = {}) {
  return pickLuckSide(info, {
    ...opts,
    classifyMessage: _classifyMessage,
    canMutateLuckResult,
  });
}

function _mapExtraFlagsToContext(extraFlags = {}) {
  const ctx = {};
  if (!extraFlags || typeof extraFlags !== "object") return ctx;

  const getBool = (path) => (extraFlags[path] !== undefined ? Boolean(extraFlags[path]) : undefined);

  const luckUsed = getBool(`flags.${SYSTEM_ID}.luckUsedOnTest`);
  if (luckUsed !== undefined) ctx.luckUsed = luckUsed;

  const luckBurned = getBool(`flags.${SYSTEM_ID}.luckBurned`);
  if (luckBurned !== undefined) ctx.luckBurned = luckBurned;

  const rerollUsed = getBool(`flags.${SYSTEM_ID}.reroll.used`);
  if (rerollUsed !== undefined) ctx.rerollUsed = rerollUsed;

  const rerollSource = extraFlags[`flags.${SYSTEM_ID}.reroll.source`];
  if (typeof rerollSource === "string" && rerollSource.trim()) ctx.rerollSource = rerollSource.trim();

  return ctx;
}

function _getBurnBaseLuck(actor) {
  return Number(actor?.system?.characteristics?.lck?.base ?? actor?.system?.characteristics?.lck?.value ?? 0) || 0;
}

function _getTotalLuck(actor) {
  return Number(actor?.system?.characteristics?.lck?.total ?? actor?.system?.characteristics?.lck?.value ?? 0) || 0;
}

function _buildLuckBurnAppliedText(actor, burnApplied) {
  const actorName = _esc(actor?.name ?? "Actor");
  const effectiveBurn = Math.max(0, Number(burnApplied?.effectiveBurn ?? 0) || 0);
  const sourceText = Array.isArray(burnApplied?.sources) && burnApplied.sources.length
    ? ` (${_esc(burnApplied.sources.join("; "))})`
    : "";

  if (burnApplied?.forcedAllRemaining) {
    return `<p><b>${actorName}</b> could not pay doubled burn cost and burned all remaining Luck instead (<b>${effectiveBurn}</b>).</p>`;
  }

  return `<p><b>${actorName}</b> permanently burned <b>${effectiveBurn} Luck</b>${sourceText}.</p>`;
}

function _buildManualBurnLuckChatContent(actor, option, burnApplied) {
  return `<div class="uesrpg">
    <h3 style="color: #c44;">Luck Burned</h3>
    ${_buildLuckBurnAppliedText(actor, burnApplied)}
    <p><b>Effect:</b> ${_esc(option.effectText)}</p>
    <p><b>Remaining Luck:</b> ${Math.max(0, Number(burnApplied?.nextBase ?? 0) || 0)}</p>
  </div>`;
}

export function getBurnLuckTotals(actor) {
  return {
    currentLuck: _getBurnBaseLuck(actor),
    totalLuck: _getTotalLuck(actor),
  };
}

export function getManualBurnLuckOptions(actor) {
  const { currentLuck } = getBurnLuckTotals(actor);
  return MANUAL_BURN_LUCK_OPTIONS.map((option) => ({ ...option, available: currentLuck >= option.cost }));
}

export function canOpenBurnLuckFromSheet(actor, { notify = false } = {}) {
  if (!actor) {
    if (notify) ui.notifications?.warn?.("No actor found for Burn Luck.");
    return false;
  }
  if (!_canUserActOnActor(actor)) {
    if (notify) ui.notifications?.warn?.("You do not have permission to burn Luck for this actor.");
    return false;
  }
  if (!canUseLuck(actor)) {
    if (notify) ui.notifications?.warn?.("This actor cannot use Luck.");
    return false;
  }
  return true;
}

export async function burnLuckManually(actor, optionId) {
  if (!canOpenBurnLuckFromSheet(actor, { notify: true })) return false;

  const option = MANUAL_BURN_LUCK_OPTIONS.find((entry) => entry.id === optionId);
  if (!option) {
    ui.notifications?.warn?.("Unknown Burn Luck option.");
    return false;
  }

  const currentBase = _getBurnBaseLuck(actor);
  if (currentBase < option.cost) {
    ui.notifications?.warn?.(`Not enough Luck to burn. Need ${option.cost}, have ${currentBase}.`);
    return false;
  }

  const burnApplied = await _applyLuckBurnCost(actor, option.cost);
  if (!burnApplied?.ok) {
    ui.notifications?.warn?.("Burn effect applied, but permanent Luck could not be reduced.");
    return false;
  }

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: _buildManualBurnLuckChatContent(actor, option, burnApplied),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });

  return true;
}

async function _spendLuckPoint(actor, amount = 1) {
  const currentLp = Number(actor?.system?.luck_points?.value ?? 0) || 0;
  const cost = Math.max(0, Number(amount ?? 0) || 0);
  if (cost <= 0) return true;
  const nextLp = Math.max(0, currentLp - cost);
  return requestUpdateDocument(actor, { "system.luck_points.value": nextLp });
}

async function _applyLuckBurnCost(actor, burnAmount) {
  const currentBase = _getBurnBaseLuck(actor);
  const requestedBurn = Math.max(0, Number(burnAmount ?? 0) || 0);
  const profile = getLuckBurnStarsignProfile(actor);
  let effectiveBurn = profile.doubleBurnCost ? (requestedBurn * 2) : requestedBurn;
  let forcedAllRemaining = false;

  if (profile.burnAllIfInsufficient && currentBase < effectiveBurn) {
    effectiveBurn = currentBase;
    forcedAllRemaining = true;
  }

  const nextBase = Math.max(0, currentBase - effectiveBurn);
  const ok = await requestUpdateDocument(actor, {
    "system.characteristics.lck.base": nextBase,
    "system.characteristics.lck.value": nextBase,
  });
  return {
    ok,
    currentBase,
    requestedBurn,
    effectiveBurn,
    nextBase,
    forcedAllRemaining,
    sources: Array.isArray(profile?.sources) ? [...profile.sources] : []
  };
}

async function spendLPReroll(message) {
  if (!message) return false;
  const info = _classifyMessage(message);
  if (!info) {
    ui.notifications?.warn?.("This message does not contain a test result.");
    return false;
  }
  if (info.staminaUsed) {
    ui.notifications?.warn?.("Cannot use both Luck and Stamina on the same test (RAW).");
    return false;
  }
  if (info.rerolled) {
    ui.notifications?.warn?.("This test has already been rerolled.");
    return false;
  }

  const side = await _pickSide(info, { requireResult: true, requireFailure: true, message });
  if (!side) {
    ui.notifications?.info?.("No failed result eligible for Luck reroll.");
    return false;
  }
  if (side.result?.isCriticalFailure) {
    ui.notifications?.warn?.("Cannot use Luck Points to reroll Critical Failures.");
    return false;
  }

  const actor = _resolveActor(message, side.actorUuid);
  if (!actor) {
    ui.notifications?.warn?.("Cannot resolve actor.");
    return false;
  }

  const currentLp = Number(actor.system?.luck_points?.value ?? 0);
  if (currentLp <= 0) {
    ui.notifications?.warn?.("No Luck Points remaining.");
    return false;
  }

  const target = side.tn ?? (side.result?.target ?? NaN);
  if (!Number.isFinite(target)) {
    ui.notifications?.warn?.("Target number unavailable.");
    return false;
  }

  const confirmed = await confirmDialog({
    title: "Spend Luck Point - Reroll",
    content: `<div class="uesrpg"><p>Spend <b>1 LP</b> to reroll <b>${_esc(side.label)}</b>?</p><p>Current LP: <b>${currentLp}</b></p></div>`,
    yesLabel: "Reroll (1 LP)",
    noLabel: "Cancel",
    yesIcon: "fas fa-dice-d20",
    rejectClose: false,
  });
  if (!confirmed) return false;

  const res = await doTestRoll(actor, { rollFormula: ROLL_FORMULA, target, allowLucky: true, allowUnlucky: true });
  const newResult = {
    isSuccess: Boolean(res.isSuccess),
    degree: Number(res.degree ?? 0) || 0,
    isCriticalSuccess: Boolean(res.isCriticalSuccess),
    isCriticalFailure: Boolean(res.isCriticalFailure),
    rollTotal: Number(res.rollTotal ?? res.roll?.total ?? NaN),
    target,
    textual: String(res.textual ?? ""),
  };

  const persisted = await applyLuckResultMutation(message, info, side, newResult, {
    extraContext: _mapExtraFlagsToContext({
      [`flags.${SYSTEM_ID}.luckUsedOnTest`]: true,
      [`flags.${SYSTEM_ID}.reroll.used`]: true,
      [`flags.${SYSTEM_ID}.reroll.source`]: "luck-point",
    }),
    classifyMessage: _classifyMessage,
  });
  if (!persisted) {
    ui.notifications?.warn?.("Could not persist reroll result. Luck Point was not spent.");
    return false;
  }

  const flavor = `<div class="uesrpg">
    <div><b>${_esc(side.label)}</b> - Reroll (Spent 1 LP)</div>
    <div style="opacity:0.85; font-size:12px;"><b>Target Number:</b> ${target}</div>
    <div style="margin-top:4px;">
      ${res.isSuccess
        ? `<b style="color:green;">${formatResultSummary(res, { uppercase: true, includeDegree: true, degreeStyle: "dash" })}</b>`
        : `<b style="color:rgb(168,5,5);">${formatResultSummary(res, { uppercase: true, includeDegree: true, degreeStyle: "dash" })}</b>`}
    </div>
    ${info.type === "skillTest" ? "" : `<div style="opacity:0.7; font-size:11px;">LP remaining: ${Math.max(0, currentLp - 1)}</div>`}
  </div>`;

  await res.roll.toMessage({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    flags: {
      [SYSTEM_ID]: info.type === "skillTest"
        ? {
            reroll: { isReroll: true, parentMessageId: message.id, source: "luck-point" },
            skillTest: { ...info.raw, ...newResult, isReroll: true },
            luckUsedOnTest: true,
          }
        : {
            reroll: { isReroll: true, parentMessageId: message.id, source: "luck-point" },
            luckUsedOnTest: true,
          },
    },
    whisper: info.type === "skillTest" ? undefined : _getWhisperRecipients(actor),
    rollMode: info.type === "skillTest" ? getLuckRollMode(info.raw) : undefined,
  });

  const lpSpent = await _spendLuckPoint(actor, 1);
  if (!lpSpent) ui.notifications?.warn?.("Reroll applied but LP could not be deducted.");
  return true;
}

async function spendLPAddDoS(message) {
  if (!message) return false;
  const info = _classifyMessage(message);
  if (!info) {
    ui.notifications?.warn?.("This message does not contain a test result.");
    return false;
  }
  if (info.staminaUsed) {
    ui.notifications?.warn?.("Cannot use both Luck and Stamina on the same test (RAW).");
    return false;
  }

  const side = await _pickSide(info, { requireResult: true, requireSuccess: true, message });
  if (!side) {
    ui.notifications?.info?.("No successful result eligible for +1 DoS.");
    return false;
  }

  const actor = _resolveActor(message, side.actorUuid);
  if (!actor) {
    ui.notifications?.warn?.("Cannot resolve actor.");
    return false;
  }

  const currentLp = Number(actor.system?.luck_points?.value ?? 0);
  if (currentLp <= 0) {
    ui.notifications?.warn?.("No Luck Points remaining.");
    return false;
  }

  const confirmed = await confirmDialog({
    title: "Spend Luck Point - +1 DoS",
    content: `<div class="uesrpg"><p>Spend <b>1 LP</b> to add <b>+1 DoS</b> to <b>${_esc(side.label)}</b>?</p><p>Current DoS: <b>${side.result.degree}</b> · LP: <b>${currentLp}</b></p></div>`,
    yesLabel: "+1 DoS (1 LP)",
    noLabel: "Cancel",
    yesIcon: "fas fa-plus",
    rejectClose: false,
  });
  if (!confirmed) return false;

  const nextDegree = (side.result.degree ?? 0) + 1;
  const newResult = { ...side.result, degree: nextDegree, textual: `${nextDegree} DoS` };
  const persisted = await applyLuckResultMutation(message, info, side, newResult, {
    extraContext: _mapExtraFlagsToContext({
      [`flags.${SYSTEM_ID}.luckUsedOnTest`]: true,
    }),
    classifyMessage: _classifyMessage,
  });
  if (!persisted) {
    ui.notifications?.warn?.("Could not persist +1 DoS. Luck Point was not spent.");
    return false;
  }

  const lpSpent = await _spendLuckPoint(actor, 1);
  if (!lpSpent) ui.notifications?.warn?.("+1 DoS applied but LP could not be deducted.");

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="uesrpg"><b>Luck Point Spent</b>: +1 DoS on ${_esc(side.label)} (now ${nextDegree} DoS). LP remaining: ${Math.max(0, currentLp - 1)}.</div>`,
    whisper: _getWhisperRecipients(actor),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });

  return true;
}

async function openBurnLuckDialog(actorOrMessage) {
  let actor;
  let message = null;
  let info = null;

  if (actorOrMessage?.documentName === "ChatMessage") {
    message = actorOrMessage;
    info = _classifyMessage(message);
    if (info?.sides?.length) {
      const firstOwned = info.sides.find((side) => {
        const sideActor = _resolveActor(null, side.actorUuid);
        return _canUserActOnActor(sideActor);
      });
      actor = firstOwned ? _resolveActor(null, firstOwned.actorUuid) : null;
    }
    if (!actor) actor = _resolveActorFromSpeaker(message);
  } else if (actorOrMessage?.documentName === "Actor") {
    actor = actorOrMessage;
  } else {
    actor = actorOrMessage;
  }

  if (!actor) {
    ui.notifications?.warn?.("No actor found for Burn Luck.");
    return;
  }

  const hasMessage = Boolean(message && info);
  const currentLuck = _getBurnBaseLuck(actor);
  const totalLuck = _getTotalLuck(actor);
  const luckBonus = Number(actor.system?.characteristics?.lck?.bonus ?? 0);
  const burnOptions = [
    { id: "burn1", cost: 1, label: "+1 DoS to a successful test", requiresMessage: true, requiresSuccess: true },
    { id: "burn3", cost: 3, label: "Reroll a failed test", requiresMessage: true, requiresFailure: true },
    { id: "burn5", cost: 5, label: "Negate effects of a Critical Failure", requiresMessage: true },
    { id: "burn10", cost: 10, label: "Ignore wound effects / survive death (GM permission)", requiresMessage: false },
  ];

  const optionRows = burnOptions.map((opt) => {
    const available = currentLuck >= opt.cost;
    const disabled = available ? "" : "disabled";
    const contextNote = opt.requiresMessage && !hasMessage ? " (requires a test roll)" : "";
    return `<option value="${opt.id}" ${disabled}>${opt.label} (Burn ${opt.cost} Luck)${contextNote}</option>`;
  }).join("");

  await customDialog({
    title: "Burn Luck",
    content: `<div class="uesrpg" style="padding: 10px;">
      <div style="background: rgba(180, 180, 180, 0.562); border: solid 1px; padding: 10px; font-style: italic; margin-bottom: 10px;">
        Permanently reduce your Luck characteristic to gain powerful effects. Burned Luck never regenerates naturally.
      </div>
      <div style="margin-bottom: 8px;">
        <b>${_esc(actor.name)}</b> - Burnable Luck (base): <b>${currentLuck}</b> · Total Luck: <b>${totalLuck}</b> (Bonus: ${luckBonus})
      </div>
      <label style="font-weight: 600;">Burn Effect:</label>
      <select name="burn-option" style="width: 100%; margin-top: 4px;">${optionRows}</select>
    </div>`,
    buttons: {
      burn: {
        label: "Burn Luck",
        icon: "fas fa-fire",
        callback: async (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const selected = root?.querySelector('select[name="burn-option"]')?.value;
          if (!selected) return;
          const opt = burnOptions.find((entry) => entry.id === selected);
          if (!opt) return;
          if (currentLuck < opt.cost) {
            ui.notifications?.warn?.(`Not enough Luck to burn. Need ${opt.cost}, have ${currentLuck}.`);
            return;
          }
          await _executeBurn(actor, message, info, opt);
        }
      },
      cancel: { label: "Cancel", icon: "fas fa-times" }
    },
    default: "cancel",
    width: 550,
  });
}

async function _executeBurn(actor, message, info, opt) {
  const burnAmount = opt.cost;
  const currentBase = _getBurnBaseLuck(actor);
  if (currentBase < burnAmount) {
    ui.notifications?.warn?.(`Not enough Luck to burn. Need ${burnAmount}, have ${currentBase}.`);
    return false;
  }

  let effectText = "";
  switch (opt.id) {
    case "burn1": {
      if (!message || !info) {
        ui.notifications?.warn?.("Burn 1 requires an applicable test card.");
        return false;
      }
      const side = await _pickSide(info, { requireResult: true, requireSuccess: true, message });
      if (!side) {
        ui.notifications?.warn?.("No successful result eligible for Burn 1.");
        return false;
      }
      const nextDegree = (side.result.degree ?? 0) + 1;
      const newResult = { ...side.result, degree: nextDegree, textual: `${nextDegree} DoS` };
      const persisted = await applyLuckResultMutation(message, info, side, newResult, {
        extraContext: _mapExtraFlagsToContext({ [`flags.${SYSTEM_ID}.luckBurned`]: true }),
        classifyMessage: _classifyMessage,
      });
      if (!persisted) {
        ui.notifications?.warn?.("Could not apply Burn 1 effect. Luck was not burned.");
        return false;
      }
      effectText = `+1 DoS on ${side.label} (now ${nextDegree} DoS)`;
      break;
    }
    case "burn3": {
      if (!message || !info) {
        ui.notifications?.warn?.("Burn 3 requires an applicable test card.");
        return false;
      }
      const side = await _pickSide(info, { requireResult: true, requireFailure: true, message });
      if (!side) {
        ui.notifications?.warn?.("No failed result eligible for Burn 3 reroll.");
        return false;
      }
      if (side.result?.isCriticalFailure) {
        ui.notifications?.warn?.("Cannot reroll Critical Failures, even with burned Luck.");
        return false;
      }
      const target = side.tn ?? (side.result?.target ?? NaN);
      if (!Number.isFinite(target)) {
        ui.notifications?.warn?.("Target number unavailable for Burn 3 reroll.");
        return false;
      }
      const sideActor = _resolveActor(null, side.actorUuid) ?? actor;
      const res = await doTestRoll(sideActor, { rollFormula: ROLL_FORMULA, target, allowLucky: true, allowUnlucky: true });
      const newResult = {
        isSuccess: Boolean(res.isSuccess),
        degree: Number(res.degree ?? 0) || 0,
        isCriticalSuccess: Boolean(res.isCriticalSuccess),
        isCriticalFailure: Boolean(res.isCriticalFailure),
        rollTotal: Number(res.rollTotal ?? res.roll?.total ?? NaN),
        target,
        textual: String(res.textual ?? ""),
      };
      const persisted = await applyLuckResultMutation(message, info, side, newResult, {
        extraContext: _mapExtraFlagsToContext({
          [`flags.${SYSTEM_ID}.reroll.used`]: true,
          [`flags.${SYSTEM_ID}.reroll.source`]: "luck-burn",
          [`flags.${SYSTEM_ID}.luckBurned`]: true,
        }),
        classifyMessage: _classifyMessage,
      });
      if (!persisted) {
        ui.notifications?.warn?.("Could not apply Burn 3 reroll. Luck was not burned.");
        return false;
      }

      const flavor = `<div class="uesrpg"><div><b>${_esc(side.label)}</b> - Reroll (Burned ${burnAmount} Luck)</div>
        <div style="opacity:0.85; font-size:12px;"><b>Target Number:</b> ${target}</div>
        <div style="margin-top:4px;">${res.isSuccess
          ? `<b style="color:green;">${formatResultSummary(res, { uppercase: true, includeDegree: true, degreeStyle: "dash" })}</b>`
          : `<b style="color:rgb(168,5,5);">${formatResultSummary(res, { uppercase: true, includeDegree: true, degreeStyle: "dash" })}</b>`}</div></div>`;
      await res.roll.toMessage({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: sideActor }),
        flavor,
        flags: {
          [SYSTEM_ID]: { reroll: { isReroll: true, parentMessageId: message.id, source: "luck-burn" }, luckBurned: true },
        },
        rollMode: getLuckRollMode(info.raw),
      });
      effectText = `Rerolled ${side.label}: ${formatResultOutcomeLabel(res)} (${formatDegree(res)})`;
      break;
    }
    case "burn5": {
      effectText = "Critical Failure effects negated.";
      if (message) {
        await requestUpdateChatMessage(message, {
          [`flags.${SYSTEM_ID}.luckBurned`]: true,
          [`flags.${SYSTEM_ID}.criticalFailureNegated`]: true,
        });
      }
      break;
    }
    case "burn10":
      effectText = "Wound effects ignored / death survived (GM decision).";
      break;
    default:
      ui.notifications?.warn?.("Unknown burn option.");
      return false;
  }

  const burnApplied = await _applyLuckBurnCost(actor, burnAmount);
  if (!burnApplied?.ok) {
    ui.notifications?.warn?.("Burn effect applied, but permanent Luck could not be reduced.");
    return false;
  }

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="uesrpg">
      <h3 style="color: #c44;">Luck Burned</h3>
      ${_buildLuckBurnAppliedText(actor, burnApplied)}
      <p><b>Effect:</b> ${_esc(effectText)}</p>
      <p><b>Remaining Luck:</b> ${burnApplied.nextBase}</p>
    </div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });

  return true;
}

export function registerLuckContextMenuOptions(_hookName, options) {
  if (!Array.isArray(options)) return;
  const hasLP = options.some((option) => String(option?.name ?? "").trim() === "Spend Luck Point");
  const hasBurn = options.some((option) => String(option?.name ?? "").trim() === "Burn Luck");

  if (!hasLP) {
    options.push({
      name: "Spend Luck Point",
      icon: '<i class="fas fa-clover"></i>',
      condition: (li) => {
        const msgId = getMessageIdFromContextLi(li);
        if (!msgId) return false;
        const message = game.messages?.get?.(msgId);
        if (!message) return false;
        const info = _classifyMessage(message);
        if (!info) return false;
        const hasEligibleSide = info.sides.some((side) => {
          if (!side.result) return false;
          const actor = _resolveActor(null, side.actorUuid);
          if (!_canUserActOnActor(actor)) return false;
          const lp = Number(actor?.system?.luck_points?.value ?? 0);
          if (lp <= 0) return false;
          return canMutateLuckResult(message, info, side, { classifyMessage: _classifyMessage }).ok;
        });
        return hasEligibleSide && !info.staminaUsed;
      },
      callback: async (li) => {
        const msgId = getMessageIdFromContextLi(li);
        const message = game.messages?.get?.(msgId);
        if (!message) return;
        const info = _classifyMessage(message);
        if (!info) return;

        const hasFailure = info.sides.some((side) =>
          side.result?.isSuccess === false
          && _canUserActOnActor(_resolveActor(null, side.actorUuid))
          && canMutateLuckResult(message, info, side, { classifyMessage: _classifyMessage }).ok);
        const hasSuccess = info.sides.some((side) =>
          side.result?.isSuccess === true
          && _canUserActOnActor(_resolveActor(null, side.actorUuid))
          && canMutateLuckResult(message, info, side, { classifyMessage: _classifyMessage }).ok);

        if (hasFailure && hasSuccess) {
          const choice = await _askRerollOrDoS();
          if (choice === "reroll") await spendLPReroll(message);
          else if (choice === "dos") await spendLPAddDoS(message);
        } else if (hasFailure) {
          await spendLPReroll(message);
        } else if (hasSuccess) {
          await spendLPAddDoS(message);
        }
      }
    });
  }

  if (!hasBurn) {
    options.push({
      name: "Burn Luck",
      icon: '<i class="fas fa-fire"></i>',
      condition: (li) => {
        const msgId = getMessageIdFromContextLi(li);
        if (!msgId) return false;
        const message = game.messages?.get?.(msgId);
        if (!message) return false;
        const info = _classifyMessage(message);
        if (!info) return false;
        return info.sides.some((side) => {
          const actor = _resolveActor(null, side.actorUuid);
          if (!_canUserActOnActor(actor)) return false;
          const luck = _getBurnBaseLuck(actor);
          if (luck <= 0) return false;
          return canMutateLuckResult(message, info, side, { classifyMessage: _classifyMessage }).ok;
        });
      },
      callback: async (li) => {
        const msgId = getMessageIdFromContextLi(li);
        const message = game.messages?.get?.(msgId);
        if (!message) return;
        await openBurnLuckDialog(message);
      }
    });
  }
}

async function _askRerollOrDoS() {
  return new Promise((resolve) => {
    customDialog({
      title: "Spend Luck Point",
      content: `<div class="uesrpg" style="padding:8px;">
        <p>This test has both failed and successful sides. What would you like to do?</p>
        <select name="luck-action" style="width:100%;">
          <option value="reroll">Reroll a failed test (1 LP)</option>
          <option value="dos">+1 DoS on a successful test (1 LP)</option>
        </select>
      </div>`,
      buttons: {
        ok: {
          label: "Confirm",
          icon: "fas fa-check",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            resolve(root?.querySelector('select[name="luck-action"]')?.value ?? null);
          }
        },
        cancel: { label: "Cancel", icon: "fas fa-times", callback: () => resolve(null) }
      },
      default: "ok",
      width: 380,
    }).catch(() => resolve(null));
  });
}

export async function openBurnLuckFromSheet(actor) {
  if (!canOpenBurnLuckFromSheet(actor, { notify: true })) return false;
  const { BurnLuckDialog } = await import("../../ui/apps/burn-luck-dialog.js");
  return BurnLuckDialog.show(actor);
}

export async function markStaminaUsedOnTest(message) {
  if (!message) return;
  await requestUpdateChatMessage(message, {
    [`flags.${SYSTEM_ID}.staminaUsedOnTest`]: true,
  });
}

export const LuckAPI = {
  spendLPReroll,
  spendLPAddDoS,
  openBurnDialog: openBurnLuckDialog,
  openBurnLuckFromSheet,
  burnLuckManually,
  getManualBurnLuckOptions,
  registerLuckContextMenuOptions,
  markStaminaUsedOnTest,
};
