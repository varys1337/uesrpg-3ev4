/**
 * Alchemy Workshop - AppV2
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

import {
  QUALITY_TIERS,
  ALCHEMY_SCHOOLS,
  POISON_DICE,
} from "../../../core/alchemy/effects.js";
import { templatePath } from "../../constants.js";
import {
  getAlchemySkill,
  getAlchemySkillSnapshot,
  getAlchemyTalents,
  computeEffectiveStrength,
  computeBrewModifiers,
  validateBrewRecipe,
  createPendingBrewMessage,
  getAlchemyInventoryState,
  getActorKnownAlchemyEffects,
  addActorKnownAlchemyEffect,
  removeActorKnownAlchemyEffect,
  resolveAlchemyEffectDescriptor,
} from "../../../core/alchemy/workflow.js";
import { resolveDroppedItem } from "../../../utils/drop-data.js";
import { t, tf } from "../../../utils/i18n.js";

const MAX_SLOTS = 3;
const TEMPLATE_PATH = templatePath("v2/apps/alchemy-workshop.hbs");

function _defaultSlot() {
  return {
    ingredientId: null,
    effectSource: "spell",
    effectKey: null,
    spellUuid: null,
    spellLevel: 1,
    params: {},
  };
}

function _cloneSlot(slot) {
  return {
    ingredientId: slot?.ingredientId ?? null,
    effectSource: slot?.spellUuid ? "spell" : String(slot?.effectSource ?? "spell"),
    effectKey: slot?.effectKey ?? null,
    spellUuid: slot?.spellUuid ?? null,
    spellLevel: Math.max(1, Number(slot?.spellLevel ?? 1) || 1),
    params: slot?.params ?? {},
  };
}

function _defaultState(mode = "potion") {
  return {
    mode,
    activeSlotIdx: 0,
    nothingVentured: false,
    slots: [_defaultSlot(), _defaultSlot(), _defaultSlot()],
    gatherSchool: "restoration",
    ingredientId: null,
  };
}

function _getSpellLevelOptions(spell) {
  const levels = new Set([Math.max(1, Number(spell?.system?.level ?? 1) || 1)]);
  for (const entry of Array.isArray(spell?.system?.scaling?.levels) ? spell.system.scaling.levels : []) {
    const level = Math.max(1, Number(entry?.level ?? 0) || 0);
    if (level > 0) levels.add(level);
  }
  return Array.from(levels).sort((a, b) => a - b);
}

function _buildSpellEntryFromDocument(actor, spell, mode = "potion") {
  if (!spell || spell.type !== "spell") return null;
  if (spell.pack) return null;

  const parent = spell.parent ?? null;
  const parentDocName = String(parent?.documentName ?? "").trim();
  const sourceType = parentDocName === "Actor" ? "actor" : "world";
  if (sourceType === "actor" && String(parent?.uuid ?? "") !== String(actor?.uuid ?? "")) return null;
  if (parentDocName && parentDocName !== "Actor") return null;

  const levelOptions = _getSpellLevelOptions(spell);
  return {
    effectSource: "spell",
    spellUuid: String(spell.uuid ?? "").trim(),
    spellId: spell.id,
    key: `spell:${spell.uuid}`,
    value: `spell:${spell.uuid}`,
    label: spell.name,
    school: String(spell?.system?.school ?? "").toLowerCase(),
    attributes: [],
    levelOptions,
    slMin: levelOptions[0] ?? 1,
    slMax: levelOptions[levelOptions.length - 1] ?? 1,
    sourceType,
    sourceLabel: sourceType === "actor" ? "Actor Spell" : "World Spell",
    mode,
  };
}

function _buildRecipeFromState(ws) {
  if (ws.mode === "poison") {
    return {
      mode: "poison",
      ingredientId: ws.ingredientId ?? null,
      poisonLevel: null,
    };
  }

  return {
    mode: ws.mode,
    slots: ws.slots.map((slot) => ({
      ingredientId: slot.ingredientId ?? null,
      effectSource: "spell",
      effectKey: null,
      spellUuid: slot.spellUuid ?? null,
      spellLevel: Math.max(1, Number(slot.spellLevel ?? 1) || 1),
      params: slot.params ?? {},
    })),
  };
}

function _getStoredTrialBonus(actor, recipe) {
  const effects = (recipe.slots ?? [])
    .map((slot) => `spell:${String(slot?.spellUuid ?? "")}:${Number(slot?.spellLevel ?? 1) || 1}`)
    .filter(Boolean)
    .sort()
    .join(",");
  const hash = `${recipe.mode}|${effects}|${recipe.poisonLevel ?? 0}`;
  const te = actor?.flags?.["uesrpg-3ev4"]?.alchemy?.trialAndError ?? {};
  return Math.min(30, (te[hash] ?? 0) * 10);
}

function _formatDurationLabel(duration) {
  if (!duration) return t("UESRPG.Dialogs.AlchemyWorkshop.Instant");
  const unit = String(duration.unit ?? "").trim();
  if (!unit || unit === "instant") return t("UESRPG.Dialogs.AlchemyWorkshop.Instant");
  return `${Number(duration.value ?? 0)} ${unit}`;
}

function _readDropData(event) {
  try {
    const parsed = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (parsed?.type) return parsed;
  } catch (_err) {
    // Fall through to raw payload parse.
  }

  const raw = event?.dataTransfer?.getData?.("text/plain");
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

function _buildCurrentEffectDetail(actor, ingredient, slot, mode = "potion") {
  const descriptor = resolveAlchemyEffectDescriptor(actor, slot, { ingredient, mode });
  if (!descriptor || descriptor.compatible === false || !descriptor.directPayload) return null;

  const candidateLevels = Array.isArray(descriptor.levelOptions) && descriptor.levelOptions.length
    ? descriptor.levelOptions.slice()
    : Array.from(
        { length: Math.max(0, Math.min(descriptor.slMax, ingredient.depthBase) - descriptor.slMin + 1) },
        (_, idx) => descriptor.slMin + idx
      );
  const allowedLevels = candidateLevels.filter((level) => {
    if (level > ingredient.depthBase) return false;
    const preview = resolveAlchemyEffectDescriptor(actor, {
      ...slot,
      spellLevel: level,
    }, { ingredient });
    return Boolean(preview) && Number(preview.cost ?? 0) <= Number(ingredient.effectiveStrength ?? 0);
  });
  const selectedSpellLevel = allowedLevels.includes(descriptor.spellLevel)
    ? descriptor.spellLevel
    : (allowedLevels[0] ?? descriptor.spellLevel);
  const highestAllowedLevel = allowedLevels.length
    ? allowedLevels[allowedLevels.length - 1]
    : Math.max(descriptor.slMin, Math.min(descriptor.slMax, ingredient.depthBase));

  return {
    label: descriptor.effectLabel,
    school: descriptor.school,
    spellLevel: descriptor.spellLevel,
    selectedSpellLevel,
    cost: descriptor.cost,
    effectiveStrength: ingredient.effectiveStrength,
    durationLabel: _formatDurationLabel(descriptor.finalDuration),
    slMin: allowedLevels[0] ?? descriptor.slMin,
    slMax: highestAllowedLevel,
    levelOptions: allowedLevels,
    hasDiscreteLevels: Array.isArray(descriptor.levelOptions) && descriptor.levelOptions.length > 0 && allowedLevels.length > 0,
    sourceLabel: descriptor.effectSource === "spell" ? "Spell" : "Catalog",
  };
}

function _findViableSpellLevel(actor, ingredient, spellEntry) {
  if (!ingredient || !spellEntry) return { ok: false, reason: t("UESRPG.Notifications.Alchemy.ChooseIngredientFirst") };

  const levels = Array.isArray(spellEntry.levelOptions) && spellEntry.levelOptions.length
    ? spellEntry.levelOptions
    : [Math.max(1, Number(spellEntry.slMin ?? 1) || 1)];
  let firstDescriptor = null;
  let mismatchReason = "";
  let invalidReason = "";

  for (const spellLevel of levels) {
    const descriptor = resolveAlchemyEffectDescriptor(actor, {
      ingredientId: ingredient.id,
      effectSource: "spell",
      spellUuid: spellEntry.spellUuid,
      spellLevel,
      params: {},
    }, { ingredient, mode: spellEntry.mode ?? "potion" });
    if (!descriptor) continue;
    if (!firstDescriptor) firstDescriptor = descriptor;
    if (descriptor.compatible === false || !descriptor.directPayload) {
      invalidReason = descriptor.invalidReason || invalidReason || t("UESRPG.Notifications.Alchemy.SpellCannotSerialize");
      continue;
    }
    if (String(descriptor.school ?? "").toLowerCase() !== String(ingredient.school ?? "").toLowerCase()) {
      mismatchReason = tf("UESRPG.Notifications.Alchemy.RequiresIngredientSchool", { effect: descriptor.effectLabel || spellEntry.label || t("UESRPG.Dialogs.AlchemyWorkshop.ThatEffect"), school: String(descriptor.school ?? t("UESRPG.Dialogs.AlchemyWorkshop.Matching")).toLowerCase() });
      continue;
    }
    if (Array.isArray(descriptor.levelOptions) && descriptor.levelOptions.length && !descriptor.levelOptions.includes(spellLevel)) continue;
    if (spellLevel > ingredient.depthBase) continue;
    if (descriptor.cost > ingredient.effectiveStrength) continue;
    return { ok: true, spellLevel, descriptor };
  }

  if (invalidReason) return { ok: false, reason: invalidReason };
  if (mismatchReason) return { ok: false, reason: mismatchReason };

  const cheapestLevel = levels[0] ?? 1;
  if (firstDescriptor && Number(firstDescriptor.cost ?? 0) > ingredient.effectiveStrength) {
    return { ok: false, reason: `Cost ${firstDescriptor.cost} exceeds strength ${ingredient.effectiveStrength}.` };
  }
  if (cheapestLevel > ingredient.depthBase) {
    return { ok: false, reason: `Minimum SL ${cheapestLevel} exceeds depth ${ingredient.depthBase}.` };
  }
    return { ok: false, reason: t("UESRPG.Notifications.Alchemy.NoValidSpellLevel") };
}

export class AlchemyWorkshopAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static #openByActor = new Map();

  static DEFAULT_OPTIONS = {
    id: "alchemy-workshop",
    classes: ["uesrpg", "alchemy-workshop"],
    tag: "form",
    position: { width: 760, height: "auto" },
    window: {
      resizable: true,
    },
    form: {
      submitOnChange: false,
      closeOnSubmit: false,
    },
    actions: {
      commit: AlchemyWorkshopAppV2._onCommit,
      rollGather: AlchemyWorkshopAppV2._onRollGather,
    },
  };

  static PARTS = {
    workshop: { template: TEMPLATE_PATH },
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

  static async prompt({ actorUuid = null, mode = "potion" } = {}) {
    const key = String(actorUuid ?? "").trim();
    if (key) {
      const existing = this.getOpenInstance(key);
      if (existing?.rendered) {
        existing._ws = _defaultState(mode);
        await existing.render(true);
        existing.bringToTop?.();
        return existing;
      }
    }

    const app = new AlchemyWorkshopAppV2({ actorUuid, mode });
    if (key) this.#openByActor.set(key, app);
    await app.render(true);
    return app;
  }

  constructor(options = {}) {
    super(options);
    this._actorUuid = options.actorUuid ?? null;
    this._ws = _defaultState(options.mode ?? "potion");
    this._boundDropzones = false;
    this._boundTray = false;
  }

  get title() {
    return t("UESRPG.Dialogs.AlchemyWorkshop.Title", "Alchemy Workshop");
  }

  async close(options = {}) {
    const key = String(this._actorUuid ?? "").trim();
    if (key) AlchemyWorkshopAppV2.#openByActor.delete(key);
    return super.close(options);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    if (!actor) return { ...context, error: t("UESRPG.Notifications.Alchemy.ActorNotFound") };

    const ws = this._ws;
    const skill = getAlchemySkill(actor);
    const skillSnapshot = getAlchemySkillSnapshot(actor, { skill });
    const talents = getAlchemyTalents(actor);
    const inventory = getAlchemyInventoryState(actor);
    const knownEffects = getActorKnownAlchemyEffects(actor);

    const ingredients = actor.items
      .filter((item) => item.flags?.["uesrpg-3ev4"]?.alchemy?.kind === "ingredient")
      .map((item) => {
        const alchemy = item.flags["uesrpg-3ev4"].alchemy;
        const effectiveStrength = computeEffectiveStrength(item, actor);
        const tier = Object.entries(QUALITY_TIERS).find(([, entry]) => entry.strength >= effectiveStrength);
        return {
          id: item.id,
          name: item.name,
          school: String(alchemy.school ?? "?").toLowerCase(),
          strengthBase: Number(alchemy.strengthBase ?? 0),
          effectiveStrength,
          depthBase: Number(alchemy.depthBase ?? 1),
          tierLabel: tier ? tier[1].label : "?",
          qty: Number(item.system?.quantity ?? 1),
        };
      });

    const destructionIngredients = ingredients.filter((item) => item.school === "destruction");
    const firstPreparedSlot = ws.slots.findIndex((slot) => slot?.ingredientId || slot?.spellUuid);
    const activeSlotIdx = Math.max(0, Math.min(MAX_SLOTS - 1, Number(ws.activeSlotIdx ?? (firstPreparedSlot >= 0 ? firstPreparedSlot : 0)) || 0));
    this._ws.activeSlotIdx = activeSlotIdx;

    const slots = ws.slots.map((rawSlot, idx) => {
      const slot = _cloneSlot(rawSlot);
      const ingredient = slot.ingredientId ? ingredients.find((item) => item.id === slot.ingredientId) ?? null : null;
      const currentEffectDetail = ingredient && slot.spellUuid
        ? _buildCurrentEffectDetail(actor, ingredient, slot, ws.mode)
        : null;
      const knownEffect = slot.spellUuid
        ? knownEffects.find((entry) => entry.spellUuid === slot.spellUuid) ?? null
        : null;
      return {
        idx,
        isActive: idx === activeSlotIdx,
        slot,
        ingredient,
        currentEffectDetail,
        missingEffectLabel: slot.spellUuid && !currentEffectDetail
          ? String(knownEffect?.label ?? t("UESRPG.Notifications.Alchemy.SelectedEffectUnresolved"))
          : "",
      };
    });

    const recipe = _buildRecipeFromState(ws);
    const validation = validateBrewRecipe(actor, recipe);
    const trialAndErrorBonus = talents.hasTrialAndError ? _getStoredTrialBonus(actor, recipe) : 0;
    const mods = computeBrewModifiers(actor, recipe, {
      nothingVentured: ws.nothingVentured,
      trialAndErrorBonus,
      skill,
    });

    const activeSlot = slots[activeSlotIdx] ?? slots[0];

    let poisonIngredient = null;
    let poisonDice = null;
    if (ws.mode === "poison" && ws.ingredientId) {
      poisonIngredient = ingredients.find((item) => item.id === ws.ingredientId) ?? null;
      if (poisonIngredient) poisonDice = POISON_DICE[poisonIngredient.depthBase] ?? "1d4";
    }

    return {
      ...context,
      actor,
      skill,
      skillSnapshot,
      talents,
      ws,
      mode: ws.mode,
      modes: {
        potion: true,
        poison: true,
        toxin: true,
        gather: true,
      },
      ingredients,
      destructionIngredients,
      slots,
      activeSlotIdx,
      activeSlot,
      knownEffects,
      mods,
      validation,
      adjustedTN: Math.max(0, mods.tn + mods.totalMod),
      toolsPresent: inventory.toolsPresent,
      poisonIngredient,
      poisonDice,
      schools: ALCHEMY_SCHOOLS,
      gatherSchool: ws.gatherSchool,
      qualityTiers: Object.entries(QUALITY_TIERS).map(([key, value]) => ({ key, ...value })),
      maxSlots: MAX_SLOTS,
      hasBlockingErrors: (validation.errors?.length ?? 0) > 0,
      hardError: skillSnapshot.found ? null : t("UESRPG.Notifications.Alchemy.NoValidSkill"),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._bindTrayDraggables();
    this._bindKnownEffectDropzone();
    this._bindKnownEffectControls();
    this._bindSpellDropzones();
    this._bindSlotControls();
  }

  _bindTrayDraggables() {
    const root = this.element;
    if (!root) return;

    root.querySelectorAll("[data-drag-spell-uuid]").forEach((row) => {
      if (row.dataset.dragBound === "true") return;
      row.dataset.dragBound = "true";
      row.addEventListener("dragstart", (event) => {
        const uuid = String(row.dataset.dragSpellUuid ?? "").trim();
        if (!uuid) return;
        event.dataTransfer?.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
      });
    });
  }

  _bindSpellDropzones() {
    const root = this.element;
    if (!root) return;

    root.querySelectorAll("[data-spell-drop-slot]").forEach((zone) => {
      if (zone.dataset.dropBound === "true") return;
      zone.dataset.dropBound = "true";

      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        zone.style.outline = "2px solid rgba(201, 157, 71, 0.9)";
      });

      zone.addEventListener("dragleave", () => {
        zone.style.outline = "";
      });

      zone.addEventListener("drop", async (event) => {
        event.preventDefault();
        zone.style.outline = "";
        const slotIdx = Number(zone.dataset.spellDropSlot ?? -1);
        if (slotIdx < 0) return;
        await this._handleDroppedSpell(event, slotIdx);
      });
    });
  }

  _bindKnownEffectDropzone() {
    const root = this.element;
    if (!root) return;

    root.querySelectorAll("[data-known-effect-drop]").forEach((zone) => {
      if (zone.dataset.dropBound === "true") return;
      zone.dataset.dropBound = "true";

      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        zone.style.outline = "2px solid rgba(201, 157, 71, 0.9)";
      });

      zone.addEventListener("dragleave", () => {
        zone.style.outline = "";
      });

      zone.addEventListener("drop", async (event) => {
        event.preventDefault();
        zone.style.outline = "";
        await this._handleDroppedKnownEffect(event);
      });
    });
  }

  _bindKnownEffectControls() {
    const root = this.element;
    if (!root) return;

    root.querySelectorAll("[data-remove-known-effect]").forEach((button) => {
      if (button.dataset.removeBound === "true") return;
      button.dataset.removeBound = "true";
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const spellUuid = String(button.dataset.removeKnownEffect ?? "").trim();
        if (!spellUuid) return;
        const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
        if (!actor) return;
        await removeActorKnownAlchemyEffect(actor, spellUuid);
        await this.render();
      });
    });
  }

  _bindSlotControls() {
    const root = this.element;
    if (!root) return;

    root.querySelectorAll("[data-slot-card]").forEach((card) => {
      if (card.dataset.slotBound === "true") return;
      card.dataset.slotBound = "true";
      card.addEventListener("click", async () => {
        const slotIdx = Number(card.dataset.slotCard ?? -1);
        if (!Number.isFinite(slotIdx) || slotIdx < 0 || slotIdx >= MAX_SLOTS) return;
        if (this._ws.activeSlotIdx === slotIdx) return;
        this._ws.activeSlotIdx = slotIdx;
        await this.render();
      });
    });

    root.querySelectorAll("[data-clear-spell]").forEach((button) => {
      if (button.dataset.clearBound === "true") return;
      button.dataset.clearBound = "true";
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const slotIdx = Number(button.dataset.clearSpell ?? -1);
        if (!Number.isFinite(slotIdx) || slotIdx < 0 || slotIdx >= MAX_SLOTS) return;
        this._ws.slots[slotIdx] = { ...this._ws.slots[slotIdx], spellUuid: null, spellLevel: 1, effectSource: "spell", effectKey: null, params: {} };
        this._ws.activeSlotIdx = slotIdx;
        await this.render();
      });
    });
  }

  async _handleDroppedSpell(event, slotIdx) {
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    if (!actor) {
      ui.notifications.error(t("UESRPG.Notifications.Alchemy.ActorNotFound"));
      return;
    }

    const dropData = _readDropData(event);
    if (!dropData || dropData.type !== "Item") return;

    const spell = await resolveDroppedItem(dropData);
    if (!spell || spell.type !== "spell") {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.DropSpellIntoSlot"));
      return;
    }

    if (spell.pack) {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.CompendiumSpellsUnsupported"));
      return;
    }

    if (String(spell.parent?.documentName ?? "") === "Actor" && String(spell.parent.uuid ?? "") !== String(actor.uuid ?? "")) {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.OnlyActorOrWorldSpells"));
      return;
    }

    if (String(spell.parent?.documentName ?? "") && String(spell.parent?.documentName ?? "") !== "Actor") {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.DropSourceUnsupported"));
      return;
    }

    const slot = _cloneSlot(this._ws.slots[slotIdx]);
    if (!slot.ingredientId) {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.ChooseIngredientBeforeSpell"));
      return;
    }

    const ingredientItem = actor.items.get(slot.ingredientId);
    if (!ingredientItem) {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.IngredientMissingOnActor"));
      return;
    }

    const ingredient = {
      id: ingredientItem.id,
      school: String(ingredientItem.flags?.["uesrpg-3ev4"]?.alchemy?.school ?? "").toLowerCase(),
      depthBase: Number(ingredientItem.flags?.["uesrpg-3ev4"]?.alchemy?.depthBase ?? 1),
      effectiveStrength: computeEffectiveStrength(ingredientItem, actor),
    };

    if (this._ws.slots.some((otherSlot, idx) => idx !== slotIdx && String(otherSlot?.spellUuid ?? "") === String(spell.uuid ?? ""))) {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.EachSpellEffectOnce"));
      return;
    }

    const spellEntry = _buildSpellEntryFromDocument(actor, spell, this._ws.mode);
    if (!spellEntry) {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.OnlyActorOrWorldSpells"));
      return;
    }

    const viability = _findViableSpellLevel(actor, ingredient, spellEntry);
    if (!viability.ok) {
      ui.notifications.warn(viability.reason);
      return;
    }

    if (!actor.flags?.["uesrpg-3ev4"]?.alchemy?.knownEffects?.some?.((entry) => String(entry?.spellUuid ?? "") === String(spell.uuid ?? ""))) {
      const learned = await addActorKnownAlchemyEffect(actor, spell);
      if (!learned?.ok) {
        ui.notifications.warn(learned?.reason ?? t("UESRPG.Notifications.Alchemy.CouldNotAddKnownEffect"));
        return;
      }
    }

    this._ws.slots[slotIdx] = {
      ...slot,
      effectSource: "spell",
      effectKey: null,
      spellUuid: spell.uuid,
      spellLevel: viability.spellLevel,
      params: {},
    };
    this._ws.activeSlotIdx = slotIdx;
    await this.render();
  }

  async _handleDroppedKnownEffect(event) {
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    if (!actor) {
      ui.notifications.error(t("UESRPG.Notifications.Alchemy.ActorNotFound"));
      return;
    }

    const dropData = _readDropData(event);
    if (!dropData || dropData.type !== "Item") return;

    const spell = await resolveDroppedItem(dropData);
    if (!spell || spell.type !== "spell") {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.DropSpellIntoKnownEffects"));
      return;
    }

    if (spell.pack) {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.CompendiumSpellsKnownEffectsUnsupported"));
      return;
    }

    if (String(spell.parent?.documentName ?? "") === "Actor" && String(spell.parent.uuid ?? "") !== String(actor.uuid ?? "")) {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.OnlyActorOrWorldSpellsKnownEffects"));
      return;
    }

    if (String(spell.parent?.documentName ?? "") && String(spell.parent?.documentName ?? "") !== "Actor") {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.KnownEffectsDropSourceUnsupported"));
      return;
    }

    const result = await addActorKnownAlchemyEffect(actor, spell);
    if (!result?.ok) {
      ui.notifications.warn(result?.reason ?? t("UESRPG.Notifications.Alchemy.CouldNotAddKnownEffect"));
      return;
    }

    if (result.added) ui.notifications.info(tf("UESRPG.Notifications.Alchemy.AddedToKnownEffects", { spell: spell.name }));
    await this.render();
  }

  async _onChangeForm(formConfig, event) {
    super._onChangeForm(formConfig, event);

    const target = event?.target;
    if (!(target instanceof HTMLElement)) return;

    const name = String(target.getAttribute("name") ?? "").trim();
    if (!name) return;

    if (name === "mode") {
      const newMode = String(target.value ?? "").trim() || "potion";
      if (newMode === this._ws.mode) return;
      this._ws = _defaultState(newMode);
      await this.render();
      return;
    }

    if (name.startsWith("ingredient-")) {
      const slotIdx = Number(name.split("-")[1] ?? 0);
      if (!Number.isFinite(slotIdx) || slotIdx < 0 || slotIdx >= MAX_SLOTS) return;
      const ingredientId = String(target.value ?? "").trim() || null;
      this._ws.slots[slotIdx] = { ..._defaultSlot(), ingredientId };
      this._ws.activeSlotIdx = slotIdx;
      await this.render();
      return;
    }

    if (name.startsWith("sl-")) {
      const slotIdx = Number(name.split("-")[1] ?? 0);
      if (!Number.isFinite(slotIdx) || slotIdx < 0 || slotIdx >= MAX_SLOTS) return;
      const spellLevel = Math.max(1, Number(target.value ?? 1) || 1);
      this._ws.slots[slotIdx] = { ...this._ws.slots[slotIdx], spellLevel };
      this._ws.activeSlotIdx = slotIdx;
      await this.render();
      return;
    }

    if (name === "poison-ingredient") {
      this._ws.ingredientId = String(target.value ?? "").trim() || null;
      await this.render();
      return;
    }

    if (name === "gatherSchool") {
      this._ws.gatherSchool = String(target.value ?? "restoration").trim() || "restoration";
      await this.render();
      return;
    }

    if (name === "nothingVentured") {
      this._ws.nothingVentured = Boolean(target.checked);
      await this.render();
    }
  }

  static async _onCommit() {
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    if (!actor) {
      ui.notifications.error(t("UESRPG.Notifications.Alchemy.ActorNotFound"));
      return;
    }

    const skillSnapshot = getAlchemySkillSnapshot(actor);
    if (!skillSnapshot.found) {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.NoValidSkill"));
      return;
    }

    if (this._ws.mode === "gather") {
      await this._commitGather(actor);
      return;
    }

    const recipe = _buildRecipeFromState(this._ws);
    const validation = validateBrewRecipe(actor, recipe);

    if ((validation.errors?.length ?? 0) > 0) {
      ui.notifications.warn(`${t("UESRPG.Notifications.Alchemy.CannotBrew")}\n- ${validation.errors.join("\n- ")}`);
      return;
    }

    await createPendingBrewMessage(actor, recipe, { nothingVentured: this._ws.nothingVentured });
    ui.notifications.info(tf("UESRPG.Notifications.Alchemy.BrewPending", { actor: actor.name }));
    await this.close();
  }

  static async _onRollGather() {
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    await this._commitGather(actor);
  }

  async _commitGather(actor) {
    const skillSnapshot = getAlchemySkillSnapshot(actor);
    const tn = skillSnapshot.tn;
    const school = this._ws.gatherSchool;

    if (!skillSnapshot.found) {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.NoValidSkillToRoll"));
      return;
    }

    const roll = new Roll("1d100");
    await roll.evaluate();
    const success = roll.total <= tn;
    const qualityLabel = success ? _randomQualityOnGather(roll.total, tn) : null;
    const gmIds = game.users?.filter((user) => user.isGM).map((user) => user.id) ?? [];

    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="uesrpg-alchemy-brew-card">
          <div class="hdr">
            <img class="actor-thumb" src="${actor.img ?? "icons/svg/mystery-man.svg"}" alt="">
            <div class="hdr-text">
              <div class="title">${actor.name} - Gather Ingredients</div>
              <div class="sub" style="color:${success ? "#388e3c" : "#c62828"};">${success ? "Success" : "Failure"} (${roll.total} vs TN ${tn})</div>
            </div>
          </div>
          <div class="body">
            <div class="uesrpg-da-row"><span class="k">School</span><span class="v">${school.charAt(0).toUpperCase() + school.slice(1)}</span></div>
            ${success
              ? `<div class="uesrpg-da-row"><span class="k">Quality Found</span><span class="v">${qualityLabel}</span></div>
                 <div class="uesrpg-da-row"><span class="k">GM Note</span><span class="v">Add a suitable ingredient item to the actor's inventory.</span></div>`
              : `<div class="uesrpg-da-row"><span class="k">Result</span><span class="v">No suitable ingredients found.</span></div>`
            }
          </div>
        </div>
      `,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      whisper: success ? [] : gmIds,
    });

    if (!success) await this.close();
  }
}

function _randomQualityOnGather(rollTotal, tn) {
  const margin = Math.max(0, tn - rollTotal);
  if (margin >= 50) return "Legendary";
  if (margin >= 40) return "Master";
  if (margin >= 30) return "Expert";
  if (margin >= 20) return "Adept";
  if (margin >= 10) return "Journeyman";
  return "Novice";
}
