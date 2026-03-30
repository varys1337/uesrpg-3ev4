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
import { resolveTalentSlug } from "./talents-api.js";
import {
  TALENT_LEARNING_MODE,
  TALENT_NO_GOVERNING_COST_RULE,
  TALENT_LEARNING_NOTICE_MODE,
  LEVEL_RULES,
  CHARACTERISTIC_LABELS,
  coerceTalentLearningNumber,
  normalizeTalentLearningMode,
  normalizeTalentNoGovernRule,
  getTalentLearningMode,
  getTalentNoGoverningCostRule,
  getTalentLearningNoticeMode,
  normalizeTalentLevel,
  getTalentCatalogEntry,
  parseGoverningCharacteristics,
  mergeTalentLearningArrays,
  parseTalentRequirements,
  isTalentOwned,
  discountFavoredTalentCost,
  getTalentLikeName,
  getTalentLikeSystem,
  joinTalentLearningReasonLines
} from "./talent-learning-support.js";

export {
  TALENT_LEARNING_MODE,
  TALENT_NO_GOVERNING_COST_RULE,
  TALENT_LEARNING_NOTICE_MODE,
  getTalentLearningMode,
  getTalentNoGoverningCostRule,
  getTalentLearningNoticeMode,
  normalizeTalentLevel,
  parseGoverningCharacteristics,
  parseTalentRequirements
} from "./talent-learning-support.js";

const xpSpendLocks = new Set();
const noticeDedupMap = new Map();

function noticeDedupKey(result) {
  const actorId = String(result?.actorId ?? "");
  const slug = String(result?.slug ?? "").trim().toLowerCase();
  const mode = String(result?.mode ?? "").trim().toLowerCase();
  const source = String(result?.source ?? "").trim().toLowerCase();
  const reasons = Array.isArray(result?.reasons) ? result.reasons.join("|") : "";
  const guidance = Array.isArray(result?.guidance) ? result.guidance.join("|") : "";
  const warnings = Array.isArray(result?.warnings) ? result.warnings.join("|") : "";
  return [actorId, slug, mode, source, reasons, guidance, warnings].join("::");
}

function shouldSuppressNotice(result) {
  const source = String(result?.source ?? "").trim().toLowerCase();
  if (!(source === "drop" || source === "precreateitem" || source === "createitem")) return false;

  const dedupKey = noticeDedupKey(result);
  if (!dedupKey) return false;

  const now = Date.now();
  const prevTs = Number(noticeDedupMap.get(dedupKey) ?? 0);
  noticeDedupMap.set(dedupKey, now);

  if (noticeDedupMap.size > 250) {
    for (const [k, ts] of noticeDedupMap.entries()) {
      if (now - Number(ts) > 5000) noticeDedupMap.delete(k);
    }
  }

  return (now - prevTs) <= 1500;
}

export function validateTalentLearning(actor, talentLike, opts = {}) {
  const mode = normalizeTalentLearningMode(opts.mode ?? getTalentLearningMode());
  const noGoverningRule = normalizeTalentNoGovernRule(
    opts.noGoverningCostRule ?? getTalentNoGoverningCostRule()
  );
  const ignoreItemId = opts.ignoreItemId ?? null;

  const name = getTalentLikeName(talentLike);
  const slug = resolveTalentSlug(name);
  const system = getTalentLikeSystem(talentLike);
  const catalog = getTalentCatalogEntry(slug);

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

  const duplicate = isTalentOwned(actor, slug, { ignoreItemId });
  if (duplicate) reasons.push(`${name} is already learned.`);

  const rawLevel = system.level ?? catalog?.level ?? "";
  const level = normalizeTalentLevel(rawLevel);
  const levelRule = level ? LEVEL_RULES[level] : null;

  let baseXpCost = null;
  if (levelRule) baseXpCost = coerceTalentLearningNumber(levelRule.xpCost, 0);
  else if (coerceTalentLearningNumber(system.xpCost, 0) > 0) baseXpCost = coerceTalentLearningNumber(system.xpCost, 0);

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
    guidance.push(`Unparsed governing characteristic metadata: ${governingParse.unresolved.join(", ")}.`);
  }

  const requirementThreshold = levelRule?.characteristicRequirement ?? null;
  const checks = governingCharacteristics.map((k) => {
    const c = actor.system?.characteristics?.[k] ?? {};
    const base = coerceTalentLearningNumber(c.base, coerceTalentLearningNumber(c.total, 0));
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
    reasons.push(`Characteristic requirement not met: requires at least ${requirementThreshold} in one governing characteristic (${labels}).`);
  }

  const catalogReq = catalog?.requirements ?? {};
  const parsedReqFromItem = parseTalentRequirements(
    joinTalentLearningReasonLines([system.talentReq, system.miscReq])
  );
  const requires = mergeTalentLearningArrays(catalogReq.requires, parsedReqFromItem.requires);
  const replaces = mergeTalentLearningArrays(catalogReq.replaces, parsedReqFromItem.replaces);
  const unresolvedReq = mergeTalentLearningArrays([], parsedReqFromItem.unresolved);

  const requireChecks = requires.map((reqSlug) => ({
    slug: reqSlug,
    label: reqSlug,
    owned: isTalentOwned(actor, reqSlug, { ignoreItemId }),
  }));
  const replaceChecks = replaces.map((repSlug) => ({
    slug: repSlug,
    label: repSlug,
    owned: isTalentOwned(actor, repSlug, { ignoreItemId }),
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
    xpCost = favoredDiscountApplied ? discountFavoredTalentCost(baseXpCost) : coerceTalentLearningNumber(baseXpCost, 0);
  }

  const currentXp = coerceTalentLearningNumber(actor.system?.xp, 0);
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
    baseXpCost: coerceTalentLearningNumber(baseXpCost, 0),
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

function formatValidationSummary(result) {
  const lines = [];
  if (result.reasons.length) lines.push(`Issues: ${result.reasons.join(" ")}`);
  if (result.guidance.length) lines.push(`Review: ${result.guidance.join(" ")}`);
  if (result.warnings.length) lines.push(`Notes: ${result.warnings.join(" ")}`);
  if (!lines.length) lines.push(`Valid. XP cost: ${result.xpCost}.`);
  return lines.join(" ");
}

export function notifyTalentLearningResult(result, { force = false } = {}) {
  if (!result || shouldSuppressNotice(result)) return;
  const summary = formatValidationSummary(result);
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

async function withXpLock(actor, fn) {
  const lockKey = String(actor?.id ?? actor?.uuid ?? "");
  if (!lockKey) return await fn();

  while (xpSpendLocks.has(lockKey)) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  xpSpendLocks.add(lockKey);
  try {
    return await fn();
  } finally {
    xpSpendLocks.delete(lockKey);
  }
}

export async function applyTalentLearningXpCost(actor, validationResult) {
  if (!actor || !validationResult) return { ok: false, spentXp: 0, reason: "Missing actor or validation result." };
  if (validationResult.mode !== TALENT_LEARNING_MODE.ENFORCE) return { ok: true, spentXp: 0 };
  if (!validationResult.rulesOk) return { ok: false, spentXp: 0, reason: "Validation failed." };
  const cost = Math.max(0, coerceTalentLearningNumber(validationResult.xpCost, 0));
  if (cost <= 0) return { ok: true, spentXp: 0 };

  return withXpLock(actor, async () => {
    const currentXp = coerceTalentLearningNumber(actor.system?.xp, 0);
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
