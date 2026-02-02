/**
 * src/ui/canvas/reach-visualizer-state.js
 *
 * Lightweight per-user state for the Reach Visualizer.
 * We store the "last used melee weapon id" per actor on the User document flags
 * to avoid spamming Actor updates and to keep the feature client-centric.
 *
 * Foundry v13 compatible.
 */

const FLAG_SCOPE = "uesrpg-3ev4";
const FLAG_KEY_LAST_MELEE = "reachVisualizerLastMeleeWeapon";

/**
 * Get the last-used melee weapon id for an actor for the current user.
 * @param {string} actorId
 * @returns {string|null}
 */
export function getLastMeleeWeaponForActor(actorId) {
  try {
    if (!actorId) return null;
    const user = game?.user;
    if (!user) return null;
    const map = user.getFlag(FLAG_SCOPE, FLAG_KEY_LAST_MELEE);
    const id = map?.[actorId];
    return typeof id === "string" && id.length ? id : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Persist the last-used melee weapon id for an actor for the current user.
 * @param {string} actorId
 * @param {string} weaponId
 */
export async function setLastMeleeWeaponForActor(actorId, weaponId) {
  try {
    if (!actorId || !weaponId) return;
    const user = game?.user;
    if (!user) return;

    const current = user.getFlag(FLAG_SCOPE, FLAG_KEY_LAST_MELEE) ?? {};
    const next = { ...(current ?? {}) };
    next[actorId] = weaponId;

    await user.setFlag(FLAG_SCOPE, FLAG_KEY_LAST_MELEE, next);
  } catch (_e) {
    // swallow: this is a best-effort QoL feature
  }
}
