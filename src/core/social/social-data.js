import { LANGUAGE_CHOICES } from "./social-choices.js";

const KNOWN_LANG_SET = new Set(LANGUAGE_CHOICES.map((l) => normalizeKey(l)));
const CYRODILIC_KEY = normalizeKey("Cyrodilic");
const LANGUAGE_PREVIEW_LIMIT = 6;
const FACTION_PREVIEW_LIMIT = 3;

export function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function toSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseCsvList(value) {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function dedupeByNormalized(values = []) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const raw = String(v ?? "").trim();
    if (!raw) continue;
    const key = normalizeKey(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

export function normalizeFactionEntries(entries = []) {
  const seen = new Set();
  const out = [];

  for (const [idx, raw] of (entries ?? []).entries()) {
    const name = String(raw?.name ?? "").trim();
    if (!name) continue;

    const location = String(raw?.location ?? "").trim();
    const key = `${normalizeKey(name)}::${normalizeKey(location)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: String(raw?.id ?? "").trim() || `faction-${toSlug(name)}-${idx + 1}`,
      name,
      rankTitle: String(raw?.rankTitle ?? "").trim(),
      location,
      notes: String(raw?.notes ?? "").trim(),
    });
  }

  return out;
}

function makeLanguageEntry(raw = {}, index = 0) {
  const name = String(raw?.name ?? "").trim();
  if (!name) return null;
  if (normalizeKey(name) === CYRODILIC_KEY) return null;

  let speak = raw?.speak !== false;
  const readWrite = Boolean(raw?.readWrite);
  if (readWrite) speak = true;

  const source = String(raw?.source ?? "").trim().toLowerCase() === "catalog"
    ? "catalog"
    : (KNOWN_LANG_SET.has(normalizeKey(name)) ? "catalog" : "custom");

  return {
    id: String(raw?.id ?? "").trim() || `lang-${toSlug(name)}-${index + 1}`,
    name,
    speak,
    readWrite,
    source,
  };
}

export function normalizeLanguageEntries(entries = []) {
  const seen = new Set();
  const out = [];

  for (const [idx, raw] of (entries ?? []).entries()) {
    const fromString = (typeof raw === "string") ? { name: raw } : raw;
    const entry = makeLanguageEntry(fromString, idx);
    if (!entry) continue;

    const key = normalizeKey(entry.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }

  return out;
}

export function buildKnownLanguagesStringFromEntries(entries = []) {
  return dedupeByNormalized(
    normalizeLanguageEntries(entries).map((entry) => entry.name)
  ).join(", ");
}

export function getSocialStateFromSystem(actorSystem = {}) {
  const social = actorSystem?.social ?? {};
  const linguisticsKnown = String(actorSystem?.linguistics?.known ?? "");
  const currentEntries = Array.isArray(social?.languages?.entries)
    ? social.languages.entries
    : [];

  const mergedEntries = normalizeLanguageEntries([
    ...currentEntries,
    ...parseCsvList(linguisticsKnown).map((name) => ({
      name,
      speak: true,
      readWrite: true,
      source: KNOWN_LANG_SET.has(normalizeKey(name)) ? "catalog" : "custom",
    })),
  ]);

  return {
    languages: {
      entries: mergedEntries,
      knownString: buildKnownLanguagesStringFromEntries(mergedEntries),
      max: Number(actorSystem?.linguistics?.max ?? 0),
    },
    factions: normalizeFactionEntries(social?.factions ?? []),
  };
}

export function buildSocialDisplay(actorSystem = {}) {
  const state = getSocialStateFromSystem(actorSystem);
  const knownLanguages = state.languages.entries.map((entry) => entry.name);
  const languagePreview = knownLanguages.slice(0, LANGUAGE_PREVIEW_LIMIT);
  const languageHiddenCount = Math.max(0, knownLanguages.length - languagePreview.length);
  const factionPreview = state.factions.slice(0, FACTION_PREVIEW_LIMIT);
  const factionHiddenCount = Math.max(0, state.factions.length - factionPreview.length);

  return {
    languages: {
      entries: state.languages.entries,
      known: knownLanguages,
      preview: languagePreview,
      hiddenCount: languageHiddenCount,
      knownString: state.languages.knownString,
      knownCount: knownLanguages.length + 1, // + Cyrodilic free
      selectedCount: state.languages.entries.length,
      customCount: state.languages.entries.filter((e) => e.source === "custom").length,
      max: state.languages.max,
      slotSummary: `Cyrodilic (free) - Max additional: ${state.languages.max} (IB-2, max 4)`,
    },
    factions: {
      entries: state.factions,
      preview: factionPreview,
      hiddenCount: factionHiddenCount,
      count: state.factions.length,
    },
  };
}
