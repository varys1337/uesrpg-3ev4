import { LANGUAGE_CHOICES, FACTION_CHOICES } from "../../sheets/shared/data/social-choices.js";
import {
  buildKnownLanguagesStringFromEntries,
  formatLanguageSlotSummary,
  getSocialStateFromSystem,
  normalizeFactionEntries,
  normalizeLanguageEntries,
  toSlug,
} from "../../../core/social/social-data.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { SYSTEM_ID, templatePath } from "../../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LanguageSelectorAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  #resolver = null;
  #resolved = false;
  #isSaving = false;
  #entries = [];

  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
    this.#entries = getSocialStateFromSystem(actor.system).languages.entries;
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-language-selector",
    classes: ["worldbuilding", "uesrpg", "uesrpg-social-selector"],
    position: { width: 760, height: 640 },
    window: { title: "Language Selection", resizable: true },
    actions: {
      addLanguage: LanguageSelectorAppV2.prototype._onAddLanguage,
      addCustomLanguage: LanguageSelectorAppV2.prototype._onAddCustomLanguage,
      removeLanguage: LanguageSelectorAppV2.prototype._onRemoveLanguage,
      save: LanguageSelectorAppV2.prototype._onSave,
      cancel: LanguageSelectorAppV2.prototype._onCancel,
    },
  };

  static PARTS = {
    main: {
      template: templatePath("v2/apps/language-selector.hbs"),
      scrollable: [".social-choice-list", ".social-selected-list"],
    },
  };

  static async prompt(actor) {
    const app = new LanguageSelectorAppV2(actor);
    return new Promise((resolve) => {
      app.#resolver = resolve;
      app.render(true);
    });
  }

  async _prepareContext(options) {
    const state = getSocialStateFromSystem(this.#actor.system);
    const selected = new Set(this.#entries.map((entry) => entry.name.toLowerCase()));

    return {
      maxSlots: state.languages.max,
      slotSummary: formatLanguageSlotSummary(state.languages.max),
      choices: LANGUAGE_CHOICES
        .filter((name) => name.toLowerCase() !== "cyrodilic")
        .map((name) => ({
          name,
          disabled: selected.has(name.toLowerCase()),
        })),
      entries: this.#entries,
    };
  }

  _readEntriesFromDom() {
    const root = this.element;
    const rows = [...root.querySelectorAll(".social-language-row")];
    const entries = rows.map((row, idx) => {
      const id = String(row.dataset.entryId ?? "").trim() || `lang-${idx + 1}`;
      return {
        id,
        name: String(row.querySelector("[data-field='name']")?.value ?? "").trim(),
        speak: Boolean(row.querySelector("[data-field='speak']")?.checked),
        readWrite: Boolean(row.querySelector("[data-field='readWrite']")?.checked),
      };
    });
    this.#entries = normalizeLanguageEntries(entries);
  }

  _onAddLanguage(event, target) {
    event?.preventDefault?.();
    this._readEntriesFromDom();

    const name = String(target?.dataset?.languageName ?? "").trim();
    if (!name) return;
    if (this.#entries.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) return;

    this.#entries.push({
      id: `lang-${toSlug(name)}`,
      name,
      speak: true,
      readWrite: true,
      source: "catalog",
    });
    this.#entries = normalizeLanguageEntries(this.#entries);
    this.render(false);
  }

  _onAddCustomLanguage(event, target) {
    event?.preventDefault?.();
    this._readEntriesFromDom();

    const customInput = this.element?.querySelector("#social-language-custom");
    const name = String(customInput?.value ?? "").trim();
    if (!name) return;
    if (this.#entries.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) return;

    this.#entries.push({
      id: `lang-${toSlug(name)}`,
      name,
      speak: true,
      readWrite: true,
      source: "custom",
    });
    this.#entries = normalizeLanguageEntries(this.#entries);
    if (customInput) customInput.value = "";
    this.render(false);
  }

  _onRemoveLanguage(event, target) {
    event?.preventDefault?.();
    this._readEntriesFromDom();
    const entryId = String(target?.dataset?.entryId ?? "").trim();
    if (!entryId) return;
    this.#entries = this.#entries.filter((entry) => entry.id !== entryId);
    this.render(false);
  }

  async _onSave(event, target) {
    event?.preventDefault?.();
    if (this.#isSaving) return;

    const saveButton = this.element?.querySelector("[data-action='save']");
    this.#isSaving = true;
    if (saveButton) saveButton.disabled = true;

    try {
      this._readEntriesFromDom();
      const entries = normalizeLanguageEntries(this.#entries);
      const knownString = buildKnownLanguagesStringFromEntries(entries);

      await requestUpdateDocument(this.#actor, {
        "system.social.languages.entries": entries,
        "system.linguistics.known": knownString,
      });

      this.#resolveAndClose(true);
    } catch (err) {
      console.error("uesrpg-3ev4 | Failed to save language selection", err);
      ui.notifications?.error("Failed to save language selection.");
      this.#isSaving = false;
      if (saveButton) saveButton.disabled = false;
    }
  }

  _onCancel(event, target) {
    event?.preventDefault?.();
    if (this.#isSaving) return;
    this.#resolveAndClose(false);
  }

  async close(options = {}) {
    if (!this.#resolved && this.#resolver) {
      this.#resolved = true;
      this.#resolver(false);
    }
    return super.close(options);
  }

  #resolveAndClose(result) {
    if (!this.#resolved && this.#resolver) {
      this.#resolved = true;
      this.#resolver(result);
    }
    this.close();
  }
}

export class FactionSelectorAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  #resolver = null;
  #resolved = false;
  #isSaving = false;
  #search = "";
  #entries = [];

  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
    this.#entries = getSocialStateFromSystem(actor.system).factions;
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-faction-selector",
    classes: ["worldbuilding", "uesrpg", "uesrpg-social-selector"],
    position: { width: 860, height: 660 },
    window: { title: "Faction Selection", resizable: true },
    actions: {
      addFaction: FactionSelectorAppV2.prototype._onAddFaction,
      removeFaction: FactionSelectorAppV2.prototype._onRemoveFaction,
      addCustomFaction: FactionSelectorAppV2.prototype._onAddCustomFaction,
      save: FactionSelectorAppV2.prototype._onSave,
      cancel: FactionSelectorAppV2.prototype._onCancel,
    },
  };

  static PARTS = {
    main: {
      template: templatePath("v2/apps/faction-selector.hbs"),
      scrollable: [".social-choice-list", ".social-selected-list"],
    },
  };

  static async prompt(actor) {
    const app = new FactionSelectorAppV2(actor);
    return new Promise((resolve) => {
      app.#resolver = resolve;
      app.render(true);
    });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const searchInput = this.element?.querySelector("#social-faction-search");
    if (searchInput) {
      searchInput.addEventListener("input", (ev) => {
        this.#search = String(ev.currentTarget?.value ?? "").trim().toLowerCase();
        this.render(false);
      });
    }
  }

  async _prepareContext(options) {
    const selected = new Set(this.#entries.map((f) => f.name.toLowerCase()));
    const choices = FACTION_CHOICES
      .filter((c) => {
        if (!this.#search) return true;
        return c.name.toLowerCase().includes(this.#search);
      })
      .map((c) => ({
        ...c,
        disabled: selected.has(c.name.toLowerCase()),
      }));

    return {
      search: this.#search,
      choices,
      entries: this.#entries,
    };
  }

  _readEntriesFromDom() {
    const root = this.element;
    const rows = [...root.querySelectorAll(".social-faction-row")];
    const entries = rows.map((row, idx) => {
      const id = String(row.dataset.entryId ?? "").trim() || `faction-${idx + 1}`;
      return {
        id,
        name: String(row.querySelector("[data-field='name']")?.value ?? "").trim(),
        rankTitle: String(row.querySelector("[data-field='rankTitle']")?.value ?? "").trim(),
        location: String(row.querySelector("[data-field='location']")?.value ?? "").trim(),
        notes: String(row.querySelector("[data-field='notes']")?.value ?? "").trim(),
      };
    });
    this.#entries = normalizeFactionEntries(entries);
  }

  _onAddFaction(event, target) {
    event?.preventDefault?.();
    this._readEntriesFromDom();
    const id = String(target?.dataset?.factionId ?? "").trim();
    const name = String(target?.dataset?.factionName ?? "").trim();
    if (!name) return;
    if (this.#entries.some((f) => f.name.toLowerCase() === name.toLowerCase())) return;

    this.#entries.push({
      id: id || `faction-${toSlug(name)}`,
      name,
      rankTitle: "",
      location: "",
      notes: "",
    });
    this.#entries = normalizeFactionEntries(this.#entries);
    this.render(false);
  }

  _onAddCustomFaction(event, target) {
    event?.preventDefault?.();
    this._readEntriesFromDom();

    const customInput = this.element?.querySelector("#social-faction-custom");
    const name = String(customInput?.value ?? "").trim();
    if (!name) return;
    if (this.#entries.some((f) => f.name.toLowerCase() === name.toLowerCase())) return;

    this.#entries.push({
      id: `faction-${toSlug(name)}`,
      name,
      rankTitle: "",
      location: "",
      notes: "",
    });
    this.#entries = normalizeFactionEntries(this.#entries);
    if (customInput) customInput.value = "";
    this.render(false);
  }

  _onRemoveFaction(event, target) {
    event?.preventDefault?.();
    this._readEntriesFromDom();
    const entryId = String(target?.dataset?.entryId ?? "").trim();
    if (!entryId) return;
    this.#entries = this.#entries.filter((f) => f.id !== entryId);
    this.render(false);
  }

  async _onSave(event, target) {
    event?.preventDefault?.();
    if (this.#isSaving) return;
    const saveButton = this.element?.querySelector("[data-action='save']");
    this.#isSaving = true;
    if (saveButton) saveButton.disabled = true;
    this._readEntriesFromDom();
    try {
      await requestUpdateDocument(this.#actor, {
        "system.social.factions": normalizeFactionEntries(this.#entries),
      });
      this.#resolveAndClose(true);
    } catch (err) {
      console.error("uesrpg-3ev4 | Failed to save faction selection", err);
      ui.notifications?.error("Failed to save faction selection.");
      this.#isSaving = false;
      if (saveButton) saveButton.disabled = false;
    }
  }

  _onCancel(event, target) {
    event?.preventDefault?.();
    if (this.#isSaving) return;
    this.#resolveAndClose(false);
  }

  async close(options = {}) {
    if (!this.#resolved && this.#resolver) {
      this.#resolved = true;
      this.#resolver(false);
    }
    return super.close(options);
  }

  #resolveAndClose(result) {
    if (!this.#resolved && this.#resolver) {
      this.#resolved = true;
      this.#resolver(result);
    }
    this.close();
  }
}

