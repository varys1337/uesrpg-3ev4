/**
 * src/ui/apps/hp-temp-hp-dialog.js
 * 
 * Dialog for managing HP and Temporary HP for actors.
 * Temporary HP acts as a damage buffer and does not stack.
 */

import { customDialog } from "../../utils/dialog-v2-helper.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";

export class HPTempHPDialog {
  /**
   * Show the HP/Temp HP management dialog for an actor.
   * 
   * @param {Actor} actor - The actor to manage HP for
   * @returns {Promise<boolean>} - True if changes were applied, false if cancelled
   */
  static async show(actor) {
    if (!actor?.system) {
      ui.notifications.error("Invalid actor for HP management");
      return false;
    }

    const currentHP = Number(actor.system?.hp?.value ?? 0);
    const maxHP = Number(actor.system?.hp?.max ?? 0);
    const currentTempHP = Number(actor.system?.tempHP ?? 0);
    const isWounded = Boolean(actor.system?.wounded);
    
    const content = `
      <div class="uesrpg-resource-dialog__body uesrpg-hp-dialog">
        <div class="uesrpg-resource-dialog__group form-group">
          <label class="uesrpg-resource-dialog__label">Current HP</label>
          <input type="number" name="hp" value="${currentHP}" min="0" max="${maxHP}" />
          <span class="uesrpg-resource-dialog__hint hint">Max: ${maxHP}</span>
        </div>
        <div class="uesrpg-resource-dialog__group form-group">
          <label class="uesrpg-resource-dialog__label">Temporary HP</label>
          <input type="number" name="tempHP" value="${currentTempHP}" min="0" />
          <span class="uesrpg-resource-dialog__hint hint">Extra HP buffer, does not stack</span>
        </div>
      </div>
    `;
    
    const buttons = {
      firstAid: {
        icon: '<i class="fas fa-medkit"></i>',
        label: "First Aid",
        callback: async (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const newHP = Number(root?.querySelector('[name="hp"]')?.value);
          const newTempHP = Number(root?.querySelector('[name="tempHP"]')?.value);
          
          if (newHP !== currentHP || newTempHP !== currentTempHP) {
            await requestUpdateDocument(actor, {
              "system.hp.value": Math.max(0, Math.min(maxHP, newHP)),
              "system.tempHP": Math.max(0, newTempHP)
            });
          }
          
          if (game.uesrpg?.wounds?.firstAid) {
            await game.uesrpg.wounds.firstAid(actor);
            ui.notifications.info(`First Aid applied to ${actor.name}`);
          } else {
            ui.notifications.error("First Aid system not available");
          }
          
          return true;
        }
      },
      apply: {
        icon: '<i class="fas fa-check"></i>',
        label: "Apply",
        callback: async (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const newHP = Number(root?.querySelector('[name="hp"]')?.value);
          const newTempHP = Number(root?.querySelector('[name="tempHP"]')?.value);
          
          await requestUpdateDocument(actor, {
            "system.hp.value": Math.max(0, Math.min(maxHP, newHP)),
            "system.tempHP": Math.max(0, newTempHP)
          });
          
          ui.notifications.info(`HP updated for ${actor.name}`);
          return true;
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel",
        callback: () => false
      }
    };
    
    // Remove firstAid button if actor is not wounded
    if (!isWounded) {
      delete buttons.firstAid;
    }
    
    return customDialog({
      title: `Manage HP - ${actor.name}`,
      content,
      buttons,
      defaultButton: "apply",
      classes: ["uesrpg-resource-dialog", "uesrpg-resource-dialog--hp"],
      width: 540,
    });
  }
}
