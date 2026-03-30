import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { alertDialog } from "../../../utils/dialog-v2-helper.js";
import { SYSTEM_ID } from "../../constants.js";
import { readDropData, resolveDroppedItemDetailed } from "../../../utils/drop-data.js";
import { resolveSpellProfile } from "../../../core/magic/spell-profile.js";
import { buildDirectAlchemyPayloadForSpell } from "../../../core/alchemy/workflow.js";
import { getSpellCost, getSpellScalingEntry } from "../../../core/magic/magicka-utils.js";
import {
  findActorSpellByUuid,
  getSpellAlchemyAttributes,
  getSpellLevelOptions,
} from "../../../core/alchemy/workflow-known-effects.js";
import { dndDebug, dndWarnFailure, makeDndTraceId } from "../../../utils/dnd-debugger.js";

export const ALCHEMY_PRODUCT_EFFECT_SLOT_COUNT = 3;
export const ALCHEMY_PRODUCT_DROP_SELECTOR = ".uesrpg-alchemy-product-dropzone";
const ALCHEMY_DROP_HANDLED_FLAG = "__uesAlchemyProductDropHandled";

function _getAlchemyFlags(itemDoc) {
  return itemDoc?.flags?.[SYSTEM_ID]?.alchemy ?? null;
}

function _getManualAlchemyMode(itemDoc) {
  const kind = String(_getAlchemyFlags(itemDoc)?.kind ?? "").trim().toLowerCase();
  return kind === "potion" || kind === "toxin" ? kind : null;
}

function _getStoredAlchemyEffects(itemDoc) {
  const effects = _getAlchemyFlags(itemDoc)?.effects;
  if (!Array.isArray(effects)) return [];
  return effects
    .filter((entry) => entry && typeof entry === "object")
    .slice(0, ALCHEMY_PRODUCT_EFFECT_SLOT_COUNT);
}

function _findAlchemyDropZone(event, fallback = null) {
  const target = event?.target;
  if (target instanceof Element) return target.closest(ALCHEMY_PRODUCT_DROP_SELECTOR) ?? fallback;
  return fallback;
}

function _cloneData(value) {
  try {
    return foundry.utils.deepClone(value);
  } catch (_err) {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

function _itemClass() {
  return CONFIG?.Item?.documentClass ?? globalThis.Item?.implementation ?? globalThis.Item;
}

function _buildFallbackSpellFromDropData(dropData) {
  const source = dropData?.data;
  if (!source || typeof source !== "object") return null;
  if (String(source.type ?? "").trim() !== "spell") return null;

  const ItemClass = _itemClass();
  if (!ItemClass?.fromSource) return null;

  try {
    const item = ItemClass.fromSource(source);
    return item?.type === "spell" ? item : null;
  } catch (_err) {
    return null;
  }
}

function _deriveSpellUuid(spell, dropData) {
  const direct = String(spell?.uuid ?? "").trim();
  if (direct) return direct;

  const normalized = dropData ?? {};
  const explicit = String(normalized?.uuid ?? normalized?.documentUuid ?? "").trim();
  if (explicit) return explicit;

  const itemId = String(normalized?.itemId ?? normalized?.id ?? "").trim();
  const actorUuid = String(normalized?.actorUuid ?? "").trim();
  const actorId = String(normalized?.actorId ?? "").trim();
  const pack = String(normalized?.pack ?? "").trim();

  if (pack && itemId) return `Compendium.${pack}.${itemId}`;
  if (actorUuid && itemId) return `${actorUuid}.Item.${itemId}`;
  if (actorId && itemId) return `Actor.${actorId}.Item.${itemId}`;
  if (itemId) return `Item.${itemId}`;
  return "";
}

function _resolveSpellForSheet(actor, spellUuid) {
  const wanted = String(spellUuid ?? "").trim();
  if (!wanted) return null;
  if (actor) {
    const actorSpell = findActorSpellByUuid(actor, wanted);
    if (actorSpell) return actorSpell;
  }
  if (typeof fromUuidSync !== "function") return null;
  try {
    const resolved = fromUuidSync(wanted);
    return resolved?.documentName === "Item" && resolved?.type === "spell" ? resolved : null;
  } catch (_err) {
    return null;
  }
}

async function _resolveSpellForSheetAsync(actor, spellUuid) {
  const syncResolved = _resolveSpellForSheet(actor, spellUuid);
  if (syncResolved) return syncResolved;
  const wanted = String(spellUuid ?? "").trim();
  if (!wanted) return null;
  try {
    const resolved = await fromUuid(wanted);
    return resolved?.documentName === "Item" && resolved?.type === "spell" ? resolved : null;
  } catch (_err) {
    return null;
  }
}

function _normalizeDuration(profileDuration) {
  if (!profileDuration || profileDuration.isInstant) return null;
  return {
    value: Math.max(0, Number(profileDuration.value ?? 0) || 0),
    unit: String(profileDuration.unit ?? "rounds"),
  };
}

function _resolveDurationWithoutActor(spell, level) {
  const scaling = getSpellScalingEntry(spell, level);
  const scaledDuration = scaling?.duration;
  const rawDuration = scaledDuration && typeof scaledDuration === "object" && scaledDuration.value != null
    ? scaledDuration
    : (spell?.system?.duration ?? {});
  const value = Math.max(0, Number(rawDuration?.value ?? 0) || 0);
  const unit = String(rawDuration?.unit ?? "rounds").trim().toLowerCase() || "rounds";
  if (!value || unit === "instant") return null;
  return { value, unit };
}

async function _showAlchemyEffectUpdateFailure(itemDoc, actionLabel) {
  const packId = String(itemDoc?.pack ?? "").trim();
  const pack = packId ? game.packs?.get?.(packId) ?? null : null;
  const locked = Boolean(pack?.locked);
  const content = packId
    ? `<p>Could not ${actionLabel} on this compendium item.</p><p>${locked ? "The compendium is locked." : "The compendium entry may be read-only or you may not have permission to edit it."}</p>`
    : `<p>Could not ${actionLabel} on this item.</p><p>The document update was rejected.</p>`;

  await alertDialog({
    title: "Alchemy Update Failed",
    content,
    buttonLabel: "OK",
  });
}

async function _updateAlchemyEffects(itemDoc, effects, actionLabel) {
  const ok = await requestUpdateDocument(itemDoc, {
    [`flags.${SYSTEM_ID}.alchemy.effects`]: effects,
  });
  if (!ok) await _showAlchemyEffectUpdateFailure(itemDoc, actionLabel);
  return ok;
}

function _validateSheetAndMode(sheet) {
  const actor = sheet?.actor ?? null;
  const itemDoc = sheet?.document ?? null;
  if (!itemDoc || sheet?.isEditable === false) {
    return { ok: false, reason: "You do not have permission to configure this alchemy product." };
  }

  const mode = _getManualAlchemyMode(itemDoc);
  if (!mode) {
    return { ok: false, reason: "Only potions and toxins support manual spell assignment." };
  }

  return { ok: true, actor, itemDoc, mode };
}

function _normalizeRequestedLevel(spell, requestedLevel = null) {
  const levelOptions = getSpellLevelOptions(spell);
  const fallbackLevel = levelOptions[0] ?? Math.max(1, Number(spell?.system?.level ?? 1) || 1);
  const numericLevel = Math.max(1, Number(requestedLevel ?? fallbackLevel) || fallbackLevel);
  return {
    spellLevel: levelOptions.includes(numericLevel) ? numericLevel : fallbackLevel,
    levelOptions,
  };
}

function _buildManualSpellEffectEntry(actor, spell, { mode, spellLevel = null, spellUuid = "" } = {}) {
  if (!spell || spell.type !== "spell") {
    return { ok: false, reason: "Only spell items can be assigned to alchemy products." };
  }

  const normalizedMode = String(mode ?? "").trim().toLowerCase();
  if (!(normalizedMode === "potion" || normalizedMode === "toxin")) {
    return { ok: false, reason: `Unsupported alchemy mode "${normalizedMode || "unknown"}".` };
  }

  const { spellLevel: finalLevel } = _normalizeRequestedLevel(spell, spellLevel);
  const profile = actor ? resolveSpellProfile(spell, actor, { level: finalLevel }) : null;
  const cost = Math.max(0, Number(profile?.cost?.final ?? profile?.cost?.attempt ?? getSpellCost(spell, finalLevel) ?? spell?.system?.cost ?? 0) || 0);
  const duration = actor ? _normalizeDuration(profile?.duration) : _resolveDurationWithoutActor(spell, finalLevel);
  const storedSpellUuid = String(spellUuid ?? spell?.uuid ?? "").trim();
  const payloadResult = buildDirectAlchemyPayloadForSpell(spell, {
    mode: normalizedMode,
    spellLevel: finalLevel,
    cost,
    finalDuration: duration,
  });
  const payload = payloadResult?.ok && payloadResult?.payload
    ? payloadResult.payload
    : {
        applicationKind: "spellEffects",
        spellUuid: storedSpellUuid,
        spellSnapshot: _cloneData(spell.toObject?.(false) ?? spell),
        spellLevel: finalLevel,
        damageType: "",
        finalDuration: duration,
      };
  if (payload) payload.spellUuid = storedSpellUuid;
  if (payload?.spellSnapshot?.system) {
    payload.spellSnapshot.system.level = finalLevel;
    payload.spellSnapshot.system.cost = cost;
    if (duration) payload.spellSnapshot.system.duration = _cloneData(duration);
  }

  return {
    ok: true,
    effectEntry: {
      effectSource: "spell",
      effectKey: null,
      effectLabel: String(spell.name ?? "Unknown Spell"),
      spellUuid: storedSpellUuid,
      spellName: String(spell.name ?? "Unknown Spell"),
      school: String(profile?.metadata?.school ?? spell?.system?.school ?? "").toLowerCase(),
      spellLevel: finalLevel,
      attributes: getSpellAlchemyAttributes(spell),
      cost,
      baseDuration: duration,
      finalDuration: duration,
      params: {},
      toxinOverrides: {},
      mode: normalizedMode,
      directPayload: _cloneData(payload),
    },
  };
}

function _getNextEffectsAfterAssignment(existingEffects, slotIdx, effectEntry) {
  const next = existingEffects.slice(0, ALCHEMY_PRODUCT_EFFECT_SLOT_COUNT);
  if (slotIdx < next.length) {
    next[slotIdx] = effectEntry;
  } else {
    next.push(effectEntry);
  }
  return next.slice(0, ALCHEMY_PRODUCT_EFFECT_SLOT_COUNT);
}

async function _commitAlchemyDrop(sheet, event, fallbackZone = null) {
  if (event?.[ALCHEMY_DROP_HANDLED_FLAG] === true) return;
  event[ALCHEMY_DROP_HANDLED_FLAG] = true;

  const dropZone = _findAlchemyDropZone(event, fallbackZone);
  const slotIdx = Number.parseInt(String(dropZone?.dataset?.alchemyProductDropSlot ?? ""), 10);
  if (!Number.isFinite(slotIdx) || slotIdx < 0) return;

  try {
    const result = await handleAlchemyProductSpellDrop(sheet, event, slotIdx);
    if (!result?.ok) return;

    ui.notifications?.info?.(`Assigned ${result.spellName} to Slot ${slotIdx + 1}.`);
    await sheet.render();
  } catch (error) {
    console.error("[UESRPG][AlchemyProductDrop] Drop commit failed", error);
    ui.notifications?.error?.("Alchemy spell drop failed unexpectedly. Check the browser console for details.");
  }
}

export function registerAlchemyProductListeners(sheet, el) {
  if (el && el.dataset.alchemyDropRootBound !== "true") {
    el.dataset.alchemyDropRootBound = "true";
    el.addEventListener("drop", async (ev) => {
      const dropZone = _findAlchemyDropZone(ev);
      if (!dropZone) return;
      ev.preventDefault();
      ev.stopPropagation();
      dropZone.classList.remove("drag-over");
      if (!sheet.isEditable) return;
      await _commitAlchemyDrop(sheet, ev, dropZone);
    }, true);
  }

  const zones = Array.from(el?.querySelectorAll?.(ALCHEMY_PRODUCT_DROP_SELECTOR) ?? []);
  for (const zone of zones) {
    if (zone.dataset.alchemyDropBound === "true") continue;
    zone.dataset.alchemyDropBound = "true";

    zone.addEventListener("dragover", (ev) => {
      if (!sheet.isEditable) return;
      ev.preventDefault();
      ev.stopPropagation();
      zone.classList.add("drag-over");
    });

    zone.addEventListener("dragleave", (ev) => {
      const rect = zone.getBoundingClientRect();
      const x = ev.clientX;
      const y = ev.clientY;
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
        zone.classList.remove("drag-over");
      }
    });

    zone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      zone.classList.remove("drag-over");
      if (!sheet.isEditable) return;
      await _commitAlchemyDrop(sheet, ev, zone);
    });
  }
}

export async function handleAlchemyProductSpellDrop(sheet, event, slotIdx) {
  try {
    const traceId = makeDndTraceId("alchemy-drop");
    const sheetState = _validateSheetAndMode(sheet);
    if (!sheetState.ok) {
      ui.notifications.warn(sheetState.reason);
      return false;
    }

    const { actor, itemDoc, mode } = sheetState;
    const dropData = readDropData(event, { traceId });
    dndDebug("alchemy.drop.received", {
      item: itemDoc?.uuid ?? null,
      actor: actor?.uuid ?? null,
      type: dropData?.type ?? null,
      uuid: dropData?.uuid ?? null,
      itemId: dropData?.itemId ?? dropData?.id ?? null,
      actorUuid: dropData?.actorUuid ?? null,
      pack: dropData?.pack ?? null,
      slotIdx,
    }, { traceId });
    if (!dropData || dropData.type !== "Item") {
      dndWarnFailure("Alchemy drop data was not recognized as an Item payload.", {
        traceId,
        details: { dropData, slotIdx, item: itemDoc?.uuid ?? null },
      });
      ui.notifications.warn("Drop data could not be read as an Item payload.");
      return false;
    }

    const resolved = await resolveDroppedItemDetailed(dropData, { traceId });
    let spell = resolved.item ?? null;
    if ((!spell || spell.type !== "spell") && dropData?.data) {
      spell = _buildFallbackSpellFromDropData(dropData);
    }
    if (!spell) {
      dndDebug("alchemy.drop.unresolved", {
        item: itemDoc?.uuid ?? null,
        slotIdx,
        dropData,
        resolved,
      }, { traceId });
      dndWarnFailure("Alchemy spell drop could not resolve the dragged item.", {
        traceId,
        details: { dropData, resolved, slotIdx, item: itemDoc?.uuid ?? null },
      });
      const path = Array.isArray(resolved?.resolutionPath) && resolved.resolutionPath.length
        ? resolved.resolutionPath.join(" -> ")
        : "no resolution path";
      ui.notifications.warn(`Unable to resolve dropped spell item. Source path: ${path}.`);
      return false;
    }
    if (spell.type !== "spell") {
      dndWarnFailure("Alchemy drop rejected because the dragged item was not a spell.", {
        traceId,
        details: {
          itemType: spell.type ?? null,
          dropData,
          resolved,
          slotIdx,
          item: itemDoc?.uuid ?? null,
        },
      });
      ui.notifications.warn("Drop a spell item into an alchemy effect slot.");
      return false;
    }

    const spellUuid = _deriveSpellUuid(spell, resolved?.dropData ?? dropData);

    const effects = _getStoredAlchemyEffects(itemDoc);
    const targetIdx = slotIdx < effects.length ? slotIdx : effects.length;
    const duplicate = spellUuid
      ? effects.some((entry, idx) => idx !== targetIdx && String(entry?.spellUuid ?? "") === spellUuid)
      : false;
    if (duplicate) {
      ui.notifications.warn("Each spell effect may only be selected once per alchemy product.");
      return false;
    }

    if (targetIdx >= ALCHEMY_PRODUCT_EFFECT_SLOT_COUNT) {
      ui.notifications.warn("This alchemy product already has the maximum number of effects.");
      return false;
    }

    const existingEntry = effects[targetIdx] ?? null;
    const requestedLevel = existingEntry && String(existingEntry?.spellUuid ?? "") === spellUuid
      ? Number(existingEntry?.spellLevel ?? 1) || 1
      : null;
    const built = _buildManualSpellEffectEntry(actor, spell, {
      mode,
      spellLevel: requestedLevel,
      spellUuid,
    });
    if (!built.ok) {
      dndWarnFailure("Alchemy drop failed while building the stored spell effect.", {
        traceId,
        details: {
          reason: built.reason,
          spellUuid,
          spellName: spell.name ?? null,
          dropData,
          resolved,
        },
      });
      ui.notifications.warn(built.reason);
      return false;
    }

    const nextEffects = _getNextEffectsAfterAssignment(effects, targetIdx, built.effectEntry);
    const ok = await _updateAlchemyEffects(itemDoc, nextEffects, `assign ${spell.name ?? "spell"} to alchemy product`);
    if (!ok) {
      dndWarnFailure("Alchemy drop failed because the item update was rejected.", {
        traceId,
        details: {
          spellUuid,
          spellName: spell.name ?? null,
          item: itemDoc?.uuid ?? null,
          slotIdx: targetIdx,
        },
      });
      ui.notifications.warn(`Failed to assign ${spell.name ?? "spell"} to Slot ${targetIdx + 1}.`);
      return false;
    }
    dndDebug("alchemy.drop.assigned", {
      item: itemDoc?.uuid ?? null,
      spellUuid,
      spellName: spell.name ?? null,
      sourceKind: resolved?.sourceKind ?? null,
      resolutionPath: resolved?.resolutionPath ?? [],
      slotIdx: targetIdx,
    }, { traceId });
    return {
      ok,
      spellName: String(spell.name ?? "Spell"),
      slotIdx: targetIdx,
    };
  } catch (error) {
    console.error("[UESRPG][AlchemyProductDrop] handleAlchemyProductSpellDrop failed", error);
    ui.notifications?.error?.("Alchemy spell drop failed unexpectedly. Check the browser console for details.");
    return false;
  }
}

export async function updateAlchemyProductEffectLevel(sheet, slotIdx, spellLevel) {
  const sheetState = _validateSheetAndMode(sheet);
  if (!sheetState.ok) {
    ui.notifications.warn(sheetState.reason);
    return false;
  }

  const { actor, itemDoc, mode } = sheetState;
  const effects = _getStoredAlchemyEffects(itemDoc);
  const existingEntry = effects[slotIdx];
  if (!existingEntry) return false;
  if (String(existingEntry?.effectSource ?? "spell") !== "spell") {
    ui.notifications.warn("Only spell-based alchemy effects can change spell level here.");
    return false;
  }

  const spell = await _resolveSpellForSheetAsync(actor, existingEntry.spellUuid);
  if (!spell) {
    ui.notifications.warn(`${existingEntry.effectLabel || "That spell"} could not be resolved.`);
    return false;
  }

  const built = _buildManualSpellEffectEntry(actor, spell, { mode, spellLevel });
  if (!built.ok) {
    ui.notifications.warn(built.reason);
    return false;
  }

  effects[slotIdx] = built.effectEntry;
  const ok = await _updateAlchemyEffects(itemDoc, effects, `update ${spell.name ?? "spell"} level on alchemy product`);
  if (ok) {
    ui.notifications?.info?.(`Updated ${spell.name} to SL ${Number(built.effectEntry.spellLevel ?? 1)}.`);
    await sheet.render();
  }
  return ok;
}

export async function clearAlchemyProductEffectSlot(sheet, slotIdx) {
  const sheetState = _validateSheetAndMode(sheet);
  if (!sheetState.ok) {
    ui.notifications.warn(sheetState.reason);
    return false;
  }

  const { itemDoc } = sheetState;
  const effects = _getStoredAlchemyEffects(itemDoc);
  if (!effects[slotIdx]) return false;

  const nextEffects = effects.filter((_, idx) => idx !== slotIdx);
  const ok = await _updateAlchemyEffects(itemDoc, nextEffects, "clear alchemy product effect");
  if (ok) {
    ui.notifications?.info?.(`Cleared Slot ${slotIdx + 1}.`);
    await sheet.render();
  }
  return ok;
}

export function buildAlchemyProductEffectSlots(itemDoc, actor = null) {
  const mode = _getManualAlchemyMode(itemDoc);
  if (!mode) return [];

  const effects = _getStoredAlchemyEffects(itemDoc);
  const slots = [];

  for (let idx = 0; idx < ALCHEMY_PRODUCT_EFFECT_SLOT_COUNT; idx++) {
    const entry = effects[idx] ?? null;
    const isSpellEffect = String(entry?.effectSource ?? "spell") === "spell";
    const spell = entry && isSpellEffect ? _resolveSpellForSheet(actor, entry.spellUuid) : null;
    const levelOptions = spell
      ? getSpellLevelOptions(spell)
      : (entry ? [Math.max(1, Number(entry?.spellLevel ?? 1) || 1)] : []);
    const selectedLevel = entry
      ? (levelOptions.includes(Number(entry?.spellLevel ?? 1)) ? Number(entry?.spellLevel ?? 1) : (levelOptions[0] ?? 1))
      : 1;

    slots.push({
      idx,
      displayIndex: idx + 1,
      hasEffect: Boolean(entry),
      canDrop: Boolean(entry) || effects.length < ALCHEMY_PRODUCT_EFFECT_SLOT_COUNT,
      effect: entry
        ? {
            label: String(entry.effectLabel ?? entry.spellName ?? entry.effectKey ?? "Unknown Effect"),
            school: String(entry.school ?? ""),
            spellLevel: Number(entry.spellLevel ?? 1) || 1,
            selectedLevel,
            cost: Number(entry.cost ?? 0) || 0,
            sourceLabel: isSpellEffect ? "Spell" : "Catalog",
            missingSpell: isSpellEffect && !spell,
            canConfigureLevel: Boolean(spell),
            isSpellEffect,
            isLegacyCatalog: !isSpellEffect,
          }
        : null,
      levelOptions: levelOptions.map((value) => ({
        value,
        label: `SL ${value}`,
        selected: value === selectedLevel,
      })),
    });
  }

  return slots;
}
