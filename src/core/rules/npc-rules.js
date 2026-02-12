const SYSTEM_ID = "uesrpg-3ev4";

export const NPC_LUCK_FLAG = "npcLuckAllowed";
export const NPC_ELITE_FLAG = "npcEliteAllowed";

export function isNPC(actor) {
  const type = String(actor?.type ?? "").toLowerCase().trim();
  return type === "npc";
}

export function getNpcCriticalBands() {
  return { successMax: 3, failureMin: 98 };
}

export function canUseLuck(actor) {
  if (!actor) return false;
  if (!isNPC(actor)) return true;
  try {
    // Primary rule: NPCs do not have Luck unless explicitly allowed.
    // Supported allow signals:
    // - A trait item with system.activation.flags.npcLuckAllowed === true
    // - Legacy/GM override actor flag flags.uesrpg-3ev4.npcLuckAllowed
    const items = actor.items ? Array.from(actor.items.values?.() ?? actor.items ?? []) : [];
    const allowedByTrait = items.some(i => {
      if (!i) return false;
      if (String(i.type ?? "").toLowerCase() !== "trait") return false;
      return i.system?.activation?.flags?.npcLuckAllowed === true;
    });
    if (allowedByTrait) return true;

    return actor.getFlag?.(SYSTEM_ID, NPC_LUCK_FLAG) === true;
  } catch (_e) {
    return false;
  }
}

export function canUseHeroicActions(actor) {
  if (!actor) return false;
  if (!isNPC(actor)) return true;

  // Primary rule: NPC Heroic Actions require the Elite trait.
  // We support multiple world data patterns:
  // - A trait named "Elite"
  // - A trait that sets activation flag npcEliteAllowed
  // - Legacy/GM override actor flag flags.uesrpg-3ev4.npcEliteAllowed
  try {
    const items = actor.items ? Array.from(actor.items.values?.() ?? actor.items ?? []) : [];
    const hasEliteTrait = items.some(i => {
      if (!i) return false;
      if (String(i.type ?? "").toLowerCase() !== "trait") return false;

      // Prefer canonical traitKey if present.
      const tKey = String(i.system?.traitKey ?? "").trim().toLowerCase();
      if (tKey === "elite") return true;

      const name = String(i.name ?? "").trim().toLowerCase();
      if (name === "elite") return true;

      const flag = i.system?.activation?.flags?.npcEliteAllowed;
      return flag === true;
    });

    if (hasEliteTrait) return true;

    // Non-breaking fallback: support previous flag-based gating.
    return actor.getFlag?.(SYSTEM_ID, NPC_ELITE_FLAG) === true;
  } catch (_e) {
    return false;
  }
}

export function resolveCriticalFlags(actor, rollTotal, { allowLucky = true, allowUnlucky = true } = {}) {
  const total = Number(rollTotal);
  if (!Number.isFinite(total)) return { isCriticalSuccess: false, isCriticalFailure: false };

  const npc = isNPC(actor);

  // RAW (Chapter 1): NPCs default to fixed critical bands unless their statblock specifies otherwise.
  // System convention: a trait/flag can allow an NPC to use Lucky/Unlucky numbers like a PC.
  if (npc && !canUseLuck(actor)) {
    const { successMax, failureMin } = getNpcCriticalBands();
    return {
      isCriticalSuccess: total <= successMax,
      isCriticalFailure: total >= failureMin
    };
  }

  // If Luck is not usable (or not present), no criticals.
  if (!canUseLuck(actor)) return { isCriticalSuccess: false, isCriticalFailure: false };

  let isCriticalSuccess = false;
  let isCriticalFailure = false;


  const lnData = actor?.system?.lucky_numbers ?? {};
  const ulData = actor?.system?.unlucky_numbers ?? {};

  const lnKeys = ["ln1","ln2","ln3","ln4","ln5","ln6","ln7","ln8","ln9","ln10"];
  const ulKeys = ["ul1","ul2","ul3","ul4","ul5","ul6"];

  // Active slot counts are derived in actor prepareData (and may be modified by AE keys).
  // Fallback (defensive): derive from Luck Bonus if the actor is missing derived fields.
  const lb = Number(actor?.system?.characteristics?.lck?.bonus ?? 0);
  const fallbackLucky = Math.clamp(Math.trunc(lb), 0, lnKeys.length);
  const fallbackUnlucky = Math.clamp(Math.trunc(Math.max(0, 5 - lb)), 0, ulKeys.length);

  const luckyMax = Number.isFinite(Number(lnData._activeSlots)) ? Math.clamp(Math.trunc(Number(lnData._activeSlots)), 0, lnKeys.length) : fallbackLucky;
  const unluckyMax = Number.isFinite(Number(ulData._activeSlots)) ? Math.clamp(Math.trunc(Number(ulData._activeSlots)), 0, ulKeys.length) : fallbackUnlucky;

  // Only the first N slots are active for crit matching.
  // Special case: ln6 ("Thief" extra lucky number) remains active if set, even when N < 6.
  const activeLuckyKeys = lnKeys.slice(0, luckyMax);
  if (!activeLuckyKeys.includes("ln6") && Number(lnData.ln6) > 0) activeLuckyKeys.push("ln6");

  const activeUnluckyKeys = ulKeys.slice(0, unluckyMax);

  const luckyNums = activeLuckyKeys
    .map(k => Number(lnData[k]))
    .filter(n => Number.isFinite(n) && n > 0);

  const unluckyNums = activeUnluckyKeys
    .map(k => Number(ulData[k]))
    .filter(n => Number.isFinite(n) && n > 0);

  // Defensive fallback: if an NPC is configured to use Luck but has no lucky/unlucky numbers,
  // fall back to fixed NPC critical bands so they don't become "crit-immune" due to bad data.
  if (npc && luckyNums.length === 0 && unluckyNums.length === 0) {
    const { successMax, failureMin } = getNpcCriticalBands();
    return {
      isCriticalSuccess: total <= successMax,
      isCriticalFailure: total >= failureMin
    };
  }

  if (allowLucky && luckyNums.includes(total)) isCriticalSuccess = true;
  if (allowUnlucky && unluckyNums.includes(total)) isCriticalFailure = true;

  return { isCriticalSuccess, isCriticalFailure };
}
