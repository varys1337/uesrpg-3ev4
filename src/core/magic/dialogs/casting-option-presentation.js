import { resolveSpellProfile } from "../spell-profile.js";
import { buildCombatOptionTooltipText } from "../../../data/tooltips/index.js";
import { t, tf } from "../../../utils/i18n.js";

/** Pure display data shared by the standalone and banked casting dialogs. */
export function buildCastingOptionPresentation(actor, spell, {
  level = null, isRestrained = false, isOverloaded = false,
  useOvercharge = false, useMagickaCycling, hasMasterOfMagicka = false,
  fixedCost = null, resourceLabel = "MP",
} = {}) {
  const options = { level, isRestrained, isOverloaded, useOvercharge };
  if (useMagickaCycling !== undefined) options.useMagickaCycling = useMagickaCycling;
  const profile = resolveSpellProfile(spell, actor, options);
  // An unselected option still explains the saving it would provide. Switching
  // to Restraint clears Overload unless Master of Magicka permits both.
  const restrainedProfile = isRestrained ? profile : resolveSpellProfile(spell, actor, {
    ...options, isRestrained: true, isOverloaded: hasMasterOfMagicka && isOverloaded,
  });
  const refund = fixedCost != null ? 0 : Math.max(0, Number(
    restrainedProfile.cost.effectiveRestraintReduction ?? restrainedProfile.cost.restrained?.reduction ?? 0
  ) || 0);
  const restraintLabel = tf("UESRPG.Dialogs.SpellOptions.RestraintAmount", { value: refund }, `Restraint (${refund} MP)`);
  const saving = tf("UESRPG.Dialogs.SpellOptions.RefundOnSuccessShort", { value: refund }, `Refund ${refund} MP on success`);
  const compatibility = hasMasterOfMagicka && spell?.system?.hasOverload
    ? t("UESRPG.Dialogs.SpellOptions.MasterOfMagickaAllowsBoth", "Master of Magicka allows Restraint and Overload together.")
    : (isOverloaded ? t("UESRPG.Dialogs.SpellOptions.SelectRestraintClearsOverload", "Selecting Restraint clears Overload.") : "");
  const amount = fixedCost ?? profile.cost.attempt;
  const costContext = tf("UESRPG.Dialogs.SpellOptions.AttemptPayment", { value: amount, resource: resourceLabel }, `Payment for this attempt: ${amount} ${resourceLabel}.`);
  const modifiers = [];
  if (fixedCost == null) {
    if (isOverloaded) modifiers.push(tf("UESRPG.Dialogs.SpellOptions.CurrentCostMultiplier", { option: t("UESRPG.Dialogs.SpellOptions.Overload", "Overload"), value: profile.cost.overload?.multiplier ?? 2 }, "Overload: x2 cost."));
    if (profile.cost.overcharge?.enabled) modifiers.push(tf("UESRPG.Dialogs.SpellOptions.CurrentCostMultiplier", { option: t("UESRPG.Dialogs.SpellOptions.Overcharge", "Overcharge"), value: profile.cost.overcharge.multiplier ?? 2 }, "Overcharge: x2 cost."));
    if (isRestrained) modifiers.push(saving);
  }
  return {
    profile, restraintLabel, refund,
    restraintHelp: buildCombatOptionTooltipText("restraint", [saving, compatibility].filter(Boolean).join(". ")),
    overloadHelp: buildCombatOptionTooltipText("overload", [String(spell?.system?.overloadEffect ?? "").trim(),
      !hasMasterOfMagicka && isRestrained ? t("UESRPG.Dialogs.SpellOptions.SelectOverloadClearsRestraint", "Selecting Overload clears Restraint.") : compatibility].filter(Boolean).join(" ")),
    overchargeHelp: buildCombatOptionTooltipText("overcharge"),
    magickaCyclingHelp: buildCombatOptionTooltipText("magickaCycling"),
    costHelp: [costContext, ...modifiers].join(" "),
  };
}
