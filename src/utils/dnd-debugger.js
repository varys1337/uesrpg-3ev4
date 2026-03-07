/**
 * DnD diagnostics helpers for UESRPG sheets/utilities.
 * Provides correlation ids, gated logging, optional warnings, and recent trace capture.
 */

import { isDebugEnabled } from "./debug.js";
import { SYSTEM_ID } from "../core/constants.js";

const SETTING_DEBUG = "dndDebugEnabled";
const SETTING_VERBOSE = "dndDebugVerbose";
const SETTING_NOTIFY = "dndDebugNotifyOnFailure";
const SETTING_DOM_EVENTS = "dndDebugDomEvents";
const SETTING_KEEP_RECENT = "dndDebugKeepRecentCount";

const HIGH_FREQ_STAGES = new Set([
  "dom.dragstart",
  "dom.drop",
  "drag.cache.store",
  "hook.dropCanvasData",
]);

const _recentDndTraces = [];

function _boolSetting(key, fallback = false) {
  try {
    return Boolean(game?.settings?.get?.(SYSTEM_ID, key));
  } catch (_e) {
    return fallback;
  }
}

function _numSetting(key, fallback) {
  try {
    const raw = Number(game?.settings?.get?.(SYSTEM_ID, key));
    return Number.isFinite(raw) ? raw : fallback;
  } catch (_e) {
    return fallback;
  }
}

function _truncateString(value, max = 220) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function _sanitize(value, depth = 0) {
  if (depth > 3) return "[MaxDepth]";
  if (value == null) return value;
  const t = typeof value;
  if (t === "string") return _truncateString(value);
  if (t === "number" || t === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => _sanitize(v, depth + 1));

  if (t === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "function") continue;
      if (k === "parent" || k === "actor" || k === "collection") continue;
      try {
        out[k] = _sanitize(v, depth + 1);
      } catch (_e) {
        out[k] = "[Unserializable]";
      }
    }
    return out;
  }

  return _truncateString(value);
}

function _isEnabled() {
  return isDebugEnabled(SETTING_DEBUG);
}

function _isVerbose() {
  return _isEnabled() && _boolSetting(SETTING_VERBOSE, false);
}

function _domEventsEnabled() {
  return _isEnabled() && _boolSetting(SETTING_DOM_EVENTS, false);
}

function _keepRecentCount() {
  const count = Math.trunc(_numSetting(SETTING_KEEP_RECENT, 100));
  return Math.min(1000, Math.max(20, count));
}

function _pushRecentTrace(stage, payload, traceId = null, level = "debug") {
  _recentDndTraces.push({
    ts: Date.now(),
    iso: new Date().toISOString(),
    level,
    stage,
    traceId,
    payload: _sanitize(payload),
  });

  const keep = _keepRecentCount();
  if (_recentDndTraces.length > keep) {
    _recentDndTraces.splice(0, _recentDndTraces.length - keep);
  }
}

function _installDebugApi() {
  game.uesrpg ??= {};
  game.uesrpg.debug ??= {};

  if (!game.uesrpg.debug.dumpRecentDndTraces) {
    game.uesrpg.debug.dumpRecentDndTraces = (limit = 40) => {
      const n = Math.max(1, Math.min(200, Number(limit) || 40));
      const snapshot = _recentDndTraces.slice(-n);
      console.groupCollapsed?.(`UESRPG | DnD | recent traces (${snapshot.length})`);
      console.table?.(snapshot.map((t) => ({
        iso: t.iso,
        level: t.level,
        stage: t.stage,
        traceId: t.traceId,
      })));
      console.groupEnd?.();
      return snapshot;
    };
  }

  if (!game.uesrpg.debug.dumpDndTrace) {
    game.uesrpg.debug.dumpDndTrace = (traceId) => {
      const key = String(traceId ?? "").trim();
      if (!key) return [];
      const snapshot = _recentDndTraces.filter((t) => t.traceId === key);
      console.groupCollapsed?.(`UESRPG | DnD | trace ${key} (${snapshot.length})`);
      for (const row of snapshot) console.debug?.(row);
      console.groupEnd?.();
      return snapshot;
    };
  }
}

export function makeDndTraceId(prefix = "dnd") {
  const p = String(prefix || "dnd").trim().toLowerCase() || "dnd";
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function dndDebug(stage, payload = {}, options = {}) {
  if (!_isEnabled()) return;
  const traceId = options.traceId ?? null;
  const compact = String(stage ?? "");
  if (HIGH_FREQ_STAGES.has(compact) && !_domEventsEnabled()) return;

  const safePayload = _sanitize(payload);
  const tag = traceId ? `UESRPG | DnD | ${compact} | ${traceId}` : `UESRPG | DnD | ${compact}`;
  _pushRecentTrace(compact, safePayload, traceId, "debug");

  try {
    if (_isVerbose()) {
      console.groupCollapsed(tag);
      console.debug(safePayload);
      console.groupEnd();
    } else {
      console.debug(tag, safePayload);
    }
  } catch (_e) {
    /* no-op */
  }
}

export function dndWarnFailure(message, options = {}) {
  const traceId = options.traceId ?? null;
  const details = options.details ?? null;
  const notify = options.notify ?? _boolSetting(SETTING_NOTIFY, true);
  const msg = _truncateString(message ?? "DnD failure", 240);
  const label = traceId ? `${msg} [${traceId}]` : msg;
  const safeDetails = _sanitize(details);

  _pushRecentTrace("failure", { message: label, details: safeDetails }, traceId, "warn");

  try {
    console.warn("UESRPG | DnD | Failure", { message: label, details: safeDetails });
  } catch (_e) {
    /* no-op */
  }

  if (notify) {
    try {
      ui.notifications?.warn?.(label);
    } catch (_e) {
      /* no-op */
    }
  }
}

export function rememberLastItemDragPayload(payload, options = {}) {
  try {
    if (!payload || typeof payload !== "object") return;
    if (String(payload.type ?? "") !== "Item") return;
    game.uesrpg ??= {};
    game.uesrpg._lastItemDragPayload = {
      payload: foundry.utils.deepClone(payload),
      ts: Date.now(),
      traceId: options.traceId ?? null,
    };
    dndDebug("drag.cache.store", {
      type: payload.type ?? null,
      uuid: payload.uuid ?? payload.documentUuid ?? null,
      itemId: payload.itemId ?? payload.id ?? null,
    }, { traceId: options.traceId ?? null });
  } catch (_e) {
    /* no-op */
  }
}

export function getRecentItemDragPayload(maxAgeMs = 4000) {
  try {
    const entry = game?.uesrpg?._lastItemDragPayload ?? null;
    if (!entry?.payload) return null;
    const age = Date.now() - Number(entry.ts ?? 0);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
    return foundry.utils.deepClone(entry.payload);
  } catch (_e) {
    return null;
  }
}

export function registerDndDebugObservers() {
  if (game?.uesrpg?._dndDebugObserversRegistered) return;
  game.uesrpg._dndDebugObserversRegistered = true;

  _installDebugApi();

  Hooks.on("dropCanvasData", (_canvas, payload) => {
    dndDebug("hook.dropCanvasData", payload ?? {});
  });

  Hooks.once("ready", () => {
    if (game?.uesrpg?._dndDomObserversRegistered) return;
    const body = globalThis?.document?.body;
    if (!body) return;

    let lastDragStartTs = 0;
    let lastDragStartKey = "";

    const handleDragStart = (ev) => {
      if (!_domEventsEnabled()) return;

      const target = ev?.target;
      const itemId = target?.closest?.("[data-item-id]")?.dataset?.itemId ?? "";
      const uuid = target?.closest?.("[data-uuid]")?.dataset?.uuid ?? "";
      const key = `${target?.tagName ?? "?"}|${itemId}|${uuid}|${target?.className ?? ""}`;
      const now = Date.now();
      if (key === lastDragStartKey && (now - lastDragStartTs) <= 120) return;
      lastDragStartKey = key;
      lastDragStartTs = now;

      let plain = null;
      try {
        const raw = String(ev?.dataTransfer?.getData?.("text/plain") ?? "").trim();
        if (raw) plain = JSON.parse(raw);
      } catch (_e) {
        plain = null;
      }

      dndDebug("dom.dragstart", {
        target: {
          tag: target?.tagName ?? null,
          classes: target?.className ?? null,
          itemId,
          uuid,
        },
        payload: plain,
      });
    };

    const handleDrop = (ev) => {
      if (!_domEventsEnabled()) return;
      let plain = null;
      try {
        const raw = String(ev?.dataTransfer?.getData?.("text/plain") ?? "").trim();
        if (raw) plain = JSON.parse(raw);
      } catch (_e) {
        plain = null;
      }

      const target = ev?.target;
      dndDebug("dom.drop", {
        target: {
          tag: target?.tagName ?? null,
          classes: target?.className ?? null,
          itemId: target?.closest?.("[data-item-id]")?.dataset?.itemId ?? null,
          itemType: target?.closest?.("[data-item-type]")?.dataset?.itemType ?? null,
          uuid: target?.closest?.("[data-uuid]")?.dataset?.uuid ?? null,
        },
        payload: plain,
      });
    };

    body.addEventListener("dragstart", handleDragStart, true);
    body.addEventListener("drop", handleDrop, true);
    game.uesrpg._dndDomObserversRegistered = true;
  });
}
