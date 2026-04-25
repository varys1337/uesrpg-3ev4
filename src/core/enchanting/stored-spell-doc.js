import { FLAG_SCOPE, SYSTEM_ID } from "../system/namespace.js";

export const STORED_ENCHANTMENT_SPELL_FLAG = "storedEnchantmentSpell";

export function getStoredEnchantmentSpellMeta(item) {
  return item?.flags?.[FLAG_SCOPE]?.[STORED_ENCHANTMENT_SPELL_FLAG] ?? null;
}

export function isHiddenStoredEnchantmentSpell(item) {
  if (!item || String(item?.type ?? "") !== "spell") return false;
  return getStoredEnchantmentSpellMeta(item)?.hidden === true;
}

export function buildMaterializedStoredSpellSource(snapshot, { sourceItem = null, slot = null, sourceLane = "extension" } = {}) {
  const cloneFn = foundry?.utils?.deepClone;
  const source = cloneFn ? cloneFn(snapshot ?? {}) : structuredClone(snapshot ?? {});
  if (!source || typeof source !== "object") return null;

  delete source._id;
  delete source.folder;
  delete source.sort;
  delete source.ownership;
  delete source._stats;

  source.type = "spell";
  source.name = String(source?.name ?? slot?.label ?? slot?.snapshot?.name ?? "Stored Spell").trim() || "Stored Spell";
  source.img = String(source?.img ?? "icons/svg/book.svg").trim() || "icons/svg/book.svg";

  const existingFlags = source.flags && typeof source.flags === "object" ? source.flags : {};
  source.flags = foundry.utils.mergeObject(existingFlags, {
    [FLAG_SCOPE]: {
      [STORED_ENCHANTMENT_SPELL_FLAG]: {
        hidden: true,
        sourceLane: String(sourceLane ?? "extension"),
        sourceItemId: String(sourceItem?.id ?? ""),
        sourceItemUuid: String(sourceItem?.uuid ?? ""),
        slotId: String(slot?.id ?? ""),
        systemId: SYSTEM_ID
      }
    }
  }, { inplace: false, overwrite: true, insertKeys: true, insertValues: true });

  return source;
}

export function materializedStoredSpellMatches(item, { sourceItem = null, slot = null, sourceLane = "extension" } = {}) {
  const meta = getStoredEnchantmentSpellMeta(item);
  if (!meta) return false;
  return (
    String(meta?.sourceLane ?? "extension") === String(sourceLane ?? "extension")
    && String(meta?.sourceItemId ?? "") === String(sourceItem?.id ?? "")
    && String(meta?.slotId ?? "") === String(slot?.id ?? "")
  );
}
