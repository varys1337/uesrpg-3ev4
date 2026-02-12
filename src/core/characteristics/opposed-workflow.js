/**
 * src/core/characteristics/opposed-workflow.js
 *
 * Characteristic opposed workflow façade.
 *
 * Provides an opposed Characteristic test (e.g. WP vs WP for Sunder Binding).
 * Modeled after the skill opposed workflow but simplified — no skill selection,
 * specializations, or combat style logic. Just characteristic + manual modifier.
 *
 * Lifecycle:
 *  1. createPending() — posts an opposed card to chat
 *  2. Attacker clicks "Commit Choices" → handleAction("attacker-roll")
 *  3. Defender clicks "Commit Choices" → handleAction("defender-roll")
 *  4. Both committed → GM auto-rolls or "Begin Opposed Roll" button
 *  5. Outcome resolved and card updated
 *
 * Target: Foundry VTT v13.351
 */

import { doTestRoll, resolveOpposed, computeResultFromRollTotal } from "../../utils/degree-roll-helper.js";
import { requireUserCanRollActor } from "../../utils/permissions.js";

import { FLAG_NS, FLAG_KEY, CARD_VERSION, CHARACTERISTICS, bankedAutoRollLocalLocks } from "./opposed/constants.js";
import { _bothSidesCommitted, _getMessageState, _normalizeCardFlag } from "./opposed/schema.js";
import { _resolveDoc, _resolveActor, _resolveToken } from "./opposed/docs.js";
import { _canControlActor, _userHasActorOwnership, _esc, _fmtDegree } from "./opposed/util.js";
import { _renderCard, _btn } from "./opposed/render.js";
import { _updateCard } from "./opposed/card-updater.js";
import { _charTestDialog } from "./opposed/dialogs.js";
import { _resolveOutcome, computeCharacteristicTN } from "./opposed/helpers.js";
import { buildRollContext } from "../rules/roll-context.js";
import { applyRuntimePreRollToTN, applyRuntimePostRollToResult } from "../traits/features/rule-element-runtime.js";


// ── Roll-off for both critical successes ──

async function _maybeResolveBothCritSuccessRollOff({ message, data, attacker, defender } = {}) {
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
      winner: out.winner, reason: out.reason
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
  } else {
    data.outcome = {
      winner: "tie",
      reason: "both critical success (roll-off unresolved)",
      text: `Tie — roll-off still unresolved after ${maxAttempts} attempts.`
    };
  }
}


// ── Public API ──

export const CharOpposedWorkflow = {

  /**
   * Create a pending opposed characteristic test card.
   *
   * @param {object} opts
   * @param {Actor|string}  opts.attacker - Attacker actor or UUID
   * @param {Actor|string}  opts.defender - Defender actor or UUID
   * @param {string}        [opts.charKey="wp"] - Characteristic key
   * @param {number}        [opts.ssModifier=0] - Spell Strength modifier (applied to defender TN)
   * @param {string}        [opts.label=""] - Context label for the card
   * @returns {Promise<ChatMessage|null>}
   */
  async createPending({ attacker, defender, charKey = "wp", ssModifier = 0, label = "" } = {}) {
    const attackerActor = _resolveActor(attacker);
    const defenderActor = _resolveActor(defender);
    if (!attackerActor || !defenderActor) {
      ui.notifications.warn("Cannot create opposed characteristic test: missing attacker or defender.");
      return null;
    }

    const attackerToken = _resolveToken(attacker);
    const defenderToken = _resolveToken(defender);

    const charLabel = CHARACTERISTICS[charKey] ?? String(charKey).toUpperCase();

    const rollContext = buildRollContext({
      actor: attackerActor,
      targetActor: defenderActor,
      testType: "characteristic",
      characteristicKey: charKey
    });

    const data = {
      attacker: {
        actorUuid: attackerActor.uuid,
        tokenName: attackerToken?.name ?? attackerActor.name,
        name: attackerActor.name,
        charKey,
        charLabel,
        declared: null,
        tn: null,
        result: null,
        committedAt: null
      },
      defender: {
        actorUuid: defenderActor.uuid,
        tokenName: defenderToken?.name ?? defenderActor.name,
        name: defenderActor.name,
        charKey,
        charLabel,
        declared: null,
        tn: null,
        result: null,
        committedAt: null
      },
      context: {
        label: label || `Opposed ${charLabel} Test`,
        charKey,
        ssModifier: Number(ssModifier) || 0,
        createdAt: Date.now(),
        createdBy: game.user.id,
        rollContext,
        rollOptions: Array.isArray(rollContext?.rollOptions) ? rollContext.rollOptions.slice() : []
      },
      outcome: null,
      status: null
    };

    const msgData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      content: _renderCard(data, "pending"),
      flags: {
        [FLAG_NS]: {
          [FLAG_KEY]: { version: CARD_VERSION, state: data }
        }
      }
    };

    const msg = await ChatMessage.create(msgData);
    if (msg) {
      // Re-render with real message ID
      const freshData = _getMessageState(msg);
      if (freshData) {
        await _updateCard(msg, freshData);
      }
    }
    return msg;
  },

  /**
   * Handle a button action from the chat card.
   * @param {ChatMessage} message
   * @param {string} action - "attacker-roll" | "defender-roll" | "begin-banked-roll"
   */
  async handleAction(message, action) {
    const data = _getMessageState(message);
    if (!data) return;

    const mutable = foundry.utils.deepClone(data);

    if (action === "attacker-roll" || action === "attacker-roll-committed") {
      await this._handleAttackerRoll(message, mutable, { fromCommit: action === "attacker-roll-committed" });
    } else if (action === "defender-roll" || action === "defender-roll-committed") {
      await this._handleDefenderRoll(message, mutable, { fromCommit: action === "defender-roll-committed" });
    } else if (action === "begin-banked-roll") {
      await this._autoRollBanked(message.id, { trigger: "button" });
    }
  },

  async _handleAttackerRoll(message, data, { fromCommit = false } = {}) {
    const attacker = _resolveActor(data.attacker?.actorUuid);
    if (!attacker) return;

    // If not from an auto-committed flow, prompt for choices
    if (!fromCommit && !data.attacker.committedAt) {
      if (!_canControlActor(attacker)) {
        ui.notifications.warn("You do not control the initiator actor.");
        return;
      }

      const choices = await _charTestDialog({
        title: `${attacker.name} — ${data.context?.label ?? "Characteristic Test"}`,
        defaultCharKey: data.attacker.charKey ?? data.context?.charKey ?? "wp",
        defaultManualMod: 0,
        showCharSelect: true
      });
      if (!choices) return;

      data.attacker.charKey = choices.charKey;
      data.attacker.charLabel = CHARACTERISTICS[choices.charKey] ?? choices.charKey.toUpperCase();
      data.attacker.declared = { manualMod: choices.manualMod };

      const tn = computeCharacteristicTN(attacker, choices.charKey, choices.manualMod, 0);
      applyRuntimePreRollToTN({
        actor: attacker,
        targetActor: _resolveActor(data?.defender?.actorUuid),
        targetToken: _resolveToken(data?.defender?.tokenUuid),
        rollContext: data?.context?.rollContext,
        workflow: "characteristic",
        side: "attacker",
        characteristicKey: choices.charKey,
        tn
      });
      data.attacker.tn = tn;
      data.attacker.committedAt = Date.now();
      data.attacker.committedBy = game.user.id;

      await _updateCard(message, data);
      return;
    }

    // If committed, perform the roll
    if (data.attacker.committedAt && !data.attacker.result) {
      const target = Number(data.attacker.tn?.finalTN ?? 0);
      const result = await doTestRoll(attacker, { rollFormula: "1d100", target, allowLucky: true, allowUnlucky: true });
      await applyRuntimePostRollToResult({
        actor: attacker,
        targetActor: _resolveActor(data?.defender?.actorUuid),
        targetToken: _resolveToken(data?.defender?.tokenUuid),
        rollContext: data?.context?.rollContext,
        workflow: "characteristic",
        side: "attacker",
        characteristicKey: data?.attacker?.charKey ?? data?.context?.charKey ?? "",
        result,
        allowPrompt: true
      });

      data.attacker.result = {
        rollTotal: result.rollTotal,
        target: result.target,
        isSuccess: result.isSuccess,
        degree: result.degree,
        textual: result.textual,
        isCriticalSuccess: result.isCriticalSuccess,
        isCriticalFailure: result.isCriticalFailure
      };
      data.attacker.rolledAt = Date.now();

      // Try to resolve if both sides have results
      if (data.defender?.result) {
        data.outcome = _resolveOutcome(data);
        data.status = "resolved";

        await _maybeResolveBothCritSuccessRollOff({
          message, data, attacker, defender: _resolveActor(data.defender.actorUuid)
        });
      }

      await _updateCard(message, data);
    }
  },

  async _handleDefenderRoll(message, data, { fromCommit = false } = {}) {
    const defender = _resolveActor(data.defender?.actorUuid);
    if (!defender) return;

    if (!fromCommit && !data.defender.committedAt) {
      if (!_canControlActor(defender) && !game.user.isGM) {
        ui.notifications.warn("You do not control the target actor.");
        return;
      }

      const ssModifier = Number(data.context?.ssModifier ?? 0);
      const choices = await _charTestDialog({
        title: `${defender.name} — ${data.context?.label ?? "Characteristic Test"} (Defender)`,
        defaultCharKey: data.defender.charKey ?? data.context?.charKey ?? "wp",
        defaultManualMod: 0,
        showCharSelect: true
      });
      if (!choices) return;

      data.defender.charKey = choices.charKey;
      data.defender.charLabel = CHARACTERISTICS[choices.charKey] ?? choices.charKey.toUpperCase();
      data.defender.declared = { manualMod: choices.manualMod };

      const tn = computeCharacteristicTN(defender, choices.charKey, choices.manualMod, ssModifier);
      applyRuntimePreRollToTN({
        actor: defender,
        targetActor: _resolveActor(data?.attacker?.actorUuid),
        targetToken: _resolveToken(data?.attacker?.tokenUuid),
        rollContext: data?.context?.rollContext,
        workflow: "characteristic",
        side: "defender",
        characteristicKey: choices.charKey,
        tn
      });
      data.defender.tn = tn;
      data.defender.committedAt = Date.now();
      data.defender.committedBy = game.user.id;

      await _updateCard(message, data);
      return;
    }

    if (data.defender.committedAt && !data.defender.result) {
      const target = Number(data.defender.tn?.finalTN ?? 0);
      const result = await doTestRoll(defender, { rollFormula: "1d100", target, allowLucky: true, allowUnlucky: true });
      await applyRuntimePostRollToResult({
        actor: defender,
        targetActor: _resolveActor(data?.attacker?.actorUuid),
        targetToken: _resolveToken(data?.attacker?.tokenUuid),
        rollContext: data?.context?.rollContext,
        workflow: "characteristic",
        side: "defender",
        characteristicKey: data?.defender?.charKey ?? data?.context?.charKey ?? "",
        result,
        allowPrompt: true
      });

      data.defender.result = {
        rollTotal: result.rollTotal,
        target: result.target,
        isSuccess: result.isSuccess,
        degree: result.degree,
        textual: result.textual,
        isCriticalSuccess: result.isCriticalSuccess,
        isCriticalFailure: result.isCriticalFailure
      };
      data.defender.rolledAt = Date.now();

      if (data.attacker?.result) {
        data.outcome = _resolveOutcome(data);
        data.status = "resolved";

        await _maybeResolveBothCritSuccessRollOff({
          message, data, attacker: _resolveActor(data.attacker.actorUuid), defender
        });
      }

      await _updateCard(message, data);
    }
  },

  /**
   * Banked-choice auto roll hook helper (GM-present).
   */
  async maybeAutoRollBanked(message) {
    try {
      const activeGM = game.users.activeGM ?? null;
      if (!activeGM) return;
      if (game.user.id !== activeGM.id) return;

      const data = _getMessageState(message);
      if (!data) return;

      // Guard: another runner already claimed this auto-roll.
      if (data.context?.autoRollStarted) return;

      if (!_bothSidesCommitted(data)) return;
      if (data.attacker?.result || data.defender?.result || data.outcome || data.status === "resolved") return;

      await this._autoRollBanked(message.id, { trigger: "hook" });
    } catch (err) {
      console.error("UESRPG | Char opposed banked GM auto-roll hook failed", err);
    }
  },

  /**
   * Banked-choice auto roll hook helper (no active GM).
   */
  async maybeAutoRollBankedNoGM(message) {
    try {
      const activeGM = game.users.activeGM ?? null;
      if (activeGM) return;

      if (!message.isAuthor) return;

      const data = _getMessageState(message);
      if (!data) return;

      // Guard: another runner already claimed this auto-roll.
      if (data.context?.autoRollStarted) return;

      if (!_bothSidesCommitted(data)) return;
      if (data.attacker?.result || data.defender?.result || data.outcome || data.status === "resolved") return;

      await this._autoRollBanked(message.id, { trigger: "hook-no-gm" });
    } catch (err) {
      console.error("UESRPG | Char opposed banked no-GM auto-roll hook failed", err);
    }
  },

  /**
   * Auto-roll both sides once both have committed.
   */
  async _autoRollBanked(parentMessageId, { trigger = "unknown" } = {}) {
    if (!parentMessageId) return;
    if (bankedAutoRollLocalLocks.has(parentMessageId)) return;
    bankedAutoRollLocalLocks.add(parentMessageId);

    try {
      const message = game.messages.get(parentMessageId) ?? null;
      if (!message) return;

      let data = foundry.utils.deepClone(_getMessageState(message));
      if (!data) return;
      if (!_bothSidesCommitted(data)) return;
      if (data.outcome || data.status === "resolved" || (data.attacker?.result && data.defender?.result)) return;

      // ── Claim-ID protocol ──────────────────────────────────────────────
      data.context = data.context ?? {};
      if (data.context.autoRollStarted) return;

      const claimId = foundry.utils.randomID();
      data.context.autoRollStarted = true;
      data.context.autoRollClaimId = claimId;
      data.context.autoRollStartedAt = Date.now();
      data.context.autoRollStartedBy = game.user.id;
      data.context.autoRollStartedTrigger = String(trigger ?? "unknown");

      await _updateCard(message, data);

      // Verify we still own the claim after the persisted update.
      const freshAfterClaim = foundry.utils.deepClone(_getMessageState(message));
      if (freshAfterClaim?.context?.autoRollClaimId && freshAfterClaim.context.autoRollClaimId !== claimId) return;

      // Roll attacker first if needed.
      if (!freshAfterClaim?.attacker?.result) {
        await this.handleAction(message, "attacker-roll-committed");
      }

      // Refresh after attacker roll for fresh state.
      const fresh = game.messages.get(parentMessageId) ?? null;
      if (!fresh) return;
      const freshData = foundry.utils.deepClone(_getMessageState(fresh));
      if (!freshData) return;

      // Roll defender if needed.
      if (!freshData.defender?.result) {
        await this.handleAction(fresh, "defender-roll-committed");
      }
    } finally {
      bankedAutoRollLocalLocks.delete(parentMessageId);
    }
  },

  /**
   * Apply an externally-created roll message into the parent opposed card.
   * This supports the external roll banking pattern for cross-user workflows.
   *
   * @param {ChatMessage} rollMessage
   */
  async applyExternalRollMessage(rollMessage) {
    const meta = rollMessage?.flags?.[FLAG_NS]?.charOpposedMeta ?? null;
    const parentId = meta?.parentMessageId ?? null;
    const stage = meta?.stage ?? null;

    const rollId = rollMessage?.id ?? rollMessage?._id ?? null;
    if (!parentId || !stage) return;

    const parent = game.messages.get(parentId) ?? null;
    if (!parent) return;

    const raw = parent?.flags?.[FLAG_NS]?.[FLAG_KEY];
    const normalized = _normalizeCardFlag(raw);
    const current = normalized.state;
    if (!current || typeof current !== "object") return;

    const expectedSide = (stage === "attacker-roll")
      ? current.attacker
      : (stage === "defender-roll" ? current.defender : null);
    if (!expectedSide?.actorUuid) return;

    const expectedActor = _resolveActor(expectedSide.actorUuid);
    if (!expectedActor) return;

    const speakerActorId = rollMessage?.speaker?.actor ?? null;
    if (speakerActorId && speakerActorId !== expectedActor.id) return;

    const authorId =
      rollMessage?.author?.id ??
      rollMessage?.user?.id ??
      (typeof rollMessage?.user === "string" ? rollMessage.user : null) ??
      null;
    const authorUser = authorId ? (game.users.get(authorId) ?? null) : null;
    if (!authorUser) return;
    if (!authorUser.isGM && !_userHasActorOwnership(authorUser, expectedActor)) return;

    const data = foundry.utils.deepClone(current);
    let dirty = false;

    const applyResult = async (side, { sideRole = "" } = {}) => {
      if (!side?.actorUuid) return null;
      const actor = _resolveActor(side.actorUuid);
      if (!actor) return null;

      const roll = rollMessage?.rolls?.[0] ?? null;
      const rollTotal = Number(roll?.total ?? NaN);
      if (!Number.isFinite(rollTotal)) return null;

      const target = Number(side?.tn?.finalTN ?? 0);
      const res = computeResultFromRollTotal(actor, { rollTotal, target, allowLucky: true, allowUnlucky: true });

      const targetActor = (sideRole === "attacker")
        ? _resolveActor(data?.defender?.actorUuid)
        : (sideRole === "defender" ? _resolveActor(data?.attacker?.actorUuid) : null);
      const targetToken = (sideRole === "attacker")
        ? _resolveToken(data?.defender?.tokenUuid)
        : (sideRole === "defender" ? _resolveToken(data?.attacker?.tokenUuid) : null);

      await applyRuntimePostRollToResult({
        actor,
        targetActor,
        targetToken,
        rollContext: data?.context?.rollContext,
        workflow: "characteristic",
        side: sideRole,
        characteristicKey: side?.charKey ?? data?.context?.charKey ?? "",
        result: res,
        allowPrompt: true
      });

      return {
        rollTotal: res.rollTotal,
        target: res.target,
        isSuccess: res.isSuccess,
        degree: res.degree,
        textual: res.textual,
        isCriticalSuccess: res.isCriticalSuccess,
        isCriticalFailure: res.isCriticalFailure
      };
    };

    // Apply commit payload for defender
    if (stage === "defender-roll") {
      const c = meta?.commit?.defender ?? null;
      if (c && typeof c === "object") {
        data.defender = data.defender ?? {};
        if (c.charKey != null) data.defender.charKey = String(c.charKey);
        if (c.charLabel != null) data.defender.charLabel = String(c.charLabel);
        if (c.declared && typeof c.declared === "object") data.defender.declared = foundry.utils.deepClone(c.declared);
        if (c.tn && typeof c.tn === "object") data.defender.tn = foundry.utils.deepClone(c.tn);
      }
    }

    if (stage === "attacker-roll") {
      if (data.attacker?.result) return;
      const r = await applyResult(data.attacker, { sideRole: "attacker" });
      if (!r) return;
      data.attacker.result = r;
      if (rollId) {
        data.attacker.rollMessageId = rollId;
        data.attacker.rolledAt = Date.now();
      }
      dirty = true;
    } else if (stage === "defender-roll") {
      if (data.defender?.result) return;
      const r = await applyResult(data.defender, { sideRole: "defender" });
      if (!r) return;
      data.defender.result = r;
      if (rollId) {
        data.defender.rollMessageId = rollId;
        data.defender.rolledAt = Date.now();
      }
      dirty = true;
    }

    if (!dirty) return;

    // Resolve outcome if both sides now have results
    if (data.attacker?.result && data.defender?.result && !data.outcome) {
      data.outcome = _resolveOutcome(data);
      data.status = "resolved";

      await _maybeResolveBothCritSuccessRollOff({
        message: parent, data,
        attacker: _resolveActor(data.attacker.actorUuid),
        defender: _resolveActor(data.defender.actorUuid)
      });
    }

    await _updateCard(parent, data);
  }
};
