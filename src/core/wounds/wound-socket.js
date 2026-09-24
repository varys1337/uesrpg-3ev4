/**
 * Requester-bound authority bridge for wound automation.
 */

import { WOUND_SOCKET_TYPES } from "./wound-schema.js";
import {
  AUTHORITY_RESULT_CODES,
  registerAuthorityIntentCommand,
  registerAuthorityIntentService,
  requestAuthorityIntent,
} from "../../utils/authority-intents.js";

const WOUND_INTENT = "wound.resolve";
let _woundIntentRegistered = false;

function _canRequestForActor(user, actor) {
  if (!user || !actor) return false;
  if (user.isGM) return true;
  return actor.testUserPermission?.(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) === true;
}

export async function requestWoundsGM(type, payload) {
  const actorUuid = String(payload?.actorUuid ?? "").trim();
  const normalizedType = String(type ?? "").trim();
  if (!actorUuid || !WOUND_SOCKET_TYPES.includes(normalizedType)) return false;

  const result = await requestAuthorityIntent(WOUND_INTENT, {
    type: normalizedType,
    actorUuid,
    data: payload?.data ?? null,
  });
  if (!result?.ok && result?.code === AUTHORITY_RESULT_CODES.NO_ACTIVE_GM) {
    ui.notifications?.warn?.("An active GM is required to resolve wound automation.");
  }
  return result?.ok === true;
}

export function registerWoundSocket(handlers = {}) {
  if (_woundIntentRegistered) return;
  _woundIntentRegistered = true;
  registerAuthorityIntentService();

  const commandHandlers = Object.freeze({
    damageApplied: typeof handlers.onDamageApplied === "function" ? handlers.onDamageApplied : null,
    healingApplied: typeof handlers.onHealingApplied === "function" ? handlers.onHealingApplied : null,
    resolveShock: typeof handlers.onResolveShock === "function" ? handlers.onResolveShock : null,
  });

  registerAuthorityIntentCommand(WOUND_INTENT, async ({ requester, data }) => {
    const type = String(data?.type ?? "");
    const actorUuid = String(data?.actorUuid ?? "").trim();
    const handler = commandHandlers[type];
    if (!actorUuid || !WOUND_SOCKET_TYPES.includes(type) || typeof handler !== "function") {
      return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
    }

    const actor = await fromUuid(actorUuid);
    if (actor?.documentName !== "Actor") {
      return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
    }
    if (!_canRequestForActor(requester, actor)) {
      return { ok: false, code: AUTHORITY_RESULT_CODES.UNAUTHORIZED };
    }

    await handler(actor, data?.data ?? {});
    return { ok: true };
  });
}
