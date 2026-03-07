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
    const ARMOR_CATEGORY_TO_LOCATIONS = {
      head: ["Head"],
      body: ["Body"],
      l_arm: ["LeftArm"],
      r_arm: ["RightArm"],
      l_leg: ["LeftLeg"],
      r_leg: ["RightLeg"],
    };
    const ARMOR_LOCATION_KEYS = ["Head", "Body", "RightArm", "LeftArm", "RightLeg", "LeftLeg"];
    const normalizeCoverageOverride = (value) => {
      const raw = String(value ?? "").trim().toLowerCase();
      if (!raw) return "";
      if (raw === "full" || raw === "partial" || raw === "none") return raw;
      if (raw === "no armor" || raw === "noarmour" || raw === "no armour" || raw === "no_armor" || raw === "no-armour") {
        return "none";
      }
      return "";
    };
    const out = [];
    for (const item of items) {
      const sys = item?.system ?? {};
      const hitLocs = sys.hitLocations ?? {};
      const category = String(sys.category ?? "").toLowerCase();
      const catLocs = ARMOR_CATEGORY_TO_LOCATIONS[category] ?? null;
      let armorClass = String(sys.armorClass || "partial").toLowerCase();
      if (armorClass !== "full" && armorClass !== "partial" && armorClass !== "none") armorClass = "partial";
      const override = normalizeCoverageOverride(sys?.hitLocationStates?.[locKey]?.coverageOverride);
      if (override) armorClass = override;
      if (armorClass === "none") continue;

      const covered = catLocs ? catLocs.includes(locKey) : (hitLocs?.[locKey] === true);
      if (!covered) continue;

      let ar = (sys?.armorEffective != null) ? Number(sys.armorEffective) : Number(sys?.armor ?? 0);
      const locDamagedRaw = sys?.hitLocationStates?.[locKey]?.damaged;
      const locDamaged = Number.isFinite(Number(locDamagedRaw)) ? Math.max(0, Math.floor(Number(locDamagedRaw))) : 0;
      if (locDamaged > 0) ar = Math.max(0, ar - locDamaged);

      out.push({ name: String(item.name ?? "Armor"), ar: Number.isFinite(ar) ? ar : 0 });
    }
    return out;
  } catch (_err) {
    return [];
  }
}
