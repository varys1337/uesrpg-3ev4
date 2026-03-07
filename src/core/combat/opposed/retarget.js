/**
 * src/core/combat/opposed/retarget.js
 * In-place opposed message retargeting utilities.
 */

import { canUserRollActor } from "../../../utils/permissions.js";
import { safeUpdateChatMessage } from "../../../utils/chat-message-socket.js";
import { cloneFlagState } from "../../../utils/clone.js";
import { updateCard as _updateCardViaUpdater } from "./cards/updater.js";
import {
  renderMultiDefenderCard,
  renderSingleDefenderCard
} from "./cards/renderers.js";
import {
  _getDefenderEntries,
  _isMultiDefender,
  _getDefenderOutcome,
  _getDefenderAdvantage,
  _getDefenderResolutionState,
  _allDefendersCommitted,
  _resolveDefenderIndex
} from "./schema.js";
import { _isBankChoicesEnabledForData, _getBankCommitState } from "./banking/state.js";
import { _anyActiveGMOnline, _safeGetSetting } from "./helpers/util.js";
import { inferAttackModeFromPreferredWeapon, getPreferredWeaponUuid, getContextAttackMode } from "./helpers/workflow.js";
import { getExplicitActiveCombatStyleItem } from "../combat-style-utils.js";
import { _renderCard as _renderSkillOpposedCard } from "../../skills/opposed-workflow/core/render.js";
import { _normalizeCardFlag as _normalizeSkillCardFlag } from "../../skills/opposed-workflow/core/schema.js";
import { FLAG_NS as SKILL_FLAG_NS, FLAG_KEY as SKILL_FLAG_KEY, CARD_VERSION as SKILL_CARD_VERSION } from "../../skills/opposed-workflow/core/constants.js";
import { renderCard as _renderMagicOpposedCard } from "../../magic/opposed/render.js";
import { computeMagicCastingTN } from "../../magic/magicka-utils.js";
import { isDebugEnabled } from "../../../utils/debug.js";
import { SYSTEM_ID } from "../../system/namespace.js";
const MAGIC_FLAG_KEY = "magicOpposed";

function _retargetDebugEnabled() {
  const runtimeToggle = Boolean(globalThis?.__UESRPG_CTX_MENU_DEBUG__ === true);
  return isDebugEnabled("opposedDebug", { runtimeToggle });
}

function _retargetDebug(event, payload = {}) {
  if (!_retargetDebugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.log(`UESRPG | RetargetDebug | ${event}`, payload);
  } catch (_e) {
    // no-op
  }
}

function _resolveDoc(uuid) {
  if (!uuid) return null;
  try {
    return fromUuidSync(uuid);
  } catch (_e) {
    return null;
  }
}

function _resolveActor(docOrUuid) {
  const doc = (typeof docOrUuid === "string") ? _resolveDoc(docOrUuid) : docOrUuid;
  if (!doc) return null;
  if (doc.documentName === "Actor") return doc;
  if (doc.documentName === "Token") return doc.actor ?? null;
  if (doc.actor) return doc.actor;
  return null;
}

function _resolveToken(docOrUuid) {
  const doc = (typeof docOrUuid === "string") ? _resolveDoc(docOrUuid) : docOrUuid;
  if (!doc) return null;
  if (doc.documentName === "Token") return doc;
  if (doc.documentName === "TokenDocument") return doc;
  if (doc.document && doc.actor) return doc.document;
  return null;
}

function _findTokenOnCanvasById(tokenId) {
  if (!tokenId) return null;
  return canvas?.tokens?.get?.(String(tokenId))?.document ?? null;
}

function _resolveTokenRef({ tokenId = null, tokenUuid = null, actorUuid = null } = {}) {
  const byId = tokenId ? _findTokenOnCanvasById(tokenId) : null;
  if (byId) return byId;

  const byTokenUuid = tokenUuid ? _resolveToken(tokenUuid) : null;
  if (byTokenUuid) return byTokenUuid;

  if (actorUuid) {
    const actor = _resolveActor(actorUuid);
    if (actor) {
      const tok = actor.getActiveTokens?.()[0] ?? null;
      if (tok?.document) return tok.document;
    }
  }

  return null;
}

function _buildDefenderEntry(actor, tokenDoc) {
  return {
    actorUuid: actor?.uuid ?? null,
    tokenUuid: tokenDoc?.uuid ?? null,
    tokenName: tokenDoc?.name ?? null,
    name: actor?.name ?? tokenDoc?.name ?? "Defender",
    label: null,
    testLabel: null,
    defenseLabel: null,
    target: null,
    defenseType: null,
    result: null,
    noDefense: false,
    banked: { committed: false, committedAt: null, committedBy: null },
    tn: null,
    outcome: null,
    advantage: null
  };
}

function _computeBaseAttackTarget(attacker, styleItem = null) {
  const fatiguePenalty = Number(attacker?.system?.fatigue?.penalty ?? 0) || 0;
  const carryPenalty = Number(attacker?.system?.carry_rating?.penalty ?? 0) || 0;
  const woundPenalty = Number(attacker?.system?.woundPenalty ?? 0) || 0;

  if (String(attacker?.type ?? "") === "NPC") {
    const base = Number(attacker?.system?.professions?.combat ?? 0) || 0;
    return {
      baseTarget: base + fatiguePenalty + carryPenalty + woundPenalty,
      itemUuid: "prof:combat",
      label: "Attack"
    };
  }

  const style = styleItem
    ?? getExplicitActiveCombatStyleItem(attacker)
    ?? attacker?.items?.find?.((i) => i?.type === "combatStyle")
    ?? null;

  const base = Number(style?.system?.value ?? 0) || 0;
  return {
    baseTarget: base + fatiguePenalty + carryPenalty + woundPenalty,
    itemUuid: style?.uuid ?? null,
    label: style?.name ?? "Attack"
  };
}

function _buildAttackerEntry(actor, tokenDoc) {
  const base = _computeBaseAttackTarget(actor);
  return {
    actorUuid: actor?.uuid ?? null,
    tokenUuid: tokenDoc?.uuid ?? null,
    tokenName: tokenDoc?.name ?? null,
    name: actor?.name ?? tokenDoc?.name ?? "Attacker",
    label: base.label,
    itemUuid: base.itemUuid,
    baseTarget: Number(base.baseTarget ?? 0) || 0,
    hasDeclared: false,
    banked: { committed: false, committedAt: null, committedBy: null },
    variant: "normal",
    variantMod: 0,
    manualMod: 0,
    totalMod: 0,
    target: Number(base.baseTarget ?? 0) || 0,
    tn: null,
    result: null
  };
}

function _resetSingleDefenderResolution(data) {
  data.status = "pending";
  data.outcome = null;
  data.advantage = null;
  data.advantageResolution = {};
  data.advantageSpent = {};
  data.defenderAdvantage = {};
}

function _resetContextPhase(data, { attackerRolled = false } = {}) {
  data.context = data.context ?? {};
  data.context.phase = attackerRolled ? "waitingDefender" : "pending";
  data.context.waitingSince = attackerRolled ? Date.now() : null;
  data.context.autoRollRequested = false;
  data.context.autoRollRequestedAt = null;
  data.context.autoRollRequestedBy = null;
  data.context.autoRollStarted = false;
  data.context.autoRollStartedAt = null;
  data.context.autoRollStartedBy = null;
  data.context.needsAutoRoll = false;
}

function _renderCombatCard(data, messageId) {
  const isMulti = Array.isArray(data?.defenders) && data.defenders.length > 1;
  const helpers = {
    _getDefenderEntries,
    _isBankChoicesEnabledForData: _isBankChoicesEnabledForData,
    _anyActiveGMOnline,
    _getBankCommitState,
    _getDefenderOutcome,
    _getDefenderAdvantage,
    _getDefenderResolutionState,
    _allDefendersCommitted,
    _isMultiDefender,
    _safeGetSetting
  };

  return isMulti
    ? renderMultiDefenderCard(data, messageId, helpers)
    : renderSingleDefenderCard(data, messageId, helpers);
}

async function _updateCombatCard(message, data) {
  await _updateCardViaUpdater(message, data, _renderCombatCard);
}

function _touchContext(data) {
  data.context = data.context ?? {};
  data.context.updatedAt = Date.now();
  data.context.updatedBy = game.user?.id ?? null;
  data.context.updatedSeq = (Number(data.context.updatedSeq) || 0) + 1;
}

function _getSkillCardEnvelope(message) {
  const raw = message?.flags?.[SKILL_FLAG_NS]?.[SKILL_FLAG_KEY] ?? null;
  if (!raw) return null;
  const normalized = _normalizeSkillCardFlag(raw);
  if (!normalized?.state) return null;
  const version = Number(raw?.version ?? SKILL_CARD_VERSION) || SKILL_CARD_VERSION;
  return { state: normalized.state, version };
}

function _getMagicCardEnvelope(message) {
  const raw = message?.flags?.[SYSTEM_ID]?.[MAGIC_FLAG_KEY] ?? null;
  if (!raw || typeof raw !== "object") return null;
  if (Number(raw.version) >= 1 && raw.state) {
    return { state: raw.state, version: Number(raw.version) || 1 };
  }
  if (raw.attacker && raw.defender) {
    return { state: raw, version: 1 };
  }
  return null;
}

async function _updateSkillCard(message, data, version = SKILL_CARD_VERSION) {
  _touchContext(data);
  data.context.schemaVersion = data.context.schemaVersion ?? SKILL_CARD_VERSION;

  await safeUpdateChatMessage(message, {
    content: _renderSkillOpposedCard(data, message.id),
    flags: { [SKILL_FLAG_NS]: { [SKILL_FLAG_KEY]: { version, state: data } } }
  });
}

async function _updateMagicCard(message, data, version = 2) {
  _touchContext(data);
  data.context.schemaVersion = data.context.schemaVersion ?? (Number(version ?? 2) || 2);

  await safeUpdateChatMessage(message, {
    content: _renderMagicOpposedCard(data, message.id),
    flags: { [SYSTEM_ID]: { [MAGIC_FLAG_KEY]: { version, state: data } } }
  });
}

function _canInteractCombatOpposed(user, message, data) {
  if (user?.isGM) return true;
  if (message?.isAuthor) return true;

  const attacker = _resolveActor(data?.attacker?.actorUuid);
  const defender = _resolveActor(data?.defender?.actorUuid);
  return canUserRollActor(user, attacker) || canUserRollActor(user, defender);
}

function _canInteractSkillOpposed(user, message, data) {
  if (user?.isGM) return true;
  if (message?.isAuthor) return true;

  const attacker = _resolveActor(data?.attacker?.actorUuid);
  const defender = _resolveActor(data?.defender?.actorUuid);
  return canUserRollActor(user, attacker) || canUserRollActor(user, defender);
}

function _canInteractMagicOpposed(user, message, data) {
  if (user?.isGM) return true;
  if (message?.isAuthor) return true;

  const attacker = _resolveActor(data?.attacker?.actorUuid);
  if (canUserRollActor(user, attacker)) return true;

  const defenders = Array.isArray(data?.defenders) && data.defenders.length
    ? data.defenders
    : (data?.defender ? [data.defender] : []);

  for (const def of defenders) {
    const actor = _resolveActor(def?.actorUuid);
    if (canUserRollActor(user, actor)) return true;
  }

  return false;
}

function _canAutomationRetarget(user, automationActorUuid) {
  if (!automationActorUuid) return false;
  const automationActor = _resolveActor(automationActorUuid);
  if (!automationActor) return false;
  return canUserRollActor(user, automationActor);
}

function _setActorTokenRefs(entry, actor, tokenDoc) {
  if (!entry) return;
  entry.actorUuid = actor?.uuid ?? null;
  entry.tokenUuid = tokenDoc?.uuid ?? null;
  entry.tokenName = tokenDoc?.name ?? actor?.name ?? null;
  entry.name = actor?.name ?? tokenDoc?.name ?? entry.name ?? null;
}

function _resetSkillSide(side) {
  if (!side) return;
  side.skillUuid = null;
  side.skillLabel = "";
  side.declaration = null;
  side.declared = null;
  side.tn = null;
  side.request = null;
  side.result = null;
  side.rollMessageId = null;
  side.rolledAt = null;
  side.committedAt = null;
  side.target = null;
  if (side.banked && typeof side.banked === "object") {
    side.banked.committed = false;
    side.banked.committedAt = null;
    side.banked.committedBy = null;
  }
}

function _resetMagicDefenderLane(defender) {
  if (!defender) return;
  defender.defenseType = null;
  defender.result = null;
  defender.tn = null;
  defender.noDefense = false;
  defender.outcome = null;
  if (defender.banked && typeof defender.banked === "object") {
    defender.banked.committed = false;
    defender.banked.committedAt = null;
    defender.banked.committedBy = null;
  }
}

function _buildMagicDefenderEntry(actor, tokenDoc, base = {}) {
  return {
    ...base,
    actorUuid: actor?.uuid ?? null,
    tokenUuid: tokenDoc?.uuid ?? null,
    tokenName: tokenDoc?.name ?? null,
    name: actor?.name ?? tokenDoc?.name ?? "Defender",
    defenseType: null,
    result: null,
    tn: null,
    noDefense: false,
    apCost: Number(base?.apCost ?? 1) || 1,
    banked: { committed: false, committedAt: null, committedBy: null },
    outcome: null
  };
}

function _magicDefenderEntries(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.defenders) && data.defenders.length) return data.defenders;
  if (data.defender && typeof data.defender === "object") return [data.defender];
  return [];
}

function _resolveMagicDefenderIndex(data) {
  const defenders = _magicDefenderEntries(data);
  if (!defenders.length) return null;

  const tokenUuid = String(data?.defender?.tokenUuid ?? "").trim();
  if (tokenUuid) {
    const idx = defenders.findIndex((d) => String(d?.tokenUuid ?? "") === tokenUuid);
    if (idx >= 0) return idx;
  }

  const actorUuid = String(data?.defender?.actorUuid ?? "").trim();
  if (actorUuid) {
    const idx = defenders.findIndex((d) => String(d?.actorUuid ?? "") === actorUuid);
    if (idx >= 0) return idx;
  }

  return 0;
}

async function _retargetAttacker(data, targetTokenDoc) {
  const targetActor = _resolveActor(targetTokenDoc);
  if (!targetActor || !targetTokenDoc) return false;

  data.attacker = _buildAttackerEntry(targetActor, targetTokenDoc);

  const defenders = _getDefenderEntries(data);
  for (const def of defenders) {
    def.result = null;
    def.target = null;
    def.targetLabel = null;
    def.defenseType = null;
    def.label = null;
    def.testLabel = null;
    def.defenseLabel = null;
    def.noDefense = false;
    def.tn = null;
    def.outcome = null;
    def.advantage = null;
    def.advantageResolution = {};
    def.advantageSpent = {};
    def.defenderAdvantage = {};
    def.banked = { committed: false, committedAt: null, committedBy: null };
  }

  if (defenders.length) data.defender = defenders[0];
  _resetSingleDefenderResolution(data);

  data.context = data.context ?? {};
  data.context.attackMode = await inferAttackModeFromPreferredWeapon(targetActor);
  data.context.weaponUuid = getPreferredWeaponUuid(targetActor, { meleeOnly: false }) || null;
  _resetContextPhase(data, { attackerRolled: false });

  return true;
}

async function _retargetDefender(data, targetTokenDoc) {
  const targetActor = _resolveActor(targetTokenDoc);
  if (!targetActor || !targetTokenDoc) return false;

  const defenders = _getDefenderEntries(data);
  if (!defenders.length) return false;

  const idx = _resolveDefenderIndex(data, {
    defenderTokenUuid: data?.defender?.tokenUuid,
    defenderActorUuid: data?.defender?.actorUuid
  }) ?? 0;

  const next = _buildDefenderEntry(targetActor, targetTokenDoc);
  defenders[idx] = next;
  data.defenders = defenders;
  data.defender = defenders[idx] ?? defenders[0];

  if (_isMultiDefender(data)) {
    const allResolved = defenders.every((d) => Boolean(d?.outcome));
    if (!allResolved) {
      data.status = "pending";
      data.outcome = null;
    }
  } else {
    _resetSingleDefenderResolution(data);
  }

  const attackerRolled = Boolean(data?.attacker?.result);
  _resetContextPhase(data, { attackerRolled });

  return true;
}

function _retargetSkillAttacker(data, targetTokenDoc) {
  const targetActor = _resolveActor(targetTokenDoc);
  if (!targetActor || !targetTokenDoc) return false;

  data.attacker = data.attacker ?? {};
  _setActorTokenRefs(data.attacker, targetActor, targetTokenDoc);
  _resetSkillSide(data.attacker);

  data.defender = data.defender ?? {};
  _resetSkillSide(data.defender);

  data.status = "pending";
  data.outcome = null;
  data.context = data.context ?? {};
  data.context.phase = "pending";
  data.context.waitingSince = null;
  if (data.context.rollOff) delete data.context.rollOff;

  return true;
}

function _retargetSkillDefender(data, targetTokenDoc) {
  const targetActor = _resolveActor(targetTokenDoc);
  if (!targetActor || !targetTokenDoc) return false;

  data.defender = data.defender ?? {};
  _setActorTokenRefs(data.defender, targetActor, targetTokenDoc);
  _resetSkillSide(data.defender);

  data.status = "pending";
  data.outcome = null;
  data.context = data.context ?? {};
  data.context.phase = data.attacker?.result ? "waitingDefender" : "pending";
  data.context.waitingSince = data.attacker?.result ? Date.now() : null;
  if (data.context.rollOff) delete data.context.rollOff;

  return true;
}

async function _retargetMagicAttacker(data, targetTokenDoc) {
  const targetActor = _resolveActor(targetTokenDoc);
  if (!targetActor || !targetTokenDoc) return false;

  data.attacker = data.attacker ?? {};
  _setActorTokenRefs(data.attacker, targetActor, targetTokenDoc);

  const spellUuid = String(data.attacker?.spellUuid ?? "").trim();
  if (spellUuid) {
    const spell = await fromUuid(spellUuid);
    if (spell) {
      data.attacker.spellName = spell.name;
      data.attacker.spellSchool = spell.system?.school ?? "";
      data.attacker.spellLevel = Number(spell.system?.level ?? 1);
      data.attacker.spellCost = Number(spell.system?.cost ?? 0);
      data.attacker.tn = computeMagicCastingTN(targetActor, spell, data.attacker?.spellOptions ?? {});
    } else {
      data.attacker.tn = null;
    }
  } else {
    data.attacker.tn = null;
  }

  data.attacker.result = null;
  data.attacker.mpSpent = null;
  data.attacker.mpRemaining = null;
  data.attacker.backfire = false;
  if (data.attacker.banked && typeof data.attacker.banked === "object") {
    data.attacker.banked.committed = false;
    data.attacker.banked.committedAt = null;
    data.attacker.banked.committedBy = null;
  }

  const defenders = _magicDefenderEntries(data);
  for (const def of defenders) {
    _resetMagicDefenderLane(def);
  }
  if (Array.isArray(data.defenders)) data.defenders = defenders;
  if (!Array.isArray(data.defenders) && defenders.length) data.defender = defenders[0];

  data.status = "pending";
  data.outcome = null;
  data.context = data.context ?? {};
  data.context.phase = "pending";
  data.context.waitingSince = null;

  return true;
}

function _retargetMagicDefender(data, targetTokenDoc) {
  const targetActor = _resolveActor(targetTokenDoc);
  if (!targetActor || !targetTokenDoc) return false;

  const defenders = _magicDefenderEntries(data);
  if (!defenders.length) return false;

  const idx = _resolveMagicDefenderIndex(data) ?? 0;
  defenders[idx] = _buildMagicDefenderEntry(targetActor, targetTokenDoc, defenders[idx] ?? {});

  if (Array.isArray(data.defenders)) {
    data.defenders = defenders;
    data.defender = defenders[idx] ?? defenders[0] ?? null;
  } else {
    data.defender = defenders[0] ?? null;
  }

  data.status = "pending";
  if (!Array.isArray(data.defenders) || data.defenders.length <= 1) {
    data.outcome = null;
  }

  data.context = data.context ?? {};
  data.context.phase = data.attacker?.result ? "awaiting-defense" : "pending";
  data.context.waitingSince = data.attacker?.result ? Date.now() : null;

  return true;
}

function _getCardKind(message) {
  const flags = message?.flags?.[SYSTEM_ID] ?? {};
  if (flags?.opposed) return "combat";
  if (flags?.[SKILL_FLAG_KEY]) return "skill";
  if (flags?.[MAGIC_FLAG_KEY]) return "magic";
  return null;
}

export function canRetargetOpposedMessage(message, user = game.user) {
  const kind = _getCardKind(message);
  if (!kind) {
    _retargetDebug("canRetarget.noKind", {
      messageId: message?.id ?? null,
      hasOpposed: Boolean(message?.flags?.[SYSTEM_ID]?.opposed),
      hasSkillOpposed: Boolean(message?.flags?.[SYSTEM_ID]?.[SKILL_FLAG_KEY]),
      hasMagicOpposed: Boolean(message?.flags?.[SYSTEM_ID]?.[MAGIC_FLAG_KEY])
    });
    return false;
  }

  if (kind === "combat") {
    const raw = message?.flags?.[SYSTEM_ID]?.opposed ?? null;
    const allowed = Boolean(raw) && _canInteractCombatOpposed(user, message, raw);
    _retargetDebug("canRetarget.combat", { messageId: message?.id ?? null, userId: user?.id ?? null, allowed });
    return allowed;
  }

  if (kind === "skill") {
    const env = _getSkillCardEnvelope(message);
    const allowed = Boolean(env?.state) && _canInteractSkillOpposed(user, message, env.state);
    _retargetDebug("canRetarget.skill", { messageId: message?.id ?? null, userId: user?.id ?? null, allowed });
    return allowed;
  }

  const env = _getMagicCardEnvelope(message);
  const allowed = Boolean(env?.state) && _canInteractMagicOpposed(user, message, env.state);
  _retargetDebug("canRetarget.magic", { messageId: message?.id ?? null, userId: user?.id ?? null, allowed });
  return allowed;
}

/**
 * Retarget attacker and/or defender on an existing opposed workflow message.
 * Updates the existing chat message in place.
 */
export async function retargetOpposedMessage(
  message,
  { attackerTokenId = null, attackerTokenUuid = null, defenderTokenId = null, defenderTokenUuid = null } = {},
  { userId = null, reason = "retarget", automationActorUuid = null, forceAutomation = false } = {}
) {
  const live = message?.id ? (game.messages?.get?.(message.id) ?? message) : message;
  const kind = _getCardKind(live);
  _retargetDebug("retarget.start", {
    messageId: live?.id ?? message?.id ?? null,
    kind,
    userId: userId ?? game.user?.id ?? null,
    attackerTokenId: attackerTokenId ?? null,
    attackerTokenUuid: attackerTokenUuid ?? null,
    defenderTokenId: defenderTokenId ?? null,
    defenderTokenUuid: defenderTokenUuid ?? null,
    automationActorUuid: automationActorUuid ?? null,
    forceAutomation: Boolean(forceAutomation),
    reason: String(reason ?? "retarget")
  });
  if (!kind) {
    ui.notifications?.warn?.("This chat message is not an opposed test card.");
    return false;
  }

  const user = game.users?.get?.(userId ?? game.user?.id) ?? game.user;
  const automationAllowed = _canAutomationRetarget(user, automationActorUuid);
  const nextAttackerDoc = _resolveTokenRef({ tokenId: attackerTokenId, tokenUuid: attackerTokenUuid });
  const nextDefenderDoc = _resolveTokenRef({ tokenId: defenderTokenId, tokenUuid: defenderTokenUuid });

  if (!nextAttackerDoc && !nextDefenderDoc) {
    _retargetDebug("retarget.noResolvedTokens", {
      attackerTokenId: attackerTokenId ?? null,
      attackerTokenUuid: attackerTokenUuid ?? null,
      defenderTokenId: defenderTokenId ?? null,
      defenderTokenUuid: defenderTokenUuid ?? null
    });
    ui.notifications?.warn?.("No valid token was provided for retargeting.");
    return false;
  }

  if (kind === "combat") {
    const raw = live?.flags?.[SYSTEM_ID]?.opposed ?? null;
    if (!raw) {
      ui.notifications?.warn?.("This chat message is not an opposed test card.");
      return false;
    }

    const data = foundry.utils.deepClone(raw);
    if (!_canInteractCombatOpposed(user, live, data) && !(forceAutomation && automationAllowed)) {
      ui.notifications?.warn?.("You do not have permission to modify this opposed card.");
      return false;
    }

    if (nextAttackerDoc) {
      const attackerActor = _resolveActor(nextAttackerDoc);
      const allowAutomationActor = Boolean(forceAutomation && automationAllowed
        && automationActorUuid
        && String(attackerActor?.uuid ?? "") === String(automationActorUuid));
      if (!canUserRollActor(user, attackerActor) && !allowAutomationActor) {
        ui.notifications?.warn?.("You do not have permission to use the selected token as attacker.");
        return false;
      }
      const ok = await _retargetAttacker(data, nextAttackerDoc);
      if (!ok) return false;
    }

    if (nextDefenderDoc) {
      const defenderActor = _resolveActor(nextDefenderDoc);
      const allowAutomationActor = Boolean(forceAutomation && automationAllowed
        && automationActorUuid
        && String(defenderActor?.uuid ?? "") === String(automationActorUuid));
      if (!canUserRollActor(user, defenderActor) && !allowAutomationActor) {
        ui.notifications?.warn?.("You do not have permission to use the selected token as defender.");
        return false;
      }
      const ok = await _retargetDefender(data, nextDefenderDoc);
      if (!ok) return false;
    }

    data.context = data.context ?? {};
    data.context.attackMode = getContextAttackMode(data.context);
    data.context.retarget = {
      at: Date.now(),
      by: user?.id ?? game.user?.id ?? null,
      reason: String(reason ?? "retarget")
    };

    await _updateCombatCard(live, data);
    return true;
  }

  if (kind === "skill") {
    const env = _getSkillCardEnvelope(live);
    if (!env?.state) {
      ui.notifications?.warn?.("This chat message is not an opposed test card.");
      return false;
    }

    const data = cloneFlagState(env.state);
    if (!_canInteractSkillOpposed(user, live, data) && !(forceAutomation && automationAllowed)) {
      ui.notifications?.warn?.("You do not have permission to modify this opposed card.");
      return false;
    }

    if (nextAttackerDoc) {
      const attackerActor = _resolveActor(nextAttackerDoc);
      const allowAutomationActor = Boolean(forceAutomation && automationAllowed
        && automationActorUuid
        && String(attackerActor?.uuid ?? "") === String(automationActorUuid));
      if (!canUserRollActor(user, attackerActor) && !allowAutomationActor) {
        ui.notifications?.warn?.("You do not have permission to use the selected token as attacker.");
        return false;
      }
      if (!_retargetSkillAttacker(data, nextAttackerDoc)) return false;
    }

    if (nextDefenderDoc) {
      const defenderActor = _resolveActor(nextDefenderDoc);
      const allowAutomationActor = Boolean(forceAutomation && automationAllowed
        && automationActorUuid
        && String(defenderActor?.uuid ?? "") === String(automationActorUuid));
      if (!canUserRollActor(user, defenderActor) && !allowAutomationActor) {
        ui.notifications?.warn?.("You do not have permission to use the selected token as defender.");
        return false;
      }
      if (!_retargetSkillDefender(data, nextDefenderDoc)) return false;
    }

    data.context = data.context ?? {};
    data.context.retarget = {
      at: Date.now(),
      by: user?.id ?? game.user?.id ?? null,
      reason: String(reason ?? "retarget")
    };

    await _updateSkillCard(live, data, env.version);
    return true;
  }

  const env = _getMagicCardEnvelope(live);
  if (!env?.state) {
    ui.notifications?.warn?.("This chat message is not an opposed test card.");
    return false;
  }

  const data = cloneFlagState(env.state);
  if (!_canInteractMagicOpposed(user, live, data) && !(forceAutomation && automationAllowed)) {
    ui.notifications?.warn?.("You do not have permission to modify this opposed card.");
    return false;
  }

  if (nextAttackerDoc) {
    const attackerActor = _resolveActor(nextAttackerDoc);
    const allowAutomationActor = Boolean(forceAutomation && automationAllowed
      && automationActorUuid
      && String(attackerActor?.uuid ?? "") === String(automationActorUuid));
    if (!canUserRollActor(user, attackerActor) && !allowAutomationActor) {
      ui.notifications?.warn?.("You do not have permission to use the selected token as attacker.");
      return false;
    }
    const ok = await _retargetMagicAttacker(data, nextAttackerDoc);
    if (!ok) return false;
  }

  if (nextDefenderDoc) {
    const defenderActor = _resolveActor(nextDefenderDoc);
    const allowAutomationActor = Boolean(forceAutomation && automationAllowed
      && automationActorUuid
      && String(defenderActor?.uuid ?? "") === String(automationActorUuid));
    if (!canUserRollActor(user, defenderActor) && !allowAutomationActor) {
      ui.notifications?.warn?.("You do not have permission to use the selected token as defender.");
      return false;
    }
    const ok = _retargetMagicDefender(data, nextDefenderDoc);
    if (!ok) return false;
  }

  data.context = data.context ?? {};
  data.context.retarget = {
    at: Date.now(),
    by: user?.id ?? game.user?.id ?? null,
    reason: String(reason ?? "retarget")
  };

  await _updateMagicCard(live, data, env.version);
  return true;
}

function _matchesDefender(defender, { actorUuid = null, tokenUuid = null } = {}) {
  const aOk = actorUuid ? String(defender?.actorUuid ?? "") === String(actorUuid) : false;
  const tOk = tokenUuid ? String(defender?.tokenUuid ?? "") === String(tokenUuid) : false;
  return aOk || tOk;
}

export function findLatestOpposedMessageByDefender({ actorUuid = null, tokenUuid = null, mode = "combat", activeOnly = true } = {}) {
  const list = Array.from(game.messages?.contents ?? []);
  const wantedMode = String(mode ?? "combat").trim().toLowerCase() || "combat";

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];

    if (wantedMode === "combat" || wantedMode === "any") {
      const data = msg?.flags?.[SYSTEM_ID]?.opposed ?? null;
      if (data) {
        if (activeOnly && String(data?.status ?? "").toLowerCase() === "resolved") {
          // skip
        } else {
          const defenders = _getDefenderEntries(data);
          if (defenders.some((d) => _matchesDefender(d, { actorUuid, tokenUuid }))) return msg;
        }
      }
      if (wantedMode === "combat") continue;
    }

    if (wantedMode === "skill" || wantedMode === "any") {
      const env = _getSkillCardEnvelope(msg);
      const data = env?.state ?? null;
      if (data) {
        if (activeOnly && String(data?.status ?? "").toLowerCase() === "resolved") {
          // skip
        } else if (_matchesDefender(data?.defender, { actorUuid, tokenUuid })) {
          return msg;
        }
      }
      if (wantedMode === "skill") continue;
    }

    if (wantedMode === "magic" || wantedMode === "any") {
      const env = _getMagicCardEnvelope(msg);
      const data = env?.state ?? null;
      if (!data) continue;
      if (activeOnly && String(data?.status ?? "").toLowerCase() === "resolved") continue;

      const defenders = _magicDefenderEntries(data);
      if (defenders.some((d) => _matchesDefender(d, { actorUuid, tokenUuid }))) return msg;
    }
  }

  return null;
}
