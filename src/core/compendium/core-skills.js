import { FLAG_SCOPE } from "../constants.js";
import { ensureIndex, getCompendiumPack, getDocumentsByIds } from "./access-service.js";

export const CORE_SKILLS_PACK_ID = "uesrpg-3ev4.core-skills";
export const CORE_SKILLS_FOLDER_NAME = "Core";
export const CORE_SKILL_SOURCE_ID_FLAG = "coreSkillSourceId";
export const CORE_SKILL_SOURCE_FOLDER_FLAG = "coreSkillSourceFolder";

let _coreSkillMetadataPromise = null;
let _coreSkillSourcesPromise = null;

function _trim(value) {
  return String(value ?? "").trim();
}

function _documentId(value) {
  return _trim(value?.id ?? value?._id ?? value);
}

function _entryFolderId(entry) {
  const folder = entry?.folder;
  if (!folder) return "";
  if (typeof folder === "string") return _trim(folder);
  return _documentId(folder);
}

function _collectionContents(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return [];
}

function _warn(message) {
  console.warn(`uesrpg-3ev4 | ${message}`);
}

function _parseCoreSkillsUuid(value) {
  const raw = _trim(value);
  if (!raw) return "";
  const parts = raw.split(".");
  if (parts.length >= 5 && parts[0] === "Compendium") {
    const packId = `${parts[1]}.${parts[2]}`;
    if (packId !== CORE_SKILLS_PACK_ID) return "";
    const itemIdx = parts.indexOf("Item");
    if (itemIdx >= 0 && parts[itemIdx + 1]) return _trim(parts[itemIdx + 1]);
    return _trim(parts.at(-1));
  }
  return "";
}

export function extractCoreSkillSourceDocumentId(itemLike) {
  const explicit = _trim(itemLike?.flags?.[FLAG_SCOPE]?.[CORE_SKILL_SOURCE_ID_FLAG]);
  if (explicit) return explicit;

  const candidates = [
    itemLike?.flags?.core?.sourceId,
    itemLike?._stats?.compendiumSource,
    itemLike?.uuid,
  ];
  for (const candidate of candidates) {
    const parsed = _parseCoreSkillsUuid(candidate);
    if (parsed) return parsed;
  }
  return "";
}

export function getEmbeddedCoreSkillFolderId(itemLike) {
  return _entryFolderId(itemLike);
}

export function stampCoreSkillSource(source) {
  const data = foundry.utils.deepClone(source ?? {});
  const sourceId = _documentId(data);
  data.flags = data.flags && typeof data.flags === "object" ? data.flags : {};
  data.flags[FLAG_SCOPE] = data.flags[FLAG_SCOPE] && typeof data.flags[FLAG_SCOPE] === "object"
    ? data.flags[FLAG_SCOPE]
    : {};
  data.flags[FLAG_SCOPE][CORE_SKILL_SOURCE_ID_FLAG] = sourceId;
  data.flags[FLAG_SCOPE][CORE_SKILL_SOURCE_FOLDER_FLAG] = CORE_SKILLS_FOLDER_NAME;
  return data;
}

export async function getCoreSkillMetadata() {
  if (_coreSkillMetadataPromise) return _coreSkillMetadataPromise;

  _coreSkillMetadataPromise = (async () => {
    const pack = getCompendiumPack(CORE_SKILLS_PACK_ID);
    if (!pack) {
      _warn("Core skills compendium pack not found; skipping skill pre-population.");
      return { rows: [], documentIds: new Set(), coreFolderIds: new Set(), allFolderIds: new Set() };
    }

    const folders = _collectionContents(pack.folders);
    const allFolderIds = new Set(folders.map((folder) => _documentId(folder)).filter(Boolean));
    const coreFolderIds = new Set(
      folders
        .filter((folder) => _trim(folder?.name) === CORE_SKILLS_FOLDER_NAME)
        .map((folder) => _documentId(folder))
        .filter(Boolean)
    );
    if (!coreFolderIds.size) {
      _warn(`Core skills compendium folder "${CORE_SKILLS_FOLDER_NAME}" not found; skipping skill pre-population.`);
      return { rows: [], documentIds: new Set(), coreFolderIds, allFolderIds };
    }

    const index = await ensureIndex(CORE_SKILLS_PACK_ID, { fields: ["name", "folder"] });
    if (!index.length) {
      _warn("Core skills compendium pack index is empty; skipping skill pre-population.");
      return { rows: [], documentIds: new Set(), coreFolderIds, allFolderIds };
    }

    const rows = [...index]
      .filter((entry) => coreFolderIds.has(_entryFolderId(entry)))
      .sort((a, b) => _trim(a?.name).localeCompare(_trim(b?.name)));
    if (!rows.length) {
      _warn(`No skill entries found in Core Skills -> ${CORE_SKILLS_FOLDER_NAME}; skipping skill pre-population.`);
    }

    return {
      rows,
      documentIds: new Set(rows.map((entry) => _documentId(entry)).filter(Boolean)),
      coreFolderIds,
      allFolderIds,
    };
  })();

  return _coreSkillMetadataPromise;
}

export async function getCoreSkillSourcesSorted() {
  if (_coreSkillSourcesPromise) return _coreSkillSourcesPromise;

  _coreSkillSourcesPromise = (async () => {
    const metadata = await getCoreSkillMetadata();
    if (!metadata.rows.length) return [];
    const collection = await getDocumentsByIds(CORE_SKILLS_PACK_ID, metadata.rows.map((entry) => entry?._id));
    return collection.map((item) => stampCoreSkillSource(item.toObject()));
  })();

  return _coreSkillSourcesPromise;
}
