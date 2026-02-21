/**
 * Alchemy Workshop — AppV2
 *
 * A HandlebarsApplicationMixin(ApplicationV2) wizard for brewing potions,
 * poisons, and toxins.  Modelled after EnchantingWorkshopAppV2 in structure
 * but entirely independent of it.
 *
 * Supported modes:
 *   potion  — 1–3 ingredient slots, each with a school-matched effect + SL
 *   poison  — single Destruction ingredient, poison level derived from depth
 *   toxin   — 1–3 ingredient slots with Toxin-attribute effects + SL
 *   gather  — ingredient gathering helper (rolls vs. Alchemy; optional gate)
 *
 * Instance state (this._ws) is intentionally ephemeral (not persisted to any
 * document) — it represents pending UI selections before the Commit action
 * dispatches a chat-card brew message.
 *
 * ⚠️ Architect Note: AppV2 anti-pattern guard — this app NEVER reads the DOM
 * to collect form values.  All state lives in this._ws; _prepareContext() derives
 * template data from it; form actions mutate this._ws then call render().
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

import {
  listPotionEffects,
  listToxinEffects,
  getEffectByKey,
  computeEffectCost,
  computeUpkeepDuration,
  effectHasUpkeep,
  QUALITY_TIERS,
  ALCHEMY_SCHOOLS,
  POISON_DICE,
} from "../../../core/alchemy/effects.js";

import {
  getAlchemySkill,
  getAlchemyTalents,
  computeEffectiveStrength,
  computeBrewModifiers,
  validateBrewRecipe,
  createPendingBrewMessage,
} from "../../../core/alchemy/workflow.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SLOTS = 3;
const TEMPLATE_PATH = "systems/uesrpg-3ev4/templates/v2/apps/alchemy-workshop.hbs";

// ── Workshop state factory ────────────────────────────────────────────────────

function _defaultSlot() {
  return { ingredientId: null, effectKey: null, spellLevel: 1, params: {} };
}

function _defaultState(mode = "potion") {
  return {
    mode,
    nothingVentured: false,
    slots: [_defaultSlot(), _defaultSlot(), _defaultSlot()],
    // Gather-mode only
    gatherSchool: "restoration",
    // Poison-mode only
    ingredientId: null,
  };
}

// ── App class ─────────────────────────────────────────────────────────────────

export class AlchemyWorkshopAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {

  // ── Static configuration ─────────────────────────────────────────────────

  static DEFAULT_OPTIONS = {
    id: "alchemy-workshop",
    classes: ["uesrpg", "alchemy-workshop"],
    tag: "form",
    position: { width: 600, height: "auto" },
    window: {
      resizable: true,
      title: "Alchemy Workshop",
    },
    form: {
      // submitOnChange is intentionally FALSE — we manage state imperatively.
      submitOnChange: false,
      closeOnSubmit: false,
    },
    // IMPORTANT (Foundry v13): DEFAULT_OPTIONS.actions is wired to click handlers only
    // (ApplicationV2._onClickAction). Change-driven inputs in this workshop are
    // handled via _onChangeForm instead.
    actions: {
      commit:     AlchemyWorkshopAppV2._onCommit,
      rollGather: AlchemyWorkshopAppV2._onRollGather,
    },
  };

  static PARTS = {
    workshop: { template: TEMPLATE_PATH },
  };

  // ── Constructor ───────────────────────────────────────────────────────────

  constructor(options = {}) {
    super(options);
    /** @type {string} UUID of the actor this workshop is open for. */
    this._actorUuid = options.actorUuid ?? null;
    /** @type {object} Ephemeral UI state. */
    this._ws = _defaultState(options.mode ?? "potion");
  }

  // ── Context preparation ───────────────────────────────────────────────────

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    if (!actor) return { ...context, error: "Actor not found." };

    const ws = this._ws;
    const skill = getAlchemySkill(actor);
    const talents = getAlchemyTalents(actor);
    // Alchemy is a core mechanic — gather helper is always available.
    const enableGather = true;
    const requireLab = game.settings.get("uesrpg-3ev4", "alchemy.requireLab");

    // Available ingredients in actor inventory.
    const ingredients = actor.items
      .filter((i) => i.flags?.["uesrpg-3ev4"]?.alchemy?.kind === "ingredient")
      .map((i) => {
        const algData = i.flags["uesrpg-3ev4"].alchemy;
        const effectiveStrength = computeEffectiveStrength(i, actor);
        const tier = Object.entries(QUALITY_TIERS).find(
          ([, t]) => t.strength >= effectiveStrength
        );
        return {
          id: i.id,
          name: i.name,
          school: algData.school ?? "?",
          strengthBase: algData.strengthBase ?? 0,
          effectiveStrength,
          depthBase: algData.depthBase ?? 1,
          tierLabel: tier ? tier[1].label : "?",
          qty: Number(i.system?.quantity ?? 1),
        };
      });

    // Destruction ingredients for poison mode.
    const destructionIngredients = ingredients.filter((i) => i.school === "destruction");

    // Build per-slot context.
    const slots = ws.slots.map((slot, idx) => {
      const ingredient = slot.ingredientId
        ? ingredients.find((i) => i.id === slot.ingredientId)
        : null;

      // Effects available for this slot = effects matching the ingredient's school.
      let availableEffects = [];
      if (ingredient) {
        const listFn = ws.mode === "toxin" ? listToxinEffects : listPotionEffects;
        availableEffects = listFn({ school: ingredient.school }).map((e) => {
          const sl = Number(slot.spellLevel ?? 1);
          const [slMin, slMax] = e.slRange ?? [1, 7];
          const clampedSl = Math.max(slMin, Math.min(slMax, sl));
          const cost = computeEffectCost(e.key, clampedSl);
          const affordable = cost <= ingredient.effectiveStrength;
          const withinDepth = clampedSl <= ingredient.depthBase;
          return {
            key: e.key,
            label: e.label,
            school: e.school,
            slMin,
            slMax,
            cost,
            affordable,
            withinDepth,
            eligible: affordable && withinDepth,
            selected: e.key === slot.effectKey,
          };
        });
      }

      // Current effect detail.
      let currentEffectDetail = null;
      if (slot.effectKey && ingredient) {
        const sl = Number(slot.spellLevel ?? 1);
        const effectDef = getEffectByKey(slot.effectKey);
        const cost = computeEffectCost(slot.effectKey, sl);
        const upkeep = effectHasUpkeep(slot.effectKey);
        const duration = upkeep
          ? computeUpkeepDuration(slot.effectKey, ingredient.effectiveStrength, cost)
          : null;
        currentEffectDetail = {
          label: effectDef?.label ?? slot.effectKey,
          sl,
          cost,
          effectiveStrength: ingredient.effectiveStrength,
          hasUpkeep: upkeep,
          durationLabel: duration ? `${duration.value} ${duration.unit}` : "Instant",
          slMin: effectDef?.slRange?.[0] ?? 1,
          slMax: Math.min(effectDef?.slRange?.[1] ?? 7, ingredient.depthBase),
        };
      }

      return { idx, slot, ingredient, availableEffects, currentEffectDetail };
    });

    // Modifier breakdown.
    const recipe = _buildRecipeFromState(ws);
    const trialAndErrorBonus = talents.hasTrialAndError
      ? _getStoredTrialBonus(actor, recipe)
      : 0;
    const mods = computeBrewModifiers(actor, recipe, {
      nothingVentured: ws.nothingVentured,
      trialAndErrorBonus,
    });

    // Validation errors.
    const validation = validateBrewRecipe(actor, recipe);

    // Poison mode: selected ingredient.
    let poisonIngredient = null;
    if (ws.mode === "poison" && ws.ingredientId) {
      poisonIngredient = ingredients.find((i) => i.id === ws.ingredientId) ?? null;
    }
    let poisonDice = null;
    if (poisonIngredient) {
      poisonDice = POISON_DICE[poisonIngredient.depthBase] ?? "1d4";
    }

    return {
      ...context,
      actor,
      skill,
      talents,
      ws,
      mode: ws.mode,
      modes: {
        potion: true,
        poison: true,
        toxin: true,
        gather: enableGather,
      },
      ingredients,
      destructionIngredients,
      slots,
      mods,
      validation,
      adjustedTN: Math.max(0, mods.tn + mods.totalMod),
      requireLab,
      labPresent: actor.items.some((i) => /alchemy\s*lab/i.test(i.name ?? "")),
      toolsPresent: actor.items.some((i) => /alchemy\s*(tools?|kit|equipment)/i.test(i.name ?? "")),
      poisonIngredient,
      poisonDice,
      schools: ALCHEMY_SCHOOLS,
      gatherSchool: ws.gatherSchool,
      qualityTiers: Object.entries(QUALITY_TIERS).map(([k, v]) => ({ key: k, ...v })),
      maxSlots: MAX_SLOTS,
    };
  }

  // ── Form change handling ─────────────────────────────────────────────────

  /**
   * Handle changes to form inputs.
   *
   * Foundry v13 routes input change events through _onChangeForm.
   * We use this to keep the workshop state (_ws) deterministic without relying
   * on click-based DEFAULT_OPTIONS.actions.
   *
   * @param {import("foundry/applications/api").ApplicationFormConfiguration} formConfig
   * @param {Event} event
   */
  _onChangeForm(formConfig, event) {
    super._onChangeForm(formConfig, event);

    const target = event?.target;
    if (!(target instanceof HTMLElement)) return;

    const name = String(target.getAttribute("name") ?? "").trim();
    if (!name) return;

    // Mode switch.
    if (name === "mode") {
      const newMode = String(target.value ?? "").trim() || "potion";
      if (newMode === this._ws.mode) return;
      this._ws = _defaultState(newMode);
      void this.render();
      return;
    }

    // Potion/Toxin: ingredient picker per slot.
    if (name.startsWith("ingredient-")) {
      const slotIdx = Number(name.split("-")[1] ?? 0);
      const ingredientId = String(target.value ?? "").trim() || null;
      if (!Number.isFinite(slotIdx) || slotIdx < 0 || slotIdx >= MAX_SLOTS) return;
      this._ws.slots[slotIdx] = { ..._defaultSlot(), ingredientId };
      void this.render();
      return;
    }

    // Potion/Toxin: effect picker per slot.
    if (name.startsWith("effect-")) {
      const slotIdx = Number(name.split("-")[1] ?? 0);
      const effectKey = String(target.value ?? "").trim() || null;
      if (!Number.isFinite(slotIdx) || slotIdx < 0 || slotIdx >= MAX_SLOTS) return;
      this._ws.slots[slotIdx] = { ...this._ws.slots[slotIdx], effectKey, spellLevel: 1, params: {} };
      void this.render();
      return;
    }

    // Potion/Toxin: SL per slot.
    if (name.startsWith("sl-")) {
      const slotIdx = Number(name.split("-")[1] ?? 0);
      const sl = Math.max(1, Math.min(7, Number(target.value) || 1));
      if (!Number.isFinite(slotIdx) || slotIdx < 0 || slotIdx >= MAX_SLOTS) return;
      this._ws.slots[slotIdx] = { ...this._ws.slots[slotIdx], spellLevel: sl };
      void this.render();
      return;
    }

    // Poison mode: single ingredient picker.
    if (name === "poison-ingredient") {
      const ingredientId = String(target.value ?? "").trim() || null;
      this._ws.ingredientId = ingredientId;
      void this.render();
      return;
    }

    // Gather mode: school selector.
    if (name === "gatherSchool") {
      this._ws.gatherSchool = String(target.value ?? "restoration").trim() || "restoration";
      void this.render();
      return;
    }

    // Talent toggle.
    if (name === "nothingVentured") {
      // Checkbox
      // @ts-ignore
      this._ws.nothingVentured = Boolean(target.checked);
      void this.render();
    }
  }

  static async _onCommit(event, target) {
    const actor = this._actorUuid ? await fromUuid(this._actorUuid) : null;
    if (!actor) {
      ui.notifications.error("UESRPG | Alchemy Workshop: Actor not found.");
      return;
    }

    if (this._ws.mode === "gather") {
      await this._commitGather(actor);
      return;
    }

    const recipe = _buildRecipeFromState(this._ws);
    const validation = validateBrewRecipe(actor, recipe);

    if (!validation.ok) {
      const msg = validation.errors.join("\n• ");
      ui.notifications.warn(`Cannot brew:\n• ${msg}`);
      return;
    }

    // Post pending brew message to chat.
    await createPendingBrewMessage(actor, recipe, { nothingVentured: this._ws.nothingVentured });

    ui.notifications.info(`${actor.name}: Brew pending — roll Alchemy in chat.`);
    await this.close();
  }

  static async _onRollGather(event, target) {
    await this._commitGather(await fromUuid(this._actorUuid));
  }

  async _commitGather(actor) {
    const skill = getAlchemySkill(actor);
    const tn = Number(skill?.system?.total ?? 0);
    const school = this._ws.gatherSchool;

    if (tn <= 0) {
      ui.notifications.warn("Actor has no Alchemy skill to roll.");
      return;
    }

    // Roll the gathering test.
    const roll = new Roll("1d100");
    await roll.evaluate();
    const success = roll.total <= tn;

    // Determine quality of gathered ingredient on success.
    const qualityLabel = success ? _randomQualityOnGather(roll.total, tn) : null;

    const gmIds = game.users?.filter((u) => u.isGM).map((u) => u.id) ?? [];

    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="uesrpg-alchemy-brew-card">
          <div class="hdr">
            <img class="actor-thumb" src="${actor.img ?? "icons/svg/mystery-man.svg"}" alt="">
            <div class="hdr-text">
              <div class="title">${actor.name} — Gather Ingredients</div>
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

  // ── Window title ──────────────────────────────────────────────────────────

  get title() {
    const actor = this._actorUuid
      ? game.actors?.find((a) => a.uuid === this._actorUuid)
      : null;
    return actor ? `Alchemy Workshop — ${actor.name}` : "Alchemy Workshop";
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

/** Build a recipe object from workshop state (used by validation + modifiers). */
function _buildRecipeFromState(ws) {
  if (ws.mode === "poison") {
    return {
      mode: "poison",
      ingredientId: ws.ingredientId ?? null,
      poisonLevel: null, // derived from ingredient depth in workflow
    };
  }

  return {
    mode: ws.mode,
    slots: ws.slots.map((s) => ({
      ingredientId: s.ingredientId ?? null,
      effectKey: s.effectKey ?? null,
      spellLevel: Number(s.spellLevel ?? 1),
      params: s.params ?? {},
    })),
  };
}

/** Look up cached Trial-and-Error bonus synchronously from actor flags. */
function _getStoredTrialBonus(actor, recipe) {
  // Inline the hash logic so we don't need an async call in _prepareContext.
  const effects = (recipe.slots ?? [])
    .map((e) => `${e.effectKey ?? ""}:${e.spellLevel ?? 1}`)
    .sort()
    .join(",");
  const hash = `${recipe.mode}|${effects}|${recipe.poisonLevel ?? 0}`;
  const te = actor?.flags?.["uesrpg-3ev4"]?.alchemy?.trialAndError ?? {};
  return Math.min(30, (te[hash] ?? 0) * 10);
}

/**
 * Determine quality label for a gathered ingredient.
 * Better roll (lower value vs TN) = higher quality.
 */
function _randomQualityOnGather(roll, tn) {
  const margin = tn - roll; // 0..tn
  const tiers = Object.values(QUALITY_TIERS);
  // Map margin (0 = barely made it → ubiquitous; tn-1 = near perfect → rare).
  const ratio = Math.min(1, margin / Math.max(1, tn));
  const idx = Math.floor(ratio * Math.min(5, tiers.length - 1));
  return tiers[idx]?.label ?? "Common";
}
