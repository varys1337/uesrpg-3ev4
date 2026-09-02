/**
 * Roll handlers shared across sheets.
 * 
 * Extracted from actor-sheet.js for better maintainability.
 * Handles skill rolls, combat rolls, resistance rolls, and spell rolls.
 * 
 * Shared across actor sheet modules.
 */

import { SYSTEM_ROLL_FORMULA } from "../../../../core/constants.js";
import { getCachedSetting } from "../../../../core/config/settings-cache.js";
import { isLucky, isUnlucky } from "../../../../utils/skillCalcHelper.js";
import { SkillOpposedWorkflow } from "../../../../core/skills/opposed-workflow/index.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "../../../../core/skills/skill-tn.js";
import { doTestRoll, formatDegree, formatResultOutcomeLabel, formatResultSummary, computeResultFromRollTotal } from "../../../../utils/degree-roll-helper.js";
import { requireUserCanRollActor } from "../../../../utils/permissions.js";
import { getPhysicalExertionSkillBonus, consumePhysicalExertionForSkill } from "../../../../core/stamina/stamina-integration-hooks.js";
import { isItemEffectActive } from "../../../../core/active-effects/transfer.js";
import { getUserSpellTargets, shouldUseTargetedSpellWorkflow, shouldUseModernSpellWorkflow, debugMagicRoutingLog } from "../../../../core/magic/spell-runtime.js";
import { UESRPG } from "../../../../core/constants.js";
import { buildResistanceBonusSection, readResistanceBonusSelections, buildResistanceBonusMods } from "../../../../core/traits/trait-resistance-ui.js";
import { buildSkillRollRequest, normalizeSkillRollOptions, skillRollDebug } from "../../../../core/skills/roll-request.js";
import { applyKeenIntuitionToResult, applyHyperAwarenessToResult } from "../../../../core/traits/awareness-talents.js";
import { hasTalent } from "../../../../core/traits/talents-api.js";
import { applyIntellectualTalentDoSOverrides } from "../../../../core/traits/intellectual-talents.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";
import { safeUpdateChatMessage } from "../../../../utils/chat-message-socket.js";
import { getCoreRollMode } from "../../../../utils/chat-roll-mode.js";
import { isAddMode } from "../../../../core/active-effects/reducers.js";
import { getEffectChanges } from "../../../../utils/compat.js";
import { MagicOpposedWorkflow } from "../../../../core/magic/opposed-workflow.js";
import { consumeInspireHeroismEffect } from "../../../../core/combat/opposed/effects.js";
import {
  getAllCharacteristicOptions,
  getCharacteristicLabel,
  getPreferredSkillCharacteristic,
  normalizeCharacteristicKey
} from "../../../../utils/maps/characteristics.js";

/**
 * Handle skill roll from sheet.
 * @param {object} sheet - The actor sheet instance
 * @param {Event} event - The click event
 */
export const onSkillRoll = asyncGuardSheet(async function onSkillRoll(event, target) {
  event.preventDefault();

  if (!requireUserCanRollActor(game.user, this.actor)) {
    return;
  }

  const button = target ?? event.currentTarget;
  
  // Safely get the .item parent if button has .closest method (DOM element)
  // Token Action HUD may call with synthetic events that don't have proper DOM elements
  let skillItem = null;
  if (button && typeof button.closest === "function") {
    const li = button.closest(".item");
    skillItem = this.actor.items.get(li?.dataset.itemId);
  }
  
  // Fallback: Try to get skill from event data-item-id or dataset
  if (!skillItem && button?.dataset?.itemId) {
    skillItem = this.actor.items.get(button.dataset.itemId);
  }
  
  // Fallback: For synthetic events from modules, check for itemId in various places
  if (!skillItem) {
    const itemId = event?.data?.itemId ?? event?.itemId ?? null;
    if (itemId) {
      skillItem = this.actor.items.get(itemId);
    }
  }

  if (!skillItem) {
    ui.notifications.warn("Skill item not found.");
    return;
  }

  const quickShift = Boolean(event.shiftKey) && getCachedSetting("skillRollQuickShift");

  const getLast = () => {
    try {
      const saved = foundry.utils.deepClone(getCachedSetting("skillRollLastOptions") ?? {});
      delete saved.selectedCharacteristicKey;
      return saved;
    } catch (_e) { return {}; }
  };
  const setLast = async (patch={}) => {
    const prev = getLast();
    const next = { ...prev, ...patch };
    next.lastSkillUuidByActor = { ...(prev.lastSkillUuidByActor||{}), ...(patch.lastSkillUuidByActor||{}) };
    delete next.selectedCharacteristicKey;
    try { await game.settings.set("uesrpg-3ev4", "skillRollLastOptions", next); } catch (_e) {}
  };

  // --- Targeted -> opposed workflow ---
  const targets = [...(game.user.targets ?? [])];
  if (targets.length > 0) {
    const attackerToken =
      canvas?.tokens?.controlled?.find(t => t.actor?.id === this.actor.id) ??
      this.actor.getActiveTokens?.()?.[0] ??
      null;

    if (!attackerToken) {
      ui.notifications.warn("No attacker token found on the canvas. Select your token and try again.");
      return;
    }

    const created = [];
    for (const defenderToken of targets) {
      const msg = await SkillOpposedWorkflow.createPending({
        attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
        defenderTokenUuid: defenderToken.document?.uuid ?? defenderToken.uuid,
        attackerActorUuid: this.actor.uuid,
        defenderActorUuid: defenderToken.actor?.uuid ?? null,
        attackerSkillUuid: skillItem.uuid,
        attackerSkillLabel: skillItem.name
      });
      if (msg) created.push(msg);

      if (msg && quickShift) {
        await SkillOpposedWorkflow.handleAction(msg, "attacker-roll", { event });
      }
    }

    return;
  }

  // --- Untargeted -> single skill test ---
  const isEvade = String(skillItem?.name ?? "").trim().toLowerCase() === "evade";
  const hasSpec = !isEvade && String(skillItem?.system?.trainedItems ?? "").trim().length > 0;
  const characteristicOptions = getAllCharacteristicOptions(this.actor);
  const defaultCharacteristic = getPreferredSkillCharacteristic(this.actor, skillItem)
    || normalizeCharacteristicKey(skillItem?.system?.baseCha ?? "")
    || (characteristicOptions[0]?.key ?? "");
  const resistanceSection = buildResistanceBonusSection(this.actor);
  const last = getLast();

  const defaults = normalizeSkillRollOptions(last, {
    difficultyKey: "average",
    manualMod: 0,
    useSpec: false,
    selectedCharacteristicKey: defaultCharacteristic
  });

  let decl = null;

  if (quickShift) {
    decl = {
      difficultyKey: defaults.difficultyKey,
      manualMod: defaults.manualMod,
      useSpec: defaults.useSpec,
      selectedCharacteristicKey: defaults.selectedCharacteristicKey ?? defaultCharacteristic,
      resistanceSelected: [],
      isInterrogationTest: false,
      isQuestioningTest: false
    };
  } else {
    const difficultyOptions = SKILL_DIFFICULTIES.map(d => {
      const sign = d.mod >= 0 ? "+" : "";
      const sel = d.key === defaults.difficultyKey ? "selected" : "";
      return `<option value="${d.key}" ${sel}>${d.label} (${sign}${d.mod})</option>`;
    }).join("\n");

    const isPersuade = String(skillItem?.name ?? "").trim().toLowerCase() === "persuade";
    const showInterrogation = isPersuade && hasTalent(this.actor, "interrogator");
    const interrogationRow = showInterrogation ? `
        <div class="form-group" style="margin-top:8px;">
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" name="isInterrogationTest" />
            <span><b>Interrogation</b> (Interrogator talent)</span>
          </label>
        </div>` : "";

    const showQuestioning = isPersuade && hasTalent(this.actor, "questioning");
    const questioningRow = showQuestioning ? `
        <div class="form-group" style="margin-top:8px;">
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" name="isQuestioningTest" />
            <span><b>Questioning</b> (Questioning talent)</span>
          </label>
        </div>` : "";

    const skillKey = String(skillItem?.name ?? "").trim().toLowerCase();
    const showHistskinUnderwater = hasTalent(this.actor, "histskin") && (skillKey === "athletics" || skillKey === "stealth");
    const histskinRow = showHistskinUnderwater ? `
        <div class="form-group" style="margin-top:8px;">
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" name="histskinUnderwater" />
            <span><b>Histskin</b> (Underwater) +30</span>
          </label>
        </div>` : "";

    const content = `
      <div class="uesrpg-skill-roll">
        <div class="form-group">
          <label><b>Difficulty</b></label>
          <select name="difficultyKey" style="width:100%;">${difficultyOptions}</select>
        </div>
        <div class="form-group" style="margin-top:8px;">
          <label><b>Characteristic</b></label>
          <select name="selectedCharacteristicKey" style="width:100%;">
            ${characteristicOptions.map(o => `<option value="${o.key}" ${(o.key === (defaults.selectedCharacteristicKey ?? defaultCharacteristic)) ? "selected" : ""}>${o.label}</option>`).join("")}
          </select>
        </div>
        <div class="form-group" style="margin-top:8px;">
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" name="useSpec" ${hasSpec ? "" : "disabled"} ${defaults.useSpec ? "checked" : ""} />
            <span><b>Use Specialization</b> (+10)${hasSpec ? "" : ' <span style="opacity:0.75;">(none on this skill)</span>'}</span>
          </label>
        </div>
        ${interrogationRow}
        ${questioningRow}
        ${histskinRow}
        <div class="form-group" style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <label style="margin:0;"><b>Manual Modifier</b></label>
          <input name="manualMod" type="number" value="${Number(defaults.manualMod) || 0}" style="width:120px;" />
        </div>
        ${resistanceSection.html}
      </div>`;

    try {
      decl = await customDialog({
        layout: "workflow",
        title: `${skillItem.name} - Roll Options`,
        content,
        buttons: {
          ok: {
            label: "Roll",
            callback: (html) => {
              const root = html instanceof HTMLElement ? html : html?.[0];
              const difficultyKey = root?.querySelector('select[name="difficultyKey"]')?.value ?? "average";
              const useSpec = Boolean(root?.querySelector('input[name="useSpec"]')?.checked);
              const isInterrogationTest = Boolean(root?.querySelector('input[name="isInterrogationTest"]')?.checked);
              const isQuestioningTest = Boolean(root?.querySelector('input[name="isQuestioningTest"]')?.checked);
              const histskinUnderwater = Boolean(root?.querySelector('input[name="histskinUnderwater"]')?.checked);
              const selectedCharacteristicKey = String(
                root?.querySelector('select[name="selectedCharacteristicKey"]')?.value
                  ?? defaults.selectedCharacteristicKey
                  ?? defaultCharacteristic
              );
              const rawManual = root?.querySelector('input[name="manualMod"]')?.value ?? "0";
              const manualMod = Number.parseInt(String(rawManual), 10) || 0;
              const selectedRes = readResistanceBonusSelections(root, resistanceSection.options);
              const normalized = normalizeSkillRollOptions({ difficultyKey, useSpec, manualMod, selectedCharacteristicKey }, defaults);
              return { ...normalized, resistanceSelected: selectedRes, isInterrogationTest, isQuestioningTest, histskinUnderwater };
            }
          },
          cancel: { label: "Cancel", callback: () => null }
        },
        default: "ok",
        width: 420
      });
    } catch (_e) {
      decl = null;
    }
  }

  if (!decl) return;

  const selectedRes = Array.isArray(decl?.resistanceSelected) ? decl.resistanceSelected : [];
  const isInterrogationTest = Boolean(decl?.isInterrogationTest);
  const isQuestioningTest = Boolean(decl?.isQuestioningTest);
  const histskinUnderwater = Boolean(decl?.histskinUnderwater);
  decl = normalizeSkillRollOptions(decl, defaults);
  decl.resistanceSelected = selectedRes;
  decl.isInterrogationTest = isInterrogationTest;
  decl.isQuestioningTest = isQuestioningTest;
  decl.histskinUnderwater = histskinUnderwater;

  await setLast({
    difficultyKey: decl.difficultyKey,
    manualMod: decl.manualMod,
    useSpec: Boolean(decl.useSpec),
    lastSkillUuidByActor: { [this.actor.uuid]: skillItem.uuid }
  });

  const staminaBonus = getPhysicalExertionSkillBonus(this.actor, skillItem, {
    selectedCharacteristicKey: decl.selectedCharacteristicKey ?? defaultCharacteristic
  });
  const resMods = buildResistanceBonusMods(decl.resistanceSelected ?? []);
  const resBonus = resMods.reduce((sum, m) => sum + Number(m.value ?? 0), 0);
  const situationalMods = [...resMods];
  if (decl.histskinUnderwater) {
    situationalMods.push({ key: "talent:histskin", label: "Histskin (Underwater)", value: +30, source: "talent" });
  }

  const request = buildSkillRollRequest({
    actor: this.actor,
    skillItem,
    targetToken: null,
    options: {
      difficultyKey: decl.difficultyKey,
      manualMod: decl.manualMod,
      useSpec: Boolean(decl.useSpec),
      selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic)
    },
    context: { source: "sheet", quick: quickShift }
  });
  skillRollDebug("untargeted request", request);

  const tn = computeSkillTN({
    actor: this.actor,
    skillItem,
    difficultyKey: decl.difficultyKey,
    manualMod: decl.manualMod,
    selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
    useSpecialization: hasSpec && decl.useSpec,
    situationalMods
  });

  skillRollDebug("untargeted TN", { finalTN: tn.finalTN, breakdown: tn.breakdown });

  const tags = [];
  if (Number(this.actor.system?.woundPenalty ?? 0) !== 0) tags.push(`<span class="tag wound-tag">Wounded ${this.actor.system.woundPenalty}</span>`);
  if (this.actor.system.fatigue.penalty != 0) tags.push(`<span class="tag fatigue-tag">Fatigued ${this.actor.system.fatigue.penalty}</span>`);
  const encApplied = (tn.breakdown ?? []).some(b => b.source === "encumbrance");
  if (encApplied) tags.push(`<span class="tag enc-tag">Encumbered ${this.actor.system.carry_rating.penalty}</span>`);

  const armorMods = (tn.breakdown ?? []).filter(b => String(b.label || "").startsWith("Armor:") && Number(b.value) !== 0);
  for (const m of armorMods) {
    const v = Number(m.value) || 0;
    tags.push(`<span class="tag armor-tag">${m.label} ${v}</span>`);
  }

  if (tn?.difficulty?.mod) tags.push(`<span class="tag modifier-tag">${tn.difficulty.label} ${tn.difficulty.mod >= 0 ? "+" : ""}${tn.difficulty.mod}</span>`);
  if (decl.selectedCharacteristicKey) {
    tags.push(`<span class="tag modifier-tag">${getCharacteristicLabel(decl.selectedCharacteristicKey) || String(decl.selectedCharacteristicKey).toUpperCase()}</span>`);
  }
  if (hasSpec && decl.useSpec) tags.push(`<span class="tag modifier-tag">Specialization +10</span>`);
  if (decl.isInterrogationTest) tags.push(`<span class="tag modifier-tag">Interrogation</span>`);
  if (decl.histskinUnderwater) tags.push(`<span class="tag modifier-tag">Histskin +30</span>`);
  if (decl.manualMod) tags.push(`<span class="tag modifier-tag">Mod ${decl.manualMod >= 0 ? "+" : ""}${decl.manualMod}</span>`);
  if (resBonus) {
    const labels = resMods.map(m => m.label).join(", ");
    tags.push(`<span class="tag modifier-tag">Resistance Bonus ${resBonus >= 0 ? "+" : ""}${resBonus}${labels ? ` (${labels})` : ""}</span>`);
  }
  if (staminaBonus > 0) tags.push(`<span class="tag modifier-tag">Physical Exertion +${staminaBonus}</span>`);

  const res = await doTestRoll(this.actor, { rollFormula: SYSTEM_ROLL_FORMULA, target: tn.finalTN, allowLucky: true, allowUnlucky: true });

  await applyKeenIntuitionToResult(this.actor, skillItem?.name ?? "", res, { allowPrompt: true });
  await applyHyperAwarenessToResult(this.actor, skillItem?.name ?? "", res, { allowPrompt: true });
  if (staminaBonus > 0) {
    await consumePhysicalExertionForSkill(this.actor, skillItem, {
      selectedCharacteristicKey: decl.selectedCharacteristicKey ?? defaultCharacteristic
    });
  }

  // Intellectual talents (Chapter 4): Businessman / Interrogator / Questioning (DoS replacement prompts).
  await applyIntellectualTalentDoSOverrides({
    actor: this.actor,
    skillName: skillItem?.name ?? "",
    result: res,
    isInterrogationTest: Boolean(decl?.isInterrogationTest),
    isQuestioningTest: Boolean(decl?.isQuestioningTest),
    allowPrompt: true
  });

  skillRollDebug("untargeted result", { rollTotal: res.rollTotal, target: res.target, isSuccess: res.isSuccess, degree: res.degree, critS: res.isCriticalSuccess, critF: res.isCriticalFailure });

  const degreeLine = res.isSuccess
    ? `<b style="color:green;">${formatResultSummary(res, { uppercase: true, includeDegree: true, degreeStyle: "dash" })}</b>`
    : `<b style="color:rgb(168, 5, 5);">${formatResultSummary(res, { uppercase: true, includeDegree: true, degreeStyle: "dash" })}</b>`;

  const breakdownRows = (tn.breakdown ?? []).map(b => {
    const v = Number(b.value ?? 0);
    const sign = v >= 0 ? "+" : "";
    return `<div style="display:flex; justify-content:space-between; gap:10px;"><span>${b.label}</span><span>${sign}${v}</span></div>`;
  }).join("");

  const declaredParts = [];
  if (tn?.difficulty?.label) declaredParts.push(`${tn.difficulty.label} (${tn.difficulty.mod >= 0 ? "+" : ""}${tn.difficulty.mod})`);
  if (decl.selectedCharacteristicKey) {
    declaredParts.push(`Cha ${getCharacteristicLabel(decl.selectedCharacteristicKey) || String(decl.selectedCharacteristicKey).toUpperCase()}`);
  }
  if (hasSpec && decl.useSpec) declaredParts.push("Spec +10");
  if (decl.isInterrogationTest) declaredParts.push("Interrogation");
  if (decl.isQuestioningTest) declaredParts.push("Questioning");
  if (decl.histskinUnderwater) declaredParts.push("Histskin +30");
  if (decl.manualMod) declaredParts.push(`Mod ${decl.manualMod >= 0 ? "+" : ""}${decl.manualMod}`);

  const flavor = `
    <div>
      <h2 style="margin:0 0 6px 0;"><img src="${skillItem.img}" style="height:24px; vertical-align:middle; margin-right:6px;"/>${skillItem.name}</h2>
      <div><b>Target Number:</b> ${tn.finalTN}</div>
      ${declaredParts.length ? `<div style="margin-top:2px; font-size:12px; opacity:0.85;"><b>Options:</b> ${declaredParts.join("; ")}</div>` : ""}
      <div style="margin-top:4px;">${degreeLine}</div>
      <details style="margin-top:6px;"><summary style="cursor:pointer; user-select:none;">TN breakdown</summary><div style="margin-top:4px; font-size:12px; opacity:0.9;">${breakdownRows}</div></details>
      <div class="tag-container">${tags.join("")}</div>
    </div>`;

  const rollMode = getCoreRollMode();
  const dosOverride = res?.uesrpgDosOverride ?? null;
  const skillTest = {
    actorUuid: this.actor.uuid,
    skillUuid: skillItem.uuid,
    skillName: skillItem.name,
    target: tn.finalTN,
    rollFormula: SYSTEM_ROLL_FORMULA,
    rollMode,
    useSpecialization: Boolean(hasSpec && decl.useSpec),
    isInterrogationTest: Boolean(decl?.isInterrogationTest),
    isQuestioningTest: Boolean(decl?.isQuestioningTest),
    rollOptions: {
      ...(decl.selectedCharacteristicKey ? { selectedCharacteristicKey: String(decl.selectedCharacteristicKey).toLowerCase() } : {}),
      ...(decl.histskinUnderwater ? { histskin: true } : {})
    },
    isSuccess: Boolean(res.isSuccess),
    degree: Number(res.degree ?? 0) || 0,
    textual: String(res.textual ?? "")
  };

  const staminaUsedOnTest = staminaBonus > 0;

  await res.roll.toMessage({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: this.actor }),
    flavor,
    flags: {
      uesrpg: {
        rollRequest: request,
        skillTest,
        ...((decl.selectedCharacteristicKey || decl.histskinUnderwater) ? {
          rollOptions: {
            ...(decl.selectedCharacteristicKey ? { selectedCharacteristicKey: String(decl.selectedCharacteristicKey).toLowerCase() } : {}),
            ...(decl.histskinUnderwater ? { histskin: true } : {})
          }
        } : {}),
        ...(dosOverride ? { dosOverride } : {}),
        reroll: { used: false, source: null },
        ...(staminaUsedOnTest ? { staminaUsedOnTest: true } : {})
      },
      "uesrpg-3ev4": {
        rollRequest: request,
        skillTest,
        ...((decl.selectedCharacteristicKey || decl.histskinUnderwater) ? {
          rollOptions: {
            ...(decl.selectedCharacteristicKey ? { selectedCharacteristicKey: String(decl.selectedCharacteristicKey).toLowerCase() } : {}),
            ...(decl.histskinUnderwater ? { histskin: true } : {})
          }
        } : {}),
        ...(dosOverride ? { dosOverride } : {}),
        ...(staminaUsedOnTest ? { staminaUsedOnTest: true } : {})
      }
    },
    rollMode
  });
});

/**
 * Handle spell roll (legacy routing for favorites/hotkeys).
 * Routes to magic casting engine.
 * @param {object} sheet
 * @param {Event} event
 */
export const onSpellRoll = asyncGuardSheet(async function onSpellRoll(event, target) {
  const button = target ?? event.currentTarget;
  let spellToCast;

  if (
    button.closest(".item") != null ||
    button.closest(".item") != undefined
  ) {
    spellToCast = this.actor.items.get(
      button.closest(".item").dataset.itemId
    );
  } else {
    spellToCast = this.actor.getEmbeddedDocument(
      "Item",
      this.actor.system.favorites[button.dataset.hotkey].id
    );
  }

  const targets = getUserSpellTargets();
  debugMagicRoutingLog({ source: "onSpellRoll", actor: this.actor, spell: spellToCast, targets });
  if (shouldUseTargetedSpellWorkflow(spellToCast, targets)) {
    const spellOptions = await this._showSpellOptionsDialog(spellToCast);
    if (spellOptions === null) return;
    await this._castAttackSpell(spellToCast, targets, spellOptions, "primary");
    return;
  }
  if (shouldUseModernSpellWorkflow(spellToCast)) {
    const spellOptions = await this._showSpellOptionsDialog(spellToCast);
    if (spellOptions === null) return;
    await MagicOpposedWorkflow.castUnopposed({
      attackerActorUuid: this.actor.uuid,
      attackerTokenUuid: this.token?.document?.uuid ?? this.token?.uuid ?? null,
      spellUuid: spellToCast.uuid,
      spellOptions,
      castActionType: "primary"
    });
    return;
  }
});

/**
 * Handle combat style roll.
 * @param {object} sheet
 * @param {Event} event
 */
export const onCombatRoll = asyncGuardSheet(async function onCombatRoll(event, target) {
  event.preventDefault();

  const button = target ?? event.currentTarget;
  const li = button.closest(".item");
  const item = this.actor.items.get(li?.dataset.itemId);

  if (!item) {
    ui.notifications.warn("Combat item not found.");
    return;
  }

  let tags = [];
  const hasWoundPenalty = Number(this.actor.system?.woundPenalty ?? 0) !== 0;
  if (hasWoundPenalty) {
    tags.push(
      `<span class="tag wound-tag">Wounded ${this.actor.system.woundPenalty}</span>`
    );
  }
  if (this.actor.system.fatigue.penalty != 0) {
    tags.push(
      `<span class="tag fatigue-tag">Fatigued ${this.actor.system.fatigue.penalty}</span>`
    );
  }
  if (this.actor.system.carry_rating.penalty != 0) {
    tags.push(
      `<span class="tag enc-tag">Encumbered ${this.actor.system.carry_rating.penalty}</span>`
    );
  }

  const targets = [...(game.user.targets ?? [])];
  if (targets.length > 1) {
    ui.notifications.warn("Multiple targets selected. Using the first targeted token for this opposed roll.");
  }
  const defenderToken = targets[0] ?? null;
  if (defenderToken) {
    const attackerToken =
      canvas?.tokens?.controlled?.find(t => t.actor?.id === this.actor.id) ??
      this.actor.getActiveTokens?.()?.[0] ??
      null;

    if (!attackerToken) {
      ui.notifications.warn("No attacker token found on the canvas. Select your token and try again.");
      return;
    }

    const message = await SkillOpposedWorkflow.createPending({
      attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
      defenderTokenUuid: defenderToken.document?.uuid ?? defenderToken.uuid,
      attackerSkillUuid: item.uuid,
      attackerSkillLabel: item.name
    });

    const state = message?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state;
    if (state) {
      state.allowCombatStyle = true;
      await safeUpdateChatMessage(message, {
        flags: {
          "uesrpg-3ev4": {
            skillOpposed: {
              version: state.version ?? 1,
              state
            }
          }
        }
      });
    }

    return;
  }

  // No target -> manual roll dialog
  await customDialog({
    layout: "workflow",
    title: `${item.name} - Roll Options`,
    content: `<div>
                <div class="form-group" style="margin-bottom:8px;">
                  <label style="display:block;"><b>Difficulty</b></label>
                  <select id="difficultyKey" style="width:100%;">
                    ${SKILL_DIFFICULTIES.map(df => {
                      const sign = df.mod >= 0 ? "+" : "";
                      const sel = df.key === "average" ? "selected" : "";
                      return `<option value="${df.key}" ${sel}>${df.label} (${sign}${df.mod})</option>`;
                    }).join("\n")}
                  </select>
                </div>
                <div class="form-group" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                  <label style="margin:0;"><b>Manual Modifier</b></label>
                  <input id="playerInput" type="number" value="0" style="width:120px; text-align:center;" />
                </div>
              </div>`,
    yes: {
      label: "Roll",
      callback: async (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const playerInputRaw = root?.querySelector('#playerInput')?.value;
          const playerInput = Number.parseInt(String(playerInputRaw ?? "0"), 10) || 0;

          const difficultyKey = String(root?.querySelector('#difficultyKey')?.value ?? "average");
          const diff = (SKILL_DIFFICULTIES ?? []).find(dv => dv.key === difficultyKey) ?? { key: "average", label: "Average", mod: 0 };
          const difficultyMod = Number(diff.mod ?? 0) || 0;

          const base = Number(item.system?.value ?? 0);
          const fatigue = Number(this.actor.system?.fatigue?.penalty ?? 0);
          const enc = Number(this.actor.system?.carry_rating?.penalty ?? 0);
          const wound = Number(this.actor.system?.woundPenalty ?? 0);

          const breakdown = [];
          breakdown.push({ label: "Base TN", value: base });
          breakdown.push({ label: `Difficulty: ${diff.label}`, value: difficultyMod });
          if (fatigue) breakdown.push({ label: "Fatigue", value: fatigue });
          if (enc) breakdown.push({ label: "Encumbrance", value: enc });
          if (wound) breakdown.push({ label: "Wounded", value: wound });
          if (playerInput) breakdown.push({ label: "Manual Modifier", value: playerInput });

          const aeBreakdown = [];
          let aeTotal = 0;

          for (const ef of (this.actor?.effects ?? [])) {
            if (ef?.disabled) continue;
            const changes = getEffectChanges(ef);
            let v = 0;
            for (const ch of changes) {
              if (!ch) continue;
              if (ch.key !== "system.modifiers.combat.attackTN") continue;
              if (!isAddMode(ch)) continue;
              v += Number(ch.value) || 0;
            }
            if (v) {
              aeBreakdown.push({ label: ef?.name ?? "Effect", value: v });
              aeTotal += v;
            }
          }

          for (const it of (this.actor?.items ?? [])) {
            for (const ef of (it?.effects ?? [])) {
              if (!ef?.transfer) continue;
              if (!isItemEffectActive(this.actor, it, ef)) continue;
              if (ef?.disabled) continue;

              const changes = getEffectChanges(ef);
              let v = 0;
              for (const ch of changes) {
                if (!ch) continue;
                if (ch.key !== "system.modifiers.combat.attackTN") continue;
                if (!isAddMode(ch)) continue;
                v += Number(ch.value) || 0;
              }
              if (v) {
                const label = ef?.name ? `${it.name}: ${ef.name}` : (it.name ?? "Item");
                aeBreakdown.push({ label, value: v });
                aeTotal += v;
              }
            }
          }

          for (const e of aeBreakdown) breakdown.push(e);

          const tn = base + difficultyMod + fatigue + enc + wound + playerInput + aeTotal;

          const res = await doTestRoll(this.actor, {
            rollFormula: SYSTEM_ROLL_FORMULA,
            target: tn,
            allowLucky: true,
            allowUnlucky: true
          });

          const degreeLine = res.isSuccess
            ? `<b style="color:green;">${formatResultSummary(res, { uppercase: true, includeDegree: true, degreeStyle: "dash" })}</b>`
            : `<b style="color:rgb(168, 5, 5);">${formatResultSummary(res, { uppercase: true, includeDegree: true, degreeStyle: "dash" })}</b>`;

          const breakdownRows = breakdown.map(b => {
            const v = Number(b.value ?? 0);
            const sign = v >= 0 ? "+" : "";
            return `<div style="display:flex; justify-content:space-between; gap:10px;"><span>${b.label}</span><span>${sign}${v}</span></div>`;
          }).join("");

          const declaredParts = [];
          {
            const sign = difficultyMod >= 0 ? "+" : "";
            declaredParts.push(`${diff.label} (${sign}${difficultyMod})`);
          }
          if (playerInput) declaredParts.push(`Mod ${playerInput >= 0 ? "+" : ""}${playerInput}`);

          const flavor = `
            <div>
              <h2 style="margin:0 0 6px 0;">
                ${item.img ? `<img src="${item.img}" style="height:24px; vertical-align:middle; margin-right:6px;"/>` : ""}
                ${item.name}
              </h2>
              <div><b>Target Number:</b> ${tn}</div>
              <div style="margin-top:2px; font-size:12px; opacity:0.85;"><b>Options:</b> ${declaredParts.join("; ")}</div>
              <div style="margin-top:4px;">${degreeLine}</div>
              <details style="margin-top:6px;"><summary style="cursor:pointer; user-select:none;">TN breakdown</summary><div style="margin-top:4px; font-size:12px; opacity:0.9;">${breakdownRows}</div></details>
              <div class="tag-container">${tags.join("")}</div>
            </div>`;

          await res.roll.toMessage({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            flavor,
            rollMode: getCoreRollMode()
          });

          await consumeInspireHeroismEffect(this.actor);
        }
    },
    no: { label: "Cancel" },
    defaultButton: "yes",
    width: 420,
  });
});

/**
 * Handle resistance roll.
 * @param {object} sheet
 * @param {Event} event
 */
export const onResistanceRoll = asyncGuardSheet(async function onResistanceRoll(event, target) {
  event.preventDefault();
  const element = target ?? event.currentTarget;
  let tags = [];
  await customDialog({
    layout: "workflow",
    title: "Apply Roll Modifier",
    content: `<div>
                <div class="dialogForm">
                <label><b>${element.name} Resistance Modifier: </b></label><input placeholder="ex. -20, +10" id="playerInput" value="0" style=" text-align: center; width: 50%; border-style: groove; float: right;" type="text"></input></div>
              </div>`,
    yes: {
      label: "Roll!",
      callback: async (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const playerInput = parseInt(root?.querySelector('#playerInput')?.value);

          let roll = new Roll("1d100");
          await roll.evaluate();
          const tn = this.actor.system.resistance[element.id] + playerInput;
          const res = computeResultFromRollTotal(this.actor, { rollTotal: Number(roll.total), target: tn, allowLucky: true, allowUnlucky: true });
          const degreesLine = `<br><b>${res.isSuccess ? "Degrees of Success" : "Degrees of Failure"}: ${res.degree}</b>`;
          const resultLabel = formatResultOutcomeLabel(res, { uppercase: true });
          const resultColor = res.isSuccess ? "green" : "rgb(168, 5, 5)";
          let contentString = "";
          if (isLucky(this.actor, roll.result)) {
            contentString = `<h2>${element.getAttribute("name")}</h2>
          <p></p><b>Target Number: [[${this.actor.system.resistance[element.id]} + ${playerInput}]]</b> <p></p>
          <b>Result: [[${roll.total}]]</b><p></p>
          <span style='color:${resultColor}; font-size:120%;'> <b>${resultLabel}!</b></span>
          ${degreesLine}`;
          } else if (isUnlucky(this.actor, roll.result)) {
            contentString = `<h2>${element.getAttribute("name")}</h2>
          <p></p><b>Target Number: [[${this.actor.system.resistance[element.id]} + ${playerInput}]]</b> <p></p>
          <b>Result: [[${roll.total}]]</b><p></p>
          <span style='color:${resultColor}; font-size:120%;'> <b>${resultLabel}!</b></span>
          ${degreesLine}`;
          } else {
            contentString = `<h2>${element.getAttribute("name")}</h2>
          <p></p><b>Target Number: [[${this.actor.system.resistance[element.id]} + ${playerInput}]]</b> <p></p>
          <b>Result: [[${roll.total}]]</b><p></p>
          <span style='color:${resultColor}; font-size:120%;'> <b>${resultLabel}!</b></span>
          ${degreesLine}`;
          }
          
          await roll.toMessage({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker(),
            content: contentString,
            flavor: `<div class="tag-container">${tags.join("")}</div>`,
            rollMode: getCoreRollMode(),
          });
      },
    },
    no: { label: "Cancel" },
    defaultButton: "yes",
  });
});
