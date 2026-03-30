import { _cleanupAutoRollContext } from "../../combat/opposed/banking/state.js";

export function isLuckResultMatch(actual, expected) {
  if (!actual || !expected) return false;
  return (
    Boolean(actual.isSuccess) === Boolean(expected.isSuccess)
    && (Number(actual.degree ?? 0) || 0) === (Number(expected.degree ?? 0) || 0)
    && Boolean(actual.isCriticalSuccess) === Boolean(expected.isCriticalSuccess)
    && Boolean(actual.isCriticalFailure) === Boolean(expected.isCriticalFailure)
    && String(actual.textual ?? "") === String(expected.textual ?? "")
  );
}

export function getLiveLuckMessage(message) {
  return game.messages?.get?.(message?.id) ?? message ?? null;
}

export function getLiveLuckInfo(message, classifyMessage) {
  const live = getLiveLuckMessage(message);
  return live ? classifyMessage(live) : null;
}

export function resolveLiveLuckSide(message, info, side, classifyMessage) {
  const live = getLiveLuckMessage(message);
  const liveInfo = info ?? getLiveLuckInfo(live, classifyMessage);
  if (!live || !liveInfo) return { live, liveInfo, liveSide: null };
  let liveSide = null;
  if (side?.role === "defender") {
    liveSide = liveInfo.sides.find((candidate) => candidate.role === "defender" && (candidate.defenderIndex ?? 0) === (side.defenderIndex ?? 0)) ?? null;
  } else {
    liveSide = liveInfo.sides.find((candidate) => candidate.role === side?.role) ?? null;
  }
  return { live, liveInfo, liveSide };
}

export function applyExtraLuckContext(data, extraContext = {}) {
  data.context = data.context ?? {};
  data.context.luckUsed = (extraContext.luckUsed ?? true) === true;
  if (extraContext.luckBurned !== undefined) data.context.luckBurned = Boolean(extraContext.luckBurned);
  if (extraContext.rerollUsed !== undefined) data.context.rerollUsed = Boolean(extraContext.rerollUsed);
  if (extraContext.rerollSource !== undefined) data.context.rerollSource = String(extraContext.rerollSource);
}

export function didPersistLuckResult(message, infoType, sideRef, expectedResult, classifyMessage) {
  const live = getLiveLuckMessage(message);
  if (!live) return false;
  const updated = classifyMessage(live);
  if (!updated || updated.type !== infoType) return false;
  const side = updated.sides.find((candidate) => {
    if (candidate.role !== sideRef?.role) return false;
    if (candidate.role !== "defender") return true;
    return (candidate.defenderIndex ?? 0) === (sideRef?.defenderIndex ?? 0);
  });
  return isLuckResultMatch(side?.result, expectedResult);
}

export function finalizeResolvedLuckContext(data, { resolved = true } = {}) {
  data.context = data.context ?? {};
  if (!resolved) return;
  data.status = "resolved";
  data.context.phase = "resolved";
  if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
  _cleanupAutoRollContext(data.context);
}
