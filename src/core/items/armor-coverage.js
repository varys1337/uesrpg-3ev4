export const ARMOR_HIT_LOCATION_KEYS = Object.freeze([
  "Head",
  "Body",
  "RightArm",
  "LeftArm",
  "RightLeg",
  "LeftLeg",
]);

const CATEGORY_COVERAGE = Object.freeze({
  head: Object.freeze({ Head: true }),
  body: Object.freeze({ Body: true }),
  l_arm: Object.freeze({ LeftArm: true }),
  r_arm: Object.freeze({ RightArm: true }),
  l_leg: Object.freeze({ LeftLeg: true }),
  r_leg: Object.freeze({ RightLeg: true }),
  shield: Object.freeze({ LeftArm: true, RightArm: true }),
});

function normalizeCategory(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function resolveArmorCoverageCategory(system = {}) {
  const category = normalizeCategory(system?.category);
  if (CATEGORY_COVERAGE[category]) return category;

  const legacyCategory = normalizeCategory(system?.item_cat);
  return CATEGORY_COVERAGE[legacyCategory] ? legacyCategory : null;
}

export function normalizeArmorHitLocations(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(
    ARMOR_HIT_LOCATION_KEYS.map((key) => [key, source[key] === true])
  );
}

export function hasAnyArmorCoverage(raw = {}) {
  const normalized = normalizeArmorHitLocations(raw);
  return ARMOR_HIT_LOCATION_KEYS.some((key) => normalized[key] === true);
}

export function hasAllArmorCoverage(raw = {}) {
  const normalized = normalizeArmorHitLocations(raw);
  return ARMOR_HIT_LOCATION_KEYS.every((key) => normalized[key] === true);
}

export function getArmorCategoryCoverage(systemOrCategory = {}) {
  const category = typeof systemOrCategory === "string"
    ? normalizeCategory(systemOrCategory)
    : resolveArmorCoverageCategory(systemOrCategory);
  const seeded = CATEGORY_COVERAGE[category];
  if (!seeded) return null;

  return Object.fromEntries(
    ARMOR_HIT_LOCATION_KEYS.map((key) => [key, seeded[key] === true])
  );
}
