/**
 * Magic casting handlers shared across sheets.
 *
 * Extracted from actor-sheet.js for better maintainability.
 * Shared across actor sheet modules.
 */

import { getUserSpellTargets, shouldUseTargetedSpellWorkflow, shouldUseModernSpellWorkflow, classifySpellForRouting, debugMagicRoutingLog } from "../../../../core/magic/spell-runtime.js";
import { filterTargetsBySpellRange, getSpellRangeType, getSpellAoEConfig, getSpellMaxRangeMeters } from "../../../../core/magic/spell-range.js";
import { AoEService, AOE_SOURCE_TYPES } from "../../../../core/aoe/index.js";
import { canActorCastSpell, getSpellCastingSchool, getSpellCost, getSpellLevel } from "../../../../core/magic/magicka-utils.js";
import { showSpellOptionsDialog } from "../../../../core/magic/dialogs/spell-options-dialog.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { asyncGuardSheet } from "../../../../utils/async-guard.js";
import { MagicOpposedWorkflow } from "../../../../core/magic/opposed-workflow.js";
import { resolveSurpriseState } from "../../../../core/combat/surprise-state.js";
import { getFearActionRestrictions } from "../../../../core/fear/index.js";
import { ensureBurningTurnActionAllowed } from "../../../../core/conditions/condition-engine.js";
import { castScrollFromItem, getCastableScrollCandidates } from "../../../../core/magic/scroll-casting.js";
import { castFromEnchantedItem } from "../../../../core/enchanting/runtime/cast-enchantment-runtime.js";
import { t, tf } from "../../../../utils/i18n.js";
import { CastSpellService } from "../../../../application/magic/cast-spell-service.js";

const _FLAG_NS = "uesrpg-3ev4";
const _EQUIPMENT_TYPES = new Set(["weapon", "armor", "ammunition", "equipment", "container", "scroll"]);
const _SCHOOL_LABELS = Object.freeze({
  alteration: "Alteration",
  conjuration: "Conjuration",
  destruction: "Destruction",
  illusion: "Illusion",
  mysticism: "Mysticism",
  necromancy: "Necromancy",
  restoration: "Restoration",
  enchant: "Enchant",
});
const _SCHOOL_ORDER = Object.freeze(["alteration", "conjuration", "destruction", "illusion", "mysticism", "necromancy", "restoration", "enchant"]);

function _escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

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

function _getItemSpellSlotLevel(slot) {
  return Math.max(1, Number(slot?.level ?? 1) || 1);
}

function _buildItemSpellOptionsCastContext(item, slot) {
  const level = _getItemSpellSlotLevel(slot);
  return {
    castSource: {
      type: "enchantment",
      sourceLane: String(slot?.sourceLane ?? "extension"),
      itemUuid: item?.uuid ?? null,
      enchantedItemUuid: item?.uuid ?? null,
      itemName: item?.name ?? "",
      spellSlotId: String(slot?.id ?? ""),
      enchantSpellSlotId: String(slot?.id ?? ""),
      costMode: _normalizeCostMode(slot?.costMode),
      cost: Number(slot?.cost ?? 0) || 0,
      bindingStrength: Number(slot?.bindingStrength ?? 0) || 0,
      skipCastingTest: slot?.skipCastingTest !== false,
      level
    },
    castLevel: level,
    level
  };
}

function _buildAutomaticItemSpellOptions(slot) {
  const level = _getItemSpellSlotLevel(slot);
  return {
    enchantmentCast: true,
    castLevel: level,
    level
  };
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

function _normalizeSchoolKey(spell) {
  const raw = String(getSpellCastingSchool(spell) || spell?.system?.school || "").trim().toLowerCase();
  return raw || "unknown";
}

function _schoolLabel(key) {
  const schoolKey = String(key ?? "").trim().toLowerCase();
  return _SCHOOL_LABELS[schoolKey] ?? (schoolKey ? schoolKey.charAt(0).toUpperCase() + schoolKey.slice(1) : t("UESRPG.UI.Unknown"));
}

function _sourceSortLabel(source) {
  return `${String(source?.schoolLabel ?? "")}\u0000${String(source?.spellName ?? "")}\u0000${String(source?.sourceLabel ?? "")}`;
}

function _buildKnownSpellSource(spell) {
  const level = Number(getSpellLevel(spell) ?? 1) || 1;
  const cost = Number(getSpellCost(spell, level) ?? 0) || 0;
  const schoolKey = _normalizeSchoolKey(spell);
  return {
    value: `spell:${spell.id}`,
    type: "spell",
    spell,
    spellName: String(spell?.name ?? t("UESRPG.UI.Unknown")),
    sourceLabel: "",
    schoolKey,
    schoolLabel: _schoolLabel(schoolKey),
    detail: `${_schoolLabel(schoolKey)} L${level}, ${cost} MP`,
    optionLabel: `${spell?.name ?? t("UESRPG.UI.Unknown")} (${_schoolLabel(schoolKey)} L${level}, ${cost} MP)`,
  };
}

function _buildScrollSource(scroll, spell) {
  const level = Number(getSpellLevel(spell) ?? 1) || 1;
  const schoolKey = _normalizeSchoolKey(spell);
  const qty = Number(scroll?.system?.quantity ?? 0) || 0;
  return {
    value: `scroll:${scroll.id}`,
    type: "scroll",
    spell,
    spellName: String(spell?.name ?? t("UESRPG.UI.Unknown")),
    sourceLabel: String(scroll?.name ?? t("UESRPG.ItemTypes.Scroll", "Scroll")),
    schoolKey,
    schoolLabel: _schoolLabel(schoolKey),
    detail: `${_schoolLabel(schoolKey)} L${level}, Qty ${qty}`,
    optionLabel: `${spell?.name ?? t("UESRPG.UI.Unknown")} - Scroll: ${scroll?.name ?? t("UESRPG.ItemTypes.Scroll", "Scroll")} (${_schoolLabel(schoolKey)} L${level}, Qty ${qty})`,
  };
}

function _buildItemSpellSource(slot, spell) {
  const item = slot?.sourceItem ?? null;
  const level = Number(slot?.level ?? getSpellLevel(spell) ?? 1) || 1;
  const schoolKey = _normalizeSchoolKey(spell);
  const laneLabel = String(slot?.sourceLane ?? "extension") === "workshop" ? "RAW" : "Ext";
  const spellLabel = String(spell?.name ?? slot?.label ?? t("UESRPG.UI.Unknown"));
  return {
    value: `itemspell:${item?.id ?? ""}:${slot?.id ?? ""}`,
    type: "itemspell",
    spell,
    spellName: spellLabel,
    sourceLabel: String(item?.name ?? t("UESRPG.UI.Item", "Item")),
    schoolKey,
    schoolLabel: _schoolLabel(schoolKey),
    detail: `L${level}, ${_slotCostSummary(slot)}`,
    optionLabel: `${spellLabel} - Item: ${item?.name ?? t("UESRPG.UI.Item", "Item")} [${laneLabel}] (${_schoolLabel(schoolKey)} L${level}, ${_slotCostSummary(slot)})`,
  };
}

function _collectKnownSpellSources(actor, castActionType) {
  const spellsAll = actor?.itemTypes?.spell ?? [];
  const spellsByAction = String(castActionType) === "secondary"
    ? spellsAll.filter(s => s?.system?.isInstant === true)
    : spellsAll;
  return spellsByAction
    .filter((s) => canActorCastSpell(actor, s))
    .map(_buildKnownSpellSource);
}

async function _collectScrollSources(actor, castActionType) {
  const scrollCandidates = await getCastableScrollCandidates(actor, { castActionType });
  return scrollCandidates.map(({ scroll, spell }) => _buildScrollSource(scroll, spell));
}

async function _collectItemSpellSources(actor, castActionType) {
  const itemRuntimeEnabled = game.settings.get(_FLAG_NS, "enchanting.enableCastEnchantmentRuntime") === true;
  if (!itemRuntimeEnabled) return [];

  const itemSpellCandidatesAll = Array.from(actor?.items ?? []).flatMap((item) => _resolveItemSpellSlots(item));
  const out = [];
  for (const slot of itemSpellCandidatesAll) {
    const spellDoc = await _resolveSpellFromSlot(slot);
    if (!spellDoc) continue;
    if (String(castActionType) === "secondary" && spellDoc?.system?.isInstant !== true) continue;
    out.push(_buildItemSpellSource(slot, spellDoc));
  }
  return out;
}

async function _collectCastMagicSources(actor, castActionType) {
  const sources = [
    ..._collectKnownSpellSources(actor, castActionType),
    ...await _collectScrollSources(actor, castActionType),
    ...await _collectItemSpellSources(actor, castActionType),
  ];
  sources.sort((a, b) => _sourceSortLabel(a).localeCompare(_sourceSortLabel(b)));
  return sources;
}

function _groupSourcesBySchool(sources) {
  const bySchool = new Map();
  for (const source of sources) {
    const key = String(source?.schoolKey ?? "unknown");
    if (!bySchool.has(key)) {
      bySchool.set(key, {
        key,
        label: String(source?.schoolLabel ?? _schoolLabel(key)),
        sources: [],
      });
    }
    bySchool.get(key).sources.push(source);
  }

  return Array.from(bySchool.values()).sort((a, b) => {
    const ai = _SCHOOL_ORDER.indexOf(a.key);
    const bi = _SCHOOL_ORDER.indexOf(b.key);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.label.localeCompare(b.label);
  });
}

function _buildCastMagicSourcePickerContent(groups) {
  const cards = groups.map((group, idx) => {
    const selected = idx === 0 ? "checked" : "";
    const disabled = idx === 0 ? "" : "disabled";
    const options = group.sources.map((source) =>
      `<option value="${_escapeHtml(source.value)}">${_escapeHtml(source.optionLabel)}</option>`
    ).join("");
    return `
      <label class="uesrpg-adv-choice uesrpg-cast-source-school">
        <input type="radio" name="sourceSchool" value="${_escapeHtml(group.key)}" ${selected} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">${_escapeHtml(group.label)}</span>
          <span class="uesrpg-adv-choice__desc">${group.sources.length} ${group.sources.length === 1 ? "source" : "sources"}</span>
          <span class="uesrpg-adv-inline uesrpg-cast-source-select ${idx === 0 ? "" : "disabled"}">
            <select name="source-${_escapeHtml(group.key)}" ${disabled}>${options}</select>
          </span>
        </span>
      </label>
    `;
  }).join("");

  return `
    <div class="uesrpg-cast-magic-form uesrpg-adv-dialog uesrpg-adv-dialog--magic-source">
      <div class="uesrpg-dialog-section-header">${_escapeHtml(t("UESRPG.Dialogs.CastMagic.SelectSource"))}</div>
      <div class="uesrpg-adv-grid uesrpg-cast-source-grid">
        ${cards}
      </div>
    </div>`;
}

async function _promptCastMagicSource({ castActionType, sources }) {
  const groups = _groupSourcesBySchool(sources);
  const content = _buildCastMagicSourcePickerContent(groups);

  return await customDialog({
    title: castActionType === "secondary" ? t("UESRPG.Dialogs.CastMagic.TitleInstant") : t("UESRPG.Dialogs.CastMagic.Title"),
    content,
    buttons: {
      cast: {
        label: t("UESRPG.Dialogs.CastMagic.Cast"),
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const checked = root?.querySelector('input[name="sourceSchool"]:checked');
          const schoolKey = String(checked?.value ?? "");
          if (!schoolKey) return null;
          return root?.querySelector(`select[name="source-${CSS.escape(schoolKey)}"]`)?.value ?? null;
        }
      },
      cancel: { label: t("UESRPG.UI.Cancel"), callback: () => null }
    },
    default: "cast",
    classes: ["uesrpg-attack-declare"],
    width: 560,
    render: (event, html) => {
      const root = html instanceof HTMLElement ? html : html?.element ?? html;
      const form = root?.querySelector(".uesrpg-adv-dialog--magic-source") ?? root;
      if (!form) return;

      const sync = () => {
        const checked = form.querySelector('input[name="sourceSchool"]:checked');
        const activeKey = String(checked?.value ?? "");
        for (const select of form.querySelectorAll(".uesrpg-cast-source-select select")) {
          const isActive = select.getAttribute("name") === `source-${activeKey}`;
          select.disabled = !isActive;
          select.closest(".uesrpg-cast-source-select")?.classList.toggle("disabled", !isActive);
        }
      };

      for (const radio of form.querySelectorAll('input[name="sourceSchool"]')) {
        radio.addEventListener("change", sync);
      }
      sync();
    },
  });
}

function _resolvePreselectedSpellFromEvent(actor, event, target) {
  const button = target ?? event?.currentTarget ?? event?.target ?? null;
  const row = button?.closest?.(".item") ?? null;
  const itemId = String(row?.dataset?.itemId ?? "").trim();
  if (!itemId) return null;
  const item = actor?.items?.get?.(itemId) ?? null;
  return item?.type === "spell" ? item : null;
}

export const onCastMagicAction = asyncGuardSheet(async function onCastMagicAction(event, target, preselectedSpell = null) {
  try {
    const actor = this.actor;
    const castActionType = String((target ?? event?.currentTarget)?.dataset?.actionType ?? "primary");

    const _preCheckActionGate = async () => {
      const surprise = resolveSurpriseState(actor, { combatContext: game.combat });
      if (surprise.onlyReactions) {
        ui.notifications.warn(tf("UESRPG.Notifications.Magic.ActorSurprisedReactionsOnly", { actor: actor.name }));
        return false;
      }

      const fear = getFearActionRestrictions(actor);
      if (fear?.blockActions === true) {
        ui.notifications.warn(tf("UESRPG.Notifications.Magic.ActorCannotCastFear", { actor: actor.name }));
        return false;
      }

      const burning = await ensureBurningTurnActionAllowed(actor, {
        actionId: castActionType === "secondary" ? "cast-magic-instant" : "cast-magic"
      });
      if (!burning.allowed) {
        ui.notifications.warn(tf("UESRPG.Notifications.Magic.ActorFailsCastBurning", { actor: actor.name }));
        return false;
      }

      return true;
    };

    if (!(await _preCheckActionGate())) return;

    let spell = preselectedSpell ?? _resolvePreselectedSpellFromEvent(actor, event, target);
    let selectedItemSpellcast = null;
    const hasPreselectedSpell = Boolean(spell);

    if (!spell) {
      const sources = await _collectCastMagicSources(actor, castActionType);
      if (!sources.length) {
        ui.notifications.warn(castActionType === "secondary"
          ? t("UESRPG.Notifications.Magic.NoCastableInstantSources")
          : t("UESRPG.Notifications.Magic.NoCastableSources"));
        return;
      }

      const selectedCastId = await _promptCastMagicSource({ castActionType, sources });
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
          ui.notifications.info(tf("UESRPG.Notifications.Magic.ScrollUsedUp", { item: scroll.name }));
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
          ui.notifications.warn(t("UESRPG.Notifications.Magic.StoredItemSpellUnresolved"));
          return;
        }
        spell = spellDoc;
        selectedItemSpellcast = { item: sourceItem, slot };
      } else {
        spell = actor.items.get(sourceId);
        if (!spell) return;
        if (!canActorCastSpell(actor, spell)) {
          ui.notifications.warn(tf("UESRPG.Notifications.Magic.ActorUntrainedSchool", { actor: actor.name, school: getSpellCastingSchool(spell) || t("UESRPG.UI.Unknown"), spell: spell.name }));
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
      ui.notifications.warn(t("UESRPG.Notifications.Magic.ActiveTokenRequired"));
      return;
    }

    let workingTargets = Array.from(targets ?? []);
    let aoeAreaUuid = null;
    let aoeAreaId = null;
    let aoeRegionUuid = null;
    let aoeRegionId = null;

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
      aoeAreaId = placed.areaId ?? placed.regionId ?? null;
      aoeAreaUuid = placed.areaUuid ?? placed.regionUuid ?? null;
      aoeRegionId = placed.regionId ?? null;
      aoeRegionUuid = placed.regionUuid ?? null;

      if (placed.targets?.length) workingTargets = placed.targets;
      if (!workingTargets.length) {
        ui.notifications?.info?.(t("UESRPG.Notifications.Magic.NoTargetsInArea"));
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
          ui.notifications.warn(tf("UESRPG.Notifications.Magic.OutOfRangeTargets", { names, maxRange: maxRange ? ` (max ${maxRange}m)` : "" }));
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
            areaType: "region",
            areaUuid: aoeAreaUuid ?? null,
            areaId: aoeAreaId ?? null,
            regionUuid: aoeRegionUuid ?? null,
            regionId: aoeRegionId ?? null
          }
        : null;
      const spellOptions = selectedItemSpellcast.slot?.skipCastingTest !== false
        ? _buildAutomaticItemSpellOptions(selectedItemSpellcast.slot)
        : await showSpellOptionsDialog(
          actor,
          spell,
          _buildItemSpellOptionsCastContext(selectedItemSpellcast.item, selectedItemSpellcast.slot)
        );
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

    if (spellCls.isDirect || shouldUseTargetedSpellWorkflow(spell, workingTargets) || shouldUseModernSpellWorkflow(spell)) {
      const spellOptions = hasPreselectedSpell ? await showSpellOptionsDialog(actor, spell) : null;
      if (spellOptions === null && hasPreselectedSpell) return;
      const castResult = await CastSpellService.cast({
        spellUuid: spell.uuid,
        casterActorUuid: actor.uuid,
        casterTokenUuid: attackerToken?.document?.uuid ?? attackerToken?.uuid ?? null,
        targetTokenUuids: workingTargets
          .map((targetToken) => targetToken?.document?.uuid ?? targetToken?.uuid)
          .filter(Boolean),
        castActionType,
        aoeConfig: hasValidAoe
          ? {
              ...(aoeSpec ?? {}),
              isAoE: true,
              areaType: "region",
              areaUuid: aoeAreaUuid ?? null,
              areaId: aoeAreaId ?? null,
              regionUuid: aoeRegionUuid ?? null,
              regionId: aoeRegionId ?? null
            }
          : null,
        ...(hasPreselectedSpell ? { spellOptions } : {}),
      });
      if (castResult?.error && castResult.error !== "Casting cancelled by user") {
        ui.notifications.warn(castResult.error);
      }
      return;
    } else {
      const fakeEvent = { currentTarget: { closest: () => ({ dataset: { itemId: spell.id } }) } };
      await this._onSpellRoll.call(this, fakeEvent);
    }
  } catch (err) {
    console.error("UESRPG | onCastMagicAction failed:", err);
    ui.notifications.error(t("UESRPG.Notifications.Magic.CastingFailed"));
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
export async function castAttackSpell(sheet, spell, targets, spellOptions = null, castActionType = "primary", { aoeAreaUuid = null, aoeAreaId = null, aoeRegionUuid = null, aoeRegionId = null, deferSpellChoice = false } = {}) {
  const attackerToken = canvas?.tokens?.controlled?.find(t => t.actor?.id === sheet.actor.id)
    ?? sheet.actor.getActiveTokens?.()?.[0];

  if (!attackerToken) {
    ui.notifications.warn(t("UESRPG.Notifications.Magic.NoAttackerToken"));
    return;
  }

  const hasAoeArea = Boolean(aoeAreaUuid || aoeAreaId || aoeRegionUuid || aoeRegionId);
  const aoeConfig = (spell && hasAoeArea)
    ? {
        ...(getSpellAoEConfig(spell) ?? {}),
        isAoE: true,
        areaType: "region",
        areaUuid: aoeAreaUuid ?? aoeRegionUuid ?? null,
        areaId: aoeAreaId ?? aoeRegionId ?? null,
        regionUuid: aoeRegionUuid ?? null,
        regionId: aoeRegionId ?? null
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
    isAoE: hasAoeArea
  });
}
