import { getSpellLevel, resolveSpellStrengthFormulaForActor } from "../magicka-utils.js";
import { evaluateNumericExpression } from "../../../utils/numeric-expression.js";
import { resolveActorFromUuidSync } from "../../../utils/uuid-cache.js";
import { getActorWillpowerBonus } from "../magicka-utils.js";

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function resolveNumericSpellStrength(spell, castLevel = null, actor = null) {
  const formula = String(resolveSpellStrengthFormulaForActor(spell, castLevel, actor) || "").trim();
  if (!formula) return null;

  const directValue = Number(formula);
  if (Number.isFinite(directValue) && directValue > 0) return Math.floor(directValue);

  const evaluatedValue = evaluateNumericExpression(formula);
  return Number.isFinite(evaluatedValue) && evaluatedValue > 0 ? Math.floor(evaluatedValue) : null;
}

function _resolveCastActor(attacker = {}, options = {}) {
  if (options?.actor) return options.actor;
  if (attacker?.actor) return attacker.actor;
  const actorUuid = String(attacker?.actorUuid ?? attacker?.casterUuid ?? "").trim();
  if (!actorUuid) return null;
  return resolveActorFromUuidSync(actorUuid);
}

function _resolveSpellStrengthFormula(spell, castLevel, actor) {
  const rawFormula = String(resolveSpellStrengthFormulaForActor(spell, castLevel, actor) || "").trim();
  if (rawFormula) return rawFormula;
  const wb = Number(getActorWillpowerBonus(actor) ?? 0) || 0;
  return String(Math.max(0, Math.floor(wb)));
}

function _resolveSpellStrengthValue(spell, castLevel, actor) {
  const formula = _resolveSpellStrengthFormula(spell, castLevel, actor);
  const directValue = Number(formula);
  if (Number.isFinite(directValue) && directValue > 0) return Math.floor(directValue);

  const wb = Number(getActorWillpowerBonus(actor) ?? 0) || 0;
  const resolvedFormula = formula
    .replace(/\bWPB\b/gi, String(wb))
    .replace(/\bWB\b/gi, String(wb))
    .replace(/\bWillpower Bonus\b/gi, String(wb));

  const evaluatedValue = evaluateNumericExpression(resolvedFormula);
  return Number.isFinite(evaluatedValue) && evaluatedValue > 0 ? Math.floor(evaluatedValue) : null;
}

export function buildMagicCastContext(attacker = {}, spell = null, options = {}) {
  const existingSpellStrengthValue = Number(attacker?.castContext?.spellStrengthValue ?? attacker?.spellStrengthValue);
  if (Number.isFinite(existingSpellStrengthValue) && existingSpellStrengthValue > 0) {
    const baseLevelExisting = toPositiveInt(attacker?.castContext?.baseLevel ?? attacker?.spellLevel ?? getSpellLevel(spell)) ?? 1;
    const castLevelExisting = toPositiveInt(attacker?.castContext?.castLevel ?? attacker?.spellOptions?.castLevel ?? attacker?.scalingChoices?.level) ?? baseLevelExisting;
    return {
      baseLevel: baseLevelExisting,
      castLevel: castLevelExisting,
      hasHigherCastLevel: castLevelExisting !== baseLevelExisting,
      spellStrengthValue: Math.floor(existingSpellStrengthValue),
    };
  }

  const baseLevel = toPositiveInt(attacker?.spellLevel ?? getSpellLevel(spell)) ?? 1;
  const castLevel = toPositiveInt(attacker?.castContext?.castLevel ?? attacker?.spellOptions?.castLevel ?? attacker?.scalingChoices?.level) ?? baseLevel;
  const actor = _resolveCastActor(attacker, options);
  const spellStrengthValue = _resolveSpellStrengthValue(spell, castLevel, actor);

  return {
    baseLevel,
    castLevel,
    hasHigherCastLevel: castLevel !== baseLevel,
    spellStrengthValue,
  };
}

export function buildMagicCastContextRows(attacker = {}, spell = null, options = {}) {
  const castContext = buildMagicCastContext(attacker, spell, options);
  const rows = [];

  if (castContext.hasHigherCastLevel) {
    rows.push({ label: "Cast at Level", value: String(castContext.castLevel) });
  }
  if (castContext.spellStrengthValue != null) {
    rows.push({ label: "Spell Strength", value: String(castContext.spellStrengthValue) });
  }

  return { ...castContext, rows };
}
