export const DEFAULT_DIALOG_CLASS = "uesrpg-dialog";

export function resolveDialogClasses({ classes = [], unstyled = false } = {}) {
  if (unstyled) return classes;
  const merged = Array.isArray(classes) ? [...classes] : [];
  if (!merged.includes(DEFAULT_DIALOG_CLASS)) merged.unshift(DEFAULT_DIALOG_CLASS);
  return merged;
}
