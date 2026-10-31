import { getEffectChanges } from "../../utils/compat.js";
import { collectApplicableEffects } from "./collect.js";
import { getSystemAEFlags } from "./metadata.js";

const ARMOR_KEYS = ["system.modifiers.combat.armorRating", "system.modifiers.combat.magicArmorRating"];
const CORE_MAGIC_ARMOR_IDENTITY = "magicarmor::system.modifiers.combat.magicArmorRating";
const CORE_TYPED_ARMOR_IDENTITIES = new Set(["fire", "frost", "shock", "poison"]
  .map(type => `typearmor::system.modifiers.combat.magicArmorRating.${type}`));

function armorLanes(changes) {
  return new Set((changes ?? []).flatMap(change => ARMOR_KEYS.filter(base =>
    String(change?.key ?? "") === base || String(change?.key ?? "").startsWith(`${base}.`))));
}

/** Find an overlapping known spell/potion armor effect; ordinary worn armor is not an AE spell. */
export function findPotionArmorConflict(actor, changes, { incomingPotionKey = null } = {}) {
  const lanes = armorLanes(changes);
  if (!actor || !lanes.size) return null;
  return collectApplicableEffects(actor).find(effect => {
    const flags = getSystemAEFlags(effect);
    if (!flags.spellEffect) return false;
    if (incomingPotionKey) {
      if (flags.alchemyPotion && flags.potionEffectKey === incomingPotionKey) return false;
    } else if (!flags.alchemyPotion || !["armor", "magicArmor"].includes(flags.potionEffectKey)) return false;
    return [...armorLanes(getEffectChanges(effect))].some(lane => lanes.has(lane));
  }) ?? null;
}

/** Find the known Core magic/typed spell overlap without identifying spells by name. */
export function findCoreMagicArmorSpellConflict(actor, incomingIdentity) {
  const isMagicArmor = incomingIdentity === CORE_MAGIC_ARMOR_IDENTITY;
  const isTypedArmor = CORE_TYPED_ARMOR_IDENTITIES.has(incomingIdentity);
  if (!actor || (!isMagicArmor && !isTypedArmor)) return null;
  return collectApplicableEffects(actor).find(effect => {
    const flags = getSystemAEFlags(effect);
    if (!flags.spellEffect || flags.alchemyPotion || flags.isOriginAE) return false;
    const existingIdentity = flags.spellEffectIdentity;
    return isMagicArmor ? CORE_TYPED_ARMOR_IDENTITIES.has(existingIdentity)
      : existingIdentity === CORE_MAGIC_ARMOR_IDENTITY;
  }) ?? null;
}
