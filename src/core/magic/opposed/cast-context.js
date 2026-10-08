import { getSpellScalingLevels, getSpellLevel, getSpellStrengthFormula, getSpellStrengthDamageComponents, resolveSpellStrengthFormulaForActor, getActorWillpowerBonus } from "../magicka-utils.js";
import { emitSuppressedSubRollDice } from "../../../utils/dice-visualization.js";
import { evaluateNumericExpression } from "../../../utils/numeric-expression.js";
import { resolveActorFromUuidSync } from "../../../utils/uuid-cache.js";

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function strengthValue(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function resolveNumericSpellStrength(spell, castLevel = null, actor = null) {
  const formula = String(resolveSpellStrengthFormulaForActor(spell, castLevel, actor) || "").trim();
  if (!formula) return null;

  const directValue = Number(formula);
  if (formula && Number.isFinite(directValue) && directValue >= 0) return Math.floor(directValue);

  const evaluatedValue = evaluateNumericExpression(formula);
  return strengthValue(evaluatedValue);
}

function _resolveCastActor(attacker = {}, options = {}) {
  if (options?.actor) return options.actor;
  if (attacker?.actor) return attacker.actor;
  const actorUuid = String(attacker?.actorUuid ?? attacker?.casterUuid ?? "").trim();
  if (!actorUuid) return null;
  return resolveActorFromUuidSync(actorUuid);
}

function _resolveSpellStrengthFormula(spell, castLevel, actor, scalingLevels = null) {
  const levels = scalingLevels ?? getSpellScalingLevels(spell);
  const rawFormula = String(resolveSpellStrengthFormulaForActor(spell, castLevel, actor, levels) || "").trim();
  if (rawFormula) return rawFormula;
  if (String(getSpellStrengthFormula(spell, castLevel, levels) ?? "").trim()) return "";
  const wb = Number(getActorWillpowerBonus(actor) ?? 0) || 0;
  return String(Math.max(0, Math.floor(wb)));
}

function _resolveSpellStrengthValue(spell, castLevel, actor, scalingLevels = null) {
  const formula = _resolveSpellStrengthFormula(spell, castLevel, actor, scalingLevels);
  if (!formula) return null;
  const directValue = Number(formula);
  if (Number.isFinite(directValue) && directValue >= 0) return Math.floor(directValue);

  const wb = Number(getActorWillpowerBonus(actor) ?? 0) || 0;
  const resolvedFormula = formula
    .replace(/\bWPB\b/gi, String(wb))
    .replace(/\bWB\b/gi, String(wb))
    .replace(/\bWillpower Bonus\b/gi, String(wb));

  const evaluatedValue = evaluateNumericExpression(resolvedFormula);
  return strengthValue(evaluatedValue);
}

export function buildMagicCastContext(attacker = {}, spell = null, options = {}) {
  const existingSpellStrengthValue = strengthValue(attacker?.castContext?.spellStrengthValue ?? attacker?.spellStrengthValue);
  if (existingSpellStrengthValue !== null) {
    const baseLevelExisting = toPositiveInt(attacker?.castContext?.baseLevel ?? attacker?.spellLevel ?? getSpellLevel(spell)) ?? 1;
    const castLevelExisting = toPositiveInt(attacker?.castContext?.castLevel ?? attacker?.spellOptions?.castLevel ?? attacker?.scalingChoices?.level) ?? baseLevelExisting;
    return {
      ...attacker?.castContext,
      baseLevel: baseLevelExisting,
      castLevel: castLevelExisting,
      hasHigherCastLevel: castLevelExisting !== baseLevelExisting,
      spellStrengthValue: Math.floor(existingSpellStrengthValue),
    };
  }

  const scalingLevels = getSpellScalingLevels(spell);
  const baseLevel = toPositiveInt(attacker?.spellLevel ?? getSpellLevel(spell, scalingLevels)) ?? 1;
  const castLevel = toPositiveInt(attacker?.castContext?.castLevel ?? attacker?.spellOptions?.castLevel ?? attacker?.scalingChoices?.level) ?? baseLevel;
  const actor = _resolveCastActor(attacker, options) ?? spell?.actor ?? null;
  const spellStrengthValue = _resolveSpellStrengthValue(spell, castLevel, actor, scalingLevels);

  return {
    baseLevel,
    castLevel,
    hasHigherCastLevel: castLevel !== baseLevel,
    spellStrengthValue,
  };
}

/** Keep raw strength separate from bonuses/mitigation, using the actual rolls. */
export function recordSpellStrengthRolls(attacker, spell, { rolls = [], selectedRolls = rolls, actor = null, castLevel = null } = {}) {
  const context = buildMagicCastContext(attacker, spell, { actor });
  if (castLevel != null) context.castLevel = Number(castLevel);
  const total = selectedRolls.reduce((sum, roll) => sum + Number(roll.total), 0);
  if (!Number.isFinite(total)) throw new Error(`Invalid Spell Strength result for ${spell?.name ?? "spell"}.`);
  return {
    ...context,
    spellStrengthValue: Math.max(0, Math.floor(total)),
    spellStrengthFormula: _resolveSpellStrengthFormula(spell, context.castLevel, actor),
    spellStrengthRolls: rolls.map((roll) => roll.toJSON()),
    spellStrengthSelectedRolls: selectedRolls.map((roll) => roll.toJSON()),
    spellStrengthResolved: true,
  };
}

/** Resolve only at a mechanical boundary. Rendering and preparation stay pure.
 * Existing contexts (including zero) are authoritative and never re-animated.
 */
export async function resolveMagicCastContext(attacker = {}, spell = null, options = {}) {
  const context = buildMagicCastContext(attacker, spell, options);
  // Saved outcomes remain authoritative even if the item is edited afterward.
  const actor = _resolveCastActor(attacker, options) ?? spell?.actor ?? null;
  if (strengthValue(attacker?.castContext?.spellStrengthValue ?? attacker?.spellStrengthValue) !== null) {
    return { ...context, spellStrengthFormula: context.spellStrengthFormula ?? _resolveSpellStrengthFormula(spell, context.castLevel, actor),
      spellStrengthResolved: true, spellStrengthRolls: context.spellStrengthRolls ?? [],
      spellStrengthSelectedRolls: context.spellStrengthSelectedRolls ?? [] };
  }
  const formula = _resolveSpellStrengthFormula(spell, context.castLevel, actor);
  const components = getSpellStrengthDamageComponents(spell, { actor, level: context.castLevel, strengthOnly: true, validate: true });
  if (strengthValue(context.spellStrengthValue) !== null) {
    return { ...context, spellStrengthFormula: formula, spellStrengthResolved: true,
      spellStrengthRolls: [], spellStrengthSelectedRolls: [] };
  }
  const rolls = [];
  try {
    for (const component of components.length ? components : [{ formula }]) {
      rolls.push(await Roll.create(component.formula, { actorId: actor?.id }, { type: component.damageType }).evaluate());
    }
  } catch (error) {
    ui.notifications.error(`Cannot resolve Spell Strength for ${spell?.name ?? "spell"}: ${error.message}`);
    throw error;
  }
  const resolved = recordSpellStrengthRolls({ ...attacker, castContext: context }, spell, { rolls, actor });
  for (const [index, roll] of rolls.entries()) {
    void emitSuppressedSubRollDice(roll, { actor, message: options.message, parentMessageId: options.parentMessageId, user: options.user, damageType: components[index]?.damageType ?? options.damageType });
  }
  return resolved;
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
