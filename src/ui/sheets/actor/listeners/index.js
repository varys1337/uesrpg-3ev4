/**
 * Actor sheet listener registration (entry point).
 * 
 * Foundry VTT v13 / AppV1-compatible.
 * 
 * Registers all actor sheet event listeners by delegating to domain-specific modules.
 */

import { registerCommonListeners } from "./common.js";
import { registerInventoryListeners } from "./inventory.js";
import { registerRollListeners } from "./rolls.js";
import { registerMagicCastListeners } from "./magic-cast.js";

/**
 * Register all actor sheet listeners.
 * 
 * Called from SimpleActorSheet#activateListeners().
 * 
 * @param {SimpleActorSheet} sheet - The actor sheet instance
 * @param {jQuery} html - The rendered sheet HTML
 */
export function registerActorSheetListeners(sheet, html) {
  registerCommonListeners(sheet, html);
  registerInventoryListeners(sheet, html);
  registerRollListeners(sheet, html);
  registerMagicCastListeners(sheet, html);
}
