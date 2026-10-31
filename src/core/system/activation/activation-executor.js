import { requestAtomicUpdateDocument } from "../../../utils/authority-proxy.js";
import { acquireLock, releaseLock } from "../../../utils/authority-proxy/shared.js";
import { escapeHtml } from "../../../utils/html.js";
import { alertDialog, confirmDialog } from "../../../utils/dialog-v2-helper.js";
import { registerActivationStateHooks } from "../../combat/activation-state-flags.js";
import { isHighbornActivationConfigured, validateRacialActivationAvailability } from "../../traits/racial-talents.js";
import { getActorCombatStep, isActorCombatStepCurrent, isActorInStartedCombatEncounter } from "../../combat/combat-scope.js";
import { isSpecialActionUsableNow } from "../../combat/combat-style-utils.js";
import { validateInspireHeroismAvailability } from "../../traits/social-talents.js";
import { createSeverityDebugLogger } from "../../../utils/debug.js";
import { createUuidResolver } from "../../../utils/uuid-cache.js";
import { getFeatureConfig } from "../../traits/features/feature-config.js";
import { runFeatureAutomation, prepareFeatureActivation } from "../../traits/features/feature-dispatcher.js";
import { featureNeedsEffectTransfer, validateFeatureEffectConfiguration } from "./feature-effects.js";
import { createChatOutcome } from "../../config/outcome-application-policy.js";
import { persistChatOutcomes, getChatOutcomes, describeChatOutcome } from "../../../application/combat/chat-outcome-application-service.js";
import { withActionResult, actionResultFromEvidence, addActionErrorContext } from "../../../application/action-results.js";
import { captureItemOutcomeContext } from "../../../utils/item-outcome-snapshot.js";
import { getSummonedTokens } from "../../magic/conjuration/conjuration-state.js";
import { SYSTEM_ID } from "../system-id.js";
import {
  buildActivationActorSnapshot,
  getTargetsFromContext,
  isAttackActivation,
  getActivationCostValues,
  normalizeUsage
} from "./helpers.js";
import {
  validateActivationContext,
  getActivationCostPreview,
  applyActivationCosts,
  consumeActivationUsage,
  applyActivationActorFlags
} from "./costs-and-usage.js";
import { renderActivationCard, appendActivationResultToMessage } from "./rendering.js";
import { prepareAttackActivationContext, startAttackWorkflowResult } from "./attack-workflow.js";
import { resolveTalentAutomationKey } from "./talent-automation.js";
import { hasTalent } from "../../traits/talents-api.js";
import { tryBeastFeeding } from "../../traits/beast-feeding.js";
import { getCompendiumItemOriginIds } from "../../compendium/access-service.js";

const FEATURE_TYPES = new Set(["trait", "talent", "power"]);
const activationDebug = createSeverityDebugLogger("activationDebug", "", "debug");
const MANUAL_SHOUT_PROCEDURE = "Declare the Cast Magic action, known words and targets; make the Thu'um test using this shout's difficulty. On success spend 1 SP per word beyond the first, applying any Adept or Master of the Voice exception. On failure lose 1 SP instead. Track this shout's recovery for one round per word. ";
const MANUAL_CORE_FEATURE_RULES = Object.freeze({
  "exsanguinate": {
    id: "9oStHySORcA7g0JV", rule: "Vampirism: The Thirst — Exsanguination",
    instructions: "The GM confirms the target qualifies for a Coup de Grâce. Resolve the 2 AP cost, the target's death, healing equal to its remaining HP, loss of remaining AP and two days of satisfied thirst.",
  },
  "feed": {
    id: "a4X1nyuii5pGvK7T", rule: "Vampirism: The Thirst",
    instructions: "The GM confirms the target is susceptible and qualifies as a black-souled creature for feeding. Resolve the Fangs attack and healing from damage after mitigation. If damage was dealt, reduce Endurance by 10 until after the target's next long rest and record one day's feeding.",
  },
  "consume": {
    id: "N6Faw6oo9svWrutk", rule: "The Beast Form: Feeding",
    instructions: "Resolve the extended 2 AP Secondary Action and, on completion, heal the corpse's Endurance Bonus. The GM determines whether the corpse qualifies toward sufficient feeding.",
  },
  "consume heart": {
    id: "bDgkogJMl8xSavAG", rule: "The Beast Form: Feeding",
    instructions: "Resolve the extended 3 AP Secondary Action and, on completion, heal twice the creature's Endurance Bonus. The GM determines whether the heart qualifies toward sufficient feeding.",
  },
  "disarm (zun)": {
    id: "wJ083gfm612PvOUr", rule: "Disarm: Zun (Weapon)",
    instructions: MANUAL_SHOUT_PROCEDURE + "On success, resolve Agility tests and dropped weapons and shields for characters in the cone.",
  },
  "fleshrend (sosaal)": {
    id: "FtoNRuoovth0FlWp", rule: "Fleshrend",
    instructions: MANUAL_SHOUT_PROCEDURE + "On success, resolve the selected word's damage ignoring armor and Bleeding for the target within 25 meters.",
  },
  "fleshrend (sosaal kopraan)": {
    id: "nWMrySy7pS0sObIj", rule: "Fleshrend",
    instructions: MANUAL_SHOUT_PROCEDURE + "On success, resolve the selected word's damage ignoring armor and Bleeding for the target within 25 meters.",
  },
  "frost breath (fo)": {
    id: "S4fhlnlpp90U3nRS", rule: "Frost Breath",
    instructions: MANUAL_SHOUT_PROCEDURE + "On success, resolve the 10-meter cone, area-attack evasion and the selected word's Frost damage.",
  },
  "frost breath (fo krah)": {
    id: "wuHenWevXVt7DfAl", rule: "Frost Breath",
    instructions: MANUAL_SHOUT_PROCEDURE + "On success, resolve the 10-meter cone, area-attack evasion and the selected word's Frost damage.",
  },
  "dismay (faas)": {
    id: "j6aqC3etyZq6AU1l", rule: "Dismay",
    instructions: MANUAL_SHOUT_PROCEDURE + "On success, resolve affected characters' Panic tests; apply the second-word range or difficulty choice when used.",
  },
  "dismay (faas ru)": {
    id: "eLDMNGRZTlFMZAOW", rule: "Dismay",
    instructions: MANUAL_SHOUT_PROCEDURE + "On success, resolve affected characters' Panic tests; apply the second-word range or difficulty choice when used.",
  },
  "slow time (tiid)": {
    id: "Ce6fBdD3V3uPSBqC", rule: "Slow Time",
    instructions: MANUAL_SHOUT_PROCEDURE + "On success, track the increased maximum AP and attack limit and the selected word's expiry manually.",
  },
  "slow time (tiid klo)": {
    id: "lRdsSFgq4HDJowBr", rule: "Slow Time",
    instructions: MANUAL_SHOUT_PROCEDURE + "On success, track the increased maximum AP and attack limit and the selected word's expiry manually.",
  },
  "unrelenting force (fus)": {
    id: "JIOBzG9Arxh0yXLJ", rule: "Unrelenting Force",
    instructions: MANUAL_SHOUT_PROCEDURE + "On success, resolve the beam, area-attack evasion, Dazed duration and, for two words, Prone.",
  },
  "unrelenting force (fus ro)": {
    id: "VWVhgolcyp47oC0x", rule: "Unrelenting Force",
    instructions: MANUAL_SHOUT_PROCEDURE + "On success, resolve the beam, area-attack evasion, Dazed duration and, for two words, Prone.",
  },
  "vampiric drain": {
    id: "3prYyvIuK9MtNmWO", rule: "Vampiric Drain",
    instructions: "Resolve the Primary Attack action and 11 Magicka cost. For a target within 4 meters, resolve 2d6 Magic damage and heal the vampire by the damage after reduction. If the target dies, track thirst as sated for the day. A reflected spell has no net effect; review the complete outcome before applying either side.",
  },
  "bat form": {
    id: "X8hD6hE67XwpWlr3", rule: "Bat Form",
    instructions: "Resolve the Secondary Action and 1 SP cost. Track the swarm's Flyer (10), Tiny size, maximum HP of 5 and three-round duration. Spending 1 SP refreshes the duration for another three rounds; if HP reaches zero the vampire immediately reverts. Restore the applicable form and values when it ends.",
  },
  "call of the wolf": {
    id: "vaWWvyhufBM7m2GK", rule: "Call of the Wolf",
    instructions: "Confirm the character is a werewolf in beast form and has not used this ability today. Resolve the 1 AP howl and Panic (+10) tests for everyone who hears it within 20 meters. Track the use and the additional Bestial Instinct skill rank manually.",
  },
  "thrill of the chase": {
    id: "66VWc5atib2gUXqK", rule: "Thrill of the Chase",
    instructions: "Once per round, resolve a Dash toward an enemy without its AP cost. Track the use and verify the movement and any other applicable Dash restrictions manually.",
  },
  "the calling": {
    id: "b2EpOzHDAfANKfUn", rule: "The Calling",
    instructions: "Confirm the Dwemer has met the recipient. Resolve the Willpower test and a Fatigue level on failure, then repeat the test for each minute beyond the first. For the alternative group connection, the recipient limit is the Willpower Bonus and the normal tests automatically fail. Track the connection and Fatigue manually.",
  },
  "ancestor guardian": {
    id: "kYCPm7mKwbW1ui93", rule: "Ancestor Guardian",
    instructions: "Track the once-per-Long-Rest use and resolve the Cast Magic action. The GM supplies the ancestor ghost; the caster and allies do not suffer its fear effects. Dismiss the spirit if killed, after 30 minutes, or at the end of a combat it joins, whichever occurs first.",
  },
  "berserker": {
    id: "xCNyVSkSBWFHUIIi", type: "talent", rule: "Berserker",
    instructions: "Resolve the Primary Action to enter Frenzied voluntarily. Track the enemy-only restriction with the GM. The Frenzied condition may already adjust bonuses, temporary Stamina and end loss; inspect those values and any earlier action before applying them again.",
  },
  "controlled anger": {
    id: "rYvFH2FV4UUPshZD", type: "talent", rule: "Controlled Anger",
    instructions: "Track the once-per-Short-Rest Free Action to remove Frenzied and resolve the Willpower (+0) test to control an involuntary Frenzy manually. The condition may already adjust the penalty and end loss; inspect its effect and Stamina before changing anything. Ask the GM to reconcile any temporary Stamina over the maximum.",
  },
  "defender": {
    id: "tAX3zBoCnkFXYtmw", type: "talent", rule: "Defender",
    instructions: "When an ally within 2 meters is attacked, resolve the 1 AP reaction, switch the two positions, and make the character the attack's target. Resolve a block, parry or counter attack for 0 AP; neither character spends movement or provokes attacks of opportunity. Before making changes, inspect the attack card, both token positions, AP and any existing free-defense marker for an earlier or partial activation.",
  },
  "thunder charge": {
    id: "NmmbZBZLRNUFyKjT", type: "talent", rule: "Thunder Charge",
    instructions: "Confirm a Dash during the character's turn, that the target began outside melee range, and movement of at least half base Speed toward the target. Resolve the All Out Attack for 1 AP, inspecting previous costs and rolls before making changes.",
  },
  "latch on": {
    id: "wsvRIb5sXGBJFc3X", rule: "The Beast Form: Werewolf — Latch On",
    instructions: "The GM confirms a successful bite caused this grapple and identifies the hit location. Spend 1 SP and treat that location as Crippled until that grapple ends.",
  },
  "ancestor's wrath": {
    id: "4BavHaWi0LX93Tgh", type: "talent", rule: "Ancestor’ s Wrath",
    instructions: "Track the Sanctuary benefit at level 3. Once per Long Rest, resolve the Secondary Cast Magic action to cast Fire Cloak at level 2 for three rounds, without a Magicka cost or casting test. Track the use manually.",
  },
  "ancestor's protection": {
    id: "mxoaAwBJcysTRfAE", type: "talent", rule: "Ancestor’ s Protection",
    instructions: "Increase the character's Fire Resistance trait by 1 after checking existing adjustments. Once per Long Rest, cast Sanctuary at level 2 as a Free Action for three rounds, without Magicka or a casting test. Inspect existing Sanctuary benefits and prior uses; Ancestor's Wrath changes this Sanctuary to level 3.",
  },
  "highborn": {
    id: "xrpzc0xhIVs8ohVJ", type: "talent", rule: "Highborn",
    instructions: "Once per day, resolve the Cast Magic action and restore 20 Magicka. Inspect the actor's Magicka, Item use and earlier outcomes before paying or restoring anything.",
  },
  "dragonskin": {
    id: "6fMqxbAYgrajQFCL", type: "talent", rule: "Dragonskin",
    instructions: "Spend 1 Stamina as a Free Action and apply Spell Absorption (5) for one round. Review the incoming magic, existing effects, prior Stamina and any queued outcome before resolving absorption or expiry manually.",
  },
  "histskin": {
    id: "sbcOPLJMM61v3a0E", type: "talent", rule: "Histskin",
    instructions: "Once per Short Rest, heal Endurance Bonus Health as a Free Action. The existing passive paths may already double swimming speed and add underwater test modifiers; inspect those values, prior use and healing before making manual changes.",
  },
  "malacath's fury": {
    id: "FrMBvu2WVLEvHhF0", type: "talent", rule: "Malacath's Fury",
    instructions: "Confirm the passive Resilient HP increase and inspect existing adjustments. Once per Long Rest, as a Free Action, heal Endurance Bonus HP, then increase Strength Bonus and Magic Resistance by half Endurance Bonus, rounded down, for one minute. Inspect old effects, use records and pending outcomes before making changes.",
  },
  "adrenaline rush": {
    id: "PTwUSRlDHivRN7nL", rule: "Adrenaline Rush", requiresTalent: "adrenalineburst",
    instructions: "With Adrenaline Burst, track the once-per-Long-Rest Adrenaline Rush, its 2 Stamina, 5 Health and suppression of wound Shock penalties until it expires. Ask the GM to resolve how the Fatigue alternative applies; inspect prior use, Stamina, effects, healing and pending outcomes before changing anything.",
  },
  "lord of the hunt": {
    id: "0l1XTvjCr7m1rQ8a", type: "talent", rule: "Lord of the Hunt",
    instructions: "Once per Short Rest, confirm natural foliage or terrain and make a Stealth test at +20. On success, apply Invisible until an action would normally break Hidden. Track the use and condition manually.",
  },
});

function getManualCoreFeatureRule(item, actor) {
  if (!["power", "talent"].includes(item?.type)) return null;
  const source = item.flags?.[SYSTEM_ID]?.coreSource;
  const name = String(item.name ?? "").trim().toLowerCase();
  const namedRule = MANUAL_CORE_FEATURE_RULES[name];
  const applies = rule => !rule?.requiresTalent || hasTalent(actor, rule.requiresTalent);
  if (source?.book === "UESRPG 3e v4 - Rules Compendium" && namedRule?.rule === source.rule
    && (namedRule.type ?? "power") === item.type && applies(namedRule)) return namedRule;

  // Older imports may lack our source tag; match their exact Core Item origin.
  const sourceIds = getCompendiumItemOriginIds(item, "uesrpg-3ev4.powers-talents-traits");
  return Object.values(MANUAL_CORE_FEATURE_RULES).find(rule => (rule.type ?? "power") === item.type && sourceIds.includes(rule.id) && applies(rule)) ?? null;
}

function resolveTargetActors(actor, context = {}, featureConfig = null) {
  if (featureConfig?.targetPolicy === "self") return actor ? [actor] : [];
  const targets = getTargetsFromContext(context)
    .map((target) => target?.actor ?? target?.document?.actor ?? null)
    .filter(Boolean)
    .filter((targetActor) => targetActor.uuid !== actor?.uuid);
  const unique = [...new Map(targets.map(target => [target.uuid, target])).values()];
  return featureConfig?.targetPolicy === "single" ? unique.slice(0, 1) : unique;
}

async function maybeTransferFeatureEffects({
  actor,
  item,
  context,
  featureConfig,
  activationMessage,
} = {}) {
  if (!FEATURE_TYPES.has(item?.type)) return;
  if (!featureNeedsEffectTransfer(item)) return;

  const targetActors = resolveTargetActors(actor, context, featureConfig);
  const rawTargets = getTargetsFromContext(context);
  if (targetActors.length) {
    try {
      const entries = targetActors.map(target => createChatOutcome({
        adapter: "ability.effects", kind: "effect", sourceActorUuid: actor.uuid, targetUuid: target.uuid,
        label: item.name, payload: { itemSnapshot: item.toObject(), itemSnapshotContext: captureItemOutcomeContext(item), featureConfig },
      }));
      const message = await persistChatOutcomes({ message: activationMessage, actor, entries,
        content: `<div class="uesrpg"><b>${escapeHtml(item.name)}</b></div>`,
        whisper: featureConfig?.visibility === "gmOnly" ? game.users.filter(user => user.isGM).map(user => user.id) : [],
      });
      if (!message) throw new Error("The activation outcomes were not confirmed.");
      return { applied: 0, targets: targetActors.map(target => target.name), failed: [], pending: true, message };
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Feature effect transfer failed`, { item: item?.name, err });
      return { failed: targetActors.map((target) => target.name), uncertain: true };
    }
  }

  if (rawTargets.length > 0) {
    ui.notifications?.info?.(`${item.name}: Cannot transfer effects to self — select a different target.`);
    activationDebug(`${SYSTEM_ID} | feature-effects: item has AEs but no valid targets (self excluded)`, item.name);
  } else {
    ui.notifications?.info?.(`${item.name} has activation effects — select target token(s) to transfer them.`);
    activationDebug(`${SYSTEM_ID} | feature-effects: item has activation AEs but no targets selected`, item.name);
  }
  return { failed: ["no eligible target"] };
}

export async function executeActivation(options = {}) {
  const evidence = { owner: "activation", scope: "costs and activation report", confirmed: false, uncertain: false,
    references: { actorUuid: options.actor?.uuid } };
  try {
    const value = await runActivation(options, evidence);
    return withActionResult(value, actionResultFromEvidence({ ...evidence, blocked: !value.ok || value.skipped === true, reason: value.reason }));
  } catch (error) { throw addActionErrorContext(error, actionResultFromEvidence({ ...evidence, uncertain: evidence.uncertain || error.uncertain === true,
    rejected: true, reason: String(error.message ?? error) })); }
}

async function runActivation({
  actor,
  activation,
  label = "Ability",
  includeImage = false,
  renderChat = true,
  context = {},
  textOverride = null,
  requireConfirmed = false,
  operationGuard = null
} = {}, evidence) {
  if (!activation || activation.enabled === false) return { ok: false };

  const actorSnapshot = buildActivationActorSnapshot(actor);
  const validation = validateActivationContext({ actor, activation, context, actorSnapshot });
  if (!validation.ok) return requireConfirmed ? { ok: true, skipped: true, success: false } : { ok: false };

  const spendResult = await applyActivationCosts({ actor, activation, label, requireConfirmed, operationGuard });
  evidence.confirmed = spendResult.spent === true;
  evidence.uncertain = spendResult.uncertain === true;
  if (!spendResult.ok) return requireConfirmed ? { ok: true, skipped: true, success: false } : { ok: false };

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

export async function executeItemActivation(options = {}) {
  const evidence = { owner: "itemActivation", scope: "activation and managed consequences", confirmed: false, uncertain: false,
    pending: false, targets: [], references: { actorUuid: options.actor?.uuid, itemUuid: options.item?.uuid },
    warnings: [] };
  const lockKey = `item-activation:${options.item?.uuid ?? "missing"}`;
  if (!await acquireLock(lockKey, { wait: false })) {
    return withActionResult({ ok: false, status: "processing", reason: "This Item activation is already processing." },
      actionResultFromEvidence({ ...evidence, pending: true, reason: "This Item activation is already processing." }));
  }
  try {
    const value = await runItemActivation(options, evidence);
    evidence.confirmed ||= evidence.targets.some(target => target.actionResult.commitment === "confirmed");
    return withActionResult(value, actionResultFromEvidence({ ...evidence, blocked: !value.ok,
      cancelled: value.status === "cancelled", partial: value.failures?.length > 0
        || evidence.targets.some(target => ["rejected", "blocked", "cancelled", "partial"].includes(target.actionResult.status)),
      reason: value.reason ?? value.failures?.join(" ") }));
  } catch (error) { throw addActionErrorContext(error, actionResultFromEvidence({ ...evidence, uncertain: evidence.uncertain || error.uncertain === true,
    rejected: true, reason: String(error.message ?? error) })); }
  finally { releaseLock(lockKey); }
}

async function runItemActivation({
  item,
  actor,
  includeImage = false,
  event = null,
  renderChat = true,
  context = {}
} = {}, evidence) {
  registerActivationStateHooks();
  if (!item) return { ok: false };

  // Keep the selected targets stable through confirmation, costs, and effects.
  context = { ...context, targets: [...getTargetsFromContext(context)] };
  // These fields are established only by this activation's GM confirmation.
  delete context.warCryListeners;
  delete context.warCryStep;
  const resolver = createUuidResolver();
  const actorSnapshot = buildActivationActorSnapshot(actor);

  let featureConfig = null;
  let featureAutomationEnabled = true;
  const manualCoreFeature = getManualCoreFeatureRule(item, actor);
  if (FEATURE_TYPES.has(item.type)) {
    const policy = await prepareFeatureActivation(item, { explicitUse: true, actor,
      confirmationCostText: manualCoreFeature ? "This confirmation does not charge a cost or use. Follow the next instructions or payment confirmation." : null });
    if (!policy.ok) {
      if (policy.reason) ui.notifications?.warn?.(policy.reason);
      return { ok: false, status: policy.status, reason: policy.reason };
    }
    featureConfig = policy.config;
    featureAutomationEnabled = policy.automationEnabled;
  }

  const activation = item?.system?.activation ?? {};
  const isFeatureType = FEATURE_TYPES.has(item.type);
  if (activation.enabled === false && !isFeatureType) return { ok: false };

  const activationEnabled = Boolean(activation.enabled);
  const isAttack = activationEnabled && isAttackActivation(activation);
  const label = item?.name ?? "Ability";
  if (manualCoreFeature) {
    const feeding = item.type === "power"
      ? await tryBeastFeeding({ actor, item, context, sourceId: manualCoreFeature.id, automationEnabled: featureAutomationEnabled }) : null;
    if (feeding) {
      evidence.confirmed = feeding.paid === true;
      evidence.pending = feeding.status === "pending" || feeding.status === "needsReview";
      evidence.processing = feeding.status === "processing";
      evidence.uncertain = feeding.status === "needsReview";
      if (feeding.messageId) evidence.references.messageId = feeding.messageId;
      if (feeding.paid) evidence.warnings.push("The GM must determine whether the feeding qualifies and review the saved action before starting another.");
      return feeding;
    }
    await alertDialog({
      title: `${label}: resolve manually`,
      content: `<p>This feature's full procedure is not automated. No cost or use has been charged by this activation.</p><p>${escapeHtml(manualCoreFeature.instructions)}</p><p>Check any earlier attempt before paying or applying an effect again.</p>`,
    });
    return { ok: false, status: "blocked", reason: `${label} requires manual resolution; no activation cost or use was charged.` };
  }
  const isVoidChanneler = item.type === "talent" && resolveTalentAutomationKey(item) === "voidchanneler";
  const configuredHighborn = featureAutomationEnabled && isHighbornActivationConfigured(item);
  const configuredWarCry = featureAutomationEnabled && item.type === "power"
    && resolveTalentAutomationKey(item) === "war-cry" && activationEnabled
    && activation.actionType === "action" && activation.spendCosts === true
    && getActivationCostValues(activation.costs ?? {}).ap === 1;
  const requiresPrimaryTiming = configuredHighborn || configuredWarCry;
  const primaryStep = requiresPrimaryTiming ? getActorCombatStep(actor) : null;

  if (configuredHighborn && (actor?.system?.magicka?.value == null || actor?.system?.magicka?.max == null
    || !Number.isFinite(Number(actor.system.magicka.value)) || !Number.isFinite(Number(actor.system.magicka.max)))) {
    const reason = "Highborn requires an actor with a valid Magicka pool.";
    ui.notifications?.warn?.(reason);
    return { ok: false, status: "blocked", reason };
  }
  if (requiresPrimaryTiming && primaryStep && !isSpecialActionUsableNow(actor, "primary")) {
    const reason = `${item.name} uses a Primary Action and can only be used on the actor's turn.`;
    ui.notifications?.warn?.(reason);
    return { ok: false, status: "blocked", reason };
  }

  if (isVoidChanneler && featureAutomationEnabled) {
    if (!activationEnabled || !activation.spendCosts || getActivationCostValues(activation.costs).sp !== 1) {
      const reason = "Void Channeler needs its 1 SP activation configuration. Reimport the corrected talent or configure its cost.";
      ui.notifications?.warn?.(reason);
      return { ok: false, status: "failed", reason };
    }
    const summons = getSummonedTokens(actor, { kind: "daedra", allScenes: true });
    if (!summons.length || summons.some(token => !token.actor)) {
      const reason = "No summoned Daedra with a known source were found for Void Channeler.";
      ui.notifications?.warn?.(reason);
      return { ok: false, status: "failed", reason };
    }
  }

  let attackContext = null;
  let mergedContext = context;
  let usageResult = { ok: true };
  let activationMessage = null;
  const failures = [];
  let hardTargetStep = null;

  const source = item.flags?.[SYSTEM_ID]?.coreSource;
  const warCryUsage = normalizeUsage(activation);
  const coreWarCry = configuredWarCry && activation.consumeUse === true && warCryUsage.max === 1 && warCryUsage.period === "longRest"
    && source?.book === "UESRPG 3e v4 - Rules Compendium" && source.rule === "War Cry";
  if (coreWarCry && game.user?.isGM && primaryStep) {
    const actors = getTargetsFromContext(context)
      .map(target => target?.actor ?? target?.document?.actor ?? null)
      .filter(target => target?.documentName === "Actor" && target.uuid && target.uuid !== actor?.uuid);
    const listeners = [...new Map(actors.map(target => [target.uuid, target])).values()];
    if (listeners.length) {
      const names = listeners.map(target => `<li>${escapeHtml(target.name)}</li>`).join("");
      const confirmed = await confirmDialog({
        title: "War Cry listeners",
        content: `<p>Confirm these selected characters are enemies who can hear the cry:</p><ul>${names}</ul><p>Other eligible listeners must be resolved separately by the GM. If this Combat document is being reused for a new encounter, review any earlier War Cry immunity first.</p>`,
        yesLabel: "Confirm listeners",
      });
      if (!confirmed) return { ok: false, status: "cancelled", reason: "War Cry listeners were not confirmed; no cost was paid." };
      if (!isActorCombatStepCurrent(actor, primaryStep) || !isSpecialActionUsableNow(actor, "primary")) {
        const reason = "The combat step changed while confirming War Cry listeners; no cost was paid.";
        ui.notifications?.warn?.(reason);
        return { ok: false, status: "blocked", reason };
      }
      mergedContext = { ...mergedContext, warCryListeners: listeners, warCryStep: primaryStep };
    }
  }

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
      return { ok: false, status: "failed", reason: "Activation requirements could not be checked." };
    }
  }

  if (featureNeedsEffectTransfer(item)) {
    const effectConfiguration = validateFeatureEffectConfiguration(item, featureConfig);
    if (!effectConfiguration.ok) {
      ui.notifications?.warn?.(effectConfiguration.reason);
      return { ok: false, status: "failed", reason: effectConfiguration.reason };
    }
    if (!resolveTargetActors(actor, mergedContext, featureConfig).length) {
      ui.notifications?.warn?.(`${item.name}: select an eligible target token to receive its activation effects.`);
      return { ok: false, status: "failed", reason: "requiresEffectTarget" };
    }
  }

  if (featureAutomationEnabled && item.type === "talent" && resolveTalentAutomationKey(item) === "hardtarget") {
    hardTargetStep = getActorCombatStep(actor);
    if (!hardTargetStep?.combatantId || !Number.isInteger(hardTargetStep.round) || !Number.isInteger(hardTargetStep.turn)) {
      const reason = "Hard Target requires the actor to be a combatant in an active encounter with a current combat step.";
      ui.notifications?.warn?.(reason);
      return { ok: false, status: "blocked", reason };
    }
    const confirmed = await confirmDialog({
      title: "Hard Target eligibility",
      content: "<p>Confirm with the GM that the character took the Dash action and moved at least half their base Speed.</p><p>The system does not measure the distance moved for this talent.</p>",
      yesLabel: "Eligibility confirmed"
    });
    if (!confirmed) return { ok: false, status: "cancelled", reason: "Hard Target eligibility was not confirmed." };
    if (!isActorCombatStepCurrent(actor, hardTargetStep)) {
      const reason = "The combat step changed while confirming Hard Target; no activation cost was paid.";
      ui.notifications?.warn?.(reason);
      return { ok: false, status: "blocked", reason };
    }
    mergedContext = { ...mergedContext, hardTargetCombatStep: hardTargetStep };
  }

  const activationStepCurrent = () => (!hardTargetStep || isActorCombatStepCurrent(actor, hardTargetStep))
    && (!requiresPrimaryTiming || (isActorCombatStepCurrent(actor, primaryStep)
      && (!primaryStep || isSpecialActionUsableNow(actor, "primary"))));
  const timingGuard = hardTargetStep || requiresPrimaryTiming ? () => {
    if (!activationStepCurrent()) throw new Error(`The combat step changed before ${item.name}'s activation was committed.`);
  } : null;

  if (activationEnabled) {
    const preview = getActivationCostPreview({ actor, activation, label });
    if (!preview.ok) {
      ui.notifications?.warn?.(preview.reason);
      return { ok: false, status: "failed", reason: preview.reason };
    }
    if (!activationStepCurrent()) {
      const reason = `The combat step changed before ${item.name}'s activation; no cost was paid.`;
      ui.notifications?.warn?.(reason);
      return { ok: false, status: "blocked", reason };
    }
    usageResult = await consumeActivationUsage({ item, activation, operationGuard: timingGuard });
    evidence.confirmed ||= usageResult.consumed === true;
    evidence.uncertain ||= usageResult.uncertain === true;
    if (!usageResult.ok) return { ok: false, status: "failed", reason: usageResult.reason };

    const spendResult = await applyActivationCosts({ actor, activation, label, operationGuard: timingGuard });
    evidence.confirmed ||= spendResult.spent === true;
    evidence.uncertain ||= spendResult.uncertain === true;
    if (!spendResult.ok) {
      if (usageResult.consumed && usageResult.rollback && Object.keys(usageResult.rollback).length) {
        const rolledBack = await requestAtomicUpdateDocument(item, fresh => {
          const unchanged = Object.entries(usageResult.appliedPatch ?? {}).every(([path, value]) =>
            Object.is(foundry.utils.getProperty(fresh, path), value));
          return unchanged ? usageResult.rollback : null;
        });
        evidence.uncertain ||= !rolledBack;
        if (!rolledBack) ui.notifications?.warn?.(`Failed to restore uses for ${item.name}.`);
      }
      return { ok: false, status: "failed", reason: spendResult.reason ?? "Activation costs could not be confirmed." };
    }
    mergedContext = { ...mergedContext, activationCostPaid: spendResult.spent === true };

    const flagsResult = await applyActivationActorFlags({ item, actor, activation });
    evidence.confirmed ||= flagsResult.applied === true;
    evidence.uncertain ||= flagsResult.ok === false;
    if (!flagsResult.ok) failures.push('NPC rule flags could not be applied.');
  }

  if (hardTargetStep && !isActorCombatStepCurrent(actor, hardTargetStep)) {
    const reason = "The combat step changed before Hard Target could be queued. Review any activation cost or use already spent.";
    ui.notifications?.warn?.(reason);
    return { ok: false, status: evidence.confirmed ? "partial" : "blocked", reason, failures: [reason] };
  }

  if (renderChat) {
    const whisper = (featureConfig?.visibility === "gmOnly")
      ? (game.users?.filter((user) => user?.isGM).map((user) => user.id) ?? [])
      : [];
    try {
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
      if (!activationMessage) failures.push('The activation report could not be created.');
    } catch (error) {
      failures.push('The activation report could not be created.');
      console.warn(`${SYSTEM_ID} | Activation report failed`, error);
    }
  }

  const transferResult = await maybeTransferFeatureEffects({
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
  evidence.uncertain ||= transferResult?.uncertain === true;
  const observeOutcomes = message => {
    if (!message?.id) throw new Error("The feature outcome submission was not confirmed.");
    const targets = getChatOutcomes(message).map(outcome => ({ targetUuid: outcome.targetUuid, actionResult: describeChatOutcome(message, outcome) }));
    evidence.targets.push(...targets);
    evidence.pending ||= targets.some(target => ["pending", "processing"].includes(target.actionResult.status));
    evidence.uncertain ||= targets.some(target => target.actionResult.commitment === "uncertain");
  };
  if (transferResult?.message) observeOutcomes(transferResult.message);
  if (transferResult?.failed?.length) failures.push(`Effect transfer failed for ${transferResult.failed.join(', ')}.`);
  let featureHandled = false;
  if (featureAutomationEnabled && FEATURE_TYPES.has(item?.type)) {
    try {
      featureHandled = await runFeatureAutomation({ actor, item, context: mergedContext, resolver, enforceFeatureConfig: false, onOutcome: observeOutcomes });
    } catch (err) {
      failures.push('Feature automation failed after activation.');
      evidence.uncertain = true;
      console.warn(`${SYSTEM_ID} | Feature automation dispatch failed`, err);
    }
  }

  if (item && await executeItemMacroBestEffort(item, { event }) === false) failures.push('The ItemMacro failed.');
  evidence.warnings.push("External ItemMacro consequences are outside native confirmation.");
  if (isAttack) {
    try {
    const started = await startAttackWorkflowResult({
      actor,
      item,
      activation,
      attackContext,
      actorSnapshot
    });
    if (!started.value) failures.push('The attack workflow could not start after activation.');
    evidence.uncertain ||= started.actionResult.commitment === "uncertain";
    evidence.pending ||= started.actionResult.accepted;
    if (started.actionResult.references.messageId) evidence.references.messageId = started.actionResult.references.messageId;
    } catch (error) {
      failures.push('The attack workflow failed after activation.');
      evidence.uncertain = true;
      console.warn(`${SYSTEM_ID} | Activation attack failed`, error);
    }
  }
  const manualSpellcasting = item.type === "talent"
    && ["bendreality", "flowofmagicka", "healer"].includes(resolveTalentAutomationKey(item));
  const manualAdrenalineBurst = featureAutomationEnabled && item.type === "power"
    && resolveTalentAutomationKey(item) === "adrenaline-rush" && hasTalent(actor, "adrenalineburst");
  const manualResolution = manualSpellcasting || manualAdrenalineBurst
    || (isFeatureType && !featureHandled && !isAttack && !transferResult?.message);
  const manualHighborn = manualResolution && item.type === "talent"
    && resolveTalentAutomationKey(item) === "highborn" && !configuredHighborn;
  const manualWarCry = manualResolution && item.type === "power" && resolveTalentAutomationKey(item) === "war-cry";
  const manualAdrenalineRush = manualResolution && item.type === "power" && resolveTalentAutomationKey(item) === "adrenaline-rush";
  const manualNote = manualSpellcasting
    ? "Follow the posted manual instructions. Review any queued effects, ItemMacro and configured costs or uses before changing them."
    : manualAdrenalineBurst
      ? "Manually grant 2 SP and track their encounter expiry. Outside the combat tracker, also manage wound-penalty suppression. Review the queued healing and any use already spent before retrying."
    : manualHighborn
      ? "Resolve the Cast Magic action and 20 Magicka recovery manually. Review any use already spent; reimport the corrected talent when available."
    : manualWarCry
      ? `The GM must select enemies who hear the cry, resolve their Panic (+30) tests and track encounter immunity on a success. ${configuredWarCry ? "Review the configured Primary Action cost and any use already spent." : "Resolve the Primary Action cost and review any use already spent; reimport the corrected power when available."}`
    : manualAdrenalineRush
      ? "Manually grant 1 encounter-limited SP when not fatigued, or remove one Fatigue level if fatigued. Review any use already spent before retrying."
    : manualResolution
      ? "No built-in feature outcome was queued. Resolve the described effects manually; review any ItemMacro and configured costs or uses before changing them."
      : "";
  if (manualResolution) {
    evidence.pending = true;
    evidence.warnings.push(manualNote);
  }
  const status = failures.length ? 'partial' : manualResolution ? 'manual' : 'applied';
  // Feature cards report concrete effects and failures; successful activation
  // does not need a generic Result block beneath the feature description.
  if (activationMessage && (failures.length || !isFeatureType || manualResolution)) {
    const reported = await appendActivationResultToMessage(activationMessage, {
      item, actor, activation, label, includeImage, usageOverride: usageResult,
      note: failures.length ? failures.join(' ') + ' Costs already paid are retained; review before retrying.'
        : manualNote || (evidence.pending ? 'Activation submitted; managed consequences are pending.' : 'Activation completed.'),
    });
    if (!reported) failures.push('The final activation report could not be saved.');
  }
  if (failures.length) ui.notifications?.warn?.(failures.join(' ') + ' Review the activation before retrying.');
  else if (manualResolution && !activationMessage) ui.notifications?.info?.(`${item.name}: ${manualNote}`);
  return { ok: !failures.length, status: failures.length ? 'partial' : status, failures };
}

export async function executeItemMacroBestEffortResult(item, options = {}) {
  const value = await executeItemMacroBestEffort(item, options);
  return { value, actionResult: actionResultFromEvidence({ owner: "itemMacro", scope: "external macro dispatch", uncertain: value === false,
    references: { itemUuid: item?.uuid }, warnings: ["Dispatch completion does not verify arbitrary external macro effects."] }) };
}

export async function executeItemMacroBestEffort(item, { event } = {}) {
  try {
    const itemMacroActive = game.modules.get("itemacro")?.active;
    const canExecute = itemMacroActive && typeof item.executeMacro === "function" && typeof item.hasMacro === "function" && item.hasMacro();
    if (canExecute) await item.executeMacro({ event });
    return true;
  } catch (err) {
    console.warn(`${SYSTEM_ID} | ItemMacro execution failed`, err);
    return false;
  }
}

// Preserve the existing export while keeping the synchronous builder in one place.
export { buildSpecialActionActivation } from "./index.js";
