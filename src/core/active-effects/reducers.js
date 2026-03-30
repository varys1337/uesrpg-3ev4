export function createModifierTotal() {
  return { add: 0, override: null };
}

export function getModifierModeValue(modeName, fallback) {
  const modes = globalThis?.CONST?.ACTIVE_EFFECT_MODES;
  const runtimeValue = modes?.[modeName];
  return Number.isFinite(runtimeValue) ? runtimeValue : fallback;
}

export function isAddMode(mode) {
  return mode === "ADD" || mode === getModifierModeValue("ADD", 2);
}

export function isOverrideMode(mode) {
  return mode === "OVERRIDE" || mode === getModifierModeValue("OVERRIDE", 5);
}

export function toNumericEffectValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

export function applyNumericModifierChange(total, change) {
  if (!total || !change) return total;

  const value = toNumericEffectValue(change.value);
  if (value === null) return total;

  if (isOverrideMode(change.mode)) {
    total.override = value;
    total.add = 0;
    return total;
  }

  if (isAddMode(change.mode) && total.override == null && value !== 0) {
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

  const defaults = globalThis?.ActiveEffectConfig?.DEFAULT_PRIORITIES;
  if (defaults && typeof defaults === "object") {
    const mode = change?.mode;
    if (typeof mode === "number" && Number.isFinite(mode) && mode in defaults) {
      const numeric = Number(defaults[mode]);
      if (Number.isFinite(numeric)) return numeric;
    }
  }

  return 0;
}
