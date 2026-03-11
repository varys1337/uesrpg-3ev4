import startupHandler from './hooks/startup.js';
import initHandler from './hooks/init.js';
import { alertDialog } from "./utils/dialog-v2-helper.js";
import { openStaminaDialog, getActiveStaminaEffect, consumeStaminaEffect } from "./core/stamina/stamina-dialog.js";
import { 
  applyPhysicalExertionBonus, 
  applyPhysicalExertionToSkill,
  applyPowerAttackBonus,
  applySprintBonus,
  applyPowerDrawBonus,
  applyPowerBlockBonus,
  hasStaminaEffect
} from "./core/stamina/stamina-integration-hooks.js";
import { AttackTracker } from "./core/combat/attack-tracker.js";
import { initializeTimeService, initializeCombatBoundaryOrchestrator } from "./core/time/index.js";
import { isDebugEnabled } from "./utils/debug.js";
import { initSettingsCache } from "./core/config/settings-cache.js";
import { SYSTEM_ID } from "./core/system/namespace.js";

const _TIME_SETTINGS_MIGRATION_KEY = "timeDefaultsCompositeOrchestratorV1";

function _hasStoredWorldSetting(key) {
  try {
    const storage = game?.settings?.storage?.get?.("world");
    if (!storage || typeof storage.has !== "function") return false;
    return storage.has(`${SYSTEM_ID}.${String(key ?? "").trim()}`);
  } catch (_e) {
    return false;
  }
}

async function _migrateTimeDefaultsSafely() {
  if (!game.user?.isGM) return;

  let state = {};
  try {
    const raw = String(game.settings.get(SYSTEM_ID, "migrationState") ?? "{}");
    const parsed = JSON.parse(raw);
    state = (parsed && typeof parsed === "object") ? parsed : {};
  } catch (_e) {
    state = {};
  }

  if (state?.[_TIME_SETTINGS_MIGRATION_KEY]) return;

  const changed = [];
  const targets = ["compositeBoundaryTickEnabled", "useCombatBoundaryOrchestrator"];
  for (const key of targets) {
    if (_hasStoredWorldSetting(key)) continue; // Respect explicit world choices.
    try {
      await game.settings.set(SYSTEM_ID, key, true);
      changed.push(key);
    } catch (err) {
      console.warn(`UESRPG | Failed setting migration for "${key}"`, err);
    }
  }

  state[_TIME_SETTINGS_MIGRATION_KEY] = {
    appliedAt: Date.now(),
    changedKeys: changed
  };

  try {
    await game.settings.set(SYSTEM_ID, "migrationState", JSON.stringify(state));
  } catch (err) {
    console.warn("UESRPG | Failed to persist time settings migration state", err);
  }
}

Hooks.once('ready', async function () {
  console.log(`UESRPG | Ready`);

  // World compatibility and migration runner.
  // If the world was last used on a different system version,
  // warn and continue so available migrations can run.
  const currentVersion = game.system?.version ?? "";
  const stampedVersion = game.settings.get("uesrpg-3ev4", "worldDataVersion");

  if (!stampedVersion) {
    // First launch in this world - stamp it.
    try {
      await game.settings.set("uesrpg-3ev4", "worldDataVersion", currentVersion);
      console.log(`UESRPG | World data version stamped: ${currentVersion}`);
    } catch (err) {
      console.warn("UESRPG | Failed to stamp world data version", err);
    }
  } else if (stampedVersion !== currentVersion) {
    // Mismatch: world was last used with a different system build.
    if (game.user?.isGM) {
      ui.notifications.warn(
        `UESRPG | This world was created with system version ${stampedVersion} ` +
        `but the current system version is ${currentVersion}. ` +
        `Continuing with startup and available migrations.`,
        { permanent: true }
      );
      alertDialog({
        title: "UESRPG - Version Mismatch",
        content: `<p>This world was last used with system version <strong>${stampedVersion}</strong>, ` +
          `but the current system is <strong>${currentVersion}</strong>.</p>` +
          `<p>Automatic compatibility migrations will run where available.</p>`,
        buttonLabel: "Understood",
        buttonIcon: "fas fa-check",
      });
    }
    console.warn(`UESRPG | World version mismatch: stamped=${stampedVersion}, current=${currentVersion}. Continuing with migrations.`);
    if (game.user?.isGM) {
      try {
        await game.settings.set("uesrpg-3ev4", "worldDataVersion", currentVersion);
        console.log(`UESRPG | World data version updated: ${stampedVersion} -> ${currentVersion}`);
      } catch (err) {
        console.warn("UESRPG | Failed to update world data version stamp", err);
      }
    }
  }

  // Safe default migration for boundary-time optimizations.
  // Enables new defaults only when a world has not explicitly stored those keys.
  await _migrateTimeDefaultsSafely();

  await startupHandler();

  // Populate the hot-settings cache (showFeatureInspector, useRawChargenWizard).
  // Must run after startupHandler so all settings are guaranteed registered.
  initSettingsCache();

  // Initialize the round-boundary perf API (game.uesrpg.perf).
  // Only allocates the API surface; no overhead when timePerformanceDebug is off.
  try {
    const { initializePerfApi } = await import("./utils/perf-tracker.js");
    initializePerfApi();
  } catch (err) {
    console.warn("UESRPG | Failed to initialize perf API", err);
  }

  // Optional Chapter 4 compliance audit on startup (GM only).
  try {
    if (game.user?.isGM) {
      const auditMode = String(game.settings.get("uesrpg-3ev4", "chapter4AuditStartupMode") ?? "off");
      if (auditMode !== "off" && typeof game.uesrpg?.auditChapter4 === "function") {
        const includeEntries = auditMode === "full";
        const report = game.uesrpg.auditChapter4({ includeEntries, log: includeEntries });
        const gaps = report?.gaps ?? {};
        const gapCount =
          (Array.isArray(gaps.missingFromCatalog) ? gaps.missingFromCatalog.length : 0) +
          (Array.isArray(gaps.unknownAutomation) ? gaps.unknownAutomation.length : 0) +
          (Array.isArray(gaps.notAutomated) ? gaps.notAutomated.length : 0) +
          (Array.isArray(gaps.blocked) ? gaps.blocked.length : 0) +
          (Array.isArray(gaps.stubs) ? gaps.stubs.length : 0) +
          (gaps.traitsCatalogMissing ? 1 : 0) +
          (gaps.powersCatalogMissing ? 1 : 0);

        if (gapCount > 0) {
          ui.notifications?.warn?.(`Chapter 4 audit found ${gapCount} compliance gap(s). Use game.uesrpg.auditChapter4({ includeEntries: true, log: true }) for details.`);
        } else {
          ui.notifications?.info?.("Chapter 4 audit: no compliance gaps detected.");
        }
      }
    }
  } catch (err) {
    console.warn("UESRPG | Chapter 4 startup audit failed", err);
  }
  
  // Lazy-load magic/combat subsystem initializers (deferred from top-level imports
  // to reduce parse time during initial module load; each is needed exactly once here).
  const [
    { initializeUpkeepSystem },
    { initializeSpellEffectExpirationSystem },
    { initializeOriginAELifecycle },
    { initializeSpellTickEngine, registerZoneTickHandler },
    { initializeOverTimeEngine },
    { initializeRuneTriggerService, seedRuneRegistry },
    { initializeConditionTriggers },
    { initializeSummonBinding },
    { initializeMindlockHook },
    { initializeBoundItemService },
    { initializeConjurationRuntime },
    { initializeSoulTrapService },
    { initializeDisintegrateService },
    { initializeDrainService },
    { initializeUtilitySpellsService },
    { initializeCharacteristicDefenseService },
    { initializeCloakTickHandler, seedCloakRegistry },
    // Magic opposed workflow has no initialize() export - importing it eagerly
    // registers its renderChatMessageHTML hook so existing chat cards survive reload.
    _magicOpposed,
    { seedZoneRegistry }
  ] = await Promise.all([
    import("./core/magic/upkeep-workflow.js"),
    import("./core/magic/effects/spell-effect-expiration.js"),
    import("./core/magic/effects/origin-effect.js"),
    import("./core/magic/ticks/spell-tick-engine.js"),
    import("./core/magic/ticks/overtime-engine.js"),
    import("./core/magic/services/rune-trigger-service.js"),
    import("./core/magic/services/condition-triggers.js"),
    import("./core/magic/conjuration/summon-binding.js"),
    import("./core/magic/mindlock.js"),
    import("./core/magic/conjuration/bound-item-service.js"),
    import("./core/magic/conjuration/conjuration-runtime.js"),
    import("./core/magic/services/soul-trap-service.js"),
    import("./core/magic/services/disintegrate-service.js"),
    import("./core/magic/services/drain-service.js"),
    import("./core/magic/services/utility-spells-service.js"),
    import("./core/magic/characteristic-defense-service.js"),
    import("./core/magic/ticks/cloak-tick-handler.js"),
    import("./core/magic/opposed-workflow.js"),
    import("./core/magic/spell-runtime.js")
  ]);

  // Initialize spell upkeep system
  initializeUpkeepSystem();
  initializeSpellEffectExpirationSystem();

  // Initialize Origin AE lifecycle (auto-teardown on deletion)
  initializeOriginAELifecycle();

  // Initialize spell tick engine (zone ticks, rune time triggers, etc.)
  initializeSpellTickEngine();
  registerZoneTickHandler();

  // Initialize OverTime effects engine (DoT/HoT/saves per tick)
  initializeOverTimeEngine();

  // Initialize rune/trap trigger detection (proximity + time triggers)
  initializeRuneTriggerService();

  // Initialize condition triggers (invisibility break, etc.)
  initializeConditionTriggers();

  // Initialize summon binding (Mindlock, Restrained, binding prompt)
  initializeSummonBinding();

  // Initialize generic Mindlock hook (non-summon spells with mindlockValue)
  initializeMindlockHook();

  // Initialize bound item service (Conjure [Weapon/Armor] lifecycle - legacy flag-based)
  initializeBoundItemService();

  // Initialize conjuration runtime (engine.conjure-based item conjuring & creature summoning)
  initializeConjurationRuntime();

  // Initialize Soul Trap death hook (soul gem creation on target death)
  initializeSoulTrapService();

  // Initialize Disintegrate automation (Damaged quality on armor/weapon)
  initializeDisintegrateService();

  // Initialize Drain automation (current pool drains without max reduction)
  initializeDrainService();

  // Initialize utility singleton spell handlers (Recall/Detect/Telepathy/Open/Cure Disease/Stabilize)
  initializeUtilitySpellsService();

  // Initialize characteristic defense (save-like defense model for spells)
  initializeCharacteristicDefenseService();

  // Initialize cloak tick handler (AoE aura tick damage at end of turn)
  initializeCloakTickHandler();

  // Seed indexed runtime registries (Milestone D).
  // Each call: rebuilds its registry from live actor data, then installs AE
  // lifecycle hooks for incremental maintenance. All three are idempotent.
  // Registry use is gated per-setting (useZoneRegistry / useRuneRegistry /
  // useCloakRegistry); seeding always runs so data is ready if a setting is
  // toggled mid-session.
  seedZoneRegistry();
  seedRuneRegistry();
  seedCloakRegistry();

  // Expose GM debug rebuild utilities on game.uesrpg.magic.
  if (game.user?.isGM) {
    if (!game.uesrpg) game.uesrpg = {};
    if (!game.uesrpg.magic) game.uesrpg.magic = {};
    try {
      const { rebuildZoneRegistry } = await import("./core/magic/spell-runtime.js");
      const { rebuildRuneRegistry } = await import("./core/magic/services/rune-trigger-service.js");
      game.uesrpg.magic.rebuildZoneRegistry = rebuildZoneRegistry;
      game.uesrpg.magic.rebuildRuneRegistry = rebuildRuneRegistry;
    } catch (_e) { /* non-blocking */ }

    // Expose boundary scheduler utilities for GM console access.
    try {
      const { flushBoundaryWorkQueue, getBoundaryWorkQueueSize } = await import("./core/time/boundary-work-scheduler.js");
      const { rebuildRoundStartCandidateRegistry } = await import("./core/conditions/round-start-candidate-registry.js");
      if (!game.uesrpg.combat) game.uesrpg.combat = {};
      game.uesrpg.combat.flushBoundaryQueue = flushBoundaryWorkQueue;
      game.uesrpg.combat.getBoundaryQueueSize = getBoundaryWorkQueueSize;
      game.uesrpg.combat.rebuildRoundStartCandidateRegistry = rebuildRoundStartCandidateRegistry;
    } catch (_e) { /* non-blocking */ }
  }

  // Initialize alchemy runtime (drink/apply/on-hit/round-tick hooks).
  // Alchemy is a core mechanic: runtime automation is always active.
  try {
    const { initializeAlchemyRuntime } = await import("./core/alchemy/runtime.js");
    initializeAlchemyRuntime();
  } catch (err) {
    console.warn("UESRPG | Failed to initialize alchemy runtime", err);
  }

  // Initialize strike enchantment on-hit runtime (uesrpgDamageApplied → side effects).
  try {
    const { initializeStrikeOnHitRuntime } = await import("./core/enchanting/runtime/strike-on-hit.js");
    initializeStrikeOnHitRuntime();
  } catch (err) {
    console.warn("UESRPG | Failed to initialize strike enchantment on-hit runtime", err);
  }
});

Hooks.once("init", async function() {
  console.log(`UESRPG | Initializing`);
  await initHandler();

  // Polyglot language exposure is handled canonically in src/hooks/init.js (initHandler).

  // Register Handlebars helpers
  Handlebars.registerHelper('capitalize', function(str) {
    const s = String(str || '');
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  });

  if (!Handlebars.helpers?.inc) {
    Handlebars.registerHelper('inc', function(n) { return Number(n ?? 0) + 1; });
  }
  game.uesrpg = game.uesrpg || {};

  // Expose AE key inspection helper (lazy-loaded; GM + debug flag required)
  if (game.user?.isGM && isDebugEnabled(null)) {
    game.uesrpg.dumpAEKeys = async (...args) => {
      const { dumpAEKeys } = await import("./utils/dev/ae-keys-dump.js");
      return dumpAEKeys(...args);
    };
  }

  // Initialize system-wide time API
  initializeTimeService();
  initializeCombatBoundaryOrchestrator();

  // Expose AoE service (universal template placement)
  const { AoEService } = await import("./core/aoe/index.js");
  game.uesrpg.aoe = AoEService;
  
  // Expose luck workflow helpers
  const { LuckAPI } = await import("./core/luck/luck-workflow.js");
  game.uesrpg.luck = LuckAPI;

  // Expose stamina helpers
  game.uesrpg.stamina = {
    openDialog: openStaminaDialog,
    getActiveEffect: getActiveStaminaEffect,
    consumeEffect: consumeStaminaEffect,
    applyPhysicalExertion: applyPhysicalExertionBonus,
    applyPhysicalExertionToSkill,
    applyPowerAttack: applyPowerAttackBonus,
    applySprint: applySprintBonus,
    applyPowerDraw: applyPowerDrawBonus,
    applyPowerBlock: applyPowerBlockBonus,
    hasEffect: hasStaminaEffect
  };
  
  // Expose attack tracker
  game.uesrpg.AttackTracker = AttackTracker;
  
  // Expose magic spell profile API (Phase 1: Stability & Parity)
  const { resolveSpellProfile, summarizeSpellProfile } = await import("./core/magic/spell-profile.js");
  const { SpellCastingService } = await import("./core/magic/casting-service.js");
  game.uesrpg.magic = game.uesrpg.magic || {};
  game.uesrpg.magic.resolveProfile = resolveSpellProfile;
  game.uesrpg.magic.summarizeProfile = summarizeSpellProfile;
  game.uesrpg.magic.cast = SpellCastingService.cast.bind(SpellCastingService);
  
  // Expose summon service API (GM-only token spawning)
  const { spawnSummon, getSummonedTokens, showSummonActorPicker } = await import("./core/magic/conjuration/summon-service.js");
  game.uesrpg.magic.spawnSummon = spawnSummon;
  game.uesrpg.magic.getSummonedTokens = getSummonedTokens;
  game.uesrpg.magic.showSummonActorPicker = showSummonActorPicker;
  
  // Expose dispel service API
  const { enumerateDispellableEffects, dispelEffects, showDispelDialog } = await import("./core/magic/services/dispel-service.js");
  game.uesrpg.magic.enumerateDispellable = enumerateDispellableEffects;
  game.uesrpg.magic.dispel = dispelEffects;
  game.uesrpg.magic.showDispelDialog = showDispelDialog;
  
  // Expose disintegrate helper API
  const { applyDamagedQuality } = await import("./core/magic/services/disintegrate-service.js");
  game.uesrpg.magic.applyDamagedQuality = applyDamagedQuality;
  
  // Expose drain helper API
  const { drainMagicka, drainHealth } = await import("./core/magic/services/drain-service.js");
  game.uesrpg.magic.drainMagicka = drainMagicka;
  game.uesrpg.magic.drainHealth = drainHealth;
  
  // Expose modifier registry API (dev/debugging — GM + debug flag required)
  if (game.user?.isGM && isDebugEnabled(null)) {
    const { getAllModifierKeys, validateAEChanges, isKnownModifierKey } = await import("./core/active-effects/modifier-registry.js");
    game.uesrpg.modifierRegistry = { getAllKeys: getAllModifierKeys, validate: validateAEChanges, isKnown: isKnownModifierKey };
  }
  
  // Expose OverTime helpers (authoring, inspection)
  const { createOverTimeConfig, hasOverTimeConfig, getOverTimeConfig, buildOverTimeChange, OVERTIME_CHANGE_KEY } = await import("./core/magic/ticks/overtime-engine.js");
  game.uesrpg.magic.overTime = { createConfig: createOverTimeConfig, hasConfig: hasOverTimeConfig, getConfig: getOverTimeConfig, buildChange: buildOverTimeChange, CHANGE_KEY: OVERTIME_CHANGE_KEY };
  
  // Register spell profile test utility (development/debugging — GM + debug flag required)
  if (game.user?.isGM && isDebugEnabled(null)) {
    const { registerSpellProfileTest } = await import("./utils/dev/spell-profile-test.js");
    registerSpellProfileTest();
  }

  // Expose audit, remediation, and acquisition-check utilities (GM-only)
  if (game.user?.isGM) {
    // Spell audit utility (GM debugging/quality assurance)
    const { auditSpellPack, showSpellAuditReport } = await import("./utils/dev/spell-audit.js");
    game.uesrpg.auditSpellPack = auditSpellPack;
    game.uesrpg.showSpellAuditReport = showSpellAuditReport;

    // Chapter 4 audit utility (catalog-based compliance gaps)
    const { auditChapter4 } = await import("./utils/dev/chapter4-audit.js");
    game.uesrpg.auditChapter4 = auditChapter4;

    // Chapter 6 audit utilities (summary + spell matrix)
    const { auditChapter6, auditChapter6Spells } = await import("./utils/dev/chapter6-audit.js");
    game.uesrpg.auditChapter6 = auditChapter6;
    game.uesrpg.auditChapter6Spells = auditChapter6Spells;

    // Chapter 6 spell remediation utilities (dry-run + apply)
    const { planChapter6SpellRemediation, applyChapter6SpellRemediation } = await import("./utils/dev/chapter6-spell-remediation.js");
    game.uesrpg.planChapter6SpellRemediation = planChapter6SpellRemediation;
    game.uesrpg.applyChapter6SpellRemediation = applyChapter6SpellRemediation;

    // Talent learning validator API (Chapter 4 acquisition checks)
    const { validateTalentLearning } = await import("./core/traits/talent-learning.js");
    game.uesrpg.talents = game.uesrpg.talents || {};
    game.uesrpg.talents.validateLearning = validateTalentLearning;
  }

  // Expose Enchanting Workshop API (game.uesrpg.enchanting.openWorkshop)
  const { registerEnchantingApi } = await import("./macros/enchanting-workshop.js");
  registerEnchantingApi();

  // Expose Character Generation API (game.uesrpg.chargen.openWizard)
  const { registerCharGenApi } = await import("./macros/character-generation.js");
  registerCharGenApi();

  // Expose Treat Wounds macro API (game.uesrpg.wounds.openTreatWoundsMacro)
  const { registerTreatWoundsMacroApi } = await import("./macros/treat-wounds.js");
  registerTreatWoundsMacroApi();

  // Expose XP macro API (game.uesrpg.xp.awardToSelectedPcs)
  const { registerAwardXpMacroApi } = await import("./macros/award-xp.js");
  registerAwardXpMacroApi();

  // Expose Alchemy Workshop API (game.uesrpg.alchemy.openWorkshop + drinkPotion + applyToWeapon + effects)
  // ⚠️ Import from core/alchemy/index.js — the authoritative registration point that exposes
  // the full runtime surface.  macros/alchemy-workshop.js only has the minimal openWorkshop shim.
  const { registerAlchemyApi } = await import("./core/alchemy/index.js");
  registerAlchemyApi();

  // Expose Travel Planner API (game.uesrpg.travel.openPlanner/createStarterEventTables/resetPlannerState)
  const { registerTravelApi } = await import("./core/travel/index.js");
  registerTravelApi();

  // Note: The prior GM-only "AE Keys" sheet header button was a debugging aid.
  // It has been removed; the helper is available as game.uesrpg.dumpAEKeys(...) when GM + debug mode is enabled.
});
