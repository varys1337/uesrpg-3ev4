export const NAMESPACE = "uesrpg-3ev4";
export const FLAG_HOOKS = "_engagementFlankingHooks";
export const DEFAULT_UNARMED_REACH = Object.freeze({ min: 0, max: 1 });
export const DISP_HOSTILE = Number(CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1);
export const DISP_NEUTRAL = Number(CONST?.TOKEN_DISPOSITIONS?.NEUTRAL ?? 0);
export const DISP_FRIENDLY = Number(CONST?.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1);
export const DISP_SECRET = Number(CONST?.TOKEN_DISPOSITIONS?.SECRET ?? -2);
export const COMBAT_STYLE_RANK_TO_ENGAGEMENT = Object.freeze({
  untrained: 1,
  novice: 1,
  apprentice: 1,
  journeyman: 2,
  adept: 2,
  expert: 3,
  master: 4,
});
export const SIZE_NUMERIC = Object.freeze({
  puny: 1,
  tiny: 2,
  small: 3,
  standard: 4,
  large: 5,
  huge: 6,
  enormous: 7,
});
