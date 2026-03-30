import { doTestRoll, resolveOpposed } from "../../../utils/degree-roll-helper.js";
import { _esc } from "./util.js";

export async function maybeResolveBothCritSuccessRollOff({ message, data, attacker, defender } = {}) {
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
      attacker: { rollTotal: a.rollTotal, target: a.target, textual: a.textual },
      defender: { rollTotal: d.rollTotal, target: d.target, textual: d.textual },
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

  try {
    const last = attempts[attempts.length - 1] ?? null;
    const winnerName = winner === "attacker" ? data.attacker?.name : (winner === "defender" ? data.defender?.name : "Tie");
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      content: `<div class="ues-char-rolloff">
        <b>Opposed Characteristic Roll-Off</b> (both rolled a critical success)
        <div style="margin-top:6px;"><b>${data.attacker?.name ?? "Initiator"}:</b> ${last ? `${last.attacker.rollTotal} vs TN ${last.attacker.target} (${_esc(last.attacker.textual)})` : "—"}</div>
        <div><b>${data.defender?.name ?? "Target"}:</b> ${last ? `${last.defender.rollTotal} vs TN ${last.defender.target} (${_esc(last.defender.textual)})` : "—"}</div>
        <div style="margin-top:6px;"><b>Winner:</b> ${_esc(winnerName)}</div>
      </div>`
    });
  } catch (_e) {
    // Non-blocking.
  }

  if (winner === "attacker" || winner === "defender") {
    data.outcome = {
      winner,
      reason: "both critical success (roll-off)",
      text: `${winner === "attacker" ? data.attacker?.name : data.defender?.name} wins — roll-off breaks the tie.`
    };
    return;
  }

  data.outcome = {
    winner: "tie",
    reason: "both critical success (roll-off unresolved)",
    text: `Tie — roll-off still unresolved after ${maxAttempts} attempts.`
  };
}
