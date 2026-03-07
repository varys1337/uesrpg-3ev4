/**
 * src/core/system/namespace.js
 *
 * Canonical single source of truth for the UESRPG 3ev4 system identity.
 *
 * Rules:
 *  - SYSTEM_ID / FLAG_SCOPE: compile-time constants. Import directly in most callsites.
 *  - getRuntimeSystemId(): use ONLY where live game.system.id inspection is truly needed.
 *  - No imports. No side effects. No default export.
 */

/** Stable package/system id — must match system.json `id`. */
export const SYSTEM_ID = "uesrpg-3ev4";

/** Canonical flag namespace. Alias of SYSTEM_ID; all flag writes use this. */
export const FLAG_SCOPE = SYSTEM_ID;

/**
 * Returns the live loaded system id with a compile-time fallback.
 * Use only where runtime inspection of game.system.id is required.
 * @returns {string}
 */
export function getRuntimeSystemId() {
  return game?.system?.id ?? SYSTEM_ID;
}
