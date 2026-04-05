/**
 * src/core/homebrew/reach-length/weapon.js
 *
 * Shared resolver for the Harnmaster-inspired Reach & Length Overhaul homebrew.
 *
 * All functions are pure (no side effects) and safe to call at any lifecycle phase.
 * Used by:
 *  - src/core/combat/opposed/helpers/combat.js  (melee reach legality)
 *  - src/ui/canvas/reach-visualizer-weapons.js  (reach ring visualizer)
 *  - src/ui/sheets/item/prepare.js              (weapon sheet effective reach display)
 *  - src/core/combat/opposed/actions/defender-commit.js (Length Penalty TN injection)
 */

import {
  isReachLengthHomebrewEnabled,
  getReachLengthModel,
  isReachLengthAttackerAdvantageOnlyEnabled
} from "../../system/homebrew.js";
import { hasCondition } from "../../conditions/condition-engine.js";
import { createDebugLogger, createSeverityDebugLogger } from "../../../utils/debug.js";

export { isReachLengthHomebrewEnabled, getReachLengthModel };

const NAMESPACE = "uesrpg-3ev4";

function _resolveWeaponContext(weaponOrData, { attackMode = null } = {}) {
  const system = weaponOrData?.system ?? {};
  const flags = weaponOrData?.flags ?? {};
  const type = String(weaponOrData?.type ?? "weapon").trim().toLowerCase();
  const mode = String(attackMode ?? system?.attackMode ?? weaponOrData?.attackMode ?? "melee").trim().toLowerCase();
  return { type, system, flags, attackMode: mode };
}

function _isMeleeWeapon(weaponOrData, { attackMode = null } = {}) {
  const ctx = _resolveWeaponContext(weaponOrData, { attackMode });
  return ctx.type === "weapon" && ctx.attackMode === "melee";
}

function _parsePositiveReach(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text || text === "x") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function _getStructuredReachFallbackMaxFromList(source) {
  if (!Array.isArray(source)) return null;
  let best = null;
  for (const quality of source) {
    const key = String(quality?.key ?? quality ?? "").trim().toLowerCase();
    if (key !== "reach") continue;
    const value = _parsePositiveReach(quality?.value);
    if (value == null) continue;
    best = best == null ? value : Math.max(best, value);
  }
  return best;
}

function _resolveOwnerActor({ ownerActor, ownerToken, ownWeapon } = {}) {
  if (ownerActor) return ownerActor;
  if (ownerToken?.actor) return ownerToken.actor;
  if (ownWeapon?.parent?.documentName === "Actor") return ownWeapon.parent;
  return null;
}

function _resolveInCloseState({ ownerToken, opponentToken, ownerActor } = {}) {
  const hasPairContext = Boolean(ownerToken?.document && opponentToken?.document?.uuid);
  const icMap = hasPairContext
    ? (ownerToken.document.getFlag(NAMESPACE, "reachLength.inCloseWith") ?? {})
    : null;
  const pairFlag = hasPairContext ? Boolean(icMap?.[opponentToken.document.uuid]) : false;
  const actorEffect = Boolean(ownerActor && hasCondition(ownerActor, "inclose"));
  const inClose = pairFlag || actorEffect;
  const source = pairFlag ? "pairFlag" : (actorEffect ? "actorEffect" : "none");
  return { inClose, source };
}

const _debugLengthTN = createDebugLogger("opposedDebug", "UESRPG | Length TN");
const _warnLengthTN = createSeverityDebugLogger("opposedDebug", "UESRPG | Length TN |", "warn");

/**
 * Returns the weapon's explicit Length (LNG) value from homebrew flags.
 * Returns 0 if not set or if the homebrew is disabled.
 *
 * @param {Item} weapon
 * @returns {number}
 */
export function getWeaponLength(weapon) {
  if (!weapon) return 0;
  const val = weapon?.flags?.[NAMESPACE]?.homebrew?.reachLength?.length;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function parseWeaponReachMin(raw) {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function parseWeaponReachMax(raw) {
  return _parsePositiveReach(raw);
}

export function getLegacyStructuredWeaponReach(system = {}) {
  const manual = _getStructuredReachFallbackMaxFromList(system?.qualitiesStructured);
  if (manual != null) return manual;
  return _getStructuredReachFallbackMaxFromList(system?.qualitiesStructuredInjected);
}

export function getHomebrewWeaponReachOverrides(flags = {}, { model = getReachLengthModel() } = {}) {
  const reachLength = flags?.[NAMESPACE]?.homebrew?.reachLength ?? {};
  const branch = reachLength?.[model] ?? {};
  const length = Number(reachLength?.length);
  return {
    length: Number.isFinite(length) && length > 0 ? length : 0,
    min: branch?.min === undefined || branch?.min === null || branch?.min === "" ? null : parseWeaponReachMin(branch.min),
    max: parseWeaponReachMax(branch?.max),
  };
}

export function getWeaponBaseReachState(weaponOrData, { attackMode = null, includeLegacyFallback = true } = {}) {
  const ctx = _resolveWeaponContext(weaponOrData, { attackMode });
  if (ctx.type !== "weapon" || ctx.attackMode !== "melee") {
    return { min: 0, max: 0, source: "none" };
  }

  const min = parseWeaponReachMin(ctx.system?.reachMin);
  const persisted = parseWeaponReachMax(ctx.system?.reach);
  if (persisted != null) {
    return { min, max: persisted, source: "system" };
  }

  if (!includeLegacyFallback) {
    return { min, max: 0, source: "none" };
  }

  const legacy = getLegacyStructuredWeaponReach(ctx.system);
  if (legacy != null) {
    return { min, max: legacy, source: "legacyStructured" };
  }

  return { min, max: 0, source: "none" };
}

export function resolveWeaponReachValue({
  system = {},
  flags = {},
  attackMode = null,
  includeLegacyFallback = true,
  includeHomebrewFallback = true,
  model = getReachLengthModel(),
} = {}) {
  const base = getWeaponBaseReachState({ type: "weapon", system, flags, attackMode }, {
    attackMode,
    includeLegacyFallback,
  });
  if (base.max > 0) return { value: base.max, source: base.source };
  if (!includeHomebrewFallback) return { value: null, source: "none" };

  const overrides = getHomebrewWeaponReachOverrides(flags, { model });
  if (overrides.max != null) return { value: overrides.max, source: "homebrew" };
  return { value: null, source: "none" };
}

/**
 * Returns effective reach bounds for a weapon, respecting the Reach & Length Overhaul
 * homebrew settings and per-weapon flag overrides.
 *
 * @param {Item} weapon
 * @returns {{ min: number, max: number, source: "homebrew-classic"|"homebrew-simplified"|"system"|"legacyStructured"|"none" }}
 */
export function getWeaponReachBoundsEffective(weaponOrData) {
  const ctx = _resolveWeaponContext(weaponOrData);
  const base = getWeaponBaseReachState(ctx, { includeLegacyFallback: true });
  if (ctx.type !== "weapon" || ctx.attackMode !== "melee") return base;
  if (!isReachLengthHomebrewEnabled()) return base;

  const model = getReachLengthModel();
  const overrides = getHomebrewWeaponReachOverrides(ctx.flags, { model });
  const hasOverride = overrides.min != null || overrides.max != null;

  if (model === "classic") {
    return {
      min: overrides.min ?? base.min,
      max: overrides.max ?? base.max,
      source: hasOverride ? "homebrew-classic" : base.source,
    };
  }

  if (model === "simplified") {
    return {
      min: overrides.min ?? 0,
      max: overrides.max ?? base.max,
      source: hasOverride ? "homebrew-simplified" : base.source,
    };
  }

  // Unknown model - fall back to system
  return base;
}

/**
 * Inject the Homebrew Length Penalty into a combatant's TN breakdown.
 *
 * The function determines from the caller's perspective ("own" side) whether this
 * side suffers the penalty, then mutates `tn` in-place if so.
 *
 * Rules:
 *  - Both weapons must be melee and have explicit LNG values (> 0).
 *  - Outside In Close: longer weapon = +deltaL*5 bonus; shorter weapon = -deltaL*5 penalty.
 *  - In Close: shorter weapon = +deltaL*5 bonus; longer weapon = -deltaL*5 penalty.
 *  - The signed modifier is applied from the caller's own-side perspective.
 *  - Called separately for attacker and defender; each receives their correct sign.
 *  - When attacker-only mode is enabled, defender-side Length modifiers are fully suppressed.
 *
 * In Close detection:
 *  - Primary: pairwise `inCloseWith` token flags.
 *  - Fallback: acting-side actor condition `inclose`.
 *  - Effective logic: pair flag OR actor condition.
 *
 * @param {object} params
 * @param {object}     params.tn              - TN breakdown object (mutated in place)
 * @param {Item|null}  params.ownWeapon       - This side's weapon item
 * @param {Item|null}  params.opponentWeapon  - Opponent's weapon item
 * @param {Token|null} params.ownerToken      - This side's token placeable
 * @param {Token|null} params.opponentToken   - Opponent's token placeable
 * @param {Actor|null} params.ownerActor      - This side's actor fallback for In Close state
 * @param {"attacker"|"defender"|null} params.ownRole - This side's combat role for attacker-only advantage mode
 * @returns {boolean} true if the penalty was applied, false otherwise
 */
export function applyLengthPenaltyToTN({
  tn,
  ownWeapon,
  opponentWeapon,
  ownerToken,
  opponentToken,
  ownerActor,
  ownRole = null
} = {}) {
  try {
    if (!isReachLengthHomebrewEnabled()) return false;
    if (!tn || !ownWeapon || !opponentWeapon) return false;
    if (!_isMeleeWeapon(ownWeapon) || !_isMeleeWeapon(opponentWeapon)) return false;

    const Lown = getWeaponLength(ownWeapon);
    const Lopp = getWeaponLength(opponentWeapon);

    if (!Lown || !Lopp) {
      _warnLengthTN("skipped due to missing/invalid weapon length", {
        ownLength: Lown,
        opponentLength: Lopp
      });
      _debugLengthTN({
        applied: false,
        reason: "missingLength",
        ownLength: Lown,
        opponentLength: Lopp
      });
      return false;
    }

    const delta = Math.abs(Lown - Lopp);
    if (!delta) return false;

    const LP = delta * 5;
    const actorForFallback = _resolveOwnerActor({ ownerActor, ownerToken, ownWeapon });
    const { inClose, source } = _resolveInCloseState({
      ownerToken,
      opponentToken,
      ownerActor: actorForFallback
    });

    const ownLonger = Lown > Lopp;
    const ownAdvantaged = inClose ? !ownLonger : ownLonger;
    let modifier = ownAdvantaged ? +LP : -LP;

    if (
      isReachLengthAttackerAdvantageOnlyEnabled()
      && String(ownRole ?? "").toLowerCase() === "defender"
    ) {
      _debugLengthTN({
        applied: false,
        reason: "attackerOnlyDefenderSuppressed",
        ownLength: Lown,
        opponentLength: Lopp,
        lengthDelta: delta,
        inClose,
        inCloseSource: source,
        ownRole,
        modifier
      });
      return false;
    }

    const label = modifier > 0
      ? `Length Adv.${inClose ? " (In Close)" : ""}`
      : `Length Pen.${inClose ? " (In Close)" : ""}`;

    tn.breakdown = tn.breakdown ?? [];
    tn.breakdown.push({ key: "homebrew:lengthModifier", label, value: modifier, source: "homebrew" });
    tn.totalMod = (tn.totalMod ?? 0) + modifier;
    tn.finalTN = (tn.finalTN ?? tn.baseTN ?? 0) + modifier;

    _debugLengthTN({
      applied: true,
      ownLength: Lown,
      opponentLength: Lopp,
      lengthDelta: delta,
      inClose,
      inCloseSource: source,
      modifier
    });

    return true;
  } catch (err) {
    console.warn("UESRPG | applyLengthPenaltyToTN failed", err);
    return false;
  }
}
