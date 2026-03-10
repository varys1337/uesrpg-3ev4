import { requestUpdateChatMessage } from "../../utils/authority-proxy.js";
import { cloneFlagState } from "../../utils/clone.js";
import { SYSTEM_ID } from "../constants.js";
import { updateCard as updateCombatCard } from "../combat/opposed/cards/updater.js";
import { resolveOutcomeRAW, computeAdvantageRAW } from "../combat/opposed/outcome-resolution.js";
import { _renderCard as renderCombatCard } from "../combat/opposed/render.js";
import {
  _getDefenderEntries,
  _getDefenderOutcome,
  _setDefenderOutcome,
  _setDefenderAdvantage,
  _getDefenderDamage,
  _setDefenderDamage,
  _getDefenderResolutionState,
} from "../combat/opposed/schema.js";
import { applyAoEEvadeOutcome } from "../combat/opposed/helpers/workflow.js";
import { _cleanupAutoRollContext } from "../combat/opposed/banking/state.js";
import { _resolveActorViaToken as resolveCombatActor } from "../combat/opposed/helpers/docs.js";
import { _updateCard as updateSkillOpposedCard } from "../skills/opposed-workflow/core/card-updater.js";
import { _resolveOutcome as resolveSkillOutcome } from "../skills/opposed-workflow/core/helpers.js";
import { _maybeResolveBothCritSuccessRollOff as resolveSkillRollOff } from "../skills/opposed-workflow/resolve.js";
import { _resolveActor as resolveSkillActor } from "../skills/opposed-workflow/core/docs.js";
import { _updateCard as updateCharOpposedCard } from "../characteristics/opposed/card-updater.js";
import { _resolveOutcome as resolveCharOutcome } from "../characteristics/opposed/helpers.js";
import { _resolveActor as resolveCharActor } from "../characteristics/opposed/docs.js";
import { _maybeResolveBothCritSuccessRollOff as resolveCharRollOff } from "../characteristics/opposed-workflow.js";
import { updateCard as updateMagicCard } from "../magic/opposed/updater.js";
import { renderCard as renderMagicCard } from "../magic/opposed/render.js";
import {
  getDefenderEntries as getMagicDefenderEntries,
  selectDefenderEntry as selectMagicDefenderEntry,
  getDefenderOutcome as getMagicDefenderOutcome,
  setDefenderOutcome as setMagicDefenderOutcome,
  getMagicDefenderDamage,
  setMagicDefenderDamage,
  resolveActor as resolveMagicActor,
} from "../magic/opposed/schema.js";
import { resolveOutcome as resolveMagicOutcome } from "../magic/opposed/outcome-resolution.js";

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

function _normalizeResult(result) {
  if (!result || typeof result !== "object") return null;
  return {
    isSuccess: Boolean(result.isSuccess),
    degree: Number(result.degree ?? 0) || 0,
    isCriticalSuccess: Boolean(result.isCriticalSuccess),
    isCriticalFailure: Boolean(result.isCriticalFailure),
    rollTotal: Number(result.rollTotal ?? NaN),
    target: Number(result.target ?? NaN),
    textual: String(result.textual ?? ""),
  };
}

function _getLiveMessage(message) {
  return game.messages?.get?.(message?.id) ?? message ?? null;
}

function _getLiveInfo(message, classifyMessage) {
  const live = _getLiveMessage(message);
  return live ? classifyMessage(live) : null;
}

function _resolveLiveSide(message, info, side, classifyMessage) {
  const live = _getLiveMessage(message);
  const liveInfo = info ?? _getLiveInfo(live, classifyMessage);
  if (!live || !liveInfo) return { live, liveInfo, liveSide: null };
  let liveSide = null;
  if (side?.role === "defender") {
    liveSide = liveInfo.sides.find((candidate) => candidate.role === "defender" && (candidate.defenderIndex ?? 0) === (side.defenderIndex ?? 0)) ?? null;
  } else {
    liveSide = liveInfo.sides.find((candidate) => candidate.role === side?.role) ?? null;
  }
  return { live, liveInfo, liveSide };
}

function _applyExtraContext(data, extraContext = {}) {
  data.context = data.context ?? {};
  data.context.luckUsed = (extraContext.luckUsed ?? true) === true;
  if (extraContext.luckBurned !== undefined) data.context.luckBurned = Boolean(extraContext.luckBurned);
  if (extraContext.rerollUsed !== undefined) data.context.rerollUsed = Boolean(extraContext.rerollUsed);
  if (extraContext.rerollSource !== undefined) data.context.rerollSource = String(extraContext.rerollSource);
}

function _didPersistResult(message, infoType, sideRef, expectedResult, classifyMessage) {
  const live = _getLiveMessage(message);
  if (!live) return false;
  const updated = classifyMessage(live);
  if (!updated || updated.type !== infoType) return false;
  const side = updated.sides.find((candidate) => {
    if (candidate.role !== sideRef?.role) return false;
    if (candidate.role !== "defender") return true;
    return (candidate.defenderIndex ?? 0) === (sideRef?.defenderIndex ?? 0);
  });
  return _isResultMatch(side?.result, expectedResult);
}

function _getCombatAffectedDefenders(data, side) {
  const defenders = _getDefenderEntries(data);
  if (side?.role === "attacker") return defenders;
  const idx = side?.defenderIndex ?? 0;
  return defenders[idx] ? [defenders[idx]] : [];
}

function _combatLaneHasTerminalState(data, defender) {
  if (!defender) return false;
  const damage = _getDefenderDamage(data, defender);
  if (damage?.rolled === true || damage?.applied === true) return true;
  const resolutionState = _getDefenderResolutionState(data, defender);
  if (resolutionState?.advantageSpent?.attacker === true || resolutionState?.advantageSpent?.defender === true) return true;
  if (resolutionState?.defenderAdvantage?.resolved === true) return true;
  if (Array.isArray(data?.context?.advantageMarkers) && data.context.advantageMarkers.length > 0) return true;
  return false;
}

function _resetCombatLane(data, defender) {
  _setDefenderOutcome(data, defender, null);
  _setDefenderAdvantage(data, defender, null);
  const damage = _getDefenderDamage(data, defender);
  if (damage && damage.rolled !== true && damage.applied !== true) _setDefenderDamage(data, defender, null);
  const resolutionState = _getDefenderResolutionState(data, defender);
  if (resolutionState) {
    resolutionState.advantageResolution = {};
    resolutionState.advantageSpent = {};
    resolutionState.defenderAdvantage = {};
    if (Array.isArray(data.defenders)) {
      defender.advantageResolution = resolutionState.advantageResolution;
      defender.advantageSpent = resolutionState.advantageSpent;
      defender.defenderAdvantage = resolutionState.defenderAdvantage;
    } else {
      data.advantageResolution = resolutionState.advantageResolution;
      data.advantageSpent = resolutionState.advantageSpent;
      data.defenderAdvantage = resolutionState.defenderAdvantage;
    }
  }
}

function _finalizeResolvedContext(data, { resolved = true } = {}) {
  data.context = data.context ?? {};
  if (resolved) {
    data.status = "resolved";
    data.context.phase = "resolved";
    if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
    _cleanupAutoRollContext(data.context);
  }
}

async function _applySkillTestMutation(message, newResult, extraContext = {}) {
  const update = {
    [`flags.${SYSTEM_ID}.skillTest.isSuccess`]: newResult.isSuccess,
    [`flags.${SYSTEM_ID}.skillTest.degree`]: newResult.degree,
    [`flags.${SYSTEM_ID}.skillTest.textual`]: newResult.textual ?? `${newResult.degree} ${newResult.isSuccess ? "DoS" : "DoF"}`,
  };
  if (extraContext.luckUsed !== undefined) update[`flags.${SYSTEM_ID}.luckUsedOnTest`] = Boolean(extraContext.luckUsed);
  if (extraContext.luckBurned !== undefined) update[`flags.${SYSTEM_ID}.luckBurned`] = Boolean(extraContext.luckBurned);
  if (extraContext.rerollUsed !== undefined) update[`flags.${SYSTEM_ID}.reroll.used`] = Boolean(extraContext.rerollUsed);
  if (extraContext.rerollSource !== undefined) update[`flags.${SYSTEM_ID}.reroll.source`] = String(extraContext.rerollSource);
  return requestUpdateChatMessage(message, update);
}

async function _applyCombatMutation(message, side, newResult, extraContext, classifyMessage) {
  const live = _getLiveMessage(message);
  const raw = live?.flags?.[SYSTEM_ID]?.opposed;
  if (!raw) return false;
  const data = cloneFlagState(raw);
  if (side.role === "attacker") {
    data.attacker.result = newResult;
  } else {
    const defender = _getDefenderEntries(data)[side.defenderIndex ?? 0] ?? null;
    if (!defender) return false;
    defender.result = newResult;
  }

  const affectedDefenders = _getCombatAffectedDefenders(data, side);
  if (!affectedDefenders.length) return false;
  for (const defender of affectedDefenders) {
    _resetCombatLane(data, defender);
    if (!data.attacker?.result || !defender?.result) continue;
    const baseOutcome = resolveOutcomeRAW(data, defender);
    const outcome = applyAoEEvadeOutcome(data, baseOutcome, defender);
    _setDefenderOutcome(data, defender, outcome);
    _setDefenderAdvantage(data, defender, computeAdvantageRAW(data, outcome, defender));
  }
  _applyExtraContext(data, extraContext);
  const allResolved = _getDefenderEntries(data).every((defender) => Boolean(_getDefenderOutcome(data, defender)));
  _finalizeResolvedContext(data, { resolved: allResolved });
  await updateCombatCard(live, data, renderCombatCard);
  return _didPersistResult(live, "combatOpposed", side, newResult, classifyMessage);
}

function _skillOpposedUnsafe(data) {
  const specialActionId = String(data?.specialActionContext?.id ?? data?.specialActionId ?? "").trim();
  return Boolean(specialActionId && data?.status === "resolved");
}

async function _applySkillOpposedMutation(message, side, newResult, extraContext, classifyMessage) {
  const live = _getLiveMessage(message);
  const raw = live?.flags?.[SYSTEM_ID]?.skillOpposed;
  if (!raw) return false;
  const data = cloneFlagState(raw.state ?? raw);
  if (side.role === "attacker") data.attacker.result = newResult;
  else if (data.defender) data.defender.result = newResult;
  else return false;

  data.outcome = null;
  data.context = data.context ?? {};
  if (data.context.rollOff) delete data.context.rollOff;
  if (data.context.resolvedAt) delete data.context.resolvedAt;

  if (data.attacker?.result && data.defender?.result) {
    data.outcome = resolveSkillOutcome(data);
    await resolveSkillRollOff({
      message: live,
      data,
      attacker: resolveSkillActor(data.attacker.actorUuid),
      defender: resolveSkillActor(data.defender.actorUuid),
    });
    data.status = "resolved";
    data.context.phase = "resolved";
    if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
  } else {
    data.status = "pending";
    data.context.phase = "resolving";
  }

  _applyExtraContext(data, extraContext);
  await updateSkillOpposedCard(live, data);
  return _didPersistResult(live, "skillOpposed", side, newResult, classifyMessage);
}

async function _applyCharOpposedMutation(message, side, newResult, extraContext, classifyMessage) {
  const live = _getLiveMessage(message);
  const raw = live?.flags?.[SYSTEM_ID]?.charOpposed;
  if (!raw) return false;
  const data = cloneFlagState(raw.state ?? raw);
  if (side.role === "attacker") data.attacker.result = newResult;
  else if (data.defender) data.defender.result = newResult;
  else return false;

  data.outcome = null;
  data.context = data.context ?? {};
  if (data.context.rollOff) delete data.context.rollOff;
  if (data.context.resolvedAt) delete data.context.resolvedAt;

  if (data.attacker?.result && data.defender?.result) {
    data.outcome = resolveCharOutcome(data);
    await resolveCharRollOff({
      message: live,
      data,
      attacker: resolveCharActor(data.attacker.actorUuid),
      defender: resolveCharActor(data.defender.actorUuid),
    });
    data.status = "resolved";
    data.context.phase = "resolved";
    if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
  } else {
    data.status = "pending";
    data.context.phase = "resolving";
  }

  _applyExtraContext(data, extraContext);
  await updateCharOpposedCard(live, data);
  return _didPersistResult(live, "charOpposed", side, newResult, classifyMessage);
}

function _getMagicAffectedDefenders(data, side) {
  const defenders = getMagicDefenderEntries(data);
  if (side?.role === "attacker") return defenders;
  const idx = side?.defenderIndex ?? 0;
  return defenders[idx] ? [defenders[idx]] : [];
}

function _magicLaneHasTerminalState(data, defender) {
  if (!defender) return false;
  const damage = getMagicDefenderDamage(data, defender);
  if (damage?.rolled === true || damage?.applied === true) return true;
  const outcome = getMagicDefenderOutcome(data, defender);
  if (outcome?.needsBlockResolution === false && damage) return true;
  return false;
}

function _resetMagicLane(data, defender) {
  setMagicDefenderOutcome(data, defender, null);
  const damage = getMagicDefenderDamage(data, defender);
  if (damage && damage.rolled !== true && damage.applied !== true) setMagicDefenderDamage(data, defender, null);
  delete defender?.aoeEvadeEscaped;
  delete defender?.aoeEvadeFailed;
}

async function _applyMagicOpposedMutation(message, side, newResult, extraContext, classifyMessage) {
  const live = _getLiveMessage(message);
  const raw = live?.flags?.[SYSTEM_ID]?.magicOpposed;
  if (!raw) return false;
  const data = cloneFlagState(raw.state ?? raw);
  if (side.role === "attacker") data.attacker.result = newResult;
  else {
    const defender = getMagicDefenderEntries(data)[side.defenderIndex ?? 0] ?? null;
    if (!defender) return false;
    defender.result = newResult;
  }

  const affectedDefenders = _getMagicAffectedDefenders(data, side);
  if (!affectedDefenders.length) return false;

  const attacker = resolveMagicActor(data.attacker?.actorUuid) ?? null;
  if (!attacker) return false;
  const spell = data.attacker?.spellUuid ? await fromUuid(data.attacker.spellUuid) : null;
  if (!spell) return false;

  for (const defenderEntry of affectedDefenders) {
    _resetMagicLane(data, defenderEntry);
    const defender = resolveMagicActor(defenderEntry.actorUuid) ?? null;
    if (!defender) return false;
    const { defenderIndex } = selectMagicDefenderEntry(data, { defenderActorUuid: defenderEntry.actorUuid, defenderTokenUuid: defenderEntry.tokenUuid });
    await resolveMagicOutcome({
      message: live,
      data,
      attacker,
      defender,
      defenderEntry,
      spell,
      defenderIndex,
      isAoE: Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE),
      forcedHitLocation: String(data?.context?.forcedHitLocation ?? "").trim(),
      _updateCard: async () => {},
      skipAttackerSideEffects: true,
    });
  }

  _applyExtraContext(data, extraContext);
  data.context = data.context ?? {};
  data.status = "resolved";
  data.context.phase = "resolved";
  if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
  await updateMagicCard(live, data, renderMagicCard);
  return _didPersistResult(live, "magicOpposed", side, newResult, classifyMessage);
}

export function canMutateLuckResult(message, info, side, { classifyMessage } = {}) {
  const classify = classifyMessage ?? (() => null);
  const { liveInfo, liveSide } = _resolveLiveSide(message, info, side, classify);
  if (!liveInfo || !liveSide) return { ok: false, reason: "Test state could not be resolved." };
  if (!liveSide.result) return { ok: false, reason: "This side has no result to modify." };

  switch (liveInfo.type) {
    case "skillTest":
      return { ok: true, reason: "" };
    case "combatOpposed": {
      const raw = _getLiveMessage(message)?.flags?.[SYSTEM_ID]?.opposed;
      if (!raw) return { ok: false, reason: "Combat card state unavailable." };
      const data = cloneFlagState(raw);
      const affected = _getCombatAffectedDefenders(data, liveSide);
      if (affected.some((defender) => _combatLaneHasTerminalState(data, defender))) {
        return { ok: false, reason: "Luck can no longer modify this combat card because downstream resolution has already been consumed." };
      }
      return { ok: true, reason: "" };
    }
    case "skillOpposed": {
      const raw = _getLiveMessage(message)?.flags?.[SYSTEM_ID]?.skillOpposed;
      const data = raw ? cloneFlagState(raw.state ?? raw) : null;
      if (!data) return { ok: false, reason: "Skill opposed state unavailable." };
      if (_skillOpposedUnsafe(data)) {
        return { ok: false, reason: "Luck is blocked after this special-action opposed result has resolved." };
      }
      return { ok: true, reason: "" };
    }
    case "charOpposed":
      return { ok: true, reason: "" };
    case "magicOpposed": {
      const raw = _getLiveMessage(message)?.flags?.[SYSTEM_ID]?.magicOpposed;
      if (!raw) return { ok: false, reason: "Magic card state unavailable." };
      const data = cloneFlagState(raw.state ?? raw);
      const affected = _getMagicAffectedDefenders(data, liveSide);
      if (affected.some((defender) => _magicLaneHasTerminalState(data, defender))) {
        return { ok: false, reason: "Luck can no longer modify this spell because damage or effects have already advanced." };
      }
      return { ok: true, reason: "" };
    }
    default:
      return { ok: false, reason: "Unsupported card type." };
  }
}

export async function applyLuckResultMutation(message, info, side, newResult, { extraContext = {}, classifyMessage } = {}) {
  if (!message || !info || !side || !newResult) return false;
  const guard = canMutateLuckResult(message, info, side, { classifyMessage });
  if (!guard.ok) {
    ui.notifications?.warn?.(guard.reason || "This test can no longer be modified by Luck.");
    return false;
  }

  switch (info.type) {
    case "skillTest":
      return _applySkillTestMutation(message, newResult, extraContext);
    case "combatOpposed":
      return _applyCombatMutation(message, side, newResult, extraContext, classifyMessage);
    case "skillOpposed":
      return _applySkillOpposedMutation(message, side, newResult, extraContext, classifyMessage);
    case "charOpposed":
      return _applyCharOpposedMutation(message, side, newResult, extraContext, classifyMessage);
    case "magicOpposed":
      return _applyMagicOpposedMutation(message, side, newResult, extraContext, classifyMessage);
    default:
      return false;
  }
}
