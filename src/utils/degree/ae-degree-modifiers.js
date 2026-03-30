import { evaluateAEModifierKeys } from "../../core/active-effects/modifier-evaluator.js";

function _slug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_]/g, "");
}

function _unique(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).filter(Boolean)));
}

function _schoolKey(item, rollContext) {
  return _slug(item?.system?.school ?? rollContext?.school ?? "");
}

function _normalizeExtraScopes({ skillName = "", degreeScopes = [] } = {}) {
  const out = new Set();
  for (const scope of Array.isArray(degreeScopes) ? degreeScopes : []) {
    const key = _slug(scope);
    if (key === "social" || key === "observe") out.add(key);
  }

  if (_slug(skillName) === "observe") out.add("observe");
  return Array.from(out);
}

function _buildSuccessKeys({ workflow = "", side = "", skillName = "", item = null, rollContext = null, degreeScopes = [] } = {}) {
  const keys = ["system.modifiers.degrees.success.all"];
  const floorKeys = ["system.modifiers.degrees.success.minimum.all"];
  const wf = _slug(workflow);
  const sideKey = _slug(side);
  const skillKey = _slug(skillName);
  const school = _schoolKey(item, rollContext);
  const extras = _normalizeExtraScopes({ skillName, degreeScopes });

  if (wf === "skill") {
    keys.push("system.modifiers.degrees.success.skills.all");
    floorKeys.push("system.modifiers.degrees.success.minimum.skills.all");
    if (skillKey) {
      keys.push(`system.modifiers.degrees.success.skills.${skillKey}`);
      floorKeys.push(`system.modifiers.degrees.success.minimum.skills.${skillKey}`);
    }
  }

  if (wf === "combat") {
    keys.push("system.modifiers.degrees.success.combat.all");
    if (sideKey === "attacker") keys.push("system.modifiers.degrees.success.combat.attack");
    if (sideKey === "defender") keys.push("system.modifiers.degrees.success.combat.defense");
    if (sideKey === "attacker") floorKeys.push("system.modifiers.degrees.success.minimum.combat.attack");
    if (sideKey === "defender") floorKeys.push("system.modifiers.degrees.success.minimum.combat.defense");
  }

  if (wf === "magic") {
    keys.push("system.modifiers.degrees.success.magic.all");
    floorKeys.push("system.modifiers.degrees.success.minimum.magic.all");
    if (school) {
      keys.push(`system.modifiers.degrees.success.magic.${school}`);
      floorKeys.push(`system.modifiers.degrees.success.minimum.magic.${school}`);
    }
  }

  if (extras.includes("social")) {
    keys.push("system.modifiers.degrees.success.social");
    floorKeys.push("system.modifiers.degrees.success.minimum.social");
  }
  if (extras.includes("observe")) {
    keys.push("system.modifiers.degrees.success.observe");
    floorKeys.push("system.modifiers.degrees.success.minimum.observe");
  }

  return {
    additiveKeys: _unique(keys),
    minimumKeys: _unique(floorKeys)
  };
}

function _buildFailureKeys({ workflow = "", side = "", skillName = "", item = null, rollContext = null, degreeScopes = [] } = {}) {
  const keys = [];
  const wf = _slug(workflow);
  const sideKey = _slug(side);
  const skillKey = _slug(skillName);
  const school = _schoolKey(item, rollContext);
  const extras = _normalizeExtraScopes({ skillName, degreeScopes });

  if (wf === "skill") {
    keys.push("system.modifiers.degrees.failure.skills.all");
    if (skillKey) keys.push(`system.modifiers.degrees.failure.skills.${skillKey}`);
  }

  if (wf === "combat") {
    keys.push("system.modifiers.degrees.failure.combat.all");
    if (sideKey === "attacker") keys.push("system.modifiers.degrees.failure.combat.attack");
    if (sideKey === "defender") keys.push("system.modifiers.degrees.failure.combat.defense");
  }

  if (wf === "magic") {
    keys.push("system.modifiers.degrees.failure.magic.all");
    if (school) keys.push(`system.modifiers.degrees.failure.magic.${school}`);
  }

  if (extras.includes("social")) keys.push("system.modifiers.degrees.failure.social");
  if (extras.includes("observe")) keys.push("system.modifiers.degrees.failure.observe");

  return _unique(keys);
}

function _sumValues(map, keys) {
  return _unique(keys).reduce((sum, key) => sum + (Number(map?.[key] ?? 0) || 0), 0);
}

function _maxFloor(map, keys) {
  let max = 0;
  for (const key of _unique(keys)) {
    const value = Number(map?.[key] ?? 0) || 0;
    if (value > max) max = value;
  }
  return max;
}

/**
 * Apply canonical AE DoS/DoF modifiers to a resolved roll result.
 *
 * @param {Actor} actor
 * @param {object} result
 * @param {object} [context]
 * @returns {{changed: boolean, successDelta: number, failureDelta: number, successMinimum: number}}
 */
export function applyAEDegreeModifiers(actor, result, context = {}) {
  if (!actor || !result || typeof result !== "object") {
    return { changed: false, successDelta: 0, failureDelta: 0, successMinimum: 0 };
  }

  const currentDegree = Math.max(1, Number(result.degree ?? 1) || 1);
  let nextDegree = currentDegree;
  let successDelta = 0;
  let failureDelta = 0;
  let successMinimum = 0;

  if (result.isSuccess === true) {
    const successKeys = _buildSuccessKeys(context);
    const allKeys = _unique([...successKeys.additiveKeys, ...successKeys.minimumKeys]);
    const totals = allKeys.length ? evaluateAEModifierKeys(actor, allKeys) : {};
    successDelta = _sumValues(totals, successKeys.additiveKeys);
    successMinimum = _maxFloor(totals, successKeys.minimumKeys);
    nextDegree = Math.max(1, currentDegree + successDelta);
    if (successMinimum > 0) nextDegree = Math.max(nextDegree, successMinimum);
  } else if (result.isSuccess === false) {
    const failureKeys = _buildFailureKeys(context);
    const totals = failureKeys.length ? evaluateAEModifierKeys(actor, failureKeys) : {};
    failureDelta = _sumValues(totals, failureKeys);
    nextDegree = Math.max(1, currentDegree + failureDelta);
  }

  const changed = nextDegree !== currentDegree;
  if (changed) result.degree = nextDegree;
  result.textual = result.isSuccess ? `${result.degree} DoS` : `${result.degree} DoF`;

  return { changed, successDelta, failureDelta, successMinimum };
}

/**
 * Read the scoped backfire severity modifier lane.
 *
 * @param {Actor} actor
 * @returns {number}
 */
export function getBackfireSeverityModifier(actor) {
  if (!actor) return 0;
  const totals = evaluateAEModifierKeys(actor, ["system.modifiers.degrees.failure.backfire"]);
  return Number(totals["system.modifiers.degrees.failure.backfire"] ?? 0) || 0;
}
