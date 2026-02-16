/**
 * src/ui/sheets/v2/npc-sheet.js
 *
 * ApplicationV2 NPC Sheet.
 *
 * Key improvements:
 * - Uses HandlebarsApplicationMixin(ActorSheetV2) base
 * - Native AppV2 lifecycle (_preRender / _onRender / _configureRenderOptions)
 * - Fixes dual-registration of resource handlers — all resource/rest/fatigue
 *   operations now route exclusively through shared/ui/resources.js which
 *   uses requestUpdateDocument (authority-proxy safe).
 * - Limited view via dedicated template PART, selected dynamically.
 * - Delegates to existing shared handler modules for rolls, combat, magic, & inventory.
 */

import { prepareCharacterItems } from "../sheet-prepare-items.js";
import { applyCollapsedGroups } from "../shared/helpers/collapsed-group-dom.js";
import { postItemToChat } from "../shared-handlers.js";
import { unlinkAllItemsFromContainer, unlinkItemFromContainer } from "../sheet-containers.js";
import { requestUpdateDocument, requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { confirmDialog } from "../../../utils/dialog-v2-helper.js";
import { resolveDroppedItem } from "../../../utils/drop-data.js";
import { AttackTracker } from "../../../core/combat/attack-tracker.js";
import { SYSTEM_ID } from "../../../core/combat/combat-style-utils.js";

// Shared roll handlers
import { onSkillRoll, onCombatRoll, onDamageRoll } from "../shared/listeners/rolls.js";
import { onCastMagicAction, castAttackSpell, showSpellOptionsDialog } from "../shared/listeners/magic-cast.js";
import { onCombatQuickAction } from "../shared/listeners/combat-actions.js";

// Shared characteristics
import { onSetBaseCharacteristics, onClickCharacteristic } from "../shared/listeners/characteristics-handlers.js";

// Shared inventory / economy
import { onToggle2H, onPlusQty, onMinusQty, onItemEquip } from "../shared/listeners/inventory-handlers.js";
import { onWealthCalc, onCarryBonus } from "../shared/listeners/economy-handlers.js";

// Shared UI-state handlers (collapse, search, loadouts, item create)
import { onToggleGroupCollapse, onItemSearch, onLoadoutSave, onLoadoutApply, onLoadoutDelete } from "../shared/helpers/ui-state-handlers.js";
import { onItemCreate } from "../shared/dialogs/equipment-dialogs.js";

// Shared resource / rest handlers — authority-proxy safe
import {
  onIncrementResource,
  onResetResource,
  onShortRest,
  onLongRest,
  onIncrementFatigue,
  setResourceBars,
} from "../shared/ui/resources.js";

// Resource button dialog handlers (consolidated)
import { registerResourceButtonHandlers } from "../shared/listeners/resource-button-handlers.js";
import { buildFeatureInspectorContext } from "../shared/feature-inspector.js";
import { MagicOpposedWorkflow } from "../../../core/magic/opposed-workflow.js";
import { LanguageSelectorAppV2, FactionSelectorAppV2 } from "../../apps/v2/social-selectors.js";
import { buildSocialDisplay } from "../../../core/social/social-data.js";



// NPC prepare / context helpers
import {
  buildCombatQuickContext,
  buildCombatActionsContext,
  applyDefensiveStanceDisabling,
  buildSheetUiState,
  enrichBiography,
} from "../shared/prepare.js";

// NPC UI filter helpers (createStatusTags targets fixed-header wound/fatigue icons)
import { createStatusTags } from "../npc/ui/filters.js";

// NPC professions-roll dependencies
import { requireUserCanRollActor } from "../../../utils/permissions.js";
import { doTestRoll, formatDegree } from "../../../utils/degree-roll-helper.js";
import { applyKeenIntuitionToResult, applyHyperAwarenessToResult } from "../../../core/traits/awareness-talents.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "../../../core/skills/skill-tn.js";
import { SkillOpposedWorkflow } from "../../../core/skills/opposed-workflow.js";
import { buildResistanceBonusSection, readResistanceBonusSelections, buildResistanceBonusMods } from "../../../core/traits/trait-resistance-ui.js";

// Spell routing
import { getUserSpellTargets, shouldUseTargetedSpellWorkflow, shouldUseModernSpellWorkflow, debugMagicRoutingLog } from "../../../core/magic/spell-runtime.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ActorSheetV2Base = foundry.applications.sheets.ActorSheetV2;

export class NpcSheetV2 extends HandlebarsApplicationMixin(ActorSheetV2Base) {

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
    classes: ["worldbuilding", "sheet", "actor", "npc"],
    position: { width: 858, height: 930 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      // NPC-specific rolls
      professionsRoll: NpcSheetV2.prototype._onProfessionsRoll,
      magicRoll: NpcSheetV2.prototype._onMagicSkillRoll,

      // Shared rolls & combat
      castMagic: NpcSheetV2.prototype._onCastMagicAction,
      damageRoll: NpcSheetV2.prototype._onDamageRoll,
      ammoRoll: NpcSheetV2.prototype._onAmmoRoll,
      skillRoll: NpcSheetV2.prototype._onSkillRoll,
      combatRoll: NpcSheetV2.prototype._onCombatRoll,
      combatQuickAction: NpcSheetV2.prototype._onCombatQuickAction,

      // Characteristics (from fixed-header)
      characteristicsConfig: NpcSheetV2.prototype._onSetBaseCharacteristics,
      characteristicRoll: NpcSheetV2.prototype._onClickCharacteristic,
      editPortrait: NpcSheetV2.prototype._onEditPortrait,

      // Resources (from fixed-header + npc-sheet)
      incrementResource: NpcSheetV2.prototype._onIncrementResource,
      restoreResource: NpcSheetV2.prototype._onResetResource,
      incrementFatigue: NpcSheetV2.prototype._onIncrementFatigue,
      shortRest: NpcSheetV2.prototype._onShortRest,
      longRest: NpcSheetV2.prototype._onLongRest,
      burnLuck: NpcSheetV2.prototype._onBurnLuck,
      openLanguageSelector: NpcSheetV2.prototype._onOpenLanguageSelector,
      openFactionSelector: NpcSheetV2.prototype._onOpenFactionSelector,

      // Inventory
      toggle2H: NpcSheetV2.prototype._onToggle2H,
      plusQty: NpcSheetV2.prototype._onPlusQty,
      itemEquip: NpcSheetV2.prototype._onItemEquip,
      itemCreate: NpcSheetV2.prototype._onItemCreate,
      itemOpen: NpcSheetV2.prototype._onItemOpen,
      itemDelete: NpcSheetV2.prototype._onItemDelete,
      openContainer: NpcSheetV2.prototype._onOpenContainer,

      // Economy
      wealthCalc: NpcSheetV2.prototype._onWealthCalc,
      carryBonus: NpcSheetV2.prototype._onCarryBonus,

      // UI state
      groupToggle: NpcSheetV2.prototype._onToggleGroupCollapse,
      loadoutSave: NpcSheetV2.prototype._onLoadoutSave,
      loadoutApply: NpcSheetV2.prototype._onLoadoutApply,
      loadoutDelete: NpcSheetV2.prototype._onLoadoutDelete,

      // Effects
      effectControl: NpcSheetV2.prototype._onEffectControl,

      // Chat / Inspector
      postItemToChat: NpcSheetV2.prototype._onPostItemToChat,
      featureInspectorCopy: NpcSheetV2.prototype._onFeatureInspectorCopy,
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
      template: "systems/uesrpg-3ev4/templates/v2/sheets/npc/tab-core.hbs",
      templates: [
        "systems/uesrpg-3ev4/templates/partials/sheets/feature-inspector.hbs",
      ],
      scrollable: [""],
    },
    combat: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/npc/tab-combat.hbs",
      scrollable: [""],
    },
    magic: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/npc/tab-magic.hbs",
      scrollable: [""],
    },
    equipment: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/npc/tab-equipment.hbs",
      scrollable: [""],
    },
    limited: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/limited-npc-sheet.hbs",
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
   * V1 compat: filter modules + `setResourceBars()` access `sheet.form`.
   * In AppV2 `this.element` IS the <form>.
   */
  get form() {
    return this.element;
  }

  /* ═══════════════════════ Render Options ════════════════════════════ */

  /** @override — select limited vs full template PARTS */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    if (this.document.limited) {
      options.parts = ["limited"];
    } else {
      options.parts = ["sidebar", "core", "combat", "magic", "equipment"];
    }
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

    // Limited view: enriched bio only
    if (actor.limited) {
      context.actor.system.enrichedBio = await enrichBiography(
        context.actor.system?.bio ?? "", this
      );
      context.actor.system.socialDisplay = buildSocialDisplay(context.actor.system);
      return context;
    }

    // Item categorization — V2 does not auto-populate context.items like V1 getData()
    // Overlay live system data so derived fields (*Effective, damage3, etc.)
    // survive into templates — mirrors the actor-level overlay above.
    context.items = actor.items.map(i => {
      const obj = i.toObject();
      obj.system = i.system;
      return obj;
    });
    prepareCharacterItems(context, { includeSkills: false, includeMagicSkills: false });

    // Combat tab contexts
    context.actor.sheetCombatQuick = buildCombatQuickContext(context.actor);
    context.actor.sheetCombatActions = buildCombatActionsContext(actor);
    context.actor.attackTrackerUi = {
      current: AttackTracker.getAttackCount(actor),
      max: AttackTracker.getAttackLimit(actor),
      overrides: AttackTracker.getOverrides(actor),
    };
    applyDefensiveStanceDisabling(actor, context.actor.sheetCombatQuick);

    // Per-user UI state
    context.sheetUi = await buildSheetUiState(actor);

    // Enriched biography
    const bio = context.actor.system?.bio ?? "";
    context.actor.system.enrichedBio = await enrichBiography(bio, this);
    context.actor.system.socialDisplay = buildSocialDisplay(context.actor.system);

    // Active Effects (Effects tab)
    context.effects = actor.effects
      ? actor.effects.contents.map(e => e.toObject())
      : [];

    // Feature Inspector
    if (game.settings.get("uesrpg-3ev4", "showFeatureInspector")) {
      try {
        context.featureInspector = buildFeatureInspectorContext(actor);
      } catch (_e) {
        context.featureInspector = null;
      }
    } else {
      context.featureInspector = null;
    }

    return context;
  }

  /* ═══════════════════════ Render Lifecycle ═══════════════════════ */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    if (!el) return;

    // Limited view: no interactive listeners
    if (this.document.limited) return;

    // ── Tab handling (native AppV2) ───────────────────────────────
    this.changeTab(this.tabGroups.primary ?? "core", "primary", { force: true });
    this.changeTab(this.tabGroups.actions ?? "primary", "actions", { force: true });

    // ── Collapsible groups (async — fire and forget) ──────────────
    applyCollapsedGroups(el);

    // ── Resource bars (DOM cosmetic — reads across both parts) ────
    try {
      setResourceBars(this);
    } catch (_e) { /* no-op */ }

    // ── NPC status tags (wound/fatigue icons in fixed-header) ─────
    createStatusTags(this);
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

    // All tab parts share the same listener set; selectors absent
    // from a given tab simply yield empty NodeLists (no-op).
    this._attachTabListeners(htmlElement);
  }

  /**
   * Attach non-click listeners shared across all tab PARTS.
   * Called once per tab part per render cycle.
   * @param {HTMLElement} el – the root element of the rendered part
   */
  _attachTabListeners(el) {
    // Right-click: magic-roll → NPC spell description to chat
    for (const magicEl of el.querySelectorAll(".magic-roll")) {
      magicEl.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        this._postSpellDescriptionToChat(ev);
      });
    }

    // Right-click: item-name → duplicate item
    for (const nameEl of el.querySelectorAll("[data-action='itemOpen'].item-name")) {
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

    // Change: active combat style select (NPC-only)
    const styleSelect = el.querySelector(".uesrpg-active-combat-style");
    if (styleSelect) {
      styleSelect.addEventListener("change", (ev) => this._onActiveCombatStyleChange(ev));
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

    // Keyboard: Enter/Space on subtabs, group toggles, and characteristics config → synthetic click
    for (const kbd of el.querySelectorAll(".uesrpg-actions-subtab, .uesrpg-group-toggle, .characteristics-config")) {
      kbd.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          ev.currentTarget?.click?.();
        }
      });
    }
  }

  /* ═══════════════════════ Delegated Handlers ════════════════════════ */

  // Combat
  async _onCombatQuickAction(event, target) { return onCombatQuickAction.call(this, event, target); }
  async _onToggleGroupCollapse(event, target) { return onToggleGroupCollapse(this, event, target); }
  _onItemSearch(event) { return onItemSearch(this, event); }
  async _onLoadoutSave(event) { return onLoadoutSave(this, event); }
  async _onLoadoutApply(event) { return onLoadoutApply(this, event); }
  async _onLoadoutDelete(event) { return onLoadoutDelete(this, event); }

  // Characteristics
  async _onSetBaseCharacteristics(event, target) { return onSetBaseCharacteristics.call(this, event, target); }
  async _onClickCharacteristic(event, target) { return onClickCharacteristic.call(this, event, target); }
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

  // Rolls
  async _onCombatRoll(event, target) { return onCombatRoll.call(this, event, target); }
  async _onSkillRoll(event, target) { return onSkillRoll.call(this, event, target); }
  async _onDamageRoll(event, target) { return onDamageRoll.call(this, event, target); }

  // Magic
  async _onCastMagicAction(event, target, preselectedSpell = null) { return onCastMagicAction.call(this, event, target, preselectedSpell); }
  async _showSpellOptionsDialog(spell) { return showSpellOptionsDialog(this.document, spell); }
  async _castAttackSpell(spell, targets, spellOptions = {}, castActionType = "primary", opts = {}) {
    return castAttackSpell(this, spell, targets, spellOptions, castActionType, opts);
  }

  // Inventory
  async _onToggle2H(event, target) { return onToggle2H.call(this, event, target); }
  async _onPlusQty(event, target) { return onPlusQty.call(this, event, target); }
  async _onMinusQty(event, target) { return onMinusQty.call(this, event, target); }
  async _onItemEquip(event, target) { return onItemEquip.call(this, event, target); }
  async _onItemCreate(event, target) {
    return onItemCreate(this, event, {
      baseCha: null,
      includeCombatStyleSeed: true,
      includeMagicSkillSeed: false,
      target,
    });
  }

  // Economy
  async _onWealthCalc(event, target) { return onWealthCalc.call(this, event, target); }
  async _onCarryBonus(event, target) { return onCarryBonus.call(this, event, target); }

  // Item / UI operations (actions-map dispatched)

  /** Post item (trait/talent/power) to chat on image click */
  async _onPostItemToChat(event, target) {
    event.preventDefault();
    event.stopPropagation();
    await postItemToChat(event, this.document, { includeImage: false, element: target });
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

  /** Open item sheet on name/image click */
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

  /** Duplicate an item after user confirmation */
  async _duplicateItem(item) {
    const confirmed = await confirmDialog({
      title: "Duplicate Item",
      content: `<div style="padding: 10px; display: flex; flex-direction: row; align-items: center; justify-content: center;"><div>Duplicate Item?</div></div>`,
    });
    if (confirmed) {
      const created = await requestCreateEmbeddedDocuments(this.document, "Item", [item.toObject()]);
      await created?.[0]?.sheet?.render?.(true);
    }
  }

  /** Active combat style dropdown change (native DOM, non-actions-map) */
  async _onActiveCombatStyleChange(event) {
    if (!this.isEditable) return;
    const v = String(event?.currentTarget?.value ?? "").trim();
    try {
      await requestUpdateDocument(this.document, { "flags.uesrpg-3ev4.activeCombatStyleId": v || "" });
      this.render(false);
    } catch (err) {
      console.error("UESRPG | Failed to update active combat style", { actor: this.document?.uuid, err });
      ui.notifications?.error?.("Failed to update active combat style");
    }
  }

  // Resources — routed through shared module (authority-proxy safe)
  async _onIncrementResource(event, target) { return onIncrementResource.call(this, event, target); }
  async _onResetResource(event, target) { return onResetResource.call(this, event, target); }
  async _onIncrementFatigue(event, target) { return onIncrementFatigue.call(this, event, target); }
  async _onShortRest(event, target) { return onShortRest.call(this, event, target); }
  async _onLongRest(event, target) { return onLongRest.call(this, event, target); }
  async _onBurnLuck(_event, _target) {
    const { openBurnLuckFromSheet } = await import("../../../core/luck/luck-workflow.js");
    return openBurnLuckFromSheet(this.document);
  }
  async _onOpenLanguageSelector(event, target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    await LanguageSelectorAppV2.prompt(this.document);
  }
  async _onOpenFactionSelector(event, target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    await FactionSelectorAppV2.prompt(this.document);
  }

  // Status tags (wound/fatigue icons in fixed-header)
  _createStatusTags() { return createStatusTags(this); }

  /* ═══════════════════════ NPC-Specific Handlers ════════════════════ */

  /**
   * Magic skill roll — routes spell click to the modern casting engine.
   */
  async _onMagicSkillRoll(event, target) {
    event.preventDefault();
    const button = target ?? event.currentTarget;
    const li = button.closest(".item");
    const spell = li ? this.document.items.get(li.dataset.itemId) : null;
    if (!spell) {
      ui.notifications.warn("Spell not found.");
      return;
    }
    await this._onCastMagicAction(event, null, spell);
  }

  /**
   * Right-click spell icon → post description to chat (NPC format).
   */
  async _postSpellDescriptionToChat(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const li = button.closest(".item");
    const spell = li ? this.document.items.get(li.dataset.itemId) : null;
    if (!spell) {
      ui.notifications.warn("Spell not found.");
      return;
    }

    const contentString = `<h2>${spell.name}</h2><p>
    <i><b>Spell (${spell.system.school} L${spell.system.level}, ${spell.system.cost} MP)</b></i><p>
      <i>${spell.system.description || "No description available."}</i>`;

    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      content: contentString,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
  }

  /**
   * Legacy spell roll routing (favorites/hotkeys).
   * Routes through targeted/modern pipelines as appropriate.
   */
  async _onSpellRoll(event) {
    let spellToCast;

    if (event.currentTarget?.closest?.(".item")) {
      spellToCast = this.document.items.get(
        event.currentTarget.closest(".item").dataset.itemId
      );
    } else {
      const fav = this.document.system?.favorites?.[event.currentTarget.dataset.hotkey];
      spellToCast = this.document.getEmbeddedDocument?.("Item", fav?.id);
    }

    const targets = getUserSpellTargets();
    debugMagicRoutingLog({ source: "NpcSheetV2._onSpellRoll", actor: this.document, spell: spellToCast, targets });

    if (shouldUseTargetedSpellWorkflow(spellToCast, targets)) {
      const spellOptions = await this._showSpellOptionsDialog(spellToCast);
      if (spellOptions === null) return;
      await this._castAttackSpell(spellToCast, targets, spellOptions, "primary");
      return;
    }

    if (shouldUseModernSpellWorkflow(spellToCast)) {
      const spellOptions = await this._showSpellOptionsDialog(spellToCast);
      if (spellOptions === null) return;
      await MagicOpposedWorkflow.castUnopposed({
        attackerActorUuid: this.document.uuid,
        attackerTokenUuid: this.token?.document?.uuid ?? this.token?.uuid ?? null,
        spellUuid: spellToCast.uuid,
        spellOptions,
        castActionType: "primary",
      });
      return;
    }
    // Legacy spell casting removed — all spells now use modern pipeline
  }

  /**
   * NPC professions roll handler (~150 lines).
   * Supports targeted (opposed) and untargeted (simple TN) workflows.
   */
  async _onProfessionsRoll(event, target) {
    event.preventDefault();

    if (!requireUserCanRollActor(game.user, this.document)) return;

    const button = target ?? event.currentTarget;
    let profKey = null;

    if (button && typeof button.closest === "function") {
      const li = button.closest(".item");
      profKey = li?.dataset?.professionKey ?? li?.dataset?.itemId;
    }
    if (!profKey && button) {
      profKey = button.id ?? button.dataset?.professionKey ?? button.dataset?.itemId;
    }
    if (!profKey) {
      profKey = event?.data?.professionKey ?? event?.data?.itemId ?? target?.id ?? null;
    }
    if (!profKey) {
      ui.notifications.warn("Profession not found.");
      return;
    }

    const profValue = Number(this.document.system?.professions?.[profKey] ?? 0);

    let profLabel = profKey;
    if (["profession1", "profession2", "profession3"].includes(profKey)) {
      const spec = String(this.document.system?.skills?.[profKey]?.specialization ?? "").trim();
      profLabel = spec || profKey.replace("profession", "Profession ");
    } else {
      profLabel = profKey.charAt(0).toUpperCase() + profKey.slice(1);
    }

    const profUuid = `prof:${profKey}`;

    // ── Targeted → Opposed Workflow ──
    const targets = [...(game.user.targets ?? [])];
    if (targets.length > 0) {
      const attackerToken =
        canvas?.tokens?.controlled?.find(t => t.actor?.id === this.document.id) ??
        this.document.getActiveTokens?.()?.[0] ??
        null;

      if (!attackerToken) {
        ui.notifications.warn("No attacker token found on the canvas. Select your token and try again.");
        return;
      }

      for (const defenderToken of targets) {
        const msg = await SkillOpposedWorkflow.createPending({
          attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
          defenderTokenUuid: defenderToken.document?.uuid ?? defenderToken.uuid,
          attackerActorUuid: this.document.uuid,
          defenderActorUuid: defenderToken.actor?.uuid ?? null,
          attackerSkillUuid: profUuid,
          attackerSkillLabel: profLabel,
        });

        const quickShift = Boolean(event.shiftKey) && game.settings.get("uesrpg-3ev4", "skillRollQuickShift");
        if (msg && quickShift) {
          await SkillOpposedWorkflow.handleAction(msg, "attacker-roll", { event });
        }
      }
      return;
    }

    // ── Untargeted → Simple Profession Roll ──
    const resistanceSection = buildResistanceBonusSection(this.document);

    const difficultyOptions = SKILL_DIFFICULTIES.map(d => {
      const selected = d.key === "average" ? "selected" : "";
      const sign = d.mod >= 0 ? "+" : "";
      return `<option value="${d.key}" ${selected}>${d.label} (${sign}${d.mod})</option>`;
    }).join("\n");

    const dialogContent = `
      <div class="uesrpg-skill-roll">
        <div class="form-group">
          <label><b>Difficulty</b></label>
          <select name="difficultyKey" style="width:100%;">${difficultyOptions}</select>
        </div>
        <div class="form-group" style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <label style="margin:0;"><b>Manual Modifier</b></label>
          <input name="manualMod" type="number" value="0" style="width:120px;" />
        </div>
        ${resistanceSection.html}
      </div>`;

    let decl = null;
    try {
      decl = await customDialog({
        title: `${profLabel} — Roll Options`,
        content: dialogContent,
        buttons: {
          ok: {
            label: "Roll",
            callback: (html) => {
              const root = html instanceof HTMLElement ? html : html?.[0];
              const difficultyKey = root?.querySelector('select[name="difficultyKey"]')?.value ?? "average";
              const rawManual = root?.querySelector('input[name="manualMod"]')?.value ?? "0";
              const manualMod = Number.parseInt(String(rawManual), 10) || 0;
              const selectedRes = readResistanceBonusSelections(root, resistanceSection.options);
              return { difficultyKey, manualMod, resistanceSelected: selectedRes };
            },
          },
          cancel: { label: "Cancel", callback: () => null },
        },
        default: "ok",
        width: 420
      });
    } catch (_e) {
      return;
    }
    if (!decl) return;

    const resMods = buildResistanceBonusMods(decl.resistanceSelected ?? []);
    const resBonus = resMods.reduce((sum, m) => sum + Number(m.value ?? 0), 0);
    const situationalMods = [...resMods];

    const profSkillItem = {
      name: profLabel,
      type: "profession",
      system: { value: profValue },
      _professionKey: profKey,
    };
    const tn = computeSkillTN({
      actor: this.document,
      skillItem: profSkillItem,
      difficultyKey: decl.difficultyKey,
      manualMod: decl.manualMod,
      situationalMods,
    });

    // Build tags
    const tags = [];
    if (Number(this.document.system?.woundPenalty ?? 0) !== 0) {
      tags.push(`<span class="tag wound-tag">Wounded ${this.document.system.woundPenalty}</span>`);
    }
    if (this.document.system.fatigue.penalty != 0) {
      tags.push(`<span class="tag fatigue-tag">Fatigued ${this.document.system.fatigue.penalty}</span>`);
    }
    if (this.document.system.carry_rating.penalty != 0) {
      tags.push(`<span class="tag enc-tag">Encumbered ${this.document.system.carry_rating.penalty}</span>`);
    }

    const armorMods = (tn.breakdown ?? []).filter(b => String(b.label || "").startsWith("Armor:") && Number(b.value) !== 0);
    for (const m of armorMods) {
      const v = Number(m.value) || 0;
      tags.push(`<span class="tag armor-tag">${m.label} ${v}</span>`);
    }

    if (tn?.difficulty?.mod) tags.push(`<span class="tag">${tn.difficulty.label} ${tn.difficulty.mod >= 0 ? "+" : ""}${tn.difficulty.mod}</span>`);
    if (decl.manualMod) tags.push(`<span class="tag">Mod ${decl.manualMod >= 0 ? "+" : ""}${decl.manualMod}</span>`);
    if (resBonus) {
      const labels = resMods.map(m => m.label).join(", ");
      tags.push(`<span class="tag">Resistance Bonus ${resBonus >= 0 ? "+" : ""}${resBonus}${labels ? ` (${labels})` : ""}</span>`);
    }

    const result = await doTestRoll(this.document, {
      target: tn.finalTN,
      allowLucky: true,
      allowUnlucky: true,
    });

    await applyKeenIntuitionToResult(this.document, profLabel, result, { allowPrompt: true });
    await applyHyperAwarenessToResult(this.document, profLabel, result, { allowPrompt: true });

    const degreeLine = result.isSuccess
      ? `<b style="color:green;">SUCCESS — ${formatDegree(result)}</b>`
      : `<b style="color:rgb(168, 5, 5);">FAILURE — ${formatDegree(result)}</b>`;

    const breakdownRows = (tn.breakdown ?? []).map(b => {
      const v = Number(b.value ?? 0);
      const sign = v >= 0 ? "+" : "";
      return `<div style="display:flex; justify-content:space-between; gap:10px;"><span>${b.label}</span><span>${sign}${v}</span></div>`;
    }).join("");

    const declaredParts = [];
    if (tn?.difficulty?.label) declaredParts.push(`${tn.difficulty.label} (${tn.difficulty.mod >= 0 ? "+" : ""}${tn.difficulty.mod})`);
    if (decl.manualMod) declaredParts.push(`Mod ${decl.manualMod >= 0 ? "+" : ""}${decl.manualMod}`);

    const flavor = `
      <div>
        <h2 style="margin:0 0 6px 0;">${profLabel}</h2>
        <div><b>Target Number:</b> ${tn.finalTN}</div>
        ${declaredParts.length ? `<div style="margin-top:2px; font-size:12px; opacity:0.85;"><b>Options:</b> ${declaredParts.join("; ")}</div>` : ""}
        <div style="margin-top:4px;">${degreeLine}${result.isCriticalSuccess ? ' <span style="color:green;">(CRITICAL)</span>' : ''}${result.isCriticalFailure ? ' <span style="color:red;">(CRITICAL FAIL)</span>' : ''}</div>
        <details style="margin-top:6px;"><summary style="cursor:pointer; user-select:none;">TN breakdown</summary><div style="margin-top:4px; font-size:12px; opacity:0.9;">${breakdownRows}</div></details>
        <div class="tag-container" style="margin-top:6px;">${tags.join("")}</div>
      </div>`;

    const rollMode = game.settings.get("core", "rollMode");

    const skillTest = {
      actorUuid: this.document.uuid,
      skillUuid: profUuid,
      skillName: profLabel,
      target: tn.finalTN,
      isSuccess: Boolean(result.isSuccess),
      degree: Number(result.degree ?? 0) || 0,
      textual: String(result.textual ?? ""),
    };

    await result.roll.toMessage({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      flavor,
      flags: {
        uesrpg: { skillTest, reroll: { used: false, source: null } },
        "uesrpg-3ev4": { skillTest },
      },
      rollMode,
    });
  }

  /**
   * Ammo roll handler.
   */
  async _onAmmoRoll(event, target) {
    event.preventDefault();
    const button = target ?? event.currentTarget;
    const li = button.closest(".item");
    const item = this.document.getEmbeddedDocument("Item", li?.dataset?.itemId);
    if (!item) return;

    const contentString = `<h2 style='font-size: large;'>${item.name}</h2><p>
      <b>Damage Bonus:</b> ${item.system.damage}<p>
      <b>Qualities</b> ${item.system.qualities}`;

    const currentQty = Number(item.system?.quantity ?? 0);
    if (currentQty > 0) {
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker(),
        content: contentString,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      });
    }

    const newQty = Math.max(currentQty - 1, 0);
    if (newQty === 0 && currentQty > 0) ui.notifications.info("Out of Ammunition!");
    await requestUpdateDocument(item, { "system.quantity": newQty });
  }

  /**
   * Attack tracker input change (GM only).
   */
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

  /* ═══════════════════════ Drag & Drop ═══════════════════════════════ */

  /** @override */
  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);

    if (data.type === "Item") {
      // Resolve once to validate payload shape; base sheet still performs create/move behavior.
      const resolved = await resolveDroppedItem(data);
      if (!resolved) {
        console.debug?.("UESRPG | NPC sheet received unresolved item drop payload", {
          actor: this.document?.uuid,
          data,
        });
      }
    }

    return super._onDrop(event);
  }

  /* ═══════════════════════ Active Effects ════════════════════════════ */

  async _onEffectControl(event, target) {
    event.preventDefault();
    const el = target ?? event.currentTarget;
    if (!el || !el.dataset) return;

    const action = el.dataset.effectAction;
    const effectId = el.dataset.effectId;
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
