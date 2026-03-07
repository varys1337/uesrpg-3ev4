/**
 * Legacy compatibility adapter over shared resource handlers.
 * Keeps AppV1 actor sheet call signatures and dataset keys stable.
 */
import {
  onIncrementResource as sharedOnIncrementResource,
  onResetResource as sharedOnResetResource,
  onShortRest as sharedOnShortRest,
  onLongRest as sharedOnLongRest,
  onIncrementFatigue as sharedOnIncrementFatigue,
  setResourceBars,
} from "../../shared/ui/resources.js";

function _resolveSheetAndEvent(arg1, arg2) {
  if (arg1 && typeof arg1 === "object" && "actor" in arg1 && arg2 && typeof arg2.preventDefault === "function") {
    return { sheet: arg1, event: arg2 };
  }
  return { sheet: this, event: arg1 };
}

function _normalizeTarget(target, event) {
  const el = target ?? event?.currentTarget ?? null;
  if (!el?.dataset) return el;
  const dataset = { ...el.dataset };
  if (!dataset.direction && dataset.action) dataset.direction = dataset.action;
  if (!dataset.action && dataset.direction) dataset.action = dataset.direction;
  return { ...el, dataset };
}

export async function onIncrementResource(arg1, arg2) {
  const { sheet, event } = _resolveSheetAndEvent.call(this, arg1, arg2);
  const target = _normalizeTarget(event?.currentTarget, event);
  return sharedOnIncrementResource.call(sheet, event, target);
}

export async function onResetResource(arg1, arg2) {
  const { sheet, event } = _resolveSheetAndEvent.call(this, arg1, arg2);
  const target = _normalizeTarget(event?.currentTarget, event);
  return sharedOnResetResource.call(sheet, event, target);
}

export async function onShortRest(arg1, arg2) {
  const { sheet, event } = _resolveSheetAndEvent.call(this, arg1, arg2);
  const target = _normalizeTarget(event?.currentTarget, event);
  return sharedOnShortRest.call(sheet, event, target);
}

export async function onLongRest(arg1, arg2) {
  const { sheet, event } = _resolveSheetAndEvent.call(this, arg1, arg2);
  const target = _normalizeTarget(event?.currentTarget, event);
  return sharedOnLongRest.call(sheet, event, target);
}

export async function onIncrementFatigue(arg1, arg2) {
  const { sheet, event } = _resolveSheetAndEvent.call(this, arg1, arg2);
  const target = _normalizeTarget(event?.currentTarget, event);
  return sharedOnIncrementFatigue.call(sheet, event, target);
}

export { setResourceBars };
