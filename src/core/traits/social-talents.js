/**
 * @module traits/social-talents
 * @description Automation helpers for Social talents (Chapter 4):
 *  - Inspire Heroism: once per round as Free Action, Command test to inspire
 *    an ally → target gains +10 to next combat test (1-round AE).
 *
 * This module is intentionally hook-free; the activation executor dispatches
 * here via `runTalentActivationAutomation()`.
 */

import { hasTalent } from "./talents-api.js";
import { _canPromptForActor } from "./_primitives.js";
import { createOrUpdateStatusEffect } from "../active-effects/status-effect.js";
import { buildEffectDuration } from "../time/effect-duration.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "../skills/skill-tn.js";
import { doTestRoll, formatDegree } from "../../utils/degree-roll-helper.js";
import { SYSTEM_ROLL_FORMULA } from "../constants.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { SYSTEM_ID } from "../system/namespace.js";

const EFFECT_KEY_INSPIRE_HEROISM = "talent:inspireHeroism";

/* ------------------------------------------------------------------ */
/*  Inspire Heroism                                                   */
/* ------------------------------------------------------------------ */

/**
 * Validate whether Inspire Heroism can be activated right now.
 *
 * @param {object} params
 * @param {Actor} params.actor
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateInspireHeroismAvailability({ actor } = {}) {
  if (!actor) return { ok: false, reason: "No actor." };

  const combat = game?.combat ?? null;
  if (!combat?.started) {
    return { ok: false, reason: "Inspire Heroism requires active combat." };
  }

  const currentRound = Number(combat.round ?? 0);
  const lastRound = actor.getFlag(SYSTEM_ID, "inspireHeroismLastRound");
  if (lastRound === currentRound) {
    return { ok: false, reason: "Inspire Heroism has already been used this round." };
  }

  return { ok: true };
}

/**
 * Full Inspire Heroism activation workflow.
 *
 * RAW (Chapter 4): "Once per round as a Free Action, the character can make a
 * command test to inspire an ally who can perceive them. When inspired, the
 * ally gains +10 to their next combat test."
 *
 * Implementation notes:
 *  - Requires exactly 1 targeted token (not self)
 *  - Requires active combat
 *  - Once per round (tracked via actor flag)
 *  - Command skill test with configurable difficulty
 *  - On success: creates "Inspired (Heroism)" AE on target with 1-round
 *    combat duration, granting +10 to attack TN and defense TN
 *
 * @param {object} params
 * @param {Actor} params.actor - The inspiring actor
 * @param {Item} params.item - The Inspire Heroism talent item
 * @returns {Promise<boolean>} true if the effect was successfully applied
 */
export async function handleInspireHeroismActivation({ actor, item } = {}) {
  if (!actor || !item) return false;

  // --- Gate: combat check ---
  const availability = validateInspireHeroismAvailability({ actor });
  if (!availability.ok) {
    ui.notifications?.warn?.(availability.reason);
    return false;
  }

  // --- Gate: target validation ---
  const targets = [...(game.user?.targets ?? [])];
  if (targets.length === 0) {
    ui.notifications?.warn?.("Inspire Heroism: select exactly one allied target.");
    return false;
  }
  if (targets.length > 1) {
    ui.notifications?.warn?.("Inspire Heroism: select only one target.");
    return false;
  }

  const targetToken = targets[0];
  const targetActor = targetToken?.actor ?? null;
  if (!targetActor) {
    ui.notifications?.warn?.("Inspire Heroism: selected target has no actor.");
    return false;
  }
  if (targetActor.uuid === actor.uuid) {
    ui.notifications?.warn?.("Inspire Heroism: you cannot inspire yourself.");
    return false;
  }

  // --- Gate: Command skill ---
  const commandItem = actor.items?.find?.(i =>
    String(i?.type ?? "") === "skill" &&
    String(i?.name ?? "").trim().toLowerCase() === "command"
  );
  if (!commandItem) {
    ui.notifications?.warn?.(`${actor.name} does not have the Command skill.`);
    return false;
  }

  // --- Command test dialog ---
  const difficultyOptions = SKILL_DIFFICULTIES.map(d => {
    const sign = d.mod >= 0 ? "+" : "";
    const sel = d.key === "average" ? "selected" : "";
    return `<option value="${d.key}" ${sel}>${d.label} (${sign}${d.mod})</option>`;
  }).join("\n");

  let decl = null;
  try {
    decl = await customDialog({
      title: "Inspire Heroism — Command Test",
      content: `
        <div class="uesrpg-skill-roll">
          <p>Make a <b>Command</b> test to inspire <b>${foundry.utils.escapeHTML(targetActor.name)}</b>.</p>
          <div class="form-group">
            <label><b>Difficulty</b></label>
            <select name="difficultyKey" style="width:100%;">${difficultyOptions}</select>
          </div>
          <div class="form-group" style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <label style="margin:0;"><b>Manual Modifier</b></label>
            <input name="manualMod" type="number" value="0" style="width:120px;" />
          </div>
        </div>`,
      buttons: {
        ok: {
          label: "Roll",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const difficultyKey = root?.querySelector('select[name="difficultyKey"]')?.value ?? "average";
            const rawManual = root?.querySelector('input[name="manualMod"]')?.value ?? "0";
            const manualMod = Number.parseInt(String(rawManual), 10) || 0;
            return { difficultyKey, manualMod };
          }
        },
        cancel: { label: "Cancel", callback: () => null }
      },
      default: "ok",
      width: 400
    });
  } catch (_e) {
    return false;
  }

  if (!decl) return false;

  // --- Compute TN and roll ---
  const tn = computeSkillTN({
    actor,
    skillItem: commandItem,
    difficultyKey: decl.difficultyKey,
    manualMod: decl.manualMod
  });

  const res = await doTestRoll(actor, {
    rollFormula: SYSTEM_ROLL_FORMULA,
    target: tn.finalTN,
    allowLucky: true,
    allowUnlucky: true
  });

  // --- Post result to chat ---
  const degreeLine = res.isSuccess
    ? `<b style="color:green;">SUCCESS — ${formatDegree(res)}</b>`
    : `<b style="color:rgb(168, 5, 5);">FAILURE — ${formatDegree(res)}</b>`;

  const targetName = foundry.utils.escapeHTML(targetActor.name);
  const successNote = res.isSuccess
    ? `<div style="margin-top:4px;"><b>${targetName}</b> is <b>Inspired</b> — +10 to next combat test this round.</div>`
    : "";

  const flavor = `
    <div>
      <h2 style="margin:0 0 6px 0;">Inspire Heroism — Command Test</h2>
      <div><b>Target Number:</b> ${tn.finalTN}</div>
      <div style="margin-top:4px;">${degreeLine}${res.isCriticalSuccess ? ' <span style="color:green;">(CRITICAL)</span>' : ""}${res.isCriticalFailure ? ' <span style="color:red;">(CRITICAL FAIL)</span>' : ""}</div>
      ${successNote}
    </div>`;

  const rollMode = game.settings.get("core", "rollMode");
  await res.roll.toMessage({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    flags: {
      [SYSTEM_ID]: {
        inspireHeroism: {
          actorUuid: actor.uuid,
          targetActorUuid: targetActor.uuid,
          isSuccess: Boolean(res.isSuccess)
        }
      }
    },
    rollMode
  });

  // --- Track once-per-round usage (regardless of success) ---
  const combat = game.combat;
  await requestUpdateDocument(actor, {
    [`flags.${SYSTEM_ID}.inspireHeroismLastRound`]: Number(combat.round ?? 0)
  });

  // --- On success: apply AE to target ---
  if (res.isSuccess) {
    const duration = buildEffectDuration({ actor: targetActor, rounds: 1, seconds: 6, preferCombat: true });

    await createOrUpdateStatusEffect(targetActor, {
      name: "Inspired (Heroism)",
      img: item?.img ?? "icons/skills/social/diplomacy-handshake.webp",
      duration,
      flags: {
        uesrpg: {
          key: EFFECT_KEY_INSPIRE_HEROISM,
          source: "talent",
          inspirerUuid: actor.uuid
        }
      },
      changes: [
        { key: "system.modifiers.combat.attackTN", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "10", priority: 20 },
        { key: "system.modifiers.combat.defenseTN.total", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "10", priority: 20 }
      ]
    });
  }

  return res.isSuccess;
}
