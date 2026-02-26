/**
 * src/ui/sheets/v2/item-sheet.js
 *
 * ApplicationV2 Item Sheet.
 *
 * Key improvements:
 * - Uses HandlebarsApplicationMixin(ItemSheetV2) base
 * - Dynamic per-type template selection via _renderHTML override
 * - Deterministic form handler → normalizer → document.update pipeline
 * - V1-compat shims (get item, _onSubmit) allow reuse of existing listener modules
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
import { validateSpellConfig, formatSpellValidationMessage } from "../../../core/magic/spell-config.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { hasTalent } from "../../../core/traits/talents-api.js";
import { activateEditorButtons } from "../shared/editor-activation.js";
import { DEFAULTS } from "../../../core/migrations/item-defaults.generated.js";
import { traceSheetPerf } from "../../../core/debug/perf.js";
import { bindDelegated } from "./_delegated-bindings.js";
import { drinkPotion, applyAlchemyToWeapon } from "../../../core/alchemy/runtime.js";
import { alertDialog, customDialog } from "../../../utils/dialog-v2-helper.js";
import { resolveDroppedItem } from "../../../utils/drop-data.js";
import { castScrollFromItem } from "../../../core/magic/scroll-casting.js";
import { onCastEnchantmentAction } from "../shared/listeners/enchanting-cast.js";
import {
  buildSkillAdvancementPlan,
  normalizeRank as normalizeAdvancementRank,
  parseSpecializations as parseAdvancementSpecializations,
} from "../../../core/advancement/skill-advancement.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ItemSheetV2Base = foundry.applications.sheets.ItemSheetV2;
const ITEM_SHEET_TEMPLATE_BASE = "systems/uesrpg-3ev4/templates/v2/sheets";
const _FLAG_NS = "uesrpg-3ev4";
const _EQUIPMENT_ITEM_TYPES = new Set(["weapon", "armor", "ammunition", "item", "container", "scroll"]);
const SUPPORTED_ITEM_SHEET_TYPES = new Set([
  "ammunition",
  "armor",
  "combatStyle",
  "container",
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

function _normalizeSpellcastingCostMode(value) {
  const mode = String(value ?? "soul").trim().toLowerCase();
  if (mode === "magicka" || mode === "none") return mode;
  return "soul";
}

function _isSpellcastingEligibleItem(item) {
  return _EQUIPMENT_ITEM_TYPES.has(String(item?.type ?? "").toLowerCase());
}

function _buildSpellSnapshot(spell) {
  if (!spell || spell.type !== "spell") return null;
  const src = spell.toObject(false);
  return {
    name: src.name,
    type: "spell",
    img: src.img,
    system: {
      school: src.system?.school ?? "",
      level: Number(src.system?.level ?? 1),
      cost: Number(src.system?.cost ?? 0),
      hasUpkeep: src.system?.hasUpkeep === true,
      isDirect: src.system?.isDirect === true,
      hasBuffer: src.system?.hasBuffer === true,
      hasOverTime: src.system?.hasOverTime === true,
      hasOverload: src.system?.hasOverload === true,
      isRuneSpell: src.system?.isRuneSpell === true,
      isZonePersistent: src.system?.isZonePersistent === true,
      isSummonSpell: src.system?.isSummonSpell === true,
      rangeType: src.system?.rangeType ?? src.system?.range ?? "",
      aoeIncludeCaster: src.system?.aoeIncludeCaster === true,
      duration: src.system?.duration ?? {},
      damageInstances: Array.isArray(src.system?.damageInstances) ? src.system.damageInstances : [],
      targeting: src.system?.targeting ?? null,
      engine: src.system?.engine ?? null,
      defenseModel: src.system?.defenseModel ?? null,
      characteristicDefense: src.system?.characteristicDefense ?? null,
      overTimeEntries: Array.isArray(src.system?.overTimeEntries) ? src.system.overTimeEntries : []
    }
  };
}

function _buildLegacyExtensionSeed(item) {
  const enchanting = item?.flags?.[_FLAG_NS]?.enchanting ?? {};
  const cast = enchanting?.cast ?? {};
  // Do not mirror true workshop cast enchantments into the extension lane.
  if (String(enchanting?.enchantType ?? "").trim().toLowerCase() === "cast") return null;
  const hasSlots = Array.isArray(cast?.spells) && cast.spells.length > 0;
  const hasToggle = Object.prototype.hasOwnProperty.call(cast, "isSpellcastingEnabled");
  if (!hasSlots && !hasToggle) return null;
  return cast;
}

function _ensureItemSpellcastingFlags(item) {
  const existing = foundry.utils.deepClone(item?.flags?.[_FLAG_NS]?.itemSpellcasting ?? {});
  const legacySeed = _buildLegacyExtensionSeed(item);
  const source = Object.keys(existing).length ? existing : (legacySeed ?? {});
  const sourcePool = source?.pool ?? {};
  const currentPoolValue = Number(sourcePool?.value ?? item?.system?.charge?.value ?? 0);
  const currentPoolMax = Number(sourcePool?.max ?? item?.system?.charge?.max ?? currentPoolValue);
  return {
    ...source,
    version: 2,
    enabled: source?.enabled === true,
    slots: Array.isArray(source?.slots) ? source.slots : [],
    pool: {
      value: Number.isFinite(currentPoolValue) ? currentPoolValue : 0,
      max: Number.isFinite(currentPoolMax) ? currentPoolMax : 0
    },
    activeUpkeepSlotId: source?.activeUpkeepSlotId ?? null
  };
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

  /* ═══════════════════════ Static Configuration ═══════════════════════ */

  static DEFAULT_OPTIONS = {
    classes: ["worldbuilding", "sheet", "item"],
    position: { width: 640, height: 620 },
    window: { resizable: true },
    form: {
      handler: SimpleItemSheetV2.prototype._onFormSubmit,
      submitOnChange: false,
      closeOnSubmit: false,
    },
    dragDrop: [{
      dragSelector: ".item",
      dropSelector: ".window-content, .sheet-body, .tab, .container-drop-zone, .container-drop-body, .itemListContainer",
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
      validateSpell: SimpleItemSheetV2.prototype._onValidateSpell,
      previewProfile: SimpleItemSheetV2.prototype._onPreviewProfile,
      addDamageInstance: SimpleItemSheetV2.prototype._onAddDamageInstance,
      removeDamageInstance: SimpleItemSheetV2.prototype._onRemoveDamageInstance,
      // ── Containment actions ──────────────────────────────────────────
      addToContainer: SimpleItemSheetV2.prototype._onAddToContainer,
      bulkRemoveAll: SimpleItemSheetV2.prototype._onBulkRemoveAll,
      bulkDeleteAll: SimpleItemSheetV2.prototype._onBulkDeleteAll,
      removeContainedItem: SimpleItemSheetV2.prototype._onRemoveContainedItem,
      deleteContainedItem: SimpleItemSheetV2.prototype._onDeleteContainedItem,
      openContainedItem: SimpleItemSheetV2.prototype._onOpenContainedItem,
      // ── Rule Element actions ─────────────────────────────────────────
      reAdd: SimpleItemSheetV2.prototype._onReAdd,
      reDelete: SimpleItemSheetV2.prototype._onReDelete,
      reExpand: SimpleItemSheetV2.prototype._onReExpand,
      reAddCondition: SimpleItemSheetV2.prototype._onReAddCondition,
      reConditionDelete: SimpleItemSheetV2.prototype._onReConditionDelete,
      // ── Alchemy ingredient actions ───────────────────────────────────
      enableAlchemyIngredient: SimpleItemSheetV2.prototype._onEnableAlchemyIngredient,
      clearAlchemyIngredient: SimpleItemSheetV2.prototype._onClearAlchemyIngredient,
      // ── Alchemy product actions ──────────────────────────────────────
      enableAlchemyProduct: SimpleItemSheetV2.prototype._onEnableAlchemyProduct,
      clearAlchemyProduct: SimpleItemSheetV2.prototype._onClearAlchemyProduct,
      drinkAlchemyProduct: SimpleItemSheetV2.prototype._onDrinkAlchemyProduct,
      applyAlchemyProductToWeapon: SimpleItemSheetV2.prototype._onApplyAlchemyProductToWeapon,
      // ── Scroll actions ───────────────────────────────────────────────
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
    sheet: {
      // Fallback path — _renderHTML() selects the per-type template dynamically.
      template: "systems/uesrpg-3ev4/templates/v2/sheets/item-sheet.hbs",
      scrollable: [".sheet-body"],
    },
  };

  /* ═══════════════════════ V1 Compatibility Getters ═══════════════════ */

  /**
   * V1 compat: listener modules and prepareItemSheetData access `sheet.item`
   * to reach the live Item document.
   */
  get item() {
    return this.document;
  }

  /**
   * V1 compat: listener modules access `sheet.actor` for owned-item operations.
   */
  get actor() {
    return this.document?.actor ?? null;
  }

  /** Keep item window title to the document name only (no localized type prefix). */
  get title() {
    return this.document?.name ?? "";
  }

  /* ═══════════════════════ Rendering ═════════════════════════════════ */

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
    const resolvedType = SUPPORTED_ITEM_SHEET_TYPES.has(type) ? type : "item";
    parts.sheet = {
      ...parts.sheet,
      template: `${ITEM_SHEET_TEMPLATE_BASE}/${resolvedType}-sheet.hbs`,
    };
    return parts;
  }

  /**
   * @override
   * Custom _renderHTML to handle multi-root element templates.
   *
   * Item templates have two root siblings (<div class="stickyHeader"> +
   * <section class="sheet-body">).  HandlebarsApplicationMixin expects each
   * part to be a single HTMLElement, so we render via the standard pipeline
   * then wrap multi-root output in a single container.
   */
  async _renderHTML(context, options) {
    // Get the dynamically configured parts
    const parts = this._configureRenderParts(options);
    const templatePath = parts.sheet?.template ?? `${ITEM_SHEET_TEMPLATE_BASE}/item-sheet.hbs`;

    // Use per-part context preparation (preserves mixin lifecycle)
    const partContext = await this._preparePartContext("sheet", context, options);
    let htmlString;
    try {
      htmlString = await foundry.applications.handlebars.renderTemplate(templatePath, partContext);
    } catch (err) {
      const fallback = `${ITEM_SHEET_TEMPLATE_BASE}/item-sheet.hbs`;
      console.warn("UESRPG | Item sheet template missing, using fallback", {
        type: this.document.type,
        templatePath,
        fallback,
        error: err?.message ?? err,
      });
      htmlString = await foundry.applications.handlebars.renderTemplate(fallback, partContext);
    }

    // Wrap multi-root templates into a single container element
    const tmp = document.createElement("div");
    tmp.innerHTML = htmlString;
    const wrapper = document.createElement("div");
    wrapper.dataset.applicationPart = "sheet";
    while (tmp.firstChild) wrapper.appendChild(tmp.firstChild);
    return { sheet: wrapper };
  }

  /**
   * @override
   * Prepare render context for templates.
   * Builds a V1-compatible data structure then delegates to the shared
   * `prepareItemSheetData()` helper used by both V1 and V2.
   */
  async _prepareContext(options) {
    const perfStart = performance.now();
    try {
      const context = await super._prepareContext(options);

    // V1-compatible fields expected by templates + prepareItemSheetData
    // Overlay live system data so derived fields (value, *Effective, etc.)
    // survive into templates — same pattern as actor sheets.
    context.item = this.document.toObject();
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
            const linked = await fromUuid(spellUuid);
            if (linked?.documentName === "Item" && String(linked?.type ?? "") === "spell") {
              prepared.scrollLinkedSpell = {
                uuid: String(linked.uuid ?? ""),
                name: String(linked.name ?? ""),
                school: String(linked.system?.school ?? ""),
                level: Number(linked.system?.level ?? 1),
                cost: Number(linked.system?.cost ?? 0),
                form: String(linked.system?.form ?? ""),
                range: String(linked.system?.rangeType ?? linked.system?.range ?? ""),
                duration: {
                  value: Number(linked.system?.duration?.value ?? 0),
                  unit: String(linked.system?.duration?.unit ?? "instant"),
                },
                isInstant: linked.system?.isInstant === true,
                isDirect: linked.system?.isDirect === true,
                isZonePersistent: linked.system?.isZonePersistent === true,
                isRuneSpell: linked.system?.isRuneSpell === true,
                hasOverTime: linked.system?.hasOverTime === true,
                hasOverload: linked.system?.hasOverload === true,
                isSummonSpell: linked.system?.isSummonSpell === true,
                hasBuffer: linked.system?.hasBuffer === true,
                damageInstances: Array.isArray(linked.system?.damageInstances)
                  ? linked.system.damageInstances
                      .filter((di) => di && typeof di === "object")
                      .map((di) => ({
                        formula: String(di.formula ?? ""),
                        type: String(di.type ?? "none"),
                        label: String(di.label ?? ""),
                      }))
                  : [],
              };
              prepared.hasLinkedSpell = true;
            } else {
              prepared.linkedSpellUnresolved = true;
            }
          } catch (_err) {
            prepared.linkedSpellUnresolved = true;
          }
        }
      }

      prepared.enableRuleElements = Boolean(game.settings.get("uesrpg-3ev4", "enableRuleElementsRuntime"));

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

  _buildAdvancementPlan(flatData) {
    const item = this.document;
    const actor = item?.actor;
    if (!actor || actor.type !== "Player Character") return { ok: true, xpCost: 0, actor };
    if (!["skill", "magicSkill", "combatStyle"].includes(String(item.type ?? ""))) {
      return { ok: true, xpCost: 0, actor };
    }

    const oldRank = normalizeAdvancementRank(item.system?.rank);
    const newRank = normalizeAdvancementRank(foundry.utils.getProperty(flatData, "system.rank") ?? oldRank);
    const isLoreSkill = item.type === "skill" && String(item.name ?? "").trim().toLowerCase() === "lore";
    const hasScholarTalent = isLoreSkill && hasTalent(actor, "scholar");
    const rawSpecs = String(foundry.utils.getProperty(flatData, "system.trainedItems") ?? item.system?.trainedItems ?? "");
    const specCount = parseAdvancementSpecializations(rawSpecs).length;
    const rankValues = { untrained: -1, novice: 0, apprentice: 1, journeyman: 2, adept: 3, expert: 4, master: 5 };
    const rankValue = Number(rankValues[newRank] ?? -1);
    if (String(item.name ?? "").trim().toLowerCase() === "evade" && specCount > 0) {
      return { ok: false, reason: "Evade cannot have specializations (Chapter 3)." };
    }
    const baseSpecializationCap = Math.max(0, rankValue);
    const specializationCap = hasScholarTalent ? (baseSpecializationCap * 2) : baseSpecializationCap;
    const specializationUnitCost = hasScholarTalent ? 50 : 100;

    const plan = buildSkillAdvancementPlan({
      actor,
      item,
      flatData,
      options: {
        specializationCapOverride: specializationCap,
        specializationUnitCostOverride: specializationUnitCost,
      },
    });
    if (!plan.ok) {
      if (hasScholarTalent && specCount > specializationCap) {
        return { ok: false, reason: `Lore specializations exceed Scholar cap (${specializationCap}).` };
      }
      return plan;
    }

    let xpCost = Number(plan.xpCost ?? 0);

    if (item.type === "combatStyle") {
      const oldTE = Array.isArray(item.system?.trainedEquipment) ? item.system.trainedEquipment : [];
      const nextTE = Array.isArray(foundry.utils.getProperty(flatData, "system.trainedEquipment"))
        ? foundry.utils.getProperty(flatData, "system.trainedEquipment")
        : oldTE;
      const oldCount = oldTE.map(v => String(v ?? "").trim()).filter(Boolean).length;
      const newCount = nextTE.map(v => String(v ?? "").trim()).filter(Boolean).length;
      if (newCount > 10) {
        return { ok: false, reason: "Combat Style trained equipment is capped at 10 entries (Chapter 3)." };
      }
      const oldExpanded = Math.max(0, oldCount - 5);
      const newExpanded = Math.max(0, newCount - 5);
      if (newExpanded > oldExpanded) xpCost += (newExpanded - oldExpanded) * 25;

      const oldSA = item.system?.specialAdvantages ?? {};
      let oldEnabled = 0;
      let newEnabled = 0;
      const nextSAObj = foundry.utils.getProperty(flatData, "system.specialAdvantages") ?? {};
      const keys = new Set([...Object.keys(oldSA), ...Object.keys(nextSAObj)]);
      for (const k of keys) {
        const oldVal = Boolean(oldSA[k]);
        if (oldVal) oldEnabled += 1;
        const override = foundry.utils.getProperty(flatData, `system.specialAdvantages.${k}`);
        if ((override === undefined) ? oldVal : Boolean(override)) newEnabled += 1;
      }
      if (newEnabled > oldEnabled) {
        let added = newEnabled - oldEnabled;
        const rankChanged = oldRank !== newRank;
        if (oldEnabled === 0 && rankChanged && added > 0) added -= 1;
        if (added > 0) xpCost += added * 25;
      }
    }

    const currentXp = Number(actor?.system?.xp ?? 0);
    if (xpCost > currentXp) {
      return { ok: false, reason: `Not enough XP. Required: ${xpCost}, Available: ${currentXp}.` };
    }

    return { ok: true, actor, xpCost, nextXp: Math.max(0, currentXp - xpCost) };
  }

  /* ═══════════════════════ Form Submission ═══════════════════════════ */

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
    const { scalingLevels } = normalizeItemFormData(this.document, flatData);

    if (
      this.document.type === "spell" &&
      scalingLevels.length > 0 &&
      !event?.uesrpgSkipScalingValidation
    ) {
      const blocked = await validateSpellScaling(this.document, flatData, scalingLevels);
      if (blocked) return;
    }
    const advancement = this._buildAdvancementPlan(flatData);
    if (!advancement.ok) {
      ui.notifications?.warn?.(advancement.reason || "Unable to apply advancement changes.");
      return;
    }

    // Diff against current document state — only send changed fields
    const current = foundry.utils.flattenObject(this.document.toObject(false));
    flatData = foundry.utils.diffObject(current, flatData);
    if (foundry.utils.isEmpty(flatData)) return;

    await requestUpdateDocument(this.document, flatData);
    if (advancement.xpCost > 0 && advancement.actor) {
      await requestUpdateDocument(advancement.actor, { "system.xp": advancement.nextXp });
      ui.notifications?.info?.(`Spent ${advancement.xpCost} XP.`);
    }
  }

  /**
   * V1 compatibility shim: existing listener modules call
   * `sheet._onSubmit(ev, opts)` for programmatic form submission
   * (e.g., scaling-input auto-save, module-checkbox persistence).
   *
   * Collects all form data from the live DOM, normalizes, validates,
   * then updates the document.  The `preventRender` option is accepted
   * for API compat but is effectively a no-op — V2's _preRender/_onRender
   * state preservation makes re-renders safe.
   */
  async _onSubmit(event, { preventRender = false, preventClose = false } = {}) {
    const fd = new foundry.applications.ux.FormDataExtended(this.element);
    let flatData = foundry.utils.flattenObject(fd.object);
    const { scalingLevels } = normalizeItemFormData(this.document, flatData);

    const skipValidation = Boolean(event?.uesrpgSkipScalingValidation);
    if (
      !skipValidation &&
      this.document.type === "spell" &&
      scalingLevels.length > 0
    ) {
      const blocked = await validateSpellScaling(this.document, flatData, scalingLevels);
      if (blocked) return;
    }
    const advancement = this._buildAdvancementPlan(flatData);
    if (!advancement.ok) {
      ui.notifications?.warn?.(advancement.reason || "Unable to apply advancement changes.");
      return;
    }

    // Diff against current document state — only send changed fields
    const current = foundry.utils.flattenObject(this.document.toObject(false));
    flatData = foundry.utils.diffObject(current, flatData);
    if (foundry.utils.isEmpty(flatData)) return;

    await requestUpdateDocument(this.document, flatData);
    if (advancement.xpCost > 0 && advancement.actor) {
      await requestUpdateDocument(advancement.actor, { "system.xp": advancement.nextXp });
      ui.notifications?.info?.(`Spent ${advancement.xpCost} XP.`);
    }
  }

  /**
   * Submit-on-close: persist form data before the window closes.
   * Equivalent to V1's `submitOnClose: true` default behaviour.
   * @override
   */
  async close(options = {}) {
    if (this.isEditable) {
      const formEl = this.element;
      if (formEl?.isConnected) {
        try {
          const fd = new foundry.applications.ux.FormDataExtended(formEl);
          await this._onFormSubmit(null, formEl, fd);
        } catch (err) {
          console.warn("UESRPG | Item sheet V2 submit-on-close failed", err);
        }
      }
    }
    return super.close(options);
  }

  /* ═══════════════════════ Actions Map Handlers ═════════════════════ */

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

  /* ═══════════════════ Combat Style Actions ═════════════════════════ */

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
      await requestUpdateDocument(actor, { "flags.uesrpg-3ev4.activeCombatStyleId": this.document.id });
      ui.notifications?.info?.(`Active combat style set to: ${this.document.name}`);
      actor.sheet?.render?.(false);
      this.render(false);
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
      await requestUpdateDocument(actor, { "flags.uesrpg-3ev4.-=activeCombatStyleId": null });
      ui.notifications?.info?.("Combat style deactivated.");
      actor.sheet?.render?.(false);
      this.render(false);
    } catch (err) {
      console.error("UESRPG | Failed to deactivate combat style", { actor: actor?.uuid, item: this.document?.uuid, err });
      ui.notifications?.error?.("Failed to deactivate combat style.");
    }
  }

  /* ═══════════════════ Spell Scaling Actions ════════════════════════ */

  /**
   * Add a new scaling level to the spell.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onAddScalingLevel(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;

    const fallbackUnit = this.document.system?.duration?.unit || "instant";
    let currentLevels = getScalingLevelsArray(this.document).map(e => normalizeScalingEntry(e, fallbackUnit));

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

    const fallbackUnit = this.document.system?.duration?.unit || "instant";
    let currentLevels = getScalingLevelsArray(this.document).map(e => normalizeScalingEntry(e, fallbackUnit));
    const newLevels = currentLevels.filter((_, idx) => idx !== index);

    logSpellDebug("Remove scaling level", { index, newLevels });
    await requestUpdateDocument(this.document, {
      "system.scaling.levels": newLevels
    });
  }

  /* ═══════════════════ OverTime Entry Actions ═══════════════════════ */

  /**
   * Add a blank OverTime entry.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onAddOvertimeEntry(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;

    const entries = foundry.utils.deepClone(this.document.system?.overTimeEntries ?? []);
    entries.push({
      trigger: "turnStart", cadenceEvery: 1, cadenceUnit: "rounds",
      payloadType: "damage", formula: "1d6", damageType: "fire",
      saveKey: "", saveTN: 0, saveSuccess: "endEffect", saveFailure: "damage",
      maxTicks: null, label: "", chatLog: true
    });

    await requestUpdateDocument(this.document, { "system.overTimeEntries": entries });
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

    const entries = foundry.utils.deepClone(this.document.system?.overTimeEntries ?? []);
    entries.splice(index, 1);

    await requestUpdateDocument(this.document, { "system.overTimeEntries": entries });
  }

  /* ═══════════════════ Effect Recipe Actions ════════════════════════ */

  /**
   * Add a blank effect recipe entry. Guarded by enableSpellRecipes setting.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onAddEffectRecipe(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;

    const recipes = foundry.utils.deepClone(this.document.system?.engine?.effects?.recipes ?? []);
    recipes.push({ key: "", mode: "add", value: "", target: "target", label: "" });

    logSpellDebug("Add effect recipe", { newCount: recipes.length });
    await requestUpdateDocument(this.document, { "system.engine.effects.recipes": recipes });
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

    const recipes = foundry.utils.deepClone(this.document.system?.engine?.effects?.recipes ?? []);
    recipes.splice(index, 1);

    logSpellDebug("Remove effect recipe", { index, newCount: recipes.length });
    await requestUpdateDocument(this.document, { "system.engine.effects.recipes": recipes });
  }

  /* ═══════════════════ Conjure Actions ══════════════════════════════ */

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

  /* ═══════════════════ QA / Validation Actions ═════════════════════ */

  /**
   * Run spell configuration validation and display results.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  _onValidateSpell(event, target) {
    event.preventDefault();
    const result = validateSpellConfig(this.document);
    const htmlOutput = formatSpellValidationMessage(result);
    const container = this.element.querySelector(".spell-validation-output");
    if (container) container.innerHTML = htmlOutput;
  }

  /**
   * Preview the resolved spell profile (requires actor ownership).
   * Uses dynamic import to avoid circular deps in non-spell contexts.
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onPreviewProfile(event, target) {
    event.preventDefault();
    const container = this.element.querySelector(".spell-profile-preview");
    if (!container) return;

    const actor = this.document?.parent;
    if (!actor || actor.documentName !== "Actor") {
      container.innerHTML = '<span style="color: #c33;">Spell must be owned by an actor to preview the resolved profile.</span>';
      return;
    }

    try {
      const { resolveSpellProfile } = await import("../../../core/magic/spell-profile.js");
      const profile = resolveSpellProfile(this.document, actor);
      container.textContent = JSON.stringify(profile, null, 2);
    } catch (err) {
      container.innerHTML = `<span style="color: #c33;">Error resolving profile: ${err.message}</span>`;
      console.error("UESRPG | Spell profile preview error", err);
    }
  }

  /* ═══════════════════ Damage Instance Actions ═════════════════════ */

  /**
   * Add a blank damage instance (shared: spell + weapon).
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onAddDamageInstance(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;

    const instances = foundry.utils.deepClone(this.document.system?.damageInstances ?? []);
    instances.push({ formula: "", type: "none", label: "" });

    await requestUpdateDocument(this.document, { "system.damageInstances": instances });
  }

  /**
   * Remove a damage instance by index (shared: spell + weapon).
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onRemoveDamageInstance(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;

    const index = parseInt(target.dataset.index, 10);
    if (isNaN(index)) return;

    const instances = foundry.utils.deepClone(this.document.system?.damageInstances ?? []);
    instances.splice(index, 1);

    await requestUpdateDocument(this.document, { "system.damageInstances": instances });
  }

  /* ═══════════════════ Containment Action Handlers ═══════════════════ */

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

  /* ═══════════════════ Rule Element Action Handlers ══════════════════ */

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

  /* ═══════════════════════ Alchemy Ingredient Handlers ══════════════ */

  /**
   * Enable this generic item as an alchemy ingredient by writing the alchemy flags.
   * Sets default values for school, strengthBase, and depthBase.
   */
  async _onEnableAlchemyIngredient(event) {
    event.preventDefault();
    await requestUpdateDocument(this.document, {
      "flags.uesrpg-3ev4.alchemy": {
        kind: "ingredient",
        school: "destruction",
        strengthBase: 5,
        depthBase: 2,
      },
    });
  }

  /**
   * Remove alchemy ingredient status from this item by deleting the alchemy flags.
   */
  async _onClearAlchemyIngredient(event) {
    event.preventDefault();
    await requestUpdateDocument(this.document, {
      "flags.uesrpg-3ev4.-=alchemy": null,
    });
  }

  /* ═══════════════════════ Alchemy Product Handlers ═════════════════ */

  /**
   * Enable this generic item as an alchemy product (potion / poison / toxin).
   * Writes minimal alchemy flags and marks the item as consumable.
   */
  async _onEnableAlchemyProduct(event, target) {
    event.preventDefault();
    const kind = String(target?.dataset?.kind ?? "potion");
    if (!(["potion", "poison", "toxin"].includes(kind))) {
      ui.notifications.warn("Unknown alchemy product type.");
      return;
    }

    const baseFlags = {
      kind,
      backfired: false,
      brew: {
        alchemistActorUuid: this.actor?.uuid ?? null,
        alchemyRank: null,
        brewedAt: Date.now(),
      },
    };

    const kindFlags = kind === "poison"
      ? { poisonLevel: 1, damageFormula: "1d4" }
      : kind === "toxin"
      ? { effects: [], durationRounds: 10, maxHits: 3 }
      : { effects: [] };

    await requestUpdateDocument(this.document, {
      "system.consumable": true,
      "system.wearable": false,
      "system.equipped": false,
      "flags.uesrpg-3ev4.alchemy": { ...baseFlags, ...kindFlags },
    });
  }

  /** Remove alchemy product flags from this item. */
  async _onClearAlchemyProduct(event) {
    event.preventDefault();
    await requestUpdateDocument(this.document, {
      "flags.uesrpg-3ev4.-=alchemy": null,
    });
  }

  /** Drink a potion directly from the item sheet (owned items only). */
  async _onDrinkAlchemyProduct(event) {
    event.preventDefault();

    const actor = this.actor;
    if (!actor) {
      ui.notifications.warn("This item is not owned by an actor.");
      return;
    }

    const kind = this.document?.flags?.["uesrpg-3ev4"]?.alchemy?.kind;
    if (kind !== "potion") {
      ui.notifications.warn("Only potions can be drunk.");
      return;
    }

    await drinkPotion(actor, this.document);
  }

  /** Apply a poison/toxin to an equipped weapon (owned items only). */
  async _onApplyAlchemyProductToWeapon(event) {
    event.preventDefault();

    const actor = this.actor;
    if (!actor) {
      ui.notifications.warn("This item is not owned by an actor.");
      return;
    }

    const kind = String(this.document?.flags?.["uesrpg-3ev4"]?.alchemy?.kind ?? "");
    if (!(kind === "poison" || kind === "toxin")) {
      ui.notifications.warn("Only poisons and toxins can be applied to weapons.");
      return;
    }

    const weapons = actor.items.filter((i) => i.type === "weapon" && i.system?.equipped === true);
    if (!weapons.length) {
      await alertDialog({
        title: "Apply to Weapon",
        content: "<p>No equipped weapons were found on this actor.</p>",
      });
      return;
    }

    const options = weapons.map((w) => `<option value="${w.id}">${w.name}</option>`).join("");
    const content = `
      <div class="uesrpg-apply-alchemy-form">
        <div class="form-group">
          <label>Weapon</label>
          <select name="weaponId">${options}</select>
        </div>
      </div>
    `;

    const weaponId = await customDialog({
      title: "Apply to Weapon",
      content,
      yes: {
        label: "Apply",
        icon: "fas fa-check",
        callback: (html) => html?.querySelector?.("select[name='weaponId']")?.value,
      },
      no: { label: "Cancel", icon: "fas fa-times" },
      defaultButton: "yes",
    });

    if (!weaponId || typeof weaponId !== "string") return;

    const weapon = actor.items.get(weaponId);
    if (!weapon) {
      ui.notifications.warn("Selected weapon could not be found.");
      return;
    }

    await applyAlchemyToWeapon(actor, this.document, weapon);
  }

  /* ═══════════════════════ Scroll Actions ════════════════════════════ */

  /**
   * Cast the spell referenced by this scroll.
   * Resolves the spell via spellUuid, delegates to SpellCastingService with
   * scroll-specific flags, then decrements quantity on a non-cancelled attempt.
   *
   * @param {Event} event
   * @param {HTMLElement} target
   */
  async _onCastScroll(event, target) {
    event.preventDefault();

    const scroll = this.document;

    const result = await castScrollFromItem({
      scrollItem: scroll,
      casterActor: this.actor,
      castActionType: "primary",
    });

    if (result?.error) {
      ui.notifications.warn(result.error);
      return;
    }

    if (result?.consumed === true && Number(result.newQty ?? 1) === 0) {
      ui.notifications.info(`${scroll.name} has been used up.`);
    }
  }

  async _onToggleSpellcastingEnable(event, target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    if (!_isSpellcastingEligibleItem(this.document)) {
      ui.notifications?.warn?.("Spellcasting configuration is available only for equipment items.");
      return;
    }

    const spellcasting = _ensureItemSpellcastingFlags(this.document);
    const nextEnabled = spellcasting.enabled !== true;
    spellcasting.enabled = nextEnabled;
    await requestUpdateDocument(this.document, {
      [`flags.${_FLAG_NS}.itemSpellcasting`]: spellcasting
    });
  }

  async _onAddSpellcastingSlot(event, target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    if (!_isSpellcastingEligibleItem(this.document)) return;

    const spellcasting = _ensureItemSpellcastingFlags(this.document);
    const slots = Array.isArray(spellcasting.slots) ? spellcasting.slots : [];
    const nextIndex = slots.length + 1;
    slots.push({
      id: foundry.utils.randomID(12),
      source: "conventional",
      label: `Stored Spell ${nextIndex}`,
      level: 1,
      cost: 0,
      attributes: [],
      spellUuid: "",
      snapshot: null,
      bindingStrength: 1,
      enabled: true,
      costMode: "soul"
    });
    spellcasting.slots = slots;

    await requestUpdateDocument(this.document, {
      [`flags.${_FLAG_NS}.itemSpellcasting`]: spellcasting
    });
  }

  async _onRemoveSpellcastingSlot(event, target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    const slotId = String(target?.dataset?.slotId ?? "").trim();
    if (!slotId) return;

    const spellcasting = _ensureItemSpellcastingFlags(this.document);
    spellcasting.slots = (Array.isArray(spellcasting.slots) ? spellcasting.slots : [])
      .filter((s) => String(s?.id ?? "") !== slotId);

    await requestUpdateDocument(this.document, {
      [`flags.${_FLAG_NS}.itemSpellcasting`]: spellcasting
    });
  }

  async _onEditSpellcastingSlot(event, target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;

    const spellcasting = _ensureItemSpellcastingFlags(this.document);
    const rows = Array.from(this.element?.querySelectorAll?.("[data-spellcasting-slot-id]") ?? []);
    const byId = new Map((Array.isArray(spellcasting.slots) ? spellcasting.slots : []).map((s) => [String(s?.id ?? ""), s]));
    const nextSlots = [];

    for (const row of rows) {
      const slotId = String(row?.dataset?.spellcastingSlotId ?? "").trim();
      if (!slotId) continue;
      const prev = byId.get(slotId) ?? { id: slotId };
      const labelInput = row.querySelector("[data-spellcasting-field='label']");
      const costInput = row.querySelector("[data-spellcasting-field='cost']");
      const bsInput = row.querySelector("[data-spellcasting-field='bindingStrength']");
      const modeInput = row.querySelector("[data-spellcasting-field='costMode']");
      const enabledInput = row.querySelector("[data-spellcasting-field='enabled']");

      const label = String(labelInput?.value ?? prev?.label ?? "Stored Spell").trim() || "Stored Spell";
      const cost = Math.max(0, Number(costInput?.value ?? prev?.cost ?? 0) || 0);
      const bindingStrength = Math.max(0, Math.min(10, Number(bsInput?.value ?? prev?.bindingStrength ?? 0) || 0));
      const costMode = _normalizeSpellcastingCostMode(modeInput?.value ?? prev?.costMode);
      const enabled = enabledInput ? enabledInput.checked === true : prev?.enabled !== false;
      const hasSpellRef = String(prev?.spellUuid ?? "").trim().length > 0 || !!prev?.snapshot;
      if (enabled && !hasSpellRef) {
        ui.notifications?.warn?.(`Slot "${label}" must have a selected spell before enabling.`);
        return;
      }

      nextSlots.push({
        ...prev,
        id: slotId,
        label,
        cost,
        bindingStrength,
        costMode,
        enabled
      });
    }

    spellcasting.slots = nextSlots;

    const chargeValueInput = this.element?.querySelector?.("[data-spellcasting-charge='value']");
    const chargeMaxInput = this.element?.querySelector?.("[data-spellcasting-charge='max']");
    const nextChargeValue = Math.max(0, Number(chargeValueInput?.value ?? this.document?.system?.charge?.value ?? 0) || 0);
    const nextChargeMaxRaw = Math.max(0, Number(chargeMaxInput?.value ?? this.document?.system?.charge?.max ?? 0) || 0);
    const nextChargeMax = Math.max(nextChargeValue, nextChargeMaxRaw);

    await requestUpdateDocument(this.document, {
      [`flags.${_FLAG_NS}.itemSpellcasting`]: spellcasting,
      "system.charge.value": nextChargeValue,
      "system.charge.max": nextChargeMax
    });
  }

  async _onPickSpellcastingSlotSpell(event, target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    const slotId = String(target?.dataset?.slotId ?? "").trim();
    if (!slotId) return;

    const actorSpells = Array.from(this.actor?.items ?? []).filter((i) => i?.type === "spell");
    const spellOptions = actorSpells
      .map((s) => `<option value="${String(s.id)}">${s.name} (${String(s.system?.school ?? "")} L${Number(s.system?.level ?? 1)})</option>`)
      .join("");

    const content = `
      <div class="uesrpg-cast-slot-picker">
        <div class="form-group">
          <label><b>Actor Spell</b></label>
          <select name="knownSpellId" style="width:100%;">
            <option value="">-- Use UUID below --</option>
            ${spellOptions}
          </select>
        </div>
        <div class="form-group">
          <label><b>Spell UUID (fallback)</b></label>
          <input type="text" name="spellUuid" style="width:100%;" placeholder="Compendium.x.y or Actor.x.Item.y" />
        </div>
      </div>
    `;

    const pick = await customDialog({
      title: "Select Stored Spell",
      content,
      yes: {
        label: "Set Spell",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return {
            knownSpellId: String(root?.querySelector?.("select[name='knownSpellId']")?.value ?? "").trim(),
            spellUuid: String(root?.querySelector?.("input[name='spellUuid']")?.value ?? "").trim()
          };
        }
      },
      no: { label: "Cancel" },
      defaultButton: "yes"
    });
    if (!pick) return;

    const spellcasting = _ensureItemSpellcastingFlags(this.document);
    const slots = Array.isArray(spellcasting.slots) ? spellcasting.slots : [];
    const idx = slots.findIndex((s) => String(s?.id ?? "") === slotId);
    if (idx < 0) return;

    const next = foundry.utils.deepClone(slots[idx]);
    let spellDoc = null;
    if (pick.knownSpellId && this.actor) {
      spellDoc = this.actor.items.get(pick.knownSpellId) ?? null;
      next.spellUuid = String(spellDoc?.uuid ?? "");
    } else if (pick.spellUuid) {
      next.spellUuid = pick.spellUuid;
      try {
        const doc = await fromUuid(pick.spellUuid);
        if (doc?.documentName === "Item" && doc.type === "spell") spellDoc = doc;
      } catch (_err) {
        spellDoc = null;
      }
    } else {
      ui.notifications?.warn?.("Select a known spell or provide a spell UUID.");
      return;
    }

    if (spellDoc?.type === "spell") {
      next.label = String(spellDoc.name ?? next.label ?? "Stored Spell");
      next.level = Number(spellDoc.system?.level ?? next.level ?? 1);
      next.snapshot = _buildSpellSnapshot(spellDoc);
      if (!(Number(next.cost) > 0)) {
        next.cost = Number(spellDoc.system?.cost ?? 0);
      }
    }

    slots[idx] = next;
    spellcasting.slots = slots;
    await requestUpdateDocument(this.document, {
      [`flags.${_FLAG_NS}.itemSpellcasting`]: spellcasting
    });
  }

  async _onCastEnchantment(event, target) {
    return onCastEnchantmentAction.call(this, event, target, this.document);
  }

  /* ═══════════════════════ Native Non-Click Listeners ═══════════════ */

  /**
   * Ammunition: live-update derived Price/Shot display when Price/10 changes.
   * Pure DOM math — no document mutation.
   * @param {HTMLElement} el
   */
  _registerAmmunitionListeners(el) {
    const p10Input = el.querySelector('input[name="system.pricePer10"]');
    const pShotDisplay = el.querySelector('[data-uesrpg="pricePerShot"]');
    if (!p10Input || !pShotDisplay) return;

    const refresh = () => {
      const v = Number(p10Input.value || 0);
      const ps = Math.round((v / 10) * 100) / 100;
      pShotDisplay.value = String(ps);
    };

    p10Input.addEventListener("input", refresh);
    p10Input.addEventListener("change", refresh);
  }

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
    // ── Scaling input change (delegated) ────────────────────────────────
    // Auto-save scaling field changes without rerender.
    el.addEventListener("change", async (ev) => {
      if (!ev.target.closest("[data-scaling-input]")) return;
      if (!this.isEditable) return;

      ev.uesrpgSkipScalingValidation = true;
      logSpellDebug("Scaling input change", { name: ev.target?.name, value: ev.target?.value });

      try {
        await this._onSubmit(ev, { preventRender: true, preventClose: true });
      } catch (err) {
        console.warn("UESRPG | Failed to auto-save scaling input change", err);
      }
    });

    // ── Automation module inputs (data-spell-module) ────────────────────
    // Auto-save module checkbox/input changes without rerender to
    // prevent the Advanced Options <details> from collapsing.
    const moduleInputs = el.querySelectorAll("[data-spell-module]");
    moduleInputs.forEach(input => {
      input.addEventListener("change", async (ev) => {
        if (!this.isEditable) return;
        logSpellDebug("Automation module input change", { name: ev.target?.name, value: ev.target?.value, checked: ev.target?.checked });

        try {
          await this._onSubmit(ev, { preventRender: true, preventClose: true });
        } catch (err) {
          console.warn("UESRPG | Failed to auto-save automation module change", err);
        }
      });

      // Prevent clicks on module inputs from toggling parent <details>.
      input.addEventListener("click", (ev) => ev.stopPropagation());
    });

    // Also prevent label/title clicks from toggling <details>.
    el.querySelectorAll(".spell-advanced-body label.spell-check, .spell-module-title").forEach(node => {
      node.addEventListener("click", (ev) => ev.stopPropagation());
    });

    // ── Recipe input auto-save (guarded by enableSpellRecipes) ──────────
    let recipesEnabled = false;
    try { recipesEnabled = game.settings.get("uesrpg-3ev4", "enableSpellRecipes") === true; } catch (_e) { /* noop */ }

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

    // ── Conjure: Drag-drop support for item/actor UUID fields ───────────
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
   * Container sheets: contextmenu bulk-add + drag visual feedback.
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

    // Drag visual feedback on the drop zone
    const dropZone = el.querySelector(".container-drop-zone");
    if (dropZone) {
      dropZone.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        dropZone.classList.add("drag-over");
      });

      dropZone.addEventListener("dragleave", (ev) => {
        const rect = ev.currentTarget.getBoundingClientRect();
        const x = ev.clientX;
        const y = ev.clientY;
        if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
          dropZone.classList.remove("drag-over");
        }
      });

      dropZone.addEventListener("drop", () => {
        dropZone.classList.remove("drag-over");
      });
    }

    // Drag visual feedback on contained item rows
    for (const row of el.querySelectorAll("[draggable='true']")) {
      row.addEventListener("dragstart", () => {
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        if (dropZone) dropZone.classList.remove("drag-over");
      });
    }
  }

  /**
   * Scroll sheet: live spell UUID validation + enlarged drop zone behavior.
   * @param {HTMLElement} el
   */
  _registerScrollListeners(el) {
    const uuidInput = el.querySelector('input[name="system.spellUuid"]');
    const dropZone = el.querySelector('[data-scroll-spell-drop-zone="true"]');

    const commitInputValue = async () => {
      if (!this.isEditable) return;
      if (!uuidInput) return;

      const result = await this._resolveAndValidateScrollSpell(uuidInput.value);
      if (!result.ok) {
        ui.notifications?.warn?.(result.error ?? "Invalid spell UUID.");
        uuidInput.value = String(this.document.system?.spellUuid ?? "");
        return;
      }

      await this._applyScrollSpellLink(result.spellDoc);
      uuidInput.value = String(result.canonicalUuid ?? "");
    };

    if (uuidInput) {
      uuidInput.addEventListener("change", async () => {
        await commitInputValue();
      });

      uuidInput.addEventListener("keydown", async (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        await commitInputValue();
      });
    }

    if (!dropZone) return;

    dropZone.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "link";
      dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", (ev) => {
      const rect = dropZone.getBoundingClientRect();
      const x = ev.clientX;
      const y = ev.clientY;
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
        dropZone.classList.remove("drag-over");
      }
    });

    dropZone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      dropZone.classList.remove("drag-over");
      if (!this.isEditable) return;

      const dragData = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
      const dropped = await resolveDroppedItem(dragData);
      if (!dropped) {
        ui.notifications?.warn?.("Unable to resolve dropped item payload.");
        return;
      }

      const result = await this._resolveAndValidateScrollSpell(dropped);
      if (!result.ok) {
        ui.notifications?.warn?.(result.error ?? "Unable to resolve dropped item payload.");
        return;
      }

      await this._applyScrollSpellLink(result.spellDoc);
      if (uuidInput) uuidInput.value = String(result.canonicalUuid ?? "");
    });
  }

  /**
   * Normalize manually entered spell references into a canonical UUID if possible.
   * Accepts full UUIDs and world item ids.
   * @param {string} raw
   * @returns {Promise<string>}
   */
  async _normalizeScrollSpellUuid(raw) {
    const value = String(raw ?? "").trim();
    if (!value) return "";

    // UUID-like text; resolve if possible.
    if (value.includes(".")) {
      try {
        const doc = await fromUuid(value);
        if (doc?.documentName === "Item") return String(doc.uuid ?? value);
      } catch (_err) {
        // Fall through to id lookup.
      }
    }

    // World item id fallback.
    const worldItem = game.items?.get?.(value) ?? null;
    if (worldItem?.documentName === "Item") return String(worldItem.uuid ?? value);

    return value;
  }

  /**
   * Resolve and validate a scroll spell reference.
   * @param {string|Item|null} rawOrDoc
   * @returns {Promise<{ok: boolean, spellDoc: Item|null, canonicalUuid: string, error?: string}>}
   */
  async _resolveAndValidateScrollSpell(rawOrDoc) {
    if (!rawOrDoc) {
      return { ok: true, spellDoc: null, canonicalUuid: "" };
    }

    let doc = rawOrDoc;

    if (typeof rawOrDoc === "string") {
      const normalized = await this._normalizeScrollSpellUuid(rawOrDoc);
      if (!normalized) return { ok: true, spellDoc: null, canonicalUuid: "" };
      try {
        doc = await fromUuid(normalized);
      } catch (_err) {
        doc = null;
      }
      if (!doc) {
        return { ok: false, spellDoc: null, canonicalUuid: "", error: "Could not resolve spell UUID." };
      }
    }

    if (doc?.documentName !== "Item") {
      return { ok: false, spellDoc: null, canonicalUuid: "", error: "Dropped or referenced document is not an Item." };
    }

    if (String(doc.type ?? "") !== "spell") {
      return { ok: false, spellDoc: null, canonicalUuid: "", error: "Only spell items can be linked to a scroll." };
    }

    return { ok: true, spellDoc: doc, canonicalUuid: String(doc.uuid ?? "") };
  }

  /**
   * Persist scroll spell link (or clear it).
   * @param {Item|null} spellDocOrNull
   */
  async _applyScrollSpellLink(spellDocOrNull) {
    const nextUuid = String(spellDocOrNull?.uuid ?? "");
    const ok = await requestUpdateDocument(this.document, { "system.spellUuid": nextUuid });
    if (!ok) {
      ui.notifications?.warn?.("Failed to update scroll spell reference.");
      return;
    }

    if (spellDocOrNull) {
      ui.notifications?.info?.(`Scroll linked to "${spellDocOrNull.name}".`);
    } else {
      ui.notifications?.info?.("Scroll spell reference cleared.");
    }
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

  /* ═══════════════════════ UI State Preservation ═════════════════════ */

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
    try {
      super._onRender(context, options);

      el = this.element;
      if (!el) return;

      // ── Restore saved UI state ─────────────────────────────────────────
      const state = this._savedState;
      if (state) {
      // Expanded Rule Elements
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
        // Re-inflate dynamically rendered type-specific fields
        renderFieldsForElement(li, this.document);
        renderConditionFieldsForElement(li, this.document);
      });

      // <details> open state
      state.openDetails?.forEach(key => {
        const d =
          el.querySelector(`details[data-uesrpg="${key}"]`) ||
          el.querySelector(`details.${CSS.escape(key)}`);
        if (d) d.open = true;
      });

        this._savedState = null;
      }

    // ── Type-specific CSS classes ──────────────────────────────────────
    // V1 passed the document type as a CSS class on the <form> element
    // (via {{cssClass}}).  In V2 we add it to the application wrapper so
    // selectors like `.worldbuilding.sheet.item.spell` continue to match.
      el.classList.add(this.document.type);

    // Spell template originally also carried class="spell-sheet" on the
    // <form>; used by spell-sheet-compact.css with a different selector.
      if (this.document.type === "spell") {
        el.classList.add("spell-sheet");
      }

    // ── Tab handling (native AppV2) ─────────────────────────────────────
    // Different item types render different tab subsets; fall back to the
    // first nav anchor present if the remembered tab is absent.
      const desiredTab = this.tabGroups.primary ?? "description";
      const hasTab = el.querySelector(`.tabs [data-group="primary"][data-tab="${desiredTab}"]`);
      const targetTab = hasTab ? desiredTab
        : (el.querySelector('.tabs [data-group="primary"]')?.dataset?.tab ?? "description");
      this.changeTab(targetTab, "primary", { force: true });

      // ── Type-specific native listeners ───────────────────────────────
      const type = this.document.type;
      if (type === "ammunition") this._registerAmmunitionListeners(el);
      if (type === "combatStyle" && this.document.isOwned && this.document.actor) this._registerCombatStyleListeners(el);
      if (type === "spell") this._registerSpellListeners(el);
      if (type === "scroll") this._registerScrollListeners(el);
      if (type === "container") this._registerContainmentListeners(el);

      const _featureTypes = new Set(["trait", "talent", "power"]);
      if (_featureTypes.has(type)) this._registerRuleElementListeners(el);

      // ── Containment side-effect calls (keep snapshot data in sync) ───
      if (type === "container" && this.document.isOwned) {
        void updateContainedItemsList(this);
      }
      if (this.document.system?.containerStats && type !== "container") {
        void pushContainedItemData(this);
      }

      // ── Re-wire editor buttons (bypasses core activation when _renderHTML is custom) ───
      activateEditorButtons(this, el);

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

  _onClose(options) {
    return super._onClose(options);
  }

  /* ═══════════════════════ Drag & Drop ═══════════════════════════════ */

  /**
   * @override
   * Handle drag-start for contained items in container sheets.
   * Creates drag data for the actor-owned contained item (not the container).
   */
  _onDragStart(event) {
    if (this.document.type !== "container" || !this.document.actor) {
      return super._onDragStart(event);
    }

    const row = event.target?.closest?.("[data-item-id]");
    const itemId = row?.dataset?.itemId;
    if (!itemId) return super._onDragStart(event);

    const actorItem = this.document.actor.items.get(itemId);
    if (!actorItem) return super._onDragStart(event);

    const dragData = { type: "Item", uuid: actorItem.uuid };
    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }

  /**
   * @override
   * Handle item drops. Scroll sheets accept spell drops to fill spellUuid;
   * container sheets delegate to their containment module; all others forward
   * to the parent class.
   */
  async _onDrop(event) {
    event.preventDefault();

    // Scroll: accept a dropped spell item to fill the spellUuid field.
    if (this.document.type === "scroll") {
      // Dedicated drop-zone listener handles this path already.
      if (event?.target?.closest?.('[data-scroll-spell-drop-zone="true"]')) return;

      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if (data?.type !== "Item") {
        return super._onDrop?.(event);
      }

      const dropped = await resolveDroppedItem(data);
      if (!dropped) {
        ui.notifications?.warn?.("Unable to resolve dropped item payload.");
        return;
      }

      const result = await this._resolveAndValidateScrollSpell(dropped);
      if (!result.ok) {
        ui.notifications?.warn?.(result.error ?? "Only spell items can be linked to a scroll.");
        return;
      }

      await this._applyScrollSpellLink(result.spellDoc);
      return;
    }

    if (this.document.type !== "container") {
      return super._onDrop?.(event);
    }

    if (!this.document.isOwned || !this.document.actor) {
      ui.notifications?.warn("Containers must be owned by an Actor to accept dropped items.");
      return;
    }

    if (!this.isEditable || !this.document.actor.isOwner) {
      ui.notifications?.warn("You do not have permission to modify this container.");
      return;
    }

    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Item") {
      return super._onDrop?.(event);
    }

    const { onDropItemIntoContainer } = await import("../item/listeners/containment.js");
    return onDropItemIntoContainer(this, data);
  }
}
