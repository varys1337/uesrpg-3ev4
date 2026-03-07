/**
 * @module _primitives
 * src/core/magic/_primitives.js
 *
 * Subsystem facade: re-exports canonical coercion helpers from
 * `src/utils/coerce.js` and debug helpers from `src/utils/debug.js`.
 *
 * Target: Foundry VTT v13.351
 */

// ── Debug helpers (canonical source: src/utils/debug.js) ─────────────────────
export { isDebugEnabled, createDebugLogger, createSeverityDebugLogger } from "../../utils/debug.js";

// ── Coercion helpers (canonical source: src/utils/coerce.js) ─────────────────
export { _num, _numOrNull, _str, _strTrim } from "../../utils/coerce.js";
