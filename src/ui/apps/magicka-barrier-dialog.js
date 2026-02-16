/**
 * src/ui/apps/magicka-barrier-dialog.js
 *
 * Dialog for managing Magicka and Barrier Buffers for actors.
 * Barrier buffers absorb incoming damage of matching types before Temp HP and HP.
 * Opened by clicking the Magicka label button on the actor sheet.
 */

import { customDialog } from "../../utils/dialog-v2-helper.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";

export class MagickaBarrierDialog {
  /**
   * Show the Magicka / Barrier management dialog for an actor.
   *
   * @param {Actor} actor - The actor to manage
   * @returns {Promise<boolean>} - True if changes were applied, false if cancelled
   */
  static async show(actor) {
    if (!actor?.system) {
      ui.notifications.error("Invalid actor for barrier management");
      return false;
    }

    const currentMP = Number(actor.system?.magicka?.value ?? 0);
    const maxMP = Number(actor.system?.magicka?.max ?? 0);
    const physBuf = Number(actor.system?.buffers?.physical ?? 0);
    const magBuf = Number(actor.system?.buffers?.magical ?? 0);
    const elemBuf = Number(actor.system?.buffers?.elemental ?? 0);

    // Collect active barrier spell effects for informational display.
    const barrierEffects = [];
    const barriersByType = { physical: [], magical: [], elemental: [] };
    for (const ef of (actor.effects ?? [])) {
      const flags = ef.flags?.["uesrpg-3ev4"];
      if (!flags?.bufferApplied) continue;
      const effectData = {
        id: ef.id,
        name: flags.spellName || ef.name || "Unknown",
        type: flags.bufferType || "?",
        originalValue: Number(flags.bufferOriginalValue ?? 0),
        hasUpkeep: Boolean(flags.hasUpkeep),
      };
      barrierEffects.push(effectData);
      if (barriersByType[effectData.type]) {
        barriersByType[effectData.type].push(effectData);
      }
    }

    let barriersInfo = "";
    if (barrierEffects.length) {
      const rows = barrierEffects.map((b) => {
        const typeLabel = { physical: "Physical", magical: "Magical", elemental: "Elemental" }[b.type] ?? b.type;
        const upkeepTag = b.hasUpkeep ? ' <span class="hint">(upkeep)</span>' : "";
        return `<li><strong>${b.name}</strong> - ${typeLabel} ${b.originalValue}${upkeepTag}</li>`;
      }).join("");
      barriersInfo = `
        <div class="uesrpg-resource-dialog__group form-group">
          <label class="uesrpg-resource-dialog__label">Active Barrier Sources</label>
          <ul class="uesrpg-magicka-barrier-dialog__sources">${rows}</ul>
        </div>
      `;
    }

    const buildSourceIndicator = (type) => {
      const sources = barriersByType[type];
      if (!sources?.length) return "";
      const count = sources.length;
      const names = sources.map((s) => s.name).join(", ");
      return `<span class="buffer-source-indicator" title="${count} source(s): ${names}">(${count})</span>`;
    };

    const content = `
      <div class="uesrpg-resource-dialog__body uesrpg-magicka-barrier-dialog">
        <div class="uesrpg-resource-dialog__group form-group">
          <label class="uesrpg-resource-dialog__label">Magicka</label>
          <input type="number" name="magicka" value="${currentMP}" min="0" max="${maxMP}" />
          <span class="uesrpg-resource-dialog__hint hint">Max: ${maxMP}</span>
        </div>
        <p class="uesrpg-resource-dialog__hint uesrpg-resource-dialog__hint--copy">
          Barrier buffers absorb damage before Temp HP and HP. Physical blocks physical/silver/sunlight,
          Magical blocks magic damage, Elemental blocks fire/frost/shock/poison.
        </p>
        ${barriersInfo}
        <div class="uesrpg-resource-dialog__group form-group">
          <label class="uesrpg-resource-dialog__label">Physical Buffer ${buildSourceIndicator("physical")}</label>
          <input type="number" name="bufferPhysical" value="${physBuf}" min="0" />
          <span class="uesrpg-resource-dialog__hint hint">Physical / Silver / Sunlight</span>
        </div>
        <div class="uesrpg-resource-dialog__group form-group">
          <label class="uesrpg-resource-dialog__label">Magical Buffer ${buildSourceIndicator("magical")}</label>
          <input type="number" name="bufferMagical" value="${magBuf}" min="0" />
          <span class="uesrpg-resource-dialog__hint hint">Magic damage</span>
        </div>
        <div class="uesrpg-resource-dialog__group form-group">
          <label class="uesrpg-resource-dialog__label">Elemental Buffer ${buildSourceIndicator("elemental")}</label>
          <input type="number" name="bufferElemental" value="${elemBuf}" min="0" />
          <span class="uesrpg-resource-dialog__hint hint">Fire / Frost / Shock / Poison</span>
        </div>
      </div>
    `;

    return customDialog({
      title: `Magicka & Barriers - ${actor.name}`,
      content,
      classes: ["uesrpg-resource-dialog", "uesrpg-resource-dialog--magicka"],
      buttons: {
        apply: {
          icon: '<i class="fas fa-check"></i>',
          label: "Apply",
          callback: async (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const newMP = Number(root?.querySelector('[name="magicka"]')?.value);
            const newPhys = Math.max(0, Number(root?.querySelector('[name="bufferPhysical"]')?.value));
            const newMag = Math.max(0, Number(root?.querySelector('[name="bufferMagical"]')?.value));
            const newElem = Math.max(0, Number(root?.querySelector('[name="bufferElemental"]')?.value));

            const updateData = {};
            if (newMP !== currentMP) updateData["system.magicka.value"] = Math.max(0, Math.min(maxMP, newMP));
            if (newPhys !== physBuf) updateData["system.buffers.physical"] = newPhys;
            if (newMag !== magBuf) updateData["system.buffers.magical"] = newMag;
            if (newElem !== elemBuf) updateData["system.buffers.elemental"] = newElem;

            if (Object.keys(updateData).length) {
              await requestUpdateDocument(actor, updateData);
              ui.notifications.info(`Magicka & barriers updated for ${actor.name}`);
            }

            return true;
          }
        },
        clearAll: {
          icon: '<i class="fas fa-eraser"></i>',
          label: "Clear Buffers",
          callback: async (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            const newMP = Number(root?.querySelector('[name="magicka"]')?.value);
            const updateData = {
              "system.buffers.physical": 0,
              "system.buffers.magical": 0,
              "system.buffers.elemental": 0,
            };
            if (newMP !== currentMP) updateData["system.magicka.value"] = Math.max(0, Math.min(maxMP, newMP));

            await requestUpdateDocument(actor, updateData);
            ui.notifications.info(`All barriers cleared for ${actor.name}`);
            return true;
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel",
          callback: () => false
        }
      },
      defaultButton: "apply",
      width: 540,
    });
  }
}
