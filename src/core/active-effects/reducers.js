import { getActiveEffectChangeTypes, getEffectChangeTypeValue } from "../../utils/compat.js";
import { resolveNumericEffectValue } from "./value-resolver.js";

export function createModifierTotal() {
  return { add: 0, override: null };
}

export function isAddMode(changeOrType) {
  return getEffectChangeTypeValue(changeOrType) === "add";
}

export function isOverrideMode(changeOrType) {
  return getEffectChangeTypeValue(changeOrType) === "override";
}

export function isCustomMode(changeOrType) {
  return getEffectChangeTypeValue(changeOrType) === "custom";
}

export function toNumericEffectValue(value, context = {}) {
  return resolveNumericEffectValue(value, context);
}

export function applyNumericModifierChange(total, change) {
  if (!total || !change) return total;

  const value = toNumericEffectValue(change.value);
  if (value === null) return total;

  if (isOverrideMode(change)) {
    total.override = value;
    total.add = 0;
    return total;
  }

  if (isAddMode(change) && total.override == null && value !== 0) {
    total.add += value;
  }

  return total;
}

export function mergeModifierTotals(totals = [], { accumulateOverrides = false } = {}) {
  const merged = createModifierTotal();
  for (const total of totals) {
    if (!total) continue;
    if (total.override != null) {
      merged.override = accumulateOverrides
        ? Number(merged.override ?? 0) + Number(total.override)
        : Number(total.override);
      merged.add = 0;
      continue;
    }
    if (merged.override == null) {
      merged.add += Number(total.add ?? 0);
    }
  }
  return merged;
}

export function getEffectChangePriority(change) {
  const explicit = Number(change?.priority);
  if (Number.isFinite(explicit)) return explicit;

  const defaults = getActiveEffectChangeTypes();
  const type = getEffectChangeTypeValue(change);
  const numeric = Number(defaults?.[type]);
  if (Number.isFinite(numeric)) return numeric;

  return 0;
}
