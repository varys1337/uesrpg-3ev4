function _num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function executeActivation(...args) {
  const mod = await import("./activation-executor.js");
  return mod.executeActivation(...args);
}

export async function executeItemActivation(...args) {
  const mod = await import("./activation-executor.js");
  return mod.executeItemActivation(...args);
}

export async function executeItemMacroBestEffort(...args) {
  const mod = await import("./activation-executor.js");
  return mod.executeItemMacroBestEffort(...args);
}

// Keep sync behavior for callsites that build activation payloads inline.
export function buildSpecialActionActivation({ actionType = "action", apCost = 1, requiresTarget = true } = {}) {
  const mappedType = (actionType === "secondary" || actionType === "reaction" || actionType === "free")
    ? actionType
    : "action";

  return {
    enabled: true,
    actionType: mappedType,
    spendCosts: true,
    consumeUse: false,
    costs: {
      action_points: Math.max(0, _num(apCost)),
      stamina: 0,
      magicka: 0,
      luck_points: 0,
      health: 0
    },
    requirements: {
      requiresTarget: Boolean(requiresTarget),
      requiresEquippedWeapon: false,
      requiresMelee: false,
      requiresRanged: false,
      requiresHitLocation: false
    }
  };
}
