import { FLAG_SCOPE } from "../system/namespace.js";

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _isActorEmbedded(effect) {
  return effect?.parent?.documentName === "Actor";
}

function _isFiniteCombatDuration(duration) {
  const units = String(duration?.units ?? "").trim();
  const value = Number(duration?.value);
  return Number.isFinite(value) && value > 0 && (units === "rounds" || units === "turns");
}

function _getCombatantForActor(combat, actor) {
  if (!combat || !actor || typeof combat.getCombatantsByActor !== "function") return null;
  const combatants = combat.getCombatantsByActor(actor);
  return Array.isArray(combatants) ? (combatants[0] ?? null) : null;
}

function _resolveCombatDocument(startCombat) {
  if (startCombat && typeof startCombat === "object") return startCombat;
  const id = String(startCombat ?? "").trim();
  if (id) {
    const byCollection = game?.combats?.get?.(id) ?? null;
    if (byCollection) return byCollection;
    if (String(game?.combat?.id ?? "") === id) return game.combat;
    return null;
  }
  return game?.combat ?? null;
}

function _turnIndex(combat, combatant) {
  if (!combat || !combatant) return null;
  const turns = Array.isArray(combat.turns) ? combat.turns : [];
  const index = turns.findIndex((candidate) => String(candidate?.id ?? "") === String(combatant.id ?? ""));
  return index >= 0 ? index : null;
}

/**
 * UESRPG ActiveEffect document customizations.
 *
 * Spell-created v14 duration data is normalized before actor embedding so
 * Foundry's ActiveEffectRegistry can own remaining-time and expiry behavior.
 */
export class UESRPGActiveEffect extends foundry.documents.ActiveEffect {
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    if (!_isActorEmbedded(this)) return allowed;

    const duration = this.duration ?? data?.duration ?? {};
    if (!_isFiniteCombatDuration(duration)) return allowed;

    const flags = this.flags?.[FLAG_SCOPE] ?? data?.flags?.[FLAG_SCOPE] ?? {};
    if (!flags?.spellEffect) return allowed;

    const combat = _resolveCombatDocument(this.start?.combat);
    if (!combat?.started) return allowed;

    const combatant = _getCombatantForActor(combat, this.parent);
    if (!combatant?.id) return allowed;

    const updates = {
      "start.combatant": combatant.id
    };

    const expiry = String(duration.expiry ?? "");
    if (String(duration.units ?? "") === "rounds" && (expiry === "turnStart" || expiry === "turnEnd")) {
      const targetTurn = _turnIndex(combat, combatant);
      const currentTurn = _num(combat.turn, 0);
      const hasUpkeep = Boolean(flags?.hasUpkeep);
      if (targetTurn != null) {
        const shouldAdjust = targetTurn > currentTurn || (expiry === "turnEnd" && targetTurn === currentTurn);
        if (shouldAdjust) {
          const nextValue = Math.max(hasUpkeep ? 1 : 0, _num(duration.value, 0) - 1);
          updates["duration.value"] = nextValue;
        }
      }
    }

    this.updateSource(updates);
    return allowed;
  }
}
