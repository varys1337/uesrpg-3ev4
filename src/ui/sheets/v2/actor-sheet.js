/**
 * src/ui/sheets/v2/actor-sheet.js
 *
 * ApplicationV2 Player Character Sheet.
 *
 * Key improvements:
 * - Uses HandlebarsApplicationMixin(ActorSheetV2) base
 * - Native AppV2 lifecycle (_preRender / _onRender) for UI state preservation
 * - Delegates to existing shared handler modules for all roll, combat, magic, & inventory logic
 * - Explicit AppV2 form pipeline for deterministic minimal actor updates
 */

import { prepareCharacterItems } from "../sheet-prepare-items.js";
import { collectSkillAEModifiers } from "../../../core/actors/ae/modifiers.js";
import { applyCollapsedGroups } from "../shared/helpers/collapsed-group-dom.js";
import { postItemToChat } from "../shared-handlers.js";
import { unlinkAllItemsFromContainer, unlinkItemFromContainer } from "../sheet-containers.js";
import { requestUpdateDocument, requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { confirmDialog } from "../../../utils/dialog-v2-helper.js";
import { readDropData, resolveDroppedItemDetailed } from "../../../utils/drop-data.js";
import { buildItemDragPayload } from "../../../utils/drag-payload.js";
import { handleExternalItemDrop } from "../../../utils/drop-item-create-data.js";
import { dndDebug, dndWarnFailure, makeDndTraceId } from "../../../utils/dnd-debugger.js";
import { AttackTracker } from "../../../core/combat/attack-tracker.js";
import { cancelOriginAEUpkeep } from "../../../core/magic/effects/origin-effect.js";
import { buildEncumbranceBreakdown } from "../../../core/actors/rules/item-aggregation.js";

import { onCombatQuickAction } from "../shared/listeners/combat-actions.js";
import { onCastMagicAction } from "../shared/listeners/magic-cast.js";
import { onCastEnchantmentAction } from "../shared/listeners/enchanting-cast.js";
import { onSkillRoll, onSpellRoll, onCombatRoll, onResistanceRoll, onDamageRoll } from "../shared/listeners/rolls.js";

import { onRaceMenu, onBirthSignMenu, onXPMenu, onStartingResourcesMenu, onAdvancementMenu } from "../shared/dialogs/character-menus.js";
import { onClickCharacteristic, onLuckyMenu } from "../shared/listeners/characteristics-handlers.js";

import { onToggle2H, onPlusQty, onMinusQty, onItemEquip } from "../shared/listeners/inventory-handlers.js";
import { onWealthCalc, onCarryBonus } from "../shared/listeners/economy-handlers.js";
import { onToggleGroupCollapse, onItemSearch, onLoadoutSave, onLoadoutApply, onLoadoutDelete } from "../shared/helpers/ui-state-handlers.js";
import { onItemCreate } from "../shared/dialogs/equipment-dialogs.js";

import { registerResourceButtonHandlers } from "../shared/listeners/resource-button-handlers.js";
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
import { getCachedSetting } from "../../../core/config/settings-cache.js";
import { SYSTEM_ID, templatePath } from "../../constants.js";
import {
  buildEffectsSignature,
  buildWoundsSignature,
  buildCombatSignature,
  buildSheetUiSignature,
} from "./shared/sheet-signatures.js";
import { bindWindowRestoreGuard, warnIfDuplicateSidebar } from "./shared/window-restore-guard.js";
import { createPartContextScope } from "./shared/part-context.js";
import { isEngagementFlankingHomebrewEnabled } from "../../../core/homebrew/settings.js";
import {
  buildAllowedChangePatch,
  buildAllowedSubmitPatch,
  createFormPathMatcher,
} from "./shared/form-pipeline.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ActorSheetV2Base = foundry.applications.sheets.ActorSheetV2;
const MAX_ENGAGEMENT_SCORE_PATH = `flags.${SYSTEM_ID}.homebrew.maxEngagementScore`;
const ATTACK_TRACKER_CURRENT_PATH = `flags.${SYSTEM_ID}.combat.attackTrackerOverrides.current`;
const ATTACK_TRACKER_MAX_PATH = `flags.${SYSTEM_ID}.combat.attackTrackerOverrides.max`;
const ALLOWED_PC_FORM_PATH = createFormPathMatcher({
  exact: [
    "name",
    "system.hp.value",
    "system.stamina.value",
    "system.magicka.value",
    "system.luck_points.value",
    "system.action_points.value",
    "system.action_points.max",
    "system.size",
    "system.armor_class",
    "system.wealth",
    MAX_ENGAGEMENT_SCORE_PATH,
  ],
});

function normalizePcFormValue({ path, value, currentValue, rawValue }) {
  if (path !== MAX_ENGAGEMENT_SCORE_PATH) return value;

  const raw = String(rawValue ?? value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return currentValue;
  return Math.max(0, Math.round(n));
}

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

export class PCActorSheetV2 extends HandlebarsApplicationMixin(ActorSheetV2Base) {

  /** @type {Function|null} Debounced item search (memoized) */
  _uesrpgDebouncedSearch = null;
  _uesrpgTabContextMenuHandler = null;
  _uesrpgTabChangeHandler = null;
  _uesrpgTabInputHandler = null;
  _uesrpgTabKeydownHandler = null;
  _uesrpgRestoreDblClickHandler = null;
  _uesrpgRestoreDblClickEl = null;
  _uesrpgBioCache = null;
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

  _buildItemsSignature(actor) {
    const sortAlpha = (() => {
      try {
        return Boolean(game?.settings?.get?.(SYSTEM_ID, "sortAlpha"));
      } catch (_e) {
        return false;
      }
    })();

    const parts = [
      actor?.id ?? "",
      actor?.type ?? "",
      sortAlpha ? "A" : "a",
      String(actor?.items?.size ?? 0),
    ];

    for (const i of actor?.items?.contents ?? []) {
      const cs = i?.system?.containerStats;
      const itemModifiedTime = i?._stats?.modifiedTime ?? i?.updatedTime ?? "";
      parts.push([
        i?.id ?? "",
        i?.type ?? "",
        i?.name ?? "",
        String(itemModifiedTime),
        i?.system?.equipped ? "1" : "0",
        String(i?.system?.quantity ?? ""),
        String(i?.system?.value ?? ""),
        String(i?.system?.bonus ?? ""),
        String(i?.system?.isProfession ?? ""),
        String(i?.system?.school ?? ""),
        String(i?.system?.rank ?? ""),
        cs?.contained ? "1" : "0",
        cs?.container_id ?? "",
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
      sheet: "PCActorSheetV2",
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

  static DEFAULT_OPTIONS = {
    classes: ["worldbuilding", "sheet", "actor", "player-character", "uesrpg-sheet-root"],
    position: { width: 910, height: 960 },
    window: { resizable: true },
    form: {
      handler: PCActorSheetV2.prototype._onFormSubmit,
      submitOnChange: false,
      closeOnSubmit: false,
    },
    actions: {
      raceMenu: PCActorSheetV2.prototype._onRaceMenu,
      birthSignMenu: PCActorSheetV2.prototype._onBirthSignMenu,
      openLanguageSelector: PCActorSheetV2.prototype._onOpenLanguageSelector,
      openFactionSelector: PCActorSheetV2.prototype._onOpenFactionSelector,
      xpMenu: PCActorSheetV2.prototype._onXPMenu,
      startingResourcesMenu: PCActorSheetV2.prototype._onStartingResourcesMenu,
      spendXpMenu: PCActorSheetV2.prototype._onSpendXpMenu,
      rawChargenWizard: PCActorSheetV2.prototype._onRawChargenWizard,
      luckyMenu: PCActorSheetV2.prototype._onLuckyMenu,
      burnLuck: PCActorSheetV2.prototype._onBurnLuck,
      advancementMenu: PCActorSheetV2.prototype._onAdvancementMenu,
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
      castEnchantment: PCActorSheetV2.prototype._onCastEnchantmentAction,
      cancelSpell: PCActorSheetV2.prototype._onCancelSpell,
      combatQuickAction: PCActorSheetV2.prototype._onCombatQuickAction,
      woundFirstAid: PCActorSheetV2.prototype._onWoundFirstAid,
      woundRemoveFirstAid: PCActorSheetV2.prototype._onWoundRemoveFirstAid,
      woundTreat: PCActorSheetV2.prototype._onWoundTreat,
      woundTreatAll: PCActorSheetV2.prototype._onWoundTreatAll,
      woundClear: PCActorSheetV2.prototype._onWoundClear,
      woundClearAll: PCActorSheetV2.prototype._onWoundClearAll,
      woundReconcile: PCActorSheetV2.prototype._onWoundReconcile,
      woundsInjuriesControl: PCActorSheetV2.prototype._onWoundsInjuriesControl,
      effectControl: PCActorSheetV2.prototype._onEffectControl,
      toggle2H: PCActorSheetV2.prototype._onToggle2H,
      plusQty: PCActorSheetV2.prototype._onPlusQty,
      itemEquip: PCActorSheetV2.prototype._onItemEquip,
      itemCreate: PCActorSheetV2.prototype._onItemCreate,
      itemOpen: PCActorSheetV2.prototype._onItemOpen,
      itemDelete: PCActorSheetV2.prototype._onItemDelete,
      itemQuickMenu: PCActorSheetV2.prototype._onItemQuickMenu,
      openContainer: PCActorSheetV2.prototype._onOpenContainer,
      wealthCalc: PCActorSheetV2.prototype._onWealthCalc,
      carryBonus: PCActorSheetV2.prototype._onCarryBonus,
      encBreakdown: PCActorSheetV2.prototype._onEncBreakdown,
      groupToggle: PCActorSheetV2.prototype._onToggleGroupCollapse,
      loadoutSave: PCActorSheetV2.prototype._onLoadoutSave,
      loadoutApply: PCActorSheetV2.prototype._onLoadoutApply,
      loadoutDelete: PCActorSheetV2.prototype._onLoadoutDelete,
      postItemToChat: PCActorSheetV2.prototype._onPostItemToChat,
      featureInspectorCopy: PCActorSheetV2.prototype._onFeatureInspectorCopy,
      openBioEditor: PCActorSheetV2.prototype._onOpenBioEditor,
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
      template: templatePath("v2/sheets/shared/sidebar.hbs"),
    },
    core: {
      template: templatePath("v2/sheets/actor/tab-core.hbs"),
      templates: [
        templatePath("partials/sheets/feature-inspector.hbs"),
      ],
      scrollable: [".tabContainer"],
    },
    combat: {
      template: templatePath("v2/sheets/actor/tab-combat.hbs"),
      scrollable: [".combatTabContainer"],
    },
    magic: {
      template: templatePath("v2/sheets/actor/tab-magic.hbs"),
      scrollable: [".magicTabContainer"],
    },
    equipment: {
      template: templatePath("v2/sheets/actor/tab-equipment.hbs"),
      scrollable: [".equipmentTabContainer"],
    },
  };

  get title() {
    return this.document.name;
  }

  get actor() {
    return this.document;
  }

  get form() {
    return this.element;
  }

  async _onChangeForm(formConfig, event) {
    if (typeof super._onChangeForm === "function") super._onChangeForm(formConfig, event);
    if (!this.isEditable || !this.document?.isOwner) return;
    const target = event?.target;
    const path = String(target?.getAttribute?.("name") ?? "").trim();
    if (path === ATTACK_TRACKER_CURRENT_PATH || path === ATTACK_TRACKER_MAX_PATH) {
      const raw = Number(target?.value ?? NaN);
      if (!Number.isFinite(raw)) return;
      if (path === ATTACK_TRACKER_MAX_PATH) await AttackTracker.setAttackLimitOverride(this.document, raw);
      else await AttackTracker.setCurrentAttacks(this.document, raw);
      return;
    }

    const patch = buildAllowedChangePatch({
      document: this.document,
      target,
      allowPath: ALLOWED_PC_FORM_PATH,
      normalizeValue: normalizePcFormValue,
    });
    if (!patch) return;
    const isMaxEngagementPatch = Object.keys(patch).length === 1
      && Object.prototype.hasOwnProperty.call(patch, MAX_ENGAGEMENT_SCORE_PATH);
    try {
      await requestUpdateDocument(this.document, patch);
    } catch (err) {
      if (!isMaxEngagementPatch) throw err;
      console.error("UESRPG | Failed to update max engagement score", { actor: this.document?.uuid, err });
      ui.notifications?.error?.("Failed to update max engagement score.");
    }
  }

  async _onFormSubmit(_event, _form, formData) {
    if (!this.isEditable || !this.document?.isOwner) return;
    const flat = foundry.utils.flattenObject(formData?.object ?? {});
    if (Object.prototype.hasOwnProperty.call(flat, ATTACK_TRACKER_MAX_PATH)) {
      const raw = Number(flat[ATTACK_TRACKER_MAX_PATH] ?? NaN);
      if (Number.isFinite(raw)) await AttackTracker.setAttackLimitOverride(this.document, raw);
    }
    if (Object.prototype.hasOwnProperty.call(flat, ATTACK_TRACKER_CURRENT_PATH)) {
      const raw = Number(flat[ATTACK_TRACKER_CURRENT_PATH] ?? NaN);
      if (Number.isFinite(raw)) await AttackTracker.setCurrentAttacks(this.document, raw);
    }

    const patch = buildAllowedSubmitPatch({
      document: this.document,
      formDataObject: formData?.object,
      allowPath: ALLOWED_PC_FORM_PATH,
      normalizeValue: normalizePcFormValue,
    });
    if (!patch) return;
    await requestUpdateDocument(this.document, patch);
  }

  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    if (Array.isArray(options?.parts) && options.parts.length) return;
    options.parts = ["sidebar", "core", "combat", "magic", "equipment"];
  }

  /* Context Preparation */

  /** @override */
  async _prepareContext(options) {
    const perfStart = performance.now();
    try {
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

      // Part-gating: skip expensive builders when AppV2 requests only specific parts.
      const partScope = createPartContextScope({
        options,
        partDefinitions: this.constructor.PARTS,
        fallbackTotal: 5,
      });
      const _needs = partScope.needs;

      const perfItemsStart = performance.now();
      const getItemsSignature = (() => {
        let signature = null;
        return () => {
          if (signature === null) signature = this._buildItemsSignature(actor);
          return signature;
        };
      })();
      const getEffectsSignature = (() => {
        let signature = null;
        return () => {
          if (signature === null) signature = buildEffectsSignature(actor);
          return signature;
        };
      })();
      const getWoundsSignature = (() => {
        let signature = null;
        return () => {
          if (signature === null) signature = buildWoundsSignature(actor);
          return signature;
        };
      })();
      const getCombatSignature = (() => {
        let signature = null;
        return () => {
          if (signature === null) {
            signature = buildCombatSignature(actor, getItemsSignature(), getEffectsSignature());
          }
          return signature;
        };
      })();

      // Item categorization - needed by core/combat/magic/equipment tabs.
      // V2 does not auto-populate context.items like V1 getData() - overlay live system data
      // so derived fields (value, *Effective, damage3, etc.) survive into templates.
      if (_needs("core") || _needs("combat") || _needs("magic") || _needs("equipment")) {
        const itemsSignature = getItemsSignature();
        if (this._uesrpgItemsCache && this._uesrpgItemsCache.signature === itemsSignature) {
          context.items = this._uesrpgItemsCache.items;
          if (this._uesrpgItemsCache.actorPatch) Object.assign(context.actor, this._uesrpgItemsCache.actorPatch);
          this._traceSheetPerfPhase("items:cache-hit", perfItemsStart, { size: context.items.length });
        } else {
          context.items = actor.items.map((i) => {
            const obj = i.toObject();
            obj.system = i.system;
            return obj;
          });
          prepareCharacterItems(context, { includeSkills: true, includeMagicSkills: true });
          normalizeItemRanks(context.items);

          // Apply AE modifiers for custom skill items (non-persistent, sheet-only).
          // AE key pattern: skill.{Skill Name}.bonus
          const skillAEMods = collectSkillAEModifiers(actor);
          if (Object.keys(skillAEMods).length > 0) {
            for (const skillItem of context.actor.skill ?? []) {
              const mod = skillAEMods[skillItem.name];
              if (mod) skillItem.system.bonus = (Number(skillItem.system.bonus) || 0) + mod;
            }
            for (const skillItem of context.actor.professionSkill ?? []) {
              const mod = skillAEMods[skillItem.name];
              if (mod) skillItem.system.bonus = (Number(skillItem.system.bonus) || 0) + mod;
            }
          }

          const ui = context.actor.ui ?? {};
          const actorPatch = {
            gear: context.actor.gear,
            weapon: context.actor.weapon,
            armor: context.actor.armor,
            shield: context.actor.shield,
            power: context.actor.power,
            trait: context.actor.trait,
            talent: context.actor.talent,
            combatStyle: context.actor.combatStyle,
            spell: context.actor.spell,
            spellSchools: context.actor.spellSchools,
            ammunition: context.actor.ammunition,
            container: context.actor.container,
            skill: context.actor.skill,
            professionSkill: context.actor.professionSkill,
            magicSkill: context.actor.magicSkill,
            ui: {
              ...(context.actor.ui ?? {}),
              spellsBySchool: ui.spellsBySchool,
              traitStackingById: ui.traitStackingById,
            },
          };

          this._uesrpgItemsCache = {
            signature: itemsSignature,
            items: context.items,
            actorPatch,
          };
          this._traceSheetPerfPhase("items:cache-miss", perfItemsStart, { size: context.items.length });
        }
      } else {
        context.items = [];
        this._traceSheetPerfPhase("items:skipped", perfItemsStart, { requested: partScope.requestedList });
      }

      // Combat tab contexts
      const perfCombatStart = performance.now();
      if (_needs("combat")) {
        const combatSignature = getCombatSignature();
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
        const woundsSignature = getWoundsSignature();
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

      // Per-user UI state (loadouts, diagnostics) - sidebar + core both use sheetUi
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
        const itemsSignature = getItemsSignature();
        if (this._uesrpgEncumbranceCache && this._uesrpgEncumbranceCache.signature === itemsSignature) {
          annotateEncumbranceHighlights(context.actor, this._uesrpgEncumbranceCache.breakdown, { topN: 5 });
          this._traceSheetPerfPhase("encumbrance:cache-hit", perfEncStart, {});
        } else {
          const breakdown = buildEncumbranceBreakdown(actor);
          this._uesrpgEncumbranceCache = { signature: itemsSignature, breakdown };
          annotateEncumbranceHighlights(context.actor, breakdown, { topN: 5 });
          this._traceSheetPerfPhase("encumbrance:cache-miss", perfEncStart, {});
        }
      }

      context.engagementFlankingEnabled = isEngagementFlankingHomebrewEnabled();
      context.engagementFlankingMaxES = (() => {
        try {
          const val = actor?.flags?.[SYSTEM_ID]?.homebrew?.maxEngagementScore;
          return (typeof val === "number" && Number.isFinite(val)) ? val : "";
        } catch (_e) {
          return "";
        }
      })();

      // Core tab: enriched biography + social display
      if (_needs("core")) {
        const perfBioStart = performance.now();
        const rawBio = String(context.actor.system?.bio ?? "");
        if (this._uesrpgBioCache && this._uesrpgBioCache.raw === rawBio) {
          context.actor.system.enrichedBio = this._uesrpgBioCache.enriched;
          this._traceSheetPerfPhase("bio:cache-hit", perfBioStart, {});
        } else {
          context.actor.system.enrichedBio = await enrichBiography(rawBio, this);
          this._uesrpgBioCache = { raw: rawBio, enriched: context.actor.system.enrichedBio };
          this._traceSheetPerfPhase("bio:cache-miss", perfBioStart, {});
        }
        context.actor.system.socialDisplay = buildSocialDisplay(context.actor.system);
      }

      // Magic tab: spell effects breakdown (Origin AE summaries)
      if (_needs("magic")) {
        if (diagnosticsEnabled) {
          const { prepareSpellEffectsBreakdown } = await import("../shared/spell-effects-breakdown.js");
          context.spellEffectsBreakdown = prepareSpellEffectsBreakdown(actor);
        } else {
          context.spellEffectsBreakdown = null;
        }
      } else {
        context.spellEffectsBreakdown = null;
      }

      // Effects are rendered on Equipment tab and may also be needed by Magic flows.
      if (_needs("equipment") || _needs("magic")) {
        const perfEffectsStart = performance.now();
        const effectsSignature = getEffectsSignature();
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

      // Core tab: feature inspector + chargen wizard flag
      if (_needs("core")) {
        if (diagnosticsEnabled && getCachedSetting("showFeatureInspector")) {
          try {
            const { buildFeatureInspectorContext } = await import("../shared/feature-inspector.js");
            context.featureInspector = buildFeatureInspectorContext(actor);
          } catch (err) {
            console.warn("UESRPG | Feature inspector build failed", actor?.name, err);
            context.featureInspector = null;
          }
        } else {
          context.featureInspector = null;
        }
        context.useRawChargenWizard = Boolean(getCachedSetting("useRawChargenWizard"));
      } else {
        context.featureInspector = null;
        context.useRawChargenWizard = false;
      }

      return context;
    } finally {
      this._traceSheetPerf("_prepareContext", perfStart, {
        renderKeys: options ? Object.keys(options).length : 0,
      });
    }
  }
  /* Render Lifecycle */

  /** @override */
  _onRender(context, options) {
    const perfStart = performance.now();
    try {
      super._onRender(context, options);
      const el = this.element;
      if (!el) return;
      applySheetDensityClass(el);
      bindWindowRestoreGuard(this, el);
      warnIfDuplicateSidebar(this, "PCActorSheetV2", el, options);
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
        if (combatRoot instanceof HTMLElement) bindItemDescriptionTooltips(this, combatRoot);
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
        } catch (_e) {
          // no-op
        }
        this._traceSheetPerfPhase("dom:resource-bars", perfBarsStart, {});
      }

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

      if (partId === "sidebar") {
        if (htmlElement?.dataset?.uesrpgResourceListeners !== "1") {
          registerResourceButtonHandlers(this, htmlElement);
          htmlElement.dataset.uesrpgResourceListeners = "1";
        }
        return;
      }

      // All tab parts share the same listener registration.
      // querySelectorAll returns empty NodeLists for selectors absent in a
      // given tab, so every listener category can run against every tab safely.
      this._attachTabListeners(htmlElement);
    } finally {
      this._traceSheetPerf("_attachPartListeners", perfStart, { partId });
    }
  }

  /**
   * Register non-click event listeners on a tab part's DOM.
   * Called from _attachPartListeners for every non-sidebar part.
   * Selectors that don't match in a given tab silently find 0 elements.
   * @param {HTMLElement} el - The tab part's root element
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
          await postItemToChat(ev, this.document, { includeImage: true, element: magicEl });
          return;
        }
        const skillEl = ev.target?.closest?.(".skill-roll-target");
        if (skillEl && root?.contains?.(skillEl)) {
          ev.preventDefault();
          this._onItemOpen(ev, skillEl);
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
      this._uesrpgTabChangeHandler = () => {};
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
        const kbd = ev.target?.closest?.(".uesrpg-actions-subtab, .uesrpg-group-toggle, .skill-roll-target");
        if (!kbd || !root?.contains?.(kbd)) return;
        ev.preventDefault();
        kbd.click?.();
      };
    }

    el.addEventListener("contextmenu", this._uesrpgTabContextMenuHandler);
    el.addEventListener("change", this._uesrpgTabChangeHandler);
    el.addEventListener("input", this._uesrpgTabInputHandler);
    el.addEventListener("keydown", this._uesrpgTabKeydownHandler);

  }

  /* ═══════════════════════ Collapsible Groups ════════════════════════ */

  /* ═══════════════════════ Delegated Handlers ════════════════════════ */

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
  async _onAdvancementMenu(event, target) { return onAdvancementMenu.call(this, event, target); }
  async _onClickCharacteristic(event, target) { return onClickCharacteristic.call(this, event, target); }
  async _onSkillRoll(event, target) { return onSkillRoll.call(this, event, target); }
  async _onSpellRoll(event, target) { return onSpellRoll.call(this, event, target); }
  async _onCombatRoll(event, target) { return onCombatRoll.call(this, event, target); }
  async _onResistanceRoll(event, target) { return onResistanceRoll.call(this, event, target); }
  async _onDamageRoll(event, target) { return onDamageRoll.call(this, event, target); }
  async _onCastMagicAction(event, target, preselectedSpell = null) { return onCastMagicAction.call(this, event, target, preselectedSpell); }
  async _onCastEnchantmentAction(event, target) { return onCastEnchantmentAction.call(this, event, target); }

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
      console.warn("UESRPG | Failed to copy feature inspector data", err);
      ui.notifications?.warn?.("Failed to copy to clipboard. Try using a secure (HTTPS) context.");
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

  /** Open item sheet on name click */
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

  async _onCancelSpell(event, target) {
    event.preventDefault();
    const effectId = target?.dataset?.effectId;
    if (!effectId) return;
    const effect = this.document.effects?.get(effectId);
    if (!effect) return;
    const confirmed = await confirmDialog({
      title: "Cancel Spell",
      content: `<p>Cancel <strong>${effect.flags?.[SYSTEM_ID]?.spellName ?? effect.name}</strong>? This will end the spell and remove all linked effects.</p>`,
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
  async _onEncBreakdown(_event, _target) {
    if (!game?.settings?.get?.(SYSTEM_ID, "encumbranceUiEnhanced")) return;
    return openEncumbranceBreakdownDialog(this.document);
  }
  _onLuckyMenu(event, target) { return onLuckyMenu.call(this, event, target); }
  async _onBurnLuck(_event, _target) {
    const { openBurnLuckFromSheet } = await import("../../../core/luck/luck-workflow.js");
    return openBurnLuckFromSheet(this.document);
  }
  async _onRaceMenu(event, target) { return onRaceMenu.call(this, event, target); }
  async _onBirthSignMenu(event, target) { return onBirthSignMenu.call(this, event, target); }
  async _onOpenLanguageSelector(event, target) {
    event?.preventDefault?.();
    const { LanguageSelectorAppV2 } = await import("../../apps/v2/social-selectors.js");
    await LanguageSelectorAppV2.prompt(this.document);
  }
  async _onOpenFactionSelector(event, target) {
    event?.preventDefault?.();
    const { FactionSelectorAppV2 } = await import("../../apps/v2/social-selectors.js");
    await FactionSelectorAppV2.prompt(this.document);
  }
  _onXPMenu(event, target) { return onXPMenu.call(this, event, target); }
  async _onStartingResourcesMenu(event, target) { return onStartingResourcesMenu.call(this, event, target); }
  async _onSpendXpMenu(event, _target) {
    event?.preventDefault?.();
    const { SpendXpMenuAppV2 } = await import("../../apps/v2/char-gen/spend-xp-menu.js");
    await SpendXpMenuAppV2.prompt(this.document);
  }
  async _onRawChargenWizard(event, _target) {
    event?.preventDefault?.();
    const { CharGenWizardAppV2 } = await import("../../apps/v2/char-gen/char-gen-wizard.js");
    const existing = Object.values(ui.windows ?? {}).find((w) => w instanceof CharGenWizardAppV2);
    if (existing) {
      if (typeof existing.maximize === "function") await existing.maximize();
      existing.bringToTop?.();
      return;
    }
    const app = new CharGenWizardAppV2({
      actorUuid: this.document?.uuid ?? null,
      name: this.document?.name ?? "",
    });
    await app.render(true);
  }
  async _onIncrementResource(event, target) { return onIncrementResource.call(this, event, target); }
  async _onResetResource(event, target) { return onResetResource.call(this, event, target); }
  async _onIncrementFatigue(event, target) { return onIncrementFatigue.call(this, event, target); }
  async _onShortRest(event, target) { return onShortRest.call(this, event, target); }
  async _onLongRest(event, target) { return onLongRest.call(this, event, target); }

  /* ═══════════════════════ Drag & Drop ═══════════════════════════════ */

  /**
   * Build a proper Item drag payload from data-item-id.
   * The base ActorSheetV2._onDragStart relies on data-document-uuid which actor
   * inventory rows do not carry; this override resolves the live Item document
   * and stamps the correct { type, uuid } payload so same-sheet and cross-sheet
   * drops both work correctly.
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

    const traceId = makeDndTraceId("pc-drag");
    const payload = buildItemDragPayload(item, { traceId });
    event.dataTransfer?.setData("text/plain", JSON.stringify(payload));
    dndDebug("sheet.dragstart.fallback", {
      sheet: "PCActorSheetV2",
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
    const traceId = makeDndTraceId("pc-drop");
    const data = readDropData(event, { traceId });
    dndDebug("sheet.drop.received", {
      sheet: "PCActorSheetV2",
      actor: this.document?.uuid ?? null,
      type: data?.type ?? null,
      uuid: data?.uuid ?? null,
      itemId: data?.itemId ?? null,
    }, { traceId });

    if (data.type === "Item") {
      const resolved = await resolveDroppedItemDetailed(data, { traceId });
      const item = resolved.item;
      if (!item) {
        dndDebug("sheet.drop.unresolved", {
          sheet: "PCActorSheetV2",
          actor: this.document?.uuid ?? null,
          data,
          resolved,
        }, { traceId });
        dndWarnFailure("Unable to resolve dropped item payload.", {
          traceId,
          details: {
            sheet: "PCActorSheetV2",
            actor: this.document?.uuid ?? null,
            data,
            resolved,
          },
        });
        return super._onDrop(event);
      }

      const isExternalItem = item.actor?.id !== this.document.id;
      if (!isExternalItem) {
        dndDebug("sheet.drop.sameActor", {
          sheet: "PCActorSheetV2",
          actor: this.document?.uuid ?? null,
          item: item?.uuid ?? null,
          sourceKind: resolved.sourceKind,
        }, { traceId });
        return super._onDrop(event);
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

      // External item drops (compendium/world/other actor): create explicitly so
      // we can normalize legacy generic-item types on first drop.
      if (!this.isEditable || !this.document?.isOwner) {
        dndWarnFailure("You do not have permission to modify this actor's inventory.", {
          traceId,
          details: {
            sheet: "PCActorSheetV2",
            actor: this.document?.uuid ?? null,
            item: item?.uuid ?? null,
          },
        });
        return;
      }

      try {
        const created = await handleExternalItemDrop(this.document, item, {
          normalizeType: true,
          traceId,
        });
        if (!created) {
          throw new Error("handleExternalItemDrop returned null");
        }
        dndDebug("sheet.drop.externalCreate.success", {
          sheet: "PCActorSheetV2",
          actor: this.document?.uuid ?? null,
          sourceItem: item?.uuid ?? null,
          sourceKind: resolved.sourceKind,
          createdId: created?.id ?? null,
          createdType: created?.type ?? null,
        }, { traceId });
        return;
      } catch (err) {
        dndDebug("sheet.drop.externalCreate.failed", {
          sheet: "PCActorSheetV2",
          actor: this.document?.uuid ?? null,
          item: item?.uuid ?? null,
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
              sheet: "PCActorSheetV2",
              actor: this.document?.uuid ?? null,
              item: item?.uuid ?? null,
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
      if (this._uesrpgRestoreDblClickEl && this._uesrpgRestoreDblClickHandler) {
        this._uesrpgRestoreDblClickEl.removeEventListener("dblclick", this._uesrpgRestoreDblClickHandler, true);
      }
      this._uesrpgRestoreDblClickHandler = null;
      this._uesrpgRestoreDblClickEl = null;
      if (this._uesrpgRenderPartsRafId != null) cancelAnimationFrame(this._uesrpgRenderPartsRafId);
      this._uesrpgRenderPartsRafId = null;
      this._uesrpgRenderPartsPromise = null;
      this._uesrpgRenderPartsResolvers = [];
      this._uesrpgQueuedParts = null;
      this._uesrpgBioCache = null;
      this._uesrpgItemsCache = null;
      this._uesrpgCombatCache = null;
      this._uesrpgWoundsUiCache = null;
      this._uesrpgEffectsCache = null;
      this._uesrpgEncumbranceCache = null;
      this._uesrpgSheetUiCache = null;
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
