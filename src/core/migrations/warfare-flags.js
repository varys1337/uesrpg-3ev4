import { SYSTEM_ID } from "../constants.js";
import { getMigrationState, getSystemVersionString, setMigrationState } from "./state.js";
import { migrateArmyCampaignState } from "../mass-warfare/campaign/state.js";
import { migrateWarfareSiegeState, migrateWarfareFeatureState } from "../mass-warfare/siege/state.js";

const MODULE_ID = SYSTEM_ID;
const _WARFARE_FLAGS_MIGRATION_KEY = "warfareFlagsV1";

function _same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function migrateWarfareFlagDocumentsIfNeeded() {
  if (!game.user?.isGM) return;

  const currentVersion = getSystemVersionString();
  const state = getMigrationState();
  if (state?.[_WARFARE_FLAGS_MIGRATION_KEY]) return;

  try {
    let updatedCount = 0;

    for (const actor of game.actors?.contents ?? []) {
      if (String(actor?.type ?? "") !== "Group") continue;
      const raw = actor.flags?.[SYSTEM_ID]?.massWarfareArmy;
      if (raw === undefined) continue;
      const migrated = migrateArmyCampaignState(raw);
      if (_same(raw, migrated)) continue;
      await actor.update({ [`flags.${SYSTEM_ID}.massWarfareArmy`]: migrated });
      updatedCount += 1;
    }

    for (const scene of game.scenes?.contents ?? []) {
      const rawSiege = scene.flags?.[SYSTEM_ID]?.warfareSiege;
      if (rawSiege !== undefined) {
        const migratedSiege = migrateWarfareSiegeState(rawSiege);
        if (!_same(rawSiege, migratedSiege)) {
          await scene.update({ [`flags.${SYSTEM_ID}.warfareSiege`]: migratedSiege });
          updatedCount += 1;
        }
      }

      for (const region of scene?.regions?.contents ?? []) {
        const rawFeature = region.flags?.[SYSTEM_ID]?.warfareFeature;
        if (rawFeature === undefined) continue;
        const migratedFeature = migrateWarfareFeatureState(rawFeature);
        if (_same(rawFeature, migratedFeature)) continue;
        await region.update({ [`flags.${SYSTEM_ID}.warfareFeature`]: migratedFeature });
        updatedCount += 1;
      }
    }

    state[_WARFARE_FLAGS_MIGRATION_KEY] = {
      appliedAt: Date.now(),
      updatedCount,
      systemVersion: currentVersion,
    };
    await setMigrationState(state);
    console.log(`${MODULE_ID} | Warfare flag migration complete (${updatedCount} document(s) updated)`);
  } catch (err) {
    console.error(`${MODULE_ID} | Warfare flag migration failed`, err);
    ui.notifications?.error?.("UESRPG warfare flag migration failed; check console for details.");
  }
}
