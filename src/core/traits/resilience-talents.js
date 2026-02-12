/**
 * @module traits/resilience-talents
 * @description Automation helpers for Resilience talents (Chapter 4):
 *  - Die-Hard: reroll specific failed Endurance tests (handled via characteristic roll UI + shock workflow)
 *  - Unstoppable: halve passive effects of wounds (implemented as halved passive wound penalty)
 *  - Enduring: halve penalties imposed by fatigue
 *  - Iron Will: reroll specific failed Willpower tests (handled via characteristic roll UI)
 *  - Meditation: short rest option doubles MP/SP regeneration (implemented in rest workflow)
 *  - Rapid Recovery: doubled natural healing + 1d4 HP on short rest (implemented in rest workflow)
 *  - Wall of Steel: +1 AR/BR for worn armor/shields; ignore armor speed penalties where applicable
 *
 * This module is intentionally hook-free; callers wire these helpers into the existing
 * combat/wounds/rest/roll pipelines.
 */

import { hasTalent } from "./talents-api.js";
import { _canPromptForActor } from "./_primitives.js";
import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { SYSTEM_ROLL_FORMULA } from "../constants.js";

/** @private Check if actor has Wall of Steel talent. */
function hasWallOfSteel(actor) {
  return hasTalent(actor, "wallofsteel");
}

/**
 * Wall of Steel (Chapter 4): increase AR of worn armor by +1 (per armor item, per location).
 * The caller decides whether that is applied per covering item; this returns the per-item bonus.
 */
export function getWallOfSteelArmorItemBonus(actor) {
  return hasWallOfSteel(actor) ? 1 : 0;
}

/**
 * Wall of Steel (Chapter 4): increase BR of worn shields by +1.
 * Returns the additive bonus to apply to the base shield BR.
 */
export function getWallOfSteelShieldBlockBonus(actor) {
  return hasWallOfSteel(actor) ? 1 : 0;
}

/**
 * Iron Will (Chapter 4): reroll a failed Willpower test to resist Illusion magic
 * or any other form of mental manipulation/coercion. Once per test.
 *
 * RAW: "The character may reroll failed Willpower tests to resist Illusion magic
 * and any other forms of mental manipulation or coercion, but only once per test."
 *
 * The caller must gate on `isResistanceTest` (a user-supplied toggle in the dialog),
 * because the system cannot automatically know whether a WP test is for resistance purposes.
 *
 * @param {object} params
 * @param {Actor} params.actor
 * @param {string} params.chaKey - Characteristic key (e.g. "wp")
 * @param {object} params.result - doTestRoll result object (mutable)
 * @param {object} params.tn - TN computation result with `.finalTN`
 * @param {boolean} [params.isResistanceTest=false] - Whether the user declared this a resistance test
 * @returns {Promise<{rerolled: boolean, newResult?: object}>}
 */
export async function applyIronWillReroll({ actor, chaKey, result, tn, isResistanceTest = false } = {}) {
  if (chaKey !== "wp") return { rerolled: false };
  if (!isResistanceTest) return { rerolled: false };
  if (!result || result.isSuccess) return { rerolled: false };
  if (!hasTalent(actor, "ironwill")) return { rerolled: false };
  if (!_canPromptForActor(actor)) return { rerolled: false };

  const actorName = foundry.utils.escapeHTML(actor?.name ?? "Actor");
  let wants;
  try {
    wants = await Dialog.wait({
      title: "Iron Will",
      content: `<p><b>${actorName}</b> failed a Willpower resistance test. Use <b>Iron Will</b> to reroll (once per test)?</p>`,
      buttons: {
        reroll: { label: "Reroll", callback: () => true },
        keep: { label: "Keep Failure", callback: () => false }
      },
      default: "reroll",
      close: () => false
    });
  } catch (_e) {
    return { rerolled: false };
  }

  if (wants !== true) return { rerolled: false };

  const newRes = await doTestRoll(actor, {
    rollFormula: SYSTEM_ROLL_FORMULA,
    target: tn.finalTN,
    allowLucky: true,
    allowUnlucky: true
  });

  // Overwrite the caller's result in-place so downstream formatting picks up the reroll.
  result.isSuccess = newRes.isSuccess;
  result.degree = newRes.degree;
  result.textual = newRes.textual;
  result.rollTotal = newRes.rollTotal;
  result.roll = newRes.roll;
  result.isCriticalSuccess = newRes.isCriticalSuccess;
  result.isCriticalFailure = newRes.isCriticalFailure;
  result.uesrpgIronWillReroll = true;

  return { rerolled: true, newResult: newRes };
}

