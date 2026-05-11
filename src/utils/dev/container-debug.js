import { SYSTEM_ID } from "../../core/constants.js";

const SETTING_CONTAINER_DEBUG = "containerDebug";
const RECENT_LIMIT = 120;
const _recentContainerTraces = [];
const _previousContainerByItem = new Map();

function _settingEnabled() {
  try {
    return Boolean(game?.settings?.get?.(SYSTEM_ID, SETTING_CONTAINER_DEBUG));
  } catch (_e) {
    return false;
  }
}

function _truncate(value, max = 240) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function _sanitize(value, depth = 0) {
  if (depth > 4) return "[MaxDepth]";
  if (value == null) return value;
  const type = typeof value;
  if (type === "string") return _truncate(value);
  if (type === "number" || type === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((entry) => _sanitize(entry, depth + 1));
  if (type === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "function") continue;
      if (key === "parent" || key === "actor" || key === "collection") continue;
      try {
        out[key] = _sanitize(entry, depth + 1);
      } catch (_e) {
        out[key] = "[Unserializable]";
      }
    }
    return out;
  }
  return _truncate(value);
}

function _pushTrace(stage, payload = {}, level = "debug") {
  const entry = {
    ts: Date.now(),
    iso: new Date().toISOString(),
    level,
    stage: String(stage ?? ""),
    payload: _sanitize(payload),
  };
  _recentContainerTraces.push(entry);
  if (_recentContainerTraces.length > RECENT_LIMIT) {
    _recentContainerTraces.splice(0, _recentContainerTraces.length - RECENT_LIMIT);
  }
  return entry;
}

function _itemId(item) {
  return String(item?.id ?? item?._id ?? "").trim();
}

function _containerId(item) {
  return String(item?.system?.containerStats?.container_id ?? "").trim();
}

function _actorItems(actor) {
  return Array.from(actor?.items?.contents ?? actor?.items ?? []);
}

function _containerExists(actor, id) {
  const container = actor?.items?.get?.(String(id ?? "").trim()) ?? null;
  return container?.type === "container" ? container : null;
}

function _directChildren(actor, container) {
  const id = _itemId(container);
  if (!actor || !id) return [];
  return _actorItems(actor).filter((item) => _containerId(item) === id);
}

function _snapshotIds(container) {
  const rows = Array.isArray(container?.system?.contained_items) ? container.system.contained_items : [];
  return rows.map((entry) => String(entry?._id ?? entry?.item?._id ?? entry?.item?.id ?? "").trim()).filter(Boolean);
}

function _sheetOpen(document) {
  const sheet = document?.sheet;
  return Boolean(sheet?.rendered === true || sheet?.element?.isConnected === true);
}

function _clearActorSheetCaches(actor) {
  const sheet = actor?.sheet;
  if (!sheet) return;
  try {
    if ("_uesrpgItemsCache" in sheet) sheet._uesrpgItemsCache = null;
    if ("_uesrpgEncumbranceCache" in sheet) sheet._uesrpgEncumbranceCache = null;
  } catch (_e) {
    /* no-op */
  }
}

function _renderOpenSheet(document) {
  try {
    const sheet = document?.sheet;
    if (!_sheetOpen(document)) return false;
    sheet.render(true);
    return true;
  } catch (err) {
    console.warn("UESRPG | Container debug rerender failed", {
      uuid: document?.uuid ?? null,
      err,
    });
    return false;
  }
}

function _containerAncestors(actor, item) {
  const ancestors = [];
  const visited = new Set([_itemId(item)]);
  let current = item;
  for (let i = 0; i < 8; i += 1) {
    const parentId = _containerId(current);
    if (!parentId || visited.has(parentId)) break;
    const parent = _containerExists(actor, parentId);
    if (!parent) break;
    ancestors.push(parent);
    visited.add(parentId);
    current = parent;
  }
  return ancestors;
}

function _collectContainersToRender(actor, item, formerContainerId = "") {
  const ids = new Set();
  const add = (candidate) => {
    const id = _itemId(candidate);
    if (candidate?.type === "container" && id) ids.add(id);
  };

  const currentContainer = _containerExists(actor, _containerId(item));
  add(currentContainer);
  for (const ancestor of _containerAncestors(actor, currentContainer)) add(ancestor);

  const formerContainer = _containerExists(actor, formerContainerId);
  add(formerContainer);
  for (const ancestor of _containerAncestors(actor, formerContainer)) add(ancestor);

  if (item?.type === "container") add(item);
  return Array.from(ids).map((id) => actor?.items?.get?.(id)).filter(Boolean);
}

function _renderContainmentLifecycle(actor, item, formerContainerId = "") {
  if (!_settingEnabled()) return;
  if (!actor || actor.documentName !== "Actor" || !item) return;
  _clearActorSheetCaches(actor);
  const containers = _collectContainersToRender(actor, item, formerContainerId);
  const renderedContainers = containers.filter((container) => _renderOpenSheet(container)).map((container) => container.uuid);
  const renderedActor = _renderOpenSheet(actor);
  containerDebug("lifecycle.rerender", {
    actor: actor?.uuid ?? null,
    item: item?.uuid ?? null,
    formerContainerId,
    currentContainerId: _containerId(item),
    renderedActor,
    renderedContainers,
  });
}

function _touchesContainerStats(changed = {}) {
  if (!changed || typeof changed !== "object") return false;
  return foundry.utils.hasProperty(changed, "system.containerStats")
    || foundry.utils.hasProperty(changed, "system.containerStats.contained")
    || foundry.utils.hasProperty(changed, "system.containerStats.container_id")
    || foundry.utils.hasProperty(changed, "system.containerStats.container_name");
}

async function _resolveActor(actorOrUuid) {
  if (!actorOrUuid) return null;
  if (actorOrUuid.documentName === "Actor") return actorOrUuid;
  if (typeof actorOrUuid === "string") {
    const key = actorOrUuid.trim();
    if (!key) return null;
    const byId = game?.actors?.get?.(key) ?? null;
    if (byId) return byId;
    const byName = game?.actors?.getName?.(key) ?? null;
    if (byName) return byName;
    try {
      const doc = await fromUuid(key);
      return doc?.documentName === "Actor" ? doc : null;
    } catch (_e) {
      return null;
    }
  }
  return null;
}

export function containerDebug(stage, payload = {}, { level = "debug" } = {}) {
  _pushTrace(stage, payload, level);
  if (!_settingEnabled()) return;
  const tag = `UESRPG | ContainerDebug | ${String(stage ?? "")}`;
  const safe = _sanitize(payload);
  try {
    if (level === "warn") console.warn(tag, safe);
    else console.debug(tag, safe);
  } catch (_e) {
    /* no-op */
  }
}

export function containerWarn(stage, payload = {}) {
  containerDebug(stage, payload, { level: "warn" });
  try {
    console.warn(`UESRPG | ContainerDebug | ${String(stage ?? "")}`, _sanitize(payload));
  } catch (_e) {
    /* no-op */
  }
}

export async function auditContainers(actorOrUuid) {
  const actor = await _resolveActor(actorOrUuid);
  if (!actor) {
    const report = { ok: false, error: "Actor not found", actor: String(actorOrUuid ?? "") };
    console.warn("UESRPG | ContainerDebug | auditContainers", report);
    return report;
  }

  const items = _actorItems(actor);
  const containers = items.filter((item) => item?.type === "container").map((container) => {
    const derivedChildren = _directChildren(actor, container);
    const snapshotIds = _snapshotIds(container);
    const derivedIds = derivedChildren.map(_itemId);
    return {
      id: _itemId(container),
      uuid: container?.uuid ?? null,
      name: container?.name ?? "",
      derivedChildIds: derivedIds,
      derivedChildNames: derivedChildren.map((item) => item?.name ?? ""),
      derivedCount: derivedChildren.length,
      snapshotIds,
      snapshotCount: snapshotIds.length,
      staleSnapshotIds: snapshotIds.filter((id) => !derivedIds.includes(id)),
      missingSnapshotIds: derivedIds.filter((id) => !snapshotIds.includes(id)),
      sheetOpen: _sheetOpen(container),
      capacity: {
        current: Number(container?.system?.container_enc?.current ?? 0),
        max: Number(container?.system?.container_enc?.max ?? 0),
        itemCount: Number(container?.system?.container_enc?.item_count ?? 0),
      },
    };
  });

  const pointedItems = [];
  const orphanedPointers = [];
  const staleFlags = [];
  for (const item of items) {
    const containerId = _containerId(item);
    const flag = item?.system?.containerStats?.contained === true;
    if (!containerId) {
      if (flag) staleFlags.push({ id: _itemId(item), name: item?.name ?? "", contained: flag, containerId });
      continue;
    }
    const container = _containerExists(actor, containerId);
    const row = {
      id: _itemId(item),
      uuid: item?.uuid ?? null,
      name: item?.name ?? "",
      type: item?.type ?? "",
      containedFlag: flag,
      containerId,
      containerName: item?.system?.containerStats?.container_name ?? "",
      resolvedContainerName: container?.name ?? null,
    };
    pointedItems.push(row);
    if (!container) orphanedPointers.push(row);
    if (!flag) staleFlags.push(row);
  }

  const report = {
    ok: true,
    actor: {
      id: actor.id,
      uuid: actor.uuid,
      name: actor.name,
      type: actor.type,
      itemCount: items.length,
      sheetOpen: _sheetOpen(actor),
    },
    containers,
    pointedItems,
    orphanedPointers,
    staleFlags,
  };

  console.groupCollapsed?.(`UESRPG | ContainerDebug | audit ${actor.name}`);
  console.table?.(containers.map((container) => ({
    name: container.name,
    id: container.id,
    derivedCount: container.derivedCount,
    snapshotCount: container.snapshotCount,
    staleSnapshots: container.staleSnapshotIds.length,
    missingSnapshots: container.missingSnapshotIds.length,
    sheetOpen: container.sheetOpen,
  })));
  console.debug?.(report);
  console.groupEnd?.();
  return report;
}

function _installDebugApi() {
  game.uesrpg ??= {};
  game.uesrpg.debug ??= {};
  game.uesrpg.debug.dumpRecentContainerTraces = (limit = 40) => {
    const n = Math.max(1, Math.min(RECENT_LIMIT, Number(limit) || 40));
    const snapshot = _recentContainerTraces.slice(-n);
    console.groupCollapsed?.(`UESRPG | ContainerDebug | recent traces (${snapshot.length})`);
    console.table?.(snapshot.map((entry) => ({
      iso: entry.iso,
      level: entry.level,
      stage: entry.stage,
    })));
    console.groupEnd?.();
    return snapshot;
  };
  game.uesrpg.debug.auditContainers = auditContainers;
}

export function registerContainerDebugObservers() {
  if (game?.uesrpg?._containerDebugObserversRegistered) return;
  game.uesrpg ??= {};
  game.uesrpg._containerDebugObserversRegistered = true;

  Hooks.on("preUpdateItem", (item, changed, _options, userId) => {
    if (!_touchesContainerStats(changed)) return;
    _previousContainerByItem.set(item.uuid, _containerId(item));
    containerDebug("hook.preUpdateItem", {
      userId,
      item: item?.uuid ?? null,
      actor: item?.actor?.uuid ?? item?.parent?.uuid ?? null,
      previousContainerId: _containerId(item),
      changed,
    });
  });

  Hooks.on("updateItem", (item, changed, _options, userId) => {
    if (!_touchesContainerStats(changed)) return;
    const formerContainerId = _previousContainerByItem.get(item.uuid) ?? "";
    _previousContainerByItem.delete(item.uuid);
    const actor = item?.actor ?? item?.parent ?? null;
    containerDebug("hook.updateItem", {
      userId,
      item: item?.uuid ?? null,
      actor: actor?.uuid ?? null,
      formerContainerId,
      currentContainerId: _containerId(item),
      containerStats: item?.system?.containerStats ?? {},
      changed,
    });
    _renderContainmentLifecycle(actor, item, formerContainerId);
  });

  Hooks.on("createItem", (item, _options, userId) => {
    if (!_containerId(item) && item?.type !== "container") return;
    containerDebug("hook.createItem", {
      userId,
      item: item?.uuid ?? null,
      actor: item?.actor?.uuid ?? item?.parent?.uuid ?? null,
      type: item?.type ?? null,
      containerStats: item?.system?.containerStats ?? {},
    });
    _renderContainmentLifecycle(item?.actor ?? item?.parent ?? null, item, "");
  });

  Hooks.on("deleteItem", (item, _options, userId) => {
    const formerContainerId = _containerId(item);
    if (!formerContainerId && item?.type !== "container") return;
    containerDebug("hook.deleteItem", {
      userId,
      item: item?.uuid ?? null,
      actor: item?.actor?.uuid ?? item?.parent?.uuid ?? null,
      type: item?.type ?? null,
      formerContainerId,
    });
    _renderContainmentLifecycle(item?.actor ?? item?.parent ?? null, item, formerContainerId);
  });

  Hooks.once("ready", () => {
    _installDebugApi();
    containerDebug("ready", {
      world: game?.world?.id ?? null,
      user: game?.user?.id ?? null,
      enabled: _settingEnabled(),
      note: "Container diagnostics API installed.",
    });
  });
}
