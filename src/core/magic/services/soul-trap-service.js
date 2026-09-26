import { SOUL_GEM_TIERS } from '../../enchanting/soul-gems.js';
import { isActiveGMUser } from '../../../utils/users.js';
import { acquireLock, releaseLock } from '../../../utils/authority-proxy/shared.js';
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
 *   1. Records an HP transition in preUpdateActor; processes it only after updateActor.
 *   2. Checks if the dying actor has a "Soul Trap" marker AE (created by the spell).
 *   3. If found: resolves the caster from AE flags, creates a filled soul gem item on the caster.
 *   4. Posts a chat notification.
 *   5. Removes the Soul Trap marker AE from the dead actor.
 *
 * GM-only, idempotent, permission-safe.
 *
 * Target: Foundry VTT v14.368+
 */

import { createDebugLogger } from "../_primitives.js";
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../../utils/authority-proxy.js";
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
  const level = Number(actor.system?.level ?? actor.system?.cr ?? actor.system?.details?.level ?? 1) || 1;
  const key = ['Player Character', 'character'].includes(actor.type) ? 'black'
    : level <= 2 ? 'petty' : level <= 4 ? 'lesser' : level <= 6 ? 'common' : level <= 8 ? 'greater' : 'grand';
  const tier = SOUL_GEM_TIERS[key];
  return { size: tier.label, energy: tier.maxEnergy, soulType: tier.soulType };
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
async function _createSoulGemItem(casterActor, trappedActor, soulInfo, captureId) {
  const itemData = {
    name: `Filled Soul Gem (${soulInfo.size}) — ${trappedActor.name}`,
    type: "item",
    img: "icons/magic/unholy/orb-glowing-purple.webp",
    system: {
      description: `<p>A <strong>${soulInfo.size} Soul Gem</strong> containing the soul of <strong>${foundry.utils.escapeHTML(trappedActor.name)}</strong>.</p><p>Soul Energy: ${soulInfo.energy}</p>`,
      quantity: 1,
      weight: 0.5,
      price: soulInfo.energy * 100
    },
    flags: {
      [_FLAG_NS]: {
        isSoulGem: true,
        soulTrapCaptureId: captureId,
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

/** Record the transition in the same update; no effects run before commit.
 * v14 preUpdateDocument explicitly permits modifying the differential data. */
function _prepareDeathTransition(actor, changes) {
  const raw = changes?.system?.hp?.value ?? changes?.['system.hp.value'];
  if (raw === undefined || !Number.isFinite(Number(raw)) || Number(raw) > 0) return;
  if (Number(actor.system?.hp?.value ?? 0) <= 0) return;
  const effect = _findSoulTrapEffect(actor);
  if (!effect) return;
  foundry.utils.setProperty(changes, `flags.${_FLAG_NS}.soulTrapDeath`, {
    id: foundry.utils.randomID(), effectId: effect.id, completed: false,
  });
}

async function _captureConfirmedDeath(actor) {
  if (!isActiveGMUser(game.user)) return;
  const lockKey = `SoulTrap:${actor.uuid}`;
  await acquireLock(lockKey);
  try {
    const pending = actor.flags?.[_FLAG_NS]?.soulTrapDeath;
    if (!pending || pending.completed || Number(actor.system?.hp?.value ?? 1) > 0) return;
    const effect = actor.effects?.get(pending.effectId);
    if (!effect || effect !== _findSoulTrapEffect(actor)) return;
    const casterUuid = effect.flags?.[_FLAG_NS]?.casterUuid;
    const caster = casterUuid ? await fromUuid(casterUuid) : null;
    if (!caster) return;
    const captureId = `${actor.uuid}:${pending.id}`;
    let gem = caster.items?.find((item) => item.flags?.[_FLAG_NS]?.soulTrapCaptureId === captureId);
    const existing = Boolean(gem);
    const soul = _determineSoulSize(actor);
    gem ??= await _createSoulGemItem(caster, actor, soul, captureId);
    if (!gem) return; // Keep the marker and transition available for GM repair.
    const recorded = await requestUpdateDocument(actor, {
      [`flags.${_FLAG_NS}.soulTrapDeath`]: { ...pending, completed: true, gemUuid: gem.uuid },
    });
    if (!recorded) {
      console.warn('UESRPG | Soul Trap gem created; capture receipt could not be finalized. The marker is retained for repair.');
      return;
    }
    await requestDeleteEmbeddedDocuments(actor, 'ActiveEffect', [effect.id]);
    if (!existing) {
      const escape = foundry.utils.escapeHTML;
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Soul Trapped!</h3><p><strong>${escape(actor.name)}</strong>'s soul was captured by <strong>${escape(caster.name)}</strong>.</p><p>Soul Size: ${soul.size} (Energy: ${soul.energy})</p><p>${escape(gem.name)} was added to the caster's inventory.</p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: caster }), style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      });
    }
  } finally {
    releaseLock(lockKey);
  }
}

let _initialized = false;
export function initializeSoulTrapService() {
  if (_initialized) return;
  _initialized = true;
  Hooks.on('preUpdateActor', _prepareDeathTransition);
  Hooks.on('updateActor', (actor, changes) => {
    const transition = foundry.utils.getProperty(changes, `flags.${_FLAG_NS}.soulTrapDeath`);
    if (!transition || transition.completed) return;
    void _captureConfirmedDeath(actor).catch((error) => console.error('UESRPG | Confirmed Soul Trap capture failed', error));
  });
  _debug('Soul Trap confirmed-update hooks registered');
}
