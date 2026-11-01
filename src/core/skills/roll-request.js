/**
 * src/core/skills/roll-request.js
 *
 * Internal data contract for skill roll workflows.
 *
 * Goals:
 * - Deterministic payload for chat-card flags.
 * - Input validation + sane clamping.
 * - Shared debug logging.
 */

import { getDifficultyByKey } from "./skill-tn.js";
import { createDebugLogger } from "../../utils/debug.js";
import { normalizeCharacteristicKey } from "../../utils/maps/characteristics.js";
import { parseSpecializations } from "../advancement/skill-advancement.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";

const SKILL_ROLL_REQUEST_VERSION = 1;

export const skillRollDebug = createDebugLogger("skillRollDebug", "[UESRPG][SkillRoll]");

function clampNumber(v, { min = -200, max = 200 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
}

export function normalizeSkillRollOptions(raw = {}, fallback = {}) {
  raw = raw ?? {};

  const diffKey = String(raw.difficultyKey ?? fallback.difficultyKey ?? "average");
  const diff = getDifficultyByKey(diffKey);
  const selectedCharacteristicKey = normalizeCharacteristicKey(String(
    raw.selectedCharacteristicKey
    ?? fallback.selectedCharacteristicKey
    ?? ""
  ));

  return {
    difficultyKey: diff.key,
    circumstanceMod: clampNumber(raw.circumstanceMod ?? fallback.circumstanceMod ?? 0, { min: -30, max: 30 }),
    manualMod: clampNumber(raw.manualMod ?? fallback.manualMod ?? 0, { min: -200, max: 200 }),
    useSpec: Boolean(raw.useSpec ?? fallback.useSpec ?? false),
    specializationName: String(raw.specializationName ?? "").trim(),
    selectedCharacteristicKey,
    applyBlinded: Boolean(raw.applyBlinded ?? fallback.applyBlinded ?? false),
    applyDeafened: Boolean(raw.applyDeafened ?? fallback.applyDeafened ?? false)
  };
}

/** Select the specialization used for this roll, without guessing between several. */
export async function chooseRollSpecialization(skillItem) {
  const choices = parseSpecializations(skillItem?.system?.trainedItems);
  if (!choices.length) return "";
  if (choices.length === 1) return choices[0];
  const escape = foundry.utils.escapeHTML;
  try {
    const selected = await customDialog({
      layout: "workflow",
      title: "Choose Specialization",
      content: `<div class="form-group"><label>Specialization used for this test</label><select name="specializationName">${choices.map((name, index) => `<option value="${index}">${escape(name)}</option>`).join("")}</select></div>`,
      buttons: {
        ok: { label: "Continue", callback: html => Number(html?.querySelector?.('[name="specializationName"]')?.value ?? -1) },
        cancel: { label: "Cancel", callback: () => null }
      },
      default: "ok"
    });
    return Number.isInteger(selected) && selected >= 0 && selected < choices.length ? choices[selected] : null;
  } catch (_error) {
    return null;
  }
}

/**
 * Construct a normalized roll request contract.
 *
 * @param {object} cfg
 * @param {Actor} cfg.actor
 * @param {Item} cfg.skillItem
 * @param {Token|null} cfg.targetToken
 * @param {object} cfg.options
 * @param {object} cfg.context
 */
export function buildSkillRollRequest({ actor, skillItem, targetToken = null, options = {}, context = {} } = {}) {
  const actorUuid = actor?.uuid ?? null;
  const targetUuid = targetToken?.document?.uuid ?? targetToken?.uuid ?? null;
  const skillUuid = skillItem?.uuid ?? null;

  return {
    version: SKILL_ROLL_REQUEST_VERSION,
    createdAt: Date.now(),
    createdBy: game.user?.id ?? null,
    actorUuid,
    targetUuid,
    skill: {
      uuid: skillUuid,
      name: skillItem?.name ?? null,
      type: skillItem?.type ?? null
    },
    options: normalizeSkillRollOptions(options),
    context: {
      source: String(context.source ?? "unknown"),
      quick: Boolean(context.quick ?? false),
      messageId: context.messageId ?? null,
      groupId: context.groupId ?? null
    }
  };
}

/**
 * Validate a roll request contract. Returns { ok, error }.
 */
export function validateSkillRollRequest(req) {
  if (!req) return { ok: false, error: "Missing roll request." };
  if (Number(req.version) !== SKILL_ROLL_REQUEST_VERSION) {
    return { ok: false, error: `Unsupported skill roll request version: ${req.version}` };
  }
  if (!req.actorUuid) return { ok: false, error: "Missing actor." };
  if (!req.skill?.uuid) return { ok: false, error: "Missing skill." };
  if (!req.options?.difficultyKey) return { ok: false, error: "Missing difficulty." };
  return { ok: true, error: null };
}
