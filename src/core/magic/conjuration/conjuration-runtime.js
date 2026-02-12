/**
 * @module magic/conjuration/conjuration-runtime
 *
 * src/core/magic/conjuration-runtime.js
 *
 * Runtime execution service for Conjuration spells configured via the
 * spell engine `engine.conjure` block.
 *
 * This module hooks `uesrpg.spell.originCreated` and dispatches to the
 * appropriate handler based on `engine.conjure.mode`:
 *
 *   - "item"     → Clone the referenced item into the caster's inventory
 *                   as a bound/temporary item linked to the Origin AE.
 *   - "creature" → Show a location picker, spawn the summon token on the
 *                   scene with caster ownership, and trigger the existing
 *                   summon binding pipeline via `uesrpg.spell.summonSpawned`.
 *   - "sunder"   → No origin handler needed (opposed test at cast time).
 *   - "none"     → No action.
 *
 * Design:
 *   - GM-only execution (token/item creation requires authority)
 *   - Reads the spell's `system.engine.conjure` config at origin creation time
 *   - Works alongside (not replacing) the legacy flag-based bound-item-service
 *   - All created entities are registered with the Origin AE for synchronized
 *     teardown when the spell ends
 *
 * Target: Foundry VTT v13.351
 */

import { registerLinkedEntity } from "../effects/origin-effect.js";
import { spawnSummon } from "./summon-service.js";
import { getUserSpellTargets } from "../spell-runtime.js";
import { _num, _str, createDebugLogger } from "../_primitives.js";

const _FLAG_NS = "uesrpg-3ev4";

const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][ConjureRuntime]");

/* ═══════════════════════════════════════════════════════════════════════════
 *  Mode: "item" — Conjure Item into Caster Inventory
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Resolve an item from a UUID (world item, compendium, or actor-owned).
 *
 * @param {string} itemUuid - UUID of the template item
 * @returns {Promise<Item|null>}
 */
async function _resolveItemTemplate(itemUuid) {
  if (!itemUuid) return null;
  try {
    return await fromUuid(itemUuid);
  } catch (err) {
    console.warn("[UESRPG][ConjureRuntime] Could not resolve itemUuid:", itemUuid, err);
    return null;
  }
}

/**
 * Resolve the target actors for a conjured item.
 * - If there are user-selected targets, use them.
 * - Otherwise, default to the caster.
 *
 * @param {Actor} casterActor
 * @returns {Actor[]}
 */
function _resolveConjureTargets(casterActor) {
  const targets = getUserSpellTargets();
  if (targets.length) {
    const actors = targets
      .map(t => t.actor ?? t.document?.actor)
      .filter(a => a != null);
    if (actors.length) return actors;
  }
  return [casterActor];
}

/**
 * Resolve the item UUID to conjure from the summon-by-strength scaling config,
 * falling back to the single itemUuid field.
 *
 * @param {Item} spell - The spell
 * @param {object} conjureConfig - engine.conjure config
 * @returns {Promise<string|null>} The selected item UUID
 */
async function _resolveConjureItemWithScaling(spell, conjureConfig) {
  const summonConfig = spell.system?.engine?.conjure?.summonItems;
  if (!summonConfig || typeof summonConfig !== "object") {
    return _str(conjureConfig.itemUuid) || null;
  }

  // Determine current spell strength from damageFormula
  const ssRaw = _str(spell.system?.damageFormula || spell.system?.spell_str || "1");
  const ss = Math.max(1, _num(Number(ssRaw), 1));

  // Collect all refs whose minStrength <= current SS
  const eligible = [];
  for (const [strengthKey, refs] of Object.entries(summonConfig)) {
    const minSS = _num(Number(strengthKey), 99);
    if (minSS > ss) continue;
    const refArray = Array.isArray(refs) ? refs : [refs];
    for (const ref of refArray) {
      if (!ref) continue;
      const uuid = typeof ref === "object" ? _str(ref.uuid) : _str(ref);
      const label = typeof ref === "object" ? _str(ref.label) : "";
      if (uuid) eligible.push({ uuid, label, minStrength: minSS });
    }
  }

  if (!eligible.length) {
    return _str(conjureConfig.itemUuid) || null;
  }

  // If only one option, use it directly
  if (eligible.length === 1) return eligible[0].uuid;

  // Prompt caster to select
  const optionsHTML = eligible.map((e, i) => {
    const displayLabel = e.label || e.uuid.split(".").pop();
    return `<option value="${i}">${displayLabel} (SS ${e.minStrength}+)</option>`;
  }).join("");

  const selection = await Dialog.wait({
    title: "Select Summoned Item",
    content: `<form><div class="form-group">
      <label>Choose item to conjure (Spell Strength ${ss}):</label>
      <select name="choice">${optionsHTML}</select>
    </div></form>`,
    buttons: {
      ok: {
        label: "Conjure",
        callback: (html) => {
          const idx = Number(html.find('[name="choice"]').val());
          return eligible[idx]?.uuid ?? null;
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    default: "ok"
  }, { width: 360 });

  return selection;
}

/**
 * Create a conjured item on a specific target actor.
 *
 * @param {Actor} targetActor - Actor receiving the item
 * @param {Actor} casterActor - The caster
 * @param {ActiveEffect} originAE - Origin AE
 * @param {Item} spell - The spell
 * @param {Item} templateItem - The item template to clone
 * @param {string} itemUuid - Source UUID
 * @returns {Promise<Item|null>}
 */
async function _createConjuredItemOnActor(targetActor, casterActor, originAE, spell, templateItem, itemUuid) {
  const itemData = templateItem.toObject();
  itemData.name = `${itemData.name} (Conjured)`;
  itemData.flags = itemData.flags ?? {};
  itemData.flags[_FLAG_NS] = itemData.flags[_FLAG_NS] ?? {};
  itemData.flags[_FLAG_NS].isBoundItem = true;
  itemData.flags[_FLAG_NS].isConjuredItem = true;
  itemData.flags[_FLAG_NS].conjureMode = "item";
  itemData.flags[_FLAG_NS].spellUuid = spell.uuid;
  itemData.flags[_FLAG_NS].spellName = spell.name;
  itemData.flags[_FLAG_NS].originAEId = originAE.id;
  itemData.flags[_FLAG_NS].sourceItemUuid = itemUuid;

  // Auto-equip if it's armor or weapon
  if (itemData.system && ["weapon", "armor"].includes(itemData.type)) {
    itemData.system.equipped = true;
  }

  const { requestCreateEmbeddedDocuments } = await import("../../../utils/authority-proxy.js");

  let created;
  if (targetActor.isOwner) {
    const results = await targetActor.createEmbeddedDocuments("Item", [itemData]);
    created = results?.[0] ?? null;
  } else {
    const results = await requestCreateEmbeddedDocuments(targetActor, "Item", [itemData]);
    created = Array.isArray(results) ? results[0] : results;
  }

  if (created) {
    _debug("Conjured item created:", created.name, { id: created.id, actor: targetActor.name });

    // Register with Origin AE for synchronized teardown
    await registerLinkedEntity(originAE, {
      type: "boundItem",
      uuid: created.uuid ?? `${targetActor.uuid}.Item.${created.id}`,
      actorUuid: targetActor.uuid,
      label: `${created.name} on ${targetActor.name}`
    });
  }

  return created;
}

/**
 * Clone an item from a UUID into the target actor(s)' inventory as a bound item.
 * If targets are selected, the item goes to the targets; otherwise to the caster.
 *
 * @param {Actor} casterActor - The caster
 * @param {ActiveEffect} originAE - The Origin AE for this spell
 * @param {Item} spell - The spell being cast
 * @param {object} conjureConfig - The engine.conjure config block
 * @returns {Promise<void>}
 */
async function _handleConjureItem(casterActor, originAE, spell, conjureConfig) {
  // Resolve item UUID (with optional scaling)
  const itemUuid = await _resolveConjureItemWithScaling(spell, conjureConfig);

  if (!itemUuid) {
    _debug("Conjure Item: no itemUuid configured or cancelled — skipping");
    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Conjure Item Failed</h3>
          <p><strong>${casterActor.name}</strong> cast <strong>${spell.name}</strong>, but no item is configured in the spell engine.</p>
          <p><em>Open the spell sheet → Automation tab → Conjuration section and drag-drop an item template.</em></p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: casterActor }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        whisper: game.users?.filter(u => u.isGM)?.map(u => u.id) ?? []
      });
    } catch (_e) { /* non-blocking */ }
    return;
  }

  // Resolve target actors
  const targetActors = _resolveConjureTargets(casterActor);
  const itemLabel = _str(conjureConfig.itemLabel) || "Conjured Item";

  _debug("Conjure Item:", { itemUuid, itemLabel, caster: casterActor.name, targets: targetActors.map(a => a.name) });

  // Resolve the template item
  const templateItem = await _resolveItemTemplate(itemUuid);
  if (!templateItem) {
    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Conjure Item — Template Not Found</h3>
          <p><strong>${casterActor.name}</strong> cast <strong>${spell.name}</strong>, but the configured item template could not be resolved.</p>
          <p>UUID: <code>${itemUuid}</code></p>
          <p><em>The item may have been deleted or the compendium may be unavailable.</em></p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: casterActor }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        whisper: game.users?.filter(u => u.isGM)?.map(u => u.id) ?? []
      });
    } catch (_e) { /* non-blocking */ }
    return;
  }

  // Create the item on each target actor
  const createdItems = [];
  for (const targetActor of targetActors) {
    try {
      const created = await _createConjuredItemOnActor(
        targetActor, casterActor, originAE, spell, templateItem, itemUuid
      );
      if (created) createdItems.push({ item: created, actor: targetActor });
    } catch (err) {
      console.error("[UESRPG][ConjureRuntime] Failed to create conjured item on", targetActor.name, err);
    }
  }

  // Chat notification
  if (createdItems.length) {
    const recipientList = createdItems
      .map(({ item, actor }) => `<strong>${item.name}</strong> on <strong>${actor.name}</strong>`)
      .join(", ");
    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Item Conjured</h3>
          <p><strong>${casterActor.name}</strong> conjures ${recipientList} via <strong>${spell.name}</strong>.</p>
          <p><em>The item is bound to the spell and will vanish when the spell ends.</em></p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: casterActor }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    } catch (_e) { /* non-blocking */ }
  } else {
    console.warn("[UESRPG][ConjureRuntime] No items were created");
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Mode: "creature" — Summon Creature Token on Scene
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Resolve a summon actor from UUID.
 *
 * @param {string} actorUuid
 * @returns {Promise<Actor|null>}
 */
async function _resolveSummonActor(actorUuid) {
  if (!actorUuid) return null;
  try {
    return await fromUuid(actorUuid);
  } catch (err) {
    console.warn("[UESRPG][ConjureRuntime] Could not resolve actorUuid:", actorUuid, err);
    return null;
  }
}

/**
 * Determine the caster's token on the active scene.
 *
 * @param {Actor} actor
 * @returns {Token|TokenDocument|null}
 */
function _findCasterToken(actor) {
  if (!actor || !canvas?.scene) return null;
  // Check user's controlled tokens first
  const controlled = canvas.tokens?.controlled ?? [];
  const fromControlled = controlled.find(t => t.actor?.id === actor.id);
  if (fromControlled) return fromControlled;
  // Fall back to first token of the actor on the scene
  const sceneTokens = canvas.scene.tokens?.filter(td => td.actorId === actor.id) ?? [];
  return sceneTokens[0] ?? null;
}

/**
 * Build an ownership object that includes the caster's player as Owner.
 *
 * @param {Actor} casterActor
 * @returns {object} Ownership mapping { userId: permLevel }
 */
function _buildSummonerOwnership(casterActor) {
  const ownership = {};
  if (!casterActor) return ownership;

  // Find all users who own the summoner actor and grant them owner on the summon
  for (const user of game.users ?? []) {
    if (user.isGM) continue; // GMs already have access
    const actorPerm = casterActor.getUserLevel(user);
    if (actorPerm >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
      ownership[user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    }
  }

  return ownership;
}

/**
 * Apply summoner ownership to a spawned token's unlinked actor.
 * Updates the token's ActorDelta to include the summoner's player permissions.
 *
 * @param {TokenDocument} tokenDoc - The spawned token
 * @param {Actor} casterActor - The summoner
 * @returns {Promise<void>}
 */
async function _applySummonerOwnership(tokenDoc, casterActor) {
  const ownershipUpdates = _buildSummonerOwnership(casterActor);
  if (!Object.keys(ownershipUpdates).length) {
    _debug("No player ownership to apply (caster may be GM-only)");
    return;
  }

  try {
    // Update the unlinked token's actor delta ownership
    await tokenDoc.update({ "delta.ownership": ownershipUpdates });
    _debug("Applied summoner ownership to token:", {
      token: tokenDoc.name,
      ownership: ownershipUpdates
    });
  } catch (err) {
    console.warn("[UESRPG][ConjureRuntime] Failed to apply ownership to summon token", err);
    // Fallback: try updating the token's actor directly
    try {
      const tokenActor = tokenDoc.actor;
      if (tokenActor) {
        const currentOwnership = foundry.utils.duplicate(tokenActor.ownership ?? {});
        Object.assign(currentOwnership, ownershipUpdates);
        await tokenActor.update({ ownership: currentOwnership });
        _debug("Applied ownership via token actor fallback");
      }
    } catch (fallbackErr) {
      console.error("[UESRPG][ConjureRuntime] Ownership fallback also failed", fallbackErr);
    }
  }
}

/**
 * Handle creature summoning: show location picker, spawn token on scene,
 * grant caster player ownership, and emit the summonSpawned hook.
 *
 * @param {Actor} casterActor
 * @param {ActiveEffect} originAE
 * @param {Item} spell
 * @param {object} conjureConfig
 * @returns {Promise<void>}
 */
async function _handleSummonCreature(casterActor, originAE, spell, conjureConfig) {
  const actorUuid = _str(conjureConfig.actorUuid);
  const actorLabel = _str(conjureConfig.actorLabel) || "Summoned Creature";

  if (!actorUuid) {
    _debug("Summon Creature: no actorUuid configured — skipping");
    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Summon Failed</h3>
          <p><strong>${casterActor.name}</strong> cast <strong>${spell.name}</strong>, but no creature is configured in the spell engine.</p>
          <p><em>Open the spell sheet → Automation tab → Conjuration section and drag-drop a creature actor.</em></p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: casterActor }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        whisper: game.users?.filter(u => u.isGM)?.map(u => u.id) ?? []
      });
    } catch (_e) { /* non-blocking */ }
    return;
  }

  // Resolve the summon actor
  const summonActor = await _resolveSummonActor(actorUuid);
  if (!summonActor) {
    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Summon — Creature Not Found</h3>
          <p><strong>${casterActor.name}</strong> cast <strong>${spell.name}</strong>, but the configured creature actor could not be resolved.</p>
          <p>UUID: <code>${actorUuid}</code></p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: casterActor }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        whisper: game.users?.filter(u => u.isGM)?.map(u => u.id) ?? []
      });
    } catch (_e) { /* non-blocking */ }
    return;
  }

  _debug("Summon Creature:", {
    actor: summonActor.name,
    caster: casterActor.name,
    spell: spell.name
  });

  // Determine token dimensions from prototype
  const protoToken = summonActor.prototypeToken ?? {};
  const tw = _num(protoToken.width, 1);
  const th = _num(protoToken.height, 1);

  // Find caster token for positioning reference
  const casterToken = _findCasterToken(casterActor);

  // ── Location Picker ─────────────────────────────────────────────────
  // Only the GM needs to pick location (GM executes the spawn).
  // If not on an active canvas, fall back to auto-position.
  let position = null;
  if (canvas?.ready) {
    position = await pickCanvasLocation({
      label: `Click on the canvas to place ${summonActor.name}. Right-click or Escape to cancel.`,
      tokenWidth: tw,
      tokenHeight: th,
      timeout: 60_000,
      originToken: casterToken
    });

    if (!position) {
      // Cancelled — notify but still create at fallback position
      const useFallback = await Dialog.wait({
        title: "Placement Cancelled",
        content: `<p>No location was selected. Place <strong>${summonActor.name}</strong> adjacent to the caster instead?</p>`,
        buttons: {
          yes: { label: "Place Adjacent", callback: () => true },
          no: { label: "Cancel Summon", callback: () => false }
        },
        default: "yes"
      }, { width: 360 });

      if (!useFallback) {
        _debug("Summon cancelled by user");
        return;
      }
      // position remains null → spawnSummon will use auto-position
    }
  }

  // ── Spawn Token ───────────────────────────────────────────────────────
  const tokenOverrides = {};
  if (position) {
    tokenOverrides.x = position.x;
    tokenOverrides.y = position.y;
  }

  const result = await spawnSummon({
    casterActor,
    originAE,
    summonActor,
    tokenOverrides,
    casterToken
  });

  if (result.error) {
    console.warn("[UESRPG][ConjureRuntime] Summon spawn error:", result.error);
    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Summon Failed</h3>
          <p>Could not place <strong>${summonActor.name}</strong> on the scene.</p>
          <p><em>${result.error}</em></p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: casterActor }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        whisper: game.users?.filter(u => u.isGM)?.map(u => u.id) ?? []
      });
    } catch (_e) { /* non-blocking */ }
    return;
  }

  _debug("Summon successful:", result.token?.uuid);

  // ── Post-Spawn Ownership ──────────────────────────────────────────────
  // Grant the caster's player(s) Owner permission on the summoned token's
  // unlinked actor so they can control it.
  const tokenDoc = result.token;
  if (tokenDoc) {
    await _applySummonerOwnership(tokenDoc, casterActor);
  }

  // Note: The uesrpg.spell.summonSpawned hook is already emitted by spawnSummon(),
  // which triggers summon-binding.js for Mindlock, Restrained penalty, and binding prompt.
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Origin AE Hook Handler
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Handle `uesrpg.spell.originCreated` — route to appropriate conjuration handler
 * based on the spell's `engine.conjure.mode` config.
 *
 * @param {object} payload - { casterActor, spell, originEffect, options }
 * @returns {Promise<void>}
 */
async function _onOriginCreated(payload) {
  const { casterActor, spell, originEffect } = payload;
  if (!casterActor || !spell || !originEffect) return;

  // Only GM processes conjuration runtime (token/item creation requires authority)
  if (!game.user.isGM) return;

  // Read the engine.conjure config from the spell
  const conjureConfig = spell.system?.engine?.conjure;
  if (!conjureConfig) return;

  const mode = _str(conjureConfig.mode);
  if (!mode || mode === "none") return;

  _debug("originCreated — conjure mode detected:", mode, {
    spell: spell.name,
    caster: casterActor.name
  });

  switch (mode) {
    case "item":
      await _handleConjureItem(casterActor, originEffect, spell, conjureConfig);
      break;

    case "creature":
      await _handleSummonCreature(casterActor, originEffect, spell, conjureConfig);
      break;

    case "sunder":
      // Sunder Binding is handled via the CharOpposedWorkflow at cast time,
      // not at Origin AE creation. No runtime action needed here.
      _debug("Sunder mode — no origin runtime action (opposed test is cast-time)");
      break;

    default:
      _debug("Unknown conjure mode:", mode);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Canvas Location Picker (merged from location-picker.js)
 * ═══════════════════════════════════════════════════════════════════════════ */

const _RETICLE_COLOR = 0x00AAFF;
const _RETICLE_ALPHA = 0.35;
const _RETICLE_BORDER_ALPHA = 0.7;
const _DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Show a crosshair-style reticle on the canvas and wait for the user to
 * click a position, then return the grid-snapped coordinates.
 *
 * @param {object} [opts]
 * @param {string} [opts.label] - Notification text shown to the user
 * @param {number} [opts.tokenWidth=1] - Width of the token to place (in grid units)
 * @param {number} [opts.tokenHeight=1] - Height of the token to place (in grid units)
 * @param {number} [opts.timeout=60000] - Timeout in ms (0 = no timeout)
 * @param {number} [opts.maxRange=0] - Maximum range from origin token in grid units (0 = unlimited)
 * @param {Token|TokenDocument} [opts.originToken] - The caster's token for range validation
 * @returns {Promise<{x: number, y: number}|null>} Grid-snapped position or null if cancelled
 */
export async function pickCanvasLocation(opts = {}) {
  const scene = canvas?.scene;
  if (!scene || !canvas?.ready) {
    ui.notifications?.warn("No active scene — cannot pick a location.");
    return null;
  }

  const gs = canvas.grid?.size ?? 100;
  const tw = Math.max(1, Number(opts.tokenWidth) || 1);
  const th = Math.max(1, Number(opts.tokenHeight) || 1);
  const timeout = Number(opts.timeout) || _DEFAULT_TIMEOUT_MS;
  const label = opts.label || "Click on the canvas to place the summoned creature. Right-click or Escape to cancel.";

  // Show instruction notification
  ui.notifications?.info(label, { permanent: false });

  return new Promise((resolve) => {
    let resolved = false;
    let timerId = null;
    let reticle = null;

    // ── Reticle Graphic ─────────────────────────────────────────────────
    try {
      reticle = new PIXI.Graphics();
      reticle.eventMode = "none"; // Don't intercept pointer events
      reticle.zIndex = 9999;
      canvas.interface?.addChild(reticle);
    } catch (_e) {
      // Fallback: no reticle, still allow picking
      reticle = null;
    }

    function _drawReticle(x, y) {
      if (!reticle) return;
      reticle.clear();
      // Fill
      reticle.beginFill(_RETICLE_COLOR, _RETICLE_ALPHA);
      reticle.drawRect(0, 0, tw * gs, th * gs);
      reticle.endFill();
      // Border
      reticle.lineStyle(2, _RETICLE_COLOR, _RETICLE_BORDER_ALPHA);
      reticle.drawRect(0, 0, tw * gs, th * gs);
      // Crosshair lines
      const cx = (tw * gs) / 2;
      const cy = (th * gs) / 2;
      reticle.moveTo(cx, 0);
      reticle.lineTo(cx, th * gs);
      reticle.moveTo(0, cy);
      reticle.lineTo(tw * gs, cy);
      // Position
      reticle.position.set(x, y);
    }

    // ── Cleanup ─────────────────────────────────────────────────────────
    function _cleanup() {
      if (timerId) { clearTimeout(timerId); timerId = null; }
      canvas.stage?.off("pointermove", _onMouseMove);
      canvas.stage?.off("pointerdown", _onMouseClick);
      document.removeEventListener("keydown", _onKeyDown, { capture: true });
      document.removeEventListener("contextmenu", _onRightClick, { capture: true });
      if (reticle) {
        try { reticle.destroy({ children: true }); } catch (_e) { /* no-op */ }
        reticle = null;
      }
    }

    function _resolve(result) {
      if (resolved) return;
      resolved = true;
      _cleanup();
      resolve(result);
    }

    // ── Mouse Move (reticle follow) ─────────────────────────────────────
    function _onMouseMove(event) {
      if (resolved) return;
      const pos = event.data?.getLocalPosition(canvas.stage) ?? event.getLocalPosition?.(canvas.stage);
      if (!pos) return;
      // Snap to grid
      const snapped = canvas.grid?.getSnappedPoint(
        { x: pos.x, y: pos.y },
        { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX }
      ) ?? { x: pos.x, y: pos.y };
      _drawReticle(snapped.x, snapped.y);
    }

    // ── Left Click (confirm) ────────────────────────────────────────────
    function _onMouseClick(event) {
      if (resolved) return;
      // Only respond to left click
      const button = event.data?.button ?? event.button;
      if (button !== 0) return;

      const pos = event.data?.getLocalPosition(canvas.stage) ?? event.getLocalPosition?.(canvas.stage);
      if (!pos) return;

      // Snap to grid
      const snapped = canvas.grid?.getSnappedPoint(
        { x: pos.x, y: pos.y },
        { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX }
      ) ?? { x: pos.x, y: pos.y };

      _resolve({ x: snapped.x, y: snapped.y });
    }

    // ── Right Click (cancel) ────────────────────────────────────────────
    function _onRightClick(event) {
      if (resolved) return;
      event.preventDefault();
      event.stopPropagation();
      ui.notifications?.info("Placement cancelled.");
      _resolve(null);
    }

    // ── Escape Key (cancel) ─────────────────────────────────────────────
    function _onKeyDown(event) {
      if (resolved) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        ui.notifications?.info("Placement cancelled.");
        _resolve(null);
      }
    }

    // ── Register Listeners ──────────────────────────────────────────────
    canvas.stage?.on("pointermove", _onMouseMove);
    canvas.stage?.on("pointerdown", _onMouseClick);
    document.addEventListener("keydown", _onKeyDown, { capture: true });
    document.addEventListener("contextmenu", _onRightClick, { capture: true });

    // ── Timeout ─────────────────────────────────────────────────────────
    if (timeout > 0) {
      timerId = setTimeout(() => {
        if (!resolved) {
          ui.notifications?.warn("Placement timed out.");
          _resolve(null);
        }
      }, timeout);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Initialization
 * ═══════════════════════════════════════════════════════════════════════════ */

let _initialized = false;

/**
 * Register the conjuration runtime hook listener. Call once during system ready.
 * Idempotent — safe to call multiple times.
 */
export function initializeConjurationRuntime() {
  if (_initialized) return;
  _initialized = true;

  Hooks.on("uesrpg.spell.originCreated", _onOriginCreated);
  _debug("Conjuration runtime hook registered");
}
