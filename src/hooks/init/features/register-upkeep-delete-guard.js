import { FLAG_SCOPE } from "../../../core/constants.js";
import { registerOnce } from "../../_internal/hook-registry.js";

export function registerUpkeepDeleteGuard() {
  registerOnce("hooks:upkeep-delete-guard", () => {
    Hooks.on("preDeleteActiveEffect", (effect, options) => {
      try {
        const flags = effect?.flags?.[FLAG_SCOPE];
        if (!flags?.spellEffect || !flags?.hasUpkeep) return;
        if (!flags?.upkeepAwaiting) return;
        if (options?.uesrpgAllowUpkeepDelete) return;

        if (!options?.uesrpgExpirationSweep) return;
        return false;
      } catch (err) {
        console.error("UESRPG | Upkeep delete guard failed", err);
      }
    });
  });
}
