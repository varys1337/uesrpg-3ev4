import { SYSTEM_ID } from "../constants.js";
import { isActiveGMUser } from "../../utils/users.js";
import { MIGRATION_REVISIONS } from "./revisions.js";
import {
  getMigrationState,
  isMigrationRevisionApplied,
  markMigrationRevisionApplied,
  setMigrationState,
} from "./state.js";

const MIGRATION_KEY = "systemTemplateDirectiveCleanup";

function _contents(collectionLike) {
  if (Array.isArray(collectionLike?.contents)) return collectionLike.contents;
  try {
    return Array.from(collectionLike ?? []);
  } catch (_error) {
    return [];
  }
}

function _plainSource(document) {
  if (typeof document?.toObject !== "function") return null;
  return JSON.parse(JSON.stringify(document.toObject(true)));
}

function _canonical(value) {
  if (Array.isArray(value)) return value.map(_canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, _canonical(value[key])]));
}

function _sameData(left, right) {
  return JSON.stringify(_canonical(left)) === JSON.stringify(_canonical(right));
}

function _candidate(document, reference) {
  const source = _plainSource(document);
  if (!source?.system || typeof source.system !== "object" || Array.isArray(source.system)) return null;
  if (!Object.hasOwn(source.system, "templates")) return null;
  const system = structuredClone(source.system);
  delete system.templates;
  return { id: document.id, reference, system };
}

function _deletion(candidate) {
  return {
    _id: candidate.id,
    "system.templates": foundry.data.operators.ForcedDeletion.create(),
  };
}

function _verifyCandidate(candidate, current, failures) {
  const source = _plainSource(current);
  const valid = current?.id === candidate.id
    && source?.system
    && !Object.hasOwn(source.system, "templates")
    && _sameData(source.system, candidate.system);
  if (!valid) failures.push(candidate.reference);
}

function _scanRemaining() {
  const remaining = [];
  for (const actor of _contents(game.actors)) {
    if (Object.hasOwn(_plainSource(actor)?.system ?? {}, "templates")) {
      remaining.push({ scope: "actor", actorId: actor.id, documentId: actor.id, name: actor.name });
    }
    for (const item of _contents(actor.items)) {
      if (!Object.hasOwn(_plainSource(item)?.system ?? {}, "templates")) continue;
      remaining.push({ scope: "embeddedItem", actorId: actor.id, documentId: item.id, name: item.name });
    }
  }
  for (const item of _contents(game.items)) {
    if (!Object.hasOwn(_plainSource(item)?.system ?? {}, "templates")) continue;
    remaining.push({ scope: "worldItem", actorId: null, documentId: item.id, name: item.name });
  }
  return remaining;
}

export async function migrateSystemTemplateDirectivesIfNeeded() {
  if (!isActiveGMUser(game.user)) return { applied: false, reason: "not-active-gm" };
  const state = getMigrationState();
  const revision = MIGRATION_REVISIONS[MIGRATION_KEY];
  if (isMigrationRevisionApplied(MIGRATION_KEY, revision, state)) {
    return { applied: false, reason: "already-applied" };
  }

  const telemetry = {
    actors: { scanned: 0, updated: 0 },
    embeddedItems: { scanned: 0, updated: 0 },
    worldItems: { scanned: 0, updated: 0 },
    remaining: 0,
    failures: 0,
  };
  const failures = [];

  try {
    const actorCandidates = [];
    const embeddedByActor = new Map();
    for (const actor of _contents(game.actors)) {
      telemetry.actors.scanned += 1;
      const actorCandidate = _candidate(actor, {
        scope: "actor", actorId: actor.id, documentId: actor.id, name: actor.name,
      });
      if (actorCandidate) actorCandidates.push(actorCandidate);

      const embedded = [];
      for (const item of _contents(actor.items)) {
        telemetry.embeddedItems.scanned += 1;
        const candidate = _candidate(item, {
          scope: "embeddedItem", actorId: actor.id, documentId: item.id, name: item.name,
        });
        if (candidate) embedded.push(candidate);
      }
      if (embedded.length) embeddedByActor.set(actor.id, embedded);
    }

    const worldItemCandidates = [];
    for (const item of _contents(game.items)) {
      telemetry.worldItems.scanned += 1;
      const candidate = _candidate(item, {
        scope: "worldItem", actorId: null, documentId: item.id, name: item.name,
      });
      if (candidate) worldItemCandidates.push(candidate);
    }

    if (actorCandidates.length) {
      await Actor.updateDocuments(actorCandidates.map(_deletion), { diff: false });
      telemetry.actors.updated = actorCandidates.length;
      for (const candidate of actorCandidates) {
        _verifyCandidate(candidate, game.actors.get(candidate.id), failures);
      }
    }

    for (const [actorId, candidates] of embeddedByActor) {
      const actor = game.actors.get(actorId);
      if (!actor) {
        failures.push(...candidates.map((candidate) => candidate.reference));
        continue;
      }
      await actor.updateEmbeddedDocuments("Item", candidates.map(_deletion), { diff: false });
      telemetry.embeddedItems.updated += candidates.length;
      for (const candidate of candidates) {
        _verifyCandidate(candidate, actor.items.get(candidate.id), failures);
      }
    }

    if (worldItemCandidates.length) {
      await Item.updateDocuments(worldItemCandidates.map(_deletion), { diff: false });
      telemetry.worldItems.updated = worldItemCandidates.length;
      for (const candidate of worldItemCandidates) {
        _verifyCandidate(candidate, game.items.get(candidate.id), failures);
      }
    }

    const remaining = _scanRemaining();
    telemetry.remaining = remaining.length;
    telemetry.failures = failures.length;
    if (failures.length || remaining.length) {
      const error = new Error(`System template cleanup failed ${failures.length} postcondition(s) with ${remaining.length} document(s) remaining.`);
      error.migrationTelemetry = { ...telemetry, failureReferences: failures, remainingReferences: remaining };
      throw error;
    }

    markMigrationRevisionApplied(state, MIGRATION_KEY, revision, telemetry);
    await setMigrationState(state);
    console.log(`${SYSTEM_ID} | Removed persisted system template directives`, telemetry);
    return { applied: true, telemetry };
  } catch (error) {
    console.error(`${SYSTEM_ID} | System template directive cleanup failed`, { telemetry, error });
    throw error;
  }
}
