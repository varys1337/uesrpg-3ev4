import {
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
  requestUpdateEmbeddedDocuments,
} from "../../utils/authority-proxy.js";
import { getEffectChanges, buildEffectChangesData, buildEffectChangesUpdate, normalizeActiveEffectOrigin } from "../../utils/compat.js";
import { createDebugLogger } from "../../utils/debug.js";
import { toNumericEffectValue } from "./reducers.js";
import {
  getGenericAEMetadata,
  getSystemAEFlags,
  isConditionEffect,
  isGenericAESuppressed,
} from "./metadata.js";

const _debug = createDebugLogger("aeLifecycleDebug", "[UESRPG][AEStack]");

function _create(actor, effectData, { timeout = 5000 } = {}) {
  return requestCreateEmbeddedDocuments(actor, "ActiveEffect", [{
    ...effectData,
    ...buildEffectChangesData(getEffectChanges(effectData)),
  }], { timeout }).then((created) => Array.isArray(created) ? (created[0] ?? null) : null);
}

function _legacyPolicy(effectData) {
  const flags = getSystemAEFlags(effectData);
  const rule = String(flags?.stackRule ?? "").trim().toLowerCase();
  if (rule === "override" || rule === "replace") return "replace";
  if (rule === "refresh") return "refresh";
  if (rule === "stack") return "none";
  return null;
}

function _policy(effectData) {
  const meta = getGenericAEMetadata(effectData);
  const canonical = meta?.stack?.policy && meta.stack.policy !== "none" ? meta.stack.policy : null;
  if (canonical) return canonical;
  return _legacyPolicy(effectData);
}

function _group(effectData, policy) {
  const meta = getGenericAEMetadata(effectData);
  if (meta?.stack?.group) return meta.stack.group;

  const flags = getSystemAEFlags(effectData);
  const legacyGroup = String(flags?.effectGroup ?? "").trim();
  if (legacyGroup) return legacyGroup;

  if (policy === "same-origin-refresh") {
    const origin = normalizeActiveEffectOrigin(effectData?.origin);
    if (origin) return `origin:${origin}`;
  }

  return null;
}

function _matchesGroup(effect, group, policy, incomingOrigin) {
  if (!effect || effect.disabled || isGenericAESuppressed(effect)) return false;
  if (isConditionEffect(effect)) return false;

  if (policy === "same-origin-refresh" && incomingOrigin) {
    return normalizeActiveEffectOrigin(effect?.origin) === incomingOrigin;
  }

  const meta = getGenericAEMetadata(effect);
  const flags = getSystemAEFlags(effect);
  const existingGroup = meta?.stack?.group || String(flags?.effectGroup ?? "").trim();
  return Boolean(group && existingGroup === group);
}

function _effectOrder(effect) {
  const sort = Number(effect?.sort);
  if (Number.isFinite(sort)) return sort;
  const time = Number(effect?._stats?.createdTime ?? effect?._stats?.modifiedTime);
  if (Number.isFinite(time)) return time;
  return 0;
}

function _strength(effectOrData, strengthKey = null) {
  const changes = getEffectChanges(effectOrData);
  let total = 0;
  for (const change of changes) {
    if (strengthKey && String(change?.key ?? "") !== strengthKey) continue;
    const n = toNumericEffectValue(change?.value);
    if (n === null) continue;
    total += Math.abs(Number(n) || 0);
  }
  return total;
}

async function _refreshExisting(actor, existing, effectData, { timeout = 5000 } = {}) {
  const updateData = {
    _id: existing.id,
    name: effectData.name ?? existing.name,
    img: effectData.img ?? effectData.icon ?? existing.img,
    ...buildEffectChangesUpdate(Array.isArray(effectData.changes) ? effectData.changes : getEffectChanges(effectData)),
    flags: effectData.flags ?? existing.flags,
    duration: effectData.duration ?? existing.duration,
    disabled: effectData.disabled ?? false,
    origin: normalizeActiveEffectOrigin(effectData.origin) ?? normalizeActiveEffectOrigin(existing.origin),
    statuses: effectData.statuses ?? existing.statuses,
    tint: effectData.tint ?? existing.tint,
    transfer: effectData.transfer ?? existing.transfer,
  };

  await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", [updateData], { timeout });
  return actor.effects?.get?.(existing.id) ?? existing;
}

export async function applyGenericStackPolicy(actor, effectData, { timeout = 5000 } = {}) {
  if (!actor || !effectData) return null;
  if (isConditionEffect(effectData)) return _create(actor, effectData, { timeout });

  const policy = _policy(effectData);
  if (!policy || policy === "none") return _create(actor, effectData, { timeout });

  const incomingOrigin = normalizeActiveEffectOrigin(effectData?.origin);
  const group = _group(effectData, policy);
  if (!group && policy !== "same-origin-refresh") return _create(actor, effectData, { timeout });

  const existingEffects = Array.from(actor.effects ?? [])
    .filter((effect) => _matchesGroup(effect, group, policy, incomingOrigin))
    .sort((a, b) => _effectOrder(a) - _effectOrder(b));

  if (policy === "refresh" || policy === "same-origin-refresh") {
    if (existingEffects.length) {
      const existing = existingEffects[existingEffects.length - 1];
      _debug("Refreshing grouped ActiveEffect", { actor: actor?.uuid ?? null, group, policy });
      return await _refreshExisting(actor, existing, effectData, { timeout });
    }
    return _create(actor, effectData, { timeout });
  }

  if (policy === "replace") {
    const ids = existingEffects.map((effect) => effect?.id).filter(Boolean);
    if (ids.length) await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", ids, { timeout });
    return _create(actor, effectData, { timeout });
  }

  if (policy === "keep-strongest") {
    const meta = getGenericAEMetadata(effectData);
    const strengthKey = meta?.stack?.strengthKey ?? null;
    const incomingStrength = _strength(effectData, strengthKey);
    const strongestExisting = existingEffects
      .map((effect) => ({ effect, strength: _strength(effect, strengthKey) }))
      .sort((a, b) => a.strength - b.strength || _effectOrder(a.effect) - _effectOrder(b.effect))
      .at(-1);

    if (!strongestExisting || incomingStrength > strongestExisting.strength) {
      const ids = existingEffects.map((effect) => effect?.id).filter(Boolean);
      if (ids.length) await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", ids, { timeout });
      return _create(actor, effectData, { timeout });
    }
    return strongestExisting.effect ?? null;
  }

  if (policy === "cap") {
    const created = await _create(actor, effectData, { timeout });
    const meta = getGenericAEMetadata(effectData);
    const max = Math.max(0, Number(meta?.stack?.max ?? 0) || 0);
    if (max <= 0) return created;

    const afterCreate = Array.from(actor.effects ?? [])
      .filter((effect) => _matchesGroup(effect, group, policy, incomingOrigin))
      .sort((a, b) => _effectOrder(a) - _effectOrder(b));
    const excess = Math.max(0, afterCreate.length - max);
    if (excess > 0) {
      const ids = afterCreate.slice(0, excess).map((effect) => effect?.id).filter(Boolean);
      if (ids.length) await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", ids, { timeout });
    }
    return created;
  }

  return _create(actor, effectData, { timeout });
}
