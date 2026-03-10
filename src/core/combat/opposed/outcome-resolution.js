/**
 * src/core/combat/opposed/outcome-resolution.js
 *
 * Outcome determination and advantage calculation for opposed combat.
 * Extracted from monolith (Phase 13) to improve modularity and performance.
 * Consolidated with resolve.js in Phase 17 (2026-02-03).
 *
 * Exported functions:
 * - fmtDegree: Format degree of success/failure for display
 * - resolveOutcomeRAW: Determine winner and outcome text from opposed rolls
 * - computeAdvantageRAW: Calculate advantage gained based on RAW rules
 */

import { getContextAttackMode as _getContextAttackMode } from "./helpers/workflow.js";

/**
 * Format a degree result for display.
 * Consolidated from resolve.js (Phase 17).
 * 
 * @param {Object} res - Result object with isSuccess and degree
 * @returns {string} Formatted degree string (e.g., "2 DoS", "1 DoF", "Critical!", "—")
 */
export function fmtDegree(res) {
  if (!res) return "—";
  if (res.isCriticalSuccess) return "Critical!";
  if (res.isCriticalFailure) return "Fumble!";
  
  const deg = Number(res.degree ?? 0);
  if (deg === 0) return res.isSuccess ? "Success" : "Failure";
  
  return res.isSuccess ? `${deg} DoS` : `${deg} DoF`;
}

/**
 * Determine the outcome of an opposed roll according to RAW.
 * Returns { winner: "attacker" | "defender" | "tie", text: string }
 */
export function resolveOutcomeRAW(data, defender = null) {
  const a = data.attacker;
  const d = defender ?? data.defender;

  const A = a.result;
  const D = d.result;
  if (!A || !D) return null;

  const defenseType = String(d.defenseType ?? "none").toLowerCase();
  const blockSource = String(d?.blockSource ?? "").toLowerCase();
  const isWardDefense = defenseType === "ward" || (defenseType === "block" && blockSource === "ward");
  const effectiveDefenseType = isWardDefense ? "ward" : defenseType;

  // RAW (Critical outcomes):
  // If both sides roll any critical (success or failure), neither attack nor defense resolves.
  const aCrit = Boolean(A.isCriticalSuccess || A.isCriticalFailure);
  const dCrit = Boolean(D.isCriticalSuccess || D.isCriticalFailure);
  if (aCrit && dCrit) {
    return { winner: "tie", text: `Both sides roll a critical — neither attack nor defense resolves.` };
  }

  // For resolution purposes, treat a single critical success as "more DoS" than the other side if they succeeded.
  // Critical failure does not auto-grant success; it may promote the opponent to an effective critical success
  // for downstream Advantage logic when the opponent passed.
  const aEff = {
    ...A,
    _effectiveCriticalSuccess: Boolean(A.isCriticalSuccess)
  };
  const dEff = {
    ...D,
    _effectiveCriticalSuccess: Boolean(D.isCriticalSuccess)
  };

  if (A.isCriticalFailure && D.isSuccess) dEff._effectiveCriticalSuccess = true;
  if (D.isCriticalFailure && A.isSuccess) aEff._effectiveCriticalSuccess = true;

  const aDoS = aEff.isSuccess ? Number(aEff.degree ?? 0) : 0;
  const dDoS = dEff.isSuccess ? Number(dEff.degree ?? 0) : 0;
  const aDoSEff = aEff._effectiveCriticalSuccess && dEff.isSuccess ? (dDoS + 1) : aDoS;
  const dDoSEff = dEff._effectiveCriticalSuccess && aEff.isSuccess ? (aDoS + 1) : dDoS;

  // Helper: both fail clause from RAW Step 3.
  const bothFail = (!A.isSuccess && !D.isSuccess);

  // No defense: attacker wins if they succeeded; otherwise nothing resolves.
  if (effectiveDefenseType === "none") {
    if (A.isSuccess) return { winner: "attacker", text: `${a.name} wins — attack hits.` };
    return { winner: "tie", text: `Both fail — neither resolves.` };
  }

  // Attack vs Block: successful block wins regardless of attacker DoS.
  if (effectiveDefenseType === "block" || effectiveDefenseType === "ward") {
    const defLabel = effectiveDefenseType === "ward" ? "wards" : "blocks";
    const attackerHasFlail = Boolean(data?.context?.attackerWeaponTraits?.flail);
    // Critical success: treat as higher DoS than the other side if they also succeeded.
    if (A.isSuccess && D.isSuccess) {
      if (aEff._effectiveCriticalSuccess && !dEff._effectiveCriticalSuccess) return { winner: "attacker", text: `${a.name} wins — critical success overwhelms the ${defenseType}.` };
      if (dEff._effectiveCriticalSuccess && !aEff._effectiveCriticalSuccess) return { winner: "defender", text: `${d.name} wins — critical ${defenseType} holds.` };
      // Flail exception: a successful block still loses if attacker DoS exceeds defender DoS.
      if (effectiveDefenseType === "block" && attackerHasFlail && aDoSEff > dDoSEff) {
        return { winner: "attacker", text: `${a.name} wins — flail overpowers the block.` };
      }
      // No critical edge: block/ward wins (RAW).
      return { winner: "defender", text: `${d.name} wins — ${defLabel} the attack.` };
    }
    if (D.isSuccess) return { winner: "defender", text: `${d.name} wins — ${defLabel} the attack.` };
    // Defender failed block/ward
    if (A.isSuccess) return { winner: "attacker", text: `${a.name} wins — attack hits.` };
    return { winner: "tie", text: `Both fail — neither resolves.` };
  }

  // Counter-Attack special RAW:
  // - Both fail: neither resolves.
  // - Higher DoS hits the other.
  // - Equal DoS: neither resolves.
  if (effectiveDefenseType === "counter") {
    if (bothFail) return { winner: "tie", text: `Both fail — neither resolves.` };
    if (A.isSuccess && !D.isSuccess) return { winner: "attacker", text: `${a.name} wins — counter fails; attack hits.` };
    if (D.isSuccess && !A.isSuccess) return { winner: "defender", text: `${d.name} wins — counter-attack hits ${a.name}.` };
    // both succeed
    if (aDoSEff > dDoSEff) return { winner: "attacker", text: `${a.name} hits ${d.name} (Counter-Attack).` };
    if (dDoSEff > aDoSEff) return { winner: "defender", text: `${d.name} hits ${a.name} (Counter-Attack).` };
    return { winner: "tie", text: `Tie — neither attack resolves.` };
  }

  // Parry/Evade generic rules:
  // - Both fail: neither resolves.
  // - One fails: the other wins.
  // - Both succeed: higher DoS wins; tie => defense holds (no one gains advantage here).
  if (bothFail) return { winner: "tie", text: `Both fail — neither resolves.` };
  if (A.isSuccess && !D.isSuccess) return { winner: "attacker", text: `${a.name} wins — attack hits.` };
  if (D.isSuccess && !A.isSuccess) return { winner: "defender", text: `${d.name} wins — defends successfully.` };

  // both succeed
  if (aDoSEff > dDoSEff) return { winner: "attacker", text: `Both succeed — attacker has more DoS; resolve the attack.` };
  if (dDoSEff > aDoSEff) return { winner: "defender", text: `Both succeed — defense holds; attack is negated.` };
  return { winner: "defender", text: `Both succeed — no advantage; defense holds.` };
}

/**
 * Compute advantage gained from an opposed roll according to RAW.
 * Returns { attacker: number, defender: number }
 */
export function computeAdvantageRAW(data, outcome, defender = null, opts = {}) {
  const { hasEquippedShieldType: _hasEquippedShieldType, resolveDoc: _resolveDoc } = opts;

  if (data?.context?.noAdvantageGain) return { attacker: 0, defender: 0 };
  // RAW: advantage is only gained in melee when:
  //  - exactly one character fails (winner gains 1 advantage)
  //  - a critical success occurs (winner gains 1 advantage)
  //  - critical success vs fail OR success vs critical fail (winner gains 2 advantages)
  // No advantage is gained when both pass (even if attacker wins on higher DoS).
  const A = data?.attacker?.result;
  const D = (defender ?? data?.defender)?.result;
  if (!A || !D || !outcome) return { attacker: 0, defender: 0 };

  // If neither side resolves, no advantage.
  if (outcome.winner !== "attacker" && outcome.winner !== "defender") {
    return { attacker: 0, defender: 0 };
  }

  const winnerKey = outcome.winner;
  const loserKey = winnerKey === "attacker" ? "defender" : "attacker";
  const W = winnerKey === "attacker" ? A : D;
  const L = loserKey === "attacker" ? A : D;

  // Attack vs Block special: block can win even when both succeed.
  // RAW Step 3 states successful block resolves as if defender won; advantage is only gained when
  // the other character fails OR via critical success rules.

  let adv = 0;
  let source = null;

  // RAW (Critical outcomes): if both sides rolled any critical, no advantage.
  const wCrit = Boolean(W.isCriticalSuccess || W.isCriticalFailure);
  const lCrit = Boolean(L.isCriticalSuccess || L.isCriticalFailure);
  if (wCrit && lCrit) {
    adv = 0;
  } else if ((W.isCriticalSuccess && !L.isSuccess) || (W.isSuccess && L.isCriticalFailure)) {
    // Critical success vs failure OR success vs critical fail: winner gains 2 Advantage.
    adv = 2;
  } else if (W.isCriticalSuccess && L.isSuccess) {
    // Critical success vs success: winner gains 1 Advantage.
    adv = 1;
  } else if (W.isSuccess && !L.isSuccess) {
    // Success vs failure: winner gains 1 Advantage.
    adv = 1;
  } else {
    adv = 0;
  }

  // RAW: Ranged attackers and spells cannot gain or utilize Advantage.
  // Defender Advantage is still permitted (e.g., against ranged attacks).
  const attackMode = _getContextAttackMode(data?.context);
  if (winnerKey === "attacker" && attackMode !== "melee") adv = 0;

  // Buckler: defender always gains Advantage on a successful Parry win.
  if (winnerKey === "defender" && _hasEquippedShieldType && _resolveDoc) {
    const defSide = (defender ?? data?.defender) ?? null;
    const defActor = defender ?? _resolveDoc(data?.defender?.actorUuid) ?? null;
    const dt = String(defSide?.defenseType ?? "");
    if (dt === "parry" && defActor && _hasEquippedShieldType(defActor, "buckler")) {
      adv = Math.max(adv, 1);
      source = "buckler-parry-win";
    }
  }

  if (winnerKey === "attacker") {
    return { attacker: adv, defender: 0 };
  }
  return source ? { attacker: 0, defender: adv, source } : { attacker: 0, defender: adv };
}
