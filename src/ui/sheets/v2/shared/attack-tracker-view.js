import { AttackTracker } from "../../../../core/combat/attack-tracker.js";
import { isActorInStartedCombatEncounter } from "../../../../core/combat/combat-scope.js";
import { recordAttackTrackerDiagnostic } from "../../../../core/combat/attack-tracker-diagnostics.js";
import { isDebugEnabled } from "../../../../utils/debug.js";
import { buildSheetAttackTrackerContext } from "./attack-tracker-sheet-context.js";

function _buildTrackerViewDiagnosticPayload({
  sheet,
  actor,
  trackerContext,
  trackedActor,
  view,
  trackerState,
} = {}) {
  return {
    type: "sheet-view",
    source: "sheet-combat-tab",
    sourceTag: "sheet-combat-tab",
    reason: "rendered-tracker-view",
    eventType: "attack-render",
    attackTraceId: trackerContext?.attackTraceId ?? null,
    phase: "sheet-view-build",
    attackMode: trackerContext?.attackMode ?? null,
    sourceActor: actor ?? null,
    resolvedActor: trackedActor ?? null,
    trackerDocument: trackerContext?.trackerOwner ?? trackerContext?.trackerDocument ?? trackedActor ?? null,
    combatantActor: trackerContext?.combatantActor ?? null,
    sheetActor: actor ?? null,
    sheetTrackedActor: trackedActor ?? null,
    resolutionSource: trackerContext?.resolutionSource ?? null,
    authorityState: trackerContext?.authorityState ?? null,
    ambiguityState: trackerContext?.ambiguityState ?? null,
    explicitTokenUuid: trackerContext?.tokenUuid ?? null,
    combatantId: trackerContext?.combatantId ?? null,
    combatId: trackerContext?.combat?.id ?? game?.combat?.id ?? null,
    round: game?.combat?.round ?? null,
    turn: game?.combat?.turn ?? null,
    details: {
      sheetClass: String(sheet?.constructor?.name ?? ""),
      renderedCurrent: Number(view?.current ?? 0) || 0,
      renderedMax: Number(view?.max ?? 0) || 0,
      trackedActorUuid: String(view?.trackedActorUuid ?? ""),
      sourceActorUuid: String(view?.sourceActorUuid ?? ""),
      tokenUuid: String(view?.tokenUuid ?? ""),
      combatantId: String(view?.combatantId ?? ""),
      authoritative: Boolean(view?.authoritative),
      authorityState: String(view?.authorityState ?? ""),
      trackerDocumentUuid: String(trackerContext?.trackerOwner?.uuid ?? trackerContext?.trackerDocument?.uuid ?? trackedActor?.uuid ?? ""),
      rawCurrent: Number(trackerState?.rawCurrent ?? 0) || 0,
      rawTurnCurrent: Number(trackerState?.rawTurnCurrent ?? 0) || 0,
      rawMax: trackerState?.rawMax ?? null,
      overrideCurrent: trackerState?.rawOverrideCurrent ?? null,
      overrideMax: trackerState?.rawOverrideMax ?? null,
      lastResetRound: Number(trackerState?.rawLastResetRound ?? 0) || 0,
      lastResetTurn: Number(trackerState?.rawLastResetTurn ?? 0) || 0,
    }
  };
}

export function buildCombatTabAttackTrackerView(sheet, actor, { emitDiagnostics = false } = {}) {
  const trackerContext = buildSheetAttackTrackerContext(sheet, actor);
  const trackerState = AttackTracker.getTrackerViewState(actor, {}, trackerContext);
  const trackedActor = trackerState?.trackedActor ?? trackerContext?.combatantActor ?? actor ?? null;
  const inStartedCombat = isActorInStartedCombatEncounter(trackedActor, {
    combat: trackerContext?.combat ?? game?.combat ?? null,
    tokenUuid: trackerContext?.tokenUuid ?? null,
    combatantId: trackerContext?.combatantId ?? null
  });
  const view = {
    current: trackerState.current,
    max: trackerState.max,
    overrides: trackerState.overrides,
    authoritative: inStartedCombat && trackerContext.authoritative !== false,
    authorityState: inStartedCombat ? (trackerContext.authorityState ?? "actor-fallback") : "out-of-combat",
    ambiguityState: trackerContext.ambiguityState ?? "none",
    notice: inStartedCombat ? (trackerContext.notice ?? null) : null,
    trackedActorUuid: String(trackedActor?.uuid ?? "").trim() || null,
    sourceActorUuid: String(actor?.uuid ?? "").trim() || null,
    tokenUuid: String(trackerContext?.tokenUuid ?? "").trim() || null,
    combatantId: String(trackerContext?.combatantId ?? "").trim() || null,
  };

  if (emitDiagnostics && isDebugEnabled("effectsProxyDebug")) {
    recordAttackTrackerDiagnostic(_buildTrackerViewDiagnosticPayload({
      sheet,
      actor,
      trackerContext,
      trackedActor,
      view,
      trackerState,
    }));
  }

  return {
    trackerContext,
    trackedActor,
    view,
  };
}
