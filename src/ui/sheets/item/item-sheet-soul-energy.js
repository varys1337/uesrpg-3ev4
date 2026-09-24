import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../../constants.js";
import {
  SOUL_GEM_CONSUMPTION_MODES,
  SOUL_GEM_TIERS,
  resolveSoulGemData,
} from "../../../core/enchanting/soul-gems.js";
import { t } from "../../../utils/i18n.js";

async function _updateSoulEnergyDocument(sheet, updateData) {
  const ok = await requestUpdateDocument(sheet.document, updateData);
  if (!ok) ui.notifications?.warn?.(t("UESRPG.Notifications.Enchanting.SoulEnergyUpdateFailed"));
  return ok;
}

/** Convert a generic Item or Equipment document into an explicitly configured soul resource. */
export async function onEnableSoulEnergyItem(sheet, event) {
  event.preventDefault();
  const resolved = resolveSoulGemData(sheet.document);
  const tierKey = resolved?.tierKey && SOUL_GEM_TIERS[resolved.tierKey] ? resolved.tierKey : "petty";
  const tier = SOUL_GEM_TIERS[tierKey];
  const maxSoulEnergy = Math.max(0, Math.trunc(Number(resolved?.maxSoulEnergy ?? tier.maxEnergy) || 0));
  const soulEnergy = Math.min(maxSoulEnergy, Math.max(0, Math.trunc(Number(resolved?.soulEnergy ?? 0) || 0)));

  await _updateSoulEnergyDocument(sheet, {
    [`flags.${SYSTEM_ID}.isSoulGem`]: true,
    [`flags.${SYSTEM_ID}.soulTier`]: tierKey,
    [`flags.${SYSTEM_ID}.soulSize`]: resolved?.soulSize ?? tier.label,
    [`flags.${SYSTEM_ID}.soulType`]: resolved?.soulType ?? tier.soulType,
    [`flags.${SYSTEM_ID}.soulEnergy`]: soulEnergy,
    [`flags.${SYSTEM_ID}.maxSoulEnergy`]: maxSoulEnergy,
    [`flags.${SYSTEM_ID}.soulGemConsumptionMode`]: resolved?.consumptionMode ?? SOUL_GEM_CONSUMPTION_MODES.DISPOSABLE,
  });
}

/** Remove only the soul-resource designation flags, leaving all other system flags intact. */
export async function onClearSoulEnergyItem(sheet, event) {
  event.preventDefault();
  await _updateSoulEnergyDocument(sheet, {
    [`flags.${SYSTEM_ID}.-=isSoulGem`]: null,
    [`flags.${SYSTEM_ID}.-=soulTier`]: null,
    [`flags.${SYSTEM_ID}.-=soulSize`]: null,
    [`flags.${SYSTEM_ID}.-=soulType`]: null,
    [`flags.${SYSTEM_ID}.-=soulEnergy`]: null,
    [`flags.${SYSTEM_ID}.-=maxSoulEnergy`]: null,
    [`flags.${SYSTEM_ID}.-=soulGemConsumptionMode`]: null,
  });
}

/** Keep tier-derived soul fields coherent before the AppV2 form is submitted. */
export function registerSoulEnergyListeners(sheet, root) {
  const panel = root?.querySelector?.(".uesrpg-soul-energy-panel");
  if (!panel || !sheet?.isEditable) return;
  if (panel.dataset.uesrpgSoulEnergyBound === "true") return;

  const tierInput = panel.querySelector("[name='flags.uesrpg-3ev4.soulTier']");
  const sizeInput = panel.querySelector("[name='flags.uesrpg-3ev4.soulSize']");
  const typeInput = panel.querySelector("[name='flags.uesrpg-3ev4.soulType']");
  const currentInput = panel.querySelector("[name='flags.uesrpg-3ev4.soulEnergy']");
  const maximumInput = panel.querySelector("[name='flags.uesrpg-3ev4.maxSoulEnergy']");
  if (!tierInput || !currentInput || !maximumInput) return;

  const sync = () => {
    const tier = SOUL_GEM_TIERS[String(tierInput.value ?? "").trim().toLowerCase()] ?? null;
    const isCustom = !tier;
    if (tier) {
      if (sizeInput) sizeInput.value = tier.label;
      if (typeInput) typeInput.value = tier.soulType;
      maximumInput.value = String(tier.maxEnergy);
    }
    if (sizeInput) sizeInput.readOnly = !isCustom;
    if (typeInput) {
      typeInput.disabled = !isCustom;
      typeInput.setAttribute("aria-disabled", String(!isCustom));
    }
    maximumInput.readOnly = !isCustom;
    const maximum = Math.max(0, Math.trunc(Number(maximumInput.value) || 0));
    const current = Math.max(0, Math.trunc(Number(currentInput.value) || 0));
    if (current > maximum) currentInput.value = String(maximum);
    currentInput.max = String(maximum);
    currentInput.setCustomValidity("");
  };

  panel.dataset.uesrpgSoulEnergyBound = "true";
  panel.addEventListener("change", async (event) => {
    const target = event.target;
    if (!target?.matches?.("input[name], select[name]")) return;
    sync();
    await sheet._submitCurrentForm(event);
  });
  sync();
}
