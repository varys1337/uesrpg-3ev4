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
import { queueStatusEffect } from "../system/activation/feature-effects.js";
import { buildEffectDuration } from "../time/effect-duration.js";
import { queueHealingOutcome, persistChatOutcomes } from "../../application/combat/chat-outcome-application-service.js";
import { createChatOutcome } from "../config/outcome-application-policy.js";
import { requestAtomicUpdateDocument, requestDeleteEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { ensureWoundedPassiveEffect } from "../wounds/engine/apply.js";
import { _num } from "./_primitives.js";
import { getFlagValueWithFallback } from "../system/flags.js";
import { buildEffectChange } from "../../utils/compat.js";
import { getActivationCostValues, normalizeUsage } from "../system/activation/helpers.js";
import { isActorInStartedCombatEncounter } from "../combat/combat-scope.js";
import { queueWarCryOutcomes } from "../fear/war-cry.js";

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

function _isUsed(actor, key) {
  const usage = _getUsageState(actor);
  return usage?.[key]?.used === true;
}

async function _markUsed(actor, key, { period } = {}) {
  let alreadyUsed = false;
  const confirmed = await requestAtomicUpdateDocument(actor, fresh => {
    if (_isUsed(fresh, key)) {
      alreadyUsed = true;
      return null;
    }
    return { [`flags.${SYSTEM_SCOPE}.${FLAG_RACIAL_USAGE}.${key}`]: {
      used: true,
      period: String(period ?? "").trim() || null,
      usedAt: Date.now(),
      worldTime: _num(game?.time?.worldTime ?? 0, 0)
    } };
  });
  if (alreadyUsed) throw new Error("This racial talent was already used. Review any Item use or cost already spent.");
  if (!confirmed) {
    ui.notifications?.warn?.(`${actor.name}: the racial talent use was not confirmed. Ask the GM to inspect both the Actor and Item before retrying.`);
    throw Object.assign(new Error("Racial talent usage was not confirmed."), { uncertain: true });
  }
}

export async function clearRacialTalentUsageOnRest(actor, { restType, strict = false } = {}) {
  if (!actor) return;
  const type = String(restType ?? "").trim().toLowerCase();
  if (type !== "short" && type !== "long") return;
  let calculated = false;
  let changed = false;
  const confirmed = await requestAtomicUpdateDocument(actor, fresh => {
    calculated = true;
    const patch = {};
    for (const [key, value] of Object.entries(_getUsageState(fresh))) {
      if (value?.period !== "shortRest" && !(type === "long" && value?.period === "longRest")) continue;
      patch[`flags.${SYSTEM_SCOPE}.${FLAG_RACIAL_USAGE}.-=${key}`] = null;
    }
    changed = Object.keys(patch).length > 0;
    return changed ? patch : null;
  }, { render: false, perfKind: "rest" });
  const ok = calculated && (!changed || confirmed);
  if (strict && !ok) throw new Error("Racial usage reset was not confirmed.");
  return { ok, changed: changed && confirmed };
}

export function applyRacialTalentDerivedBonuses({ actor, actorSystemData, agg } = {}) {
  if (!actor || !actorSystemData) return;

  // ── Numeric bonuses (Speed, HP, SP, WT, resistances) are now emitted as
  // FeatureMods by contributors.js → contributeTalentMods and applied via the
  // Feature Mod pipeline.  Only non-numeric semantic flags remain here. ──

  // Child of the Sap and High Men grant disease immunity. Preserve the source
  // Items and add the immunity semantic to the derived trait profile.
  if (hasTalent(actor, "childofthesap") || hasTalent(actor, "highmen")) {
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

/** Only automate Highborn when the Item records its source-backed cost and use. */
export function isHighbornActivationConfigured(item) {
  if (item?.type !== "talent" || _canonicalFeatureKey(item.name) !== "highborn") return false;
  const activation = item.system?.activation ?? {};
  const usage = normalizeUsage(activation);
  return activation.enabled === true && activation.actionType === "action"
    && activation.spendCosts === true && getActivationCostValues(activation.costs ?? {}).ap === 1
    && activation.consumeUse === true && usage.period === "day" && Number(usage.max) > 0;
}

export async function handleRacialTalentActivation({ actor, item, itemKey, onOutcome = null } = {}) {
  if (!actor || !item) return false;
  const k = _canonicalFeatureKey(itemKey ?? item.name);
  if (!k) return false;

  if (k === "highborn" && isHighbornActivationConfigured(item)) {
    const message = await persistChatOutcomes({ actor,
      content: "<div class=\"uesrpg\"><b>Highborn</b>: recover up to 20 Magicka.</div>",
      entries: [createChatOutcome({ adapter: "resource.delta", kind: "effect", sourceActorUuid: actor.uuid,
        targetUuid: actor.uuid, label: "Highborn: Magicka", payload: { resource: "magicka", amount: 20 } })] });
    if (!message?.id) throw new Error("The Highborn recovery outcome was not confirmed.");
    onOutcome?.(message);
    return true;
  }

  if (k === "dragonskin") {
    const duration = buildEffectDuration({ actor, rounds: 1, seconds: 6, preferCombat: true });
    await queueStatusEffect(actor, {
      name: "Dragonskin",
      img: item.img,
      duration,
      flags: {
        uesrpg: { key: EFFECT_KEY_DRAGONSKIN, spellAbsorption: 5, source: "talent" }
      },
      changes: []
    }, { onOutcome });
    return true;
  }

  if (k === "histskin") {
    const eb = _getEnduranceBonus(actor);
    await _markUsed(actor, "histskin", { period: "shortRest" });
    try {
      if (eb > 0 && !(await queueHealingOutcome(actor, eb, { source: "Histskin", onOutcome }))?.id) {
        throw new Error("Histskin healing was not confirmed.");
      }
    } catch (error) {
      ui.notifications?.warn?.(`${actor.name}: Histskin's use is recorded, but its healing outcome was not fully confirmed. Inspect the Actor, Item and chat before retrying.`);
      throw Object.assign(error, { uncertain: true });
    }
    return true;
  }

  if (k === "malacathsfury") {
    const eb = _getEnduranceBonus(actor);
    await _markUsed(actor, "malacathsFury", { period: "longRest" });
    try {
      if (eb > 0 && !(await queueHealingOutcome(actor, eb, { source: "Malacath's Fury", onOutcome }))?.id) {
        throw new Error("Malacath's Fury healing was not confirmed.");
      }

      const delta = Math.max(0, Math.floor(eb / 2));
      const duration = buildEffectDuration({ actor, rounds: 10, seconds: 60, preferCombat: true });

      const changes = [];
      if (delta > 0) {
        changes.push(buildEffectChange({ key: "system.characteristics.str.bonus", type: "add", value: String(delta), priority: 20 }));
        changes.push(buildEffectChange({ key: "system.modifiers.resistance.magicR", type: "add", value: String(delta), priority: 20 }));
      }

      const effectMessage = await queueStatusEffect(actor, {
        name: "Malacath's Fury",
        img: item.img,
        duration,
        flags: {
          uesrpg: { key: EFFECT_KEY_MALACATHS_FURY, source: "talent", malacathsFury: { strBonus: delta, magicR: delta } }
        },
        changes
      }, { onOutcome, instructions: eb > 0 ? "Apply the healing outcome before this timed benefit." : null });
      if (!effectMessage?.id) throw new Error("Malacath's Fury timed benefit was not confirmed.");
    } catch (error) {
      ui.notifications?.warn?.(`${actor.name}: Malacath's Fury's use is recorded, but its outcomes were not fully confirmed. Inspect the Actor, Item and chat before retrying.`);
      throw Object.assign(error, { uncertain: true });
    }
    return true;
  }

  return false;
}

export async function handleRacialPowerActivation({ actor, item, itemKey, context = {}, onOutcome = null } = {}) {
  if (!actor || !item) return false;
  const k = _canonicalFeatureKey(itemKey ?? item.name);
  if (!k) return false;

  if (k === "war-cry" && context.warCryListeners) {
    await queueWarCryOutcomes({ actor, targets: context.warCryListeners, step: context.warCryStep, onOutcome });
    return true;
  }

  // Adrenaline Rush modified by Adrenaline Burst (Chapter 4 + Chapter 2 power text)
  if (k === "adrenaline-rush" && hasTalent(actor, "adrenalineburst")) {
    const inCombat = isActorInStartedCombatEncounter(actor);

    if (inCombat) {
      const duration = buildEffectDuration({ actor, preferCombat: true });
      await queueStatusEffect(actor, {
        name: "Adrenaline Rush",
        img: item.img,
        duration,
        flags: {
          uesrpg: { key: EFFECT_KEY_ADRENALINE_RUSH, source: "power" },
          [SYSTEM_SCOPE]: { wounds: { suppressWoundPenalty: true } }
        },
        changes: []
      }, { afterWoundSuppression: true, onOutcome,
        instructions: "Grant the 2 SP manually and track their encounter expiry. Existing temporary SP cannot yet be attributed to individual sources." });
    } else {
      // An actor outside the combat tracker has no reliable encounter cleanup.
      ui.notifications?.info?.(`${actor.name}: handle Adrenaline Burst's SP and wound-penalty suppression manually until the encounter ends.`);
    }

    await queueHealingOutcome(actor, 5, { source: "Adrenaline Burst", onOutcome });
    return true;
  }

  if (k === "adrenaline-rush" && Number(actor.system?.fatigue?.level) > 0) {
    const message = await persistChatOutcomes({ actor,
      content: "<div class=\"uesrpg\"><b>Adrenaline Rush</b>: remove one level of Fatigue.</div>",
      entries: [createChatOutcome({ adapter: "resource.fatigue", kind: "effect", sourceActorUuid: actor.uuid,
        targetUuid: actor.uuid, label: "Adrenaline Rush: Fatigue", payload: {} })] });
    if (!message?.id) throw new Error("The Adrenaline Rush Fatigue outcome was not confirmed.");
    onOutcome?.(message);
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

  // Precise has already removed the full Precision Strike penalty.
  if (situationalMods.some(m => String(m?.key ?? "") === "talent:precise")) return;

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
