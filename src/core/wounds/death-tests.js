/**
 * src/core/wounds/death-tests.js
 *
 * Chapter 5 unconscious death-test loop.
 */

import { doTestRoll, formatDegree } from "../../utils/degree-roll-helper.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { hasCondition } from "../conditions/condition-engine.js";
import { isActiveGMUser } from "./wound-schema.js";
import { SYSTEM_ID } from "../constants.js";

const FLAG_KEY = "chapter5.deathState";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

let _deathHooksRegistered = false;

function _readState(actor) {
  const raw = actor?.getFlag?.(SYSTEM_ID, FLAG_KEY);
  if (!raw || typeof raw !== "object") {
    return {
      unconsciousAtZeroHp: false,
      failureCount: 0,
      autoFailNextTest: false,
      isDead: false
    };
  }

  return {
    unconsciousAtZeroHp: raw.unconsciousAtZeroHp === true,
    failureCount: Number(raw.failureCount ?? 0) || 0,
    autoFailNextTest: raw.autoFailNextTest === true,
    isDead: raw.isDead === true,
    startedAt: raw.startedAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    lastResult: raw.lastResult ?? null
  };
}

function _isUnconsciousAtZero(actor) {
  const hp = Number(actor?.system?.hp?.value ?? 0) || 0;
  if (hp > 0) return false;
  return hasCondition(actor, "unconscious");
}

function _hasStabilizedMarker(actor) {
  const effects = actor?.effects?.contents ?? [];
  return effects.some((e) => {
    const w = e?.getFlag?.(SYSTEM_ID, "wounds");
    return String(w?.kind ?? "") === "firstAid";
  });
}

function _getLuckBonus(actor) {
  const rawBonus = actor?.system?.characteristics?.lck?.bonus;
  const fromBonus = Number(rawBonus);
  if (rawBonus !== undefined && rawBonus !== null && Number.isFinite(fromBonus)) return fromBonus;

  // Chapter 5 default: NPC luck bonus is 0 when not explicitly present.
  if (String(actor?.type ?? '').toLowerCase() === 'npc') return 0;

  const total = Number(actor?.system?.characteristics?.lck?.total ?? 0) || 0;
  return Math.floor(total / 10);
}

function _getEnduranceTN(actor) {
  const tn = Number(actor?.system?.characteristics?.end?.total ?? 0);
  return Number.isFinite(tn) ? tn : 0;
}

async function _writeState(actor, state) {
  await requestUpdateDocument(actor, {
    [`flags.${SYSTEM_ID}.${FLAG_KEY}`]: {
      unconsciousAtZeroHp: state.unconsciousAtZeroHp === true,
      failureCount: Math.max(0, Number(state.failureCount ?? 0) || 0),
      autoFailNextTest: state.autoFailNextTest === true,
      isDead: state.isDead === true,
      startedAt: state.startedAt ?? Date.now(),
      updatedAt: Date.now(),
      lastResult: state.lastResult ?? null
    }
  });
}

export function getDeathState(actor) {
  return _readState(actor);
}

export async function clearDeathState(actor, { keepDead = false } = {}) {
  if (!actor) return;
  if (keepDead && _readState(actor).isDead) return;

  await requestUpdateDocument(actor, {
    [`flags.${SYSTEM_ID}.${FLAG_KEY}`]: null
  });
}

export async function markUnconsciousAtZeroHp(actor, { source = "unknown" } = {}) {
  if (!actor) return false;
  if (!_isUnconsciousAtZero(actor)) return false;

  const state = _readState(actor);
  if (state.unconsciousAtZeroHp === true) return true;

  state.unconsciousAtZeroHp = true;
  state.startedAt = Date.now();
  state.lastResult = {
    source: String(source ?? "unknown"),
    kind: "start",
    at: Date.now()
  };

  await _writeState(actor, state);
  return true;
}

export async function markAutoFailNextDeathTest(actor, { source = "damage" } = {}) {
  if (!actor) return false;
  if (!_isUnconsciousAtZero(actor)) return false;

  const state = _readState(actor);
  state.unconsciousAtZeroHp = true;
  state.autoFailNextTest = true;
  state.lastResult = {
    source: String(source ?? "damage"),
    kind: "auto-fail-armed",
    at: Date.now()
  };

  await _writeState(actor, state);
  return true;
}

async function _announceDeathTest(actor, { success, autoFailed = false, degree = 0, failureCount = 0, luckBonus = 0 } = {}) {
  const status = success ? "SUCCESS" : "FAILURE";
  const details = success
    ? (autoFailed ? "" : ` — ${formatDegree({ isSuccess: true, degree })}`)
    : (autoFailed ? " (auto-fail due to recent damage)" : ` — ${formatDegree({ isSuccess: false, degree })}`);

  const extra = !success
    ? `<p><b>Failures:</b> ${failureCount} (dies if this exceeds Luck bonus ${luckBonus})</p>`
    : "";

  const content = `
    <div class="uesrpg-chat-card">
      <header class="card-header"><h3>Death Test</h3></header>
      <div class="card-content">
        <p><b>Actor:</b> ${esc(actor.name)}</p>
        <p><b>Result:</b> ${status}${details}</p>
        ${extra}
      </div>
    </div>
  `;

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

async function _announceDeath(actor) {
  const content = `
    <div class="uesrpg-chat-card">
      <header class="card-header"><h3>Character Death</h3></header>
      <div class="card-content">
        <p><b>${esc(actor.name)}</b> dies from sustained trauma while unconscious.</p>
      </div>
    </div>
  `;

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

export async function tickDeathTestsEndTurn(actor) {
  if (!actor) return null;

  const hp = Number(actor.system?.hp?.value ?? 0) || 0;
  if (hp > 0) {
    await clearDeathState(actor);
    return null;
  }

  if (_hasStabilizedMarker(actor)) {
    await clearDeathState(actor);
    return null;
  }

  if (!hasCondition(actor, "unconscious")) {
    await clearDeathState(actor);
    return null;
  }

  const state = _readState(actor);
  if (state.isDead === true) return state;

  state.unconsciousAtZeroHp = true;

  let success = false;
  let degree = 1;
  let autoFailed = false;

  if (state.autoFailNextTest === true) {
    autoFailed = true;
    success = false;
  } else {
    const tn = _getEnduranceTN(actor);
    if (tn <= 0) {
      success = false;
      degree = 1;
    } else {
      const res = await doTestRoll(actor, {
        target: tn,
        rollFormula: "1d100",
        allowLucky: true,
        allowUnlucky: true
      });

      success = Boolean(res?.isSuccess);
      degree = Number(res?.degree ?? 1) || 1;

      try {
        await res?.roll?.toMessage?.({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor: `${actor.name} — Death Test (END ${tn})`,
          rollMode: game.settings.get("core", "rollMode")
        });
      } catch (_e) {
        // Non-blocking
      }
    }
  }

  const luckBonus = _getLuckBonus(actor);

  if (!success) state.failureCount = Math.max(0, Number(state.failureCount ?? 0) || 0) + 1;
  state.autoFailNextTest = false;
  state.lastResult = {
    kind: "death-test",
    success,
    autoFailed,
    degree,
    at: Date.now()
  };

  await _writeState(actor, state);
  await _announceDeathTest(actor, {
    success,
    autoFailed,
    degree,
    failureCount: state.failureCount,
    luckBonus
  });

  if (!success && state.failureCount > luckBonus) {
    state.isDead = true;
    state.lastResult = {
      kind: "death",
      at: Date.now(),
      reason: "failure-threshold-exceeded"
    };
    await _writeState(actor, state);
    await _announceDeath(actor);
    ui.notifications?.warn?.(`${actor.name} dies.`);
  }

  return state;
}

export function registerDeathTestHooks() {
  if (_deathHooksRegistered) return;
  _deathHooksRegistered = true;

  Hooks.on("uesrpgDamageApplied", async (actor, data) => {
    try {
      if (!isActiveGMUser(game.user)) return;
      if (!actor) return;

      const applied = Number(data?.amountApplied ?? 0) || 0;
      if (applied <= 0) return;

      if (_isUnconsciousAtZero(actor)) {
        await markUnconsciousAtZeroHp(actor, { source: "damage" });
        await markAutoFailNextDeathTest(actor, { source: "damage" });
      }
    } catch (err) {
      console.warn("UESRPG | Death test damage hook failed", err);
    }
  });

  Hooks.on("updateActor", async (actor, changed) => {
    try {
      if (!isActiveGMUser(game.user)) return;
      if (!actor) return;

      const hpChanged = foundry.utils.hasProperty(changed ?? {}, "system.hp.value");
      if (!hpChanged) return;

      const hp = Number(actor.system?.hp?.value ?? 0) || 0;
      if (hp > 0) {
        await clearDeathState(actor);
        return;
      }

      if (_isUnconsciousAtZero(actor)) {
        await markUnconsciousAtZeroHp(actor, { source: "hp-update" });
      }
    } catch (err) {
      console.warn("UESRPG | Death test updateActor hook failed", err);
    }
  });
}





