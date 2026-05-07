import { getNpcThreatTemplate } from "../../../rules/npc-threat-templates.js";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  const n = toNumber(value, min);
  return Math.min(max, Math.max(min, n));
}

function applyNumericMapModifier(target, modifier) {
  if (!target || typeof target !== "object") return;
  const mod = toNumber(modifier, 0);
  if (!mod) return;

  for (const [key, value] of Object.entries(target)) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) continue;
    target[key] = numericValue + mod;
  }
}

function applyResourceMaxModifier(resource, modifier) {
  if (!resource || typeof resource !== "object") return;
  const max = Math.max(0, toNumber(resource.max, 0) + toNumber(modifier, 0));
  resource.max = max;
  resource.value = clamp(resource.value, 0, max);
}

function applySpeedModifier(speed, key, modifier, { onlyWhenPositive = false } = {}) {
  if (!speed || typeof speed !== "object") return;
  const current = toNumber(speed[key], 0);
  if (onlyWhenPositive && current <= 0) return;
  speed[key] = Math.max(0, current + toNumber(modifier, 0));
}

export function applyNpcThreatTemplateStage(stage) {
  const { actorSystemData, options } = stage ?? {};
  if (!options?.isNPC || !actorSystemData || typeof actorSystemData !== "object") return;

  const template = getNpcThreatTemplate(actorSystemData);
  actorSystemData.ui = actorSystemData.ui && typeof actorSystemData.ui === "object" ? actorSystemData.ui : {};
  actorSystemData.ui.threatTemplate = {
    key: template.key,
    label: template.label,
    skillMod: template.skillMod,
    healthMod: template.healthMod,
    magickaMod: template.magickaMod,
    speedMod: template.speedMod,
    damageMod: template.damageMod,
    staminaMod: template.staminaMod,
    degreeMod: template.degreeMod,
  };

  applyNumericMapModifier(actorSystemData.professions, template.skillMod);
  applyNumericMapModifier(actorSystemData.professionsWound, template.skillMod);

  applyResourceMaxModifier(actorSystemData.hp, template.healthMod);
  applyResourceMaxModifier(actorSystemData.magicka, template.magickaMod);
  applyResourceMaxModifier(actorSystemData.stamina, template.staminaMod);

  applySpeedModifier(actorSystemData.speed, "value", template.speedMod);
  applySpeedModifier(actorSystemData.speed, "swimSpeed", template.speedMod);
  applySpeedModifier(actorSystemData.speed, "flySpeed", template.speedMod, { onlyWhenPositive: true });
}
