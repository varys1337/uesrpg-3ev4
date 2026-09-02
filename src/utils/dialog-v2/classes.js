export const DEFAULT_DIALOG_CLASS = "uesrpg-dialog";

export const DIALOG_LAYOUTS = Object.freeze([
  "message",
  "form",
  "choices",
  "workflow",
  "table",
  "document",
]);

const VALID_LAYOUTS = new Set(DIALOG_LAYOUTS);

function normalizedClassList(classes) {
  if (Array.isArray(classes)) return classes.filter((value) => typeof value === "string" && value.trim());
  if (typeof classes === "string" && classes.trim()) return [classes];
  return [];
}

export function resolveDialogClasses({
  classes = [],
  unstyled = false,
  variant = "custom",
  layout = "workflow",
  buttonCount = 0,
} = {}) {
  const merged = normalizedClassList(classes);
  if (unstyled) return [...new Set(merged)];

  const resolvedLayout = VALID_LAYOUTS.has(layout) ? layout : "workflow";
  const resolvedVariant = String(variant || "custom").trim().replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  const resolvedButtonCount = Math.max(0, Number.parseInt(buttonCount, 10) || 0);
  const buttonClass = resolvedButtonCount > 3
    ? "uesrpg-dialog--buttons-many"
    : `uesrpg-dialog--buttons-${resolvedButtonCount}`;

  merged.unshift(
    DEFAULT_DIALOG_CLASS,
    `uesrpg-dialog--${resolvedVariant}`,
    `uesrpg-dialog--layout-${resolvedLayout}`,
    buttonClass,
  );
  return [...new Set(merged)];
}
