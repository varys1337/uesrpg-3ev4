import { requestCreateEmbeddedDocuments, requestUpdateDocument } from "../../../utils/authority-proxy.js";

export async function duplicateContainedItemsOnActor(containerItem, actorData, itemData) {
  if (!actorData || !Array.isArray(itemData?.system?.contained_items)) return;

  const itemsToDuplicate = [];
  for (const containedItem of itemData.system.contained_items) {
    const source = containedItem?.item ? (containedItem.item.toObject ? containedItem.item.toObject() : containedItem.item) : containedItem;
    const clone = foundry.utils.deepClone(source);
    if (!clone) continue;
    delete clone._id;
    clone.system = clone.system || {};
    clone.system.containerStats = clone.system.containerStats || {};
    clone.system.containerStats.contained = true;
    clone.system.containerStats.container_id = containerItem?.id ?? itemData._id;
    clone.system.containerStats.container_name = containerItem?.name ?? itemData.name ?? "";
    itemsToDuplicate.push(clone);
  }

  if (itemsToDuplicate.length === 0) return;

  try {
    const createdContainedItems = await requestCreateEmbeddedDocuments(actorData, "Item", itemsToDuplicate);
    const newContainedItems = (createdContainedItems ?? []).map(item => ({
      _id: item.id ?? item._id,
      item: item.toObject ? item.toObject() : foundry.utils.deepClone(item),
    }));
    await requestUpdateDocument(containerItem, { "system.contained_items": newContainedItems });
  } catch (err) {
    console.error("UESRPG | Failed to duplicate contained items onto actor", { container: containerItem?.name, err });
    ui.notifications?.error?.("Failed to create contained items for container.");
  }
}
