import { UESRPG, FLAG_SCOPE, SYSTEM_ID } from "../core/constants.js";
import { SimpleActor } from "../core/documents/actor.js";
import { SimpleItem } from "../core/documents/item.js";
import { registerPolyglotLanguages } from "../core/integrations/polyglot.js";

import { preloadHandlebarsTemplates } from "./init/register-templates.js";
import { registerSettings } from "./init/register-settings.js";
import { registerSheets } from "./init/register-sheets.js";
import { registerHandlebarsHelpers } from "./init/register-handlebars.js";
import { registerApi } from "./init/register-api.js";
import { registerChat, registerSpecialActionOutcomeHook } from "./init/register-chat.js";
import { registerChatCommands } from "./init/register-chat-commands.js";
import { registerMigrations } from "./init/register-migrations.js";
import { registerKeybindings } from "./init/register-keybindings.js";
import { registerDevTools } from "./init/register-devtools.js";
import { registerFeatureHooks } from "./init/features/register-feature-hooks.js";
import { registerOnce } from "./_internal/hook-registry.js";

import { SystemCombat, getInitiativeTieBreakTuple } from "../core/documents/combat.js";
import { registerCombatChatHandlers } from "../core/combat/chat-handlers/index.js";
import { registerDndDebugObservers } from "../utils/dnd-debugger.js";
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
import { registerAuthorityProxy } from "../utils/authority-proxy.js";
import { registerReachVisualizer } from "../ui/canvas/reach-visualizer.js";
import { registerRacialTalentsAutomation } from "../core/traits/racial-talents.js";
import { registerSpellcastingTalentHooks } from "../core/traits/spellcasting-talents.js";
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
import { migrateActorsIfNeeded, normalizeActors } from "../core/migrations/actors.js";
import { migrateCombatLegacyIfNeeded } from "../core/migrations/combat-legacy.js";
import { pruneInClosePair } from "../core/conditions/status-hud.js";
import { isReachLengthHomebrewEnabled } from "../core/homebrew/reach-length/weapon.js";
import { measureTokenDistance } from "../core/combat/opposed/range.js";
import { registerEngagementFlanking } from "../core/homebrew/engagement-flanking/index.js";
import { runCombatLegacyReadinessScan } from "../core/combat/legacy-readiness-scanner.js";

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

const _RETIRED_SOCIAL_ITEM_TYPES = new Set(["language", "faction"]);

function retireLegacySocialItemCreateTypesInMemory() {
  const pruneArrayInPlace = (arr) => {
    if (!Array.isArray(arr)) return;
    for (let i = arr.length - 1; i >= 0; i -= 1) {
      const key = String(arr[i] ?? "").trim().toLowerCase();
      if (_RETIRED_SOCIAL_ITEM_TYPES.has(key)) arr.splice(i, 1);
    }
  };

  const pruneObjectKeys = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      if (_RETIRED_SOCIAL_ITEM_TYPES.has(String(key).trim().toLowerCase())) {
        delete obj[key];
      }
    }
  };

    pruneArrayInPlace(game?.documentTypes?.Item);
  pruneArrayInPlace(CONFIG?.Item?.types);
  pruneArrayInPlace(CONFIG?.Item?.metadata?.types);
  pruneArrayInPlace(CONFIG?.Item?.documentClass?.metadata?.types);
  pruneObjectKeys(CONFIG?.Item?.typeLabels);
  pruneObjectKeys(CONFIG?.Item?.typeIcons);
  pruneObjectKeys(CONFIG?.Item?.dataModels);
}

function pruneRetiredSocialItemTypesFromCreateDialogs(root) {
  const targetRoot = root instanceof HTMLElement ? root : document;
  const selects = targetRoot.querySelectorAll?.("select[name='type']");
  if (!selects?.length) return;

  for (const select of selects) {
    let changed = false;
    for (const option of Array.from(select.options ?? [])) {
      const key = String(option?.value ?? "").trim().toLowerCase();
      if (_RETIRED_SOCIAL_ITEM_TYPES.has(key)) {
        option.remove();
        changed = true;
      }
    }
    if (!changed) continue;
    if (_RETIRED_SOCIAL_ITEM_TYPES.has(String(select.value ?? "").trim().toLowerCase())) {
      const fallback = select.options?.[0]?.value ?? "";
      select.value = fallback;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}

function registerRetiredSocialCreateTypeUiGuard() {
  const guard = (_app, html) => {
    const root = html?.[0] ?? html ?? document;
    pruneRetiredSocialItemTypesFromCreateDialogs(root);
  };

  Hooks.on("renderDocumentDirectory", guard);
  Hooks.on("renderDialog", guard);
  Hooks.on("renderDialogV2", guard);
  Hooks.once("ready", () => {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes ?? []) {
          if (!(node instanceof HTMLElement)) continue;
          pruneRetiredSocialItemTypesFromCreateDialogs(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

export default async function initHandler() {
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
    runCombatLegacyReadinessScan,
  });

  void registerDevTools();

  try {
    registerDndDebugObservers();
  } catch (err) {
    console.warn("UESRPG | Failed to register DnD diagnostics observers", err);
  }

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
  CONFIG.UESRPG = UESRPG;

  registerPolyglotLanguages();

  CONFIG.Actor.documentClass = SimpleActor;
  CONFIG.Item.documentClass = SimpleItem;
  retireLegacySocialItemCreateTypesInMemory();
  registerRetiredSocialCreateTypeUiGuard();
  Hooks.once("setup", retireLegacySocialItemCreateTypesInMemory);
  Hooks.once("ready", retireLegacySocialItemCreateTypesInMemory);

  registerHandlebarsHelpers();
  Hooks.once("setup", preloadHandlebarsTemplates);

  await registerSettings();
  applyCustomCursorConfig();

  await registerSheets();
  registerKeybindings();

  registerChat({
    registerCombatChatHandlers,
    registerActivationStateHooks,
    registerChatMessageSocket,
    registerAuthorityProxy,
    registerReachVisualizer,
  });
  registerChatCommands();

  registerOnce("hooks:in-close-auto-prune", () => {
    Hooks.on("updateToken", async (tokenDoc, changed, _options, _userId) => {
      try {
        if (!("x" in changed) && !("y" in changed)) return;
        if (!game.user?.isGM) return;
        if (!isReachLengthHomebrewEnabled()) return;

        const inCloseWith = tokenDoc.getFlag(FLAG_SCOPE, "reachLength.inCloseWith");
        if (!inCloseWith || !Object.keys(inCloseWith).length) return;

        const tokenPlaceable = canvas?.tokens?.get(tokenDoc.id);
        if (!tokenPlaceable) return;

        for (const [partnerUuid] of Object.entries(inCloseWith)) {
          const partnerDoc = fromUuidSync(partnerUuid);
          if (!partnerDoc) {
            const staleMap = foundry.utils.deepClone(tokenDoc.getFlag(FLAG_SCOPE, "reachLength.inCloseWith") ?? {});
            delete staleMap[partnerUuid];
            if (Object.keys(staleMap).length > 0) {
              await tokenDoc.setFlag(FLAG_SCOPE, "reachLength.inCloseWith", staleMap);
            } else {
              await tokenDoc.unsetFlag(FLAG_SCOPE, "reachLength.inCloseWith");
            }
            continue;
          }

          const partnerPlaceable = canvas?.tokens?.get(partnerDoc.id);
          const dist = partnerPlaceable
            ? measureTokenDistance(tokenPlaceable, partnerPlaceable)
            : Infinity;

          if (dist == null || dist > 1) {
            if (isDebugEnabled()) {
              console.log(`UESRPG | In Close auto-prune: ${tokenDoc.name} - ${partnerDoc.name} (dist=${dist})`);
            }
            await pruneInClosePair(tokenDoc, partnerDoc);
          }
        }
      } catch (err) {
        if (isDebugEnabled()) console.warn("UESRPG | In Close auto-prune hook error", err);
      }
    });
  });

  registerOnce("hooks:ae-cache-invalidation", () => {
    const clearActorAECache = (actor) => {
      if (!actor || actor.documentName !== "Actor") return;
      if (Object.prototype.hasOwnProperty.call(actor, "_aeApplicableCache")) actor._aeApplicableCache = null;
      if (Object.prototype.hasOwnProperty.call(actor, "_aeTotalsMap")) actor._aeTotalsMap = null;
    };

    const invalidateAECacheFromEffect = (effect) => {
      const parent = effect?.parent;
      if (!parent) return;
      if (parent.documentName === "Actor") {
        clearActorAECache(parent);
      } else if (parent.documentName === "Item") {
        const actorParent = parent.parent;
        if (actorParent?.documentName === "Actor") clearActorAECache(actorParent);
      }
    };

    Hooks.on("createActiveEffect", (effect) => invalidateAECacheFromEffect(effect));
    Hooks.on("updateActiveEffect", (effect) => invalidateAECacheFromEffect(effect));
    Hooks.on("deleteActiveEffect", (effect) => invalidateAECacheFromEffect(effect));
    Hooks.on("updateActor", (actor, changed) => {
      if (!actor || actor.documentName !== "Actor") return;
      const touchedEquippedWeapons = Boolean(changed?.system?.equippedWeapons)
        || foundry.utils.hasProperty(changed, "system.equippedWeapons");
      if (!touchedEquippedWeapons) return;
      clearActorAECache(actor);
    });
  });

  registerConditions();
  registerEngagementFlanking();
  registerWounds();
  registerSurpriseHooks();
  registerFearSystem();

  try {
    registerFrenzied();
    if (!game.uesrpg.conditions) game.uesrpg.conditions = {};
    game.uesrpg.conditions.frenzied = FrenziedAPI;
  } catch (err) {
    console.warn("UESRPG | Failed to register Frenzied automation", err);
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
