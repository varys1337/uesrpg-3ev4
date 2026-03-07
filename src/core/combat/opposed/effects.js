/**
 * src/core/combat/opposed/effects.js
 * Active Effect management for opposed workflow
 * Extracted from opposed-workflow.js monolith (Phase 3)
 */

import { requestCreateActiveEffect, requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { TimeService } from "../../time/time-service.js";
import { MagicTimekeeping } from "../../magic/timekeeping-helper.js";
import { buildEffectDuration } from "../../time/effect-duration.js";
import { isEffectExpiredByCombat, isEffectExpiredByWorldTime } from "../../magic/effects/spell-effect-expiration.js";
import { hasTalent } from "../../traits/talents-api.js";
import { hasCondition } from "../../conditions/condition-engine.js";
import { getEffectiveWeaponHands } from "../combat-utils.js";
import { getContextAttackMode } from "./helpers/workflow.js";
import { _resolveDoc } from "./helpers/docs.js";
import { _getSystemId, _findEnabledEffectByUesrpgKey } from "./helpers/util.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { getFlagValueWithFallback, getSystemFlagsWithFallback } from "../../system/flags.js";

// ====== ACTIVE EFFECT CREATION ======

export async function createTemporaryEffect(actor, effectData) {
  if (!actor || !effectData) return null;
  try {
    // Permission-safe: proxy through active GM (preferred) or a single active OWNER of the target Actor.
    return await requestCreateActiveEffect(actor, effectData);
  } catch (err) {
    console.error("UESRPG | Failed to create temporary Active Effect.", { actor: actor?.uuid, effectData, err });
    return null;
  }
}

// ====== ADVANTAGE EFFECT DURATION ======

export function advantageDurationData(actor, rounds = 1) {
  const r = Math.max(1, Number(rounds ?? 1) || 1);
  const roundSeconds = Math.max(1, Number(TimeService.getRoundTimeSeconds?.() ?? 6) || 6);
  return buildEffectDuration({
    actor,
    rounds: r,
    seconds: r * roundSeconds,
    preferCombat: true
  });
}

// ====== ADVANTAGE EFFECT EXPIRATION ======

const _ADVANTAGE_KEYS = new Set(["pressAdvantage", "overextend", "overwhelm"]);
let _advantageExpiryRegistered = false;

export function isAdvantageEffect(effect) {
  if (!effect) return false;
  const f = getSystemFlagsWithFallback(effect) ?? null;
  if (!f || f.category !== "advantage") return false;
  const key = String(f.key ?? "");
  return _ADVANTAGE_KEYS.has(key);
}

export function isAdvantageEffectExpired(effect, { worldTime = null, combat = null } = {}) {
  if (!effect) return false;
  const d = effect.duration ?? {};
  const rounds = Number(d.rounds ?? 0) || 0;
  const wt = Number(worldTime ?? TimeService.getWorldTimeSeconds?.() ?? game.time?.worldTime ?? 0) || 0;
  const c = combat ?? (game?.combat ?? null);

  if (rounds > 0) {
    if (!c?.started) return true;
    const combatId = String(c?.id ?? "");
    const effectCombatId = String(d.combat ?? "");
    if (effectCombatId && combatId && effectCombatId !== combatId) return true;
    return isEffectExpiredByCombat(effect, c);
  }

  return isEffectExpiredByWorldTime(effect, wt);
}

export async function expireAdvantageEffects({ worldTime = null, combat = null } = {}) {
  if (!game.user?.isGM) return;

  const wt = Number(worldTime ?? TimeService.getWorldTimeSeconds?.() ?? game.time?.worldTime ?? 0) || 0;
  const c = combat ?? (game?.combat ?? null);

  const actors = MagicTimekeeping.relevantActorsArray?.() ?? Array.from(MagicTimekeeping.collectRelevantActors?.() ?? []);
  for (const actor of actors) {
    const effects = actor?.effects ?? [];
    const toDelete = [];
    for (const ef of effects) {
      if (!isAdvantageEffect(ef)) continue;
      if (isAdvantageEffectExpired(ef, { worldTime: wt, combat: c })) {
        if (ef?.id) toDelete.push(ef.id);
      }
    }

    if (!toDelete.length) continue;
    const existingIds = toDelete.filter((id) => actor.effects?.get?.(id));
    if (!existingIds.length) continue;

    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", existingIds);
    } catch (err) {
      const msg = String(err?.message ?? err ?? "");
      if (!msg.includes("does not exist")) {
        console.warn("UESRPG | Advantage expiry failed", { actor: actor?.uuid, err });
      }
    }
  }
}

export function registerAdvantageExpirationHooks() {
  if (_advantageExpiryRegistered) return;
  _advantageExpiryRegistered = true;

  if (globalThis.__UESRPG_ADVANTAGE_EXPIRY_HOOKS__) return;
  globalThis.__UESRPG_ADVANTAGE_EXPIRY_HOOKS__ = true;

  Hooks.on("uesrpg.timeChanged", async (payload) => {
    if (!game.user?.isGM) return;
    const source = String(payload?.source ?? "");
    if (source !== "worldTime" && source !== "calendaria") return;
    await expireAdvantageEffects({ worldTime: payload?.worldTime ?? null, combat: game?.combat ?? null });
  });

  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
    if (!game.user?.isGM) return;
    if (payload?.source !== "combat") return;
    if (payload?.combat?.phase && payload.combat.phase !== "post") return;
    await expireAdvantageEffects({ worldTime: payload?.worldTime ?? null, combat: game?.combat ?? null });
  });
}

// Auto-register hooks on module load
registerAdvantageExpirationHooks();

// ====== EFFECT QUERY HELPERS ======

export async function deleteActorEffectSafe(actor, effect) {
  if (!actor || !effect) return;
  if (!actor.effects?.get?.(effect.id)) return; // Already deleted
  try {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effect.id]);
  } catch (err) {
    console.warn("UESRPG | opposed-workflow | failed to delete effect", { actor: actor?.uuid, effectId: effect?.id, err });
  }
}

// ====== AIM MECHANIC (Chapter 5 Action) ======

export function getAimStateFromEffect(effect) {
  if (!effect) return { stacks: 0, itemUuid: null };

  const fa = getFlagValueWithFallback(effect, "aim");
  const stacks = Number(fa?.stacks ?? 0) || 0;
  const itemUuid = String(fa?.itemUuid ?? getFlagValueWithFallback(effect, "conditions.itemUuid") ?? "").trim() || null;

  // Fallback: infer from change value (+10/+20/+30)
  if (!stacks) {
    try {
      const c = (effect.changes ?? []).find((ch) => ch?.key === "system.modifiers.combat.attackTN");
      const v = Number(c?.value ?? 0) || 0;
      const inferredStacks = Math.max(0, Math.min(3, Math.round(v / 10)));
      return { stacks: inferredStacks, itemUuid };
    } catch (_e) {
      // no-op
    }
  }

  return { stacks: Math.max(0, Math.min(3, stacks)), itemUuid };
}

/**
 * RAW: Aim chain is broken if the character takes any action or reaction other
 * than continuing to Aim or firing the aimed weapon/spell.
 */
export async function breakAimChainIfPresent(actor) {
  const ef = _findEnabledEffectByUesrpgKey(actor, "aim");
  if (!ef) return;
  await deleteActorEffectSafe(actor, ef);
}

/**
 * Consume Aim after an attack action resolves.
 * - If the attack is a ranged attack with the aimed item: consume (delete) Aim.
 * - If the actor made any other attack: chain is broken (delete) Aim.
 */
export async function consumeOrBreakAimAfterAttack(actor, { attackMode, itemUuid } = {}) {
  const ef = _findEnabledEffectByUesrpgKey(actor, "aim");
  if (!ef) return;

  const state = getAimStateFromEffect(ef);
  const aimedItemUuid = String(state.itemUuid ?? "").trim();
  const actualMode = String(attackMode ?? "").toLowerCase();
  const actualItemUuid = String(itemUuid ?? "").trim();

  // Any non-ranged attack breaks the chain.
  if (actualMode !== "ranged") {
    await deleteActorEffectSafe(actor, ef);
    return;
  }

  // If we cannot determine either UUID, we conservatively keep Aim.
  if (!aimedItemUuid || !actualItemUuid) return;

  // Different weapon/spell breaks the chain.
  if (actualItemUuid !== aimedItemUuid) {
    await deleteActorEffectSafe(actor, ef);
    return;
  }

  // Aimed item was fired: consume Aim.
  await deleteActorEffectSafe(actor, ef);
}

// ====== ADVANTAGE EFFECTS (Press Advantage, Overextend, Overwhelm) ======

/**
 * Helper for Exploit Advantage talent check (double effect in isolated duel)
 */
async function _canUseExploitAdvantage(actor, { actorTokenUuid = null, opponentTokenUuid = null } = {}) {
  if (!hasTalent(actor, "exploitadvantage")) return false;
  if (!actorTokenUuid || !opponentTokenUuid) return false;

  // Check if tokens are in an isolated duel (1-on-1 with no other combatants within reach)
  const actorToken = _resolveDoc(actorTokenUuid);
  const opponentToken = _resolveDoc(opponentTokenUuid);
  if (!actorToken || !opponentToken) return false;

  // Import needed function from combat-proximity if available
  try {
    const { isIsolatedDuelByTokens } = await import("../../traits/combat-proximity.js");
    return isIsolatedDuelByTokens(actorToken, opponentToken) ?? false;
  } catch (_e) {
    return false;
  }
}

export async function applyPressAdvantageEffect(attacker, defender, { attackerTokenUuid = null, defenderTokenUuid = null, doubleEffect = false } = {}) {
  if (!attacker) return null;
  const opponentUuid = defender?.uuid ?? null;
  const duration = advantageDurationData(attacker, 1);

  const canDouble = Boolean(doubleEffect && await _canUseExploitAdvantage(attacker, { actorTokenUuid: attackerTokenUuid, opponentTokenUuid: defenderTokenUuid }));
  const tnDelta = canDouble ? 20 : 10;

  const effectData = {
    name: "Press Advantage",
    img: "icons/svg/upgrade.svg",
    origin: attacker.uuid,
    disabled: false,
    duration,
    changes: [
      {
        key: "system.modifiers.combat.opposed.attackTN",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: tnDelta,
        priority: 20
      }
    ],
    flags: {
      [FLAG_SCOPE]: {
        category: "advantage",
        key: "pressAdvantage",
        source: {
          actorUuid: attacker?.uuid ?? null,
          tokenUuid: attackerTokenUuid ?? null
        },
        target: {
          actorUuid: defender?.uuid ?? opponentUuid ?? null,
          tokenUuid: defenderTokenUuid ?? null
        },
        // Opponent-scoped: only applies against this opponent and only for melee attacks
        conditions: {
          ...(opponentUuid ? { opponentUuid } : {}),
          attackMode: "melee",
          ...(canDouble ? { requireIsolatedDuel: true } : {})
        }
      }
    }
  };

  return await createTemporaryEffect(attacker, effectData);
}

export async function applyOverextendEffect(opponent, { defenderUuid = null, defenderTokenUuid = null, opponentTokenUuid = null, doubleEffect = false } = {}) {
  if (!opponent) return null;
  const duration = advantageDurationData(opponent, 1);

  const defenderActor = defenderUuid ? _resolveDoc(defenderUuid) : null;
  const canDouble = Boolean(doubleEffect && defenderActor && await _canUseExploitAdvantage(defenderActor, { actorTokenUuid: defenderTokenUuid, opponentTokenUuid }));
  const tnDelta = canDouble ? -20 : -10;

  const effectData = {
    name: "Overextended",
    img: "icons/svg/downgrade.svg",
    origin: opponent.uuid,
    disabled: false,
    duration,
    changes: [
      {
        key: "system.modifiers.combat.opposed.attackTN",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: tnDelta,
        priority: 20
      }
    ],
    flags: {
      [FLAG_SCOPE]: {
        category: "advantage",
        key: "overextend",
        source: {
          actorUuid: defenderUuid ?? null,
          tokenUuid: defenderTokenUuid ?? null
        },
        target: {
          actorUuid: opponent?.uuid ?? null,
          tokenUuid: opponentTokenUuid ?? null
        },
        // Opponent-scoped: affects the target's next attack test (any attack type) against this defender.
        // RAW: "The opponent's next attack test within 1 round is made at a -10 penalty."
        conditions: {
          ...(defenderUuid ? { opponentUuid: defenderUuid } : {}),
          ...(canDouble ? { requireIsolatedDuel: true } : {})
        }
      }
    }
  };

  return await createTemporaryEffect(opponent, effectData);
}

export async function applyOverwhelmEffect(opponent, { defenderUuid = null } = {}) {
  if (!opponent) return null;
  const duration = advantageDurationData(opponent, 1);

  // Marker effect: AoO suppression is enforced elsewhere (action pipeline milestone).
  const effectData = {
    name: "Overwhelmed",
    img: "icons/svg/daze.svg",
    origin: opponent.uuid,
    disabled: false,
    duration,
    changes: [
      {
        key: `flags.${FLAG_SCOPE}.combat.noAoO`,
        mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
        value: true,
        priority: 20
      }
    ],
    flags: {
      [FLAG_SCOPE]: {
        category: "advantage",
        key: "overwhelm",
        meta: defenderUuid ? { defenderUuid } : {}
      }
    }
  };

  return await createTemporaryEffect(opponent, effectData);
}

export async function consumeOneShotAdvantageEffects(actor, { opponentUuid = null, attackMode = "melee" } = {}) {
  // RAW:
  // - Press Advantage: next MELEE attack test against the specified opponent within 1 round.
  // - Overextend: opponent's next attack test within 1 round at -10 (NOT target-scoped).
  // Therefore, opponentUuid is only required to consume Press Advantage, not Overextend.
  if (!actor) return;
  try {
    const aMode = getContextAttackMode({ attackMode });
    const toDelete = [];

    for (const ef of (actor.effects ?? [])) {
      if (!ef || ef.disabled) continue;
      const f = getSystemFlagsWithFallback(ef);
      if (!f || f.category !== "advantage") continue;
      const key = String(f.key ?? "");
      if (key !== "pressAdvantage" && key !== "overextend") continue;

      const cond = f.conditions ?? {};
      // Press Advantage is opponent-scoped; Overextend is not.
      if (key === "pressAdvantage") {
        if (!opponentUuid) continue;
        if (cond.opponentUuid && String(cond.opponentUuid) !== String(cond.opponentUuid)) continue;
      }

      // Press Advantage is melee-only; Overextend applies to the next attack test of any type.
      if (key === "pressAdvantage") {
        const condMode = getContextAttackMode({ attackMode: cond.attackMode ?? cond.attackType ?? "melee" });
        if (condMode !== "melee") continue;
        if (aMode !== "melee") continue;
      }

      toDelete.push(ef.id);
    }

    if (!toDelete.length) return;
    const existingIds = toDelete.filter((id) => actor.effects?.get?.(id));
    if (!existingIds.length) return;
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", existingIds);
  } catch (err) {
    console.error("UESRPG | Failed to consume one-shot Advantage effects.", { actorUuid: actor?.uuid, opponentUuid, err });
  }
}

// ====== HIDDEN CONDITION CONSUMPTION ======

export async function consumeHiddenAfterAttack(actor) {
  try {
    if (!actor) return;
    if (!hasCondition(actor, "hidden")) return;

    const effects = actor.effects?.contents ?? [];
    const toDelete = [];

    for (const ef of effects) {
      if (!ef?.id) continue;
      const k = String(ef.getFlag?.(FLAG_SCOPE, "condition")?.key ?? ef.flags?.[FLAG_SCOPE]?.condition?.key ?? "").trim().toLowerCase();
      const coreId = String(ef.getFlag?.("core", "statusId") ?? ef.flags?.core?.statusId ?? "").trim().toLowerCase();
      const hasStatus = typeof ef.statuses?.has === "function" ? ef.statuses.has("hidden") : false;

      if (k === "hidden" || coreId === "hidden" || hasStatus) {
        toDelete.push(ef.id);
      }
    }

    if (!toDelete.length) return;
    const existingIds = toDelete.filter((id) => actor.effects?.get?.(id));
    if (!existingIds.length) return;
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", existingIds);
  } catch (err) {
    console.warn("UESRPG | opposed-workflow | failed to consume Hidden after attack", err);
  }
}

// ====== SNEAK ATTACK MARKER ======

export async function markPendingSneakAttack(actor, { weaponUuid = null, attackMode = null } = {}) {
  try {
    if (!actor) return;
    if (!hasTalent(actor, "sneakattack") && !hasTalent(actor, "assassinate")) return;
    const systemId = _getSystemId();
    await requestUpdateDocument(actor, {
      [`flags.${systemId}.combat.pendingSneakAttack`]: {
        at: Date.now(),
        weaponUuid: weaponUuid ?? null,
        attackMode: attackMode ?? null
      }
    });
  } catch (err) {
    console.warn("UESRPG | opposed-workflow | failed to mark pending Sneak Attack", err);
  }
}
