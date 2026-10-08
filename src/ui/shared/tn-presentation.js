import { escapeHtml } from "../../utils/html.js";
import { t } from "../../utils/i18n.js";
import { systemTooltipAttributes, setSystemTooltip } from "./system-tooltips.js";

/** Shared, non-submitting estimate used by gameplay choice dialogs. */
export function renderTNPill(key) {
  return `<span class="tn-pill" tabindex="0" ${systemTooltipAttributes({ text: t("UESRPG.Chat.Common.EstimatedTNHint", "Estimated TN for the current options; confirmed when the test is rolled.") })}><span class="tn-pill__label">${t("UESRPG.Chat.Common.TN", "TN")}</span> <span data-tn-for="${escapeHtml(key)}">—</span></span>`;
}

/** Display the canonical resolver's result and its existing breakdown. */
export function updateTNPill(root, key, result, { automatic = false, status = null, reason = null } = {}) {
  const value = root?.querySelector(`[data-tn-for="${key}"]`);
  const pill = value?.closest(".tn-pill");
  if (!pill) return;
  const total = result?.finalTN;
  const valid = typeof total === "number" && Number.isFinite(total);
  value.textContent = status ?? (automatic
    ? t("UESRPG.Chat.Common.Automatic", "Automatic")
    : (valid ? String(total) : "—"));
  const entries = result?.breakdown ?? result?.modifiers ?? [];
  const detail = automatic ? [] : entries.filter(entry => entry?.label && Number.isFinite(Number(entry.value))
    && (Number(entry.value) !== 0 || entry.keepZero || entry.key === "base")).map(entry => `${entry.label}: ${Number(entry.value)}`);
  const hint = automatic
    ? t("UESRPG.Chat.Common.Automatic", "Automatic")
    : (!status && !valid
      ? t("UESRPG.Chat.Common.EstimatedTNUnavailable", "Select the required test options to estimate its TN.")
      : t("UESRPG.Chat.Common.EstimatedTNHint", "Estimated TN for the current options; confirmed when the test is rolled."));
  const label = root.querySelector(`[data-tn-label-for="${key}"]`)?.textContent;
  setSystemTooltip(pill, { text: [label, reason || hint, ...detail].filter(Boolean).join("\n") });
}

/** Explicit summary markup for dialogs configuring one or several tests. */
export function renderTNSummary(tests) {
  const entries = typeof tests === "string" ? [{ key: "test", label: tests }] : tests;
  return `<div class="uesrpg-tn-summary">${(entries ?? []).map(({ key = "test", label }) => `<div class="uesrpg-tn-summary__test"><strong data-tn-label-for="${escapeHtml(key)}">${escapeHtml(label)}</strong>${renderTNPill(key)}</div>`).join("")}</div>`;
}

const estimateBindings = new WeakMap();

/** Read-only estimates run after the dialog's own dependent-control listeners. */
export function bindTNEstimates(root, resolve) {
  if (!root?.querySelector || typeof resolve !== "function") return;
  const existing = estimateBindings.get(root);
  if (existing) {
    existing.resolve = resolve;
    existing.update();
    return;
  }
  const binding = { resolve, update: null };
  binding.update = () => {
    const resolved = binding.resolve();
    const tests = Array.isArray(resolved) ? resolved : [{ key: "test", result: resolved }];
    for (const { key = "test", result, label, status, reason, automatic } of tests) {
      const heading = root.querySelector(`[data-tn-label-for="${key}"]`);
      if (heading && label != null) heading.textContent = label;
      updateTNPill(root, key, result, { status, reason: reason ?? result?.reason, automatic });
    }
  };
  estimateBindings.set(root, binding);
  root.addEventListener("input", binding.update);
  root.addEventListener("change", binding.update);
  binding.update();
}
