import {
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
  requestUpdateEmbeddedDocuments,
} from "../../utils/authority-proxy.js";
import { getEffectChanges, buildEffectChangesData, buildEffectChangesUpdate, normalizeActiveEffectOrigin } from "../../utils/compat.js";
import { createDebugLogger } from "../../utils/debug.js";
import { toNumericEffectValue } from "./reducers.js";
import { stableStringify } from "../../utils/authority-proxy/shared.js";
import {
  getGenericAEMetadata,
  getSystemAEFlags,
  isConditionEffect,
  isGenericAESuppressed,
} from "./metadata.js";

const _debug = createDebugLogger("aeLifecycleDebug", "[UESRPG][AEStack]");

function _create(actor, effectData, { timeout = 5000, createOptions = {} } = {}) {
  return requestCreateEmbeddedDocuments(actor, "ActiveEffect", [{
    ...effectData,
    ...buildEffectChangesData(getEffectChanges(effectData)),
  }], { timeout, createOptions }).then((created) => Array.isArray(created) ? (created[0] ?? null) : null);
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
  const contents = effect?.parent?.effects?.contents;
  const index = Array.isArray(contents) ? contents.findIndex((candidate) => candidate?.id === effect?.id) : -1;
  if (index >= 0) return index;
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

/** Pure policy planning, shared by ordinary application and transactional drops. */
export function planGenericStackPolicy(actor, effectData) {
  const policy = isConditionEffect(effectData) ? null : _policy(effectData);
  const origin = normalizeActiveEffectOrigin(effectData?.origin);
  const group = _group(effectData, policy);
  const existing = policy && policy !== "none" && (group || policy === "same-origin-refresh")
    ? Array.from(actor.effects ?? []).filter(effect => _matchesGroup(effect, group, policy, origin)).sort((a, b) => _effectOrder(a) - _effectOrder(b))
    : [];
  const plan = { policy, group, origin, action: "create", existing, affected: [], max: 0, retained: null };
  if (["refresh", "same-origin-refresh"].includes(policy) && existing.length) {
    plan.action = "refresh";
    plan.affected = [existing.at(-1)];
  } else if (policy === "replace") {
    plan.affected = existing;
  } else if (policy === "keep-strongest") {
    const key = getGenericAEMetadata(effectData)?.stack?.strengthKey ?? null;
    const strongest = existing.map(effect => ({ effect, strength: _strength(effect, key) }))
      .sort((a, b) => a.strength - b.strength || _effectOrder(a.effect) - _effectOrder(b.effect)).at(-1);
    if (strongest && _strength(effectData, key) <= strongest.strength) {
      plan.action = "retain";
      plan.retained = strongest.effect;
    } else plan.affected = existing;
  } else if (policy === "cap") {
    plan.max = Math.max(0, Number(getGenericAEMetadata(effectData)?.stack?.max ?? 0) || 0);
    const participates = _matchesGroup(effectData, group, policy, origin) ? 1 : 0;
    if (plan.max > 0) plan.affected = existing.slice(0, Math.max(0, existing.length + participates - plan.max));
  }
  return plan;
}

export function effectSourceSignature(effect) {
  const data = effect?.toObject ? effect.toObject() : foundry.utils.deepClone(effect);
  // Compare public serialized data, excluding bookkeeping changed by every native write.
  return stableStringify(Object.fromEntries(Object.entries(data).filter(([key]) => key !== "_stats")));
}

function _refreshData(existing, data) {
  const update = {
    _id: existing.id,
    name: data.name ?? existing.name,
    img: data.img ?? data.icon ?? existing.img,
    ...buildEffectChangesUpdate(getEffectChanges(data)),
    flags: data.flags ?? existing.flags,
    duration: data.duration ?? existing.duration,
    disabled: data.disabled ?? false,
    origin: normalizeActiveEffectOrigin(data.origin) ?? normalizeActiveEffectOrigin(existing.origin),
    statuses: data.statuses ?? existing.statuses,
    tint: data.tint ?? existing.tint,
    transfer: data.transfer ?? existing.transfer,
  };
  for (const key of ["start", "description", "showIcon", "type"]) {
    if (data[key] !== undefined) update[key] = data[key];
  }
  if (data.system !== undefined) update.system = { ...data.system, changes: getEffectChanges(data) };
  return update;
}

/** A journal records only documents touched by this application, never an actor snapshot. */
function _journal(actor, affected) {
  const records = new Map(affected.map(effect => [effect.id, {
    before: effect.toObject(), expected: effectSourceSignature(effect), touched: false,
  }]));
  let finished = false;
  return {
    check() {
      for (const [id, row] of records) {
        const live = actor.effects.get(id);
        if ((live ? effectSourceSignature(live) : null) !== row.expected) throw new Error("Changed");
      }
    },
    record(id, expected) {
      const row = records.get(id) ?? { before: null };
      row.touched = true;
      row.expected = expected ? effectSourceSignature(expected) : null;
      records.set(id, row);
    },
    async rollback() {
      if (finished) return false;
      finished = true;
      let ok = true;
      for (const [id, row] of [...records].reverse()) {
        if (!row.touched) continue;
        try {
          const live = actor.effects.get(id);
          if (!row.before && !live) continue;
          // A rejected operation which left the original untouched needs no compensation.
          if (row.before && live && effectSourceSignature(live) === effectSourceSignature(row.before)) continue;
          if ((live ? effectSourceSignature(live) : null) !== row.expected) { ok = false; continue; }
          if (!row.before) {
            if (live && !await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [id], { requireDeleted: true })) ok = false;
          } else if (live) {
            if (!await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", [row.before], {
              updateOptions: { diff: false, recursive: false }, requireUpdated: true,
            })) ok = false;
          } else {
            const restored = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [row.before], {
              createOptions: { keepId: true, uesrpgPreserveEffectTiming: true },
            });
            if (restored?.[0]?.id !== id) ok = false;
          }
          const restored = actor.effects.get(id);
          if (row.before && (!restored || effectSourceSignature(restored) !== effectSourceSignature(row.before))) ok = false;
        } catch (_error) { ok = false; }
      }
      return ok;
    },
  };
}

async function _applyStack(actor, effectData, options = {}) {
  const { timeout = 5000, transactional = false, preserveTiming = false, validateSource, validateEffect } = options;
  const plan = planGenericStackPolicy(actor, effectData);
  const journal = transactional ? _journal(actor, plan.affected) : null;
  const guard = () => { validateSource?.(); journal?.check(); };
  const createOptions = preserveTiming ? { uesrpgPreserveEffectTiming: true } : {};
  let effect = null;
  try {
    guard();
    for (const row of plan.affected) validateEffect?.(row);
    if (plan.action === "retain") return { effect: plan.retained, applied: false, rollback: async () => true, verify: guard };
    if (plan.action === "refresh") {
      const existing = plan.affected[0];
      const update = _refreshData(existing, effectData);
      const expected = { ...existing.toObject(), ...foundry.utils.expandObject(update) };
      _debug("Refreshing grouped ActiveEffect", { actor: actor.uuid, group: plan.group, policy: plan.policy });
      const updated = await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", [update], {
        timeout, requireUpdated: transactional,
        updateOptions: transactional ? { recursive: false } : {},
      });
      // Record our intended write, never adopt a concurrent writer's data for rollback.
      journal?.record(existing.id, expected);
      if (!updated && transactional) throw new Error("Failed");
      effect = actor.effects.get(existing.id);
    } else {
      if (!transactional && ["replace", "keep-strongest"].includes(plan.policy)) {
        const ids = plan.affected.map(row => row.id);
        if (ids.length) await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", ids, { timeout });
      }
      if (transactional) {
        // Knowing the new id also lets compensation inspect a partially failed create.
        effectData = { ...effectData, _id: foundry.utils.randomID() };
        createOptions.keepId = true;
        const expected = new CONFIG.ActiveEffect.documentClass(foundry.utils.deepClone(effectData), { parent: actor }).toObject();
        journal.record(effectData._id, expected);
      }
      effect = await _create(actor, effectData, { timeout, createOptions });
      if (!effect || !actor.effects.get(effect.id)) {
        if (transactional) throw new Error("Failed");
        return { effect: null, applied: false };
      }
      journal?.record(effect.id, effect.toObject());
      guard();
      let remove = !transactional && ["replace", "keep-strongest"].includes(plan.policy) ? [] : plan.affected;
      if (plan.policy === "cap" && plan.max > 0) {
        const after = Array.from(actor.effects ?? []).filter(row => _matchesGroup(row, plan.group, plan.policy, plan.origin))
          .sort((a, b) => _effectOrder(a) - _effectOrder(b));
        remove = after.slice(0, Math.max(0, after.length - plan.max));
        // The transfer appends at the end; foreign callers can intentionally use a different sort.
        if (transactional && remove.some(row => row.id !== effect.id && !plan.affected.some(before => before.id === row.id))) throw new Error("Changed");
      }
      for (const row of remove) {
        guard();
        validateEffect?.(row);
        const deleted = await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [row.id], { timeout, requireDeleted: transactional });
        journal?.record(row.id, null);
        if (!deleted) throw new Error("Failed");
      }
    }
    guard();
    const applied = Boolean(effect && actor.effects.get(effect.id));
    return { effect, applied, rollback: journal ? () => journal.rollback() : async () => true, verify: guard };
  } catch (error) {
    error.rollbackComplete = journal ? await journal.rollback() : true;
    throw error;
  }
}

/** Existing callers still receive an ActiveEffect (or null), preserving the internal contract. */
export async function applyGenericStackPolicy(actor, effectData, { timeout = 5000 } = {}) {
  if (!actor || !effectData) return null;
  return (await _applyStack(actor, effectData, { timeout })).effect;
}

/** Optional compensating rollback used only by effect drops. */
export function applyGenericStackPolicyTransaction(actor, effectData, options = {}) {
  return _applyStack(actor, effectData, { ...options, transactional: true });
}
