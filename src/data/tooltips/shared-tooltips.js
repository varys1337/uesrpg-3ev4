/**
 * Shared tooltip placeholder helpers and defaults.
 *
 * Replace placeholder strings with real text as content is ported.
 */

export const TOOLTIP_PLACEHOLDER_PREFIX = "[TODO]";

export const SHARED_TOOLTIP_DEFAULTS = Object.freeze({
  compendiumNote: "Open the Rules Compendium for full details.",
  genericShort: `${TOOLTIP_PLACEHOLDER_PREFIX} Add short tooltip text.`,
  genericLong: `${TOOLTIP_PLACEHOLDER_PREFIX} Add extended help text.`,
});

export function buildPlaceholderShortText({ domain, id }) {
  const normalizedDomain = String(domain ?? "tooltip").trim() || "tooltip";
  const normalizedId = String(id ?? "entry").trim() || "entry";
  return `${TOOLTIP_PLACEHOLDER_PREFIX} Add short text for ${normalizedDomain}:${normalizedId}.`;
}

export function buildPlaceholderLongText({ domain, id }) {
  const normalizedDomain = String(domain ?? "tooltip").trim() || "tooltip";
  const normalizedId = String(id ?? "entry").trim() || "entry";
  return `${TOOLTIP_PLACEHOLDER_PREFIX} Add help text for ${normalizedDomain}:${normalizedId}.`;
}

export function composeTooltipText({
  header,
  shortText,
  pointer,
}) {
  const normalizedHeader = String(header ?? "").trim();
  const normalizedShort = String(shortText ?? "").trim();
  const normalizedPointer = String(pointer ?? "").trim();
  return [normalizedHeader, normalizedShort, normalizedPointer].filter(Boolean).join(" ");
}
