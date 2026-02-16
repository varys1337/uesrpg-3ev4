/**
 * @module traits/features/feature-dispatcher
 * @description Unified dispatcher for feature automation (traits, talents, powers).
 *
 * This provides a single entry point that:
 *  1. Detects feature type from the item.
 *  2. Normalizes the feature key via the appropriate registry.
 *  3. Routes to the correct handler.
 *
 * For now this is a thin routing layer; existing handlers remain authoritative.
 * Phase 5 will migrate more logic here as confidence builds.
 */

import { normalizeFeatureKey } from "./feature-mod.js";
import { normalizeTalentKey, resolveTalentSlug } from "../talents-api.js";
import { getFeatureConfig } from "./feature-config.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";

let _debugEnabled = false;
let _debugChecked = false;

function _isDebug() {
  if (!_debugChecked) {
    try {
      _debugEnabled = game?.settings?.get?.("uesrpg-3ev4", "activationDebug") === true;
    } catch (_e) {
      _debugEnabled = false;
    }
    _debugChecked = true;
    setTimeout(() => { _debugChecked = false; }, 30_000);
  }
  return _debugEnabled;
}

/**
 * Run feature automation for a trait/talent/power item.
 *
 * @param {{ actor: Actor, item: Item, context?: object, enforceFeatureConfig?: boolean }} params
 * @returns {Promise<boolean>}  true if handled, false otherwise.
 */
export async function runFeatureAutomation({ actor, item, context = {}, enforceFeatureConfig = true } = {}) {
  if (!actor || !item) return false;

  const itemType = String(item.type ?? "");
  const featureKey = _resolveFeatureKey(item, itemType);
  const cfg = getFeatureConfig(item);

  if (enforceFeatureConfig) {
    // Master toggle
    if (cfg.enabled === false) {
      if (_isDebug()) {
        console.debug(`uesrpg | feature-dispatcher: ${itemType} "${item.name}" BLOCKED (disabled via featureConfig)`);
      }
      return false;
    }

    // Combat-only gating
    if (cfg.combatOnly && !game.combat?.started) {
      if (_isDebug()) {
        console.debug(`uesrpg | feature-dispatcher: ${itemType} "${item.name}" BLOCKED (combatOnly, no active combat)`);
      }
      return false;
    }

    // Out-of-combat gating
    if (!cfg.outOfCombatAllowed && !game.combat?.started) {
      if (_isDebug()) {
        console.debug(`uesrpg | feature-dispatcher: ${itemType} "${item.name}" BLOCKED (outOfCombatAllowed=false, no active combat)`);
      }
      return false;
    }

    // Apply mode: manual -> do not auto-dispatch
    if (cfg.applyMode === "manual") {
      if (_isDebug()) {
        console.debug(`uesrpg | feature-dispatcher: ${itemType} "${item.name}" SKIPPED (applyMode=manual)`);
      }
      return false;
    }

    // Apply mode: confirm -> show dialog
    if (cfg.applyMode === "confirm") {
      const confirmed = await _showConfirmDialog(item, cfg);
      if (!confirmed) {
        if (_isDebug()) {
          console.debug(`uesrpg | feature-dispatcher: ${itemType} "${item.name}" CANCELLED by user confirmation`);
        }
        return false;
      }
    }
  }

  if (_isDebug()) {
    console.debug(`uesrpg | feature-dispatcher: ${itemType} "${item.name}" -> key="${featureKey}"`, {
      actor: actor.name,
      context,
      featureConfig: cfg,
      enforceFeatureConfig
    });
  }

  switch (itemType) {
    case "trait":
      return _dispatchTrait(actor, item, featureKey, context);
    case "talent":
      return _dispatchTalent(actor, item, featureKey, context);
    case "power":
      return _dispatchPower(actor, item, featureKey, context);
    default:
      return false;
  }
}

/**
 * Resolve a canonical feature key for an item.
 */
function _resolveFeatureKey(item, itemType) {
  if (itemType === "talent") {
    return resolveTalentSlug(item.name) || normalizeTalentKey(item.name);
  }
  // Traits: use traitKey.traitParam slug
  if (itemType === "trait") {
    const k = String(item.system?.traitKey ?? "");
    const p = String(item.system?.traitParam ?? "");
    return normalizeFeatureKey(`${k}.${p}`);
  }
  // Powers: use name slug
  return normalizeFeatureKey(item.name);
}

/**
 * Dispatch a trait activation.
 * Currently delegates to existing automation.
 */
async function _dispatchTrait(_actor, _item, _featureKey, _context) {
  // Trait automation is currently chat-card-based and handled by opposed/damage systems.
  // This dispatcher remains a no-op until centralized hooks are migrated.
  return false;
}

/**
 * Dispatch a talent activation.
 * Currently delegates to existing racial-talents / combat-talents handlers.
 */
async function _dispatchTalent(_actor, _item, _featureKey, _context) {
  // Existing talent activation logic is still authoritative in activation-executor.
  return false;
}

/**
 * Dispatch a power activation.
 * Currently delegates to existing racial-talents handlers.
 */
async function _dispatchPower(_actor, _item, _featureKey, _context) {
  // Existing power activation logic is still authoritative in activation-executor.
  return false;
}

/**
 * Show a confirmation dialog for features with applyMode="confirm".
 * Routes the dialog to the appropriate user(s) based on promptMode.
 *
 * @param {Item} item
 * @param {object} cfg - Feature config
 * @returns {Promise<boolean>} true if confirmed, false if cancelled
 */
async function _showConfirmDialog(item, cfg) {
  const promptMode = cfg.promptMode ?? "owner";

  // Check if the current user should see this prompt
  const isGM = game.user.isGM;
  const isOwner = item.isOwner;
  let shouldPrompt = false;

  switch (promptMode) {
    case "gm":    shouldPrompt = isGM; break;
    case "owner": shouldPrompt = isOwner; break;
    case "both":  shouldPrompt = isGM || isOwner; break;
    case "never": return true; // auto-confirm
    default:      shouldPrompt = isOwner; break;
  }

  if (!shouldPrompt) return true; // Not our concern; let it pass

  try {
    const confirmed = await customDialog({
      title: `Confirm: ${item.name}`,
      content: `<p>Activate <strong>${item.name}</strong>?</p>`,
      buttons: {
        yes: { icon: '<i class="fas fa-bolt"></i>', label: "Activate", callback: () => true },
        no:  { icon: '<i class="fas fa-times"></i>', label: "Cancel", callback: () => false }
      },
      default: "yes"
    });
    return confirmed === true;
  } catch (err) {
    console.warn("uesrpg | feature-dispatcher: confirmation dialog error", err);
    return false;
  }
}
