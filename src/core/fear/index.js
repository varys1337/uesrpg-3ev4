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
import { attemptSnapOut, reviewSnapOut } from "./snap-out.js";
import { reviewWarCryImmunity } from "./war-cry.js";
import { registerFearSystemHooks } from "./combat-boundary.js";
import { t, tf } from "../../utils/i18n.js";

export { getFearActionRestrictions } from "./effects-and-restrictions.js";
export { attemptSnapOut } from "./snap-out.js";

export async function promptFearTest({ actor, type = "panic", modifier = 0, source = "Fear", inCombat = null } = {}) {
  if (!actor) return { ok: false, reason: "no-actor" };

  const fearType = String(type ?? "panic").toLowerCase() === "horror" ? "horror" : "panic";
  const combatActive = inCombat ?? Boolean(game.combat?.started);

  if (isFearImmune(actor, fearType)) {
    try {
      const message = await postFearMessage(actor, "Fear", `<p><b>${escapeFearHtml(actor.name)}</b> is immune to ${fearType} effects.</p>`);
      if (!message?.id) throw new Error("The immunity summary was not confirmed.");
      return { ok: true, immune: true };
    } catch (error) {
      console.warn("UESRPG | Fear immunity summary was not confirmed", error);
      ui.notifications?.warn?.(`${actor.name}: fear immunity was established, but the summary was not confirmed. Inspect chat before retrying.`);
      return { ok: false, partial: true, needsReview: true, immune: true };
    }
  }

  const tn = wpTN(actor, modifier, fearType);
  let test;
  try {
    test = await doTestRoll(actor, {
      target: tn,
      rollFormula: "1d100",
      allowLucky: true,
      allowUnlucky: true,
    });
  } catch (error) {
    console.warn("UESRPG | Fear test roll failed", error);
    ui.notifications?.warn?.(`${actor.name}: the fear test could not be completed. Inspect the actor and chat before retrying.`);
    return { ok: false, partial: true, needsReview: true, type: fearType, source };
  }

  try {
    const message = await test?.roll?.toMessage?.({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} - ${fearType === "panic" ? "Panic" : "Horror"} Test (WP ${tn})`,
      rollMode: getCoreRollMode(),
    });
    if (!message?.id || typeof test?.isSuccess !== "boolean") throw new Error("The fear roll was not confirmed.");
  } catch (error) {
    console.warn("UESRPG | Fear test roll was not confirmed", error);
    ui.notifications?.warn?.(`${actor.name}: the fear test roll was not confirmed. Ask the GM to inspect chat before resolving it; do not reroll.`);
    return { ok: false, partial: true, needsReview: true, type: fearType, source };
  }

  if (test?.isSuccess) {
    try {
      const message = await postFearMessage(actor, "Fear", `<p><b>${escapeFearHtml(actor.name)}</b> withstands the fear source (${escapeFearHtml(source)}).</p>`);
      if (!message?.id) throw new Error("The fear summary was not confirmed.");
    } catch (error) {
      console.warn("UESRPG | Fear success summary was not confirmed", error);
      ui.notifications?.warn?.(`${actor.name}: the successful fear test was rolled, but its summary was not confirmed. Inspect chat; do not reroll.`);
      return { ok: false, partial: true, needsReview: true, success: true, type: fearType, source };
    }
    return { ok: true, success: true, type: fearType, source };
  }

  if (!combatActive) {
    let effectConfirmed = false;
    let summaryConfirmed = false;
    try {
      const effect = await createFearEffect(actor, {
        key: "fear.nonCombat",
        name: "Fear: Unnerved",
        description: "Failed Fear Test outside combat. The GM applies -20 only to tests requiring concentration while the character remains near the fear source, then removes this effect when appropriate.",
        snapOut: false,
        encounterScoped: false,
        extraFlags: { source, type: fearType },
      });
      effectConfirmed = Boolean(effect?.id);
    } catch (error) {
      console.warn("UESRPG | Non-combat fear effect was not confirmed", error);
    }
    try {
      const message = await postFearMessage(actor, "Fear", `<p><b>${escapeFearHtml(actor.name)}</b> is unnerved. The GM applies -20 to concentration tests only while near the fear source.</p>`);
      summaryConfirmed = Boolean(message?.id);
    } catch (error) {
      console.warn("UESRPG | Non-combat fear summary was not confirmed", error);
    }
    const needsReview = !effectConfirmed || !summaryConfirmed;
    if (needsReview) ui.notifications?.warn?.(`${actor.name}: the fear result was rolled, but the effect or summary was not confirmed. Ask the GM to inspect the actor and chat; do not reroll.`);
    return { ok: !needsReview, partial: needsReview, needsReview, manual: true, success: false, type: fearType, source, inCombat: false };
  }

  let d100;
  let tableTotal = null;
  try {
    d100 = await rollFearD100();
    tableTotal = Number(d100?.total);
    if (!Number.isInteger(tableTotal) || tableTotal < 1 || tableTotal > 100) {
      tableTotal = null;
      throw new Error("The fear table roll was not established.");
    }
    const message = await d100.toMessage({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} - ${fearType === "panic" ? "Panic" : "Horror"} result table`,
      rollMode: getCoreRollMode(),
    });
    if (!message?.id) throw new Error("The fear table roll message was not confirmed.");
  } catch (error) {
    console.warn("UESRPG | Fear table roll was not confirmed", error);
    ui.notifications?.warn?.(`${actor.name}: the fear test failed, but the table roll was not confirmed${tableTotal == null ? "" : ` (rolled ${tableTotal})`}. Ask the GM to inspect chat and resolve the result manually; do not repeat the test.`);
    return { ok: false, partial: true, needsReview: true, success: false, type: fearType, source, inCombat: true, tableRoll: tableTotal };
  }

  let outcome;
  try {
    outcome = fearType === "panic"
      ? await panicOutcome(actor, tableTotal)
      : await horrorOutcome(actor, tableTotal);
    if (!outcome?.key || !outcome?.text) throw new Error("The fear outcome was not established.");
  } catch (error) {
    console.warn("UESRPG | Fear outcome was not confirmed", error);
    ui.notifications?.warn?.(`${actor.name}: the fear table rolled ${tableTotal}, but its outcome was not confirmed. Ask the GM to inspect the actor and chat; do not reroll.`);
    return { ok: false, partial: true, needsReview: true, success: false, type: fearType, source, inCombat: true, tableRoll: tableTotal };
  }

  let summaryConfirmed = false;
  try {
    const message = await postFearMessage(
      actor,
      fearType === "panic" ? "Panic Result" : "Horror Result",
      `<p><b>Roll:</b> ${tableTotal}</p><p>${escapeFearHtml(outcome.text)}</p>`
    );
    summaryConfirmed = Boolean(message?.id);
  } catch (error) {
    console.warn("UESRPG | Fear result summary was not confirmed", error);
  }
  if (!summaryConfirmed) {
    ui.notifications?.warn?.(`${actor.name}: the fear result summary was not confirmed. Ask the GM to inspect chat and the actor; do not reroll.`);
  }
  const needsReview = outcome?.needsReview === true || !summaryConfirmed;

  return {
    ok: !needsReview,
    partial: needsReview,
    needsReview,
    success: false,
    type: fearType,
    source,
    inCombat: true,
    tableRoll: tableTotal,
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
    actors,
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
    let result;
    try {
      result = await promptFearTest({ actor, type: testType, modifier: testModifier, source: testSource });
    } catch (error) {
      console.warn("UESRPG | Fear test needs review", { actorUuid: actor.uuid, error });
      ui.notifications?.warn?.(`${actor.name}: fear resolution was interrupted. Inspect the actor and chat before retrying.`);
      result = { ok: false, partial: true, needsReview: true };
    }
    results.push({ actorId: actor.id, actorName: actor.name, result });
  }

  const needsReview = results.some(entry => entry.result?.needsReview === true);
  const ok = results.every(entry => entry.result?.ok === true);
  const partial = results.some(entry => entry.result?.partial === true) || (!ok && results.some(entry => entry.result?.ok === true));
  return { ok, partial, needsReview, count: actors.length, results };
}

export function registerFearSystem() {
  registerFearSystemHooks();
}

export const FearAPI = {
  promptFearTest,
  promptFearTestForSelection,
  attemptSnapOut,
  reviewSnapOut,
  reviewWarCryImmunity,
  getFearActionRestrictions,
};

export function buildFearApi() {
  return FearAPI;
}
