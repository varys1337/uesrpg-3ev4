import { findCombatantsForActor, resolveCombatantForActor } from "../../utils/document-resolution.js";
import { resolveUuidSync } from "../../utils/uuid-cache.js";

function _str(value) {
  return String(value ?? "").trim();
}

function _getTokenUuid(candidate) {
  return _str(
    candidate?.documentName === "TokenDocument" ? candidate?.uuid
      : candidate?.document?.uuid
      ?? candidate?.token?.document?.uuid
      ?? candidate?.token?.uuid
      ?? candidate?.tokenUuid
      ?? candidate?.uuid
      ?? ""
  );
}

function _resolveTokenDocument(tokenLike) {
  if (!tokenLike) return null;
  if (tokenLike?.documentName === "Token") return tokenLike;
  const tokenUuid = _getTokenUuid(tokenLike);
  if (!tokenUuid) return null;
  const resolved = resolveUuidSync(tokenUuid);
  return resolved?.documentName === "Token" ? resolved : null;
}

function _resolveCombatantByTokenUuid(combat, tokenUuid) {
  const wanted = _str(tokenUuid);
  if (!combat || !wanted) return null;
  const turns = Array.isArray(combat.turns) ? combat.turns : Array.from(combat.combatants ?? []);
  return turns.find((combatant) => _getTokenUuid(combatant?.token ?? combatant) === wanted) ?? null;
}

function _getActiveCombatantMatches(actor, combat) {
  if (!combat || !actor?.getActiveTokens) return [];
  const tokens = actor.getActiveTokens() ?? [];
  const matches = [];
  const seenCombatantIds = new Set();
  for (const token of tokens) {
    const tokenUuid = _getTokenUuid(token);
    if (!tokenUuid) continue;
    const combatant = _resolveCombatantByTokenUuid(combat, tokenUuid);
    const combatantId = _str(combatant?.id);
    if (!combatant || !combatantId || seenCombatantIds.has(combatantId)) continue;
    seenCombatantIds.add(combatantId);
    matches.push(combatant);
  }
  return matches;
}

function _buildResolutionState({
  source = "actor-fallback",
  combatant = null,
  tokenDoc = null,
  trackerDocument = null,
  trackerOwner = null,
  authoritative = false,
  ambiguityState = "none",
  notice = null,
} = {}) {
  return {
    source,
    combatant,
    tokenDoc,
    trackerDocument,
    trackerOwner,
    authoritative,
    ambiguityState,
    notice,
  };
}

export function buildAttackTrackerContext(actor, trackerContext = {}) {
  const context = { ...(trackerContext ?? {}) };
  const combat = context.combat ?? game?.combat ?? null;
  const explicitTokenUuid = _str(context.tokenUuid);
  const explicitCombatantId = _str(context.combatantId);
  const sheetTokenDoc = _resolveTokenDocument(context.sheetToken);
  const actorTokenDoc = _resolveTokenDocument(actor?.token);
  const requestedResolutionSource = _str(context.resolutionSource);
  const requestedTrackerDocument = context.trackerDocument ?? null;

  let resolution = _buildResolutionState();

  if (combat && explicitCombatantId) {
    const combatant = combat.combatants?.get?.(explicitCombatantId) ?? null;
    if (combatant) {
      const combatantTokenDoc = _resolveTokenDocument(combatant?.token);
      resolution = _buildResolutionState({
        source: "explicit-combatant",
        combatant,
        tokenDoc: combatantTokenDoc,
        trackerDocument: combatantTokenDoc?.actor ?? combatant?.actor ?? null,
        trackerOwner: combatant,
        authoritative: true,
      });
    }
  }

  if (!resolution.combatant && combat && explicitTokenUuid) {
    const combatant = _resolveCombatantByTokenUuid(combat, explicitTokenUuid);
    const explicitTokenDoc = _resolveTokenDocument({ tokenUuid: explicitTokenUuid });
    if (combatant) {
      resolution = _buildResolutionState({
        source: "explicit-token",
        combatant,
        tokenDoc: explicitTokenDoc ?? _resolveTokenDocument(combatant?.token),
        trackerDocument: explicitTokenDoc?.actor ?? combatant?.token?.actor ?? combatant?.actor ?? null,
        trackerOwner: combatant,
        authoritative: true,
      });
    } else if (explicitTokenDoc?.actor) {
      resolution = _buildResolutionState({
        source: "explicit-token",
        tokenDoc: explicitTokenDoc,
        trackerDocument: explicitTokenDoc.actor,
        trackerOwner: explicitTokenDoc.actor,
        authoritative: true,
      });
    }
  }

  if (!resolution.combatant && combat && sheetTokenDoc) {
    const combatant = _resolveCombatantByTokenUuid(combat, _getTokenUuid(sheetTokenDoc));
    if (combatant) {
      resolution = _buildResolutionState({
        source: "sheet-token",
        combatant,
        tokenDoc: sheetTokenDoc,
        trackerDocument: sheetTokenDoc?.actor ?? combatant?.actor ?? null,
        trackerOwner: combatant,
        authoritative: true,
      });
    }
  }

  if (!resolution.combatant && combat && actorTokenDoc) {
    const combatant = _resolveCombatantByTokenUuid(combat, _getTokenUuid(actorTokenDoc));
    if (combatant) {
      resolution = _buildResolutionState({
        source: "actor-token",
        combatant,
        tokenDoc: actorTokenDoc,
        trackerDocument: actorTokenDoc?.actor ?? combatant?.actor ?? null,
        trackerOwner: combatant,
        authoritative: true,
      });
    }
  }

  if (!resolution.combatant && combat && actor) {
    const activeCombatants = _getActiveCombatantMatches(actor, combat);
    if (activeCombatants.length === 1) {
      resolution = _buildResolutionState({
        source: "active-combat-token",
        combatant: activeCombatants[0],
        tokenDoc: _resolveTokenDocument(activeCombatants[0]?.token),
        trackerDocument: _resolveTokenDocument(activeCombatants[0]?.token)?.actor ?? activeCombatants[0]?.actor ?? null,
        trackerOwner: activeCombatants[0],
        authoritative: true,
        ambiguityState: "unlinked-unique",
      });
    } else if (activeCombatants.length > 1) {
      resolution = _buildResolutionState({
        source: "active-combat-token",
        combatant: null,
        tokenDoc: null,
        authoritative: false,
        ambiguityState: "unlinked-ambiguous",
        notice: "Open the token sheet to view live attack tracking for this combatant.",
      });
    }
  }

  if (!resolution.combatant && combat && actor) {
    const combatants = findCombatantsForActor(combat, actor);
    if (combatants.length === 1) {
      resolution = _buildResolutionState({
        source: "combatant-actor",
        combatant: combatants[0],
        tokenDoc: _resolveTokenDocument(combatants[0]?.token),
        trackerDocument: _resolveTokenDocument(combatants[0]?.token)?.actor ?? combatants[0]?.actor ?? null,
        trackerOwner: combatants[0],
        authoritative: true,
      });
    } else if (combatants.length > 1 && resolution.ambiguityState === "none") {
      resolution = _buildResolutionState({
        source: "combatant-actor",
        combatant: null,
        tokenDoc: null,
        authoritative: false,
        ambiguityState: "unlinked-ambiguous",
        notice: "Open the token sheet to view live attack tracking for this combatant.",
      });
    }
  }

  const resolvedCombatant = resolution.combatant
    ?? (resolution.ambiguityState === "unlinked-ambiguous"
      ? null
      : (resolveCombatantForActor(combat, actor, {
        tokenUuid: explicitTokenUuid || _getTokenUuid(sheetTokenDoc) || _getTokenUuid(actorTokenDoc),
        combatantId: explicitCombatantId,
        actorUuid: _str(actor?.uuid),
        combatId: _str(combat?.id)
      }) ?? null));
  const tokenDoc = resolution.tokenDoc
    ?? (explicitTokenUuid ? _resolveTokenDocument({ tokenUuid: explicitTokenUuid }) : null)
    ?? sheetTokenDoc
    ?? actorTokenDoc
    ?? _resolveTokenDocument(resolvedCombatant?.token);
  const trackerDocument = requestedTrackerDocument
    ?? resolution.trackerDocument
    ?? tokenDoc?.actor
    ?? resolution.combatant?.token?.actor
    ?? resolution.combatant?.actor
    ?? resolvedCombatant?.token?.actor
    ?? resolvedCombatant?.actor
    ?? actor
    ?? null;
  const trackerCombatant = context.trackerCombatant
    ?? resolution.combatant
    ?? resolvedCombatant
    ?? null;
  const trackerOwner = context.trackerOwner
    ?? resolution.trackerOwner
    ?? trackerCombatant
    ?? trackerDocument
    ?? actor
    ?? null;
  const combatantActor = context.combatantActor
    ?? trackerDocument
    ?? tokenDoc?.actor
    ?? resolution.combatant?.actor
    ?? resolvedCombatant?.actor
    ?? null;
  const authoritative = Boolean(
    context.authoritative
    ?? resolution.authoritative
    ?? trackerCombatant
    ?? trackerDocument
  );
  const ambiguityState = _str(context.ambiguityState) || resolution.ambiguityState || "none";
  const authorityState = _str(context.authorityState)
    || (authoritative ? "combatant-resolved" : "actor-fallback");
  const notice = _str(context.notice) || resolution.notice || null;
  const resolutionSource = requestedResolutionSource
    || (resolution.source !== "actor-fallback" ? resolution.source : "")
    || (resolvedCombatant ? "combatant-actor" : "")
    || "actor-fallback";

  return {
    ...context,
    combat,
    combatantId: explicitCombatantId || _str(resolution.combatant?.id) || _str(resolvedCombatant?.id),
    tokenUuid: explicitTokenUuid || _getTokenUuid(tokenDoc) || _getTokenUuid(resolvedCombatant?.token),
    combatantActor,
    trackerCombatant,
    trackerOwner,
    trackerDocument,
    sheetToken: sheetTokenDoc ?? tokenDoc ?? null,
    source: _str(context.source) || "attack-tracker",
    attackTraceId: _str(context.attackTraceId) || null,
    attackMode: _str(context.attackMode) || null,
    phase: _str(context.phase) || null,
    sourceTag: _str(context.sourceTag) || _str(context.source) || "attack-tracker",
    resolutionSource,
    authorityState,
    ambiguityState,
    authoritative,
    notice,
  };
}

export function resolveAttackTrackerActor(actor, trackerContext = {}) {
  const context = buildAttackTrackerContext(actor, trackerContext);
  return context.trackerDocument ?? context.combatantActor ?? actor ?? null;
}
