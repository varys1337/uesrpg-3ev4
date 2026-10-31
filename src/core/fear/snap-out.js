import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";
import { requestAtomicUpdateDocument, requestDeleteEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { acquireLock, releaseLock, stableStringify } from "../../utils/authority-proxy/shared.js";
import { confirmDialog } from "../../utils/dialog-v2-helper.js";
import { isActiveGMUser } from "../../utils/users.js";
import { SYSTEM_ID } from "../system/namespace.js";
import {
  applyEncounterPenaltyAfterSnapOut,
  combatTurnPromptKey,
  escapeFearHtml,
  fearLane,
  getFearEffects,
  hasFearSnapPromptSeen,
  markFearSnapPromptSeen,
  postFearMessage,
  wpTN,
} from "./effects-and-restrictions.js";

const SNAP_OUT_PATH = `flags.${SYSTEM_ID}.fearSnapOut`;
// These source outcomes either do not allow Snap Out or need a GM decision
// or an earlier, separately timed phase before the attempt becomes eligible.
const MANUAL_SNAP_KEYS = new Set(["panic.frightened", "panic.running", "horror.mindBreak"]);

function canSnapOut(effect) {
  const lane = fearLane(effect);
  return lane?.snapOut === true && !MANUAL_SNAP_KEYS.has(String(lane.key ?? ""));
}

function currentStep(actor, combat) {
  const combatant = combat?.combatant;
  const round = Number(combat?.round);
  const turn = Number(combat?.turn);
  if (!combat?.id || combat.started !== true || !combatant?.id || combatant.actor?.uuid !== actor?.uuid
    || combat.round == null || combat.turn == null || !Number.isInteger(round) || !Number.isInteger(turn)) return null;
  return { combatId: String(combat.id), combatantId: String(combatant.id), round, turn };
}

function sameStep(left, right) {
  return Boolean(left && right && left.combatId === right.combatId && left.combatantId === right.combatantId
    && left.round === right.round && left.turn === right.turn);
}

function getSavedAttempt(actor) {
  return actor?.flags?.[SYSTEM_ID]?.fearSnapOut ?? null;
}

function blocksAttempt(record, step) {
  if (record == null) return false;
  if (record.version !== 1 || !["failed", "pending", "settling"].includes(record.status)) return true;
  if (record.status !== "failed") return true;
  // Manic Terror specifies the first turn each round. Other effects may be
  // attempted on the next turn; a pending or interrupted success needs review.
  const manic = Array.isArray(record.effects) && record.effects.some(effect => effect?.key === "horror.manicTerror");
  return record.combatId === step.combatId && record.round === step.round
    && (manic || (record.turn === step.turn && record.combatantId === step.combatantId));
}

function effectMatchesSnapshot(actor, snapshot) {
  const effect = actor?.effects?.get?.(snapshot.id);
  const lane = fearLane(effect);
  return Boolean(effect && !effect.disabled && canSnapOut(effect)
    && String(lane?.key ?? "") === snapshot.key
    && (Number(lane?.applyAfterSnapPenalty ?? 0) || 0) === snapshot.penalty);
}

function validSnapshots(snapshots) {
  return Array.isArray(snapshots) && snapshots.length > 0
    && snapshots.every(entry => entry && typeof entry.id === "string" && entry.id.length > 0
      && typeof entry.key === "string" && Number.isFinite(entry.penalty))
    && new Set(snapshots.map(entry => entry.id)).size === snapshots.length;
}

export async function attemptSnapOut(actor, { combat = game.combat } = {}) {
  const step = currentStep(actor, combat);
  if (!actor || !step) {
    ui.notifications?.warn?.("Snap Out can be attempted during the affected character's turn.");
    return { attempted: false, success: false };
  }

  const lockKey = `fear-snap-out:${actor.uuid}`;
  if (!await acquireLock(lockKey, { wait: false })) return { attempted: false, success: false, pending: true };
  try {
    const effects = getFearEffects(actor).filter(canSnapOut);
    if (!effects.length) return { attempted: false, success: false };
    if (blocksAttempt(getSavedAttempt(actor), step)) {
      ui.notifications?.warn?.("A Snap Out attempt is already recorded for this round or awaits GM review. Inspect the actor and chat before rolling again.");
      return { attempted: false, success: false, needsReview: true };
    }
    const snapshots = effects.map(effect => ({
      id: String(effect.id ?? ""),
      key: String(fearLane(effect)?.key ?? ""),
      penalty: Number(fearLane(effect)?.applyAfterSnapPenalty ?? 0) || 0,
    }));
    if (!validSnapshots(snapshots)) {
      ui.notifications?.warn?.("A fear effect has no confirmed identity. Ask the GM to resolve Snap Out manually.");
      return { attempted: false, success: false, needsReview: true };
    }

    const tn = wpTN(actor, 0);
    let res;
    try {
      res = await doTestRoll(actor, { target: tn, rollFormula: "1d100", allowLucky: true, allowUnlucky: true });
    } catch (error) {
      console.warn("UESRPG | Snap Out roll failed", error);
      ui.notifications?.warn?.("The Snap Out roll could not be completed. Ask the GM to inspect the actor and chat before retrying.");
      return { attempted: true, success: false, needsReview: true };
    }
    let rollMessage;
    try {
      rollMessage = await res?.roll?.toMessage?.({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `${actor.name} - Snap Out (Willpower ${tn})`,
        rollMode: getCoreRollMode(),
      });
      if (!rollMessage?.id || typeof res?.isSuccess !== "boolean") throw new Error("The Snap Out roll was not confirmed.");
    } catch (error) {
      console.warn("UESRPG | Snap Out roll could not be confirmed", error);
      ui.notifications?.warn?.("The Snap Out roll could not be confirmed. Ask the GM to inspect chat before rolling again; no fear effect was removed.");
      return { attempted: true, success: false, needsReview: true };
    }

    const record = {
      version: 1, id: foundry.utils.randomID(), ...step,
      status: res.isSuccess ? "pending" : "failed",
      rollMessageId: String(rollMessage.id), effects: snapshots, createdAt: Date.now(),
    };
    const saved = await requestAtomicUpdateDocument(actor, fresh => {
      if (!sameStep(currentStep(fresh, game.combat), step) || blocksAttempt(getSavedAttempt(fresh), step)
        || !snapshots.every(snapshot => effectMatchesSnapshot(fresh, snapshot))) return null;
      return { [SNAP_OUT_PATH]: record };
    });
    if (!saved) {
      ui.notifications?.warn?.("The Snap Out roll was posted, but its attempt record was not confirmed. Ask the GM to inspect the actor and chat; do not reroll.");
      return { attempted: true, success: false, needsReview: true };
    }
    if (res.isSuccess && !sameStep(step, currentStep(actor, game.combat))) {
      ui.notifications?.warn?.("The turn changed while the Snap Out attempt was being recorded. Inspect the actor and chat before resolving or repeating it.");
      return { attempted: true, success: true, pending: true, partial: true, needsReview: true };
    }

    try {
      const text = res.isSuccess
        ? `<p><b>${escapeFearHtml(actor.name)}</b> succeeds and will snap out at the end of this turn.</p>`
        : `<p><b>${escapeFearHtml(actor.name)}</b> fails to snap out of fear.</p>`;
      const message = await postFearMessage(actor, "Fear", text);
      if (!message?.id) throw new Error("The Snap Out summary was not confirmed.");
    } catch (error) {
      console.warn("UESRPG | Snap Out summary could not be confirmed", error);
      ui.notifications?.warn?.("The Snap Out attempt was recorded, but its summary was not confirmed. Inspect chat; do not reroll.");
      return { attempted: true, success: res.isSuccess, pending: res.isSuccess, partial: true, needsReview: true };
    }
    return { attempted: true, success: res.isSuccess, pending: res.isSuccess };
  } finally {
    releaseLock(lockKey);
  }
}

/** Settle a recorded success only when the recorded turn has actually ended. */
export async function settleSnapOutAtTurnEnd(actor, { combat, prior } = {}) {
  const record = getSavedAttempt(actor);
  if (!isActiveGMUser(game.user) || !actor || !record || record.combatId !== String(combat?.id ?? "")
    || record.combatantId !== String(prior?.combatantId ?? "")
    || record.round !== Number(prior?.round) || record.turn !== Number(prior?.turn)) return;
  if (record.version !== 1 || record.status !== "pending" || !validSnapshots(record.effects)) {
    if (record.status !== "failed") ui.notifications?.warn?.(`${actor.name}: the Snap Out record needs GM review before effects are changed.`);
    return;
  }
  const lockKey = `fear-snap-out:${actor.uuid}`;
  if (!await acquireLock(lockKey, { wait: false })) {
    ui.notifications?.warn?.(`${actor.name}: Snap Out is still processing. Inspect the attempt before retrying.`);
    return;
  }
  try {
    const expected = stableStringify(record);
    const claimed = await requestAtomicUpdateDocument(actor, fresh => {
      const current = getSavedAttempt(fresh);
      if (!isActiveGMUser(game.user) || game.combat?.id !== combat.id || stableStringify(current) !== expected || current?.status !== "pending"
        || !record.effects.every(snapshot => effectMatchesSnapshot(fresh, snapshot))) return null;
      return { [SNAP_OUT_PATH]: { ...current, status: "settling" } };
    });
    if (!claimed) {
      ui.notifications?.warn?.(`${actor.name}: end-of-turn Snap Out could not be confirmed. Inspect the fear effects and attempt record; do not repeat it.`);
      return;
    }

    try {
      if (!isActiveGMUser(game.user) || game.combat?.id !== combat.id) throw new Error("The encounter or active GM changed.");
      if (!record.effects.every(snapshot => effectMatchesSnapshot(actor, snapshot))) throw new Error("The fear effects changed before removal.");
      const ids = record.effects.map(effect => effect.id);
      const deleted = await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", ids, { requireDeleted: true });
      if (!deleted || ids.some(id => actor.effects?.get?.(id))) throw new Error("Fear effect removal was not confirmed.");
      const lingeringPenalty = Math.min(0, ...record.effects.map(effect => effect.penalty));
      if (lingeringPenalty) {
        if (!isActiveGMUser(game.user) || game.combat?.id !== combat.id) throw new Error("The encounter or active GM changed before the penalty was applied.");
        const penalty = await applyEncounterPenaltyAfterSnapOut(actor, lingeringPenalty);
        if (!penalty?.id) throw new Error("The lingering penalty was not confirmed.");
      }
      const cleared = await requestAtomicUpdateDocument(actor, fresh => {
        const current = getSavedAttempt(fresh);
        return isActiveGMUser(game.user) && game.combat?.id === combat.id && current?.id === record.id && current.status === "settling"
          ? { [SNAP_OUT_PATH]: null } : null;
      });
      if (!cleared) throw new Error("The completed Snap Out record could not be cleared.");
    } catch (error) {
      console.warn("UESRPG | Snap Out settlement needs review", error);
      ui.notifications?.warn?.(`${actor.name}: Snap Out settlement may be partial. Inspect the actor's fear effects, lingering penalty and attempt record before taking further action; do not reroll.`);
      return;
    }

    const manic = record.effects.some(effect => effect.key === "horror.manicTerror");
    try {
      const extra = manic ? " The GM rolls 1d4 and applies the Stamina loss and any Fatigue." : "";
      const message = await postFearMessage(actor, "Fear", `<p><b>${escapeFearHtml(actor.name)}</b> snaps out of fear at the end of the turn.${extra}</p>`);
      if (!message?.id) throw new Error("The Snap Out summary was not confirmed.");
    } catch (error) {
      console.warn("UESRPG | Completed Snap Out summary could not be confirmed", error);
      ui.notifications?.warn?.(`${actor.name}: Snap Out was applied, but its summary was not confirmed. Inspect the actor and chat; do not repeat it.${manic ? " The GM also resolves the 1d4 Stamina loss." : ""}`);
    }
  } finally {
    releaseLock(lockKey);
  }
}

/** GM review clears a hold only after the consequences have been checked manually. */
export async function reviewSnapOut(actor) {
  if (!isActiveGMUser(game.user) || !actor) {
    ui.notifications?.warn?.("The active GM must review the affected actor's Snap Out record.");
    return { ok: false };
  }
  const record = getSavedAttempt(actor);
  if (!record) return { ok: true, empty: true };
  if (record.version !== 1 || !record.id || !["failed", "pending", "settling"].includes(record.status)
    || !validSnapshots(record.effects)) {
    ui.notifications?.warn?.("The Snap Out record is malformed. Inspect the actor data before changing it.");
    return { ok: false, needsReview: true };
  }
  const step = currentStep(actor, game.combat);
  if ((record.status === "pending" && sameStep(record, step))
    || (record.status === "failed" && step && blocksAttempt(record, step))) {
    ui.notifications?.warn?.("This attempt is still active for the current turn. Review it after the turn ends.");
    return { ok: false, pending: true };
  }
  const expected = stableStringify(record);
  const entries = record.effects.map(snapshot => {
    const effect = actor.effects?.get?.(snapshot.id);
    return `<li>${escapeFearHtml(effect?.name ?? snapshot.key ?? "Fear effect")} (${effect ? "present" : "absent"})</li>`;
  }).join("");
  const confirmed = await confirmDialog({
    title: "Review Snap Out",
    content: `<p>Attempt status: <b>${escapeFearHtml(record.status)}</b>. Roll message: ${escapeFearHtml(record.rollMessageId)}.</p><ul>${entries}</ul><p>Inspect the roll, fear effects, any lingering penalty and any required Stamina loss. Confirm that previous processing has stopped and that you have resolved the result manually. Releasing the record does not apply or undo any effect.</p>`,
    yesLabel: "Reviewed and resolved",
  });
  if (!confirmed) return { ok: false, cancelled: true };
  const lockKey = `fear-snap-out:${actor.uuid}`;
  if (!await acquireLock(lockKey, { wait: false })) {
    ui.notifications?.warn?.("Snap Out is still processing on this client. Review it after processing has stopped.");
    return { ok: false, pending: true };
  }
  let cleared = false;
  try {
    cleared = await requestAtomicUpdateDocument(actor, fresh => {
      const current = getSavedAttempt(fresh);
      const liveStep = currentStep(fresh, game.combat);
      if (!isActiveGMUser(game.user) || stableStringify(current) !== expected
        || (current?.status === "pending" && sameStep(current, liveStep))
        || (current?.status === "failed" && liveStep && blocksAttempt(current, liveStep))) return null;
      return {
        [SNAP_OUT_PATH]: null,
        [`flags.${SYSTEM_ID}.fearSnapOutReview`]: {
          operationId: current.id, priorStatus: current.status, reviewedBy: game.user.id, reviewedAt: Date.now(),
        },
      };
    });
  } finally {
    releaseLock(lockKey);
  }
  if (!cleared) ui.notifications?.warn?.("The Snap Out review was not confirmed. Inspect the actor record before trying again.");
  return { ok: Boolean(cleared), needsReview: !cleared };
}

export async function maybePromptSnapOutOnTurnStart(combat) {
  if (!combat?.started) return;
  const actor = combat?.combatant?.actor ?? null;
  if (!actor || !getFearEffects(actor).some(canSnapOut)) return;
  const step = currentStep(actor, combat);
  if (!step) return;

  const key = combatTurnPromptKey(combat, actor.id);
  if (hasFearSnapPromptSeen(key)) return;
  markFearSnapPromptSeen(key);
  // Do not hold the ordered combat-boundary queue while a person decides.
  // Recheck the same turn before rolling if the dialog remains open.
  void (async () => {
    const confirmed = await confirmDialog({
      title: "Snap Out",
      content: `<p>Attempt a Willpower test for ${escapeFearHtml(actor.name)} to snap out of eligible fear effects?</p><p>A successful result takes effect at the end of this turn.</p>`,
      yesLabel: "Attempt Snap Out",
      noLabel: "Not now",
    });
    if (!confirmed) return;
    if (!isActiveGMUser(game.user) || !sameStep(step, currentStep(actor, game.combat))) {
      ui.notifications?.warn?.("The turn or active GM changed before the Snap Out attempt. No roll was made.");
      return;
    }
    await attemptSnapOut(actor, { combat: game.combat });
  })().catch(error => {
    console.warn("UESRPG | Snap Out prompt failed", error);
    ui.notifications?.warn?.("The Snap Out prompt could not be completed. Inspect chat and the actor before retrying.");
  });
}
