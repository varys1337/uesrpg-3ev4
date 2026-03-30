/**
 * src/core/skills/opposed-workflow/index.js
 *
 * Skill opposed workflow façade.
 *
 * Public surface: createPending, handleAction, maybeAutoRollBanked,
 * maybeAutoRollBankedNoGM, applyExternalRollMessage.
 *
 * Implementation is split into:
 *  - banking/orchestrator.js  — banked auto-roll (claim-id protocol)
 *  - actions/dispatch.js      — action routing
 *  - actions/attacker.js      — attacker roll handler
 *  - actions/defender.js      — defender roll handler
 *  - helpers.js               — concussive / hooked weapon mods
 *  - context.js               — special action context helpers
 *  - resolve.js               — crit-success roll-off
 */

import { computeResultFromRollTotal } from "../../../utils/degree-roll-helper.js";
import { safeUpdateChatMessage } from "../../../utils/chat-message-socket.js";
import { getFlagValueWithFallback } from "../../system/flags.js";
import { createUuidResolver } from "../../../utils/uuid-cache.js";
import { applyKeenIntuitionToResult, applyHyperAwarenessToResult } from "../../traits/awareness-talents.js";
import { applyIntellectualTalentDoSOverrides } from "../../traits/intellectual-talents.js";
import { applyRuntimePostRollToResult } from "../../traits/features/rule-element-runtime.js";
import { buildRollContext } from "../../rules/roll-context.js";

import { FLAG_NS, FLAG_KEY, CARD_VERSION } from "./core/constants.js";
import { _getMessageState, _normalizeCardFlag } from "./core/schema.js";
import { _resolveDoc, _resolveActor, _resolveToken } from "./core/docs.js";
import { _userHasActorOwnership } from "./core/util.js";
import { _renderCard } from "./core/render.js";
import { _updateCard } from "./core/card-updater.js";
import { _findSkillByUuid } from "./core/skills.js";
import { _resolveOutcome } from "./core/helpers.js";
import { _maybeResolveBothCritSuccessRollOff } from "./resolve.js";

import {
  maybeAutoRollBanked as _maybeAutoRollBankedOrchestrate,
  maybeAutoRollBankedNoGM as _maybeAutoRollBankedNoGMOrchestrate
} from "./banking/orchestrator.js";
import { dispatchAction } from "./actions/dispatch.js";

export const SkillOpposedWorkflow = {
  /**
   * Banked-choice auto roll hook helper (GM-present).
   * Called from the global updateChatMessage hook when the parent card updates.
   */
  async maybeAutoRollBanked(message) {
    return _maybeAutoRollBankedOrchestrate(message, this);
  },

  /**
   * Banked-choice auto roll hook helper (no active GM).
   * Uses the parent message author as the authority runner.
   */
  async maybeAutoRollBankedNoGM(message) {
    return _maybeAutoRollBankedNoGMOrchestrate(message, this);
  },

  /**
   * Route an action button click to the appropriate handler.
   */
  async handleAction(message, action, opts = {}) {
    return dispatchAction(message, action, opts, this);
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
    if (rollId && stage === "attacker-roll" && String(current?.attacker?.rollMessageId ?? "") === String(rollId)) return;
    if (rollId && stage === "defender-roll" && String(current?.defender?.rollMessageId ?? "") === String(rollId)) return;

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
    const uuid = createUuidResolver();

    let dirty = false;

    const rerollMeta = getFlagValueWithFallback(rollMessage, "reroll") ?? null;
    const isTalentReroll = Boolean(rerollMeta?.isReroll === true);
    const rerollParentMessageId = String(rerollMeta?.parentMessageId ?? "").trim();

    const applyResult = async (side, { talentChoices = null, sideRole = "" } = {}) => {
      if (!side?.actorUuid) return null;

      let actor = null;
      try {
        const doc = uuid.resolveSync(side.actorUuid);
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
          getFlagValueWithFallback(rollMessage, "dosOverride") ??
          null;
        const st =
          getFlagValueWithFallback(rollMessage, "skillTest") ??
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
        targetActor = _resolveActor(data?.defender?.actorUuid, { resolver: uuid });
        targetToken = _resolveToken(data?.defender?.tokenUuid, { resolver: uuid });
      } else if (sideRole === "defender") {
        targetActor = _resolveActor(data?.attacker?.actorUuid, { resolver: uuid });
        targetToken = _resolveToken(data?.attacker?.tokenUuid, { resolver: uuid });
      }

      let skillItem = null;
      const skillUuid = String(side?.skillUuid ?? "").trim();
      if (skillUuid) {
        try {
          const doc = uuid.resolveSync(skillUuid);
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
        allowPrompt: false
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
        if (c.declared && typeof c.declared === "object") data.defender.declared = { ...c.declared };
        if (c.tn && typeof c.tn === "object") data.defender.tn = { ...c.tn, breakdown: Array.isArray(c.tn.breakdown) ? c.tn.breakdown.map((entry) => ({ ...entry })) : c.tn.breakdown };
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
        attacker: _resolveActor(data.attacker.actorUuid, { resolver: uuid }),
        defender: _resolveActor(data.defender.actorUuid, { resolver: uuid })
      });
      data.status = "resolved";
      data.context = data.context ?? {};
      data.context.phase = "resolved";
      if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
    }

    await _updateCard(parent, data);
  },

  async createPending(cfg = {}) {
    const resolver = createUuidResolver();
    const aDoc = _resolveDoc(cfg.attackerTokenUuid, { resolver }) ?? _resolveDoc(cfg.attackerActorUuid, { resolver }) ?? _resolveDoc(cfg.attackerUuid, { resolver });
    const dDoc = _resolveDoc(cfg.defenderTokenUuid, { resolver }) ?? _resolveDoc(cfg.defenderActorUuid, { resolver }) ?? _resolveDoc(cfg.defenderUuid, { resolver });

    const aToken = _resolveToken(aDoc, { resolver });
    const dToken = _resolveToken(dDoc, { resolver });
    const attacker = _resolveActor(aDoc, { resolver });
    const defender = _resolveActor(dDoc, { resolver });

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
  }
};

window.UesrpgSkillOpposed = SkillOpposedWorkflow;

