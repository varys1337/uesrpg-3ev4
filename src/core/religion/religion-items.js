/**
 * Religion item utilities (compatibility alias).
 * 
 * This file exists for backward compatibility with older imports.
 * New code should import directly from ritual-domains.js.
 * 
 * @deprecated Use ritual-domains.js instead
 */

export {
  getReligionItemFlags,
  getRitualDomainKey,
  isRitualDomainItem,
  isInvocationItem,
  isDomainSpellItem,
  getRitualDomainRankNumber,
  getRitualDomainRankLabel,
  getRitualDomainRankFromItem,
  getRitualDomainFromItem,
  getRitualDomainDisplayName,
  getRitualDomainPietyBonus,
  getRitualDomainPietyMax,
  getRitualDomainInvocationSlots,
  getRitualDomainInvocationSlotsUsed,
  getRitualDomainInvocationSlotsRemaining,
  getRitualDomainInvocationSlotCost,
  getRitualDomainInvocationSlotCostForRank,
  getRitualDomainInvocationSlotCostForItem,
  getRitualDomainInvocationSlotCostForSpell,
  getRitualDomainInvocationSlotCostForInvocation,
  getRitualDomainInvocationSlotCostForDomainSpell,
  getRitualDomainInvocationSlotCostForRitualDomain,
  getRitualDomainInvocationSlotCostForRitualDomainRank,
  getRitualDomainInvocationSlotCostForRitualDomainItem,
  getRitualDomainInvocationSlotCostForRitualDomainSpell,
  getRitualDomainInvocationSlotCostForRitualDomainInvocation
} from './ritual-domains.js';