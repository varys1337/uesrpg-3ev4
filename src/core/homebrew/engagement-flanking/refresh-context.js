function normalizeStringId(value) {
  const out = String(value ?? "").trim();
  return out || null;
}

function mergeIds(target, values) {
  if (!target || !values) return;
  for (const value of values) {
    const id = normalizeStringId(value);
    if (id) target.add(id);
  }
}

function mergeDirtyPoints(target, points) {
  if (!Array.isArray(points)) return;
  for (const point of points) {
    const x = Number(point?.x ?? NaN);
    const y = Number(point?.y ?? NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    target.push({ x, y });
  }
}

function createRefreshContext() {
  return {
    fullScene: false,
    reasons: new Set(),
    dirtyTokenIds: new Set(),
    dirtyActorIds: new Set(),
    dirtyPoints: [],
  };
}

let pendingRefreshContext = createRefreshContext();

function resetPendingRefreshContext() {
  pendingRefreshContext = createRefreshContext();
}

export function snapshotRefreshContext(context = {}) {
  const reasons = new Set();
  if (context?.reasons instanceof Set) {
    for (const reason of context.reasons) reasons.add(String(reason ?? "").trim() || "manual");
  } else {
    reasons.add(String(context?.reason ?? "manual").trim() || "manual");
  }

  const dirtyTokenIds = new Set();
  const dirtyActorIds = new Set();
  mergeIds(dirtyTokenIds, context?.dirtyTokenIds ?? []);
  mergeIds(dirtyActorIds, context?.dirtyActorIds ?? []);

  const dirtyPoints = [];
  mergeDirtyPoints(dirtyPoints, context?.dirtyPoints ?? []);

  const hasDirty = dirtyTokenIds.size > 0 || dirtyActorIds.size > 0 || dirtyPoints.length > 0;
  return {
    fullScene: context?.fullScene === true || !hasDirty,
    reasons,
    dirtyTokenIds,
    dirtyActorIds,
    dirtyPoints,
  };
}

export function queueRefreshContext(context = {}) {
  const reason = String(context?.reason ?? "hook").trim() || "hook";
  pendingRefreshContext.reasons.add(reason);
  if (context?.fullScene === true) pendingRefreshContext.fullScene = true;
  mergeIds(pendingRefreshContext.dirtyTokenIds, context?.dirtyTokenIds ?? []);
  mergeIds(pendingRefreshContext.dirtyActorIds, context?.dirtyActorIds ?? []);
  mergeDirtyPoints(pendingRefreshContext.dirtyPoints, context?.dirtyPoints ?? []);
}

export function consumePendingRefreshContext() {
  const out = {
    fullScene: pendingRefreshContext.fullScene,
    reasons: new Set(pendingRefreshContext.reasons),
    dirtyTokenIds: new Set(pendingRefreshContext.dirtyTokenIds),
    dirtyActorIds: new Set(pendingRefreshContext.dirtyActorIds),
    dirtyPoints: pendingRefreshContext.dirtyPoints.map((point) => ({ x: point.x, y: point.y })),
  };
  resetPendingRefreshContext();
  return out;
}

export function resetEngagementRefreshContext() {
  resetPendingRefreshContext();
}

export function mergeDirtyPointList(target, points) {
  mergeDirtyPoints(target, points);
}

export function mergeIdSet(target, values) {
  mergeIds(target, values);
}

export function normalizeEngagementStringId(value) {
  return normalizeStringId(value);
}
