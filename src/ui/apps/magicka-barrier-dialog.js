/**
 * src/ui/apps/magicka-barrier-dialog.js
 *
 * Dialog for managing Magicka and Barrier Buffers for actors.
 * Barrier buffers absorb incoming damage of matching types before Temp HP and HP.
 * Opened by clicking the Magicka label button on the actor sheet.
 */

import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { templatePath } from "../constants.js";
import { customDialog, renderDialogContent } from "../../utils/dialog-v2-helper.js";
import { clampNumber, toFiniteNumber } from "./resource-dialog-utils.js";

const BUFFER_TYPE_LABELS = {
  physical: "Physical",
  magical: "Magical",
  elemental: "Elemental",
};

async function _buildDialogContent(actor) {
  const currentMP = toFiniteNumber(actor?.system?.magicka?.value, 0);
  const maxMP = toFiniteNumber(actor?.system?.magicka?.max, 0);
  const physBuf = toFiniteNumber(actor?.system?.buffers?.physical, 0);
  const magBuf = toFiniteNumber(actor?.system?.buffers?.magical, 0);
  const elemBuf = toFiniteNumber(actor?.system?.buffers?.elemental, 0);

  const barriersByType = {
    physical: [],
    magical: [],
    elemental: [],
  };
  const barrierEffects = [];
  for (const ef of (actor?.effects ?? [])) {
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

  return renderDialogContent(templatePath("v2/dialogs/magicka-barrier-dialog.hbs"), {
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
  });
}

function _buildPatchFromRoot(actor, root) {
  const maxMP = toFiniteNumber(actor?.system?.magicka?.max, 0);
  const currentMP = toFiniteNumber(actor?.system?.magicka?.value, 0);
  const currentPhys = toFiniteNumber(actor?.system?.buffers?.physical, 0);
  const currentMag = toFiniteNumber(actor?.system?.buffers?.magical, 0);
  const currentElem = toFiniteNumber(actor?.system?.buffers?.elemental, 0);

  const magickaInput = root?.querySelector?.('input[name="magicka"]');
  const physInput = root?.querySelector?.('input[name="bufferPhysical"]');
  const magInput = root?.querySelector?.('input[name="bufferMagical"]');
  const elemInput = root?.querySelector?.('input[name="bufferElemental"]');

  const newMP = clampNumber(magickaInput?.value, 0, maxMP);
  const newPhys = clampNumber(physInput?.value, 0);
  const newMag = clampNumber(magInput?.value, 0);
  const newElem = clampNumber(elemInput?.value, 0);

  const updateData = {};
  if (newMP !== currentMP) updateData["system.magicka.value"] = newMP;
  if (newPhys !== currentPhys) updateData["system.buffers.physical"] = newPhys;
  if (newMag !== currentMag) updateData["system.buffers.magical"] = newMag;
  if (newElem !== currentElem) updateData["system.buffers.elemental"] = newElem;
  return updateData;
}

export class MagickaBarrierDialog {
  static async show(actor) {
    if (!actor?.system) {
      ui.notifications.error("Invalid actor for barrier management");
      return false;
    }

    const content = await _buildDialogContent(actor);
    const result = await customDialog({
      title: `Magicka & Barriers - ${actor?.name ?? "Actor"}`,
      content,
      classes: ["uesrpg-resource-dialog", "uesrpg-resource-dialog--magicka"],
      width: 540,
      buttons: {
        apply: {
          label: "Apply",
          icon: "fas fa-check",
          callback: async (html) => {
            const patch = _buildPatchFromRoot(actor, html);
            if (Object.keys(patch).length) {
              await requestUpdateDocument(actor, patch);
              ui.notifications.info(`Magicka & barriers updated for ${actor.name}`);
            }
            return true;
          },
        },
        clearAll: {
          label: "Clear Buffers",
          icon: "fas fa-eraser",
          callback: async (html) => {
            const maxMP = toFiniteNumber(actor?.system?.magicka?.max, 0);
            const currentMP = toFiniteNumber(actor?.system?.magicka?.value, 0);
            const magickaInput = html?.querySelector?.('input[name="magicka"]');
            const newMP = clampNumber(magickaInput?.value, 0, maxMP);

            const updateData = {
              "system.buffers.physical": 0,
              "system.buffers.magical": 0,
              "system.buffers.elemental": 0,
            };
            if (newMP !== currentMP) updateData["system.magicka.value"] = newMP;

            await requestUpdateDocument(actor, updateData);
            ui.notifications.info(`All barriers cleared for ${actor.name}`);
            return true;
          },
        },
        cancel: {
          label: "Cancel",
          icon: "fas fa-times",
          callback: () => false,
        },
      },
      defaultButton: "apply",
    });

    return Boolean(result);
  }
}
