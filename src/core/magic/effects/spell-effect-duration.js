/**
 * @module magic/effects/spell-effect-duration
 *
 * Spell-facing wrapper for the v14 native ActiveEffect duration pipeline.
 *
 * Spell-created actor effects use the spell Casting-tab duration after
 * profile/scaling resolution. Embedded spell ActiveEffects are templates for
 * changes and presentation only; their duration fields are retained only as
 * provenance metadata.
 */

import {
  buildSpellEffectDurationV14,
  normalizeActiveEffectDurationV14,
  isFiniteDuration,
  isIndefiniteDuration,
  extendEffectDurationByCanonicalPeriod,
  SPELL_EFFECT_DURATION_FLAG_KEY
} from "../../active-effects/effect-duration-v14.js";
import { resolveSpellProfile } from "../spell-profile.js";
import { _num, _str } from "../_primitives.js";

function _castLevelFromOptions({ spellOptions = null, scalingChoices = null, castContext = null } = {}) {
  const raw = castContext?.castLevel
    ?? spellOptions?.castLevel
    ?? spellOptions?.level
    ?? scalingChoices?.level
    ?? null;
  const level = Number(raw);
  return Number.isFinite(level) && level > 0 ? level : null;
}

function _normalizeUnit(unit) {
  const normalized = _str(unit || "seconds").toLowerCase();
  if (normalized === "second") return "seconds";
  if (normalized === "minute") return "minutes";
  if (normalized === "hour") return "hours";
  if (normalized === "day") return "days";
  if (normalized === "round") return "rounds";
  if (normalized === "turn") return "turns";
  if (normalized === "month") return "months";
  if (normalized === "year") return "years";
  return normalized;
}

function _sourceEffectHasPositiveDuration(sourceEffect) {
  const duration = sourceEffect?.duration ?? {};
  return Number(duration.value) > 0
    || Number(duration.seconds) > 0
    || Number(duration.rounds) > 0
    || Number(duration.turns) > 0;
}

export function resolveCastSpellDuration(spell, casterActor, { spellOptions = null, scalingChoices = null, castContext = null } = {}) {
  const level = _castLevelFromOptions({ spellOptions, scalingChoices, castContext });
  let duration = null;
  try {
    duration = resolveSpellProfile(spell, casterActor, { level })?.duration ?? null;
  } catch (_err) {
    duration = spell?.system?.duration ?? null;
  }

  const normalized = normalizeActiveEffectDurationV14({
    value: duration?.value,
    units: duration?.units ?? duration?.unit,
    expiry: duration?.expiry
  });
  return {
    value: normalized.value,
    unit: normalized.units,
    units: normalized.units,
    expiry: normalized.expiry,
    isInstant: isIndefiniteDuration(normalized),
    isPermanent: _normalizeUnit(duration?.unit ?? duration?.units) === "permanent",
    isFinite: isFiniteDuration(normalized)
  };
}

export function hasSourceEffectDurationOverride(sourceEffect) {
  return _sourceEffectHasPositiveDuration(sourceEffect);
}

export function buildSpellActiveEffectDuration({
  actor = null,
  casterActor = null,
  spell = null,
  sourceEffect = null,
  spellOptions = null,
  scalingChoices = null,
  castContext = null,
  hasUpkeep = false,
  forcedDuration = null
} = {}) {
  let resolvedDuration = null;
  const castLevel = _castLevelFromOptions({ spellOptions, scalingChoices, castContext });
  if (!forcedDuration) {
    try {
      resolvedDuration = resolveSpellProfile(spell, casterActor ?? actor, { level: castLevel })?.duration ?? null;
    } catch (_err) {
      resolvedDuration = spell?.system?.duration ?? null;
    }
  }
  return buildSpellEffectDurationV14(spell, casterActor ?? actor, {
    actor,
    sourceEffect,
    spellOptions,
    scalingChoices,
    castContext,
    hasUpkeep,
    forcedDuration,
    resolvedDuration
  });
}

export function buildSpellActiveEffectDurationFromValues({
  value = null,
  unit = null,
  units = null,
  expiry = null,
  seconds = 0,
  rounds = 0,
  turns = 0,
  hasUpkeep = false
} = {}) {
  let input = { value, units: units ?? unit, expiry };
  if (!(Number(input.value) > 0)) {
    if (_num(rounds, 0) > 0) input = { value: _num(rounds, 0), units: "rounds", expiry: "turnEnd" };
    else if (_num(turns, 0) > 0) input = { value: _num(turns, 0), units: "turns", expiry: "turnEnd" };
    else if (_num(seconds, 0) > 0) input = { value: _num(seconds, 0), units: "seconds", expiry: null };
  }

  let duration = normalizeActiveEffectDurationV14(input);
  const noListedDuration = isIndefiniteDuration(duration);
  if (hasUpkeep && noListedDuration) {
    duration = normalizeActiveEffectDurationV14({ value: 1, units: "rounds", expiry: "turnEnd" });
  }

  return {
    canonicalDuration: globalThis.foundry?.utils?.deepClone ? foundry.utils.deepClone(duration) : JSON.parse(JSON.stringify(duration)),
    liveDuration: globalThis.foundry?.utils?.deepClone ? foundry.utils.deepClone(duration) : JSON.parse(JSON.stringify(duration)),
    spellEffectDuration: {
      value: duration.value,
      units: duration.units,
      expiry: duration.expiry,
      source: "legacy-values",
      noListedDuration
    },
    noListedDuration
  };
}

export {
  extendEffectDurationByCanonicalPeriod,
  isFiniteDuration,
  isIndefiniteDuration,
  SPELL_EFFECT_DURATION_FLAG_KEY
};
