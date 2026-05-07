import { isActorUndead } from "../traits/trait-registry.js";

export const NPC_CREATURE_TYPE_STANDARD_KEY = "";

export const NPC_CREATURE_TYPE_OPTIONS = Object.freeze({
  [NPC_CREATURE_TYPE_STANDARD_KEY]: "UESRPG.NPC.CreatureTypes.any",
  humanoid: "UESRPG.NPC.CreatureTypes.humanoid",
  beast: "UESRPG.NPC.CreatureTypes.beast",
  daedra: "UESRPG.NPC.CreatureTypes.daedra",
  construct: "UESRPG.NPC.CreatureTypes.construct",
  undead: "UESRPG.NPC.CreatureTypes.undead",
  spirit: "UESRPG.NPC.CreatureTypes.spirit",
  dragon: "UESRPG.NPC.CreatureTypes.dragon",
  shadow: "UESRPG.NPC.CreatureTypes.shadow",
});

const CANONICAL_CREATURE_TYPE_KEYS = new Set(Object.keys(NPC_CREATURE_TYPE_OPTIONS).filter(Boolean));

const EMPTY_CREATURE_TYPE_ALIASES = new Set([
  "any",
  "anyrace",
  "anycreature",
  "creature",
  "default",
  "none",
  "norace",
  "standard",
]);

const CREATURE_TYPE_ALIASES = Object.freeze({
  altmer: "humanoid",
  animal: "beast",
  ancestor: "spirit",
  ancestorspirit: "spirit",
  argonian: "humanoid",
  atronach: "daedra",
  auroran: "daedra",
  aureal: "daedra",
  banekin: "daedra",
  bear: "beast",
  beastfolk: "humanoid",
  beastrace: "humanoid",
  bestial: "beast",
  bloodlessundead: "undead",
  bonewolf: "undead",
  bosmer: "humanoid",
  breton: "humanoid",
  caverat: "beast",
  cavetroll: "beast",
  clannfear: "daedra",
  creatureofthedark: "shadow",
  crocodile: "beast",
  daedrat: "daedra",
  daedroth: "daedra",
  dog: "beast",
  dov: "dragon",
  dovah: "dragon",
  dragonborn: "humanoid",
  dreugh: "beast",
  dremora: "daedra",
  dremoracaitiff: "daedra",
  dremorachurl: "daedra",
  dremorakynmarcher: "daedra",
  dremoralord: "daedra",
  dunmer: "humanoid",
  durzog: "beast",
  dwemerconstruct: "construct",
  falmer: "humanoid",
  fleshatronach: "construct",
  flameatronach: "daedra",
  frostatronach: "daedra",
  ghost: "undead",
  giant: "beast",
  giantbat: "beast",
  giantsnake: "beast",
  giantspider: "beast",
  hellhound: "daedra",
  herosovngarde: "spirit",
  heroofsovngarde: "spirit",
  horker: "beast",
  horse: "beast",
  hulkingfleshatronach: "construct",
  hunger: "daedra",
  imperial: "humanoid",
  khajiit: "humanoid",
  landdreugh: "beast",
  lich: "undead",
  lion: "beast",
  man: "humanoid",
  mazken: "daedra",
  mer: "humanoid",
  men: "humanoid",
  mudcrab: "beast",
  nord: "humanoid",
  ogre: "beast",
  ogrim: "daedra",
  orc: "humanoid",
  orsimer: "humanoid",
  playable: "humanoid",
  playablerace: "humanoid",
  redguard: "humanoid",
  scamp: "daedra",
  shadowhorror: "shadow",
  shehai: "spirit",
  skeletal: "undead",
  skeleton: "undead",
  skeletonchampion: "undead",
  slaughterfish: "beast",
  sliverofumbraketh: "shadow",
  spiderdaedra: "daedra",
  spirit: "spirit",
  stormatronach: "daedra",
  undeath: "undead",
  unded: "undead",
  undeads: "undead",
  vampire: "undead",
  wildcreature: "beast",
  wildlife: "beast",
  wingedtwilight: "daedra",
  wolf: "beast",
  wraith: "undead",
  xivilai: "daedra",
  zombie: "undead",
});

function normalizeSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCompact(value) {
  return normalizeSlug(value).replace(/-/g, "");
}

export function normalizeCreatureTypeKey(raw) {
  const slug = normalizeSlug(raw);
  if (!slug) return "";

  const compact = normalizeCompact(slug);
  if (!compact || EMPTY_CREATURE_TYPE_ALIASES.has(compact)) return "";

  return CREATURE_TYPE_ALIASES[compact] ?? slug;
}

function normalizeKnownCreatureTypeKey(raw) {
  const slug = normalizeSlug(raw);
  if (!slug) return "";
  const compact = normalizeCompact(slug);
  if (!compact || EMPTY_CREATURE_TYPE_ALIASES.has(compact)) return "";
  const alias = CREATURE_TYPE_ALIASES[compact];
  if (alias) return alias;
  return CANONICAL_CREATURE_TYPE_KEYS.has(slug) ? slug : "";
}

export function isCanonicalCreatureTypeKey(raw) {
  return CANONICAL_CREATURE_TYPE_KEYS.has(normalizeCreatureTypeKey(raw));
}

export function getNpcCreatureTypeSelectKey(raw) {
  const normalized = normalizeCreatureTypeKey(raw);
  return CANONICAL_CREATURE_TYPE_KEYS.has(normalized) ? normalized : NPC_CREATURE_TYPE_STANDARD_KEY;
}

export function getPrimaryCreatureTypeKey(actorOrSystem) {
  if (actorOrSystem?.system && typeof actorOrSystem === "object") {
    if (String(actorOrSystem.type ?? "").trim().toLowerCase() !== "npc") return "";
  }

  const systemData = actorOrSystem?.system && typeof actorOrSystem === "object"
    ? actorOrSystem.system
    : actorOrSystem;
  return normalizeCreatureTypeKey(systemData?.race);
}

export function getCreatureTypeLabel(key) {
  const normalized = normalizeCreatureTypeKey(key);
  if (!normalized) return "";
  return normalized
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function collectTextCreatureTypeKeys(value, keys) {
  const normalized = normalizeKnownCreatureTypeKey(value);
  if (normalized) keys.add(normalized);
}

function collectActorProfileCreatureTypeKeys(actorOrSystem, keys) {
  if (!actorOrSystem || typeof actorOrSystem !== "object") return;

  collectTextCreatureTypeKeys(actorOrSystem.name, keys);

  const system = actorOrSystem.system && typeof actorOrSystem.system === "object" ? actorOrSystem.system : {};
  collectTextCreatureTypeKeys(system.race, keys);
  collectTextCreatureTypeKeys(system.traitKey, keys);
  collectTextCreatureTypeKeys(system.traitParam, keys);

  const items = actorOrSystem.items?.contents ?? actorOrSystem.items ?? [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (!["trait", "power", "talent"].includes(String(item.type ?? "").trim())) continue;
    collectTextCreatureTypeKeys(item.name, keys);
    collectTextCreatureTypeKeys(item.system?.traitKey, keys);
    collectTextCreatureTypeKeys(item.system?.traitParam, keys);
  }
}

export function getActorCreatureTypeKeys(actorOrSystem) {
  const keys = new Set();
  const primary = getPrimaryCreatureTypeKey(actorOrSystem);
  if (primary) keys.add(primary);

  if (
    actorOrSystem?.system
    && typeof actorOrSystem === "object"
    && String(actorOrSystem.type ?? "").trim().toLowerCase() === "npc"
  ) {
    collectActorProfileCreatureTypeKeys(actorOrSystem, keys);

    try {
      if (isActorUndead(actorOrSystem)) keys.add("undead");
    } catch (_e) {
      // Trait-derived creature type fallback is best-effort only.
    }
  }

  return Array.from(keys);
}

function actorLike(value) {
  if (!value || typeof value !== "object") return null;
  if (value.documentName === "Actor") return value;
  if (value.system && typeof value.system === "object" && value.type) return value;
  if (value.actor?.documentName === "Actor") return value.actor;
  if (value.object?.actor?.documentName === "Actor") return value.object.actor;
  return null;
}

function actorUuid(actor) {
  return String(actor?.uuid ?? actor?.id ?? "").trim();
}

function isCreatureTypeSuffixSegment(segment) {
  const text = String(segment ?? "").trim();
  if (!text || text !== text.toLowerCase()) return false;
  return Boolean(normalizeCreatureTypeKey(text));
}

export function getOpposingCreatureTypeKeys(context = {}, selfActor = null) {
  if (!context || typeof context !== "object") return [];

  const selfUuid = actorUuid(actorLike(selfActor));
  const explicit = actorLike(context.opposingActor);
  if (explicit) {
    if (selfUuid && actorUuid(explicit) === selfUuid) return [];
    return getActorCreatureTypeKeys(explicit);
  }

  const candidates = [
    context.opponentActor,
    context.opponent,
    context.defenderActor,
    context.defender,
    context.targetActor,
    context.target,
    context.casterActor,
    context.caster,
    context.attackerActor,
    context.attacker,
  ];

  const keys = new Set();
  for (const candidate of candidates) {
    const actor = actorLike(candidate);
    if (!actor) continue;
    if (selfUuid && actorUuid(actor) === selfUuid) continue;
    for (const key of getActorCreatureTypeKeys(actor)) keys.add(key);
  }

  return Array.from(keys);
}

export function isCreatureTypeConditionalKey(key) {
  const text = String(key ?? "").trim();
  if (!text) return false;
  const idx = text.lastIndexOf(".");
  if (idx <= 0 || idx >= text.length - 1) return false;
  return isCreatureTypeSuffixSegment(text.slice(idx + 1));
}

export function stripCreatureTypeSuffix(key) {
  const text = String(key ?? "").trim();
  if (!text) return "";
  const idx = text.lastIndexOf(".");
  if (idx <= 0 || idx >= text.length - 1) return text;
  return isCreatureTypeSuffixSegment(text.slice(idx + 1)) ? text.slice(0, idx) : text;
}

export function expandCreatureTypeConditionalKeys(keys, context = {}, selfActor = null) {
  const baseKeys = Array.isArray(keys) ? keys.map((key) => String(key ?? "").trim()).filter(Boolean) : [];
  const opposingTypes = getOpposingCreatureTypeKeys(context, selfActor);
  const expandedKeys = new Set(baseKeys);
  const baseKeyByExpandedKey = new Map(baseKeys.map((key) => [key, key]));

  if (!opposingTypes.length) {
    return { keys: Array.from(expandedKeys), baseKeyByExpandedKey };
  }

  for (const baseKey of baseKeys) {
    for (const creatureType of opposingTypes) {
      const conditionalKey = `${baseKey}.${creatureType}`;
      expandedKeys.add(conditionalKey);
      baseKeyByExpandedKey.set(conditionalKey, baseKey);
    }
  }

  return { keys: Array.from(expandedKeys), baseKeyByExpandedKey };
}
