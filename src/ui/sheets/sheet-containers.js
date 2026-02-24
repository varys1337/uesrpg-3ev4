/**
 * Shared container helpers for ActorSheet inventory workflows.
 * Shared across actor sheet modules.
 *
 * These helpers are intentionally narrow: they only manipulate the existing
 * containerStats + contained_items structures without introducing new schema.
 */

import { requestUpdateDocument, requestUpdateEmbeddedDocuments } from "../../utils/authority-proxy.js";

const CONTAINER_ALLOWED_TYPES = new Set(["item", "scroll", "weapon", "armor", "ammunition"]);

/**
 * Determine whether an Item is eligible to be treated as a physical inventory object for containment.
 * This is tolerant of legacy items missing system.isPhysicalObject.
 *
 * @param {Item} item
 * @returns {boolean}
 */
function isContainableInventoryItem(item) {
  if (!item) return false;
  if (item.type === "container") return false;
  return CONTAINER_ALLOWED_TYPES.has(item.type);
}

/**
 * Build a consistent "clear containerStats" update payload.
 * @returns {object}
 */
function buildClearContainerStatsUpdate() {
  return {
    "system.containerStats.contained": false,
    "system.containerStats.container_id": "",
    "system.containerStats.container_name": ""
  };
}

/**
 * Remove an embedded item from its current container (if any), without deleting the item.
 * Also updates the container's contained_items list immutably.
 *
 * @param {Actor} actor
 * @param {Item} item
 */
export async function unlinkItemFromContainer(actor, item) {
  if (!actor || !item) return;

  const cs = item.system?.containerStats;
  const isContained = !!cs?.contained;
  const containerId = cs?.container_id || "";
  if (!isContained || !containerId) return;

  const container = actor.items.get(containerId);
  if (container && Array.isArray(container.system?.contained_items)) {
    const nextContained = container.system.contained_items.filter((ci) => ci?._id !== item.id);
    await requestUpdateDocument(container, { "system.contained_items": nextContained });
  }

  await requestUpdateDocument(item, buildClearContainerStatsUpdate());
}

/**
 * Unlink all items referenced by a container's contained_items list.
 * Does not delete items; caller is expected to delete the container afterwards if desired.
 *
 * This tolerates legacy items missing isPhysicalObject/containerStats by applying a clear update anyway.
 *
 * @param {Actor} actor
 * @param {Item} container
 */
export async function unlinkAllItemsFromContainer(actor, container) {
  if (!actor || !container) return;
  if (container.type !== "container") return;

  const contained = Array.isArray(container.system?.contained_items) ? container.system.contained_items : [];
  if (!contained.length) {
    // Defensive cleanup for malformed data
    if (Array.isArray(container.system?.contained_items)) {
      await requestUpdateDocument(container, { "system.contained_items": [] });
    }
    return;
  }

  const updates = [];
  for (const entry of contained) {
    const id = entry?._id;
    if (!id) continue;
    const source = actor.items.get(id);
    if (!source) continue;

    updates.push({ _id: source.id, ...buildClearContainerStatsUpdate() });
  }

  if (updates.length) {
    await requestUpdateEmbeddedDocuments(actor, "Item", updates);
  }

  await requestUpdateDocument(container, { "system.contained_items": [] });
}
