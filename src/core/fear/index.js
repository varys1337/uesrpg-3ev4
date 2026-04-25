/**
 * src/core/fear/index.js
 *
 * Chapter 5 fear workflow.
 */

import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";
import { createFearEffect, escapeFearHtml, getFearActionRestrictions, isFearImmune, postFearMessage, rollFearD100, wpTN } from "./effects-and-restrictions.js";
import { panicOutcome, horrorOutcome } from "./panic-horror-tables.js";
import { showFearTestDialog } from "./fear-dialogs.js";
import { attemptSnapOut } from "./snap-out.js";
import { registerFearSystemHooks } from "./combat-boundary.js";
import { t, tf } from "../../utils/i18n.js";

export { getFearActionRestrictions } from "./effects-and-restrictions.js";
export { attemptSnapOut } from "./snap-out.js";

export async function promptFearTest({ actor, type = "panic", modifier = 0, source = "Fear", inCombat = null } = {}) {
  if (!actor) return { ok: false, reason: "no-actor" };

  const fearType = String(type ?? "panic").toLowerCase() === "horror" ? "horror" : "panic";
  const combatActive = inCombat ?? Boolean(game.combat?.started);

  if (isFearImmune(actor, fearType)) {
    await postFearMessage(actor, "Fear", `<p><b>${escapeFearHtml(actor.name)}</b> is immune to ${fearType} effects.</p>`);
    return { ok: true, immune: true };
  }

  const tn = wpTN(actor, modifier, fearType);
  const test = await doTestRoll(actor, {
    target: tn,
    rollFormula: "1d100",
    allowLucky: true,
    allowUnlucky: true,
  });

  try {
    await test?.roll?.toMessage?.({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} - ${fearType === "panic" ? "Panic" : "Horror"} Test (WP ${tn})`,
      rollMode: getCoreRollMode(),
    });
  } catch (_err) {}

  if (test?.isSuccess) {
    await postFearMessage(actor, "Fear", `<p><b>${escapeFearHtml(actor.name)}</b> withstands the fear source (${escapeFearHtml(source)}).</p>`);
    return { ok: true, success: true, type: fearType, source };
  }

  if (!combatActive) {
    await createFearEffect(actor, {
      key: "fear.nonCombat",
      name: "Fear: Unnerved",
      description: "Failed Fear Test (out of combat). You are Unnerved and suffer a -20 penalty to all concentration-related Tests whenever near the Fear Source.",
      testPenalty: -20,
      snapOut: false,
      encounterScoped: false,
      extraFlags: { source, type: fearType },
    });
    await postFearMessage(actor, "Fear", `<p><b>${escapeFearHtml(actor.name)}</b> is unnerved and suffers -20 to concentration tests near the fear source.</p>`);
    return { ok: true, success: false, type: fearType, source, inCombat: false };
  }

  const d100 = await rollFearD100();
  const outcome = fearType === "panic"
    ? await panicOutcome(actor, d100.total)
    : await horrorOutcome(actor, d100.total);

  await postFearMessage(
    actor,
    fearType === "panic" ? "Panic Result" : "Horror Result",
    `<p><b>Roll:</b> ${Number(d100.total ?? 0)}</p><p>${escapeFearHtml(outcome?.text ?? "No effect")}</p>`
  );

  return {
    ok: true,
    success: false,
    type: fearType,
    source,
    inCombat: true,
    tableRoll: Number(d100.total ?? 0) || 0,
    outcome: outcome?.key ?? null,
  };
}

export async function promptFearTestForSelection({ type = null, modifier = null, source = null } = {}) {
  const controlled = canvas?.tokens?.controlled ?? [];
  if (!controlled.length) {
    ui.notifications.warn(t("UESRPG.Notifications.Fear.NoTokensSelected"));
    return { ok: false, reason: "no-tokens" };
  }

  const actors = controlled.map((token) => token.actor).filter(Boolean);
  if (!actors.length) {
    ui.notifications.warn(t("UESRPG.Notifications.Fear.NoActorsSelected"));
    return { ok: false, reason: "no-actors" };
  }

  const config = await showFearTestDialog({
    defaultType: type ?? "panic",
    defaultModifier: modifier ?? 0,
    defaultSource: source ?? t("UESRPG.Dialogs.Fear.Source"),
  });
  if (!config) return { ok: false, reason: "cancelled" };

  const testType = String(config.type ?? "panic").toLowerCase() === "horror" ? "horror" : "panic";
  const testModifier = Number(config.modifier ?? 0) || 0;
  const testSource = String(config.source ?? t("UESRPG.Dialogs.Fear.Source")).trim() || t("UESRPG.Dialogs.Fear.Source");
  const results = [];

  for (const actor of actors) {
    const result = await promptFearTest({
      actor,
      type: testType,
      modifier: testModifier,
      source: testSource,
    });
    results.push({ actorId: actor.id, actorName: actor.name, result });
  }

  return { ok: true, count: actors.length, results };
}

export function registerFearSystem() {
  registerFearSystemHooks();
}

export const FearAPI = {
  promptFearTest,
  promptFearTestForSelection,
  attemptSnapOut,
  getFearActionRestrictions,
};

export function buildFearApi() {
  return FearAPI;
}
