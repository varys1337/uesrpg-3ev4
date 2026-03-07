/**
 * @module magic/services/soul-trap-service
 *
 * src/core/magic/soul-trap-service.js
 *
 * Soul Trap death-hook automation for UESRPG 3ev4.
 *
 * RAW (Chapter 6 – Mysticism, Soul Trap):
 *   - "Marks the target's soul. If the target dies while the effect is active,
 *     their soul is trapped in a soul gem held by the caster."
 *   - Soul energy equals the size of the target's soul.
 *   - If reflected, the caster's own soul is trapped instead (handled by reflect pipeline).
 *   - Seen as hostile when cast on unwilling targets, but not an Attack.
 *
 * Implementation:
 *   1. Hooks `preUpdateActor` — detects HP about to drop to 0 (or below).
 *   2. Checks if the dying actor has a "Soul Trap" marker AE (created by the spell).
 *   3. If found: resolves the caster from AE flags, creates a filled soul gem item on the caster.
 *   4. Posts a chat notification.
 *   5. Removes the Soul Trap marker AE from the dead actor.
 *
 * GM-only, idempotent, permission-safe.
 *
 * Target: Foundry VTT v13.351
 */

import { createDebugLogger } from "../_primitives.js";
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { FLAG_SCOPE } from "../../system/namespace.js";

const _FLAG_NS = FLAG_SCOPE;

const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][SoulTrap]");

/* ── Soul Size Lookup ─────────────────────────────────────────────────────── */

/**
 * Determine a creature's soul size based on its level/CR or actor type.
 *
 * RAW soul gem tiers:
 *   Petty   → creatures level 1-2
 *   Lesser  → creatures level 3-4
 *   Common  → creatures level 5-6
 *   Greater → creatures level 7-8
 *   Grand   → creatures level 9+
 *   Black   → sentient (Player Characters, named NPCs)
 *
 * @param {Actor} actor
 * @returns {{ size: string, energy: number, soulType: string }}
 */
function _determineSoulSize(actor) {
  // PCs and "named" NPCs → Black Soul
  if (actor.type === "Player Character" || actor.type === "character") {
    return { size: "Black", energy: 1500, soulType: "black" };
  }

  const level = Number(
    actor.system?.level ??
    actor.system?.cr ??
    actor.system?.details?.level ??
    1
  ) || 1;

  if (level <= 2) return { size: "Petty", energy: 100, soulType: "white" };
  if (level <= 4) return { size: "Lesser", energy: 250, soulType: "white" };
  if (level <= 6) return { size: "Common", energy: 500, soulType: "white" };
  if (level <= 8) return { size: "Greater", energy: 1000, soulType: "white" };
  return { size: "Grand", energy: 1500, soulType: "white" };
}

/* ── Soul Trap Detection ──────────────────────────────────────────────────── */

/**
 * Find the Soul Trap marker AE on an actor.
 *
 * @param {Actor} actor
 * @returns {ActiveEffect|null}
 */
function _findSoulTrapEffect(actor) {
  if (!actor?.effects) return null;

  for (const ae of actor.effects) {
    const flags = ae.flags?.[_FLAG_NS];
    if (!flags?.spellEffect) continue;

    const name = String(ae.name ?? "").toLowerCase().trim();
    const spellName = String(flags.spellName ?? "").toLowerCase().trim();

    if (name === "soul trap" || spellName === "soul trap") {
      return ae;
    }
  }

  return null;
}

/* ── Soul Gem Creation ────────────────────────────────────────────────────── */

/**
 * Create a filled soul gem item on the caster's actor.
 *
 * @param {Actor} casterActor
 * @param {Actor} trappedActor - The actor whose soul was trapped
 * @param {{ size: string, energy: number, soulType: string }} soulInfo
 * @returns {Promise<Item|null>}
 */
async function _createSoulGemItem(casterActor, trappedActor, soulInfo) {
  const itemData = {
    name: `Filled Soul Gem (${soulInfo.size}) — ${trappedActor.name}`,
    type: "item",
    img: "icons/magic/unholy/orb-glowing-purple.webp",
    system: {
      description: `<p>A <strong>${soulInfo.size} Soul Gem</strong> containing the soul of <strong>${trappedActor.name}</strong>.</p><p>Soul Energy: ${soulInfo.energy}</p>`,
      quantity: 1,
      weight: 0.5,
      price: soulInfo.energy * 100
    },
    flags: {
      [_FLAG_NS]: {
        isSoulGem: true,
        soulSize: soulInfo.size,
        soulEnergy: soulInfo.energy,
        soulType: soulInfo.soulType ?? "white",
        trappedActorName: trappedActor.name,
        trappedActorUuid: trappedActor.uuid
      }
    }
  };

  try {
    const results = await requestCreateEmbeddedDocuments(casterActor, "Item", [itemData]);
    const created = Array.isArray(results) ? results[0] : (results ?? null);

    if (created) {
      _debug(`Created soul gem: ${created.name}`, { id: created.id, energy: soulInfo.energy });
    }
    return created;
  } catch (err) {
    console.error("[UESRPG][SoulTrap] Failed to create soul gem", err);
    return null;
  }
}

/* ── Hook Handler ─────────────────────────────────────────────────────────── */

/**
 * Handles `preUpdateActor` hook — detect death (HP → 0) and trigger Soul Trap.
 *
 * In `preUpdateActor`, `actor.system.hp.value` is the OLD value and
 * `changes.system.hp.value` is the NEW value being applied.
 * This lets us reliably detect the alive→dead transition.
 *
 * All mutation work is deferred via fire-and-forget async to avoid
 * blocking the update pipeline.
 *
 * @param {Actor} actor
 * @param {object} changes
 * @param {object} _options
 * @param {string} _userId
 */
function _onPreUpdateActor(actor, changes, _options, _userId) {
  // Only GM processes Soul Trap
  if (!game.user.isGM) return;

  // Check if HP is being changed
  const newHPRaw = changes?.system?.hp?.value;
  if (newHPRaw === undefined) return;
  const newHP = Number(newHPRaw);
  if (!Number.isFinite(newHP)) return;

  // Only trigger on death (HP drops to 0 or below)
  if (newHP > 0) return;

  // Ensure the actor was previously alive (old HP > 0)
  const oldHP = Number(actor.system?.hp?.value ?? 0);
  if (oldHP <= 0) return;

  // Check for Soul Trap marker AE (actor still has old state in preUpdate)
  const soulTrapAE = _findSoulTrapEffect(actor);
  if (!soulTrapAE) return;

  const flags = soulTrapAE.flags?.[_FLAG_NS] ?? {};
  const casterUuid = flags.casterUuid;
  if (!casterUuid) {
    _debug("Soul Trap AE has no casterUuid — skipping");
    return;
  }

  _debug(`Death detected: ${actor.name} (HP: ${oldHP} → ${newHP})`);

  // Defer all mutation work to avoid blocking the preUpdate pipeline
  const actorUuid = actor.uuid;
  const soulTrapAEId = soulTrapAE.id;
  const actorName = actor.name;

  setTimeout(async () => {
    try {
      // Re-resolve actor (may have been updated by the time this runs)
      const resolvedActor = await fromUuid(actorUuid);
      if (!resolvedActor) return;

      // Re-verify HP is actually 0 (the update should be applied by now)
      if (Number(resolvedActor.system?.hp?.value ?? 1) > 0) return;

      // Re-verify Soul Trap AE still exists (idempotency)
      const existingAE = resolvedActor.effects?.get(soulTrapAEId);
      if (!existingAE) return;

      // Resolve caster actor
      let casterActor;
      try { casterActor = await fromUuid(casterUuid); } catch (_e) { /* no-op */ }
      if (!casterActor) {
        _debug(`Could not resolve caster: ${casterUuid}`);
        return;
      }

      _debug("Soul Trap triggered:", { target: actorName, caster: casterActor.name });

      // Determine soul size
      const soulInfo = _determineSoulSize(resolvedActor);

      // Create soul gem on caster
      const soulGem = await _createSoulGemItem(casterActor, resolvedActor, soulInfo);

      // Post chat notification
      try {
        await ChatMessage.create({
          content: `<div class="uesrpg">
            <h3>Soul Trapped!</h3>
            <p><strong>${actorName}</strong>'s soul has been captured by <strong>${casterActor.name}</strong>'s Soul Trap.</p>
            <p><strong>Soul Size:</strong> ${soulInfo.size} (Energy: ${soulInfo.energy})</p>
            ${soulGem ? `<p>A <strong>${soulGem.name}</strong> has been added to ${casterActor.name}'s inventory.</p>` : ""}
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: casterActor }),
          style: CONST.CHAT_MESSAGE_STYLES.OTHER
        });
      } catch (_e) { /* non-blocking */ }

      // Remove the Soul Trap marker AE from the dead actor
      try {
        await requestDeleteEmbeddedDocuments(resolvedActor, "ActiveEffect", [soulTrapAEId]);
      } catch (_e) { /* best-effort cleanup */ }
    } catch (err) {
      console.error("[UESRPG][SoulTrap] Deferred soul trap processing error:", err);
    }
  }, 100); // Small delay to let the actor update complete
}

/* ── Initialization ───────────────────────────────────────────────────────── */

let _initialized = false;

/**
 * Register the Soul Trap death hook listener. Call once during system ready.
 * Idempotent — safe to call multiple times.
 */
export function initializeSoulTrapService() {
  if (_initialized) return;
  _initialized = true;

  Hooks.on("preUpdateActor", _onPreUpdateActor);
  _debug("Soul Trap death hook registered");
}
