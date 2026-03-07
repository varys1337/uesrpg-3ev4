import { SYSTEM_ID } from "../../../core/system/namespace.js";

function _reg(key, config) {
  if (game.settings.settings?.has(`${SYSTEM_ID}.${key}`)) {
    console.warn(`UESRPG | Settings: duplicate key "${key}" — skipping.`);
    return;
  }
  game.settings.register(SYSTEM_ID, key, config);
}

export function registerInternalSettings() {
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
}
