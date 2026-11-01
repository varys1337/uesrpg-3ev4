/**
 * @module traits/general-talents
 * @description Automation helpers for General talents (Chapter 4):
 *  - Expert (Specialization): reroll failed skill tests made with the chosen specialization (once per test)
 *  - Grandmaster (Skill): reroll failed skill tests for the chosen skill (once per test; does not stack)
 *  - Untouchable: WT override + post-hit LP spend is implemented in actor prepare + damage resolver
 *
 * This module focuses on deterministic, schema-safe helpers and does not register hooks directly.
 */

import { normalizeTalentKey } from "./talents-api.js";
import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { createDebugLogger } from "../../utils/debug.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { acquireLock, releaseLock } from "../../utils/authority-proxy/shared.js";
import { resolveActorFromUuidSync, resolveUuidSync } from "../../utils/uuid-cache.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { getFlagValueWithFallback, getCanonicalFlags, getLegacyFlags } from "../system/flags.js";
import { isPassiveFeatureActive } from "./features/feature-config.js";
import { parseSpecializations } from "../advancement/skill-advancement.js";
import { applyHyperAwarenessToResult } from "./awareness-talents.js";

const _dlog = createDebugLogger("skillRollDebug", "[UESRPG][GeneralTalents]");

function _iterTalentItems(actor) {
  const items = actor?.items ?? [];
  return (Array.isArray(items) ? items : Array.from(items))
    .filter(item => item?.type === "talent" && isPassiveFeatureActive(item));
}

function _extractChoiceFromName(name, { base } = {}) {
  const n = String(name ?? "").trim();
  const b = String(base ?? "").trim();
  if (!n || !b) return null;

  // Preferred authoring: "Grandmaster (Alchemy)", "Expert (Stealth [Urban])", etc.
  const re = new RegExp(`^\\s*${b}\\s*\\(([^)]+)\\)\\s*$`, "i");
  const m = n.match(re);
  if (m && m[1]) return String(m[1]).trim() || null;

  // Secondary authoring: "Grandmaster: Alchemy" / "Grandmaster - Alchemy"
  const parts = n.split(/[:\-\u2014\u2013]/).map(s => String(s).trim()).filter(Boolean);
  if (parts.length >= 2 && normalizeTalentKey(parts[0]) === normalizeTalentKey(b)) {
    return parts.slice(1).join(" ").trim() || null;
  }

  return null;
}

function _collectGrandmasterChoices(actor) {
  const out = [];
  for (const it of _iterTalentItems(actor)) {
    if (!it || it.type !== "talent") continue;
    const key = normalizeTalentKey(it.name);
    if (!key.startsWith("grandmaster")) continue;

    const choice = _extractChoiceFromName(it.name, { base: "Grandmaster" });
    if (!choice) continue;

    // Ignore the generic rules-label "(Skill)" entry; it does not identify a chosen skill.
    if (normalizeTalentKey(choice) === "skill") continue;

    out.push({ item: it, choiceLabel: choice, choiceKey: normalizeTalentKey(choice) });
  }
  return out;
}

function _collectExpertSpecializationChoices(actor) {
  const out = [];
  for (const it of _iterTalentItems(actor)) {
    if (!it || it.type !== "talent") continue;
    const key = normalizeTalentKey(it.name);
    if (!key.startsWith("expert")) continue;

    const choice = _extractChoiceFromName(it.name, { base: "Expert" });
    if (!choice) continue;

    // Ignore the generic rules-label "(Specialization)" entry; it does not identify a chosen specialization.
    const cKey = normalizeTalentKey(choice);
    if (cKey === "specialization" || cKey.includes("specialization")) continue;

    out.push({ item: it, choiceLabel: choice, choiceKey: cKey });
  }
  return out;
}

function _matchesChoice({ choiceKey, skillKey }) {
  return Boolean(choiceKey && skillKey && choiceKey === skillKey);
}

/**
 * Check whether the actor has Grandmaster for a specific (named) skill.
 *
 * This is used for the Chapter 4 Grandmaster magical-skill special case (+1 effective rank).
 *
 * @param {Actor} actor
 * @param {string} skillName
 * @returns {boolean}
 */
export function hasGrandmasterForSkill(actor, skillName) {
  if (!actor || !skillName) return false;
  const skillKey = normalizeTalentKey(skillName);
  if (!skillKey) return false;
  return Boolean(_collectGrandmasterChoices(actor).find(c => _matchesChoice({ choiceKey: c.choiceKey, skillKey })));
}

/**
 * Determine whether a skill test is eligible for a General-talent reroll.
 *
 * Precedence (per Chapter 4 restriction):
 *  - Prefer Grandmaster over Expert when both could apply.
 *
 * @param {Actor} actor
 * @param {{skillName: string, useSpecialization?: boolean, specializationName?: string}} params
 * @returns {{source: "grandmaster"|"expert", label: string}|null}
 */
export function getGeneralTalentRerollEligibility(actor, { skillName, useSpecialization = false, specializationName = "" } = {}) {
  if (!actor || !skillName) return null;
  const skillKey = normalizeTalentKey(skillName);
  if (!skillKey) return null;

  const gm = _collectGrandmasterChoices(actor).find(c => _matchesChoice({ choiceKey: c.choiceKey, skillKey })) ?? null;
  if (gm) return { source: "grandmaster", label: gm.choiceLabel };

  // Expert requires the roll to be explicitly marked as using a specialization.
  if (!useSpecialization) return null;

  const specializationKey = normalizeTalentKey(specializationName);
  if (!specializationKey) return null;
  const matchingSkills = Array.from(actor.items ?? []).filter(item =>
    (item?.type === "skill" || item?.type === "magicSkill")
    && parseSpecializations(item?.system?.trainedItems).some(name => normalizeTalentKey(name) === specializationKey));
  const unambiguousSkill = matchingSkills.length === 1
    && normalizeTalentKey(matchingSkills[0]?.name) === skillKey;
  const ex = _collectExpertSpecializationChoices(actor).find(c =>
    (unambiguousSkill && c.choiceKey === specializationKey) || c.choiceKey === `${skillKey}-${specializationKey}`) ?? null;
  if (ex) return { source: "expert", label: ex.choiceLabel };

  return null;
}

/**
 * Perform a reroll for a skill-test ChatMessage that contains `flags.uesrpg.skillTest`.
 *
 * Requirements:
 * - Only the message author or a GM may execute (so we can update flags deterministically).
 * - Reroll only once per message (`flags.uesrpg.reroll.used`).
 *
 * @param {ChatMessage} message
 * @returns {Promise<boolean>} true if rerolled
 */
export async function rerollSkillTestFromChatMessage(message) {
  if (!message) return false;
  const canUpdate = Boolean(game.user?.isGM) || Boolean(message.isAuthor);
  if (!canUpdate) return false;

  const st = getFlagValueWithFallback(message, "skillTest");
  if (!st || typeof st !== "object") return false;
  if (st.isSuccess !== false) return false;

  const reroll = getFlagValueWithFallback(message, "reroll") ?? {};
  if (reroll?.used === true) return false;
  if (reroll?.isReroll === true) return false;

  const actorUuid = String(st.actorUuid ?? "") || String(getFlagValueWithFallback(message, "rollRequest.actorUuid") ?? "") || "";
  if (!actorUuid) return false;
  const actor = resolveActorFromUuidSync(actorUuid);
  if (!actor) return false;

  const skillName = String(st.skillName ?? "").trim() || (getFlagValueWithFallback(message, "rollRequest.skill.name") ?? null);
  if (!skillName) return false;

  const useSpecialization = Boolean(st.useSpecialization);
  const eligibility = getGeneralTalentRerollEligibility(actor, { skillName, useSpecialization, specializationName: st.specializationName });
  if (!eligibility) return false;

  const target = Number(st.target ?? NaN);
  if (!Number.isFinite(target)) return false;

  const rollFormula = String(st.rollFormula ?? "1d100").trim() || "1d100";
  const rollMode = String(st.rollMode ?? getCoreRollMode()).trim();
  const lockKey = `talent-reroll:${message.uuid ?? message.id}`;
  if (!await acquireLock(lockKey, { wait: false })) return false;
  try {
    const currentMessage = game.messages.get(message.id) ?? message;
    const currentReroll = getFlagValueWithFallback(currentMessage, "reroll") ?? {};
    if (currentReroll.used === true || currentReroll.isReroll === true) return false;

    _dlog("reroll", { messageId: message.id, actor: actor.name, skillName, source: eligibility.source, target });

    const res = await doTestRoll(actor, { rollFormula, target, allowLucky: true, allowUnlucky: true });
    const skillItem = st.skillUuid ? resolveUuidSync(st.skillUuid) : null;
    await applyHyperAwarenessToResult(actor, skillName, res, {
      allowPrompt: true,
      isCombatStyle: skillItem?.type === "combatStyle" && skillItem?.actor?.uuid === actor.uuid
    });

    // Mark original as used FIRST to avoid double-click racing.
    const marked = await requestUpdateDocument(currentMessage, {
      [`flags.${FLAG_SCOPE}.reroll.used`]: true,
      [`flags.${FLAG_SCOPE}.reroll.source`]: eligibility.source,
      [`flags.${FLAG_SCOPE}.reroll.usedAt`]: Date.now()
    });
    if (!marked) {
      ui.notifications?.warn?.("The reroll could not be recorded. Check the original roll before trying again.");
      return false;
    }

    const flavor = `
      <div class="uesrpg">
        <div><b>${foundry.utils.escapeHTML(skillName)}</b> \u2014 Reroll (Talent: ${eligibility.source === "grandmaster" ? "Grandmaster" : "Expert"})</div>
        <div style="opacity:0.85; font-size:12px;"><b>Target Number:</b> ${target}</div>
        <div><b>Result:</b> ${res.isSuccess ? "Success" : "Failure"} (${foundry.utils.escapeHTML(String(res.textual ?? ""))})</div>
      </div>
    `;

    try {
      await res.roll.toMessage({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor,
        flags: {
          [FLAG_SCOPE]: {
            ...getLegacyFlags(message),
            ...getCanonicalFlags(message),
            reroll: {
              isReroll: true,
              parentMessageId: message.id,
              source: eligibility.source
            },
            skillTest: {
              ...st,
              isReroll: true,
              isSuccess: Boolean(res.isSuccess),
              degree: Number(res.degree ?? 0) || 0,
              textual: String(res.textual ?? ""),
              hyperAwarenessChoice: res.hyperAwarenessChoice ?? null,
              hyperAwarenessChoiceValue: res.hyperAwarenessChoiceValue ?? null
            }
          }
        },
        rollMode
      });
    } catch (error) {
      console.warn("UESRPG | Talent reroll was recorded but its chat message failed", error);
      ui.notifications?.warn?.("The reroll was recorded, but its chat message could not be posted. Review the original roll before continuing.");
      return false;
    }

    return true;
  } finally {
    releaseLock(lockKey);
  }
}
