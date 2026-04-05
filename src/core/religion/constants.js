import { FLAG_SCOPE } from "../constants.js";
import { SYSTEM_ID } from "../system/namespace.js";

export const RELIGION_DOMAIN_KEYS = Object.freeze([
  "covenant",
  "duty",
  "hearth",
  "grace",
  "nature",
  "exchange",
  "knowledge",
  "victory",
  "cycle",
  "fate",
  "twilight",
  "ruin",
]);

export const RELIGION_INVOCATION_DOMAIN_UNIVERSAL = "universal";

export const RELIGION_ITEM_KIND = Object.freeze({
  ritualDomain: "ritualDomain",
});

export const INVOCATION_CIRCLE_KEYS = Object.freeze(["1", "2", "3", "4"]);

export const RELIGION_FLAG_SCOPE = FLAG_SCOPE;
export const RELIGION_FLAG_KEY = "religion";
export const CONSECRATION_FLAG_KEY = "consecration";

export const RELIGION_FLAG_PATH = `flags.${FLAG_SCOPE}.${RELIGION_FLAG_KEY}`;
export const CONSECRATION_FLAG_PATH = `flags.${FLAG_SCOPE}.${CONSECRATION_FLAG_KEY}`;

export const RELIGION_PACK_NAMES = Object.freeze({
  invocations: "religion-invocations",
  domainSpells: "religion-domain-spells",
});

export const RELIGION_PACK_IDS = Object.freeze({
  invocations: `${SYSTEM_ID}.${RELIGION_PACK_NAMES.invocations}`,
  domainSpells: `${SYSTEM_ID}.${RELIGION_PACK_NAMES.domainSpells}`,
  baseSpells: `${SYSTEM_ID}.spells-revised`,
});

export const RELIGION_CONTENT_JSON_PATHS = Object.freeze({
  invocations: `systems/${SYSTEM_ID}/src/data/religion/invocations.json`,
  domainSpells: `systems/${SYSTEM_ID}/src/data/religion/domain-spells.json`,
});
