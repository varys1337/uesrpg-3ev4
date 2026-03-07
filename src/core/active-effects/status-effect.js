/**
 * Create or update a "status-like" ActiveEffect in a consistent way so token icon/HUD behavior
 * remains deterministic (statusId + statuses + core.statusId + icon).
 *
 * Foundry VTT v13 compatible.
 */

import { requestCreateEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { getFlagValueWithFallback, getCanonicalFlags, getLegacyFlags } from "../system/flags.js";

const COMBAT_ACTION_KEYS = new Set(["defensiveStance", "aim", "powerAttack", "powerBlock", "powerDraw"]);

export async function createOrUpdateStatusEffect(actor, { statusId, name, img, duration = null, flags = {}, changes = [] } = {}) {
  if (!actor) return null;

  const sid = typeof statusId === "string" && statusId.trim().length ? statusId.trim() : null;
  const incomingKey = getFlagValueWithFallback({ flags }, "key");
  const key = incomingKey ? String(incomingKey) : null;

  const isEnabled = (e) => e && !e.disabled;
  const hasStatus = (e) => {
    try {
      if (!sid) return false;
      if (e.statuses && typeof e.statuses.has === "function" && e.statuses.has(sid)) return true;
      const coreSid = e?.flags?.core?.statusId;
      return coreSid ? String(coreSid) === sid : false;
    } catch (_e) {
      return false;
    }
  };

  // Prefer canonical uesrpg key matching, then statusId matching.
  let existing = null;
  if (key) existing = actor.effects.find((e) => isEnabled(e) && getFlagValueWithFallback(e, "key") === key) ?? null;
  if (!existing && sid) existing = actor.effects.find((e) => isEnabled(e) && hasStatus(e)) ?? null;

  // Foundry v13: ActiveEffect uses `img`, not `icon`. Prefer `img` first.
  const nextIcon = img || existing?.img || existing?.icon || "icons/svg/aura.svg";
  const nextDuration = duration ?? existing?.duration ?? {};
  const nextOrigin = existing?.origin ?? actor.uuid;

  const mergedFlags = {
    ...(existing?.flags ?? {}),
    ...(flags ?? {}),
    [FLAG_SCOPE]: {
      ...getCanonicalFlags(existing ?? {}),
      ...getLegacyFlags(existing ?? {}),
      ...getCanonicalFlags({ flags }),
      ...getLegacyFlags({ flags }),
      ...(key ? { key } : {})
    }
  };

  // Add standardized metadata for combat action effects (identified by flags.uesrpg.key)
  if (key && !mergedFlags[FLAG_SCOPE]?.effectGroup) {
    // Combat action effects: defensiveStance, aim, powerAttack, etc.
    // Stamina effects: stamina-power-attack, stamina-power-block, etc.
    const isStaminaEffect = key.startsWith("stamina-");
    
    if (COMBAT_ACTION_KEYS.has(key) || isStaminaEffect) {
      if (!mergedFlags[FLAG_SCOPE]) mergedFlags[FLAG_SCOPE] = {};
      mergedFlags[FLAG_SCOPE].owner = "system";
      mergedFlags[FLAG_SCOPE].effectGroup = `combat.${key}`;
      mergedFlags[FLAG_SCOPE].stackRule = "override";
      mergedFlags[FLAG_SCOPE].source = "combat";
    }
  }

  if (sid) {
    mergedFlags.core = { ...(existing?.flags?.core ?? {}), ...(flags?.core ?? {}), statusId: sid };
  }

  const effectData = {
    name: name ?? existing?.name ?? "",
    img: nextIcon,
    origin: nextOrigin,
    disabled: false,
    duration: nextDuration,
    changes: Array.isArray(changes) ? changes : [],
    flags: mergedFlags,
    transfer: false
  };

  if (sid) effectData.statuses = [sid];

  if (existing) {
    await requestUpdateDocument(existing, effectData);
    return existing;
  }

  const createdArr = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [effectData]);
  const created = Array.isArray(createdArr) ? createdArr[0] : null;
  return created ?? null;
}
