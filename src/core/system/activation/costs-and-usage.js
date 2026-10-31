import { requestUpdateDocument, requestAtomicUpdateDocument } from "../../../utils/authority-proxy.js";
import { isActorInStartedCombatEncounter } from "../../combat/combat-scope.js";
import { spendFromPools } from "../../stamina/stamina-spend.js";
import { SYSTEM_ID } from "../system-id.js";
import {
  getActorResource,
  getTargetsFromContext,
  getActivationCostValues,
  normalizeUsage,
  normalizeUsagePeriod,
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

/** Pure preview shared by confirmation, reporting and the committing mutator. */
export function getActivationCostPreview({ actor, activation, label = 'Ability' } = {}) {
  const costs = activation?.enabled !== false && activation?.spendCosts
    ? getActivationCostValues(activation.costs ?? {})
    : { ap: 0, sp: 0, mp: 0, lp: 0, hp: 0 };
  if (!isActorInStartedCombatEncounter(actor)) costs.ap = 0;
  const fields = { ap: 'action_points', sp: 'stamina', mp: 'magicka', lp: 'luck_points', hp: 'hp' };
  const missing = [];
  const updateData = {};
  for (const [key, resource] of Object.entries(fields)) {
    const cost = Number(costs[key]) || 0;
    if (!cost) continue;
    const current = getActorResource(actor, resource + '.value');
    if (key === 'sp') {
      const temporary = Math.max(0, getActorResource(actor, 'stamina.temp'));
      // Until Stamina overdraw and Fatigue share a recoverable representation,
      // do not silently create an untracked deficit. The GM handles it manually.
      if (!actor || Math.max(0, current) + temporary < cost) {
        missing.push('SP');
        continue;
      }
      const { newSp, newTemp } = spendFromPools({ sp: current, temp: temporary, cost });
      if (newSp !== current) updateData['system.stamina.value'] = newSp;
      if (newTemp !== temporary) updateData['system.stamina.temp'] = newTemp;
      continue;
    }
    if (!actor || current < cost) missing.push(key.toUpperCase());
    updateData['system.' + resource + '.value'] = current - cost;
  }
  return {
    ok: missing.length === 0, costs, updateData,
    reason: missing.length ? `Insufficient resources to activate ${label}: ${missing.join(', ')}.${missing.includes('SP') ? ' Stamina spending below 0 and its Fatigue must be handled by the GM.' : ''}` : null,
    summary: Object.entries(costs).filter(([,cost]) => cost > 0).map(([key,cost]) => `${key.toUpperCase()}: ${cost}`).join(', '),
  };
}

export async function applyActivationCosts({ actor, activation, label = 'Ability', requireConfirmed = false, operationGuard = null } = {}) {
  let preview = getActivationCostPreview({ actor, activation, label });
  if (!preview.ok) { ui.notifications?.warn?.(preview.reason); return { ok: false, spent: false }; }
  // A formerly tracked action may no longer have an AP preview after combat
  // ends. Validate the original context even when there is no resource patch.
  try { operationGuard?.(); }
  catch (error) {
    if (requireConfirmed) throw error;
    const reason = String(error?.message ?? "The activation context changed.");
    ui.notifications?.warn?.(reason);
    return { ok: false, spent: false, reason };
  }
  if (!Object.keys(preview.updateData).length) return { ok: true, spent: false, costs: preview.costs };
  const ok = await requestAtomicUpdateDocument(actor, (fresh) => {
    operationGuard?.();
    preview = getActivationCostPreview({ actor: fresh, activation, label });
    return preview.ok ? preview.updateData : null;
  });
  if (requireConfirmed && !ok && preview.ok) throw Object.assign(new Error("Activation cost spending was not confirmed."), { uncertain: true });
  if (!ok) ui.notifications?.warn?.(preview.reason ?? `Failed to spend activation costs for ${label}.`);
  return { ok, spent: ok, costs: preview.costs, uncertain: !ok && preview.ok, reason: preview.reason };
}

function buildActivationUsageChange({ item, activation } = {}) {
  if (!item) return { ok: true, consumed: false, previous: null, current: null, source: null };
  if (!shouldConsumeUsage(activation)) return { ok: true, consumed: false, previous: null, current: null, source: null };

  const usage = normalizeUsage(activation);
  if (!usage.source || (Number(usage.max) <= 0 && Number(usage.current) <= 0)) {
    const reason = `Configure a use count for ${item.name} before activating it.`;
    ui.notifications?.warn?.(reason);
    return { ok: false, consumed: false, previous: null, current: null, source: usage.source, reason };
  }

  const current = Math.max(0, Number(usage.current ?? 0) || 0);
  if (current <= 0) {
    ui.notifications?.warn?.(`No uses remaining for ${item.name}.`);
    return { ok: false, consumed: false, previous: null, current: null, source: usage.source, reason: "No uses remaining." };
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

  return { ok: true, consumed: true, previous: current, current: nextValue, source: usage.source,
    rollback: rollbackData, appliedPatch: updateData };
}

export async function consumeActivationUsage({ item, activation, operationGuard = null } = {}) {
  if (!item || !shouldConsumeUsage(activation)) return { ok: true, consumed: false };
  let planned = null;
  const confirmed = await requestAtomicUpdateDocument(item, fresh => {
    operationGuard?.();
    planned = buildActivationUsageChange({ item: fresh, activation: fresh.system?.activation ?? activation });
    return planned.ok ? planned.appliedPatch ?? null : null;
  });
  if (planned && (!planned.ok || !planned.appliedPatch)) return planned;
  if (confirmed && planned) return planned;
  ui.notifications?.warn?.(`Failed to consume a use for ${item.name}.`);
  return { ok: false, consumed: false, uncertain: true, reason: "Use consumption was not confirmed." };
}

/**
 * Restore configured rest-limited uses after the actor's rest has settled.
 * Each embedded item is re-read under the existing document update lock.
 * An unconfirmed item write is returned as a failure so the rest is reported
 * as partial; it must not be retried as a new rest without reviewing it.
 */
function buildRestUsageResetPatch(activation, eligiblePeriods) {
  const usage = normalizeUsage(activation);
  const max = Number(usage.max);
  if (!eligiblePeriods.has(usage.period) || !Number.isFinite(max) || max <= 0) return {};

  const patch = {};
  const currentPath = usage.source === "usage" ? "system.activation.usage.current" : "system.activation.uses.value";
  if (Number(usage.current) < max) patch[currentPath] = max;

  // Existing synchronized legacy values follow the authoritative modern
  // configuration, but empty or independently configured values stay intact.
  const legacy = activation?.uses;
  const legacyPeriod = normalizeUsagePeriod(legacy?.reset);
  if (usage.source === "usage" && Number(legacy?.max) === max
    && (!legacyPeriod || legacyPeriod === "none" || legacyPeriod === usage.period)
    && Number(legacy?.value) < max) patch["system.activation.uses.value"] = max;
  return patch;
}

export async function resetActivationUsageOnRest(actor, { restType, operationId = null } = {}) {
  const type = String(restType ?? "").trim().toLowerCase();
  if (!actor?.items || !["short", "long"].includes(type)) {
    return { ok: false, reset: [], failures: ["The actor or rest type is unavailable."] };
  }

  const eligiblePeriods = type === "long" ? new Set(["shortRest", "longRest"]) : new Set(["shortRest"]);
  const reset = [];
  const failures = [];
  const items = Array.from(actor.items).filter(item => ["trait", "talent", "power"].includes(item.type));
  for (const item of items) {
    // Avoid requesting write authority for features that have no matching reset.
    if (!Object.keys(buildRestUsageResetPatch(item.system?.activation, eligiblePeriods)).length) continue;

    let calculated = false;
    let needsWrite = false;
    const confirmed = await requestAtomicUpdateDocument(item, fresh => {
      calculated = true;
      // A deleted or replaced item is not an eligible target for this rest.
      if (actor.items.get(fresh.id)?.uuid !== fresh.uuid) return null;
      const patch = buildRestUsageResetPatch(fresh.system?.activation, eligiblePeriods);
      needsWrite = Object.keys(patch).length > 0;
      return needsWrite ? patch : null;
    }, { render: false, perfKind: "rest", operationId });

    if (!calculated || (needsWrite && !confirmed)) failures.push(item.name || item.id);
    else if (needsWrite) reset.push(item.name || item.id);
  }
  return { ok: failures.length === 0, reset, failures };
}
