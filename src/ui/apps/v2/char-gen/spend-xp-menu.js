import {
  requestUpdateDocument,
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
} from "../../../../utils/authority-proxy.js";
import { resolveDroppedItem } from "../../../../utils/drop-data.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
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
  applyTalentLearningXpCost,
} from "../../../../core/traits/talent-learning.js";
import {
  applySpellLearningPurchase,
  computeSpellLearningCosts,
  normalizeSpellLearningType,
  validateSpellLearningPurchase,
} from "../../../../core/advancement/spell-learning.js";
import { campaignRankFromXpTotal } from "../../../sheets/shared/dialogs/character-menus.js";
import { appendChargenAudit } from "./audit-log.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function _asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _chaLabel(key) {
  const map = {
    str: "STR",
    end: "END",
    agi: "AGI",
    int: "INT",
    wp: "WP",
    prc: "PRC",
    prs: "PRS",
    lck: "LCK",
  };
  return map[String(key ?? "").toLowerCase()] ?? String(key ?? "").toUpperCase();
}

function _nextRank(rank) {
  const idx = SKILL_RANK_ORDER.indexOf(rank);
  if (idx < 0 || idx >= (SKILL_RANK_ORDER.length - 1)) return null;
  return SKILL_RANK_ORDER[idx + 1];
}

export class SpendXpMenuAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  #onClose = null;
  #dropZonesBound = false;
  #selectedCharacteristic = "str";
  #rankGateOverride = false;

  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
    this.#onClose = typeof options.onClose === "function" ? options.onClose : null;
    const initial = Object.keys(actor?.system?.characteristics ?? {}).find((k) => k !== "lck");
    this.#selectedCharacteristic = String(initial ?? "str");
    this.#rankGateOverride = Boolean(actor?.getFlag?.("uesrpg-3ev4", "chargen")?.spendXp?.rankGateOverride ?? false);
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-spend-xp-menu-v2",
    classes: ["worldbuilding", "uesrpg", "uesrpg-spendxp-app"],
    position: {
      width: 980,
      height: 760,
    },
    window: {
      title: "Spend XP (Chargen)",
      resizable: true,
    },
    actions: {
      close: SpendXpMenuAppV2.prototype._onCloseClick,
      advanceCharacteristic: SpendXpMenuAppV2.prototype._onAdvanceCharacteristic,
      advanceRank: SpendXpMenuAppV2.prototype._onAdvanceRank,
      toggleRankGate: SpendXpMenuAppV2.prototype._onToggleRankGate,
      addSpec: SpendXpMenuAppV2.prototype._onAddSpecialization,
      addEquipment: SpendXpMenuAppV2.prototype._onAddEquipment,
      openItem: SpendXpMenuAppV2.prototype._onOpenItem,
    },
    dragDrop: [
      {
        dragSelector: null,
        dropSelector: ".uesrpg-spendxp__dropzone",
      },
    ],
  };

  static PARTS = {
    main: {
      template: "systems/uesrpg-3ev4/templates/v2/apps/spend-xp-menu.hbs",
      scrollable: [".uesrpg-spendxp__scroll"],
    },
  };

  static async prompt(actor, options = {}) {
    const app = new SpendXpMenuAppV2(actor, options);
    await app.render(true);
    return app;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.#actor;

    const xp = _asNumber(actor?.system?.xp, 0);
    const xpTotal = _asNumber(actor?.system?.xpTotal, 0);
    const wealth = _asNumber(actor?.system?.wealth, 0);
    const campaignRank = campaignRankFromXpTotal(xpTotal);
    const characteristics = actor?.system?.characteristics ?? {};

    const chaOptions = Object.entries(characteristics)
      .filter(([key]) => key !== "lck")
      .map(([key, c]) => ({
        key,
        label: _chaLabel(key),
        base: _asNumber(c?.base, 0),
        bonus: _asNumber(c?.bonus, Math.floor(_asNumber(c?.total, 0) / 10)),
        favored: Boolean(c?.favored),
      }));

    const skills = actor.items
      .filter((it) => ["skill", "magicSkill", "combatStyle"].includes(it.type))
      .map((it) => {
        const rank = normalizeRank(it.system?.rank);
        const nextRank = _nextRank(rank);
        const favored = Boolean(this.#isFavoredForItem(it));
        const nextRankBase = nextRank ? _asNumber(SKILL_RANK_XP_COST[nextRank], 0) : 0;
        const nextRankXpCost = nextRank ? discountCostIfFavored(nextRankBase, favored) : 0;
        const maxIdx = getMaxPurchasableRankIndexFromXpTotal(xpTotal);
        const rankAllowedByXp = !nextRank ? false : SKILL_RANK_ORDER.indexOf(nextRank) <= maxIdx;
        const canAdvance = Boolean(nextRank) && (this.#rankGateOverride || rankAllowedByXp);

        return {
          id: it.id,
          name: it.name,
          img: it.img,
          type: it.type,
          rank,
          rankLabel: rank.charAt(0).toUpperCase() + rank.slice(1),
          favored,
          nextRankXpCost,
          canAdvance,
          specCount: parseSpecializations(it.system?.trainedItems ?? "").length,
          teCount: Array.isArray(it.system?.trainedEquipment)
            ? it.system.trainedEquipment.map((v) => String(v ?? "").trim()).filter(Boolean).length
            : 0,
        };
      });

    return {
      ...context,
      actorName: actor?.name ?? "Unknown",
      xp,
      xpTotal,
      wealth,
      campaignRank,
      chaOptions,
      selectedCharacteristic: this.#selectedCharacteristic,
      rankGateOverride: this.#rankGateOverride,
      skills,
      talentLearningMode: String(getTalentLearningMode() ?? TALENT_LEARNING_MODE.OFF).toUpperCase(),
    };
  }

  async _onDrop(event) {
    event?.preventDefault?.();
    const data = this.#readDropData(event);
    if (!data || data.type !== "Item") return;

    const item = await resolveDroppedItem(data);
    if (!item) return;

    if (item.type === "talent") {
      await this.#handleTalentDrop(item);
      await this.render();
      return;
    }
    if (item.type === "spell") {
      await this.#handleSpellDrop(item);
      await this.render();
      return;
    }
    if (["skill", "magicSkill", "combatStyle"].includes(item.type)) {
      const created = await requestCreateEmbeddedDocuments(this.#actor, "Item", [item.toObject()]);
      if (created?.length) {
        ui.notifications?.info?.(`Added ${item.name}.`);
        await appendChargenAudit(this.#actor, {
          step: "spendxp",
          action: "dropItemAdded",
          payload: { name: item.name, type: item.type },
        });
      }
      await this.render();
      return;
    }

    await appendChargenAudit(this.#actor, {
      step: "spendxp",
      action: "dropUnsupported",
      payload: { name: item.name, type: item.type },
    });
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
    const itemId = String(target?.dataset?.itemId ?? "").trim();
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

    const c = this.#actor.system?.characteristics?.[key];
    if (!c) return;
    const bonus = _asNumber(c?.bonus, Math.floor(_asNumber(c?.total, 0) / 10));
    const baseCost = 30 * bonus;
    const favored = Boolean(c?.favored);
    const xpCost = discountCostIfFavored(baseCost, favored);
    const currentXp = _asNumber(this.#actor.system?.xp, 0);
    if (xpCost > currentXp) {
      ui.notifications?.warn?.(`Not enough XP. Required ${xpCost}, available ${currentXp}.`);
      return;
    }

    const base = _asNumber(c?.base, 0);
    const total = _asNumber(c?.total, base);
    const nextXp = currentXp - xpCost;

    await requestUpdateDocument(this.#actor, {
      [`system.characteristics.${key}.base`]: base + 1,
      [`system.characteristics.${key}.total`]: total + 1,
      "system.xp": nextXp,
    });

    await this.#appendSpendLog({
      type: "characteristic",
      name: _chaLabel(key),
      costXp: xpCost,
      costWealth: 0,
      details: { favored, baseCost, bonus },
    });
    await appendChargenAudit(this.#actor, {
      step: "spendxp",
      action: "advanceCharacteristic",
      payload: { key, xpCost, favored, from: base, to: base + 1 },
    });

    ui.notifications?.info?.(`Advanced ${_chaLabel(key)} for ${xpCost} XP.`);
    await this.render();
  }

  async _onAdvanceRank(event, target) {
    event?.preventDefault?.();
    const item = this.#actor.items.get(String(target?.dataset?.itemId ?? ""));
    if (!item) return;
    const currentRank = normalizeRank(item.system?.rank);
    const nextRank = _nextRank(currentRank);
    if (!nextRank) {
      ui.notifications?.warn?.("Rank is already at maximum.");
      return;
    }
    if (!this.#rankGateOverride) {
      const xpTotal = _asNumber(this.#actor.system?.xpTotal, 0);
      const maxIdx = getMaxPurchasableRankIndexFromXpTotal(xpTotal);
      if (SKILL_RANK_ORDER.indexOf(nextRank) > maxIdx) {
        ui.notifications?.warn?.(`Total XP gating blocks rank ${nextRank}. Enable override to bypass.`);
        return;
      }
    }
    await this.#applySkillPlan(item, { "system.rank": nextRank }, {
      type: "rank",
      name: `${item.name}: ${currentRank} -> ${nextRank}`,
      details: { itemType: item.type },
    });
    await this.render();
  }

  async _onToggleRankGate(event, target) {
    event?.preventDefault?.();
    const checked = Boolean(target?.checked);
    this.#rankGateOverride = checked;
    await requestUpdateDocument(this.#actor, {
      "flags.uesrpg-3ev4.chargen.spendXp.rankGateOverride": checked,
    });
    await appendChargenAudit(this.#actor, {
      step: "spendxp",
      action: "toggleRankGate",
      payload: { overrideEnabled: checked },
    });
    await this.render();
  }

  async _onAddSpecialization(event, target) {
    event?.preventDefault?.();
    const item = this.#actor.items.get(String(target?.dataset?.itemId ?? ""));
    if (!item) return;
    if (!["skill", "magicSkill"].includes(item.type)) {
      ui.notifications?.warn?.("Specializations are only supported for skills and magic skills.");
      return;
    }
    const row = target.closest(".uesrpg-spendxp__skill-row");
    const input = row?.querySelector?.('input[data-field="newSpec"]');
    const spec = String(input?.value ?? "").trim();
    if (!spec) return;

    const specs = parseSpecializations(item.system?.trainedItems ?? "");
    if (specs.some((s) => s.toLowerCase() === spec.toLowerCase())) {
      ui.notifications?.warn?.("Specialization already exists.");
      return;
    }
    const nextSpecs = [...specs, spec].join(", ");

    await this.#applySkillPlan(item, { "system.trainedItems": nextSpecs }, {
      type: "specialization",
      name: `${item.name}: ${spec}`,
      details: { itemType: item.type },
    });
    await this.render();
  }

  async _onAddEquipment(event, target) {
    event?.preventDefault?.();
    const item = this.#actor.items.get(String(target?.dataset?.itemId ?? ""));
    if (!item || item.type !== "combatStyle") return;

    const row = target.closest(".uesrpg-spendxp__skill-row");
    const input = row?.querySelector?.('input[data-field="newEquipment"]');
    const equipmentLabel = String(input?.value ?? "").trim();
    if (!equipmentLabel) return;

    const current = Array.isArray(item.system?.trainedEquipment) ? [...item.system.trainedEquipment] : [];
    if (current.some((v) => String(v ?? "").trim().toLowerCase() === equipmentLabel.toLowerCase())) {
      ui.notifications?.warn?.("That equipment entry already exists.");
      return;
    }
    if (current.length < 10) {
      current.push(equipmentLabel);
    } else {
      const idx = current.findIndex((v) => !String(v ?? "").trim());
      if (idx === -1) {
        ui.notifications?.warn?.("Combat Style trained equipment is capped at 10 entries.");
        return;
      }
      current[idx] = equipmentLabel;
    }

    await this.#applySkillPlan(item, { "system.trainedEquipment": current }, {
      type: "combatStyleExpansion",
      name: `${item.name}: ${equipmentLabel}`,
      details: { itemType: item.type },
    });
    await this.render();
  }

  async #applySkillPlan(item, flatData, logBase) {
    const plan = buildSkillAdvancementPlan({ actor: this.#actor, item, flatData });
    if (!plan.ok) {
      ui.notifications?.warn?.(plan.reason ?? "Unable to apply advancement.");
      return;
    }

    if (plan.xpCost > 0) {
      await requestUpdateDocument(this.#actor, { "system.xp": plan.nextXp });
    }
    try {
      await requestUpdateDocument(item, flatData);
    } catch (err) {
      if (plan.xpCost > 0) {
        await requestUpdateDocument(this.#actor, { "system.xp": _asNumber(this.#actor.system?.xp, 0) + plan.xpCost });
      }
      throw err;
    }

    if (plan.xpCost > 0) {
      await this.#appendSpendLog({
        ...logBase,
        costXp: plan.xpCost,
        costWealth: 0,
      });
      await appendChargenAudit(this.#actor, {
        step: "spendxp",
        action: logBase?.type ?? "advance",
        payload: {
          name: logBase?.name ?? item?.name ?? "unknown",
          itemId: item?.id ?? null,
          xpCost: plan.xpCost,
          itemType: item?.type ?? null,
        },
      });
      ui.notifications?.info?.(`Spent ${plan.xpCost} XP.`);
    }
  }

  #isFavoredForItem(item) {
    const governingRaw = String(item?.system?.governingCha ?? item?.system?.baseCha ?? "");
    const raw = governingRaw.toLowerCase();
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
      if (rx.test(raw) && this.#actor.system?.characteristics?.[key]?.favored) return true;
    }
    return false;
  }

  async #handleTalentDrop(item) {
    const mode = getTalentLearningMode();
    const validation = validateTalentLearning(this.#actor, item.toObject(), { source: "chargen-spendxp" });

    if (mode === TALENT_LEARNING_MODE.WARN) notifyTalentLearningResult(validation);
    if (mode === TALENT_LEARNING_MODE.ENFORCE && !validation.ok) {
      notifyTalentLearningResult(validation, { force: true });
      await appendChargenAudit(this.#actor, {
        step: "spendxp",
        action: "dropTalentRejected",
        payload: { name: item.name, reason: validation.reason ?? "blocked-enforce" },
      });
      return;
    }
    if (mode !== TALENT_LEARNING_MODE.ENFORCE && !validation.rulesOk) {
      notifyTalentLearningResult(validation, { force: true });
      await appendChargenAudit(this.#actor, {
        step: "spendxp",
        action: "dropTalentRejected",
        payload: { name: item.name, reason: validation.reason ?? "rules-not-ok" },
      });
      return;
    }

    const created = await requestCreateEmbeddedDocuments(this.#actor, "Item", [item.toObject()]);
    const createdTalent = created?.[0];
    if (!createdTalent) return;

    if (mode !== TALENT_LEARNING_MODE.ENFORCE) {
      const spend = await applyTalentLearningXpCost(this.#actor, {
        ...validation,
        mode: TALENT_LEARNING_MODE.ENFORCE,
        ok: true,
        rulesOk: true,
      });
      if (!spend?.ok) {
        await requestDeleteEmbeddedDocuments(this.#actor, "Item", [createdTalent.id]);
        ui.notifications?.warn?.(spend?.reason ?? "Talent XP deduction failed.");
        await appendChargenAudit(this.#actor, {
          step: "spendxp",
          action: "dropTalentRollback",
          payload: { name: createdTalent.name, reason: spend?.reason ?? "xp-deduction-failed" },
        });
        return;
      }
      if (spend.spentXp > 0) {
        await this.#appendSpendLog({
          type: "talent",
          name: createdTalent.name,
          costXp: spend.spentXp,
          costWealth: 0,
          details: { mode: "manual" },
        });
      }
    } else if (_asNumber(validation.xpCost, 0) > 0) {
      await this.#appendSpendLog({
        type: "talent",
        name: createdTalent.name,
        costXp: _asNumber(validation.xpCost, 0),
        costWealth: 0,
        details: { mode: "enforce-hook" },
      });
    }

    await appendChargenAudit(this.#actor, {
      step: "spendxp",
      action: "dropTalentApplied",
      payload: { name: createdTalent.name, mode },
    });
    ui.notifications?.info?.(`Learned talent: ${createdTalent.name}`);
  }

  async #handleSpellDrop(item) {
    const costs = computeSpellLearningCosts(item, this.#actor);
    const spellType = normalizeSpellLearningType(item);
    const xpValidation = validateSpellLearningPurchase(this.#actor, item, "xp");
    const drakesValidation = validateSpellLearningPurchase(this.#actor, item, "drakes");
    const xpLabel = spellType === "ritual"
      ? "Learn Ritual (25 XP)"
      : `${spellType === "unconventional" ? "Unconventional" : "Conventional"} (XP ${costs.xpCost})`;

    if (!xpValidation.ok && !drakesValidation.ok) {
      const blocked = await applySpellLearningPurchase(this.#actor, item, { paymentMode: "xp" });
      const reason = blocked?.reason || xpValidation.reason || drakesValidation.reason || "Spell learning blocked.";
      await appendChargenAudit(this.#actor, {
        step: "spendxp",
        action: "dropSpellBlocked",
        payload: {
          name: item.name,
          reason,
          school: item.system?.school ?? "",
          level: item.system?.level ?? 1,
        },
      });
      ui.notifications?.warn?.(reason);
      return;
    }

    const answer = await customDialog({
      title: `Learn Spell: ${item.name}`,
      content: `<div style="display:flex; flex-direction:column; gap:8px;">
        <p style="margin:0;">Type: <b>${spellType}</b> | Level <b>${costs.level}</b>.</p>
        <p style="margin:0;">Choose how to pay for learning this spell.</p>
      </div>`,
      buttons: {
        ...(xpValidation.ok ? { xp: { label: xpLabel } } : {}),
        ...(drakesValidation.ok ? { drakes: { label: `Learn (${costs.drakesCost} Drakes)` } } : {}),
        cancel: { label: "Cancel" },
      },
      default: xpValidation.ok ? "xp" : "drakes",
    });

    if (!answer || answer === "cancel") return;
    const paymentMode = answer === "drakes" ? "drakes" : "xp";
    const result = await applySpellLearningPurchase(this.#actor, item, { paymentMode });
    if (!result.ok) {
      await appendChargenAudit(this.#actor, {
        step: "spendxp",
        action: "dropSpellBlocked",
        payload: {
          name: item.name,
          paymentMode,
          reason: result.reason ?? "blocked",
          school: item.system?.school ?? "",
          level: item.system?.level ?? 1,
        },
      });
      ui.notifications?.warn?.(result.reason ?? "Spell learning blocked.");
      return;
    }

    await this.#appendSpendLog({
      type: "spell",
      name: result.createdSpell?.name ?? item.name,
      costXp: result.costs?.xp ?? 0,
      costWealth: result.costs?.drakes ?? 0,
      details: { payment: paymentMode, level: costs.level, type: spellType },
    });
    await appendChargenAudit(this.#actor, {
      step: "spendxp",
      action: "dropSpellApplied",
      payload: {
        name: result.createdSpell?.name ?? item.name,
        payment: paymentMode,
        costXp: result.costs?.xp ?? 0,
        costWealth: result.costs?.drakes ?? 0,
        level: costs.level,
        type: spellType,
      },
    });

    ui.notifications?.info?.(`Learned spell: ${result.createdSpell?.name ?? item.name}`);
  }

  async #appendSpendLog(entry) {
    const flagData = this.#actor.getFlag("uesrpg-3ev4", "chargen") ?? {};
    const spendLog = Array.isArray(flagData.spendLog) ? [...flagData.spendLog] : [];
    spendLog.push({
      type: entry.type,
      name: entry.name,
      costXp: _asNumber(entry.costXp, 0),
      costWealth: _asNumber(entry.costWealth, 0),
      timestamp: new Date().toISOString(),
      details: entry.details ?? {},
    });
    await requestUpdateDocument(this.#actor, {
      "flags.uesrpg-3ev4.chargen.spendLog": spendLog,
    });
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
