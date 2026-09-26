import { requestAtomicUpdateDocument } from "../../utils/authority-proxy.js";

const RESOURCE_KEYS = new Set(["hp", "magicka", "stamina", "staminaPoints", "luck_points", "action_points"]);

/** Pure pool arithmetic, also used by batched strike effects. */
export function calculateResourceAdjustment(current, delta, { max = Infinity } = {}) {
  const previous = Number(current) || 0;
  const amount = Number(delta) || 0;
  const value = amount > 0
    ? Math.max(previous, Math.min(Number(max), previous + amount))
    : Math.max(0, previous + amount);
  return { previous, value, delta: value - previous };
}

/** Current-pool arithmetic only. Callers own damage, healing and cost rules. */
export async function adjustCurrentResource(actor, resource, delta, { requirePositiveMax = false } = {}) {
  if (!actor || !RESOURCE_KEYS.has(resource) || !Number.isFinite(Number(delta))) return null;
  let result = null;
  const ok = await requestAtomicUpdateDocument(actor, (fresh) => {
    const pool = fresh.system?.[resource];
    if (!pool) return null;
    const previous = Number(pool.value) || 0;
    const rawMax = Number(pool.max);
    const max = Number.isFinite(rawMax) && (!requirePositiveMax || rawMax > 0) ? rawMax : previous;
    result = calculateResourceAdjustment(previous, delta, { max });
    return result.delta ? { [`system.${resource}.value`]: result.value } : null;
  });
  return ok || result?.delta === 0 ? result : null;
}
