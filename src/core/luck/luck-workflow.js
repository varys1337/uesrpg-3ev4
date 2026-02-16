/**
 * src/core/luck/luck-workflow.js
 *
 * RAW Chapter 1 – Luck Point spending and permanent Luck burning.
 *
 * Supports ALL test-bearing chat message types:
 *  - Standalone skill tests  (flags.uesrpg.skillTest)
 *  - Combat opposed cards     (flags["uesrpg-3ev4"].opposed)
 *  - Skill opposed cards      (flags["uesrpg-3ev4"].skillOpposed)
 *  - Characteristic opposed   (flags["uesrpg-3ev4"].charOpposed)
 *  - Magic opposed cards      (flags["uesrpg-3ev4"].magicOpposed)
 *
 * Provides:
 *  - Chat context-menu entries: "Spend Luck Point" / "Burn Luck"
 *  - Mutual exclusion: cannot use both Luck and Stamina on the same test
 *  - LP label click on character sheet opens the Burn Luck menu
 *
 * Integration:
 *  - Registered once from chat-handlers.js  initializeChatHandlers()
 *  - Exposed on  game.uesrpg.luck  for macro / external use
 */

import { requestUpdateDocument, requestUpdateChatMessage } from "../../utils/authority-proxy.js";
import { canUserRollActor } from "../../utils/permissions.js";
import { customDialog, confirmDialog } from "../../utils/dialog-v2-helper.js";
import { doTestRoll, formatDegree, resolveOpposed } from "../../utils/degree-roll-helper.js";

// ── Constants ───────────────────────────────────────────────────────────

const SYSTEM_ID = "uesrpg-3ev4";
const ROLL_FORMULA = "1d100";

// ══════════════════════════════════════════════════════════════════════════
//  Utility helpers
// ══════════════════════════════════════════════════════════════════════════

function _esc(str) {
  const raw = String(str ?? "");
  try { return foundry.utils.escapeHTML(raw); } catch (_e) { return raw; }
}

/** Resolve an actor from a UUID string (handles token-actor chains). */
function _resolveActor(_message, uuid) {
  if (uuid) {
    const doc = fromUuidSync(uuid);
    if (doc?.actor) return doc.actor;
    if (doc?.documentName === "Actor") return doc;
  }
  return null;
}

function _resolveActorFromSpeaker(message) {
  const sp = message?.speaker;
  if (sp?.token) return canvas?.tokens?.get(sp.token)?.actor ?? null;
  if (sp?.actor) return game.actors?.get(sp.actor) ?? null;
  return null;
}

function _getWhisperRecipients(actor) {
  const out = new Set();
  for (const user of (game.users?.contents ?? [])) {
    if (!user) continue;
    if (user.isGM) { out.add(user.id); continue; }
    const hasOwner = typeof actor?.testUserPermission === "function"
      ? actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
      : Number(actor?.ownership?.[user.id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    if (hasOwner) out.add(user.id);
  }
  return Array.from(out);
}

// ── Robust context-menu message-ID extractor ────────────────────────────
// Mirrors the canonical implementation in chat-handlers.js.

function _getMessageIdFromContextLi(li) {
  if (!li) return null;
  const el = li instanceof HTMLElement ? li : li?.[0];
  if (el?.dataset?.messageId) return String(el.dataset.messageId);
  if (el?.getAttribute) {
    const attrId = String(el.getAttribute("data-message-id") ?? "").trim();
    if (attrId) return attrId;
    const m = /^chat-message-(.+)$/.exec(String(el.id ?? "").trim());
    if (m?.[1]) return String(m[1]);
  }
  if (typeof li?.data === "function") {
    const id = li.data("messageId");
    if (id != null) return String(id);
  }
  if (typeof li?.attr === "function") {
    const attrId = String(li.attr("data-message-id") ?? "").trim();
    if (attrId) return attrId;
    const m = /^chat-message-(.+)$/.exec(String(li.attr("id") ?? "").trim());
    if (m?.[1]) return String(m[1]);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
//  Universal message classifier
// ══════════════════════════════════════════════════════════════════════════

/**
 * Classify a chat message and extract per-side info for every luck-eligible
 * message type.
 *
 * Returns `null` if the message is not a test-bearing card.
 * Otherwise returns:
 * ```
 * {
 *   type: "skillTest" | "combatOpposed" | "skillOpposed" | "charOpposed" | "magicOpposed",
 *   sides: [{
 *     role:   "roller" | "attacker" | "defender",
 *     label:  string,
 *     actorUuid: string,
 *     result: { isSuccess, degree, isCriticalSuccess, isCriticalFailure, rollTotal, target, textual } | null,
 *     tn:     number | null,
 *     defenderIndex: number | null
 *   }],
 *   raw: <reference to the flag data>,
 *   staminaUsed: boolean,
 *   luckUsed: boolean,
 *   rerolled: boolean
 * }
 * ```
 */
function _classifyMessage(message) {
  if (!message) return null;
  const sysFlags = message.flags?.[SYSTEM_ID] ?? {};
  const uesrpgFlags = message.flags?.uesrpg ?? {};

  // ── 1. Standalone skill test ──────────────────────────────────────────
  const st = uesrpgFlags.skillTest ?? sysFlags.skillTest ?? null;
  if (st && typeof st === "object" && st.actorUuid) {
    return {
      type: "skillTest",
      sides: [{
        role: "roller",
        label: String(st.skillName ?? "Test"),
        actorUuid: String(st.actorUuid),
        result: {
          isSuccess: Boolean(st.isSuccess),
          degree: Number(st.degree ?? 0) || 0,
          isCriticalSuccess: Boolean(st.isCriticalSuccess),
          isCriticalFailure: Boolean(st.isCriticalFailure),
          rollTotal: Number(st.rollTotal ?? NaN),
          target: Number(st.target ?? NaN),
          textual: String(st.textual ?? ""),
        },
        tn: Number(st.target ?? NaN) || null,
        defenderIndex: null,
      }],
      raw: st,
      staminaUsed: Boolean(uesrpgFlags.staminaUsedOnTest || sysFlags.staminaUsedOnTest),
      luckUsed: Boolean(uesrpgFlags.luckUsedOnTest || sysFlags.luckUsedOnTest),
      rerolled: Boolean(uesrpgFlags.reroll?.used || uesrpgFlags.reroll?.isReroll),
    };
  }

  // ── 2. Combat opposed card ────────────────────────────────────────────
  const combatData = sysFlags.opposed;
  if (combatData && typeof combatData === "object" && combatData.attacker) {
    const sides = [];
    const a = combatData.attacker;
    if (a) {
      sides.push({
        role: "attacker",
        label: String(a.label ?? a.tokenName ?? "Attacker"),
        actorUuid: String(a.actorUuid ?? ""),
        result: _normalizeResult(a.result),
        tn: Number(a.tn?.finalTN ?? NaN) || null,
        defenderIndex: null,
      });
    }
    const defenders = Array.isArray(combatData.defenders)
      ? combatData.defenders
      : (combatData.defender ? [combatData.defender] : []);
    defenders.forEach((d, i) => {
      sides.push({
        role: "defender",
        label: String(d.testLabel ?? d.tokenName ?? "Defender"),
        actorUuid: String(d.actorUuid ?? ""),
        result: _normalizeResult(d.result),
        tn: Number(d.tn?.finalTN ?? NaN) || null,
        defenderIndex: defenders.length > 1 ? i : null,
      });
    });
    return {
      type: "combatOpposed",
      sides,
      raw: combatData,
      staminaUsed: Boolean(combatData.context?.staminaUsed),
      luckUsed: Boolean(combatData.context?.luckUsed),
      rerolled: false,
    };
  }

  // ── 3. Skill opposed card ─────────────────────────────────────────────
  const skillOpposed = sysFlags.skillOpposed;
  if (skillOpposed && typeof skillOpposed === "object") {
    const data = skillOpposed.state ?? skillOpposed;
    if (data.attacker) {
      const sides = [];
      sides.push({
        role: "attacker",
        label: String(data.attacker.skillLabel ?? data.attacker.tokenName ?? "Attacker"),
        actorUuid: String(data.attacker.actorUuid ?? ""),
        result: _normalizeResult(data.attacker.result),
        tn: Number(data.attacker.tn?.finalTN ?? NaN) || null,
        defenderIndex: null,
      });
      if (data.defender) {
        sides.push({
          role: "defender",
          label: String(data.defender.skillLabel ?? data.defender.tokenName ?? "Defender"),
          actorUuid: String(data.defender.actorUuid ?? ""),
          result: _normalizeResult(data.defender.result),
          tn: Number(data.defender.tn?.finalTN ?? NaN) || null,
          defenderIndex: null,
        });
      }
      return {
        type: "skillOpposed",
        sides,
        raw: data,
        staminaUsed: Boolean(data.context?.staminaUsed),
        luckUsed: Boolean(data.context?.luckUsed),
        rerolled: false,
      };
    }
  }

  // ── 4. Characteristic opposed card ────────────────────────────────────
  const charOpposed = sysFlags.charOpposed;
  if (charOpposed && typeof charOpposed === "object") {
    const data = charOpposed.state ?? charOpposed;
    if (data.attacker) {
      const sides = [];
      sides.push({
        role: "attacker",
        label: String(data.attacker.charLabel ?? data.attacker.tokenName ?? "Attacker"),
        actorUuid: String(data.attacker.actorUuid ?? ""),
        result: _normalizeResult(data.attacker.result),
        tn: Number(data.attacker.tn?.finalTN ?? NaN) || null,
        defenderIndex: null,
      });
      if (data.defender) {
        sides.push({
          role: "defender",
          label: String(data.defender.charLabel ?? data.defender.tokenName ?? "Defender"),
          actorUuid: String(data.defender.actorUuid ?? ""),
          result: _normalizeResult(data.defender.result),
          tn: Number(data.defender.tn?.finalTN ?? NaN) || null,
          defenderIndex: null,
        });
      }
      return {
        type: "charOpposed",
        sides,
        raw: data,
        staminaUsed: Boolean(data.context?.staminaUsed),
        luckUsed: Boolean(data.context?.luckUsed),
        rerolled: false,
      };
    }
  }

  // ── 5. Magic opposed card ─────────────────────────────────────────────
  const magicOpposed = sysFlags.magicOpposed;
  if (magicOpposed && typeof magicOpposed === "object") {
    const data = magicOpposed.state ?? magicOpposed;
    if (data.attacker) {
      const sides = [];
      sides.push({
        role: "attacker",
        label: String(data.attacker.spellName ?? data.attacker.tokenName ?? "Caster"),
        actorUuid: String(data.attacker.actorUuid ?? ""),
        result: _normalizeResult(data.attacker.result),
        tn: Number(data.attacker.tn?.finalTN ?? NaN) || null,
        defenderIndex: null,
      });
      const defenders = Array.isArray(data.defenders)
        ? data.defenders
        : (data.defender ? [data.defender] : []);
      defenders.forEach((d, i) => {
        // Skip sides with no defense (nothing to reroll/modify)
        if (d.noDefense || d.defenseType === "none" || d.defenseType === "-") return;
        sides.push({
          role: "defender",
          label: String(d.tokenName ?? "Defender"),
          actorUuid: String(d.actorUuid ?? ""),
          result: _normalizeResult(d.result),
          tn: Number(d.tn?.finalTN ?? NaN) || null,
          defenderIndex: defenders.length > 1 ? i : null,
        });
      });
      return {
        type: "magicOpposed",
        sides,
        raw: data,
        staminaUsed: Boolean(data.context?.staminaUsed),
        luckUsed: Boolean(data.context?.luckUsed),
        rerolled: false,
      };
    }
  }

  return null;
}

/** Normalize a result sub-object from any card type. */
function _normalizeResult(r) {
  if (!r || typeof r !== "object") return null;
  return {
    isSuccess: Boolean(r.isSuccess),
    degree: Number(r.degree ?? 0) || 0,
    isCriticalSuccess: Boolean(r.isCriticalSuccess),
    isCriticalFailure: Boolean(r.isCriticalFailure),
    rollTotal: Number(r.rollTotal ?? NaN),
    target: Number(r.target ?? NaN),
    textual: String(r.textual ?? ""),
  };
}

/** True if the current user may spend luck for the given actor. */
function _canUserActOnActor(actor) {
  if (!actor) return false;
  if (game.user?.isGM) return true;
  return canUserRollActor(game.user, actor);
}

// ══════════════════════════════════════════════════════════════════════════
//  Side picker – for opposed cards with multiple eligible sides
// ══════════════════════════════════════════════════════════════════════════

/**
 * Given a classified message let the user pick which side to apply luck to.
 * For standalone skill tests, returns the single side directly.
 * For opposed cards, shows a dialog if more than one side is eligible.
 *
 * @param {object} info  Output of _classifyMessage
 * @param {object} [opts]
 * @param {boolean} [opts.requireResult]  Only show sides that have a result
 * @param {boolean} [opts.requireFailure] Only show sides with a failed result
 * @param {boolean} [opts.requireSuccess] Only show sides with a successful result
 * @returns {Promise<object|null>}  The chosen side object, or null if cancelled
 */
async function _pickSide(info, opts = {}) {
  if (!info) return null;
  let eligible = info.sides.filter(s => {
    if (!s.actorUuid) return false;
    const actor = _resolveActor(null, s.actorUuid);
    if (!_canUserActOnActor(actor)) return false;
    if (opts.requireResult && !s.result) return false;
    if (opts.requireFailure && (s.result?.isSuccess !== false || !s.result)) return false;
    if (opts.requireSuccess && (s.result?.isSuccess !== true || !s.result)) return false;
    return true;
  });
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];

  // Show a dialog to pick
  const optionRows = eligible.map((s, i) => {
    const roleName = s.role === "attacker" ? "Attacker" : s.role === "defender" ? "Defender" : "Roller";
    const deg = s.result ? (s.result.isSuccess ? `${s.result.degree} DoS` : `${s.result.degree} DoF`) : "\u2014";
    return `<option value="${i}">${roleName}: ${_esc(s.label)} (${deg})</option>`;
  }).join("");

  return new Promise((resolve) => {
    customDialog({
      title: "Choose Side",
      content: `<div class="uesrpg" style="padding:8px;">
        <p>Which side should receive the Luck effect?</p>
        <select name="selected-side" style="width:100%;">${optionRows}</select>
      </div>`,
      buttons: {
        ok: {
          label: "Confirm",
          icon: "fas fa-check",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const idx = Number(root?.querySelector('select[name="selected-side"]')?.value ?? 0);
            resolve(eligible[idx] ?? null);
          }
        },
        cancel: { label: "Cancel", icon: "fas fa-times", callback: () => resolve(null) }
      },
      default: "ok",
      width: 400,
    }).catch(() => resolve(null));
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  Per-card-type update adapters
// ══════════════════════════════════════════════════════════════════════════

/**
 * Write a mutated result back into the correct place in the chat message
 * flags and re-render the card.  For standalone skill tests, updates the
 * simple flag payload.  For opposed cards, uses each type's card updater
 * to atomically persist flags + re-rendered HTML.
 *
 * @param {ChatMessage} message
 * @param {object} info           Output of _classifyMessage (from *before* mutation)
 * @param {object} side           The side being modified (ref into info.sides)
 * @param {object} newResult      The new result object to write
 * @param {object} [extraFlags]   Additional flags to merge (e.g. luckUsedOnTest)
 * @returns {Promise<void>}
 */
async function _persistResult(message, info, side, newResult, extraFlags = {}) {
  switch (info.type) {
    case "skillTest":
      return _persistSkillTestResult(message, newResult, extraFlags);
    case "combatOpposed":
      return _persistCombatOpposedResult(message, side, newResult, extraFlags);
    case "skillOpposed":
      return _persistSkillOpposedResult(message, side, newResult, extraFlags);
    case "charOpposed":
      return _persistCharOpposedResult(message, side, newResult, extraFlags);
    case "magicOpposed":
      return _persistMagicOpposedResult(message, side, newResult, extraFlags);
    default:
      console.warn(`UESRPG | Luck: unknown card type "${info.type}"`);
  }
}

// ── Standalone skill test ───────────────────────────────────────────────

async function _persistSkillTestResult(message, newResult, extraFlags) {
  const update = {
    "flags.uesrpg.skillTest.isSuccess": newResult.isSuccess,
    "flags.uesrpg.skillTest.degree": newResult.degree,
    "flags.uesrpg.skillTest.textual": newResult.textual ?? `${newResult.degree} ${newResult.isSuccess ? "DoS" : "DoF"}`,
    [`flags.${SYSTEM_ID}.skillTest.isSuccess`]: newResult.isSuccess,
    [`flags.${SYSTEM_ID}.skillTest.degree`]: newResult.degree,
    [`flags.${SYSTEM_ID}.skillTest.textual`]: newResult.textual ?? `${newResult.degree} ${newResult.isSuccess ? "DoS" : "DoF"}`,
    ...extraFlags,
  };
  await requestUpdateChatMessage(message, update);
}

// ── Combat opposed ──────────────────────────────────────────────────────

async function _persistCombatOpposedResult(message, side, newResult, _extraFlags) {
  // Lazy-load the combat card updater + render + outcome resolver
  const [
    { updateCard },
    { _renderCard },
    { resolveOutcomeRAW },
  ] = await Promise.all([
    import("../combat/opposed/cards/updater.js"),
    import("../combat/opposed/render.js"),
    import("../combat/opposed/outcome-resolution.js"),
  ]);

  // Re-read live flags to avoid stale writes
  const live = game.messages?.get?.(message.id) ?? message;
  const raw = live.flags?.[SYSTEM_ID]?.opposed;
  if (!raw) return;
  const data = foundry.utils.deepClone(raw);

  // Write the new result into the correct side
  if (side.role === "attacker") {
    data.attacker.result = newResult;
  } else {
    const defenders = Array.isArray(data.defenders) ? data.defenders : (data.defender ? [data.defender] : []);
    const idx = side.defenderIndex ?? 0;
    const d = defenders[idx] ?? data.defender;
    if (d) d.result = newResult;
  }

  // Re-resolve outcome per defender
  const defenders = Array.isArray(data.defenders) ? data.defenders : (data.defender ? [data.defender] : []);
  for (const d of defenders) {
    if (!d?.result || !data.attacker?.result) continue;
    const outcome = resolveOutcomeRAW(data, d);
    if (outcome) {
      if (data.defenders) {
        d.outcome = outcome;
      } else {
        data.outcome = outcome;
      }
    }
  }

  // Mark luck used in context
  data.context = data.context ?? {};
  data.context.luckUsed = true;

  await updateCard(live, data, _renderCard);
}

// ── Skill opposed ───────────────────────────────────────────────────────

async function _persistSkillOpposedResult(message, side, newResult, _extraFlags) {
  const { _updateCard } = await import("../skills/opposed/card-updater.js");

  const live = game.messages?.get?.(message.id) ?? message;
  const raw = live.flags?.[SYSTEM_ID]?.skillOpposed;
  if (!raw) return;
  const data = JSON.parse(JSON.stringify(raw.state ?? raw));

  if (side.role === "attacker") {
    data.attacker.result = newResult;
  } else if (data.defender) {
    data.defender.result = newResult;
  }

  // Re-resolve outcome using generic resolver
  if (data.attacker?.result && data.defender?.result) {
    data.outcome = resolveOpposed(data.attacker.result, data.defender.result);
  }

  data.context = data.context ?? {};
  data.context.luckUsed = true;

  await _updateCard(live, data);
}

// ── Characteristic opposed ──────────────────────────────────────────────

async function _persistCharOpposedResult(message, side, newResult, _extraFlags) {
  const { _updateCard } = await import("../characteristics/opposed/card-updater.js");

  const live = game.messages?.get?.(message.id) ?? message;
  const raw = live.flags?.[SYSTEM_ID]?.charOpposed;
  if (!raw) return;
  const data = JSON.parse(JSON.stringify(raw.state ?? raw));

  if (side.role === "attacker") {
    data.attacker.result = newResult;
  } else if (data.defender) {
    data.defender.result = newResult;
  }

  if (data.attacker?.result && data.defender?.result) {
    data.outcome = resolveOpposed(data.attacker.result, data.defender.result);
  }

  data.context = data.context ?? {};
  data.context.luckUsed = true;

  await _updateCard(live, data);
}

// ── Magic opposed ───────────────────────────────────────────────────────

async function _persistMagicOpposedResult(message, side, newResult, _extraFlags) {
  const [
    { updateCard },
    { renderCard },
  ] = await Promise.all([
    import("../magic/opposed/updater.js"),
    import("../magic/opposed/render.js"),
  ]);

  const live = game.messages?.get?.(message.id) ?? message;
  const raw = live.flags?.[SYSTEM_ID]?.magicOpposed;
  if (!raw) return;
  const data = JSON.parse(JSON.stringify(raw.state ?? raw));

  if (side.role === "attacker") {
    data.attacker.result = newResult;
  } else {
    const defenders = Array.isArray(data.defenders) ? data.defenders : (data.defender ? [data.defender] : []);
    const idx = side.defenderIndex ?? 0;
    const d = defenders[idx] ?? data.defender;
    if (d) d.result = newResult;
  }

  // Re-resolve per-defender outcomes
  const defenders = Array.isArray(data.defenders) ? data.defenders : (data.defender ? [data.defender] : []);
  for (const d of defenders) {
    if (!d?.result || !data.attacker?.result) continue;
    const outcome = resolveOpposed(data.attacker.result, d.result);
    if (outcome) {
      if (data.defenders) {
        d.outcome = d.outcome ?? {};
        d.outcome.winner = outcome.winner;
        d.outcome.reason = outcome.reason;
      } else {
        data.outcome = data.outcome ?? {};
        data.outcome.winner = outcome.winner;
        data.outcome.reason = outcome.reason;
      }
    }
  }

  data.context = data.context ?? {};
  data.context.luckUsed = true;

  await updateCard(live, data, renderCard);
}

// ══════════════════════════════════════════════════════════════════════════
//  Luck Point: Reroll a failed test
// ══════════════════════════════════════════════════════════════════════════

/**
 * RAW: Characters may spend a Luck Point whenever they fail a test.
 * The character may immediately reroll that failed test.
 * - Once per test
 * - Cannot reroll Critical Failures
 * - Cannot be combined with Stamina on the same test
 */
async function spendLPReroll(message) {
  if (!message) return false;
  const info = _classifyMessage(message);
  if (!info) { ui.notifications?.warn?.("This message does not contain a test result."); return false; }
  if (info.staminaUsed) { ui.notifications?.warn?.("Cannot use both Luck and Stamina on the same test (RAW)."); return false; }
  if (info.rerolled) { ui.notifications?.warn?.("This test has already been rerolled."); return false; }

  // Pick the side (auto for standalone, dialog for opposed)
  const side = await _pickSide(info, { requireResult: true, requireFailure: true });
  if (!side) { ui.notifications?.info?.("No failed result eligible for Luck reroll."); return false; }

  const { result } = side;
  if (result?.isCriticalFailure) {
    ui.notifications?.warn?.("Cannot use Luck Points to reroll Critical Failures.");
    return false;
  }

  const actor = _resolveActor(message, side.actorUuid);
  if (!actor) { ui.notifications?.warn?.("Cannot resolve actor."); return false; }

  const currentLp = Number(actor.system?.luck_points?.value ?? 0);
  if (currentLp <= 0) { ui.notifications?.warn?.("No Luck Points remaining."); return false; }

  const confirmed = await confirmDialog({
    title: "Spend Luck Point \u2014 Reroll",
    content: `<div class="uesrpg"><p>Spend <b>1 LP</b> to reroll <b>${_esc(side.label)}</b>?</p>
              <p>Current LP: <b>${currentLp}</b></p></div>`,
    yesLabel: "Reroll (1 LP)",
    noLabel: "Cancel",
    yesIcon: "fas fa-dice-d20",
    rejectClose: false,
  });
  if (!confirmed) return false;

  // Deduct LP
  await requestUpdateDocument(actor, { "system.luck_points.value": Math.max(0, currentLp - 1) });

  // Execute the reroll
  const target = side.tn ?? (result?.target ?? NaN);
  if (!Number.isFinite(target)) { ui.notifications?.warn?.("Target number unavailable."); return false; }

  const res = await doTestRoll(actor, { rollFormula: ROLL_FORMULA, target, allowLucky: true, allowUnlucky: true });

  const newResult = {
    isSuccess: Boolean(res.isSuccess),
    degree: Number(res.degree ?? 0) || 0,
    isCriticalSuccess: Boolean(res.isCriticalSuccess),
    isCriticalFailure: Boolean(res.isCriticalFailure),
    rollTotal: Number(res.rollTotal ?? res.roll?.total ?? NaN),
    target,
    textual: String(res.textual ?? ""),
  };

  if (info.type === "skillTest") {
    // Update the original card's stored result so it reflects the reroll
    await _persistResult(message, info, side, newResult, {
      "flags.uesrpg.reroll.used": true,
      "flags.uesrpg.reroll.source": "luck-point",
      "flags.uesrpg.luckUsedOnTest": true,
      [`flags.${SYSTEM_ID}.luckUsedOnTest`]: true,
    });

    // Also mark the reroll metadata separately for downstream consumers
    await requestUpdateChatMessage(message, {
      "flags.uesrpg.reroll.used": true,
      "flags.uesrpg.reroll.source": "luck-point",
    });

    const flavor = `
      <div class="uesrpg">
        <div><b>${_esc(side.label)}</b> \u2014 Reroll (Spent 1 LP)</div>
        <div style="opacity:0.85; font-size:12px;"><b>Target Number:</b> ${target}</div>
        <div style="margin-top:4px;">
          ${res.isSuccess
            ? `<b style="color:green;">SUCCESS \u2014 ${formatDegree(res)}</b>`
            : `<b style="color:rgb(168,5,5);">FAILURE \u2014 ${formatDegree(res)}</b>`}
          ${res.isCriticalSuccess ? ' <span style="color:green;">(CRITICAL)</span>' : ''}
          ${res.isCriticalFailure ? ' <span style="color:red;">(CRITICAL FAIL)</span>' : ''}
        </div>
      </div>`;

    const rollMode = String(info.raw?.rollMode ?? (game.settings.get("core", "rollMode") ?? "")).trim();
    await res.roll.toMessage({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor,
      flags: {
        uesrpg: {
          reroll: { isReroll: true, parentMessageId: message.id, source: "luck-point" },
          skillTest: { ...info.raw, ...newResult, isReroll: true },
          luckUsedOnTest: true,
        },
        [SYSTEM_ID]: {
          reroll: { isReroll: true, parentMessageId: message.id, source: "luck-point" },
          skillTest: { ...info.raw, ...newResult, isReroll: true },
          luckUsedOnTest: true,
        },
      },
      rollMode,
    });
  } else {
    // For opposed cards: replace the result in-place and re-render the card
    await _persistResult(message, info, side, newResult, {
      "flags.uesrpg.luckUsedOnTest": true,
      [`flags.${SYSTEM_ID}.luckUsedOnTest`]: true,
    });

    // Post the reroll as a Roll-bearing message so Dice So Nice (3D dice) animates
    const flavor = `<div class="uesrpg">
      <div><b>${_esc(side.label)}</b> \u2014 Reroll (Spent 1 LP)</div>
      <div style="opacity:0.85; font-size:12px;"><b>Target Number:</b> ${target}</div>
      <div style="margin-top:4px;">
        ${res.isSuccess
          ? `<b style="color:green;">SUCCESS \u2014 ${formatDegree(res)}</b>`
          : `<b style="color:rgb(168,5,5);">FAILURE \u2014 ${formatDegree(res)}</b>`}
        ${res.isCriticalSuccess ? ' <span style="color:green;">(CRITICAL)</span>' : ''}
        ${res.isCriticalFailure ? ' <span style="color:red;">(CRITICAL FAIL)</span>' : ''}
      </div>
      <div style="opacity:0.7; font-size:11px;">LP remaining: ${Math.max(0, currentLp - 1)}</div>
    </div>`;
    await res.roll.toMessage({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor,
      whisper: _getWhisperRecipients(actor),
      flags: {
        uesrpg: { reroll: { isReroll: true, parentMessageId: message.id, source: "luck-point" }, luckUsedOnTest: true },
        [SYSTEM_ID]: { reroll: { isReroll: true, parentMessageId: message.id, source: "luck-point" }, luckUsedOnTest: true },
      },
    });
  }

  return true;
}

// ══════════════════════════════════════════════════════════════════════════
//  Luck Point: +1 DoS on a successful test
// ══════════════════════════════════════════════════════════════════════════

/**
 * RAW: Characters may spend a Luck Point to add +1 DoS to a successful test.
 * Can be done multiple times for a given test.
 * - Cannot be combined with Stamina on the same test
 */
async function spendLPAddDoS(message) {
  if (!message) return false;
  const info = _classifyMessage(message);
  if (!info) { ui.notifications?.warn?.("This message does not contain a test result."); return false; }
  if (info.staminaUsed) { ui.notifications?.warn?.("Cannot use both Luck and Stamina on the same test (RAW)."); return false; }

  const side = await _pickSide(info, { requireResult: true, requireSuccess: true });
  if (!side) { ui.notifications?.info?.("No successful result eligible for +1 DoS."); return false; }

  const actor = _resolveActor(message, side.actorUuid);
  if (!actor) { ui.notifications?.warn?.("Cannot resolve actor."); return false; }

  const currentLp = Number(actor.system?.luck_points?.value ?? 0);
  if (currentLp <= 0) { ui.notifications?.warn?.("No Luck Points remaining."); return false; }

  const confirmed = await confirmDialog({
    title: "Spend Luck Point \u2014 +1 DoS",
    content: `<div class="uesrpg"><p>Spend <b>1 LP</b> to add <b>+1 DoS</b> to <b>${_esc(side.label)}</b>?</p>
              <p>Current DoS: <b>${side.result.degree}</b> \u00b7 LP: <b>${currentLp}</b></p></div>`,
    yesLabel: "+1 DoS (1 LP)",
    noLabel: "Cancel",
    yesIcon: "fas fa-plus",
    rejectClose: false,
  });
  if (!confirmed) return false;

  // Deduct LP
  await requestUpdateDocument(actor, { "system.luck_points.value": Math.max(0, currentLp - 1) });

  // Bump the DoS
  const nextDegree = (side.result.degree ?? 0) + 1;
  const newResult = {
    ...side.result,
    degree: nextDegree,
    textual: `${nextDegree} DoS`,
  };

  await _persistResult(message, info, side, newResult, {
    "flags.uesrpg.luckUsedOnTest": true,
    [`flags.${SYSTEM_ID}.luckUsedOnTest`]: true,
  });

  // Notification
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="uesrpg"><b>Luck Point Spent</b>: +1 DoS on ${_esc(side.label)} (now ${nextDegree} DoS). LP remaining: ${Math.max(0, currentLp - 1)}.</div>`,
    whisper: _getWhisperRecipients(actor),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });

  return true;
}

// ══════════════════════════════════════════════════════════════════════════
//  Burn Luck – permanent characteristic reduction
// ══════════════════════════════════════════════════════════════════════════

/**
 * RAW Chapter 1 — Burn Luck permanently.
 * Options:
 *   - Burn 1: +1 DoS to a successful test
 *   - Burn 3: Reroll a failed test (once per test, not critical failures)
 *   - Burn 5: Negate critical failure effects
 *   - Burn 10: Ignore wound / survive death
 */
async function openBurnLuckDialog(actorOrMessage) {
  let actor;
  let message = null;
  let info = null;

  if (actorOrMessage?.documentName === "ChatMessage") {
    message = actorOrMessage;
    info = _classifyMessage(message);
    // Try to find an actor from the message
    if (info?.sides?.length) {
      const firstOwned = info.sides.find(s => {
        const a = _resolveActor(null, s.actorUuid);
        return _canUserActOnActor(a);
      });
      actor = firstOwned ? _resolveActor(null, firstOwned.actorUuid) : null;
    }
    if (!actor) actor = _resolveActorFromSpeaker(message);
  } else if (actorOrMessage?.documentName === "Actor") {
    actor = actorOrMessage;
  } else {
    actor = actorOrMessage;
  }

  if (!actor) { ui.notifications?.warn?.("No actor found for Burn Luck."); return; }

  const hasMessage = Boolean(message && info);

  const currentLuck = Number(actor.system?.characteristics?.lck?.total ?? actor.system?.characteristics?.lck?.value ?? 0);
  const luckBonus = Number(actor.system?.characteristics?.lck?.bonus ?? 0);

  const burnOptions = [
    { id: "burn1", cost: 1, label: "+1 DoS to a successful test", requiresMessage: true, requiresSuccess: true },
    { id: "burn3", cost: 3, label: "Reroll a failed test", requiresMessage: true, requiresFailure: true },
    { id: "burn5", cost: 5, label: "Negate effects of a Critical Failure", requiresMessage: true },
    { id: "burn10", cost: 10, label: "Ignore wound effects / survive death (GM permission)", requiresMessage: false },
  ];

  const optionRows = burnOptions.map(opt => {
    const available = currentLuck >= opt.cost;
    const disabled = available ? "" : "disabled";
    const contextNote = opt.requiresMessage && !hasMessage ? " (requires a test roll)" : "";
    return `<option value="${opt.id}" ${disabled}>${opt.label} (Burn ${opt.cost} Luck)${contextNote}</option>`;
  }).join("");

  await customDialog({
    title: "Burn Luck",
    content: `<div class="uesrpg" style="padding: 10px;">
      <div style="background: rgba(180, 180, 180, 0.562); border: solid 1px; padding: 10px; font-style: italic; margin-bottom: 10px;">
        Permanently reduce your Luck characteristic to gain powerful effects. Burned Luck never regenerates naturally.
      </div>
      <div style="margin-bottom: 8px;">
        <b>${_esc(actor.name)}</b> \u2014 Current Luck: <b>${currentLuck}</b> (Bonus: ${luckBonus})
      </div>
      <label style="font-weight: 600;">Burn Effect:</label>
      <select name="burn-option" style="width: 100%; margin-top: 4px;">${optionRows}</select>
    </div>`,
    buttons: {
      burn: {
        label: "Burn Luck",
        icon: "fas fa-fire",
        callback: async (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const selected = root?.querySelector('select[name="burn-option"]')?.value;
          if (!selected) return;
          const opt = burnOptions.find(o => o.id === selected);
          if (!opt) return;
          if (currentLuck < opt.cost) {
            ui.notifications?.warn?.(`Not enough Luck to burn. Need ${opt.cost}, have ${currentLuck}.`);
            return;
          }
          await _executeBurn(actor, message, info, opt);
        }
      },
      cancel: { label: "Cancel", icon: "fas fa-times" }
    },
    default: "cancel",
    width: 550,
  });
}

async function _executeBurn(actor, message, info, opt) {
  const burnAmount = opt.cost;
  const currentLuck = Number(actor.system?.characteristics?.lck?.total ?? actor.system?.characteristics?.lck?.value ?? 0);
  const currentBase = Number(actor.system?.characteristics?.lck?.base ?? actor.system?.characteristics?.lck?.value ?? 0);

  // Reduce Luck permanently
  await requestUpdateDocument(actor, {
    "system.characteristics.lck.value": Math.max(0, currentLuck - burnAmount),
    "system.characteristics.lck.base": Math.max(0, currentBase - burnAmount),
  });

  let effectText = "";

  switch (opt.id) {
    case "burn1": {
      // +1 DoS to a successful test – requires message
      if (message && info) {
        const side = await _pickSide(info, { requireResult: true, requireSuccess: true });
        if (side) {
          const nextDegree = (side.result.degree ?? 0) + 1;
          const newResult = { ...side.result, degree: nextDegree, textual: `${nextDegree} DoS` };
          await _persistResult(message, info, side, newResult, {
            "flags.uesrpg.luckBurned": true,
            [`flags.${SYSTEM_ID}.luckBurned`]: true,
          });
          effectText = `+1 DoS on ${side.label} (now ${nextDegree} DoS)`;
        } else {
          effectText = "No eligible successful result found.";
        }
      } else {
        effectText = "+1 DoS (apply manually to next successful test)";
      }
      break;
    }

    case "burn3": {
      // Reroll a failed test
      if (message && info) {
        const side = await _pickSide(info, { requireResult: true, requireFailure: true });
        if (!side) { effectText = "No failed result eligible for reroll."; break; }
        if (side.result?.isCriticalFailure) { effectText = "Cannot reroll Critical Failures, even with burned Luck."; break; }

        const target = side.tn ?? (side.result?.target ?? NaN);
        if (!Number.isFinite(target)) { effectText = "Target number unavailable."; break; }

        const sideActor = _resolveActor(null, side.actorUuid) ?? actor;
        const res = await doTestRoll(sideActor, { rollFormula: ROLL_FORMULA, target, allowLucky: true, allowUnlucky: true });
        const newResult = {
          isSuccess: Boolean(res.isSuccess),
          degree: Number(res.degree ?? 0) || 0,
          isCriticalSuccess: Boolean(res.isCriticalSuccess),
          isCriticalFailure: Boolean(res.isCriticalFailure),
          rollTotal: Number(res.rollTotal ?? res.roll?.total ?? NaN),
          target,
          textual: String(res.textual ?? ""),
        };

        if (info.type === "skillTest") {
          // Update the original card's stored result so it reflects the reroll
          await _persistResult(message, info, side, newResult, {
            "flags.uesrpg.reroll.used": true,
            "flags.uesrpg.reroll.source": "luck-burn",
            "flags.uesrpg.luckBurned": true,
            [`flags.${SYSTEM_ID}.luckBurned`]: true,
          });

          // Also mark the reroll metadata separately for downstream consumers
          await requestUpdateChatMessage(message, {
            "flags.uesrpg.reroll.used": true,
            "flags.uesrpg.reroll.source": "luck-burn",
          });
          const flavor = `<div class="uesrpg"><div><b>${_esc(side.label)}</b> \u2014 Reroll (Burned ${burnAmount} Luck)</div>
            <div style="opacity:0.85; font-size:12px;"><b>Target Number:</b> ${target}</div>
            <div style="margin-top:4px;">${res.isSuccess
              ? `<b style="color:green;">SUCCESS \u2014 ${formatDegree(res)}</b>`
              : `<b style="color:rgb(168,5,5);">FAILURE \u2014 ${formatDegree(res)}</b>`}</div></div>`;
          const rollMode = String(info.raw?.rollMode ?? (game.settings.get("core", "rollMode") ?? "")).trim();
          await res.roll.toMessage({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: sideActor }),
            flavor,
            flags: {
              uesrpg: { reroll: { isReroll: true, parentMessageId: message.id, source: "luck-burn" }, luckBurned: true },
              [SYSTEM_ID]: { reroll: { isReroll: true, parentMessageId: message.id, source: "luck-burn" }, luckBurned: true },
            },
            rollMode,
          });
        } else {
          // Opposed card: update in-place, re-resolve outcome, re-render
          await _persistResult(message, info, side, newResult, {
            "flags.uesrpg.luckBurned": true,
            [`flags.${SYSTEM_ID}.luckBurned`]: true,
          });

          // Post Roll-bearing message so Dice So Nice (3D dice) animates
          const burnFlavor = `<div class="uesrpg">
            <div><b>${_esc(side.label)}</b> \u2014 Reroll (Burned ${burnAmount} Luck)</div>
            <div style="opacity:0.85; font-size:12px;"><b>Target Number:</b> ${target}</div>
            <div style="margin-top:4px;">${res.isSuccess
              ? `<b style="color:green;">SUCCESS \u2014 ${formatDegree(res)}</b>`
              : `<b style="color:rgb(168,5,5);">FAILURE \u2014 ${formatDegree(res)}</b>`}</div>
          </div>`;
          await res.roll.toMessage({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: sideActor }),
            flavor: burnFlavor,
            flags: {
              uesrpg: { reroll: { isReroll: true, parentMessageId: message.id, source: "luck-burn" }, luckBurned: true },
              [SYSTEM_ID]: { reroll: { isReroll: true, parentMessageId: message.id, source: "luck-burn" }, luckBurned: true },
            },
          });
        }
        effectText = `Rerolled ${side.label}: ${res.isSuccess ? `SUCCESS (${formatDegree(res)})` : `FAILURE (${formatDegree(res)})`}`;
      } else {
        effectText = "Reroll (apply manually to next failed test)";
      }
      break;
    }

    case "burn5": {
      // Negate critical failure effects
      effectText = "Critical Failure effects negated.";
      if (message) {
        await requestUpdateChatMessage(message, {
          "flags.uesrpg.luckBurned": true,
          "flags.uesrpg.criticalFailureNegated": true,
          [`flags.${SYSTEM_ID}.luckBurned`]: true,
          [`flags.${SYSTEM_ID}.criticalFailureNegated`]: true,
        });
      }
      break;
    }

    case "burn10": {
      effectText = "Wound effects ignored / death survived (GM decision).";
      break;
    }
  }

  // Post chat notification about the burn
  const remainingLuck = Math.max(0, currentLuck - burnAmount);
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="uesrpg">
      <h3 style="color: #c44;">Luck Burned</h3>
      <p><b>${_esc(actor.name)}</b> permanently burned <b>${burnAmount} Luck</b>.</p>
      <p><b>Effect:</b> ${_esc(effectText)}</p>
      <p><b>Remaining Luck:</b> ${remainingLuck}</p>
    </div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  Context Menu Registration
// ══════════════════════════════════════════════════════════════════════════

/**
 * Register Luck context menu options on chat messages.
 * Called once per hook from initializeChatHandlers().
 */
export function registerLuckContextMenuOptions(hookName, options) {
  if (!Array.isArray(options)) return;

  // Guard against duplicate entries
  const hasLP = options.some(o => String(o?.name ?? "").trim() === "Spend Luck Point");
  const hasBurn = options.some(o => String(o?.name ?? "").trim() === "Burn Luck");

  if (!hasLP) {
    options.push({
      name: "Spend Luck Point",
      icon: '<i class="fas fa-clover"></i>',
      condition: (li) => {
        const msgId = _getMessageIdFromContextLi(li);
        if (!msgId) return false;
        const message = game.messages?.get?.(msgId);
        if (!message) return false;
        const info = _classifyMessage(message);
        if (!info) return false;
        // Must have at least one side with a result that the current user can act on
        const hasEligibleSide = info.sides.some(s => {
          if (!s.result) return false;
          const actor = _resolveActor(null, s.actorUuid);
          if (!_canUserActOnActor(actor)) return false;
          const lp = Number(actor?.system?.luck_points?.value ?? 0);
          return lp > 0;
        });
        if (!hasEligibleSide) return false;
        if (info.staminaUsed) return false;
        return true;
      },
      callback: async (li) => {
        const msgId = _getMessageIdFromContextLi(li);
        const message = game.messages?.get?.(msgId);
        if (!message) return;
        const info = _classifyMessage(message);
        if (!info) return;

        // Determine whether to offer reroll or DoS based on available sides
        const hasFailure = info.sides.some(s =>
          s.result?.isSuccess === false && _canUserActOnActor(_resolveActor(null, s.actorUuid))
        );
        const hasSuccess = info.sides.some(s =>
          s.result?.isSuccess === true && _canUserActOnActor(_resolveActor(null, s.actorUuid))
        );

        if (hasFailure && hasSuccess) {
          // Both available — ask user
          const choice = await _askRerollOrDoS();
          if (choice === "reroll") await spendLPReroll(message);
          else if (choice === "dos") await spendLPAddDoS(message);
        } else if (hasFailure) {
          await spendLPReroll(message);
        } else if (hasSuccess) {
          await spendLPAddDoS(message);
        }
      }
    });
  }

  if (!hasBurn) {
    options.push({
      name: "Burn Luck",
      icon: '<i class="fas fa-fire"></i>',
      condition: (li) => {
        const msgId = _getMessageIdFromContextLi(li);
        if (!msgId) return false;
        const message = game.messages?.get?.(msgId);
        if (!message) return false;
        const info = _classifyMessage(message);
        if (!info) return false;
        return info.sides.some(s => {
          const actor = _resolveActor(null, s.actorUuid);
          if (!_canUserActOnActor(actor)) return false;
          const luck = Number(actor?.system?.characteristics?.lck?.total ?? actor?.system?.characteristics?.lck?.value ?? 0);
          return luck > 0;
        });
      },
      callback: async (li) => {
        const msgId = _getMessageIdFromContextLi(li);
        const message = game.messages?.get?.(msgId);
        if (!message) return;
        await openBurnLuckDialog(message);
      }
    });
  }
}

// ── Helper: ask user whether to reroll or add DoS ───────────────────────

async function _askRerollOrDoS() {
  return new Promise((resolve) => {
    customDialog({
      title: "Spend Luck Point",
      content: `<div class="uesrpg" style="padding:8px;">
        <p>This test has both failed and successful sides. What would you like to do?</p>
        <select name="luck-action" style="width:100%;">
          <option value="reroll">Reroll a failed test (1 LP)</option>
          <option value="dos">+1 DoS on a successful test (1 LP)</option>
        </select>
      </div>`,
      buttons: {
        ok: {
          label: "Confirm",
          icon: "fas fa-check",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            resolve(root?.querySelector('select[name="luck-action"]')?.value ?? null);
          }
        },
        cancel: { label: "Cancel", icon: "fas fa-times", callback: () => resolve(null) }
      },
      default: "ok",
      width: 380,
    }).catch(() => resolve(null));
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  Sheet action: Burn Luck from LP label click
// ══════════════════════════════════════════════════════════════════════════

export function openBurnLuckFromSheet(actor) {
  return openBurnLuckDialog(actor);
}

// ══════════════════════════════════════════════════════════════════════════
//  Stamina mutual-exclusion flag setter
// ══════════════════════════════════════════════════════════════════════════

/**
 * Mark a chat message as having had Stamina used on its test.
 * @param {ChatMessage} message
 */
export async function markStaminaUsedOnTest(message) {
  if (!message) return;
  await requestUpdateChatMessage(message, {
    "flags.uesrpg.staminaUsedOnTest": true,
    [`flags.${SYSTEM_ID}.staminaUsedOnTest`]: true,
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  Public API (game.uesrpg.luck)
// ══════════════════════════════════════════════════════════════════════════

export const LuckAPI = {
  spendLPReroll,
  spendLPAddDoS,
  openBurnDialog: openBurnLuckDialog,
  openBurnLuckFromSheet,
  registerLuckContextMenuOptions,
  markStaminaUsedOnTest,
};
