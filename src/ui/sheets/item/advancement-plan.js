/**
 * src/ui/sheets/item/advancement-plan.js
 *
 * Pure helper for computing the XP cost and validation result for a
 * pending item-sheet form submission that touches a skill/magic-skill/
 * combat-style item's rank or specializations.
 *
 * Extracted from SimpleItemSheetV2._buildAdvancementPlan to make the
 * item sheet a thinner orchestrator and this logic independently testable.
 */

import { hasTalent } from "../../../core/traits/talents-api.js";
import {
  buildSkillAdvancementPlan,
  normalizeRank as normalizeAdvancementRank,
  parseSpecializations as parseAdvancementSpecializations,
} from "../../../core/advancement/skill-advancement.js";

/**
 * Compute the advancement plan for a pending form submission on a skill-type item.
 *
 * Returns a result object:
 *   { ok: true,  actor, xpCost, nextXp }   — valid; proceed with update
 *   { ok: false, reason }                   — invalid; block update and show reason
 *   { ok: true,  xpCost: 0, actor }         — not a skill item or no actor; skip XP logic
 *
 * @param {Item} item      - The item document being edited.
 * @param {object} flatData - Flattened form data from _onFormSubmit.
 * @returns {{ ok: boolean, actor?: Actor, xpCost?: number, nextXp?: number, reason?: string }}
 */
export function buildAdvancementPlan(item, flatData) {
  const actor = item?.actor;
  if (!actor || actor.type !== "Player Character") return { ok: true, xpCost: 0, actor };
  if (!["skill", "magicSkill", "combatStyle"].includes(String(item.type ?? ""))) {
    return { ok: true, xpCost: 0, actor };
  }

  const oldRank = normalizeAdvancementRank(item.system?.rank);
  const newRank = normalizeAdvancementRank(foundry.utils.getProperty(flatData, "system.rank") ?? oldRank);
  const isLoreSkill = item.type === "skill" && String(item.name ?? "").trim().toLowerCase() === "lore";
  const hasScholarTalent = isLoreSkill && hasTalent(actor, "scholar");
  const rawSpecs = String(foundry.utils.getProperty(flatData, "system.trainedItems") ?? item.system?.trainedItems ?? "");
  const specCount = parseAdvancementSpecializations(rawSpecs).length;
  const rankValues = { untrained: -1, novice: 0, apprentice: 1, journeyman: 2, adept: 3, expert: 4, master: 5 };
  const rankValue = Number(rankValues[newRank] ?? -1);
  if (String(item.name ?? "").trim().toLowerCase() === "evade" && specCount > 0) {
    return { ok: false, reason: "Evade cannot have specializations (Chapter 3)." };
  }
  const baseSpecializationCap = Math.max(0, rankValue);
  const specializationCap = hasScholarTalent ? (baseSpecializationCap * 2) : baseSpecializationCap;
  const specializationUnitCost = hasScholarTalent ? 50 : 100;

  const plan = buildSkillAdvancementPlan({
    actor,
    item,
    flatData,
    options: {
      specializationCapOverride: specializationCap,
      specializationUnitCostOverride: specializationUnitCost,
    },
  });
  if (!plan.ok) {
    if (hasScholarTalent && specCount > specializationCap) {
      return { ok: false, reason: `Lore specializations exceed Scholar cap (${specializationCap}).` };
    }
    return plan;
  }

  let xpCost = Number(plan.xpCost ?? 0);

  if (item.type === "combatStyle") {
    const oldTE = Array.isArray(item.system?.trainedEquipment) ? item.system.trainedEquipment : [];
    const nextTE = Array.isArray(foundry.utils.getProperty(flatData, "system.trainedEquipment"))
      ? foundry.utils.getProperty(flatData, "system.trainedEquipment")
      : oldTE;
    const oldCount = oldTE.map(v => String(v ?? "").trim()).filter(Boolean).length;
    const newCount = nextTE.map(v => String(v ?? "").trim()).filter(Boolean).length;
    if (newCount > 10) {
      return { ok: false, reason: "Combat Style trained equipment is capped at 10 entries (Chapter 3)." };
    }
    const oldExpanded = Math.max(0, oldCount - 5);
    const newExpanded = Math.max(0, newCount - 5);
    if (newExpanded > oldExpanded) xpCost += (newExpanded - oldExpanded) * 25;

    const oldSA = item.system?.specialAdvantages ?? {};
    let oldEnabled = 0;
    let newEnabled = 0;
    const nextSAObj = foundry.utils.getProperty(flatData, "system.specialAdvantages") ?? {};
    const keys = new Set([...Object.keys(oldSA), ...Object.keys(nextSAObj)]);
    for (const k of keys) {
      const oldVal = Boolean(oldSA[k]);
      if (oldVal) oldEnabled += 1;
      const override = foundry.utils.getProperty(flatData, `system.specialAdvantages.${k}`);
      if ((override === undefined) ? oldVal : Boolean(override)) newEnabled += 1;
    }
    if (newEnabled > oldEnabled) {
      let added = newEnabled - oldEnabled;
      const rankChanged = oldRank !== newRank;
      if (oldEnabled === 0 && rankChanged && added > 0) added -= 1;
      if (added > 0) xpCost += added * 25;
    }
  }

  const currentXp = Number(actor?.system?.xp ?? 0);
  if (xpCost > currentXp) {
    return { ok: false, reason: `Not enough XP. Required: ${xpCost}, Available: ${currentXp}.` };
  }

  return { ok: true, actor, xpCost, nextXp: Math.max(0, currentXp - xpCost) };
}
