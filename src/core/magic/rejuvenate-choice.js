import { hasCoreCompendiumSource } from "../compendium/access-service.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { escapeHtml } from "../../utils/html.js";

const CORE_REJUVENATE_ID = "jvx8x8uJTajYCqhV";

/** Use authored provenance rather than a name, including for spell snapshots. */
export function isCoreRejuvenateSpell(spell) {
  return hasCoreCompendiumSource(spell, { type: "spell", packId: "uesrpg-3ev4.spells-revised", itemId: CORE_REJUVENATE_ID, rule: "Rejuvenate" });
}

export function isRejuvenateChoice(choice) {
  return choice === "stamina" || choice === "fatigue";
}

export function requireRejuvenateChoice(choice) {
  if (!isRejuvenateChoice(choice)) {
    throw Object.assign(new Error("This Rejuvenate outcome has no recorded choice. The GM must review the action and any costs, then resolve the effect manually; do not repeat a paid action."), { committed: false });
  }
  return choice;
}

/** The local choice does not establish a remote participant's consent. */
export async function promptRejuvenateChoice(actor, sourceLabel, { confirmRange = false } = {}) {
  const choice = await customDialog({
    title: "Rejuvenate: choose an effect",
    content: `<p>Discuss ${escapeHtml(sourceLabel)} with ${escapeHtml(actor?.name ?? "the recipient")} and the GM, then choose either 1 Stamina Point or the removal of 1 Fatigue level. Fatigue can only be removed if present when the outcome is applied.</p>${confirmRange ? "<p>Confirm with the GM that the spell recipient is within 1 meter; this dialog does not check range.</p>" : ""}<p>This choice does not collect another player's confirmation. Cancelling here spends no cost for this action.</p>`,
    buttons: {
      stamina: { label: "Restore 1 SP", callback: () => "stamina" },
      fatigue: { label: "Remove 1 Fatigue", callback: () => "fatigue" },
      cancel: { label: "Cancel", callback: () => null },
    },
    default: "cancel",
  });
  return isRejuvenateChoice(choice) ? choice : null;
}
