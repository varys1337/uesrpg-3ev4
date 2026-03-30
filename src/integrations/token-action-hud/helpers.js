export function result(ok, path, extra = {}) {
  return { ok, path, ...extra };
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
} = {}) {
  const resolvedToken = resolveToken(actor, token);
  const event = makeSyntheticEvent(target, { shiftKey });
  const sheet = actor?.sheet ?? { actor, token: resolvedToken, element: null, ...sheetFallback };

  if (sheet && typeof sheet?.[sheetMethod] === "function") {
    await sheet[sheetMethod](event, target, ...handlerArgs);
    return result(true, successPathSheet);
  }

  await handler.call(sheet, event, target, ...handlerArgs);
  return result(true, successPathHandler);
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
    await activateTalentFromItemSheet({ item, event });
    return result(true, "shared-handlers.activateTalentFromItemSheet");
  }
  if (item.type === "power") {
    await activatePowerFromItemSheet({ item, event });
    return result(true, "shared-handlers.activatePowerFromItemSheet");
  }
  if (item.type === "trait") {
    await activateTraitFromItemSheet({ item, event });
    return result(true, "shared-handlers.activateTraitFromItemSheet");
  }

  await executeItemActivation({
    item,
    actor: actor ?? item.actor ?? null,
    event,
    renderChat: true,
    includeImage: true,
    context: {},
  });
  return result(true, "activation.executeItemActivation");
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
