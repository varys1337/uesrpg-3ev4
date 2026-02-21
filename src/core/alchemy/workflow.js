/**
 * Alchemy Brew Workflow
 *
 * Chat-driven, idempotent brew resolution.
 *
 * Public API:
 *   getAlchemySkill(actor)                         → skill item | null
 *   getAlchemyTalents(actor)                       → { isMasterAlchemist, alchemistSchools, hasNothingVentured, hasTrialAndError }
 *   computeEffectiveStrength(ingredient, actor)    → number
 *   buildBrewRecipe(actor, workshopData)            → recipe object | null (with error)
 *   validateBrewRecipe(actor, recipe)              → { ok, errors[] }
 *   computeBrewModifiers(actor, recipe)            → { tn, baseModifiers, totalMod, penaltyBreakdown }
 *   createPendingBrewMessage(actor, recipe)        → Promise<ChatMessage>
 *   handleBrewChatAction(messageId, actionId)      → Promise<void>   (idempotent dispatch)
 *   resolveBrew(actor, recipe, rollResult)         → Promise<{ success, item, backfire }>
 */

import {
  computeEffectCost,
  getEffectByKey,
  effectHasUpkeep,
  computeUpkeepDuration,
  getEffectToxinOverrides,
  POISON_DICE,
  QUALITY_TIERS,
} from "./effects.js";

import {
  shouldCreationBackfire,
  rollCreationBackfire,
  formatCreationBackfire,
} from "./backfire.js";

import { requestUpdateDocument } from "../../utils/authority-proxy.js";

// ── Talent helpers ────────────────────────────────────────────────────────────

/**
 * Locate the Alchemy skill item on an actor.
 * Searches by item type "skill" with a name matching /alchemy/i.
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function getAlchemySkill(actor) {
  return actor?.items?.find(
    (i) => i.type === "skill" && /alchemy/i.test(i.name ?? "")
  ) ?? null;
}

/**
 * Gather alchemy-relevant talent data for an actor.
 * @param {Actor} actor
 * @returns {{
 *   isMasterAlchemist: boolean,
 *   alchemistSchools: string[],
 *   hasNothingVentured: boolean,
 *   hasTrialAndError: boolean,
 * }}
 */
export function getAlchemyTalents(actor) {
  const talents = actor?.items?.filter((i) => i.type === "talent") ?? [];

  const hasName = (name) =>
    talents.some((t) => String(t.name ?? "").toLowerCase() === name.toLowerCase());

  const alchemistSchools = talents
    .filter((t) => /^alchemist\s*\[/i.test(t.name ?? ""))
    .map((t) => {
      const m = String(t.name ?? "").match(/\[([^\]]+)\]/);
      return m?.[1]?.toLowerCase() ?? null;
    })
    .filter(Boolean);

  return {
    isMasterAlchemist: hasName("Master Alchemist"),
    alchemistSchools,
    hasNothingVentured: hasName("Nothing Ventured, Nothing Gained"),
    hasTrialAndError: hasName("Trial and Error"),
  };
}

/**
 * Compute the effective strength of an ingredient after applying talent bonuses.
 * Alchemist [School] grants +10% (round down) to matching school ingredients.
 * Master Alchemist grants +20% (stacks to +30% total).
 * @param {Item} ingredient
 * @param {Actor} actor
 * @returns {number}
 */
export function computeEffectiveStrength(ingredient, actor) {
  const data = ingredient?.flags?.["uesrpg-3ev4"]?.alchemy ?? {};
  const base = Number(data.strengthBase ?? 0);
  const school = String(data.school ?? "").toLowerCase();
  const talents = getAlchemyTalents(actor);

  const hasSchool = talents.alchemistSchools.includes(school);
  const isMaster = talents.isMasterAlchemist;

  // Stacking: Alchemist [School] alone → +10%; Master alone → +20%; both → +30%.
  let bonus = 0;
  if (hasSchool) bonus += 0.10;
  if (isMaster) bonus += 0.20;

  return Math.floor(base * (1 + bonus));
}

// ── Recipe helpers ────────────────────────────────────────────────────────────

/**
 * Deterministic string hash for a recipe — used by Trial and Error tracking.
 * @param {object} recipe
 * @returns {string}
 */
function _recipeHash(recipe) {
  const effects = (recipe.effects ?? [])
    .map((e) => `${e.effectKey ?? ""}:${e.spellLevel ?? 1}`)
    .sort()
    .join(",");
  return `${recipe.mode}|${effects}|${recipe.poisonLevel ?? 0}`;
}

/**
 * Get the cumulative Trial and Error bonus for a recipe attempt.
 * Returns +10 per prior failed attempt on the same recipe, max +30.
 * @param {Actor} actor
 * @param {object} recipe
 * @returns {number}  0, 10, 20, or 30.
 */
async function _getTrialAndErrorBonus(actor, recipe) {
  const hash = _recipeHash(recipe);
  const te = actor?.flags?.["uesrpg-3ev4"]?.alchemy?.trialAndError ?? {};
  return Math.min(30, (te[hash] ?? 0) * 10);
}

/**
 * Increment the Trial and Error counter for a recipe after a failure.
 * Max 3 (giving +30 on the third attempt).
 * @param {Actor} actor
 * @param {object} recipe
 */
async function _incrementTrialAndError(actor, recipe) {
  if (!actor) return;
  const hash = _recipeHash(recipe);
  const existing = foundry.utils.deepClone(
    actor?.flags?.["uesrpg-3ev4"]?.alchemy?.trialAndError ?? {}
  );
  existing[hash] = Math.min(3, (existing[hash] ?? 0) + 1);
  await requestUpdateDocument(actor, {
    "flags.uesrpg-3ev4.alchemy.trialAndError": existing,
  });
}

/**
 * Reset the Trial and Error counter for a recipe after a success.
 * @param {Actor} actor
 * @param {object} recipe
 */
async function _resetTrialAndError(actor, recipe) {
  if (!actor) return;
  const hash = _recipeHash(recipe);
  const existing = foundry.utils.deepClone(
    actor?.flags?.["uesrpg-3ev4"]?.alchemy?.trialAndError ?? {}
  );
  if (existing[hash]) {
    delete existing[hash];
    await requestUpdateDocument(actor, {
      "flags.uesrpg-3ev4.alchemy.trialAndError": existing,
    });
  }
}

// ── TN + modifier computation ─────────────────────────────────────────────────

/**
 * Compute the full modifier breakdown for a brew attempt.
 *
 * Returns:
 *   tn             Base TN from the Alchemy skill.
 *   alchemyRank    floor(skillLevel / 10) or floor(skillTotal / 10).
 *   penaltyBreakdown  Array of { label, value } for display.
 *   totalMod       Net modifier to add to TN (negative = penalty).
 *   brewTime       Estimated brew time in hours.
 *
 * @param {Actor}  actor
 * @param {object} recipe
 * @param {object} opts
 * @param {boolean} opts.nothingVentured   Nothing Ventured… is active.
 * @param {number}  opts.trialAndErrorBonus Bonus from Trial and Error (0/10/20/30).
 * @returns {object}
 */
export function computeBrewModifiers(actor, recipe, { nothingVentured = false, trialAndErrorBonus = 0 } = {}) {
  const skill = getAlchemySkill(actor);
  const tn = Number(skill?.system?.total ?? 0);
  const skillLevel = Number(skill?.system?.level ?? skill?.system?.total ?? 0);
  const alchemyRank = Math.floor(skillLevel / 10);

  const breakdown = [];
  let totalMod = 0;

  // Nothing Ventured, Nothing Gained: +20 to test (but doubles = backfire, fail = auto-backfire).
  if (nothingVentured) {
    breakdown.push({ label: "Nothing Ventured, Nothing Gained", value: +20 });
    totalMod += 20;
  }

  // Trial and Error: +10/+20/+30 on repeated failed recipes.
  if (trialAndErrorBonus > 0) {
    breakdown.push({ label: "Trial and Error (repeated recipe)", value: trialAndErrorBonus });
    totalMod += trialAndErrorBonus;
  }

  if (recipe.mode === "potion" || recipe.mode === "toxin") {
    const effects = recipe.effects ?? [];
    // Penalty: -10 per level by which highest effect SL exceeds Alchemy rank.
    const highestSL = Math.max(0, ...effects.map((e) => Number(e.spellLevel ?? 1)));
    const slOverage = Math.max(0, highestSL - alchemyRank);
    if (slOverage > 0) {
      breakdown.push({ label: `SL ${highestSL} exceeds Alchemy rank ${alchemyRank}`, value: -10 * slOverage });
      totalMod -= 10 * slOverage;
    }

    // Penalty: -10 if potion has more than one effect.
    if (effects.length > 1) {
      breakdown.push({ label: "Multiple effects (>1)", value: -10 });
      totalMod -= 10;
    }

    // Brew time: hours = sum of spell levels.
    const brewTime = effects.reduce((sum, e) => sum + Number(e.spellLevel ?? 1), 0);

    return { tn, alchemyRank, penaltyBreakdown: breakdown, totalMod, brewTime };
  }

  if (recipe.mode === "poison") {
    const poisonLevel = Number(recipe.poisonLevel ?? 1);
    // Penalty: -10 per level by which poison level exceeds Alchemy rank.
    const poisonOverage = Math.max(0, poisonLevel - alchemyRank);
    if (poisonOverage > 0) {
      breakdown.push({ label: `Poison level ${poisonLevel} exceeds Alchemy rank ${alchemyRank}`, value: -10 * poisonOverage });
      totalMod -= 10 * poisonOverage;
    }

    return { tn, alchemyRank, penaltyBreakdown: breakdown, totalMod, brewTime: 1 };
  }

  return { tn, alchemyRank, penaltyBreakdown: breakdown, totalMod, brewTime: 0 };
}

// ── Recipe validation ─────────────────────────────────────────────────────────

/**
 * Validate a complete brew recipe against RAW constraints.
 * Returns { ok: boolean, errors: string[] }.
 * @param {Actor}  actor
 * @param {object} recipe
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateBrewRecipe(actor, recipe) {
  const errors = [];
  const requireLab = game.settings.get("uesrpg-3ev4", "alchemy.requireLab");

  // Lab check.
  if (requireLab) {
    const hasLab = actor?.items?.some(
      (i) => /alchemy\s*lab/i.test(i.name ?? "")
    );
    if (!hasLab) {
      errors.push("No Alchemy Lab found in inventory (required by world settings).");
    }
  }

  // Tools check (RAW: requires alchemical tools).
  const hasTools = actor?.items?.some(
    (i) => /alchemy\s*(tools?|kit|equipment)/i.test(i.name ?? "")
  );
  if (!hasTools) {
    errors.push("No Alchemical Tools found in inventory (required by RAW).");
  }

  if (recipe.mode === "potion" || recipe.mode === "toxin") {
    const slots = recipe.slots ?? [];
    const filledSlots = slots.filter((s) => s.ingredientId && s.effectKey);

    if (filledSlots.length === 0) {
      errors.push("No ingredients or effects selected.");
      return { ok: false, errors };
    }

    for (const slot of filledSlots) {
      const ingredient = actor?.items?.get(slot.ingredientId);
      if (!ingredient) {
        errors.push(`Ingredient not found in inventory (${slot.ingredientId}).`);
        continue;
      }

      const algData = ingredient.flags?.["uesrpg-3ev4"]?.alchemy ?? {};
      const effectData = getEffectByKey(slot.effectKey);

      if (!effectData) {
        errors.push(`Unknown effect: ${slot.effectKey}.`);
        continue;
      }

      // School match.
      if (effectData.school !== algData.school) {
        errors.push(`Effect "${effectData.label}" (${effectData.school}) does not match ingredient school "${algData.school}".`);
      }

      // Depth (max SL) constraint.
      const depth = Number(algData.depthBase ?? 0);
      const sl = Number(slot.spellLevel ?? 1);
      if (sl > depth) {
        errors.push(`Effect "${effectData.label}" SL ${sl} exceeds ingredient depth ${depth}.`);
      }

      // Strength (cost) constraint.
      const effectiveStrength = computeEffectiveStrength(ingredient, actor);
      const cost = computeEffectCost(slot.effectKey, sl);
      if (cost > effectiveStrength) {
        errors.push(`Effect "${effectData.label}" cost ${cost} exceeds ingredient effective strength ${effectiveStrength}.`);
      }

      // SL range constraint.
      const [slMin, slMax] = effectData.slRange ?? [1, 7];
      if (sl < slMin || sl > slMax) {
        errors.push(`Effect "${effectData.label}" SL ${sl} is outside allowed range [${slMin}–${slMax}].`);
      }

      // Attribute gate.
      if (recipe.mode === "potion" && !effectData.attributes.includes("potion")) {
        errors.push(`Effect "${effectData.label}" does not have the Potion attribute.`);
      }
      if (recipe.mode === "toxin" && !effectData.attributes.includes("toxin")) {
        errors.push(`Effect "${effectData.label}" does not have the Toxin attribute.`);
      }
    }

    // Unique effects constraint (each effect used at most once).
    const effectKeys = filledSlots.map((s) => s.effectKey);
    const unique = new Set(effectKeys);
    if (unique.size < effectKeys.length) {
      errors.push("Each effect may only be selected once per brew.");
    }
  }

  if (recipe.mode === "poison") {
    const ingredient = actor?.items?.get(recipe.ingredientId);
    if (!ingredient) {
      errors.push("No destruction ingredient selected.");
    } else {
      const algData = ingredient.flags?.["uesrpg-3ev4"]?.alchemy ?? {};
      if (String(algData.school ?? "").toLowerCase() !== "destruction") {
        errors.push("Poison brewing requires a Destruction ingredient.");
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── Pending brew chat message ─────────────────────────────────────────────────

/**
 * Create a pending brew chat message containing the recipe summary and a Roll button.
 * The message stores the full recipe in its flags so the roll can be idempotently resolved.
 *
 * @param {Actor}  actor
 * @param {object} recipe  Validated recipe object from the workshop.
 * @param {object} opts
 * @param {boolean} opts.nothingVentured  Nothing Ventured… toggle state.
 * @returns {Promise<ChatMessage>}
 */
export async function createPendingBrewMessage(actor, recipe, { nothingVentured = false } = {}) {
  const skill = getAlchemySkill(actor);
  const talents = getAlchemyTalents(actor);
  const trialBonus = talents.hasTrialAndError
    ? await _getTrialAndErrorBonus(actor, recipe)
    : 0;

  const { tn, alchemyRank, penaltyBreakdown, totalMod, brewTime } = computeBrewModifiers(actor, recipe, {
    nothingVentured,
    trialAndErrorBonus: trialBonus,
  });

  const adjustedTN = Math.max(0, tn + totalMod);
  const modeLabel = { potion: "Brew Potion", poison: "Brew Poison", toxin: "Brew Toxin" }[recipe.mode] ?? recipe.mode;

  // Render penalty rows.
  const penaltyRows = penaltyBreakdown.map(
    (p) => `<div class="uesrpg-da-row"><span class="k">${p.label}</span><span class="v">${p.value > 0 ? "+" : ""}${p.value}</span></div>`
  ).join("");

  // Effect summary for potion/toxin.
  let effectsHtml = "";
  if (recipe.mode === "potion" || recipe.mode === "toxin") {
    const rows = (recipe.slots ?? []).filter((s) => s.ingredientId && s.effectKey).map((s) => {
      const ingredient = actor.items.get(s.ingredientId);
      const effectData = getEffectByKey(s.effectKey);
      const algData = ingredient?.flags?.["uesrpg-3ev4"]?.alchemy ?? {};
      const effStr = computeEffectiveStrength(ingredient, actor);
      const cost = computeEffectCost(s.effectKey, s.spellLevel ?? 1);
      const upkeepDur = effectHasUpkeep(s.effectKey)
        ? computeUpkeepDuration(s.effectKey, effStr, cost)
        : null;
      const durStr = upkeepDur ? ` (${upkeepDur.value} ${upkeepDur.unit})` : "";
      return `<div class="uesrpg-da-row"><span class="k">${effectData?.label ?? s.effectKey}</span><span class="v">SL ${s.spellLevel ?? 1}, Cost ${cost}/${effStr}${durStr}</span></div>`;
    });
    effectsHtml = rows.join("");
  }

  // Poison summary.
  let poisonHtml = "";
  if (recipe.mode === "poison") {
    const ingredient = actor.items.get(recipe.ingredientId);
    const algData = ingredient?.flags?.["uesrpg-3ev4"]?.alchemy ?? {};
    const depth = Number(algData.depthBase ?? 1);
    const dice = POISON_DICE[depth] ?? "1d4";
    poisonHtml = `<div class="uesrpg-da-row"><span class="k">Ingredient</span><span class="v">${ingredient?.name ?? "?"}</span></div>
      <div class="uesrpg-da-row"><span class="k">Poison Level</span><span class="v">${depth} (${dice} damage)</span></div>`;
    recipe.poisonLevel = depth;
    recipe.damageFormula = dice;
  }

  const content = `
    <div class="uesrpg-alchemy-brew-card">
      <div class="hdr">
        <img class="actor-thumb" src="${actor.img ?? "icons/svg/mystery-man.svg"}" alt="">
        <div class="hdr-text">
          <div class="title">${actor.name}</div>
          <div class="sub">${modeLabel}</div>
        </div>
      </div>
      <div class="body">
        <div class="uesrpg-da-row"><span class="k">Alchemy Skill</span><span class="v">${skill?.name ?? "Alchemy"} (TN ${tn})</span></div>
        <div class="uesrpg-da-row"><span class="k">Alchemy Rank</span><span class="v">${alchemyRank}</span></div>
        ${effectsHtml}${poisonHtml}
        ${penaltyRows}
        <div class="uesrpg-da-row"><span class="k">Adjusted TN</span><span class="v"><strong>${adjustedTN}</strong></span></div>
        ${nothingVentured ? '<div class="uesrpg-da-row"><span class="k">⚠ Nothing Ventured</span><span class="v">Doubles or fail = backfire</span></div>' : ""}
        ${trialBonus > 0 ? `<div class="uesrpg-da-row"><span class="k">Trial and Error</span><span class="v">+${trialBonus}</span></div>` : ""}
        <div class="uesrpg-da-row"><span class="k">Brew Time</span><span class="v">${brewTime} hour${brewTime !== 1 ? "s" : ""}</span></div>
      </div>
      <div class="footer" style="margin-top:0.5rem;">
        <button type="button"
          data-action="alchemyRoll"
          data-actor-uuid="${actor.uuid}"
          style="width:100%;padding:0.4rem 0;font-weight:bold;">
          Roll Alchemy (TN ${adjustedTN})
        </button>
      </div>
    </div>
  `;

  // Persist recipe + modifier context in message flags for idempotent resolution.
  const messageFlags = {
    "uesrpg-3ev4": {
      alchemy: {
        type: "brewPending",
        actorUuid: actor.uuid,
        recipe,
        nothingVentured,
        adjustedTN,
        alchemyRank,
        trialBonus,
        resolved: false,
      },
    },
  };

  const message = await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: messageFlags,
  });

  return message;
}

// ── Chat action dispatch ──────────────────────────────────────────────────────

/**
 * Handle a click on the Roll Alchemy button embedded in a brew-pending chat card.
 * Idempotent: stores resolution state in message flags so double-clicks are safe.
 *
 * @param {string} messageId  ID of the ChatMessage.
 */
export async function handleBrewChatAction(messageId) {
  const message = game.messages.get(messageId);
  if (!message) return;

  const flags = message.flags?.["uesrpg-3ev4"]?.alchemy;
  if (!flags || flags.type !== "brewPending") return;

  // Idempotency guard — already resolved.
  if (flags.resolved) {
    ui.notifications.info("This brew has already been resolved.");
    return;
  }

  const actor = await fromUuid(flags.actorUuid);
  if (!actor) {
    ui.notifications.error("UESRPG | Alchemy: Actor not found.");
    return;
  }

  // Only the owner (or GM) may resolve.
  if (!actor.isOwner && !game.user.isGM) {
    ui.notifications.warn("You do not own this actor and cannot resolve this brew.");
    return;
  }

  // Roll the Alchemy skill test.
  const roll = new Roll("1d100");
  await roll.evaluate();
  const rollTotal = roll.total;

  const { adjustedTN, recipe, nothingVentured, alchemyRank, trialBonus } = flags;

  // Degree of Success/Failure: standard UESRPG d100 resolution.
  const success = rollTotal <= adjustedTN;
  const critical = rollTotal % 11 === 0; // doubles = critical (either CS or CF)
  const doubles = critical;
  const criticalSuccess = doubles && success;
  const criticalFail = doubles && !success;

  // Resolve brew.
  const result = await resolveBrew(actor, recipe, {
    rollTotal,
    success,
    criticalSuccess,
    criticalFail,
    doubles,
    nothingVentured,
    alchemyRank,
    adjustedTN,
  });

  // Mark the message as resolved (prevents double-resolution).
  await message.update({
    "flags.uesrpg-3ev4.alchemy.resolved": true,
    "flags.uesrpg-3ev4.alchemy.rollTotal": rollTotal,
    "flags.uesrpg-3ev4.alchemy.success": success,
  });

  // Post result chat card.
  await _postBrewResultMessage(actor, recipe, roll, rollTotal, adjustedTN, success, criticalSuccess, criticalFail, result);
}

// ── Brew resolution ───────────────────────────────────────────────────────────

/**
 * Resolve a brew attempt: consume ingredients, evaluate backfire, create item.
 *
 * @param {Actor}  actor
 * @param {object} recipe
 * @param {object} rollCtx
 * @returns {Promise<{ success: boolean, item: Item|null, backfireResult: object|null }>}
 */
export async function resolveBrew(actor, recipe, rollCtx) {
  const {
    rollTotal,
    success,
    criticalFail = false,
    doubles = false,
    nothingVentured = false,
    alchemyRank = 0,
  } = rollCtx;

  // Determine backfire conditions.
  const talents = getAlchemyTalents(actor);
  const effects = recipe.slots?.filter((s) => s.ingredientId && s.effectKey) ?? [];
  const multiEffect = effects.length > 1;
  const highestSL = Math.max(1, ...effects.map((e) => Number(e.spellLevel ?? 1)));
  const exceedsRank = highestSL > alchemyRank;

  const backfires = shouldCreationBackfire({
    critical: criticalFail,
    failed: !success,
    multiEffect,
    exceedsRank,
    nothingVentured,
    doubles,
    isMasterAlchemist: talents.isMasterAlchemist && !nothingVentured,
  });

  // Consume ingredients (reduce qty by 1 or delete if qty reaches 0).
  await _consumeIngredients(actor, recipe);

  let backfireResult = null;
  let createdItem = null;

  if (backfires) {
    backfireResult = await rollCreationBackfire(highestSL);
    const outcome = backfireResult.entry?.outcome ?? "lost";

    if (outcome !== "lost") {
      // "backfired" outcome → create item with backfired flag.
      createdItem = await _createAlchemyItem(actor, recipe, { backfired: true, backfireResult });
    }

    // Increment Trial and Error on failure.
    if (talents.hasTrialAndError) {
      await _incrementTrialAndError(actor, recipe);
    }

    return { success: false, item: createdItem, backfireResult };
  }

  if (success) {
    createdItem = await _createAlchemyItem(actor, recipe, { backfired: false });

    // Reset Trial and Error on success.
    if (talents.hasTrialAndError) {
      await _resetTrialAndError(actor, recipe);
    }

    return { success: true, item: createdItem, backfireResult: null };
  }

  // Plain failure (no backfire): nothing created.
  if (talents.hasTrialAndError) {
    await _incrementTrialAndError(actor, recipe);
  }

  return { success: false, item: null, backfireResult: null };
}

// ── Item creation ─────────────────────────────────────────────────────────────

/**
 * Build and create the alchemical item on the actor.
 * @param {Actor}  actor
 * @param {object} recipe
 * @param {object} opts
 * @param {boolean} opts.backfired
 * @param {object|null} opts.backfireResult
 * @returns {Promise<Item|null>}
 */
async function _createAlchemyItem(actor, recipe, { backfired = false, backfireResult = null } = {}) {
  const skill = getAlchemySkill(actor);
  const alchemyRank = Math.floor(Number(skill?.system?.level ?? 0) / 10);

  let itemName;
  let alchemyFlags;

  if (recipe.mode === "potion") {
    const effectLabels = (recipe.slots ?? [])
      .filter((s) => s.effectKey)
      .map((s) => getEffectByKey(s.effectKey)?.label ?? s.effectKey)
      .join(", ");
    itemName = backfired ? `Backfired Potion (${effectLabels})` : `Potion (${effectLabels})`;

    const effects = (recipe.slots ?? []).filter((s) => s.ingredientId && s.effectKey).map((s) => {
      const ingredient = actor.items.get(s.ingredientId);
      const effStr = computeEffectiveStrength(ingredient, actor);
      const cost = computeEffectCost(s.effectKey, s.spellLevel ?? 1);
      const upkeepDur = effectHasUpkeep(s.effectKey)
        ? computeUpkeepDuration(s.effectKey, effStr, cost)
        : null;
      const effectData = getEffectByKey(s.effectKey);
      return {
        effectKey: s.effectKey,
        school: effectData?.school ?? "",
        spellLevel: Number(s.spellLevel ?? 1),
        attributes: effectData?.attributes ?? [],
        cost,
        baseDuration: effectData?.baseDuration ?? null,
        finalDuration: upkeepDur,
        params: s.params ?? {},
        toxinOverrides: getEffectToxinOverrides(s.effectKey),
      };
    });

    alchemyFlags = {
      kind: "potion",
      effects,
      backfired,
      backfire: backfireResult
        ? {
            creationRollTotal: backfireResult.total ?? null,
            creationResultKey: backfireResult.entry?.key ?? null,
          }
        : {},
      brew: {
        alchemistActorUuid: actor.uuid,
        alchemyRank,
        brewedAt: Date.now(),
      },
    };
  } else if (recipe.mode === "poison") {
    itemName = backfired
      ? `Backfired Poison (Level ${recipe.poisonLevel ?? 1})`
      : `Poison (Level ${recipe.poisonLevel ?? 1})`;

    alchemyFlags = {
      kind: "poison",
      poisonLevel: recipe.poisonLevel ?? 1,
      damageFormula: recipe.damageFormula ?? "1d4",
      backfired,
      backfire: backfireResult ? { creationResultKey: backfireResult.entry?.key ?? null } : {},
      brew: { alchemistActorUuid: actor.uuid, alchemyRank, brewedAt: Date.now() },
    };
  } else if (recipe.mode === "toxin") {
    const effectLabels = (recipe.slots ?? [])
      .filter((s) => s.effectKey)
      .map((s) => getEffectByKey(s.effectKey)?.label ?? s.effectKey)
      .join(", ");
    itemName = backfired ? `Backfired Toxin (${effectLabels})` : `Toxin (${effectLabels})`;

    const effects = (recipe.slots ?? []).filter((s) => s.ingredientId && s.effectKey).map((s) => {
      const effectData = getEffectByKey(s.effectKey);
      const overrides = getEffectToxinOverrides(s.effectKey);
      return {
        effectKey: s.effectKey,
        school: effectData?.school ?? "",
        spellLevel: Number(s.spellLevel ?? 1),
        attributes: effectData?.attributes ?? [],
        cost: computeEffectCost(s.effectKey, s.spellLevel ?? 1),
        toxinOverrides: overrides,
        params: s.params ?? {},
      };
    });

    alchemyFlags = {
      kind: "toxin",
      effects,
      durationRounds: 10,
      maxHits: 3,
      backfired,
      backfire: backfireResult ? { creationResultKey: backfireResult.entry?.key ?? null } : {},
      brew: { alchemistActorUuid: actor.uuid, alchemyRank, brewedAt: Date.now() },
    };
  } else {
    return null;
  }

  const itemData = {
    name: itemName,
    type: "item",
    img: "icons/consumables/potions/bottle-conical-empty-glass.webp",
    // Use canonical UESRPG item schema keys (template.json): enc, quantity, description.
    // Mark alchemical products as consumable so they appear in the Combat → Use Item picker.
    system: { quantity: 1, enc: 0, description: "", consumable: true, wearable: false, equipped: false },
    flags: { "uesrpg-3ev4": { alchemy: alchemyFlags } },
  };

  const [created] = await actor.createEmbeddedDocuments("Item", [itemData]);
  return created ?? null;
}

// ── Ingredient consumption ────────────────────────────────────────────────────

/**
 * Reduce ingredient quantities by 1 (or delete if quantity reaches 0).
 * @param {Actor}  actor
 * @param {object} recipe
 */
async function _consumeIngredients(actor, recipe) {
  const ids = new Set();

  if (recipe.mode === "potion" || recipe.mode === "toxin") {
    for (const slot of recipe.slots ?? []) {
      if (slot.ingredientId) ids.add(slot.ingredientId);
    }
  } else if (recipe.mode === "poison") {
    if (recipe.ingredientId) ids.add(recipe.ingredientId);
  }

  for (const id of ids) {
    const item = actor.items.get(id);
    if (!item) continue;
    const qty = Number(item.system?.quantity ?? 1);
    if (qty <= 1) {
      await item.delete();
    } else {
      await requestUpdateDocument(item, { "system.quantity": qty - 1 });
    }
  }
}

// ── Result chat card ──────────────────────────────────────────────────────────

async function _postBrewResultMessage(actor, recipe, roll, rollTotal, adjustedTN, success, criticalSuccess, criticalFail, result) {
  const outcomeLabel = criticalSuccess
    ? "Critical Success"
    : success
    ? "Success"
    : criticalFail
    ? "Critical Failure"
    : "Failure";

  const outcomeColor = success ? "#388e3c" : "#c62828";
  const backfireHtml = result.backfireResult
    ? `<div class="uesrpg-da-row" style="color:#c62828;"><span class="k">⚡ Backfire</span><span class="v">${formatCreationBackfire(result.backfireResult)}</span></div>`
    : "";

  const itemHtml = result.item
    ? `<div class="uesrpg-da-row"><span class="k">Created</span><span class="v">${result.item.name}</span></div>`
    : !success
    ? `<div class="uesrpg-da-row"><span class="k">Result</span><span class="v">Nothing created — materials consumed.</span></div>`
    : "";

  let drinkButtonHtml = "";
  if (result.item && (result.item.flags?.["uesrpg-3ev4"]?.alchemy?.kind === "potion")) {
    drinkButtonHtml = `<button type="button"
      data-action="alchemyDrink"
      data-item-uuid="${result.item.uuid}"
      data-actor-uuid="${actor.uuid}"
      style="margin-top:0.5rem;width:100%;padding:0.3rem;">
      Drink Potion${result.item.flags?.["uesrpg-3ev4"]?.alchemy?.backfired ? " (Backfired!)" : ""}
    </button>`;
  }
  if (result.item && (result.item.flags?.["uesrpg-3ev4"]?.alchemy?.kind === "poison" || result.item.flags?.["uesrpg-3ev4"]?.alchemy?.kind === "toxin")) {
    drinkButtonHtml = `<button type="button"
      data-action="alchemyApplyToWeapon"
      data-item-uuid="${result.item.uuid}"
      data-actor-uuid="${actor.uuid}"
      style="margin-top:0.5rem;width:100%;padding:0.3rem;">
      Apply to Weapon
    </button>`;
  }

  const content = `
    <div class="uesrpg-alchemy-brew-card">
      <div class="hdr">
        <img class="actor-thumb" src="${actor.img ?? "icons/svg/mystery-man.svg"}" alt="">
        <div class="hdr-text">
          <div class="title">${actor.name} — Brew Result</div>
          <div class="sub" style="color:${outcomeColor};font-weight:bold;">${outcomeLabel} (${rollTotal} vs TN ${adjustedTN})</div>
        </div>
      </div>
      <div class="body">
        ${await roll.render()}
        ${itemHtml}
        ${backfireHtml}
        ${drinkButtonHtml}
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
