/**
 * src/ui/sheets/item/listeners/containment.js
 *
 * Actor-owned container handling.
 *
 * Canonical containment state is stored on the contained Item:
 * - system.containerStats.contained
 * - system.containerStats.container_id
 * - system.containerStats.container_name
 *
 * Container system.contained_items is maintained only as a compatibility
 * snapshot. Runtime reads derive contents from actor.items, matching DND5E's
 * pointer-derived container model while preserving UESRPG stored fields.
 */
import { confirmDialog, customDialog } from "../../../../utils/dialog-v2-helper.js";
import {
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
  requestUpdateDocument,
  requestUpdateEmbeddedDocuments,
} from "../../../../utils/authority-proxy.js";
import { resolveDroppedItem } from "../../../../utils/drop-data.js";
import { containerDebug, containerWarn } from "../../../../utils/dev/container-debug.js";

export const MAX_CONTAINER_DEPTH = 5;

const CLEAR_CONTAINER_STATS = Object.freeze({
  "system.containerStats.contained": false,
  "system.containerStats.container_id": "",
  "system.containerStats.container_name": "",
});

/**
 * Physical inventory item types that may be stored in containers.
 * @returns {Set<string>}
 */
export function getContainerAllowedTypes() {
  return new Set(["item", "equipment", "scroll", "weapon", "armor", "shield", "ammunition", "container"]);
}

export function isContainableItemType(type) {
  return getContainerAllowedTypes().has(String(type ?? ""));
}

function _getItemDataModelSchema(type) {
  try {
    const model = CONFIG?.Item?.dataModels?.[String(type ?? "")] ?? null;
    if (!model) return null;

    const schema = model.schema?.fields ?? model.schema ?? null;
    if (schema) return schema;

    return model.defineSchema?.() ?? null;
  } catch (_err) {
    return null;
  }
}

function _schemaHasContainerStats(schema) {
  return Boolean(schema?.containerStats ?? schema?.fields?.containerStats);
}

function _supportsContainmentState(item) {
  const type = String(item?.type ?? "");
  if (!isContainableItemType(type)) return false;
  if (Object.prototype.hasOwnProperty.call(item?.system ?? {}, "containerStats")) return true;
  return _schemaHasContainerStats(_getItemDataModelSchema(type));
}

function _warnUnsupportedContainmentState(item, action = "stored in containers") {
  const message = `${item?.type ?? "Unknown"} items cannot be ${action} because their Item system data model does not expose system.containerStats.`;
  containerWarn(message, {
    itemUuid: item?.uuid ?? null,
    itemId: _itemId(item),
    itemType: item?.type ?? null,
    systemKeys: Object.keys(item?.system ?? {}),
  });
  ui.notifications?.warn?.(message);
}

function _delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _itemId(item) {
  return String(item?.id ?? item?._id ?? "").trim();
}

function _getActorItems(actor) {
  return Array.from(actor?.items?.contents ?? actor?.items ?? []);
}

function _getContainerId(item) {
  return String(item?.system?.containerStats?.container_id ?? "").trim();
}

function _isContainedBy(item, containerId) {
  return _getContainerId(item) === String(containerId ?? "").trim();
}

function _hasContainerPointer(item) {
  return Boolean(_getContainerId(item));
}

function _getItemEnc(item) {
  const enc = Number(item?.system?.enc ?? 0);
  const qty = Number(item?.system?.quantity ?? 1);
  return (Number.isFinite(enc) ? enc : 0) * Math.max(1, Number.isFinite(qty) ? qty : 1);
}

function _resolveContainmentContext(sheetLike) {
  const document = sheetLike?.document ?? sheetLike?.item ?? null;
  const actor = sheetLike?.actor ?? document?.actor ?? null;
  const isEditable = sheetLike?.isEditable ?? false;
  if (!document || document.type !== "container" || !actor) return null;
  return { document, actor, isEditable };
}

function _buildSetContainerStatsUpdate(container, item) {
  const update = {
    "system.containerStats.contained": true,
    "system.containerStats.container_id": _itemId(container),
    "system.containerStats.container_name": container.name ?? "",
  };
  if (typeof item?.system?.equipped === "boolean") update["system.equipped"] = false;
  return update;
}

function _buildClearContainerStatsUpdate() {
  return { ...CLEAR_CONTAINER_STATS };
}

async function _updateOwnedItemContainment(actor, item, updateData) {
  const itemId = _itemId(item);
  if (!actor || !itemId || !updateData || typeof updateData !== "object") return false;
  return requestUpdateEmbeddedDocuments(actor, "Item", [{ _id: itemId, ...updateData }]);
}

async function _waitForLiveContainerPointer(actor, item, expectedContainerId, { attempts = 4, delayMs = 25 } = {}) {
  const itemId = _itemId(item);
  const expected = String(expectedContainerId ?? "").trim();
  let liveItem = itemId ? (actor?.items?.get?.(itemId) ?? item) : item;
  let liveContainerId = _getContainerId(liveItem);

  for (let i = 0; i < attempts; i += 1) {
    liveItem = itemId ? (actor?.items?.get?.(itemId) ?? liveItem ?? item) : (liveItem ?? item);
    liveContainerId = _getContainerId(liveItem);
    if (liveContainerId === expected) return { liveItem, liveContainerId };
    if (i < attempts - 1) await _delay(delayMs);
  }

  return { liveItem, liveContainerId };
}

function _warnContainmentFailure(message, details = {}) {
  containerWarn(message, {
    actorUuid: details.actor?.uuid ?? null,
    itemUuid: details.item?.uuid ?? null,
    itemId: _itemId(details.item),
    containerUuid: details.container?.uuid ?? null,
    containerId: _itemId(details.container),
    previousContainerId: details.previousContainerId ?? null,
    updateData: details.updateData ?? null,
    updateResult: details.updateResult ?? null,
    snapshotResult: details.snapshotResult ?? null,
    liveContainerStats: details.liveItem?.system?.containerStats ?? null,
  });
}

function _renderDocumentSheet(document) {
  try {
    const sheet = document?.sheet;
    const element = sheet?.element ?? null;
    const isOpen = sheet?.rendered === true || element?.isConnected === true;
    if (isOpen) sheet.render(true);
  } catch (err) {
    console.warn("UESRPG | Failed to rerender containment sheet", { uuid: document?.uuid ?? null, err });
  }
}

function _renderContainmentSheets(actor, containers = []) {
  const rendered = new Set();
  if (actor?.sheet) {
    try {
      if ("_uesrpgItemsCache" in actor.sheet) actor.sheet._uesrpgItemsCache = null;
      if ("_uesrpgEncumbranceCache" in actor.sheet) actor.sheet._uesrpgEncumbranceCache = null;
    } catch (_e) {
      /* no-op */
    }
  }
  const renderedContainers = [];
  for (const container of containers) {
    const id = _itemId(container);
    if (!id || rendered.has(`item:${id}`)) continue;
    rendered.add(`item:${id}`);
    renderedContainers.push(container?.uuid ?? id);
    _renderDocumentSheet(container);
  }
  _renderDocumentSheet(actor);
  containerDebug("containment.rerender", {
    actor: actor?.uuid ?? null,
    containers: renderedContainers,
  });
}

export function getContainedItems(actor, container, { direct = true } = {}) {
  if (!actor || !container) return [];
  const containerId = _itemId(container);
  if (!containerId) return [];

  const directChildren = _getActorItems(actor).filter((item) => _isContainedBy(item, containerId));
  if (direct) return directChildren;

  const out = [];
  const visited = new Set([containerId]);
  const walk = (parent) => {
    for (const child of getContainedItems(actor, parent, { direct: true })) {
      const id = _itemId(child);
      if (!id || visited.has(id)) continue;
      visited.add(id);
      out.push(child);
      if (child.type === "container") walk(child);
    }
  };
  walk(container);
  return out;
}

export function getItemTotalContainedEnc(item, actor, visited = new Set()) {
  if (!item) return 0;
  const id = _itemId(item);
  if (id && visited.has(id)) return 0;
  if (id) visited.add(id);

  let total = _getItemEnc(item);
  if (item.type === "container") {
    for (const child of getContainedItems(actor, item, { direct: true })) {
      total += getItemTotalContainedEnc(child, actor, visited);
    }
  }
  return total;
}

function _getSnapshotTotalEncAndDepth(itemData, visited = new Set()) {
  if (!itemData) return { enc: 0, depth: 0, count: 0 };
  const id = String(itemData?._id ?? itemData?.id ?? "").trim();
  if (id && visited.has(id)) return { enc: 0, depth: 0, count: 0 };
  if (id) visited.add(id);

  let enc = _getItemEnc(itemData);
  let depth = itemData?.type === "container" ? 1 : 0;
  let count = 1;

  if (itemData?.type === "container") {
    for (const entry of itemData?.system?.contained_items ?? []) {
      const totals = _getSnapshotTotalEncAndDepth(entry?.item ?? entry, visited);
      enc += totals.enc;
      count += totals.count;
      depth = Math.max(depth, 1 + totals.depth);
    }
  }
  return { enc, depth, count };
}

function _getDropItemTotalEnc(item, targetActor) {
  const actor = item?.actor ?? targetActor;
  const actorTotal = getItemTotalContainedEnc(item, actor);
  if (item?.type !== "container") return actorTotal;
  const snapshotTotal = _getSnapshotTotalEncAndDepth(item?.toObject?.() ?? item).enc;
  return Math.max(actorTotal, snapshotTotal);
}

export function getContainerContentsEnc(actor, container, { excludeItemId = "" } = {}) {
  const exclude = String(excludeItemId ?? "");
  return getContainedItems(actor, container, { direct: true })
    .filter((item) => _itemId(item) !== exclude)
    .reduce((sum, item) => sum + getItemTotalContainedEnc(item, actor), 0);
}

export function getContainerContentsCount(actor, container, visited = new Set()) {
  if (!actor || !container) return 0;
  const containerId = _itemId(container);
  if (!containerId || visited.has(containerId)) return 0;
  visited.add(containerId);

  let count = 0;
  for (const child of getContainedItems(actor, container, { direct: true })) {
    count += 1;
    if (child.type === "container") count += getContainerContentsCount(actor, child, visited);
  }
  return count;
}

function _getContainerAncestors(actor, item) {
  const ancestors = [];
  const visited = new Set([_itemId(item)]);
  let current = item;

  for (let i = 0; i < MAX_CONTAINER_DEPTH + 2; i += 1) {
    const parentId = _getContainerId(current);
    if (!parentId || visited.has(parentId)) break;
    const parent = actor?.items?.get?.(parentId) ?? null;
    if (!parent || parent.type !== "container") break;
    ancestors.push(parent);
    visited.add(parentId);
    current = parent;
  }

  return ancestors;
}

function _getContainerDepth(actor, container) {
  if (!container || container.type !== "container") return 0;
  return 1 + _getContainerAncestors(actor, container).length;
}

function _getContainerSubtreeDepth(actor, container, visited = new Set()) {
  if (!container || container.type !== "container") return 0;
  const id = _itemId(container);
  if (id && visited.has(id)) return 0;
  if (id) visited.add(id);

  let depth = 1;
  for (const child of getContainedItems(actor, container, { direct: true })) {
    if (child.type !== "container") continue;
    depth = Math.max(depth, 1 + _getContainerSubtreeDepth(actor, child, visited));
  }
  return depth;
}

function _validateContainerNesting(actor, droppedItem, targetContainer, { notify = true, subtreeDepth = null } = {}) {
  if (!droppedItem || droppedItem.type !== "container") return true;

  if (_itemId(droppedItem) === _itemId(targetContainer)) {
    if (notify) ui.notifications?.warn?.("A container cannot contain itself.");
    return false;
  }

  const targetAncestors = _getContainerAncestors(actor, targetContainer);
  if (targetAncestors.some((ancestor) => _itemId(ancestor) === _itemId(droppedItem))) {
    if (notify) ui.notifications?.warn?.("A container cannot be placed inside one of its own contents.");
    return false;
  }

  const sourceDepth = subtreeDepth ?? _getContainerSubtreeDepth(actor, droppedItem);
  if ((_getContainerDepth(actor, targetContainer) + sourceDepth) > MAX_CONTAINER_DEPTH) {
    if (notify) ui.notifications?.warn?.(`Containers can only be nested ${MAX_CONTAINER_DEPTH} levels deep.`);
    return false;
  }

  return true;
}

function _buildContainedSnapshot(actor, item, visited = new Set()) {
  const data = item?.toObject?.() ?? foundry.utils.deepClone(item ?? {});
  const id = String(data?._id ?? data?.id ?? "").trim();
  if (id && visited.has(id)) return data;
  if (id) visited.add(id);

  if (data.type === "container") {
    data.system = data.system ?? {};
    data.system.contained_items = getContainedItems(actor, item, { direct: true }).map((child) => ({
      _id: _itemId(child),
      item: _buildContainedSnapshot(actor, child, new Set(visited)),
    }));
  }

  return data;
}

export function buildContainerContainedItemsSnapshot(actor, container) {
  const snapshot = getContainedItems(actor, container, { direct: true }).map((item) => ({
    _id: _itemId(item),
    item: _buildContainedSnapshot(actor, item),
  }));
  containerDebug("snapshot.derive", {
    actor: actor?.uuid ?? null,
    container: container?.uuid ?? null,
    containerId: _itemId(container),
    count: snapshot.length,
    itemIds: snapshot.map((entry) => entry._id),
  });
  return snapshot;
}

function _sameContainedSnapshot(current, next) {
  const currentIds = (Array.isArray(current) ? current : []).map((entry) => String(entry?._id ?? ""));
  const nextIds = next.map((entry) => String(entry?._id ?? ""));
  if (currentIds.length !== nextIds.length) return false;
  for (let i = 0; i < currentIds.length; i += 1) {
    if (currentIds[i] !== nextIds[i]) return false;
  }
  return JSON.stringify(current ?? []) === JSON.stringify(next ?? []);
}

export async function rebuildContainerSnapshot(actor, container) {
  if (!actor || !container || container.type !== "container") return false;
  const next = buildContainerContainedItemsSnapshot(actor, container);
  const current = Array.isArray(container.system?.contained_items) ? container.system.contained_items : [];
  if (_sameContainedSnapshot(current, next)) return true;
  const updateResult = await requestUpdateDocument(container, { "system.contained_items": next });
  containerDebug("snapshot.rebuild", {
    actor: actor?.uuid ?? null,
    container: container?.uuid ?? null,
    containerId: _itemId(container),
    previousCount: current.length,
    nextCount: next.length,
    updateResult,
  });
  if (!updateResult) {
    _warnContainmentFailure("Container snapshot rebuild failed", {
      actor,
      container,
      updateData: { "system.contained_items": next },
      updateResult,
    });
  }
  return updateResult;
}

export async function rebuildAffectedContainerSnapshots(actor, containers = []) {
  const ids = new Set(containers.map((container) => _itemId(container)).filter(Boolean));
  for (const container of containers) {
    for (const ancestor of _getContainerAncestors(actor, container)) ids.add(_itemId(ancestor));
  }

  let ok = true;
  for (const id of ids) {
    const container = actor?.items?.get?.(id);
    if (container?.type === "container") ok = (await rebuildContainerSnapshot(actor, container)) && ok;
  }
  return ok;
}

export async function repairContainerContainedItems(sheetOrContext) {
  const ctx = _resolveContainmentContext(sheetOrContext);
  if (!ctx) return false;
  return rebuildContainerSnapshot(ctx.actor, ctx.document);
}

export function canModifyContainment(sheetLike) {
  const ctx = _resolveContainmentContext(sheetLike);
  return !!(ctx?.isEditable && ctx.document?.isOwned && ctx.actor?.isOwner);
}

async function _placeOwnedItemInContainer(actor, item, container) {
  const previousContainer = actor?.items?.get?.(_getContainerId(item));
  const updateData = _buildSetContainerStatsUpdate(container, item);
  containerDebug("drop.update.request", {
    actor: actor?.uuid ?? null,
    item: item?.uuid ?? null,
    itemId: _itemId(item),
    container: container?.uuid ?? null,
    containerId: _itemId(container),
    previousContainerId: _getContainerId(item),
    updateData,
  });
  if (!_supportsContainmentState(item)) {
    _warnUnsupportedContainmentState(item);
    return false;
  }

  const updateResult = await _updateOwnedItemContainment(actor, item, updateData);
  const { liveItem, liveContainerId } = await _waitForLiveContainerPointer(actor, item, _itemId(container));
  containerDebug("drop.update.result", {
    actor: actor?.uuid ?? null,
    item: liveItem?.uuid ?? item?.uuid ?? null,
    itemId: _itemId(liveItem ?? item),
    container: container?.uuid ?? null,
    intendedContainerId: _itemId(container),
    liveContainerId,
    updateResult,
    liveContainerStats: liveItem?.system?.containerStats ?? null,
  });
  if (!updateResult) {
    _warnContainmentFailure("Container item update failed", {
      actor,
      item,
      container,
      updateData,
      updateResult,
      previousContainerId: _itemId(previousContainer),
      liveItem,
    });
    return false;
  }
  if (liveContainerId !== _itemId(container)) {
    _warnContainmentFailure("Container item update did not persist expected pointer", {
      actor,
      item,
      container,
      updateData,
      updateResult,
      previousContainerId: _itemId(previousContainer),
      liveItem,
    });
    return false;
  }

  const affected = [container, previousContainer].filter(Boolean);
  const snapshotResult = await rebuildAffectedContainerSnapshots(actor, affected);
  if (!snapshotResult) {
    _warnContainmentFailure("Container snapshot update failed after item placement", {
      actor,
      item,
      container,
      updateData,
      updateResult,
      snapshotResult,
      previousContainerId: _itemId(previousContainer),
      liveItem,
    });
  }
  _renderContainmentSheets(actor, affected);
  return true;
}

export async function removeItemFromContainer(actor, item) {
  if (!actor || !item) return false;
  const previousContainer = actor.items?.get?.(_getContainerId(item)) ?? null;
  if (!previousContainer && !_getContainerId(item)) return false;

  containerDebug("remove.update.request", {
    actor: actor?.uuid ?? null,
    item: item?.uuid ?? null,
    itemId: _itemId(item),
    previousContainerId: _getContainerId(item),
  });
  if (!_supportsContainmentState(item)) {
    _warnUnsupportedContainmentState(item, "removed from containers");
    return false;
  }

  const updated = await _updateOwnedItemContainment(actor, item, _buildClearContainerStatsUpdate());
  const { liveItem } = await _waitForLiveContainerPointer(actor, item, "");
  const affected = [previousContainer, item].filter(Boolean);
  const snapshotResult = await rebuildAffectedContainerSnapshots(actor, affected);
  if (!updated) {
    _warnContainmentFailure("Container item removal update failed", {
      actor,
      item,
      container: previousContainer,
      updateData: _buildClearContainerStatsUpdate(),
      updateResult: updated,
      previousContainerId: _itemId(previousContainer),
      liveItem,
    });
    return false;
  }
  if (!snapshotResult) {
    _warnContainmentFailure("Container snapshot update failed after item removal", {
      actor,
      item,
      container: previousContainer,
      snapshotResult,
    });
  }
  _renderContainmentSheets(actor, affected);
  return updated;
}

export async function clearAllItemsFromContainer(actor, container) {
  if (!actor || !container || container.type !== "container") return false;
  const children = getContainedItems(actor, container, { direct: false });
  if (!children.length) {
    await rebuildContainerSnapshot(actor, container);
    _renderContainmentSheets(actor, [container]);
    return false;
  }

  const updates = children.map((item) => ({ _id: _itemId(item), ..._buildClearContainerStatsUpdate() }));
  const updateResult = await requestUpdateEmbeddedDocuments(actor, "Item", updates);
  if (!updateResult) {
    _warnContainmentFailure("Container bulk clear update failed", {
      actor,
      container,
      updateData: updates,
      updateResult,
    });
    return false;
  }
  const affected = [container, ...children.filter((item) => item.type === "container")];
  const snapshotResult = await rebuildAffectedContainerSnapshots(actor, affected);
  if (!snapshotResult) {
    _warnContainmentFailure("Container snapshot update failed after bulk clear", {
      actor,
      container,
      snapshotResult,
    });
  }
  _renderContainmentSheets(actor, affected);
  return true;
}

export async function onDropItemIntoContainer(sheetLike, dropData) {
  const ctx = _resolveContainmentContext(sheetLike);
  if (!ctx) return;
  containerDebug("drop.received", {
    container: ctx.document?.uuid ?? null,
    containerId: _itemId(ctx.document),
    actor: ctx.actor?.uuid ?? null,
    dropData,
  });
  if (!canModifyContainment(ctx)) {
    ui.notifications?.warn?.("You do not have permission to modify this container.");
    return;
  }

  let droppedItem = await resolveDroppedItem(dropData);
  if (!droppedItem) {
    ui.notifications?.warn?.("Could not find the dropped item.");
    return;
  }

  if (!isContainableItemType(droppedItem.type)) {
    ui.notifications?.warn?.(`${droppedItem.type} items cannot be stored in containers.`);
    return;
  }

  if (!_supportsContainmentState(droppedItem)) {
    _warnUnsupportedContainmentState(droppedItem);
    return;
  }

  const targetContainer = ctx.document;
  const targetActor = ctx.actor;
  const isExternal = droppedItem.actor?.id !== targetActor.id;
  const alreadyInTarget = !isExternal && _isContainedBy(droppedItem, _itemId(targetContainer));
  containerDebug("drop.target.resolved", {
    actor: targetActor?.uuid ?? null,
    container: targetContainer?.uuid ?? null,
    droppedItem: droppedItem?.uuid ?? null,
    droppedItemId: _itemId(droppedItem),
    droppedItemType: droppedItem?.type ?? null,
    isExternal,
    alreadyInTarget,
    hasContainerPointer: _hasContainerPointer(droppedItem),
  });

  const sourceDepth = droppedItem.type === "container"
    ? Math.max(
        _getContainerSubtreeDepth(droppedItem.actor ?? targetActor, droppedItem),
        _getSnapshotTotalEncAndDepth(droppedItem.toObject?.() ?? droppedItem).depth
      )
    : 0;
  if (!_validateContainerNesting(targetActor, droppedItem, targetContainer, { subtreeDepth: sourceDepth })) return;

  const maxEnc = Number(targetContainer.system?.container_enc?.max ?? 0);
  const currentEnc = getContainerContentsEnc(targetActor, targetContainer, {
    excludeItemId: alreadyInTarget ? _itemId(droppedItem) : "",
  });
  const itemEnc = _getDropItemTotalEnc(droppedItem, targetActor);
  if (maxEnc > 0 && (currentEnc + itemEnc) > maxEnc) {
    ui.notifications?.warn?.(
      `Item ENC (${itemEnc}) exceeds remaining container capacity (${Math.max(maxEnc - currentEnc, 0)}). Item was not added.`
    );
    return;
  }

  if (isExternal) {
    const itemData = droppedItem.toObject();
    delete itemData._id;
    itemData.system = itemData.system ?? {};
    itemData.system.containerStats = {
      ...(itemData.system.containerStats ?? {}),
      contained: false,
      container_id: "",
      container_name: "",
    };
    const created = await requestCreateEmbeddedDocuments(targetActor, "Item", [itemData]);
    droppedItem = created?.[0] ?? null;
    const liveCreated = droppedItem ? targetActor.items?.get?.(_itemId(droppedItem)) : null;
    containerDebug("drop.external.created", {
      actor: targetActor?.uuid ?? null,
      sourceItem: itemData?.name ?? null,
      createdItem: droppedItem?.uuid ?? null,
      createdItemId: _itemId(droppedItem),
      liveCreated: liveCreated?.uuid ?? null,
    });
    if (!droppedItem || !liveCreated) {
      ui.notifications?.error?.("Failed to create item copy.");
      return;
    }
    droppedItem = liveCreated;
  }

  const placed = await _placeOwnedItemInContainer(targetActor, droppedItem, targetContainer);
  if (!placed) {
    ui.notifications?.warn?.("Item was not added to the container. Check console diagnostics.");
    return;
  }
  ui.notifications?.info?.(`${droppedItem.name} added to ${targetContainer.name}.`);
}

export async function onBulkAddToContainer(sheetLike) {
  const ctx = _resolveContainmentContext(sheetLike);
  if (!ctx || !canModifyContainment(ctx)) {
    ui.notifications?.warn?.("You do not have permission to modify this container.");
    return;
  }

  const maxEnc = Number(ctx.document.system?.container_enc?.max ?? 0);
  const eligible = [];
  let projectedEnc = getContainerContentsEnc(ctx.actor, ctx.document);

  for (const item of _getActorItems(ctx.actor)) {
    if (!item || _itemId(item) === _itemId(ctx.document)) continue;
    if (!isContainableItemType(item.type)) continue;
    if (!_supportsContainmentState(item)) continue;
    if (_isContainedBy(item, _itemId(ctx.document))) continue;
    if (!_validateContainerNesting(ctx.actor, item, ctx.document, { notify: false })) continue;

    const itemEnc = getItemTotalContainedEnc(item, ctx.actor);
    if (maxEnc > 0 && (projectedEnc + itemEnc) > maxEnc) continue;

    eligible.push(item);
    projectedEnc += itemEnc;
  }

  if (!eligible.length) {
    ui.notifications?.info?.("No eligible items to add.");
    return;
  }

  const confirmed = await confirmDialog({
    title: `Add All Items to ${ctx.document.name}`,
    content: `<p>Add <strong>${eligible.length}</strong> eligible items to this container?</p>`,
  });
  if (!confirmed) return;

  const updates = eligible.map((item) => ({
    _id: _itemId(item),
    ..._buildSetContainerStatsUpdate(ctx.document, item),
  }));
  const updateResult = await requestUpdateEmbeddedDocuments(ctx.actor, "Item", updates);
  if (!updateResult) {
    _warnContainmentFailure("Container bulk add update failed", {
      actor: ctx.actor,
      container: ctx.document,
      updateData: updates,
      updateResult,
    });
    ui.notifications?.warn?.("Items were not added to the container. Check console diagnostics.");
    return;
  }
  const affected = [ctx.document, ...eligible.filter((item) => item.type === "container")];
  const snapshotResult = await rebuildAffectedContainerSnapshots(ctx.actor, affected);
  if (!snapshotResult) {
    _warnContainmentFailure("Container snapshot update failed after bulk add", {
      actor: ctx.actor,
      container: ctx.document,
      snapshotResult,
    });
  }
  _renderContainmentSheets(ctx.actor, affected);
  ui.notifications?.info?.(`Added ${eligible.length} items to ${ctx.document.name}.`);
}

export async function onBulkRemoveFromContainer(sheetLike) {
  const ctx = _resolveContainmentContext(sheetLike);
  if (!ctx || !canModifyContainment(ctx)) {
    ui.notifications?.warn?.("You do not have permission to modify container contents.");
    return;
  }

  const directChildren = getContainedItems(ctx.actor, ctx.document, { direct: true });
  if (!directChildren.length) {
    ui.notifications?.info?.("Container is already empty.");
    return;
  }

  const confirmed = await confirmDialog({
    title: `Remove All Items from ${ctx.document.name}`,
    content: `<p>Remove <strong>${directChildren.length}</strong> items from this container? Items will not be deleted.</p>`,
  });
  if (!confirmed) return;

  const updates = directChildren.map((item) => ({ _id: _itemId(item), ..._buildClearContainerStatsUpdate() }));
  const updateResult = await requestUpdateEmbeddedDocuments(ctx.actor, "Item", updates);
  if (!updateResult) {
    _warnContainmentFailure("Container bulk remove update failed", {
      actor: ctx.actor,
      container: ctx.document,
      updateData: updates,
      updateResult,
    });
    ui.notifications?.warn?.("Items were not removed from the container. Check console diagnostics.");
    return;
  }
  const affected = [ctx.document, ...directChildren.filter((item) => item.type === "container")];
  const snapshotResult = await rebuildAffectedContainerSnapshots(ctx.actor, affected);
  if (!snapshotResult) {
    _warnContainmentFailure("Container snapshot update failed after bulk remove", {
      actor: ctx.actor,
      container: ctx.document,
      snapshotResult,
    });
  }
  _renderContainmentSheets(ctx.actor, affected);
  ui.notifications?.info?.(`Removed ${directChildren.length} items from ${ctx.document.name}.`);
}

export async function onBulkDeleteContained(sheetLike) {
  const ctx = _resolveContainmentContext(sheetLike);
  if (!ctx || !canModifyContainment(ctx)) {
    ui.notifications?.warn?.("You do not have permission to modify container contents.");
    return;
  }

  const children = getContainedItems(ctx.actor, ctx.document, { direct: false });
  if (!children.length) {
    ui.notifications?.info?.("Container is already empty.");
    return;
  }

  const confirmed = await confirmDialog({
    title: `Delete All Items in ${ctx.document.name}`,
    content: `<p><strong>WARNING:</strong> Permanently delete <strong>${children.length}</strong> items? This cannot be undone.</p>`,
  });
  if (!confirmed) return;

  const ids = children.map(_itemId).filter(Boolean);
  const updateResult = await requestDeleteEmbeddedDocuments(ctx.actor, "Item", ids);
  if (!updateResult) {
    _warnContainmentFailure("Container bulk delete failed", {
      actor: ctx.actor,
      container: ctx.document,
      updateData: ids,
      updateResult,
    });
    ui.notifications?.warn?.("Items were not deleted from the container. Check console diagnostics.");
    return;
  }
  const snapshotResult = await rebuildContainerSnapshot(ctx.actor, ctx.document);
  if (!snapshotResult) {
    _warnContainmentFailure("Container snapshot update failed after bulk delete", {
      actor: ctx.actor,
      container: ctx.document,
      snapshotResult,
    });
  }
  _renderContainmentSheets(ctx.actor, [ctx.document]);
  ui.notifications?.info?.(`Deleted ${ids.length} items from ${ctx.document.name}.`);
}

export async function createContainerListDialog(sheetLike, bagListItems, tooLarge) {
  const ctx = _resolveContainmentContext(sheetLike);
  if (!ctx) return;

  const tableEntries = bagListItems.map((bagItem) => {
    const isInThisContainer = _isContainedBy(bagItem, _itemId(ctx.document));
    const img = bagItem?.img || CONST.DEFAULT_TOKEN;
    const qty = bagItem?.system?.quantity ?? 0;
    const enc = bagItem?.system?.enc ?? 0;
    const safeName = foundry.utils.escapeHTML(bagItem.name);
    const safeType = foundry.utils.escapeHTML(bagItem.type);
    return `<tr data-item-id="${bagItem.id}">
      <td class="uesrpg-container-picker__name" data-item-id="${bagItem.id}">
        <img class="item-img" src="${img}" height="24" width="24">
        ${_getContainerId(bagItem) ? '<i class="fa-solid fa-backpack"></i>' : ""}
        ${safeName}
      </td>
      <td class="uesrpg-container-picker__cell">${safeType}</td>
      <td class="uesrpg-container-picker__cell">${qty}</td>
      <td class="uesrpg-container-picker__cell">${enc}</td>
      <td class="uesrpg-container-picker__cell">
        <input type="checkbox" class="itemSelect container-select" data-item-id="${bagItem.id}" ${isInThisContainer ? "checked" : ""}>
      </td>
    </tr>`;
  });

  const safeContainerName = foundry.utils.escapeHTML(ctx.document.name);
  const content = `<div class="uesrpg-container-picker">
      <div class="uesrpg-container-picker__intro">
        <label>Select items to add to <strong>${safeContainerName}</strong>.</label>
        ${tooLarge ? `<div class="uesrpg-container-picker__oversize-note">Some items are hidden because their ENC exceeds remaining container capacity.</div>` : ""}
      </div>
      <div class="uesrpg-container-picker__table-wrap">
        <table class="uesrpg-container-picker__table">
          <thead>
            <tr><th>Name</th><th>TYPE</th><th>QTY</th><th>ENC</th><th>Add</th></tr>
          </thead>
          <tbody>${tableEntries.join("")}</tbody>
        </table>
      </div>
    </div>`;

  await customDialog({
    title: `Add Items to ${ctx.document.name}`,
    content,
    classes: ["uesrpg-container-picker-dialog"],
    width: 760,
    yes: {
      label: "Apply",
      callback: async (html) => {
        if (!canModifyContainment(ctx)) {
          ui.notifications?.warn?.("You do not have permission to modify container contents.");
          return;
        }

        const root = html instanceof HTMLElement ? html : html?.[0] ?? document;
        const updates = [];
        const affectedContainers = [ctx.document];
        const maxEnc = Number(ctx.document.system?.container_enc?.max ?? 0);
        let projectedEnc = getContainerContentsEnc(ctx.actor, ctx.document);
        let skippedForCapacity = 0;

        for (const input of root.querySelectorAll(".itemSelect")) {
          const item = ctx.actor.items.get(input?.dataset?.itemId);
          if (!item || !isContainableItemType(item.type)) continue;
          if (!_supportsContainmentState(item)) continue;
          if (!_validateContainerNesting(ctx.actor, item, ctx.document)) continue;

          const isInThis = _isContainedBy(item, _itemId(ctx.document));
          if (input.checked && !isInThis) {
            const itemEnc = getItemTotalContainedEnc(item, ctx.actor);
            if (maxEnc > 0 && (projectedEnc + itemEnc) > maxEnc) {
              skippedForCapacity += 1;
              continue;
            }
            const previous = ctx.actor.items.get(_getContainerId(item));
            if (previous) affectedContainers.push(previous);
            updates.push({ _id: _itemId(item), ..._buildSetContainerStatsUpdate(ctx.document, item) });
            projectedEnc += itemEnc;
          } else if (!input.checked && isInThis) {
            updates.push({ _id: _itemId(item), ..._buildClearContainerStatsUpdate() });
          }

          if (item.type === "container") affectedContainers.push(item);
        }

        let updateResult = true;
        if (updates.length) updateResult = await requestUpdateEmbeddedDocuments(ctx.actor, "Item", updates);
        if (!updateResult) {
          _warnContainmentFailure("Container picker update failed", {
            actor: ctx.actor,
            container: ctx.document,
            updateData: updates,
            updateResult,
          });
          ui.notifications?.warn?.("Container contents were not updated. Check console diagnostics.");
          return;
        }
        const snapshotResult = await rebuildAffectedContainerSnapshots(ctx.actor, affectedContainers);
        if (!snapshotResult) {
          _warnContainmentFailure("Container snapshot update failed after picker changes", {
            actor: ctx.actor,
            container: ctx.document,
            snapshotResult,
          });
        }
        _renderContainmentSheets(ctx.actor, affectedContainers);
        if (skippedForCapacity) ui.notifications?.warn?.(`${skippedForCapacity} item(s) were not added because they exceed container capacity.`);
      },
    },
    no: { label: "Cancel" },
    defaultButton: "yes",
  });
}

export function onAddToContainer(sheetLike) {
  const ctx = _resolveContainmentContext(sheetLike);
  if (!ctx || !canModifyContainment(ctx)) {
    ui.notifications?.warn?.("Containers must be owned by an Actor and you must have permission to modify them.");
    return;
  }

  const maxEnc = Number(ctx.document.system?.container_enc?.max ?? 0);
  const bagListItems = [];
  let tooLarge = false;

  for (const item of _getActorItems(ctx.actor)) {
    if (!item || _itemId(item) === _itemId(ctx.document)) continue;
    if (!isContainableItemType(item.type)) continue;
    if (!_supportsContainmentState(item)) continue;
    if (!_validateContainerNesting(ctx.actor, item, ctx.document, { notify: false }) && !_isContainedBy(item, _itemId(ctx.document))) continue;

    if (_isContainedBy(item, _itemId(ctx.document))) {
      bagListItems.push(item);
      continue;
    }

    const currentEnc = getContainerContentsEnc(ctx.actor, ctx.document);
    const itemEnc = getItemTotalContainedEnc(item, ctx.actor);
    if (maxEnc > 0 && (currentEnc + itemEnc) > maxEnc) {
      tooLarge = true;
      continue;
    }

    bagListItems.push(item);
  }

  createContainerListDialog(ctx, bagListItems, tooLarge);
}

export async function onOpenContainedItem(sheetLike, target) {
  const ctx = _resolveContainmentContext(sheetLike);
  if (!ctx) {
    ui.notifications?.info?.("Containers must be on Actor Sheets in order to open the contents.");
    return;
  }

  const itemId = target?.closest?.(".item")?.dataset?.itemId;
  const item = itemId ? ctx.actor.items.get(itemId) : null;
  item?.sheet?.render?.(true);
}

export async function onRemoveContainedItem(sheetLike, target) {
  const ctx = _resolveContainmentContext(sheetLike);
  if (!ctx || !canModifyContainment(ctx)) {
    ui.notifications?.warn?.("You do not have permission to modify container contents.");
    return;
  }

  const itemId = target?.closest?.(".item")?.dataset?.itemId;
  const item = itemId ? ctx.actor.items.get(itemId) : null;
  if (!item) return;
  await removeItemFromContainer(ctx.actor, item);
}

export async function onDeleteContainedItem(sheetLike, target) {
  const ctx = _resolveContainmentContext(sheetLike);
  if (!ctx || !canModifyContainment(ctx)) {
    ui.notifications?.warn?.("You do not have permission to modify container contents.");
    return;
  }

  const itemId = target?.closest?.(".item")?.dataset?.itemId;
  const item = itemId ? ctx.actor.items.get(itemId) : null;
  if (!item) return;

  const confirmed = await confirmDialog({
    title: "Delete Item",
    content: `<p>Delete <strong>${foundry.utils.escapeHTML(item.name ?? "this item")}</strong>? This cannot be undone.</p>`,
  });
  if (!confirmed) return;

  const contained = item.type === "container" ? getContainedItems(ctx.actor, item, { direct: false }).map(_itemId) : [];
  const ids = [_itemId(item), ...contained].filter(Boolean);
  const updateResult = await requestDeleteEmbeddedDocuments(ctx.actor, "Item", ids);
  if (!updateResult) {
    _warnContainmentFailure("Contained item delete failed", {
      actor: ctx.actor,
      item,
      container: ctx.document,
      updateData: ids,
      updateResult,
    });
    ui.notifications?.warn?.("Item was not deleted. Check console diagnostics.");
    return;
  }
  const snapshotResult = await rebuildContainerSnapshot(ctx.actor, ctx.document);
  if (!snapshotResult) {
    _warnContainmentFailure("Container snapshot update failed after contained item delete", {
      actor: ctx.actor,
      item,
      container: ctx.document,
      snapshotResult,
    });
  }
  _renderContainmentSheets(ctx.actor, [ctx.document]);
}
