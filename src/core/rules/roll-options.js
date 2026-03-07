/**
 * src/core/rules/roll-options.js
 *
 * Roll-option helpers used by rule-element predicates.
 */
import { SYSTEM_ID } from "../constants.js";
import { getFlagValueWithFallback } from "../system/flags.js";

const SAFE_OPTION_RE = /[^a-z0-9:_-]/g;

function _slug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(SAFE_OPTION_RE, "");
}

/**
 * Normalize a roll option string.
 *
 * @param {*} value
 * @returns {string}
 */
export function normalizeRollOption(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "";
  const normalized = s.replace(/\s+/g, "-").replace(SAFE_OPTION_RE, "");
  return normalized;
}

/**
 * Add a single roll option into a Set.
 *
 * @param {Set<string>} set
 * @param {*} option
 */
export function addRollOption(set, option) {
  if (!(set instanceof Set)) return;
  const normalized = normalizeRollOption(option);
  if (!normalized) return;
  set.add(normalized);
}

/**
 * Add multiple roll options into a Set.
 *
 * @param {Set<string>} set
 * @param {Array} options
 */
export function addRollOptions(set, options = []) {
  if (!(set instanceof Set)) return;
  if (!Array.isArray(options)) return;
  for (const opt of options) addRollOption(set, opt);
}

function _isActorInCombat(actor) {
  if (!actor) return false;
  try {
    if (typeof actor?.inCombat === "boolean") return actor.inCombat;
    if (!game?.combat?.started) return false;
    const id = String(actor.id ?? "");
    if (!id) return false;
    return game.combat.combatants.some((c) => String(c?.actor?.id ?? "") === id);
  } catch (_e) {
    return false;
  }
}

function _isActorHidden(actor) {
  if (!actor) return false;

  try {
    if (Boolean(actor.system?.traits?.condition?.hidden)) return true;
  } catch (_e) {
    // no-op
  }

  try {
    if (actor.statuses?.has?.("hidden")) return true;
  } catch (_e) {
    // no-op
  }

  try {
    const effects = Array.from(actor.effects ?? []);
    return effects.some((e) => {
      if (!e || e.disabled) return false;
      const keyA = String(getFlagValueWithFallback(e, "key") ?? "").toLowerCase();
      const keyB = String(e?.flags?.[SYSTEM_ID]?.condition?.key ?? "").toLowerCase();
      const name = String(e?.name ?? "").toLowerCase();
      return keyA === "hidden" || keyB === "hidden" || name === "hidden";
    });
  } catch (_e) {
    return false;
  }
}

/**
 * Build a conservative base roll-option set from deterministic context.
 *
 * @param {object} params
 * @returns {Set<string>}
 */
export function buildBaseRollOptions({
  actor = null,
  target = null,
  item = null,
  testType = "",
  testLabel = "",
  skillItem = null,
  characteristicKey = "",
  attackMode = "",
  attackVariant = "",
  defenseType = ""
} = {}) {
  const options = new Set();

  if (testType) addRollOption(options, `test:type:${_slug(testType)}`);

  const labelSlug = _slug(testLabel);
  if (labelSlug) addRollOption(options, `test:label:${labelSlug}`);

  const skillSlug = _slug(skillItem?.name ?? skillItem?.system?.skillName ?? "");
  if (skillSlug) addRollOption(options, `test:skill:${skillSlug}`);

  const charKey = _slug(characteristicKey);
  if (charKey) addRollOption(options, `test:char:${charKey}`);

  const atkMode = _slug(attackMode);
  if (atkMode) addRollOption(options, `attack:mode:${atkMode}`);

  const atkVariant = _slug(attackVariant);
  if (atkVariant) addRollOption(options, `attack:variant:${atkVariant}`);

  const defType = _slug(defenseType);
  if (defType) addRollOption(options, `defense:type:${defType}`);

  if (_isActorInCombat(actor)) addRollOption(options, "state:incombat");
  if (_isActorHidden(actor)) addRollOption(options, "state:hidden");

  // Keep deterministic uuids optional; useful for diagnostics and future targeting.
  const actorUuid = String(actor?.uuid ?? "").trim();
  if (actorUuid) addRollOption(options, `actor:${_slug(actorUuid)}`);
  const targetUuid = String(target?.uuid ?? "").trim();
  if (targetUuid) addRollOption(options, `target:${_slug(targetUuid)}`);
  const itemUuid = String(item?.uuid ?? "").trim();
  if (itemUuid) addRollOption(options, `item:${_slug(itemUuid)}`);

  return options;
}
