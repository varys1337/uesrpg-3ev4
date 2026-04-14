import { createUuidResolver } from "../../utils/uuid-cache.js";

function _asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function getLinkedAreaEntities(originEffect) {
  const linked = _asArray(originEffect?.flags?.["uesrpg-3ev4"]?.linkedEntities);
  return linked.filter((link) => link?.type === "region" || link?.type === "template");
}

export function getLinkedAreaUuids(originEffect) {
  return getLinkedAreaEntities(originEffect)
    .map((link) => String(link?.uuid ?? "").trim())
    .filter(Boolean);
}

export function getLinkedRegionUuids(originEffect) {
  return getLinkedAreaEntities(originEffect)
    .filter((link) => link?.type === "region")
    .map((link) => String(link?.uuid ?? "").trim())
    .filter(Boolean);
}

export function resolveLinkedArea(areaUuid) {
  if (!areaUuid) return null;
  const resolver = createUuidResolver();
  const doc = resolver.resolveSync(String(areaUuid)) ?? null;
  if (!doc) return null;
  if (doc.documentName === "Region" || doc.documentName === "MeasuredTemplate") return doc;
  return null;
}

export function buildRegionLink(uuid, label = "Spell Zone") {
  if (!uuid) return null;
  return {
    type: "region",
    uuid: String(uuid),
    label: String(label ?? "").trim() || "Spell Zone"
  };
}
