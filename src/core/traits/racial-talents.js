/**
 * @module traits/racial-talents
 * @description Automation helpers for Racial talents (Chapter 4).
 *
 * Notes:
 * - Passive effects are applied as derived-data modifiers in actor prepare.
 * - Activated effects are applied only via explicit item activation (Activation tab / "Use").
 * - Cooldown enforcement for per-rest talents is legacy-safe and stored as actor flags.
 */

import { hasTalent, normalizeTalentKey, resolveTalentSlug } from "./talents-api.js";
import { hasCondition } from "../conditions/condition-engine.js";
import { createOrUpdateStatusEffect } from "../active-effects/status-effect.js";
import { buildEffectDuration } from "../time/effect-duration.js";
import { applyHealing } from "../combat/damage-automation.js";
import { requestUpdateDocument, requestDeleteEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { ensureWoundedPassiveEffect } from "../wounds/engine/apply.js";
import { _num } from "./_primitives.js";
import { getFlagValueWithFallback } from "../system/flags.js";
import { buildEffectChange } from "../../utils/compat.js";

const SYSTEM_SCOPE = "uesrpg-3ev4";
const CHAR_GEN_SCOPE = "uesrpg";

const SETTING_ENFORCE_CHAR_GEN = "enforceCharGenMilestones";
const FLAG_CHAR_GEN_COMPLETED = "charGen.completed";

const FLAG_RACIAL_USAGE = "racialTalentsUsage";

const EFFECT_KEY_DRAGONSKIN = "talent:dragonskin";
const EFFECT_KEY_MALACATHS_FURY = "talent:malacathsFury";
const EFFECT_KEY_ADRENALINE_RUSH = "power:adrenalinerush";

function _getEnduranceBonus(actor) {
  const explicit = _num(actor?.system?.characteristics?.end?.bonus ?? NaN, NaN);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  const total = _num(actor?.system?.characteristics?.end?.total ?? 0, 0);
  return Math.max(0, Math.floor(total / 10));
}

function _canonicalFeatureKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const slug = resolveTalentSlug(raw);
  // Preserve legacy power keys that are not talent aliases.
  if (slug === "adrenaline-rush" || slug === "adrenalinerush") return "adrenaline-rush";
  if (slug === "malacathsfury" || slug === "malacaths-fury") return "malacathsfury";
  return slug || normalizeTalentKey(raw);
}

function _getStarOfTheWestBonus(actor) {
  if (!actor) return 0;
  for (const it of (actor.items ?? [])) {
    if (!it || String(it.type ?? "") !== "trait") continue;
    const k = normalizeTalentKey(it.name);
    if (k !== "star-of-the-west") continue;
    return Math.max(0, _num(it.system?.spBonus ?? 0, 0));
  }
  return 0;
}

function _isCharGenCompleted(actor) {
  try {
    return actor?.getFlag?.(CHAR_GEN_SCOPE, FLAG_CHAR_GEN_COMPLETED) === true;
  } catch (_e) {
    return false;
  }
}

function _shouldEnforceCharGenMilestones() {
  try {
    return game.settings.get(SYSTEM_SCOPE, SETTING_ENFORCE_CHAR_GEN) === true;
  } catch (_e) {
    return false;
  }
}

function _warnCharGenGateOnce(actor, talentName) {
  try {
    if (!actor) return;
    if (!ui?.notifications?.warn) return;

    if (!game.uesrpg) game.uesrpg = {};
    const key = `_warnedCharGenGate.${String(actor.uuid ?? actor.id ?? "")}.${String(talentName ?? "")}`;
    if (game.uesrpg[key]) return;
    game.uesrpg[key] = true;

    ui.notifications.warn(`${actor.name}: ${talentName} automation is gated until Character Generation is completed.`);
  } catch (_e) {
    // ignore
  }
}

export function canApplyCharGenGatedImperialTalents(actor, { warnTalentName = null } = {}) {
  if (!_shouldEnforceCharGenMilestones()) return true;
  if (_isCharGenCompleted(actor)) return true;
  if (warnTalentName) _warnCharGenGateOnce(actor, warnTalentName);
  return false;
}

function _getUsageState(actor) {
  const raw = actor?.getFlag?.(SYSTEM_SCOPE, FLAG_RACIAL_USAGE);
  return (raw && typeof raw === "object") ? raw : {};
}

async function _setUsageState(actor, next) {
  if (!actor) return;
  await requestUpdateDocument(actor, {
    [`flags.${SYSTEM_SCOPE}.${FLAG_RACIAL_USAGE}`]: next && typeof next === "object" ? next : {}
  });
}

function _isUsed(actor, key) {
  const usage = _getUsageState(actor);
  return usage?.[key]?.used === true;
}

async function _markUsed(actor, key, { period } = {}) {
  const usage = _getUsageState(actor);
  const next = {
    ...usage,
    [key]: {
      used: true,
      period: String(period ?? "").trim() || null,
      usedAt: Date.now(),
      worldTime: _num(game?.time?.worldTime ?? 0, 0)
    }
  };
  await _setUsageState(actor, next);
}

export async function clearRacialTalentUsageOnRest(actor, { restType } = {}) {
  if (!actor) return;
  const type = String(restType ?? "").trim().toLowerCase();
  if (type !== "short" && type !== "long") return;

  const usage = _getUsageState(actor);
  if (!usage || typeof usage !== "object") return;

  const next = { ...usage };

  // Short Rest: clears short-rest racial talent usage.
  if (type === "short") {
    for (const [k, v] of Object.entries(next)) {
      if (v?.period === "shortRest") delete next[k];
    }
  }

  // Long Rest: clears both longRest and shortRest usage.
  if (type === "long") {
    for (const [k, v] of Object.entries(next)) {
      if (v?.period === "longRest" || v?.period === "shortRest") delete next[k];
    }
  }

  await _setUsageState(actor, next);
}

export function applyRacialTalentDerivedBonuses({ actor, actorSystemData, agg } = {}) {
  if (!actor || !actorSystemData) return;

  // ── Numeric bonuses (Speed, HP, SP, WT, resistances) are now emitted as
  // FeatureMods by contributors.js → contributeTalentMods and applied via the
  // Feature Mod pipeline.  Only non-numeric semantic flags remain here. ──

  // Argonian: Child of the Sap (Chapter 4)
  // "Exchange Resist Disease for Immunity to Disease" — legacy-safe: we do not
  // delete any items; we add the immunity semantic to the derived trait profile.
  if (hasTalent(actor, "childofthesap")) {
    if (agg?.traitDamage?.immunity && typeof agg.traitDamage.immunity === "object") {
      agg.traitDamage.immunity.disease = true;
    } else if (agg?.traitDamage && typeof agg.traitDamage === "object") {
      agg.traitDamage.immunity = { ...(agg.traitDamage.immunity ?? {}), disease: true };
    }
  }
}

export function applyRacialTalentPostSpeedDerived({ actor, actorSystemData } = {}) {
  if (!actor || !actorSystemData) return;
  if (!hasTalent(actor, "histskin")) return;
  actorSystemData.speed = actorSystemData.speed ?? {};
  const base = _num(actorSystemData.speed.swimSpeed, 0);
  actorSystemData.speed.swimSpeed = Math.max(0, Math.trunc(base * 2));
}

export function validateRacialActivationAvailability({ actor, item, itemKey } = {}) {
  if (!actor || !item) return { ok: true };
  const k = _canonicalFeatureKey(itemKey ?? item.name);
  if (!k) return { ok: true };

  // Histskin: once per Short Rest
  if (k === "histskin") {
    if (_isUsed(actor, "histskin")) return { ok: false, reason: "Histskin has already been used this Short Rest." };
  }

  // Malacath's Fury: once per Long Rest
  if (k === "malacathsfury") {
    if (_isUsed(actor, "malacathsFury")) return { ok: false, reason: "Malacath's Fury has already been used this Long Rest." };
  }

  return { ok: true };
}

export async function handleRacialTalentActivation({ actor, item, itemKey } = {}) {
  if (!actor || !item) return false;
  const k = _canonicalFeatureKey(itemKey ?? item.name);
  if (!k) return false;

  if (k === "dragonskin") {
    const duration = buildEffectDuration({ actor, rounds: 1, seconds: 6, preferCombat: true });
    await createOrUpdateStatusEffect(actor, {
      name: "Dragonskin",
      img: item.img,
      duration,
      flags: {
        uesrpg: { key: EFFECT_KEY_DRAGONSKIN, spellAbsorption: 5, source: "talent" }
      },
      changes: []
    });
    return true;
  }

  if (k === "histskin") {
    const eb = _getEnduranceBonus(actor);
    if (eb > 0) await applyHealing(actor, eb, { source: "Histskin" });
    await _markUsed(actor, "histskin", { period: "shortRest" });
    return true;
  }

  if (k === "malacathsfury") {
    const eb = _getEnduranceBonus(actor);
    if (eb > 0) await applyHealing(actor, eb, { source: "Malacath's Fury" });

    const delta = Math.max(0, Math.floor(eb / 2));
    const duration = buildEffectDuration({ actor, rounds: 10, seconds: 60, preferCombat: true });

    const changes = [];
    if (delta > 0) {
      changes.push(buildEffectChange({ key: "system.modifiers.characteristics.str", type: "add", value: String(delta * 10), priority: 20 }));
      changes.push(buildEffectChange({ key: "system.modifiers.resistance.magicR", type: "add", value: String(delta), priority: 20 }));
    }

    await createOrUpdateStatusEffect(actor, {
      name: "Malacath's Fury",
      img: item.img,
      duration,
      flags: {
        uesrpg: { key: EFFECT_KEY_MALACATHS_FURY, source: "talent", malacathsFury: { strBonus: delta, magicR: delta } }
      },
      changes
    });

    await _markUsed(actor, "malacathsFury", { period: "longRest" });
    return true;
  }

  return false;
}

export async function handleRacialPowerActivation({ actor, item, itemKey } = {}) {
  if (!actor || !item) return false;
  const k = _canonicalFeatureKey(itemKey ?? item.name);
  if (!k) return false;

  // Adrenaline Rush modified by Adrenaline Burst (Chapter 4 + Chapter 2 power text)
  if (k === "adrenaline-rush" && hasTalent(actor, "adrenalineburst")) {
    const combat = game?.combat ?? null;
    const inCombat = Boolean(combat?.started);

    if (inCombat) {
      const duration = buildEffectDuration({ actor, preferCombat: true });
      await createOrUpdateStatusEffect(actor, {
        name: "Adrenaline Rush",
        img: item.img,
        duration,
        flags: {
          uesrpg: { key: EFFECT_KEY_ADRENALINE_RUSH, source: "power" },
          [SYSTEM_SCOPE]: { wounds: { suppressWoundPenalty: true } }
        },
        changes: [
          buildEffectChange({ key: "system.modifiers.stamina.value", type: "add", value: "2", priority: 20 })
        ]
      });

      // If the actor is currently wounded, remove any existing passive penalty effect immediately.
      try { await ensureWoundedPassiveEffect(actor); } catch (_e) { /* ignore */ }
    } else {
      // Encounter durations are combat-anchored; outside combat we cannot expire this automatically.
      const current = _num(actor.system?.stamina?.value ?? 0, 0);
      const max = _num(actor.system?.stamina?.max ?? 0, 0);
      const next = Math.min(max, current + 2);
      await requestUpdateDocument(actor, { "system.stamina.value": next });
      ui.notifications?.info?.(`${actor.name}: Adrenaline Burst applied outside combat (temporary SP expiry must be handled manually).`);
    }

    await applyHealing(actor, 5, { source: "Adrenaline Burst" });
    return true;
  }

  return false;
}

export function applyRacialTalentAttackPreTN({ attacker, declaration, situationalMods } = {}) {
  if (!attacker || !declaration || !Array.isArray(situationalMods)) return;

  // Khajiit: Eye of Night (Chapter 4)
  // - "Free Precision Strike with first attack made while Hidden at night time or in total darkness."
  // We cannot infer lighting reliably; the attacker declaration provides an explicit toggle.
  const wants = declaration?.eyeOfNight === true;
  if (!wants) return;
  if (!hasTalent(attacker, "eyeofnight")) return;
  if (!hasCondition(attacker, "hidden")) return;
  if (String(declaration?.variant ?? "").toLowerCase() !== "precision") return;

  if (!situationalMods.some(m => String(m?.key ?? "") === "talent:eyeofnight")) {
    situationalMods.push({ key: "talent:eyeofnight", label: "Eye of Night (Precision Strike)", value: +20, source: "talent" });
  }
}

export function registerRacialTalentsAutomation() {
  if (!game.uesrpg) game.uesrpg = {};
  if (game.uesrpg._racialTalentsAutomationRegistered) return;
  game.uesrpg._racialTalentsAutomationRegistered = true;

  // Encounter-duration cleanup (e.g., Adrenaline Rush temp SP).
  Hooks.on("deleteCombat", async (combat) => {
    try {
      const combatants = Array.from(combat?.combatants ?? []);
      const toProcess = combatants.map(c => c?.actor).filter(Boolean);
      for (const actor of toProcess) {
        const effects = Array.from(actor.effects ?? []);
        const toDelete = effects.filter(e => !e.disabled && getFlagValueWithFallback(e, "key") === EFFECT_KEY_ADRENALINE_RUSH).map(e => e.id);
        if (!toDelete.length) continue;
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", toDelete);
        try { await ensureWoundedPassiveEffect(actor); } catch (_e) { /* ignore */ }
      }
    } catch (err) {
      console.warn("uesrpg-3ev4 | Racial talents combat cleanup failed", err);
    }
  });
}
