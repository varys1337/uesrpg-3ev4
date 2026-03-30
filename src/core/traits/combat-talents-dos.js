/**
 * @module traits/combat-talents-dos
 * @description Internal DoS and reach helpers for combat-talent automation.
 */

import {
  hasTalent,
  getTalentItem,
  getSkillRank,
  getCombatStyleRank
} from "./talents-api.js";
import { shouldYieldToRE } from "./features/rule-elements.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import {
  getActorCanvasToken,
  getMeleeReachMeters,
  countOpponentsInMeleeRange,
  isWithinMeleeRange,
  hasAllyWithTalentInMeleeOfOpponent
} from "./combat-proximity.js";
import { _num as _asNumber, _lower } from "./_primitives.js";
import { getWeaponReachBoundsEffective } from "../homebrew/reach-length/weapon.js";
import { resolveUuidSync } from "../../utils/uuid-cache.js";

function isSuccess(result) {
  return Boolean(result?.isSuccess);
}

function getWeaponReachMetersFromUuid(weaponUuid) {
  const uuid = String(weaponUuid ?? "").trim();
  if (!uuid) return null;
  const doc = resolveUuidSync(uuid);
  const item = (doc?.documentName === "Item") ? doc : null;
  if (!item) return null;
  const reach = Number(getWeaponReachBoundsEffective(item)?.max ?? NaN);
  return Number.isFinite(reach) && reach > 0 ? reach : null;
}

function getReachMetersForTest({ actor, weaponUuid } = {}) {
  const fromWeapon = getWeaponReachMetersFromUuid(weaponUuid);
  if (Number.isFinite(fromWeapon) && fromWeapon > 0) return fromWeapon;
  return getMeleeReachMeters(actor);
}

function skillLabelFromTest({ defenseType, testLabel } = {}) {
  const dt = _lower(defenseType);
  if (dt === "evade") return "Evade";
  if (dt === "parry" || dt === "counter" || dt === "block") return (testLabel || "Combat Style");
  return (testLabel || "Test");
}

function getCorrespondingRank({ actor, defenseType, styleUuid, testLabel } = {}) {
  const dt = _lower(defenseType);
  if (dt === "evade") return getSkillRank(actor, "Evade");
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
  if (!result || !isSuccess(result)) return { changed: false, notes };

  const isAttackerSide = (String(side) === "attacker");
  const actor = isAttackerSide ? attacker : defender;
  const token = isAttackerSide ? (attackerToken || getActorCanvasToken(attacker)) : (defenderToken || getActorCanvasToken(defender));
  const opponentActor = isAttackerSide ? defender : attacker;
  const opponentToken = isAttackerSide ? (defenderToken || getActorCanvasToken(defender)) : (attackerToken || getActorCanvasToken(attacker));

  if (!actor || !token || !opponentActor || !opponentToken) return { changed: false, notes };

  const canPrompt = (game?.user?.isGM || actor?.isOwner);
  if (!canPrompt) allowPrompt = false;

  const reachMeters = getReachMetersForTest({ actor, weaponUuid });
  const dt = _lower(defenseType);
  const skillLabel = skillLabelFromTest({ defenseType: dt, testLabel });
  const isEvadeTest = (dt === "evade");
  const isCombatStyleTest = !isEvadeTest;

  const opponentsInMelee = countOpponentsInMeleeRange(token, { reachMeters });
  const withinMeleeOfOpponent = isWithinMeleeRange(token, opponentToken, reachMeters);

  let bonusDoS = 0;
  if (withinMeleeOfOpponent) {
    if (hasTalent(actor, "brawler") && opponentsInMelee >= 2 && !shouldYieldToRE(actor, "brawler", "dosBonus", "combat", getTalentItem)) {
      bonusDoS += 1;
      notes.push("Brawler: +1 DoS (rolled only)");
    }
    if ((isCombatStyleTest || isEvadeTest) && hasTalent(actor, "duelist") && opponentsInMelee === 1 && !shouldYieldToRE(actor, "duelist", "dosBonus", "combat", getTalentItem)) {
      bonusDoS += 1;
      notes.push("Duelist: +1 DoS (rolled only)");
    }
    if (isCombatStyleTest && hasTalent(actor, "teamwork") && !shouldYieldToRE(actor, "teamwork", "dosBonus", "combat", getTalentItem)) {
      const hasAlly = hasAllyWithTalentInMeleeOfOpponent(token, opponentToken, "teamwork", {
        reachMetersForAlly: 2
      });
      if (hasAlly) {
        bonusDoS += 1;
        notes.push("Teamwork: +1 DoS");
      }
    }
  }

  const baseDoS = Math.max(1, _asNumber(result.degree, 1));
  const rolledDoS = Math.max(1, baseDoS + bonusDoS);
  const replaceOptions = [];

  if (isCombatStyleTest && hasTalent(actor, "hyperawareness") && !shouldYieldToRE(actor, "hyperawareness", "dosReplacement", "combat", getTalentItem)) {
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

  if (withinMeleeOfOpponent && isCombatStyleTest && hasTalent(actor, "trickyfighter") && !shouldYieldToRE(actor, "trickyfighter", "dosReplacement", "combat", getTalentItem)) {
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

  const label = _lower(testLabel);
  if (hasTalent(actor, "wrestler") && !shouldYieldToRE(actor, "wrestler", "dosReplacement", "combat", getTalentItem)) {
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

  if (withinMeleeOfOpponent && opponentsInMelee === 1 && hasTalent(actor, "champion") && !shouldYieldToRE(actor, "champion", "dosReplacement", "combat", getTalentItem)) {
    const rank = getCorrespondingRank({ actor, defenseType: dt, styleUuid, testLabel });
    if (rank > 0) {
      replaceOptions.push({
        slug: "champion",
        title: "Champion",
        rankDoS: rank,
        rankLabel: `${skillLabel} Rank`
      });
    }
  }

  if (withinMeleeOfOpponent && opponentsInMelee >= 2 && hasTalent(actor, "godofwar") && !shouldYieldToRE(actor, "godofwar", "dosReplacement", "combat", getTalentItem)) {
    const rank = getCorrespondingRank({ actor, defenseType: dt, styleUuid, testLabel });
    if (rank > 0) {
      replaceOptions.push({
        slug: "godofwar",
        title: "God of War",
        rankDoS: rank,
        rankLabel: `${skillLabel} Rank`
      });
    }
  }

  let finalDoS = rolledDoS;
  let changed = false;

  if (replaceOptions.length) {
    const best = replaceOptions.reduce((a, b) => (b.rankDoS > a.rankDoS ? b : a));
    const storedChoice = String(result?.talentDoSChoice ?? "").trim().toLowerCase();
    const hasStored = storedChoice === "rank" || storedChoice === "roll" || storedChoice === "rolled";

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
    const emitted = choice === "rank" || hasStored || allowPrompt;
    if (choice === "rank") {
      finalDoS = Math.max(1, best.rankDoS);
      notes.push(`${best.title}: used ${best.rankLabel}`);
    } else {
      finalDoS = rolledDoS;
      if (emitted && !bonusDoS) notes.push(`${best.title}: used rolled DoS`);
    }
  }

  if (finalDoS !== baseDoS) {
    result.degree = finalDoS;
    result.textual = result.isSuccess ? `${finalDoS} DoS` : `${finalDoS} DoF`;
    changed = true;
  }

  if (changed) result.talentDoSAdjusted = true;
  return { changed, notes };
}

export async function applyCombatTalentDoSAdjustmentsUnopposed({
  actor,
  token = null,
  result,
  testLabel = null,
  styleUuid = null,
  allowPrompt = false
} = {}) {
  const notes = [];
  if (!actor || !result || !isSuccess(result)) return { changed: false, notes };

  const canPrompt = (game?.user?.isGM || actor?.isOwner);
  if (!canPrompt) allowPrompt = false;

  const label = _lower(testLabel);
  const replaceOptions = [];

  if (hasTalent(actor, "wrestler")) {
    const looksLikeGrapple = label.includes("grapple") || label.includes("restrain") || label.includes("entangle");
    if (looksLikeGrapple) {
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
              .filter((i) => i?.type === "combatStyle")
              .map((i) => Number(rankMap[String(i.system?.rank ?? "").toLowerCase().trim()] ?? 0)))
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
  const best = replaceOptions.reduce((a, b) => (b.rankDoS > a.rankDoS ? b : a));

  let finalDoS = rolledDoS;
  const storedChoice = String(result?.talentDoSChoice ?? "").trim().toLowerCase();
  const hasStored = storedChoice === "rank" || storedChoice === "roll" || storedChoice === "rolled";

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

  if (String(result?.talentDoSChoice ?? "").trim().toLowerCase() === "rank") {
    finalDoS = Math.max(1, best.rankDoS);
    notes.push(`${best.title}: used ${best.rankLabel}`);
  }

  const changed = finalDoS !== baseDoS;
  if (changed) {
    result.degree = finalDoS;
    notes.push(`${best.title}: DoS set to ${finalDoS}`);
  }

  return { changed, notes };
}
