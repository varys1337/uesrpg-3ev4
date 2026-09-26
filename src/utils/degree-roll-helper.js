export {
  doTestRoll,
  computeResultFromRollTotal,
  getMaximumSuccessDegree,
  formatDegree,
  formatResultOutcomeLabel,
  formatResultSummary,
  resolveOpposed
} from "./degree/roll-core.js";

/**
 * Compatibility export for workflow-specific intercept logic.
 * Kept async and lazy to avoid pulling heavy workflow dependencies into baseline imports.
 */
export async function maybeApplyDefenderIntercept(args = {}) {
  const { maybeApplyDefenderIntercept: fn } = await import("./degree/roll-workflows.js");
  return fn(args);
}

