/**
 * src/core/skills/opposed/settings.js
 * Last options persistence for skill rolls
 */

import { SKILL_ROLL_SETTINGS_NS, SKILL_ROLL_LAST_OPTIONS_KEY } from "./constants.js";

export function _getLastSkillRollOptions() {
  try {
    const saved = game.settings.get(SKILL_ROLL_SETTINGS_NS, SKILL_ROLL_LAST_OPTIONS_KEY) ?? {};
    // Always exclude difficulty from saved options - force default to "average"
    delete saved.difficulty;
    delete saved.difficultyKey;
    return saved;
  } catch (_e) {
    return {};
  }
}

export async function _setLastSkillRollOptions(next) {
  try {
    // Do not persist difficulty choice - always default to "average"
    const sanitized = { ...next };
    delete sanitized.difficulty;
    delete sanitized.difficultyKey;
    await game.settings.set(SKILL_ROLL_SETTINGS_NS, SKILL_ROLL_LAST_OPTIONS_KEY, sanitized);
  } catch (_e) {
    // client setting may not exist if init hasn't run yet; fail silently
  }
}

export function _mergeLastSkillRollOptions(patch={}) {
  const prev = _getLastSkillRollOptions();
  const next = {...prev, ...patch};
  next.lastSkillUuidByActor = {...(prev.lastSkillUuidByActor||{}), ...(patch.lastSkillUuidByActor||{})};
  // Always force difficulty to "average" (do not persist)
  delete next.difficulty;
  delete next.difficultyKey;
  return next;
}

