/**
 * src/ui/sheets/v2/actor-sheet.js
 *
 * ApplicationV2 Player Character Sheet.
 *
 * Key improvements:
 * - Uses HandlebarsApplicationMixin(ActorSheetV2) base
 * - Native AppV2 lifecycle (_preRender / _onRender) for UI state preservation
 * - Delegates to existing shared handler modules for all roll, combat, magic, & inventory logic
 * - All form submission uses submitOnChange: true (no custom normalization needed)
 */

import { prepareCharacterItems } from "../sheet-prepare-items.js";
import { applyCollapsedGroups } from "../shared/helpers/collapsed-group-dom.js";
import { postItemToChat } from "../shared-handlers.js";
import { unlinkAllItemsFromContainer, unlinkItemFromContainer } from "../sheet-containers.js";
import { requestUpdateDocument, requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { confirmDialog } from "../../../utils/dialog-v2-helper.js";
import { resolveDroppedItem } from "../../../utils/drop-data.js";
import { AttackTracker } from "../../../core/combat/attack-tracker.js";
import { cancelOriginAEUpkeep } from "../../../core/magic/effects/origin-effect.js";

import { onCombatQuickAction } from "../shared/listeners/combat-actions.js";
import { onCastMagicAction } from "../shared/listeners/magic-cast.js";
import { onSkillRoll, onSpellRoll, onCombatRoll, onResistanceRoll, onDamageRoll } from "../shared/listeners/rolls.js";

import { onRaceMenu, onBirthSignMenu, onXPMenu } from "../shared/dialogs/character-menus.js";
import { onSetBaseCharacteristics, onClickCharacteristic, onLuckyMenu } from "../shared/listeners/characteristics-handlers.js";

import { onToggle2H, onPlusQty, onMinusQty, onItemEquip } from "../shared/listeners/inventory-handlers.js";
import { onWealthCalc, onCarryBonus } from "../shared/listeners/economy-handlers.js";
import { onToggleGroupCollapse, onItemSearch, onLoadoutSave, onLoadoutApply, onLoadoutDelete } from "../shared/helpers/ui-state-handlers.js";
import { onItemCreate } from "../shared/dialogs/equipment-dialogs.js";
import { prepareSpellEffectsBreakdown } from "../shared/spell-effects-breakdown.js";
import { buildFeatureInspectorContext } from "../shared/feature-inspector.js";

import { registerResourceButtonHandlers } from "../shared/listeners/resource-button-handlers.js";
import { LanguageSelectorAppV2, FactionSelectorAppV2 } from "../../apps/v2/social-selectors.js";
import { buildSocialDisplay } from "../../../core/social/social-data.js";
import {
  TALENT_LEARNING_MODE,
  validateTalentLearning,
  notifyTalentLearningResult,
} from "../../../core/traits/talent-learning.js";

import {
  onIncrementResource,
  onResetResource,
  onShortRest,
  onLongRest,
  onIncrementFatigue,
  setResourceBars,
} from "../shared/ui/resources.js";

import {
  buildCombatQuickContext,
  buildCombatActionsContext,
  applyDefensiveStanceDisabling,
  buildSheetUiState,
  enrichBiography,
  normalizeItemRanks,
} from "../shared/prepare.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ActorSheetV2Base = foundry.applications.sheets.ActorSheetV2;

export class PCActorSheetV2 extends HandlebarsApplicationMixin(ActorSheetV2Base) {

  /** @type {Function|null} Debounced item search (memoized) */
  _uesrpgDebouncedSearch = null;

  /**
   * Native AppV2 tab configuration — dual groups.
   * "primary": top-level sheet tabs.  "actions": combat-actions subtabs.
   * @type {Record<string, ApplicationTabsConfiguration>}
   */
  static TABS = {
    primary: {
      tabs: [
        { id: "core" },
        { id: "combat" },
        { id: "magic" },
        { id: "equipment" },
      ],
      initial: "core",
    },
    actions: {
      tabs: [
        { id: "primary" },
        { id: "secondary" },
        { id: "reactions" },
        { id: "special" },
      ],
      initial: "primary",
    },
  };

  /* ═══════════════════════ Static Configuration ═══════════════════════ */

  static DEFAULT_OPTIONS = {
    classes: ["worldbuilding", "sheet", "actor", "player-character"],
    position: { width: 780, height: 930 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      raceMenu: PCActorSheetV2.prototype._onRaceMenu,
      birthSignMenu: PCActorSheetV2.prototype._onBirthSignMenu,
      openLanguageSelector: PCActorSheetV2.prototype._onOpenLanguageSelector,
      openFactionSelector: PCActorSheetV2.prototype._onOpenFactionSelector,
      xpMenu: PCActorSheetV2.prototype._onXPMenu,
      luckyMenu: PCActorSheetV2.prototype._onLuckyMenu,
      burnLuck: PCActorSheetV2.prototype._onBurnLuck,
      characteristicsConfig: PCActorSheetV2.prototype._onSetBaseCharacteristics,
      characteristicRoll: PCActorSheetV2.prototype._onClickCharacteristic,
      editPortrait: PCActorSheetV2.prototype._onEditPortrait,
      incrementResource: PCActorSheetV2.prototype._onIncrementResource,
      restoreResource: PCActorSheetV2.prototype._onResetResource,
      incrementFatigue: PCActorSheetV2.prototype._onIncrementFatigue,
      shortRest: PCActorSheetV2.prototype._onShortRest,
      longRest: PCActorSheetV2.prototype._onLongRest,
      skillRoll: PCActorSheetV2.prototype._onSkillRoll,
      combatRoll: PCActorSheetV2.prototype._onCombatRoll,
      damageRoll: PCActorSheetV2.prototype._onDamageRoll,
      ammoRoll: PCActorSheetV2.prototype._onAmmoRoll,
      castMagic: PCActorSheetV2.prototype._onCastMagicAction,
      cancelSpell: PCActorSheetV2.prototype._onCancelSpell,
      combatQuickAction: PCActorSheetV2.prototype._onCombatQuickAction,
      effectControl: PCActorSheetV2.prototype._onEffectControl,
      toggle2H: PCActorSheetV2.prototype._onToggle2H,
      plusQty: PCActorSheetV2.prototype._onPlusQty,
      itemEquip: PCActorSheetV2.prototype._onItemEquip,
      itemCreate: PCActorSheetV2.prototype._onItemCreate,
      itemOpen: PCActorSheetV2.prototype._onItemOpen,
      itemDelete: PCActorSheetV2.prototype._onItemDelete,
      openContainer: PCActorSheetV2.prototype._onOpenContainer,
      wealthCalc: PCActorSheetV2.prototype._onWealthCalc,
      carryBonus: PCActorSheetV2.prototype._onCarryBonus,
      groupToggle: PCActorSheetV2.prototype._onToggleGroupCollapse,
      loadoutSave: PCActorSheetV2.prototype._onLoadoutSave,
      loadoutApply: PCActorSheetV2.prototype._onLoadoutApply,
      loadoutDelete: PCActorSheetV2.prototype._onLoadoutDelete,
      postItemToChat: PCActorSheetV2.prototype._onPostItemToChat,
      featureInspectorCopy: PCActorSheetV2.prototype._onFeatureInspectorCopy,
    },
    dragDrop: [
      {
        dragSelector: ".item, .npc-item, .spell-row",
        dropSelector: ".window-content, .sheet-body, .tab, .tabContainer, .itemListContainer",
      },
    ],
  };

  static PARTS = {
    sidebar: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/shared/sidebar.hbs",
      templates: ["systems/uesrpg-3ev4/templates/partials/sheets/fixed-header.hbs"],
    },
    core: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/actor/tab-core.hbs",
      templates: [
        "systems/uesrpg-3ev4/templates/partials/sheets/feature-inspector.hbs",
      ],
      scrollable: [""],
    },
    combat: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/actor/tab-combat.hbs",
      scrollable: [""],
    },
    magic: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/actor/tab-magic.hbs",
      scrollable: [""],
    },
    equipment: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/actor/tab-equipment.hbs",
      scrollable: [""],
    },
  };

  /* ═══════════════════════ Window Chrome ═════════════════════════════ */

  /** Override default title to show only the actor name (no type prefix). */
  get title() {
    return this.document.name;
  }

  /* ═══════════════════════ V1 Compatibility ══════════════════════════ */

  /** V1 compat: shared handler modules access `sheet.actor` */
  get actor() {
    return this.document;
  }

  /**
   * V1 compat: `setResourceBars()` accesses `sheet.form`.
   * In AppV2 `this.element` IS the <form>.
   */
  get form() {
    return this.element;
  }

  /* ═══════════════════════ Context Preparation ═══════════════════════ */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;

    // V1-compatible fields expected by templates + shared helpers
    // Use toObject() as a base, then overlay live system data from prepareData()
    // so that derived values (hp.max, stamina.max, magicka.max, etc.) are current.
    const actorObj = actor.toObject();
    actorObj.system = actor.system;
    context.actor = actorObj;
    context.data = context.actor.system;
    context.dtypes = ["String", "Number", "Boolean"];
    context.isGM = game.user.isGM;
    context.editable = this.isEditable;
    context.owner = actor.isOwner;
    context.limited = actor.limited;
    context.cssClass = this.isEditable ? "editable" : "locked";
    context.options = { editable: this.isEditable };

    // Item categorization — V2 does not auto-populate context.items like V1 getData()
    // Overlay live system data so derived fields (value, *Effective, damage3, etc.)
    // survive into templates — mirrors the actor-level overlay at line 122.
    context.items = actor.items.map(i => {
      const obj = i.toObject();
      obj.system = i.system;
      return obj;
    });
    prepareCharacterItems(context, { includeSkills: true, includeMagicSkills: true });
    normalizeItemRanks(context.items);

    // Combat tab contexts
    context.actor.sheetCombatQuick = buildCombatQuickContext(context.actor);
    context.actor.sheetCombatActions = buildCombatActionsContext(actor);
    context.actor.attackTrackerUi = {
      current: AttackTracker.getAttackCount(actor),
      max: AttackTracker.getAttackLimit(actor),
      overrides: AttackTracker.getOverrides(actor),
    };
    applyDefensiveStanceDisabling(actor, context.actor.sheetCombatQuick);

    // Per-user UI state (loadouts, diagnostics)
    context.sheetUi = await buildSheetUiState(actor);

    // Enriched biography (cached per sheet instance)
    context.actor.system.enrichedBio = await enrichBiography(
      context.actor.system?.bio, this
    );
    context.actor.system.socialDisplay = buildSocialDisplay(context.actor.system);

    // Spell effects breakdown (Origin AE summaries for Magic tab)
    context.spellEffectsBreakdown = prepareSpellEffectsBreakdown(actor);

    // Active Effects (Effects list on Magic tab)
    context.effects = actor.effects
      ? actor.effects.contents.map(e => e.toObject())
      : [];

    // Feature Inspector (Chapter 4 provenance debug panel)
    context.featureInspector = game.settings.get("uesrpg-3ev4", "showFeatureInspector")
      ? buildFeatureInspectorContext(actor)
      : null;

    return context;
  }

  /* ═══════════════════════ Render Lifecycle ═══════════════════════ */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    if (!el) return;

    // ── Tab handling (native AppV2) ─────────────────────────────────────
    this.changeTab(this.tabGroups.primary ?? "core", "primary", { force: true });
    this.changeTab(this.tabGroups.actions ?? "primary", "actions", { force: true });

    // ── Collapsible groups (async — fire and forget) ──────────────
    applyCollapsedGroups(el);

    // ── Resource bars (DOM cosmetic — reads across both parts) ────
    try {
      setResourceBars(this);
    } catch (_e) { /* no-op */ }
  }

  /**
   * Per-part listener registration (called for each re-rendered part).
   * Replaces the monolithic _onRender approach — non-click listeners are
   * scoped to the specific part that was re-rendered. data-action click
   * handlers use event delegation and require no re-binding.
   * @override
   */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);

    if (partId === "sidebar") {
      // Resource button dialogs (HP / Stamina / Magicka)
      registerResourceButtonHandlers(this, htmlElement);
      return;
    }

    // All tab parts share the same listener registration.
    // querySelectorAll returns empty NodeLists for selectors absent in a
    // given tab, so every listener category can run against every tab safely.
    this._attachTabListeners(htmlElement);
  }

  /**
   * Register non-click event listeners on a tab part's DOM.
   * Called from _attachPartListeners for every non-sidebar part.
   * Selectors that don't match in a given tab silently find 0 elements.
   * @param {HTMLElement} el - The tab part's root element
   */
  _attachTabListeners(el) {
    // Right-click: magic-roll → post spell to chat
    for (const magicEl of el.querySelectorAll(".magic-roll")) {
      magicEl.addEventListener("contextmenu", async (ev) => {
        ev.preventDefault();
        await postItemToChat(ev, this.document, { includeImage: true });
      });
    }

    // Right-click: item-name → duplicate item
    for (const nameEl of el.querySelectorAll(".item-name")) {
      nameEl.addEventListener("contextmenu", (ev) => {
        const li = ev.currentTarget?.closest?.(".item");
        const itemId = li?.dataset?.itemId;
        if (!itemId) return;
        const item = this.document.items.get(itemId);
        if (item) this._duplicateItem(item);
      });
    }

    // Right-click: minusQty (same button as plusQty, contextmenu variant)
    for (const btn of el.querySelectorAll(".minusQty")) {
      btn.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        this._onMinusQty(ev, ev.currentTarget);
      });
    }

    // Change: attack tracker input
    for (const input of el.querySelectorAll(".uesrpg-attack-input")) {
      input.addEventListener("change", (ev) => this._onAttackTrackerInputChange(ev));
    }

    // Input: debounced item search
    const searchInput = el.querySelector("#uesrpg-item-search");
    if (searchInput) {
      if (!this._uesrpgDebouncedSearch) {
        this._uesrpgDebouncedSearch = foundry.utils.debounce(
          this._onItemSearch.bind(this), 200
        );
      }
      searchInput.addEventListener("input", this._uesrpgDebouncedSearch);
    }

    // Keyboard: Enter/Space on subtabs and group toggles → synthetic click
    for (const kbd of el.querySelectorAll(".uesrpg-actions-subtab, .uesrpg-group-toggle")) {
      kbd.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          ev.currentTarget?.click?.();
        }
      });
    }
  }

  /* ═══════════════════════ Collapsible Groups ════════════════════════ */

  /* ═══════════════════════ Delegated Handlers ════════════════════════ */

  async _onCombatQuickAction(event, target) { return onCombatQuickAction.call(this, event, target); }
  async _onToggleGroupCollapse(event, target) { return onToggleGroupCollapse(this, event, target); }
  _onItemSearch(event) { return onItemSearch(this, event); }
  async _onLoadoutSave(event) { return onLoadoutSave(this, event); }
  async _onLoadoutApply(event) { return onLoadoutApply(this, event); }
  async _onLoadoutDelete(event) { return onLoadoutDelete(this, event); }
  async _onSetBaseCharacteristics(event, target) { return onSetBaseCharacteristics.call(this, event, target); }
  async _onClickCharacteristic(event, target) { return onClickCharacteristic.call(this, event, target); }
  async _onSkillRoll(event, target) { return onSkillRoll.call(this, event, target); }
  async _onSpellRoll(event, target) { return onSpellRoll.call(this, event, target); }
  async _onCombatRoll(event, target) { return onCombatRoll.call(this, event, target); }
  async _onResistanceRoll(event, target) { return onResistanceRoll.call(this, event, target); }
  async _onDamageRoll(event, target) { return onDamageRoll.call(this, event, target); }
  async _onCastMagicAction(event, target, preselectedSpell = null) { return onCastMagicAction.call(this, event, target, preselectedSpell); }

  async _onEditPortrait(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!this.isEditable) return;

    const current = String(this.document?.img ?? "");
    const picker = new FilePicker({
      type: "imagevideo",
      current,
      callback: async (path) => {
        if (!path || path === current) return;
        await requestUpdateDocument(this.document, { img: path });
      },
    });
    await picker.browse();
  }

  /* ————— New action-map handlers (extracted from inline closures) ————— */


  /** Post item (trait/talent/power) to chat on image click */
  async _onPostItemToChat(event, target) {
    event.preventDefault();
    event.stopPropagation();
    await postItemToChat(event, this.document, { includeImage: true, element: target });
  }

  /** Copy Feature Inspector debug JSON to clipboard */
  _onFeatureInspectorCopy(event, target) {
    event.preventDefault();
    const json = target?.dataset?.json ?? "[]";
    navigator.clipboard.writeText(json).then(() => {
      ui.notifications?.info?.("Feature Inspector data copied to clipboard.");
    }).catch((err) => {
      console.warn("uesrpg | Failed to copy feature inspector data", err);
    });
  }

  /** Open item sheet on name click */
  _onItemOpen(event, target) {
    const li = target?.closest?.(".item");
    const itemId = li?.dataset?.itemId;
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (item?.sheet) item.sheet.render(true);
  }

  /** Delete inventory item (container-safe unlink + delete) */
  async _onItemDelete(event, target) {
    const li = target?.closest?.(".item");
    const itemId = li?.dataset?.itemId;
    if (!itemId) return;
    const itemToDelete = this.document.items.get(itemId)
      ?? this.document.items.find(i => i?._id == itemId);
    if (!itemToDelete) return;
    if (itemToDelete.type === "container") {
      await unlinkAllItemsFromContainer(this.document, itemToDelete);
    } else {
      await unlinkItemFromContainer(this.document, itemToDelete);
    }
    await requestDeleteEmbeddedDocuments(this.document, "Item", [itemId]);
  }

  /** Open container sheet from backpack icon */
  _onOpenContainer(event, target) {
    const containerId = target?.dataset?.containerId;
    if (!containerId) return;
    const containerItem = this.document.items.get(containerId);
    if (containerItem?.sheet) containerItem.sheet.render(true);
  }

  async _onCancelSpell(event, target) {
    event.preventDefault();
    const effectId = target?.dataset?.effectId;
    if (!effectId) return;
    const effect = this.document.effects?.get(effectId);
    if (!effect) return;
    const confirmed = await confirmDialog({
      title: "Cancel Spell",
      content: `<p>Cancel <strong>${effect.flags?.["uesrpg-3ev4"]?.spellName ?? effect.name}</strong>? This will end the spell and remove all linked effects.</p>`,
    });
    if (confirmed) await cancelOriginAEUpkeep(effect);
  }

  async _onAmmoRoll(event, target) {
    event.preventDefault();
    const li = target?.closest?.(".item");
    const item = this.document.getEmbeddedDocument("Item", li?.dataset?.itemId);
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
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });

    const newQty = Math.max(currentQty - 1, 0);
    await requestUpdateDocument(item, { "system.quantity": newQty });

    if (newQty === 0) ui.notifications.info("Out of Ammunition!");
  }

  async _onToggle2H(event, target) { return onToggle2H.call(this, event, target); }
  async _onPlusQty(event, target) { return onPlusQty.call(this, event, target); }
  async _onMinusQty(event, target) { return onMinusQty.call(this, event, target); }
  async _onItemEquip(event, target) { return onItemEquip.call(this, event, target); }
  async _onItemCreate(event, target) { return onItemCreate(this, event, { target }); }

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
      await AttackTracker.setAttackLimitOverride(this.document, value);
      return;
    }
    await AttackTracker.setCurrentAttacks(this.document, value);
  }

  async _duplicateItem(item) {
    if (item?.type === "talent" && this.document?.type === "Player Character") {
      const validation = validateTalentLearning(this.document, item.toObject(), { source: "duplicate" });
      if (validation.mode === TALENT_LEARNING_MODE.WARN) {
        notifyTalentLearningResult(validation);
      }
      if (validation.mode === TALENT_LEARNING_MODE.ENFORCE && !validation.ok) {
        notifyTalentLearningResult(validation, { force: true });
        return;
      }
    }

    const confirmed = await confirmDialog({
      title: "Duplicate Item",
      content: `<div style="padding: 10px; display: flex; flex-direction: row; align-items: center; justify-content: center;"><div>Duplicate Item?</div></div>`,
    });
    if (confirmed) {
      const created = await requestCreateEmbeddedDocuments(this.document, "Item", [item.toObject()]);
      await created?.[0]?.sheet?.render?.(true);
    }
  }

  async _onWealthCalc(event, target) { return onWealthCalc.call(this, event, target); }
  async _onCarryBonus(event, target) { return onCarryBonus.call(this, event, target); }
  _onLuckyMenu(event, target) { return onLuckyMenu.call(this, event, target); }
  async _onBurnLuck(_event, _target) {
    const { openBurnLuckFromSheet } = await import("../../../core/luck/luck-workflow.js");
    return openBurnLuckFromSheet(this.document);
  }
  async _onRaceMenu(event, target) { return onRaceMenu.call(this, event, target); }
  async _onBirthSignMenu(event, target) { return onBirthSignMenu.call(this, event, target); }
  async _onOpenLanguageSelector(event, target) {
    event?.preventDefault?.();
    await LanguageSelectorAppV2.prompt(this.document);
  }
  async _onOpenFactionSelector(event, target) {
    event?.preventDefault?.();
    await FactionSelectorAppV2.prompt(this.document);
  }
  _onXPMenu(event, target) { return onXPMenu.call(this, event, target); }
  async _onIncrementResource(event, target) { return onIncrementResource.call(this, event, target); }
  async _onResetResource(event, target) { return onResetResource.call(this, event, target); }
  async _onIncrementFatigue(event, target) { return onIncrementFatigue.call(this, event, target); }
  async _onShortRest(event, target) { return onShortRest.call(this, event, target); }
  async _onLongRest(event, target) { return onLongRest.call(this, event, target); }

  /* ═══════════════════════ Drag & Drop ═══════════════════════════════ */

  /** @override */
  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);

    if (data.type === "Item") {
      const item = await resolveDroppedItem(data);
      if (!item) {
        console.debug?.("UESRPG | PC sheet received unresolved item drop payload", {
          actor: this.document?.uuid,
          data,
        });
      }

      // Talent learning preflight for external drops onto PC sheet.
      if (
        item &&
        this.document?.type === "Player Character" &&
        item.type === "talent" &&
        item.actor?.id !== this.document.id
      ) {
        const validation = validateTalentLearning(this.document, item.toObject(), { source: "drop" });
        if (validation.mode === TALENT_LEARNING_MODE.WARN) {
          notifyTalentLearningResult(validation);
        }
        if (validation.mode === TALENT_LEARNING_MODE.ENFORCE && !validation.ok) {
          notifyTalentLearningResult(validation, { force: true });
          return;
        }
      }
    }

    return super._onDrop(event);
  }

  /* ═══════════════════════ Active Effects ════════════════════════════ */

  async _onEffectControl(event, target) {
    event.preventDefault();
    if (!target || !target.dataset) return;

    const action = target.dataset.effectAction;
    const effectId = target.dataset.effectId;
    if (!action) return;
    if (!this.document || !this.document.effects) return;

    if (action === "create") {
      const effectData = {
        name: "New Effect",
        img: "icons/svg/aura.svg",
        changes: [],
        disabled: false,
        transfer: false,
        duration: {},
      };
      const created = await requestCreateEmbeddedDocuments(this.document, "ActiveEffect", [effectData]);
      const eff = created?.[0] ?? null;
      if (eff?.sheet) eff.sheet.render(true);
      return;
    }

    const effect = this.document.effects.get(effectId);
    if (!effect) return;

    switch (action) {
      case "edit":
        if (effect.sheet) effect.sheet.render(true);
        break;
      case "delete":
        await requestDeleteEmbeddedDocuments(this.document, "ActiveEffect", [effectId]);
        break;
      case "toggle":
        await requestUpdateDocument(effect, { disabled: !effect.disabled });
        break;
      default:
        break;
    }
  }
}
