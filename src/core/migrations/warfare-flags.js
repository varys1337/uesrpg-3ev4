import { SYSTEM_ID } from "../constants.js";
import { isActiveGMUser } from "../../utils/users.js";
import { assertDocumentWriteConfirmed } from "../../utils/authority-proxy/shared.js";
import {
  getMigrationState,
  isMigrationRevisionApplied,
  markMigrationRevisionApplied,
  setMigrationState
} from "./state.js";
import { MIGRATION_REVISIONS } from "./revisions.js";
import { migrateArmyCampaignState } from "../mass-warfare/campaign/state.js";
import { migrateWarfareSiegeState, migrateWarfareFeatureState } from "../mass-warfare/siege/state.js";

const MODULE_ID = SYSTEM_ID;
const _WARFARE_FLAGS_MIGRATION_KEY = "warfareFlagsV1";
const _WARFARE_FLAGS_MIGRATION_REVISION = MIGRATION_REVISIONS.warfareFlagsV1;

function _same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function migrateWarfareFlagDocumentsIfNeeded() {
  if (!isActiveGMUser(game.user)) return;

  const state = getMigrationState();
  if (isMigrationRevisionApplied(_WARFARE_FLAGS_MIGRATION_KEY, _WARFARE_FLAGS_MIGRATION_REVISION, state)) return;

  try {
    let updatedCount = 0;

    for (const actor of game.actors?.contents ?? []) {
      if (String(actor?.type ?? "") !== "Group") continue;
      const raw = actor.flags?.[SYSTEM_ID]?.massWarfareArmy;
      if (raw === undefined) continue;
      const migrated = migrateArmyCampaignState(raw);
      if (_same(raw, migrated)) continue;
      const expectedIds = [actor.id];
      const updated = await actor.update({ [`flags.${SYSTEM_ID}.massWarfareArmy`]: migrated });
      assertDocumentWriteConfirmed(expectedIds, updated ? [updated] : [], "Actor");
      updatedCount += 1;
    }

    for (const scene of game.scenes?.contents ?? []) {
      const rawSiege = scene.flags?.[SYSTEM_ID]?.warfareSiege;
      if (rawSiege !== undefined) {
        const migratedSiege = migrateWarfareSiegeState(rawSiege);
        if (!_same(rawSiege, migratedSiege)) {
          const expectedIds = [scene.id];
          const updated = await scene.update({ [`flags.${SYSTEM_ID}.warfareSiege`]: migratedSiege });
          assertDocumentWriteConfirmed(expectedIds, updated ? [updated] : [], "Scene");
          updatedCount += 1;
        }
      }

      for (const region of scene?.regions?.contents ?? []) {
        const rawFeature = region.flags?.[SYSTEM_ID]?.warfareFeature;
        if (rawFeature === undefined) continue;
        const migratedFeature = migrateWarfareFeatureState(rawFeature);
        if (_same(rawFeature, migratedFeature)) continue;
        const expectedIds = [region.id];
        const updated = await region.update({ [`flags.${SYSTEM_ID}.warfareFeature`]: migratedFeature });
        assertDocumentWriteConfirmed(expectedIds, updated ? [updated] : [], `${scene.uuid}.Region`);
        updatedCount += 1;
      }
    }

    markMigrationRevisionApplied(state, _WARFARE_FLAGS_MIGRATION_KEY, _WARFARE_FLAGS_MIGRATION_REVISION, {
      updatedCount,
    });
    await setMigrationState(state);
    console.log(`${MODULE_ID} | Warfare flag migration complete (${updatedCount} document(s) updated)`);
  } catch (err) {
    console.error(`${MODULE_ID} | Warfare flag migration failed`, err);
    throw err;
  }
}
