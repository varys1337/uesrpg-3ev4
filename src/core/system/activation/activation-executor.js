import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { registerActivationStateHooks } from "../../combat/activation-state-flags.js";
import { validateRacialActivationAvailability } from "../../traits/racial-talents.js";
import { validateInspireHeroismAvailability } from "../../traits/social-talents.js";
import { createSeverityDebugLogger } from "../../../utils/debug.js";
import { createUuidResolver } from "../../../utils/uuid-cache.js";
import { getFeatureConfig } from "../../traits/features/feature-config.js";
import { runFeatureAutomation } from "../../traits/features/feature-dispatcher.js";
import { featureNeedsEffectTransfer, applyFeatureEffectsToTargets } from "./feature-effects.js";
import { confirmDialog } from "../../../utils/dialog-v2-helper.js";
import { SYSTEM_ID } from "../system-id.js";
import {
  buildActivationActorSnapshot,
  getTargetsFromContext,
  isAttackActivation
} from "./helpers.js";
import {
  validateActivationContext,
  applyActivationCosts,
  consumeActivationUsage,
  applyActivationActorFlags
} from "./costs-and-usage.js";
import { renderActivationCard, appendActivationResultToMessage } from "./rendering.js";
import { prepareAttackActivationContext, startAttackWorkflow } from "./attack-workflow.js";
import {
  resolveTalentAutomationKey,
  runTalentActivationAutomation,
  runPowerActivationAutomation
} from "./talent-automation.js";

const FEATURE_TYPES = new Set(["trait", "talent", "power"]);
const activationDebug = createSeverityDebugLogger("activationDebug", "", "debug");

async function showFeatureConfirmDialog(item, featureConfig) {
  const promptMode = featureConfig.promptMode ?? "owner";
  const isGM = game.user.isGM;
  const isOwner = item.isOwner;

  let shouldPrompt = false;
  switch (promptMode) {
    case "gm": shouldPrompt = isGM; break;
    case "owner": shouldPrompt = isOwner; break;
    case "both": shouldPrompt = isGM || isOwner; break;
    case "never": return true;
    default: shouldPrompt = isOwner; break;
  }

  if (!shouldPrompt) return true;

  try {
    const confirmed = await confirmDialog({
      title: `Confirm: ${item.name}`,
      content: `<p>Activate <strong>${item.name}</strong>?</p>`,
      yesLabel: "Activate",
      noLabel: "Cancel",
      yesIcon: "fas fa-bolt",
      noIcon: "fas fa-times",
      rejectClose: false
    });
    return confirmed === true;
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Feature confirm dialog error`, err);
    return false;
  }
}

function resolveTargetActors(actor, context = {}) {
  return getTargetsFromContext(context)
    .map((target) => target?.actor ?? target?.document?.actor ?? null)
    .filter(Boolean)
    .filter((targetActor) => targetActor.id !== actor?.id);
}

async function maybeTransferFeatureEffects({
  actor,
  item,
  context,
  featureConfig,
  activationMessage,
  activation,
  label,
  includeImage,
  usageResult
} = {}) {
  if (!FEATURE_TYPES.has(item?.type)) return;
  if (!featureNeedsEffectTransfer(item)) return;

  const targetActors = resolveTargetActors(actor, context);
  const rawTargets = getTargetsFromContext(context);
  if (targetActors.length) {
    try {
      const result = await applyFeatureEffectsToTargets(actor, item, targetActors, { featureConfig });
      if (!result.targets.length) return;
      const note = `Applied ${result.applied} effect(s) to ${result.targets.join(", ")}.`;
      const updated = activationMessage
        ? await appendActivationResultToMessage(activationMessage, {
            item,
            actor,
            activation,
            label,
            includeImage,
            usageOverride: usageResult,
            note
          })
        : false;
      if (!updated) {
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div class="uesrpg"><b>${item.name}</b>: ${note}</div>`,
          style: CONST.CHAT_MESSAGE_STYLES.OTHER
        });
      }
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Feature effect transfer failed`, { item: item?.name, err });
    }
    return;
  }

  if (rawTargets.length > 0) {
    ui.notifications?.info?.(`${item.name}: Cannot transfer effects to self — select a different target.`);
    activationDebug(`${SYSTEM_ID} | feature-effects: item has AEs but no valid targets (self excluded)`, item.name);
  } else {
    ui.notifications?.info?.(`${item.name} has activation effects — select target token(s) to transfer them.`);
    activationDebug(`${SYSTEM_ID} | feature-effects: item has activation AEs but no targets selected`, item.name);
  }
}

async function runLegacyFeatureAutomation({ item, actor, context, resolver, dispatchedByFeatureAutomation }) {
  if (!FEATURE_TYPES.has(item?.type) || dispatchedByFeatureAutomation) return;
  if (item.type === "talent") {
    await runTalentActivationAutomation({ item, actor, context, resolver });
  } else if (item.type === "power") {
    await runPowerActivationAutomation({ item, actor });
  }
}

export async function executeActivation({
  actor,
  activation,
  label = "Ability",
  includeImage = false,
  renderChat = true,
  context = {},
  textOverride = null
} = {}) {
  if (!activation || activation.enabled === false) return { ok: false };

  const actorSnapshot = buildActivationActorSnapshot(actor);
  const validation = validateActivationContext({ actor, activation, context, actorSnapshot });
  if (!validation.ok) return { ok: false };

  const spendResult = await applyActivationCosts({ actor, activation, label });
  if (!spendResult.ok) return { ok: false };

  if (renderChat) {
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content: renderActivationCard({
        item: null,
        actor,
        activation,
        label,
        includeImage,
        textOverride
      }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  return { ok: true };
}

export async function executeItemActivation({
  item,
  actor,
  includeImage = false,
  event = null,
  renderChat = true,
  context = {}
} = {}) {
  registerActivationStateHooks();
  if (!item) return { ok: false };

  const resolver = createUuidResolver();
  const actorSnapshot = buildActivationActorSnapshot(actor);

  let featureConfig = null;
  let featureAutomationEnabled = true;
  if (FEATURE_TYPES.has(item.type)) {
    featureConfig = getFeatureConfig(item);
    if (featureConfig.enabled === false) {
      featureAutomationEnabled = false;
      activationDebug(`${SYSTEM_ID} | activation: featureConfig.enabled=false, automation disabled but chat+effects will proceed`, item.name);
    }
    if (featureConfig.combatOnly && !game.combat?.started) {
      ui.notifications?.warn?.(`${item.name} can only be used during combat.`);
      return { ok: false };
    }
    if (!featureConfig.outOfCombatAllowed && !game.combat?.started) {
      ui.notifications?.warn?.(`${item.name} cannot be used outside of combat.`);
      return { ok: false };
    }
    if (featureAutomationEnabled && featureConfig.applyMode === "confirm") {
      const confirmed = await showFeatureConfirmDialog(item, featureConfig);
      if (!confirmed) {
        activationDebug(`${SYSTEM_ID} | activation: CANCELLED by user confirmation`, item.name);
        return { ok: false };
      }
    }
  }

  const activation = item?.system?.activation ?? {};
  const isFeatureType = FEATURE_TYPES.has(item.type);
  if (activation.enabled === false && !isFeatureType) return { ok: false };

  const activationEnabled = Boolean(activation.enabled);
  const isAttack = activationEnabled && isAttackActivation(activation);
  const label = item?.name ?? "Ability";

  let attackContext = null;
  let mergedContext = context;
  let usageResult = { ok: true };
  let activationMessage = null;

  if (activationEnabled) {
    if (isAttack) {
      attackContext = await prepareAttackActivationContext({
        actor,
        item,
        activation,
        context,
        featureConfig,
        resolver
      });
      if (!attackContext?.ok) return { ok: false };
      mergedContext = { ...(context ?? {}), ...(attackContext.context ?? {}) };
    }

    const validation = validateActivationContext({
      actor,
      activation,
      context: mergedContext,
      actorSnapshot
    });
    if (!validation.ok) return { ok: false };

    try {
      if (item?.type === "talent" || item?.type === "power") {
        const itemKey = resolveTalentAutomationKey(item);
        const gating = validateRacialActivationAvailability({ actor, item, itemKey });
        if (!gating.ok) {
          ui.notifications?.warn?.(String(gating.reason ?? "Activation blocked."));
          return { ok: false };
        }
        if (itemKey === "inspireheroism") {
          const inspireHeroism = validateInspireHeroismAvailability({ actor });
          if (!inspireHeroism.ok) {
            ui.notifications?.warn?.(String(inspireHeroism.reason ?? "Activation blocked."));
            return { ok: false };
          }
        }
      }
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Racial activation preflight failed`, err);
    }

    usageResult = await consumeActivationUsage({ item, activation });
    if (!usageResult.ok) return { ok: false };

    const spendResult = await applyActivationCosts({ actor, activation, label });
    if (!spendResult.ok) {
      if (usageResult.consumed && usageResult.rollback && Object.keys(usageResult.rollback).length) {
        const rolledBack = await requestUpdateDocument(item, usageResult.rollback);
        if (!rolledBack) ui.notifications?.warn?.(`Failed to restore uses for ${item.name}.`);
      }
      return { ok: false };
    }

    await applyActivationActorFlags({ item, actor, activation });
  }

  if (renderChat) {
    const whisper = (featureConfig?.visibility === "gmOnly")
      ? (game.users?.filter((user) => user?.isGM).map((user) => user.id) ?? [])
      : [];
    activationMessage = await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content: renderActivationCard({
        item,
        actor,
        activation,
        label,
        includeImage,
        usageOverride: usageResult
      }),
      whisper,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  await maybeTransferFeatureEffects({
    actor,
    item,
    context: mergedContext,
    featureConfig: FEATURE_TYPES.has(item?.type) ? (featureConfig ?? getFeatureConfig(item)) : null,
    activationMessage,
    activation,
    label,
    includeImage,
    usageResult
  });

  let dispatchedByFeatureAutomation = false;
  if (featureAutomationEnabled && FEATURE_TYPES.has(item?.type)) {
    try {
      dispatchedByFeatureAutomation = await runFeatureAutomation({
        actor,
        item,
        context: mergedContext,
        enforceFeatureConfig: false
      });
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Feature automation dispatch failed`, err);
    }
  }

  if (featureAutomationEnabled) {
    await runLegacyFeatureAutomation({
      item,
      actor,
      context: mergedContext,
      resolver,
      dispatchedByFeatureAutomation
    });
  }

  if (item) await executeItemMacroBestEffort(item, { event });
  if (isAttack) {
    const ok = await startAttackWorkflow({
      actor,
      item,
      activation,
      attackContext,
      actorSnapshot
    });
    if (!ok) return { ok: false };
  }
  return { ok: true };
}

export async function executeItemMacroBestEffort(item, { event } = {}) {
  try {
    const itemMacroActive = game.modules.get("itemacro")?.active;
    const canExecute = itemMacroActive && typeof item.executeMacro === "function" && typeof item.hasMacro === "function" && item.hasMacro();
    if (canExecute) await item.executeMacro({ event });
  } catch (err) {
    console.warn(`${SYSTEM_ID} | ItemMacro execution failed`, err);
  }
}

export function buildSpecialActionActivation({ actionType = "action", apCost = 1, requiresTarget = true } = {}) {
  const mappedType = (actionType === "secondary" || actionType === "reaction" || actionType === "free")
    ? actionType
    : "action";

  return {
    enabled: true,
    actionType: mappedType,
    spendCosts: true,
    consumeUse: false,
    costs: {
      action_points: Math.max(0, Number(apCost ?? 0) || 0),
      stamina: 0,
      magicka: 0,
      luck_points: 0,
      health: 0
    },
    requirements: {
      requiresTarget: Boolean(requiresTarget),
      requiresEquippedWeapon: false,
      requiresMelee: false,
      requiresRanged: false,
      requiresHitLocation: false
    }
  };
}
