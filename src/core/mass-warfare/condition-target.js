import { FLAG_SCOPE } from "../constants.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";

export const WARFARE_CONDITION_INIT_FLAG = "warfareConditionInitialized";

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _resolveUuidSync(uuid) {
  try {
    return uuid ? fromUuidSync(uuid) ?? null : null;
  } catch (_err) {
    return null;
  }
}

async function _resolveUuid(uuid) {
  const sync = _resolveUuidSync(uuid);
  if (sync) return sync;
  try {
    return uuid ? await fromUuid(uuid) : null;
  } catch (_err) {
    return null;
  }
}

function _resolveActiveSceneToken(actor, sceneId = "") {
  if (!actor?.getActiveTokens) return null;
  const scene = sceneId
    ? game?.scenes?.get?.(sceneId) ?? null
    : game?.scenes?.current ?? null;
  if (!scene) return actor.getActiveTokens?.()[0]?.document ?? null;
  const match = scene.tokens.find((tokenDoc) => tokenDoc?.actor?.id === actor.id) ?? null;
  return match ?? actor.getActiveTokens?.()[0]?.document ?? null;
}

function _isUnlinkedSceneToken(actor, tokenDoc) {
  return Boolean(actor && tokenDoc?.actor && actor.prototypeToken?.actorLink === false);
}

export async function resolveWarfareUnitReference({
  actor = null,
  actorId = "",
  actorUuid = "",
  tokenDoc = null,
  tokenUuid = "",
  sceneId = "",
} = {}) {
  let resolvedTokenDoc = tokenDoc ?? null;
  if (!resolvedTokenDoc && tokenUuid) {
    resolvedTokenDoc = await _resolveUuid(tokenUuid);
  }

  let resolvedActor = actor ?? null;
  if (!resolvedActor && actorUuid) {
    resolvedActor = await _resolveUuid(actorUuid);
  }
  if (!resolvedActor && actorId) {
    resolvedActor = game?.actors?.get?.(actorId) ?? null;
  }
  if (!resolvedActor && resolvedTokenDoc?.actor) {
    resolvedActor = resolvedTokenDoc.actor;
  }
  if (!resolvedTokenDoc && resolvedActor) {
    resolvedTokenDoc = _resolveActiveSceneToken(resolvedActor, sceneId);
  }

  return {
    actor: resolvedActor ?? null,
    tokenDoc: resolvedTokenDoc ?? null,
  };
}

export async function resolveWarfareConditionTarget(reference = {}) {
  const { actor, tokenDoc } = await resolveWarfareUnitReference(reference);
  const updateTarget = _isUnlinkedSceneToken(actor, tokenDoc) ? tokenDoc.actor : actor;
  const currentResolve = _num(updateTarget?.system?.stats?.resolve?.value ?? actor?.system?.stats?.resolve?.value, _num(updateTarget?.system?.stats?.condition?.value ?? actor?.system?.stats?.condition?.value, 0));
  const maxResolve = _num(updateTarget?.system?.stats?.resolve?.max ?? actor?.system?.stats?.resolve?.max, _num(updateTarget?.system?.stats?.condition?.max ?? actor?.system?.stats?.condition?.max, 0));
  return {
    actor,
    tokenDoc,
    updateTarget,
    currentResolve,
    maxResolve,
    currentCondition: currentResolve,
    maxCondition: maxResolve,
    isTokenAuthoritative: Boolean(updateTarget && actor && updateTarget !== actor),
  };
}

export function isWarfareConditionInitialized(document) {
  return Boolean(document?.getFlag?.(FLAG_SCOPE, WARFARE_CONDITION_INIT_FLAG));
}

export async function markWarfareConditionInitialized(document) {
  if (!document || isWarfareConditionInitialized(document)) return false;
  await requestUpdateDocument(document, {
    [`flags.${FLAG_SCOPE}.${WARFARE_CONDITION_INIT_FLAG}`]: true,
  });
  return true;
}

export async function applyWarfareConditionDelta(reference, delta = 0) {
  const target = await resolveWarfareConditionTarget(reference);
  if (!target?.updateTarget) return { applied: false, ...target };

  const amount = Math.max(0, _num(delta, 0));
  const current = target.currentResolve;
  const max = Math.max(current, target.maxResolve);
  const next = Math.min(max, current + amount);
  const restored = Math.max(0, next - current);

  if (restored > 0) {
    await requestUpdateDocument(target.updateTarget, {
      "system.stats.resolve.value": next,
      "system.stats.condition.value": next,
      [`flags.${FLAG_SCOPE}.${WARFARE_CONDITION_INIT_FLAG}`]: true,
    });
  } else if (!isWarfareConditionInitialized(target.updateTarget)) {
    await markWarfareConditionInitialized(target.updateTarget);
  }

  if (target.actor && target.updateTarget && target.actor !== target.updateTarget && !isWarfareConditionInitialized(target.actor)) {
    await markWarfareConditionInitialized(target.actor);
  }

  return {
    ...target,
    applied: restored > 0,
    restored,
    nextCondition: next,
  };
}

export async function maybeInitializeWarfareCondition(document, { maxCondition = null } = {}) {
  if (!document || String(document.type ?? "") !== "Warfare Unit") return false;
  if (isWarfareConditionInitialized(document)) return false;

  const current = _num(document.system?.stats?.resolve?.value, _num(document.system?.stats?.condition?.value, 0));
  const max = _num(
    maxCondition
      ?? document.system?.stats?.resolve?.max
      ?? document.system?.stats?.condition?.max
      ?? document.system?._derived?.resolveMax
      ?? document.system?._derived?.conditionMax,
    0
  );
  if (current !== 0 || max <= 0) return false;

  await requestUpdateDocument(document, {
    "system.stats.resolve.value": max,
    "system.stats.condition.value": max,
    [`flags.${FLAG_SCOPE}.${WARFARE_CONDITION_INIT_FLAG}`]: true,
  });
  return true;
}
