/**
 * Tooltip feature is deferred.
 *
 * Keep this module as a compatibility shim so existing sheet imports/calls
 * remain stable without introducing behavior changes.
 */

export function bindItemDescriptionTooltips(_sheet, _rootEl) {
  // Deferred intentionally: no custom tooltip binding.
}

export function clearItemDescriptionTooltip(_sheet) {
  // Deferred intentionally: no custom tooltip cleanup required.
}
