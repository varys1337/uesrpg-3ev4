/**
 * applyDefaults(target, defaults, { coerce=true, ignorePaths=[], clone=true, strict=false })
 *
 * Idempotently applies a "defaults object" onto a target object:
 * - Missing keys (undefined/null) are set from defaults
 * - Wrong-typed keys are coerced where safe (numbers/booleans/strings), otherwise replaced by defaults
 * - Arrays are ensured to be arrays (defaulting to [])
 * - Objects are ensured to be plain objects; nested defaults are applied recursively
 * - Null defaults fill only missing values and never overwrite meaningful existing data
 * - Strict mode rejects unrecognized shapes instead of replacing them with defaults
 *
 * This utility is intentionally conservative to avoid breaking existing worlds:
 * it never deletes keys and never overwrites values that already match the expected type.
 */

function _isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function _isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function _coerceNumber(value) {
  if (_isFiniteNumber(value)) return value;
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function _coerceBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 0) return false;
    if (value === 1) return true;
    return undefined;
  }
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    return undefined;
  }
  return undefined;
}

function _coerceString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function _deepClone(obj) {
  // Foundry's documented cloning utility.
  if (globalThis.foundry?.utils?.deepClone) return globalThis.foundry.utils.deepClone(obj);
  // Native structuredClone where available.
  if (globalThis.structuredClone) return globalThis.structuredClone(obj);
  // Fallback for plain data.
  return JSON.parse(JSON.stringify(obj));
}

/**
 * @template T
 * @param {T} target
 * @param {object} defaults
 * @param {{coerce?: boolean, ignorePaths?: string[], clone?: boolean, strict?: boolean}} [options]
 * @returns {{ result: T, changed: boolean }}
 */
export function applyDefaults(target, defaults, options = {}) {
  const coerce = options.coerce !== false;
  const clone = options.clone !== false;
  const strict = options.strict === true;
  const ignore = new Set(Array.isArray(options.ignorePaths) ? options.ignorePaths : []);
  const root = (target && typeof target === "object")
    ? (clone ? _deepClone(target) : target)
    : /** @type {any} */ ({});
  let changed = false;

  /**
   * @param {any} node
   * @param {any} def
   * @param {string[]} path
   * @returns {any}
   */
  function apply(node, def, path) {
    const pathKey = path.join(".");
    if (pathKey && ignore.has(pathKey)) return node;

    if (def === null) {
      if (node === undefined) {
        changed = true;
        return null;
      }
      return node;
    }

    const defIsArray = Array.isArray(def);
    const defIsObject = _isPlainObject(def);
    const defType = defIsArray ? "array" : (defIsObject ? "object" : typeof def);

    if (defType === "number") {
      if (node === undefined || node === null) {
        changed = true;
        return def;
      }
      if (_isFiniteNumber(node)) return node;
      const coerced = coerce ? _coerceNumber(node) : undefined;
      if (coerced !== undefined) {
        changed = true;
        return coerced;
      }
      if (strict) throw new Error(`Invalid legacy numeric field: system.${pathKey}`);
      changed = true;
      return def;
    }

    if (defType === "boolean") {
      if (node === undefined || node === null) {
        changed = true;
        return def;
      }
      if (typeof node === "boolean") return node;
      const coerced = coerce ? _coerceBoolean(node) : undefined;
      if (coerced !== undefined) {
        changed = true;
        return coerced;
      }
      if (strict) throw new Error(`Invalid legacy Boolean field: system.${pathKey}`);
      changed = true;
      return def;
    }

    if (defType === "string") {
      if (node === undefined || node === null) {
        changed = true;
        return def;
      }
      if (typeof node === "string") return node;
      const coerced = coerce ? _coerceString(node) : undefined;
      if (coerced !== undefined) {
        changed = true;
        return coerced;
      }
      if (strict) throw new Error(`Invalid legacy string field: system.${pathKey}`);
      changed = true;
      return def;
    }

    if (defType === "array") {
      if (!Array.isArray(node)) {
        // Older forms saved numeric-keyed records instead of arrays. Only
        // this recognized representation is convertible without dropping data.
        if (strict && _isPlainObject(node)) {
          const keys = Object.keys(node).sort((a, b) => Number(a) - Number(b));
          if (keys.every((key, index) => /^(0|[1-9]\d*)$/.test(key) && Number(key) === index)) {
            changed = true;
            return keys.map((key) => _deepClone(node[key]));
          }
        }
        if (strict && node !== undefined && node !== null) throw new Error(`Invalid legacy array field: system.${pathKey}`);
        changed = true;
        return _deepClone(def);
      }
      return node;
    }

    if (defType === "object") {
      if (!_isPlainObject(node)) {
        if (strict && node !== undefined && node !== null) throw new Error(`Invalid legacy object field: system.${pathKey}`);
        changed = true;
        node = _deepClone(def);
      }
      for (const [k, v] of Object.entries(def)) {
        const next = apply(node[k], v, path.concat(k));
        if (next !== node[k]) node[k] = next;
      }
      return node;
    }

    // Unknown default type (function, symbol, etc.) — do not apply.
    return node;
  }

  const result = apply(root, defaults, []);
  return { result, changed };
}
