/**
 * Select the currently equipped ranged weapon for an actor.
 * Prefers system-equipped bindings (primary -> secondary), then any equipped ranged weapon item.
 */
import { getWeaponCombatCapabilities } from "../../combat-utils.js";

export function selectEquippedRangedWeapon(actor) {
  const byId = (id) => (id ? (actor?.items?.get?.(id) ?? null) : null);

  const ew = actor?.system?.equippedWeapons ?? {};
  const candidates = [
    ew?.primaryWeapon?.id,
    ew?.secondaryWeapon?.id,
    ew?.primary?.id,
    ew?.secondary?.id,
    ew?.equippedWeapons?.primaryWeapon?.id,
    ew?.equippedWeapons?.secondaryWeapon?.id
  ].filter(Boolean);

  for (const id of candidates) {
    const w = byId(id);
    if (w && getWeaponCombatCapabilities(w).rangedCapable) return w;
  }

  const equipped = actor?.items?.filter?.((i) => i?.type === "weapon" && i?.system?.equipped === true) ?? [];
  return equipped.find((w) => getWeaponCombatCapabilities(w).rangedCapable) ?? null;
}
