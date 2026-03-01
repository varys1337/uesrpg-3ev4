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

import { isReachLengthHomebrewEnabled, getReachLengthModel } from "../../system/homebrew.js";

export { isReachLengthHomebrewEnabled, getReachLengthModel };

const NAMESPACE = "uesrpg-3ev4";
const HOMEBREW_FLAG_PATH = "homebrew.reachLength";

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
  const sysMin = Number.isFinite(Number(sys.reachMin)) ? Number(sys.reachMin) : 0;
  const sysMax = Number.isFinite(Number(sys.reach)) ? Number(sys.reach) : 0;
  const systemResult = { min: sysMin, max: sysMax, source: "system" };

  if (!isReachLengthHomebrewEnabled()) return systemResult;

  const model = getReachLengthModel();
  const flags = weapon?.flags?.[NAMESPACE]?.homebrew?.reachLength ?? {};

  if (model === "classic") {
    const classicFlags = flags?.classic ?? {};
    const hbMin = Number(classicFlags?.min);
    const hbMax = Number(classicFlags?.max);
    const min = Number.isFinite(hbMin) ? hbMin : sysMin;
    const max = Number.isFinite(hbMax) ? hbMax : sysMax;
    return { min, max, source: "homebrew-classic" };
  }

  if (model === "simplified") {
    const simpFlags = flags?.simplified ?? {};
    const hbMin = Number(simpFlags?.min);
    const hbMax = Number(simpFlags?.max);
    // Simplified default: min = 0 (no too-close gating), max falls back to system reach
    const min = Number.isFinite(hbMin) ? hbMin : 0;
    const max = Number.isFinite(hbMax) ? hbMax : sysMax;
    return { min, max, source: "homebrew-simplified" };
  }

  // Unknown model — fall back to system
  return systemResult;
}

/**
 * Inject the Homebrew Length Penalty into a combatant's TN breakdown.
 *
 * The function determines from the caller's perspective ("own" side) whether this
 * side suffers the penalty, then mutates `tn` in-place if so.
 *
 * Rules:
 *  - Both weapons must have explicit LNG values set (> 0).
 *  - Outside In Close: longer weapon = +ΔL×5 bonus; shorter weapon = -ΔL×5 penalty.
 *  - In Close: shorter weapon = +ΔL×5 bonus; longer weapon = -ΔL×5 penalty.
 *  - The signed modifier is applied from the caller's own-side perspective.
 *  - Called separately for attacker and defender; each receives their correct sign.
 *
 * In Close detection: uses pairwise `inCloseWith` token flags exclusively.
 * Only the two combatants who deliberately entered In Close together have their LP reversed.
 * A third combatant standing nearby does NOT get the reversal unless they entered In Close.
 *
 * @param {object} params
 * @param {object}     params.tn              - TN breakdown object (mutated in place)
 * @param {Item|null}  params.ownWeapon       - This side's weapon item
 * @param {Item|null}  params.opponentWeapon  - Opponent's weapon item
 * @param {Token|null} params.ownerToken      - This side's token placeable
 * @param {Token|null} params.opponentToken   - Opponent's token placeable
 * @returns {boolean} true if the penalty was applied, false otherwise
 */
export function applyLengthPenaltyToTN({ tn, ownWeapon, opponentWeapon, ownerToken, opponentToken } = {}) {
  try {
    if (!isReachLengthHomebrewEnabled()) return false;
    if (!tn || !ownWeapon || !opponentWeapon) return false;

    const Lown = getWeaponLength(ownWeapon);
    const Lopp = getWeaponLength(opponentWeapon);
    // Both weapons must have explicit non-zero Length values set
    if (!Lown || !Lopp) return false;

    const delta = Math.abs(Lown - Lopp);
    if (!delta) return false; // Equal lengths: no penalty

    const LP = delta * 5;

    // Determine In Close state: always use pairwise flags.
    // In Close is explicit and bilateral — distance proximity alone does not reverse LP.
    const icMap = ownerToken?.document?.getFlag(NAMESPACE, "reachLength.inCloseWith") ?? {};
    const inClose = Boolean(icMap[opponentToken?.document?.uuid]);

    // Outside In Close: longer weapon = advantage (+LP bonus), shorter = penalty (-LP).
    // In Close: shorter weapon = advantage (+LP bonus), longer = penalty (-LP).
    // Both sides call this function; each receives the signed modifier for their own side.
    const ownLonger = Lown > Lopp;
    const ownAdvantaged = inClose ? !ownLonger : ownLonger;
    const modifier = ownAdvantaged ? +LP : -LP;

    const label = modifier > 0
      ? `Length Advantage (\u0394L\xd75)${inClose ? " (In Close)" : ""}`
      : `Length Penalty (\u0394L\xd75)${inClose ? " (In Close)" : ""}`;

    tn.breakdown = tn.breakdown ?? [];
    tn.breakdown.push({ key: "homebrew:lengthModifier", label, value: modifier, source: "homebrew" });
    tn.totalMod = (tn.totalMod ?? 0) + modifier;
    tn.finalTN  = (tn.finalTN ?? tn.baseTN ?? 0) + modifier;
    return true;
  } catch (err) {
    console.warn("UESRPG | applyLengthPenaltyToTN failed", err);
    return false;
  }
}
