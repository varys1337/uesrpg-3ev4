/**
 * src/ui/sheets/v2/item-sheet.js
 *
 * ApplicationV2 Item Sheet.
 *
 * Key improvements:
 * - Uses HandlebarsApplicationMixin(ItemSheetV2) base
 * - Dynamic per-type template selection via _renderHTML override
 * - Deterministic form handler -> normalizer -> document.update pipeline
 * - _preRender / _onRender lifecycle for cross-render UI state preservation
 */

import { normalizeItemFormData, validateSpellScaling } from "../item/normalize-item-form-data.js";
import { prepareItemSheetData } from "../item/prepare.js";
import {
  renderFieldsForElement, renderConditionFieldsForElement,
  onReAdd, onReDelete, onReAddCondition, onReConditionDelete,
  onReToggle, onReLabelChange, onRePredicateChange, onReWorkflowToggle,
  onReConditionFieldChange, onReReorder,
} from "../item/listeners/rule-elements.js";
import {
  onAddToContainer, onBulkAddToContainer, onBulkRemoveFromContainer,
  onBulkDeleteContained, onRemoveContainedItem, onDeleteContainedItem,
  onOpenContainedItem, updateContainedItemsList, pushContainedItemData,
} from "../item/listeners/containment.js";
import { onEffectControl } from "../item/listeners/effects.js";
import { onChargePlus, onChargeMinus } from "../item/listeners/usage.js";
import { activateTalentFromItemSheet, activatePowerFromItemSheet, activateTraitFromItemSheet } from "../shared-handlers.js";
import { getScalingLevelsArray, normalizeScalingEntry, logSpellDebug } from "../item/spell-scaling-helpers.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { activateProseMirrorEditors } from "../shared/editor-activation.js";
import { DEFAULTS } from "../../../core/migrations/item-defaults.generated.js";
import { traceSheetPerf } from "../../../core/debug/perf.js";
import { bindDelegated } from "./_delegated-bindings.js";
import { readDropData, resolveDroppedItem } from "../../../utils/drop-data.js";
import { onCastEnchantmentAction } from "../shared/listeners/enchanting-cast.js";
import {
  onEnableAlchemyIngredient, onClearAlchemyIngredient,
  onEnableAlchemyProduct, onClearAlchemyProduct,
  onDrinkAlchemyProduct, onApplyAlchemyProductToWeapon,
} from "../item/item-sheet-alchemy.js";
import {
  onCastScroll, onToggleSpellcastingEnable,
  onAddSpellcastingSlot, onRemoveSpellcastingSlot,
  onEditSpellcastingSlot, onPickSpellcastingSlotSpell,
  registerScrollListeners,
  resolveAndValidateScrollSpell, applyScrollSpellLink,
} from "../item/item-sheet-spellcasting.js";
import { bindItemDescriptionTooltips, clearItemDescriptionTooltip } from "./shared/sheet-tooltips.js";
import { applySheetDensityClass } from "./shared/sheet-density.js";
import { buildAdvancementPlan } from "../item/advancement-plan.js";
import { SYSTEM_ID, templatePath } from "../../constants.js";
import { createDebugLogger } from "../../../utils/debug.js";
import { resolveUuidSync } from "../../../utils/uuid-cache.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ItemSheetV2Base = foundry.applications.sheets.ItemSheetV2;
const ITEM_SHEET_TEMPLATE_BASE = templatePath("v2/sheets");
const SUPPORTED_ITEM_SHEET_TYPES = new Set([
  "ammunition",
  "armor",
  "shield",
  "combatStyle",
  "container",
  "equipment",
  "item",
  "magicSkill",
  "power",
  "scroll",
  "skill",
  "spell",
  "talent",
  "trait",
  "weapon",
]);

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

function _extractFirstNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/[-+]?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function _inferTypedLaneFromText(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const map = [
    ["sunlight", "sunlight"],
    ["silver", "silver"],
    ["disease", "disease"],
    ["poison", "poison"],
    ["frost", "frost"],
    ["shock", "shock"],
    ["fire", "fire"],
    ["magic", "magic"],
  ];
  for (const [needle, out] of map) {
    if (raw.includes(needle)) return out;
  }
  return null;
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
  const schema = DEFAULTS?.itemSystem?.[itemType] ?? null;
  if (!schema) return cloned;
  _sanitizeNumericBySchema(cloned, schema, cloned);
  return cloned;
}


export class SimpleItemSheetV2 extends HandlebarsApplicationMixin(ItemSheetV2Base) {

  /** @type {object|null} Snapshot of DOM-only UI state saved before re-render */
  _savedState = null;
  _scrollLinkedSpellCache = null;

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
        { id: "attributes" },
        { id: "casting" },
        { id: "information" },
        { id: "automation" },
        { id: "combatStyle" },
        { id: "effects" },
      ],
      initial: "description",
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
      dropSelector: ".window-content, .sheet-body, .tab, .itemListContainer",
    }],
    actions: {
      editPortrait: SimpleItemSheetV2.prototype._onEditPortrait,
      effectControl: SimpleItemSheetV2.prototype._onEffectControl,
      chargePlus: SimpleItemSheetV2.prototype._onChargePlus,
      chargeMinus: SimpleItemSheetV2.prototype._onChargeMinus,
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
      // Rule Element actions
      reAdd: SimpleItemSheetV2.prototype._onReAdd,
      reDelete: SimpleItemSheetV2.prototype._onReDelete,
      reExpand: SimpleItemSheetV2.prototype._onReExpand,
      reAddCondition: SimpleItemSheetV2.prototype._onReAddCondition,
      reConditionDelete: SimpleItemSheetV2.prototype._onReConditionDelete,
      // Alchemy ingredient actions
      enableAlchemyIngredient: SimpleItemSheetV2.prototype._onEnableAlchemyIngredient,
      clearAlchemyIngredient: SimpleItemSheetV2.prototype._onClearAlchemyIngredient,
      // Alchemy product actions
      enableAlchemyProduct: SimpleItemSheetV2.prototype._onEnableAlchemyProduct,
      clearAlchemyProduct: SimpleItemSheetV2.prototype._onClearAlchemyProduct,
      drinkAlchemyProduct: SimpleItemSheetV2.prototype._onDrinkAlchemyProduct,
      applyAlchemyProductToWeapon: SimpleItemSheetV2.prototype._onApplyAlchemyProductToWeapon,
      // Scroll actions
      castScroll: SimpleItemSheetV2.prototype._onCastScroll,
      castEnchantment: SimpleItemSheetV2.prototype._onCastEnchantment,
      toggleSpellcastingEnable: SimpleItemSheetV2.prototype._onToggleSpellcastingEnable,
      addSpellcastingSlot: SimpleItemSheetV2.prototype._onAddSpellcastingSlot,
      removeSpellcastingSlot: SimpleItemSheetV2.prototype._onRemoveSpellcastingSlot,
      editSpellcastingSlot: SimpleItemSheetV2.prototype._onEditSpellcastingSlot,
      pickSpellcastingSlotSpell: SimpleItemSheetV2.prototype._onPickSpellcastingSlotSpell,
    },
  };

  static PARTS = {
    header: {
      template: templatePath("v2/sheets/equipment-sheet.hbs"),
    },
    tabs: {
      template: templatePath("v2/sheets/equipment-sheet.hbs"),
    },
    body: {
      template: templatePath("v2/sheets/equipment-sheet.hbs"),
      scrollable: [".sheet-body"],
    },
  };

  /** Keep item window title to the document name only (no localized type prefix). */
  get title() {
    return this.document?.name ?? "";
  }

  /** V1 compat: inherited editor submit/save paths access `sheet.form`. */
  get form() {
    return this.element;
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
   * Dynamic per-type template selection.
   * Dynamically configure render parts to resolve the correct per-type template.
   * This is the documented v13 approach for varying template paths per instance.
   * @override
   */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const type = this.document.type;
    const resolvedType = SUPPORTED_ITEM_SHEET_TYPES.has(type) ? type : "equipment";
    const template = `${ITEM_SHEET_TEMPLATE_BASE}/${resolvedType}-sheet.hbs`;
    this._uesrpgResolvedItemSheetTemplate = template;
    parts.header = { ...(parts.header ?? {}), template };
    parts.tabs = { ...(parts.tabs ?? {}), template };
    parts.body = { ...(parts.body ?? {}), template };
    return parts;
  }

  _createItemSheetPartElement(partId, sourceEl) {
    const wrapper = document.createElement("div");
    wrapper.dataset.applicationPart = partId;
    if (sourceEl) {
      wrapper.appendChild(sourceEl);
      return wrapper;
    }

    // Keep per-part DOM contracts stable even when the source template is missing
    // a region, so AppV2 scroll targets and tab chrome never bind to null roots.
    if (partId === "header") {
      wrapper.appendChild(document.createElement("header"));
    } else if (partId === "tabs") {
      const nav = document.createElement("nav");
      nav.className = "sheet-tabs tabs";
      nav.dataset.group = "primary";
      wrapper.appendChild(nav);
    } else if (partId === "body") {
      const body = document.createElement("section");
      body.className = "sheet-body";
      wrapper.appendChild(body);
    }

    return wrapper;
  }

  _warnMissingItemSheetPart(partId, templatePath) {
    console.warn("UESRPG | Item sheet render part missing; using empty fallback", {
      itemType: this.document?.type ?? null,
      itemId: this.document?.id ?? null,
      partId,
      templatePath,
    });
  }

  /**
   * @override
   * Custom _renderHTML to handle multi-root element templates.
   *
   * Item templates have two root siblings (<header> + <section class="sheet-body">).
   * We render once and split stable regions into AppV2 render parts.
   */
  async _renderHTML(context, options) {
    this._configureRenderParts(options);
    const templatePath = this._uesrpgResolvedItemSheetTemplate ?? `${ITEM_SHEET_TEMPLATE_BASE}/equipment-sheet.hbs`;

    // Use per-part context preparation (preserves mixin lifecycle)
    const partContext = await this._preparePartContext("body", context, options);
    let htmlString;
    try {
      htmlString = await foundry.applications.handlebars.renderTemplate(templatePath, partContext);
    } catch (err) {
      const fallback = `${ITEM_SHEET_TEMPLATE_BASE}/equipment-sheet.hbs`;
      console.warn("UESRPG | Item sheet template missing, using fallback", {
        type: this.document.type,
        templatePath,
        fallback,
        error: err?.message ?? err,
      });
      htmlString = await foundry.applications.handlebars.renderTemplate(fallback, partContext);
    }

    // Split single-template output into stable AppV2 parts.
    const tmp = document.createElement("div");
    tmp.innerHTML = htmlString;
    const headerEl = tmp.querySelector("header");
    const tabsEl = tmp.querySelector("nav.sheet-tabs.tabs");
    const bodyEl = tmp.querySelector("section.sheet-body");

    if (!headerEl) this._warnMissingItemSheetPart("header", templatePath);
    if (!tabsEl) this._warnMissingItemSheetPart("tabs", templatePath);
    if (!bodyEl) this._warnMissingItemSheetPart("body", templatePath);

    const allParts = {
      header: this._createItemSheetPartElement("header", headerEl),
      tabs: this._createItemSheetPartElement("tabs", tabsEl),
      body: this._createItemSheetPartElement("body", bodyEl),
    };

    const requested = Array.isArray(options?.parts) && options.parts.length
      ? new Set(options.parts)
      : null;
    if (!requested) return allParts;

    const out = {};
    for (const partId of requested) {
      if (allParts[partId]) out[partId] = allParts[partId];
    }
    return out;
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
    // Cache sanitized render system per (docId, modifiedTime) to avoid repeated
    // deep-clone + coercion on every render when the document hasn't changed.
    {
      const docId = this.document.id;
      const modifiedTime = this.document._stats?.modifiedTime ?? null;
      const cache = this._renderSystemCache;
      if (cache && cache.docId === docId && modifiedTime !== null && cache.modifiedTime === modifiedTime) {
        context.item.system = cache.sanitizedSystem;
      } else {
        const sanitizedSystem = _buildSanitizedRenderSystem(this.document?.type, this.document?.system);
        this._renderSystemCache = { docId, modifiedTime, sanitizedSystem };
        context.item.system = sanitizedSystem;
      }
    }
    context.data = context.item.system; // legacy alias
    context.editable = this.isEditable;
    context.isGM = game.user.isGM;
      context.owner = this.document.isOwner;
      context.limited = this.document.limited;
      context.cssClass = this.isEditable ? "editable" : "locked";
      context.options = { editable: this.isEditable };

      // Shared data preparation (enriches description, derives computed values, etc.)
      const prepared = await prepareItemSheetData(this, context);

      if (this.document.type === "scroll") {
        prepared.scrollLinkedSpell = null;
        prepared.hasLinkedSpell = false;
        prepared.linkedSpellUnresolved = false;

        const spellUuid = String(this.document.system?.spellUuid ?? "").trim();
        if (spellUuid) {
          try {
            const cachedSpell = this._scrollLinkedSpellCache;
            let linked = null;
            const liveSync = resolveUuidSync(spellUuid);
            const linkedModifiedTime = liveSync?._stats?.modifiedTime ?? null;
            if (
              cachedSpell
              && cachedSpell.spellUuid === spellUuid
              && cachedSpell.modifiedTime === linkedModifiedTime
            ) {
              prepared.scrollLinkedSpell = cachedSpell.summary;
              linked = liveSync;
            } else {
              linked = liveSync ?? await fromUuid(spellUuid);
            }
            if (linked?.documentName === "Item" && String(linked?.type ?? "") === "spell") {
              if (!prepared.scrollLinkedSpell) {
                prepared.scrollLinkedSpell = _buildLinkedSpellSummary(linked);
                this._scrollLinkedSpellCache = {
                  spellUuid,
                  modifiedTime: linked?._stats?.modifiedTime ?? null,
                  summary: prepared.scrollLinkedSpell,
                };
              }
              prepared.hasLinkedSpell = true;
            } else {
              prepared.linkedSpellUnresolved = true;
            }
          } catch (_err) {
            prepared.linkedSpellUnresolved = true;
          }
        }
      }

      prepared.enableRuleElements = Boolean(game.settings.get(SYSTEM_ID, "enableRuleElementsRuntime"));

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
    if (path !== "system.description" || !("value" in (target ?? {}))) return;

    const nextValue = String(target.value ?? "");
    const currentValue = String(this.document?.system?.description ?? "");
    if (Object.is(currentValue, nextValue)) return;

    await requestUpdateDocument(this.document, { "system.description": nextValue });
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
    let flatData = foundry.utils.flattenObject(formData.object);
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
    const { scalingLevels } = normalizeItemFormData(this.document, flatData);

    if (
      this.document.type === "spell" &&
      scalingLevels.length > 0 &&
      !event?.uesrpgSkipScalingValidation
    ) {
      const blocked = await validateSpellScaling(this.document, flatData, scalingLevels);
      if (blocked) return;
    }
    const advancement = buildAdvancementPlan(this.document, flatData);
    if (!advancement.ok) {
      ui.notifications?.warn?.(advancement.reason || "Unable to apply advancement changes.");
      return;
    }

    // Diff against current document state - only send changed fields
    const current = foundry.utils.flattenObject(this.document.toObject(false));
    flatData = foundry.utils.diffObject(current, flatData);
    if (foundry.utils.isEmpty(flatData)) return;

    if (isShieldLaneDoc) {
      _shieldDebug("form submit diff", {
        id: this.document?.id ?? null,
        name: this.document?.name ?? null,
        type: this.document?.type ?? null,
        diff: flatData,
      });
    }

    await requestUpdateDocument(this.document, flatData);
    if (advancement.xpCost > 0 && advancement.actor) {
      await requestUpdateDocument(advancement.actor, { "system.xp": advancement.nextXp });
      ui.notifications?.info?.(`Spent ${advancement.xpCost} XP.`);
    }
  }

  async _submitCurrentForm(event = null) {
    const formEl = this.element;
    if (!formEl?.isConnected) return;
    const fd = new foundry.applications.ux.FormDataExtended(formEl);
    await this._onFormSubmit(event, formEl, fd);
  }

  /**
   * Submit-on-close: persist form data before the window closes.
   * Equivalent to V1's `submitOnClose: true` default behaviour.
   * @override
   */
  async close(options = {}) {
    const skipSubmitOnClose = options?.uesrpgSkipSubmitOnClose === true || this._skipSubmitOnCloseOnce === true;
    this._skipSubmitOnCloseOnce = false;
    if (this.isEditable && !skipSubmitOnClose) {
      try {
        await this._submitCurrentForm(null);
      } catch (err) {
        console.warn("UESRPG | Item sheet V2 submit-on-close failed", err);
      }
    }
    return super.close(options);
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
      await requestUpdateDocument(actor, { [`flags.${SYSTEM_ID}.activeCombatStyleId`]: this.document.id });
      ui.notifications?.info?.(`Active combat style set to: ${this.document.name}`);
      actor.sheet?.render?.(false);
      this.render({ parts: ["body"] });
    } catch (err) {
      console.error("UESRPG | Failed to set active combat style", { actor: actor?.uuid, item: this.document?.uuid, err });
      ui.notifications?.error?.("Failed to set active combat style.");
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
      await requestUpdateDocument(actor, { [`flags.${SYSTEM_ID}.-=activeCombatStyleId`]: null });
      ui.notifications?.info?.("Combat style deactivated.");
      actor.sheet?.render?.(false);
      this.render({ parts: ["body"] });
    } catch (err) {
      console.error("UESRPG | Failed to deactivate combat style", { actor: actor?.uuid, item: this.document?.uuid, err });
      ui.notifications?.error?.("Failed to deactivate combat style.");
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
      await fn();
    } finally {
      this[lockKey] = false;
    }
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
      const fallbackUnit = this.document.system?.duration?.unit || "instant";
      const currentLevels = getScalingLevelsArray(this.document).map(e => normalizeScalingEntry(e, fallbackUnit));

      const maxLevel = currentLevels.reduce((max, entry) => Math.max(max, Number(entry.level) || 0), 0);
      const nextLevel = maxLevel + 1;
      if (nextLevel > 7) {
        ui.notifications?.warn?.("Maximum 7 spell levels (Novice to Grandmaster).");
        return;
      }

      const newLevel = {
        level: nextLevel,
        cost: 0,
        damageFormula: "",
        duration: { value: 0, unit: fallbackUnit },
        description: ""
      };

      logSpellDebug("Add scaling level", { nextLevel, currentLevels });
      await requestUpdateDocument(this.document, {
        "system.scaling.levels": [...currentLevels, newLevel]
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
      const fallbackUnit = this.document.system?.duration?.unit || "instant";
      const currentLevels = getScalingLevelsArray(this.document).map(e => normalizeScalingEntry(e, fallbackUnit));
      const newLevels = currentLevels.filter((_, idx) => idx !== index);

      logSpellDebug("Remove scaling level", { index, newLevels });
      await requestUpdateDocument(this.document, {
        "system.scaling.levels": newLevels
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
      const entries = foundry.utils.deepClone(this.document.system?.overTimeEntries ?? []);
      entries.push({
        trigger: "turnStart", cadenceEvery: 1, cadenceUnit: "rounds",
        payloadType: "damage", formula: "1d6", damageType: "fire",
        saveKey: "", saveTN: 0, saveSuccess: "endEffect", saveFailure: "damage",
        maxTicks: null, label: "", chatLog: true
      });
      await requestUpdateDocument(this.document, { "system.overTimeEntries": entries });
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
      const entries = foundry.utils.deepClone(this.document.system?.overTimeEntries ?? []);
      entries.splice(index, 1);
      await requestUpdateDocument(this.document, { "system.overTimeEntries": entries });
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
      const recipes = foundry.utils.deepClone(this.document.system?.engine?.effects?.recipes ?? []);
      recipes.push({ key: "", mode: "add", value: "", target: "target", label: "" });

      logSpellDebug("Add effect recipe", { newCount: recipes.length });
      await requestUpdateDocument(this.document, { "system.engine.effects.recipes": recipes });
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
      const recipes = foundry.utils.deepClone(this.document.system?.engine?.effects?.recipes ?? []);
      recipes.splice(index, 1);

      logSpellDebug("Remove effect recipe", { index, newCount: recipes.length });
      await requestUpdateDocument(this.document, { "system.engine.effects.recipes": recipes });
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
      const instances = foundry.utils.deepClone(this.document.system?.damageInstances ?? []);
      instances.push({ formula: "", type: "none", label: "" });
      await requestUpdateDocument(this.document, { "system.damageInstances": instances });
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
      const instances = foundry.utils.deepClone(this.document.system?.damageInstances ?? []);
      instances.splice(index, 1);
      await requestUpdateDocument(this.document, { "system.damageInstances": instances });
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

  /* Rule Element Action Handlers */

  /** Create a new rule element from the type-select dropdown. */
  async _onReAdd(event, target) { await onReAdd(this.document, this.element); }

  /** Delete a rule element by id. */
  async _onReDelete(event, target) {
    const li = target.closest(".re-item");
    await onReDelete(this.document, li?.dataset?.reId);
  }

  /** Expand/collapse a rule element's body (client-only, no persistence). */
  _onReExpand(event, target) {
    const li = target.closest(".re-item");
    if (!li) return;
    const body = li.querySelector(".re-item-body");
    const icon = target.querySelector("i") || target.closest(".re-item-expand")?.querySelector("i");
    if (!body) return;

    if (body.style.display !== "none") {
      body.style.display = "none";
      if (icon) { icon.classList.remove("fa-chevron-up"); icon.classList.add("fa-chevron-down"); }
    } else {
      body.style.display = "";
      if (icon) { icon.classList.remove("fa-chevron-down"); icon.classList.add("fa-chevron-up"); }
      // Render fields on first expand
      renderFieldsForElement(li, this.document);
      renderConditionFieldsForElement(li, this.document);
    }
  }

  /** Add a condition to a rule element via dialog prompt. */
  async _onReAddCondition(event, target) {
    const reId = target.dataset.reId || target.closest(".re-item")?.dataset?.reId;
    await onReAddCondition(this.document, reId);
  }

  /** Delete a condition from a rule element. */
  async _onReConditionDelete(event, target) {
    const condDiv = target.closest(".re-condition");
    const condIdx = condDiv ? Number(condDiv.dataset.condIdx) : undefined;
    const li = target.closest(".re-item");
    const reId = li?.dataset?.reId;
    await onReConditionDelete(this.document, reId, condIdx);
  }

  /* Alchemy Ingredient Handlers */

  async _onEnableAlchemyIngredient(event) { return onEnableAlchemyIngredient(this, event); }
  async _onClearAlchemyIngredient(event) { return onClearAlchemyIngredient(this, event); }

  /* Alchemy Product Handlers */

  async _onEnableAlchemyProduct(event, target) { return onEnableAlchemyProduct(this, event, target); }
  async _onClearAlchemyProduct(event) { return onClearAlchemyProduct(this, event); }
  async _onDrinkAlchemyProduct(event) { return onDrinkAlchemyProduct(this, event); }
  async _onApplyAlchemyProductToWeapon(event) { return onApplyAlchemyProductToWeapon(this, event); }

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
    el.addEventListener("change", async (ev) => {
      const target = ev.target;
      if (!(target instanceof Element) || !target.closest("[data-scaling-input]")) return;

      ev.uesrpgSkipScalingValidation = true;
      logSpellDebug("Scaling input change", { name: ev.target?.name, value: ev.target?.value });
      await autosaveSpellField(ev, { skipScalingValidation: true });
    });

    el.addEventListener("change", async (ev) => {
      const target = ev.target;
      if (!(target instanceof Element) || !target.closest("[data-spell-structure]")) return;
      logSpellDebug("Spell structural change", { name: ev.target?.name, value: ev.target?.value, checked: ev.target?.checked });
      await autosaveSpellField(ev, { rerender: true });
    });

    el.addEventListener("change", async (ev) => {
      const target = ev.target;
      if (!(target instanceof Element) || !target.closest("[data-spell-autosave]")) return;
      logSpellDebug("Spell field autosave", { name: ev.target?.name, value: ev.target?.value, checked: ev.target?.checked });
      await autosaveSpellField(ev);
    });

    // Prevent module label/title clicks from leaking into unrelated containers.
    el.querySelectorAll("[data-spell-structure], [data-spell-autosave], .spell-module-panel label.spell-check, .spell-module-title").forEach(node => {
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

    // Conjure: drag-drop support for item/actor UUID fields
    el.querySelectorAll(".conjure-drop-target").forEach(input => {
      const dropType = input.dataset.conjureDrop; // "item" or "actor"
      if (!dropType) return;

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
          ui.notifications.warn(`Expected a ${dropType === "item" ? "Item" : "Actor"} drop, got ${data.type ?? "unknown"}.`);
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

  /**
   * Rule Element change/drag listeners for trait/talent/power sheets.
   * @param {HTMLElement} el
   */
  _registerRuleElementListeners(el) {
    const item = this.document;

    // Delegate change handling to the list container to minimize
    // per-render listener churn.
    const reList = el.querySelector(".re-list");
    if (!reList) return;

    bindDelegated(reList, "change", ".re-item-toggle input[type=\"checkbox\"]", (ev, cb) => {
      const li = cb.closest(".re-item");
      onReToggle(item, li?.dataset?.reId, cb.checked);
    });

    bindDelegated(reList, "change", ".re-item-label", (ev, inp) => {
      const li = inp.closest(".re-item");
      onReLabelChange(item, li?.dataset?.reId, inp.value);
    });

    bindDelegated(reList, "change", ".re-predicate-input", (ev, ta) => {
      const li = ta.closest(".re-item");
      onRePredicateChange(item, li?.dataset?.reId, ta.value);
    });

    bindDelegated(reList, "change", ".re-workflow-toggle", (ev, cb) => {
      const li = cb.closest(".re-item");
      const workflow = String(cb.dataset.workflow ?? "").trim();
      onReWorkflowToggle(item, li?.dataset?.reId, workflow, cb.checked);
    });

    bindDelegated(reList, "change", ".re-condition-input", (ev, input) => {
      const li = input.closest(".re-item");
      const reId = li?.dataset?.reId;
      const condIdx = Number(input.dataset.condIdx);
      const condField = String(input.dataset.condField ?? "").trim();

      let value;
      if (input.type === "checkbox") value = input.checked;
      else if (input.type === "number") value = Number(input.value) || 0;
      else value = input.value;

      onReConditionFieldChange(item, reId, condIdx, condField, value, input.type);
    });

    // Drag-drop reorder (delegated)
    bindDelegated(reList, "dragstart", ".re-item", (ev, li) => {
      ev.dataTransfer?.setData("text/plain", String(li.dataset.reId ?? ""));
    });

    bindDelegated(reList, "dragover", ".re-item", (ev) => {
      ev.preventDefault();
    });

    bindDelegated(reList, "drop", ".re-item", async (ev, li) => {
      ev.preventDefault();
      const sourceId = ev.dataTransfer?.getData("text/plain");
      const targetId = li.dataset.reId;
      await onReReorder(item, sourceId, targetId);
    });
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
      expandedREIds: new Set(),
      openDetails: new Set(),
      sheetBodyScrollTop: 0,
    };

    // Expanded Rule Element items
    el.querySelectorAll(".re-item").forEach(li => {
      const body = li.querySelector(".re-item-body");
      if (body && body.style.display !== "none") {
        const reId = li.dataset.reId;
        if (reId) state.expandedREIds.add(reId);
      }
    });

    // <details> open state (spell scaling / advanced options)
    el.querySelectorAll("details").forEach(d => {
      if (d.open) {
        const key = d.dataset.uesrpg || d.className.split(/\s+/)[0] || "";
        if (key) state.openDetails.add(key);
      }
    });

    const sheetBody = el.querySelector(".sheet-body");
    if (sheetBody) state.sheetBodyScrollTop = sheetBody.scrollTop;

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
        state.expandedREIds?.forEach(reId => {
          const li = el.querySelector(`.re-item[data-re-id="${reId}"]`);
          if (!li) return;
          const body = li.querySelector(".re-item-body");
          const icon = li.querySelector(".re-item-expand i");
          if (body) body.style.display = "";
          if (icon) {
            icon.classList.remove("fa-chevron-down");
            icon.classList.add("fa-chevron-up");
          }
          renderFieldsForElement(li, this.document);
          renderConditionFieldsForElement(li, this.document);
        });

        state.openDetails?.forEach(key => {
          const d =
            el.querySelector(`details[data-uesrpg="${key}"]`) ||
            el.querySelector(`details.${CSS.escape(key)}`);
          if (d) d.open = true;
        });

      }

      // Type-specific wrapper classes for legacy selectors.
      el.classList.add(this.document.type);
      if (this.document.type === "spell") el.classList.add("spell-sheet");

      // Tab handling: fallback to first visible tab when remembered tab is absent.
      const desiredTab = this.tabGroups.primary ?? "description";
      const hasTab = el.querySelector(`.tabs [data-group="primary"][data-tab="${desiredTab}"]`);
      const targetTab = hasTab ? desiredTab
        : (el.querySelector('.tabs [data-group="primary"]')?.dataset?.tab ?? "description");
      this.changeTab(targetTab, "primary", { force: true });

      if (state && bodyRendered) {
        const restoreScrollTop = Number(state.sheetBodyScrollTop) || 0;
        requestAnimationFrame(() => {
          const currentBody = this.element?.querySelector(".sheet-body");
          if (currentBody) currentBody.scrollTop = restoreScrollTop;
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
          hasElement: Boolean(el),
        },
        warnThresholdMs: 32,
      });
    }

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
    if (type === "scroll") this._registerScrollListeners(el);
    if (type === "container") this._registerContainmentListeners(el);

    const featureTypes = new Set(["trait", "talent", "power"]);
    if (featureTypes.has(type)) this._registerRuleElementListeners(el);

    if (type === "container" && this.document.isOwned) {
      void updateContainedItemsList(this);
    }
    if (this.document.system?.containerStats && type !== "container") {
      void pushContainedItemData(this);
    }

    // Legacy class-based modifier controls used by some item templates.
    if (Object.prototype.hasOwnProperty.call(this.document.system ?? {}, "skillArray")) {
      bindDelegated(el, "click", ".modifier-create", (ev) => onModifierCreate(this, ev));
      bindDelegated(el, "click", "#item-modifiers .item-delete", (ev) => onDeleteModifier(this, ev));
    }

    bindItemDescriptionTooltips(this, el);
  }

  _onClose(options) {
    clearItemDescriptionTooltip(this);
    return super._onClose(options);
  }

  /* Drag & Drop */

  /**
   * @override
   * Handle item drops. Scroll sheets accept spell drops to fill spellUuid;
   * container sheets do not accept drag/drop insertion; all others forward to
   * the parent class.
   */
  async _onDrop(event) {
    event.preventDefault();

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
        ui.notifications?.warn?.("Unable to resolve dropped item payload.");
        return;
      }

      const result = await resolveAndValidateScrollSpell(dropped);
      if (!result.ok) {
        ui.notifications?.warn?.(result.error ?? "Only spell items can be linked to a scroll.");
        return;
      }

      await applyScrollSpellLink(this, result.spellDoc);
      return;
    }

    if (this.document.type !== "container") {
      return super._onDrop?.(event);
    }
    ui.notifications?.info("Container drag-and-drop is disabled. Use + Item to add contents.");
    return;
  }
}
