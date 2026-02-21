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
 * Internal helpers are not exported; only initializeAlchemyRuntime() is public.
 */

import { getEffectByKey, computeEffectCost, computeUpkeepDuration, effectHasUpkeep } from "./effects.js";
import { rollPotionBackfire } from "./backfire.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { applyDamage, applyHealing } from "../combat/damage/apply.js";
import { getChatMessageRoot } from "../combat/chat-handlers/render/render-chat-message.js";

// ── Guard ─────────────────────────────────────────────────────────────────────
// No runtime gating: alchemy automation is always active.

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
  const algData = potionItem.flags?.["uesrpg-3ev4"]?.alchemy;
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
        // Minor effects / dangerous: apply inline (descriptive only, GM resolves manually).
        if (bfResult.minorEffect?.entry) {
          backfireHtml += `<div class="uesrpg-da-row"><span class="k">Minor Effect (2d8=${bfResult.minorEffect.roll})</span><span class="v">${bfResult.minorEffect.entry.label} — ${bfResult.minorEffect.entry.description}</span></div>`;
        }
        if (bfEntry?.outcome === "dangerous") {
          // Apply 1d8 physical damage (ignoring armor).
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
        // Sickened: Endurance test (descriptive, GM calls).
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
    const current = Number(actor.system?.stamina?.value ?? actor.system?.staminaPoints?.value ?? 0);
    const max = Number(actor.system?.stamina?.max ?? actor.system?.staminaPoints?.max ?? 0);
    const path = actor.system?.staminaPoints !== undefined
      ? "system.staminaPoints.value"
      : "system.stamina.value";
    const newVal = Math.min(max, current + magnitude);
    await requestUpdateDocument(actor, { [path]: newVal });
    return `<div class="uesrpg-da-row"><span class="k">${label}</span><span class="v">+${magnitude} Stamina restored</span></div>`;
  }

  // Upkeep effects → create a timed Active Effect.
  if (effectDef.attributes.includes("upkeep") && finalDuration) {
    const durationRounds = finalDuration.unit === "minutes"
      ? finalDuration.value * 10   // 1 minute = 10 rounds (6-second rounds)
      : finalDuration.value;

    const aeData = _buildPotionAE(actor, effectDef, sl, magnitude, durationRounds, params);
    await actor.createEmbeddedDocuments("ActiveEffect", [aeData]);

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
      "uesrpg-3ev4": {
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
      // Attribute not selected in this path — returns an empty change set;
      // the AE name makes it visible for manual tracking.
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

  const algData = alchemyItem.flags?.["uesrpg-3ev4"]?.alchemy;
  if (!algData || (algData.kind !== "poison" && algData.kind !== "toxin")) {
    ui.notifications.warn("That item is not a brewed poison or toxin.");
    return;
  }

  // Store on the weapon in flags so the on-hit hook can read it.
  await requestUpdateDocument(weaponItem, {
    "flags.uesrpg-3ev4.alchemyApplied": {
      kind: algData.kind,
      itemUuid: alchemyItem.uuid,
      appliedAt: Date.now(),
      // Poison: damage dice + level
      ...(algData.kind === "poison" && {
        damageFormula: algData.damageFormula ?? "1d4",
        poisonLevel: algData.poisonLevel ?? 1,
        backfired: algData.backfired ?? false,
      }),
      // Toxin: effects array + duration state
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
  const content = `
    <div class="uesrpg-alchemy-brew-card">
      <div class="hdr">
        <img class="actor-thumb" src="${actor.img ?? "icons/svg/mystery-man.svg"}" alt="">
        <div class="hdr-text">
          <div class="title">${actor.name}</div>
          <div class="sub">Applied ${algData.kind === "poison" ? "Poison" : "Toxin"} to ${weaponItem.name}</div>
        </div>
      </div>
      <div class="body">
        <div class="uesrpg-da-row"><span class="k">Weapon</span><span class="v">${weaponItem.name}</span></div>
        ${algData.kind === "poison"
          ? `<div class="uesrpg-da-row"><span class="k">Poison Level</span><span class="v">${algData.poisonLevel ?? 1} (${algData.damageFormula ?? "1d4"})</span></div>`
          : (algData.effects ?? []).map(e => `<div class="uesrpg-da-row"><span class="k">${getEffectByKey(e.effectKey)?.label ?? e.effectKey}</span><span class="v">SL ${e.spellLevel ?? 1}</span></div>`).join("")}
        <div class="uesrpg-da-row"><span class="k">Hits</span><span class="v">${algData.kind === "toxin" ? (algData.maxHits ?? 3) : 1} remaining</span></div>
        ${algData.backfired ? '<div class="uesrpg-da-row" style="color:#c62828;"><span class="k">⚠ Backfired</span><span class="v">Effects may be unpredictable</span></div>' : ""}
      </div>
    </div>
  `;

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
  // context.weapon is populated by the combat resolver (resolve.js).
  // context.origin is the legacy/direct-path fallback (e.g. spells, AoE).
  const weapon = context?.weapon ?? context?.origin ?? null;
  if (!weapon || weapon.documentName !== "Item") return;

  const applied = weapon.flags?.["uesrpg-3ev4"]?.alchemyApplied;
  if (!applied) return;

  // Resolve poison.
  if (applied.kind === "poison") {
    await _resolvePoisonOnHit(targetActor, weapon, applied);
  }

  // Resolve toxin.
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
    ignoreReduction: true,   // RAW: poison damage bypasses armor
    source: `Poison (Level ${applied.poisonLevel ?? 1})`,
    skipChatMessage: false,
  });

  // Poison is single-use: clear the applied flag from the weapon.
  await requestUpdateDocument(weaponItem, { "flags.uesrpg-3ev4.alchemyApplied": null });
}

/**
 * Apply toxin effects on hit and decrement remaining hits.
 * When hitsRemaining reaches 0, the toxin is cleared from the weapon.
 */
async function _resolveToxinOnHit(targetActor, weaponItem, applied) {
  const effects = applied.effects ?? [];

  for (const effectEntry of effects) {
    const effectDef = getEffectByKey(effectEntry.effectKey);
    if (!effectDef) continue;

    const sl = Number(effectEntry.spellLevel ?? 1);
    const magnitude = applied.backfired ? Math.max(1, Math.floor(sl / 2)) : sl;
    const durationRounds = applied.durationRounds ?? 10;

    await _applyToxinEffect(targetActor, effectDef, sl, magnitude, durationRounds, effectEntry);
  }

  // Decrement hits.
  const hitsRemaining = Math.max(0, Number(applied.hitsRemaining ?? 1) - 1);
  if (hitsRemaining <= 0) {
    await requestUpdateDocument(weaponItem, { "flags.uesrpg-3ev4.alchemyApplied": null });
  } else {
    await requestUpdateDocument(weaponItem, {
      "flags.uesrpg-3ev4.alchemyApplied.hitsRemaining": hitsRemaining,
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

/**
 * Apply a single toxin effect to the target (creates AE or applies damage).
 */
async function _applyToxinEffect(targetActor, effectDef, sl, magnitude, durationRounds, effectEntry) {
  const key = effectDef.key;

  // Drain effects: instant HP/Magicka/Stamina reduction.
  if (key === "drainHealth") {
    await applyDamage(targetActor, magnitude * 1, "physical", {
      ignoreReduction: true,
      source: `Drain Health (Toxin SL${sl})`,
      skipChatMessage: true,
    });
    return;
  }
  if (key === "drainMagicka") {
    const current = Number(targetActor.system?.magicka?.value ?? 0);
    await requestUpdateDocument(targetActor, {
      "system.magicka.value": Math.max(0, current - magnitude),
    });
    return;
  }
  if (key === "drainStamina") {
    const path = targetActor.system?.staminaPoints !== undefined
      ? "system.staminaPoints.value"
      : "system.stamina.value";
    const current = Number(targetActor.system?.staminaPoints?.value ?? targetActor.system?.stamina?.value ?? 0);
    await requestUpdateDocument(targetActor, { [path]: Math.max(0, current - magnitude) });
    return;
  }

  // Condition-applying effects: create an AE that signals the condition.
  // The condition engine picks up statuses from AEs.
  if (key === "paralyze") {
    await _createConditionAE(targetActor, "Paralyzed", `Paralyze Toxin SL${sl}`, durationRounds);
    return;
  }
  if (key === "silence") {
    await _createConditionAE(targetActor, "Silenced", `Silence Toxin SL${sl}`, durationRounds);
    return;
  }
  if (key === "frenzy") {
    await _createConditionAE(targetActor, "Frenzied", `Frenzy Toxin SL${sl}`, durationRounds);
    return;
  }
  if (key === "calm") {
    await _createConditionAE(targetActor, "Calmed", `Calm Toxin SL${sl}`, durationRounds);
    return;
  }
  if (key === "demoralize") {
    await _createConditionAE(targetActor, "Frightened", `Demoralize Toxin SL${sl}`, durationRounds);
    return;
  }

  // Burden: add encumbrance AE.
  if (key === "burden") {
    const combatActive = !!game.combat?.active;
    await targetActor.createEmbeddedDocuments("ActiveEffect", [{
      name: `Burden Toxin SL${sl}`,
      icon: "icons/equipment/back/pack-heavy.webp",
      duration: combatActive
        ? { rounds: durationRounds, combat: game.combat.id }
        : { seconds: durationRounds * 6 },
      changes: [{ key: "system.encumbrance.penalty", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(sl * 5) }],
      flags: { "uesrpg-3ev4": { spellEffect: true, alchemyToxin: true } },
    }]);
    return;
  }

  // Fallback: descriptive AE for GM to resolve.
  const combatActive = !!game.combat?.active;
  await targetActor.createEmbeddedDocuments("ActiveEffect", [{
    name: `${effectDef.label} (Toxin SL${sl})`,
    icon: "icons/magic/death/undead-ghost-strike-green.webp",
    duration: combatActive
      ? { rounds: durationRounds, combat: game.combat.id }
      : { seconds: durationRounds * 6 },
    changes: [],
    flags: { "uesrpg-3ev4": { spellEffect: true, alchemyToxin: true, toxinEffectKey: key, toxinSL: sl } },
  }]);
}

async function _createConditionAE(targetActor, conditionName, aeName, durationRounds) {
  const combatActive = !!game.combat?.active;
  await targetActor.createEmbeddedDocuments("ActiveEffect", [{
    name: aeName,
    icon: "icons/magic/death/undead-ghost-strike-green.webp",
    statuses: [conditionName.toLowerCase()],
    duration: combatActive
      ? { rounds: durationRounds, combat: game.combat.id }
      : { seconds: durationRounds * 6 },
    changes: [],
    flags: { "uesrpg-3ev4": { spellEffect: true, alchemyToxin: true } },
  }]);
}

// ── §7.4 Round tick-down ──────────────────────────────────────────────────────

/**
 * Called on `updateCombat` when the round advances.
 * Logs remaining duration on active alchemy AEs (actual expiry is handled by the
 * spell-effect-expiration system which already tracks AE duration natively).
 * This hook is lightweight — if the expiration system handles it, we skip.
 */
function _onUpdateCombat(combat, updateData) {
  // Only fire when the round advances (not on initiative/turn changes alone).
  if (!("round" in updateData)) return;

  // The Foundry AE duration system decrements `remaining` each round automatically
  // when the AE has a `rounds` duration and a combat ID.  Our alchemy AEs are
  // created with that structure so no additional tick logic is needed here.
  // This hook exists as an extension point for custom countdown chat messages.
}

// ── §7.5 Chat button handler ──────────────────────────────────────────────────

/**
 * Listen for clicks on alchemy action buttons embedded in chat cards.
 * Actions: alchemyRoll, alchemyDrink, alchemyApplyToWeapon.
 *
 * Wired to `renderChatMessageHTML` via initializeAlchemyRuntime().
 */
function _onRenderChatMessage(message, html) {
  // Foundry v13 passes an HTMLElement; some module interactions may provide a jQuery wrapper.
  const root = getChatMessageRoot(html);
  if (!root) return;

  root.querySelectorAll("[data-action='alchemyRoll']").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const msgId = message.id;
      const { handleBrewChatAction } = await import("./workflow.js");
      await handleBrewChatAction(msgId);
    });
  });

  root.querySelectorAll("[data-action='alchemyDrink']").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const actorUuid = btn.dataset.actorUuid;
      const itemUuid  = btn.dataset.itemUuid;
      if (!actorUuid || !itemUuid) return;
      const actor = await fromUuid(actorUuid);
      const item  = await fromUuid(itemUuid);
      if (!actor || !item) return;
      await drinkPotion(actor, item);
    });
  });

  root.querySelectorAll("[data-action='alchemyApplyToWeapon']").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const actorUuid = btn.dataset.actorUuid;
      const itemUuid  = btn.dataset.itemUuid;
      if (!actorUuid || !itemUuid) return;
      const actor      = await fromUuid(actorUuid);
      const alchyItem  = await fromUuid(itemUuid);
      if (!actor || !alchyItem) return;

      // Show weapon picker dialog.
      const weapon = await _pickWeapon(actor);
      if (!weapon) return;
      await applyAlchemyToWeapon(actor, alchyItem, weapon);
    });
  });
}

/**
 * Prompt the actor's owner to pick an equipped weapon from a simple dialog.
 * @param {Actor} actor
 * @returns {Promise<Item|null>}
 */
async function _pickWeapon(actor) {
  const weapons = actor.items.filter((i) => i.type === "weapon" && i.system?.equipped);
  if (weapons.length === 0) {
    ui.notifications.warn("No equipped weapons found.");
    return null;
  }

  if (weapons.length === 1) return weapons[0];

  // Build option list for a simple select dialog.
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
    await item.delete();
  } else {
    await requestUpdateDocument(item, { "system.quantity": qty - 1 });
  }
}

async function _postAlchemyUseMessage(actor, item, title, bodyHtml) {
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="uesrpg-alchemy-brew-card">
        <div class="hdr">
          <img class="actor-thumb" src="${actor.img ?? "icons/svg/mystery-man.svg"}" alt="">
          <div class="hdr-text">
            <div class="title">${actor.name}</div>
            <div class="sub">${title}</div>
          </div>
        </div>
        <div class="body">${bodyHtml}</div>
      </div>
    `,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

// ── Initialization ────────────────────────────────────────────────────────────

/**
 * Register all alchemy runtime hooks.
 * Call once from the system.js ready handler.
 *
 * Runtime is always enabled. Hooks are still registered in a single place and
 * only once to keep lifecycle deterministic and avoid duplicate listeners.
 */
export function initializeAlchemyRuntime() {
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

  // Chat button handler: always registered so historical cards remain interactive.
  Hooks.on("renderChatMessageHTML", (message, html) => {
    try {
      _onRenderChatMessage(message, html);
    } catch (err) {
      console.warn("UESRPG | Alchemy chat button handler failed", err);
    }
  });

  console.log("UESRPG | Alchemy runtime hooks registered.");
}
