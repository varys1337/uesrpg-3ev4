import { renderTNSummary, bindTNEstimates } from "../../ui/shared/tn-presentation.js";
﻿/**
 * src/core/wounds/death-tests.js
 *
 * Chapter 5 unconscious death-test loop.
 */

import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { createSeverityDebugLogger } from "../../utils/debug.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";
import { createUuidResolver } from "../../utils/uuid-cache.js";
import { hasCondition } from "../conditions/engine/queries.js";
import { removeCondition } from "../conditions/engine/mutations.js";
import { isActiveGMUser } from "./wound-schema.js";
import { SYSTEM_ID } from "../constants.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { SKILL_DIFFICULTIES } from "../skills/skill-tn.js";
import { announceDeathTest, queueDeathPromptCard, updateDeathPromptMessage } from "./death-test-chat.js";
import { buildDifficultyOptionsHtml } from "./shared.js";
import { getStatusEffectConfigMap, getStatusEffectConfigs } from "../conditions/status-effects-registry.js";

import { isPerfEnabled, monoMs, perfRecord, perfTrackDocumentActivity } from "../../utils/perf-tracker.js";

const FLAG_KEY = "chapter5.deathState";

let _deathHooksRegistered = false;
const _inFlightResolve = new Set();
const _npcDeathSyncInFlight = new Map();
const _normalizedNpcDeadEffects = new Map();
const _debugWounds = createSeverityDebugLogger("woundsDebug", "[UESRPG][Death Tests]", "debug");

function _isNpcActor(actor) {
  return String(actor?.type ?? "").trim().toLowerCase() === "npc";
}

function _isPcActor(actor) {
  return String(actor?.type ?? "").trim().toLowerCase() === "player character";
}

function _readState(actor) {
  const raw = actor?.getFlag?.(SYSTEM_ID, FLAG_KEY);
  if (!raw || typeof raw !== "object") {
    return {
      unconsciousAtZeroHp: false,
      failureCount: 0,
      autoFailNextTest: false,
      isDead: false,
      testsRolled: 0,
      pendingPrompts: [],
      resolvedPromptIds: [],
    };
  }

  return {
    unconsciousAtZeroHp: raw.unconsciousAtZeroHp === true,
    failureCount: Number(raw.failureCount ?? 0) || 0,
    autoFailNextTest: raw.autoFailNextTest === true,
    isDead: raw.isDead === true,
      testsRolled: Math.max(0, Number(raw.testsRolled ?? 0) || 0),
      pendingPrompts: Array.isArray(raw.pendingPrompts) ? raw.pendingPrompts : [],
      resolvedPromptIds: Array.isArray(raw.resolvedPromptIds) ? raw.resolvedPromptIds : [],
      startedAt: raw.startedAt ?? null,
      updatedAt: raw.updatedAt ?? null,
      lastResult: raw.lastResult ?? null,
      lastPromptMeta: raw.lastPromptMeta ?? null,
    };
}

function _normalizePromptState(state) {
  state.pendingPrompts = (Array.isArray(state.pendingPrompts) ? state.pendingPrompts : [])
    .map((p) => ({
      messageId: String(p?.messageId ?? "").trim(),
      createdAt: Number(p?.createdAt ?? 0) || 0,
      resolved: p?.resolved === true,
      resolvedAt: Number(p?.resolvedAt ?? 0) || 0,
    }))
    .filter((p) => p.messageId.length > 0)
    .slice(-50);

  state.resolvedPromptIds = Array.from(new Set(
    (Array.isArray(state.resolvedPromptIds) ? state.resolvedPromptIds : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean)
  )).slice(-100);
}

function _isUnconsciousAtZero(actor) {
  const hp = Number(actor?.system?.hp?.value ?? 0) || 0;
  if (hp > 0) return false;
  return hasCondition(actor, "unconscious");
}

function _hasStabilizedMarker(actor) {
  const effects = actor?.effects?.contents ?? [];
  return effects.some((e) => {
    const w = e?.getFlag?.(SYSTEM_ID, "wounds");
    return String(w?.kind ?? "") === "firstAid";
  });
}

function _getLuckBonus(actor) {
  const rawBonus = actor?.system?.characteristics?.lck?.bonus;
  const fromBonus = Number(rawBonus);
  if (rawBonus !== undefined && rawBonus !== null && Number.isFinite(fromBonus)) return fromBonus;

  if (_isNpcActor(actor)) return 0;

  const total = Number(actor?.system?.characteristics?.lck?.total ?? 0) || 0;
  return Math.floor(total / 10);
}

function _getEnduranceTN(actor) {
  const tn = Number(actor?.system?.characteristics?.end?.total ?? 0);
  return Number.isFinite(tn) ? tn : 0;
}

async function _writeState(actor, state, { strict = false } = {}) {
  _normalizePromptState(state);
  const confirmed = await requestUpdateDocument(actor, {
    [`flags.${SYSTEM_ID}.${FLAG_KEY}`]: {
      unconsciousAtZeroHp: state.unconsciousAtZeroHp === true,
      failureCount: Math.max(0, Number(state.failureCount ?? 0) || 0),
      autoFailNextTest: state.autoFailNextTest === true,
      isDead: state.isDead === true,
      testsRolled: Math.max(0, Number(state.testsRolled ?? 0) || 0),
      pendingPrompts: state.pendingPrompts,
      resolvedPromptIds: state.resolvedPromptIds,
      startedAt: state.startedAt ?? Date.now(),
      updatedAt: Date.now(),
      lastResult: state.lastResult ?? null,
      lastPromptMeta: state.lastPromptMeta ?? null,
    }
  });
  if (strict && !confirmed) throw new Error("Death state was not confirmed.");
  return confirmed;
}

function _normalizeStatusId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function _resolveNpcDeadStatusDescriptor() {
  const effects = getStatusEffectConfigs();
  const byId = getStatusEffectConfigMap();

  const preferred = [];
  const preferredRaw = [];
  const pushPreferred = (id) => {
    const raw = String(id ?? "").trim();
    if (!raw) return;
    const normalized = _normalizeStatusId(raw);
    if (!normalized || preferred.includes(normalized)) return;
    preferred.push(normalized);
    preferredRaw.push(raw);
  };

  pushPreferred(CONFIG?.specialStatusEffects?.DEFEATED);
  pushPreferred(CONFIG?.specialStatusEffects?.defeated);
  pushPreferred(CONFIG?.specialStatusEffects?.dead);
  pushPreferred("defeated");
  pushPreferred("dead");

  let entry = null;
  for (const id of preferred) {
    const hit = byId.get(id);
    if (!hit) continue;
    entry = hit;
    break;
  }
  if (!entry) {
    entry = effects.find((e) => {
      const normalized = _normalizeStatusId(e?.id);
      return normalized === "defeated" || normalized === "dead";
    }) ?? null;
  }

  const id = String(entry?.id ?? preferredRaw[0] ?? preferred[0] ?? "defeated");
  const icon = String(entry?.img ?? entry?.icon ?? "");
  const aliasIds = Array.from(new Set([id, ...preferredRaw, ...preferred].filter(Boolean)));
  return { id, icon, entry, aliasIds };
}

function _collectActorTokenDocs(actor) {
  // The documented API returns only the exact token for a synthetic Actor.
  return actor?.getDependentTokens?.({ concreteOnly: true, linked: !actor.isToken }) ?? [];
}

async function _toggleNpcStatus(actor, statusId, options) {
  if (!isPerfEnabled()) return actor.toggleStatusEffect(statusId, options);
  const count = () => actor.effects?.filter(effect => effect.statuses?.has(statusId)).length ?? 0;
  const before = count();
  const startedAt = monoMs();
  let completed = false;
  try {
    const result = await actor.toggleStatusEffect(statusId, options);
    completed = true;
    return result;
  } finally {
    const after = count();
    const confirmed = completed && (options.active ? after > 0 : after === 0);
    const changed = Math.abs(after - before);
    perfRecord({ event: "status.npc.documentResult", actorUuid: actor.uuid, docUuid: actor.uuid,
      outcome: confirmed ? (changed ? "confirmed-change" : "confirmed-noop") : "rejected",
      writeAttemptCount: 1, confirmedChangeCount: changed, confirmedNoopCount: confirmed && !changed ? 1 : 0,
      durationMs: monoMs() - startedAt });
  }
}

async function _setNpcDeadOverlay(actor, active, { strict = false } = {}) {
  if (!actor || !_isNpcActor(actor)) return;
  const isActive = Boolean(active);
  const tokenUuids = new Set(_collectActorTokenDocs(actor).map(doc => doc.uuid));
  try {
    for (const combat of game?.combats?.contents ?? []) {
      for (const combatant of combat?.combatants?.contents ?? []) {
        const tokenMatch = tokenUuids.has(combatant.token?.uuid);
        const actorOnlyMatch = !actor.isToken && !combatant.tokenId && combatant.actor?.uuid === actor.uuid;
        if (!tokenMatch && !actorOnlyMatch) continue;
        if (Boolean(combatant.defeated) !== isActive) {
          const updated = await requestUpdateDocument(combatant, { defeated: isActive });
          if (strict && !updated) throw new Error("NPC defeated combatant state was not confirmed.");
        }
      }
    }
  } catch (err) {
    if (strict) throw err;
    console.warn("UESRPG | Failed to sync NPC defeated combatant state", err);
  }

  const deadStatus = _resolveNpcDeadStatusDescriptor();
  if (!deadStatus.entry) throw new Error("Configured NPC Dead/Defeated status is unavailable.");
  const key = actor.uuid ?? actor;
  const existing = actor.effects?.find(effect => effect.statuses?.has(deadStatus.id));
  if (!isActive) {
    if (existing) await _toggleNpcStatus(actor, deadStatus.id, { active: false });
    if (strict && actor.effects?.some(effect => effect.statuses?.has(deadStatus.id))) {
      throw new Error("NPC Dead status removal was not confirmed.");
    }
    _normalizedNpcDeadEffects.delete(key);
    return;
  }
  if (existing && !existing.disabled && _normalizedNpcDeadEffects.get(key) === existing.id) return;

  // v14 documents overlay as a creation option. An existing status returning
  // true is therefore explicitly reapplied once, without private flags or
  // legacy Token fields. The effect identity prevents duplicate normalization.
  if (existing) await _toggleNpcStatus(actor, deadStatus.id, { active: false });
  const created = await _toggleNpcStatus(actor, deadStatus.id, { active: true, overlay: true });
  if (!created || created === true) throw new Error("NPC Dead overlay was not created; status synchronization will retry on the next HP update.");
  _normalizedNpcDeadEffects.set(key, created.id);
}

async function _clearNpcUnconscious(actor, { strict = false } = {}) {
  if (!_isNpcActor(actor)) return;
  if (!hasCondition(actor, "unconscious")) return;
  try {
    await removeCondition(actor, "unconscious");
    if (strict && hasCondition(actor, "unconscious")) throw new Error("NPC unconscious status removal was not confirmed.");
  } catch (err) {
    if (strict) throw err;
    console.warn("UESRPG | Failed to clear NPC unconscious status at 0 HP", err);
  }
}

export async function syncNpcDeathState(actor, { strict = false, markDirty = false, context = "syncNpcDeathState" } = {}) {
  if (!_isNpcActor(actor)) return false;
  const key = actor.uuid;
  if (!key) return false;
  let entry = _npcDeathSyncInFlight.get(key);
  if (entry) {
    entry.actor = actor;
    if (markDirty) {
      entry.dirty = true;
      entry.triggers.add(context);
    }
  } else {
    entry = { actor, dirty: false, triggers: new Set([context]), promise: null };
    _npcDeathSyncInFlight.set(key, entry);
    entry.promise = Promise.resolve().then(async () => {
      do {
        entry.dirty = false;
        const actor = entry.actor;
        const triggers = Array.from(entry.triggers);
        entry.triggers.clear();
        const pass = entry.pass = (entry.pass ?? 0) + 1;
        const startedAt = isPerfEnabled() ? monoMs() : null;
        const finishActivity = perfTrackDocumentActivity(actor);
        let failed = true;
        try {
          // Every shared pass confirms its writes, including work started by hooks.
          const hp = Number(actor?.system?.hp?.value ?? 0) || 0;
          if (hp <= 0) await _clearNpcUnconscious(actor, { strict: true });
          await _setNpcDeadOverlay(actor, hp <= 0, { strict: true });
          if (hasDeathState(actor)) await clearDeathState(actor, { strict: true });
          failed = false;
        } finally {
          const activity = finishActivity();
          if (startedAt !== null) perfRecord({ event: "status.npc.reconcile.pass", actorUuid: actor.uuid,
            passCount: pass, trigger: triggers.join(","), failed, ...activity, durationMs: monoMs() - startedAt });
        }
      } while (entry.dirty);
      return true;
    }).finally(() => {
      if (_npcDeathSyncInFlight.get(key) === entry) _npcDeathSyncInFlight.delete(key);
    });
  }
  try { return await entry.promise; }
  catch (error) {
    if (strict) throw error;
    if (!entry.reported) {
      entry.reported = true;
      console.warn("UESRPG | NPC death-state reconciliation failed", { actorUuid: key, error });
    }
    return true; // Legacy callers still recognize this Actor as handled by the NPC path.
  }
}

/** Effect adapters mark active work dirty without starting a new status operation. */
export function noteNpcDeathStateEffectChange(actor, effect, { context = "effect-change", changed = null } = {}) {
  const entry = _npcDeathSyncInFlight.get(actor?.uuid);
  if (!entry) return;
  const descriptor = _resolveNpcDeadStatusDescriptor();
  const statuses = new Set([...descriptor.aliasIds, "unconscious"]);
  const statusMatch = Array.from(effect?.statuses ?? []).some(id => statuses.has(id));
  const statusChanges = changed && Object.keys(foundry.utils.flattenObject(changed))
    .some(key => key === "statuses" || key === "disabled" || key.startsWith("flags.core."));
  if (!statusMatch && !statusChanges) return;
  entry.actor = actor;
  entry.dirty = true;
  entry.triggers.add(context);
}

export function getDeathState(actor) {
  return _readState(actor);
}

export function hasDeathState(actor) {
  return actor?.getFlag?.(SYSTEM_ID, FLAG_KEY) != null;
}

export async function clearDeathState(actor, { keepDead = false, strict = false } = {}) {
  if (!actor) return;
  if (keepDead && _readState(actor).isDead) return;
  if (!hasDeathState(actor)) return;

  const updated = await requestUpdateDocument(actor, {
    [`flags.${SYSTEM_ID}.${FLAG_KEY}`]: null
  });
  if (strict && !updated) throw new Error("Death-state cleanup was not confirmed.");
}

export async function markUnconsciousAtZeroHp(actor, { source = "unknown", strict = false } = {}) {
  if (!actor) return false;
  if (!_isUnconsciousAtZero(actor)) return false;

  const state = _readState(actor);
  if (state.unconsciousAtZeroHp === true) return true;

  state.unconsciousAtZeroHp = true;
  state.startedAt = Date.now();
  state.lastResult = {
    source: String(source ?? "unknown"),
    kind: "start",
    at: Date.now()
  };

  await _writeState(actor, state, { strict });
  return true;
}

export async function markAutoFailNextDeathTest(actor, { source = "damage", strict = false } = {}) {
  if (!actor) return false;
  if (!_isUnconsciousAtZero(actor)) return false;

  const state = _readState(actor);
  state.unconsciousAtZeroHp = true;
  state.autoFailNextTest = true;
  state.lastResult = {
    source: String(source ?? "damage"),
    kind: "auto-fail-armed",
    at: Date.now()
  };

  await _writeState(actor, state, { strict });
  return true;
}

async function _promptDeathRollOptions(actor, baseTn) {
  const readDeclaration = (root) => {
    const difficultyKey = String(root?.querySelector('select[name="difficultyKey"]')?.value ?? "average");
    const manualMod = Number.parseInt(String(root?.querySelector('input[name="manualMod"]')?.value ?? "0"), 10) || 0;
    return { difficultyKey, manualMod };
  };
  const computeDeclaredTN = (declaration) => {
    const diff = SKILL_DIFFICULTIES.find((d) => d.key === String(declaration.difficultyKey ?? "average"))
      ?? SKILL_DIFFICULTIES.find((d) => d.key === "average");
    const target = Math.max(0, (Number(baseTn) || 0) + (Number(diff?.mod ?? 0) || 0) + (Number(declaration.manualMod ?? 0) || 0));
    return { finalTN: target, difficulty: diff, breakdown: [{ key: "base", label: "Endurance", value: Number(baseTn) || 0 }, { label: diff?.label, value: diff?.mod }, { label: "Manual Modifier", value: declaration.manualMod }] };
  };
  const content = `
    <div class="uesrpg-skill-roll">
      ${renderTNSummary("Death Test (END)")}
      <div class="form-group">
        <label><b>Characteristic</b></label>
        <input type="text" value="END (Endurance)" disabled style="width:100%;" />
      </div>
      <div class="form-group" style="margin-top:8px;">
        <label><b>Base TN (END)</b></label>
        <input type="number" value="${Number(baseTn) || 0}" disabled style="width:100%;" />
      </div>
      <div class="form-group" style="margin-top:8px;">
        <label><b>Difficulty</b></label>
        <select name="difficultyKey" style="width:100%;">${buildDifficultyOptionsHtml("average")}</select>
      </div>
      <div class="form-group" style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <label style="margin:0;"><b>Manual Modifier</b></label>
        <input name="manualMod" type="number" value="0" style="width:120px;" />
      </div>
    </div>
  `;

  const picked = await customDialog({
    layout: "workflow",
    title: `${foundry.utils.escapeHTML(String(actor?.name ?? "Actor"))} - Death Test (END)`,
    content,
    render: (_event, dialog) => bindTNEstimates(dialog.element, () => { const tn = computeDeclaredTN(readDeclaration(dialog.element)); return [{ key: "test", result: tn, label: tn.selected?.label ?? "Death Test (END)" }]; }),
    buttons: {
      roll: {
        label: "Roll",
        callback: (html) => readDeclaration(html instanceof HTMLElement ? html : html?.[0])
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    default: "roll",
    width: 420
  });

  if (!picked) return null;
  const { finalTN: target, difficulty: diff } = computeDeclaredTN(picked);
  return {
    target,
    difficulty: diff,
    manualMod: Number(picked.manualMod ?? 0) || 0,
  };
}

async function _finalizeDeath(actor, state, reason = "failure-threshold-exceeded", { strict = false } = {}) {
  state.isDead = true;
  state.lastResult = {
    kind: "death",
    at: Date.now(),
    reason: String(reason ?? "failure-threshold-exceeded"),
  };
  await _writeState(actor, state, { strict });
  ui.notifications?.warn?.(`${actor.name} dies.`);
}

export async function tickDeathTestsEndTurn(actor, { strict = false } = {}) {
  if (!actor) return null;
  if (await syncNpcDeathState(actor, { strict })) return null;

  const hp = Number(actor.system?.hp?.value ?? 0) || 0;

  if (hp > 0) {
    await clearDeathState(actor, { strict });
    return null;
  }

  if (_hasStabilizedMarker(actor)) {
    await clearDeathState(actor, { strict });
    return null;
  }

  if (!hasCondition(actor, "unconscious")) {
    await clearDeathState(actor, { strict });
    return null;
  }

  const state = _readState(actor);
  if (state.isDead === true) return state;

  state.unconsciousAtZeroHp = true;

  if (_isPcActor(actor)) {
    await queueDeathPromptCard(actor, state, {
      endTn: _getEnduranceTN(actor),
      luckBonus: _getLuckBonus(actor),
      strict,
    });
    state.lastResult = {
      kind: "death-test-prompted",
      at: Date.now(),
      queued: true,
    };
    await _writeState(actor, state, { strict });
    return state;
  }

  let success = false;
  let degree = 1;
  let autoFailed = false;

  if (state.autoFailNextTest === true) {
    autoFailed = true;
    success = false;
  } else {
    const tn = _getEnduranceTN(actor);
    if (tn <= 0) {
      success = false;
      degree = 1;
    } else {
      const res = await doTestRoll(actor, {
        target: tn,
        rollFormula: "1d100",
        allowLucky: true,
        allowUnlucky: true,
      });

      success = Boolean(res?.isSuccess);
      degree = Number(res?.degree ?? 1) || 1;

      try {
        await res?.roll?.toMessage?.({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor: `${actor.name} - Death Test (END ${tn})`,
          rollMode: getCoreRollMode(),
        });
      } catch (_e) {
        // Non-blocking.
      }
    }
  }

  const luckBonus = _getLuckBonus(actor);

  state.testsRolled = Math.max(0, Number(state.testsRolled ?? 0) || 0) + 1;
  if (!success) state.failureCount = Math.max(0, Number(state.failureCount ?? 0) || 0) + 1;
  state.autoFailNextTest = false;
  state.lastResult = {
    kind: "death-test",
    success,
    autoFailed,
    degree,
    at: Date.now(),
  };

  await _writeState(actor, state, { strict });
  await announceDeathTest(actor, {
    success,
    autoFailed,
    degree,
    failureCount: state.failureCount,
    luckBonus,
  });

  if (!success && state.failureCount > luckBonus) {
    await _finalizeDeath(actor, state, "failure-threshold-exceeded", { strict });
  }

  return state;
}

export async function resolveDeathTestFromChat({ actorUuid, messageId, action } = {}) {
  if (String(action ?? "") !== "roll") return null;
  if (!actorUuid || !messageId) return null;

  const resolver = createUuidResolver();
  const actor = await resolver.resolve(String(actorUuid));
  if (!actor) {
    ui.notifications?.warn?.("Death test: actor not found.");
    return null;
  }

  const lockKey = `${String(actor.uuid)}:${String(messageId)}`;
  if (_inFlightResolve.has(lockKey)) return null;
  _inFlightResolve.add(lockKey);

  try {
    if (!_isUnconsciousAtZero(actor) || _hasStabilizedMarker(actor)) {
      await clearDeathState(actor);
      return null;
    }

    const state = _readState(actor);
    if (state.isDead === true) {
      ui.notifications?.info?.(`${actor.name} is already dead.`);
      return state;
    }

    const msgId = String(messageId);
    if (state.resolvedPromptIds.includes(msgId)) {
      ui.notifications?.info?.("This death test prompt has already been resolved.");
      return state;
    }

    let success = false;
    let degree = 1;
    let autoFailed = false;

    if (state.autoFailNextTest === true) {
      autoFailed = true;
      success = false;
    } else {
      const baseTn = _getEnduranceTN(actor);
      if (baseTn <= 0) {
        success = false;
      } else {
        const options = await _promptDeathRollOptions(actor, baseTn);
        if (!options) return null;

        const res = await doTestRoll(actor, {
          target: options.target,
          rollFormula: "1d100",
          allowLucky: true,
          allowUnlucky: true,
        });

        success = Boolean(res?.isSuccess);
        degree = Number(res?.degree ?? 1) || 1;

        try {
          await res?.roll?.toMessage?.({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `${actor.name} - Death Test (END ${options.target})`,
            rollMode: getCoreRollMode(),
          });
        } catch (_e) {
          // Non-blocking.
        }
      }
    }

    const luckBonus = _getLuckBonus(actor);
    state.testsRolled = Math.max(0, Number(state.testsRolled ?? 0) || 0) + 1;
    if (!success) state.failureCount = Math.max(0, Number(state.failureCount ?? 0) || 0) + 1;
    state.autoFailNextTest = false;
    state.resolvedPromptIds.push(msgId);
    state.pendingPrompts = (Array.isArray(state.pendingPrompts) ? state.pendingPrompts : []).map((p) => {
      if (String(p?.messageId ?? "") !== msgId) return p;
      return { ...p, resolved: true, resolvedAt: Date.now() };
    });
    state.lastResult = {
      kind: "death-test",
      success,
      autoFailed,
      degree,
      at: Date.now(),
      promptMessageId: msgId,
    };

    await _writeState(actor, state);
    await updateDeathPromptMessage(msgId, actor, state, {
      endTn: _getEnduranceTN(actor),
      luckBonus,
    });

    if (!success && state.failureCount > luckBonus) {
      await _finalizeDeath(actor, state);
      await updateDeathPromptMessage(msgId, actor, state, {
        endTn: _getEnduranceTN(actor),
        luckBonus,
      });
    }

    _debugWounds("Prompt resolved", {
      actor: actor.uuid,
      messageId: msgId,
      success,
      failureCount: state.failureCount,
      testsRolled: state.testsRolled,
    });

    return state;
  } finally {
    _inFlightResolve.delete(lockKey);
  }
}

/** Owned damage notification body, also used by the compatibility adapter. */
export async function settleDamageDeathState(actor, data, { strict = false } = {}) {
  if (!actor || Number(data?.amountApplied ?? 0) <= 0) return;
  if (!isActiveGMUser(game.user)) {
    if (!strict) return;
    const { requestWoundsGM } = await import("./wound-socket.js");
    if (!await requestWoundsGM("damageApplied", { actorUuid: actor.uuid, data: { ...data, coreAftermathStage: "deathState", strictCompletion: true } })) throw new Error("Damage death-state authority did not settle.");
    return;
  }
  if (await syncNpcDeathState(actor, { strict })) return;
  if (_isUnconsciousAtZero(actor)) {
    await markUnconsciousAtZeroHp(actor, { source: "damage", strict });
    await markAutoFailNextDeathTest(actor, { source: "damage", strict });
  }
}

export function registerDeathTestHooks() {
  if (_deathHooksRegistered) return;
  _deathHooksRegistered = true;

  Hooks.on("uesrpgDamageApplied", (actor, data) => {
    if (data?.handledDomains?.includes("deathState")) return;
    void settleDamageDeathState(actor, data).catch(error => console.warn("UESRPG | Death test damage hook failed", error));
  });

  Hooks.on("updateActor", async (actor, changed) => {
    try {
      if (!isActiveGMUser(game.user)) return;
      if (!actor) return;

      const hpChanged = foundry.utils.hasProperty(changed ?? {}, "system.hp.value");
      if (!hpChanged) return;

      const hp = Number(actor.system?.hp?.value ?? 0) || 0;
      if (await syncNpcDeathState(actor, { markDirty: true, context: "updateActor:hp" })) return;

      if (hp > 0) {
        await clearDeathState(actor);
        return;
      }

      if (_isUnconsciousAtZero(actor)) {
        await markUnconsciousAtZeroHp(actor, { source: "hp-update" });
      }
    } catch (err) {
      console.warn("UESRPG | Death test updateActor hook failed", err);
    }
  });
}
