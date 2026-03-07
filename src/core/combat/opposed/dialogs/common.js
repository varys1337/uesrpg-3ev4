/**
 * src/core/combat/opposed/dialogs/common.js
 * Dialog prompt functions for opposed workflow
 * Extracted from opposed-workflow.js monolith (Phase 4)
 */

import { hasTalent } from "../../../traits/talents-api.js";
import { buildSpecialActionsForActor } from "../../combat-style-utils.js";
import { canTokenEscapeTemplate } from "../../../../utils/aoe-utils.js";
import { getContextAttackMode, isIsolatedDuelByTokens } from "../helpers/workflow.js";
import { _resolveToken } from "../helpers/docs.js";
import { _canControlActor } from "../helpers/util.js";
import { confirmDialog, customDialog } from "../../../../utils/dialog-v2-helper.js";
import { buildSpecialActionTooltipText, buildSpecialActionHelpText } from "../../../../data/tooltips/index.js";
import { bindItemDescriptionTooltips, clearItemDescriptionTooltip } from "../../../../ui/sheets/v2/shared/sheet-tooltips.js";
import { promptWeaponAndAdvantages as _promptWeaponAndAdvantagesImpl } from "./attacker.js";

function _escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

// ====== HELPER: EXPLOIT ADVANTAGE CHECK ======

/**
 * Check if actor can use Exploit Advantage talent (isolated duel requirement)
 */
function _canUseExploitAdvantage(actor, { actorTokenUuid = null, opponentTokenUuid = null } = {}) {
  if (!hasTalent(actor, "exploitadvantage")) return false;
  if (!actorTokenUuid || !opponentTokenUuid) return false;

  const actorToken = _resolveToken(actorTokenUuid);
  const opponentToken = _resolveToken(opponentTokenUuid);
  if (!actorToken || !opponentToken) return false;

  try {
    return isIsolatedDuelByTokens(actorToken, opponentToken) ?? false;
  } catch (_e) {
    return false;
  }
}

/**
 * List equipped weapons for an actor.
 * Falls back to ALL weapons if none are explicitly equipped (common for NPCs).
 */
function _listEquippedWeapons(actor) {
  const equipped = [];
  const all = [];
  for (const it of (actor?.items ?? [])) {
    if (!it || it.type !== "weapon") continue;
    all.push(it);
    if (it.system?.equipped === true) equipped.push(it);
  }
  if (equipped.length) return equipped;
  // Fallback: NPCs often lack explicit equipped flags — return all weapons
  if (all.length) {
    console.debug("UESRPG | _listEquippedWeapons: no weapons with equipped=true for", actor?.name, "— falling back to all weapons");
  }
  return all;
}

// ====== BASIC PROMPTS ======

/**
 * Generic Yes/No confirmation dialog
 */
export async function promptYesNo({ title, content, yesLabel = "Yes", noLabel = "No" } = {}) {
  const result = await confirmDialog({
    title: title ?? "Confirm",
    content: `<div style="min-width:340px;">${content ?? ""}</div>`,
    yesLabel,
    noLabel,
  });
  // confirmDialog returns true/false/null; coerce null (close) to false for callers
  return result === true;
}

/**
 * Token selection dialog from a list
 */
export async function promptSelectToken({ title, prompt, tokens = [] } = {}) {
  const choices = (Array.isArray(tokens) ? tokens : []).filter(t => t?.id && t?.name);
  if (choices.length === 0) return null;
  if (choices.length === 1) return choices[0];

  const options = choices
    .map(t => `<option value="${t.id}">${t.name}</option>`)
    .join("");
  const content = `
    <div style="min-width:360px;">
      <p style="margin:0 0 0.5em 0;">${prompt ?? "Select a target."}</p>
      <select name="tokenId" style="width:100%;">${options}</select>
    </div>`;

  return customDialog({
    title: title ?? "Select Target",
    content,
    buttons: {
      ok: {
        label: "OK",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const tokenId = root?.querySelector("select[name='tokenId']")?.value ?? null;
          return choices.find(t => t.id === tokenId) ?? null;
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    defaultButton: "ok",
  });
}

// ====== COMBAT-SPECIFIC PROMPTS ======

/**
 * Prompt for Unstoppable Might talent usage (special wield mode)
 */
export async function promptUnstoppableMightUsage({ actorName = "Actor", purpose = "attack" } = {}) {
  const details = purpose === "defense"
    ? "<p>If yes, Parry and Counter-Attack are unavailable while wielding this way.</p>"
    : "<p>If yes, two-handed damage will be used for this attack.</p>";
  return await promptYesNo({
    title: "Unstoppable Might",
    content: `
      <div class="uesrpg">
        <p><b>${actorName}</b> is using a special wield mode?</p>
        <ul>
          <li>Dual wielding hand-and-a-half weapons (use two-handed damage)</li>
          <li>Wielding a two-handed weapon in one hand</li>
        </ul>
        ${details}
      </div>
    `,
    yesLabel: "Using Special Wield",
    noLabel: "Normal Wield"
  });
}

/**
 * Prompt for AoE Evade escape (can defender move 1m to exit template?)
 */
export async function promptAoEEvadeEscape({ defenderName = "Defender", attackLabel = "the attack" } = {}) {
  try {
    return await confirmDialog({
      title: "AoE Evade",
      content: `<p>${defenderName} successfully evaded ${attackLabel}. Can they move 1m to exit the area?</p>`,
      yesLabel: "Escapes AoE",
      noLabel: "Still in AoE",
    });
  } catch (_e) {
    return null;
  }
}

// ====== ADVANTAGE SPENDING DIALOGS ======

/**
 * Attacker Advantage spending dialog (Weapon selection + Precision Strike, Penetrate Armor, Forceful Impact, Press Advantage, Special Actions)
 */
export async function promptWeaponAndAdvantages({
  attackerActor,
  advantageCount = 0,
  attackMode = "melee",
  defaultWeaponUuid = null,
  defaultHitLocation = "Body",
  allowNoWeapon = false,
  attackerTokenUuid = null,
  opponentTokenUuid = null,
  styleUuidForKnown = null
}) {
  return _promptWeaponAndAdvantagesImpl({
    attackerActor,
    advantageCount,
    attackMode,
    defaultWeaponUuid,
    defaultHitLocation,
    allowNoWeapon,
    attackerTokenUuid,
    opponentTokenUuid,
    styleUuidForKnown
  });
}
