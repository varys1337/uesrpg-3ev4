import { SYSTEM_ROLL_FORMULA } from "../core/constants.js";
import { isNPC, resolveCriticalFlags } from "../core/rules/npc-rules.js";
import { hasTalent } from "../core/traits/talents-api.js";
import { isWithinMeleeRange } from "../core/traits/combat-proximity.js";
import { ActionEconomy } from "../core/combat/action-economy.js";
import { requestUpdateDocument } from "./authority-proxy.js";
import { confirmDialog, customDialog } from "./dialog-v2-helper.js";

/**
 * src/utils/degree-roll-helper.js
 * UESRPG v3e — Degree of Success / Degree of Failure helper
 *
 * Exposes:
 *  - doTestRoll(actor, { rollFormula, target, allowLucky, allowUnlucky })
 *  - resolveOpposed(aResult, dResult)
 *
 * RAW implemented:
 *  - DoS = tens digit of d100 roll (min 1 on success)
 *  - DoF = 1 + tens digit of (roll - target) (min 1 on failure)
 *  - TN > 100: add the tens digit of TN to DoS (RAW)
 *  - Lucky/unlucky: critical success/failure, still has numeric DoS/DoF
 *
 * Returns structured result objects suitable for chat rendering or further logic.
 */

export async function doTestRoll(actor, { rollFormula = SYSTEM_ROLL_FORMULA, target = 0, allowLucky = true, allowUnlucky = true } = {}) {
  // Evaluate the roll
  // Foundry V13+: the `async` option was removed; Roll#evaluate is async by default.
  const roll = await new Roll(rollFormula).evaluate();
  const total = Number(roll.total);

  // Determine actor type / NPC status (deterministic)
  // Per project rules: NPCs use fixed critical bands; PCs use lucky/unlucky numbers.
  const actorIsNPC = isNPC(actor);
  const crit = resolveCriticalFlags(actor, total, { allowLucky, allowUnlucky });
  const isCriticalSuccess = crit.isCriticalSuccess;
  const isCriticalFailure = crit.isCriticalFailure;

  // Success / failure vs target
  const tn = Number(target || 0);
  let isSuccess = (total <= tn);
  // RAW hard rule (Chapter 1): a critical success always succeeds regardless of TN,
  // and a critical failure always fails regardless of TN (PCs and NPCs).
  if (isCriticalSuccess) isSuccess = true;
  if (isCriticalFailure) isSuccess = false;

  // Compute DoS / DoF (RAW) — TN>100: add tens digit of TN to DoS
  let degree = 0;
  if (isSuccess) {
    const baseDos = Math.max(1, Math.floor(total / 10)); // tens digit of roll, min 1
    let tnTensBonus = 0;
    if (tn > 100) {
      // RAW: tens digit of target number is added
      // e.g. TN = 123 => tens digit is 2 => extra +2
      tnTensBonus = Math.floor((tn % 100) / 10);
    }
    degree = baseDos + tnTensBonus;
  } else {
    const diff = Math.max(0, total - tn);
    degree = 1 + Math.floor(diff / 10); // 1 + tens digit of difference
  }

  return {
    roll,                  // full Roll object
    rollTotal: total,
    target: tn,
    isSuccess,
    isCriticalSuccess,
    isCriticalFailure,
    degree,                // DoS when success, DoF when failure
    textual: isSuccess ? `${degree} DoS` : `${degree} DoF`,
    meta: {
      actorId: actor?.id,
      actorName: actor?.name,
      actorIsNPC
    }
  };
}

/**
 * Compute a deterministic DoS/DoF result from an already-known d100 total.
 *
 * This exists to support cross-user opposed workflows where the roll message is
 * created successfully (Dice So Nice compatibility) but the originating opposed
 * card cannot be updated by the rolling user due to document permissions.
 *
 * @param {Actor} actor
 * @param {object} opts
 * @param {number} opts.rollTotal
 * @param {number} opts.target
 * @param {boolean} [opts.allowLucky=true]
 * @param {boolean} [opts.allowUnlucky=true]
 * @returns {object} A result object with the same shape as doTestRoll (minus the Roll).
 */
export function computeResultFromRollTotal(actor, { rollTotal = 0, target = 0, allowLucky = true, allowUnlucky = true } = {}) {
  const total = Number(rollTotal);
  const tn = Number(target || 0);

  const actorIsNPC = isNPC(actor);
  const crit = resolveCriticalFlags(actor, total, { allowLucky, allowUnlucky });
  const isCriticalSuccess = crit.isCriticalSuccess;
  const isCriticalFailure = crit.isCriticalFailure;

  let isSuccess = (total <= tn);
  if (isCriticalSuccess) isSuccess = true;
  if (isCriticalFailure) isSuccess = false;

  let degree = 0;
  if (isSuccess) {
    const baseDos = Math.max(1, Math.floor(total / 10));
    let tnTensBonus = 0;
    if (tn > 100) tnTensBonus = Math.floor((tn % 100) / 10);
    degree = baseDos + tnTensBonus;
  } else {
    const diff = Math.max(0, total - tn);
    degree = 1 + Math.floor(diff / 10);
  }

  return {
    roll: null,
    rollTotal: total,
    target: tn,
    isSuccess,
    isCriticalSuccess,
    isCriticalFailure,
    degree,
    textual: isSuccess ? `${degree} DoS` : `${degree} DoF`,
    meta: {
      actorId: actor?.id,
      actorName: actor?.name,
      actorIsNPC
    }
  };
}

/**
 * Format a DoS/DoF string consistently across the system.
 * @param {object|null} result A result from doTestRoll.
 * @returns {string}
 */
export function formatDegree(result) {
  if (!result) return "—";
  return result.isSuccess ? `${result.degree} DoS` : `${result.degree} DoF`;
}

/**
 * Resolve an opposed test between attacker and defender results.
 * Returns { winner: "attacker"|"defender"|"tie", reason: string }
 *
 * Rules implemented (per your confirmation):
 * - If one side has critical success and the other does not -> critical side wins.
 * - If one side has critical failure and the other does not -> the other side wins.
 * - If both succeed -> compare DoS (higher wins); equal -> tie.
 * - If both fail -> compare DoF (lower wins); equal -> tie.
 * - If one succeeds and the other fails -> success side wins.
 */
export function resolveOpposed(aResult, dResult) {
  // Null/undefined checks - return tie if either result is missing
  if (!aResult || !dResult) {
    return { winner: "tie", reason: "unresolved (missing result)" };
  }

  const A = aResult;
  const D = dResult;

  // Critical success precedence
  // Use safe property access with default false for isCriticalSuccess/isCriticalFailure
  const aIsCritSuccess = Boolean(A.isCriticalSuccess ?? false);
  const dIsCritSuccess = Boolean(D.isCriticalSuccess ?? false);
  const aIsCritFailure = Boolean(A.isCriticalFailure ?? false);
  const dIsCritFailure = Boolean(D.isCriticalFailure ?? false);

  if (aIsCritSuccess && !dIsCritSuccess) return { winner: "attacker", reason: "attacker critical success" };
  if (dIsCritSuccess && !aIsCritSuccess) return { winner: "defender", reason: "defender critical success" };
  if (aIsCritSuccess && dIsCritSuccess) return { winner: "tie", reason: "both critical success (roll-off required)" };

  // Critical failure precedence (other side wins)
  if (aIsCritFailure && !dIsCritFailure) return { winner: "defender", reason: "attacker critical failure" };
  if (dIsCritFailure && !aIsCritFailure) return { winner: "attacker", reason: "defender critical failure" };
  if (aIsCritFailure && dIsCritFailure) return { winner: "tie", reason: "both critical failure" };

  // One succeeds, other fails
  // Use safe property access with default false
  const aIsSuccess = Boolean(A.isSuccess ?? false);
  const dIsSuccess = Boolean(D.isSuccess ?? false);

  if (aIsSuccess && !dIsSuccess) return { winner: "attacker", reason: "attacker success" };
  if (dIsSuccess && !aIsSuccess) return { winner: "defender", reason: "defender success" };

  // Both succeed -> higher DoS wins; equal -> tie
  if (aIsSuccess && dIsSuccess) {
    const aDegree = Number(A.degree ?? 0);
    const dDegree = Number(D.degree ?? 0);
    if (aDegree > dDegree) return { winner: "attacker", reason: `attacker higher DoS (${aDegree} vs ${dDegree})` };
    if (dDegree > aDegree) return { winner: "defender", reason: `defender higher DoS (${dDegree} vs ${aDegree})` };
    return { winner: "tie", reason: "equal DoS" };
  }

  // Both fail -> lower DoF wins; equal -> tie
  if (!aIsSuccess && !dIsSuccess) {
    const aDegree = Number(A.degree ?? 0);
    const dDegree = Number(D.degree ?? 0);
    if (aDegree < dDegree) return { winner: "attacker", reason: `attacker lower DoF (${aDegree} vs ${dDegree})` };
    if (dDegree < aDegree) return { winner: "defender", reason: `defender lower DoF (${dDegree} vs ${aDegree})` };
    return { winner: "tie", reason: "equal DoF" };
  }

  // Fallback
  return { winner: "tie", reason: "unresolved" };
}

// ---------------------------------------------------------------------------
// Combat Talent Automation: Defender (Intercept)
// ---------------------------------------------------------------------------

function _asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _escapeHtml(str) {
  const s = String(str ?? "");
  // Prefer Foundry's escape if available.
  try {
    return foundry.utils.escapeHTML(s);
  } catch (_e) {
    return s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}

function _isHiddenOrNeutral(token) {
  const disp = token?.document?.disposition;
  const hidden = token?.document?.hidden === true;
  return hidden || disp === 0;
}

function _collectDefenderCandidates(defenderToken, { rangeMeters = 2 } = {}) {
  if (!defenderToken || !canvas?.tokens?.placeables) return [];

  const disp = defenderToken?.document?.disposition;
  if (disp == null || disp === 0) return [];

  const out = [];
  for (const t of canvas.tokens.placeables) {
    if (!t || t.id === defenderToken.id) continue;
    if (_isHiddenOrNeutral(t)) continue;
    if (t.document?.disposition !== disp) continue;
    if (!t.actor) continue;
    if (!hasTalent(t.actor, "defender")) continue;
    if (!isWithinMeleeRange(defenderToken, t, rangeMeters)) continue;

    const ap = _asNumber(t.actor.system?.action_points?.value, 0);
    if (ap < 1) continue;

    // Only present candidates the current user can actually trigger.
    if (!(game.user?.isGM || t.actor.isOwner === true)) continue;

    out.push({ token: t, actor: t.actor, ap });
  }

  // Deterministic ordering.
  out.sort((a, b) => {
    const an = String(a.actor?.name ?? "");
    const bn = String(b.actor?.name ?? "");
    return an.localeCompare(bn);
  });

  return out;
}

async function _promptDefenderInterceptChoice(defenderToken, candidates) {
  if (!defenderToken || !Array.isArray(candidates) || !candidates.length) return null;

  // Single candidate: simple yes/no.
  if (candidates.length === 1) {
    const c = candidates[0];
    const ok = await confirmDialog({
      title: "Defender",
      content: `
        <div class="uesrpg">
          <p><b>${_escapeHtml(c.actor.name)}</b> can intercept this attack on <b>${_escapeHtml(defenderToken.actor?.name ?? defenderToken.name)}</b>.</p>
          <p>Cost: <b>1 AP</b>. After intercepting: <b>Block/Parry/Counter</b> for <b>0 AP</b>.</p>
        </div>
      `,
      yesLabel: "Intercept (1 AP)",
      noLabel: "Do Not Intercept",
      yesIcon: "fas fa-shield-alt",
      noIcon: "fas fa-times",
      rejectClose: false,
    });
    return ok ? c : null;
  }

  const options = candidates
    .map((c, idx) => `<option value="${idx}">${_escapeHtml(`${c.actor.name} (${c.ap} AP)`)}</option>`)
    .join("");

  const pickedIdx = await customDialog({
    title: "Defender",
    content: `
      <div class="uesrpg">
        <p>Select which ally intercepts the attack on <b>${_escapeHtml(defenderToken.actor?.name ?? defenderToken.name)}</b>.</p>
        <p>Cost: <b>1 AP</b>. After intercepting: <b>Block/Parry/Counter</b> for <b>0 AP</b>.</p>
        <div style="margin-top:8px;">
          <label style="display:block; font-weight:600; margin-bottom:4px;">Interceptor</label>
          <select name="ues-defender-interceptor" style="width:100%;">${options}</select>
        </div>
      </div>
    `,
    buttons: {
      yes: {
        label: "Intercept (1 AP)",
        icon: "fas fa-shield-alt",
        callback: (html) => {
          const el = html instanceof HTMLElement ? html : html?.[0];
          const v = el?.querySelector?.('select[name="ues-defender-interceptor"]')?.value;
          const idx = Number(v);
          return Number.isFinite(idx) ? idx : 0;
        }
      },
      no: { label: "Do Not Intercept", icon: "fas fa-times", callback: () => null }
    },
    default: "no",
    rejectClose: false,
  });

  if (pickedIdx == null) return null;
  const idx = Math.max(0, Math.min(candidates.length - 1, Number(pickedIdx)));
  return candidates[idx] ?? null;
}

async function _swapTokenPositions(tokenA, tokenB) {
  if (!tokenA?.document || !tokenB?.document) return false;
  const aPos = { x: _asNumber(tokenA.document.x, 0), y: _asNumber(tokenA.document.y, 0) };
  const bPos = { x: _asNumber(tokenB.document.x, 0), y: _asNumber(tokenB.document.y, 0) };

  // Best-effort sequential swap. If the second update fails, attempt to revert the first.
  const ok1 = await requestUpdateDocument(tokenA.document, { x: bPos.x, y: bPos.y });
  if (!ok1) return false;

  const ok2 = await requestUpdateDocument(tokenB.document, { x: aPos.x, y: aPos.y });
  if (!ok2) {
    try {
      await requestUpdateDocument(tokenA.document, { x: aPos.x, y: aPos.y });
    } catch (_e) {
      // ignore
    }
    return false;
  }

  return true;
}

/**
 * Attempt to apply the Defender talent intercept.
 *
 * @param {object} opts
 * @param {object} opts.data - opposed workflow data (mutated in-place)
 * @param {object} opts.defenderData - the defender entry object (mutated in-place)
 * @param {Token} opts.defenderToken - the currently-targeted token for this defender entry
 * @param {{rangeMeters?: number}} [opts.options]
 * @returns {Promise<boolean>} true if an intercept was applied
 */
async function maybeApplyDefenderIntercept({ data, defenderData, defenderToken, options = {} } = {}) {
  try {
    if (!data || !defenderData || !defenderToken) return false;

    // Once per workflow/defender entry.
    if (defenderData?.defenderIntercept?.applied === true) return false;

    const candidates = _collectDefenderCandidates(defenderToken, { rangeMeters: _asNumber(options?.rangeMeters, 2) });
    if (!candidates.length) return false;

    const picked = await _promptDefenderInterceptChoice(defenderToken, candidates);
    if (!picked) return false;

    // Spend the intercept AP on the interceptor.
    const paid = await ActionEconomy.spendAP(picked.actor, 1, { reason: "reaction:defender-intercept", silent: true });
    if (!paid) {
      ui.notifications?.warn?.(`${picked.actor.name} does not have enough Action Points to intercept.`);
      return false;
    }

    // Swap positions.
    const swapped = await _swapTokenPositions(defenderToken, picked.token);
    if (!swapped) {
      ui.notifications?.warn?.("Failed to swap token positions for Defender intercept.");
      return false;
    }

    // Rewrite the defender lane to the interceptor.
    const original = {
      actorUuid: defenderData.actorUuid ?? defenderToken.actor?.uuid ?? null,
      tokenUuid: defenderData.tokenUuid ?? defenderToken.document?.uuid ?? null,
      name: defenderToken.actor?.name ?? defenderToken.name
    };
    const interceptor = {
      actorUuid: picked.actor.uuid,
      tokenUuid: picked.token.document.uuid,
      name: picked.actor.name
    };

    defenderData.actorUuid = interceptor.actorUuid;
    defenderData.tokenUuid = interceptor.tokenUuid;
    defenderData.defenderIntercept = {
      applied: true,
      original,
      interceptor,
      freeDefense: true,
      allowedDefenseTypes: ["block", "parry", "counter"],
      appliedAt: Date.now()
    };

    // Keep a breadcrumb in the overall workflow context for auditing/debugging.
    data.context = data.context ?? {};
    data.context.defenderIntercept = Array.isArray(data.context.defenderIntercept) ? data.context.defenderIntercept : [];
    data.context.defenderIntercept.push({
      defenderOriginalActorUuid: original.actorUuid,
      interceptorActorUuid: interceptor.actorUuid,
      at: Date.now()
    });

    return true;
  } catch (err) {
    console.warn("UESRPG | maybeApplyDefenderIntercept failed", err);
    return false;
  }
}

// Convenience global exposure so macros and non-module code can access the helper
window.Uesrpg3e = window.Uesrpg3e || {};
window.Uesrpg3e.roll = window.Uesrpg3e.roll || {};
window.Uesrpg3e.roll.doTestRoll = window.Uesrpg3e.roll.doTestRoll || doTestRoll;
window.Uesrpg3e.roll.computeResultFromRollTotal = window.Uesrpg3e.roll.computeResultFromRollTotal || computeResultFromRollTotal;
window.Uesrpg3e.roll.resolveOpposed = window.Uesrpg3e.roll.resolveOpposed || resolveOpposed;
window.Uesrpg3e.roll.formatDegree = window.Uesrpg3e.roll.formatDegree || formatDegree;
window.Uesrpg3e.roll.maybeApplyDefenderIntercept = window.Uesrpg3e.roll.maybeApplyDefenderIntercept || maybeApplyDefenderIntercept;
