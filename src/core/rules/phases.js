/**
 * src/core/rules/phases.js
 *
 * Standard phase constants for staged rule-element evaluation.
 */

export const RULE_PHASES = Object.freeze({
  ACTOR_PREP: "actorPrep",
  PRE_ROLL: "preRoll",
  POST_ROLL: "postRoll",
  PRE_DAMAGE: "preDamage",
  POST_DAMAGE: "postDamage"
});

const PHASE_ALIAS_TO_CANONICAL = Object.freeze({
  actorprep: RULE_PHASES.ACTOR_PREP,
  "actor-prep": RULE_PHASES.ACTOR_PREP,
  pre_roll: RULE_PHASES.PRE_ROLL,
  preroll: RULE_PHASES.PRE_ROLL,
  "pre-roll": RULE_PHASES.PRE_ROLL,
  post_roll: RULE_PHASES.POST_ROLL,
  postroll: RULE_PHASES.POST_ROLL,
  "post-roll": RULE_PHASES.POST_ROLL,
  pre_damage: RULE_PHASES.PRE_DAMAGE,
  predamage: RULE_PHASES.PRE_DAMAGE,
  "pre-damage": RULE_PHASES.PRE_DAMAGE,
  post_damage: RULE_PHASES.POST_DAMAGE,
  postdamage: RULE_PHASES.POST_DAMAGE,
  "post-damage": RULE_PHASES.POST_DAMAGE
});

function _phaseAliasKey(value) {
  return String(value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

/**
 * Normalize a phase string to the canonical RULE_PHASES value.
 *
 * @param {string} value
 * @param {{fallback?: string}} [options]
 * @returns {string}
 */
export function normalizeRulePhase(value, { fallback = "" } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  for (const canonical of Object.values(RULE_PHASES)) {
    if (raw === canonical) return canonical;
  }

  const alias = _phaseAliasKey(raw);
  return PHASE_ALIAS_TO_CANONICAL[alias] ?? fallback;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isRulePhase(value) {
  return Boolean(normalizeRulePhase(value, { fallback: "" }));
}
