export function prepareContainerItem(actorData, itemData) {
  const contained = Array.isArray(itemData?.contained_items) ? itemData.contained_items : [];

  let currentCapacity = 0;
  for (const containedItem of contained) {
    const cItem = containedItem?.item || containedItem || {};
    const enc = Number(cItem?.system?.enc ?? 0);
    const qty = Number(cItem?.system?.quantity ?? 0);
    currentCapacity += enc * qty;
  }

  itemData.container_enc = itemData.container_enc || {};
  itemData.container_enc.current = currentCapacity;
  itemData.container_enc.max = Number(itemData.container_enc.max ?? 0);
  itemData.container_enc.item_count = contained.length;
}