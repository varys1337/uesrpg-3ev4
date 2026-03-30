/**
 * src/core/skills/opposed/dialogs.js
 * Skill roll dialog UI for opposed tests
 */

import { _esc } from "./util.js";
import { SKILL_DIFFICULTIES } from "../../skill-tn.js";
import { hasCondition } from "../../../conditions/condition-engine.js";
import { buildResistanceBonusSection, readResistanceBonusSelections } from "../../../traits/trait-resistance-ui.js";
import { hasTalent } from "../../../traits/talents-api.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { resolveUuidSync } from "../../../../utils/uuid-cache.js";
import { buildCircumstanceOptionsHtml } from "../../../opposed/circumstance.js";

export async function _skillRollDialog({
  title,
  actor = null,
  showSkillSelect = false,
  skills = [],
  selectedSkillUuid = null,
  allowSpecialization = false,
  defaultUseSpec = false,
  defaultDifficultyKey = "average",
  defaultCircumstanceMod = 0,
  defaultManualMod = 0,
  defaultSelectedCharacteristicKey = "",
  defaultApplyBlinded = true,
  defaultApplyDeafened = true
} = {}) {
  const skillSelect = showSkillSelect
    ? `
      <div class="form-group">
        <label><b>Skill</b></label>
        <select name="skillUuid" style="width:100%;">
          ${skills.map(s => {
            const sel = (s.uuid === selectedSkillUuid) ? "selected" : "";
            const hasSpec = s.hasSpec ? "1" : "0";
            const governing = Array.isArray(s.governingChaOptions) ? s.governingChaOptions : [];
            const governingData = _esc(JSON.stringify(governing));
            const selectedCha = _esc(String(s.selectedCha ?? ""));
            const optValue = _esc(s.uuid);
            const optLabel = _esc(s.name);
            return `<option value="${optValue}" data-has-spec="${hasSpec}" data-skill-name="${optLabel}" data-governing="${governingData}" data-selected-cha="${selectedCha}" ${sel}>${optLabel}</option>`;
          }).join("\n")}
        </select>
      </div>`
    : `<input type="hidden" name="skillUuid" value="${_esc(selectedSkillUuid ?? "")}" />`;

  const difficultyOptions = SKILL_DIFFICULTIES.map(d => {
    const sel = d.key === defaultDifficultyKey ? "selected" : "";
    const sign = d.mod >= 0 ? "+" : "";
    return `<option value="${d.key}" ${sel}>${d.label} (${sign}${d.mod})</option>`;
  }).join("\n");

  const specDisabled = !allowSpecialization;
  const specChecked = (!specDisabled && defaultUseSpec) ? "checked" : "";
  const specRow = `
      <div class="form-group" style="margin-top:8px;">
        <label style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" name="useSpec" ${specChecked} ${specDisabled ? "disabled" : ""} />
          <span><b>Use Specialization</b> (+10)${specDisabled ? ' <span style="opacity:0.75;">(none on this skill)</span>' : ""}</span>
        </label>
      </div>`;

  const selectedSkillMeta = (() => {
    const found = Array.isArray(skills) ? skills.find(s => String(s?.uuid ?? "") === String(selectedSkillUuid ?? "")) : null;
    return found ?? null;
  })();
  const selectedGoverning = Array.isArray(selectedSkillMeta?.governingChaOptions) ? selectedSkillMeta.governingChaOptions : [];
  const selectedBaseCha = String(selectedSkillMeta?.selectedCha ?? "").trim().toLowerCase();
  const showCharacteristic = selectedGoverning.length > 0;
  const defaultCharacteristic = String(defaultSelectedCharacteristicKey || selectedBaseCha || selectedGoverning[0]?.key || "").toLowerCase();
  const characteristicRow = `
      <div class="form-group" style="margin-top:8px;" data-ues-char-row="1" ${showCharacteristic ? "" : "hidden"}>
        <label><b>Characteristic</b></label>
        <select name="selectedCharacteristicKey" style="width:100%;">
          ${selectedGoverning.map(o => {
            const k = String(o?.key ?? "");
            const l = _esc(String(o?.label ?? k.toUpperCase()));
            const selected = (k === defaultCharacteristic) ? "selected" : "";
            return `<option value="${_esc(k)}" ${selected}>${l}</option>`;
          }).join("\n")}
        </select>
      </div>`;

  const canInterrogate = Boolean(actor && hasTalent(actor, "interrogator"));
  const canHistskin = Boolean(actor && hasTalent(actor, "histskin"));
  const selectedName = (() => {
    const byList = Array.isArray(skills) ? (skills.find(s => String(s?.uuid ?? "") === String(selectedSkillUuid ?? ""))?.name ?? null) : null;
    if (byList) return String(byList);
    if (!showSkillSelect && selectedSkillUuid && !String(selectedSkillUuid).startsWith("prof:")) {
      const doc = resolveUuidSync(String(selectedSkillUuid));
      return String(doc?.name ?? "");
    }
    return "";
  })();
  const isPersuadeSelected = String(selectedName ?? "").trim().toLowerCase() === "persuade";
  const isHistskinEligible = canHistskin && ["athletics", "stealth"].includes(String(selectedName ?? "").trim().toLowerCase());
  const interrogationDisabled = !canInterrogate || !isPersuadeSelected;
  const interrogationRow = canInterrogate ? `
      <div class="form-group" style="margin-top:8px;" data-ues-interrogation-row="1">
        <label style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" name="isInterrogationTest" ${interrogationDisabled ? "disabled" : ""} />
          <span><b>Interrogation</b> (Interrogator talent)</span>
        </label>
      </div>` : "";

  const histskinRow = canHistskin ? `
      <div class="form-group" style="margin-top:8px;" data-ues-histskin-row="1">
        <label style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" name="histskinUnderwater" ${isHistskinEligible ? "" : "disabled"} />
          <span><b>Histskin</b> (Underwater) +30</span>
        </label>
      </div>` : "";
  const resistanceSection = buildResistanceBonusSection(actor);
  const hasBlinded = actor ? hasCondition(actor, "blinded") : false;
  const hasDeafened = actor ? hasCondition(actor, "deafened") : false;

  const sensoryRow = (hasBlinded || hasDeafened) ? `
      <div class="uesrpg-defense-flags">
        <span class="uesrpg-defense-flags__label">Apply if relevant:</span>
        <div class="uesrpg-defense-flags__items">
          ${hasBlinded ? '<label class="uesrpg-inline-check"><input type="checkbox" name="applyBlinded" ' + (defaultApplyBlinded ? 'checked' : '') + '/> <span>Blinded (-30, sight-based)</span></label>' : ''}
          ${hasDeafened ? '<label class="uesrpg-inline-check"><input type="checkbox" name="applyDeafened" ' + (defaultApplyDeafened ? 'checked' : '') + '/> <span>Deafened (-30, hearing-based)</span></label>' : ''}
        </div>
      </div>
      <p class="uesrpg-sensory-hint">RAW: apply only if the test benefits from the relevant sense.</p>` : "";


  const content = `
    <div class="uesrpg-skill-declare">
      ${skillSelect}

      <div class="form-group">
        <label><b>Difficulty</b></label>
        <select name="difficultyKey" style="width:100%;">${difficultyOptions}</select>
      </div>

      <div class="form-group">
        <label><b>Circumstance Modifier</b></label>
        <select name="circumstanceMod" style="width:100%;">${buildCircumstanceOptionsHtml(defaultCircumstanceMod)}</select>
      </div>

      ${specRow}
      ${characteristicRow}

      ${interrogationRow}

      ${histskinRow}

      ${sensoryRow}

      ${resistanceSection.html}

      <div class="form-group" style="margin-top:8px;">
        <label><b>Manual Modifier</b></label>
        <input name="manualMod" type="number" value="${Number(defaultManualMod) || 0}" style="width:100%;" />
      </div>
    </div>`;

  // Render callback: toggle specialization / interrogation / histskin
  // checkbox availability when choosing a different skill.
  // (Inline <script> tags do not execute when inserted via innerHTML in
  // DialogV2, so we use customDialog's `render` callback instead.)
  const renderCallback = showSkillSelect ? (_event, dialogEl) => {
    const root = dialogEl instanceof HTMLElement ? dialogEl : dialogEl?.element ?? dialogEl;
    const form = root?.querySelector('.uesrpg-skill-declare') ?? root;
    const sel = form?.querySelector('select[name="skillUuid"]');
    const cb = form?.querySelector('input[name="useSpec"]');
    const label = cb?.closest('label');
    const interrogationCb = form?.querySelector('input[name="isInterrogationTest"]');
    const histskinCb = form?.querySelector('input[name="histskinUnderwater"]');
    const chaRow = form?.querySelector('[data-ues-char-row="1"]');
    const chaSelect = form?.querySelector('select[name="selectedCharacteristicKey"]');
    const mkOption = (value, text, selected = false) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      if (selected) opt.selected = true;
      return opt;
    };
    function sync() {
      if (!sel || !cb) return;
      const opt = sel.options[sel.selectedIndex];
      const has = (opt?.dataset?.hasSpec === '1');
      cb.disabled = !has;
      if (!has) cb.checked = false;
      if (label) {
        label.querySelectorAll('span[data-spec-none]').forEach(n => n.remove());
        if (!has) {
          const s = document.createElement('span');
          s.dataset.specNone = '1';
          s.style.opacity = '0.75';
          s.textContent = ' (none on this skill)';
          label.appendChild(s);
        }
      }

      if (interrogationCb) {
        const name = String(opt?.dataset?.skillName ?? '').trim().toLowerCase();
        const isPersuade = (name === 'persuade');
        interrogationCb.disabled = !isPersuade;
        if (!isPersuade) interrogationCb.checked = false;
      }

      if (histskinCb) {
        const name = String(opt?.dataset?.skillName ?? '').trim().toLowerCase();
        const ok = (name === 'athletics' || name === 'stealth');
        histskinCb.disabled = !ok;
        if (!ok) histskinCb.checked = false;
      }

      if (chaRow && chaSelect) {
        const governingRaw = String(opt?.dataset?.governing ?? "[]");
        let governing = [];
        try { governing = JSON.parse(governingRaw); } catch (_e) { governing = []; }
        const options = Array.isArray(governing) ? governing.filter(g => g?.key && g?.label) : [];
        if (options.length > 0) {
          chaRow.hidden = false;
          const current = String(chaSelect.value ?? "").trim().toLowerCase();
          const preferred = String(opt?.dataset?.selectedCha ?? "").trim().toLowerCase();
          chaSelect.innerHTML = "";
          let hasCurrent = false;
          for (const g of options) {
            const k = String(g.key).toLowerCase();
            const labelText = String(g.label);
            const selected = (!hasCurrent && current && current === k) || (!current && preferred === k);
            if (selected) hasCurrent = true;
            chaSelect.appendChild(mkOption(k, labelText, selected));
          }
          if (!hasCurrent && options[0]?.key) chaSelect.value = String(options[0].key).toLowerCase();
        } else {
          chaRow.hidden = true;
          chaSelect.innerHTML = "";
        }
      }
    }
    sel?.addEventListener('change', sync);
    sync();
  } : undefined;

  try {
    const result = await customDialog({
      title,
      content,
      render: renderCallback,
      classes: ["uesrpg-attack-declare"],
      buttons: {
        ok: {
          label: "Roll",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const skillUuid = root?.querySelector('select[name="skillUuid"]')?.value
              ?? root?.querySelector('input[name="skillUuid"]')?.value
              ?? "";
            const selectedCharacteristicKey = String(root?.querySelector('select[name="selectedCharacteristicKey"]')?.value ?? "").trim().toLowerCase();
            const difficultyKey = root?.querySelector('select[name="difficultyKey"]')?.value ?? "average";
            const circumstanceMod = Number.parseInt(String(root?.querySelector('select[name="circumstanceMod"]')?.value ?? "0"), 10) || 0;
            const useSpec = Boolean(root?.querySelector('input[name="useSpec"]')?.checked);
            const isInterrogationTest = Boolean(root?.querySelector('input[name="isInterrogationTest"]')?.checked);
            const histskinUnderwater = Boolean(root?.querySelector('input[name="histskinUnderwater"]')?.checked);
            const applyBlinded = Boolean(root?.querySelector('input[name="applyBlinded"]')?.checked);
            const applyDeafened = Boolean(root?.querySelector('input[name="applyDeafened"]')?.checked);
            const selectedRes = readResistanceBonusSelections(root, resistanceSection.options);

            const rawManual = root?.querySelector('input[name="manualMod"]')?.value ?? "0";
            const manualMod = Number.parseInt(String(rawManual), 10) || 0;
            return { skillUuid, selectedCharacteristicKey, difficultyKey, circumstanceMod, useSpec, manualMod, applyBlinded, applyDeafened, resistanceSelected: selectedRes, isInterrogationTest, histskinUnderwater };
          }
        },
        cancel: { label: "Cancel", callback: () => null }
      },
      default: "ok",
      width: 420
    });
    return result ?? null;
  } catch (_e) {
    return null;
  }
}


