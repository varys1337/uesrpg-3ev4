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
 *   §7.2  Apply to Weapon   — tag weapon with poison/toxin flags, emit confirmation
 *   §7.3  On-hit resolution — poison/toxin fires when a tagged weapon connects (via uesrpgDamageApplied)
 *   §7.4  Round tick-down   — upkeep/duration tracking via updateCombat hook
 *   §7.5  Chat card button  — click handler wired to renderChatMessage
 *
 * Internal helpers are not exported; only initializeAlchemyRuntime(), drinkPotion(),
 * and applyAlchemyToWeapon() are public.
 */

import { getEffectByKey, computeEffectCost, computeUpkeepDuration, effectHasUpkeep } from "./effects.js";
import { rollPotionBackfire } from "./backfire.js";
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { applyDamage, applyHealing } from "../combat/damage/apply.js";
import { renderApplyToWeaponCard, renderAlchemyUseCard } from "./render.js";
import { FLAG_SCOPE } from "../system/namespace.js";

// ── Flag namespace constant (delegated to canonical FLAG_SCOPE from namespace.js) ──
const FLAG_NS = FLAG_SCOPE;

// ── Internal flag helpers ─────────────────────────────────────────────────────

function _getAlchemyFlags(item) {
  return item?.flags?.[FLAG_NS]?.alchemy ?? {};
}

function _getAppliedAlchemy(weapon) {
  return weapon?.flags?.[FLAG_NS]?.alchemyApplied ?? null;
}

// ── Idempotency guard ─────────────────────────────────────────────────────────
let _runtimeInitialized = false;

// ── §H Stamina path resolver ──────────────────────────────────────────────────

/**
 * Resolve the correct stamina document path and current values for an actor.
 * Actors with `staminaPoints` use that field; others use `stamina`.
 * @param {Actor} actor
 * @returns {{ valuePath: string, value: number, max: number }}
 */
function _resolveStaminaPaths(actor) {
  const usePoints = actor.system?.staminaPoints !== undefined;
  return {
    valuePath: usePoints ? "system.staminaPoints.value" : "system.stamina.value",
    value: Number(actor.system?.staminaPoints?.value ?? actor.system?.stamina?.value ?? 0),
    max: Number(actor.system?.staminaPoints?.max ?? actor.system?.stamina?.max ?? 0),
  };
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
  const algData = _getAlchemyFlags(potionItem);
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
    const bfEntry = bfResult.entry;
    backfireHtml = `<div class="uesrpg-da-row" style="color:#c62828;"><span class="k">⚡ Backfire (1d10=${bfResult.roll})</span><span class="v">${bfEntry?.label ?? "?"} — ${bfEntry?.description ?? ""}</span></div>`;

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
          backfireHtml += `<div class="uesrpg-da-row"><span class="k">Minor Effect (2d8=${bfResult.minorEffect.roll})</span><span class="v">${bfResult.minorEffect.entry.label} — ${bfResult.minorEffect.entry.description}</span></div>`;
        }
        if (bfEntry?.outcome === "dangerous") {
          const dmgRoll = new Roll("1d8");
          await dmgRoll.evaluate();
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
        backfireHtml += `<div class="uesrpg-da-row"><span class="k">Sickened</span><span class="v">Make an Endurance test or gain Poisoned for 1d6 rounds.</span></div>`;
        await _consumeAlchemyItem(actor, potionItem);
        await _postAlchemyUseMessage(actor, potionItem, "Potion Consumed — Sickened!", backfireHtml);
        return;

      default:
        break;
    }
  }

  // Apply each effect.
  const effectResultRows = [];

  for (const effectEntry of algData.effects ?? []) {
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

  // Dispel: descriptive only (GM/automation handles).
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
    icon: "icons/consumables/potions/bottle-conical-empty-glass.webp",
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
  if (!actor || !alchemyItem || !weaponItem) return;
  if (!actor.isOwner && !game.user.isGM) {
    ui.notifications.warn("You do not own this actor.");
    return;
  }

  const algData = _getAlchemyFlags(alchemyItem);
  if (!algData || (algData.kind !== "poison" && algData.kind !== "toxin")) {
    ui.notifications.warn("That item is not a brewed poison or toxin.");
    return;
  }

  // Store on the weapon in flags so the on-hit hook can read it.
  await requestUpdateDocument(weaponItem, {
    [`flags.${FLAG_NS}.alchemyApplied`]: {
      kind: algData.kind,
      itemUuid: alchemyItem.uuid,
      appliedAt: Date.now(),
      ...(algData.kind === "poison" && {
        damageFormula: algData.damageFormula ?? "1d4",
        poisonLevel: algData.poisonLevel ?? 1,
        backfired: algData.backfired ?? false,
      }),
      ...(algData.kind === "toxin" && {
        effects: algData.effects ?? [],
        durationRounds: algData.durationRounds ?? 10,
        maxHits: algData.maxHits ?? 3,
        hitsRemaining: algData.maxHits ?? 3,
        backfired: algData.backfired ?? false,
      }),
    },
  });

  // Consume the alchemy item from inventory.
  await _consumeAlchemyItem(actor, alchemyItem);

  // Confirmation chat card.
  const content = renderApplyToWeaponCard({
    actorImg: actor.img ?? "icons/svg/mystery-man.svg",
    actorName: actor.name,
    weaponName: weaponItem.name,
    kind: algData.kind,
    poisonLevel: algData.poisonLevel ?? 1,
    damageFormula: algData.damageFormula ?? "1d4",
    effects: algData.effects ?? [],
    maxHits: algData.kind === "toxin" ? (algData.maxHits ?? 3) : 1,
    backfired: algData.backfired ?? false,
    getEffectLabel: (k) => getEffectByKey(k)?.label ?? k,
  });

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

// ── §7.3 On-hit resolution ────────────────────────────────────────────────────

/**
 * Called on `uesrpgDamageApplied`.
 * Checks if the attacker's weapon has alchemyApplied data; if so, resolves it.
 */
async function _onDamageApplied(targetActor, context) {
  const weapon = context?.weapon ?? context?.origin ?? null;
  if (!weapon || weapon.documentName !== "Item") return;

  const applied = _getAppliedAlchemy(weapon);
  if (!applied) return;

  if (applied.kind === "poison") {
    await _resolvePoisonOnHit(targetActor, weapon, applied);
  }

  if (applied.kind === "toxin") {
    await _resolveToxinOnHit(targetActor, weapon, applied);
  }
}

/**
 * Apply poison damage (ignoring armor) on hit.
 */
async function _resolvePoisonOnHit(targetActor, weaponItem, applied) {
  const formula = applied.damageFormula ?? "1d4";
  const dmgRoll = new Roll(formula);
  await dmgRoll.evaluate();
  const damage = applied.backfired ? Math.floor(dmgRoll.total / 2) : dmgRoll.total;

  await applyDamage(targetActor, damage, "poison", {
    ignoreReduction: true,
    source: `Poison (Level ${applied.poisonLevel ?? 1})`,
    skipChatMessage: false,
  });

  // Poison is single-use: clear the applied flag from the weapon.
  await requestUpdateDocument(weaponItem, { [`flags.${FLAG_NS}.alchemyApplied`]: null });
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

/**
 * Apply toxin effects on hit and decrement remaining hits.
 * Batches all actor stat updates into one requestUpdateDocument call and
 * all AE creations into one createEmbeddedDocuments call to reduce lag.
 * When hitsRemaining reaches 0, the toxin is cleared from the weapon.
 */
async function _resolveToxinOnHit(targetActor, weaponItem, applied) {
  const effects = applied.effects ?? [];
  const combatActive = !!game.combat?.active;
  const durationRounds = applied.durationRounds ?? 10;

  // Accumulate all updates before applying.
  const aeCreates = [];
  let totalDrainHealthDamage = 0;
  let magickaDrain = 0;
  let staminaDrain = 0;

  // Read current resource values once (avoids stale reads across per-effect updates).
  const currentMagicka = Number(targetActor.system?.magicka?.value ?? 0);
  const { valuePath: staminaPath, value: currentStamina } = _resolveStaminaPaths(targetActor);

  for (const effectEntry of effects) {
    const effectDef = getEffectByKey(effectEntry.effectKey);
    if (!effectDef) continue;

    const sl = Number(effectEntry.spellLevel ?? 1);
    const magnitude = applied.backfired ? Math.max(1, Math.floor(sl / 2)) : sl;
    const key = effectDef.key;

    if (key === "drainHealth") {
      totalDrainHealthDamage += magnitude;
    } else if (key === "drainMagicka") {
      magickaDrain += magnitude;
    } else if (key === "drainStamina") {
      staminaDrain += magnitude;
    } else if (key === "paralyze") {
      aeCreates.push(_buildConditionAEData("Paralyzed", `Paralyze Toxin SL${sl}`, durationRounds, combatActive));
    } else if (key === "silence") {
      aeCreates.push(_buildConditionAEData("Silenced", `Silence Toxin SL${sl}`, durationRounds, combatActive));
    } else if (key === "frenzy") {
      aeCreates.push(_buildConditionAEData("Frenzied", `Frenzy Toxin SL${sl}`, durationRounds, combatActive));
    } else if (key === "calm") {
      aeCreates.push(_buildConditionAEData("Calmed", `Calm Toxin SL${sl}`, durationRounds, combatActive));
    } else if (key === "demoralize") {
      aeCreates.push(_buildConditionAEData("Frightened", `Demoralize Toxin SL${sl}`, durationRounds, combatActive));
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
    } else {
      // Fallback: descriptive AE for GM to resolve.
      aeCreates.push({
        name: `${effectDef.label} (Toxin SL${sl})`,
        icon: "icons/magic/death/undead-ghost-strike-green.webp",
        duration: combatActive
          ? { rounds: durationRounds, combat: game.combat.id }
          : { seconds: durationRounds * 6 },
        changes: [],
        flags: { [FLAG_NS]: { spellEffect: true, alchemyToxin: true, toxinEffectKey: key, toxinSL: sl } },
      });
    }
  }

  // Apply accumulated drain health (single applyDamage call).
  if (totalDrainHealthDamage > 0) {
    await applyDamage(targetActor, totalDrainHealthDamage, "physical", {
      ignoreReduction: true,
      source: "Drain Health (Toxin)",
      skipChatMessage: true,
    });
  }

  // Apply accumulated magicka and stamina drains (single requestUpdateDocument call).
  const actorUpdate = {};
  if (magickaDrain > 0) actorUpdate["system.magicka.value"] = Math.max(0, currentMagicka - magickaDrain);
  if (staminaDrain > 0) actorUpdate[staminaPath] = Math.max(0, currentStamina - staminaDrain);
  if (Object.keys(actorUpdate).length) {
    await requestUpdateDocument(targetActor, actorUpdate);
  }

  // Apply all AE creations in one batch.
  if (aeCreates.length) {
    await requestCreateEmbeddedDocuments(targetActor, "ActiveEffect", aeCreates);
  }

  // Decrement hits (on the weapon document — cannot be merged with actor update).
  const hitsRemaining = Math.max(0, Number(applied.hitsRemaining ?? 1) - 1);
  if (hitsRemaining <= 0) {
    await requestUpdateDocument(weaponItem, { [`flags.${FLAG_NS}.alchemyApplied`]: null });
  } else {
    await requestUpdateDocument(weaponItem, {
      [`flags.${FLAG_NS}.alchemyApplied.hitsRemaining`]: hitsRemaining,
    });
  }

  // Confirmation message (whispered to GM).
  const gmIds = game.users?.filter((u) => u.isGM).map((u) => u.id) ?? [];
  const effectLabels = effects.map((e) => getEffectByKey(e.effectKey)?.label ?? e.effectKey).join(", ");
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: `<div class="uesrpg-alchemy-brew-card"><div class="hdr-text"><div class="title">${targetActor.name} — Toxin Delivered</div></div><div class="body"><div class="uesrpg-da-row"><span class="k">Effects</span><span class="v">${effectLabels}</span></div><div class="uesrpg-da-row"><span class="k">Hits remaining on weapon</span><span class="v">${hitsRemaining}</span></div></div></div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    whisper: gmIds,
    blind: true,
  });
}

// ── §7.4 Round tick-down ──────────────────────────────────────────────────────

/**
 * Called on `updateCombat` when the round advances.
 * The Foundry AE duration system decrements `remaining` each round automatically.
 * This hook exists as an extension point for custom countdown chat messages.
 */
function _onUpdateCombat(combat, updateData) {
  if (!("round" in updateData)) return;
  // No additional tick logic needed — native AE duration handles expiry.
}

// ── §7.5 Chat button handler ──────────────────────────────────────────────────

/**
 * Prompt the actor's owner to pick an equipped weapon from a simple dialog.
 * @param {Actor} actor
 * @returns {Promise<Item|null>}
 */
export async function pickAlchemyWeapon(actor) {
  const weapons = actor.items.filter((i) => i.type === "weapon" && i.system?.equipped);
  if (weapons.length === 0) {
    ui.notifications.warn("No equipped weapons found.");
    return null;
  }

  if (weapons.length === 1) return weapons[0];

  const options = weapons.map((w) => `<option value="${w.id}">${w.name}</option>`).join("");
  const content = `<p>Select a weapon to coat:</p><select name="weaponId" style="width:100%;">${options}</select>`;

  const { customDialog } = await import("../../utils/dialog-v2-helper.js");
  const result = await customDialog({
    title: "Apply to Weapon",
    content,
    buttons: {
      ok: { label: "Apply", icon: "fas fa-check" },
      cancel: { label: "Cancel", icon: "fas fa-times" },
    },
    default: "ok",
    callback: (html) => {
      if (!html) return null;
      return html.querySelector("select[name='weaponId']")?.value ?? null;
    },
  });

  if (!result) return null;
  return actor.items.get(result) ?? null;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function _consumeAlchemyItem(actor, item) {
  const qty = Number(item.system?.quantity ?? 1);
  if (qty <= 1) {
    if (item.parent?.documentName === "Actor") {
      await requestDeleteEmbeddedDocuments(item.parent, "Item", [item.id]);
      return;
    }
    await item.delete();
  } else {
    await requestUpdateDocument(item, { "system.quantity": qty - 1 });
  }
}

async function _postAlchemyUseMessage(actor, item, title, bodyHtml) {
  const content = renderAlchemyUseCard({
    actorImg: actor.img ?? "icons/svg/mystery-man.svg",
    actorName: actor.name,
    title,
    bodyHtml,
  });
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

// ── Initialization ────────────────────────────────────────────────────────────

/**
 * Register all alchemy runtime hooks.
 * Call once from the system.js ready handler.
 * Idempotent — safe to call multiple times; duplicate registrations are silently skipped.
 */
export function initializeAlchemyRuntime() {
  if (_runtimeInitialized) {
    console.warn("UESRPG | Alchemy runtime already initialized — skipping duplicate registration.");
    return;
  }
  _runtimeInitialized = true;

  // On-hit: react to any damage-applied event.
  Hooks.on("uesrpgDamageApplied", (targetActor, context) => {
    _onDamageApplied(targetActor, context).catch((err) => {
      console.error("UESRPG | Alchemy on-hit resolution failed", err);
    });
  });

  // Round tick-down: react when combat advances.
  Hooks.on("updateCombat", (combat, updateData) => {
    try {
      _onUpdateCombat(combat, updateData);
    } catch (err) {
      console.warn("UESRPG | Alchemy round tick failed", err);
    }
  });

  console.log("UESRPG | Alchemy runtime hooks registered.");
}
