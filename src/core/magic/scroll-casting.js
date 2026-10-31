import { requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { canActorCastSpell } from "./magicka-utils.js";
import { createActionResult, withActionResult, aggregateActionResults, addActionErrorContext } from "../../application/action-results.js";
import { isCoreRejuvenateSpell } from "./rejuvenate-choice.js";
import { getCoreRejuvenateConfigurationIssue, getCoreReplenishConfigurationIssue, isCoreReplenishSpell } from "./services/resource-restoration-service.js";

function toBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true;
}

export async function resolveScrollLinkedSpell(scrollItem) {
  const spellUuid = String(scrollItem?.system?.spellUuid ?? "").trim();
  if (!spellUuid) {
    return { ok: false, spell: null, spellUuid: "", error: "This scroll has no spell assigned." };
  }

  let spell = null;
  try {
    spell = await fromUuid(spellUuid);
  } catch (_err) {
    spell = null;
  }

  if (!spell || spell?.documentName !== "Item" || String(spell?.type ?? "") !== "spell") {
    return { ok: false, spell: null, spellUuid, error: "The linked spell reference could not be resolved." };
  }

  return { ok: true, spell, spellUuid, error: null };
}

export async function castScrollFromItem(options = {}) {
  try {
    const value = await castScroll(options);
    if (value.actionResult) return value;
    return withActionResult(value, { owner: "scroll", scope: "cast and consumption", status: "rejected", reason: value.error,
      references: { itemUuid: options.scrollItem?.uuid, actorUuid: options.casterActor?.uuid } });
  } catch (error) {
    throw addActionErrorContext(error, { owner: "scroll", scope: "cast and consumption", status: "needsReview", commitment: "uncertain",
      reason: String(error.message ?? error), references: { itemUuid: options.scrollItem?.uuid, actorUuid: options.casterActor?.uuid } });
  }
}

async function castScroll({
  scrollItem,
  casterActor = null,
  castActionType = "primary",
} = {}) {
  const scroll = scrollItem ?? null;
  const actor = casterActor ?? scroll?.actor ?? null;

  if (!scroll || String(scroll.type ?? "") !== "scroll") {
    return { success: false, consumed: false, error: "Invalid scroll item." };
  }
  if (!actor) {
    return { success: false, consumed: false, error: "This scroll is not owned by an actor." };
  }

  const resolved = await resolveScrollLinkedSpell(scroll);
  if (!resolved.ok) {
    return { success: false, consumed: false, error: resolved.error };
  }

  const requiresTraining = toBool(scroll.system?.requireSchoolTraining, false);
  const consumesMagicka = toBool(scroll.system?.consumeMagicka, false);
  const consumeOnCast = toBool(scroll.system?.consumeOnCast, true);
  const restorationIssue = getCoreRejuvenateConfigurationIssue(resolved.spell)
    ?? getCoreReplenishConfigurationIssue(resolved.spell, { spellOptions: { consumeMagicka: consumesMagicka } });
  if (restorationIssue) {
    ui.notifications.warn(`${restorationIssue} The scroll was not consumed.`);
    return { success: false, consumed: false, error: restorationIssue };
  }
  const casterTokenUuid = actor.getActiveTokens?.()?.[0]?.document?.uuid
    ?? actor.getActiveTokens?.()?.[0]?.uuid
    ?? canvas?.tokens?.controlled?.find?.((t) => t?.actor?.id === actor.id)?.document?.uuid
    ?? canvas?.tokens?.controlled?.find?.((t) => t?.actor?.id === actor.id)?.uuid
    ?? null;
  const targetTokenUuids = Array.from(game?.user?.targets ?? [])
    .map((t) => t?.document?.uuid ?? t?.uuid)
    .filter(Boolean);

  const { CastSpellService } = await import("../../application/magic/cast-spell-service.js");
  const castResult = await CastSpellService.cast({
    spellUuid: resolved.spellUuid,
    casterActorUuid: actor.uuid,
    casterTokenUuid,
    targetTokenUuids,
    castActionType: String(castActionType || "primary").toLowerCase() === "secondary" ? "secondary" : "primary",
    scrollMode: true,
    ignoreTraining: !requiresTraining,
    consumeMagicka: consumesMagicka,
  });

  const cancelled = castResult?.error === "Casting cancelled by user";
  const guardedRestoration = isCoreRejuvenateSpell(resolved.spell) || isCoreReplenishSpell(resolved.spell);
  if (guardedRestoration && (!castResult?.messageId || !["complete", "pending"].includes(castResult?.actionResult?.status))) {
    if (["confirmed", "uncertain"].includes(castResult?.actionResult?.commitment)) {
      ui.notifications.warn("The scroll cast needs GM review. Inspect its costs, result and scroll before retrying; no scroll consumption was attempted here.");
    }
    return { ...castResult, consumed: false, removed: false };
  }
  if (!cancelled && consumeOnCast) {
    const newQty = Math.max(0, (Number(scroll.system?.quantity) || 1) - 1);
    const removed = newQty <= 0 && scroll.isOwned && Boolean(actor);
    const confirmed = removed ? await requestDeleteEmbeddedDocuments(actor, "Item", [scroll.id])
      : await requestUpdateDocument(scroll, { "system.quantity": newQty });
    const consumption = createActionResult({ owner: "scroll", scope: "consumption", status: confirmed ? "complete" : "needsReview",
      commitment: confirmed ? "confirmed" : "uncertain", reason: confirmed ? null : "Scroll consumption was not confirmed. Inspect before retrying.",
      references: { itemUuid: scroll.uuid, actorUuid: actor.uuid } });
    const actionResult = aggregateActionResults([castResult, consumption], { owner: "scroll", scope: "cast and consumption",
      references: { ...castResult.actionResult.references, itemUuid: scroll.uuid } });
    if (!confirmed) ui.notifications?.warn?.(consumption.reason);
    return withActionResult({ ...castResult, consumed: Boolean(confirmed), newQty: confirmed ? newQty : null,
      removed: Boolean(confirmed && removed), notificationHandled: true }, actionResult);
  }

  return { ...(castResult ?? { success: false }), consumed: false, removed: false };
}

export async function getCastableScrollCandidates(actor, { castActionType = "primary" } = {}) {
  const isSecondary = String(castActionType ?? "primary").toLowerCase() === "secondary";
  const items = actor?.items ?? [];
  const out = [];

  for (const it of items) {
    if (!it || it.type !== "scroll") continue;
    const qty = Number(it.system?.quantity ?? 0);
    if (qty <= 0) continue;

    const resolved = await resolveScrollLinkedSpell(it);
    if (!resolved.ok) continue;

    const spell = resolved.spell;
    if (isSecondary && spell?.system?.isInstant !== true) continue;

    const requiresTraining = toBool(it.system?.requireSchoolTraining, false);
    if (requiresTraining && !canActorCastSpell(actor, spell)) continue;

    out.push({ scroll: it, spell });
  }

  return out;
}
