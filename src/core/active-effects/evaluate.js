import { collectApplicableEffects, getApplicableEffectsCached } from "./collect.js";
import { createEvaluationMemo, effectMatchesContext } from "./conditions.js";
import { getEffectChangePriority, isAddMode, isOverrideMode, toNumericEffectValue } from "./reducers.js";
import { getEffectChanges, getEffectChangeTypeValue } from "../../utils/compat.js";

/**
 * @typedef {object} AEEvaluateOptions
 * @property {object} [context] Optional evaluation context (e.g., opponentUuid, attackMode, itemUuid).
 * @property {boolean} [enforceConditions=false] If true, will enforce `effect.flags.uesrpg.conditions`.
 * @property {boolean} [dedupeByOrigin=true] If true, will ignore transfer effects duplicating actor effects by origin.
 * @property {boolean} [debug=false] If true, will emit console.debug logs for ignored/unsupported changes.
 */

/**
 * Evaluate a set of modifier keys against the actor's currently-applicable Active Effects.
 *
 * @param {import("foundry").documents.BaseActor} actor
 * @param {string[]} keys
 * @param {AEEvaluateOptions} [options]
 * @returns {Record<string, number>} Map of key->numeric modifier total
 */
export function evaluateAEModifierKeys(actor, keys, options = {}) {
  return _evaluateCore(actor, keys, options).totalsByKey;
}

/**
 * Evaluate a set of modifier keys and return a deterministic breakdown by Active Effect.
 *
 * @param {import("foundry").documents.BaseActor} actor
 * @param {string[]} keys
 * @param {AEEvaluateOptions} [options]
 * @returns {{
 *   totalsByKey: Record<string, number>,
 *   entries: Array<{label:string, value:number, source:"ae", effectId?:string, effectUuid?:string}>,
 *   resolvedByKey: Record<string, number>,
 *   detailsByKey: Record<string, { total: number, contributions: Array<{ label: string, value: number, mode: string, priority?: number, effectId?: string, effectUuid?: string }> }>
 * }}
 */
export function evaluateAEModifierKeysDetailed(actor, keys, options = {}) {
  return _evaluateCore(actor, keys, options);
}

function _evaluateCore(actor, keys, options = {}) {
  const {
    context = null,
    enforceConditions = false,
    dedupeByOrigin = true,
    debug = false
  } = options ?? {};

  const keySet = new Set(Array.isArray(keys) ? keys : []);
  /** @type {Record<string, number>} */
  const totalsByKey = {};
  for (const k of keySet) totalsByKey[k] = 0;

  /** @type {Map<string, { label: string, order: number, value: number, effectId?: string, effectUuid?: string }>} */
  const entriesByEffect = new Map();

  /**
   * Detailed attribution by key.
   *
   * @type {Record<string, { total: number, contributions: Array<{ label: string, value: number, mode: string, priority?: number, effectId?: string, effectUuid?: string }> }>}
   */
  const detailsByKey = {};

  if (!actor || keySet.size === 0) {
    return { totalsByKey, entries: [], resolvedByKey: totalsByKey, detailsByKey };
  }

  // Use the per-actor cache when using the default dedupeByOrigin=true path.
  const effects = dedupeByOrigin
    ? getApplicableEffectsCached(actor)
    : collectApplicableEffects(actor, { dedupeByOrigin, debug });

  const evalMemo = createEvaluationMemo();

  // We aggregate ADD contributions across all effects and independently select the OVERRIDE
  // candidate by priority.
  /** @type {Map<string, Map<string, number>>} */
  const addByKeyByEffect = new Map();
  for (const k of keySet) addByKeyByEffect.set(k, new Map());

  /** @type {Map<string, { effKey: string, value: number, priority: number, order: number }>} */
  const overrideByKey = new Map();

  // Global stable order for change tie-breaking.
  let changeOrder = 0;

  for (let idx = 0; idx < effects.length; idx++) {
    const effect = effects[idx];

    if (enforceConditions && !effectMatchesContext(effect, context, evalMemo)) {
      if (debug) console.debug("[UESRPG|AE] Skipping effect due to conditions", { effect, context });
      continue;
    }

    const changes = getEffectChanges(effect);
    for (const change of changes) {
      const key = change?.key;
      if (!keySet.has(key)) continue;

      const mode = getEffectChangeTypeValue(change);
      const rawValue = change?.value;

      const numeric = toNumericEffectValue(rawValue);
      if (numeric === null) {
        if (debug) console.debug("[UESRPG|AE] Ignoring non-numeric AE change", { change, effect });
        continue;
      }

      const effKey = String(effect?.uuid ?? effect?.id ?? effect?._id ?? `${idx}`);
      const effName = String(effect?.name ?? "Active Effect");

      // Ensure entry exists to preserve stable ordering.
      if (!entriesByEffect.has(effKey)) {
        entriesByEffect.set(effKey, {
          label: effName,
          order: idx,
          value: 0,
          effectId: effect?.id,
          effectUuid: effect?.uuid
        });
      }

      if (isAddMode(mode)) {
        const mapForKey = addByKeyByEffect.get(key);
        if (!mapForKey) continue;
        const prev = mapForKey.get(effKey) ?? 0;
        mapForKey.set(effKey, prev + numeric);
        continue;
      }

      if (isOverrideMode(mode)) {
        const priority = getEffectChangePriority(change);
        const cand = { effKey, value: numeric, priority, order: changeOrder++ };
        const best = overrideByKey.get(key);
        if (!best || cand.priority > best.priority || (cand.priority === best.priority && cand.order > best.order)) {
          overrideByKey.set(key, cand);
        }
        continue;
      }

      if (debug) console.debug("[UESRPG|AE] Ignoring unsupported AE change mode", { mode, change, effect });
    }
  }

  // Finalize totals by key and entries by effect (aggregate across all keys)
  for (const key of keySet) {
    const addMap = addByKeyByEffect.get(key);
    const bestOverride = overrideByKey.get(key);

    /** @type {Array<{ label: string, value: number, mode: string, priority?: number, effectId?: string, effectUuid?: string }>} */
    const contributions = [];

    let addTotal = 0;
    if (addMap) {
      for (const [effKey, v] of addMap.entries()) {
        const n = Number(v) || 0;
        if (!n) continue;
        addTotal += n;
        const entry = entriesByEffect.get(effKey);
        if (entry) entry.value += n;
        contributions.push({
          label: entry?.label ?? "Active Effect",
          value: n,
          mode: "add",
          effectId: entry?.effectId,
          effectUuid: entry?.effectUuid
        });
      }
    }

    let overrideTotal = 0;
    if (bestOverride) {
      overrideTotal = Number(bestOverride.value) || 0;
      const entry = entriesByEffect.get(bestOverride.effKey);
      if (entry) entry.value += overrideTotal;
      contributions.push({
        label: entry?.label ?? "Active Effect",
        value: overrideTotal,
        mode: "override",
        priority: Number(bestOverride.priority) || 0,
        effectId: entry?.effectId,
        effectUuid: entry?.effectUuid
      });
    }

    const keyTotal = addTotal + overrideTotal;
    totalsByKey[key] = keyTotal;
    detailsByKey[key] = { total: keyTotal, contributions };
  }

  // Convert to ordered breakdown, omitting zero-value entries.
  const entries = Array.from(entriesByEffect.values())
    .filter(e => (Number(e.value) || 0) !== 0)
    .sort((a, b) => a.order - b.order)
    .map(e => ({
      label: e.label,
      value: e.value,
      source: "ae",
      effectId: e.effectId,
      effectUuid: e.effectUuid
    }));

  return { totalsByKey, entries, resolvedByKey: totalsByKey, detailsByKey };
}

/**
 * Build a standardized breakdown list from detailsByKey.
 *
 * @param {Record<string, { total: number, contributions: Array<{ label: string, value: number, mode: string, priority?: number, effectId?: string, effectUuid?: string }> }>} detailsByKey
 * @returns {Array<{ label: string, value: number, source: "ae", effectId?: string, effectUuid?: string, detail?: string }>}
 */
export function buildAEBreakdownEntries(detailsByKey) {
  const byEffect = new Map();

  for (const detail of Object.values(detailsByKey ?? {})) {
    const contribs = Array.isArray(detail?.contributions) ? detail.contributions : [];
    for (const c of contribs) {
      const value = Number(c?.value ?? 0) || 0;
      if (!value) continue;

      const label = String(c?.label ?? "Active Effect");
      const effectId = c?.effectId;
      const effectUuid = c?.effectUuid;
      const key = String(effectUuid ?? effectId ?? label);

      const prev = byEffect.get(key);
      if (prev) {
        prev.value += value;
      } else {
        byEffect.set(key, {
          label,
          value,
          source: "ae",
          effectId,
          effectUuid,
          detail: undefined
        });
      }
    }
  }

  return Array.from(byEffect.values()).filter(e => (Number(e.value) || 0) !== 0);
}
