import { UESRPG } from "../constants.js";
import { CHARACTERISTIC_KEYS, CHARACTERISTIC_LABELS } from "../../utils/maps/characteristics.js";

export { CHARACTERISTIC_KEYS, CHARACTERISTIC_LABELS };

export const MAGIC_SCHOOL_KEYS = UESRPG.SPELL_SCHOOLS;

export const CAMPAIGN_RANK_THRESHOLDS = Object.freeze([
  { key: "novice", label: "Novice", minXp: 0 },
  { key: "apprentice", label: "Apprentice", minXp: 1000 },
  { key: "journeyman", label: "Journeyman", minXp: 2500 },
  { key: "adept", label: "Adept", minXp: 4000 },
  { key: "expert", label: "Expert", minXp: 5500 },
  { key: "master", label: "Master", minXp: 7000 },
]);
