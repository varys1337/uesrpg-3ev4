import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";
import { SYSTEM_ID } from "../system/namespace.js";
import {
  createFearEffect,
  createOneTurnFearEffect,
} from "./effects-and-restrictions.js";

async function confirmFearEffect(actor, create, options) {
  try {
    const effect = await create(actor, options);
    if (!effect?.id) throw new Error("The fear effect was not confirmed.");
    return true;
  } catch (error) {
    console.warn("UESRPG | Fear effect was not confirmed", error);
    ui.notifications?.warn?.(`${actor.name}: ${options.name} was not confirmed. Ask the GM to inspect the actor and result before retrying; do not reroll.`);
    return false;
  }
}

async function rollHorrorDuration(actor, formula, label, maximum) {
  try {
    const roll = await new Roll(formula).evaluate();
    const result = Number(roll.total);
    if (!Number.isInteger(result) || result < 1 || result > maximum) throw new Error("Invalid duration roll.");
    return result;
  } catch (error) {
    console.warn("UESRPG | Horror duration roll failed", error);
    ui.notifications?.warn?.(`${actor.name}: ${label} duration was not established. The GM must roll and resolve it manually.`);
    return null;
  }
}

async function blackoutOutcome(actor, { survived = false } = {}) {
  const hours = await rollHorrorDuration(actor, "1d4", "Blackout", 4);
  if (!hours) return { key: survived ? "scared-to-death-survived" : "blackout", needsReview: true,
    text: "Blackout duration was not established. The GM must roll 1d4 hours and resolve it manually." };
  const source = survived ? "Horror 100 (survived)" : "Horror 91-95";
  const confirmed = await confirmFearEffect(actor, createFearEffect, {
    key: "horror.blackout.long",
    name: `Horror: Blackout (${hours} hours)`,
    description: `${source}. Catatonic for ${hours} hours and cannot be roused by normal means. The GM tracks elapsed time and removes this effect when it ends.`,
    blockActions: true, snapOut: false, encounterScoped: false,
    extraFlags: { longBlackout: true, durationHours: hours }
  });
  return { key: survived ? "scared-to-death-survived" : "blackout", needsReview: !confirmed,
    text: `${survived ? "Survived the Endurance test. " : ""}Blackout: catatonic for ${hours} hours; cannot be roused normally. The GM tracks expiry.${confirmed ? "" : " Effect not confirmed; inspect the actor."}` };
}

export async function panicOutcome(actor, rollTotal) {
  const d100 = Number(rollTotal ?? 1) || 1;
  if (d100 <= 30) {
    const confirmed = await confirmFearEffect(actor, createOneTurnFearEffect, { key: "panic.startled", name: "Fear: Startled", description: "Panic 1-30. You may not make any reactions until the beginning of your next Turn.", blockReactions: true, snapOut: false });
    return { key: "startled", needsReview: !confirmed, text: `You may not make any reactions until the beginning of your next Turn.${confirmed ? "" : " Effect not confirmed; inspect the actor."}` };
  }
  if (d100 <= 60) {
    const confirmed = await confirmFearEffect(actor, createFearEffect, { key: "panic.spooked", name: "Fear: Spooked", description: "Panic 31-60. You are Spooked and suffer a -10 penalty to all Tests for the encounter unless you Snap Out.", testPenalty: -10, snapOut: true });
    return { key: "spooked", needsReview: !confirmed, text: `Spooked: -10 to all tests for the encounter unless you snap out.${confirmed ? "" : " Effect not confirmed; inspect the actor."}` };
  }
  if (d100 <= 90) {
    const confirmed = await confirmFearEffect(actor, createFearEffect, { key: "panic.frightened", name: "Fear: Frightened", description: "Panic 61-90. You suffer a -10 penalty to all Tests and cannot willingly approach the fear source until the encounter ends.", testPenalty: -10, cannotApproach: true, snapOut: false });
    return { key: "frightened", needsReview: !confirmed, text: `Frightened: -10 to all tests and cannot willingly approach the fear source until the encounter ends.${confirmed ? "" : " Effect not confirmed; inspect the actor."}` };
  }
  if (d100 <= 95) {
    const confirmed = await confirmFearEffect(actor, createFearEffect, { key: "panic.lostComposure", name: "Fear: Lost Composure", description: "Panic 91-95. You are completely unable to take any actions until you Snap Out. Once you do, you suffer a -10 penalty to all Tests for the remainder of the encounter.", blockActions: true, blockReactions: true, snapOut: true, applyAfterSnapPenalty: -10 });
    return { key: "lost-composure", needsReview: !confirmed, text: `Lost Composure: cannot take actions until you snap out; then suffer -10 for the encounter.${confirmed ? "" : " Effect not confirmed; inspect the actor."}` };
  }

  const confirmed = await confirmFearEffect(actor, createFearEffect, { key: "panic.running", name: "Fear: Running and Screaming", description: "Panic 96-00. Flee directly away from the fear source as fast as possible, drop equipment that slows you, and suffer -20 to all tests until you snap out or the encounter ends. The GM handles required movement and, once away from danger, Snap Out.", testPenalty: -20, blockActions: true, cannotApproach: true, snapOut: false });
  return { key: "running", needsReview: !confirmed, text: `Running and Screaming: the GM handles flight and Snap Out once away from danger; -20 to tests until then or the encounter ends.${confirmed ? "" : " Effect not confirmed; inspect the actor."}` };
}

export async function horrorOutcome(actor, rollTotal) {
  const d100 = Number(rollTotal ?? 1) || 1;
  if (d100 <= 40) {
    await createOneTurnFearEffect(actor, { key: "horror.blackout.short", name: "Horror: Momentary Blackout", description: "Horror 01-40. You become catatonic for 1 Round, losing all AP and unable to take any actions. Once the effect expires, you suffer a -10 penalty to all Tests for the remainder of the encounter.", blockActions: true, applyAfterSnapPenalty: -10 });
    return { key: "momentary-blackout", text: "Momentary Blackout: lose your next round of actions; then suffer -10 for the encounter." };
  }
  if (d100 <= 60) {
    const confirmed = await confirmFearEffect(actor, createOneTurnFearEffect, { key: "horror.vomiting", name: "Horror: Uncontrollable Vomiting", description: "Horror 41-60. You are helpless for 1 round. Afterwards, lose 1 Stamina; the GM handles this loss and any Fatigue.", blockActions: true });
    return { key: "vomiting", needsReview: !confirmed, text: `Uncontrollable Vomiting: helpless for 1 round; the GM verifies the duration and afterwards applies the loss of 1 Stamina.${confirmed ? "" : " Effect not confirmed; inspect the actor."}` };
  }
  if (d100 <= 80) {
    await createFearEffect(actor, { key: "horror.manicTerror", name: "Horror: Manic Terror", description: "Horror 61-80. You completely lose control of your actions. At the start of each of your Turns, you can attempt to Snap Out, lose 1d4 Stamina points immediately after Snap Out.", snapOut: true });
    return { key: "manic-terror", text: "Manic Terror: lose control; attempt to snap out at the start of each of your turns, lose 1d4 Stamina points immediately after Snap Out." };
  }
  if (d100 <= 90) {
    const rounds = await rollHorrorDuration(actor, "1d6", "Hopeless and Despairing", 6);
    if (!rounds) return { key: "despair", needsReview: true,
      text: "Hopeless and Despairing: the GM must roll the 1d6-round duration and, afterwards, 1d4 Stamina loss manually." };
    const confirmed = await confirmFearEffect(actor, createFearEffect, { key: "horror.despair", name: `Horror: Hopeless (${rounds} rounds)`, description: `Horror 81-90. You are incapacitated for ${rounds} rounds. When you regain your senses, the GM rolls 1d4 and applies the Stamina loss and any Fatigue.`, blockActions: true, encounterScoped: false, extraFlags: { fixedRounds: rounds } });
    return { key: "despair", needsReview: !confirmed, text: `Hopeless and Despairing: incapacitated for ${rounds} rounds; the GM verifies the duration and afterwards rolls 1d4 and applies the Stamina loss.${confirmed ? "" : " Effect not confirmed; inspect the actor."}` };
  }
  if (d100 <= 95) {
    return blackoutOutcome(actor);
  }
  if (d100 <= 99) {
    await createFearEffect(actor, { key: "horror.mindBreak", name: "Horror: Mind Break", description: "Horror 96-99. The character's will bends as their mind shatters. They drop to the ground while stuttering and mumbling incomprehensibly for 1d6 rounds. The character's mind is irrepressibly damaged, and they lose either 1d8 Willpower or Personality (player's choice) permanently from the harrowing experience. Afterwards, the character cannot attack or approach the source of horror until they snap out of the effect or for the rest of the encounter.", blockActions: true, cannotApproach: true, snapOut: true });
    return { key: "mind-break", text: "Mind Break: lose control, suffer permanent mental damage, and cannot attack or approach the source until you snap out." };
  }

  const endTN = Number(actor?.system?.characteristics?.end?.total ?? 0) || 0;
  const endRes = await doTestRoll(actor, { target: endTN, rollFormula: "1d100", allowLucky: true, allowUnlucky: true });
  try {
    const message = await endRes?.roll?.toMessage?.({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), flavor: `${actor.name} - Scared to Death (END ${endTN})`, rollMode: getCoreRollMode() });
    if (!message?.id || typeof endRes?.isSuccess !== "boolean") throw new Error("The Endurance roll was not confirmed.");
  } catch (error) {
    console.warn("UESRPG | Scared to Death roll was not confirmed", error);
    ui.notifications?.warn?.(`${actor.name}: the Scared to Death roll was not confirmed. The GM must inspect the roll before resolving the outcome; do not reroll.`);
    return { key: "scared-to-death", needsReview: true, text: "Scared to Death: the Endurance roll was not confirmed; the GM must resolve the result." };
  }

  if (!endRes?.isSuccess) {
    const confirmed = await requestUpdateDocument(actor, {
      [`flags.${SYSTEM_ID}.chapter5.deathState`]: {
        unconsciousAtZeroHp: true,
        failureCount: 999,
        autoFailNextTest: false,
        isDead: true,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        lastResult: { kind: "fear-death", at: Date.now() }
      }
    });
    if (!confirmed) ui.notifications?.warn?.(`${actor.name}: the Scared to Death death-state update was not confirmed. The GM must inspect the actor before retrying.`);
    return { key: "scared-to-death", needsReview: !confirmed, text: `Scared to Death: failed the Endurance test.${confirmed ? " Death state recorded." : " Death state not confirmed; the GM must inspect the actor."}` };
  }

  return blackoutOutcome(actor, { survived: true });
}
