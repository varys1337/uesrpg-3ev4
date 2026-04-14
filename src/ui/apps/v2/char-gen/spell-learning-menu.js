import { requestCreateEmbeddedDocuments, requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { confirmDialog, customDialog } from "../../../../utils/dialog-v2-helper.js";
import { resolveDroppedItem } from "../../../../utils/drop-data.js";
import {
  computeSpellLearningCosts,
  normalizeSpellLearningType,
  validateSpellLearningPurchase,
  spellSignature,
  computeSpellLearningSummary,
  buildKnownSpellIndex,
} from "../../../../core/advancement/spell-learning.js";
import { appendChargenAudit } from "./audit-log.js";
import { SYSTEM_ID, templatePath } from "../../../constants.js";
import { t, tf } from "../../../../utils/i18n.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value) {
  return String(value ?? "").trim();
}

function cloneData(value) {
  return foundry.utils.deepClone(value ?? {});
}

function readDropData(event) {
  const dt = event?.dataTransfer;
  if (!dt) return null;
  const raw = dt.getData("text/plain");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

export class SpellLearningMenuAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  #onClose = null;
  #dropBound = false;
  #sessionBase = null;
  #draftEntries = [];
  #draftDerived = null;
  #dirty = false;
  #nextDraftId = 1;

  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
    this.#onClose = typeof options.onClose === "function" ? options.onClose : null;
    this.#captureSessionBase();
    this.#recomputeDraftDerived();
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-spell-learning-menu-v2",
    classes: ["worldbuilding", "uesrpg", "uesrpg-spell-learning-app"],
    position: { width: 980, height: 760 },
    window: {
      resizable: true,
    },
    dragDrop: [
      {
        dragSelector: null,
        dropSelector: ".uesrpg-spelllearn__dropzone",
      },
    ],
    actions: {
      close: SpellLearningMenuAppV2.prototype._onCloseClick,
      removeDraftEntry: SpellLearningMenuAppV2.prototype._onRemoveDraftEntry,
      discardDraft: SpellLearningMenuAppV2.prototype._onDiscardDraft,
      confirmDraft: SpellLearningMenuAppV2.prototype._onConfirmDraft,
    },
  };

  static PARTS = {
    main: {
      template: templatePath("v2/apps/spell-learning-menu.hbs"),
      scrollable: [".uesrpg-spelllearn__scroll"],
    },
  };

  static async prompt(actor, options = {}) {
    const app = new SpellLearningMenuAppV2(actor, options);
    await app.render(true);
    return app;
  }

  get title() {
    return t("UESRPG.Dialogs.SpellLearning.Title", "Spell Learning (Chargen)");
  }

  #buildLiveFingerprint() {
    const actor = this.#actor;
    const spells = actor.items
      .filter((it) => it.type === "spell")
      .map((it) => spellSignature(it))
      .sort();
    return JSON.stringify({
      xp: asNumber(actor?.system?.xp, 0),
      wealth: asNumber(actor?.system?.wealth, 0),
      spells,
    });
  }

  #captureSessionBase() {
    this.#sessionBase = {
      actorName: this.#actor?.name ?? "Unknown",
      xp: asNumber(this.#actor?.system?.xp, 0),
      wealth: asNumber(this.#actor?.system?.wealth, 0),
      items: this.#actor?.items?.map((it) => cloneData(it.toObject())) ?? [],
      fingerprint: this.#buildLiveFingerprint(),
    };
  }

  #buildProjectedState() {
    const base = this.#sessionBase;
    const spellSigs = new Set(
      (base.items ?? [])
        .filter((it) => it.type === "spell")
        .map((it) => spellSignature(it))
    );
    const projected = {
      xp: asNumber(base?.xp, 0),
      wealth: asNumber(base?.wealth, 0),
      spellSigs,
      totals: { costXp: 0, costWealth: 0 },
    };
    for (const entry of this.#draftEntries) {
      projected.totals.costXp += asNumber(entry.costXp, 0);
      projected.totals.costWealth += asNumber(entry.costWealth, 0);
      projected.xp -= asNumber(entry.costXp, 0);
      projected.wealth -= asNumber(entry.costWealth, 0);
      if (entry.kind === "spellLearn") {
        const itemData = cloneData(entry.payload?.itemData ?? {});
        if (itemData.type === "spell") projected.spellSigs.add(spellSignature(itemData));
      }
    }
    return projected;
  }

  #recomputeDraftDerived() {
    this.#draftDerived = this.#buildProjectedState();
    this.#dirty = this.#draftEntries.length > 0;
  }

  #buildValidationActor(derived, extraItems = [], { includeDraft = true } = {}) {
    const draftItems = includeDraft
      ? this.#draftEntries
          .filter((e) => e.kind === "spellLearn")
          .map((e) => cloneData(e.payload?.itemData ?? {}))
      : [];
    const items = [...(this.#sessionBase?.items ?? []), ...draftItems, ...extraItems].map((it) => cloneData(it));
    return {
      documentName: "Actor",
      type: this.#actor?.type ?? "Player Character",
      system: {
        ...cloneData(this.#actor?.system),
        xp: asNumber(derived?.xp, 0),
        wealth: asNumber(derived?.wealth, 0),
      },
      items,
      getFlag: (...args) => this.#actor?.getFlag?.(...args),
    };
  }

  #nextEntryId() {
    const id = `d${this.#nextDraftId}`;
    this.#nextDraftId += 1;
    return id;
  }

  async #stageOperation(op) {
    this.#draftEntries.push({
      id: this.#nextEntryId(),
      kind: asString(op.kind || "spellLearn"),
      label: asString(op.label || t("UESRPG.Dialogs.SpellLearning.StagedSpellLearning")),
      costXp: asNumber(op.costXp, 0),
      costWealth: asNumber(op.costWealth, 0),
      payload: cloneData(op.payload ?? {}),
      timestamp: new Date().toISOString(),
    });
    this.#recomputeDraftDerived();
    await this.render();
  }

  async #removeStagedOperation(entryId) {
    const idx = this.#draftEntries.findIndex((e) => String(e.id) === String(entryId));
    if (idx < 0) return;
    this.#draftEntries.splice(idx, 1);
    this.#recomputeDraftDerived();
    await this.render();
  }

  async #clearDraft() {
    this.#draftEntries = [];
    this.#recomputeDraftDerived();
    await this.render();
  }

  async #confirmDiscardIfDirty() {
    if (!this.#dirty) return true;
    return confirmDialog({
      title: t("UESRPG.Dialogs.SpellLearning.DiscardUnconfirmedTitle"),
      content: `<p>${t("UESRPG.Dialogs.SpellLearning.DiscardUnconfirmedContent")}</p>`,
      yesLabel: t("UESRPG.UI.Discard"),
      noLabel: t("UESRPG.UI.KeepEditing"),
    });
  }

  #isDrifted() {
    return this.#buildLiveFingerprint() !== this.#sessionBase?.fingerprint;
  }

  async #appendSpellLearningRows(rows) {
    if (!rows.length) return;
    const chargen = this.#actor.getFlag(SYSTEM_ID, "chargen") ?? {};
    const spellLearning = cloneData(chargen.spellLearning);
    const log = Array.isArray(spellLearning?.log) ? [...spellLearning.log] : [];
    for (const row of rows) log.push(row);
    await requestUpdateDocument(this.#actor, {
      "flags.uesrpg-3ev4.chargen.spellLearning.log": log,
      "flags.uesrpg-3ev4.chargen.spellLearning.lastSummary": computeSpellLearningSummary(log),
    });
  }

  async #finalizeDraft() {
    if (!this.#draftEntries.length) return { ok: true, applied: 0 };
    if (this.#isDrifted()) {
      return { ok: false, reason: t("UESRPG.Notifications.SpellLearning.ActorChangedReopen") };
    }

    const createdData = [];
    const learnedRows = [];
    const extraItems = [];
    let projectedXp = asNumber(this.#actor?.system?.xp, 0);
    let projectedWealth = asNumber(this.#actor?.system?.wealth, 0);

    for (const entry of this.#draftEntries) {
      const itemData = cloneData(entry.payload?.itemData ?? {});
      const paymentMode = asString(entry.payload?.paymentMode) === "drakes" ? "drakes" : "xp";
      const actorMock = this.#buildValidationActor({ xp: projectedXp, wealth: projectedWealth }, extraItems, { includeDraft: false });
      const knownSpellIndex = buildKnownSpellIndex(actorMock);
      const validation = validateSpellLearningPurchase(actorMock, itemData, paymentMode, { knownSpellIndex });
      if (!validation.ok) return { ok: false, reason: validation.reason || `Blocked: ${itemData?.name ?? "Spell"}` };

      const costXp = paymentMode === "xp" ? asNumber(validation.costs?.xpCost, 0) : 0;
      const costDrakes = paymentMode === "drakes" ? asNumber(validation.costs?.drakesCost, 0) : 0;
      projectedXp -= costXp;
      projectedWealth -= costDrakes;
      createdData.push(itemData);
      extraItems.push(itemData);
      learnedRows.push({
        outcome: "learned",
        reason: "",
        paymentMode,
        spell: {
          name: asString(itemData?.name || "Unknown"),
          school: asString(itemData?.system?.school).toLowerCase(),
          level: Math.max(1, asNumber(itemData?.system?.level, 1)),
          type: normalizeSpellLearningType(itemData),
        },
        costs: { xp: costXp, drakes: costDrakes },
        sourceUuid: asString(itemData?.uuid || itemData?.flags?.core?.sourceId || ""),
        timestamp: new Date().toISOString(),
      });
    }

    const created = await requestCreateEmbeddedDocuments(this.#actor, "Item", createdData);
    const createdSpells = Array.isArray(created) ? created : [];
    for (let i = 0; i < createdSpells.length; i += 1) {
      if (!learnedRows[i]) continue;
      learnedRows[i].spell.id = createdSpells[i]?.id ?? "";
      learnedRows[i].spell.name = createdSpells[i]?.name ?? learnedRows[i].spell.name;
    }

    await requestUpdateDocument(this.#actor, {
      "system.xp": Math.max(0, projectedXp),
      "system.wealth": Math.max(0, projectedWealth),
    });
    await this.#appendSpellLearningRows(learnedRows);
    await appendChargenAudit(this.#actor, {
      step: "spells",
      action: "confirmDraft",
      payload: {
        appliedCount: this.#draftEntries.length,
        totalXp: this.#draftEntries.reduce((sum, e) => sum + asNumber(e.costXp, 0), 0),
        totalWealth: this.#draftEntries.reduce((sum, e) => sum + asNumber(e.costWealth, 0), 0),
        remainingXp: Math.max(0, projectedXp),
        remainingWealth: Math.max(0, projectedWealth),
        entries: this.#draftEntries.map((e) => ({
          id: e.id,
          kind: e.kind,
          label: e.label,
          costXp: e.costXp,
          costWealth: e.costWealth,
        })),
      },
    });

    this.#draftEntries = [];
    this.#captureSessionBase();
    this.#recomputeDraftDerived();
    await this.render();
    return { ok: true, applied: createdSpells.length };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const log = this.#actor?.getFlag?.("uesrpg-3ev4", "chargen")?.spellLearning?.log ?? [];
    const derived = this.#draftDerived;
    const stagedEntries = this.#draftEntries.map((e) => ({
      id: e.id,
      label: e.label,
      kind: e.kind,
      costXp: asNumber(e.costXp, 0),
      costWealth: asNumber(e.costWealth, 0),
    }));
    const recentLog = Array.isArray(log)
      ? [...log].slice(-12).reverse().map((row) => ({
        outcome: asString(row?.outcome),
        spellName: asString(row?.spell?.name || t("UESRPG.Dialogs.SpellLearning.UnknownSpell")),
        spellType: asString(row?.spell?.type || "conventional"),
        level: asNumber(row?.spell?.level, 1),
        school: asString(row?.spell?.school || "unknown"),
        paymentMode: asString(row?.paymentMode || "-"),
        costXp: asNumber(row?.costs?.xp, 0),
        costDrakes: asNumber(row?.costs?.drakes, 0),
        reason: asString(row?.reason || ""),
      }))
      : [];

    return {
      ...context,
      actorName: this.#sessionBase?.actorName ?? this.#actor?.name ?? t("UESRPG.UI.Unknown"),
      xp: asNumber(this.#sessionBase?.xp, 0),
      xpProjected: asNumber(derived?.xp, 0),
      wealth: asNumber(this.#sessionBase?.wealth, 0),
      wealthProjected: asNumber(derived?.wealth, 0),
      stagedEntries,
      stagedCount: stagedEntries.length,
      stagedCostXp: asNumber(derived?.totals?.costXp, 0),
      stagedCostWealth: asNumber(derived?.totals?.costWealth, 0),
      hasDraft: stagedEntries.length > 0,
      recentLog,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#dropBound = false;
    this.#bindDropzones();
  }

  _onCloseClick(event) {
    event?.preventDefault?.();
    return this.close();
  }

  async close(options = {}) {
    if (!(await this.#confirmDiscardIfDirty())) return this;
    await requestUpdateDocument(this.#actor, {
      "flags.uesrpg-3ev4.chargen.spellLearning.stageState": {
        mode: "dropOnly",
        closedAt: new Date().toISOString(),
      },
    });
    const result = await super.close(options);
    if (this.#onClose) await this.#onClose(this.#actor);
    return result;
  }

  async _onDrop(event) {
    event?.preventDefault?.();
    const data = readDropData(event);
    if (!data || data.type !== "Item") return;
    const spell = await resolveDroppedItem(data);
    if (!spell || spell.type !== "spell") {
      ui.notifications?.warn?.(t("UESRPG.Notifications.SpellLearning.OnlySpellItems"));
      return;
    }
    const zone = String(event?.target?.closest?.(".uesrpg-spelllearn__dropzone")?.dataset?.zone ?? "");
    await this.#handleDroppedSpell(spell, zone);
    await this.render();
  }

  #bindDropzones() {
    if (this.#dropBound) return;
    const root = this.element;
    if (!root) return;
    const zones = root.querySelectorAll(".uesrpg-spelllearn__dropzone");
    for (const zone of zones) {
      zone.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        zone.classList.add("is-over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
      zone.addEventListener("drop", async (ev) => {
        zone.classList.remove("is-over");
        await this._onDrop(ev);
      });
    }
    this.#dropBound = true;
  }

  async #pickPaymentMode(spell) {
    const costs = computeSpellLearningCosts(spell, this.#actor);
    const actorMock = this.#buildValidationActor(this.#draftDerived);
    const knownSpellIndex = buildKnownSpellIndex(actorMock);
    const xpValidation = validateSpellLearningPurchase(actorMock, spell, "xp", { knownSpellIndex });
    const drakesValidation = validateSpellLearningPurchase(actorMock, spell, "drakes", { knownSpellIndex });
    const xpOk = xpValidation.ok;
    const drakesOk = drakesValidation.ok;

    if (!xpOk && !drakesOk) {
      return { ok: false, reason: xpValidation.reason || drakesValidation.reason || t("UESRPG.Notifications.SpellLearning.Blocked") };
    }
    if (xpOk && !drakesOk) return { ok: true, paymentMode: "xp" };
    if (!xpOk && drakesOk) return { ok: true, paymentMode: "drakes" };

    const choice = await customDialog({
      title: t("UESRPG.Dialogs.SpellLearning.ChoosePaymentTitle"),
      content: `<div style="display:flex; flex-direction:column; gap:6px;">
        <p style="margin:0;"><b>${spell.name}</b></p>
        <p style="margin:0;">${tf("UESRPG.Dialogs.SpellLearning.TypeLevel", { type: costs.type, level: costs.level })}</p>
        <p style="margin:0;">${tf("UESRPG.Dialogs.SpellLearning.XpCost", { cost: costs.xpCost })}</p>
        <p style="margin:0;">${tf("UESRPG.Dialogs.SpellLearning.DrakesCost", { cost: costs.drakesCost })}</p>
      </div>`,
      buttons: {
        xp: { label: tf("UESRPG.Dialogs.SpellLearning.LearnXpLabel", { cost: costs.xpCost }) },
        drakes: { label: tf("UESRPG.Dialogs.SpellLearning.LearnDrakesLabel", { cost: costs.drakesCost }) },
        cancel: { label: t("UESRPG.UI.Cancel") },
      },
      default: "xp",
    });
    if (!choice || choice === "cancel") return { ok: false, reason: "Cancelled." };
    return { ok: true, paymentMode: choice === "drakes" ? "drakes" : "xp" };
  }

  async #handleDroppedSpell(spell, zone) {
    if (zone !== "standard" && zone !== "ritual") {
      ui.notifications?.warn?.(t("UESRPG.Notifications.SpellLearning.DropIntoZone"));
      return;
    }
    const type = normalizeSpellLearningType(spell);
    if (zone === "ritual" && type !== "ritual") {
      ui.notifications?.warn?.(t("UESRPG.Notifications.SpellLearning.DropRitualInRitualZone"));
      await appendChargenAudit(this.#actor, {
        step: "spells",
        action: "blocked",
        payload: { spell: spell.name, type, reason: "wrong-zone-ritual-only" },
      });
      return;
    }
    if (zone === "standard" && type === "ritual") {
      ui.notifications?.warn?.(t("UESRPG.Notifications.SpellLearning.DropRitualInRitualZone"));
      await appendChargenAudit(this.#actor, {
        step: "spells",
        action: "blocked",
        payload: { spell: spell.name, type, reason: "wrong-zone-standard-only" },
      });
      return;
    }

    const picked = await this.#pickPaymentMode(spell);
    if (!picked.ok) {
      if (picked.reason && picked.reason !== "Cancelled.") ui.notifications?.warn?.(picked.reason);
      return;
    }

    const actorMock = this.#buildValidationActor(this.#draftDerived);
    const knownSpellIndex = buildKnownSpellIndex(actorMock);
    const validation = validateSpellLearningPurchase(actorMock, spell, picked.paymentMode, { knownSpellIndex });
    if (!validation.ok) {
      ui.notifications?.warn?.(validation.reason || t("UESRPG.Notifications.SpellLearning.Blocked"));
      return;
    }

    const costXp = picked.paymentMode === "xp" ? asNumber(validation.costs?.xpCost, 0) : 0;
    const costWealth = picked.paymentMode === "drakes" ? asNumber(validation.costs?.drakesCost, 0) : 0;
    await this.#stageOperation({
      kind: "spellLearn",
      label: tf("UESRPG.Dialogs.SpellLearning.LearnSpellLabel", { name: spell.name, paymentMode: picked.paymentMode.toUpperCase() }),
      costXp,
      costWealth,
      payload: {
        paymentMode: picked.paymentMode,
        itemData: cloneData(typeof spell.toObject === "function" ? spell.toObject() : spell),
      },
    });
    await appendChargenAudit(this.#actor, {
      step: "spells",
      action: "stage",
      payload: {
        spell: spell.name,
        school: spell.system?.school ?? "",
        level: spell.system?.level ?? 1,
        type: normalizeSpellLearningType(spell),
        paymentMode: picked.paymentMode,
        costXp,
        costWealth,
      },
    });
    ui.notifications?.info?.(tf("UESRPG.Notifications.SpellLearning.StagedSpell", { name: spell.name }));
  }

  async _onRemoveDraftEntry(event, target) {
    event?.preventDefault?.();
    const id = asString(target?.dataset?.entryId);
    if (!id) return;
    await this.#removeStagedOperation(id);
  }

  async _onDiscardDraft(event) {
    event?.preventDefault?.();
    if (!this.#dirty) return;
    const confirmed = await confirmDialog({
      title: t("UESRPG.Dialogs.SpellLearning.DiscardStagedTitle"),
      content: `<p>${t("UESRPG.Dialogs.SpellLearning.DiscardStagedContent")}</p>`,
      yesLabel: t("UESRPG.UI.Discard"),
      noLabel: t("UESRPG.UI.Cancel"),
    });
    if (!confirmed) return;
    await this.#clearDraft();
  }

  async _onConfirmDraft(event) {
    event?.preventDefault?.();
    if (!this.#draftEntries.length) {
      ui.notifications?.info?.(t("UESRPG.Notifications.SpellLearning.NoStagedPurchases"));
      return;
    }
    const out = await this.#finalizeDraft();
    if (!out.ok) {
      ui.notifications?.error?.(out.reason || t("UESRPG.Notifications.SpellLearning.ConfirmFailed"));
      return;
    }
    ui.notifications?.info?.(tf("UESRPG.Notifications.SpellLearning.ConfirmedPurchases", { count: out.applied }));
  }
}
