import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";
import { escapeHtml } from "../../utils/html.js";
import { requestAtomicUpdateDocument } from "../../utils/authority-proxy.js";
import { stableStringify } from "../../utils/authority-proxy/shared.js";
import { confirmDialog } from "../../utils/dialog-v2-helper.js";
import { isActiveGMUser } from "../../utils/users.js";
import { createChatOutcome } from "../config/outcome-application-policy.js";
import { persistChatOutcomes } from "../../application/combat/chat-outcome-application-service.js";
import { isActorCombatStepCurrent, isStartedActiveCombat } from "../combat/combat-scope.js";
import { SYSTEM_ID } from "../system/namespace.js";
import { escapeFearHtml, isFearImmune, postFearMessage, rollFearD100, wpTN } from "./effects-and-restrictions.js";
import { panicOutcome } from "./panic-horror-tables.js";

const IMMUNITY_PATH = `flags.${SYSTEM_ID}.warCryImmunity`;
const IMMUNITY_LIMIT = 100;

function readImmunities(actor) {
  const record = actor?.flags?.[SYSTEM_ID]?.warCryImmunity;
  if (record == null) return [];
  if (record.version !== 1 || !Array.isArray(record.encounters)
    || record.encounters.some(id => typeof id !== "string" || !id)) {
    throw Object.assign(new Error("War Cry immunity data is malformed; the GM must review it."), { committed: false });
  }
  return record.encounters;
}

function requireEncounter(combatId) {
  if (!isStartedActiveCombat(game.combat) || game.combat.id !== combatId) {
    throw Object.assign(new Error("The War Cry encounter has ended or changed. Review this target manually."), { committed: false });
  }
}

/** Queue GM-confirmed listeners after the power's use and AP are committed. */
export async function queueWarCryOutcomes({ actor, targets, step, onOutcome = null } = {}) {
  if (!game.user?.isGM || !actor || !step?.id || !isActorCombatStepCurrent(actor, step) || !Array.isArray(targets) || !targets.length
    || targets.some(target => target?.documentName !== "Actor" || !target.uuid || target.uuid === actor.uuid)
    || new Set(targets.map(target => target.uuid)).size !== targets.length) {
    throw new Error("War Cry listeners or the original combat step are no longer available. Review any use and AP already spent.");
  }
  const entries = targets.map(target => createChatOutcome({
    adapter: "fear.warCry", kind: "effect", sourceActorUuid: actor.uuid, targetUuid: target.uuid,
    label: "War Cry: Panic (+30)", payload: { combatId: step.id },
  }));
  const message = await persistChatOutcomes({ actor, entries,
    content: `<div class="uesrpg"><b>War Cry</b><p>The GM selected the enemies who can hear the cry. Resolve each Panic (+30) result below; resolve any other eligible listeners manually.</p><p>Source: ${escapeHtml(actor.name)}</p></div>`,
  });
  if (!message?.id) throw new Error("War Cry target outcomes were not confirmed. Review the power use and AP before retrying.");
  onOutcome?.(message);
  return message;
}

/** Clear one encounter's immunity only after the GM has reviewed the record. */
export async function reviewWarCryImmunity(actor, encounterId = game.combat?.id) {
  if (!isActiveGMUser(game.user) || !actor || !encounterId) {
    ui.notifications?.warn?.("The active GM, an affected actor and an encounter ID are required to review War Cry immunity.");
    return { ok: false };
  }
  const combatId = String(encounterId);
  let encounters;
  try { encounters = readImmunities(actor); }
  catch (error) {
    ui.notifications?.warn?.(error.message);
    return { ok: false, needsReview: true };
  }
  if (!encounters.includes(combatId)) return { ok: true, empty: true };
  const expected = stableStringify(actor.flags?.[SYSTEM_ID]?.warCryImmunity);
  const confirmed = await confirmDialog({
    title: "Review War Cry immunity",
    content: `<p>${escapeHtml(actor.name)} has War Cry immunity recorded for encounter ${escapeHtml(combatId)}.</p><p>Confirm that the previous encounter ended or this entry is incorrect, and that earlier War Cry processing has stopped on every client. Clearing an active encounter's valid immunity would allow another test.</p>`,
    yesLabel: "Clear reviewed immunity",
  });
  if (!confirmed) return { ok: false, cancelled: true };
  const saved = await requestAtomicUpdateDocument(actor, fresh => {
    const record = fresh.flags?.[SYSTEM_ID]?.warCryImmunity;
    if (!isActiveGMUser(game.user) || stableStringify(record) !== expected) return null;
    const remaining = readImmunities(fresh).filter(id => id !== combatId);
    return {
      [IMMUNITY_PATH]: { version: 1, encounters: remaining },
      [`flags.${SYSTEM_ID}.warCryImmunityReview`]: { combatId, reviewedBy: game.user.id, reviewedAt: Date.now() },
    };
  });
  if (!saved) ui.notifications?.warn?.("The War Cry immunity review was not confirmed. Inspect the actor before trying again.");
  return { ok: Boolean(saved), needsReview: !saved };
}

/** Apply one selected target through the shared, stage-recorded outcome service. */
export async function executeChatOutcome(outcome, context) {
  const actor = context.actor;
  const combatId = String(outcome.payload?.combatId ?? "");
  const data = context.message?.toObject?.() ?? {};
  const author = context.message?.author;
  const authorId = typeof author === "string" ? author : author?.id ?? data.user ?? data.author;
  if (!actor || !combatId || typeof authorId !== "string" || !game.users?.get?.(authorId)?.isGM) {
    throw Object.assign(new Error("War Cry requires a GM-confirmed target and recorded encounter."), { committed: false });
  }
  const check = () => requireEncounter(combatId);
  const test = await context.stage("warCry.test", async () => {
    check();
    if (readImmunities(actor).includes(combatId) || isFearImmune(actor, "panic")) {
      return { ok: true, prepared: { immune: true } };
    }
    const tn = wpTN(actor, 30, "panic");
    const result = await doTestRoll(actor, { target: tn, rollFormula: "1d100", allowLucky: true, allowUnlucky: true });
    const message = await result?.roll?.toMessage?.({
      user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} - War Cry Panic (+30), TN ${tn}`, rollMode: getCoreRollMode(),
    });
    if (!message?.id || typeof result?.isSuccess !== "boolean") throw new Error("The War Cry Panic roll was not confirmed.");
    return { ok: true, prepared: { immune: false, passed: result.isSuccess, rollMessageId: message.id, tn } };
  }, { requiresGM: true });
  if (test?.prepared?.immune) return { ok: true, skipped: true, message: "The target is immune to this War Cry in the encounter." };

  if (test?.prepared?.passed === true) {
    await context.stage("warCry.immunity", async () => {
      check();
      let alreadyRecorded = false;
      const saved = await requestAtomicUpdateDocument(actor, fresh => {
        check();
        const encounters = readImmunities(fresh);
        if (encounters.includes(combatId)) { alreadyRecorded = true; return null; }
        if (encounters.length >= IMMUNITY_LIMIT) throw new Error("War Cry immunity history needs GM review before another entry.");
        return { [IMMUNITY_PATH]: { version: 1, encounters: [...encounters, combatId] } };
      });
      if (!saved && !alreadyRecorded) throw new Error("War Cry encounter immunity was not confirmed.");
      return { ok: true };
    }, { requiresGM: true, lockDocuments: false });
    await context.stage("warCry.summary", async () => {
      const message = await postFearMessage(actor, "War Cry", `<p><b>${escapeFearHtml(actor.name)}</b> passed Panic (+30) and is immune to War Cry for this encounter.</p>`);
      if (!message?.id) throw new Error("The War Cry success summary was not confirmed.");
      return { ok: true, messageId: message.id };
    }, { requiresGM: true });
    return { ok: true, message: "Panic passed; encounter immunity recorded." };
  }
  if (test?.prepared?.passed !== false) throw new Error("The recorded War Cry test result needs review.");

  const table = await context.stage("warCry.panicRoll", async () => {
    check();
    const roll = await rollFearD100();
    const total = Number(roll?.total);
    if (!Number.isInteger(total) || total < 1 || total > 100) throw new Error("The Panic table roll was not established.");
    const message = await roll.toMessage({
      user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} - War Cry Panic table`, rollMode: getCoreRollMode(),
    });
    if (!message?.id) throw new Error("The Panic table roll message was not confirmed.");
    return { ok: true, prepared: { total, rollMessageId: message.id } };
  }, { requiresGM: true });
  const result = await context.stage("warCry.panicEffect", async () => {
    check();
    const applied = await panicOutcome(actor, table?.prepared?.total);
    if (!applied?.key || !applied?.text || applied.needsReview) throw new Error("The Panic effect was not confirmed.");
    return { ok: true, prepared: { key: applied.key, text: applied.text } };
  }, { requiresGM: true });
  await context.stage("warCry.summary", async () => {
    const message = await postFearMessage(actor, "War Cry Panic Result",
      `<p><b>Roll:</b> ${Number(table.prepared.total)}</p><p>${escapeFearHtml(result.prepared.text)}</p>`);
    if (!message?.id) throw new Error("The Panic result summary was not confirmed.");
    return { ok: true, messageId: message.id };
  }, { requiresGM: true });
  return { ok: true, message: "Panic outcome applied." };
}
