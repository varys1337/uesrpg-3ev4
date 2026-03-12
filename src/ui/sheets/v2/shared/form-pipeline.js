/**
 * Shared AppV2 sheet form helpers for deterministic, allow-listed updates.
 */

function _isNativeFormControl(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement;
}

function _isCustomFormControl(target) {
  return target instanceof HTMLElement
    && !_isNativeFormControl(target)
    && Boolean(String(target.getAttribute?.("name") ?? "").trim())
    && ("value" in target);
}

function _isFormControl(target) {
  return _isNativeFormControl(target) || _isCustomFormControl(target);
}

function _coerceChangedValue(target, currentValue) {
  if (target instanceof HTMLInputElement) {
    if (target.type === "checkbox") return Boolean(target.checked);
    if (target.type === "radio") {
      if (!target.checked) return undefined;
      return String(target.value ?? "");
    }
  }

  if (target instanceof HTMLSelectElement && target.multiple) {
    return Array.from(target.selectedOptions ?? []).map((o) => String(o?.value ?? ""));
  }

  const raw = target.value;

  if (
    typeof currentValue === "number"
    || (target instanceof HTMLInputElement && (target.type === "number" || target.type === "range"))
  ) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
    return undefined;
  }

  if (typeof currentValue === "boolean") {
    return String(raw).toLowerCase() === "true";
  }

  return String(raw ?? "");
}

function _coerceCustomChangedValue(target) {
  return target?.value;
}

/**
 * Build an allow-list matcher for flat form paths.
 * @param {object} config
 * @param {string[]} [config.exact]
 * @param {string[]} [config.prefixes]
 * @returns {(path: string) => boolean}
 */
export function createFormPathMatcher({ exact = [], prefixes = [] } = {}) {
  const exactSet = new Set(exact.map((p) => String(p)));
  const startsWith = prefixes.map((p) => String(p));

  return (path) => {
    const key = String(path ?? "");
    if (!key) return false;
    if (exactSet.has(key)) return true;
    return startsWith.some((prefix) => key.startsWith(prefix));
  };
}

/**
 * Build a one-field patch from a form change event target.
 * Returns null when the field is not allow-listed or unchanged.
 *
 * @param {object} cfg
 * @param {object} cfg.document
 * @param {HTMLElement} cfg.target
 * @param {(path: string) => boolean} cfg.allowPath
 * @param {(ctx: {
 *   path: string,
 *   value: unknown,
 *   currentValue: unknown,
 *   target: HTMLElement,
 *   rawValue: unknown,
 *   phase: "change"
 * }) => unknown} [cfg.normalizeValue]
 * @returns {object|null}
 */
export function buildAllowedChangePatch({ document, target, allowPath, normalizeValue }) {
  if (!document || !target || typeof allowPath !== "function") return null;
  if (!_isFormControl(target)) return null;

  const path = String(target.getAttribute("name") ?? "").trim();
  if (!path || !allowPath(path)) return null;

  const currentValue = foundry.utils.getProperty(document, path);
  let nextValue = _isNativeFormControl(target)
    ? _coerceChangedValue(target, currentValue)
    : _coerceCustomChangedValue(target);
  if (typeof normalizeValue === "function") {
    nextValue = normalizeValue({
      path,
      value: nextValue,
      currentValue,
      target,
      rawValue: target?.value,
      phase: "change",
    });
  }
  if (nextValue === undefined) return null;
  if (Object.is(currentValue, nextValue)) return null;

  return { [path]: nextValue };
}

/**
 * Build a deterministic submit patch from full form data:
 * flatten -> allow-list filter -> diff against current document.
 *
 * @param {object} cfg
 * @param {object} cfg.document
 * @param {object} cfg.formDataObject
 * @param {(path: string) => boolean} cfg.allowPath
 * @param {(ctx: {
 *   path: string,
 *   value: unknown,
 *   currentValue: unknown,
 *   phase: "submit"
 * }) => unknown} [cfg.normalizeValue]
 * @returns {object|null}
 */
export function buildAllowedSubmitPatch({ document, formDataObject, allowPath, normalizeValue }) {
  if (!document || typeof allowPath !== "function") return null;

  const flatData = foundry.utils.flattenObject(formDataObject ?? {});
  const currentFlat = foundry.utils.flattenObject(document.toObject(false));
  const filtered = {};
  for (const [path, value] of Object.entries(flatData)) {
    if (!allowPath(path)) continue;
    const currentValue = currentFlat[path];
    let nextValue = value;
    if (typeof normalizeValue === "function") {
      nextValue = normalizeValue({
        path,
        value: nextValue,
        currentValue,
        phase: "submit",
      });
    }
    if (nextValue === undefined) continue;
    filtered[path] = nextValue;
  }

  if (foundry.utils.isEmpty(filtered)) return null;

  const currentSubset = {};
  for (const path of Object.keys(filtered)) {
    currentSubset[path] = currentFlat[path];
  }

  const diff = foundry.utils.diffObject(currentSubset, filtered);
  if (foundry.utils.isEmpty(diff)) return null;
  return diff;
}
