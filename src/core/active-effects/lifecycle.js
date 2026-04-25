import { requestDeleteEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { buildEffectChangesData } from "../../utils/compat.js";
import { createDebugLogger } from "../../utils/debug.js";
import { buildGenericAEMetadata, getGenericAEMetadata, isConditionEffect, mergeGenericAEMetadataIntoFlags } from "./metadata.js";
import { applyGenericAEExpiryAction, buildGenericAEExpiry, toLegacyStartTurnExpiryFlags } from "./expiry.js";
import { applyGenericStackPolicy } from "./stack-policy.js";

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
  if (!globalThis.game?.user?.isGM) return;

  for (const actor of globalThis.game?.actors?.contents ?? []) {
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

export function registerGenericAELifecycleHooks() {
  if (_registered) return;
  _registered = true;

  Hooks.on("deleteCombat", async (combat) => {
    try {
      await _expireCombatEndEffects(combat);
    } catch (err) {
      console.warn("UESRPG | Generic ActiveEffect combat-end expiry failed", err);
    }
  });
}
