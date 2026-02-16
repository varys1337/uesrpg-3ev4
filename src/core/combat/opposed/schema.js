/**
 * src/core/combat/opposed/schema.js
 * Data structure manipulation extracted from opposed-workflow.js monolith
 */

import {
  _ensureBankedScaffold,
  _isBankChoicesEnabledForData,
  _getDefenderEntries,
  _allDefendersCommitted,
  _getBankCommitState,
  _anyActiveGMOnline
} from "./banking/state.js";

// Re-export banking functions for backward compatibility
export {
  _ensureBankedScaffold,
  _isBankChoicesEnabledForData,
  _getDefenderEntries,
  _allDefendersCommitted,
  _getBankCommitState,
  _anyActiveGMOnline
};

/**
 * Check if this is a multi-defender workflow
 * @param {Object} data - Opposed workflow data
 * @returns {boolean} True if multiple defenders
 */
export function _isMultiDefender(data) {
  return Array.isArray(data?.defenders) && data.defenders.length > 1;
}

/**
 * Resolve defender index from options
 * @param {Object} data - Opposed workflow data
 * @param {Object} opts - Options with defenderIndex/tokenUuid/actorUuid
 * @returns {number|null} Defender index or null
 */
export function _resolveDefenderIndex(data, opts = {}) {
  const list = _getDefenderEntries(data);
  if (!list.length) return null;

  const idx = Number(opts.defenderIndex ?? opts.defenderIdx ?? NaN);
  if (Number.isInteger(idx) && idx >= 0 && idx < list.length) return idx;

  const tokenUuid = String(opts.defenderTokenUuid ?? "").trim();
  if (tokenUuid) {
    const found = list.findIndex(d => String(d?.tokenUuid ?? "").trim() === tokenUuid);
    if (found >= 0) return found;
  }

  const actorUuid = String(opts.defenderActorUuid ?? "").trim();
  if (actorUuid) {
    const found = list.findIndex(d => String(d?.actorUuid ?? "").trim() === actorUuid);
    if (found >= 0) return found;
  }

  return 0;
}

/**
 * Select defender entry and return metadata
 * @param {Object} data - Opposed workflow data
 * @param {Object} opts - Selection options
 * @returns {Object} { defender, defenderIndex, defenders, isMulti }
 */
export function _selectDefenderEntry(data, opts = {}) {
  const defenders = _getDefenderEntries(data);
  const isMulti = _isMultiDefender(data);
  const defenderIndex = _resolveDefenderIndex(data, opts);
  const defender = (defenderIndex != null) ? defenders[defenderIndex] : null;
  if (defender) data.defender = defender;
  return { defender, defenderIndex, defenders, isMulti };
}

/**
 * Get outcome for a specific defender
 * @param {Object} data - Opposed workflow data
 * @param {Object} defender - Defender entry
 * @returns {Object|null} Outcome object
 */
export function _getDefenderOutcome(data, defender) {
  return _isMultiDefender(data) ? (defender?.outcome ?? null) : (data?.outcome ?? null);
}

/**
 * Set outcome for a specific defender
 * @param {Object} data - Opposed workflow data
 * @param {Object} defender - Defender entry
 * @param {Object} outcome - Outcome to set
 */
export function _setDefenderOutcome(data, defender, outcome) {
  if (_isMultiDefender(data)) {
    if (defender) defender.outcome = outcome;
  } else {
    data.outcome = outcome;
  }
}

/**
 * Get advantage for a specific defender
 * @param {Object} data - Opposed workflow data
 * @param {Object} defender - Defender entry
 * @returns {Object|null} Advantage object
 */
export function _getDefenderAdvantage(data, defender) {
  return _isMultiDefender(data) ? (defender?.advantage ?? null) : (data?.advantage ?? null);
}

/**
 * Set advantage for a specific defender
 * @param {Object} data - Opposed workflow data
 * @param {Object} defender - Defender entry
 * @param {Object} advantage - Advantage to set
 */
export function _setDefenderAdvantage(data, defender, advantage) {
  if (_isMultiDefender(data)) {
    if (defender) defender.advantage = advantage;
  } else {
    data.advantage = advantage;
  }
}

/**
 * Get inline damage data for a specific defender.
 * @param {Object} data - Opposed workflow data
 * @param {Object} defender - Defender entry
 * @returns {Object|null} Damage data object or null
 */
export function _getDefenderDamage(data, defender) {
  return _isMultiDefender(data) ? (defender?.damage ?? null) : (data?.damage ?? null);
}

/**
 * Set inline damage data for a specific defender.
 * @param {Object} data - Opposed workflow data
 * @param {Object} defender - Defender entry
 * @param {Object} damageObj - Damage data to set
 */
export function _setDefenderDamage(data, defender, damageObj) {
  if (_isMultiDefender(data)) {
    if (defender) defender.damage = damageObj;
  } else {
    data.damage = damageObj;
  }
}

/**
 * Get resolution state for a defender
 * @param {Object} data - Opposed workflow data
 * @param {Object} defender - Defender entry
 * @returns {Object} Resolution state objects
 */
export function _getDefenderResolutionState(data, defender) {
  if (_isMultiDefender(data)) {
    if (defender) {
      defender.advantageResolution = defender.advantageResolution ?? {};
      defender.advantageSpent = defender.advantageSpent ?? {};
      defender.defenderAdvantage = defender.defenderAdvantage ?? {};
      return {
        advantageResolution: defender.advantageResolution,
        advantageSpent: defender.advantageSpent,
        defenderAdvantage: defender.defenderAdvantage
      };
    }
    return { advantageResolution: {}, advantageSpent: {}, defenderAdvantage: {} };
  }

  data.advantageResolution = data.advantageResolution ?? {};
  data.advantageSpent = data.advantageSpent ?? {};
  data.defenderAdvantage = data.defenderAdvantage ?? {};
  return {
    advantageResolution: data.advantageResolution,
    advantageSpent: data.advantageSpent,
    defenderAdvantage: data.defenderAdvantage
  };
}

/**
 * Apply defender commit data to workflow data
 * @param {Object} data - Opposed workflow data
 * @param {Object} commit - Commit data to apply
 * @returns {boolean} True if data was modified
 */
export function _applyDefenderCommitToData(data, commit) {
  if (!commit || typeof commit !== "object") return false;
  data.defender = data.defender ?? {};
  let dirty = false;
  if (commit.defenseType != null) {
    data.defender.defenseType = String(commit.defenseType);
    dirty = true;
  }
  if (Object.prototype.hasOwnProperty.call(commit, "styleUuid")) {
    data.defender.styleUuid = commit.styleUuid ? String(commit.styleUuid) : null;
    dirty = true;
  }
  if (commit.label != null) {
    data.defender.label = String(commit.label);
    dirty = true;
  }
  if (commit.defenseLabel != null) {
    data.defender.defenseLabel = String(commit.defenseLabel);
    dirty = true;
  }
  if (commit.testLabel != null) {
    data.defender.testLabel = String(commit.testLabel);
    dirty = true;
  }
  if (commit.target != null && Number.isFinite(Number(commit.target))) {
    data.defender.target = Number(commit.target);
    dirty = true;
  }
  if (commit.targetLabel != null) {
    data.defender.targetLabel = String(commit.targetLabel);
    dirty = true;
  }
  if (commit.tn && typeof commit.tn === "object") {
    data.defender.tn = foundry.utils.deepClone(commit.tn);
    dirty = true;
  }
  return dirty;
}

/**
 * Apply attacker commit data to workflow data
 * @param {Object} data - Opposed workflow data
 * @param {Object} commit - Commit data to apply
 * @returns {boolean} True if data was modified
 */
export function _applyAttackerCommitToData(data, commit) {
  if (!commit || typeof commit !== "object") return false;
  data.attacker = data.attacker ?? {};
  let dirty = false;
  if (commit.hasDeclared != null) {
    data.attacker.hasDeclared = Boolean(commit.hasDeclared);
    dirty = true;
  }
  if (commit.itemUuid != null) {
    data.attacker.itemUuid = String(commit.itemUuid);
    dirty = true;
  }
  if (commit.label != null) {
    data.attacker.label = String(commit.label);
    dirty = true;
  }
  if (commit.variant != null) {
    data.attacker.variant = String(commit.variant);
    dirty = true;
  }
  if (commit.variantLabel != null) {
    data.attacker.variantLabel = String(commit.variantLabel);
    dirty = true;
  }
  if (commit.variantMod != null && Number.isFinite(Number(commit.variantMod))) {
    data.attacker.variantMod = Number(commit.variantMod);
    dirty = true;
  }
  if (commit.manualMod != null && Number.isFinite(Number(commit.manualMod))) {
    data.attacker.manualMod = Number(commit.manualMod);
    dirty = true;
  }
  if (commit.circumstanceMod != null && Number.isFinite(Number(commit.circumstanceMod))) {
    data.attacker.circumstanceMod = Number(commit.circumstanceMod);
    dirty = true;
  }
  if (commit.circumstanceLabel != null) {
    data.attacker.circumstanceLabel = String(commit.circumstanceLabel);
    dirty = true;
  }
  if (commit.totalMod != null && Number.isFinite(Number(commit.totalMod))) {
    data.attacker.totalMod = Number(commit.totalMod);
    dirty = true;
  }
  if (commit.baseTarget != null && Number.isFinite(Number(commit.baseTarget))) {
    data.attacker.baseTarget = Number(commit.baseTarget);
    dirty = true;
  }
  if (commit.target != null && Number.isFinite(Number(commit.target))) {
    data.attacker.target = Number(commit.target);
    dirty = true;
  }
  if (commit.targetLabel != null) {
    data.attacker.targetLabel = String(commit.targetLabel);
    dirty = true;
  }
  if (commit.tn && typeof commit.tn === "object") {
    data.attacker.tn = foundry.utils.deepClone(commit.tn);
    dirty = true;
  }
  return dirty;
}
