import { isDebugEnabled } from "../../utils/debug.js";
import { SYSTEM_ID } from "../system/namespace.js";
import { AUTOMATION_DEFAULTS } from "../config/automation-policy.js";

const DIAG_PREFIX = "[UESRPG][AttackTracker][Diag]";
const MAX_RECENT_EVENTS = 20;
const _recentEvents = [];
const _actorTraceHints = new Map();

function _normalizeString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function _normalizeActorRef(actor) {
  if (!actor) return null;
  return {
    uuid: _normalizeString(actor?.uuid),
    id: _normalizeString(actor?.id),
    name: _normalizeString(actor?.name),
  };
}

function _buildConsoleRow(entry) {
  return {
    eventType: entry?.eventType ?? null,
    attackTraceId: entry?.attackTraceId ?? null,
    phase: entry?.phase ?? null,
    attackMode: entry?.attackMode ?? null,
    sourceTag: entry?.sourceTag ?? null,
    type: entry?.type ?? null,
    source: entry?.source ?? null,
    reason: entry?.reason ?? null,
    updateMode: entry?.updateMode ?? null,
    resolutionSource: entry?.resolutionSource ?? null,
    authorityState: entry?.authorityState ?? null,
    ambiguityState: entry?.ambiguityState ?? null,
    explicitTokenUuid: entry?.explicitTokenUuid ?? null,
    combatantId: entry?.combatantId ?? null,
    sourceActor: entry?.sourceActor?.uuid ?? null,
    resolvedActor: entry?.resolvedActor?.uuid ?? null,
    combatantActor: entry?.combatantActor?.uuid ?? null,
    trackerDocument: entry?.trackerDocument?.uuid ?? entry?.details?.trackerDocumentUuid ?? null,
    sheetActor: entry?.sheetActor?.uuid ?? null,
    sheetTrackedActor: entry?.sheetTrackedActor?.uuid ?? null,
    renderedCurrent: entry?.renderedCurrent ?? null,
    renderedMax: entry?.renderedMax ?? null,
    rawCurrent: entry?.details?.rawCurrent ?? null,
    rawMax: entry?.details?.rawMax ?? null,
    overrideCurrent: entry?.details?.overrideCurrent ?? null,
    overrideMax: entry?.details?.overrideMax ?? null,
    matched: entry?.matched ?? null,
    combatId: entry?.combatId ?? null,
    round: entry?.round ?? null,
    turn: entry?.turn ?? null,
  };
}

function _hasActorMismatch(entry) {
  const sourceActorUuid = String(entry?.sourceActor?.uuid ?? "").trim();
  const resolvedActorUuid = String(entry?.resolvedActor?.uuid ?? "").trim();
  const combatantActorUuid = String(entry?.combatantActor?.uuid ?? "").trim();
  const sheetActorUuid = String(entry?.sheetActor?.uuid ?? "").trim();
  const sheetTrackedActorUuid = String(entry?.sheetTrackedActor?.uuid ?? "").trim();

  const sourceVsResolved = sourceActorUuid && resolvedActorUuid && sourceActorUuid !== resolvedActorUuid;
  const resolvedVsCombatant = resolvedActorUuid && combatantActorUuid && resolvedActorUuid !== combatantActorUuid;
  const sheetVsTracked = sheetActorUuid && sheetTrackedActorUuid && sheetActorUuid !== sheetTrackedActorUuid;
  const resolvedVsSheetTracked = resolvedActorUuid && sheetTrackedActorUuid && resolvedActorUuid !== sheetTrackedActorUuid;
  const unmatchedSheetRefresh = entry?.type === "sheet-refresh" && entry?.matched === false;
  const ambiguousSheetAuthority = String(entry?.ambiguityState ?? "") === "unlinked-ambiguous";

  return sourceVsResolved || resolvedVsCombatant || sheetVsTracked || resolvedVsSheetTracked || unmatchedSheetRefresh || ambiguousSheetAuthority;
}

function _consoleLog(kind, payload) {
  if (!isDebugEnabled("effectsProxyDebug")) return;
  const method = kind === "mismatch" ? console?.warn : console?.log;
  if (typeof method !== "function") return;
  try {
    method(DIAG_PREFIX, kind, payload);
  } catch (_e) {
    /* no-op */
  }
}

function _readSettingIfRegistered(key, fallback = null) {
  try {
    const settingKey = `${SYSTEM_ID}.${String(key ?? "").trim()}`;
    if (game?.settings?.settings?.has?.(settingKey) !== true) return fallback;
    return game.settings.get(SYSTEM_ID, key);
  } catch (_e) {
    return fallback;
  }
}

function _buildPolicySnapshot() {
  return {
    automationProfileRegistered: game?.settings?.settings?.has?.(`${SYSTEM_ID}.automationProfile`) === true,
    automationProfileStoredValue: _readSettingIfRegistered("automationProfile", null),
    skipAttackTrackerEagerReset: Boolean(
      _readSettingIfRegistered("skipAttackTrackerEagerReset", AUTOMATION_DEFAULTS.skipAttackTrackerEagerReset)
    ),
    useCombatBoundaryOrchestrator: Boolean(
      _readSettingIfRegistered("useCombatBoundaryOrchestrator", AUTOMATION_DEFAULTS.useCombatBoundaryOrchestrator)
    ),
    compositeBoundaryTickEnabled: Boolean(
      _readSettingIfRegistered("compositeBoundaryTickEnabled", AUTOMATION_DEFAULTS.compositeBoundaryTickEnabled)
    ),
    deferNonCriticalRoundBoundaryWork: Boolean(
      _readSettingIfRegistered("deferNonCriticalRoundBoundaryWork", AUTOMATION_DEFAULTS.deferNonCriticalRoundBoundaryWork)
    ),
    enableActionEconomyUI: _readSettingIfRegistered("enableActionEconomyUI", null),
    actionPointAutomation: _readSettingIfRegistered("actionPointAutomation", null),
    dynamicInitiativeEnabled: _readSettingIfRegistered("dynamicInitiativeEnabled", null),
  };
}

function _rememberTraceHint(normalized) {
  const traceId = _normalizeString(normalized?.attackTraceId);
  if (!traceId) return;
  for (const actor of [
    normalized?.sourceActor,
    normalized?.resolvedActor,
    normalized?.combatantActor,
    normalized?.sheetActor,
    normalized?.sheetTrackedActor,
  ]) {
    const uuid = _normalizeString(actor?.uuid);
    if (!uuid) continue;
    _actorTraceHints.set(uuid, traceId);
  }
}

function _recoverTraceHint(entry = {}) {
  const explicit = _normalizeString(entry?.attackTraceId);
  if (explicit) return explicit;
  for (const actor of [
    entry?.sourceActor,
    entry?.resolvedActor,
    entry?.combatantActor,
    entry?.sheetActor,
    entry?.sheetTrackedActor,
  ]) {
    const uuid = _normalizeString(actor?.uuid);
    if (!uuid) continue;
    const hinted = _actorTraceHints.get(uuid);
    if (hinted) return hinted;
  }
  return null;
}

export function createAttackTraceId(prefix = "attack") {
  const safePrefix = _normalizeString(prefix) ?? "attack";
  const randomId = String(foundry?.utils?.randomID?.() ?? Date.now()).trim();
  return `${safePrefix}:${randomId}`;
}

export function recordAttackTrackerDiagnostic(entry = {}) {
  const normalized = {
    timestamp: Date.now(),
    eventType: _normalizeString(entry?.eventType) ?? "attack-tracker",
    attackTraceId: null,
    phase: _normalizeString(entry?.phase),
    attackMode: _normalizeString(entry?.attackMode),
    sourceTag: _normalizeString(entry?.sourceTag),
    type: _normalizeString(entry?.type) ?? "event",
    source: _normalizeString(entry?.source),
    reason: _normalizeString(entry?.reason),
    updateMode: _normalizeString(entry?.updateMode),
    matched: typeof entry?.matched === "boolean" ? entry.matched : null,
    resolutionSource: _normalizeString(entry?.resolutionSource),
    authorityState: _normalizeString(entry?.authorityState),
    ambiguityState: _normalizeString(entry?.ambiguityState),
    sourceActor: _normalizeActorRef(entry?.sourceActor),
    resolvedActor: _normalizeActorRef(entry?.resolvedActor),
    fallbackActor: _normalizeActorRef(entry?.fallbackActor),
    combatantActor: _normalizeActorRef(entry?.combatantActor),
    trackerDocument: _normalizeActorRef(entry?.trackerDocument),
    sheetActor: _normalizeActorRef(entry?.sheetActor),
    sheetTrackedActor: _normalizeActorRef(entry?.sheetTrackedActor),
    explicitTokenUuid: _normalizeString(entry?.explicitTokenUuid),
    combatantId: _normalizeString(entry?.combatantId),
    combatId: _normalizeString(entry?.combatId),
    round: Number.isFinite(Number(entry?.round)) ? Number(entry.round) : null,
    turn: Number.isFinite(Number(entry?.turn)) ? Number(entry.turn) : null,
    renderedCurrent: Number.isFinite(Number(entry?.renderedCurrent ?? entry?.details?.renderedCurrent))
      ? Number(entry?.renderedCurrent ?? entry?.details?.renderedCurrent)
      : null,
    renderedMax: Number.isFinite(Number(entry?.renderedMax ?? entry?.details?.renderedMax))
      ? Number(entry?.renderedMax ?? entry?.details?.renderedMax)
      : null,
    details: entry?.details && typeof entry.details === "object"
      ? foundry.utils.deepClone(entry.details)
      : null,
    policy: entry?.policy && typeof entry.policy === "object"
      ? foundry.utils.deepClone(entry.policy)
      : _buildPolicySnapshot(),
  };
  normalized.attackTraceId = _recoverTraceHint({ ...normalized, ...entry });
  _rememberTraceHint(normalized);

  _recentEvents.unshift(normalized);
  if (_recentEvents.length > MAX_RECENT_EVENTS) _recentEvents.length = MAX_RECENT_EVENTS;
  _consoleLog("event", normalized);
  _consoleLog("row", _buildConsoleRow(normalized));
  if (_hasActorMismatch(normalized)) {
    _consoleLog("mismatch", _buildConsoleRow(normalized));
  }
  return normalized;
}

export function getRecentAttackTrackerDiagnostics({ limit = MAX_RECENT_EVENTS } = {}) {
  const count = Math.max(0, Number(limit) || 0);
  return _recentEvents.slice(0, count).map((entry) => foundry.utils.deepClone(entry));
}
