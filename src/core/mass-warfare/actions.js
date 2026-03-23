import { SYSTEM_ID, FLAG_SCOPE } from "../constants.js";
import { resolveWarfareProfile } from "./profile-registry.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import {
  requestDeleteEmbeddedDocuments,
  requestUpdateDocument,
} from "../../utils/authority-proxy.js";
import { doTestRoll, formatResultOutcomeLabel } from "../../utils/degree-roll-helper.js";
import { createOrUpdateStatusEffect } from "../active-effects/status-effect.js";
import { buildEffectDuration } from "../time/effect-duration.js";
import { buildWarfareDisciplineTN } from "./tn.js";
import { applyWarfareConditionDelta } from "./condition-target.js";

export const WARFARE_EFFECT_KEYS = Object.freeze({
  JOIN_FRAY_NEXT_CLASH: "joinFrayNextClash",
  HOLD_NEXT_DEFEND: "holdNextDefend",
  CHARGE: "charge",
  AMBUSH_HIDDEN: "ambushHidden",
  AMBUSH_READY: "ambushReady",
});

const TOKEN_ATTACH_FLAG = "warfareLeaderAttach";
const VALID_LEADER_ACTOR_TYPES = new Set(["player character", "npc"]);
const _tokenSyncLocks = new Set();
const _attachmentStates = new Map();
const _leaderToWarfare = new Map();
const _tokenPositionCache = new Map();
const LEADER_UPDATE_SUPPRESS_MS = 200;

const MESSENGER_TABLE = Object.freeze({
  1: "The messenger dies before delivering the message without their unit knowing.",
  2: "The messenger dies after delivering the message without their unit knowing.",
  3: "The messenger dies before delivering the message, but their Unit is informed.",
  4: "The messenger dies after delivering the message, but their Unit is informed.",
  5: "The messenger is delayed by 1 round.",
  6: "Everything goes as planned and the messenger delivers the message unimpeded.",
  7: "The messenger finds a shortcut, reducing their time by 1 round (minimum 1).",
  8: "The messenger finds a shortcut, reducing their time by 2 rounds (minimum 1).",
  9: "The messenger spots a weakness in an enemy unit. The enemy unit takes an extra 1d4 damage on its next Clash test.",
  10: "The messenger spots a crucial flaw in an enemy unit's formation. The enemy unit takes an extra 1d8 damage on its next Clash test.",
});

function esc(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function getActionEntry(actor, actionId, actionType) {
  const profileId = String(actor?.system?.profile?.id ?? "uesrpg-0_2");
  const profile = resolveWarfareProfile(profileId);
  const list = actionType === "leader"
    ? (profile?.actions?.leaderActions ?? [])
    : (profile?.actions?.unitActions ?? []);
  return list.find((entry) => entry.id === actionId) ?? null;
}

function getActionLabel(actor, entry) {
  if (!entry) return "Warfare Action";
  if (entry.id === "abandon") {
    return actor?.system?.commander?.uuid ? "Detach" : "Attach";
  }
  return entry.label;
}

function getActionSummary(actor, entry) {
  if (!entry) return "";
  if (entry.id === "abandon") {
    return actor?.system?.commander?.uuid
      ? "Detach the current leader from this warfare unit and release any linked token follower state."
      : "Attach a targeted PC or NPC actor as this warfare unit's leader and link their token if both are on scene.";
  }
  return entry.summary ?? "";
}

function buildActionCardHtml(actor, entry, {
  type = "unit",
  extraHtml = "",
} = {}) {
  const label = getActionLabel(actor, entry);
  const summary = getActionSummary(actor, entry);
  const typeLabel = type === "leader" ? "Leader Action" : "Unit Action";
  return `
    <div class="warfare-action-card">
      <h3 class="warfare-action-card__title">${esc(label)}</h3>
      <p class="warfare-action-card__type">${esc(typeLabel)}</p>
      ${summary ? `<p class="warfare-action-card__summary">${esc(summary)}</p>` : ""}
      ${extraHtml}
    </div>`;
}

async function postActionCard(actor, entry, {
  actionType = "unit",
  extraHtml = "",
  whisper = null,
  blind = false,
} = {}) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: buildActionCardHtml(actor, entry, { type: actionType, extraHtml }),
    flags: { [SYSTEM_ID]: { warfareAction: { id: entry?.id ?? "", type: actionType } } },
    ...(Array.isArray(whisper) && whisper.length ? { whisper } : {}),
    ...(blind ? { blind: true } : {}),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

function getEnabledEffectByKey(actor, key) {
  return actor?.effects?.find((effect) => !effect.disabled && effect?.flags?.[FLAG_SCOPE]?.key === key) ?? null;
}

async function deleteEffect(effect) {
  const parent = effect?.parent;
  if (!parent || !effect?.id) return;
  await requestDeleteEmbeddedDocuments(parent, "ActiveEffect", [effect.id]);
}

export function hasWarfareActionEffect(actor, key) {
  return Boolean(getEnabledEffectByKey(actor, key));
}

export async function consumeJoinFrayNextClash(actor) {
  const effect = getEnabledEffectByKey(actor, WARFARE_EFFECT_KEYS.JOIN_FRAY_NEXT_CLASH);
  if (!effect) return false;
  await deleteEffect(effect);
  return true;
}

export function hasHoldNextDefend(actor) {
  return hasWarfareActionEffect(actor, WARFARE_EFFECT_KEYS.HOLD_NEXT_DEFEND);
}

export async function consumeHoldNextDefend(actor) {
  const effect = getEnabledEffectByKey(actor, WARFARE_EFFECT_KEYS.HOLD_NEXT_DEFEND);
  if (!effect) return false;
  await deleteEffect(effect);
  return true;
}

async function upsertWarfareEffect(actor, {
  key,
  name,
  img,
  duration = null,
  changes = [],
  extraFlags = {},
} = {}) {
  return createOrUpdateStatusEffect(actor, {
    statusId: `uesrpg-warfare-${key}`,
    name,
    img,
    duration: duration ?? {},
    changes,
    flags: {
      [FLAG_SCOPE]: {
        key,
        warfare: true,
        ...extraFlags,
      },
    },
  });
}

function getGmRecipients() {
  return ChatMessage.getWhisperRecipients("GM") ?? [];
}

async function showRoll3d(roll) {
  if (!roll || !game?.dice3d?.showForRoll) return;
  try {
    await game.dice3d.showForRoll(roll, game.user, true);
  } catch (_err) {
    try {
      await game.dice3d.showForRoll(roll);
    } catch (_err2) {
      // no-op
    }
  }
}

async function promptDisciplineModifier(title, baseTn, helperText) {
  return customDialog({
    title,
    content: `
      <div class="warfare-discipline-dialog">
        <div class="form-group">
          <label>Modifier</label>
          <input type="number" name="modifier" value="0" style="width:90px;">
        </div>
        <p class="notes">Base Discipline TN: ${Number(baseTn) || 0}${helperText ? `<br>${esc(helperText)}` : ""}</p>
      </div>`,
    buttons: {
      roll: {
        label: "Roll",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return Number(root?.querySelector('[name="modifier"]')?.value ?? 0) || 0;
        },
      },
      cancel: { label: "Cancel" },
    },
    defaultButton: "roll",
  });
}

async function rollDiscipline(actor, {
  modifier = 0,
  joinFray = false,
  extraBreakdown = [],
} = {}) {
  const tnData = buildWarfareDisciplineTN(actor, {
    manualModifier: modifier,
    joinFray,
    extraBreakdown,
  });
  const result = await doTestRoll(actor, {
    target: tnData.finalTN,
    allowLucky: false,
    allowUnlucky: false,
  });
  await showRoll3d(result?.roll);
  return {
    baseTn: tnData.baseTN,
    target: tnData.finalTN,
    modifier: Number(modifier) || 0,
    tnData,
    result,
  };
}

async function postDisciplineOutcomeCard(actor, entry, {
  actionType,
  title,
  rollData,
  note = "",
  whisper = null,
  blind = false,
} = {}) {
  const { target, baseTn, modifier, result, tnData } = rollData;
  const outcome = formatResultOutcomeLabel(result);
  const breakdownRows = (tnData?.breakdown ?? []).map((entry) => {
    const value = Number(entry?.value ?? 0) || 0;
    const sign = value >= 0 ? "+" : "";
    return `<div style="display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:start;">
      <span style="overflow-wrap:anywhere; word-break:normal; text-align:left;">${esc(entry?.label ?? "Modifier")}</span>
      <span style="white-space:nowrap; text-align:right;">${sign}${value}</span>
    </div>`;
  }).join("");
  const extraHtml = `
    <div class="warfare-action-card__summary">
      <p><b>${esc(title)}</b></p>
      <p>TN: ${target}${modifier ? ` (base ${baseTn} ${modifier > 0 ? "+" : ""}${modifier})` : ""}</p>
      <p>Roll: ${result?.rollTotal ?? "?"} - ${esc(outcome)}${Number.isFinite(result?.degree) ? ` (${result.degree})` : ""}</p>
      ${breakdownRows ? `<details style="margin-top:4px;"><summary style="cursor:pointer; user-select:none; white-space:nowrap;">TN breakdown</summary><div style="margin-top:4px; font-size:12px; opacity:0.9;">${breakdownRows}</div></details>` : ""}
      ${note ? `<p>${note}</p>` : ""}
    </div>`;
  await postActionCard(actor, entry, { actionType, extraHtml, whisper, blind });
}

async function runLeaderShockRoll(commanderActor) {
  const baseTn = Number(commanderActor?.system?.characteristics?.end?.total ?? 0) || 0;
  const result = await doTestRoll(commanderActor, { target: baseTn, allowLucky: false, allowUnlucky: false });
  await showRoll3d(result?.roll);
  const outcome = formatResultOutcomeLabel(result);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: commanderActor }),
    content: `
      <div class="uesrpg-chat-card" data-card="warfare-shock">
        <header class="card-header"><h3>Shock Test</h3></header>
        <div class="card-content">
          <p><b>Target:</b> ${esc(commanderActor.name)}</p>
          <p><b>Reason:</b> Join the Fray</p>
          <p><b>TN:</b> ${baseTn}</p>
          <p><b>Roll:</b> ${result?.rollTotal ?? "?"} - ${esc(outcome)}${Number.isFinite(result?.degree) ? ` (${result.degree})` : ""}</p>
        </div>
      </div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

async function handleJoinFray(actor, entry, actionType) {
  const duration = buildEffectDuration({ actor, rounds: 1, preferCombat: true });
  await upsertWarfareEffect(actor, {
    key: WARFARE_EFFECT_KEYS.JOIN_FRAY_NEXT_CLASH,
    name: "Join the Fray",
    img: "icons/skills/melee/sword-damaged-broken-purple.webp",
    duration,
    extraFlags: { expiresOnTurnStart: true, singleUse: true },
  });

  let shockNote = "No commander is assigned; commander Shock test skipped.";
  const commanderUuid = actor?.system?.commander?.uuid;
  if (commanderUuid) {
    const commander = await fromUuid(commanderUuid);
    if (commander?.documentName === "Actor") {
      await runLeaderShockRoll(commander);
      shockNote = `Commander ${esc(commander.name)} rolled a Shock test.`;
    } else {
      ui.notifications?.warn?.("Assigned commander actor could not be resolved.");
    }
  } else {
    ui.notifications?.warn?.("This warfare unit has no commander assigned; Shock test skipped.");
  }

  await postActionCard(actor, entry, {
    actionType,
    extraHtml: `<p>${shockNote}</p><p>The next Clash test for this unit gains +10 TN from Join the Fray.</p>`,
  });
}

async function handleMessenger(actor, entry, actionType) {
  const roll = await (new Roll("1d10")).evaluate();
  await showRoll3d(roll);
  const total = Number(roll.total ?? 0) || 0;
  const effect = MESSENGER_TABLE[total] ?? "No Messenger Table result found.";
  await postActionCard(actor, entry, {
    actionType,
    extraHtml: `<p><b>Messenger Table:</b> ${total}</p><p>${esc(effect)}</p>`,
  });
}

async function handleRally(actor, entry, actionType) {
  const baseTn = Number(actor?.system?.stats?.discipline?.value ?? 0) || 0;
  const modifier = await promptDisciplineModifier(`${actor.name} - Rally the Unit`, baseTn, "On success, apply +10 Current Discipline until the unit's next activation.");
  if (modifier === null || modifier === undefined) return;
  const rollData = await rollDiscipline(actor, { modifier });

  let note = "Failure - no discipline was restored.";
  if (rollData.result?.isSuccess) {
    await requestUpdateDocument(actor, {
      "system.modifiers.discipline.battle.rallyBonus": true,
    });
    note = "Success - Rally the Unit applied (+10 Current Discipline).";
  }

  await postDisciplineOutcomeCard(actor, entry, {
    actionType,
    title: "Rally the Unit",
    rollData,
    note,
  });
}

async function handleHold(actor, entry, actionType) {
  const duration = buildEffectDuration({ actor, rounds: 1, preferCombat: true });
  await upsertWarfareEffect(actor, {
    key: WARFARE_EFFECT_KEYS.HOLD_NEXT_DEFEND,
    name: "Hold",
    img: "icons/skills/melee/shield-block-bash-blue.webp",
    duration,
    extraFlags: { expiresOnTurnStart: true, singleUse: true, clearsOnMove: true },
  });
  await postActionCard(actor, entry, {
    actionType,
    extraHtml: "<p>Hold is active. Enemy units take -20 TN to Clash Tests made against this unit, and this unit counts as Defending in its first Clash. The effect is lost if the unit moves first.</p>",
  });
}

function getTargetWarfareUnit(sourceActor, { allowSelf = false } = {}) {
  const targets = Array.from(game?.user?.targets ?? []);
  if (!targets.length && allowSelf && sourceActor?.type === "Warfare Unit") {
    return { actor: sourceActor, token: null };
  }
  if (targets.length !== 1) {
    ui.notifications?.warn?.("Target exactly one Warfare Unit token.");
    return null;
  }
  const token = targets[0];
  const actor = token?.actor ?? null;
  if (!actor || actor.type !== "Warfare Unit") {
    ui.notifications?.warn?.("The targeted token must belong to a Warfare Unit.");
    return null;
  }
  if (!allowSelf && sourceActor?.id && actor.id === sourceActor.id) {
    ui.notifications?.warn?.("This action cannot target the acting unit.");
    return null;
  }
  return { actor, token };
}

async function applyResolveLoss(actor, amount, { suppressed = null } = {}) {
  const current = Number(actor?.system?.stats?.resolve?.value ?? actor?.system?.stats?.condition?.value ?? 0) || 0;
  const max = Number(actor?.system?.stats?.resolve?.max ?? actor?.system?.stats?.condition?.max ?? current) || current;
  const loss = Math.max(0, Number(amount ?? 0) || 0);
  const next = Math.max(0, current - loss);
  const totalLoss = Math.max(0, Number(actor?.system?.stats?.resolve?.lossTotal ?? Math.max(0, max - current)) || 0) + loss;
  const db = Math.max(1, Number(actor?.system?._derived?.baseDb ?? actor?.system?._derived?.db ?? 1) || 1);
  const bulkLoss = loss > db ? 1 + Math.floor((loss - db) / db) : 0;
  const currentBulk = Math.max(0, Number(actor?.system?.stats?.bulk?.value ?? actor?.system?._derived?.bulkMax ?? actor?.system?.stats?.bulk?.max ?? 0) || 0);
  const currentBulkLossTotal = Math.max(0, Number(actor?.system?.stats?.bulk?.lossTotal ?? Math.max(0, (Number(actor?.system?.stats?.bulk?.max ?? currentBulk) || currentBulk) - currentBulk)) || 0);
  const nextBulk = Math.max(0, currentBulk - bulkLoss);
  const update = {
    "system.stats.resolve.value": next,
    "system.stats.resolve.lossTotal": totalLoss,
    "system.stats.condition.value": next,
  };
  if (bulkLoss > 0) {
    update["system.stats.bulk.value"] = nextBulk;
    update["system.stats.bulk.lossTotal"] = currentBulkLossTotal + bulkLoss;
    update["system.status.battle.defeated"] = nextBulk <= 0;
  }
  if (suppressed !== null) update["system.status.battle.suppressed"] = Boolean(suppressed);
  await requestUpdateDocument(actor, update);
  return { current, next, loss, totalLoss, bulkLoss, currentBulk, nextBulk, db };
}

function buildRangedDamageFormula(actor, { extraDie = false } = {}) {
  const base = String(actor?.system?.gear?.dmg ?? "2d4").trim() || "2d4";
  if (!extraDie) return base;
  const match = base.match(/^(\d+)d(\d+)$/i);
  if (!match) return base;
  return `${base} + 1d${match[2]}`;
}

async function promptRangedAttackOptions(actor) {
  const baseRange = Number(actor?.system?._derived?.rangedRange ?? 8) || 8;
  return customDialog({
    title: `${actor?.name ?? "Unit"} - Ranged Attack`,
    content: `
      <div class="warfare-discipline-dialog">
        <div class="form-group">
          <label>Modifier</label>
          <input type="number" name="modifier" value="0" style="width:90px;">
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="longRange"> Long Range (-10 TN)</label>
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="spareAmmo"> Use Spare Ammunition (extra die)</label>
        </div>
        <p class="notes">Base range: ${baseRange}. On success: DMG + DoS vs AR and the attacker becomes Suppressed. On failure: the target becomes Suppressed.</p>
      </div>`,
    buttons: {
      roll: {
        label: "Resolve",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return {
            modifier: Number(root?.querySelector('[name="modifier"]')?.value ?? 0) || 0,
            longRange: Boolean(root?.querySelector('[name="longRange"]')?.checked),
            spareAmmo: Boolean(root?.querySelector('[name="spareAmmo"]')?.checked),
          };
        },
      },
      cancel: { label: "Cancel" },
    },
    defaultButton: "roll",
  });
}

export async function rollWarfareRangedAttack(actor) {
  if (!actor?.system?._derived?.canRangedAttack) {
    ui.notifications?.warn?.("Only Skirmisher units can make standard ranged attacks.");
    return;
  }
  const targetRef = getTargetWarfareUnit(actor);
  if (!targetRef) return;
  const choices = await promptRangedAttackOptions(actor);
  if (!choices) return;

  const extraBreakdown = [];
  if (choices.longRange) extraBreakdown.push({ label: "Long Range", value: -10 });
  if (actor?.system?._derived?.traditionKey === "reach") extraBreakdown.push({ label: "Crag War", value: 10 });
  const rollData = await rollDiscipline(actor, {
    modifier: choices.modifier,
    extraBreakdown,
  });

  let note = "Failure - target becomes Suppressed.";
  let damageHtml = "";
  if (rollData.result?.isSuccess) {
    const formula = `${buildRangedDamageFormula(actor, { extraDie: choices.spareAmmo })} + ${Math.max(0, Number(rollData.result?.degree ?? 0) || 0)}`;
    const dmgRoll = await (new Roll(formula)).evaluate();
    await showRoll3d(dmgRoll);
    const rawTotal = Math.max(0, Number(dmgRoll.total ?? 0) || 0);
    const ar = Number(targetRef.actor?.system?.gear?.ar ?? 0) || 0;
    const loss = Math.max(0, rawTotal - ar);
    const result = await applyResolveLoss(targetRef.actor, loss);
    await requestUpdateDocument(actor, { "system.status.battle.suppressed": true });
    note = `Success - ${loss} Resolve loss after AR ${ar}.${result.bulkLoss ? ` Bulk ${result.currentBulk} → ${result.nextBulk} (${result.bulkLoss} lost vs DB ${result.db}).` : ""} Attacker becomes Suppressed.`;
    damageHtml = `<p><b>Damage:</b> <code>${esc(formula)}</code> = ${rawTotal}; target AR ${ar}; Resolve ${result.current} → ${result.next}</p>${result.bulkLoss ? `<p><b>Bulk:</b> ${result.currentBulk} → ${result.nextBulk} (${result.bulkLoss} lost vs DB ${result.db})</p>` : ""}`;
  } else {
    await requestUpdateDocument(targetRef.actor, { "system.status.battle.suppressed": true });
  }

  await postDisciplineOutcomeCard(actor, {
    id: "rangedAttack",
    label: "Ranged Attack",
    summary: "Resolve a standard Skirmisher ranged attack.",
  }, {
    actionType: "unit",
    title: "Ranged Attack",
    rollData,
    note: `${note}${choices.longRange ? " Long Range applied." : ""}`,
  });
  if (damageHtml) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="warfare-action-card"><h3 class="warfare-action-card__title">Ranged Attack Result</h3>${damageHtml}</div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
  }
}

async function promptSpellChoice(actor) {
  const implementEntries = Array.isArray(actor?.system?.magic?.entries) ? actor.system.magic.entries : [];
  const scrollEntries = Array.isArray(actor?.system?._derived?.equipmentEntries)
    ? actor.system._derived.equipmentEntries.filter((entry) => entry.isBattleScroll && !entry.expended)
    : [];
  const entries = [
    ...implementEntries.map((entry, index) => ({ source: "implement", index, entry })),
    ...scrollEntries.map((entry, index) => ({ source: "scroll", index, entry })),
  ];
  if (!entries.length) {
    ui.notifications?.warn?.("This unit has no Magic Implements or Battle Scrolls configured.");
    return null;
  }
  const options = entries.map((choice, optionIndex) => {
    const name = esc(choice.entry?.name ?? choice.entry?.key ?? `Implement ${optionIndex + 1}`);
    const family = esc(choice.source === "scroll" ? "battle scroll" : (choice.entry?.family ?? "support"));
    const count = Number(choice.entry?.count ?? 1) || 1;
    return `<option value="${optionIndex}">${name} (${family}, x${count})</option>`;
  }).join("");
  return customDialog({
    title: `${actor?.name ?? "Unit"} - Cast a Spell`,
    content: `
      <div class="warfare-discipline-dialog">
        <div class="form-group">
          <label>Spell Source</label>
          <select name="entryIndex">${options}</select>
        </div>
        <div class="form-group">
          <label>Modifier</label>
          <input type="number" name="modifier" value="0" style="width:90px;">
        </div>
      </div>`,
    buttons: {
      cast: {
        label: "Cast",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return {
            selectionIndex: Number(root?.querySelector('[name="entryIndex"]')?.value ?? -1),
            modifier: Number(root?.querySelector('[name="modifier"]')?.value ?? 0) || 0,
          };
        },
      },
      cancel: { label: "Cancel" },
    },
    defaultButton: "cast",
  });
}

function applyDisciplineRestorePatch(targetActor, amount) {
  const base = Number(targetActor?.system?.stats?.discipline?.base ?? 0) || 0;
  const bonus = Number(targetActor?.system?.stats?.discipline?.bonus ?? 0) || 0;
  const max = base + bonus;
  const current = Number(targetActor?.system?.stats?.discipline?.value ?? 0) || 0;
  const missing = Math.max(0, max - current);
  const restored = Math.min(missing, Math.max(0, Number(amount ?? 0) || 0));
  return { restored, target: current + restored };
}

export async function castWarfareSpell(actor) {
  const choice = await promptSpellChoice(actor);
  if (!choice) return;
  const implementEntries = Array.isArray(actor?.system?.magic?.entries) ? actor.system.magic.entries : [];
  const scrollEntries = Array.isArray(actor?.system?._derived?.equipmentEntries)
    ? actor.system._derived.equipmentEntries.filter((item) => item.isBattleScroll && !item.expended)
    : [];
  const selections = [
    ...implementEntries.map((entry, index) => ({ source: "implement", index, entry })),
    ...scrollEntries.map((entry, index) => ({ source: "scroll", index, entry })),
  ];
  const selected = selections[choice.selectionIndex];
  const entry = selected?.entry ?? null;
  if (!entry) return;

  const extraBreakdown = [];
  if (actor?.system?._derived?.traditionKey === "summerset") extraBreakdown.push({ label: "Arcane Precision", value: 0 });
  const rollData = await rollDiscipline(actor, { modifier: choice.modifier, extraBreakdown });
  let note = "Failure - the implement effect does not resolve.";
  let extraHtml = "";

  if (rollData.result?.isSuccess) {
    const key = String(entry?.key ?? "").trim();
    const name = String(entry?.name ?? key ?? "Implement");
    const count = Math.max(1, Number(entry?.count ?? 1) || 1);
    const formula = String(actor?.system?.gear?.dmg ?? "2d4");
    if (key === "healingChannels") {
      const targetRef = getTargetWarfareUnit(actor, { allowSelf: true });
      if (targetRef) {
        const healRoll = await (new Roll(formula)).evaluate();
        await showRoll3d(healRoll);
        const healed = await applyWarfareConditionDelta({ actor: targetRef.actor }, Number(healRoll.total ?? 0) || 0);
        note = `Success - ${name} restored ${healed.restored} Resolve.`;
      }
    } else if (key === "inspirationalChannels") {
      const targetRef = getTargetWarfareUnit(actor, { allowSelf: true });
      if (targetRef) {
        const restoreRoll = await (new Roll(formula)).evaluate();
        await showRoll3d(restoreRoll);
        const restore = applyDisciplineRestorePatch(targetRef.actor, Number(restoreRoll.total ?? 0) || 0);
        await requestUpdateDocument(targetRef.actor, {
          "system.modifiers.discipline.manual": Number(targetRef.actor?.system?.modifiers?.discipline?.manual ?? 0) + restore.restored,
        });
        note = `Success - ${name} restored ${restore.restored} Discipline (manual lane).`;
      }
    } else if (["fireChannels", "frostChannels", "shockChannels", "poisonChannels"].includes(key) && count >= 2) {
      const targetRef = getTargetWarfareUnit(actor);
      if (targetRef) {
        const dmgRoll = await (new Roll(formula)).evaluate();
        await showRoll3d(dmgRoll);
        const raw = Math.max(0, Number(dmgRoll.total ?? 0) || 0);
        const mar = Number(targetRef.actor?.system?.gear?.mar ?? 0) || 0;
        const loss = Math.max(0, raw - mar);
        const resolveState = await applyResolveLoss(targetRef.actor, loss);
        const statusPatch = {};
        if (key === "frostChannels") statusPatch["system.status.battle.suppressed"] = true;
        if (key === "poisonChannels") statusPatch["system.modifiers.discipline.battle.commanderLost"] = true;
        if (Object.keys(statusPatch).length) await requestUpdateDocument(targetRef.actor, statusPatch);
        note = `Success - ${name} dealt ${loss} magical Resolve loss after MAR ${mar}.${resolveState.bulkLoss ? ` Bulk ${resolveState.currentBulk} → ${resolveState.nextBulk} (${resolveState.bulkLoss} lost vs DB ${resolveState.db}).` : ""}`;
        extraHtml = `<p><b>Target Resolve:</b> ${resolveState.current} → ${resolveState.next}</p>${resolveState.bulkLoss ? `<p><b>Bulk:</b> ${resolveState.currentBulk} → ${resolveState.nextBulk} (${resolveState.bulkLoss} lost vs DB ${resolveState.db})</p>` : ""}`;
      }
    } else {
      note = `Success - ${name} is active until the start of this unit's next Activation.`;
    }

    if (selected?.source === "scroll") {
      const equipmentEntries = foundry.utils.deepClone(actor.system?.equipment?.owned ?? []);
      const matchIndex = equipmentEntries.findIndex((candidate) =>
        String(candidate?.key ?? "").trim() === String(entry?.key ?? "").trim()
        && String(candidate?.name ?? "").trim() === String(entry?.name ?? "").trim()
        && Boolean(candidate?.expended) === false
      );
      if (matchIndex >= 0) {
        equipmentEntries[matchIndex].expended = true;
        await requestUpdateDocument(actor, { "system.equipment.owned": equipmentEntries });
      }
    }
  }

  await postDisciplineOutcomeCard(actor, {
    id: "castSpell",
    label: "Cast a Spell",
    summary: "Resolve a Magic Implement or Battle Scroll.",
  }, {
    actionType: "unit",
    title: "Cast a Spell",
    rollData,
    note,
  });
  if (extraHtml) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="warfare-action-card"><h3 class="warfare-action-card__title">Implement Result</h3>${extraHtml}</div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
  }
}

function getTargetLeaderActor() {
  const targets = Array.from(game?.user?.targets ?? []);
  if (targets.length !== 1) {
    ui.notifications?.warn?.("Target exactly one PC or NPC token to attach as commander.");
    return null;
  }
  const targetActor = targets[0]?.actor ?? null;
  const actorType = String(targetActor?.type ?? "").trim().toLowerCase();
  if (!targetActor || !VALID_LEADER_ACTOR_TYPES.has(actorType)) {
    ui.notifications?.warn?.("The targeted token must belong to a PC or NPC actor.");
    return null;
  }
  return { actor: targetActor, token: targets[0] };
}

function getActiveSceneTokenForActor(actor) {
  const scene = game?.scenes?.current;
  if (!scene) return null;
  return scene.tokens.find((tokenDoc) => tokenDoc?.actor?.id === actor.id) ?? null;
}

function getTokenPlaceable(tokenDoc) {
  return tokenDoc?.object ?? (tokenDoc?.id ? canvas?.tokens?.get?.(tokenDoc.id) ?? null : null);
}

function getTokenPixelSize(tokenLike) {
  const placeable = tokenLike?.document ? tokenLike : getTokenPlaceable(tokenLike);
  const doc = tokenLike?.document ?? tokenLike;
  const width = Number(placeable?.w ?? NaN);
  const height = Number(placeable?.h ?? NaN);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  const gridSize = Number(doc?.parent?.grid?.size ?? canvas?.grid?.size ?? canvas?.scene?.grid?.size ?? 100) || 100;
  return {
    width: (Number(doc?.width ?? 1) || 1) * gridSize,
    height: (Number(doc?.height ?? 1) || 1) * gridSize,
  };
}

function getTokenCenter(tokenLike) {
  const placeable = tokenLike?.document ? tokenLike : getTokenPlaceable(tokenLike);
  if (placeable?.center?.x != null && placeable?.center?.y != null) {
    return {
      x: Number(placeable.center.x),
      y: Number(placeable.center.y),
    };
  }
  const doc = tokenLike?.document ?? tokenLike;
  const x = Number(doc?.x ?? NaN);
  const y = Number(doc?.y ?? NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const size = getTokenPixelSize(doc);
  return {
    x: x + (size.width / 2),
    y: y + (size.height / 2),
  };
}

function getSnapPosition(warfareTokenLike, leaderTokenLike) {
  const warfareCenter = getTokenCenter(warfareTokenLike);
  if (!warfareCenter) return null;
  const leaderSize = getTokenPixelSize(leaderTokenLike);
  return {
    x: Math.round(warfareCenter.x - (leaderSize.width / 2)),
    y: Math.round(warfareCenter.y - (leaderSize.height / 2)),
  };
}

function isLiveTokenDoc(tokenDoc) {
  return Boolean(tokenDoc?.parent && tokenDoc?.id && tokenDoc.parent.tokens?.has?.(tokenDoc.id));
}

function getTokenSyncKey(warfareTokenDoc, leaderTokenDoc) {
  return [
    warfareTokenDoc?.uuid ?? "warfare-missing",
    leaderTokenDoc?.uuid ?? "leader-missing",
  ].join("::");
}

function getAttachmentRuntimeState(warfareTokenUuid) {
  return _attachmentStates.get(String(warfareTokenUuid ?? ""));
}

function setAttachmentRuntimeState(state) {
  const warfareTokenUuid = String(state?.warfareTokenUuid ?? "");
  const leaderTokenUuid = String(state?.leaderTokenUuid ?? "");
  if (!warfareTokenUuid || !leaderTokenUuid) return null;
  const next = {
    lastWarfareCenter: null,
    lastDesiredPosition: null,
    documentSyncInFlight: false,
    previewActive: false,
    suppressLeaderUntil: 0,
    pendingCommit: false,
    sceneId: "",
    ...state,
  };
  _attachmentStates.set(warfareTokenUuid, next);
  _leaderToWarfare.set(leaderTokenUuid, warfareTokenUuid);
  return next;
}

function clearAttachmentRuntimeState({ warfareTokenUuid = "", leaderTokenUuid = "" } = {}) {
  const warfareUuid = String(warfareTokenUuid || "");
  const leaderUuid = String(leaderTokenUuid || "");
  const state = warfareUuid ? _attachmentStates.get(warfareUuid) : (_leaderToWarfare.has(leaderUuid)
    ? _attachmentStates.get(_leaderToWarfare.get(leaderUuid))
    : null);
  const targetWarfareUuid = warfareUuid || String(state?.warfareTokenUuid ?? "");
  const targetLeaderUuid = leaderUuid || String(state?.leaderTokenUuid ?? "");
  if (targetWarfareUuid) _attachmentStates.delete(targetWarfareUuid);
  if (targetLeaderUuid) _leaderToWarfare.delete(targetLeaderUuid);
  if (targetWarfareUuid) _tokenPositionCache.delete(targetWarfareUuid);
  if (targetLeaderUuid) _tokenPositionCache.delete(targetLeaderUuid);
}

function getAttachmentStateForLeader(leaderTokenUuid) {
  const warfareTokenUuid = _leaderToWarfare.get(String(leaderTokenUuid ?? ""));
  return warfareTokenUuid ? _attachmentStates.get(warfareTokenUuid) ?? null : null;
}

function isSameSceneAttachment(warfareTokenDoc, leaderTokenDoc) {
  return Boolean(warfareTokenDoc && leaderTokenDoc && warfareTokenDoc.parent?.id && warfareTokenDoc.parent?.id === leaderTokenDoc.parent?.id);
}

function applyLeaderPreviewPosition(leaderTokenDoc, desired) {
  if (!leaderTokenDoc || !desired) return;
  const placeable = getTokenPlaceable(leaderTokenDoc);
  if (!placeable) return;
  const currentX = Number(leaderTokenDoc.x ?? NaN);
  const currentY = Number(leaderTokenDoc.y ?? NaN);
  if (currentX === desired.x && currentY === desired.y) return;
  if (typeof leaderTokenDoc.updateSource === "function") leaderTokenDoc.updateSource({ x: desired.x, y: desired.y });
  else {
    leaderTokenDoc.x = desired.x;
    leaderTokenDoc.y = desired.y;
  }
  placeable.renderFlags?.set?.({ refreshPosition: true });
}

function cacheAttachmentSync(state, warfareTokenDoc, desired) {
  if (!state) return;
  state.lastDesiredPosition = desired ? { x: desired.x, y: desired.y } : null;
  const center = getTokenCenter(warfareTokenDoc);
  state.lastWarfareCenter = center ? { x: center.x, y: center.y } : null;
}

function getPositionCacheKey(tokenDoc) {
  return String(tokenDoc?.uuid ?? tokenDoc?.id ?? "");
}

function consumeTokenPositionChange(tokenLike) {
  const tokenDoc = tokenLike?.document ?? tokenLike;
  const center = getTokenCenter(tokenLike);
  const key = getPositionCacheKey(tokenDoc);
  if (!center || !key) return false;
  const last = _tokenPositionCache.get(key);
  const changed = !last || last.x !== center.x || last.y !== center.y;
  if (changed) _tokenPositionCache.set(key, center);
  return changed;
}

function resolveAttachmentPairFromWarfareToken(warfareTokenDoc) {
  const data = warfareTokenDoc?.getFlag?.(FLAG_SCOPE, TOKEN_ATTACH_FLAG);
  if (!data || data.role !== "warfareUnit") return null;
  const leaderTokenDoc = fromUuidSync(data.leaderTokenUuid ?? "");
  if (!leaderTokenDoc || !isSameSceneAttachment(warfareTokenDoc, leaderTokenDoc)) return { data, leaderTokenDoc: null };
  return { data, leaderTokenDoc };
}

function resolveAttachmentPairFromLeaderToken(leaderTokenDoc) {
  const data = leaderTokenDoc?.getFlag?.(FLAG_SCOPE, TOKEN_ATTACH_FLAG);
  if (!data || data.role !== "leader") return null;
  const warfareTokenDoc = fromUuidSync(data.warfareTokenUuid ?? "");
  if (!warfareTokenDoc || !isSameSceneAttachment(warfareTokenDoc, leaderTokenDoc)) return { data, warfareTokenDoc: null };
  return { data, warfareTokenDoc };
}

async function writeAttachmentFlags({ warfareTokenDoc, leaderTokenDoc, actor, leaderActorUuid = "" }) {
  if (!warfareTokenDoc || !leaderTokenDoc || warfareTokenDoc.parent?.id !== leaderTokenDoc.parent?.id) {
    clearAttachmentRuntimeState({
      warfareTokenUuid: actor?.system?.commanderAttachment?.warfareTokenUuid ?? "",
      leaderTokenUuid: actor?.system?.commanderAttachment?.leaderTokenUuid ?? "",
    });
    await requestUpdateDocument(actor, {
      "system.commanderAttachment.warfareTokenUuid": "",
      "system.commanderAttachment.leaderTokenUuid": "",
      "system.commanderAttachment.sceneId": "",
    });
    return false;
  }

  const attachment = {
    leaderActorUuid: String(leaderActorUuid || actor?.system?.commander?.uuid || ""),
    warfareTokenUuid: warfareTokenDoc.uuid,
    leaderTokenUuid: leaderTokenDoc.uuid,
    sceneId: String(warfareTokenDoc.parent?.id ?? ""),
  };

  await requestUpdateDocument(actor, {
    "system.commanderAttachment.leaderActorUuid": attachment.leaderActorUuid,
    "system.commanderAttachment.warfareTokenUuid": attachment.warfareTokenUuid,
    "system.commanderAttachment.leaderTokenUuid": attachment.leaderTokenUuid,
    "system.commanderAttachment.sceneId": attachment.sceneId,
  });

  await requestUpdateDocument(warfareTokenDoc, {
    [`flags.${FLAG_SCOPE}.${TOKEN_ATTACH_FLAG}`]: {
      role: "warfareUnit",
      ...attachment,
    },
  });
  await requestUpdateDocument(leaderTokenDoc, {
    [`flags.${FLAG_SCOPE}.${TOKEN_ATTACH_FLAG}`]: {
      role: "leader",
      ...attachment,
    },
  });

  const snap = getSnapPosition(warfareTokenDoc, leaderTokenDoc);
  setAttachmentRuntimeState({
    warfareTokenUuid: attachment.warfareTokenUuid,
    leaderTokenUuid: attachment.leaderTokenUuid,
    sceneId: attachment.sceneId,
    previewActive: false,
    suppressLeaderUntil: Date.now() + LEADER_UPDATE_SUPPRESS_MS,
  });
  if (snap) {
    applyLeaderPreviewPosition(leaderTokenDoc, snap);
    await requestUpdateDocument(leaderTokenDoc, { x: snap.x, y: snap.y });
    const state = getAttachmentRuntimeState(attachment.warfareTokenUuid);
    cacheAttachmentSync(state, warfareTokenDoc, snap);
  }
  return true;
}

async function clearTokenAttachmentFlags({ warfareTokenDoc = null, leaderTokenDoc = null } = {}) {
  if (isLiveTokenDoc(warfareTokenDoc)) {
    await requestUpdateDocument(warfareTokenDoc, { [`flags.${FLAG_SCOPE}.-=${TOKEN_ATTACH_FLAG}`]: null });
  }
  if (isLiveTokenDoc(leaderTokenDoc)) {
    await requestUpdateDocument(leaderTokenDoc, { [`flags.${FLAG_SCOPE}.-=${TOKEN_ATTACH_FLAG}`]: null });
  }
}

export async function clearCommanderAttachment(actor, {
  clearCommander = false,
  warfareTokenDocOverride = null,
  leaderTokenDocOverride = null,
  skipWarfareTokenFlagClear = false,
  skipLeaderTokenFlagClear = false,
} = {}) {
  const warfareTokenDoc = warfareTokenDocOverride ?? fromUuidSync(actor?.system?.commanderAttachment?.warfareTokenUuid ?? "") ?? null;
  const leaderTokenDoc = leaderTokenDocOverride ?? fromUuidSync(actor?.system?.commanderAttachment?.leaderTokenUuid ?? "") ?? null;
  clearAttachmentRuntimeState({
    warfareTokenUuid: warfareTokenDoc?.uuid ?? actor?.system?.commanderAttachment?.warfareTokenUuid ?? "",
    leaderTokenUuid: leaderTokenDoc?.uuid ?? actor?.system?.commanderAttachment?.leaderTokenUuid ?? "",
  });
  await clearTokenAttachmentFlags({
    warfareTokenDoc: skipWarfareTokenFlagClear ? null : warfareTokenDoc,
    leaderTokenDoc: skipLeaderTokenFlagClear ? null : leaderTokenDoc,
  });

  const update = {
    "system.commanderAttachment.leaderActorUuid": "",
    "system.commanderAttachment.warfareTokenUuid": "",
    "system.commanderAttachment.leaderTokenUuid": "",
    "system.commanderAttachment.sceneId": "",
  };
  if (clearCommander) {
    Object.assign(update, {
      "system.commander.uuid": "",
      "system.commander.id": "",
      "system.commander.name": "",
      "system.commander.img": "",
      "system.status.leaderless": true,
      "system.combat.leaderless": true,
      "system.modifiers.discipline.battle.commanderLost": true,
    });
  }
  await requestUpdateDocument(actor, update);
}

async function handleAttachDetach(actor, entry, actionType) {
  if (actor?.system?.commander?.uuid) {
    await clearCommanderAttachment(actor, { clearCommander: true });
    await postActionCard(actor, entry, {
      actionType,
      extraHtml: "<p>Commander detached and token attachment cleared.</p>",
    });
    return;
  }

  const target = getTargetLeaderActor();
  if (!target) return;

  await requestUpdateDocument(actor, {
    "system.commander.uuid": target.actor.uuid,
    "system.commander.id": target.actor.id,
    "system.commander.name": target.actor.name,
    "system.commander.img": target.actor.img,
    "system.status.leaderless": false,
    "system.combat.leaderless": false,
    "system.modifiers.discipline.battle.commanderLost": false,
    "system.commanderAttachment.leaderActorUuid": target.actor.uuid,
  });

  const warfareTokenDoc = getActiveSceneTokenForActor(actor);
  const leaderTokenDoc = target.token?.document ?? getActiveSceneTokenForActor(target.actor);
  const linked = await writeAttachmentFlags({
    warfareTokenDoc,
    leaderTokenDoc,
    actor,
    leaderActorUuid: target.actor.uuid,
  });
  await postActionCard(actor, entry, {
    actionType,
    extraHtml: `<p>${esc(target.actor.name)} attached as commander.${linked ? " Token follow linked on the active scene." : " Token follow skipped because one or both tokens were not found on the active scene."}</p>`,
  });
}

async function handleCharge(actor, entry, actionType) {
  const duration = buildEffectDuration({ actor, rounds: 1, preferCombat: true });
  await upsertWarfareEffect(actor, {
    key: WARFARE_EFFECT_KEYS.CHARGE,
    name: "Charge",
    img: "icons/skills/movement/arrow-upward-yellow.webp",
    duration,
    extraFlags: { expiresOnTurnStart: true },
  });
  await postActionCard(actor, entry, {
    actionType,
    extraHtml: "<p>Speed is doubled for the current round/turn. Ambush extra damage remains a stored rule reminder for later automation.</p>",
  });
}

async function handleAmbush(actor, entry, actionType) {
  const baseTn = Number(actor?.system?.stats?.discipline?.value ?? 0) || 0;
  const modifier = await promptDisciplineModifier(`${actor.name} - Ambush`, baseTn, "Blind GM roll. On success, gain Hidden and Ambush Ready.");
  if (modifier === null || modifier === undefined) return;
  const extraBreakdown = [];
  if (actor?.system?._derived?.fieldcraftActive) extraBreakdown.push({ label: "Fieldcraft", value: 10 });
  if (actor?.system?._derived?.implementEntries?.some?.((item) => item.key === "veilChannel")) extraBreakdown.push({ label: "Veil Channel", value: 10 });
  const rollData = await rollDiscipline(actor, { modifier, extraBreakdown });
  const whisper = getGmRecipients();

  if (rollData.result?.isSuccess) {
    await requestUpdateDocument(actor, {
      "system.status.battle.hidden": true,
      "system.combat.hidden": true,
      "system.status.battle.ambushReady": true,
      "system.status.battle.revealed": false,
    });
    await upsertWarfareEffect(actor, {
      key: WARFARE_EFFECT_KEYS.AMBUSH_HIDDEN,
      name: "Ambush Hidden",
      img: "icons/magic/perception/shadow-stealth-eyes-purple.webp",
    });
    await upsertWarfareEffect(actor, {
      key: WARFARE_EFFECT_KEYS.AMBUSH_READY,
      name: "Ambush Ready",
      img: "icons/skills/melee/strike-weapons-orange.webp",
    });
  } else {
    await requestUpdateDocument(actor, {
      "system.status.battle.ambushReady": false,
    });
  }

  const note = rollData.result?.isSuccess
    ? "Success - Hidden and Ambush Ready applied. The unit loses Hidden after moving, being detected by Scout, or making a Clash test."
    : "Failure - no ambush state was applied.";
  await postDisciplineOutcomeCard(actor, entry, {
    actionType,
    title: "Set Ambush",
    rollData,
    note,
    whisper,
    blind: true,
  });
}

async function handleScout(actor, entry, actionType) {
  const baseTn = Number(actor?.system?.stats?.discipline?.value ?? 0) || 0;
  const modifier = await promptDisciplineModifier(`${actor.name} - Scout`, baseTn, "Blind GM roll. Compare this unit's DoS against hostile ambushers.");
  if (modifier === null || modifier === undefined) return;
  const extraBreakdown = [];
  if (actor?.system?._derived?.fieldcraftActive) extraBreakdown.push({ label: "Fieldcraft", value: 10 });
  if (Number(actor?.system?._derived?.breakScoutBonus ?? 0) > 0) {
    extraBreakdown.push({ label: "Scout Bonus", value: Number(actor.system._derived.breakScoutBonus) || 0 });
  }
  const rollData = await rollDiscipline(actor, { modifier, extraBreakdown });
  const note = rollData.result?.isSuccess
    ? `Success - compare ${rollData.result?.degree ?? 0} DoS against hostile ambush attempts. Hidden enemy units that do not beat this result are revealed.`
    : "Failure - the unit does not reveal hostile ambushers this movement.";
  await postDisciplineOutcomeCard(actor, entry, {
    actionType,
    title: "Scout",
    rollData,
    note,
    whisper: getGmRecipients(),
    blind: true,
  });
}

async function handleGeneric(actor, entry, actionType) {
  await postActionCard(actor, entry, { actionType });
}

async function handleAdvance(actor, entry, actionType) {
  const speed = Number(actor?.system?.stats?.speed?.value ?? 0) || 0;
  await postActionCard(actor, entry, {
    actionType,
    extraHtml: `<p>This unit may move up to ${speed * 2} spaces this Activation.</p>`,
  });
}

export async function handleWarfareAction(actor, { actionId = "", actionType = "unit" } = {}) {
  const entry = getActionEntry(actor, actionId, actionType);
  if (!entry) return;

  switch (actionId) {
    case "advance":
      return handleAdvance(actor, entry, actionType);
    case "joinFray":
      return handleJoinFray(actor, entry, actionType);
    case "rally":
      return handleRally(actor, entry, actionType);
    case "abandon":
      return handleAttachDetach(actor, entry, actionType);
    case "hold":
      return handleHold(actor, entry, actionType);
    case "castSpell":
      return castWarfareSpell(actor);
    case "setAmbush":
      return handleAmbush(actor, entry, actionType);
    case "scout":
      return handleScout(actor, entry, actionType);
    default:
      return handleGeneric(actor, entry, actionType);
  }
}

export function transformWarfareActionEntries(actor, entries = []) {
  return entries.map((entry) => {
    if (entry?.id !== "abandon") return entry;
    return {
      ...entry,
      label: getActionLabel(actor, entry),
      summary: getActionSummary(actor, entry),
    };
  });
}

async function clearBrokenAttachment(tokenDoc) {
  const data = tokenDoc?.getFlag?.(FLAG_SCOPE, TOKEN_ATTACH_FLAG);
  if (!data) return;
  clearAttachmentRuntimeState({
    warfareTokenUuid: data.warfareTokenUuid ?? "",
    leaderTokenUuid: data.leaderTokenUuid ?? "",
  });
  const warfareTokenDoc = fromUuidSync(data.warfareTokenUuid ?? "");
  const leaderTokenDoc = fromUuidSync(data.leaderTokenUuid ?? "");
  const warfareActor = warfareTokenDoc?.actor ?? tokenDoc?.actor ?? null;
  if (warfareActor?.type === "Warfare Unit") {
    const deletingWarfareToken = String(data?.role ?? "") === "warfareUnit" || tokenDoc?.actor?.type === "Warfare Unit";
    await clearCommanderAttachment(warfareActor, {
      clearCommander: deletingWarfareToken,
      warfareTokenDocOverride: warfareTokenDoc,
      leaderTokenDocOverride: leaderTokenDoc,
      skipWarfareTokenFlagClear: deletingWarfareToken,
      skipLeaderTokenFlagClear: !isLiveTokenDoc(leaderTokenDoc),
    });
    return;
  }
  await clearTokenAttachmentFlags({ warfareTokenDoc, leaderTokenDoc });
}

async function syncAttachedLeaderPreview(warfareTokenDoc) {
  const pair = resolveAttachmentPairFromWarfareToken(warfareTokenDoc);
  if (!pair?.data) return;
  const { data, leaderTokenDoc } = pair;
  if (!leaderTokenDoc) {
    await clearBrokenAttachment(warfareTokenDoc);
    return;
  }
  const state = setAttachmentRuntimeState({
    ...getAttachmentRuntimeState(data.warfareTokenUuid),
    warfareTokenUuid: data.warfareTokenUuid,
    leaderTokenUuid: data.leaderTokenUuid,
    sceneId: String(data.sceneId ?? warfareTokenDoc.parent?.id ?? ""),
  });
  const desired = getSnapPosition(warfareTokenDoc, leaderTokenDoc);
  if (!desired) return;
  state.previewActive = true;
  state.suppressLeaderUntil = Date.now() + LEADER_UPDATE_SUPPRESS_MS;
  cacheAttachmentSync(state, warfareTokenDoc, desired);
  applyLeaderPreviewPosition(leaderTokenDoc, desired);
}

async function syncAttachedLeaderToken(warfareTokenDoc) {
  const pair = resolveAttachmentPairFromWarfareToken(warfareTokenDoc);
  if (!pair?.data) return;
  const { data, leaderTokenDoc } = pair;
  if (!leaderTokenDoc) {
    await clearBrokenAttachment(warfareTokenDoc);
    return;
  }
  const state = setAttachmentRuntimeState({
    ...getAttachmentRuntimeState(data.warfareTokenUuid),
    warfareTokenUuid: data.warfareTokenUuid,
    leaderTokenUuid: data.leaderTokenUuid,
    sceneId: String(data.sceneId ?? warfareTokenDoc.parent?.id ?? ""),
  });
  const lockKey = getTokenSyncKey(warfareTokenDoc, leaderTokenDoc);
  if (_tokenSyncLocks.has(lockKey)) return;
  if (state.documentSyncInFlight) {
    state.pendingCommit = true;
    return;
  }
  _tokenSyncLocks.add(lockKey);
  try {
    state.documentSyncInFlight = true;
    do {
      state.pendingCommit = false;
      state.previewActive = false;
      const snap = getSnapPosition(warfareTokenDoc, leaderTokenDoc);
      if (!snap) return;
      state.suppressLeaderUntil = Date.now() + LEADER_UPDATE_SUPPRESS_MS;
      cacheAttachmentSync(state, warfareTokenDoc, snap);
      applyLeaderPreviewPosition(leaderTokenDoc, snap);
      const needsUpdate =
        Number(leaderTokenDoc.x ?? 0) !== snap.x ||
        Number(leaderTokenDoc.y ?? 0) !== snap.y;
      if (!needsUpdate) continue;
      await requestUpdateDocument(leaderTokenDoc, {
        x: snap.x,
        y: snap.y,
      });
    } while (state.pendingCommit);
  } finally {
    state.documentSyncInFlight = false;
    state.previewActive = false;
    _tokenSyncLocks.delete(lockKey);
  }
}

function shouldSuppressLeaderCorrection(state) {
  return Boolean(state && (state.previewActive || state.documentSyncInFlight || Date.now() < Number(state.suppressLeaderUntil ?? 0)));
}

function leaderNeedsCorrection(leaderTokenDoc, desired) {
  if (!leaderTokenDoc || !desired) return false;
  return Number(leaderTokenDoc.x ?? 0) !== desired.x || Number(leaderTokenDoc.y ?? 0) !== desired.y;
}

async function syncFromLeaderToken(leaderTokenDoc) {
  const pair = resolveAttachmentPairFromLeaderToken(leaderTokenDoc);
  if (!pair?.data) return;
  const { data, warfareTokenDoc } = pair;
  if (!warfareTokenDoc) {
    await clearBrokenAttachment(leaderTokenDoc);
    return;
  }
  const state = setAttachmentRuntimeState({
    ...getAttachmentStateForLeader(data.leaderTokenUuid),
    warfareTokenUuid: data.warfareTokenUuid,
    leaderTokenUuid: data.leaderTokenUuid,
    sceneId: String(data.sceneId ?? warfareTokenDoc.parent?.id ?? ""),
  });
  const desired = state.lastDesiredPosition ?? getSnapPosition(warfareTokenDoc, leaderTokenDoc);
  if (shouldSuppressLeaderCorrection(state) || !leaderNeedsCorrection(leaderTokenDoc, desired)) return;
  await syncAttachedLeaderToken(warfareTokenDoc);
}

export function registerWarfareAttachmentHooks() {
  Hooks.on("refreshToken", async (token) => {
    if (!game.user?.isGM) return;
    const tokenDoc = token?.document ?? null;
    if (!tokenDoc) return;
    const data = tokenDoc.getFlag?.(FLAG_SCOPE, TOKEN_ATTACH_FLAG);
    if (!data) return;
    if (!consumeTokenPositionChange(token)) return;
    if (data.role === "warfareUnit") {
      await syncAttachedLeaderPreview(tokenDoc);
      return;
    }
    if (data.role === "leader") {
      const state = getAttachmentStateForLeader(data.leaderTokenUuid ?? tokenDoc.uuid);
      if (!state || shouldSuppressLeaderCorrection(state)) return;
      const desired = state.lastDesiredPosition ?? null;
      if (!leaderNeedsCorrection(tokenDoc, desired)) return;
      applyLeaderPreviewPosition(tokenDoc, desired);
    }
  });

  Hooks.on("updateToken", async (tokenDoc, changed) => {
    if (!game.user?.isGM) return;
    if (!tokenDoc) return;
    if ("x" in (changed ?? {}) || "y" in (changed ?? {})) {
      const tokenActor = tokenDoc.actor ?? null;
      if (tokenActor?.type === "Warfare Unit" && hasHoldNextDefend(tokenActor)) {
        await consumeHoldNextDefend(tokenActor).catch(() => false);
      }
      const data = tokenDoc.getFlag?.(FLAG_SCOPE, TOKEN_ATTACH_FLAG);
      if (data?.role === "warfareUnit") {
        await syncAttachedLeaderToken(tokenDoc);
      } else if (data?.role === "leader") {
        await syncFromLeaderToken(tokenDoc);
      }
    }
  });

  Hooks.on("deleteToken", async (tokenDoc) => {
    if (!game.user?.isGM) return;
    await clearBrokenAttachment(tokenDoc);
  });

  Hooks.on("canvasReady", async () => {
    if (!game.user?.isGM) return;
    const scene = game?.scenes?.current;
    if (!scene) return;
    for (const tokenDoc of scene.tokens.contents) {
      const data = tokenDoc.getFlag?.(FLAG_SCOPE, TOKEN_ATTACH_FLAG);
      if (data?.role === "warfareUnit") {
        setAttachmentRuntimeState({
          warfareTokenUuid: data.warfareTokenUuid,
          leaderTokenUuid: data.leaderTokenUuid,
          sceneId: String(data.sceneId ?? scene.id ?? ""),
        });
        await syncAttachedLeaderPreview(tokenDoc);
        await syncAttachedLeaderToken(tokenDoc);
      }
    }
  });

  Hooks.on("canvasTearDown", () => {
    _tokenSyncLocks.clear();
    _attachmentStates.clear();
    _leaderToWarfare.clear();
    _tokenPositionCache.clear();
  });
}
