/**
 * Explicit, development-only pack authoring in a disposable Foundry v14 world.
 * Never registered at startup and never touches world/actor Item collections.
 * API: Item.createDocuments/updateDocuments/deleteDocuments with {pack},
 * DatabaseCreateOperation.keepId/keepEmbeddedIds, CompendiumCollection.configure.
 */
import { SYSTEM_ID } from "../../core/constants.js";
import { assertDocumentWriteConfirmed } from "../authority-proxy/shared.js";

const CORE_PACKS = Object.freeze(["core-skills", "signs", "items-revised", "powers-talents-traits", "spells-revised"]);
const batchSize = 40;

function requireAuthoringWorld(expectedWorldId) {
  if (!game.user?.isGM) throw new Error("Pack authoring requires a GM.");
  if (!expectedWorldId || game.world?.id !== expectedWorldId) {
    throw new Error("Provide the exact disposable authoring world ID; the current world did not match.");
  }
}

function writableData(source) {
  const data = foundry.utils.deepClone(source);
  delete data._stats;
  return data;
}

function comparable(data) {
  const result = writableData(data);
  // Foundry owns database timestamps; all authored statistics and identities remain checked.
  for (const effect of result.effects ?? []) delete effect._stats;
  return result;
}

async function writeBatches(method, data, pack) {
  for (let offset = 0; offset < data.length; offset += batchSize) {
    const batch = data.slice(offset, offset + batchSize);
    const result = await Item.implementation[method](batch, {
      pack: pack.collection, keepId: true, keepEmbeddedIds: true,
      ...(method === "updateDocuments" ? { diff: false, recursive: false } : {}),
    });
    assertDocumentWriteConfirmed(batch.map(row => row._id), result, pack.collection);
    if (method === "createDocuments") {
      // Foundry assigns the creating user ownership. A shipped pack must not
      // retain an authoring-world user ID, so restore the explicit source map.
      const permissions = await Item.implementation.updateDocuments(batch.map(row => ({
        _id: row._id, ownership: row.ownership ?? { default: 0 },
      })), { pack: pack.collection, diff: false, recursive: false });
      assertDocumentWriteConfirmed(batch.map(row => row._id), permissions, pack.collection);
    }
  }
}

export async function rebuildCoreCompendia({ expectedWorldId, dryRun = true, packNames = CORE_PACKS } = {}) {
  requireAuthoringWorld(expectedWorldId);
  const plans = [];
  const invalid = [];
  // Preflight every requested pack before writing any of them.
  for (const name of packNames) {
    if (!CORE_PACKS.includes(name)) throw new Error(`Pack ${name} is outside this authoring operation.`);
    const pack = game.packs.get(`${SYSTEM_ID}.${name}`);
    if (!pack || pack.documentName !== "Item") throw new Error(`Missing Item pack ${name}.`);
    const response = await fetch(`systems/${SYSTEM_ID}/packs/_source/${name}/pack.json`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Cannot read JSON authoring source for ${name}.`);
    const source = await response.json();
    if (source.pack !== pack.collection) throw new Error(`Source/pack mismatch for ${name}.`);
    const originals = await pack.getDocuments();
    const existing = new Map(originals.map(item => [item.id, item]));
    const ids = new Set();
    const normalized = source.documents.map(row => {
      if (!row._id || ids.has(row._id)) throw new Error(`Invalid or duplicate source ID in ${name}.`);
      ids.add(row._id);
      try {
        const item = new Item.implementation(writableData(row), { pack: pack.collection });
        item.validate({ strict: true });
        return item.toObject(true);
      } catch (error) {
        invalid.push({ pack: pack.collection, id: row._id, name: row.name, error: String(error.message ?? error) });
        return null;
      }
    }).filter(Boolean);
    for (const original of originals) if (!ids.has(original.id)) throw new Error(`Source omits existing ${original.uuid}.`);
    plans.push({ pack, source, normalized, existing, originals: originals.map(item => item.toObject(true)), locked: pack.locked });
  }
  if (invalid.length) throw new Error(`Native Item validation failed for ${invalid.length} sources:\n${JSON.stringify(invalid, null, 2)}`);
  const summary = plans.map(plan => ({ pack: plan.pack.collection, count: plan.normalized.length,
    additions: plan.normalized.filter(row => !plan.existing.has(row._id)).length,
    subtypeReplacements: plan.normalized.filter(row => plan.existing.has(row._id) && plan.existing.get(row._id).type !== row.type).map(row => row._id),
  }));
  if (dryRun) return { dryRun: true, world: expectedWorldId, summary };

  const backup = plans.map(plan => ({ pack: plan.pack.collection, documents: plan.originals }));
  try {
    for (const plan of plans) {
      const { pack, normalized, existing } = plan;
      if (plan.locked) await pack.configure({ locked: false });
      const replacementIds = normalized.filter(row => existing.has(row._id) && existing.get(row._id).type !== row.type).map(row => row._id);
      if (replacementIds.length) {
        const deleted = await Item.implementation.deleteDocuments(replacementIds, { pack: pack.collection });
        assertDocumentWriteConfirmed(replacementIds, deleted, pack.collection);
      }
      const create = normalized.filter(row => !existing.has(row._id) || replacementIds.includes(row._id)).map(writableData);
      const update = normalized.filter(row => existing.has(row._id) && !replacementIds.includes(row._id)).map(writableData);
      await writeBatches("createDocuments", create, pack);
      await writeBatches("updateDocuments", update, pack);
      const actual = new Map((await pack.getDocuments()).map(item => [item.id, item]));
      if (actual.size !== normalized.length) throw new Error(`Unexpected document count after writing ${pack.collection}.`);
      for (const row of normalized) {
        const persisted = actual.get(row._id)?.toObject(true);
        if (!persisted || Object.keys(foundry.utils.diffObject(comparable(row), comparable(persisted))).length
          || Object.keys(foundry.utils.diffObject(comparable(persisted), comparable(row))).length) {
          const missing = persisted ? foundry.utils.diffObject(comparable(row), comparable(persisted)) : { document: "missing" };
          const extra = persisted ? foundry.utils.diffObject(comparable(persisted), comparable(row)) : {};
          throw new Error(`Persisted source mismatch for ${pack.collection}.${row._id}: ${JSON.stringify({ missing, extra })}`);
        }
      }
    }
  } catch (error) {
    error.authoringBackup = backup;
    error.message += " Do not copy these packs into a release. The error includes authoringBackup for recovery.";
    throw error;
  } finally {
    for (const plan of plans) if (plan.pack.locked !== plan.locked) await plan.pack.configure({ locked: plan.locked });
  }
  return { dryRun: false, world: expectedWorldId, summary, backup, verification: "native Document writes and readback confirmed" };
}
