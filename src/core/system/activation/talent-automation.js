import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { findLatestOpposedMessageByDefender, retargetOpposedMessage } from "../../combat/opposed/retarget.js";
import { grantFreeNextDefenseCommit } from "../../combat/activation-state-flags.js";
import { activateHardTargetEffect } from "../../traits/mobility-talents.js";
import { handleRacialPowerActivation, handleRacialTalentActivation } from "../../traits/racial-talents.js";
import { handleInspireHeroismActivation } from "../../traits/social-talents.js";
import { activateSpellcastingTalent, isActivatableSpellcastingTalent } from "../../traits/spellcasting-talents.js";
import { normalizeTalentKey, resolveTalentSlug } from "../../traits/talents-api.js";
import { createSeverityDebugLogger } from "../../../utils/debug.js";
import { SYSTEM_ID } from "../system-id.js";
import { getRoundTimeSecondsSafe } from "../time/round-time.js";
import { getTargetsFromContext, resolveTokenForActor, resolveTokenTarget } from "./helpers.js";

const AUTOMATION_TALENT_KEYS = new Set(["defender", "hardtarget", "thundercharge", "inspireheroism"]);
const activationDebug = createSeverityDebugLogger("activationDebug", "", "debug");

export function resolveTalentAutomationKey(item) {
  const raw = normalizeTalentKey(item?.name ?? "");
  const slug = resolveTalentSlug(item?.name ?? "");
  if (AUTOMATION_TALENT_KEYS.has(slug)) return slug;
  if (raw.startsWith("defender")) return "defender";
  if (raw.startsWith("hard-target") || raw.startsWith("hardtarget")) return "hardtarget";
  if (raw.startsWith("thunder-charge") || raw.startsWith("thundercharge")) return "thundercharge";
  return slug || raw;
}

function isAllyTokenPair(firstToken, secondToken) {
  const firstDisposition = Number(firstToken?.document?.disposition ?? NaN);
  const secondDisposition = Number(secondToken?.document?.disposition ?? NaN);
  if (!Number.isFinite(firstDisposition) || !Number.isFinite(secondDisposition)) return false;
  if (firstDisposition === 0 || secondDisposition === 0) return false;
  return firstDisposition === secondDisposition;
}

async function swapTokenPositions(tokenA, tokenB) {
  const tokenADoc = tokenA?.document ?? null;
  const tokenBDoc = tokenB?.document ?? null;
  if (!tokenADoc || !tokenBDoc) return false;

  const originalA = { x: Number(tokenADoc.x ?? 0) || 0, y: Number(tokenADoc.y ?? 0) || 0 };
  const originalB = { x: Number(tokenBDoc.x ?? 0) || 0, y: Number(tokenBDoc.y ?? 0) || 0 };

  const okA = await requestUpdateDocument(tokenADoc, { x: originalB.x, y: originalB.y });
  if (!okA) return false;
  const okB = await requestUpdateDocument(tokenBDoc, { x: originalA.x, y: originalA.y });
  if (!okB) {
    await requestUpdateDocument(tokenADoc, { x: originalA.x, y: originalA.y });
    return false;
  }
  return true;
}

async function activateDefenderTalent({ actor, context = {}, resolver = null } = {}) {
  activationDebug("UESRPG | DefenderActivation | start", {
    actor: actor?.name ?? null,
    actorUuid: actor?.uuid ?? null,
    contextTargets: Array.isArray(context?.targets) ? context.targets.length : null,
    userTargets: Number(game?.user?.targets?.size ?? 0)
  });

  let targets = getTargetsFromContext(context)
    .map((target) => resolveTokenTarget(target, { resolver }))
    .filter(Boolean);
  if (targets.length !== 1) {
    targets = Array.from(game?.user?.targets ?? [])
      .map((target) => resolveTokenTarget(target, { resolver }) ?? target?.object ?? null)
      .filter((target) => Boolean(target?.actor));
  }
  if (targets.length !== 1) {
    activationDebug("UESRPG | DefenderActivation | invalidTargets", { targetCount: targets.length });
    ui.notifications?.warn?.("Defender requires exactly one targeted ally token.");
    return;
  }

  const activatorToken = resolveTokenForActor(actor);
  if (!activatorToken) {
    ui.notifications?.warn?.("Defender requires the activating actor to have a placed token.");
    return;
  }

  const originalDefenderToken = targets[0];
  if (!isAllyTokenPair(activatorToken, originalDefenderToken)) {
    ui.notifications?.warn?.("Defender target must be an ally.");
    return;
  }

  let latest = findLatestOpposedMessageByDefender({
    actorUuid: originalDefenderToken.actor?.uuid ?? null,
    tokenUuid: originalDefenderToken.document?.uuid ?? null,
    mode: "any"
  });
  if (!latest) {
    latest = findLatestOpposedMessageByDefender({
      actorUuid: originalDefenderToken.actor?.uuid ?? null,
      tokenUuid: originalDefenderToken.document?.uuid ?? null,
      mode: "combat"
    });
  }
  if (!latest) {
    latest = findLatestOpposedMessageByDefender({
      actorUuid: originalDefenderToken.actor?.uuid ?? null,
      tokenUuid: originalDefenderToken.document?.uuid ?? null,
      mode: "any",
      activeOnly: false
    });
  }
  if (!latest) {
    ui.notifications?.warn?.("No active opposed card found for the targeted defender.");
    return;
  }

  let swapped = await retargetOpposedMessage(
    latest,
    {
      defenderTokenUuid: activatorToken.document?.uuid ?? null,
      defenderTokenId: activatorToken.id ?? activatorToken.document?.id ?? null
    },
    { userId: game.user?.id ?? null, reason: "defender-talent-activation" }
  );
  if (!swapped) {
    swapped = await retargetOpposedMessage(
      latest,
      {
        defenderTokenUuid: activatorToken.document?.uuid ?? null,
        defenderTokenId: activatorToken.id ?? activatorToken.document?.id ?? null
      },
      {
        userId: game.user?.id ?? null,
        reason: "defender-talent-activation",
        automationActorUuid: actor?.uuid ?? null,
        forceAutomation: true
      }
    );
  }
  if (!swapped) return;

  const positionsSwapped = await swapTokenPositions(activatorToken, originalDefenderToken);
  if (!positionsSwapped) {
    ui.notifications?.warn?.("Defender activated, but token position swap failed.");
  }

  const now = Date.now();
  const worldTime = Number(game?.time?.worldTime ?? 0) || 0;
  const combat = (game?.combat && game.combat.started) ? game.combat : null;
  const freeFlag = {
    source: "Defender",
    messageId: latest.id,
    createdAt: now,
    expiresAt: now + 60000,
    createdWorldTime: worldTime,
    expiresWorldTime: worldTime + Math.max(1, getRoundTimeSecondsSafe()),
    combatId: combat?.id ?? null,
    round: combat ? Number(combat.round ?? 0) : null,
    turn: combat ? Number(combat.turn ?? 0) : null,
    expireOnStepAdvance: true
  };

  const granted = await grantFreeNextDefenseCommit(actor, freeFlag);
  if (!granted) {
    ui.notifications?.warn?.("Defender activated, but free defense state could not be applied.");
  }

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor, token: activatorToken?.document ?? null }),
    content: `<div class="uesrpg"><b>Defender</b>: ${actor.name} intercepts for ${originalDefenderToken.actor?.name ?? "ally"}, swaps position, and gains a free next defense commit.</div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

async function activateThunderChargeTalent({ actor }) {
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="uesrpg"><b>Thunder Charge</b>: passive talent active. Use the attack dialog toggle on All Out Attack to waive the surcharge.</div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

export async function runTalentActivationAutomation({ item, actor, context = {}, resolver = null } = {}) {
  if (!item || item.type !== "talent") return;
  const key = resolveTalentAutomationKey(item);
  activationDebug("UESRPG | TalentAutomation | dispatch", {
    item: item?.name ?? null,
    key,
    actor: actor?.name ?? null,
    activationEnabled: Boolean(item?.system?.activation?.enabled)
  });
  try {
    if (key === "hardtarget") await activateHardTargetEffect(actor);
    if (key === "defender") await activateDefenderTalent({ actor, context, resolver });
    if (key === "thundercharge") await activateThunderChargeTalent({ actor });
    if (key === "inspireheroism") await handleInspireHeroismActivation({ actor, item });
    if (isActivatableSpellcastingTalent(item)) await activateSpellcastingTalent(actor, item);
    await handleRacialTalentActivation({ actor, item, itemKey: key });
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Talent activation automation failed`, { item: item?.name, key, err });
  }
}

export async function runPowerActivationAutomation({ item, actor } = {}) {
  try {
    const itemKey = resolveTalentAutomationKey(item);
    await handleRacialPowerActivation({ actor, item, itemKey });
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Talent activation automation failed`, err);
  }
}
