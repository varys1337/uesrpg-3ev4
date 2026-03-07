/**
 * @module traits/talent-learning
 * @description Deterministic Chapter 4 talent-learning evaluator and helpers.
 *
 * Scope:
 * - Validation only (no schema migration)
 * - XP calculation from RAW level table + favored discount rules
 * - Governing characteristic and prerequisite checks
 * - Multiplayer-safe XP spend helper via authority proxy
 *
 * Target: Foundry VTT v13.351
 */

import { requestUpdateDocument } from "../../utils/authority-proxy.js";
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

const LEVEL_RULES = Object.freeze({
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

const CHARACTERISTIC_LABELS = Object.freeze({
  str: "Strength",
  end: "Endurance",
  agi: "Agility",
  int: "Intelligence",
  wp: "Willpower",
  prc: "Perception",
  prs: "Personality",
  lck: "Luck",
});

const _xpSpendLocks = new Set();
const _noticeDedupMap = new Map();
const _KNOWN_TALENT_SLUGS = new Set(listKnownTalentSlugs());

function _key(v) {
  return String(v ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function _toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _getSettingSafe(key, fallback) {
  try {
    if (!game?.settings) return fallback;
    return game.settings.get(SYSTEM_ID, key);
  } catch (_err) {
    return fallback;
  }
}

function _normalizeMode(mode) {
  const m = String(mode ?? "").trim().toLowerCase();
  if (m === TALENT_LEARNING_MODE.WARN) return TALENT_LEARNING_MODE.WARN;
  if (m === TALENT_LEARNING_MODE.ENFORCE) return TALENT_LEARNING_MODE.ENFORCE;
  return TALENT_LEARNING_MODE.OFF;
}

function _normalizeNoGovernRule(rule) {
  const r = String(rule ?? "").trim().toLowerCase();
  if (r === TALENT_NO_GOVERNING_COST_RULE.BASE) return TALENT_NO_GOVERNING_COST_RULE.BASE;
  return TALENT_NO_GOVERNING_COST_RULE.DISCOUNTED;
}

function _normalizeNoticeMode(mode) {
  const m = String(mode ?? "").trim().toLowerCase();
  if (m === TALENT_LEARNING_NOTICE_MODE.OFF) return TALENT_LEARNING_NOTICE_MODE.OFF;
  if (m === TALENT_LEARNING_NOTICE_MODE.VERBOSE) return TALENT_LEARNING_NOTICE_MODE.VERBOSE;
  return TALENT_LEARNING_NOTICE_MODE.PROBLEMS;
}

export function getTalentLearningMode() {
  return _normalizeMode(_getSettingSafe("talentLearningMode", TALENT_LEARNING_MODE.OFF));
}

export function getTalentNoGoverningCostRule() {
  return _normalizeNoGovernRule(
    _getSettingSafe("talentNoGoverningCostRule", TALENT_NO_GOVERNING_COST_RULE.DISCOUNTED)
  );
}

export function getTalentLearningNoticeMode() {
  return _normalizeNoticeMode(
    _getSettingSafe("talentLearningNoticeMode", TALENT_LEARNING_NOTICE_MODE.PROBLEMS)
  );
}

export function normalizeTalentLevel(levelRaw) {
  const key = _key(levelRaw);
  if (key && LEVEL_ALIASES[key]) return LEVEL_ALIASES[key];

  const text = String(levelRaw ?? "").toLowerCase();
  if (!text) return null;
  for (const k of ["novice", "apprentice", "journeyman", "adept", "expert", "master"]) {
    if (text.includes(k)) return k;
  }

  return null;
}

function _getCatalogEntry(slug) {
  if (!slug) return null;
  const cat = getChapter4Catalog();
  const talents = Array.isArray(cat?.talents) ? cat.talents : [];
  return talents.find((t) => String(t?.slug ?? "") === slug) ?? null;
}

function _splitTokens(raw) {
  return String(raw ?? "")
    .split(/[,\n;/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseGoverningCharacteristics(raw) {
  const keys = [];
  const unresolved = [];
  const tokens = _splitTokens(raw)
    .flatMap((tok) => String(tok).split(/\band\b/i))
    .map((tok) => tok.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const k = _key(token);
    if (!k) continue;
    if (k === "none" || k === "any" || k === "na" || k === "nogoverningcharacteristics") continue;
    if (k.includes("skillsgoverningcharacteristics")) {
      unresolved.push(token);
      continue;
    }
    const mapped = CHARACTERISTIC_ALIASES[k] ?? null;
    if (mapped) keys.push(mapped);
    else unresolved.push(token);
  }

  return {
    keys: Array.from(new Set(keys)),
    unresolved: Array.from(new Set(unresolved)),
  };
}

function _mergeReqArrays(a = [], b = []) {
  return Array.from(new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].filter(Boolean)));
}

function _extractClause(raw, keyword) {
  const re = new RegExp(`${keyword}\\s+([^.;\\n]+)`, "ig");
  const out = [];
  let match;
  while ((match = re.exec(raw))) out.push(String(match[1] ?? "").trim());
  return out;
}

function _extractRequirementNames(clause) {
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

  for (const clause of _extractClause(text, "requires?")) {
    for (const name of _extractRequirementNames(clause)) {
      const slug = resolveTalentSlug(name);
      if (slug && _KNOWN_TALENT_SLUGS.has(slug)) requires.push(slug);
      else unresolved.push(name);
    }
  }

  for (const clause of _extractClause(text, "replaces?")) {
    for (const name of _extractRequirementNames(clause)) {
      const slug = resolveTalentSlug(name);
      if (slug && _KNOWN_TALENT_SLUGS.has(slug)) replaces.push(slug);
      else unresolved.push(name);
    }
  }

  // Handle compact "Requires/Replaces X" style as both constraints.
  if (/requires?\s*\/\s*replaces?/i.test(text)) {
    const stripped = text.replace(/^.*requires?\s*\/\s*replaces?\s*/i, "").trim();
    for (const name of _extractRequirementNames(stripped)) {
      const slug = resolveTalentSlug(name);
      if (slug && _KNOWN_TALENT_SLUGS.has(slug)) {
        requires.push(slug);
        replaces.push(slug);
      } else unresolved.push(name);
    }
  }

  return {
    requires: Array.from(new Set(requires.filter(Boolean))),
    replaces: Array.from(new Set(replaces.filter(Boolean))),
    unresolved: Array.from(new Set(unresolved.filter(Boolean))),
  };
}

function _isTalentOwned(actor, slug, { ignoreItemId = null } = {}) {
  if (!actor || !slug) return false;
  const items = actor.items ?? [];
  for (const it of items) {
    if (!it || it.type !== "talent") continue;
    if (ignoreItemId && String(it.id ?? it._id ?? "") === String(ignoreItemId)) continue;
    if (resolveTalentSlug(it.name) === slug) return true;
  }
  return false;
}

function _discountFavored(cost) {
  const c = Math.max(0, _toNum(cost, 0));
  return Math.floor((c * 0.75) / 5) * 5;
}

function _getTalentName(talentLike) {
  if (typeof talentLike === "string") return talentLike;
  return String(talentLike?.name ?? "Talent").trim() || "Talent";
}

function _getTalentSystem(talentLike) {
  if (!talentLike || typeof talentLike !== "object") return {};
  return talentLike.system ?? {};
}

function _joinReasonLines(lines = []) {
  return lines.filter(Boolean).join(" ");
}

function _noticeDedupKey(result) {
  const actorId = String(result?.actorId ?? "");
  const slug = String(result?.slug ?? "").trim().toLowerCase();
  const mode = String(result?.mode ?? "").trim().toLowerCase();
  const source = String(result?.source ?? "").trim().toLowerCase();
  const reasons = Array.isArray(result?.reasons) ? result.reasons.join("|") : "";
  const guidance = Array.isArray(result?.guidance) ? result.guidance.join("|") : "";
  const warnings = Array.isArray(result?.warnings) ? result.warnings.join("|") : "";
  return [actorId, slug, mode, source, reasons, guidance, warnings].join("::");
}

function _shouldSuppressNotice(result) {
  const source = String(result?.source ?? "").trim().toLowerCase();
  if (!source) return false;
  // De-duplicate drop pipeline warnings that can be emitted by both preflight and create hooks.
  if (!(source === "drop" || source === "precreateitem" || source === "createitem")) return false;

  const key = _noticeDedupKey(result);
  if (!key) return false;

  const now = Date.now();
  const prevTs = Number(_noticeDedupMap.get(key) ?? 0);
  _noticeDedupMap.set(key, now);

  // Keep map bounded over time.
  if (_noticeDedupMap.size > 250) {
    for (const [k, ts] of _noticeDedupMap.entries()) {
      if (now - Number(ts) > 5000) _noticeDedupMap.delete(k);
    }
  }

  return (now - prevTs) <= 1500;
}

export function validateTalentLearning(actor, talentLike, opts = {}) {
  const mode = _normalizeMode(opts.mode ?? getTalentLearningMode());
  const noGoverningRule = _normalizeNoGovernRule(
    opts.noGoverningCostRule ?? getTalentNoGoverningCostRule()
  );
  const ignoreItemId = opts.ignoreItemId ?? null;

  const name = _getTalentName(talentLike);
  const slug = resolveTalentSlug(name);
  const system = _getTalentSystem(talentLike);
  const catalog = _getCatalogEntry(slug);

  const reasons = [];
  const warnings = [];
  const guidance = [];

  if (!actor || actor.type !== "Player Character") {
    return {
      ok: true,
      rulesOk: true,
      mode,
      noGoverningRule,
      talentName: name,
      slug,
      reasons,
      warnings,
      guidance,
      xpCost: 0,
      baseXpCost: 0,
      level: null,
      requirementThreshold: null,
      governingCharacteristics: [],
      favoredDiscountApplied: false,
      noGoverningDiscountApplied: false,
      duplicate: false,
      requiresManualReview: false,
      actorId: actor?.id ?? null,
      prerequisites: { requires: [], replaces: [], unresolved: [], satisfied: true },
      characteristic: { satisfied: true, checks: [] },
    };
  }

  const duplicate = _isTalentOwned(actor, slug, { ignoreItemId });
  if (duplicate) reasons.push(`${name} is already learned.`);

  const rawLevel = system.level ?? catalog?.level ?? "";
  const level = normalizeTalentLevel(rawLevel);
  const levelRule = level ? LEVEL_RULES[level] : null;

  let baseXpCost = null;
  if (levelRule) baseXpCost = _toNum(levelRule.xpCost, 0);
  else if (_toNum(system.xpCost, 0) > 0) baseXpCost = _toNum(system.xpCost, 0);

  if (!level && baseXpCost == null) {
    guidance.push("Talent level metadata is missing; cannot derive RAW XP cost.");
  }

  const rawGoverning = String(system.governingCharacteristics ?? "").trim();
  const governingFromCatalog = Array.isArray(catalog?.governingCharacteristics)
    ? catalog.governingCharacteristics.join(",")
    : "";
  const governingParse = parseGoverningCharacteristics(rawGoverning || governingFromCatalog);
  const governingCharacteristics = governingParse.keys;

  if (governingParse.unresolved.length) {
    guidance.push(
      `Unparsed governing characteristic metadata: ${governingParse.unresolved.join(", ")}.`
    );
  }

  const requirementThreshold = levelRule?.characteristicRequirement ?? null;
  const checks = governingCharacteristics.map((k) => {
    const c = actor.system?.characteristics?.[k] ?? {};
    const base = _toNum(c.base, _toNum(c.total, 0));
    return {
      key: k,
      label: CHARACTERISTIC_LABELS[k] ?? k.toUpperCase(),
      base,
      favored: Boolean(c.favored),
      meets: requirementThreshold == null ? true : base >= requirementThreshold,
    };
  });

  const characteristicSatisfied = !governingCharacteristics.length
    ? true
    : (requirementThreshold == null ? false : checks.some((c) => c.meets));

  if (governingCharacteristics.length && requirementThreshold == null) {
    guidance.push("Cannot verify characteristic requirement because level is unknown.");
  } else if (!characteristicSatisfied) {
    const labels = checks.map((c) => `${c.label} ${c.base}`).join(", ");
    reasons.push(
      `Characteristic requirement not met: requires at least ${requirementThreshold} in one governing characteristic (${labels}).`
    );
  }

  const catalogReq = catalog?.requirements ?? {};
  const parsedReqFromItem = parseTalentRequirements(
    _joinReasonLines([system.talentReq, system.miscReq])
  );
  const requires = _mergeReqArrays(catalogReq.requires, parsedReqFromItem.requires);
  const replaces = _mergeReqArrays(catalogReq.replaces, parsedReqFromItem.replaces);
  const unresolvedReq = _mergeReqArrays([], parsedReqFromItem.unresolved);

  const requireChecks = requires.map((reqSlug) => ({
    slug: reqSlug,
    label: reqSlug,
    owned: _isTalentOwned(actor, reqSlug, { ignoreItemId }),
  }));
  const replaceChecks = replaces.map((repSlug) => ({
    slug: repSlug,
    label: repSlug,
    owned: _isTalentOwned(actor, repSlug, { ignoreItemId }),
  }));

  for (const req of requireChecks) {
    if (!req.owned) reasons.push(`Missing prerequisite talent: ${req.label}.`);
  }

  for (const rep of replaceChecks) {
    if (!rep.owned) reasons.push(`Missing replacement prerequisite talent: ${rep.label}.`);
    else warnings.push(`Replacement talent present (${rep.label}); remove/retire old talent per RAW if applicable.`);
  }

  if (unresolvedReq.length) {
    guidance.push(`Unparsed prerequisite text: ${unresolvedReq.join(", ")}.`);
  }

  const favored = checks.some((c) => c.favored);
  const noGoverningDiscountApplied =
    governingCharacteristics.length === 0 &&
    noGoverningRule === TALENT_NO_GOVERNING_COST_RULE.DISCOUNTED;
  const favoredDiscountApplied = favored || noGoverningDiscountApplied;

  let xpCost = 0;
  if (baseXpCost != null) {
    xpCost = favoredDiscountApplied ? _discountFavored(baseXpCost) : _toNum(baseXpCost, 0);
  } else {
    xpCost = 0;
  }

  const currentXp = _toNum(actor.system?.xp, 0);
  if (xpCost > currentXp) {
    reasons.push(`Not enough XP. Required ${xpCost}, available ${currentXp}.`);
  }

  const requiresManualReview = guidance.length > 0;
  if (mode === TALENT_LEARNING_MODE.ENFORCE && requiresManualReview) {
    reasons.push("Manual review required for this talent metadata before enforce-mode purchase.");
  }
  const rulesOk = reasons.length === 0 && !requiresManualReview;
  const ok = mode === TALENT_LEARNING_MODE.ENFORCE ? rulesOk : true;

  return {
    ok,
    rulesOk,
    mode,
    noGoverningRule,
    talentName: name,
    slug,
    level,
    levelLabel: levelRule?.label ?? (String(rawLevel ?? "").trim() || null),
    requirementThreshold,
    governingCharacteristics,
    characteristic: {
      satisfied: characteristicSatisfied,
      checks,
    },
    prerequisites: {
      requires: requireChecks,
      replaces: replaceChecks,
      unresolved: unresolvedReq,
      satisfied: requireChecks.every((r) => r.owned) && replaceChecks.every((r) => r.owned),
    },
    baseXpCost: _toNum(baseXpCost, 0),
    xpCost,
    currentXp,
    nextXp: Math.max(0, currentXp - xpCost),
    favoredDiscountApplied,
    noGoverningDiscountApplied,
    duplicate,
    actorId: actor?.id ?? null,
    reasons,
    warnings,
    guidance,
    requiresManualReview,
    source: opts.source ?? "",
  };
}

function _formatValidationSummary(result) {
  const lines = [];
  if (result.reasons.length) lines.push(`Issues: ${result.reasons.join(" ")}`);
  if (result.guidance.length) lines.push(`Review: ${result.guidance.join(" ")}`);
  if (result.warnings.length) lines.push(`Notes: ${result.warnings.join(" ")}`);
  if (!lines.length) {
    lines.push(`Valid. XP cost: ${result.xpCost}.`);
  }
  return lines.join(" ");
}

export function notifyTalentLearningResult(result, { force = false } = {}) {
  if (!result) return;
  if (_shouldSuppressNotice(result)) return;
  const summary = _formatValidationSummary(result);
  if (!summary) return;
  const noticeMode = getTalentLearningNoticeMode();
  if (noticeMode === TALENT_LEARNING_NOTICE_MODE.OFF) return;

  if (result.mode === TALENT_LEARNING_MODE.OFF && !force) return;

  if (result.mode === TALENT_LEARNING_MODE.ENFORCE && !result.ok) {
    ui.notifications?.warn?.(`Talent learning blocked (${result.talentName}). ${summary}`);
    return;
  }

  if (result.mode === TALENT_LEARNING_MODE.WARN || force) {
    if (result.reasons.length || result.guidance.length || result.warnings.length) {
      ui.notifications?.warn?.(`Talent learning warning (${result.talentName}). ${summary}`);
      return;
    }
    if (noticeMode === TALENT_LEARNING_NOTICE_MODE.VERBOSE) {
      ui.notifications?.info?.(`Talent learning check (${result.talentName}). ${summary}`);
    }
  }
}

async function _withXpLock(actor, fn) {
  const key = String(actor?.id ?? actor?.uuid ?? "");
  if (!key) return await fn();

  while (_xpSpendLocks.has(key)) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  _xpSpendLocks.add(key);
  try {
    return await fn();
  } finally {
    _xpSpendLocks.delete(key);
  }
}

export async function applyTalentLearningXpCost(actor, validationResult) {
  if (!actor || !validationResult) return { ok: false, spentXp: 0, reason: "Missing actor or validation result." };
  if (validationResult.mode !== TALENT_LEARNING_MODE.ENFORCE) return { ok: true, spentXp: 0 };
  if (!validationResult.rulesOk) return { ok: false, spentXp: 0, reason: "Validation failed." };
  const cost = Math.max(0, _toNum(validationResult.xpCost, 0));
  if (cost <= 0) return { ok: true, spentXp: 0 };

  return _withXpLock(actor, async () => {
    const currentXp = _toNum(actor.system?.xp, 0);
    if (currentXp < cost) {
      return {
        ok: false,
        spentXp: 0,
        reason: `Not enough XP after re-check. Required ${cost}, available ${currentXp}.`,
      };
    }

    const nextXp = Math.max(0, currentXp - cost);
    const updated = await requestUpdateDocument(actor, { "system.xp": nextXp });
    if (!updated) {
      return { ok: false, spentXp: 0, reason: "Failed to persist XP deduction." };
    }
    return { ok: true, spentXp: cost, nextXp };
  });
}
