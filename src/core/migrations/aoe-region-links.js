import { SYSTEM_ID } from "../constants.js";
import {
  getMigrationState,
  isMigrationRevisionApplied,
  markMigrationRevisionApplied,
  setMigrationState
} from "./state.js";

const MODULE_ID = SYSTEM_ID;
const _AOE_REGION_LINK_MIGRATION_KEY = "aoeRegionLinks";
const _AOE_REGION_LINK_MIGRATION_REVISION = 1;

function _getContents(collectionLike) {
  if (Array.isArray(collectionLike?.contents)) return collectionLike.contents;
  try {
    return Array.from(collectionLike ?? []);
  } catch (_e) {
    return [];
  }
}

function _normalizeLinkedEntities(linkedEntities) {
  const next = [];
  let changed = false;
  for (const entry of Array.isArray(linkedEntities) ? linkedEntities : []) {
    if (!entry || typeof entry !== "object") continue;
    const cloned = foundry.utils.deepClone(entry);
    const type = String(cloned.type ?? "").trim().toLowerCase();
    if (type === "region" || type === "template" || type === "targetae" || type === "summon" || type === "casterbuff" || type === "bounditem") {
      if (cloned.type !== type) changed = true;
      cloned.type = type;
    }
    if (!String(cloned.label ?? "").trim() && (type === "region" || type === "template")) {
      cloned.label = "Spell Zone";
      changed = true;
    }
    next.push(cloned);
  }
  return { changed, linkedEntities: next };
}

function _buildOriginPatch(effect) {
  if (!effect?.id) return null;
  const raw = typeof effect.toObject === "function" ? effect.toObject() : effect;
  const flags = raw?.flags?.[SYSTEM_ID] ?? null;
  if (!flags?.isOriginAE) return null;
  const { changed, linkedEntities } = _normalizeLinkedEntities(flags.linkedEntities);
  if (!changed) return null;
  return {
    _id: effect.id,
    [`flags.${SYSTEM_ID}.linkedEntities`]: linkedEntities
  };
}

export async function migrateAoeRegionLinksIfNeeded() {
  if (!game.user?.isGM) return;

  const state = getMigrationState();
  if (isMigrationRevisionApplied(_AOE_REGION_LINK_MIGRATION_KEY, _AOE_REGION_LINK_MIGRATION_REVISION, state)) return;

  try {
    let updatedActorEffects = 0;
    for (const actor of _getContents(game.actors)) {
      const updates = [];
      for (const effect of _getContents(actor?.effects)) {
        const patch = _buildOriginPatch(effect);
        if (patch) updates.push(patch);
      }
      if (updates.length) {
        await actor.updateEmbeddedDocuments("ActiveEffect", updates, { diff: false });
        updatedActorEffects += updates.length;
      }
    }

    markMigrationRevisionApplied(state, _AOE_REGION_LINK_MIGRATION_KEY, _AOE_REGION_LINK_MIGRATION_REVISION, {
      updatedActorEffects
    });
    await setMigrationState(state);

    console.log(`${MODULE_ID} | AoE region link migration complete`, { updatedActorEffects });
  } catch (err) {
    console.error(`${MODULE_ID} | AoE region link migration failed`, err);
    ui.notifications?.error?.("UESRPG AoE region link migration failed; check console for details.");
  }
}
