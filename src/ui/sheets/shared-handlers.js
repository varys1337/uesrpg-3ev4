import { executeItemActivation, executeItemMacroBestEffort } from "../../core/system/activation/activation-executor.js";

/**
 * Shared sheet handler utilities.
 * These functions are used across multiple sheet types to reduce code duplication.
 */

function _buildDefaultPostContent({ item, actor, includeImage }) {
  if (includeImage) {
    // Actor sheet format: image inside <h2>, no <p> after </h2>
    return `<h2><img src="${item.img}" />${item.name}</h2>
    <i><b>${item.type}</b></i><p>
      <i>${item.system.description}</i>`;
  }
  // NPC/Merchant sheet format: <p> directly after </h2> on same line
  return `<h2>${item.name}</h2><p>
  <i><b>${item.type}</b></i><p>
    <i>${item.system.description}</i>`;
}

/**
 * Post a standardized Activated Talent chat card and optionally spend costs.
 * Returns true if the activation succeeded (chat posted), false if it was blocked.
 */
async function postActivatedTalentToChat({ item, actor, includeImage = false, event = null } = {}) {
  if (!item) return false;
  const result = await executeItemActivation({ item, actor, includeImage, event });
  return Boolean(result?.ok);
}

/**
 * Post a standardized Activated Power chat card and optionally spend costs/uses.
 * Returns true if the activation succeeded (chat posted), false if it was blocked.
 */
async function postActivatedPowerToChat({ item, actor, includeImage = false, event = null } = {}) {
  if (!item) return false;
  const result = await executeItemActivation({ item, actor, includeImage, event });
  return Boolean(result?.ok);
}

/**
 * Item-sheet entry point: activate the currently opened Talent item.
 * Always routes through executeItemActivation so that feature effects,
 * automation, and macros run regardless of activation.enabled state.
 */
export async function activateTalentFromItemSheet({ item, event = null } = {}) {
  if (!item || item.type !== "talent") return;
  const actor = item.actor ?? null;
  await executeItemActivation({ item, actor, includeImage: true, event });
}

/**
 * Item-sheet entry point: activate the currently opened Power item.
 * Always routes through executeItemActivation so that feature effects,
 * automation, and macros run regardless of activation.enabled state.
 */
export async function activatePowerFromItemSheet({ item, event = null } = {}) {
  if (!item || item.type !== "power") return;
  const actor = item.actor ?? null;
  await executeItemActivation({ item, actor, includeImage: true, event });
}

/**
 * Item-sheet entry point: activate the currently opened Trait item.
 * Always routes through executeItemActivation so that feature effects,
 * automation, and macros run regardless of activation.enabled state.
 */
export async function activateTraitFromItemSheet({ item, event = null } = {}) {
  if (!item || item.type !== "trait") return;
  const actor = item.actor ?? null;
  await executeItemActivation({ item, actor, includeImage: true, event });
}

/**
 * Post a talent/trait/power item's description to chat.
 * This is the shared implementation of _onTalentRoll across sheet types.
 *
 * When the item is a Talent configured as an Activated Talent, it posts an activation card and
 * can optionally spend resources before posting.
 *
 * @param {Event} event - The click event
 * @param {Actor} actor - The actor document
 * @param {Object} options - Optional configuration
 * @param {boolean} [options.includeImage=false] - Whether to include the item image in the header
 */
export async function postItemToChat(event, actor, options = {}) {
  event.preventDefault();

  const { includeImage = false, element } = options;

  // The initiating element may be inside <li class="item"> or a <tr data-item-id="..."> depending on the sheet template.
  // Resolve the embedded Item id defensively from the nearest ancestor that declares it.
  // In AppV2 delegated actions, event.currentTarget is the app root — use the explicit element when provided.
  const el = element ?? event.currentTarget;
  const itemEl = el.closest("[data-item-id]") ?? el.closest(".item");
  const itemId = itemEl?.dataset?.itemId;

  if (!itemId) {
    console.warn("uesrpg-3ev4 | postItemToChat: No itemId found on element");
    return;
  }

  const item = actor?.items?.get?.(itemId) ?? actor?.getEmbeddedDocument?.("Item", itemId);

  if (!item) {
    console.warn(`uesrpg-3ev4 | postItemToChat: Item ${itemId} not found on actor ${actor?.name ?? "UNKNOWN"}`);
    return;
  }

  // Feature types (trait/talent/power): always route through the activation
  // engine so that feature effects, automation, and macros run regardless
  // of activation.enabled state.  The executor handles the activation.enabled
  // gate internally — skipping costs/usage when not enabled while still
  // running effect transfer and automation.
  const _featureTypes = new Set(["trait", "talent", "power"]);
  if (_featureTypes.has(item.type)) {
    await executeItemActivation({ item, actor, includeImage, event });
    return;
  }

  // Non-feature items: use activation.enabled gate as before.
  if (item?.system?.activation?.enabled) {
    const ok = await executeItemActivation({ item, actor, includeImage, event });
    if (!ok?.ok) return;
    return;
  }

  const contentString = _buildDefaultPostContent({ item, actor, includeImage });
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: contentString,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });

  await executeItemMacroBestEffort(item, { event });
}
