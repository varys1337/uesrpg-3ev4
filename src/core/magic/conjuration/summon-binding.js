/**
 * Resolve the Chapter 6 binding test for an individual summoned token.
 * Unresolved ties and older origins without a recorded casting roll require a
 * GM decision; no Mindlock, restraint penalty or ownership is assumed.
 */
import { registerLinkedEntity, unregisterLinkedEntity } from "../effects/origin-effect.js";
import { applyMindlockEffects } from "../mindlock.js";
import { hasTalent } from "../../traits/talents-api.js";
import { hasActorTrait } from "../../traits/trait-registry.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { buildGenericAEData } from "../../active-effects/modifier-evaluator.js";
import { computeCharacteristicTN } from "../../characteristics/opposed/helpers.js";
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments, requestUpdateDocument, requestUpdateChatMessage } from "../../../utils/authority-proxy.js";
import { acquireLock, releaseLock } from "../../../utils/authority-proxy/shared.js";
import { buildEffectChange } from "../../../utils/compat.js";
import { doTestRoll, resolveOpposed } from "../../../utils/degree-roll-helper.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { escapeHtml } from "../../../utils/html.js";
import { isActiveGMUser } from "../../../utils/users.js";
import { getSummonedTokens } from "./conjuration-state.js";

const TRAIT_PACK = "uesrpg-3ev4.powers-talents-traits";
const TRAIT_IDS = { summoned: "kMoprukjN6r2aeOh", bound: "DpGf3Tn6CJCannAB" };

function hasCastingResult(origin) {
  const flags = origin?.flags?.[FLAG_SCOPE];
  const cast = flags?.castContext?.castingResult;
  if (cast?.isSuccess !== true || cast.degree == null || !Number.isFinite(Number(cast.degree))) return false;
  if (cast.noRoll === true) return flags?.castSource?.type === "enchantment" || flags?.isEnchantmentCast === true;
  return cast.rollTotal != null && Number.isFinite(Number(cast.rollTotal)) && Number(cast.rollTotal) > 0;
}

async function saveBinding(token, patch) {
  const current = token.flags?.[FLAG_SCOPE]?.binding ?? {};
  const saved = await requestUpdateDocument(token, { [`flags.${FLAG_SCOPE}.binding`]: { ...current, ...patch } });
  if (!saved) throw new Error("The summon binding state was not confirmed.");
}

async function ensureTrait(actor, key, originUuid) {
  if (hasActorTrait(actor, key)) return;
  const source = await game.packs.get(TRAIT_PACK)?.getDocument(TRAIT_IDS[key]);
  if (!source || source.type !== "trait" || source.system?.traitKey !== key) {
    throw new Error(`The Core ${key} trait is unavailable or misconfigured.`);
  }
  const data = source.toObject();
  delete data._id;
  data.flags ??= {};
  data.flags[FLAG_SCOPE] = { ...data.flags[FLAG_SCOPE], summonOriginUuid: originUuid };
  const created = await requestCreateEmbeddedDocuments(actor, "Item", [data]);
  if (!created?.[0]) throw new Error(`The ${key} trait was not confirmed on the summoned Actor.`);
}

async function applyRestrainedPenalty(token, origin, spell, caster) {
  if (hasTalent(caster, "unfetteredconjuration")) return;
  if (!origin.flags?.[FLAG_SCOPE]?.spellOptions?.isRestrained) return;
  const actor = token.actor;
  if (!actor) throw new Error("The summoned Actor is unavailable.");
  if (Array.from(actor.effects ?? []).some(effect => effect.flags?.[FLAG_SCOPE]?.restrainedSummonOrigin === origin.uuid)) return;
  const effect = buildGenericAEData({
    source: "spell",
    stack: { policy: "replace", group: `spell.restrained.${origin.id}` },
    name: `Restrained (${spell.name})`,
    img: "icons/magic/control/debuff-chains-ropes-red.webp",
    origin: spell.uuid,
    duration: {},
    flags: { [FLAG_SCOPE]: { spellEffect: true, isRestrainedPenalty: true,
      restrainedSummonOrigin: origin.uuid, spellUuid: spell.uuid, owner: "system", source: "spell-restrained" } },
    changes: [buildEffectChange({ key: "system.modifiers.action_points.max", type: "add", value: "-1", priority: 20 })]
  });
  const created = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [effect]);
  if (!created?.[0]) throw new Error("The restrained summon penalty was not confirmed.");
}

async function runSummonStage(token, group, key, run) {
  if (!isActiveGMUser(game.user)) throw new Error("The active GM changed during summon processing.");
  let state = token.flags?.[FLAG_SCOPE]?.binding?.[group] ?? {};
  if (state.stages?.[key]?.status === "applied") return;
  state = { ...state, status: "processing", stages: { ...state.stages, [key]: { status: "started" } } };
  await saveBinding(token, { [group]: state });
  await run();
  if (!isActiveGMUser(game.user)) throw new Error("The active GM changed after a summon stage.");
  state = token.flags?.[FLAG_SCOPE]?.binding?.[group] ?? state;
  await saveBinding(token, { [group]: { ...state, stages: { ...state.stages, [key]: { status: "applied" } } } });
}

async function finalizeBinding({ caster, token, origin, spell, winner, resume = false }) {
  if (!isActiveGMUser(game.user)) throw new Error("The active GM is required to resolve binding.");
  if (!["bound", "unbound"].includes(winner)) throw new Error("A binding outcome is required.");
  const existing = token.flags?.[FLAG_SCOPE]?.binding;
  if (existing?.status !== "pending" && !(resume && ["resolving", "needsReview"].includes(existing?.status)
    && existing.finalization?.winner === winner)) throw new Error("This binding is no longer pending.");
  if (winner === "unbound") {
    await saveBinding(token, { status: "unbound", resolvedBy: game.user.id });
    return "unbound";
  }
  try {
    if (!isActiveGMUser(game.user)) throw new Error("The active GM changed before binding could be applied.");
    await saveBinding(token, { status: "resolving", resolvedBy: game.user.id,
      finalization: existing?.finalization ?? { winner, status: "processing", stages: {} } });
    await runSummonStage(token, "finalization", "boundTrait", () => ensureTrait(token.actor, "bound", origin.uuid));
    await runSummonStage(token, "finalization", "link", async () => {
      if (!await registerLinkedEntity(origin, { type: "summon", uuid: token.uuid, label: token.name }, { strict: true })) {
        throw new Error("The bound summon could not be linked to its spell.");
      }
    });
    const strength = Math.max(0, Number(origin.flags?.[FLAG_SCOPE]?.castContext?.spellStrengthValue ?? 0) || 0);
    if (!strength) throw new Error("The spell's resolved Strength is unavailable for Mindlock.");
    await runSummonStage(token, "finalization", "mindlock", async () => {
      const mindlock = await applyMindlockEffects({ caster, spell, originAE: origin,
        context: { forSummon: true, mindlockOverride: strength }, strict: true });
      if (!mindlock) throw new Error("Mindlock was not confirmed.");
      if (!await registerLinkedEntity(origin, { type: "casterBuff", uuid: mindlock.uuid, actorUuid: caster.uuid, label: mindlock.name }, { strict: true })) {
        throw new Error("Mindlock could not be linked to its origin.");
      }
    });
    await runSummonStage(token, "finalization", "restraint", () => applyRestrainedPenalty(token, origin, spell, caster));
    await runSummonStage(token, "finalization", "ownership", async () => {
      const { applySummonerOwnership } = await import("./conjuration-runtime.js");
      await applySummonerOwnership(token, caster, { strict: true });
    });
    const finalization = token.flags?.[FLAG_SCOPE]?.binding?.finalization;
    await saveBinding(token, { status: "bound", resolvedBy: game.user.id, finalization: { ...finalization, status: "complete" } });
    return "bound";
  } catch (error) {
    if (isActiveGMUser(game.user)) {
      try { await saveBinding(token, { status: "needsReview", error: String(error.message ?? error) }); } catch (_e) { /* retain the original failure */ }
      try { await postBindingReview(caster, token, error.message); } catch (_e) { /* The token retains the partial binding state. */ }
    }
    error.committed = true;
    error.uncertain = true;
    throw error;
  }
}

async function postPendingPrompt(caster, token, origin, result) {
  const cast = origin.flags?.[FLAG_SCOPE]?.castContext?.castingResult;
  const hasCast = hasCastingResult(origin);
  const details = cast && hasCast
    ? `Caster: ${Number(cast.degree) || 0} DoS. Creature: ${result ? `${Number(result.degree) || 0} ${result.isSuccess ? "DoS" : "DoF"}` : "not rolled"}.`
    : "A casting-test roll is unavailable; resolve the binding according to the source of the summon.";
  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    whisper: game.users.filter(user => user.isGM).map(user => user.id),
    content: `<div class="uesrpg"><h3>Binding requires GM resolution</h3><p>${escapeHtml(token.name)}: ${escapeHtml(details)}</p><p>Resolve the opposed test and any tie, then record whether the creature is bound. No Mindlock or restraint penalty has been applied yet.</p><button type="button" data-ues-summon-binding-action="resolve">Record binding outcome</button></div>`,
    flags: { [FLAG_SCOPE]: { summonBinding: { tokenUuid: token.uuid } } }
  });
  if (!message) throw new Error("The binding review card was not created.");
}

async function postBindingReview(caster, token, reason) {
  if (!isActiveGMUser(game.user)) return;
  const binding = token.flags?.[FLAG_SCOPE]?.binding;
  const existing = binding?.reviewMessageId ? game.messages?.get?.(binding.reviewMessageId) : null;
  const resumable = binding?.finalization?.winner === "bound";
  const stages = Object.entries(binding?.finalization?.stages ?? {}).map(([name, stage]) => `<li>${escapeHtml(name)}: ${escapeHtml(stage?.status ?? "unknown")}</li>`).join("");
  const content = `<div class="uesrpg"><h3>Summon binding requires review</h3><p>${escapeHtml(token.name)}: ${escapeHtml(reason || "Binding was interrupted.")}</p>${stages ? `<ul>${stages}</ul>` : ""}<p>Inspect the Bound trait, origin link, Mindlock, restraint and ownership. ${resumable ? "Resume only after the previous processor has stopped." : "The recorded outcome is unavailable; resolve this binding manually."}</p>${resumable ? '<button type="button" data-ues-summon-binding-action="resume">Review and resume binding</button>' : ""}</div>`;
  if (existing) {
    if (existing.content !== content && !await requestUpdateChatMessage(existing, { content })) throw new Error("The binding review card could not be updated.");
    return;
  }
  const message = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: caster }),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER, whisper: game.users.filter(user => user.isGM).map(user => user.id),
    content, flags: { [FLAG_SCOPE]: { summonBinding: { tokenUuid: token.uuid } } } });
  if (!message) throw new Error("The binding review card was not created.");
  await saveBinding(token, { reviewMessageId: message.id });
}

async function postReleaseReview(token) {
  if (!isActiveGMUser(game.user)) return;
  const release = token.flags?.[FLAG_SCOPE]?.binding?.release;
  if (!release || release.status === "complete") return;
  const stages = Object.entries(release.stages ?? {}).map(([name, stage]) => `<li>${escapeHtml(name)}: ${escapeHtml(stage?.status ?? "unknown")}</li>`).join("");
  const content = `<div class="uesrpg"><h3>Summon control loss requires review</h3><p>${escapeHtml(token.name)} has an interrupted control-loss operation.${release.error ? ` ${escapeHtml(release.error)}` : ""}</p>${stages ? `<ul>${stages}</ul>` : ""}<p>Inspect the saved stages and confirm the previous processor has stopped before retrying.</p><button type="button" data-ues-summon-binding-action="release">Review control loss</button></div>`;
  const existing = release.reviewMessageId ? game.messages?.get?.(release.reviewMessageId) : null;
  if (existing) {
    if (existing.content !== content && !await requestUpdateChatMessage(existing, { content })) throw new Error("The control-loss review card could not be updated.");
    return;
  }
  const message = await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: token.actor, token }),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER, whisper: game.users.filter(user => user.isGM).map(user => user.id),
    content,
    flags: { [FLAG_SCOPE]: { summonBinding: { tokenUuid: token.uuid } } } });
  if (!message) throw new Error("The control-loss review card was not created.");
  await saveBinding(token, { release: { ...release, reviewMessageId: message.id } });
}

export async function resumeSummonBindingFromChat(message) {
  if (!isActiveGMUser(game.user)) throw new Error("Only the active GM can resume summon binding.");
  const uuid = message?.flags?.[FLAG_SCOPE]?.summonBinding?.tokenUuid;
  const token = uuid ? await fromUuid(uuid) : null;
  const flags = token?.flags?.[FLAG_SCOPE];
  if (!token?.actor || !["resolving", "needsReview"].includes(flags?.binding?.status)
    || flags.binding.finalization?.winner !== "bound") throw new Error("This binding is no longer awaiting review.");
  const confirmed = await customDialog({ title: "Resume Summon Binding", layout: "choices",
    content: `<p>Confirm that you inspected ${escapeHtml(token.name)}'s saved binding stages and that the previous processor has stopped. Completed stages will not be repeated.</p>`,
    buttons: { resume: { label: "Resume binding", callback: () => true }, cancel: { label: "Cancel", callback: () => false } },
    defaultButton: "cancel" });
  if (!confirmed) return;
  const key = `summon-binding:${uuid}`;
  if (!await acquireLock(key, { wait: false })) throw new Error("This summon is already being resolved.");
  try {
    const fresh = await fromUuid(uuid);
    const current = fresh?.flags?.[FLAG_SCOPE];
    const caster = current?.summonerActorUuid ? await fromUuid(current.summonerActorUuid) : null;
    const origin = current?.originAEUuid ? await fromUuid(current.originAEUuid) : null;
    const spell = current?.spellUuid ? await fromUuid(current.spellUuid) : null;
    if (!fresh?.actor || !caster || !origin || origin.parent?.uuid !== caster.uuid || !spell) throw new Error("The summon, caster, spell, or origin is unavailable.");
    await finalizeBinding({ caster, token: fresh, origin, spell, winner: "bound", resume: true });
    if (!await requestUpdateChatMessage(message, { content: `<div class="uesrpg"><h3>Binding resolved</h3><p>${escapeHtml(fresh.name)}: bound.</p><button type="button" data-ues-summon-binding-action="release">Record hostile action</button></div>` })) {
      ui.notifications?.warn?.("Binding completed, but its review card could not be updated.");
    }
  } finally { releaseLock(key); }
}

/** Called once after a summon token is created. */
export async function applySummonBinding({ casterActor, originAE, tokenDoc } = {}, { strict = false } = {}) {
  if (!casterActor || !originAE || !tokenDoc?.actor || !isActiveGMUser(game.user)) {
    if (strict) throw new Error("The summoned Actor, caster, origin, and GM authority are required.");
    return "pending";
  }
  const key = `summon-binding:${tokenDoc.uuid}`;
  if (!await acquireLock(key, { wait: false })) throw new Error("The summon binding is already being resolved.");
  try {
    const status = tokenDoc.flags?.[FLAG_SCOPE]?.binding?.status ?? "pending";
    if (["resolving", "needsReview"].includes(status)) {
      throw Object.assign(new Error("The previous binding was interrupted and requires GM review."), { committed: true, uncertain: true });
    }
    if (status !== "pending") return status;
    const spellUuid = originAE.flags?.[FLAG_SCOPE]?.spellUuid;
    const spell = spellUuid ? await fromUuid(spellUuid) : null;
    if (!spell) throw new Error("The summon spell is unavailable for binding.");
    const kind = String(tokenDoc.flags?.[FLAG_SCOPE]?.summonKind ?? "").toLowerCase();
    if (!["daedra", "construct"].includes(kind)) {
      // Necromancy's Ghost and Wraith use a separate opposed Willpower test
      // and fixed Mindlock values, so the Conjuration procedure cannot be reused.
      await saveBinding(tokenDoc, { status: "manual" });
      const message = await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: casterActor }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        whisper: game.users.filter(user => user.isGM).map(user => user.id),
        content: `<div class="uesrpg"><h3>Summon requires manual resolution</h3><p>Resolve the binding test, the spell's listed Mindlock, upkeep, and departure for ${escapeHtml(tokenDoc.name)} using the spell description. No binding or Mindlock has been applied.</p></div>`
      });
      if (!message) throw new Error("The manual summon instructions were not created.");
      return "manual";
    }
    await ensureTrait(tokenDoc.actor, "summoned", originAE.uuid);
    const cast = originAE.flags?.[FLAG_SCOPE]?.castContext?.castingResult;
    const hasCast = hasCastingResult(originAE);
    let creature = tokenDoc.flags?.[FLAG_SCOPE]?.binding?.creatureResult ?? null;
    if (hasCast && !creature) {
      const tn = computeCharacteristicTN(tokenDoc.actor, "wp").finalTN;
      const rolled = await doTestRoll(tokenDoc.actor, { target: tn, allowLucky: true, allowUnlucky: true });
      if (!isActiveGMUser(game.user)) throw new Error("The active GM changed before the binding roll was recorded.");
      creature = { isSuccess: rolled.isSuccess, degree: rolled.degree, target: rolled.target, rollTotal: rolled.rollTotal,
        isCriticalSuccess: rolled.isCriticalSuccess, isCriticalFailure: rolled.isCriticalFailure };
      await saveBinding(tokenDoc, { creatureResult: creature });
      await rolled.roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: tokenDoc.actor, token: tokenDoc }),
        flavor: `<b>${escapeHtml(tokenDoc.name)}</b> — summon binding Willpower test`,
        whisper: game.users.filter(user => user.isGM).map(user => user.id) });
    }
    if (!hasCast || !creature) {
      await postPendingPrompt(casterActor, tokenDoc, originAE, creature);
      return "pending";
    }
    const outcome = resolveOpposed(cast, creature);
    if (outcome.winner === "tie") {
      await postPendingPrompt(casterActor, tokenDoc, originAE, creature);
      return "pending";
    }
    return await finalizeBinding({ caster: casterActor, token: tokenDoc, origin: originAE, spell,
      winner: outcome.winner === "attacker" ? "bound" : "unbound" });
  } finally { releaseLock(key); }
}

/** Resolve only a previously pending binding from its GM-only chat card. */
export async function resolveSummonBindingFromChat(message) {
  if (!isActiveGMUser(game.user)) {
    ui.notifications?.warn?.("The active GM must resolve summon binding.");
    return;
  }
  const uuid = message?.flags?.[FLAG_SCOPE]?.summonBinding?.tokenUuid;
  const token = uuid ? await fromUuid(uuid) : null;
  const flags = token?.flags?.[FLAG_SCOPE];
  if (!token?.actor || flags?.binding?.status !== "pending") {
    ui.notifications?.warn?.("This summon is unavailable or its binding is no longer pending.");
    return;
  }
  const choice = await customDialog({
    title: "Record Binding Outcome",
    content: `<p>After resolving the opposed test and any tie for <strong>${escapeHtml(token.name)}</strong>, select its outcome.</p>`,
    layout: "choices",
    buttons: {
      bound: { label: "Conjurer wins: Bound", callback: () => "bound" },
      unbound: { label: "Creature wins: Unbound", callback: () => "unbound" },
      later: { label: "Leave pending", callback: () => null }
    },
    defaultButton: "later"
  });
  if (!choice) return;
  const key = `summon-binding:${token.uuid}`;
  if (!await acquireLock(key, { wait: false })) {
    ui.notifications?.warn?.("This binding is already being resolved.");
    return;
  }
  try {
    const caster = await fromUuid(flags.summonerActorUuid);
    const origin = await fromUuid(flags.originAEUuid);
    const spell = await fromUuid(flags.spellUuid);
    if (!caster || !origin || origin.parent?.uuid !== caster.uuid || !spell) throw new Error("The caster, spell or origin is no longer available.");
    const status = await finalizeBinding({ caster, token, origin, spell, winner: choice });
    await requestUpdateChatMessage(message, { content: `<div class="uesrpg"><h3>Binding resolved</h3><p>${escapeHtml(token.name)}: ${escapeHtml(status)}.</p>${status === "unbound" ? "<p>Resolve the unbound creature's end-of-round Willpower tests manually.</p>" : '<button type="button" data-ues-summon-binding-action="release">Record hostile action</button>'}</div>` });
  } finally { releaseLock(key); }
}

/** GM confirmation supplies the intent and allegiance that the system cannot infer. */
export async function releaseSummonBindingFromChat(message) {
  if (!isActiveGMUser(game.user)) throw new Error("Only the active GM can record a hostile action against a summon.");
  const uuid = message?.flags?.[FLAG_SCOPE]?.summonBinding?.tokenUuid;
  let token = uuid ? await fromUuid(uuid) : null;
  const binding = token?.flags?.[FLAG_SCOPE]?.binding;
  if (!token?.actor || !(binding?.status === "bound" || binding?.status === "unbound" && binding.release?.status !== "complete" && binding.release)) {
    ui.notifications?.warn?.("This summon is unavailable or its control loss has already been resolved.");
    return;
  }
  const confirmed = await customDialog({ title: "Record Hostile Action", layout: "choices",
    content: `<p>Confirm that ${escapeHtml(token.name)}'s master or an ally intentionally took a hostile or harmful action against it. If this is a retry, first confirm that the previous processor has stopped and inspect the saved state.</p>`,
    buttons: { release: { label: "Confirm control loss", callback: () => true }, cancel: { label: "Cancel", callback: () => false } },
    defaultButton: "cancel" });
  if (!confirmed) return;
  const key = `summon-binding:${uuid}`;
  if (!await acquireLock(key, { wait: false })) throw new Error("This summon is already being resolved.");
  try {
    token = await fromUuid(uuid);
    const flags = token?.flags?.[FLAG_SCOPE];
    const caster = flags?.summonerActorUuid ? await fromUuid(flags.summonerActorUuid) : null;
    const origin = flags?.originAEUuid ? await fromUuid(flags.originAEUuid) : null;
    if (!token?.actor || !caster || !origin || origin.parent?.uuid !== caster.uuid) throw new Error("The summon, caster, or origin is unavailable; review control loss manually.");
    const current = flags.binding;
    if (!(current?.status === "bound" || current?.status === "unbound" && current.release?.status !== "complete" && current.release)) {
      throw new Error("The summon binding changed while the confirmation was open.");
    }
    const release = current.release ?? { status: "processing", initiatedBy: game.user.id, stages: {} };
    await saveBinding(token, { status: "unbound", release });
    await runSummonStage(token, "release", "disposition", async () => {
      if (token.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE) return;
      if (!await requestUpdateDocument(token, { disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE })) throw new Error("The hostile disposition was not confirmed.");
    });
    await runSummonStage(token, "release", "boundTrait", async () => {
      const owned = Array.from(token.actor.items ?? []).filter(item => item.flags?.[FLAG_SCOPE]?.summonOriginUuid === origin.uuid
        && item.type === "trait" && item.system?.traitKey === "bound");
      if (owned.length && !await requestDeleteEmbeddedDocuments(token.actor, "Item", owned.map(item => item.id))) throw new Error("The Bound trait removal was not confirmed.");
      if (hasActorTrait(token.actor, "bound")) throw new Error("Another Bound trait has no matching summon provenance; review it manually.");
    });
    await runSummonStage(token, "release", "restraint", async () => {
      const ids = Array.from(token.actor.effects ?? []).filter(effect => effect.flags?.[FLAG_SCOPE]?.restrainedSummonOrigin === origin.uuid).map(effect => effect.id);
      if (ids.length && !await requestDeleteEmbeddedDocuments(token.actor, "ActiveEffect", ids)) throw new Error("The restraint removal was not confirmed.");
    });
    await runSummonStage(token, "release", "ownership", async () => {
      const { restoreSummonerOwnership } = await import("./conjuration-runtime.js");
      await restoreSummonerOwnership(token);
    });
    await runSummonStage(token, "release", "link", () => unregisterLinkedEntity(origin, token.uuid));
    await runSummonStage(token, "release", "mindlock", async () => {
      const others = getSummonedTokens(caster, { allScenes: true }).filter(other => other.uuid !== token.uuid
        && other.flags?.[FLAG_SCOPE]?.originAEUuid === origin.uuid);
      if (others.some(other => other.flags?.[FLAG_SCOPE]?.binding?.status === "bound")) return;
      if (others.some(other => !["unbound"].includes(other.flags?.[FLAG_SCOPE]?.binding?.status))) throw new Error("Another summon's binding is unresolved; review Mindlock manually.");
      const effects = Array.from(caster.effects ?? []).filter(effect => effect.flags?.[FLAG_SCOPE]?.isMindlock === true
        && effect.flags?.[FLAG_SCOPE]?.originAEId === origin.id);
      for (const effect of effects) {
        if (!await requestDeleteEmbeddedDocuments(caster, "ActiveEffect", [effect.id])) throw new Error("The Mindlock removal was not confirmed.");
        await unregisterLinkedEntity(origin, effect.uuid);
      }
    });
    const settled = token.flags?.[FLAG_SCOPE]?.binding?.release ?? release;
    await saveBinding(token, { release: { ...settled, status: "complete" } });
    const content = `<div class="uesrpg"><h3>Summon unbound</h3><p>${escapeHtml(token.name)} is hostile and no longer Bound. Resolve its end-of-round Willpower tests manually.</p></div>`;
    const cards = new Map([[message.id, message]]);
    const reviewCard = settled.reviewMessageId ? game.messages?.get?.(settled.reviewMessageId) : null;
    if (reviewCard) cards.set(reviewCard.id, reviewCard);
    let synchronized = true;
    for (const card of cards.values()) {
      try { if (card.content !== content && !await requestUpdateChatMessage(card, { content })) synchronized = false; }
      catch (_error) { synchronized = false; }
    }
    if (!synchronized) {
      ui.notifications?.warn?.("Control loss was recorded, but the chat card could not be updated.");
    }
  } catch (error) {
    const release = token?.flags?.[FLAG_SCOPE]?.binding?.release;
    if (release && isActiveGMUser(game.user)) {
      try { await saveBinding(token, { release: { ...release, status: "partial", error: String(error.message ?? error) } }); }
      catch (_saveError) { /* The started stage remains evidence for review. */ }
      try { await postReleaseReview(token); } catch (_cardError) { /* The saved stages remain available for review. */ }
    }
    throw error;
  } finally { releaseLock(key); }
}

async function promptForPossibleHostileAction(message) {
  if (!isActiveGMUser(game.user)) return;
  const flags = message?.flags?.[FLAG_SCOPE];
  const magic = flags?.magicOpposed?.state ?? flags?.magicOpposed;
  const data = flags?.opposed ?? magic;
  if (!data?.attacker?.result || !data.attacker.actorUuid || (!magic && String(data.mode ?? "attack") !== "attack")) return;
  const defenders = Array.isArray(data.defenders) && data.defenders.length ? data.defenders : [data.defender];
  for (const defender of defenders) {
    let token = defender?.tokenUuid ? await fromUuid(defender.tokenUuid) : null;
    if (!token && defender?.actorUuid) token = (await fromUuid(defender.actorUuid))?.token ?? null;
    if (token?.flags?.[FLAG_SCOPE]?.binding?.status !== "bound") continue;
    const key = `summon-binding:${token.uuid}`;
    if (!await acquireLock(key, { wait: false })) continue;
    try {
      token = await fromUuid(token.uuid);
      const binding = token?.flags?.[FLAG_SCOPE]?.binding;
      if (!isActiveGMUser(game.user) || binding?.status !== "bound") continue;
      const notices = Array.isArray(binding.controlNotices) ? binding.controlNotices : [];
      if (notices.includes(message.id)) continue;
      await saveBinding(token, { controlNotices: [...notices, message.id].slice(-50) });
      const card = await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: token.actor, token }), style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        whisper: game.users.filter(user => user.isGM).map(user => user.id),
        content: `<div class="uesrpg"><h3>Review summon control</h3><p>${escapeHtml(data.attacker.name ?? "An actor")} acted against ${escapeHtml(token.name)}. If its master or an ally intentionally took a hostile or harmful action, confirm control loss; otherwise ignore this card.</p><button type="button" data-ues-summon-binding-action="release">Record hostile action</button></div>`,
        flags: { [FLAG_SCOPE]: { summonBinding: { tokenUuid: token.uuid, sourceMessageId: message.id } } }
      });
      if (!card) throw new Error("The summon control review card was not created.");
    } finally { releaseLock(key); }
  }
}

async function recoverSummonReviews() {
  if (!isActiveGMUser(game.user)) return;
  for (const scene of game.scenes ?? []) for (const token of scene.tokens ?? []) {
    const flags = token.flags?.[FLAG_SCOPE];
    const binding = flags?.binding;
    if (flags?.isSummonedToken !== true || !token.actor) continue;
    if (["resolving", "needsReview"].includes(binding?.status)) {
      const caster = flags.summonerActorUuid ? await fromUuid(flags.summonerActorUuid) : null;
      if (caster) await postBindingReview(caster, token, binding.error);
    }
    if (binding?.status === "unbound" && binding.release?.status !== "complete" && binding.release) await postReleaseReview(token);
  }
}

let initialized = false;
export function initializeSummonBinding() {
  if (initialized) return;
  initialized = true;
  Hooks.on("uesrpg.spell.summonSpawned", payload => {
    if (payload?.handledDomains?.includes("summonBinding")) return;
    void applySummonBinding(payload).catch(error => console.error("UESRPG | Summon binding failed", error));
  });
  const reviewAction = message => { void promptForPossibleHostileAction(message)
    .catch(error => {
      console.warn("UESRPG | Summon control review failed", error);
      ui.notifications?.warn?.("Summon control review could not be created. Use the summon card to record a hostile action.");
    }); };
  Hooks.on("createChatMessage", reviewAction);
  Hooks.on("updateChatMessage", reviewAction);
  const recover = () => { void recoverSummonReviews().catch(error => console.warn("UESRPG | Summon recovery failed", error)); };
  Hooks.on("userConnected", recover);
  recover();
}
