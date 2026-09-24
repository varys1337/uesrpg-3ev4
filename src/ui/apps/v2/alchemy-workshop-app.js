/** Alchemy Workshop — ApplicationV2, catalog-first RAW workflow. */
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

import {
  QUALITY_TIERS,
  ALCHEMY_SCHOOLS,
  POISON_DICE,
  listPotionEffects,
  listToxinEffects,
  getEffectByKey,
  computeEffectCost,
} from "../../../core/alchemy/effects.js";
import {
  getAlchemySkill,
  getAlchemySkillSnapshot,
  getAlchemyTalents,
  computeEffectiveStrength,
  computeBrewModifiers,
  validateBrewRecipe,
  createPendingBrewMessage,
  getAlchemyInventoryState,
  getAlchemyIngredients,
  resolveAlchemyIngredientData,
  resolveAlchemyEffectDescriptor,
} from "../../../core/alchemy/workflow.js";
import { isSupportedAlchemySpellSource } from "../../../core/alchemy/utils.js";
import { getFilledAlchemySlots, getSlotIdentifier } from "../../../core/alchemy/workflow-descriptors.js";
import { computeAlchemyRecipeHash } from "../../../core/alchemy/workflow-state.js";
import { createOwnedItem, updateAlchemyDocument } from "../../../core/alchemy/operations.js";
import { doTestRoll, getMaximumSuccessDegree } from "../../../utils/degree-roll-helper.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { readDropData, resolveDroppedItem } from "../../../utils/drop-data.js";
import { SYSTEM_ID, templatePath } from "../../constants.js";
import { t, tf } from "../../../utils/i18n.js";
import { asyncGuardSheet } from "../../../utils/async-guard.js";
import { activateOpenApplication } from "./application-focus.js";
import { withApplicationUniqueId } from "./application-identity.js";
import { clearQueuedRenderPartsState, queueRenderParts } from "../../sheets/v2/shared/sheet-runtime-helpers.js";

const MAX_SLOTS = 3;
const WORKSHOP_MODES = Object.freeze(["potion", "toxin", "poison", "gather"]);
const TEMPLATE_PATH = templatePath("v2/apps/alchemy-workshop.hbs");

function _defaultSlot() {
  return { ingredientId: null, effectSource: "catalog", effectKey: null, spellUuid: null, spellLevel: 1, params: {} };
}

function _defaultState(mode = "potion") {
  return {
    mode: WORKSHOP_MODES.includes(mode) ? mode : "potion",
    slots: Array.from({ length: MAX_SLOTS }, _defaultSlot),
    ingredientId: null,
    gatherSchool: "restoration",
    nothingVentured: false,
  };
}

function _cloneSlot(slot) {
  const source = String(slot?.effectSource ?? (slot?.spellUuid ? "spell" : "catalog"));
  return {
    ingredientId: slot?.ingredientId ?? null,
    effectSource: source,
    effectKey: source === "catalog" ? String(slot?.effectKey ?? "") || null : null,
    spellUuid: source === "spell" ? String(slot?.spellUuid ?? "") || null : null,
    spellLevel: Math.max(1, Number(slot?.spellLevel ?? 1) || 1),
    params: { ...(slot?.params ?? {}) },
  };
}

function _buildRecipe(ws, ingredients = []) {
  if (ws.mode === "poison") {
    const ingredient = ingredients.find((entry) => entry.id === ws.ingredientId) ?? null;
    return {
      mode: "poison",
      ingredientId: ws.ingredientId ?? null,
      poisonLevel: ingredient?.depthBase ?? 1,
      damageFormula: POISON_DICE[ingredient?.depthBase ?? 1] ?? "1d4",
    };
  }
  return { mode: ws.mode, slots: ws.slots.map(_cloneSlot) };
}

function _formatDuration(duration) {
  if (!duration) return t("UESRPG.Apps.AlchemyWorkshop.Instant", "Instant");
  return `${Number(duration.value ?? 0)} ${String(duration.unit ?? "rounds")}`;
}

function _levelOptions(effect, ingredient) {
  if (!effect || !ingredient) return [];
  const discrete = Array.isArray(effect.levelOptions) && effect.levelOptions.length
    ? effect.levelOptions
    : Array.from({ length: Math.max(0, Math.min(effect.slMax ?? 8, ingredient.depthBase) - Math.max(1, effect.slMin ?? 1) + 1) }, (_, index) => Math.max(1, effect.slMin ?? 1) + index);
  return discrete
    .filter((level) => level <= ingredient.depthBase)
    .map((level) => ({
      value: level,
      cost: effect.effectSource === "catalog" ? computeEffectCost(effect.effectKey, level) : null,
      disabled: effect.effectSource === "catalog" && computeEffectCost(effect.effectKey, level) > ingredient.effectiveStrength,
    }));
}

function _catalogFor(mode, school) {
  if (!school) return [];
  return mode === "toxin" ? listToxinEffects({ school }) : listPotionEffects({ school });
}

function _gatherChoices(degree) {
  const choices = [
    { qualityKey: "common", quantity: 2, minimum: 1 },
    { qualityKey: "plentiful", quantity: 4, minimum: 1 },
    { qualityKey: "ubiquitous", quantity: 8, minimum: 1 },
    { qualityKey: "uncommon", quantity: 1, minimum: 5 },
    { qualityKey: "rare", quantity: 1, minimum: 7 },
    { qualityKey: "veryRare", quantity: 1, minimum: 8 },
    { qualityKey: "extremelyRare", quantity: 1, minimum: 9 },
    { qualityKey: "legendary", quantity: 1, minimum: 10 },
  ];
  return choices.filter((entry) => degree >= entry.minimum).reverse();
}

export class AlchemyWorkshopAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static #openByActor = new Map();

  static DEFAULT_OPTIONS = {
    id: "alchemy-workshop-{id}",
    classes: ["uesrpg", "alchemy-workshop"],
    tag: "form",
    position: { width: 760, height: 700 },
    window: { resizable: true },
    form: {
      handler: asyncGuardSheet(AlchemyWorkshopAppV2.prototype._onSubmit),
      submitOnChange: false,
      closeOnSubmit: false,
    },
    actions: {
      modeChange: AlchemyWorkshopAppV2.prototype._onModeChange,
      commit: AlchemyWorkshopAppV2.prototype._onCommitAction,
      clearCustom: AlchemyWorkshopAppV2.prototype._onClearCustom,
      chooseIngredient: AlchemyWorkshopAppV2.prototype._onChooseIngredient,
      clearIngredient: AlchemyWorkshopAppV2.prototype._onClearIngredient,
    },
  };

  static PARTS = {
    workshop: { template: TEMPLATE_PATH, scrollable: [".alchemy-workshop-body"] },
  };

  static getOpenInstance(actorUuid = "") {
    return this.#openByActor.get(String(actorUuid ?? "").trim()) ?? null;
  }

  static findOpenInstance(predicate = null) {
    const matcher = typeof predicate === "function" ? predicate : () => true;
    for (const app of this.#openByActor.values()) if (app?.rendered && matcher(app)) return app;
    return null;
  }

  static async prompt({ actorUuid = null, mode = "potion" } = {}) {
    const key = String(actorUuid ?? "").trim();
    const existing = key ? this.getOpenInstance(key) : null;
    if (existing?.rendered) {
      existing._ws = _defaultState(mode);
      return activateOpenApplication(existing, { render: { parts: ["workshop"] } });
    }
    const app = new AlchemyWorkshopAppV2({ actorUuid, mode });
    if (key) this.#openByActor.set(key, app);
    await app.render(true);
    return app;
  }

  constructor(options = {}) {
    super(withApplicationUniqueId(options, options.actorUuid ?? "unbound"));
    this._actorUuid = options.actorUuid ?? null;
    this._ws = _defaultState(options.mode);
    this._ownedHooks = [];
  }

  get title() {
    return t("UESRPG.Apps.AlchemyWorkshop.Title", "Alchemy Workshop");
  }

  _onClose(options = {}) {
    const key = String(this._actorUuid ?? "").trim();
    if (key) AlchemyWorkshopAppV2.#openByActor.delete(key);
    for (const [event, hookId] of this._ownedHooks) Hooks.off(event, hookId);
    this._ownedHooks = [];
    clearQueuedRenderPartsState(this);
    return super._onClose(options);
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this._registerDocumentHooks();
  }

  _pruneIngredientSelections(actor) {
    const usable = new Map(getAlchemyIngredients(actor).filter((entry) => entry.isUsable).map((entry) => [entry.id, entry]));
    this._ws.slots = this._ws.slots.map((raw) => {
      const slot = _cloneSlot(raw);
      if (!slot.ingredientId || usable.has(slot.ingredientId)) return slot;
      return _defaultSlot();
    });
    const poison = usable.get(this._ws.ingredientId);
    if (!poison || poison.school !== "destruction") this._ws.ingredientId = null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    if (!actor) return { ...context, actorFound: false, hardError: t("UESRPG.Notifications.Alchemy.ActorNotFound") };
    this._pruneIngredientSelections(actor);

    const skill = getAlchemySkill(actor);
    const rawSkillSnapshot = getAlchemySkillSnapshot(actor, { skill });
    const rankKey = ({ 0: "Novice", 1: "Apprentice", 2: "Journeyman", 3: "Adept", 4: "Expert", 5: "Master", 6: "Grandmaster" })[rawSkillSnapshot.rank] ?? "Untrained";
    const skillSnapshot = {
      ...rawSkillSnapshot,
      rankLabel: t(`UESRPG.Apps.AlchemyWorkshop.Ranks.${rankKey}`, `${rankKey} (${rawSkillSnapshot.rank})`),
    };
    const talents = getAlchemyTalents(actor);
    const inventory = getAlchemyInventoryState(actor);
    if (this._ws.mode === "gather" && !inventory.gatheringEnabled) this._ws.mode = "potion";

    const ingredients = getAlchemyIngredients(actor).map((entry) => {
      const normalized = {
        ...entry,
        qty: entry.quantity,
        effectiveStrength: computeEffectiveStrength(entry.item, actor, { talents }),
        disabled: !entry.isUsable,
        optionLabel: entry.isUsable
          ? `${entry.name} — ${entry.school}, S ${computeEffectiveStrength(entry.item, actor, { talents })}/D ${entry.depthBase}, ×${entry.quantity}`
          : `${entry.name} — ${t("UESRPG.Apps.AlchemyWorkshop.UnconfiguredIngredient", "unconfigured; assign a school on the Item sheet")}`,
      };
      return { ...normalized, displayMeta: normalized.isUsable ? this._ingredientMeta(normalized, actor) : normalized.optionLabel };
    });
    const usableIngredients = ingredients.filter((entry) => entry.isUsable);
    const destructionIngredients = usableIngredients.filter((entry) => entry.school === "destruction");

    const slots = this._ws.slots.map((raw, idx) => {
      const slot = _cloneSlot(raw);
      const ingredient = ingredients.find((entry) => entry.id === slot.ingredientId) ?? null;
      const catalogOptions = ingredient && (this._ws.mode === "potion" || this._ws.mode === "toxin")
        ? _catalogFor(this._ws.mode, ingredient.school).map((effect) => ({
            key: effect.key,
            label: effect.label,
            selected: slot.effectSource === "catalog" && slot.effectKey === effect.key,
          }))
        : [];
      const descriptor = ingredient && (slot.effectKey || slot.spellUuid)
        ? resolveAlchemyEffectDescriptor(actor, slot, { ingredient: ingredient.item, talents, mode: this._ws.mode })
        : null;
      const levels = _levelOptions(descriptor, ingredient).map((entry) => ({ ...entry, selected: entry.value === slot.spellLevel }));
      const parameters = (descriptor?.parameters ?? []).map((parameter) => ({
        ...parameter,
        options: (parameter.options ?? []).map((option) => ({ ...option, selected: String(slot.params?.[parameter.key] ?? "") === String(option.value) })),
      }));
      return {
        idx,
        number: idx + 1,
        slot,
        ingredient,
        catalogOptions,
        descriptor,
        levelOptions: levels,
        parameters,
        durationLabel: _formatDuration(descriptor?.finalDuration),
        sourceLabel: descriptor?.effectSource === "spell" ? t("UESRPG.Apps.AlchemyWorkshop.HomebrewEffect", "Custom/Homebrew") : t("UESRPG.Apps.AlchemyWorkshop.CatalogEffect", "RAW Catalog"),
        ingredientUuid: ingredient?.uuid ?? "",
      };
    });

    const recipe = _buildRecipe(this._ws, ingredients);
    const recipeHash = computeAlchemyRecipeHash(recipe, {
      getFilledSlots: getFilledAlchemySlots,
      getSlotIdentifier,
    });
    const trialAttempts = Number(actor.flags?.[SYSTEM_ID]?.alchemy?.trialAndError?.[recipeHash] ?? 0) || 0;
    const trialAndErrorBonus = talents.hasTrialAndError ? Math.min(30, trialAttempts * 10) : 0;
    const validation = validateBrewRecipe(actor, recipe);
    const mods = computeBrewModifiers(actor, recipe, {
      nothingVentured: this._ws.nothingVentured,
      trialAndErrorBonus,
      skill,
    });
    const poisonIngredient = destructionIngredients.find((entry) => entry.id === this._ws.ingredientId) ?? null;
    const modeOptions = [
      { key: "potion", label: t("UESRPG.Apps.AlchemyWorkshop.Modes.Potion.Label", "Potion"), icon: "fas fa-flask", available: true },
      { key: "toxin", label: t("UESRPG.Apps.AlchemyWorkshop.Modes.Toxin.Label", "Toxin"), icon: "fas fa-vial", available: true },
      { key: "poison", label: t("UESRPG.Apps.AlchemyWorkshop.Modes.Poison.Label", "Poison"), icon: "fas fa-skull-crossbones", available: true },
      { key: "gather", label: t("UESRPG.Apps.AlchemyWorkshop.Modes.Gather.Label", "Gather"), icon: "fas fa-leaf", available: inventory.gatheringEnabled, unavailableReason: t("UESRPG.Apps.AlchemyWorkshop.GatherDisabled", "Enable the gathering helper in system settings.") },
    ].map((entry) => ({ ...entry, active: entry.key === this._ws.mode }));

    return {
      ...context,
      actorFound: true,
      actor,
      actorUuid: actor.uuid,
      actorName: actor.name,
      actorImg: actor.img,
      controlIdPrefix: this.id,
      mode: this._ws.mode,
      modeOptions,
      ws: this._ws,
      skillSnapshot,
      talents,
      inventory,
      ingredients,
      usableIngredients,
      destructionIngredients,
      usableIngredientCount: usableIngredients.reduce((sum, entry) => sum + entry.quantity, 0),
      unconfiguredIngredientCount: ingredients.filter((entry) => !entry.isConfigured).reduce((sum, entry) => sum + entry.quantity, 0),
      slots,
      recipe,
      validation,
      errors: validation.issues
        .filter((entry) => entry.severity === "error")
        .map((entry) => ({ ...entry, message: t(entry.messageKey, entry.message) })),
      warnings: validation.issues
        .filter((entry) => entry.severity === "warning")
        .map((entry) => ({ ...entry, message: t(entry.messageKey, entry.message) })),
      mods,
      trialAndErrorBonus,
      adjustedTN: Math.max(0, mods.tn + mods.totalMod),
      poisonIngredient,
      poisonDice: poisonIngredient ? POISON_DICE[poisonIngredient.depthBase] : null,
      schools: ALCHEMY_SCHOOLS.map((school) => ({ key: school, selected: school === this._ws.gatherSchool })),
      canCommit: this._ws.mode === "gather" ? skillSnapshot.found : validation.ok,
      actionLabel: this._ws.mode === "gather"
        ? t("UESRPG.Apps.AlchemyWorkshop.Actions.Gather", "Roll Gathering")
        : t("UESRPG.Apps.AlchemyWorkshop.Actions.Brew", "Prepare Brew"),
      hardError: skillSnapshot.found ? null : t("UESRPG.Notifications.Alchemy.NoValidSkill"),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!root) return;
    root.querySelectorAll("select[data-alchemy-control], input[data-alchemy-control]").forEach((control) => {
      control.addEventListener("change", (event) => this._onControlChange(event));
    });
    root.querySelectorAll("[data-custom-drop-slot]").forEach((zone) => {
      zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("is-dragover"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
      zone.addEventListener("drop", (event) => this._onCustomDrop(event, zone));
    });
    root.querySelectorAll("[data-alchemy-ingredient-drop]").forEach((zone) => {
      zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("is-dragover"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
      zone.addEventListener("drop", (event) => this._onIngredientDrop(event, zone));
    });
  }

  async _onModeChange(event, target) {
    event.preventDefault();
    const mode = String(target?.dataset?.mode ?? "");
    if (!WORKSHOP_MODES.includes(mode) || target?.hasAttribute?.("disabled") || mode === this._ws.mode) return;
    this._ws.mode = mode;
    if (mode === "potion" || mode === "toxin") {
      this._ws.slots = this._ws.slots.map((slot) => ({ ...slot, effectKey: null, spellUuid: null, effectSource: "catalog", spellLevel: 1, params: {} }));
    }
    await this.render({ parts: ["workshop"] });
  }

  async _onControlChange(event) {
    const target = event.currentTarget;
    const name = String(target?.name ?? "");
    const slotMatch = name.match(/^(effect|sl)-(\d+)$/);
    if (slotMatch) {
      const idx = Number(slotMatch[2]);
      if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_SLOTS) return;
      const slot = _cloneSlot(this._ws.slots[idx]);
      if (slotMatch[1] === "effect") {
        slot.effectSource = "catalog";
        slot.effectKey = String(target.value ?? "") || null;
        slot.spellUuid = null;
        const effect = getEffectByKey(slot.effectKey);
        slot.spellLevel = effect?.levelOptions?.[0] ?? effect?.slRange?.[0] ?? 1;
        slot.params = Object.fromEntries((effect?.parameters ?? []).map((parameter) => [parameter.key, parameter.options?.[0]?.value ?? ""]));
      } else {
        slot.spellLevel = Math.max(1, Number(target.value ?? 1) || 1);
      }
      this._ws.slots[idx] = slot;
      await this.render({ parts: ["workshop"] });
      return;
    }

    const parameterMatch = name.match(/^param-(\d+)-(.+)$/);
    if (parameterMatch) {
      const idx = Number(parameterMatch[1]);
      const key = String(parameterMatch[2]);
      const slot = _cloneSlot(this._ws.slots[idx]);
      slot.params[key] = String(target.value ?? "");
      this._ws.slots[idx] = slot;
      await this.render({ parts: ["workshop"] });
      return;
    }

    if (name === "gather-school") this._ws.gatherSchool = String(target.value ?? "restoration");
    else if (name === "nothing-ventured") this._ws.nothingVentured = Boolean(target.checked);
    else return;
    await this.render({ parts: ["workshop"] });
  }

  _ingredientCandidates(actor, targetKey) {
    const entries = getAlchemyIngredients(actor).filter((entry) => entry.isUsable);
    return targetKey === "poison" ? entries.filter((entry) => entry.school === "destruction") : entries;
  }

  _ingredientMeta(entry, actor) {
    const effectiveStrength = computeEffectiveStrength(entry.item, actor);
    return tf(
      "UESRPG.Apps.AlchemyWorkshop.Dropzones.IngredientMeta",
      {
        school: entry.school.charAt(0).toUpperCase() + entry.school.slice(1),
        quality: entry.qualityLabel,
        strength: effectiveStrength,
        depth: entry.depthBase,
        quantity: entry.quantity,
      },
      `${entry.school} · ${entry.qualityLabel} · S ${effectiveStrength} / D ${entry.depthBase} · ×${entry.quantity}`,
    );
  }

  async _assignIngredient(targetKey, item) {
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    if (!actor || item?.documentName !== "Item" || item.parent?.uuid !== actor.uuid) {
      ui.notifications.warn(t("UESRPG.Apps.AlchemyWorkshop.Dropzones.ActorOwnedOnly", "Drop an Item owned by this actor."));
      return false;
    }
    const ingredient = resolveAlchemyIngredientData(item);
    if (!ingredient) {
      ui.notifications.warn(t("UESRPG.Apps.AlchemyWorkshop.Dropzones.NotIngredient", "That Item is not a recognized alchemical ingredient."));
      return false;
    }
    if (!ingredient.isConfigured) {
      ui.notifications.warn(t("UESRPG.Apps.AlchemyWorkshop.Dropzones.Unconfigured", "Assign a school to this ingredient on its Item sheet before using it."));
      return false;
    }
    if (!ingredient.isUsable) {
      ui.notifications.warn(t("UESRPG.Apps.AlchemyWorkshop.Dropzones.Unavailable", "That ingredient has no usable units."));
      return false;
    }
    if (targetKey === "poison") {
      if (ingredient.school !== "destruction") {
        ui.notifications.warn(t("UESRPG.Apps.AlchemyWorkshop.Dropzones.PoisonRequiresDestruction", "Poison requires a configured Destruction ingredient."));
        return false;
      }
      this._ws.ingredientId = item.id;
    } else {
      const idx = Number(targetKey);
      if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_SLOTS) return false;
      this._ws.slots[idx] = { ..._defaultSlot(), ingredientId: item.id };
    }
    await queueRenderParts(this, ["workshop"]);
    return true;
  }

  async _onIngredientDrop(event, zone) {
    event.preventDefault();
    zone.classList.remove("is-dragover");
    const item = await resolveDroppedItem(readDropData(event));
    await this._assignIngredient(String(zone.dataset.alchemyIngredientDrop ?? ""), item);
  }

  async _onChooseIngredient(event, target) {
    event.preventDefault();
    const targetKey = String(target?.dataset?.ingredientTarget ?? "");
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    const candidates = this._ingredientCandidates(actor, targetKey);
    if (!candidates.length) {
      ui.notifications.warn(t("UESRPG.Apps.AlchemyWorkshop.Dropzones.NoEligibleIngredients", "No eligible configured ingredients are available."));
      return;
    }
    const esc = (value) => foundry.utils.escapeHTML(String(value ?? ""));
    const rows = candidates.map((entry, index) => `<label class="alchemy-picker-row">
      <input type="radio" name="ingredientUuid" value="${esc(entry.uuid)}" ${index === 0 ? "checked" : ""}>
      <img src="${esc(entry.item?.img ?? "icons/svg/item-bag.svg")}" alt="">
      <span><strong>${esc(entry.name)}</strong><small>${esc(this._ingredientMeta(entry, actor))}</small></span>
    </label>`).join("");
    const uuid = await customDialog({
      title: t("UESRPG.Apps.AlchemyWorkshop.Dropzones.ChooseIngredient", "Choose Ingredient"),
      content: `<div class="alchemy-picker-list">${rows}</div>`,
      buttons: {
        choose: {
          label: t("UESRPG.Buttons.Select", "Select"),
          callback: (html) => html?.querySelector?.('input[name="ingredientUuid"]:checked')?.value ?? null,
        },
        cancel: { label: t("UESRPG.Buttons.Cancel", "Cancel"), callback: () => null },
      },
      default: "choose",
      classes: ["alchemy-ingredient-picker-dialog"],
      width: 480,
      resizable: true,
    });
    if (!uuid) return;
    const item = await fromUuid(uuid).catch(() => null);
    await this._assignIngredient(targetKey, item);
  }

  async _onClearIngredient(event, target) {
    event.preventDefault();
    const targetKey = String(target?.dataset?.ingredientTarget ?? "");
    if (targetKey === "poison") this._ws.ingredientId = null;
    else {
      const idx = Number(targetKey);
      if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_SLOTS) return;
      this._ws.slots[idx] = _defaultSlot();
    }
    await queueRenderParts(this, ["workshop"]);
  }

  _registerDocumentHooks() {
    if (this._ownedHooks.length) return;
    const onItemChange = (item) => {
      if (item?.parent?.uuid !== this._actorUuid || !this.rendered) return;
      void queueRenderParts(this, ["workshop"]);
    };
    this._ownedHooks.push(
      ["createItem", Hooks.on("createItem", onItemChange)],
      ["updateItem", Hooks.on("updateItem", onItemChange)],
      ["deleteItem", Hooks.on("deleteItem", onItemChange)],
    );
  }

  async _onCustomDrop(event, zone) {
    event.preventDefault();
    zone.classList.remove("is-dragover");
    const idx = Number(zone.dataset.customDropSlot);
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    const ingredient = actor?.items?.get?.(this._ws.slots[idx]?.ingredientId) ?? null;
    if (!actor || !ingredient) {
      ui.notifications.warn(t("UESRPG.Notifications.Alchemy.ChooseIngredientFirst"));
      return;
    }
    const spell = await resolveDroppedItem(readDropData(event));
    if (!isSupportedAlchemySpellSource(actor, spell)) {
      ui.notifications.warn(t("UESRPG.Apps.AlchemyWorkshop.CustomSourceRejected", "Only actor-owned or world Spell Items can be used as custom effects."));
      return;
    }
    const levels = new Set([Math.max(1, Number(spell.system?.level ?? 1) || 1)]);
    for (const entry of spell.system?.scaling?.levels ?? []) levels.add(Math.max(1, Number(entry?.level ?? 1) || 1));
    let accepted = null;
    for (const level of [...levels].sort((a, b) => a - b)) {
      const candidate = { ingredientId: ingredient.id, effectSource: "spell", spellUuid: spell.uuid, spellLevel: level, params: {} };
      const descriptor = resolveAlchemyEffectDescriptor(actor, candidate, { ingredient, mode: this._ws.mode });
      const ingredientData = getAlchemyIngredients(actor).find((entry) => entry.id === ingredient.id);
      if (descriptor?.compatible && descriptor.school === ingredientData?.school && level <= ingredientData.depthBase && descriptor.cost <= computeEffectiveStrength(ingredient, actor)) {
        accepted = candidate;
        break;
      }
    }
    if (!accepted) {
      ui.notifications.warn(t("UESRPG.Apps.AlchemyWorkshop.CustomEffectRejected", "That spell has no directly serializable level compatible with the selected ingredient."));
      return;
    }
    this._ws.slots[idx] = accepted;
    await this.render({ parts: ["workshop"] });
  }

  async _onClearCustom(event, target) {
    event.preventDefault();
    const idx = Number(target?.dataset?.slot);
    if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_SLOTS) return;
    this._ws.slots[idx] = { ..._defaultSlot(), ingredientId: this._ws.slots[idx]?.ingredientId ?? null };
    await this.render({ parts: ["workshop"] });
  }

  async _onSubmit(event) {
    event?.preventDefault?.();
    return this._commit();
  }

  async _onCommitAction(event) {
    event.preventDefault();
    return this._commit();
  }

  async _commit() {
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    if (!actor) return ui.notifications.error(t("UESRPG.Notifications.Alchemy.ActorNotFound"));
    if (this._ws.mode === "gather") return this._commitGather(actor);
    const ingredients = getAlchemyIngredients(actor).map((entry) => ({ ...entry, effectiveStrength: computeEffectiveStrength(entry.item, actor) }));
    const recipe = _buildRecipe(this._ws, ingredients);
    const validation = validateBrewRecipe(actor, recipe);
    if (!validation.ok) return ui.notifications.warn(validation.errors.join("\n"));
    const created = await createPendingBrewMessage(actor, recipe, { nothingVentured: this._ws.nothingVentured });
    if (!created) return;
    ui.notifications.info(tf("UESRPG.Notifications.Alchemy.BrewPending", { actor: actor.name }));
    await this.close();
  }

  async _commitGather(actor) {
    if (!getAlchemyInventoryState(actor).gatheringEnabled) {
      ui.notifications.warn(t("UESRPG.Apps.AlchemyWorkshop.GatherDisabled", "Enable the gathering helper in system settings."));
      return;
    }
    const skill = getAlchemySkillSnapshot(actor);
    if (!skill.found) return ui.notifications.warn(t("UESRPG.Notifications.Alchemy.NoValidSkillToRoll"));
    const result = await doTestRoll(actor, { target: skill.tn, allowLucky: true, allowUnlucky: true });
    if (game.dice3d?.showForRoll) Promise.resolve(game.dice3d.showForRoll(result.roll)).catch(() => {});
    if (!result.isSuccess) {
      await this._postGatherMessage(actor, result, null);
      return;
    }
    const maxNormalDegree = getMaximumSuccessDegree(skill.tn);
    const degree = result.isCriticalSuccess ? maxNormalDegree + 1 : result.degree;
    const choices = _gatherChoices(degree);
    const optionHtml = choices.map((choice) => {
      const tier = QUALITY_TIERS[choice.qualityKey];
      return `<option value="${choice.qualityKey}:${choice.quantity}">${choice.quantity} × ${foundry.utils.escapeHTML(tier.label)} (Strength ${tier.strength}, Depth ${tier.depth})</option>`;
    }).join("");
    const schoolHtml = ALCHEMY_SCHOOLS.map((school) => (
      `<option value="${school}"${school === this._ws.gatherSchool ? " selected" : ""}>${school.charAt(0).toUpperCase()}${school.slice(1)}</option>`
    )).join("");
    const picked = await customDialog({
      title: t("UESRPG.Apps.AlchemyWorkshop.GatherResult", "Choose Gathered Ingredients"),
      content: `<div class="alchemy-gather-result-dialog"><div class="form-group"><label for="alchemy-gather-result">${t("UESRPG.Apps.AlchemyWorkshop.GatherChoice", "Result or downgrade")}</label><select id="alchemy-gather-result" name="gather-result">${optionHtml}</select></div><div class="form-group"><label for="alchemy-gather-school">${t("UESRPG.Chat.Magic.School")}</label><select id="alchemy-gather-school" name="gather-school">${schoolHtml}</select></div></div>`,
      buttons: {
        add: {
          label: t("UESRPG.Apps.AlchemyWorkshop.Actions.AddIngredients", "Add Ingredients"),
          icon: "fas fa-plus",
          callback: (html) => ({
            result: html.querySelector('[name="gather-result"]')?.value ?? "",
            school: html.querySelector('[name="gather-school"]')?.value ?? this._ws.gatherSchool,
          }),
        },
        cancel: { label: t("UESRPG.UI.Cancel", "Cancel"), icon: "fas fa-times", callback: () => null },
      },
      defaultButton: "add",
      layout: "form",
      classes: ["alchemy-gather-result-picker"],
      width: 520,
      resizable: true,
    });
    if (!picked) {
      await this._postGatherMessage(actor, { ...result, degree }, null);
      return;
    }
    const [qualityKey, quantityText] = String(picked.result ?? "").split(":");
    const selectedSchool = ALCHEMY_SCHOOLS.includes(picked.school) ? picked.school : this._ws.gatherSchool;
    this._ws.gatherSchool = selectedSchool;
    const gathered = await this._recordGatheredIngredient(actor, qualityKey, Number(quantityText), selectedSchool);
    if (!gathered) {
      ui.notifications.error(t("UESRPG.Apps.AlchemyWorkshop.GatherRecordFailed", "The gathered ingredient could not be added to the actor inventory."));
    }
    await this._postGatherMessage(actor, { ...result, degree }, gathered, { recordFailed: !gathered });
    await this.render({ parts: ["workshop"] });
  }

  async _recordGatheredIngredient(actor, qualityKey, quantity, school) {
    const tier = QUALITY_TIERS[qualityKey];
    if (!tier) return null;
    const existing = getAlchemyIngredients(actor).find((entry) => entry.qualityKey === qualityKey && entry.school === school && entry.recognitionSource === "flag");
    if (existing) {
      const updated = await updateAlchemyDocument(existing.item, { "system.quantity": existing.quantity + quantity });
      return updated.ok ? { qualityKey, qualityLabel: tier.label, quantity, school, item: existing.item } : null;
    }

    let sourceData = null;
    const pack = game.packs?.get?.(`${SYSTEM_ID}.items-revised`) ?? [...(game.packs ?? [])].find((entry) => entry.metadata?.label === "Items Revised");
    if (pack) {
      const index = await pack.getIndex({ fields: ["name"] });
      const row = index.find((entry) => entry.name === `Alchemy Ingredient - ${tier.label}`);
      const source = row ? await pack.getDocument(row._id) : null;
      sourceData = source?.toObject?.(false) ?? null;
    }
    const sourceItemData = sourceData ?? {
      name: `Alchemy Ingredient - ${tier.label}`,
      type: "item",
      img: "icons/consumables/plants/dried-herb-bundle-brown.webp",
      system: { quantity: 1, enc: 0, description: "", price: 0 },
    };
    const excludedSourceFields = new Set(["_id", "folder", "ownership", "_stats"]);
    const data = Object.fromEntries(Object.entries(sourceItemData).filter(([key]) => !excludedSourceFields.has(key)));
    data.system = { ...(data.system ?? {}), quantity };
    data.flags = {
      ...(data.flags ?? {}),
      [SYSTEM_ID]: {
        ...(data.flags?.[SYSTEM_ID] ?? {}),
        alchemy: { kind: "ingredient", quality: qualityKey, school, strengthBase: tier.strength, depthBase: tier.depth },
      },
    };
    const created = await createOwnedItem(actor, data);
    return created.ok ? { qualityKey, qualityLabel: tier.label, quantity, school, item: created.data } : null;
  }

  async _postGatherMessage(actor, result, gathered, { recordFailed = false } = {}) {
    const success = Boolean(result?.isSuccess);
    const emptyResult = recordFailed
      ? t("UESRPG.Apps.AlchemyWorkshop.GatherRecordFailed", "The gathered ingredient could not be added to the actor inventory.")
      : success
        ? t("UESRPG.Apps.AlchemyWorkshop.GatherCancelled", "No result recorded")
        : t("UESRPG.Chat.Alchemy.NoSuitableIngredients");
    const content = `<div class="uesrpg-alchemy-brew-card"><div class="hdr"><img class="actor-thumb" src="${foundry.utils.escapeHTML(actor.img ?? "icons/svg/mystery-man.svg")}" alt=""><div class="hdr-text"><div class="title">${foundry.utils.escapeHTML(actor.name)} — ${t("UESRPG.Apps.AlchemyWorkshop.Modes.Gather.Label", "Gather")}</div><div class="sub">${success ? t("UESRPG.Alchemy.Success") : t("UESRPG.Alchemy.Failure")} (${Number(result?.rollTotal ?? 0)} vs TN ${Number(result?.target ?? 0)}; ${Number(result?.degree ?? 0)} ${success ? "DoS" : "DoF"})</div></div></div><div class="body">${gathered ? `<div class="uesrpg-da-row"><span class="k">${t("UESRPG.Apps.AlchemyWorkshop.Gathered", "Gathered")}</span><span class="v">${gathered.quantity} × ${gathered.qualityLabel} (${gathered.school})</span></div>` : `<div class="uesrpg-da-row"><span class="k">${t("UESRPG.Chat.TravelPlanner.Result")}</span><span class="v">${emptyResult}</span></div>`}</div></div>`;
    await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content, style: CONST.CHAT_MESSAGE_STYLES.OTHER });
  }
}
