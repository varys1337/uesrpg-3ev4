/**
 * Shared selected-skill resolution and TN computation for opposed skill lanes.
 */

import { computeSkillTN } from "../../skill-tn.js";
import { computeTN } from "../../../combat/tn.js";
import { DEFAULT_COMBAT_STYLE_DEFENSE_TYPE } from "../core/constants.js";
import { _hasSpecializations, _resolveCombatStyleOrSkill } from "../core/skills.js";
import { _buildSensorySituationalMods, _maybeAddInvisibleTrackingPenalty } from "../core/helpers.js";
import { applySpecialActionMods } from "../helpers.js";

export function resolveSelectionAndComputeTN({
  side,
  actor,
  opponentActor,
  decl,
  defaultCharacteristic,
  data,
  resMods = [],
  includeInvisibleTrackingPenalty = false,
  includeHistskin = true,
  includeResModsForCombatStyle = true
} = {}) {
  const resolved = _resolveCombatStyleOrSkill(actor, decl?.skillUuid);
  if (!resolved) return { error: "missing-selection" };

  let tn;
  let skillLabel = resolved.name;
  let skillItem = null;
  let concussiveApplied = 0;

  const isCombatStyleLane = (resolved.type === "combatStyle") || (resolved.type === "profession" && resolved.professionKey === "combat");
  const situationalMods = _buildSensorySituationalMods(decl, actor, { skillName: resolved.name });
  const circumstanceMod = Number(decl?.circumstanceMod ?? 0) || 0;
  if (circumstanceMod) {
    situationalMods.push({ key: "circumstance", label: "Circumstance Modifier", value: circumstanceMod, source: "circumstance" });
  }

  if (Array.isArray(resMods) && resMods.length && (!isCombatStyleLane || includeResModsForCombatStyle)) {
    situationalMods.push(...resMods);
  }

  ({ concussiveApplied } = applySpecialActionMods({
    side,
    data,
    actor,
    attackerActor: (side === "attacker") ? actor : opponentActor,
    situationalMods
  }));

  if (resolved.type === "combatStyle" || (resolved.type === "profession" && resolved.professionKey === "combat")) {
    tn = computeTN({
      actor,
      role: side,
      ...(side === "defender" ? { defenseType: DEFAULT_COMBAT_STYLE_DEFENSE_TYPE } : {}),
      styleUuid: decl.skillUuid,
      manualMod: decl.manualMod,
      situationalMods,
      ...(side === "attacker" ? {
        context: {
          attackMode: "melee",
          opponentActor: opponentActor ?? null,
          opponentUuid: opponentActor?.uuid ?? null,
          selfSize: actor?.system?.size ?? null,
          opponentSize: opponentActor?.system?.size ?? null
        }
      } : {})
    });
    return {
      tn,
      skillLabel,
      skillItem,
      resolvedKind: resolved.type,
      concussiveApplied,
      situationalMods
    };
  }

  skillItem = resolved.item;

  if (resolved.type === "skill") {
    const allowSpec = _hasSpecializations(skillItem);
    if (includeHistskin && decl?.histskinUnderwater === true) {
      situationalMods.push({ key: "talent:histskin", label: "Histskin (Underwater)", value: +30, source: "talent" });
    }
    if (includeInvisibleTrackingPenalty) {
      _maybeAddInvisibleTrackingPenalty({
        skillLabel: skillItem?.name ?? resolved.name,
        targetActor: opponentActor,
        situationalMods
      });
    }
    tn = computeSkillTN({
      actor,
      skillItem,
      difficultyKey: decl.difficultyKey,
      manualMod: decl.manualMod,
      selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
      useSpecialization: allowSpec && decl.useSpec,
      situationalMods
    });
    skillLabel = skillItem?.name ?? resolved.name;
  } else {
    tn = computeSkillTN({
      actor,
      skillItem,
      difficultyKey: decl.difficultyKey,
      manualMod: decl.manualMod,
      selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
      situationalMods
    });
    skillLabel = resolved.name;
  }

  return {
    tn,
    skillLabel,
    skillItem,
    resolvedKind: resolved.type,
    concussiveApplied,
    situationalMods
  };
}

