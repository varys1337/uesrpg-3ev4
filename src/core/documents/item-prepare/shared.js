import {
  hasLegacyQuality,
  hasLegacyQualityToken,
  safeNumber,
  sumLegacyQualityParam,
} from "../item-utils.js";

export function getInjectedQualities(itemData) {
  if (Array.isArray(itemData?.qualitiesStructuredInjected)) return itemData.qualitiesStructuredInjected;
  if (Array.isArray(itemData?.qualitiesStructured)) return itemData.qualitiesStructured;
  return [];
}

export function buildInjectedStructuredQualities(itemType, itemData) {
  const manual = Array.isArray(itemData?.qualitiesStructured) ? itemData.qualitiesStructured : [];
  const autoQ = Array.isArray(itemData?.autoQualitiesStructured) ? itemData.autoQualitiesStructured : [];
  const byKey = new Map();

  const upsert = (q, { overwrite = true } = {}) => {
    if (!q) return;
    const rawKey = String(q.key ?? q ?? "").trim();
    const key = rawKey.toLowerCase();
    if (!key) return;
    if (!overwrite && byKey.has(key)) return;
    const entry = { key };
    if (q.value !== undefined && q.value !== null && q.value !== "") {
      const n = Number(q.value);
      if (Number.isFinite(n)) entry.value = n;
    }
    byKey.set(key, entry);
  };

  for (const q of manual) upsert(q);
  for (const q of autoQ) upsert(q, { overwrite: false });

  if (itemType === "weapon") {
    const legacyText = String(itemData?.qualities ?? "");
    if (!byKey.has("primitive") && hasLegacyQualityToken(legacyText, "primitive")) {
      byKey.set("primitive", { key: "primitive" });
    }
    if (!byKey.has("proven") && hasLegacyQualityToken(legacyText, "proven")) {
      byKey.set("proven", { key: "proven" });
    }
    if (!byKey.has("damaged")) {
      const dv = sumLegacyQualityParam(legacyText, "Damaged");
      if (dv > 0) byKey.set("damaged", { key: "damaged", value: dv });
    }
  }

  return Array.from(byKey.values());
}

export function getDamagedQualityValue(itemData) {
  const damagedQ = getInjectedQualities(itemData).find(q => String(q?.key ?? "").toLowerCase() === "damaged");
  return safeNumber(damagedQ?.value, 0);
}

export function hasRunedQuality(itemData) {
  return itemData?.runed === true
    || getInjectedQualities(itemData).some(q => String(q?.key ?? "").toLowerCase() === "runed")
    || hasLegacyQuality(itemData?.qualities, "runed");
}

export function stepWeightClass(base, delta) {
  const order = ["none", "light", "medium", "heavy", "superheavy", "crippling"];
  let i = order.indexOf(String(base || "none").toLowerCase());
  if (i === -1) i = 0;
  i = Math.max(0, Math.min(order.length - 1, i + delta));
  return order[i];
}
