/**
 * src/core/combat/opposed/damage/roller.js
 *
 * Weapon damage rolling logic for opposed combat.
 * Extracted from monolith (Phase 14) to improve modularity and performance.
 *
 * Exported functions:
 * - rollWeaponDamage: Calculate and roll weapon damage with qualities, ammo, talents
 * - rollManualDamage: Roll simple damage formula
 */

import { hasTalent } from "../../../traits/talents-api.js";
import { getEffectiveWeaponHands } from "../../combat-utils.js";
import { normalizeDiceExpression, safeEvaluateRoll } from "../rolls.js";
import { itemHasToken } from "../../damage/tokens.js";

function _stepUpNaturalWeaponDice(expr) {
  const s = String(expr ?? "").trim();
  if (!s) return s;

  const nextDie = (faces) => {
    const f = Number(faces);
    if (f === 4) return { countMult: 1, faces: 6 };
    if (f === 6) return { countMult: 1, faces: 8 };
    if (f === 8) return { countMult: 1, faces: 10 };
    if (f === 10) return { countMult: 1, faces: 12 };
    if (f === 12) return { countMult: 2, faces: 8 }; // RAW example: d12 -> 2d8
    return null;
  };

  return s.replace(/(\d*)d(4|6|8|10|12)\b/gi, (_m, countRaw, facesRaw) => {
    const count = Number(countRaw || 1);
    const next = nextDie(facesRaw);
    if (!next || !Number.isFinite(count) || count <= 0) return `${countRaw}d${facesRaw}`;
    const nextCount = count * next.countMult;
    return `${nextCount}d${next.faces}`;
  });
}

/**
 * Helper to check if weapon has a specific trait text (case-insensitive).
 */
function _weaponHasTraitText(weapon, traitText) {
  const traits = Array.isArray(weapon.system?.qualitiesTraits) ? weapon.system.qualitiesTraits : [];
  const traitLower = String(traitText ?? "").toLowerCase();
  return traits.some(t => String(t ?? "").toLowerCase().includes(traitLower));
}

/**
 * Roll weapon damage with all applicable modifiers, qualities, and ammunition.
 * Returns damage data including rolls, final damage, and pending ammo consumption.
 */
export async function rollWeaponDamage({ weapon, preConsumedAmmo = null, context = null }) {
  const addFlatBonus = (expr, bonus) => {
    const b = Number(bonus || 0);
    if (!Number.isFinite(b) || b === 0) return String(expr ?? "0");
    const e = String(expr ?? "0").trim();
    // Keep the expression readable; do not attempt to parse dice groups.
    return b > 0 ? `${e}+${b}` : `${e}${b}`;
  };

  let damageString =
    (weapon.system.damage3Effective ?? weapon.system.damage3 ?? weapon.system.damage2Effective ?? weapon.system.damage2 ?? weapon.system.damageEffective ?? weapon.system.damage) || "0";

  // Khajiit racial talent (Chapter 4): Eye of Night — increase natural weapon damage die size by one step.
  try {
    const actor = weapon?.actor ?? null;
    if (actor && itemHasToken(weapon, "handToHand") && hasTalent(actor, "eyeofnight")) {
      damageString = _stepUpNaturalWeaponDice(damageString);
    }
  } catch (_e) {
    // non-blocking
  }

  // Unstoppable Might (Chapter 4): special wield modes can override the effective damage value.
  // We apply this only when the attacker explicitly confirms special wield usage.
  try {
    const actor = weapon?.actor ?? null;
    const umActive = Boolean(context?.unstoppableMight?.active);
    if (actor && umActive && hasTalent(actor, 'unstoppablemight')) {
      const handed = getEffectiveWeaponHands(weapon);
      const isHandAndAHalfOneHand = Boolean(handed?.isHandAndAHalf) && Number(handed?.effectiveHands ?? 0) === 1;
      const isTrueTwoHanded = Boolean(handed?.isTwoHanded) && !Boolean(handed?.isHandAndAHalf);
      if (isHandAndAHalfOneHand || isTrueTwoHanded) {
        damageString = (weapon.system.damage2Effective ?? weapon.system.damage2 ?? damageString) || damageString;
      }
    }
  } catch (err) {
    console.warn('UESRPG | opposed-workflow | Unstoppable Might damage override failed', err);
  }

  /** @type {{ammoUuid:string, qtyAfter:number, ammoName:string}|null} */
  let pendingAmmo = null;

  // Ranged: add ammunition contribution (damage bonus) from the selected ammunition item.
  // Ammunition quantity is consumed at ATTACK TIME (before the attack roll), not here.
  // This function only reads ammo data for damage expression enrichment and gates legacy/stale cards defensively.
  if (String(weapon.system?.attackMode ?? "melee").toLowerCase() === "ranged" && weapon.actor) {
    // Do not involve ammunition for thrown attacks.
    const injected = Array.isArray(weapon.system?.qualitiesStructuredInjected)
      ? weapon.system.qualitiesStructuredInjected
      : Array.isArray(weapon.system?.qualitiesStructured)
        ? weapon.system.qualitiesStructured
        : [];
    const traits = Array.isArray(weapon.system?.qualitiesTraits) ? weapon.system.qualitiesTraits : [];
    const hasThrown = injected.some(q => String(q?.key ?? q ?? "").toLowerCase() === "thrown")
      || traits.some(t => String(t ?? "").toLowerCase() === "thrown")
      || (String(weapon.system?.rangeBandsDerivedEffective?.kind ?? weapon.system?.rangeBandsDerived?.kind ?? "") === "thrown");
    const hasSling = injected.some(q => String(q?.key ?? q ?? "").toLowerCase() === "sling")
      || traits.some(t => String(t ?? "").toLowerCase() === "sling")
      || _weaponHasTraitText(weapon, "sling");
    if (hasThrown) {
      // Leave pendingAmmo null and do not gate on ammo.
    } else {
    const shouldConsume = weapon.system?.consumeAmmo !== false;
    const ammoId = String(weapon.system?.ammoId ?? "").trim();


    const preConsumedMatches = !!(preConsumedAmmo
      && preConsumedAmmo.weaponUuid
      && preConsumedAmmo.ammoId
      && preConsumedAmmo.weaponUuid === weapon.uuid
      && preConsumedAmmo.ammoId === ammoId);

    // If the weapon is configured to consume ammo, enforce that ammo exists.
    // Quantity can be 0 here if the last shot was consumed at attack time.
    if (shouldConsume) {
      if (!ammoId) {
        ui.notifications.warn(`${weapon.name}: no ammunition selected.`);
        return null;
      }
      const ammo = weapon.actor.items.get(ammoId);
      if (!ammo || ammo.type !== "ammunition") {
        ui.notifications.warn(`${weapon.name}: selected ammunition could not be resolved.`);
        return null;
      }
      const qty = Number(ammo.system?.quantity ?? 0);
      // Defensive gating for legacy/stale cards: if we did not see a pre-consumption record, require qty > 0.
      // In the normal opposed flow, ammo is always pre-consumed at attack time.
      if (!preConsumedMatches && !(qty > 0)) {
        ui.notifications.warn(`${ammo.name}: no ammunition remaining.`);
        return null;
      }

      if (!hasSling) {
        const ammoExpr = normalizeDiceExpression(ammo.system?.damageEffective ?? ammo.system?.damage ?? "0");
        let ammoBonus = 0;
        try {
          const r = await safeEvaluateRoll(ammoExpr);
          ammoBonus = Number(r.total) || 0;
        } catch (err) {
          console.warn("UESRPG | Failed to evaluate ammunition damage expression", { ammoId, ammoExpr, err });
        }
        damageString = addFlatBonus(damageString, ammoBonus);
      }

      // Ammo is already consumed earlier; do not schedule consumption here.
      pendingAmmo = null;
    } else if (ammoId) {
      // Ammo is configured but consumption is disabled; treat ammo as optional damage modifier.
      const ammo = weapon.actor.items.get(ammoId);
      if (ammo?.type === "ammunition" && !hasSling) {
        const ammoExpr = normalizeDiceExpression(ammo.system?.damageEffective ?? ammo.system?.damage ?? "0");
        let ammoBonus = 0;
        try {
          const r = await safeEvaluateRoll(ammoExpr);
          ammoBonus = Number(r.total) || 0;
        } catch (err) {
          console.warn("UESRPG | Failed to evaluate ammunition damage expression", { ammoId, ammoExpr, err });
        }
        damageString = addFlatBonus(damageString, ammoBonus);
      }
    }
    }
  }

  const structured = Array.isArray(weapon.system.qualitiesStructuredInjected)
    ? weapon.system.qualitiesStructuredInjected
    : Array.isArray(weapon.system.qualitiesStructured)
      ? weapon.system.qualitiesStructured
      : [];
  const hasQ = (key) => structured.some(q => String(q?.key ?? q ?? "").toLowerCase() === key);

  const wantsProven = hasQ("proven");
  const wantsPrimitive = hasQ("primitive");
  const wantsSuperior = !!weapon.system.superior;

  // Damaged (X): reduces weapon damage. Apply as a flat modifier to the damage expression.
  const damagedValue = (() => {
    const q = structured.find(e => String(e?.key ?? e ?? "").toLowerCase() === "damaged");
    const v = Number(q?.value ?? 0);
    return Number.isFinite(v) ? v : 0;
  })();
  if (damagedValue > 0) {
    damageString = addFlatBonus(damageString, -damagedValue);
  }

  const a = await safeEvaluateRoll(damageString);
  damageString = a.formula;
  let b = null;
  let total = Number(a.total);

  let rerollMode = null;
  if (wantsSuperior || wantsProven || wantsPrimitive) {
    b = await safeEvaluateRoll(damageString);
    const alt = Number(b.total);
    if (wantsPrimitive && !wantsProven) {
      total = Math.min(total, alt);
      rerollMode = "primitive";
    } else {
      total = Math.max(total, alt);
      rerollMode = (wantsSuperior || wantsProven) ? "proven" : null;
    }
  }

  return { damageString, rollA: a, rollB: b, finalDamage: total, pendingAmmo, rerollMode, damagedValue };
}

/**
 * Roll manual damage from a simple formula.
 */
export async function rollManualDamage({ formula }) {
  const expr = normalizeDiceExpression(formula);
  const rollA = await safeEvaluateRoll(expr);
  return {
    damageString: rollA.formula,
    rollA,
    rollB: null,
    finalDamage: Number(rollA.total) || 0
  };
}
