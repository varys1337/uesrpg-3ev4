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

  // Template optimization setting
  _reg("templateOptimization", {
    name: "Template Optimization",
    hint: "Enables template compilation caching and optimization for improved performance.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });
}
