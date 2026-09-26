import { t } from "../../../utils/i18n.js";

/** Shared markup; each workflow supplies its own breakdown rows and TN policy. */
export function renderTargetNumberLine(tnLabel, rows = "") {
  if (!rows) return `<div><b>${t("UESRPG.Chat.Common.TN", "TN")}:</b> ${tnLabel}</div>`;
  return `
    <details style="margin:0;">
      <summary style="display:inline-block; cursor:pointer; user-select:none; white-space:nowrap;">
        <b>${t("UESRPG.Chat.Common.TN", "TN")}:</b> ${tnLabel} &#9654;
      </summary>
      <div style="margin:4px 0 0 0; padding-left:8px; width:100%; box-sizing:border-box; font-size:12px; opacity:0.9;">${rows}</div>
    </details>
  `;
}

export function variantLabel(variant) {
  switch (variant) {
    case "allOut": return "All Out";
    case "precision": return "Precision";
    case "coup": return "Coup";
    case "normal":
    default: return "Attack";
  }
}
