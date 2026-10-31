import { getFeatureConfig } from "./feature-config.js";
import { getActivationCostPreview } from "../../system/activation/costs-and-usage.js";
import { confirmDialog } from "../../../utils/dialog-v2-helper.js";
import { runTalentActivationAutomation, runPowerActivationAutomation } from "../../system/activation/talent-automation.js";

/** Shared policy for explicit Use actions and automatic feature dispatch. */
export async function prepareFeatureActivation(item, { explicitUse = false, actor = item?.actor, confirmationCostText = null } = {}) {
  const config = getFeatureConfig(item);
  if (config.enabled === false) {
    return { ok: false, status: "disabled", reason: `${item.name} is disabled.`, config, automationEnabled: false };
  }
  const automationEnabled = config.enabled !== false && (explicitUse || config.applyMode !== "manual");
  const inCombat = Boolean(game.combat?.started);
  const reason = config.combatOnly && !inCombat
    ? `${item.name} can only be used during combat.`
    : !config.outOfCombatAllowed && !inCombat
      ? `${item.name} cannot be used outside of combat.` : null;
  if (reason) return { ok: false, status: "failed", reason, config, automationEnabled: false };
  if (automationEnabled && config.applyMode === "confirm") {
    const mode = config.promptMode ?? "owner";
    if (mode === "both") {
      return { ok: false, status: "blocked", config, automationEnabled: false,
        reason: `${item.name} requires both GM and owner confirmation, which this workflow cannot collect yet. A GM must resolve it manually or change the prompt routing.` };
    }
    if (mode === "gm" && !game.user.isGM) {
      return { ok: false, status: "blocked", config, automationEnabled: false,
        reason: `${item.name} requires GM confirmation. Ask a GM to activate it.` };
    }
    if (mode === "owner" && !item.isOwner) {
      return { ok: false, status: "blocked", config, automationEnabled: false,
        reason: `${item.name} requires its owner to confirm the activation.` };
    }
    const shouldPrompt = mode === "gm" ? game.user.isGM
      : mode === "never" ? false : item.isOwner;
    if (shouldPrompt) {
      const preview = confirmationCostText == null ? getActivationCostPreview({ actor, activation: item.system?.activation, label: item.name }) : null;
      const confirmed = await confirmDialog({
        title: `Confirm: ${item.name}`,
        content: `<p>Activate <strong>${foundry.utils.escapeHTML(item.name)}</strong>?</p><p>${foundry.utils.escapeHTML(confirmationCostText ?? preview.reason ?? preview.summary)}</p>`,
        yesLabel: "Activate", noLabel: "Cancel", yesIcon: "fas fa-bolt", noIcon: "fas fa-times", rejectClose: false,
      });
      if (!confirmed) return { ok: false, status: "cancelled", config, automationEnabled: false };
    }
  }
  return { ok: true, config, automationEnabled };
}

/** Boolean compatibility contract; handler failures propagate without fallback. */
export async function runFeatureAutomation({ actor, item, context = {}, resolver = null, enforceFeatureConfig = true, onOutcome = null } = {}) {
  if (!actor || !item) return false;
  if (enforceFeatureConfig) {
    const policy = await prepareFeatureActivation(item);
    if (!policy.ok || !policy.automationEnabled) return false;
  }
  switch (item.type) {
    case "talent":
      return runTalentActivationAutomation({ actor, item, context, resolver, onOutcome });
    case "power":
      return runPowerActivationAutomation({ actor, item, context, onOutcome });
    default:
      // Trait mechanics remain in their existing opposed/damage handlers.
      return false;
  }
}
