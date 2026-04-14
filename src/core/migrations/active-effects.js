import { SYSTEM_ID } from "../constants.js";
import { getMigrationState, setMigrationState, getSystemVersionString } from "./state.js";
import { normalizeEffectChanges } from "../../utils/compat.js";

const MODULE_ID = SYSTEM_ID;
const _ACTIVE_EFFECT_MIGRATION_KEY = "activeEffectChangeTypes";

function _getContents(collectionLike) {
  if (Array.isArray(collectionLike?.contents)) return collectionLike.contents;
  try {
    return Array.from(collectionLike ?? []);
  } catch (_e) {
    return [];
  }
}

function _buildEffectPatch(effect) {
  if (!effect?.id) return null;

  let raw;
  try {
    raw = typeof effect.toObject === "function" ? effect.toObject() : effect;
  } catch (_e) {
    raw = effect;
  }

  const sourceChanges = Array.isArray(raw?.system?.changes)
    ? raw.system.changes
    : (Array.isArray(raw?.changes) ? raw.changes : null);
  if (!Array.isArray(sourceChanges)) return null;

  const normalized = normalizeEffectChanges(sourceChanges);
  const current = Array.isArray(raw?.system?.changes) ? raw.system.changes : sourceChanges;
  const unchanged = (JSON.stringify(current) === JSON.stringify(normalized)) && !Array.isArray(raw?.changes);
  if (unchanged) return null;

  return {
    _id: effect.id,
    "system.changes": normalized
  };
}

async function _migrateEmbeddedEffects(parentDoc, embeddedCollection, embeddedName = "ActiveEffect") {
  const updates = [];
  for (const effect of _getContents(embeddedCollection)) {
    const update = _buildEffectPatch(effect);
    if (update) updates.push(update);
  }

  if (!updates.length) return 0;
  await parentDoc.updateEmbeddedDocuments(embeddedName, updates, { diff: false });
  return updates.length;
}

export async function migrateActiveEffectsIfNeeded() {
  if (!game.user?.isGM) return;

  const currentVersion = getSystemVersionString();
  const state = getMigrationState();
  if (state?.[_ACTIVE_EFFECT_MIGRATION_KEY] === currentVersion) return;

  try {
    let updatedWorldEffects = 0;
    let updatedActorEffects = 0;
    let updatedItemEffects = 0;

    const worldEffects = _getContents(game.effects ?? game.collections?.get?.("ActiveEffect"));
    const worldEffectUpdates = [];
    for (const effect of worldEffects) {
      const update = _buildEffectPatch(effect);
      if (update) worldEffectUpdates.push(update);
    }
    if (worldEffectUpdates.length) {
      await ActiveEffect.updateDocuments(worldEffectUpdates, { diff: false });
      updatedWorldEffects = worldEffectUpdates.length;
    }

    for (const actor of _getContents(game.actors)) {
      updatedActorEffects += await _migrateEmbeddedEffects(actor, actor?.effects, "ActiveEffect");

      for (const item of _getContents(actor?.items)) {
        updatedItemEffects += await _migrateEmbeddedEffects(item, item?.effects, "ActiveEffect");
      }
    }

    for (const item of _getContents(game.items)) {
      updatedItemEffects += await _migrateEmbeddedEffects(item, item?.effects, "ActiveEffect");
    }

    state[_ACTIVE_EFFECT_MIGRATION_KEY] = currentVersion;
    await setMigrationState(state);

    console.log(`${MODULE_ID} | ActiveEffect change type migration complete`, {
      updatedWorldEffects,
      updatedActorEffects,
      updatedItemEffects,
    });
  } catch (err) {
    console.error(`${MODULE_ID} | ActiveEffect change type migration failed`, err);
    ui.notifications?.error?.("UESRPG ActiveEffect migration failed; check console for details.");
  }
}
