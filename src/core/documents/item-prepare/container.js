import { getContainerInventoryTotals } from "../../items/container-capacity.js";

export function prepareContainerItem(item, actorData, itemData) {
  const totals = getContainerInventoryTotals(actorData, item);
  itemData.container_enc = itemData.container_enc || {};
  itemData.container_enc.current = totals.enc;
  itemData.container_enc.max = Number(itemData.container_enc.max ?? 0);
  itemData.container_enc.item_count = totals.count;
}
