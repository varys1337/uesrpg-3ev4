/**
 * @module magic/conjuration/summon-binding
 *
 * src/core/magic/summon-binding.js
 *
 * Summon Binding & Mindlock automation for UESRPG 3ev4.
 *
 * RAW (Chapter 6 – Conjuration, Summon Construct / Summon Daedra):
 *   1. Summoned creature appears within 5m with the "Summoned" trait.
 *   2. Opposed WP test: conjurer DoS vs creature WP. Winner decides Bound status.
 *   3. Mindlock: caster's max AP reduced by [Spell Strength] while the summon persists.
 *   4. If Restrained: creature's max AP reduced by 1 while Bound.
 *   5. If Upkept: creature does NOT retest WP at duration end.
 *   6. On spell end (if Bound): creature loses Summoned trait and returns to plane.
 *
 * Automation scope:
 *   - Mindlock AE on caster (automatic, linked to Origin AE for synchronized teardown)
 *   - Binding prompt chat card (GM manually resolves the opposed WP test)
 *   - Restrained AP penalty on creature (if spell was Restrained)
 *
 * Target: Foundry VTT v13.351
 */

import { findOriginAE } from "../effects/origin-effect.js";
import { requestCreateEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { createDebugLogger } from "../_primitives.js";
import { applyMindlockEffects } from "../mindlock.js";
import { FLAG_SCOPE } from "../../system/namespace.js";

const _FLAG_NS = FLAG_SCOPE;

const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][SummonBinding]");

/* ── Restrained AP Penalty ────────────────────────────────────────────────── */

/**
 * Apply a -1 max AP penalty to the summoned creature if the spell was Restrained.
 *
 * @param {TokenDocument} tokenDoc - The summoned creature's token
 * @param {ActiveEffect} originAE
 * @param {Item} spell
 * @returns {Promise<ActiveEffect|null>}
 */
async function _applyRestrainedPenalty(tokenDoc, originAE, spell) {
  // Check if the spell was Restrained
  const isRestrained = Boolean(
    spell.system?.isRestrained ||
    originAE?.flags?.[_FLAG_NS]?.spellOptions?.isRestrained
  );

  if (!isRestrained) return null;

  const creatureActor = tokenDoc.actor;
  if (!creatureActor) return null;

  const effectData = {
    name: `Restrained (${spell.name})`,
    img: "icons/magic/control/debuff-chains-ropes-red.webp",
    origin: spell.uuid,
    disabled: false,
    duration: {},
    changes: [
      {
        key: "system.modifiers.action_points.max",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: "-1",
        priority: 20
      }
    ],
    flags: {
      [_FLAG_NS]: {
        spellEffect: true,
        isRestrainedPenalty: true,
        spellUuid: spell.uuid,
        spellName: spell.name,
        owner: "system",
        effectGroup: `spell.restrained.${spell.id || spell.uuid}`,
        stackRule: "override",
        source: "spell-restrained"
      }
    }
  };

  try {
    const results = await requestCreateEmbeddedDocuments(creatureActor, "ActiveEffect", [effectData]);
    const created = Array.isArray(results) ? results[0] : (results ?? null);
    if (created) {
      _debug(`Applied Restrained -1 AP to ${creatureActor.name}`);
    }
    return created;
  } catch (err) {
    console.error("[UESRPG][SummonBinding] Failed to apply Restrained penalty", err);
    return null;
  }
}

/* ── Binding Prompt ───────────────────────────────────────────────────────── */

/**
 * Post a chat card prompting the GM to resolve the opposed WP binding test.
 *
 * @param {Actor} casterActor
 * @param {Actor} summonActor
 * @param {Item} spell
 * @returns {Promise<void>}
 */
async function _postBindingPrompt(casterActor, summonActor, spell) {
  const spellStr = Number(spell.system?.spell_str ?? 0) || 0;
  const creatureWP = Number(summonActor.system?.characteristics?.wp ?? summonActor.system?.professions?.magic ?? 0) || 0;

  try {
    await ChatMessage.create({
      content: `<div class="uesrpg">
        <h3>Binding Test Required</h3>
        <p><strong>${casterActor.name}</strong> must make an opposed Willpower test against <strong>${summonActor.name}</strong> to bind the summoned creature.</p>
        <table>
          <tr><td><strong>Caster DoS</strong></td><td>From conjuration test</td></tr>
          <tr><td><strong>Creature WP</strong></td><td>${creatureWP}</td></tr>
          <tr><td><strong>Spell Strength</strong></td><td>${spellStr}</td></tr>
        </table>
        <p><em>If the conjurer wins:</em> Creature gains <strong>Bound</strong> trait. Mindlock (${spell.system?.mindlockValue || spellStr}) applied to caster.</p>
        <p><em>If the creature wins:</em> Not Bound — acts freely (typically hostile).</p>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor: casterActor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      whisper: game.users?.filter(u => u.isGM)?.map(u => u.id) ?? []
    });
  } catch (_e) { /* non-blocking */ }
}

/* ── Hook Handler ─────────────────────────────────────────────────────────── */

/**
 * Handle `uesrpg.spell.summonSpawned` — apply Mindlock, Restrained penalty,
 * and post binding prompt.
 *
 * @param {object} payload - { casterActor, originAE, summonActor, tokenDoc, spellUuid, spellName }
 * @returns {Promise<void>}
 */
async function _onSummonSpawned(payload) {
  const { casterActor, originAE, summonActor, tokenDoc } = payload;
  if (!casterActor || !originAE || !tokenDoc) return;

  // Only GM processes binding
  if (!game.user.isGM) return;

  // Resolve the spell from Origin AE flags
  const spellUuid = originAE.flags?.[_FLAG_NS]?.spellUuid;
  let spell = null;
  if (spellUuid) {
    try { spell = await fromUuid(spellUuid); } catch (_e) { /* no-op */ }
  }

  if (!spell) {
    _debug("Could not resolve spell for binding — skipping");
    return;
  }

  _debug("Processing summon binding:", {
    caster: casterActor.name,
    creature: summonActor?.name,
    spell: spell.name
  });

  // 1. Apply Mindlock AE on caster (via shared helper)
  await applyMindlockEffects({ caster: casterActor, spell, originAE });

  // 2. Apply Restrained AP penalty on creature (if applicable)
  await _applyRestrainedPenalty(tokenDoc, originAE, spell);

  // 3. Post binding prompt to GM chat
  if (summonActor) {
    await _postBindingPrompt(casterActor, summonActor, spell);
  }
}

/* ── Initialization ───────────────────────────────────────────────────────── */

let _initialized = false;

/**
 * Register the summon binding hook listener. Call once during system ready.
 * Idempotent — safe to call multiple times.
 */
export function initializeSummonBinding() {
  if (_initialized) return;
  _initialized = true;

  Hooks.on("uesrpg.spell.summonSpawned", _onSummonSpawned);
  _debug("Summon binding hook registered");
}
