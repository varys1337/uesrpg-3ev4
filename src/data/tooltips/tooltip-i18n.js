import { t, tf } from "../../utils/i18n.js";

function _safeSegment(value, fallback = "Unknown") {
  const raw = String(value ?? "").trim();
  return raw || String(fallback ?? "");
}

export function localizeTooltipEntry(group, id, entry, {
  label = "",
  pointerId = "",
} = {}) {
  const safeGroup = _safeSegment(group);
  const safeId = _safeSegment(id);
  const fallbackLabel = String(label ?? "").trim() || safeId;
  const fallbackShortText = String(entry?.shortText ?? "").trim();
  const fallbackHelpText = String(entry?.helpText ?? "").trim() || fallbackShortText;
  const fallbackPointer = String(entry?.pointer ?? "").trim();
  const safePointerId = String(pointerId ?? "").trim();

  return {
    label: t(`UESRPG.Tooltips.${safeGroup}.${safeId}.Label`, fallbackLabel),
    shortText: t(`UESRPG.Tooltips.${safeGroup}.${safeId}.ShortText`, fallbackShortText),
    helpText: t(`UESRPG.Tooltips.${safeGroup}.${safeId}.HelpText`, fallbackHelpText),
    pointer: safePointerId
      ? t(`UESRPG.Tooltips.Pointer.${safePointerId}`, fallbackPointer)
      : fallbackPointer,
  };
}

export function buildTooltipHeader(kind, data = {}, fallback = "") {
  const safeKind = _safeSegment(kind);
  return tf(`UESRPG.Tooltips.Headers.${safeKind}`, data, fallback);
}
