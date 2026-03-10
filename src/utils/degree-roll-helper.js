import {
  doTestRoll,
  computeResultFromRollTotal,
  formatDegree,
  formatResultOutcomeLabel,
  formatResultSummary,
  resolveOpposed
} from "./degree/roll-core.js";

export {
  doTestRoll,
  computeResultFromRollTotal,
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

// Convenience global exposure so macros and non-module code can access helpers.
window.Uesrpg3e = window.Uesrpg3e || {};
window.Uesrpg3e.roll = window.Uesrpg3e.roll || {};
window.Uesrpg3e.roll.doTestRoll = window.Uesrpg3e.roll.doTestRoll || doTestRoll;
window.Uesrpg3e.roll.computeResultFromRollTotal = window.Uesrpg3e.roll.computeResultFromRollTotal || computeResultFromRollTotal;
window.Uesrpg3e.roll.resolveOpposed = window.Uesrpg3e.roll.resolveOpposed || resolveOpposed;
window.Uesrpg3e.roll.formatDegree = window.Uesrpg3e.roll.formatDegree || formatDegree;
window.Uesrpg3e.roll.formatResultOutcomeLabel = window.Uesrpg3e.roll.formatResultOutcomeLabel || formatResultOutcomeLabel;
window.Uesrpg3e.roll.formatResultSummary = window.Uesrpg3e.roll.formatResultSummary || formatResultSummary;
window.Uesrpg3e.roll.maybeApplyDefenderIntercept = window.Uesrpg3e.roll.maybeApplyDefenderIntercept || maybeApplyDefenderIntercept;
