/**
 * Common actor sheet listeners (menus, UI toggles, resources).
 * 
 * Foundry VTT v13 / AppV1-compatible.
 */

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
 * Register common sheet listeners (menus, resources, UI controls).
 * 
 * @param {SimpleActorSheet} sheet - The actor sheet instance
 * @param {jQuery} html - The rendered sheet HTML
 */
export function registerCommonListeners(sheet, html) {
  // Resource management
  html.find(".incrementResource")
    .off("click.uesrpgCommon")
    .on("click.uesrpgCommon", (ev) => onIncrementResource(sheet, ev));
  html.find(".restoreResource")
    .off("click.uesrpgCommon")
    .on("click.uesrpgCommon", (ev) => onResetResource(sheet, ev));
  html.find(".short-rest")
    .off("click.uesrpgCommon")
    .on("click.uesrpgCommon", (ev) => onShortRest(sheet, ev));
  html.find(".long-rest")
    .off("click.uesrpgCommon")
    .on("click.uesrpgCommon", (ev) => onLongRest(sheet, ev));
  html.find(".incrementFatigue")
    .off("click.uesrpgCommon")
    .on("click.uesrpgCommon", (ev) => onIncrementFatigue(sheet, ev));
  
  // Register stamina and HP button handlers (external integrations)
  registerStaminaButtonHandler(sheet, html);
  registerHPButtonHandler(sheet, html);
  
  // Set resource bars (called after HTML is ready)
  setResourceBars(sheet);
  
  // TODO (Phase 4 continuation):
  // - Menu listeners (XP, race, birthsign, lucky, characteristics, wealth, carry bonus, rank select)
  // - Filter listeners
  // - Collapsible group listeners
  // - Loadout listeners
}
