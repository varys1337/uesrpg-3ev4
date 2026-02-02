/**
 * src/core/magic/upkeep-workflow.js
 *
 * Spell upkeep system for UESRPG 3ev4.
 *
 * RAW intent (Chapter 6):
 * - The caster can, as a a Free Action, refresh the effect and duration of a spell with the Upkeep
 *   attribute when it ends by paying the original cost they paid for the spell.
 * - Upkeep must use the original target(s) and requires that spell requirements (e.g., range) are still met.
 * - If a spell has no listed duration, treat it as having a 1 round duration for the purposes of upkeep.
 * - Spells with no listed duration cannot be upkept if the caster has cast a different spell since the
 *   original cast of the upkept spell.
 *
 * Implementation notes:
 * - We treat Upkeep as an effect-refresh (duration reset + cost spend). We do not perform the original
 *   casting test again.
 * - Upkeep prompts are grouped by spell instance: {casterUuid, spellUuid, originalCastWorldTime}.
 *   This prevents duplicate prompts when the same spell instance applied multiple effects/targets.
 * - Prompt de-duplication is tracked on the spell-created ActiveEffect(s) themselves via flags, not on the caster,
 *   so that unlinked token actors do not cause repeated prompt spam.
 */

import { getSpellMaxRangeMeters, getSpellRangeType } from "./spell-range.js";
import { requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { MagicTimekeeping } from "./timekeeping-helper.js";
import { classifySpellForRouting } from "./spell-routing.js";
import { AttackTracker } from "../combat/attack-tracker.js";

const _FLAG_NS = "uesrpg-3ev4";
const _promptLocks = new Set();
const _recentPromptCache = new Map();
let _realtimeScanInFlight = false;

function _roundTimeSeconds() {
  return MagicTimekeeping.roundTimeSeconds();
}

function _currentRound() {
  return MagicTimekeeping.combatRound();
}

function _currentTurn() {
  return MagicTimekeeping.combatTurn();
}

function _nowWorldTime() {
  return MagicTimekeeping.nowWorldTimeSeconds();
}

function _str(v) {
  return v === null || v === undefined ? "" : String(v);
}

function _num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function _fromUuidSync(uuid) {
  const resolver = foundry?.utils?.fromUuidSync ?? globalThis.fromUuidSync;
  if (typeof resolver !== "function") return null;
  try {
    return resolver(uuid);
  } catch (_e) {
    return null;
  }
}

function _getCasterCombatTurnIndex(casterUuid) {
  const combat = game.combat;
  if (!combat || !casterUuid) return null;
  const doc = _fromUuidSync(casterUuid);
  const actor = doc?.documentName === "Actor" ? doc : doc?.actor;
  if (!actor) return null;
  const combatants = typeof combat.getCombatantsByActor === "function"
    ? combat.getCombatantsByActor(actor)
    : [];
  const combatant = Array.isArray(combatants) ? combatants[0] : null;
  if (!combatant) return null;
  const turns = Array.isArray(combat.turns) ? combat.turns : Array.from(combat.combatants ?? []);
  const idx = turns.findIndex(c => c?.id === combatant.id);
  if (idx < 0) return null;
  return idx;
}

function _promptSignature(promptContext) {
  if (!promptContext) return "";
  if (promptContext.mode === "realtime") return `rt:${_num(promptContext.endTime, 0)}`;
  if (promptContext.mode === "combat") return `cb:${_num(promptContext.endRound, 0)}:${_num(promptContext.endTurn, 0)}`;
  return "";
}

function _isRecentlyPrompted(groupKey, promptContext) {
  const signature = _promptSignature(promptContext);
  if (!groupKey || !signature) return false;
  const key = `${groupKey}::${signature}`;
  const entry = _recentPromptCache.get(key);
  if (!entry) return false;
  const ttl = Math.max(1, _roundTimeSeconds());
  if ((_nowWorldTime() - entry.time) <= ttl) return true;
  _recentPromptCache.delete(key);
  return false;
}

function _markRecentlyPrompted(groupKey, promptContext) {
  const signature = _promptSignature(promptContext);
  if (!groupKey || !signature) return;
  const key = `${groupKey}::${signature}`;
  _recentPromptCache.set(key, { time: _nowWorldTime() });
}

async function _withPromptLock(groupKey, promptContext, fn) {
  if (typeof fn !== "function") return;
  const signature = _promptSignature(promptContext);
  const lockKey = signature ? `${groupKey}::${signature}` : String(groupKey || "");
  if (_promptLocks.has(lockKey)) return;
  _promptLocks.add(lockKey);
  try {
    await fn();
  } finally {
    _promptLocks.delete(lockKey);
  }
}

function _getActorEffect(actor, effectId) {
  if (!actor?.effects?.get || !effectId) return null;
  return actor.effects.get(effectId) ?? null;
}

async function _safeUpdateEffect(effect, updates) {
  if (!effect || !updates) return false;
  if (!effect.id) return false;
  const parent = effect.parent;
  if (!parent) return false;
  if (parent?.effects?.get && !parent.effects.get(effect.id)) return false;

  if (game.user?.isGM || effect.isOwner) {
    try {
      await effect.update(updates);
      return true;
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (msg.includes("does not exist") || msg.includes("No Document")) return false;
      console.error("UESRPG | upkeep-workflow | Failed to update effect", { effectId: effect?.id, err });
      return false;
    }
  }

  return requestUpdateDocument(effect, updates);
}

function _groupKeyFromFlags(flags) {
  const casterUuid = _str(flags?.casterUuid);
  const spellUuid = _str(flags?.spellUuid);
  const castTime = _num(flags?.originalCastWorldTime, 0);
  if (!casterUuid || !spellUuid) return null;
  return `${casterUuid}::${spellUuid}::${castTime}`;
}

function _parseGroupKey(key) {
  const parts = _str(key).split("::");
  return {
    casterUuid: parts[0] || "",
    spellUuid: parts[1] || "",
    originalCastWorldTime: _num(parts[2], 0)
  };
}

function _measureDistanceMeters(aToken, bToken) {
  try {
    const a = aToken?.center ?? aToken?.object?.center ?? null;
    const b = bToken?.center ?? bToken?.object?.center ?? null;
    if (!a || !b) return Number.POSITIVE_INFINITY;

    if (!canvas?.grid || !canvas?.scene) return Number.POSITIVE_INFINITY;

    // Use v13 namespaced Ray with fallback to global Ray for compatibility
    const RayClass = foundry?.canvas?.geometry?.Ray ?? Ray;
    const ray = new RayClass(a, b);

    // Use v13 measurePath API with fallback to deprecated measureDistances
    if (typeof canvas.grid.measurePath === "function") {
      const path = canvas.grid.measurePath([{ ray }], { gridSpaces: true });
      const d = path?.distance ?? (Array.isArray(path) && path.length > 0 ? path[0] : null);
      if (Number.isFinite(d)) return d;
    } else {
      const distances = canvas.grid.measureDistances([{ ray }], { gridSpaces: true });
      const d = Array.isArray(distances) ? distances[0] : null;
      if (Number.isFinite(d)) return d;
    }

    // Fallback: approximate using pixel distance and grid scale.
    const pixels = ray.distance;
    const gridSize = Number(canvas.grid.size ?? 0) || 0;
    const gridDistance = Number(canvas.scene.grid?.distance ?? 0) || 0;
    if (gridSize > 0 && gridDistance > 0) return (pixels / gridSize) * gridDistance;

    return Number.POSITIVE_INFINITY;
  } catch (_e) {
    return Number.POSITIVE_INFINITY;
  }
}

function _getTokenForActorOnScene(actor, scene) {
  if (!actor || !scene) return null;
  const tokens = actor.getActiveTokens?.(true, true) ?? actor.getActiveTokens?.() ?? [];
  for (const t of tokens) {
    const doc = t?.document ?? t;
    if (doc?.scene?.id && doc.scene.id !== scene.id) continue;
    if (doc?.parent?.id && doc.parent.id !== scene.id) continue;
    return t?.object ?? t;
  }
  return null;
}

function _getEffectEndTime(effect) {
  const d = effect?.duration ?? {};
  const seconds = _num(d.seconds, 0);
  const startTime = _num(d.startTime, 0);
  if (!(seconds > 0) || !(startTime > 0)) return null;
  return startTime + seconds;
}

function _getEffectCombatBoundary(effect, flags) {
  const d = effect?.duration ?? {};
  const srRaw = d.startRound;
  const stRaw = d.startTurn;
  if (srRaw === null || srRaw === undefined) return null;
  if (stRaw === null || stRaw === undefined) return null;

  const startRound = _num(srRaw, 0);
  const startTurn = _num(stRaw, 0);

  const roundsRaw = _num(d.rounds, 0);
  const roundsForUpkeep = Boolean(flags?.noListedDuration) ? 1 : roundsRaw;
  if (!(roundsForUpkeep > 0)) return null;

  const casterTurnIndex = _getCasterCombatTurnIndex(_str(flags?.casterUuid));
  const endTurn = Number.isFinite(Number(casterTurnIndex)) ? _num(casterTurnIndex, startTurn) : startTurn;

  return {
    endRound: startRound + roundsForUpkeep,
    endTurn
  };
}

function _isWithinRealtimeWindow(effect, nowTime) {
  const endTime = _getEffectEndTime(effect);
  if (endTime == null) return false;

  const rt = _roundTimeSeconds();

  // Prompt window:
  // - last "round" before expiry
  // - and a grace window after expiry to support calendar time jumps.
  return (nowTime >= (endTime - rt)) && (nowTime < (endTime + rt));
}

async function _collectExpiringGroupsRealtime(nowTimeOverride = null) {
  const groups = new Map();
  const nowTime = Number.isFinite(Number(nowTimeOverride)) ? Number(nowTimeOverride) : _nowWorldTime();

  for (const targetActor of (MagicTimekeeping.relevantActorsArray?.() ?? Array.from(MagicTimekeeping.collectRelevantActors?.() ?? []))) {
    for (const effect of (targetActor.effects ?? [])) {
      const flags = effect.flags?.[_FLAG_NS];
      if (!flags?.spellEffect || !flags?.hasUpkeep) continue;

      if (!_isWithinRealtimeWindow(effect, nowTime)) continue;

      const endTime = _getEffectEndTime(effect);
      if (endTime == null) continue;

      // De-dup: do not keep emitting prompts for the same expiry boundary.
      const promptedEndTime = _num(flags?.upkeepPromptedEndTime, 0);
      if (promptedEndTime && promptedEndTime === endTime) continue;

      const gk = _groupKeyFromFlags(flags);
      if (!gk) continue;

      const entry = groups.get(gk) ?? {
        groupKey: gk,
        casterUuid: _str(flags.casterUuid),
        spellUuid: _str(flags.spellUuid),
        originalCastWorldTime: _num(flags.originalCastWorldTime, 0),
        spellName: _str(flags.spellName || effect.name),
        upkeepCosts: new Set(),
        effectRefs: [],
        promptContext: {
          mode: "realtime",
          endTime,
          atWorldTime: nowTime
        }
      };

      entry.upkeepCosts.add(_num(flags.upkeepCost, 0));
      entry.effectRefs.push({ targetActorId: targetActor.id, effectId: effect.id });

      // If we somehow see multiple endTimes for a group, prompt on the earliest.
      if (_num(entry.promptContext?.endTime, endTime) > endTime) entry.promptContext.endTime = endTime;

      groups.set(gk, entry);
    }
  }

  return { groups, nowTime };
}

async function _collectExpiringGroupsCombatTurnStart(nextRound, nextTurn) {
  const groups = new Map();
  const nowTime = _nowWorldTime();
  const nr = _num(nextRound, _currentRound());
  const nt = _num(nextTurn, _currentTurn());

  for (const targetActor of (MagicTimekeeping.relevantActorsArray?.() ?? Array.from(MagicTimekeeping.collectRelevantActors?.() ?? []))) {
    for (const effect of (targetActor.effects ?? [])) {
      const flags = effect.flags?.[_FLAG_NS];
      if (!flags?.spellEffect || !flags?.hasUpkeep) continue;

      const boundary = _getEffectCombatBoundary(effect, flags);
      if (!boundary) continue;

      if (boundary.endRound !== nr || boundary.endTurn !== nt) continue;

      // De-dup: do not keep emitting prompts for the same expiry boundary.
      const pr = _num(flags?.upkeepPromptedCombatRound, -999999);
      const pt = _num(flags?.upkeepPromptedCombatTurn, -999999);
      if (pr === boundary.endRound && pt === boundary.endTurn) continue;

      const gk = _groupKeyFromFlags(flags);
      if (!gk) continue;

      const entry = groups.get(gk) ?? {
        groupKey: gk,
        casterUuid: _str(flags.casterUuid),
        spellUuid: _str(flags.spellUuid),
        originalCastWorldTime: _num(flags.originalCastWorldTime, 0),
        spellName: _str(flags.spellName || effect.name),
        upkeepCosts: new Set(),
        effectRefs: [],
        promptContext: {
          mode: "combat",
          endRound: boundary.endRound,
          endTurn: boundary.endTurn,
          atWorldTime: nowTime
        }
      };

      entry.upkeepCosts.add(_num(flags.upkeepCost, 0));
      entry.effectRefs.push({ targetActorId: targetActor.id, effectId: effect.id });
      groups.set(gk, entry);
    }
  }

  return { groups, nowTime };
}

async function _markEffectsPromptedForGroup(groupKey, promptContext) {
  if (!groupKey || !promptContext) return;

  const matches = await _collectCurrentEffectsForGroup(groupKey);
  if (!matches.length) return;

  for (const m of matches) {
    const updates = {
      [`flags.${_FLAG_NS}.upkeepPromptedAtWorldTime`]: _num(promptContext.atWorldTime, _nowWorldTime())
    };

    if (promptContext.mode === "realtime") {
      const endTime = _num(promptContext.endTime, 0);
      if (endTime > 0) updates[`flags.${_FLAG_NS}.upkeepPromptedEndTime`] = endTime;
    } else if (promptContext.mode === "combat") {
      updates[`flags.${_FLAG_NS}.upkeepPromptedCombatRound`] = _num(promptContext.endRound, 0);
      updates[`flags.${_FLAG_NS}.upkeepPromptedCombatTurn`] = _num(promptContext.endTurn, 0);
    }

    const live = _getActorEffect(m.targetActor, m.effect?.id);
    if (!live) continue;
    const ok = await _safeUpdateEffect(live, updates);
    if (!ok) continue;
  }
}

/**
 * Initialize upkeep system hooks.
 */
export function initializeUpkeepSystem() {
  // Guard against multi-registration on hot reload.
  if (globalThis.__UESRPG_UPKEEP_SYSTEM_HOOKS_INSTALLED__) return;
  globalThis.__UESRPG_UPKEEP_SYSTEM_HOOKS_INSTALLED__ = true;

  // Combat cadence: prompt at the beginning of the relevant combat turn (not at round start).
  Hooks.on("preUpdateCombat", async (combat, changed) => {
    if (!combat) return;
    if (!game.user?.isGM) return; // single authoritative prompt source

    const hasTurn = Object.prototype.hasOwnProperty.call(changed ?? {}, "turn");
    const hasRound = Object.prototype.hasOwnProperty.call(changed ?? {}, "round");
    if (!hasTurn && !hasRound) return;

    const nextRound = hasRound ? _num(changed.round, _num(combat.round, 0)) : _num(combat.round, 0);
    const nextTurn = hasTurn ? _num(changed.turn, _num(combat.turn, 0)) : _num(combat.turn, 0);

    // Only prompt when the combat actually advances.
    if (nextRound === _num(combat.round, 0) && nextTurn === _num(combat.turn, 0)) return;

    await _checkUpkeepCombatTurnStart(nextRound, nextTurn);
  });

  // Combat cadence (time service): respond to centralized combat time ingress.
  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
    const p = payload ?? {};
    const source = String(p.source ?? "");
    const combat = p.combat ?? null;

    // Only react to the pre-advance intent payloads to match existing "start of turn" behavior.
    if (source !== "combatTurn" && source !== "combatRound") return;
    if (String(combat?.phase ?? "") !== "pre") return;
    if (!game.user?.isGM) return;

    // Only handle when combat is started (ignore idle combat documents).
    if (!(game.combat?.started || combat?.started)) return;

    const nextRound = _num(combat?.round, _currentRound());
    const nextTurn = _num(combat?.turn, _currentTurn());
    await _checkUpkeepCombatTurnStart(nextRound, nextTurn);
  });

  // Out of combat cadence: listen to the system-normalized time dispatcher.
  // This covers core time advancement and optional Calendaria UI changes without duplicating ingress.
  Hooks.on("uesrpg.timeChanged", async (payload) => {
    const p = payload ?? {};
    const source = String(p.source ?? "");

    // Only treat canonical (out-of-combat) time changes as realtime cadence.
    if (source !== "worldTime" && source !== "calendaria") return;

    // If combat is running, upkeep cadence is handled by combat cadence hooks.
    if (game.combat?.started || Boolean(p?.combat?.started)) return;
    if (!game.user?.isGM) return;

    const nowTime = Number(p.worldTime ?? game.time?.worldTime ?? 0) || 0;
    await _checkUpkeepRealtime(nowTime);
  });

  // Bind chat message listeners for upkeep buttons (group-based)
  const bindListeners = (message, html) => {
    const data = message?.flags?.[_FLAG_NS]?.upkeepGroup;
    if (!data) return;

    let root = null;
    if (html instanceof HTMLElement) {
      root = html;
    } else if (html?.[0] instanceof HTMLElement) {
      root = html[0];
    } else if (html?.jquery && html.length > 0) {
      root = html.get(0);
    }

    if (!root) {
      console.warn("UESRPG | upkeep-workflow | Could not normalize HTML element for upkeep card");
      return;
    }

    const confirmBtn = root.querySelector(".uesrpg-upkeep-confirm");
    const cancelBtn = root.querySelector(".uesrpg-upkeep-cancel");

    if (!confirmBtn && !cancelBtn) {
      console.warn("UESRPG | upkeep-workflow | Upkeep buttons not found in card", { hasData: !!data });
      return;
    }

    const disableBoth = () => {
      if (confirmBtn) confirmBtn.disabled = true;
      if (cancelBtn) cancelBtn.disabled = true;
    };

    if (confirmBtn && !confirmBtn.dataset.uesrpgUpkeepBound) {
      confirmBtn.dataset.uesrpgUpkeepBound = "1";
      confirmBtn.addEventListener(
        "click",
        async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          disableBoth();
          try {
            await handleUpkeepGroupConfirm(message);
          } catch (err) {
            console.error("UESRPG | upkeep-workflow | confirm failed", err);
            ui.notifications?.error?.("Upkeep failed. See console for details.");
          }
        },
        { once: true }
      );
    }

    if (cancelBtn && !cancelBtn.dataset.uesrpgUpkeepBound) {
      cancelBtn.dataset.uesrpgUpkeepBound = "1";
      cancelBtn.addEventListener(
        "click",
        async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          disableBoth();
          try {
            await handleUpkeepGroupCancel(message);
          } catch (err) {
            console.error("UESRPG | upkeep-workflow | cancel failed", err);
            ui.notifications?.error?.("Failed to end spell. See console for details.");
          }
        },
        { once: true }
      );
    }
  };

  Hooks.on("renderChatMessageHTML", bindListeners);
}

async function _checkUpkeepCombatTurnStart(nextRound, nextTurn) {
  const { groups } = await _collectExpiringGroupsCombatTurnStart(nextRound, nextTurn);

  for (const group of groups.values()) {
    const casterDoc = await fromUuid(group.casterUuid);
    const casterActor = casterDoc?.documentName === "Actor" ? casterDoc : casterDoc?.actor;
    if (!casterActor) continue;
    await _withPromptLock(group.groupKey, group.promptContext, async () => {
      await _createUpkeepPrompt(group, casterActor);
      await _markEffectsPromptedForGroup(group.groupKey, group.promptContext);
    });
  }
}

async function _checkUpkeepRealtime(nowTimeOverride = null) {
  if (_realtimeScanInFlight) return;
  _realtimeScanInFlight = true;
  try {
    const { groups } = await _collectExpiringGroupsRealtime(nowTimeOverride);

    for (const group of groups.values()) {
      const casterDoc = await fromUuid(group.casterUuid);
      const casterActor = casterDoc?.documentName === "Actor" ? casterDoc : casterDoc?.actor;
      if (!casterActor) continue;
      if (_isRecentlyPrompted(group.groupKey, group.promptContext)) continue;

      await _withPromptLock(group.groupKey, group.promptContext, async () => {
        await _createUpkeepPrompt(group, casterActor);
        _markRecentlyPrompted(group.groupKey, group.promptContext);
        await _markEffectsPromptedForGroup(group.groupKey, group.promptContext);
      });
    }
  } finally {
    _realtimeScanInFlight = false;
  }
}

function _formatTargetNames(effectRefs) {
  const names = [];
  for (const ref of effectRefs ?? []) {
    const a = game.actors.get(ref.targetActorId);
    if (!a) continue;
    names.push(a.name);
  }
  const unique = Array.from(new Set(names));
  if (!unique.length) return "(no targets)";
  if (unique.length <= 3) return unique.join(", ");
  return `${unique.slice(0, 3).join(", ")} (+${unique.length - 3} more)`;
}

async function _createUpkeepPrompt(group, casterActor) {
  const targetSummary = _formatTargetNames(group.effectRefs);

  const upkeepCosts = Array.from(group.upkeepCosts ?? []).filter(n => Number.isFinite(n));
  const upkeepCost = upkeepCosts.length ? Math.max(...upkeepCosts) : 0;

  const content = `
  <div class="uesrpg-upkeep-card">
    <h3>Spell Upkeep</h3>
    <p><strong>${group.spellName}</strong> is about to end.</p>
    <p><strong>Targets:</strong> ${targetSummary}</p>
    <p>Pay <strong>${upkeepCost}</strong> Magicka to refresh the effect?</p>
    <div class="uesrpg-upkeep-buttons">
      <button type="button" class="uesrpg-upkeep-confirm"><i class="fas fa-sync-alt"></i> Upkeep</button>
      <button type="button" class="uesrpg-upkeep-cancel"><i class="fas fa-times"></i> End</button>
    </div>
  </div>`;

  const whisperIds = (game.users ?? [])
    .filter(u => u.active && (u.isGM || casterActor.testUserPermission(u, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)))
    .map(u => u.id);

  const msgData = {
    content,
    speaker: ChatMessage.getSpeaker({ actor: casterActor }),
    flags: {
      [_FLAG_NS]: {
        upkeepGroup: {
          groupKey: group.groupKey,
          casterActorId: casterActor.id,
          casterUuid: group.casterUuid,
          spellUuid: group.spellUuid,
          originalCastWorldTime: group.originalCastWorldTime,
          upkeepCost,
          spellName: group.spellName,
          effectRefs: group.effectRefs
        }
      }
    }
  };

  if (whisperIds.length) msgData.whisper = whisperIds;

  await ChatMessage.create(msgData);
}

async function _collectCurrentEffectsForGroup(groupKey) {
  const { casterUuid, spellUuid, originalCastWorldTime } = _parseGroupKey(groupKey);
  const matches = [];

  for (const targetActor of (MagicTimekeeping.relevantActorsArray?.() ?? Array.from(MagicTimekeeping.collectRelevantActors?.() ?? []))) {
    for (const effect of (targetActor.effects ?? [])) {
      const flags = effect.flags?.[_FLAG_NS];
      if (!flags?.spellEffect || !flags?.hasUpkeep) continue;
      if (_str(flags.casterUuid) !== casterUuid) continue;
      if (_str(flags.spellUuid) !== spellUuid) continue;
      if (_num(flags.originalCastWorldTime, 0) !== originalCastWorldTime) continue;
      matches.push({ targetActor, effect, flags });
    }
  }

  return matches;
}

async function _validateUpkeepRange({ casterActor, spell, matches }) {
  const rangeType = getSpellRangeType(spell);
  if (rangeType === "none") return { ok: true, failures: [] };

  const maxRange = getSpellMaxRangeMeters(spell);
  if (!Number.isFinite(maxRange) || maxRange <= 0) return { ok: true, failures: [] };

  const scene = canvas?.scene ?? null;
  if (!scene) return { ok: true, failures: [] };

  const casterToken = _getTokenForActorOnScene(casterActor, scene);
  if (!casterToken) return { ok: true, failures: [] };

  const failures = [];
  for (const m of matches) {
    const targetToken = _getTokenForActorOnScene(m.targetActor, scene);
    if (!targetToken) continue;

    const d = _measureDistanceMeters(casterToken, targetToken);
    if (Number.isFinite(d) && d > maxRange) {
      failures.push({ actorName: m.targetActor.name, distance: d, maxRange });
    }
  }

  if (failures.length) return { ok: false, failures };
  return { ok: true, failures: [] };
}

/**
 * Confirm upkeep from a grouped upkeep prompt message.
 * @param {ChatMessage} message
 */
export async function handleUpkeepGroupConfirm(message) {
  const data = message?.flags?.[_FLAG_NS]?.upkeepGroup;
  if (!data) return;

  const casterDoc = await fromUuid(data.casterUuid);
  const casterActor = casterDoc?.documentName === "Actor" ? casterDoc : casterDoc?.actor;

  if (!casterActor) {
    console.error("UESRPG | upkeep-workflow | Could not resolve caster actor", data.casterUuid);
    ui.notifications?.error?.("Could not find caster actor.");
    return;
  }

  const matches = await _collectCurrentEffectsForGroup(data.groupKey);
  if (!matches.length) {
    ui.notifications?.info?.("Nothing to upkeep: the effect(s) already ended.");
    return;
  }

  // Best-effort resolve spell
  const spellDoc = await fromUuid(_str(data.spellUuid));
  const spell = spellDoc?.documentName === "Item" ? spellDoc : null;

  // RAW: if no listed duration, cannot upkeep if a different spell was cast since original cast
  const anyNoListed = matches.some(m => Boolean(m.flags?.noListedDuration));
  if (anyNoListed) {
    const originalCast = _num(data.originalCastWorldTime, 0);
    const lastCast = _num(casterActor.getFlag(_FLAG_NS, "lastSpellCastWorldTime"), 0);
    const lastSpellUuid = casterActor.getFlag(_FLAG_NS, "lastSpellCastSpellUuid");
    const spellUuid = _str(data.spellUuid);

    if (lastCast > originalCast && lastSpellUuid && _str(lastSpellUuid) !== spellUuid) {
      ui.notifications?.warn?.("Cannot upkeep this spell: you have cast a different spell since the original cast.");
      return;
    }
  }

  // RAW: requirements (range) must still be met.
  if (spell) {
    const rangeCheck = await _validateUpkeepRange({ casterActor, spell, matches });
    if (!rangeCheck.ok) {
      const parts = rangeCheck.failures
        .map(f => `${f.actorName} (${Math.round(f.distance * 10) / 10}m > ${f.maxRange}m)`)
        .join(", ");
      ui.notifications?.warn?.(`Cannot upkeep: out of range: ${parts}.`);
      return;
    }
  }

  // Spend Magicka once
  const upkeepCost = _num(data.upkeepCost, 0);
  const currentMP = _num(casterActor.system?.magicka?.value, 0);

  if (upkeepCost > currentMP) {
    ui.notifications?.warn?.("Not enough Magicka to upkeep this spell.");
    return;
  }

  const newMagicka = currentMP - upkeepCost;

  try {
    await requestUpdateDocument(casterActor, { "system.magicka.value": newMagicka });
  } catch (err) {
    console.error("UESRPG | upkeep-workflow | Failed to update magicka", err);
    ui.notifications?.error?.("Failed to deduct magicka. See console.");
    return;
  }

  // RAW: If a spell has the Attack attribute, then upkeeping the spell counts toward the
  // maximum attacks per round limit.
  if (game.combat && spell) {
    const cls = classifySpellForRouting(spell);
    if (cls.isAttack) {
      try {
        await AttackTracker.incrementAttacks(casterActor);
        const warning = AttackTracker.getLimitWarning(casterActor);
        if (warning) ui.notifications?.warn?.(warning);
      } catch (err) {
        console.error("UESRPG | upkeep-workflow | Failed to increment attack counter for upkeep", err);
      }
    }
  }

  // Refresh duration by resetting start markers on all currently-matched effects
  const nowRound = _currentRound();
  const nowTurn = _currentTurn();
  const nowTime = _nowWorldTime();

  for (const m of matches) {
    const live = _getActorEffect(m.targetActor, m.effect?.id);
    if (!live) continue;
    const duration = live.duration ?? {};
    const rounds = _num(duration.rounds, 0);

    const updates = {
      "duration.startTime": nowTime,
      "disabled": false
    };

    if (game.combat) updates["duration.combat"] = game.combat.id;
    else updates["duration.combat"] = null;

    // No-listed-duration upkeep requires a 1-round cadence even outside combat.
    // Ensure seconds is never zero so realtime upkeep windows can trigger.
    if (Boolean(m.flags?.noListedDuration)) {
      const rt = _roundTimeSeconds();
      const sec = _num(duration.seconds, 0);
      if (!(sec > 0)) updates["duration.seconds"] = rt;
    }

    if (game.combat) {
      updates["duration.startRound"] = nowRound;
      updates["duration.startTurn"] = nowTurn;

      if (Boolean(m.flags?.noListedDuration) && rounds <= 0) {
        updates["duration.rounds"] = 1;
      }

      if (Boolean(m.flags?.noListedDuration)) {
        const rt = _roundTimeSeconds();
        const sec = _num(duration.seconds, 0);
        if (!(sec > 0)) updates["duration.seconds"] = rt;
      }
    }

    // Clear prompt de-dup flags so a later expiry will prompt cleanly.
    updates[`flags.${_FLAG_NS}.upkeepPromptedEndTime`] = null;
    updates[`flags.${_FLAG_NS}.upkeepPromptedCombatRound`] = null;
    updates[`flags.${_FLAG_NS}.upkeepPromptedCombatTurn`] = null;
    updates[`flags.${_FLAG_NS}.expiredAtWorldTime`] = null;
    updates[`flags.${_FLAG_NS}.upkeepAwaiting`] = null;

    await _safeUpdateEffect(live, updates);
  }

  ui.notifications?.info?.(`${data.spellName} upkept.`);
}

/**
 * Cancel upkeep from a grouped upkeep prompt message (end the effect(s) now).
 * @param {ChatMessage} message
 */
export async function handleUpkeepGroupCancel(message) {
  const data = message?.flags?.[_FLAG_NS]?.upkeepGroup;
  if (!data) return;

  const matches = await _collectCurrentEffectsForGroup(data.groupKey);
  if (!matches.length) return;

  const byActor = new Map();
  for (const m of matches) {
    const actor = m.targetActor;
    if (!actor) continue;
    const arr = byActor.get(actor) ?? [];
    arr.push(m.effect.id);
    byActor.set(actor, arr);
  }

  for (const [actor, ids] of byActor.entries()) {
    const liveEffects = ids.map(id => _getActorEffect(actor, id)).filter(Boolean);
    if (!liveEffects.length) continue;

    for (const ef of liveEffects) {
      await _safeUpdateEffect(ef, { [`flags.${_FLAG_NS}.upkeepAwaiting`]: null });
    }

    const liveIds = liveEffects.map(e => e.id);
    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", liveIds);
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (msg.includes("does not exist") || msg.includes("No Document")) continue;
      console.error("UESRPG | upkeep-workflow | Failed to delete upkeep effects", { actor: actor?.uuid, ids: liveIds, err });
    }
  }

  ui.notifications?.info?.(`${data.spellName} ended.`);
}
