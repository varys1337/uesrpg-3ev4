import { getExplicitActiveCombatStyleItem } from "../../combat/combat-style-utils.js";
import { _num } from "../../../utils/coerce.js";
import { resolveUuidSync } from "../../../utils/uuid-cache.js";

export function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function getActorResource(actor, path) {
  try {
    return _num(foundry.utils.getProperty(actor?.system, path));
  } catch {
    return 0;
  }
}

export function getTargetsFromContext(context) {
  const provided = context?.targets;
  if (provided instanceof Set) return Array.from(provided);
  if (Array.isArray(provided)) return provided;
  if (provided) return [provided];
  const targets = game?.user?.targets;
  if (targets instanceof Set) return Array.from(targets);
  return [];
}

export function resolveTokenForActor(actor) {
  const id = actor?.id ?? null;
  if (!id) return null;
  const controlled = canvas?.tokens?.controlled ?? [];
  const match = controlled.find((token) => token?.actor?.id === id);
  if (match) return match;
  return canvas?.tokens?.placeables?.find((token) => token?.actor?.id === id) ?? null;
}

function resolveUuidWithResolver(uuid, resolver) {
  if (resolver?.resolveSync) return resolver.resolveSync(uuid);
  return resolveUuidSync(uuid);
}

export function resolveTokenTarget(target, { resolver = null } = {}) {
  if (!target) return null;
  if (target?.document?.documentName === "Token") return target;
  if (target?.documentName === "TokenDocument") return target.object ?? canvas?.tokens?.get?.(target.id) ?? null;
  if (target?.documentName === "Token") return target.object ?? canvas?.tokens?.get?.(target.id) ?? null;
  if (target?.object?.document?.documentName === "Token") return target.object;
  if (typeof target === "string") {
    const doc = resolveUuidWithResolver(target, resolver);
    if (doc?.documentName === "TokenDocument") return doc.object ?? canvas?.tokens?.get?.(doc.id) ?? null;
    if (doc?.documentName === "Token") return doc.object ?? canvas?.tokens?.get?.(doc.id) ?? null;
  }
  return null;
}

export function buildActivationActorSnapshot(actor) {
  const items = Array.from(actor?.items ?? []);
  const equippedWeapons = items.filter((item) => item?.type === "weapon" && item?.system?.equipped === true);
  const combatStyles = items.filter((item) => item?.type === "combatStyle");
  return {
    actor,
    items,
    equippedWeapons,
    hasEquippedWeapon: equippedWeapons.length > 0,
    hasEquippedMeleeWeapon: equippedWeapons.some((item) => String(item?.system?.attackMode ?? "melee").toLowerCase() !== "ranged"),
    hasEquippedRangedWeapon: equippedWeapons.some((item) => String(item?.system?.attackMode ?? "").toLowerCase() === "ranged"),
    activeCombatStyle: getExplicitActiveCombatStyleItem(actor) ?? combatStyles[0] ?? null,
    fatiguePenalty: Number(actor?.system?.fatigue?.penalty ?? 0) || 0,
    carryPenalty: Number(actor?.system?.carry_rating?.penalty ?? 0) || 0,
    woundPenalty: Number(actor?.system?.woundPenalty ?? 0) || 0
  };
}

export function getActivationCostValues(costs = {}) {
  return {
    ap: Math.max(0, _num(costs.action_points)),
    sp: Math.max(0, _num(costs.stamina)),
    mp: Math.max(0, _num(costs.magicka)),
    lp: Math.max(0, _num(costs.luck_points)),
    hp: Math.max(0, _num(costs.health))
  };
}

export function normalizeUsage(activation = {}) {
  const usage = activation.usage ?? null;
  const usagePeriod = String(usage?.period ?? "").trim().toLowerCase();
  const usageHasData =
    (usage?.max != null && _num(usage.max) > 0) ||
    (usage?.current != null && _num(usage.current) > 0) ||
    (usagePeriod.length > 0 && usagePeriod !== "none");
  if (usage && usageHasData) {
    return {
      source: "usage",
      max: usage.max == null ? null : _num(usage.max),
      period: usagePeriod || null,
      current: _num(usage.current)
    };
  }

  const uses = activation.uses ?? null;
  const usesReset = String(uses?.reset ?? "").trim().toLowerCase();
  const usesHasData =
    (uses?.max != null && _num(uses.max) > 0) ||
    (uses?.value != null && _num(uses.value) > 0) ||
    (usesReset.length > 0 && usesReset !== "none");
  if (uses && usesHasData) {
    return {
      source: "uses",
      max: uses.max == null ? null : _num(uses.max),
      period: uses.reset ?? null,
      current: _num(uses.value)
    };
  }

  return { source: null, max: null, period: null, current: 0 };
}

export function formatUsagePeriod(period) {
  const key = String(period ?? "").trim();
  if (!key) return "";
  const labels = {
    encounter: "Encounter",
    shortRest: "Short Rest",
    longRest: "Long Rest",
    day: "Day",
    daily: "Daily",
    none: ""
  };
  return labels[key] ?? key;
}

export function shouldConsumeUsage(activation = {}) {
  return activation.consumeUse === true;
}

export function isAttackActivation(activation = {}) {
  const mode = String(activation?.roll?.mode ?? "").toLowerCase().trim();
  return mode === "attack" || activation?.roll?.isAttack === true;
}

export function getHitLocationMode(activation = {}) {
  const mode = String(activation?.roll?.hitLocationMode ?? "roll").toLowerCase().trim();
  return mode === "manual" ? "manual" : "roll";
}

export function getAttackModeFromActivation(activation = {}) {
  const explicit = String(activation?.roll?.attackMode ?? "").toLowerCase().trim();
  if (explicit === "melee" || explicit === "ranged") return explicit;

  const requirements = activation?.requirements ?? {};
  if (requirements.requiresRanged) return "ranged";
  if (requirements.requiresMelee) return "melee";
  return "melee";
}

export function normalizeActivationDamage(activation = {}) {
  const damage = activation?.damage ?? {};
  const mode = String(damage.mode ?? "weapon").toLowerCase().trim();
  const allowed = new Set(["weapon", "manual", "healing", "temporary"]);
  if (!allowed.has(mode) || mode === "weapon") return null;
  const structuredRaw = Array.isArray(damage.qualitiesStructured) ? damage.qualitiesStructured : [];
  const traitsRaw = Array.isArray(damage.qualitiesTraits) ? damage.qualitiesTraits : [];

  const qualitiesStructured = structuredRaw.map((quality) => {
    if (!quality) return null;
    if (typeof quality === "string") {
      const key = String(quality).trim();
      return key ? { key } : null;
    }
    const key = String(quality.key ?? quality.name ?? quality.label ?? "").trim();
    if (!key) return null;
    const out = { key };
    if (quality.value != null && quality.value !== "") {
      const numeric = Number(quality.value);
      if (Number.isFinite(numeric)) out.value = numeric;
    }
    return out;
  }).filter(Boolean);

  const qualitiesTraits = traitsRaw
    .map((trait) => String(trait ?? "").trim())
    .filter(Boolean);

  return {
    mode,
    formula: String(damage.formula ?? "").trim(),
    type: String(damage.type ?? "").trim().toLowerCase(),
    qualitiesStructured,
    qualitiesTraits
  };
}

export function normalizeActivationTags(activation = {}) {
  const tags = Array.isArray(activation?.roll?.tags) ? activation.roll.tags : [];
  return tags.map((tag) => String(tag ?? "").trim()).filter(Boolean);
}
