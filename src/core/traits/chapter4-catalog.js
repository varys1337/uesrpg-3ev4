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
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "Recognized Core activation is held for manual resolution before costs; token, attack-card and free-defense writes were not recoverable as one operation.",
  },
  scholar: {
    level: "apprentice",
    governingCharacteristics: ["int"],
    automationClass: CHAPTER4_AUTOMATION_CLASS.FULL,
    notes: "Applied in skill advancement pipeline: Lore specialization cap x2 and base specialization XP cost 50.",
  },
  hardtarget: {
    level: "journeyman",
    governingCharacteristics: ["agi"],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "The user confirms the Dash and movement requirement; movement distance is not verified automatically.",
  },
  thundercharge: {
    level: "journeyman",
    governingCharacteristics: ["str", "agi"],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "Recognized activation and the attack surcharge toggle are held for manual resolution before costs; source movement requirements need adjudication.",
  },
  inspireheroism: {
    level: "apprentice",
    governingCharacteristics: ["prs"],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
  },
  bloodofaldmeris: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "The standard Power Well and disease-resistance upgrades are calculated; modified or ambiguous traits require review.",
  },
  highborn: {
    level: "expert",
    governingCharacteristics: [],
    requirements: { requires: ["bloodofaldmeris"], replaces: [], notes: "" },
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "Recognized Core activation is held for manual action, use and Magicka recovery before any cost or use is charged.",
  },
  childofthesap: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "Disease immunity and Speed have derived workflows; duplicates and explicit bonuses require review.",
  },
  histskin: {
    level: "expert",
    governingCharacteristics: [],
    requirements: { requires: ["childofthesap"], replaces: [], notes: "" },
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "Swimming and selected underwater rolls have passive paths; recognized healing activation is held for manual use and recovery.",
  },
  naturesblessing: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "Standard racial resistance upgrades have derived workflows; edited and duplicate traits require review.",
  },
  lionheart: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "The standard Power Well and magic-resistance upgrades are calculated; modified or ambiguous traits require review.",
  },
  dragonskin: {
    level: "expert",
    governingCharacteristics: [],
    requirements: { requires: ["lionheart"], replaces: [], notes: "" },
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "Recognized activation is held before Stamina payment; absorption coverage, expiry and Reflect ordering require manual review.",
  },
  reddiamond: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "The standard Star of the West upgrade has a derived path; duplicate and edited traits require review.",
  },
  imperialluck: {
    level: "expert",
    governingCharacteristics: [],
    requirements: { requires: ["reddiamond"], replaces: [], notes: "" },
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "The Stamina upgrade and selected skill-test LP flow are implemented; burning Luck and other test flows require manual handling.",
  },
  eyeofnight: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
  },
  sonsofskyrim: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "Standard Frost Resistance and Tough upgrades have derived workflows; edited traits and optional wounds require review.",
  },
  wrothgarian: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "Standard Tough and Resilient racial upgrades are calculated; modified or ambiguous traits require review.",
  },
  malacathsfury: {
    level: "expert",
    governingCharacteristics: [],
    requirements: { requires: ["wrothgarian"], replaces: [], notes: "" },
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "The passive HP upgrade has a derived path; recognized healing and timed activation is held for manual resolution before use.",
  },
  highmen: {
    level: "adept",
    governingCharacteristics: [],
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "Disease immunity and the standard poison-resistance upgrade have derived workflows; other test and edited-trait paths need review.",
  },
  adrenalineburst: {
    level: "expert",
    governingCharacteristics: [],
    requirements: { requires: ["highmen"], replaces: [], notes: "" },
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "Recognized Adrenaline Rush activation is held before use when this talent is active; its modified outcome and expiry require manual resolution.",
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
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "The bound-weapon damage path recognizes the talent; provenance, quality and choice interactions require live verification.",
  },
  weaponecho: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.BLOCKED,
    notes: "Requires conjure weapon talent integration runtime.",
  },
  spellsword: {
    automationClass: CHAPTER4_AUTOMATION_CLASS.PARTIAL,
    notes: "The casting TN path recognizes one free hand; equipment and casting paths require live verification.",
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
