import { getActionResult, createActionResult } from "../../application/action-results.js";

export function result(ok, path, extra = {}) {
  const actionResult = getActionResult(extra.result ?? extra);
  return { ok, path, ...extra, ...(actionResult ? { ok: actionResult.ok, actionResult } : {}) };
}

export function resolveToken(actor, explicitToken = null) {
  if (explicitToken) return explicitToken;
  const controlled = canvas?.tokens?.controlled?.find?.((t) => t?.actor?.id === actor?.id) ?? null;
  if (controlled) return controlled;
  return actor?.getActiveTokens?.()?.[0] ?? null;
}

export function makeSyntheticTarget(dataset = {}) {
  return { dataset: { ...(dataset ?? {}) } };
}

export function makeSyntheticItemTarget(itemId) {
  return {
    dataset: { itemId },
    closest: () => ({ dataset: { itemId } }),
  };
}

export function makeSyntheticCharacteristicTarget(key, label) {
  const target = document.createElement("span");
  target.id = key;
  target.setAttribute("name", label);
  return target;
}

export function makeSyntheticProfessionTarget(professionKey) {
  const key = String(professionKey ?? "").trim();
  return {
    dataset: {
      professionKey: key,
      actionId: key,
      id: key,
      itemId: key,
    },
    professionKey: key,
    id: key,
    actionId: key,
    closest: (selector) => {
      const sel = String(selector ?? "");
      if (!sel) return null;
      if (
        sel.includes("[data-profession-key]") ||
        sel.includes(".profession-roll-target") ||
        sel.includes(".item") ||
        sel.includes(".npc-item")
      ) {
        return { dataset: { professionKey: key, itemId: key } };
      }
      return null;
    },
  };
}

export function makeSyntheticEvent(target, { shiftKey = false } = {}) {
  const ev = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window,
    shiftKey: !!shiftKey,
  });
  Object.defineProperty(ev, "currentTarget", { writable: false, value: target });
  return ev;
}

export async function invokeSheetOrHandler({
  actor,
  token = null,
  target,
  shiftKey = false,
  sheetMethod,
  handler,
  handlerArgs = [],
  sheetFallback = {},
  successPathSheet,
  successPathHandler,
  requireActionResult = false,
} = {}) {
  const resolvedToken = resolveToken(actor, token);
  const event = makeSyntheticEvent(target, { shiftKey });
  const sheet = actor?.sheet ?? { actor, token: resolvedToken, element: null, ...sheetFallback };

  if (sheet && typeof sheet?.[sheetMethod] === "function") {
    const value = await sheet[sheetMethod](event, target, ...handlerArgs);
    return forwardedResult(value, successPathSheet, requireActionResult);
  }

  const value = await handler.call(sheet, event, target, ...handlerArgs);
  return forwardedResult(value, successPathHandler, requireActionResult);
}

function forwardedResult(value, path, required = true) {
  if (getActionResult(value)) return result(false, path, { result: value });
  if (!required) return result(true, path);
  return result(false, path, { actionResult: createActionResult({ owner: "tokenActionHud", scope: "handler dispatch",
    status: "needsReview", commitment: "uncertain", reason: "The handler did not report an action result. Inspect its card before repeating the action." }) });
}

export async function routeFeatureActivation({
  item,
  actor,
  event = null,
  executeItemActivation,
  activateTalentFromItemSheet,
  activatePowerFromItemSheet,
  activateTraitFromItemSheet,
} = {}) {
  if (!item) return result(false, "none", { reason: "no-item" });

  if (item.type === "talent") {
    return forwardedResult(await activateTalentFromItemSheet({ item, event }), "shared-handlers.activateTalentFromItemSheet");
  }
  if (item.type === "power") {
    return forwardedResult(await activatePowerFromItemSheet({ item, event }), "shared-handlers.activatePowerFromItemSheet");
  }
  if (item.type === "trait") {
    return forwardedResult(await activateTraitFromItemSheet({ item, event }), "shared-handlers.activateTraitFromItemSheet");
  }

  const value = await executeItemActivation({
    item,
    actor: actor ?? item.actor ?? null,
    event,
    renderChat: true,
    includeImage: true,
    context: {},
  });
  return forwardedResult(value, "activation.executeItemActivation");
}

export async function routeResourceDialog({
  actor,
  resourceId,
  HPTempHPDialog,
  openStaminaDialog,
  MagickaBarrierDialog,
  LuckAPI,
} = {}) {
  if (!actor || !resourceId) return result(false, "none", { reason: "bad-args" });

  if (resourceId === "resource-health") {
    await HPTempHPDialog.show(actor);
    return result(true, "HPTempHPDialog.show");
  }
  if (resourceId === "resource-stamina") {
    await openStaminaDialog(actor);
    return result(true, "openStaminaDialog");
  }
  if (resourceId === "resource-magicka") {
    await MagickaBarrierDialog.show(actor);
    return result(true, "MagickaBarrierDialog.show");
  }
  if (resourceId === "resource-luck") {
    const fn = LuckAPI?.openBurnLuckFromSheet ?? LuckAPI?.openBurnDialog;
    if (typeof fn !== "function") return result(false, "none", { reason: "no-resource-dialog-handler" });
    await fn(actor);
    return result(true, "LuckAPI.openBurnLuckFromSheet");
  }

  return result(false, "none", { reason: "no-resource-dialog-handler" });
}
