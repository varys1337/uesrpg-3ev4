/**
 * Push a context option only when it is not already present by name.
 */
export function pushContextOptionOnce(options, option) {
  if (!Array.isArray(options) || !option) return;
  const name = String(option.name ?? "").trim();
  if (!name) return;
  const exists = options.some((opt) => String(opt?.name ?? "").trim() === name);
  if (!exists) options.push(option);
}
