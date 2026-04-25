import { requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { createDebugLogger } from "../../utils/debug.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import {
  buildGenericAEMetadata,
  getGenericAEMetadata,
  getSystemAEFlags,
  normalizeExpiryAction,
  normalizeGenericAEExpiry,
} from "./metadata.js";

const _debug = createDebugLogger("aeLifecycleDebug", "[UESRPG][GenericAE]");

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _actorCombatant(combat, actor) {
  if (!combat || !actor) return null;
  try {
    if (typeof combat.getCombatantsByActor === "function") {
      const found = combat.getCombatantsByActor(actor);
      return Array.isArray(found) ? (found[0] ?? null) : null;
    }
  } catch (_e) {
    // Fall through to collection scan.
  }

  const combatants = Array.from(combat.combatants ?? []);
  return combatants.find((c) => c?.actor?.id === actor.id || c?.actorId === actor.id) ?? null;
}

function _combatTurns(combat) {
  const turns = combat?.turns;
  return Array.isArray(turns) ? turns : Array.from(turns ?? []);
}

function _turnIndexForCombatant(combat, combatant) {
  const turns = _combatTurns(combat);
  const id = String(combatant?.id ?? "");
  const idx = turns.findIndex((turn) => String(turn?.id ?? "") === id);
  return idx >= 0 ? idx : _num(combat?.turn, 0);
}

function _nextTurnPoint(combat, combatant, boundary) {
  if (!combat?.started || !combatant) return null;

  const idx = _turnIndexForCombatant(combat, combatant);
  const currentTurn = _num(combat.turn, 0);
  const currentRound = _num(combat.round, 0);
  const afterCurrentTurn = boundary === "start" ? idx <= currentTurn : idx < currentTurn;

  return {
    round: afterCurrentTurn ? currentRound + 1 : currentRound,
    turn: idx,
  };
}

function _roleForMode(mode) {
  const m = String(mode ?? "").trim().toLowerCase();
  if (m.startsWith("source-")) return "source";
  if (m.startsWith("target-")) return "target";
  return null;
}

function _boundaryForMode(mode) {
  const m = String(mode ?? "").trim().toLowerCase();
  if (m.endsWith("-next-turn-start")) return "turn-start";
  if (m.endsWith("-next-turn-end")) return "turn-end";
  if (m === "combat-end") return "combat-end";
  if (m === "point") return "point";
  return null;
}

function _actorForRole(role, { actor = null, sourceActor = null, targetActor = null } = {}) {
  if (role === "source") return sourceActor ?? actor ?? null;
  if (role === "target") return targetActor ?? actor ?? null;
  return actor ?? targetActor ?? sourceActor ?? null;
}

export function toLegacyStartTurnExpiryFlags(expiry) {
  const normalized = normalizeGenericAEExpiry(expiry);
  if (!normalized || normalized.mode !== "turn-start") return {};

  const out = { expiresOnTurnStart: true };
  if (normalized.combatId) out.expiresCombatId = normalized.combatId;
  if (normalized.combatantId) out.expiresCombatantId = normalized.combatantId;
  if (normalized.round != null) out.expiresRound = normalized.round;
  if (normalized.turn != null) out.expiresTurn = normalized.turn;
  return out;
}

export function buildGenericAEExpiry({
  mode,
  actor = null,
  sourceActor = null,
  targetActor = null,
  combat = globalThis.game?.combat ?? null,
  round = null,
  turn = null,
  expiryAction = "delete",
  source = "manual",
  stack = null,
} = {}) {
  const requestedMode = String(mode ?? "").trim().toLowerCase();
  const boundary = _boundaryForMode(requestedMode);
  if (!boundary) return null;

  let expiry = null;
  const role = _roleForMode(requestedMode) ?? "target";

  if (boundary === "combat-end") {
    expiry = {
      mode: "combat-end",
      actor: role,
      combatId: combat?.id ? String(combat.id) : null,
      combatantId: null,
      round: null,
      turn: null,
    };
  } else if (boundary === "point") {
    const r = Number(round);
    const t = Number(turn);
    if (!Number.isFinite(r) || !Number.isFinite(t)) return null;
    expiry = {
      mode: "point",
      actor: role,
      combatId: combat?.id ? String(combat.id) : null,
      combatantId: null,
      round: r,
      turn: t,
    };
  } else {
    const target = _actorForRole(role, { actor, sourceActor, targetActor });
    const combatant = _actorCombatant(combat, target);
    const point = _nextTurnPoint(combat, combatant, boundary === "turn-start" ? "start" : "end");
    if (!point) return null;

    expiry = {
      mode: boundary,
      actor: role,
      combatId: combat?.id ? String(combat.id) : null,
      combatantId: combatant?.id ? String(combatant.id) : null,
      round: point.round,
      turn: point.turn,
    };
  }

  const metadata = buildGenericAEMetadata({
    source,
    expiry,
    expiryAction,
    stack,
  });

  return {
    expiry,
    expiryAction: normalizeExpiryAction(expiryAction),
    metadata,
    legacyFlags: toLegacyStartTurnExpiryFlags(expiry),
  };
}

function _legacyStartTurnExpiry(effect) {
  const flags = getSystemAEFlags(effect);
  if (flags.expiresOnTurnStart !== true) return null;
  return {
    mode: "turn-start",
    actor: null,
    combatId: flags.expiresCombatId ? String(flags.expiresCombatId) : null,
    combatantId: flags.expiresCombatantId ? String(flags.expiresCombatantId) : null,
    round: flags.expiresRound === undefined ? null : _num(flags.expiresRound, null),
    turn: flags.expiresTurn === undefined ? null : _num(flags.expiresTurn, null),
  };
}

export function getEffectExpiryAction(effect) {
  const meta = getGenericAEMetadata(effect);
  return normalizeExpiryAction(meta?.expiryAction ?? "delete");
}

export function getEffectGenericExpiry(effect, { includeLegacy = true } = {}) {
  const meta = getGenericAEMetadata(effect);
  if (meta?.expiry) return meta.expiry;
  return includeLegacy ? _legacyStartTurnExpiry(effect) : null;
}

export function effectMatchesGenericExpiry(effect, {
  mode,
  combat = globalThis.game?.combat ?? null,
  combatant = null,
  round = null,
  turn = null,
  includeLegacy = true,
} = {}) {
  if (!effect || effect.disabled) return false;

  const expiry = getEffectGenericExpiry(effect, { includeLegacy });
  if (!expiry) return false;
  if (String(expiry.mode ?? "") !== String(mode ?? "")) return false;

  const combatId = String(combat?.id ?? "");
  if (expiry.combatId && combatId && String(expiry.combatId) !== combatId) return false;

  const combatantId = String(combatant?.id ?? "");
  if (expiry.combatantId && combatantId && String(expiry.combatantId) !== combatantId) return false;

  if (expiry.round != null && Number.isFinite(Number(round)) && Number(expiry.round) !== Number(round)) return false;
  if (expiry.turn != null && Number.isFinite(Number(turn)) && Number(expiry.turn) !== Number(turn)) return false;

  return true;
}

export async function applyGenericAEExpiryAction(actor, effect, {
  reason = "expired",
  combat = globalThis.game?.combat ?? null,
  worldTime = globalThis.game?.time?.worldTime ?? null,
} = {}) {
  if (!actor || !effect?.id) return false;

  const action = getEffectExpiryAction(effect);
  if (action !== "suppress") {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);
    return true;
  }

  const atWorldTime = Number(worldTime);
  const atCombatRound = Number(combat?.round);
  await requestUpdateDocument(effect, {
    disabled: true,
    [`flags.${FLAG_SCOPE}.ae.suppressed.expired`]: true,
    [`flags.${FLAG_SCOPE}.ae.suppressed.atWorldTime`]: Number.isFinite(atWorldTime) ? atWorldTime : null,
    [`flags.${FLAG_SCOPE}.ae.suppressed.atCombatRound`]: Number.isFinite(atCombatRound) ? atCombatRound : null,
    [`flags.${FLAG_SCOPE}.ae.suppressed.reason`]: String(reason ?? "expired"),
  });
  _debug("Suppressed expired generic ActiveEffect", { actor: actor?.uuid ?? null, effect: effect?.uuid ?? effect?.id });
  return true;
}
