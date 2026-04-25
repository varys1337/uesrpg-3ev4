/**
 * src/ui/sheets/item/item-sheet-spellcasting.js
 *
 * Item-level spellcasting slot handlers and scroll listeners for SimpleItemSheetV2.
 * Covers:
 *   - Scroll casting action
 *   - Spellcasting toggle, add/remove/edit/pick slot actions
 *   - registerScrollListeners (UUID input validation + drag-drop)
 *   - Scroll spell resolution helpers (resolveAndValidateScrollSpell, applyScrollSpellLink)
 *
 * Private helpers for the spellcasting flag shape are module-private; only action
 * functions and the two scroll helpers used by _onDrop are exported.
 */

import {
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
  requestUpdateDocument
} from "../../../utils/authority-proxy.js";
import { castScrollFromItem } from "../../../core/magic/scroll-casting.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { readDropData, resolveDroppedItem } from "../../../utils/drop-data.js";
import {
  buildMaterializedStoredSpellSource,
  isHiddenStoredEnchantmentSpell
} from "../../../core/enchanting/stored-spell-doc.js";
import { SYSTEM_ID } from "../../constants.js";
import {
  buildStoredSpellOptionState,
  buildStoredSpellSnapshot,
  itemUuid,
  resolveStoredSpellDocument,
} from "../../shared/stored-spell-options.js";

/* ── Private: spellcasting flag utilities ─────────────────────────────────── */

const _EQUIPMENT_ITEM_TYPES = new Set(["weapon", "armor", "shield", "ammunition", "equipment", "scroll"]);

function _normalizeSpellcastingCostMode(value) {
  const mode = String(value ?? "soul").trim().toLowerCase();
  if (mode === "magicka" || mode === "none") return mode;
  return "soul";
}

function _normalizeSpellcastingSkipCastingTest(value) {
  return value !== false;
}

function _isSpellcastingEligibleItem(item) {
  return _EQUIPMENT_ITEM_TYPES.has(String(item?.type ?? "").toLowerCase());
}

function _buildLegacyExtensionSeed(item) {
  const enchanting = item?.flags?.[SYSTEM_ID]?.enchanting ?? {};
  const cast = enchanting?.cast ?? {};
  // Do not mirror true workshop cast enchantments into the extension lane.
  if (String(enchanting?.enchantType ?? "").trim().toLowerCase() === "cast") return null;
  const hasSlots = Array.isArray(cast?.spells) && cast.spells.length > 0;
  const hasToggle = Object.prototype.hasOwnProperty.call(cast, "isSpellcastingEnabled");
  if (!hasSlots && !hasToggle) return null;
  return cast;
}

function _ensureItemSpellcastingFlags(item) {
  const existing = foundry.utils.deepClone(item?.flags?.[SYSTEM_ID]?.itemSpellcasting ?? {});
  const legacySeed = _buildLegacyExtensionSeed(item);
  const source = Object.keys(existing).length ? existing : (legacySeed ?? {});
  const sourcePool = source?.pool ?? {};
  const currentPoolValue = Number(sourcePool?.value ?? item?.system?.charge?.value ?? 0);
  const currentPoolMax = Number(sourcePool?.max ?? item?.system?.charge?.max ?? currentPoolValue);
  return {
    ...source,
    version: 2,
    enabled: source?.enabled === true,
    slots: Array.isArray(source?.slots) ? source.slots : [],
    pool: {
      value: Number.isFinite(currentPoolValue) ? currentPoolValue : 0,
      max: Number.isFinite(currentPoolMax) ? currentPoolMax : 0
    },
    activeUpkeepSlotId: source?.activeUpkeepSlotId ?? null
  };
}

function _extractStoredSpellAttributes(spellDocOrSnapshot) {
  const spellSystem = spellDocOrSnapshot?.system && typeof spellDocOrSnapshot.system === "object"
    ? spellDocOrSnapshot.system
    : null;
  if (!spellSystem) return "";

  const direct = spellSystem.attributes;
  if (Array.isArray(direct)) {
    return direct.map((value) => String(value ?? "").trim()).filter(Boolean).join(", ");
  }
  if (typeof direct === "string") return direct.trim();

  const derived = [];
  if (spellSystem.hasUpkeep === true) derived.push("upkeep");
  if (spellSystem.hasReinforce === true) derived.push("reinforce");
  if (spellSystem.hasOverload === true) derived.push("overload");
  return derived.join(", ");
}

function _escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function _deleteMaterializedStoredSpell(sheet, slot) {
  const actor = sheet?.actor ?? null;
  const embeddedId = String(slot?.actorSpellItemId ?? "").trim();
  if (!actor || !embeddedId) return;
  const embedded = actor.items?.get?.(embeddedId) ?? null;
  if (!embedded || !isHiddenStoredEnchantmentSpell(embedded)) return;
  try {
    await requestDeleteEmbeddedDocuments(actor, "Item", [embeddedId]);
  } catch (_e) {
    // no-op; stale hidden spell cleanup should not block config changes
  }
}

async function _materializeStoredEnchantmentSpell(sheet, spellDoc, slotId) {
  const actor = sheet?.actor ?? null;
  const sourceItem = sheet?.document ?? null;
  if (!actor || !sourceItem || !spellDoc || spellDoc.type !== "spell") return null;

  const slot = (_ensureItemSpellcastingFlags(sourceItem).slots ?? [])
    .find((entry) => String(entry?.id ?? "") === String(slotId ?? "")) ?? { id: slotId };
  const source = buildMaterializedStoredSpellSource(buildStoredSpellSnapshot(spellDoc), {
    sourceItem,
    slot,
    sourceLane: "extension"
  });
  if (!source) return null;

  const created = await requestCreateEmbeddedDocuments(actor, "Item", [source]);
  return Array.isArray(created) ? (created[0] ?? null) : null;
}

async function _openSpellPickerDialog({
  selectedUuid = "",
  selectedSpellName = "",
  selectedSpellSummary = "",
  canSelectKnownSpells = false,
  knownSpellOptions = []
} = {}) {
  const options = Array.isArray(knownSpellOptions) ? knownSpellOptions : [];
  const selectedValue = String(selectedUuid ?? "").trim();
  const optionsHtml = options.length
    ? options.map((option) => {
        const value = String(option?.value ?? "").trim();
        const label = String(option?.label ?? "").trim() || "Spell";
        const summary = String(option?.summary ?? "").trim();
        const text = summary ? `${label} (${summary})` : label;
        return `<option value="${_escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${_escapeHtml(text)}</option>`;
      }).join("")
    : `<option value="">${_escapeHtml("No actor-owned spells available.")}</option>`;

  const currentSummary = [selectedSpellName, selectedSpellSummary].filter(Boolean).join(" - ");
  return customDialog({
    title: "Select stored spell",
    content: `
      <div class="uesrpg-stored-spell-picker">
        ${currentSummary ? `<p class="notes">${_escapeHtml(currentSummary)}</p>` : ""}
        <div class="form-group">
          <label><b>Select stored spell</b></label>
          <select name="knownSpellUuid" style="width:100%;" ${canSelectKnownSpells ? "" : "disabled"}>
            ${optionsHtml}
          </select>
        </div>
        <div class="form-group">
          <label><b>Spell UUID</b></label>
          <input type="text" name="spellUuid" value="${_escapeHtml(selectedValue)}" placeholder="Item.<id> or full UUID" />
        </div>
      </div>
    `,
    buttons: {
      select: {
        label: "Select",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return {
            knownSpellId: String(root?.querySelector('[name="knownSpellUuid"]')?.value ?? "").trim(),
            spellUuid: String(root?.querySelector('[name="spellUuid"]')?.value ?? "").trim()
          };
        }
      },
      cancel: {
        label: "Cancel",
        callback: () => null
      }
    },
    default: "select",
    width: 420
  });
}

/* ── Private: scroll spell resolution ─────────────────────────────────────── */

/**
 * Normalize manually entered spell references into a canonical UUID if possible.
 * Accepts full UUIDs and world item ids.
 * @param {string} raw
 * @returns {Promise<string>}
 */
async function _normalizeScrollSpellUuid(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  // UUID-like text; resolve if possible.
  if (value.includes(".")) {
    try {
      const doc = await fromUuid(value);
      if (doc?.documentName === "Item") return String(doc.uuid ?? value);
    } catch (_err) {
      // Fall through to id lookup.
    }
  }

  // World item id fallback.
  const worldItem = game.items?.get?.(value) ?? null;
  if (worldItem?.documentName === "Item") return String(worldItem.uuid ?? value);

  return value;
}

/* ── Exported: scroll spell resolution (also used by _onDrop in item-sheet.js) ── */

/**
 * Resolve and validate a scroll spell reference.
 * @param {string|Item|null} rawOrDoc
 * @returns {Promise<{ok: boolean, spellDoc: Item|null, canonicalUuid: string, error?: string}>}
 */
export async function resolveAndValidateScrollSpell(rawOrDoc) {
  if (!rawOrDoc) {
    return { ok: true, spellDoc: null, canonicalUuid: "" };
  }

  let doc = rawOrDoc;

  if (typeof rawOrDoc === "string") {
    const normalized = await _normalizeScrollSpellUuid(rawOrDoc);
    if (!normalized) return { ok: true, spellDoc: null, canonicalUuid: "" };
    try {
      doc = await fromUuid(normalized);
    } catch (_err) {
      doc = null;
    }
    if (!doc) {
      return { ok: false, spellDoc: null, canonicalUuid: "", error: "Could not resolve spell UUID." };
    }
  }

  if (doc?.documentName !== "Item") {
    return { ok: false, spellDoc: null, canonicalUuid: "", error: "Dropped or referenced document is not an Item." };
  }

  if (String(doc.type ?? "") !== "spell") {
    return { ok: false, spellDoc: null, canonicalUuid: "", error: "Only spell items can be linked to a scroll." };
  }

  return { ok: true, spellDoc: doc, canonicalUuid: String(doc.uuid ?? "") };
}

/**
 * Persist scroll spell link (or clear it).
 * @param {SimpleItemSheetV2} sheet
 * @param {Item|null} spellDocOrNull
 */
export async function applyScrollSpellLink(sheet, spellDocOrNull) {
  const nextUuid = String(spellDocOrNull?.uuid ?? "");
  const ok = await requestUpdateDocument(sheet.document, { "system.spellUuid": nextUuid });
  if (!ok) {
    ui.notifications?.warn?.("Failed to update scroll spell reference.");
    return;
  }

  if (spellDocOrNull) {
    ui.notifications?.info?.(`Scroll linked to "${spellDocOrNull.name}".`);
  } else {
    ui.notifications?.info?.("Scroll spell reference cleared.");
  }
}

/* ── Exported: action handlers ────────────────────────────────────────────── */

/**
 * Cast the spell referenced by this scroll.
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 * @param {HTMLElement} target
 */
export async function onCastScroll(sheet, event, target) {
  event.preventDefault();

  const scroll = sheet.document;

  const result = await castScrollFromItem({
    scrollItem: scroll,
    casterActor: sheet.actor,
    castActionType: "primary",
  });

  if (result?.error) {
    ui.notifications.warn(result.error);
    return;
  }

  if (result?.consumed === true && Number(result.newQty ?? 1) === 0) {
    ui.notifications.info(`${scroll.name} has been used up.`);
  }
}

/**
 * Toggle item spellcasting enabled flag.
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 * @param {HTMLElement} target
 */
export async function onToggleSpellcastingEnable(sheet, event, target) {
  event?.preventDefault?.();
  if (!sheet.isEditable) return;
  if (!_isSpellcastingEligibleItem(sheet.document)) {
    ui.notifications?.warn?.("Spellcasting configuration is available only for equipment items.");
    return;
  }

  const spellcasting = _ensureItemSpellcastingFlags(sheet.document);
  const nextEnabled = spellcasting.enabled !== true;
  spellcasting.enabled = nextEnabled;
  await requestUpdateDocument(sheet.document, {
    [`flags.${SYSTEM_ID}.itemSpellcasting`]: spellcasting
  });
}

/**
 * Add a new stored spell slot.
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 * @param {HTMLElement} target
 */
export async function onAddSpellcastingSlot(sheet, event, target) {
  event?.preventDefault?.();
  if (!sheet.isEditable) return;
  if (!_isSpellcastingEligibleItem(sheet.document)) return;

  const spellcasting = _ensureItemSpellcastingFlags(sheet.document);
  const slots = Array.isArray(spellcasting.slots) ? spellcasting.slots : [];
  const nextIndex = slots.length + 1;
  slots.push({
    id: foundry.utils.randomID(12),
    source: "conventional",
    label: `Stored Spell ${nextIndex}`,
    level: 1,
    cost: 0,
    attributes: "",
    spellUuid: "",
    actorSpellItemId: "",
    snapshot: null,
    bindingStrength: 1,
    enabled: true,
    skipCastingTest: true,
    costMode: "soul"
  });
  spellcasting.slots = slots;

  await requestUpdateDocument(sheet.document, {
    [`flags.${SYSTEM_ID}.itemSpellcasting`]: spellcasting
  });
}

/**
 * Remove a stored spell slot by id.
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 * @param {HTMLElement} target
 */
export async function onRemoveSpellcastingSlot(sheet, event, target) {
  event?.preventDefault?.();
  if (!sheet.isEditable) return;
  const slotId = String(target?.dataset?.slotId ?? "").trim();
  if (!slotId) return;

  const spellcasting = _ensureItemSpellcastingFlags(sheet.document);
  const slots = Array.isArray(spellcasting.slots) ? spellcasting.slots : [];
  const removedSlot = slots.find((slot) => String(slot?.id ?? "") === slotId) ?? null;
  if (removedSlot) await _deleteMaterializedStoredSpell(sheet, removedSlot);

  spellcasting.slots = slots.filter((slot) => String(slot?.id ?? "") !== slotId);

  await requestUpdateDocument(sheet.document, {
    [`flags.${SYSTEM_ID}.itemSpellcasting`]: spellcasting
  });
}

export async function onClearSpellcastingStoredSpell(sheet, event, target) {
  event?.preventDefault?.();
  if (!sheet.isEditable) return;
  const slotId = String(target?.dataset?.slotId ?? "").trim();
  if (!slotId) return;

  const spellcasting = _ensureItemSpellcastingFlags(sheet.document);
  const slots = Array.isArray(spellcasting.slots) ? spellcasting.slots : [];
  const slot = slots.find((entry) => String(entry?.id ?? "") === slotId) ?? null;
  if (!slot) return;

  await _deleteMaterializedStoredSpell(sheet, slot);

  Object.assign(slot, {
    label: `Stored Spell ${slots.findIndex((entry) => entry === slot) + 1}`,
    source: "conventional",
    attributes: "",
    spellUuid: "",
    actorSpellItemId: "",
    snapshot: null
  });

  await requestUpdateDocument(sheet.document, {
    [`flags.${SYSTEM_ID}.itemSpellcasting`]: spellcasting
  });
}

async function _assignSpellToSpellcastingSlot(sheet, slotId, spellDoc) {
  if (!sheet?.isEditable) return false;
  if (!_isSpellcastingEligibleItem(sheet.document)) return false;

  const resolvedSpell = spellDoc?.type === "spell"
    ? spellDoc
    : await resolveStoredSpellDocument(String(spellDoc ?? "").trim());

  if (!resolvedSpell || resolvedSpell.type !== "spell") {
    ui.notifications?.warn?.("Only spell items can be assigned to an enchantment slot.");
    return false;
  }

  const spellcasting = _ensureItemSpellcastingFlags(sheet.document);
  const slots = Array.isArray(spellcasting.slots) ? spellcasting.slots.map((slot) => foundry.utils.deepClone(slot)) : [];
  const idx = slots.findIndex((slot) => String(slot?.id ?? "") === String(slotId ?? ""));
  if (idx < 0) return false;

  const current = slots[idx] ?? {};
  const next = foundry.utils.deepClone(current);
  await _deleteMaterializedStoredSpell(sheet, current);
  const storedSpell = await _materializeStoredEnchantmentSpell(sheet, resolvedSpell, slotId);

  next.spellUuid = itemUuid(resolvedSpell) ?? String(resolvedSpell?.uuid ?? "").trim();
  next.actorSpellItemId = String(storedSpell?.id ?? "");
  next.label = String(resolvedSpell.name ?? next.label ?? "Stored Spell").trim() || "Stored Spell";
  next.source = String(resolvedSpell.system?.spellType ?? next.source ?? "conventional").trim() || "conventional";
  next.snapshot = buildStoredSpellSnapshot(resolvedSpell);
  next.attributes = _extractStoredSpellAttributes(storedSpell ?? resolvedSpell);
  next.bindingStrength = Math.max(1, Number(next.bindingStrength ?? 1) || 1);
  next.enabled = next.enabled !== false;
  next.skipCastingTest = _normalizeSpellcastingSkipCastingTest(next.skipCastingTest);
  next.costMode = _normalizeSpellcastingCostMode(next.costMode);

  const baseLevel = Math.max(1, Number(resolvedSpell.system?.level ?? next.level ?? 1) || 1);
  next.level = Number.isFinite(baseLevel) && baseLevel > 0 ? baseLevel : 1;
  next.cost = Math.max(0, Number(resolvedSpell.system?.cost ?? next.cost ?? 0) || 0);

  slots[idx] = next;
  spellcasting.slots = slots;

  await requestUpdateDocument(sheet.document, {
    [`flags.${SYSTEM_ID}.itemSpellcasting`]: spellcasting
  });
  return true;
}

export async function handleItemSpellcastingSlotDrop(sheet, event, slotId) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (!sheet?.isEditable || !slotId) return false;

  const droppedItem = await resolveDroppedItem(readDropData(event));
  if (!droppedItem) return false;
  if (droppedItem.type !== "spell") {
    ui.notifications?.warn?.("Drop a spell item to link this enchantment slot.");
    return false;
  }

  return _assignSpellToSpellcastingSlot(sheet, slotId, droppedItem);
}

/**
 * Batch-edit all slot fields from current DOM state.
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 * @param {HTMLElement} target
 */
export async function onEditSpellcastingSlot(sheet, event, target) {
  event?.preventDefault?.();
  if (!sheet.isEditable) return;

  const spellcasting = _ensureItemSpellcastingFlags(sheet.document);
  const rows = Array.from(sheet.element?.querySelectorAll?.("[data-spellcasting-slot-id]") ?? []);
  const byId = new Map((Array.isArray(spellcasting.slots) ? spellcasting.slots : []).map((s) => [String(s?.id ?? ""), s]));
  const nextSlots = [];

  for (const row of rows) {
    const slotId = String(row?.dataset?.spellcastingSlotId ?? "").trim();
    if (!slotId) continue;
    const prev = byId.get(slotId) ?? { id: slotId };
    const labelInput = row.querySelector("[data-spellcasting-field='label']");
    const levelInput = row.querySelector("[data-spellcasting-field='level']");
    const costInput = row.querySelector("[data-spellcasting-field='cost']");
    const bsInput = row.querySelector("[data-spellcasting-field='bindingStrength']");
    const modeInput = row.querySelector("[data-spellcasting-field='costMode']");
    const enabledInput = row.querySelector("[data-spellcasting-field='enabled']");
    const skipCastingTestInput = row.querySelector("[data-spellcasting-field='skipCastingTest']");

    const snapshot = prev?.snapshot ?? null;
    const fallbackLabel = String(snapshot?.name ?? prev?.label ?? "Stored Spell").trim() || "Stored Spell";
    const label = String(labelInput?.value ?? fallbackLabel).trim() || fallbackLabel;
    const level = Math.max(1, Number(levelInput?.value ?? prev?.level ?? 1) || 1);
    const cost = Math.max(0, Number(costInput?.value ?? prev?.cost ?? 0) || 0);
    const bindingStrength = Math.max(0, Math.min(10, Number(bsInput?.value ?? prev?.bindingStrength ?? 0) || 0));
    const costMode = _normalizeSpellcastingCostMode(modeInput?.value ?? prev?.costMode);
    const enabled = enabledInput ? enabledInput.checked === true : prev?.enabled !== false;
    const skipCastingTest = skipCastingTestInput
      ? skipCastingTestInput.checked === true
      : _normalizeSpellcastingSkipCastingTest(prev?.skipCastingTest);
    const spellUuid = String(prev?.spellUuid ?? "").trim();
    const actorSpellItemId = String(prev?.actorSpellItemId ?? "").trim();
    const source = String(prev?.source ?? snapshot?.system?.spellType ?? "conventional").trim().toLowerCase() === "unconventional"
      ? "unconventional"
      : "conventional";
    const attributes = _extractStoredSpellAttributes(snapshot) || prev?.attributes || "";

    const hasSpellRef = spellUuid.length > 0 || actorSpellItemId.length > 0 || !!snapshot;
    if (enabled && !hasSpellRef) {
      ui.notifications?.warn?.(`Slot "${label}" must have a selected spell before enabling.`);
      return;
    }

    nextSlots.push({
      ...prev,
      id: slotId,
      source,
      label,
      level,
      cost,
      attributes,
      spellUuid,
      actorSpellItemId,
      snapshot,
      bindingStrength,
      costMode,
      enabled,
      skipCastingTest
    });
  }

  spellcasting.slots = nextSlots;

  const chargeValueInput = sheet.element?.querySelector?.("[data-spellcasting-charge='value']");
  const chargeMaxInput = sheet.element?.querySelector?.("[data-spellcasting-charge='max']");
  const nextChargeValue = Math.max(0, Number(chargeValueInput?.value ?? sheet.document?.system?.charge?.value ?? 0) || 0);
  const nextChargeMaxRaw = Math.max(0, Number(chargeMaxInput?.value ?? sheet.document?.system?.charge?.max ?? 0) || 0);
  const nextChargeMax = Math.max(nextChargeValue, nextChargeMaxRaw);

  await requestUpdateDocument(sheet.document, {
    [`flags.${SYSTEM_ID}.itemSpellcasting`]: spellcasting,
    "system.charge.value": nextChargeValue,
    "system.charge.max": nextChargeMax
  });
}

/**
 * Open a spell-picker dialog and assign the chosen spell to a slot.
 * @param {SimpleItemSheetV2} sheet
 * @param {Event} event
 * @param {HTMLElement} target
 */
export async function onPickSpellcastingSlotSpell(sheet, event, target) {
  event?.preventDefault?.();
  if (!sheet.isEditable) return;
  const slotId = String(target?.dataset?.slotId ?? "").trim();
  if (!slotId) return;

  const spellcasting = _ensureItemSpellcastingFlags(sheet.document);
  const slot = (Array.isArray(spellcasting.slots) ? spellcasting.slots : []).find((entry) => String(entry?.id ?? "") === slotId) ?? null;
  const currentState = buildStoredSpellOptionState({
    actor: sheet.document?.actor ?? null,
    selectedUuid: String(slot?.spellUuid ?? "").trim(),
    storedSpellSnapshot: slot?.snapshot ?? null
  });

  const pick = await _openSpellPickerDialog({
    sheet,
    selectedUuid: currentState.selectedUuid,
    selectedSpellName: currentState.selectedSpellName,
    selectedSpellSummary: currentState.selectedSpellSummary,
    canSelectKnownSpells: currentState.canSelectKnownSpells,
    knownSpellOptions: currentState.options
  });
  if (!pick) return;

  const knownSpellId = String(pick?.knownSpellId ?? "").trim();
  const spellUuid = String(pick?.spellUuid ?? "").trim();
  const selectedRef = knownSpellId || spellUuid;
  if (!selectedRef) {
    ui.notifications?.warn?.("Select a known spell or provide a spell UUID.");
    return;
  }

  const spellDoc = await resolveStoredSpellDocument(selectedRef);
  if (!spellDoc || spellDoc.type !== "spell") {
    ui.notifications?.warn?.("The selected spell could not be resolved.");
    return;
  }

  await _assignSpellToSpellcastingSlot(sheet, slotId, spellDoc);
}

/* ── Exported: listener registration ──────────────────────────────────────── */

/**
 * Scroll sheet: live spell UUID validation + drag-drop zone binding.
 * Called from _attachPartListeners for scroll-type items.
 *
 * @param {SimpleItemSheetV2} sheet
 * @param {HTMLElement} el
 */
export function registerItemSpellcastingListeners(sheet, el) {
  const dropZones = Array.from(el.querySelectorAll('[data-item-spell-drop-slot]'));
  for (const dropZone of dropZones) {
    if (dropZone.dataset.itemSpellDropBound === "true") continue;
    dropZone.dataset.itemSpellDropBound = "true";

    const clearDragState = () => dropZone.classList.remove("drag-over");
    const markDragState = (event) => {
      if (!sheet?.isEditable) return;
      event?.preventDefault?.();
      dropZone.classList.add("drag-over");
    };

    dropZone.addEventListener("dragenter", markDragState);
    dropZone.addEventListener("dragover", markDragState);
    dropZone.addEventListener("dragleave", (event) => {
      const related = event?.relatedTarget;
      if (related && dropZone.contains(related)) return;
      clearDragState();
    });
    dropZone.addEventListener("drop", async (event) => {
      clearDragState();
      const slotId = String(dropZone.dataset.itemSpellDropSlot ?? "").trim();
      await handleItemSpellcastingSlotDrop(sheet, event, slotId);
    });
  }
}

export function registerScrollListeners(sheet, el) {
  const uuidInput = el.querySelector('input[name="system.spellUuid"]');
  const dropZone = el.querySelector('[data-scroll-spell-drop-zone="true"]');

  const commitInputValue = async () => {
    if (!sheet.isEditable) return;
    if (!uuidInput) return;

    const result = await resolveAndValidateScrollSpell(uuidInput.value);
    if (!result.ok) {
      ui.notifications?.warn?.(result.error ?? "Invalid spell UUID.");
      uuidInput.value = String(sheet.document.system?.spellUuid ?? "");
      return;
    }

    await applyScrollSpellLink(sheet, result.spellDoc);
    uuidInput.value = String(result.canonicalUuid ?? "");
  };

  if (uuidInput) {
    uuidInput.addEventListener("change", async () => {
      await commitInputValue();
    });

    uuidInput.addEventListener("keydown", async (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      await commitInputValue();
    });
  }

  if (!dropZone) return;

  dropZone.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "link";
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", (ev) => {
    const rect = dropZone.getBoundingClientRect();
    const x = ev.clientX;
    const y = ev.clientY;
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      dropZone.classList.remove("drag-over");
    }
  });

  dropZone.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    dropZone.classList.remove("drag-over");
    if (!sheet.isEditable) return;

    const dragData = readDropData(ev);
    const dropped = await resolveDroppedItem(dragData);
    if (!dropped) {
      ui.notifications?.warn?.("Unable to resolve dropped item payload.");
      return;
    }

    const result = await resolveAndValidateScrollSpell(dropped);
    if (!result.ok) {
      ui.notifications?.warn?.(result.error ?? "Unable to resolve dropped item payload.");
      return;
    }

    await applyScrollSpellLink(sheet, result.spellDoc);
    if (uuidInput) uuidInput.value = String(result.canonicalUuid ?? "");
  });
}
