import { requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { canActorCastSpell } from "./magicka-utils.js";

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

export async function castScrollFromItem({
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
  const casterTokenUuid = actor.getActiveTokens?.()?.[0]?.document?.uuid
    ?? actor.getActiveTokens?.()?.[0]?.uuid
    ?? canvas?.tokens?.controlled?.find?.((t) => t?.actor?.id === actor.id)?.document?.uuid
    ?? canvas?.tokens?.controlled?.find?.((t) => t?.actor?.id === actor.id)?.uuid
    ?? null;
  const targetTokenUuids = Array.from(game?.user?.targets ?? [])
    .map((t) => t?.document?.uuid ?? t?.uuid)
    .filter(Boolean);

  const { SpellCastingService } = await import("./casting-service.js");
  const castResult = await SpellCastingService.cast({
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
  if (!cancelled && consumeOnCast) {
    const newQty = Math.max(0, (Number(scroll.system?.quantity) || 1) - 1);
    if (newQty <= 0 && scroll.isOwned && actor) {
      await requestDeleteEmbeddedDocuments(actor, "Item", [scroll.id]);
      return { ...(castResult ?? { success: true }), consumed: true, newQty: 0, removed: true };
    }
    await requestUpdateDocument(scroll, { "system.quantity": newQty });
    return { ...(castResult ?? { success: true }), consumed: true, newQty, removed: false };
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
