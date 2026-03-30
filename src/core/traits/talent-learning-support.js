/**
 * @module traits/talent-learning-support
 * @description Internal settings, parsing, and normalization helpers for talent learning.
 */

import { getChapter4Catalog } from "./chapter4-catalog.js";
import { listKnownTalentSlugs, resolveTalentSlug } from "./talents-api.js";
import { SYSTEM_ID } from "../system/namespace.js";

export const TALENT_LEARNING_MODE = Object.freeze({
  OFF: "off",
  WARN: "warn",
  ENFORCE: "enforce",
});

export const TALENT_NO_GOVERNING_COST_RULE = Object.freeze({
  DISCOUNTED: "discounted",
  BASE: "base",
});

export const TALENT_LEARNING_NOTICE_MODE = Object.freeze({
  OFF: "off",
  PROBLEMS: "problems",
  VERBOSE: "verbose",
});

export const LEVEL_RULES = Object.freeze({
  novice: { xpCost: 100, characteristicRequirement: 25, label: "Novice" },
  apprentice: { xpCost: 200, characteristicRequirement: 30, label: "Apprentice" },
  journeyman: { xpCost: 300, characteristicRequirement: 35, label: "Journeyman" },
  adept: { xpCost: 400, characteristicRequirement: 40, label: "Adept" },
  expert: { xpCost: 500, characteristicRequirement: 45, label: "Expert" },
  master: { xpCost: 800, characteristicRequirement: 50, label: "Master" },
});

const LEVEL_ALIASES = Object.freeze({
  novice: "novice",
  apprentice: "apprentice",
  journeyman: "journeyman",
  adept: "adept",
  expert: "expert",
  master: "master",
  1: "novice",
  2: "apprentice",
  3: "journeyman",
  4: "adept",
  5: "expert",
  6: "master",
});

const CHARACTERISTIC_ALIASES = Object.freeze({
  str: "str",
  strength: "str",
  end: "end",
  endurance: "end",
  agi: "agi",
  agility: "agi",
  int: "int",
  intelligence: "int",
  wp: "wp",
  willpower: "wp",
  prc: "prc",
  perception: "prc",
  observe: "prc",
  prs: "prs",
  personality: "prs",
  presence: "prs",
  lck: "lck",
  luck: "lck",
});

export const CHARACTERISTIC_LABELS = Object.freeze({
  str: "Strength",
  end: "Endurance",
  agi: "Agility",
  int: "Intelligence",
  wp: "Willpower",
  prc: "Perception",
  prs: "Personality",
  lck: "Luck",
});

const KNOWN_TALENT_SLUGS = new Set(listKnownTalentSlugs());

function key(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function coerceTalentLearningNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getSettingSafe(keyName, fallback) {
  try {
    if (!game?.settings) return fallback;
    return game.settings.get(SYSTEM_ID, keyName);
  } catch (_err) {
    return fallback;
  }
}

export function normalizeTalentLearningMode(mode) {
  const m = String(mode ?? "").trim().toLowerCase();
  if (m === TALENT_LEARNING_MODE.WARN) return TALENT_LEARNING_MODE.WARN;
  if (m === TALENT_LEARNING_MODE.ENFORCE) return TALENT_LEARNING_MODE.ENFORCE;
  return TALENT_LEARNING_MODE.OFF;
}

export function normalizeTalentNoGovernRule(rule) {
  const r = String(rule ?? "").trim().toLowerCase();
  if (r === TALENT_NO_GOVERNING_COST_RULE.BASE) return TALENT_NO_GOVERNING_COST_RULE.BASE;
  return TALENT_NO_GOVERNING_COST_RULE.DISCOUNTED;
}

export function normalizeTalentLearningNoticeMode(mode) {
  const m = String(mode ?? "").trim().toLowerCase();
  if (m === TALENT_LEARNING_NOTICE_MODE.OFF) return TALENT_LEARNING_NOTICE_MODE.OFF;
  if (m === TALENT_LEARNING_NOTICE_MODE.VERBOSE) return TALENT_LEARNING_NOTICE_MODE.VERBOSE;
  return TALENT_LEARNING_NOTICE_MODE.PROBLEMS;
}

export function getTalentLearningMode() {
  return normalizeTalentLearningMode(getSettingSafe("talentLearningMode", TALENT_LEARNING_MODE.OFF));
}

export function getTalentNoGoverningCostRule() {
  return normalizeTalentNoGovernRule(
    getSettingSafe("talentNoGoverningCostRule", TALENT_NO_GOVERNING_COST_RULE.DISCOUNTED)
  );
}

export function getTalentLearningNoticeMode() {
  return normalizeTalentLearningNoticeMode(
    getSettingSafe("talentLearningNoticeMode", TALENT_LEARNING_NOTICE_MODE.PROBLEMS)
  );
}

export function normalizeTalentLevel(levelRaw) {
  const normalizedKey = key(levelRaw);
  if (normalizedKey && LEVEL_ALIASES[normalizedKey]) return LEVEL_ALIASES[normalizedKey];

  const text = String(levelRaw ?? "").toLowerCase();
  if (!text) return null;
  for (const k of ["novice", "apprentice", "journeyman", "adept", "expert", "master"]) {
    if (text.includes(k)) return k;
  }

  return null;
}

export function getTalentCatalogEntry(slug) {
  if (!slug) return null;
  const cat = getChapter4Catalog();
  const talents = Array.isArray(cat?.talents) ? cat.talents : [];
  return talents.find((t) => String(t?.slug ?? "") === slug) ?? null;
}

function splitTokens(raw) {
  return String(raw ?? "")
    .split(/[,\n;/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseGoverningCharacteristics(raw) {
  const keys = [];
  const unresolved = [];
  const tokens = splitTokens(raw)
    .flatMap((tok) => String(tok).split(/\band\b/i))
    .map((tok) => tok.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const normalizedKey = key(token);
    if (!normalizedKey) continue;
    if (normalizedKey === "none" || normalizedKey === "any" || normalizedKey === "na" || normalizedKey === "nogoverningcharacteristics") continue;
    if (normalizedKey.includes("skillsgoverningcharacteristics")) {
      unresolved.push(token);
      continue;
    }
    const mapped = CHARACTERISTIC_ALIASES[normalizedKey] ?? null;
    if (mapped) keys.push(mapped);
    else unresolved.push(token);
  }

  return {
    keys: Array.from(new Set(keys)),
    unresolved: Array.from(new Set(unresolved)),
  };
}

export function mergeTalentLearningArrays(a = [], b = []) {
  return Array.from(new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].filter(Boolean)));
}

function extractClause(raw, keyword) {
  const re = new RegExp(`${keyword}\\s+([^.;\\n]+)`, "ig");
  const out = [];
  let match;
  while ((match = re.exec(raw))) out.push(String(match[1] ?? "").trim());
  return out;
}

function extractRequirementNames(clause) {
  return String(clause ?? "")
    .replace(/\([^)]*\)/g, " ")
    .split(/\band\b|&|,/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseTalentRequirements(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { requires: [], replaces: [], unresolved: [] };

  const requires = [];
  const replaces = [];
  const unresolved = [];

  for (const clause of extractClause(text, "requires?")) {
    for (const name of extractRequirementNames(clause)) {
      const slug = resolveTalentSlug(name);
      if (slug && KNOWN_TALENT_SLUGS.has(slug)) requires.push(slug);
      else unresolved.push(name);
    }
  }

  for (const clause of extractClause(text, "replaces?")) {
    for (const name of extractRequirementNames(clause)) {
      const slug = resolveTalentSlug(name);
      if (slug && KNOWN_TALENT_SLUGS.has(slug)) replaces.push(slug);
      else unresolved.push(name);
    }
  }

  if (/requires?\s*\/\s*replaces?/i.test(text)) {
    const stripped = text.replace(/^.*requires?\s*\/\s*replaces?\s*/i, "").trim();
    for (const name of extractRequirementNames(stripped)) {
      const slug = resolveTalentSlug(name);
      if (slug && KNOWN_TALENT_SLUGS.has(slug)) {
        requires.push(slug);
        replaces.push(slug);
      } else {
        unresolved.push(name);
      }
    }
  }

  return {
    requires: Array.from(new Set(requires.filter(Boolean))),
    replaces: Array.from(new Set(replaces.filter(Boolean))),
    unresolved: Array.from(new Set(unresolved.filter(Boolean))),
  };
}

export function isTalentOwned(actor, slug, { ignoreItemId = null } = {}) {
  if (!actor || !slug) return false;
  const items = actor.items ?? [];
  for (const it of items) {
    if (!it || it.type !== "talent") continue;
    if (ignoreItemId && String(it.id ?? it._id ?? "") === String(ignoreItemId)) continue;
    if (resolveTalentSlug(it.name) === slug) return true;
  }
  return false;
}

export function discountFavoredTalentCost(cost) {
  const c = Math.max(0, coerceTalentLearningNumber(cost, 0));
  return Math.floor((c * 0.75) / 5) * 5;
}

export function getTalentLikeName(talentLike) {
  if (typeof talentLike === "string") return talentLike;
  return String(talentLike?.name ?? "Talent").trim() || "Talent";
}

export function getTalentLikeSystem(talentLike) {
  if (!talentLike || typeof talentLike !== "object") return {};
  return talentLike.system ?? {};
}

export function joinTalentLearningReasonLines(lines = []) {
  return lines.filter(Boolean).join(" ");
}
