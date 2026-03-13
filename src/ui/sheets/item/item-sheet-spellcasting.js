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

import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { castScrollFromItem } from "../../../core/magic/scroll-casting.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { resolveDroppedItem } from "../../../utils/drop-data.js";
import { SYSTEM_ID } from "../../constants.js";

/* ── Private: spellcasting flag utilities ─────────────────────────────────── */

const _EQUIPMENT_ITEM_TYPES = new Set(["weapon", "armor", "shield", "ammunition", "equipment", "scroll"]);

function _normalizeSpellcastingCostMode(value) {
  const mode = String(value ?? "soul").trim().toLowerCase();
  if (mode === "magicka" || mode === "none") return mode;
  return "soul";
}

function _isSpellcastingEligibleItem(item) {
  return _EQUIPMENT_ITEM_TYPES.has(String(item?.type ?? "").toLowerCase());
}

function _buildSpellSnapshot(spell) {
  if (!spell || spell.type !== "spell") return null;
  const src = spell.toObject(false);
  return {
    name: src.name,
    type: "spell",
    img: src.img,
    system: {
      school: src.system?.school ?? "",
      level: Number(src.system?.level ?? 1),
      cost: Number(src.system?.cost ?? 0),
      hasUpkeep: src.system?.hasUpkeep === true,
      isDirect: src.system?.isDirect === true,
      hasBuffer: src.system?.hasBuffer === true,
      hasOverTime: src.system?.hasOverTime === true,
      hasOverload: src.system?.hasOverload === true,
      isRuneSpell: src.system?.isRuneSpell === true,
      isZonePersistent: src.system?.isZonePersistent === true,
      isSummonSpell: src.system?.isSummonSpell === true,
      rangeType: src.system?.rangeType ?? src.system?.range ?? "",
      aoeIncludeCaster: src.system?.aoeIncludeCaster === true,
      duration: src.system?.duration ?? {},
      damageInstances: Array.isArray(src.system?.damageInstances) ? src.system.damageInstances : [],
      targeting: src.system?.targeting ?? null,
      engine: src.system?.engine ?? null,
      defenseModel: src.system?.defenseModel ?? null,
      characteristicDefense: src.system?.characteristicDefense ?? null,
      overTimeEntries: Array.isArray(src.system?.overTimeEntries) ? src.system.overTimeEntries : []
    }
  };
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
    attributes: [],
    spellUuid: "",
    snapshot: null,
    bindingStrength: 1,
    enabled: true,
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
  spellcasting.slots = (Array.isArray(spellcasting.slots) ? spellcasting.slots : [])
    .filter((s) => String(s?.id ?? "") !== slotId);

  await requestUpdateDocument(sheet.document, {
    [`flags.${SYSTEM_ID}.itemSpellcasting`]: spellcasting
  });
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
    const costInput = row.querySelector("[data-spellcasting-field='cost']");
    const bsInput = row.querySelector("[data-spellcasting-field='bindingStrength']");
    const modeInput = row.querySelector("[data-spellcasting-field='costMode']");
    const enabledInput = row.querySelector("[data-spellcasting-field='enabled']");

    const label = String(labelInput?.value ?? prev?.label ?? "Stored Spell").trim() || "Stored Spell";
    const cost = Math.max(0, Number(costInput?.value ?? prev?.cost ?? 0) || 0);
    const bindingStrength = Math.max(0, Math.min(10, Number(bsInput?.value ?? prev?.bindingStrength ?? 0) || 0));
    const costMode = _normalizeSpellcastingCostMode(modeInput?.value ?? prev?.costMode);
    const enabled = enabledInput ? enabledInput.checked === true : prev?.enabled !== false;
    const hasSpellRef = String(prev?.spellUuid ?? "").trim().length > 0 || !!prev?.snapshot;
    if (enabled && !hasSpellRef) {
      ui.notifications?.warn?.(`Slot "${label}" must have a selected spell before enabling.`);
      return;
    }

    nextSlots.push({
      ...prev,
      id: slotId,
      label,
      cost,
      bindingStrength,
      costMode,
      enabled
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

  const actorSpells = Array.from(sheet.actor?.items ?? []).filter((i) => i?.type === "spell");
  const spellOptions = actorSpells
    .map((s) => `<option value="${String(s.id)}">${s.name} (${String(s.system?.school ?? "")} L${Number(s.system?.level ?? 1)})</option>`)
    .join("");

  const content = `
    <div class="uesrpg-cast-slot-picker">
      <div class="form-group">
        <label><b>Actor Spell</b></label>
        <select name="knownSpellId" style="width:100%;">
          <option value="">-- Use UUID below --</option>
          ${spellOptions}
        </select>
      </div>
      <div class="form-group">
        <label><b>Spell UUID (fallback)</b></label>
        <input type="text" name="spellUuid" style="width:100%;" placeholder="Compendium.x.y or Actor.x.Item.y" />
      </div>
    </div>
  `;

  const pick = await customDialog({
    title: "Select Stored Spell",
    content,
    yes: {
      label: "Set Spell",
      callback: (html) => {
        const root = html instanceof HTMLElement ? html : html?.[0];
        return {
          knownSpellId: String(root?.querySelector?.("select[name='knownSpellId']")?.value ?? "").trim(),
          spellUuid: String(root?.querySelector?.("input[name='spellUuid']")?.value ?? "").trim()
        };
      }
    },
    no: { label: "Cancel" },
    defaultButton: "yes"
  });
  if (!pick) return;

  const spellcasting = _ensureItemSpellcastingFlags(sheet.document);
  const slots = Array.isArray(spellcasting.slots) ? spellcasting.slots : [];
  const idx = slots.findIndex((s) => String(s?.id ?? "") === slotId);
  if (idx < 0) return;

  const next = foundry.utils.deepClone(slots[idx]);
  let spellDoc = null;
  if (pick.knownSpellId && sheet.actor) {
    spellDoc = sheet.actor.items.get(pick.knownSpellId) ?? null;
    next.spellUuid = String(spellDoc?.uuid ?? "");
  } else if (pick.spellUuid) {
    next.spellUuid = pick.spellUuid;
    try {
      const doc = await fromUuid(pick.spellUuid);
      if (doc?.documentName === "Item" && doc.type === "spell") spellDoc = doc;
    } catch (_err) {
      spellDoc = null;
    }
  } else {
    ui.notifications?.warn?.("Select a known spell or provide a spell UUID.");
    return;
  }

  if (spellDoc?.type === "spell") {
    next.label = String(spellDoc.name ?? next.label ?? "Stored Spell");
    next.level = Number(spellDoc.system?.level ?? next.level ?? 1);
    next.snapshot = _buildSpellSnapshot(spellDoc);
    if (!(Number(next.cost) > 0)) {
      next.cost = Number(spellDoc.system?.cost ?? 0);
    }
  }

  slots[idx] = next;
  spellcasting.slots = slots;
  await requestUpdateDocument(sheet.document, {
    [`flags.${SYSTEM_ID}.itemSpellcasting`]: spellcasting
  });
}

/* ── Exported: listener registration ──────────────────────────────────────── */

/**
 * Scroll sheet: live spell UUID validation + drag-drop zone binding.
 * Called from _attachPartListeners for scroll-type items.
 *
 * @param {SimpleItemSheetV2} sheet
 * @param {HTMLElement} el
 */
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

    const dragData = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
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
