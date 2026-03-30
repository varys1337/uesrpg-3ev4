/**
 * Alchemy Runtime Automation
 *
 * NOTE (Project Policy): Alchemy is treated as a **core system mechanic**.
 * Runtime automation is therefore **always enabled** (no world-setting gating).
 *
 * Nothing in this file registers hooks at import time — call
 * initializeAlchemyRuntime() once at system ready.
 *
 * Covered automations:
 *   §7.1  Drink Potion      — consume item, apply instant effects, create upkeep AEs
 *   §7.2  Apply to Weapon   — apply poison/toxin as weapon Active Effects, emit confirmation
 *   §7.3  On-hit resolution — poison/toxin fires when a tagged weapon connects (via uesrpgDamageApplied)
 *   §7.4  Round tick-down   — upkeep/duration tracking via updateCombat hook
 *   §7.5  Chat card button  — click handler wired to renderChatMessage
 *
 * Internal helpers are not exported; apply helpers are exported through the
 * runtime barrel for sheet/chat/API entry points.
 */

import { getEffectByKey } from "./effects.js";
import { rollPotionBackfire } from "./backfire.js";
import {
  requestCreateEmbeddedDocuments,
  requestUpdateChatMessage,
  requestUpdateDocument,
} from "../../utils/authority-proxy.js";
import { applyDamage, applyHealing } from "../combat/damage/apply.js";
import { applyDamageResolved } from "../combat/damage-resolver.js";
import { renderPoisonResistanceCard, renderToxinResistanceCard } from "./render.js";
import {
  ALCHEMY_DEFAULT_ICON,
  cloneAlchemyData as _cloneData,
  emitAlchemyRoll3d as _emitAlchemyRoll3d,
  FLAG_NS,
  formatAlchemyDurationLabel as _formatDurationLabel,
  getAlchemyFlags,
} from "./shared.js";
import {
  clearAppliedAlchemy as _clearAppliedAlchemy,
  getAppliedAlchemy as _getAppliedAlchemy,
  isAppliedAlchemyExpired as _isAppliedAlchemyExpired,
  updateAppliedAlchemyHits as _updateAppliedAlchemyHits,
} from "./carrier-state.js";
import {
  applyAlchemyToAmmo as applyAlchemyToAmmoImpl,
  applyAlchemyToTarget as applyAlchemyToTargetImpl,
  applyAlchemyToWeapon as applyAlchemyToWeaponImpl,
  consumeAlchemyItem as _consumeAlchemyItem,
  pickAlchemyCoatingTarget as pickAlchemyCoatingTargetImpl,
  pickAlchemyWeapon as pickAlchemyWeaponImpl,
} from "./apply.js";
import {
  buildSyntheticSpellFromPayload as _buildSyntheticSpellFromPayload,
  cloneEffectEntryWithPotency as _cloneEffectEntryWithPotency,
  getAlchemyEffectLabel as _effectLabel,
  normalizeStoredSpellEffect as _normalizeStoredSpellEffect,
} from "./spell-effects.js";
import { appendSupplementalDamageReportToMessage } from "../combat/chat-handlers/combat-chat-apply.js";
import { applyMagicHealing, applyMagicDamage } from "../magic/damage-application.js";
import { applySpellEffectsToTarget } from "../magic/effects/spell-effects.js";
import { getSpellDamageType, rollSpellHealing } from "../magic/magicka-utils.js";
import { doTestRoll } from "../../utils/degree-roll-helper.js";
import {
  applyConsequences,
  computeCharacteristicDefenseTN,
  formatConsequenceReport,
  processCharacteristicDefenseOutcome,
} from "../magic/characteristic-defense-service.js";
import { normalizeSpellConfig } from "../magic/spell-config.js";
import {
  ALCHEMY_POISON_CARD_KEY,
  ALCHEMY_TOXIN_CARD_KEY,
  alchemyNoteHtml as _alchemyNoteHtml,
  getPoisonCardState as _getPoisonCardState,
  getWhisperRecipientsForActor as _getWhisperRecipientsForActor,
  poisonCardFlagPatch as _poisonCardFlagPatch,
  postAlchemyUseMessage as _postAlchemyUseMessageImpl,
  toxinCardFlagPatch as _toxinCardFlagPatch,
} from "./runtime/chat-cards.js";
import { registerAlchemyRuntimeHooks } from "./runtime/hooks.js";
import {
  getEnduranceTN as _getEnduranceTN,
  resolveStaminaPaths as _resolveStaminaPaths,
  rollEnduranceTest as _rollEnduranceTest,
} from "./runtime/resource-updates.js";

// ── Flag namespace constant (delegated to canonical FLAG_SCOPE from namespace.js) ──
const _ALCHEMY_ON_HIT_IN_FLIGHT = new Set();

async function _applySerializedSpellEffect(targetActor, effectEntry, {
  casterActor = null,
  potency = 1,
  mode = null,
  noteLabelSuffix = "Spell",
} = {}) {
  const normalizedResult = await _normalizeStoredSpellEffect(effectEntry, {
    mode: String(mode ?? effectEntry?.mode ?? "potion").trim().toLowerCase() || "potion",
  });
  if (!normalizedResult?.ok) return normalizedResult;

  const normalizedEffect = _cloneEffectEntryWithPotency(normalizedResult.effectEntry, potency);
  const payload = normalizedEffect.directPayload ?? {};
  const syntheticSpell = _buildSyntheticSpellFromPayload(normalizedEffect);
  if (!syntheticSpell) {
    return { ok: false, reason: `${_effectLabel(normalizedEffect)} is missing its serialized spell payload.` };
  }

  const applicationKind = String(payload?.applicationKind ?? "").trim().toLowerCase();
  const damageType = String(payload?.damageType ?? getSpellDamageType(syntheticSpell) ?? "").trim().toLowerCase();
  const label = `${_effectLabel(normalizedEffect)} [${noteLabelSuffix}]`;
  const sourceActor = casterActor ?? targetActor;
  const spellConfig = normalizeSpellConfig(syntheticSpell);

  if (String(mode ?? "").trim().toLowerCase() === "toxin" && spellConfig?.defenseModel === "characteristic") {
    syntheticSpell.system = syntheticSpell.system ?? {};
    syntheticSpell.system.engine = syntheticSpell.system.engine ?? {};
    syntheticSpell.system.engine.defenseModel = "characteristic";
    syntheticSpell.system.engine.characteristicDefense = {
      ...(syntheticSpell.system.engine.characteristicDefense ?? {}),
      defenderCharacteristic: "end",
    };

    const tnData = computeCharacteristicDefenseTN(targetActor, syntheticSpell);
    const finalTN = Math.max(1, Number(tnData?.finalTN ?? _getEnduranceTN(targetActor)) || _getEnduranceTN(targetActor) || 1);
    const result = await doTestRoll(targetActor, {
      target: finalTN,
      allowLucky: true,
      allowUnlucky: true,
    });
    _emitAlchemyRoll3d(result?.roll ?? null);

    const defResult = {
      success: Boolean(result?.isSuccess),
      criticalSuccess: Boolean(result?.isCriticalSuccess),
      criticalFailure: Boolean(result?.isCriticalFailure),
      rollTotal: Number(result?.rollTotal ?? result?.roll?.total ?? 0) || 0,
      target: finalTN,
      degree: Number(result?.degree ?? 0) || 0,
      characteristic: "end",
      characteristicLabel: "Endurance",
      characteristicTotal: Number(tnData?.baseTN ?? _getEnduranceTN(targetActor)) || _getEnduranceTN(targetActor) || 0,
      modifier: Number(tnData?.totalMod ?? 0) || 0,
      onSuccess: spellConfig?.characteristicDefense?.onSuccess ?? "negate",
      onFailure: spellConfig?.characteristicDefense?.onFailure ?? "consequences",
      result,
      roll: result?.roll ?? null,
      tnData,
    };
    const outcome = await processCharacteristicDefenseOutcome(targetActor, syntheticSpell, defResult, {
      caster: sourceActor,
      suppressChat: true,
    });
    const outcomeLabel = defResult.success
      ? `${targetActor.name} resisted the toxin.`
      : `${targetActor.name} failed the Endurance save.`;
    const consequenceHtml = formatConsequenceReport(outcome?.consequenceReport ?? null, "Consequences");

    return {
      ok: true,
      noteHtml: _alchemyNoteHtml(
        label,
        `
          <div>END TN ${finalTN}, Roll ${defResult.rollTotal} - ${defResult.success ? "Success" : "Failure"}.</div>
          <div>${outcomeLabel}</div>
          ${consequenceHtml}
        `
      ),
    };
  }

  if (applicationKind === "healing") {
    const healRoll = await rollSpellHealing(syntheticSpell, { level: Number(normalizedEffect?.spellLevel ?? 1) || 1 });
    _emitAlchemyRoll3d(healRoll);
    const rolled = Math.max(0, Number(healRoll?.total ?? 0) || 0);
    const healed = Math.max(0, potency < 1 ? Math.floor(rolled * potency) : rolled);
    await applyMagicHealing(targetActor, healed, syntheticSpell, {
      isTemporary: damageType === "temporaryhealing" || damageType === "temporary healing",
      source: syntheticSpell.name,
      rollHTML: await healRoll.render(),
    });
    return {
      ok: true,
      noteHtml: _alchemyNoteHtml(label, `${healed} restored${damageType.includes("temporary") ? " as temporary HP" : ""}.`),
    };
  }

  if (applicationKind === "spelleffects") {
    await applySpellEffectsToTarget(sourceActor, targetActor, syntheticSpell, {
      actualCost: Number(normalizedEffect?.cost ?? syntheticSpell?.system?.cost ?? 0) || 0,
      casterTokenUuid: sourceActor?.getActiveTokens?.()?.[0]?.document?.uuid ?? null,
    });
    return {
      ok: true,
      noteHtml: _alchemyNoteHtml(label, _formatDurationLabel(normalizedEffect?.finalDuration ?? payload?.finalDuration ?? null)),
    };
  }

  if (applicationKind === "damage") {
    const formula = String(payload?.formula ?? syntheticSpell?.system?.damageFormula ?? "").trim();
    if (!formula) return { ok: false, reason: `${syntheticSpell.name} has no serialized damage formula.` };
    const roll = await new Roll(formula).evaluate();
    _emitAlchemyRoll3d(roll);
    const amount = Math.max(0, potency < 1 ? Math.floor((Number(roll?.total ?? 0) || 0) * potency) : Number(roll?.total ?? 0) || 0);
    await applyMagicDamage(targetActor, amount, damageType || "magic", syntheticSpell, {
      hitLocation: "Body",
      rollHTML: await roll.render(),
      source: syntheticSpell.name,
      casterActor: sourceActor,
    });
    return {
      ok: true,
      noteHtml: _alchemyNoteHtml(label, `${amount} ${damageType || "magic"} damage applied.`),
    };
  }

  return { ok: false, reason: `${syntheticSpell.name} uses unsupported alchemy application kind "${applicationKind || "unknown"}".` };
}

// ── §7.1 Drink Potion ─────────────────────────────────────────────────────────

/**
 * Execute the drink-potion workflow for an alchemy item on a given actor.
 *
 * Resolution order:
 *   1. If the potion is Backfired → roll Potion Backfire Table first.
 *   2. For each effect: apply instant effects immediately; create upkeep AEs for timed ones.
 *   3. Consume the item (reduce qty or delete).
 *   4. Post result chat card.
 *
 * @param {Actor} actor
 * @param {Item}  potionItem
 */
export async function drinkPotion(actor, potionItem) {
  if (!actor || !potionItem) return;
  const algData = getAlchemyFlags(potionItem);
  if (!algData || algData.kind !== "potion") {
    ui.notifications.warn("That item is not a brewed potion.");
    return;
  }

  // Only owner or GM may act.
  if (!actor.isOwner && !game.user.isGM) {
    ui.notifications.warn("You do not own this actor.");
    return;
  }

  let halfPotency = false;
  let backfireHtml = "";

  // Backfired potion: roll the Potion Backfire Table before applying any effect.
  if (algData.backfired) {
    const bfResult = await rollPotionBackfire();
    _emitAlchemyRoll3d(bfResult?.rollObject ?? null);
    _emitAlchemyRoll3d(bfResult?.minorEffect?.rollObject ?? null);
    const bfEntry = bfResult.entry;
    backfireHtml = _alchemyNoteHtml(
      `Backfire (1d10=${bfResult.roll})`,
      `${bfEntry?.label ?? "?"} - ${bfEntry?.description ?? ""}`,
      "is-danger"
    );

    switch (bfEntry?.outcome) {
      case "no_effect":
        await _consumeAlchemyItem(actor, potionItem);
        await _postAlchemyUseMessage(actor, potionItem, "Potion Consumed — No Effect", backfireHtml);
        return;

      case "half_potency":
        halfPotency = true;
        break;

      case "minor_effects":
      case "dangerous":
        if (bfResult.minorEffect?.entry) {
          backfireHtml += _alchemyNoteHtml(
            `Minor Effect (2d8=${bfResult.minorEffect.roll})`,
            `${bfResult.minorEffect.entry.label} - ${bfResult.minorEffect.entry.description}`,
            "is-warning"
          );
        }
        if (bfEntry?.outcome === "dangerous") {
          const dmgRoll = new Roll("1d8");
          await dmgRoll.evaluate();
          _emitAlchemyRoll3d(dmgRoll);
          await applyDamage(actor, dmgRoll.total, "physical", {
            ignoreReduction: true,
            source: "Backfired Potion",
            skipChatMessage: false,
          });
        }
        await _consumeAlchemyItem(actor, potionItem);
        await _postAlchemyUseMessage(actor, potionItem, "Potion Consumed — Backfire!", backfireHtml);
        return;

      case "sickened":
        backfireHtml += _alchemyNoteHtml("Sickened", "Make an Endurance test or gain Poisoned for 1d6 rounds.", "is-warning");
        await _consumeAlchemyItem(actor, potionItem);
        await _postAlchemyUseMessage(actor, potionItem, "Potion Consumed — Sickened!", backfireHtml);
        return;

      default:
        break;
    }
  }

  const normalizedEffects = [];
  for (const rawEffect of algData.effects ?? []) {
    if (String(rawEffect?.effectSource ?? "catalog") !== "spell") {
      normalizedEffects.push(rawEffect);
      continue;
    }

    const normalized = await _normalizeStoredSpellEffect(rawEffect, { mode: "potion" });
    if (!normalized?.ok) {
      ui.notifications.warn(normalized?.reason ?? `${_effectLabel(rawEffect)} must be re-brewed before it can be consumed.`);
      return;
    }
    normalizedEffects.push(normalized.effectEntry);
  }

  // Apply each effect.
  const effectResultRows = [];

  for (const effectEntry of normalizedEffects) {
    if (String(effectEntry?.effectSource ?? "catalog") === "spell") {
      const resolved = await _applySerializedSpellEffect(actor, effectEntry, {
        casterActor: actor,
        potency: halfPotency ? 0.5 : 1,
        mode: "potion",
        noteLabelSuffix: "Spell",
      });
      if (!resolved?.ok) {
        ui.notifications.warn(resolved?.reason ?? "That potion effect could not be resolved.");
        return;
      }
      effectResultRows.push(
        resolved.noteHtml
        ?? _alchemyNoteHtml(`${_effectLabel(effectEntry)} [Spell]`, `SL ${Number(effectEntry?.spellLevel ?? 1)}.`)
      );
      continue;
    }

    const { effectKey, spellLevel, finalDuration, attributes, params } = effectEntry;
    const effectDef = getEffectByKey(effectKey);
    if (!effectDef) continue;

    const sl = Number(spellLevel ?? 1);
    const potency = halfPotency ? 0.5 : 1;

    const resultRow = await _applyPotionEffect(actor, effectDef, sl, potency, finalDuration, params);
    effectResultRows.push(resultRow);
  }

  await _consumeAlchemyItem(actor, potionItem);

  const effectsHtml = effectResultRows.join("\n");
  await _postAlchemyUseMessage(
    actor,
    potionItem,
    "Potion Consumed",
    backfireHtml + effectsHtml
  );
}

/**
 * Apply a single potion effect to an actor.
 * Returns an HTML row for the result chat card.
 */
async function _applyPotionEffect(actor, effectDef, sl, potency, finalDuration, params) {
  const key = effectDef.key;
  const label = effectDef.label;
  const magnitude = Math.max(1, Math.floor(sl * potency));

  // Instant healing effects.
  if (key === "restoreHealth") {
    await applyHealing(actor, magnitude, { source: label, skipChatMessage: true });
    return `<div class="uesrpg-da-row"><span class="k">${label}</span><span class="v">+${magnitude} HP restored</span></div>`;
  }

  if (key === "restoreMagicka") {
    const current = Number(actor.system?.magicka?.value ?? 0);
    const max = Number(actor.system?.magicka?.max ?? 0);
    const newVal = Math.min(max, current + magnitude);
    await requestUpdateDocument(actor, { "system.magicka.value": newVal });
    return `<div class="uesrpg-da-row"><span class="k">${label}</span><span class="v">+${magnitude} Magicka restored</span></div>`;
  }

  if (key === "restoreStamina") {
    const { valuePath, value, max } = _resolveStaminaPaths(actor);
    const newVal = Math.min(max, value + magnitude);
    await requestUpdateDocument(actor, { [valuePath]: newVal });
    return `<div class="uesrpg-da-row"><span class="k">${label}</span><span class="v">+${magnitude} Stamina restored</span></div>`;
  }

  // Upkeep effects → create a timed Active Effect.
  if (effectDef.attributes.includes("upkeep") && finalDuration) {
    const durationRounds = finalDuration.unit === "minutes"
      ? finalDuration.value * 10   // 1 minute = 10 rounds (6-second rounds)
      : finalDuration.value;

    const aeData = _buildPotionAE(actor, effectDef, sl, magnitude, durationRounds, params);
    await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [aeData]);

    return `<div class="uesrpg-da-row"><span class="k">${label}</span><span class="v">SL ${sl} — ${finalDuration.value} ${finalDuration.unit}</span></div>`;
  }

  // Dispel: descriptive only.
  if (key === "dispel") {
    return `<div class="uesrpg-da-row"><span class="k">${label}</span><span class="v">Dispel Strength ${magnitude} — resolve via magic automation</span></div>`;
  }

  // Fallback: descriptive.
  return `<div class="uesrpg-da-row"><span class="k">${label}</span><span class="v">SL ${sl} — GM resolves effect</span></div>`;
}

/**
 * Build an ActiveEffect data object for a timed potion effect.
 */
function _buildPotionAE(actor, effectDef, sl, magnitude, durationRounds, _params) {
  const changes = _buildAEChanges(effectDef.key, magnitude);
  const combatActive = !!game.combat?.active;

  return {
    name: `${effectDef.label} (Potion SL${sl})`,
    icon: ALCHEMY_DEFAULT_ICON,
    origin: actor.uuid,
    duration: combatActive
      ? { rounds: durationRounds, combat: game.combat.id }
      : { seconds: durationRounds * 6 },
    changes,
    flags: {
      [FLAG_NS]: {
        spellEffect: true,
        alchemyPotion: true,
        potionEffectKey: effectDef.key,
        potionSL: sl,
      },
    },
  };
}

/**
 * Map an effect key to AE changes array.
 * Only covers effects that have direct stat mapping; complex effects are descriptive.
 */
function _buildAEChanges(effectKey, magnitude) {
  switch (effectKey) {
    case "shieldSpell":
      return [{ key: "magic_ar", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(magnitude) }];
    case "fortifyAttribute":
      return [];
    case "feather":
      return [{ key: "system.encumbrance.bonus", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(-magnitude * 5) }];
    default:
      return [];
  }
}

// ── §7.2 Apply to Weapon ──────────────────────────────────────────────────────

/**
 * Tag a weapon item with poison or toxin data.
 * On the next confirmed hit the `uesrpgDamageApplied` hook fires the on-hit resolution.
 *
 * @param {Actor} actor         Owner of both items.
 * @param {Item}  alchemyItem   Poison or toxin item.
 * @param {Item}  weaponItem    Target weapon.
 */
export async function applyAlchemyToWeapon(actor, alchemyItem, weaponItem) {
  return applyAlchemyToWeaponImpl(actor, alchemyItem, weaponItem);
}

export async function applyAlchemyToAmmo(actor, alchemyItem, ammoItem) {
  return applyAlchemyToAmmoImpl(actor, alchemyItem, ammoItem);
}

export async function applyAlchemyToTarget(actor, alchemyItem, targetItem) {
  return applyAlchemyToTargetImpl(actor, alchemyItem, targetItem);
}

// ── §7.3 On-hit resolution ────────────────────────────────────────────────────

/**
 * Called on `uesrpgDamageApplied`.
 * Checks if the attacker's weapon has alchemyApplied data; if so, resolves it.
 */
async function _onDamageApplied(targetActor, context) {
  if (!game.user?.isGM) return;
  if ((Number(context?.amountApplied ?? 0) || 0) <= 0) return;
  if (context?.chatContext?.alchemyOnHitSuppressed === true) return;

  const ammoItem = context?.ammo?.documentName === "Item" ? context.ammo : null;
  const weaponItem = context?.weapon?.documentName === "Item" ? context.weapon : null;
  const originItem = context?.origin?.documentName === "Item" ? context.origin : null;

  let sourceItem = ammoItem && _getAppliedAlchemy(ammoItem) ? ammoItem : null;
  if (!sourceItem) sourceItem = weaponItem ?? originItem ?? null;
  if (!sourceItem) return;

  let applied = _getAppliedAlchemy(sourceItem);
  if (!applied) return;

  if (applied.source === "legacy-flag") {
    const legacyAe = _buildWeaponAlchemyAEData({
      uuid: applied.itemUuid ?? null,
      name: applied.itemName ?? "Applied Alchemy",
    }, applied);
    await requestCreateEmbeddedDocuments(sourceItem, "ActiveEffect", [legacyAe]);
    await requestUpdateDocument(sourceItem, { [`flags.${FLAG_NS}.alchemyApplied`]: null });
    applied = _getAppliedAlchemy(sourceItem);
  }

  if (_isAppliedAlchemyExpired(applied)) {
    await _clearAppliedAlchemy(sourceItem, applied);
    return;
  }

  const inFlightKey = [
    String(context?.applicationId ?? ""),
    String(sourceItem?.uuid ?? sourceItem?.id ?? ""),
    String(applied?.effectId ?? applied?.itemUuid ?? applied?.kind ?? ""),
  ].join(":");
  if (_ALCHEMY_ON_HIT_IN_FLIGHT.has(inFlightKey)) return;
  _ALCHEMY_ON_HIT_IN_FLIGHT.add(inFlightKey);

  try {
    if (applied.kind === "poison") {
      await _clearAppliedAlchemy(sourceItem, applied);
      await _postPoisonResistanceCard(targetActor, sourceItem, applied, context);
    }

    if (applied.kind === "toxin") {
      await _resolveToxinOnHit(targetActor, sourceItem, applied, context);
    }
  } finally {
    _ALCHEMY_ON_HIT_IN_FLIGHT.delete(inFlightKey);
  }
}

/**
 * Create the pending poison resistance card.
 */
async function _postPoisonResistanceCard(targetActor, weaponItem, applied, context = {}) {
  const endTN = _getEnduranceTN(targetActor);
  if (endTN <= 0) {
    ui.notifications.warn(`${targetActor?.name ?? "Target"} has no valid Endurance TN.`);
    return null;
  }

  const state = {
    kind: "poisonResistance",
    targetActorUuid: String(targetActor?.uuid ?? "").trim(),
    weaponUuid: String(weaponItem?.uuid ?? "").trim(),
    weaponName: String(weaponItem?.name ?? "Weapon").trim() || "Weapon",
    appliedEffectId: String(applied?.effectId ?? "").trim() || null,
    poisonLevel: Math.max(1, Number(applied?.poisonLevel ?? 1) || 1),
    damageFormula: String(applied?.damageFormula ?? "1d4").trim() || "1d4",
    parentMessageId: String(context?.chatContext?.parentMessageId ?? "").trim() || null,
    resolving: false,
    resolved: false,
    endTN,
    finalTN: null,
    rollTotal: null,
    passed: null,
    damageApplied: null,
    backfired: Boolean(applied?.backfired),
    statusNote: "",
  };

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: renderPoisonResistanceCard({
      actorName: targetActor.name,
      actorUuid: targetActor.uuid,
      weaponName: weaponItem?.name ?? "Weapon",
      poisonLevel: state.poisonLevel,
      damageFormula: state.damageFormula,
      endTN,
      resolving: false,
      resolved: false,
    }),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    whisper: _getWhisperRecipientsForActor(targetActor),
    flags: {
      [FLAG_NS]: {
        [ALCHEMY_POISON_CARD_KEY]: state,
      },
    },
  });
}

export async function resolvePoisonResistanceFromChat({ messageId, action } = {}) {
  if (String(action ?? "").trim().toLowerCase() !== "roll") return;
  const message = game.messages?.get?.(String(messageId ?? "").trim()) ?? null;
  if (!message) return;

  const state = _getPoisonCardState(message);
  if (state?.resolved || state?.resolving) return;

  const targetActor = await fromUuid(String(state?.targetActorUuid ?? "").trim()).catch(() => null);
  if (!targetActor) {
    ui.notifications.warn("Poison resistance: target actor not found.");
    return;
  }

  const weaponItem = state?.weaponUuid
    ? await fromUuid(String(state.weaponUuid).trim()).catch(() => null)
    : null;
  const baseTN = Math.max(0, Number(state?.endTN ?? _getEnduranceTN(targetActor)) || _getEnduranceTN(targetActor));
  if (baseTN <= 0) {
    const failedState = {
      ...state,
      resolving: false,
      resolved: true,
      finalTN: 0,
      rollTotal: null,
      passed: null,
      damageApplied: 0,
      statusNote: `${targetActor.name} has no valid Endurance TN.`,
    };
    await requestUpdateChatMessage(message, {
      content: renderPoisonResistanceCard({
        actorName: targetActor.name,
        actorUuid: targetActor.uuid,
        weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
        poisonLevel: state?.poisonLevel ?? 1,
        damageFormula: state?.damageFormula ?? "1d4",
        endTN: baseTN,
        finalTN: failedState.finalTN,
        rollTotal: failedState.rollTotal,
        passed: failedState.passed,
        damageApplied: failedState.damageApplied,
        resolving: false,
        resolved: true,
        statusNote: failedState.statusNote,
      }),
      ..._poisonCardFlagPatch(failedState),
    });
    return;
  }

  await requestUpdateChatMessage(message, {
    content: renderPoisonResistanceCard({
      actorName: targetActor.name,
      actorUuid: targetActor.uuid,
      weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
      poisonLevel: state?.poisonLevel ?? 1,
      damageFormula: state?.damageFormula ?? "1d4",
      endTN: baseTN,
      resolving: true,
      resolved: false,
    }),
    ..._poisonCardFlagPatch({
      ...state,
      resolving: true,
      resolved: false,
    }),
  });

  const endurance = await _rollEnduranceTest(targetActor, { label: "Poison Resistance" });
  if (!endurance?.ok) {
    const failedState = {
      ...state,
      resolving: false,
      resolved: true,
      finalTN: baseTN,
      rollTotal: null,
      passed: null,
      damageApplied: 0,
      statusNote: endurance?.reason ?? "Poison resistance test could not be rolled.",
    };
    await requestUpdateChatMessage(message, {
      content: renderPoisonResistanceCard({
        actorName: targetActor.name,
        actorUuid: targetActor.uuid,
        weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
        poisonLevel: state?.poisonLevel ?? 1,
        damageFormula: state?.damageFormula ?? "1d4",
        endTN: baseTN,
        finalTN: failedState.finalTN,
        rollTotal: failedState.rollTotal,
        passed: failedState.passed,
        damageApplied: failedState.damageApplied,
        resolving: false,
        resolved: true,
        statusNote: failedState.statusNote,
      }),
      ..._poisonCardFlagPatch(failedState),
    });
    return;
  }

  let damageApplied = 0;
  let statusNote = `${targetActor.name} resisted the poison.`;
  if (!endurance.success) {
    const damageRoll = await new Roll(String(state?.damageFormula ?? "1d4").trim() || "1d4").evaluate();
    _emitAlchemyRoll3d(damageRoll);
    damageApplied = Math.max(
      0,
      state?.backfired
        ? Math.floor((Number(damageRoll?.total ?? 0) || 0) / 2)
        : (Number(damageRoll?.total ?? 0) || 0)
    );

    const suppressStandaloneSummary = Boolean(String(state?.parentMessageId ?? "").trim());
    const damageResult = await applyDamageResolved(targetActor, {
      rawDamage: damageApplied,
      damageType: "poison",
      ignoreReduction: true,
      hitLocation: "Body",
      source: `Poison (Level ${state?.poisonLevel ?? 1})`,
      weapon: weaponItem ?? null,
      origin: weaponItem ?? null,
      rollHTML: await damageRoll.render(),
      chatContext: {
        parentMessageId: String(state?.parentMessageId ?? "").trim() || null,
        suppressStandaloneSummary,
        alchemyOnHitSuppressed: true,
      },
    });

    if (damageResult?.gmDamageReport && state?.parentMessageId) {
      const parentMessage = game.messages?.get?.(String(state.parentMessageId).trim()) ?? null;
      if (parentMessage) {
        await appendSupplementalDamageReportToMessage(parentMessage, targetActor.uuid, {
          gmDamageReport: damageResult.gmDamageReport,
        });
      }
    }

    statusNote = `${targetActor.name} failed the Endurance test and suffers ${damageApplied} poison damage to Body (ignores armor).`;
  }

  const nextState = {
    ...state,
    resolving: false,
    resolved: true,
    finalTN: endurance.tn,
    rollTotal: endurance.total,
    passed: endurance.success,
    damageApplied,
    statusNote,
  };
  await requestUpdateChatMessage(message, {
    content: renderPoisonResistanceCard({
      actorName: targetActor.name,
      actorUuid: targetActor.uuid,
      weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
      poisonLevel: state?.poisonLevel ?? 1,
      damageFormula: state?.damageFormula ?? "1d4",
      endTN: baseTN,
      finalTN: nextState.finalTN,
      rollTotal: nextState.rollTotal,
      passed: nextState.passed,
      damageApplied: nextState.damageApplied,
      resolving: false,
      resolved: true,
      statusNote: nextState.statusNote,
    }),
    ..._poisonCardFlagPatch(nextState),
  });
}

/**
 * Build AE data for a condition-applying toxin effect.
 * Pure function — no Foundry calls.
 */
function _buildConditionAEData(conditionName, aeName, durationRounds, combatActive) {
  return {
    name: aeName,
    icon: "icons/magic/death/undead-ghost-strike-green.webp",
    statuses: [conditionName.toLowerCase()],
    duration: combatActive
      ? { rounds: durationRounds, combat: game.combat.id }
      : { seconds: durationRounds * 6 },
    changes: [],
    flags: { [FLAG_NS]: { spellEffect: true, alchemyToxin: true } },
  };
}

function _isSaveGatedToxinEffect(effectEntry) {
  if (!effectEntry) return false;
  if (String(effectEntry?.effectSource ?? "catalog") === "spell") {
    const syntheticSpell = _buildSyntheticSpellFromPayload(effectEntry);
    if (!syntheticSpell) return false;
    const spellConfig = normalizeSpellConfig(syntheticSpell);
    return spellConfig?.defenseModel === "characteristic";
  }

  const effectDef = getEffectByKey(effectEntry?.effectKey);
  return Boolean(effectDef?.toxinSave);
}

async function _applyCatalogToxinEffect(targetActor, effectEntry, {
  durationRounds,
  combatActive,
  backfired = false,
} = {}) {
  const aeCreates = [];
  const noteRows = [];
  let damageToApply = 0;
  let magickaDrain = 0;
  let staminaDrain = 0;

  const sl = Number(effectEntry?.spellLevel ?? 1);
  const magnitude = backfired ? Math.max(1, Math.floor(sl / 2)) : sl;
  const effectDef = getEffectByKey(effectEntry?.effectKey);
  if (!effectDef) {
    return { ok: false, noteRows: [_alchemyNoteHtml("Unknown Effect", "Toxin effect definition could not be found.", "is-warning")] };
  }

  const key = effectDef.key;
  if (key === "drainHealth") {
    damageToApply += magnitude;
    noteRows.push(_alchemyNoteHtml(effectDef.label, `${magnitude} Health drained.`, "is-danger"));
  } else if (key === "drainMagicka") {
    magickaDrain += magnitude;
    noteRows.push(_alchemyNoteHtml(effectDef.label, `${magnitude} Magicka drained.`));
  } else if (key === "drainStamina") {
    staminaDrain += magnitude;
    noteRows.push(_alchemyNoteHtml(effectDef.label, `${magnitude} Stamina drained.`));
  } else if (key === "paralyze") {
    aeCreates.push(_buildConditionAEData("Paralyzed", `Paralyze Toxin SL${sl}`, durationRounds, combatActive));
    noteRows.push(_alchemyNoteHtml(effectDef.label, `Paralyzed for ${durationRounds} rounds.`, "is-danger"));
  } else if (key === "silence") {
    aeCreates.push(_buildConditionAEData("Silenced", `Silence Toxin SL${sl}`, durationRounds, combatActive));
    noteRows.push(_alchemyNoteHtml(effectDef.label, `Silenced for ${durationRounds} rounds.`));
  } else if (key === "frenzy") {
    aeCreates.push(_buildConditionAEData("Frenzied", `Frenzy Toxin SL${sl}`, durationRounds, combatActive));
    noteRows.push(_alchemyNoteHtml(effectDef.label, `Frenzied for ${durationRounds} rounds.`, "is-danger"));
  } else if (key === "calm") {
    aeCreates.push(_buildConditionAEData("Calmed", `Calm Toxin SL${sl}`, durationRounds, combatActive));
    noteRows.push(_alchemyNoteHtml(effectDef.label, `Calmed for ${durationRounds} rounds.`));
  } else if (key === "demoralize") {
    aeCreates.push(_buildConditionAEData("Frightened", `Demoralize Toxin SL${sl}`, durationRounds, combatActive));
    noteRows.push(_alchemyNoteHtml(effectDef.label, `Frightened for ${durationRounds} rounds.`, "is-danger"));
  } else if (key === "burden") {
    aeCreates.push({
      name: `Burden Toxin SL${sl}`,
      icon: "icons/equipment/back/pack-heavy.webp",
      duration: combatActive
        ? { rounds: durationRounds, combat: game.combat.id }
        : { seconds: durationRounds * 6 },
      changes: [{ key: "system.encumbrance.penalty", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(sl * 5) }],
      flags: { [FLAG_NS]: { spellEffect: true, alchemyToxin: true } },
    });
    noteRows.push(_alchemyNoteHtml(effectDef.label, `Encumbrance penalty +${sl * 5} for ${durationRounds} rounds.`));
  } else {
    aeCreates.push({
      name: `${_effectLabel(effectEntry)} (Toxin SL${sl})`,
      icon: "icons/magic/death/undead-ghost-strike-green.webp",
      duration: combatActive
        ? { rounds: durationRounds, combat: game.combat.id }
        : { seconds: durationRounds * 6 },
      changes: [],
      flags: { [FLAG_NS]: { spellEffect: true, alchemyToxin: true, toxinEffectKey: key, toxinSL: sl } },
    });
    noteRows.push(_alchemyNoteHtml(effectDef.label, `Applied as a toxin effect for ${durationRounds} rounds.`));
  }

  return { ok: true, aeCreates, noteRows, damageToApply, magickaDrain, staminaDrain };
}

async function _applyFailedToxinEffect(targetActor, effectEntry, {
  casterActor = null,
  potency = 1,
  durationRounds = 10,
  combatActive = false,
} = {}) {
  if (String(effectEntry?.effectSource ?? "catalog") === "spell") {
    const normalizedResult = await _normalizeStoredSpellEffect(effectEntry, { mode: "toxin" });
    if (!normalizedResult?.ok) return normalizedResult;
    const normalizedEffect = _cloneEffectEntryWithPotency(normalizedResult.effectEntry, potency);
    const syntheticSpell = _buildSyntheticSpellFromPayload(normalizedEffect);
    if (!syntheticSpell) {
      return { ok: false, reason: `${_effectLabel(effectEntry)} is missing its serialized spell payload.` };
    }

    const spellConfig = normalizeSpellConfig(syntheticSpell);
    if (spellConfig?.defenseModel === "characteristic") {
      const report = await applyConsequences(targetActor, spellConfig?.consequences ?? {}, {
        source: syntheticSpell.name,
        origin: syntheticSpell.uuid,
        halveFactor: 1,
      });
      return {
        ok: true,
        noteHtml: _alchemyNoteHtml(
          `${_effectLabel(effectEntry)} [Toxin]`,
          `Failed Endurance save. ${formatConsequenceReport(report, "Consequences")}`
        ),
      };
    }

    return _applySerializedSpellEffect(targetActor, normalizedEffect, {
      casterActor,
      potency,
      mode: "toxin",
      noteLabelSuffix: "Toxin",
    });
  }

  const applied = await _applyCatalogToxinEffect(targetActor, effectEntry, {
    durationRounds,
    combatActive,
    backfired: potency < 1,
  });
  if (!applied?.ok) return applied;

  if (applied.damageToApply > 0) {
    await applyDamage(targetActor, applied.damageToApply, "physical", {
      ignoreReduction: true,
      source: "Drain Health (Toxin)",
      skipChatMessage: true,
      chatContext: { alchemyOnHitSuppressed: true, suppressStandaloneSummary: true },
    });
  }

  const actorUpdate = {};
  if ((applied.magickaDrain ?? 0) > 0) {
    const currentMagicka = Number(targetActor.system?.magicka?.value ?? 0);
    actorUpdate["system.magicka.value"] = Math.max(0, currentMagicka - applied.magickaDrain);
  }
  if ((applied.staminaDrain ?? 0) > 0) {
    const { valuePath: staminaPath, value: currentStamina } = _resolveStaminaPaths(targetActor);
    actorUpdate[staminaPath] = Math.max(0, currentStamina - applied.staminaDrain);
  }
  if (Object.keys(actorUpdate).length) {
    await requestUpdateDocument(targetActor, actorUpdate);
  }
  if (Array.isArray(applied.aeCreates) && applied.aeCreates.length) {
    await requestCreateEmbeddedDocuments(targetActor, "ActiveEffect", applied.aeCreates);
  }

  return { ok: true, noteHtml: applied.noteRows.join("\n") };
}

async function _postToxinResistanceCard(targetActor, weaponItem, applied, context = {}, saveEffects = [], directNotesHtml = "") {
  const endTN = _getEnduranceTN(targetActor);
  if (endTN <= 0) {
    ui.notifications.warn(`${targetActor?.name ?? "Target"} has no valid Endurance TN.`);
    return null;
  }

  const effectsHtml = saveEffects.map((effectEntry) =>
    _alchemyNoteHtml(_effectLabel(effectEntry), `Save-gated toxin effect (SL ${Number(effectEntry?.spellLevel ?? 1) || 1}).`)
  ).join("\n");

  const state = {
    kind: "toxinResistance",
    targetActorUuid: String(targetActor?.uuid ?? "").trim(),
    weaponUuid: String(weaponItem?.uuid ?? "").trim(),
    weaponName: String(weaponItem?.name ?? "Weapon").trim() || "Weapon",
    parentMessageId: String(context?.chatContext?.parentMessageId ?? "").trim() || null,
    resolving: false,
    resolved: false,
    endTN,
    finalTN: null,
    rollTotal: null,
    passed: null,
    statusNote: "",
    effects: _cloneData(saveEffects),
    directNotesHtml: String(directNotesHtml ?? ""),
    combatActive: Boolean(game.combat?.active),
    durationRounds: Number(applied?.durationRounds ?? 10) || 10,
    backfired: Boolean(applied?.backfired),
  };

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: renderToxinResistanceCard({
      actorName: targetActor.name,
      actorUuid: targetActor.uuid,
      weaponName: weaponItem?.name ?? "Weapon",
      endTN,
      effectsHtml,
      directNotesHtml,
      resolving: false,
      resolved: false,
    }),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    whisper: _getWhisperRecipientsForActor(targetActor),
    flags: {
      [FLAG_NS]: {
        [ALCHEMY_TOXIN_CARD_KEY]: state,
      },
    },
  });
}

/**
 * Apply toxin effects on hit and decrement remaining hits.
 * Batches all actor stat updates into one requestUpdateDocument call and
 * all AE creations into one createEmbeddedDocuments call to reduce lag.
 * When hitsRemaining reaches 0, the toxin is cleared from the weapon.
 */
async function _resolveToxinOnHit(targetActor, weaponItem, applied, context = {}) {
  const effects = applied.effects ?? [];
  const combatActive = !!game.combat?.active;
  const durationRounds = applied.durationRounds ?? 10;

  const hitsRemaining = Math.max(0, Number(applied.hitsRemaining ?? 1) - 1);
  if (hitsRemaining <= 0) {
    await _clearAppliedAlchemy(weaponItem, applied);
  } else {
    await _updateAppliedAlchemyHits(weaponItem, applied, hitsRemaining);
  }

  const saveEffects = [];
  const directNotes = [];
  const casterActor = weaponItem?.parent?.documentName === "Actor" ? weaponItem.parent : targetActor;

  for (const effectEntry of effects) {
    if (_isSaveGatedToxinEffect(effectEntry)) {
      saveEffects.push(effectEntry);
      continue;
    }

    const resolved = await _applyFailedToxinEffect(targetActor, effectEntry, {
      casterActor,
      potency: applied.backfired ? 0.5 : 1,
      durationRounds,
      combatActive,
    });
    if (!resolved?.ok) {
      directNotes.push(_alchemyNoteHtml(_effectLabel(effectEntry), resolved?.reason ?? "Toxin effect could not be applied.", "is-warning"));
    } else if (resolved.noteHtml) {
      directNotes.push(resolved.noteHtml);
    }
  }

  if (saveEffects.length) {
    await _postToxinResistanceCard(targetActor, weaponItem, applied, context, saveEffects, directNotes.join("\n"));
    return;
  }

  const gmIds = game.users?.filter((u) => u.isGM).map((u) => u.id) ?? [];
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: `
      <div class="uesrpg-alchemy-brew-card">
        <div class="hdr">
          <div class="hdr-text">
            <div class="title">${targetActor.name} - Toxin Delivered</div>
            <div class="sub">GM-visible toxin resolution</div>
          </div>
        </div>
        <div class="body">
          ${directNotes.join("\n") || _alchemyNoteHtml("Effects", "No toxin effects resolved.")}
          ${_alchemyNoteHtml("Hits Remaining", `${hitsRemaining}`)}
        </div>
      </div>
    `,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    whisper: gmIds,
    blind: true,
  });
  return;
}

// ── §7.4 Round tick-down ──────────────────────────────────────────────────────

/**
 * Called on `updateCombat` when the round advances.
 * The Foundry AE duration system decrements `remaining` each round automatically.
 * This hook exists as an extension point for custom countdown chat messages.
 */
export async function resolveToxinResistanceFromChat({ messageId, action } = {}) {
  if (String(action ?? "").trim().toLowerCase() !== "roll") return;
  const message = game.messages?.get?.(String(messageId ?? "").trim()) ?? null;
  if (!message) return;

  const state = _cloneData(message?.flags?.[FLAG_NS]?.[ALCHEMY_TOXIN_CARD_KEY] ?? {});
  if (state?.resolved || state?.resolving) return;

  const targetActor = await fromUuid(String(state?.targetActorUuid ?? "").trim()).catch(() => null);
  if (!targetActor) {
    ui.notifications.warn("Toxin resistance: target actor not found.");
    return;
  }

  const weaponItem = state?.weaponUuid
    ? await fromUuid(String(state.weaponUuid).trim()).catch(() => null)
    : null;
  const baseTN = Math.max(0, Number(state?.endTN ?? _getEnduranceTN(targetActor)) || _getEnduranceTN(targetActor));
  const effectsHtml = Array.isArray(state?.effects)
    ? state.effects.map((effectEntry) =>
      _alchemyNoteHtml(_effectLabel(effectEntry), `Save-gated toxin effect (SL ${Number(effectEntry?.spellLevel ?? 1) || 1}).`)
    ).join("\n")
    : "";

  await requestUpdateChatMessage(message, {
    content: renderToxinResistanceCard({
      actorName: targetActor.name,
      actorUuid: targetActor.uuid,
      weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
      endTN: baseTN,
      effectsHtml,
      directNotesHtml: String(state?.directNotesHtml ?? ""),
      resolving: true,
      resolved: false,
    }),
    ..._toxinCardFlagPatch({
      ...state,
      resolving: true,
      resolved: false,
    }),
  });

  const endurance = await _rollEnduranceTest(targetActor, { label: "Toxin Resistance" });
  if (!endurance?.ok) {
    const failedState = {
      ...state,
      resolving: false,
      resolved: true,
      finalTN: baseTN,
      rollTotal: null,
      passed: null,
      statusNote: endurance?.reason ?? "Toxin resistance test could not be rolled.",
    };
    await requestUpdateChatMessage(message, {
      content: renderToxinResistanceCard({
        actorName: targetActor.name,
        actorUuid: targetActor.uuid,
        weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
        endTN: baseTN,
        effectsHtml,
        directNotesHtml: String(state?.directNotesHtml ?? ""),
        finalTN: failedState.finalTN,
        rollTotal: failedState.rollTotal,
        passed: failedState.passed,
        resolving: false,
        resolved: true,
        statusNote: failedState.statusNote,
      }),
      ..._toxinCardFlagPatch(failedState),
    });
    return;
  }

  const noteRows = [];
  if (!endurance.success) {
    for (const effectEntry of Array.isArray(state?.effects) ? state.effects : []) {
      const resolved = await _applyFailedToxinEffect(targetActor, effectEntry, {
        casterActor: weaponItem?.parent?.documentName === "Actor" ? weaponItem.parent : targetActor,
        potency: state?.backfired ? 0.5 : 1,
        durationRounds: Number(state?.durationRounds ?? 10) || 10,
        combatActive: state?.combatActive === true,
      });
      if (!resolved?.ok) {
        noteRows.push(_alchemyNoteHtml(_effectLabel(effectEntry), resolved?.reason ?? "Toxin effect could not be applied.", "is-warning"));
      } else if (resolved.noteHtml) {
        noteRows.push(resolved.noteHtml);
      }
    }
  }

  const statusNote = endurance.success
    ? `${targetActor.name} resisted the save-gated toxin effects.`
    : `${targetActor.name} failed the Endurance test and suffers the toxin effects.`;
  const combinedEffectsHtml = [
    effectsHtml,
    !endurance.success ? noteRows.join("\n") : "",
  ].filter(Boolean).join("\n");

  const nextState = {
    ...state,
    resolving: false,
    resolved: true,
    finalTN: endurance.tn,
    rollTotal: endurance.total,
    passed: endurance.success,
    statusNote,
  };
  await requestUpdateChatMessage(message, {
    content: renderToxinResistanceCard({
      actorName: targetActor.name,
      actorUuid: targetActor.uuid,
      weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
      endTN: baseTN,
      effectsHtml: combinedEffectsHtml,
      directNotesHtml: String(state?.directNotesHtml ?? ""),
      finalTN: nextState.finalTN,
      rollTotal: nextState.rollTotal,
      passed: nextState.passed,
      resolving: false,
      resolved: true,
      statusNote,
    }),
    ..._toxinCardFlagPatch(nextState),
  });
}

function _onUpdateCombat(combat, updateData) {
  if (!("round" in updateData)) return;
  if (!game.user?.isGM) return;

  for (const actor of game.actors?.contents ?? []) {
    for (const item of actor?.items ?? []) {
      const applied = _getAppliedAlchemy(item);
      if (!applied) continue;
      if (_isAppliedAlchemyExpired(applied)) {
        _clearAppliedAlchemy(item, applied).catch((err) => {
          console.warn("UESRPG | Failed to clear expired alchemy coating", err);
        });
      }
    }
  }
}

// ── §7.5 Chat button handler ──────────────────────────────────────────────────

/**
 * Prompt the actor's owner to pick an equipped weapon from a simple dialog.
 * @param {Actor} actor
 * @returns {Promise<Item|null>}
 */
export async function pickAlchemyWeapon(actor) {
  return pickAlchemyWeaponImpl(actor);
}

export async function pickAlchemyCoatingTarget(actor) {
  return pickAlchemyCoatingTargetImpl(actor);
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function _postAlchemyUseMessage(actor, item, title, bodyHtml) {
  return _postAlchemyUseMessageImpl(actor, item, title, bodyHtml);
}

// ── Initialization ────────────────────────────────────────────────────────────

/**
 * Register all alchemy runtime hooks.
 * Call once from the system.js ready handler.
 * Idempotent — safe to call multiple times; duplicate registrations are silently skipped.
 */
export function initializeAlchemyRuntime() {
  registerAlchemyRuntimeHooks({
    onDamageApplied: _onDamageApplied,
    onUpdateCombat: _onUpdateCombat,
  });
}
