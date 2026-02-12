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
import { isDebugEnabled } from "../../utils/debug.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";

function _debugEnabled() {
  return isDebugEnabled("skillRollDebug");
}

function _dlog(...args) {
  if (!_debugEnabled()) return;
  // eslint-disable-next-line no-console
  console.log("[UESRPG][GeneralTalents]", ...args);
}

function _iterTalentItems(actor) {
  const items = actor?.items ?? [];
  return Array.isArray(items) ? items : Array.from(items);
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
  if (!choiceKey || !skillKey) return false;
  if (choiceKey === skillKey) return true;
  // Tolerate authoring variants like "Stealth [Urban]" vs "Stealth".
  return choiceKey.includes(skillKey) || skillKey.includes(choiceKey);
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
 * @param {{skillName: string, useSpecialization?: boolean}} params
 * @returns {{source: "grandmaster"|"expert", label: string}|null}
 */
export function getGeneralTalentRerollEligibility(actor, { skillName, useSpecialization = false } = {}) {
  if (!actor || !skillName) return null;
  const skillKey = normalizeTalentKey(skillName);
  if (!skillKey) return null;

  const gm = _collectGrandmasterChoices(actor).find(c => _matchesChoice({ choiceKey: c.choiceKey, skillKey })) ?? null;
  if (gm) return { source: "grandmaster", label: gm.choiceLabel };

  // Expert requires the roll to be explicitly marked as using a specialization.
  if (!useSpecialization) return null;

  const expertChoices = _collectExpertSpecializationChoices(actor);

  // If the user authored only a single Expert choice (and that choice does not include the skill name),
  // allow it to apply when "Use Specialization" was explicitly toggled. This avoids having to guess
  // between multiple Expert specializations.
  if (expertChoices.length === 1) return { source: "expert", label: expertChoices[0].choiceLabel };

  const ex = expertChoices.find(c => _matchesChoice({ choiceKey: c.choiceKey, skillKey })) ?? null;
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

  const st = message?.flags?.uesrpg?.skillTest ?? null;
  if (!st || typeof st !== "object") return false;

  const reroll = message?.flags?.uesrpg?.reroll ?? {};
  if (reroll?.used === true) return false;
  if (reroll?.isReroll === true) return false;

  const actorUuid = String(st.actorUuid ?? "") || String(message?.flags?.uesrpg?.rollRequest?.actorUuid ?? "") || "";
  if (!actorUuid) return false;
  let actor = null;
  try { actor = fromUuidSync(actorUuid); } catch (_e) { actor = null; }
  if (!actor) return false;

  const skillName = String(st.skillName ?? "").trim() || (message?.flags?.uesrpg?.rollRequest?.skill?.name ?? null);
  if (!skillName) return false;

  const useSpecialization = Boolean(st.useSpecialization);
  const eligibility = getGeneralTalentRerollEligibility(actor, { skillName, useSpecialization });
  if (!eligibility) return false;

  const target = Number(st.target ?? NaN);
  if (!Number.isFinite(target)) return false;

  const rollFormula = String(st.rollFormula ?? "1d100").trim() || "1d100";
  const rollMode = String(st.rollMode ?? (game.settings.get("core", "rollMode") ?? "")).trim();

  _dlog("reroll", { messageId: message.id, actor: actor.name, skillName, source: eligibility.source, target });

  const res = await doTestRoll(actor, { rollFormula, target, allowLucky: true, allowUnlucky: true });

  // Mark original as used FIRST to avoid double-click racing.
  await requestUpdateDocument(message, {
    "flags.uesrpg.reroll.used": true,
    "flags.uesrpg.reroll.source": eligibility.source,
    "flags.uesrpg.reroll.usedAt": Date.now()
  });

  const flavor = `
    <div class="uesrpg">
      <div><b>${foundry.utils.escapeHTML(skillName)}</b> \u2014 Reroll (Talent: ${eligibility.source === "grandmaster" ? "Grandmaster" : "Expert"})</div>
      <div style="opacity:0.85; font-size:12px;"><b>Target Number:</b> ${target}</div>
    </div>
  `;

  await res.roll.toMessage({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    flags: {
      ...(message.flags ?? {}),
      uesrpg: {
        ...(message.flags?.uesrpg ?? {}),
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
          textual: String(res.textual ?? "")
        }
      }
    },
    rollMode
  });

  return true;
}
