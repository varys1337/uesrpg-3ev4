import { SPECIAL_ACTIONS } from "../../core/config/special-actions.js";
import { prepareItemSheetData } from "./item/prepare.js";
import { registerItemSheetListeners } from "./item/listeners/index.js";
import { renderFieldsForElement, renderConditionFieldsForElement } from "./item/listeners/rule-elements.js";
import { validateScalingLevels, formatValidationMessage } from "../../core/magic/spell-config.js";
import { isDebugEnabled } from "../../utils/debug.js";

/**
 * Extend the basic foundry.appv1.sheets.ItemSheet with some very simple modifications
 * @extends {foundry.appv1.sheets.ItemSheet}
 */
export class SimpleItemSheet extends foundry.appv1.sheets.ItemSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["worldbuilding", "sheet", "item"],
      width: 520,
      height: 600,  // Increased default height to ensure content is visible
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" }],
      // Explicitly keep core ItemSheet behavior deterministic.
      // Some worlds/users run with non-default sheet settings; Combat Style editing relies on submit-on-close.
      submitOnClose: true,
      dragDrop: [
        {
          dragSelector: ".item",
          dropSelector: null
        }
      ]
    });
  }

  /* -------------------------------------------- */

  /** @override */
  get template() {
    const path = "systems/uesrpg-3ev4/templates";
    return `${path}/${this.item.type}-sheet.html`;
  }

  /* -------------------------------------------- */

  /** @override */
  async getData() {
    const data = await super.getData();
    return await prepareItemSheetData(this, data);
  }

  /* -------------------------------------------- */

  /** @override */
  async _updateObject(event, formData) {
    // ------------------------------------------------------------
    // Other Traits selection (checkbox pill UI)
    // ------------------------------------------------------------
    // We accept BOTH:
    // 1) the new checkbox-style inputs: qualitiesTraits.toggle.<key>
    // 2) the older <select multiple name="system.qualitiesTraits"> value
    // Then we normalize into system.qualitiesTraits (array of keys).
    const selectedTraits = new Set();

    // (2) Legacy multiselect (keep compatible in case a world has older templates cached)
    if (Object.prototype.hasOwnProperty.call(formData, "system.qualitiesTraits")) {
      const raw = formData["system.qualitiesTraits"];
      if (Array.isArray(raw)) raw.filter(Boolean).forEach(v => selectedTraits.add(String(v)));
      else if (typeof raw === "string" && raw.trim()) selectedTraits.add(raw.trim());
    }

    // (1) New checkbox toggles
    const traitsTogglePrefix = "qualitiesTraits.toggle.";
    for (const [k, v] of Object.entries(formData)) {
      if (!k.startsWith(traitsTogglePrefix)) continue;
      const key = k.slice(traitsTogglePrefix.length);
      if (v) selectedTraits.add(key);
      delete formData[k];
    }

    // Persist deterministically (sorted keys)
    formData["system.qualitiesTraits"] = Array.from(selectedTraits).filter(Boolean).sort((a, b) => a.localeCompare(b));

    // Extract structured qualities helper fields into system.qualitiesStructured.
    // Use a Map so toggle+value for the same key can be merged into a single entry.
    const structuredMap = new Map();
    const togglePrefix = "qualitiesStructured.toggle.";
    const valuePrefix = "qualitiesStructured.value.";

    // Reach mirroring: header Reach must mirror Structured Qualities (Reach hasValue).
    // Source of truth precedence: structured Reach (if provided) > system.reach.
    let reachFromStructured = null;
    let reachFromSystem = null;
    if (Object.prototype.hasOwnProperty.call(formData, "system.reach")) {
      reachFromSystem = formData["system.reach"];
    }

    for (const [k, v] of Object.entries(formData)) {
      if (k.startsWith(togglePrefix)) {
        const key = k.slice(togglePrefix.length);
        if (v) structuredMap.set(key, { key });
        delete formData[k];
        continue;
      }

      if (k.startsWith(valuePrefix)) {
        const key = k.slice(valuePrefix.length);
        const num = Number(v);
        if (!Number.isNaN(num) && num !== 0) {
          if (key === "reach") reachFromStructured = num;
          structuredMap.set(key, { key, value: num });
        }
        delete formData[k];
      }
    }

    const structured = Array.from(structuredMap.values());
    // ------------------------------------------------------------
    // Runed quality (RAW): On successful creation, armor/weapon gains Magic.
    // Armor additionally gains +1 Magic AR. We implement this as a safe,
    // idempotent sheet-level enforcement when Runed is checked:
    //  - Ensure Magic quality is present.
    //  - Ensure armor system.magic_ar is at least 1.
    // This avoids stacking and avoids destructive removal when unchecked.
    // ------------------------------------------------------------
    const hasRuned = structured.some(q => q && q.key === "runed");
    if (hasRuned) {
      // Ensure Magic quality exists
      const hasMagic = structured.some(q => q && q.key === "magic");
      if (!hasMagic) structured.push({ key: "magic" });

      // Armor: ensure Magic AR >= 1
      if (this.item?.type === "armor") {
        const currentMagicAR = Number(formData["system.magic_ar"] ?? this.item.system?.magic_ar ?? 0);
        if (!Number.isNaN(currentMagicAR) && currentMagicAR < 1) {
          formData["system.magic_ar"] = 1;
        }
      }
    }


    // Reconcile Reach between header field and structured list.
    const reachValue = (reachFromStructured != null) ? reachFromStructured : (() => {
      const n = Number(reachFromSystem);
      return (!Number.isNaN(n) && n !== 0) ? n : null;
    })();

    // Remove any existing reach entries then re-add if present
    for (let i = structured.length - 1; i >= 0; i--) {
      if (structured[i] && structured[i].key === "reach") structured.splice(i, 1);
    }
    if (reachValue != null) {
      structured.push({ key: "reach", value: reachValue });
      formData["system.reach"] = reachValue;
    } else {
      formData["system.reach"] = "";
    }

    // Weapon Reload mirroring:
    // - The weapon sheet exposes a dedicated Reload AP Cost field (system.reloadState.reloadAPCost).
    // - Combat automation derives reloadState from the structured Reload quality when present.
    // - When the Reload field is editable (Manual Base Stats), keep both in sync.
    if (Object.prototype.hasOwnProperty.call(formData, "system.reloadState.reloadAPCost") && this.item?.type === "weapon") {
      const raw = Number(formData["system.reloadState.reloadAPCost"]);
      const reloadAPCost = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
      formData["system.reloadState.reloadAPCost"] = reloadAPCost;
      formData["system.reloadState.requiresReload"] = reloadAPCost > 0;

      // Remove any existing structured Reload entries (case-insensitive), then re-add if present.
      for (let i = structured.length - 1; i >= 0; i--) {
        const k = String(structured?.[i]?.key ?? "").toLowerCase();
        if (k === "reload") structured.splice(i, 1);
      }
      if (reloadAPCost > 0) structured.push({ key: "reload", value: reloadAPCost });
    }

    // Deterministic ordering is useful for JSON exports/diffs.
    structured.sort((a, b) => (a.key || "").localeCompare(b.key || ""));

    // IMPORTANT: In AppV1 sheets, formData is a flat object whose keys use dot-notation.
    // Do NOT use setProperty here because it will create nested objects and may clobber other system fields.
    formData["system.qualitiesStructured"] = structured;

    // ------------------------------------------------------------
    // Activation Damage Qualities (Talents/Traits/Powers)
    // ------------------------------------------------------------
    const activationQualitiesPresent = Object.prototype.hasOwnProperty.call(formData, "activationDamageQualities.present");
    if (activationQualitiesPresent) {
      delete formData["activationDamageQualities.present"];

      const activationTraits = new Set();
      const activationStructuredMap = new Map();

      const aTraitsPrefix = "activationDamageQualitiesTraits.toggle.";
      const aTogglePrefix = "activationDamageQualitiesStructured.toggle.";
      const aValuePrefix = "activationDamageQualitiesStructured.value.";

      for (const [k, v] of Object.entries(formData)) {
        if (k.startsWith(aTraitsPrefix)) {
          const key = k.slice(aTraitsPrefix.length);
          if (v) activationTraits.add(key);
          delete formData[k];
        }
      }

      for (const [k, v] of Object.entries(formData)) {
        if (k.startsWith(aTogglePrefix)) {
          const key = k.slice(aTogglePrefix.length);
          if (v) activationStructuredMap.set(key, { key });
          delete formData[k];
          continue;
        }

        if (k.startsWith(aValuePrefix)) {
          const key = k.slice(aValuePrefix.length);
          const num = Number(v);
          if (!Number.isNaN(num) && num !== 0) {
            activationStructuredMap.set(key, { key, value: num });
          }
          delete formData[k];
        }
      }

      const activationStructured = Array.from(activationStructuredMap.values());
      activationStructured.sort((a, b) => (a.key || "").localeCompare(b.key || ""));

      formData["system.activation.damage.qualitiesStructured"] = activationStructured;
      formData["system.activation.damage.qualitiesTraits"] = Array.from(activationTraits)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    }

    // ------------------------------------------------------------
    // Damage Instances normalization (spells + weapons)
    // ------------------------------------------------------------
    if (this.item?.type === "spell" || this.item?.type === "weapon") {
      const diPrefix = "system.damageInstances.";
      const diIndices = new Set();
      const diEntries = new Map();
      let foundDIKeys = false;

      for (const key of Object.keys(formData)) {
        if (!key.startsWith(diPrefix)) continue;
        foundDIKeys = true;

        const remainder = key.slice(diPrefix.length);
        const dotIdx = remainder.indexOf(".");
        if (dotIdx < 0) continue;

        const idx = remainder.slice(0, dotIdx);
        const field = remainder.slice(dotIdx + 1);
        diIndices.add(idx);

        if (!diEntries.has(idx)) diEntries.set(idx, {});
        diEntries.get(idx)[field] = formData[key];
        delete formData[key];
      }

      if (foundDIKeys) {
        formData["system.damageInstances"] = Array.from(diIndices)
          .sort((a, b) => Number(a) - Number(b))
          .map(idx => {
            const entry = diEntries.get(idx) ?? {};
            return {
              formula: String(entry.formula ?? ""),
              type: String(entry.type ?? "none"),
              label: String(entry.label ?? "")
            };
          });
      }
    }

    // ------------------------------------------------------------
    // Combat Style: normalize Special Action known toggles
    // ------------------------------------------------------------
    if (this.item?.type === "combatStyle") {
      // Checkboxes only submit checked fields; ensure missing keys are written as false
      // so automation can rely on a deterministic map.
      for (const sa of SPECIAL_ACTIONS) {
        const k = `system.specialAdvantages.${sa.id}`;
        const has = Object.prototype.hasOwnProperty.call(formData, k);
        formData[k] = has ? Boolean(formData[k]) : false;
      }

      // Trained Equipment entries (5 slots)
      // IMPORTANT:
      // - Some older worlds/items may have trainedEquipment stored as a non-array type.
      // - Dot-path updates like system.trainedEquipment.0 will NOT reliably coerce the backing
      //   data into an Array in those cases.
      // - Persist the whole lane as an Array to guarantee deterministic storage.
      const te = [];
      for (let i = 0; i < 5; i++) {
        const key = `system.trainedEquipment.${i}`;
        te.push(String(formData[key] ?? this.item.system?.trainedEquipment?.[i] ?? "").trim());
        // Remove per-index keys so only the canonical array write remains.
        delete formData[key];
      }
      formData["system.trainedEquipment"] = te;
    }

    // ------------------------------------------------------------
    // Spell Scaling Validation
    // ------------------------------------------------------------
    if (this.item?.type === "spell") {
      const DEBUG = isDebugEnabled("spellCastingDebug");

      // Extract scaling levels from dot-notation formData
      // AppV1 submits: system.scaling.levels.0.level, system.scaling.levels.0.cost, etc.
      const scalingPrefix = "system.scaling.levels.";
      const levelIndices = new Set();
      const levelEntries = new Map();
      let foundScalingKeys = false;

      for (const key of Object.keys(formData)) {
        if (!key.startsWith(scalingPrefix)) continue;
        foundScalingKeys = true;
        
        const remainder = key.slice(scalingPrefix.length);
        const dotIdx = remainder.indexOf(".");
        if (dotIdx < 0) continue;
        
        const idx = remainder.slice(0, dotIdx);
        const field = remainder.slice(dotIdx + 1);
        levelIndices.add(idx);
        
        if (!levelEntries.has(idx)) {
          levelEntries.set(idx, {});
        }
        const entry = levelEntries.get(idx);
        foundry.utils.setProperty(entry, field, formData[key]);
        delete formData[key];
      }

      const fallbackDurationUnit = formData["system.duration.unit"] || this.item.system?.duration?.unit || "instant";

      // Reconstruct levels array in index order (keep form order stable)
      const levels = Array.from(levelIndices)
        .sort((a, b) => Number(a) - Number(b))
        .map(idx => {
          const entry = levelEntries.get(idx) ?? {};

          // Ensure duration structure exists for validation and persistence.
          if (!entry.duration || typeof entry.duration !== "object") {
            entry.duration = { value: 0, unit: fallbackDurationUnit };
          } else {
            if (!Object.prototype.hasOwnProperty.call(entry.duration, "value")) entry.duration.value = 0;
            if (!Object.prototype.hasOwnProperty.call(entry.duration, "unit")) entry.duration.unit = fallbackDurationUnit;
          }

          // Coerce numerics for stable storage.
          if (Object.prototype.hasOwnProperty.call(entry, "level")) entry.level = Number(entry.level) || 0;
          if (Object.prototype.hasOwnProperty.call(entry, "cost")) entry.cost = Number(entry.cost) || 0;
          if (Object.prototype.hasOwnProperty.call(entry.duration, "value")) {
            entry.duration.value = Number(entry.duration.value) || 0;
          }

          return entry;
        });

      if (foundScalingKeys) {
        formData["system.scaling.levels"] = levels;
        if (DEBUG) {
          console.log("UESRPG | Spell scaling form normalization", {
            submitOnChange: this.options.submitOnChange,
            levelCount: levels.length,
            levels
          });
        }
      }

      // ── Engine Recipe array normalization (dot-notation → array) ──
      const recipePrefix = "system.engine.effects.recipes.";
      const recipeIndices = new Set();
      const recipeEntries = new Map();
      let foundRecipeKeys = false;

      for (const key of Object.keys(formData)) {
        if (!key.startsWith(recipePrefix)) continue;
        foundRecipeKeys = true;

        const remainder = key.slice(recipePrefix.length);
        const dotIdx = remainder.indexOf(".");
        if (dotIdx < 0) continue;

        const idx = remainder.slice(0, dotIdx);
        const field = remainder.slice(dotIdx + 1);
        recipeIndices.add(idx);

        if (!recipeEntries.has(idx)) {
          recipeEntries.set(idx, {});
        }
        recipeEntries.get(idx)[field] = formData[key];
        delete formData[key];
      }

      if (foundRecipeKeys) {
        const recipes = Array.from(recipeIndices)
          .sort((a, b) => Number(a) - Number(b))
          .map(idx => {
            const entry = recipeEntries.get(idx) ?? {};
            return {
              key: String(entry.key ?? ""),
              mode: String(entry.mode ?? "add"),
              value: String(entry.value ?? ""),
              target: String(entry.target ?? "target"),
              label: String(entry.label ?? "")
            };
          });
        formData["system.engine.effects.recipes"] = recipes;
      }

      // ── OverTime Entries array normalization (dot-notation → array) ──
      const otPrefix = "system.overTimeEntries.";
      const otIndices = new Set();
      const otEntries = new Map();
      let foundOTKeys = false;

      for (const key of Object.keys(formData)) {
        if (!key.startsWith(otPrefix)) continue;
        foundOTKeys = true;

        const remainder = key.slice(otPrefix.length);
        const dotIdx = remainder.indexOf(".");
        if (dotIdx < 0) continue;

        const idx = remainder.slice(0, dotIdx);
        const field = remainder.slice(dotIdx + 1);
        otIndices.add(idx);

        if (!otEntries.has(idx)) otEntries.set(idx, {});
        otEntries.get(idx)[field] = formData[key];
        delete formData[key];
      }

      if (foundOTKeys) {
        formData["system.overTimeEntries"] = Array.from(otIndices)
          .sort((a, b) => Number(a) - Number(b))
          .map(idx => {
            const e = otEntries.get(idx) ?? {};
            return {
              trigger: String(e.trigger ?? "turnStart"),
              cadenceEvery: Number(e.cadenceEvery) || 1,
              cadenceUnit: String(e.cadenceUnit ?? "rounds"),
              payloadType: String(e.payloadType ?? "damage"),
              formula: String(e.formula ?? "1d6"),
              damageType: String(e.damageType ?? "fire"),
              saveKey: String(e.saveKey ?? ""),
              saveTN: Number(e.saveTN) || 0,
              saveSuccess: String(e.saveSuccess ?? "endEffect"),
              saveFailure: String(e.saveFailure ?? "damage"),
              maxTicks: e.maxTicks != null && e.maxTicks !== "" ? Number(e.maxTicks) || null : null,
              label: String(e.label ?? ""),
              chatLog: e.chatLog !== false && e.chatLog !== "false"
            };
          });
      }

      if (levels.length > 0 && !event?.uesrpgSkipScalingValidation) {
        // Get context for validation
        const spellHasDamage = Boolean(
          formData["system.damageFormula"] || 
          this.item.system?.damageFormula
        );
        const baseDurationUnit = 
          formData["system.duration.unit"] || 
          this.item.system?.duration?.unit || 
          "instant";

        // Validate
        const result = validateScalingLevels(levels, {
          spellHasDamage,
          baseDurationUnit
        });

        // Block save on errors
        if (!result.valid) {
          const message = formatValidationMessage(result);
          await Dialog.prompt({
            title: "Spell Scaling Validation Failed",
            content: `<p>Cannot save spell with invalid scaling levels:</p>${message}`,
            label: "OK",
            callback: () => {}
          });
          return; // Block save
        }

        // Confirm warnings
        if (result.warnings.length > 0) {
          const message = formatValidationMessage(result);
          const proceed = await Dialog.confirm({
            title: "Spell Scaling Warnings",
            content: `<p>Scaling levels have warnings:</p>${message}<p>Proceed with save?</p>`,
            yes: () => true,
            no: () => false,
            defaultYes: false
          });
          
          if (!proceed) {
            return; // User canceled
          }
        }
      }
    }

    return super._updateObject(event, formData);
  }

  /* -------------------------------------------- */

  /** @override */
  async _onChangeInput(event) {
    if (this.item?.type === "spell") {
      const target = event?.target;
      if (target?.dataset?.scalingInput === "true") {
        const DEBUG = isDebugEnabled("spellCastingDebug");
        if (DEBUG) {
          console.log("UESRPG | Spell scaling input change (submitOnChange)", {
            name: target?.name,
            value: target?.value
          });
        }
        event.uesrpgSkipScalingValidation = true;
        return this._onSubmit(event, { preventRender: true, preventClose: true });
      }
    }

    return super._onChangeInput(event);
  }

  /* -------------------------------------------- */

  /** @override */
  setPosition(options = {}) {
    const position = super.setPosition(options);
    // Let CSS flexbox handle heights naturally
    // Removed old height calculation that breaks scrolling
    return position;
  }

  /* -------------------------------------------- */

  /**
   * @override
   * Preserve client-side UI state across re-renders:
   *  - Which rule-element items are expanded (Automation tab)
   *  - Which <details> elements are open (Spell sheet)
   *
   * Every data mutation (setFlag / update) triggers a full re-render that
   * replaces the DOM.  Expanded state and <details>.open are purely DOM-based
   * and would otherwise be lost, causing the sheet to "snap shut" on every
   * option change.
   */
  async _render(force, options) {
    // ── Snapshot UI state before DOM is replaced ──────────────────
    const expandedREIds = new Set();
    const openDetails = new Set();
    const el = this.element?.[0];

    // Scroll position preservation: snapshot scrollTop of the scrollable
    // container (.sheet-body) before the DOM is replaced, so toggles and
    // submitOnChange re-renders don't reset the user's viewport.
    let savedScrollTop = null;
    let savedActiveTab = null;

    if (el) {
      // Capture the active tab key so we only restore scroll for the same tab.
      const activeTabEl = el.querySelector(".tab.active");
      savedActiveTab = activeTabEl?.dataset?.tab ?? null;

      const scrollContainer = el.querySelector(".sheet-body");
      if (scrollContainer) {
        savedScrollTop = scrollContainer.scrollTop;
      }

      // Rule Element expand state
      el.querySelectorAll(".re-item").forEach(li => {
        const body = li.querySelector(".re-item-body");
        if (body && body.style.display !== "none") {
          const reId = li.dataset.reId;
          if (reId) expandedREIds.add(reId);
        }
      });

      // <details> open state (spell scaling / advanced options)
      el.querySelectorAll("details").forEach(d => {
        if (d.open) {
          // Use data-uesrpg attribute if present; fall back to first class name
          const key = d.dataset.uesrpg || d.className.split(/\s+/)[0] || "";
          if (key) openDetails.add(key);
        }
      });
    }

    // ── Render (replaces DOM, calls activateListeners) ────────────
    await super._render(force, options);

    // ── Restore UI state on the fresh DOM ─────────────────────────
    const newEl = this.element?.[0];
    if (!newEl) return;

    // Restore expanded Rule Elements
    if (expandedREIds.size > 0) {
      expandedREIds.forEach(reId => {
        const li = newEl.querySelector(`.re-item[data-re-id="${reId}"]`);
        if (!li) return;

        const body = li.querySelector(".re-item-body");
        const icon = li.querySelector(".re-item-expand i");
        if (body) body.style.display = "";
        if (icon) {
          icon.classList.remove("fa-chevron-down");
          icon.classList.add("fa-chevron-up");
        }

        // Re-inflate dynamically rendered type-specific fields
        const $li = $(li);
        renderFieldsForElement($li, this.item);
        renderConditionFieldsForElement($li, this.item);
      });
    }

    // Restore open <details>
    if (openDetails.size > 0) {
      openDetails.forEach(key => {
        const d = newEl.querySelector(`details[data-uesrpg="${key}"]`)
               || newEl.querySelector(`details.${CSS.escape(key)}`);
        if (d) d.open = true;
      });
    }

    // Restore scroll position if the same tab is still active.
    if (savedScrollTop != null) {
      const newActiveTab = newEl.querySelector(".tab.active");
      const newTabKey = newActiveTab?.dataset?.tab ?? null;
      if (!savedActiveTab || savedActiveTab === newTabKey) {
        const scrollContainer = newEl.querySelector(".sheet-body");
        if (scrollContainer) {
          scrollContainer.scrollTop = savedScrollTop;
        }
      }
    }
  }

  /* -------------------------------------------- */

  /** @override */
  async activateListeners(html) {
    super.activateListeners(html);
    registerItemSheetListeners(this, html);
  }

  /* -------------------------------------------- */

  /**
   * @override
   * Handle drag-start for contained items in container sheets.
   * The default ItemSheet._onDragStart creates drag data for the container itself,
   * but we need drag data for the actor-owned contained item so it can be dropped
   * onto actor sheets to remove it from the container.
   */
  _onDragStart(event) {
    // Only intercept for container-type item sheets
    if (this.item?.type !== "container" || !this.actor) {
      return super._onDragStart(event);
    }

    const row = event.currentTarget?.closest?.("[data-item-id]");
    const itemId = row?.dataset?.itemId;
    if (!itemId) {
      return super._onDragStart(event);
    }

    // Look up the actor-owned item (contained items are owned by the actor, not the container)
    const actorItem = this.actor.items.get(itemId);
    if (!actorItem) {
      return super._onDragStart(event);
    }

    // Set drag data in the format Foundry and our actor sheets expect
    const dragData = {
      type: "Item",
      uuid: actorItem.uuid
    };
    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }

  /* -------------------------------------------- */

  /** @override */
  async _onDrop(event) {
    event.preventDefault();

    // Only handle drops for container sheets
    if (this.item.type !== "container") {
      return super._onDrop?.(event);
    }

    // Must be owned by an actor
    if (!this.item.isOwned || !this.actor) {
      ui.notifications?.warn("Containers must be owned by an Actor to accept dropped items.");
      return;
    }

    // Permission check
    if (!this.options?.editable || !this.actor.isOwner) {
      ui.notifications?.warn("You do not have permission to modify this container.");
      return;
    }

    // Parse drop data using Foundry v13 standard API
    const data = TextEditor.getDragEventData(event);

    // Only handle Item drops
    if (data?.type !== "Item") {
      return super._onDrop?.(event);
    }

    // Import the handler
    const { onDropItemIntoContainer } = await import("./item/listeners/containment.js");
    return onDropItemIntoContainer(this, data);
  }

  /* -------------------------------------------- */
  /* Handlers (delegated to modules - kept for backwards compatibility) */
  /* -------------------------------------------- */

  // All handler methods have been moved to:
  // - src/ui/sheets/item/listeners/modifiers.js
  // - src/ui/sheets/item/listeners/usage.js
  // - src/ui/sheets/item/listeners/containment.js
  // - src/ui/sheets/item/listeners/effects.js
}
