/**
 * src/core/conditions/in-close.js
 *
 * "In Close" pairwise token-flag condition (Homebrew — Reach & Length Overhaul).
 *
 * Extracted from status-hud.js to isolate this distinct subsystem.
 * status-hud.js re-exports pruneInClosePair and toggleInCloseForActor for
 * backward compatibility with existing external importers.
 *
 * No behavior changes from the original status-hud.js implementation.
 */

import { toggleCondition, hasCondition } from "./condition-engine.js";
import { measureTokenDistance } from "../combat/opposed/range.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { alertDialog, customDialog } from "../../utils/dialog-v2-helper.js";
import { isReachLengthHomebrewEnabled } from "../homebrew/reach-length/weapon.js";
import { isDebugEnabled } from "../../utils/debug.js";
import { FLAG_SCOPE } from "./constants.js";
import { createUuidResolver } from "../../utils/uuid-cache.js";

/**
 * Activate In Close for a token, selecting a partner from nearby tokens.
 * Partner selection priority:
 *  1. Exactly one targeted token within 1 m
 *  2. Exactly one candidate within 1 m
 *  3. Multiple candidates → DialogV2 chooser
 *
 * @param {Token} tokenPlaceable - The token placeable on the canvas
 * @param {TokenDocument} tokenDoc
 * @param {Actor} actor
 */
export async function activateInClose(tokenPlaceable, tokenDoc, actor) {
  if (!tokenPlaceable) return;

  // Gather all tokens on canvas within 1 m (excluding self)
  const allTokens = canvas?.tokens?.placeables ?? [];
  const candidates = [];
  for (const t of allTokens) {
    if (t.document.id === tokenDoc.id) continue;
    const dist = measureTokenDistance(tokenPlaceable, t);
    if (dist != null && dist <= 1) candidates.push({ token: t, dist });
  }

  if (isDebugEnabled()) {
    console.log("UESRPG | In Close activate: candidates", candidates.map(c => `${c.token.name} (${c.dist}m)`));
  }

  if (!candidates.length) {
    await alertDialog({
      title: "In Close",
      content: "<p>No tokens are within 1 m to enter In Close with.</p>",
    });
    return;
  }

  let partnerToken = null;

  if (candidates.length === 1) {
    partnerToken = candidates[0].token;
  } else {
    // Prefer exactly one targeted token among candidates
    const targeted = candidates.filter(c => game.user.targets.has(c.token));
    if (targeted.length === 1) {
      partnerToken = targeted[0].token;
    } else {
      // Show chooser dialog
      const rows = candidates
        .map(c => `<div class="in-close-choice"><label><input type="radio" name="inClosePartner" value="${c.token.id}"> ${c.token.name} (${c.dist} m)</label></div>`)
        .join("");
      const content = `<p>Select the token to enter In Close with:</p>${rows}`;
      const chosen = await customDialog({
        layout: "workflow",
        title: "In Close — Select Partner",
        content,
        buttons: [
          { label: "Confirm", value: "confirm", icon: "fas fa-check" },
          { label: "Cancel", value: "cancel", icon: "fas fa-times" },
        ],
        defaultButton: "confirm",
      });
      if (chosen !== "confirm") return;
      const form = document.querySelector("dialog .in-close-choice input[name='inClosePartner']:checked");
      const chosenId = form?.value;
      if (!chosenId) return;
      const found = candidates.find(c => c.token.id === chosenId);
      if (!found) return;
      partnerToken = found.token;
    }
  }

  if (!partnerToken) return;

  const partnerDoc = partnerToken.document;

  // Set pairwise flags on both tokens
  const myCurrent = tokenDoc.getFlag(FLAG_SCOPE, "reachLength.inCloseWith") ?? {};
  await tokenDoc.setFlag(FLAG_SCOPE, "reachLength.inCloseWith", { ...myCurrent, [partnerDoc.uuid]: true });

  const partnerCurrent = partnerDoc.getFlag(FLAG_SCOPE, "reachLength.inCloseWith") ?? {};
  await requestUpdateDocument(partnerDoc, {
    [`flags.${FLAG_SCOPE}.reachLength.inCloseWith`]: { ...partnerCurrent, [tokenDoc.uuid]: true }
  });

  // Apply inclose condition to both actors
  await toggleCondition(actor, "inclose", { origin: null, source: "In Close" });
  const partnerActor = partnerDoc.actor;
  if (partnerActor && !hasCondition(partnerActor, "inclose")) {
    await toggleCondition(partnerActor, "inclose", { origin: null, source: "In Close" });
  }

  if (isDebugEnabled()) {
    console.log("UESRPG | In Close activated:", tokenDoc.name, "↔", partnerDoc.name);
  }
}

/**
 * Deactivate In Close for a token, cleaning up pairwise flags on all linked partners.
 *
 * @param {TokenDocument} tokenDoc
 * @param {Actor} actor
 */
export async function deactivateInClose(tokenDoc, actor) {
  const inCloseWith = tokenDoc.getFlag(FLAG_SCOPE, "reachLength.inCloseWith") ?? {};
  const uuidResolver = createUuidResolver();

  for (const [partnerUuid] of Object.entries(inCloseWith)) {
    const partnerDoc = uuidResolver.resolveSync(partnerUuid);
    if (!partnerDoc) continue;
    await _pruneInClosePair(tokenDoc, partnerDoc);
  }

  if (isDebugEnabled()) {
    console.log("UESRPG | In Close deactivated:", tokenDoc.name);
  }
}

/**
 * Remove the In Close pair link between two token documents.
 * Removes condition from each actor whose inCloseWith map becomes empty after removal.
 *
 * @param {TokenDocument} docA
 * @param {TokenDocument} docB
 */
export async function pruneInClosePair(docA, docB) {
  return _pruneInClosePair(docA, docB);
}

/**
 * Toggle the In Close state for an actor from the actor sheet combat actions panel.
 *
 * Finds the actor's token on the canvas (prefers the controlled token, falls back
 * to any token for that actor), then activates or deactivates In Close.
 *
 * @param {Actor} actor
 */
export async function toggleInCloseForActor(actor) {
  if (!isReachLengthHomebrewEnabled()) {
    ui.notifications?.warn?.("The Reach & Length Overhaul homebrew must be enabled to use In Close.");
    return;
  }

  // Resolve the actor's token on canvas: prefer a currently controlled token.
  let tokenPlaceable = null;
  let tokenDoc = null;

  const controlled = canvas?.tokens?.controlled ?? [];
  const controlledMatch = controlled.find(t => t.actor?.id === actor.id);
  if (controlledMatch) {
    tokenPlaceable = controlledMatch;
    tokenDoc = controlledMatch.document;
  } else {
    const found = canvas?.tokens?.placeables?.find(t => t.actor?.id === actor.id);
    if (found) {
      tokenPlaceable = found;
      tokenDoc = found.document;
    }
  }

  if (!tokenDoc || !tokenPlaceable) {
    await alertDialog({
      title: "In Close",
      content: "<p>No token found on the canvas for this actor. Place or control a token to use In Close.</p>"
    });
    return;
  }

  const active = hasCondition(actor, "inclose");
  if (active) {
    await deactivateInClose(tokenDoc, actor);
  } else {
    await activateInClose(tokenPlaceable, tokenDoc, actor);
  }
}

function _resolveTokenPlaceableForActor(actor) {
  if (!actor) return null;
  const controlled = canvas?.tokens?.controlled ?? [];
  const controlledMatch = controlled.find((t) => t?.actor?.id === actor.id);
  if (controlledMatch) return controlledMatch;
  return canvas?.tokens?.placeables?.find((t) => t?.actor?.id === actor.id) ?? null;
}

function _isInCloseLinked(docA, docB) {
  if (!docA || !docB) return false;
  const mapA = docA.getFlag(FLAG_SCOPE, "reachLength.inCloseWith") ?? {};
  const mapB = docB.getFlag(FLAG_SCOPE, "reachLength.inCloseWith") ?? {};
  return Boolean(mapA?.[docB.uuid] || mapB?.[docA.uuid]);
}

/**
 * Deterministic pair toggle used by opposed-action automation.
 * If the pair already exists it is removed; otherwise it is added (distance <= 1m required).
 *
 * @param {Actor} actorA
 * @param {Actor} actorB
 * @param {object} [opts]
 * @param {boolean} [opts.requireOneMeterForEntry=true]
 * @returns {Promise<{success:boolean,entered?:boolean,left?:boolean,message:string}>}
 */
export async function toggleInCloseBetweenActors(actorA, actorB, { requireOneMeterForEntry = true } = {}) {
  if (!isReachLengthHomebrewEnabled()) {
    return { success: false, message: "Reach & Length Overhaul is disabled." };
  }
  if (!actorA || !actorB) {
    return { success: false, message: "Could not resolve both actors for In Close." };
  }

  const tokenA = _resolveTokenPlaceableForActor(actorA);
  const tokenB = _resolveTokenPlaceableForActor(actorB);
  const docA = tokenA?.document ?? null;
  const docB = tokenB?.document ?? null;

  if (!tokenA || !tokenB || !docA || !docB) {
    return { success: false, message: "Both actors must have tokens on the canvas." };
  }

  if (_isInCloseLinked(docA, docB)) {
    await _pruneInClosePair(docA, docB);
    return { success: true, left: true, message: `${actorA.name} leaves In Close with ${actorB.name}.` };
  }

  if (requireOneMeterForEntry) {
    const dist = measureTokenDistance(tokenA, tokenB);
    if (!Number.isFinite(Number(dist)) || Number(dist) > 1) {
      return { success: false, message: "Must be within 1 m to enter In Close." };
    }
  }

  const mapA = docA.getFlag(FLAG_SCOPE, "reachLength.inCloseWith") ?? {};
  await docA.setFlag(FLAG_SCOPE, "reachLength.inCloseWith", { ...mapA, [docB.uuid]: true });

  const mapB = docB.getFlag(FLAG_SCOPE, "reachLength.inCloseWith") ?? {};
  await requestUpdateDocument(docB, {
    [`flags.${FLAG_SCOPE}.reachLength.inCloseWith`]: { ...mapB, [docA.uuid]: true }
  });

  if (!hasCondition(actorA, "inclose")) {
    await toggleCondition(actorA, "inclose", { origin: null, source: "In Close" });
  }
  if (!hasCondition(actorB, "inclose")) {
    await toggleCondition(actorB, "inclose", { origin: null, source: "In Close" });
  }

  return { success: true, entered: true, message: `${actorA.name} enters In Close with ${actorB.name}.` };
}

async function _pruneInClosePair(docA, docB) {
  // Remove docB from docA's map
  const mapA = foundry.utils.deepClone(docA.getFlag(FLAG_SCOPE, "reachLength.inCloseWith") ?? {});
  delete mapA[docB.uuid];
  if (Object.keys(mapA).length > 0) {
    await docA.setFlag(FLAG_SCOPE, "reachLength.inCloseWith", mapA);
  } else {
    await docA.unsetFlag(FLAG_SCOPE, "reachLength.inCloseWith");
    // Remove inclose condition if actor has it
    const actorA = docA.actor;
    if (actorA && hasCondition(actorA, "inclose")) {
      await toggleCondition(actorA, "inclose", { origin: null, source: "In Close" });
    }
  }

  // Remove docA from docB's map (via authority proxy for non-owned tokens)
  const mapB = foundry.utils.deepClone(docB.getFlag(FLAG_SCOPE, "reachLength.inCloseWith") ?? {});
  delete mapB[docA.uuid];
  if (Object.keys(mapB).length > 0) {
    await requestUpdateDocument(docB, {
      [`flags.${FLAG_SCOPE}.reachLength.inCloseWith`]: mapB
    });
  } else {
    await requestUpdateDocument(docB, {
      [`flags.${FLAG_SCOPE}.reachLength.inCloseWith`]: null
    });
    // Remove inclose condition if actor has it
    const actorB = docB.actor;
    if (actorB && hasCondition(actorB, "inclose")) {
      await toggleCondition(actorB, "inclose", { origin: null, source: "In Close" });
    }
  }

  if (isDebugEnabled()) {
    console.log("UESRPG | In Close pair pruned:", docA.name, "↔", docB.name);
  }
}
