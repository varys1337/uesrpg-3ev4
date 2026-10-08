import { getDefenderCommitAvailability } from "../../../opposed/shared/defense-availability.js";
/**
 * src/core/combat/opposed/cards/renderers.js
 * Top-level card rendering functions for opposed combat workflows.
 * Extracted from opposed-workflow.js for maintainability.
 * 
 * This module orchestrates card template helpers to build complete HTML cards.
 */

import {
  _renderRollLine,
  _renderTNLine,
  _buildAttackerStatusLine,
  _buildDefenderStatusLine,
  _buildAttackerActions,
  _buildDefenderActions,
  _buildOutcomeLine,
  _buildResolutionDetails,
  _buildResolvedActions,
  _buildDamagePanel
} from "./template-helpers.js";
import { AttackTracker } from "../../attack-tracker.js";
import { isActorInStartedCombatEncounter } from "../../combat-scope.js";
import { canAttackerRoll } from "../actions/eligibility.js";
import { _resolveActor, _resolveActorViaToken } from "../helpers/docs.js";
import { _isBankAutoRollInProgress } from "../banking/state.js";
import { getPendingAttackApCost } from "../helpers/workflow.js";
import { t } from "../../../../utils/i18n.js";
import { renderOpposedLayout, renderOpposedParticipant, renderParticipantContext, renderUnavailableCommitNotice, renderAutomaticNoDefenseNotice } from "../../../opposed/shared/card-rendering.js";

function _attackerTestLabel(value) {
  const raw = String(value ?? t("UESRPG.Chat.Opposed.Attack", "Attack")).trim();
  const stripped = raw.replace(/^attack\s*-\s*/i, "").trim();
  return _shortenTestLabel(stripped || t("UESRPG.Chat.Opposed.Attack", "Attack"));
}

function _isHybridWarfareDefender(data, defender) {
  return Boolean(
    data?.context?.hybrid?.enabled
    && String(defender?.combatDomain ?? data?.context?.hybrid?.defenderDomain ?? "").toLowerCase() === "warfare"
  );
}

/**
 * Shorten verbose test labels for compact chat card display.
 * @param {string} value - Test label value
 * @returns {string} - Shortened label
 */
function _shortenTestLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;
  // Remove "(Profession)" suffix for combat skills (NPCs)
  const shortened = raw.replace(/\s*\(\s*profession\s*\)\s*/ig, "");
  return shortened || raw;
}

function _collectAdvantageMarkers(data) {
  const source = Array.isArray(data?.context?.advantageMarkers) ? data.context.advantageMarkers : [];
  const seen = new Set();
  const markers = [];

  source.forEach((marker, index) => {
    if (!marker || typeof marker !== "object") return;
    const explicitKey = String(marker.key ?? "").trim();
    const fallbackKey = [marker.kind, marker.actorUuid, marker.tokenUuid, marker.label]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(":");
    const renderKey = explicitKey || fallbackKey || `legacy:${index}`;
    if (seen.has(renderKey)) return;
    seen.add(renderKey);
    markers.push({ marker, renderKey });
  });

  return markers;
}

function _takeAdvantageMarkers(markers, participant, consumed) {
  const actorUuid = String(participant?.actorUuid ?? "").trim();
  const tokenUuid = String(participant?.tokenUuid ?? "").trim();
  if (!actorUuid && !tokenUuid) return [];

  const matches = [];
  for (const entry of markers) {
    if (consumed.has(entry.renderKey)) continue;
    const markerActorUuid = String(entry.marker?.actorUuid ?? "").trim();
    const markerTokenUuid = String(entry.marker?.tokenUuid ?? "").trim();
    const sameToken = markerTokenUuid && tokenUuid && markerTokenUuid === tokenUuid;
    const sameActor = (!markerTokenUuid || !tokenUuid)
      && markerActorUuid
      && actorUuid
      && markerActorUuid === actorUuid;
    if (!sameToken && !sameActor) continue;
    consumed.add(entry.renderKey);
    matches.push(entry);
  }
  return matches;
}

function _renderAdvantageMarkers(markers) {
  if (!markers.length) return "";
  return `<div class="uesrpg-chat-status-row">
    ${markers.map(({ marker }) => `<span class="uesrpg-chat-status-badge"><i class="fa-solid fa-check" aria-hidden="true"></i><span>${foundry.utils.escapeHTML(String(marker.label ?? t("UESRPG.Chat.Opposed.AdvantageResolved", "Advantage Resolved")))}</span></span>`).join("")}
  </div>`;
}

function _getAttackerTrackerContext(data, attacker) {
  const explicitTokenUuid = String(data?.attacker?.tokenUuid ?? attacker?.token?.document?.uuid ?? attacker?.token?.uuid ?? "").trim();
  return {
    combatantId: String(data?.attacker?.combatantId ?? "").trim() || null,
    tokenUuid: explicitTokenUuid || null,
    source: "combat-opposed-card",
    sourceTag: "combat-opposed-card",
    attackTraceId: String(data?.context?.attackTraceId ?? "").trim() || null,
    attackMode: String(data?.context?.attackMode ?? "").trim().toLowerCase() || "melee",
    phase: "render-gate"
  };
}

function _getAttackerCommitGate(data) {
  const attacker = _resolveActorViaToken(data?.attacker?.actorUuid, data?.attacker?.tokenUuid);
  if (!attacker) return { allowed: false, reason: t("UESRPG.Chat.Opposed.AttackerUnavailable", "Attacker unavailable") };

  const eligibility = canAttackerRoll(attacker, data?.context ?? {});
  if (!eligibility?.allowed) {
    return { allowed: false, reason: String(eligibility?.reason ?? "Unavailable") };
  }

  const trackerContext = _getAttackerTrackerContext(data, attacker);
  if (!isActorInStartedCombatEncounter(attacker, {
    combat: trackerContext?.combat ?? game?.combat ?? null,
    tokenUuid: trackerContext?.tokenUuid ?? null,
    combatantId: trackerContext?.combatantId ?? null
  })) return { allowed: true };

  const baseApCost = getPendingAttackApCost(data);
  const currentAP = Number(foundry.utils.getProperty(attacker, "system.action_points.value") ?? 0);
  if (currentAP < baseApCost) {
    return { allowed: false, reason: `${currentAP}/${baseApCost} AP` };
  }

  const attackMode = String(data?.context?.attackMode ?? "").toLowerCase();
  if (AttackTracker.hasExceededLimit(attacker, { attackMode }, trackerContext)) {
    return {
      allowed: false,
      reason: AttackTracker.getLimitWarning(attacker, { attackMode }, trackerContext)
        || t("UESRPG.Chat.Opposed.AttackLimitReached", "Attack limit reached")
    };
  }

  return { allowed: true };
}

function _getDefenderCommitGate(data, defenderData, messageId) {
  return getDefenderCommitAvailability({ data, defenderData, messageId });
}

/**
 * Render multi-defender opposed combat card.
 * 
 * @param {Object} data - Opposed workflow data.
 * @param {string} messageId - Chat message ID.
 * @param {Object} helpers - Helper functions object.
 * @param {Function} helpers._getDefenderEntries - Get defenders array.
 * @param {Function} helpers._isBankChoicesEnabledForData - Check if banking enabled.
 * @param {Function} helpers._anyActiveGMOnline - Check if GM online.
 * @param {Function} helpers._getBankCommitState - Get commit state.
 * @param {Function} helpers._getDefenderOutcome - Get defender outcome.
 * @param {Function} helpers._getDefenderAdvantage - Get defender advantage.
 * @param {Function} helpers._getDefenderResolutionState - Get resolution state.
 * @param {Function} helpers._allDefendersCommitted - Check if all committed.
 * @param {Function} helpers._isMultiDefender - Check if multi-defender.
 * @returns {string} - HTML string for multi-defender card.
 */
export function renderMultiDefenderCard(data, messageId, helpers) {
  const {
    _getDefenderEntries,
    _isBankChoicesEnabledForData,
    _anyActiveGMOnline,
    _getBankCommitState,
    _getDefenderOutcome,
    _getDefenderAdvantage,
    _getDefenderResolutionState,
    _allDefendersCommitted,
    _isMultiDefender
  } = helpers;

  const defenders = _getDefenderEntries(data);
  const a = data.attacker ?? {};
  const showResolutionDetails = !!(game?.settings?.get?.("uesrpg-3ev4", "opposedShowResolutionDetails"));
  const bankMode = _isBankChoicesEnabledForData(data);
  const isAutoRolling = _isBankAutoRollInProgress(data);
  const anyGMOnline = _anyActiveGMOnline();
  const anyOutcome = defenders.some(d => d?.outcome);
  const { aCommitted } = _getBankCommitState(data, defenders[0] ?? null);
  // Keep banked choices mystified until the roll phase starts (or resolved).
  const revealAttacker = !bankMode || Boolean(a.result) || anyOutcome;
  const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
  const markers = _collectAdvantageMarkers(data);
  const consumedMarkerKeys = new Set();
  const attackerMarkerHtml = _renderAdvantageMarkers(_takeAdvantageMarkers(markers, a, consumedMarkerKeys));

  const baseA = Number(a.baseTarget ?? 0);
  const modA = Number(a.totalMod ?? 0);
  const finalA = baseA + modA;
  const aTargetLabel = (revealAttacker && a.hasDeclared === true)
    ? `${finalA}${modA ? ` (${modA >= 0 ? "+" : ""}${modA})` : ""}`
    : (revealAttacker ? `${baseA}` : "??");

  const aVariantText = (revealAttacker && a.hasDeclared)
      ? (a.variantLabel ?? t("UESRPG.Chat.Opposed.Attack", "Attack"))
    : "??";

  const aRollLine = _renderRollLine({ result: a.result, noDefense: false });
  const attackerCommitLine = _buildAttackerStatusLine({
    bankMode,
    anyOutcome,
    rolled: !!a.result,
    aCommitted
  });
  const attackerCommitGate = _getAttackerCommitGate(data);

  const attackerActions = _buildAttackerActions({
    attacker: a,
    bankMode,
    aCommitted,
    data,
    _safeGetSetting: helpers._safeGetSetting,
    commitGate: attackerCommitGate,
    isAutoRolling
  });

  const defenderBlocks = defenders.map((d, idx) => {
    const { dCommitted, bothCommitted } = _getBankCommitState(data, d);
    const revealDefender = !bankMode || Boolean(d.result) || Boolean(d.outcome);
    const outcome = _getDefenderOutcome(data, d);
    const advantage = _getDefenderAdvantage(data, d) ?? { attacker: 0, defender: 0 };
    const resolutionState = _getDefenderResolutionState(data, d);

    const dTargetLabel = (!revealDefender)
      ? "??"
      : (d.noDefense ? "0" : (d.targetLabel ?? (d.target ?? "??")));
    const dTestLabel = (!revealDefender)
      ? "??"
      : _shortenTestLabel(d.testLabel ?? t("UESRPG.Chat.Common.Choose", "(choose)"));
    const dDefenseLabel = (!revealDefender)
      ? "??"
      : (d.defenseLabel ?? d.label ?? t("UESRPG.Chat.Common.Choose", "(choose)"));

    const dRollLine = _renderRollLine({ result: d.result, noDefense: (d.noDefense === true) });
    const defenderCommitLine = _buildDefenderStatusLine({
      bankMode,
      outcome,
      rolled: !!d.result,
      dCommitted,
      noDefense: d.noDefense
    });
    const defenderMarkerHtml = _renderAdvantageMarkers(_takeAdvantageMarkers(markers, d, consumedMarkerKeys));

    const defenderCommitGate = _getDefenderCommitGate(data, d, messageId);
    const defenderActions = _buildDefenderActions({
      defender: d,
      bankMode,
      dCommitted,
      idx,
      data,
      _allDefendersCommitted,
      commitDefenseGate: defenderCommitGate,
      isAutoRolling
    });

    const allDefendersCommitted = _isMultiDefender(data) 
      ? _getDefenderEntries(data).every(def => {
          if (!def) return true;
          return Boolean(
            def?.banked?.committed === true ||
            def?.noDefense === true ||
            def?.defenseType != null ||
            def?.testLabel != null
          );
        })
      : dCommitted;

    const outcomeLine = bankMode && !outcome ? "" : _buildOutcomeLine({
      outcome,
      bankMode,
      bothCommitted,
      allDefendersCommitted,
      aCommitted: Boolean(data.attacker?.banked?.committed === true || data.attacker?.hasDeclared === true),
      anyGMOnline,
      data,
      isMulti: true
    });

    const resolutionDetails = _buildResolutionDetails({
      showResolutionDetails,
      outcome,
      attacker: a,
      defender: d,
      advantage
    });

    const damageData = d.damage ?? null;

    const resolvedActions = _buildResolvedActions({
      outcome,
      defender: d,
      advantage,
      resolutionState,
      idx,
      isAoE,
      status: null, // Multi-defender doesn't use top-level status
      damageData,
      allowDefenderAdvantage: !_isHybridWarfareDefender(data, d)
    });

    const damagePanel = _buildDamagePanel(damageData);
    return renderOpposedParticipant({
      role: "defender", defenderCard: true, name: d.tokenName ?? d.name,
      context: renderParticipantContext([
        { label: t("UESRPG.Chat.Common.Test", "Test"), value: dTestLabel },
        { label: t("UESRPG.Chat.Opposed.Defense", "Defense"), value: dDefenseLabel }
      ]),
      tn: _renderTNLine({ value: dTargetLabel, tnObj: revealDefender ? d.tn : null }),
      roll: dRollLine, status: renderAutomaticNoDefenseNotice(d) + defenderCommitLine + defenderMarkerHtml + renderUnavailableCommitNotice({ active: bankMode && !dCommitted && !d.result, gate: defenderCommitGate }), actions: defenderActions, compactActions: bankMode && !d.result,
      aftermath: outcomeLine + resolutionDetails + resolvedActions + damagePanel
    });
  }).join("");
  const unmatchedMarkerHtml = _renderAdvantageMarkers(markers.filter(({ renderKey }) => !consumedMarkerKeys.has(renderKey)));

  const attackerPanel = renderOpposedParticipant({
    name: a.tokenName ?? a.name,
    context: renderParticipantContext([
      { label: t("UESRPG.Chat.Common.Test", "Test"), value: revealAttacker ? _shortenTestLabel(_attackerTestLabel(a.label)) : "??" },
      { label: t("UESRPG.Chat.Opposed.Attack", "Attack"), value: aVariantText }
    ]),
    tn: _renderTNLine({ value: aTargetLabel, tnObj: revealAttacker ? a.tn : null }),
    roll: aRollLine, status: attackerCommitLine + attackerMarkerHtml + renderUnavailableCommitNotice({ active: bankMode && !aCommitted && !a.result, gate: attackerCommitGate, kind: "attack" }), actions: attackerActions, compactActions: bankMode && !a.result
  });
  return `<div class="ues-opposed-card uesrpg-chat-surface" data-message-id="${messageId}">
    ${renderOpposedLayout({ attacker: attackerPanel, defenders: defenderBlocks, after: (bankMode && defenders.some(d => !_getDefenderOutcome(data, d)) ? _buildOutcomeLine({ bankMode, bothCommitted: aCommitted && _allDefendersCommitted(data), allDefendersCommitted: defenders.every(d => d.banked?.committed || d.noDefense || d.result), aCommitted, data, isMulti: true }) : "") + unmatchedMarkerHtml })}
  </div>`;
}

/**
 * Render single-defender opposed combat card.
 * 
 * @param {Object} data - Opposed workflow data.
 * @param {string} messageId - Chat message ID.
 * @param {Object} helpers - Helper functions object.
 * @param {Function} helpers._isBankChoicesEnabledForData - Check if banking enabled.
 * @param {Function} helpers._getBankCommitState - Get commit state.
 * @param {Function} helpers._anyActiveGMOnline - Check if GM online.
 * @param {Function} helpers._allDefendersCommitted - Check if all committed.
 * @returns {string} - HTML string for single-defender card.
 */
export function renderSingleDefenderCard(data, messageId, helpers) {
  const {
    _isBankChoicesEnabledForData,
    _getBankCommitState,
    _anyActiveGMOnline,
    _allDefendersCommitted
  } = helpers;

  const a = data.attacker ?? {};
  const d = data.defender ?? {};
  // Single-defender cards use the same button payload format as multi-defender cards.
  // The handlers expect a numeric defender-index; in single-defender mode this is always 0.
  const idx = 0;

  const showResolutionDetails = !!(game?.settings?.get?.("uesrpg-3ev4", "opposedShowResolutionDetails"));

  const bankMode = _isBankChoicesEnabledForData(data);
  const isAutoRolling = _isBankAutoRollInProgress(data);
  const { aCommitted, dCommitted, bothCommitted } = _getBankCommitState(data);

  const anyGMOnline = _anyActiveGMOnline();
  const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
  const markers = _collectAdvantageMarkers(data);
  const consumedMarkerKeys = new Set();
  const attackerMarkerHtml = _renderAdvantageMarkers(_takeAdvantageMarkers(markers, a, consumedMarkerKeys));
  const defenderMarkerHtml = _renderAdvantageMarkers(_takeAdvantageMarkers(markers, d, consumedMarkerKeys));

  // Keep banked choices mystified until the roll phase starts (or resolved).
  const anyOutcome = data.status === "resolved" || !!data.outcome;
  const revealAttacker = !bankMode || Boolean(a.result) || anyOutcome;
  const revealDefender = !bankMode || Boolean(d.result) || anyOutcome;

  const baseA = Number(a.baseTarget ?? 0);
  const modA = Number(a.totalMod ?? 0);
  const finalA = baseA + modA;
  const aTargetLabel = (revealAttacker && a.hasDeclared === true)
    ? `${finalA}${modA ? ` (${modA >= 0 ? "+" : ""}${modA})` : ""}`
    : (revealAttacker ? `${baseA}` : "??");

  const aVariantText = (revealAttacker && a.hasDeclared)
    ? (a.variantLabel ?? t("UESRPG.Chat.Opposed.Attack", "Attack"))
    : "??";

  const dTargetLabel = (!revealDefender)
    ? "??"
    : (d.noDefense ? "0" : (d.targetLabel ?? (d.target ?? "??")));

  const dTestLabel = (!revealDefender)
    ? "??"
    : _shortenTestLabel(d.testLabel ?? t("UESRPG.Chat.Common.Choose", "(choose)"));

  const dDefenseLabel = (!revealDefender)
    ? "??"
    : (d.defenseLabel ?? d.label ?? t("UESRPG.Chat.Common.Choose", "(choose)"));

  // Roll summaries: use a single formatter for parity across banked and non-banked modes.
  const aRollLine = _renderRollLine({ result: a.result, noDefense: false });
  const dRollLine = _renderRollLine({ result: d.result, noDefense: (d.noDefense === true) });

  const attackerCommitLine = _buildAttackerStatusLine({
    bankMode,
    anyOutcome: (data.status === "resolved") || !!data.outcome,
    rolled: !!a.result,
    aCommitted
  });
  const attackerCommitGate = _getAttackerCommitGate(data);

  const defenderCommitLine = _buildDefenderStatusLine({
    bankMode,
    outcome: (data.status === "resolved") || !!data.outcome,
    rolled: !!d.result,
    dCommitted,
    noDefense: d.noDefense
  });

  const attackerActions = _buildAttackerActions({
    attacker: a,
    bankMode,
    aCommitted,
    data,
    _safeGetSetting: helpers._safeGetSetting,
    commitGate: attackerCommitGate,
    isAutoRolling
  });

  const defenderCommitGate = _getDefenderCommitGate(data, d, messageId);
  const defenderActions = _buildDefenderActions({
    defender: d,
    bankMode,
    dCommitted,
    idx,
    data,
    _allDefendersCommitted,
    commitDefenseGate: defenderCommitGate,
    isAutoRolling
  });

  const outcomeLine = _buildOutcomeLine({
    outcome: data.outcome,
    bankMode,
    bothCommitted,
    allDefendersCommitted: false, // Not used in single-defender mode
    aCommitted,
    anyGMOnline,
    data,
    isMulti: false
  });

  const resolutionDetails = _buildResolutionDetails({
    showResolutionDetails,
    outcome: data.outcome,
    attacker: a,
    defender: d,
    advantage: data.advantage ?? { attacker: 0, defender: 0 }
  });

  const damageData = data.damage ?? null;

  const resolvedActions = _buildResolvedActions({
    outcome: data.outcome,
    defender: d,
    advantage: data.advantage ?? { attacker: 0, defender: 0 },
    resolutionState: {
      defenderAdvantage: data.defenderAdvantage ?? {}
    },
    idx,
    isAoE,
    status: data.status,
    damageData,
    allowDefenderAdvantage: !_isHybridWarfareDefender(data, d)
  });

  const damagePanel = _buildDamagePanel(damageData);
  const unmatchedMarkerHtml = _renderAdvantageMarkers(markers.filter(({ renderKey }) => !consumedMarkerKeys.has(renderKey)));

  const attackerPanel = renderOpposedParticipant({
    name: a.tokenName ?? a.name,
    context: renderParticipantContext([
      { label: t("UESRPG.Chat.Common.Test", "Test"), value: revealAttacker ? _shortenTestLabel(_attackerTestLabel(a.label)) : "??" },
      { label: t("UESRPG.Chat.Opposed.Attack", "Attack"), value: aVariantText }
    ]),
    tn: _renderTNLine({ value: aTargetLabel, tnObj: revealAttacker ? a.tn : null }),
    roll: aRollLine, status: attackerCommitLine + attackerMarkerHtml + renderUnavailableCommitNotice({ active: bankMode && !aCommitted && !a.result, gate: attackerCommitGate, kind: "attack" }), actions: attackerActions, compactActions: bankMode && !a.result
  });
  const defenderPanel = renderOpposedParticipant({
    role: "defender", name: d.tokenName ?? d.name,
    context: renderParticipantContext([
      { label: t("UESRPG.Chat.Common.Test", "Test"), value: dTestLabel },
      { label: t("UESRPG.Chat.Opposed.Defense", "Defense"), value: dDefenseLabel }
    ]),
    tn: _renderTNLine({ value: dTargetLabel, tnObj: revealDefender ? d.tn : null }),
    roll: dRollLine, status: renderAutomaticNoDefenseNotice(d) + defenderCommitLine + defenderMarkerHtml + renderUnavailableCommitNotice({ active: bankMode && !dCommitted && !d.result, gate: defenderCommitGate }), actions: defenderActions, compactActions: bankMode && !d.result
  });
  return `<div class="ues-opposed-card uesrpg-chat-surface" data-message-id="${messageId}">
    ${renderOpposedLayout({ attacker: attackerPanel, defender: defenderPanel,
      after: outcomeLine + resolutionDetails + resolvedActions + damagePanel + unmatchedMarkerHtml })}
  </div>`;
}
