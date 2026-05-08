import { UESRPG, SYSTEM_ID } from "../core/constants.js";
import { SimpleActor } from "../core/documents/actor.js";
import { SimpleItem } from "../core/documents/item.js";
import { registerPolyglotLanguages } from "../core/integrations/polyglot.js";

import { preloadHandlebarsTemplates } from "./init/register-templates.js";
import { preloadHandlebarsTemplatesOptimized } from "./init/register-templates-optimized.js";
import { registerSettings } from "./init/register-settings.js";
import { registerSheets } from "./init/register-sheets.js";
import { registerHandlebarsHelpers } from "./init/register-handlebars.js";
import { registerApi } from "./init/register-api.js";
import { createTokenActionHudApi } from "../integrations/token-action-hud/api.js";
import { registerChat, registerSpecialActionOutcomeHook } from "./init/register-chat.js";
import { registerChatCommands } from "./init/register-chat-commands.js";
import { registerMigrations } from "./init/register-migrations.js";
import { registerKeybindings } from "./init/register-keybindings.js";
import { registerDevTools } from "./init/register-devtools.js";
import { registerFeatureHooks } from "./init/features/register-feature-hooks.js";
import { registerCreateTypeGuards } from "./init/register-create-type-guards.js";
import { registerAECacheInvalidation } from "./init/register-ae-cache-invalidation.js";
import { registerItemPrepareCacheInvalidation } from "./init/register-item-prepare-cache-invalidation.js";
import { registerMemoizationCacheInvalidation } from "./init/register-memoization-cache-invalidation.js";
import { registerInCloseAutoPrune } from "./init/register-in-close-auto-prune.js";
import { registerCoreSubsystems } from "./init/register-core-subsystems.js";
import { initializeCanvasOptimization } from "../utils/canvas/canvas-optimization.js";
import { initializeMemoryMonitoring } from "../utils/memory-monitor.js";

// Combat optimization systems
import { initializeCombatUpdateScheduler } from "../core/combat/optimization/combat-update-scheduler.js";
import { registerInitiativeCacheInvalidation } from "../core/combat/optimization/initiative-cache.js";
import { initializeCombatTrackerDOMOptimization } from "../ui/apps/combat-tracker-dom-optimizer.js";
import { initializeCombatHookThrottling } from "../utils/combat-throttler.js";

import { SystemCombat, getInitiativeTieBreakTuple } from "../core/documents/combat.js";
import { registerCombatChatHandlers } from "../core/combat/chat-handlers/index.js";
import { registerDndDebugObservers } from "../utils/dnd-debugger.js";
import {
  resolveSurpriseState,
  setActorSurprised,
  clearActorSurpriseState,
  markSurprisedFirstTurnPassed
} from "../core/combat/surprise-state.js";
import { getSizeToHitModifier } from "../core/combat/tn.js";
import { getActionEligibility } from "../core/combat/opposed/actions/eligibility.js";
import { applyDamage, applyHealing, DAMAGE_TYPES } from "../core/combat/damage-automation.js";
import { applyDamageResolved } from "../core/combat/damage-resolver.js";
import { registerChatMessageSocket } from "../utils/chat-message-socket.js";
import { registerAuthorityProxy } from "../utils/authority-proxy.js";
import { registerReachVisualizer } from "../ui/canvas/reach-visualizer.js";
import { registerArmorCoverageOverlay } from "../ui/canvas/armor-coverage-controller.js";
import { registerRacialTalentsAutomation } from "../core/traits/racial-talents.js";
import { registerSpellcastingTalentHooks } from "../core/traits/spellcasting-talents.js";
import { registerActivationStateHooks } from "../core/combat/activation-state-flags.js";
import { CharOpposedWorkflow } from "../core/characteristics/opposed-workflow.js";
import { isAnyDebugEnabled } from "../utils/debug.js";
import { evaluatePredicate, isPredicate, selfTestPredicate } from "../core/rules/predicate.js";
import { normalizeRollOption, buildBaseRollOptions } from "../core/rules/roll-options.js";
import { buildRollContext } from "../core/rules/roll-context.js";
import { compileConditionsToPredicate } from "../core/traits/features/conditions-to-predicate.js";
import { executeSpecialAction } from "../core/combat/special-actions-helper.js";
import { migrateItemsIfNeeded, normalizeItems } from "../core/migrations/items.js";
import { migrateActorsIfNeeded, normalizeActors } from "../core/migrations/actors.js";
import { migrateCombatLegacyIfNeeded } from "../core/migrations/combat-legacy.js";
import { runCombatLegacyReadinessScan } from "../core/combat/legacy-readiness-scanner.js";
import * as automationPolicyApi from "../core/config/automation-policy.js";
import { registerShieldDebugObservers } from "../utils/dev/shield-debug.js";
import { registerContainerDebugObservers } from "../utils/dev/container-debug.js";
import { registerStaleEmbeddedDeleteSuppression } from "../utils/embedded-delete-guard.js";
import { registerClashChatActions } from "../core/mass-warfare/clash/chat-actions.js";
import { registerWarfareAttachmentHooks } from "../core/mass-warfare/actions.js";
import {
  getTypeDataModelDiagnosticsReport,
  isTypeDataModelsEnabled,
  registerTypeDataModels,
} from "../core/data-models/registry.js";
import { ApplyDamageService } from "../application/combat/apply-damage-service.js";

function applyCustomCursorConfig() {
  try {
    const enabled = game.settings.get(SYSTEM_ID, "customCursor");
    if (!enabled) return;

    const root = `systems/${game.system.id}`;
    const passive = `${root}/images/elements/cursors/inactivecursor-32.webp`;
    const active = `${root}/images/elements/cursors/activecursor-32.webp`;

    CONFIG.cursors.default = passive;
    CONFIG.cursors["default-down"] = passive;
    CONFIG.cursors.pointer = active;
    CONFIG.cursors["pointer-down"] = active;
  } catch (err) {
    console.warn("UESRPG | Failed to apply custom cursor configuration", err);
  }
}

// ── Warfare Unit create-flow gating ─────────────────────────────────────────
// When homebrew.massCombat.enabled === false, prune "Warfare Unit" from actor
// create dialogs so GMs cannot accidentally create units they haven't opted in to.
// Existing Warfare Unit actors remain openable (sheet is always registered).

export default async function initHandler() {
  registerApi({
    isTypeDataModelsEnabled,
    getTypeDataModelDiagnosticsReport,
    isPredicate,
    evaluatePredicate,
    selfTestPredicate,
    normalizeRollOption,
    buildBaseRollOptions,
    buildRollContext,
    compileConditionsToPredicate,
    applyDamage: ApplyDamageService.applySimple.bind(ApplyDamageService),
    applyHealing: ApplyDamageService.applyHealing.bind(ApplyDamageService),
    applyDamageResolved: ApplyDamageService.applyResolved.bind(ApplyDamageService),
    DAMAGE_TYPES,
    resolveSurpriseState,
    setActorSurprised,
    clearActorSurpriseState,
    markSurprisedFirstTurnPassed,
    getInitiativeTieBreakTuple,
    getSizeToHitModifier,
    getActionEligibility,
    CharOpposedWorkflow,
    runCombatLegacyReadinessScan,
    automationPolicyApi,
    tokenActionHudApi: createTokenActionHudApi(),
    applicationApi: {
      damage: {
        apply: ApplyDamageService.applyResolved.bind(ApplyDamageService),
        applySimple: ApplyDamageService.applySimple.bind(ApplyDamageService),
        applyHealing: ApplyDamageService.applyHealing.bind(ApplyDamageService),
      },
    },
  });

  try {
    registerRacialTalentsAutomation();
  } catch (err) {
    console.warn("UESRPG | Failed to register racial talent automation", err);
  }

  try {
    registerSpellcastingTalentHooks();
  } catch (err) {
    console.warn("UESRPG | Failed to register spellcasting talent hooks", err);
  }

  registerFeatureHooks();

  CONFIG.Combat.initiative = {
    formula: "1d6 + @initiative.value",
    decimals: 0,
  };

  CONFIG.Combat.documentClass = SystemCombat;
  SystemCombat.registerAPHooks();
  CONFIG.UESRPG = UESRPG;

  registerPolyglotLanguages();

  CONFIG.Actor.documentClass = SimpleActor;
  CONFIG.Item.documentClass = SimpleItem;

  registerHandlebarsHelpers();
  
  await registerSettings();
  
  // Use optimized template loading if enabled, otherwise fallback to original
  const useOptimizedTemplates = isAnyDebugEnabled(["perfDebug", "templateDebug"]) ||
    game.settings.get(SYSTEM_ID, "templateOptimization") !== false;
  
  if (useOptimizedTemplates) {
    Hooks.once("setup", preloadHandlebarsTemplatesOptimized);
    console.debug("UESRPG | Using optimized template loading");
  } else {
    Hooks.once("setup", preloadHandlebarsTemplates);
    console.debug("UESRPG | Using standard template loading");
  }
  registerTypeDataModels();
  registerCreateTypeGuards();
  registerStaleEmbeddedDeleteSuppression();
  applyCustomCursorConfig();

  if (isAnyDebugEnabled(["opposedDebug", "perfDebug"])) {
    void registerDevTools();
  }

  if (isAnyDebugEnabled(["dndDebugEnabled"])) {
    try {
      registerDndDebugObservers();
    } catch (err) {
      console.warn("UESRPG | Failed to register DnD diagnostics observers", err);
    }
  }

  if (isAnyDebugEnabled(["shieldDebug"])) {
    try {
      registerShieldDebugObservers();
    } catch (err) {
      console.warn("UESRPG | Failed to register shield debug observers", err);
    }
  }

  try {
    registerContainerDebugObservers();
  } catch (err) {
    console.warn("UESRPG | Failed to register container diagnostics observers", err);
  }

  await registerSheets();
  registerKeybindings();

  registerChat({
    registerCombatChatHandlers,
    registerActivationStateHooks,
    registerChatMessageSocket,
    registerAuthorityProxy,
    registerReachVisualizer,
    registerArmorCoverageOverlay,
    registerClashChatActions,
  });
  registerChatCommands();
  registerWarfareAttachmentHooks();

  registerInCloseAutoPrune();
  registerAECacheInvalidation();
  registerItemPrepareCacheInvalidation();
  registerMemoizationCacheInvalidation();
  registerCoreSubsystems();

  // Initialize canvas optimization system for token performance
  try {
    initializeCanvasOptimization({
      enabled: true,
      debug: isAnyDebugEnabled(["perfDebug", "canvasDebug"])
    });
    console.debug("UESRPG | Canvas optimization system initialized");
  } catch (err) {
    console.warn("UESRPG | Failed to initialize canvas optimization system", err);
  }

  // Initialize memory monitoring system for leak detection
  try {
    initializeMemoryMonitoring({
      enabled: true,
      debug: isAnyDebugEnabled(["perfDebug", "memoryDebug"]),
      warningThresholds: {
        templateCache: 500,
        memoizationCache: 1000,
        tokenQueryCache: 500,
        spatialIndexCache: 2000,
        handlebarsHelperCache: 200,
        sheetCache: 300,
      }
    });
    console.debug("UESRPG | Memory monitoring system initialized");
  } catch (err) {
    console.warn("UESRPG | Failed to initialize memory monitoring system", err);
  }

  // Initialize combat optimization systems
  // DISABLED: Combat optimizations causing issues with token actor initiative addition
  // Re-enable by setting COMBAT_OPTIMIZATIONS_ENABLED = true
  const COMBAT_OPTIMIZATIONS_ENABLED = false;
  
  if (COMBAT_OPTIMIZATIONS_ENABLED) {
    try {
      // Combat update scheduler for deferred non-critical updates
      initializeCombatUpdateScheduler();
      console.debug("UESRPG | Combat update scheduler initialized");
      
      // Initiative calculation cache
      registerInitiativeCacheInvalidation();
      console.debug("UESRPG | Initiative cache invalidation hooks registered");
      
      // Combat tracker DOM optimization
      initializeCombatTrackerDOMOptimization();
      console.debug("UESRPG | Combat tracker DOM optimization initialized");
      
      // Combat hook throttling
      initializeCombatHookThrottling();
      console.debug("UESRPG | Combat hook throttling initialized");
      
      console.info("UESRPG | Combat performance optimizations fully initialized");
    } catch (err) {
      console.warn("UESRPG | Failed to initialize combat optimization systems", err);
    }
  } else {
    console.info("UESRPG | Combat performance optimizations DISABLED (token actor initiative issue)");
  }

  if (isTypeDataModelsEnabled()) {
    console.info("UESRPG | TypeDataModel diagnostics", getTypeDataModelDiagnosticsReport());
  }

  registerMigrations({
    migrateActorsIfNeeded,
    normalizeActors,
    migrateItemsIfNeeded,
    normalizeItems,
    migrateCombatLegacyIfNeeded,
  });

  registerSpecialActionOutcomeHook({ executeSpecialAction });
}
