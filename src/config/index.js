/**
 * src/config/index.js
 *
 * Public barrel re-export for the UESRPG 3ev4 configuration layer.
 *
 * This module provides a single stable import path for the most commonly needed
 * config identifiers. All actual definitions live in their canonical source files:
 *   - src/core/constants.js         → SYSTEM_ID, FLAG_SCOPE, systemRootPath
 *   - src/core/config/special-actions.js → SPECIAL_ACTIONS, SPECIAL_ACTIONS_BY_ID, getSpecialActionById
 *
 * No behavior is defined here. Zero runtime cost beyond the re-export indirection.
 */

export { SYSTEM_ID, FLAG_SCOPE, systemRootPath } from "../core/constants.js";
export { SPECIAL_ACTIONS, SPECIAL_ACTIONS_BY_ID, getSpecialActionById } from "../core/config/special-actions.js";
