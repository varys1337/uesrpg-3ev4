/**
 * Shared Foundry compatibility helpers for ActiveEffect change arrays and types.
 *
 * AE create/update call sites must build their changes payload through this module so
 * v14 document-shape handling and change-type normalization stay consistent.
 */

const _LEGACY_NUMERIC_MODE_MAP = Object.freeze({
  0: "custom",
  1: "multiply",
  2: "add",
  3: "downgrade",
  4: "upgrade",
  5: "override",
});

const _CHANGE_TYPE_PRIORITY_FALLBACK = Object.freeze({
  add: 20,
  subtract: 20,
  multiply: 10,
  downgrade: 30,
  upgrade: 40,
  override: 50,
  custom: 0,
});

const _DOCUMENT_UUID_PREFIXES = Object.freeze([
  "Actor",
  "ActiveEffect",
  "Cards",
  "ChatMessage",
  "Combat",
  "Compendium",
  "Item",
  "JournalEntry",
  "Macro",
  "Playlist",
  "RollTable",
  "Scene",
  "Token",
]);

const _DOCUMENT_UUID_RE = new RegExp(`^(?:${_DOCUMENT_UUID_PREFIXES.join("|")})\\.[^\\s]+$`);

export function getFoundryGeneration() {
  return Number(game?.release?.generation ?? 0) || 0;
}

export function isV14() {
  return getFoundryGeneration() >= 14;
}

export function normalizeActiveEffectOrigin(value) {
  if (value == null) return null;

  const documentUuid = typeof value?.uuid === "string" ? value.uuid.trim() : "";
  if (documentUuid && _DOCUMENT_UUID_RE.test(documentUuid)) return documentUuid;

  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw) return null;
  return _DOCUMENT_UUID_RE.test(raw) ? raw : null;
}

export function getActiveEffectChangeTypes() {
  const runtimeTypes = globalThis.CONST?.ACTIVE_EFFECT_CHANGE_TYPES;
  if (runtimeTypes && typeof runtimeTypes === "object") {
    return runtimeTypes;
  }
  return _CHANGE_TYPE_PRIORITY_FALLBACK;
}

export function getEffectChangeType(name, fallback = "add") {
  const requested = String(name ?? "").trim().toLowerCase();
  const types = getActiveEffectChangeTypes();
  if (requested && Object.prototype.hasOwnProperty.call(types, requested)) return requested;

  const fallbackName = String(fallback ?? "").trim().toLowerCase();
  if (fallbackName && Object.prototype.hasOwnProperty.call(types, fallbackName)) return fallbackName;
  return "add";
}

export function getEffectChangeTypeValue(changeOrType, fallback = "add") {
  if (changeOrType && typeof changeOrType === "object") {
    if (typeof changeOrType.type === "string" && String(changeOrType.type).trim()) {
      return getEffectChangeType(changeOrType.type, fallback);
    }
    return normalizeEffectChangeMode(changeOrType.mode, fallback);
  }
  return normalizeEffectChangeMode(changeOrType, fallback);
}

export function normalizeEffectChangeMode(mode, fallback = "add") {
  if (typeof mode === "string") {
    const normalized = String(mode).trim().toLowerCase();
    if (!normalized) return getEffectChangeType(fallback);
    if (/^-?\d+$/.test(normalized)) {
      const numeric = Number(normalized);
      return _LEGACY_NUMERIC_MODE_MAP[numeric] ?? getEffectChangeType(fallback);
    }
    return getEffectChangeType(normalized, fallback);
  }

  if (typeof mode === "number" && Number.isFinite(mode)) {
    return _LEGACY_NUMERIC_MODE_MAP[mode] ?? getEffectChangeType(fallback);
  }

  return getEffectChangeType(fallback);
}

export function getEffectChangeModeValue(changeOrType, fallback = "add") {
  const type = getEffectChangeTypeValue(changeOrType, fallback);
  for (const [mode, typeName] of Object.entries(_LEGACY_NUMERIC_MODE_MAP)) {
    if (typeName === type) return Number(mode);
  }
  return _CHANGE_TYPE_PRIORITY_FALLBACK.custom;
}

export function getEffectChanges(effect) {
  const source = Array.isArray(effect?.system?.changes)
    ? effect.system.changes
    : (Array.isArray(effect?.changes) ? effect.changes : []);
  return normalizeEffectChanges(source);
}

export function normalizeEffectChange(change) {
  const next = {
    ...(change && typeof change === "object" ? change : {}),
    type: getEffectChangeTypeValue(change),
  };
  if (Object.prototype.hasOwnProperty.call(next, "mode")) delete next.mode;
  return next;
}

export function normalizeEffectChanges(changes) {
  return (Array.isArray(changes) ? changes : []).map((change) => normalizeEffectChange(change));
}

export function buildEffectChange({ key, type = undefined, mode = undefined, value = "", priority, phase, ...rest } = {}) {
  const change = {
    ...rest,
    key: String(key ?? ""),
    type: getEffectChangeTypeValue(type ?? mode),
    value,
  };
  if (priority !== undefined) change.priority = priority;
  if (phase !== undefined) change.phase = phase;
  return change;
}

export function buildEffectChangesData(changes) {
  const nextChanges = normalizeEffectChanges(changes);
  const payload = { changes: nextChanges };
  if (isV14()) payload["system.changes"] = nextChanges;
  return payload;
}

export function buildEffectChangesUpdate(changes) {
  const nextChanges = normalizeEffectChanges(changes);
  return isV14()
    ? { "system.changes": nextChanges }
    : { changes: nextChanges };
}
