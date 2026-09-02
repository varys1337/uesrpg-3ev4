/**
 * @module magic/services/dispel-service
 *
 * src/core/magic/dispel-service.js
 *
 * Dispel spell automation for UESRPG 3ev4.
 *
 * RAW (Chapter 6, Mysticism — Dispel):
 *  - "Undoes both harmful and beneficial magical effects from all schools of magic."
 *  - Dispel's Spell Strength determines the maximum Spell Level it can remove.
 *  - Spell Strength table: SL1→SS1, SL2→SS2, ... SL7→SS7
 *  - Effects are identified by machine-readable flags (spellEffect, spellUuid, etc.)
 *  - If multiple effects qualify, the caster selects which to dispel (or all).
 *
 * Implementation:
 *  - Enumerate spell effects on a target via flags.uesrpg-3ev4.spellEffect
 *  - Filter by Spell Level ≤ Spell Strength of the Dispel spell
 *  - Prefer Origin AE teardown route for clean linked-entity cleanup
 *  - If no Origin AE exists (older effects), delete target AEs directly
 *  - Emits `uesrpg.spell.dispelled` hook for extensibility
 *
 * Target: Foundry VTT v13.351
 */

import { cancelOriginAEUpkeep, getOriginAEs, findOriginAE } from "../effects/origin-effect.js";
import { requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { _num, _str, createDebugLogger } from "../_primitives.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { resolveActorFromUuidSync } from "../../../utils/uuid-cache.js";

const _FLAG_NS = FLAG_SCOPE;

const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][Dispel]");

// ─── Effect Enumeration ──────────────────────────────────────────────────────

/**
 * @typedef {object} DispellableEffect
 * @property {string} id — Effect ID on the target actor
 * @property {string} name — Effect/spell display name
 * @property {string} img — Effect icon
 * @property {string} spellUuid — Source spell UUID
 * @property {string} spellSchool — School of magic
 * @property {number} spellLevel — Spell level (used for SS comparison)
 * @property {string} casterUuid — UUID of the original caster
 * @property {string} casterName — Display name of the caster
 * @property {boolean} hasOriginAE — Whether an Origin AE exists for clean teardown
 * @property {string|null} originAEUuid — UUID of the Origin AE (if any)
 */

/**
 * Enumerate all spell effects on a target that could be dispelled.
 *
 * @param {Actor} targetActor - The target to scan
 * @param {object} [opts]
 * @param {number} [opts.maxSpellLevel] — Maximum spell level to include (Spell Strength filter)
 * @returns {DispellableEffect[]}
 */
export function enumerateDispellableEffects(targetActor, opts = {}) {
  if (!targetActor) return [];
  const maxSL = _num(opts.maxSpellLevel, Infinity);

  /** @type {DispellableEffect[]} */
  const results = [];

  // De-duplicate by spellUuid + casterUuid to group multiple changes from the same cast
  const seen = new Set();

  for (const ef of (targetActor.effects ?? [])) {
    const f = ef.flags?.[_FLAG_NS];
    if (!f?.spellEffect) continue;
    if (f.isOriginAE) continue; // Origin AEs are on the caster, not target

    const spellLevel = _num(f.spellLevel, 0);
    if (spellLevel > maxSL) continue;

    const spellUuid = _str(f.spellUuid);
    const casterUuid = _str(f.casterUuid);
    const dedupeKey = `${spellUuid}::${casterUuid}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // Resolve caster name
    let casterName = "Unknown";
    if (casterUuid) {
      const actor = resolveActorFromUuidSync(casterUuid);
      if (actor) casterName = actor.name;
    }

    results.push({
      id: ef.id,
      name: _str(f.spellName || ef.name),
      img: ef.img || "icons/svg/aura.svg",
      spellUuid,
      spellSchool: _str(f.spellSchool),
      spellLevel,
      casterUuid,
      casterName,
      hasOriginAE: Boolean(f.originAEUuid || f.originAEId),
      originAEUuid: _str(f.originAEUuid) || null
    });
  }

  // Sort by spell level descending (highest level first, most impactful)
  results.sort((a, b) => b.spellLevel - a.spellLevel);

  return results;
}

// ─── Dispel Execution ────────────────────────────────────────────────────────

/**
 * Dispel one or more spell effects from a target.
 *
 * Prefers Origin AE teardown for clean linked-entity cleanup.
 * Falls back to direct AE deletion for legacy/orphan effects.
 *
 * @param {Actor} targetActor - The target whose effects are being dispelled
 * @param {DispellableEffect[]} effects - Effects to dispel (from enumerateDispellableEffects)
 * @param {object} [opts]
 * @param {Actor} [opts.dispellerActor] - The actor casting Dispel
 * @param {string} [opts.dispelSpellName] - Name of the dispel spell
 * @param {number} [opts.spellStrength] - Spell Strength of the dispel
 * @returns {Promise<{dispelled: number, errors: string[]}>}
 */
export async function dispelEffects(targetActor, effects, opts = {}) {
  if (!targetActor || !effects?.length) return { dispelled: 0, errors: [] };

  _debug("Dispelling effects", {
    target: targetActor.name,
    count: effects.length,
    effects: effects.map(e => e.name)
  });

  let dispelled = 0;
  const errors = [];

  for (const entry of effects) {
    try {
      const success = await _dispelSingleEffect(targetActor, entry);
      if (success) dispelled++;
    } catch (err) {
      const msg = `Failed to dispel "${entry.name}": ${err.message}`;
      errors.push(msg);
      _debug("Dispel error:", msg);
    }
  }

  // Emit hook
  try {
    Hooks.callAll("uesrpg.spell.dispelled", {
      targetActor,
      dispellerActor: opts.dispellerActor ?? null,
      dispelSpellName: opts.dispelSpellName ?? "Dispel",
      spellStrength: _num(opts.spellStrength, 0),
      dispelled,
      effects: effects.map(e => ({ name: e.name, spellLevel: e.spellLevel, spellSchool: e.spellSchool })),
      errors
    });
  } catch (_e) { /* no-op */ }

  // Chat notification
  if (dispelled > 0) {
    try {
      const dispellerName = opts.dispellerActor?.name ?? "Unknown";
      const effectNames = effects.filter((_, i) => i < dispelled).map(e => e.name).join(", ");
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>Dispel</h3><p><strong>${dispellerName}</strong> dispels <strong>${effectNames}</strong> from <strong>${targetActor.name}</strong>.</p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: opts.dispellerActor ?? targetActor }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    } catch (_e) { /* no-op */ }
  }

  _debug("Dispel complete", { dispelled, errors: errors.length });
  return { dispelled, errors };
}

/**
 * Dispel a single spell effect.
 * Routes through Origin AE teardown if possible.
 *
 * @param {Actor} targetActor
 * @param {DispellableEffect} entry
 * @returns {Promise<boolean>}
 */
async function _dispelSingleEffect(targetActor, entry) {
  // Route 1: Origin AE teardown (preferred — cleans linked entities)
  if (entry.originAEUuid) {
    try {
      const originDoc = await fromUuid(entry.originAEUuid);
      if (originDoc) {
        const parent = originDoc.parent;
        if (parent) {
          await cancelOriginAEUpkeep(originDoc);
          _debug("Dispelled via Origin AE teardown:", entry.name);
          return true;
        }
      }
    } catch (_e) {
      // Fall through to direct deletion
    }
  }

  // Route 2: Try to find Origin AE on the caster by spell UUID
  if (entry.casterUuid && entry.spellUuid) {
    const casterActor = resolveActorFromUuidSync(entry.casterUuid);
    if (casterActor) {
      const originAE = findOriginAE(casterActor, entry.spellUuid);
      if (originAE) {
        await cancelOriginAEUpkeep(originAE);
        _debug("Dispelled via caster Origin AE:", entry.name);
        return true;
      }
    }
  }

  // Route 3: Direct AE deletion (legacy/orphan effects without Origin AE)
  const toDelete = [];
  for (const ef of (targetActor.effects ?? [])) {
    const f = ef.flags?.[_FLAG_NS];
    if (!f?.spellEffect) continue;
    if (_str(f.spellUuid) !== entry.spellUuid) continue;
    if (_str(f.casterUuid) !== entry.casterUuid) continue;
    toDelete.push(ef.id);
  }

  if (toDelete.length) {
    await requestDeleteEmbeddedDocuments(targetActor, "ActiveEffect", toDelete, {
      deleteOptions: { uesrpgExpirationSweep: true }
    });
    _debug("Dispelled via direct AE deletion:", entry.name, toDelete.length, "effects");
    return true;
  }

  return false;
}

// ─── Dispel Selection Dialog ─────────────────────────────────────────────────

/**
 * Show a dialog letting the dispeller choose which effects to remove.
 *
 * @param {Actor} targetActor - Target with spell effects
 * @param {object} [opts]
 * @param {number} [opts.spellStrength] - Spell Strength of the Dispel
 * @param {Actor} [opts.dispellerActor] - Caster of Dispel
 * @param {string} [opts.dispelSpellName] - Name of the dispel spell
 * @returns {Promise<{dispelled: number, errors: string[]}|null>} null if cancelled
 */
export async function showDispelDialog(targetActor, opts = {}) {
  const spellStrength = _num(opts.spellStrength, 7);
  const effects = enumerateDispellableEffects(targetActor, { maxSpellLevel: spellStrength });

  if (!effects.length) {
    ui.notifications.info(`${targetActor.name} has no dispellable spell effects (SS ≤ ${spellStrength}).`);
    return null;
  }

  const checkboxes = effects.map((e, i) =>
    `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
      <input type="checkbox" name="dispel-${i}" checked />
      <img src="${e.img}" style="width:20px;height:20px;border:none;" />
      <span><strong>${e.name}</strong> (Lv.${e.spellLevel} ${e.spellSchool})</span>
      <span style="color:#888;font-size:0.85em;">by ${e.casterName}</span>
    </div>`
  ).join("");

  const content = `
    <div class="uesrpg">
      <p>Select spell effects to dispel (Spell Strength ≤ ${spellStrength}):</p>
      ${checkboxes}
      <hr/>
      <p style="font-size:0.85em;color:#666;">Dispel will remove selected effects and all their linked entities.</p>
    </div>`;

  return customDialog({
    layout: "workflow",
    title: `Dispel — ${targetActor.name}`,
    content,
    buttons: {
      dispel: {
        label: "Dispel",
        callback: async (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const selected = effects.filter((_, i) => {
            const cb = root?.querySelector(`input[name="dispel-${i}"]`);
            return cb?.checked;
          });
          if (!selected.length) return { dispelled: 0, errors: [] };
          return dispelEffects(targetActor, selected, opts);
        }
      },
      all: {
        label: "Dispel All",
        callback: async () => dispelEffects(targetActor, effects, opts)
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    default: "dispel",
    width: 480
  });
}
