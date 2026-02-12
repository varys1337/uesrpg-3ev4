/**
 * src/core/combat/damage/resolver/armor.js
 *
 * Armor source reporting utilities for damage resolution.
 */

/**
 * Best-effort reporting helper: list equipped armor items that explicitly cover a location.
 * This mirrors the simplest branch of getDamageReduction() coverage checks.
 * It is used for chat-card attribution only and MUST NOT affect mechanics.
 *
 * @param {Actor} actor
 * @param {string} locKey - normalized location key (e.g. "Head", "Body", "LeftLeg")
 * @returns {{name:string, ar:number}[]}
 */
export function listArmorSourcesForLocation(actor, locKey) {
  try {
    const items = actor?.items?.filter((i) => i?.type === "armor" && i?.system?.equipped === true && !i?.system?.isShield) ?? [];
    const out = [];
    for (const item of items) {
      const hitLocs = item?.system?.hitLocations ?? {};
      // Only explicit true counts (same rule as getDamageReduction for explicit locations)
      const covered = hitLocs?.[locKey] === true;
      if (!covered) continue;

      const ar = (item.system?.armorEffective != null)
        ? Number(item.system.armorEffective)
        : Number(item.system?.armor ?? 0);

      out.push({ name: String(item.name ?? "Armor"), ar: Number.isFinite(ar) ? ar : 0 });
    }
    return out;
  } catch (_err) {
    return [];
  }
}
