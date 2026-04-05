/**
 * Resource management helpers for actor sheets (HP, AP, fatigue, rest).
 * 
 * Shared across actor sheet modules. No schema changes.
 */

import { applyShortRest, applyLongRest, buildRestChatContent } from "../../rest-workflow.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";
import { getDefaultPietyMax } from "../../../../core/religion/worship-store.js";
import { getOrthodoxFaithBonus } from "../../../../core/religion/clerical-talents.js";

function getWorshipPrimaryDomainKey(actor) {
  return String(actor?.system?.worship?.primaryDomainKey ?? "").trim().toLowerCase();
}

function getWorshipPrimaryState(actor) {
  const domainKey = getWorshipPrimaryDomainKey(actor);
  if (!domainKey) return { domainKey: "", state: null };
  const state = actor?.system?.worship?.domains?.[domainKey] ?? null;
  return { domainKey, state };
}

function getWorshipPrimaryMax(actor, domainKey, state) {
  if (state && Object.prototype.hasOwnProperty.call(state?.piety ?? {}, "max")) {
    const rawMax = Number(state?.piety?.max);
    if (Number.isFinite(rawMax)) return Math.max(0, rawMax);
  }
  return Math.max(0, getDefaultPietyMax(actor, domainKey) + getOrthodoxFaithBonus(actor, domainKey));
}

/**
 * Increment resource handler.
 * 
 * @param {Event} event - The increment event
 * @param {HTMLElement} target - The action target element
 * @returns {Promise<void>}
 */
export const onIncrementResource = asyncGuardSheet(async function onIncrementResource(event, target) {
  event.preventDefault();
  const el = target ?? event.currentTarget;
  const resourceKey = String(el?.dataset?.resource ?? "").trim();
  if (!resourceKey) return;
  const action = el.dataset.direction;

  if (resourceKey === "worship") {
    const { domainKey, state } = getWorshipPrimaryState(this.actor);
    if (!domainKey || !state) {
      ui.notifications?.warn?.("Set a primary ritual domain in Manage Piety Points first.");
      return;
    }

    const currentValue = Number(state?.piety?.value ?? 0);
    const safeCurrentValue = Number.isFinite(currentValue) ? Math.max(0, currentValue) : 0;
    const maxValue = getWorshipPrimaryMax(this.actor, domainKey, state);
    const delta = action === "increase" ? 1 : -1;
    const nextValue = Math.max(0, Math.min(maxValue, safeCurrentValue + delta));
    if (nextValue === safeCurrentValue) return;

    return requestUpdateDocument(this.actor, {
      [`system.worship.domains.${domainKey}.piety.value`]: nextValue,
    });
  }

  const resource = this.actor.system[resourceKey];
  const dataPath = `system.${resourceKey}.value`;

  // Update and increment resource
  action == "increase"
    ? await requestUpdateDocument(this.actor, { [dataPath]: resource.value + 1 })
    : await requestUpdateDocument(this.actor, { [dataPath]: resource.value - 1 });
});

/**
 * Reset/restore resource handler.
 * 
 * @param {Event} event - The reset event
 * @param {HTMLElement} target - The action target element
 * @returns {Promise<void>}
 */
export const onResetResource = asyncGuardSheet(async function onResetResource(event, target) {
  event.preventDefault();
  const el = target ?? event.currentTarget;
  const resourceLabel = el?.dataset?.resource;
  if (!resourceLabel) return;

  if (resourceLabel === "worship") {
    const { domainKey, state } = getWorshipPrimaryState(this.actor);
    if (!domainKey || !state) {
      ui.notifications?.warn?.("Set a primary ritual domain in Manage Piety Points first.");
      return;
    }

    return requestUpdateDocument(this.actor, {
      [`system.worship.domains.${domainKey}.piety.value`]: getWorshipPrimaryMax(this.actor, domainKey, state),
    });
  }

  const resource = this.actor.system?.[resourceLabel];
  if (!resource || typeof resource.max !== "number") return;
  const dataPath = `system.${resourceLabel}.value`;
  return requestUpdateDocument(this.actor, { [dataPath]: resource.max });
});

/**
 * Short rest handler.
 * 
 * @param {Event} event - The rest event
 * @param {HTMLElement} target - The action target element
 * @returns {Promise<void>}
 */
export const onShortRest = asyncGuardSheet(async function onShortRest(event, target) {
  event.preventDefault();
  if (!this.actor) return;
  if (!this.actor.isOwner && !game.user.isGM) {
    ui.notifications.warn("You do not have permission to rest this actor.");
    return;
  }

  const { line } = await applyShortRest(this.actor);
  const content = buildRestChatContent("Short Rest (1 hour)", [line]);

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: this.actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });

  await this.render(false);
  ui.notifications.info("Short rest completed.");
});

/**
 * Long rest handler.
 * 
 * @param {Event} event - The rest event
 * @param {HTMLElement} target - The action target element
 * @returns {Promise<void>}
 */
export const onLongRest = asyncGuardSheet(async function onLongRest(event, target) {
  event.preventDefault();
  if (!this.actor) return;
  if (!this.actor.isOwner && !game.user.isGM) {
    ui.notifications.warn("You do not have permission to rest this actor.");
    return;
  }

  const { line } = await applyLongRest(this.actor);
  const content = buildRestChatContent("Long Rest (8 hours)", [line]);

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: this.actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });

  await this.render(false);
  ui.notifications.info("Long rest completed.");
});

/**
 * Increment fatigue handler.
 * 
 * @param {Event} event - The increment event
 * @param {HTMLElement} target - The action target element
 * @returns {Promise<void>}
 */
export const onIncrementFatigue = asyncGuardSheet(async function onIncrementFatigue(event, target) {
  event.preventDefault();
  let element = target ?? event.currentTarget;
  let action = element.dataset.direction;
  let fatigueLevel = this.actor.system.fatigue.level;
  let fatigueBonus = this.actor.system.fatigue.bonus;

  if (action === "increase" && fatigueLevel < 5) {
    await requestUpdateDocument(this.actor, { "system.fatigue.bonus": fatigueBonus + 1 });
  } else if (action === "decrease" && fatigueLevel > 0) {
    await requestUpdateDocument(this.actor, { "system.fatigue.bonus": fatigueBonus - 1 });
  }
});

/**
 * Set resource bars helper.
 * 
 * @param {object} sheet - The actor sheet instance
 */
export function setResourceBars(sheet) {
  const data = sheet.actor.system;

  if (data) {
    for (let bar of [...sheet.form.querySelectorAll(".currentBar")]) {
      const resource = data[bar.dataset.resource];
      const resourceContainer = bar.closest(".maxBar");
      const value = Number.isFinite(Number(resource?.value))
        ? Number(resource.value)
        : Number(resourceContainer?.dataset?.value ?? bar.dataset.value);
      const max = Number.isFinite(Number(resource?.max))
        ? Number(resource.max)
        : Number(resourceContainer?.dataset?.max ?? bar.dataset.max);
      const resourceElement = sheet.form.querySelector(`#${bar.id}`);
      if (!resourceElement) continue;

      if (!Number.isFinite(max) || max <= 0) {
        resourceElement.style.width = "0%";
        continue;
      }

      let proportion = Number((100 * (value / max)).toFixed(0));

      // if greater than 100 or lower than 20, set values to fit bars correctly
      proportion < 100 ? (proportion = proportion) : (proportion = 100);
      proportion < 0 ? (proportion = 0) : (proportion = proportion);

      // Apply the proportion to the width of the resource bar
      resourceElement.style.width = `${proportion}%`;
    }
  }
}
