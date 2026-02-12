/**
 * src/core/skills/opposed/dialogs.js
 * Skill roll dialog UI for opposed tests
 */

import { _esc } from "./util.js";
import { SKILL_DIFFICULTIES } from "../skill-tn.js";
import { hasCondition } from "../../conditions/condition-engine.js";
import { buildResistanceBonusSection, readResistanceBonusSelections } from "../../traits/trait-resistance-ui.js";
import { hasTalent } from "../../traits/talents-api.js";

export async function _skillRollDialog({
  title,
  actor = null,
  showSkillSelect = false,
  skills = [],
  selectedSkillUuid = null,
  allowSpecialization = false,
  defaultUseSpec = false,
  defaultDifficultyKey = "average",
  defaultManualMod = 0,
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
            const optValue = _esc(s.uuid);
            const optLabel = _esc(s.name);
            return `<option value="${optValue}" data-has-spec="${hasSpec}" data-skill-name="${optLabel}" ${sel}>${optLabel}</option>`;
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

  const canInterrogate = Boolean(actor && hasTalent(actor, "interrogator"));
  const canHistskin = Boolean(actor && hasTalent(actor, "histskin"));
  const selectedName = (() => {
    const byList = Array.isArray(skills) ? (skills.find(s => String(s?.uuid ?? "") === String(selectedSkillUuid ?? ""))?.name ?? null) : null;
    if (byList) return String(byList);
    if (!showSkillSelect && selectedSkillUuid && !String(selectedSkillUuid).startsWith("prof:")) {
      try {
        const doc = fromUuidSync(String(selectedSkillUuid));
        return String(doc?.name ?? "");
      } catch (_e) {
        return "";
      }
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
      <div class="form-group" style="margin-top:8px;">
        <label><b>Sensory Impairment</b></label>
        <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
          ${hasBlinded ? '<label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" name="applyBlinded" ' + (defaultApplyBlinded ? 'checked' : '') + '/> <span>Apply Blinded (-30, sight-based)</span></label>' : ''}
          ${hasDeafened ? '<label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" name="applyDeafened" ' + (defaultApplyDeafened ? 'checked' : '') + '/> <span>Apply Deafened (-30, hearing-based)</span></label>' : ''}
        </div>
        <p style="opacity:0.8; font-size:12px; margin-top:6px;">RAW: apply only if the test benefits from the relevant sense.</p>
      </div>` : "";


  const content = `
    <form class="uesrpg-skill-declare">
      ${skillSelect}

      <div class="form-group">
        <label><b>Difficulty</b></label>
        <select name="difficultyKey" style="width:100%;">${difficultyOptions}</select>
      </div>

      ${specRow}

      ${interrogationRow}

      ${histskinRow}

      ${sensoryRow}

      ${resistanceSection.html}

      <div class="form-group" style="margin-top:8px;">
        <label><b>Manual Modifier</b></label>
        <input name="manualMod" type="number" value="${Number(defaultManualMod) || 0}" style="width:100%;" />
      </div>
    </form>`;

  // Inline helper: toggle specialization checkbox availability when choosing a different skill.
  const withScript = showSkillSelect ? `${content}
    <script>
      (function(){
        const dialog = document.currentScript?.closest('.dialog') || document;
        const form = dialog.querySelector('form.uesrpg-skill-declare');
        const sel = form?.querySelector('select[name="skillUuid"]');
        const cb = form?.querySelector('input[name="useSpec"]');
        const label = cb?.closest('label');
        const interrogationRow = form?.querySelector('[data-ues-interrogation-row="1"]');
        const interrogationCb = form?.querySelector('input[name="isInterrogationTest"]');
        const histskinRow = form?.querySelector('[data-ues-histskin-row="1"]');
        const histskinCb = form?.querySelector('input[name="histskinUnderwater"]');
        function sync(){
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

          if (interrogationRow && interrogationCb) {
            const name = String(opt?.dataset?.skillName ?? '').trim().toLowerCase();
            const isPersuade = (name === 'persuade');
            interrogationCb.disabled = !isPersuade;
            if (!isPersuade) interrogationCb.checked = false;
          }

          if (histskinRow && histskinCb) {
            const name = String(opt?.dataset?.skillName ?? '').trim().toLowerCase();
            const ok = (name === 'athletics' || name === 'stealth');
            histskinCb.disabled = !ok;
            if (!ok) histskinCb.checked = false;
          }
        }
        sel?.addEventListener('change', sync);
        sync();
      })();
    </script>` : content;

  try {
    const result = await Dialog.wait({
      title,
      content: withScript,
      buttons: {
        ok: {
          label: "Roll",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const skillUuid = root?.querySelector('select[name="skillUuid"]')?.value
              ?? root?.querySelector('input[name="skillUuid"]')?.value
              ?? "";
            const difficultyKey = root?.querySelector('select[name="difficultyKey"]')?.value ?? "average";
            const useSpec = Boolean(root?.querySelector('input[name="useSpec"]')?.checked);
            const isInterrogationTest = Boolean(root?.querySelector('input[name="isInterrogationTest"]')?.checked);
            const histskinUnderwater = Boolean(root?.querySelector('input[name="histskinUnderwater"]')?.checked);
            const applyBlinded = Boolean(root?.querySelector('input[name="applyBlinded"]')?.checked);
            const applyDeafened = Boolean(root?.querySelector('input[name="applyDeafened"]')?.checked);
            const selectedRes = readResistanceBonusSelections(root, resistanceSection.options);

            const rawManual = root?.querySelector('input[name="manualMod"]')?.value ?? "0";
            const manualMod = Number.parseInt(String(rawManual), 10) || 0;
            return { skillUuid, difficultyKey, useSpec, manualMod, applyBlinded, applyDeafened, resistanceSelected: selectedRes, isInterrogationTest, histskinUnderwater };
          }
        },
        cancel: { label: "Cancel", callback: () => null }
      },
      default: "ok"
    }, { width: 420 });
    return result ?? null;
  } catch (_e) {
    return null;
  }
}
