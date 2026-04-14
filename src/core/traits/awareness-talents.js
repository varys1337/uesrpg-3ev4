/**
 * @module traits/awareness-talents
 * @description Awareness-talent automation layer.
 *
 * Implemented talents:
 *  - Honed Senses: halves penalties from sense-loss (round toward 0).
 *  - One with All: negates penalties from sense-loss.
 *  - Keen Intuition: on a successful Observe test, replace DoS with Observe rank.
 *  - Hyper Awareness: on a successful Evade test, choose rolled DoS or Observe rank.
 *
 * Design constraints:
 *  - Schema-safe: no new system.* data fields are introduced.
 *  - Pure, testable functions; callers decide where to wire them.
 */

import { hasTalent, getSkillRank, normalizeTalentKey } from "./talents-api.js";
import { promptDoSReplacement } from "./combat-talents.js";
import { _num as _asNumber } from "./_primitives.js";

const SENSE_LOSS_MOD_KEYS = new Set(["blinded", "deafened"]);

function _isSenseLossMod(mod) {
  if (!mod || typeof mod !== "object") return false;
  const key = String(mod.key ?? "").trim().toLowerCase();
  if (!key) return false;
  if (!SENSE_LOSS_MOD_KEYS.has(key)) return false;

  // Determine "sense-loss" by explicit key + explicit source where possible.
  // - New-tagged path: source === "sense-loss".
  // - Back-compat path: source === "condition".
  const src = String(mod.source ?? "").trim().toLowerCase();
  return (src === "sense-loss" || src === "condition" || !src);
}

/**
 * Adjust a penalty originating from sense-loss.
 *
 * Rules:
 *  - One with All: penalty becomes 0.
 *  - Honed Senses: penalty is halved, rounding toward 0.
 *  - Legacy sense-loss overrides: "negate" → 0, "halve" → half.
 *  - Otherwise unchanged.
 *
 * @param {number} penalty
 * @param {Actor} actor
 * @returns {number}
 */
export function adjustSensePenalty(penalty, actor) {
  const p = _asNumber(penalty, 0);
  if (!actor || !p) return p;

  if (hasTalent(actor, "onewithall")) return 0;
  if (hasTalent(actor, "honedsenses")) return Math.trunc(p / 2);

  const reMode = actor?.system?._reOverrides?.["system.senses.lossReduction"] ?? null;
  if (reMode === "negate") return 0;
  if (reMode === "halve") return Math.trunc(p / 2);

  return p;
}

/**
 * Apply Honed Senses / One with All adjustments to a mutable situationalMods array.
 * Only applies to modifiers that are explicitly tagged as sense-loss (or back-compat condition mods)
 * and use the condition keys "blinded"/"deafened".
 *
 * If a modifier has `applyMode: "offset"`, we treat its value as already applied elsewhere
 * (e.g., condition AE on Observe) and convert the adjustment into a delta (after - before).
 *
 * @param {Array<object>} situationalMods
 * @param {Actor} actor
 */
export function applySenseLossPenaltyAdjustments(situationalMods, actor) {
  if (!Array.isArray(situationalMods) || !actor) return;

  const hasAll = hasTalent(actor, "onewithall");
  const hasHoned = !hasAll && hasTalent(actor, "honedsenses");
  const reMode = actor?.system?._reOverrides?.["system.senses.lossReduction"] ?? null;
  const hasRE = (reMode === "negate" || reMode === "halve");
  if (!hasAll && !hasHoned && !hasRE) return;

  for (const mod of situationalMods) {
    if (!_isSenseLossMod(mod)) continue;
    if (mod?._awarenessAdjusted) continue;
    const before = _asNumber(mod.value, 0);
    if (!before) {
      mod._awarenessAdjusted = true;
      continue;
    }

    const after = adjustSensePenalty(before, actor);
    if (after === before) {
      mod._awarenessAdjusted = true;
      continue;
    }

    const mode = String(mod.applyMode ?? "").toLowerCase();
    mod.value = (mode === "offset") ? (after - before) : after;

    // Keep labels stable but indicate automation in a lightweight way.
    const label = String(mod.label ?? "").trim();
    if (label) {
      if (hasAll && !/one with all/i.test(label)) mod.label = `${label} (One with All)`;
      else if (hasHoned && !/honed senses/i.test(label)) mod.label = `${label} (Honed Senses)`;
    }

    // Normalize source for consistent downstream categorization.
    mod.source = "sense-loss";
    if (!mod.conditionKey && mod.key) mod.conditionKey = String(mod.key);
    mod._awarenessAdjusted = true;
  }
}

function _isObserveSkillName(skillName) {
  return normalizeTalentKey(skillName) === "observe";
}

function _canPromptChoice(actor) {
  return Boolean(game?.user?.isGM || actor?.isOwner);
}

async function _applyObserveRankReplacement({
  actor,
  skillName,
  result,
  talentSlug,
  title,
  choiceKey,
  allowPrompt = false,
  allowSkill = () => false
} = {}) {
  if (!actor || !result || typeof result !== "object") return false;
  if (!result.isSuccess) return false;
  if (!allowSkill(skillName)) return false;
  if (!hasTalent(actor, talentSlug)) return false;

  const observeRank = getSkillRank(actor, "Observe");
  if (!Number.isFinite(observeRank) || observeRank <= 0) return false;

  const rolledDoS = Math.max(1, _asNumber(result.degree, 1));
  const stored = String(result?.[choiceKey] ?? "").trim().toLowerCase();

  // If we are not allowed to prompt, honor stored choice when present.
  if (!allowPrompt || !_canPromptChoice(actor)) {
    if (stored === "rank") {
      result.degree = observeRank;
      result.textual = `${observeRank} DoS`;
      return true;
    }
    return false;
  }

  // Avoid duplicate prompts for the same roll object.
  const promptKey = `${choiceKey}Prompted`;
  if (result?.[promptKey]) {
    if (stored === "rank") {
      result.degree = observeRank;
      result.textual = `${observeRank} DoS`;
      return true;
    }
    return false;
  }

  const picked = await promptDoSReplacement({
    title,
    rolledDoS,
    rankDoS: observeRank,
    rankLabel: "Observe Rank"
  });
  const choice = String(picked?.choice ?? "rolled").toLowerCase();
  result[choiceKey] = choice;
  result[promptKey] = true;
  if (choice === "rank") {
    result.degree = observeRank;
    result.textual = `${observeRank} DoS`;
    return true;
  }
  return false;
}

/**
 * Apply Keen Intuition to an already-computed test result.
 *
 * Rule:
 *  - If the test is Observe and it succeeded, replace DoS (result.degree) with Observe skill rank.
 *  - Do not modify rollTotal.
 *  - Do not modify failures.
 *
 * @param {Actor} actor
 * @param {string} skillName
 * @param {object} result - doTestRoll/computeResultFromRollTotal result shape (must include isSuccess/degree/textual)
 */
export async function applyKeenIntuitionToResult(actor, skillName, result, { allowPrompt = false } = {}) {
  return _applyObserveRankReplacement({
    actor,
    skillName,
    result,
    talentSlug: "keenintuition",
    title: "Keen Intuition",
    choiceKey: "keenIntuitionChoice",
    allowPrompt,
    allowSkill: _isObserveSkillName
  });
}

export async function applyHyperAwarenessToResult(actor, skillName, result, { allowPrompt = false } = {}) {
  if (!actor || !result || typeof result !== "object") return false;
  if (!result.isSuccess) return false;
  if (normalizeTalentKey(skillName) !== "evade") return false;
  if (!hasTalent(actor, "hyperawareness")) return false;

  const observeRank = getSkillRank(actor, "Observe");
  if (!Number.isFinite(observeRank) || observeRank <= 0) return false;

  const rolledDoS = Math.max(1, _asNumber(result.degree, 1));
  const stored = String(result?.hyperAwarenessChoice ?? "").trim().toLowerCase();

  if (!allowPrompt || !_canPromptChoice(actor)) {
    if (stored === "rank") {
      result.degree = observeRank;
      result.textual = `${observeRank} DoS`;
      return true;
    }
    return false;
  }

  if (result?.hyperAwarenessPrompted) {
    if (stored === "rank") {
      result.degree = observeRank;
      result.textual = `${observeRank} DoS`;
      return true;
    }
    return false;
  }

  const picked = await promptDoSReplacement({
    title: "Hyper Awareness",
    rolledDoS,
    rankDoS: observeRank,
    rankLabel: "Observe Rank"
  });
  const choice = String(picked?.choice ?? "rolled").toLowerCase();
  result.hyperAwarenessChoice = choice;
  result.hyperAwarenessPrompted = true;

  if (choice === "rank") {
    result.degree = observeRank;
    result.textual = `${observeRank} DoS`;
    return true;
  }
  return false;
}
