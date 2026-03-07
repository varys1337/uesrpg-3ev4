import {
  requestUpdateDocument,
  requestCreateEmbeddedDocuments,
} from "../../../../utils/authority-proxy.js";
import { resolveDroppedItem } from "../../../../utils/drop-data.js";
import { customDialog, confirmDialog } from "../../../../utils/dialog-v2-helper.js";
import {
  buildSkillAdvancementPlan,
  normalizeRank,
  parseSpecializations,
  discountCostIfFavored,
  getMaxPurchasableRankIndexFromXpTotal,
  SKILL_RANK_ORDER,
  SKILL_RANK_XP_COST,
} from "../../../../core/advancement/skill-advancement.js";
import {
  TALENT_LEARNING_MODE,
  getTalentLearningMode,
  validateTalentLearning,
  notifyTalentLearningResult,
} from "../../../../core/traits/talent-learning.js";
import {
  computeSpellLearningCosts,
  normalizeSpellLearningType,
  validateSpellLearningPurchase,
  spellSignature,
  buildKnownSpellIndex,
} from "../../../../core/advancement/spell-learning.js";
import { campaignRankFromXpTotal } from "../../../sheets/shared/dialogs/character-menus.js";
import { appendChargenAudit } from "./audit-log.js";
import { SYSTEM_ID, templatePath } from "../../../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function _asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _chaLabel(key) {
  const map = { str: "STR", end: "END", agi: "AGI", int: "INT", wp: "WP", prc: "PRC", prs: "PRS", lck: "LCK" };
  return map[String(key ?? "").toLowerCase()] ?? String(key ?? "").toUpperCase();
}

function _nextRank(rank) {
  const idx = SKILL_RANK_ORDER.indexOf(rank);
  if (idx < 0 || idx >= (SKILL_RANK_ORDER.length - 1)) return null;
  return SKILL_RANK_ORDER[idx + 1];
}

function _slug(text) {
  return String(text ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function _cloneSystem(system) {
  return foundry.utils.deepClone(system ?? {});
}

function _cloneItemLike(item) {
  return {
    id: String(item?.id ?? item?._id ?? ""),
    name: String(item?.name ?? "Item"),
    type: String(item?.type ?? ""),
    img: String(item?.img ?? ""),
    system: _cloneSystem(item?.system),
    flags: foundry.utils.deepClone(item?.flags ?? {}),
  };
}

function _buildSkillKey(itemId, tempId) {
  if (tempId) return `temp:${tempId}`;
  return `id:${itemId}`;
}

export class SpendXpMenuAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  #onClose = null;
  #dropZonesBound = false;
  #selectedCharacteristic = "str";
  #rankGateOverride = false;
  #sessionBase = null;
  #draftEntries = [];
  #draftDerived = null;
  #dirty = false;
  #nextDraftId = 1;

  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
    this.#onClose = typeof options.onClose === "function" ? options.onClose : null;
    const initial = Object.keys(actor?.system?.characteristics ?? {}).find((k) => k !== "lck");
    this.#selectedCharacteristic = String(initial ?? "str");
    this.#rankGateOverride = Boolean(actor?.getFlag?.("uesrpg-3ev4", "chargen")?.spendXp?.rankGateOverride ?? false);
    this.#captureSessionBase();
    this.#recomputeDraftDerived();
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-spend-xp-menu-v2",
    classes: ["worldbuilding", "uesrpg", "uesrpg-spendxp-app"],
    position: { width: 980, height: 760 },
    window: { title: "Spend XP (Chargen)", resizable: true },
    actions: {
      close: SpendXpMenuAppV2.prototype._onCloseClick,
      advanceCharacteristic: SpendXpMenuAppV2.prototype._onAdvanceCharacteristic,
      advanceRank: SpendXpMenuAppV2.prototype._onAdvanceRank,
      toggleRankGate: SpendXpMenuAppV2.prototype._onToggleRankGate,
      addSpec: SpendXpMenuAppV2.prototype._onAddSpecialization,
      addEquipment: SpendXpMenuAppV2.prototype._onAddEquipment,
      openItem: SpendXpMenuAppV2.prototype._onOpenItem,
      removeDraftEntry: SpendXpMenuAppV2.prototype._onRemoveDraftEntry,
      discardDraft: SpendXpMenuAppV2.prototype._onDiscardDraft,
      confirmDraft: SpendXpMenuAppV2.prototype._onConfirmDraft,
    },
    dragDrop: [{ dragSelector: null, dropSelector: ".uesrpg-spendxp__dropzone" }],
  };

  static PARTS = {
    main: {
      template: templatePath("v2/apps/spend-xp-menu.hbs"),
      scrollable: [".uesrpg-spendxp__scroll"],
    },
  };

  static async prompt(actor, options = {}) {
    const app = new SpendXpMenuAppV2(actor, options);
    await app.render(true);
    return app;
  }

  #buildLiveFingerprint() {
    const actor = this.#actor;
    const fp = { xp: _asNumber(actor?.system?.xp, 0), wealth: _asNumber(actor?.system?.wealth, 0), characteristics: {}, skills: [], talents: [], spells: [] };
    for (const key of ["str", "end", "agi", "int", "wp", "prc", "prs", "lck"]) {
      fp.characteristics[key] = {
        base: _asNumber(actor?.system?.characteristics?.[key]?.base, 0),
        total: _asNumber(actor?.system?.characteristics?.[key]?.total, 0),
        favored: Boolean(actor?.system?.characteristics?.[key]?.favored),
      };
    }
    fp.skills = actor.items
      .filter((it) => ["skill", "magicSkill", "combatStyle"].includes(it.type))
      .map((it) => ({
        id: it.id,
        type: it.type,
        name: it.name,
        rank: normalizeRank(it.system?.rank),
        trainedItems: String(it.system?.trainedItems ?? ""),
        trainedEquipment: Array.isArray(it.system?.trainedEquipment) ? it.system.trainedEquipment.map((v) => String(v ?? "").trim()) : [],
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    fp.talents = actor.items.filter((it) => it.type === "talent").map((it) => _slug(it.name)).sort();
    fp.spells = actor.items.filter((it) => it.type === "spell").map((it) => spellSignature(it)).sort();
    return JSON.stringify(fp);
  }

  #captureSessionBase() {
    const actor = this.#actor;
    const characteristics = {};
    for (const key of Object.keys(actor?.system?.characteristics ?? {})) {
      const c = actor.system.characteristics[key] ?? {};
      characteristics[key] = {
        base: _asNumber(c.base, 0),
        total: _asNumber(c.total, 0),
        bonus: _asNumber(c.bonus, Math.floor(_asNumber(c.total, 0) / 10)),
        favored: Boolean(c.favored),
      };
    }
    const skills = actor.items
      .filter((it) => ["skill", "magicSkill", "combatStyle"].includes(it.type))
      .map((it) => ({
        key: _buildSkillKey(it.id, null),
        itemId: it.id,
        tempId: null,
        type: it.type,
        name: it.name,
        img: it.img,
        system: _cloneSystem(it.system),
      }));
    this.#sessionBase = {
      actorName: actor?.name ?? "Unknown",
      xp: _asNumber(actor?.system?.xp, 0),
      xpTotal: _asNumber(actor?.system?.xpTotal, 0),
      wealth: _asNumber(actor?.system?.wealth, 0),
      campaignRank: campaignRankFromXpTotal(_asNumber(actor?.system?.xpTotal, 0)),
      characteristics,
      skills,
      validationItems: actor.items.map((it) => _cloneItemLike(it)),
      fingerprint: this.#buildLiveFingerprint(),
    };
  }

  #buildProjectedState() {
    const base = this.#sessionBase;
    const skills = new Map();
    for (const s of base.skills) {
      skills.set(s.key, {
        key: s.key,
        itemId: s.itemId,
        tempId: s.tempId,
        type: s.type,
        name: s.name,
        img: s.img,
        system: _cloneSystem(s.system),
      });
    }

    const projected = {
      xp: base.xp,
      wealth: base.wealth,
      xpTotal: base.xpTotal,
      campaignRank: base.campaignRank,
      characteristics: foundry.utils.deepClone(base.characteristics),
      skills,
      talentSlugs: new Set(
        (base.validationItems ?? [])
          .filter((it) => it.type === "talent")
          .map((it) => _slug(it.name))
      ),
      spellSigs: new Set(
        (base.validationItems ?? [])
          .filter((it) => it.type === "spell")
          .map((it) => spellSignature(it))
      ),
      totals: { costXp: 0, costWealth: 0 },
    };

    for (const entry of this.#draftEntries) {
      projected.totals.costXp += _asNumber(entry.costXp, 0);
      projected.totals.costWealth += _asNumber(entry.costWealth, 0);
      projected.xp -= _asNumber(entry.costXp, 0);
      projected.wealth -= _asNumber(entry.costWealth, 0);

      switch (entry.kind) {
        case "characteristicAdvance": {
          const key = String(entry.payload?.key ?? "").toLowerCase();
          const cha = projected.characteristics[key];
          if (!cha) break;
          cha.base = _asNumber(cha.base, 0) + 1;
          cha.total = _asNumber(cha.total, 0) + 1;
          cha.bonus = Math.floor(_asNumber(cha.total, 0) / 10);
          break;
        }
        case "skillRankAdvance":
        case "skillAddSpec":
        case "combatStyleAddEquipment": {
          const ref = String(entry.payload?.itemRef ?? "");
          const skill = projected.skills.get(ref);
          if (!skill) break;
          const flatData = entry.payload?.flatData ?? {};
          for (const [path, value] of Object.entries(flatData)) {
            foundry.utils.setProperty(skill, path.replace(/^system\./, "system."), value);
          }
          break;
        }
        case "addSkillLikeItem": {
          const itemData = foundry.utils.deepClone(entry.payload?.itemData ?? {});
          const tempId = String(entry.payload?.tempId ?? "");
          if (!tempId) break;
          const key = _buildSkillKey(null, tempId);
          projected.skills.set(key, {
            key,
            itemId: null,
            tempId,
            type: String(itemData.type ?? ""),
            name: String(itemData.name ?? "New Item"),
            img: String(itemData.img ?? ""),
            system: _cloneSystem(itemData.system),
          });
          break;
        }
        case "talentLearn": {
          const name = String(entry.payload?.itemData?.name ?? "");
          if (name) projected.talentSlugs.add(_slug(name));
          break;
        }
        case "spellLearn": {
          const itemData = entry.payload?.itemData ?? null;
          if (itemData) projected.spellSigs.add(spellSignature(itemData));
          break;
        }
        default:
          break;
      }
    }

    return projected;
  }

  #recomputeDraftDerived() {
    this.#draftDerived = this.#buildProjectedState();
    this.#dirty = this.#draftEntries.length > 0;
  }

  #getProjectedSkill(itemRef) {
    return this.#draftDerived?.skills?.get?.(String(itemRef ?? "")) ?? null;
  }

  #buildValidationActor(derived) {
    const items = (this.#sessionBase.validationItems ?? []).map((it) => _cloneItemLike(it));

    for (const skill of derived.skills.values()) {
      const idx = items.findIndex((it) => String(it.id ?? "") === String(skill.itemId ?? ""));
      const plain = {
        id: skill.itemId ?? skill.tempId ?? "",
        name: skill.name,
        type: skill.type,
        img: skill.img,
        system: _cloneSystem(skill.system),
        flags: {},
      };
      if (idx >= 0) items[idx] = plain;
      else items.push(plain);
    }

    for (const entry of this.#draftEntries) {
      if (entry.kind === "talentLearn") {
        items.push({
          id: `draft-talent-${entry.id}`,
          name: String(entry.payload?.itemData?.name ?? "Talent"),
          type: "talent",
          img: String(entry.payload?.itemData?.img ?? ""),
          system: _cloneSystem(entry.payload?.itemData?.system),
          flags: foundry.utils.deepClone(entry.payload?.itemData?.flags ?? {}),
        });
      }
      if (entry.kind === "spellLearn") {
        items.push({
          id: `draft-spell-${entry.id}`,
          name: String(entry.payload?.itemData?.name ?? "Spell"),
          type: "spell",
          img: String(entry.payload?.itemData?.img ?? ""),
          system: _cloneSystem(entry.payload?.itemData?.system),
          flags: foundry.utils.deepClone(entry.payload?.itemData?.flags ?? {}),
        });
      }
    }

    return {
      documentName: "Actor",
      type: this.#actor?.type ?? "Player Character",
      system: {
        ...foundry.utils.deepClone(this.#actor?.system ?? {}),
        xp: derived.xp,
        wealth: derived.wealth,
        characteristics: foundry.utils.deepClone(derived.characteristics),
      },
      items,
      getFlag: (...args) => this.#actor?.getFlag?.(...args),
    };
  }

  #planSkillChange(skill, flatData, derived) {
    const actorMock = {
      system: {
        xp: derived.xp,
        xpTotal: derived.xpTotal,
        characteristics: foundry.utils.deepClone(derived.characteristics),
      },
    };
    const itemMock = { type: skill.type, system: _cloneSystem(skill.system) };
    return buildSkillAdvancementPlan({ actor: actorMock, item: itemMock, flatData });
  }

  #nextEntryId() {
    const id = `d${this.#nextDraftId}`;
    this.#nextDraftId += 1;
    return id;
  }

  async #stageOperation(op) {
    this.#draftEntries.push({
      id: this.#nextEntryId(),
      kind: String(op.kind ?? "unknown"),
      label: String(op.label ?? "Staged operation"),
      costXp: _asNumber(op.costXp, 0),
      costWealth: _asNumber(op.costWealth, 0),
      payload: foundry.utils.deepClone(op.payload ?? {}),
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
      title: "Discard Unconfirmed Purchases",
      content: "<p>Discard all staged purchases and close?</p>",
      yesLabel: "Discard",
      noLabel: "Keep Editing",
    });
  }

  #isDrifted() {
    return this.#buildLiveFingerprint() !== this.#sessionBase?.fingerprint;
  }

  async #appendSpendLogEntries(entries) {
    const flagData = this.#actor.getFlag(SYSTEM_ID, "chargen") ?? {};
    const spendLog = Array.isArray(flagData.spendLog) ? [...flagData.spendLog] : [];
    for (const row of entries) {
      spendLog.push({
        type: row.type,
        name: row.name,
        costXp: _asNumber(row.costXp, 0),
        costWealth: _asNumber(row.costWealth, 0),
        timestamp: new Date().toISOString(),
        details: row.details ?? {},
      });
    }
    await requestUpdateDocument(this.#actor, { "flags.uesrpg-3ev4.chargen.spendLog": spendLog });
  }

  async #finalizeDraft() {
    if (!this.#draftEntries.length) return { ok: true, applied: 0 };
    if (this.#isDrifted()) {
      return {
        ok: false,
        reason: "Actor data changed while this menu was open. Reopen Spend XP and stage again.",
      };
    }

    const tempIdToRealId = new Map();
    const spendRows = [];

    try {
      for (const entry of this.#draftEntries) {
        if (entry.kind === "addSkillLikeItem") {
          const created = await requestCreateEmbeddedDocuments(this.#actor, "Item", [foundry.utils.deepClone(entry.payload?.itemData ?? {})]);
          const createdItem = created?.[0] ?? null;
          if (!createdItem) throw new Error(`Failed to create item for staged operation ${entry.id}.`);
          const tempId = String(entry.payload?.tempId ?? "");
          if (tempId) tempIdToRealId.set(tempId, createdItem.id);
          spendRows.push({ type: "item", name: createdItem.name, costXp: entry.costXp, costWealth: entry.costWealth, details: { stagedKind: entry.kind } });
          continue;
        }

        if (entry.kind === "talentLearn" || entry.kind === "spellLearn") {
          const created = await requestCreateEmbeddedDocuments(this.#actor, "Item", [foundry.utils.deepClone(entry.payload?.itemData ?? {})]);
          const createdItem = created?.[0] ?? null;
          if (!createdItem) throw new Error(`Failed to create item for staged operation ${entry.id}.`);
          spendRows.push({
            type: entry.kind === "talentLearn" ? "talent" : "spell",
            name: createdItem.name,
            costXp: entry.costXp,
            costWealth: entry.costWealth,
            details: { stagedKind: entry.kind, paymentMode: entry.payload?.paymentMode ?? "xp" },
          });
          continue;
        }

        if (entry.kind === "skillRankAdvance" || entry.kind === "skillAddSpec" || entry.kind === "combatStyleAddEquipment") {
          const ref = String(entry.payload?.itemRef ?? "");
          let itemId = null;
          if (ref.startsWith("id:")) itemId = ref.slice(3);
          if (ref.startsWith("temp:")) itemId = tempIdToRealId.get(ref.slice(5)) ?? null;
          const item = itemId ? this.#actor.items.get(itemId) : null;
          if (!item) throw new Error(`Failed to resolve staged item update ${entry.id}.`);
          await requestUpdateDocument(item, entry.payload?.flatData ?? {});
          spendRows.push({ type: entry.kind, name: item.name, costXp: entry.costXp, costWealth: entry.costWealth, details: { stagedKind: entry.kind } });
        }
      }

      const next = this.#draftDerived;
      const actorUpdate = {
        "system.xp": Math.max(0, _asNumber(next?.xp, 0)),
        "system.wealth": Math.max(0, _asNumber(next?.wealth, 0)),
        "flags.uesrpg-3ev4.chargen.spendXp.rankGateOverride": Boolean(this.#rankGateOverride),
      };
      for (const key of ["str", "end", "agi", "int", "wp", "prc", "prs", "lck"]) {
        const cha = next?.characteristics?.[key];
        if (!cha) continue;
        actorUpdate[`system.characteristics.${key}.base`] = _asNumber(cha.base, 0);
        actorUpdate[`system.characteristics.${key}.total`] = _asNumber(cha.total, 0);
      }
      await requestUpdateDocument(this.#actor, actorUpdate);

      const totalXp = this.#draftEntries.reduce((sum, e) => sum + _asNumber(e.costXp, 0), 0);
      const totalWealth = this.#draftEntries.reduce((sum, e) => sum + _asNumber(e.costWealth, 0), 0);
      await this.#appendSpendLogEntries(spendRows);
      await appendChargenAudit(this.#actor, {
        step: "spendxp",
        action: "confirmDraft",
        payload: {
          appliedCount: this.#draftEntries.length,
          totalXp,
          totalWealth,
          remainingXp: Math.max(0, _asNumber(next?.xp, 0)),
          entries: this.#draftEntries.map((e) => ({ id: e.id, kind: e.kind, label: e.label, costXp: e.costXp, costWealth: e.costWealth })),
        },
      });
    } catch (err) {
      return { ok: false, reason: String(err?.message ?? err ?? "Unknown finalize failure.") };
    }

    this.#draftEntries = [];
    this.#captureSessionBase();
    this.#recomputeDraftDerived();
    return { ok: true, applied: spendRows.length };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.#recomputeDraftDerived();

    const derived = this.#draftDerived;
    const xpTotal = _asNumber(this.#sessionBase?.xpTotal, 0);

    const chaOptions = Object.entries(derived?.characteristics ?? {})
      .filter(([key]) => key !== "lck")
      .map(([key, c]) => ({
        key,
        label: _chaLabel(key),
        base: _asNumber(c?.base, 0),
        bonus: _asNumber(c?.bonus, Math.floor(_asNumber(c?.total, 0) / 10)),
        favored: Boolean(c?.favored),
      }));

    const skills = Array.from(derived?.skills?.values?.() ?? [])
      .map((s) => {
        const rank = normalizeRank(s.system?.rank);
        const nextRank = _nextRank(rank);
        const favored = Boolean(this.#isFavoredForSkillSystem(s.system, derived));
        const nextRankBase = nextRank ? _asNumber(SKILL_RANK_XP_COST[nextRank], 0) : 0;
        const nextRankXpCost = nextRank ? discountCostIfFavored(nextRankBase, favored) : 0;
        const maxIdx = getMaxPurchasableRankIndexFromXpTotal(xpTotal);
        const rankAllowedByXp = !nextRank ? false : SKILL_RANK_ORDER.indexOf(nextRank) <= maxIdx;
        const canAdvance = Boolean(nextRank) && (this.#rankGateOverride || rankAllowedByXp);
        const specCount = parseSpecializations(s.system?.trainedItems ?? "").length;
        const teCount = Array.isArray(s.system?.trainedEquipment)
          ? s.system.trainedEquipment.map((v) => String(v ?? "").trim()).filter(Boolean).length
          : 0;
        return {
          id: s.key,
          name: s.name,
          img: s.img,
          type: s.type,
          rank,
          rankLabel: rank.charAt(0).toUpperCase() + rank.slice(1),
          favored,
          nextRankXpCost,
          canAdvance,
          specCount,
          teCount,
          isTemp: Boolean(s.tempId),
          itemId: s.itemId ?? "",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const stagedEntries = this.#draftEntries.map((e) => ({
      id: e.id,
      label: e.label,
      kind: e.kind,
      costXp: _asNumber(e.costXp, 0),
      costWealth: _asNumber(e.costWealth, 0),
    }));

    return {
      ...context,
      actorName: this.#sessionBase?.actorName ?? this.#actor?.name ?? "Unknown",
      xp: _asNumber(this.#sessionBase?.xp, 0),
      xpProjected: _asNumber(derived?.xp, 0),
      xpTotal: _asNumber(this.#sessionBase?.xpTotal, 0),
      wealth: _asNumber(this.#sessionBase?.wealth, 0),
      wealthProjected: _asNumber(derived?.wealth, 0),
      campaignRank: campaignRankFromXpTotal(_asNumber(this.#sessionBase?.xpTotal, 0)),
      chaOptions,
      selectedCharacteristic: this.#selectedCharacteristic,
      rankGateOverride: this.#rankGateOverride,
      skills,
      talentLearningMode: String(getTalentLearningMode() ?? TALENT_LEARNING_MODE.OFF).toUpperCase(),
      stagedEntries,
      stagedCount: stagedEntries.length,
      stagedCostXp: _asNumber(derived?.totals?.costXp, 0),
      stagedCostWealth: _asNumber(derived?.totals?.costWealth, 0),
      hasDraft: stagedEntries.length > 0,
    };
  }

  async _onDrop(event) {
    event?.preventDefault?.();
    const data = this.#readDropData(event);
    if (!data || data.type !== "Item") return;

    const item = await resolveDroppedItem(data);
    if (!item) return;

    const derived = this.#draftDerived;
    if (["skill", "magicSkill", "combatStyle"].includes(item.type)) {
      const tempId = `sk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      await this.#stageOperation({
        kind: "addSkillLikeItem",
        label: `Add ${item.type}: ${item.name}`,
        costXp: 0,
        costWealth: 0,
        payload: { tempId, itemData: item.toObject() },
      });
      return;
    }

    if (item.type === "talent") {
      const actorMock = this.#buildValidationActor(derived);
      const mode = getTalentLearningMode();
      const validation = validateTalentLearning(actorMock, item.toObject(), { source: "chargen-spendxp" });

      if (mode === TALENT_LEARNING_MODE.WARN) notifyTalentLearningResult(validation);
      if (mode === TALENT_LEARNING_MODE.ENFORCE && !validation.ok) {
        notifyTalentLearningResult(validation, { force: true });
        return;
      }
      if (mode !== TALENT_LEARNING_MODE.ENFORCE && !validation.rulesOk) {
        notifyTalentLearningResult(validation, { force: true });
        return;
      }

      const xpCost = Math.max(0, _asNumber(validation.xpCost, 0));
      if (xpCost > _asNumber(derived?.xp, 0)) {
        ui.notifications?.warn?.(`Not enough XP. Required ${xpCost}, available ${_asNumber(derived?.xp, 0)}.`);
        return;
      }

      await this.#stageOperation({
        kind: "talentLearn",
        label: `Learn talent: ${item.name}`,
        costXp: xpCost,
        costWealth: 0,
        payload: { itemData: item.toObject(), mode },
      });
      return;
    }

    if (item.type === "spell") {
      const actorMock = this.#buildValidationActor(derived);
      const costs = computeSpellLearningCosts(item, actorMock);
      const spellType = normalizeSpellLearningType(item);
      const knownSpellIndex = buildKnownSpellIndex(actorMock);
      const xpValidation = validateSpellLearningPurchase(actorMock, item, "xp", { knownSpellIndex });
      const drakesValidation = validateSpellLearningPurchase(actorMock, item, "drakes", { knownSpellIndex });
      const xpLabel = spellType === "ritual"
        ? "Learn Ritual (25 XP)"
        : `${spellType === "unconventional" ? "Unconventional" : "Conventional"} (XP ${costs.xpCost})`;

      if (!xpValidation.ok && !drakesValidation.ok) {
        ui.notifications?.warn?.(xpValidation.reason || drakesValidation.reason || "Spell learning blocked.");
        return;
      }

      const answer = await customDialog({
        title: `Stage Spell Learn: ${item.name}`,
        content: `<div style="display:flex; flex-direction:column; gap:8px;"><p style="margin:0;">Type: <b>${spellType}</b> | Level <b>${costs.level}</b>.</p><p style="margin:0;">Choose payment mode for staged purchase.</p></div>`,
        buttons: {
          ...(xpValidation.ok ? { xp: { label: xpLabel } } : {}),
          ...(drakesValidation.ok ? { drakes: { label: `Learn (${costs.drakesCost} Drakes)` } } : {}),
          cancel: { label: "Cancel" },
        },
        default: xpValidation.ok ? "xp" : "drakes",
      });

      if (!answer || answer === "cancel") return;
      const paymentMode = answer === "drakes" ? "drakes" : "xp";
      const validation = validateSpellLearningPurchase(actorMock, item, paymentMode, { knownSpellIndex });
      if (!validation.ok) {
        ui.notifications?.warn?.(validation.reason ?? "Spell learning blocked.");
        return;
      }

      await this.#stageOperation({
        kind: "spellLearn",
        label: `Learn spell: ${item.name} (${paymentMode.toUpperCase()})`,
        costXp: paymentMode === "xp" ? _asNumber(validation.costs?.xpCost, 0) : 0,
        costWealth: paymentMode === "drakes" ? _asNumber(validation.costs?.drakesCost, 0) : 0,
        payload: { itemData: item.toObject(), paymentMode },
      });
      return;
    }

    ui.notifications?.warn?.(`Unsupported drop type: ${item.type}`);
  }

  _onCloseClick(event) {
    event?.preventDefault?.();
    return this.close();
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#dropZonesBound = false;
    this.#bindDropZones();
    const select = this.element?.querySelector?.("#uesrpg-spendxp-characteristic");
    if (select) {
      if (this.#selectedCharacteristic) select.value = this.#selectedCharacteristic;
      select.addEventListener("change", (ev) => {
        const key = String(ev?.currentTarget?.value ?? "").trim().toLowerCase();
        if (key) this.#selectedCharacteristic = key;
      });
    }
  }

  async close(options = {}) {
    if (!Boolean(options?.force)) {
      const ok = await this.#confirmDiscardIfDirty();
      if (!ok) return this;
    }
    const result = await super.close(options);
    if (this.#onClose) {
      try {
        await this.#onClose(this.#actor);
      } catch (_err) {
        /* no-op */
      }
    }
    return result;
  }

  async _onOpenItem(event, target) {
    event?.preventDefault?.();
    const itemRef = String(target?.dataset?.itemId ?? "").trim();
    if (!itemRef || itemRef.startsWith("temp:")) {
      ui.notifications?.info?.("This item is staged and not yet created.");
      return;
    }
    const itemId = itemRef.startsWith("id:") ? itemRef.slice(3) : itemRef;
    const item = this.#actor.items.get(itemId);
    if (!item) return;
    await item.sheet?.render?.(true);
  }

  async _onAdvanceCharacteristic(event, _target) {
    event?.preventDefault?.();
    const select = this.element?.querySelector?.("#uesrpg-spendxp-characteristic");
    const key = String(select?.value ?? "").trim().toLowerCase();
    if (key) this.#selectedCharacteristic = key;
    if (!key || key === "lck") {
      ui.notifications?.warn?.("Luck cannot be advanced in this menu.");
      return;
    }

    const derived = this.#draftDerived;
    const c = derived?.characteristics?.[key];
    if (!c) return;

    const bonus = _asNumber(c?.bonus, Math.floor(_asNumber(c?.total, 0) / 10));
    const baseCost = 30 * bonus;
    const favored = Boolean(c?.favored);
    const xpCost = discountCostIfFavored(baseCost, favored);
    const currentXp = _asNumber(derived?.xp, 0);
    if (xpCost > currentXp) {
      ui.notifications?.warn?.(`Not enough XP. Required ${xpCost}, available ${currentXp}.`);
      return;
    }

    await this.#stageOperation({
      kind: "characteristicAdvance",
      label: `Advance ${_chaLabel(key)} (+1)`,
      costXp: xpCost,
      costWealth: 0,
      payload: { key, favored, baseCost, bonus },
    });
  }

  async _onAdvanceRank(event, target) {
    event?.preventDefault?.();
    const itemRef = String(target?.dataset?.itemId ?? "");
    const skill = this.#getProjectedSkill(itemRef);
    if (!skill) return;

    const currentRank = normalizeRank(skill.system?.rank);
    const nextRank = _nextRank(currentRank);
    if (!nextRank) {
      ui.notifications?.warn?.("Rank is already at maximum.");
      return;
    }
    if (!this.#rankGateOverride) {
      const xpTotal = _asNumber(this.#draftDerived?.xpTotal, 0);
      const maxIdx = getMaxPurchasableRankIndexFromXpTotal(xpTotal);
      if (SKILL_RANK_ORDER.indexOf(nextRank) > maxIdx) {
        ui.notifications?.warn?.(`Total XP gating blocks rank ${nextRank}. Enable override to bypass.`);
        return;
      }
    }

    const flatData = { "system.rank": nextRank };
    const plan = this.#planSkillChange(skill, flatData, this.#draftDerived);
    if (!plan.ok) {
      ui.notifications?.warn?.(plan.reason ?? "Unable to stage rank advance.");
      return;
    }

    await this.#stageOperation({
      kind: "skillRankAdvance",
      label: `${skill.name}: ${currentRank} -> ${nextRank}`,
      costXp: _asNumber(plan.xpCost, 0),
      costWealth: 0,
      payload: { itemRef: skill.key, flatData },
    });
  }

  async _onToggleRankGate(event, target) {
    event?.preventDefault?.();
    this.#rankGateOverride = Boolean(target?.checked);
    await this.render();
  }

  async _onAddSpecialization(event, target) {
    event?.preventDefault?.();
    const skill = this.#getProjectedSkill(String(target?.dataset?.itemId ?? ""));
    if (!skill) return;
    if (!["skill", "magicSkill"].includes(skill.type)) {
      ui.notifications?.warn?.("Specializations are only supported for skills and magic skills.");
      return;
    }

    const row = target.closest(".uesrpg-spendxp__skill-row");
    const input = row?.querySelector?.('input[data-field="newSpec"]');
    const spec = String(input?.value ?? "").trim();
    if (!spec) return;
    const specs = parseSpecializations(skill.system?.trainedItems ?? "");
    if (specs.some((s) => s.toLowerCase() === spec.toLowerCase())) {
      ui.notifications?.warn?.("Specialization already exists.");
      return;
    }

    const flatData = { "system.trainedItems": [...specs, spec].join(", ") };
    const plan = this.#planSkillChange(skill, flatData, this.#draftDerived);
    if (!plan.ok) {
      ui.notifications?.warn?.(plan.reason ?? "Unable to stage specialization.");
      return;
    }

    await this.#stageOperation({
      kind: "skillAddSpec",
      label: `${skill.name}: Add specialization "${spec}"`,
      costXp: _asNumber(plan.xpCost, 0),
      costWealth: 0,
      payload: { itemRef: skill.key, flatData },
    });
  }

  async _onAddEquipment(event, target) {
    event?.preventDefault?.();
    const skill = this.#getProjectedSkill(String(target?.dataset?.itemId ?? ""));
    if (!skill || skill.type !== "combatStyle") return;

    const row = target.closest(".uesrpg-spendxp__skill-row");
    const input = row?.querySelector?.('input[data-field="newEquipment"]');
    const equipmentLabel = String(input?.value ?? "").trim();
    if (!equipmentLabel) return;

    const current = Array.isArray(skill.system?.trainedEquipment) ? [...skill.system.trainedEquipment] : [];
    if (current.some((v) => String(v ?? "").trim().toLowerCase() === equipmentLabel.toLowerCase())) {
      ui.notifications?.warn?.("That equipment entry already exists.");
      return;
    }
    if (current.length < 10) current.push(equipmentLabel);
    else {
      const idx = current.findIndex((v) => !String(v ?? "").trim());
      if (idx === -1) {
        ui.notifications?.warn?.("Combat Style trained equipment is capped at 10 entries.");
        return;
      }
      current[idx] = equipmentLabel;
    }

    const flatData = { "system.trainedEquipment": current };
    const plan = this.#planSkillChange(skill, flatData, this.#draftDerived);
    if (!plan.ok) {
      ui.notifications?.warn?.(plan.reason ?? "Unable to stage equipment entry.");
      return;
    }

    await this.#stageOperation({
      kind: "combatStyleAddEquipment",
      label: `${skill.name}: Add trained equipment "${equipmentLabel}"`,
      costXp: _asNumber(plan.xpCost, 0),
      costWealth: 0,
      payload: { itemRef: skill.key, flatData },
    });
  }

  async _onRemoveDraftEntry(event, target) {
    event?.preventDefault?.();
    const id = String(target?.dataset?.entryId ?? "");
    if (!id) return;
    await this.#removeStagedOperation(id);
  }

  async _onDiscardDraft(event, _target) {
    event?.preventDefault?.();
    if (!this.#dirty) return;
    const yes = await confirmDialog({
      title: "Discard Staged Purchases",
      content: "<p>Discard all staged purchases?</p>",
      yesLabel: "Discard",
      noLabel: "Cancel",
    });
    if (!yes) return;
    await this.#clearDraft();
  }

  async _onConfirmDraft(event, _target) {
    event?.preventDefault?.();
    if (!this.#draftEntries.length) {
      ui.notifications?.info?.("No staged purchases to confirm.");
      return;
    }
    const out = await this.#finalizeDraft();
    if (!out.ok) {
      ui.notifications?.error?.(out.reason ?? "Failed to confirm staged purchases.");
      return;
    }
    ui.notifications?.info?.(`Confirmed ${out.applied} staged purchase(s).`);
    await this.render();
  }

  #isFavoredForSkillSystem(skillSystem, derived) {
    const raw = String(skillSystem?.governingCha ?? skillSystem?.baseCha ?? "").toLowerCase();
    const map = [
      ["str", /\bstr\b|\bstrength\b/],
      ["end", /\bend\b|\bendurance\b/],
      ["agi", /\bagi\b|\bagility\b/],
      ["int", /\bint\b|\bintelligence\b/],
      ["wp", /\bwp\b|\bwillpower\b/],
      ["prc", /\bprc\b|\bperception\b/],
      ["prs", /\bprs\b|\bpersonality\b/],
      ["lck", /\blck\b|\bluck\b/],
    ];
    for (const [key, rx] of map) {
      if (rx.test(raw) && derived?.characteristics?.[key]?.favored) return true;
    }
    return false;
  }

  #readDropData(event) {
    try {
      return foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    } catch (_err) {
      try {
        return TextEditor.getDragEventData(event);
      } catch (_err2) {
        return null;
      }
    }
  }

  #bindDropZones() {
    if (this.#dropZonesBound) return;
    const root = this.element;
    if (!root) return;
    const zones = root.querySelectorAll(".uesrpg-spendxp__dropzone");
    if (!zones?.length) return;
    for (const zone of zones) {
      zone.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        zone.classList.add("is-dragover");
      });
      zone.addEventListener("dragleave", () => {
        zone.classList.remove("is-dragover");
      });
      zone.addEventListener("drop", async (ev) => {
        zone.classList.remove("is-dragover");
        await this._onDrop(ev);
      });
    }
    this.#dropZonesBound = true;
  }
}

