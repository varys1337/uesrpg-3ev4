import { resolveActorFromUuidSync, resolveUuidSync } from "./uuid-cache.js";

function _str(value) {
  return String(value ?? "").trim();
}

function _getCombatTurns(combat) {
  if (!combat) return [];
  return Array.isArray(combat.turns) ? combat.turns : Array.from(combat.combatants ?? []);
}

function _getTokenDocumentUuid(doc) {
  return _str(
    doc?.documentName === "TokenDocument" ? doc.uuid
      : doc?.documentName === "Token" ? (doc.document?.uuid ?? doc.uuid)
      : doc?.token?.uuid
      ?? doc?.token?.document?.uuid
      ?? doc?.tokenDocument?.uuid
      ?? doc?.tokenUuid
      ?? ""
  );
}

function _getActorUuid(actor) {
  return _str(actor?.uuid);
}

function _getActorId(actor) {
  return _str(actor?.id);
}

function _getCombatantActor(combatant) {
  return combatant?.actor ?? combatant?.token?.actor ?? combatant?.token?.document?.actor ?? null;
}

function _scoreCombatantMatch(combatant, anchor, actor) {
  let score = 0;
  const tokenUuid = _getTokenDocumentUuid(combatant);
  const combatantActor = _getCombatantActor(combatant);

  if (_str(anchor?.casterCombatantId) && _str(combatant?.id) === _str(anchor.casterCombatantId)) score += 100;
  if (_str(anchor?.casterTokenUuid) && tokenUuid && tokenUuid === _str(anchor.casterTokenUuid)) score += 50;
  if (actor && combatantActor) {
    if (_getActorId(combatantActor) && _getActorId(combatantActor) === _getActorId(actor)) score += 10;
    if (_getActorUuid(combatantActor) && _getActorUuid(combatantActor) === _getActorUuid(actor)) score += 10;
  }
  if (_str(anchor?.combatId) && _str(combatant?.combat?.id) === _str(anchor.combatId)) score += 1;

  return score;
}

function _resolveCombatantByTokenUuid(combat, tokenUuid) {
  const wanted = _str(tokenUuid);
  if (!combat || !wanted) return null;
  return _getCombatTurns(combat).find((combatant) => _getTokenDocumentUuid(combatant) === wanted) ?? null;
}

function _resolveCombatantByActor(combat, actor, anchor = null) {
  if (!combat || !actor) return null;

  const matches = _getCombatTurns(combat).filter((combatant) => {
    const combatantActor = _getCombatantActor(combatant);
    if (!combatantActor) return false;
    if (_getActorId(combatantActor) && _getActorId(combatantActor) === _getActorId(actor)) return true;
    if (_getActorUuid(combatantActor) && _getActorUuid(combatantActor) === _getActorUuid(actor)) return true;
    return false;
  });

  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  let best = null;
  let bestScore = -1;
  for (const combatant of matches) {
    const score = _scoreCombatantMatch(combatant, anchor, actor);
    if (score > bestScore) {
      best = combatant;
      bestScore = score;
    }
  }

  return best ?? matches[0];
}

function _explainResolution(combat, normalized, { cache } = {}) {
  const explanation = {
    source: "unresolved",
    reason: "",
    anchor: {
      casterUuid: _str(normalized?.casterUuid),
      casterTokenUuid: _str(normalized?.casterTokenUuid),
      casterCombatantId: _str(normalized?.casterCombatantId),
      combatId: _str(normalized?.combatId)
    },
    actorUuid: "",
    actorId: "",
    combatantId: "",
    tokenUuid: "",
    turnIndex: null
  };

  if (!combat) {
    explanation.reason = "no-combat";
    return explanation;
  }

  const byId = _str(normalized?.casterCombatantId)
    ? combat.combatants?.get?.(_str(normalized.casterCombatantId)) ?? null
    : null;
  if (byId) {
    explanation.source = "combatantId";
    explanation.combatantId = _str(byId.id);
    explanation.tokenUuid = _getTokenDocumentUuid(byId);
    const actor = _getCombatantActor(byId);
    explanation.actorUuid = _getActorUuid(actor);
    explanation.actorId = _getActorId(actor);
  } else {
    if (_str(normalized?.casterCombatantId)) explanation.reason = "combatant-missing";

    const byToken = _resolveCombatantByTokenUuid(combat, normalized?.casterTokenUuid);
    if (byToken) {
      explanation.source = "tokenUuid";
      explanation.combatantId = _str(byToken.id);
      explanation.tokenUuid = _getTokenDocumentUuid(byToken);
      const actor = _getCombatantActor(byToken);
      explanation.actorUuid = _getActorUuid(actor);
      explanation.actorId = _getActorId(actor);
    } else {
      if (_str(normalized?.casterTokenUuid) && !explanation.reason) explanation.reason = "token-missing";

      const actor = resolveActorDocumentSync(_str(normalized?.casterUuid), { cache });
      if (!actor) {
        explanation.reason = explanation.reason || "actor-missing";
        return explanation;
      }

      explanation.actorUuid = _getActorUuid(actor);
      explanation.actorId = _getActorId(actor);
      const byActor = _resolveCombatantByActor(combat, actor, normalized);
      if (!byActor) {
        explanation.source = "actorUuid";
        explanation.reason = explanation.reason || "actor-not-in-combat";
        return explanation;
      }

      explanation.source = "actorUuid";
      explanation.combatantId = _str(byActor.id);
      explanation.tokenUuid = _getTokenDocumentUuid(byActor);
    }
  }

  if (!explanation.combatantId) {
    explanation.reason = explanation.reason || "unresolved";
    return explanation;
  }

  const turns = _getCombatTurns(combat);
  const idx = turns.findIndex((turn) => _str(turn?.id) === explanation.combatantId);
  explanation.turnIndex = idx >= 0 ? idx : null;
  if (explanation.turnIndex == null && !explanation.reason) explanation.reason = "combatant-not-in-turn-order";
  return explanation;
}

export function resolveDocumentSync(uuid, { cache } = {}) {
  return resolveUuidSync(uuid, { cache });
}

export function resolveActorDocumentSync(uuid, { cache } = {}) {
  return resolveActorFromUuidSync(uuid, { cache });
}

export function buildSpellExpirationAnchor({
  casterActor,
  casterTokenUuid = null,
  combat = game?.combat ?? null,
  existing = null
} = {}) {
  const actorUuid = _str(casterActor?.uuid ?? existing?.casterUuid);
  const tokenUuid = _str(casterTokenUuid ?? existing?.casterTokenUuid);
  const anchor = {
    mode: "caster-turn",
    casterUuid: actorUuid,
    casterTokenUuid: tokenUuid || null,
    casterCombatantId: _str(existing?.casterCombatantId) || null,
    combatId: _str(existing?.combatId) || null
  };

  if (!combat?.id) return anchor;

  anchor.combatId = _str(combat.id);

  let combatant = null;
  if (tokenUuid) combatant = _resolveCombatantByTokenUuid(combat, tokenUuid);
  if (!combatant && casterActor) combatant = _resolveCombatantByActor(combat, casterActor, existing);

  if (combatant?.id) {
    anchor.casterCombatantId = _str(combatant.id);
    anchor.casterTokenUuid = anchor.casterTokenUuid || _getTokenDocumentUuid(combatant) || null;
  }

  return anchor;
}

export function normalizeSpellExpirationAnchor(flags = {}, { combat = game?.combat ?? null, cache } = {}) {
  const raw = flags?.expirationAnchor && typeof flags.expirationAnchor === "object"
    ? flags.expirationAnchor
    : {};
  const actor = resolveActorDocumentSync(_str(raw.casterUuid || flags?.casterUuid), { cache });

  return buildSpellExpirationAnchor({
    casterActor: actor,
    casterTokenUuid: raw.casterTokenUuid ?? null,
    combat: _str(raw?.combatId) && _str(raw.combatId) !== _str(combat?.id) ? null : combat,
    existing: {
      mode: _str(raw.mode) || "caster-turn",
      casterUuid: _str(raw.casterUuid || flags?.casterUuid),
      casterTokenUuid: _str(raw.casterTokenUuid),
      casterCombatantId: _str(raw.casterCombatantId),
      combatId: _str(raw.combatId)
    }
  });
}

export function resolveCombatantForSpellAnchor(combat, anchor, { cache } = {}) {
  return resolveSpellAnchorCombatant(combat, anchor, { cache });
}

export function explainSpellAnchorResolution(combat, anchor, { cache } = {}) {
  const normalized = anchor && typeof anchor === "object" ? anchor : {};
  return _explainResolution(combat, normalized, { cache });
}

export function resolveSpellAnchorCombatant(combat, anchor, { cache } = {}) {
  if (!combat) return null;
  const explanation = explainSpellAnchorResolution(combat, anchor, { cache });
  if (!explanation?.combatantId) return null;
  return combat.combatants?.get?.(explanation.combatantId) ?? null;
}

export function resolveSpellAnchorTurnIndex(combat, anchor, { cache } = {}) {
  return explainSpellAnchorResolution(combat, anchor, { cache }).turnIndex;
}
