import { PHYSICAL_ITEM_TYPES, getInventoryRules, getPhysicalItemQuantity, getPhysicalItemUnitEnc } from "./inventory-encumbrance.js";

const itemId = item => String(item?.id ?? item?._id ?? "").trim();
const allItems = actor => Array.from(actor?.items?.contents ?? actor?.items ?? []);
export const MAX_CONTAINER_DEPTH = 5;

/** Raw carried contents, before the container's ENC reduction. Cycles count once. */
export function getInventorySubtreeTotals(item, inventory, visited = new Set()) {
  if (!PHYSICAL_ITEM_TYPES.includes(item?.type) || item?.system?.isPhysicalObject === false) {
    return { enc: 0, quantity: 0, count: 0, zeroCount: 0, depth: 0 };
  }
  const id = itemId(item);
  if (id && visited.has(id)) return { enc: 0, quantity: 0, count: 0, zeroCount: 0, depth: 0 };
  if (id) visited.add(id);
  const quantity = getPhysicalItemQuantity(item);
  const unitEnc = getPhysicalItemUnitEnc(item);
  const total = { enc: unitEnc * quantity, quantity, count: 1, zeroCount: unitEnc === 0 ? quantity : 0, depth: 0 };
  if (item?.type === "container" && id) {
    for (const child of inventory) {
      if (String(child?.system?.containerStats?.container_id ?? "").trim() !== id) continue;
      const nested = getInventorySubtreeTotals(child, inventory, visited);
      if (!nested.count) continue;
      total.enc += nested.enc;
      total.quantity += nested.quantity;
      total.count += nested.count;
      total.zeroCount += nested.zeroCount;
      total.depth = Math.max(total.depth, nested.depth + 1);
    }
  }
  return total;
}

export function getContainerInventoryTotals(actor, container, { excludeItemId = "", additionalItems = [] } = {}) {
  const inventory = allItems(actor);
  const id = itemId(container);
  const contents = id ? inventory.filter(item => itemId(item) !== excludeItemId
    && String(item?.system?.containerStats?.container_id ?? "").trim() === id) : [];
  const additions = additionalItems.filter(item => !contents.some(existing => itemId(existing) && itemId(existing) === itemId(item)));
  const visited = new Set(id ? [id] : []);
  const total = { enc: 0, quantity: 0, count: 0, zeroCount: 0 };
  for (const item of [...contents, ...additions]) {
    const nested = getInventorySubtreeTotals(item, inventory, visited);
    for (const key of Object.keys(total)) total[key] += nested[key];
  }
  total.enc += Math.floor(total.zeroCount / 10);
  return total;
}

/** Shared document-derived capacity view for inventory rows and ItemSheetV2. */
export function getContainerCapacityState(actor, container) {
  const capacity = getInventoryRules(container).capacity ?? {};
  const rawQuantity = capacity.maxQuantity;
  const quantityLimit = rawQuantity == null || rawQuantity === "" ? NaN : Number(rawQuantity);
  const encLimit = Number(container?.system?.container_enc?.max ?? 0);
  return { ...getContainerInventoryTotals(actor, container),
    maxEnc: Number.isFinite(encLimit) ? Math.max(0, encLimit) : 0,
    hasEncLimit: Number.isFinite(encLimit) && encLimit > 0,
    maxQuantity: Number.isFinite(quantityLimit) ? Math.max(0, Math.trunc(quantityLimit)) : 0,
    hasQuantityLimit: Number.isFinite(quantityLimit) && quantityLimit >= 0,
    ammunitionOnly: Array.isArray(capacity.itemTypes) && capacity.itemTypes.length === 1 && capacity.itemTypes[0] === "ammunition" };
}

/** One capacity policy for drops, pickers, quantity edits, and prepared display. */
export function getContainerCapacityIssue(actor, container, item, { additionalItems = [] } = {}) {
  if (!PHYSICAL_ITEM_TYPES.includes(item?.type) || item?.system?.isPhysicalObject === false) return "Only physical inventory items can be placed in a container.";
  if (getInventoryRules(item).portable === false) return "This tool set is not portable and cannot be placed in carried inventory.";
  const capacity = getInventoryRules(container).capacity ?? {};
  if (Array.isArray(capacity.itemTypes) && !capacity.itemTypes.includes(item?.type)) {
    return "This container only holds " + capacity.itemTypes.join(", ") + ".";
  }
  const totals = getContainerInventoryTotals(actor, container, {
    excludeItemId: itemId(item), additionalItems: [...additionalItems, item],
  });
  const maxQuantity = capacity.maxQuantity == null || capacity.maxQuantity === "" ? NaN : Number(capacity.maxQuantity);
  if (Number.isFinite(maxQuantity) && maxQuantity >= 0 && totals.quantity > maxQuantity) {
    return `This container holds at most ${maxQuantity} individual items (${totals.quantity} proposed).`;
  }
  const maxEnc = Number(container?.system?.container_enc?.max ?? 0);
  if (maxEnc > 0 && totals.enc > maxEnc) return `Contents would exceed this container's ${maxEnc} ENC capacity.`;
  return null;
}

/** Validate a proposed inventory using the same policy, including every ancestor. */
export function getInventoryPlacementIssue(actor, proposedItem, { inventory = allItems(actor) } = {}) {
  const id = itemId(proposedItem);
  const proposedInventory = inventory.filter(item => !id || itemId(item) !== id).concat(proposedItem);
  const context = { items: proposedInventory };
  const byId = new Map(proposedInventory.filter(item => itemId(item)).map(item => [itemId(item), item]));
  const seen = new Set(id ? [id] : []);
  let child = proposedItem;
  let ancestorCount = 0;
  let pointer = String(child?.system?.containerStats?.container_id ?? "").trim();
  while (pointer) {
    if (seen.has(pointer)) return "Containers cannot contain themselves or form a containment cycle.";
    seen.add(pointer);
    const parent = byId.get(pointer);
    if (parent?.type !== "container" || parent.system?.isPhysicalObject === false) return "The selected container no longer exists in this inventory.";
    ancestorCount += 1;
    const issue = getContainerCapacityIssue(context, parent, child);
    if (issue) return issue;
    child = parent;
    pointer = String(child.system?.containerStats?.container_id ?? "").trim();
  }
  const subtreeDepth = (item, visited = new Set()) => {
    if (item?.type !== "container") return 0;
    const currentId = itemId(item);
    if (!currentId) return 1;
    if (currentId && visited.has(currentId)) return Infinity;
    const next = new Set(visited);
    if (currentId) next.add(currentId);
    return 1 + Math.max(0, ...proposedInventory.filter(candidate =>
      candidate?.type === "container" && String(candidate.system?.containerStats?.container_id ?? "").trim() === currentId)
      .map(candidate => subtreeDepth(candidate, next)));
  };
  const depth = ancestorCount + subtreeDepth(proposedItem);
  if (!Number.isFinite(depth)) return "Containers cannot contain themselves or form a containment cycle.";
  if (depth > MAX_CONTAINER_DEPTH) return `Containers can only be nested ${MAX_CONTAINER_DEPTH} levels deep.`;
  if (id && proposedItem.type === "container") {
    for (const content of proposedInventory.filter(item => String(item.system?.containerStats?.container_id ?? "").trim() === id)) {
      const issue = getContainerCapacityIssue(context, proposedItem, content);
      if (issue) return issue;
    }
  }
  return null;
}
