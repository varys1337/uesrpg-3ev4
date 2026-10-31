import { escapeHtml } from "../../utils/html.js";
import { t } from "../../utils/i18n.js";

/** Caller provides a GM-only projection; no Documents or runtime lookups here. */
export function renderOpposedTestDetails(model, { localize = t, escape = escapeHtml } = {}) {
  const label = (key, fallback) => escape(localize("UESRPG.Chat.TestExplanation." + key, fallback));
  const missing = label("NotRecorded", "Not recorded");
  const display = value => value === null || value === undefined ? missing : escape(String(value));
  const row = (key, fallback, value) => '<div class="uesrpg-chat-kv-row"><span>' + label(key, fallback) + '</span><span>' + display(value) + '</span></div>';
  return row("Roll", "Recorded roll", model.roll) + row("Target", "Recorded test target", model.target)
    + row("Base", "Saved base TN", model.baseTN) + row("Modifier", "Saved total modifier", model.totalMod)
    + row("Final", "Saved final TN", model.finalTN) + row("Degree", "Recorded degree", model.degree)
    + row("Success", "Recorded success", model.success === null ? null : localize("UESRPG.Chat.TestExplanation." + (model.success ? "Succeeded" : "Failed"), model.success ? "Success" : "Failure"))
    + '<div class="uesrpg-chat-damage-note">' + label("Components", "Saved TN contributions") + '</div>'
    + ((model.components ?? []).map(component => '<div class="uesrpg-chat-kv-row"><span>' + display(component.label) + '</span><span>' + display(component.value) + '</span></div>').join("") || '<p>' + missing + '</p>');
}

