/**
 * src/core/fear/index.js
 *
 * Chapter 5 fear workflow.
 */

import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { isActiveGMUser } from "../wounds/wound-schema.js";

const SYSTEM_ID = "uesrpg-3ev4";
const FEAR_FLAG = "fear";
const SNAP_PROMPT_FLAG = "chapter5.fearSnapPrompt";
const FEAR_GROUP_PREFIX = "fear.";

let _fearRegistered = false;

function _effects(actor) {
  return actor?.effects?.contents ?? [];
}

function _isFearEffect(effect) {
  const lane = effect?.getFlag?.(SYSTEM_ID, FEAR_FLAG);
  return lane && typeof lane === "object";
}

function _getFearEffects(actor) {
  return _effects(actor).filter((e) => _isFearEffect(e) && !e.disabled);
}

function _fearLane(effect) {
  return effect?.getFlag?.(SYSTEM_ID, FEAR_FLAG) ?? null;
}

function _escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function _wpTN(actor, modifier = 0) {
  const wp = Number(actor?.system?.characteristics?.wp?.total ?? 0) || 0;
  const fearBonus = Number(actor?.system?.modifiers?.tests?.fear ?? 0) || 0;
  return wp + Number(modifier || 0) + fearBonus;
}

function _isFearImmune(actor, type) {
  const t = String(type ?? "panic").toLowerCase();
  const lane = actor?.system?.traits?.immunity ?? {};
  if (lane?.fear === true) return true;
  if (lane?.horror === true && t === "horror") return true;
  if (lane?.panic === true && t === "panic") return true;
  if (actor?.system?.traits?.condition?.frenzied === true) return true;
  return false;
}



function _buildStartOfNextTurnExpiry(actor) {
  const combat = game.combat ?? null;
  const combatant = combat?.combatants?.find?.((c) => c?.actor?.id === actor?.id) ?? null;
  if (!(combat && combat.started && combatant)) return {};

  const turns = Array.isArray(combat.turns) ? combat.turns : [];
  const idx = turns.findIndex((t) => String(t?.id ?? '') === String(combatant.id ?? ''));
  const currentTurn = Number(combat.turn ?? 0);
  const currentRound = Number(combat.round ?? 0);

  const expiresTurn = idx >= 0 ? idx : currentTurn;
  const expiresRound = (idx >= 0 && Number.isFinite(currentTurn) && Number.isFinite(currentRound) && idx <= currentTurn)
    ? (currentRound + 1)
    : currentRound;

  return {
    expiresOnTurnStart: true,
    expiresCombatId: String(combat.id ?? ''),
    expiresRound,
    expiresTurn,
    expiresCombatantId: String(combatant.id ?? '')
  };
}

function _nameWithRounds(baseName, rounds) {
  const name = String(baseName ?? "").trim() || "Fear Effect";
  const n = Math.max(0, Number(rounds ?? 0) || 0);
  if (!n) return name.replace(/\s*\(\d+\s+rounds?\)\s*$/i, "");
  if (/\(\d+\s+rounds?\)\s*$/i.test(name)) {
    return name.replace(/\(\d+\s+rounds?\)\s*$/i, `(${n} rounds)`);
  }
  return `${name} (${n} rounds)`;
}

async function _expireStartOfTurnFearEffects(combat) {
  if (!combat?.started) return;
  const combatant = combat?.combatant ?? null;
  const actor = combatant?.actor ?? null;
  if (!actor) return;

  const combatId = String(combat.id ?? "");
  const combatantId = String(combatant.id ?? "");
  const round = Number(combat.round ?? 0);
  const turn = Number(combat.turn ?? 0);

  const toDelete = [];
  for (const ef of _getFearEffects(actor)) {
    const lane = _fearLane(ef);
    if (!lane || lane.expiresOnTurnStart !== true) continue;

    const laneCombatId = String(lane.expiresCombatId ?? "");
    if (laneCombatId && laneCombatId !== combatId) continue;
    const laneCombatantId = String(lane.expiresCombatantId ?? "");
    if (laneCombatantId && laneCombatantId !== combatantId) continue;

    const laneRound = Number(lane.expiresRound ?? NaN);
    const laneTurn = Number(lane.expiresTurn ?? NaN);
    if (Number.isFinite(laneRound) && laneRound !== round) continue;
    if (Number.isFinite(laneTurn) && laneTurn !== turn) continue;

    toDelete.push(ef.id);
  }

  if (toDelete.length) {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", toDelete);
  }
}

async function _tickFixedRoundFearEffects(combat, changed = {}) {
  if (!combat?.started) return;
  const roundChanged = Object.prototype.hasOwnProperty.call(changed ?? {}, "round");
  if (!roundChanged) return;

  const round = Number(combat.round ?? 0) || 0;
  const tickKey = `${String(combat.id ?? "")}:${round}`;
  const combatants = Array.isArray(combat.combatants) ? combat.combatants : Array.from(combat.combatants ?? []);

  for (const c of combatants) {
    const actor = c?.actor ?? null;
    if (!actor) continue;

    for (const ef of _getFearEffects(actor)) {
      const lane = _fearLane(ef);
      if (!lane || !Number.isFinite(Number(lane.fixedRounds))) continue;

      const prevTickKey = String(lane.fixedRoundsTickKey ?? "");
      if (prevTickKey === tickKey) continue;

      const remaining = Math.max(0, Number(lane.fixedRounds ?? 0) || 0);
      if (remaining <= 0) continue;

      const next = remaining - 1;
      if (next <= 0) {
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [ef.id]);
        continue;
      }

      await requestUpdateDocument(ef, {
        name: _nameWithRounds(ef.name, next),
        [`flags.${SYSTEM_ID}.${FEAR_FLAG}.fixedRounds`]: next,
        [`flags.${SYSTEM_ID}.${FEAR_FLAG}.fixedRoundsTickKey`]: tickKey
      });
    }
  }
}

async function _rollD100() {
  const roll = new Roll("1d100");
  await roll.evaluate();
  return roll;
}

async function _postFearMessage(actor, title, body) {
  const content = `
    <div class="uesrpg-chat-card" data-card="fear">
      <header class="card-header"><h3>${_escapeHtml(title)}</h3></header>
      <div class="card-content">${body}</div>
    </div>
  `;

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

async function _dedupeFearGroup(actor, group) {
  const g = String(group ?? "").trim();
  if (!actor || !g) return;
  const effects = _getFearEffects(actor)
    .filter((e) => String(e?.flags?.[SYSTEM_ID]?.effectGroup ?? "") === g);

  if (effects.length <= 1) return;
  const keep = effects[effects.length - 1];
  const toDelete = effects.filter((e) => e.id !== keep.id).map((e) => e.id);
  if (!toDelete.length) return;
  await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", toDelete);
}

async function _createFearEffect(actor, {
  key,
  name,
  testPenalty = 0,
  blockActions = false,
  blockReactions = false,
  cannotApproach = false,
  snapOut = false,
  snapOutMod = 0,
  encounterScoped = true,
  applyAfterSnapPenalty = 0,
  extraFlags = {}
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
      priority: 20
    });
  }

  const effectData = {
    name,
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
          ...extraFlags
        }
      }
    }
  };

  await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [effectData]);
  await _dedupeFearGroup(actor, group);
}

async function _createOneTurnFearEffect(actor, opts = {}) {
  await _createFearEffect(actor, {
    ...opts,
    extraFlags: {
      ...opts.extraFlags,
      ..._buildStartOfNextTurnExpiry(actor)
    }
  });
}

async function _removeFearEffects(actor, predicate = null) {
  const effects = _getFearEffects(actor).filter((e) => (typeof predicate === "function" ? predicate(e) : true));
  if (!effects.length) return;
  await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", effects.map((e) => e.id));
}

async function _spendStamina(actor, amount) {
  const cur = Number(actor?.system?.stamina?.value ?? 0) || 0;
  const next = Math.max(0, cur - Math.max(0, Number(amount ?? 0) || 0));
  await requestUpdateDocument(actor, { "system.stamina.value": next });
}

async function _panicOutcome(actor, rollTotal) {
  const d100 = Number(rollTotal ?? 1) || 1;

  if (d100 <= 30) {
    await _createOneTurnFearEffect(actor, {
      key: "panic.startled",
      name: "Fear: Startled",
      blockReactions: true,
      snapOut: false
    });
    return { key: "startled", text: "Startled: cannot take reactions until your next Turn begins." };
  }

  if (d100 <= 60) {
    await _createFearEffect(actor, {
      key: "panic.spooked",
      name: "Fear: Spooked",
      testPenalty: -10,
      snapOut: true,
      snapOutMod: 0
    });
    return { key: "spooked", text: "Spooked: -10 to all tests until you snap out of it." };
  }

  if (d100 <= 90) {
    await _createFearEffect(actor, {
      key: "panic.frightened",
      name: "Fear: Frightened",
      testPenalty: -10,
      cannotApproach: true,
      snapOut: true,
      snapOutMod: 0
    });
    return { key: "frightened", text: "Frightened: -10 to all tests and cannot willingly approach the fear source until you snap out." };
  }

  if (d100 <= 95) {
    await _createFearEffect(actor, {
      key: "panic.lostComposure",
      name: "Fear: Lost Composure",
      blockActions: true,
      snapOut: true,
      snapOutMod: 0,
      applyAfterSnapPenalty: -10
    });
    return { key: "lost-composure", text: "Lost Composure: cannot take actions until you snap out; then suffer -10 for the encounter." };
  }

  await _createFearEffect(actor, {
    key: "panic.running",
    name: "Fear: Running and Screaming",
    testPenalty: -20,
    blockActions: true,
    cannotApproach: true,
    snapOut: true,
    snapOutMod: 0
  });
  return { key: "running", text: "Running and Screaming: flee from the fear source; -20 to tests until you snap out." };
}

async function _horrorOutcome(actor, rollTotal) {
  const d100 = Number(rollTotal ?? 1) || 1;

  if (d100 <= 40) {
    await _createOneTurnFearEffect(actor, {
      key: "horror.blackout.short",
      name: "Horror: Momentary Blackout",
      blockActions: true,
      applyAfterSnapPenalty: -10
    });
    return { key: "momentary-blackout", text: "Momentary Blackout: lose your next round of actions; then suffer -10 for the encounter." };
  }

  if (d100 <= 60) {
    await _createOneTurnFearEffect(actor, {
      key: "horror.vomiting",
      name: "Horror: Uncontrollable Vomiting",
      blockActions: true
    });
    await _spendStamina(actor, 1);
    return { key: "vomiting", text: "Uncontrollable Vomiting: helpless for 1 round and lose 1 Stamina." };
  }

  if (d100 <= 80) {
    await _createFearEffect(actor, {
      key: "horror.manicTerror",
      name: "Horror: Manic Terror",
      snapOut: true,
      snapOutMod: 0
    });
    return { key: "manic-terror", text: "Manic Terror: lose control; attempt to snap out at the start of each of your turns." };
  }

  if (d100 <= 90) {
    const roundsRoll = await _rollD100();
    const rounds = Math.max(1, Math.ceil(Number(roundsRoll.total ?? 1) / 20));
    await _createFearEffect(actor, {
      key: "horror.despair",
      name: `Horror: Hopeless (${rounds} rounds)`,
      blockActions: true,
      encounterScoped: false,
      extraFlags: { fixedRounds: rounds }
    });
    const staminaLoss = new Roll("1d4");
    await staminaLoss.evaluate();
    await _spendStamina(actor, Number(staminaLoss.total ?? 1) || 1);
    return { key: "despair", text: `Hopeless and Despairing: incapacitated for ${rounds} rounds; lose ${staminaLoss.total} Stamina.` };
  }

  if (d100 <= 95) {
    await _createFearEffect(actor, {
      key: "horror.blackout.long",
      name: "Horror: Blackout",
      blockActions: true,
      snapOut: false,
      encounterScoped: false,
      extraFlags: { longBlackout: true }
    });
    return { key: "blackout", text: "Blackout: catatonic state (GM adjudicates duration)." };
  }

  if (d100 <= 99) {
    await _createFearEffect(actor, {
      key: "horror.mindBreak",
      name: "Horror: Mind Break",
      blockActions: true,
      cannotApproach: true,
      snapOut: true,
      snapOutMod: 0
    });
    return { key: "mind-break", text: "Mind Break: severe psychological collapse; cannot attack/approach source until snapping out." };
  }

  const endTN = Number(actor?.system?.characteristics?.end?.total ?? 0) || 0;
  const endRes = await doTestRoll(actor, {
    target: endTN,
    rollFormula: "1d100",
    allowLucky: true,
    allowUnlucky: true
  });

  try {
    await endRes?.roll?.toMessage?.({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} — Scared to Death (END ${endTN})`,
      rollMode: game.settings.get("core", "rollMode")
    });
  } catch (_e) {
    // Non-blocking
  }

  if (!endRes?.isSuccess) {
    await requestUpdateDocument(actor, {
      "flags.uesrpg-3ev4.chapter5.deathState": {
        unconsciousAtZeroHp: true,
        failureCount: 999,
        autoFailNextTest: false,
        isDead: true,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        lastResult: { kind: "fear-death", at: Date.now() }
      }
    });
    return { key: "scared-to-death", text: "Scared to Death: failed Endurance test and dies immediately." };
  }

  await _createFearEffect(actor, {
    key: "horror.blackout.long",
    name: "Horror: Blackout",
    blockActions: true,
    encounterScoped: false,
    extraFlags: { longBlackout: true }
  });
  return { key: "scared-to-death-survived", text: "Scared to Death: survived Endurance test; collapses catatonic." };
}

export function getFearActionRestrictions(actor) {
  const restrictions = {
    blockActions: false,
    blockReactions: false,
    cannotApproach: false,
    testPenalty: 0,
    effects: []
  };

  for (const ef of _getFearEffects(actor)) {
    const fear = _fearLane(ef);
    if (!fear) continue;
    if (fear.blockActions === true) restrictions.blockActions = true;
    if (fear.blockReactions === true) restrictions.blockReactions = true;
    if (fear.cannotApproach === true) restrictions.cannotApproach = true;

    const lanePenalty = (ef?.changes ?? [])
      .filter((c) => String(c?.key ?? "") === "system.modifiers.tests.all")
      .reduce((sum, c) => sum + (Number(c?.value ?? 0) || 0), 0);

    restrictions.testPenalty += lanePenalty;
    restrictions.effects.push({ id: ef.id, name: ef.name, fear });
  }

  return restrictions;
}

async function _applyEncounterPenaltyAfterSnapOut(actor, penalty) {
  const p = Number(penalty ?? 0) || 0;
  if (!p) return;

  await _createFearEffect(actor, {
    key: "fear.lingering",
    name: "Fear: Lingering Stress",
    testPenalty: p,
    snapOut: false,
    encounterScoped: true
  });
}

export async function attemptSnapOut(actor, { combat = game.combat } = {}) {
  if (!actor || !combat?.id) return { attempted: false, success: false };

  const effects = _getFearEffects(actor).filter((e) => _fearLane(e)?.snapOut === true);
  if (!effects.length) return { attempted: false, success: false };

  const tn = _wpTN(actor, 0);
  const res = await doTestRoll(actor, {
    target: tn,
    rollFormula: "1d100",
    allowLucky: true,
    allowUnlucky: true
  });

  try {
    await res?.roll?.toMessage?.({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} — Snap Out (Willpower ${tn})`,
      rollMode: game.settings.get("core", "rollMode")
    });
  } catch (_e) {
    // Non-blocking
  }

  if (!res?.isSuccess) {
    await _postFearMessage(actor, "Fear", `<p><b>${_escapeHtml(actor.name)}</b> fails to snap out of fear.</p>`);
    return { attempted: true, success: false };
  }

  const penalties = effects.map((e) => Number(_fearLane(e)?.applyAfterSnapPenalty ?? 0) || 0);
  const lingeringPenalty = Math.min(0, ...penalties, 0);

  await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", effects.map((e) => e.id));
  await _applyEncounterPenaltyAfterSnapOut(actor, lingeringPenalty);

  await _postFearMessage(actor, "Fear", `<p><b>${_escapeHtml(actor.name)}</b> snaps out of fear.</p>`);
  return { attempted: true, success: true };
}

function _combatTurnPromptKey(combat) {
  const cid = String(combat?.id ?? "");
  const round = Number(combat?.round ?? 0);
  const turn = Number(combat?.turn ?? 0);
  return `${cid}:${round}:${turn}`;
}

async function _maybePromptSnapOutOnTurnStart(combat) {
  if (!combat?.started) return;

  const combatant = combat?.combatant ?? null;
  const actor = combatant?.actor ?? null;
  if (!actor) return;

  const hasSnapOut = _getFearEffects(actor).some((e) => _fearLane(e)?.snapOut === true);
  if (!hasSnapOut) return;

  const key = _combatTurnPromptKey(combat);
  const prev = String(actor.getFlag(SYSTEM_ID, SNAP_PROMPT_FLAG) ?? "");
  if (prev === key) return;

  await requestUpdateDocument(actor, {
    [`flags.${SYSTEM_ID}.${SNAP_PROMPT_FLAG}`]: key
  });

  await attemptSnapOut(actor, { combat });
}

export async function promptFearTest({ actor, type = "panic", modifier = 0, source = "Fear", inCombat = null } = {}) {
  if (!actor) return { ok: false, reason: "no-actor" };

  const fearType = String(type ?? "panic").toLowerCase() === "horror" ? "horror" : "panic";
  const combatActive = inCombat ?? Boolean(game.combat?.started);

  if (_isFearImmune(actor, fearType)) {
    await _postFearMessage(actor, "Fear", `<p><b>${_escapeHtml(actor.name)}</b> is immune to ${fearType} effects.</p>`);
    return { ok: true, immune: true };
  }

  const tn = _wpTN(actor, modifier);
  const test = await doTestRoll(actor, {
    target: tn,
    rollFormula: "1d100",
    allowLucky: true,
    allowUnlucky: true
  });

  try {
    await test?.roll?.toMessage?.({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} — ${fearType === "panic" ? "Panic" : "Horror"} Test (WP ${tn})`,
      rollMode: game.settings.get("core", "rollMode")
    });
  } catch (_e) {
    // Non-blocking
  }

  if (test?.isSuccess) {
    await _postFearMessage(actor, "Fear", `<p><b>${_escapeHtml(actor.name)}</b> withstands the fear source (${_escapeHtml(source)}).</p>`);
    return { ok: true, success: true, type: fearType, source };
  }

  if (!combatActive) {
    await _createFearEffect(actor, {
      key: "fear.nonCombat",
      name: "Fear: Unnerved",
      testPenalty: -20,
      snapOut: false,
      encounterScoped: false,
      extraFlags: { source, type: fearType }
    });

    await _postFearMessage(actor, "Fear", `<p><b>${_escapeHtml(actor.name)}</b> is unnerved and suffers -20 to concentration tests near the fear source.</p>`);
    return { ok: true, success: false, type: fearType, source, inCombat: false };
  }

  const d100 = await _rollD100();
  let outcome = null;
  if (fearType === "panic") outcome = await _panicOutcome(actor, d100.total);
  else outcome = await _horrorOutcome(actor, d100.total);

  await _postFearMessage(
    actor,
    fearType === "panic" ? "Panic Result" : "Horror Result",
    `<p><b>Roll:</b> ${Number(d100.total ?? 0)}</p><p>${_escapeHtml(outcome?.text ?? "No effect")}</p>`
  );

  return {
    ok: true,
    success: false,
    type: fearType,
    source,
    inCombat: true,
    tableRoll: Number(d100.total ?? 0) || 0,
    outcome: outcome?.key ?? null
  };
}

export function registerFearSystem() {
  if (_fearRegistered) return;
  _fearRegistered = true;

  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
    try {
      if (!isActiveGMUser(game.user)) return;
      if (payload?.source !== "combat") return;
      if (payload?.combat?.phase && payload.combat.phase !== "post") return;

      const combat = game.combat ?? null;
      if (!combat?.id) return;
      if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;

      const changed = payload?.changed ?? {};
      const changedTurn = Object.prototype.hasOwnProperty.call(changed, "turn") || Object.prototype.hasOwnProperty.call(changed, "round");
      if (!changedTurn) return;

      await _expireStartOfTurnFearEffects(combat);
      await _tickFixedRoundFearEffects(combat, changed);
      await _maybePromptSnapOutOnTurnStart(combat);
    } catch (err) {
      console.warn("UESRPG | Fear turn hook failed", err);
    }
  });

  Hooks.on("deleteCombat", async (combat) => {
    try {
      if (!isActiveGMUser(game.user)) return;
      const combatants = Array.isArray(combat?.combatants)
        ? combat.combatants
        : Array.from(combat?.combatants ?? []);

      for (const c of combatants) {
        const actor = c?.actor ?? null;
        if (!actor) continue;
        const scoped = _getFearEffects(actor).filter((e) => _fearLane(e)?.encounterScoped !== false);
        if (!scoped.length) continue;
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", scoped.map((e) => e.id));
      }
    } catch (err) {
      console.warn("UESRPG | Fear cleanup hook failed", err);
    }
  });

  game.uesrpg = game.uesrpg || {};
  game.uesrpg.fear = {
    promptFearTest,
    attemptSnapOut,
    getFearActionRestrictions
  };
}

export const FearAPI = {
  promptFearTest,
  attemptSnapOut,
  getFearActionRestrictions
};
