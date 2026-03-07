/**
 * src/core/magic/opposed/actions.js
 *
 * Barrel re-export for magic opposed action handlers.
 *
 * Splits into:
 *  - actions/attacker.js       — handleAttackerCommit, handleAttackerRoll
 *  - actions/dispatch.js       — dispatchAction
 *  - actions/banked-roll.js    — autoRollBanked
 *  - actions/defender-roll.js  — handleDefenderRoll, handleDefenderNoDefense, handleDefenderCharacteristicTest
 *                                computeEvadeTNWithBreakdown, computeBlockTNWithBreakdown
 *  - actions/defender-commit.js — handleDefenderCommit
 *  - actions/resolve.js        — handleBlockResolve, handleWardResolve
 */

export { dispatchAction } from "./actions/dispatch.js";
export { autoRollBanked } from "./actions/banked-roll.js";
export { handleAttackerCommit, handleAttackerRoll } from "./actions/attacker.js";
export { handleDefenderRoll, handleDefenderNoDefense, handleDefenderCharacteristicTest, computeEvadeTNWithBreakdown, computeBlockTNWithBreakdown } from "./actions/defender-roll.js";
export { handleDefenderCommit } from "./actions/defender-commit.js";
export { handleBlockResolve, handleWardResolve } from "./actions/resolve.js";
