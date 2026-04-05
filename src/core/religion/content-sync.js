import { SYSTEM_ID } from "../system/namespace.js";
import {
  RELIGION_CONTENT_JSON_PATHS,
  RELIGION_PACK_IDS,
} from "./constants.js";
import {
  buildDomainSpellCompendiumSource,
  buildInvocationCompendiumSource,
  normalizeReligionLookupKey,
} from "../../data/religion/content-builders.js";

function cloneData(value) {
  try {
    return structuredClone(value);
  } catch (_err) {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

function sanitizePackDocument(value) {
  const cloned = cloneData(value) ?? {};
  delete cloned._stats;
  delete cloned._key;
  return cloned;
}

function getReligionSourceKey(value) {
  return String(value?.flags?.[SYSTEM_ID]?.religion?.sourceKey ?? "").trim();
}

async function fetchContentJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status})`);
  }
  return response.json();
}

async function loadReligionContentPayload() {
  const [invocations, domainSpells] = await Promise.all([
    fetchContentJson(RELIGION_CONTENT_JSON_PATHS.invocations),
    fetchContentJson(RELIGION_CONTENT_JSON_PATHS.domainSpells),
  ]);
  return {
    invocations: Array.isArray(invocations) ? invocations : [],
    domainSpells: Array.isArray(domainSpells) ? domainSpells : [],
  };
}

async function loadBaseSpellSeedLookup() {
  const pack = game.packs?.get?.(RELIGION_PACK_IDS.baseSpells);
  if (!pack) return new Map();
  const docs = await pack.getDocuments();
  const lookup = new Map();
  for (const doc of docs) {
    if (doc?.type !== "spell") continue;
    lookup.set(normalizeReligionLookupKey(doc.name), sanitizePackDocument(doc.toObject()));
  }
  return lookup;
}

function compareSources(existingDoc, desiredSource) {
  const current = sanitizePackDocument(existingDoc?.toObject?.() ?? existingDoc);
  const desired = sanitizePackDocument(desiredSource);
  return JSON.stringify(current) === JSON.stringify(desired);
}

async function syncItemPack(packId, desiredSources) {
  const pack = game.packs?.get?.(packId);
  if (!pack || pack.documentName !== "Item") {
    throw new Error(`Pack ${packId} was not found or is not an Item pack.`);
  }
  if (pack.locked) {
    throw new Error(`Pack ${pack.metadata?.label ?? packId} is locked. Unlock it before syncing.`);
  }

  const existingDocs = await pack.getDocuments();
  const desiredById = new Map(desiredSources.map((source) => [String(source._id), source]));
  const desiredBySourceKey = new Map(desiredSources.map((source) => [getReligionSourceKey(source), source]).filter(([key]) => key));
  const existingById = new Map(existingDocs.map((doc) => [String(doc.id), doc]));
  const existingBySourceKey = new Map(existingDocs.map((doc) => [getReligionSourceKey(doc), doc]).filter(([key]) => key));

  const createPayload = [];
  const updatePayload = [];
  const deleteIds = new Set();

  for (const desiredSource of desiredSources) {
    const sourceKey = getReligionSourceKey(desiredSource);
    const matched = existingBySourceKey.get(sourceKey) ?? existingById.get(String(desiredSource._id)) ?? null;
    if (!matched) {
      createPayload.push(desiredSource);
      continue;
    }

    if (String(matched.id) !== String(desiredSource._id)) {
      deleteIds.add(String(matched.id));
      createPayload.push(desiredSource);
      continue;
    }

    if (!compareSources(matched, desiredSource)) {
      updatePayload.push(desiredSource);
    }
  }

  for (const existingDoc of existingDocs) {
    const sourceKey = getReligionSourceKey(existingDoc);
    const keep = (sourceKey && desiredBySourceKey.has(sourceKey)) || desiredById.has(String(existingDoc.id));
    if (!keep) deleteIds.add(String(existingDoc.id));
  }

  if (createPayload.length) {
    await Item.implementation.createDocuments(createPayload, { pack: pack.collection, keepId: true });
  }
  if (updatePayload.length) {
    await Item.implementation.updateDocuments(updatePayload, { pack: pack.collection, diff: false });
  }
  if (deleteIds.size) {
    await Item.implementation.deleteDocuments(Array.from(deleteIds), { pack: pack.collection });
  }

  return {
    packId,
    created: createPayload.length,
    updated: updatePayload.length,
    deleted: deleteIds.size,
    total: desiredSources.length,
  };
}

export async function syncReligionContentPacks() {
  if (!game.user?.isGM) {
    throw new Error("Only GMs can sync religion content packs.");
  }

  const payload = await loadReligionContentPayload();
  const baseSpellLookup = await loadBaseSpellSeedLookup();
  const invocationSources = payload.invocations.map((record) => buildInvocationCompendiumSource(record));
  const domainSpellSources = payload.domainSpells.map((record) => {
    const baseSpellData = baseSpellLookup.get(normalizeReligionLookupKey(record?.seedSpellName ?? record?.name));
    return buildDomainSpellCompendiumSource(record, { baseSpellData: baseSpellData ?? null });
  });

  const [invocationSummary, domainSpellSummary] = await Promise.all([
    syncItemPack(RELIGION_PACK_IDS.invocations, invocationSources),
    syncItemPack(RELIGION_PACK_IDS.domainSpells, domainSpellSources),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    packs: [invocationSummary, domainSpellSummary],
  };
}
