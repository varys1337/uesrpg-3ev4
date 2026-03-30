import { formatDegree, formatResultOutcomeLabel } from "../../utils/degree-roll-helper.js";
import { requestUpdateChatMessage } from "../../utils/authority-proxy.js";
import { getBloodLossStatus } from "./engine/state.js";
import { SYSTEM_ID } from "../constants.js";

const PROMPT_FLAG_KEY = "deathTestPrompt";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

export function renderDeathPromptCard(actor, state, {
  resolvedMessageId = null,
  endTn = 0,
  luckBonus = 0,
} = {}) {
  const hp = Number(actor?.system?.hp?.value ?? 0) || 0;
  const lastPromptMeta = state?.lastPromptMeta ?? {};
  const bloodLoss = lastPromptMeta?.bloodLoss ?? getBloodLossStatus(actor);
  const bloodLossLabel = bloodLoss?.hasEffect
    ? (bloodLoss?.paused
      ? `Paused (${esc(bloodLoss?.pauseLabel || "Suppressed")}) - ${Math.max(0, Number(bloodLoss?.remainingRounds ?? 0) || 0)} rounds left`
      : `${Math.max(0, Number(bloodLoss?.remainingRounds ?? 0) || 0)} rounds remaining`)
    : "Not active";
  const lastResult = state?.lastResult ?? null;
  const isResolved = Boolean(resolvedMessageId) && Array.isArray(state?.resolvedPromptIds) && state.resolvedPromptIds.includes(String(resolvedMessageId));
  const degreeText = Number.isFinite(Number(lastResult?.degree)) ? formatDegree({
    isSuccess: lastResult?.success === true,
    degree: Number(lastResult.degree ?? 0) || 0,
  }) : "";

  let resultHtml = "";
  if (isResolved && lastResult?.kind === "death-test") {
    const status = formatResultOutcomeLabel({
      isSuccess: lastResult?.success,
      isCriticalSuccess: lastResult?.isCriticalSuccess,
      isCriticalFailure: lastResult?.isCriticalFailure,
    }, { uppercase: true });
    const details = lastResult?.success
      ? (lastResult?.autoFailed ? "" : ` - ${degreeText}`)
      : (lastResult?.autoFailed ? " (auto-fail due to recent damage)" : ` - ${degreeText}`);
    resultHtml = `
      <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.12);">
        <p><b>Result:</b> ${status}${details}</p>
        <p><b>Tests Rolled:</b> ${Math.max(0, Number(state?.testsRolled ?? 0) || 0)}</p>
        <p><b>Failures:</b> ${Math.max(0, Number(state?.failureCount ?? 0) || 0)} / Luck bonus ${Math.max(0, Number(luckBonus ?? 0) || 0)}</p>
        ${state?.isDead === true ? `<p><b>Status:</b> ${esc(actor?.name ?? "Actor")} dies from sustained trauma while unconscious.</p>` : ""}
      </div>
    `;
  }

  return `
    <div class="uesrpg-chat-card" data-card="death-test-pending">
      <header class="card-header"><h3>${isResolved ? "Death Test Resolved" : "Death Test Pending (Blood Loss Watch)"}</h3></header>
      <div class="card-content">
        <p><b>Actor:</b> ${esc(actor.name)}</p>
        <p><b>Status:</b> ${state?.isDead === true ? "Dead" : "Unconscious at 0 HP"}</p>
        <p><b>HP:</b> ${hp}</p>
        <p><b>END:</b> ${endTn}</p>
        <p><b>Blood Loss:</b> ${bloodLossLabel}</p>
        <p><b>Failures:</b> ${Math.max(0, Number(state?.failureCount ?? 0) || 0)} / Luck bonus ${Math.max(0, Number(luckBonus ?? 0) || 0)}</p>
        ${!isResolved ? `<p><i>Click to resolve this turn's death test.</i></p>` : ""}
        ${resultHtml}
      </div>
      ${!isResolved ? `<footer class="card-footer">
        <button type="button" data-ues-death-action="roll" data-actor-uuid="${esc(actor.uuid)}">Roll Death Test (END)</button>
      </footer>` : ""}
    </div>
  `;
}

export async function updateDeathPromptMessage(messageId, actor, state, {
  endTn = 0,
  luckBonus = 0,
} = {}) {
  const msgId = String(messageId ?? "").trim();
  if (!msgId || !actor) return;
  const message = game.messages?.get(msgId) ?? null;
  if (!message) return;
  const promptState = {
    actorUuid: actor.uuid,
    createdAt: Date.now(),
    resolved: Array.isArray(state?.resolvedPromptIds) && state.resolvedPromptIds.includes(msgId),
    resolvedAt: Number(state?.lastResult?.at ?? 0) || Date.now(),
    result: state?.lastResult ?? null,
    isDead: state?.isDead === true,
  };
  await requestUpdateChatMessage(message, {
    content: renderDeathPromptCard(actor, state, { resolvedMessageId: msgId, endTn, luckBonus }),
    [`flags.${SYSTEM_ID}.${PROMPT_FLAG_KEY}`]: promptState,
  });
}

export async function announceDeathTest(actor, {
  success,
  autoFailed = false,
  degree = 0,
  failureCount = 0,
  luckBonus = 0,
} = {}) {
  const status = formatResultOutcomeLabel({ isSuccess: success }, { uppercase: true });
  const details = success
    ? (autoFailed ? "" : ` - ${formatDegree({ isSuccess: true, degree })}`)
    : (autoFailed ? " (auto-fail due to recent damage)" : ` - ${formatDegree({ isSuccess: false, degree })}`);

  const extra = !success
    ? `<p><b>Failures:</b> ${failureCount} (dies if this exceeds Luck bonus ${luckBonus})</p>`
    : "";

  const content = `
    <div class="uesrpg-chat-card">
      <header class="card-header"><h3>Death Test</h3></header>
      <div class="card-content">
        <p><b>Actor:</b> ${esc(actor.name)}</p>
        <p><b>Result:</b> ${status}${details}</p>
        ${extra}
      </div>
    </div>
  `;

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

export async function queueDeathPromptCard(actor, state, {
  endTn = 0,
  luckBonus = 0,
} = {}) {
  const hp = Number(actor?.system?.hp?.value ?? 0) || 0;
  const bloodLoss = getBloodLossStatus(actor);
  state.lastPromptMeta = {
    at: Date.now(),
    hp,
    endTn,
    luckBonus,
    bloodLoss: {
      hasEffect: bloodLoss.hasEffect === true,
      paused: bloodLoss.paused === true,
      remainingRounds: Math.max(0, Number(bloodLoss.remainingRounds ?? 0) || 0),
      pauseReason: bloodLoss.pauseReason ?? null,
      pauseLabel: bloodLoss.pauseLabel ?? "",
    },
  };

  const msg = await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: renderDeathPromptCard(actor, state, { endTn, luckBonus }),
    flags: {
      [SYSTEM_ID]: {
        [PROMPT_FLAG_KEY]: {
          actorUuid: actor.uuid,
          createdAt: Date.now(),
          resolved: false,
        },
      },
    },
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });

  if (!msg?.id) return;
  state.pendingPrompts.push({
    messageId: String(msg.id),
    createdAt: Date.now(),
    resolved: false,
    resolvedAt: 0,
  });
}
