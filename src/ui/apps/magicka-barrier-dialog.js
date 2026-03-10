/**
 * src/ui/apps/magicka-barrier-dialog.js
 *
 * Dialog for managing Magicka and Barrier Buffers for actors.
 * Barrier buffers absorb incoming damage of matching types before Temp HP and HP.
 * Opened by clicking the Magicka label button on the actor sheet.
 */

import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { templatePath } from "../constants.js";
import { clampNumber, toFiniteNumber } from "./resource-dialog-utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const BUFFER_TYPE_LABELS = {
  physical: "Physical",
  magical: "Magical",
  elemental: "Elemental",
};

class MagickaBarrierDialogAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  #resolver = null;
  #resolved = false;
  #isSubmitting = false;

  constructor(actor, options = {}) {
    const id = `uesrpg-magicka-barrier-dialog-${actor?.id ?? "unknown"}`;
    super({ ...options, id });
    this.#actor = actor;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["uesrpg-resource-dialog", "uesrpg-resource-dialog--magicka"],
    position: { width: 540 },
    window: { title: "Magicka & Barriers" },
    form: {
      handler: MagickaBarrierDialogAppV2.prototype._onSubmitForm,
      closeOnSubmit: true,
      submitOnChange: false,
    },
    actions: {
      clearAll: MagickaBarrierDialogAppV2.prototype._onClearAll,
      cancel: MagickaBarrierDialogAppV2.prototype._onCancel,
    },
  };

  static PARTS = {
    // AppV2 requires each PART template to render exactly one root element.
    main: {
      template: templatePath("v2/dialogs/magicka-barrier-dialog.hbs"),
    },
  };

  static async show(actor) {
    if (!actor?.system) {
      ui.notifications.error("Invalid actor for barrier management");
      return false;
    }

    const app = new MagickaBarrierDialogAppV2(actor);
    return new Promise((resolve) => {
      app.#resolver = resolve;
      app.render(true);
    });
  }

  get title() {
    return `Magicka & Barriers - ${this.#actor?.name ?? "Actor"}`;
  }

  async _prepareContext(options) {
    const currentMP = toFiniteNumber(this.#actor.system?.magicka?.value, 0);
    const maxMP = toFiniteNumber(this.#actor.system?.magicka?.max, 0);
    const physBuf = toFiniteNumber(this.#actor.system?.buffers?.physical, 0);
    const magBuf = toFiniteNumber(this.#actor.system?.buffers?.magical, 0);
    const elemBuf = toFiniteNumber(this.#actor.system?.buffers?.elemental, 0);

    const barriersByType = {
      physical: [],
      magical: [],
      elemental: [],
    };
    const barrierEffects = [];
    for (const ef of (this.#actor.effects ?? [])) {
      const flags = ef.flags?.["uesrpg-3ev4"];
      if (!flags?.bufferApplied) continue;
      const data = {
        id: ef.id,
        name: flags.spellName || ef.name || "Unknown",
        type: String(flags.bufferType || "?"),
        typeLabel: BUFFER_TYPE_LABELS[flags.bufferType] ?? String(flags.bufferType || "?"),
        originalValue: toFiniteNumber(flags.bufferOriginalValue, 0),
        hasUpkeep: Boolean(flags.hasUpkeep),
      };
      barrierEffects.push(data);
      if (barriersByType[data.type]) barriersByType[data.type].push(data);
    }

    return {
      currentMP,
      maxMP,
      physBuf,
      magBuf,
      elemBuf,
      barrierEffects,
      hasBarrierEffects: barrierEffects.length > 0,
      physicalSourceCount: barriersByType.physical.length,
      magicalSourceCount: barriersByType.magical.length,
      elementalSourceCount: barriersByType.elemental.length,
      physicalSourceTitle: barriersByType.physical.map((s) => s.name).join(", "),
      magicalSourceTitle: barriersByType.magical.map((s) => s.name).join(", "),
      elementalSourceTitle: barriersByType.elemental.map((s) => s.name).join(", "),
    };
  }

  async _onSubmitForm(event, form, formData) {
    if (this.#isSubmitting) return;
    this.#isSubmitting = true;

    try {
      const patch = this.#buildPatchFromFormObject(formData.object);
      if (Object.keys(patch).length) {
        await requestUpdateDocument(this.#actor, patch);
        ui.notifications.info(`Magicka & barriers updated for ${this.#actor.name}`);
      }
      this.#resolve(true);
    } finally {
      this.#isSubmitting = false;
    }
  }

  async _onClearAll(event, target) {
    event?.preventDefault?.();
    if (this.#isSubmitting) return;
    this.#isSubmitting = true;

    try {
      const formEl = this.element;
      const fd = formEl?.isConnected ? new foundry.applications.ux.FormDataExtended(formEl) : { object: {} };
      const maxMP = toFiniteNumber(this.#actor.system?.magicka?.max, 0);
      const currentMP = toFiniteNumber(this.#actor.system?.magicka?.value, 0);
      const newMP = clampNumber(fd.object?.magicka, 0, maxMP);

      const updateData = {
        "system.buffers.physical": 0,
        "system.buffers.magical": 0,
        "system.buffers.elemental": 0,
      };
      if (newMP !== currentMP) updateData["system.magicka.value"] = newMP;

      await requestUpdateDocument(this.#actor, updateData);
      ui.notifications.info(`All barriers cleared for ${this.#actor.name}`);
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

  #buildPatchFromFormObject(objectData = {}) {
    const maxMP = toFiniteNumber(this.#actor.system?.magicka?.max, 0);
    const currentMP = toFiniteNumber(this.#actor.system?.magicka?.value, 0);
    const currentPhys = toFiniteNumber(this.#actor.system?.buffers?.physical, 0);
    const currentMag = toFiniteNumber(this.#actor.system?.buffers?.magical, 0);
    const currentElem = toFiniteNumber(this.#actor.system?.buffers?.elemental, 0);

    const newMP = clampNumber(objectData?.magicka, 0, maxMP);
    const newPhys = clampNumber(objectData?.bufferPhysical, 0);
    const newMag = clampNumber(objectData?.bufferMagical, 0);
    const newElem = clampNumber(objectData?.bufferElemental, 0);

    const updateData = {};
    if (newMP !== currentMP) updateData["system.magicka.value"] = newMP;
    if (newPhys !== currentPhys) updateData["system.buffers.physical"] = newPhys;
    if (newMag !== currentMag) updateData["system.buffers.magical"] = newMag;
    if (newElem !== currentElem) updateData["system.buffers.elemental"] = newElem;
    return updateData;
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

export class MagickaBarrierDialog {
  static async show(actor) {
    return MagickaBarrierDialogAppV2.show(actor);
  }
}
