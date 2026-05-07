export const NPC_THREAT_TEMPLATE_STANDARD_KEY = "";
export const NPC_THREAT_TEMPLATE_OPTIONS = Object.freeze({
  petty: "UESRPG.NPC.ThreatTemplates.petty",
  lesser: "UESRPG.NPC.ThreatTemplates.lesser",
  minor: "UESRPG.NPC.ThreatTemplates.minor",
  [NPC_THREAT_TEMPLATE_STANDARD_KEY]: "UESRPG.NPC.ThreatTemplates.standard",
  major: "UESRPG.NPC.ThreatTemplates.major",
  greater: "UESRPG.NPC.ThreatTemplates.greater",
  legendary: "UESRPG.NPC.ThreatTemplates.legendary",
});

function freezeTemplate(template) {
  return Object.freeze(template);
}

export const NPC_THREAT_TEMPLATES = Object.freeze({
  petty: freezeTemplate({
    key: "petty",
    label: "Petty",
    skillMod: -30,
    healthMod: -9,
    magickaMod: -15,
    speedMod: -3,
    damageMod: -2,
    staminaMod: -2,
    degreeMod: -2,
  }),
  lesser: freezeTemplate({
    key: "lesser",
    label: "Lesser",
    skillMod: -20,
    healthMod: -6,
    magickaMod: -10,
    speedMod: -2,
    damageMod: -1,
    staminaMod: -1,
    degreeMod: -1,
  }),
  minor: freezeTemplate({
    key: "minor",
    label: "Minor",
    skillMod: -10,
    healthMod: -3,
    magickaMod: -5,
    speedMod: -1,
    damageMod: 0,
    staminaMod: 0,
    degreeMod: 0,
  }),
  [NPC_THREAT_TEMPLATE_STANDARD_KEY]: freezeTemplate({
    key: NPC_THREAT_TEMPLATE_STANDARD_KEY,
    label: "Standard",
    skillMod: 0,
    healthMod: 0,
    magickaMod: 0,
    speedMod: 0,
    damageMod: 0,
    staminaMod: 0,
    degreeMod: 0,
  }),
  major: freezeTemplate({
    key: "major",
    label: "Major",
    skillMod: 10,
    healthMod: 3,
    magickaMod: 5,
    speedMod: 1,
    damageMod: 0,
    staminaMod: 0,
    degreeMod: 0,
  }),
  greater: freezeTemplate({
    key: "greater",
    label: "Greater",
    skillMod: 20,
    healthMod: 6,
    magickaMod: 10,
    speedMod: 2,
    damageMod: 1,
    staminaMod: 1,
    degreeMod: 1,
  }),
  legendary: freezeTemplate({
    key: "legendary",
    label: "Legendary",
    skillMod: 30,
    healthMod: 9,
    magickaMod: 15,
    speedMod: 3,
    damageMod: 2,
    staminaMod: 2,
    degreeMod: 2,
  }),
});

export const NPC_THREAT_LEGACY_KEY_MAP = Object.freeze({
  minorSolo: "minor",
  minorGroup: "minor",
  majorSolo: "major",
  majorGroup: "major",
  deadlySolo: "greater",
  deadlyGroup: "greater",
  legendarySolo: "legendary",
  legendaryGroup: "legendary",
});

function isActorLike(value) {
  return !!value
    && typeof value === "object"
    && !!value.system
    && (
      typeof value.type === "string"
      || value.documentName === "Actor"
      || value.constructor?.documentName === "Actor"
    );
}

function isNpcActorLike(value) {
  return String(value?.type ?? "").trim().toLowerCase() === "npc";
}

export function normalizeNpcThreatKey(raw) {
  const key = String(raw ?? "").trim();
  if (!key) return NPC_THREAT_TEMPLATE_STANDARD_KEY;

  const lower = key.toLowerCase();
  if (lower === "standard" || lower === "default" || lower === "none") {
    return NPC_THREAT_TEMPLATE_STANDARD_KEY;
  }

  const legacyMapped = NPC_THREAT_LEGACY_KEY_MAP[key];
  if (legacyMapped) return legacyMapped;

  return Object.prototype.hasOwnProperty.call(NPC_THREAT_TEMPLATES, key)
    ? key
    : NPC_THREAT_TEMPLATE_STANDARD_KEY;
}

export function getNpcThreatTemplateKey(actorOrSystem) {
  if (isActorLike(actorOrSystem)) {
    if (!isNpcActorLike(actorOrSystem)) return NPC_THREAT_TEMPLATE_STANDARD_KEY;
    return normalizeNpcThreatKey(actorOrSystem.system?.threat);
  }

  return normalizeNpcThreatKey(actorOrSystem?.threat);
}

export function getNpcThreatTemplate(actorOrSystem) {
  const key = getNpcThreatTemplateKey(actorOrSystem);
  return NPC_THREAT_TEMPLATES[key] ?? NPC_THREAT_TEMPLATES[NPC_THREAT_TEMPLATE_STANDARD_KEY];
}

export function getNpcThreatDamageModifier(actorOrSystem) {
  return Number(getNpcThreatTemplate(actorOrSystem)?.damageMod ?? 0) || 0;
}

export function getNpcThreatDegreeModifier(actorOrSystem) {
  return Number(getNpcThreatTemplate(actorOrSystem)?.degreeMod ?? 0) || 0;
}
