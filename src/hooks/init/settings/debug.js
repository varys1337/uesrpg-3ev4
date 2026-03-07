import { SYSTEM_ID } from "../../../core/system/namespace.js";
import { invalidateCachedSetting } from "../../../core/config/settings-cache.js";

function _reg(key, config) {
  if (game.settings.settings?.has(`${SYSTEM_ID}.${key}`)) {
    console.warn(`UESRPG | Settings: duplicate key "${key}" — skipping.`);
    return;
  }
  game.settings.register(SYSTEM_ID, key, config);
}

export function registerDebugSettings() {
  // ── Drag-and-Drop diagnostics ─────────────────────────────────────────────

  _reg("dndDebugEnabled", {
    name: "DnD Debug Logging",
    hint: "Log detailed drag-and-drop payload parsing and resolution diagnostics for sheet item transfers.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  _reg("dndDebugVerbose", {
    name: "DnD Debug Verbose Groups",
    hint: "Use grouped console output for drag-and-drop diagnostics (requires DnD Debug Logging).",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  _reg("dndDebugNotifyOnFailure", {
    name: "DnD Debug Failure Notifications",
    hint: "Show user warnings for terminal drag-and-drop failures with correlation IDs.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  _reg("dndDebugDomEvents", {
    name: "DnD Debug DOM Events",
    hint: "Log low-level DOM dragstart/drop observer events (high volume).",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  _reg("dndDebugKeepRecentCount", {
    name: "DnD Debug Recent Trace Count",
    hint: "How many recent in-memory DnD trace events to keep for dumpDndTrace helpers.",
    scope: "client",
    config: false,
    type: Number,
    default: 100,
  });

  _reg("dndDebugCacheFallbackEnabled", {
    name: "DnD Cache Fallback Enabled",
    hint: "Allow last-drag payload cache fallback when drop payload parsing is incomplete.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  // ── Active Effect diagnostics ──────────────────────────────────────────────

  _reg("aeLifecycleDebug", {
    name: "Active Effect Lifecycle Debug",
    hint: "Log all AE fetch/delete operations (for troubleshooting only). Helps diagnose 'does not exist' errors.",
    scope: "client",
    // Keep this out of the main System Settings list; expose it via the Debugging submenu.
    config: false,
    type: Boolean,
    default: false,
  });

  // ── Performance ──────────────────────────────────────────────────────────────

  _reg("perfDebug", {
    name: "Performance Profiling",
    hint: "Log console.time/timeEnd markers for getData(), rule element evaluation, and opposed resolution.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  // ── Spell / magic diagnostics ─────────────────────────────────────────────

  _reg("spellTickDebug", {
    name: "Spell Tick Engine: Debug Logging",
    hint: "When enabled, the spell tick engine logs turn/round/worldTime tick events and handler invocations.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("overTimeDebug", {
    name: "OverTime Effects: Debug Logging",
    hint: "When enabled, the OverTime effects engine logs effect collection, cadence gating, payload execution, and state updates.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // ── Master debug gates ────────────────────────────────────────────────────

  // Global master gate for all world-scope debug lanes.
  _reg("debugEnabled", {
    name: "Enable World Debug Logging",
    hint: "Enables all UESRPG world-level debug logging. Covers opposed workflows, spell casting, talents, wounds, and more.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Client-scope master gate for all client debug lanes.
  _reg("debugClientEnabled", {
    name: "Enable Client Debug Logging",
    hint: "Enables all UESRPG client-level debug logging for this user. Covers AE lifecycle, aim, sheet diagnostics, performance traces, and more.",
    scope: "client",
    config: false,
    default: false,
    type: Boolean,
  });

  // Feature Inspector visibility toggle (debug/provenance panel on actor sheets)
  _reg("showFeatureInspector", {
    name: "Show Feature Inspector",
    hint: "When enabled, shows the Feature Inspector provenance panel on PC and NPC actor sheets. Debug tool — hidden by default.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
    onChange: () => invalidateCachedSetting("showFeatureInspector"),
  });

  // ── Opposed workflow diagnostics ──────────────────────────────────────────

  // Opposed workflow diagnostics
  _reg("opposedDebug", {
    name: "Opposed Debug Logging",
    hint: "When enabled, the opposed-roll workflow logs detailed diagnostic information to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Authority proxy diagnostics (GM/owner proxy mutations)
  _reg("effectsProxyDebug", {
    name: "Effects/Proxy Debug Logging",
    hint: "When enabled, the authority proxy (ChatMessage updates + target-side ActiveEffect application) logs concise diagnostics to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Magic workflow routing diagnostics
  _reg("debugMagicRouting", {
    name: "Magic: Routing Debug Logging",
    hint: "When enabled, spell routing decisions (targeted vs unopposed vs legacy) are logged to the browser console. Recommended only for testing.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("opposedDebugFormula", {
    name: "Opposed Debug: Formula Normalization",
    hint: "When enabled (testing), logs when a roll formula is normalized or rejected before evaluation.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("spellCastingDebug", {
    name: "Spell Casting: Workflow Debug Logging",
    hint: "When enabled, spell casting workflow logs comprehensive diagnostic information including spell data, dialog construction, and scaling level processing. Recommended only for debugging scaling dropdown issues.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("activationDebug", {
    name: "Activation/Talent: Debug Logging",
    hint: "When enabled, activation and talent automation workflows log detailed diagnostics to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Skill roll diagnostics
  _reg("skillRollDebug", {
    name: "Skill Roll Debug Logging",
    hint: "When enabled, skill rolls and skill-opposed workflows log structured diagnostic information to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("debugSkillTN", {
    name: "Debug: Skill TN Macro",
    hint: "When enabled (GM only), exposes game.uesrpg.debugSkillTN(...) for diagnosing skill TN computation.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
    requiresReload: true
  });

  _reg("debugAim", {
    name: "Aim: Debug Audit Logging",
    hint: "When enabled, logs Aim apply/stack, break, and consume events to the browser console.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  _reg("debugActorSelect", {
    name: "Actor Select: Debug Logging",
    hint: "When enabled (client-only), logs TN-relevant actor context whenever you control a token (developer utility).",
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  _reg("woundsDebug", {
    name: "Wounds: Debug Logging",
    hint: "When enabled, wound automation logs structured diagnostic information to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean
  });
}
