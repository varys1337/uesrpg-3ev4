/**
 * src/core/combat/opposed/helpers/talents.js
 * ──────────────────────────────────────────────────────────────────────────
 * Talent-specific helpers for opposed combat workflows. This module encapsulates
 * mechanics tied to specific talents:
 * - Follow-Up Strike: Second attack on missed dual-wield attempts
 * - Mighty Cleave: All-Out two-handed attack can target a second enemy
 * - Gladiator: Free defensive reactions when surrounded by multiple opponents
 * - Unstoppable Might: Special wield modes for heavy weapons
 *
 * @module talent-helpers
 */

import { getEquippedWeaponItems } from "./combat.js";

/**
 * Phase 6 Extraction
 * ──────────────────────────────────────────────────────────────────────────
 */

import { TimeService } from "../../../time/time-service.js";
import { getEffectiveWeaponHands, getAttackModeFromWeapon } from "../../combat-utils.js";
import { hasTalent } from "../../../traits/talents-api.js";
import { getMeleeReachMeters, countOpponentsInMeleeRange } from "../../../traits/combat-proximity.js";
import { _safeGetSetting, _getSystemId } from "./util.js";
import { promptYesNo, promptSelectToken } from "../dialogs/common.js";
import { t, tf } from "../../../../utils/i18n.js";
import { _measureTokenDistance } from "./docs.js";
import { getOtherDualWieldWeaponUuid } from "./combat.js";
import { peekFreeNextDefenseCommit } from "../../activation-state-flags.js";
import { getActorCapabilityFlag } from "../../../active-effects/modifier-evaluator.js";

/**
 * _getActiveCombatRoundContext
 * ──────────────────────────────────────────────────────────────────────────
 * Retrieve current combat state: is there an active combat, what ID, what round.
 * Defensive: only treats as "in combat" when there's a valid combatId and positive round.
 *
 * @returns {object} { inCombat: boolean, combatId: string|null, round: number }
 */
export function _getActiveCombatRoundContext() {
  const combat = game?.combat ?? null;
  const combatId = combat?.id ?? null;
  const round = Number(combat?.round ?? 0);
  const started = Boolean(combat?.started);
  // Defensive: only treat as "in combat" when there is an active encounter with a positive round.
  const inCombat = Boolean(combatId) && started && Number.isFinite(round) && round > 0;
  return { inCombat, combatId, round };
}

/**
 * _getGladiatorAutomationMode
 * ──────────────────────────────────────────────────────────────────────────
 * Retrieve the Gladiator automation mode from settings. Supports legacy boolean and string modes:
 *  - "disabled" (false): Talent effects disabled
 *  - "original" (true, "make"): Free reaction on first attack per round (per attacker)
 *  - "updated" ("can"): Free reaction on any attack per round (first only)
 *
 * @returns {string} "disabled" | "original" | "updated"
 */
export function _getGladiatorAutomationMode() {
  const raw = _safeGetSetting("uesrpg-3ev4", "gladiatorAutomationMode", "original");
  if (raw === false) return "disabled";
  if (raw === true) return "original";
  const key = String(raw ?? "").toLowerCase();
  if (key === "disabled") return "disabled";
  if (key === "updated" || key === "can") return "updated";
  if (key === "original" || key === "make") return "original";
  return "original";
}

/**
 * _getGladiatorRoundContext
 * ──────────────────────────────────────────────────────────────────────────
 * Build a round context for Gladiator tracking. If in combat, uses combat round.
 * If not, falls back to world time (divided by round duration to approximate rounds).
 * Returns a unique roundKey that identifies this round for deduplication.
 *
 * @returns {object} { inCombat, combatId, round, worldRound?, worldTime?, roundKey }
 */
export function _getGladiatorRoundContext() {
  const { inCombat, combatId, round } = _getActiveCombatRoundContext();
  if (inCombat) {
    return {
      inCombat: true,
      combatId,
      round,
      roundKey: `combat:${combatId}:${round}`
    };
  }

  const roundSeconds = Math.max(1, Number(TimeService.getRoundTimeSeconds?.() ?? 6) || 6);
  const wt = Number(TimeService.getWorldTimeSeconds?.() ?? game.time?.worldTime ?? 0) || 0;
  const worldRound = Math.floor(wt / roundSeconds);
  return {
    inCombat: false,
    combatId: null,
    round: worldRound,
    worldRound,
    worldTime: wt,
    roundKey: `world:${worldRound}`
  };
}

/**
 * _getGladiatorContext
 * ──────────────────────────────────────────────────────────────────────────
 * Check if Gladiator talent should apply to the current defense roll. RAW requires:
 *  - Defender has Gladiator talent
 *  - Defender is within melee range of at least two opponents
 *  - Has not already used their free reaction this round
 *
 * @param {object} params
 * @param {object} params.defender - The defending actor
 * @param {object} params.defenderToken - The defender's token
 * @param {string} params.attackMode - "melee" or "ranged"
 * @returns {object} { mode, triggered, available, usedThisRound, roundCtx }
 */
export function _getGladiatorContext({ defender, defenderToken, attackMode } = {}) {
  const mode = _getGladiatorAutomationMode();
  const base = { mode, triggered: false, available: false, usedThisRound: false, roundCtx: null };
  try {
    if (mode === "disabled") return base;
    if (!defender || !defenderToken) return base;
    if (String(attackMode ?? "") !== "melee") return base;
    if (!hasTalent(defender, "gladiator")) return base;

    // RAW: "within melee range of at least two opponents".
    const reachMeters = getMeleeReachMeters(defender);
    const opponents = countOpponentsInMeleeRange(defenderToken, { reachMeters });
    if (opponents < 2) return base;

    const roundCtx = _getGladiatorRoundContext();
    const systemId = _getSystemId();
    const used = defender.getFlag(systemId, "talents.gladiator.freeReaction") ?? null;
    const usedKey = used?.roundKey ?? (used?.combatId && used?.round ? `combat:${used.combatId}:${used.round}` : null);
    const usedThisRound = Boolean(usedKey && usedKey === roundCtx.roundKey);

    return {
      mode,
      triggered: true,
      available: !usedThisRound,
      usedThisRound,
      roundCtx
    };
  } catch (_e) {
    return base;
  }
}

/**
 * _markGladiatorFreeReactionUsed
 * ──────────────────────────────────────────────────────────────────────────
 * Mark the Gladiator free reaction as used for this round by storing a flag on the actor.
 * Uses authority-proxy to ensure permission-safe mutation.
 *
 * @param {object} defender - The actor that consumed the free reaction
 * @param {object} roundCtx - The round context from _getGladiatorRoundContext
 * @returns {Promise<void>}
 */
export async function _markGladiatorFreeReactionUsed(defender, { combatId = null, round = null, worldRound = null, worldTime = null, roundKey = null } = {}) {
  if (!defender || !roundKey) return;
  const systemId = _getSystemId();
  const key = `flags.${systemId}.talents.gladiator.freeReaction`;

  const { requestUpdateDocument } = await import("../../../../utils/authority-proxy.js");
  await requestUpdateDocument(defender, {
    [key]: {
      combatId,
      round,
      worldRound,
      worldTime,
      roundKey,
      usedAt: Date.now()
    }
  });
}

/**
 * _getFreeDefenseReactionContext
 * ──────────────────────────────────────────────────────────────────────────
 * Determine if the defender gets a free defensive reaction (0 AP cost):
 *  - Defender (activation): grants one free next defense commit
 *  - Gladiator: Surrounded by multiple foes, gets free reaction if not used this round
 *
 * @param {object} params
 * @param {object|null} params.gladiator - The Gladiator context from _getGladiatorContext
 * @returns {object} { free: boolean, source: string|null, gladiatorCtx?: object }
 */
export function _getFreeDefenseReactionContext({ defenderData: _defenderData, defenderActor = null, messageId = null, gladiator = null } = {}) {
  const activationFree = peekFreeNextDefenseCommit(defenderActor, { messageId })
    ?? peekFreeNextDefenseCommit(defenderActor, { messageId: null });
  if (activationFree) {
    return { free: true, source: "defender-activation", activation: activationFree };
  }

  if (gladiator) return { free: true, source: "gladiator", gladiatorCtx: gladiator };

  return { free: false, source: null };
}

/**
 * _getUnstoppableMightWeaponEligibility
 * ──────────────────────────────────────────────────────────────────────────
 * Check if a weapon is eligible for Unstoppable Might special wield modes:
 *  - Hand-and-a-half weapons: Can be dual-wielded (using two-handed damage)
 *  - Two-handed weapons: Can be wielded in one hand (alongside shield or second weapon)
 * Both modes restrict Parry and Counter-Attack.
 *
 * @param {object} weapon - The weapon item
 * @returns {object} { eligible, isHandAndAHalf, isTwoHanded, effectiveHands }
 */
export function _getUnstoppableMightWeaponEligibility(weapon) {
  if (!weapon || weapon.type !== "weapon") return { eligible: false, isHandAndAHalf: false, isTwoHanded: false, effectiveHands: 0 };
  const handed = getEffectiveWeaponHands(weapon);
  const isHandAndAHalf = Boolean(handed?.isHandAndAHalf);
  const isTwoHanded = Boolean(handed?.isTwoHanded) && !isHandAndAHalf;
  const eligible = isHandAndAHalf || isTwoHanded;
  return { eligible, isHandAndAHalf, isTwoHanded, effectiveHands: Number(handed?.effectiveHands ?? 0) || 0 };
}

/**
 * _hasUnstoppableMightEligibleWeapons
 * ──────────────────────────────────────────────────────────────────────────
 * Check if the actor has any equipped melee weapons eligible for Unstoppable Might.
 * Used to determine if special wield mode prompts should appear.
 *
 * @param {object} actor - The actor to check
 * @returns {boolean} True if actor has eligible equipped melee weapons
 */
export function _hasUnstoppableMightEligibleWeapons(actor) {
  if (!actor) return false;
  const equippedWeapons = getEquippedWeaponItems(actor);
  const meleeWeapons = equippedWeapons.filter(w => String(getAttackModeFromWeapon(w) ?? '').toLowerCase() === 'melee');
  return meleeWeapons.some(w => _getUnstoppableMightWeaponEligibility(w).eligible);
}

/**
 * _promptUnstoppableMightUsage
 * ──────────────────────────────────────────────────────────────────────────
 * Prompt the user to confirm use of Unstoppable Might special wield modes.
 * For attack: confirms two-handed damage usage
 * For defense: warns that Parry/Counter are unavailable
 *
 * @param {object} params
 * @param {string} params.actorName - Name for the prompt
 * @param {string} params.purpose - "attack" or "defense"
 * @returns {Promise<boolean>} True if using special wield mode
 */
export async function _promptUnstoppableMightUsage({ actorName = "Actor", purpose = "attack" } = {}) {
  const details = purpose === "defense"
    ? `<p>${t("UESRPG.Dialogs.Opposed.UnstoppableDefenseDetail", "If yes, Parry and Counter-Attack are unavailable while wielding this way.")}</p>`
    : `<p>${t("UESRPG.Dialogs.Opposed.UnstoppableAttackDetail", "If yes, two-handed damage will be used for this attack.")}</p>`;
  return await promptYesNo({
    title: t("UESRPG.Dialogs.Opposed.UnstoppableMight", "Unstoppable Might"),
    content: `
      <div class="uesrpg">
        <p>${tf("UESRPG.Dialogs.Opposed.UnstoppableBody", { actor: foundry.utils.escapeHTML(actorName) }, `<b>${foundry.utils.escapeHTML(actorName)}</b> is using a special wield mode?`)}</p>
        <ul>
          <li>${t("UESRPG.Dialogs.Opposed.UnstoppableDualWield", "Dual wielding hand-and-a-half weapons (use two-handed damage)")}</li>
          <li>${t("UESRPG.Dialogs.Opposed.UnstoppableOneHandTwoHanded", "Wielding a two-handed weapon in one hand")}</li>
        </ul>
        ${details}
      </div>
    `,
    yesLabel: t("UESRPG.Dialogs.Opposed.UsingSpecialWield", "Using Special Wield"),
    noLabel: t("UESRPG.Dialogs.Opposed.NormalWield", "Normal Wield")
  });
}

/**
 * _maybeEnableFollowUpStrike
 * ──────────────────────────────────────────────────────────────────────────
 * RAW: Follow-Up Strike (Chapter 4): If you miss a dual-wield attack, you may
 * immediately make a second attack with the other weapon as a free action.
 *
 * This function marks the workflow data with Follow-Up Strike eligibility when:
 *  - Attacker has the Follow-Up Strike talent
 *  - Attack roll failed
 *  - Attacker is dual-wielding (has a second weapon equipped)
 *  - This is not already a follow-up attack
 *
 * @param {object} params
 * @param {object} params.data - The workflow data
 * @param {object} params.attacker - The attacking actor
 * @param {object} params.attackerResult - The attack roll result
 * @returns {Promise<void>}
 */
export async function _maybeEnableFollowUpStrike({ data, attacker, attackerResult } = {}) {
  if (!data || !attacker || !attackerResult) return;
  if (data?.context?.followUpStrike?.active) return; // this is already the follow-up attack
  if (data?.context?.followUpStrike?.eligible) return; // already enabled on this card
  if (!_safeGetSetting("uesrpg-3ev4", "enableFollowupStrike", false)) return;
  if (attackerResult.isSuccess !== false) return;
  const followupAttackFree = getActorCapabilityFlag(attacker, "flags.uesrpg-3ev4.combat.followupAttackFree");
  if (!followupAttackFree && !hasTalent(attacker, "followupstrike")) return;

  // RAW: only while dual wielding.
  const currentWeaponUuid = data?.context?.weaponUuid ?? null;
  const otherWeaponUuid = getOtherDualWieldWeaponUuid(attacker, currentWeaponUuid);
  if (!otherWeaponUuid) return;

  data.context = data.context ?? {};
  data.context.followUpStrike = {
    eligible: true,
    used: false,
    freeAttack: true,
    ignoresRoundLimit: true,
    sourceWeaponUuid: currentWeaponUuid ?? null,
    otherWeaponUuid
  };
}

/**
 * _maybeApplyMightyCleave
 * ──────────────────────────────────────────────────────────────────────────
 * RAW: Mighty Cleave (Chapter 4): When making an All-Out Attack with a two-handed
 * weapon, you may target a second enemy within 2m of the first target (both must
 * be within melee reach).
 *
 * This function prompts the user to select a second target and adds it to the
 * defenders array if valid. Returns true if Mighty Cleave is enabled, false otherwise.
 *
 * @param {object} params
 * @param {object} params.data - The workflow data
 * @param {object} params.attacker - The attacking actor
 * @param {object} params.attackerToken - The attacker's token
 * @param {object} params.primaryDefenderToken - The first defender token
 * @param {object} params.weapon - The attacking weapon
 * @param {object} params.declaration - Attack declaration (variant = "allOut")
 * @returns {Promise<boolean>} True if Mighty Cleave is enabled and applied
 */
export async function _maybeApplyMightyCleave({ data, attacker, attackerToken, primaryDefenderToken, weapon, declaration } = {}) {
  if (!data || !attacker || !attackerToken || !primaryDefenderToken || !weapon || !declaration) return false;
  if (!_safeGetSetting("uesrpg-3ev4", "enableMightyCleave", false)) return false;
  if (!hasTalent(attacker, "mightycleave")) return false;
  if (String(declaration.variant ?? "normal") !== "allOut") return false;
  if (String(data?.context?.attackMode ?? "melee") !== "melee") return false;
  if (Number(getEffectiveWeaponHands(weapon)) < 2) return false;
  if (data?.context?.mightyCleave?.enabled) return true;

  // Build candidate token list.
  const primary = primaryDefenderToken;
  const distanceLimit = 2;

  // Lazy import to break circular dependency
  const { computeMeleeReachContext } = await import("../helpers/combat.js");
  const reachFor = (tok) => {
    const ctx = computeMeleeReachContext({ attackerToken, defenderToken: tok, weapon });
    return ctx?.inRange === true;
  };
  const withinTwoMetersOfPrimary = (tok) => {
    const d = _measureTokenDistance(primary, tok);
    return Number.isFinite(d) && d <= distanceLimit;
  };

  const isValidCandidate = (tok) => {
    if (!tok || tok === primary) return false;
    if (tok === attackerToken) return false;
    if (!tok.actor) return false;
    if (!reachFor(tok)) return false;
    if (!withinTwoMetersOfPrimary(tok)) return false;
    return true;
  };

  // Prefer already-targeted tokens, else scan all placeables.
  const targeted = Array.from(game?.user?.targets ?? []).filter(isValidCandidate);
  const pool = targeted.length ? targeted : (Array.isArray(canvas?.tokens?.placeables) ? canvas.tokens.placeables.filter(isValidCandidate) : []);
  if (pool.length === 0) return false;

  const use = await promptYesNo({
    title: t("UESRPG.Dialogs.Opposed.MightyCleave", "Mighty Cleave"),
    content: `<p>${tf("UESRPG.Dialogs.Opposed.MightyCleaveBody", { target: foundry.utils.escapeHTML(primary.name) }, `Use <b>Mighty Cleave</b> to add a second target within 2m of ${foundry.utils.escapeHTML(primary.name)}?`)}</p>`,
    yesLabel: t("UESRPG.Dialogs.Opposed.UseMightyCleave", "Use Mighty Cleave"),
    noLabel: t("UESRPG.UI.No", "No")
  });
  if (!use) return false;

  const chosen = await promptSelectToken({
    title: t("UESRPG.Dialogs.Opposed.MightyCleave", "Mighty Cleave"),
    prompt: t("UESRPG.Dialogs.Opposed.MightyCleaveChooseSecondTarget", "Choose the second target (must be within melee reach and within 2m of the first target)."),
    tokens: pool
  });
  if (!chosen) return false;

  // Final validation (distance + reach).
  const between = _measureTokenDistance(primary, chosen);
  if (!Number.isFinite(between) || between > distanceLimit) {
    ui.notifications?.warn?.(t("UESRPG.Notifications.Opposed.MightyCleaveTargetDistance", "Mighty Cleave requires the two targets to be within 2 meters of each other."));
    return false;
  }
  const reachCtx2 = computeMeleeReachContext({ attackerToken, defenderToken: chosen, weapon });
  if (!reachCtx2?.inRange) {
    ui.notifications?.warn?.(t("UESRPG.Notifications.Opposed.MightyCleaveTargetReach", "Second target is not within melee reach for Mighty Cleave."));
    return false;
  }

  // Add defender entry (do not change the currently selected defender lane).
  const tokenUuid = chosen.document?.uuid ?? null;
  const actorUuid = chosen.actor?.uuid ?? null;
  if (!actorUuid) return false;

  const exists = (data.defenders ?? []).some(d => (d?.tokenUuid && tokenUuid && d.tokenUuid === tokenUuid) || d?.actorUuid === actorUuid);
  if (!exists) {
    data.defenders = Array.isArray(data.defenders) ? data.defenders : [];
    data.defenders.push({
      actorUuid,
      tokenUuid,
      tokenName: chosen.name ?? null,
      name: chosen.actor?.name ?? chosen.name,
      label: null,
      testLabel: null,
      defenseLabel: null,
      target: null,
      defenseType: null,
      result: null,
      noDefense: false,
      banked: { committed: false, committedAt: null, committedBy: null },
      tn: null,
      outcome: null,
      advantage: null
    });
  }

  data.context = data.context ?? {};
  data.context.mightyCleave = { enabled: true };
  return true;
}
