/**
 * src/ui/sheets/item/listeners/containment.js
 *
 * Container and containment business-logic handlers for item sheets.
 *
 * Click-action handlers are wired via SimpleItemSheetV2's `actions` map.
 * Non-click listeners (contextmenu, drag visual feedback) are registered
 * natively in `_registerContainmentListeners` on the sheet class.
 * Side-effect calls (updateContainedItemsList, pushContainedItemData)
 * are invoked from `_onRender`.
 */
import { confirmDialog, customDialog } from "../../../../utils/dialog-v2-helper.js";
import { requestUpdateDocument, requestCreateEmbeddedDocuments, requestUpdateEmbeddedDocuments, requestDeleteEmbeddedDocuments } from "../../../../utils/authority-proxy.js";
import { resolveDroppedItem } from "../../../../utils/drop-data.js";

/**
 * Return the set of item types that are allowed to be placed into containers.
 * We intentionally exclude non-physical "character build" items (skills, talents, traits, powers, etc).
 *
 * @returns {Set<string>}
 */
export function getContainerAllowedTypes() {
  return new Set(["item", "weapon", "armor", "ammunition"]);
}

/**
 * Basic permission gate for modifying containment from an ItemSheet context.
 * Containers are only meaningful when embedded on an Actor.
 */
export function canModifyContainment(sheet) {
  return !!(sheet.isEditable && sheet.item?.isOwned && sheet.actor && sheet.actor.isOwner);
}

/**
 * Build a normalized, de-duplicated, actor-authoritative contained_items list for this container.
 * - Removes missing/deleted item ids
 * - De-duplicates ids
 * - Adds any actor items which claim they are contained in this container but are missing from the list
 * - Stores a plain-object snapshot (toObject) for stable rendering and diffs
 *
 * @param {ItemSheet} sheet
 * @returns {Promise<boolean>} whether an update was applied
 */
export async function repairContainerContainedItems(sheet) {
  if (!sheet.item || sheet.item.type !== "container") return false;
  if (!sheet.actor) return false;

  const containerId = sheet.item.id;
  const current = Array.isArray(sheet.item.system?.contained_items) ? sheet.item.system.contained_items : [];

  const byId = new Map();

  // Seed from current list (but validate against actor items + containerStats)
  for (const entry of current) {
    const id = entry?._id;
    if (!id) continue;
    if (byId.has(id)) continue;

    const source = sheet.actor.items.get(id);
    if (!source) continue;

    const cs = source.system?.containerStats;
    const isInThis = !!cs?.contained && (cs?.container_id === containerId);
    if (!isInThis) continue;

    byId.set(id, { _id: id, item: source.toObject() });
  }

  // Add any actor items that claim they are in this container but are missing from list
  for (const source of sheet.actor.items) {
    if (!source) continue;
    if (source.type === "container") continue;
    const cs = source.system?.containerStats;
    const isInThis = !!cs?.contained && (cs?.container_id === containerId);
    if (!isInThis) continue;
    if (byId.has(source.id)) continue;
    byId.set(source.id, { _id: source.id, item: source.toObject() });
  }

  const next = Array.from(byId.values());

  // Detect meaningful change
  const curIds = current.map(e => e?._id).filter(Boolean);
  const nextIds = next.map(e => e?._id).filter(Boolean);
  const changedIds = (curIds.length !== nextIds.length) || curIds.some((id, idx) => id !== nextIds[idx]);

  // Also update if any snapshot modifiedTime differs (or missing snapshots)
  let changedSnapshot = false;
  if (!changedIds) {
    for (const entry of next) {
      const cur = current.find(e => e?._id === entry._id);
      const curMT = cur?.item?._stats?.modifiedTime;
      const nextMT = entry?.item?._stats?.modifiedTime;
      if (curMT !== nextMT) { changedSnapshot = true; break; }
    }
  }

  if (!changedIds && !changedSnapshot) return false;

  await requestUpdateDocument(sheet.item, { "system.contained_items": next });
  return true;
}

/**
 * Keep this container's contained_items snapshot in sync with owned items.
 * This is intentionally conservative to avoid render-loop churn.
 *
 * @param {ItemSheet} sheet
 */
export async function updateContainedItemsList(sheet) {
  if (!sheet.item || sheet.item.type !== "container") return;
  if (!sheet.actor) return;

  // Repair first (removes ghost ids / dedupes / adds missing)
  const repaired = await repairContainerContainedItems(sheet);
  if (repaired) return;

  const current = Array.isArray(sheet.item.system?.contained_items) ? sheet.item.system.contained_items : [];
  let changed = false;
  const next = [];

  for (const entry of current) {
    const id = entry?._id;
    if (!id) { changed = true; continue; }
    const source = sheet.actor.items.get(id);
    if (!source) { changed = true; continue; }

    const sourceObj = source.toObject();
    const curMT = entry?.item?._stats?.modifiedTime;
    const nextMT = sourceObj?._stats?.modifiedTime;
    if (curMT !== nextMT) changed = true;

    next.push({ _id: id, item: sourceObj });
  }

  if (!changed) return;
  await requestUpdateDocument(sheet.item, { "system.contained_items": next });
}

/**
 * Push contained item data updates to parent container
 *
 * @param {ItemSheet} sheet
 */
export async function pushContainedItemData(sheet) {
  if (!sheet.actor) return;
  if (!sheet.item?.system?.containerStats) return;
  if (sheet.item.type === "container") return;

  const containerId = sheet.item.system.containerStats.container_id;
  if (!containerId) return;

  const containerItem = sheet.actor.items.get(containerId);
  if (!containerItem) return;

  const current = Array.isArray(containerItem.system?.contained_items) ? containerItem.system.contained_items : [];
  const itemId = sheet.item.id;

  const nextEntry = { _id: itemId, item: sheet.item.toObject() };

  const next = current.filter(ci => ci?._id !== itemId).concat([nextEntry]);
  await requestUpdateDocument(containerItem, { "system.contained_items": next });
}

/**
 * Handler: Drop an item into this container (drag-and-drop support)
 *
 * @param {ItemSheet} sheet
 * @param {object} dropData - The dropped item data (type: "Item", uuid: ...)
 */
export async function onDropItemIntoContainer(sheet, dropData) {
  if (!canModifyContainment(sheet)) {
    ui.notifications?.warn("You do not have permission to modify this container.");
    return;
  }

  // Resolve the dropped item (supports actor/world/compendium payload variants)
  let droppedItem = await resolveDroppedItem(dropData);

  if (!droppedItem) {
    ui.notifications?.warn("Could not find the dropped item.");
    return;
  }

  // If item is from a different actor, create a copy on this actor first
  if (droppedItem.actor?.id !== sheet.actor.id) {
    const itemData = droppedItem.toObject();
    delete itemData._id;
    const created = await requestCreateEmbeddedDocuments(sheet.actor, "Item", [itemData]);
    droppedItem = created?.[0];
    if (!droppedItem) {
      ui.notifications?.error("Failed to create item copy.");
      return;
    }
  }

  // Prevent self-containment (container cannot contain itself)
  if (droppedItem.id === sheet.item.id) {
    ui.notifications?.warn("A container cannot contain itself.");
    return;
  }

  // Never allow containers inside containers (prevents cycles)
  if (droppedItem.type === "container") {
    ui.notifications?.warn("Containers cannot be placed inside other containers.");
    return;
  }

  // Only physical inventory items are allowed
  const allowedTypes = getContainerAllowedTypes();
  if (!allowedTypes.has(droppedItem.type)) {
    ui.notifications?.warn(`${droppedItem.type} items cannot be stored in containers.`);
    return;
  }

  const containerId = sheet.item.id;
  const containerMaxEnc = Number(sheet.item.system?.container_enc?.max ?? 0);
  const itemEnc = Number(droppedItem.system?.enc ?? 0);

  // Check capacity (warn but allow if already in this container)
  const cs = droppedItem.system?.containerStats ?? {};
  const isInThis = !!cs?.contained && (cs?.container_id === containerId);

  if (!isInThis && itemEnc > containerMaxEnc && containerMaxEnc > 0) {
    ui.notifications?.warn(
      `Item ENC (${itemEnc}) exceeds container capacity (${containerMaxEnc}). ` +
      `Item was not added.`
    );
    return;
  }

  // If item belongs to another container, remove it from that container's list first
  const currentContainerId = cs?.container_id || "";
  if (currentContainerId && currentContainerId !== containerId) {
    const oldContainer = sheet.actor.items.get(currentContainerId);
    if (oldContainer && Array.isArray(oldContainer.system?.contained_items)) {
      const nextOld = oldContainer.system.contained_items.filter(ci => ci?._id !== droppedItem.id);
      await requestUpdateDocument(oldContainer, { "system.contained_items": nextOld });
    }
  }

  // Update the item's containerStats
  const updateData = {
    "system.containerStats.contained": true,
    "system.containerStats.container_id": containerId,
    "system.containerStats.container_name": sheet.item.name
  };

  // Force unequip if equipped
  if (typeof droppedItem.system?.equipped === "boolean") {
    updateData["system.equipped"] = false;
  }

  await requestUpdateDocument(droppedItem, updateData);

  // Rebuild container list
  await repairContainerContainedItems(sheet);

  ui.notifications?.info(`${droppedItem.name} added to ${sheet.item.name}.`);
}

/**
 * Handler: Bulk add all eligible items to this container
 *
 * @param {ItemSheet} sheet
 */
export async function onBulkAddToContainer(sheet) {
  if (!canModifyContainment(sheet)) {
    return ui.notifications?.warn("You do not have permission to modify this container.");
  }

  const allowedTypes = getContainerAllowedTypes();
  const containerId = sheet.item.id;
  const containerMaxEnc = Number(sheet.item.system?.container_enc?.max ?? 0);

  const eligible = [];
  for (const item of sheet.actor.items) {
    if (!item) continue;
    if (item.id === containerId) continue;
    if (item.type === "container") continue;
    if (!allowedTypes.has(item.type)) continue;

    const cs = item.system?.containerStats ?? {};
    const isInThis = !!cs?.contained && (cs?.container_id === containerId);
    if (isInThis) continue; // Already in this container

    const itemEnc = Number(item.system?.enc ?? 0);
    if (containerMaxEnc > 0 && itemEnc > containerMaxEnc) continue; // Too large

    eligible.push(item);
  }

  if (!eligible.length) {
    return ui.notifications?.info("No eligible items to add.");
  }

  const confirmed = await confirmDialog({
    title: `Add All Items to ${sheet.item.name}`,
    content: `<p>Add <strong>${eligible.length}</strong> eligible items to this container?</p>`,
  });

  if (!confirmed) return;

  // Add each item
  for (const item of eligible) {
    const cs = item.system?.containerStats ?? {};
    const currentContainerId = cs?.container_id || "";

    // Remove from old container if needed
    if (currentContainerId) {
      const oldContainer = sheet.actor.items.get(currentContainerId);
      if (oldContainer && Array.isArray(oldContainer.system?.contained_items)) {
        const nextOld = oldContainer.system.contained_items.filter(ci => ci?._id !== item.id);
        await requestUpdateDocument(oldContainer, { "system.contained_items": nextOld });
      }
    }

    const updateData = {
      "system.containerStats.contained": true,
      "system.containerStats.container_id": containerId,
      "system.containerStats.container_name": sheet.item.name
    };

    if (typeof item.system?.equipped === "boolean") {
      updateData["system.equipped"] = false;
    }

    await requestUpdateDocument(item, updateData);
  }

  await repairContainerContainedItems(sheet);
  ui.notifications?.info(`Added ${eligible.length} items to ${sheet.item.name}.`);
}

/**
 * Handler: Bulk remove all items from this container (does not delete)
 *
 * @param {ItemSheet} sheet
 */
export async function onBulkRemoveFromContainer(sheet) {
  if (!canModifyContainment(sheet)) {
    return ui.notifications?.warn("You do not have permission to modify this container.");
  }

  const contained = Array.isArray(sheet.item.system?.contained_items)
    ? sheet.item.system.contained_items
    : [];

  if (!contained.length) {
    return ui.notifications?.info("Container is already empty.");
  }

  const confirmed = await confirmDialog({
    title: `Remove All Items from ${sheet.item.name}`,
    content: `<p>Remove <strong>${contained.length}</strong> items from this container? Items will not be deleted.</p>`,
  });

  if (!confirmed) return;

  const updates = [];
  for (const entry of contained) {
    const itemId = entry?._id;
    if (!itemId) continue;
    const item = sheet.actor.items.get(itemId);
    if (!item) continue;

    updates.push({
      _id: itemId,
      "system.containerStats.contained": false,
      "system.containerStats.container_id": "",
      "system.containerStats.container_name": ""
    });
  }

  if (updates.length) {
    await requestUpdateEmbeddedDocuments(sheet.actor, "Item", updates);
  }

  await repairContainerContainedItems(sheet);
  ui.notifications?.info(`Removed ${updates.length} items from ${sheet.item.name}.`);
}

/**
 * Handler: Bulk delete all items in this container (destructive)
 *
 * @param {ItemSheet} sheet
 */
export async function onBulkDeleteContained(sheet) {
  if (!canModifyContainment(sheet)) {
    return ui.notifications?.warn("You do not have permission to modify this container.");
  }

  const contained = Array.isArray(sheet.item.system?.contained_items)
    ? sheet.item.system.contained_items
    : [];

  if (!contained.length) {
    return ui.notifications?.info("Container is already empty.");
  }

  const confirmed = await confirmDialog({
    title: `Delete All Items in ${sheet.item.name}`,
    content: `<p><strong>WARNING:</strong> Permanently delete <strong>${contained.length}</strong> items? This cannot be undone.</p>`,
  });

  if (!confirmed) return;

  const ids = contained.map(e => e?._id).filter(Boolean);
  if (ids.length) {
    await requestDeleteEmbeddedDocuments(sheet.actor, "Item", ids);
  }

  await repairContainerContainedItems(sheet);
  ui.notifications?.info(`Deleted ${ids.length} items from ${sheet.item.name}.`);
}

/**
 * Create container list dialog for adding/removing items
 *
 * @param {ItemSheet} sheet
 * @param {Array} bagListItems
 * @param {boolean} tooLarge
 */
export async function createContainerListDialog(sheet, bagListItems, tooLarge) {
  const tableEntries = [];
  for (const bagItem of bagListItems) {
    const cs = bagItem?.system?.containerStats ?? { contained: false, container_id: "" };
    const isContained = !!cs.contained;
    const isInThisContainer = isContained && (cs.container_id === sheet.item._id);

    const img = bagItem?.img || CONST.DEFAULT_TOKEN;
    const qty = bagItem?.system?.quantity ?? 0;
    const enc = bagItem?.system?.enc ?? 0;

    const entry = `<tr data-item-id="${bagItem._id}">
      <td data-item-id="${bagItem._id}">
        <div style="display: flex; flex-direction: row; align-items: center; gap: 5px;">
          <img class="item-img" src="${img}" height="24" width="24">
          ${isContained ? '<i class="fa-solid fa-backpack"></i>' : ""}
          ${bagItem.name}
        </div>
      </td>
      <td style="text-align: center;">${bagItem.type}</td>
      <td style="text-align: center;">${qty}</td>
      <td style="text-align: center;">${enc}</td>
      <td style="text-align: center;">
        <input type="checkbox" class="itemSelect container-select" data-item-id="${bagItem._id}" ${isInThisContainer ? "checked" : ""}>
      </td>
    </tr>`;
    tableEntries.push(entry);
  }

  const content = `<div>
      <div style="padding: 5px 0;">
        <label>Select Items to add to your ${sheet.item.name}.</label>
        ${tooLarge ? "<div>Some items do not appear on this list because their ENC is greater than the capacity in the container.</div>" : ""}
      </div>
      <div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>TYPE</th>
              <th>QTY</th>
              <th>ENC</th>
              <th>Add</th>
            </tr>
          </thead>
          <tbody>${tableEntries.join("")}</tbody>
        </table>
      </div>
    </div>`;

  await customDialog({
    title: `Add Items to ${sheet.item.name}`,
    content,
    yes: {
      label: "Apply",
      callback: async (html) => {
          if (!canModifyContainment(sheet)) {
            ui.notifications.warn("You do not have permission to modify container contents.");
            return;
          }

          const root = html instanceof HTMLElement ? html : html?.[0] ?? document;
          const selectedInputs = [...root.querySelectorAll(".itemSelect")];

          const allowedTypes = getContainerAllowedTypes();
          const containerId = sheet.item.id;

          // Apply changes per checkbox:
          // - checked: set this container as owner; unlink from any previous container list
          // - unchecked: only un-contain if currently in this container
          for (const input of selectedInputs) {
            const itemId = input?.dataset?.itemId;
            if (!itemId) continue;

            const thisItem = sheet.actor.items.get(itemId);
            if (!thisItem) continue;

            // Defensive: never allow containers to be contained (prevents cycles)
            if (thisItem.type === "container") continue;

            // Defensive: only allow physical inventory items
            if (!allowedTypes.has(thisItem.type)) continue;
            const thisCS = thisItem.system?.containerStats ?? {};
            const currentContainerId = thisCS.container_id || "";
            const isInThis = !!thisCS.contained && (currentContainerId === containerId);

            if (input.checked) {
              // Already in this container; nothing to do beyond ensuring fields are consistent
              if (!isInThis) {
                // If the item belongs to another container, remove it from that container's list first
                if (currentContainerId) {
                  const oldContainer = sheet.actor.items.get(currentContainerId);
                  if (oldContainer && Array.isArray(oldContainer.system?.contained_items)) {
                    const nextOld = oldContainer.system.contained_items.filter(ci => ci?._id !== thisItem.id);
                    await requestUpdateDocument(oldContainer, { "system.contained_items": nextOld });
                  }
                }
              }

              const updateData = {};

              const csObj = thisItem.system?.containerStats;
              const csValid = !!(csObj && typeof csObj === "object");

              if (csValid) {
                updateData["system.containerStats.contained"] = true;
                updateData["system.containerStats.container_id"] = containerId;
                updateData["system.containerStats.container_name"] = sheet.item.name;
              } else {
                // Backfill full object if legacy items lack containerStats
                updateData["system.containerStats"] = {
                  contained: true,
                  container_id: containerId,
                  container_name: sheet.item.name
                };
              }

              // Storing an equipped item is not meaningful; force unequipped if boolean field exists
              if (typeof thisItem.system?.equipped === "boolean") updateData["system.equipped"] = false;

              await requestUpdateDocument(thisItem, updateData);
            } else {
              // Unchecked: only remove if currently in this container
              if (isInThis) {
                await requestUpdateDocument(thisItem, {
                  "system.containerStats.contained": false,
                  "system.containerStats.container_id": "",
                  "system.containerStats.container_name": ""
                });
              }
            }
          }

          // Rebuild container list authoritatively from actor item.containerStats
          await repairContainerContainedItems(sheet);
      }
    },
    no: { label: "Cancel" },
    defaultButton: "yes"
  });
}

/**
 * Handler: Add items to container
 *
 * @param {ItemSheet} sheet
 */
export function onAddToContainer(sheet) {
  if (!canModifyContainment(sheet)) {
    return ui.notifications.warn("Containers must be owned by an Actor and you must have permission to modify them.");
  }

  const bagListItems = [];
  let tooLarge = false;

  const allowedTypes = getContainerAllowedTypes();
  const itemList = sheet.actor.items;

  const containerMaxEnc =
    (sheet.item.system?.container_enc?.max != null)
      ? Number(sheet.item.system.container_enc.max)
      : 0;

  for (const i of itemList) {
    if (!i) continue;
    if (i.id === sheet.item.id) continue;

    // Never allow containers inside containers (prevents cycles)
    if (i.type === "container") continue;

    // Only physical inventory items
    if (!allowedTypes.has(i.type)) continue;
    const itemEnc = Number(i.system?.enc ?? 0);
    const cs = i.system?.containerStats ?? {};
    const isInThis = !!cs?.contained && (cs?.container_id === sheet.item.id);

    // Always show items already in this container (even if over capacity) so the user can remove them.
    if (isInThis) {
      bagListItems.push(i);
      continue;
    }

    if (itemEnc > containerMaxEnc) {
      tooLarge = true;
      continue;
    }

    bagListItems.push(i);
  }

  createContainerListDialog(sheet, bagListItems, tooLarge);
}

/**
 * Handler: Open a contained item's sheet.
 *
 * @param {ItemSheet} sheet
 * @param {HTMLElement} target  The clicked element (from AppV2 action dispatch)
 */
export async function onOpenContainedItem(sheet, target) {
  if (!sheet.actor) {
    ui.notifications.info("Containers must be on Actor Sheets in order to open the contents.");
    return;
  }
  const row = target.closest(".item");
  if (!row) return;
  const item = sheet.actor.items.get(row.dataset.itemId);
  if (!item) return;
  item.sheet.render(true);
  await requestUpdateDocument(item, { "system.value": item.system.value });
}

/**
 * Handler: Remove an item from this container (does not delete it)
 *
 * @param {ItemSheet} sheet
 * @param {HTMLElement} target  The clicked element (from AppV2 action dispatch)
 */
export async function onRemoveContainedItem(sheet, target) {
  if (!canModifyContainment(sheet)) {
    ui.notifications.warn("You do not have permission to modify container contents.");
    return;
  }

  const row = target.closest(".item");
  const removedItemId = row?.dataset?.itemId;
  if (!removedItemId) return;
  if (!sheet.actor) return;

  const itemToUpdate = sheet.actor.items.get(removedItemId);
  if (itemToUpdate) {
    await requestUpdateDocument(itemToUpdate, {
      "system.containerStats.contained": false,
      "system.containerStats.container_id": "",
      "system.containerStats.container_name": ""
    });
  }

  await repairContainerContainedItems(sheet);
}

/**
 * Handler: Delete a contained item from the Actor (destructive)
 *
 * @param {ItemSheet} sheet
 * @param {HTMLElement} target  The clicked element (from AppV2 action dispatch)
 */
export async function onDeleteContainedItem(sheet, target) {
  if (!canModifyContainment(sheet)) {
    ui.notifications.warn("You do not have permission to modify container contents.");
    return;
  }

  const row = target.closest(".item");
  const deletedItemId = row?.dataset?.itemId;
  if (!deletedItemId) return;
  if (!sheet.actor) return;

  const itemDoc = sheet.actor.items.get(deletedItemId);
  const itemName = itemDoc?.name || "this item";

  const confirmed = await confirmDialog({
    title: "Delete Item",
    content: `<p>Delete <strong>${itemName}</strong>? This cannot be undone.</p>`,
  });

  if (confirmed) {
    await requestDeleteEmbeddedDocuments(sheet.actor, "Item", [deletedItemId]);
    await repairContainerContainedItems(sheet);
  }
}
