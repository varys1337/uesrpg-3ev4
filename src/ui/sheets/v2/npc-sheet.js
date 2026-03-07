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
import { readDropData, resolveDroppedItemDetailed } from "../../../utils/drop-data.js";
import { buildItemDragPayload } from "../../../utils/drag-payload.js";
import { handleExternalItemDrop } from "../../../utils/drop-item-create-data.js";
import { dndDebug, dndWarnFailure, makeDndTraceId } from "../../../utils/dnd-debugger.js";
import { onDropItemIntoContainer } from "../item/listeners/containment.js";
import { AttackTracker } from "../../../core/combat/attack-tracker.js";
import { buildEncumbranceBreakdown } from "../../../core/actors/rules/item-aggregation.js";

// Shared roll handlers
import { onSkillRoll, onCombatRoll, onDamageRoll } from "../shared/listeners/rolls.js";
import { onCastMagicAction, castAttackSpell } from "../shared/listeners/magic-cast.js";
import { showSpellOptionsDialog } from "../../../core/magic/dialogs/spell-options-dialog.js";
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
import { MagicOpposedWorkflow } from "../../../core/magic/opposed-workflow.js";
import { isEngagementFlankingHomebrewEnabled } from "../../../core/homebrew/settings.js";
import { buildSocialDisplay } from "../../../core/social/social-data.js";
import { bindItemDescriptionTooltips, clearItemDescriptionTooltip } from "./shared/sheet-tooltips.js";
import { enableItemRowDragSources } from "./shared/drag-sources.js";
import { applySheetDensityClass } from "./shared/sheet-density.js";
import { enableResizeMotionGuard, disableResizeMotionGuard } from "./shared/resize-motion-guard.js";
import { annotateEncumbranceHighlights, openEncumbranceBreakdownDialog } from "./shared/encumbrance-ui.js";
import { openItemRowQuickMenu, handleItemRowContextMenu } from "./shared/item-row-quick-menu.js";
import {
  buildWoundsInjuriesPanelContext,
  isWoundsOrShockEffect,
  onWoundsInjuriesControl
} from "./shared/wounds-injuries-panel.js";
import { activateEditorButtons } from "../shared/editor-activation.js";
import {
  buildEffectsSignature,
  buildWoundsSignature,
  buildCombatSignature,
  buildSheetUiSignature,
} from "./shared/sheet-signatures.js";
import { bindWindowRestoreGuard, warnIfDuplicateSidebar } from "./shared/window-restore-guard.js";



// NPC prepare / context helpers
import {
  buildCombatQuickContext,
  buildCombatActionsContext,
  applyDefensiveStanceDisabling,
  buildSheetUiState,
  enrichBiography,
} from "../shared/prepare.js";


// NPC professions-roll dependencies
import { requireUserCanRollActor } from "../../../utils/permissions.js";
import { doTestRoll, formatDegree } from "../../../utils/degree-roll-helper.js";
import { applyKeenIntuitionToResult, applyHyperAwarenessToResult } from "../../../core/traits/awareness-talents.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "../../../core/skills/skill-tn.js";
import { SkillOpposedWorkflow } from "../../../core/skills/opposed-workflow/index.js";
import { buildResistanceBonusSection, readResistanceBonusSelections, buildResistanceBonusMods } from "../../../core/traits/trait-resistance-ui.js";
import { SYSTEM_ID, templatePath } from "../../constants.js";

// Spell routing
import { getUserSpellTargets, shouldUseTargetedSpellWorkflow, shouldUseModernSpellWorkflow, debugMagicRoutingLog } from "../../../core/magic/spell-runtime.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ActorSheetV2Base = foundry.applications.sheets.ActorSheetV2;

function resolveWeaponDistanceHeaderLabel(weaponBuckets) {
  const equipped = Array.isArray(weaponBuckets?.equipped) ? weaponBuckets.equipped : [];
  const unequipped = Array.isArray(weaponBuckets?.unequipped) ? weaponBuckets.unequipped : [];
  const weapons = [...equipped, ...unequipped];
  if (!weapons.length) return "Distance";

  let hasRanged = false;
  let hasMelee = false;
  for (const weapon of weapons) {
    const mode = String(weapon?.system?.attackMode ?? "").toLowerCase();
    if (mode === "ranged") hasRanged = true;
    else hasMelee = true;
    if (hasRanged && hasMelee) return "Distance";
  }

  if (hasRanged) return "Range";
  if (hasMelee) return "Reach";
  return "Distance";
}

export class NpcSheetV2 extends HandlebarsApplicationMixin(ActorSheetV2Base) {

  /** @type {Function|null} Debounced item search (memoized) */
  _uesrpgDebouncedSearch = null;
  _uesrpgTabContextMenuHandler = null;
  _uesrpgTabChangeHandler = null;
  _uesrpgTabInputHandler = null;
  _uesrpgTabKeydownHandler = null;
  _uesrpgRestoreDblClickHandler = null;
  _uesrpgRestoreDblClickEl = null;

  /** @type {{raw: string, enriched: string}|null} */
  _uesrpgBioCache = null;

  /**
   * Prepared inventory cache to avoid re-building large item arrays on every rerender.
   * @type {{signature: string, items: Array<object>, actorPatch: object}|null}
   */
  _uesrpgItemsCache = null;
  _uesrpgCombatCache = null;
  _uesrpgWoundsUiCache = null;
  _uesrpgEffectsCache = null;
  _uesrpgEncumbranceCache = null;
  _uesrpgSheetUiCache = null;
  _uesrpgRenderPartsRafId = null;
  _uesrpgRenderPartsPromise = null;
  _uesrpgRenderPartsResolvers = [];
  _uesrpgQueuedParts = null;

  /**
   * Build a conservative signature for the Actor's embedded items which changes when
   * anything sheet-relevant is likely to change (equip state, quantity, containment, etc.).
   * Correctness > micro-perf.
   * @param {Actor} actor
   * @returns {string}
   */
  _buildItemsSignature(actor) {
    const sortAlpha = (() => {
      try {
        return Boolean(game?.settings?.get?.(SYSTEM_ID, "sortAlpha"));
      } catch (_e) {
        return false;
      }
    })();

    const npcSchoolRanks = (() => {
      try {
        return actor?.flags?.[SYSTEM_ID]?.npcMagicSchoolRanks ?? null;
      } catch (_e) {
        return null;
      }
    })();

    const parts = [
      actor?.id ?? "",
      actor?.type ?? "",
      sortAlpha ? "A" : "a",
      npcSchoolRanks ? JSON.stringify(npcSchoolRanks) : "",
      String(actor?.items?.size ?? 0),
    ];

    for (const i of actor?.items?.contents ?? []) {
      const cs = i?.system?.containerStats;
      parts.push([
        i?.id ?? "",
        i?.type ?? "",
        i?.name ?? "",
        i?.system?.equipped ? "1" : "0",
        String(i?.system?.quantity ?? ""),
        cs?.contained ? "1" : "0",
        cs?.container_id ?? "",
        i?.system?.school ?? "",
        i?.system?.traitKey ?? "",
        String(i?.system?.traitValue ?? ""),
      ].join("~"));
    }

    return parts.join("|");
  }

  _renderedPartsSet(options) {
    const parts = options?.parts;
    return Array.isArray(parts) && parts.length ? new Set(parts) : null;
  }

  _partRendered(options, part) {
    const rendered = this._renderedPartsSet(options);
    if (!rendered) return true;
    return rendered.has(part);
  }

  _traceSheetPerfPhase(phase, startedAtMs, details = {}) {
    this._traceSheetPerf(`phase:${phase}`, startedAtMs, details);
  }

  async _queueRenderParts(parts = []) {
    if (!Array.isArray(parts) || !parts.length) return;
    if (!this._uesrpgQueuedParts) this._uesrpgQueuedParts = new Set();
    for (const part of parts) this._uesrpgQueuedParts.add(part);

    if (!this._uesrpgRenderPartsPromise) {
      this._uesrpgRenderPartsPromise = new Promise((resolve) => {
        this._uesrpgRenderPartsResolvers.push(resolve);
      });
      this._uesrpgRenderPartsRafId = requestAnimationFrame(async () => {
        const queued = Array.from(this._uesrpgQueuedParts ?? []);
        this._uesrpgQueuedParts = new Set();
        try {
          if (queued.length) await this.render({ parts: queued });
        } finally {
          const resolvers = this._uesrpgRenderPartsResolvers.splice(0);
          for (const resolve of resolvers) resolve();
          this._uesrpgRenderPartsPromise = null;
          this._uesrpgRenderPartsRafId = null;
        }
      });
    }

    return this._uesrpgRenderPartsPromise;
  }

  /**
   * Enrich biography text with a per-sheet cache.
   * @param {string} rawBio
   * @returns {Promise<string>}
   */
  async _getEnrichedBio(rawBio) {
    const raw = String(rawBio ?? "");
    if (this._uesrpgBioCache && this._uesrpgBioCache.raw === raw) {
      return this._uesrpgBioCache.enriched;
    }
    const enriched = await enrichBiography(raw, this);
    this._uesrpgBioCache = { raw, enriched };
    return enriched;
  }

  _isSheetPerfTraceEnabled() {
    try {
      return Boolean(game?.settings?.get?.(SYSTEM_ID, "sheetPerfTrace"));
    } catch (_e) {
      return false;
    }
  }

  _traceSheetPerf(stage, startedAtMs, details = {}) {
    if (!this._isSheetPerfTraceEnabled()) return;
    const elapsedMs = Number((performance.now() - startedAtMs).toFixed(2));
    const payload = {
      sheet: "NpcSheetV2",
      actorId: this.document?.id ?? null,
      actorName: this.document?.name ?? null,
      tab: this.tabGroups?.primary ?? "core",
      stage,
      elapsedMs,
      ...details,
    };
    const warnThresholdMs = stage === "_onClose"
      ? 24
      : stage === "_onRender"
        ? 32
        : stage === "_prepareContext"
          ? 40
          : null;
    const line = `UESRPG | sheetPerfTrace ${JSON.stringify(payload)}`;
    if (warnThresholdMs !== null && elapsedMs > warnThresholdMs) console.warn(line);
    else console.log(line);
  }

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
    classes: ["worldbuilding", "sheet", "actor", "npc", "uesrpg-sheet-root"],
    position: { width: 910, height: 960 },
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
      woundFirstAid: NpcSheetV2.prototype._onWoundFirstAid,
      woundRemoveFirstAid: NpcSheetV2.prototype._onWoundRemoveFirstAid,
      woundTreat: NpcSheetV2.prototype._onWoundTreat,
      woundTreatAll: NpcSheetV2.prototype._onWoundTreatAll,
      woundClear: NpcSheetV2.prototype._onWoundClear,
      woundClearAll: NpcSheetV2.prototype._onWoundClearAll,
      woundReconcile: NpcSheetV2.prototype._onWoundReconcile,
      woundsInjuriesControl: NpcSheetV2.prototype._onWoundsInjuriesControl,

      // Characteristics (from fixed-header)
      advancementMenu: NpcSheetV2.prototype._onSetBaseCharacteristics,
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
      itemQuickMenu: NpcSheetV2.prototype._onItemQuickMenu,
      openContainer: NpcSheetV2.prototype._onOpenContainer,

      // Economy
      wealthCalc: NpcSheetV2.prototype._onWealthCalc,
      carryBonus: NpcSheetV2.prototype._onCarryBonus,
      encBreakdown: NpcSheetV2.prototype._onEncBreakdown,

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
      openBioEditor: NpcSheetV2.prototype._onOpenBioEditor,
    },
    dragDrop: [
      {
        dragSelector: ".item, .npc-item, .spell-row",
        dropSelector: ".window-content, .sheet-body, .tab, .tabContainer, .itemListContainer, [data-item-type='container']",
      },
    ],
  };

  static PARTS = {
    sidebar: {
      template: templatePath("v2/sheets/shared/sidebar.hbs"),
    },
    core: {
      template: templatePath("v2/sheets/npc/tab-core.hbs"),
      templates: [
        templatePath("partials/sheets/feature-inspector.hbs"),
      ],
      scrollable: [".tabContainer"],
    },
    combat: {
      template: templatePath("v2/sheets/npc/tab-combat.hbs"),
      scrollable: [".combatTabContainer"],
    },
    magic: {
      template: templatePath("v2/sheets/npc/tab-magic.hbs"),
      scrollable: [".magicTabContainer"],
    },
    equipment: {
      template: templatePath("v2/sheets/npc/tab-equipment.hbs"),
      scrollable: [".equipmentTabContainer"],
    },
    limited: {
      template: templatePath("v2/sheets/limited-npc-sheet.hbs"),
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


  _warnConfigureRenderOptions(message, details = {}) {
    if (!this._isSheetPerfTraceEnabled()) return;
    const payload = {
      sheet: "NpcSheetV2",
      actorId: this.document?.id ?? null,
      actorName: this.document?.name ?? null,
      ...details,
    };
    console.warn(`UESRPG | ${message} ${JSON.stringify(payload)}`);
  }

  _normalizeNpcRenderParts(parts, { limited } = {}) {
    if (limited) return { parts: ["limited"], dropped: [] };

    const canonical = ["sidebar", "core", "combat", "magic", "equipment"];
    const allowed = new Set(canonical);
    const incoming = Array.isArray(parts) ? parts : [];
    const normalized = [];
    const dropped = [];

    for (const part of incoming) {
      if (part === "limited") {
        dropped.push(part);
        continue;
      }
      if (!allowed.has(part)) {
        dropped.push(part);
        continue;
      }
      if (!normalized.includes(part)) normalized.push(part);
    }

    if (!normalized.length) return { parts: canonical, dropped };
    return { parts: normalized, dropped };
  }
  /* ═══════════════════════ Render Options ════════════════════════════ */

  /** @override — select limited vs full template PARTS */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    const requested = Array.isArray(options?.parts) ? [...options.parts] : [];
    const normalized = this._normalizeNpcRenderParts(requested, {
      limited: Boolean(this.document?.limited),
    });

    options.parts = normalized.parts;

    if (normalized.dropped?.length) {
      this._warnConfigureRenderOptions("npc-render-parts-dropped", {
        requested,
        dropped: normalized.dropped,
        applied: normalized.parts,
      });
    }
  }

  /* ═══════════════════════ Context Preparation ═══════════════════════ */

  /** @override */
  /** @override */
  async _prepareContext(options) {
    const perfStart = performance.now();
    try {
      const context = await super._prepareContext(options);
      const actor = this.document;

      // V1-compatible fields expected by templates + shared helpers
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

      // Part-gating: skip expensive builders when AppV2 requests only specific parts.
      // Safe default: if options.parts is absent or covers all parts, build full context.
      const _totalParts = Object.keys(this.constructor.PARTS ?? {}).length || 6;
      const _requestedParts = new Set(options?.parts ?? []);
      const _partialRender = _requestedParts.size > 0 && _requestedParts.size < _totalParts;
      const _needs = (part) => !_partialRender || _requestedParts.has(part);

      if (actor.limited) {
        context.actor.system.enrichedBio = await this._getEnrichedBio(
          context.actor.system?.bio ?? ""
        );
        context.actor.system.socialDisplay = buildSocialDisplay(context.actor.system);
        return context;
      }

      const perfItemsStart = performance.now();
      // Items + derived inventory buckets are the most expensive part of context prep.
      // Cache them per-sheet instance and only rebuild when the items signature changes.
      const sig = this._buildItemsSignature(actor);
      const effectsSignature = buildEffectsSignature(actor);
      const woundsSignature = buildWoundsSignature(actor);
      const combatSignature = buildCombatSignature(actor, sig, effectsSignature);

      if (_needs("core") || _needs("combat") || _needs("magic") || _needs("equipment")) {
        if (this._uesrpgItemsCache && this._uesrpgItemsCache.signature === sig) {
          context.items = this._uesrpgItemsCache.items;
          if (this._uesrpgItemsCache.actorPatch) {
            Object.assign(context.actor, this._uesrpgItemsCache.actorPatch);
          }
          this._traceSheetPerfPhase("items:cache-hit", perfItemsStart, { size: context.items.length });
        } else {
          context.items = actor.items.map(i => {
            const obj = i.toObject();
            obj.system = i.system;
            return obj;
          });

          // This mutates `context.actor` with categorized buckets used by templates.
          prepareCharacterItems(context, { includeSkills: false, includeMagicSkills: false });

          // Cache only the derived patch fields that prepareCharacterItems attaches.
          const ui = context.actor.ui ?? {};
          const actorPatch = {
            gear: context.actor.gear,
            weapon: context.actor.weapon,
            armor: context.actor.armor,
            power: context.actor.power,
            trait: context.actor.trait,
            talent: context.actor.talent,
            combatStyle: context.actor.combatStyle,
            spell: context.actor.spell,
            spellSchools: context.actor.spellSchools,
            ammunition: context.actor.ammunition,
            container: context.actor.container,
            ui: {
              ...(context.actor.ui ?? {}),
              spellsBySchool: ui.spellsBySchool,
              traitStackingById: ui.traitStackingById,
              npcMagicRankOptions: ui.npcMagicRankOptions,
            },
          };

          this._uesrpgItemsCache = {
            signature: sig,
            items: context.items,
            actorPatch,
          };
          this._traceSheetPerfPhase("items:cache-miss", perfItemsStart, { size: context.items.length });
        }
      } else {
        context.items = [];
        this._traceSheetPerfPhase("items:skipped", perfItemsStart, { requested: Array.from(_requestedParts) });
      }

      const perfCombatStart = performance.now();
      if (_needs("combat")) {
        if (this._uesrpgCombatCache && this._uesrpgCombatCache.signature === combatSignature) {
          context.actor.sheetCombatQuick = foundry.utils.deepClone(this._uesrpgCombatCache.sheetCombatQuick);
          context.actor.sheetCombatActions = this._uesrpgCombatCache.sheetCombatActions;
          context.actor.woundManager = this._uesrpgCombatCache.woundManager;
          context.actor.attackTrackerUi = this._uesrpgCombatCache.attackTrackerUi;
          this._traceSheetPerfPhase("combat:cache-hit", perfCombatStart, {});
        } else {
          context.actor.sheetCombatQuick = buildCombatQuickContext(context.actor);
          context.actor.sheetCombatActions = buildCombatActionsContext(actor);
          context.actor.woundManager = game?.uesrpg?.wounds?.getWoundManagerData?.(actor) ?? null;
          context.actor.attackTrackerUi = {
            current: AttackTracker.getAttackCount(actor),
            max: AttackTracker.getAttackLimit(actor),
            overrides: AttackTracker.getOverrides(actor),
          };
          applyDefensiveStanceDisabling(actor, context.actor.sheetCombatQuick);
          this._uesrpgCombatCache = {
            signature: combatSignature,
            sheetCombatQuick: foundry.utils.deepClone(context.actor.sheetCombatQuick),
            sheetCombatActions: context.actor.sheetCombatActions,
            woundManager: context.actor.woundManager,
            attackTrackerUi: context.actor.attackTrackerUi,
          };
          this._traceSheetPerfPhase("combat:cache-miss", perfCombatStart, {});
        }
      } else {
        context.actor.sheetCombatQuick = null;
        context.actor.sheetCombatActions = null;
        context.actor.woundManager = null;
        context.actor.attackTrackerUi = null;
        this._traceSheetPerfPhase("combat:skipped", perfCombatStart, {});
      }

      const perfWoundsStart = performance.now();
      if (_needs("combat")) {
        if (this._uesrpgWoundsUiCache && this._uesrpgWoundsUiCache.signature === woundsSignature) {
          context.woundsInjuriesUi = this._uesrpgWoundsUiCache.value;
          this._traceSheetPerfPhase("wounds:cache-hit", perfWoundsStart, {});
        } else {
          context.woundsInjuriesUi = buildWoundsInjuriesPanelContext(actor, { enabled: true });
          this._uesrpgWoundsUiCache = { signature: woundsSignature, value: context.woundsInjuriesUi };
          this._traceSheetPerfPhase("wounds:cache-miss", perfWoundsStart, {});
        }
      } else {
        context.woundsInjuriesUi = buildWoundsInjuriesPanelContext(actor, { enabled: false });
        this._traceSheetPerfPhase("wounds:disabled", perfWoundsStart, {});
      }

      const perfSheetUiStart = performance.now();
      if (_needs("sidebar") || _needs("core")) {
        const sheetUiSignature = buildSheetUiSignature(actor);
        if (this._uesrpgSheetUiCache && this._uesrpgSheetUiCache.signature === sheetUiSignature) {
          context.sheetUi = this._uesrpgSheetUiCache.value;
          this._traceSheetPerfPhase("sheetUi:cache-hit", perfSheetUiStart, {});
        } else {
          context.sheetUi = await buildSheetUiState(actor);
          this._uesrpgSheetUiCache = { signature: sheetUiSignature, value: context.sheetUi };
          this._traceSheetPerfPhase("sheetUi:cache-miss", perfSheetUiStart, {});
        }
      } else {
        context.sheetUi = null;
        this._traceSheetPerfPhase("sheetUi:skipped", perfSheetUiStart, {});
      }
      context.sheetUi = context.sheetUi ?? {};
      const diagnosticsFlag = context.sheetUi.showDiagnostics ?? Boolean(game?.settings?.get?.(SYSTEM_ID, "sheetDiagnostics"));
      const diagnosticsEnabled = Boolean(diagnosticsFlag && game.user?.isGM);
      context.sheetUi.weaponDistanceHeaderLabel = resolveWeaponDistanceHeaderLabel(context.actor?.weapon);
      const encumbranceUiEnhanced = Boolean(game?.settings?.get?.(SYSTEM_ID, "encumbranceUiEnhanced"));
      context.sheetUi.encBreakdownEnabled = encumbranceUiEnhanced;
      if (encumbranceUiEnhanced && _needs("equipment")) {
        const perfEncStart = performance.now();
        if (this._uesrpgEncumbranceCache && this._uesrpgEncumbranceCache.signature === sig) {
          annotateEncumbranceHighlights(context.actor, this._uesrpgEncumbranceCache.breakdown, { topN: 5 });
          this._traceSheetPerfPhase("encumbrance:cache-hit", perfEncStart, {});
        } else {
          const breakdown = buildEncumbranceBreakdown(actor);
          this._uesrpgEncumbranceCache = { signature: sig, breakdown };
          annotateEncumbranceHighlights(context.actor, breakdown, { topN: 5 });
          this._traceSheetPerfPhase("encumbrance:cache-miss", perfEncStart, {});
        }
      }

      if (_needs("core")) {
        const bio = context.actor.system?.bio ?? "";
        context.actor.system.enrichedBio = await this._getEnrichedBio(bio);
        context.actor.system.socialDisplay = buildSocialDisplay(context.actor.system);
      }

      if (_needs("equipment") || _needs("magic")) {
        const perfEffectsStart = performance.now();
        if (this._uesrpgEffectsCache && this._uesrpgEffectsCache.signature === effectsSignature) {
          context.effects = this._uesrpgEffectsCache.effects;
          this._traceSheetPerfPhase("effects:cache-hit", perfEffectsStart, { count: context.effects.length });
        } else {
          context.effects = actor.effects
            ? actor.effects.contents.filter((e) => !isWoundsOrShockEffect(e)).map((e) => e.toObject())
            : [];
          this._uesrpgEffectsCache = { signature: effectsSignature, effects: context.effects };
          this._traceSheetPerfPhase("effects:cache-miss", perfEffectsStart, { count: context.effects.length });
        }
      } else {
        context.effects = [];
      }

      if (_needs("core") && diagnosticsEnabled && game.settings.get(SYSTEM_ID, "showFeatureInspector")) {
        try {
          const { buildFeatureInspectorContext } = await import("../shared/feature-inspector.js");
          context.featureInspector = buildFeatureInspectorContext(actor);
        } catch (err) {
          console.warn("UESRPG | Feature inspector build failed for NPC", actor?.name, err);
          context.featureInspector = null;
        }
      } else {
        context.featureInspector = null;
      }

      context.engagementFlankingEnabled = isEngagementFlankingHomebrewEnabled();
      context.engagementFlankingMaxES = (() => {
        try {
          const val = actor?.flags?.[SYSTEM_ID]?.homebrew?.maxEngagementScore;
          return (typeof val === "number" && Number.isFinite(val)) ? val : "";
        } catch { return ""; }
      })();

      return context;
    } finally {
      this._traceSheetPerf("_prepareContext", perfStart, {
        renderKeys: options ? Object.keys(options).length : 0,
        itemCount: this.document?.items?.size ?? null,
        effectCount: this.document?.effects?.size ?? null,
      });
    }
  }

  /* ═══════════════════════ Render Lifecycle ═══════════════════════ */

  /** @override */
  /** @override */
  _onRender(context, options) {
    const perfStart = performance.now();
    try {
      super._onRender(context, options);
      const el = this.element;
      if (!el) return;
      applySheetDensityClass(el);
      bindWindowRestoreGuard(this, el);
      warnIfDuplicateSidebar(this, "NpcSheetV2", el, options);
      enableResizeMotionGuard(this, {
        onStateChange: (phase, meta = {}) => {
          this._traceSheetPerf(`phase:resize:${phase}`, performance.now(), {
            reason: meta.reason ?? null,
            width: meta.width ?? null,
            height: meta.height ?? null,
          });
        },
      });
      clearItemDescriptionTooltip(this);

      if (this.document.limited) return;

      const expectedPrimary = this.tabGroups.primary ?? "core";
      const activePrimary = el.querySelector('.tab[data-group="primary"].active')?.dataset?.tab ?? null;
      if (activePrimary !== expectedPrimary) {
        this.changeTab(expectedPrimary, "primary", { force: true });
      }
      const expectedActions = this.tabGroups.actions ?? "primary";
      const activeActions = el.querySelector('.tab[data-group="actions"].active')?.dataset?.tab ?? null;
      if (activeActions !== expectedActions) {
        this.changeTab(expectedActions, "actions", { force: true });
      }

      if (this._partRendered(options, "combat")) {
        const perfTooltipStart = performance.now();
        const combatRoot = el.querySelector('.tab.combat[data-group="primary"][data-tab="combat"]');
        if (combatRoot instanceof HTMLElement) {
          bindItemDescriptionTooltips(this, combatRoot);
        }
        this._traceSheetPerfPhase("dom:combat-tooltips", perfTooltipStart, {});
      }

      if (this._partRendered(options, "equipment") || this._partRendered(options, "combat")) {
        const perfGroupsStart = performance.now();
        if (el.querySelector(".uesrpg-group-toggle, [data-action='groupToggle']")) {
          applyCollapsedGroups(el);
        }
        this._traceSheetPerfPhase("dom:collapsed-groups", perfGroupsStart, {});
      }

      if (this._partRendered(options, "sidebar") || this._partRendered(options, "core")) {
        const perfBarsStart = performance.now();
        try {
          setResourceBars(this);
        } catch (_e) { /* no-op */ }
        this._traceSheetPerfPhase("dom:resource-bars", perfBarsStart, {});
      }

      this._createStatusTags();
      activateEditorButtons(this, el);
    } finally {
      this._traceSheetPerf("_onRender", perfStart, {
        limited: Boolean(this.document?.limited),
      });
    }
  }

  /**
   * Per-part listener registration (called for each re-rendered part).
   * Replaces the monolithic _onRender approach — non-click listeners are
   * scoped to the specific part that was re-rendered. data-action click
   * handlers use event delegation and require no re-binding.
   * @override
   */
  _attachPartListeners(partId, htmlElement, options) {
    const perfStart = performance.now();
    try {
      super._attachPartListeners(partId, htmlElement, options);

      if (this.document.limited) return;

      if (partId === "sidebar") {
        if (htmlElement?.dataset?.uesrpgResourceListeners !== "1") {
          registerResourceButtonHandlers(this, htmlElement);
          htmlElement.dataset.uesrpgResourceListeners = "1";
        }
        return;
      }

      if (partId === "combat") {
        htmlElement.addEventListener("change", (ev) => {
          const target = ev.target.closest?.(".uesrpg-max-engagement-score");
          if (target) this._onMaxEngagementScoreChange(ev, target).catch(err =>
            console.error("UESRPG | Max Engagement Score change failed", err));
        });
      }

      this._attachTabListeners(htmlElement);
    } finally {
      this._traceSheetPerf("_attachPartListeners", perfStart, { partId });
    }
  }

  /**
   * Attach non-click listeners shared across all tab PARTS.
   * Called once per tab part per render cycle.
   * @param {HTMLElement} el – the root element of the rendered part
   */
  _attachTabListeners(el) {
    if (!el || el.dataset.uesrpgListeners === "1") return;
    el.dataset.uesrpgListeners = "1";
    enableItemRowDragSources(el, { actor: this.document });
    for (const quickBtn of el.querySelectorAll(".uesrpg-item-quickmenu-btn")) quickBtn.remove();

    for (const nameEl of el.querySelectorAll(".item-name")) {
      const txt = String(nameEl?.textContent ?? "").trim();
      if (txt && !nameEl.getAttribute("title")) nameEl.setAttribute("title", txt);
    }

    if (!this._uesrpgTabContextMenuHandler) {
      this._uesrpgTabContextMenuHandler = async (ev) => {
        if (await handleItemRowContextMenu(this, ev)) return;
        const root = ev.currentTarget;

        const magicEl = ev.target?.closest?.(".magic-roll");
        if (magicEl && root?.contains?.(magicEl)) {
          ev.preventDefault();
          this._postSpellDescriptionToChat(ev, magicEl);
          return;
        }

        const skillEl = ev.target?.closest?.(".skill-roll-target");
        if (skillEl && root?.contains?.(skillEl)) {
          ev.preventDefault();
          this._onItemOpen(ev, skillEl);
          return;
        }

        const profEl = ev.target?.closest?.(".profession-roll-target");
        if (profEl && root?.contains?.(profEl)) {
          if (ev.target?.closest?.("input, textarea, select")) return;
          ev.preventDefault();
          this._openProfessionSkillSheet(profEl);
          return;
        }

        const minusBtn = ev.target?.closest?.(".minusQty");
        if (minusBtn && root?.contains?.(minusBtn)) {
          ev.preventDefault();
          this._onMinusQty(ev, minusBtn);
        }
      };
    }

    if (!this._uesrpgTabChangeHandler) {
      this._uesrpgTabChangeHandler = (ev) => {
        const root = ev.currentTarget;
        const attackInput = ev.target?.closest?.(".uesrpg-attack-input");
        if (attackInput && root?.contains?.(attackInput)) {
          this._onAttackTrackerInputChange(ev, attackInput);
          return;
        }
        const styleSelect = ev.target?.closest?.(".uesrpg-active-combat-style");
        if (styleSelect && root?.contains?.(styleSelect)) {
          this._onActiveCombatStyleChange(ev, styleSelect);
        }
      };
    }

    if (!this._uesrpgTabInputHandler) {
      this._uesrpgTabInputHandler = (ev) => {
        const root = ev.currentTarget;
        const searchInput = ev.target?.closest?.("#uesrpg-item-search");
        if (!searchInput || !root?.contains?.(searchInput)) return;
        if (!this._uesrpgDebouncedSearch) {
          this._uesrpgDebouncedSearch = foundry.utils.debounce(this._onItemSearch.bind(this), 200);
        }
        this._uesrpgDebouncedSearch(ev);
      };
    }

    if (!this._uesrpgTabKeydownHandler) {
      this._uesrpgTabKeydownHandler = async (ev) => {
        const progressInput = ev.target?.closest?.("input[data-wi-action='setProgress'][data-wi-progress-input]");
        if (progressInput && ev.key === "Enter") {
          ev.preventDefault();
          await this._onWoundsInjuriesControl(ev, progressInput);
          return;
        }
        const damageInput = ev.target?.closest?.("input[data-wi-action='setDamage'][data-wi-damage-input]");
        if (damageInput && ev.key === "Enter") {
          ev.preventDefault();
          await this._onWoundsInjuriesControl(ev, damageInput);
          return;
        }
        if (ev.key !== "Enter" && ev.key !== " ") return;
        const root = ev.currentTarget;
        const kbd = ev.target?.closest?.(".uesrpg-actions-subtab, .uesrpg-group-toggle, .characteristics-config, .skill-roll-target, .profession-roll-target");
        if (!kbd || !root?.contains?.(kbd)) return;
        ev.preventDefault();
        kbd.click?.();
      };
    }

    el.addEventListener("contextmenu", this._uesrpgTabContextMenuHandler);
    el.addEventListener("change", this._uesrpgTabChangeHandler);
    el.addEventListener("input", this._uesrpgTabInputHandler);
    el.addEventListener("keydown", this._uesrpgTabKeydownHandler);

    // Container row: visual drag-over highlight.
    for (const containerRow of el.querySelectorAll("[data-item-type='container']")) {
      containerRow.addEventListener("dragenter", (ev) => {
        ev.preventDefault();
        ev.currentTarget.classList.add("uesrpg-drag-over");
      });
      containerRow.addEventListener("dragleave", (ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget)) {
          ev.currentTarget.classList.remove("uesrpg-drag-over");
        }
      });
      containerRow.addEventListener("drop", (ev) => {
        ev.currentTarget.classList.remove("uesrpg-drag-over");
      });
    }
  }

  /* ═══════════════════════ Delegated Handlers ════════════════════════ */

  // Combat
  async _onCombatQuickAction(event, target) { return onCombatQuickAction.call(this, event, target); }
  async _onWoundFirstAid() {
    const fn = game?.uesrpg?.wounds?.attemptFirstAid;
    if (typeof fn === "function") await fn(this.document, {});
    await this._queueRenderParts(["combat"]);
  }
  async _onWoundRemoveFirstAid() {
    const fn = game?.uesrpg?.wounds?.removeFirstAid;
    if (typeof fn === "function") await fn(this.document);
    await this._queueRenderParts(["combat"]);
  }
  async _onWoundTreat(_event, target) {
    const id = String(target?.dataset?.woundId ?? "").trim();
    if (!id) return;
    const fn = game?.uesrpg?.wounds?.attemptTreatWound;
    if (typeof fn === "function") await fn(this.document, id, {});
    await this._queueRenderParts(["combat"]);
  }
  async _onWoundTreatAll() {
    const fn = game?.uesrpg?.wounds?.attemptTreatAllWounds;
    if (typeof fn === "function") await fn(this.document, {});
    await this._queueRenderParts(["combat"]);
  }
  async _onWoundClear(_event, target) {
    const id = String(target?.dataset?.woundId ?? "").trim();
    if (!id) return;
    const fn = game?.uesrpg?.wounds?.clearWound;
    if (typeof fn === "function") await fn(this.document, id);
    await this._queueRenderParts(["combat"]);
  }
  async _onWoundClearAll() {
    const fn = game?.uesrpg?.wounds?.clearAllWounds;
    if (typeof fn === "function") await fn(this.document);
    await this._queueRenderParts(["combat"]);
  }
  async _onWoundReconcile() {
    const fn = game?.uesrpg?.wounds?.reconcileWoundState;
    if (typeof fn === "function") await fn(this.document, { reason: "sheet", emitLog: true });
    await this._queueRenderParts(["combat"]);
  }
  async _onWoundsInjuriesControl(event, target) {
    const result = await onWoundsInjuriesControl.call(this, event, target);
    await this._queueRenderParts(["combat"]);
    return result;
  }
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
  async _onEncBreakdown(_event, _target) {
    if (!game?.settings?.get?.(SYSTEM_ID, "encumbranceUiEnhanced")) return;
    return openEncumbranceBreakdownDialog(this.document);
  }

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

  _onOpenBioEditor(event, _target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;

    const bioRoot = this.element?.querySelector?.(".bioPage .contentContainer");
    const editButton = bioRoot?.querySelector?.(".editor-edit");
    if (editButton) {
      editButton.click();
      return;
    }

    const fallbackField = bioRoot?.querySelector?.("[name='system.bio']");
    if (fallbackField) fallbackField.focus();
  }

  /** Open item sheet on name/image click */
  _onItemOpen(event, target) {
    const li = target?.closest?.(".item");
    const itemId = li?.dataset?.itemId;
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (item?.sheet) item.sheet.render(true);
  }

  async _onItemQuickMenu(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const itemId = String(target?.dataset?.itemId ?? target?.closest?.(".item")?.dataset?.itemId ?? "").trim();
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (!item) return;
    await openItemRowQuickMenu(this, item, { anchorEl: target });
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
  async _onActiveCombatStyleChange(event, target) {
    if (!this.isEditable) return;
    const v = String(target?.value ?? event?.target?.closest?.(".uesrpg-active-combat-style")?.value ?? "").trim();
    try {
      await requestUpdateDocument(this.document, { [`flags.${SYSTEM_ID}.activeCombatStyleId`]: v || "" });
      this.render(false);
    } catch (err) {
      console.error("UESRPG | Failed to update active combat style", { actor: this.document?.uuid, err });
      ui.notifications?.error?.("Failed to update active combat style");
    }
  }

  async _onMaxEngagementScoreChange(event, target) {
    if (!this.isEditable) return;
    const raw = String(target?.value ?? "").trim();
    const val = raw === "" ? null : Math.max(0, Math.round(Number(raw) || 0));
    try {
      await requestUpdateDocument(this.document, {
        [`flags.${SYSTEM_ID}.homebrew.maxEngagementScore`]: val,
      });
      this.render(false);
    } catch (err) {
      console.error("UESRPG | Failed to update max engagement score", { actor: this.document?.uuid, err });
      ui.notifications?.error?.("Failed to update max engagement score.");
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
    const { LanguageSelectorAppV2 } = await import("../../apps/v2/social-selectors.js");
    await LanguageSelectorAppV2.prompt(this.document);
  }
  async _onOpenFactionSelector(event, target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    const { FactionSelectorAppV2 } = await import("../../apps/v2/social-selectors.js");
    await FactionSelectorAppV2.prompt(this.document);
  }

  // Status tags — show wound/fatigue/enc icons in the fixed-header only when
  // the corresponding penalty is active. Icons are always in the DOM (rendered
  // by fixed-header.hbs); this method toggles their visibility post-render.
  _createStatusTags() {
    const actor = this.actor;
    const el = this.element;
    if (!el || !actor) return;

    const woundPenalty = Number(actor.system?.woundPenalty ?? 0);
    const fatiguePenalty = Number(actor.system?.fatigue?.penalty ?? 0);
    const carryPenalty = Number(actor.system?.carry_rating?.penalty ?? 0);

    const woundIcon = el.querySelector("#wound-icon");
    const fatigueIcon = el.querySelector("#fatigue-icon");
    const encIcon = el.querySelector("#enc-icon");

    if (woundIcon) woundIcon.style.display = woundPenalty !== 0 ? "" : "none";
    if (fatigueIcon) fatigueIcon.style.display = fatiguePenalty !== 0 ? "" : "none";
    if (encIcon) encIcon.style.display = carryPenalty !== 0 ? "" : "none";
  }

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
  async _postSpellDescriptionToChat(event, target) {
    event.preventDefault();
    const button = target ?? event.target?.closest?.(".magic-roll") ?? event.currentTarget;
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
    if (event.target?.closest?.("input, textarea, select")) return;

    if (!requireUserCanRollActor(game.user, this.document)) return;

    const button = target ?? event.currentTarget ?? event.target ?? null;

    const knownProfessionKeys = new Set([
      ...Object.keys(this.document.system?.professions ?? {}),
      "profession1",
      "profession2",
      "profession3",
    ]);

    const tryResolveProfessionKey = (value) => {
      if (!value) return null;

      // Allow action objects from HUD modules.
      if (typeof value === "object") {
        return (
          tryResolveProfessionKey(value.professionKey) ||
          tryResolveProfessionKey(value.profession) ||
          tryResolveProfessionKey(value.key) ||
          tryResolveProfessionKey(value.id) ||
          tryResolveProfessionKey(value.actionId) ||
          tryResolveProfessionKey(value.action?.id) ||
          tryResolveProfessionKey(value.value)
        );
      }

      const raw = String(value ?? "").trim();
      if (!raw) return null;
      if (knownProfessionKeys.has(raw)) return raw;

      // Common HUD patterns: "professions:combat", "profession|profession1", "action.profession2"
      const tokens = raw
        .split(/[:|/\\.]/)
        .map((t) => String(t ?? "").trim())
        .filter(Boolean);

      for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i];
        if (knownProfessionKeys.has(t)) return t;
      }

      // Last resort: substring match against known keys.
      for (const k of knownProfessionKeys) {
        if (k && raw.includes(k)) return k;
      }
      return null;
    };

    let profKey = null;
    const candidates = [target, event?.currentTarget, event?.target].filter(Boolean);

    for (const el of candidates) {
      if (profKey) break;
      if (typeof el?.closest !== "function") continue;

      const keyedNode = el.closest("[data-profession-key]");
      const keyed = String(keyedNode?.dataset?.professionKey ?? "").trim();
      if (keyed) {
        profKey = keyed;
        break;
      }

      const rollTarget = el.closest(".profession-roll-target");
      const fromTarget = String(rollTarget?.dataset?.professionKey ?? "").trim();
      if (fromTarget) {
        profKey = fromTarget;
        break;
      }

      const itemNode = el.closest(".item, .npc-item");
      const fromItem = String(itemNode?.dataset?.professionKey ?? itemNode?.dataset?.itemId ?? "").trim();
      if (fromItem) {
        profKey = fromItem;
        break;
      }

      const fromNode = String(el?.dataset?.professionKey ?? el?.id ?? "").trim();
      if (fromNode) {
        profKey = tryResolveProfessionKey(fromNode);
        break;
      }

      // Compatibility: Token Action HUD and similar modules.
      const actionFromDataset =
        el?.dataset?.professionKey ??
        el?.dataset?.actionId ??
        el?.dataset?.actionid ??
        el?.dataset?.action ??
        el?.dataset?.id ??
        "";
      const fromAction = tryResolveProfessionKey(actionFromDataset);
      if (fromAction) {
        profKey = fromAction;
        break;
      }
    }

    if (!profKey) {
      profKey =
        tryResolveProfessionKey(event?.detail) ||
        tryResolveProfessionKey(event?.detail?.actionId) ||
        tryResolveProfessionKey(event?.detail?.action?.id) ||
        tryResolveProfessionKey(event?.data) ||
        tryResolveProfessionKey(event?.data?.professionKey) ||
        tryResolveProfessionKey(event?.data?.itemId) ||
        tryResolveProfessionKey(button) ||
        null;
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

        const quickShift = Boolean(event.shiftKey) && game.settings.get(SYSTEM_ID, "skillRollQuickShift");
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
    const encApplied = (tn.breakdown ?? []).some(b => b.source === "encumbrance");
    if (encApplied) {
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
        [SYSTEM_ID]: { skillTest },
      },
      rollMode,
    });
  }

  _openProfessionSkillSheet(target) {
    const profKey = String(target?.dataset?.professionKey ?? "").trim();
    if (!profKey) return;

    const byName = (name) => {
      const needle = String(name ?? "").trim().toLowerCase();
      if (!needle) return null;
      return this.document.items.find((it) =>
        String(it?.type ?? "").toLowerCase() === "skill" &&
        String(it?.name ?? "").trim().toLowerCase() === needle
      ) ?? null;
    };

    const profMap = {
      combat: "combat",
      evade: "evade",
      knowledge: "knowledge",
      magic: "magic",
      observe: "observe",
      physical: "physical",
      social: "social",
      stealth: "stealth",
      commerce: "commerce",
    };

    let skillItem = byName(profMap[profKey] ?? profKey);
    if (!skillItem && ["profession1", "profession2", "profession3"].includes(profKey)) {
      const spec = String(this.document.system?.skills?.[profKey]?.specialization ?? "").trim();
      skillItem = byName(spec);
    }

    if (skillItem?.sheet) skillItem.sheet.render(true);
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
  async _onAttackTrackerInputChange(event, target) {
    event.preventDefault();
    if (!game.user?.isGM) {
      ui.notifications?.warn?.("Only the GM can adjust attack tracker values.");
      return;
    }
    const el = target ?? event.target?.closest?.(".uesrpg-attack-input") ?? event.currentTarget;
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

  /**
   * Build a proper Item drag payload from data-item-id.
   * Mirrors the same override on PCActorSheetV2 — NPC inventory rows do not
   * carry data-document-uuid so we resolve the live Item and stamp the payload.
   * @override
   */
  _onDragStart(event) {
    const existing = String(event?.dataTransfer?.getData?.("text/plain") ?? "").trim();
    if (existing) return;

    const row = event.target?.closest?.("[data-item-id]") ?? event.currentTarget;
    const itemId = row?.dataset?.itemId;
    if (!itemId) return super._onDragStart(event);

    const item = this.document.items.get(itemId);
    if (!item) return super._onDragStart(event);

    const traceId = makeDndTraceId("npc-drag");
    const payload = buildItemDragPayload(item, { traceId });
    event.dataTransfer?.setData("text/plain", JSON.stringify(payload));
    dndDebug("sheet.dragstart.fallback", {
      sheet: "NpcSheetV2",
      actor: this.document?.uuid ?? null,
      item: item?.uuid ?? null,
      itemId: item?.id ?? null,
    }, { traceId });
  }

  /** @override */
  _canDragDrop(_selector) {
    return this.isEditable;
  }

  /** @override */
  _canDragStart(_selector) {
    return this.isEditable;
  }

  /** @override */
  async _onDrop(event) {
    const traceId = makeDndTraceId("npc-drop");
    const data = readDropData(event, { traceId });
    dndDebug("sheet.drop.received", {
      sheet: "NpcSheetV2",
      actor: this.document?.uuid ?? null,
      type: data?.type ?? null,
      uuid: data?.uuid ?? null,
      itemId: data?.itemId ?? null,
      targetContainer: event.target?.closest?.("[data-item-type='container']")?.dataset?.itemId ?? null,
    }, { traceId });

    if (data.type === "Item") {
      // Route to container containment logic when the drop lands on a container row.
      const containerRow =
        event.currentTarget?.dataset?.itemType === "container"
          ? event.currentTarget
          : event.target.closest?.("[data-item-type='container']");

      if (containerRow?.dataset?.itemId) {
        const containerItem = this.document.items.get(containerRow.dataset.itemId);
        if (containerItem?.type === "container") {
          containerRow.classList.remove("uesrpg-drag-over");
          dndDebug("sheet.drop.route.container", {
            sheet: "NpcSheetV2",
            actor: this.document?.uuid ?? null,
            container: containerItem?.uuid ?? null,
            data,
          }, { traceId });
          return onDropItemIntoContainer(
            { item: containerItem, actor: this.document, isEditable: this.isEditable },
            data
          );
        }
      }

      // Resolve for debug logging; base sheet still performs create/move behavior.
      const resolved = await resolveDroppedItemDetailed(data, { traceId });
      if (!resolved.item) {
        dndDebug("sheet.drop.unresolved", {
          sheet: "NpcSheetV2",
          actor: this.document?.uuid ?? null,
          data,
          resolved,
        }, { traceId });
        dndWarnFailure("Unable to resolve dropped item payload.", {
          traceId,
          details: {
            sheet: "NpcSheetV2",
            actor: this.document?.uuid ?? null,
            data,
            resolved,
          },
        });
        return super._onDrop(event);
      }

      if (resolved.item.actor?.id === this.document.id) {
        dndDebug("sheet.drop.sameActor", {
          sheet: "NpcSheetV2",
          actor: this.document?.uuid ?? null,
          item: resolved.item?.uuid ?? null,
          sourceKind: resolved.sourceKind,
        }, { traceId });
        return super._onDrop(event);
      }

      // External item drops (compendium/world/other actor): create explicitly so
      // legacy generic-item type/category metadata is normalized on first drop.
      if (!this.isEditable || !this.document?.isOwner) {
        dndWarnFailure("You do not have permission to modify this actor's inventory.", {
          traceId,
          details: {
            sheet: "NpcSheetV2",
            actor: this.document?.uuid ?? null,
            item: resolved.item?.uuid ?? null,
          },
        });
        return;
      }

      try {
        const created = await handleExternalItemDrop(this.document, resolved.item, {
          normalizeType: true,
          traceId,
        });
        if (!created) {
          throw new Error("handleExternalItemDrop returned null");
        }
        dndDebug("sheet.drop.externalCreate.success", {
          sheet: "NpcSheetV2",
          actor: this.document?.uuid ?? null,
          sourceItem: resolved.item?.uuid ?? null,
          sourceKind: resolved.sourceKind,
          createdId: created?.id ?? null,
          createdType: created?.type ?? null,
        }, { traceId });
        return;
      } catch (err) {
        dndDebug("sheet.drop.externalCreate.failed", {
          sheet: "NpcSheetV2",
          actor: this.document?.uuid ?? null,
          item: resolved.item?.uuid ?? null,
          sourceKind: resolved.sourceKind,
          err: err?.message ?? String(err),
          resolutionPath: resolved?.resolutionPath ?? [],
          errors: resolved?.errors ?? [],
        }, { traceId });
        try {
          return await super._onDrop(event);
        } catch (fallbackErr) {
          dndWarnFailure("Item drop failed. Check console diagnostics.", {
            traceId,
            details: {
              sheet: "NpcSheetV2",
              actor: this.document?.uuid ?? null,
              item: resolved.item?.uuid ?? null,
              err: err?.message ?? String(err),
              fallbackErr: fallbackErr?.message ?? String(fallbackErr),
            },
          });
          return;
        }
      }
    }

    return super._onDrop(event);
  }

  _onClose(options) {
    const perfStart = performance.now();
    try {
      this._uesrpgDebouncedSearch?.cancel?.();
      this._uesrpgDebouncedSearch = null;
      this._uesrpgTabContextMenuHandler = null;
      this._uesrpgTabChangeHandler = null;
      this._uesrpgTabInputHandler = null;
      this._uesrpgTabKeydownHandler = null;
      this._uesrpgBioCache = null;
      this._uesrpgItemsCache = null;
      this._uesrpgCombatCache = null;
      this._uesrpgWoundsUiCache = null;
      this._uesrpgEffectsCache = null;
      this._uesrpgEncumbranceCache = null;
      this._uesrpgSheetUiCache = null;
      if (this._uesrpgRenderPartsRafId != null) cancelAnimationFrame(this._uesrpgRenderPartsRafId);
      this._uesrpgRenderPartsRafId = null;
      this._uesrpgRenderPartsPromise = null;
      this._uesrpgRenderPartsResolvers = [];
      this._uesrpgQueuedParts = null;
      if (this._uesrpgRestoreDblClickEl && this._uesrpgRestoreDblClickHandler) {
        this._uesrpgRestoreDblClickEl.removeEventListener("dblclick", this._uesrpgRestoreDblClickHandler, true);
      }
      this._uesrpgRestoreDblClickHandler = null;
      this._uesrpgRestoreDblClickEl = null;
      disableResizeMotionGuard(this);
      clearItemDescriptionTooltip(this);
      return super._onClose(options);
    } finally {
      this._traceSheetPerf("_onClose", perfStart, {});
    }
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

