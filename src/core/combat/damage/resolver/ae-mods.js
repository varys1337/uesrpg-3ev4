/**
 * src/core/combat/damage/resolver/ae-mods.js
 *
 * Active Effect modifier aggregation utilities for damage resolution.
 */

import { evaluateAEModifierKeys, evaluateAEModifierKeysDetailed } from "../../../active-effects/modifier-evaluator.js";
import { isTransferEffectActive } from "../../../active-effects/transfer.js";

/**
 * Derive deterministic AE damage modifiers at the resolver boundary.
 *
 * Keys (ADD or OVERRIDE mode):
 *  - Attacker:
 *      - system.modifiers.combat.damage.dealt       (flat bonus to raw damage BEFORE mitigation)
 *      - system.modifiers.combat.penetration        (flat bonus to penetration)
 *  - Defender:
 *      - system.modifiers.combat.damage.taken       (flat bonus to damage AFTER mitigation; negative reduces)
 *      - system.modifiers.combat.mitigation.flat    (flat mitigation AFTER reductions; positive reduces damage)
 *
 * OVERRIDE semantics:
 *  - If OVERRIDE is present for a key, it replaces all ADD contributions for that key.
 *  - Selection is deterministic via evaluateAEModifierKeys().
 *
 * @param {Actor|null} attackerActor
 * @param {Actor} defenderActor
 * @returns {{
 *  attacker:{damageDealt:number, penetration:number, entries:any[]},
 *  defender:{damageTaken:number, mitigationFlat:number, entries:any[]}
 * }}
 */
export function getAETwitterMods(attackerActor, defenderActor) {
  const atkKeys = ["system.modifiers.combat.damage.dealt", "system.modifiers.combat.penetration"];
  const defKeys = ["system.modifiers.combat.damage.taken", "system.modifiers.combat.mitigation.flat"];

  const atkResult = attackerActor ? evaluateAEModifierKeysDetailed(attackerActor, atkKeys) : null;
  const defResult = evaluateAEModifierKeysDetailed(defenderActor, defKeys);

  // Extract plain totals for numeric calculations
  const atkResolved = atkResult?.totalsByKey ?? null;
  const defResolved = defResult?.totalsByKey ?? {};

  const packEntries = (detailedResult, mapping) => {
    const out = [];
    if (!detailedResult) return out;
    const detailsByKey = detailedResult.detailsByKey ?? {};
    for (const [key, target] of Object.entries(mapping)) {
      const detail = detailsByKey[key];
      const contribs = detail?.contributions;
      if (!Array.isArray(contribs) || !contribs.length) continue;
      for (const e of contribs) {
        out.push({
          key: `ae-${target}-${e.effectId ?? foundry.utils.randomID()}`,
          label: e.label,
          value: e.value,
          target,
          mode: e.mode,
          priority: e.priority,
        });
      }
    }
    return out;
  };

  const attackerDamageDealt = atkResolved ? (atkResolved["system.modifiers.combat.damage.dealt"] ?? 0) : 0;
  const attackerPen = atkResolved ? (atkResolved["system.modifiers.combat.penetration"] ?? 0) : 0;

  const defenderDamageTaken = defResolved["system.modifiers.combat.damage.taken"] ?? 0;
  const defenderMitFlat = defResolved["system.modifiers.combat.mitigation.flat"] ?? 0;

  return {
    attacker: {
      damageDealt: attackerDamageDealt,
      penetration: attackerPen,
      entries: [
        ...packEntries(atkResult, {
          "system.modifiers.combat.damage.dealt": "damage.dealt",
          "system.modifiers.combat.penetration": "penetration",
        }),
      ],
    },
    defender: {
      damageTaken: defenderDamageTaken,
      mitigationFlat: defenderMitFlat,
      entries: [
        ...packEntries(defResult, {
          "system.modifiers.combat.damage.taken": "damage.taken",
          "system.modifiers.combat.mitigation.flat": "mitigation.flat",
        }),
      ],
    },
  };
}

/**
 * Collect typed bonus damage entries from attacker effects using the syntax: "<number>[<type>]".
 * Example: "3[fire]" yields 3 damage of type "fire".
 *
 * Deterministic mode behavior per damage type:
 *  - If any OVERRIDE entries exist for a given type, the highest-priority OVERRIDE wins for that type and ADDs are ignored.
 *  - Otherwise, ADD entries stack.
 *
 * @param {Actor} attackerActor
 * @returns {{byType: Record<string, {total:number, entries:Array<{label:string,value:number,mode:string,priority:number,effectId?:string}>}>}}
 */
export function collectTypedBonusDamage(attackerActor) {
  const ADD = CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
  const OVERRIDE = CONST?.ACTIVE_EFFECT_MODES?.OVERRIDE ?? 5;

  const parseTyped = (raw) => {
    if (raw == null) return null;
    const s = String(raw).trim();
    const m = s.match(/^(-?\d+(?:\.\d+)?)\s*\[\s*([^\]]+)\s*\]\s*$/i);
    if (!m) return null;
    const amount = Number(m[1]);
    const dtype = String(m[2]).trim().toLowerCase();
    if (!Number.isFinite(amount) || !dtype) return null;
    return { amount, dtype };
  };

  /** @type {{effect:any,label:string}[]} */
  const sources = [];

  for (const ef of (attackerActor?.effects ?? [])) {
    sources.push({ effect: ef, label: ef?.name ?? "Effect" });
  }

  for (const item of (attackerActor?.items ?? [])) {
    for (const ef of (item?.effects ?? [])) {
      if (!isTransferEffectActive(attackerActor, item, ef)) continue;
      const src = item?.name ? `${item.name}` : (ef?.name ?? "Effect");
      const label = ef?.name ? `${src}: ${ef.name}` : src;
      sources.push({ effect: ef, label });
    }
  }

  /** @type {Record<string, any[]>} */
  const collected = {};

  for (const { effect, label } of sources) {
    if (!effect || effect.disabled) continue;
    const priority = Number(effect.priority ?? 0) || 0;

    for (const ch of (Array.isArray(effect.changes) ? effect.changes : [])) {
      if (!ch) continue;
      if (ch.key !== "system.modifiers.combat.damage.dealt") continue;

      const typed = parseTyped(ch.value);
      if (!typed) continue;

      const mode = (typeof ch.mode === "number") ? ch.mode : (String(ch.mode ?? "").toUpperCase() === "OVERRIDE" ? OVERRIDE : ADD);
      const dtype = typed.dtype;
      collected[dtype] ??= [];
      collected[dtype].push({
        label,
        value: typed.amount,
        mode: (mode === OVERRIDE ? "OVERRIDE" : "ADD"),
        priority,
        effectId: effect.id,
      });
    }
  }

  /** @type {Record<string, {total:number, entries:any[]}>} */
  const byType = {};

  for (const [dtype, entries] of Object.entries(collected)) {
    const overrides = entries.filter(e => e.mode === "OVERRIDE" && Number.isFinite(e.value));
    if (overrides.length) {
      overrides.sort((a, b) => (b.priority - a.priority) || String(b.effectId ?? "").localeCompare(String(a.effectId ?? "")));
      const chosen = overrides[0];
      byType[dtype] = { total: chosen.value, entries: [chosen] };
      continue;
    }
    // ADD
    const addEntries = entries.filter(e => e.mode === "ADD" && Number.isFinite(e.value) && e.value !== 0);
    const total = addEntries.reduce((s, e) => s + e.value, 0);
    byType[dtype] = { total, entries: addEntries };
  }

  return { byType };
}
