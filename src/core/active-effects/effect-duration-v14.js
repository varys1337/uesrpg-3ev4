import { FLAG_SCOPE } from "../system/namespace.js";

const DURATION_FLAG_KEY = "spellEffectDuration";
const ROUND_EXPIRY = "turnEnd";

const UNIT_ALIASES = Object.freeze({
  second: "seconds",
  seconds: "seconds",
  minute: "minutes",
  minutes: "minutes",
  hour: "hours",
  hours: "hours",
  day: "days",
  days: "days",
  round: "rounds",
  rounds: "rounds",
  turn: "turns",
  turns: "turns",
  month: "months",
  months: "months",
  year: "years",
  years: "years",
  permanent: "permanent",
  indefinite: "permanent",
  instant: "instant"
});

const FINITE_UNITS = new Set(["seconds", "minutes", "hours", "days", "rounds", "turns", "months", "years"]);

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _str(value) {
  return String(value ?? "").trim();
}

function _clone(value) {
  return globalThis.foundry?.utils?.deepClone ? foundry.utils.deepClone(value) : JSON.parse(JSON.stringify(value ?? null));
}

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
  const key = _str(unit || "seconds").toLowerCase();
  return UNIT_ALIASES[key] ?? "seconds";
}

function _durationFromLegacyShape(source = {}) {
  const seconds = _num(source.seconds, 0);
  const rounds = _num(source.rounds, 0);
  const turns = _num(source.turns, 0);
  if (rounds > 0) return { value: rounds, units: "rounds", expiry: ROUND_EXPIRY };
  if (turns > 0) return { value: turns, units: "turns", expiry: ROUND_EXPIRY };
  if (seconds > 0) return { value: seconds, units: "seconds", expiry: null };
  return null;
}

function _indefiniteDuration() {
  return { value: null, units: "seconds", expiry: null };
}

export function getCanonicalDurationFlagPath() {
  return `flags.${FLAG_SCOPE}.${DURATION_FLAG_KEY}`;
}

export function isIndefiniteDuration(duration) {
  return duration?.value == null && duration?.expiry == null;
}

export function isFiniteDuration(duration) {
  const value = Number(duration?.value);
  return Number.isFinite(value) && value > 0 && FINITE_UNITS.has(_normalizeUnit(duration?.units));
}

export function normalizeActiveEffectDurationV14(input = {}, { defaultExpiry = null } = {}) {
  const legacy = _durationFromLegacyShape(input);
  if (legacy) return legacy;

  const unit = _normalizeUnit(input.units ?? input.unit);
  const value = _num(input.value, 0);
  if (unit === "instant" || value <= 0) return _indefiniteDuration();
  if (unit === "permanent") return _indefiniteDuration();

  const units = FINITE_UNITS.has(unit) ? unit : "seconds";
  const expiry = input.expiry ?? (units === "rounds" || units === "turns" ? (defaultExpiry ?? ROUND_EXPIRY) : null);
  return { value, units, expiry };
}

export async function resolveSpellDurationSourceV14(spell, casterActor, {
  spellOptions = null,
  scalingChoices = null,
  castContext = null,
  forcedDuration = null
} = {}) {
  if (forcedDuration) return { duration: forcedDuration, castLevel: _castLevelFromOptions({ spellOptions, scalingChoices, castContext }) };
  const castLevel = _castLevelFromOptions({ spellOptions, scalingChoices, castContext });
  try {
    const { resolveSpellProfile } = await import("../magic/spell-profile.js");
    return {
      duration: resolveSpellProfile(spell, casterActor, { level: castLevel })?.duration ?? spell?.system?.duration ?? null,
      castLevel
    };
  } catch (_err) {
    return { duration: spell?.system?.duration ?? null, castLevel };
  }
}

export function buildSpellEffectDurationV14(spell, casterActor, {
  actor = null,
  sourceEffect = null,
  spellOptions = null,
  scalingChoices = null,
  castContext = null,
  hasUpkeep = false,
  forcedDuration = null,
  resolvedDuration = null,
  defaultExpiry = ROUND_EXPIRY
} = {}) {
  const castLevel = _castLevelFromOptions({ spellOptions, scalingChoices, castContext });
  const rawDuration = forcedDuration ?? resolvedDuration ?? spell?.system?.duration ?? null;

  let liveDuration = normalizeActiveEffectDurationV14(rawDuration ?? {}, { defaultExpiry });
  const noListedDuration = isIndefiniteDuration(liveDuration);
  if (hasUpkeep && noListedDuration) {
    liveDuration = normalizeActiveEffectDurationV14({ value: 1, units: "rounds", expiry: defaultExpiry }, { defaultExpiry });
  }

  const sourceDuration = sourceEffect?.duration
    ? normalizeActiveEffectDurationV14(sourceEffect.duration, { defaultExpiry })
    : null;

  const canonicalDuration = {
    value: liveDuration.value,
    units: liveDuration.units,
    expiry: liveDuration.expiry,
    source: forcedDuration ? "forced" : "spell-casting",
    castLevel,
    spellUuid: spell?.uuid ?? null,
    spellName: spell?.name ?? null,
    noListedDuration,
    sourceEffectDuration: sourceDuration && !isIndefiniteDuration(sourceDuration) ? sourceDuration : null,
    createdAtWorldTime: _num(globalThis.game?.time?.worldTime, 0)
  };

  return {
    liveDuration: _clone(liveDuration),
    canonicalDuration: _clone(liveDuration),
    spellEffectDuration: canonicalDuration,
    noListedDuration,
    castLevel
  };
}

export function extendEffectDurationByCanonicalPeriod(effect, canonicalDuration = null) {
  const period = canonicalDuration ?? effect?.flags?.[FLAG_SCOPE]?.[DURATION_FLAG_KEY] ?? null;
  const normalized = normalizeActiveEffectDurationV14(period ?? {});
  if (!isFiniteDuration(normalized)) return null;

  const current = normalizeActiveEffectDurationV14(effect?.duration ?? normalized);
  const currentValue = isFiniteDuration(current) && current.units === normalized.units
    ? _num(current.value, 0)
    : 0;
  return {
    "duration.value": currentValue + _num(normalized.value, 0),
    "duration.units": normalized.units,
    "duration.expiry": normalized.expiry ?? null
  };
}

export { DURATION_FLAG_KEY as SPELL_EFFECT_DURATION_FLAG_KEY };
