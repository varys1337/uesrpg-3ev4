import { SYSTEM_ID } from "../../../core/system/namespace.js";
import { localizeSettingConfig } from "../../../utils/i18n.js";

function _reg(key, config) {
  if (game.settings.settings?.has(`${SYSTEM_ID}.${key}`)) {
    console.warn(`UESRPG | Settings: duplicate key "${key}" — skipping.`);
    return;
  }
  game.settings.register(SYSTEM_ID, key, localizeSettingConfig("Internal", key, config));
}

export function registerInternalSettings() {
  // Hidden rollback/internal state: preserve migration and compatibility bookkeeping.
  // World data version stamp for the new-world-only compatibility gate.
  _reg("worldDataVersion", {
    name: "World Data Version",
    hint: "Records the system version that last initialized this world. Used by the compatibility gate.",
    scope: "world",
    config: false,
    default: "",
    type: String,
  });

  // Migration state payload used by system migrations (JSON string).
  _reg("migrationState", {
    name: "Migration State",
    hint: "Internal migration state payload.",
    scope: "world",
    config: false,
    default: "{}",
    type: String,
  });

  // Migration diagnostics (hidden/internal).
  _reg("migrationDebug", {
    name: "Migration Debug Logging",
    hint: "When enabled, migrations log additional diagnostics.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Compatibility-only no-op retained for one release so existing world data remains readable.
  _reg("templateOptimization", {
    name: "Template Optimization",
    hint: "Deprecated compatibility setting. Foundry's documented template loader is always used.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });
}
