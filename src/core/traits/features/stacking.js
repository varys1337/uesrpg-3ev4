/**
 * @module traits/features/stacking
 * @description Generic stacking reducer for FeatureMods.
 *
 * Implements Chapter 4 stacking rules:
 *  - "none"     → keep first (non-stackable traits)
 *  - "highest"  → keep max numeric value (X-traits)
 *  - "any"      → boolean OR
 *  - "add"      → sum numeric values
 *  - "override" → last-wins
 *
 * Must be deterministic and side-effect free.
 */

import { STACKING_MODES } from "./feature-mod.js";

let _debugEnabled = false;
let _debugChecked = false;

function _isDebug() {
  if (!_debugChecked) {
    try {
      _debugEnabled = game?.settings?.get?.("uesrpg-3ev4", "activationDebug") === true;
    } catch (_e) {
      _debugEnabled = false;
    }
    _debugChecked = true;
    setTimeout(() => { _debugChecked = false; }, 30_000);
  }
  return _debugEnabled;
}

/**
 * Reduce an incoming FeatureMod against an existing array of mods for the same path.
 *
 * Returns a new array representing the post-stacking state. The array contains
 * the mods that should remain active (i.e. that contribute to the final value).
 *
 * @param {FeatureMod[]} existing  Currently accepted mods for a given path.
 * @param {FeatureMod}   incoming  A new mod to merge in.
 * @param {string}       stackingMode  One of STACKING_MODES values.
 * @returns {{ mods: FeatureMod[], changed: boolean }}
 */
export function reduceByStacking(existing, incoming, stackingMode) {
  const mode = stackingMode ?? STACKING_MODES.NONE;

  switch (mode) {
    // ── Non-stackable: keep the first contributor only ──
    case STACKING_MODES.NONE: {
      if (existing.length > 0) {
        if (_isDebug()) {
          console.debug(
            `uesrpg | Stacking NONE: ignoring duplicate for path="${incoming.path}" ` +
            `from ${incoming.source?.itemName ?? incoming.source?.key ?? "?"}`,
          );
        }
        return { mods: existing, changed: false };
      }
      return { mods: [incoming], changed: true };
    }

    // ── Highest X wins ──
    case STACKING_MODES.HIGHEST: {
      const incomingVal = Number(incoming.value ?? 0);
      if (existing.length === 0) {
        return { mods: [incoming], changed: true };
      }
      const currentBest = existing[0];
      const currentVal = Number(currentBest.value ?? 0);
      if (incomingVal > currentVal) {
        if (_isDebug()) {
          console.debug(
            `uesrpg | Stacking HIGHEST: ${incoming.source?.itemName ?? "?"} ` +
            `(${incomingVal}) supersedes (${currentVal}) for path="${incoming.path}"`,
          );
        }
        // Replace — only the highest contributor is kept
        return { mods: [incoming], changed: true };
      }
      return { mods: existing, changed: false };
    }

    // ── Boolean OR ──
    case STACKING_MODES.ANY: {
      const isTruthy = Boolean(incoming.value);
      if (existing.length > 0 && Boolean(existing[0].value)) {
        // Already true — idempotent
        return { mods: existing, changed: false };
      }
      if (isTruthy) {
        return { mods: [incoming], changed: true };
      }
      return { mods: existing, changed: false };
    }

    // ── Additive stacking (explicitly allowed by rules) ──
    case STACKING_MODES.ADD: {
      return { mods: [...existing, incoming], changed: true };
    }

    // ── Override: last wins ──
    case STACKING_MODES.OVERRIDE: {
      return { mods: [incoming], changed: true };
    }

    default: {
      if (_isDebug()) {
        console.warn(`uesrpg | Unknown stacking mode "${mode}", defaulting to NONE`);
      }
      if (existing.length > 0) return { mods: existing, changed: false };
      return { mods: [incoming], changed: true };
    }
  }
}


/**
 * Reduce a full array of FeatureMods by path, applying stacking rules.
 *
 * @param {FeatureMod[]} allMods  Flat array of all feature mods.
 * @returns {{ byPath: Map<string, FeatureMod[]>, totals: Map<string, number|boolean> }}
 */
export function reduceAllByStacking(allMods) {
  /** @type {Map<string, FeatureMod[]>} */
  const byPath = new Map();

  for (const mod of allMods) {
    const path = mod.path;
    const stacking = mod.rule?.stacking ?? STACKING_MODES.NONE;
    const existing = byPath.get(path) ?? [];
    const { mods: updated } = reduceByStacking(existing, mod, stacking);
    byPath.set(path, updated);
  }

  // Compute final totals per path.
  /** @type {Map<string, number|boolean>} */
  const totals = new Map();

  for (const [path, mods] of byPath) {
    if (mods.length === 0) continue;

    const firstMode = mods[0].mode;
    if (firstMode === "boolean") {
      totals.set(path, mods.some(m => Boolean(m.value)));
    } else {
      // Numeric: sum all kept mods (after stacking, "highest" keeps only 1, "none" keeps only 1, "add" keeps all)
      let total = 0;
      for (const m of mods) {
        total += Number(m.value ?? 0);
      }
      totals.set(path, total);
    }
  }

  return { byPath, totals };
}
