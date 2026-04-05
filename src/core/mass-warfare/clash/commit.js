/**
 * src/core/mass-warfare/clash/commit.js
 *
 * Handles a single unit's stance commitment for the Warfare Clash flow.
 *
 * Mirrors the opposed test "lane commit" pattern:
 *  - Opens a per-unit dialog (role + joinFray choice + modifier + feature toggles)
 *  - Re-reads the LIVE flag state after dialog close (race condition safety)
 *  - Merges only the committing unit's lane (preserves concurrent sibling commits)
 *  - Sets autoRollRequested when both sides are now committed
 */

import { SYSTEM_ID } from "../../../core/constants.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { safeUpdateChatMessage } from "../../../utils/chat-message-socket.js";
import { CLASH_FLAG_KEY, readClashState } from "./pending.js";
import { renderClashCard } from "./card.js";
import { CATEGORIES } from "../profiles/uesrpg-0_2.js";
import { WARFARE_EFFECT_KEYS, hasWarfareActionEffect } from "../actions.js";
import { resolveWarfareUnitReference } from "../condition-target.js";

/**
 * Show a stance dialog for one unit and commit the choices to the ChatMessage.
 *
 * Can be called by the unit's owner or any GM.
 *
 * @param {ChatMessage} message
 * @param {"unit1"|"unit2"} unitKey
 * @returns {Promise<void>}
 */
export async function handleClashCommit(message, unitKey) {
  const snapshot = readClashState(message);
  if (!snapshot) return;

  if (snapshot.phase === "resolved") return;

  const unit = snapshot[unitKey];
  if (!unit) return;

  if (unit.banked.committed) {
    ui.notifications.info(`${unit.actorName} has already committed their stance.`);
    return;
  }

  // Resolve actor to get unit type features for the dialog
  const { actor } = await resolveWarfareUnitReference({
    actorId: unit.actorId,
    actorUuid: unit.actorUuid,
    tokenUuid: unit.tokenUuid,
    sceneId: unit.sceneId,
  });
  const categoryKey = String(actor?.system?._derived?.categoryKey ?? "").toLowerCase();
  const category = CATEGORIES[categoryKey] ?? null;
  const clashFeatures = (category?.features ?? []).filter(f => f.appliesInClash);

  // Resolve sibling actor to show context (e.g. is opponent ranged?)
  const siblingKey = unitKey === "unit1" ? "unit2" : "unit1";
  const siblingUnit = snapshot[siblingKey] ?? {};
  const siblingRef = siblingUnit.actorId || siblingUnit.actorUuid || siblingUnit.tokenUuid
    ? await resolveWarfareUnitReference({
        actorId: siblingUnit.actorId,
        actorUuid: siblingUnit.actorUuid,
        tokenUuid: siblingUnit.tokenUuid,
        sceneId: siblingUnit.sceneId,
      })
    : null;
  const siblingActor = siblingRef?.actor ?? null;
  const siblingCategoryKey = String(siblingActor?.system?._derived?.categoryKey ?? "").toLowerCase();
  const siblingCategory = CATEGORIES[siblingCategoryKey] ?? null;
  const opponentIsRanged = Boolean(siblingCategory?.isRangedUnit);

  // Show per-unit stance dialog
  const forceJoinFray = hasWarfareActionEffect(actor, WARFARE_EFFECT_KEYS.JOIN_FRAY_NEXT_CLASH);
  const choices = await _showCommitDialog(unit.actorName, clashFeatures, opponentIsRanged, {
    forceJoinFray,
    initialState: unit,
    lockBattlefieldMetadata: Boolean(snapshot?.clashGroupId),
  });
  if (!choices || typeof choices !== "object") return; // cancelled

  // Re-read LIVE flag state after the dialog to catch concurrent sibling commits
  const fresh = readClashState(message) ?? snapshot;

  if (fresh.phase === "resolved") return;

  if (fresh[unitKey]?.banked?.committed) {
    ui.notifications.info(`${unit.actorName}'s stance was already committed.`);
    return;
  }

  // Apply this lane's choices
  fresh[unitKey].role              = choices.role;
  fresh[unitKey].joinFray          = choices.joinFray;
  fresh[unitKey].modifier          = choices.modifier ?? 0;
  fresh[unitKey].charged           = Boolean(choices.charged);
  fresh[unitKey].incomingChargeSide = choices.incomingChargeSide ?? "none";
  fresh[unitKey].features          = choices.features ?? {};
  fresh[unitKey].banked.committed  = true;
  fresh[unitKey].banked.committedAt = Date.now();
  fresh[unitKey].banked.committedBy = game.user.id;

  // Trigger auto-roll when the sibling is also committed
  if (fresh[siblingKey]?.banked?.committed) {
    fresh.autoRollRequested = true;
  }

  const content = renderClashCard(fresh, message.id);
  await safeUpdateChatMessage(message, {
    content,
    flags: { [SYSTEM_ID]: { [CLASH_FLAG_KEY]: fresh } },
  });
}

/**
 * Build the HTML content for the clash commit dialog.
 * Layout: stance select (3 options) + one row of inline toggles (joinFray + feature).
 *
 * @param {string}            unitName
 * @param {CategoryFeature[]} clashFeatures — features from this unit's category that apply in clash
 * @param {boolean}           opponentIsRanged — whether opponent is a ranged unit (pre-checks halfRangedDamage)
 * @returns {string}
 */
function _buildCommitDialogContent(unitName, clashFeatures, opponentIsRanged, {
  forceJoinFray = false,
  initialState = {},
  lockBattlefieldMetadata = false,
} = {}) {
  const featureToggles = clashFeatures.map(f => {
    const checked = (f.id === "halfRangedDamage" && opponentIsRanged) ? "checked" : "";
    return `<label class="warfare-clash-toggle" title="${f.description}">
      <input type="checkbox" name="feature-${f.id}" ${checked}>
      ${f.label}${f.isPassive ? " <span style='color:#888;font-size:0.75em;'>(passive)</span>" : ""}
    </label>`;
  }).join("");
  const metadataRows = lockBattlefieldMetadata ? `
      <div class="form-group">
        <label><b>Charge State</b></label>
        <div class="notes">${initialState?.charged ? "This unit counts as Charging." : "This unit is not Charging."}</div>
      </div>
      <div class="form-group">
        <label><b>Contact Side</b></label>
        <div class="notes">${String(initialState?.contactSide ?? "front").trim() || "front"}</div>
      </div>
      <div class="form-group">
        <label><b>Incoming Charge</b></label>
        <div class="notes">${String(initialState?.incomingChargeSide ?? "none").trim() || "none"}</div>
      </div>
      ${initialState?.commanderJoinFray?.name ? `<div class="form-group"><label><b>Commander Join the Fray</b></label><div class="notes">${initialState.commanderJoinFray.name} is already attached to this clash.</div></div>` : ""}`
    : `
      <div class="form-group">
        <label><input type="checkbox" name="charged" ${initialState?.charged ? "checked" : ""}> This unit successfully charged</label>
      </div>
      <div class="form-group">
        <label>Incoming Charge Side</label>
        <select name="incomingChargeSide">
          <option value="none" ${String(initialState?.incomingChargeSide ?? "none") === "none" ? "selected" : ""}>None</option>
          <option value="front" ${String(initialState?.incomingChargeSide ?? "none") === "front" ? "selected" : ""}>Front</option>
          <option value="flank" ${String(initialState?.incomingChargeSide ?? "none") === "flank" ? "selected" : ""}>Flank</option>
          <option value="rear" ${String(initialState?.incomingChargeSide ?? "none") === "rear" ? "selected" : ""}>Rear</option>
        </select>
      </div>`;

  return `
    <div class="warfare-clash-commit-dialog">
      <div class="form-group">
        <label>Stance</label>
        <select name="role">
          <option value="attack" ${String(initialState?.role ?? "attack") === "attack" ? "selected" : ""}>Attacking</option>
          <option value="defend" ${String(initialState?.role ?? "attack") === "defend" ? "selected" : ""}>Defending</option>
          <option value="none" ${String(initialState?.role ?? "attack") === "none" ? "selected" : ""}>No Stance</option>
        </select>
      </div>
      <div class="form-group">
        <label>Modifier</label>
        <input type="number" name="modifier" value="${Number(initialState?.modifier ?? 0) || 0}" style="width:90px;">
        <p class="notes">Flat Discipline TN modifier for this clash only.</p>
      </div>
      ${metadataRows}
      <div class="warfare-clash-toggles">
        <label class="warfare-clash-toggle">
          <input type="checkbox" name="joinFray" ${initialState?.joinFray || forceJoinFray ? "checked" : ""} ${(forceJoinFray || initialState?.commanderJoinFray) ? "disabled" : ""}>
          Join the Fray
        </label>
        ${featureToggles}
      </div>
    </div>`;
}

/**
 * Show a small dialog for a unit owner to choose their stance.
 *
 * @param {string}            unitName
 * @param {CategoryFeature[]} clashFeatures
 * @param {boolean}           opponentIsRanged
 * @returns {Promise<{role: string, joinFray: boolean, modifier: number, charged: boolean, incomingChargeSide: string, features: object}|null>}
 */
async function _showCommitDialog(unitName, clashFeatures, opponentIsRanged, {
  forceJoinFray = false,
  initialState = {},
  lockBattlefieldMetadata = false,
} = {}) {
  return customDialog({
    title: `${unitName} — Choose Stance`,
    content: _buildCommitDialogContent(unitName, clashFeatures, opponentIsRanged, {
      forceJoinFray,
      initialState,
      lockBattlefieldMetadata,
    }),
    buttons: {
      confirm: {
        label: "Commit Stance",
        callback: (html) => {
          const features = {};
          for (const f of clashFeatures) {
            const cb = html.querySelector(`[name="feature-${f.id}"]`);
            if (cb) features[f.id] = cb.checked;
          }
          return {
            role:     html.querySelector('[name="role"]').value,
            joinFray: initialState?.commanderJoinFray ? false : html.querySelector('[name="joinFray"]').checked,
            modifier: Number(html.querySelector('[name="modifier"]')?.value ?? 0) || 0,
            charged: lockBattlefieldMetadata
              ? Boolean(initialState?.charged)
              : Boolean(html.querySelector('[name="charged"]')?.checked),
            incomingChargeSide: lockBattlefieldMetadata
              ? (initialState?.incomingChargeSide ?? "none")
              : (html.querySelector('[name="incomingChargeSide"]')?.value ?? "none"),
            features,
          };
        },
      },
      cancel: { label: "Cancel" },
    },
    defaultButton: "confirm",
  });
}
