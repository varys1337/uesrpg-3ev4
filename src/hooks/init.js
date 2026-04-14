import { UESRPG, SYSTEM_ID } from "../core/constants.js";
import { SimpleActor } from "../core/documents/actor.js";
import { SimpleItem } from "../core/documents/item.js";
import { registerPolyglotLanguages } from "../core/integrations/polyglot.js";

import { preloadHandlebarsTemplates } from "./init/register-templates.js";
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
import { registerInCloseAutoPrune } from "./init/register-in-close-auto-prune.js";
import { registerCoreSubsystems } from "./init/register-core-subsystems.js";

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
import { registerShieldDebugObservers } from "../utils/dev/shield-debug.js";
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
  Hooks.once("setup", preloadHandlebarsTemplates);

  await registerSettings();
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

  await registerSheets();
  registerKeybindings();

  registerChat({
    registerCombatChatHandlers,
    registerActivationStateHooks,
    registerChatMessageSocket,
    registerAuthorityProxy,
    registerReachVisualizer,
    registerClashChatActions,
  });
  registerChatCommands();
  registerWarfareAttachmentHooks();

  registerInCloseAutoPrune();
  registerAECacheInvalidation();
  registerCoreSubsystems();

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
