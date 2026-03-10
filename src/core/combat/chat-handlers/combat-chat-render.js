/**
 * src/core/combat/chat-handlers/combat-chat-render.js
 *
 * renderChatMessageHTML hook body — DOM augmentation, permission gating,
 * talent reroll / Imperial Luck injection, action card init, and scroll-to-bottom.
 */

import { canUserRollActor } from "../../../utils/permissions.js";
import { getGeneralTalentRerollEligibility, rerollSkillTestFromChatMessage } from "../../traits/general-talents.js";
import { hasTalent } from "../../traits/talents-api.js";
import { canApplyCharGenGatedImperialTalents } from "../../traits/racial-talents.js";
import { resolveActorFromUuidSync } from "../../../utils/uuid-cache.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { getFlagValueWithFallback } from "../../system/flags.js";
import {
  getMessageState as getMagicMessageState,
  getDefenderEntries as getMagicDefenderEntries,
} from "../../magic/opposed/schema.js";
import { requestUpdateDocument, requestUpdateChatMessage } from "../../../utils/authority-proxy.js";
import { resolveActor, getWhisperRecipients } from "./combat-chat-apply.js";
import { getSkillOpposedState, getCharOpposedState } from "./combat-chat-opposed.js";

const _FLAG_NS = FLAG_SCOPE;

function _getOpposedDamageReportByKey(message, panelKey) {
  const raw = message?.flags?.[_FLAG_NS]?.opposed ?? null;
  if (!raw || !panelKey) return null;
  const matchDamage = (node) => {
    const report = node?.damage?.gmDamageReport ?? null;
    return String(report?.panelKey ?? "").trim() === panelKey ? report : null;
  };
  if (Array.isArray(raw?.defenders)) {
    for (const node of raw.defenders) {
      const hit = matchDamage(node);
      if (hit) return hit;
    }
  }
  return matchDamage(raw?.defender ?? raw);
}

function _getOpposedDamageReportByTarget(message, targetUuid) {
  const raw = message?.flags?.[_FLAG_NS]?.opposed ?? null;
  if (!raw || !targetUuid) return null;
  const matchDamage = (node) => {
    const sameActor = String(node?.actorUuid ?? "").trim() === targetUuid;
    const sameToken = String(node?.tokenUuid ?? "").trim() === targetUuid;
    if (!sameActor && !sameToken) return null;
    return node?.damage?.gmDamageReport ?? null;
  };
  if (Array.isArray(raw?.defenders)) {
    for (const node of raw.defenders) {
      const hit = matchDamage(node);
      if (hit) return hit;
    }
  }
  return matchDamage(raw?.defender ?? raw);
}

function _getFirstOpposedDamageReport(message) {
  const raw = message?.flags?.[_FLAG_NS]?.opposed ?? null;
  if (!raw) return null;
  if (Array.isArray(raw?.defenders)) {
    for (const node of raw.defenders) {
      const report = node?.damage?.gmDamageReport ?? null;
      if (report) return report;
    }
  }
  return raw?.defender?.damage?.gmDamageReport ?? raw?.damage?.gmDamageReport ?? null;
}

function _getMagicState(message) {
  const raw = getMagicMessageState(message);
  return raw?.state ?? raw ?? null;
}

function _getMagicDamageReportByKey(message, panelKey) {
  const raw = _getMagicState(message);
  if (!raw || !panelKey) return null;
  const matchDamage = (node) => {
    const report = node?.damage?.gmDamageReport ?? null;
    return String(report?.panelKey ?? "").trim() === panelKey ? report : null;
  };
  if (Array.isArray(raw?.defenders)) {
    for (const node of raw.defenders) {
      const hit = matchDamage(node);
      if (hit) return hit;
    }
  }
  return matchDamage(raw?.defender ?? raw);
}

function _getMagicDamageReportByTarget(message, targetUuid) {
  const raw = _getMagicState(message);
  if (!raw || !targetUuid) return null;
  const matchDamage = (node) => {
    const sameActor = String(node?.actorUuid ?? "").trim() === targetUuid;
    const sameToken = String(node?.tokenUuid ?? "").trim() === targetUuid;
    if (!sameActor && !sameToken) return null;
    return node?.damage?.gmDamageReport ?? null;
  };
  if (Array.isArray(raw?.defenders)) {
    for (const node of raw.defenders) {
      const hit = matchDamage(node);
      if (hit) return hit;
    }
  }
  return matchDamage(raw?.defender ?? raw);
}

function _getFirstMagicDamageReport(message) {
  const raw = _getMagicState(message);
  if (!raw) return null;
  if (Array.isArray(raw?.defenders)) {
    for (const node of raw.defenders) {
      const report = node?.damage?.gmDamageReport ?? null;
      if (report) return report;
    }
  }
  return raw?.defender?.damage?.gmDamageReport ?? raw?.damage?.gmDamageReport ?? null;
}

function _renderGmDamageReportHtml(report) {
  if (!report || typeof report !== "object") return "";
  const hp = report.hp ?? {};
  const summaryCells = [
    `<div><b>Total</b> ${Number(report.totalDamage ?? 0) || 0}</div>`,
    `<div><b>HP</b> ${Number(hp.value ?? 0) || 0}/${Number(hp.max ?? 0) || 0}${Number(hp.delta ?? 0) ? ` <span class="muted">(-${Number(hp.delta ?? 0) || 0})</span>` : ""}</div>`
  ];
  if (report.tempHp) summaryCells.push(`<div><b>Temp</b> ${Number(report.tempHp.value ?? 0) || 0}${Number(report.tempHp.absorbed ?? 0) ? ` <span class="muted">(-${Number(report.tempHp.absorbed ?? 0) || 0})</span>` : ""}</div>`);
  for (const buffer of (Array.isArray(report.buffers) ? report.buffers : [])) {
    summaryCells.push(`<div><b>${foundry.utils.escapeHTML(String(buffer.pool ?? ""))}</b> ${Number(buffer.remaining ?? 0) || 0} <span class="muted">(-${Number(buffer.absorbed ?? 0) || 0})</span></div>`);
  }
  const statusBits = [];
  if (Array.isArray(report.traitNotes) && report.traitNotes.length) statusBits.push(report.traitNotes.map((note) => foundry.utils.escapeHTML(String(note ?? ""))).join(" | "));
  if (report.woundTriggered) {
    statusBits.push(`WOUNDED (WT ${Number(report.woundThreshold ?? 0) || 0})`);
  }
  if (report.defeated) {
    statusBits.push("DEFEATED / UNCONSCIOUS");
  }

  const segmentHtml = (Array.isArray(report.segments) ? report.segments : []).map((segment) => `
    <div class="uesrpg-da-segment" style="margin-top:6px;">
      <div style="display:grid; grid-template-columns:auto auto auto; gap:10px; font-size:12px;">
        <div><b>${foundry.utils.escapeHTML(String(segment.damageType ?? "physical"))}</b></div>
        <div>Raw ${Number(segment.rawDamage ?? 0) || 0}</div>
        <div>Applied <b>${Number(segment.applied ?? 0) || 0}</b></div>
      </div>
      ${(Array.isArray(segment.sourceNotes) ? segment.sourceNotes : []).map((note) => `<div style="font-size:11px; opacity:0.85;">${foundry.utils.escapeHTML(String(note ?? ""))}</div>`).join("")}
      ${(Array.isArray(segment.reductionNotes) ? segment.reductionNotes : []).map((note) => `<div style="font-size:11px; opacity:0.85;">${foundry.utils.escapeHTML(String(note ?? ""))}</div>`).join("")}
      <div style="font-size:11px; opacity:0.9; margin-top:2px;">Total Reduction -${Number(segment.reductionTotal ?? 0) || 0}</div>
    </div>
  `).join("");

  return `<div class="uesrpg-gm-damage-breakdown" style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.12);">
    <div style="font-weight:700; margin-bottom:4px; font-size:12px;">Damage Breakdown</div>
    <div style="display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:4px 10px; font-size:12px;">
      ${summaryCells.join("")}
    </div>
    ${statusBits.length ? `<div style="margin-top:4px; font-size:11px; opacity:0.9;">${statusBits.join(" | ")}</div>` : ``}
    ${segmentHtml}
  </div>`;
}

function _injectOpposedGmDamageBreakdown(message, root) {
  if (!game.user?.isGM) return;
  root.querySelectorAll("[data-ues-gm-damage-report-key]").forEach((anchor) => {
    if (anchor.dataset.uesGmDamageHydrated === "1") return;
    const panelKey = String(anchor.dataset.uesGmDamageReportKey ?? "").trim();
    const targetUuid = String(anchor.dataset.uesGmDamageTarget ?? "").trim();
    const report = (panelKey ? _getOpposedDamageReportByKey(message, panelKey) : null)
      ?? (targetUuid ? _getOpposedDamageReportByTarget(message, targetUuid) : null)
      ?? (panelKey ? _getMagicDamageReportByKey(message, panelKey) : null)
      ?? (targetUuid ? _getMagicDamageReportByTarget(message, targetUuid) : null);
    const fallbackReport = report ?? _getFirstOpposedDamageReport(message) ?? _getFirstMagicDamageReport(message);
    if (!fallbackReport) return;
    anchor.innerHTML = _renderGmDamageReportHtml(fallbackReport);
    anchor.dataset.uesGmDamageHydrated = "1";
  });
}

// ── Skill test flag helpers ───────────────────────────────────────────────────

function _getSkillTestFlags(message) {
  const st = getFlagValueWithFallback(message, "skillTest");
  return (st && typeof st === "object") ? st : null;
}

function _isTalentRerollUsed(message) {
  const r = getFlagValueWithFallback(message, "reroll");
  return Boolean(r?.used === true || r?.isReroll === true);
}

function _canUserExecuteTalentReroll(message) {
  return Boolean(game.user?.isGM) || Boolean(message?.isAuthor);
}

function _getImperialLuckSpentLp(message) {
  return Number(getFlagValueWithFallback(message, "imperialLuck.lpSpent") ?? 0) || 0;
}

function _canUserSpendLuckForActor(actor) {
  return canUserRollActor(game.user, actor);
}

// ── Talent reroll injection ───────────────────────────────────────────────────

function _injectTalentRerollButton(message, root) {
  try {
    if (!message || !root) return;
    if (root.querySelector('[data-uesrpg-action="reroll-talent"]')) return;

    const st = _getSkillTestFlags(message);
    if (!st) return;
    if (st.isReroll === true) return;
    if (st.isSuccess !== false) return;
    if (_isTalentRerollUsed(message)) return;

    const actorUuid = String(st.actorUuid ?? "").trim();
    if (!actorUuid) return;
    const actor = resolveActor(message, actorUuid);
    if (!actor) return;

    const skillName = String(st.skillName ?? "").trim();
    if (!skillName) return;

    const eligibility = getGeneralTalentRerollEligibility(actor, {
      skillName,
      useSpecialization: Boolean(st.useSpecialization),
    });
    if (!eligibility) return;

    const canExec = _canUserExecuteTalentReroll(message);

    const wrap = document.createElement("div");
    wrap.className = "uesrpg-chat-actions";
    wrap.style.marginTop = "6px";
    wrap.style.display = "flex";
    wrap.style.gap = "8px";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.uesrpgAction = "reroll-talent";
    btn.className = "uesrpg-btn uesrpg-reroll-talent-btn";
    btn.textContent = "Reroll (Talent)";

    if (!canExec) {
      btn.setAttribute("disabled", "disabled");
      btn.setAttribute("title", "Only the roll author or a GM can execute a talent reroll.");
    } else {
      btn.setAttribute("title", `Talent reroll: ${eligibility.source === "grandmaster" ? "Grandmaster" : "Expert"}`);
    }

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const ok = await rerollSkillTestFromChatMessage(message);
        if (!ok) {
          ui.notifications?.warn?.("Talent reroll could not be executed.");
          btn.disabled = false;
        }
      } catch (err) {
        console.error("UESRPG | Talent reroll failed", err);
        ui.notifications?.error?.("Talent reroll failed. Check console for details.");
        btn.disabled = false;
      }
    });

    wrap.appendChild(btn);

    const anchor =
      root.querySelector(".dice-roll .dice-result") ??
      root.querySelector(".message-content") ??
      root;
    anchor.appendChild(wrap);
  } catch (_e) {
    // Do not hard-fail chat rendering.
  }
}

// ── Imperial Luck injection ───────────────────────────────────────────────────

function _injectImperialLuckDoSButton(message, root) {
  try {
    if (!message || !root) return;
    if (root.querySelector('[data-uesrpg-action="imperialluck-dos"]')) return;

    const st = _getSkillTestFlags(message);
    if (!st) return;
    if (st.isSuccess !== true) return;

    const actorUuid = String(st.actorUuid ?? "").trim();
    if (!actorUuid) return;
    const actor = resolveActor(message, actorUuid);
    if (!actor) return;

    if (!hasTalent(actor, "imperialluck")) return;
    if (!canApplyCharGenGatedImperialTalents(actor, { warnTalentName: "Imperial Luck" })) return;

    const canSpend = _canUserSpendLuckForActor(actor);
    const currentLp = Number(actor.system?.luck_points?.value ?? 0) || 0;
    if (currentLp <= 0) return;

    const lpSpent = _getImperialLuckSpentLp(message);
    const nextBonus = (lpSpent === 0) ? 2 : 1;

    const wrap = document.createElement("div");
    wrap.className = "uesrpg-chat-actions";
    wrap.style.marginTop = "6px";
    wrap.style.display = "flex";
    wrap.style.gap = "8px";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.uesrpgAction = "imperialluck-dos";
    btn.className = "uesrpg-btn uesrpg-imperialluck-dos-btn";
    btn.textContent = `Spend 1 LP (+${nextBonus} DoS)`;

    if (!canSpend) {
      btn.setAttribute("disabled", "disabled");
      btn.setAttribute("title", "You do not have permission to spend Luck Points for this actor.");
    } else {
      btn.setAttribute("title", "Imperial Luck: first LP spent on this test adds +2 DoS, then +1 per LP.");
    }

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      let succeeded = false;
      try {
        const freshActor = resolveActor(message, actorUuid) ?? actor;
        if (!freshActor) return;
        if (!hasTalent(freshActor, "imperialluck")) return;
        if (!canApplyCharGenGatedImperialTalents(freshActor, { warnTalentName: "Imperial Luck" })) return;
        if (!_canUserSpendLuckForActor(freshActor)) return;

        const lpNow = Number(freshActor.system?.luck_points?.value ?? 0) || 0;
        if (lpNow <= 0) {
          ui.notifications?.warn?.("No Luck Points remaining.");
          return;
        }

        const freshMsg = game.messages?.get?.(message.id) ?? message;
        const spent = _getImperialLuckSpentLp(freshMsg);
        const add = (spent === 0) ? 2 : 1;

        await requestUpdateDocument(freshActor, { "system.luck_points.value": Math.max(0, lpNow - 1) });

        const stNow = _getSkillTestFlags(freshMsg) ?? st;
        const currentDegree = Number(stNow?.degree ?? 0) || 0;
        const alreadyAdded = Number(getFlagValueWithFallback(freshMsg, "imperialLuck.dosAdded") ?? 0) || 0;
        const nextDegree = Math.max(0, currentDegree + add);

        await requestUpdateChatMessage(message, {
          [`flags.${_FLAG_NS}.imperialLuck.lpSpent`]: spent + 1,
          [`flags.${_FLAG_NS}.imperialLuck.dosAdded`]: alreadyAdded + add,
          [`flags.${_FLAG_NS}.skillTest.degree`]: nextDegree,
          [`flags.${_FLAG_NS}.skillTest.textual`]: `${nextDegree} DoS`,
        });

        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: freshActor }),
          content: `<div class="uesrpg"><b>Imperial Luck</b>: spent 1 LP, +${add} DoS (now ${nextDegree} DoS).</div>`,
          whisper: getWhisperRecipients(freshActor),
          style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        });
        succeeded = true;
      } catch (err) {
        console.error("UESRPG | Imperial Luck spend failed", err);
        ui.notifications?.error?.("Imperial Luck spend failed. Check console for details.");
      } finally {
        if (!succeeded) btn.disabled = false;
      }
    });

    wrap.appendChild(btn);

    const anchor =
      root.querySelector(".dice-roll .dice-result") ??
      root.querySelector(".message-content") ??
      root;
    anchor.appendChild(wrap);
  } catch (_e) {
    // Do not hard-fail chat rendering.
  }
}

// ── Public render augmentation ────────────────────────────────────────────────

/**
 * Augment a rendered chat message with permission gating, button state,
 * talent reroll / Imperial Luck affordances, action card init, and scroll.
 *
 * Called from the renderChatMessageHTML hook.
 * @param {ChatMessage} message
 * @param {HTMLElement} root
 */
export function augmentChatMessageHTML(message, root) {
  _injectOpposedGmDamageBreakdown(message, root);

  // Skill opposed-roll chat card buttons.
  root.querySelectorAll("[data-ues-skill-opposed-action]").forEach((el) => {
    const action = el.dataset.uesSkillOpposedAction;
    const data = getSkillOpposedState(message);
    const actorUuid = (action === "attacker-roll") ? data?.attacker?.actorUuid : (action === "defender-roll") ? data?.defender?.actorUuid : null;
    const actor = actorUuid ? resolveActorFromUuidSync(actorUuid) : null;

    if (actor && !canUserRollActor(game.user, actor)) {
      el.setAttribute("disabled", "disabled");
      el.setAttribute("title", "You do not have permission to roll for this actor.");
    }
  });

  // Magic opposed-roll chat card buttons (permission gate).
  root.querySelectorAll("[data-ues-magic-opposed-action]").forEach((el) => {
    const action = el.dataset.uesMagicOpposedAction;
    const raw = getMagicMessageState(message);
    const data = raw?.state ?? raw ?? null;
    const defenderIndexRaw = el.dataset?.defenderIndex;
    const defenderIndex = Number.isFinite(Number(defenderIndexRaw)) ? Number(defenderIndexRaw) : null;
    const defenders = getMagicDefenderEntries(data);
    const defender = (defenderIndex != null && Array.isArray(defenders)) ? defenders[defenderIndex] : (data?.defender ?? null);
    const actorUuid = (action === "attacker-roll" || action === "attacker-commit")
      ? data?.attacker?.actorUuid
      : (action?.startsWith?.("defender-") ? defender?.actorUuid : null);
    const actor = actorUuid ? resolveActorFromUuidSync(actorUuid) : null;

    if (actor && !canUserRollActor(game.user, actor)) {
      el.setAttribute("disabled", "disabled");
      el.setAttribute("title", "You do not have permission to roll for this actor.");
    }
  });

  // Hide GM-only elements for non-GM users (client-local visibility).
  if (!game.user.isGM) {
    root.querySelectorAll("[data-ues-gm-only]").forEach((el) => {
      el.style.display = "none";
    });
  }

  // Characteristic opposed-roll chat card buttons.
  root.querySelectorAll("[data-ues-char-opposed-action]").forEach((el) => {
    const action = el.dataset.uesCharOpposedAction;
    const data = getCharOpposedState(message);
    const actorUuid = (action === "attacker-roll") ? data?.attacker?.actorUuid : (action === "defender-roll") ? data?.defender?.actorUuid : null;
    const actor = actorUuid ? resolveActorFromUuidSync(actorUuid) : null;

    if (actor && !canUserRollActor(game.user, actor)) {
      el.setAttribute("disabled", "disabled");
      el.setAttribute("title", "You do not have permission to roll for this actor.");
    }
  });

  // Shock Test chat card buttons (Wounds).
  root.querySelectorAll("[data-ues-shock-action]").forEach((el) => {
    const actorUuid = el.dataset.actorUuid;
    const actor = actorUuid ? resolveActorFromUuidSync(actorUuid) : null;

    if (actor && !canUserRollActor(game.user, actor)) {
      el.setAttribute("disabled", "disabled");
      el.setAttribute("title", "You do not have permission to roll for this actor.");
    }
  });

  // Death Test chat card buttons (Wounds).
  root.querySelectorAll("[data-ues-death-action]").forEach((el) => {
    const actorUuid = el.dataset.actorUuid;
    const actor = actorUuid ? resolveActorFromUuidSync(actorUuid) : null;

    if (actor && !canUserRollActor(game.user, actor)) {
      el.setAttribute("disabled", "disabled");
      el.setAttribute("title", "You do not have permission to roll for this actor.");
    }
  });

  // Disease check buttons.
  root.querySelectorAll("[data-ues-disease-action]").forEach((el) => {
    const actorUuid = el.dataset.actorUuid;
    const actor = actorUuid ? resolveActorFromUuidSync(actorUuid) : null;

    if (actor && !canUserRollActor(game.user, actor)) {
      el.setAttribute("disabled", "disabled");
      el.setAttribute("title", "You do not have permission to roll for this actor.");
    }
  });

  // Regeneration check buttons.
  root.querySelectorAll("[data-ues-regeneration-action]").forEach((el) => {
    const actorUuid = el.dataset.actorUuid;
    const actor = actorUuid ? resolveActorFromUuidSync(actorUuid) : null;

    if (actor && !canUserRollActor(game.user, actor)) {
      el.setAttribute("disabled", "disabled");
      el.setAttribute("title", "You do not have permission to roll for this actor.");
    }
  });

  // Special Action opposed test card buttons (permission gating only).
  root.querySelectorAll("[data-ues-special-action]").forEach((el) => {
    const action = el.dataset.uesSpecialAction;

    const state = message.flags?.["uesrpg-3ev4"]?.specialActionOpposed?.state;
    const actorUuid = (action === "attacker-roll")
      ? state?.attacker?.actorUuid
      : (action === "defender-roll")
        ? state?.defender?.actorUuid
        : null;
    const actor = actorUuid ? resolveActorFromUuidSync(actorUuid) : null;

    if (actor && !canUserRollActor(game.user, actor)) {
      el.setAttribute("disabled", "disabled");
      el.setAttribute("title", "You do not have permission to roll for this actor.");
    }
  });

  // Collapsible action cards (sheet quick-actions).
  // IMPORTANT: Foundry chat sanitization may strip the `hidden` attribute.
  // We therefore enforce the default collapsed state at render time and
  // toggle via inline `style.display` (actual toggle click is delegated).
  root.querySelectorAll(".uesrpg-action-card[data-ues-action-card]").forEach((card) => {
    const body = card.querySelector("[data-ues-action-card-body]");
    const btn = card.querySelector("[data-ues-action-card-toggle]");
    if (!body || !btn) return;

    // One-time initialization per rendered DOM instance.
    if (!card.dataset.uesActionCardInit) {
      card.dataset.uesActionCardInit = "1";

      // Default collapsed unless explicitly marked expanded.
      const isExpanded = String(card.dataset.uesActionCardExpanded ?? "0") === "1";
      body.style.display = isExpanded ? "" : "none";
      body.setAttribute("aria-hidden", isExpanded ? "false" : "true");
      btn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      btn.textContent = isExpanded ? "Collapse" : "Expand";
    }

    // Ensure consistent button styling (prevents awkward wrapping).
    if (!btn.style.whiteSpace) btn.style.whiteSpace = "nowrap";
    if (!btn.style.display) btn.style.display = "inline-flex";
    if (!btn.style.alignItems) btn.style.alignItems = "center";
    if (!btn.style.justifyContent) btn.style.justifyContent = "center";
  });

  // General talents: Expert / Grandmaster reroll affordance on failed skill tests.
  _injectTalentRerollButton(message, root);

  // Imperial racial talent: Imperial Luck (Chapter 4) spend LP for extra DoS on successful tests.
  _injectImperialLuckDoSButton(message, root);

  // Scroll chat to bottom when the last message renders (new card or card update).
  // Uses requestAnimationFrame so scrollHeight reflects the final post-render layout.
  const _lastMsg = game.messages?.contents?.at(-1);
  if (_lastMsg && message.id === _lastMsg.id) {
    requestAnimationFrame(() => ui.chat?.scrollBottom?.());
  }

  // Scroll to bottom when a <details> TN breakdown is expanded on the last message.
  if (_lastMsg && message.id === _lastMsg.id) {
    root.querySelectorAll("details").forEach((el) => {
      el.addEventListener("toggle", () => {
        if (el.open) requestAnimationFrame(() => ui.chat?.scrollBottom?.());
      });
    });
  }
}
