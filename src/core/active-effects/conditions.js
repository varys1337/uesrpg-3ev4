import { createUuidResolver } from "../../utils/uuid-cache.js";
import { anyOtherTokensInMeleeOfEither, getMeleeReachMeters } from "../traits/combat-proximity.js";
import { getFlagValueWithFallback } from "../system/flags.js";

function _resolveTokenFromUuid(tokenUuid, memo = null) {
  try {
    if (!tokenUuid || typeof tokenUuid !== "string") return null;
    const resolver = memo?.uuid;
    const doc = resolver ? resolver.resolveSync(tokenUuid) : fromUuidSync(tokenUuid);
    if (!doc) return null;
    // TokenDocument -> Token
    if (doc.documentName === "Token" && doc.object) return doc.object;
    if (doc.object) return doc.object;
    return null;
  } catch (_e) {
    return null;
  }
}

function _isolatedDuelCacheKey(tokenA, tokenB) {
  const a = String(tokenA?.document?.uuid ?? tokenA?.uuid ?? "");
  const b = String(tokenB?.document?.uuid ?? tokenB?.uuid ?? "");
  if (!a || !b) return null;
  const pair = [a, b].sort();
  const sceneId = String(tokenA?.document?.parent?.id ?? tokenA?.scene?.id ?? tokenB?.document?.parent?.id ?? tokenB?.scene?.id ?? "");
  return `${sceneId}|${pair[0]}|${pair[1]}`;
}

function _isIsolatedDuel(tokenA, tokenB, memo = null) {
  if (!tokenA || !tokenB) return false;

  const key = _isolatedDuelCacheKey(tokenA, tokenB);
  if (key && memo?.isolatedDuel?.has(key)) return memo.isolatedDuel.get(key);

  const reachA = getMeleeReachMeters(tokenA.actor);
  const reachB = getMeleeReachMeters(tokenB.actor);
  const anyOther = anyOtherTokensInMeleeOfEither(tokenA, tokenB, {
    reachMetersA: reachA,
    reachMetersB: reachB
  });
  const isolated = !anyOther;

  if (key && memo?.isolatedDuel) memo.isolatedDuel.set(key, isolated);
  return isolated;
}

export function createEvaluationMemo() {
  return {
    isolatedDuel: new Map(),
    uuid: createUuidResolver()
  };
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
 * @param {{isolatedDuel: Map<string, boolean>, uuid: ReturnType<typeof createUuidResolver>}} [memo]
 * @returns {boolean}
 */
export function effectMatchesContext(effect, context, memo = null) {
  const conditions = getFlagValueWithFallback(effect, "conditions");
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

      const sourceUuid = String(getFlagValueWithFallback(effect, "source.tokenUuid") ?? "") || null;
      const targetUuid = String(getFlagValueWithFallback(effect, "target.tokenUuid") ?? "") || null;

      const tokenA = _resolveTokenFromUuid(sourceUuid, memo) ?? _resolveTokenFromUuid(context?.actorTokenUuid, memo);
      const tokenB = _resolveTokenFromUuid(targetUuid, memo) ?? _resolveTokenFromUuid(context?.opponentTokenUuid, memo);

      if (!_isIsolatedDuel(tokenA, tokenB, memo)) return false;
      continue;
    }

    // RAW (Chapter 5): Overextend applies to the opponent's next attack within 1 round
    // regardless of who that attack targets. Some legacy effects store opponent scoping
    // in conditions.opponentUuid; ignore that scoping for Overextend so it applies to
    // the next attack against any target.
    const uesrpgKey = getFlagValueWithFallback(effect, "key");
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
