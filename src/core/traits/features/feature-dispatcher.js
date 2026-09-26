import { getFeatureConfig } from "./feature-config.js";
import { getActivationCostPreview } from "../../system/activation/costs-and-usage.js";
import { confirmDialog } from "../../../utils/dialog-v2-helper.js";
import { runTalentActivationAutomation, runPowerActivationAutomation } from "../../system/activation/talent-automation.js";

/** Shared policy for explicit Use actions and automatic feature dispatch. */
export async function prepareFeatureActivation(item, { explicitUse = false, actor = item?.actor } = {}) {
  const config = getFeatureConfig(item);
  const automationEnabled = config.enabled !== false && (explicitUse || config.applyMode !== "manual");
  const inCombat = Boolean(game.combat?.started);
  const reason = config.combatOnly && !inCombat
    ? `${item.name} can only be used during combat.`
    : !config.outOfCombatAllowed && !inCombat
      ? `${item.name} cannot be used outside of combat.` : null;
  if (reason) return { ok: false, status: "failed", reason, config, automationEnabled: false };
  if (automationEnabled && config.applyMode === "confirm") {
    const mode = config.promptMode ?? "owner";
    const shouldPrompt = mode === "gm" ? game.user.isGM
      : mode === "both" ? game.user.isGM || item.isOwner
        : mode === "never" ? false : item.isOwner;
    if (shouldPrompt) {
      const preview = getActivationCostPreview({ actor, activation: item.system?.activation, label: item.name });
      const confirmed = await confirmDialog({
        title: `Confirm: ${item.name}`,
        content: `<p>Activate <strong>${foundry.utils.escapeHTML(item.name)}</strong>?</p><p>${foundry.utils.escapeHTML(preview.reason ?? preview.summary)}</p>`,
        yesLabel: "Activate", noLabel: "Cancel", yesIcon: "fas fa-bolt", noIcon: "fas fa-times", rejectClose: false,
      });
      if (!confirmed) return { ok: false, status: "cancelled", config, automationEnabled: false };
    }
  }
  return { ok: true, config, automationEnabled };
}

/** Boolean compatibility contract; handler failures propagate without fallback. */
export async function runFeatureAutomation({ actor, item, context = {}, resolver = null, enforceFeatureConfig = true } = {}) {
  if (!actor || !item) return false;
  if (enforceFeatureConfig) {
    const policy = await prepareFeatureActivation(item);
    if (!policy.ok || !policy.automationEnabled) return false;
  }
  switch (item.type) {
    case "talent":
      await runTalentActivationAutomation({ actor, item, context, resolver });
      return true;
    case "power":
      await runPowerActivationAutomation({ actor, item });
      return true;
    default:
      // Trait mechanics remain in their existing opposed/damage handlers.
      return false;
  }
}
