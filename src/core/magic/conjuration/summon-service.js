/**
 * @module magic/conjuration/summon-service
 *
 * src/core/magic/summon-service.js
 *
 * Summoned creature lifecycle management for UESRPG 3ev4.
 *
 * RAW (Chapter 6, Conjuration):
 *  - Summoned creature appears within 5m of the caster with Summoned trait.
 *  - Opposed Willpower test: conjurer wins → Bound trait; creature wins → acts freely.
 *  - Mindlock: reduces caster's max AP by Mindlock(Spell Strength).
 *  - If Restrained, creature's max AP reduced by 1.
 *  - If upkept, no WP retest at duration end.
 *  - If spell ends without upkeep, creature loses Summoned trait and returns to plane (if Bound).
 *
 * Implementation:
 *  - GM-only token creation (authority proxy does not support scene-level embedded docs)
 *  - Token linked to caster's Origin AE via `registerLinkedEntity({type: "summon", ...})`
 *  - Teardown via Origin AE lifecycle (deleting Origin AE removes summon tokens)
 *  - Emits `uesrpg.spell.summonSpawned` hook for extensibility
 *
 * Stop condition: Token creation must be GM-only. Players request via socket/hook
 * and the GM client executes the actual document mutation.
 *
 * Target: Foundry VTT v13.351
 */

import { registerLinkedEntity, findOriginAE } from "../effects/origin-effect.js";
import { _num, _str, createDebugLogger } from "../_primitives.js";

const _FLAG_NS = "uesrpg-3ev4";
const SUMMON_RANGE_M = 5; // RAW: within 5m of caster

const _debug = createDebugLogger("aeLifecycleDebug", "[UESRPG][Summon]");

// ─── Spawn ───────────────────────────────────────────────────────────────────

/**
 * Import a compendium actor into the world so it can be used for token creation.
 * Reuses an existing world actor if one was previously imported from the same
 * compendium source to avoid duplicating actors.
 *
 * @param {Actor} compendiumActor - An actor document from a compendium pack
 * @returns {Promise<Actor|null>} The world-level actor, or null on failure
 */
async function _ensureWorldActor(compendiumActor) {
  const compendiumUuid = _str(compendiumActor.uuid);
  if (!compendiumUuid) return null;

  // Check if a world actor already exists that was imported from this compendium source
  const existing = (game.actors?.contents ?? []).find(a => {
    // Check our custom flag first (most reliable)
    if (a.flags?.[_FLAG_NS]?.sourceCompendiumUuid === compendiumUuid) return true;
    // Check Foundry's built-in compendium source tracking
    if (_str(a._stats?.compendiumSource) === compendiumUuid) return true;
    return false;
  });

  if (existing) {
    _debug("Reusing existing world actor for compendium source:", existing.name, { id: existing.id });
    return existing;
  }

  // Import from compendium: clone the full actor data to a world actor
  _debug("Importing compendium actor to world:", compendiumActor.name, { uuid: compendiumUuid });
  try {
    const actorData = compendiumActor.toObject();
    // Remove _id so Foundry assigns a new world-level ID
    delete actorData._id;
    // Mark as imported-for-summon so we can find and reuse it later
    actorData.flags = actorData.flags ?? {};
    actorData.flags[_FLAG_NS] = actorData.flags[_FLAG_NS] ?? {};
    actorData.flags[_FLAG_NS].sourceCompendiumUuid = compendiumUuid;
    actorData.flags[_FLAG_NS].importedForSummon = true;

    const created = await Actor.create(actorData);
    if (!created) {
      console.error("[UESRPG][Summon] Actor.create returned null for compendium import");
      return null;
    }

    _debug("Imported compendium actor:", created.name, {
      id: created.id,
      type: created.type,
      source: compendiumUuid
    });

    return created;
  } catch (err) {
    console.error("[UESRPG][Summon] Failed to import compendium actor to world", err);
    return null;
  }
}

/**
 * Spawn a summoned creature token on the scene and link it to an Origin AE.
 *
 * **GM-only** — if the current user is not GM, this function logs a warning
 * and returns null. The calling code must ensure GM authority.
 *
 * @param {object} cfg
 * @param {Actor} cfg.casterActor - The conjurer
 * @param {ActiveEffect} cfg.originAE - The Origin AE for the summoning spell
 * @param {Actor|string} cfg.summonActor - The actor to summon (or UUID)
 * @param {object} [cfg.tokenOverrides] - Token data overrides (position, name, etc.)
 * @param {Token} [cfg.casterToken] - Caster's token (for positioning within 5m)
 * @returns {Promise<{token: TokenDocument|null, error: string|null}>}
 */
export async function spawnSummon(cfg = {}) {
  if (!game.user?.isGM) {
    console.warn("UESRPG | summon-service | spawnSummon requires GM authority");
    return { token: null, error: "GM authority required for token creation" };
  }

  const { casterActor, originAE, casterToken } = cfg;
  if (!casterActor || !originAE) {
    return { token: null, error: "Missing casterActor or originAE" };
  }

  // Resolve summon actor
  let summonActor = cfg.summonActor;
  if (typeof summonActor === "string") {
    summonActor = await fromUuid(summonActor);
  }
  if (!summonActor) {
    return { token: null, error: "Could not resolve summon actor" };
  }

  // ── Compendium Import ─────────────────────────────────────────────────
  // If the actor is from a compendium pack, import it to the world first.
  // Token creation requires a world-level actorId; compendium IDs are not
  // in the game.actors collection and produce broken/default-type tokens.
  if (summonActor.pack) {
    _debug("Summon actor is from compendium — importing to world:",
      summonActor.name, { pack: summonActor.pack });
    summonActor = await _ensureWorldActor(summonActor);
    if (!summonActor) {
      return { token: null, error: "Failed to import compendium actor to world" };
    }
  }

  const scene = canvas?.scene;
  if (!scene) {
    return { token: null, error: "No active scene" };
  }

  // Compute spawn position (within 5m of caster token)
  const pos = _computeSpawnPosition(casterToken, scene);

  // Build token data from the summon actor's full prototype token.
  // Using the full prototypeToken preserves NPC-specific settings like
  // token bars, sight config, disposition, detection modes, etc.
  const protoData = (typeof summonActor.prototypeToken?.toObject === "function")
    ? summonActor.prototypeToken.toObject()
    : {};
  // Remove fields that must be set explicitly for this token instance
  delete protoData._id;

  const tokenData = foundry.utils.mergeObject(protoData, {
    name: `${summonActor.name} (Summoned)`,
    actorId: summonActor.id,
    actorLink: false, // Unlinked token — summoned creature is temporary
    x: pos.x,
    y: pos.y,
    disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
    flags: {
      [_FLAG_NS]: {
        isSummonedToken: true,
        summonerActorUuid: casterActor.uuid,
        originAEId: originAE.id,
        originAEUuid: originAE.uuid,
        spellUuid: _str(originAE.flags?.[_FLAG_NS]?.spellUuid),
        spellName: _str(originAE.flags?.[_FLAG_NS]?.spellName)
      }
    }
  });

  // Apply caller overrides (e.g., position from location picker)
  foundry.utils.mergeObject(tokenData, cfg.tokenOverrides ?? {});

  _debug("Spawning summon:", summonActor.name, "at", pos);

  try {
    const created = await scene.createEmbeddedDocuments("Token", [tokenData]);
    const tokenDoc = created?.[0] ?? null;

    if (!tokenDoc) {
      return { token: null, error: "Token creation returned null" };
    }

    // Register the summoned token as a linked entity on the Origin AE
    await registerLinkedEntity(originAE, {
      type: "summon",
      uuid: tokenDoc.uuid,
      label: `${summonActor.name} (Summoned)`
    });

    _debug("Summon spawned:", tokenDoc.uuid);

    // Emit hook
    try {
      Hooks.callAll("uesrpg.spell.summonSpawned", {
        casterActor,
        originAE,
        summonActor,
        tokenDoc,
        spellUuid: _str(originAE.flags?.[_FLAG_NS]?.spellUuid),
        spellName: _str(originAE.flags?.[_FLAG_NS]?.spellName)
      });
    } catch (_e) { /* no-op */ }

    // Log to chat
    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Creature Summoned</h3><p><strong>${casterActor.name}</strong> summons <strong>${summonActor.name}</strong>.</p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: casterActor }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    } catch (_e) { /* no-op */ }

    return { token: tokenDoc, error: null };
  } catch (err) {
    console.error("UESRPG | summon-service | Failed to create summon token", err);
    return { token: null, error: err.message ?? "Token creation failed" };
  }
}

// ─── Query ───────────────────────────────────────────────────────────────────

/**
 * Get all summoned tokens on the current scene for a given caster.
 *
 * @param {Actor} casterActor
 * @returns {TokenDocument[]}
 */
export function getSummonedTokens(casterActor) {
  if (!casterActor || !canvas?.scene) return [];
  return (canvas.scene.tokens ?? []).filter(td => {
    const flags = td.flags?.[_FLAG_NS];
    return flags?.isSummonedToken === true && _str(flags.summonerActorUuid) === casterActor.uuid;
  });
}

/**
 * Get all summoned tokens linked to a specific Origin AE.
 *
 * @param {ActiveEffect} originAE
 * @returns {TokenDocument[]}
 */
export function getSummonedTokensByOrigin(originAE) {
  if (!originAE || !canvas?.scene) return [];
  const originId = originAE.id;
  return (canvas.scene.tokens ?? []).filter(td => {
    const flags = td.flags?.[_FLAG_NS];
    return flags?.isSummonedToken === true && _str(flags.originAEId) === originId;
  });
}

// ─── Actor Selection Dialog ──────────────────────────────────────────────────

/**
 * Show a dialog letting the caster select which actor to summon.
 *
 * Searches world actors and optionally a compendium for valid summon targets.
 *
 * @param {object} [opts]
 * @param {string} [opts.school] - Spell school filter (e.g., "Conjuration")
 * @param {string} [opts.title] - Dialog title
 * @returns {Promise<Actor|null>} Selected actor or null if cancelled
 */
export async function showSummonActorPicker(opts = {}) {
  const title = opts.title || "Select Creature to Summon";

  // Collect world actors that look like NPCs/creatures
  const candidates = (game.actors?.contents ?? [])
    .filter(a => a.type === "NPC" || a.type === "npc");

  if (!candidates.length) {
    ui.notifications.warn("No NPC actors available to summon.");
    return null;
  }

  const options = candidates.map(a =>
    `<option value="${a.id}">${a.name}</option>`
  ).join("");

  const content = `
    <form class="uesrpg">
      <div class="form-group">
        <label><b>Select Creature</b></label>
        <select name="actorId" style="width:100%;">${options}</select>
      </div>
    </form>`;

  return Dialog.wait({
    title,
    content,
    buttons: {
      select: {
        label: "Summon",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const actorId = root?.querySelector('select[name="actorId"]')?.value;
          return actorId ? (game.actors.get(actorId) ?? null) : null;
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    default: "select"
  }, { width: 360 });
}

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * Compute a spawn position within range of the caster token.
 * Places the summon token adjacent to the caster (to the right, or below if blocked).
 *
 * @param {Token|TokenDocument|null} casterToken
 * @param {Scene} scene
 * @returns {{x: number, y: number}}
 */
function _computeSpawnPosition(casterToken, scene) {
  const gs = _num(canvas?.grid?.size, 100);

  if (!casterToken) {
    // Fallback: center of scene
    const sw = _num(scene?.dimensions?.width, 2000);
    const sh = _num(scene?.dimensions?.height, 2000);
    return { x: Math.floor(sw / 2), y: Math.floor(sh / 2) };
  }

  const doc = casterToken.document ?? casterToken;
  const cx = _num(doc.x, 0);
  const cy = _num(doc.y, 0);
  const tw = _num(doc.width, 1) * gs;

  // Place to the right of the caster token
  return { x: cx + tw + gs, y: cy };
}
