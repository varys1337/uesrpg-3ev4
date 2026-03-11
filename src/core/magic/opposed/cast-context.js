import { getSpellDamageFormula } from "../magicka-utils.js";

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function resolveNumericSpellStrength(spell, castLevel = null) {
  const formula = String(getSpellDamageFormula(spell, castLevel) || spell?.system?.spell_str || spell?.system?.damage || "").trim();
  const value = Number(formula);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export function buildMagicCastContext(attacker = {}, spell = null) {
  const baseLevel = toPositiveInt(attacker?.spellLevel ?? spell?.system?.level) ?? 1;
  const castLevel = toPositiveInt(attacker?.spellOptions?.castLevel) ?? baseLevel;
  const spellStrengthValue = resolveNumericSpellStrength(spell, castLevel);

  return {
    baseLevel,
    castLevel,
    hasHigherCastLevel: castLevel !== baseLevel,
    spellStrengthValue,
  };
}

export function buildMagicCastContextRows(attacker = {}, spell = null) {
  const castContext = buildMagicCastContext(attacker, spell);
  const rows = [];

  if (castContext.hasHigherCastLevel) {
    rows.push({ label: "Cast at Level", value: String(castContext.castLevel) });
  }
  if (castContext.spellStrengthValue != null) {
    rows.push({ label: "Spell Strength", value: String(castContext.spellStrengthValue) });
  }

  return { ...castContext, rows };
}
