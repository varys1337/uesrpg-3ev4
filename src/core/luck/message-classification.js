import { SYSTEM_ID } from "../constants.js";
import { getFlagValueWithFallback } from "../system/flags.js";

export function normalizeLuckResult(result) {
  if (!result || typeof result !== "object") return null;
  return {
    isSuccess: Boolean(result.isSuccess),
    degree: Number(result.degree ?? 0) || 0,
    isCriticalSuccess: Boolean(result.isCriticalSuccess),
    isCriticalFailure: Boolean(result.isCriticalFailure),
    rollTotal: Number(result.rollTotal ?? NaN),
    target: Number(result.target ?? NaN),
    textual: String(result.textual ?? ""),
  };
}

export function classifyLuckMessage(message) {
  if (!message) return null;
  const sysFlags = message.flags?.[SYSTEM_ID] ?? {};

  const st = getFlagValueWithFallback(message, "skillTest");
  if (st && typeof st === "object" && st.actorUuid) {
    return {
      type: "skillTest",
      sides: [{
        role: "roller",
        label: String(st.skillName ?? "Test"),
        actorUuid: String(st.actorUuid),
        result: normalizeLuckResult(st),
        tn: Number(st.target ?? NaN) || null,
        defenderIndex: null,
      }],
      raw: st,
      staminaUsed: Boolean(getFlagValueWithFallback(message, "staminaUsedOnTest")),
      luckUsed: Boolean(getFlagValueWithFallback(message, "luckUsedOnTest")),
      luckBurned: Boolean(getFlagValueWithFallback(message, "luckBurned")),
      rerolled: Boolean(getFlagValueWithFallback(message, "reroll.used") || getFlagValueWithFallback(message, "reroll.isReroll")),
    };
  }

  const combatData = sysFlags.opposed;
  if (combatData && typeof combatData === "object" && combatData.attacker) {
    const sides = [];
    const a = combatData.attacker;
    sides.push({
      role: "attacker",
      label: String(a.label ?? a.tokenName ?? "Attacker"),
      actorUuid: String(a.actorUuid ?? ""),
      result: normalizeLuckResult(a.result),
      tn: Number(a.tn?.finalTN ?? NaN) || null,
      defenderIndex: null,
    });
    const defenders = Array.isArray(combatData.defenders) ? combatData.defenders : (combatData.defender ? [combatData.defender] : []);
    defenders.forEach((d, i) => {
      sides.push({
        role: "defender",
        label: String(d.testLabel ?? d.tokenName ?? "Defender"),
        actorUuid: String(d.actorUuid ?? ""),
        result: normalizeLuckResult(d.result),
        tn: Number(d.tn?.finalTN ?? NaN) || null,
        defenderIndex: defenders.length > 1 ? i : null,
      });
    });
    return {
      type: "combatOpposed",
      sides,
      raw: combatData,
      staminaUsed: Boolean(combatData.context?.staminaUsed),
      luckUsed: Boolean(combatData.context?.luckUsed),
      luckBurned: Boolean(combatData.context?.luckBurned),
      rerolled: Boolean(combatData.context?.rerollUsed === true),
    };
  }

  const skillOpposed = sysFlags.skillOpposed;
  if (skillOpposed && typeof skillOpposed === "object") {
    const data = skillOpposed.state ?? skillOpposed;
    if (data.attacker) {
      const sides = [{
        role: "attacker",
        label: String(data.attacker.skillLabel ?? data.attacker.tokenName ?? "Attacker"),
        actorUuid: String(data.attacker.actorUuid ?? ""),
        result: normalizeLuckResult(data.attacker.result),
        tn: Number(data.attacker.tn?.finalTN ?? NaN) || null,
        defenderIndex: null,
      }];
      if (data.defender) {
        sides.push({
          role: "defender",
          label: String(data.defender.skillLabel ?? data.defender.tokenName ?? "Defender"),
          actorUuid: String(data.defender.actorUuid ?? ""),
          result: normalizeLuckResult(data.defender.result),
          tn: Number(data.defender.tn?.finalTN ?? NaN) || null,
          defenderIndex: null,
        });
      }
      return {
        type: "skillOpposed",
        sides,
        raw: data,
        staminaUsed: Boolean(data.context?.staminaUsed),
        luckUsed: Boolean(data.context?.luckUsed),
        luckBurned: Boolean(data.context?.luckBurned),
        rerolled: Boolean(data.context?.rerollUsed === true),
      };
    }
  }

  const charOpposed = sysFlags.charOpposed;
  if (charOpposed && typeof charOpposed === "object") {
    const data = charOpposed.state ?? charOpposed;
    if (data.attacker) {
      const sides = [{
        role: "attacker",
        label: String(data.attacker.charLabel ?? data.attacker.tokenName ?? "Attacker"),
        actorUuid: String(data.attacker.actorUuid ?? ""),
        result: normalizeLuckResult(data.attacker.result),
        tn: Number(data.attacker.tn?.finalTN ?? NaN) || null,
        defenderIndex: null,
      }];
      if (data.defender) {
        sides.push({
          role: "defender",
          label: String(data.defender.charLabel ?? data.defender.tokenName ?? "Defender"),
          actorUuid: String(data.defender.actorUuid ?? ""),
          result: normalizeLuckResult(data.defender.result),
          tn: Number(data.defender.tn?.finalTN ?? NaN) || null,
          defenderIndex: null,
        });
      }
      return {
        type: "charOpposed",
        sides,
        raw: data,
        staminaUsed: Boolean(data.context?.staminaUsed),
        luckUsed: Boolean(data.context?.luckUsed),
        luckBurned: Boolean(data.context?.luckBurned),
        rerolled: Boolean(data.context?.rerollUsed === true),
      };
    }
  }

  const magicOpposed = sysFlags.magicOpposed;
  if (magicOpposed && typeof magicOpposed === "object") {
    const data = magicOpposed.state ?? magicOpposed;
    if (data.attacker) {
      const sides = [{
        role: "attacker",
        label: String(data.attacker.spellName ?? data.attacker.tokenName ?? "Caster"),
        actorUuid: String(data.attacker.actorUuid ?? ""),
        result: normalizeLuckResult(data.attacker.result),
        tn: Number(data.attacker.tn?.finalTN ?? NaN) || null,
        defenderIndex: null,
      }];
      const defenders = Array.isArray(data.defenders) ? data.defenders : (data.defender ? [data.defender] : []);
      defenders.forEach((d, i) => {
        if (d.noDefense || d.defenseType === "none" || d.defenseType === "-") return;
        sides.push({
          role: "defender",
          label: String(d.tokenName ?? "Defender"),
          actorUuid: String(d.actorUuid ?? ""),
          result: normalizeLuckResult(d.result),
          tn: Number(d.tn?.finalTN ?? NaN) || null,
          defenderIndex: defenders.length > 1 ? i : null,
        });
      });
      return {
        type: "magicOpposed",
        sides,
        raw: data,
        staminaUsed: Boolean(data.context?.staminaUsed),
        luckUsed: Boolean(data.context?.luckUsed),
        luckBurned: Boolean(data.context?.luckBurned),
        rerolled: Boolean(data.context?.rerollUsed === true),
      };
    }
  }

  return null;
}
