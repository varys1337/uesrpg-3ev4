import { onCombatQuickAction } from "../../ui/sheets/shared/listeners/combat-actions.js";
import { onCastMagicAction } from "../../ui/sheets/shared/listeners/magic-cast.js";
import { onSkillRoll, onCombatRoll } from "../../ui/sheets/shared/listeners/rolls.js";
import { onClickCharacteristic } from "../../ui/sheets/shared/listeners/characteristics-handlers.js";
import {
  activateTalentFromItemSheet,
  activatePowerFromItemSheet,
  activateTraitFromItemSheet
} from "../../ui/sheets/shared-handlers.js";
import { executeItemActivation, executeItemMacroBestEffort } from "../../core/system/activation/index.js";
import { castScrollFromItem } from "../../core/magic/scroll-casting.js";
import { HPTempHPDialog } from "../../ui/apps/hp-temp-hp-dialog.js";
import { openStaminaDialog } from "../../core/stamina/stamina-dialog.js";
import { MagickaBarrierDialog } from "../../ui/apps/magicka-barrier-dialog.js";
import { LuckAPI } from "../../core/luck/luck-workflow.js";
import { applyShortRest, applyLongRest, buildRestChatContent } from "../../ui/sheets/rest-workflow.js";
import { LanguageSelectorAppV2, FactionSelectorAppV2 } from "../../ui/apps/v2/social-selectors.js";
import { buildSpecialActionsForActor } from "../../core/combat/combat-style-utils.js";
import { getSpecialActionById } from "../../config/index.js";
import {
  invokeSheetOrHandler,
  makeSyntheticCharacteristicTarget,
  makeSyntheticEvent,
  makeSyntheticItemTarget,
  makeSyntheticProfessionTarget,
  makeSyntheticTarget,
  result,
  routeFeatureActivation,
  routeResourceDialog,
} from "./helpers.js";

/**
 * Create the stable Token Action HUD integration API.
 * All methods are thin wrappers over current system behavior and return a result object.
 *
 * @returns {object}
 */
export function createTokenActionHudApi() {
  return {
    /**
     * Execute a combat quick action using the canonical sheet/listener workflow.
     * @param {{actor: Actor, token?: Token|null, payload?: object, shiftKey?: boolean}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeCombatQuickAction({ actor, token = null, payload = {}, shiftKey = false } = {}) {
      if (!actor) return result(false, "none", { reason: "no-actor" });

      const dataset = {
        ...(payload ?? {}),
        combatAction: payload?.combatAction ?? payload?.action ?? "",
        action: payload?.action ?? payload?.combatAction ?? "",
      };
      return invokeSheetOrHandler({
        actor,
        token,
        target: makeSyntheticTarget(dataset),
        shiftKey,
        sheetMethod: "_onCombatQuickAction",
        handler: onCombatQuickAction,
        successPathSheet: "sheet._onCombatQuickAction",
        successPathHandler: "shared.listeners.onCombatQuickAction",
      });
    },

    /**
     * Open the cast-magic flow for an actor.
     * @param {{actor: Actor, token?: Token|null, preselectedSpell?: Item|null, shiftKey?: boolean, castActionType?: string}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeCastMagic({ actor, token = null, preselectedSpell = null, shiftKey = false, castActionType = "primary" } = {}) {
      if (!actor) return result(false, "none", { reason: "no-actor" });

      return invokeSheetOrHandler({
        actor,
        token,
        target: makeSyntheticTarget({ actionType: castActionType === "secondary" ? "secondary" : "primary" }),
        shiftKey,
        sheetMethod: "_onCastMagicAction",
        handler: onCastMagicAction,
        handlerArgs: [preselectedSpell],
        successPathSheet: "sheet._onCastMagicAction",
        successPathHandler: "shared.listeners.onCastMagicAction",
      });
    },

    /**
     * Execute a skill roll for an embedded skill item.
     * @param {{actor: Actor, itemId: string, shiftKey?: boolean}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeSkillRoll({ actor, itemId, shiftKey = false } = {}) {
      if (!actor || !itemId) return result(false, "none", { reason: "bad-args" });
      return invokeSheetOrHandler({
        actor,
        target: makeSyntheticItemTarget(itemId),
        shiftKey,
        sheetMethod: "_onSkillRoll",
        handler: onSkillRoll,
        successPathSheet: "sheet._onSkillRoll",
        successPathHandler: "shared.listeners.onSkillRoll",
      });
    },

    /**
     * Execute a combat-style roll for an embedded combat style item.
     * @param {{actor: Actor, itemId: string, shiftKey?: boolean}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeCombatRoll({ actor, itemId, shiftKey = false } = {}) {
      if (!actor || !itemId) return result(false, "none", { reason: "bad-args" });
      return invokeSheetOrHandler({
        actor,
        target: makeSyntheticItemTarget(itemId),
        shiftKey,
        sheetMethod: "_onCombatRoll",
        handler: onCombatRoll,
        successPathSheet: "sheet._onCombatRoll",
        successPathHandler: "shared.listeners.onCombatRoll",
      });
    },

    /**
     * Execute a characteristic roll from characteristic key/label data.
     * @param {{actor: Actor, key: string, label: string, shiftKey?: boolean}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeCharacteristicRoll({ actor, key, label, shiftKey = false } = {}) {
      if (!actor || !key || !label) return result(false, "none", { reason: "bad-args" });
      return invokeSheetOrHandler({
        actor,
        target: makeSyntheticCharacteristicTarget(key, label),
        shiftKey,
        sheetMethod: "_onClickCharacteristic",
        handler: onClickCharacteristic,
        successPathSheet: "sheet._onClickCharacteristic",
        successPathHandler: "shared.listeners.onClickCharacteristic",
      });
    },

    /**
     * Execute an NPC profession roll through the owning AppV2 sheet workflow.
     * @param {{actor: Actor, professionKey: string, shiftKey?: boolean}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeProfessionRoll({ actor, professionKey, shiftKey = false } = {}) {
      if (!actor || !professionKey) return result(false, "none", { reason: "bad-args" });
      const sheet = actor?.sheet ?? null;
      if (!sheet || typeof sheet._onProfessionsRoll !== "function") {
        return result(false, "none", { reason: "no-profession-handler" });
      }

      const target = makeSyntheticProfessionTarget(professionKey);
      const event = makeSyntheticEvent(target, { shiftKey });
      try {
        Object.defineProperty(event, "target", { writable: false, value: target });
      } catch (_err) {
        // currentTarget is sufficient for the normal synthetic path; target is a compatibility hint.
      }
      await sheet._onProfessionsRoll(event, target);
      return result(true, "sheet._onProfessionsRoll");
    },

    /**
     * Activate a feature item through the canonical item-sheet/system activation flow.
     * @param {{item: Item, actor?: Actor|null, event?: Event|null}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeFeatureActivation({ item, actor, event = null } = {}) {
      return routeFeatureActivation({
        item,
        actor,
        event,
        executeItemActivation,
        activateTalentFromItemSheet,
        activatePowerFromItemSheet,
        activateTraitFromItemSheet,
      });
    },

    /**
     * Execute a scroll cast from a scroll item.
     * @param {{actor: Actor, scrollItem: Item, castActionType?: string}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string,result?:any}>}
     */
    async executeScrollCast({ actor, scrollItem, castActionType = "primary" } = {}) {
      if (!actor || !scrollItem) return result(false, "none", { reason: "bad-args" });
      const castResult = await castScrollFromItem({
        scrollItem,
        casterActor: actor,
        castActionType,
      });
      return result(true, "scroll-casting.castScrollFromItem", { result: castResult });
    },

    /**
     * Open one of the HUD-supported resource dialogs for an actor.
     * @param {{actor: Actor, resourceId: string}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async openResourceDialog({ actor, resourceId } = {}) {
      return routeResourceDialog({
        actor,
        resourceId,
        HPTempHPDialog,
        openStaminaDialog,
        MagickaBarrierDialog,
        LuckAPI,
      });
    },

    /**
     * Apply a short or long rest workflow for an actor.
     * @param {{actor: Actor, restType: string}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async applyRest({ actor, restType } = {}) {
      if (!actor || !restType) return result(false, "none", { reason: "bad-args" });
      const fn = restType === "shortRest" ? applyShortRest : applyLongRest;
      if (typeof fn !== "function") return result(false, "none", { reason: "no-rest-function" });

      const { line } = await fn(actor);
      if (line && typeof buildRestChatContent === "function") {
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor }),
          content: buildRestChatContent(restType === "shortRest" ? "Short Rest" : "Long Rest", [line]),
        });
      }

      return result(true, `rest-workflow.${restType}`);
    },

    /**
     * Open the actor's language or faction selector workflow.
     * @param {{actor: Actor, kind: string, entryId?: string|null}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string,entryId?:string|null,focusedOpenSupported?:boolean}>}
     */
    async openSocialSelector({ actor, kind, entryId = null } = {}) {
      if (!actor || !kind) return result(false, "none", { reason: "bad-args" });
      if (kind === "language") {
        await LanguageSelectorAppV2.prompt(actor);
        return result(true, "LanguageSelectorAppV2.prompt", { entryId, focusedOpenSupported: false });
      }
      if (kind === "faction") {
        await FactionSelectorAppV2.prompt(actor);
        return result(true, "FactionSelectorAppV2.prompt", { entryId, focusedOpenSupported: false });
      }
      return result(false, "none", { reason: "no-social-selector" });
    },

    /**
     * Resolve one special action definition by id.
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async getSpecialActionDefinition(id) {
      return getSpecialActionById(id);
    },

    /**
     * Build special action descriptors for a specific actor.
     * @param {Actor} actor
     * @returns {Promise<object[]>}
     */
    async buildSpecialActionsForActor(actor) {
      if (!actor) return [];
      return buildSpecialActionsForActor(actor) ?? [];
    },

    /**
     * Update an item's equipped state.
     * @param {{item: Item, equipped: boolean}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async setItemEquipped({ item, equipped } = {}) {
      if (!item) return result(false, "none", { reason: "no-item" });
      await item.update({ "system.equipped": Boolean(equipped) });
      return result(true, "item.update.system.equipped");
    },

    /**
     * Open the sheet for a Foundry document when available.
     * @param {{document: object}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async openDocumentSheet({ document } = {}) {
      if (!document?.sheet || typeof document.sheet.render !== "function") {
        return result(false, "none", { reason: "no-sheet" });
      }
      document.sheet.render(true);
      return result(true, "document.sheet.render");
    },

    /**
     * Run post-chat feature automation without creating an extra chat card.
     * Used by the HUD's passive feature chat path.
     * @param {{item: Item, actor?: Actor|null, event?: Event|null}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async runFeaturePostChatAutomation({ item, actor = null, event = null } = {}) {
      if (!item) return result(false, "none", { reason: "no-item" });
      await executeItemActivation({
        item,
        actor: actor ?? item.actor ?? null,
        event,
        renderChat: false,
        includeImage: false,
        context: {},
      });
      return result(true, "activation.executeItemActivation.renderChatFalse");
    },

    /**
     * Execute an item's macro entrypoint when available.
     * @param {{item: Item, actor?: Actor|null, event?: Event|null}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeItemMacro({ item, actor = null, event = null } = {}) {
      if (!item) return result(false, "none", { reason: "no-item" });
      await executeItemMacroBestEffort({ item, actor: actor ?? item.actor ?? null, event });
      return result(true, "activation.executeItemMacroBestEffort");
    },
  };
}
