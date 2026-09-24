import { SYSTEM_ID } from "../constants.js";
import {
  getMigrationState,
  isMigrationRevisionApplied,
  markMigrationRevisionApplied,
  setMigrationState,
} from "./state.js";
import { MIGRATION_REVISIONS } from "./revisions.js";
import { normalizeEffectChanges } from "../../utils/compat.js";
import { normalizeActiveEffectDurationV14 } from "../active-effects/effect-duration-v14.js";

const CHANGE_KEY = "activeEffectChangeTypes";
const DURATION_KEY = "activeEffectDurationV14";

function _contents(collectionLike) {
  if (Array.isArray(collectionLike?.contents)) return collectionLike.contents;
  try {
    return Array.from(collectionLike ?? []);
  } catch (_error) {
    return [];
  }
}

function _plainSource(effect) {
  try {
    if (typeof effect?.toObject !== "function") return null;
    return JSON.parse(JSON.stringify(effect.toObject(true)));
  } catch (error) {
    console.error(`${SYSTEM_ID} | Could not serialize ActiveEffect source for migration`, {
      effect: effect?.uuid ?? effect?.id ?? null,
      error,
    });
    return null;
  }
}

function _changePatch(raw) {
  const source = Array.isArray(raw?.system?.changes) ? raw.system.changes : null;
  if (!source) return null;
  const normalized = normalizeEffectChanges(source);
  if (JSON.stringify(source) === JSON.stringify(normalized)) return null;
  return { "system.changes": normalized };
}

function _durationPatch(raw) {
  const duration = raw?.duration && typeof raw.duration === "object" ? raw.duration : {};
  const start = raw?.start && typeof raw.start === "object"
    ? foundry.utils.deepClone(raw.start)
    : null;
  return {
    duration: normalizeActiveEffectDurationV14(duration),
    start,
  };
}

function _buildPatch(effect, { migrateChanges, migrateDurations }, telemetry) {
  if (!effect?.id) return null;
  telemetry.scanned += 1;
  const raw = _plainSource(effect);
  if (!raw) {
    telemetry.failures += 1;
    return null;
  }
  const patch = { _id: effect.id };
  if (migrateChanges) {
    const changes = _changePatch(raw);
    if (changes) {
      Object.assign(patch, changes);
      telemetry.changeTypesConverted += 1;
    }
  }
  if (migrateDurations) {
    const duration = _durationPatch(raw);
    if (duration) {
      Object.assign(patch, duration);
      telemetry.durationsCanonicalized += 1;
    }
  }
  if (Object.keys(patch).length === 1) {
    telemetry.skipped += 1;
    return null;
  }
  return patch;
}

async function _migrateEmbedded(parent, effects, options, telemetry) {
  const updates = _contents(effects)
    .map((effect) => _buildPatch(effect, options, telemetry))
    .filter(Boolean);
  if (!updates.length) return;
  try {
    await parent.updateEmbeddedDocuments("ActiveEffect", updates, { diff: false });
  } catch (error) {
    telemetry.failures += updates.length;
    console.error(`${SYSTEM_ID} | ActiveEffect embedded migration failed`, { parent: parent?.uuid, error });
  }
}

export async function migrateActiveEffectsIfNeeded() {
  if (!game.user?.isGM) return;

  const state = getMigrationState();
  const migrateChanges = !isMigrationRevisionApplied(CHANGE_KEY, MIGRATION_REVISIONS[CHANGE_KEY], state);
  const migrateDurations = !isMigrationRevisionApplied(DURATION_KEY, MIGRATION_REVISIONS[DURATION_KEY], state);
  if (!migrateChanges && !migrateDurations) return;

  const options = { migrateChanges, migrateDurations };
  const telemetry = {
    scanned: 0,
    changeTypesConverted: 0,
    durationsCanonicalized: 0,
    skipped: 0,
    failures: 0,
  };

  try {
    const worldUpdates = _contents(game.effects ?? game.collections?.get?.("ActiveEffect"))
      .map((effect) => _buildPatch(effect, options, telemetry))
      .filter(Boolean);
    if (worldUpdates.length) {
      try {
        await ActiveEffect.updateDocuments(worldUpdates, { diff: false });
      } catch (error) {
        telemetry.failures += worldUpdates.length;
        console.error(`${SYSTEM_ID} | ActiveEffect world migration failed`, error);
      }
    }

    for (const actor of _contents(game.actors)) {
      await _migrateEmbedded(actor, actor?.effects, options, telemetry);
      for (const item of _contents(actor?.items)) {
        await _migrateEmbedded(item, item?.effects, options, telemetry);
      }
    }
    for (const item of _contents(game.items)) {
      await _migrateEmbedded(item, item?.effects, options, telemetry);
    }

    if (telemetry.failures > 0) {
      throw new Error(`${telemetry.failures} ActiveEffect update(s) failed; migration will retry next startup`);
    }

    if (migrateChanges) {
      markMigrationRevisionApplied(state, CHANGE_KEY, MIGRATION_REVISIONS[CHANGE_KEY], telemetry);
    }
    if (migrateDurations) {
      markMigrationRevisionApplied(state, DURATION_KEY, MIGRATION_REVISIONS[DURATION_KEY], telemetry);
    }
    await setMigrationState(state);
    console.log(`${SYSTEM_ID} | ActiveEffect v14 migration complete`, telemetry);
  } catch (error) {
    console.error(`${SYSTEM_ID} | ActiveEffect v14 migration failed`, { telemetry, error });
    ui.notifications?.error?.("UESRPG ActiveEffect migration failed; it will retry on the next startup.");
    throw error;
  }
}
