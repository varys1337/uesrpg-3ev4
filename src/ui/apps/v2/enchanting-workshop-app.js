/**
 * @module ui/apps/v2/enchanting-workshop-app
 *
 * src/ui/apps/v2/enchanting-workshop-app.js
 *
 * Enchanting Workshop - ApplicationV2 wizard UI.
 *
 * Launched via macro: `new EnchantingWorkshopAppV2({ actorUuid }).render(true)`
 *
 * Modes:
 *  1. cast     - Create Cast Enchantment
 *  2. strike   - Create Strike Enchantment
 *  3. constant - Create Constant Enchantment
 *  4. recharge - Recharge Cast Enchantment
 *  5. toggle   - Toggle Constant Enchantment
 *
 * AppV2 patterns:
 *  - HandlebarsApplicationMixin + ApplicationV2
 *  - All state derived from flagsPayload / build results - no phantom state
 *  - The instance-bound form handler prepares a pending chat workflow; rolls
 *    and document mutations are resolved from the chat card.
 *
 * Target: Foundry VTT v14.363+
 */

import {
  getSoulGems,
  isSoulGemResourceUsable,
  resolveSoulGemData,
} from "../../../core/enchanting/soul-gems.js";
import { getItemEL, isItemEnchanted } from "../../../core/enchanting/enchant-level.js";
import { getEnchantTN, getEnchantRank, getEffectiveEnchantRank } from "../../../core/enchanting/penalties.js";
import { rechargeEnchantment, toggleConstantEnchantment } from "../../../core/enchanting/builders/finalize.js";
import { createPendingEnchantmentMessage } from "../../../core/enchanting/workflow.js";
import { hasTalent } from "../../../core/traits/talents-api.js";

// Catalog data (JS modules - avoids import assertion browser compatibility issues)
import { SPELL_EFFECTS_CATALOG as spellEffectsCatalog } from "../../../data/spell-effects-catalog.js";
import { STRIKE_ENCHANTMENTS_CATALOG as strikeEnchantmentsCatalog } from "../../../data/strike-enchantments-catalog.js";
import {
  getLocalizedSpellFormsCatalog,
  localizeSpellEffect,
  localizeStrikeEnchantment,
} from "../../../data/spell-i18n.js";
import { SYSTEM_ID, templatePath } from "../../constants.js";
import { asyncGuardSheet } from "../../../utils/async-guard.js";
import { t, tf } from "../../../utils/i18n.js";
import { activateOpenApplication } from "./application-focus.js";
import { withApplicationUniqueId } from "./application-identity.js";
import { readDropData, resolveDroppedItem } from "../../../utils/drop-data.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { clearQueuedRenderPartsState, queueRenderParts } from "../../sheets/v2/shared/sheet-runtime-helpers.js";
import {
  buildActorStoredSpellOptions,
  buildStoredSpellSnapshot,
  resolveStoredSpellDocument,
} from "../../shared/stored-spell-options.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = SYSTEM_ID;

const WORKSHOP_MODES = ["cast", "strike", "constant", "recharge", "toggle"];

export class EnchantingWorkshopAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static #openByActor = new Map();

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "uesrpg-enchanting-workshop-{id}",
    tag: "form",
    form: {
      handler: asyncGuardSheet(EnchantingWorkshopAppV2.prototype._onSubmit),
      closeOnSubmit: false,
      submitOnChange: false,
    },
    actions: {
      modeChange: EnchantingWorkshopAppV2.prototype._onModeChange,
      chooseResource: EnchantingWorkshopAppV2.prototype._onChooseResource,
      clearResource: EnchantingWorkshopAppV2.prototype._onClearResource,
    },
    window: {
      resizable: true,
    },
    position: {
      width: 720,
      height: 680,
    },
    classes: ["uesrpg", "enchanting-workshop"],
  };

  /** @override */
  static PARTS = {
    form: {
      template: templatePath("v2/apps/enchanting-workshop.hbs"),
      scrollable: [".enchanting-workshop-body"],
    },
  };

  static getOpenInstance(actorUuid = "") {
    return this.#openByActor.get(String(actorUuid ?? "").trim()) ?? null;
  }

  static findOpenInstance(predicate = null) {
    const matcher = typeof predicate === "function" ? predicate : () => true;
    for (const app of this.#openByActor.values()) {
      if (app?.rendered && matcher(app)) return app;
    }
    return null;
  }

  static async prompt({ actorUuid = null, mode = "cast" } = {}) {
    const key = String(actorUuid ?? "").trim();
    if (key) {
      const existing = this.getOpenInstance(key);
      if (existing?.rendered) {
        if (WORKSHOP_MODES.includes(mode)) existing._mode = mode;
        existing._previewResult = null;
        return activateOpenApplication(existing, { render: { parts: ["form"] } });
      }
    }

    const app = new EnchantingWorkshopAppV2({ actorUuid, mode });
    if (key) this.#openByActor.set(key, app);
    await app.render(true);
    return app;
  }

  /**
   * @param {{ actorUuid: string, mode?: string }} options
   */
  constructor(options = {}) {
    super(withApplicationUniqueId(options, options.actorUuid ?? "unbound"));
    this._actorUuid = options.actorUuid ?? null;
    this._mode = WORKSHOP_MODES.includes(options.mode) ? options.mode : "cast";
    this._previewResult = null; // Last preview from _onChangeForm
    this._selection = { targetItemUuid: null, soulGemUuid: null, enchantedItemUuid: null };
    this._ownedHooks = [];
  }

  get title() {
    return t("UESRPG.Apps.EnchantingWorkshop.Title", "Enchanting Workshop");
  }

  _isEligibleTarget(item, mode = this._mode) {
    if (!item || item.parent?.uuid !== this._actorUuid || resolveSoulGemData(item)) return false;
    if (mode === "strike") return item.type === "weapon";
    if (mode === "recharge") return item.flags?.[NAMESPACE]?.enchanting?.enchantType === "cast";
    if (mode === "toggle") return item.flags?.[NAMESPACE]?.enchanting?.enchantType === "constant";
    return ["weapon", "armor", "item"].includes(item.type);
  }

  _resourceDescriptor(item, kind) {
    if (!item) return null;
    if (kind === "gem") {
      const gem = resolveSoulGemData(item);
      if (!gem) return null;
      return {
        uuid: item.uuid,
        name: item.name,
        img: item.img,
        quantity: Math.max(0, Number(item.system?.quantity ?? 1) || 0),
        meta: gem.isFilled
          ? tf("UESRPG.Apps.EnchantingWorkshop.Dropzones.GemMeta", { size: gem.soulSize, energy: gem.soulEnergy, capacity: gem.maxSoulEnergy }, `${gem.soulSize} · ${gem.soulEnergy}/${gem.maxSoulEnergy} energy`)
          : tf("UESRPG.Apps.EnchantingWorkshop.Dropzones.EmptyGemMeta", { size: gem.soulSize, capacity: gem.maxSoulEnergy }, `Empty ${gem.soulSize} · capacity ${gem.maxSoulEnergy}`),
      };
    }
    const enchanting = item.flags?.[NAMESPACE]?.enchanting;
    const pool = enchanting?.cast?.pool ?? enchanting?.strike?.pool ?? null;
    return {
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      quantity: Math.max(1, Number(item.system?.quantity ?? 1) || 1),
      meta: pool
        ? tf("UESRPG.Apps.EnchantingWorkshop.Dropzones.PoolMeta", { value: pool.value, max: pool.max }, `Pool ${pool.value}/${pool.max}`)
        : tf("UESRPG.Apps.EnchantingWorkshop.Dropzones.ItemMeta", { type: item.type, el: getItemEL(item) }, `${item.type} · EL ${getItemEL(item)}`),
    };
  }

  async _resolveSelectedActorItem(actor, key) {
    const uuid = String(this._selection[key] ?? "").trim();
    if (!uuid) return null;
    const item = await fromUuid(uuid).catch(() => null);
    if (item?.documentName !== "Item" || item.parent?.uuid !== actor?.uuid) {
      this._selection[key] = null;
      return null;
    }
    return actor.items?.get?.(item.id) ?? item;
  }

  _onClose(options = {}) {
    const key = String(this._actorUuid ?? "").trim();
    if (key) EnchantingWorkshopAppV2.#openByActor.delete(key);
    for (const [event, hookId] of this._ownedHooks) Hooks.off(event, hookId);
    this._ownedHooks = [];
    clearQueuedRenderPartsState(this);
    return super._onClose(options);
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this._registerDocumentHooks();
  }

  /** @override */
  async _prepareContext(options) {
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;

    // Actor data
    const enchantTN = actor ? getEnchantTN(actor) : 0;
    const enchantRank = actor ? getEnchantRank(actor) : 0;
    const hasManifold = actor ? hasTalent(actor, "manifoldenchanter") : false;
    const hasProcedural = actor ? hasTalent(actor, "proceduralenchanting") : false;
    const hasSalvage = actor ? hasTalent(actor, "salvageenergy") : false;

    // Soul Gems. Empty gems remain visible in the UI but can never be selected
    // as an enchanting resource.
    const soulGems = actor ? getSoulGems(actor) : [];
    const gemOptions = soulGems.map(gem => {
      const d = resolveSoulGemData(gem);
      const quantity = Math.max(1, Number(gem.system?.quantity ?? 1) || 1);
      return {
        uuid: gem.uuid,
        id: gem.id,
        name: gem.name,
        soulEnergy: d?.soulEnergy ?? 0,
        maxSoulEnergy: d?.maxSoulEnergy ?? 0,
        soulType: d?.soulType ?? "white",
        soulSize: d?.soulSize ?? "Unknown",
        quantity,
        isFilled: d?.isFilled === true,
        isReusable: d?.isReusable === true,
        isUsable: isSoulGemResourceUsable(gem, d),
        disabled: !isSoulGemResourceUsable(gem, d),
        recognitionSource: d?.recognitionSource ?? "flags",
        label: d?.isFilled
          ? tf("UESRPG.Apps.EnchantingWorkshop.FilledGemOption", {
              name: gem.name,
              size: d.soulSize,
              energy: d.soulEnergy,
              quantity,
            })
          : tf("UESRPG.Apps.EnchantingWorkshop.EmptyGemOption", {
              name: gem.name,
              size: d?.soulSize ?? "Unknown",
              capacity: d?.maxSoulEnergy ?? 0,
              quantity,
            }),
      };
    });
    const soulGemCount = gemOptions.reduce((total, gem) => total + gem.quantity, 0);
    const filledGemCount = gemOptions
      .filter(gem => gem.isUsable)
      .reduce((total, gem) => total + gem.quantity, 0);
    const emptyGemCount = soulGemCount - filledGemCount;

    // Enchantable items (all items with EL > 0 or no EL)
    const enchantableItems = actor
      ? (actor.items ?? []).filter(i => {
          if (!["weapon", "armor", "item"].includes(i.type)) return false;
          if (resolveSoulGemData(i)) return false;
          if (i.type === "item" && !i.name?.toLowerCase().includes("ammo") &&
              !i.name?.toLowerCase().includes("arrow") &&
              !i.name?.toLowerCase().includes("bolt")) {
            // Generic items remain eligible to preserve the existing workshop
            // behavior; recognized soul gems were excluded above.
          }
          return true;
        })
      : [];

    // Already-enchanted items
    const enchantedItems = actor
      ? (actor.items ?? []).filter(i => isItemEnchanted(i))
      : [];
    const selectedTargetItem = actor ? await this._resolveSelectedActorItem(actor, "targetItemUuid") : null;
    const selectedGemItem = actor ? await this._resolveSelectedActorItem(actor, "soulGemUuid") : null;
    const selectedEnchantedItem = actor ? await this._resolveSelectedActorItem(actor, "enchantedItemUuid") : null;
    if (selectedTargetItem && !this._isEligibleTarget(selectedTargetItem, this._mode)) this._selection.targetItemUuid = null;
    if (selectedEnchantedItem && !this._isEligibleTarget(selectedEnchantedItem, this._mode)) this._selection.enchantedItemUuid = null;
    if (selectedGemItem && !isSoulGemResourceUsable(selectedGemItem)) this._selection.soulGemUuid = null;

    // Spell effects catalog
    const spellfxOptions = spellEffectsCatalog.map((entry) => {
      const e = localizeSpellEffect(entry);
      return {
      key: e.key,
      label: e.label,
      school: e.school,
      costFormula: e.costFormula,
      attributes: e.attributes ?? [],
      allowConstant: e.allowConstant ?? false,
      description: e.description ?? "",
      };
    });

    const spellfxConstantOptions = spellfxOptions.filter(e => e.allowConstant);

    // Strike enchantments catalog
    const strikeOptions = strikeEnchantmentsCatalog.map((entry) => {
      const e = localizeStrikeEnchantment(entry);
      return {
      key: e.key,
      label: e.label,
      costFormula: e.costFormula,
      paramKeys: e.paramKeys ?? [],
      description: e.description ?? "",
      };
    });

    const spellFormsCatalog = getLocalizedSpellFormsCatalog();
    const actorSpellOptions = buildActorStoredSpellOptions(actor);
    const castSlotCount = hasManifold ? 3 : 1;
    const castSpellSlots = Array.from({ length: castSlotCount }, (_, index) => ({
      index,
      number: index + 1,
      isPrimary: index === 0,
      isManifold: index > 0,
      source: "conventional",
      spellOptions: actorSpellOptions,
      availableSpellCount: actorSpellOptions.length,
      selectedSpellUuid: "",
      selectedSpellSummary: "",
      level: index === 0 ? 1 : 0,
      cost: index === 0 ? 10 : 0,
      bindingStrength: 1,
      attributesText: "",
      label: "",
      manualSpellUuid: "",
    }));
    const manifoldEffectSlots = [
      { index: 1, number: 2 },
      { index: 2, number: 3 },
    ];
    const workshopSummary = {
      actorName: actor?.name ?? "No actor selected",
      enchantTN,
      enchantRank,
      itemCount: enchantableItems.length,
      gemCount: soulGemCount,
      filledGemCount,
      emptyGemCount,
      slotCount: castSlotCount,
      poolRule: t("UESRPG.Apps.EnchantingWorkshop.PoolRule", "Pool max = min(Item EL, Soul Gem Energy)."),
      spellOptionCount: actorSpellOptions.length,
    };

    // Settings
    const enableCursed = game.settings.get(NAMESPACE, "enchanting.enableCursedConstant") ?? false;
    const enableChargedStrike = game.settings.get(NAMESPACE, "enchanting.enableChargedStrikeVariant") ?? false;

    // Mode availability
    const castEnchantedItems = enchantedItems.filter(i => i.flags?.[NAMESPACE]?.enchanting?.enchantType === "cast");
    const constantEnchantedItems = enchantedItems.filter(i => i.flags?.[NAMESPACE]?.enchanting?.enchantType === "constant");
    const modeOptions = [
      { key: "cast", label: t("UESRPG.Apps.EnchantingWorkshop.Modes.Cast.Label"), description: t("UESRPG.Apps.EnchantingWorkshop.Modes.Cast.Description"), icon: "fas fa-magic", available: true },
      { key: "strike", label: t("UESRPG.Apps.EnchantingWorkshop.Modes.Strike.Label"), description: t("UESRPG.Apps.EnchantingWorkshop.Modes.Strike.Description"), icon: "fas fa-bolt", available: true },
      { key: "constant", label: t("UESRPG.Apps.EnchantingWorkshop.Modes.Constant.Label"), description: t("UESRPG.Apps.EnchantingWorkshop.Modes.Constant.Description"), icon: "fas fa-infinity", available: true },
      { key: "recharge", label: t("UESRPG.Apps.EnchantingWorkshop.Modes.Recharge.Label"), description: t("UESRPG.Apps.EnchantingWorkshop.Modes.Recharge.Description"), unavailableReason: t("UESRPG.Apps.EnchantingWorkshop.Modes.Recharge.Unavailable"), icon: "fas fa-battery-full", available: castEnchantedItems.length > 0 },
      { key: "toggle", label: t("UESRPG.Apps.EnchantingWorkshop.Modes.Toggle.Label"), description: t("UESRPG.Apps.EnchantingWorkshop.Modes.Toggle.Description"), unavailableReason: t("UESRPG.Apps.EnchantingWorkshop.Modes.Toggle.Unavailable"), icon: "fas fa-toggle-on", available: constantEnchantedItems.length > 0 },
    ].map(option => ({
      ...option,
      active: option.key === this._mode,
      tooltip: option.available ? option.description : option.unavailableReason,
    }));
    const activeMode = modeOptions.find(option => option.active) ?? modeOptions[0];
    const hasSelectedTarget = this._mode === "recharge" || this._mode === "toggle"
      ? Boolean(this._selection.enchantedItemUuid)
      : Boolean(this._selection.targetItemUuid);
    const hasSelectedGem = this._mode === "toggle" || Boolean(this._selection.soulGemUuid);
    const canSubmit = Boolean(actor) && hasSelectedTarget && hasSelectedGem && (
      this._mode === "toggle"
        ? constantEnchantedItems.length > 0
        : this._mode === "recharge"
          ? castEnchantedItems.length > 0 && filledGemCount > 0
          : enchantableItems.length > 0 && filledGemCount > 0
    );

    return {
      actorUuid: this._actorUuid,
      actorName: actor?.name ?? "No actor selected",
      actorImg: actor?.img ?? "icons/svg/mystery-man.svg",
      actorFound: Boolean(actor),
      controlIdPrefix: this.id,
      mode: this._mode,
      modeOptions,
      activeMode,
      canSubmit,
      selectedTarget: this._resourceDescriptor(
        this._selection.targetItemUuid ? (actor?.items?.find?.(item => item.uuid === this._selection.targetItemUuid) ?? null) : null,
        "target",
      ),
      selectedGem: this._resourceDescriptor(
        this._selection.soulGemUuid ? (actor?.items?.find?.(item => item.uuid === this._selection.soulGemUuid) ?? null) : null,
        "gem",
      ),
      selectedEnchanted: this._resourceDescriptor(
        this._selection.enchantedItemUuid ? (actor?.items?.find?.(item => item.uuid === this._selection.enchantedItemUuid) ?? null) : null,
        "target",
      ),

      enchantTN,
      enchantRank,
      hasManifold,
      hasProcedural,
      hasSalvage,

      gemOptions,
      soulGemCount,
      filledGemCount,
      emptyGemCount,
      hasSoulGems: gemOptions.length > 0,
      hasFilledSoulGems: filledGemCount > 0,
      enchantableItems: enchantableItems.map(i => ({
        uuid: i.uuid, id: i.id, name: i.name, type: i.type,
        el: getItemEL(i),
        enchanted: isItemEnchanted(i),
      })),
      enchantedItems: enchantedItems.map(i => ({
        uuid: i.uuid, id: i.id, name: i.name, type: i.type,
        enchantType: i.flags?.[NAMESPACE]?.enchanting?.enchantType ?? null,
        pool: i.flags?.[NAMESPACE]?.enchanting?.cast?.pool ?? i.flags?.[NAMESPACE]?.enchanting?.strike?.pool ?? null,
        constantEnabled: i.flags?.[NAMESPACE]?.enchanting?.constant?.enabled !== false,
        cursed: i.flags?.[NAMESPACE]?.enchanting?.constant?.cursed === true,
      })),

      spellfxOptions,
      spellfxConstantOptions,
      strikeOptions,
      spellFormsCatalog,

      enableCursed,
      enableChargedStrike,
      actorSpellOptions,
      castSpellSlots,
      manifoldEffectSlots,
      workshopSummary,

      preview: this._previewResult,
    };
  }

  async _onSubmit(event, form, formData) {
    const data = formData?.object ?? {};
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    if (!actor) return ui.notifications?.error(t("UESRPG.Notifications.Enchanting.ActorNotFound"));
    const mode = this._mode;
    const enchantedItem = await this._resolveSelectedActorItem(actor, "enchantedItemUuid");
    const targetItem = await this._resolveSelectedActorItem(actor, "targetItemUuid");
    const soulGemItem = await this._resolveSelectedActorItem(actor, "soulGemUuid");

    if (mode === "toggle") {
      if (!enchantedItem || !this._isEligibleTarget(enchantedItem, mode)) return ui.notifications?.error(t("UESRPG.Notifications.Enchanting.SelectEnchantedItem"));
      const operation = await toggleConstantEnchantment({ actor, enchantedItem });
      if (!operation?.ok) ui.notifications?.warn?.(operation?.reason ?? t("UESRPG.Notifications.Enchanting.UnexpectedError"));
      await queueRenderParts(this, ["form"]);
      return operation;
    }
    if (mode === "recharge") {
      if (!enchantedItem || !this._isEligibleTarget(enchantedItem, mode)) return ui.notifications?.error(t("UESRPG.Notifications.Enchanting.SelectEnchantedItem"));
      if (!soulGemItem || resolveSoulGemData(soulGemItem)?.isFilled !== true) return ui.notifications?.error(t("UESRPG.Notifications.Enchanting.SelectSoulGem"));
      const operation = await rechargeEnchantment({ actor, enchantedItem, soulGemItem });
      if (!operation?.ok) ui.notifications?.warn?.(operation?.reason ?? t("UESRPG.Notifications.Enchanting.UnexpectedError"));
      await queueRenderParts(this, ["form"]);
      return operation;
    }
    if (!targetItem || !this._isEligibleTarget(targetItem, mode)) return ui.notifications?.error(t("UESRPG.Notifications.Enchanting.SelectTargetItem"));
    if (!soulGemItem || resolveSoulGemData(soulGemItem)?.isFilled !== true) return ui.notifications?.error(t("UESRPG.Notifications.Enchanting.SelectSoulGem"));

    const request = {
      mode,
      targetItemUuid: targetItem.uuid,
      soulGemUuid: soulGemItem.uuid,
      cursed: Boolean(data.cursed),
    };
    if (mode === "cast") request.spells = await EnchantingWorkshopAppV2._parseSpellsFromForm(data, actor);
    if (mode === "strike") request.effects = EnchantingWorkshopAppV2._parseStrikeEffectsFromForm(data);
    if (mode === "constant") request.effects = EnchantingWorkshopAppV2._parseConstantEffectsFromForm(data);

    const created = await createPendingEnchantmentMessage(actor, request);
    if (!created) return null;
    ui.notifications?.info?.(t("UESRPG.Apps.EnchantingWorkshop.Chat.Prepared", "Enchanting ritual prepared in chat."));
    return created;
  }

  /**
   * Parse spell entries from form data for cast mode.
   * Expects: spell_id_N, spell_source_N, spell_label_N, spell_level_N, spell_cost_N, spell_uuid_N
   *
   * @param {object} data
   * @param {Actor} actor
   * @returns {object[]}
   */
  static async _parseSpellsFromForm(data, actor) {
    const spells = [];
    // Scan for spell slot indices (max 3)
    for (let i = 0; i < 3; i++) {
      const level = Number(data[`spell_level_${i}`] ?? 0);
      const cost = Number(data[`spell_cost_${i}`] ?? 0);
      const source = String(data[`spell_source_${i}`] ?? "conventional").trim().toLowerCase() === "unconventional"
        ? "unconventional"
        : "conventional";
      const selectedSpellUuid = String(data[`spell_select_uuid_${i}`] ?? "").trim();
      const manualSpellUuid = String(data[`spell_uuid_${i}`] ?? "").trim();
      if (!level && !cost && !selectedSpellUuid && !manualSpellUuid) continue;

      const label = String(data[`spell_label_${i}`] ?? `Spell ${i + 1}`);
      const spellUuid = selectedSpellUuid || manualSpellUuid;
      const attributes = String(data[`spell_attributes_${i}`] ?? "").split(",").map(s => s.trim()).filter(Boolean);
      let snapshot = null;

      if (spellUuid) {
        const spellDoc = await resolveStoredSpellDocument(spellUuid);
        if (spellDoc?.type === "spell") {
          snapshot = buildStoredSpellSnapshot(spellDoc);
        }
      }

      spells.push({
        id: foundry.utils.randomID(),
        source,
        label,
        level,
        cost,
        attributes,
        spellUuid: spellUuid || null,
        snapshot,
        spellDefinition: null,
      });
    }
    return spells;
  }

  /**
   * Parse strike effect entries from form data.
   * Expects: strike_key_N, strike_sl_N, strike_y_N, strike_type_N, strike_cost_N
   *
   * @param {object} data
   * @returns {object[]}
   */
  static _parseStrikeEffectsFromForm(data) {
    const effects = [];
    for (let i = 0; i < 3; i++) {
      const key = String(data[`strike_key_${i}`] ?? "");
      const sl = Number(data[`strike_sl_${i}`] ?? 0);
      if (!key || !sl) continue;
      effects.push({
        key,
        sl,
        y: Number(data[`strike_y_${i}`] ?? 0) || undefined,
        type: String(data[`strike_type_${i}`] ?? "") || undefined,
        cost: Number(data[`strike_cost_${i}`] ?? 0),
      });
    }
    return effects;
  }

  /**
   * Parse constant effect entries from form data.
   * Expects: const_key_N, const_sl_N, const_cost_N, const_params_N (JSON)
   *
   * @param {object} data
   * @returns {object[]}
   */
  static _parseConstantEffectsFromForm(data) {
    const effects = [];
    // Resolve from the spell-effects catalog
    for (let i = 0; i < 3; i++) {
      const effectKey = String(data[`const_key_${i}`] ?? "");
      const sl = Number(data[`const_sl_${i}`] ?? 0);
      if (!effectKey || !sl) continue;

      // Look up catalog to get attributes/school/allowConstant
      const catalogEntry = spellEffectsCatalog.find(e => e.key === effectKey);

      let paramsRaw = {};
      try { paramsRaw = JSON.parse(String(data[`const_params_${i}`] ?? "{}")); } catch (_) {}

      effects.push({
        effectKey,
        sl,
        params: paramsRaw,
        cost: Number(data[`const_cost_${i}`] ?? 0),
        attributes: catalogEntry?.attributes ?? [],
        school: catalogEntry?.school ?? "",
        allowConstant: catalogEntry?.allowConstant ?? false,
      });
    }
    return effects;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const zone of this.element?.querySelectorAll?.("[data-enchant-resource-drop]") ?? []) {
      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        zone.classList.add("is-dragover");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
      zone.addEventListener("drop", (event) => this._onResourceDrop(event, zone));
    }
  }

  _resourceCandidates(actor, kind) {
    if (!actor?.items) return [];
    if (kind === "gem") return getSoulGems(actor).filter((item) => isSoulGemResourceUsable(item));
    return [...actor.items].filter((item) => this._isEligibleTarget(item, this._mode));
  }

  async _assignResource(kind, item) {
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    if (!actor || item?.documentName !== "Item" || item.parent?.uuid !== actor.uuid) {
      ui.notifications?.warn?.(t("UESRPG.Apps.EnchantingWorkshop.Dropzones.ActorOwnedOnly", "Drop an Item owned by this actor."));
      return false;
    }
    if (kind === "gem") {
      if (!isSoulGemResourceUsable(item)) {
        ui.notifications?.warn?.(t("UESRPG.Apps.EnchantingWorkshop.Dropzones.FilledGemOnly", "Drop a filled soul gem with at least one available unit."));
        return false;
      }
      this._selection.soulGemUuid = item.uuid;
    } else {
      if (!this._isEligibleTarget(item, this._mode)) {
        ui.notifications?.warn?.(t("UESRPG.Apps.EnchantingWorkshop.Dropzones.InvalidTarget", "That Item is not eligible for the active enchanting mode."));
        return false;
      }
      this._selection[this._mode === "recharge" || this._mode === "toggle" ? "enchantedItemUuid" : "targetItemUuid"] = item.uuid;
    }
    await queueRenderParts(this, ["form"]);
    return true;
  }

  async _onResourceDrop(event, zone) {
    event.preventDefault();
    zone.classList.remove("is-dragover");
    const item = await resolveDroppedItem(readDropData(event));
    await this._assignResource(String(zone.dataset.enchantResourceDrop ?? "target"), item);
  }

  async _onChooseResource(event, target) {
    event.preventDefault();
    const kind = String(target?.dataset?.resourceKind ?? "target");
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    const candidates = this._resourceCandidates(actor, kind);
    if (!candidates.length) {
      ui.notifications?.warn?.(kind === "gem"
        ? t("UESRPG.Apps.EnchantingWorkshop.OnlyEmptySoulGems")
        : t("UESRPG.Apps.EnchantingWorkshop.Dropzones.NoEligibleItems", "No eligible actor-owned Items are available."));
      return;
    }
    const esc = (value) => foundry.utils.escapeHTML(String(value ?? ""));
    const rows = candidates.map((item, index) => {
      const descriptor = this._resourceDescriptor(item, kind);
      return `<label class="enchanting-picker-row">
        <input type="radio" name="resourceUuid" value="${esc(item.uuid)}" ${index === 0 ? "checked" : ""}>
        <img src="${esc(item.img)}" alt="">
        <span><strong>${esc(item.name)}</strong><small>${esc(descriptor?.meta)} · ×${descriptor?.quantity ?? 1}</small></span>
      </label>`;
    }).join("");
    const uuid = await customDialog({
      title: kind === "gem"
        ? t("UESRPG.Apps.EnchantingWorkshop.Dropzones.ChooseGem", "Choose Soul Gem")
        : t("UESRPG.Apps.EnchantingWorkshop.Dropzones.ChooseTarget", "Choose Target Item"),
      content: `<div class="enchanting-picker-list">${rows}</div>`,
      buttons: {
        choose: {
          label: t("UESRPG.Buttons.Select", "Select"),
          callback: (html) => html?.querySelector?.('input[name="resourceUuid"]:checked')?.value ?? null,
        },
        cancel: { label: t("UESRPG.Buttons.Cancel", "Cancel"), callback: () => null },
      },
      default: "choose",
      width: 460,
    });
    if (!uuid) return;
    const item = await fromUuid(uuid).catch(() => null);
    await this._assignResource(kind, item);
  }

  async _onClearResource(event, target) {
    event.preventDefault();
    const kind = String(target?.dataset?.resourceKind ?? "target");
    if (kind === "gem") this._selection.soulGemUuid = null;
    else if (this._mode === "recharge" || this._mode === "toggle") this._selection.enchantedItemUuid = null;
    else this._selection.targetItemUuid = null;
    await queueRenderParts(this, ["form"]);
  }

  _registerDocumentHooks() {
    if (this._ownedHooks.length) return;
    const onItemChange = (item) => {
      if (item?.parent?.uuid !== this._actorUuid || !this.rendered) return;
      if (!item.parent?.items?.get?.(item.id)) {
        for (const key of Object.keys(this._selection)) {
          if (this._selection[key] === item.uuid) this._selection[key] = null;
        }
      }
      void queueRenderParts(this, ["form"]);
    };
    this._ownedHooks.push(
      ["createItem", Hooks.on("createItem", onItemChange)],
      ["updateItem", Hooks.on("updateItem", onItemChange)],
      ["deleteItem", Hooks.on("deleteItem", onItemChange)],
    );
  }

  async _onModeChange(event, target) {
    event.preventDefault();
    const newMode = String(target?.dataset?.mode ?? "");
    if (!WORKSHOP_MODES.includes(newMode) || target?.hasAttribute?.("disabled")) return;
    if (newMode === this._mode) return;
    this._mode = newMode;
    this._previewResult = null;
    this._selection.targetItemUuid = null;
    this._selection.enchantedItemUuid = null;
    await queueRenderParts(this, ["form"]);
  }
}
