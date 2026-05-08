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
  rebuildContainerSnapshot,
} from "./item/listeners/containment.js";

export async function unlinkItemFromContainer(actor, item) {
  await removeItemFromContainer(actor, item);
}

export async function unlinkAllItemsFromContainer(actor, container) {
  if (!actor || !container || container.type !== "container") return;
  await clearAllItemsFromContainer(actor, container);
  await rebuildContainerSnapshot(actor, container);
}
