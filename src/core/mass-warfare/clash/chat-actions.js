/**
 * src/core/mass-warfare/clash/chat-actions.js
 *
 * Registers renderChatMessageHTML and updateChatMessage hooks for
 * Warfare Clash chat cards. Called once during system init via registerChat().
 *
 * Pattern mirrors src/core/combat/chat-handlers/combat-chat-register.js:
 *  - Guard booleans prevent double-registration
 *  - Detect clash cards by flag presence
 *  - Delegate "commit-stance" button clicks to handleClashCommit
 *  - Detect autoRollRequested in updateChatMessage → maybeAutoRollClash
 */

import { SYSTEM_ID } from "../../../core/constants.js";
import { CLASH_FLAG_KEY } from "./pending.js";
import { handleClashCommit } from "./commit.js";
import { maybeAutoRollClash } from "./auto-roll.js";

let _renderHookRegistered = false;
let _updateHookRegistered = false;

/**
 * Register all Warfare Clash chat hooks.
 * Called once from registerChat() in src/hooks/init/register-chat.js.
 */
export function registerClashChatActions() {
  _registerRenderHook();
  _registerUpdateHook();
}

function _registerRenderHook() {
  if (_renderHookRegistered) return;
  _renderHookRegistered = true;

  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = _resolveRoot(html);
    if (!root) return;
    if (!_isClashCard(message)) return;

    // Delegated listener — one handler per card, not per button
    root.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-ues-warfare-clash-action]");
      if (!btn) return;

      const action  = btn.dataset.uesWarfareClashAction;
      const msgId   = btn.dataset.clashMessageId;
      const unitKey = btn.dataset.clashUnit;

      if (action !== "commit-stance" || !msgId || !unitKey) return;

      ev.preventDefault();
      ev.stopPropagation();

      const msg = game.messages.get(msgId);
      if (!msg) return;

      handleClashCommit(msg, unitKey).catch((err) => {
        console.error("UESRPG | handleClashCommit failed", err);
      });
    });
  });
}

function _registerUpdateHook() {
  if (_updateHookRegistered) return;
  _updateHookRegistered = true;

  Hooks.on("updateChatMessage", (message, _changes) => {
    if (!_isClashCard(message)) return;

    maybeAutoRollClash(message).catch((err) => {
      console.error("UESRPG | maybeAutoRollClash hook error", err);
    });
  });
}

function _isClashCard(message) {
  return Boolean(message?.flags?.[SYSTEM_ID]?.[CLASH_FLAG_KEY]);
}

/**
 * Normalize the html parameter from renderChatMessageHTML to an HTMLElement.
 * Handles both raw Element (v13) and jQuery array.
 *
 * @param {HTMLElement|DocumentFragment|jQuery} html
 * @returns {HTMLElement|null}
 */
function _resolveRoot(html) {
  if (html instanceof HTMLElement) return html;
  if (html instanceof DocumentFragment) return html;
  if (html?.length) return html[0]; // jQuery fallback
  return null;
}
