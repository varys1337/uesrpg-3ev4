/**
 * Extend the basic foundry.appv1.sheets.ActorSheet with UESRPG-specific UI and handlers.
 * @extends {foundry.appv1.sheets.ActorSheet}
 */

import { bindCommonEditableInventoryListeners, bindCommonSheetListeners } from "./sheet-listeners.js";
import { prepareCharacterItems } from "./sheet-prepare-items.js";
import { getCollapsedGroups } from "./sheet-ui-state.js";
import { postItemToChat } from "./shared-handlers.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { AttackTracker } from "../../core/combat/attack-tracker.js";

import { onCombatQuickAction } from "./shared/listeners/combat-actions.js";
import { onCastMagicAction } from "./shared/listeners/magic-cast.js";
import { onSkillRoll, onSpellRoll, onCombatRoll, onResistanceRoll, onDamageRoll } from "./shared/listeners/rolls.js";

import { onRaceMenu, onBirthSignMenu, onXPMenu } from "./shared/dialogs/character-menus.js";
import { onSetBaseCharacteristics, onClickCharacteristic, onLuckyMenu } from "./shared/listeners/characteristics-handlers.js";

import { onToggle2H, onPlusQty, onMinusQty, onItemEquip } from "./shared/listeners/inventory-handlers.js";
import { onWealthCalc, onCarryBonus } from "./shared/listeners/economy-handlers.js";
import { onToggleGroupCollapse, onItemSearch, onLoadoutSave, onLoadoutApply, onLoadoutDelete } from "./shared/helpers/ui-state-handlers.js";
import { onItemCreate } from "./shared/dialogs/equipment-dialogs.js";
import { prepareSpellEffectsBreakdown } from "./shared/spell-effects-breakdown.js";
import { buildFeatureInspectorContext } from "./shared/feature-inspector.js";

import { registerHPButtonHandler } from "./actor-sheet-hp-integration.js";
import { registerStaminaButtonHandler } from "./actor-sheet-stamina-integration.js";
import { registerMagickaButtonHandler } from "./actor-sheet-magicka-integration.js";

import {
  onIncrementResource,
  onResetResource,
  onShortRest,
  onLongRest,
  onIncrementFatigue,
  setResourceBars
} from "./actor/ui/resources.js";

import {
  buildCombatQuickContext,
  buildCombatActionsContext,
  applyDefensiveStanceDisabling,
  buildSheetUiState,
  enrichBiography,
  normalizeItemRanks
} from "./actor/prepare.js";

export class SimpleActorSheet extends foundry.appv1.sheets.ActorSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["worldbuilding", "sheet", "actor", "Player Character"],
      width: 780,
      height: 860,
      tabs: [
        {
          navSelector: ".sheet-tabs",
          contentSelector: ".sheet-body",
          initial: "core",
        },
      ],
      dragDrop: [
        {
          dragSelector: [
            ".armor-table .item",
            ".ammunition-table .item",
            ".weapon-table .item",
            ".spellList .item",
            ".skillList .item",
            ".factionContainer .item",
            ".languageContainer .item",
            ".talent-container .item",
            ".trait-container .item",
            ".power-container .item",
            ".equipmentList .item",
            ".containerList .item",
          ],
          dropSelector: null,
        },
      ],
    });
  }

  /** @override */
  get template() {
    return "systems/uesrpg-3ev4/templates/actor-sheet.html";
  }

  /** @override */
  async getData(options = {}) {
    const data = await super.getData(options);
    data.dtypes = ["String", "Number", "Boolean"];
    data.isGM = game.user.isGM;

    data.editable =
      this.isEditable ??
      this.options?.editable ??
      data.options?.editable ??
      false;

    // Sheet-only item categorization
    prepareCharacterItems(data, { includeSkills: true, includeMagicSkills: true });
    normalizeItemRanks(data.items);

    // Combat tab contexts
    data.actor.sheetCombatQuick = buildCombatQuickContext(data.actor);
    data.actor.sheetCombatActions = buildCombatActionsContext(this.actor);
    data.actor.attackTrackerUi = {
      current: AttackTracker.getAttackCount(this.actor),
      max: AttackTracker.getAttackLimit(this.actor),
      overrides: AttackTracker.getOverrides(this.actor)
    };
    applyDefensiveStanceDisabling(this.actor, data.actor.sheetCombatQuick);

    // Per-user UI state (loadouts, diagnostics)
    data.sheetUi = await buildSheetUiState(this.actor);

    // Enriched biography for the editor helper (cached per sheet instance)
    data.actor.system.enrichedBio = await enrichBiography(data.actor.system?.bio, this);

    // Spell effects breakdown (Origin AE summaries for Magic tab)
    data.spellEffectsBreakdown = prepareSpellEffectsBreakdown(this.actor);

    // Feature Inspector (Chapter 4 provenance debug panel)
    data.featureInspector = buildFeatureInspectorContext(this.actor);

    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    bindCommonSheetListeners(this, html);
    bindCommonEditableInventoryListeners(this, html);

    // Resource button dialogs (HP, Stamina, Magicka)
    registerHPButtonHandler(this, html);
    registerStaminaButtonHandler(this, html);
    registerMagickaButtonHandler(this, html);

    // Menus
    html.find("#raceMenu").off("click.uesrpg").on("click.uesrpg", this._onRaceMenu.bind(this));
    html.find("#birthSignMenu").off("click.uesrpg").on("click.uesrpg", this._onBirthSignMenu.bind(this));
    html.find("#xpMenu").off("click.uesrpg").on("click.uesrpg", this._onXPMenu.bind(this));
    html.find("#luckyMenu").off("click.uesrpg").on("click.uesrpg", this._onLuckyMenu.bind(this));

    // Characteristics
    html.find(".characteristics-config").off("click.uesrpg").on("click.uesrpg", this._onSetBaseCharacteristics.bind(this));
    html.find(".characteristic-roll").off("click.uesrpg").on("click.uesrpg", this._onClickCharacteristic.bind(this));

    // Resources + rest
    html.find(".incrementResource").off("click.uesrpg").on("click.uesrpg", this._onIncrementResource.bind(this));
    html.find(".restoreResource").off("click.uesrpg").on("click.uesrpg", this._onResetResource.bind(this));
    html.find(".incrementFatigue").off("click.uesrpg").on("click.uesrpg", this._onIncrementFatigue.bind(this));
    html.find(".short-rest").off("click.uesrpg").on("click.uesrpg", this._onShortRest.bind(this));
    html.find(".long-rest").off("click.uesrpg").on("click.uesrpg", this._onLongRest.bind(this));

    // Rolls
    html.find(".skill-roll").off("click.uesrpg").on("click.uesrpg", this._onSkillRoll.bind(this));
    html.find(".combat-roll").off("click.uesrpg").on("click.uesrpg", this._onCombatRoll.bind(this));
    html.find(".resistance-roll").off("click.uesrpg").on("click.uesrpg", this._onResistanceRoll.bind(this));
    html.find(".damage-roll").off("click.uesrpg").on("click.uesrpg", this._onDamageRoll.bind(this));
    html.find(".ammo-roll").off("click.uesrpg").on("click.uesrpg", this._onAmmoRoll.bind(this));

    // Traits / Talents / Powers: click image to activate (post to chat + effect transfer)
    html.find(".trait-container .item-img, .talent-container .item-img, .power-container .item-img")
      .off("click.uesrpg")
      .on("click.uesrpg", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await postItemToChat(ev, this.actor, { includeImage: true });
      });

    // Magic casting (left-click cast, right-click post)
    html.find(".magic-roll").off("click.uesrpg").on("click.uesrpg", this._onCastMagicAction.bind(this));
    html.find(".magic-roll")
      .off("contextmenu.uesrpg")
      .on("contextmenu.uesrpg", async (ev) => {
        ev.preventDefault();
        await postItemToChat(ev, this.actor, { includeImage: true });
      });
    html.find(".uesrpg-cast-magic").off("click.uesrpg").on("click.uesrpg", this._onCastMagicAction.bind(this));

    // Spell effects breakdown: cancel spell button
    html.find(".uesrpg-cancel-spell").off("click.uesrpg").on("click.uesrpg", this._onCancelSpell.bind(this));

    // Inventory
    html.find(".toggle2H").off("click.uesrpg").on("click.uesrpg", this._onToggle2H.bind(this));
    html.find(".plusQty").off("click.uesrpg").on("click.uesrpg", this._onPlusQty.bind(this));
    html.find(".minusQty").off("contextmenu.uesrpg").on("contextmenu.uesrpg", this._onMinusQty.bind(this));
    html.find(".itemEquip").off("click.uesrpg").on("click.uesrpg", this._onItemEquip.bind(this));
    html.find(".uesrpg-attack-input").off("change.uesrpg").on("change.uesrpg", this._onAttackTrackerInputChange.bind(this));

    // Economy
    html.find(".wealthCalc").off("click.uesrpg").on("click.uesrpg", this._onWealthCalc.bind(this));
    html.find(".carryBonus").off("click.uesrpg").on("click.uesrpg", this._onCarryBonus.bind(this));

    // Render-time DOM helpers
    try {
      setResourceBars(this);
    } catch (_e) {
      // no-op
    }

    // Feature Inspector: copy debug JSON to clipboard
    html.find(".uesrpg-feature-inspector-copy").off("click.uesrpg").on("click.uesrpg", (ev) => {
      ev.preventDefault();
      const json = ev.currentTarget.dataset.json ?? "[]";
      navigator.clipboard.writeText(json).then(() => {
        ui.notifications?.info?.("Feature Inspector data copied to clipboard.");
      }).catch((err) => {
        console.warn("uesrpg | Failed to copy feature inspector data", err);
      });
    });
  }

  async _applyCollapsedGroups(html) {
    const groups = await getCollapsedGroups();
    const toggles = html?.find?.(".uesrpg-group-toggle") ?? [];
    for (const el of toggles) {
      const key = String(el?.dataset?.group ?? "").trim();
      if (!key) continue;
      const collapsed = Boolean(groups?.[key]);
      this._setGroupCollapsedInDom(el, collapsed);
    }
  }

  _setGroupCollapsedInDom(toggleEl, collapsed) {
    if (!toggleEl) return;

    const icon = toggleEl.querySelector("i");
    if (icon) {
      const isCaret = icon.classList.contains("fa-caret-down") || icon.classList.contains("fa-caret-right");
      if (isCaret) {
        icon.classList.remove("fa-caret-down", "fa-caret-right");
        icon.classList.add(collapsed ? "fa-caret-right" : "fa-caret-down");
      } else {
        icon.classList.remove("fa-chevron-down", "fa-chevron-right");
        icon.classList.add(collapsed ? "fa-chevron-right" : "fa-chevron-down");
      }
    }

    const spellSchool = toggleEl.closest(".spell-school-section");
    if (spellSchool) {
      const table = spellSchool.querySelector(".spell-school-table");
      if (table) table.style.display = collapsed ? "none" : "";
      return;
    }

    const collapsible = toggleEl.closest(".uesrpg-collapsible");
    if (collapsible) {
      const body = collapsible.querySelector(".uesrpg-collapse-body");
      if (body) body.style.display = collapsed ? "none" : "";
      return;
    }

    const table = toggleEl.closest("table");
    if (table) {
      const tbody = table.querySelector("tbody");
      if (tbody) tbody.style.display = collapsed ? "none" : "";
      return;
    }

    const section = toggleEl.closest(".languageContainer, .factionContainer, .trait-container, .talent-container, .power-container");
    if (section) {
      const list = section.querySelector("ol, ul");
      if (list) list.style.display = collapsed ? "none" : "";
    }
  }

  async _onCombatQuickAction(event) {
    return onCombatQuickAction(this, event);
  }

  async _onToggleGroupCollapse(event) {
    return onToggleGroupCollapse(this, event);
  }

  _onItemSearch(event) {
    return onItemSearch(this, event);
  }

  async _onLoadoutSave(event) {
    return onLoadoutSave(this, event);
  }

  async _onLoadoutApply(event) {
    return onLoadoutApply(this, event);
  }

  async _onLoadoutDelete(event) {
    return onLoadoutDelete(this, event);
  }

  async _onSetBaseCharacteristics(event) {
    return onSetBaseCharacteristics(this, event);
  }

  async _onClickCharacteristic(event) {
    return onClickCharacteristic(this, event);
  }

  async _onSkillRoll(event) {
    return onSkillRoll(this, event);
  }

  async _onSpellRoll(event) {
    return onSpellRoll(this, event);
  }

  async _onCombatRoll(event) {
    return onCombatRoll(this, event);
  }

  async _onResistanceRoll(event) {
    return onResistanceRoll(this, event);
  }

  async _onDamageRoll(event) {
    return onDamageRoll(this, event);
  }

  async _onCastMagicAction(event, preselectedSpell = null) {
    return onCastMagicAction(this, event, preselectedSpell);
  }

  async _onCancelSpell(event) {
    event.preventDefault();
    const effectId = event.currentTarget?.dataset?.effectId;
    if (!effectId) return;
    const effect = this.actor.effects?.get(effectId);
    if (!effect) return;
    const { cancelOriginAEUpkeep } = await import("../../core/magic/effects/origin-effect.js");
    const confirmed = await Dialog.confirm({
      title: "Cancel Spell",
      content: `<p>Cancel <strong>${effect.flags?.["uesrpg-3ev4"]?.spellName ?? effect.name}</strong>? This will end the spell and remove all linked effects.</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
    if (confirmed) await cancelOriginAEUpkeep(effect);
  }

  async _onAmmoRoll(event) {
    event.preventDefault();
    const button = $(event.currentTarget);
    const li = button.parents(".item");
    const item = this.actor.getEmbeddedDocument("Item", li.data("itemId"));
    if (!item) return;

    const currentQty = Number(item.system.quantity ?? 0);
    if (currentQty <= 0) {
      ui.notifications.info("Out of Ammunition!");
      return;
    }

    const contentString = `<h2 style="font-size: large;"><img src="${item.img}" style="height:24px;width:24px;vertical-align:middle;margin-right:6px;">${item.name}</h2>
      <b>Damage Bonus:</b> ${item.system.damage}<p>
      <b>Qualities</b> ${item.system.qualities}`;

    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker(),
      content: contentString,
    });

    const newQty = Math.max(currentQty - 1, 0);
  await requestUpdateDocument(item, { "system.quantity": newQty });

    if (newQty === 0) ui.notifications.info("Out of Ammunition!");
  }

  async _onToggle2H(event) {
    return onToggle2H(this, event);
  }

  async _onPlusQty(event) {
    return onPlusQty(this, event);
  }

  async _onMinusQty(event) {
    return onMinusQty(this, event);
  }

  async _onItemEquip(event) {
    return onItemEquip(this, event);
  }

  async _onItemCreate(event) {
    return onItemCreate(this, event);
  }

  async _onAttackTrackerInputChange(event) {
    event.preventDefault();
    if (!game.user?.isGM) {
      ui.notifications?.warn?.("Only the GM can adjust attack tracker values.");
      return;
    }
    const el = event.currentTarget;
    const kind = String(el?.dataset?.kind ?? "").trim().toLowerCase();
    const value = Number(el?.value ?? NaN);
    if (!Number.isFinite(value)) return;
    if (kind === "max") {
      await AttackTracker.setAttackLimitOverride(this.actor, value);
      return;
    }
    await AttackTracker.setCurrentAttacks(this.actor, value);
  }

  async _duplicateItem(item) {
    const d = new Dialog({
      title: "Duplicate Item",
      content: `<div style="padding: 10px; display: flex; flex-direction: row; align-items: center; justify-content: center;">
                    <div>Duplicate Item?</div>
                </div>`,
      buttons: {
        one: { label: "Cancel", callback: () => {} },
        two: {
          label: "Duplicate",
          callback: async () => {
            const created = await this.actor.createEmbeddedDocuments("Item", [item.toObject()]);
            await created?.[0]?.sheet?.render?.(true);
          },
        },
      },
      default: "two",
      close: () => {},
    });

    d.render(true);
  }

  async _onWealthCalc(event) {
    return onWealthCalc(this, event);
  }

  async _onCarryBonus(event) {
    return onCarryBonus(this, event);
  }

  _onLuckyMenu(event) {
    return onLuckyMenu(this, event);
  }

  async _onRaceMenu(event) {
    return onRaceMenu(this, event);
  }

  async _onBirthSignMenu(event) {
    return onBirthSignMenu(this, event);
  }

  _onXPMenu(event) {
    return onXPMenu(this, event);
  }

  async _onIncrementResource(event) {
    return onIncrementResource(this, event);
  }

  async _onResetResource(event) {
    return onResetResource(this, event);
  }

  async _onIncrementFatigue(event) {
    return onIncrementFatigue(this, event);
  }

  async _onShortRest(event) {
    return onShortRest(this, event);
  }

  async _onLongRest(event) {
    return onLongRest(this, event);
  }

  /* -------------------------------------------- */

  /**
   * @override
   * Handle drops onto the actor sheet.
   * Intercepts items being dragged from containers to properly unlink them.
   */
  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);

    // Handle Item drops - check if coming from a container
    if (data.type === "Item") {
      let item;
      try {
        item = await fromUuid(data.uuid);
      } catch (err) {
        // Fall back to default handler
        return super._onDrop(event);
      }

      if (item && item.actor?.id === this.actor.id) {
        // Item is being moved within the same actor
        const cs = item.system?.containerStats;
        if (cs?.contained && cs?.container_id) {
          // Item is currently in a container - unlink it
          const containerId = cs.container_id;
          const container = this.actor.items.get(containerId);

          // Update the item to clear containerStats
          await item.update({
            "system.containerStats.contained": false,
            "system.containerStats.container_id": "",
            "system.containerStats.container_name": ""
          });

          // Update the container's contained_items list
          if (container && Array.isArray(container.system?.contained_items)) {
            const nextContained = container.system.contained_items.filter(
              (ci) => ci?._id !== item.id
            );
            await container.update({ "system.contained_items": nextContained });
          }

          ui.notifications?.info(`${item.name} removed from ${cs.container_name || "container"}.`);
          
          // Force a fresh sheet render to show the unlinked item in main inventory
          // (prepareCharacterItems filters by containerStats.contained, so we need fresh data)
          this.render(false);
          return;
        }
      }
    }

    // Continue with default drop behavior for new items or sorting
    return super._onDrop(event);
  }

  /* -------------------------------------------- */
  /* Active Effects                                */
  /* -------------------------------------------- */

  /**
   * Handle Active Effect controls from the Effects tab.
   */
  async _onEffectControl(event) {
    event.preventDefault();
    const el = event.currentTarget;
    if (!el || !el.dataset) return;

    const action = el.dataset.action;
    const effectId = el.dataset.effectId;
    if (!action) return;
    if (!this.actor || !this.actor.effects) return;

    if (action === "create") {
      const effectData = {
        name: "New Effect",
        img: "icons/svg/aura.svg",
        changes: [],
        disabled: false,
        transfer: false,
        duration: {},
      };
      const created = await this.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
      const eff = created?.[0] ?? null;
      if (eff?.sheet) eff.sheet.render(true);
      return;
    }

    const effect = this.actor.effects.get(effectId);
    if (!effect) return;

    switch (action) {
      case "edit":
        if (effect.sheet) effect.sheet.render(true);
        break;
      case "delete":
        await effect.delete();
        break;
      case "toggle":
        await effect.update({ disabled: !effect.disabled });
        break;
      default:
        break;
    }
  }
}
