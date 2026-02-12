/**
 * NPC sheet listener registration (entry point).
 * 
 * Foundry VTT v13 / AppV1-compatible.
 * 
 * Registers all NPC sheet event listeners by delegating to shared and NPC-specific modules.
 */

import { registerNpcOnlyListeners } from "./npc-only.js";
import { 
  onIncrementResource, 
  onResetResource, 
  onShortRest, 
  onLongRest, 
  onIncrementFatigue,
  setResourceBars
} from "../../shared/ui/resources.js";
import { registerStaminaButtonHandler } from "../../actor-sheet-stamina-integration.js";
import { registerHPButtonHandler } from "../../actor-sheet-hp-integration.js";

/**
 * Register all NPC sheet listeners.
 * 
 * Called from npcSheet#activateListeners().
 * 
 * @param {npcSheet} sheet - The NPC sheet instance
 * @param {jQuery} html - The rendered sheet HTML
 */
export function registerNpcSheetListeners(sheet, html) {
  // Register shared resource listeners
  html.find(".incrementResource")
    .off("click.uesrpgNpc")
    .on("click.uesrpgNpc", (ev) => onIncrementResource(sheet, ev));
  html.find(".restoreResource")
    .off("click.uesrpgNpc")
    .on("click.uesrpgNpc", (ev) => onResetResource(sheet, ev));
  html.find(".short-rest")
    .off("click.uesrpgNpc")
    .on("click.uesrpgNpc", (ev) => onShortRest(sheet, ev));
  html.find(".long-rest")
    .off("click.uesrpgNpc")
    .on("click.uesrpgNpc", (ev) => onLongRest(sheet, ev));
  html.find(".incrementFatigue")
    .off("click.uesrpgNpc")
    .on("click.uesrpgNpc", (ev) => onIncrementFatigue(sheet, ev));
  
  // Register stamina and HP button handlers (external integrations)
  registerStaminaButtonHandler(sheet, html);
  registerHPButtonHandler(sheet, html);
  
  // Set resource bars (called after HTML is ready)
  setResourceBars(sheet);
  
  // Register NPC-specific listeners
  registerNpcOnlyListeners(sheet, html);
}
