import { requestDeleteEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { buildEffectChangesData } from "../../utils/compat.js";
import { createDebugLogger } from "../../utils/debug.js";
import { buildGenericAEMetadata, getGenericAEMetadata, isConditionEffect, mergeGenericAEMetadataIntoFlags } from "./metadata.js";
import { applyGenericAEExpiryAction, buildGenericAEExpiry, toLegacyStartTurnExpiryFlags, getGenericAEExpiryActors } from "./expiry.js";
import { applyGenericStackPolicy } from "./stack-policy.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { isActiveGMUser } from "../../utils/users.js";
import { registerCombatBoundaryConsumer } from "../time/combat-boundary-orchestrator.js";
import { acquireLock, releaseLock, lockKeyForDoc } from "../../utils/authority-proxy/shared.js";

const _debug = createDebugLogger("aeLifecycleDebug", "[UESRPG][GenericAELifecycle]");

let _registered = false;

export {
  applyGenericAEExpiryAction,
  applyGenericStackPolicy,
  buildGenericAEExpiry,
  buildGenericAEMetadata,
  toLegacyStartTurnExpiryFlags,
};

export function buildGenericAEData({
  source = "manual",
  expiry = null,
  expiryAction = "delete",
  stack = null,
  flags = {},
  changes = undefined,
  ...base
} = {}) {
  const metadata = buildGenericAEMetadata({ source, expiry, expiryAction, stack });
  const next = {
    ...base,
    flags: mergeGenericAEMetadataIntoFlags(flags, metadata),
  };

  if (changes !== undefined) {
    Object.assign(next, buildEffectChangesData(changes));
  } else if (Array.isArray(base?.changes) || Array.isArray(base?.system?.changes)) {
    Object.assign(next, buildEffectChangesData(base?.system?.changes ?? base?.changes));
  }

  return next;
}

function _isCombatEndEffect(effect, combat) {
  if (!effect || effect.disabled || isConditionEffect(effect)) return false;
  const meta = getGenericAEMetadata(effect);
  const expiry = meta?.expiry;
  if (!expiry || expiry.mode !== "combat-end") return false;
  const combatId = String(combat?.id ?? "");
  return !expiry.combatId || !combatId || String(expiry.combatId) === combatId;
}

async function _expireCombatEndEffects(combat) {
  if (!isActiveGMUser(game.user)) return;

  for (const actor of getGenericAEExpiryActors(combat)) {
    const effects = Array.from(actor?.effects ?? []).filter((effect) => _isCombatEndEffect(effect, combat));
    if (!effects.length) continue;

    const deleteIds = [];
    for (const effect of effects) {
      const meta = getGenericAEMetadata(effect);
      if (meta?.expiryAction === "suppress") {
        await applyGenericAEExpiryAction(actor, effect, { reason: "combat-end", combat });
      } else {
        deleteIds.push(effect.id);
      }
    }

    if (deleteIds.length) await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", deleteIds);
    _debug("Expired combat-end generic ActiveEffects", { actor: actor?.uuid ?? null, count: effects.length });
  }
}

async function _expireVoidChannelerEffects(predicate, combat = null) {
  if (!isActiveGMUser(game.user)) return;
  const failures = [];
  for (const actor of getGenericAEExpiryActors(combat)) {
    const matches = effect => {
      const anchor = effect.flags?.[FLAG_SCOPE]?.voidChannelerAnchor;
      return effect.flags?.[FLAG_SCOPE]?.key === "voidChanneler" && anchor && predicate(anchor);
    };
    if (!Array.from(actor?.effects ?? []).some(matches)) continue;
    const key = lockKeyForDoc(actor);
    let locked = false;
    try {
      await acquireLock(key);
      locked = true;
      if (!isActiveGMUser(game.user)) throw new Error("The active GM changed.");
      const fresh = actor.uuid ? await fromUuid(actor.uuid) : actor;
      if (!fresh) throw new Error("The affected actor is unavailable.");
      const ids = Array.from(fresh.effects ?? []).filter(matches).map(effect => effect.id).filter(Boolean);
      if (!isActiveGMUser(game.user)) throw new Error("The active GM changed.");
      if (ids.length && !await requestDeleteEmbeddedDocuments(fresh, "ActiveEffect", ids, { requireDeleted: true })) {
        throw new Error("Effect deletion was not confirmed.");
      }
    } catch (error) { failures.push(`${actor.name}: ${error.message}`); }
    finally { if (locked) releaseLock(key); }
  }
  if (failures.length) {
    const message = `Void Channeler expiry was not confirmed for: ${failures.join(", ")}.`;
    ui.notifications?.warn?.(message);
    throw new Error(message);
  }
}

async function _expireVoidChannelerAtBoundary(payload) {
  const combat = game.combats?.get?.(String(payload?.combat?.id ?? ""));
  const prior = payload?.combat?.prior;
  const current = payload?.combat?.current;
  if (!combat || !prior || !current || Number(current.round) < Number(prior.round)) return;
  await _expireVoidChannelerEffects(anchor => {
    if (String(anchor.combatId) !== String(combat.id)) return false;
    const endRound = Number(anchor.round) + 1;
    if (!Number.isFinite(endRound)) return false;
    return Number(current.round) > endRound ||
      (Number(prior.round) >= endRound && String(prior.combatantId ?? "") === String(anchor.combatantId));
  }, combat);
}

async function _recoverVoidChannelerExpiry() {
  await _expireVoidChannelerEffects(anchor => {
    const combat = game.combats?.get?.(String(anchor.combatId ?? ""));
    if (!combat || !combat.combatants?.get?.(String(anchor.combatantId ?? ""))) return true;
    return anchor.round != null && Number.isFinite(Number(anchor.round)) && Number(combat.round) > Number(anchor.round) + 1;
  });
}

export function registerGenericAELifecycleHooks() {
  if (_registered) return;
  _registered = true;

  registerCombatBoundaryConsumer({ id: "void-channeler-expiry", order: 105,
    handle: _expireVoidChannelerAtBoundary, retrySafe: true });

  Hooks.on("deleteCombat", async (combat) => {
    try {
      await _expireCombatEndEffects(combat);
    } catch (err) {
      console.warn("UESRPG | Generic ActiveEffect combat-end expiry failed", err);
    }
    try {
      await _expireVoidChannelerEffects(anchor => String(anchor.combatId) === String(combat.id), combat);
    } catch (err) {
      console.warn("UESRPG | Void Channeler combat-end expiry failed", err);
    }
  });
  Hooks.on("deleteCombatant", (combatant) => {
    const combat = combatant?.parent;
    void _expireVoidChannelerEffects(anchor => String(anchor.combatId) === String(combat?.id)
      && String(anchor.combatantId) === String(combatant.id), combat)
      .catch(error => console.warn("UESRPG | Void Channeler combatant expiry failed", error));
  });
  const recover = () => { void _recoverVoidChannelerExpiry()
    .catch(error => console.warn("UESRPG | Void Channeler expiry recovery failed", error)); };
  Hooks.once("ready", recover);
  Hooks.on("userConnected", recover);
}
