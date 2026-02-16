/**
 * src/utils/dev/spell-audit.js
 *
 * GM spell pack audit utility for validating compendium spell quality.
 * Detects missing/invalid metadata across all spells in a pack.
 *
 * Target: Foundry VTT v13.351
 */

import { validateScalingLevels } from "../../core/magic/spell-config.js";
import { customDialog } from "../dialog-v2-helper.js";

/**
 * Audit spell pack for missing/invalid metadata.
 * 
 * @param {string} packName - Compendium pack name (e.g., "uesrpg-3ev4.spells-revised")
 * @returns {Promise<object>} - Audit report
 */
export async function auditSpellPack(packName) {
  const pack = game.packs.get(packName);
  if (!pack || pack.documentName !== "Item") {
    return { error: `Pack ${packName} not found or not an Item pack.` };
  }
  
  const allDocs = await pack.getDocuments();
  const spells = allDocs.filter(doc => doc.type === "spell");
  
  const report = {
    packName,
    totalSpells: spells.length,
    issues: []
  };
  
  for (const spell of spells) {
    const issues = _auditSpell(spell);
    if (issues.errors.length > 0 || issues.warnings.length > 0) {
      report.issues.push({ 
        spell: spell.name, 
        id: spell.id, 
        ...issues 
      });
    }
  }
  
  return report;
}

/**
 * Audit a single spell for issues.
 * @param {Item} spell
 * @returns {{errors: string[], warnings: string[]}}
 */
function _auditSpell(spell) {
  const errors = [];
  const warnings = [];
  
  // Check 1: School metadata
  if (!spell.system.school || spell.system.school === "") {
    errors.push("Missing school");
  }
  
  // Check 2: Type metadata (Attack/Direct/Healing)
  if (!spell.system.type || spell.system.type === "") {
    errors.push("Missing type");
  }
  
  // Check 3: Form metadata (Conventional/Unconventional)
  if (!spell.system.form || spell.system.form === "") {
    warnings.push("Missing form (defaults to Conventional)");
  }
  
  // Check 4: Attack spells should have damage formula
  if (spell.system.type === "Attack" && (!spell.system.damage?.formula || spell.system.damage.formula === "")) {
    errors.push("Attack spell missing damageFormula");
  }
  
  // Check 5: Healing spells should have damageFormula (used for healing amount)
  if (spell.system.type === "Healing" && (!spell.system.damage?.formula || spell.system.damage.formula === "")) {
    warnings.push("Healing spell missing damageFormula (healing amount)");
  }
  
  // Check 6: Upkeep spells should have duration
  if (spell.system.hasUpkeep && (!spell.system.duration?.unit || spell.system.duration.unit === "instant")) {
    errors.push("Upkeep spell has instant duration (invalid)");
  }
  
  // Check 7: AoE spells should have shape/size
  if (spell.system.rangeType === "aoe") {
    if (!spell.system.aoeShape || spell.system.aoeShape === "") {
      errors.push("AoE spell missing aoeShape");
    }
    if (!spell.system.aoeSize || spell.system.aoeSize <= 0) {
      errors.push("AoE spell missing or invalid aoeSize");
    }
  }
  
  // Check 8: Scaling levels validation
  if (spell.system.scaling?.levels && spell.system.scaling.levels.length > 0) {
    const scalingResult = validateScalingLevels(spell.system.scaling.levels, {
      spellHasDamage: Boolean(spell.system.damage?.formula),
      baseDurationUnit: spell.system.duration?.unit
    });
    if (!scalingResult.valid) {
      errors.push(...scalingResult.errors.map(e => `Scaling: ${e}`));
    }
    if (scalingResult.warnings.length > 0) {
      warnings.push(...scalingResult.warnings.map(w => `Scaling: ${w}`));
    }
  }
  
  // Check 9: Cost >= 0
  const cost = Number(spell.system.cost);
  if (!Number.isFinite(cost) || cost < 0) {
    errors.push("Invalid cost (must be >= 0)");
  }
  
  // Check 10: Level 1-7
  const level = Number(spell.system.level);
  if (!Number.isFinite(level) || level < 1 || level > 7) {
    errors.push("Invalid level (must be 1-7)");
  }
  
  return { errors, warnings };
}

/**
 * Display spell audit report in a dialog.
 * @param {string} packName - Compendium pack name
 */
export async function showSpellAuditReport(packName) {
  const report = await auditSpellPack(packName);
  
  if (report.error) {
    ui.notifications.error(report.error);
    return;
  }
  
  const issueCount = report.issues.length;
  const errorCount = report.issues.reduce((sum, i) => sum + i.errors.length, 0);
  const warningCount = report.issues.reduce((sum, i) => sum + i.warnings.length, 0);
  
  const content = `
    <h3>Spell Pack Audit: ${report.packName}</h3>
    <p><strong>Total Spells:</strong> ${report.totalSpells}</p>
    <p><strong>Spells with Issues:</strong> ${issueCount}</p>
    <p><strong>Errors:</strong> ${errorCount} | <strong>Warnings:</strong> ${warningCount}</p>
    <hr/>
    ${issueCount > 0 ? `
      <div style="max-height: 400px; overflow-y: auto;">
        <table style="width:100%; font-size:0.9em; border-collapse: collapse;">
          <thead style="position: sticky; top: 0; background: #000; z-index: 1;">
            <tr>
              <th style="padding: 4px; border: 1px solid #555; text-align: left;">Spell</th>
              <th style="padding: 4px; border: 1px solid #555; text-align: left;">Errors</th>
              <th style="padding: 4px; border: 1px solid #555; text-align: left;">Warnings</th>
            </tr>
          </thead>
          <tbody>
            ${report.issues.map(issue => `
              <tr>
                <td style="padding: 4px; border: 1px solid #555;">${issue.spell}</td>
                <td style="padding: 4px; border: 1px solid #555; color: #ff6b6b;">
                  ${issue.errors.length > 0 ? issue.errors.join('<br/>') : '—'}
                </td>
                <td style="padding: 4px; border: 1px solid #555; color: #ffa500;">
                  ${issue.warnings.length > 0 ? issue.warnings.join('<br/>') : '—'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : '<p style="color: #4caf50; font-weight: bold;">✓ No issues found!</p>'}
  `;
  
  customDialog({
    title: "Spell Audit Report",
    content,
    buttons: {
      export: {
        icon: "fas fa-download",
        label: "Export JSON",
        callback: () => {
          const json = JSON.stringify(report, null, 2);
          const blob = new Blob([json], { type: "application/json" });
          saveDataToFile(blob, "text/json", `spell-audit-${Date.now()}.json`);
        }
      },
      close: {
        icon: "fas fa-times",
        label: "Close"
      }
    },
    default: "close",
    width: 800,
  });
}
