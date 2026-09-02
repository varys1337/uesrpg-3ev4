/**
 * src/core/advancement/skill-advancement.js
 *
 * Shared, deterministic XP spending planner for skill-like Items:
 * - skill
 * - magicSkill
 * - combatStyle
 *
 * This module is used by both:
 * - ItemSheetV2 (to validate and deduct XP when changing ranks/specializations/equipment)
 * - Chargen Spend XP AppV2 (SpendXpMenuAppV2)
 *
 * Rules source (RAW): Chapter 2 "Spend XP" table and Favored Characteristics rule.
 * - Skill ranks advanced in order.
 * - Specializations cost 100 XP each and are capped by skill rank value.
 * - Expanding a Combat Style (adding one trained equipment entry) costs 25 XP.
 * - Favored skills (governed by a favored characteristic) cost 75% (round down to nearest 5).
 */

import { _num as _asNumber } from "../../utils/coerce.js";
import { CHARACTERISTIC_KEYS, CHARACTERISTIC_LABELS, normalizeCharacteristicKey } from "../../utils/maps/characteristics.js";
import { getMaxPurchasableSkillRankKeyFromXpTotal } from "./progression.js";

export const SKILL_RANK_ORDER = Object.freeze([
  "untrained",
  "novice",
  "apprentice",
  "journeyman",
  "adept",
  "expert",
  "master",
]);

const RANK_INDEX = Object.freeze({
  untrained: 0,
  novice: 1,
  apprentice: 2,
  journeyman: 3,
  adept: 4,
  expert: 5,
  master: 6,
});

/** Incremental XP cost to *purchase* the given rank step. */
export const SKILL_RANK_XP_COST = Object.freeze({
  novice: 100,
  apprentice: 200,
  journeyman: 300,
  adept: 400,
  expert: 500,
  master: 800,
});

const _RANK_VALUE = Object.freeze({
  untrained: null,
  novice: 0,
  apprentice: 1,
  journeyman: 2,
  adept: 3,
  expert: 4,
  master: 5,
});

/**
 * Normalize an Item.system.rank value to a canonical key in SKILL_RANK_ORDER.
 * Accepts legacy/label values (e.g., "(2) Journeyman") defensively.
 */
export function normalizeRank(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "untrained";
  if (SKILL_RANK_ORDER.includes(s)) return s;

  // Defensive label matching.
  if (s.includes("master")) return "master";
  if (s.includes("expert")) return "expert";
  if (s.includes("adept")) return "adept";
  if (s.includes("journeyman")) return "journeyman";
  if (s.includes("apprentice")) return "apprentice";
  if (s.includes("novice")) return "novice";
  if (s.includes("untrained")) return "untrained";
  return "untrained";
}

/**
 * Parse a specialization string (comma-separated or one-per-line) into a
 * trimmed, de-duplicated list (case-insensitive).
 */
export function parseSpecializations(raw) {
  const text = String(raw ?? "");
  if (!text.trim()) return [];
  const parts = text
    .split(/[,\n\r]+/g)
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Apply favored discount (75%) and round down to nearest multiple of 5.
 */
export function discountCostIfFavored(cost, favored) {
  const base = Math.max(0, _asNumber(cost, 0));
  if (!favored) return base;
  return Math.floor((base * 0.75) / 5) * 5;
}

function _parseGoverningKeys(governingRaw) {
  const raw = String(governingRaw ?? "").trim().toLowerCase();
  if (!raw) return new Set();

  const keys = new Set();
  for (const characteristicKey of CHARACTERISTIC_KEYS) {
    const label = String(CHARACTERISTIC_LABELS[characteristicKey] ?? "").toLowerCase();
    const pattern = new RegExp(`\\b(?:${characteristicKey}|${label})\\b`);
    if (!pattern.test(raw)) continue;
    keys.add(normalizeCharacteristicKey(characteristicKey));
  }
  return keys;
}

/**
 * Determine whether a skill-like Item is "favored" for the actor.
 * A skill is favored if at least one governing characteristic is favored.
 */
export function isFavoredSkillForActor(actor, governingRaw) {
  const keys = _parseGoverningKeys(governingRaw);
  if (!keys.size) return false;

  const cha = actor?.system?.characteristics ?? {};
  for (const k of keys) {
    if (Boolean(cha?.[k]?.favored)) return true;
  }
  return false;
}

/**
 * Campaign skill experience gating.
 * Returns the maximum rank index (in SKILL_RANK_ORDER) purchasable at xpTotal.
 */
export function getMaxPurchasableRankIndexFromXpTotal(xpTotal) {
  const key = getMaxPurchasableSkillRankKeyFromXpTotal(xpTotal);
  return RANK_INDEX[key] ?? RANK_INDEX.novice;
}

function _getFlat(flatData, path) {
  // flatData is typically a flattened object with dotted keys.
  if (!flatData || typeof flatData !== "object") return undefined;
  if (path in flatData) return flatData[path];
  return undefined;
}

function _buildProposedTrainedEquipment(item, flatData) {
  const direct = _getFlat(flatData, "system.trainedEquipment");
  if (Array.isArray(direct)) return direct.map((v) => String(v ?? ""));

  // Support flattened index updates: system.trainedEquipment.0, ...
  const prefix = "system.trainedEquipment.";
  let hasIndexed = false;
  for (const k in (flatData ?? {})) {
    if (k.startsWith(prefix)) {
      hasIndexed = true;
      break;
    }
  }
  if (!hasIndexed) return Array.isArray(item?.system?.trainedEquipment)
    ? item.system.trainedEquipment.map((v) => String(v ?? ""))
    : [];

  const base = Array.isArray(item?.system?.trainedEquipment)
    ? item.system.trainedEquipment.map((v) => String(v ?? ""))
    : [];
  const next = base.length ? [...base] : Array.from({ length: 10 }, () => "");
  for (const [k, v] of Object.entries(flatData ?? {})) {
    if (!k.startsWith(prefix)) continue;
    const idx = Number(k.slice(prefix.length));
    if (!Number.isInteger(idx) || idx < 0) continue;
    next[idx] = String(v ?? "");
  }
  return next;
}

function _countNonEmpty(arr) {
  if (!Array.isArray(arr)) return 0;
  return arr.map((v) => String(v ?? "").trim()).filter(Boolean).length;
}

function _rankValue(rankKey) {
  return _RANK_VALUE[rankKey] ?? null;
}

/**
 * Build an advancement "plan" for a set of pending item changes.
 *
 * @param {object} args
 * @param {Actor|null} args.actor
 * @param {Item} args.item
 * @param {object} args.flatData - flattened update payload (dotted keys)
 * @param {object} [args.options]
 * @param {number|null} [args.options.specializationCapOverride]
 * @param {number|null} [args.options.specializationUnitCostOverride]
 * @param {boolean} [args.options.bypassXpPayment=false]
 * @returns {{ ok: boolean, xpCost: number, nextXp: number, actor: Actor|null, reason?: string }}
 */
export function buildSkillAdvancementPlan({ actor, item, flatData, options = {} } = {}) {
  // Unowned items can't spend XP.
  if (!actor) return { ok: true, xpCost: 0, nextXp: 0, actor: null };
  if (!item) return { ok: true, xpCost: 0, nextXp: _asNumber(actor?.system?.xp, 0), actor };

  const currentXp = Math.max(0, _asNumber(actor.system?.xp, 0));
  const xpTotal = Math.max(0, _asNumber(actor.system?.xpTotal, 0));
  const bypassXpPayment = options?.bypassXpPayment === true;

  const governingRaw = String(item.system?.governingCha ?? item.system?.baseCha ?? "");
  const favored = isFavoredSkillForActor(actor, governingRaw);

  const currentRank = normalizeRank(item.system?.rank);
  const proposedRank = normalizeRank(_getFlat(flatData, "system.rank") ?? currentRank);
  const currentIdx = RANK_INDEX[currentRank] ?? -1;
  const proposedIdx = RANK_INDEX[proposedRank] ?? -1;

  if (currentIdx < 0 || proposedIdx < 0) {
    return { ok: false, xpCost: 0, nextXp: currentXp, actor, reason: "Unrecognized skill rank value." };
  }

  // Compute effective rank (used for specialization cap) after proposed change.
  const effectiveRank = proposedRank;
  const effectiveRankValue = _rankValue(effectiveRank);

  let xpCost = 0;

  // ── Rank advancement ───────────────────────────────────────────────
  if (proposedIdx > currentIdx) {
    // RAW: ranks advance in order.
    if (proposedIdx !== currentIdx + 1) {
      return {
        ok: false,
        xpCost: 0,
        nextXp: currentXp,
        actor,
        reason: "Skill ranks must be purchased in order (one step at a time).",
      };
    }

    // Campaign skill experience gating by Total XP.
    const maxIdx = getMaxPurchasableRankIndexFromXpTotal(xpTotal);
    if (!bypassXpPayment && proposedIdx > maxIdx) {
      return {
        ok: false,
        xpCost: 0,
        nextXp: currentXp,
        actor,
        reason: `Total XP (${xpTotal}) does not allow purchasing rank '${proposedRank}'.`,
      };
    }

    const base = _asNumber(SKILL_RANK_XP_COST[proposedRank], 0);
    const stepCost = discountCostIfFavored(base, favored);
    xpCost += stepCost;
  }

  // ── Specializations (skill + magicSkill) ───────────────────────────
  // Combat Styles have a trainedItems field in the schema, but specializations
  // are only meaningful for skill/magicSkill in RAW. We still enforce the cap
  // and cost if a style is using the field intentionally.
  const trainedItemsKey = "system.trainedItems";
  const hasSpecChange = trainedItemsKey in (flatData ?? {});
  if (hasSpecChange) {
    const currentSpecs = parseSpecializations(item.system?.trainedItems ?? "");
    const proposedSpecs = parseSpecializations(_getFlat(flatData, trainedItemsKey) ?? "");
    const capOverride = Number(options?.specializationCapOverride);
    const cap = Number.isFinite(capOverride)
      ? Math.max(0, Math.trunc(capOverride))
      : (Number.isInteger(effectiveRankValue) ? effectiveRankValue : 0);
    if (proposedSpecs.length > cap) {
      return {
        ok: false,
        xpCost: 0,
        nextXp: currentXp,
        actor,
        reason: `Too many specializations: ${proposedSpecs.length}. Cap is ${cap} for rank '${effectiveRank}'.`,
      };
    }

    const delta = Math.max(0, proposedSpecs.length - currentSpecs.length);
    if (delta > 0) {
      const unitCostOverride = Number(options?.specializationUnitCostOverride);
      const unitCost = Number.isFinite(unitCostOverride) ? Math.max(0, unitCostOverride) : 100;
      const base = unitCost * delta;
      xpCost += discountCostIfFavored(base, favored);
    }
  }

  // ── Combat Style trained equipment expansions ───────────────────────
  // RAW: each additional trained equipment entry costs 25 XP.
  if (item.type === "combatStyle") {
    let hasTrainedEquipmentChange = false;
    for (const k in (flatData ?? {})) {
      if (k === "system.trainedEquipment" || k.startsWith("system.trainedEquipment.")) {
        hasTrainedEquipmentChange = true;
        break;
      }
    }
    if (hasTrainedEquipmentChange) {
      const currentArr = Array.isArray(item.system?.trainedEquipment) ? item.system.trainedEquipment : [];
      const proposedArr = _buildProposedTrainedEquipment(item, flatData);
      const currentCount = _countNonEmpty(currentArr);
      const proposedCount = _countNonEmpty(proposedArr);
      const delta = Math.max(0, proposedCount - currentCount);
      if (delta > 0) {
        xpCost += 25 * delta;
      }
    }
  }

  xpCost = Math.max(0, Math.trunc(xpCost));
  if (!bypassXpPayment && xpCost > currentXp) {
    return {
      ok: false,
      xpCost,
      nextXp: currentXp,
      actor,
      reason: `Not enough XP. Required ${xpCost}, available ${currentXp}.`,
    };
  }

  return {
    ok: true,
    xpCost,
    nextXp: bypassXpPayment ? currentXp : Math.max(0, currentXp - xpCost),
    waivedXp: bypassXpPayment ? xpCost : 0,
    actor,
  };
}
