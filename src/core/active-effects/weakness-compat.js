import { getEffectChangeTypeValue } from "../../utils/compat.js";
import { getFlagValueWithFallback } from "../system/flags.js";

/** Recognize only the original system-generated weakness resistance change. */
export function isLegacyWeaknessResistanceChange(effect, change) {
  const identity = String(getFlagValueWithFallback(effect, "spellEffectIdentity") ?? "");
  if (!identity.startsWith("weaknesstotype::") || getEffectChangeTypeValue(change) !== "add") return false;
  const key = /^system\.modifiers\.resistance\.(fire|frost|shock|poison)R$/.test(String(change?.key ?? ""));
  const value = /^-\s*\{\{\s*effect\.flags\.uesrpg-3ev4\.spellStrengthValue\s*\}\}$/.test(String(change?.value ?? "").trim());
  return key && value;
}
