import { SYSTEM_ID } from "../../../core/system/namespace.js";
import { localizeSettingConfig } from "../../../utils/i18n.js";

function _reg(key, config) {
  if (game.settings.settings?.has(`${SYSTEM_ID}.${key}`)) {
    console.warn(`UESRPG | Settings: duplicate key "${key}" — skipping.`);
    return;
  }
  game.settings.register(SYSTEM_ID, key, localizeSettingConfig("UI", key, config));
}

/** Shared onChange handler: re-render all open actor and NPC sheets. */
function _reRenderActorSheets() {
  try {
    const windows = Object.values(ui?.windows ?? {});
    for (const win of windows) {
      try {
        const el = win?.element;
        if (!el?.classList?.contains?.("uesrpg-sheet-root")) continue;
        const classList = el.classList;
        const isTargetSheet = classList.contains("actor") || classList.contains("npc");
        if (!isTargetSheet) continue;
        if (typeof win?.render === "function") win.render(false);
      } catch (_innerErr) {
        // no-op
      }
    }
  } catch (_err) {
    // no-op
  }
}

/** Shared onChange handler: re-render all open actor, NPC, item, and group sheets. */
function _reRenderAllSheets() {
  try {
    const windows = Object.values(ui?.windows ?? {});
    for (const win of windows) {
      try {
        const el = win?.element;
        if (!el?.classList?.contains?.("uesrpg-sheet-root")) continue;
        const classList = el.classList;
        const isTargetSheet =
          classList.contains("actor") ||
          classList.contains("item") ||
          classList.contains("group") ||
          classList.contains("npc");
        if (!isTargetSheet) continue;
        if (typeof win?.render === "function") win.render(false);
      } catch (_innerErr) {
        // ignore one-off window render failures
      }
    }
  } catch (_err) {
    // no-op
  }
}

export function registerUiSettings() {
  _reg("changeUiFont", {
    name: "System Font",
    hint: "Changes main Font",
    scope: "world",
    requiresReload: true,
    config: false,
    type: String,
    choices: {
      "Cyrodiil": "Сyrodiil - Default",
      "Magic-Cyr": "Magic-Cyr",
      "Dorovar Carolus": "Dorovar Carolus",
      "Futura Condensed Medium": "Futura Condensed Medium",
      "Kingthings Petrock": "Kingthings Petrock",
      "Morris Roman Black": "Morris Roman Black",
      "Morris Roman Black Alternate": "Morris Roman Black Alternate"
    },
    default: "Cyrodiil"
  });

  _reg("noStartUpDialog", {
    name: "Do Not Show Dialog on Startup",
    hint: "Checking this box hides the startup popup dialog informing the user on additional game resources.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // UI: Custom cursor (passive/active) akin to WFRP4e.
  // Note: Foundry applies CONFIG.cursors for canvas interaction states.
  // We gate this behind a world setting and require reload to apply cleanly.
  _reg("customCursor", {
    name: "Custom Cursor",
    hint: "Use the UESRPG stylized cursor (requires reload).",
    scope: "world",
    config: false,
    requiresReload: true,
    default: true,
    type: Boolean,
  });

  _reg("autoResizeSheets", {
    name: "Auto-resize Actor/Item Sheets",
    hint: "Automatically resize AppV2 actor and item sheets to fit content (clamped to screen height). Disable to restore fixed sizing behavior.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  _reg("enableInlineRulesTooltips", {
    name: "Sheets: Inline Rules Tooltips",
    hint: "Show inline tooltips for qualities/traits and special actions. Alt-click opens a help dialog.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  _reg("encumbranceUiEnhanced", {
    name: "Sheets: Encumbrance Breakdown + Highlights",
    hint: "Show ENC breakdown dialog and highlight top encumbrance contributors.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
    onChange: _reRenderActorSheets,
  });

  _reg("dialogKeyboardEnhancements", {
    name: "Dialogs: Enhanced Keyboard Flow",
    hint: "When enabled, DialogV2 dialogs auto-focus the first input and support Enter/Esc keyboard actions in a consistent way.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  _reg("enableItemRowQuickMenu", {
    name: "Sheets: Item Row Quick Actions Menu",
    hint: "When enabled, right-click on an item row opens a quick actions menu.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
    onChange: _reRenderActorSheets,
  });

  _reg("sheetDensity", {
    name: "Sheets: Density",
    hint: "Controls vertical spacing and row height for UESRPG AppV2 sheets.",
    scope: "client",
    config: false,
    type: String,
    default: "comfortable",
    choices: {
      comfortable: "Comfortable",
      compact: "Compact",
      ultra: "Ultra Compact",
    },
    onChange: _reRenderAllSheets,
  });

  // Hidden diagnostics: client-only tracing for AppV2 sheet lifecycle timings.
  _reg("sheetPerfTrace", {
    name: "Sheet Performance Trace",
    hint: "Log AppV2 sheet timing traces for _prepareContext, _onRender, _attachPartListeners, and _onClose.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  _reg("opposedShowResolutionDetails", {
    name: "Opposed: Show Resolution Details",
    hint: "When enabled, opposed-roll chat cards include an additional expandable section with detailed resolution data. Recommended for testing; disable for normal play.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("opposedShowStatusLine", {
    name: "Opposed: Show Status Line",
    hint: "When enabled, opposed-roll chat cards include Status lines (Committed/Rolled/Resolved). Intended for debugging/testing.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Hidden GM policy: controls chat verbosity for live opposed workflow sub-rolls.
  _reg("opposedPostSubRollMessages", {
    name: "Opposed Rolls: Post Sub-Roll Chat Messages",
    hint: "When enabled, opposed workflows also post separate chat roll cards for attacker/defender sub-rolls. Disable to keep only the parent opposed card in chat.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  // Items tab: per-user loadouts (equipment snapshots)
  _reg("enableLoadouts", {
    name: "Sheets: Enable Equipment Loadouts",
    hint: "When enabled, the Items tab shows a per-user Loadout bar (save/apply equipped-state snapshots).",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("sortAlpha", {
    name: "Sort Actor Items Alphabetically",
    hint: "If checked, Actor items are automatically sorted alphabetically. Otherwise, items are not sorted and are organized manually.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
    requiresReload: true,
  });

  // Hidden diagnostics: client-only actor sheet inspection lane.
  _reg("sheetDiagnostics", {
    name: "Debug: Sheet Diagnostics Panel",
    hint: "When enabled, actor sheets show a small diagnostics panel (client only).",
    scope: "client",
    config: false,
    default: false,
    type: Boolean,
  });
}
