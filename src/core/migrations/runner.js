import { SYSTEM_ID } from "../constants.js";
import { migrateActorsIfNeeded, migrateWarfareUnitNeutralLanesIfNeeded } from "./actors.js";
import { migrateItemsIfNeeded } from "./items.js";
import { migrateCombatLegacyIfNeeded } from "./combat-legacy.js";

let _inFlight = null;

function _isGM() {
  return Boolean(game.user?.isGM);
}

/**
 * Run system migrations once, guarded by an in-flight lock.
 *
 * @param {object} options
 * @param {"startup"|"manual"} [options.origin]
 * @param {boolean} [options.notifyStart]
 * @param {boolean} [options.notifySuccess]
 * @param {boolean} [options.notifyFailure]
 */
export async function runSystemMigrations({
  origin = "manual",
  notifyStart = false,
  notifySuccess = false,
  notifyFailure = true,
} = {}) {
  if (!_isGM()) return { ok: false, reason: "not-gm" };
  if (_inFlight) return _inFlight;

  const promise = (async () => {
    const startedAt = Date.now();
    try {
      if (notifyStart) {
        ui.notifications?.info?.("UESRPG migration pass started.");
      }

      await migrateActorsIfNeeded();
      await migrateItemsIfNeeded();
      await migrateCombatLegacyIfNeeded();
      await migrateWarfareUnitNeutralLanesIfNeeded();

      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const elapsedSec = (elapsedMs / 1000).toFixed(2);
      console.log(`${SYSTEM_ID} | Migration pass complete`, { origin, elapsedMs });

      if (notifySuccess) {
        ui.notifications?.info?.(`UESRPG migrations complete (${elapsedSec}s).`);
      }

      return { ok: true, elapsedMs };
    } catch (err) {
      console.error(`${SYSTEM_ID} | Migration pass failed`, { origin, err });
      if (notifyFailure) {
        ui.notifications?.warn?.("UESRPG migration pass failed; check console for details.");
      }
      return { ok: false, reason: "error", err };
    } finally {
      _inFlight = null;
    }
  })();

  _inFlight = promise;
  return promise;
}

export function isSystemMigrationRunning() {
  return _inFlight !== null;
}
