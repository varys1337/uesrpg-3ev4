import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";

export function buildEnchantedItemUpdate(targetItem, flagsPayload, namespace) {
  const updateData = {
    [`flags.${namespace}.enchanting`]: flagsPayload,
  };

  const pool = flagsPayload?.cast?.pool ?? flagsPayload?.strike?.pool ?? null;
  if (pool) {
    updateData["system.charge.value"] = pool.value;
    updateData["system.charge.max"] = pool.max;
  }

  if (["weapon", "armor"].includes(targetItem?.type)) {
    const existingQualities = targetItem.system?.qualitiesStructured ?? [];
    const hasMagic = existingQualities.some((quality) => quality.key === "magic");
    if (!hasMagic) {
      updateData["system.qualitiesStructured"] = [
        ...existingQualities,
        { key: "magic", value: null }
      ];
    }
  }

  return updateData;
}

export async function applyEnchantedItemUpdate(targetItem, updateData) {
  return requestUpdateDocument(targetItem, updateData);
}
