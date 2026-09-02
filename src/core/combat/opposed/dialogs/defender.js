/**
 * src/core/combat/opposed/dialogs/defender.js
 *
 * Defender-side dialog functions for opposed combat workflow.
 * Extracted from monolith (Phase 12) to improve modularity and performance.
 *
 * Exported functions:
 * - promptDefenderAdvantage: Defender advantage spending dialog (Overextend, Overwhelm, Secondary actions)
 */

import { buildSpecialActionsForActor } from "../../combat-style-utils.js";
import { hasTalent } from "../../../traits/talents-api.js";
import { canUseExploitAdvantage as _canUseExploitAdvantage } from "../helpers/workflow.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { t, tf } from "../../../../utils/i18n.js";
import { buildSpecialActionTooltipText, buildSpecialActionHelpText } from "../../../../data/tooltips/index.js";
import { bindItemDescriptionTooltips, clearItemDescriptionTooltip } from "../../../../ui/sheets/v2/shared/sheet-tooltips.js";

function _escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Prompt defender to spend Advantage after successful defense.
 * Returns selected options or null if canceled.
 */
export async function promptDefenderAdvantage({
  defenderActor,
  attackerActor,
  advantageCount = 0,
  defenderTokenUuid = null,
  opponentTokenUuid = null,
  styleUuidForKnown = null
} = {}) {
  if (!defenderActor || advantageCount <= 0) return null;

  const max = Number(advantageCount || 0);

  const hasExploitTalent = Boolean(defenderActor && hasTalent(defenderActor, "exploitadvantage"));
  const exploitEligible = Boolean(hasExploitTalent && _canUseExploitAdvantage(defenderActor, { actorTokenUuid: defenderTokenUuid, opponentTokenUuid }));

  // Known Special Actions are derived from the provided style UUID (roll-selected style),
  // with backward-compatible fallback to default actor resolution when not provided.
  const knownSpecial = (() => {
    try {
      const all = (styleUuidForKnown != null)
        ? buildSpecialActionsForActor(defenderActor, { styleUuidOrId: styleUuidForKnown, legacyNpcFallback: true })
        : buildSpecialActionsForActor(defenderActor);
      return all.filter(a => a.known);
    } catch (_e) {
      return [];
    }
  })();

  const renderSpecialOpt = (sa) => {
    const id = String(sa?.id ?? "").trim();
    if (!id) return "";
    const label = String(sa?.name ?? id);
    const typ = String(sa?.actionType ?? "").toLowerCase();
    const tooltip = buildSpecialActionTooltipText({ name: label, id, actionType: typ || "primary/secondary" });
    const helpText = buildSpecialActionHelpText({ name: label, id });
    const chipClass = typ === "primary" ? "uesrpg-adv-chip--primary" : "uesrpg-adv-chip--secondary";
    const chipLabel = typ === "primary"
      ? t("UESRPG.Sheets.Combat.Primary", "Primary")
      : t("UESRPG.Sheets.Combat.Secondary", "Secondary");
    return `
      <label class="uesrpg-adv-choice" title="${_escapeHtml(tooltip)}" data-uesrpg-inline-help="true" data-uesrpg-inline-help-label="${_escapeHtml(label)}" data-uesrpg-inline-help-text="${_escapeHtml(tooltip)}" data-uesrpg-inline-help-dialog-text="${_escapeHtml(helpText)}">
        <input type="checkbox" name="sa_${id}" />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">${label}</span>
          <span class="uesrpg-adv-chip uesrpg-adv-chip--inline ${chipClass}">${chipLabel}</span>
        </span>
      </label>
    `;
  };

  const content = `
    <div class="uesrpg-adv-dialog uesrpg-adv-dialog--defender">
      <div class="uesrpg-adv-summary">
        <div><b>${t("UESRPG.Dialogs.Opposed.Advantage", "Advantage")}</b>: ${tf("UESRPG.Dialogs.Opposed.AvailableCount", { count: max }, `${max} available`)}</div>
        <div class="uesrpg-adv-count" aria-live="polite"></div>
      </div>
      <div class="uesrpg-adv-grid">
        <label class="uesrpg-adv-choice">
          <input type="checkbox" name="overextend" />
          <span class="uesrpg-adv-choice__label">
            <span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.Overextend", "Overextend")}</span>
            <span class="uesrpg-adv-choice__desc">${t("UESRPG.Dialogs.Opposed.OverextendDesc", "Opponent's next attack within 1 round suffers -10.")}</span>
          </span>
        </label>
        <label class="uesrpg-adv-choice">
          <input type="checkbox" name="overwhelm" />
          <span class="uesrpg-adv-choice__label">
            <span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.Overwhelm", "Overwhelm")}</span>
            <span class="uesrpg-adv-choice__desc">${t("UESRPG.Dialogs.Opposed.OverwhelmDesc", "Opponent cannot make Attacks of Opportunity until your next turn.")}</span>
          </span>
        </label>
        ${hasExploitTalent ? `
        <div class="uesrpg-adv-section">
          <p class="hint uesrpg-dialog-note">${exploitEligible ? t("UESRPG.Dialogs.Opposed.ExploitAdvantageOverextendEligible", "Exploit Advantage: Overextend is doubled (-20) (isolated duel).") : t("UESRPG.Dialogs.Opposed.ExploitAdvantageOverextendRequiresDuel", "Exploit Advantage: requires an isolated duel to double Overextend.")}</p>
        </div>
        ` : ``}
      </div>
      ${knownSpecial.length ? `
        <section class="uesrpg-known-specials">
          <div class="uesrpg-adv-section__title"><b>${t("UESRPG.Dialogs.Opposed.KnownSpecialActions", "Known Special Actions")}</b></div>
          <div class="uesrpg-known-specials__grid">
            ${knownSpecial.map(renderSpecialOpt).join("\n")}
          </div>
        </section>
      ` : ``}
      <p class="hint">${tf("UESRPG.Dialogs.Opposed.SelectUpToOptions", { count: max }, `Select up to ${max} option(s).`)}</p>
    </div>
  `;

  const tooltipScope = { kind: "adv-dialog", domain: "defender-advantage" };
  try {
    return await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.Opposed.ResolveDefenderAdvantage", "Resolve Defender Advantage"),
      content,
      classes: ["uesrpg-attack-declare"],
      buttons: {
        apply: {
          label: t("UESRPG.UI.Apply", "Apply"),
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.element ?? html;
            const form = root?.querySelector(".uesrpg-adv-dialog--defender") ?? root;
            if (!form) return null;

            const q = (name) => form.querySelector(`[name="${name}"]`);
            const overextend = Boolean(q("overextend")?.checked);
            const overextendDouble = Boolean(overextend && exploitEligible);
            const overwhelm = Boolean(q("overwhelm")?.checked);

            const selectedSpecial = [];
            for (const sa of knownSpecial) {
              const id = String(sa?.id ?? "").trim();
              if (!id) continue;
              if (Boolean(q(`sa_${id}`)?.checked)) selectedSpecial.push(id);
            }

            const selectedCount = [overextend, overwhelm].filter(Boolean).length + selectedSpecial.length;
            if (selectedCount > max) {
              ui.notifications.warn(tf("UESRPG.Notifications.Opposed.OnlyHaveAdvantage", { count: max }, `You only have ${max} Advantage to spend.`));
              return null;
            }

            return { overextend, overextendDouble, overwhelm, specialActionsSelected: selectedSpecial };
          }
        },
        skip: { label: t("UESRPG.UI.Skip", "Skip"), callback: () => ({ overextend: false, overextendDouble: false, overwhelm: false, specialActionsSelected: [] }) }
      },
      defaultButton: "apply",

    render: (event, html) => {
      const root = html instanceof HTMLElement ? html : html?.element ?? html;
      if (root instanceof HTMLElement) bindItemDescriptionTooltips(tooltipScope, root);
      const form = root?.querySelector(".uesrpg-adv-dialog--defender") ?? root;
      if (!form) return;

      const listAllCheckboxes = () => [...form.querySelectorAll('input[type="checkbox"]')];
      const computeSelectedCount = () => listAllCheckboxes().filter(el => Boolean(el.checked)).length;

      const updateUi = () => {
        const count = computeSelectedCount();
        const c = form.querySelector(".uesrpg-adv-count");
        if (c) c.textContent = tf("UESRPG.Dialogs.Opposed.SelectedCount", { count, max }, `${count} / ${max} selected`);

        for (const el of listAllCheckboxes()) {
          
          if (Boolean(el.checked)) {
            el.disabled = false;
            continue;
          }
          el.disabled = (count >= max);
        }
      };

      for (const el of listAllCheckboxes()) {
        el.addEventListener("change", (ev) => {
          if (ev.currentTarget?.dataset?.free === "true") {
            updateUi();
            return;
          }
          const count = computeSelectedCount();
          if (count > max) {
            ev.currentTarget.checked = false;
            ui.notifications.warn(tf("UESRPG.Notifications.Opposed.OnlyHaveAdvantage", { count: max }, `You only have ${max} Advantage to spend.`));
          }
          updateUi();
        });
      }

      updateUi();
    },
  });
  } finally {
    clearItemDescriptionTooltip(tooltipScope);
  }
}
