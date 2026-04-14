function _normalizeRegistryEntry(entry, fallbackId = null) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id ?? fallbackId ?? "").trim();
  if (!id) return null;
  return { id, ...entry };
}

export function getStatusEffectConfigs() {
  const registry = CONFIG?.statusEffects ?? null;
  if (Array.isArray(registry)) {
    return registry
      .map((entry) => _normalizeRegistryEntry(entry))
      .filter(Boolean);
  }

  if (registry && typeof registry === "object") {
    return Object.entries(registry)
      .map(([id, entry]) => _normalizeRegistryEntry(entry, id))
      .filter(Boolean);
  }

  return [];
}

export function getStatusEffectConfigMap() {
  const map = new Map();
  for (const entry of getStatusEffectConfigs()) {
    const id = String(entry?.id ?? "").trim().toLowerCase();
    if (!id) continue;
    map.set(id, entry);
  }
  return map;
}

export function setStatusEffectConfigs(entries) {
  const registry = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const normalized = _normalizeRegistryEntry(entry);
    if (!normalized) continue;
    registry[normalized.id] = normalized;
  }
  CONFIG.statusEffects = registry;
  return registry;
}
