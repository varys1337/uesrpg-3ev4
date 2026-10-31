/**
 * src/core/combat/chat-handlers/combat-chat-render.js
 *
 * renderChatMessageHTML hook body — DOM augmentation, permission gating,
 * talent reroll / Imperial Luck injection, action card init, and disclosure anchoring.
 */

import { canUserRollActor } from "../../../utils/permissions.js";
import { getGeneralTalentRerollEligibility, rerollSkillTestFromChatMessage } from "../../traits/general-talents.js";
import { getPendingImperialLuckOperation, hasActiveImperialLuck, hasUntrackedImperialLuckHistory } from "../../luck/imperial-luck.js";
import { canUseLuck } from "../../rules/npc-rules.js";
import { resolveActorFromUuidSync } from "../../../utils/uuid-cache.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { getFlagValueWithFallback } from "../../system/flags.js";
import {
  getMessageState as getMagicMessageState,
  getDefenderEntries as getMagicDefenderEntries,
  getMagicDefenderDamage,
} from "../../magic/opposed/schema.js";
import { _getDefenderEntries, _getDefenderDamage } from "../opposed/schema.js";
import { getChatOutcomes, getChatOutcomeReceipt } from "../../../application/combat/chat-outcome-application-service.js";
import { projectGmDamageExplanation, selectDamageExplanationLane } from "../damage/explanation.js";
import { renderWeaponDamageExplanation } from "../opposed/cards/template-helpers.js";
import { renderGmDamageReportHtml } from "../../../ui/combat/damage-explanation.js";
import { renderOpposedTestDetails } from "../../../ui/combat/test-explanation.js";
import { projectOpposedTestExplanation } from "../opposed/explanation.js";
import { escapeHtml } from "../../../utils/html.js";
import { confirmDialog } from "../../../utils/dialog-v2-helper.js";
import { t } from "../../../utils/i18n.js";
import { canUserUpdateChatMessage, requestAtomicUpdateDocument, requestUpdateChatMessage } from "../../../utils/authority-proxy.js";
import { resolveActor, getWhisperRecipients } from "./combat-chat-apply.js";
import { getSkillOpposedState, getCharOpposedState } from "./combat-chat-opposed.js";
import { markSystemTooltipScope, setSystemTooltip } from "../../../ui/shared/system-tooltips.js";

const _FLAG_NS = FLAG_SCOPE;

const _disclosureBoundRoots = new WeakSet();
const _disclosureSelector = "details.uesrpg-chat-details, details.dmg-details";

function _findDisclosureScroller(summary) {
  const view = summary.ownerDocument.defaultView;
  for (let element = summary.parentElement; element; element = element.parentElement) {
    if (element.clientHeight && /^(auto|scroll)$/.test(view.getComputedStyle(element).overflowY)) return element;
  }
  return null;
}

/** Keep a user-activated disclosure heading anchored without changing Foundry's new-message scrolling. */
function _bindDisclosureScrollAnchors(root) {
  if (_disclosureBoundRoots.has(root) || !root.querySelector(_disclosureSelector)) return;
  _disclosureBoundRoots.add(root);
  const view = root.ownerDocument.defaultView;
  let pending = null;
  const remember = event => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const summary = event.target.closest("summary");
    const details = summary?.parentElement;
    if (!details?.matches(_disclosureSelector) || !root.contains(details)) return;
    if (event.target.closest("a, button, input, select, textarea")) return;
    const scroller = _findDisclosureScroller(summary);
    if (!scroller) return;
    pending?.cancel();
    const controller = new view.AbortController();
    const anchor = {
      summary, details, scroller, open: details.open,
      offset: summary.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      cancel() {
        controller.abort();
        if (pending === anchor) pending = null;
      }
    };
    pending = anchor;
    const options = { capture: true, passive: true, signal: controller.signal };
    for (const name of ["wheel", "touchmove", "pointerdown"]) scroller.addEventListener(name, anchor.cancel, options);
    scroller.addEventListener("keydown", nextEvent => {
      if (nextEvent === event) return;
      if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(nextEvent.key)) anchor.cancel();
    }, options);
    const restore = final => {
      if (pending !== anchor) return;
      if (anchor.details.open === anchor.open || !root.isConnected || !anchor.summary.isConnected || !anchor.scroller.isConnected || !root.contains(anchor.summary)) {
        anchor.cancel();
        return;
      }
      const offset = anchor.summary.getBoundingClientRect().top - anchor.scroller.getBoundingClientRect().top;
      const max = Math.max(0, anchor.scroller.scrollHeight - anchor.scroller.clientHeight);
      const top = Math.min(max, Math.max(0, anchor.scroller.scrollTop + offset - anchor.offset));
      if (Math.abs(top - anchor.scroller.scrollTop) > 0.5) anchor.scroller.scrollTop = top;
      if (final) anchor.cancel();
    };
    view.requestAnimationFrame(() => {
      restore(false);
      view.requestAnimationFrame(() => restore(true));
    });
  };
  // Native summary pointer, Enter, and Space activation all dispatch click before changing open.
  // Read open on the next frame: the asynchronously coalesced toggle event can arrive later.
  root.addEventListener("click", remember, true);
}

const _CHAT_SURFACE_SELECTOR = [
  ".message-content > .uesrpg",
  ".message-content > .ues-opposed-card",
  ".message-content > [class*='uesrpg-']",
  ".message-content > [class*='ues-']",
  ".message-content > [class*='warfare-']",
  ".message-content .ues-opposed-card",
  ".message-content .uesrpg-chat-card",
].join(", ");

/**
 * Give every rendered UESRPG card the same presentation root without
 * rewriting stored ChatMessage content. This runs inside the system's
 * existing renderChatMessageHTML boundary and is idempotent.
 */
function _markChatSurfaces(message, root) {
  if (!(root instanceof HTMLElement)) return;
  const surfaces = new Set(root.querySelectorAll(_CHAT_SURFACE_SELECTOR));
  const messageContent = root.matches?.(".message-content") ? root : root.querySelector(".message-content");
  const systemFlags = message?.flags?.[_FLAG_NS];
  if (messageContent && systemFlags && typeof systemFlags === "object" && Object.keys(systemFlags).length) {
    for (const child of messageContent.children) surfaces.add(child);
  }
  messageContent?.querySelectorAll?.("[data-ues-opposed-action], [data-ues-magic-opposed-action], [data-ues-skill-opposed-action], [data-ues-special-action], [data-ues-shock-action], [data-ues-death-action]").forEach((control) => {
    const directCard = control.closest(".message-content > *");
    if (directCard) surfaces.add(directCard);
  });
  surfaces.forEach((element) => {
    element.classList.add("uesrpg-chat-surface");
    markSystemTooltipScope(element);
  });
}

function _injectOpposedTestExplanations(message, root) {
  if (game.user?.isGM !== true || message.visible !== true || message.isContentVisible !== true) return;
  if (!game.settings.get(_FLAG_NS, "opposedShowResolutionDetails")) return;
  const state = message.flags?.[_FLAG_NS]?.opposed;
  if (!state) return;
  const candidates = _getDefenderEntries(state).filter(participant => participant && typeof participant === "object").map(participant => ({
    participant, targetUuid: participant.tokenUuid || participant.actorUuid,
    actorUuid: participant.actorUuid, tokenUuid: participant.tokenUuid,
  }));
  for (const disclosure of root.querySelectorAll(".uesrpg-chat-resolution-details[data-ues-test-target]")) {
    const targetUuid = disclosure.dataset.uesTestTarget;
    const lane = selectDamageExplanationLane(candidates, { targetUuid });
    if (!lane) continue;
    const body = disclosure.querySelector(".uesrpg-chat-details__body");
    if (!body) continue;
    body.querySelector("[data-ues-test-explanation]")?.remove();
    const section = document.createElement("div");
    section.dataset.uesTestExplanation = "1";
    const title = key => escapeHtml(t("UESRPG.Chat.TestExplanation." + key, key));
    section.innerHTML = '<p class="uesrpg-chat-damage-note">' + title("Hint") + '</p><b>' + title("Attacker") + '</b>'
      + renderOpposedTestDetails(projectOpposedTestExplanation(state.attacker, { includeComponents: true }))
      + '<b>' + title("Defender") + '</b>'
      + renderOpposedTestDetails(projectOpposedTestExplanation(lane.participant, { includeComponents: true }));
    body.appendChild(section);
  }
}


function _injectOpposedDamageExplanations(message, root) {
  // Native visibility applies even when the message shell itself was rendered.
  if (message.visible !== true || message.isContentVisible !== true) return;
  const rawMagic = getMagicMessageState(message);
  const magic = rawMagic?.state ?? rawMagic;
  const state = magic ?? message.flags?.[_FLAG_NS]?.opposed;
  if (!state) return;
  const defenders = magic ? getMagicDefenderEntries(state) : _getDefenderEntries(state);
  const lanes = defenders.filter(defender => defender && typeof defender === "object").map(defender => {
    const damage = magic ? getMagicDefenderDamage(state, defender) : _getDefenderDamage(state, defender);
    return { damage, actorUuid: defender.actorUuid, tokenUuid: defender.tokenUuid,
      targetUuid: damage?.applyPayload?.targetUuid, outcomeId: damage?.application?.id };
  });
  const outcomes = game.user?.isGM ? getChatOutcomes(message, { includePayload: false }) : [];
  for (const panel of root.querySelectorAll(".uesrpg-damage-panel")) {
    let anchor = panel.querySelector("[data-ues-gm-damage-report-key]");
    const targetUuid = panel.dataset.uesOutcomeTarget || anchor?.dataset.uesGmDamageTarget || "";
    const conflictingTarget = anchor?.dataset.uesGmDamageTarget && anchor.dataset.uesGmDamageTarget !== targetUuid;
    const lane = conflictingTarget ? null : selectDamageExplanationLane(lanes, {
      targetUuid, outcomeId: panel.dataset.uesOutcomeId, panelKey: anchor?.dataset.uesGmDamageReportKey,
    });
    // Hydrate older stored markup locally; never rewrite message content to add an explanation.
    if (!magic) {
      let details = panel.querySelector("details.dmg-details");
      if (!details) {
        const disclosure = root.ownerDocument.createElement("details");
        disclosure.className = "dmg-details";
        disclosure.innerHTML = `<summary class="dmg-details-summary">${escapeHtml(t("UESRPG.UI.Details", "Details"))}</summary><div class="dmg-details-content"></div>`;
        const action = panel.querySelector(".dmg-action");
        panel.insertBefore(disclosure, action);
        details = disclosure;
      }
      const content = details.querySelector(".dmg-details-content");
      if (content) {
        const html = renderWeaponDamageExplanation(lane?.damage);
        const existing = content.querySelector(".dmg-weapon-details");
        if (existing) existing.outerHTML = html;
        else content.insertAdjacentHTML("afterbegin", html);
      }
    }
    if (!game.user?.isGM) {
      anchor?.replaceChildren();
      continue;
    }
    const damage = lane?.damage;
    if (damage?.mode === "healing" || damage?._magicPayload?.isHealing || damage?._magicPayload?.isDamaging === false) continue;
    if (!anchor) {
      const content = panel.querySelector(".dmg-details-content");
      if (!content) continue;
      anchor = root.ownerDocument.createElement("div");
      anchor.className = "dmg-gm-breakdown-anchor";
      anchor.dataset.uesGmDamageReportKey = damage?.gmDamageReport?.panelKey ?? "";
      anchor.dataset.uesGmDamageTarget = targetUuid;
      content.appendChild(anchor);
    }
    const matches = lane ? outcomes.filter(outcome => outcome.adapter === "combat.inline"
      && outcome.targetUuid === lane.targetUuid && (!lane.tokenUuid || outcome.defenderTokenUuid === lane.tokenUuid)
      && (!lane.outcomeId || outcome.id === lane.outcomeId)) : [];
    const receipt = matches.length === 1 ? getChatOutcomeReceipt(message, matches[0]) : null;
    const model = matches.length > 1 ? projectGmDamageExplanation() : projectGmDamageExplanation({ receipt,
      report: lane?.damage?.gmDamageReport, status: lane?.damage?.applicationStatus,
      panelKey: anchor.dataset.uesGmDamageReportKey });
    anchor.innerHTML = renderGmDamageReportHtml(model);
  }
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

function _appendImperialLuckControl(root, button) {
  const wrap = document.createElement("div");
  wrap.className = "uesrpg-chat-actions";
  wrap.appendChild(button);
  const anchor = root.querySelector(".dice-roll .dice-result") ?? root.querySelector(".message-content") ?? root;
  anchor.appendChild(wrap);
}

async function _reviewImperialLuckOperation(actor, operation) {
  if (!game.user?.isGM || !operation?.id || operation.status !== "pending") return false;
  const value = key => escapeHtml(String(operation[key] ?? "unknown"));
  const confirmed = await confirmDialog({
    title: "Review Imperial Luck spend",
    yesLabel: "Mark reviewed",
    content: `<p>Confirm that this spend has stopped on all clients. Inspect <strong>${escapeHtml(actor.name)}</strong>'s current Luck Points and test message <strong>${value("messageId")}</strong>.</p><p>Recorded intent: LP ${value("lpBefore")} → ${value("lpAfter")}; test DoS ${value("degreeBefore")} → ${value("degreeAfter")}; bonus ${value("bonus")}. Previous recorded LP spends: ${value("spentBefore")}; previous bonus DoS: ${value("dosAddedBefore")}.</p><p>Make any needed corrections manually first. Marking this reviewed only releases the hold; it does not refund, repeat or change the test.</p>`,
  });
  if (!confirmed || !game.user?.isGM) return false;
  const saved = await requestAtomicUpdateDocument(actor, fresh => {
    const current = getPendingImperialLuckOperation(fresh);
    if (!game.user?.isGM || current?.id !== operation.id || current?.status !== "pending") return null;
    return { [`flags.${_FLAG_NS}.imperialLuckOperation`]: { ...current, status: "reviewed", reviewedBy: game.user.id, reviewedAt: Date.now() } };
  });
  const observed = getFlagValueWithFallback(actor, "imperialLuckOperation");
  if (!saved || observed?.id !== operation.id || observed.status !== "reviewed") {
    ui.notifications?.warn?.("The Imperial Luck review was not confirmed. Inspect the actor before retrying.");
    return false;
  }
  ui.notifications?.info?.("Imperial Luck review recorded. Check the test result before any new spend.");
  return true;
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

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.uesrpgAction = "reroll-talent";
    btn.className = "uesrpg-btn uesrpg-reroll-talent-btn";
    btn.textContent = "Reroll (Talent)";

    if (!canExec) {
      btn.setAttribute("disabled", "disabled");
      setSystemTooltip(btn, { text: "Only the roll author or a GM can execute a talent reroll." });
    } else {
      setSystemTooltip(btn, { text: `Talent reroll: ${eligibility.source === "grandmaster" ? "Grandmaster" : "Expert"}` });
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

    const st = _getSkillTestFlags(message);
    if (!st) return;

    const recordedDegree = Number(st.degree);
    let note = root.querySelector('[data-uesrpg-imperialluck-result]');
    if (message.visible === true && message.isContentVisible === true && st.isSuccess === true
      && _getImperialLuckSpentLp(message) > 0 && Number.isFinite(recordedDegree)) {
      if (!note) {
        note = document.createElement("p");
        note.dataset.uesrpgImperialluckResult = "1";
        const anchor = root.querySelector(".dice-roll .dice-result") ?? root.querySelector(".message-content") ?? root;
        anchor.appendChild(note);
      }
      note.textContent = `Current recorded result: ${recordedDegree} DoS (including Imperial Luck). The roll above shows the original result.`;
    } else note?.remove();
    if (root.querySelector('[data-uesrpg-action="imperialluck-dos"]')) return;

    const actorUuid = String(st.actorUuid ?? "").trim();
    if (!actorUuid) return;
    const actor = resolveActor(message, actorUuid);
    if (!actor) return;

    const pendingOperation = getPendingImperialLuckOperation(actor);
    if (pendingOperation) {
      const review = document.createElement("button");
      review.type = "button";
      review.dataset.uesrpgAction = "imperialluck-dos";
      review.className = "uesrpg-btn uesrpg-imperialluck-dos-btn";
      review.textContent = "Check Imperial Luck spend status";
      setSystemTooltip(review, { text: "Check whether the previous spend completed. If it remains held, a GM must review it before another spend." });
      review.addEventListener("click", async event => {
        event.preventDefault();
        if (review.disabled) return;
        review.disabled = true;
        let reviewed = false;
        try {
          const current = getPendingImperialLuckOperation(actor);
          if (!current) {
            review.parentElement?.remove();
            _injectImperialLuckDoSButton(game.messages?.get?.(message.id) ?? message, root);
            reviewed = true;
          } else if (!game.user?.isGM || !current.id || current.status !== "pending") {
            ui.notifications?.warn?.("A GM must inspect the held Imperial Luck operation before another spend.");
          } else {
            reviewed = await _reviewImperialLuckOperation(actor, current);
            if (reviewed) {
              review.parentElement?.remove();
              _injectImperialLuckDoSButton(game.messages?.get?.(message.id) ?? message, root);
            }
          }
        }
        catch (error) {
          console.warn("UESRPG | Imperial Luck review failed", error);
          ui.notifications?.warn?.("The Imperial Luck review could not be confirmed. Inspect the actor before retrying.");
        } finally { if (!reviewed) review.disabled = false; }
      });
      _appendImperialLuckControl(root, review);
      return;
    }

    if (st.isSuccess !== true) return;

    if (!hasActiveImperialLuck(actor, { warn: true }) || !canUseLuck(actor)) return;

    const canSpend = _canUserSpendLuckForActor(actor);
    const canUpdateTest = canUserUpdateChatMessage(message, game.user);
    const staminaUsed = Boolean(getFlagValueWithFallback(message, "staminaUsedOnTest"));
    const untrackedLuck = hasUntrackedImperialLuckHistory(message);
    const currentLp = Number(actor.system?.luck_points?.value ?? 0) || 0;
    if (currentLp <= 0) return;

    const lpSpent = _getImperialLuckSpentLp(message);
    const nextBonus = (lpSpent === 0) ? 2 : 1;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.uesrpgAction = "imperialluck-dos";
    btn.className = "uesrpg-btn uesrpg-imperialluck-dos-btn";
    btn.textContent = `Spend 1 LP (+${nextBonus} DoS)`;

    if (!canSpend || !canUpdateTest || staminaUsed || untrackedLuck) {
      btn.setAttribute("disabled", "disabled");
      if (staminaUsed) btn.textContent = "Luck unavailable: Stamina used";
      else if (untrackedLuck) btn.textContent = "Ask GM to review Luck history";
      setSystemTooltip(btn, { text: !canSpend ? "You do not have permission to spend Luck Points for this actor."
        : !canUpdateTest ? "You cannot update this test message. Ask a GM to resolve the Luck Point spend."
          : staminaUsed ? "Stamina was used to modify this test; Luck cannot also modify it."
            : "This test has earlier Luck use without a reliable Imperial Luck bonus record. Ask the GM to review it." });
    } else {
      setSystemTooltip(btn, { text: "Imperial Luck: first LP spent on this test adds +2 DoS, then +1 per LP." });
    }

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      let succeeded = false;
      let costAttempted = false;
      let costConfirmed = false;
      let resultConfirmed = false;
      let operationSettled = false;
      try {
        const freshActor = resolveActor(message, actorUuid) ?? actor;
        if (!freshActor) return;
        if (!hasActiveImperialLuck(freshActor, { warn: true }) || !canUseLuck(freshActor)) return;
        if (!_canUserSpendLuckForActor(freshActor)) return;
        if (getPendingImperialLuckOperation(freshActor)) {
          ui.notifications?.warn?.("A previous Imperial Luck spend requires GM review before another spend.");
          return;
        }

        const freshMsg = game.messages?.get?.(message.id) ?? message;
        if (!canUserUpdateChatMessage(freshMsg, game.user)) {
          ui.notifications?.warn?.("You cannot update this test message. Ask a GM to resolve the Luck Point spend.");
          return;
        }
        const freshTest = _getSkillTestFlags(freshMsg);
        if (freshTest?.isSuccess !== true || String(freshTest.actorUuid ?? "").trim() !== actorUuid) {
          ui.notifications?.warn?.("This test changed; inspect the result before spending Luck.");
          return;
        }
        if (getFlagValueWithFallback(freshMsg, "staminaUsedOnTest") || hasUntrackedImperialLuckHistory(freshMsg)) {
          ui.notifications?.warn?.("This test has Stamina or untracked earlier Luck use. Ask the GM to review it before spending.");
          return;
        }

        const lpNow = Number(freshActor.system?.luck_points?.value ?? 0) || 0;
        if (lpNow <= 0) {
          ui.notifications?.warn?.("No Luck Points remaining.");
          return;
        }

        const spent = _getImperialLuckSpentLp(freshMsg);
        const add = (spent === 0) ? 2 : 1;
        const currentDegree = Number(freshTest.degree ?? 0) || 0;
        const alreadyAdded = Number(getFlagValueWithFallback(freshMsg, "imperialLuck.dosAdded") ?? 0) || 0;
        const nextDegree = Math.max(0, currentDegree + add);
        const matchesTest = candidate => {
          const test = _getSkillTestFlags(candidate);
          return test?.isSuccess === true && String(test.actorUuid ?? "").trim() === actorUuid
            && Number(test.degree ?? 0) === currentDegree && _getImperialLuckSpentLp(candidate) === spent
            && Number(getFlagValueWithFallback(candidate, "imperialLuck.dosAdded") ?? 0) === alreadyAdded
            && !getFlagValueWithFallback(candidate, "staminaUsedOnTest") && !hasUntrackedImperialLuckHistory(candidate);
        };
        const operationId = foundry.utils.randomID(24);
        let operation = null;
        let blockedReason = null;

        costAttempted = true;
        costConfirmed = await requestAtomicUpdateDocument(freshActor, current => {
          if (getPendingImperialLuckOperation(current)) {
            blockedReason = "A previous Imperial Luck spend requires GM review before another spend.";
            return null;
          }
          const currentMessage = game.messages?.get?.(message.id) ?? freshMsg;
          if (!hasActiveImperialLuck(current) || !canUseLuck(current) || !_canUserSpendLuckForActor(current)
            || !canUserUpdateChatMessage(currentMessage, game.user) || !matchesTest(currentMessage)) {
            blockedReason = "The actor or test changed before the Luck Point was spent. Review it before continuing.";
            return null;
          }
          const available = Number(current.system?.luck_points?.value ?? 0) || 0;
          if (available <= 0) {
            blockedReason = "No Luck Points remaining.";
            return null;
          }
          operation = { id: operationId, status: "pending", messageId: freshMsg.id,
            lpBefore: available, lpAfter: available - 1, degreeBefore: currentDegree, degreeAfter: nextDegree,
            spentBefore: spent, dosAddedBefore: alreadyAdded, bonus: add, createdAt: Date.now(), requesterId: game.user.id };
          return { "system.luck_points.value": available - 1, [`flags.${_FLAG_NS}.imperialLuckOperation`]: operation };
        });
        if (!costConfirmed && blockedReason) {
          costAttempted = false;
          ui.notifications?.warn?.(blockedReason);
          return;
        }
        if (!costConfirmed) throw new Error("The Luck Point deduction was not confirmed.");
        const recordedOperation = getPendingImperialLuckOperation(freshActor);
        if (recordedOperation?.id !== operationId || Number(freshActor.system?.luck_points?.value) !== operation?.lpAfter) {
          throw new Error("The Luck Point deduction and review hold could not be confirmed together.");
        }
        const currentMessage = game.messages?.get?.(message.id) ?? freshMsg;
        if (!matchesTest(currentMessage)) {
          throw new Error("The test changed after the Luck Point deduction.");
        }

        resultConfirmed = await requestUpdateChatMessage(currentMessage, {
          [`flags.${_FLAG_NS}.imperialLuck.lpSpent`]: spent + 1,
          [`flags.${_FLAG_NS}.imperialLuck.dosAdded`]: alreadyAdded + add,
          [`flags.${_FLAG_NS}.skillTest.degree`]: nextDegree,
          [`flags.${_FLAG_NS}.skillTest.textual`]: `${nextDegree} DoS`,
          [`flags.${_FLAG_NS}.luckUsedOnTest`]: true,
        });
        if (!resultConfirmed) throw new Error("The test result update was not confirmed.");
        const observed = game.messages?.get?.(message.id) ?? currentMessage;
        if (_getImperialLuckSpentLp(observed) !== spent + 1
          || Number(getFlagValueWithFallback(observed, "imperialLuck.dosAdded") ?? 0) !== alreadyAdded + add
          || Number(_getSkillTestFlags(observed)?.degree) !== nextDegree
          || getFlagValueWithFallback(observed, "luckUsedOnTest") !== true) {
          resultConfirmed = false;
          throw new Error("The Luck Point and test result record could not be confirmed together.");
        }

        const receiptSaved = await requestAtomicUpdateDocument(freshActor, current => {
          const pending = getPendingImperialLuckOperation(current);
          if (pending?.id !== operationId || pending.status !== "pending") return null;
          return { [`flags.${_FLAG_NS}.imperialLuckOperation`]: { ...pending, status: "completed", completedAt: Date.now() } };
        });
        const settledOperation = getFlagValueWithFallback(freshActor, "imperialLuckOperation");
        operationSettled = receiptSaved && settledOperation?.id === operationId && settledOperation.status === "completed";
        if (!operationSettled) throw new Error("The Imperial Luck operation status was not confirmed.");

        const announcement = await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: freshActor }),
          content: `<div class="uesrpg"><b>Imperial Luck</b>: spent 1 LP, +${add} DoS (now ${nextDegree} DoS).</div>`,
          whisper: getWhisperRecipients(freshActor),
          style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        });
        if (!announcement?.id) throw new Error("The separate Imperial Luck announcement was not confirmed.");
        succeeded = true;
      } catch (err) {
        console.error("UESRPG | Imperial Luck spend failed", err);
        if (resultConfirmed && !operationSettled) {
          ui.notifications?.warn?.("Imperial Luck: the Luck Point and test result were updated, but the operation status was not confirmed. Ask the GM to inspect both before another spend.");
        } else if (resultConfirmed) {
          ui.notifications?.warn?.("Imperial Luck: the Luck Point and test result were updated, but the separate chat announcement failed. Do not repeat that spend.");
        } else if (costAttempted) {
          ui.notifications?.error?.(`${costConfirmed ? "Imperial Luck: the Luck Point was deducted, but the test result was not confirmed." : "Imperial Luck: the Luck Point deduction could not be confirmed."} Ask the GM to inspect the actor and test result before trying again.`);
        } else {
          ui.notifications?.error?.("Imperial Luck spend failed before the Luck Point deduction. Check the console for details.");
        }
      } finally {
        if (!succeeded && !costAttempted) btn.disabled = false;
        if (!succeeded && costAttempted) setSystemTooltip(btn, { text: "Inspect the actor and test result with the GM before retrying." });
      }
    });

    _appendImperialLuckControl(root, btn);
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
  if (message?.visible !== true || message?.isContentVisible !== true) return;
  _markChatSurfaces(message, root);
  _injectOpposedDamageExplanations(message, root);
  _injectOpposedTestExplanations(message, root);

  // Skill opposed-roll chat card buttons.
  root.querySelectorAll("[data-ues-skill-opposed-action]").forEach((el) => {
    const action = el.dataset.uesSkillOpposedAction;
    const data = getSkillOpposedState(message);
    const actorUuid = (action === "attacker-roll") ? data?.attacker?.actorUuid : (action === "defender-roll") ? data?.defender?.actorUuid : null;
    const actor = actorUuid ? resolveActorFromUuidSync(actorUuid) : null;

    if (actor && !canUserRollActor(game.user, actor)) {
      el.setAttribute("disabled", "disabled");
      setSystemTooltip(el, { text: "You do not have permission to roll for this actor." });
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
      setSystemTooltip(el, { text: "You do not have permission to roll for this actor." });
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
      setSystemTooltip(el, { text: "You do not have permission to roll for this actor." });
    }
  });

  // Shared ownership gating for wound, disease and regeneration checks.
  root.querySelectorAll("[data-ues-shock-action], [data-ues-death-action], [data-ues-disease-action], [data-ues-regeneration-action]").forEach((el) => {
    const actor = el.dataset.actorUuid ? resolveActorFromUuidSync(el.dataset.actorUuid) : null;
    if (actor && !canUserRollActor(game.user, actor)) {
      el.setAttribute("disabled", "disabled");
      setSystemTooltip(el, { text: "You do not have permission to roll for this actor." });
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
      setSystemTooltip(el, { text: "You do not have permission to roll for this actor." });
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

  _bindDisclosureScrollAnchors(root);
}
