/**
 * src/core/wounds/death-tests.js
 *
 * Chapter 5 unconscious death-test loop.
 */

import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { createSeverityDebugLogger } from "../../utils/debug.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";
import { createUuidResolver } from "../../utils/uuid-cache.js";
import { hasCondition, removeCondition } from "../conditions/condition-engine.js";
import { isActiveGMUser } from "./wound-schema.js";
import { SYSTEM_ID } from "../constants.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { SKILL_DIFFICULTIES } from "../skills/skill-tn.js";
import { announceDeathTest, queueDeathPromptCard, updateDeathPromptMessage } from "./death-test-chat.js";
import { buildDifficultyOptionsHtml } from "./shared.js";

const FLAG_KEY = "chapter5.deathState";

let _deathHooksRegistered = false;
const _inFlightResolve = new Set();
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

async function _writeState(actor, state) {
  _normalizePromptState(state);
  await requestUpdateDocument(actor, {
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
}

function _normalizeStatusId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function _resolveNpcDeadStatusDescriptor() {
  const effects = Array.isArray(CONFIG?.statusEffects) ? CONFIG.statusEffects : [];
  const byId = new Map(
    effects
      .map((e) => [_normalizeStatusId(e?.id), e])
      .filter(([id]) => id.length > 0)
  );

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
  const tokens = actor?.getActiveTokens?.(true, true) ?? [];
  const docs = [];
  const directTokenDoc =
    actor?.token?.documentName === "TokenDocument"
      ? actor.token
      : (actor?.token?.document ?? null);
  if (directTokenDoc) docs.push(directTokenDoc);
  for (const tokenLike of tokens) {
    const doc = tokenLike?.documentName === "TokenDocument" ? tokenLike : (tokenLike?.document ?? null);
    if (doc) docs.push(doc);
  }
  return Array.from(new Set(docs));
}

async function _setNpcDeadOverlay(actor, active) {
  if (!actor || !_isNpcActor(actor)) return;
  const isActive = Boolean(active);
  const tokenDocs = _collectActorTokenDocs(actor);
  const actorId = String(actor?.id ?? "");
  const tokenIdSet = new Set(
    tokenDocs
      .map((doc) => String(doc?.id ?? doc?._id ?? "").trim())
      .filter(Boolean)
  );

  try {
    const combats = Array.from(game?.combats?.contents ?? []);
    for (const combat of combats) {
      for (const combatant of (combat?.combatants?.contents ?? [])) {
        const combatantActorId = String(combatant?.actor?.id ?? combatant?.actorId ?? "").trim();
        const combatantTokenId = String(combatant?.tokenId ?? combatant?.token?.id ?? "").trim();
        const actorMatch = Boolean(actorId) && combatantActorId === actorId;
        const tokenMatch = Boolean(combatantTokenId) && tokenIdSet.has(combatantTokenId);
        if (!actorMatch && !tokenMatch) continue;
        if (Boolean(combatant.defeated) === isActive) continue;
        await requestUpdateDocument(combatant, { defeated: isActive });
      }
    }
  } catch (err) {
    console.warn("UESRPG | Failed to sync NPC defeated combatant state", err);
  }

  const deadStatus = _resolveNpcDeadStatusDescriptor();

  for (const tokenDoc of tokenDocs) {
    let applied = false;
    try {
      if (typeof tokenDoc?.toggleActiveEffect === "function") {
        for (const statusId of deadStatus.aliasIds) {
          try {
            await tokenDoc.toggleActiveEffect(statusId, { active: isActive, overlay: true });
            applied = true;
            break;
          } catch (_err) {
            // Keep trying aliases.
          }
        }
      }
    } catch (_err) {
      // Fall through to canvas token object toggle.
    }
    if (applied) continue;

    try {
      const tokenObj = tokenDoc?.object ?? null;
      if (tokenObj?.toggleEffect) {
        await tokenObj.toggleEffect(deadStatus.entry ?? deadStatus.id, { active: isActive, overlay: true });
        continue;
      }
    } catch (_err) {
      // Fall through to document overlayEffect update.
    }

    if (!deadStatus.icon) continue;
    const current = String(tokenDoc?.overlayEffect ?? "");
    if (isActive && current !== deadStatus.icon) {
      await requestUpdateDocument(tokenDoc, { overlayEffect: deadStatus.icon });
    } else if (!isActive && current === deadStatus.icon) {
      await requestUpdateDocument(tokenDoc, { overlayEffect: null });
    }
  }
}

async function _clearNpcUnconscious(actor) {
  if (!_isNpcActor(actor)) return;
  if (!hasCondition(actor, "unconscious")) return;
  try {
    await removeCondition(actor, "unconscious");
  } catch (err) {
    console.warn("UESRPG | Failed to clear NPC unconscious status at 0 HP", err);
  }
}

export async function syncNpcDeathState(actor) {
  if (!_isNpcActor(actor)) return false;
  const hp = Number(actor?.system?.hp?.value ?? 0) || 0;
  if (hp <= 0) await _clearNpcUnconscious(actor);
  await _setNpcDeadOverlay(actor, hp <= 0);
  await clearDeathState(actor);
  return true;
}

export function getDeathState(actor) {
  return _readState(actor);
}

export async function clearDeathState(actor, { keepDead = false } = {}) {
  if (!actor) return;
  if (keepDead && _readState(actor).isDead) return;

  await requestUpdateDocument(actor, {
    [`flags.${SYSTEM_ID}.${FLAG_KEY}`]: null
  });
}

export async function markUnconsciousAtZeroHp(actor, { source = "unknown" } = {}) {
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

  await _writeState(actor, state);
  return true;
}

export async function markAutoFailNextDeathTest(actor, { source = "damage" } = {}) {
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

  await _writeState(actor, state);
  return true;
}

async function _promptDeathRollOptions(actor, baseTn) {
  const content = `
    <div class="uesrpg-skill-roll">
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
    title: `${foundry.utils.escapeHTML(String(actor?.name ?? "Actor"))} - Death Test (END)`,
    content,
    buttons: {
      roll: {
        label: "Roll",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const difficultyKey = String(root?.querySelector('select[name="difficultyKey"]')?.value ?? "average");
          const manualMod = Number.parseInt(String(root?.querySelector('input[name="manualMod"]')?.value ?? "0"), 10) || 0;
          return { difficultyKey, manualMod };
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    default: "roll",
    width: 420
  });

  if (!picked) return null;
  const diff = SKILL_DIFFICULTIES.find((d) => d.key === String(picked.difficultyKey ?? "average"))
    ?? SKILL_DIFFICULTIES.find((d) => d.key === "average");
  const target = Math.max(0, (Number(baseTn) || 0) + (Number(diff?.mod ?? 0) || 0) + (Number(picked.manualMod ?? 0) || 0));
  return {
    target,
    difficulty: diff,
    manualMod: Number(picked.manualMod ?? 0) || 0,
  };
}

async function _finalizeDeath(actor, state, reason = "failure-threshold-exceeded") {
  state.isDead = true;
  state.lastResult = {
    kind: "death",
    at: Date.now(),
    reason: String(reason ?? "failure-threshold-exceeded"),
  };
  await _writeState(actor, state);
  ui.notifications?.warn?.(`${actor.name} dies.`);
}

export async function tickDeathTestsEndTurn(actor) {
  if (!actor) return null;
  if (await syncNpcDeathState(actor)) return null;

  const hp = Number(actor.system?.hp?.value ?? 0) || 0;

  if (hp > 0) {
    await clearDeathState(actor);
    return null;
  }

  if (_hasStabilizedMarker(actor)) {
    await clearDeathState(actor);
    return null;
  }

  if (!hasCondition(actor, "unconscious")) {
    await clearDeathState(actor);
    return null;
  }

  const state = _readState(actor);
  if (state.isDead === true) return state;

  state.unconsciousAtZeroHp = true;

  if (_isPcActor(actor)) {
    await queueDeathPromptCard(actor, state, {
      endTn: _getEnduranceTN(actor),
      luckBonus: _getLuckBonus(actor),
    });
    state.lastResult = {
      kind: "death-test-prompted",
      at: Date.now(),
      queued: true,
    };
    await _writeState(actor, state);
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

  await _writeState(actor, state);
  await announceDeathTest(actor, {
    success,
    autoFailed,
    degree,
    failureCount: state.failureCount,
    luckBonus,
  });

  if (!success && state.failureCount > luckBonus) {
    await _finalizeDeath(actor, state);
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

export function registerDeathTestHooks() {
  if (_deathHooksRegistered) return;
  _deathHooksRegistered = true;

  Hooks.on("uesrpgDamageApplied", async (actor, data) => {
    try {
      if (!isActiveGMUser(game.user)) return;
      if (!actor) return;

      const applied = Number(data?.amountApplied ?? 0) || 0;
      if (applied <= 0) return;

      if (await syncNpcDeathState(actor)) return;

      if (_isUnconsciousAtZero(actor)) {
        await markUnconsciousAtZeroHp(actor, { source: "damage" });
        await markAutoFailNextDeathTest(actor, { source: "damage" });
      }
    } catch (err) {
      console.warn("UESRPG | Death test damage hook failed", err);
    }
  });

  Hooks.on("updateActor", async (actor, changed) => {
    try {
      if (!isActiveGMUser(game.user)) return;
      if (!actor) return;

      const hpChanged = foundry.utils.hasProperty(changed ?? {}, "system.hp.value");
      if (!hpChanged) return;

      const hp = Number(actor.system?.hp?.value ?? 0) || 0;
      if (await syncNpcDeathState(actor)) return;

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
