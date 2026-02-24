/**
 * Non-destructive diagnostics for mixed enchanting/item-spellcasting data.
 */

const _FLAG_NS = "uesrpg-3ev4";

function _asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function auditMixedEnchantingItems() {
  const rows = [];
  for (const actor of game.actors?.contents ?? []) {
    for (const item of actor.items ?? []) {
      const flags = item?.flags?.[_FLAG_NS] ?? {};
      const enchanting = flags?.enchanting ?? {};
      const cast = enchanting?.cast ?? {};
      const itemSpellcasting = flags?.itemSpellcasting ?? {};
      const hasLegacyCastSlots = _asArray(cast?.spells).length > 0;
      const isWorkshopCast = String(enchanting?.enchantType ?? "").trim().toLowerCase() === "cast";
      const hasExtensionSlots = _asArray(itemSpellcasting?.slots).length > 0;
      if (!hasLegacyCastSlots) continue;

      if (!isWorkshopCast && !hasExtensionSlots) {
        rows.push({
          actorName: actor.name,
          actorUuid: actor.uuid,
          itemName: item.name,
          itemUuid: item.uuid,
          issue: "legacy-cast-payload-without-workshop-type",
          legacySlotCount: _asArray(cast?.spells).length
        });
      }
    }
  }
  return rows;
}

export async function repairItemSpellcastingFromLegacy(item, { setEnabled = true } = {}) {
  const flags = item?.flags?.[_FLAG_NS] ?? {};
  const enchanting = flags?.enchanting ?? {};
  const cast = enchanting?.cast ?? {};
  if (String(enchanting?.enchantType ?? "").trim().toLowerCase() === "cast") return false;
  if (!_asArray(cast?.spells).length) return false;

  const existing = flags?.itemSpellcasting ?? {};
  if (_asArray(existing?.slots).length > 0) return false;

  const payload = {
    version: 2,
    enabled: setEnabled === true,
    pool: {
      value: Number(cast?.pool?.value ?? item?.system?.charge?.value ?? 0) || 0,
      max: Number(cast?.pool?.max ?? item?.system?.charge?.max ?? 0) || 0
    },
    slots: foundry.utils.deepClone(cast.spells),
    activeUpkeepSlotId: cast?.activeUpkeepSpellId ?? null
  };

  await item.update({ [`flags.${_FLAG_NS}.itemSpellcasting`]: payload });
  return true;
}
