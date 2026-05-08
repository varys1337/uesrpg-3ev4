function _getActorItems(actor) {
  return Array.from(actor?.items?.contents ?? actor?.items ?? []);
}

function _itemId(item) {
  return String(item?.id ?? item?._id ?? "").trim();
}

function _isContainedBy(item, containerId) {
  return String(item?.system?.containerStats?.container_id ?? "").trim() === String(containerId ?? "").trim();
}

function _itemEnc(item) {
  const enc = Number(item?.system?.enc ?? 0);
  const qty = Number(item?.system?.quantity ?? 1);
  return (Number.isFinite(enc) ? enc : 0) * Math.max(1, Number.isFinite(qty) ? qty : 1);
}

function _getContainedItems(actor, container) {
  const containerId = _itemId(container);
  if (!actor || !containerId) return [];
  return _getActorItems(actor).filter((item) => _isContainedBy(item, containerId));
}

function _getItemTotals(actor, item, visited = new Set()) {
  const id = _itemId(item);
  if (id && visited.has(id)) return { enc: 0, count: 0 };
  if (id) visited.add(id);

  let enc = _itemEnc(item);
  let count = 1;

  if (item?.type === "container") {
    for (const child of _getContainedItems(actor, item)) {
      const childTotals = _getItemTotals(actor, child, visited);
      enc += childTotals.enc;
      count += childTotals.count;
    }
  }

  return { enc, count };
}

export function prepareContainerItem(item, actorData, itemData) {
  let currentCapacity = 0;
  let itemCount = 0;

  for (const containedItem of _getContainedItems(actorData, item)) {
    const totals = _getItemTotals(actorData, containedItem);
    currentCapacity += totals.enc;
    itemCount += totals.count;
  }

  itemData.container_enc = itemData.container_enc || {};
  itemData.container_enc.current = currentCapacity;
  itemData.container_enc.max = Number(itemData.container_enc.max ?? 0);
  itemData.container_enc.item_count = itemCount;
}
