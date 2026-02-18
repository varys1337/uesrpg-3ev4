/**
 * @module utils/dev/chapter6-spell-catalog
 * @description Canonical Chapter 6 spell catalog used by audit/remediation.
 */

function _entry({
  id,
  family,
  school,
  aliases = [],
  match = null,
  requiredCapabilities = [],
  defaults = {}
}) {
  return {
    id: String(id),
    family: String(family),
    school: String(school),
    aliases: Array.isArray(aliases) ? aliases.map(String) : [],
    match,
    requiredCapabilities: Array.isArray(requiredCapabilities) ? requiredCapabilities.map(String) : [],
    defaults: defaults && typeof defaults === "object" ? defaults : {}
  };
}

const CATALOG = Object.freeze([
  _entry({
    id: "alteration-armor",
    family: "Alteration",
    school: "alteration",
    aliases: ["Armor", "Magic Armor"],
    requiredCapabilities: ["core:effects", "core:duration", "core:upkeep"],
    defaults: { rangeType: "none", hasUpkeep: true, engineTargetingMode: "self" }
  }),
  _entry({
    id: "alteration-feather",
    family: "Alteration",
    school: "alteration",
    aliases: ["Feather"],
    requiredCapabilities: ["core:effects", "utility:encumbrance", "core:duration", "core:upkeep"],
    defaults: { rangeType: "none", hasUpkeep: true, engineTargetingMode: "self" }
  }),
  _entry({
    id: "alteration-levitate-slowfall-waterbreathing",
    family: "Alteration",
    school: "alteration",
    aliases: ["Levitate", "Slowfall", "Water Breathing"],
    requiredCapabilities: ["core:effects", "utility:movement", "core:duration", "core:upkeep"],
    defaults: { hasUpkeep: true, engineTargetingMode: "single" }
  }),
  _entry({
    id: "alteration-open",
    family: "Alteration",
    school: "alteration",
    aliases: ["Open"],
    requiredCapabilities: ["utility:open", "core:direct"],
    defaults: { rangeType: "ranged", hasUpkeep: false, engineTargetingMode: "single" }
  }),
  _entry({
    id: "conjuration-summon",
    family: "Conjuration",
    school: "conjuration",
    match: /^summon /i,
    requiredCapabilities: ["core:summon", "core:mindlock", "core:upkeep"],
    defaults: { hasUpkeep: true, engineTargetingMode: "single" }
  }),
  _entry({
    id: "conjuration-conjure-item",
    family: "Conjuration",
    school: "conjuration",
    match: /^conjure /i,
    requiredCapabilities: ["core:conjure", "core:upkeep"],
    defaults: { hasUpkeep: true, engineTargetingMode: "self" }
  }),
  _entry({
    id: "destruction-type-ball",
    family: "Destruction",
    school: "destruction",
    match: /\bball\b/i,
    requiredCapabilities: ["core:attack", "core:aoe", "core:damage"],
    defaults: { rangeType: "ranged", engineTargetingMode: "template" }
  }),
  _entry({
    id: "destruction-type-cone",
    family: "Destruction",
    school: "destruction",
    match: /\bcone\b/i,
    requiredCapabilities: ["core:attack", "core:aoe", "core:damage"],
    defaults: { rangeType: "aoe", engineTargetingMode: "template" }
  }),
  _entry({
    id: "destruction-type-rune",
    family: "Destruction",
    school: "destruction",
    match: /\brune\b/i,
    requiredCapabilities: ["core:attack", "core:rune", "core:aoe", "core:damage"],
    defaults: { rangeType: "aoe", isRuneSpell: true, engineTargetingMode: "template" }
  }),
  _entry({
    id: "destruction-type-storm",
    family: "Destruction",
    school: "destruction",
    match: /\bstorm\b/i,
    requiredCapabilities: ["core:attack", "core:aoe", "core:zone", "core:damage", "core:upkeep"],
    defaults: { rangeType: "aoe", isZonePersistent: true, hasUpkeep: true, engineTargetingMode: "template" }
  }),
  _entry({
    id: "destruction-chain-lightning",
    family: "Destruction",
    school: "destruction",
    aliases: ["Chain Lightning"],
    requiredCapabilities: ["core:attack", "core:multitarget", "core:damage"],
    defaults: { rangeType: "ranged", engineTargetingMode: "multi", maxTargets: 3 }
  }),
  _entry({
    id: "destruction-disintegrate",
    family: "Destruction",
    school: "destruction",
    aliases: ["Disintegrate Armor", "Disintegrate Weapon"],
    requiredCapabilities: ["core:disintegrate", "core:direct"],
    defaults: { rangeType: "ranged", engineTargetingMode: "single" }
  }),
  _entry({
    id: "destruction-weakness",
    family: "Destruction",
    school: "destruction",
    match: /^weakness to /i,
    requiredCapabilities: ["core:effects", "core:fortify-weakness-opposition", "core:upkeep"],
    defaults: { hasUpkeep: true, engineTargetingMode: "single" }
  }),
  _entry({
    id: "illusion-control",
    family: "Illusion",
    school: "illusion",
    aliases: ["Blind", "Frenzy", "Horror", "Silence"],
    requiredCapabilities: ["core:condition", "core:effects", "core:upkeep"],
    defaults: { hasUpkeep: true, engineTargetingMode: "single" }
  }),
  _entry({
    id: "illusion-invisibility",
    family: "Illusion",
    school: "illusion",
    aliases: ["Invisibility"],
    requiredCapabilities: ["core:condition", "core:effects", "core:upkeep", "core:invisibility-break"],
    defaults: { hasUpkeep: true, engineTargetingMode: "single" }
  }),
  _entry({
    id: "mysticism-absorb-char",
    family: "Mysticism",
    school: "mysticism",
    match: /^absorb /i,
    requiredCapabilities: ["core:drain", "core:effects"],
    defaults: { rangeType: "ranged", engineTargetingMode: "single" }
  }),
  _entry({
    id: "mysticism-dispel",
    family: "Mysticism",
    school: "mysticism",
    aliases: ["Dispel"],
    requiredCapabilities: ["core:dispel", "core:direct"],
    defaults: { rangeType: "ranged", engineTargetingMode: "single" }
  }),
  _entry({
    id: "mysticism-soul-trap",
    family: "Mysticism",
    school: "mysticism",
    aliases: ["Soul Trap"],
    requiredCapabilities: ["core:soultrap", "core:direct", "core:upkeep"],
    defaults: { hasUpkeep: true, rangeType: "ranged", engineTargetingMode: "single" }
  }),
  _entry({
    id: "mysticism-spell-absorption",
    family: "Mysticism",
    school: "mysticism",
    aliases: ["Spell Absorption"],
    requiredCapabilities: ["core:spell-defense", "core:effects", "core:upkeep"],
    defaults: { hasUpkeep: true, engineTargetingMode: "self" }
  }),
  _entry({
    id: "mysticism-detect",
    family: "Mysticism",
    school: "mysticism",
    match: /^detect /i,
    requiredCapabilities: ["utility:detect", "core:upkeep", "core:effects"],
    defaults: { hasUpkeep: true, engineTargetingMode: "self" }
  }),
  _entry({
    id: "mysticism-recall",
    family: "Mysticism",
    school: "mysticism",
    aliases: ["Recall"],
    requiredCapabilities: ["utility:recall", "core:upkeep"],
    defaults: { hasUpkeep: true, engineTargetingMode: "self" }
  }),
  _entry({
    id: "mysticism-telepathy",
    family: "Mysticism",
    school: "mysticism",
    aliases: ["Telepathy"],
    requiredCapabilities: ["utility:telepathy", "core:upkeep"],
    defaults: { hasUpkeep: true, engineTargetingMode: "single" }
  }),
  _entry({
    id: "restoration-cure-disease",
    family: "Restoration",
    school: "restoration",
    aliases: ["Cure Disease"],
    requiredCapabilities: ["utility:cure-disease", "core:direct"],
    defaults: { rangeType: "ranged", engineTargetingMode: "single" }
  }),
  _entry({
    id: "restoration-fortify",
    family: "Restoration",
    school: "restoration",
    match: /^fortify /i,
    requiredCapabilities: ["core:effects", "core:fortify-weakness-opposition", "core:upkeep"],
    defaults: { hasUpkeep: true, engineTargetingMode: "single" }
  }),
  _entry({
    id: "restoration-stabilize",
    family: "Restoration",
    school: "restoration",
    aliases: ["Stabilize"],
    requiredCapabilities: ["utility:stabilize", "core:direct"],
    defaults: { rangeType: "ranged", engineTargetingMode: "single" }
  }),
  _entry({
    id: "restoration-ward",
    family: "Restoration",
    school: "restoration",
    aliases: ["Ward"],
    requiredCapabilities: ["core:ward", "core:effects", "core:upkeep"],
    defaults: { hasUpkeep: true, engineTargetingMode: "self" }
  })
]);

function _norm(s) {
  return String(s ?? "").trim().toLowerCase();
}

export function getChapter6SpellCatalog() {
  return CATALOG.map((e) => ({ ...e, aliases: [...e.aliases], requiredCapabilities: [...e.requiredCapabilities], defaults: { ...e.defaults } }));
}

export function findChapter6SpellCatalogEntry(spellName) {
  const n = _norm(spellName);
  if (!n) return null;

  for (const entry of CATALOG) {
    if (entry.aliases.some((a) => _norm(a) === n)) return entry;
    if (entry.match instanceof RegExp && entry.match.test(spellName)) return entry;
  }
  return null;
}

export function listChapter6CapabilityKeys() {
  const keys = new Set();
  for (const entry of CATALOG) {
    for (const cap of entry.requiredCapabilities) keys.add(cap);
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}
