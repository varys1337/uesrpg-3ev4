import { FLAG_SCOPE } from "../system/namespace.js";
import { getSystemFlagsWithFallback } from "../system/flags.js";
import { buildEffectChangesUpdate, getEffectChanges, normalizeEffectChanges } from "../../utils/compat.js";
import { createDebugLogger } from "../../utils/debug.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { getGenericAEMetadata, isConditionEffect } from "./metadata.js";
import { resolveUuidSync } from "../../utils/uuid-cache.js";
import {
  buildSpellEffectDurationV14,
  isFiniteDuration,
  SPELL_EFFECT_DURATION_FLAG_KEY
} from "./effect-duration-v14.js";

const _debug = createDebugLogger("aeLifecycleDebug", "[UESRPG][AEIntegrity]");

const _SEPARATE_SYSTEM_FLAG_KEYS = Object.freeze([
  "condition",
  "wound",
  "wounds",
  "spell",
  "spellEffect",
  "spellUpkeep",
  "overTime",
  "overtime",
  "OverTime",
  "upkeep",
]);

function _stableJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch (_err) {
    return "";
  }
}

function _changesNeedSystemMirror(effect) {
  const changes = getEffectChanges(effect);
  if (!changes.length) return false;
  const systemChanges = Array.isArray(effect?.system?.changes) ? normalizeEffectChanges(effect.system.changes) : [];
  return _stableJson(systemChanges) !== _stableJson(changes);
}

function _hasSeparateSystemMetadata(effect) {
  if (isConditionEffect(effect)) return true;

  const flags = getSystemFlagsWithFallback(effect) ?? {};
  for (const key of _SEPARATE_SYSTEM_FLAG_KEYS) {
    if (flags?.[key] != null) return true;
  }

  const source = String(flags?.source ?? "").trim().toLowerCase();
  if (source === "condition" || source === "wound" || source === "spell-upkeep" || source === "overtime") return true;

  const group = String(flags?.effectGroup ?? "").trim().toLowerCase();
  if (group.startsWith("condition.") || group.startsWith("wound.") || group.startsWith("spell.") || group.startsWith("overtime.")) return true;

  return false;
}

function _hasGenericModifierChanges(effect) {
  const changes = getEffectChanges(effect);
  return changes.some((change) => {
    const key = String(change?.key ?? "").trim();
    if (!key) return false;
    if (key.startsWith("system.modifiers.")) return true;
    if (key.startsWith(`flags.${FLAG_SCOPE}.combat.`)) return true;
    if (key.startsWith("flags.uesrpg.combat.")) return true;
    return false;
  });
}

function _buildGenericMetadataBackfill(effect) {
  if (getGenericAEMetadata(effect)) return {};
  if (_hasSeparateSystemMetadata(effect)) return {};
  if (!_hasGenericModifierChanges(effect)) return {};

  const flags = getSystemFlagsWithFallback(effect) ?? {};
  const category = String(flags?.category ?? "").trim().toLowerCase();
  const source = category === "advantage" ? "combat" : "manual";

  return {
    [`flags.${FLAG_SCOPE}.ae.kind`]: "generic",
    [`flags.${FLAG_SCOPE}.ae.source`]: source,
    [`flags.${FLAG_SCOPE}.ae.expiryAction`]: "delete",
    [`flags.${FLAG_SCOPE}.ae.stack.policy`]: "none",
  };
}

function _isSystemSpellEffect(effect) {
  const flags = getSystemFlagsWithFallback(effect) ?? {};
  return Boolean(flags?.spellEffect) && String(flags?.owner ?? "") === "system";
}

function _resolveOriginSpell(effect) {
  const origin = String(effect?.origin ?? "").trim();
  if (!origin) return null;
  const doc = resolveUuidSync(origin);
  return doc?.documentName === "Item" ? doc : null;
}

function _buildSpellDurationBackfill(effect) {
  if (!_isSystemSpellEffect(effect)) return {};

  const flags = getSystemFlagsWithFallback(effect) ?? {};
  let canonical = flags?.[SPELL_EFFECT_DURATION_FLAG_KEY] ?? null;

  if (!canonical) {
    const spell = _resolveOriginSpell(effect);
    if (spell) {
      const durationInfo = buildSpellEffectDurationV14(spell, effect.parent, {
        actor: effect.parent,
        spellOptions: flags?.spellOptions ?? null,
        scalingChoices: flags?.scalingChoices ?? null,
        castContext: flags?.castContext ?? null,
        hasUpkeep: Boolean(flags?.hasUpkeep)
      });
      canonical = durationInfo.spellEffectDuration;
    }
  }

  if (!canonical) return {};
  const normalized = {
    value: canonical.value,
    units: canonical.units,
    expiry: canonical.expiry ?? null
  };
  const liveDuration = effect.duration ?? {};
  const update = {};

  const hasNativeDuration = Object.prototype.hasOwnProperty.call(liveDuration, "value")
    && typeof liveDuration.units === "string"
    && Object.prototype.hasOwnProperty.call(liveDuration, "expiry");
  if (!hasNativeDuration) {
    if (liveDuration.value !== normalized.value) update["duration.value"] = normalized.value;
    if (liveDuration.units !== normalized.units) update["duration.units"] = normalized.units;
    if ((liveDuration.expiry ?? null) !== normalized.expiry) update["duration.expiry"] = normalized.expiry;
  }
  if (flags?.[SPELL_EFFECT_DURATION_FLAG_KEY] == null) {
    update[`flags.${FLAG_SCOPE}.${SPELL_EFFECT_DURATION_FLAG_KEY}`] = canonical;
  }

  if (!isFiniteDuration(normalized) && liveDuration.value == null && liveDuration.expiry == null) {
    delete update["duration.value"];
    delete update["duration.expiry"];
  }

  return update;
}

export function buildActiveEffectIntegrityUpdate(effect) {
  if (!effect || effect.documentName !== "ActiveEffect") return {};

  const update = {};
  if (_changesNeedSystemMirror(effect)) {
    Object.assign(update, buildEffectChangesUpdate(getEffectChanges(effect)));
  }

  Object.assign(update, _buildGenericMetadataBackfill(effect));
  Object.assign(update, _buildSpellDurationBackfill(effect));
  return update;
}

export async function normalizeActiveEffectIntegrity(effect) {
  const update = buildActiveEffectIntegrityUpdate(effect);
  if (!Object.keys(update).length) return false;

  const ok = await requestUpdateDocument(effect, update);
  if (ok) {
    _debug("normalized effect", {
      uuid: effect.uuid ?? null,
      name: effect.name ?? null,
      keys: Object.keys(update),
    });
  }
  return ok;
}

function _actorAndItemEffects(actor) {
  const out = [];
  for (const effect of actor?.effects ?? []) out.push(effect);
  for (const item of actor?.items ?? []) {
    for (const effect of item?.effects ?? []) out.push(effect);
  }
  return out;
}

export async function normalizeActorActiveEffectsIntegrity(actor) {
  if (!actor) return { checked: 0, updated: 0 };
  let checked = 0;
  let updated = 0;

  for (const effect of _actorAndItemEffects(actor)) {
    checked += 1;
    if (await normalizeActiveEffectIntegrity(effect)) updated += 1;
  }

  return { checked, updated };
}

export async function runActiveEffectIntegrityNormalization({ actors = null } = {}) {
  if (!game?.user?.isGM) return { checked: 0, updated: 0 };

  const actorList = Array.isArray(actors) ? actors : Array.from(game?.actors?.contents ?? []);
  let checked = 0;
  let updated = 0;

  for (const actor of actorList) {
    const result = await normalizeActorActiveEffectsIntegrity(actor);
    checked += result.checked;
    updated += result.updated;
  }

  try {
    const { cleanupExpiredSpellEffects } = await import("../magic/effects/spell-effect-expiration.js");
    await cleanupExpiredSpellEffects({ actors: actorList, source: "ready-integrity" });
  } catch (err) {
    console.warn("UESRPG | AEIntegrity | Expired spell cleanup failed", err);
  }

  if (updated > 0) _debug("ready normalization complete", { checked, updated });
  return { checked, updated };
}
