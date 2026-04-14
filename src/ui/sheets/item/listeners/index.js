/**
 * src/ui/sheets/item/listeners/index.js
 * Central registration for all item sheet listeners
 */

import { registerContainmentListeners } from "./containment.js";
import { registerModifierListeners } from "./modifiers.js";
import { registerUsageListeners } from "./usage.js";
import { registerEffectListeners } from "./effects.js";
import { activateTalentFromItemSheet, activatePowerFromItemSheet, activateTraitFromItemSheet } from "../../shared-handlers.js";
import { SPECIAL_ACTIONS } from "../../../../core/config/special-actions.js";
import { isDebugEnabled } from "../../../../utils/debug.js";
import { validateSpellConfig, formatSpellValidationMessage } from "../../../../core/magic/spell-config.js";

/**
 * Register all item sheet listeners
 *
 * @param {ItemSheet} sheet
 * @param {jQuery} html
 */
export function registerItemSheetListeners(sheet, html) {
  // Talent: Use button (Activation tab)
  if (sheet.item && sheet.item.type === "talent") {
    html.find(".uesrpg-talent-use").off("click.uesrpg").on("click.uesrpg", async (ev) => {
      ev.preventDefault();
      await activateTalentFromItemSheet({ item: sheet.item, event: ev });
    });
  }

  // Power: Use button (Activation tab)
  if (sheet.item && sheet.item.type === "power") {
    html.find(".uesrpg-power-use").off("click.uesrpg").on("click.uesrpg", async (ev) => {
      ev.preventDefault();
      await activatePowerFromItemSheet({ item: sheet.item, event: ev });
    });
  }

  // Trait: Use button (Activation tab)
  if (sheet.item && sheet.item.type === "trait") {
    html.find(".uesrpg-trait-use").off("click.uesrpg").on("click.uesrpg", async (ev) => {
      ev.preventDefault();
      await activateTraitFromItemSheet({ item: sheet.item, event: ev });
    });
  }

  // Combat Style: set active style on owner actor
  if (sheet.item?.type === "combatStyle" && sheet.item.isOwned && sheet.actor) {
    // Combat Style: auto-save UX
    // NOTE: Using full-form submits on every keystroke causes disruptive rerenders and can appear
    // like inputs are being "cleared". Instead, update only the changed lane(s) on change/blur.
    // This keeps the UX stable and still provides deterministic persistence.

    const equipInputs = html.find('input[name^="system.trainedEquipment."]');
    const saInputs = html.find('input[type="checkbox"][name^="system.specialAdvantages."]');

    const debouncedEquipUpdate = foundry.utils.debounce(async () => {
      try {
        // Persist as a canonical 5-slot array (see _updateObject for rationale).
        const te = [];
        for (let i = 0; i < 5; i++) {
          const el = equipInputs.get(i);
          te.push(String(el?.value ?? "").trim());
        }
        await sheet.item.update({ "system.trainedEquipment": te });
      } catch (err) {
        console.warn("UESRPG | Combat Style trainedEquipment auto-update failed", err);
      }
    }, 150);

    // Persist on change (not per keystroke) to prevent input jitter or perceived "clearing".
    // Users can type freely; the value is persisted when the field loses focus.
    equipInputs.on("change", debouncedEquipUpdate);

    // Prevent accidental form submit on Enter inside these fields.
    equipInputs.on("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.currentTarget?.blur?.();
      }
    });

    saInputs.on("change", async (ev) => {
      try {
        const el = ev.currentTarget;
        const name = el?.name;
        if (!name) return;
        await sheet.item.update({ [name]: Boolean(el.checked) });
      } catch (err) {
        console.warn("UESRPG | Combat Style specialAdvantages auto-update failed", err);
      }
    });

    html.find(".uesrpg-set-active-style").off("click.uesrpg").on("click.uesrpg", async (ev) => {
      ev.preventDefault();
      try {
        await sheet.actor.setFlag("uesrpg-3ev4", "activeCombatStyleId", sheet.item.id);
        ui.notifications?.info?.(`Active combat style set to: ${sheet.item.name}`);
        // Re-render owning sheet to update Special Actions list + advantage injection lane.
        sheet.actor.sheet?.render?.(false);
        sheet.render(false);
      } catch (err) {
        console.error("UESRPG | Failed to set active combat style", { actor: sheet.actor?.uuid, item: sheet.item?.uuid, err });
        ui.notifications?.error?.("Failed to set active combat style.");
      }
    });

    html.find(".uesrpg-deactivate-style").off("click.uesrpg").on("click.uesrpg", async (ev) => {
      ev.preventDefault();
      try {
        await sheet.actor.unsetFlag("uesrpg-3ev4", "activeCombatStyleId");
        ui.notifications?.info?.("Combat style deactivated.");
        // Re-render owning sheet to update Special Actions list + advantage injection lane.
        sheet.actor.sheet?.render?.(false);
        sheet.render(false);
      } catch (err) {
        console.error("UESRPG | Failed to deactivate combat style", { actor: sheet.actor?.uuid, item: sheet.item?.uuid, err });
        ui.notifications?.error?.("Failed to deactivate combat style.");
      }
    });
  }

  // Spell: Scaling Levels UI (Phase 3 Task 1)
  if (sheet.item && sheet.item.type === "spell") {
    const DEBUG = isDebugEnabled("spellCastingDebug");
    const fallbackDurationUnit = sheet.item.system?.duration?.unit || "instant";

    const getScalingLevelsArray = () => {
      const rawLevels = foundry.utils.getProperty(sheet.item, "system.scaling.levels");
      if (Array.isArray(rawLevels)) return rawLevels;
      if (rawLevels && typeof rawLevels === "object") {
        return Object.values(rawLevels).filter(v => v && typeof v === "object");
      }
      return [];
    };

    const normalizeScalingEntry = (entry) => {
      const normalized = { ...(entry ?? {}) };
      if (normalized.damageFormula == null) normalized.damageFormula = "";
      if (normalized.description == null) normalized.description = "";
      if (normalized.level == null || normalized.level === "") normalized.level = 1;
      if (normalized.cost == null || normalized.cost === "") normalized.cost = 0;

      const rawDuration = entry?.duration;
      if (rawDuration && typeof rawDuration === "object") {
        normalized.duration = {
          value: Number(rawDuration.value) || 0,
          unit: String(rawDuration.unit ?? fallbackDurationUnit)
        };
      } else {
        normalized.duration = {
          value: Number(rawDuration) || 0,
          unit: fallbackDurationUnit
        };
      }

      return normalized;
    };

    const logDebug = (...args) => {
      if (DEBUG) console.log("UESRPG | Spell Scaling Sheet", ...args);
    };

    // Add Scaling Level button
    html.off("click.uesrpg", "[data-action='add-scaling-level']").on("click.uesrpg", "[data-action='add-scaling-level']", async (ev) => {
      ev.preventDefault();
      if (!sheet.isEditable) return;
      
      let currentLevels = getScalingLevelsArray().map(normalizeScalingEntry);

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
        duration: { value: 0, unit: fallbackDurationUnit },
        description: ""
      };
      
      logDebug("Add scaling level", { nextLevel, currentLevels });

      await sheet.item.update({
        "system.scaling.levels": [...currentLevels, newLevel]
      });
    });
    
    // Delete Scaling Level button
    html.off("click.uesrpg", "[data-action='remove-scaling-level']").on("click.uesrpg", "[data-action='remove-scaling-level']", async (ev) => {
      ev.preventDefault();
      if (!sheet.isEditable) return;
      
      const index = parseInt(ev.currentTarget.dataset.index, 10);
      if (isNaN(index)) return;
      
      let currentLevels = getScalingLevelsArray().map(normalizeScalingEntry);
      
      const newLevels = currentLevels.filter((_, idx) => idx !== index);
      
      logDebug("Remove scaling level", { index, newLevels });

      await sheet.item.update({
        "system.scaling.levels": newLevels
      });
    });

    // Scaling input changes: persist without rerendering the sheet.
    html.off("change.uesrpg", "[data-scaling-input]").on("change.uesrpg", "[data-scaling-input]", async (ev) => {
      if (!sheet.isEditable) return;
      if (sheet.options.submitOnChange) return;

      ev.uesrpgSkipScalingValidation = true;

      const target = ev.currentTarget;
      logDebug("Scaling input change", { name: target?.name, value: target?.value });

      try {
        await sheet._onSubmit(ev, { preventRender: true, preventClose: true });
      } catch (err) {
        console.warn("UESRPG | Failed to auto-save scaling input change", err);
      }
    });

    // Automation module checkbox changes: persist without rerendering to prevent <details> collapse
    const moduleCheckboxSelectors = [
      'input[name="system.hasBuffer"]',
      'input[name="system.hasOverTime"]',
      'input[name^="system.buffer."]',
      'input[name^="system.engine.conjure."]',
      'input[name^="system.engine.damage."]',
      'input[name^="system.engine.overTime."]',
      'input[name^="system.engine.summons."]'
    ].join(', ');

    html.off("change.uesrpg", moduleCheckboxSelectors).on("change.uesrpg", moduleCheckboxSelectors, async (ev) => {
      if (!sheet.isEditable) return;
      if (sheet.options.submitOnChange) return;

      const target = ev.currentTarget;
      logDebug("Automation module checkbox change", { name: target?.name, checked: target?.checked });

      try {
        await sheet._onSubmit(ev, { preventRender: true, preventClose: true });
      } catch (err) {
        console.warn("UESRPG | Failed to auto-save automation module checkbox change", err);
      }
    });

    // Prevent clicks on automation module checkboxes AND their labels from toggling the Advanced Options <details>
    const moduleControlSelectors = [
      moduleCheckboxSelectors,
      '.spell-advanced-body label.spell-check',
      '.spell-module-title'
    ].join(', ');

    html.off("click.uesrpg", moduleControlSelectors).on("click.uesrpg", moduleControlSelectors, (ev) => {
      ev.stopPropagation();
    });

    // OverTime preset buttons — push new entry into overTimeEntries array
    html.off("click.uesrpg", ".overtime-preset").on("click.uesrpg", ".overtime-preset", async (ev) => {
      ev.preventDefault();
      if (!sheet.isEditable) return;

      const preset = ev.currentTarget.dataset.preset;
      if (!preset) return;

      const PRESETS = {
        dot: {
          trigger: "turnStart", cadenceEvery: 1, cadenceUnit: "rounds",
          payloadType: "damage", formula: "1d6", damageType: "fire",
          saveKey: "", saveTN: 0, saveSuccess: "endEffect", saveFailure: "damage",
          maxTicks: null, label: "Burning", chatLog: true
        },
        hot: {
          trigger: "turnEnd", cadenceEvery: 1, cadenceUnit: "rounds",
          payloadType: "heal", formula: "1d6", damageType: "",
          saveKey: "", saveTN: 0, saveSuccess: "endEffect", saveFailure: "damage",
          maxTicks: null, label: "Regeneration", chatLog: true
        },
        saveEachRound: {
          trigger: "turnEnd", cadenceEvery: 1, cadenceUnit: "rounds",
          payloadType: "saveThenApply", formula: "1d6", damageType: "poison",
          saveKey: "end", saveTN: 50, saveSuccess: "endEffect", saveFailure: "damage",
          maxTicks: null, label: "Poison (Save each round)", chatLog: true
        },
        endAfterRounds: {
          trigger: "turnStart", cadenceEvery: 1, cadenceUnit: "rounds",
          payloadType: "damage", formula: "1d6", damageType: "fire",
          saveKey: "", saveTN: 0, saveSuccess: "endEffect", saveFailure: "damage",
          maxTicks: 3, label: "Burning (3 rounds)", chatLog: true
        }
      };

      const config = PRESETS[preset];
      if (!config) return;

      logDebug("OverTime preset applied as new entry", { preset, config });

      const entries = foundry.utils.deepClone(sheet.item.system?.overTimeEntries ?? []);
      entries.push(config);

      try {
        await sheet.item.update({
          "system.hasOverTime": true,
          "system.overTimeEntries": entries
        });
      } catch (err) {
        console.warn("UESRPG | Failed to apply OverTime preset", err);
      }
    });

    // OverTime Entry CRUD
    html.off("click.uesrpg", "[data-action='add-overtime-entry']").on("click.uesrpg", "[data-action='add-overtime-entry']", async (ev) => {
      ev.preventDefault();
      if (!sheet.isEditable) return;

      const entries = foundry.utils.deepClone(sheet.item.system?.overTimeEntries ?? []);
      entries.push({
        trigger: "turnStart", cadenceEvery: 1, cadenceUnit: "rounds",
        payloadType: "damage", formula: "1d6", damageType: "fire",
        saveKey: "", saveTN: 0, saveSuccess: "endEffect", saveFailure: "damage",
        maxTicks: null, label: "", chatLog: true
      });

      await sheet.item.update({ "system.overTimeEntries": entries });
    });

    html.off("click.uesrpg", "[data-action='remove-overtime-entry']").on("click.uesrpg", "[data-action='remove-overtime-entry']", async (ev) => {
      ev.preventDefault();
      if (!sheet.isEditable) return;

      const index = parseInt(ev.currentTarget.dataset.index, 10);
      if (isNaN(index)) return;

      const entries = foundry.utils.deepClone(sheet.item.system?.overTimeEntries ?? []);
      entries.splice(index, 1);

      await sheet.item.update({ "system.overTimeEntries": entries });
    });

    // ── Effect Recipe CRUD (guarded by enableSpellRecipes setting) ──
    const _recipesEnabled = (() => { try { return game.settings.get("uesrpg-3ev4", "enableSpellRecipes") === true; } catch (_e) { return false; } })();

    if (_recipesEnabled) {
    html.off("click.uesrpg", "[data-action='add-effect-recipe']").on("click.uesrpg", "[data-action='add-effect-recipe']", async (ev) => {
      ev.preventDefault();
      if (!sheet.isEditable) return;

      const recipes = foundry.utils.deepClone(sheet.item.system?.engine?.effects?.recipes ?? []);
      recipes.push({ key: "", mode: "add", value: "", target: "target", label: "" });

      logDebug("Add effect recipe", { newCount: recipes.length });

      await sheet.item.update({ "system.engine.effects.recipes": recipes });
    });

    html.off("click.uesrpg", "[data-action='remove-effect-recipe']").on("click.uesrpg", "[data-action='remove-effect-recipe']", async (ev) => {
      ev.preventDefault();
      if (!sheet.isEditable) return;

      const index = parseInt(ev.currentTarget.dataset.recipeIndex, 10);
      if (isNaN(index)) return;

      const recipes = foundry.utils.deepClone(sheet.item.system?.engine?.effects?.recipes ?? []);
      recipes.splice(index, 1);

      logDebug("Remove effect recipe", { index, newCount: recipes.length });

      await sheet.item.update({ "system.engine.effects.recipes": recipes });
    });

    // Recipe input auto-save
    html.off("change.uesrpg", "[data-recipe-input]").on("change.uesrpg", "[data-recipe-input]", async (ev) => {
      if (!sheet.isEditable) return;
      // Collect all recipes from DOM rather than partial update
      const rows = html.find(".spell-recipe-row");
      const recipes = [];
      rows.each(function () {
        const $row = $(this);
        recipes.push({
          key: $row.find('[name$=".key"]').val() || "",
          mode: $row.find('[name$=".mode"]').val() || "add",
          value: $row.find('[name$=".value"]').val() || "",
          target: $row.find('[name$=".target"]').val() || "target",
          label: $row.find('[name$=".label"]').val() || ""
        });
      });

      logDebug("Recipe auto-save", { recipeCount: recipes.length });

      try {
        await sheet.item.update({ "system.engine.effects.recipes": recipes });
      } catch (err) {
        console.warn("UESRPG | Failed to auto-save recipe change", err);
      }
    });

    // Recipe presets
    html.off("click.uesrpg", ".recipe-preset").on("click.uesrpg", ".recipe-preset", async (ev) => {
      ev.preventDefault();
      if (!sheet.isEditable) return;

      const preset = ev.currentTarget.dataset.preset;
      if (!preset) return;

      const RECIPE_PRESETS = {
        fortifyAttr: { key: "system.modifiers.characteristics.str", mode: "add", value: "10", target: "target", label: "Fortify Strength" },
        arBuff: { key: "system.modifiers.combat.armorRating", mode: "add", value: "5", target: "target", label: "AR Buff" },
        ward: { key: "system.modifiers.combat.mitigation.flat", mode: "add", value: "10", target: "self", label: "Flat Mitigation" }
      };

      const recipe = RECIPE_PRESETS[preset];
      if (!recipe) return;

      const recipes = foundry.utils.deepClone(sheet.item.system?.engine?.effects?.recipes ?? []);
      recipes.push({ ...recipe });

      logDebug("Recipe preset applied", { preset, newCount: recipes.length });

      await sheet.item.update({ "system.engine.effects.recipes": recipes });
    });
    } // end if (_recipesEnabled)

    // ── Conjure: Clear button ──
    html.off("click.uesrpg", ".conjure-clear-btn").on("click.uesrpg", ".conjure-clear-btn", async (ev) => {
      ev.preventDefault();
      if (!sheet.isEditable) return;

      const clearType = ev.currentTarget.dataset.conjureClear;
      if (!clearType) return;

      const updateData = {};
      if (clearType === "item") {
        updateData["system.engine.conjure.itemUuid"] = "";
        updateData["system.engine.conjure.itemLabel"] = "";
      } else if (clearType === "actor") {
        updateData["system.engine.conjure.actorUuid"] = "";
        updateData["system.engine.conjure.actorLabel"] = "";
      }

      logDebug("Conjure clear", { clearType });
      await sheet.item.update(updateData);
    });

    // ── Conjure: Drag-drop support for item/actor UUID fields ──
    const dropTargets = html.find(".conjure-drop-target");
    dropTargets.each(function () {
      const input = this;
      const dropType = input.dataset.conjureDrop; // "item" or "actor"
      if (!dropType) return;

      input.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "link";
      });

      input.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        if (!sheet.isEditable) return;

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

          logDebug("Conjure item drop", { uuid, label });
          await sheet.item.update({
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

          logDebug("Conjure actor drop", { uuid, label });
          await sheet.item.update({
            "system.engine.conjure.actorUuid": uuid,
            "system.engine.conjure.actorLabel": label
          });
        } else {
          ui.notifications.warn(`Expected a ${dropType === "item" ? "Item" : "Actor"} drop, got ${data.type ?? "unknown"}.`);
        }
      });
    });

    // ── QA Tab: Validate ──
    html.off("click.uesrpg", "[data-action='validate-spell']").on("click.uesrpg", "[data-action='validate-spell']", (ev) => {
      ev.preventDefault();
      const result = validateSpellConfig(sheet.item);
      const html_output = formatSpellValidationMessage(result);
      const container = html.find(".spell-validation-output");
      container.html(html_output);
    });

    // ── QA Tab: Preview Resolved Profile ──
    html.off("click.uesrpg", "[data-action='preview-profile']").on("click.uesrpg", "[data-action='preview-profile']", async (ev) => {
      ev.preventDefault();
      const container = html.find(".spell-profile-preview");

      const actor = sheet.item?.parent;
      if (!actor || actor.documentName !== "Actor") {
        container.html('<span style="color: #c33;">Spell must be owned by an actor to preview the resolved profile.</span>');
        return;
      }

      try {
        // Dynamic import to avoid circular dependency in non-spell contexts
        const { resolveSpellProfile } = await import("../../../../core/magic/spell-profile.js");
        const profile = resolveSpellProfile(sheet.item, actor);
        container.text(JSON.stringify(profile, null, 2));
      } catch (err) {
        container.html(`<span style="color: #c33;">Error resolving profile: ${err.message}</span>`);
        console.error("UESRPG | Spell profile preview error", err);
      }
    });
  }

  // ── Damage Instances CRUD (spells only) ──
  if (sheet.item && sheet.item.type === "spell") {
    html.off("click.uesrpg", "[data-action='add-damage-instance']").on("click.uesrpg", "[data-action='add-damage-instance']", async (ev) => {
      ev.preventDefault();
      if (!sheet.isEditable) return;

      const instances = foundry.utils.deepClone(sheet.item.system?.damageInstances ?? []);
      instances.push({ formula: "", type: "none", label: "" });

      await sheet.item.update({ "system.damageInstances": instances });
    });

    html.off("click.uesrpg", "[data-action='remove-damage-instance']").on("click.uesrpg", "[data-action='remove-damage-instance']", async (ev) => {
      ev.preventDefault();
      if (!sheet.isEditable) return;

      const index = parseInt(ev.currentTarget.dataset.index, 10);
      if (isNaN(index)) return;

      const instances = foundry.utils.deepClone(sheet.item.system?.damageInstances ?? []);
      instances.splice(index, 1);

      await sheet.item.update({ "system.damageInstances": instances });
    });
  }

  // Delegate to sub-registrars
  registerContainmentListeners(sheet, html);
  registerModifierListeners(sheet, html);
  registerUsageListeners(sheet, html);
  registerEffectListeners(sheet, html);
}
