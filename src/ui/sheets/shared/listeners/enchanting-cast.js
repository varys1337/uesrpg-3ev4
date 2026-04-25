import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";
import { resolveSurpriseState } from "../../../../core/combat/surprise-state.js";
import { getFearActionRestrictions } from "../../../../core/fear/index.js";
import { ensureBurningTurnActionAllowed } from "../../../../core/conditions/condition-engine.js";
import { AoEService, AOE_SOURCE_TYPES } from "../../../../core/aoe/index.js";
import { getSpellRangeType, getSpellAoEConfig, getSpellMaxRangeMeters, filterTargetsBySpellRange } from "../../../../core/magic/spell-range.js";
import { castFromEnchantedItem } from "../../../../core/enchanting/runtime/cast-enchantment-runtime.js";
import { showSpellOptionsDialog } from "../../../../core/magic/dialogs/spell-options-dialog.js";

const _FLAG_NS = "uesrpg-3ev4";
const _EQUIPMENT_TYPES = new Set(["weapon", "armor", "ammunition", "equipment", "container", "scroll"]);

function _resolveRangeGatedTokenForActor(actor) {
  let token = canvas.tokens?.controlled?.find((t) => t.actor?.id === actor.id) ?? null;
  if (!token) token = actor.getActiveTokens?.()?.[0] ?? null;
  return token;
}

function _resolveOwnedItem(actor, itemIdOrDoc) {
  if (!actor) return null;
  if (!itemIdOrDoc) return null;
  if (typeof itemIdOrDoc === "object") {
    if (itemIdOrDoc.actor?.id === actor.id) return itemIdOrDoc;
    if (itemIdOrDoc.id) return actor.items?.get(itemIdOrDoc.id) ?? null;
    return null;
  }
  return actor.items?.get(String(itemIdOrDoc)) ?? null;
}

function _getCastSlots(item) {
  const flags = item?.flags?.[_FLAG_NS] ?? {};
  const out = [];

  const ext = flags?.itemSpellcasting ?? {};
  if (ext?.enabled === true) {
    const extSlots = Array.isArray(ext?.slots) ? ext.slots : [];
    for (const slot of extSlots) {
      if (slot?.enabled === false) continue;
      out.push({ ...slot, sourceLane: "extension" });
    }
  }

  const enc = flags?.enchanting;
  if (enc?.version === 2 && String(enc?.enchantType ?? "").trim().toLowerCase() === "cast") {
    const cast = enc.cast ?? {};
    const slots = Array.isArray(cast?.spells) ? cast.spells : [];
    for (const slot of slots) {
      if (slot?.enabled === false) continue;
      out.push({ ...slot, sourceLane: "workshop" });
    }
  }

  return out;
}

function _slotCostSummary(slot) {
  const mode = String(slot?.costMode ?? "soul").trim().toLowerCase();
  if (mode === "magicka") return "MP";
  if (mode === "none") return "No Cost";
  return `Soul ${Number(slot?.cost ?? 0)}`;
}

function _buildSpellOptionsCastContext(item, slot) {
  const level = Math.max(1, Number(slot?.level ?? 1) || 1);
  return {
    castSource: {
      type: "enchantment",
      sourceLane: String(slot?.sourceLane ?? "extension"),
      itemUuid: item?.uuid ?? null,
      enchantedItemUuid: item?.uuid ?? null,
      itemName: item?.name ?? "",
      spellSlotId: String(slot?.id ?? ""),
      enchantSpellSlotId: String(slot?.id ?? ""),
      costMode: String(slot?.costMode ?? "soul"),
      cost: Number(slot?.cost ?? 0) || 0,
      bindingStrength: Number(slot?.bindingStrength ?? 0) || 0,
      skipCastingTest: slot?.skipCastingTest !== false,
      level
    },
    castLevel: level,
    level
  };
}

function _buildAutomaticSpellOptions(slot) {
  const level = Math.max(1, Number(slot?.level ?? 1) || 1);
  return {
    enchantmentCast: true,
    castLevel: level,
    level
  };
}

async function _resolveSlotSpell(item, slot) {
  const actor = item?.actor ?? null;
  const actorSpellItemId = String(slot?.actorSpellItemId ?? "").trim();
  if (actor && actorSpellItemId) {
    const embedded = actor.items?.get?.(actorSpellItemId) ?? null;
    if (embedded?.documentName === "Item" && embedded.type === "spell") return embedded;
  }

  const uuid = String(slot?.spellUuid ?? "").trim();
  if (uuid) {
    try {
      const spell = await fromUuid(uuid);
      if (spell?.documentName === "Item" && spell.type === "spell") return spell;
    } catch (_err) {
      // Fallback handled below.
    }
  }
  const snap = slot?.snapshot;
  if (snap && typeof snap === "object") {
    try {
      const data = foundry.utils.deepClone(snap);
      data.type = "spell";
      if (!String(data.name ?? "").trim()) data.name = String(slot?.label ?? "Stored Spell");
      const ItemCls = CONFIG?.Item?.documentClass ?? Item;
      return new ItemCls(data, { temporary: true, parent: actor ?? undefined });
    } catch (_err) {
      return null;
    }
  }
  return null;
}

async function _pickSpellSlot(item) {
  const slots = _getCastSlots(item);
  if (!slots.length) return null;
  if (slots.length === 1) return slots[0];

  const opts = slots.map((s) => {
    const label = String(s?.label ?? "Stored Spell");
    const level = Number(s?.level ?? 1);
    const cost = _slotCostSummary(s);
    const bs = Number(s?.bindingStrength ?? 0);
    const lane = String(s?.sourceLane ?? "extension") === "workshop" ? "RAW" : "Ext";
    return `<option value="${String(s?.sourceLane ?? "extension")}:${String(s?.id ?? "")}">[${lane}] ${label} (L${level}, ${cost}, BS ${bs})</option>`;
  }).join("");

  const chosen = await customDialog({
    title: "Cast Enchantment",
    content: `
      <div class="uesrpg-cast-enchantment-form">
        <div class="form-group">
          <label><b>Select Stored Spell</b></label>
          <select name="slotId" style="width:100%;">${opts}</select>
        </div>
      </div>
    `,
    buttons: {
      cast: {
        label: "Cast",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return root?.querySelector('select[name="slotId"]')?.value ?? null;
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    default: "cast",
    width: 360
  });
  if (!chosen) return null;
  const [lane, slotId] = String(chosen ?? "").split(":");
  return slots.find((s) =>
    String(s?.sourceLane ?? "extension") === String(lane ?? "extension")
    && String(s?.id ?? "") === String(slotId ?? "")
  ) ?? null;
}

export const onCastEnchantmentAction = asyncGuardSheet(async function onCastEnchantmentAction(event, target, sourceItem = null) {
  const actor = this.actor ?? this.document?.actor ?? null;
  if (!actor) {
    ui.notifications?.warn?.("No actor found for cast enchantment action.");
    return;
  }

  if (game.settings.get(_FLAG_NS, "enchanting.enableCastEnchantmentRuntime") !== true) {
    ui.notifications?.warn?.("Cast Enchantment runtime is disabled.");
    return;
  }

  const castActionType = String((target ?? event?.currentTarget)?.dataset?.actionType ?? "primary");
  const itemId = (target ?? event?.currentTarget)?.dataset?.itemId ?? null;
  const item = _resolveOwnedItem(actor, sourceItem ?? itemId ?? this.document);
  if (!item) {
    ui.notifications?.warn?.("Could not resolve enchanted item.");
    return;
  }
  if (!_EQUIPMENT_TYPES.has(String(item.type ?? "").toLowerCase())) {
    ui.notifications?.warn?.("Only equipment items can be used for item spellcasting.");
    return;
  }

  const slot = await _pickSpellSlot(item);
  if (!slot) return;

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

  const spell = await _resolveSlotSpell(item, slot);
  if (!spell) {
    ui.notifications?.warn?.("Stored spell reference could not be resolved.");
    return;
  }
  const spellOptions = slot?.skipCastingTest !== false
    ? _buildAutomaticSpellOptions(slot)
    : await showSpellOptionsDialog(actor, spell, _buildSpellOptionsCastContext(item, slot));
  if (spellOptions === null) return;

  const rangeType = getSpellRangeType(spell);
  const aoeSpec = getSpellAoEConfig(spell);
  const hasValidAoe = aoeSpec && (aoeSpec.sizeMeters > 0 || aoeSpec.pulse);
  const attackerToken = this.token?.object ?? this.token ?? _resolveRangeGatedTokenForActor(actor);

  if ((rangeType === "ranged" || rangeType === "melee" || rangeType === "aoe" || hasValidAoe) && !attackerToken) {
    ui.notifications.warn("You must have an active token selected to cast this enchantment (range-gated).");
    return;
  }

  let workingTargets = Array.from(game.user?.targets ?? []);
  let aoe = null;

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
    aoe = {
      ...foundry.utils.deepClone(aoeSpec ?? {}),
      isAoE: true,
      areaType: "region",
      areaId: placed.areaId ?? placed.regionId ?? null,
      areaUuid: placed.areaUuid ?? placed.regionUuid ?? null,
      regionId: placed.regionId ?? null,
      regionUuid: placed.regionUuid ?? null,
    };
    if (Array.isArray(placed.targets) && placed.targets.length) workingTargets = placed.targets;
  } else if ((rangeType === "ranged" || rangeType === "melee") && workingTargets.length) {
    const res = filterTargetsBySpellRange({
      casterToken: attackerToken,
      targets: workingTargets,
      spell
    }) ?? {};
    workingTargets = Array.isArray(res.validTargets) ? res.validTargets : [];
    if (!workingTargets.length) return;
  }

  const targetTokenUuids = workingTargets
    .map((t) => t?.document?.uuid ?? t?.uuid)
    .filter(Boolean);

  await castFromEnchantedItem({
    actor,
    token: attackerToken,
    item,
    spellSlotId: `${String(slot?.sourceLane ?? "extension")}:${String(slot?.id ?? "")}`,
    castActionType,
    options: { targetTokenUuids, aoe, spellOptions }
  });
});
