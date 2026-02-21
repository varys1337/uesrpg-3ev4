/**
 * src/core/skills/opposed-workflow/resolve.js
 *
 * Stage 06 modular boundary: pure tie-breaker resolution helpers.
 */

import { doTestRoll, resolveOpposed } from "../../../utils/degree-roll-helper.js";
import { _esc } from "../opposed/util.js";

/**
 * If both sides rolled a critical success and the outcome is a tie, perform a
 * bounded roll-off to break the tie (per rules).
 *
 * Authority runner:
 *  - If an active GM exists: only that GM runs.
 *  - Otherwise: the parent message author runs.
 *
 * This mutates `data.context.rollOff` and may update `data.outcome`.
 */
export async function _maybeResolveBothCritSuccessRollOff({ message, data, attacker, defender } = {}) {
  if (!message || !data || !attacker || !defender) return;
  if (data?.outcome?.winner && data.outcome.winner !== "tie") return;
  if (data?.context?.rollOff?.resolved) return;

  const aRes = data?.attacker?.result ?? null;
  const dRes = data?.defender?.result ?? null;
  if (!aRes || !dRes) return;

  const bothCritSuccess = Boolean(aRes.isCriticalSuccess) && Boolean(dRes.isCriticalSuccess);
  if (!bothCritSuccess) return;

  const activeGM = game.users.activeGM ?? null;
  const shouldRun = activeGM ? (game.user.id === activeGM.id) : message.isAuthor;
  if (!shouldRun) return;

  // Roll-off: reroll to break the tie.
  const maxAttempts = 5;
  const attempts = [];
  let final = null;

  const aTarget = Number(aRes.target ?? data?.attacker?.tn?.finalTN ?? 0) || 0;
  const dTarget = Number(dRes.target ?? data?.defender?.tn?.finalTN ?? 0) || 0;

  for (let i = 1; i <= maxAttempts; i++) {
    const a = await doTestRoll(attacker, { rollFormula: "1d100", target: aTarget, allowLucky: true, allowUnlucky: true });
    const d = await doTestRoll(defender, { rollFormula: "1d100", target: dTarget, allowLucky: true, allowUnlucky: true });
    const out = resolveOpposed(a, d);

    attempts.push({
      n: i,
      attacker: {
        rollTotal: a.rollTotal,
        target: a.target,
        textual: a.textual,
        isCriticalSuccess: a.isCriticalSuccess,
        isCriticalFailure: a.isCriticalFailure
      },
      defender: {
        rollTotal: d.rollTotal,
        target: d.target,
        textual: d.textual,
        isCriticalSuccess: d.isCriticalSuccess,
        isCriticalFailure: d.isCriticalFailure
      },
      winner: out.winner,
      reason: out.reason
    });

    if (out.winner === "attacker" || out.winner === "defender") {
      final = out;
      break;
    }
  }

  const winner = final?.winner ?? "tie";

  data.context = data.context ?? {};
  data.context.rollOff = {
    kind: "bothCritSuccess",
    resolved: winner !== "tie",
    resolvedAt: Date.now(),
    resolvedBy: game.user.id,
    attempts
  };

  // Post a compact chat note for auditability.
  try {
    const last = attempts[attempts.length - 1] ?? null;
    const winnerName = winner === "attacker" ? data.attacker?.name : (winner === "defender" ? data.defender?.name : "Tie");
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      content: `<div class="ues-skill-rolloff">
        <b>Opposed Skill Roll-Off</b> (both rolled a critical success)
        <div style="margin-top:6px;"><b>${data.attacker?.name ?? "Attacker"}:</b> ${last ? `${last.attacker.rollTotal} vs TN ${last.attacker.target} (${_esc(last.attacker.textual)})` : "—"}</div>
        <div><b>${data.defender?.name ?? "Defender"}:</b> ${last ? `${last.defender.rollTotal} vs TN ${last.defender.target} (${_esc(last.defender.textual)})` : "—"}</div>
        <div style="margin-top:6px;"><b>Winner:</b> ${_esc(winnerName)}</div>
      </div>`
    });
  } catch (_e) {
    // Non-blocking.
  }

  if (winner === "attacker" || winner === "defender") {
    data.outcome = {
      ...(data.outcome ?? {}),
      winner,
      reason: "both critical success (roll-off)",
      text: `${winner === "attacker" ? data.attacker?.name : data.defender?.name} wins — roll-off breaks the tie after both critical successes.`
    };
  } else {
    data.outcome = {
      ...(data.outcome ?? {}),
      winner: "tie",
      reason: "both critical success (roll-off unresolved)",
      text: `Tie — roll-off still unresolved after ${maxAttempts} attempts.`
    };
  }
}
