import { requestXpPurchase, getXpPurchaseSnapshot } from "../../../../core/advancement/purchase-service.js";
import { showXpPurchaseFailure } from "../../../advancement/purchase-review.js";
import { resolveDroppedItem } from "../../../../utils/drop-data.js";
import { customDialog, confirmDialog } from "../../../../utils/dialog-v2-helper.js";
import {
  buildSkillAdvancementPlan,
  normalizeRank,
  parseSpecializations,
  discountCostIfFavored,
  computeCharacteristicAdvancementCost,
  isFavoredSkillForActor,
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
import { getCampaignRankFromXpTotal as campaignRankFromXpTotal } from "../../../../core/advancement/progression.js";
import { templatePath } from "../../../constants.js";
import { t, tf } from "../../../../utils/i18n.js";
import { TRAINING_RANK_LABELS } from "../../../../core/config/label-catalog.js";
import {
  extractCoreSkillSourceDocumentId,
  getCoreSkillMetadata,
  getEmbeddedCoreSkillFolderId,
} from "../../../../core/compendium/core-skills.js";
import {
  isChargenCompleted,
  promptAdministrativeCorrectionReason,
} from "./racial-grants.js";
import { withApplicationUniqueId } from "../application-identity.js";

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
  if (!system) return {};
  try {
    if (typeof system.toObject === "function") {
      return foundry.utils.deepClone(system.toObject(true) ?? {});
    }
  } catch (_err) {
    /* fall through to plain clone */
  }
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

function _rankLabel(rank) {
  const key = normalizeRank(rank);
  return t(TRAINING_RANK_LABELS[key] ?? key);
}

function _setPathValue(source, path, value) {
  foundry.utils.setProperty(source, path.replace(/^system\./, "system."), value);
}

function _applyFlatDataToSkillSnapshot(skill, flatData) {
  if (!skill || !flatData || typeof flatData !== "object") return;
  skill.system = _cloneSystem(skill.system);
  for (const [path, value] of Object.entries(flatData)) {
    _setPathValue(skill, path, foundry.utils.deepClone(value));
  }
}

export class SpendXpMenuAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  #purchaseBase = null;
  #onClose = null;
  #dropZonesBound = false;
  #selectedCharacteristic = "str";
  #administrativeCorrectionReason = null;
  #sessionBase = null;
  #draftEntries = [];
  #draftDerived = null;
  #dirty = false;
  #nextDraftId = 1;
  #coreSkillMetadata = null;

  constructor(actor, options = {}) {
    super(withApplicationUniqueId(options, `${actor?.uuid ?? "actor"}-${foundry.utils.randomID()}`));
    this.#actor = actor;
    this.#onClose = typeof options.onClose === "function" ? options.onClose : null;
    const initial = Object.keys(actor?.system?.characteristics ?? {}).find((k) => k !== "lck");
    this.#selectedCharacteristic = String(initial ?? "str");
    this.#captureSessionBase();
    this.#recomputeDraftDerived();
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-spend-xp-menu-v2-{id}",
    classes: ["worldbuilding", "uesrpg", "uesrpg-spendxp-app"],
    position: { width: 900, height: 680 },
    window: { resizable: true },
    actions: {
      close: SpendXpMenuAppV2.prototype._onCloseClick,
      advanceCharacteristic: SpendXpMenuAppV2.prototype._onAdvanceCharacteristic,
      advanceRank: SpendXpMenuAppV2.prototype._onAdvanceRank,
      beginAdministrativeCorrection: SpendXpMenuAppV2.prototype._onBeginAdministrativeCorrection,
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
    await app.#prepareCoreSkillFilter();
    app.#captureSessionBase();
    app.#recomputeDraftDerived();
    await app.render(true);
    return app;
  }

  get title() {
    return t("UESRPG.Dialogs.SpendXp.Title", "Spend XP (Chargen)");
  }

  async #prepareCoreSkillFilter() {
    if (this.#coreSkillMetadata) return;
    try {
      this.#coreSkillMetadata = await getCoreSkillMetadata();
    } catch (err) {
      console.warn("uesrpg-3ev4 | Failed to resolve Core Skills folder metadata for Spend XP filtering.", err);
      this.#coreSkillMetadata = { rows: [], documentIds: new Set(), coreFolderIds: new Set(), allFolderIds: new Set() };
    }
  }

  #isSkillLikeAvailable(item) {
    const type = String(item?.type ?? "");
    if (type === "combatStyle") return true;
    if (!["skill", "magicSkill"].includes(type)) return false;

    const sourceId = extractCoreSkillSourceDocumentId(item);
    if (sourceId) return Boolean(this.#coreSkillMetadata?.documentIds?.has?.(sourceId));

    const folderId = getEmbeddedCoreSkillFolderId(item);
    if (folderId && this.#coreSkillMetadata?.allFolderIds?.has?.(folderId)) {
      return Boolean(this.#coreSkillMetadata?.coreFolderIds?.has?.(folderId));
    }

    return true;
  }

  #skillLikeItems(items) {
    return Array.from(items?.contents ?? items ?? [])
      .filter((it) => ["skill", "magicSkill", "combatStyle"].includes(it?.type))
      .filter((it) => this.#isSkillLikeAvailable(it));
  }

  #buildLiveFingerprint() {
    const actor = this.#actor;
    const fp = { xp: _asNumber(actor?.system?.xp, 0), wealth: _asNumber(actor?.system?.wealth, 0), characteristics: {}, skills: [], talents: [], spells: [] };
    for (const key of ["str", "end", "agi", "int", "wp", "prc", "prs", "lck"]) {
      fp.characteristics[key] = {
        base: _asNumber(actor?.system?.characteristics?.[key]?.base, 0),
        favored: Boolean(actor?.system?.characteristics?.[key]?.favored),
      };
    }
    fp.skills = this.#skillLikeItems(actor.items)
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
    this.#purchaseBase = getXpPurchaseSnapshot(this.#actor).catch(() => null);
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
    const skills = this.#skillLikeItems(actor.items)
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
      if (!this.#isAdministrativeCorrection()) projected.xp -= _asNumber(entry.costXp, 0);
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
          _applyFlatDataToSkillSnapshot(skill, entry.payload?.flatData ?? {});
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
        xp: this.#isAdministrativeCorrection() ? Number.MAX_SAFE_INTEGER : derived.xp,
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
        xp: this.#isAdministrativeCorrection() ? Number.MAX_SAFE_INTEGER : derived.xp,
        xpTotal: derived.xpTotal,
        characteristics: foundry.utils.deepClone(derived.characteristics),
      },
    };
    const itemMock = { type: skill.type, system: _cloneSystem(skill.system) };
    return buildSkillAdvancementPlan({
      actor: actorMock,
      item: itemMock,
      flatData,
      options: { bypassXpPayment: this.#isAdministrativeCorrection() },
    });
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
      label: String(op.label ?? t("UESRPG.Dialogs.SpendXp.StagedOperation")),
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
    if (!this.#draftEntries.length) this.#captureSessionBase();
    this.#recomputeDraftDerived();
    await this.render();
  }

  async #clearDraft() {
    this.#draftEntries = [];
    this.#captureSessionBase();
    this.#recomputeDraftDerived();
    await this.render();
  }

  async #confirmDiscardIfDirty() {
    if (!this.#dirty) return true;
    return confirmDialog({
      title: t("UESRPG.Dialogs.SpendXp.DiscardUnconfirmedTitle"),
      classes: ["uesrpg-chargen-dialog"],
      content: `<p>${t("UESRPG.Dialogs.SpendXp.DiscardUnconfirmedContent")}</p>`,
      yesLabel: t("UESRPG.UI.Discard"),
      noLabel: t("UESRPG.UI.KeepEditing"),
    });
  }

  #isDrifted() {
    return this.#buildLiveFingerprint() !== this.#sessionBase?.fingerprint;
  }

async #finalizeDraft() {
    if (!this.#draftEntries.length) return { ok: true, applied: 0 };
    const result = await requestXpPurchase(this.#actor, "spendXpDraft", {
      entries: foundry.utils.deepClone(this.#draftEntries), administrativeReason: this.#administrativeCorrectionReason,
    }, { expected: await this.#purchaseBase });
    if (!result.ok) return result;
    this.#draftEntries = [];
    this.#administrativeCorrectionReason = null;
    this.#captureSessionBase();
    this.#recomputeDraftDerived();
    return result;
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
        const canAdvance = Boolean(nextRank) && (this.#isAdministrativeCorrection() || rankAllowedByXp);
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
          rankLabel: _rankLabel(rank),
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
      actorName: this.#sessionBase?.actorName ?? this.#actor?.name ?? t("UESRPG.UI.Unknown"),
      xp: _asNumber(this.#sessionBase?.xp, 0),
      xpProjected: _asNumber(derived?.xp, 0),
      xpTotal: _asNumber(this.#sessionBase?.xpTotal, 0),
      wealth: _asNumber(this.#sessionBase?.wealth, 0),
      wealthProjected: _asNumber(derived?.wealth, 0),
      campaignRank: campaignRankFromXpTotal(_asNumber(this.#sessionBase?.xpTotal, 0)),
      chaOptions,
      selectedCharacteristic: this.#selectedCharacteristic,
      administrativeCorrection: this.#isAdministrativeCorrection(),
      canAdministrativeCorrect: Boolean(game.user?.isGM && isChargenCompleted(this.#actor)),
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
      if (!this.#isSkillLikeAvailable(item)) {
        ui.notifications?.warn?.(t("UESRPG.Notifications.SpendXp.CoreSkillsOnly"));
        return;
      }
      const tempId = `sk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      await this.#stageOperation({
        kind: "addSkillLikeItem",
        label: tf("UESRPG.Dialogs.SpendXp.AddItemLikeLabel", { type: item.type, name: item.name }),
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

      if (mode === TALENT_LEARNING_MODE.ENFORCE && !validation.ok) {
        notifyTalentLearningResult(validation, { force: true });
        return;
      }
      if (mode !== TALENT_LEARNING_MODE.ENFORCE && !validation.rulesOk) {
        notifyTalentLearningResult(validation, { force: true });
        return;
      }
      if (mode === TALENT_LEARNING_MODE.WARN) notifyTalentLearningResult(validation);

      const xpCost = Math.max(0, _asNumber(validation.xpCost, 0));
      if (!this.#isAdministrativeCorrection() && xpCost > _asNumber(derived?.xp, 0)) {
        ui.notifications?.warn?.(tf("UESRPG.Notifications.SpendXp.NotEnoughXp", { required: xpCost, available: _asNumber(derived?.xp, 0) }));
        return;
      }

      await this.#stageOperation({
        kind: "talentLearn",
        label: tf("UESRPG.Dialogs.SpendXp.LearnTalentLabel", { name: item.name }),
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
        ui.notifications?.warn?.(xpValidation.reason || drakesValidation.reason || t("UESRPG.Notifications.SpendXp.SpellLearningBlocked"));
        return;
      }

      const answer = await customDialog({
        layout: "workflow",
        title: tf("UESRPG.Dialogs.SpendXp.StageSpellLearnTitle", { name: item.name }),
        classes: ["uesrpg-chargen-dialog"],
        content: `<div class="uesrpg-cg-dialog uesrpg-cg-stack uesrpg-cg-summary"><p>${tf("UESRPG.Dialogs.SpendXp.StageSpellLearnInfo", { type: spellType, level: costs.level })}</p><p>${t("UESRPG.Dialogs.SpendXp.ChoosePaymentMode")}</p></div>`,
        buttons: {
          ...(xpValidation.ok ? { xp: { label: xpLabel } } : {}),
          ...(drakesValidation.ok ? { drakes: { label: tf("UESRPG.Dialogs.SpendXp.LearnDrakesLabel", { cost: costs.drakesCost }) } } : {}),
          cancel: { label: t("UESRPG.UI.Cancel") },
        },
        default: xpValidation.ok ? "xp" : "drakes",
      });

      if (!answer || answer === "cancel") return;
      const paymentMode = answer === "drakes" ? "drakes" : "xp";
      const validation = validateSpellLearningPurchase(actorMock, item, paymentMode, { knownSpellIndex });
      if (!validation.ok) {
        ui.notifications?.warn?.(validation.reason ?? t("UESRPG.Notifications.SpendXp.SpellLearningBlocked"));
        return;
      }

      await this.#stageOperation({
        kind: "spellLearn",
        label: tf("UESRPG.Dialogs.SpendXp.LearnSpellLabel", { name: item.name, paymentMode: paymentMode.toUpperCase() }),
        costXp: paymentMode === "xp" ? _asNumber(validation.costs?.xpCost, 0) : 0,
        costWealth: paymentMode === "drakes" ? _asNumber(validation.costs?.drakesCost, 0) : 0,
        payload: { itemData: item.toObject(), paymentMode },
      });
      return;
    }

    ui.notifications?.warn?.(tf("UESRPG.Notifications.SpendXp.UnsupportedDropType", { type: item.type }));
  }

  _onCloseClick(event) {
    event?.preventDefault?.();
    return this.close();
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#dropZonesBound = false;
    this.#bindDropZones();
    const select = this.element?.querySelector?.('[data-role="characteristic-select"]');
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
      ui.notifications?.info?.(t("UESRPG.Notifications.SpendXp.StagedItemNotCreated"));
      return;
    }
    const itemId = itemRef.startsWith("id:") ? itemRef.slice(3) : itemRef;
    const item = this.#actor.items.get(itemId);
    if (!item) return;
    await item.sheet?.render?.(true);
  }

  async _onAdvanceCharacteristic(event, _target) {
    event?.preventDefault?.();
    const select = this.element?.querySelector?.('[data-role="characteristic-select"]');
    const key = String(select?.value ?? "").trim().toLowerCase();
    if (key) this.#selectedCharacteristic = key;
    if (!key || key === "lck") {
      ui.notifications?.warn?.(t("UESRPG.Notifications.SpendXp.LuckCannotAdvance"));
      return;
    }

    const derived = this.#draftDerived;
    const c = derived?.characteristics?.[key];
    if (!c) return;

    const { bonus, baseCost, favored, xpCost } = computeCharacteristicAdvancementCost(c);
    const currentXp = _asNumber(derived?.xp, 0);
    if (!this.#isAdministrativeCorrection() && xpCost > currentXp) {
      ui.notifications?.warn?.(tf("UESRPG.Notifications.SpendXp.NotEnoughXp", { required: xpCost, available: currentXp }));
      return;
    }

    await this.#stageOperation({
      kind: "characteristicAdvance",
      label: tf("UESRPG.Dialogs.SpendXp.AdvanceCharacteristicLabel", { key: _chaLabel(key) }),
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
      ui.notifications?.warn?.(t("UESRPG.Notifications.SpendXp.RankAtMaximum"));
      return;
    }
    if (!this.#isAdministrativeCorrection()) {
      const xpTotal = _asNumber(this.#draftDerived?.xpTotal, 0);
      const maxIdx = getMaxPurchasableRankIndexFromXpTotal(xpTotal);
      if (SKILL_RANK_ORDER.indexOf(nextRank) > maxIdx) {
        ui.notifications?.warn?.(tf("UESRPG.Notifications.SpendXp.TotalXpGatesRank", { rank: _rankLabel(nextRank) }));
        return;
      }
    }

    const flatData = { "system.rank": nextRank };
    const plan = this.#planSkillChange(skill, flatData, this.#draftDerived);
    if (!plan.ok) {
      ui.notifications?.warn?.(plan.reason ?? t("UESRPG.Notifications.SpendXp.UnableStageRank"));
      return;
    }

    await this.#stageOperation({
      kind: "skillRankAdvance",
      label: tf("UESRPG.Dialogs.SpendXp.AdvanceRankLabel", { name: skill.name, current: _rankLabel(currentRank), next: _rankLabel(nextRank) }),
      costXp: _asNumber(plan.xpCost, 0),
      costWealth: 0,
      payload: { itemRef: skill.key, flatData, basisSystem: _cloneSystem(skill.system) },
    });
  }

  async _onBeginAdministrativeCorrection(event, target) {
    event?.preventDefault?.();
    if (!game.user?.isGM || !isChargenCompleted(this.#actor)) {
      ui.notifications?.warn?.(t("UESRPG.DefectUpdate.GmCorrectionRequired", "A GM Administrative Correction is required after character generation."));
      return;
    }
    const reason = await promptAdministrativeCorrectionReason();
    if (!reason) return;
    this.#administrativeCorrectionReason = reason;
    this.#recomputeDraftDerived();
    await this.render();
  }

  #isAdministrativeCorrection() {
    return Boolean(
      game.user?.isGM
      && isChargenCompleted(this.#actor)
      && String(this.#administrativeCorrectionReason ?? "").trim().length >= 3
    );
  }

  async _onAddSpecialization(event, target) {
    event?.preventDefault?.();
    const skill = this.#getProjectedSkill(String(target?.dataset?.itemId ?? ""));
    if (!skill) return;
    if (!["skill", "magicSkill"].includes(skill.type)) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.SpendXp.SpecializationsOnlySkills"));
      return;
    }

    const row = target.closest(".uesrpg-spendxp__skill-row");
    const input = row?.querySelector?.('input[data-field="newSpec"]');
    const spec = String(input?.value ?? "").trim();
    if (!spec) return;
    const specs = parseSpecializations(skill.system?.trainedItems ?? "");
    if (specs.some((s) => s.toLowerCase() === spec.toLowerCase())) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.SpendXp.SpecializationExists"));
      return;
    }

    const flatData = { "system.trainedItems": [...specs, spec].join(", ") };
    const plan = this.#planSkillChange(skill, flatData, this.#draftDerived);
    if (!plan.ok) {
      ui.notifications?.warn?.(plan.reason ?? t("UESRPG.Notifications.SpendXp.UnableStageSpecialization"));
      return;
    }

    await this.#stageOperation({
      kind: "skillAddSpec",
      label: tf("UESRPG.Dialogs.SpendXp.AddSpecializationLabel", { name: skill.name, spec }),
      costXp: _asNumber(plan.xpCost, 0),
      costWealth: 0,
      payload: { itemRef: skill.key, flatData, basisSystem: _cloneSystem(skill.system) },
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
      ui.notifications?.warn?.(t("UESRPG.Notifications.SpendXp.EquipmentEntryExists"));
      return;
    }
    if (current.length < 10) current.push(equipmentLabel);
    else {
      const idx = current.findIndex((v) => !String(v ?? "").trim());
      if (idx === -1) {
        ui.notifications?.warn?.(t("UESRPG.Notifications.SpendXp.CombatStyleEquipmentCapped"));
        return;
      }
      current[idx] = equipmentLabel;
    }

    const flatData = { "system.trainedEquipment": current };
    const plan = this.#planSkillChange(skill, flatData, this.#draftDerived);
    if (!plan.ok) {
      ui.notifications?.warn?.(plan.reason ?? t("UESRPG.Notifications.SpendXp.UnableStageEquipment"));
      return;
    }

    await this.#stageOperation({
      kind: "combatStyleAddEquipment",
      label: tf("UESRPG.Dialogs.SpendXp.AddEquipmentLabel", { name: skill.name, equipment: equipmentLabel }),
      costXp: _asNumber(plan.xpCost, 0),
      costWealth: 0,
      payload: { itemRef: skill.key, flatData, basisSystem: _cloneSystem(skill.system) },
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
      title: t("UESRPG.Dialogs.SpendXp.DiscardStagedTitle"),
      classes: ["uesrpg-chargen-dialog"],
      content: `<p>${t("UESRPG.Dialogs.SpendXp.DiscardStagedContent")}</p>`,
      yesLabel: t("UESRPG.UI.Discard"),
      noLabel: t("UESRPG.UI.Cancel"),
    });
    if (!yes) return;
    this.#administrativeCorrectionReason = null;
    await this.#clearDraft();
  }

  async _onConfirmDraft(event, _target) {
    event?.preventDefault?.();
    if (!this.#draftEntries.length) {
      ui.notifications?.info?.(t("UESRPG.Notifications.SpendXp.NoStagedPurchases"));
      return;
    }
    const out = await this.#finalizeDraft();
    if (!out.ok) {
      await showXpPurchaseFailure(this.#actor, out);
      return;
    }
    if (!out.replayed) ui.notifications?.info?.(tf("UESRPG.Notifications.SpendXp.ConfirmedPurchases", { count: out.applied }));
    await this.render();
  }

  #isFavoredForSkillSystem(skillSystem, derived) {
    return isFavoredSkillForActor({ system: { characteristics: derived?.characteristics ?? {} } },
      skillSystem?.governingCha ?? skillSystem?.baseCha ?? "");
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
