/**
 * @module magic/magicka-utils
 *
 * src/core/magic/magicka-utils.js
 *
 * Magicka consumption and spell damage helpers for UESRPG 3ev4.
 *
 * Notes:
 * - This file is intentionally "schema-tolerant": spells in this repository currently have
 *   multiple historical lanes for cost/damage (e.g. system.cost vs system.scaling.levels[].cost,
 *   system.damage vs system.damageFormula vs system.scaling.levels[].damageFormula).
 * - Package 1 normalizes reads without migrating or renaming any data fields.
 */

import { MagicTimekeeping } from "./timekeeping-helper.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";

import { getDifficultyByKey } from "../skills/skill-tn.js";
import { evaluateAEModifierKeysDetailed, getActorCapabilityFlag } from "../active-effects/modifier-evaluator.js";
import { hasGrandmasterForSkill } from "../traits/general-talents.js";
import { computeSpellRestraintReduction, getActorWillpowerBonus, getSpellRestraintReduction } from "./magic-modifiers.js";
import { _num, _strTrim as _str, isDebugEnabled } from "./_primitives.js";
import { _bool } from "../../utils/coerce.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { getFlagValueWithFallback, getSystemFlagsWithFallback } from "../system/flags.js";
import { isShieldItem } from "../items/shield-utils.js";
import { isWarfareUnitActorType } from "../actors/types.js";
import { hasTalent } from "../traits/talents-api.js";

// Re-export for backward compatibility - canonical definition lives in magic-modifiers.js
export { getActorWillpowerBonus };

/**
 * Options bag for spell casting operations (cost, TN, consumption).
 *
 * Constructed by the spell options dialog or the opposed-workflow card setup.
 * Passed through to `computeSpellMagickaCost`, `computeMagicCastingTN`,
 * `consumeSpellMagicka`, `resolveSpellProfile`, and related helpers.
 *
 * @typedef {object} SpellCastOptions
 * @property {boolean}      [isRestrained]       - Spell Restraint toggled (refund WPB on success)
 * @property {boolean}      [isOverloaded]       - Overload mode (2× cost, enhanced effect)
 * @property {boolean}      [isOvercharged]      - Overcharge mode
 * @property {string}       [difficultyKey]      - Difficulty modifier key ("average", "hard", etc.)
 * @property {number}       [manualModifier]     - Manual TN modifier (alias: manualMod)
 * @property {number|null}  [level]              - Cast level (for scaling; alias: castLevel)
 * @property {number|null}  [castLevel]          - Alias for level
 * @property {boolean}      [useOvercharge]      - From dialog: overcharge toggle
 * @property {boolean}      [useMagickaCycling]  - From dialog: magicka cycling toggle
 * @property {string}       [difficulty]         - Alias for difficultyKey
 * @property {number}       [manualMod]          - Alias for manualModifier
 */

/**
 * Result of `computeMagicCastingTN()`.
 *
 * @typedef {object} CastingTNResult
 * @property {number} baseTN             - Base TN from spellcasting skill level
 * @property {number} spellcastingLevel  - Actor's spellcasting skill level
 * @property {number} spellLevel         - Spell's level
 * @property {Array<{label: string, value: number, keepZero?: boolean}>} modifiers - TN modifier breakdown
 * @property {Array<{label: string, value: number, keepZero?: boolean}>} breakdown - Alias of modifiers
 * @property {number} finalTN            - Final computed TN after all modifiers
 */

/**
 * Result of `consumeSpellMagicka()`.
 *
 * @typedef {object} MagickaSpendResult
 * @property {boolean} ok        - Whether the spend succeeded (had enough MP)
 * @property {number}  consumed  - MP actually spent
 * @property {number}  remaining - MP remaining after spend
 * @property {number}  previous  - MP before spend
 * @property {number}  [required]           - MP required (returned on failure)
 * @property {number}  [baseCost]           - Base cost before modifiers
 * @property {number}  [refund]             - Restraint refund (added post-hoc by workflow)
 * @property {string}  [restraintBreakdown] - Human-readable breakdown (added post-hoc)
 */

/**
 * Normalize a modifier lane key component to a safe, stable token.
 * Matches the normalization used by skill TN computations.
 *
 * Examples:
 *  - "Destruction" => "destruction"
 *  - "Destruction Magic" => "destructionmagic"
 *
 * @param {*} s
 * @returns {string}
 */
function _normalizeKey(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_]/g, "");
}

function _collectSpellCostModifierKeys(spell) {
  const keySet = new Set([
    "system.modifiers.magic.cost._all"
  ]);

  const schoolKey = _normalizeKey(spell?.system?.school);
  if (schoolKey) keySet.add(`system.modifiers.magic.cost.${schoolKey}`);

  return Array.from(keySet);
}

function _evaluateSpellCostAEModifier(actor, spell) {
  try {
    const keys = _collectSpellCostModifierKeys(spell);
    if (!keys.length) return { total: 0, breakdown: [] };
    return evaluateAEModifierKeysDetailed(actor, keys, { labelPrefix: "Magic Cost" });
  } catch (_e) {
    return { total: 0, breakdown: [] };
  }
}

function _computeSpellBaseCost(actor, spell, options = {}) {
  const baseCostRaw = getSpellCost(spell, options.level ?? null);
  const { total: aeModifierRaw, breakdown } = _evaluateSpellCostAEModifier(actor, spell);
  const aeModifier = _num(aeModifierRaw, 0);

  // Costs are integers in this system; treat AE modifiers as additive then clamp.
  const baseCost = Math.max(0, Math.floor(baseCostRaw + aeModifier));
  return { baseCost, baseCostRaw, aeModifier, aeBreakdown: breakdown };
}

/**
 * Return the spell level (1..7).
 * @param {Item} spell
 * @returns {number}
 */
export function getSpellLevel(spell) {
  const lvl = _num(spell?.system?.level, 1);
  return Math.max(1, Math.min(7, lvl));
}

/**
 * Canonical scaling-level reader.
 * Normalizes multiple storage shapes into a stable sorted array.
 *
 * @param {Item} spell
 * @returns {Array<object>}
 */
export function getSpellScalingLevels(spell) {
  const candidates = [
    spell?.system?.scaling?.levels,
    spell?.system?.scalingLevels,
    spell?.system?.scaling
  ];

  const rows = [];

  const collect = (node) => {
    if (!node) return;

    if (Array.isArray(node)) {
      node.forEach((entry, idx) => {
        if (!entry || typeof entry !== "object") return;
        const explicit = Number(entry?.level);
        const level = Number.isFinite(explicit) && explicit > 0 ? explicit : (idx + 2);
        rows.push({ ...entry, level, __inferredLevel: !(Number.isFinite(explicit) && explicit > 0) });
      });
      return;
    }

    if (typeof node?.values === "function") {
      Array.from(node.values()).forEach((entry, idx) => {
        if (!entry || typeof entry !== "object") return;
        const explicit = Number(entry?.level);
        const level = Number.isFinite(explicit) && explicit > 0 ? explicit : (idx + 2);
        rows.push({ ...entry, level, __inferredLevel: !(Number.isFinite(explicit) && explicit > 0) });
      });
      return;
    }

    if (node && typeof node === "object") {
      if (node.levels && typeof node.levels === "object") {
        collect(node.levels);
        return;
      }

      Object.entries(node).forEach(([key, entry], idx) => {
        if (!entry || typeof entry !== "object") return;
        const explicit = Number(entry?.level);
        const keyNum = Number(key);
        const inferred = Number.isFinite(keyNum) ? (keyNum + 1) : (idx + 2);
        const level = Number.isFinite(explicit) && explicit > 0 ? explicit : inferred;
        rows.push({ ...entry, level, __inferredLevel: !(Number.isFinite(explicit) && explicit > 0) });
      });
    }
  };

  for (const c of candidates) collect(c);
  if (!rows.length) return [];

  const byLevel = new Map();
  for (const row of rows) {
    const lvl = _num(row?.level, 0);
    if (lvl <= 0) continue;
    const prev = byLevel.get(lvl);
    if (!prev || (prev.__inferredLevel && !row.__inferredLevel)) {
      byLevel.set(lvl, row);
    }
  }

  return Array.from(byLevel.values()).sort((a, b) => _num(a?.level, 0) - _num(b?.level, 0));
}

/**
 * Get a scaling entry for the spell at a specific level.
 * If no explicit entry exists, falls back to array index (level-1) if present.
 * @param {Item} spell
 * @param {number|null} level
 * @returns {object|null}
 */
export function getSpellScalingEntry(spell, level = null) {
  const DEBUG = isDebugEnabled("spellCastingDebug");
  const levels = getSpellScalingLevels(spell);
  
  if (DEBUG) {
    console.log(`\n🔍 getSpellScalingEntry called for "${spell?.name}":`, {
      requestedLevel: level,
      rawLevels: levels,
      isArray: Array.isArray(levels),
      isObject: typeof levels === "object" && levels !== null && !Array.isArray(levels)
    });
  }
  
  if (!Array.isArray(levels) || levels.length === 0) {
    if (DEBUG) console.log("  ⚠️ No scaling levels array or empty array - returning null");
    return null;
  }

  const targetLevel = level == null ? getSpellLevel(spell) : _num(level, getSpellLevel(spell));
  
  if (DEBUG) {
    console.log(`  Target level resolved to: ${targetLevel}`);
    console.log(`  Searching for entry with level === ${targetLevel}...`);
  }
  
  const byLevel = levels.find(l => _num(l?.level, 0) === targetLevel);
  if (byLevel) {
    if (DEBUG) console.log(`  ✅ Found entry by level match:`, byLevel);
    return byLevel;
  }

  const allInferred = levels.every((l) => l?.__inferredLevel === true);
  if (allInferred) {
    const byIndex = levels[targetLevel - 1];
    if (DEBUG) {
      console.log(`  No exact match, trying inferred index [${targetLevel - 1}]:`, byIndex || "not found");
    }
    return byIndex ?? null;
  }
  if (DEBUG) {
    console.log("  No exact match and explicit scaling rows exist - returning null");
  }
  return null;
}

/**
 * Canonical spell cost getter.
 * Prefers scaling lane when present, otherwise falls back to system.cost.
 * @param {Item} spell
 * @param {number|null} level
 * @returns {number}
 */
export function getSpellCost(spell, level = null) {
  const DEBUG = isDebugEnabled("spellCastingDebug");
  const scaling = getSpellScalingEntry(spell, level);
  const scaledCost = scaling ? _num(scaling.cost, NaN) : NaN;
  
  if (DEBUG) {
    console.log(`\n💰 getSpellCost for "${spell?.name}":`, {
      requestedLevel: level,
      scalingEntry: scaling,
      scaledCost,
      isFinite: Number.isFinite(scaledCost)
    });
  }
  
  if (Number.isFinite(scaledCost)) {
    if (DEBUG) console.log(`  ✅ Using scaled cost: ${scaledCost}`);
    return Math.max(0, scaledCost);
  }

  const baseCost = _num(spell?.system?.cost, 0);
  if (DEBUG) console.log(`  ⚠️ No scaled cost, using base cost: ${baseCost}`);
  return Math.max(0, baseCost);
}

/**
 * Canonical spell damage formula getter.
 * Checks scaling entry for the specified level, then falls back to base damageFormula.
 * @param {Item} spell
 * @param {number|null} level - Spell level (uses scaling entry if available)
 * @returns {string} Damage formula or "0" for non-damaging spells
 */
export function getSpellDamageFormula(spell, level = null) {
  const DEBUG = isDebugEnabled("spellCastingDebug");
  
  // Check scaling entry first if level is specified
  const scaling = getSpellScalingEntry(spell, level);
  const scaledDamage = scaling ? _str(scaling.damageFormula) : "";
  
  if (DEBUG) {
    console.log(`\n⚔️ getSpellDamageFormula for "${spell?.name}":`, {
      requestedLevel: level,
      scalingEntry: scaling,
      scaledDamage
    });
  }
  
  if (scaledDamage) {
    if (DEBUG) console.log(`  ✅ Using scaled damage: ${scaledDamage}`);
    return scaledDamage;
  }

  // Prefer primary damageFormula field
  const primary = _str(spell?.system?.damageFormula);
  if (primary) {
    if (DEBUG) console.log(`  ⚠️ No scaled damage, using base formula: ${primary}`);
    return primary;
  }

  // Legacy fallback for older spells
  const legacy = _str(spell?.system?.damage);
  if (DEBUG) console.log(`  ⚠️ No scaled or primary damage, using legacy: ${legacy || "0"}`);
  // Return "0" for spells without damage (used in isDamaging checks)
  return legacy || "0";
}

/**
 * Canonical spell damage type getter.
 * @param {Item} spell
 * @returns {string}
 */
export function getSpellDamageType(spell) {
  const dt = _str(spell?.system?.damageType).toLowerCase();
  return dt || "none";
}

/**
 * Get all damage instances for a spell, including the primary damage from legacy fields.
 * Returns an array suitable for per-instance rolling, each with {formula, type, label}.
 * When no damageInstances are configured, wraps the primary damage as a single entry.
 * @param {Item} spell
 * @param {number|null} level - Spell level for scaling
 * @returns {Array<{formula: string, type: string, label: string}>}
 */
export function getSpellDamageInstances(spell, level = null) {
  const instances = [];

  // Primary instance from legacy fields
  const primaryFormula = getSpellDamageFormula(spell, level);
  const primaryType = getSpellDamageType(spell);
  if (primaryFormula && primaryFormula !== "0") {
    instances.push({
      formula: primaryFormula,
      type: primaryType,
      label: "Primary"
    });
  }

  // Additional configured instances
  const extra = spell?.system?.damageInstances;
  if (Array.isArray(extra)) {
    for (const inst of extra) {
      const formula = _str(inst?.formula).trim();
      if (!formula) continue;
      instances.push({
        formula,
        type: _str(inst?.type).toLowerCase() || "none",
        label: _str(inst?.label).trim()
      });
    }
  }

  return instances;
}

/**
 * Determine whether this spell should be treated as healing.
 * Checks both the isHealingSpell toggle and damageType for backwards compatibility.
 * @param {Item} spell
 * @returns {boolean}
 */
export function isHealingSpell(spell) {
  // Check the dedicated healing toggle first (new system)
  if (_bool(spell?.system?.isHealingSpell)) return true;
  // Fall back to damage type check (legacy/backwards compatibility)
  return getSpellDamageType(spell) === "healing";
}

/**
 * Read the actor's current Magicka value from the canonical lane in this system.
 * @param {Actor} actor
 * @returns {number}
 */
export function getActorMagicka(actor) {
  return _num(actor?.system?.magicka?.value, 0);
}

// getActorWillpowerBonus - imported from magic-modifiers.js and re-exported above

/**
 * Consume magicka from actor for casting a spell.
 *
 * Important:
 * - This function does NOT clamp Magicka to 0; it will refuse to consume if insufficient.
 * - Callers should treat ok:false as "the spell is not cast".
 *
 * @param {Actor} actor - The caster
 * @param {Item} spell - The spell being cast
 * @param {object} options - Spell options (isRestrained, isOverloaded, etc.)
 * @param {number|null} options.level - Optional casting level (defaults to spell.system.level)
 * @returns {Promise<object>} - { ok, consumed, remaining, previous, required?, baseCost? }
 */

/**
 * Compute the final Magicka cost for casting a spell given options.
 * Pure helper: does not mutate actor or spell.
 *
 * RAW (Chapter 6):
 * - Spell Restraint reduces cost by WP bonus, minimum 1 Magicka when base cost > 0.
 * - Overload / Reinforce modify spell effects, not the Magicka cost itself.
 *
 * @param {Actor} actor - The caster (may be null/undefined)
 * @param {Item} spell - The spell being cast
 * @param {object} options - { isRestrained, isOverloaded, isOvercharged, level }
 * @param {number|null} options.level - Optional casting level (defaults to spell.system.level)
 * @returns {{ cost:number, baseCost:number, wpBonus:number, restraintReduction:number, isRestrained:boolean, isOverloaded:boolean, isOvercharged:boolean }}
 */
export function computeSpellMagickaCost(actor, spell, options = {}) {
  const { baseCost, baseCostRaw, aeModifier, aeBreakdown } = _computeSpellBaseCost(actor, spell, options);

  const isRestrained = _bool(options.isRestrained);
  const isOverloaded = _bool(options.isOverloaded);
  const isOvercharged = _bool(options.isOvercharged);

  let cost = baseCost;
  let wpBonus = 0;
  let restraintReduction = 0;

  // NOTE: This helper assumes the cast succeeded. If you need the cost to *attempt* a cast,
  // use computeSpellAttemptMagickaCost().
  if (isRestrained && baseCost > 0) {
    wpBonus = getActorWillpowerBonus(actor);
    const restraintInfo = getSpellRestraintReduction(actor, spell, {
      ...options,
      baseCost,
      baseWB: wpBonus,
      minCost: 1
    });
    restraintReduction = Number(restraintInfo?.reduction ?? 0) || 0;
    cost = Math.max(1, baseCost - restraintReduction);
  }

  cost = Math.max(0, Math.floor(cost));
  return {
    cost,
    baseCost,
    baseCostRaw,
    aeModifier,
    aeBreakdown,
    wpBonus,
    restraintReduction,
    isRestrained,
    isOverloaded,
    isOvercharged
  };
}

/**
 * Compute the Magicka cost required to *attempt* casting a spell.
 * RAW (Chapter 6): Spell Restraint reduces cost only on a successful cast,
 * so the attempt cost starts at listed base cost before any refund.
 * Overload doubles the attempt cost.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object} options - { level, isOverloaded }
 * @returns {{ cost:number, baseCost:number }}
 */
export function computeSpellAttemptMagickaCost(actor, spell, options = {}) {
  // Scroll mode: bypass magicka cost entirely.
  if (options?.consumeMagicka === false) {
    return { cost: 0, baseCost: 0, baseCostRaw: 0, aeModifier: 0, aeBreakdown: [], overloadMultiplier: 1 };
  }
  const { baseCost, baseCostRaw, aeModifier, aeBreakdown } = _computeSpellBaseCost(actor, spell, options);
  const overloadMultiplier = _bool(options?.isOverloaded) ? 2 : 1;
  const cost = Math.max(0, Math.floor(baseCost * overloadMultiplier));
  return { cost, baseCost, baseCostRaw, aeModifier, aeBreakdown, overloadMultiplier };
}

/**
 * Apply Spell Restraint refund on successful casts.
 * RAW (Chapter 6): On a successful spellcast, a mage can reduce the cost by their
 * Willpower bonus to a minimum of 1 Magicka (when base cost > 0).
 *
 * Also RAW (Chapter 6, Attack Spells): On a critical success, non-damaging spells
 * double their Magicka cost reduction from Spell Restraint (still subject to the 1 cost minimum).
 *
 * Returns refund details for reporting.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object} options - { isRestrained, level }
 * @param {object} result - roll result (degree-roll-helper.js)
 * @param {object} spendInfo - return value from consumeSpellMagicka()
 * @returns {Promise<{ refund:number, finalCost:number, breakdown:string }>}
 */
export async function applySpellRestraintRefund(actor, spell, options = {}, result = {}, spendInfo = {}) {
  const isRestrained = _bool(options.isRestrained);
  const spent = Number(spendInfo?.consumed ?? 0) || 0;

  if (!isRestrained) return { refund: 0, finalCost: spent, breakdown: "" };

  const isSuccess = Boolean(
    result?.isSuccess ??
    result?.success ??
    result?.outcome?.success ??
    (typeof result?.degrees === "number" ? (result.degrees >= 0) : false)
  );

  if (!isSuccess) return { refund: 0, finalCost: spent, breakdown: "" };

  const { baseCost } = _computeSpellBaseCost(actor, spell, options);
  if (baseCost <= 0) return { refund: 0, finalCost: 0, breakdown: "" };

  // Determine whether this spell is "damaging" for the critical success clause.
  // Healing and effect-only spells are treated as non-damaging.
  const formula = getSpellDamageFormula(spell, options.level ?? null);
  const isDamaging = Boolean(formula && formula !== "0" && getSpellDamageType(spell) !== "healing");

  const isCriticalSuccess = Boolean(result?.isCriticalSuccess ?? result?.criticalSuccess ?? result?.isCritSuccess);

  // Use talent-aware restraint reduction (Creative, Methodical, Magicka Cycling, Stunted Magicka)
  const restraintInfo = computeSpellRestraintReduction(actor, spell, {
    isCritical: isCriticalSuccess,
    isDamaging,
    baseCost,
    minCost: 1
  });
  const reduction = Math.max(0, Number(restraintInfo?.reduction ?? 0));

  if (reduction <= 0) return { refund: 0, finalCost: baseCost, breakdown: "" };

  const current = getActorMagicka(actor);
  const max = _num(actor?.system?.magicka?.max, 0);
  const next = (max > 0) ? Math.min(max, current + reduction) : (current + reduction);
  await requestUpdateDocument(actor, { "system.magicka.value": next });

  const finalCost = baseCost - reduction;
  const breakdownParts = restraintInfo.breakdown;
  const breakdown = breakdownParts.length > 0
    ? `Spell Restraint: -${reduction} (${breakdownParts.join(", ")}), min 1`
    : `Spell Restraint: -${reduction} (WPB), min 1`;

  // If the spendInfo differs from baseCost for any reason, treat the refund as best-effort.
  const refund = Math.min(reduction, spent > 0 ? spent : reduction);
  return { refund, finalCost, breakdown };
}
export async function consumeSpellMagicka(actor, spell, options = {}) {
  // Scroll mode: skip magicka deduction entirely.
  if (options?.consumeMagicka === false) {
    const current = getActorMagicka(actor);
    return { ok: true, consumed: 0, remaining: current, previous: current, required: 0, baseCost: 0 };
  }
  const { cost: attemptCost, baseCost } = computeSpellAttemptMagickaCost(actor, spell, options);

  // RAW: if you are currently maintaining (Upkeep) a spell with no listed duration, you cannot cast a different spell.
  // We enforce this at cast-time so the restriction is deterministic across all cast entry points.
  try {
    const activeNoDuration = (() => {
  try {
    const casterUuid = String(actor?.uuid ?? "");
    if (!casterUuid) return null;

    const actors = MagicTimekeeping.relevantActorsArray?.() ?? Array.from(MagicTimekeeping.collectRelevantActors?.() ?? []);
    for (const a of actors) {
      for (const ef of (a?.effects ?? [])) {
        const f = getSystemFlagsWithFallback(ef);
        if (!f?.spellEffect) continue;
        if (!f?.hasUpkeep || !f?.noListedDuration) continue;
        if (ef?.disabled) continue;
        if (String(f?.casterUuid ?? "") !== casterUuid) continue;
        return ef;
      }
    }
  } catch (_e) {
    /* no-op */
  }
  return null;
})();

if (activeNoDuration) {
      const maintainedUuid = String(activeNoDuration?.flags?.["uesrpg-3ev4"]?.spellUuid ?? "");
      const castingUuid = String(spell?.uuid ?? "");
      if (maintainedUuid && castingUuid && maintainedUuid !== castingUuid) {
        ui.notifications?.warn?.(
          `You cannot cast another spell while maintaining ${activeNoDuration?.name ?? "an upkept spell"} (no listed duration).`
        );
        const current = getActorMagicka(actor);
        return { ok: false, consumed: 0, remaining: current, previous: current, required: attemptCost, baseCost };
      }
    }
  } catch (_e) {
    // no-op
  }


  const current = getActorMagicka(actor);
  const remaining = current - attemptCost;

  // Insufficient Magicka: do not cast.
  if (remaining < 0) {
    ui.notifications.warn(
      `Not enough Magicka to cast ${spell?.name ?? "spell"}. Required: ${attemptCost}, Available: ${current}.`
    );
    return {
      ok: false,
      consumed: 0,
      remaining: current,
      previous: current,
      required: attemptCost,
      baseCost
    };
  }

  await requestUpdateDocument(actor, { "system.magicka.value": remaining });

  // Track the most recent spell cast for RAW upkeep restrictions.
  // Best-effort only: this flag is used by the upkeep workflow to enforce
  // the "no other spell since" rule for spells with no listed duration.
  try {
    await requestUpdateDocument(actor, {
      [`flags.${FLAG_SCOPE}.lastSpellCastWorldTime`]: Number(MagicTimekeeping.nowWorldTimeSeconds?.() ?? game.time?.worldTime ?? 0) || 0,
      [`flags.${FLAG_SCOPE}.lastSpellCastSpellUuid`]: String(spell?.uuid ?? "")
    });
  } catch (_e) {
    // no-op
  }

  return {
    ok: true,
    consumed: attemptCost,
    remaining,
    previous: current,
    baseCost
  };
}

/**
 * Roll spell damage
 * @param {Item} spell - The spell
 * @param {object} options - { isOverloaded, wpBonus, isCritical, level }
 * @returns {Promise<Roll>} - Evaluated damage roll
 */
export async function rollSpellDamage(spell, options = {}) {
  const damageFormula = getSpellDamageFormula(spell, options.level ?? null);
  if (!damageFormula || damageFormula === "0") {
    return await new Roll("0").evaluate();
  }

  const roll = await new Roll(damageFormula).evaluate();

  // Critical success: return max damage instead
  if (options.isCritical) {
    const maxDamage = getMaxSpellDamage(spell, { level: options.level ?? null });
    // Foundry computes total at evaluate time; we preserve formula but override total for reporting.
    // This is a controlled internal assignment used elsewhere in the codebase.
    roll._total = maxDamage;
  }

  // Overload: optional flat bonus to damage.
  if (_bool(options.isOverloaded)) {
    const b = _num(options.overloadBonus, 0);
    if (b) roll._total = _num(roll._total, roll.total) + b;
  }

  return roll;
}

/**
 * Compute overload bonus damage for a spell.
 *
 * Current data lane:
 * - spell.system.overloadBonusDamage may be:
 *   - a number (flat bonus)
 *   - a number >=10 meaning a characteristic total (bonus = floor(total/10))
 *   - a string token "WB" / "WPB" meaning Willpower Bonus
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {number}
 */
export function computeSpellOverloadBonusDamage(actor, spell) {
  const raw = spell?.system?.overloadBonusDamage;
  if (raw === undefined || raw === null || raw === "") return 0;

  const s = String(raw).trim().toLowerCase();
  if (!s) return 0;

  // Keyword: willpower bonus
  if (s === "wb" || s === "wpb" || s === "willpower bonus" || s === "willpower") {
    return getActorWillpowerBonus(actor);
  }

  // Number: either flat bonus or characteristic total lane.
  const n = Number(s);
  if (Number.isFinite(n)) {
    if (n >= 10) return Math.floor(n / 10);
    return Math.floor(n);
  }

  return 0;
}

/**
 * Roll spell healing.
 *
 * Healing spells in this system use the same formula lane as damage (system.damageFormula/scaling).
 * This helper exists to keep the modern magic workflow deterministic and to keep imports stable.
 *
 * Note:
 * - By default, DoS does not scale healing unless a specific talent/feature implements it.
 * - Critical casting success does not automatically maximize healing unless explicitly stated by RAW.
 *
 * @param {Item} spell - The spell
 * @param {object} options - { level }
 * @returns {Promise<Roll>} - Evaluated healing roll
 */
export async function rollSpellHealing(spell, options = {}) {
  const healingFormula = getSpellDamageFormula(spell, options.level ?? null);
  if (!healingFormula || healingFormula === "0") {
    return await new Roll("0").evaluate();
  }
  return await new Roll(healingFormula).evaluate();
}



/**
 * Get maximum damage for a spell (for critical hits).
 * This does not evaluate actor data references; it supports common dice expressions.
 *
 * @param {Item} spell - The spell
 * @param {object} options - { level }
 * @returns {number} - Maximum damage value
 */
export function getMaxSpellDamage(spell, options = {}) {
  const formula = _str(getSpellDamageFormula(spell, options.level ?? null));
  if (!formula || formula === "0") return 0;

  const cleaned = formula.replace(/\s+/g, "");

  // Sum max dice
  let total = 0;
  const diceRe = /(\d+)d(\d+)/g;
  for (const m of cleaned.matchAll(diceRe)) {
    const count = _num(m[1], 0);
    const sides = _num(m[2], 0);
    total += count * sides;
  }

  // Remove dice portions and sum explicit constants
  const withoutDice = cleaned.replace(diceRe, "");

  // Leading constant without sign (rare but supported)
  const leading = withoutDice.match(/^\d+/);
  if (leading) total += _num(leading[0], 0);

  for (const m of withoutDice.matchAll(/([+-])(\d+)/g)) {
    const sign = m[1] === "-" ? -1 : 1;
    total += sign * _num(m[2], 0);
  }

  return total;
}

/**
 * Single authoritative mapping from rank label to numeric rank number.
 * Untrained => -1 so that spellcasting level (rank + 1) becomes 0.
 * @type {Object<string, number>}
 */
const RANK_TO_NUMERIC = Object.freeze({
  untrained: -1,
  novice: 0,
  apprentice: 1,
  journeyman: 2,
  adept: 3,
  expert: 4,
  master: 5,
  grandmaster: 6,
  legendary: 7
});

/**
 * Get the magic skill level for a given school.
 *
 * Spellcasting Level = (Skill Rank Numeric) + 1
 * Repository rank labels (template.json) imply:
 *   novice=0, apprentice=1, journeyman=2, adept=3, expert=4, master=5
 * We additionally accept grandmaster=6 and legendary=7.
 *
 * For NPCs, reads per-school effective rank from
 * `flags.uesrpg-3ev4.npcMagicSchoolRanks.<schoolKey>`.
 * Default when absent: "untrained" (spellcasting level 0).
 *
 * @param {Actor} actor - The caster
 * @param {string} school - The spell school (e.g., "destruction")
 * @returns {number} - Spellcasting level (≥ 0)
 */
export function getMagicSkillLevel(actor, school) {
  // Warfare Units don't have individual magic skill items or NPC flag ranks.
  if (isWarfareUnitActorType(actor?.type)) return 0;

  const schoolNormalized = _str(school).toLowerCase();

  // --- NPC branch: read per-school rank from flags ---
  if (actor?.type === "NPC") {
    const schoolKey = schoolNormalized || "unknown";
    const label = _str(
      getFlagValueWithFallback(actor, `npcMagicSchoolRanks.${schoolKey}`)
    ).toLowerCase() || "untrained";
    const rankNumeric = RANK_TO_NUMERIC[label] ?? -1;
    return Math.max(0, rankNumeric + 1);
  }

  // --- PC branch: find embedded magicSkill item ---
  const magicSkill = actor?.items?.find(i =>
    i.type === "magicSkill" &&
    _str(i.name).toLowerCase().includes(schoolNormalized)
  );

  if (!magicSkill) return 0;

  const rank = _str(magicSkill.system?.rank ?? "untrained").toLowerCase();
  const rankValue = RANK_TO_NUMERIC[rank] ?? -1;

  // Chapter 4 (Grandmaster): If taken with a magical skill, increase the bonus to effective skill rank by +1.
  // Implemented here as a +1 effective rank for this school when the actor has the corresponding Grandmaster talent.
  const gmBonus = hasGrandmasterForSkill(actor, magicSkill?.name ?? "") ? 1 : 0;
  return (rankValue + gmBonus) + 1;
}

/**
 * Check whether the actor is trained in a spell school.
 * RAW: untrained casters cannot cast spells from that school.
 *
 * @param {Actor} actor
 * @param {string} school
 * @returns {boolean}
 */
export function isActorTrainedInMagicSchool(actor, school) {
  return getMagicSkillLevel(actor, school) > 0;
}

/**
 * Resolve whether the caster has two free hands for spellcasting.
 * RAW: lacking two free hands applies a -20 casting penalty.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
function _hasTwoFreeHandsForCasting(actor) {
  if (!actor) return false;
  if (getActorCapabilityFlag(actor, "flags.uesrpg-3ev4.magic.ignoreSomaticComponents") || hasTalent(actor, "thoughtcaster")) {
    return true;
  }

  const conditions = actor?.system?.traits?.condition ?? {};
  // Movement-restricting states that would prevent free hand motions.
  if (conditions.restrained || conditions.paralyzed || conditions.immobilized || conditions.unconscious) return false;

  const items = Array.from(actor.items ?? []);
  const _hasToken = (item, key) => {
    const target = String(key ?? "").toLowerCase();
    if (!target) return false;
    const sys = item?.system ?? {};
    const structured = Array.isArray(sys.qualitiesStructuredInjected)
      ? sys.qualitiesStructuredInjected
      : (Array.isArray(sys.qualitiesStructured) ? sys.qualitiesStructured : []);
    if (structured.some(q => String(q?.key ?? q ?? "").toLowerCase() === target)) return true;
    const traits = Array.isArray(sys.qualitiesTraitsInjected)
      ? sys.qualitiesTraitsInjected
      : (Array.isArray(sys.qualitiesTraits) ? sys.qualitiesTraits : []);
    if (traits.some(t => String(t ?? "").toLowerCase() === target)) return true;
    return false;
  };

  const occupiedHandItems = items.filter((it) => {
    if (!it?.system?.equipped) return false;
    const itemType = String(it.type ?? "").toLowerCase();
    if (itemType === "weapon" || itemType === "ammunition") {
      // Chapter 7: Focus weapons count as a free casting hand for somatic checks.
      if (itemType === "weapon" && _hasToken(it, "focus")) return false;
      const hands = Number(it.system?.hands ?? 0);
      return Number.isFinite(hands) && hands > 0;
    }
    if (itemType === "armor" || itemType === "shield" || itemType === "equipment") {
      const isShield = isShieldItem(it, { allowLegacy: true });
      if (!isShield) return false;
      // Chapter 7: Targe counts as functionally free for hand-use checks.
      const shieldType = String(it.system?.shieldType ?? "").toLowerCase();
      if (shieldType === "targe" || it.system?.treatAsFreeHandForSmallOrGrapple === true) return false;
      return true;
    }
    return false;
  });

  return occupiedHandItems.length === 0;
}

/**
 * Compute the casting TN for a spell
 * @param {Actor} actor - The caster
 * @param {Item} spell - The spell being cast
 * @param {object} options - Casting options (manualModifier, etc.)
 * @returns {object} - { baseTN, spellcastingLevel, spellLevel, modifiers, finalTN }
 */
export function computeMagicCastingTN(actor, spell, options = {}) {
  const schoolRaw = _str(spell?.system?.school);
  const school = schoolRaw.toLowerCase();
  const schoolKey = _normalizeKey(schoolRaw || school);

  const difficultyKeyRaw = _str(options?.difficultyKey ?? options?.difficulty ?? "average");
  const diff = getDifficultyByKey(difficultyKeyRaw.trim().toLowerCase());
  const difficultyMod = _num(diff?.mod, 0);
  const circumstanceMod = _num(options?.circumstanceMod ?? options?.circumstanceModifier, 0);

  // Resolve the embedded magic skill for this school (PCs). We also use the
  // resolved skill name as a fallback key for AE authoring, in case the school
  // label and the item name don't normalize to the same token.
  const magicSkill = (actor?.type === "NPC")
    ? null
    : actor?.items?.find(i =>
      i.type === "magicSkill" &&
      _str(i.name).toLowerCase().includes(school)
    );
  const magicSkillKey = magicSkill ? _normalizeKey(magicSkill.name) : "";

  // Active Effects can contribute to casting TN via deterministic modifier keys.
  // Supported keys (additive/override semantics are handled by the evaluator):
  // - system.modifiers.tests.all
  // - system.modifiers.skills._all
  // - system.modifiers.skills.<schoolKey>
  // - system.modifiers.skills.<magicSkillKey> (fallback)
  // Optional virtual keys (no schema required):
  // - system.modifiers.magic.castingTN._all
  // - system.modifiers.magic.castingTN.<schoolKey>
  // - system.modifiers.magic.castingTN.<magicSkillKey> (fallback)
  const keySet = new Set([
    "system.modifiers.tests.all",
    "system.modifiers.skills._all",
    "system.modifiers.magic.castingTN._all"
  ]);
  if (schoolKey) {
    keySet.add(`system.modifiers.skills.${schoolKey}`);
    keySet.add(`system.modifiers.magic.castingTN.${schoolKey}`);
  }
  if (magicSkillKey && magicSkillKey !== schoolKey) {
    keySet.add(`system.modifiers.skills.${magicSkillKey}`);
    keySet.add(`system.modifiers.magic.castingTN.${magicSkillKey}`);
  }

  const aeKeys = Array.from(keySet);
  const aeResult = evaluateAEModifierKeysDetailed(actor, aeKeys, {
    context: {
      attackMode: "magic",
      itemUuid: String(spell?.uuid ?? "")
    },
    enforceConditions: true,
    dedupeByOrigin: true,
    debug: false
  });

  const aeTotalsByKey = aeResult?.totalsByKey ?? {};
  const aeModifier = aeKeys.reduce((sum, k) => sum + (Number(aeTotalsByKey?.[k] ?? 0) || 0), 0);

  const ignoresVerbalComponents = getActorCapabilityFlag(actor, "flags.uesrpg-3ev4.magic.ignoreVerbalComponents") || hasTalent(actor, "thoughtcaster");

  // NPCs do not use embedded Magic Skill items for casting.
  // They rely on the NPC sheet "Magic Profession" lane (system.professions.magic).
  // NPCs also do not have a canonical "spellcasting level" source, so we default to
  // treating them as capable of casting their own spells at their listed level.
  if (actor?.type === "NPC") {
    const sys = actor?.system ?? {};
    const baseTN = _num(sys?.professions?.magic ?? sys?.professionsWound?.magic, 0);
    
    // Use chosen casting level if provided (for scaling), else base spell level
    const chosenLevel = options?.level ?? options?.castLevel ?? null;
    const spellLevel = chosenLevel !== null ? Math.max(1, Math.min(7, Number(chosenLevel))) : getSpellLevel(spell);
    const spellcastingLevel = Math.max(0, spellLevel);

    const fatiguePenalty = _num(sys?.fatigue?.penalty, 0);
    const carryPenalty = _num(sys?.carry_rating?.penalty, 0);
    const woundPenalty = _num(sys?.woundPenalty, 0);
    const manualMod = _num(options?.manualModifier ?? options?.manualMod, 0);

    // RAW (Silence): Silenced characters suffer -20 casting TN (unable to speak).
    const isSilenced = Boolean(actor?.system?.traits?.condition?.silenced) && !ignoresVerbalComponents;
    const silencePenalty = isSilenced ? -20 : 0;
    const noFreeHandsPenalty = _hasTwoFreeHandsForCasting(actor) ? 0 : -20;

    const modifiers = [
      { label: "Base TN", value: baseTN, keepZero: true },
      { label: `Difficulty: ${diff?.label ?? "Average"}`, value: difficultyMod, keepZero: true },
      { label: "Spell Level Penalty", value: 0 },
      { label: "Fatigue Penalty", value: fatiguePenalty },
      { label: "Carry Penalty", value: carryPenalty },
      { label: "Wound Penalty", value: woundPenalty }
    ];

    if (silencePenalty !== 0) modifiers.push({ label: "Silenced (no verbal)", value: silencePenalty });
    if (noFreeHandsPenalty !== 0) modifiers.push({ label: "No free hands (somatic)", value: noFreeHandsPenalty });
    if (aeModifier !== 0) modifiers.push({ label: "Active Effects", value: aeModifier });
    if (circumstanceMod !== 0) modifiers.push({ label: "Circumstance Modifier", value: circumstanceMod });
    if (manualMod !== 0) modifiers.push({ label: "Manual Modifier", value: manualMod });

    const finalTN = Math.max(0, baseTN + difficultyMod + fatiguePenalty + carryPenalty + woundPenalty + silencePenalty + noFreeHandsPenalty + aeModifier + circumstanceMod + manualMod);
    return {
      baseTN,
      spellcastingLevel,
      spellLevel,
      modifiers,
      breakdown: modifiers,
      finalTN
    };
  }

  // Base TN from skill or WP bonus fallback
  const wpBonus = getActorWillpowerBonus(actor);
  const baseTN = magicSkill ? _num(magicSkill.system?.value, 0) : wpBonus;

  // Calculate spellcasting level
  const spellcastingLevel = getMagicSkillLevel(actor, school);

  // Spell level penalty: -10 per spell level above spellcasting level
  // Use chosen casting level if provided (for scaling), else base spell level
  const chosenLevel = options?.level ?? options?.castLevel ?? null;
  const spellLevel = chosenLevel !== null ? Math.max(1, Math.min(7, Number(chosenLevel))) : getSpellLevel(spell);
  const levelPenalty = Math.max(0, spellLevel - spellcastingLevel) * -10;

  // Apply standard actor penalties
  const fatiguePenalty = _num(actor?.system?.fatigue?.penalty, 0);
  const carryPenalty = _num(actor?.system?.carry_rating?.penalty, 0);
  const woundPenalty = _num(actor?.system?.woundPenalty, 0);

  // Manual modifier from options
  const manualMod = _num(options?.manualModifier ?? options?.manualMod, 0);

  // RAW (Silence): Silenced characters suffer -20 casting TN (unable to speak).
  const isSilenced = Boolean(actor?.system?.traits?.condition?.silenced) && !ignoresVerbalComponents;
  const silencePenalty = isSilenced ? -20 : 0;
  const noFreeHandsPenalty = _hasTwoFreeHandsForCasting(actor) ? 0 : -20;

  const modifiers = [
    { label: "Base TN", value: baseTN, keepZero: true },
    { label: `Difficulty: ${diff?.label ?? "Average"}`, value: difficultyMod, keepZero: true },
    { label: "Spell Level Penalty", value: levelPenalty },
    { label: "Fatigue Penalty", value: fatiguePenalty },
    { label: "Carry Penalty", value: carryPenalty },
    { label: "Wound Penalty", value: woundPenalty }
  ];

  if (silencePenalty !== 0) {
    modifiers.push({ label: "Silenced (no verbal)", value: silencePenalty });
  }

  if (noFreeHandsPenalty !== 0) {
    modifiers.push({ label: "No free hands (somatic)", value: noFreeHandsPenalty });
  }

  if (aeModifier !== 0) {
    modifiers.push({ label: "Active Effects", value: aeModifier });
  }

  if (circumstanceMod !== 0) {
    modifiers.push({ label: "Circumstance Modifier", value: circumstanceMod });
  }

  if (manualMod !== 0) {
    modifiers.push({ label: "Manual Modifier", value: manualMod });
  }

  const finalTN = baseTN + difficultyMod + levelPenalty + fatiguePenalty + carryPenalty + woundPenalty + silencePenalty + noFreeHandsPenalty + aeModifier + circumstanceMod + manualMod;

  return {
    baseTN,
    spellcastingLevel,
    spellLevel,
    modifiers,
    breakdown: modifiers,
    finalTN: Math.max(0, finalTN)
  };
}
