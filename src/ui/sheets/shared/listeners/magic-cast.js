/**
 * Magic casting handlers shared across sheets.
 *
 * Extracted from actor-sheet.js for better maintainability.
 * Shared across actor sheet modules.
 */

import { getUserSpellTargets, shouldUseTargetedSpellWorkflow, shouldUseModernSpellWorkflow, classifySpellForRouting, debugMagicRoutingLog } from "../../../../core/magic/spell-runtime.js";
import { filterTargetsBySpellRange, getSpellRangeType, getSpellAoEConfig, getSpellMaxRangeMeters } from "../../../../core/magic/spell-range.js";
import { AoEService, AOE_SOURCE_TYPES } from "../../../../core/aoe/index.js";
import { canActorCastSpell, getSpellCastingSchool } from "../../../../core/magic/magicka-utils.js";
import { showSpellOptionsDialog } from "../../../../core/magic/dialogs/spell-options-dialog.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";
import { MagicOpposedWorkflow } from "../../../../core/magic/opposed-workflow.js";
import { resolveSurpriseState } from "../../../../core/combat/surprise-state.js";
import { getFearActionRestrictions } from "../../../../core/fear/index.js";
import { ensureBurningTurnActionAllowed } from "../../../../core/conditions/condition-engine.js";
import { castScrollFromItem, getCastableScrollCandidates } from "../../../../core/magic/scroll-casting.js";
import { castFromEnchantedItem } from "../../../../core/enchanting/runtime/cast-enchantment-runtime.js";

const _FLAG_NS = "uesrpg-3ev4";
const _EQUIPMENT_TYPES = new Set(["weapon", "armor", "ammunition", "equipment", "container", "scroll"]);

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

    let spell = preselectedSpell;
    let selectedItemSpellcast = null;

    if (!spell) {
      const spellsAll = actor.itemTypes?.spell ?? [];
      const spellsByAction = (castActionType === "secondary")
        ? spellsAll.filter(s => s?.system?.isInstant === true)
        : spellsAll;

      const spells = spellsByAction.filter((s) => canActorCastSpell(actor, s));
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
          `<option value="spell:${s.id}">Spell: ${s.name} (${getSpellCastingSchool(s)} L${s.system.level}, ${s.system.cost} MP)</option>`
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
        if (!canActorCastSpell(actor, spell)) {
          ui.notifications.warn(`${actor.name} is untrained in ${getSpellCastingSchool(spell) || "that school"} and cannot cast ${spell.name}.`);
          return;
        }
      }
    }

    const targets = getUserSpellTargets();
    debugMagicRoutingLog({ source: "onCastMagicAction", actor, spell, targets });

    const rangeType = getSpellRangeType(spell);
    const attackerToken = this.token?.object ?? this.token ?? resolveRangeGatedTokenForActor(actor);
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
      const fakeEvent = { currentTarget: { closest: () => ({ dataset: { itemId: spell.id } }) } };
      await this._onSpellRoll.call(this, fakeEvent);
    }
  } catch (err) {
    console.error("UESRPG | onCastMagicAction failed:", err);
    ui.notifications.error("Magic casting failed - see console (F12) for details.");
  }
});

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

