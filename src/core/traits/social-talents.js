import { renderTNSummary, bindTNEstimates } from "../../ui/shared/tn-presentation.js";
import { escapeHtml } from "../../utils/html.js";
/**
 * @module traits/social-talents
 * @description Automation helpers for Social talents (Chapter 4):
 *  - Inspire Heroism: once per round as Free Action, Command test to inspire
 *    an ally; target gains +10 to their next combat test.
 *
 * This module is intentionally hook-free; the activation executor dispatches
 * here via `runTalentActivationAutomation()`.
 */

import { getActorCanvasToken } from "./combat-proximity.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "../skills/skill-tn.js";
import { doTestRoll, formatResultSummary } from "../../utils/degree-roll-helper.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";
import { SYSTEM_ROLL_FORMULA } from "../constants.js";
import { requestAtomicUpdateDocument } from "../../utils/authority-proxy.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { SYSTEM_ID } from "../system/namespace.js";
import { getFlagValueWithFallback } from "../system/flags.js";
import { getTargetsFromContext } from "../system/activation/helpers.js";

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
  const lastCombatId = actor.getFlag(SYSTEM_ID, "inspireHeroismLastCombatId");
  if (lastRound === currentRound && (!lastCombatId || lastCombatId === combat.id)) {
    return { ok: false, reason: lastCombatId
      ? "Inspire Heroism has already been used this round."
      : "Inspire Heroism has a legacy round record without an encounter ID. A GM must review it before this round's use." };
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
 *  - Requires exactly 1 targeted allied token (not self)
 *  - Requires active combat
 *  - Once per round (tracked via actor flag)
 *  - Command skill test with configurable difficulty
 *  - On success: instructs the group to apply +10 to the next combat test
 *    manually, without a timed effect or an automatically repeated bonus
 *
 * @param {object} params
 * @param {Actor} params.actor - The inspiring actor
 * @param {Item} params.item - The Inspire Heroism talent item
 * @param {object} [params.context] - Activation context with the selected targets
 * @returns {Promise<boolean>} true when the Command test and its usage record were resolved
 */
export async function handleInspireHeroismActivation({ actor, item, context = {} } = {}) {
  if (!actor || !item) return false;

  // --- Gate: combat check ---
  const availability = validateInspireHeroismAvailability({ actor });
  if (!availability.ok) {
    ui.notifications?.warn?.(availability.reason);
    return false;
  }
  const actionCombatId = game.combat.id;
  const actionRound = Number(game.combat.round ?? 0);
  const sameCombatRound = () => game.combat?.started === true && game.combat.id === actionCombatId
    && Number(game.combat.round ?? 0) === actionRound;

  // --- Gate: target validation ---
  const targets = getTargetsFromContext(context);
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
  const activatorToken = getActorCanvasToken(actor);
  if (!activatorToken) {
    ui.notifications?.warn?.("Inspire Heroism: the inspiring actor must have a token on the canvas.");
    return false;
  }
  if (targetActor.uuid === actor.uuid) {
    ui.notifications?.warn?.("Inspire Heroism: you cannot inspire yourself.");
    return false;
  }
  const activatorDisposition = Number(activatorToken?.document?.disposition ?? NaN);
  const targetDisposition = Number(targetToken?.document?.disposition ?? NaN);
  if (!Number.isFinite(activatorDisposition) || !Number.isFinite(targetDisposition) || activatorDisposition === 0 || activatorDisposition !== targetDisposition) {
    ui.notifications?.warn?.("Inspire Heroism: target must be an allied token.");
    return false;
  }
  if ((targetActor.effects ?? []).some(effect => !effect.disabled
    && getFlagValueWithFallback(effect, "key") === EFFECT_KEY_INSPIRE_HEROISM)) {
    ui.notifications?.warn?.("Inspire Heroism: the target has an older Inspired effect. Ask the GM to review it and any pending outcome before using this ability.");
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
    return `<option value="${d.key}" ${sel}>${escapeHtml(d.label)} (${sign}${d.mod})</option>`;
  }).join("\n");

  const readDeclaration = (root) => {
    const difficultyKey = root?.querySelector('select[name="difficultyKey"]')?.value ?? "average";
    const rawManual = root?.querySelector('input[name="manualMod"]')?.value ?? "0";
    const manualMod = Number.parseInt(String(rawManual), 10) || 0;
    return { difficultyKey, manualMod };
  };

  const computeDeclaredTN = (decl) => computeSkillTN({
    actor,
    skillItem: commandItem,
    difficultyKey: decl.difficultyKey,
    manualMod: decl.manualMod
  });

  let decl = null;
  try {
    decl = await customDialog({
      layout: "workflow",
      title: "Inspire Heroism — Command Test",
      render: (_event, dialog) => bindTNEstimates(dialog.element, () => computeDeclaredTN(readDeclaration(dialog.element))),
      content: `
        <div class="uesrpg-skill-roll">
          ${renderTNSummary(commandItem.name)}
          <p>Make a <b>Command</b> test to inspire <b>${foundry.utils.escapeHTML(targetActor.name)}</b>. Confirm the ally can perceive the character. On success, track and apply the next combat test bonus manually.</p>
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
          callback: (html) => readDeclaration(html instanceof HTMLElement ? html : html?.[0])
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
  if (!sameCombatRound()) {
    ui.notifications?.warn?.("The combat or round changed while preparing Inspire Heroism. Start the action again.");
    return false;
  }

  // --- Compute TN and roll ---
  const tn = computeDeclaredTN(decl);

  const res = await doTestRoll(actor, {
    rollFormula: SYSTEM_ROLL_FORMULA,
    target: tn.finalTN,
    allowLucky: true,
    allowUnlucky: true
  });

  // --- Post result to chat ---
  const summaryText = formatResultSummary(res, { uppercase: true, includeDegree: true, degreeStyle: "dash" });
  const degreeLine = res.isSuccess
    ? `<b style="color:green;">${summaryText}</b>`
    : `<b style="color:rgb(168, 5, 5);">${summaryText}</b>`;

  const targetName = foundry.utils.escapeHTML(targetActor.name);
  const successNote = res.isSuccess
    ? `<div style="margin-top:4px;"><b>${targetName}</b> gains +10 to their next combat test. Track and apply this bonus manually once; no effect is created automatically.</div>`
    : "";

  const flavor = `
    <div>
      <h2 style="margin:0 0 6px 0;">Inspire Heroism — Command Test</h2>
      <div><b>Target Number:</b> ${tn.finalTN}</div>
      <div style="margin-top:4px;">${degreeLine}</div>
      ${successNote}
    </div>`;

  const rollMode = getCoreRollMode();
  try {
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
  } catch (err) {
    ui.notifications?.warn?.("The Command roll could not be confirmed in chat. Review the chat and actor before retrying Inspire Heroism.");
    throw err;
  }

  // --- Track once-per-round usage (regardless of success) ---
  const usageWarning = "The Command roll was posted, but Inspire Heroism usage was not confirmed. Review the chat, combat and actor before retrying.";
  let usageSaved;
  try {
    usageSaved = await requestAtomicUpdateDocument(actor, fresh => {
      if (!sameCombatRound() || !validateInspireHeroismAvailability({ actor: fresh }).ok) return null;
      return {
        [`flags.${SYSTEM_ID}.inspireHeroismLastRound`]: actionRound,
        [`flags.${SYSTEM_ID}.inspireHeroismLastCombatId`]: actionCombatId
      };
    });
  } catch (err) {
    ui.notifications?.warn?.(usageWarning);
    throw err;
  }
  if (!usageSaved) {
    ui.notifications?.warn?.(usageWarning);
    throw new Error(usageWarning);
  }

  // A failed Command test is still a completed use, not an activation error.
  return true;
}
