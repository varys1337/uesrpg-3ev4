/**
 * Resource management helpers for actor sheets (HP, AP, fatigue, rest).
 * 
 * Foundry VTT v13 / AppV1-compatible. No schema changes.
 */

import { applyShortRest, applyLongRest, buildRestChatContent } from "../../rest-workflow.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";

/**
 * Increment resource handler.
 * 
 * @param {SimpleActorSheet} sheet - The actor sheet instance
 * @param {Event} event - The increment event
 * @returns {Promise<void>}
 */
export async function onIncrementResource(sheet, event) {
  event.preventDefault();
  const resource = sheet.actor.system[event.currentTarget.dataset.resource];
  const action = event.currentTarget.dataset.action;
  let dataPath = `system.${event.currentTarget.dataset.resource}.value`;

  // Update and increment resource
  action == "increase"
    ? await requestUpdateDocument(sheet.actor, { [dataPath]: resource.value + 1 })
    : await requestUpdateDocument(sheet.actor, { [dataPath]: resource.value - 1 });
}

/**
 * Reset/restore resource handler.
 * 
 * @param {SimpleActorSheet} sheet - The actor sheet instance
 * @param {Event} event - The reset event
 * @returns {Promise<void>}
 */
export async function onResetResource(sheet, event) {
  event.preventDefault();
  const resourceLabel = event.currentTarget?.dataset?.resource;
  if (!resourceLabel) return;
  const resource = sheet.actor.system?.[resourceLabel];
  if (!resource || typeof resource.max !== "number") return;
  const dataPath = `system.${resourceLabel}.value`;
  return requestUpdateDocument(sheet.actor, { [dataPath]: resource.max });
}

/**
 * Short rest handler.
 * 
 * @param {SimpleActorSheet} sheet - The actor sheet instance
 * @param {Event} event - The rest event
 * @returns {Promise<void>}
 */
export async function onShortRest(sheet, event) {
  event.preventDefault();
  if (!sheet.actor) return;
  if (!sheet.actor.isOwner && !game.user.isGM) {
    ui.notifications.warn("You do not have permission to rest this actor.");
    return;
  }

  const { line } = await applyShortRest(sheet.actor);
  const content = buildRestChatContent("Short Rest (1 hour)", [line]);

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: sheet.actor }),
    content
  });

  await sheet.render(false);
  ui.notifications.info("Short rest completed.");
}

/**
 * Long rest handler.
 * 
 * @param {SimpleActorSheet} sheet - The actor sheet instance
 * @param {Event} event - The rest event
 * @returns {Promise<void>}
 */
export async function onLongRest(sheet, event) {
  event.preventDefault();
  if (!sheet.actor) return;
  if (!sheet.actor.isOwner && !game.user.isGM) {
    ui.notifications.warn("You do not have permission to rest this actor.");
    return;
  }

  const { line } = await applyLongRest(sheet.actor);
  const content = buildRestChatContent("Long Rest (8 hours)", [line]);

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: sheet.actor }),
    content
  });

  await sheet.render(false);
  ui.notifications.info("Long rest completed.");
}

/**
 * Increment fatigue handler.
 * 
 * @param {SimpleActorSheet} sheet - The actor sheet instance
 * @param {Event} event - The increment event
 * @returns {Promise<void>}
 */
export async function onIncrementFatigue(sheet, event) {
  event.preventDefault();
  let element = event.currentTarget;
  let action = element.dataset.action;
  let fatigueLevel = sheet.actor.system.fatigue.level;
  let fatigueBonus = sheet.actor.system.fatigue.bonus;

  if (action === "increase" && fatigueLevel < 5) {
    await requestUpdateDocument(sheet.actor, { "system.fatigue.bonus": fatigueBonus + 1 });
  } else if (action === "decrease" && fatigueLevel > 0) {
    await requestUpdateDocument(sheet.actor, { "system.fatigue.bonus": fatigueBonus - 1 });
  }
}

/**
 * Set resource bars helper.
 * 
 * @param {SimpleActorSheet} sheet - The actor sheet instance
 */
export function setResourceBars(sheet) {
  const data = sheet.actor.system;

  if (data) {
    for (let bar of [...sheet.form.querySelectorAll(".currentBar")]) {
      let resource = data[bar.dataset.resource];

      if (resource.max !== 0) {
        let resourceElement = sheet.form.querySelector(`#${bar.id}`);
        let proportion = Number(
          (100 * (resource.value / resource.max)).toFixed(0)
        );

        // if greater than 100 or lower than 20, set values to fit bars correctly
        proportion < 100 ? (proportion = proportion) : (proportion = 100);
        proportion < 0 ? (proportion = 0) : (proportion = proportion);

        // Apply the proportion to the width of the resource bar
        resourceElement.style.width = `${proportion}%`;
      }
    }
  }
}
