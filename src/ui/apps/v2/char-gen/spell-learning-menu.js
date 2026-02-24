import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { resolveDroppedItem } from "../../../../utils/drop-data.js";
import {
  applySpellLearningPurchase,
  computeSpellLearningCosts,
  normalizeSpellLearningType,
  validateSpellLearningPurchase,
} from "../../../../core/advancement/spell-learning.js";
import { appendChargenAudit } from "./audit-log.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value) {
  return String(value ?? "").trim();
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

  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
    this.#onClose = typeof options.onClose === "function" ? options.onClose : null;
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-spell-learning-menu-v2",
    classes: ["worldbuilding", "uesrpg", "uesrpg-spell-learning-app"],
    position: { width: 980, height: 760 },
    window: {
      title: "Spell Learning (Chargen)",
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
    },
  };

  static PARTS = {
    main: {
      template: "systems/uesrpg-3ev4/templates/v2/apps/spell-learning-menu.hbs",
      scrollable: [".uesrpg-spelllearn__scroll"],
    },
  };

  static async prompt(actor, options = {}) {
    const app = new SpellLearningMenuAppV2(actor, options);
    await app.render(true);
    return app;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const log = this.#actor?.getFlag?.("uesrpg-3ev4", "chargen")?.spellLearning?.log ?? [];
    const recentLog = Array.isArray(log)
      ? [...log].slice(-12).reverse().map((row) => ({
        outcome: asString(row?.outcome),
        spellName: asString(row?.spell?.name || "Unknown Spell"),
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
      actorName: this.#actor?.name ?? "Unknown",
      xp: asNumber(this.#actor?.system?.xp, 0),
      wealth: asNumber(this.#actor?.system?.wealth, 0),
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
      ui.notifications?.warn?.("Only spell items can be dropped here.");
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
    const xpValidation = validateSpellLearningPurchase(this.#actor, spell, "xp");
    const drakesValidation = validateSpellLearningPurchase(this.#actor, spell, "drakes");
    const xpOk = xpValidation.ok;
    const drakesOk = drakesValidation.ok;

    if (!xpOk && !drakesOk) {
      return { ok: false, reason: xpValidation.reason || drakesValidation.reason || "Spell learning blocked." };
    }
    if (xpOk && !drakesOk) return { ok: true, paymentMode: "xp" };
    if (!xpOk && drakesOk) return { ok: true, paymentMode: "drakes" };

    const choice = await customDialog({
      title: "Choose Spell Payment",
      content: `<div style="display:flex; flex-direction:column; gap:6px;">
        <p style="margin:0;"><b>${spell.name}</b></p>
        <p style="margin:0;">Type: ${costs.type} | Level ${costs.level}</p>
        <p style="margin:0;">XP Cost: ${costs.xpCost}</p>
        <p style="margin:0;">Drakes Cost: ${costs.drakesCost}</p>
      </div>`,
      buttons: {
        xp: { label: `Learn (XP ${costs.xpCost})` },
        drakes: { label: `Learn (Drakes ${costs.drakesCost})` },
        cancel: { label: "Cancel" },
      },
      default: "xp",
    });
    if (!choice || choice === "cancel") return { ok: false, reason: "Cancelled." };
    return { ok: true, paymentMode: choice === "drakes" ? "drakes" : "xp" };
  }

  async #handleDroppedSpell(spell, zone) {
    if (zone !== "standard" && zone !== "ritual") {
      ui.notifications?.warn?.("Drop spells into one of the spell learning zones.");
      return;
    }
    const type = normalizeSpellLearningType(spell);
    if (zone === "ritual" && type !== "ritual") {
      ui.notifications?.warn?.("Drop ritual spells in the Ritual zone.");
      await appendChargenAudit(this.#actor, {
        step: "spells",
        action: "blocked",
        payload: { spell: spell.name, type, reason: "wrong-zone-ritual-only" },
      });
      return;
    }
    if (zone === "standard" && type === "ritual") {
      ui.notifications?.warn?.("Drop ritual spells in the Ritual zone.");
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

    const result = await applySpellLearningPurchase(this.#actor, spell, { paymentMode: picked.paymentMode });
    if (!result.ok) {
      ui.notifications?.warn?.(result.reason || "Spell learning blocked.");
      await appendChargenAudit(this.#actor, {
        step: "spells",
        action: "blocked",
        payload: {
          spell: spell.name,
          school: spell.system?.school ?? "",
          level: spell.system?.level ?? 1,
          paymentMode: picked.paymentMode,
          reason: result.reason ?? "blocked",
        },
      });
      return;
    }

    ui.notifications?.info?.(`Learned spell: ${result.createdSpell?.name ?? spell.name}.`);
    await appendChargenAudit(this.#actor, {
      step: "spells",
      action: "purchase",
      payload: {
        spell: result.createdSpell?.name ?? spell.name,
        school: spell.system?.school ?? "",
        level: spell.system?.level ?? 1,
        type: normalizeSpellLearningType(spell),
        paymentMode: result.paymentMode,
        costXp: result.costs?.xp ?? 0,
        costWealth: result.costs?.drakes ?? 0,
      },
    });
  }
}
