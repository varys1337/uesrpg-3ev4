import {
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
  requestUpdateDocument,
} from "../../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../../constants.js";
import {
  buildMaterializedStoredSpellSource,
  materializedStoredSpellMatches,
} from "../stored-spell-doc.js";

export const CAST_ENCHANTMENT_ITEM_TYPES = new Set([
  "item", "equipment", "weapon", "armor", "shield", "ammunition", "container", "scroll",
]);

export function isCastEnchantmentItemType(item) {
  return CAST_ENCHANTMENT_ITEM_TYPES.has(String(item?.type ?? "").trim().toLowerCase());
}

function _laneSlots(item, sourceLane) {
  if (sourceLane === "workshop") {
    const enchanting = item?.flags?.[SYSTEM_ID]?.enchanting;
    if (enchanting?.version !== 2 || String(enchanting?.enchantType ?? "").toLowerCase() !== "cast") return [];
    return Array.isArray(enchanting?.cast?.spells) ? enchanting.cast.spells : [];
  }
  const extension = item?.flags?.[SYSTEM_ID]?.itemSpellcasting;
  if (extension?.enabled !== true) return [];
  return Array.isArray(extension?.slots) ? extension.slots : [];
}

export function getCastEnchantmentSlots(item, { requireEquipped = false, instantOnly = false } = {}) {
  if (!isCastEnchantmentItemType(item)) return [];
  if (requireEquipped && item?.system?.equipped !== true) return [];
  const out = [];
  for (const sourceLane of ["extension", "workshop"]) {
    for (const slot of _laneSlots(item, sourceLane)) {
      if (slot?.enabled === false) continue;
      if (instantOnly && !isStoredEnchantmentSpellInstantSync(item, slot)) continue;
      out.push({ ...slot, sourceLane, sourceItem: item });
    }
  }
  return out;
}

export function collectActorCastEnchantmentSlots(actor, options = {}) {
  return Array.from(actor?.items ?? []).flatMap((item) => getCastEnchantmentSlots(item, options));
}

function _resolveActorSpell(item, slot) {
  const id = String(slot?.actorSpellItemId ?? "").trim();
  if (!id || !item?.actor) return null;
  const spell = item.actor.items?.get?.(id) ?? null;
  return spell?.documentName === "Item" && spell.type === "spell" ? spell : null;
}

function _resolveUuidSync(uuid) {
  const value = String(uuid ?? "").trim();
  if (!value || typeof fromUuidSync !== "function") return null;
  try {
    const spell = fromUuidSync(value);
    return spell?.documentName === "Item" && spell.type === "spell" ? spell : null;
  } catch (_err) {
    return null;
  }
}

export function resolveStoredEnchantmentSpellSync(item, slot) {
  return _resolveActorSpell(item, slot) ?? _resolveUuidSync(slot?.spellUuid);
}

export function isStoredEnchantmentSpellInstantSync(item, slot) {
  const resolved = resolveStoredEnchantmentSpellSync(item, slot);
  if (resolved) return resolved.system?.isInstant === true;
  return slot?.snapshot?.system?.isInstant === true;
}

function _findMaterializedSpell(item, slot) {
  return Array.from(item?.actor?.items ?? []).find((candidate) => materializedStoredSpellMatches(candidate, {
    sourceItem: item,
    slot,
    sourceLane: slot?.sourceLane ?? "extension",
  })) ?? null;
}

async function _persistMaterializedReference(item, slot, spell) {
  const sourceLane = String(slot?.sourceLane ?? "extension");
  const slots = _laneSlots(item, sourceLane).map((entry) => foundry.utils.deepClone(entry));
  const index = slots.findIndex((entry) => String(entry?.id ?? "") === String(slot?.id ?? ""));
  if (index < 0) return false;
  slots[index].actorSpellItemId = String(spell?.id ?? "");
  const path = sourceLane === "workshop"
    ? `flags.${SYSTEM_ID}.enchanting.cast.spells`
    : `flags.${SYSTEM_ID}.itemSpellcasting.slots`;
  return requestUpdateDocument(item, { [path]: slots });
}

async function _materializeSnapshot(item, slot) {
  const actor = item?.actor ?? null;
  if (!actor || !slot?.snapshot || typeof slot.snapshot !== "object") return null;

  let spell = _findMaterializedSpell(item, slot);
  let createdNew = false;
  if (!spell) {
    const source = buildMaterializedStoredSpellSource(slot.snapshot, {
      sourceItem: item,
      slot,
      sourceLane: slot?.sourceLane ?? "extension",
    });
    if (!source) return null;
    const created = await requestCreateEmbeddedDocuments(actor, "Item", [source]);
    spell = Array.isArray(created) ? created[0] ?? null : null;
    createdNew = Boolean(spell);
  }
  if (!spell) return null;
  const persisted = await _persistMaterializedReference(item, slot, spell);
  if (!persisted && createdNew) await requestDeleteEmbeddedDocuments(actor, "Item", [spell.id]);
  if (persisted) slot.actorSpellItemId = String(spell.id ?? "");
  return persisted ? spell : null;
}

/** Resolve actor materialization, stored UUID, then snapshot; optionally persist a snapshot as a hidden actor spell. */
export async function resolveStoredEnchantmentSpell(item, slot, { materialize = false } = {}) {
  const actorSpell = _resolveActorSpell(item, slot);
  if (actorSpell) return actorSpell;

  const uuid = String(slot?.spellUuid ?? "").trim();
  if (uuid) {
    try {
      const spell = await fromUuid(uuid);
      if (spell?.documentName === "Item" && spell.type === "spell") return spell;
    } catch (_err) {
      // Snapshot fallback follows.
    }
  }

  if (materialize) return _materializeSnapshot(item, slot);
  const snapshot = slot?.snapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  try {
    const data = foundry.utils.deepClone(snapshot);
    data.type = "spell";
    if (!String(data.name ?? "").trim()) data.name = String(slot?.label ?? "Stored Spell");
    const ItemClass = CONFIG?.Item?.documentClass ?? Item;
    return new ItemClass(data, { temporary: true, parent: item?.actor ?? undefined });
  } catch (_err) {
    return null;
  }
}

export function getCastEnchantmentPool(item, sourceLane = "workshop") {
  const lane = String(sourceLane ?? "workshop");
  const pool = lane === "extension"
    ? item?.flags?.[SYSTEM_ID]?.itemSpellcasting?.pool ?? {}
    : item?.flags?.[SYSTEM_ID]?.enchanting?.cast?.pool ?? {};
  const charge = item?.system?.charge ?? {};
  const value = Number(pool.value ?? charge.value);
  const max = Number(pool.max ?? charge.max);
  return {
    value: Number.isFinite(value) ? Math.max(0, value) : 0,
    max: Number.isFinite(max) ? Math.max(0, max) : 0,
  };
}

export function canAffordCastEnchantmentSlot(item, slot) {
  const mode = String(slot?.costMode ?? "soul").trim().toLowerCase();
  if (mode !== "soul") return true;
  return getCastEnchantmentPool(item, slot?.sourceLane).value >= Math.max(0, Number(slot?.cost ?? 0) || 0);
}
