import { formatResultOutcomeLabel } from "../../../../utils/degree-roll-helper.js";

export async function postEnchantmentResultCard(actor, targetItem, flagsPayload, buildResult, gemPreserved, enchantType) {
  try {
    const audit = buildResult?.gemAudit ?? {};
    const typeLabel = { cast: "Cast", strike: "Strike", constant: "Constant" }[enchantType] ?? enchantType;
    let effectSummary = "";

    if (enchantType === "cast") {
      const spells = buildResult?.spellResults ?? [];
      effectSummary = spells.map((spell) => {
        const outcome = spell.testResult?.success
          ? `${formatResultOutcomeLabel({ isSuccess: spell.testResult?.success, isCriticalSuccess: spell.testResult?.isCritSuccess, isCriticalFailure: spell.testResult?.isCritFailure })} (${spell.testResult?.degrees} DoS, Binding Str. ${spell.bindingStrength})`
          : `${formatResultOutcomeLabel({ isSuccess: spell.testResult?.success, isCriticalSuccess: spell.testResult?.isCritSuccess, isCriticalFailure: spell.testResult?.isCritFailure })} (${spell.testResult?.degrees} DoF)`;
        const procNote = spell.hasProcedural && spell.testResult?.success ? ` [Procedural: may choose rank ${spell.effectiveEnchantRank}]` : "";
        return `${spell.label} (SL ${spell.level}) - TN ${spell.testResult?.tn}, Roll ${spell.testResult?.roll}: ${outcome}${procNote}`;
      }).join("<br>");
    } else if (enchantType === "strike") {
      const effects = flagsPayload?.strike?.effects ?? [];
      const testR = buildResult?.testResult;
      const outcome = `${formatResultOutcomeLabel({ isSuccess: testR?.success, isCriticalSuccess: testR?.isCritSuccess, isCriticalFailure: testR?.isCritFailure })} (${testR?.degrees ?? "?"} ${testR?.success ? "DoS" : "DoF"}${testR?.success ? `, BS ${testR.bindingStrength ?? "-"}` : ""})`;
      effectSummary = effects.map((effect) => `${effect.key} SL ${effect.sl}`).join(", ") + `<br>TN ${testR?.tn}, Roll ${testR?.roll}: ${outcome}`;
    } else if (enchantType === "constant") {
      const effects = flagsPayload?.constant?.effects ?? [];
      const testR = buildResult?.testResult;
      const outcome = `${formatResultOutcomeLabel({ isSuccess: testR?.success, isCriticalSuccess: testR?.isCritSuccess, isCriticalFailure: testR?.isCritFailure })} (${testR?.degrees ?? "?"} ${testR?.success ? "DoS" : "DoF"})`;
      effectSummary = effects.map((effect) => `${effect.effectKey} SL ${effect.sl}`).join(", ") + `<br>TN ${testR?.tn}, Roll ${testR?.roll}: ${outcome}`;
    }

    const pool = flagsPayload?.cast?.pool ?? flagsPayload?.strike?.pool ?? null;
    const poolInfo = pool ? `<p><strong>Pool:</strong> ${pool.value} / ${pool.max} Soul Energy</p>` : "";
    const salvageNote = gemPreserved ? `<p><em>Salvage Energy: soul gem preserved!</em></p>` : "";

    await ChatMessage.create({
      content: `<div class="uesrpg">
        <h3>Enchanting Workshop - ${typeLabel} Enchantment</h3>
        <p><strong>Crafter:</strong> ${actor?.name ?? "Unknown"}</p>
        <p><strong>Item:</strong> ${targetItem?.name ?? "Unknown"}</p>
        <hr>
        <p><strong>Soul Gem:</strong> ${audit.gemName ?? "Unknown"} (${audit.soulType ?? "?"} - ${audit.soulSize ?? "?"} - ${audit.soulEnergyInGem ?? 0} energy)</p>
        <p><strong>Item EL:</strong> ${audit.itemEL ?? "?"} | <strong>Pool Cap:</strong> ${audit.poolMax ?? "?"} | <strong>Energy Lost:</strong> ${audit.energyLost ?? 0}</p>
        <hr>
        <p>${effectSummary}</p>
        ${poolInfo}
        ${salvageNote}
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    });
  } catch (err) {
    console.warn("UESRPG | [Enchanting] Failed to post chat card", err);
  }
}
