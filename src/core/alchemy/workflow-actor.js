import { getMagicSkillLevel } from "../magic/magicka-utils.js";
import { getAlchemyFlags } from "./shared.js";
import { getActorItemsArray, normalizeAlchemyName } from "./utils.js";

const RANK_TO_NUMERIC = Object.freeze({
  untrained: -1,
  novice: 0,
  apprentice: 1,
  journeyman: 2,
  adept: 3,
  expert: 4,
  master: 5,
  grandmaster: 6,
  legendary: 7,
});

function _resolveAlchemyTN(skill) {
  return Math.max(
    0,
    Number(
      skill?.system?.value
      ?? skill?.system?.total
      ?? skill?.system?.testValue
      ?? skill?.system?.tn
      ?? 0
    ) || 0
  );
}

function _resolveAlchemyRank(actor, skill) {
  if (!skill) return 0;

  if (skill.type === "magicSkill") {
    const magicLevel = Math.max(0, Number(getMagicSkillLevel(actor, "alchemy") ?? 0) || 0);
    if (magicLevel > 0) return magicLevel;
  }

  const rankKey = String(skill?.system?.rank ?? "").trim().toLowerCase();
  if (rankKey && Object.prototype.hasOwnProperty.call(RANK_TO_NUMERIC, rankKey)) {
    return Math.max(0, Number(RANK_TO_NUMERIC[rankKey] ?? -1) + 1);
  }

  const explicitRank = Number(skill?.system?.rankValue ?? skill?.system?.level ?? 0);
  if (Number.isFinite(explicitRank) && explicitRank > 0) {
    return explicitRank > 8 ? Math.max(1, Math.floor(explicitRank / 10)) : explicitRank;
  }

  const tn = _resolveAlchemyTN(skill);
  return tn > 0 ? Math.max(1, Math.floor(tn / 10)) : 0;
}

export function getAlchemySkill(actor, { items = null } = {}) {
  const actorItems = Array.isArray(items) ? items : getActorItemsArray(actor);
  const candidates = actorItems.filter((item) => item?.type === "skill" || item?.type === "magicSkill");
  if (!candidates.length) return null;

  return candidates
    .map((item) => {
      const name = String(item?.name ?? "").trim();
      const normalized = normalizeAlchemyName(name);
      let score = 0;
      if (normalized === "alchemy") score += 100;
      else if (name.toLowerCase() === "alchemy") score += 75;
      else if (name.toLowerCase().includes("alchemy")) score += 25;
      if (item.type === "magicSkill") score += 5;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.item ?? null;
}

export function getAlchemySkillSnapshot(actor, { skill = null, items = null } = {}) {
  const item = skill ?? getAlchemySkill(actor, { items });
  const tn = _resolveAlchemyTN(item);
  const rank = _resolveAlchemyRank(actor, item);
  return { item, tn, rank, found: Boolean(item && tn > 0 && rank > 0) };
}

export function getAlchemyTalents(actor, { items = null } = {}) {
  const actorItems = Array.isArray(items) ? items : getActorItemsArray(actor);
  const talents = actorItems.filter((item) => item?.type === "talent");

  const hasName = (name) =>
    talents.some((t) => String(t.name ?? "").toLowerCase() === name.toLowerCase());

  const alchemistSchools = talents
    .filter((t) => /^alchemist\s*\[/i.test(t.name ?? ""))
    .map((t) => {
      const match = String(t.name ?? "").match(/\[([^\]]+)\]/);
      return match?.[1]?.toLowerCase() ?? null;
    })
    .filter(Boolean);

  return {
    isMasterAlchemist: hasName("Master Alchemist"),
    alchemistSchools,
    hasNothingVentured: hasName("Nothing Ventured, Nothing Gained"),
    hasTrialAndError: hasName("Trial and Error"),
  };
}

export function computeEffectiveStrength(ingredient, actor, opts = {}) {
  const data = getAlchemyFlags(ingredient);
  const base = Number(data.strengthBase ?? 0);
  const school = String(data.school ?? "").toLowerCase();
  const talents = opts.talents ?? getAlchemyTalents(actor);

  let bonus = 0;
  if (talents.alchemistSchools.includes(school)) bonus += 0.10;
  if (talents.isMasterAlchemist) bonus += 0.20;

  return Math.floor(base * (1 + bonus));
}
