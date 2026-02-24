/**
 * Magic casting handlers shared across sheets.
 * 
 * Extracted from actor-sheet.js for better maintainability.
 * Shared across actor sheet modules.
 */

import { getUserSpellTargets, shouldUseTargetedSpellWorkflow, shouldUseModernSpellWorkflow, classifySpellForRouting, debugMagicRoutingLog } from "../../../../core/magic/spell-runtime.js";
import { filterTargetsBySpellRange, getSpellRangeType, getSpellAoEConfig, getSpellMaxRangeMeters } from "../../../../core/magic/spell-range.js";
import { AoEService, AOE_SOURCE_TYPES } from "../../../../core/aoe/index.js";
import { getSpellScalingLevels, isActorTrainedInMagicSchool } from "../../../../core/magic/magicka-utils.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "../../../../core/skills/skill-tn.js";
import { resolveSpellProfile } from "../../../../core/magic/spell-profile.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";
import { MagicOpposedWorkflow } from "../../../../core/magic/opposed-workflow.js";
import { resolveSurpriseState } from "../../../../core/combat/surprise-state.js";
import { getFearActionRestrictions } from "../../../../core/fear/index.js";
import { ensureBurningTurnActionAllowed } from "../../../../core/conditions/condition-engine.js";
import { castScrollFromItem, getCastableScrollCandidates } from "../../../../core/magic/scroll-casting.js";
import { castFromEnchantedItem } from "../../../../core/enchanting/runtime/cast-enchantment-runtime.js";

const _FLAG_NS = "uesrpg-3ev4";
const _EQUIPMENT_TYPES = new Set(["weapon", "armor", "ammunition", "item", "container", "scroll"]);

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

function _normalizeCostMode(mode) {
  const raw = String(mode ?? "soul").trim().toLowerCase();
  if (raw === "magicka" || raw === "none") return raw;
  return "soul";
}

function _slotCostSummary(slot) {
  const mode = _normalizeCostMode(slot?.costMode);
  if (mode === "magicka") return "MP";
  if (mode === "none") return "No Cost";
  return `Soul ${Number(slot?.cost ?? 0)}`;
}

function _resolveItemSpellSlots(item) {
  const out = [];
  if (!_EQUIPMENT_TYPES.has(String(item?.type ?? "").toLowerCase())) return out;
  if (item?.system?.equipped !== true) return out;

  const ext = item?.flags?.[_FLAG_NS]?.itemSpellcasting ?? {};
  if (ext?.enabled === true) {
    const extSlots = Array.isArray(ext?.slots) ? ext.slots : [];
    for (const slot of extSlots) {
      if (slot?.enabled === false) continue;
      out.push({ ...slot, sourceLane: "extension", sourceItem: item });
    }
  }

  const enchanting = item?.flags?.[_FLAG_NS]?.enchanting;
  if (enchanting?.version === 2 && String(enchanting?.enchantType ?? "").trim().toLowerCase() === "cast") {
    const workshopSlots = Array.isArray(enchanting?.cast?.spells) ? enchanting.cast.spells : [];
    for (const slot of workshopSlots) {
      if (slot?.enabled === false) continue;
      out.push({ ...slot, sourceLane: "workshop", sourceItem: item });
    }
  }

  return out;
}

async function _resolveSpellFromSlot(slot) {
  const uuid = String(slot?.spellUuid ?? "").trim();
  if (uuid) {
    try {
      const spell = await fromUuid(uuid);
      if (spell?.documentName === "Item" && spell.type === "spell") return spell;
    } catch (_err) {
      // fallback below
    }
  }

  const snap = slot?.snapshot;
  if (snap && typeof snap === "object") {
    try {
      const data = foundry.utils.deepClone(snap);
      data.type = "spell";
      if (!String(data.name ?? "").trim()) data.name = String(slot?.label ?? "Stored Spell");
      const ItemCls = CONFIG?.Item?.documentClass ?? Item;
      return new ItemCls(data, { temporary: true });
    } catch (_err) {
      return null;
    }
  }

  return null;
}

/**
 * Handle Cast Magic button click.
 * Shows spell picker, then routes to attack spell workflow or existing spell dialog.
 * @param {object} sheet - The actor sheet instance
 * @param {Event} event - The triggering event (optional if preselectedSpell provided)
 * @param {Item} preselectedSpell - Pre-selected spell to cast (optional)
 */
export const onCastMagicAction = asyncGuardSheet(async function onCastMagicAction(event, target, preselectedSpell = null) {
  try {
  const actor = this.actor;
  const castActionType = String((target ?? event?.currentTarget)?.dataset?.actionType ?? "primary");

  const _preCheckActionGate = async () => {
    const surprise = resolveSurpriseState(actor, { combatContext: game.combat });
    if (surprise.onlyReactions) {
      ui.notifications.warn(`${actor.name} is surprised and may only take reactions until their first turn passes.`);
      return false;
    }

    const fear = getFearActionRestrictions(actor);
    if (fear?.blockActions === true) {
      ui.notifications.warn(`${actor.name} cannot cast due to fear effects.`);
      return false;
    }

    const burning = await ensureBurningTurnActionAllowed(actor, {
      actionId: castActionType === "secondary" ? "cast-magic-instant" : "cast-magic"
    });
    if (!burning.allowed) {
      ui.notifications.warn(`${actor.name} fails to cast while burning.`);
      return false;
    }

    return true;
  };

  if (!(await _preCheckActionGate())) return;

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
  let selectedItemSpellcast = null;
    
  // If no spell provided, show picker
  if (!spell) {
    const spellsAll = actor.itemTypes?.spell ?? [];
    const spellsByAction = (castActionType === "secondary")
      ? spellsAll.filter(s => s?.system?.isInstant === true)
      : spellsAll;

    // RAW: untrained casters cannot cast spells from that school.
    const spells = spellsByAction.filter(s => isActorTrainedInMagicSchool(actor, s?.system?.school));
    const scrollCandidates = await getCastableScrollCandidates(actor, { castActionType });
    const itemRuntimeEnabled = game.settings.get(_FLAG_NS, "enchanting.enableCastEnchantmentRuntime") === true;
    const itemSpellCandidatesAll = itemRuntimeEnabled
      ? Array.from(actor.items ?? []).flatMap((item) => _resolveItemSpellSlots(item))
      : [];
    const itemSpellCandidates = [];
    for (const slot of itemSpellCandidatesAll) {
      if (castActionType === "secondary") {
        const spellDoc = await _resolveSpellFromSlot(slot);
        if (spellDoc?.system?.isInstant !== true) continue;
      }
      itemSpellCandidates.push(slot);
    }

    if (!spells.length && !scrollCandidates.length && !itemSpellCandidates.length) {
      ui.notifications.warn(castActionType === "secondary"
        ? "No castable Instant spells, scrolls, or item slots available."
        : "No castable spells, scrolls, or item slots available.");
      return;
    }

    const spellOptions = [
      ...spells.map((s) =>
        `<option value="spell:${s.id}">Spell: ${s.name} (${s.system.school} L${s.system.level}, ${s.system.cost} MP)</option>`
      ),
      ...scrollCandidates.map(({ scroll, spell: linkedSpell }) =>
        `<option value="scroll:${scroll.id}">Scroll: ${scroll.name} -> ${linkedSpell.name} (${linkedSpell.system?.school ?? "Unknown"} L${linkedSpell.system?.level ?? 1}, Qty ${Number(scroll.system?.quantity ?? 0)})</option>`
      ),
      ...itemSpellCandidates.map((slot) => {
        const item = slot.sourceItem;
        const laneLabel = String(slot?.sourceLane ?? "extension") === "workshop" ? "RAW" : "Ext";
        return `<option value="itemspell:${item.id}:${slot.id}">Item: ${item.name} [${laneLabel}] -> ${slot.label ?? "Stored Spell"} (L${Number(slot?.level ?? 1)}, ${_slotCostSummary(slot)})</option>`;
      }),
    ].join("");
    
    const content = `
      <div class="uesrpg-cast-magic-form">
        <div class="form-group">
          <label><b>Select Spell, Scroll, or Item Slot</b></label>
          <select name="spellId" style="width:100%;">${spellOptions}</select>
        </div>
      </div>`;
    
    const selectedCastId = await customDialog({
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
      default: "cast",
      width: 360
    });
    
    if (!selectedCastId) return;

    const [sourceType, sourceId, ...rest] = String(selectedCastId).split(":");
    if (sourceType === "scroll") {
      const scroll = actor.items.get(sourceId);
      if (!scroll) return;

      const scrollResult = await castScrollFromItem({
        scrollItem: scroll,
        casterActor: actor,
        castActionType,
      });

      if (scrollResult?.error) {
        ui.notifications.warn(scrollResult.error);
        return;
      }
      if (scrollResult?.consumed === true && Number(scrollResult.newQty ?? 1) === 0) {
        ui.notifications.info(`${scroll.name} has been used up.`);
      }
      return;
    }

    if (sourceType === "itemspell") {
      const slotId = String(rest.join(":") ?? "").trim();
      const sourceItem = actor.items.get(sourceId);
      if (!sourceItem || !slotId) return;
      const slot = _resolveItemSpellSlots(sourceItem).find((s) => String(s?.id ?? "") === slotId);
      if (!slot) return;
      const spellDoc = await _resolveSpellFromSlot(slot);
      if (!spellDoc) {
        ui.notifications.warn("Stored item spell could not be resolved.");
        return;
      }
      spell = spellDoc;
      selectedItemSpellcast = { item: sourceItem, slot };
    } else {
      spell = actor.items.get(sourceId);
      if (!spell) return;
      if (!isActorTrainedInMagicSchool(actor, spell?.system?.school)) {
        ui.notifications.warn(`${actor.name} is untrained in ${spell?.system?.school ?? "that school"} and cannot cast ${spell.name}.`);
        return;
      }
    }
  }
  
  // Centralized routing
  const targets = getUserSpellTargets();
  debugMagicRoutingLog({ source: "onCastMagicAction", actor, spell, targets });
  
  // Range gating and AoE template placement
  const rangeType = getSpellRangeType(spell);
  const attackerToken = this.token?.object ?? this.token ?? resolveRangeGatedTokenForActor(actor);

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

  if (selectedItemSpellcast) {
    const slotRef = `${String(selectedItemSpellcast.slot?.sourceLane ?? "extension")}:${String(selectedItemSpellcast.slot?.id ?? "")}`;
    const targetTokenUuids = workingTargets
      .map((t) => t?.document?.uuid ?? t?.uuid)
      .filter(Boolean);
    const aoe = hasValidAoe
      ? {
          ...(aoeSpec ?? {}),
          isAoE: true,
          templateUuid: aoeTemplateUuid ?? null,
          templateId: aoeTemplateId ?? null
        }
      : null;
    const spellOptions = await showSpellOptionsDialog(actor, spell);
    if (spellOptions === null) return;

    await castFromEnchantedItem({
      actor,
      token: attackerToken,
      item: selectedItemSpellcast.item,
      spellSlotId: slotRef,
      castActionType,
      options: { targetTokenUuids, aoe, spellOptions }
    });
    return;
  }

  const spellCls = classifySpellForRouting(spell);

  if (spellCls.isDirect && !spellCls.isCharacteristicDefense && workingTargets.length > 0) {
    // Direct spells resolve immediately per-target (no opposed defense step).
    // EXCEPT characteristic defense spells which need chat cards.
    // Gate AP here — direct path consumes resources immediately.
    if (!_preCheckAP()) return;
    const spellOpts = await showSpellOptionsDialog(actor, spell);
    if (spellOpts === null) return;
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
    await castAttackSpell(this, spell, workingTargets, spellOpts, castActionType, {
      aoeTemplateUuid,
      aoeTemplateId,
      deferSpellChoice: !isCharDef
    });
  } else if (shouldUseModernSpellWorkflow(spell)) {
    // Gate AP here — unopposed path consumes resources immediately.
    if (!_preCheckAP()) return;
    const spellOptions = await showSpellOptionsDialog(actor, spell);
    if (spellOptions === null) return;
    await MagicOpposedWorkflow.castUnopposed({
      attackerActorUuid: actor.uuid,
      attackerTokenUuid: this.token?.document?.uuid ?? this.token?.uuid ?? null,
      spellUuid: spell.uuid,
      spellOptions,
      castActionType
    });
  } else {
    // Non-attack or no target -> use existing spell dialog
    const fakeEvent = { currentTarget: { closest: () => ({ dataset: { itemId: spell.id } }) } };
    await this._onSpellRoll.call(this, fakeEvent);
  }
  } catch (err) {
    console.error("UESRPG | onCastMagicAction failed:", err);
    ui.notifications.error("Magic casting failed — see console (F12) for details.");
  }
});

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
    <div class="uesrpg-spell-options">
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
          <span><b>Overcharge</b> (talent option)</span>
        </label>
      </div>` : ''}
      ${hasMagickaCyclingTalent ? `
      <div class="form-group" style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" name="magickaCycling" />
          <span><b>Magicka Cycling</b> (talent option)</span>
        </label>
      </div>` : ''}
    </div>
  `;
  
  return await customDialog({
    title: "Spell Options",
    content,
      buttons: {
        cast: {
          label: "Cast",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];

            const difficultyKey = String(root?.querySelector('[name="difficultyKey"]')?.value ?? "average");
            const manualModifierRaw = root?.querySelector('[name="manualModifier"]')?.value ?? "0";
            const manualModifier = Number.parseInt(String(manualModifierRaw ?? "0"), 10) || 0;
            const castLevelRaw = root?.querySelector('[name="castLevel"]')?.value ?? "base";
            const castLevel = hasScaling && castLevelRaw !== "base" ? (Number.parseInt(String(castLevelRaw), 10) || null) : null;
            
            return {
              isRestrained: root?.querySelector('[name="restrain"]')?.checked ?? false,
              isOverloaded: root?.querySelector('[name="overload"]')?.checked ?? false,
              useOvercharge: root?.querySelector('[name="overcharge"]')?.checked ?? false,
              useMagickaCycling: root?.querySelector('[name="magickaCycling"]')?.checked ?? false,
              difficultyKey,
              manualModifier,
              restraintValue: wpBonus,
              baseCost,
              castLevel
            };
          }
        },
        cancel: { 
          label: "Cancel", 
          callback: () => null
        }
      },
      default: "cast",
      render: (event, html) => {
        const root = html instanceof HTMLElement ? html : html?.element ?? html;
        // Overload/Restrain mutual exclusion
        if (hasOverload) {
          const restrainCheckbox = root?.querySelector('#restrainCheckbox');
          const overloadCheckbox = root?.querySelector('#overloadCheckbox');
          const restrainGroup = root?.querySelector('#restrainGroup');
          const overloadGroup = root?.querySelector('#overloadGroup');
          
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
          const castLevelSelect = root?.querySelector('#castLevelSelect');
          const restrainCheckbox = root?.querySelector('#restrainCheckbox');
          const overloadCheckbox = root?.querySelector('#overloadCheckbox');
          const previewCost = root?.querySelector('#previewCost');
          const previewDamage = root?.querySelector('#previewDamage');
          const previewDuration = root?.querySelector('#previewDuration');
          
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
      },
      width: 380
    });
}

/**
 * Cast an attack spell using the magic opposed workflow.
 * @param {object} sheet
 * @param {Item|null} spell
 * @param {Token[]} targets
 * @param {object|null} spellOptions
 * @param {string} castActionType
 * @param {object} opts
 */
export async function castAttackSpell(sheet, spell, targets, spellOptions = null, castActionType = "primary", { aoeTemplateUuid = null, aoeTemplateId = null, deferSpellChoice = false } = {}) {
  
  const attackerToken = canvas?.tokens?.controlled?.find(t => t.actor?.id === sheet.actor.id) 
    ?? sheet.actor.getActiveTokens?.()?.[0];
  
  if (!attackerToken) {
    ui.notifications.warn("No attacker token found. Select your token and try again.");
    return;
  }
  
  // Detect AoE from the presence of a placed template, not from rangeType.
  // Many AoE spells (Fire Ball, Cone…) use rangeType="ranged" for max-range
  // gating but still need AoE context forwarded to the opposed workflow.
  const hasAoeTemplate = Boolean(aoeTemplateUuid || aoeTemplateId);
  const aoeConfig = (spell && hasAoeTemplate)
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
    isAoE: hasAoeTemplate
  });
}

