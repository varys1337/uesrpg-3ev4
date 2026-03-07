/**
 * src/core/wounds/engine/format.js
 *
 * Text formatting and data transformation helpers for wound engine.
 */

import { FLAG_SCOPE } from "../../constants.js";

/**
 * Format damage-by-type map for display
 */
export function formatDamageByType(damageAppliedByType = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(damageAppliedByType ?? {})) {
    const amt = Number(v) || 0;
    if (amt <= 0) continue;
    parts.push(`${k}: ${amt}`);
  }
  return parts.join(", ");
}

/**
 * Add standardized metadata flags to wound effect flags
 */
function addWoundMetadata(flags) {
  const woundsData = flags?.wounds ?? {};
  const kind = woundsData?.kind;
  if (!kind) return flags;
  
  return {
    ...flags,
    owner: "system",
    effectGroup: `wounds.marker.${kind}`,
    stackRule: "refresh",
    source: "wounds"
  };
}

/**
 * Create effect data structure with standardized flags
 */
export function makeEffect({ name, img, icon, flags, changes = [], origin = null }) {
  // Add standardized metadata flags for system-created wound effects
  const enhancedFlags = addWoundMetadata(flags);
  
  return {
    name,
    // Foundry v13 ActiveEffect data uses "img".
    // Accept a legacy "icon" arg for internal callers.
    img: img ?? icon,
    origin: origin ?? null,
    disabled: false,
    duration: {},
    changes,
    flags: { [FLAG_SCOPE]: enhancedFlags }
  };
}

/**
 * Get whisper recipients for actor-related messages
 */
export function getWhisperRecipientsForActor(actor) {
  if (!actor) return [];
  const owners = [];

  // Include actor's owned-by users
  for (const [userId, perm] of Object.entries(actor.ownership ?? {})) {
    if (perm >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
      const u = game.users?.get?.(userId);
      if (u?.active) owners.push(u.id);
    }
  }

  // Always include active GMs
  for (const u of game.users ?? []) {
    if (u?.active && u?.isGM && !owners.includes(u.id)) {
      owners.push(u.id);
    }
  }

  return owners;
}
