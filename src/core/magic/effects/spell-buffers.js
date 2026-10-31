import { FLAG_SCOPE } from "../../system/namespace.js";

const legacyTypes = new Set(["physical", "magical", "elemental"]);
export const SPELL_BUFFER_TYPES = Object.freeze(["physical", "magical", "elemental", "fire", "frost", "shock", "poison"]);

/** Preserve existing pool fields; specific shields use one scoped flag per type. */
export function getSpellBufferPath(type) {
  if (!SPELL_BUFFER_TYPES.includes(type)) throw new Error(`Unsupported spell barrier type: ${type}`);
  return legacyTypes.has(type) ? `system.buffers.${type}` : `flags.${FLAG_SCOPE}.spellBuffers.${type}`;
}

export function getSpellBufferValue(actor, type) {
  const value = legacyTypes.has(type) ? actor?.system?.buffers?.[type] : actor?.flags?.[FLAG_SCOPE]?.spellBuffers?.[type];
  return Math.max(0, Number(value) || 0);
}
