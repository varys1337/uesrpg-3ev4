const _indexCache = new Map();
const _normalizedNameCache = new Map();

function _fieldsKey(fields = []) {
  return Array.from(new Set((Array.isArray(fields) ? fields : []).map((f) => String(f ?? "").trim()).filter(Boolean))).sort().join("|");
}

function _cacheKey(packId, fields = []) {
  return `${String(packId ?? "")}::${_fieldsKey(fields)}`;
}

export function normalizeCompendiumName(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function getCompendiumPack(packId) {
  const id = String(packId ?? "").trim();
  if (!id) return null;
  return game?.packs?.get?.(id) ?? null;
}

export async function ensureIndex(packId, { fields = [] } = {}) {
  const pack = getCompendiumPack(packId);
  if (!pack) return [];

  const key = _cacheKey(pack.collection ?? packId, fields);
  if (_indexCache.has(key)) return _indexCache.get(key);

  const index = await pack.getIndex({ fields });
  const rows = Array.from(index ?? []);
  _indexCache.set(key, rows);
  return rows;
}

export async function findIndexEntryByNormalizedName(packId, normalizedName, { fields = ["name"] } = {}) {
  const wanted = normalizeCompendiumName(normalizedName);
  if (!wanted) return null;

  const key = `${_cacheKey(packId, fields)}::name-map`;
  let lookup = _normalizedNameCache.get(key);
  if (!lookup) {
    const index = await ensureIndex(packId, { fields: Array.from(new Set(["name", ...fields])) });
    lookup = new Map();
    for (const entry of index) {
      const name = normalizeCompendiumName(entry?.name);
      if (name && !lookup.has(name)) lookup.set(name, entry);
    }
    _normalizedNameCache.set(key, lookup);
  }

  return lookup.get(wanted) ?? null;
}

export async function getDocumentById(packId, id) {
  const pack = getCompendiumPack(packId);
  const docId = String(id ?? "").trim();
  if (!pack || !docId) return null;
  return pack.getDocument(docId);
}

export async function getDocumentsByIds(packId, ids = []) {
  const pack = getCompendiumPack(packId);
  if (!pack) return [];

  const wantedIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (!wantedIds.length) return [];

  const docs = await pack.getDocuments({ _id__in: wantedIds });
  const byId = new Map(Array.from(docs ?? []).map((doc) => [String(doc?.id ?? doc?._id ?? ""), doc]));
  return wantedIds.map((id) => byId.get(id)).filter(Boolean);
}

export function clearCompendiumAccessCache(packId = null) {
  if (!packId) {
    _indexCache.clear();
    _normalizedNameCache.clear();
    return;
  }

  const prefix = `${String(packId)}::`;
  for (const key of Array.from(_indexCache.keys())) {
    if (key.startsWith(prefix)) _indexCache.delete(key);
  }
  for (const key of Array.from(_normalizedNameCache.keys())) {
    if (key.startsWith(prefix)) _normalizedNameCache.delete(key);
  }
}
