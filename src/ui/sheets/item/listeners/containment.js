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
import { createDebugLogger } from "../../../../utils/debug.js";

const _shieldDebug = createDebugLogger("shieldDebug", "[UESRPG][ShieldDebug][Containment]");

/**
 * Return the set of item types that are allowed to be placed into containers.
 * We intentionally exclude non-physical "character build" items (skills, talents, traits, powers, etc).
 *
 * @returns {Set<string>}
 */
export function getContainerAllowedTypes() {
  return new Set(["equipment", "scroll", "weapon", "armor", "shield", "ammunition"]);
}

function _resolveContainmentContext(sheetLike) {
  if (!sheetLike) return null;
  const document = sheetLike.document ?? sheetLike.item ?? null;
  const actor = sheetLike.actor ?? document?.actor ?? null;
  const isEditable = sheetLike.isEditable ?? false;
  if (!document || document.type !== "container" || !actor) return null;
  return { document, actor, isEditable };
}

/**
 * Basic permission gate for modifying containment from an ItemSheet context.
 * Containers are only meaningful when embedded on an Actor.
 */
export function canModifyContainment(sheet) {
  const ctx = _resolveContainmentContext(sheet);
  return !!(ctx?.isEditable && ctx.document?.isOwned && ctx.actor?.isOwner);
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
  if (!sheet.document || sheet.document.type !== "container") return false;
  if (!sheet.document.actor) return false;

  const containerId = sheet.document.id;
  const current = Array.isArray(sheet.document.system?.contained_items) ? sheet.document.system.contained_items : [];

  // Phase 1: collect valid sources (Item documents) without serializing yet.
  const byId = new Map(); // id → Item document

  // Seed from current list (validate against actor items + containerStats)
  for (const entry of current) {
    const id = entry?._id;
    if (!id) continue;
    if (byId.has(id)) continue;

    const source = sheet.document.actor.items.get(id);
    if (!source) continue;

    const cs = source.system?.containerStats;
    const isInThis = !!cs?.contained && (cs?.container_id === containerId);
    if (!isInThis) continue;

    byId.set(id, source);
  }

  // Add actor items that claim they are in this container but are missing from list
  for (const source of sheet.document.actor.items) {
    if (!source) continue;
    if (source.type === "container") continue;
    const cs = source.system?.containerStats;
    const isInThis = !!cs?.contained && (cs?.container_id === containerId);
    if (!isInThis) continue;
    if (byId.has(source.id)) continue;
    byId.set(source.id, source);
  }

  const nextIds = Array.from(byId.keys());

  // Phase 2: detect structural changes (membership / order) with no serialization.
  const curIds = current.map(e => e?._id).filter(Boolean);
  const changedIds = (curIds.length !== nextIds.length) || curIds.some((id, idx) => id !== nextIds[idx]);

  // Also check modifiedTime for snapshot staleness (lightweight _stats access).
  let changedSnapshot = false;
  if (!changedIds) {
    for (const [id, source] of byId) {
      const cur = current.find(e => e?._id === id);
      const curMT = cur?.item?._stats?.modifiedTime;
      const srcMT = source._stats?.modifiedTime;
      if (curMT !== srcMT) { changedSnapshot = true; break; }
    }
  }

  if (!changedIds && !changedSnapshot) return false;

  // Phase 3: serialize only when an update is confirmed necessary.
  const next = nextIds.map(id => ({ _id: id, item: byId.get(id).toObject() }));
  await requestUpdateDocument(sheet.document, { "system.contained_items": next });
  return true;
}

/**
 * Keep this container's contained_items snapshot in sync with owned items.
 * This is intentionally conservative to avoid render-loop churn.
 *
 * @param {ItemSheet} sheet
 */
export async function updateContainedItemsList(sheet) {
  if (!sheet.document || sheet.document.type !== "container") return;
  if (!sheet.document.actor) return;

  // Repair first (removes ghost ids / dedupes / adds missing)
  const repaired = await repairContainerContainedItems(sheet);
  if (repaired) return;

  const current = Array.isArray(sheet.document.system?.contained_items) ? sheet.document.system.contained_items : [];

  // Phase 1: change detection using lightweight _stats access — no toObject() yet.
  let changed = false;
  const valid = []; // [{id, source}] — items confirmed to exist on actor

  for (const entry of current) {
    const id = entry?._id;
    if (!id) { changed = true; continue; }
    const source = sheet.document.actor.items.get(id);
    if (!source) { changed = true; continue; }

    // _stats.modifiedTime is readable without serialization
    const curMT = entry?.item?._stats?.modifiedTime;
    const srcMT = source._stats?.modifiedTime;
    if (curMT !== srcMT) changed = true;

    valid.push({ id, source });
  }

  if (!changed) return;

  // Phase 2: serialize only when we know an update is needed.
  const next = valid.map(({ id, source }) => ({ _id: id, item: source.toObject() }));
  await requestUpdateDocument(sheet.document, { "system.contained_items": next });
}

/**
 * Push contained item data updates to parent container
 *
 * @param {ItemSheet} sheet
 */
export async function pushContainedItemData(sheet) {
  if (!sheet.document.actor) return;
  if (!sheet.document?.system?.containerStats) return;
  if (sheet.document.type === "container") return;

  const containerId = sheet.document.system.containerStats.container_id;
  if (!containerId) return;

  const containerItem = sheet.document.actor.items.get(containerId);
  if (!containerItem) return;

  const current = Array.isArray(containerItem.system?.contained_items) ? containerItem.system.contained_items : [];
  const itemId = sheet.document.id;

  const nextEntry = { _id: itemId, item: sheet.document.toObject() };

  const next = current.filter(ci => ci?._id !== itemId).concat([nextEntry]);
  if (String(sheet?.document?.type ?? "").toLowerCase() === "shield") {
    _shieldDebug("pushContainedItemData", {
      itemId,
      itemName: sheet?.document?.name ?? null,
      actorId: sheet?.document?.actor?.id ?? null,
      containerId,
      nextCount: next.length,
      containerName: containerItem?.name ?? null,
    });
  }
  await requestUpdateDocument(containerItem, { "system.contained_items": next });
}

/**
 * Handler: Drop an item into this container (drag-and-drop support)
 *
 * @param {ItemSheet} sheet
 * @param {object} dropData - The dropped item data (type: "Item", uuid: ...)
 */
export async function onDropItemIntoContainer(sheet, dropData) {
  const ctx = _resolveContainmentContext(sheet);
  if (!ctx) return;
  if (!canModifyContainment(ctx)) {
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
  if (droppedItem.actor?.id !== ctx.actor.id) {
    const itemData = droppedItem.toObject();
    delete itemData._id;
    const created = await requestCreateEmbeddedDocuments(ctx.actor, "Item", [itemData]);
    droppedItem = created?.[0];
    if (!droppedItem) {
      ui.notifications?.error("Failed to create item copy.");
      return;
    }
  }

  // Prevent self-containment (container cannot contain itself)
  if (droppedItem.id === ctx.document.id) {
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

  const containerId = ctx.document.id;
  const containerMaxEnc = Number(ctx.document.system?.container_enc?.max ?? 0);
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
    const oldContainer = ctx.actor.items.get(currentContainerId);
    if (oldContainer && Array.isArray(oldContainer.system?.contained_items)) {
      const nextOld = oldContainer.system.contained_items.filter(ci => ci?._id !== droppedItem.id);
      await requestUpdateDocument(oldContainer, { "system.contained_items": nextOld });
    }
  }

  // Update the item's containerStats
  const updateData = {
    "system.containerStats.contained": true,
    "system.containerStats.container_id": containerId,
    "system.containerStats.container_name": ctx.document.name
  };

  // Force unequip if equipped
  if (typeof droppedItem.system?.equipped === "boolean") {
    updateData["system.equipped"] = false;
  }

  await requestUpdateDocument(droppedItem, updateData);
  if (String(droppedItem?.type ?? "").toLowerCase() === "shield") {
    _shieldDebug("onDropItemIntoContainer applied", {
      itemId: droppedItem?.id ?? null,
      itemName: droppedItem?.name ?? null,
      actorId: ctx.actor?.id ?? null,
      containerId,
      updateData,
    });
  }

  // Rebuild container list
  await repairContainerContainedItems(ctx);

  ui.notifications?.info(`${droppedItem.name} added to ${ctx.document.name}.`);
}

export async function removeItemFromContainer(actor, item) {
  if (!actor || !item) return false;
  const cs = item.system?.containerStats ?? {};
  const currentContainerId = String(cs?.container_id ?? "").trim();
  const isContained = cs?.contained === true && currentContainerId.length > 0;
  if (!isContained) return false;

  const oldContainer = actor.items.get(currentContainerId);
  if (oldContainer && Array.isArray(oldContainer.system?.contained_items)) {
    const nextOld = oldContainer.system.contained_items.filter((ci) => ci?._id !== item.id);
    await requestUpdateDocument(oldContainer, { "system.contained_items": nextOld });
  }

  await requestUpdateDocument(item, {
    "system.containerStats.contained": false,
    "system.containerStats.container_id": "",
    "system.containerStats.container_name": ""
  });
  return true;
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
  const containerId = sheet.document.id;
  const containerMaxEnc = Number(sheet.document.system?.container_enc?.max ?? 0);

  const eligible = [];
  for (const item of sheet.document.actor.items) {
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
    title: `Add All Items to ${sheet.document.name}`,
    content: `<p>Add <strong>${eligible.length}</strong> eligible items to this container?</p>`,
  });

  if (!confirmed) return;

  // Add each item
  for (const item of eligible) {
    const cs = item.system?.containerStats ?? {};
    const currentContainerId = cs?.container_id || "";

    // Remove from old container if needed
    if (currentContainerId) {
      const oldContainer = sheet.document.actor.items.get(currentContainerId);
      if (oldContainer && Array.isArray(oldContainer.system?.contained_items)) {
        const nextOld = oldContainer.system.contained_items.filter(ci => ci?._id !== item.id);
        await requestUpdateDocument(oldContainer, { "system.contained_items": nextOld });
      }
    }

    const updateData = {
      "system.containerStats.contained": true,
      "system.containerStats.container_id": containerId,
      "system.containerStats.container_name": sheet.document.name
    };

    if (typeof item.system?.equipped === "boolean") {
      updateData["system.equipped"] = false;
    }

    await requestUpdateDocument(item, updateData);
  }

  await repairContainerContainedItems(sheet);
  ui.notifications?.info(`Added ${eligible.length} items to ${sheet.document.name}.`);
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

  const contained = Array.isArray(sheet.document.system?.contained_items)
    ? sheet.document.system.contained_items
    : [];

  if (!contained.length) {
    return ui.notifications?.info("Container is already empty.");
  }

  const confirmed = await confirmDialog({
    title: `Remove All Items from ${sheet.document.name}`,
    content: `<p>Remove <strong>${contained.length}</strong> items from this container? Items will not be deleted.</p>`,
  });

  if (!confirmed) return;

  const updates = [];
  for (const entry of contained) {
    const itemId = entry?._id;
    if (!itemId) continue;
    const item = sheet.document.actor.items.get(itemId);
    if (!item) continue;

    updates.push({
      _id: itemId,
      "system.containerStats.contained": false,
      "system.containerStats.container_id": "",
      "system.containerStats.container_name": ""
    });
  }

  if (updates.length) {
    await requestUpdateEmbeddedDocuments(sheet.document.actor, "Item", updates);
  }

  await repairContainerContainedItems(sheet);
  ui.notifications?.info(`Removed ${updates.length} items from ${sheet.document.name}.`);
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

  const contained = Array.isArray(sheet.document.system?.contained_items)
    ? sheet.document.system.contained_items
    : [];

  if (!contained.length) {
    return ui.notifications?.info("Container is already empty.");
  }

  const confirmed = await confirmDialog({
    title: `Delete All Items in ${sheet.document.name}`,
    content: `<p><strong>WARNING:</strong> Permanently delete <strong>${contained.length}</strong> items? This cannot be undone.</p>`,
  });

  if (!confirmed) return;

  const ids = contained.map(e => e?._id).filter(Boolean);
  if (ids.length) {
    await requestDeleteEmbeddedDocuments(sheet.document.actor, "Item", ids);
  }

  await repairContainerContainedItems(sheet);
  ui.notifications?.info(`Deleted ${ids.length} items from ${sheet.document.name}.`);
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
    const isInThisContainer = isContained && (cs.container_id === sheet.document._id);

    const img = bagItem?.img || CONST.DEFAULT_TOKEN;
    const qty = bagItem?.system?.quantity ?? 0;
    const enc = bagItem?.system?.enc ?? 0;

    const safeName = foundry.utils.escapeHTML(bagItem.name);
    const safeType = foundry.utils.escapeHTML(bagItem.type);
    const entry = `<tr data-item-id="${bagItem._id}">
      <td class="uesrpg-container-picker__name" data-item-id="${bagItem._id}">
        <img class="item-img" src="${img}" height="24" width="24">
        ${isContained ? '<i class="fa-solid fa-backpack"></i>' : ""}
        ${safeName}
      </td>
      <td class="uesrpg-container-picker__cell">${safeType}</td>
      <td class="uesrpg-container-picker__cell">${qty}</td>
      <td class="uesrpg-container-picker__cell">${enc}</td>
      <td class="uesrpg-container-picker__cell">
        <input type="checkbox" class="itemSelect container-select" data-item-id="${bagItem._id}" ${isInThisContainer ? "checked" : ""}>
      </td>
    </tr>`;
    tableEntries.push(entry);
  }

  const safeContainerName = foundry.utils.escapeHTML(sheet.document.name);
  const content = `<div class="uesrpg-container-picker">
      <div class="uesrpg-container-picker__intro">
        <label>Select items to add to <strong>${safeContainerName}</strong>.</label>
        ${tooLarge ? `<div class="uesrpg-container-picker__oversize-note">Some items are hidden because their ENC exceeds remaining container capacity.</div>` : ""}
      </div>
      <div class="uesrpg-container-picker__table-wrap">
        <table class="uesrpg-container-picker__table">
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
    title: `Add Items to ${sheet.document.name}`,
    content,
    classes: ["uesrpg-container-picker-dialog"],
    width: 760,
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
          const containerId = sheet.document.id;

          // Apply changes per checkbox:
          // - checked: set this container as owner; unlink from any previous container list
          // - unchecked: only un-contain if currently in this container
          for (const input of selectedInputs) {
            const itemId = input?.dataset?.itemId;
            if (!itemId) continue;

            const thisItem = sheet.document.actor.items.get(itemId);
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
                  const oldContainer = sheet.document.actor.items.get(currentContainerId);
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
                updateData["system.containerStats.container_name"] = sheet.document.name;
              } else {
                // Backfill full object if legacy items lack containerStats
                updateData["system.containerStats"] = {
                  contained: true,
                  container_id: containerId,
                  container_name: sheet.document.name
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
  const itemList = sheet.document.actor.items;

  const containerMaxEnc =
    (sheet.document.system?.container_enc?.max != null)
      ? Number(sheet.document.system.container_enc.max)
      : 0;

  for (const i of itemList) {
    if (!i) continue;
    if (i.id === sheet.document.id) continue;

    // Never allow containers inside containers (prevents cycles)
    if (i.type === "container") continue;

    // Only physical inventory items
    if (!allowedTypes.has(i.type)) continue;
    const itemEnc = Number(i.system?.enc ?? 0);
    const cs = i.system?.containerStats ?? {};
    const isInThis = !!cs?.contained && (cs?.container_id === sheet.document.id);

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
  if (!sheet.document.actor) {
    ui.notifications.info("Containers must be on Actor Sheets in order to open the contents.");
    return;
  }
  const row = target.closest(".item");
  if (!row) return;
  const item = sheet.document.actor.items.get(row.dataset.itemId);
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
  if (!sheet.document.actor) return;

  const itemToUpdate = sheet.document.actor.items.get(removedItemId);
  if (itemToUpdate) {
    if (String(itemToUpdate?.type ?? "").toLowerCase() === "shield") {
      _shieldDebug("onRemoveContainedItem", {
        itemId: itemToUpdate?.id ?? null,
        itemName: itemToUpdate?.name ?? null,
        actorId: sheet?.document?.actor?.id ?? null,
        containerId: sheet?.document?.id ?? null,
      });
    }
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
  if (!sheet.document.actor) return;

  const itemDoc = sheet.document.actor.items.get(deletedItemId);
  const itemName = itemDoc?.name || "this item";

  const confirmed = await confirmDialog({
    title: "Delete Item",
    content: `<p>Delete <strong>${itemName}</strong>? This cannot be undone.</p>`,
  });

  if (confirmed) {
    await requestDeleteEmbeddedDocuments(sheet.document.actor, "Item", [deletedItemId]);
    await repairContainerContainedItems(sheet);
  }
}

