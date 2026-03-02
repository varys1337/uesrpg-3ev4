/**
 * Backward-compatible exports for dropped-item create helpers.
 * Canonical implementation lives in dnd-external-create.js.
 */

export {
  inferDroppedItemType,
  buildDroppedItemCreateData,
  createExternalDroppedItem,
} from "./dnd-external-create.js";

/**
 * @deprecated Use createExternalDroppedItem instead.
 */
export { createExternalDroppedItem as handleExternalItemDrop } from "./dnd-external-create.js";
