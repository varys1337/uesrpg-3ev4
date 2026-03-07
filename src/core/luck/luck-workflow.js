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
 *  - Registered once from `registerCombatChatHandlers()`
 *  - Exposed on  game.uesrpg.luck  for macro / external use
 */

import { doesUserOwnActor, requestUpdateDocument, requestUpdateChatMessage } from "../../utils/authority-proxy.js";
import { canUserRollActor } from "../../utils/permissions.js";
import { customDialog, confirmDialog } from "../../utils/dialog-v2-helper.js";
import { doTestRoll, formatDegree, resolveOpposed } from "../../utils/degree-roll-helper.js";
import { cloneFlagState } from "../../utils/clone.js";
import { SYSTEM_ID } from "../constants.js";
import { getMessageIdFromContextLi } from "../../utils/chat/contextmenu.js";
import { getFlagValueWithFallback } from "../system/flags.js";

// ── Constants ───────────────────────────────────────────────────────────

const ROLL_FORMULA = "1d100";
let _combatOpposedLuckDepsP = null;
let _magicOpposedLuckDepsP = null;
let _skillOpposedUpdaterP = null;
let _charOpposedUpdaterP = null;

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
    if (doesUserOwnActor(user, actor)) out.add(user.id);
  }
  return Array.from(out);
}

// ── Robust context-menu message-ID extractor ────────────────────────────
// Mirrors the canonical implementation in combat chat handlers.

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
 *   luckBurned: boolean,
 *   rerolled: boolean
 * }
 * ```
 */
function _classifyMessage(message) {
  if (!message) return null;
  const sysFlags = message.flags?.[SYSTEM_ID] ?? {};
  const legacyFlags = message.flags?.uesrpg ?? {};

  // ── 1. Standalone skill test ──────────────────────────────────────────
  const st = getFlagValueWithFallback(message, "skillTest");
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
      staminaUsed: Boolean(getFlagValueWithFallback(message, "staminaUsedOnTest")),
      luckUsed: Boolean(getFlagValueWithFallback(message, "luckUsedOnTest")),
      luckBurned: Boolean(getFlagValueWithFallback(message, "luckBurned")),
      rerolled: Boolean(getFlagValueWithFallback(message, "reroll.used") || getFlagValueWithFallback(message, "reroll.isReroll")),
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
      luckBurned: Boolean(combatData.context?.luckBurned),
      rerolled: Boolean(combatData.context?.rerollUsed === true),
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
        luckBurned: Boolean(data.context?.luckBurned),
        rerolled: Boolean(data.context?.rerollUsed === true),
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
        luckBurned: Boolean(data.context?.luckBurned),
        rerolled: Boolean(data.context?.rerollUsed === true),
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
        luckBurned: Boolean(data.context?.luckBurned),
        rerolled: Boolean(data.context?.rerollUsed === true),
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

function _mapExtraFlagsToContext(extraFlags = {}) {
  const ctx = {};
  if (!extraFlags || typeof extraFlags !== "object") return ctx;

  const getBool = (a, b) => {
    if (extraFlags[a] !== undefined) return Boolean(extraFlags[a]);
    if (extraFlags[b] !== undefined) return Boolean(extraFlags[b]);
    return undefined;
  };

  const luckUsed = getBool(`flags.${SYSTEM_ID}.luckUsedOnTest`, `flags.${SYSTEM_ID}.luckUsedOnTest`);
  if (luckUsed !== undefined) ctx.luckUsed = luckUsed;

  const luckBurned = getBool(`flags.${SYSTEM_ID}.luckBurned`, `flags.${SYSTEM_ID}.luckBurned`);
  if (luckBurned !== undefined) ctx.luckBurned = luckBurned;

  const rerollUsed = getBool(`flags.${SYSTEM_ID}.reroll.used`, `flags.${SYSTEM_ID}.reroll.used`);
  if (rerollUsed !== undefined) ctx.rerollUsed = rerollUsed;

  const rerollSource =
    extraFlags[`flags.${SYSTEM_ID}.reroll.source`];
  if (typeof rerollSource === "string" && rerollSource.trim()) {
    ctx.rerollSource = rerollSource.trim();
  }

  return ctx;
}

function _isResultMatch(actual, expected) {
  if (!actual || !expected) return false;
  return (
    Boolean(actual.isSuccess) === Boolean(expected.isSuccess) &&
    (Number(actual.degree ?? 0) || 0) === (Number(expected.degree ?? 0) || 0) &&
    Boolean(actual.isCriticalSuccess) === Boolean(expected.isCriticalSuccess) &&
    Boolean(actual.isCriticalFailure) === Boolean(expected.isCriticalFailure) &&
    String(actual.textual ?? "") === String(expected.textual ?? "")
  );
}

function _selectSideByRef(info, sideRef) {
  if (!info || !sideRef) return null;
  if (sideRef.role === "defender") {
    const defenders = info.sides.filter((s) => s.role === "defender");
    if (Number.isInteger(sideRef.defenderIndex) && sideRef.defenderIndex >= 0) {
      return defenders[sideRef.defenderIndex] ?? null;
    }
    return defenders[0] ?? null;
  }
  return info.sides.find((s) => s.role === sideRef.role) ?? null;
}

function _didPersistResult(messageId, infoType, sideRef, expectedResult) {
  const live = game.messages?.get?.(messageId) ?? null;
  if (!live) return false;
  const updated = _classifyMessage(live);
  if (!updated || updated.type !== infoType) return false;
  const side = _selectSideByRef(updated, sideRef);
  return _isResultMatch(side?.result, expectedResult);
}

function _getBurnBaseLuck(actor) {
  return Number(actor?.system?.characteristics?.lck?.base ?? actor?.system?.characteristics?.lck?.value ?? 0) || 0;
}

function _getTotalLuck(actor) {
  return Number(actor?.system?.characteristics?.lck?.total ?? actor?.system?.characteristics?.lck?.value ?? 0) || 0;
}

async function _spendLuckPoint(actor, amount = 1) {
  const currentLp = Number(actor?.system?.luck_points?.value ?? 0) || 0;
  const cost = Math.max(0, Number(amount ?? 0) || 0);
  if (cost <= 0) return true;
  const nextLp = Math.max(0, currentLp - cost);
  return await requestUpdateDocument(actor, { "system.luck_points.value": nextLp });
}

async function _applyLuckBurnCost(actor, burnAmount) {
  const currentBase = _getBurnBaseLuck(actor);
  const nextBase = Math.max(0, currentBase - Math.max(0, Number(burnAmount ?? 0) || 0));
  const ok = await requestUpdateDocument(actor, {
    "system.characteristics.lck.base": nextBase,
    "system.characteristics.lck.value": nextBase,
  });
  return { ok, currentBase, nextBase };
}

function _getCombatOpposedLuckDeps() {
  if (!_combatOpposedLuckDepsP) {
    _combatOpposedLuckDepsP = Promise.all([
      import("../combat/opposed/cards/updater.js"),
      import("../combat/opposed/render.js"),
      import("../combat/opposed/outcome-resolution.js"),
    ]);
  }
  return _combatOpposedLuckDepsP;
}

function _getMagicOpposedLuckDeps() {
  if (!_magicOpposedLuckDepsP) {
    _magicOpposedLuckDepsP = Promise.all([
      import("../magic/opposed/updater.js"),
      import("../magic/opposed/render.js"),
    ]);
  }
  return _magicOpposedLuckDepsP;
}

function _getSkillOpposedUpdater() {
  if (!_skillOpposedUpdaterP) {
    _skillOpposedUpdaterP = import("../skills/opposed-workflow/core/card-updater.js");
  }
  return _skillOpposedUpdaterP;
}

function _getCharOpposedUpdater() {
  if (!_charOpposedUpdaterP) {
    _charOpposedUpdaterP = import("../characteristics/opposed/card-updater.js");
  }
  return _charOpposedUpdaterP;
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
      return _persistCombatOpposedResult(message, side, newResult, _mapExtraFlagsToContext(extraFlags));
    case "skillOpposed":
      return _persistSkillOpposedResult(message, side, newResult, _mapExtraFlagsToContext(extraFlags));
    case "charOpposed":
      return _persistCharOpposedResult(message, side, newResult, _mapExtraFlagsToContext(extraFlags));
    case "magicOpposed":
      return _persistMagicOpposedResult(message, side, newResult, _mapExtraFlagsToContext(extraFlags));
    default:
      console.warn(`UESRPG | Luck: unknown card type "${info.type}"`);
      return false;
  }
}

// ── Standalone skill test ───────────────────────────────────────────────

async function _persistSkillTestResult(message, newResult, extraFlags) {
  const update = {
    [`flags.${SYSTEM_ID}.skillTest.isSuccess`]: newResult.isSuccess,
    [`flags.${SYSTEM_ID}.skillTest.degree`]: newResult.degree,
    [`flags.${SYSTEM_ID}.skillTest.textual`]: newResult.textual ?? `${newResult.degree} ${newResult.isSuccess ? "DoS" : "DoF"}`,
    ...extraFlags,
  };
  return await requestUpdateChatMessage(message, update);
}

// ── Combat opposed ──────────────────────────────────────────────────────

async function _persistCombatOpposedResult(message, side, newResult, extraContext = {}) {
  // Lazy-load the combat card updater + render + outcome resolver
  const [
    { updateCard },
    { _renderCard },
    { resolveOutcomeRAW },
  ] = await _getCombatOpposedLuckDeps();

  // Re-read live flags to avoid stale writes
  const live = game.messages?.get?.(message.id) ?? message;
  const raw = live.flags?.[SYSTEM_ID]?.opposed;
  if (!raw) return false;
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
  data.context.luckUsed = (extraContext.luckUsed ?? true) === true;
  if (extraContext.luckBurned !== undefined) data.context.luckBurned = Boolean(extraContext.luckBurned);
  if (extraContext.rerollUsed !== undefined) data.context.rerollUsed = Boolean(extraContext.rerollUsed);
  if (extraContext.rerollSource !== undefined) data.context.rerollSource = String(extraContext.rerollSource);

  await updateCard(live, data, _renderCard);
  return _didPersistResult(message.id, "combatOpposed", side, newResult);
}

// ── Skill opposed ───────────────────────────────────────────────────────

async function _persistSkillOpposedResult(message, side, newResult, extraContext = {}) {
  const { _updateCard } = await _getSkillOpposedUpdater();

  const live = game.messages?.get?.(message.id) ?? message;
  const raw = live.flags?.[SYSTEM_ID]?.skillOpposed;
  if (!raw) return false;
  const data = cloneFlagState(raw.state ?? raw);

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
  data.context.luckUsed = (extraContext.luckUsed ?? true) === true;
  if (extraContext.luckBurned !== undefined) data.context.luckBurned = Boolean(extraContext.luckBurned);
  if (extraContext.rerollUsed !== undefined) data.context.rerollUsed = Boolean(extraContext.rerollUsed);
  if (extraContext.rerollSource !== undefined) data.context.rerollSource = String(extraContext.rerollSource);

  await _updateCard(live, data);
  return _didPersistResult(message.id, "skillOpposed", side, newResult);
}

// ── Characteristic opposed ──────────────────────────────────────────────

async function _persistCharOpposedResult(message, side, newResult, extraContext = {}) {
  const { _updateCard } = await _getCharOpposedUpdater();

  const live = game.messages?.get?.(message.id) ?? message;
  const raw = live.flags?.[SYSTEM_ID]?.charOpposed;
  if (!raw) return false;
  const data = cloneFlagState(raw.state ?? raw);

  if (side.role === "attacker") {
    data.attacker.result = newResult;
  } else if (data.defender) {
    data.defender.result = newResult;
  }

  if (data.attacker?.result && data.defender?.result) {
    data.outcome = resolveOpposed(data.attacker.result, data.defender.result);
  }

  data.context = data.context ?? {};
  data.context.luckUsed = (extraContext.luckUsed ?? true) === true;
  if (extraContext.luckBurned !== undefined) data.context.luckBurned = Boolean(extraContext.luckBurned);
  if (extraContext.rerollUsed !== undefined) data.context.rerollUsed = Boolean(extraContext.rerollUsed);
  if (extraContext.rerollSource !== undefined) data.context.rerollSource = String(extraContext.rerollSource);

  await _updateCard(live, data);
  return _didPersistResult(message.id, "charOpposed", side, newResult);
}

// ── Magic opposed ───────────────────────────────────────────────────────

async function _persistMagicOpposedResult(message, side, newResult, extraContext = {}) {
  const [
    { updateCard },
    { renderCard },
  ] = await _getMagicOpposedLuckDeps();

  const live = game.messages?.get?.(message.id) ?? message;
  const raw = live.flags?.[SYSTEM_ID]?.magicOpposed;
  if (!raw) return false;
  const data = cloneFlagState(raw.state ?? raw);

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
  data.context.luckUsed = (extraContext.luckUsed ?? true) === true;
  if (extraContext.luckBurned !== undefined) data.context.luckBurned = Boolean(extraContext.luckBurned);
  if (extraContext.rerollUsed !== undefined) data.context.rerollUsed = Boolean(extraContext.rerollUsed);
  if (extraContext.rerollSource !== undefined) data.context.rerollSource = String(extraContext.rerollSource);

  await updateCard(live, data, renderCard);
  return _didPersistResult(message.id, "magicOpposed", side, newResult);
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

  const target = side.tn ?? (result?.target ?? NaN);
  if (!Number.isFinite(target)) { ui.notifications?.warn?.("Target number unavailable."); return false; }

  const confirmed = await confirmDialog({
    title: "Spend Luck Point - Reroll",
    content: `<div class="uesrpg"><p>Spend <b>1 LP</b> to reroll <b>${_esc(side.label)}</b>?</p>
              <p>Current LP: <b>${currentLp}</b></p></div>`,
    yesLabel: "Reroll (1 LP)",
    noLabel: "Cancel",
    yesIcon: "fas fa-dice-d20",
    rejectClose: false,
  });
  if (!confirmed) return false;

  // Execute the reroll
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
    const persisted = await _persistResult(message, info, side, newResult, {
      [`flags.${SYSTEM_ID}.reroll.used`]: true,
      [`flags.${SYSTEM_ID}.reroll.source`]: "luck-point",
      [`flags.${SYSTEM_ID}.luckUsedOnTest`]: true,
    });
    if (!persisted) {
      ui.notifications?.warn?.("Could not persist reroll result. Luck Point was not spent.");
      return false;
    }

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
    const persisted = await _persistResult(message, info, side, newResult, {
      [`flags.${SYSTEM_ID}.luckUsedOnTest`]: true,
      [`flags.${SYSTEM_ID}.reroll.used`]: true,
      [`flags.${SYSTEM_ID}.reroll.source`]: "luck-point",
    });
    if (!persisted) {
      ui.notifications?.warn?.("Could not persist reroll result. Luck Point was not spent.");
      return false;
    }

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
        [SYSTEM_ID]: { reroll: { isReroll: true, parentMessageId: message.id, source: "luck-point" }, luckUsedOnTest: true },
      },
    });
  }

  const lpSpent = await _spendLuckPoint(actor, 1);
  if (!lpSpent) ui.notifications?.warn?.("Reroll applied but LP could not be deducted.");

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
    title: "Spend Luck Point - +1 DoS",
    content: `<div class="uesrpg"><p>Spend <b>1 LP</b> to add <b>+1 DoS</b> to <b>${_esc(side.label)}</b>?</p>
              <p>Current DoS: <b>${side.result.degree}</b> \u00b7 LP: <b>${currentLp}</b></p></div>`,
    yesLabel: "+1 DoS (1 LP)",
    noLabel: "Cancel",
    yesIcon: "fas fa-plus",
    rejectClose: false,
  });
  if (!confirmed) return false;

  // Bump the DoS
  const nextDegree = (side.result.degree ?? 0) + 1;
  const newResult = {
    ...side.result,
    degree: nextDegree,
    textual: `${nextDegree} DoS`,
  };

  const persisted = await _persistResult(message, info, side, newResult, {
    [`flags.${SYSTEM_ID}.luckUsedOnTest`]: true,
  });
  if (!persisted) {
    ui.notifications?.warn?.("Could not persist +1 DoS. Luck Point was not spent.");
    return false;
  }

  const lpSpent = await _spendLuckPoint(actor, 1);
  if (!lpSpent) ui.notifications?.warn?.("+1 DoS applied but LP could not be deducted.");

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

  const currentLuck = _getBurnBaseLuck(actor);
  const totalLuck = _getTotalLuck(actor);
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
        <b>${_esc(actor.name)}</b> \u2014 Burnable Luck (base): <b>${currentLuck}</b> \u00b7 Total Luck: <b>${totalLuck}</b> (Bonus: ${luckBonus})
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
  const currentBase = _getBurnBaseLuck(actor);

  if (currentBase < burnAmount) {
    ui.notifications?.warn?.(`Not enough Luck to burn. Need ${burnAmount}, have ${currentBase}.`);
    return false;
  }

  let effectText = "";

  switch (opt.id) {
    case "burn1": {
      // +1 DoS to a successful test - requires applicable message context
      if (!message || !info) {
        ui.notifications?.warn?.("Burn 1 requires an applicable test card.");
        return false;
      }

      const side = await _pickSide(info, { requireResult: true, requireSuccess: true });
      if (!side) {
        ui.notifications?.warn?.("No successful result eligible for Burn 1.");
        return false;
      }

      const nextDegree = (side.result.degree ?? 0) + 1;
      const newResult = { ...side.result, degree: nextDegree, textual: `${nextDegree} DoS` };
      const persisted = await _persistResult(message, info, side, newResult, {
        [`flags.${SYSTEM_ID}.luckBurned`]: true,
      });
      if (!persisted) {
        ui.notifications?.warn?.("Could not apply Burn 1 effect. Luck was not burned.");
        return false;
      }

      effectText = `+1 DoS on ${side.label} (now ${nextDegree} DoS)`;
      break;
    }

    case "burn3": {
      // Reroll a failed test
      if (!message || !info) {
        ui.notifications?.warn?.("Burn 3 requires an applicable test card.");
        return false;
      }

      const side = await _pickSide(info, { requireResult: true, requireFailure: true });
      if (!side) {
        ui.notifications?.warn?.("No failed result eligible for Burn 3 reroll.");
        return false;
      }
      if (side.result?.isCriticalFailure) {
        ui.notifications?.warn?.("Cannot reroll Critical Failures, even with burned Luck.");
        return false;
      }

      const target = side.tn ?? (side.result?.target ?? NaN);
      if (!Number.isFinite(target)) {
        ui.notifications?.warn?.("Target number unavailable for Burn 3 reroll.");
        return false;
      }

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

      const persisted = await _persistResult(message, info, side, newResult, {
        [`flags.${SYSTEM_ID}.reroll.used`]: true,
        [`flags.${SYSTEM_ID}.reroll.source`]: "luck-burn",
        [`flags.${SYSTEM_ID}.luckBurned`]: true,
      });
      if (!persisted) {
        ui.notifications?.warn?.("Could not apply Burn 3 reroll. Luck was not burned.");
        return false;
      }

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
          [SYSTEM_ID]: { reroll: { isReroll: true, parentMessageId: message.id, source: "luck-burn" }, luckBurned: true },
        },
        rollMode,
      });

      effectText = `Rerolled ${side.label}: ${res.isSuccess ? `SUCCESS (${formatDegree(res)})` : `FAILURE (${formatDegree(res)})`}`;
      break;
    }

    case "burn5": {
      // Negate critical failure effects
      effectText = "Critical Failure effects negated.";
      if (message) {
        await requestUpdateChatMessage(message, {
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

    default:
      ui.notifications?.warn?.("Unknown burn option.");
      return false;
  }

  const burnApplied = await _applyLuckBurnCost(actor, burnAmount);
  if (!burnApplied?.ok) {
    ui.notifications?.warn?.("Burn effect applied, but permanent Luck could not be reduced.");
    return false;
  }

  // Post chat notification about the burn
  const remainingLuck = burnApplied.nextBase;
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

  return true;
}
// ══════════════════════════════════════════════════════════════════════════
//  Context Menu Registration
// ══════════════════════════════════════════════════════════════════════════

/**
 * Register Luck context menu options on chat messages.
 * Called once per hook registration from combat chat handlers.
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
        const msgId = getMessageIdFromContextLi(li);
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
        const msgId = getMessageIdFromContextLi(li);
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
        const msgId = getMessageIdFromContextLi(li);
        if (!msgId) return false;
        const message = game.messages?.get?.(msgId);
        if (!message) return false;
        const info = _classifyMessage(message);
        if (!info) return false;
        return info.sides.some(s => {
          const actor = _resolveActor(null, s.actorUuid);
          if (!_canUserActOnActor(actor)) return false;
          const luck = _getBurnBaseLuck(actor);
          return luck > 0;
        });
      },
      callback: async (li) => {
        const msgId = getMessageIdFromContextLi(li);
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

