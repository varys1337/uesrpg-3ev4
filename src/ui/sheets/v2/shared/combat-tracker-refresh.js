import { resolveDamageUpdateTarget } from "../../../../core/combat/damage/post-application.js";
import { recordAttackTrackerDiagnostic } from "../../../../core/combat/attack-tracker-diagnostics.js";
import { buildSheetAttackTrackerContext } from "./attack-tracker-sheet-context.js";
import { resolveAttackTrackerActor } from "../../../../core/combat/attack-tracker-context.js";

function _str(value) {
  return String(value ?? "").trim();
}

function _sameActor(candidate, actor) {
  if (!candidate || !actor) return false;
  const candidateId = _str(candidate?.id);
  const candidateUuid = _str(candidate?.uuid);
  const actorId = _str(actor?.id);
  const actorUuid = _str(actor?.uuid);
  return (candidateId && actorId && candidateId === actorId)
    || (candidateUuid && actorUuid && candidateUuid === actorUuid);
}

function _collectSheetTargets(sheet) {
  const actor = sheet?.document ?? null;
  const trackerContext = buildSheetAttackTrackerContext(sheet, actor);
  const trackedActor = trackerContext?.trackerDocument ?? resolveAttackTrackerActor(actor, trackerContext) ?? resolveDamageUpdateTarget(actor) ?? actor ?? null;
  const actorIds = new Set();
  const actorUuids = new Set();

  for (const candidate of [actor, trackedActor]) {
    const id = String(candidate?.id ?? "").trim();
    const uuid = String(candidate?.uuid ?? "").trim();
    if (id) actorIds.add(id);
    if (uuid) actorUuids.add(uuid);
  }

  return { actor, trackedActor, trackerContext, actorIds, actorUuids };
}

function _clearSheetTrackerAuthorityHintIfStale(sheet, combat = game?.combat ?? null) {
  const hint = sheet?._uesrpgAttackTrackerAuthorityHint ?? null;
  if (!hint || typeof hint !== "object") return;
  const hintedCombatId = _str(hint.combatId);
  const currentCombatId = _str(combat?.id);
  if (hintedCombatId && currentCombatId && hintedCombatId !== currentCombatId) {
    sheet._uesrpgAttackTrackerAuthorityHint = null;
  }
}

function _updateSheetTrackerAuthorityHint(sheet, payload = {}) {
  if (!sheet || sheet?.token) return;

  const actor = sheet?.document ?? null;
  if (!actor) return;

  const candidates = [payload?.sourceActor, payload?.actor, payload?.combatantActor];
  const relatesToSheetActor = candidates.some((candidate) => _sameActor(candidate, actor));
  if (!relatesToSheetActor) return;

  const explicitTokenUuid = _str(payload?.explicitTokenUuid);
  const combatantId = _str(payload?.combatantId);
  const authorityState = _str(payload?.authorityState);
  const ambiguityState = _str(payload?.ambiguityState) || "none";
  const resolutionSource = _str(payload?.resolutionSource);
  const notice = _str(payload?.notice) || null;
  const combatId = _str(payload?.combatId) || _str(game?.combat?.id);

  if (!explicitTokenUuid && !combatantId && ambiguityState === "none") return;

  sheet._uesrpgAttackTrackerAuthorityHint = {
    actorUuid: _str(actor?.uuid) || null,
    combatId: combatId || null,
    tokenUuid: explicitTokenUuid || null,
    combatantId: combatantId || null,
    attackTraceId: _str(payload?.attackTraceId) || null,
    attackMode: _str(payload?.attackMode) || null,
    phase: _str(payload?.phase) || null,
    sourceTag: _str(payload?.sourceTag ?? payload?.sourceLabel) || null,
    authoritative: authorityState ? authorityState !== "actor-fallback" : ambiguityState === "none",
    authorityState: authorityState || null,
    ambiguityState,
    resolutionSource: resolutionSource || null,
    trackerDocumentUuid: _str(payload?.trackerDocument?.uuid) || _str(payload?.actor?.uuid) || _str(payload?.combatantActor?.uuid) || null,
    notice,
  };
}

function _isTrackedActorMatch(sheet, candidateActor) {
  if (!candidateActor) return false;
  const targets = _collectSheetTargets(sheet);
  const id = String(candidateActor?.id ?? "").trim();
  const uuid = String(candidateActor?.uuid ?? "").trim();
  return (id && targets.actorIds.has(id)) || (uuid && targets.actorUuids.has(uuid));
}

function _isSheetActorInCombat(sheet, combat = game?.combat ?? null) {
  if (!combat?.combatants?.size && !Array.isArray(combat?.combatants)) return false;
  const targets = _collectSheetTargets(sheet);
  for (const combatant of combat.combatants ?? []) {
    const candidateActor = combatant?.actor ?? null;
    const candidateId = String(candidateActor?.id ?? "").trim();
    const candidateUuid = String(candidateActor?.uuid ?? "").trim();
    if ((candidateId && targets.actorIds.has(candidateId)) || (candidateUuid && targets.actorUuids.has(candidateUuid))) {
      return true;
    }
  }
  return false;
}

async function _refreshCombatPart(sheet) {
  if (!sheet?.element || sheet?.document?.limited) return;
  sheet._uesrpgCombatCache = null;
  if (typeof sheet._queueRenderParts === "function") {
    await sheet._queueRenderParts(["combat"]);
    return;
  }
  await sheet.render({ parts: ["combat"] });
}

function _recordSheetRefreshDiagnostic(sheet, payload, matched) {
  const actor = sheet?.document ?? null;
  const trackerContext = buildSheetAttackTrackerContext(sheet, actor);
  const trackedActor = trackerContext?.trackerDocument ?? resolveAttackTrackerActor(actor, trackerContext) ?? resolveDamageUpdateTarget(actor) ?? actor ?? null;
  recordAttackTrackerDiagnostic({
    type: "sheet-refresh",
    source: payload?.sourceLabel ?? "sheet-refresh",
    reason: payload?.reason ?? "refresh",
    eventType: "attack-render",
    attackTraceId: payload?.attackTraceId ?? null,
    phase: payload?.phase ?? "sheet-refresh",
    attackMode: payload?.attackMode ?? null,
    sourceTag: payload?.sourceTag ?? payload?.sourceLabel ?? "sheet-refresh",
    matched,
    sourceActor: payload?.sourceActor ?? null,
    resolvedActor: payload?.actor ?? null,
    combatantActor: payload?.combatantActor ?? null,
    sheetActor: actor,
    sheetTrackedActor: trackedActor,
    resolutionSource: trackerContext?.resolutionSource ?? null,
    authorityState: trackerContext?.authorityState ?? null,
    ambiguityState: trackerContext?.ambiguityState ?? null,
    explicitTokenUuid: payload?.explicitTokenUuid ?? null,
    trackerDocument: trackerContext?.trackerDocument ?? trackedActor ?? null,
    combatId: payload?.combatId ?? game?.combat?.id ?? null,
    round: payload?.round ?? game?.combat?.round ?? null,
    turn: payload?.turn ?? game?.combat?.turn ?? null,
  });
}

export function registerCombatTrackerSheetRefresh(sheet) {
  if (!sheet || sheet._uesrpgCombatTrackerRefreshHooks) return;

  const hooks = {
    trackerChanged: Hooks.on("uesrpg.attackTrackerChanged", async (payload) => {
      _clearSheetTrackerAuthorityHintIfStale(sheet);
      const matched = _isTrackedActorMatch(sheet, payload?.actor) || _isTrackedActorMatch(sheet, payload?.sourceActor);
      if (matched) _updateSheetTrackerAuthorityHint(sheet, payload);
      _recordSheetRefreshDiagnostic(sheet, payload, matched);
      if (!matched) return;
      await _refreshCombatPart(sheet);
    }),
    combatTimeChanged: Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
      if (payload?.source !== "combat") return;
      if (payload?.combat?.phase && payload.combat.phase !== "post") return;
      const combat = game?.combat ?? null;
      if (!combat?.id) return;
      if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;
      _clearSheetTrackerAuthorityHintIfStale(sheet, combat);
      if (!_isSheetActorInCombat(sheet, combat)) return;
      await _refreshCombatPart(sheet);
    })
  };

  sheet._uesrpgCombatTrackerRefreshHooks = hooks;
}

export function unregisterCombatTrackerSheetRefresh(sheet) {
  const hooks = sheet?._uesrpgCombatTrackerRefreshHooks ?? null;
  if (!hooks) return;
  if (hooks.trackerChanged != null) Hooks.off("uesrpg.attackTrackerChanged", hooks.trackerChanged);
  if (hooks.combatTimeChanged != null) Hooks.off("uesrpg.combatTimeChanged", hooks.combatTimeChanged);
  sheet._uesrpgCombatTrackerRefreshHooks = null;
}
