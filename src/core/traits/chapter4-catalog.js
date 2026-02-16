/**
 * @module traits/chapter4-catalog
 * @description Canonical Chapter 4 reference catalog used for audit and
 * compliance tooling.
 *
 * This is intentionally code-first and conservative: unknown metadata remains
 * explicit `null`/empty rather than guessed.
 */

import { listKnownTalentSlugs, resolveTalentSlug } from "./talents-api.js";

export const CHAPTER4_AUTOMATION_CLASS = Object.freeze({
  FULL: "full",
  PARTIAL: "partial",
  INFORMATIONAL: "informational",
  BLOCKED: "blocked",
  STUB: "stub",
  NOT_AUTOMATED: "not_automated",
  UNKNOWN: "unknown",
});

function _talentDefaults(slug) {
  return {
    type: "talent",
    slug,
    level: null,
    governingCharacteristics: [],
    requirements: {
      requires: [],
      replaces: [],
      notes: "",
    },
    automationClass: CHAPTER4_AUTOMATION_CLASS.UNKNOWN,
    notes: "",
  };
}

/**
 * Hand-authored metadata for entries where Chapter 4 values are known and
 * currently relevant to active automation.
 */
const TALENT_OVERRIDES = Object.freeze({
  defender: {
    level: "journeyman",
    governingCharacteristics: ["end", "wp", "prc"],
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  scholar: {
    level: "apprentice",
    governingCharacteristics: ["int"],
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
    notes: "Applied in skill advancement pipeline: Lore specialization cap x2 and base specialization XP cost 50.",
  },
  hardtarget: {
    level: "adept",
    governingCharacteristics: ["agi"],
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  thundercharge: {
    level: "journeyman",
    governingCharacteristics: ["str", "agi"],
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  inspireheroism: {
    level: "journeyman",
    governingCharacteristics: ["prs"],
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  childofthesap: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  histskin: {
    level: "expert",
    governingCharacteristics: [],
    requirements: { requires: ["childofthesap"], replaces: [], notes: "" },
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  naturesblessing: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  dragonskin: {
    level: "expert",
    governingCharacteristics: [],
    requirements: { requires: ["lionheart"], replaces: [], notes: "" },
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  reddiamond: {
    level: "expert",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  imperialluck: {
    level: "master",
    governingCharacteristics: [],
    requirements: { requires: ["reddiamond"], replaces: [], notes: "" },
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  eyeofnight: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
  },
  sonsofskyrim: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  malacathsfury: {
    level: "expert",
    governingCharacteristics: [],
    requirements: { requires: ["wrothgarian"], replaces: [], notes: "" },
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  adrenalineburst: {
    level: "expert",
    governingCharacteristics: [],
    requirements: { requires: ["highmen"], replaces: [], notes: "" },
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  overcharge: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  magickacycling: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  control: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
  },
  bendreality: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
  },
  healer: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
  },
  flowofmagicka: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
  },
  bladecaller: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.BLOCKED,
    notes: "Requires conjure weapon talent integration runtime.",
  },
  weaponecho: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.BLOCKED,
    notes: "Requires conjure weapon talent integration runtime.",
  },
  spellsword: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.BLOCKED,
    notes: "Requires casting/equipment interaction integration.",
  },
  unfetteredconjuration: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.BLOCKED,
    notes: "Requires summon AP/mindlock integration.",
  },
  taskmaster: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.BLOCKED,
    notes: "Requires summon AP/mindlock integration.",
  },
  masterofthehordes: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.BLOCKED,
    notes: "Requires summon AP/mindlock integration.",
  },
  voidchanneler: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.BLOCKED,
    notes: "Requires summoned creature management integration.",
  },
  themendingtidesoblivion: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.BLOCKED,
    notes: "Requires summoned creature management integration.",
  },
});

function _mergeRequirements(baseReq, overrideReq) {
  if (!overrideReq) return baseReq;
  return {
    requires: Array.isArray(overrideReq.requires) ? overrideReq.requires : baseReq.requires,
    replaces: Array.isArray(overrideReq.replaces) ? overrideReq.replaces : baseReq.replaces,
    notes: typeof overrideReq.notes === "string" ? overrideReq.notes : baseReq.notes,
  };
}

function _buildTalentCatalog() {
  const slugs = listKnownTalentSlugs().slice().sort((a, b) => a.localeCompare(b));
  return slugs.map((slug) => {
    const base = _talentDefaults(slug);
    const override = TALENT_OVERRIDES[slug] ?? {};
    return {
      ...base,
      ...override,
      requirements: _mergeRequirements(base.requirements, override.requirements),
    };
  });
}

/**
 * Canonical Chapter 4 catalog.
 *
 * `traits` and `powers` are populated incrementally in code-first mode.
 */
export const CHAPTER4_CATALOG = Object.freeze({
  version: "2026-02-16",
  source: "docs/Core/Chapter 4 - Talents and Traits.md",
  talents: _buildTalentCatalog(),
  traits: [],
  powers: [],
});

export function getChapter4Catalog() {
  return CHAPTER4_CATALOG;
}

export function getChapter4TalentEntry(slugOrName) {
  const slug = resolveTalentSlug(slugOrName);
  if (!slug) return null;
  const talentSlug = listKnownTalentSlugs().includes(slug) ? slug : "";
  if (!talentSlug) return null;
  return CHAPTER4_CATALOG.talents.find((t) => t.slug === talentSlug) ?? null;
}
