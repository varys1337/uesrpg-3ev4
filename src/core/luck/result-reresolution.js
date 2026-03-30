import { cloneFlagState } from "../../utils/clone.js";
import { SYSTEM_ID } from "../constants.js";
import { resolveLiveLuckSide } from "./result-reresolution/shared.js";
import { applyLuckSkillTestMutation } from "./result-reresolution/skill-test.js";
import {
  applyLuckCombatMutation,
  combatLaneHasTerminalState,
  getCombatAffectedDefenders,
} from "./result-reresolution/combat-opposed.js";
import {
  applyLuckSkillOpposedMutation,
  isSkillOpposedUnsafe,
} from "./result-reresolution/skill-opposed.js";
import { applyLuckCharOpposedMutation } from "./result-reresolution/char-opposed.js";
import {
  applyLuckMagicOpposedMutation,
  getMagicAffectedDefenders,
  magicLaneHasTerminalState,
} from "./result-reresolution/magic-opposed.js";

export function canMutateLuckResult(message, info, side, { classifyMessage } = {}) {
  const classify = classifyMessage ?? (() => null);
  const { live, liveInfo, liveSide } = resolveLiveLuckSide(message, info, side, classify);
  if (!liveInfo || !liveSide) return { ok: false, reason: "Test state could not be resolved." };
  if (!liveSide.result) return { ok: false, reason: "This side has no result to modify." };

  switch (liveInfo.type) {
    case "skillTest":
      return { ok: true, reason: "" };
    case "combatOpposed": {
      const raw = live?.flags?.[SYSTEM_ID]?.opposed;
      if (!raw) return { ok: false, reason: "Combat card state unavailable." };
      const data = cloneFlagState(raw);
      const affected = getCombatAffectedDefenders(data, liveSide);
      if (affected.some((defender) => combatLaneHasTerminalState(data, defender))) {
        return { ok: false, reason: "Luck can no longer modify this combat card because downstream resolution has already been consumed." };
      }
      return { ok: true, reason: "" };
    }
    case "skillOpposed": {
      const raw = live?.flags?.[SYSTEM_ID]?.skillOpposed;
      const data = raw ? cloneFlagState(raw.state ?? raw) : null;
      if (!data) return { ok: false, reason: "Skill opposed state unavailable." };
      if (isSkillOpposedUnsafe(data)) {
        return { ok: false, reason: "Luck is blocked after this special-action opposed result has resolved." };
      }
      return { ok: true, reason: "" };
    }
    case "charOpposed":
      return { ok: true, reason: "" };
    case "magicOpposed": {
      const raw = live?.flags?.[SYSTEM_ID]?.magicOpposed;
      if (!raw) return { ok: false, reason: "Magic card state unavailable." };
      const data = cloneFlagState(raw.state ?? raw);
      const affected = getMagicAffectedDefenders(data, liveSide);
      if (affected.some((defender) => magicLaneHasTerminalState(data, defender))) {
        return { ok: false, reason: "Luck can no longer modify this spell because damage or effects have already advanced." };
      }
      return { ok: true, reason: "" };
    }
    default:
      return { ok: false, reason: "Unsupported card type." };
  }
}

export async function applyLuckResultMutation(message, info, side, newResult, { extraContext = {}, classifyMessage } = {}) {
  if (!message || !info || !side || !newResult) return false;
  const guard = canMutateLuckResult(message, info, side, { classifyMessage });
  if (!guard.ok) {
    ui.notifications?.warn?.(guard.reason || "This test can no longer be modified by Luck.");
    return false;
  }

  switch (info.type) {
    case "skillTest":
      return applyLuckSkillTestMutation(message, newResult, extraContext);
    case "combatOpposed":
      return applyLuckCombatMutation(message, side, newResult, extraContext, classifyMessage);
    case "skillOpposed":
      return applyLuckSkillOpposedMutation(message, side, newResult, extraContext, classifyMessage);
    case "charOpposed":
      return applyLuckCharOpposedMutation(message, side, newResult, extraContext, classifyMessage);
    case "magicOpposed":
      return applyLuckMagicOpposedMutation(message, side, newResult, extraContext, classifyMessage);
    default:
      return false;
  }
}
