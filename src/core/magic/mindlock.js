/**
 * src/core/magic/mindlock.js
 *
 * Generic Mindlock AE helpers for UESRPG 3ev4.
 *
 * Extracted from conjuration/summon-binding.js to support any spell that
 * carries a mindlockValue (not only conjuration summons).
 *
 * Chapter 6 (Conjuration): "While a summoned creature persists, the caster's
 * maximum AP is reduced by [Spell Strength]." The same mechanic can apply to
 * any spell flagged with a positive mindlockValue.
 *
 * Exports:
 *   spellHasMindlock(spell)   — true if the spell carries a positive mindlockValue
 *   applyMindlockEffects({…}) — create/link the Mindlock AE; idempotent
 *   initializeMindlockHook()  — register the castResolved listener once
 *
 * Target: Foundry VTT v13.351
 */

import { registerLinkedEntity } from "./effects/origin-effect.js";
import { requestCreateEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { createDebugLogger } from "./_primitives.js";

const _FLAG_NS = "uesrpg-3ev4";

const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][Mindlock]");

/* ── Public Helpers ───────────────────────────────────────────────────────── */

/**
 * Return true if the spell carries a positive mindlockValue.
 *
 * @param {Item} spell
 * @returns {boolean}
 */
export function spellHasMindlock(spell) {
  return (Number(spell?.system?.mindlockValue ?? 0) || 0) > 0;
}

/**
 * Apply a Mindlock AE to the caster, reducing max AP by the spell's mindlock
 * value.  Idempotent: if a Mindlock AE for this spell already exists on the
 * caster, returns the existing effect without creating a duplicate.
 *
 * When `originAE` is supplied the new AE is registered as a linked entity
 * (synchronized teardown when the origin AE expires).
 *
 * @param {object} params
 * @param {Actor}            params.caster    - The casting actor
 * @param {Item}             params.spell     - The cast spell item
 * @param {ActiveEffect|null} [params.originAE] - Origin AE for synchronized teardown
 * @param {object}           [params.context]
 * @param {number}           [params.context.mindlockOverride] - Override mindlock value
 * @returns {Promise<ActiveEffect|null>}
 */
export async function applyMindlockEffects({ caster, spell, originAE = null, context = {} } = {}) {
  if (!caster || !spell) return null;

  const mindlockValue = context.mindlockOverride ?? (Number(spell.system?.mindlockValue ?? 0) || 0);
  if (mindlockValue <= 0) {
    _debug("No mindlock value for spell:", spell.name);
    return null;
  }

  // Idempotent: skip if a Mindlock AE for this spell already exists on the caster.
  const existing = caster.effects?.find(e =>
    e.flags?.[_FLAG_NS]?.isMindlock &&
    e.flags?.[_FLAG_NS]?.spellUuid === spell.uuid
  );
  if (existing) {
    _debug("Mindlock AE already present for spell:", spell.name);
    return existing;
  }

  // Mirror origin AE duration when provided (so both AEs expire together).
  const originDuration = originAE?.duration
    ? foundry.utils.deepClone(originAE.duration)
    : {};

  const effectData = {
    name: `Mindlock (${spell.name})`,
    img: spell.img || "icons/magic/control/debuff-chains-ropes-purple.webp",
    origin: spell.uuid,
    disabled: false,
    duration: originDuration,
    changes: [
      {
        key: "system.modifiers.action_points.max",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: String(-mindlockValue),
        priority: 20
      }
    ],
    flags: {
      [_FLAG_NS]: {
        spellEffect: true,
        isMindlock: true,
        mindlockValue,
        spellUuid: spell.uuid,
        spellName: spell.name,
        casterUuid: caster.uuid,
        owner: "system",
        effectGroup: `spell.mindlock.${spell.id || spell.uuid}`,
        stackRule: "override",
        source: "spell-mindlock"
      }
    }
  };

  try {
    const results = await requestCreateEmbeddedDocuments(caster, "ActiveEffect", [effectData]);
    const created = Array.isArray(results) ? results[0] : (results ?? null);

    if (!created) {
      _debug("Failed to create Mindlock AE (null result)");
      return null;
    }

    _debug(`Created Mindlock AE: -${mindlockValue} AP`, { id: created.id });

    if (originAE) {
      await registerLinkedEntity(originAE, {
        type: "casterBuff",
        uuid: created.uuid ?? `${caster.uuid}.ActiveEffect.${created.id}`,
        actorUuid: caster.uuid,
        label: `Mindlock (${spell.name}) on ${caster.name}`
      });
      _debug("Registered Mindlock AE with Origin AE");
    }

    return created;
  } catch (err) {
    console.error("[UESRPG][Mindlock] Failed to create Mindlock AE", err);
    return null;
  }
}

/* ── Generic castResolved Hook ────────────────────────────────────────────── */

/**
 * Handle `uesrpg.spell.castResolved` for non-summon spells with Mindlock.
 * Summon spells delegate to summon-binding.js (via uesrpg.spell.summonSpawned);
 * skip them here to avoid double-application.
 *
 * @param {object} payload - { caster, spell, success, ... }
 */
async function _onCastResolved(payload) {
  const { caster, spell, success } = payload;
  if (!success || !caster || !spell) return;
  if (!spellHasMindlock(spell)) return;

  // Summon spells are handled by summon-binding.js — skip.
  try {
    const { normalizeSpellConfig } = await import("./spell-config.js");
    if (normalizeSpellConfig(spell).summon?.isSummon) return;
  } catch (_e) { /* non-spell or bad config — treat as non-summon */ }

  // Only the actor owner (or GM) has authority to create AEs on their own caster.
  if (!caster?.isOwner) return;

  await applyMindlockEffects({ caster, spell, originAE: null });
}

/* ── Initialization ───────────────────────────────────────────────────────── */

let _initialized = false;

/**
 * Register the generic Mindlock castResolved hook. Call once during system
 * ready.  Idempotent — safe to call multiple times.
 */
export function initializeMindlockHook() {
  if (_initialized) return;
  _initialized = true;

  Hooks.on("uesrpg.spell.castResolved", _onCastResolved);
  _debug("Generic Mindlock hook registered");
}
