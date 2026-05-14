import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { isActorUndead } from "../../traits/trait-registry.js";
import { isActorInStartedCombatEncounter } from "../../combat/combat-scope.js";
import { SYSTEM_ID } from "../system-id.js";
import {
  getActorResource,
  getTargetsFromContext,
  getActivationCostValues,
  normalizeUsage,
  shouldConsumeUsage
} from "./helpers.js";

const ACTION_TYPE_LABELS = {
  passive: "Passive",
  free: "Free",
  reaction: "Reaction",
  secondary: "Secondary",
  action: "Action",
  special: "Special"
};

export function getActivationActionTypeLabel(actionType) {
  const key = String(actionType ?? "action");
  return ACTION_TYPE_LABELS[key] ?? key;
}

export async function applyActivationActorFlags({ item, actor, activation } = {}) {
  if (!item || !actor) return { ok: true, applied: false };
  if (item.type !== "trait") return { ok: true, applied: false };
  if (String(actor?.type ?? "").toLowerCase().trim() !== "npc") return { ok: true, applied: false };

  const flags = activation?.flags ?? {};
  const updateData = {};
  if (flags.npcLuckAllowed === true) updateData[`flags.${SYSTEM_ID}.npcLuckAllowed`] = true;
  if (flags.npcEliteAllowed === true) updateData[`flags.${SYSTEM_ID}.npcEliteAllowed`] = true;
  if (!Object.keys(updateData).length) return { ok: true, applied: false };

  const ok = await requestUpdateDocument(actor, updateData);
  if (!ok) {
    ui.notifications?.warn?.(`Failed to apply NPC rule flags for ${item.name}.`);
    return { ok: false, applied: false };
  }
  return { ok: true, applied: true };
}

export function validateActivationContext({ actor, activation, context = {}, actorSnapshot = null } = {}) {
  const requirements = activation?.requirements ?? {};
  const targets = getTargetsFromContext(context);
  const snapshot = actorSnapshot ?? {};

  if (requirements.requiresTarget && targets.length === 0) {
    ui.notifications?.warn?.("This ability requires a target.");
    return { ok: false, reason: "requiresTarget" };
  }
  if (requirements.requiresEquippedWeapon && !snapshot.hasEquippedWeapon) {
    ui.notifications?.warn?.("This ability requires an equipped weapon.");
    return { ok: false, reason: "requiresEquippedWeapon" };
  }
  if (requirements.requiresMelee && !snapshot.hasEquippedMeleeWeapon) {
    ui.notifications?.warn?.("This ability requires an equipped melee weapon.");
    return { ok: false, reason: "requiresMelee" };
  }
  if (requirements.requiresRanged && !snapshot.hasEquippedRangedWeapon) {
    ui.notifications?.warn?.("This ability requires an equipped ranged weapon.");
    return { ok: false, reason: "requiresRanged" };
  }
  if (requirements.requiresHitLocation && !context?.hitLocation) {
    ui.notifications?.warn?.("This ability requires a hit location.");
    return { ok: false, reason: "requiresHitLocation" };
  }

  return { ok: true };
}

export async function applyActivationCosts({ actor, activation, label = "Ability" } = {}) {
  if (!activation?.spendCosts) return { ok: true, spent: false };
  if (!actor) return { ok: false, spent: false };

  const { ap: apCost, sp: spCost, mp: mpCost, lp: lpCost, hp: hpCost } = getActivationCostValues(activation.costs ?? {});
  if (!apCost && !spCost && !mpCost && !lpCost && !hpCost) return { ok: true, spent: false };

  const ap = getActorResource(actor, "action_points.value");
  const enforceAP = isActorInStartedCombatEncounter(actor);
  const sp = getActorResource(actor, "stamina.value");
  const mp = getActorResource(actor, "magicka.value");
  const lp = getActorResource(actor, "luck_points.value");
  const hp = getActorResource(actor, "hp.value");

  const missing = [];
  if (enforceAP && ap < apCost) missing.push("AP");
  if (sp < spCost) missing.push("SP");
  if (!missing.length && spCost > 0 && isActorUndead(actor) && (sp - spCost) < 0) {
    ui.notifications?.warn?.(`Undead cannot spend SP below 0 for ${label}.`);
    return { ok: false, spent: false };
  }
  if (mp < mpCost) missing.push("MP");
  if (lp < lpCost) missing.push("LP");
  if (hp < hpCost) missing.push("HP");

  if (missing.length) {
    ui.notifications?.warn?.(`Insufficient resources to activate ${label}: ${missing.join(", ")}`);
    return { ok: false, spent: false };
  }

  const updateData = {};
  if (enforceAP && apCost) updateData["system.action_points.value"] = ap - apCost;
  if (spCost) updateData["system.stamina.value"] = sp - spCost;
  if (mpCost) updateData["system.magicka.value"] = mp - mpCost;
  if (lpCost) updateData["system.luck_points.value"] = lp - lpCost;
  if (hpCost) updateData["system.hp.value"] = hp - hpCost;

  if (!Object.keys(updateData).length) return { ok: true, spent: false };

  const ok = await requestUpdateDocument(actor, updateData);
  if (!ok) {
    ui.notifications?.warn?.(`Failed to spend activation costs for ${label}.`);
    return { ok: false, spent: false };
  }
  return { ok: true, spent: true };
}

export async function consumeActivationUsage({ item, activation } = {}) {
  if (!item) return { ok: true, consumed: false, previous: null, current: null, source: null };
  if (!shouldConsumeUsage(activation)) return { ok: true, consumed: false, previous: null, current: null, source: null };

  const usage = normalizeUsage(activation);
  if (!usage.source) return { ok: true, consumed: false, previous: null, current: null, source: null };
  if (Number(usage.max) <= 0 && Number(usage.current) <= 0) {
    return { ok: true, consumed: false, previous: null, current: null, source: null };
  }

  const current = Math.max(0, Number(usage.current ?? 0) || 0);
  if (current <= 0) {
    ui.notifications?.warn?.(`No uses remaining for ${item.name}.`);
    return { ok: false, consumed: false, previous: null, current: null, source: usage.source };
  }

  const nextValue = current - 1;
  const updateData = {};
  const rollbackData = {};

  if (usage.source === "usage") {
    updateData["system.activation.usage.current"] = nextValue;
    rollbackData["system.activation.usage.current"] = current;

    const legacy = activation?.uses ?? null;
    const hasLegacy = legacy && (legacy.max != null || legacy.reset != null || legacy.value != null);
    if (hasLegacy) {
      updateData["system.activation.uses.value"] = nextValue;
      rollbackData["system.activation.uses.value"] = Number(legacy.value ?? 0) || 0;
      if (usage.max != null) {
        updateData["system.activation.uses.max"] = usage.max;
        rollbackData["system.activation.uses.max"] = legacy.max ?? 0;
      }
      const period = String(usage.period ?? "").trim();
      const legacyReset = (period === "shortRest" || period === "longRest" || period === "daily" || period === "none")
        ? period
        : (period === "day" ? "daily" : null);
      if (legacyReset) {
        updateData["system.activation.uses.reset"] = legacyReset;
        rollbackData["system.activation.uses.reset"] = legacy.reset ?? "none";
      }
    }
  } else {
    updateData["system.activation.uses.value"] = nextValue;
    rollbackData["system.activation.uses.value"] = current;

    const previousUsage = activation?.usage ?? {};
    updateData["system.activation.usage.current"] = nextValue;
    rollbackData["system.activation.usage.current"] = Number(previousUsage.current ?? 0) || 0;
    if (usage.max != null) {
      updateData["system.activation.usage.max"] = usage.max;
      rollbackData["system.activation.usage.max"] = previousUsage.max ?? 0;
    }
    if (usage.period != null) {
      updateData["system.activation.usage.period"] = usage.period;
      rollbackData["system.activation.usage.period"] = previousUsage.period ?? "";
    }
  }

  const ok = await requestUpdateDocument(item, updateData);
  if (!ok) {
    ui.notifications?.warn?.(`Failed to consume a use for ${item.name}.`);
    return { ok: false, consumed: false, previous: null, current: null, source: usage.source };
  }

  return { ok: true, consumed: true, previous: current, current: nextValue, source: usage.source, rollback: rollbackData };
}
