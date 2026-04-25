import { createDebugLogger } from "../../utils/debug.js";
import { evaluateNumericExpression } from "../../utils/numeric-expression.js";

const _debug = createDebugLogger("aeLifecycleDebug", "[UESRPG][AEValue]");
const TEMPLATE_RE = /{{\s*([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*)\s*}}/g;
const UNSAFE_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function _literalNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function _safeGetProperty(root, path) {
  if (!root || !path) return undefined;
  if (globalThis.foundry?.utils?.getProperty) return globalThis.foundry.utils.getProperty(root, path);

  let cur = root;
  for (const part of String(path).split(".")) {
    if (!part) return undefined;
    cur = cur?.[part];
    if (cur === undefined || cur === null) return cur;
  }
  return cur;
}

export function resolveNumericEffectValue(value, { actor = null, item = null, effect = null, debug = false } = {}) {
  const literal = _literalNumber(value);
  if (literal !== null) return literal;

  if (typeof value !== "string") return null;

  const roots = { actor, item, effect };
  let unresolved = false;
  const interpolated = value.replace(TEMPLATE_RE, (_match, path) => {
    const segments = String(path).split(".");
    if (segments.some((segment) => UNSAFE_SEGMENTS.has(segment))) {
      unresolved = true;
      if (debug) _debug("Rejected unsafe AE value template", { value, path });
      return "";
    }

    const rootName = segments.shift();
    const root = roots[rootName] ?? null;
    if (!root) {
      unresolved = true;
      if (debug) _debug("AE value template root is unavailable", { value, rootName });
      return "";
    }

    const resolved = _safeGetProperty(root, segments.join("."));
    const numeric = _literalNumber(resolved);
    if (numeric !== null) return String(numeric);
    if (typeof resolved === "string" && resolved.trim().length) return resolved.trim();

    unresolved = true;
    if (debug) {
      _debug("AE value template did not resolve to a numeric-compatible value", {
        value,
        resolved,
        effect: effect?.uuid ?? effect?.id ?? null
      });
    }
    return "";
  });

  if (unresolved) return null;

  const exact = _literalNumber(interpolated);
  if (exact !== null) return exact;

  const evaluated = evaluateNumericExpression(interpolated);
  if (evaluated === null && debug) {
    _debug("Unsupported AE numeric expression", {
      value,
      interpolated,
      effect: effect?.uuid ?? effect?.id ?? null
    });
  }
  return evaluated;
}
