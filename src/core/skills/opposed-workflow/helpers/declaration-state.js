/**
 * Shared declaration helpers for attacker/defender opposed skill lanes.
 */

import { _bothSidesCommitted } from "../core/schema.js";

export function readCommittedDeclaration(sideData, sideName) {
  const decl = sideData?.declaration ?? null;
  if (!decl) {
    ui.notifications.warn(`${sideName} has not committed choices yet.`);
    return null;
  }
  return decl;
}

export function buildQuickDeclaration({ selectedSkillUuid, defaults, defaultCharacteristic }) {
  return {
    skillUuid: selectedSkillUuid,
    difficultyKey: defaults.difficultyKey,
    manualMod: defaults.manualMod,
    useSpec: defaults.useSpec,
    selectedCharacteristicKey: defaults.selectedCharacteristicKey ?? defaultCharacteristic,
    applyBlinded: (defaults.applyBlinded ?? true),
    applyDeafened: (defaults.applyDeafened ?? true),
    isInterrogationTest: false
  };
}

export function commitDeclarationToCardState({ data, side, declaration }) {
  if (!data || !side || !declaration) return data;

  data[side] = data[side] ?? {};
  data[side].declaration = declaration;
  data[side].skillUuid = declaration.skillUuid;
  data[side].committedAt = data[side].committedAt ?? Date.now();

  data.context = data.context ?? {};
  if (_bothSidesCommitted(data)) {
    data.context.phase = "ready";
  } else if (!data.context.phase || data.context.phase === "pending") {
    data.context.phase = (side === "attacker") ? "waitingDefender" : "waitingAttacker";
  }
  if (!data.context.waitingSince) data.context.waitingSince = Date.now();

  return data;
}

