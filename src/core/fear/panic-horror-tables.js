import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";
import { SYSTEM_ID } from "../system/namespace.js";
import {
  createFearEffect,
  createOneTurnFearEffect,
  postFearMessage,
  rollFearD100,
  spendFearStamina,
} from "./effects-and-restrictions.js";

export async function panicOutcome(actor, rollTotal) {
  const d100 = Number(rollTotal ?? 1) || 1;
  if (d100 <= 30) {
    await createOneTurnFearEffect(actor, { key: "panic.startled", name: "Fear: Startled", description: "Panic 1-30. You may not make any reactions until the beginning of their next Turn.", blockReactions: true, snapOut: false });
    return { key: "startled", text: "You may not make any reactions until the beginning of their next Turn." };
  }
  if (d100 <= 60) {
    await createFearEffect(actor, { key: "panic.spooked", name: "Fear: Spooked", description: "Panic 31-60. You are Spooked and suffer a -10 penalty to all Tests until you Snap Out.", testPenalty: -10, snapOut: true });
    return { key: "spooked", text: "Spooked: -10 to all tests until you Snap Out of it." };
  }
  if (d100 <= 90) {
    await createFearEffect(actor, { key: "panic.frightened", name: "Fear: Frightened", description: "Panic 61-90. You are Frightened, suffer a -10 penalty to all Tests, and cannot willingly approach the Fear Source until you Snap Out.", testPenalty: -10, cannotApproach: true, snapOut: true });
    return { key: "frightened", text: "Frightened: -10 to all tests and cannot willingly approach the fear source until you snap out." };
  }
  if (d100 <= 95) {
    await createFearEffect(actor, { key: "panic.lostComposure", name: "Fear: Lost Composure", description: "Panic 91-95. You are completely unable to take any actions until you Snap Out. Once you do, you suffer a -10 penalty to all Tests for the remainder of the encounter.", blockActions: true, snapOut: true, applyAfterSnapPenalty: -10 });
    return { key: "lost-composure", text: "Lost Composure: cannot take actions until you snap out; then suffer -10 for the encounter." };
  }

  await createFearEffect(actor, { key: "panic.running", name: "Fear: Running and Screaming", description: "Panic 96-00. You suffer a -20 penalty to all Tests, are unable to take any actions, and must flee from the Fear Source until you Snap Out.", testPenalty: -20, blockActions: true, cannotApproach: true, snapOut: true });
  return { key: "running", text: "Running and Screaming: flee from the fear source; -20 to tests until you snap out." };
}

export async function horrorOutcome(actor, rollTotal) {
  const d100 = Number(rollTotal ?? 1) || 1;
  if (d100 <= 40) {
    await createOneTurnFearEffect(actor, { key: "horror.blackout.short", name: "Horror: Momentary Blackout", description: "Horror 01-40. You become catatonic for 1 Round, losing all AP and unable to take any actions. Once the effect expires, you suffer a -10 penalty to all Tests for the remainder of the encounter.", blockActions: true, applyAfterSnapPenalty: -10 });
    return { key: "momentary-blackout", text: "Momentary Blackout: lose your next round of actions; then suffer -10 for the encounter." };
  }
  if (d100 <= 60) {
    await createOneTurnFearEffect(actor, { key: "horror.vomiting", name: "Horror: Uncontrollable Vomiting", description: "Horror 41-60. You are helpless for 1 Round and lose 1 Stamina Point.", blockActions: true });
    await spendFearStamina(actor, 1);
    return { key: "vomiting", text: "Uncontrollable Vomiting: helpless for 1 round and lose 1 Stamina." };
  }
  if (d100 <= 80) {
    await createFearEffect(actor, { key: "horror.manicTerror", name: "Horror: Manic Terror", description: "Horror 61-80. You completely lose control of your actions. At the start of each of your Turns, you can attempt to Snap Out, lose 1d4 Stamina points immediately after Snap Out.", snapOut: true });
    return { key: "manic-terror", text: "Manic Terror: lose control; attempt to snap out at the start of each of your turns, lose 1d4 Stamina points immediately after Snap Out." };
  }
  if (d100 <= 90) {
    const roundsRoll = await rollFearD100();
    const rounds = Math.max(1, Math.ceil(Number(roundsRoll.total ?? 1) / 20));
    await createFearEffect(actor, { key: "horror.despair", name: `Horror: Hopeless (${rounds} rounds)`, description: `Horror 81-90. You are completely incapacitated for ${rounds} Rounds and lose 1d4 Stamina Points.`, blockActions: true, encounterScoped: false, extraFlags: { fixedRounds: rounds } });
    const staminaLoss = new Roll("1d4");
    await staminaLoss.evaluate();
    await spendFearStamina(actor, Number(staminaLoss.total ?? 1) || 1);
    return { key: "despair", text: `Hopeless and Despairing: incapacitated for ${rounds} rounds; lose ${staminaLoss.total} Stamina.` };
  }
  if (d100 <= 95) {
    await createFearEffect(actor, { key: "horror.blackout.long", name: "Horror: Blackout", description: "Horror 91-95. You enter a catatonic state from which you cannot recover without outside assistance. Duration is at the GM's discretion.", blockActions: true, snapOut: false, encounterScoped: false, extraFlags: { longBlackout: true } });
    return { key: "blackout", text: "Blackout: catatonic state (GM adjudicates duration)." };
  }
  if (d100 <= 99) {
    await createFearEffect(actor, { key: "horror.mindBreak", name: "Horror: Mind Break", description: "Horror 96-99. The character's will bends as their mind shatters. They drop to the ground while stuttering and mumbling incomprehensibly for 1d6 rounds. The character's mind is irrepressibly damaged, and they lose either 1d8 Willpower or Personality (player's choice) permanently from the harrowing experience. Afterwards, the character cannot attack or approach the source of horror until they snap out of the effect or for the rest of the encounter.", blockActions: true, cannotApproach: true, snapOut: true });
    return { key: "mind-break", text: "Mind Break: lose control, suffer permanent mental damage, and cannot attack or approach the source until you snap out." };
  }

  const endTN = Number(actor?.system?.characteristics?.end?.total ?? 0) || 0;
  const endRes = await doTestRoll(actor, { target: endTN, rollFormula: "1d100", allowLucky: true, allowUnlucky: true });
  try {
    await endRes?.roll?.toMessage?.({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), flavor: `${actor.name} - Scared to Death (END ${endTN})`, rollMode: getCoreRollMode() });
  } catch (_err) {}

  if (!endRes?.isSuccess) {
    await requestUpdateDocument(actor, {
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
    return { key: "scared-to-death", text: "Scared to Death: the character must make an Endurance test or die on the spot." };
  }

  await createFearEffect(actor, { key: "horror.blackout.long", name: "Horror: Blackout", description: "Horror 100 (survived). You passed the Endurance test but collapse into a catatonic state. Duration is at the GM's discretion.", blockActions: true, encounterScoped: false, extraFlags: { longBlackout: true } });
  await postFearMessage(actor, "Horror", "<p>The character survives the shock but collapses into a catatonic blackout.</p>");
  return { key: "scared-to-death-survived", text: "Scared to Death: survived the Endurance test but collapsed into catatonia." };
}
