/**
 * Alchemy Brew Workflow
 *
 * Chat-driven, idempotent brew resolution.
 */

import {
  getEffectByKey,
  POISON_DICE,
} from "./effects.js";

import {
  shouldCreationBackfire,
  rollCreationBackfire,
  formatCreationBackfire,
} from "./backfire.js";

import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import {
  consumeOwnedItem,
  createAlchemyChatMessage,
  createOwnedItem,
} from "./operations.js";

import {
  renderBrewPendingCard,
  renderBrewResultCard,
} from "./render.js";

import {
  ALCHEMY_DEFAULT_ICON,
  cloneAlchemyData as _cloneData,
  emitAlchemyRoll3d as _emitAlchemyRoll3d,
  FLAG_NS,
  formatAlchemyDurationLabel as _formatDurationLabel,
  getAlchemyFlags as _getAlchemyFlags,
} from "./shared.js";
import {
  addActorKnownAlchemyEffect as addActorKnownAlchemyEffectImpl,
  getActorKnownAlchemyEffects as getActorKnownAlchemyEffectsImpl,
  removeActorKnownAlchemyEffect as removeActorKnownAlchemyEffectImpl,
} from "./workflow-known-effects.js";
import {
  computeEffectiveStrength as computeEffectiveStrengthImpl,
  getAlchemySkill as getAlchemySkillImpl,
  getAlchemySkillSnapshot as getAlchemySkillSnapshotImpl,
  getAlchemyTalents as getAlchemyTalentsImpl,
} from "./workflow-actor.js";
import {
  buildDirectAlchemyPayloadForSpell as buildDirectAlchemyPayloadForSpellImpl,
  getActorAlchemySpellEffects as getActorAlchemySpellEffectsImpl,
  getAlchemyInventoryState as getAlchemyInventoryStateImpl,
  getFilledAlchemySlots as _getFilledAlchemySlotsImpl,
  getSlotIdentifier as _getSlotIdentifierImpl,
  resolveAlchemyEffectDescriptor as resolveAlchemyEffectDescriptorImpl,
} from "./workflow-descriptors.js";
import {
  computeBrewModifiers as computeBrewModifiersImpl,
  validateBrewRecipe as validateBrewRecipeImpl,
} from "./workflow-validation.js";
import {
  getSpellDamageType,
  isHealingSpell,
} from "../magic/magicka-utils.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "../skills/skill-tn.js";
import { buildResistanceBonusSection, readResistanceBonusSelections, buildResistanceBonusMods } from "../traits/trait-resistance-ui.js";
import { normalizeSkillRollOptions } from "../skills/roll-request.js";
import { getAllCharacteristicOptions, getPreferredSkillCharacteristic, normalizeCharacteristicKey } from "../../utils/maps/characteristics.js";
import { computeAlchemyRecipeHash, updateTrialAndErrorState } from "./workflow-state.js";
import { buildActorItemSnapshot } from "./utils.js";

export function getActorKnownAlchemyEffects(actor) {
  return getActorKnownAlchemyEffectsImpl(actor);
}

export async function addActorKnownAlchemyEffect(actor, spell) {
  return addActorKnownAlchemyEffectImpl(actor, spell);
}

export async function removeActorKnownAlchemyEffect(actor, spellUuid) {
  return removeActorKnownAlchemyEffectImpl(actor, spellUuid);
}

export function buildDirectAlchemyPayloadForSpell(spell, {
  mode = "potion",
  spellLevel = 1,
  cost = 0,
  finalDuration = null,
} = {}) {
  return buildDirectAlchemyPayloadForSpellImpl(spell, { mode, spellLevel, cost, finalDuration });
}

export function getAlchemyInventoryState(actor) {
  return getAlchemyInventoryStateImpl(actor);
}

export function getActorAlchemySpellEffects(actor, mode) {
  return getActorAlchemySpellEffectsImpl(actor, mode);
}

export function resolveAlchemyEffectDescriptor(actor, slot, { ingredient = null, talents = null, mode = "potion" } = {}) {
  return resolveAlchemyEffectDescriptorImpl(actor, slot, { ingredient, talents, mode });
}

export function getAlchemySkill(actor) {
  return getAlchemySkillImpl(actor);
}

export function getAlchemySkillSnapshot(actor, { skill = null } = {}) {
  return getAlchemySkillSnapshotImpl(actor, { skill });
}

export function getAlchemyTalents(actor) {
  return getAlchemyTalentsImpl(actor);
}

export function computeEffectiveStrength(ingredient, actor, opts = {}) {
  return computeEffectiveStrengthImpl(ingredient, actor, opts);
}

async function _getTrialAndErrorBonus(actor, recipe) {
  const hash = computeAlchemyRecipeHash(recipe, {
    getFilledSlots: _getFilledAlchemySlotsImpl,
    getSlotIdentifier: _getSlotIdentifierImpl,
  });
  const te = actor?.flags?.[FLAG_NS]?.alchemy?.trialAndError ?? {};
  return Math.min(30, (te[hash] ?? 0) * 10);
}

async function _incrementTrialAndError(actor, recipe) {
  if (!actor) return;
  const hash = computeAlchemyRecipeHash(recipe, {
    getFilledSlots: _getFilledAlchemySlotsImpl,
    getSlotIdentifier: _getSlotIdentifierImpl,
  });
  const existing = foundry.utils.deepClone(actor?.flags?.[FLAG_NS]?.alchemy?.trialAndError ?? {});
  existing[hash] = Math.min(3, (existing[hash] ?? 0) + 1);
  await updateTrialAndErrorState(actor, existing);
}

async function _resetTrialAndError(actor, recipe) {
  if (!actor) return;
  const hash = computeAlchemyRecipeHash(recipe, {
    getFilledSlots: _getFilledAlchemySlotsImpl,
    getSlotIdentifier: _getSlotIdentifierImpl,
  });
  const existing = foundry.utils.deepClone(actor?.flags?.[FLAG_NS]?.alchemy?.trialAndError ?? {});
  if (existing[hash]) {
    delete existing[hash];
    await updateTrialAndErrorState(actor, existing);
  }
}

export function computeBrewModifiers(actor, recipe, opts = {}) {
  return computeBrewModifiersImpl(actor, recipe, opts);
}

export function validateBrewRecipe(actor, recipe) {
  return validateBrewRecipeImpl(actor, recipe);
}

export async function createPendingBrewMessage(actor, recipe, { nothingVentured = false } = {}) {
  const itemSnapshot = buildActorItemSnapshot(actor);
  const skill = getAlchemySkill(actor, { items: itemSnapshot.items });
  const skillSnapshot = getAlchemySkillSnapshot(actor, { skill, items: itemSnapshot.items });
  const talents = getAlchemyTalents(actor, { items: itemSnapshot.items });
  const trialBonus = talents.hasTrialAndError ? await _getTrialAndErrorBonus(actor, recipe) : 0;
  const validation = validateBrewRecipe(actor, recipe);

  const { tn, alchemyRank, penaltyBreakdown, totalMod, brewTime } = computeBrewModifiers(actor, recipe, {
    nothingVentured,
    trialAndErrorBonus: trialBonus,
    skill,
  });

  const adjustedTN = Math.max(0, tn + totalMod);
  const modeLabel = { potion: "Brew Potion", poison: "Brew Poison", toxin: "Brew Toxin" }[recipe.mode] ?? recipe.mode;
  const penaltyRowsHtml = penaltyBreakdown.map(
    (p) => `<div class="uesrpg-da-row"><span class="k">${p.label}</span><span class="v">${p.value > 0 ? "+" : ""}${p.value}</span></div>`
  ).join("");

  let effectsHtml = "";
  if (recipe.mode === "potion" || recipe.mode === "toxin") {
    effectsHtml = _getFilledAlchemySlotsImpl(recipe).map((slot) => {
      const ingredient = actor.items.get(slot.ingredientId);
      const effectiveStrength = computeEffectiveStrength(ingredient, actor, { talents });
      const effect = resolveAlchemyEffectDescriptor(actor, slot, { ingredient, talents, mode: recipe.mode });
      if (!effect) return "";
      const sourceLabel = effect.effectSource === "spell" ? " [Spell]" : "";
      const durationLabel = effect.finalDuration ? ` (${_formatDurationLabel(effect.finalDuration)})` : "";
      return `<div class="uesrpg-da-row"><span class="k">${effect.effectLabel}${sourceLabel}</span><span class="v">SL ${effect.spellLevel}, Cost ${effect.cost}/${effectiveStrength}${durationLabel}</span></div>`;
    }).join("");
  }

  let poisonHtml = "";
  if (recipe.mode === "poison") {
    const ingredient = actor.items.get(recipe.ingredientId);
    const algData = _getAlchemyFlags(ingredient);
    const depth = Number(algData.depthBase ?? 1);
    const dice = POISON_DICE[depth] ?? "1d4";
    poisonHtml = `<div class="uesrpg-da-row"><span class="k">Ingredient</span><span class="v">${ingredient?.name ?? "?"}</span></div>
      <div class="uesrpg-da-row"><span class="k">Poison Level</span><span class="v">${depth} (${dice} damage)</span></div>`;
    recipe.poisonLevel = depth;
    recipe.damageFormula = dice;
  }

  const content = renderBrewPendingCard({
    actorImg: actor.img ?? "icons/svg/mystery-man.svg",
    actorName: actor.name,
    modeLabel,
    skillName: skill?.name ?? "Alchemy",
    tn: skillSnapshot.tn,
    alchemyRank: skillSnapshot.rank,
    effectsHtml,
    poisonHtml,
    penaltyRowsHtml,
    warningRowsHtml: "",
    adjustedTN,
    nothingVentured,
    trialBonus,
    brewTime,
    actorUuid: actor.uuid,
  });

  const messageFlags = {
    [FLAG_NS]: {
      alchemy: {
        type: "brewPending",
        actorUuid: actor.uuid,
        recipe,
        nothingVentured,
        adjustedTN,
        alchemyRank: skillSnapshot.rank,
        trialBonus,
        resolved: false,
        resolving: false,
      },
    },
  };

  return createAlchemyChatMessage({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: messageFlags,
  });
}

async function _promptAlchemyRollDeclaration(actor, skill) {
  if (!actor || !skill) return null;

  const governingOptions = getAllCharacteristicOptions(actor);
  const showCharacteristicSelect = governingOptions.length > 0;
  const defaultCharacteristic = getPreferredSkillCharacteristic(actor, skill)
    || normalizeCharacteristicKey(skill?.system?.baseCha ?? "")
    || (governingOptions[0]?.key ?? "");
  const resistanceSection = buildResistanceBonusSection(actor);

  const getLast = () => {
    try {
      const saved = game.settings.get("uesrpg-3ev4", "skillRollLastOptions") ?? {};
      delete saved.selectedCharacteristicKey;
      return saved;
    } catch (_err) {
      return {};
    }
  };

  const setLast = async (patch = {}) => {
    const previous = getLast();
    const next = { ...previous, ...patch };
    next.lastSkillUuidByActor = {
      ...(previous.lastSkillUuidByActor ?? {}),
      ...(patch.lastSkillUuidByActor ?? {}),
    };
    delete next.selectedCharacteristicKey;
    try {
      await game.settings.set("uesrpg-3ev4", "skillRollLastOptions", next);
    } catch (_err) {
      // Non-fatal preference persistence.
    }
  };

  const last = getLast();
  const defaults = normalizeSkillRollOptions(last, {
    difficultyKey: "average",
    manualMod: 0,
    useSpec: false,
    selectedCharacteristicKey: defaultCharacteristic,
  });

  const difficultyOptions = SKILL_DIFFICULTIES.map((entry) => {
    const sign = Number(entry.mod ?? 0) >= 0 ? "+" : "";
    const selected = entry.key === defaults.difficultyKey ? "selected" : "";
    return `<option value="${entry.key}" ${selected}>${entry.label} (${sign}${entry.mod})</option>`;
  }).join("\n");

  const specializationText = String(skill?.system?.trainedItems ?? "").trim().length > 0
    ? ""
    : ' <span style="opacity:0.75;">(none on this skill)</span>';
  const hasSpec = String(skill?.system?.trainedItems ?? "").trim().length > 0;

  const content = `
    <div class="uesrpg-skill-roll">
      <div class="form-group">
        <label><b>Difficulty</b></label>
        <select name="difficultyKey" style="width:100%;">${difficultyOptions}</select>
      </div>
      ${showCharacteristicSelect ? `
        <div class="form-group" style="margin-top:8px;">
          <label><b>Characteristic</b></label>
          <select name="selectedCharacteristicKey" style="width:100%;">
            ${governingOptions.map((option) => `<option value="${option.key}" ${(option.key === (defaults.selectedCharacteristicKey ?? defaultCharacteristic)) ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
        </div>` : ""}
      <div class="form-group" style="margin-top:8px;">
        <label style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" name="useSpec" ${hasSpec ? "" : "disabled"} ${defaults.useSpec ? "checked" : ""} />
          <span><b>Use Specialization</b> (+10)</span>${specializationText}
        </label>
      </div>
      <div class="form-group" style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <label style="margin:0;"><b>Manual Modifier</b></label>
        <input name="manualMod" type="number" value="${Number(defaults.manualMod) || 0}" style="width:120px;" />
      </div>
      ${resistanceSection.html}
    </div>
  `;

  let declaration = null;
  try {
    declaration = await customDialog({
      title: `${skill.name} - Roll Options`,
      content,
      buttons: {
        ok: {
          label: "Roll",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const difficultyKey = root?.querySelector('select[name="difficultyKey"]')?.value ?? "average";
            const useSpec = Boolean(root?.querySelector('input[name="useSpec"]')?.checked);
            const selectedCharacteristicKey = String(
              root?.querySelector('select[name="selectedCharacteristicKey"]')?.value
              ?? defaults.selectedCharacteristicKey
              ?? defaultCharacteristic
            );
            const rawManual = root?.querySelector('input[name="manualMod"]')?.value ?? "0";
            const manualMod = Number.parseInt(String(rawManual), 10) || 0;
            const resistanceSelected = readResistanceBonusSelections(root, resistanceSection.options);
            return {
              ...normalizeSkillRollOptions({ difficultyKey, manualMod, useSpec, selectedCharacteristicKey }, defaults),
              resistanceSelected,
            };
          },
        },
        cancel: { label: "Cancel", callback: () => null },
      },
      default: "ok",
      width: 420,
    });
  } catch (_err) {
    declaration = null;
  }

  if (!declaration) return null;

  declaration = normalizeSkillRollOptions(declaration, defaults);
  declaration.resistanceSelected = Array.isArray(declaration.resistanceSelected) ? declaration.resistanceSelected : [];

  await setLast({
    difficultyKey: declaration.difficultyKey,
    manualMod: declaration.manualMod,
    useSpec: Boolean(declaration.useSpec),
    lastSkillUuidByActor: { [actor.uuid]: skill.uuid },
  });

  const resistanceMods = buildResistanceBonusMods(declaration.resistanceSelected ?? []);
  const tn = computeSkillTN({
    actor,
    skillItem: skill,
    difficultyKey: declaration.difficultyKey,
    manualMod: declaration.manualMod,
    selectedCharacteristicKey: String(declaration.selectedCharacteristicKey ?? defaultCharacteristic),
    useSpecialization: hasSpec && declaration.useSpec,
    situationalMods: resistanceMods,
  });

  return {
    declaration,
    tn,
    hasSpec,
  };
}

export async function handleBrewChatAction(messageId) {
  const message = game.messages.get(messageId);
  if (!message) return;

  const flags = message.flags?.[FLAG_NS]?.alchemy;
  if (!flags || flags.type !== "brewPending") return;
  if (flags.resolved || flags.resolving) {
    ui.notifications.info("This brew has already been resolved.");
    return;
  }

  await message.update({ [`flags.${FLAG_NS}.alchemy.resolving`]: true });

  const freshMsg = game.messages.get(messageId);
  const freshFlags = freshMsg?.flags?.[FLAG_NS]?.alchemy;
  if (freshFlags?.resolved) {
    await message.update({ [`flags.${FLAG_NS}.alchemy.resolving`]: false });
    ui.notifications.info("This brew has already been resolved.");
    return;
  }

  const actor = await fromUuid(flags.actorUuid);
  if (!actor) {
    await message.update({ [`flags.${FLAG_NS}.alchemy.resolving`]: false });
    ui.notifications.error("UESRPG | Alchemy: Actor not found.");
    return;
  }

  if (!actor.isOwner && !game.user.isGM) {
    await message.update({ [`flags.${FLAG_NS}.alchemy.resolving`]: false });
    ui.notifications.warn("You do not own this actor and cannot resolve this brew.");
    return;
  }

  const itemSnapshot = buildActorItemSnapshot(actor);
  const skill = getAlchemySkill(actor, { items: itemSnapshot.items });
  if (!skill) {
    await message.update({ [`flags.${FLAG_NS}.alchemy.resolving`]: false });
    ui.notifications.warn("This actor has no valid Alchemy skill entry.");
    return;
  }

  const rollDeclaration = await _promptAlchemyRollDeclaration(actor, skill);
  if (!rollDeclaration?.tn) {
    await message.update({ [`flags.${FLAG_NS}.alchemy.resolving`]: false });
    return;
  }

  const { recipe, nothingVentured, alchemyRank } = flags;
  const trialBonus = Number(flags.trialBonus ?? 0) || 0;
  const mods = computeBrewModifiers(actor, recipe, {
    nothingVentured,
    trialAndErrorBonus: trialBonus,
    skill,
  });
  const adjustedTN = Math.max(0, Number(rollDeclaration.tn?.finalTN ?? 0) + Number(mods.totalMod ?? 0));
  const rollResult = await doTestRoll(actor, {
    target: adjustedTN,
    allowLucky: true,
    allowUnlucky: true,
  });
  const roll = rollResult.roll;
  _emitAlchemyRoll3d(roll);
  const rollTotal = Number(rollResult.rollTotal ?? roll?.total ?? 0) || 0;
  const success = Boolean(rollResult.isSuccess);
  const criticalSuccess = Boolean(rollResult.isCriticalSuccess);
  const criticalFail = Boolean(rollResult.isCriticalFailure);
  const doubles = rollTotal % 11 === 0;
  const talents = getAlchemyTalents(actor, { items: itemSnapshot.items });

  let result;
  try {
    result = await resolveBrew(actor, recipe, {
      rollTotal,
      success,
      criticalSuccess,
      criticalFail,
      doubles,
      nothingVentured,
      alchemyRank,
      adjustedTN,
      talents,
    });
  } catch (err) {
    await message.update({ [`flags.${FLAG_NS}.alchemy.resolving`]: false });
    console.error("UESRPG | Brew resolution failed", err);
    ui.notifications.error("Brew resolution failed - see console.");
    return;
  }

  await message.update({
    [`flags.${FLAG_NS}.alchemy.resolved`]: true,
    [`flags.${FLAG_NS}.alchemy.resolving`]: false,
    [`flags.${FLAG_NS}.alchemy.adjustedTN`]: adjustedTN,
    [`flags.${FLAG_NS}.alchemy.rollTotal`]: rollTotal,
    [`flags.${FLAG_NS}.alchemy.success`]: success,
  });

  await _postBrewResultMessage(actor, recipe, roll, rollTotal, adjustedTN, success, criticalSuccess, criticalFail, result);
}

export async function resolveBrew(actor, recipe, rollCtx) {
  const {
    success,
    criticalFail = false,
    doubles = false,
    nothingVentured = false,
    alchemyRank = 0,
    talents: precomputedTalents,
  } = rollCtx;

  const itemSnapshot = buildActorItemSnapshot(actor);
  const talents = precomputedTalents ?? getAlchemyTalents(actor, { items: itemSnapshot.items });
  const skill = getAlchemySkill(actor, { items: itemSnapshot.items });
  const effects = _getFilledAlchemySlotsImpl(recipe);
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

  await _consumeIngredients(actor, recipe);

  let backfireResult = null;
  let createdItem = null;

  if (backfires) {
    backfireResult = await rollCreationBackfire(highestSL);
    _emitAlchemyRoll3d(backfireResult?.d4Roll ?? null);
    _emitAlchemyRoll3d(backfireResult?.minorEffect?.rollObject ?? null);
    if ((backfireResult.entry?.outcome ?? "lost") !== "lost") {
      createdItem = await _createAlchemyItem(actor, recipe, { backfired: true, backfireResult, skill, talents });
    }

    if (talents.hasTrialAndError) await _incrementTrialAndError(actor, recipe);
    return { success: false, item: createdItem, backfireResult };
  }

  if (success) {
    createdItem = await _createAlchemyItem(actor, recipe, { backfired: false, skill, talents });
    if (talents.hasTrialAndError) await _resetTrialAndError(actor, recipe);
    return { success: true, item: createdItem, backfireResult: null };
  }

  if (talents.hasTrialAndError) await _incrementTrialAndError(actor, recipe);
  return { success: false, item: null, backfireResult: null };
}

function _buildStoredAlchemyEffect(actor, recipeMode, slot, talents) {
  const ingredient = actor.items.get(slot.ingredientId);
  const effect = resolveAlchemyEffectDescriptor(actor, slot, { ingredient, talents, mode: recipeMode });
  if (!effect) return null;
  if (effect.compatible === false || !effect.directPayload) return null;

  return {
    effectSource: effect.effectSource,
    effectKey: effect.effectKey,
    effectLabel: effect.effectLabel,
    spellUuid: effect.spellUuid,
    spellName: effect.effectLabel,
    school: effect.school,
    spellLevel: Number(effect.spellLevel ?? 1),
    attributes: effect.attributes,
    cost: effect.cost,
    baseDuration: effect.baseDuration,
    finalDuration: effect.finalDuration,
    params: effect.params ?? {},
    toxinOverrides: effect.toxinOverrides ?? {},
    mode: recipeMode,
    directPayload: _cloneData(effect.directPayload),
  };
}

async function _createAlchemyItem(actor, recipe, { backfired = false, backfireResult = null, skill, talents } = {}) {
  const itemSnapshot = buildActorItemSnapshot(actor);
  const resolvedSkill = skill ?? getAlchemySkill(actor, { items: itemSnapshot.items });
  const resolvedTalents = talents ?? getAlchemyTalents(actor, { items: itemSnapshot.items });
  const { rank: alchemyRank } = getAlchemySkillSnapshot(actor, { skill: resolvedSkill, items: itemSnapshot.items });

  let itemName;
  let alchemyFlags;

  if (recipe.mode === "potion") {
    const effects = _getFilledAlchemySlotsImpl(recipe)
      .map((slot) => _buildStoredAlchemyEffect(actor, recipe.mode, slot, resolvedTalents))
      .filter(Boolean);
    const effectLabels = effects.map((effect) => effect.effectLabel).join(", ");
    itemName = backfired ? `Backfired Potion (${effectLabels})` : `Potion (${effectLabels})`;

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
    const effects = _getFilledAlchemySlotsImpl(recipe)
      .map((slot) => _buildStoredAlchemyEffect(actor, recipe.mode, slot, resolvedTalents))
      .filter(Boolean);
    const effectLabels = effects.map((effect) => effect.effectLabel).join(", ");
    itemName = backfired ? `Backfired Toxin (${effectLabels})` : `Toxin (${effectLabels})`;

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
    type: "equipment",
    img: ALCHEMY_DEFAULT_ICON,
    system: { quantity: 1, enc: 0, description: "", consumable: true, wearable: false, equipped: false },
    flags: { [FLAG_NS]: { alchemy: alchemyFlags } },
  };

  const created = await createOwnedItem(actor, itemData);
  return created.data ?? null;
}

async function _consumeIngredients(actor, recipe) {
  const ids = new Set();

  if (recipe.mode === "potion" || recipe.mode === "toxin") {
    for (const slot of recipe.slots ?? []) {
      if (slot?.ingredientId) ids.add(slot.ingredientId);
    }
  } else if (recipe.mode === "poison" && recipe.ingredientId) {
    ids.add(recipe.ingredientId);
  }

  for (const id of ids) {
    const item = actor.items.get(id);
    if (!item) continue;
    await consumeOwnedItem(item);
  }
}

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
    ? `<div class="uesrpg-alchemy-note is-danger"><div class="label">Backfire</div><div class="text">${formatCreationBackfire(result.backfireResult)}</div></div>`
    : "";

  const itemHtml = result.item
    ? `<div class="uesrpg-alchemy-note"><div class="label">Created</div><div class="text">${result.item.name}</div></div>`
    : !success
    ? `<div class="uesrpg-alchemy-note is-warning"><div class="label">Result</div><div class="text">Nothing created - materials consumed.</div></div>`
    : "";

  let drinkButtonHtml = "";
  const algFlags = result.item?.flags?.[FLAG_NS]?.alchemy;
  if (algFlags?.kind === "potion") {
    drinkButtonHtml = `<button type="button"
      data-action="alchemyDrink"
      data-item-uuid="${result.item.uuid}"
      data-actor-uuid="${actor.uuid}">
      Drink Potion${algFlags.backfired ? " (Backfired!)" : ""}
    </button>`;
  } else if (algFlags?.kind === "poison" || algFlags?.kind === "toxin") {
    drinkButtonHtml = `<button type="button"
      data-action="alchemyApplyToTarget"
      data-item-uuid="${result.item.uuid}"
      data-actor-uuid="${actor.uuid}">
      Apply Poison/Toxin
    </button>`;
  }

  const content = await renderBrewResultCard({
    actorImg: actor.img ?? "icons/svg/mystery-man.svg",
    actorName: actor.name,
    outcomeLabel,
    outcomeColor,
    rollTotal,
    adjustedTN,
    roll,
    itemHtml,
    backfireHtml,
    drinkButtonHtml,
  });

  await createAlchemyChatMessage({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}
