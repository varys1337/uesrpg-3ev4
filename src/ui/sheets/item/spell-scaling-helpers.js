/**
 * src/ui/sheets/item/spell-scaling-helpers.js
 *
 * Pure utility helpers for spell scaling level management.
 * Extracted from the closured helpers in item/listeners/index.js
 * so that SimpleItemSheetV2 action handlers can reuse them.
 */
import { isDebugEnabled } from "../../../utils/debug.js";

/**
 * Retrieve the scaling levels array from a spell item, normalizing
 * object-keyed legacy data into a proper array.
 *
 * @param {Item} item - The spell item document
 * @returns {object[]} Array of scaling level entries
 */
export function getScalingLevelsArray(item) {
  const rawLevels = foundry.utils.getProperty(item, "system.scaling.levels");
  if (Array.isArray(rawLevels)) return rawLevels;
  if (rawLevels && typeof rawLevels === "object") {
    return Object.values(rawLevels).filter(v => v && typeof v === "object");
  }
  return [];
}

/**
 * Normalize a single scaling level entry, filling in defaults for
 * missing or null fields.
 *
 * @param {object} entry - Raw scaling level entry
 * @param {string} fallbackDurationUnit - Unit to use when duration is missing
 * @returns {object} Normalized scaling entry
 */
export function normalizeScalingEntry(entry, fallbackDurationUnit = "instant") {
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
}

/**
 * Conditionally log spell-scaling debug messages when Debug Settings
 * has `spellCastingDebug` enabled.
 *
 * @param  {...any} args - Arguments forwarded to console.log
 */
export function logSpellDebug(...args) {
  if (isDebugEnabled("spellCastingDebug")) {
    console.log("UESRPG | Spell Scaling Sheet", ...args);
  }
}
