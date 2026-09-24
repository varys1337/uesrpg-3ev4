import { QUALITY_TIERS } from "./effects.js";
import { FLAG_NS } from "./shared.js";

const CANONICAL_INGREDIENT_RX = /^alchemy\s+ingredient\s*[-:]\s*(ubiquitous|plentiful|common|uncommon|rare|very\s+rare|extremely\s+rare|legendary)$/i;

const QUALITY_ALIASES = Object.freeze({
  ubiquitous: "ubiquitous",
  plentiful: "plentiful",
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  veryrare: "veryRare",
  extremelyrare: "extremelyRare",
  legendary: "legendary",
});

function _normalizeQualityKey(value) {
  const compact = String(value ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return QUALITY_ALIASES[compact] ?? null;
}

function _canonicalQualityFromName(name) {
  const match = String(name ?? "").trim().match(CANONICAL_INGREDIENT_RX);
  return match ? _normalizeQualityKey(match[1]) : null;
}

function _qualityFromValues(strength, depth) {
  const wantedStrength = Number(strength);
  const wantedDepth = Number(depth);
  return Object.entries(QUALITY_TIERS).find(([, tier]) => (
    Number(tier.strength) === wantedStrength && Number(tier.depth) === wantedDepth
  ))?.[0] ?? null;
}

/**
 * Resolve an Item into one normalized alchemical-ingredient description.
 * Explicit ingredient flags are authoritative. The only name fallback is the
 * canonical Items Revised quality-item pattern.
 *
 * @param {Item|object} item
 * @returns {object|null}
 */
export function resolveAlchemyIngredientData(item) {
  if (!item) return null;

  const flags = item?.flags?.[FLAG_NS]?.alchemy ?? {};
  const explicitKind = String(flags?.kind ?? "").trim().toLowerCase();
  const explicitlyAssigned = explicitKind === "ingredient";
  const nameQuality = _canonicalQualityFromName(item?.name);
  if (explicitKind && !explicitlyAssigned) return null;
  if (!explicitlyAssigned && !nameQuality) return null;

  const flaggedQuality = _normalizeQualityKey(flags?.quality ?? flags?.qualityKey);
  const numericQuality = _qualityFromValues(flags?.strengthBase, flags?.depthBase);
  const qualityKey = flaggedQuality ?? nameQuality ?? numericQuality;
  const tier = qualityKey ? QUALITY_TIERS[qualityKey] ?? null : null;
  const strengthBase = Math.max(0, Number(flags?.strengthBase ?? tier?.strength ?? 0) || 0);
  const depthBase = Math.max(0, Number(flags?.depthBase ?? tier?.depth ?? 0) || 0);
  const school = String(flags?.school ?? "").trim().toLowerCase();
  const quantity = Math.max(0, Number(item?.system?.quantity ?? 1) || 0);
  const isConfigured = Boolean(school && strengthBase > 0 && depthBase > 0);

  return {
    item,
    id: item?.id ?? null,
    uuid: String(item?.uuid ?? "").trim(),
    name: String(item?.name ?? "").trim(),
    isIngredient: true,
    recognitionSource: explicitlyAssigned ? "flag" : "canonical-name",
    isCanonicalName: Boolean(nameQuality),
    qualityKey,
    qualityLabel: tier?.label ?? "Custom",
    school,
    strengthBase,
    effectiveStrength: strengthBase,
    depthBase,
    quantity,
    isConfigured,
    isUsable: isConfigured && quantity > 0,
    flags,
  };
}

/**
 * Return all recognized actor-owned ingredients.
 *
 * @param {Actor|object} actor
 * @param {object} [options]
 * @param {boolean} [options.includeUnconfigured=true]
 * @returns {object[]}
 */
export function getAlchemyIngredients(actor, { includeUnconfigured = true } = {}) {
  return Array.from(actor?.items ?? [])
    .map(resolveAlchemyIngredientData)
    .filter((entry) => entry && (includeUnconfigured || entry.isUsable))
    .sort((a, b) => {
      if (a.isUsable !== b.isUsable) return a.isUsable ? -1 : 1;
      const schoolDelta = String(a.school).localeCompare(String(b.school));
      if (schoolDelta !== 0) return schoolDelta;
      const depthDelta = Number(b.depthBase) - Number(a.depthBase);
      if (depthDelta !== 0) return depthDelta;
      return String(a.name).localeCompare(String(b.name));
    });
}

export function getCanonicalIngredientQualityFromName(name) {
  return _canonicalQualityFromName(name);
}
