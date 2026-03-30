import { applyGroupedEffect } from "../../utils/ae-helpers.js";
import { requestDeleteEmbeddedDocuments, requestUpdateDocument, requestUpdateEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../system/namespace.js";
import { getFlagValueWithFallback } from "../system/flags.js";

export const FEAR_FLAG = "fear";
export const FEAR_GROUP_PREFIX = "fear.";
export const SNAP_PROMPT_DEDUPE_MAX = 5000;
const _snapPromptTurnKeys = new Set();

function effects(actor) {
  return actor?.effects?.contents ?? [];
}

export function isFearEffect(effect) {
  const lane = getFlagValueWithFallback(effect, FEAR_FLAG);
  return lane && typeof lane === "object";
}

export function getFearEffects(actor) {
  return effects(actor).filter((effect) => isFearEffect(effect) && !effect.disabled);
}

export function fearLane(effect) {
  return getFlagValueWithFallback(effect, FEAR_FLAG) ?? null;
}

export function escapeFearHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function wpTN(actor, modifier = 0, type = "") {
  const wp = Number(actor?.system?.characteristics?.wp?.total ?? 0) || 0;
  const fearType = String(type ?? "").trim().toLowerCase();
  const fearBonus = Number(actor?.system?.modifiers?.tests?.fear ?? 0) || 0;
  const typedBonus = fearType === "horror"
    ? (Number(actor?.system?.modifiers?.tests?.horror ?? 0) || 0)
    : fearType === "panic"
      ? (Number(actor?.system?.modifiers?.tests?.panic ?? 0) || 0)
      : 0;
  return wp + Number(modifier || 0) + fearBonus + typedBonus;
}

export function isFearImmune(actor, type) {
  const t = String(type ?? "panic").toLowerCase();
  const lane = actor?.system?.traits?.immunity ?? {};
  if (lane?.fear === true) return true;
  if (lane?.horror === true && t === "horror") return true;
  if (lane?.panic === true && t === "panic") return true;
  if (actor?.system?.traits?.condition?.frenzied === true) return true;
  return false;
}

export function buildStartOfNextTurnExpiry(actor) {
  const combat = game.combat ?? null;
  const combatant = combat?.combatants?.find?.((c) => c?.actor?.id === actor?.id) ?? null;
  if (!(combat && combat.started && combatant)) return {};

  const turns = Array.isArray(combat.turns) ? combat.turns : [];
  const idx = turns.findIndex((t) => String(t?.id ?? "") === String(combatant.id ?? ""));
  const currentTurn = Number(combat.turn ?? 0);
  const currentRound = Number(combat.round ?? 0);
  const expiresTurn = idx >= 0 ? idx : currentTurn;
  const expiresRound = (idx >= 0 && Number.isFinite(currentTurn) && Number.isFinite(currentRound) && idx <= currentTurn)
    ? (currentRound + 1)
    : currentRound;

  return {
    expiresOnTurnStart: true,
    expiresCombatId: String(combat.id ?? ""),
    expiresRound,
    expiresTurn,
    expiresCombatantId: String(combatant.id ?? ""),
  };
}

export function nameWithRounds(baseName, rounds) {
  const name = String(baseName ?? "").trim() || "Fear Effect";
  const n = Math.max(0, Number(rounds ?? 0) || 0);
  if (!n) return name.replace(/\s*\(\d+\s+rounds?\)\s*$/i, "");
  if (/\(\d+\s+rounds?\)\s*$/i.test(name)) {
    return name.replace(/\(\d+\s+rounds?\)\s*$/i, `(${n} rounds)`);
  }
  return `${name} (${n} rounds)`;
}

export function combatTurnPromptKey(combat, actorId = "") {
  return `${String(combat?.id ?? "")}:${Number(combat?.round ?? 0)}:${Number(combat?.turn ?? 0)}:${String(actorId ?? "")}`;
}

export function pruneFearSnapPromptDedupe({ combatId = "" } = {}) {
  const cid = String(combatId ?? "");
  if (!cid) return;
  for (const key of _snapPromptTurnKeys) {
    if (key.startsWith(`${cid}:`)) _snapPromptTurnKeys.delete(key);
  }
}

export function markFearSnapPromptSeen(key) {
  _snapPromptTurnKeys.add(String(key ?? ""));
}

export function hasFearSnapPromptSeen(key) {
  return _snapPromptTurnKeys.has(String(key ?? ""));
}

export async function rollFearD100() {
  const roll = new Roll("1d100");
  await roll.evaluate();
  return roll;
}

export async function postFearMessage(actor, title, body) {
  const content = `<div class="uesrpg-chat-card" data-card="fear"><header class="card-header"><h3>${escapeFearHtml(title)}</h3></header><div class="card-content">${body}</div></div>`;
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

export async function createFearEffect(actor, {
  key,
  name,
  description = "",
  testPenalty = 0,
  blockActions = false,
  blockReactions = false,
  cannotApproach = false,
  snapOut = false,
  snapOutMod = 0,
  encounterScoped = true,
  applyAfterSnapPenalty = 0,
  extraFlags = {},
} = {}) {
  const fearKey = String(key ?? "generic").trim() || "generic";
  const group = `${FEAR_GROUP_PREFIX}${fearKey}`;
  const changes = [];
  const penalty = Number(testPenalty ?? 0) || 0;
  if (penalty) {
    changes.push({
      key: "system.modifiers.tests.all",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: penalty,
      priority: 20,
    });
  }

  await applyGroupedEffect(actor, {
    name,
    description: String(description ?? ""),
    img: "icons/magic/control/fear-fright-mask-yellow.webp",
    disabled: false,
    duration: {},
    changes,
    flags: {
      [SYSTEM_ID]: {
        owner: "system",
        source: "fear",
        effectGroup: group,
        stackRule: "override",
        [FEAR_FLAG]: {
          key: fearKey,
          blockActions: blockActions === true,
          blockReactions: blockReactions === true,
          cannotApproach: cannotApproach === true,
          snapOut: snapOut === true,
          snapOutMod: Number(snapOutMod ?? 0) || 0,
          encounterScoped: encounterScoped !== false,
          applyAfterSnapPenalty: Number(applyAfterSnapPenalty ?? 0) || 0,
          createdAt: Date.now(),
          ...extraFlags,
        }
      }
    }
  });
}

export async function createOneTurnFearEffect(actor, opts = {}) {
  const nextTurnExpiry = buildStartOfNextTurnExpiry(actor);
  const hasTurnExpiry = Object.keys(nextTurnExpiry).length > 0;
  const combat = game.combat ?? null;
  const fallbackFixedRound = !hasTurnExpiry && combat?.started ? { fixedRounds: 1 } : {};
  await createFearEffect(actor, {
    ...opts,
    extraFlags: {
      ...opts.extraFlags,
      ...nextTurnExpiry,
      ...fallbackFixedRound,
    }
  });
}

export async function spendFearStamina(actor, amount) {
  const cur = Number(actor?.system?.stamina?.value ?? 0) || 0;
  const next = Math.max(0, cur - Math.max(0, Number(amount ?? 0) || 0));
  await requestUpdateDocument(actor, { "system.stamina.value": next });
}

export async function expireStartOfTurnFearEffects(combat) {
  if (!combat?.started) return;
  const combatant = combat?.combatant ?? null;
  const actor = combatant?.actor ?? null;
  if (!actor) return;

  const combatId = String(combat.id ?? "");
  const combatantId = String(combatant.id ?? "");
  const round = Number(combat.round ?? 0);
  const turn = Number(combat.turn ?? 0);
  const toDelete = [];

  for (const effect of getFearEffects(actor)) {
    const lane = fearLane(effect);
    if (!lane || lane.expiresOnTurnStart !== true) continue;
    const laneCombatId = String(lane.expiresCombatId ?? "");
    if (laneCombatId && laneCombatId !== combatId) continue;
    const laneCombatantId = String(lane.expiresCombatantId ?? "");
    if (laneCombatantId && laneCombatantId !== combatantId) continue;
    const laneRound = Number(lane.expiresRound ?? NaN);
    const laneTurn = Number(lane.expiresTurn ?? NaN);
    if (Number.isFinite(laneRound) && laneRound !== round) continue;
    if (Number.isFinite(laneTurn) && laneTurn !== turn) continue;
    toDelete.push(effect.id);
  }

  if (toDelete.length) await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", toDelete);
}

export async function tickFixedRoundFearEffects(combat, changed = {}) {
  if (!combat?.started) return;
  if (!Object.prototype.hasOwnProperty.call(changed ?? {}, "round")) return;

  const round = Number(combat.round ?? 0) || 0;
  const tickKey = `${String(combat.id ?? "")}:${round}`;
  const combatants = Array.isArray(combat.combatants) ? combat.combatants : Array.from(combat.combatants ?? []);

  for (const combatant of combatants) {
    const actor = combatant?.actor ?? null;
    if (!actor) continue;
    const effectIdsToDelete = [];
    const effectUpdates = [];

    for (const effect of getFearEffects(actor)) {
      const lane = fearLane(effect);
      if (!lane || !Number.isFinite(Number(lane.fixedRounds))) continue;
      if (String(lane.fixedRoundsTickKey ?? "") === tickKey) continue;
      const remaining = Math.max(0, Number(lane.fixedRounds ?? 0) || 0);
      if (remaining <= 0) continue;
      const next = remaining - 1;
      if (next <= 0) {
        effectIdsToDelete.push(effect.id);
        continue;
      }
      effectUpdates.push({
        _id: effect.id,
        name: nameWithRounds(effect.name, next),
        [`flags.${SYSTEM_ID}.${FEAR_FLAG}.fixedRounds`]: next,
        [`flags.${SYSTEM_ID}.${FEAR_FLAG}.fixedRoundsTickKey`]: tickKey,
      });
    }

    if (effectIdsToDelete.length) await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", effectIdsToDelete);
    if (effectUpdates.length) await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", effectUpdates);
  }
}

export function getFearActionRestrictions(actor) {
  const restrictions = { blockActions: false, blockReactions: false, cannotApproach: false, testPenalty: 0, effects: [] };
  for (const effect of getFearEffects(actor)) {
    const fear = fearLane(effect);
    if (!fear) continue;
    if (fear.blockActions === true) restrictions.blockActions = true;
    if (fear.blockReactions === true) restrictions.blockReactions = true;
    if (fear.cannotApproach === true) restrictions.cannotApproach = true;
    const lanePenalty = (effect?.changes ?? [])
      .filter((change) => String(change?.key ?? "") === "system.modifiers.tests.all")
      .reduce((sum, change) => sum + (Number(change?.value ?? 0) || 0), 0);
    restrictions.testPenalty += lanePenalty;
    restrictions.effects.push({ id: effect.id, name: effect.name, fear });
  }
  return restrictions;
}

export async function applyEncounterPenaltyAfterSnapOut(actor, penalty) {
  const p = Number(penalty ?? 0) || 0;
  if (!p) return;
  await createFearEffect(actor, {
    key: "fear.lingering",
    name: "Fear: Lingering Stress",
    description: `Residual fear penalty applied after Snapping Out. Suffer a ${p} penalty to all Tests for the remainder of the encounter.`,
    testPenalty: p,
    snapOut: false,
    encounterScoped: true,
  });
}
