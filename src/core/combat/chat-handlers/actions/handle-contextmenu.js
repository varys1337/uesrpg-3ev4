/**
 * Push a v14 context option only when it is not already present by label.
 */
export function pushContextOptionOnce(options, option) {
  if (!Array.isArray(options) || !option) return;
  const label = String(option.label ?? option.name ?? "").trim();
  if (!label) return;
  const exists = options.some((opt) => String(opt?.label ?? opt?.name ?? "").trim() === label);
  if (exists) return;

  const normalized = { ...option, label };
  if (normalized.visible === undefined && typeof normalized.condition === "function") normalized.visible = normalized.condition;
  if (normalized.onClick === undefined && typeof normalized.callback === "function") {
    normalized.onClick = (event, target) => normalized.callback(target ?? event);
  }
  delete normalized.name;
  delete normalized.condition;
  delete normalized.callback;
  options.push(normalized);
}
