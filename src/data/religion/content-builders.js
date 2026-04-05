import { SYSTEM_ID } from "../../core/system/namespace.js";
import {
  RELIGION_INVOCATION_DOMAIN_UNIVERSAL,
} from "../../core/religion/constants.js";
import { getDomainFavoredMagicSchool } from "../../core/religion/domain-registry.js";

const INVOCATION_ICON = "icons/svg/book.svg";
const DOMAIN_SPELL_ICON = "icons/magic/symbols/rune-sigil-white-pink.webp";

function normalizePunctuation(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, "\"")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...");
}

function cloneData(value) {
  try {
    return structuredClone(value);
  } catch (_err) {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

function asKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeWhitespace(value) {
  return normalizePunctuation(value)
    .replace(/\r/g, "")
    .replace(/\u000b/g, "\n")
    .replace(/\u000c/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInlineText(value) {
  return normalizeWhitespace(value).replace(/\n+/g, " ").trim();
}

function slugify(value) {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "entry";
}

function stableHashBase36(value) {
  let h1 = 0xdeadbeef ^ String(value ?? "").length;
  let h2 = 0x41c6ce57 ^ String(value ?? "").length;
  for (const char of String(value ?? "")) {
    const code = char.charCodeAt(0);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

export function makeStableReligionDocumentId(kind, sourceKey) {
  return stableHashBase36(`${kind}:${sourceKey}`).slice(0, 16);
}

export function normalizeReligionLookupKey(value) {
  return slugify(normalizeInlineText(value));
}

function buildCompendiumKey(documentType, id) {
  return `!${documentType}!${id}`;
}

function ensureUniqueStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeInlineText(value))
    .filter(Boolean)));
}

function splitOutcomeText(value) {
  const text = normalizeWhitespace(value);
  const matches = [...text.matchAll(/\b(DoS 4\+|DoS 1[-]3|DoF 1[-]3|DoF 4\+):/g)];
  if (!matches.length) return { effect: text, outcomes: {} };

  const effect = text.slice(0, matches[0].index).trim();
  const outcomes = {};
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const start = current.index + current[0].length;
    const end = next ? next.index : text.length;
    const label = current[1].toLowerCase().replace(/\s+/g, "");
    outcomes[label] = text.slice(start, end).trim();
  }
  return { effect, outcomes };
}

function formatInvocationEffectText(record) {
  const text = record?.text ?? {};
  const lines = [];
  if (text.effect) lines.push(text.effect.trim());
  if (text.outcomes?.["dos4+"]) lines.push(`DoS 4+: ${text.outcomes["dos4+"]}`);
  if (text.outcomes?.["dos1-3"]) lines.push(`DoS 1-3: ${text.outcomes["dos1-3"]}`);
  if (text.outcomes?.["dof1-3"]) lines.push(`DoF 1-3: ${text.outcomes["dof1-3"]}`);
  if (text.outcomes?.["dof4+"]) lines.push(`DoF 4+: ${text.outcomes["dof4+"]}`);
  return lines.join("\n\n").trim();
}

function pushDescriptor(list, descriptor) {
  const key = slugify(descriptor);
  if (key && !list.includes(key)) list.push(key);
}

export function buildInvocationAutomation(record) {
  const descriptors = [];
  const text = [
    record?.name,
    record?.ritual,
    record?.range,
    record?.duration,
    record?.text?.effect,
    record?.text?.raw,
    ...(record?.aspects ?? []),
  ].join(" ").toLowerCase();

  for (const aspect of record?.aspects ?? []) pushDescriptor(descriptors, `aspect-${aspect}`);
  if (text.includes("consecrat")) {
    pushDescriptor(descriptors, "consecration");
    pushDescriptor(descriptors, "region");
  }
  if (text.includes("piety")) pushDescriptor(descriptors, "piety");
  if (text.includes("divination") || text.includes("question")) pushDescriptor(descriptors, "divination");
  if (text.includes("transfer")) pushDescriptor(descriptors, "transfer");
  if (text.includes("healing") || /\bregains?\b/.test(text)) pushDescriptor(descriptors, "healing");
  if (text.includes("silence") || text.includes("silenced")) pushDescriptor(descriptors, "silence");
  if (text.includes("fear") || text.includes("panic")) pushDescriptor(descriptors, "fear");
  if (text.includes("summon") || text.includes("manifest")) pushDescriptor(descriptors, "summon");

  const nameKey = slugify(record?.name);
  const isConsecration = nameKey === "consecration" || descriptors.includes("consecration");

  return {
    mode: isConsecration ? "regionConsecration" : "manual",
    key: isConsecration ? "consecration" : nameKey,
    descriptors,
    allowManualFallback: true,
  };
}

export function enrichInvocationRecord(record) {
  const raw = cloneData(record) ?? {};
  const parsedText = splitOutcomeText(raw?.text?.raw ?? raw?.text?.effect ?? "");
  return {
    ...raw,
    sourceKey: String(raw.sourceKey ?? "").trim(),
    sourcePath: String(raw.sourcePath ?? "").trim(),
    domainKey: asKey(raw.domainKey) || RELIGION_INVOCATION_DOMAIN_UNIVERSAL,
    isUniversal: asKey(raw.domainKey) === RELIGION_INVOCATION_DOMAIN_UNIVERSAL,
    pietyCost: Math.max(1, Number(raw.pietyCost ?? raw.circle ?? 1) || 1),
    circle: Math.max(1, Math.min(4, Number(raw.circle ?? 1) || 1)),
    aspects: ensureUniqueStrings(raw.aspects),
    requirements: normalizeWhitespace(raw.requirements),
    text: {
      raw: normalizeWhitespace(raw?.text?.raw ?? ""),
      effect: normalizeWhitespace(raw?.text?.effect ?? parsedText.effect),
      outcomes: {
        "dos4+": normalizeWhitespace(raw?.text?.outcomes?.["dos4+"] ?? parsedText.outcomes?.["dos4+"]),
        "dos1-3": normalizeWhitespace(raw?.text?.outcomes?.["dos1-3"] ?? parsedText.outcomes?.["dos1-3"]),
        "dof1-3": normalizeWhitespace(raw?.text?.outcomes?.["dof1-3"] ?? parsedText.outcomes?.["dof1-3"]),
        "dof4+": normalizeWhitespace(raw?.text?.outcomes?.["dof4+"] ?? parsedText.outcomes?.["dof4+"]),
      },
    },
    importVersion: 1,
    automation: buildInvocationAutomation(raw),
  };
}

function parseDurationConfig(text) {
  const raw = normalizeInlineText(text).toLowerCase();
  if (!raw) return { value: 0, unit: "instant" };
  if (raw.includes("instant")) return { value: 0, unit: "instant" };
  if (raw.includes("permanent")) return { value: 1, unit: "permanent" };

  const timed = raw.match(/(\d+)\s*(round|minute|hour|day)s?/i);
  if (timed) {
    const value = Math.max(0, Number(timed[1]) || 0);
    const unitMap = { round: "rounds", minute: "minutes", hour: "hours", day: "days" };
    return { value, unit: unitMap[timed[2].toLowerCase()] ?? "rounds" };
  }

  if (raw.includes("until dismissed") || raw.includes("indefinite") || raw.includes("ceremony")) {
    return { value: 1, unit: "permanent" };
  }

  return { value: 0, unit: "instant" };
}

function extractAoEConfig(attributes = "") {
  const raw = normalizeInlineText(attributes).toLowerCase();
  const match = raw.match(/(\d+(?:\.\d+)?)\s*m\s*(pulse|radius|sphere|cone|ray|line|width)/i);
  if (!match) return null;

  const size = Number(match[1]) || 0;
  const kind = match[2].toLowerCase();
  if (!size) return null;

  if (kind === "ray" || kind === "line") {
    return { rangeType: "aoe", aoeShape: "ray", aoeSize: size, aoeWidth: 1, aoePulse: false, aoeIncludeCaster: false };
  }
  if (kind === "cone") {
    return { rangeType: "aoe", aoeShape: "cone", aoeSize: size, aoeWidth: 0, aoePulse: false, aoeIncludeCaster: false };
  }
  return {
    rangeType: "aoe",
    aoeShape: "circle",
    aoeSize: size,
    aoeWidth: 0,
    aoePulse: kind === "pulse",
    aoeIncludeCaster: kind === "pulse",
  };
}

function inferDamageFormula(text) {
  const raw = normalizeWhitespace(text);
  const formula = raw.match(/\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\b/i);
  if (formula) return formula[1].replace(/\s+/g, "");

  const healing = raw.match(/\bregains?\s+(\d+)\s*hp\b/i);
  if (healing) return healing[1];

  return "";
}

function inferDamageType(record) {
  const text = `${record?.attributes ?? ""} ${record?.effect ?? ""}`.toLowerCase();
  if (/\bregains?\b.*\bhp\b/.test(text) || /heals?\s+\d+\s*hp/.test(text)) return "healing";
  if (text.includes("fire damage")) return "fire";
  if (text.includes("frost damage")) return "frost";
  if (text.includes("shock damage")) return "shock";
  if (text.includes("poison damage")) return "poison";
  if (text.includes("magic damage") || text.includes("sunlight damage")) return "magic";
  return "none";
}

function inferRangeType(record, aoeConfig) {
  if (aoeConfig?.rangeType === "aoe") return "aoe";
  const raw = normalizeInlineText(record?.range).toLowerCase();
  if (!raw || raw === "self") return "none";
  if (raw.includes("touch") || raw === "1m" || raw === "1 m") return "melee";
  if (/\b\d+(?:\.\d+)?\s*m\b/.test(raw)) return "ranged";
  return "none";
}

function inferMindlockValue(attributes = "") {
  const match = normalizeInlineText(attributes).match(/mindlock\s*\((\d+)\)/i);
  return match ? Math.max(0, Number(match[1]) || 0) : 0;
}

function inferDirect(record) {
  const attributes = normalizeInlineText(record?.attributes).toLowerCase();
  if (attributes.includes("direct")) return true;
  return false;
}

function inferAttack(record) {
  const text = `${record?.attributes ?? ""} ${record?.effect ?? ""}`.toLowerCase();
  return text.includes("attack") || /\bdeals?\s+\d+d\d+/i.test(text);
}

function inferHealing(record) {
  const text = `${record?.effect ?? ""}`.toLowerCase();
  return /\bregains?\b.*\bhp\b/.test(text) || /\bhealed?\b/.test(text);
}

function inferHasUpkeep(record) {
  const attributes = normalizeInlineText(record?.attributes).toLowerCase();
  const duration = normalizeInlineText(record?.duration).toLowerCase();
  return attributes.includes("upkeep") || duration.startsWith("upkeep");
}

function buildEmptySpellSeed() {
  return {
    name: "",
    type: "spell",
    img: DOMAIN_SPELL_ICON,
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    effects: [],
    flags: {},
    system: {
      description: "",
      damage: "",
      damageFormula: "",
      damageType: "none",
      healAmount: "",
      level: 1,
      cost: 0,
      school: "",
      spellType: "conventional",
      isAttackSpell: false,
      isDamagingSpell: false,
      isHealingSpell: false,
      isInstant: true,
      hasUpkeep: false,
      rangeType: "none",
      range: "",
      aoeShape: "circle",
      aoeSize: 0,
      aoeWidth: 0,
      aoePulse: false,
      aoeIncludeCaster: false,
      isDirect: false,
      mindlockValue: 0,
      duration: { value: 0, unit: "instant" },
      scaling: { levels: [] },
      engine: {
        targeting: { mode: "single", maxTargets: 1 },
        effects: { recipes: [], stackingPolicy: "replace", ownershipPolicy: "target" },
        persistence: { dispelStrength: "level", dispelFixedValue: 0 },
        summon: { actorUuid: "", quantity: 1 },
        conjure: {
          mode: "none",
          itemUuid: "",
          itemLabel: "",
          actorUuid: "",
          actorLabel: "",
          bindingCharacteristic: "wp",
          bindingModifier: 0,
          summonItems: null,
          summonActors: null,
        },
        disintegrate: { enabled: false, target: "armor" },
        drain: { enabled: false, type: "none", transferToCaster: false },
        defenseModel: "opposed",
        characteristicDefense: {
          defenderCharacteristic: "end",
          modifierMode: "spellStrength",
          modifierFormula: "",
          onSuccess: "negate",
          onFailure: "consequences",
        },
        consequences: {
          staminaDelta: 0,
          healthDelta: 0,
          magickaDelta: 0,
          applyCondition: "",
          description: "",
        },
        cloak: { enabled: false, range: 1, excludeSelf: true, requireAttackTest: false, useSpellDamage: true },
      },
    },
  };
}

function cleanDocumentForPack(data) {
  const cleaned = cloneData(data) ?? {};
  delete cleaned._stats;
  delete cleaned._key;
  return cleaned;
}

export function enrichDomainSpellRecord(record) {
  const raw = cloneData(record) ?? {};
  return {
    ...raw,
    sourceKey: String(raw.sourceKey ?? "").trim(),
    sourcePath: String(raw.sourcePath ?? "").trim(),
    seedSpellName: String(raw.seedSpellName ?? raw.name ?? "").trim(),
    domainKey: asKey(raw.domainKey),
    domainCastSchool: asKey(raw.domainCastSchool) || getDomainFavoredMagicSchool(raw.domainKey),
    level: Math.max(1, Math.min(7, Number(raw.level ?? 1) || 1)),
    cost: Math.max(0, Number(raw.cost ?? 0) || 0),
    castingTime: normalizeInlineText(raw.castingTime),
    range: normalizeInlineText(raw.range),
    duration: normalizeInlineText(raw.duration),
    attributes: normalizeInlineText(raw.attributes),
    effect: normalizeWhitespace(raw.effect),
    importVersion: 1,
  };
}

export function buildInvocationItemData(record) {
  const enriched = enrichInvocationRecord(record);
  return {
    name: enriched.name,
    type: "invocation",
    img: INVOCATION_ICON,
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    effects: [],
    flags: {
      [SYSTEM_ID]: {
        religion: {
          sourceKey: enriched.sourceKey,
          domainKey: enriched.domainKey,
        },
      },
    },
    system: {
      description: enriched.text.effect,
      domainKey: enriched.domainKey,
      circle: enriched.circle,
      pietyCost: enriched.pietyCost,
      isUniversal: enriched.isUniversal,
      time: normalizeInlineText(enriched.time),
      ritual: normalizeInlineText(enriched.ritual),
      range: normalizeInlineText(enriched.range),
      duration: normalizeInlineText(enriched.duration),
      aspects: ensureUniqueStrings(enriched.aspects),
      requirements: enriched.requirements,
      effect: formatInvocationEffectText(enriched),
      automation: cloneData(enriched.automation),
      source: {
        sourceKey: enriched.sourceKey,
        sourcePath: enriched.sourcePath,
        importVersion: enriched.importVersion ?? 1,
      },
    },
  };
}

export function buildDomainSpellItemData(record, { baseSpellData = null } = {}) {
  const enriched = enrichDomainSpellRecord(record);
  const seeded = baseSpellData ? cleanDocumentForPack(baseSpellData) : null;
  const doc = seeded ?? buildEmptySpellSeed();
  const aoeConfig = extractAoEConfig(enriched.attributes);
  const rangeType = inferRangeType(enriched, aoeConfig);
  const duration = parseDurationConfig(enriched.duration);
  const damageFormula = inferDamageFormula(enriched.effect);
  const damageType = inferDamageType(enriched);
  const isHealingSpell = inferHealing(enriched) || damageType === "healing";
  const isAttackSpell = inferAttack(enriched);
  const isDamagingSpell = Boolean(damageFormula) && damageType !== "healing";

  doc.name = enriched.name;
  doc.type = "spell";
  doc.img = String(doc.img || DOMAIN_SPELL_ICON);
  doc.folder = null;
  doc.sort = 0;
  doc.ownership = doc.ownership ?? { default: 0 };
  doc.effects = Array.isArray(doc.effects) ? doc.effects : [];
  doc.flags = doc.flags ?? {};
  doc.flags[SYSTEM_ID] = doc.flags[SYSTEM_ID] ?? {};
  doc.flags[SYSTEM_ID].religion = {
    ...(doc.flags[SYSTEM_ID].religion ?? {}),
    domainSpell: true,
    domainKey: enriched.domainKey,
    domainCastSchool: enriched.domainCastSchool,
    sourceKey: enriched.sourceKey,
  };

  doc.system = doc.system ?? {};
  doc.system.description = enriched.effect;
  doc.system.level = enriched.level;
  doc.system.cost = enriched.cost;
  doc.system.school = enriched.domainCastSchool;
  doc.system.spellType = "unconventional";
  doc.system.range = enriched.range;
  doc.system.rangeType = rangeType;
  doc.system.isAttackSpell = isAttackSpell;
  doc.system.isDamagingSpell = isDamagingSpell;
  doc.system.isHealingSpell = isHealingSpell;
  doc.system.hasUpkeep = inferHasUpkeep(enriched);
  doc.system.isInstant = duration.unit === "instant";
  doc.system.isDirect = inferDirect(enriched) || isHealingSpell;
  doc.system.damage = damageFormula;
  doc.system.damageFormula = damageFormula;
  doc.system.damageType = damageType;
  doc.system.healAmount = isHealingSpell ? damageFormula : "";
  doc.system.attributes = enriched.attributes;
  doc.system.duration = duration;
  doc.system.mindlockValue = inferMindlockValue(enriched.attributes);
  if (aoeConfig) {
    doc.system.aoeShape = aoeConfig.aoeShape;
    doc.system.aoeSize = aoeConfig.aoeSize;
    doc.system.aoeWidth = aoeConfig.aoeWidth;
    doc.system.aoePulse = aoeConfig.aoePulse;
    doc.system.aoeIncludeCaster = aoeConfig.aoeIncludeCaster;
  }
  return doc;
}

export function buildInvocationCompendiumSource(record) {
  const sourceKey = String(record?.sourceKey ?? "").trim();
  const id = makeStableReligionDocumentId("invocation", sourceKey);
  return {
    ...buildInvocationItemData(record),
    _id: id,
    _key: buildCompendiumKey("items", id),
  };
}

export function buildDomainSpellCompendiumSource(record, options = {}) {
  const sourceKey = String(record?.sourceKey ?? "").trim();
  const id = makeStableReligionDocumentId("domain-spell", sourceKey);
  return {
    ...buildDomainSpellItemData(record, options),
    _id: id,
    _key: buildCompendiumKey("items", id),
  };
}
