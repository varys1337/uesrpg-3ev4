/**
 * Characteristic management handlers.
 * Handles characteristic setting, rolling, and lucky/unlucky number configuration.
 *
 * Shared across actor sheet modules.
 */

import { SYSTEM_ROLL_FORMULA } from "../../../../core/constants.js";
import { SkillOpposedWorkflow } from "../../../../core/skills/opposed-workflow.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "../../../../core/skills/skill-tn.js";
import { doTestRoll, formatDegree } from "../../../../utils/degree-roll-helper.js";
import { requireUserCanRollActor } from "../../../../utils/permissions.js";
import { buildResistanceBonusSection, readResistanceBonusSelections, buildResistanceBonusMods } from "../../../../core/traits/trait-resistance-ui.js";
import { _buildCharacteristicPseudoItem } from "../../../../core/skills/opposed/skills.js";
import { applyKeenIntuitionToResult, applyHyperAwarenessToResult } from "../../../../core/traits/awareness-talents.js";
import { applyIronWillReroll } from "../../../../core/traits/resilience-talents.js";
import { hasTalent } from "../../../../core/traits/talents-api.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";

/**
 * Open dialog to set base characteristics and favored flags.
 * @param {object} sheet
 * @param {Event} event
 */
export const onSetBaseCharacteristics = asyncGuardSheet(async function onSetBaseCharacteristics(event, target) {
  event.preventDefault();

  await customDialog({
    title: "Set Base Characteristics",
    content: `<div>
<h2>Set the Character's Base Characteristics.</h2>

                  <div style="border: inset; margin-bottom: 10px; padding: 5px;">
                  <i>Use this menu to adjust characteristic values on the character
                    when first creating a character or when spending XP to increase
                    their characteristics.
                  </i>
                  </div>

                  <div style="margin-bottom: 10px;">
                    <label><b>Points Total (without Luck): </b></label>
                    <label>
                    ${this.actor.system.characteristics.str.base +
      this.actor.system.characteristics.end.base +
      this.actor.system.characteristics.agi.base +
      this.actor.system.characteristics.int.base +
      this.actor.system.characteristics.wp.base +
      this.actor.system.characteristics.prc.base +
      this.actor.system.characteristics.prs.base
      }
	
                    </label>
                    <table style="table-layout: fixed; text-align: center;">
                      <tr>
                        <th>STR</th>
                        <th>END</th>
                        <th>AGI</th>
                        <th>INT</th>
                        <th>WP</th>
                        <th>PRC</th>
                        <th>PRS</th>
                        <th>LCK</th>
                      </tr>
                      <tr>
                        <td><input type="number" id="strInput" value="${this.actor.system.characteristics.str.base
      }"></td>
                        <td><input type="number" id="endInput" value="${this.actor.system.characteristics.end.base
      }"></td>
                        <td><input type="number" id="agiInput" value="${this.actor.system.characteristics.agi.base
      }"></td>
                        <td><input type="number" id="intInput" value="${this.actor.system.characteristics.int.base
      }"></td>
                        <td><input type="number" id="wpInput" value="${this.actor.system.characteristics.wp.base
      }"></td>
                        <td><input type="number" id="prcInput" value="${this.actor.system.characteristics.prc.base
      }"></td>
                        <td><input type="number" id="prsInput" value="${this.actor.system.characteristics.prs.base
      }"></td>
                        <td><input type="number" id="lckInput" value="${this.actor.system.characteristics.lck.base
      }"></td>
                      </tr>
                    </table>
                  </div>








                  <div style="margin-bottom: 10px;">
                    <h3 style="margin: 0 0 6px 0;">Favored Characteristics</h3>
                    <div style="border: inset; margin-bottom: 10px; padding: 5px;">
                      <i>Move favored toggles here to keep the sheet compact. These match the toggles previously shown next to each characteristic.</i>
                    </div>

                    <table style="table-layout: fixed; text-align: center;">
                      <tr>
                        <th>STR</th>
                        <th>END</th>
                        <th>AGI</th>
                        <th>INT</th>
                        <th>WP</th>
                        <th>PRC</th>
                        <th>PRS</th>
                        <th>LCK</th>
                      </tr>
                      <tr>
                        <td><input type="checkbox" id="strFav" ${this.actor.system.characteristics.str.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="endFav" ${this.actor.system.characteristics.end.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="agiFav" ${this.actor.system.characteristics.agi.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="intFav" ${this.actor.system.characteristics.int.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="wpFav" ${this.actor.system.characteristics.wp.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="prcFav" ${this.actor.system.characteristics.prc.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="prsFav" ${this.actor.system.characteristics.prs.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="lckFav" ${this.actor.system.characteristics.lck.favored ? 'checked' : ''}></td>
                      </tr>
                    </table>
                  </div>

</div>`,
    yes: {
      label: "Submit",
      callback: async (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          if (!root) return;
          const strInput = parseInt(root.querySelector('#strInput')?.value) || 0;
          const endInput = parseInt(root.querySelector('#endInput')?.value) || 0;
          const agiInput = parseInt(root.querySelector('#agiInput')?.value) || 0;
          const intInput = parseInt(root.querySelector('#intInput')?.value) || 0;
          const wpInput = parseInt(root.querySelector('#wpInput')?.value) || 0;
          const prcInput = parseInt(root.querySelector('#prcInput')?.value) || 0;
          const prsInput = parseInt(root.querySelector('#prsInput')?.value) || 0;
          const lckInput = parseInt(root.querySelector('#lckInput')?.value) || 0;
          const strFav = Boolean(root.querySelector('#strFav')?.checked);
          const endFav = Boolean(root.querySelector('#endFav')?.checked);
          const agiFav = Boolean(root.querySelector('#agiFav')?.checked);
          const intFav = Boolean(root.querySelector('#intFav')?.checked);
          const wpFav = Boolean(root.querySelector('#wpFav')?.checked);
          const prcFav = Boolean(root.querySelector('#prcFav')?.checked);
          const prsFav = Boolean(root.querySelector('#prsFav')?.checked);
          const lckFav = Boolean(root.querySelector('#lckFav')?.checked);

          //Shortcut for characteristics
          const chaPath = this.actor.system.characteristics;

          //Assign values to characteristics
          chaPath.str.base = strInput;
          chaPath.str.total = strInput;

          chaPath.end.base = endInput;
          chaPath.end.total = endInput;

          chaPath.agi.base = agiInput;
          chaPath.agi.total = agiInput;

          chaPath.int.base = intInput;
          chaPath.int.total = intInput;

          chaPath.wp.base = wpInput;
          chaPath.wp.total = wpInput;

          chaPath.prc.base = prcInput;
          chaPath.prc.total = prcInput;

          chaPath.prs.base = prsInput;
          chaPath.prs.total = prsInput;

          chaPath.lck.base = lckInput;
          chaPath.lck.total = lckInput;

          await requestUpdateDocument(this.actor, {
            system: {
              characteristics: {
                str: { base: strInput, total: chaPath.str.total },
                end: { base: endInput, total: chaPath.end.total },
                agi: { base: agiInput, total: chaPath.agi.total },
                int: { base: intInput, total: chaPath.int.total },
                wp: { base: wpInput, total: chaPath.wp.total },
                prc: { base: prcInput, total: chaPath.prc.total },
                prs: { base: prsInput, total: chaPath.prs.total },
                lck: { base: lckInput, total: chaPath.lck.total },
              },
            },
            "system.characteristics.str.favored": strFav,
            "system.characteristics.end.favored": endFav,
            "system.characteristics.agi.favored": agiFav,
            "system.characteristics.int.favored": intFav,
            "system.characteristics.wp.favored": wpFav,
            "system.characteristics.prc.favored": prcFav,
            "system.characteristics.prs.favored": prsFav,
            "system.characteristics.lck.favored": lckFav,
          });
      },
    },
    no: { label: "Cancel" },
    defaultButton: "yes",
  });
});

/**
 * Handle characteristic click for rolling.
 * Supports full opposed (targeted) and unopposed (untargeted) pipelines,
 * mirroring the skill-roll workflow with computeSkillTN, difficulty,
 * and standardized chat card formatting.
 *
 * @param {object} sheet
 * @param {Event} event
 */
export const onClickCharacteristic = asyncGuardSheet(async function onClickCharacteristic(event, target) {
  event.preventDefault();

  if (!requireUserCanRollActor(game.user, this.actor)) return;

  const element = target ?? event.currentTarget;
  const chaKey = String(element.id ?? "").trim().toLowerCase();
  const chaLabel = element.getAttribute("name") || chaKey.toUpperCase();

  const chaUuid = `cha:${chaKey}`;

  // Build pseudo-skill item for this characteristic
  const chaItem = _buildCharacteristicPseudoItem(this.actor, chaKey);
  if (!chaItem) {
    ui.notifications.warn(`Unknown characteristic: ${chaKey}`);
    return;
  }

  // --- TARGETED -> Opposed Workflow ---
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

    const quickShift = Boolean(event.shiftKey) && game.settings.get("uesrpg-3ev4", "skillRollQuickShift");

    for (const defenderToken of targets) {
      const msg = await SkillOpposedWorkflow.createPending({
        attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
        defenderTokenUuid: defenderToken.document?.uuid ?? defenderToken.uuid,
        attackerActorUuid: this.actor.uuid,
        defenderActorUuid: defenderToken.actor?.uuid ?? null,
        attackerSkillUuid: chaUuid,
        attackerSkillLabel: chaLabel
      });

      if (msg && quickShift) {
        await SkillOpposedWorkflow.handleAction(msg, "attacker-roll", { event });
      }
    }
    return;
  }

  // --- UNTARGETED -> Characteristic Test ---
  const resistanceSection = buildResistanceBonusSection(this.actor);

  const difficultyOptions = SKILL_DIFFICULTIES.map(d => {
    const selected = d.key === "average" ? "selected" : "";
    const sign = d.mod >= 0 ? "+" : "";
    return `<option value="${d.key}" ${selected}>${d.label} (${sign}${d.mod})</option>`;
  }).join("\n");

  const showIronWill = chaKey === "wp" && hasTalent(this.actor, "ironwill");
  const ironWillRow = showIronWill ? `
      <div class="form-group" style="margin-top:8px;">
        <label style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" name="isResistanceTest" />
          <span><b>Resistance Test</b> (Iron Will — reroll on failure)</span>
        </label>
      </div>` : "";

  const dialogContent = `
    <div class="uesrpg-skill-roll">
      <div class="form-group">
        <label><b>Difficulty</b></label>
        <select name="difficultyKey" style="width:100%;">${difficultyOptions}</select>
      </div>
      <div class="form-group" style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <label style="margin:0;"><b>Manual Modifier</b></label>
        <input name="manualMod" type="number" value="0" style="width:120px;" />
      </div>
      ${ironWillRow}
      ${resistanceSection.html}
    </div>`;

  let decl = null;
  try {
    decl = await customDialog({
      title: `${chaLabel} — Roll Options`,
      content: dialogContent,
      buttons: {
        ok: {
          label: "Roll",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const difficultyKey = root?.querySelector('select[name="difficultyKey"]')?.value ?? "average";
            const rawManual = root?.querySelector('input[name="manualMod"]')?.value ?? "0";
            const manualMod = Number.parseInt(String(rawManual), 10) || 0;
            const isResistanceTest = Boolean(root?.querySelector('input[name="isResistanceTest"]')?.checked);
            const selectedRes = readResistanceBonusSelections(root, resistanceSection.options);
            return { difficultyKey, manualMod, isResistanceTest, resistanceSelected: selectedRes };
          }
        },
        cancel: { label: "Cancel", callback: () => null }
      },
      default: "ok",
      width: 420
    });
  } catch (_e) {
    return;
  }

  if (!decl) return;

  const resMods = buildResistanceBonusMods(decl.resistanceSelected ?? []);
  const resBonus = resMods.reduce((sum, m) => sum + Number(m.value ?? 0), 0);
  const situationalMods = [...resMods];

  const tn = computeSkillTN({
    actor: this.actor,
    skillItem: chaItem,
    difficultyKey: decl.difficultyKey,
    manualMod: decl.manualMod,
    situationalMods
  });

  // Build tags
  const tags = [];
  if (Number(this.actor.system?.woundPenalty ?? 0) !== 0) tags.push(`<span class="tag wound-tag">Wounded ${this.actor.system.woundPenalty}</span>`);
  if (this.actor.system.fatigue.penalty != 0) tags.push(`<span class="tag fatigue-tag">Fatigued ${this.actor.system.fatigue.penalty}</span>`);
  if (this.actor.system.carry_rating.penalty != 0) tags.push(`<span class="tag enc-tag">Encumbered ${this.actor.system.carry_rating.penalty}</span>`);

  const armorMods = (tn.breakdown ?? []).filter(b => String(b.label || "").startsWith("Armor:") && Number(b.value) !== 0);
  for (const m of armorMods) {
    const v = Number(m.value) || 0;
    tags.push(`<span class="tag armor-tag">${m.label} ${v}</span>`);
  }

  if (tn?.difficulty?.mod) tags.push(`<span class="tag">${tn.difficulty.label} ${tn.difficulty.mod >= 0 ? "+" : ""}${tn.difficulty.mod}</span>`);
  if (decl.manualMod) tags.push(`<span class="tag">Mod ${decl.manualMod >= 0 ? "+" : ""}${decl.manualMod}</span>`);
  if (resBonus) {
    const labels = resMods.map(m => m.label).join(", ");
    tags.push(`<span class="tag">Resistance Bonus ${resBonus >= 0 ? "+" : ""}${resBonus}${labels ? ` (${labels})` : ""}</span>`);
  }

  // Perform roll
  const res = await doTestRoll(this.actor, { rollFormula: SYSTEM_ROLL_FORMULA, target: tn.finalTN, allowLucky: true, allowUnlucky: true });

  // Awareness talent automation
  await applyKeenIntuitionToResult(this.actor, chaLabel, res, { allowPrompt: true });
  await applyHyperAwarenessToResult(this.actor, chaLabel, res, { allowPrompt: true });

  // Iron Will (Chapter 4): reroll failed WP resistance tests
  const ironWillResult = await applyIronWillReroll({
    actor: this.actor,
    chaKey,
    result: res,
    tn,
    isResistanceTest: Boolean(decl?.isResistanceTest)
  });

  // Format result
  const degreeLine = res.isSuccess
    ? `<b style="color:green;">SUCCESS — ${formatDegree(res)}</b>`
    : `<b style="color:rgb(168, 5, 5);">FAILURE — ${formatDegree(res)}</b>`;

  const breakdownRows = (tn.breakdown ?? []).map(b => {
    const v = Number(b.value ?? 0);
    const sign = v >= 0 ? "+" : "";
    return `<div style="display:flex; justify-content:space-between; gap:10px;"><span>${b.label}</span><span>${sign}${v}</span></div>`;
  }).join("");

  const declaredParts = [];
  if (tn?.difficulty?.label) declaredParts.push(`${tn.difficulty.label} (${tn.difficulty.mod >= 0 ? "+" : ""}${tn.difficulty.mod})`);
  if (decl.manualMod) declaredParts.push(`Mod ${decl.manualMod >= 0 ? "+" : ""}${decl.manualMod}`);
  if (decl.isResistanceTest) declaredParts.push("Resistance Test (Iron Will)");
  if (ironWillResult?.rerolled) declaredParts.push("Iron Will Reroll");

  const flavor = `
    <div>
      <h2 style="margin:0 0 6px 0;">${chaLabel} (Characteristic)</h2>
      <div><b>Target Number:</b> ${tn.finalTN}</div>
      ${declaredParts.length ? `<div style="margin-top:2px; font-size:12px; opacity:0.85;"><b>Options:</b> ${declaredParts.join("; ")}</div>` : ""}
      <div style="margin-top:4px;">${degreeLine}${res.isCriticalSuccess ? ' <span style="color:green;">(CRITICAL)</span>' : ''}${res.isCriticalFailure ? ' <span style="color:red;">(CRITICAL FAIL)</span>' : ''}</div>
      <details style="margin-top:6px;"><summary style="cursor:pointer; user-select:none;">TN breakdown</summary><div style="margin-top:4px; font-size:12px; opacity:0.9;">${breakdownRows}</div></details>
      <div class="tag-container" style="margin-top:6px;">${tags.join("")}</div>
    </div>`;

  const rollMode = game.settings.get("core", "rollMode");

  await res.roll.toMessage({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: this.actor }),
    flavor,
    flags: {
      uesrpg: {
        characteristicTest: {
          actorUuid: this.actor.uuid,
          characteristicKey: chaKey,
          characteristicLabel: chaLabel,
          target: tn.finalTN,
          isResistanceTest: Boolean(decl?.isResistanceTest),
          ironWillRerolled: Boolean(ironWillResult?.rerolled),
          isSuccess: Boolean(res.isSuccess),
          degree: Number(res.degree ?? 0) || 0
        },
        reroll: { used: false, source: null }
      },
      "uesrpg-3ev4": {
        characteristicTest: {
          actorUuid: this.actor.uuid,
          characteristicKey: chaKey,
          characteristicLabel: chaLabel,
          target: tn.finalTN,
          isResistanceTest: Boolean(decl?.isResistanceTest),
          ironWillRerolled: Boolean(ironWillResult?.rerolled),
          isSuccess: Boolean(res.isSuccess),
          degree: Number(res.degree ?? 0) || 0
        }
      }
    },
    rollMode
  });
});

/**
 * Open lucky/unlucky numbers configuration dialog.
 * @param {object} sheet
 * @param {Event} event
 */
export const onLuckyMenu = asyncGuardSheet(async function onLuckyMenu(event, target) {
  event.preventDefault();

  const hasThiefBirthsign = this.actor.items.filter(
    (item) =>
      item.type === "trait" &&
      (item.name === "The Thief" || item.name === "The Star-Cursed Thief")
  ).length > 0;

  const thiefInput = hasThiefBirthsign
    ? `<input class="luckyNum thiefNum" id="ln6" type="number" value="${this.actor.system.lucky_numbers.ln6}">`
    : "";

  const content = `<div style="padding: 10px">
                    <div style="background: rgba(180, 180, 180, 0.562); border: solid 1px; padding: 10px; font-style: italic;">
                        Input your character's lucky and unlucky numbers and click submit to register them. You can change them at any point.
                    </div>

                    <div>
                      <h2 style="text-align: center;">
                        Lucky Numbers
                      </h2>
                      <div style="display: flex; justify-content: space-around; align-items: center; text-align: center;">
                          <input class="luckyNum" id="ln1" type="number" value="${this.actor.system.lucky_numbers.ln1}">
                          <input class="luckyNum" id="ln2" type="number" value="${this.actor.system.lucky_numbers.ln2}">
                          <input class="luckyNum" id="ln3" type="number" value="${this.actor.system.lucky_numbers.ln3}">
                          <input class="luckyNum" id="ln4" type="number" value="${this.actor.system.lucky_numbers.ln4}">
                          <input class="luckyNum" id="ln5" type="number" value="${this.actor.system.lucky_numbers.ln5}">
                          ${thiefInput}
                      </div>
                    </div>

                    <div>
                      <h2 style="text-align: center;">
                        Unlucky Numbers
                      </h2>
                      <div style="display: flex; justify-content: space-around; align-items: center; text-align: center;">
                          <input class="unluckyNum" id="ul1" type="number" value="${this.actor.system.unlucky_numbers.ul1}">
                          <input class="unluckyNum" id="ul2" type="number" value="${this.actor.system.unlucky_numbers.ul2}">
                          <input class="unluckyNum" id="ul3" type="number" value="${this.actor.system.unlucky_numbers.ul3}">
                          <input class="unluckyNum" id="ul4" type="number" value="${this.actor.system.unlucky_numbers.ul4}">
                          <input class="unluckyNum" id="ul5" type="number" value="${this.actor.system.unlucky_numbers.ul5}">
                      </div>
                    </div>
                  </div>`;

  await customDialog({
    title: "Lucky & Unlucky Numbers",
    content,
    yes: {
      label: "Submit",
      callback: async (html) => {
        const root = html instanceof HTMLElement ? html : html?.[0];
        // Create input arrays from dialog root (not global document)
        const luckyNums = [...root.querySelectorAll(".luckyNum")];
        const unluckyNums = [...root.querySelectorAll(".unluckyNum")];

        // Collect all lucky/unlucky number updates into a single payload
        const updatePayload = {};
        for (const num of luckyNums) {
          updatePayload[`system.lucky_numbers.${num.id}`] = Number(num.value);
        }
        for (const num of unluckyNums) {
          updatePayload[`system.unlucky_numbers.${num.id}`] = Number(num.value);
        }
        if (Object.keys(updatePayload).length) {
            await requestUpdateDocument(this.actor, updatePayload);
        }
      },
    },
    no: { label: "Cancel" },
    defaultButton: "yes",
  });
});
