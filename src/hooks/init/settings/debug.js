import { SYSTEM_ID } from "../../../core/system/namespace.js";
import { invalidateCachedSetting } from "../../../core/config/settings-cache.js";
import { localizeSettingConfig } from "../../../utils/i18n.js";

function _reg(key, config) {
  if (game.settings.settings?.has(`${SYSTEM_ID}.${key}`)) {
    console.warn(`UESRPG | Settings: duplicate key "${key}" вЂ” skipping.`);
    return;
  }
  game.settings.register(SYSTEM_ID, key, localizeSettingConfig("Debug", key, config));
}

export function registerDebugSettings() {
  // Hidden diagnostics: developer-only logging and tracing lanes.
  // в”Ђв”Ђ Drag-and-Drop diagnostics в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

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

  // в”Ђв”Ђ Active Effect diagnostics в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  _reg("containerDebug", {
    name: "Container Bugtracker",
    hint: "Record container pointer, snapshot, drop, and render diagnostics. Exposes game.uesrpg.debug.auditContainers(actorOrUuid).",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  _reg("aeLifecycleDebug", {
    name: "Active Effect Lifecycle Debug",
    hint: "Log all AE fetch/delete operations (for troubleshooting only). Helps diagnose 'does not exist' errors.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  // в”Ђв”Ђ Performance в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

  _reg("perfDebug", {
    name: "Performance Profiling",
    hint: "Log console.time/timeEnd markers for getData() and opposed resolution.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  _reg("templateDebug", {
    name: "Template Optimization Debug",
    hint: "Log template compilation caching and rendering performance diagnostics.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  _reg("timePerformanceDebug", {
    name: "Time/Combat: Round-Boundary Performance Recording",
    hint: "Record structured timing events for round-boundary phases: TimeService fan-out, spell tick dispatch, OverTime collect/process, turn-ticker sub-phases, and authority-proxy write counts. Access results via game.uesrpg.perf. Independent of the debug master gate.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  // в”Ђв”Ђ Spell / magic diagnostics в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

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

  // Hidden rollout/performance flags: live runtime branches retained for rollback and validation.
  _reg("compositeBoundaryTickEnabled", {
    name: "Spell Tick: Composite Round-Boundary Dispatch",
    hint: "When enabled, the spell tick engine collapses the four sequential round-boundary dispatches (turnStart, turnEnd, roundStart, roundEnd) into a single composite pass. Handlers that register fnBoundary receive one call with the full boundary context instead of four separate calls. The OverTime engine uses this to call _ensureIndex() once per boundary instead of four times. Default: true.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  _reg("aggregateRegenPrompts", {
    name: "Round Start: Aggregate Regeneration Prompts",
    hint: "When enabled, all regeneration prompts for a round are batched into one chat message (one per owning-player group) instead of one message per actor. Eliminates the chat storm when multiple combatants have Regeneration. Default: false (legacy one-message-per-actor path).",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("aggregateSilencedChecks", {
    name: "Round Start: Parallelise Silenced Realization Checks",
    hint: "When enabled, silenced realization checks for all affected combatants run concurrently instead of sequentially. Messages are unchanged (one roll message per actor). Reduces total round-start latency when multiple actors are Silenced. Default: false (sequential legacy path).",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("useRoundStartCandidateRegistry", {
    name: "Round Start: Candidate Registry",
    hint: "When enabled, round-start Regeneration and Silenced candidate discovery uses an indexed registry (actorsWithRegeneration / actorsSilencedInCombat) maintained from actor and ActiveEffect lifecycle hooks, instead of broad combatant scans each round boundary. Includes automatic one-boundary fallback scan when registry data cannot be trusted. Default: true.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  _reg("skipAttackTrackerEagerReset", {
    name: "Round Start: Skip Eager Attack Tracker Reset",
    hint: "When enabled, the attack tracker skips per-actor document writes at round start. Attack counts are still correctly reset lazily on first read/use in the new round (the existing last_reset_round guard handles this). Eliminates N actor writes per round at the cost of briefly stale displayed values. Default: false.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("useZoneRegistry", {
    name: "Timed Magic: Zone Registry",
    hint: "When enabled, active spell zones are tracked in an indexed registry (Map<aeUuid, ZoneEntry>) instead of scanning all actors on every turnEnd tick. Seeded at system ready; maintained incrementally via AE lifecycle hooks. Eliminates O(all_actors Г— all_effects) scans in getActiveSpellZones(). Default: false.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("useRuneRegistry", {
    name: "Timed Magic: Rune Registry",
    hint: "When enabled, active rune Origin AEs are tracked in an indexed registry instead of scanning all actors on every turnEnd, worldTime tick, and token move. Seeded at system ready; maintained incrementally via AE lifecycle hooks. Default: false.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("useCloakRegistry", {
    name: "Timed Magic: Cloak Actor Registry",
    hint: "When enabled, actors with active Origin AEs are tracked in a Set so the cloak tick handler can skip actors that are not known cloak casters without calling getOriginAEs(). Seeded at system ready; maintained via AE lifecycle hooks. Default: false.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("deferNonCriticalRoundBoundaryWork", {
    name: "Round Boundary: Defer Non-Critical Presentation Work",
    hint: "When enabled, non-rules-critical round-boundary work (regeneration prompts, silenced realization checks) is deferred to run after the combat tracker UI has visibly updated (double-requestAnimationFrame yield). Rules-critical phases (condition ticking, effect expiry) remain synchronous. Default: false.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("useCombatBoundaryOrchestrator", {
    name: "Round Boundary: Use Internal Orchestrator (Optional)",
    hint: "When enabled, selected internal post-boundary consumers run through one ordered orchestrator lane instead of separate direct uesrpg.combatTimeChanged listeners. Default: true.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  // Hidden diagnostics: master gates and subsystem-specific debug lanes.
  _reg("debugEnabled", {
    name: "Enable World Debug Logging",
    hint: "Enables all UESRPG world-level debug logging. Covers opposed workflows, spell casting, talents, wounds, and more.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("debugClientEnabled", {
    name: "Enable Client Debug Logging",
    hint: "Enables all UESRPG client-level debug logging for this user. Covers AE lifecycle, aim, sheet diagnostics, performance traces, and more.",
    scope: "client",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("showFeatureInspector", {
    name: "Show Feature Inspector",
    hint: "When enabled, shows the Feature Inspector provenance panel on PC and NPC actor sheets. Debug tool вЂ” hidden by default.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
    onChange: () => invalidateCachedSetting("showFeatureInspector"),
  });

  _reg("opposedDebug", {
    name: "Opposed Debug Logging",
    hint: "When enabled, the opposed-roll workflow logs detailed diagnostic information to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("effectsProxyDebug", {
    name: "Effects/Proxy Debug Logging",
    hint: "When enabled, the authority proxy (ChatMessage updates + target-side ActiveEffect application) logs concise diagnostics to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

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

  _reg("shieldDebug", {
    name: "Shield: Visibility Debug Logging",
    hint: "When enabled, logs shield lifecycle, updates, containment, and inventory visibility decisions to the browser console.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean
  });
}
