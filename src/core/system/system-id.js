/**
 * src/core/system/system-id.js
 *
 * Compatibility re-export shim.
 * All definitions now live in namespace.js.
 * This file is retained to avoid breaking any existing import paths.
 */
export { SYSTEM_ID, FLAG_SCOPE, getRuntimeSystemId } from "./namespace.js";
// Backward-compat alias: callers using getSystemId() continue to work.
export { getRuntimeSystemId as getSystemId } from "./namespace.js";
