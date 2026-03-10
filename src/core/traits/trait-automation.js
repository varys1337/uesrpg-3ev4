/**
 * @module traits/trait-automation
 * @description Trait application automation — disease resistance prompts and
 * trait-key parsing helpers.
 *
 * Target: Foundry VTT v13.351
 */

import { getDiseaseResistancePercent } from "./trait-registry.js";
import { doesUserOwnActor } from "../../utils/authority-proxy.js";

function _norm(str) {
  return String(str ?? "").trim();
}

function _getOwnerUserIds(actor) {
  const out = new Set();
  const users = game.users?.contents ?? [];

  for (const user of users) {
    if (!user) continue;
    if (user.isGM) {
      out.add(user.id);
      continue;
    }
    if (doesUserOwnActor(user, actor)) out.add(user.id);
  }

  return Array.from(out);
}

function _escape(str) {
  return foundry.utils.escapeHTML(String(str ?? ""));
}

export function renderDiseasedCheckCard({ actor, sourceLabel = "Disease", traitValue = 0, result = null } = {}) {
  const mod = Number(traitValue ?? 0) || 0;
  const modLabel = mod >= 0 ? `+${mod}` : `${mod}`;
  const resistPercent = actor ? getDiseaseResistancePercent(actor) : 0;
  const isResolved = !!result;
  let resultHtml = "";
  if (isResolved) {
    const immune = result?.immune === true;
    const passed = result?.passed === true;
    const resisted = result?.resisted === true;
    const outcome = immune
      ? "Immune to disease."
      : (passed ? "Success - no disease." : (resisted ? "Failed test, but Disease Resistance prevented infection." : "Failed test - contracts disease."));
    const lines = [
      `<p><b>Outcome:</b> ${_escape(outcome)}</p>`,
    ];
    if (Number.isFinite(Number(result?.tn))) lines.push(`<p><b>Endurance TN:</b> ${Number(result.tn)}</p>`);
    if (Number.isFinite(Number(result?.roll))) lines.push(`<p><b>Roll:</b> ${Number(result.roll)}</p>`);
    if (Number.isFinite(Number(result?.resistPercent)) && Number.isFinite(Number(result?.resistRoll))) {
      lines.push(`<p><b>Disease Resistance:</b> ${Number(result.resistPercent)}% - roll ${Number(result.resistRoll)}</p>`);
    }
    resultHtml = `<div class="uesrpg-disease-result" style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.12);">${lines.join("")}</div>`;
  }

  return `
    <div class="uesrpg-disease-card">
      <h3>Diseased (${modLabel})</h3>
      <p><b>Source:</b> ${_escape(sourceLabel)}</p>
      <p>Target must pass an <b>Endurance</b> test ${modLabel} or contract a common disease.</p>
      ${resistPercent > 0 ? `<p><b>Disease Resistance:</b> ${resistPercent}% (if test fails)</p>` : ""}
      ${!isResolved ? `<div style="margin-top:6px;">
        <button type="button" data-ues-disease-action="roll"
          data-actor-uuid="${_escape(actor?.uuid ?? "")}"
          data-trait-value="${mod}"
          data-source-label="${_escape(sourceLabel)}">
          Roll Endurance (Diseased)
        </button>
      </div>` : ""}
      ${resultHtml}
    </div>
  `;
}

export function renderRegenerationPromptCard({ actor, value = 0, round = null, result = null } = {}) {
  const roundLabel = Number.isFinite(Number(round)) ? `Round ${Number(round)}` : "Start of Round";
  const isResolved = !!result;
  let resultHtml = "";
  if (isResolved) {
    const passed = result?.passed === true;
    const healed = Math.max(0, Number(result?.healed ?? 0) || 0);
    const lines = [
      `<div><b>Outcome:</b> ${passed ? `Success - healed ${healed} HP` : "Failed - no healing"}</div>`,
    ];
    if (Number.isFinite(Number(result?.tn))) lines.push(`<div><b>Endurance TN:</b> ${Number(result.tn)}</div>`);
    if (Number.isFinite(Number(result?.roll))) lines.push(`<div><b>Roll:</b> ${Number(result.roll)}</div>`);
    resultHtml = `<div class="uesrpg-regeneration-result" style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.12);">${lines.join("")}</div>`;
  }

  return `
    <div class="uesrpg-regeneration-card">
      <h3>Regeneration (${Math.max(0, Number(value ?? 0) || 0)})</h3>
      <p><b>${roundLabel}:</b> Make an Endurance test to heal ${Math.max(0, Number(value ?? 0) || 0)} HP.</p>
      ${!isResolved ? `<div style="margin-top:6px;">
        <button type="button" data-ues-regeneration-action="roll"
          data-actor-uuid="${_escape(actor?.uuid ?? "")}"
          data-regen-value="${Math.max(0, Number(value ?? 0) || 0)}">
          Roll Endurance (Regeneration)
        </button>
      </div>` : ""}
      ${resultHtml}
    </div>
  `;
}

export async function postDiseasedCheckCard({ attacker, defender, traitValue = 0, sourceItem = null } = {}) {
  if (!defender) return null;
  const mod = Number(traitValue ?? 0) || 0;
  const sourceLabel = _norm(sourceItem?.name) || _norm(attacker?.name) || "Attack";
  const content = renderDiseasedCheckCard({ actor: defender, sourceLabel, traitValue: mod });

  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    content,
    whisper: _getOwnerUserIds(defender),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      "uesrpg-3ev4": {
        diseaseCheck: {
          actorUuid: defender.uuid,
          attackerUuid: attacker?.uuid ?? null,
          traitValue: mod,
          sourceItemUuid: sourceItem?.uuid ?? null,
          createdAt: Date.now()
        }
      }
    }
  });
}

/**
 * Post a single aggregated regeneration prompt card for multiple actors.
 *
 * Used by the round-start orchestrator when `aggregateRegenPrompts` is enabled.
 * Instead of N chat messages (one per actor), a single message is created,
 * whispered to the union of all owning users across all entries.
 *
 * Each actor row contains its own Roll Endurance button with the actor UUID,
 * so button handlers work identically to the per-actor prompt.
 *
 * @param {Array<{actor: Actor, traitValue: number}>} entries
 * @param {{ round?: number|null }} [options]
 * @returns {Promise<ChatMessage|null>}
 */
export async function postRegenPromptBatch(entries, { round = null } = {}) {
  if (!entries?.length) return null;

  const roundLabel = Number.isFinite(Number(round)) ? `Round ${Number(round)}` : "Start of Round";

  // Collect union of all owner user IDs across all affected actors.
  const whisperSet = new Set();
  for (const { actor } of entries) {
    for (const id of _getOwnerUserIds(actor)) whisperSet.add(id);
  }

  const rows = entries.map(({ actor, traitValue }) => {
    const value = Math.max(0, Number(traitValue ?? 0) || 0);
    const name = foundry.utils.escapeHTML(String(actor?.name ?? "Actor"));
    return `<div class="uesrpg-regeneration-actor" style="display:flex;align-items:center;gap:8px;margin-top:4px;">
      <span style="flex:1;"><b>${name}</b> — Regeneration (${value})</span>
      <button type="button" data-ues-regeneration-action="roll"
        data-actor-uuid="${actor.uuid}"
        data-regen-value="${value}"
        style="flex:0 0 auto;">
        Roll Endurance
      </button>
    </div>`;
  }).join("\n");

  const content = `<div class="uesrpg-regeneration-card">
    <h3>Regeneration — ${roundLabel}</h3>
    ${rows}
  </div>`;

  return ChatMessage.create({
    user: game.user.id,
    content,
    whisper: Array.from(whisperSet),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      "uesrpg-3ev4": {
        regenerationPromptBatch: {
          entries: entries.map(e => ({ actorUuid: e.actor.uuid, value: Number(e.traitValue ?? 0) })),
          round: Number.isFinite(Number(round)) ? Number(round) : null,
          createdAt: Date.now()
        }
      }
    }
  });
}

export async function postRegenerationPrompt({ actor, traitValue = 0, round = null } = {}) {
  if (!actor) return null;
  const value = Math.max(0, Number(traitValue ?? 0) || 0);
  if (value <= 0) return null;

  const content = renderRegenerationPromptCard({ actor, value, round });

  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    whisper: _getOwnerUserIds(actor),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      "uesrpg-3ev4": {
        regenerationPrompt: {
          actorUuid: actor.uuid,
          value,
          round: Number.isFinite(Number(round)) ? Number(round) : null,
          createdAt: Date.now()
        }
      }
    }
  });
}
