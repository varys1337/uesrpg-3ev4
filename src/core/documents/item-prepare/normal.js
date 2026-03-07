export function prepareNormalItem(actorData, itemData) {
  if (itemData.equipped) { itemData.wearable = true; }
}