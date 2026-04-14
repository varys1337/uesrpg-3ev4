import { t } from "../../utils/i18n.js";

function _asSegment(value, fallback = "Unknown") {
  const raw = String(value ?? "").trim();
  return raw || String(fallback ?? "");
}

function _sourcePath(kind, sourceKey) {
  const safeKind = _asSegment(kind);
  const safeSourceKey = _asSegment(sourceKey);
  return `UESRPG.Religion.${safeKind}.${safeSourceKey}`;
}

export function localizeReligionDomain(domain) {
  if (!domain || typeof domain !== "object") return domain ?? null;

  const key = _asSegment(domain.key);
  return {
    ...domain,
    label: t(`UESRPG.Religion.Domains.${key}.Label`, domain.label ?? key),
    ritualSkillName: t(`UESRPG.Religion.Domains.${key}.RitualSkillName`, domain.ritualSkillName ?? ""),
  };
}

export function getLocalizedReligionRecordName(kind, sourceKey, fallbackName) {
  return t(`${_sourcePath(kind, sourceKey)}.Name`, fallbackName);
}

export function getLocalizedReligionRecordEffect(kind, sourceKey, fallbackEffect) {
  return t(`${_sourcePath(kind, sourceKey)}.Effect`, fallbackEffect);
}

export function getInvocationSourceKey(item) {
  return String(
    item?.flags?.["uesrpg-3ev4"]?.religion?.sourceKey
    ?? item?.system?.source?.sourceKey
    ?? "",
  ).trim();
}

export function getLocalizedInvocationName(item) {
  const sourceKey = getInvocationSourceKey(item);
  const fallbackName = String(item?.name ?? "").trim();
  return sourceKey
    ? getLocalizedReligionRecordName("Invocations", sourceKey, fallbackName)
    : fallbackName;
}

export function getLocalizedInvocationEffect(item) {
  const sourceKey = getInvocationSourceKey(item);
  const fallbackEffect = String(item?.system?.effect ?? item?.system?.description ?? "").trim();
  return sourceKey
    ? getLocalizedReligionRecordEffect("Invocations", sourceKey, fallbackEffect)
    : fallbackEffect;
}
