/**
 * src/core/wounds/wound-socket.js
 *
 * Permission-safe socket bridge for wounds automation.
 *
 * Design goals:
 *  - Deterministic: exactly one GM processes requests.
 *  - Small surface area: only forwards wounds automation actions.
 *  - Defensive: validates payloads and actor resolution.
 *
 * Channel:
 *  - system.<systemId> (Foundry convention)
 */

import { WOUND_SOCKET_TYPES, WOUND_SOCKET_VERSION, isActiveGMUser } from "./wound-schema.js";

let _woundSocketRegistered = false;

/**
 * @returns {string}
 */
function _channel() {
  const id = game.system?.id ?? "uesrpg-3ev4";
  return `system.${id}`;
}

/**
 * Emit a request for a GM to process.
 *
 * @param {string} type
 * @param {{actorUuid:string, data:any}} payload
 */
export function requestWoundsGM(type, payload) {
  try {
    const actorUuid = payload?.actorUuid;
    if (!actorUuid) return;
    game.socket?.emit?.(_channel(), {
      uesrpgWounds: true,
      v: WOUND_SOCKET_VERSION,
      type: String(type),
      actorUuid: String(actorUuid),
      data: payload?.data ?? null,
      senderUserId: game.user?.id ?? null,
      sentAt: Date.now(),
    });
  } catch (err) {
    console.warn("UESRPG | Wounds socket emit failed", err);
  }
}

/**
 * Register the GM-side handler.
 *
 * @param {{onDamageApplied?:Function, onHealingApplied?:Function, onResolveShock?:Function}} handlers
 */
export function registerWoundSocket(handlers = {}) {
  if (_woundSocketRegistered) return;
  _woundSocketRegistered = true;

  const onDamageApplied = typeof handlers.onDamageApplied === "function" ? handlers.onDamageApplied : null;
  const onHealingApplied = typeof handlers.onHealingApplied === "function" ? handlers.onHealingApplied : null;
  const onResolveShock = typeof handlers.onResolveShock === "function" ? handlers.onResolveShock : null;

  game.socket?.on?.(_channel(), async (payload) => {
    try {
      if (!payload?.uesrpgWounds) return;
      if (!isActiveGMUser(game.user)) return;

      if (payload?.v !== WOUND_SOCKET_VERSION) return;
      const type = String(payload?.type ?? "");
      if (!WOUND_SOCKET_TYPES.includes(type)) return;

      const actorUuid = payload?.actorUuid ? String(payload.actorUuid) : null;
      if (!actorUuid) return;

      const actor = await fromUuid(actorUuid);
      if (!actor || actor.documentName !== "Actor") return;

      const senderUserId = payload?.senderUserId ? String(payload.senderUserId) : null;
      const sender = senderUserId ? game.users?.get?.(senderUserId) : null;
      if (sender && sender.isGM !== true) {
        const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
        const ok = actor.testUserPermission?.(sender, ownerLevel);
        if (!ok) return;
      }

      if (type === "damageApplied" && onDamageApplied) {
        await onDamageApplied(actor, payload?.data ?? {});
      } else if (type === "healingApplied" && onHealingApplied) {
        await onHealingApplied(actor, payload?.data ?? {});
      } else if (type === "resolveShock" && onResolveShock) {
        await onResolveShock(actor, payload?.data ?? {});
      }
    } catch (err) {
      console.warn("UESRPG | Wounds socket handler failed", err);
    }
  });
}
