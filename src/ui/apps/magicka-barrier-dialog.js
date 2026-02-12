/**
 * src/ui/apps/magicka-barrier-dialog.js
 *
 * Dialog for managing Magicka and Barrier Buffers for actors.
 * Barrier buffers absorb incoming damage of matching types before Temp HP and HP.
 * Opened by clicking the Magicka label button on the actor sheet.
 */

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

    // Collect active barrier spell effects for informational display
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

    // Build barrier effects info HTML
    let barriersInfo = "";
    if (barrierEffects.length) {
      const rows = barrierEffects.map(b => {
        const typeLabel = { physical: "Physical", magical: "Magical", elemental: "Elemental" }[b.type] ?? b.type;
        const upkeepTag = b.hasUpkeep ? ' <span class="hint">(upkeep)</span>' : "";
        const typeIcon = { physical: "🛡", magical: "✨", elemental: "🔥" }[b.type] ?? "•";
        return `<li>${typeIcon} <strong>${b.name}</strong> — ${typeLabel} ${b.originalValue}${upkeepTag}</li>`;
      }).join("");
      barriersInfo = `
        <div class="form-group" style="margin-bottom:8px;">
          <label style="font-weight:bold; margin-bottom:4px;">Active Barrier Sources</label>
          <ul style="margin:0; padding-left:18px; font-size:0.9em; opacity:0.85;">${rows}</ul>
        </div>
      `;
    }

    // Build source indicators for each buffer type input
    const buildSourceIndicator = (type) => {
      const sources = barriersByType[type];
      if (!sources || sources.length === 0) return "";
      const count = sources.length;
      const names = sources.map(s => s.name).join(", ");
      return `<span class="buffer-source-indicator" title="${count} source(s): ${names}" style="margin-left:4px; font-size:0.8em; opacity:0.7; cursor:help;">(${count})</span>`;
    };

    const content = `
      <form class="uesrpg-magicka-barrier-dialog">
        <div class="form-group">
          <label>Magicka</label>
          <input type="number" name="magicka" value="${currentMP}" min="0" max="${maxMP}" />
          <span class="hint">Max: ${maxMP}</span>
        </div>
        <hr style="margin:6px 0;" />
        <p style="font-size:0.85em; opacity:0.8; margin:2px 0 6px;">
          Barrier buffers absorb damage before Temp HP and HP. Physical blocks physical/silver/sunlight,
          Magical blocks magic damage, Elemental blocks fire/frost/shock/poison.
        </p>
        ${barriersInfo}
        <div class="form-group">
          <label>Physical Buffer ${buildSourceIndicator("physical")}</label>
          <input type="number" name="bufferPhysical" value="${physBuf}" min="0" />
          <span class="hint">🛡 Physical / Silver / Sunlight</span>
        </div>
        <div class="form-group">
          <label>Magical Buffer ${buildSourceIndicator("magical")}</label>
          <input type="number" name="bufferMagical" value="${magBuf}" min="0" />
          <span class="hint">✨ Magic damage</span>
        </div>
        <div class="form-group">
          <label>Elemental Buffer ${buildSourceIndicator("elemental")}</label>
          <input type="number" name="bufferElemental" value="${elemBuf}" min="0" />
          <span class="hint">🔥 Fire / Frost / Shock / Poison</span>
        </div>
      </form>
    `;

    return new Promise((resolve) => {
      const buttons = {
        apply: {
          icon: '<i class="fas fa-check"></i>',
          label: "Apply",
          callback: async (html) => {
            const newMP = Number(html.find('[name="magicka"]').val());
            const newPhys = Math.max(0, Number(html.find('[name="bufferPhysical"]').val()));
            const newMag = Math.max(0, Number(html.find('[name="bufferMagical"]').val()));
            const newElem = Math.max(0, Number(html.find('[name="bufferElemental"]').val()));

            const updateData = {};
            if (newMP !== currentMP) updateData["system.magicka.value"] = Math.max(0, Math.min(maxMP, newMP));
            if (newPhys !== physBuf) updateData["system.buffers.physical"] = newPhys;
            if (newMag !== magBuf) updateData["system.buffers.magical"] = newMag;
            if (newElem !== elemBuf) updateData["system.buffers.elemental"] = newElem;

            if (Object.keys(updateData).length) {
              await actor.update(updateData);
              ui.notifications.info(`Magicka & barriers updated for ${actor.name}`);
            }

            resolve(true);
          }
        },
        clearAll: {
          icon: '<i class="fas fa-eraser"></i>',
          label: "Clear Buffers",
          callback: async (html) => {
            // Apply magicka change if any, and zero all buffers
            const newMP = Number(html.find('[name="magicka"]').val());
            const updateData = {
              "system.buffers.physical": 0,
              "system.buffers.magical": 0,
              "system.buffers.elemental": 0,
            };
            if (newMP !== currentMP) updateData["system.magicka.value"] = Math.max(0, Math.min(maxMP, newMP));

            await actor.update(updateData);
            ui.notifications.info(`All barriers cleared for ${actor.name}`);
            resolve(true);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel",
          callback: () => resolve(false)
        }
      };

      new Dialog({
        title: `Magicka & Barriers — ${actor.name}`,
        content,
        buttons,
        default: "apply"
      }).render(true);
    });
  }
}
