/**
 * src/ui/apps/hp-temp-hp-dialog.js
 *
 * Dialog for managing HP and Temporary HP for actors.
 * Temporary HP acts as a damage buffer and does not stack.
 */

import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { templatePath } from "../constants.js";
import { clampNumber, toFiniteNumber } from "./resource-dialog-utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class HPTempHPDialogAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  #resolver = null;
  #resolved = false;
  #isSubmitting = false;

  constructor(actor, options = {}) {
    const id = `uesrpg-hp-temp-hp-dialog-${actor?.id ?? "unknown"}`;
    super({ ...options, id });
    this.#actor = actor;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["uesrpg-resource-dialog", "uesrpg-resource-dialog--hp"],
    position: { width: 540 },
    window: { title: "Manage HP" },
    form: {
      handler: HPTempHPDialogAppV2.prototype._onSubmitForm,
      closeOnSubmit: true,
      submitOnChange: false,
    },
    actions: {
      firstAid: HPTempHPDialogAppV2.prototype._onFirstAid,
      cancel: HPTempHPDialogAppV2.prototype._onCancel,
    },
  };

  static PARTS = {
    // AppV2 requires each PART template to render exactly one root element.
    main: {
      template: templatePath("v2/dialogs/hp-temp-hp-dialog.hbs"),
    },
  };

  static async show(actor) {
    if (!actor?.system) {
      ui.notifications.error("Invalid actor for HP management");
      return false;
    }

    const app = new HPTempHPDialogAppV2(actor);
    return new Promise((resolve) => {
      app.#resolver = resolve;
      app.render(true);
    });
  }

  get title() {
    return `Manage HP - ${this.#actor?.name ?? "Actor"}`;
  }

  async _prepareContext(options) {
    const currentHP = toFiniteNumber(this.#actor.system?.hp?.value, 0);
    const maxHP = toFiniteNumber(this.#actor.system?.hp?.max, 0);
    const currentTempHP = toFiniteNumber(this.#actor.system?.tempHP, 0);
    const woundState = game?.uesrpg?.wounds?.getWoundState?.(this.#actor)
      ?? (this.#actor.system?.wounded ? "active" : "none");
    const isWounded = woundState !== "none";

    return {
      currentHP,
      maxHP,
      currentTempHP,
      isWounded,
    };
  }

  async _onSubmitForm(event, form, formData) {
    if (this.#isSubmitting) return;
    this.#isSubmitting = true;

    try {
      const maxHP = toFiniteNumber(this.#actor.system?.hp?.max, 0);

      const newHP = clampNumber(formData.object?.hp, 0, maxHP);
      const newTempHP = clampNumber(formData.object?.tempHP, 0);

      await requestUpdateDocument(this.#actor, {
        "system.hp.value": newHP,
        "system.tempHP": newTempHP,
      });

      ui.notifications.info(`HP updated for ${this.#actor.name}`);
      this.#resolve(true);
    } finally {
      this.#isSubmitting = false;
    }
  }

  async _onFirstAid(event, target) {
    event?.preventDefault?.();
    if (this.#isSubmitting) return;
    this.#isSubmitting = true;

    try {
      await this.#persistCurrentFormValues();

      if (game.uesrpg?.wounds?.firstAid) {
        await game.uesrpg.wounds.firstAid(this.#actor);
        ui.notifications.info(`First Aid applied to ${this.#actor.name}`);
      } else {
        ui.notifications.error("First Aid system not available");
      }

      this.#resolve(true);
      await this.close();
    } finally {
      this.#isSubmitting = false;
    }
  }

  _onCancel(event, target) {
    event?.preventDefault?.();
    if (this.#isSubmitting) return;
    this.#resolve(false);
    this.close();
  }

  async #persistCurrentFormValues() {
    const formEl = this.element;
    if (!formEl?.isConnected) return;
    const fd = new foundry.applications.ux.FormDataExtended(formEl);

    const maxHP = toFiniteNumber(this.#actor.system?.hp?.max, 0);
    const newHP = clampNumber(fd.object?.hp, 0, maxHP);
    const newTempHP = clampNumber(fd.object?.tempHP, 0);

    const currentHP = toFiniteNumber(this.#actor.system?.hp?.value, 0);
    const currentTempHP = toFiniteNumber(this.#actor.system?.tempHP, 0);
    if (newHP === currentHP && newTempHP === currentTempHP) return;

    await requestUpdateDocument(this.#actor, {
      "system.hp.value": newHP,
      "system.tempHP": newTempHP,
    });
  }

  async close(options = {}) {
    if (!this.#resolved) this.#resolve(false);
    return super.close(options);
  }

  #resolve(value) {
    if (this.#resolved) return;
    this.#resolved = true;
    this.#resolver?.(value);
  }
}

export class HPTempHPDialog {
  static async show(actor) {
    return HPTempHPDialogAppV2.show(actor);
  }
}
