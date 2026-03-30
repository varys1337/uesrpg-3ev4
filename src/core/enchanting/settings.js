/**
 * src/core/enchanting/settings.js
 *
 * Centralized settings access for the enchanting subsystem.
 *
 * Only this module reads game.settings for enchanting-specific configuration.
 * Builders and runtime modules call getEnchantingSettings() instead of
 * accessing game.settings directly, keeping engine code deterministic and
 * easier to test.
 *
 * Do NOT register new settings here; only read existing ones.
 *
 * Target: Foundry VTT v13.351
 */

import { SYSTEM_ID } from "../constants.js";

/**
 * Read all enchanting-related system settings in one place.
 *
 * @returns {{ enableChargedStrikeVariant: boolean, enableCursedConstant: boolean, enableCastEnchantmentRuntime: boolean }}
 */
export function getEnchantingSettings() {
  try {
    return {
      enableChargedStrikeVariant: Boolean(game.settings.get(SYSTEM_ID, "enchanting.enableChargedStrikeVariant")),
      enableCursedConstant: Boolean(game.settings.get(SYSTEM_ID, "enchanting.enableCursedConstant")),
      enableCastEnchantmentRuntime: Boolean(game.settings.get(SYSTEM_ID, "enchanting.enableCastEnchantmentRuntime")),
    };
  } catch (_err) {
    // Safe fallback if called before settings are registered (e.g., during import-time tests).
    return { enableChargedStrikeVariant: false, enableCursedConstant: false, enableCastEnchantmentRuntime: false };
  }
}
