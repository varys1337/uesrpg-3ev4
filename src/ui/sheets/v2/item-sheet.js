import { editSheetPortrait } from "./shared/file-picker.js";
import { _inferTypedLaneFromText, _extractFirstNumber } from '../../../core/documents/item-utils.js';

/**
 * src/ui/sheets/v2/item-sheet.js
 *
 * ApplicationV2 Item Sheet.
 *
 * Key improvements:
 * - Uses HandlebarsApplicationMixin(ItemSheetV2) base
 * - Native per-type header, tabs, and body render parts
 * - Deterministic form handler -> normalizer -> document.update pipeline
 * - _preRender / _onRender lifecycle for cross-render UI state preservation
 */

import { normalizeItemFormData, validateSpellScaling } from "../item/normalize-item-form-data.js";
import { prepareItemSheetData, prepareItemSheetHeaderData } from "../item/prepare.js";
import {
  onAddToContainer, onBulkAddToContainer, onBulkRemoveFromContainer,
  onBulkDeleteContained, onRemoveContainedItem, onDeleteContainedItem,
  onOpenContainedItem, onDropItemIntoContainer,
  buildContainerContainedItemsSnapshot,
} from "../item/listeners/containment.js";
import { onEffectControl } from "../item/listeners/effects.js";
import { onChargePlus, onChargeMinus } from "../item/listeners/usage.js";
import { activateTalentFromItemSheet, activatePowerFromItemSheet, activateTraitFromItemSheet } from "../shared-handlers.js";
import { getScalingLevelsArray, normalizeScalingEntry, logSpellDebug } from "../item/spell-scaling-helpers.js";
import { requestAtomicUpdateDocument, requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { activateProseMirrorEditors } from "../shared/editor-activation.js";
import { ITEM_TYPE_MODEL_SEEDS } from "../../../core/data-models/defaults.generated.js";

import { readDropData, resolveDroppedItem } from "../../../utils/drop-data.js";
import { onCastEnchantmentAction } from "../shared/listeners/enchanting-cast.js";
import {
  onEnableAlchemyIngredient, onClearAlchemyIngredient,
  onEnableAlchemyProduct, onClearAlchemyProduct,
  onDrinkAlchemyProduct, onApplyAlchemyProductToWeapon,
} from "../item/item-sheet-alchemy.js";
import {
  onClearSoulEnergyItem,
  onEnableSoulEnergyItem,
  registerSoulEnergyListeners,
} from "../item/item-sheet-soul-energy.js";
import {
  ALCHEMY_PRODUCT_DROP_SELECTOR,
  clearAlchemyProductEffectSlot,
  handleAlchemyProductSpellDrop,
  registerAlchemyProductListeners,
  updateAlchemyProductEffectLevel,
} from "../item/item-sheet-alchemy-effects.js";
import {
  onCastScroll, onToggleSpellcastingEnable,
  onAddSpellcastingSlot, onRemoveSpellcastingSlot,
  onClearSpellcastingStoredSpell,
  onEditSpellcastingSlot, onPickSpellcastingSlotSpell,
  registerItemSpellcastingListeners, registerScrollListeners,
  resolveAndValidateScrollSpell, applyScrollSpellLink,
} from "../item/item-sheet-spellcasting.js";
import { bindItemDescriptionTooltips, clearItemDescriptionTooltip } from "./shared/sheet-tooltips.js";
import { applySheetDensityClass } from "./shared/sheet-density.js";

import { buildItemDragPayload } from "../../../utils/drag-payload.js";
import { dndDebug, makeDndTraceId } from "../../../utils/dnd-debugger.js";
import { containerDebug, containerWarn } from "../../../utils/dev/container-debug.js";
import { buildAdvancementPlan } from "../item/advancement-plan.js";
import { SYSTEM_ID, templatePath } from "../../constants.js";
import { createDebugLogger, traceSheetPerf } from "../../../utils/debug.js";
import { resolveUuidSync } from "../../../utils/uuid-cache.js";
import { getArmorCategoryCoverage } from "../../../core/items/armor-coverage.js";
import { t, tf } from "../../../utils/i18n.js";
import {
  clearSheetFormUpdateState,
  flushCurrentSheetForm,
  flushSheetFormUpdates,
  queueSheetFormUpdate,
} from "./shared/sheet-runtime-helpers.js";
import {
  createFormPathMatcher,
  filterAllowedFormPaths,
} from "./shared/form-pipeline.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ItemSheetV2Base = foundry.applications.sheets.ItemSheetV2;
const ITEM_SHEET_TEMPLATE_BASE = templatePath("v2/sheets");
const ITEM_SHEET_PART_TEMPLATE_BASE = `${ITEM_SHEET_TEMPLATE_BASE}/item-parts`;
const ITEM_SHEET_TYPES = Object.freeze([
  "ammunition", "armor", "shield", "combatStyle", "container", "equipment", "item", "invocation",
  "magicSkill", "power", "scroll", "skill", "spell", "talent", "trait", "weapon",
]);
const ITEM_SHEET_PART_MAP = Object.freeze(Object.fromEntries(ITEM_SHEET_TYPES.map((type) => [type, Object.freeze({
  header: `${ITEM_SHEET_PART_TEMPLATE_BASE}/${type}-header.hbs`,
  body: `${ITEM_SHEET_TEMPLATE_BASE}/${type}-sheet.hbs`,
})])));
const DEFAULT_ITEM_SHEET_PARTS = ITEM_SHEET_PART_MAP.equipment;
const ALLOW_ITEM_FORM_PATH = createFormPathMatcher({
  exact: ["name"],
  prefixes: [
    "system.",
    "flags.",
    "qualitiesStructured.",
    "qualitiesTraits.",
    "activationDamageQualities.",
    "activationDamageQualitiesStructured.",
    "activationDamageQualitiesTraits.",
  ],
});
const ITEM_SHEET_TABS = Object.freeze({
  ammunition: [["description", "UESRPG.UI.Description"], ["attributes", "UESRPG.Sheets.Item.Attributes"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  armor: [["description", "UESRPG.UI.Description"], ["attributes", "UESRPG.Sheets.Item.Attributes"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  shield: [["description", "UESRPG.UI.Description"], ["attributes", "UESRPG.Sheets.Item.Attributes"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  combatStyle: [["description", "UESRPG.UI.Description"], ["combatStyle", "UESRPG.Sheets.Item.CombatStyle"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  container: [["attributes", "UESRPG.Sheets.Container.Contents"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  equipment: [["description", "UESRPG.UI.Description"], ["attributes", "UESRPG.Sheets.Item.Attributes"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  item: [["description", "UESRPG.UI.Description"], ["attributes", "UESRPG.Sheets.Item.Attributes"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  invocation: [["overview", "UESRPG.Sheets.Item.Overview"], ["ritual", "UESRPG.Sheets.Item.Ritual"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  magicSkill: [["description", "UESRPG.UI.Description"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  power: [["description", "UESRPG.UI.Description"], ["attributes", "UESRPG.Sheets.Item.Attributes"], ["automation", "UESRPG.Sheets.Feature.Automation", "enableRuleElements"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  scroll: [["description", "UESRPG.UI.Description"], ["spell", "UESRPG.Sheets.Item.SpellReference"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  skill: [["description", "UESRPG.UI.Description"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  spell: [["description", "UESRPG.Sheets.Item.Overview"], ["casting", "UESRPG.Sheets.Item.Casting"], ["automation", "UESRPG.Sheets.Feature.Automation"]],
  talent: [["description", "UESRPG.UI.Description"], ["attributes", "UESRPG.Sheets.Item.Attributes"], ["automation", "UESRPG.Sheets.Feature.Automation", "enableRuleElements"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  trait: [["description", "UESRPG.UI.Description"], ["attributes", "UESRPG.Sheets.Item.Attributes"], ["automation", "UESRPG.Sheets.Feature.Automation", "enableRuleElements"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
  weapon: [["description", "UESRPG.UI.Description"], ["attributes", "UESRPG.Sheets.Item.Attributes"], ["effects", "UESRPG.Sheets.Equipment.Effects"]],
});

const _ARMOR_TYPED_NUMERIC_FIELDS = new Set(["magic_ar", "special_ar", "armor", "blockRating"]);
const _shieldDebug = createDebugLogger("shieldDebug", "[UESRPG][ShieldDebug][ItemSheet]");

// AppV1 deprecation warnings seen in recent logs are emitted by external modules
// (e.g. chat-pruner and SimpleQuest), not by this item sheet implementation.

function _isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function _cloneForRender(value) {
  try {
    return foundry?.utils?.deepClone ? foundry.utils.deepClone(value ?? {}) : structuredClone(value ?? {});
  } catch (_e) {
    return JSON.parse(JSON.stringify(value ?? {}));
  }
}


function _coerceNumericValue(raw, defaultValue, path, rootSystem) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw === undefined || raw === null || raw === "") return Number(defaultValue ?? 0) || 0;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum)) return asNum;

    const parsed = _extractFirstNumber(trimmed);
    if (parsed !== null) {
      const field = path[path.length - 1] ?? "";
      if (_ARMOR_TYPED_NUMERIC_FIELDS.has(field)) {
        const lane = _inferTypedLaneFromText(trimmed);
        if (lane && !String(rootSystem?.special_ar_type ?? "").trim()) {
          rootSystem.special_ar_type = lane;
        }
      }
      return parsed;
    }
  }

  return Number(defaultValue ?? 0) || 0;
}

function _buildLinkedSpellSummary(linked) {
  return {
    uuid: String(linked?.uuid ?? ""),
    name: String(linked?.name ?? ""),
    school: String(linked?.system?.school ?? ""),
    level: Number(linked?.system?.level ?? 1),
    cost: Number(linked?.system?.cost ?? 0),
    form: String(linked?.system?.form ?? ""),
    range: String(linked?.system?.rangeType ?? linked?.system?.range ?? ""),
    duration: {
      value: Number(linked?.system?.duration?.value ?? 0),
      unit: String(linked?.system?.duration?.unit ?? "instant"),
    },
    isInstant: linked?.system?.isInstant === true,
    isDirect: linked?.system?.isDirect === true,
    isZonePersistent: linked?.system?.isZonePersistent === true,
    isRuneSpell: linked?.system?.isRuneSpell === true,
    hasOverTime: linked?.system?.hasOverTime === true,
    hasOverload: linked?.system?.hasOverload === true,
    isSummonSpell: linked?.system?.isSummonSpell === true,
    hasBuffer: linked?.system?.hasBuffer === true,
    damageInstances: Array.isArray(linked?.system?.damageInstances)
      ? linked.system.damageInstances
          .filter((di) => di && typeof di === "object")
          .map((di) => ({
            formula: String(di.formula ?? ""),
            type: String(di.type ?? "none"),
            label: String(di.label ?? ""),
          }))
      : [],
  };
}

function _mergeLiveItemProseValues(flatData, root) {
  if (!root || typeof root.querySelector !== "function") return flatData;
  const nextFlatData = flatData ?? {};
  const editor = root.querySelector('prose-mirror[name="system.description"]');
  if (!editor || !("value" in editor)) return nextFlatData;

  const liveValue = editor.value;
  if (liveValue === undefined) return nextFlatData;
  nextFlatData["system.description"] = String(liveValue ?? "");
  return nextFlatData;
}

function _sanitizeNumericBySchema(node, schema, rootSystem, path = []) {
  if (!_isPlainObject(schema)) return;
  if (!_isPlainObject(node)) return;

  for (const [key, schemaValue] of Object.entries(schema)) {
    const nextPath = path.concat(key);
    const current = node[key];

    if (typeof schemaValue === "number") {
      node[key] = _coerceNumericValue(current, schemaValue, nextPath, rootSystem);
      continue;
    }

    if (_isPlainObject(schemaValue)) {
      if (!_isPlainObject(current)) node[key] = {};
      _sanitizeNumericBySchema(node[key], schemaValue, rootSystem, nextPath);
      continue;
    }
  }
}

function _buildSanitizedRenderSystem(itemType, systemData) {
  const cloned = _cloneForRender(systemData ?? {});
  const schema = ITEM_TYPE_MODEL_SEEDS?.[itemType] ?? null;
  if (!schema) return cloned;
  _sanitizeNumericBySchema(cloned, schema, cloned);
  return cloned;
}


export class SimpleItemSheetV2 extends HandlebarsApplicationMixin(ItemSheetV2Base) {

  /** @type {object|null} Snapshot of DOM-only UI state saved before re-render */
  _savedState = null;

  /**
   * Native AppV2 tab configuration.
   * The "primary" group covers all per-type tab sets; the superset is declared
   * here so that `tabGroups` is initialised.  Each per-type template only
   * renders the subset of tabs it actually uses, so extra ids are harmless.
   * @type {Record<string, ApplicationTabsConfiguration>}
   */
  static TABS = {
    primary: {
      tabs: [
        { id: "description" },
        { id: "overview" },
        { id: "attributes" },
        { id: "casting" },
        { id: "information" },
        { id: "automation" },
        { id: "combatStyle" },
        { id: "ritual" },
        { id: "spell" },
        { id: "effects" },
      ],
      initial: "description",
    },
    secondary: {
      tabs: [
        { id: "attributes" },
        { id: "effect" },
      ],
      initial: "attributes",
    },
  };

  /* Static Configuration */

  static DEFAULT_OPTIONS = {
    classes: ["worldbuilding", "sheet", "item", "uesrpg-sheet-root"],
    position: { width: 640, height: 620 },
    window: { resizable: true },
    form: {
      handler: SimpleItemSheetV2.prototype._onFormSubmit,
      submitOnChange: false,
      closeOnSubmit: false,
    },
    dragDrop: [{
      dragSelector: ".item",
      dropSelector: `.window-content, .sheet-body, .tab, .itemListContainer, ${ALCHEMY_PRODUCT_DROP_SELECTOR}`,
    }],
    actions: {
      editPortrait: SimpleItemSheetV2.prototype._onEditPortrait,
      effectControl: SimpleItemSheetV2.prototype._onEffectControl,
      chargePlus: SimpleItemSheetV2.prototype._onChargePlus,
      chargeMinus: SimpleItemSheetV2.prototype._onChargeMinus,
      applyCategoryCoverage: SimpleItemSheetV2.prototype._onApplyCategoryCoverage,
      talentUse: SimpleItemSheetV2.prototype._onTalentUse,
      powerUse: SimpleItemSheetV2.prototype._onPowerUse,
      traitUse: SimpleItemSheetV2.prototype._onTraitUse,
      setActiveStyle: SimpleItemSheetV2.prototype._onSetActiveStyle,
      deactivateStyle: SimpleItemSheetV2.prototype._onDeactivateStyle,
      addScalingLevel: SimpleItemSheetV2.prototype._onAddScalingLevel,
      removeScalingLevel: SimpleItemSheetV2.prototype._onRemoveScalingLevel,
      addOvertimeEntry: SimpleItemSheetV2.prototype._onAddOvertimeEntry,
      removeOvertimeEntry: SimpleItemSheetV2.prototype._onRemoveOvertimeEntry,
      addEffectRecipe: SimpleItemSheetV2.prototype._onAddEffectRecipe,
      removeEffectRecipe: SimpleItemSheetV2.prototype._onRemoveEffectRecipe,
      conjureClear: SimpleItemSheetV2.prototype._onConjureClear,
      addDamageInstance: SimpleItemSheetV2.prototype._onAddDamageInstance,
      removeDamageInstance: SimpleItemSheetV2.prototype._onRemoveDamageInstance,
      // Containment actions
      addToContainer: SimpleItemSheetV2.prototype._onAddToContainer,
      bulkRemoveAll: SimpleItemSheetV2.prototype._onBulkRemoveAll,
      bulkDeleteAll: SimpleItemSheetV2.prototype._onBulkDeleteAll,
      removeContainedItem: SimpleItemSheetV2.prototype._onRemoveContainedItem,
      deleteContainedItem: SimpleItemSheetV2.prototype._onDeleteContainedItem,
      openContainedItem: SimpleItemSheetV2.prototype._onOpenContainedItem,
      // Alchemy ingredient actions
      enableAlchemyIngredient: SimpleItemSheetV2.prototype._onEnableAlchemyIngredient,
      clearAlchemyIngredient: SimpleItemSheetV2.prototype._onClearAlchemyIngredient,
      enableSoulEnergyItem: SimpleItemSheetV2.prototype._onEnableSoulEnergyItem,
      clearSoulEnergyItem: SimpleItemSheetV2.prototype._onClearSoulEnergyItem,
      // Alchemy product actions
      enableAlchemyProduct: SimpleItemSheetV2.prototype._onEnableAlchemyProduct,
      clearAlchemyProduct: SimpleItemSheetV2.prototype._onClearAlchemyProduct,
      clearAlchemyProductEffect: SimpleItemSheetV2.prototype._onClearAlchemyProductEffect,
      drinkAlchemyProduct: SimpleItemSheetV2.prototype._onDrinkAlchemyProduct,
      applyAlchemyProductToWeapon: SimpleItemSheetV2.prototype._onApplyAlchemyProductToWeapon,
      // Scroll actions
      castScroll: SimpleItemSheetV2.prototype._onCastScroll,
      castEnchantment: SimpleItemSheetV2.prototype._onCastEnchantment,
      toggleSpellcastingEnable: SimpleItemSheetV2.prototype._onToggleSpellcastingEnable,
      addSpellcastingSlot: SimpleItemSheetV2.prototype._onAddSpellcastingSlot,
      removeSpellcastingSlot: SimpleItemSheetV2.prototype._onRemoveSpellcastingSlot,
      clearSpellcastingStoredSpell: SimpleItemSheetV2.prototype._onClearSpellcastingStoredSpell,
      editSpellcastingSlot: SimpleItemSheetV2.prototype._onEditSpellcastingSlot,
      pickSpellcastingSlotSpell: SimpleItemSheetV2.prototype._onPickSpellcastingSlotSpell,
    },
  };

  static PARTS = {
    header: {
      template: templatePath("v2/sheets/item-parts/equipment-header.hbs"),
    },
    tabs: {
      template: templatePath("v2/sheets/item-parts/tabs.hbs"),
    },
    body: {
      template: templatePath("v2/sheets/equipment-sheet.hbs"),
    },
  };

  /** Keep item window title to the document name only (no localized type prefix). */
  get title() {
    return this.document?.name ?? "";
  }

  /** V1 compat: several shared handlers still read `sheet.actor`. */
  get actor() {
    return this.document?.actor ?? null;
  }

  /** V1 compat: shared helpers may read `sheet.item`. */
  get item() {
    return this.document ?? null;
  }

  /* Rendering */

  /**
   * @override
   * Select the native header and body fragments for the current Item type.
   * @override
   */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const type = this.document.type;
    const templates = ITEM_SHEET_PART_MAP[type] ?? DEFAULT_ITEM_SHEET_PARTS;
    parts.header = { ...(parts.header ?? {}), template: templates.header };
    parts.body = { ...(parts.body ?? {}), template: templates.body };
    return parts;
  }

  /**
   * @override
   * Prepare render context for templates.
   * Builds the item context object and delegates to shared
   * `prepareItemSheetData()` helpers.
   */
  async _prepareContext(options) {
    const perfStart = performance.now();
    try {
      const context = await super._prepareContext(options);

    // Item fields expected by templates + prepareItemSheetData
    // Overlay live system data so derived fields (value, *Effective, etc.)
    // survive into templates - same pattern as actor sheets.
    context.item = this.document.toObject();
    context.item.uuid = this.document.uuid;
    context.item.system = _buildSanitizedRenderSystem(this.document?.type, context.item.system);
    context.data = context.item.system; // legacy alias
    context.editable = this.isEditable;
      context.isGM = game.user.isGM;
      context.owner = this.document.isOwner;
      context.limited = this.document.limited;
      context.cssClass = this.isEditable ? "editable" : "locked";
      context.options = { editable: this.isEditable };

      const requestedParts = Array.isArray(options?.parts) && options.parts.length
        ? new Set(options.parts)
        : null;
      const bodyRequested = !requestedParts || requestedParts.has("body");

      // Header/tab-only renders intentionally skip description enrichment,
      // effect preparation, spell-engine normalization, and UUID resolution.
      const prepared = bodyRequested
        ? await prepareItemSheetData(this, context)
        : prepareItemSheetHeaderData(this, context);

      if (bodyRequested && this.document.type === "container" && this.document.isOwned && this.document.actor) {
        const containedItems = buildContainerContainedItemsSnapshot(this.document.actor, this.document);
        const staleSnapshotCount = Array.isArray(this.document.system?.contained_items)
          ? this.document.system.contained_items.length
          : 0;
        containerDebug("sheet.context.container", {
          actor: this.document.actor?.uuid ?? null,
          container: this.document?.uuid ?? null,
          containerId: this.document?.id ?? null,
          derivedCount: containedItems.length,
          snapshotCount: staleSnapshotCount,
          derivedItemIds: containedItems.map((entry) => entry?._id ?? ""),
        });
        if (!containedItems.length && staleSnapshotCount > 0) {
          containerWarn("sheet.context.container.empty-derived-with-stale-snapshot", {
            actor: this.document.actor?.uuid ?? null,
            container: this.document?.uuid ?? null,
            containerId: this.document?.id ?? null,
            snapshotCount: staleSnapshotCount,
          });
        }
        prepared.containedItems = containedItems;
        prepared.hasContainedItems = containedItems.length > 0;
        prepared.item.system = {
          ...(prepared.item.system ?? {}),
          contained_items: containedItems,
        };
        prepared.data = prepared.item.system;
      }

      if (bodyRequested && this.document.type === "scroll") {
        prepared.scrollLinkedSpell = null;
        prepared.hasLinkedSpell = false;
        prepared.linkedSpellUnresolved = false;

        const spellUuid = String(this.document.system?.spellUuid ?? "").trim();
        if (spellUuid) {
          try {
            let linked = null;
            const liveSync = resolveUuidSync(spellUuid);
            linked = liveSync ?? await fromUuid(spellUuid);
            if (linked?.documentName === "Item" && String(linked?.type ?? "") === "spell") {
              prepared.scrollLinkedSpell = _buildLinkedSpellSummary(linked);
              prepared.hasLinkedSpell = true;
            } else {
              prepared.linkedSpellUnresolved = true;
            }
          } catch (_err) {
            prepared.linkedSpellUnresolved = true;
          }
        }
      }

      const configuredTabs = ITEM_SHEET_TABS[this.document.type] ?? ITEM_SHEET_TABS.equipment;
      const visibleTabs = configuredTabs.filter(([, , condition]) => !condition || prepared[condition] === true);
      const requestedTab = String(this.tabGroups?.primary ?? "");
      const activeTab = visibleTabs.some(([id]) => id === requestedTab)
        ? requestedTab
        : (visibleTabs[0]?.[0] ?? "description");
      this.tabGroups.primary = activeTab;
      prepared.itemSheetTabs = visibleTabs.map(([id, label]) => ({
        id,
        label,
        active: id === activeTab,
      }));
      prepared.itemSheetSpellTabs = ["spell", "invocation"].includes(this.document.type);

      return prepared;
    } finally {
      traceSheetPerf({
        sheet: "SimpleItemSheetV2",
        document: this.document,
        stage: "_prepareContext",
        startedAtMs: perfStart,
        // Avoid expensive queries; only log lightweight counters.
        details: {
          renderKeys: options ? Object.keys(options).length : 0,
        },
        warnThresholdMs: 40,
      });
    }
  }

  /* Form Submission */

  async _onChangeForm(formConfig, event) {
    if (typeof super._onChangeForm === "function") super._onChangeForm(formConfig, event);
    if (!this.isEditable || !this.document?.isOwner) return;

    const target = event?.target;
    const path = String(target?.getAttribute?.("name") ?? "").trim();
    if (path.startsWith("alchemy-effect-level-")) {
      const slotIdx = Number.parseInt(path.slice("alchemy-effect-level-".length), 10);
      if (!Number.isFinite(slotIdx) || slotIdx < 0) return;
      return queueSheetFormUpdate(this, () => updateAlchemyProductEffectLevel(this, slotIdx, target?.value ?? 1));
    }
    if (path !== "system.description" || !("value" in (target ?? {}))) return;

    const nextValue = String(target.value ?? "");
    const currentValue = String(this.document?.system?.description ?? "");
    if (Object.is(currentValue, nextValue)) return;

    return queueSheetFormUpdate(this, () => requestUpdateDocument(this.document, { "system.description": nextValue }));
  }

  /**
   * Form submit handler for AppV2.
   * Normalizes form data via the shared normalizer, validates spell scaling,
   * then persists via document.update().
   *
   * Uses diffObject to send only changed fields, preventing stale-data
   * overwrites in multiplayer and reducing unnecessary re-renders.
   *
   * Called by the framework with `this` bound to the app instance.
   */
  async _onFormSubmit(event, form, formData) {
    let flatData = filterAllowedFormPaths(formData.object, ALLOW_ITEM_FORM_PATH);
    flatData = _mergeLiveItemProseValues(flatData, form);
    const docType = String(this.document?.type ?? "").toLowerCase();
    const isShieldLaneDoc = docType === "shield" || (docType === "armor" && (
      this.document?.system?.isShield === true
      || String(this.document?.system?.item_cat ?? "").toLowerCase() === "shield"
      || String(this.document?.system?.category ?? "").toLowerCase() === "shield"
    ));
    if (isShieldLaneDoc) {
      _shieldDebug("form submit raw", {
        id: this.document?.id ?? null,
        name: this.document?.name ?? null,
        type: this.document?.type ?? null,
        keys: Object.keys(flatData ?? {}).sort(),
        headerProbe: {
          quantity: flatData["system.quantity"],
          enc: flatData["system.enc"],
          blockRating: flatData["system.blockRating"],
          magicBR: flatData["system.magic_br"],
          contained: flatData["system.containerStats.contained"],
          containerId: flatData["system.containerStats.container_id"],
        },
      });
    }
    const { scalingLevels, soulEnergyIssue } = normalizeItemFormData(this.document, flatData);

    if (soulEnergyIssue) {
      const key = soulEnergyIssue === "reusable-stack"
        ? "UESRPG.Notifications.Enchanting.ReusableSoulVesselStack"
        : "UESRPG.Notifications.Enchanting.SoulEnergyExceedsCapacity";
      ui.notifications?.warn?.(t(key));
      return false;
    }

    if (
      this.document.type === "spell" &&
      scalingLevels.length > 0 &&
      !event?.uesrpgSkipScalingValidation
    ) {
      const blocked = await validateSpellScaling(this.document, flatData, scalingLevels);
      if (blocked) return false;
    }
    const advancement = buildAdvancementPlan(this.document, flatData);
    if (!advancement.ok) {
      ui.notifications?.warn?.(advancement.reason || "Unable to apply advancement changes.");
      return false;
    }

    // Diff against current document state - only send changed fields
    const current = foundry.utils.flattenObject(this.document.toObject(false));
    flatData = foundry.utils.diffObject(current, flatData);
    if (foundry.utils.isEmpty(flatData)) return { ok: true, changed: {} };

    if (isShieldLaneDoc) {
      _shieldDebug("form submit diff", {
        id: this.document?.id ?? null,
        name: this.document?.name ?? null,
        type: this.document?.type ?? null,
        diff: flatData,
      });
    }

    const updated = await requestUpdateDocument(this.document, flatData);
    if (!updated) return false;
    if (advancement.xpCost > 0 && advancement.actor) {
      const actorUpdated = await requestUpdateDocument(advancement.actor, { "system.xp": advancement.nextXp });
      if (!actorUpdated) return false;
      ui.notifications?.info?.(game.i18n.format("UESRPG.Notifications.Items.SpentXp", { xp: advancement.xpCost }));
    }
    return {
      ok: true,
      changed: foundry.utils.deepClone(flatData),
    };
  }

  async _submitCurrentForm(event = null) {
    // Event-driven spell controls still need their explicit event metadata.
    if (event) return flushCurrentSheetForm(this, this._onFormSubmit, event);

    if (!await flushSheetFormUpdates(this)) return false;
    if (!this.isEditable || !this.document?.isOwner) return true;
    const notifyFailure = () => {
      ui.notifications?.error?.(t("UESRPG.Notifications.Sheets.FormSaveFailed"));
      return false;
    };

    // ApplicationV2 owns construction of FormDataExtended for its top-level
    // form. Do not silently skip submission when the form is unavailable.
    const form = this.form;
    if (!(form instanceof HTMLFormElement) || !form.isConnected) return notifyFailure();
    try {
      const result = await this.submit();
      return result !== false && result?.ok !== false ? true : notifyFailure();
    } catch (error) {
      console.error("UESRPG | Item sheet native form submission failed", error);
      return notifyFailure();
    }
  }

  /**
   * Submit-on-close: persist form data before the window closes.
   * Equivalent to V1's `submitOnClose: true` default behaviour.
   * @override
   */
  async _preClose(options = {}) {
    const skipSubmitOnClose = options?.uesrpgSkipSubmitOnClose === true || this._skipSubmitOnCloseOnce === true;
    this._skipSubmitOnCloseOnce = false;
    if (this.isEditable && !skipSubmitOnClose) {
      const saved = await this._submitCurrentForm(null);
      if (!saved) {
        const message = t("UESRPG.Notifications.Sheets.FormSaveFailed");
        throw new Error(message);
      }
    }
    return super._preClose(options);
  }

  /* Actions Map Handlers */

  /**
   * Handle Active Effect controls (create / edit / delete / toggle).
   * Delegates to the shared onEffectControl handler, forwarding the
   * AppV2 action target element so dataset attributes resolve correctly.
   * @param {Event} event
   * @param {HTMLElement} target - The [data-action] element
   */
  _onEffectControl(event, target) {
    return onEffectControl(this, event, target);
  }

  async _onEditPortrait(event, target) { return editSheetPortrait.call(this, event, target); }

  /**
   * Increase item charges.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  _onChargePlus(event, target) {
    return onChargePlus(this, event);
  }

  /**
   * Decrease item charges.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  _onChargeMinus(event, target) {
    return onChargeMinus(this, event);
  }

  async _onApplyCategoryCoverage(event, target) {
    event?.preventDefault?.();
    if (!this.isEditable || this.document?.type !== "armor") return;

    const coverage = getArmorCategoryCoverage(this.document.system);
    if (!coverage) {
      ui.notifications?.warn?.(t(
        "UESRPG.DefectUpdate.ArmorCoverageUnknown",
        "Set a recognized armor category before applying category coverage."
      ));
      return;
    }

    const updated = await requestUpdateDocument(this.document, {
      "system.hitLocations": coverage,
      [`flags.${SYSTEM_ID}.coverageMode`]: "category",
    });
    if (updated) {
      ui.notifications?.info?.(t(
        "UESRPG.DefectUpdate.ArmorCoverageApplied",
        "Armor coverage was restored from its category."
      ));
    }
  }

  /**
   * Activate a talent from its item sheet.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  _onTalentUse(event, target) {
    event.preventDefault();
    return activateTalentFromItemSheet({ item: this.document, event });
  }

  /**
   * Activate a power from its item sheet.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  _onPowerUse(event, target) {
    event.preventDefault();
    return activatePowerFromItemSheet({ item: this.document, event });
  }

  /**
   * Activate a trait from its item sheet.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  _onTraitUse(event, target) {
    event.preventDefault();
    return activateTraitFromItemSheet({ item: this.document, event });
  }

  /* Combat Style Actions */

  /**
   * Set this combat style as the active style on the owning actor.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onSetActiveStyle(event, target) {
    event.preventDefault();
    const actor = this.document.actor;
    if (!this.document.isOwned || !actor) return;
    try {
      const updated = await requestUpdateDocument(actor, { [`flags.${SYSTEM_ID}.activeCombatStyleId`]: this.document.id });
      if (!updated) throw new Error(t("UESRPG.Notifications.Sheets.ActiveCombatStyleSaveFailed"));
      ui.notifications?.info?.(tf("UESRPG.Notifications.Sheets.ActiveCombatStyleSet", { item: this.document.name }));
      actor.sheet?.render?.(false);
      this.render({ parts: ["body"] });
    } catch (err) {
      console.error("UESRPG | Failed to set active combat style", { actor: actor?.uuid, item: this.document?.uuid, err });
      ui.notifications?.error?.(t("UESRPG.Notifications.Sheets.ActiveCombatStyleSaveFailed"));
    }
  }

  /**
   * Deactivate this combat style on the owning actor.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onDeactivateStyle(event, target) {
    event.preventDefault();
    const actor = this.document.actor;
    if (!this.document.isOwned || !actor) return;
    try {
      const updated = await requestUpdateDocument(actor, { [`flags.${SYSTEM_ID}.-=activeCombatStyleId`]: null });
      if (!updated) throw new Error(t("UESRPG.Notifications.Sheets.ActiveCombatStyleDeactivateFailed"));
      ui.notifications?.info?.(t("UESRPG.Notifications.Sheets.ActiveCombatStyleDeactivated"));
      actor.sheet?.render?.(false);
      this.render({ parts: ["body"] });
    } catch (err) {
      console.error("UESRPG | Failed to deactivate combat style", { actor: actor?.uuid, item: this.document?.uuid, err });
      ui.notifications?.error?.(t("UESRPG.Notifications.Sheets.ActiveCombatStyleDeactivateFailed"));
    }
  }

  /* Array Mutation Lock */

  /**
   * Per-array in-flight lock to prevent concurrent read-modify-write races.
   *
   * When two async calls read the same array before either write resolves,
   * the second write clobbers the first. The lock ensures only one mutation
   * per logical array runs at a time. Different arrays can still mutate
   * concurrently (they use separate lock keys).
   *
   * @param {string} lockKey  Instance-level property name for the lock flag.
   * @param {Function} fn     Async function containing the mutation logic.
   * @returns {Promise<void>}
   */
  async _withArrayMutationLock(lockKey, fn) {
    if (this[lockKey]) return;
    this[lockKey] = true;
    try {
      if (!await this._submitCurrentForm(null)) return;
      await fn();
    } finally {
      this[lockKey] = false;
    }
  }

  /**
   * Run a structural mutation against a freshly resolved Item while holding
   * the authority proxy's per-document lock.
   *
   * @param {Function} mutator Receives the current Item and returns an update.
   * @returns {Promise<boolean>}
   */
  async _requestAtomicMutation(mutator) {
    let intentionalNoop = false;
    const ok = await requestAtomicUpdateDocument(this.document, async (fresh) => {
      const update = await mutator(fresh);
      if (!update || typeof update !== "object" || !Object.keys(update).length) {
        intentionalNoop = true;
        return {};
      }
      return update;
    });
    if (!ok && !intentionalNoop) {
      ui.notifications?.error?.(t(
        "UESRPG.Notifications.Sheets.FormSaveFailed",
        "The document could not be saved. Review the entered values and try again."
      ));
    }
    return ok || intentionalNoop;
  }

  /* Spell Scaling Actions */

  /**
   * Add a new scaling level to the spell.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onAddScalingLevel(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;

    return this._withArrayMutationLock("_scalingMutLock", async () => {
      await this._requestAtomicMutation((fresh) => {
        const fallbackUnit = fresh.system?.duration?.unit || "instant";
        const currentLevels = getScalingLevelsArray(fresh).map(e => normalizeScalingEntry(e, fallbackUnit));
        const maxLevel = currentLevels.reduce((max, entry) => Math.max(max, Number(entry.level) || 0), 0);
        const nextLevel = maxLevel + 1;
        if (nextLevel > 7) {
          ui.notifications?.warn?.(t("UESRPG.Notifications.Spell.MaximumScalingLevels"));
          return {};
        }
        const newLevel = {
          level: nextLevel,
          known: true,
          cost: 0,
          spellStrengthFormula: "",
          damageType: "none",
          damageFormula: "",
          duration: { value: 0, unit: fallbackUnit },
          description: ""
        };
        logSpellDebug("Add scaling level", { nextLevel, currentLevels });
        return { "system.scaling.levels": [...currentLevels, newLevel] };
      });
    });
  }

  /**
   * Remove a scaling level by index.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onRemoveScalingLevel(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;

    const index = parseInt(target.dataset.index, 10);
    if (isNaN(index)) return;

    return this._withArrayMutationLock("_scalingMutLock", async () => {
      await this._requestAtomicMutation((fresh) => {
        const fallbackUnit = fresh.system?.duration?.unit || "instant";
        const currentLevels = getScalingLevelsArray(fresh).map(e => normalizeScalingEntry(e, fallbackUnit));
        const newLevels = currentLevels.filter((_, idx) => idx !== index);
        logSpellDebug("Remove scaling level", { index, newLevels });
        return { "system.scaling.levels": newLevels };
      });
    });
  }

  /* OverTime Entry Actions */

  /**
   * Add a blank OverTime entry.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onAddOvertimeEntry(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;

    return this._withArrayMutationLock("_overtimeMutLock", async () => {
      await this._requestAtomicMutation((fresh) => {
        const entries = foundry.utils.deepClone(fresh.system?.overTimeEntries ?? []);
        entries.push({
          trigger: "turnStart", cadenceEvery: 1, cadenceUnit: "rounds",
          payloadType: "damage", formula: "1d6", damageType: "fire",
          saveKey: "", saveTN: 0, saveSuccess: "endEffect", saveFailure: "damage",
          maxTicks: null, label: "", chatLog: true
        });
        return {
          "system.hasOverTime": true,
          "system.overTimeEntries": entries
        };
      });
    });
  }

  /**
   * Remove an OverTime entry by index.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onRemoveOvertimeEntry(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;

    const index = parseInt(target.dataset.index, 10);
    if (isNaN(index)) return;

    return this._withArrayMutationLock("_overtimeMutLock", async () => {
      await this._requestAtomicMutation((fresh) => {
        const entries = foundry.utils.deepClone(fresh.system?.overTimeEntries ?? []);
        entries.splice(index, 1);
        return { "system.overTimeEntries": entries };
      });
    });
  }

  /* Effect Recipe Actions */

  /**
   * Add a blank effect recipe entry. Guarded by enableSpellRecipes setting.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onAddEffectRecipe(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;

    return this._withArrayMutationLock("_recipeMutLock", async () => {
      await this._requestAtomicMutation((fresh) => {
        const recipes = foundry.utils.deepClone(fresh.system?.engine?.effects?.recipes ?? []);
        recipes.push({ key: "", mode: "add", value: "", target: "target", label: "" });
        logSpellDebug("Add effect recipe", { newCount: recipes.length });
        return { "system.engine.effects.recipes": recipes };
      });
    });
  }

  /**
   * Remove an effect recipe by index. Guarded by enableSpellRecipes setting.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onRemoveEffectRecipe(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;

    const index = parseInt(target.dataset.recipeIndex, 10);
    if (isNaN(index)) return;

    return this._withArrayMutationLock("_recipeMutLock", async () => {
      await this._requestAtomicMutation((fresh) => {
        const recipes = foundry.utils.deepClone(fresh.system?.engine?.effects?.recipes ?? []);
        recipes.splice(index, 1);
        logSpellDebug("Remove effect recipe", { index, newCount: recipes.length });
        return { "system.engine.effects.recipes": recipes };
      });
    });
  }

  /* Conjure Actions */

  /**
   * Clear a conjure UUID/label pair (item or actor).
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onConjureClear(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;

    const clearType = target.dataset.conjureClear;
    if (!clearType) return;

    const updateData = {};
    if (clearType === "item") {
      updateData["system.engine.conjure.itemUuid"] = "";
      updateData["system.engine.conjure.itemLabel"] = "";
    } else if (clearType === "actor") {
      updateData["system.engine.conjure.actorUuid"] = "";
      updateData["system.engine.conjure.actorLabel"] = "";
    }

    logSpellDebug("Conjure clear", { clearType });
    await requestUpdateDocument(this.document, updateData);
  }

  /* QA / Validation Actions */

  /* Damage Instance Actions (Spell Only) */

  /**
   * Add a blank spell damage instance.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onAddDamageInstance(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    if (this.document?.type !== "spell") return;

    return this._withArrayMutationLock("_dmgInstanceMutLock", async () => {
      await this._requestAtomicMutation((fresh) => {
        const instances = foundry.utils.deepClone(fresh.system?.damageInstances ?? []);
        instances.push({ formula: "", type: "none", label: "" });
        return { "system.damageInstances": instances };
      });
    });
  }

  /**
   * Remove a spell damage instance by index.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onRemoveDamageInstance(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    if (this.document?.type !== "spell") return;

    const index = parseInt(target.dataset.index, 10);
    if (isNaN(index)) return;

    return this._withArrayMutationLock("_dmgInstanceMutLock", async () => {
      await this._requestAtomicMutation((fresh) => {
        const instances = foundry.utils.deepClone(fresh.system?.damageInstances ?? []);
        instances.splice(index, 1);
        return { "system.damageInstances": instances };
      });
    });
  }

  /* Containment Action Handlers */

  /** Open the container item-selection dialog. */
  _onAddToContainer(event, target) { onAddToContainer(this); }

  /** Bulk remove all items from the container (non-destructive). */
  async _onBulkRemoveAll(event, target) { await onBulkRemoveFromContainer(this); }

  /** Bulk delete all items in the container (destructive). */
  async _onBulkDeleteAll(event, target) { await onBulkDeleteContained(this); }

  /** Remove a single item from this container. */
  async _onRemoveContainedItem(event, target) { await onRemoveContainedItem(this, target); }

  /** Delete a single contained item from the actor. */
  async _onDeleteContainedItem(event, target) { await onDeleteContainedItem(this, target); }

  /** Open a contained item's sheet. */
  async _onOpenContainedItem(event, target) { await onOpenContainedItem(this, target); }

  /* Alchemy Ingredient Handlers */

  async _onEnableAlchemyIngredient(event) { return onEnableAlchemyIngredient(this, event); }
  async _onClearAlchemyIngredient(event) { return onClearAlchemyIngredient(this, event); }
  async _onEnableSoulEnergyItem(event) { return onEnableSoulEnergyItem(this, event); }
  async _onClearSoulEnergyItem(event) { return onClearSoulEnergyItem(this, event); }

  /* Alchemy Product Handlers */

  async _onEnableAlchemyProduct(event, target) { return onEnableAlchemyProduct(this, event, target); }
  async _onClearAlchemyProduct(event) { return onClearAlchemyProduct(this, event); }
  async _onDrinkAlchemyProduct(event) { return onDrinkAlchemyProduct(this, event); }
  async _onApplyAlchemyProductToWeapon(event) { return onApplyAlchemyProductToWeapon(this, event); }
  async _onClearAlchemyProductEffect(event, target) {
    event?.preventDefault?.();
    const slotIdx = Number.parseInt(String(target?.dataset?.slotIdx ?? ""), 10);
    if (!Number.isFinite(slotIdx) || slotIdx < 0) return;
    return clearAlchemyProductEffectSlot(this, slotIdx);
  }

  /* Scroll Actions */

  /**
   * Cast the spell referenced by this scroll.
   * Resolves the spell via spellUuid, delegates to SpellCastingService with
   * scroll-specific flags, then decrements quantity on a non-cancelled attempt.
   *
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onCastScroll(event, target) { return onCastScroll(this, event, target); }
  async _onToggleSpellcastingEnable(event, target) { return onToggleSpellcastingEnable(this, event, target); }
  async _onAddSpellcastingSlot(event, target) { return onAddSpellcastingSlot(this, event, target); }
  async _onRemoveSpellcastingSlot(event, target) { return onRemoveSpellcastingSlot(this, event, target); }
  async _onClearSpellcastingStoredSpell(event, target) { return onClearSpellcastingStoredSpell(this, event, target); }
  async _onEditSpellcastingSlot(event, target) { return onEditSpellcastingSlot(this, event, target); }
  async _onPickSpellcastingSlotSpell(event, target) { return onPickSpellcastingSlotSpell(this, event, target); }

  async _onCastEnchantment(event, target) {
    return onCastEnchantmentAction.call(this, event, target, this.document);
  }

  /* Native Non-Click Listeners */

  /**
   * Combat Style: auto-save trained equipment (debounced) and special
   * advantages (immediate) without full-form rerender.
   * @param {HTMLElement} el
   */
  _registerCombatStyleListeners(el) {
    const equipInputs = el.querySelectorAll('input[name^="system.trainedEquipment."]');
    const saInputs = el.querySelectorAll('input[type="checkbox"][name^="system.specialAdvantages."]');

    // Debounced persist of all 5 equipment slots as a canonical array.
    const debouncedEquipUpdate = foundry.utils.debounce(async () => {
      try {
        const te = [];
        for (let i = 0; i < 10; i++) {
          te.push(String(equipInputs[i]?.value ?? "").trim());
        }
        await requestUpdateDocument(this.document, { "system.trainedEquipment": te });
      } catch (err) {
        console.warn("UESRPG | Combat Style trainedEquipment auto-update failed", err);
      }
    }, 150);

    equipInputs.forEach(input => {
      if (input.dataset.uesrpgCombatStyleEquipmentBound === "true") return;
      input.dataset.uesrpgCombatStyleEquipmentBound = "true";
      // Persist on blur/change, not keystroke, to prevent input jitter.
      input.addEventListener("change", debouncedEquipUpdate);
      // Prevent accidental form submit on Enter.
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          ev.target?.blur?.();
        }
      });
    });

    saInputs.forEach(input => {
      if (input.dataset.uesrpgCombatStyleSpecialAdvantageBound === "true") return;
      input.dataset.uesrpgCombatStyleSpecialAdvantageBound = "true";
      input.addEventListener("change", async (ev) => {
        try {
          const tgt = ev.target;
          const name = tgt?.name;
          if (!name) return;
          await requestUpdateDocument(this.document, { [name]: Boolean(tgt.checked) });
        } catch (err) {
          console.warn("UESRPG | Combat Style specialAdvantages auto-update failed", err);
        }
      });
    });
  }

  /**
   * Spell: non-click listeners for scaling inputs, automation module
   * checkboxes, recipe auto-save, and conjure drag-drop.
   * @param {HTMLElement} el
   */
  _registerSpellListeners(el) {
    const autosaveSpellField = async (ev, { rerender = false, skipScalingValidation = false } = {}) => {
      if (!this.isEditable) return;
      if (skipScalingValidation) ev.uesrpgSkipScalingValidation = true;

      try {
        await this._submitCurrentForm(ev);
        if (rerender) await this.render({ parts: ["body"] });
      } catch (err) {
        console.warn(`UESRPG | Failed to auto-save spell ${rerender ? "structural" : "field"} change`, err);
      }
    };

    // Scaling input change (delegated)
    // Auto-save scaling field changes without rerender.
    if (el.dataset.uesrpgSpellScalingBound !== "true") {
      el.dataset.uesrpgSpellScalingBound = "true";
      el.addEventListener("change", async (ev) => {
        const target = ev.target;
        if (!(target instanceof Element) || !target.closest("[data-scaling-input]")) return;

        ev.uesrpgSkipScalingValidation = true;
        logSpellDebug("Scaling input change", { name: ev.target?.name, value: ev.target?.value });
        await autosaveSpellField(ev, { skipScalingValidation: true });
      });
    }

    if (el.dataset.uesrpgSpellStructureBound !== "true") {
      el.dataset.uesrpgSpellStructureBound = "true";
      el.addEventListener("change", async (ev) => {
        const target = ev.target;
        if (!(target instanceof Element) || !target.closest("[data-spell-structure]")) return;
        logSpellDebug("Spell structural change", { name: ev.target?.name, value: ev.target?.value, checked: ev.target?.checked });
        await autosaveSpellField(ev, { rerender: true });
      });
    }

    if (el.dataset.uesrpgSpellAutosaveBound !== "true") {
      el.dataset.uesrpgSpellAutosaveBound = "true";
      el.addEventListener("change", async (ev) => {
        const target = ev.target;
        if (!(target instanceof Element) || !target.closest("[data-spell-autosave]")) return;
        logSpellDebug("Spell field autosave", { name: ev.target?.name, value: ev.target?.value, checked: ev.target?.checked });
        await autosaveSpellField(ev);
      });
    }

    // Prevent module label/title clicks from leaking into unrelated containers.
    el.querySelectorAll("[data-spell-structure], [data-spell-autosave], .spell-module-panel label.spell-check, .spell-module-title").forEach(node => {
      if (node.dataset.uesrpgSpellClickStopBound === "true") return;
      node.dataset.uesrpgSpellClickStopBound = "true";
      node.addEventListener("click", (ev) => ev.stopPropagation());
    });

    // Recipe input auto-save (guarded by enableSpellRecipes)
    let recipesEnabled = false;
    try { recipesEnabled = game.settings.get(SYSTEM_ID, "enableSpellRecipes") === true; } catch (_e) { /* noop */ }

    if (recipesEnabled) {
      const debouncedRecipeUpdate = foundry.utils.debounce(async (recipes) => {
        try {
          await requestUpdateDocument(this.document, { "system.engine.effects.recipes": recipes });
        } catch (err) {
          console.warn("UESRPG | Failed to auto-save recipe change", err);
        }
      }, 200);

      if (el.dataset.uesrpgSpellRecipeBound !== "true") {
        el.dataset.uesrpgSpellRecipeBound = "true";
        el.addEventListener("change", async (ev) => {
          if (!ev.target.closest("[data-recipe-input]")) return;
          if (!this.isEditable) return;

          // Patch only the row that changed.
          const row = ev.target.closest(".spell-recipe-row");
          const idx = Number(row?.dataset?.recipeIndex);
          if (!row || Number.isNaN(idx) || idx < 0) return;

          const recipes = foundry.utils.deepClone(this.document.system?.engine?.effects?.recipes ?? []);
          while (recipes.length <= idx) recipes.push({ key: "", mode: "add", value: "", target: "target", label: "" });

          recipes[idx] = {
            key: row.querySelector('[name$=".key"]')?.value || "",
            mode: row.querySelector('[name$=".mode"]')?.value || "add",
            value: row.querySelector('[name$=".value"]')?.value || "",
            target: row.querySelector('[name$=".target"]')?.value || "target",
            label: row.querySelector('[name$=".label"]')?.value || ""
          };

          logSpellDebug("Recipe auto-save", { recipeIndex: idx, recipeCount: recipes.length });
          debouncedRecipeUpdate(recipes);
        });
      }
    }

    // Conjure: drag-drop support for item/actor UUID fields
    el.querySelectorAll(".conjure-drop-target").forEach(input => {
      const dropType = input.dataset.conjureDrop; // "item" or "actor"
      if (!dropType) return;
      if (input.dataset.uesrpgConjureDropBound === "true") return;
      input.dataset.uesrpgConjureDropBound = "true";

      input.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "link";
      });

      input.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        if (!this.isEditable) return;

        let data;
        try {
          data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        } catch (_e) {
          return;
        }

        if (dropType === "item" && data.type === "Item") {
          const uuid = data.uuid ?? "";
          let label = "";
          try {
            const doc = await fromUuid(uuid);
            label = doc?.name ?? "";
          } catch (_e) { /* no-op */ }

          logSpellDebug("Conjure item drop", { uuid, label });
          await requestUpdateDocument(this.document, {
            "system.engine.conjure.itemUuid": uuid,
            "system.engine.conjure.itemLabel": label
          });
        } else if (dropType === "actor" && data.type === "Actor") {
          const uuid = data.uuid ?? "";
          let label = "";
          try {
            const doc = await fromUuid(uuid);
            label = doc?.name ?? "";
          } catch (_e) { /* no-op */ }

          logSpellDebug("Conjure actor drop", { uuid, label });
          await requestUpdateDocument(this.document, {
            "system.engine.conjure.actorUuid": uuid,
            "system.engine.conjure.actorLabel": label
          });
        } else {
          ui.notifications.warn(tf("UESRPG.Notifications.Sheets.ExpectedDropType", {
            expected: dropType === "item" ? t("UESRPG.UI.Item") : t("UESRPG.UI.Actor"),
            actual: data.type ?? t("UESRPG.UI.Unknown"),
          }));
        }
      });
    });
  }

  /**
   * Container sheets: contextmenu bulk-add support.
   * @param {HTMLElement} el
   */
  _registerContainmentListeners(el) {
    // Right-click on "+ Item" header: bulk add all eligible items
    const addBtn = el.querySelector(".addToContainer");
    if (addBtn) {
      if (addBtn.dataset.uesrpgBulkAddBound === "true") return;
      addBtn.dataset.uesrpgBulkAddBound = "true";
      addBtn.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        onBulkAddToContainer(this);
      });
    }
  }

  /**
   * Scroll sheet: live spell UUID validation + enlarged drop zone behavior.
   * @param {HTMLElement} el
   */
  _registerScrollListeners(el) {
    registerScrollListeners(this, el);
  }

  /* UI State Preservation */

  /**
   * @override
   * Snapshot DOM-only UI state before the DOM is replaced on re-render.
   * Mirrors V1's `_render()` pre-render snapshot.
   */
  _preRender(context, options) {
    super._preRender(context, options);

    const el = this.element;
    if (!el) return;

    const state = {
      openDetails: new Set(),
      windowContentScrollTop: el.querySelector(".window-content")?.scrollTop ?? 0,
    };

    // <details> open state (spell scaling / advanced options)
    el.querySelectorAll("details").forEach(d => {
      if (d.open) {
        const key = d.dataset.uesrpg || d.className.split(/\s+/)[0] || "";
        if (key) state.openDetails.add(key);
      }
    });

    this._savedState = state;
  }

  /**
   * @override
   * Restore saved UI state, bind listeners, and set up tabs on the fresh DOM.
   */
  _onRender(context, options) {
    const perfStart = performance.now();
    /** @type {HTMLElement|null} */
    let el = null;
    const renderedParts = Array.isArray(options?.parts) && options.parts.length
      ? new Set(options.parts)
      : null;
    const bodyRendered = !renderedParts || renderedParts.has("body");
    try {
      super._onRender(context, options);

      el = this.element;
      if (!el) return;
      applySheetDensityClass(el);
      clearItemDescriptionTooltip(this);

      // Restore saved UI state only when the body part is present.
      const state = this._savedState;
      if (state && bodyRendered) {
        state.openDetails?.forEach(key => {
          const d =
            el.querySelector(`details[data-uesrpg="${key}"]`) ||
            el.querySelector(`details.${CSS.escape(key)}`);
          if (d) d.open = true;
        });

      }

      // Type-specific wrapper classes for legacy selectors.
      el.classList.add(this.document.type);
      if (this.document.type === "spell" || this.document.type === "invocation") el.classList.add("spell-sheet");

      // Tab handling: fallback to first visible tab when remembered tab is absent.
      const desiredTab = this.tabGroups.primary ?? "description";
      const hasTab = el.querySelector(`.tabs [data-group="primary"][data-tab="${desiredTab}"]`);
      const targetTab = hasTab ? desiredTab
        : (el.querySelector('.tabs [data-group="primary"]')?.dataset?.tab ?? "description");
      this.changeTab(targetTab, "primary", { force: true });
      const desiredSecondaryTab = this.tabGroups.secondary ?? "attributes";
      const hasSecondaryTab = el.querySelector(`.tabs [data-group="secondary"][data-tab="${desiredSecondaryTab}"]`);
      if (hasSecondaryTab || el.querySelector('.tabs [data-group="secondary"]')) {
        const targetSecondaryTab = hasSecondaryTab
          ? desiredSecondaryTab
          : (el.querySelector('.tabs [data-group="secondary"]')?.dataset?.tab ?? "attributes");
        this.changeTab(targetSecondaryTab, "secondary", { force: true });
      }

      if (state) {
        const restoreScrollTop = Number(state.windowContentScrollTop) || 0;
        requestAnimationFrame(() => {
          const windowContent = this.element?.querySelector(".window-content");
          if (windowContent) windowContent.scrollTop = restoreScrollTop;
        });
        this._savedState = null;
      }

      activateProseMirrorEditors(this, el);

    } finally {
      traceSheetPerf({
        sheet: "SimpleItemSheetV2",
        document: this.document,
        stage: "_onRender",
        startedAtMs: perfStart,
        details: {
          tab: this.tabGroups?.primary ?? null,
          subtab: this.tabGroups?.secondary ?? null,
          hasElement: Boolean(el),
        },
        warnThresholdMs: 32,
      });
    }

  }

  /** @override */
  _canDragDrop(_selector) {
    return this.isEditable;
  }

  /** @override */
  _canDragStart(_selector) {
    return this.isEditable;
  }

  /**
   * Per-part listener registration.
   * Body listeners are attached only when the body part renders.
   * @override
   */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    const el = htmlElement;
    if (!el) return;

    const type = this.document.type;
    if (type === "spell" && (partId === "header" || partId === "body")) this._registerSpellListeners(el);
    if (partId !== "body") return;

    if (type === "combatStyle" && this.document.isOwned && this.document.actor) this._registerCombatStyleListeners(el);
    if (["item", "ammunition", "armor", "scroll", "weapon"].includes(type)) {
      registerItemSpellcastingListeners(this, el);
    }
    if (type === "scroll") this._registerScrollListeners(el);
    if (type === "equipment" || type === "item") {
      registerAlchemyProductListeners(this, el);
      registerSoulEnergyListeners(this, el);
    }
    if (type === "container") this._registerContainmentListeners(el);

    bindItemDescriptionTooltips(this, el);
  }

  _onClose(options) {
    clearItemDescriptionTooltip(this);
    clearSheetFormUpdateState(this);
    return super._onClose(options);
  }

  /* Drag & Drop */

  /**
   * Container sheets render contained item rows with data-item-id values for
   * actor-owned child items. Resolve those rows to the child item so dragging
   * out of a container moves the contained item, not the container document.
   * @override
   */
  _onDragStart(event) {
    if (this.document.type !== "container") return super._onDragStart(event);

    const existing = String(event?.dataTransfer?.getData?.("text/plain") ?? "").trim();
    if (existing) return;

    const row = event.target?.closest?.("[data-item-id]") ?? event.currentTarget;
    const itemId = row?.dataset?.itemId;
    if (!itemId || itemId === this.document.id) return super._onDragStart(event);

    const item = this.document.actor?.items?.get?.(itemId);
    if (!item) return super._onDragStart(event);

    const traceId = makeDndTraceId("container-drag");
    const payload = buildItemDragPayload(item, { traceId });
    event.dataTransfer?.setData("text/plain", JSON.stringify(payload));
    dndDebug("sheet.dragstart.containerContent", {
      sheet: "SimpleItemSheetV2",
      container: this.document?.uuid ?? null,
      item: item?.uuid ?? null,
      itemId: item?.id ?? null,
    }, { traceId });
  }

  /**
   * @override
   * Handle item drops. Scroll sheets accept spell drops to fill spellUuid;
   * container sheets accept Item drops as contents; all others forward to the
   * parent class.
   */
  async _onDrop(event) {
    event.preventDefault();

    if (this.document.type === "equipment" || this.document.type === "item") {
      const alchemyZone = event?.target instanceof Element
        ? event.target.closest(ALCHEMY_PRODUCT_DROP_SELECTOR)
        : null;
      if (alchemyZone) {
        if (event.__uesAlchemyProductDropHandled === true) return;
        event.__uesAlchemyProductDropHandled = true;

        const slotIdx = Number.parseInt(String(alchemyZone.dataset.alchemyProductDropSlot ?? ""), 10);
        if (!Number.isFinite(slotIdx) || slotIdx < 0) return;

        const result = await handleAlchemyProductSpellDrop(this, event, slotIdx);
        if (!result?.ok) return;

        ui.notifications?.info?.(tf("UESRPG.Notifications.Sheets.AssignedSpellToSlot", {
          spell: result.spellName,
          slot: slotIdx + 1,
        }));
        await this.render();
        return;
      }
    }

    // Scroll: accept a dropped spell item to fill the spellUuid field.
    if (this.document.type === "scroll") {
      // Dedicated drop-zone listener handles this path already.
      if (event?.target?.closest?.('[data-scroll-spell-drop-zone="true"]')) return;

      const data = readDropData(event);
      if (data?.type !== "Item") {
        return super._onDrop?.(event);
      }

      const dropped = await resolveDroppedItem(data);
      if (!dropped) {
        ui.notifications?.warn?.(t("UESRPG.Notifications.Sheets.UnableResolveDroppedItem"));
        return;
      }

      const result = await resolveAndValidateScrollSpell(dropped);
      if (!result.ok) {
        ui.notifications?.warn?.(result.error ?? t("UESRPG.Notifications.Sheets.ScrollSpellItemsOnly"));
        return;
      }

      await applyScrollSpellLink(this, result.spellDoc);
      return;
    }

    if (this.document.type !== "container") {
      return super._onDrop?.(event);
    }

    const data = readDropData(event);
    if (data?.type !== "Item") return super._onDrop?.(event);
    return onDropItemIntoContainer(this, data);
  }
}
