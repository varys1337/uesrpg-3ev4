import { isItemEffectActive } from "./transfer.js";
import { anyOtherTokensInMeleeOfEither, getMeleeReachMeters } from "../traits/combat-proximity.js";

function _resolveTokenFromUuid(tokenUuid) {
  try {
    if (!tokenUuid || typeof tokenUuid !== "string") return null;
    const doc = fromUuidSync(tokenUuid);
    if (!doc) return null;
    // TokenDocument -> Token
    if (doc.documentName === "Token" && doc.object) return doc.object;
    if (doc.object) return doc.object;
    return null;
  } catch (_e) {
    return null;
  }
}

/**
 * UESRPG Active Effect Modifier Evaluator
 *
 * Purpose:
 * - Deterministically aggregate a subset of Active Effect changes into numeric modifiers.
 * - Avoid reliance on Foundry's implicit AE application semantics for gameplay-critical math.
 *
 * Supported behaviors:
 * - Only `ADD` and `OVERRIDE` modes are intentionally supported for numeric aggregation.
 * - All other AE change modes are ignored by default (opt-in debug logging via options).
 *
 * Notes:
 * - This evaluator is "context-capable" but context checks are opt-in and no-op by default.
 * - Dedupe-by-origin is conservative: if an actor already has an effect with the same origin
 *   as a transfer effect, the transfer effect is ignored to prevent double-application.
 */

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
 * This is used by opposed-roll TN breakdown cards so users can see which effects contributed.
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
  // The cache is invalidated by AE lifecycle hooks (see init.js _aeCacheInvalidationHooks).
  const effects = dedupeByOrigin
    ? getApplicableEffectsCached(actor)
    : collectApplicableEffects(actor, { dedupeByOrigin, debug });

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

    if (enforceConditions && !_effectMatchesContext(effect, context)) {
      if (debug) console.debug(`[UESRPG|AE] Skipping effect due to conditions`, { effect, context });
      continue;
    }

    const changes = Array.isArray(effect.changes) ? effect.changes : [];
    for (const change of changes) {
      const key = change?.key;
      if (!keySet.has(key)) continue;

      const mode = change?.mode;
      const rawValue = change?.value;

      const numeric = _toNumber(rawValue);
      if (numeric === null) {
        if (debug) console.debug(`[UESRPG|AE] Ignoring non-numeric AE change`, { change, effect });
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

      if (_isAddMode(mode)) {
        const mapForKey = addByKeyByEffect.get(key);
        if (!mapForKey) continue;
        const prev = mapForKey.get(effKey) ?? 0;
        mapForKey.set(effKey, prev + numeric);
        continue;
      }

      if (_isOverrideMode(mode)) {
        const priority = _getChangePriority(change);
        const cand = { effKey, value: numeric, priority, order: changeOrder++ };
        const best = overrideByKey.get(key);
        if (!best || cand.priority > best.priority || (cand.priority === best.priority && cand.order > best.order)) {
          overrideByKey.set(key, cand);
        }
        continue;
      }

      if (debug) console.debug(`[UESRPG|AE] Ignoring unsupported AE change mode`, { mode, change, effect });
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
          mode: "ADD",
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
        mode: "OVERRIDE",
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
 * This helper is intentionally UI-agnostic: it aggregates per-effect totals and returns
 * stable, display-ready entries. Callers may still choose to bucket by key if desired.
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
          // Optional detail string: include mode/priority only when caller needs it.
          detail: undefined
        });
      }
    }
  }

  // Preserve stable ordering where possible: Effect UUIDs embed document order/identity.
  return Array.from(byEffect.values()).filter(e => (Number(e.value) || 0) !== 0);
}

/**
 * Collect currently-applicable effects from actor + transferable embedded item effects.
 * Uses the system's transfer gating helper when available.
 *
 * Exported so that other AE aggregation helpers (e.g. actors/ae/modifiers.js) share
 * the same collection, disabled-filtering, and origin-deduplication logic.
 *
 * @param {import("foundry").documents.BaseActor} actor
 * @param {{dedupeByOrigin?:boolean, debug?:boolean}} [options]
 * @returns {any[]} Array of ActiveEffect-like objects
 */
export function collectApplicableEffects(actor, { dedupeByOrigin = true, debug = false } = {}) {
  // Filter out disabled actor effects — a disabled effect must not contribute
  // changes to modifier totals (matches actors/ae/modifiers.js behavior).
  const actorEffects = Array.from(actor.effects ?? []).filter(e => e && !e.disabled);

  // Index origins already present directly on the actor.
  const actorOrigins = new Set(
    actorEffects.map(e => e?.origin).filter(o => typeof o === "string" && o.length > 0)
  );

  /** @type {any[]} */
  const transferable = [];

  // Collect transfer effects from embedded items (actor-owned).
  for (const item of actor.items ?? []) {
    const itemEffects = Array.from(item?.effects ?? []);
    for (const effect of itemEffects) {
      // Respect existing gating helper if present, otherwise fallback to transfer flag.
      let isActive = false;
      try {
        // Use the system's deterministic transfer gating (same as actor-sheet TN breakdown).
        isActive = isItemEffectActive(actor, item, effect);
      } catch (err) {
        if (debug) console.debug(`[UESRPG|AE] Transfer gating threw; skipping effect`, { err, effect, item });
        isActive = false;
      }

      if (!isActive) continue;

      if (dedupeByOrigin) {
        const origin = effect?.origin;
        if (origin && actorOrigins.has(origin)) {
          if (debug) console.debug(`[UESRPG|AE] Dedupe transfer effect by origin`, { origin, effect, item });
          continue;
        }
      }

      transferable.push(effect);
    }
  }

  return actorEffects.concat(transferable);
}

/**
 * Return applicable effects for an actor, using a per-actor ephemeral cache.
 *
 * The cache is stored as `actor._aeApplicableCache = { effects }` and is cleared
 * by AE lifecycle hooks (_aeCacheInvalidationHooks in src/hooks/init.js) whenever
 * any ActiveEffect or embedded Item changes on the actor.
 *
 * Only supports the default `dedupeByOrigin: true` path. Callers that need
 * `dedupeByOrigin: false` should call `collectApplicableEffects` directly.
 *
 * @param {import("foundry").documents.BaseActor} actor
 * @returns {any[]} Array of ActiveEffect-like objects
 */
export function getApplicableEffectsCached(actor) {
  const cache = actor?._aeApplicableCache;
  if (cache?.effects) return cache.effects;
  const effects = collectApplicableEffects(actor, { dedupeByOrigin: true, debug: false });
  if (actor) actor._aeApplicableCache = { effects };
  return effects;
}

/**
 * Optional condition matching for context-specific effects.
 * Convention:
 * - effect.flags.uesrpg.conditions is an object with optional keys like:
 *   - opponentUuid, attackMode, itemUuid
 *
 * This is intentionally strict: if conditions exist, all present ones must match.
 *
 * @param {any} effect
 * @param {object|null} context
 * @returns {boolean}
 */
function _effectMatchesContext(effect, context) {
  const conditions = effect?.flags?.uesrpg?.conditions;
  if (!conditions || typeof conditions !== "object") return true;

  if (!context || typeof context !== "object") return false;

  for (const [k, expected] of Object.entries(conditions)) {
    if (expected === undefined) continue;

    // Talent: Exploit Advantage (isolated duel)
    // Some temporary combat effects (Press Advantage / Overextend) encode an additional
    // constraint in `requireIsolatedDuel`. This must be evaluated dynamically against
    // the current scene tokens, not via strict context equality.
    if (k === "requireIsolatedDuel") {
      if (!expected) continue;

      const sourceUuid = String(effect?.flags?.uesrpg?.source?.tokenUuid ?? "") || null;
      const targetUuid = String(effect?.flags?.uesrpg?.target?.tokenUuid ?? "") || null;

      const tokenA = _resolveTokenFromUuid(sourceUuid) ?? _resolveTokenFromUuid(context?.actorTokenUuid);
      const tokenB = _resolveTokenFromUuid(targetUuid) ?? _resolveTokenFromUuid(context?.opponentTokenUuid);

      if (!tokenA || !tokenB) return false;

      const reachA = getMeleeReachMeters(tokenA.actor);
      const reachB = getMeleeReachMeters(tokenB.actor);

      // The constraint is: "no other characters within melee range of either combatant".
      const anyOther = anyOtherTokensInMeleeOfEither(tokenA, tokenB, {
        reachMetersA: reachA,
        reachMetersB: reachB
      });

      if (anyOther) return false;
      continue;
    }

    // RAW (Chapter 5): Overextend applies to the opponent's next attack within 1 round
    // regardless of who that attack targets. Some legacy effects store opponent scoping
    // in conditions.opponentUuid; ignore that scoping for Overextend so it applies to
    // the next attack against any target.
    const uesrpgKey = effect?.flags?.uesrpg?.key;
    if (uesrpgKey === "overextend" && k === "opponentUuid") continue;

    // Canonical combat lane: `context.attackMode`. Older chat cards/effects may use `attackType`.
    if (k === "attackMode" || k === "attackType") {
      const actual = (context.attackMode ?? context.attackType ?? "");
      if (String(actual).toLowerCase() !== String(expected).toLowerCase()) return false;
      continue;
    }

    if (context[k] !== expected) return false;
  }

  return true;
}

function _toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
    return null;
  }

  // Do not attempt to coerce booleans/objects.
  return null;
}

function _isAddMode(mode) {
  // Foundry uses CONST.ACTIVE_EFFECT_MODES; support numeric + string.
  if (mode === 2 || mode === "ADD") return true;
  const CONST_MODES = globalThis?.CONST?.ACTIVE_EFFECT_MODES;
  if (CONST_MODES && mode === CONST_MODES.ADD) return true;
  return false;
}

function _isOverrideMode(mode) {
  if (mode === 5 || mode === "OVERRIDE") return true;
  const CONST_MODES = globalThis?.CONST?.ACTIVE_EFFECT_MODES;
  if (CONST_MODES && mode === CONST_MODES.OVERRIDE) return true;
  return false;
}

function _getChangePriority(change) {
  // EffectChangeData.priority exists in Foundry v13. Prefer it directly.
  const pr = Number(change?.priority);
  if (Number.isFinite(pr)) return pr;

  // Defensive fallback: Foundry exposes defaults on ActiveEffectConfig.
  const defaults = globalThis?.ActiveEffectConfig?.DEFAULT_PRIORITIES;
  if (defaults && typeof defaults === "object") {
    const mode = change?.mode;
    if (typeof mode === "number" && Number.isFinite(mode) && mode in defaults) {
      const n = Number(defaults[mode]);
      if (Number.isFinite(n)) return n;
    }
  }

  return 0;
}
