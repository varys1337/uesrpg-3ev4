import { buildSpecialActionTooltipText, buildSpecialActionHelpText } from "../../../../data/tooltips/index.js";
import { systemTooltipAttributes } from "../../../../ui/shared/system-tooltips.js";
import { escapeHtml } from "../../../../utils/html.js";
import { t } from "../../../../utils/i18n.js";

export function renderSpecialActionOption(sa) {
  const id = String(sa?.id ?? "").trim();
  if (!id) return "";
  const label = String(sa?.name ?? id);
  const typ = String(sa?.actionType ?? "").toLowerCase();
  const tooltip = buildSpecialActionTooltipText({ name: label, id, actionType: typ || "primary/secondary" });
  const helpText = buildSpecialActionHelpText({ name: label, id });
  const chipClass = typ === "primary" ? "uesrpg-adv-chip--primary" : "uesrpg-adv-chip--secondary";
  const chipLabel = typ === "primary" ? t("UESRPG.Sheets.Combat.Primary", "Primary") : t("UESRPG.Sheets.Combat.Secondary", "Secondary");
  return `
      <label class="uesrpg-adv-choice" ${systemTooltipAttributes({ text: tooltip })} data-uesrpg-inline-help="true" data-uesrpg-inline-help-label="${escapeHtml(label)}" data-uesrpg-inline-help-text="${escapeHtml(tooltip)}" data-uesrpg-inline-help-dialog-text="${escapeHtml(helpText)}">
        <input type="checkbox" name="sa_${escapeHtml(id)}" />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">${escapeHtml(label)}</span>
          <span class="uesrpg-adv-chip uesrpg-adv-chip--inline ${chipClass}">${chipLabel}</span>
        </span>
      </label>
    `;
}
