import { SYSTEM_ID, FLAG_SCOPE } from "../system/namespace.js";
import { getSystemFlagsWithFallback } from "../system/flags.js";

export const GENERIC_AE_KIND = "generic";

const EXPIRY_MODES = new Set(["turn-start", "turn-end", "combat-end", "point"]);
const EXPIRY_ACTORS = new Set(["source", "target"]);
const EXPIRY_ACTIONS = new Set(["delete", "suppress"]);
const STACK_POLICIES = new Set(["none", "refresh", "replace", "same-origin-refresh", "keep-strongest", "cap"]);
const SOURCE_TYPES = new Set(["feature", "spell", "alchemy", "combat", "manual"]);

function _str(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function _numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function _bool(value) {
  return value === true;
}

function _source(value) {
  const source = _str(value, "manual").toLowerCase();
  if (SOURCE_TYPES.has(source)) return source;
  if (source === "talent" || source === "trait" || source === "power") return "feature";
  if (source === "action" || source === "fear") return "combat";
  return "manual";
}

export function normalizeExpiryAction(value) {
  const action = _str(value, "delete").toLowerCase();
  return EXPIRY_ACTIONS.has(action) ? action : "delete";
}

export function normalizeGenericAEExpiry(value = null) {
  if (!value || typeof value !== "object") return null;

  const mode = _str(value.mode).toLowerCase();
  if (!EXPIRY_MODES.has(mode)) return null;

  const actor = _str(value.actor).toLowerCase();
  return {
    mode,
    actor: EXPIRY_ACTORS.has(actor) ? actor : null,
    combatId: _str(value.combatId) || null,
    combatantId: _str(value.combatantId) || null,
    round: _numOrNull(value.round),
    turn: _numOrNull(value.turn),
  };
}

export function normalizeGenericAEStack(value = null) {
  if (!value || typeof value !== "object") return null;

  const policy = _str(value.policy, "none").toLowerCase();
  const normalizedPolicy = STACK_POLICIES.has(policy) ? policy : "none";
  const max = _numOrNull(value.max);

  return {
    policy: normalizedPolicy,
    group: _str(value.group) || null,
    max: max == null ? null : Math.max(0, Math.trunc(max)),
    strengthKey: _str(value.strengthKey) || null,
  };
}

export function normalizeGenericAESuppressed(value = null) {
  if (!value || typeof value !== "object") {
    return {
      expired: false,
      atWorldTime: null,
      atCombatRound: null,
      reason: null,
    };
  }

  return {
    expired: _bool(value.expired),
    atWorldTime: _numOrNull(value.atWorldTime),
    atCombatRound: _numOrNull(value.atCombatRound),
    reason: _str(value.reason) || null,
  };
}

export function normalizeGenericAEMetadata(value = null) {
  if (!value || typeof value !== "object") return null;

  const kind = _str(value.kind, GENERIC_AE_KIND).toLowerCase();
  const expiry = normalizeGenericAEExpiry(value.expiry);
  const stack = normalizeGenericAEStack(value.stack);
  const suppressed = normalizeGenericAESuppressed(value.suppressed);

  return {
    kind: kind || GENERIC_AE_KIND,
    source: _source(value.source),
    expiry,
    expiryAction: normalizeExpiryAction(value.expiryAction),
    stack: stack ?? {
      policy: "none",
      group: null,
      max: null,
      strengthKey: null,
    },
    suppressed,
  };
}

export function buildGenericAEMetadata({
  source = "manual",
  expiry = null,
  expiryAction = "delete",
  stack = null,
  suppressed = null,
} = {}) {
  return normalizeGenericAEMetadata({
    kind: GENERIC_AE_KIND,
    source,
    expiry,
    expiryAction,
    stack,
    suppressed,
  });
}

export function getGenericAEMetadata(effectOrData) {
  const flags = getSystemFlagsWithFallback(effectOrData) ?? {};
  return normalizeGenericAEMetadata(flags.ae ?? null);
}

export function getSystemAEFlags(effectOrData) {
  return getSystemFlagsWithFallback(effectOrData) ?? {};
}

export function mergeGenericAEMetadataIntoFlags(flags = {}, aeMetadata = null) {
  const normalized = normalizeGenericAEMetadata(aeMetadata);
  if (!normalized) return flags ?? {};

  const existing = flags && typeof flags === "object" ? flags : {};
  const existingSystem = existing[FLAG_SCOPE] ?? existing[SYSTEM_ID] ?? {};
  const existingAE = normalizeGenericAEMetadata(existingSystem?.ae ?? null) ?? {};

  return {
    ...existing,
    [FLAG_SCOPE]: {
      ...existingSystem,
      ae: {
        ...existingAE,
        ...normalized,
      },
    },
  };
}

export function isGenericAESuppressed(effectOrData) {
  const meta = getGenericAEMetadata(effectOrData);
  return meta?.suppressed?.expired === true;
}

export function isConditionEffect(effectOrData) {
  const flags = getSystemFlagsWithFallback(effectOrData) ?? {};
  if (flags?.condition) return true;
  if (String(flags?.source ?? "").trim().toLowerCase() === "condition") return true;

  const group = String(flags?.effectGroup ?? "").trim().toLowerCase();
  if (group.startsWith("condition.")) return true;

  return false;
}
