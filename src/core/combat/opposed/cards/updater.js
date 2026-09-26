import { createOpposedCardUpdater } from '../../../opposed/shared/card-persistence.js';
import { reconcileBankedAutoRollRequest } from '../banking/state.js';
export { getChatMessageAuthorUser } from '../../../../utils/authority-proxy.js';

export const updateCard = createOpposedCardUpdater({
  scope: 'uesrpg-3ev4', key: 'opposed', version: 1, family: 'combat', wrapped: false,
  reconcile: reconcileBankedAutoRollRequest,
});

export function applyDefenderCommitToData(data, commit) {
  if (!commit || typeof commit !== "object") return false;
  data.defender = data.defender ?? {};
  let dirty = false;
  if (commit.defenseType != null) {
    const rawDefenseType = String(commit.defenseType).toLowerCase();
    if (rawDefenseType === "ward") {
      data.defender.defenseType = "block";
      data.defender.blockSource = "ward";
    } else {
      data.defender.defenseType = rawDefenseType;
    }
    dirty = true;
  }
  if (Object.prototype.hasOwnProperty.call(commit, "blockSource")) {
    data.defender.blockSource = commit.blockSource ? String(commit.blockSource).toLowerCase() : null;
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
 * Apply attacker commit data to workflow data.
 * 
 * Mutates `data.attacker` in place with commit properties.
 * 
 * @param {Object} data - Opposed workflow data object.
 * @param {Object} commit - Commit data from attacker.
 * @returns {boolean} - True if data was modified.
 */
export function applyAttackerCommitToData(data, commit) {
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
  if (commit.tn && typeof commit.tn === "object") {
    data.attacker.tn = foundry.utils.deepClone(commit.tn);
    dirty = true;
  }
  if (commit.pendingApCost != null && Number.isFinite(Number(commit.pendingApCost))) {
    data.attacker.pendingApCost = Number(commit.pendingApCost);
    dirty = true;
  }
  return dirty;
}
