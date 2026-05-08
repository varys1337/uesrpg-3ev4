/**
 * src/ui/sheets/v2/group-sheet.js
 *
 * ApplicationV2 Group Actor Sheet.
 *
 * Key improvements:
 * - Uses HandlebarsApplicationMixin(ActorSheetV2) base
 * - Native DOM event binding via data-action + _onRender (no jQuery)
 * - Single-registration updateActor hook (fixes V1 leak on re-render)
 * - Integrated container-safe item deletion (fixes V1 dual-handler race)
 */

import { prepareCharacterItemsHybrid } from "../sheet-prepare-items-optimized.js";
import { unlinkAllItemsFromContainer, unlinkItemFromContainer } from "../sheet-containers.js";
import { applyShortRest, applyLongRest, buildRestChatContent } from "../rest-workflow.js";
import { forwardTimeForGroupRest } from "../../../core/time/rest-time-forwarding.js";
import { cachedEnrichHTML } from "../../../utils/enrich-cache.js";
import { confirmDialog, customDialog } from "../../../utils/dialog-v2-helper.js";
import {
  requestUpdateDocument,
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
} from "../../../utils/authority-proxy.js";
import { readDropData, resolveDroppedItemDetailed } from "../../../utils/drop-data.js";
import { onDropItemIntoContainer, removeItemFromContainer } from "../item/listeners/containment.js";
import { activateProseMirrorEditors, openProseMirrorEditor } from "../shared/editor-activation.js";
import { bindItemDescriptionTooltips, clearItemDescriptionTooltip } from "./shared/sheet-tooltips.js";
import { enableItemRowDragSources } from "./shared/drag-sources.js";
import { applyCollapsedGroups } from "../shared/helpers/collapsed-group-dom.js";
import { onToggleGroupCollapse } from "../shared/helpers/ui-state-handlers.js";
import { applySheetDensityClass } from "./shared/sheet-density.js";
import { createImageVideoFilePicker } from "./shared/file-picker.js";
import { buildItemDragPayload } from "../../../utils/drag-payload.js";
import { handleExternalItemDrop, inferDroppedItemType } from "../../../utils/drop-item-create-data.js";
import { dndDebug, dndWarnFailure, makeDndTraceId } from "../../../utils/dnd-debugger.js";
import { bindWindowRestoreGuard } from "./shared/window-restore-guard.js";
import { syncBookmarkTabsActiveClass } from "./shared/bookmark-tabs-position.js";
import { pickCanvasLocation } from "../../../utils/canvas-location-picker.js";
import { openArmyCampaignApp } from "../../apps/v2/army-campaign-app.js";
import { setOwnedItemEquipped, setOwnedItemQuantityOrDelete } from "../../../core/items/owned-item-quantity.js";
import { isMassCombatEnabled } from "../../../core/homebrew/settings.js";
import { TRAINING_RANK_LABELS } from "../../../core/config/label-catalog.js";
import { computeSkillTN } from "../../../core/skills/skill-tn.js";
import { _listProfessions } from "../../../core/skills/opposed-workflow/core/skills.js";
import { SYSTEM_ID } from "../../../core/constants.js";
import { t, tf } from "../../../utils/i18n.js";
import { shouldHideFromMainInventory } from "../sheet-inventory.js";
import {
  buildAllowedChangePatch,
  buildAllowedSubmitPatch,
  createFormPathMatcher,
} from "./shared/form-pipeline.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ActorSheetV2 = foundry.applications.sheets.ActorSheetV2;
const ALLOWED_GROUP_FORM_PATH = createFormPathMatcher({
  exact: ["name", "system.description", "system.notes"],
});
const GROUP_DEBRIEF_ITEM_TYPES = Object.freeze(["skill", "magicSkill"]);
const GROUP_DEBRIEF_TYPE_ORDER = Object.freeze({
  skill: 0,
  magicSkill: 1,
  profession: 2,
});

function normalizeDebriefKey(value) {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function humanizeKey(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toLocaleUpperCase());
}

function localizeTypeLabel(type) {
  if (type === "profession") return t("UESRPG.UI.Profession", "Profession");
  return t(`TYPES.Item.${type}`, humanizeKey(type));
}

function localizeRankLabel(rank) {
  const key = String(rank ?? "").trim();
  if (!key) return t("UESRPG.UI.NoRank", "No rank");
  const normalized = normalizeDebriefKey(key).replace(/\s+/g, "");
  const labelKey = TRAINING_RANK_LABELS[normalized];
  return labelKey ? t(labelKey, humanizeKey(key)) : humanizeKey(key);
}

function getActorItemsByType(actor, type) {
  const typed = actor?.itemTypes?.[type];
  if (Array.isArray(typed)) return typed;
  return Array.from(actor?.items ?? []).filter((item) => item?.type === type);
}

function collectTrainableEntries(actor) {
  const entries = [];
  for (const type of GROUP_DEBRIEF_ITEM_TYPES) {
    for (const item of getActorItemsByType(actor, type)) {
      entries.push({
        type,
        label: String(item?.name ?? "").trim(),
        skillItem: item,
        rankLabel: localizeRankLabel(item?.system?.rank),
        typeLabel: localizeTypeLabel(type),
      });
    }
  }

  for (const profession of _listProfessions(actor)) {
    entries.push({
      type: "profession",
      label: String(profession?.name ?? "").trim(),
      skillItem: profession,
      rankLabel: t("UESRPG.UI.NoRank", "No rank"),
      typeLabel: localizeTypeLabel("profession"),
    });
  }

  return entries.filter((entry) => entry.label);
}

function computeDebriefTN(actor, skillItem) {
  try {
    const tn = computeSkillTN({ actor, skillItem })?.finalTN;
    return Number.isFinite(Number(tn)) ? Number(tn) : null;
  } catch (_err) {
    return null;
  }
}

function buildSkillDebrief(resolvedMembers) {
  const rows = new Map();

  for (const member of resolvedMembers ?? []) {
    const actor = member?.canView ? member.actor : null;
    if (!actor) continue;
    const memberName = String(member.name ?? actor.name ?? "").trim() || t("UESRPG.UI.Unknown", "Unknown");

    for (const entry of collectTrainableEntries(actor)) {
      const tn = computeDebriefTN(actor, entry.skillItem);
      if (tn == null) continue;

      const key = `${entry.type}::${normalizeDebriefKey(entry.label)}`;
      if (!rows.has(key)) {
        rows.set(key, {
          key,
          sortType: entry.type,
          label: entry.label,
          typeLabel: entry.typeLabel,
          bestTN: tn,
          bestMemberName: memberName,
          memberCount: 0,
          members: [],
        });
      }

      const row = rows.get(key);
      row.memberCount += 1;
      row.members.push({
        name: memberName,
        rankLabel: entry.rankLabel,
        tn,
      });
      if (tn > row.bestTN) {
        row.bestTN = tn;
        row.bestMemberName = memberName;
      }
    }
  }

  return Array.from(rows.values())
    .map((row) => {
      row.members.sort((a, b) => a.name.localeCompare(b.name));
      row.tooltip = [
        `${row.label} (${row.typeLabel})`,
        ...row.members.map((member) => `${member.name} - ${member.rankLabel} - TN ${member.tn}`),
      ].join("\n");
      return row;
    })
    .sort((a, b) => {
      const typeCompare = (GROUP_DEBRIEF_TYPE_ORDER[a.sortType] ?? 99) - (GROUP_DEBRIEF_TYPE_ORDER[b.sortType] ?? 99);
      if (typeCompare !== 0) return typeCompare;
      return a.label.localeCompare(b.label);
    });
}

function asFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatGroupNumber(value) {
  const number = asFiniteNumber(value, 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function getItemEncumbrance(item) {
  const system = item?.system ?? {};
  const total = Number(system.totalENC);
  if (Number.isFinite(total)) return total;
  const enc = asFiniteNumber(system.enc, 0);
  const quantity = Math.max(1, asFiniteNumber(system.quantity, 1));
  return enc * quantity;
}

function getGroupEncumbranceLabel(current, max) {
  if (max <= 0) return t("UESRPG.UI.Unknown", "Unknown");
  if (current > max * 3) return "Crushing";
  if (current > max * 2) return "Severe";
  if (current > max) return "Moderate";
  return "Minimal";
}

function buildGroupInventorySummary({ groupActor, resolvedMembers }) {
  const visibleActors = (resolvedMembers ?? [])
    .filter((member) => member?.canView && member.actor)
    .map((member) => member.actor);
  const partyWealth = visibleActors.reduce((sum, actor) => sum + asFiniteNumber(actor?.system?.wealth, 0), 0);
  const groupWealth = asFiniteNumber(groupActor?.flags?.[SYSTEM_ID]?.groupWealth, 0);
  const carryCurrent = visibleActors.reduce((sum, actor) => sum + asFiniteNumber(actor?.system?.carry_rating?.current, 0), 0);
  const carryMax = visibleActors.reduce((sum, actor) => sum + asFiniteNumber(actor?.system?.carry_rating?.max, 0), 0);
  const groupItems = Array.from(groupActor?.items ?? []);
  const groupItemsEnc = groupItems
    .filter((item) => !shouldHideFromMainInventory(item, { actor: groupActor, items: groupItems }))
    .reduce((sum, item) => sum + getItemEncumbrance(item), 0);
  const label = getGroupEncumbranceLabel(carryCurrent, carryMax);

  return {
    memberCount: visibleActors.length,
    partyWealth: formatGroupNumber(partyWealth),
    groupWealth: formatGroupNumber(groupWealth),
    totalWealth: formatGroupNumber(partyWealth + groupWealth),
    currentEnc: formatGroupNumber(carryCurrent),
    maxEnc: formatGroupNumber(carryMax),
    groupItemsEnc: formatGroupNumber(groupItemsEnc),
    label,
    penalty: label === "Crushing" ? -40 : label === "Severe" ? -20 : label === "Moderate" ? -10 : 0,
  };
}

export class GroupSheetV2 extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @type {number|null} Hooks.on("updateActor") handle for member refresh */
  #memberUpdateHook = null;
  _uesrpgContextMenuHandler = null;
  _uesrpgRestoreDblClickHandler = null;
  _uesrpgRestoreDblClickEl = null;
  _uesrpgDebriefTooltipEl = null;
  _uesrpgDebriefTooltipHandlers = null;

  _isSheetPerfTraceEnabled() {
    try {
      return Boolean(game?.settings?.get?.("uesrpg-3ev4", "sheetPerfTrace"));
    } catch (_e) {
      return false;
    }
  }

  _traceSheetPerf(stage, startedAtMs, details = {}) {
    if (!this._isSheetPerfTraceEnabled()) return;
    const elapsedMs = Number((performance.now() - startedAtMs).toFixed(2));
    const payload = {
      sheet: "GroupSheetV2",
      actorId: this.document?.id ?? null,
      actorName: this.document?.name ?? null,
      tab: this.tabGroups?.primary ?? "members",
      stage,
      elapsedMs,
      ...details,
    };
    const warnThresholdMs = stage === "_onClose"
      ? 24
      : stage === "_onRender"
        ? 32
        : stage === "_prepareContext"
          ? 40
          : null;
    const line = `UESRPG | sheetPerfTrace ${JSON.stringify(payload)}`;
    if (warnThresholdMs !== null && elapsedMs > warnThresholdMs) console.warn(line);
    else console.log(line);
  }

  /**
   * Native AppV2 tab configuration.
   * @type {Record<string, ApplicationTabsConfiguration>}
   */
  static TABS = {
    primary: {
      tabs: [
        { id: "members" },
        { id: "inventory" },
        { id: "travel" },
        { id: "details" },
      ],
      initial: "members",
    },
  };

  /* ──────────────────────── Static Configuration ──────────────────────── */

  static DEFAULT_OPTIONS = {
    classes: ["worldbuilding", "sheet", "actor", "group", "uesrpg-sheet-root"],
    position: { width: 860, height: 900 },
    window: { resizable: true },
    form: {
      handler: GroupSheetV2.prototype._onFormSubmit,
      submitOnChange: false,
      closeOnSubmit: false,
    },
    dragDrop: [{
      dragSelector: ".member-item, .item, .npc-item",
      dropSelector: ".window-content, .sheet-body, .tab, .itemListContainer, [data-item-type='container']",
    }],
    actions: {
      editPortrait: GroupSheetV2.prototype._onEditPortrait,
      viewMember: GroupSheetV2.prototype._onViewMember,
      removeMember: GroupSheetV2.prototype._onRemoveMember,
      changePace: GroupSheetV2.prototype._onChangePace,
      shortRest: GroupSheetV2.prototype._onShortRest,
      longRest: GroupSheetV2.prototype._onLongRest,
      deployGroup: GroupSheetV2.prototype._onDeployGroup,
      openArmyCampaign: GroupSheetV2.prototype._onOpenArmyCampaign,
      itemCreate: GroupSheetV2.prototype._onItemCreate,
      itemDelete: GroupSheetV2.prototype._onItemDelete,
      itemShow: GroupSheetV2.prototype._onItemShow,
      itemEquip: GroupSheetV2.prototype._onItemEquip,
      wealthCalc: GroupSheetV2.prototype._onWealthCalc,
      groupToggle: GroupSheetV2.prototype._onToggleGroupCollapse,
      plusQty: GroupSheetV2.prototype._onPlusQty,
      minusQty: GroupSheetV2.prototype._onMinusQty,
      duplicateItem: GroupSheetV2.prototype._onDuplicateItem,
      openContainer: GroupSheetV2.prototype._onOpenContainer,
      openDescriptionEditor: GroupSheetV2.prototype._onOpenDescriptionEditor,
      openNotesEditor: GroupSheetV2.prototype._onOpenNotesEditor,
    },
  };

  static PARTS = {
    sidebar: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/group/sidebar.hbs",
    },
    body: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/group/body.hbs",
      scrollable: [""],
    },
    bookmarkTabs: {
      template: "systems/uesrpg-3ev4/templates/partials/sheets/bookmark-tabs.hbs",
    },
    limited: {
      template: "systems/uesrpg-3ev4/templates/v2/sheets/group/limited.hbs",
    },
  };

  /** @override */
  get title() {
    return this.document.name;
  }

  /** V1 compat: inherited editor submit/save paths access `sheet.form`. */
  get form() {
    return this.element;
  }

  async _onChangeForm(formConfig, event) {
    if (typeof super._onChangeForm === "function") super._onChangeForm(formConfig, event);
    if (!this.isEditable || !this.document?.isOwner) return;

    const patch = buildAllowedChangePatch({
      document: this.document,
      target: event?.target,
      allowPath: ALLOWED_GROUP_FORM_PATH,
    });
    if (!patch) return;
    await requestUpdateDocument(this.document, patch);
  }

  async _onFormSubmit(_event, _form, formData) {
    if (!this.isEditable || !this.document?.isOwner) return;

    const patch = buildAllowedSubmitPatch({
      document: this.document,
      formDataObject: formData?.object,
      allowPath: ALLOWED_GROUP_FORM_PATH,
    });
    if (!patch) return;
    await requestUpdateDocument(this.document, patch);
  }

  /* ────────────────────────── Render Options ─────────────────────────── */

  /** @override — select limited vs full template PARTS */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    if (this.document.limited && !game.user.isGM) {
      options.parts = ["limited"];
    } else {
      options.parts = ["sidebar", "body", "bookmarkTabs"];
    }
  }

  /* ──────────────────────── Context Preparation ───────────────────────── */

  /** @override */
  /** @override */
  async _prepareContext(options) {
    const perfStart = performance.now();
    try {
      const context = await super._prepareContext(options);
      const actor = this.document;

      context.actor = actor;
      context.system = actor.system;
      context.isGM = game.user.isGM;
      context.editable = this.isEditable;
      context.limited = !game.user.isGM && actor.limited;
      context.owner = actor.isOwner;
      context.showArmyCampaign = isMassCombatEnabled();
      context.skillDebrief = [];
      context.groupInventorySummary = buildGroupInventorySummary({ groupActor: actor, resolvedMembers: [] });

      context.resolvedMembers = await this.#resolveMembers(actor.system.members || []);
      context.groupInventorySummary = buildGroupInventorySummary({ groupActor: actor, resolvedMembers: context.resolvedMembers });

      const enrichFn = foundry.applications.ux.TextEditor.implementation.enrichHTML;
      const _enrich = (raw) => enrichFn(raw || "");

      if (context.limited) {
        context.enrichedDescription = await _enrich(actor.system.description ?? "");
        return context;
      }

      context.skillDebrief = buildSkillDebrief(context.resolvedMembers);

      const sheetData = {
        actor: actor.toObject(),
        document: actor,
        items: actor.items.map(i => {
          const obj = i.toObject();
          obj.system = i.system;
          return obj;
        }),
      };
      await prepareCharacterItemsHybrid(sheetData);

      context.gear = sheetData.actor.gear ?? { equipped: [], unequipped: [] };
      context.weapon = sheetData.actor.weapon ?? { equipped: [], unequipped: [] };
      context.armor = sheetData.actor.armor ?? { equipped: [], unequipped: [] };
      context.shield = sheetData.actor.shield ?? { equipped: [], unequipped: [] };
      context.ammunition = sheetData.actor.ammunition ?? { equipped: [], unequipped: [] };
      context.container = sheetData.actor.container ?? [];
      context.sheetUi = {
        groupInventorySummary: context.groupInventorySummary,
        weaponDistanceHeaderLabel: t("UESRPG.Sheets.Equipment.Range", "Range"),
      };

      const speeds = context.resolvedMembers
        .filter(m => m.canView && m.speed)
        .map(m => m.speed);
      const baseSpeed = speeds.length > 0 ? Math.min(...speeds) : 0;
      const currentPace = actor.system.travelPace || "normal";
      let speedMultiplier = 1.0;
      if (currentPace === "slow") speedMultiplier = 0.6;
      else if (currentPace === "fast") speedMultiplier = 1.4;

      context.displayAverageSpeed = Math.round(baseSpeed * speedMultiplier);
      context.displayAverageSpeedKmh = (context.displayAverageSpeed * 0.6).toFixed(1);
      context.currentPace = currentPace;

      context.enrichedDescription = await cachedEnrichHTML(
        this, "group:desc", actor.system.description ?? "", _enrich
      );
      context.enrichedNotes = await cachedEnrichHTML(
        this, "group:notes", actor.system.notes ?? "", _enrich
      );

      return context;
    } finally {
      this._traceSheetPerf("_prepareContext", perfStart, {
        renderKeys: options ? Object.keys(options).length : 0,
      });
    }
  }

  /* ───────────────────────────── Lifecycle ─────────────────────────────── */

  /** @override */
  /** @override */
  _onRender(context, options) {
    const perfStart = performance.now();
    try {
      super._onRender(context, options);
      const el = this.element;
      syncBookmarkTabsActiveClass(this);
      applySheetDensityClass(el);
      bindWindowRestoreGuard(this, el);
      clearItemDescriptionTooltip(this);
      this._hideSkillDebriefTooltip();

      if (!this.#memberUpdateHook) {
        this.#memberUpdateHook = Hooks.on("updateActor", (updatedActor) => {
          const members = this.document.system.members || [];
          if (members.some(m => m.id === updatedActor?.uuid)) {
            this.render(false);
          }
        });
      }

      if (context.limited) return;

      const expectedPrimary = this.tabGroups.primary ?? "members";
      const activePrimary = el?.querySelector('.tab[data-group="primary"].active')?.dataset?.tab ?? null;
      const expectedPrimaryPane = el?.querySelector(`.tab[data-group="primary"][data-tab="${expectedPrimary}"]`);
      if (activePrimary !== expectedPrimary && expectedPrimaryPane) {
        this.changeTab(expectedPrimary, "primary", { force: true });
        syncBookmarkTabsActiveClass(this);
      }

      activateProseMirrorEditors(this, el);
      if (el?.querySelector?.(".uesrpg-group-toggle, [data-action='groupToggle']")) {
        applyCollapsedGroups(el);
      }
    } finally {
      this._traceSheetPerf("_onRender", perfStart, {
        limited: Boolean(context?.limited),
      });
    }
  }

  /**
   * Per-part listener registration (called for each re-rendered part).
   * Non-click listeners scoped to their specific part.
   * @override
   */
  _attachPartListeners(partId, htmlElement, options) {
    const perfStart = performance.now();
    try {
      super._attachPartListeners(partId, htmlElement, options);

      if (partId === "body") {
        bindItemDescriptionTooltips(this, htmlElement);
        enableItemRowDragSources(htmlElement, { actor: this.document });

        // Contextmenu: right-click plusQty → minusQty; right-click duplicateItem suppresses
        // browser context menu and re-fires the action. Handler memoized on this (not the
        // element) so function identity is stable across re-renders.
        if (!this._uesrpgContextMenuHandler) {
          this._uesrpgContextMenuHandler = async (ev) => {
            const root = ev.currentTarget;
            const plus = ev.target?.closest?.("[data-action='plusQty']");
            if (plus && root.contains(plus)) return this._onMinusQty(ev, plus);
            const dup = ev.target?.closest?.("[data-action='duplicateItem']");
            if (dup && root.contains(dup)) return this._onDuplicateItem(ev, dup);
          };
        }
        htmlElement.addEventListener("contextmenu", this._uesrpgContextMenuHandler);

        // Container row: visual drag-over highlight.
        for (const containerRow of htmlElement.querySelectorAll("[data-item-type='container']")) {
          containerRow.addEventListener("dragenter", (ev) => {
            ev.preventDefault();
            ev.currentTarget.classList.add("uesrpg-drag-over");
          });
          containerRow.addEventListener("dragleave", (ev) => {
            if (!ev.currentTarget.contains(ev.relatedTarget)) {
              ev.currentTarget.classList.remove("uesrpg-drag-over");
            }
          });
          containerRow.addEventListener("drop", (ev) => {
            ev.currentTarget.classList.remove("uesrpg-drag-over");
          });
        }
      }
      if (partId === "sidebar") {
        this._bindSkillDebriefTooltip(htmlElement);
      }
    } finally {
      this._traceSheetPerf("_attachPartListeners", perfStart, { partId });
    }
  }

  _bindSkillDebriefTooltip(rootEl) {
    if (!(rootEl instanceof HTMLElement)) return;
    const debrief = rootEl.querySelector(".group-skill-debrief");
    if (!(debrief instanceof HTMLElement) || debrief.dataset.debriefTooltipBound === "1") return;
    debrief.dataset.debriefTooltipBound = "1";

    if (!this._uesrpgDebriefTooltipHandlers) {
      this._uesrpgDebriefTooltipHandlers = {
        pointerEnter: (event) => this._showSkillDebriefTooltipForEvent(event),
        pointerLeave: (event) => this._hideSkillDebriefTooltipForEvent(event),
        focusIn: (event) => this._showSkillDebriefTooltipForEvent(event),
        focusOut: (event) => this._hideSkillDebriefTooltipForEvent(event),
      };
    }

    debrief.addEventListener("pointerenter", this._uesrpgDebriefTooltipHandlers.pointerEnter, true);
    debrief.addEventListener("pointerleave", this._uesrpgDebriefTooltipHandlers.pointerLeave, true);
    debrief.addEventListener("focusin", this._uesrpgDebriefTooltipHandlers.focusIn);
    debrief.addEventListener("focusout", this._uesrpgDebriefTooltipHandlers.focusOut);
  }

  _getSkillDebriefRowFromEvent(event) {
    const target = event?.target instanceof Element ? event.target : null;
    const row = target?.closest?.(".group-skill-debrief__row[data-debrief-tooltip]");
    if (!(row instanceof HTMLElement)) return null;
    const root = event?.currentTarget instanceof Element ? event.currentTarget : null;
    return root?.contains?.(row) ? row : null;
  }

  _ensureSkillDebriefTooltip() {
    if (this._uesrpgDebriefTooltipEl instanceof HTMLElement) return this._uesrpgDebriefTooltipEl;
    const tooltip = document.createElement("div");
    tooltip.className = "uesrpg-group-debrief-tooltip";
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    this._uesrpgDebriefTooltipEl = tooltip;
    return tooltip;
  }

  _showSkillDebriefTooltipForEvent(event) {
    const row = this._getSkillDebriefRowFromEvent(event);
    const text = row?.dataset?.debriefTooltip ?? "";
    if (!row || !text.trim()) return this._hideSkillDebriefTooltip();

    const tooltip = this._ensureSkillDebriefTooltip();
    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";

    const rowRect = row.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 0;

    let left = rowRect.right + gap;
    if (left + tipRect.width > viewportWidth - margin) left = rowRect.left - tipRect.width - gap;
    left = Math.min(Math.max(left, margin), Math.max(margin, viewportWidth - tipRect.width - margin));

    let top = rowRect.top + (rowRect.height / 2) - (tipRect.height / 2);
    top = Math.min(Math.max(top, margin), Math.max(margin, viewportHeight - tipRect.height - margin));

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  _hideSkillDebriefTooltipForEvent(event) {
    const row = this._getSkillDebriefRowFromEvent(event);
    const related = event?.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (row && related && row.contains(related)) return;
    this._hideSkillDebriefTooltip();
  }

  _hideSkillDebriefTooltip() {
    if (!(this._uesrpgDebriefTooltipEl instanceof HTMLElement)) return;
    this._uesrpgDebriefTooltipEl.hidden = true;
  }

  _destroySkillDebriefTooltip() {
    this._uesrpgDebriefTooltipEl?.remove?.();
    this._uesrpgDebriefTooltipEl = null;
  }

  /** @override */
  /** @override */
  _onClose(options) {
    const perfStart = performance.now();
    try {
      clearItemDescriptionTooltip(this);
      if (this.#memberUpdateHook) {
        Hooks.off("updateActor", this.#memberUpdateHook);
        this.#memberUpdateHook = null;
      }
      if (this._uesrpgRestoreDblClickEl && this._uesrpgRestoreDblClickHandler) {
        this._uesrpgRestoreDblClickEl.removeEventListener("dblclick", this._uesrpgRestoreDblClickHandler, true);
      }
      this._uesrpgContextMenuHandler = null;
      this._uesrpgRestoreDblClickHandler = null;
      this._uesrpgRestoreDblClickEl = null;
      this._uesrpgDebriefTooltipHandlers = null;
      this._destroySkillDebriefTooltip();
      return super._onClose(options);
    } finally {
      this._traceSheetPerf("_onClose", perfStart, {});
    }
  }

  /* ──────────────────────────── Drag & Drop ────────────────────────────── */

  /** @override */
  _canDragDrop(_selector) {
    return this.isEditable;
  }

  /** @override */
  _canDragStart(_selector) {
    return this.isEditable;
  }

  /**
   * Build a proper Item drag payload from data-item-id.
   * Group inventory rows carry data-item-id, not data-document-uuid, so the
   * base _onDragStart would produce an empty payload. We resolve the live Item
   * and stamp the correct { type, uuid } so cross-sheet drops work correctly.
   * Member rows use data-uuid (handled by super) — fall through for those.
   * @override
   */
  _onDragStart(event) {
    const existing = String(event?.dataTransfer?.getData?.("text/plain") ?? "").trim();
    if (existing) return;

    const row = event.target?.closest?.("[data-item-id]") ?? event.currentTarget;
    const itemId = row?.dataset?.itemId;
    if (!itemId) return super._onDragStart(event);

    const item = this.document.items.get(itemId);
    if (!item) return super._onDragStart(event);

    const traceId = makeDndTraceId("group-drag");
    const payload = buildItemDragPayload(item, { traceId });
    event.dataTransfer?.setData("text/plain", JSON.stringify(payload));
    dndDebug("sheet.dragstart.fallback", {
      sheet: "GroupSheetV2",
      actor: this.document?.uuid ?? null,
      item: item?.uuid ?? null,
      itemId: item?.id ?? null,
    }, { traceId });
  }

  /** @override */
  async _onDrop(event) {
    const traceId = makeDndTraceId("group-drop");
    const data = readDropData(event, {
      traceId,
    });
    dndDebug("sheet.drop.received", {
      sheet: "GroupSheetV2",
      actor: this.document?.uuid ?? null,
      type: data?.type ?? null,
      uuid: data?.uuid ?? null,
      itemId: data?.itemId ?? null,
      targetContainer: event.target?.closest?.("[data-item-type='container']")?.dataset?.itemId ?? null,
    }, { traceId });
    if (data.type === "Actor") return this.#onDropActor(data);
    if (data.type === "Item") return this.#onDropItem(event, data);
    return super._onDrop(event);
  }

  /* ──────────────────────── Private Helpers ────────────────────────────── */

  /** Get GM user IDs for whispered chat messages */
  #getGMUserIds() {
    return game.users.filter(u => u.isGM).map(u => u.id);
  }

  /** Resolve member UUIDs to actor data with permission-gated stats */
  async #resolveMembers(members) {
    const resolved = [];
    for (const member of members) {
      const actor = await fromUuid(member.id);
      if (!actor) {
        resolved.push({
          ...member,
          missing: true,
          canView: false,
          name: member.name || "Unknown Actor",
          img: member.img || "icons/svg/mystery-man.svg",
        });
        continue;
      }
      const canView = actor.testUserPermission(
        game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
      );
      resolved.push({
        id: member.id,
        uuid: member.id,
        name: actor.name,
        img: actor.img,
        type: actor.type,
        sortOrder: member.sortOrder || 0,
        missing: false,
        canView,
        actor: canView ? actor : null,
        hp: canView
          ? { value: actor.system.hp.value, max: actor.system.hp.max }
          : null,
        stamina: canView
          ? { value: actor.system.stamina.value, max: actor.system.stamina.max }
          : null,
        magicka:
          canView && actor.system.magicka
            ? { value: actor.system.magicka.value, max: actor.system.magicka.max }
            : null,
        speed: canView ? actor.system.speed.value : null,
        fatigue: canView ? actor.system.fatigue.level : 0,
      });
    }
    return resolved;
  }

  /** Show confirmation and duplicate an item */
  async #duplicateItem(item) {
    const confirmed = await confirmDialog({
      title: t("UESRPG.Dialogs.GroupSheet.DuplicateItemTitle"),
      content: `<p>${tf("UESRPG.Dialogs.GroupSheet.DuplicateItemContent", { item: item.name })}</p>`,
    });
    if (confirmed) {
      const dupData = item.toObject();
      delete dupData._id;
      await requestCreateEmbeddedDocuments(this.document, "Item", [dupData]);
    }
  }

  /** Handle Actor drag-drop (add to group members) */
  async #onDropActor(data) {
    const actor = await fromUuid(data.uuid);
    if (!actor) {
      ui.notifications.warn(t("UESRPG.Notifications.Group.CouldNotFindActor"));
      return;
    }
    if (actor.type === "Group") {
      ui.notifications.warn(t("UESRPG.Notifications.Group.CannotAddGroupToGroup"));
      return;
    }
    const members = this.document.system.members || [];
    if (members.some(m => m.id === actor.uuid)) {
      ui.notifications.warn(t("UESRPG.Notifications.Group.ActorAlreadyMember"));
      return;
    }
    members.push({ id: actor.uuid, uuid: actor.uuid, sortOrder: members.length });
    await requestUpdateDocument(this.document, { "system.members": members });
    ui.notifications.info(tf("UESRPG.Notifications.Group.ActorAdded", { actor: actor.name }));
  }

  /** Handle Item drag-drop (add to group inventory, route into container, or reorder) */
  async #onDropItem(event, data) {
    const ALLOWED_ITEM_TYPES = ["weapon", "armor", "shield", "ammunition", "equipment", "item", "container", "scroll"];
    const traceId = makeDndTraceId("group-itemdrop");

    if (!this.document.isOwner) {
      dndWarnFailure("You do not have permission to modify this group's inventory.", {
        traceId,
        details: {
          actor: this.document?.uuid ?? null,
          data,
        },
      });
      return;
    }

    // Container-row drop: route to containment logic before any other checks so
    // that both same-actor and cross-actor items can be placed into a container.
    const containerRow =
      event.currentTarget?.dataset?.itemType === "container"
        ? event.currentTarget
        : event.target.closest?.("[data-item-type='container']");

    if (containerRow?.dataset?.itemId) {
      const containerItem = this.document.items.get(containerRow.dataset.itemId);
      if (containerItem?.type === "container") {
        containerRow.classList.remove("uesrpg-drag-over");
        dndDebug("sheet.drop.route.container", {
          sheet: "GroupSheetV2",
          actor: this.document?.uuid ?? null,
          container: containerItem?.uuid ?? null,
          data,
        }, { traceId });
        return onDropItemIntoContainer(
          { item: containerItem, actor: this.document, isEditable: this.isEditable },
          data
        );
      }
    }

    const resolved = await resolveDroppedItemDetailed(data, { traceId });
    const item = resolved.item;
    if (!item) {
      dndDebug("sheet.drop.unresolved", {
        sheet: "GroupSheetV2",
        actor: this.document?.uuid ?? null,
        data,
        resolved,
      }, { traceId });
      dndWarnFailure("Unable to resolve dropped item payload.", {
        traceId,
        details: {
          sheet: "GroupSheetV2",
          actor: this.document?.uuid ?? null,
          data,
          resolved,
        },
      });
      return super._onDrop(event);
    }
    // Same-actor drops (non-container) keep native reorder/sort behavior.
    if (item.actor?.id === this.document.id) {
      dndDebug("sheet.drop.sameActor", {
        sheet: "GroupSheetV2",
        actor: this.document?.uuid ?? null,
        item: item?.uuid ?? null,
        sourceKind: resolved.sourceKind,
      }, { traceId });
      if (String(item.system?.containerStats?.container_id ?? "").trim()) {
        await removeItemFromContainer(this.document, item);
      }
      return super._onDrop(event);
    }

    const effectiveType = inferDroppedItemType(item);
    if (!ALLOWED_ITEM_TYPES.includes(effectiveType)) {
      ui.notifications.warn(tf("UESRPG.Notifications.Group.CannotAddItemType", { type: effectiveType }));
      return;
    }

    try {
      const created = await handleExternalItemDrop(this.document, item, {
        normalizeType: true,
        traceId,
      });
      if (!created) throw new Error("handleExternalItemDrop returned null");
      dndDebug("sheet.drop.externalCreate.success", {
        sheet: "GroupSheetV2",
        actor: this.document?.uuid ?? null,
        sourceItem: item?.uuid ?? null,
        sourceKind: resolved.sourceKind,
        createdId: created?.id ?? null,
        createdType: created?.type ?? null,
      }, { traceId });
      ui.notifications.info(tf("UESRPG.Notifications.Group.ItemAdded", { item: item.name }));
      return;
    } catch (err) {
      dndDebug("sheet.drop.externalCreate.failed", {
        sheet: "GroupSheetV2",
        actor: this.document?.uuid ?? null,
        item: item?.uuid ?? null,
        sourceKind: resolved.sourceKind,
        err: err?.message ?? String(err),
        resolutionPath: resolved?.resolutionPath ?? [],
        errors: resolved?.errors ?? [],
      }, { traceId });
      try {
        return await super._onDrop(event);
      } catch (fallbackErr) {
        dndWarnFailure("Item drop failed. Check console diagnostics.", {
          traceId,
          details: {
            sheet: "GroupSheetV2",
            actor: this.document?.uuid ?? null,
            item: item?.uuid ?? null,
            err: err?.message ?? String(err),
            fallbackErr: fallbackErr?.message ?? String(fallbackErr),
          },
        });
      }
    }
  }

  /* ────────────────── Action Handlers (instance methods) ─────────────── */
  // Referenced via prototype in DEFAULT_OPTIONS.actions.
  // ApplicationV2 dispatches them with `this` bound to the app instance.

  /** Open a member's actor sheet */
  async _onEditPortrait(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!this.isEditable) return;

    const current = String(this.document?.img ?? "");
    const picker = createImageVideoFilePicker({
      current,
      callback: async (path) => {
        if (!path || path === current) return;
        await requestUpdateDocument(this.document, { img: path });
      },
    });
    await picker.browse();
  }

  _onOpenDescriptionEditor(event, _target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    const editor = this.element?.querySelector?.(".details .editor-section.description prose-mirror[name='system.description']");
    openProseMirrorEditor(editor);
  }

  _onOpenNotesEditor(event, _target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    const editor = this.element?.querySelector?.(".details .editor-section.notes prose-mirror[name='system.notes']");
    openProseMirrorEditor(editor);
  }

  /** Open a member's actor sheet */
  async _onViewMember(event, target) {
    const uuid =
      target.dataset?.uuid ||
      target.closest(".member-item")?.dataset?.uuid;
    if (!uuid) return;
    const actor = await fromUuid(uuid);
    if (actor) actor.sheet.render(true);
  }

  /** Remove a member from the group */
  async _onRemoveMember(event, target) {
    if (!this.document.isOwner) return;
    const uuid = target.closest(".member-item")?.dataset?.uuid;
    if (!uuid) return;
    const members = this.document.system.members.filter(m => m.id !== uuid);
    await requestUpdateDocument(this.document, { "system.members": members });
  }

  /** Cycle travel pace: slow → normal → fast → slow */
  async _onChangePace(_event, _target) {
    const paces = ["slow", "normal", "fast"];
    const current = this.document.system.travelPace || "normal";
    const idx = paces.indexOf(current);
    await requestUpdateDocument(this.document, {
      "system.travelPace": paces[(idx + 1) % paces.length],
    });
  }

  /** Apply short rest to all visible group members */
  async _onShortRest(_event, _target) {
    const members = await this.#resolveMembers(
      this.document.system.members || []
    );
    const visibleMembers = members.filter(m => m.canView && m.actor);

    if (!visibleMembers.length) {
      ui.notifications.warn(t("UESRPG.Notifications.Group.NoMembersForRest"));
      return;
    }

    const lines = [];
    for (const member of visibleMembers) {
      const { line } = await applyShortRest(member.actor);
      if (line) lines.push(line);
    }

    const timeForward = await forwardTimeForGroupRest({
      restType: "short",
      actor: this.document,
      actorLabel: this.document?.name ?? null,
    });

    const content = buildRestChatContent("Short Rest (1 hour)", lines);
    await requestUpdateDocument(this.document, {
      "system.lastRest.short": game.time.worldTime,
    });
    await ChatMessage.create({
      user: game.user.id,
      speaker: { alias: this.document.name },
      content,
      whisper: this.#getGMUserIds(),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
    await this.render(false);
    if (!timeForward.applied && timeForward.reason && timeForward.reason.includes("did not change")) {
      ui.notifications.warn(tf("UESRPG.Notifications.Group.ShortRestCompletedReason", { reason: timeForward.reason }));
    } else if (timeForward.applied) {
      ui.notifications.info(t("UESRPG.Notifications.Group.ShortRestAdvancedHour"));
    } else {
      ui.notifications.info(t("UESRPG.Notifications.Group.ShortRestCompleted"));
    }
  }

  /** Apply long rest to all visible group members */
  async _onLongRest(_event, _target) {
    const members = await this.#resolveMembers(
      this.document.system.members || []
    );
    const visibleMembers = members.filter(m => m.canView && m.actor);

    if (!visibleMembers.length) {
      ui.notifications.warn(t("UESRPG.Notifications.Group.NoMembersForRest"));
      return;
    }

    const lines = [];
    for (const member of visibleMembers) {
      const { line } = await applyLongRest(member.actor);
      if (line) lines.push(line);
    }

    const timeForward = await forwardTimeForGroupRest({
      restType: "long",
      actor: this.document,
      actorLabel: this.document?.name ?? null,
    });

    const content = buildRestChatContent("Long Rest (8 hours)", lines);
    await requestUpdateDocument(this.document, {
      "system.lastRest.long": game.time.worldTime,
    });
    await ChatMessage.create({
      user: game.user.id,
      speaker: { alias: this.document.name },
      content,
      whisper: this.#getGMUserIds(),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
    await this.render(false);
    if (!timeForward.applied && timeForward.reason && timeForward.reason.includes("did not change")) {
      ui.notifications.warn(tf("UESRPG.Notifications.Group.LongRestCompletedReason", { reason: timeForward.reason }));
    } else if (timeForward.applied && timeForward.mode === "sunrise") {
      ui.notifications.info(t("UESRPG.Notifications.Group.LongRestAdvancedSunrise"));
    } else if (timeForward.applied) {
      ui.notifications.info(t("UESRPG.Notifications.Group.LongRestAdvancedHours"));
    } else {
      ui.notifications.info(t("UESRPG.Notifications.Group.LongRestCompleted"));
    }
  }

  /** Deploy group members as tokens on the active canvas (GM only) */
  async _onDeployGroup(_event, _target) {
    if (!game.user.isGM) {
      ui.notifications.warn(t("UESRPG.Notifications.Group.OnlyGmDeploy"));
      return;
    }
    if (!canvas.ready || !canvas.scene) {
      ui.notifications.warn(t("UESRPG.Notifications.Group.CanvasNotReady"));
      return;
    }

    const members = await this.#resolveMembers(
      this.document.system.members || []
    );
    const deployable = members.filter(m => m.actor && !m.missing);

    if (!deployable.length) {
      ui.notifications.warn(t("UESRPG.Notifications.Group.NoMembersToDeploy"));
      return;
    }

    let didMinimize = false;
    let placedCount = 0;
    let cancelled = false;

    try {
      if (!this.minimized && typeof this.minimize === "function") {
        await this.minimize();
        didMinimize = true;
      }

      for (let i = 0; i < deployable.length; i++) {
        const actor = deployable[i].actor;
        try {
          const tokenData = await actor.getTokenDocument();
          const tokenWidth = Math.max(1, Number(tokenData.width) || 1);
          const tokenHeight = Math.max(1, Number(tokenData.height) || 1);
          const picked = await pickCanvasLocation({
            label: tf("UESRPG.Dialogs.GroupSheet.PlaceActor", {
              actor: actor.name,
              current: i + 1,
              total: deployable.length,
            }),
            tokenWidth,
            tokenHeight,
            timeout: 60_000,
          });
          if (!picked) {
            cancelled = true;
            break;
          }

          await canvas.scene.createEmbeddedDocuments("Token", [{
            ...tokenData.toObject(),
            x: picked.x,
            y: picked.y,
            hidden: false,
          }]);
          placedCount += 1;
        } catch (err) {
          console.error(`UESRPG | Failed to deploy token for ${actor.name}`, err);
          ui.notifications.warn(tf("UESRPG.Notifications.Group.CouldNotDeployToken", { actor: actor.name }));
        }
      }
    } finally {
      if (didMinimize && typeof this.maximize === "function") {
        await this.maximize();
        this.bringToTop?.();
      }
    }

    if (placedCount > 0 && cancelled) {
      ui.notifications.info(tf("UESRPG.Notifications.Group.DeploymentStopped", { count: placedCount }));
    } else if (placedCount > 0) {
      ui.notifications.info(tf("UESRPG.Notifications.Group.DeployedMembers", { count: placedCount }));
    } else {
      ui.notifications.warn(t("UESRPG.Notifications.Group.NoTokensDeployed"));
    }
  }

  async _onOpenArmyCampaign(event, _target) {
    event?.preventDefault?.();
    await openArmyCampaignApp(this.document);
  }

  /** Show item creation dialog with type selection */
  async _onItemCreate(_event, _target) {
    const type = await customDialog({
      title: t("UESRPG.Dialogs.GroupSheet.CreateItemTitle"),
      content: `<p>${t("UESRPG.Dialogs.GroupSheet.SelectItemType")}</p>`,
      buttons: {
        weapon: { label: t("TYPES.Item.weapon") },
        armor: { label: t("TYPES.Item.armor") },
        shield: { label: t("TYPES.Item.shield") },
        ammunition: { label: t("TYPES.Item.ammunition") },
        container: { label: t("TYPES.Item.container") },
        equipment: { label: t("TYPES.Item.equipment") },
      },
    });
    if (!type) return;

    const name = `New ${type.charAt(0).toUpperCase() + type.slice(1)}`;
    await requestCreateEmbeddedDocuments(this.document, "Item", [{ name, type }]);
  }

  async _onItemEquip(event, target) {
    event?.preventDefault?.();
    if (!this.document.isOwner) return;
    const itemId = target?.closest?.(".item")?.dataset?.itemId;
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (!item) return;
    const next = target instanceof HTMLInputElement ? Boolean(target.checked) : !Boolean(item.system?.equipped);
    await setOwnedItemEquipped({ item, equipped: next });
  }

  async _onToggleGroupCollapse(event, target) {
    this._hideSkillDebriefTooltip();
    return onToggleGroupCollapse(this, event, target);
  }

  async _onWealthCalc(event, _target) {
    event?.preventDefault?.();
    if (!this.document?.isOwner) return;

    await customDialog({
      title: t("UESRPG.Sheets.Equipment.AddSubtract"),
      content: `<div class="dialogForm">
        <div class="form-group">
          <label><i class="fas fa-coins"></i> <b>${t("UESRPG.Sheets.Equipment.Wealth")}</b></label>
          <input name="wealthDelta" placeholder="ex. -20, +10" value="0" type="text" style="text-align:center;width:50%;">
        </div>
      </div>`,
      buttons: {
        cancel: { label: t("UESRPG.UI.Cancel", "Cancel") },
        submit: {
          label: t("UESRPG.UI.Submit", "Submit"),
          icon: "fas fa-check",
          callback: async (html) => {
            const el = html instanceof HTMLElement ? html : html?.[0];
            const delta = parseInt(el?.querySelector?.("[name='wealthDelta']")?.value, 10) || 0;
            const wealth = Number(this.document?.flags?.[SYSTEM_ID]?.groupWealth ?? 0);
            await requestUpdateDocument(this.document, { [`flags.${SYSTEM_ID}.groupWealth`]: wealth + delta });
          },
        },
      },
      default: "submit",
    });
  }

  async _onPlusQty(event, target) {
    event?.preventDefault?.();
    if (!this.document.isOwner) return;
    const itemId = target?.closest?.(".item")?.dataset?.itemId;
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (!item) return;
    const qty = Number(item.system.quantity ?? 0);
    await setOwnedItemQuantityOrDelete({ item, quantity: qty + 1 });
  }

  async _onMinusQty(event, target) {
    event?.preventDefault?.();
    if (!this.document.isOwner) return;
    const itemId = target?.closest?.(".item")?.dataset?.itemId;
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (!item) return;
    const qty = Number(item.system.quantity ?? 0);
    const next = Math.max(qty - 1, 0);
    if (next === 0 && qty > 0) ui.notifications.info(tf("UESRPG.Notifications.Group.UsedLastItem", { item: item.name }));
    await setOwnedItemQuantityOrDelete({ item, quantity: next });
  }

  /** Delete an item with confirmation and container safety */
  async _onItemDelete(event, target) {
    if (!this.document.isOwner) return;

    const itemId = target.closest(".item")?.dataset?.itemId;
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (!item) return;

    const escaped = item.name
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

    const confirmed = await confirmDialog({
      title: t("UESRPG.Dialogs.GroupSheet.DeleteItemTitle"),
      content: `<p>${tf("UESRPG.Dialogs.GroupSheet.DeleteItemContent", { item: escaped })}</p>`,
    });
    if (!confirmed) return;

    // Container-safe deletion
    if (item.type === "container") {
      await unlinkAllItemsFromContainer(this.document, item);
    } else {
      await unlinkItemFromContainer(this.document, item);
    }

    await requestDeleteEmbeddedDocuments(this.document, "Item", [itemId]);
    ui.notifications.info(tf("UESRPG.Notifications.Group.ItemDeleted", { item: item.name }));
  }

  /** Open an item's sheet */
  async _onItemShow(event, target) {
    const itemId = target.closest(".item")?.dataset?.itemId;
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (item) item.sheet.render(true);
  }

  async _onDuplicateItem(event, target) {
    if (event?.type !== "contextmenu") return this._onItemShow(event, target);
    event.preventDefault();
    if (!this.document.isOwner) return;
    const itemId = target?.closest?.(".item")?.dataset?.itemId;
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (item) await this.#duplicateItem(item);
  }

  /** Open a container item's sheet from the backpack icon */
  async _onOpenContainer(event, target) {
    const containerId = target.dataset?.containerId;
    if (!containerId) return;
    const container = this.document.items.get(containerId);
    if (container) container.sheet.render(true);
  }
}
