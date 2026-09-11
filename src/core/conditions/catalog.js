import { CONDITION_DESCRIPTIONS } from "../../data/conditions/conditions-data.js";
import { buildEffectChange } from "../../utils/compat.js";
import { normalizeConditionKey } from "./engine/selectors.js";
import { getConditionDescription } from "./engine/condition-i18n.js";

export function getLocalizedConditionDescription(key, fallback = null) {
  const normalized = normalizeConditionKey(key);
  if (!normalized) return String(fallback ?? "");
  return getConditionDescription(normalized, CONDITION_DESCRIPTIONS.get(normalized) ?? fallback);
}

function condition(key, name, img, changes = []) {
  return { name, img, description: getLocalizedConditionDescription(key), changes };
}

export const STATIC_CONDITIONS = Object.freeze({
  blinded: condition("blinded", "Blinded", "icons/svg/blind.svg", [
    buildEffectChange({ key: "system.modifiers.skills.observe", type: "add", value: -30, priority: 20 }),
  ]),
  deafened: condition("deafened", "Deafened", "icons/svg/deaf.svg", [
    buildEffectChange({ key: "system.modifiers.skills.observe", type: "add", value: -30, priority: 20 }),
  ]),
  crippled: condition("crippled", "Crippled", "icons/svg/bones.svg"),
  helpless: condition("helpless", "Helpless", "icons/svg/ice-aura.svg"),
  silenced: condition("silenced", "Silenced", "icons/svg/sound-off.svg"),
  stunned: condition("stunned", "Stunned", "icons/svg/stoned.svg"),
  entangled: condition("entangled", "Entangled", "icons/svg/net.svg", [
    buildEffectChange({ key: "system.modifiers.combat.attackTN", type: "add", value: -20, priority: 20 }),
    buildEffectChange({ key: "system.modifiers.combat.defenseTN.total", type: "add", value: -20, priority: 20 }),
  ]),
  dazed: condition("dazed", "Dazed", "icons/svg/daze.svg", [
    buildEffectChange({ key: "system.action_points.max", type: "add", value: -1, priority: 20 }),
  ]),
  hidden: condition("hidden", "Hidden", "icons/svg/cowled.svg"),
  invisible: condition("invisible", "Invisible", "icons/svg/invisible.svg"),
  frenzied: condition("frenzied", "Frenzied", "icons/svg/terror.svg"),
  prone: condition("prone", "Prone", "icons/svg/falling.svg", [
    buildEffectChange({ key: "system.modifiers.combat.attackTN", type: "add", value: -20, priority: 20 }),
    buildEffectChange({ key: "system.modifiers.combat.defenseTN.total", type: "add", value: -20, priority: 20 }),
  ]),
  unconscious: condition("unconscious", "Unconscious", "icons/svg/unconscious.svg"),
  paralyzed: condition("paralyzed", "Paralyzed", "icons/svg/paralysis.svg"),
  restrained: condition("restrained", "Restrained", "icons/svg/anchor.svg"),
  grappled: condition("grappled", "Grappled", "icons/svg/grab.svg"),
  feinted: condition("feinted", "Feinted", "icons/svg/combat.svg"),
  slowed: condition("slowed", "Slowed", "icons/svg/wingfoot.svg"),
  immobilized: condition("immobilized", "Immobilized", "icons/svg/statue.svg"),
  mounted: condition("mounted", "Mounted", "icons/svg/pawprint.svg"),
  flanked: condition("flanked", "Flanked (X)", "icons/svg/target.svg"),
  inclose: condition("inclose", "In Close", "icons/svg/combat.svg"),
});

export const TOKEN_HUD_CONDITION_ORDER = Object.freeze([
  "bleeding",
  "blinded",
  "burning",
  "dazed",
  "deafened",
  "crippled",
  "entangled",
  "flanked",
  "frenzied",
  "helpless",
  "hidden",
  "immobilized",
  "inclose",
  "invisible",
  "mounted",
  "paralyzed",
  "prone",
  "restrained",
  "silenced",
  "slowed",
  "stunned",
  "surprised",
  "unconscious",
]);

export const SYSTEM_TOKEN_HUD_STATUS_ID_SET = new Set(TOKEN_HUD_CONDITION_ORDER);

export const CONDITION_KEYS = Object.freeze(Array.from(new Set([
  ...TOKEN_HUD_CONDITION_ORDER.map(normalizeConditionKey).filter(Boolean),
  ...Object.keys(STATIC_CONDITIONS).map(normalizeConditionKey).filter(Boolean),
])));

export const TOKEN_HUD_XVALUE_STATUS_ID_SET = new Set(["bleeding", "burning", "flanked"]);
