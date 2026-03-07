const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

import { customDialog, confirmDialog } from "../../../utils/dialog-v2-helper.js";
import {
  getTravelPlannerState,
  updateTravelPlannerState,
  resetTravelPlannerState,
} from "../../../core/travel/state.js";
import {
  computePlanningTotals,
  validateHasteAssignments,
  getNavigateOutcomeAdvice,
} from "../../../core/travel/rules.js";
import {
  getActorSkillOptions,
  getActorCharacteristicOptions,
  performTravelAssignmentRoll,
} from "../../../core/travel/rolls.js";
import {
  rollMappedEvent,
  createStarterEventTablesForGroup,
  setMappedTable,
  addMappedTableEntry,
  removeMappedTableEntry,
  getMappedTableUuids,
} from "../../../core/travel/events.js";
import { TRAVEL_TERRAINS } from "../../../core/travel/data/terrain-modifiers.js";
import { TRAVEL_ENDEAVOURS, getTravelEndeavour } from "../../../core/travel/data/travel-endeavours.js";
import { CAMP_ENDEAVOURS, getCampEndeavour } from "../../../core/travel/data/camp-endeavours.js";
import { PLANNING_BENEFITS, PLANNING_IMPAIRMENTS } from "../../../core/travel/data/planning-effects.js";
import { SKILL_DIFFICULTIES } from "../../../core/skills/skill-tn.js";
import { applyShortRest, applyLongRest, buildRestChatContent } from "../../sheets/rest-workflow.js";
import { forwardTimeForGroupRest } from "../../../core/time/rest-time-forwarding.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { SYSTEM_ID, templatePath } from "../../constants.js";

const TEMPLATE_PATH = templatePath("v2/apps/travel-planner.hbs");
const TRACKER_DEFAULT_EFFECTS = {
  benefit: "favorableWeather",
  impairment: "extraFatigue",
};

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function actorImg(actor) {
  return actor?.img || "icons/svg/mystery-man.svg";
}

function createPlanningEntry() {
  return {
    id: foundry.utils.randomID(),
    actorUuid: "",
    testMode: "skill",
    skillUuid: "",
    charKey: "int",
    difficultyKey: "average",
    manualMod: 0,
    useSpec: false,
    result: null,
    note: "",
  };
}

function createJourneyEntry() {
  return {
    id: foundry.utils.randomID(),
    terrain: "lightWoodland",
    currentStage: 1,
    totalStages: 1,
  };
}

function createPhaseAssignment(phase) {
  if (phase === "camping") {
    const first = CAMP_ENDEAVOURS[0];
    return {
      id: foundry.utils.randomID(),
      endeavourKey: first?.key ?? "cook",
      actorUuid: "",
      testMode: first?.defaultTestMode ?? "skill",
      skillUuid: "",
      charKey: first?.suggestedCharacteristics?.[0] ?? "int",
      difficultyKey: "average",
      manualMod: 0,
      terrainMod: 0,
      useSpec: false,
      note: "",
      result: null,
      advice: null,
    };
  }

  const first = TRAVEL_ENDEAVOURS[0];
  return {
    id: foundry.utils.randomID(),
    endeavourKey: first?.key ?? "navigate",
    actorUuid: "",
    testMode: first?.defaultTestMode ?? "skill",
    skillUuid: "",
    charKey: first?.suggestedCharacteristics?.[0] ?? "int",
    difficultyKey: "average",
    manualMod: 0,
    terrainMod: 0,
    useSpec: false,
    note: "",
    result: null,
    advice: null,
  };
}

function availableSpends(totals) {
  const t = totals ?? {};
  return {
    benefits: Math.max(0, toNum(t.benefits) - toNum(t.spentBenefits)),
    impairments: Math.max(0, toNum(t.impairments) - toNum(t.spentImpairments)),
  };
}

function buildSpendTracker(total, spent) {
  const t = Math.max(0, Number(total || 0));
  const s = Math.max(0, Math.min(t, Number(spent || 0)));
  const out = [];
  for (let i = 0; i < t; i += 1) {
    out.push({ idx: i + 1, spent: i < s, available: i >= s });
  }
  return out;
}

function hasRowRollInputs(row) {
  if (!row?.actorUuid) return false;
  if (String(row?.testMode ?? "skill") === "characteristic") return Boolean(String(row?.charKey ?? "").trim());
  return Boolean(String(row?.skillUuid ?? "").trim());
}

function normalizeJourneyEntries(state) {
  const rows = ensureArray(state?.session?.journeyEntries);
  if (!rows.length) {
    return [createJourneyEntry()];
  }
  return rows.map((r) => ({
    id: String(r?.id ?? foundry.utils.randomID()),
    terrain: String(r?.terrain ?? "lightWoodland"),
    currentStage: Math.max(1, Number(r?.currentStage ?? 1)),
    totalStages: Math.max(1, Number(r?.totalStages ?? 1)),
  }));
}

function selectedJourneyEntry(state) {
  const rows = normalizeJourneyEntries(state);
  const activeId = String(state?.session?.activeJourneyEntryId ?? "");
  return rows.find((r) => String(r.id) === activeId) ?? rows[0] ?? null;
}

function findTerrainLabel(key) {
  return TRAVEL_TERRAINS.find((t) => t.key === key)?.label ?? key;
}

function spendEffectLabel(type, effectKey, note) {
  if (effectKey === "custom") return note ? `Custom: ${note}` : "Custom";
  const pool = type === "benefit" ? PLANNING_BENEFITS : PLANNING_IMPAIRMENTS;
  const found = pool.find((e) => String(e.key) === String(effectKey));
  return found?.label ?? String(effectKey);
}

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function getAssignmentMeta(phase, key) {
  if (phase === "camping") return getCampEndeavour(key);
  return getTravelEndeavour(key);
}

async function resolveActorFromUuid(uuid) {
  if (!uuid) return null;
  const actor = await fromUuid(String(uuid));
  if (actor?.documentName !== "Actor") return null;
  return actor;
}

export class TravelPlannerAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "uesrpg-travel-planner",
    classes: ["uesrpg", "uesrpg-travel-planner"],
    tag: "form",
    position: { width: 920, height: 740 },
    window: {
      title: "Travel Planner",
      resizable: true,
    },
    form: {
      submitOnChange: false,
      closeOnSubmit: false,
    },
    dragDrop: [{ dragSelector: "[data-drag-actor-uuid]", dropSelector: ".uesrpg-travel-planner-root" }],
    actions: {
      switchTab: TravelPlannerAppV2.prototype._onSwitchTab,
      addJourneyEntry: TravelPlannerAppV2.prototype._onAddJourneyEntry,
      removeJourneyEntry: TravelPlannerAppV2.prototype._onRemoveJourneyEntry,
      useJourneyEntry: TravelPlannerAppV2.prototype._onUseJourneyEntry,
      shortRestGroup: TravelPlannerAppV2.prototype._onShortRestGroup,
      longRestGroup: TravelPlannerAppV2.prototype._onLongRestGroup,
      addPlanningEntry: TravelPlannerAppV2.prototype._onAddPlanningEntry,
      removePlanningEntry: TravelPlannerAppV2.prototype._onRemovePlanningEntry,
      rollPlanningEntry: TravelPlannerAppV2.prototype._onRollPlanningEntry,
      clearPlanningResult: TravelPlannerAppV2.prototype._onClearPlanningResult,
      addTravelAssignment: TravelPlannerAppV2.prototype._onAddTravelAssignment,
      removeTravelAssignment: TravelPlannerAppV2.prototype._onRemoveTravelAssignment,
      rollTravelAssignment: TravelPlannerAppV2.prototype._onRollTravelAssignment,
      clearTravelResult: TravelPlannerAppV2.prototype._onClearTravelResult,
      applyNavigateAdvice: TravelPlannerAppV2.prototype._onApplyNavigateAdvice,
      addCampAssignment: TravelPlannerAppV2.prototype._onAddCampAssignment,
      removeCampAssignment: TravelPlannerAppV2.prototype._onRemoveCampAssignment,
      rollCampAssignment: TravelPlannerAppV2.prototype._onRollCampAssignment,
      clearCampResult: TravelPlannerAppV2.prototype._onClearCampResult,
      rollTravelEvent: TravelPlannerAppV2.prototype._onRollTravelEvent,
      rollCampEvent: TravelPlannerAppV2.prototype._onRollCampEvent,
      addTravelTableEntry: TravelPlannerAppV2.prototype._onAddTravelTableEntry,
      removeTravelTableEntry: TravelPlannerAppV2.prototype._onRemoveTravelTableEntry,
      addCampingTableEntry: TravelPlannerAppV2.prototype._onAddCampingTableEntry,
      removeCampingTableEntry: TravelPlannerAppV2.prototype._onRemoveCampingTableEntry,
      incrementResource: TravelPlannerAppV2.prototype._onIncrementResource,
      decrementResource: TravelPlannerAppV2.prototype._onDecrementResource,
      clearTravelTable: TravelPlannerAppV2.prototype._onClearTravelTable,
      clearCampingTable: TravelPlannerAppV2.prototype._onClearCampingTable,
      createStarterTables: TravelPlannerAppV2.prototype._onCreateStarterTables,
      spendBenefit: TravelPlannerAppV2.prototype._onSpendBenefit,
      spendImpairment: TravelPlannerAppV2.prototype._onSpendImpairment,
      spendCustomBenefit: TravelPlannerAppV2.prototype._onSpendCustomBenefit,
      spendCustomImpairment: TravelPlannerAppV2.prototype._onSpendCustomImpairment,
      trackerSpendBenefit: TravelPlannerAppV2.prototype._onTrackerSpendBenefit,
      trackerSpendImpairment: TravelPlannerAppV2.prototype._onTrackerSpendImpairment,
      trackerUndoBenefit: TravelPlannerAppV2.prototype._onTrackerUndoBenefit,
      trackerUndoImpairment: TravelPlannerAppV2.prototype._onTrackerUndoImpairment,
      removeSpend: TravelPlannerAppV2.prototype._onRemoveSpend,
      duplicateTravelAssignment: TravelPlannerAppV2.prototype._onDuplicateTravelAssignment,
      duplicateCampAssignment: TravelPlannerAppV2.prototype._onDuplicateCampAssignment,
      resetPlanner: TravelPlannerAppV2.prototype._onResetPlanner,
    },
  };

  static PARTS = {
    planner: { template: TEMPLATE_PATH },
  };

  constructor(options = {}) {
    super(options);
    this._groupUuid = options.groupUuid ?? null;
    this._initialTab = String(options.tab ?? "planning");
    this._memberCache = [];
  }

  async setActiveTab(tab) {
    const key = String(tab || "planning");
    await this.#mutateState((next) => {
      next.ui.activeTab = key;
      return next;
    });
  }

  get title() {
    return "Travel Planner";
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const group = await this.#resolveGroup();
    if (!group) return { ...context, error: "Group actor not found." };

    const state = getTravelPlannerState(group);
    if (!state?.ui?.activeTab && this._initialTab) state.ui.activeTab = this._initialTab;

    const members = await this.#resolveGroupMembers(group);
    this._memberCache = members;
    const actorOptions = members.map((m) => ({
      uuid: m.uuid,
      name: m.name,
      img: m.img,
    }));

    const planningTotals = computePlanningTotals(state.planning.entries, state.planning.spends);
    const spendable = availableSpends(planningTotals);
    const benefitTracker = buildSpendTracker(planningTotals.benefits, planningTotals.spentBenefits);
    const impairmentTracker = buildSpendTracker(planningTotals.impairments, planningTotals.spentImpairments);
    const spendRows = ensureArray(state.planning.spends).map((s) => ({
      ...s,
      effectLabel: spendEffectLabel(s.type, s.effectKey, s.note),
      typeLabel: s.type === "benefit" ? "Benefit" : "Impairment",
    }));
    const journeyEntries = normalizeJourneyEntries(state);
    const activeJourney = selectedJourneyEntry(state);
    const terrainKey = String(activeJourney?.terrain ?? state?.session?.terrain ?? "lightWoodland");
    const tableOptions = (game.tables ?? [])
      .map((t) => ({ uuid: t.uuid, name: t.name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const planningRows = ensureArray(state.planning.entries).map((row) => this.#enrichPlanningRow(row, members));
    const travelRows = ensureArray(state.travel.assignments).map((row) => this.#enrichPhaseRow("travel", row, members, state));
    const campRows = ensureArray(state.camping.assignments).map((row) => this.#enrichPhaseRow("camping", row, members, state));
    const hasteValidation = validateHasteAssignments(state.travel.assignments, members.length);

    const travelTableUuids = getMappedTableUuids(state, "travel", terrainKey);
    const campTableUuids = getMappedTableUuids(state, "camping", terrainKey);
    const travelEventRows = (travelTableUuids.length ? travelTableUuids : [""]).map((uuid, idx) => ({
      idx,
      uuid: String(uuid || ""),
      name: tableOptions.find((t) => String(t.uuid) === String(uuid))?.name ?? "",
    }));
    const campEventRows = (campTableUuids.length ? campTableUuids : [""]).map((uuid, idx) => ({
      idx,
      uuid: String(uuid || ""),
      name: tableOptions.find((t) => String(t.uuid) === String(uuid))?.name ?? "",
    }));
    const terrainModifierOptions = [-30, -20, -10, 0, 10, 20, 30].map((value) => ({
      value,
      label: `${value >= 0 ? "+" : ""}${value}`,
    }));

    return {
      ...context,
      group,
      state,
      editable: Boolean(group.isOwner),
      activeTab: String(state.ui.activeTab ?? "planning"),
      journeyEntries,
      activeJourneyEntryId: String(state?.session?.activeJourneyEntryId ?? activeJourney?.id ?? ""),
      terrains: TRAVEL_TERRAINS,
      terrainLabel: findTerrainLabel(terrainKey),
      difficultyOptions: SKILL_DIFFICULTIES,
      actorOptions,
      members,
      planningRows,
      travelRows,
      campRows,
      planningTotals,
      spendable,
      benefitTracker,
      impairmentTracker,
      spendRows,
      planningBenefits: PLANNING_BENEFITS,
      planningImpairments: PLANNING_IMPAIRMENTS,
      travelEndeavours: TRAVEL_ENDEAVOURS,
      campEndeavours: CAMP_ENDEAVOURS,
      tableOptions,
      travelEventRows,
      campEventRows,
      terrainModifierOptions,
      hasteValidation,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!root) return;
    root.querySelectorAll("[data-drag-actor-uuid]").forEach((el) => {
      el.addEventListener("dragstart", (event) => {
        const uuid = String(el.dataset.dragActorUuid ?? "");
        if (!uuid) return;
        event.dataTransfer?.setData("text/plain", JSON.stringify({ type: "Actor", uuid }));
      });
    });
  }

  _canDragDrop(_selector) {
    return true;
  }

  async _onDrop(event) {
    const group = await this.#resolveGroup();
    if (!group) return;

    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const rowSlot = event?.target?.closest?.("[data-assign-drop]");
    if (data?.type === "Actor" && rowSlot) {
      const actor = await resolveActorFromUuid(data.uuid);
      if (!actor) return;
      const members = this._memberCache ?? [];
      if (!members.some((m) => String(m.uuid) === String(actor.uuid))) {
        ui.notifications.warn("Only Group members can be assigned by drag-and-drop.");
        return;
      }
      const phase = String(rowSlot.dataset.phase ?? "");
      const rowId = String(rowSlot.dataset.assignId ?? "");
      if (!phase || !rowId) return;
      await this.#mutateState((next) => {
        const rows = phase === "planning"
          ? next.planning.entries
          : phase === "camping"
            ? next.camping.assignments
            : next.travel.assignments;
        const row = ensureArray(rows).find((r) => String(r.id) === rowId);
        if (!row) return next;
        row.actorUuid = actor.uuid;
        row.skillUuid = "";
        return next;
      });
      return;
    }

    return super._onDrop(event);
  }

  _onChangeForm(formConfig, event) {
    super._onChangeForm(formConfig, event);
    const target = event?.target;
    if (!(target instanceof HTMLElement)) return;
    const name = String(target.getAttribute("name") ?? "").trim();
    if (!name) return;
    const value = target instanceof HTMLInputElement && target.type === "checkbox"
      ? Boolean(target.checked)
      : target instanceof HTMLInputElement && target.type === "number"
        ? Number(target.value || 0)
        : String(target.value ?? "");

    if (name.startsWith("journey:")) {
      const [, rowId, field] = name.split(":");
      void this.#updateJourneyField(rowId, field, value);
      return;
    }

    if (name === "session.navigateLostPenaltyActive") {
      void this.#mutateState((next) => {
        next.session.navigateLostPenaltyActive = Boolean(value);
        return next;
      });
      return;
    }

    if (name.startsWith("travel.resources.")) {
      const field = name.split(".")[2];
      void this.#mutateState((next) => {
        next.travel.resources[field] = Math.max(0, Number(value || 0));
        return next;
      });
      return;
    }

    if (name.startsWith("travel.shortfalls.")) {
      const field = name.split(".")[2];
      void this.#mutateState((next) => {
        next.travel.shortfalls[field] = Boolean(value);
        return next;
      });
      return;
    }

    if (name.startsWith("table:")) {
      const [, phase, idxRaw] = name.split(":");
      const index = Math.max(0, Number(idxRaw ?? 0));
      void this.#setTerrainTableFromSelect(phase, String(value || ""), index);
      return;
    }

    if (name.startsWith("planning:")) {
      const [, rowId, field] = name.split(":");
      void this.#updateRowField("planning", rowId, field, value);
      return;
    }

    if (name.startsWith("travel:")) {
      const [, rowId, field] = name.split(":");
      void this.#updateRowField("travel", rowId, field, value);
      return;
    }

    if (name.startsWith("camping:")) {
      const [, rowId, field] = name.split(":");
      void this.#updateRowField("camping", rowId, field, value);
    }
  }

  async #setTerrainTableFromSelect(phase, tableUuid, index = 0) {
    const group = await this.#resolveGroup();
    if (!group?.isOwner) return;
    const state = getTravelPlannerState(group);
    const terrain = String(state.session.terrain ?? "lightWoodland");
    await setMappedTable(group, phase, terrain, tableUuid || "", { index });
    await this.render();
  }

  async #updateJourneyField(rowId, field, value) {
    await this.#mutateState((next) => {
      next.session.journeyEntries = normalizeJourneyEntries(next);
      const row = next.session.journeyEntries.find((r) => String(r.id) === String(rowId));
      if (!row) return next;
      if (field === "terrain") row.terrain = String(value || "lightWoodland");
      if (field === "currentStage") row.currentStage = Math.max(1, Number(value || 1));
      if (field === "totalStages") {
        row.totalStages = Math.max(1, Number(value || 1));
        row.currentStage = Math.min(row.currentStage, row.totalStages);
      }
      if (String(next.session.activeJourneyEntryId || "") === String(row.id)) {
        next.session.terrain = String(row.terrain ?? "lightWoodland");
        next.session.currentStage = Math.max(1, Number(row.currentStage ?? 1));
        next.session.totalStages = Math.max(next.session.currentStage, Number(row.totalStages ?? 1));
      }
      return next;
    });
  }

  async #updateRowField(phase, rowId, field, value) {
    await this.#mutateState((next) => {
      const rows = phase === "planning"
        ? next.planning.entries
        : phase === "camping"
          ? next.camping.assignments
          : next.travel.assignments;
      const row = ensureArray(rows).find((r) => String(r.id) === String(rowId));
      if (!row) return next;
      if (field === "manualMod") row[field] = Number(value || 0);
      else if (field === "terrainMod") row[field] = Number(value || 0);
      else if (field === "useSpec") row[field] = Boolean(value);
      else row[field] = value;

      if (field === "endeavourKey") {
        const meta = getAssignmentMeta(phase, row.endeavourKey);
        if (meta) {
          row.testMode = meta.defaultTestMode ?? "skill";
          if (Array.isArray(meta.suggestedCharacteristics) && meta.suggestedCharacteristics.length) {
            row.charKey = String(meta.suggestedCharacteristics[0]);
          }
        }
        row.result = null;
        row.advice = null;
      }
      if (field === "actorUuid") {
        row.skillUuid = "";
        row.result = null;
        row.advice = null;
      }
      if (phase === "planning") {
        next.planning.totals = computePlanningTotals(next.planning.entries, next.planning.spends);
      }
      return next;
    });
  }

  async _onSwitchTab(event, target) {
    event?.preventDefault?.();
    const tab = String(target?.dataset?.tab ?? "planning");
    await this.setActiveTab(tab);
  }

  async _onAddJourneyEntry(event) {
    event?.preventDefault?.();
    await this.#mutateState((next) => {
      next.session.journeyEntries = normalizeJourneyEntries(next);
      const entry = createJourneyEntry();
      next.session.journeyEntries.push(entry);
      return next;
    });
  }

  async _onRemoveJourneyEntry(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#mutateState((next) => {
      next.session.journeyEntries = normalizeJourneyEntries(next).filter((r) => String(r.id) !== id);
      if (!next.session.journeyEntries.length) {
        const fallback = createJourneyEntry();
        next.session.journeyEntries = [fallback];
        next.session.activeJourneyEntryId = fallback.id;
      }
      if (!next.session.journeyEntries.some((r) => String(r.id) === String(next.session.activeJourneyEntryId))) {
        next.session.activeJourneyEntryId = String(next.session.journeyEntries[0]?.id ?? "");
      }
      const active = selectedJourneyEntry(next);
      if (active) {
        next.session.terrain = active.terrain;
        next.session.currentStage = active.currentStage;
        next.session.totalStages = active.totalStages;
      }
      return next;
    });
  }

  async _onUseJourneyEntry(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#mutateState((next) => {
      next.session.journeyEntries = normalizeJourneyEntries(next);
      const row = next.session.journeyEntries.find((r) => String(r.id) === id);
      if (!row) return next;
      next.session.activeJourneyEntryId = row.id;
      next.session.terrain = row.terrain;
      next.session.currentStage = row.currentStage;
      next.session.totalStages = row.totalStages;
      return next;
    });
  }

  async _onShortRestGroup(event) {
    event?.preventDefault?.();
    await this.#applyGroupRest("short");
  }

  async _onLongRestGroup(event) {
    event?.preventDefault?.();
    await this.#applyGroupRest("long");
  }

  async _onAddPlanningEntry(event) {
    event?.preventDefault?.();
    await this.#mutateState((next) => {
      next.planning.entries.push(createPlanningEntry());
      next.planning.totals = computePlanningTotals(next.planning.entries, next.planning.spends);
      return next;
    });
  }

  async _onRemovePlanningEntry(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#mutateState((next) => {
      next.planning.entries = next.planning.entries.filter((r) => String(r.id) !== id);
      next.planning.totals = computePlanningTotals(next.planning.entries, next.planning.spends);
      return next;
    });
  }

  async _onClearPlanningResult(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#mutateState((next) => {
      const row = next.planning.entries.find((r) => String(r.id) === id);
      if (row) row.result = null;
      next.planning.totals = computePlanningTotals(next.planning.entries, next.planning.spends);
      return next;
    });
  }

  async _onRollPlanningEntry(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#rollEntry("planning", id);
  }

  async _onAddTravelAssignment(event) {
    event?.preventDefault?.();
    await this.#mutateState((next) => {
      next.travel.assignments.push(createPhaseAssignment("travel"));
      return next;
    });
  }

  async _onRemoveTravelAssignment(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#mutateState((next) => {
      next.travel.assignments = next.travel.assignments.filter((r) => String(r.id) !== id);
      return next;
    });
  }

  async _onClearTravelResult(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#mutateState((next) => {
      const row = next.travel.assignments.find((r) => String(r.id) === id);
      if (row) {
        row.result = null;
        row.advice = null;
      }
      return next;
    });
  }

  async _onRollTravelAssignment(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#rollEntry("travel", id);
  }

  async _onApplyNavigateAdvice(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#mutateState((next) => {
      const row = next.travel.assignments.find((r) => String(r.id) === id);
      if (!row?.advice?.key) return next;
      if (row.advice.key === "navigate-shortcut") {
        next.session.totalStages = Math.max(1, Number(next.session.totalStages || 1) - 1);
        next.session.currentStage = Math.min(next.session.currentStage, next.session.totalStages);
      } else if (row.advice.key === "navigate-lost") {
        next.session.totalStages = Math.max(1, Number(next.session.totalStages || 1) + 1);
      } else if (row.advice.key === "navigate-lost-severe") {
        next.session.totalStages = Math.max(1, Number(next.session.totalStages || 1) + 1);
        next.session.navigateLostPenaltyActive = true;
      }
      row.advice.applied = true;
      next.history.stageSummaries.push({
        id: foundry.utils.randomID(),
        stage: Number(next.session.currentStage || 1),
        note: `${row.advice.label}: ${row.advice.description}`,
        at: Date.now(),
      });
      return next;
    });
  }

  async _onAddCampAssignment(event) {
    event?.preventDefault?.();
    await this.#mutateState((next) => {
      next.camping.assignments.push(createPhaseAssignment("camping"));
      return next;
    });
  }

  async _onRemoveCampAssignment(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#mutateState((next) => {
      next.camping.assignments = next.camping.assignments.filter((r) => String(r.id) !== id);
      return next;
    });
  }

  async _onClearCampResult(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#mutateState((next) => {
      const row = next.camping.assignments.find((r) => String(r.id) === id);
      if (row) {
        row.result = null;
        row.advice = null;
      }
      return next;
    });
  }

  async _onRollCampAssignment(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#rollEntry("camping", id);
  }

  async _onRollTravelEvent(event, target) {
    event?.preventDefault?.();
    const idx = Math.max(0, Number(target?.dataset?.tableIndex ?? 0));
    await this.#rollEvent("travel", idx);
  }

  async _onRollCampEvent(event, target) {
    event?.preventDefault?.();
    const idx = Math.max(0, Number(target?.dataset?.tableIndex ?? 0));
    await this.#rollEvent("camping", idx);
  }

  async _onAddTravelTableEntry(event) {
    event?.preventDefault?.();
    const group = await this.#resolveGroup();
    if (!group?.isOwner) return;
    const state = getTravelPlannerState(group);
    const terrain = String(state.session.terrain ?? "lightWoodland");
    await addMappedTableEntry(group, "travel", terrain);
    await this.render();
  }

  async _onRemoveTravelTableEntry(event, target) {
    event?.preventDefault?.();
    const group = await this.#resolveGroup();
    if (!group?.isOwner) return;
    const state = getTravelPlannerState(group);
    const terrain = String(state.session.terrain ?? "lightWoodland");
    const idx = Math.max(0, Number(target?.dataset?.tableIndex ?? 0));
    await removeMappedTableEntry(group, "travel", terrain, idx);
    await this.render();
  }

  async _onAddCampingTableEntry(event) {
    event?.preventDefault?.();
    const group = await this.#resolveGroup();
    if (!group?.isOwner) return;
    const state = getTravelPlannerState(group);
    const terrain = String(state.session.terrain ?? "lightWoodland");
    await addMappedTableEntry(group, "camping", terrain);
    await this.render();
  }

  async _onRemoveCampingTableEntry(event, target) {
    event?.preventDefault?.();
    const group = await this.#resolveGroup();
    if (!group?.isOwner) return;
    const state = getTravelPlannerState(group);
    const terrain = String(state.session.terrain ?? "lightWoodland");
    const idx = Math.max(0, Number(target?.dataset?.tableIndex ?? 0));
    await removeMappedTableEntry(group, "camping", terrain, idx);
    await this.render();
  }

  async _onIncrementResource(event, target) {
    event?.preventDefault?.();
    const field = String(target?.dataset?.field ?? "");
    if (!field) return;
    await this.#bumpResource(field, 1);
  }

  async _onDecrementResource(event, target) {
    event?.preventDefault?.();
    const field = String(target?.dataset?.field ?? "");
    if (!field) return;
    await this.#bumpResource(field, -1);
  }

  async _onClearTravelTable(event) {
    event?.preventDefault?.();
    const group = await this.#resolveGroup();
    if (!group?.isOwner) return;
    const state = getTravelPlannerState(group);
    const terrain = String(state.session.terrain ?? "lightWoodland");
    await setMappedTable(group, "travel", terrain, "", { index: 0 });
    await this.render();
  }

  async _onClearCampingTable(event) {
    event?.preventDefault?.();
    const group = await this.#resolveGroup();
    if (!group?.isOwner) return;
    const state = getTravelPlannerState(group);
    const terrain = String(state.session.terrain ?? "lightWoodland");
    await setMappedTable(group, "camping", terrain, "", { index: 0 });
    await this.render();
  }

  async _onCreateStarterTables(event) {
    event?.preventDefault?.();
    const group = await this.#resolveGroup();
    if (!group?.isOwner) return;
    await createStarterEventTablesForGroup(group, { overwrite: false });
    await this.render();
    ui.notifications.info("Starter travel/camping event tables are ready.");
  }

  async _onSpendBenefit(event, target) {
    event?.preventDefault?.();
    const effectKey = String(target?.dataset?.effectKey ?? "");
    if (!effectKey) return;
    await this.#recordSpend("benefit", effectKey, "");
  }

  async _onSpendImpairment(event, target) {
    event?.preventDefault?.();
    const effectKey = String(target?.dataset?.effectKey ?? "");
    if (!effectKey) return;
    await this.#recordSpend("impairment", effectKey, "");
  }

  async _onSpendCustomBenefit(event) {
    event?.preventDefault?.();
    const note = await this.#promptCustomNote("Spend Custom Benefit");
    if (!note) return;
    await this.#recordSpend("benefit", "custom", note);
  }

  async _onSpendCustomImpairment(event) {
    event?.preventDefault?.();
    const note = await this.#promptCustomNote("Spend Custom Impairment");
    if (!note) return;
    await this.#recordSpend("impairment", "custom", note);
  }

  async _onTrackerSpendBenefit(event) {
    event?.preventDefault?.();
    await this.#recordSpend("benefit", TRACKER_DEFAULT_EFFECTS.benefit, "");
  }

  async _onTrackerSpendImpairment(event) {
    event?.preventDefault?.();
    await this.#recordSpend("impairment", TRACKER_DEFAULT_EFFECTS.impairment, "");
  }

  async _onTrackerUndoBenefit(event) {
    event?.preventDefault?.();
    await this.#undoLatestSpendByType("benefit");
  }

  async _onTrackerUndoImpairment(event) {
    event?.preventDefault?.();
    await this.#undoLatestSpendByType("impairment");
  }

  async _onRemoveSpend(event, target) {
    event?.preventDefault?.();
    const spendId = String(target?.dataset?.spendId ?? "");
    if (!spendId) return;
    await this.#mutateState((next) => {
      const removed = next.planning.spends.find((s) => String(s.id) === spendId) ?? null;
      next.planning.spends = next.planning.spends.filter((s) => String(s.id) !== spendId);
      if (removed?.type === "impairment" && removed?.effectKey === "doubleEventWorst") {
        const stillExists = next.planning.spends.some((s) => s.type === "impairment" && s.effectKey === "doubleEventWorst");
        if (!stillExists) next.session.effectFlags.doubleEventWorstNext = false;
      }
      next.planning.totals = computePlanningTotals(next.planning.entries, next.planning.spends);
      return next;
    });
  }

  async _onDuplicateTravelAssignment(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#duplicatePhaseAssignment("travel", id);
  }

  async _onDuplicateCampAssignment(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.id ?? "");
    if (!id) return;
    await this.#duplicatePhaseAssignment("camping", id);
  }

  async _onResetPlanner(event) {
    event?.preventDefault?.();
    const ok = await confirmDialog({
      title: "Reset Travel Planner",
      content: "<p>Reset planner progress and assignments? Event table links will be kept.</p>",
      yesLabel: "Reset",
    });
    if (!ok) return;
    const group = await this.#resolveGroup();
    if (!group?.isOwner) return;
    await resetTravelPlannerState(group, { keepTables: true });
    await this.render();
  }

  async #promptCustomNote(title) {
    const content = `
      <div class="form-group">
        <label><b>Note</b></label>
        <input type="text" name="note" style="width:100%;" />
      </div>
    `;
    return customDialog({
      title,
      content,
      buttons: {
        ok: {
          label: "Spend",
          callback: (root) => String(root?.querySelector('input[name="note"]')?.value ?? "").trim(),
        },
        cancel: { label: "Cancel", callback: () => "" },
      },
      default: "ok",
      width: 420,
    });
  }

  async #recordSpend(type, effectKey, note) {
    let spendEntry = null;
    await this.#mutateState((next) => {
      const totals = computePlanningTotals(next.planning.entries, next.planning.spends);
      const spend = availableSpends(totals);
      if (type === "benefit" && spend.benefits <= 0) {
        ui.notifications.warn("No unspent benefits available.");
        return next;
      }
      if (type === "impairment" && spend.impairments <= 0) {
        ui.notifications.warn("No unspent impairments available.");
        return next;
      }
      spendEntry = {
        id: foundry.utils.randomID(),
        type,
        effectKey,
        note: String(note || ""),
        spentAt: Date.now(),
        spentBy: game.user.id,
      };
      next.planning.spends.push(spendEntry);
      if (type === "impairment" && effectKey === "doubleEventWorst") {
        next.session.effectFlags.doubleEventWorstNext = true;
      }
      next.planning.totals = computePlanningTotals(next.planning.entries, next.planning.spends);
      return next;
    });
    if (spendEntry) {
      await this.#postSpendChat({ type, effectKey, note });
    }
  }

  async #undoLatestSpendByType(type) {
    const targetType = String(type ?? "");
    await this.#mutateState((next) => {
      const rows = ensureArray(next.planning.spends);
      let idx = -1;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (String(rows[i]?.type ?? "") === targetType) {
          idx = i;
          break;
        }
      }
      if (idx < 0) {
        ui.notifications.warn(`No ${targetType} spends to undo.`);
        return next;
      }
      const [removed] = rows.splice(idx, 1);
      next.planning.spends = rows;
      if (removed?.type === "impairment" && removed?.effectKey === "doubleEventWorst") {
        const stillExists = rows.some((s) => s.type === "impairment" && s.effectKey === "doubleEventWorst");
        if (!stillExists) next.session.effectFlags.doubleEventWorstNext = false;
      }
      next.planning.totals = computePlanningTotals(next.planning.entries, next.planning.spends);
      return next;
    });
  }

  async #duplicatePhaseAssignment(phase, rowId) {
    await this.#mutateState((next) => {
      const rows = phase === "camping" ? next.camping.assignments : next.travel.assignments;
      const source = ensureArray(rows).find((r) => String(r.id) === String(rowId));
      if (!source) return next;
      const copy = foundry.utils.deepClone(source);
      copy.id = foundry.utils.randomID();
      copy.result = null;
      copy.advice = null;
      rows.push(copy);
      return next;
    });
  }

  async #postSpendChat({ type, effectKey, note }) {
    const group = await this.#resolveGroup();
    const label = spendEffectLabel(type, effectKey, note);
    const when = new Date().toLocaleString();
    await ChatMessage.create({
      user: game.user.id,
      speaker: { alias: "Travel Planner" },
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      content: `
        <div class="uesrpg-travel-roll-card">
          <h3>${type === "benefit" ? "Benefit Spent" : "Impairment Spent"}</h3>
          <p><b>Group:</b> ${esc(group?.name ?? "Unknown Group")}</p>
          <p><b>Effect:</b> ${esc(label)}</p>
          ${note ? `<p><b>Note:</b> ${esc(note)}</p>` : ""}
          <p><b>By:</b> ${esc(game.user?.name ?? "Unknown User")} | <b>At:</b> ${esc(when)}</p>
        </div>
      `,
    });
  }

  async #rollEntry(phase, rowId) {
    const group = await this.#resolveGroup();
    if (!group?.isOwner) {
      ui.notifications.warn("You do not have permission to roll from this planner.");
      return;
    }

    const state = getTravelPlannerState(group);
    const rows = phase === "planning"
      ? state.planning.entries
      : phase === "camping"
        ? state.camping.assignments
        : state.travel.assignments;
    const row = ensureArray(rows).find((r) => String(r.id) === String(rowId));
    if (!row) return;
    if (!row.actorUuid) {
      ui.notifications.warn("Assign an actor first.");
      return;
    }
    const actor = await resolveActorFromUuid(row.actorUuid);
    if (!actor) {
      ui.notifications.warn("Assigned actor could not be resolved.");
      return;
    }

    if (phase === "travel") {
      const hasteValidation = validateHasteAssignments(state.travel.assignments, this._memberCache.length);
      if (!hasteValidation.valid) {
        ui.notifications.warn(hasteValidation.reason);
        return;
      }
    }

    if (!hasRowRollInputs(row)) {
      ui.notifications.warn("Select a valid skill/characteristic before rolling.");
      return;
    }

    if ((phase === "travel" || phase === "camping")
      && String(row.endeavourKey ?? "") === "custom"
      && !String(row.note ?? "").trim()) {
      ui.notifications.warn("Enter a custom endeavour label before rolling.");
      return;
    }

    const terrainMod = Number(row?.terrainMod ?? 0);
    const autoMod = 0;

    let rolled;
    try {
      rolled = await performTravelAssignmentRoll({
        actor,
        assignment: row,
        terrainMod,
        autoMod,
      });
    } catch (err) {
      ui.notifications.error(String(err?.message ?? err));
      return;
    }

    const advice = phase === "travel" && row.endeavourKey === "navigate"
      ? getNavigateOutcomeAdvice(rolled.result)
      : null;
    let watchGuidance = "";
    if (phase === "camping" && row.endeavourKey === "watch") {
      const applyFatiguePrompt = await confirmDialog({
        title: "Watch Endeavour - Fatigue Prompt",
        content: "<p>If this watch is taken as an extra endeavour, mark 1 Fatigue on the watcher?</p>",
        yesLabel: "Mark Guidance",
        noLabel: "Skip",
      });
      if (applyFatiguePrompt) {
        watchGuidance = "Watch taken as an extra endeavour: apply 1 Fatigue to the watcher (manual apply).";
      }
    }

    await this.#mutateState((next) => {
      const targetRows = phase === "planning"
        ? next.planning.entries
        : phase === "camping"
          ? next.camping.assignments
          : next.travel.assignments;
      const target = targetRows.find((r) => String(r.id) === String(rowId));
      if (!target) return next;
      target.result = {
        rollTotal: rolled.result.rollTotal,
        target: rolled.target,
        isSuccess: Boolean(rolled.result.isSuccess),
        degree: Number(rolled.result.degree ?? 0),
        textual: String(rolled.result.textual ?? ""),
        isCriticalSuccess: Boolean(rolled.result.isCriticalSuccess),
        isCriticalFailure: Boolean(rolled.result.isCriticalFailure),
        rolledAt: Date.now(),
      };
      target.advice = advice ? { ...advice, applied: false } : null;

      if (phase === "planning") {
        next.planning.totals = computePlanningTotals(next.planning.entries, next.planning.spends);
      } else {
        next[phase].checks.push({
          id: foundry.utils.randomID(),
          rowId: target.id,
          endeavourKey: target.endeavourKey,
          actorUuid: target.actorUuid,
          isSuccess: target.result.isSuccess,
          degree: target.result.degree,
          rolledAt: target.result.rolledAt,
        });
        if (watchGuidance) {
          next.history.stageSummaries.push({
            id: foundry.utils.randomID(),
            stage: Number(next.session.currentStage || 1),
            note: watchGuidance,
            at: Date.now(),
          });
        }
      }

      if (phase === "travel" && row.endeavourKey === "navigate" && target.result.isSuccess) {
        next.session.navigateLostPenaltyActive = false;
      }
      return next;
    }, { render: false });

    await this.#postRollChat({
      phase,
      actor,
      row,
      rolled,
      terrainMod,
      advice,
    });
    await this.render();
  }

  async #postRollChat({ phase, actor, row, rolled, terrainMod, advice }) {
    const baseEndeavourLabel = getAssignmentMeta(phase, row.endeavourKey)?.label ?? row.endeavourKey;
    const endeavourLabel = row.endeavourKey === "custom" && String(row.note ?? "").trim()
      ? String(row.note).trim()
      : baseEndeavourLabel;
    const rowLabel = phase === "planning"
      ? "Planning Test"
      : `${phase === "camping" ? "Camping" : "Travel"} - ${endeavourLabel}`;
    const breakdownRows = ensureArray(rolled.breakdown)
      .map((b) => `<li>${esc(b.label)}: ${Number(b.value || 0) >= 0 ? "+" : ""}${Number(b.value || 0)}</li>`)
      .join("");
    const adviceHtml = advice
      ? `<p><b>Suggested Outcome:</b> ${esc(advice.label)} - ${esc(advice.description)}</p>`
      : "";

    const roll = rolled?.result?.roll ?? null;
    if (roll?.toMessage) {
      await roll.toMessage(
        {
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor: `
            <div class="uesrpg-travel-roll-card">
              <h3>${esc(rowLabel)}</h3>
              <p><b>Actor:</b> ${esc(actor.name)}</p>
              <p><b>Test:</b> ${esc(rolled.label)} | <b>TN:</b> ${Number(rolled.target)} | <b>Roll:</b> ${Number(rolled.result.rollTotal)}</p>
              <p><b>Result:</b> ${esc(rolled.result.textual)}${rolled.result.isCriticalSuccess ? " (Critical Success)" : ""}${rolled.result.isCriticalFailure ? " (Critical Failure)" : ""}</p>
              <details>
                <summary>TN Breakdown</summary>
                <ul>${breakdownRows}</ul>
                <p><b>Terrain Modifier:</b> ${terrainMod >= 0 ? "+" : ""}${terrainMod}</p>
              </details>
              ${adviceHtml}
            </div>
          `,
        },
        { rollMode: game.settings.get("core", "rollMode") },
      );
      return;
    }
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      content: `
        <div class="uesrpg-travel-roll-card">
          <h3>${esc(rowLabel)}</h3>
          <p><b>Actor:</b> ${esc(actor.name)}</p>
          <p><b>Test:</b> ${esc(rolled.label)} | <b>TN:</b> ${Number(rolled.target)} | <b>Roll:</b> ${Number(rolled.result.rollTotal)}</p>
          <p><b>Result:</b> ${esc(rolled.result.textual)}${rolled.result.isCriticalSuccess ? " (Critical Success)" : ""}${rolled.result.isCriticalFailure ? " (Critical Failure)" : ""}</p>
          <details>
            <summary>TN Breakdown</summary>
            <ul>${breakdownRows}</ul>
            <p><b>Terrain Modifier:</b> ${terrainMod >= 0 ? "+" : ""}${terrainMod}</p>
          </details>
          ${adviceHtml}
        </div>
      `,
    });
  }

  async #rollEvent(phase, tableIndex = 0) {
    const group = await this.#resolveGroup();
    if (!group?.isOwner) return;
    const state = getTravelPlannerState(group);
    const terrainKey = String(state.session.terrain ?? "lightWoodland");
    const mapped = getMappedTableUuids(state, phase, terrainKey);
    const tableUuid = String(mapped[Math.max(0, Number(tableIndex || 0))] ?? "");
    const doubleWorst = Boolean(state?.session?.effectFlags?.doubleEventWorstNext);
    const outcome = await rollMappedEvent({
      groupActor: group,
      phase,
      terrainKey,
      force: false,
      doubleWorst,
      tableUuid,
    });
    if (!outcome.ok) {
      ui.notifications.warn(outcome.reason);
      return;
    }
    if (!outcome.triggered) {
      ui.notifications.info(`No event this stage (${outcome.check?.total ?? 0} on 2d10).`);
      return;
    }
    await this.#mutateState((next) => {
      next.history.eventLog.push({
        id: foundry.utils.randomID(),
        phase,
        terrain: terrainKey,
        tableUuid,
        checkTotal: Number(outcome.check?.total ?? 0),
        triggered: true,
        eventText: String(outcome.eventText ?? ""),
        at: Date.now(),
      });
      if (doubleWorst) {
        next.session.effectFlags.doubleEventWorstNext = false;
      }
      return next;
    });
  }

  async #bumpResource(field, delta) {
    await this.#mutateState((next) => {
      const current = Math.max(0, Number(next?.travel?.resources?.[field] ?? 0));
      next.travel.resources[field] = Math.max(0, current + Number(delta || 0));
      return next;
    });
  }

  async #applyGroupRest(restType = "short") {
    const group = await this.#resolveGroup();
    if (!group?.isOwner) {
      ui.notifications.warn("You do not have permission to rest this group.");
      return;
    }
    const members = await this.#resolveGroupMembers(group);
    const lines = [];
    for (const member of members) {
      if (!member?.actor) continue;
      const result = restType === "long"
        ? await applyLongRest(member.actor)
        : await applyShortRest(member.actor);
      if (result?.line) lines.push(result.line);
    }
    if (!lines.length) {
      ui.notifications.warn("No members available for rest.");
      return;
    }

    const timeForward = await forwardTimeForGroupRest({
      restType: restType === "long" ? "long" : "short",
      actor: group,
      actorLabel: group?.name ?? null,
    });

    const heading = restType === "long" ? "Long Rest (8 hours)" : "Short Rest (1 hour)";
    const content = buildRestChatContent(heading, lines);
    await requestUpdateDocument(group, {
      [`system.lastRest.${restType === "long" ? "long" : "short"}`]: game.time.worldTime,
    });
    await ChatMessage.create({
      user: game.user.id,
      speaker: { alias: group.name },
      content,
      whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
    await this.render(false);
    if (restType === "long") {
      if (!timeForward.applied && timeForward.reason && timeForward.reason.includes("did not change")) {
        ui.notifications.warn(`Long rest completed. ${timeForward.reason}`);
      } else if (timeForward.applied && timeForward.mode === "sunrise") {
        ui.notifications.info("Long rest completed. Time advanced to sunrise.");
      } else if (timeForward.applied) {
        ui.notifications.info("Long rest completed. Time advanced by 8 hours.");
      } else {
        ui.notifications.info("Long rest completed.");
      }
      return;
    }
    if (!timeForward.applied && timeForward.reason && timeForward.reason.includes("did not change")) {
      ui.notifications.warn(`Short rest completed. ${timeForward.reason}`);
    } else if (timeForward.applied) {
      ui.notifications.info("Short rest completed. Time advanced by 1 hour.");
    } else {
      ui.notifications.info("Short rest completed.");
    }
  }

  #enrichPlanningRow(row, members) {
    const actor = members.find((m) => String(m.uuid) === String(row.actorUuid))?.actor ?? null;
    const skills = actor ? getActorSkillOptions(actor) : [];
    const chars = actor ? getActorCharacteristicOptions(actor) : [];
    return {
      ...row,
      actorName: actor?.name ?? "",
      actorImg: actorImg(actor),
      skillOptions: skills,
      charOptions: chars,
      missingActor: !row?.actorUuid,
      missingInput: Boolean(row?.actorUuid) && !hasRowRollInputs(row),
      hasResult: Boolean(row?.result),
    };
  }

  #enrichPhaseRow(phase, row, members, state) {
    const actor = members.find((m) => String(m.uuid) === String(row.actorUuid))?.actor ?? null;
    const skills = actor ? getActorSkillOptions(actor) : [];
    const chars = actor ? getActorCharacteristicOptions(actor) : [];
    const meta = getAssignmentMeta(phase, row.endeavourKey);
    const terrainMod = Number(row?.terrainMod ?? 0);
    return {
      ...row,
      actorName: actor?.name ?? "",
      actorImg: actorImg(actor),
      skillOptions: skills,
      charOptions: chars,
      meta,
      terrainMod,
      totalStaticMod: Number(terrainMod || 0),
      missingActor: !row?.actorUuid,
      missingInput: Boolean(row?.actorUuid) && !hasRowRollInputs(row),
      customLabelMissing: String(row?.endeavourKey ?? "") === "custom" && !String(row?.note ?? "").trim(),
      canRoll: hasRowRollInputs(row) && (String(row?.endeavourKey ?? "") !== "custom" || Boolean(String(row?.note ?? "").trim())),
      hasResult: Boolean(row?.result),
      hasAdvice: Boolean(row?.advice),
    };
  }

  async #resolveGroup() {
    if (!this._groupUuid) return null;
    const doc = await fromUuid(String(this._groupUuid));
    if (doc?.documentName !== "Actor" || String(doc?.type) !== "Group") return null;
    return doc;
  }

  async #resolveGroupMembers(group) {
    const members = [];
    for (const member of ensureArray(group?.system?.members)) {
      const actor = await resolveActorFromUuid(member?.id ?? member?.uuid ?? "");
      if (!actor) continue;
      members.push({
        uuid: actor.uuid,
        name: actor.name,
        img: actor.img,
        actor,
      });
    }
    return members;
  }

  async #mutateState(mutator, { render = true } = {}) {
    const group = await this.#resolveGroup();
    if (!group) return null;
    if (!group.isOwner) {
      ui.notifications.warn("This planner is read-only for your user.");
      return null;
    }
    const next = await updateTravelPlannerState(group, mutator);
    if (render) await this.render();
    return next;
  }
}

