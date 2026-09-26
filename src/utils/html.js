/** Text and ordinary quoted HTML attributes only; never URLs or scripts. */
export function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}
