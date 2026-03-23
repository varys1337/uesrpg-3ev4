/**
 * src/core/mass-warfare/profiles/legacy-stub.js
 *
 * Stub profile for pre-0.2 mass warfare approaches.
 *
 * Rules for this approach are not yet fully canonized.
 * This profile acts as a placeholder: it can be selected on a Warfare Unit
 * actor but it delegates all derivation to the 0.2 profile's computeDerived
 * (for safe fallback) and surfaces a GM notice.
 *
 * Full implementation requires: category taxonomy, gear tables, encounter model,
 * and action registry from the legacy source rules.
 *
 * Status: DEFERRED (no complete source rules available).
 */

import { computeDerived as compute0_2 } from "./uesrpg-0_2.js";

export const LEGACY_STUB_PROFILE = Object.freeze({
  id: "legacy",
  label: "Legacy (Pre-0.2, Deferred)",
  categories: {},
  gearTiers: {},
  mounts: {},
  racialPresets: {},
  economy: { supportedCadences: ["weekly"], supportedModes: ["gold"] },
  magic: { supportedModes: ["standard"] },
  actions: { unitActions: [], leaderActions: [] },

  /**
   * Falls back to 0.2 derivation for safety.
   * GM notices make the stub state visible in the sheet.
   */
  computeDerived(sys) {
    const result = compute0_2(sys);
    if (sys._derived) {
      sys._derived.profileId = "legacy";
      sys._derived.warnings = [
        ...(sys._derived.warnings ?? []),
        "This unit uses the Legacy (Pre-0.2) profile. Rules for this profile are not yet canonized. Showing 0.2 derived stats as a placeholder.",
      ];
    }
    return result;
  },

  sheetModel: {
    tabs: ["overview", "composition", "command", "combat", "magic", "logistics", "equipment", "effects", "notes", "variant"],
    encounterModel: "Legacy (deferred — rules not yet canonized)",
    notices: [
      "⚠ Legacy profile: The pre-0.2 mass warfare rules are not yet fully documented in this system. Derived stats shown are 0.2 estimates. Update this unit to the uesrpg-0_2 profile when ready.",
    ],
  },
});
