import { t } from "../../../utils/i18n.js";

function _normalizeConditionId(id) {
  return String(id ?? "").trim().toLowerCase();
}

export function getConditionName(id, fallbackName) {
  const safeId = _normalizeConditionId(id);
  return safeId
    ? t(`UESRPG.Conditions.${safeId}.Name`, fallbackName)
    : String(fallbackName ?? "");
}

export function getConditionDescription(id, fallbackHtml) {
  const safeId = _normalizeConditionId(id);
  return safeId
    ? t(`UESRPG.Conditions.${safeId}.Description`, fallbackHtml)
    : String(fallbackHtml ?? "");
}
