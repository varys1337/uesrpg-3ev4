/**
 * src/core/combat/opposed/helpers/workflow.js
 * Utility helper functions for opposed workflow.
 * Extracted from opposed-workflow.js for maintainability (Phase 10).
 * 
 * This module contains general-purpose utility functions used throughout
 * the opposed workflow, including:
 * - Sensory/situational modifier collectors
 * - Weapon quality/trait checkers
 * - Distance measurement utilities  
 * - Actor/token/document resolvers
 * - Ammunition handling
 * - Dialog prompts
 * - Miscellaneous helpers
 */

import { confirmDialog, customDialog } from "../../../../utils/dialog-v2-helper.js";

import { applySenseLossPenaltyAdjustments } from "../../../traits/awareness-talents.js";
import { hasTalent } from "../../../traits/talents-api.js";
import { anyOtherTokensInMeleeOfEither, getMeleeReachMeters } from "../../../traits/combat-proximity.js";
import { canTokenEscapeTemplate } from "../../../../utils/aoe-utils.js";
import { getAttackModeFromWeapon, getEffectiveWeaponHands, getTokenDashContext } from "../../combat-utils.js";
import { isActorUndead } from "../../../traits/trait-registry.js";
import { normalizeDiceExpression } from "../rolls.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { gateRangedAttackAmmoAndLoad } from "../damage/ranged-ammo-gate.js";
import { isDebugEnabled } from "../../../../utils/debug.js";
import { _resolveItemViaActor } from "./docs.js";

/**
 * Collect sensory situational modifiers for attacker (blinded/deafened).
 */
export function collectSensorySituationalMods(decl, actor = null) {
  const out = [];
  if (!decl) return out;
  if (decl.applyBlinded) out.push({ key: "blinded", conditionKey: "blinded", label: "Blinded (sight)", value: -30, source: "sense-loss" });
  if (decl.applyDeafened) out.push({ key: "deafened", conditionKey: "deafened", label: "Deafened (hearing)", value: -30, source: "sense-loss" });
  applySenseLossPenaltyAdjustments(out, actor);
  return out;
}

/**
 * Collect sensory situational modifiers for defender (blinded/deafened).
 */
export function collectDefenseSensorySituationalMods(choice, actor = null) {
  const out = [];
  if (!choice) return out;
  if (choice.applyBlinded) out.push({ key: "blinded", conditionKey: "blinded", label: "Blinded (sight)", value: -30, source: "sense-loss" });
  if (choice.applyDeafened) out.push({ key: "deafened", conditionKey: "deafened", label: "Deafened (hearing)", value: -30, source: "sense-loss" });
  applySenseLossPenaltyAdjustments(out, actor);
  return out;
}

/**
 * Convert a value to a number (defensive).
 */
export function asNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

/**
 * Normalize a key for comparison (lowercase, no spaces/dashes).
 */
export function normalizeKey(v) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/**
 * Get the system ID (runtime or canonical).
 */
export function getSystemId() {
  return String(game?.system?.id ?? "uesrpg-3ev4");
}

/**
 * Check if a weapon has a specific quality/trait.
 */
export function weaponHasQuality(weapon, qualityKey, { allowLegacy = true } = {}) {
  if (!weapon?.system) return false;
  const target = normalizeKey(qualityKey);
  if (!target) return false;

  const structured = Array.isArray(weapon.system.qualitiesStructuredInjected)
    ? weapon.system.qualitiesStructuredInjected
    : Array.isArray(weapon.system.qualitiesStructured)
      ? weapon.system.qualitiesStructured
      : null;

  if (structured) {
    for (const q of structured) {
      const k = normalizeKey(q?.key ?? q);
      if (k && k === target) return true;
    }
  }

  const traits = Array.isArray(weapon.system.qualitiesTraitsInjected)
    ? weapon.system.qualitiesTraitsInjected
    : Array.isArray(weapon.system.qualitiesTraits)
      ? weapon.system.qualitiesTraits
      : null;

  if (traits) {
    for (const t of traits) {
      const k = normalizeKey(t);
      if (k && k === target) return true;
    }
  }

  if (!allowLegacy) return false;

  const raw = String(weapon.system.qualities ?? "");
  if (!raw) return false;

  const plain = raw
    .replace(/@Compendium\[[^\]]+\]\{([^}]+)\}/g, "$1")
    .replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = plain
    .split(/[^A-Za-z0-9]+/)
    .map(t => normalizeKey(t))
    .filter(Boolean);
  if (tokens.includes(target)) return true;

  // Last resort: substring match for legacy concatenations.
  const legacy = normalizeKey(plain);
  if (legacy && legacy.includes(target)) return true;

  return false;
}

/**
 * Parse range triplet (e.g. "2/3/4" -> {close, effective, long}).
 */
export function parseRangeTriplet(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  return { close: Number(m[1]), effective: Number(m[2]), long: Number(m[3]) };
}

/**
 * Measure distance between two points (grid-aware).
 */
export function measurePointDistance(a, b) {
  try {
    if (!a || !b) return null;

    // v13: Use namespaced Ray from foundry.canvas.geometry
    const ray = new foundry.canvas.geometry.Ray(a, b);

    // Preferred: BaseGrid.measurePath (v13+)
    const grid = canvas?.grid;
    if (grid && typeof grid.measurePath === "function") {
      const result = grid.measurePath([a, b]);
      const dist = result?.distance ?? result?.totalDistance ?? null;
      if (Number.isFinite(dist)) return dist;
    }

    // Fallback: manual calculation (deprecated measureDistances removed)
    const gridSize = Number(canvas?.scene?.grid?.size ?? 0);
    const gridDistance = Number(canvas?.scene?.grid?.distance ?? 0);
    if (gridSize > 0 && gridDistance > 0) {
      const px = Math.hypot(b.x - a.x, b.y - a.y);
      const spaces = px / gridSize;
      return spaces * gridDistance;
    }

    return null;
  } catch (err) {
    console.warn("UESRPG | Failed to measure point distance", err);
    return null;
  }
}

/**
 * Prompt user for yes/no confirmation.
 */
export async function promptYesNo({ title, content, yesLabel = "Yes", noLabel = "No" } = {}) {
  const result = await confirmDialog({
    title: title ?? "Confirm",
    content: `<div style="min-width:340px;">${content ?? ""}</div>`,
    yesLabel,
    noLabel,
  });
  // confirmDialog returns true/false/null; coerce null (close) to false for callers
  return result === true;
}

/**
 * Prompt user to select a token from a list.
 */
export async function promptSelectToken({ title, prompt, tokens = [] } = {}) {
  const choices = (Array.isArray(tokens) ? tokens : []).filter(t => t?.id && t?.name);
  if (choices.length === 0) return null;
  if (choices.length === 1) return choices[0];

  const options = choices
    .map(t => `<option value="${t.id}">${t.name}</option>`)
    .join("");
  const content = `
    <div style="min-width:360px;">
      <p style="margin:0 0 0.5em 0;">${prompt ?? "Select a target."}</p>
      <select name="tokenId" style="width:100%;">${options}</select>
    </div>`;

  return customDialog({
    title: title ?? "Select Target",
    content,
    buttons: {
      ok: {
        label: "OK",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const tokenId = root?.querySelector("select[name='tokenId']")?.value ?? null;
          return choices.find(t => t.id === tokenId) ?? null;
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    defaultButton: "ok",
  });
}

/**
 * Get all equipped one-hand melee weapons for an actor.
 */
export function getEquippedOneHandMeleeWeapons(actor) {
  const weapons = [];
  for (const it of (actor?.items ?? [])) {
    if (!it || it.type !== "weapon") continue;
    if (it.system?.equipped !== true) continue;
    const mode = getAttackModeFromWeapon(it);
    if (String(mode ?? "").toLowerCase() !== "melee") continue;
    const hands = getEffectiveWeaponHands(it);
    if (Number(hands) !== 1) continue;
    weapons.push(it);
  }
  return weapons;
}

/**
 * Get the UUID of the other dual-wield weapon (if dual wielding).
 */
export function getOtherDualWieldWeaponUuid(actor, currentWeaponUuid) {
  const weapons = getEquippedOneHandMeleeWeapons(actor);
  if (weapons.length < 2) return null;
  const cur = String(currentWeaponUuid ?? "");
  const other = weapons.find(w => String(w.uuid) !== cur) ?? null;
  return other?.uuid ?? null;
}

/**
 * Spend stamina points (authority-proxy safe).
 */
export async function spendStaminaPoints(actor, amount, { silent = true } = {}) {
  if (!actor) return false;
  const n = Math.max(0, Math.trunc(Number(amount) || 0));
  if (n <= 0) return true;

  const cur = Number(actor.system?.resources?.stamina?.value ?? 0) || 0;
  const next = cur - n;
  if (isActorUndead(actor) && next < 0) {
    ui.notifications?.warn?.("Undead cannot spend Stamina below 0.");
    return false;
  }

  const { requestUpdateDocument } = await import("../../../../utils/authority-proxy.js");
  const ok = await requestUpdateDocument(actor, { "system.resources.stamina.value": next }, { silent });
  return !!ok;
}

/**
 * Get canonical attack-type lane for all combat contexts.
 * Uses `context.attackMode` as source of truth.
 */
export function getContextAttackMode(ctx) {
  const raw = String(ctx?.attackMode ?? ctx?.attackType ?? "melee").toLowerCase().trim();
  if (raw === "ranged" || raw === "melee") return raw;
  // Defensive normalization for previously-used labels.
  if (raw.includes("rang") || raw.includes("missile") || raw.includes("projectile") || raw.includes("shoot") || raw.includes("bow") || raw.includes("crossbow") || raw.includes("throw")) return "ranged";
  return "melee";
}

/**
 * Resolve document from UUID (sync).
 */
export function resolveDoc(uuid) {
  if (!uuid) return null;
  try {
    return fromUuidSync(uuid);
  } catch (_e) {
    return null;
  }
}

/**
 * Get preferred weapon UUID for an actor.
 */
export function getPreferredWeaponUuid(actor, { meleeOnly = false } = {}) {
  const items = Array.from(actor?.items ?? []);
  const weapons = items.filter((it) => it?.type === "weapon");

  const isRangedWeapon = (w) => {
    const mode = String(w?.system?.attackMode ?? w?.system?.weaponType ?? w?.system?.type ?? "").toLowerCase();
    // Thrown weapons are commonly melee-capable (e.g., throwing knife) and should remain eligible for
    // melee-only contexts (parry/counter defaults). Treat them as NOT purely ranged.
    const isThrown = weaponHasQuality(w, "thrown") ||
      (String(w?.system?.rangeBandsDerivedEffective?.kind ?? w?.system?.rangeBandsDerived?.kind ?? "") === "thrown");
    if (isThrown) return false;
    return mode.includes("ranged");
  };

  const filtered = meleeOnly ? weapons.filter((w) => !isRangedWeapon(w)) : weapons;

  // Prefer the system's equipped weapon binding if present (primary -> secondary).
  const ew = actor?.system?.equippedWeapons;
  const boundIds = [
    ew?.primaryWeapon?.id,
    ew?.secondaryWeapon?.id,
    ew?.equippedWeapons?.primaryWeapon?.id,
    ew?.equippedWeapons?.secondaryWeapon?.id
  ].filter(Boolean);

  for (const id of boundIds) {
    const bound = actor?.items?.get?.(id);
    if (!bound || bound.type !== "weapon") continue;
    if (meleeOnly && isRangedWeapon(bound)) continue;
    if (filtered.some((w) => w.id === bound.id)) return bound.uuid;
  }

  // Fall back to per-item equipped flag if present.
  const equipped = filtered.find((w) => w.system?.equipped === true);
  if (equipped?.uuid) return equipped.uuid;

  // Final fallback: first available weapon of the requested category.
  return filtered[0]?.uuid ?? "";
}

/**
 * Pre-consume attack ammunition (ranged attacks only).
 * Returns false to abort attack if ammo missing.
 */
export async function preConsumeAttackAmmo(attacker, data) {
  const attackMode = getContextAttackMode(data?.context);
  if (String(attackMode ?? "").toLowerCase() !== "ranged") return true;

  try {
    // Idempotency guard: if ammo was already consumed for this workflow, do not consume again.
    if (data?.attacker?.preConsumedAmmo) return true;

    const weaponUuid = String(data?.context?.weaponUuid ?? "") || getPreferredWeaponUuid(attacker, { meleeOnly: false }) || "";
    if (!weaponUuid) return true;

    const weapon = _resolveItemViaActor(weaponUuid, attacker);
    if (!weapon || weapon.type !== "weapon") return true;

    // Do not consume ammunition for thrown attacks.
    const isThrown = weaponHasQuality(weapon, "thrown") ||
      (String(weapon.system?.rangeBandsDerivedEffective?.kind ?? weapon.system?.rangeBandsDerived?.kind ?? "") === "thrown");
    if (isThrown) return true;

    // Only enforce on ranged weapons.
    if (String(weapon.system?.attackMode ?? "melee").toLowerCase() !== "ranged") return true;

    const shouldConsume = weapon.system?.consumeAmmo !== false;
    const ammoId = String(weapon.system?.ammoId ?? "").trim();
    const ammo = (shouldConsume && ammoId) ? (attacker.items.get(ammoId) ?? null) : null;

    // Canonical gate: block unloaded weapons and invalid ammo *before* committing ammunition.
    const gate = gateRangedAttackAmmoAndLoad({ actor: attacker, weapon, ammoItem: ammo });
    if (!gate.ok) {
      const msg =
        gate.code === "AMMO_MISSING" ? `${weapon.name}: selected ammunition could not be resolved.`
        : gate.code === "AMMO_EMPTY" ? `${ammo?.name ?? "Ammunition"}: no ammunition remaining.`
        : gate.reason;
      ui.notifications.warn(msg);
      return false;
    }

    if (!shouldConsume) return true;

    if (!ammoId) {
      ui.notifications.warn(`${weapon.name}: no ammunition selected.`);
      return false;
    }

    if (!ammo || ammo.type !== "ammunition") {
      ui.notifications.warn(`${weapon.name}: selected ammunition could not be resolved.`);
      return false;
    }

    const qty = Number(ammo.system?.quantity ?? 0);
    if (!(qty > 0)) {
      ui.notifications.warn(`${ammo.name}: no ammunition remaining.`);
      return false;
    }

    await requestUpdateDocument(ammo, { "system.quantity": Math.max(0, qty - 1) });

    const pre = {
      weaponUuid: weapon.uuid,
      ammoId,
      ammoUuid: ammo.uuid,
      ammoName: ammo.name,
      consumedAt: Date.now()
    };

    data.attacker = data.attacker ?? {};
    data.attacker.preConsumedAmmo = pre;
    data.context = data.context ?? {};
    data.context.consumedAmmo = true;

    return true;
  } catch (err) {
    console.error("UESRPG | Pre-consume attack ammo failed", err);
    ui.notifications.error("Failed to consume ammunition for this attack. See console for details.");
    return false;
  }
}

export { markWeaponNeedsReload } from "../damage/ammunition.js";

/**
 * Resolve actor from document or UUID.
 */
export function resolveActor(docOrUuid) {
  const doc = typeof docOrUuid === "string" ? resolveDoc(docOrUuid) : docOrUuid;
  if (!doc) return null;
  if (doc.documentName === "Actor") return doc;
  if (doc.documentName === "Token") return doc.actor ?? null;
  if (doc.actor) return doc.actor;
  return null;
}

/**
 * Resolve token from document or UUID.
 */
export function resolveToken(docOrUuid) {
  const doc = typeof docOrUuid === "string" ? resolveDoc(docOrUuid) : docOrUuid;
  if (!doc) return null;
  // TokenDocument
  if (doc.documentName === "Token") return doc.object ?? null;
  // Token
  if (doc.actor && doc.document) return doc;
  return null;
}

/**
 * Check if two tokens are in isolated duel (for Exploit Advantage).
 */
export function isIsolatedDuelByTokens(tokenA, tokenB) {
  try {
    if (!tokenA || !tokenB) return false;
    if (!globalThis?.canvas?.ready) return false;
    const reachA = getMeleeReachMeters(tokenA.actor);
    const reachB = getMeleeReachMeters(tokenB.actor);
    return !anyOtherTokensInMeleeOfEither(tokenA, tokenB, { reachMetersA: reachA, reachMetersB: reachB });
  } catch (_e) {
    return false;
  }
}

/**
 * Check if actor can use Exploit Advantage talent.
 */
export function canUseExploitAdvantage(actor, { actorTokenUuid = null, opponentTokenUuid = null } = {}) {
  if (!actor || !hasTalent(actor, "exploitadvantage")) return false;
  const aTok = actorTokenUuid ? resolveToken(actorTokenUuid) : null;
  const oTok = opponentTokenUuid ? resolveToken(opponentTokenUuid) : null;
  if (!aTok || !oTok) return false;
  return isIsolatedDuelByTokens(aTok, oTok);
}

/**
 * Check if current user can control actor.
 */
export function canControlActor(actor) {
  return game.user.isGM || actor?.isOwner;
}

/**
 * Prompt for AoE evade escape (1m move).
 */
export async function promptAoEEvadeEscape({ defenderName = "Defender", attackLabel = "the attack" } = {}) {
  try {
    return await confirmDialog({
      title: "AoE Evade",
      content: `<p>${defenderName} successfully evaded ${attackLabel}. Can they move 1m to exit the area?</p>`,
      yesLabel: "Escapes AoE",
      noLabel: "Still in AoE",
    });
  } catch (_e) {
    return null;
  }
}

/**
 * Maybe set AoE evade escape state on defender entry.
 */
export async function maybeSetAoEEvadeEscape(data, defenderEntry, defenderActor) {
  if (!data || !defenderEntry) return null;
  const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
  if (!isAoE) return null;

  const defenseType = String(defenderEntry.defenseType ?? "").toLowerCase();
  if (defenseType !== "evade") return null;

  if (!defenderEntry?.result?.isSuccess) return null;
  if (defenderEntry.aoeEvadeEscaped === true) return true;
  if (defenderEntry.aoeEvadeEscaped === false) return false;

  const templateUuid = data?.context?.aoe?.templateUuid ?? null;
  const templateId = data?.context?.aoe?.templateId ?? null;
  const token = resolveToken(defenderEntry?.tokenUuid ?? defenderActor?.uuid);

  let canEscape = canTokenEscapeTemplate({ templateUuid, templateId, token, stepMeters: 1 });
  if (canEscape == null) {
    const canPrompt = game.user?.isGM || (defenderActor && canControlActor(defenderActor));
    if (canPrompt) {
      canEscape = await promptAoEEvadeEscape({
        defenderName: defenderActor?.name ?? defenderEntry?.name ?? "Defender",
        attackLabel: data?.attacker?.label ?? "the attack"
      });
    }
  }

  if (canEscape != null) {
    defenderEntry.aoeEvadeEscaped = Boolean(canEscape);
    defenderEntry.aoeEvadeFailed = !canEscape;
  }

  return canEscape;
}

/**
 * Apply AoE evade outcome (convert defender win to attacker win if still in area).
 */
export function applyAoEEvadeOutcome(data, outcome, defenderEntry = null) {
  if (!data || !outcome) return outcome;
  const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
  if (!isAoE) return outcome;

  const def = defenderEntry ?? data.defender;
  if (!def) return outcome;

  const defenseType = String(def.defenseType ?? "none").toLowerCase();
  if (defenseType !== "evade") return outcome;
  if (outcome.winner !== "defender") return outcome;

  const A = data.attacker?.result;
  if (!A?.isSuccess) return outcome;

  const name = def?.name ?? "Defender";
  if (def.aoeEvadeEscaped === false) {
    return { ...outcome, winner: "attacker", text: `${name} evades but remains in the area; attack hits.` };
  }
  if (def.aoeEvadeEscaped === true) {
    return { ...outcome, winner: "defender", text: `${name} evades and escapes the area.` };
  }
  return { ...outcome, text: `${name} evades. Resolve 1m move to determine if the area still applies.` };
}

/**
 * Get variant label for display.
 */
export function variantLabel(variant) {
  switch (variant) {
    case "allOut": return "All Out";
    case "precision": return "Precision";
    case "coup": return "Coup";
    case "normal":
    default: return "Attack";
  }
}

/**
 * Get circumstance label for display.
 */
export function circumstanceLabel(mod) {
  const v = Number(mod ?? 0) || 0;
  switch (v) {
    case -10: return "Minor Disadvantage (-10)";
    case -20: return "Disadvantage (-20)";
    case -30: return "Major Disadvantage (-30)";
    default: return "—";
  }
}

/**
 * Get defense gating context (weapon traits that restrict defense options).
 */
export async function getDefenseGatingContext({ attacker, defender, data }) {
  const attackerWeaponTraits = { flail: false, entangling: false, isTwoHanded: false };
  let defenderHasSmallWeapon = false;

  try {
    const wUuid = String(data?.context?.weaponUuid ?? '').trim() || getPreferredWeaponUuid(attacker, { meleeOnly: false });
    if (wUuid) {
      const w = _resolveItemViaActor(wUuid, attacker);
      if (w?.type === 'weapon') {
        attackerWeaponTraits.flail = weaponHasQuality(w, 'flail', { allowLegacy: false });
        attackerWeaponTraits.entangling = weaponHasQuality(w, 'entangling');

        const handed = getEffectiveWeaponHands(w);
        const traitTwoHanded = weaponHasQuality(w, 'twoHanded', { allowLegacy: true });
        attackerWeaponTraits.isTwoHanded = Boolean(traitTwoHanded || handed?.isTwoHanded);
      }
    }

    try {
      const weaponMap = new Map();
      const addWeapon = (it) => {
        if (!it || it.type !== 'weapon') return;
        if (!it.id) return;
        weaponMap.set(it.id, it);
      };

      const ew = defender?.system?.equippedWeapons;
      const boundIds = [
        ew?.primaryWeapon?.id,
        ew?.secondaryWeapon?.id,
        ew?.equippedWeapons?.primaryWeapon?.id,
        ew?.equippedWeapons?.secondaryWeapon?.id
      ].filter(Boolean);

      for (const id of boundIds) {
        const bound = defender?.items?.get?.(id);
        if (bound) addWeapon(bound);
      }

      for (const it of (defender?.items ?? [])) {
        if (!it || it.type !== 'weapon') continue;
        if (!it.system || !Object.prototype.hasOwnProperty.call(it.system, 'equipped')) continue;
        if (it.system.equipped === true) addWeapon(it);
      }

      const equippedWeapons = Array.from(weaponMap.values());
      defenderHasSmallWeapon = equippedWeapons.some(w => weaponHasQuality(w, 'small', { allowLegacy: true }));
    } catch (_innerErr) {
      defenderHasSmallWeapon = false;
    }
  } catch (err) {
    console.warn('UESRPG | opposed-workflow | defense gating context lookup failed', err);
  }

  return { attackerWeaponTraits, defenderHasSmallWeapon };
}

/**
 * Get token movement action (for defense TN modifiers).
 */
export function getTokenMovementAction(token) {
  const doc = token?.document ?? null;
  const raw = doc?.movementAction ?? doc?.movement?.action ?? doc?.movement?.mode ?? "";
  return String(raw ?? "").toLowerCase();
}

/**
 * Get weapon reach in meters.
 */
export function getWeaponReachMeters(weapon, actor) {
  const reach = Number(weapon?.system?.reach ?? weapon?.system?.reachMax ?? weapon?.system?.reachMeters ?? NaN);
  if (Number.isFinite(reach) && reach > 0) return reach;
  return getMeleeReachMeters(actor);
}

/**
 * Get Thunder Charge eligibility context.
 */
export function getThunderChargeEligibility({ attacker, attackerToken, defenderToken, weapon }) {
  if (!attacker || !attackerToken || !defenderToken) return { eligible: false, reason: "missing-token" };
  if (!hasTalent(attacker, "thundercharge")) return { eligible: false, reason: "no-talent" };

  const mode = getAttackModeFromWeapon(weapon);
  if (mode !== "melee") return { eligible: false, reason: "not-melee" };

  const dash = getTokenDashContext(attackerToken);
  if (!dash) return { eligible: false, reason: "no-dash" };

  const combat = (game.combat && game.combat.started) ? game.combat : null;
  if (!combat) return { eligible: false, reason: "no-combat" };

  const dashRound = Number(dash.round ?? -1);
  const dashTurn = Number(dash.turn ?? -1);
  if (dash.combatId && dash.combatId !== combat.id) return { eligible: false, reason: "combat-mismatch" };
  if (dashRound !== Number(combat.round ?? -2)) return { eligible: false, reason: "round-mismatch" };
  if (dashTurn !== Number(combat.turn ?? -2)) return { eligible: false, reason: "turn-mismatch" };

  const start = { x: Number(dash.x ?? NaN), y: Number(dash.y ?? NaN) };
  const end = attackerToken?.center ?? attackerToken?.object?.center ?? null;
  const target = defenderToken?.center ?? defenderToken?.object?.center ?? null;
  if (!end || !target || !Number.isFinite(start.x) || !Number.isFinite(start.y)) {
    return { eligible: false, reason: "no-position" };
  }

  const startDist = measurePointDistance(start, target);
  const endDist = measurePointDistance(end, target);
  if (startDist == null || endDist == null) {
    return { eligible: false, reason: "no-distance" };
  }

  const reach = getWeaponReachMeters(weapon, attacker);

  if (startDist < 4) return { eligible: false, reason: "start-too-close" };
  if (startDist <= reach) return { eligible: false, reason: "start-in-melee" };
  if (endDist > reach) return { eligible: false, reason: "not-in-melee" };

  return { eligible: true, startDist, endDist, reach };
}

/**
 * Infer attack mode from actor's preferred weapon.
 */
export async function inferAttackModeFromPreferredWeapon(actor) {
  try {
    const weaponUuid = getPreferredWeaponUuid(actor, { meleeOnly: false }) || "";
    if (!weaponUuid) return "melee";

    const weapon = _resolveItemViaActor(weaponUuid, actor);
    if (!weapon || weapon.type !== "weapon") return "melee";

    const mode = String(getAttackModeFromWeapon(weapon) ?? "").toLowerCase();
    return mode === "ranged" ? "ranged" : "melee";
  } catch (_err) {
    return "melee";
  }
}

/**
 * Check if debug logging is enabled.
 */
export function debugEnabled() {
  return isDebugEnabled("opposedDebug");
}

/**
 * Log debug event (if debug enabled).
 */
export function logDebug(event, payload) {
  if (!debugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.log(`UESRPG Opposed | ${event}`, payload);
    try {
      const id = payload?.messageId ?? payload?.parentMessageId ?? null;
      game.uesrpg?.debug?.recordOpposedEvent?.(id, event, payload);
    } catch (_e2) {
      /* no-op */
    }
  } catch (_e) {}
}

/**
 * Check if user has actor ownership.
 */
export function userHasActorOwnership(user, actor) {
  try {
    if (!user || !actor) return false;
    if (user.isGM) return true;
    if (typeof actor.testUserPermission === 'function') {
      return actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
    }
    const level = Number(actor?.ownership?.[user.id] ?? 0);
    return level >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  } catch (_e) {
    return false;
  }
}

/**
 * Safely get a game setting (with fallback).
 */
export function safeGetSetting(namespace, key, fallback = false) {
  try {
    const full = `${namespace}.${key}`;
    if (game?.settings?.settings?.has?.(full) === false) return fallback;
    if (typeof game?.settings?.get === "function") return game.settings.get(namespace, key);
  } catch (_e) {
    // ignore and fall back
  }
  return fallback;
}

/**
 * Build opposed workflow flags for chat messages.
 */
export function opposedFlags(parentMessageId, stage, extra = null) {
  const base = {
    parentMessageId,
    stage
  };
  const opposed = (extra && typeof extra === "object") ? foundry.utils.mergeObject(base, extra, { inplace: false }) : base;
  return {
    "uesrpg-3ev4": {
      opposed
    }
  };
}
