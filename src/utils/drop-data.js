/**
 * Drop-data resolution helpers for AppV2 sheet drag-and-drop handlers.
 * Prefer Foundry's fromDropData pathway, then fall back to UUID lookup.
 */

/**
 * Resolve an Item document from arbitrary drop payloads.
 * Supports actor-sheet, compendium, and world-item drag payload variants.
 *
 * @param {object} dropData
 * @returns {Promise<Item|null>}
 */
export async function resolveDroppedItem(dropData) {
  if (!dropData || dropData.type !== "Item") return null;

  const itemClass =
    CONFIG?.Item?.documentClass ??
    globalThis.Item?.implementation ??
    globalThis.Item;

  if (itemClass?.fromDropData) {
    try {
      const item = await itemClass.fromDropData(dropData);
      if (item) return item;
    } catch (err) {
      console.debug?.("UESRPG | resolveDroppedItem: fromDropData failed", {
        err,
        dropData,
      });
      // Fall through to UUID fallback.
    }
  }

  if (dropData.pack && dropData.id) {
    try {
      const pack = game?.packs?.get(dropData.pack);
      const item = await pack?.getDocument(dropData.id);
      if (item) return item;
    } catch (err) {
      console.debug?.("UESRPG | resolveDroppedItem: pack lookup failed", {
        err,
        pack: dropData.pack,
        id: dropData.id,
      });
    }
  }

  if (dropData.uuid) {
    try {
      const item = await fromUuid(dropData.uuid);
      if (item) return item;
    } catch (err) {
      console.debug?.("UESRPG | resolveDroppedItem: fromUuid failed", {
        err,
        uuid: dropData.uuid,
      });
      // Return null below.
    }
  }

  if (dropData.data && itemClass?.fromSource) {
    try {
      const item = itemClass.fromSource(dropData.data);
      if (item) return item;
    } catch (err) {
      console.debug?.("UESRPG | resolveDroppedItem: fromSource failed", {
        err,
      });
    }
  }

  console.debug?.("UESRPG | resolveDroppedItem: unresolved item drop payload", {
    dropData,
  });

  return null;
}
