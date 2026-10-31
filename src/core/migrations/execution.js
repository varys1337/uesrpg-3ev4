/** Local sequencing only. Native permissions and the active GM remain authoritative. */
export function createMigrationCoordinator() {
  const requests = new Map();
  let tail = Promise.resolve();
  return {
    isRunning: () => requests.size > 0,
    run(scope, execute) {
      if (requests.has(scope)) return requests.get(scope);
      const request = tail.then(execute).finally(() => requests.delete(scope));
      requests.set(scope, request);
      // A failed request must not poison a later explicit retry or another scope.
      tail = request.catch(() => {});
      return request;
    },
  };
}

/** Execute existing passes, then read fresh persisted revisions before success. */
export async function executeMigrationPasses({ passes, canRun, getPendingKeys, shouldRun = () => true }) {
  let failedPass = null;
  try {
    for (const pass of passes) {
      failedPass = pass.name;
      if (!canRun()) return { ok: false, reason: "not-active-gm", pendingKeys: getPendingKeys(), failedPass };
      if (!shouldRun(pass)) continue;
      const result = await pass.run();
      if (result?.ok === false) {
        const error = new Error(`Migration pass ${pass.name} did not complete: ${result.reason ?? "rejected"}`);
        error.passResult = result;
        throw error;
      }
    }
    if (!canRun()) return { ok: false, reason: "not-active-gm", pendingKeys: getPendingKeys(), failedPass };
    failedPass = null;
    const pendingKeys = getPendingKeys();
    return pendingKeys.length
      ? { ok: false, reason: "pending-revisions", pendingKeys, failedPass }
      : { ok: true, pendingKeys, failedPass };
  } catch (err) {
    // Preserve the original pass error even if inspecting state also fails.
    let pendingKeys = [];
    let stateError;
    try { pendingKeys = getPendingKeys(); } catch (error) { stateError = error; }
    return { ok: false, reason: "error", err, pendingKeys, failedPass, ...(stateError ? { stateError } : {}) };
  }
}
