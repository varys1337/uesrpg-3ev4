/**
 * src/ui/sheets/item/normalize-item-form-data.js
 *
 * Pure normalization of item-sheet form data before persisting.
 * Extracts form-data cleanup into a shared, side-effect free normalizer
 * (no document mutations, no UI dialogs).
 *
 * Usage:
 *   import { normalizeItemFormData, validateSpellScaling } from "./item/normalize-item-form-data.js";
 *   const { scalingLevels } = normalizeItemFormData(item, flatFormData);
 *   if (item.type === "spell" && scalingLevels.length && !skipValidation) {
 *     const blocked = await validateSpellScaling(item, flatFormData, scalingLevels);
 *     if (blocked) return;
 *   }
 *   await item.update(flatFormData);  // or super._updateObject(event, flatFormData)
 */

import { SPECIAL_ACTIONS } from "../../../core/combat/combat-style-utils.js";
import { validateScalingLevels, formatValidationMessage } from "../../../core/magic/spell-config.js";
import { alertDialog, confirmDialog } from "../../../utils/dialog-v2-helper.js";

/* ═══════════════════════════════════════════════════════════════════════════
 * normalizeItemFormData — PURE normalization, no I/O
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Normalize a flat dot‑notation formData object produced by an item sheet.
 *
 * Mutates `formData` in place: deletes transient UI keys, writes canonical
 * `system.*` keys that Foundry's Document.update() can persist.
 *
 * @param {Item} item  — the live Item document (read‑only; used for type checks
 *                        and fallback system data)
 * @param {object} formData — flat `{ "system.x.y": value }` object (mutated)
 * @returns {{ scalingLevels: object[] }}  metadata the caller may need for
 *          post‑normalization validation
 */
export function normalizeItemFormData(item, formData) {
  const itemType = item?.type;

  // ──────────────────────────────────────────────────────────────
  // 1 & 2. Qualities (qualitiesTraits + qualitiesStructured)
  //   Only item types that carry these schema fields should receive
  //   this normalization. All others (skill, magicSkill, talent,
  //   trait, power, combatStyle, container, spell) are skipped to
  //   prevent injecting unknown fields into their DataModel updates.
  // ──────────────────────────────────────────────────────────────
  const QUALITIES_TYPES = new Set(["equipment", "scroll", "armor", "weapon", "ammunition"]);
  if (QUALITIES_TYPES.has(itemType)) {

  // 1. Other Traits selection (checkbox pill UI)
  // ──────────────────────────────────────────────────────────────
  const selectedTraits = new Set();

  // Legacy multiselect compat
  if (Object.prototype.hasOwnProperty.call(formData, "system.qualitiesTraits")) {
    const raw = formData["system.qualitiesTraits"];
    if (Array.isArray(raw)) raw.filter(Boolean).forEach(v => selectedTraits.add(String(v)));
    else if (typeof raw === "string" && raw.trim()) selectedTraits.add(raw.trim());
  }

  // New checkbox toggles
  const traitsTogglePrefix = "qualitiesTraits.toggle.";
  for (const [k, v] of Object.entries(formData)) {
    if (!k.startsWith(traitsTogglePrefix)) continue;
    const key = k.slice(traitsTogglePrefix.length);
    if (v) selectedTraits.add(key);
    delete formData[k];
  }

  formData["system.qualitiesTraits"] = Array.from(selectedTraits)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  // ──────────────────────────────────────────────────────────────
  // 2. Structured Qualities (core grid with hasValue support)
  // ──────────────────────────────────────────────────────────────
  const structuredMap = new Map();
  const togglePrefix = "qualitiesStructured.toggle.";
  const valuePrefix = "qualitiesStructured.value.";

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

  // Bridge legacy Runed checkbox to canonical structured qualities.
  if (Object.prototype.hasOwnProperty.call(formData, "system.runed")) {
    const rawRuned = formData["system.runed"];
    const runedChecked = rawRuned === true || rawRuned === "true" || rawRuned === "on" || rawRuned === 1 || rawRuned === "1";
    for (let i = structured.length - 1; i >= 0; i--) {
      if (String(structured?.[i]?.key ?? "").toLowerCase() === "runed") structured.splice(i, 1);
    }
    if (runedChecked) structured.push({ key: "runed" });
  }

  // Runed quality enforcement (RAW): ensures Magic quality + minimum Magic AR for armor
  const hasRuned = structured.some(q => q && q.key === "runed");
  formData["system.runed"] = hasRuned;
  if (hasRuned) {
    if (!structured.some(q => q && q.key === "magic")) {
      structured.push({ key: "magic" });
    }
    if (itemType === "armor") {
      const currentMagicAR = Number(
        formData["system.magic_ar"] ?? item.system?.magic_ar ?? 0
      );
      if (!Number.isNaN(currentMagicAR) && currentMagicAR < 1) {
        formData["system.magic_ar"] = 1;
      }
    }
  }

  // Reconcile Reach between header field and structured list
  const reachValue =
    reachFromStructured != null
      ? reachFromStructured
      : (() => {
          const n = Number(reachFromSystem);
          return !Number.isNaN(n) && n !== 0 ? n : null;
        })();

  for (let i = structured.length - 1; i >= 0; i--) {
    if (structured[i] && structured[i].key === "reach") structured.splice(i, 1);
  }
  if (reachValue != null) {
    structured.push({ key: "reach", value: reachValue });
    formData["system.reach"] = reachValue;
  } else {
    formData["system.reach"] = "";
  }

  // Weapon Reload mirroring
  if (
    Object.prototype.hasOwnProperty.call(formData, "system.reloadState.reloadAPCost") &&
    itemType === "weapon"
  ) {
    const raw = Number(formData["system.reloadState.reloadAPCost"]);
    const reloadAPCost = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
    formData["system.reloadState.reloadAPCost"] = reloadAPCost;
    formData["system.reloadState.requiresReload"] = reloadAPCost > 0;

    for (let i = structured.length - 1; i >= 0; i--) {
      if (String(structured?.[i]?.key ?? "").toLowerCase() === "reload") structured.splice(i, 1);
    }
    if (reloadAPCost > 0) structured.push({ key: "reload", value: reloadAPCost });
  }

  structured.sort((a, b) => (a.key || "").localeCompare(b.key || ""));
  formData["system.qualitiesStructured"] = structured;

  } // end QUALITIES_TYPES guard

  // ──────────────────────────────────────────────────────────────
  // 3. Activation Damage Qualities (Talents / Traits / Powers)
  // ──────────────────────────────────────────────────────────────
  if (Object.prototype.hasOwnProperty.call(formData, "activationDamageQualities.present")) {
    delete formData["activationDamageQualities.present"];

    const activationTraits = new Set();
    const activationStructuredMap = new Map();

    const aTraitsPrefix = "activationDamageQualitiesTraits.toggle.";
    const aTogglePrefix = "activationDamageQualitiesStructured.toggle.";
    const aValuePrefix = "activationDamageQualitiesStructured.value.";

    for (const [k, v] of Object.entries(formData)) {
      if (k.startsWith(aTraitsPrefix)) {
        if (v) activationTraits.add(k.slice(aTraitsPrefix.length));
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

  // ──────────────────────────────────────────────────────────────
  // 4. Damage Instances normalization (spells)
  // ──────────────────────────────────────────────────────────────
  if (itemType === "spell") {
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
            label: String(entry.label ?? ""),
          };
        });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 5. Combat Style normalization
  // ──────────────────────────────────────────────────────────────
  if (itemType === "combatStyle") {
    for (const sa of SPECIAL_ACTIONS) {
      const k = `system.specialAdvantages.${sa.id}`;
      formData[k] = Object.prototype.hasOwnProperty.call(formData, k)
        ? Boolean(formData[k])
        : false;
    }

    const te = [];
    for (let i = 0; i < 10; i++) {
      const key = `system.trainedEquipment.${i}`;
      te.push(String(formData[key] ?? item.system?.trainedEquipment?.[i] ?? "").trim());
      delete formData[key];
    }
    formData["system.trainedEquipment"] = te;
  }

  // ──────────────────────────────────────────────────────────────
  // 6. Spell: scaling levels + engine recipes + OverTime entries
  // ──────────────────────────────────────────────────────────────
  let scalingLevels = [];

  if (itemType === "spell") {
    const fallbackDurationUnit =
      formData["system.duration.unit"] || item.system?.duration?.unit || "instant";

    // ── Scaling levels (dot‑notation → array) ──
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
      if (!levelEntries.has(idx)) levelEntries.set(idx, {});
      foundry.utils.setProperty(levelEntries.get(idx), field, formData[key]);
      delete formData[key];
    }

    scalingLevels = Array.from(levelIndices)
      .sort((a, b) => Number(a) - Number(b))
      .map(idx => {
        const entry = levelEntries.get(idx) ?? {};
        if (!entry.duration || typeof entry.duration !== "object") {
          entry.duration = { value: 0, unit: fallbackDurationUnit };
        } else {
          if (!Object.prototype.hasOwnProperty.call(entry.duration, "value"))
            entry.duration.value = 0;
          if (!Object.prototype.hasOwnProperty.call(entry.duration, "unit"))
            entry.duration.unit = fallbackDurationUnit;
        }
        if (Object.prototype.hasOwnProperty.call(entry, "level"))
          entry.level = Number(entry.level) || 0;
        if (Object.prototype.hasOwnProperty.call(entry, "cost"))
          entry.cost = Number(entry.cost) || 0;
        if (Object.prototype.hasOwnProperty.call(entry.duration, "value"))
          entry.duration.value = Number(entry.duration.value) || 0;
        return entry;
      });

    if (foundScalingKeys) {
      formData["system.scaling.levels"] = scalingLevels;
    }

    // ── Engine Recipe array normalization ──
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
      if (!recipeEntries.has(idx)) recipeEntries.set(idx, {});
      recipeEntries.get(idx)[field] = formData[key];
      delete formData[key];
    }

    if (foundRecipeKeys) {
      formData["system.engine.effects.recipes"] = Array.from(recipeIndices)
        .sort((a, b) => Number(a) - Number(b))
        .map(idx => {
          const entry = recipeEntries.get(idx) ?? {};
          return {
            key: String(entry.key ?? ""),
            mode: String(entry.mode ?? "add"),
            value: String(entry.value ?? ""),
            target: String(entry.target ?? "target"),
            label: String(entry.label ?? ""),
          };
        });
    }

    // ── OverTime entries normalization ──
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
            maxTicks:
              e.maxTicks != null && e.maxTicks !== "" ? Number(e.maxTicks) || null : null,
            label: String(e.label ?? ""),
            chatLog: e.chatLog !== false && e.chatLog !== "false",
          };
        });
    }
  }

  return { scalingLevels };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * validateSpellScaling — async, with user‑facing dialogs
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Validate spell scaling levels and show blocking/warning dialogs.
 *
 * @param {Item} item — the spell item
 * @param {object} formData — flat formData (read‑only here; used for context)
 * @param {object[]} scalingLevels — levels array produced by normalizeItemFormData
 * @returns {Promise<boolean>} `true` if the save should be **blocked**
 */
export async function validateSpellScaling(item, formData, scalingLevels) {
  if (!scalingLevels.length) return false;

  const spellHasDamage = Boolean(
    formData["system.damageFormula"] || item.system?.damageFormula
  );
  const baseDurationUnit =
    formData["system.duration.unit"] || item.system?.duration?.unit || "instant";

  const result = validateScalingLevels(scalingLevels, {
    spellHasDamage,
    baseDurationUnit,
  });

  // Block save on errors
  if (!result.valid) {
    const message = formatValidationMessage(result);
    await alertDialog({
      title: "Spell Scaling Validation Failed",
      content: `<p>Cannot save spell with invalid scaling levels:</p>${message}`,
    });
    return true; // blocked
  }

  // Confirm warnings
  if (result.warnings.length > 0) {
    const message = formatValidationMessage(result);
    const proceed = await confirmDialog({
      title: "Spell Scaling Warnings",
      content: `<p>Scaling levels have warnings:</p>${message}<p>Proceed with save?</p>`,
    });
    if (!proceed) return true; // user canceled
  }

  return false; // not blocked
}
