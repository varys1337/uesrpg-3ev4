/**
 * Shared container helpers for ActorSheet inventory workflows.
 *
 * These are thin compatibility wrappers around the canonical containment
 * service. They intentionally derive children from actor-owned item pointers,
 * not from container.system.contained_items snapshots.
 */

import {
  clearAllItemsFromContainer,
  removeItemFromContainer,
} from "./item/listeners/containment.js";

export async function unlinkItemFromContainer(actor, item) {
  return removeItemFromContainer(actor, item);
}

export async function unlinkAllItemsFromContainer(actor, container) {
  if (!actor || !container || container.type !== "container") return false;
  if (!await clearAllItemsFromContainer(actor, container)) return false;
  return removeItemFromContainer(actor, container);
}
