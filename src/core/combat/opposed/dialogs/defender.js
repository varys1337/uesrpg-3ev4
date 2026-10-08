import { buildCombatOptionTooltipText } from "../../../../data/tooltips/index.js";
import { renderAdvantageChoices, readAdvantageChoices, bindAdvantageChoices, getAdvantageChoiceLimit, isAdvantageSelectionValid } from "./advantage-options.js";

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
import { t } from "../../../../utils/i18n.js";

import { bindItemDescriptionTooltips, clearItemDescriptionTooltip } from "../../../../ui/sheets/v2/shared/sheet-tooltips.js";


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

  const max = getAdvantageChoiceLimit(advantageCount);

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


  const optionHelp = {
    overextend: buildCombatOptionTooltipText("overextend", hasExploitTalent
      ? (exploitEligible ? t("UESRPG.Dialogs.Opposed.ExploitAdvantageOverextendEligible", "Exploit Advantage: Overextend is doubled (-20) (isolated duel).")
        : t("UESRPG.Dialogs.Opposed.ExploitAdvantageOverextendRequiresDuel", "Exploit Advantage: requires an isolated duel to double Overextend.")) : ""),
    overwhelm: buildCombatOptionTooltipText("overwhelm"),
  };
  const options = [
    { id: "overextend", title: t("UESRPG.Dialogs.Opposed.Overextend", "Overextend"), help: optionHelp.overextend },
    { id: "overwhelm", title: t("UESRPG.Dialogs.Opposed.Overwhelm", "Overwhelm"), help: optionHelp.overwhelm },
    ...knownSpecial.map(special => ({ id: `sa:${special.id}`, special }))
  ];
  const content = `<div class="uesrpg-dialog-stack uesrpg-adv-dialog uesrpg-adv-dialog--defender uesrpg-adv-dialog--choice-bars">
    ${renderAdvantageChoices({ count: max, options })}
  </div>`;

  const tooltipScope = { kind: "adv-dialog", domain: "defender-advantage" };
  try {
    return await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.Opposed.ResolveDefenderAdvantage", "Resolve Defender Advantage"),
      content,
      classes: ["uesrpg-attack-declare", "uesrpg-adv-resolution-window"],
      width: 460,
      buttons: {
        apply: {
          label: t("UESRPG.UI.Apply", "Apply"),
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.element ?? html;
            const form = root?.querySelector(".uesrpg-adv-dialog--defender") ?? root;
            if (!form) return null;

            const selected = readAdvantageChoices(form);
            const overextend = selected.includes("overextend");
            const overextendDouble = Boolean(overextend && exploitEligible);
            const overwhelm = selected.includes("overwhelm");
            const selectedSpecial = knownSpecial.filter(sa => selected.includes(`sa:${sa.id}`)).map(sa => String(sa.id));
            if (!isAdvantageSelectionValid({ overextend, overwhelm, specialActionsSelected: selectedSpecial }, max, { role: "defender" })) return null;

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

      bindAdvantageChoices(root, { finalAction: "apply" });
    },
  });
  } finally {
    clearItemDescriptionTooltip(tooltipScope);
  }
}
