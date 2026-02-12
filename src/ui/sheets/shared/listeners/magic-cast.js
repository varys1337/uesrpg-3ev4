/**
 * Magic casting handlers shared across sheets.
 * 
 * Extracted from actor-sheet.js for better maintainability.
 * Foundry VTT v13 / AppV1-compatible.
 */

import { getUserSpellTargets, shouldUseTargetedSpellWorkflow, shouldUseModernSpellWorkflow, classifySpellForRouting, debugMagicRoutingLog } from "../../../../core/magic/spell-runtime.js";
import { filterTargetsBySpellRange, getSpellRangeType, getSpellAoEConfig, getSpellMaxRangeMeters } from "../../../../core/magic/spell-range.js";
import { AoEService, AOE_SOURCE_TYPES } from "../../../../core/aoe/index.js";
import { getSpellScalingLevels } from "../../../../core/magic/magicka-utils.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "../../../../core/skills/skill-tn.js";
import { resolveSpellProfile } from "../../../../core/magic/spell-profile.js";

/**
 * Resolve a token for range-gated spells.
 * @param {Actor} actor
 * @returns {Token|null}
 */
function resolveRangeGatedTokenForActor(actor) {
  let token = canvas.tokens?.controlled?.find(t => t.actor?.id === actor.id) ?? null;
  if (!token) token = actor.getActiveTokens?.()?.[0] ?? null;
  return token;
}

/**
 * Handle Cast Magic button click.
 * Shows spell picker, then routes to attack spell workflow or existing spell dialog.
 * @param {SimpleActorSheet} sheet - The actor sheet instance
 * @param {Event} event - The triggering event (optional if preselectedSpell provided)
 * @param {Item} preselectedSpell - Pre-selected spell to cast (optional)
 */
export async function onCastMagicAction(sheet, event, preselectedSpell = null) {
  const actor = sheet.actor;
  const castActionType = String(event?.currentTarget?.dataset?.actionType ?? "primary");

  // AP pre-check helper: only gate paths that consume resources immediately (direct,
  // unopposed).  For the opposed/targeted workflow AP is validated at commit/roll
  // time so card creation is never blocked by low AP.
  const _preCheckAP = () => {
    const requiredAP = 1;
    const ap = Number(actor?.system?.action_points?.value ?? 0);
    if (ap < requiredAP) {
      ui.notifications.warn(
        `Insufficient Action Points to cast magic. Required: ${requiredAP} AP, Available: ${ap} AP.`
      );
      return false;
    }
    return true;
  };

  // NOTE: Early-targets bypass removed. Always show the spell picker so ALL spell
  // types (attack, direct, healing, utility) remain accessible. Routing happens
  // after the user picks a spell, based on spell classification + available targets.

  let spell = preselectedSpell;
    
  // If no spell provided, show picker
  if (!spell) {
    const spellsAll = actor.itemTypes?.spell ?? [];
    const spells = (castActionType === "secondary")
      ? spellsAll.filter(s => s?.system?.isInstant === true)
      : spellsAll;
    
    if (!spells.length) {
      ui.notifications.warn(castActionType === "secondary" ? "No Instant spells available to cast as a Secondary action." : "No spells available to cast.");
      return;
    }
    
    const spellOptions = spells.map(s => 
      `<option value="${s.id}">${s.name} (${s.system.school} L${s.system.level}, ${s.system.cost} MP)</option>`
    ).join("");
    
    const content = `
      <form class="uesrpg-cast-magic-form">
        <div class="form-group">
          <label><b>Select Spell to Cast</b></label>
          <select name="spellId" style="width:100%;">${spellOptions}</select>
        </div>
      </form>`;
    
    const selectedSpellId = await Dialog.wait({
      title: castActionType === "secondary" ? "Cast Magic (Instant)" : "Cast Magic",
      content,
      buttons: {
        cast: {
          label: "Cast",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            return root?.querySelector('select[name="spellId"]')?.value;
          }
        },
        cancel: { label: "Cancel", callback: () => null }
      },
      default: "cast"
    }, { width: 360 });
    
    if (!selectedSpellId) return;
    
    spell = actor.items.get(selectedSpellId);
    if (!spell) return;
  }
  
  // Centralized routing
  const targets = getUserSpellTargets();
  debugMagicRoutingLog({ source: "onCastMagicAction", actor, spell, targets });
  
  // Range gating and AoE template placement
  const rangeType = getSpellRangeType(spell);
  const attackerToken = sheet.token?.object ?? sheet.token ?? resolveRangeGatedTokenForActor(actor);

  // Detect AoE from the spell's AoE config fields, regardless of rangeType.
  // Many AoE spells (Fire Ball, Cone, Storm…) use rangeType="ranged" for max-range gating
  // but still need AoE template placement via aoeShape + aoeSize.
  const aoeSpec = getSpellAoEConfig(spell);
  const hasValidAoe = aoeSpec && (aoeSpec.sizeMeters > 0 || aoeSpec.pulse);

  if ((rangeType === "ranged" || rangeType === "melee" || rangeType === "aoe" || hasValidAoe) && !attackerToken) {
    ui.notifications.warn("You must have an active token selected to cast this spell (range-gated).");
    return;
  }

  let workingTargets = Array.from(targets ?? []);
  let aoeTemplateUuid = null;
  let aoeTemplateId = null;

  if (hasValidAoe) {
    const maxRange = getSpellMaxRangeMeters(spell);
    const placed = await AoEService.place({
      sourceType: AOE_SOURCE_TYPES.SPELL,
      actor,
      token: attackerToken,
      item: spell,
      aoe: {
        shape: aoeSpec?.shape ?? "circle",
        distance: aoeSpec.sizeMeters || 1,
        width: aoeSpec?.widthMeters,
        pulse: Boolean(aoeSpec?.pulse),
        includeCaster: Boolean(aoeSpec?.includeCaster ?? spell?.system?.aoeIncludeCaster),
      },
      options: { maxRange: maxRange ?? undefined, collectTargets: true },
    });
    if (!placed) return;
    aoeTemplateId = placed.templateId ?? null;
    aoeTemplateUuid = placed.templateUuid ?? null;

    if (placed.targets?.length) workingTargets = placed.targets;
    if (!workingTargets.length) {
      ui.notifications?.info?.("No tokens are affected by the spell template.");
      workingTargets = [];
    }
  } else if (rangeType === "ranged" || rangeType === "melee") {
    if (workingTargets.length) {
      const res = filterTargetsBySpellRange({
        casterToken: attackerToken,
        targets: workingTargets,
        spell
      }) ?? {};

      const validTargets = Array.isArray(res.validTargets) ? res.validTargets : [];
      const rejected = Array.isArray(res.rejected) ? res.rejected : [];
      const maxRange = Number.isFinite(Number(res.maxRange)) ? Number(res.maxRange) : null;

      if (rejected.length) {
        const names = rejected
          .map(r => `${r.token?.name ?? "?"} (${Math.round((r.distance ?? 0) * 10) / 10}m)`) 
          .join(", ");
        ui.notifications.warn(`Out of range: ${names}${maxRange ? ` (max ${maxRange}m)` : ""}.`);
      }

      workingTargets = validTargets;
      if (!workingTargets.length) return;
    }
  }

  const spellCls = classifySpellForRouting(spell);

  if (spellCls.isDirect && !spellCls.isCharacteristicDefense && workingTargets.length > 0) {
    // Direct spells resolve immediately per-target (no opposed defense step).
    // EXCEPT characteristic defense spells which need chat cards.
    // Gate AP here — direct path consumes resources immediately.
    if (!_preCheckAP()) return;
    const spellOpts = await showSpellOptionsDialog(actor, spell);
    if (spellOpts === null) return;
    const { MagicOpposedWorkflow } = await import("../../../../core/magic/opposed-workflow.js");
    for (const target of workingTargets) {
      const defUuid = target?.document?.uuid ?? target?.uuid;
      await MagicOpposedWorkflow.castDirectTargeted({
        attackerTokenUuid: attackerToken?.document?.uuid ?? attackerToken?.uuid ?? null,
        attackerActorUuid: actor.uuid,
        defenderTokenUuid: defUuid,
        spellUuid: spell.uuid,
        spellOptions: spellOpts,
        castActionType
      });
    }
  } else if (shouldUseTargetedSpellWorkflow(spell, workingTargets)) {
    // Characteristic defense spells must NOT defer spell choice — the spell
    // must be known at card-creation so defender entries get defenseType/label.
    const isCharDef = spellCls.isCharacteristicDefense;
    let spellOpts = null;
    if (isCharDef) {
      spellOpts = await showSpellOptionsDialog(actor, spell);
      if (spellOpts === null) return;
    }
    await castAttackSpell(sheet, spell, workingTargets, spellOpts, castActionType, {
      aoeTemplateUuid,
      aoeTemplateId,
      deferSpellChoice: !isCharDef
    });
  } else if (shouldUseModernSpellWorkflow(spell)) {
    // Gate AP here — unopposed path consumes resources immediately.
    if (!_preCheckAP()) return;
    const spellOptions = await showSpellOptionsDialog(actor, spell);
    if (spellOptions === null) return;
    const { MagicOpposedWorkflow } = await import("../../../../core/magic/opposed-workflow.js");
    await MagicOpposedWorkflow.castUnopposed({
      attackerActorUuid: actor.uuid,
      attackerTokenUuid: sheet.token?.document?.uuid ?? sheet.token?.uuid ?? null,
      spellUuid: spell.uuid,
      spellOptions,
      castActionType
    });
  } else {
    // Non-attack or no target -> use existing spell dialog
    const fakeEvent = { currentTarget: { closest: () => ({ dataset: { itemId: spell.id } }) } };
    await sheet._onSpellRoll.call(sheet, fakeEvent);
  }
}

/**
 * Show spell options dialog for Restraint/Overload
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {Promise<object|null>}
 */
export async function showSpellOptionsDialog(actor, spell) {
  
  const wpBonus = Math.floor(Number(actor.system?.characteristics?.wp?.total ?? 0) / 10);
  const hasOverload = Boolean(spell.system?.hasOverload);
  const hasOverchargeTalent = actor.items?.some(i => i.type === "talent" && i.name === "Overcharge") ?? false;
  const hasMagickaCyclingTalent = actor.items?.some(i => i.type === "talent" && i.name === "Magicka Cycling") ?? false;
  const baseCost = Number(spell.system?.cost ?? 0);
  const baseLevel = spell.system?.level ?? 1;
  
  const allScalingLevels = getSpellScalingLevels(spell);
  const scalingLevels = (Array.isArray(allScalingLevels) ? allScalingLevels : [])
    .filter(entry => {
      if (!entry || typeof entry !== "object") return false;
      const lvl = Number(entry.level ?? 0);
      return Number.isFinite(lvl) && lvl > 0;
    });
  
  const hasScaling = scalingLevels.length > 0;
  
  const content = `
    <form class="uesrpg-spell-options">
      <h3>${spell.name}</h3>
      <div class="form-group">
        <label>Base MP Cost: <b>${baseCost}</b></label>
      </div>
      ${hasScaling ? `
      <div class="form-group" style="margin-bottom:8px; margin-top:8px;">
        <label style="display:block;"><b>Cast at Level</b></label>
        <select name="castLevel" id="castLevelSelect" style="width:100%;">
          <option value="base">Base (Level ${baseLevel}, ${baseCost} MP)</option>
          ${scalingLevels.map((entry, idx) => {
            const lvl = entry.level ?? 1;
            const cost = entry.cost ?? baseCost;
            const dmg = entry.damageFormula ? `, ${entry.damageFormula}` : '';
            const desc = entry.description ? ` — ${entry.description}` : '';
            return `<option value="${lvl}" data-scaling-index="${idx}">Level ${lvl} (${cost} MP${dmg})${desc}</option>`;
          }).join('')}
        </select>
      </div>
      <div id="profilePreview" class="form-group" style="background:#f0f0f0; padding:8px; border-radius:4px; font-size:0.9em;">
        <strong>Profile Preview:</strong><br/>
        <span id="previewCost">Cost: ${baseCost} MP</span><br/>
        <span id="previewDamage">Damage: ${spell.system.damageFormula || 'N/A'}</span><br/>
        <span id="previewDuration">Duration: ${spell.system.duration?.value || 0} ${spell.system.duration?.unit || 'instant'}</span>
      </div>` : ''}
      <div class="form-group" style="margin-bottom:8px; margin-top:8px;">
        <label style="display:block;"><b>Difficulty</b></label>
        <select name="difficultyKey" style="width:100%;">
          ${SKILL_DIFFICULTIES.map(df => {
            const sign = df.mod >= 0 ? "+" : "";
            const sel = df.key === "average" ? "selected" : "";
            return `<option value="${df.key}" ${sel}>${df.label} (${sign}${df.mod})</option>`;
          }).join("\n")}
        </select>
      </div>
      <div class="form-group" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <label style="margin:0;"><b>Manual Modifier</b></label>
        <input type="number" name="manualModifier" value="0" style="width:120px; text-align:center;" />
      </div>
      <hr style="margin: 10px 0;"/>
      <div class="form-group" id="restrainGroup" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="restrain" id="restrainCheckbox" ${!hasOverload ? 'checked' : ''} />
          <span><b>Spell Restraint</b> (reduce cost by ${wpBonus} to min 1)</span>
        </label>
      </div>
      ${hasOverload ? `
      <div class="form-group" id="overloadGroup" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="overload" id="overloadCheckbox" />
          <span><b>Overload</b> (${spell.system.overloadEffect || 'double cost for enhanced effect'})</span>
        </label>
      </div>` : ''}
      ${hasOverchargeTalent ? `
      <div class="form-group" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="overcharge" />
          <span><b>Overcharge</b> (talent option; not yet implemented)</span>
        </label>
      </div>` : ''}
      ${hasMagickaCyclingTalent ? `
      <div class="form-group" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="magickaCycling" />
          <span><b>Magicka Cycling</b> (talent option; not yet implemented)</span>
        </label>
      </div>` : ''}
    </form>
  `;
  
  return new Promise((resolve) => {
    const dialog = new Dialog({
      title: "Spell Options",
      content,
      buttons: {
        cast: {
          label: "Cast",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const form = root?.querySelector("form");

            const difficultyKey = String(form?.difficultyKey?.value ?? "average");
            const manualModifierRaw = form?.manualModifier?.value ?? "0";
            const manualModifier = Number.parseInt(String(manualModifierRaw ?? "0"), 10) || 0;
            const castLevelRaw = form?.castLevel?.value ?? "base";
            const castLevel = hasScaling && castLevelRaw !== "base" ? (Number.parseInt(String(castLevelRaw), 10) || null) : null;
            
            resolve({
              isRestrained: form?.restrain?.checked ?? false,
              isOverloaded: form?.overload?.checked ?? false,
              useOvercharge: form?.overcharge?.checked ?? false,
              useMagickaCycling: form?.magickaCycling?.checked ?? false,
              difficultyKey,
              manualModifier,
              restraintValue: wpBonus,
              baseCost,
              castLevel
            });
          }
        },
        cancel: { 
          label: "Cancel", 
          callback: () => resolve(null)
        }
      },
      default: "cast",
      render: (html) => {
        // Overload/Restrain mutual exclusion
        if (hasOverload) {
          const restrainCheckbox = html.find('#restrainCheckbox')[0];
          const overloadCheckbox = html.find('#overloadCheckbox')[0];
          const restrainGroup = html.find('#restrainGroup')[0];
          const overloadGroup = html.find('#overloadGroup')[0];
          
          if (restrainCheckbox && overloadCheckbox) {
            restrainCheckbox.addEventListener('change', (e) => {
              if (e.target.checked) {
                overloadCheckbox.checked = false;
                overloadGroup.style.opacity = '0.5';
              } else {
                overloadGroup.style.opacity = '1';
              }
            });
            
            overloadCheckbox.addEventListener('change', (e) => {
              if (e.target.checked) {
                restrainCheckbox.checked = false;
                restrainGroup.style.opacity = '0.5';
              } else {
                restrainGroup.style.opacity = '1';
              }
            });
          }
        }
        
        // Live profile preview (Phase 3 Task 2)
        if (hasScaling) {
          const castLevelSelect = html.find('#castLevelSelect')[0];
          const restrainCheckbox = html.find('#restrainCheckbox')[0];
          const overloadCheckbox = html.find('#overloadCheckbox')[0];
          const previewCost = html.find('#previewCost')[0];
          const previewDamage = html.find('#previewDamage')[0];
          const previewDuration = html.find('#previewDuration')[0];
          
          const updatePreview = () => {
            const selectedLevel = parseInt(castLevelSelect?.value ?? baseLevel);
            const isRestrained = restrainCheckbox?.checked ?? false;
            const isOverloaded = overloadCheckbox?.checked ?? false;
            
            try {
              const profile = resolveSpellProfile(spell, actor, {
                level: selectedLevel,
                isRestrained,
                isOverloaded
              });
              
              if (previewCost) previewCost.textContent = `Cost: ${profile.cost.final} MP${isRestrained ? ' (refund on success: ' + wpBonus + ' MP)' : ''}${isOverloaded ? ' (2× overload)' : ''}`;
              if (previewDamage) previewDamage.textContent = `Damage: ${profile.damage.formula || 'N/A'}`;
              if (previewDuration) previewDuration.textContent = `Duration: ${profile.duration.value || 0} ${profile.duration.unit || 'instant'}`;
            } catch (err) {
              console.warn('UESRPG | Failed to update spell profile preview', err);
            }
          };
          
          if (castLevelSelect) castLevelSelect.addEventListener('change', updatePreview);
          if (restrainCheckbox) restrainCheckbox.addEventListener('change', updatePreview);
          if (overloadCheckbox) overloadCheckbox.addEventListener('change', updatePreview);
          
          // Initial preview update on dialog open
          updatePreview();
        }
      }
    }, { width: 380 });
    
    dialog.render(true);
  });
}

/**
 * Cast an attack spell using the magic opposed workflow.
 * @param {SimpleActorSheet} sheet
 * @param {Item|null} spell
 * @param {Token[]} targets
 * @param {object|null} spellOptions
 * @param {string} castActionType
 * @param {object} opts
 */
export async function castAttackSpell(sheet, spell, targets, spellOptions = null, castActionType = "primary", { aoeTemplateUuid = null, aoeTemplateId = null, deferSpellChoice = false } = {}) {
  const { MagicOpposedWorkflow } = await import("../../../../core/magic/opposed-workflow.js");
  
  const attackerToken = canvas?.tokens?.controlled?.find(t => t.actor?.id === sheet.actor.id) 
    ?? sheet.actor.getActiveTokens?.()?.[0];
  
  if (!attackerToken) {
    ui.notifications.warn("No attacker token found. Select your token and try again.");
    return;
  }
  
  const rangeType = spell ? getSpellRangeType(spell) : null;
  const aoeConfig = (spell && rangeType === "aoe")
    ? {
        ...(getSpellAoEConfig(spell) ?? {}),
        isAoE: true,
        templateUuid: aoeTemplateUuid ?? null,
        templateId: aoeTemplateId ?? null
      }
    : null;

  const defenderTokenUuids = Array.from(targets ?? [])
    .map((defenderToken) => defenderToken?.document?.uuid ?? defenderToken?.uuid)
    .filter(Boolean);

  await MagicOpposedWorkflow.createPending({
    attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
    defenderTokenUuids,
    spellUuid: spell?.uuid ?? null,
    spellOptions: spellOptions ?? undefined,
    deferSpellChoice: Boolean(deferSpellChoice),
    castActionType,
    aoe: aoeConfig,
    isAoE: Boolean(spell && rangeType === "aoe")
  });
}
