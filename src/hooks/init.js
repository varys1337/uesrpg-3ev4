import { UESRPG } from "../core/constants.js";
import { SimpleActor } from "../core/documents/actor.js";
import { SimpleItem } from "../core/documents/item.js";
import { LANGUAGE_CHOICES } from "../core/social/social-choices.js";

import { preloadHandlebarsTemplates } from "./init/register-templates.js";
import { registerSettings } from "./init/register-settings.js";
import { registerSheets } from "./init/register-sheets.js";
import { registerHandlebarsHelpers } from "./init/register-handlebars.js";
import { registerApi } from "./init/register-api.js";
import { registerChat, registerSpecialActionOutcomeHook } from "./init/register-chat.js";
import { registerMigrations } from "./init/register-migrations.js";
import { registerKeybindings } from "./init/register-keybindings.js";

import { SystemCombat, getInitiativeTieBreakTuple } from "../core/documents/combat.js";
import { registerCombatChatHandlers } from "../core/combat/chat-handlers.js";
import { registerSkillTNDebug } from "../utils/dev/skill-tn-debug.js";
import { registerActorSelectDebug } from "../utils/dev/actor-select-debug.js";
import { registerOpposedDiagnostics } from "../utils/dev/opposed-diagnostics.js";
import { registerConditions } from "../core/conditions/index.js";
import { registerWounds } from "../core/wounds/index.js";
import { registerFrenzied, FrenziedAPI } from "../core/conditions/frenzied.js";
import {
  registerSurpriseHooks,
  resolveSurpriseState,
  setActorSurprised,
  clearActorSurpriseState,
  markSurprisedFirstTurnPassed
} from "../core/combat/surprise-state.js";
import { registerFearSystem } from "../core/fear/index.js";
import { getSizeToHitModifier } from "../core/combat/tn.js";
import { getActionEligibility } from "../core/combat/opposed/actions/eligibility.js";
import { applyDamage, applyHealing, DAMAGE_TYPES } from "../core/combat/damage-automation.js";
import { applyDamageResolved } from "../core/combat/damage-resolver.js";
import { registerChatMessageSocket } from "../utils/chat-message-socket.js";
import { registerAuthorityProxy, requestUpdateDocument, requestDeleteEmbeddedDocuments } from "../utils/authority-proxy.js";
import { registerReachVisualizer } from "../ui/canvas/reach-visualizer.js";
import { registerRacialTalentsAutomation } from "../core/traits/racial-talents.js";
import { registerSpellcastingTalentHooks } from "../core/traits/spellcasting-talents.js";
import {
  TALENT_LEARNING_MODE,
  validateTalentLearning,
  notifyTalentLearningResult,
  applyTalentLearningXpCost,
} from "../core/traits/talent-learning.js";
import { registerActivationStateHooks } from "../core/combat/activation-state-flags.js";
import { CharOpposedWorkflow } from "../core/characteristics/opposed-workflow.js";
import { isDebugEnabled } from "../utils/debug.js";
import { evaluatePredicate, isPredicate, selfTestPredicate } from "../core/rules/predicate.js";
import { normalizeRollOption, buildBaseRollOptions } from "../core/rules/roll-options.js";
import { buildRollContext } from "../core/rules/roll-context.js";
import { compileConditionsToPredicate } from "../core/traits/features/conditions-to-predicate.js";
import { executeSpecialAction } from "../core/combat/special-actions-helper.js";
import { getRuleElementRuntimeSupport } from "../core/traits/features/rule-elements.js";
import { selfTestRuleElementRuntime } from "../core/traits/features/rule-element-runtime.js";
import { migrateItemsIfNeeded, normalizeItems } from "../core/migrations/items.js";

/**
 * Preload Handlebars partials used by system sheets.
 *
 * Foundry requires partial templates to be loaded before they can be referenced via {{> }}.
 */
/**
 * Apply UESRPG custom cursor configuration (passive/active) to Foundry's cursor map.
 *
 * This mirrors the WFRP4e approach:
 * - default / default-down use a passive cursor
 * - pointer / pointer-down use an active cursor
 *
 * Assets live at: systems/uesrpg-3ev4/images/elements/cursors
 */
function applyCustomCursorConfig() {
  try {
    const enabled = game.settings.get("uesrpg-3ev4", "customCursor");
    if (!enabled) return;

    const root = `systems/${game.system.id}`;
    const passive = `${root}/images/elements/cursors/inactivecursor-32.webp`;
    const active = `${root}/images/elements/cursors/activecursor-32.webp`;

    // Foundry cursor states used across the canvas and various interactive surfaces.
    CONFIG.cursors.default = passive;
    CONFIG.cursors["default-down"] = passive;
    CONFIG.cursors.pointer = active;
    CONFIG.cursors["pointer-down"] = active;
  } catch (err) {
    console.warn("UESRPG | Failed to apply custom cursor configuration", err);
  }
}

export default async function initHandler() {

  // Stable system API / rules exports
  registerApi({
    isPredicate,
    evaluatePredicate,
    selfTestPredicate,
    normalizeRollOption,
    buildBaseRollOptions,
    buildRollContext,
    compileConditionsToPredicate,
    getRuleElementRuntimeSupport,
    selfTestRuleElementRuntime,
    applyDamage,
    applyHealing,
    applyDamageResolved,
    DAMAGE_TYPES,
    resolveSurpriseState,
    setActorSurprised,
    clearActorSurpriseState,
    markSurprisedFirstTurnPassed,
    getInitiativeTieBreakTuple,
    getSizeToHitModifier,
    getActionEligibility,
    CharOpposedWorkflow,
  });

  // Opposed workflow diagnostics helpers (per-client trace ring buffer + console dump utilities)
  // Safe: no schema changes; GM-only dump functions.
  try {
    registerOpposedDiagnostics();
  } catch (err) {
    console.warn("UESRPG | Failed to register opposed diagnostics", err);
  }

  // Racial talent/power automation hooks (Chapter 4): registered once.
  try {
    registerRacialTalentsAutomation();
  } catch (err) {
    console.warn("UESRPG | Failed to register racial talent automation", err);
  }

  // Spellcasting talent hooks (Chapter 4 Spellcasting): registered once.
  try {
    registerSpellcastingTalentHooks();
  } catch (err) {
    console.warn("UESRPG | Failed to register spellcasting talent hooks", err);
  }

  // Talent learning enforcement hooks (Chapter 4 acquisition rules): registered once.
  if (!game.uesrpg._talentLearningHooks) {
    game.uesrpg._talentLearningHooks = true;

    Hooks.on("preCreateItem", (item, data, _options, userId) => {
      try {
        if (game.userId !== userId) return;

        const actor = item?.parent;
        if (!actor || actor.documentName !== "Actor") return;
        if (actor.type !== "Player Character") return;

        const itemType = String(data?.type ?? item?.type ?? "").toLowerCase();
        if (itemType !== "talent") return;

        const validation = validateTalentLearning(actor, data, { source: "preCreateItem" });
        if (validation.mode === TALENT_LEARNING_MODE.OFF) return;

        if (validation.mode === TALENT_LEARNING_MODE.WARN) {
          notifyTalentLearningResult(validation);
          return;
        }

        if (validation.mode === TALENT_LEARNING_MODE.ENFORCE && !validation.ok) {
          notifyTalentLearningResult(validation, { force: true });
          return false;
        }
      } catch (err) {
        console.error("UESRPG | Talent learning preCreateItem hook failed", err);
      }
    });

    Hooks.on("createItem", async (item, _options, userId) => {
      try {
        if (game.userId !== userId) return;

        if (!item || item.documentName !== "Item") return;
        if (String(item.type ?? "").toLowerCase() !== "talent") return;

        const actor = item.parent;
        if (!actor || actor.documentName !== "Actor") return;
        if (actor.type !== "Player Character") return;

        const validation = validateTalentLearning(actor, item, {
          source: "createItem",
          ignoreItemId: item.id,
        });

        if (validation.mode !== TALENT_LEARNING_MODE.ENFORCE) return;
        if (!validation.rulesOk) {
          notifyTalentLearningResult(validation, { force: true });
          await requestDeleteEmbeddedDocuments(actor, "Item", [item.id]);
          return;
        }

        const spend = await applyTalentLearningXpCost(actor, validation);
        if (!spend.ok) {
          ui.notifications?.warn?.(
            `Talent learning blocked (${item.name}). ${spend.reason ?? "Unable to deduct XP."}`
          );
          await requestDeleteEmbeddedDocuments(actor, "Item", [item.id]);
          return;
        }

        if (spend.spentXp > 0) {
          ui.notifications?.info?.(`Spent ${spend.spentXp} XP to learn ${item.name}.`);
        }
      } catch (err) {
        console.error("UESRPG | Talent learning createItem hook failed", err);
      }
    });
  }

  if (!game.uesrpg._defaultItemAETransferHook) {
    game.uesrpg._defaultItemAETransferHook = true;

    Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
      try {
        if (game.userId !== userId) return;

        const parent = effect?.parent ?? options?.parent ?? null;
        if (!parent || parent.documentName !== "Item") return;

        // Respect explicit setting
        if (data?.transfer !== undefined) return;

        // Ensure we can mutate the pending create data
        if (foundry?.utils?.mergeObject) {
          foundry.utils.mergeObject(data, { transfer: true }, { inplace: true });
        } else {
          data.transfer = true;
        }

        // Add constant enchantment metadata flags for Item Active Effects
        // Constant enchantments are Item Active Effects with transfer=true
        const FLAG_SCOPE = "uesrpg-3ev4";
        const existingFlags = data?.flags ?? {};
        const scopeFlags = existingFlags[FLAG_SCOPE] ?? {};
        
        // Ensure standardized metadata flags are present for constant enchantments
        // effectGroup uses item UUID to ensure uniqueness per item
        const itemUuid = parent?.uuid ?? parent?.id ?? "";
        const effectName = String(data?.name ?? "").trim().toLowerCase().replace(/\s+/g, "-") || "effect";
        const effectGroup = `enchantment.${itemUuid}.${effectName}`;
        
        const enhancedFlags = {
          ...existingFlags,
          [FLAG_SCOPE]: {
            ...scopeFlags,
            constant: true, // Mark as constant enchantment
            owner: scopeFlags.owner ?? "item",
            effectGroup: scopeFlags.effectGroup ?? effectGroup,
            stackRule: scopeFlags.stackRule ?? "override", // Constant enchantments typically override
            source: scopeFlags.source ?? "enchantment",
            // Preserve cursed flag if present
            cursed: scopeFlags.cursed ?? false
          }
        };
        
        if (foundry?.utils?.mergeObject) {
          foundry.utils.mergeObject(data, { flags: enhancedFlags }, { inplace: true });
        } else {
          data.flags = enhancedFlags;
        }
      } catch (err) {
        console.error("UESRPG | Default Item AE transfer preCreate failed", err);
      }
    });

    // Fallback: if some creation path bypasses preCreate mutation, enforce immediately after create.
    // For feature types (talent/trait/power), respect the explicit transfer value so users
    // can control the passive (transfer:true) vs activation (transfer:false) distinction.
    Hooks.on("createActiveEffect", async (effect, options, userId) => {
      try {
        if (game.userId !== userId) return;
        const parent = effect?.parent;
        if (!parent || parent.documentName !== "Item") return;

        if (effect.transfer) return;

        // Feature types use transfer:false semantically to mean "activation-only effect".
        // Do NOT override it — the user intentionally left it as transfer:false.
        const itemType = String(parent.type ?? "").toLowerCase();
        if (itemType === "talent" || itemType === "trait" || itemType === "power") return;

        // Only force if it looks like a default-created effect (no explicit choice).
        // Only the owning client should perform the update — other clients skip.
        const ownerActor = parent?.parent;
        if (!ownerActor) return;
        await requestUpdateDocument(effect, { transfer: true });
      } catch (err) {
        console.error("UESRPG | Default Item AE transfer create fallback failed", err);
      }
    });
  }

  if (!game.uesrpg._upkeepDeleteGuardHook) {
    game.uesrpg._upkeepDeleteGuardHook = true;
    Hooks.on("preDeleteActiveEffect", (effect, options) => {
      try {
        const flags = effect?.flags?.["uesrpg-3ev4"];
        if (!flags?.spellEffect || !flags?.hasUpkeep) return;
        if (!flags?.upkeepAwaiting) return;
        if (options?.uesrpgAllowUpkeepDelete) return;

        // Only block deletions explicitly marked as automated expiration
        // sweeps that could race with the upkeep prompt.  All other
        // deletions (manual UI, upkeep-cancel, etc.) are allowed through.
        if (!options?.uesrpgExpirationSweep) return;

        return false;
      } catch (err) {
        console.error("UESRPG | Upkeep delete guard failed", err);
      }
    });
  }

  // Buffer cleanup on effect deletion
  if (!game.uesrpg._bufferCleanupHook) {
    game.uesrpg._bufferCleanupHook = true;
    Hooks.on("deleteActiveEffect", async (effect, _options, userId) => {
      try {
        // Only run on the initiating client to avoid duplicate processing
        if (game.userId !== userId) return;

        const flags = effect?.flags?.["uesrpg-3ev4"];
        if (!flags?.bufferApplied || !flags?.bufferType) return;

        const targetActor = effect.parent;
        if (!targetActor || targetActor.documentName !== "Actor") return;

        const bufferType = flags.bufferType; // "physical", "magical", or "elemental"
        const bufferPath = `system.buffers.${bufferType}`;

        // Check if there are other active effects still providing this buffer type
        const otherBufferEffects = targetActor.effects?.filter(ef => 
          ef.id !== effect.id && 
          ef.flags?.["uesrpg-3ev4"]?.bufferApplied && 
          ef.flags?.["uesrpg-3ev4"]?.bufferType === bufferType
        ) ?? [];

        // If no other effects provide this buffer type, clear it
        if (otherBufferEffects.length === 0) {
          await requestUpdateDocument(targetActor, { [bufferPath]: 0 });

          const debugEnabled = game.settings.get("uesrpg-3ev4", "spellCastingDebug");
          if (debugEnabled) {
            console.log(`UESRPG | Buffer cleanup: Cleared ${bufferType} buffer on ${targetActor.name} (effect ${effect.name} deleted)`);
          }
        } else {
          // Recalculate buffer to the max of remaining effects
          const maxBuffer = Math.max(...otherBufferEffects.map(ef => 
            Number(ef.flags?.["uesrpg-3ev4"]?.bufferOriginalValue ?? 0)
          ));
          await requestUpdateDocument(targetActor, { [bufferPath]: maxBuffer });

          const debugEnabled = game.settings.get("uesrpg-3ev4", "spellCastingDebug");
          if (debugEnabled) {
            console.log(`UESRPG | Buffer cleanup: Recalculated ${bufferType} buffer to ${maxBuffer} on ${targetActor.name}`);
          }
        }
      } catch (err) {
        console.error("UESRPG | Buffer cleanup failed", err);
      }
    });
  }


  // NOTE: Spell Item Active Effects use the same deterministic transfer semantics as other item types.
  // See src/core/active-effects/transfer.js for activation gating (spells require an explicit "Active" toggle).


  /**
   * Set an initiative formula for the system
   * @type {String}
   */
  CONFIG.Combat.initiative = {
    // Use the derived initiative value so Active Effects can influence initiative reliably.
    formula: "1d6 + @initiative.value",
    decimals: 0,
  };

  // Set up custom combat functionality for the system.
  CONFIG.Combat.documentClass = SystemCombat;

  // Record Configuration Values
  CONFIG.UESRPG = UESRPG;

// Polyglot integration: expose system languages using the generic CONFIG[systemIdUpper].languages convention.
// Safe: this only *defines* the catalog and does not mutate any Actor data.
try {
  const systemId = game.system?.id ?? "";
  const systemIdUpper = systemId.toUpperCase();
  CONFIG[systemIdUpper] = CONFIG[systemIdUpper] ?? {};
  if (!CONFIG[systemIdUpper].languages) {
    const slugify = (s) => String(s ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const languages = {};
    for (const label of LANGUAGE_CHOICES ?? []) {
      const key = slugify(label);
      if (key) languages[key] = label;
    }
    CONFIG[systemIdUpper].languages = languages;
  }
} catch (err) {
  console.warn("UESRPG | Polyglot language exposure failed", err);
}

  // Define custom Entity classes
  CONFIG.Actor.documentClass = SimpleActor;
  CONFIG.Item.documentClass = SimpleItem;
  
  // Register Handlebars helpers
  registerHandlebarsHelpers();

  // Preload sheet partials after the Handlebars application namespace is fully initialized.
  // Running this too early causes Foundry to fall back to deprecated global loaders.
  Hooks.once("setup", preloadHandlebarsTemplates);

  await registerSettings();

  // Apply custom cursor mapping after settings are registered.
  // This requires a reload to take effect and is gated by the world setting.
  applyCustomCursorConfig();

  await registerSheets();
  registerKeybindings();

  // Initialize chat handlers, sockets/proxy, and canvas interaction registries.
  registerChat({
    registerCombatChatHandlers,
    registerActivationStateHooks,
    registerChatMessageSocket,
    registerAuthorityProxy,
    registerReachVisualizer,
  });

  // DERIVED_DATA_CACHE_INVALIDATION_V1
  // Ensure edits to embedded Item bonuses (Talents / Traits / Powers, but also any other embedded
  // item that contributes to derived data) immediately reflect on the Actor.
  //
  // Root cause: SimpleActor#_aggregateItemStats caches aggregated embedded-item stats on the Actor
  // instance (this._aggCache) and reuses them across prepare cycles when its lightweight signature
  // does not change. Some non-encumbrance bonus fields (e.g., system.hpBonus) were not represented
  // in that signature, causing stale derived data until a full server refresh recreated documents.
  //
  // Fix: invalidate the cache whenever an embedded Item is created, updated, or deleted.
  if (!game.uesrpg._aggCacheInvalidationHooks) {
    game.uesrpg._aggCacheInvalidationHooks = true;

    /**
     * Clear per-actor aggregation caches so derived data recomputes on the next prepare.
     * @param {Item} item
     */
    const invalidateActorAggCacheFromItem = (item) => {
      const actor = item?.parent;
      if (!actor || actor.documentName !== "Actor") return;
      if (Object.prototype.hasOwnProperty.call(actor, "_aggCache")) actor._aggCache = null;
    };

    Hooks.on("preUpdateItem", (item, _changes, _options, _userId) => invalidateActorAggCacheFromItem(item));
    Hooks.on("updateItem", (item, _changes, _options, _userId) => invalidateActorAggCacheFromItem(item));
    Hooks.on("createItem", (item, _options, _userId) => invalidateActorAggCacheFromItem(item));
    Hooks.on("deleteItem", (item, _options, _userId) => invalidateActorAggCacheFromItem(item));
  }

  // Chapter 5: conditions + wounds automation (AE-backed, deterministic)
  registerConditions();
  registerWounds();
  registerSurpriseHooks();
  registerFearSystem();

  // Frenzied condition automation (Chapter 5)
  try {
    registerFrenzied();
    if (!game.uesrpg.conditions) game.uesrpg.conditions = {};
    game.uesrpg.conditions.frenzied = FrenziedAPI;
  } catch (err) {
    console.warn("UESRPG | Failed to register Frenzied automation", err);
  }

  registerMigrations({
    migrateItemsIfNeeded,
    normalizeItems,
    isDebugEnabled,
    registerSkillTNDebug,
    registerActorSelectDebug,
  });

  registerSpecialActionOutcomeHook({ executeSpecialAction });
}
