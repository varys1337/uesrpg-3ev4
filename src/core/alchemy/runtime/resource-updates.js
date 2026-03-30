import { doTestRoll } from "../../../utils/degree-roll-helper.js";
import { emitAlchemyRoll3d } from "../shared.js";

export function resolveStaminaPaths(actor) {
  const usePoints = actor.system?.staminaPoints !== undefined;
  return {
    valuePath: usePoints ? "system.staminaPoints.value" : "system.stamina.value",
    value: Number(actor.system?.staminaPoints?.value ?? actor.system?.stamina?.value ?? 0),
    max: Number(actor.system?.staminaPoints?.max ?? actor.system?.stamina?.max ?? 0),
  };
}

export function getEnduranceTN(actor) {
  return Math.max(
    0,
    Number(
      actor?.system?.characteristics?.end?.total
      ?? actor?.system?.characteristics?.end?.value
      ?? 0
    ) || 0
  );
}

export async function rollEnduranceTest(actor, { label = "Endurance Test", modifier = 0 } = {}) {
  const tn = Math.max(0, getEnduranceTN(actor) + (Number(modifier ?? 0) || 0));
  if (tn <= 0) {
    return { ok: false, reason: `${actor?.name ?? "Target"} has no valid Endurance TN.` };
  }

  const result = await doTestRoll(actor, {
    target: tn,
    allowLucky: true,
    allowUnlucky: true,
  });
  emitAlchemyRoll3d(result?.roll ?? null);
  return {
    ok: true,
    tn,
    roll: result?.roll ?? null,
    total: Number(result?.rollTotal ?? result?.roll?.total ?? 0) || 0,
    success: Boolean(result?.isSuccess),
    label,
  };
}
