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

function _isMeleeWeapon(item) {
  if (!item || item.type !== "weapon") return false;
  return String(item?.system?.attackMode ?? "melee").toLowerCase() === "melee";
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

/**
 * Returns effective reach bounds for a weapon, respecting the Reach & Length Overhaul
 * homebrew settings and per-weapon flag overrides.
 *
 * @param {Item} weapon
 * @returns {{ min: number, max: number, source: "homebrew-classic"|"homebrew-simplified"|"system" }}
 */
export function getWeaponReachBoundsEffective(weapon) {
  const sys = weapon?.system ?? {};

  const _parseHeaderReachMin = (raw) => {
    const n = Number(raw);
    return (Number.isFinite(n) && n >= 0) ? n : 0;
  };

  const _parseReachMaxOrMissing = (raw) => {
    const s = String(raw ?? "").trim().toLowerCase();
    if (!s || s === "x") return null;
    const n = Number(raw);
    // Header max reach: treat 0 and non-numeric as missing so melee fallback can apply.
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  };

  const _getStructuredReachFallbackMax = (item) => {
    const source = Array.isArray(item?.system?.qualitiesStructuredInjected)
      ? item.system.qualitiesStructuredInjected
      : (Array.isArray(item?.system?.qualitiesStructured) ? item.system.qualitiesStructured : []);
    let best = null;
    for (const q of source) {
      const key = String(q?.key ?? q ?? "").trim().toLowerCase();
      if (key !== "reach") continue;
      const n = Number(q?.value);
      if (!Number.isFinite(n) || n <= 0) continue;
      best = best == null ? n : Math.max(best, n);
    }
    return best;
  };

  const sysMin = _parseHeaderReachMin(sys.reachMin);
  const headerMax = _parseReachMaxOrMissing(sys.reach);
  const meleeStructuredFallbackMax = _isMeleeWeapon(weapon) ? _getStructuredReachFallbackMax(weapon) : null;
  const systemMax = (headerMax ?? meleeStructuredFallbackMax ?? 0);
  const systemResult = { min: sysMin, max: systemMax, source: "system" };

  if (!isReachLengthHomebrewEnabled()) return systemResult;

  const model = getReachLengthModel();
  const flags = weapon?.flags?.[NAMESPACE]?.homebrew?.reachLength ?? {};

  if (model === "classic") {
    const classicFlags = flags?.classic ?? {};
    const hbMin = Number(classicFlags?.min);
    const hbMax = _parseReachMaxOrMissing(classicFlags?.max);
    const min = Number.isFinite(hbMin) ? hbMin : sysMin;
    const max = hbMax ?? systemMax;
    return { min, max, source: "homebrew-classic" };
  }

  if (model === "simplified") {
    const simpFlags = flags?.simplified ?? {};
    const hbMin = Number(simpFlags?.min);
    const hbMax = _parseReachMaxOrMissing(simpFlags?.max);
    // Simplified default: min = 0 (no too-close gating), max falls back to system reach
    const min = Number.isFinite(hbMin) ? hbMin : 0;
    const max = hbMax ?? systemMax;
    return { min, max, source: "homebrew-simplified" };
  }

  // Unknown model - fall back to system
  return systemResult;
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
