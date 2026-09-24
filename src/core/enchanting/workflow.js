import { SYSTEM_ID } from "../constants.js";
import { t, tf } from "../../utils/i18n.js";
import { promptCraftingSkillRollDeclaration } from "../skills/crafting-roll-dialog.js";
import { getEnchantSkill, getEnchantTN } from "./penalties.js";
import { isSoulGemResourceUsable, resolveSoulGemData, consumeSoulGem } from "./soul-gems.js";
import { buildCast, buildCastFlagsPayload } from "./builders/build-cast.js";
import { buildStrike, buildStrikeFlagsPayload } from "./builders/build-strike.js";
import { buildConstant, buildConstantFlagsPayload } from "./builders/build-constant.js";
import { finalizeEnchantment } from "./builders/finalize.js";
import {
  formatPendingEntries,
  renderEnchantmentPendingCard,
  renderEnchantmentResultCard,
} from "./render.js";

const WORKFLOW_FLAG = "enchantingWorkflow";
const CREATION_MODES = new Set(["cast", "strike", "constant"]);
const resolvingLocally = new Set();

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value, (key, entry) => (
    key === "rollObject" ? entry?.toJSON?.() ?? entry ?? undefined : entry
  )));
}

function hydrateStoredRolls(buildResult, mode) {
  const tests = mode === "cast"
    ? (buildResult?.spellResults ?? []).flatMap((entry) => [entry?.testResult, entry?.salvageResult])
    : [buildResult?.testResult, buildResult?.salvageResult];
  for (const test of tests.filter(Boolean)) {
    const stored = test.rollObject;
    if (!stored || typeof stored?.render === "function") continue;
    try {
      test.rollObject = Roll.fromData(stored);
    } catch (_error) {
      test.rollObject = null;
    }
  }
  return buildResult;
}

function result(ok, phase, reason = "", extra = {}) {
  return { ok, phase, reason, itemUpdated: false, gemConsumed: false, ...extra };
}

function getWorkflow(message) {
  return message?.flags?.[SYSTEM_ID]?.[WORKFLOW_FLAG] ?? null;
}

async function updateWorkflowMessage(message, patch, { content = null } = {}) {
  if (!message) return false;
  const current = getWorkflow(message);
  if (!current) return false;
  const next = { ...foundry.utils.deepClone(current), ...foundry.utils.deepClone(patch) };
  const update = { [`flags.${SYSTEM_ID}.${WORKFLOW_FLAG}`]: next };
  if (typeof content === "string") update.content = content;
  try {
    const updated = await message.update(update);
    return Boolean(updated);
  } catch (error) {
    console.error("UESRPG | Enchanting workflow message update failed", error);
    return false;
  }
}

async function resolveOwnedActorItem(actor, uuid) {
  const ref = String(uuid ?? "").trim();
  if (!actor || !ref) return null;
  let item = null;
  try {
    item = await fromUuid(ref);
  } catch (_error) {
    item = null;
  }
  if (!item && !ref.includes(".")) item = actor.items?.get?.(ref) ?? null;
  if (item?.documentName !== "Item" || item.parent?.uuid !== actor.uuid) return null;
  return actor.items?.get?.(item.id) ?? item;
}

async function resolveLiveResources(actor, request) {
  const targetItem = await resolveOwnedActorItem(actor, request?.targetItemUuid);
  const soulGemItem = await resolveOwnedActorItem(actor, request?.soulGemUuid);
  if (!targetItem) return { error: t("UESRPG.Apps.EnchantingWorkshop.Errors.TargetMissing", "The selected target Item is no longer in this actor's inventory.") };
  const targetAllowed = request?.mode === "strike"
    ? targetItem.type === "weapon"
    : ["weapon", "armor", "item"].includes(targetItem.type);
  if (!targetAllowed || resolveSoulGemData(targetItem)) {
    return { error: t("UESRPG.Apps.EnchantingWorkshop.Dropzones.InvalidTarget", "That Item is not eligible for the selected enchanting mode.") };
  }
  if (!soulGemItem) return { error: t("UESRPG.Apps.EnchantingWorkshop.Errors.GemMissing", "The selected soul gem is no longer in this actor's inventory.") };
  const gemData = resolveSoulGemData(soulGemItem);
  if (!isSoulGemResourceUsable(soulGemItem, gemData)) {
    return { error: t("UESRPG.Apps.EnchantingWorkshop.Errors.GemUnavailable", "The selected soul gem is empty or unavailable.") };
  }
  return { targetItem, soulGemItem, gemData };
}

async function buildForMode(mode, actor, targetItem, soulGemItem, request, options = {}) {
  if (mode === "cast") {
    return buildCast({ actor, targetItem, soulGemItem, spells: request.spells ?? [], ...options });
  }
  if (mode === "strike") {
    return buildStrike({ actor, targetItem, soulGemItem, effects: request.effects ?? [], ...options });
  }
  if (mode === "constant") {
    return buildConstant({ actor, targetItem, soulGemItem, effects: request.effects ?? [], cursed: Boolean(request.cursed), ...options });
  }
  return { valid: false, errors: [t("UESRPG.Apps.EnchantingWorkshop.Errors.UnknownMode", "Unknown enchanting mode.")] };
}

function buildFlagsForMode(mode, buildResult, actor, soulGemItem, targetItem, request) {
  if (mode === "cast") return buildCastFlagsPayload(buildResult, actor, soulGemItem, targetItem, {});
  if (mode === "strike") return buildStrikeFlagsPayload(buildResult, actor, soulGemItem, targetItem, request.effects ?? []);
  return buildConstantFlagsPayload(buildResult, actor, soulGemItem, targetItem, request.effects ?? []);
}

function pendingCardData(actor, request, resources, preview, workflow = {}) {
  return {
    actorImg: actor?.img,
    actorName: actor?.name,
    mode: request.mode,
    targetName: resources.targetItem?.name,
    gemName: resources.soulGemItem?.name,
    gemEnergy: resources.gemData?.soulEnergy,
    gemCapacity: resources.gemData?.maxSoulEnergy,
    enchantTN: getEnchantTN(actor),
    poolMax: preview?.poolMax,
    entries: formatPendingEntries(request.mode, request, preview),
    resolving: workflow.resolving === true,
    resolved: workflow.resolved === true,
    issue: workflow.issue ?? "",
  };
}

/** Validate and create a pending, non-mutating enchantment chat card. */
export async function createPendingEnchantmentMessage(actor, request = {}) {
  const normalized = cloneSerializable({
    ...request,
    mode: String(request.mode ?? ""),
    actorUuid: actor?.uuid ?? null,
  });
  if (!actor || !CREATION_MODES.has(normalized.mode)) return null;
  const resources = await resolveLiveResources(actor, normalized);
  if (resources.error) {
    ui.notifications?.warn?.(resources.error);
    return null;
  }
  const preview = await buildForMode(normalized.mode, actor, resources.targetItem, resources.soulGemItem, normalized, { skipRolls: true });
  if (!preview?.valid) {
    ui.notifications?.warn?.((preview?.errors ?? []).join("\n"));
    return null;
  }

  const workflow = {
    type: "enchantmentPending",
    actorUuid: actor.uuid,
    request: normalized,
    preview: cloneSerializable(preview),
    resolving: false,
    resolved: false,
    phase: "pending",
    issue: "",
    rolledResult: null,
    createdAt: Date.now(),
  };
  const content = renderEnchantmentPendingCard(pendingCardData(actor, normalized, resources, preview, workflow));
  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: { [SYSTEM_ID]: { [WORKFLOW_FLAG]: workflow } },
  });
}

function canResolve(message, actor) {
  if (game.user?.isGM) return true;
  const authorId = String(message?.author?.id ?? message?.user?.id ?? message?.user ?? "");
  return authorId === String(game.user?.id ?? "") && actor?.isOwner === true;
}

function emitRolls(buildResult, mode) {
  const rolls = mode === "cast"
    ? (buildResult?.spellResults ?? []).flatMap((entry) => [entry.testResult?.rollObject, entry.salvageResult?.rollObject])
    : [buildResult?.testResult?.rollObject, buildResult?.salvageResult?.rollObject];
  for (const roll of rolls.filter(Boolean)) {
    if (game.dice3d?.showForRoll) Promise.resolve(game.dice3d.showForRoll(roll)).catch(() => {});
  }
}

async function consumeFailedAttempt(actor, soulGemItem, buildResult) {
  if (buildResult.gemPreserved) {
    return result(true, "complete", "", { gemConsumed: false });
  }
  const consumed = await consumeSoulGem(actor, soulGemItem);
  return consumed
    ? result(true, "complete", "", { gemConsumed: true })
    : result(false, "gem-consume", t("UESRPG.Apps.EnchantingWorkshop.Errors.GemConsumptionRejected", "The soul gem could not be consumed."));
}

async function postResult(actor, targetItem, request, buildResult, operation) {
  const content = await renderEnchantmentResultCard({
    actorImg: actor.img,
    actorName: actor.name,
    targetName: targetItem.name,
    mode: request.mode,
    buildResult,
    operation,
    enchantmentApplied: Boolean(buildResult.anySuccess && operation.itemUpdated),
    gemPreserved: Boolean(buildResult.gemPreserved),
    gemConsumed: Boolean(operation.gemConsumed),
  });
  const rolls = request.mode === "cast"
    ? (buildResult?.spellResults ?? []).flatMap((entry) => [entry.testResult?.rollObject, entry.salvageResult?.rollObject]).filter(Boolean)
    : [buildResult?.testResult?.rollObject, buildResult?.salvageResult?.rollObject].filter(Boolean);
  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    rolls,
  });
}

/** Resolve an existing pending message. Rolled results are reused on retry. */
export async function resolvePendingEnchantment(message, options = {}) {
  const workflow = getWorkflow(message);
  if (!workflow || workflow.type !== "enchantmentPending") return result(false, "validation", "Invalid enchanting workflow.");
  if (workflow.resolved) return result(false, "resolved", t("UESRPG.Apps.EnchantingWorkshop.Errors.AlreadyResolved", "This enchantment has already been resolved."));

  const actor = await fromUuid(workflow.actorUuid).catch(() => null);
  if (!actor || !canResolve(message, actor)) {
    return result(false, "permission", t("UESRPG.Apps.EnchantingWorkshop.Errors.NotAuthorized", "Only the card author who owns the actor, or a GM, may resolve this enchantment."));
  }
  const request = workflow.request ?? {};
  const resources = await resolveLiveResources(actor, request);
  if (resources.error) return result(false, "validation", resources.error);
  const livePreview = await buildForMode(request.mode, actor, resources.targetItem, resources.soulGemItem, request, { skipRolls: true });
  if (!livePreview?.valid) return result(false, "validation", (livePreview?.errors ?? []).join("\n"));

  let buildResult = workflow.rolledResult
    ? hydrateStoredRolls(foundry.utils.deepClone(workflow.rolledResult), request.mode)
    : null;
  if (!buildResult) {
    const skill = getEnchantSkill(actor);
    if (!skill) return result(false, "validation", t("UESRPG.Apps.EnchantingWorkshop.Errors.EnchantSkillMissing", "This actor has no Enchant skill Item."));
    const declaration = options.declaration ?? await promptCraftingSkillRollDeclaration(actor, skill, {
      title: tf("UESRPG.Apps.EnchantingWorkshop.RollDialog.EnchantTitle", { skill: skill.name }, `${skill.name} - Enchant Roll Options`),
    });
    if (!declaration?.tn) return result(false, "cancelled", "");
    buildResult = await buildForMode(request.mode, actor, resources.targetItem, resources.soulGemItem, request, {
      testBaseTN: Number(declaration.tn.finalTN ?? 0),
    });
    if (!buildResult?.valid) return result(false, "validation", (buildResult?.errors ?? []).join("\n"));
    emitRolls(buildResult, request.mode);
    const stored = cloneSerializable(buildResult);
    const storedOk = await updateWorkflowMessage(message, {
      resolving: true,
      phase: "rolled",
      issue: "",
      rolledResult: stored,
      declaration: cloneSerializable(declaration.declaration ?? {}),
    });
    if (!storedOk) return result(false, "message-update", t("UESRPG.Apps.EnchantingWorkshop.Errors.StateSaveFailed", "The rolled result could not be secured on the chat card; no Items were changed."));
  }

  let operation;
  const gemWasReusable = resolveSoulGemData(resources.soulGemItem)?.isReusable === true;
  if (buildResult.anySuccess) {
    const flagsPayload = buildFlagsForMode(request.mode, buildResult, actor, resources.soulGemItem, resources.targetItem, request);
    operation = await finalizeEnchantment({
      actor,
      targetItem: resources.targetItem,
      soulGemItem: resources.soulGemItem,
      flagsPayload,
      buildResult,
      gemPreserved: buildResult.gemPreserved,
      enchantType: request.mode,
      postResult: false,
    });
  } else {
    operation = await consumeFailedAttempt(actor, resources.soulGemItem, buildResult);
  }
  operation.gemReusable = gemWasReusable;

  if (!operation.ok) {
    const failedWorkflow = { ...getWorkflow(message), resolving: false, phase: operation.phase, issue: operation.reason };
    const failedContent = renderEnchantmentPendingCard(pendingCardData(actor, request, resources, livePreview, failedWorkflow));
    await updateWorkflowMessage(message, { resolving: false, phase: operation.phase, issue: operation.reason }, { content: failedContent });
    return operation;
  }

  const completedWorkflow = { ...getWorkflow(message), resolving: false, resolved: true, phase: "complete", issue: "" };
  const completedContent = renderEnchantmentPendingCard(pendingCardData(actor, request, resources, livePreview, completedWorkflow));
  const marked = await updateWorkflowMessage(message, {
    resolving: false,
    resolved: true,
    phase: "complete",
    issue: "",
    completedAt: Date.now(),
    operation: cloneSerializable(operation),
  }, { content: completedContent });
  if (!marked) {
    return result(false, "message-update", t("UESRPG.Apps.EnchantingWorkshop.Errors.CompletionSaveFailed", "The enchantment resolved, but the pending card could not be marked complete."), {
      itemUpdated: operation.itemUpdated,
      gemConsumed: operation.gemConsumed,
    });
  }
  await postResult(actor, operation.targetItem ?? resources.targetItem, request, buildResult, operation);
  return operation;
}

export async function handleEnchantmentChatAction(messageId) {
  const message = game.messages?.get?.(String(messageId ?? ""));
  if (!message || resolvingLocally.has(message.id)) return;
  const workflow = getWorkflow(message);
  if (!workflow || workflow.type !== "enchantmentPending") return;
  if (workflow.resolved || workflow.resolving) {
    ui.notifications?.info?.(t("UESRPG.Apps.EnchantingWorkshop.Errors.AlreadyResolving", "This enchantment is already resolving or resolved."));
    return;
  }

  resolvingLocally.add(message.id);
  try {
    const locked = await updateWorkflowMessage(message, { resolving: true, issue: "" });
    if (!locked) {
      ui.notifications?.error?.(t("UESRPG.Apps.EnchantingWorkshop.Errors.StateSaveFailed", "The pending card could not be locked."));
      return;
    }
    const operation = await resolvePendingEnchantment(message);
    if (operation.phase === "cancelled") {
      await updateWorkflowMessage(message, { resolving: false, phase: "pending", issue: "" });
      return;
    }
    if (!operation.ok) {
      await updateWorkflowMessage(message, { resolving: false, issue: operation.reason, phase: operation.phase });
      if (operation.reason) ui.notifications?.warn?.(operation.reason);
    }
  } finally {
    resolvingLocally.delete(message.id);
  }
}
