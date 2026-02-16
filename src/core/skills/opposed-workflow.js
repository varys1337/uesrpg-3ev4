/**
 * src/core/skills/opposed-workflow.js
 *
 * Skill opposed workflow façade (refactored to delegate to internal modules).
 *
 * Requirements:
 *  - If a target is selected: create a pending opposed skill card.
 *  - Attacker rolls from card with: difficulty dropdown, manual modifier, specialization toggle.
 *  - Defender rolls from card with: choose same/different skill, difficulty dropdown, manual modifier, specialization toggle.
 *  - Uses DoS/DoF results for both targeted and untargeted skill rolls.
 */

import { doTestRoll, resolveOpposed, formatDegree, computeResultFromRollTotal } from "../../utils/degree-roll-helper.js";
import { safeUpdateChatMessage } from "../../utils/chat-message-socket.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "./skill-tn.js";
import { requireUserCanRollActor } from "../../utils/permissions.js";
import { buildSkillRollRequest, normalizeSkillRollOptions, skillRollDebug, validateSkillRollRequest } from "./roll-request.js";
import { buildResistanceBonusSection, readResistanceBonusSelections, buildResistanceBonusMods } from "../traits/trait-resistance-ui.js";
import { consumePhysicalExertionForSkill } from "../stamina/stamina-integration-hooks.js";
import { applyKeenIntuitionToResult, applyHyperAwarenessToResult } from "../traits/awareness-talents.js";
import { applyIntellectualTalentDoSOverrides } from "../traits/intellectual-talents.js";
import { hasCondition } from "../conditions/condition-engine.js";

// Internal modules
import { FLAG_NS, FLAG_KEY, CARD_VERSION, DEFAULT_COMBAT_STYLE_DEFENSE_TYPE, bankedAutoRollLocalLocks } from "./opposed/constants.js";
import { _bothSidesCommitted, _getMessageState, _skillOpposedMetaFlag, _normalizeCardFlag } from "./opposed/schema.js";
import { _getLastSkillRollOptions, _setLastSkillRollOptions, _mergeLastSkillRollOptions } from "./opposed/settings.js";
import { _resolveDoc, _resolveActor, _resolveToken } from "./opposed/docs.js";
import { _userHasActorOwnership, _esc, _fmtDegree } from "./opposed/util.js";
import { _renderCard, _btn, _renderBreakdown } from "./opposed/render.js";
import { _updateCard } from "./opposed/card-updater.js";
import { _hasSpecializations, _listSkills, _findSkillByUuid, _resolveCombatStyleOrSkill, _listProfessions } from "./opposed/skills.js";
import { _skillRollDialog } from "./opposed/dialogs.js";
import { _buildSensorySituationalMods, _maybeAddInvisibleTrackingPenalty, _resolveOutcome, _executeSpecialActionIfWinner } from "./opposed/helpers.js";
import { buildRollContext } from "../rules/roll-context.js";
import { computeTN } from "../combat/tn.js";
import { buildSpecialActionTestChoicesForActor } from "../combat/combat-style-utils.js";
import { applyRuntimePreRollToTN, applyRuntimePostRollToResult } from "../traits/features/rule-element-runtime.js";

function _defaultSelectedCharacteristicForSkill(skills, skillUuid) {
  const selected = Array.isArray(skills) ? skills.find(s => String(s?.uuid ?? "") === String(skillUuid ?? "")) : null;
  const opts = Array.isArray(selected?.governingChaOptions) ? selected.governingChaOptions : [];
  const selectedCha = String(selected?.selectedCha ?? "").trim().toLowerCase();
  return selectedCha || (opts[0]?.key ? String(opts[0].key).toLowerCase() : "");
}

function _getSpecialActionContext(data) {
  const ctx = data?.specialActionContext;
  if (ctx && typeof ctx === "object" && String(ctx.id ?? "").trim()) {
    return {
      id: String(ctx.id).trim(),
      source: String(ctx.source ?? "unknown"),
      attackerStyleUuid: String(ctx.attackerStyleUuid ?? "").trim() || null,
      defenderStyleUuid: String(ctx.defenderStyleUuid ?? "").trim() || null
    };
  }

  const legacyId = String(data?.specialActionId ?? "").trim();
  if (!legacyId) return null;
  return {
    id: legacyId,
    source: "legacy",
    attackerStyleUuid: null,
    defenderStyleUuid: null
  };
}

function _getSpecialActionLegalityForSide(data, actor, side) {
  const context = _getSpecialActionContext(data);
  if (!context || !actor) return null;

  const lane = String(side ?? "").toLowerCase() === "defender" ? "defender" : "attacker";
  const preferredStyleUuid = lane === "attacker" ? context.attackerStyleUuid : context.defenderStyleUuid;
  const choices = buildSpecialActionTestChoicesForActor(actor, {
    specialActionId: context.id,
    side: lane,
    preferredStyleUuid
  });

  const allowedSet = new Set(
    choices
      .map(c => String(c?.skillUuid ?? "").trim())
      .filter(Boolean)
  );

  return { context, choices, allowedSet };
}

function _filterSkillsForSpecialAction(skills, legality) {
  if (!legality) return Array.isArray(skills) ? skills : [];
  const allowed = legality.allowedSet;
  if (!(allowed instanceof Set) || allowed.size === 0) return [];
  return (Array.isArray(skills) ? skills : []).filter(s => allowed.has(String(s?.uuid ?? "").trim()));
}

function _isSpecialActionSelectionLegal(decl, legality) {
  if (!legality) return true;
  const selectedUuid = String(decl?.skillUuid ?? "").trim();
  return Boolean(selectedUuid && legality.allowedSet.has(selectedUuid));
}

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

  // Roll-off per Chapter 1: reroll to break the tie.
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
      attacker: { rollTotal: a.rollTotal, target: a.target, textual: a.textual, isCriticalSuccess: a.isCriticalSuccess, isCriticalFailure: a.isCriticalFailure },
      defender: { rollTotal: d.rollTotal, target: d.target, textual: d.textual, isCriticalSuccess: d.isCriticalSuccess, isCriticalFailure: d.isCriticalFailure },
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

// External roll application hook (hydrates roll result from separate roll message)
export const SkillOpposedWorkflow = {
  /**
   * Banked-choice auto roll hook helper (GM-present).
   * Called from the global updateChatMessage hook when the parent card updates.
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

      // Only proceed once both sides have committed and no roll results exist yet.
      if (!_bothSidesCommitted(data)) return;
      if (data.attacker?.result || data.defender?.result || data.outcome || data.status === "resolved") return;

      await this._autoRollBanked(message.id, { trigger: "hook" });
    } catch (err) {
      console.error("UESRPG | Skill opposed banked GM auto-roll hook failed", err);
    }
  },

  /**
   * Banked-choice auto roll hook helper (no active GM).
   * Uses the parent message author as the authority runner.
   */
  async maybeAutoRollBankedNoGM(message) {
    try {
      const activeGM = game.users.activeGM ?? null;
      if (activeGM) return;

      // Only the message author should attempt auto-roll to avoid concurrent updates.
      if (!message.isAuthor) return;

      const data = _getMessageState(message);
      if (!data) return;

      // Guard: another runner already claimed this auto-roll.
      if (data.context?.autoRollStarted) return;

      if (!_bothSidesCommitted(data)) return;
      if (data.attacker?.result || data.defender?.result || data.outcome || data.status === "resolved") return;

      await this._autoRollBanked(message.id, { trigger: "hook-no-gm" });
    } catch (err) {
      console.error("UESRPG | Skill opposed banked no-GM auto-roll hook failed", err);
    }
  },

  /**
   * Begin rolling a banked-choice opposed skill test once both sides have committed.
   * Rolls any unresolved lanes without prompting for additional choices.
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

      // If already resolved, do nothing.
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

      // Roll attacker lane first if needed.
      if (!freshAfterClaim?.attacker?.result) {
        await this.handleAction(message, "attacker-roll-committed");
      }

      // Refresh after attacker roll for fresh state.
      const fresh = game.messages.get(parentMessageId) ?? null;
      if (!fresh) return;
      const freshData = foundry.utils.deepClone(_getMessageState(fresh));
      if (!freshData) return;

      // Roll defender lane if needed.
      if (!freshData.defender?.result) {
        await this.handleAction(fresh, "defender-roll-committed");
      }
    } finally {
      bankedAutoRollLocalLocks.delete(parentMessageId);
    }
  },
  /**
   * Bank an externally-created roll message (attacker-roll / defender-roll) into
   * the parent opposed skill card.
   *
   * This is intended to be executed by the active GM (when present) or by the
   * parent message author (when no GM is active) from a createChatMessage hook.
   *
   * @param {ChatMessage} rollMessage
   */
  async applyExternalRollMessage(rollMessage) {
    const meta = rollMessage?.flags?.["uesrpg-3ev4"]?.skillOpposedMeta ?? null;
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



    // Anti-spoof + consistency checks: only bank roll messages that match the expected side.
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
  rollMessage?._source?.user ??
  rollMessage?.data?.user ??
  null;
const authorUser = authorId ? (game.users.get(authorId) ?? null) : null;
if (!authorUser) return;

    if (!authorUser.isGM && !_userHasActorOwnership(authorUser, expectedActor)) return;

    const data = foundry.utils.deepClone(current);

	    let dirty = false;

	    const rerollMeta = rollMessage?.flags?.uesrpg?.reroll ?? null;
	    const isTalentReroll = Boolean(rerollMeta?.isReroll === true);
	    const rerollParentMessageId = String(rerollMeta?.parentMessageId ?? "").trim();

	    const applyResult = async (side, { talentChoices = null, sideRole = "" } = {}) => {
	      if (!side?.actorUuid) return null;

      let actor = null;
      try {
        const doc = fromUuidSync(side.actorUuid);
        actor = (doc?.documentName === "Actor") ? doc : (doc?.actor ?? null);
      } catch (_e) {
        actor = null;
      }
      if (!actor) return null;

      const roll = rollMessage?.rolls?.[0] ?? null;
      const rollTotal = Number(roll?.total ?? NaN);
      if (!Number.isFinite(rollTotal)) return null;

      const target = Number(side?.tn?.finalTN ?? 0);
      const res = computeResultFromRollTotal(actor, {
        rollTotal,
        target,
        allowLucky: true,
        allowUnlucky: true
      });

      if (talentChoices && typeof talentChoices === "object") {
        if (talentChoices.keenIntuitionChoice) res.keenIntuitionChoice = talentChoices.keenIntuitionChoice;
        if (talentChoices.hyperAwarenessChoice) res.hyperAwarenessChoice = talentChoices.hyperAwarenessChoice;
      }

      // Awareness talent automation: Keen Intuition (Observe) / Hyper Awareness (Evade).
      // Do not prompt in banked/external rolls; use stored choices when available.
	      await applyKeenIntuitionToResult(actor, side?.skillLabel ?? "", res, { allowPrompt: false });
	      await applyHyperAwarenessToResult(actor, side?.skillLabel ?? "", res, { allowPrompt: false });

	      // Intellectual talent DoS overrides: apply a stored override from the roll message (no prompt).
	      try {
	        const storedOverride =
	          rollMessage?.flags?.uesrpg?.dosOverride ??
	          rollMessage?.flags?.["uesrpg-3ev4"]?.dosOverride ??
	          null;
	        const st =
	          rollMessage?.flags?.uesrpg?.skillTest ??
	          rollMessage?.flags?.["uesrpg-3ev4"]?.skillTest ??
	          null;
	        const isInterrogationTest = Boolean(st?.isInterrogationTest ?? side?.declared?.isInterrogationTest ?? false);

	        await applyIntellectualTalentDoSOverrides({
	          actor,
	          skillName: side?.skillLabel ?? "",
	          result: res,
	          isInterrogationTest,
	          storedOverride,
	          allowPrompt: false
	        });
	      } catch (_e) {
	        // ignore
	      }

      let targetActor = null;
      let targetToken = null;
      if (sideRole === "attacker") {
        targetActor = _resolveActor(data?.defender?.actorUuid);
        targetToken = _resolveToken(data?.defender?.tokenUuid);
      } else if (sideRole === "defender") {
        targetActor = _resolveActor(data?.attacker?.actorUuid);
        targetToken = _resolveToken(data?.attacker?.tokenUuid);
      }

      let skillItem = null;
      const skillUuid = String(side?.skillUuid ?? "").trim();
      if (skillUuid) {
        try {
          const doc = fromUuidSync(skillUuid);
          if (doc?.documentName === "Item") skillItem = doc;
        } catch (_e) {
          skillItem = null;
        }
      }

      await applyRuntimePostRollToResult({
        actor,
        targetActor,
        targetToken,
        item: skillItem,
        rollContext: data?.context?.rollContext,
        workflow: "skill",
        side: sideRole,
        skillName: side?.skillLabel ?? "",
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

    // Apply commit payload (TN, labels, etc.) before evaluating DoS/DoF.
    // This is required when the roller cannot update the parent card directly.
    if (stage === "defender-roll") {
      const c = meta?.commit?.defender ?? null;
      if (c && typeof c === "object") {
        data.defender = data.defender ?? {};
        if (c.skillUuid != null) data.defender.skillUuid = String(c.skillUuid);
        if (c.skillLabel != null) data.defender.skillLabel = String(c.skillLabel);
        if (c.declared && typeof c.declared === "object") data.defender.declared = foundry.utils.deepClone(c.declared);
        if (c.tn && typeof c.tn === "object") data.defender.tn = foundry.utils.deepClone(c.tn);
      }
    }

	    if (stage === "attacker-roll") {
	      if (data.attacker?.result) {
	        const currentRollMessageId = String(data.attacker.rollMessageId ?? "").trim();
	        const allowReplace = Boolean(isTalentReroll && rerollParentMessageId && currentRollMessageId && rerollParentMessageId === currentRollMessageId);
	        if (allowReplace) {
	          const prevId = data.attacker.rollMessageId ?? null;
	          const r = await applyResult(data.attacker, {
            talentChoices: meta?.commit?.attacker?.talentChoices ?? null,
            sideRole: "attacker"
          });
	          if (!r) return;
	          data.attacker.result = r;
	          if (rollId) {
	            data.attacker.rollMessageId = rollId;
	            data.attacker.rolledAt = Date.now();
	            data.attacker.reroll = {
	              kind: "talent",
	              source: String(rerollMeta?.source ?? "talent"),
	              parentRollMessageId: prevId,
	              rollMessageId: rollId,
	              at: Date.now()
	            };
	          }
	          // Force outcome recompute if already resolved.
	          data.outcome = null;
	          if (data.context?.rollOff) delete data.context.rollOff;
	          if (data.context?.resolvedAt) delete data.context.resolvedAt;
	          if (data.context?.phase === "resolved") data.context.phase = "resolving";
	          data.status = "pending";
	          dirty = true;
	        } else if (!data.attacker.rollMessageId && rollId) {
	          data.attacker.rollMessageId = rollId;
	          data.attacker.rolledAt = Date.now();
	          dirty = true;
	        } else {
	          return;
	        }
	      } else {
	        const r = await applyResult(data.attacker, {
	          talentChoices: meta?.commit?.attacker?.talentChoices ?? null,
            sideRole: "attacker"
	        });
        if (!r) return;
        data.attacker.result = r;
        if (rollId) {
          data.attacker.rollMessageId = rollId;
          data.attacker.rolledAt = Date.now();
        }
        dirty = true;
      }
	    } else if (stage === "defender-roll") {
	      if (data.defender?.result) {
	        const currentRollMessageId = String(data.defender.rollMessageId ?? "").trim();
	        const allowReplace = Boolean(isTalentReroll && rerollParentMessageId && currentRollMessageId && rerollParentMessageId === currentRollMessageId);
	        if (allowReplace) {
	          const prevId = data.defender.rollMessageId ?? null;
	          const r = await applyResult(data.defender, {
            talentChoices: meta?.commit?.defender?.talentChoices ?? null,
            sideRole: "defender"
          });
	          if (!r) return;
	          data.defender.result = r;
	          if (rollId) {
	            data.defender.rollMessageId = rollId;
	            data.defender.rolledAt = Date.now();
	            data.defender.reroll = {
	              kind: "talent",
	              source: String(rerollMeta?.source ?? "talent"),
	              parentRollMessageId: prevId,
	              rollMessageId: rollId,
	              at: Date.now()
	            };
	          }
	          data.outcome = null;
	          if (data.context?.rollOff) delete data.context.rollOff;
	          if (data.context?.resolvedAt) delete data.context.resolvedAt;
	          if (data.context?.phase === "resolved") data.context.phase = "resolving";
	          data.status = "pending";
	          dirty = true;
	        } else if (!data.defender.rollMessageId && rollId) {
	          data.defender.rollMessageId = rollId;
	          data.defender.rolledAt = Date.now();
	          dirty = true;
	        } else {
	          return;
	        }
	      } else {
	        const r = await applyResult(data.defender, {
	          talentChoices: meta?.commit?.defender?.talentChoices ?? null,
            sideRole: "defender"
	        });
        if (!r) return;
        data.defender.result = r;
        if (rollId) {
          data.defender.rollMessageId = rollId;
          data.defender.rolledAt = Date.now();
        }
        dirty = true;
      }
    } else {
      return;
    }

    // Phase tracking (non-breaking; used for diagnostics).
    data.context = data.context ?? {};
    if (stage === "attacker-roll") {
      data.context.phase = "waitingDefender";
      if (!data.context.waitingSince) data.context.waitingSince = Date.now();
    }
    if (stage === "defender-roll") {
      if (!data.context.phase || data.context.phase === "pending") data.context.phase = "resolving";
    }

    if (data.attacker?.result && data.defender?.result && !data.outcome) {
      data.outcome = _resolveOutcome(data);
      await _maybeResolveBothCritSuccessRollOff({
        message: parent,
        data,
        attacker: _resolveActor(data.attacker.actorUuid),
        defender: _resolveActor(data.defender.actorUuid)
      });
      data.status = "resolved";
      data.context = data.context ?? {};
      data.context.phase = "resolved";
      if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
    }

    await _updateCard(parent, data);
  },

  async createPending(cfg = {}) {
    const aDoc = _resolveDoc(cfg.attackerTokenUuid) ?? _resolveDoc(cfg.attackerActorUuid) ?? _resolveDoc(cfg.attackerUuid);
    const dDoc = _resolveDoc(cfg.defenderTokenUuid) ?? _resolveDoc(cfg.defenderActorUuid) ?? _resolveDoc(cfg.defenderUuid);

    const aToken = _resolveToken(aDoc);
    const dToken = _resolveToken(dDoc);
    const attacker = _resolveActor(aDoc);
    const defender = _resolveActor(dDoc);

    if (!attacker || !defender) {
      ui.notifications.warn("Opposed skill test requires both an actor and a target (token or actor).");
      return null;
    }

    const rollContext = buildRollContext({
      actor: attacker,
      targetActor: defender,
      testType: "skill",
      skillItem: cfg?.attackerSkillUuid ? _findSkillByUuid(attacker, cfg.attackerSkillUuid) : null
    });

    const data = {
      context: {
        schemaVersion: 1,
        createdAt: Date.now(),
        createdBy: game.user.id,
        updatedAt: Date.now(),
        updatedBy: game.user.id,
        phase: "pending",
        waitingSince: null,
        rollContext,
        rollOptions: Array.isArray(rollContext?.rollOptions) ? rollContext.rollOptions.slice() : []
      },
      status: "pending",
      mode: "skill",
      attacker: {
        actorUuid: attacker.uuid,
        tokenUuid: aToken?.document?.uuid ?? null,
        tokenName: aToken?.name ?? null,
        name: attacker.name,
        skillUuid: cfg.attackerSkillUuid ?? null,
        skillLabel: cfg.attackerSkillLabel ?? "Skill",
        result: null,
        tn: null,
        declared: null
      },
      defender: {
        actorUuid: defender.uuid,
        tokenUuid: dToken?.document?.uuid ?? null,
        tokenName: dToken?.name ?? null,
        name: defender.name,
        skillUuid: null,
        skillLabel: null,
        result: null,
        tn: null,
        declared: null
      },
      specialActionId: cfg.specialActionId ?? null,
      specialActionContext: cfg.specialActionContext ?? null,
      outcome: null
    };

    const message = await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: attacker, token: aToken?.document ?? null }),
      content: _renderCard(data, ""),
      flags: { [FLAG_NS]: { [FLAG_KEY]: { version: CARD_VERSION, state: data } }, uesrpg: { [FLAG_KEY]: { version: CARD_VERSION, state: data } } },
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });

    await safeUpdateChatMessage(message, { content: _renderCard(data, message.id) });
    return message;
  },

  async handleAction(message, action, { event } = {}) {
    const data = _getMessageState(message);
    if (!data) return;

    const attacker = _resolveActor(data.attacker.actorUuid);
    const defender = _resolveActor(data.defender.actorUuid);
    const aToken = _resolveToken(data.attacker.tokenUuid);
    const dToken = _resolveToken(data.defender.tokenUuid);

    // Hard bind the roll to the original token identities (prevents "replacement target" responses).
    if (data.attacker.tokenUuid && !aToken) {
      ui.notifications.warn("Opposed Skill Test: attacker token is no longer present.");
      return;
    }
    if (data.defender.tokenUuid && !dToken) {
      ui.notifications.warn("Opposed Skill Test: target token is no longer present.");
      return;
    }
    if (aToken && attacker.uuid && aToken.actor?.uuid && aToken.actor.uuid !== attacker.uuid) {
      ui.notifications.warn("Opposed Skill Test: attacker token no longer matches the original actor.");
      return;
    }
    if (dToken && defender.uuid && dToken.actor?.uuid && dToken.actor.uuid !== defender.uuid) {
      ui.notifications.warn("Opposed Skill Test: target token no longer matches the original actor.");
      return;
    }

    if (!attacker || !defender) {
      ui.notifications.warn("Opposed Skill Test: could not resolve actors.");
      return;
    }

    // Manual begin: GM-only when a GM is active; otherwise the parent author may begin.
    if (action === "begin-banked-roll") {
      const activeGM = game.users.activeGM ?? null;
      if (activeGM) {
        if (!game.user.isGM) {
          ui.notifications.info("Requested GM to begin the opposed roll.");
          return;
        }
      } else {
        if (!message.isAuthor && !game.user.isGM) {
          ui.notifications.warn("Only the message author may begin the opposed roll (no GM active).");
          return;
        }
      }

      await this._autoRollBanked(message.id, { trigger: "manual" });
      return;
    }

    if (action === "attacker-roll" || action === "attacker-roll-committed") {
      if (data.attacker.result) return;

      const isCommittedRoll = (action === "attacker-roll-committed");

      // Committing choices requires roll permission for this actor.
      if (!requireUserCanRollActor(game.user, attacker)) return;
      
      // Always respect allowCombatStyle from state (default to true for universal access)
      const allowCombatStyle = Boolean(data?.allowCombatStyle ?? true);

      const baseSkills = _listSkills(attacker, { allowCombatStyle });
      const specialLegality = _getSpecialActionLegalityForSide(data, attacker, "attacker");
      const skills = _filterSkillsForSpecialAction(baseSkills, specialLegality);
      if (!skills.length) {
        if (specialLegality) {
          ui.notifications.warn("No legal test options are available for this Special Action.");
          return;
        }
        ui.notifications.warn("Actor has no skills to roll.");
        return;
      }

      const last = _getLastSkillRollOptions();
      const perActorLastSkill = last?.lastSkillUuidByActor?.[attacker.uuid] ?? null;
      const preferredAttackerSkill = String(data.attacker.skillUuid ?? "").trim();
      const preferredLastSkill = String(perActorLastSkill ?? "").trim();
      const selectedSkillUuid = (
        skills.find(s => String(s?.uuid ?? "") === preferredAttackerSkill)?.uuid
        ?? skills.find(s => String(s?.uuid ?? "") === preferredLastSkill)?.uuid
        ?? skills[0].uuid
      );

      const defaultCharacteristic = _defaultSelectedCharacteristicForSkill(skills, selectedSkillUuid);
      const defaults = normalizeSkillRollOptions(last, {
        difficultyKey: "average",
        manualMod: 0,
        useSpec: false,
        selectedCharacteristicKey: defaultCharacteristic
      });

      let decl = null;
      const quick = Boolean(event?.shiftKey) && game.settings.get("uesrpg-3ev4", "skillRollQuickShift");

      if (isCommittedRoll) {
        decl = data.attacker?.declaration ?? null;
        if (!decl) {
          ui.notifications.warn("Attacker has not committed choices yet.");
          return;
        }
      } else {
        if (quick) {
          decl = { skillUuid: selectedSkillUuid,
            applyBlinded: (defaults.applyBlinded ?? true),
            applyDeafened: (defaults.applyDeafened ?? true),
            isInterrogationTest: false,
            ...defaults };
        } else {
          decl = await _skillRollDialog({
            title: "Opposed Skill Test — Attacker",
            actor: attacker,
            showSkillSelect: (!data.attacker.skillUuid || Boolean(specialLegality)),
            skills,
            selectedSkillUuid,
            allowSpecialization: Boolean(skills.find(s => String(s?.uuid ?? "") === String(selectedSkillUuid ?? ""))?.hasSpec),
            defaultUseSpec: defaults.useSpec,
            defaultDifficultyKey: defaults.difficultyKey,
            defaultManualMod: defaults.manualMod,
            defaultApplyBlinded: (defaults.applyBlinded ?? true),
            defaultApplyDeafened: (defaults.applyDeafened ?? true),
            defaultSelectedCharacteristicKey: defaults.selectedCharacteristicKey
          });
        }
        if (!decl) return;

        // Normalize + clamp UI inputs.
        decl = { ...decl, ...normalizeSkillRollOptions(decl, defaults) };
        if (!_isSpecialActionSelectionLegal(decl, specialLegality)) {
          ui.notifications.warn("Selected test is not legal for this Special Action.");
          return;
        }

        // Bank choices into the parent card; do not roll until both sides have committed.
        // Re-read fresh state to prevent stale-snapshot overwrites when both sides commit
        // near-simultaneously from different clients.
        const freshMsgA = game.messages.get(message.id) ?? message;
        const freshDataA = _getMessageState(freshMsgA) ?? data;
        freshDataA.attacker = freshDataA.attacker ?? {};
        freshDataA.attacker.declaration = decl;
        freshDataA.attacker.skillUuid = decl.skillUuid;
        freshDataA.attacker.committedAt = freshDataA.attacker.committedAt ?? Date.now();

        freshDataA.context = freshDataA.context ?? {};
        // Determine phase based on whether the defender has already committed
        if (_bothSidesCommitted(freshDataA)) {
          freshDataA.context.phase = "ready";
        } else if (!freshDataA.context.phase || freshDataA.context.phase === "pending") {
          freshDataA.context.phase = "waitingDefender";
        }
        if (!freshDataA.context.waitingSince) freshDataA.context.waitingSince = Date.now();

        await _updateCard(freshMsgA, freshDataA);
        return;
      }

      // Normalize + clamp UI inputs.
      decl = { ...decl, ...normalizeSkillRollOptions(decl, defaults) };
      if (!_isSpecialActionSelectionLegal(decl, specialLegality)) {
        ui.notifications.warn("Selected test is not legal for this Special Action.");
        return;
      }

      const resMods = buildResistanceBonusMods(decl?.resistanceSelected ?? []);

      // Handle Combat Style or Combat profession separately
      let tn;
      let skillLabel;
      let skillItem = null;
      
      const resolved = _resolveCombatStyleOrSkill(attacker, decl.skillUuid);
      if (!resolved) {
        ui.notifications.warn("Selected actor skill or combat style could not be found.");
        return;
      }
      
      if (resolved.type === "combatStyle") {
        // Combat Style roll
        const situationalMods = _buildSensorySituationalMods(decl, attacker, { skillName: resolved.name });
        if (resMods.length) situationalMods.push(...resMods);
        
        tn = computeTN({
          actor: attacker,
          role: "attacker",
          styleUuid: decl.skillUuid,
          manualMod: decl.manualMod,
          situationalMods
        });
        skillLabel = resolved.name;
        skillItem = null; // Combat Style doesn't use skillItem
      } else if (resolved.type === "profession" && resolved.professionKey === "combat") {
        // NPC Combat profession
        const situationalMods = _buildSensorySituationalMods(decl, attacker, { skillName: resolved.name });
        if (resMods.length) situationalMods.push(...resMods);
        
        tn = computeTN({
          actor: attacker,
          role: "attacker",
          styleUuid: decl.skillUuid,
          manualMod: decl.manualMod,
          situationalMods
        });
        skillLabel = resolved.name;
        skillItem = null; // Combat profession doesn't use skillItem
      } else if (resolved.type === "profession") {
        // Regular NPC profession — route through computeSkillTN for the full modifier
        // pipeline (fatigue, encumbrance, wounds, armor penalties, AE modifiers, item bonuses).
        skillItem = resolved.item;
        const situationalMods = _buildSensorySituationalMods(decl, attacker, { skillName: resolved.name });
        if (resMods.length) situationalMods.push(...resMods);

        tn = computeSkillTN({
          actor: attacker,
          skillItem,
          difficultyKey: decl.difficultyKey,
          manualMod: decl.manualMod,
          selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
          situationalMods
        });
        skillLabel = resolved.name;
      } else if (resolved.type === "characteristic") {
        // Characteristic test — route through computeSkillTN with pseudo-item whose
        // system.value is the characteristic total.
        skillItem = resolved.item;
        const situationalMods = _buildSensorySituationalMods(decl, attacker, { skillName: resolved.name });
        if (resMods.length) situationalMods.push(...resMods);

        tn = computeSkillTN({
          actor: attacker,
          skillItem,
          difficultyKey: decl.difficultyKey,
          manualMod: decl.manualMod,
          selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
          situationalMods
        });
        skillLabel = resolved.name;
      } else {
        // Regular skill roll
        skillItem = resolved.item;
        const allowSpec = _hasSpecializations(skillItem);
        const situationalMods = _buildSensorySituationalMods(decl, attacker, { skillName: skillItem?.name ?? skillLabel });
        if (resMods.length) situationalMods.push(...resMods);
        if (decl?.histskinUnderwater === true) {
          situationalMods.push({ key: "talent:histskin", label: "Histskin (Underwater)", value: +30, source: "talent" });
        }
        _maybeAddInvisibleTrackingPenalty({
          skillLabel: skillItem?.name ?? skillLabel,
          targetActor: defender,
          situationalMods
        });
        tn = computeSkillTN({
          actor: attacker,
          skillItem,
          difficultyKey: decl.difficultyKey,
          manualMod: decl.manualMod,
          selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
          useSpecialization: allowSpec && decl.useSpec,
          situationalMods
        });
        skillLabel = skillItem.name;
      }

      const request = skillItem ? buildSkillRollRequest({
        actor: attacker,
        skillItem,
        targetToken: dToken,
        options: {
          difficultyKey: decl.difficultyKey,
          manualMod: decl.manualMod,
          useSpec: Boolean(decl.useSpec),
          selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
          applyBlinded: Boolean(decl.applyBlinded),
          applyDeafened: Boolean(decl.applyDeafened)
        },
        context: { source: "chat", quick, messageId: message.id, groupId: data.context?.groupId ?? null }
      }) : null;
      
      if (request) {
        const v = validateSkillRollRequest(request);
        if (!v.ok) {
          ui.notifications.warn(v.error || "Invalid skill roll request.");
          return;
        }
        skillRollDebug("opposed attacker request", request);
        data.attacker.request = request;
      }

      data.attacker.skillUuid = decl.skillUuid;
      data.attacker.skillLabel = skillLabel;
      data.attacker.declared = {
        difficultyKey: decl.difficultyKey,
        manualMod: decl.manualMod,
        useSpec: Boolean(decl.useSpec),
        selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
        isInterrogationTest: Boolean(decl?.isInterrogationTest),
        histskinUnderwater: Boolean(decl?.histskinUnderwater)
      };
      
      await _setLastSkillRollOptions(_mergeLastSkillRollOptions({
        difficultyKey: decl.difficultyKey,
        manualMod: decl.manualMod,
        useSpec: Boolean(decl.useSpec),
        selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
        lastSkillUuidByActor: { [attacker.uuid]: decl.skillUuid }
      }));

      data.attacker.tn = tn;
      applyRuntimePreRollToTN({
        actor: attacker,
        targetActor: defender,
        targetToken: dToken ?? null,
        item: skillItem ?? null,
        rollContext: data?.context?.rollContext,
        workflow: "skill",
        side: "attacker",
        skillName: skillLabel,
        tn
      });
      skillRollDebug("opposed attacker TN", { finalTN: tn.finalTN, breakdown: tn.breakdown });

      const rollFormula = "1d100";
      const rollMode = game.settings.get("core", "rollMode");
      const res = await doTestRoll(attacker, { rollFormula, target: tn.finalTN, allowLucky: true, allowUnlucky: true });

      // Awareness talent automation: Keen Intuition (Observe) / Hyper Awareness (Evade).
      await applyKeenIntuitionToResult(attacker, skillLabel, res, { allowPrompt: true });
      await applyHyperAwarenessToResult(attacker, skillLabel, res, { allowPrompt: true });

      // Intellectual talent automation: Businessman / Interrogator DoS substitutions (Commerce / Persuade).
      await applyIntellectualTalentDoSOverrides({
        actor: attacker,
        skillName: skillLabel,
        result: res,
        isInterrogationTest: Boolean(decl?.isInterrogationTest),
        allowPrompt: true
      });

      await applyRuntimePostRollToResult({
        actor: attacker,
        targetActor: defender,
        targetToken: dToken ?? null,
        item: skillItem ?? null,
        rollContext: data?.context?.rollContext,
        workflow: "skill",
        side: "attacker",
        skillName: skillLabel,
        result: res,
        allowPrompt: true
      });

      skillRollDebug("opposed attacker result", { rollTotal: res.rollTotal, target: res.target, isSuccess: res.isSuccess, degree: res.degree, critS: res.isCriticalSuccess, critF: res.isCriticalFailure });

      const dosOverride = res?.uesrpgDosOverride ?? null;
      const skillTest = {
        actorUuid: attacker.uuid,
        skillUuid: decl.skillUuid ?? data.attacker.skillUuid ?? null,
        skillName: skillLabel,
        target: tn.finalTN,
        rollFormula,
        rollMode,
        useSpecialization: Boolean(decl.useSpec),
        isInterrogationTest: Boolean(decl?.isInterrogationTest),
        isSuccess: Boolean(res.isSuccess),
        degree: Number(res.degree ?? 0) || 0,
        textual: String(res.textual ?? "")
      };

      const rollFlags = request ? {
        uesrpg: { rollRequest: request },
        "uesrpg-3ev4": {
          rollRequest: request,
          ..._skillOpposedMetaFlag(message.id, "attacker-roll", {
            commit: {
              attacker: {
                talentChoices: {
                  keenIntuitionChoice: res?.keenIntuitionChoice ?? null,
                  hyperAwarenessChoice: res?.hyperAwarenessChoice ?? null
                }
              }
            }
          })
        }
      } : {
        "uesrpg-3ev4": {
          ..._skillOpposedMetaFlag(message.id, "attacker-roll", {
            commit: {
              attacker: {
                talentChoices: {
                  keenIntuitionChoice: res?.keenIntuitionChoice ?? null,
                  hyperAwarenessChoice: res?.hyperAwarenessChoice ?? null
                }
              }
            }
          })
        }
      };

      rollFlags.uesrpg = {
        ...(rollFlags.uesrpg ?? {}),
        skillTest,
        ...(dosOverride ? { dosOverride } : {}),
        reroll: { used: false, source: null }
      };
      rollFlags["uesrpg-3ev4"] = {
        ...(rollFlags["uesrpg-3ev4"] ?? {}),
        skillTest,
        ...(dosOverride ? { dosOverride } : {})
      };

      // Racial talent (Chapter 4): Histskin underwater roll toggle (+30 Athletics/Stealth).
      if (decl?.histskinUnderwater === true) {
        rollFlags.uesrpg.rollOptions = { ...(rollFlags.uesrpg.rollOptions ?? {}), histskin: true };
        rollFlags["uesrpg-3ev4"].rollOptions = { ...(rollFlags["uesrpg-3ev4"].rollOptions ?? {}), histskin: true };
      }

      await res.roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: attacker, token: aToken?.document ?? null }),
        flavor: `${_esc(data.attacker.skillLabel)} — Opposed Skill (Actor)`,
        flags: rollFlags,
        rollMode
      });
      
      if (skillItem) {
        await consumePhysicalExertionForSkill(attacker, skillItem);
      }

      // Re-read fresh state before committing roll results to avoid overwriting
      // defender-side data that may have been committed in parallel.
      const freshMsgAR = game.messages.get(message.id) ?? message;
      const freshDataAR = _getMessageState(freshMsgAR) ?? data;
      freshDataAR.attacker = freshDataAR.attacker ?? {};
      // Preserve computed fields from the stale `data` that were set during this action.
      freshDataAR.attacker.skillUuid = data.attacker.skillUuid;
      freshDataAR.attacker.skillLabel = data.attacker.skillLabel;
      freshDataAR.attacker.declared = data.attacker.declared;
      freshDataAR.attacker.tn = data.attacker.tn;
      if (data.attacker.request) freshDataAR.attacker.request = data.attacker.request;
      freshDataAR.attacker.result = {
        rollTotal: res.rollTotal,
        target: res.target,
        isSuccess: res.isSuccess,
        degree: res.degree,
        textual: res.textual,
        isCriticalSuccess: res.isCriticalSuccess,
        isCriticalFailure: res.isCriticalFailure
      };

      if (freshDataAR.defender?.result) {
        freshDataAR.outcome = _resolveOutcome(freshDataAR);
        await _maybeResolveBothCritSuccessRollOff({ message: freshMsgAR, data: freshDataAR, attacker, defender });
        await _executeSpecialActionIfWinner(freshDataAR);
      }

      await _updateCard(freshMsgAR, freshDataAR);
      return;
    }

    if (action === "defender-roll" || action === "defender-roll-committed") {
      if (data.defender.result) return;

      const isCommittedRoll = (action === "defender-roll-committed");

      // Committing choices requires roll permission for this actor.
      if (!requireUserCanRollActor(game.user, defender, { message: "You do not have permission to roll for the target actor." })) return;
      
      // Always respect allowCombatStyle from state (default to true for universal access)
      const allowCombatStyle = Boolean(data?.allowCombatStyle ?? true);

      const baseSkills = _listSkills(defender, { allowCombatStyle });
      const specialLegality = _getSpecialActionLegalityForSide(data, defender, "defender");
      const skills = _filterSkillsForSpecialAction(baseSkills, specialLegality);
      if (!skills.length) {
        if (specialLegality) {
          ui.notifications.warn("No legal test options are available for this Special Action.");
          return;
        }
        ui.notifications.warn("Target actor has no skills to roll.");
        return;
      }

      const last = _getLastSkillRollOptions();
      const perActorLastSkill = last?.lastSkillUuidByActor?.[defender.uuid] ?? null;

      // Default selection: use locked-in skill if available, else same-named skill if present, else last-used on this actor, else first.
      const lockedSkillUuid = data.defender.skillUuid;
      const wantedName = String(data.attacker.skillLabel ?? "").trim().toLowerCase();
      const sameName = skills.find(s => String(s.name).trim().toLowerCase() === wantedName) ?? null;
      const preferredLockedSkill = String(lockedSkillUuid ?? "").trim();
      const preferredLastSkill = String(perActorLastSkill ?? "").trim();
      const selectedSkillUuid = (
        skills.find(s => String(s?.uuid ?? "") === preferredLockedSkill)?.uuid
        ?? sameName?.uuid
        ?? skills.find(s => String(s?.uuid ?? "") === preferredLastSkill)?.uuid
        ?? skills[0].uuid
      );

      const defaultCharacteristic = _defaultSelectedCharacteristicForSkill(skills, selectedSkillUuid);
      const defaults = normalizeSkillRollOptions(last, {
        difficultyKey: "average",
        manualMod: 0,
        useSpec: false,
        selectedCharacteristicKey: defaultCharacteristic
      });

      let decl = null;
      const quick = Boolean(event?.shiftKey) && game.settings.get("uesrpg-3ev4", "skillRollQuickShift");

      if (isCommittedRoll) {
        decl = data.defender?.declaration ?? null;
        if (!decl) {
          ui.notifications.warn("Defender has not committed choices yet.");
          return;
        }
      } else {
        if (quick) {
          decl = {
            skillUuid: selectedSkillUuid,
            difficultyKey: defaults.difficultyKey,
            manualMod: defaults.manualMod,
            useSpec: defaults.useSpec,
            selectedCharacteristicKey: defaults.selectedCharacteristicKey ?? defaultCharacteristic,
            applyBlinded: (defaults.applyBlinded ?? true),
            applyDeafened: (defaults.applyDeafened ?? true),
            isInterrogationTest: false
          };
        } else {
          // Always show skill selection dropdown (removed pre-choice dialog dependency)
          decl = await _skillRollDialog({
            title: `Oppose — Choose Skill`,
            actor: defender,
            showSkillSelect: true,
            skills,
            selectedSkillUuid,
            allowSpecialization: true,
            defaultUseSpec: defaults.useSpec,
            defaultDifficultyKey: defaults.difficultyKey,
            defaultManualMod: defaults.manualMod,
            defaultApplyBlinded: (defaults.applyBlinded ?? true),
            defaultApplyDeafened: (defaults.applyDeafened ?? true),
            defaultSelectedCharacteristicKey: defaults.selectedCharacteristicKey
          });
        }
        if (!decl) return;

        // Normalize + clamp UI inputs.
        decl = { ...decl, ...normalizeSkillRollOptions(decl, defaults) };
        if (!_isSpecialActionSelectionLegal(decl, specialLegality)) {
          ui.notifications.warn("Selected test is not legal for this Special Action.");
          return;
        }

        // Bank choices into the parent card; do not roll until both sides have committed.
        // Re-read fresh state to prevent stale-snapshot overwrites when both sides commit
        // near-simultaneously from different clients.
        const freshMsgD = game.messages.get(message.id) ?? message;
        const freshDataD = _getMessageState(freshMsgD) ?? data;
        freshDataD.defender = freshDataD.defender ?? {};
        freshDataD.defender.declaration = decl;
        freshDataD.defender.skillUuid = decl.skillUuid;
        freshDataD.defender.committedAt = freshDataD.defender.committedAt ?? Date.now();

        freshDataD.context = freshDataD.context ?? {};
        // Determine phase based on whether the attacker has already committed
        if (_bothSidesCommitted(freshDataD)) {
          freshDataD.context.phase = "ready";
        } else if (!freshDataD.context.phase || freshDataD.context.phase === "pending") {
          freshDataD.context.phase = "waitingAttacker";
        }
        if (!freshDataD.context.waitingSince) freshDataD.context.waitingSince = Date.now();

        await _updateCard(freshMsgD, freshDataD);
        return;
      }

      // Normalize + clamp UI inputs.
      decl = { ...decl, ...normalizeSkillRollOptions(decl, defaults) };
      if (!_isSpecialActionSelectionLegal(decl, specialLegality)) {
        ui.notifications.warn("Selected test is not legal for this Special Action.");
        return;
      }

      const resMods = buildResistanceBonusMods(decl?.resistanceSelected ?? []);

      // Handle Combat Style or Combat profession separately
      let tn;
      let skillLabel;
      let defSkill = null;
      
      const resolved = _resolveCombatStyleOrSkill(defender, decl.skillUuid);
      if (!resolved) {
        ui.notifications.warn("Selected defender skill or combat style could not be found.");
        return;
      }
      
      if (resolved.type === "combatStyle") {
        // Combat Style roll
        const situationalMods = _buildSensorySituationalMods(decl, defender, { skillName: resolved.name });
        
        tn = computeTN({
          actor: defender,
          role: "defender",
          defenseType: DEFAULT_COMBAT_STYLE_DEFENSE_TYPE,
          styleUuid: decl.skillUuid,
          manualMod: decl.manualMod,
          situationalMods
        });
        skillLabel = resolved.name;
        defSkill = null; // Combat Style doesn't use skillItem
      } else if (resolved.type === "profession" && resolved.professionKey === "combat") {
        // NPC Combat profession
        const situationalMods = _buildSensorySituationalMods(decl, defender, { skillName: resolved.name });
        
        tn = computeTN({
          actor: defender,
          role: "defender",
          defenseType: DEFAULT_COMBAT_STYLE_DEFENSE_TYPE,
          styleUuid: decl.skillUuid,
          manualMod: decl.manualMod,
          situationalMods
        });
        skillLabel = resolved.name;
        defSkill = null; // Combat profession doesn't use skillItem
      } else if (resolved.type === "profession") {
        // Regular NPC profession — route through computeSkillTN for the full modifier
        // pipeline (fatigue, encumbrance, wounds, armor penalties, AE modifiers, item bonuses).
        defSkill = resolved.item;
        const situationalMods = _buildSensorySituationalMods(decl, defender, { skillName: resolved.name });
        if (resMods.length) situationalMods.push(...resMods);

        tn = computeSkillTN({
          actor: defender,
          skillItem: defSkill,
          difficultyKey: decl.difficultyKey,
          manualMod: decl.manualMod,
          selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
          situationalMods
        });
        skillLabel = resolved.name;
      } else if (resolved.type === "characteristic") {
        // Characteristic test — route through computeSkillTN with pseudo-item.
        defSkill = resolved.item;
        const situationalMods = _buildSensorySituationalMods(decl, defender, { skillName: resolved.name });
        if (resMods.length) situationalMods.push(...resMods);

        tn = computeSkillTN({
          actor: defender,
          skillItem: defSkill,
          difficultyKey: decl.difficultyKey,
          manualMod: decl.manualMod,
          selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
          situationalMods
        });
        skillLabel = resolved.name;
      } else {
        // Regular skill roll
        defSkill = resolved.item;
        const allowSpec = _hasSpecializations(defSkill);
        const situationalMods = _buildSensorySituationalMods(decl, defender, { skillName: defSkill?.name ?? skillLabel });
        if (resMods.length) situationalMods.push(...resMods);
        if (decl?.histskinUnderwater === true) {
          situationalMods.push({ key: "talent:histskin", label: "Histskin (Underwater)", value: +30, source: "talent" });
        }
        tn = computeSkillTN({
          actor: defender,
          skillItem: defSkill,
          difficultyKey: decl.difficultyKey,
          manualMod: decl.manualMod,
          selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
          useSpecialization: allowSpec && decl.useSpec,
          situationalMods
        });
        skillLabel = defSkill.name;
      }

      const request = defSkill ? buildSkillRollRequest({
        actor: defender,
        skillItem: defSkill,
        targetToken: aToken,
        options: {
          difficultyKey: decl.difficultyKey,
          manualMod: decl.manualMod,
          useSpec: Boolean(decl.useSpec),
          selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
          applyBlinded: Boolean(decl.applyBlinded),
          applyDeafened: Boolean(decl.applyDeafened)
        },
        context: { source: "chat", quick, messageId: message.id, groupId: data.context?.groupId ?? null }
      }) : null;
      
      if (request) {
        const v = validateSkillRollRequest(request);
        if (!v.ok) {
          ui.notifications.warn(v.error || "Invalid skill roll request.");
          return;
        }
        skillRollDebug("opposed defender request", request);
        data.defender.request = request;
      }

      data.defender.skillUuid = decl.skillUuid;
      data.defender.skillLabel = skillLabel;
      data.defender.declared = {
        difficultyKey: decl.difficultyKey,
        manualMod: decl.manualMod,
        useSpec: Boolean(decl.useSpec),
        selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
        isInterrogationTest: Boolean(decl?.isInterrogationTest),
        histskinUnderwater: Boolean(decl?.histskinUnderwater)
      };
      
      await _setLastSkillRollOptions(_mergeLastSkillRollOptions({
        difficultyKey: decl.difficultyKey,
        manualMod: decl.manualMod,
        useSpec: Boolean(decl.useSpec),
        selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
        lastSkillUuidByActor: { [defender.uuid]: decl.skillUuid }
      }));

      data.defender.tn = tn;
      applyRuntimePreRollToTN({
        actor: defender,
        targetActor: attacker,
        targetToken: aToken ?? null,
        item: defSkill ?? null,
        rollContext: data?.context?.rollContext,
        workflow: "skill",
        side: "defender",
        skillName: skillLabel,
        tn
      });
      skillRollDebug("opposed defender TN", { finalTN: tn.finalTN, breakdown: tn.breakdown });

      const rollFormula = "1d100";
      const rollMode = game.settings.get("core", "rollMode");
      const res = await doTestRoll(defender, { rollFormula, target: tn.finalTN, allowLucky: true, allowUnlucky: true });

      // Awareness talent automation: Keen Intuition (Observe) / Hyper Awareness (Evade).
      await applyKeenIntuitionToResult(defender, skillLabel, res, { allowPrompt: true });
      await applyHyperAwarenessToResult(defender, skillLabel, res, { allowPrompt: true });

      // Intellectual talent automation: Businessman / Interrogator DoS substitutions (Commerce / Persuade).
      await applyIntellectualTalentDoSOverrides({
        actor: defender,
        skillName: skillLabel,
        result: res,
        isInterrogationTest: Boolean(decl?.isInterrogationTest),
        allowPrompt: true
      });

      await applyRuntimePostRollToResult({
        actor: defender,
        targetActor: attacker,
        targetToken: aToken ?? null,
        item: defSkill ?? null,
        rollContext: data?.context?.rollContext,
        workflow: "skill",
        side: "defender",
        skillName: skillLabel,
        result: res,
        allowPrompt: true
      });

      skillRollDebug("opposed defender result", { rollTotal: res.rollTotal, target: res.target, isSuccess: res.isSuccess, degree: res.degree, critS: res.isCriticalSuccess, critF: res.isCriticalFailure });

      const dosOverride = res?.uesrpgDosOverride ?? null;
      const skillTest = {
        actorUuid: defender.uuid,
        skillUuid: decl.skillUuid ?? data.defender.skillUuid ?? null,
        skillName: skillLabel,
        target: tn.finalTN,
        rollFormula,
        rollMode,
        useSpecialization: Boolean(decl.useSpec),
        isInterrogationTest: Boolean(decl?.isInterrogationTest),
        isSuccess: Boolean(res.isSuccess),
        degree: Number(res.degree ?? 0) || 0,
        textual: String(res.textual ?? "")
      };

      const rollFlags = request ? {
        uesrpg: { rollRequest: request },
        "uesrpg-3ev4": {
          rollRequest: request,
          ..._skillOpposedMetaFlag(message.id, "defender-roll", {
            commit: {
              defender: {
                skillUuid: data.defender.skillUuid,
                skillLabel: data.defender.skillLabel,
                declared: data.defender.declared,
                tn,
                talentChoices: {
                  keenIntuitionChoice: res?.keenIntuitionChoice ?? null,
                  hyperAwarenessChoice: res?.hyperAwarenessChoice ?? null
                }
              }
            }
          })
        }
      } : {
        "uesrpg-3ev4": {
          ..._skillOpposedMetaFlag(message.id, "defender-roll", {
            commit: {
              defender: {
                skillUuid: data.defender.skillUuid,
                skillLabel: data.defender.skillLabel,
                declared: data.defender.declared,
                tn,
                talentChoices: {
                  keenIntuitionChoice: res?.keenIntuitionChoice ?? null,
                  hyperAwarenessChoice: res?.hyperAwarenessChoice ?? null
                }
              }
            }
          })
        }
      };

      rollFlags.uesrpg = {
        ...(rollFlags.uesrpg ?? {}),
        skillTest,
        ...(dosOverride ? { dosOverride } : {}),
        reroll: { used: false, source: null }
      };
      rollFlags["uesrpg-3ev4"] = {
        ...(rollFlags["uesrpg-3ev4"] ?? {}),
        skillTest,
        ...(dosOverride ? { dosOverride } : {})
      };

      // Racial talent (Chapter 4): Histskin underwater roll toggle (+30 Athletics/Stealth).
      if (decl?.histskinUnderwater === true) {
        rollFlags.uesrpg.rollOptions = { ...(rollFlags.uesrpg.rollOptions ?? {}), histskin: true };
        rollFlags["uesrpg-3ev4"].rollOptions = { ...(rollFlags["uesrpg-3ev4"].rollOptions ?? {}), histskin: true };
      }

      await res.roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: defender, token: dToken?.document ?? null }),
        flavor: `${_esc(data.defender.skillLabel)} — Opposed Skill (Target)`,
        flags: rollFlags,
        rollMode
      });
      
      if (defSkill) {
        await consumePhysicalExertionForSkill(defender, defSkill);
      }

      // Re-read fresh state before committing roll results to avoid overwriting
      // attacker-side data that may have been committed in parallel.
      const freshMsgDR = game.messages.get(message.id) ?? message;
      const freshDataDR = _getMessageState(freshMsgDR) ?? data;
      freshDataDR.defender = freshDataDR.defender ?? {};
      // Preserve computed fields from the stale `data` that were set during this action.
      freshDataDR.defender.skillUuid = data.defender.skillUuid;
      freshDataDR.defender.skillLabel = data.defender.skillLabel;
      freshDataDR.defender.declared = data.defender.declared;
      freshDataDR.defender.tn = data.defender.tn;
      if (data.defender.request) freshDataDR.defender.request = data.defender.request;
      freshDataDR.defender.result = {
        rollTotal: res.rollTotal,
        target: res.target,
        isSuccess: res.isSuccess,
        degree: res.degree,
        textual: res.textual,
        isCriticalSuccess: res.isCriticalSuccess,
        isCriticalFailure: res.isCriticalFailure
      };

      if (freshDataDR.attacker?.result) {
        freshDataDR.outcome = _resolveOutcome(freshDataDR);
        await _maybeResolveBothCritSuccessRollOff({ message: freshMsgDR, data: freshDataDR, attacker, defender });
        await _executeSpecialActionIfWinner(freshDataDR);
      }

      await _updateCard(freshMsgDR, freshDataDR);
      return;
    }
  }
};

// Helpful global for macros
window.UesrpgSkillOpposed = window.UesrpgSkillOpposed || {};
window.UesrpgSkillOpposed.createPending = window.UesrpgSkillOpposed.createPending || SkillOpposedWorkflow.createPending.bind(SkillOpposedWorkflow);
window.UesrpgSkillOpposed.handleAction = window.UesrpgSkillOpposed.handleAction || SkillOpposedWorkflow.handleAction.bind(SkillOpposedWorkflow);
