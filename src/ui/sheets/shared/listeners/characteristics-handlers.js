/**
 * Characteristic management handlers.
 * Handles characteristic setting, rolling, and lucky/unlucky number configuration.
 *
 * Shared across actor sheet modules.
 */

import { SYSTEM_ROLL_FORMULA } from "../../../../core/constants.js";
import { SkillOpposedWorkflow } from "../../../../core/skills/opposed-workflow/index.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "../../../../core/skills/skill-tn.js";
import { doTestRoll, formatDegree, formatResultSummary } from "../../../../utils/degree-roll-helper.js";
import { requireUserCanRollActor } from "../../../../utils/permissions.js";
import { buildResistanceBonusSection, readResistanceBonusSelections, buildResistanceBonusMods } from "../../../../core/traits/trait-resistance-ui.js";
import { _buildCharacteristicPseudoItem } from "../../../../core/skills/opposed-workflow/core/skills.js";
import { applyKeenIntuitionToResult, applyHyperAwarenessToResult } from "../../../../core/traits/awareness-talents.js";
import { applyIronWillReroll } from "../../../../core/traits/resilience-talents.js";
import { hasTalent } from "../../../../core/traits/talents-api.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";
import { appendChargenAudit } from "../../../apps/v2/char-gen/audit-log.js";
import {
  LUCKY_SLOT_KEYS,
  UNLUCKY_SLOT_KEYS,
  resolveLuckyUnluckyAllocation,
  extractConfiguredLuckyNumbers,
  extractConfiguredUnluckyNumbers,
  readLuckySlotMap,
  readUnluckySlotMap,
} from "../../../../core/luck/lucky-numbers.js";

const CHA_KEYS = ["str", "end", "agi", "int", "wp", "prc", "prs"];

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _roll2d10() {
  return (Math.floor(Math.random() * 10) + 1) + (Math.floor(Math.random() * 10) + 1);
}

function _randomUniqueD100(existing = new Set()) {
  while (true) {
    const n = Math.floor(Math.random() * 100) + 1;
    if (!existing.has(n)) return n;
  }
}

function _resolveDialogRoot(dialogRef) {
  const el = dialogRef?.element ?? dialogRef;
  const node = el instanceof HTMLElement ? el : el?.[0];
  if (!(node instanceof HTMLElement)) return null;
  return node.querySelector(".uesrpg-cg-dialog") ?? node;
}

/**
 * Open dialog to set base characteristics and favored flags.
 * @param {object} sheet
 * @param {Event} event
 */
export const onSetBaseCharacteristics = asyncGuardSheet(async function onSetBaseCharacteristics(event, target) {
  event.preventDefault();

  const actor = this.actor;
  const current = actor.system?.characteristics ?? {};
  const baseline = {};
  for (const key of CHA_KEYS) baseline[key] = _num(current[key]?.base, 0);
  const state = {
    mode: "roll",
    assignmentMode: "auto",
    hasRolled: false,
    rerollsUsed: 0,
    rollPool: CHA_KEYS.map(() => null),
    luckRoll: null,
    pointBuy: Object.fromEntries(CHA_KEYS.map((k) => [k, 0])),
  };

  function currentAssignMap(root) {
    if (!state.hasRolled) return null;
    if (state.assignmentMode === "auto") {
      return Object.fromEntries(CHA_KEYS.map((k, idx) => [k, idx]));
    }
    const map = {};
    for (const key of CHA_KEYS) {
      const select = root?.querySelector(`#assign-${key}`);
      map[key] = _num(select?.value, -1);
    }
    return map;
  }

  function writeRollTotals(root) {
    if (!state.hasRolled) return;
    const assignMap = currentAssignMap(root);
    for (const key of CHA_KEYS) {
      const idx = _num(assignMap[key], -1);
      const value = idx >= 0 ? baseline[key] + _num(state.rollPool[idx], 0) : baseline[key];
      const targetInput = root?.querySelector(`#${key}Input`);
      if (targetInput) targetInput.value = String(value);
    }
  }

  function writePointBuyTotals(root) {
    let total = 0;
    for (const key of CHA_KEYS) {
      const allocInput = root?.querySelector(`#pb-${key}`);
      const alloc = Math.max(0, Math.min(20, _num(allocInput?.value, 0)));
      if (allocInput) allocInput.value = String(alloc);
      total += alloc;
      state.pointBuy[key] = alloc;
      const targetInput = root?.querySelector(`#${key}Input`);
      if (targetInput) targetInput.value = String(baseline[key] + alloc);
    }
    const totalEl = root?.querySelector("#cgPointBuyTotal");
    if (totalEl) totalEl.textContent = `${total}/80`;
  }

  function renderRollAssignSelectors(root) {
    const wrap = root?.querySelector("#cgManualAssignWrap");
    if (!wrap) return;
    const existingMap = currentAssignMap(root) ?? {};
    wrap.innerHTML = CHA_KEYS.map((key, idx) => {
      const current = _num(existingMap[key], idx);
      const options = state.rollPool.map((roll, rIdx) => `<option value="${rIdx}" ${rIdx === current ? "selected" : ""}>${roll}</option>`).join("");
      return `<label style="display:flex; flex-direction:column; gap:2px;">
        <span>${key.toUpperCase()}</span>
        <select id="assign-${key}">${options}</select>
      </label>`;
    }).join("");
  }

  function refreshUi(root) {
    if (!root) return;
    const isRoll = state.mode === "roll";
    const poolEl = root.querySelector("#cgRollPool");
    if (poolEl) poolEl.textContent = state.hasRolled ? state.rollPool.join(", ") : "Stand by";
    const modeEl = root.querySelector("#cgModeLabel");
    if (modeEl) modeEl.textContent = state.mode === "pointbuy" ? "Point Buy" : "Roll";
    const rerollsEl = root.querySelector("#cgRerollCount");
    if (rerollsEl) rerollsEl.textContent = `${state.rerollsUsed}/3`;
    const lck = root.querySelector("#lckInput");
    if (lck) {
      if (state.hasRolled && state.luckRoll !== null) lck.value = String(state.luckRoll);
      else if (!String(lck.dataset.userEdited ?? "").trim()) lck.value = "";
    }
    const rerollBtn = root.querySelector("#cgReroll");
    if (rerollBtn) rerollBtn.disabled = !(isRoll && state.hasRolled);
    const rollSection = root.querySelector("#cgRollSection");
    const pbSection = root.querySelector("#cgPointBuySection");
    if (rollSection) rollSection.style.display = isRoll ? "" : "none";
    if (pbSection) pbSection.style.display = isRoll ? "none" : "";

    const manualWrap = root.querySelector("#cgManualAssignSection");
    if (manualWrap) manualWrap.style.display = isRoll && state.hasRolled && state.assignmentMode === "manual" ? "" : "none";

    if (isRoll && state.hasRolled) {
      writeRollTotals(root);
    } else if (!isRoll) {
      writePointBuyTotals(root);
    }
  }

  await customDialog({
    title: "Set Base Characteristics",
    width: 800,
    classes: ["uesrpg-cg-compact-dialog"],
    content: `<div class="uesrpg-cg-dialog">
      <div class="uesrpg-cg-dialog__note">
        RAW: Roll 2d10 seven times for non-luck and assign on top of racial baseline. Luck is 2d10 + 30 (max 50). Optional manual point-buy: distribute exactly 80 points (max 20 per non-luck characteristic).
      </div>
      <div class="uesrpg-cg-dialog__tools">
        <button type="button" id="cgRollAssign">Roll + Assign</button>
        <button type="button" id="cgRollDistribute">Roll + Distribute</button>
        <button type="button" id="cgUsePointBuy">Use Point Buy Mode</button>
        <button type="button" id="cgReroll" title="Optional RAW reroll pool (max 3)">Reroll Pool</button>
        <span class="uesrpg-cg-dialog__small">Mode: <b id="cgModeLabel">Roll</b></span>
        <span class="uesrpg-cg-dialog__small">Pool: <span id="cgRollPool">Stand by</span></span>
        <span class="uesrpg-cg-dialog__small">Rerolls: <span id="cgRerollCount">0/3</span></span>
      </div>
      <div id="cgRollSection" class="uesrpg-cg-dialog__note">Fields are editable and typed values are used on submit. Roll assignment mode controls how the 7 rolled values map to STR/END/AGI/INT/WP/PRC/PRS.</div>
      <div id="cgManualAssignSection" style="display:none;">
        <div class="uesrpg-cg-dialog__note">Manual Assignment (use each roll exactly once):</div>
        <div id="cgManualAssignWrap" style="display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:6px;"></div>
      </div>
      <div id="cgPointBuySection" style="display:none;">
        <div class="uesrpg-cg-dialog__note">Point Buy Allocation: <b id="cgPointBuyTotal">0/80</b> (max 20 each)</div>
        <div style="display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:6px;">
          ${CHA_KEYS.map((k) => `<label style="display:flex; flex-direction:column; gap:2px;"><span>${k.toUpperCase()}</span><input type="number" id="pb-${k}" min="0" max="20" value="0"></label>`).join("")}
        </div>
      </div>
      <table class="uesrpg-cg-dialog__table">
        <tr><th></th><th>STR</th><th>END</th><th>AGI</th><th>INT</th><th>WP</th><th>PRC</th><th>PRS</th><th>LCK</th></tr>
        <tr>
          <th scope="row">Current</th>
          <td><input type="number" value="${baseline.str}" readonly disabled></td>
          <td><input type="number" value="${baseline.end}" readonly disabled></td>
          <td><input type="number" value="${baseline.agi}" readonly disabled></td>
          <td><input type="number" value="${baseline.int}" readonly disabled></td>
          <td><input type="number" value="${baseline.wp}" readonly disabled></td>
          <td><input type="number" value="${baseline.prc}" readonly disabled></td>
          <td><input type="number" value="${baseline.prs}" readonly disabled></td>
          <td><input type="number" value="${_num(current?.lck?.base, 0)}" readonly disabled></td>
        </tr>
        <tr>
          <th scope="row">Result</th>
          <td><input type="number" id="strInput"></td>
          <td><input type="number" id="endInput"></td>
          <td><input type="number" id="agiInput"></td>
          <td><input type="number" id="intInput"></td>
          <td><input type="number" id="wpInput"></td>
          <td><input type="number" id="prcInput"></td>
          <td><input type="number" id="prsInput"></td>
          <td><input type="number" id="lckInput" value=""></td>
        </tr>
      </table>
      <div class="uesrpg-cg-dialog__note">Select exactly two favored characteristics.</div>
      <table class="uesrpg-cg-dialog__table">
        <tr><th>STR</th><th>END</th><th>AGI</th><th>INT</th><th>WP</th><th>PRC</th><th>PRS</th><th>LCK</th></tr>
        <tr>
          <td><input type="checkbox" id="strFav" ${current?.str?.favored ? "checked" : ""}></td>
          <td><input type="checkbox" id="endFav" ${current?.end?.favored ? "checked" : ""}></td>
          <td><input type="checkbox" id="agiFav" ${current?.agi?.favored ? "checked" : ""}></td>
          <td><input type="checkbox" id="intFav" ${current?.int?.favored ? "checked" : ""}></td>
          <td><input type="checkbox" id="wpFav" ${current?.wp?.favored ? "checked" : ""}></td>
          <td><input type="checkbox" id="prcFav" ${current?.prc?.favored ? "checked" : ""}></td>
          <td><input type="checkbox" id="prsFav" ${current?.prs?.favored ? "checked" : ""}></td>
          <td><input type="checkbox" id="lckFav" ${current?.lck?.favored ? "checked" : ""}></td>
        </tr>
      </table>
    </div>`,
    yes: {
      label: "Submit",
      callback: async (html) => {
        const root = _resolveDialogRoot(html);
        if (!root) return;
        let assignedMap = null;
        let pointBuyAllocation = null;
        if (state.mode === "roll" && state.hasRolled) {
          const map = currentAssignMap(root);
          const idxValues = Object.values(map);
          if (idxValues.some((v) => v < 0 || v >= state.rollPool.length)) {
            ui.notifications?.warn?.("Invalid roll assignment.");
            return;
          }
          if (state.assignmentMode === "manual") {
            if (new Set(idxValues).size !== idxValues.length) {
              ui.notifications?.warn?.("Manual assignment must use each rolled value only once.");
              return;
            }
          }
          assignedMap = map;
        } else if (state.mode === "pointbuy") {
          pointBuyAllocation = {};
          let total = 0;
          for (const key of CHA_KEYS) {
            const raw = _num(root.querySelector(`#pb-${key}`)?.value, 0);
            if (raw < 0 || raw > 20) {
              ui.notifications?.warn?.("Each point-buy allocation must be between 0 and 20.");
              return;
            }
            total += raw;
            pointBuyAllocation[key] = raw;
          }
          if (total !== 80) {
            ui.notifications?.warn?.(`Point buy must total exactly 80 (currently ${total}).`);
            return;
          }
        }
        // Typed field values are authoritative on submit. Roll/Point-Buy controls
        // are helper prefills that users may manually override before confirming.
        const values = {
          str: _num(root.querySelector("#strInput")?.value, 0),
          end: _num(root.querySelector("#endInput")?.value, 0),
          agi: _num(root.querySelector("#agiInput")?.value, 0),
          int: _num(root.querySelector("#intInput")?.value, 0),
          wp: _num(root.querySelector("#wpInput")?.value, 0),
          prc: _num(root.querySelector("#prcInput")?.value, 0),
          prs: _num(root.querySelector("#prsInput")?.value, 0),
          lck: Math.min(50, _num(root.querySelector("#lckInput")?.value, state.luckRoll)),
        };
        const favored = {
          str: Boolean(root.querySelector("#strFav")?.checked),
          end: Boolean(root.querySelector("#endFav")?.checked),
          agi: Boolean(root.querySelector("#agiFav")?.checked),
          int: Boolean(root.querySelector("#intFav")?.checked),
          wp: Boolean(root.querySelector("#wpFav")?.checked),
          prc: Boolean(root.querySelector("#prcFav")?.checked),
          prs: Boolean(root.querySelector("#prsFav")?.checked),
          lck: Boolean(root.querySelector("#lckFav")?.checked),
        };

        const favoredCount = Object.values(favored).filter(Boolean).length;
        if (favoredCount !== 2) {
          ui.notifications?.warn?.("Select exactly 2 favored characteristics.");
          return;
        }

        await requestUpdateDocument(actor, {
          "system.characteristics.str.base": values.str,
          "system.characteristics.str.total": values.str,
          "system.characteristics.end.base": values.end,
          "system.characteristics.end.total": values.end,
          "system.characteristics.agi.base": values.agi,
          "system.characteristics.agi.total": values.agi,
          "system.characteristics.int.base": values.int,
          "system.characteristics.int.total": values.int,
          "system.characteristics.wp.base": values.wp,
          "system.characteristics.wp.total": values.wp,
          "system.characteristics.prc.base": values.prc,
          "system.characteristics.prc.total": values.prc,
          "system.characteristics.prs.base": values.prs,
          "system.characteristics.prs.total": values.prs,
          "system.characteristics.lck.base": Math.min(50, values.lck),
          "system.characteristics.lck.total": Math.min(50, values.lck),
          "system.characteristics.str.favored": favored.str,
          "system.characteristics.end.favored": favored.end,
          "system.characteristics.agi.favored": favored.agi,
          "system.characteristics.int.favored": favored.int,
          "system.characteristics.wp.favored": favored.wp,
          "system.characteristics.prc.favored": favored.prc,
          "system.characteristics.prs.favored": favored.prs,
          "system.characteristics.lck.favored": favored.lck,
        });

        await appendChargenAudit(actor, {
          step: "stats",
          action: "submit",
          payload: {
            mode: state.mode,
            rollPool: state.mode === "roll" ? [...state.rollPool] : null,
            assignmentMode: state.mode === "roll" ? state.assignmentMode : null,
            assignedMap,
            pointBuyAllocation,
            luckRoll: state.hasRolled ? values.lck : null,
            rerollsUsed: state.rerollsUsed,
            final: values,
            favored: Object.entries(favored).filter(([, enabled]) => enabled).map(([k]) => k),
          },
        });
        await requestUpdateDocument(actor, {
          "flags.uesrpg-3ev4.chargen.statsGeneration": {
            mode: state.mode,
            rollPool: state.mode === "roll" && state.hasRolled ? [...state.rollPool] : null,
            assignmentMode: state.mode === "roll" && state.hasRolled ? state.assignmentMode : null,
            assignedMap,
            pointBuyAllocation,
            luckRoll: state.hasRolled ? values.lck : null,
            rerollsUsed: state.rerollsUsed,
          },
        });
      },
    },
    no: { label: "Cancel" },
    defaultButton: "yes",
    render: (_event, html) => {
      const root = _resolveDialogRoot(html);
      if (!root) return;
      renderRollAssignSelectors(root);
      refreshUi(root);

      const rollPool = (assignmentMode) => {
        state.mode = "roll";
        state.assignmentMode = assignmentMode;
        state.hasRolled = true;
        state.rollPool = CHA_KEYS.map(() => _roll2d10());
        state.luckRoll = Math.min(50, 30 + _roll2d10());
        root.querySelector("#lckInput").value = String(state.luckRoll);
        renderRollAssignSelectors(root);
        refreshUi(root);
      };
      root.querySelector("#cgRollAssign")?.addEventListener("click", () => rollPool("auto"));
      root.querySelector("#cgRollDistribute")?.addEventListener("click", () => rollPool("manual"));
      root.querySelector("#cgUsePointBuy")?.addEventListener("click", () => {
        state.mode = "pointbuy";
        refreshUi(root);
      });
      root.querySelector("#cgReroll")?.addEventListener("click", () => {
        if (!state.hasRolled) {
          ui.notifications?.warn?.("Roll a pool first.");
          return;
        }
        if (state.rerollsUsed >= 3) {
          ui.notifications?.warn?.("Maximum RAW rerolls reached (3).");
          return;
        }
        if (state.mode !== "roll") {
          ui.notifications?.warn?.("Reroll pool is only available in Roll mode.");
          return;
        }
        state.rerollsUsed += 1;
        state.rollPool = CHA_KEYS.map(() => _roll2d10());
        state.luckRoll = Math.min(50, 30 + _roll2d10());
        root.querySelector("#lckInput").value = String(state.luckRoll);
        renderRollAssignSelectors(root);
        refreshUi(root);
      });
      for (const key of CHA_KEYS) {
        root.querySelector(`#pb-${key}`)?.addEventListener("input", () => refreshUi(root));
      }
      root.querySelector("#lckInput")?.addEventListener("input", (ev) => {
        ev.currentTarget.dataset.userEdited = "true";
      });
      root.addEventListener("change", (ev) => {
        if (String(ev?.target?.id ?? "").startsWith("assign-")) refreshUi(root);
      });
    },
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
  const encApplied = (tn.breakdown ?? []).some(b => b.source === "encumbrance");
  if (encApplied) tags.push(`<span class="tag enc-tag">Encumbered ${this.actor.system.carry_rating.penalty}</span>`);

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
    ? `<b style="color:green;">${formatResultSummary(res, { uppercase: true, includeDegree: true, degreeStyle: "dash" })}</b>`
    : `<b style="color:rgb(168, 5, 5);">${formatResultSummary(res, { uppercase: true, includeDegree: true, degreeStyle: "dash" })}</b>`;

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
      <div style="margin-top:4px;">${degreeLine}</div>
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

  const actor = this.actor;
  const luckyInputKeys = LUCKY_SLOT_KEYS.slice(0, 6);
  const unluckyInputKeys = UNLUCKY_SLOT_KEYS;
  const allocation = resolveLuckyUnluckyAllocation(actor, { clampNonNegativeBonus: true });
  const initialLuckyMap = readLuckySlotMap(actor, { keys: luckyInputKeys });
  const initialUnluckyMap = readUnluckySlotMap(actor, { keys: unluckyInputKeys });
  const state = { mode: "manual", rollTrace: null };

  function rollNumbers() {
    const luckyCount = allocation.luckyCount;
    const unluckyCount = allocation.unluckyCount;
    const taken = new Set();
    const lucky = [];
    const unlucky = [];
    while (lucky.length < luckyCount) {
      const n = _randomUniqueD100(taken);
      lucky.push(n);
      taken.add(n);
    }
    while (unlucky.length < unluckyCount) {
      const n = _randomUniqueD100(taken);
      unlucky.push(n);
      taken.add(n);
    }
    return { lucky, unlucky, luckyCount, unluckyCount };
  }

  function applySet(root, data) {
    luckyInputKeys.forEach((id, idx) => {
      const input = root.querySelector(`#${id}`);
      if (input) input.value = String(data.lucky[idx] ?? 0);
    });
    unluckyInputKeys.forEach((id, idx) => {
      const input = root.querySelector(`#${id}`);
      if (input) input.value = String(data.unlucky[idx] ?? 0);
    });
    const countEl = root.querySelector("#cgLuckCounts");
    if (countEl) countEl.textContent = `Lucky ${data.luckyCount} | Unlucky ${data.unluckyCount}`;
    state.rollTrace = data;
  }

  const result = await customDialog({
    title: "Lucky & Unlucky Numbers",
    width: 800,
    classes: ["uesrpg-cg-compact-dialog"],
    content: `<div class="uesrpg-cg-dialog">
      <div class="uesrpg-cg-dialog__note">
        RAW default: Lucky count = Luck bonus${allocation.thiefBonus ? " (+1 for Thief sign)" : ""}; Unlucky count = 5 - Luck bonus.
      </div>
      <div class="uesrpg-cg-dialog__tools">
        <button type="button" id="cgRollLucky">Roll RAW</button>
        <button type="button" id="cgManualLucky">Manual Edit</button>
        <span class="uesrpg-cg-dialog__small" id="cgLuckCounts">Lucky ${allocation.luckyCount} | Unlucky ${allocation.unluckyCount}</span>
      </div>
      <table class="uesrpg-cg-dialog__table">
        <tr><th colspan="6">Lucky Numbers</th></tr>
        <tr>
          <td><input class="luckyNum" id="ln1" type="number" min="1" max="100" value="${initialLuckyMap.ln1 || ""}"></td>
          <td><input class="luckyNum" id="ln2" type="number" min="1" max="100" value="${initialLuckyMap.ln2 || ""}"></td>
          <td><input class="luckyNum" id="ln3" type="number" min="1" max="100" value="${initialLuckyMap.ln3 || ""}"></td>
          <td><input class="luckyNum" id="ln4" type="number" min="1" max="100" value="${initialLuckyMap.ln4 || ""}"></td>
          <td><input class="luckyNum" id="ln5" type="number" min="1" max="100" value="${initialLuckyMap.ln5 || ""}"></td>
          <td><input class="luckyNum" id="ln6" type="number" min="1" max="100" value="${initialLuckyMap.ln6 || ""}"></td>
        </tr>
      </table>
      <table class="uesrpg-cg-dialog__table">
        <tr><th colspan="6">Unlucky Numbers</th></tr>
        <tr>
          <td><input class="unluckyNum" id="ul1" type="number" min="1" max="100" value="${initialUnluckyMap.ul1 || ""}"></td>
          <td><input class="unluckyNum" id="ul2" type="number" min="1" max="100" value="${initialUnluckyMap.ul2 || ""}"></td>
          <td><input class="unluckyNum" id="ul3" type="number" min="1" max="100" value="${initialUnluckyMap.ul3 || ""}"></td>
          <td><input class="unluckyNum" id="ul4" type="number" min="1" max="100" value="${initialUnluckyMap.ul4 || ""}"></td>
          <td><input class="unluckyNum" id="ul5" type="number" min="1" max="100" value="${initialUnluckyMap.ul5 || ""}"></td>
          <td><input class="unluckyNum" id="ul6" type="number" min="1" max="100" value="${initialUnluckyMap.ul6 || ""}"></td>
        </tr>
      </table>
    </div>`,
    yes: {
      label: "Submit",
      callback: async (html) => {
        const root = _resolveDialogRoot(html);
        if (!root) return null;
        const luckyNums = [...root.querySelectorAll(".luckyNum")].map((input) => _num(input.value, 0)).filter((n) => n > 0);
        const unluckyNums = [...root.querySelectorAll(".unluckyNum")].map((input) => _num(input.value, 0)).filter((n) => n > 0);

        const uniqueLucky = new Set(luckyNums);
        const uniqueUnlucky = new Set(unluckyNums);
        if (uniqueLucky.size !== luckyNums.length || uniqueUnlucky.size !== unluckyNums.length) {
          ui.notifications?.warn?.("Lucky/Unlucky numbers cannot contain duplicates.");
          return null;
        }
        for (const n of uniqueLucky) {
          if (uniqueUnlucky.has(n)) {
            ui.notifications?.warn?.("Lucky and Unlucky numbers cannot overlap.");
            return null;
          }
        }
        if ([...uniqueLucky, ...uniqueUnlucky].some((n) => n < 1 || n > 100)) {
          ui.notifications?.warn?.("Numbers must be between 1 and 100.");
          return null;
        }

        const updates = {};
        luckyInputKeys.forEach((id, idx) => { updates[`system.lucky_numbers.${id}`] = luckyNums[idx] ?? 0; });
        unluckyInputKeys.forEach((id, idx) => { updates[`system.unlucky_numbers.${id}`] = unluckyNums[idx] ?? 0; });
        await requestUpdateDocument(actor, updates);
        const savedActor = (await fromUuid(actor.uuid)) ?? actor;
        const resolvedAllocation = resolveLuckyUnluckyAllocation(savedActor, { clampNonNegativeBonus: true });
        return {
          ok: true,
          mode: state.mode,
          luckyNumbers: extractConfiguredLuckyNumbers(savedActor),
          unluckyNumbers: extractConfiguredUnluckyNumbers(savedActor),
          luckyCount: resolvedAllocation.luckyCount,
          unluckyCount: resolvedAllocation.unluckyCount,
          rollTrace: state.rollTrace,
        };
      },
    },
    no: { label: "Cancel", callback: () => null },
    defaultButton: "yes",
    render: (_event, html) => {
      const root = _resolveDialogRoot(html);
      if (!root) return;
      root.querySelector("#cgRollLucky")?.addEventListener("click", () => {
        state.mode = "roll";
        applySet(root, rollNumbers());
      });
      root.querySelector("#cgManualLucky")?.addEventListener("click", () => {
        state.mode = "manual";
      });
    },
  });

  return result?.ok ? result : null;
});
