/**
 * Characteristic management handlers.
 * Handles characteristic setting, rolling, and lucky/unlucky number configuration.
 *
 * Target: Foundry VTT v13 (AppV1 ActorSheet).
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

/**
 * Open dialog to set base characteristics and favored flags.
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export async function onSetBaseCharacteristics(sheet, event) {
  event.preventDefault();

  const d = new Dialog({
    title: "Set Base Characteristics",
    content: `<form>
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
                    ${sheet.actor.system.characteristics.str.base +
      sheet.actor.system.characteristics.end.base +
      sheet.actor.system.characteristics.agi.base +
      sheet.actor.system.characteristics.int.base +
      sheet.actor.system.characteristics.wp.base +
      sheet.actor.system.characteristics.prc.base +
      sheet.actor.system.characteristics.prs.base
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
                        <td><input type="number" id="strInput" value="${sheet.actor.system.characteristics.str.base
      }"></td>
                        <td><input type="number" id="endInput" value="${sheet.actor.system.characteristics.end.base
      }"></td>
                        <td><input type="number" id="agiInput" value="${sheet.actor.system.characteristics.agi.base
      }"></td>
                        <td><input type="number" id="intInput" value="${sheet.actor.system.characteristics.int.base
      }"></td>
                        <td><input type="number" id="wpInput" value="${sheet.actor.system.characteristics.wp.base
      }"></td>
                        <td><input type="number" id="prcInput" value="${sheet.actor.system.characteristics.prc.base
      }"></td>
                        <td><input type="number" id="prsInput" value="${sheet.actor.system.characteristics.prs.base
      }"></td>
                        <td><input type="number" id="lckInput" value="${sheet.actor.system.characteristics.lck.base
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
                        <td><input type="checkbox" id="strFav" ${sheet.actor.system.characteristics.str.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="endFav" ${sheet.actor.system.characteristics.end.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="agiFav" ${sheet.actor.system.characteristics.agi.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="intFav" ${sheet.actor.system.characteristics.int.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="wpFav" ${sheet.actor.system.characteristics.wp.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="prcFav" ${sheet.actor.system.characteristics.prc.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="prsFav" ${sheet.actor.system.characteristics.prs.favored ? 'checked' : ''}></td>
                        <td><input type="checkbox" id="lckFav" ${sheet.actor.system.characteristics.lck.favored ? 'checked' : ''}></td>
                      </tr>
                    </table>
                  </div>

</form>`,
    buttons: {
      one: {
        label: "Submit",
        callback: async (html) => {
          const strInput = parseInt(html.find('[id="strInput"]').val());
          const endInput = parseInt(html.find('[id="endInput"]').val());
          const agiInput = parseInt(html.find('[id="agiInput"]').val());
          const intInput = parseInt(html.find('[id="intInput"]').val());
          const wpInput = parseInt(html.find('[id="wpInput"]').val());
          const prcInput = parseInt(html.find('[id="prcInput"]').val());
          const prsInput = parseInt(html.find('[id="prsInput"]').val());
          const lckInput = parseInt(html.find('[id="lckInput"]').val());
          const strFav = Boolean(html.find('[id="strFav"]').prop("checked"));
          const endFav = Boolean(html.find('[id="endFav"]').prop("checked"));
          const agiFav = Boolean(html.find('[id="agiFav"]').prop("checked"));
          const intFav = Boolean(html.find('[id="intFav"]').prop("checked"));
          const wpFav = Boolean(html.find('[id="wpFav"]').prop("checked"));
          const prcFav = Boolean(html.find('[id="prcFav"]').prop("checked"));
          const prsFav = Boolean(html.find('[id="prsFav"]').prop("checked"));
          const lckFav = Boolean(html.find('[id="lckFav"]').prop("checked"));

          //Shortcut for characteristics
          const chaPath = sheet.actor.system.characteristics;

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

          await sheet.actor.update({
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
      two: {
        label: "Cancel",
        callback: () => {},
      },
    },
    default: "one",
    close: () => {},
  });
  d.render(true);
}

/**
 * Handle characteristic click for rolling.
 * Supports full opposed (targeted) and unopposed (untargeted) pipelines,
 * mirroring the skill-roll workflow with computeSkillTN, difficulty,
 * and standardized chat card formatting.
 *
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export async function onClickCharacteristic(sheet, event) {
  event.preventDefault();

  if (!requireUserCanRollActor(game.user, sheet.actor)) return;

  const element = event.currentTarget;
  const chaKey = String(element.id ?? "").trim().toLowerCase();
  const chaLabel = element.getAttribute("name") || chaKey.toUpperCase();

  const chaUuid = `cha:${chaKey}`;

  // Build pseudo-skill item for this characteristic
  const chaItem = _buildCharacteristicPseudoItem(sheet.actor, chaKey);
  if (!chaItem) {
    ui.notifications.warn(`Unknown characteristic: ${chaKey}`);
    return;
  }

  // --- TARGETED -> Opposed Workflow ---
  const targets = [...(game.user.targets ?? [])];
  if (targets.length > 0) {
    const attackerToken =
      canvas?.tokens?.controlled?.find(t => t.actor?.id === sheet.actor.id) ??
      sheet.actor.getActiveTokens?.()?.[0] ??
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
        attackerActorUuid: sheet.actor.uuid,
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
  const resistanceSection = buildResistanceBonusSection(sheet.actor);

  const difficultyOptions = SKILL_DIFFICULTIES.map(d => {
    const selected = d.key === "average" ? "selected" : "";
    const sign = d.mod >= 0 ? "+" : "";
    return `<option value="${d.key}" ${selected}>${d.label} (${sign}${d.mod})</option>`;
  }).join("\n");

  const showIronWill = chaKey === "wp" && hasTalent(sheet.actor, "ironwill");
  const ironWillRow = showIronWill ? `
      <div class="form-group" style="margin-top:8px;">
        <label style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" name="isResistanceTest" />
          <span><b>Resistance Test</b> (Iron Will — reroll on failure)</span>
        </label>
      </div>` : "";

  const dialogContent = `
    <form class="uesrpg-skill-roll">
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
    </form>`;

  let decl = null;
  try {
    decl = await Dialog.wait({
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
      default: "ok"
    }, { width: 420 });
  } catch (_e) {
    return;
  }

  if (!decl) return;

  const resMods = buildResistanceBonusMods(decl.resistanceSelected ?? []);
  const resBonus = resMods.reduce((sum, m) => sum + Number(m.value ?? 0), 0);
  const situationalMods = [...resMods];

  const tn = computeSkillTN({
    actor: sheet.actor,
    skillItem: chaItem,
    difficultyKey: decl.difficultyKey,
    manualMod: decl.manualMod,
    situationalMods
  });

  // Build tags
  const tags = [];
  if (Number(sheet.actor.system?.woundPenalty ?? 0) !== 0) tags.push(`<span class="tag wound-tag">Wounded ${sheet.actor.system.woundPenalty}</span>`);
  if (sheet.actor.system.fatigue.penalty != 0) tags.push(`<span class="tag fatigue-tag">Fatigued ${sheet.actor.system.fatigue.penalty}</span>`);
  if (sheet.actor.system.carry_rating.penalty != 0) tags.push(`<span class="tag enc-tag">Encumbered ${sheet.actor.system.carry_rating.penalty}</span>`);

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
  const res = await doTestRoll(sheet.actor, { rollFormula: SYSTEM_ROLL_FORMULA, target: tn.finalTN, allowLucky: true, allowUnlucky: true });

  // Awareness talent automation
  await applyKeenIntuitionToResult(sheet.actor, chaLabel, res, { allowPrompt: true });
  await applyHyperAwarenessToResult(sheet.actor, chaLabel, res, { allowPrompt: true });

  // Iron Will (Chapter 4): reroll failed WP resistance tests
  const ironWillResult = await applyIronWillReroll({
    actor: sheet.actor,
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
    speaker: ChatMessage.getSpeaker({ actor: sheet.actor }),
    flavor,
    flags: {
      uesrpg: {
        characteristicTest: {
          actorUuid: sheet.actor.uuid,
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
          actorUuid: sheet.actor.uuid,
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
}

/**
 * Open lucky/unlucky numbers configuration dialog.
 * @param {foundry.appv1.sheets.ActorSheet} sheet
 * @param {Event} event
 */
export function onLuckyMenu(sheet, event) {
  event.preventDefault();
  let d;

  const hasThiefBirthsign = sheet.actor.items.filter(
    (item) =>
      item.type === "trait" &&
      (item.name === "The Thief" || item.name === "The Star-Cursed Thief")
  ).length > 0;

  if (hasThiefBirthsign) {
    d = new Dialog({
      title: "Lucky & Unlucky Numbers",
      content: `<form style="padding: 10px">
                    <div style="background: rgba(180, 180, 180, 0.562); border: solid 1px; padding: 10px; font-style: italic;">
                        Input your character's lucky and unlucky numbers and click submit to register them. You can change them at any point.
                    </div>

                    <div>
                      <h2 style="text-align: center;">
                        Lucky Numbers
                      </h2>
                      <div style="display: flex; justify-content: space-around; align-items: center; text-align: center;">
                          <input class="luckyNum" id="ln1" type="number" value="${sheet.actor.system.lucky_numbers.ln1}">
                          <input class="luckyNum" id="ln2" type="number" value="${sheet.actor.system.lucky_numbers.ln2}">
                          <input class="luckyNum" id="ln3" type="number" value="${sheet.actor.system.lucky_numbers.ln3}">
                          <input class="luckyNum" id="ln4" type="number" value="${sheet.actor.system.lucky_numbers.ln4}">
                          <input class="luckyNum" id="ln5" type="number" value="${sheet.actor.system.lucky_numbers.ln5}">
                          <input class="luckyNum thiefNum" id="ln6" type="number" value="${sheet.actor.system.lucky_numbers.ln6}">
                      </div>
                    </div>

                    <div>
                      <h2 style="text-align: center;">
                        Unlucky Numbers
                      </h2>
                      <div style="display: flex; justify-content: space-around; align-items: center; text-align: center;">
                          <input class="unluckyNum" id="ul1" type="number" value="${sheet.actor.system.unlucky_numbers.ul1}">
                          <input class="unluckyNum" id="ul2" type="number" value="${sheet.actor.system.unlucky_numbers.ul2}">
                          <input class="unluckyNum" id="ul3" type="number" value="${sheet.actor.system.unlucky_numbers.ul3}">
                          <input class="unluckyNum" id="ul4" type="number" value="${sheet.actor.system.unlucky_numbers.ul4}">
                          <input class="unluckyNum" id="ul5" type="number" value="${sheet.actor.system.unlucky_numbers.ul5}">
                      </div>
                    </div>
                  </form>`,
      buttons: {
        one: {
          label: "Cancel",
          callback: () => {},
        },
        two: {
          label: "Submit",
          callback: (html) => {
            // Create input arrays
            const luckyNums = [...document.querySelectorAll(".luckyNum")];
            const unluckyNums = [...document.querySelectorAll(".unluckyNum")];

            // Assign input values to appropriate actor fields
            for (let num of luckyNums) {
              let numPath = `system.lucky_numbers.${num.id}`;
              sheet.actor.update({ [numPath]: Number(num.value) });
            }

            for (let num of unluckyNums) {
              let numPath = `system.unlucky_numbers.${num.id}`;
              sheet.actor.update({ [numPath]: Number(num.value) });
            }
          },
        },
      },
      default: "two",
      close: () => {},
    });
  } else {
    d = new Dialog({
      title: "Lucky & Unlucky Numbers",
      content: `<form style="padding: 10px">
                  <div style="background: rgba(180, 180, 180, 0.562); border: solid 1px; padding: 10px; font-style: italic;">
                      Input your character's lucky and unlucky numbers and click submit to register them. You can change them at any point.
                  </div>

                  <div>
                    <h2 style="text-align: center;">
                      Lucky Numbers
                    </h2>
                    <div style="display: flex; justify-content: space-around; align-items: center; text-align: center;">
                        <input class="luckyNum" id="ln1" type="number" value=${sheet.actor.system.lucky_numbers.ln1}>
                        <input class="luckyNum" id="ln2" type="number" value=${sheet.actor.system.lucky_numbers.ln2}>
                        <input class="luckyNum" id="ln3" type="number" value=${sheet.actor.system.lucky_numbers.ln3}>
                        <input class="luckyNum" id="ln4" type="number" value=${sheet.actor.system.lucky_numbers.ln4}>
                        <input class="luckyNum" id="ln5" type="number" value=${sheet.actor.system.lucky_numbers.ln5}>
                    </div>
                  </div>

                  <div>
                    <h2 style="text-align: center;">
                      Unlucky Numbers
                    </h2>
                    <div style="display: flex; justify-content: space-around; align-items: center; text-align: center;">
                        <input class="unluckyNum" id="ul1" type="number" value=${sheet.actor.system.unlucky_numbers.ul1}>
                        <input class="unluckyNum" id="ul2" type="number" value=${sheet.actor.system.unlucky_numbers.ul2}>
                        <input class="unluckyNum" id="ul3" type="number" value=${sheet.actor.system.unlucky_numbers.ul3}>
                        <input class="unluckyNum" id="ul4" type="number" value=${sheet.actor.system.unlucky_numbers.ul4}>
                        <input class="unluckyNum" id="ul5" type="number" value=${sheet.actor.system.unlucky_numbers.ul5}>
                    </div>
                  </div>
                </form>`,
      buttons: {
        one: {
          label: "Cancel",
          callback: () => {},
        },
        two: {
          label: "Submit",
          callback: (html) => {
            // Create input arrays
            const luckyNums = [...document.querySelectorAll(".luckyNum")];
            const unluckyNums = [...document.querySelectorAll(".unluckyNum")];

            // Assign input values to appropriate actor fields
            for (let num of luckyNums) {
              let numPath = `system.lucky_numbers.${num.id}`;
              sheet.actor.update({ [numPath]: Number(num.value) });
            }

            for (let num of unluckyNums) {
              let numPath = `system.unlucky_numbers.${num.id}`;
              sheet.actor.update({ [numPath]: Number(num.value) });
            }
          },
        },
      },
      default: "two",
      close: () => {},
    });
  }
  d.render(true);
}
