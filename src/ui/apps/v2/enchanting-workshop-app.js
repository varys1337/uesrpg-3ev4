/**
 * @module ui/apps/v2/enchanting-workshop-app
 *
 * src/ui/apps/v2/enchanting-workshop-app.js
 *
 * Enchanting Workshop — ApplicationV2 wizard UI.
 *
 * Launched via macro: `new EnchantingWorkshopAppV2({ actorUuid }).render(true)`
 *
 * Modes:
 *  1. cast     — Create Cast Enchantment
 *  2. strike   — Create Strike Enchantment
 *  3. constant — Create Constant Enchantment
 *  4. recharge — Recharge Cast Enchantment
 *  5. toggle   — Toggle Constant Enchantment
 *
 * AppV2 patterns:
 *  - HandlebarsApplicationMixin + ApplicationV2
 *  - All state derived from flagsPayload / build results — no phantom state
 *  - Form submitted via static _onSubmit — buildCast/buildStrike/buildConstant
 *    are called there, then finalizeEnchantment.
 *
 * Target: Foundry VTT v13.351
 */

import {
  getFilledSoulGems,
  resolveSoulGemData,
} from "../../../core/enchanting/soul-gems.js";
import { getItemEL, isItemEnchanted } from "../../../core/enchanting/enchant-level.js";
import { getEnchantTN, getEnchantRank, getEffectiveEnchantRank } from "../../../core/enchanting/penalties.js";
import { buildCast, buildCastFlagsPayload } from "../../../core/enchanting/builders/build-cast.js";
import { buildStrike, buildStrikeFlagsPayload } from "../../../core/enchanting/builders/build-strike.js";
import { buildConstant, buildConstantFlagsPayload } from "../../../core/enchanting/builders/build-constant.js";
import { finalizeEnchantment, rechargeEnchantment, toggleConstantEnchantment } from "../../../core/enchanting/builders/finalize.js";
import { hasTalent } from "../../../core/traits/talents-api.js";

// Catalog data (JS modules — avoids import assertion browser compatibility issues)
import { SPELL_EFFECTS_CATALOG as spellEffectsCatalog } from "../../../data/spell-effects-catalog.js";
import { STRIKE_ENCHANTMENTS_CATALOG as strikeEnchantmentsCatalog } from "../../../data/strike-enchantments-catalog.js";

// Spell forms are small; define inline to avoid a separate file import chain.
const spellFormsCatalog = [
  { key: "touch",    label: "Touch",            paramKey: null, paramLabel: null },
  { key: "target",   label: "Target",           paramKey: null, paramLabel: null },
  { key: "self",     label: "Self",             paramKey: null, paramLabel: null },
  { key: "area",     label: "Area (Z metres)",  paramKey: "Z",  paramLabel: "Radius (m)" },
  { key: "onTarget", label: "On Target",        paramKey: null, paramLabel: null },
];

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const NAMESPACE = "uesrpg-3ev4";

const WORKSHOP_MODES = ["cast", "strike", "constant", "recharge", "toggle"];

export class EnchantingWorkshopAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "uesrpg-enchanting-workshop",
    tag: "form",
    form: {
      handler: EnchantingWorkshopAppV2._onSubmit,
      closeOnSubmit: false,
      submitOnChange: false,
    },
    actions: {
      modeChange: EnchantingWorkshopAppV2.prototype._onModeChange,
    },
    window: {
      title: "UESRPG — Enchanting Workshop",
      resizable: true,
    },
    position: {
      width: 600,
      height: 720,
    },
    classes: ["uesrpg", "enchanting-workshop"],
  };

  /** @override */
  static PARTS = {
    form: {
      template: "systems/uesrpg-3ev4/templates/v2/apps/enchanting-workshop.hbs",
      scrollable: [".enchanting-workshop-body"],
    },
  };

  /**
   * @param {{ actorUuid: string, mode?: string }} options
   */
  constructor(options = {}) {
    super(options);
    this._actorUuid = options.actorUuid ?? null;
    this._mode = WORKSHOP_MODES.includes(options.mode) ? options.mode : "cast";
    this._previewResult = null; // Last preview from _onChangeForm
  }

  /** @override */
  async _prepareContext(options) {
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;

    // ── Actor data ──────────────────────────────────────────────────────────────
    const enchantTN = actor ? getEnchantTN(actor) : 0;
    const enchantRank = actor ? getEnchantRank(actor) : 0;
    const hasManifold = actor ? hasTalent(actor, "manifoldenchanter") : false;
    const hasProcedural = actor ? hasTalent(actor, "proceduralenchanting") : false;
    const hasSalvage = actor ? hasTalent(actor, "salvageenergy") : false;

    // ── Soul Gems ───────────────────────────────────────────────────────────────
    const filledGems = actor ? getFilledSoulGems(actor) : [];
    const gemOptions = filledGems.map(gem => {
      const d = resolveSoulGemData(gem);
      return {
        uuid: gem.uuid,
        id: gem.id,
        name: gem.name,
        soulEnergy: d?.soulEnergy ?? 0,
        soulType: d?.soulType ?? "white",
        soulSize: d?.soulSize ?? "unknown",
        label: `${gem.name} (${d?.soulType ?? "?"}, ${d?.soulEnergy ?? 0} energy)`,
      };
    });

    // ── Enchantable items (all items with EL > 0 or no EL) ─────────────────────
    const enchantableItems = actor
      ? (actor.items ?? []).filter(i => {
          if (!["weapon", "armor", "item"].includes(i.type)) return false;
          if (i.type === "item" && !i.name?.toLowerCase().includes("ammo") &&
              !i.name?.toLowerCase().includes("arrow") &&
              !i.name?.toLowerCase().includes("bolt")) {
            // For generic items, only show if they look like enchantable gear
            // (skip soul gems themselves)
            const flags = i.flags?.[NAMESPACE];
            if (flags?.isSoulGem) return false;
          }
          return true;
        })
      : [];

    // ── Already-enchanted items ─────────────────────────────────────────────────
    const enchantedItems = actor
      ? (actor.items ?? []).filter(i => isItemEnchanted(i))
      : [];

    // ── Spell effects catalog ───────────────────────────────────────────────────
    const spellfxOptions = spellEffectsCatalog.map(e => ({
      key: e.key,
      label: e.label,
      school: e.school,
      costFormula: e.costFormula,
      attributes: e.attributes ?? [],
      allowConstant: e.allowConstant ?? false,
      description: e.description ?? "",
    }));

    const spellfxConstantOptions = spellfxOptions.filter(e => e.allowConstant);

    // ── Strike enchantments catalog ─────────────────────────────────────────────
    const strikeOptions = strikeEnchantmentsCatalog.map(e => ({
      key: e.key,
      label: e.label,
      costFormula: e.costFormula,
      paramKeys: e.paramKeys ?? [],
      description: e.description ?? "",
    }));

    // ── Settings ────────────────────────────────────────────────────────────────
    const enableCursed = game.settings.get(NAMESPACE, "enchanting.enableCursedConstant") ?? false;
    const enableChargedStrike = game.settings.get(NAMESPACE, "enchanting.enableChargedStrikeVariant") ?? false;

    // ── Mode availability ───────────────────────────────────────────────────────
    const modeOptions = [
      { key: "cast",     label: "Create Cast Enchantment",     available: true },
      { key: "strike",   label: "Create Strike Enchantment",   available: true },
      { key: "constant", label: "Create Constant Enchantment", available: true },
      { key: "recharge", label: "Recharge Cast Enchantment",   available: enchantedItems.some(i => i.flags?.[NAMESPACE]?.enchanting?.enchantType === "cast") },
      { key: "toggle",   label: "Toggle Constant Enchantment", available: enchantedItems.some(i => i.flags?.[NAMESPACE]?.enchanting?.enchantType === "constant") },
    ];

    return {
      actorUuid: this._actorUuid,
      actorName: actor?.name ?? "No actor selected",
      mode: this._mode,
      modeOptions,

      enchantTN,
      enchantRank,
      hasManifold,
      hasProcedural,
      hasSalvage,

      gemOptions,
      enchantableItems: enchantableItems.map(i => ({
        uuid: i.uuid, id: i.id, name: i.name, type: i.type,
        el: getItemEL(i),
        enchanted: isItemEnchanted(i),
      })),
      enchantedItems: enchantedItems.map(i => ({
        uuid: i.uuid, id: i.id, name: i.name, type: i.type,
        enchantType: i.flags?.[NAMESPACE]?.enchanting?.enchantType ?? null,
        pool: i.flags?.[NAMESPACE]?.enchanting?.cast?.pool ?? i.flags?.[NAMESPACE]?.enchanting?.strike?.pool ?? null,
      })),

      spellfxOptions,
      spellfxConstantOptions,
      strikeOptions,
      spellFormsCatalog,

      enableCursed,
      enableChargedStrike,

      preview: this._previewResult,
    };
  }

  /**
   * AppV2 form submit handler.
   * Reads the form, builds the enchantment, finalizes it.
   *
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async _onSubmit(event, form, formData) {
    try {
      const data = formData?.object ?? {};

      const mode = String(data.mode ?? "cast");
      const actorUuid = String(data.actorUuid ?? "");
      const actor = actorUuid ? await fromUuid(actorUuid) : null;

      if (!actor) {
        ui.notifications?.error("Enchanting Workshop: No actor found.");
        return;
      }

      const resolveActorItem = async (ref) => {
        const r = String(ref ?? "");
        if (!r) return null;

        // UUID
        if (r.includes(".") || r.length > 20) {
          try {
            const doc = await fromUuid(r);
            if (doc?.documentName === "Item") return doc;
          } catch (_e) { /* noop */ }
        }

        // Item ID on actor
        return actor.items?.get(r) ?? null;
      };

      // Special modes that operate on an already-enchanted item
      if (mode === "recharge" || mode === "toggle") {
        const enchantedItem = await resolveActorItem(data.enchantedItemUuid);
        if (!enchantedItem) {
          ui.notifications?.error("Enchanting Workshop: Select an enchanted item.");
          return;
        }

        if (mode === "recharge") {
          const soulGemItem = await resolveActorItem(data.gemUuid);
          if (!soulGemItem) {
            ui.notifications?.error("Enchanting Workshop: Select a soul gem.");
            return;
          }
          await rechargeEnchantment({ actor, enchantedItem, soulGemItem });
          return;
        }

        await toggleConstantEnchantment({ actor, enchantedItem });
        return;
      }

      const targetItem = await resolveActorItem(data.targetItemUuid);
      const soulGemItem = await resolveActorItem(data.gemUuid);

      if (!targetItem) {
        ui.notifications?.error("Enchanting Workshop: Select a target item.");
        return;
      }
      if (!soulGemItem) {
        ui.notifications?.error("Enchanting Workshop: Select a soul gem.");
        return;
      }

      if (mode === "cast") {
        const spells = EnchantingWorkshopAppV2._parseSpellsFromForm(data, actor);
        if (!spells.length) {
          ui.notifications?.error("Enchanting Workshop: Add at least one spell.");
          return;
        }

        const result = await buildCast({ actor, targetItem, soulGemItem, spells });

        if (!result?.valid) {
          ui.notifications?.error(`Enchanting failed: ${(result?.errors ?? ["Unknown error"]).join("; ")}`);
          return;
        }

        if (!result.anySuccess) {
          ui.notifications?.warn("Enchanting test failed — enchantment not applied.");
          if (!result.gemPreserved && soulGemItem) {
            const { consumeSoulGem } = await import("../../../core/enchanting/soul-gems.js");
            await consumeSoulGem(actor, soulGemItem);
          }
          return;
        }

        const flagsPayload = buildCastFlagsPayload(result, actor, soulGemItem, targetItem, {});
        await finalizeEnchantment({
          actor,
          targetItem,
          soulGemItem,
          flagsPayload,
          buildResult: result,
          gemPreserved: result.gemPreserved,
          enchantType: "cast",
        });

        ui.notifications?.info(`Cast enchantment applied to "${targetItem.name}".`);
        return;
      }

      if (mode === "strike") {
        const effects = EnchantingWorkshopAppV2._parseStrikeEffectsFromForm(data);
        if (!effects.length) {
          ui.notifications?.error("Enchanting Workshop: Select at least one strike effect.");
          return;
        }

        const result = await buildStrike({ actor, targetItem, soulGemItem, effects });

        if (!result?.valid) {
          ui.notifications?.error(`Enchanting failed: ${(result?.errors ?? ["Unknown error"]).join("; ")}`);
          return;
        }

        if (!result.anySuccess) {
          ui.notifications?.warn("Enchanting test failed — enchantment not applied.");
          if (!result.gemPreserved && soulGemItem) {
            const { consumeSoulGem } = await import("../../../core/enchanting/soul-gems.js");
            await consumeSoulGem(actor, soulGemItem);
          }
          return;
        }

        const flagsPayload = buildStrikeFlagsPayload(result, actor, soulGemItem, targetItem, effects);
        await finalizeEnchantment({
          actor,
          targetItem,
          soulGemItem,
          flagsPayload,
          buildResult: result,
          gemPreserved: result.gemPreserved,
          enchantType: "strike",
        });

        ui.notifications?.info(`Strike enchantment applied to "${targetItem.name}".`);
        return;
      }

      if (mode === "constant") {
        const effects = EnchantingWorkshopAppV2._parseConstantEffectsFromForm(data);
        if (!effects.length) {
          ui.notifications?.error("Enchanting Workshop: Select at least one constant effect.");
          return;
        }

        const cursed = Boolean(data.cursed);
        const result = await buildConstant({ actor, targetItem, soulGemItem, effects, cursed });

        if (!result?.valid) {
          ui.notifications?.error(`Enchanting failed: ${(result?.errors ?? ["Unknown error"]).join("; ")}`);
          return;
        }

        if (!result.anySuccess) {
          ui.notifications?.warn("Enchanting test failed — enchantment not applied.");
          if (!result.gemPreserved && soulGemItem) {
            const { consumeSoulGem } = await import("../../../core/enchanting/soul-gems.js");
            await consumeSoulGem(actor, soulGemItem);
          }
          return;
        }

        const flagsPayload = buildConstantFlagsPayload(result, actor, soulGemItem, targetItem, effects);
        await finalizeEnchantment({
          actor,
          targetItem,
          soulGemItem,
          flagsPayload,
          buildResult: result,
          gemPreserved: result.gemPreserved,
          enchantType: "constant",
        });

        ui.notifications?.info(`Constant enchantment applied to "${targetItem.name}".`);
        return;
      }

      ui.notifications?.warn(`Enchanting Workshop: Unknown mode "${mode}".`);
    } catch (err) {
      console.error("UESRPG | Enchanting Workshop submit failed", err);
      ui.notifications?.error("Enchanting Workshop: An unexpected error occurred. See console (F12). ");
    }
  }

  /**
   * Parse spell entries from form data for cast mode.
   * Expects: spell_id_N, spell_source_N, spell_label_N, spell_level_N, spell_cost_N, spell_uuid_N
   *
   * @param {object} data
   * @param {Actor} actor
   * @returns {object[]}
   */
  static _parseSpellsFromForm(data, actor) {
    const spells = [];
    // Scan for spell slot indices (max 3)
    for (let i = 0; i < 3; i++) {
      const level = Number(data[`spell_level_${i}`] ?? 0);
      const cost = Number(data[`spell_cost_${i}`] ?? 0);
      if (!level && !cost) continue;

      const source = String(data[`spell_source_${i}`] ?? "conventional");
      const label = String(data[`spell_label_${i}`] ?? `Spell ${i + 1}`);
      const spellUuid = String(data[`spell_uuid_${i}`] ?? "");
      const attributes = String(data[`spell_attributes_${i}`] ?? "").split(",").map(s => s.trim()).filter(Boolean);

      spells.push({
        id: foundry.utils.randomID(),
        source,
        label,
        level,
        cost,
        attributes,
        spellUuid: spellUuid || null,
        snapshot: null,
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

  /**
   * Intercept form field changes.
   *
   * The Workshop Mode <select> uses name="mode" and triggers a full re-render
   * because the visible fieldset depends on the selected mode.
   *
   * NOTE: data-action="modeChange" on a <select> fires on `click` (when the
   * dropdown opens), not on `change` (when a value is committed). Overriding
   * _onChangeForm instead correctly captures the committed value.
   *
   * @override
   * @param {object} formConfig
   * @param {Event}  event
   */
  async _onChangeForm(formConfig, event) {
    if (event?.target?.name === "mode") {
      const newMode = String(event.target.value ?? "cast");
      if (WORKSHOP_MODES.includes(newMode) && newMode !== this._mode) {
        this._mode = newMode;
        this._previewResult = null;
        await this.render({ parts: ["form"] });
        return;
      }
    }
    if (typeof super._onChangeForm === "function") {
      return super._onChangeForm(formConfig, event);
    }
  }

  /**
   * @deprecated No longer wired — mode changes handled in _onChangeForm.
   * Kept as a no-op so any lingering data-action="modeChange" bindings
   * don't throw "unknown action" errors.
   */
  async _onModeChange(event, target) { /* superseded by _onChangeForm */ }
}
