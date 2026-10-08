/**
 * src/ui/sheets/item/normalize-item-form-data.js
 *
 * Pure normalization of item-sheet form data before persisting.
 * Extracts form-data cleanup into a shared, side-effect free normalizer
 * (no document mutations, no UI dialogs).
 *
 * Usage:
 *   import { normalizeItemFormData, validateSpellScaling } from "./normalize-item-form-data.js";
 *   const { scalingLevels } = normalizeItemFormData(item, flatFormData);
 *   if (item.type === "spell" && scalingLevels.length && !skipValidation) {
 *     const blocked = await validateSpellScaling(item, flatFormData, scalingLevels);
 *     if (blocked) return;
 *   }
 *   await item.update(flatFormData);  // or super._updateObject(event, flatFormData)
 */

import { SPECIAL_ACTIONS } from "../../../core/config/special-actions.js";
import {
  parseWeaponReachMax,
  parseWeaponReachMin,
} from "../../../core/homebrew/reach-length/weapon.js";
import { validateScalingLevels, formatValidationMessage } from "../../../core/magic/spell-config.js";
import { alertDialog, confirmDialog } from "../../../utils/dialog-v2-helper.js";
import { createDebugLogger } from "../../../utils/debug.js";
import { SOUL_GEM_TIERS } from "../../../core/enchanting/soul-gems.js";
import { _bool } from "../../../utils/coerce.js";
import { getScalingLevelsArray, normalizeScalingEntry } from "./spell-scaling-helpers.js";

const _shieldDebug = createDebugLogger("shieldDebug", "[UESRPG][ShieldDebug][NormalizeItemForm]");

/** Apply only submitted quality controls, retaining unrepresented qualities. */
function _normalizeQualityControls(formData, system, { traitPath, structuredPath, traitPrefix, togglePrefix, valuePrefix, excludeReach = false }) {
  const rawTraits = foundry.utils.getProperty(system, traitPath);
  const traitsSubmitted = Object.hasOwn(formData, `system.${traitPath}`) || Object.keys(formData).some((path) => path.startsWith(traitPrefix));
  if (traitsSubmitted && rawTraits != null && !Array.isArray(rawTraits) && typeof rawTraits !== "string") {
    throw new Error(`Legacy field system.${traitPath} requires the item sheet compatibility migration.`);
  }
  const traits = new Set(Array.isArray(rawTraits) ? rawTraits : (rawTraits ? [String(rawTraits)] : []));
  let traitsChanged = Object.hasOwn(formData, `system.${traitPath}`);
  if (traitsChanged) {
    traits.clear();
    const raw = formData[`system.${traitPath}`];
    for (const key of Array.isArray(raw) ? raw : (raw ? [raw] : [])) traits.add(String(key));
  }
  const existing = foundry.utils.getProperty(system, structuredPath);
  const structuredSubmitted = Object.hasOwn(formData, `system.${structuredPath}`)
    || Object.keys(formData).some((path) => path.startsWith(togglePrefix) || path.startsWith(valuePrefix))
    || (structuredPath === "qualitiesStructured" && (Object.hasOwn(formData, "system.runed") || Object.hasOwn(formData, "system.reloadState.reloadAPCost")));
  if (structuredSubmitted && existing != null && !Array.isArray(existing)) {
    throw new Error(`Legacy field system.${structuredPath} requires the item sheet compatibility migration.`);
  }
  let structured = foundry.utils.deepClone(Array.isArray(existing) ? existing : []);
  let structuredChanged = Object.hasOwn(formData, `system.${structuredPath}`);
  if (structuredChanged) {
    const submitted = formData[`system.${structuredPath}`];
    if (!Array.isArray(submitted)) throw new Error(`Field system.${structuredPath} must be an array.`);
    structured = submitted.map((entry) => {
      const previous = entry?.key && structured.find((quality) => quality?.key === entry.key);
      return previous ? { ...previous, ...foundry.utils.deepClone(entry) } : foundry.utils.deepClone(entry);
    });
  }
  const setQuality = (key, changes) => {
    if (changes === null) {
      structured = structured.filter((entry) => entry?.key !== key);
      return;
    }
    const index = structured.findIndex((entry) => entry?.key === key);
    if (index < 0) structured.push({ key, ...changes });
    else structured[index] = { ...structured[index], ...changes };
  };
  for (const [path, value] of Object.entries(formData)) {
    if (path.startsWith(traitPrefix)) {
      const key = path.slice(traitPrefix.length);
      if (_bool(value)) traits.add(key);
      else traits.delete(key);
      traitsChanged = true;
    } else if (path.startsWith(togglePrefix)) {
      const key = path.slice(togglePrefix.length);
      if (excludeReach && key === "reach") { delete formData[path]; continue; }
      setQuality(key, _bool(value) ? {} : null);
      structuredChanged = true;
    } else if (path.startsWith(valuePrefix)) {
      const key = path.slice(valuePrefix.length);
      if (excludeReach && key === "reach") { delete formData[path]; continue; }
      const number = Number(value);
      if (Number.isFinite(number) && number !== 0) {
        setQuality(key, { value: number });
      } else setQuality(key, null);
      structuredChanged = true;
    } else continue;
    delete formData[path];
  }
  if (traitsChanged) formData[`system.${traitPath}`] = Array.from(traits).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
  return { structured, structuredChanged };
}

/** Merge indexed native form fields into source entries; absence never deletes. */
function _mergeIndexedFormEntries(formData, path, existing, normalizeEntry) {
  const prefix = `${path}.`;
  const entries = new Map();
  for (const key of Object.keys(formData)) {
    if (!key.startsWith(prefix)) continue;
    const match = key.slice(prefix.length).match(/^(\d+)\.(.+)$/);
    if (!match) continue;
    const index = Number(match[1]);
    if (!entries.has(index)) entries.set(index, {});
    foundry.utils.setProperty(entries.get(index), match[2], formData[key]);
    delete formData[key];
  }
  if (!entries.size) return null;
  if (existing != null && !Array.isArray(existing)) throw new Error(`Legacy field ${path} requires the item sheet compatibility migration.`);
  const merged = foundry.utils.deepClone(Array.isArray(existing) ? existing : []);
  for (const [index, changes] of [...entries].sort(([left], [right]) => left - right)) {
    if (index > merged.length) throw new Error(`Cannot save sparse item array ${path}.${index}.`);
    if (merged[index] != null && (typeof merged[index] !== "object" || Array.isArray(merged[index]))) {
      throw new Error(`Legacy entry ${path}.${index} requires the item sheet compatibility migration.`);
    }
    const source = merged[index] ?? {};
    const entry = foundry.utils.mergeObject(source, changes, { inplace: false });
    const normalized = normalizeEntry(entry);
    const submitted = {};
    // Normalize submitted leaves only. Other authored values, including
    // missing legacy properties, must not become defaults on a partial edit.
    for (const field of Object.keys(foundry.utils.flattenObject(changes))) {
      foundry.utils.setProperty(submitted, field, foundry.utils.getProperty(normalized, field));
    }
    merged[index] = foundry.utils.mergeObject(source, submitted, { inplace: false });
  }
  formData[path] = merged;
  return merged;
}

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
  const source = item?.toObject?.(true) ?? item ?? {};
  const system = source.system ?? {};
  let soulEnergyIssue = null;
  if (Object.prototype.hasOwnProperty.call(formData, "system.enc")) {
    const enc = Number(formData["system.enc"]);
    formData["system.enc"] = Number.isFinite(enc) ? Math.max(0, enc) : 0;
  }
  const isShieldLaneDoc = String(itemType ?? "").toLowerCase() === "shield"
    || (String(itemType ?? "").toLowerCase() === "armor" && (
      item?.system?.isShield === true
      || String(item?.system?.item_cat ?? "").toLowerCase() === "shield"
      || String(item?.system?.category ?? "").toLowerCase() === "shield"
    ));
  if (isShieldLaneDoc) {
    _shieldDebug("normalize start", {
      id: item?.id ?? item?._id ?? null,
      name: item?.name ?? null,
      type: itemType ?? null,
      submittedHeader: {
        quantity: formData["system.quantity"],
        enc: formData["system.enc"],
        price: formData["system.price"],
        blockRating: formData["system.blockRating"],
        magicBR: formData["system.magic_br"],
      },
      submittedContainer: {
        contained: formData["system.containerStats.contained"],
        containerId: formData["system.containerStats.container_id"],
      },
      submittedKeys: Object.keys(formData ?? {}).sort(),
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 1 & 2. Qualities (qualitiesTraits + qualitiesStructured)
  //   Only item types that carry these schema fields should receive
  //   this normalization. All others (skill, magicSkill, talent,
  //   trait, power, combatStyle, container, spell) are skipped to
  //   prevent injecting unknown fields into their DataModel updates.
  // ──────────────────────────────────────────────────────────────
  const QUALITIES_TYPES = new Set(["item", "equipment", "scroll", "armor", "shield", "weapon", "ammunition"]);
  if (QUALITIES_TYPES.has(itemType)) {

  const qualityControls = _normalizeQualityControls(formData, system, {
    traitPath: "qualitiesTraits", structuredPath: "qualitiesStructured",
    traitPrefix: "qualitiesTraits.toggle.", togglePrefix: "qualitiesStructured.toggle.", valuePrefix: "qualitiesStructured.value.",
    excludeReach: true,
  });
  const structured = qualityControls.structured;
  let structuredChanged = qualityControls.structuredChanged;

  // Bridge legacy Runed checkbox to canonical structured qualities.
  if (Object.prototype.hasOwnProperty.call(formData, "system.runed")) {
    structuredChanged = true;
    const rawRuned = formData["system.runed"];
    const runedChecked = _bool(rawRuned);
    if (!runedChecked) {
      for (let i = structured.length - 1; i >= 0; i--) {
        if (String(structured[i]?.key ?? "").toLowerCase() === "runed") structured.splice(i, 1);
      }
    } else if (!structured.some((entry) => String(entry?.key ?? "").toLowerCase() === "runed")) {
      structured.push({ key: "runed" });
    } else {
      for (const entry of structured) {
        if (String(entry?.key ?? "").toLowerCase() === "runed") entry.key = "runed";
      }
    }
  }

  // Runed quality: bridge to magic quality flag. Armor AR is now manual — no silent magic_ar mutation.
  const hasRuned = structured.some(q => String(q?.key ?? "").toLowerCase() === "runed");
  if (structuredChanged) formData["system.runed"] = hasRuned;
  if (structuredChanged && hasRuned) {
    if (!structured.some(q => q && q.key === "magic")) {
      structured.push({ key: "magic" });
    }
    // NOTE: magic_ar enforcement removed — armor values are now authored manually via armorValues lanes.
  }

  // Weapon Reload mirroring
  if (
    Object.prototype.hasOwnProperty.call(formData, "system.reloadState.reloadAPCost") &&
    itemType === "weapon"
  ) {
    structuredChanged = true;
    const raw = Number(formData["system.reloadState.reloadAPCost"]);
    const reloadAPCost = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
    formData["system.reloadState.reloadAPCost"] = reloadAPCost;
    formData["system.reloadState.requiresReload"] = reloadAPCost > 0;

    const reloadIndex = structured.findIndex((entry) => String(entry?.key ?? "").toLowerCase() === "reload");
    if (reloadAPCost > 0) {
      if (reloadIndex < 0) structured.push({ key: "reload", value: reloadAPCost });
      else structured[reloadIndex] = { ...structured[reloadIndex], key: "reload", value: reloadAPCost };
    } else {
      for (let i = structured.length - 1; i >= 0; i--) {
        if (String(structured[i]?.key ?? "").toLowerCase() === "reload") structured.splice(i, 1);
      }
    }
  }

  if (structuredChanged) {
    formData["system.qualitiesStructured"] = structured;
  }

  if (itemType === "weapon") {
    if (Object.prototype.hasOwnProperty.call(formData, "system.reachMin")) {
      formData["system.reachMin"] = parseWeaponReachMin(formData["system.reachMin"]);
    }

    if (Object.prototype.hasOwnProperty.call(formData, "system.reach")) {
      formData["system.reach"] = parseWeaponReachMax(formData["system.reach"]) ?? 0;
    }
  }

  } // end QUALITIES_TYPES guard

  // ──────────────────────────────────────────────────────────────
  // 2b. Armor: armorValues lane sanitization
  // Numeric fields → 0 if blank/invalid; special_ar_type → lowercase trimmed string.
  // ──────────────────────────────────────────────────────────────
  if (itemType === "armor") {
    const LANES = ["full", "partial"];
    const NUMERIC_FIELDS = ["armor", "magic_ar", "special_ar"];
    for (const lane of LANES) {
      for (const field of NUMERIC_FIELDS) {
        const key = `system.armorValues.${lane}.${field}`;
        if (Object.prototype.hasOwnProperty.call(formData, key)) {
          const raw = formData[key];
          const n = Number(raw);
          formData[key] = Number.isFinite(n) ? n : 0;
        }
      }
      const typeKey = `system.armorValues.${lane}.special_ar_type`;
      if (Object.prototype.hasOwnProperty.call(formData, typeKey)) {
        formData[typeKey] = String(formData[typeKey] ?? "").trim().toLowerCase();
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 3. Activation Damage Qualities (Talents / Traits / Powers)
  // ──────────────────────────────────────────────────────────────
  if (Object.prototype.hasOwnProperty.call(formData, "activationDamageQualities.present")
      || Object.keys(formData).some((key) => key.startsWith("activationDamageQualitiesTraits.") || key.startsWith("activationDamageQualitiesStructured."))) {
    delete formData["activationDamageQualities.present"];

    const activation = _normalizeQualityControls(formData, system, {
      traitPath: "activation.damage.qualitiesTraits", structuredPath: "activation.damage.qualitiesStructured",
      traitPrefix: "activationDamageQualitiesTraits.toggle.", togglePrefix: "activationDamageQualitiesStructured.toggle.", valuePrefix: "activationDamageQualitiesStructured.value.",
    });
    if (activation.structuredChanged) {
      formData["system.activation.damage.qualitiesStructured"] = activation.structured;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 4. Damage Instances normalization (spells)
  // ──────────────────────────────────────────────────────────────
  if (itemType === "spell") {
    const rrPrefix = "system.engine.resourceRestore.";
    const rrTouched = Object.keys(formData).some((key) => key.startsWith(rrPrefix));
    if (rrTouched) {
      const options = {
        kind: ["restoreResource", "restoreStaminaOrRemoveFatigue"],
        resource: ["hp", "magicka", "stamina"],
        target: ["target", "self"],
        capMode: ["none", "castingCost", "custom"],
      };
      for (const [field, choices] of Object.entries(options)) {
        const key = rrPrefix + field;
        if (!Object.hasOwn(formData, key)) continue;
        const raw = String(formData[key] ?? "").trim();
        const value = ["resource", "target"].includes(field) ? raw.toLowerCase() : raw;
        formData[key] = choices.includes(value) ? value : choices[0];
      }
      for (const field of ["enabled", "chat"]) {
        const key = rrPrefix + field;
        if (Object.hasOwn(formData, key)) formData[key] = _bool(formData[key]);
      }
      for (const [field, fallback] of [["amount", "SS"], ["cap", "COST"]]) {
        const key = rrPrefix + field;
        if (Object.hasOwn(formData, key)) formData[key] = String(formData[key] ?? "").trim() || fallback;
      }
      const levelsKey = rrPrefix + "removeFatigueLevels";
      if (Object.hasOwn(formData, levelsKey)) {
        const levels = Number(formData[levelsKey]);
        formData[levelsKey] = Number.isFinite(levels) && levels > 0 ? Math.floor(levels) : 1;
      }
    }

    const defenseModelKey = "system.engine.defenseModel";
    if (Object.prototype.hasOwnProperty.call(formData, defenseModelKey)) {
      const rawDefenseModel = String(formData[defenseModelKey] ?? "").trim();
      if (rawDefenseModel === "direct") {
        formData[defenseModelKey] = "opposed";
        formData["system.isDirect"] = true;
      } else {
        formData[defenseModelKey] = rawDefenseModel || "opposed";
        formData["system.isDirect"] = false;
      }
    }

    const targetingMode = String(formData["system.engine.targeting.mode"] ?? system.engine?.targeting?.mode ?? "").trim().toLowerCase();
    const currentRangeType = String(formData["system.rangeType"] ?? system.rangeType ?? "").trim().toLowerCase();
    const rangeText = String(formData["system.range"] ?? system.range ?? "").trim();
    if (["system.engine.targeting.mode", "system.rangeType", "system.range"].some((path) => Object.hasOwn(formData, path))) {
      if (targetingMode === "template") {
        formData["system.rangeType"] = "aoe";
      } else if (targetingMode === "self") {
        formData["system.rangeType"] = "none";
      } else if (currentRangeType === "aoe") {
        formData["system.rangeType"] = rangeText ? "ranged" : "none";
      }
    }

    _mergeIndexedFormEntries(formData, "system.damageInstances", system.damageInstances, (entry) => ({
      ...entry,
      formula: String(entry.formula ?? ""),
      type: String(entry.type ?? "none"),
      label: String(entry.label ?? ""),
    }));
  }

  // ──────────────────────────────────────────────────────────────
  // 5. Combat Style normalization
  // ──────────────────────────────────────────────────────────────
  if (itemType === "combatStyle") {
    for (const sa of SPECIAL_ACTIONS) {
      const key = `system.specialAdvantages.${sa.id}`;
      if (Object.hasOwn(formData, key)) formData[key] = _bool(formData[key]);
    }
    const equipmentSubmitted = Object.keys(formData).some((path) => /^system\.trainedEquipment\.\d+$/.test(path));
    if (equipmentSubmitted && system.trainedEquipment != null && !Array.isArray(system.trainedEquipment)) {
      throw new Error("Legacy field system.trainedEquipment requires the item sheet compatibility migration.");
    }
    const equipment = Array.isArray(system.trainedEquipment) ? system.trainedEquipment.slice() : [];
    let equipmentChanged = false;
    for (let i = 0; i < 10; i++) {
      const key = `system.trainedEquipment.${i}`;
      if (!Object.hasOwn(formData, key)) continue;
      while (equipment.length <= i) equipment.push("");
      equipment[i] = String(formData[key] ?? "").trim();
      delete formData[key];
      equipmentChanged = true;
    }
    if (equipmentChanged) formData["system.trainedEquipment"] = equipment;
  }

  // ──────────────────────────────────────────────────────────────
  // 6. Spell: scaling levels + engine recipes + OverTime entries
  // ──────────────────────────────────────────────────────────────
  let scalingLevels = [];

  if (itemType === "spell") {
    const fallbackDurationUnit = formData["system.duration.unit"] || system.duration?.unit || "instant";
    const existingLevels = getScalingLevelsArray({ system });
    const editedLevels = _mergeIndexedFormEntries(formData, "system.scaling.levels", system.scaling?.levels, (entry) => {
      const normalized = normalizeScalingEntry(entry, fallbackDurationUnit);
      normalized.level = Number(normalized.level) || 0;
      normalized.cost = Number(normalized.cost) || 0;
      return normalized;
    });
    scalingLevels = (editedLevels ?? existingLevels).map((entry) => normalizeScalingEntry(entry, fallbackDurationUnit));

    _mergeIndexedFormEntries(formData, "system.engine.effects.recipes", system.engine?.effects?.recipes, (entry) => ({
      ...entry,
      key: String(entry.key ?? ""),
      mode: String(entry.mode ?? "add"),
      value: String(entry.value ?? ""),
      target: String(entry.target ?? "target"),
      label: String(entry.label ?? ""),
    }));

    const existingOverTime = system.overTimeEntries != null && (!Array.isArray(system.overTimeEntries) || system.overTimeEntries.length)
      ? system.overTimeEntries
      : (system.hasOverTime && system.overTime && typeof system.overTime === "object" ? [system.overTime] : []);
    _mergeIndexedFormEntries(formData, "system.overTimeEntries", existingOverTime, (entry) => ({
      ...entry,
      trigger: String(entry.trigger ?? "turnStart"),
      cadenceEvery: Number(entry.cadenceEvery) || 1,
      cadenceUnit: String(entry.cadenceUnit ?? "rounds"),
      payloadType: String(entry.payloadType ?? "damage"),
      formula: String(entry.formula ?? "1d6"),
      damageType: String(entry.damageType ?? "fire"),
      ignoreReduction: _bool(entry.ignoreReduction),
      saveKey: String(entry.saveKey ?? ""),
      saveTN: Number(entry.saveTN) || 0,
      saveSuccess: String(entry.saveSuccess ?? "endEffect"),
      saveFailure: String(entry.saveFailure ?? entry.saeFailure ?? "damage"),
      maxTicks: entry.maxTicks != null && entry.maxTicks !== "" ? Number(entry.maxTicks) || null : null,
      label: String(entry.label ?? ""),
      chatLog: _bool(entry.chatLog),
    }));
  }

  if (itemType === "invocation") {
    if (Object.hasOwn(formData, "system.aspectsText")) {
      const text = String(formData["system.aspectsText"] ?? "").trim();
      formData["system.aspects"] = text ? text.split(",").map((value) => value.trim()).filter(Boolean) : [];
      delete formData["system.aspectsText"];
    }
    for (const key of ["system.domainKey", "system.tnDomainKey"]) {
      if (Object.hasOwn(formData, key)) formData[key] = String(formData[key] ?? "").trim().toLowerCase();
    }
    if (Object.hasOwn(formData, "system.domainKey")) formData["system.isUniversal"] = formData["system.domainKey"] === "universal";
    if (Object.hasOwn(formData, "system.circle")) {
      const circle = Number(formData["system.circle"]);
      formData["system.circle"] = Math.max(1, Math.min(4, Number.isFinite(circle) ? Math.trunc(circle) : 1));
    }
    for (const key of ["system.pietyCost", "system.source.importVersion"]) {
      if (!Object.hasOwn(formData, key)) continue;
      const value = Number(formData[key]);
      formData[key] = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    }
  }

  if (isShieldLaneDoc) {
    _shieldDebug("normalize end", {
      id: item?.id ?? item?._id ?? null,
      name: item?.name ?? null,
      type: itemType ?? null,
      normalizedHeader: {
        quantity: formData["system.quantity"],
        enc: formData["system.enc"],
        price: formData["system.price"],
        blockRating: formData["system.blockRating"],
        magicBR: formData["system.magic_br"],
      },
      normalizedContainer: {
        contained: formData["system.containerStats.contained"],
        containerId: formData["system.containerStats.container_id"],
      },
      normalizedKeys: Object.keys(formData ?? {}).sort(),
    });
  }

  const soulFlags = source.flags?.["uesrpg-3ev4"] ?? {};
  const soulFields = ["isSoulGem", "soulTier", "soulSize", "soulType", "soulEnergy", "maxSoulEnergy", "soulGemConsumptionMode"];
  const soulTouched = soulFields.some((key) => Object.hasOwn(formData, `flags.uesrpg-3ev4.${key}`));
  if (["item", "equipment"].includes(String(itemType ?? "").toLowerCase()) && soulTouched
      && [true, "true", 1, "1"].includes(formData["flags.uesrpg-3ev4.isSoulGem"] ?? soulFlags.isSoulGem)) {
    formData["flags.uesrpg-3ev4.isSoulGem"] = true;
    const tierKey = String(formData["flags.uesrpg-3ev4.soulTier"] ?? soulFlags.soulTier ?? "custom").trim().toLowerCase();
    const knownTier = SOUL_GEM_TIERS[tierKey] ?? null;
    const maximum = knownTier
      ? knownTier.maxEnergy
      : Math.max(0, Math.trunc(Number(formData["flags.uesrpg-3ev4.maxSoulEnergy"] ?? soulFlags.maxSoulEnergy) || 0));
    const requestedCurrent = Math.max(0, Math.trunc(Number(formData["flags.uesrpg-3ev4.soulEnergy"] ?? soulFlags.soulEnergy) || 0));
    // A tier change can lower capacity while the old current value is still in
    // the form. Normalize that dependent value instead of trapping the sheet in
    // an unsaveable submit-on-close loop.
    const current = Math.min(maximum, requestedCurrent);
    const consumptionMode = String(formData["flags.uesrpg-3ev4.soulGemConsumptionMode"] ?? soulFlags.soulGemConsumptionMode ?? "disposable").toLowerCase() === "reusable"
      ? "reusable"
      : "disposable";

    formData["flags.uesrpg-3ev4.soulTier"] = knownTier ? tierKey : "custom";
    formData["flags.uesrpg-3ev4.soulSize"] = knownTier
      ? knownTier.label
      : String(formData["flags.uesrpg-3ev4.soulSize"] ?? soulFlags.soulSize ?? "Custom").trim() || "Custom";
    formData["flags.uesrpg-3ev4.soulType"] = knownTier
      ? knownTier.soulType
      : (String(formData["flags.uesrpg-3ev4.soulType"] ?? soulFlags.soulType ?? "white").toLowerCase() === "black" ? "black" : "white");
    formData["flags.uesrpg-3ev4.soulEnergy"] = current;
    formData["flags.uesrpg-3ev4.maxSoulEnergy"] = maximum;
    formData["flags.uesrpg-3ev4.soulGemConsumptionMode"] = consumptionMode;

  }

  // Version-2 enchanting flags are authoritative. Any editable pool submitted
  // by the consolidated panel is mirrored into system.charge for older macros
  // and runtime consumers without allowing the two values to drift.
  const poolPrefixes = [
    "flags.uesrpg-3ev4.enchanting.cast.pool",
    "flags.uesrpg-3ev4.itemSpellcasting.pool",
  ];
  for (const prefix of poolPrefixes) {
    const valueKey = `${prefix}.value`;
    const maxKey = `${prefix}.max`;
    if (!(valueKey in formData) && !(maxKey in formData)) continue;
    const existingPool = foundry.utils.getProperty(source, prefix);
    const fallbackValue = Number(existingPool?.value ?? system.charge?.value ?? 0) || 0;
    const fallbackMax = Number(existingPool?.max ?? system.charge?.max ?? fallbackValue) || fallbackValue;
    const maximum = Math.max(0, Math.trunc(Number(formData[maxKey] ?? fallbackMax) || 0));
    const current = Math.min(maximum, Math.max(0, Math.trunc(Number(formData[valueKey] ?? fallbackValue) || 0)));
    formData[valueKey] = current;
    formData[maxKey] = maximum;
    formData["system.charge.value"] = current;
    formData["system.charge.max"] = maximum;
    break;
  }
  if ("system.charge.value" in formData || "system.charge.max" in formData) {
    const maximum = Math.max(0, Math.trunc(Number(formData["system.charge.max"] ?? system.charge?.max ?? 0) || 0));
    const current = Math.min(maximum, Math.max(0, Math.trunc(Number(formData["system.charge.value"] ?? system.charge?.value ?? 0) || 0)));
    formData["system.charge.value"] = current;
    formData["system.charge.max"] = maximum;
  }

  return { scalingLevels, soulEnergyIssue };
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

  const baseDurationUnit =
    formData["system.duration.unit"] || item.system?.duration?.unit || "instant";

  const result = validateScalingLevels(scalingLevels, {
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
