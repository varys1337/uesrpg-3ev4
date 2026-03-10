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

function _result (ok, path, extra = {}) {
  return { ok, path, ...extra };
}

function _resolveToken (actor, explicitToken = null) {
  if (explicitToken) return explicitToken;
  const controlled = canvas?.tokens?.controlled?.find?.((t) => t?.actor?.id === actor?.id) ?? null;
  if (controlled) return controlled;
  return actor?.getActiveTokens?.()?.[0] ?? null;
}

function _makeSyntheticTarget (dataset = {}) {
  return { dataset: { ...(dataset ?? {}) } };
}

function _makeSyntheticEvent (target, { shiftKey = false } = {}) {
  const ev = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window,
    shiftKey: !!shiftKey
  });
  Object.defineProperty(ev, "currentTarget", { writable: false, value: target });
  return ev;
}

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
      if (!actor) return _result(false, "none", { reason: "no-actor" });

      const resolvedToken = _resolveToken(actor, token);
      const dataset = {
        ...(payload ?? {}),
        combatAction: payload?.combatAction ?? payload?.action ?? "",
        action: payload?.action ?? payload?.combatAction ?? ""
      };
      const target = _makeSyntheticTarget(dataset);
      const event = _makeSyntheticEvent(target, { shiftKey });
      const sheet = actor?.sheet ?? { actor, token: resolvedToken, element: null };

      if (sheet && typeof sheet._onCombatQuickAction === "function") {
        await sheet._onCombatQuickAction(event, target);
        return _result(true, "sheet._onCombatQuickAction");
      }

      await onCombatQuickAction.call(sheet, event, target);
      return _result(true, "shared.listeners.onCombatQuickAction");
    },

    /**
     * Open the cast-magic flow for an actor.
     * @param {{actor: Actor, token?: Token|null, preselectedSpell?: Item|null, shiftKey?: boolean, castActionType?: string}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeCastMagic({ actor, token = null, preselectedSpell = null, shiftKey = false, castActionType = "primary" } = {}) {
      if (!actor) return _result(false, "none", { reason: "no-actor" });

      const resolvedToken = _resolveToken(actor, token);
      const target = _makeSyntheticTarget({ actionType: castActionType === "secondary" ? "secondary" : "primary" });
      const event = _makeSyntheticEvent(target, { shiftKey });
      const sheet = actor?.sheet ?? { actor, token: resolvedToken, element: null };

      if (sheet && typeof sheet._onCastMagicAction === "function") {
        await sheet._onCastMagicAction(event, target, preselectedSpell);
        return _result(true, "sheet._onCastMagicAction");
      }

      await onCastMagicAction.call(sheet, event, target, preselectedSpell);
      return _result(true, "shared.listeners.onCastMagicAction");
    },

    /**
     * Execute a skill roll for an embedded skill item.
     * @param {{actor: Actor, itemId: string, shiftKey?: boolean}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeSkillRoll({ actor, itemId, shiftKey = false } = {}) {
      if (!actor || !itemId) return _result(false, "none", { reason: "bad-args" });
      const target = {
        dataset: { itemId },
        closest: () => ({ dataset: { itemId } })
      };
      const event = _makeSyntheticEvent(target, { shiftKey });
      const sheet = actor?.sheet ?? { actor, element: null };

      if (sheet && typeof sheet._onSkillRoll === "function") {
        await sheet._onSkillRoll(event, target);
        return _result(true, "sheet._onSkillRoll");
      }

      await onSkillRoll.call(sheet, event, target);
      return _result(true, "shared.listeners.onSkillRoll");
    },

    /**
     * Execute a combat-style roll for an embedded combat style item.
     * @param {{actor: Actor, itemId: string, shiftKey?: boolean}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeCombatRoll({ actor, itemId, shiftKey = false } = {}) {
      if (!actor || !itemId) return _result(false, "none", { reason: "bad-args" });
      const target = {
        dataset: { itemId },
        closest: () => ({ dataset: { itemId } })
      };
      const event = _makeSyntheticEvent(target, { shiftKey });
      const sheet = actor?.sheet ?? { actor, element: null };

      if (sheet && typeof sheet._onCombatRoll === "function") {
        await sheet._onCombatRoll(event, target);
        return _result(true, "sheet._onCombatRoll");
      }

      await onCombatRoll.call(sheet, event, target);
      return _result(true, "shared.listeners.onCombatRoll");
    },

    /**
     * Execute a characteristic roll from characteristic key/label data.
     * @param {{actor: Actor, key: string, label: string, shiftKey?: boolean}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeCharacteristicRoll({ actor, key, label, shiftKey = false } = {}) {
      if (!actor || !key || !label) return _result(false, "none", { reason: "bad-args" });

      const target = document.createElement("span");
      target.id = key;
      target.setAttribute("name", label);
      const event = _makeSyntheticEvent(target, { shiftKey });
      const sheet = actor?.sheet ?? { actor, element: null };

      if (sheet && typeof sheet._onClickCharacteristic === "function") {
        await sheet._onClickCharacteristic(event, target);
        return _result(true, "sheet._onClickCharacteristic");
      }

      await onClickCharacteristic.call(sheet, event, target);
      return _result(true, "shared.listeners.onClickCharacteristic");
    },

    /**
     * Activate a feature item through the canonical item-sheet/system activation flow.
     * @param {{item: Item, actor?: Actor|null, event?: Event|null}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async executeFeatureActivation({ item, actor, event = null } = {}) {
      if (!item) return _result(false, "none", { reason: "no-item" });

      if (item.type === "talent") {
        await activateTalentFromItemSheet({ item, event });
        return _result(true, "shared-handlers.activateTalentFromItemSheet");
      }
      if (item.type === "power") {
        await activatePowerFromItemSheet({ item, event });
        return _result(true, "shared-handlers.activatePowerFromItemSheet");
      }
      if (item.type === "trait") {
        await activateTraitFromItemSheet({ item, event });
        return _result(true, "shared-handlers.activateTraitFromItemSheet");
      }

      await executeItemActivation({
        item,
        actor: actor ?? item.actor ?? null,
        event,
        renderChat: true,
        includeImage: true,
        context: {}
      });
      return _result(true, "activation.executeItemActivation");
    },

    /**
     * Execute a scroll cast from a scroll item.
     * @param {{actor: Actor, scrollItem: Item, castActionType?: string}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string,result?:any}>}
     */
    async executeScrollCast({ actor, scrollItem, castActionType = "primary" } = {}) {
      if (!actor || !scrollItem) return _result(false, "none", { reason: "bad-args" });
      const result = await castScrollFromItem({
        scrollItem,
        casterActor: actor,
        castActionType
      });
      return _result(true, "scroll-casting.castScrollFromItem", { result });
    },

    /**
     * Open one of the HUD-supported resource dialogs for an actor.
     * @param {{actor: Actor, resourceId: string}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async openResourceDialog({ actor, resourceId } = {}) {
      if (!actor || !resourceId) return _result(false, "none", { reason: "bad-args" });

      if (resourceId === "resource-health") {
        await HPTempHPDialog.show(actor);
        return _result(true, "HPTempHPDialog.show");
      }
      if (resourceId === "resource-stamina") {
        await openStaminaDialog(actor);
        return _result(true, "openStaminaDialog");
      }
      if (resourceId === "resource-magicka") {
        await MagickaBarrierDialog.show(actor);
        return _result(true, "MagickaBarrierDialog.show");
      }
      if (resourceId === "resource-luck") {
        const fn = LuckAPI?.openBurnLuckFromSheet ?? LuckAPI?.openBurnDialog;
        if (typeof fn !== "function") return _result(false, "none", { reason: "no-resource-dialog-handler" });
        await fn(actor);
        return _result(true, "LuckAPI.openBurnLuckFromSheet");
      }

      return _result(false, "none", { reason: "no-resource-dialog-handler" });
    },

    /**
     * Apply a short or long rest workflow for an actor.
     * @param {{actor: Actor, restType: string}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async applyRest({ actor, restType } = {}) {
      if (!actor || !restType) return _result(false, "none", { reason: "bad-args" });
      const fn = restType === "shortRest" ? applyShortRest : applyLongRest;
      if (typeof fn !== "function") return _result(false, "none", { reason: "no-rest-function" });

      const { line } = await fn(actor);
      if (line && typeof buildRestChatContent === "function") {
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor }),
          content: buildRestChatContent(restType === "shortRest" ? "Short Rest" : "Long Rest", [line])
        });
      }

      return _result(true, `rest-workflow.${restType}`);
    },

    /**
     * Open the actor's language or faction selector workflow.
     * @param {{actor: Actor, kind: string, entryId?: string|null}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string,entryId?:string|null,focusedOpenSupported?:boolean}>}
     */
    async openSocialSelector({ actor, kind, entryId = null } = {}) {
      if (!actor || !kind) return _result(false, "none", { reason: "bad-args" });
      if (kind === "language") {
        await LanguageSelectorAppV2.prompt(actor);
        return _result(true, "LanguageSelectorAppV2.prompt", { entryId, focusedOpenSupported: false });
      }
      if (kind === "faction") {
        await FactionSelectorAppV2.prompt(actor);
        return _result(true, "FactionSelectorAppV2.prompt", { entryId, focusedOpenSupported: false });
      }
      return _result(false, "none", { reason: "no-social-selector" });
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
      if (!item) return _result(false, "none", { reason: "no-item" });
      await item.update({ "system.equipped": Boolean(equipped) });
      return _result(true, "item.update.system.equipped");
    },

    /**
     * Open the sheet for a Foundry document when available.
     * @param {{document: object}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async openDocumentSheet({ document } = {}) {
      if (!document?.sheet || typeof document.sheet.render !== "function") {
        return _result(false, "none", { reason: "no-sheet" });
      }
      document.sheet.render(true);
      return _result(true, "document.sheet.render");
    },

    /**
     * Run post-chat feature automation without creating an extra chat card.
     * Used by the HUD's passive feature chat path.
     * @param {{item: Item, actor?: Actor|null, event?: Event|null}} params
     * @returns {Promise<{ok:boolean,path:string,reason?:string}>}
     */
    async runFeaturePostChatAutomation({ item, actor = null, event = null } = {}) {
      if (!item) return _result(false, "none", { reason: "no-item" });
      await executeItemActivation({
        item,
        actor: actor ?? item.actor ?? null,
        event,
        renderChat: false,
        includeImage: false,
        context: {}
      });
      return _result(true, "activation.executeItemActivation.renderChatFalse");
    }
  };
}
