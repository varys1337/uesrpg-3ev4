import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { FLAG_NS } from "./shared.js";

function _actorItems(actor) {
  return Array.from(actor?.items ?? []);
}

function _safeFromUuidSync(uuid) {
  const wanted = String(uuid ?? "").trim();
  if (!wanted || typeof fromUuidSync !== "function") return null;
  try {
    return fromUuidSync(wanted) ?? null;
  } catch (_err) {
    return null;
  }
}

export function isSupportedAlchemySpellSource(actor, spell) {
  if (!spell || spell.type !== "spell") return false;
  if (spell.pack) return false;

  const parent = spell.parent ?? null;
  if (!parent) return true;
  if (parent.documentName !== "Actor") return false;
  return String(parent.uuid ?? "") === String(actor?.uuid ?? "");
}

export function findActorSpellByUuid(actor, spellUuid) {
  const wanted = String(spellUuid ?? "").trim();
  if (!wanted) return null;
  const actorOwned = _actorItems(actor).find((item) => item?.type === "spell" && String(item?.uuid ?? "").trim() === wanted) ?? null;
  if (actorOwned) return actorOwned;

  const resolved = _safeFromUuidSync(wanted);
  return isSupportedAlchemySpellSource(actor, resolved) ? resolved : null;
}

export function getSpellLevelOptions(spell) {
  const levels = new Set([Math.max(1, Number(spell?.system?.level ?? 1) || 1)]);
  for (const entry of Array.isArray(spell?.system?.scaling?.levels) ? spell.system.scaling.levels : []) {
    const level = Math.max(1, Number(entry?.level ?? 0) || 0);
    if (level > 0) levels.add(level);
  }
  return Array.from(levels).sort((a, b) => a - b);
}

export function getSpellAlchemyAttributes(spell) {
  const attrs = [];
  if (spell?.system?.hasUpkeep === true) attrs.push("upkeep");
  return attrs;
}

function _formatSpellLevelSummary(levelOptions = []) {
  const levels = Array.isArray(levelOptions) ? levelOptions.filter((level) => Number.isFinite(level)) : [];
  if (!levels.length) return "SL 1";
  if (levels.length === 1) return `SL ${levels[0]}`;
  return `SL ${levels[0]}-${levels[levels.length - 1]}`;
}

function _buildKnownEffectMetadata(spell) {
  const levelOptions = getSpellLevelOptions(spell);
  return {
    spellUuid: String(spell?.uuid ?? "").trim(),
    sourceType: spell?.parent?.documentName === "Actor" ? "actor" : "world",
    label: String(spell?.name ?? "Unknown Spell").trim() || "Unknown Spell",
    school: String(spell?.system?.school ?? "").trim().toLowerCase(),
    levelSummary: _formatSpellLevelSummary(levelOptions),
  };
}

function _normalizeKnownEffectEntry(entry) {
  return {
    spellUuid: String(entry?.spellUuid ?? "").trim(),
    sourceType: String(entry?.sourceType ?? "").trim().toLowerCase() === "actor" ? "actor" : "world",
    label: String(entry?.label ?? "").trim(),
    school: String(entry?.school ?? "").trim().toLowerCase(),
    levelSummary: String(entry?.levelSummary ?? "").trim(),
  };
}

export function getActorKnownEffectsRaw(actor) {
  const stored = actor?.flags?.[FLAG_NS]?.alchemy?.knownEffects;
  if (!Array.isArray(stored)) return [];
  return stored
    .map(_normalizeKnownEffectEntry)
    .filter((entry) => Boolean(entry.spellUuid));
}

export function actorKnowsSpellUuid(actor, spellUuid) {
  const wanted = String(spellUuid ?? "").trim();
  if (!wanted) return false;
  return getActorKnownEffectsRaw(actor).some((entry) => entry.spellUuid === wanted);
}

function _sortKnownEffects(entries) {
  return entries.sort((a, b) => {
    const validityDelta = a.valid === b.valid ? 0 : (a.valid ? -1 : 1);
    if (validityDelta !== 0) return validityDelta;
    const sourceDelta = a.sourceType === b.sourceType ? 0 : (a.sourceType === "actor" ? -1 : 1);
    if (sourceDelta !== 0) return sourceDelta;
    const schoolDelta = String(a.school ?? "").localeCompare(String(b.school ?? ""));
    if (schoolDelta !== 0) return schoolDelta;
    return String(a.label ?? "").localeCompare(String(b.label ?? ""));
  });
}

export function getActorKnownAlchemyEffects(actor) {
  const known = getActorKnownEffectsRaw(actor).map((entry) => {
    const spell = findActorSpellByUuid(actor, entry.spellUuid);
    const metadata = spell ? _buildKnownEffectMetadata(spell) : entry;
    return {
      ...entry,
      ...metadata,
      valid: Boolean(spell),
      sourceLabel: (spell ? metadata.sourceType : entry.sourceType) === "actor" ? "Actor Spell" : "World Spell",
      spell,
    };
  });

  return _sortKnownEffects(known);
}

export async function addActorKnownAlchemyEffect(actor, spell) {
  if (!actor) return { ok: false, reason: "Actor not found." };
  if (!isSupportedAlchemySpellSource(actor, spell)) {
    return { ok: false, reason: "Only actor-owned or world spell items can be added as known effects." };
  }

  const metadata = _buildKnownEffectMetadata(spell);
  if (!metadata.spellUuid) return { ok: false, reason: "Spell UUID could not be resolved." };

  const existing = getActorKnownEffectsRaw(actor);
  const filtered = existing.filter((entry) => entry.spellUuid !== metadata.spellUuid);
  const added = filtered.length === existing.length;
  const next = _sortKnownEffects([...filtered, { ...metadata, valid: true }].map((entry) => ({
    ..._normalizeKnownEffectEntry(entry),
    valid: Boolean(entry.valid),
  }))).map(({ valid, spell: _spell, sourceLabel: _sourceLabel, ...entry }) => entry);

  await requestUpdateDocument(actor, { [`flags.${FLAG_NS}.alchemy.knownEffects`]: next });
  return { ok: true, added };
}

export async function removeActorKnownAlchemyEffect(actor, spellUuid) {
  if (!actor) return false;
  const wanted = String(spellUuid ?? "").trim();
  if (!wanted) return false;

  const existing = getActorKnownEffectsRaw(actor);
  const next = existing.filter((entry) => entry.spellUuid !== wanted);
  if (next.length === existing.length) return false;
  await requestUpdateDocument(actor, { [`flags.${FLAG_NS}.alchemy.knownEffects`]: next });
  return true;
}
