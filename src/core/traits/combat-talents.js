/**
 * @module traits/combat-talents
 * @description Combat-talent automation layer.
 *
 * This module provides small, explicit interceptors that existing combat
 * workflows can call at well-defined points.
 *
 * Scope (initial): Combat-category talents only.
 *
 * Non-goals:
 *  - Do not refactor unrelated systems.
 *  - Do not introduce new schema fields.
 */

import {
  hasTalent,
  getTalentItem,
  getSkillRank,
  getCombatStyleRank
} from "./talents-api.js";

import { shouldYieldToRE } from "./features/rule-elements.js";
import { hasCondition } from "../conditions/condition-engine.js";
import { itemHasToken } from "../combat/damage-automation.js";
import { getEffectiveWeaponHands } from "../combat/combat-utils.js";
import { getWeaponReachBoundsEffective } from "../homebrew/reach-length/weapon.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";

import {
  getActorCanvasToken,
  getMeleeReachMeters,
  countOpponentsInMeleeRange,
  isWithinMeleeRange,
  hasAllyWithTalentInMeleeOfOpponent
} from "./combat-proximity.js";
import { _num as _asNumber, _lower, _buildSituationalMod } from "./_primitives.js";

function _isSuccess(result) {
  return Boolean(result?.isSuccess);
}

function _getWeaponReachMetersFromUuid(weaponUuid) {
  const uuid = String(weaponUuid ?? "").trim();
  if (!uuid) return null;
  try {
    const doc = fromUuidSync(uuid);
    const item = (doc?.documentName === "Item") ? doc : null;
    if (!item) return null;
    const reach = Number(getWeaponReachBoundsEffective(item)?.max ?? NaN);
    if (Number.isFinite(reach) && reach > 0) return reach;
  } catch (_e) {
    return null;
  }
  return null;
}

function _getReachMetersForTest({ actor, weaponUuid } = {}) {
  const fromWeapon = _getWeaponReachMetersFromUuid(weaponUuid);
  if (Number.isFinite(fromWeapon) && fromWeapon > 0) return fromWeapon;
  return getMeleeReachMeters(actor);
}

/**
 * Apply pre-TN talent modifiers for attacker-side declarations.
 *
 * Currently implemented:
 *  - Precise: "suffers no penalty for Precision Strike attacks".
 *    Implementation: if the attack variant is "precision", we cancel the usual -20
 *    by applying +20 as a situational modifier.
 *
 * @param {object} params
 * @param {Actor} params.attacker
 * @param {object} params.declaration - attacker declaration payload
 * @param {Array<object>} params.situationalMods - mutable array (owned by caller)
 */
export function applyAttackerTalentPreTN({ attacker, declaration, situationalMods } = {}) {
  if (!attacker || !declaration || !Array.isArray(situationalMods)) return;

  const variant = _lower(declaration?.variant ?? "");
  if (variant === "precision" && hasTalent(attacker, "precise")) {
    // Yield to Rule Element runtime when it has an authoritative tnModifier for this talent.
    if (shouldYieldToRE(attacker, "precise", "tnModifier", "combat", getTalentItem)) return;
    // Avoid duplicate injection.
    if (!situationalMods.some(m => String(m?.key ?? "") === "talent:precise")) {
      situationalMods.push(_buildSituationalMod("talent:precise", "Precise", +20));
    }
  }
}

/**
 * Compute defender-side availability overrides for defensive reactions.
 *
 * Currently implemented:
 *  - Lightning Reflexes: allow Parry vs ranged attacks (not spells) at -20.
 *
 * Because the workflow currently only distinguishes melee vs ranged (not "spell"),
 * we gate this by requiring an actual weapon-based attack context.
 * Callers should pass attackerWeaponTraits derived from a weapon item.
 *
 * @param {object} params
 * @param {Actor} params.defender
 * @param {string} params.attackMode - "melee"|"ranged"
 * @param {object|null} params.attackerWeaponTraits - derived from a weapon item
 * @returns {{allowParryRanged: boolean, parryRangedTNMod: number}}
 */
export function getDefenseTalentOverrides({ defender, attackMode, attackerWeaponTraits } = {}) {
  const mode = _lower(attackMode);
  const weaponCtx = attackerWeaponTraits && typeof attackerWeaponTraits === "object";
  const isRanged = (mode === "ranged");

  if (defender && isRanged && weaponCtx && hasTalent(defender, "lightningreflexes")) {
    // Yield to Rule Element runtime when it has authoritative defenseOverride + tnModifier.
    if (shouldYieldToRE(defender, "lightningreflexes", "defenseOverride", "combat", getTalentItem)) {
      return { allowParryRanged: false, parryRangedTNMod: 0 };
    }
    return { allowParryRanged: true, parryRangedTNMod: -20 };
  }
  return { allowParryRanged: false, parryRangedTNMod: 0 };
}

/**
 * Build an Evade override context for Fearsome.
 *
 * Fearsome: may use Persuade (Strength) in place of Evade when Evading melee attacks.
 * Implementation (schema-safe): if Persuade skill exists, use its TN; otherwise fall back
 * to Strength characteristic total.
 *
 * @param {object} params
 * @param {Actor} params.defender
 * @param {string} params.attackMode
 * @returns {object|null}
 */
export function getEvadeOverrideContext({ defender, attackMode } = {}) {
  const mode = _lower(attackMode);
  if (!defender || mode !== "melee") return null;
  if (!hasTalent(defender, "fearsome")) return null;

  // Standardized TN override contract (usable by other reactions/tests).
  // Back-compat: keep `evadeOverride` for older callers.
  const payload = {
    defenseType: "evade",
    skillName: "Persuade",
    fallbackCharacteristic: "str",
    label: "Fearsome"
  };

  // IMPORTANT: Fearsome is OPTIONAL ("may"). We therefore do not auto-apply this override.
  // The opposed workflow (and any other callers) should prompt the user and only apply
  // `payload` when Persuade is chosen.
  return {
    fearsome: {
      available: true,
      payload
    }
  };
}

function _skillLabelFromTest({ defenseType, testLabel } = {}) {
  const dt = _lower(defenseType);
  if (dt === "evade") return "Evade";
  if (dt === "parry" || dt === "counter" || dt === "block") return (testLabel || "Combat Style");
  return (testLabel || "Test");
}

function _getCorrespondingRank({ actor, defenseType, styleUuid, testLabel } = {}) {
  const dt = _lower(defenseType);
  if (dt === "evade") return getSkillRank(actor, "Evade");
  // Parry/Counter/Block all use Combat Style.
  return getCombatStyleRank(actor, { styleUuid, styleName: testLabel || null });
}

export async function promptDoSReplacement({ title, rolledDoS, rankDoS, rankLabel } = {}) {
  const result = await customDialog({
    title: title || "Talent: Degrees of Success",
    content: `
      <div class="uesrpg">
        <p>Choose which Degrees of Success to use for this test:</p>
        <ul>
          <li><b>Rolled</b>: ${rolledDoS} DoS</li>
          <li><b>${rankLabel}</b>: ${rankDoS} DoS</li>
        </ul>
      </div>
    `,
    buttons: {
      rolled: {
        icon: '<i class="fas fa-dice"></i>',
        label: `Use Rolled (${rolledDoS})`,
        callback: () => ({ choice: "rolled" })
      },
      rank: {
        icon: '<i class="fas fa-star"></i>',
        label: `Use ${rankLabel} (${rankDoS})`,
        callback: () => ({ choice: "rank" })
      }
    },
    default: "rolled"
  }) ?? { choice: "rolled" };
  return result;
}

function _maybeAddBreakdownTN(tn, mod) {
  if (!tn || typeof tn !== "object" || !mod) return;
  tn.breakdown = Array.isArray(tn.breakdown) ? tn.breakdown : [];
  tn.breakdown.push(mod);
  tn.totalMod = _asNumber(tn.totalMod, 0) + _asNumber(mod.value, 0);
  tn.finalTN = _asNumber(tn.baseTN, 0) + _asNumber(tn.totalMod, 0);
}

/**
 * Apply defender-side TN mods derived from talents.
 *
 * Currently implemented:
 *  - Lightning Reflexes: -20 TN when Parrying a ranged attack.
 *
 * @param {object} params
 * @param {Actor} params.defender
 * @param {string} params.defenseType
 * @param {string} params.attackMode
 * @param {object} params.tn - TN object returned from computeTN (mutable)
 * @param {object|null} params.attackerWeaponTraits
 */
export function applyDefenderTalentTNMods({ defender, defenseType, attackMode, tn, attackerWeaponTraits } = {}) {
  if (!defender || !tn) return;
  const dt = _lower(defenseType);
  const mode = _lower(attackMode);
  if (dt === "parry" && mode === "ranged") {
    const ovr = getDefenseTalentOverrides({ defender, attackMode: mode, attackerWeaponTraits });
    if (ovr.allowParryRanged && ovr.parryRangedTNMod) {
      _maybeAddBreakdownTN(tn, _buildSituationalMod("talent:lightningreflexes", "Lightning Reflexes (Ranged Parry)", ovr.parryRangedTNMod));
    }
  }
}

/**
 * Apply post-roll Degrees-of-Success adjustments for combat talents.
 *
 * Implemented patterns:
 *  - +1 DoS on success under proximity constraints (Brawler, Duelist, Teamwork).
 *  - Choose rolled DoS (incl bonuses) OR replace with skill rank (Champion, God of War,
 *    Tricky Fighter, Wrestler).
 *
 * IMPORTANT: For replacement-choice talents, we only prompt when allowPrompt=true.
 * Otherwise, we keep the default "rolled" behavior to avoid GM-side decisions during
 * external roll banking.
 *
 * @param {object} params
 * @param {Actor} params.attacker
 * @param {Actor} params.defender
 * @param {Token|null} params.attackerToken
 * @param {Token|null} params.defenderToken
 * @param {"attacker"|"defender"} params.side
 * @param {object} params.result - mutable result object {isSuccess, degree, textual,...}
 * @param {string} params.defenseType - defender side only
 * @param {string|null} params.styleUuid - combat style UUID (if known)
 * @param {string|null} params.testLabel - combat style label (if known)
 * @param {boolean} params.allowPrompt
 * @returns {Promise<{changed: boolean, notes: string[]}>}
 */
export async function applyCombatTalentDoSAdjustments({
  attacker,
  defender,
  attackerToken,
  defenderToken,
  side,
  result,
  defenseType = "",
  styleUuid = null,
  testLabel = null,
  allowPrompt = false,
  weaponUuid = null
} = {}) {
  const notes = [];
  if (!result || !_isSuccess(result)) return { changed: false, notes };

  const isAttackerSide = (String(side) === "attacker");
  const actor = isAttackerSide ? attacker : defender;
  // Tokens can be missing in some roll-commit paths (e.g., banked/external rolls).
  // Fall back to a deterministic canvas token resolution.
  const token = isAttackerSide ? (attackerToken || getActorCanvasToken(attacker)) : (defenderToken || getActorCanvasToken(defender));
  const opponentActor = isAttackerSide ? defender : attacker;
  const opponentToken = isAttackerSide ? (defenderToken || getActorCanvasToken(defender)) : (attackerToken || getActorCanvasToken(attacker));

  if (!actor || !token || !opponentActor || !opponentToken) return { changed: false, notes };

  // Only the GM or an owner should ever be prompted for a choice.
  const canPrompt = (game?.user?.isGM || actor?.isOwner);
  if (!canPrompt) allowPrompt = false;

  // Determine current melee reach in meters.
  // Reach is used for proximity-based combat talents (e.g., Brawler / Duelist / isolated duel).
  // For attacker-side Combat Style tests, callers should pass the used weaponUuid so we can
  // respect weapon Reach. Otherwise we fall back to the actor's configured melee reach.
  const reachMeters = _getReachMetersForTest({ actor, weaponUuid });
  const opponentReachMeters = _getReachMetersForTest({ actor: opponentActor, weaponUuid: null });

  const dt = _lower(defenseType);
  const skillLabel = _skillLabelFromTest({ defenseType: dt, testLabel });
  const isEvadeTest = (dt === "evade");
  const isCombatStyleTest = (!isEvadeTest);

  // Proximity-derived conditions
  const opponentsInMelee = countOpponentsInMeleeRange(token, { reachMeters });
  const withinMeleeOfOpponent = isWithinMeleeRange(token, opponentToken, reachMeters);

  // Bonus DoS talents.
  let bonusDoS = 0;
  if (withinMeleeOfOpponent) {
    if (hasTalent(actor, "brawler") && opponentsInMelee >= 2) {
      // Yield to Rule Element runtime if the talent carries an authoritative dosBonus RE.
      if (!shouldYieldToRE(actor, "brawler", "dosBonus", "combat", getTalentItem)) {
        bonusDoS += 1;
        notes.push("Brawler: +1 DoS (rolled only)");
      }
    }
    if ((isCombatStyleTest || isEvadeTest) && hasTalent(actor, "duelist") && opponentsInMelee === 1) {
      if (!shouldYieldToRE(actor, "duelist", "dosBonus", "combat", getTalentItem)) {
        bonusDoS += 1;
        notes.push("Duelist: +1 DoS (rolled only)");
      }
    }
    if (isCombatStyleTest && hasTalent(actor, "teamwork")) {
      if (!shouldYieldToRE(actor, "teamwork", "dosBonus", "combat", getTalentItem)) {
        const hasAlly = hasAllyWithTalentInMeleeOfOpponent(token, opponentToken, "teamwork", {
          reachMetersForAlly: 2
        });
        if (hasAlly) {
          bonusDoS += 1;
          notes.push("Teamwork: +1 DoS");
        }
      }
    }
  }

  const baseDoS = Math.max(1, _asNumber(result.degree, 1));
  const rolledDoS = Math.max(1, baseDoS + bonusDoS);

  // Replacement-choice talents.
  // NOTE: When replacing DoS, we treat it as a full replacement (no bonus DoS) to
  // avoid ambiguous stacking with "rolled" bonuses.
  const replaceOptions = [];

  // Hyper Awareness: Combat Style tests only (Evade is handled by awareness-talents).
  if (isCombatStyleTest && hasTalent(actor, "hyperawareness")) {
    if (!shouldYieldToRE(actor, "hyperawareness", "dosReplacement", "combat", getTalentItem)) {
      const obsRank = getSkillRank(actor, "Observe");
      if (obsRank > 0) {
        replaceOptions.push({
          slug: "hyperawareness",
          title: "Hyper Awareness",
          rankDoS: obsRank,
          rankLabel: "Observe Rank"
        });
      }
    }
  }

  // Tricky Fighter: on melee Combat Style test vs melee opponent: choose rolled DoS or Deceive rank.
  if (withinMeleeOfOpponent && isCombatStyleTest && hasTalent(actor, "trickyfighter")) {
    if (!shouldYieldToRE(actor, "trickyfighter", "dosReplacement", "combat", getTalentItem)) {
      const deceiveRank = getSkillRank(actor, "Deceive");
      if (deceiveRank > 0) {
        replaceOptions.push({
          slug: "trickyfighter",
          title: "Tricky Fighter",
          rankDoS: deceiveRank,
          rankLabel: "Deceive Rank"
        });
      }
    }
  }

  // Wrestler: on grapple/restrain/entangle tests - UNKNOWN in current workflow.
  // Safe scope: enable replacement on melee Combat Style tests only when explicitly marked
  // by defenseType/testLabel containing "grapple" context. If not present, do nothing.
  const label = _lower(testLabel);

  if (hasTalent(actor, "wrestler")) {
    if (shouldYieldToRE(actor, "wrestler", "dosReplacement", "combat", getTalentItem)) {
      // RE handles Wrestler — skip interceptor.
    } else {
      const looksLikeGrapple = label.includes("grapple") || label.includes("restrain") || label.includes("entangle");
      if (looksLikeGrapple) {
        const csRank = getCombatStyleRank(actor, { styleUuid, styleName: testLabel });
        if (csRank > 0) {
          replaceOptions.push({
            slug: "wrestler",
            title: "Wrestler",
            rankDoS: csRank,
            rankLabel: "Combat Style Rank"
          });
        }
      }
    }
  }

  // Champion: melee vs only one opponent: choose rolled DoS or corresponding skill rank.
  if (withinMeleeOfOpponent && opponentsInMelee === 1 && hasTalent(actor, "champion")) {
    if (!shouldYieldToRE(actor, "champion", "dosReplacement", "combat", getTalentItem)) {
      const rank = _getCorrespondingRank({ actor, defenseType: dt, styleUuid, testLabel });
      if (rank > 0) {
        replaceOptions.push({
          slug: "champion",
          title: "Champion",
          rankDoS: rank,
          rankLabel: `${skillLabel} Rank`
        });
      }
    }
  }

  // God of War: melee vs 2+ opponents: choose rolled DoS or corresponding skill rank.
  if (withinMeleeOfOpponent && opponentsInMelee >= 2 && hasTalent(actor, "godofwar")) {
    if (!shouldYieldToRE(actor, "godofwar", "dosReplacement", "combat", getTalentItem)) {
      const rank = _getCorrespondingRank({ actor, defenseType: dt, styleUuid, testLabel });
      if (rank > 0) {
        replaceOptions.push({
          slug: "godofwar",
          title: "God of War",
          rankDoS: rank,
          rankLabel: `${skillLabel} Rank`
        });
      }
    }
  }

  // If multiple replacement talents apply, use a single prompt with the highest rank option.
  let finalDoS = rolledDoS;
  let changed = false;

  if (replaceOptions.length) {
    // Prefer the maximum rankDoS (best outcome) when multiple sources exist.
    const best = replaceOptions.reduce((a, b) => (b.rankDoS > a.rankDoS ? b : a));

    // Replacement choice must be made at the time the roll is being committed, not at actor update time.
    // We therefore store the selection on the roll result object (chat card data), not as actor flags.
    const storedChoice = String(result?.talentDoSChoice ?? "").trim().toLowerCase();
    const hasStored = (storedChoice === "rank" || storedChoice === "roll" || storedChoice === "rolled");

    if (!hasStored && allowPrompt) {
      const picked = await promptDoSReplacement({
        title: `${best.title} — Degrees of Success`,
        rolledDoS,
        rankDoS: best.rankDoS,
        rankLabel: best.rankLabel
      });
      result.talentDoSChoice = (picked?.choice === "rank") ? "rank" : "roll";
      result.talentDoSChoiceSource = best.slug;
    }

    const choice = String(result?.talentDoSChoice ?? "").trim().toLowerCase();
    const emitted = (choice === "rank") || hasStored || allowPrompt;
    if (choice === "rank") {
      finalDoS = Math.max(1, best.rankDoS);
      notes.push(`${best.title}: used ${best.rankLabel}`);
    } else {
      // Default: keep rolled DoS.
      finalDoS = rolledDoS;
      // If Duelist applied, it's explicitly rolled-only; our rolledDoS already includes it.
      if (emitted && !bonusDoS) notes.push(`${best.title}: used rolled DoS`);
    }
  }

  // Apply the final DoS.
  if (finalDoS !== baseDoS) {
    result.degree = finalDoS;
    result.textual = result.isSuccess ? `${finalDoS} DoS` : `${finalDoS} DoF`;
    changed = true;
  }

  // Record a light marker to avoid repeated application in a single lane.
  // This does not persist to actor data; it only lives in the message flag payload.
  if (changed) {
    result.talentDoSAdjusted = true;
  }

  return { changed, notes };
}

/**
 * Apply DoS replacement talents to a non-opposed test.
 *
 * Supported (initial): Wrestler.
 *
 * Reasoning:
 * - Some tests (e.g. Grapple/Restrain/Entangle) may be authored as normal skill tests
 *   rather than routed through the opposed combat workflow.
 * - We keep this opt-in and require the caller to supply a descriptive `testLabel`.
 *
 * @param {object} params
 * @param {Actor} params.actor
 * @param {Token|null} params.token
 * @param {object} params.result - mutable result object {isSuccess, degree, ...}
 * @param {string|null} params.testLabel
 * @param {string|null} params.styleUuid
 * @param {boolean} params.allowPrompt
 * @returns {Promise<{changed: boolean, notes: string[]}>}
 */
export async function applyCombatTalentDoSAdjustmentsUnopposed({
  actor,
  token = null,
  result,
  testLabel = null,
  styleUuid = null,
  allowPrompt = false
} = {}) {
  const notes = [];
  if (!actor || !result || !_isSuccess(result)) return { changed: false, notes };

  const canPrompt = (game?.user?.isGM || actor?.isOwner);
  if (!canPrompt) allowPrompt = false;

  const label = _lower(testLabel);
  const replaceOptions = [];

  // Wrestler: on grapple/restrain/entangle tests choose rolled DoS or Combat Style rank.
  if (hasTalent(actor, "wrestler")) {
    const looksLikeGrapple = label.includes("grapple") || label.includes("restrain") || label.includes("entangle");
    if (looksLikeGrapple) {
      // Prefer explicit combat style UUID when supplied; otherwise take the highest combat style rank.
      let csRank = getCombatStyleRank(actor, { styleUuid, styleName: null });
      if (csRank <= 0) {
        const rankMap = {
          untrained: 0,
          novice: 0,
          apprentice: 1,
          journeyman: 2,
          adept: 3,
          expert: 4,
          master: 5
        };

        try {
          csRank = Math.max(
            0,
            ...(actor.items
              .filter(i => i?.type === "combatStyle")
              .map(i => {
                const k = String(i.system?.rank ?? "").toLowerCase().trim();
                return Number(rankMap[k] ?? 0);
              }))
          );
        } catch (_e) {
          csRank = 0;
        }
      }

      if (csRank > 0) {
        replaceOptions.push({
          slug: "wrestler",
          title: "Wrestler",
          rankDoS: csRank,
          rankLabel: "Combat Style Rank"
        });
      }
    }
  }

  if (!replaceOptions.length) return { changed: false, notes };

  const baseDoS = Math.max(1, _asNumber(result.degree, 1));
  const rolledDoS = baseDoS;

  // Use the highest rank when multiple sources exist.
  const best = replaceOptions.reduce((a, b) => (b.rankDoS > a.rankDoS ? b : a));

  let finalDoS = rolledDoS;
  const storedChoice = String(result?.talentDoSChoice ?? "").trim().toLowerCase();
  const hasStored = (storedChoice === "rank" || storedChoice === "roll" || storedChoice === "rolled");

  if (!hasStored && allowPrompt) {
    const picked = await promptDoSReplacement({
      title: `${best.title} — Degrees of Success`,
      rolledDoS,
      rankDoS: best.rankDoS,
      rankLabel: best.rankLabel
    });
    result.talentDoSChoice = (picked?.choice === "rank") ? "rank" : "roll";
    result.talentDoSChoiceSource = best.slug;
  }

  const choice = String(result?.talentDoSChoice ?? "").trim().toLowerCase();
  if (choice === "rank") {
    finalDoS = Math.max(1, best.rankDoS);
    notes.push(`${best.title}: used ${best.rankLabel}`);
  } else {
    finalDoS = rolledDoS;
  }

  const changed = finalDoS !== baseDoS;
  if (changed) {
    result.degree = finalDoS;
    notes.push(`${best.title}: DoS set to ${finalDoS}`);
  }

  return { changed, notes };
}

/**
 * Talent-derived WT adjustment.
 *
 * Crippling Strikes: enemies treat WT as one lower for melee attacks.
 * Eye of Vengeance: enemies treat WT as one lower for ranged attacks.
 *
 * @param {object} params
 * @param {Actor} params.attacker
 * @param {string} params.attackMode
 * @returns {number} delta (negative lowers the threshold)
 */
export function getEnemyWoundThresholdDelta({ attacker, attackMode } = {}) {
  const mode = _lower(attackMode);
  if (!attacker) return 0;
  if (mode === "melee" && hasTalent(attacker, "cripplingstrikes")) {
    if (shouldYieldToRE(attacker, "cripplingstrikes", "wtDelta", "combat", getTalentItem)) return 0;
    return -1;
  }
  if (mode === "ranged" && hasTalent(attacker, "eyeofvengeance")) {
    if (shouldYieldToRE(attacker, "eyeofvengeance", "wtDelta", "combat", getTalentItem)) return 0;
    return -1;
  }
  return 0;
}

function _weaponHasQualityKey(weapon, key) {
  return itemHasToken(weapon, key);
}

function _isHidden(attackerToken) {
  // Foundry uses TokenDocument.hidden for GM-hidden; players' "hidden" status is usually
  // represented by conditions/status effects. We conservatively support both:
  //  - token.document.hidden
  //  - actor has the Hidden condition
  const docHidden = Boolean(attackerToken?.document?.hidden);
  if (docHidden) return true;
  const actor = attackerToken?.actor ?? null;
  if (!actor) return false;
  return hasCondition(actor, "hidden");
}

/**
 * Apply talent-derived damage modifiers.
 *
 * Implemented:
 *  - Sneak Attack: add Stealth skill rank to damage when hidden.
 *  - Assassinate: when dealing Sneak Attack damage, ignore AR if using a one-handed weapon
 *    with Exploit Weakness quality.
 *    (Ignore AR applies only to the Sneak Attack bonus component.)
 *
 * @param {object} params
 * @param {Actor} params.attacker
 * @param {Actor} params.target
 * @param {Token|null} params.attackerToken
 * @param {Item|null} params.weapon
 * @param {object} params.damageContext - mutable damage context object (from buildDamageContext)
 */
export function applyTalentDamageModifiers({ attacker, target, attackerToken, weapon, damageContext } = {}) {
  if (!attacker || !damageContext) return;
  if (!hasTalent(attacker, "sneakattack") && !hasTalent(attacker, "assassinate")) return;
  if (!weapon || weapon.type !== "weapon") return;

  // Sneak Attack damage bonus can be handled by Rule Elements;
  // Assassinate logic is interceptor-only (too complex for RE conditions).
  const sneakYieldToRE = shouldYieldToRE(attacker, "sneakattack", "damageBonus", "combat", getTalentItem);

  const tok = attackerToken ?? getActorCanvasToken(attacker);
  const forcedHidden = (typeof damageContext.attackFromHidden === "boolean") ? damageContext.attackFromHidden : null;
  const hiddenNow = forcedHidden === null
    ? (tok ? _isHidden(tok) : hasCondition(attacker, "hidden"))
    : forcedHidden;
  if (!hiddenNow) return;

  // Sneak Attack bonus damage.
  if (hasTalent(attacker, "sneakattack")) {
    if (sneakYieldToRE) {
      // RE runtime handles the damage bonus; we still mark the sneak attack flag
      // so that Assassinate (interceptor-only) can check it.
      damageContext._isSneakAttack = true;
    } else {
      const stealthRank = getSkillRank(attacker, "Stealth");
      if (stealthRank > 0) {
        damageContext.talentDamageBonus = _asNumber(damageContext.talentDamageBonus, 0) + stealthRank;
        damageContext.talentNotes = Array.isArray(damageContext.talentNotes) ? damageContext.talentNotes : [];
        damageContext.talentNotes.push(`Sneak Attack: +${stealthRank} damage (Stealth rank)`);
        damageContext._isSneakAttack = true;
      }
    }
  }

  // Assassinate: ignore AR for sneak attack with one-handed Exploit Weakness weapon.
  if (damageContext._isSneakAttack && hasTalent(attacker, "assassinate") && weapon) {
    const handed = getEffectiveWeaponHands(weapon);
    const isOneHanded = Boolean(handed?.isOneHanded);
    if (isOneHanded && _weaponHasQualityKey(weapon, "exploitWeakness")) {
      damageContext.sneakIgnoreArmorOnly = true;
      damageContext.talentNotes = Array.isArray(damageContext.talentNotes) ? damageContext.talentNotes : [];
      damageContext.talentNotes.push("Assassinate: Sneak Attack ignores AR (Exploit Weakness)");
    }
  }
}
