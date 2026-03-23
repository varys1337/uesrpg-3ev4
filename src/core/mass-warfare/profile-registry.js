/**
 * src/core/mass-warfare/profile-registry.js
 *
 * Central registry for Mass Warfare profiles.
 *
 * A profile owns: category catalog, gear tables, mount catalog, racial presets,
 * economy model, magic model, action registry, and derived-data computation.
 *
 * The actor stores a neutral profile id (`system.profile.id`). At prepare-time
 * the registry resolves the active profile and delegates all derived computation
 * to it. Sheet context flows through the resolved profile for labels and
 * option catalogs.
 *
 * Registration must happen before system ready (e.g. from system.js).
 */

const _PROFILES = new Map();

/**
 * Register a Mass Warfare profile.
 * @param {{ id: string }} profile - Must have a unique `.id` string.
 */
export function registerWarfareProfile(profile) {
  if (!profile?.id || typeof profile.id !== "string") {
    console.warn("UESRPG | registerWarfareProfile: profile must have a string .id", profile);
    return;
  }
  if (_PROFILES.has(profile.id)) {
    console.warn(`UESRPG | registerWarfareProfile: profile "${profile.id}" already registered; overwriting.`);
  }
  _PROFILES.set(profile.id, profile);
}

/**
 * Resolve a profile by id. Falls back to the default profile if not found.
 * @param {string|null|undefined} id
 * @returns {object} profile
 */
export function resolveWarfareProfile(id) {
  const key = String(id ?? "").trim();
  return _PROFILES.get(key) ?? _PROFILES.get(DEFAULT_PROFILE_ID) ?? _nullProfile();
}

/** Default profile id — the active encounter baseline. */
export const DEFAULT_PROFILE_ID = "uesrpg-0_2";

/**
 * All registered profile ids with labels.
 * @returns {{ id: string, label: string }[]}
 */
export function listWarfareProfiles() {
  return Array.from(_PROFILES.values()).map((p) => ({ id: p.id, label: p.label ?? p.id }));
}

/** Minimal null-profile used when no profile resolves. */
function _nullProfile() {
  return {
    id: "null",
    label: "Unknown Profile",
    categories: {},
    gearTiers: {},
    mounts: {},
    racialPresets: {},
    economy: { supportedCadences: ["weekly"], supportedModes: ["gold"] },
    magic: { supportedModes: ["standard"] },
    actions: { unitActions: [], leaderActions: [] },
    computeDerived: () => ({}),
    sheetModel: { tabs: [], notices: ["No active profile found."] },
  };
}
