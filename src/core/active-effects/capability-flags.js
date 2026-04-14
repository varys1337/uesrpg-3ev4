import { getApplicableEffectsCached } from "./collect.js";
import { isAddMode, isOverrideMode } from "./reducers.js";
import { getEffectChanges } from "../../utils/compat.js";

function _toBoolean(value) {
  if (value === true || value === false) return value;
  if (value == null) return null;
  if (typeof value === "number") return value !== 0;

  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return null;
}

/**
 * Read a canonical capability flag from actor AE changes and temporary flag state.
 *
 * Resolution:
 * - Actor temporary override / prepared flag value wins when present.
 * - Otherwise walk currently-applicable actor + transfer effects.
 * - OVERRIDE changes replace the current boolean.
 * - ADD changes can only assert true.
 *
 * @param {Actor} actor
 * @param {string} key
 * @param {{fallback?: boolean}} [options]
 * @returns {boolean}
 */
export function getActorCapabilityFlag(actor, key, { fallback = false } = {}) {
  const path = String(key ?? "").trim();
  if (!actor || !path) return Boolean(fallback);

  const direct = foundry.utils.getProperty(actor, path);
  const directBool = _toBoolean(direct);
  if (directBool !== null) return directBool;

  let value = null;
  const effects = getApplicableEffectsCached(actor);
  for (const effect of effects) {
    const changes = getEffectChanges(effect);
    for (const change of changes) {
      if (String(change?.key ?? "") !== path) continue;
      const next = _toBoolean(change?.value);
      if (next === null) continue;

      if (_isOverrideMode(change)) value = next;
      else if (_isAddMode(change) && next === true) value = true;
    }
  }

  if (value !== null) return value;
  return Boolean(fallback);
}
