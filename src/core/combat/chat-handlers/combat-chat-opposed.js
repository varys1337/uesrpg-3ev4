/**
 * src/core/combat/chat-handlers/combat-chat-opposed.js
 *
 * Opposed workflow action routing and createChatMessage / updateChatMessage banking hooks.
 */

import { OpposedWorkflow } from "../opposed-workflow.js";
import { SkillOpposedWorkflow } from "../../skills/opposed-workflow/index.js";
import { CharOpposedWorkflow } from "../../characteristics/opposed-workflow.js";
import { requestUpdateChatMessage } from "../../../utils/authority-proxy.js";
import { FLAG_SCOPE } from "../../system/namespace.js";

const _FLAG_NS = FLAG_SCOPE;

let _magicOpposedWorkflowModulePromise = null;

async function _getMagicOpposedWorkflow() {
  if (!_magicOpposedWorkflowModulePromise) {
    _magicOpposedWorkflowModulePromise = import("../../magic/opposed-workflow.js")
      .then((m) => m?.MagicOpposedWorkflow ?? null)
      .catch((_err) => null);
  }
  return await _magicOpposedWorkflowModulePromise;
}

// ── State readers ─────────────────────────────────────────────────────────────

export function getSkillOpposedState(message) {
  const raw = message?.flags?.["uesrpg-3ev4"]?.skillOpposed;
  if (!raw) return null;
  if (raw && typeof raw === "object" && Number(raw.version) >= 1 && raw.state) return raw.state;
  if (raw && typeof raw === "object" && raw.attacker && raw.defender) return raw;
  return null;
}

export function getCharOpposedState(message) {
  const raw = message?.flags?.["uesrpg-3ev4"]?.charOpposed;
  if (!raw) return null;
  if (raw && typeof raw === "object" && Number(raw.version) >= 1 && raw.state) return raw.state;
  if (raw && typeof raw === "object" && raw.attacker && raw.defender) return raw;
  return null;
}

// ── Update filter helpers ─────────────────────────────────────────────────────

export function isRelevantOpposedUpdate(changes) {
  if (!changes || typeof changes !== "object") return false;

  if (Object.prototype.hasOwnProperty.call(changes, "content")) return true;

  for (const k of Object.keys(changes)) {
    if (k === "content") return true;
    if (typeof k === "string" && k.startsWith(`flags.${_FLAG_NS}.opposed`)) return true;
    if (typeof k === "string" && k.startsWith(`flags.${_FLAG_NS}.skillOpposed`)) return true;
    if (typeof k === "string" && k.startsWith(`flags.${_FLAG_NS}.charOpposed`)) return true;
    if (typeof k === "string" && k.startsWith(`flags.${_FLAG_NS}.magicOpposed`)) return true;
  }

  const flags = changes.flags;
  if (flags && typeof flags === "object") {
    const ns = flags[_FLAG_NS];
    if (ns && typeof ns === "object") {
      if (Object.prototype.hasOwnProperty.call(ns, "opposed")) return true;
      if (Object.prototype.hasOwnProperty.call(ns, "skillOpposed")) return true;
      if (Object.prototype.hasOwnProperty.call(ns, "charOpposed")) return true;
      if (Object.prototype.hasOwnProperty.call(ns, "magicOpposed")) return true;
    }
  }

  return false;
}

export function isContentOnlyUpdate(changes) {
  if (!changes || typeof changes !== "object") return false;
  const keys = Object.keys(changes);
  if (keys.length !== 1 || keys[0] !== "content") return false;
  return true;
}

// ── Ammo consumption ──────────────────────────────────────────────────────────

export async function maybeConsumeAmmoFromMessage(message) {
  const opposed = message?.flags?.[_FLAG_NS]?.opposed;
  const pendingAmmo = opposed?.pendingAmmo ?? null;
  if (!pendingAmmo) return;
  if (opposed?.ammoConsumed) return;

  const activeGM = game.users.activeGM;
  const shouldRun = activeGM ? (game.user.id === activeGM.id) : message.isAuthor;
  if (!shouldRun) return;

  const ok = await OpposedWorkflow.consumePendingAmmo(pendingAmmo);
  await requestUpdateChatMessage(message, {
    [`flags.${_FLAG_NS}.opposed.ammoConsumed`]: true,
    [`flags.${_FLAG_NS}.opposed.ammoConsumedOk`]: !!ok,
    [`flags.${_FLAG_NS}.opposed.ammoConsumedAt`]: Date.now(),
  });
}

// ── Action handlers ───────────────────────────────────────────────────────────

export async function onOpposedAction(ev, message) {
  ev.preventDefault();
  const btn = ev.currentTarget;
  const action = btn.dataset.uesOpposedAction;
  const defenderIndexRaw = btn.dataset.defenderIndex;
  const defenderIndex = Number.isFinite(Number(defenderIndexRaw)) ? Number(defenderIndexRaw) : null;
  await OpposedWorkflow.handleAction(message, action, { defenderIndex });
}

export async function onSkillOpposedAction(ev, message) {
  ev.preventDefault();
  const btn = ev.currentTarget;
  const action = btn.dataset.uesSkillOpposedAction;
  await SkillOpposedWorkflow.handleAction(message, action, { event: ev });
}

export async function onCharOpposedAction(ev, message) {
  ev.preventDefault();
  const btn = ev.currentTarget;
  const action = btn.dataset.uesCharOpposedAction;
  await CharOpposedWorkflow.handleAction(message, action);
}

export async function onMagicOpposedAction(ev, message) {
  ev.preventDefault();
  const btn = ev.currentTarget;
  const action = btn.dataset.uesMagicOpposedAction;
  const defenderIndexRaw = btn.dataset?.defenderIndex;
  const defenderIndex = Number.isFinite(Number(defenderIndexRaw)) ? Number(defenderIndexRaw) : null;
  const { MagicOpposedWorkflow } = await import("../../magic/opposed-workflow.js");
  await MagicOpposedWorkflow.handleAction(message, action, { defenderIndex, event: ev });
}

// ── createChatMessage hook body ───────────────────────────────────────────────

export function onCreateChatMessageOpposed(message) {
  maybeConsumeAmmoFromMessage(message).catch((err) =>
    console.error("UESRPG | Ammo consumption hook failed", err)
  );

  // Combat opposed external roll banking.
  try {
    const meta = message?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
    const parentId = meta?.parentMessageId ?? null;
    const stage = meta?.stage ?? null;

    if (parentId && stage) {
      const parent = game.messages.get(parentId) ?? null;
      if (parent) {
        const activeGM = game.users.activeGM;
        const shouldRun = activeGM ? (game.user.id === activeGM.id) : parent.isAuthor;
        if (shouldRun) {
          OpposedWorkflow.applyExternalRollMessage(message).catch((err) =>
            console.error("UESRPG | Opposed external roll banking failed", err)
          );
        }
      }
    }
  } catch (err) {
    console.error("UESRPG | Opposed external roll banking hook failed", err);
  }

  // Skill opposed external roll banking.
  try {
    const meta = message?.flags?.["uesrpg-3ev4"]?.skillOpposedMeta ?? null;
    const parentId = meta?.parentMessageId ?? null;
    if (parentId) {
      const parent = game.messages.get(parentId) ?? null;
      if (parent) {
        const activeGM = game.users.activeGM;
        const shouldRun = activeGM ? (game.user.id === activeGM.id) : parent.isAuthor;
        if (shouldRun) {
          SkillOpposedWorkflow.applyExternalRollMessage(message).catch((err) =>
            console.error("UESRPG | Skill opposed external roll banking failed", err)
          );
        }
      }
    }
  } catch (err) {
    console.error("UESRPG | Skill opposed external roll banking hook failed", err);
  }

  // Characteristic opposed external roll banking.
  try {
    const meta = message?.flags?.["uesrpg-3ev4"]?.charOpposedMeta ?? null;
    const parentId = meta?.parentMessageId ?? null;
    if (parentId) {
      const parent = game.messages.get(parentId) ?? null;
      if (parent) {
        const activeGM = game.users.activeGM;
        const shouldRun = activeGM ? (game.user.id === activeGM.id) : parent.isAuthor;
        if (shouldRun) {
          CharOpposedWorkflow.applyExternalRollMessage(message).catch((err) =>
            console.error("UESRPG | Char opposed external roll banking failed", err)
          );
        }
      }
    }
  } catch (err) {
    console.error("UESRPG | Char opposed external roll banking hook failed", err);
  }
}

// ── updateChatMessage hook body ───────────────────────────────────────────────

export function onUpdateChatMessageOpposed(message, changes) {
  try {
    // Combat opposed workflow.
    const opposed = message?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
    if (opposed) {
      if (!isRelevantOpposedUpdate(changes)) return;
      if (isContentOnlyUpdate(changes) && opposed?.context?.autoRollStarted === true) return;
      const activeGM = game.users.activeGM ?? null;
      if (activeGM) {
        OpposedWorkflow.maybeAutoRollBanked(message).catch((err) =>
          console.error("UESRPG | Opposed banked GM auto-roll hook failed", err)
        );
      } else {
        OpposedWorkflow.maybeAutoRollBankedNoGM(message).catch((err) =>
          console.error("UESRPG | Opposed banked no-GM auto-roll hook failed", err)
        );
      }
      return;
    }

    // Skill opposed workflow.
    const skillOpposed = message?.flags?.["uesrpg-3ev4"]?.skillOpposed ?? null;
    if (skillOpposed) {
      if (!isRelevantOpposedUpdate(changes)) return;
      const skillState = skillOpposed?.state ?? null;
      if (isContentOnlyUpdate(changes) && skillState?.context?.autoRollStarted === true) return;
      const activeGM = game.users.activeGM ?? null;
      if (activeGM) {
        SkillOpposedWorkflow.maybeAutoRollBanked?.(message).catch((err) =>
          console.error("UESRPG | Skill opposed banked GM auto-roll hook failed", err)
        );
      } else {
        SkillOpposedWorkflow.maybeAutoRollBankedNoGM?.(message).catch((err) =>
          console.error("UESRPG | Skill opposed banked no-GM auto-roll hook failed", err)
        );
      }
      return;
    }

    // Magic opposed workflow.
    const magicOpposed = message?.flags?.["uesrpg-3ev4"]?.magicOpposed ?? null;
    if (magicOpposed) {
      if (!isRelevantOpposedUpdate(changes)) return;
      const magicState = magicOpposed?.state ?? null;
      if (isContentOnlyUpdate(changes) && magicState?.context?.autoRollStarted === true) return;
      const activeGM = game.users.activeGM ?? null;
      _getMagicOpposedWorkflow().then((MagicOpposedWorkflow) => {
        if (!MagicOpposedWorkflow) {
          console.error("UESRPG | Failed to load MagicOpposedWorkflow for banked auto-roll");
          return;
        }
        if (activeGM) {
          MagicOpposedWorkflow.maybeAutoRollBanked?.(message).catch((err) =>
            console.error("UESRPG | Magic opposed banked GM auto-roll hook failed", err)
          );
        } else {
          MagicOpposedWorkflow.maybeAutoRollBankedNoGM?.(message).catch((err) =>
            console.error("UESRPG | Magic opposed banked no-GM auto-roll hook failed", err)
          );
        }
      });
    }

    // Characteristic opposed workflow.
    const charOpposed = message?.flags?.["uesrpg-3ev4"]?.charOpposed ?? null;
    if (charOpposed) {
      if (!isRelevantOpposedUpdate(changes)) return;
      const charState = charOpposed?.state ?? null;
      if (isContentOnlyUpdate(changes) && charState?.context?.autoRollStarted === true) return;
      const activeGM = game.users.activeGM ?? null;
      if (activeGM) {
        CharOpposedWorkflow.maybeAutoRollBanked?.(message).catch((err) =>
          console.error("UESRPG | Char opposed banked GM auto-roll hook failed", err)
        );
      } else {
        CharOpposedWorkflow.maybeAutoRollBankedNoGM?.(message).catch((err) =>
          console.error("UESRPG | Char opposed banked no-GM auto-roll hook failed", err)
        );
      }
    }
  } catch (err) {
    console.error("UESRPG | Opposed banked auto-roll update hook failed", err);
  }
}
