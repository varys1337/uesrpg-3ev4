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
export { adjustSensePenalty, applySenseLossPenaltyAdjustments } from "./sense-loss.js";

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
