import { RELIGION_DOMAIN_KEYS } from "./constants.js";

const DOMAIN_DEFINITIONS = [
  {
    key: "covenant",
    label: "Covenant",
    ritualSkillName: "Ritual [Covenant]",
    governingCharacteristics: ["wp", "end"],
    aspects: ["Rebirth", "Oath", "Authority", "Permanence", "Blessing"],
    favoredSkills: ["Alteration", "Lore", "Logic", "Command", "Persuade"],
    deities: ["Akatosh", "Auri-El", "Alkosh", "Satakal", "The All-Maker", "Ruptga"],
    favoredMagicSchool: "alteration",
  },
  {
    key: "duty",
    label: "Duty",
    ritualSkillName: "Ritual [Duty]",
    governingCharacteristics: ["str", "wp"],
    aspects: ["Justice", "Order", "Protection", "Vigilance", "Charity"],
    favoredSkills: ["Athletics", "Alteration", "Observe", "Command", "Combat Style [Defense]"],
    deities: ["Stendarr", "Stuhn", "S'rendarr", "Meridia", "Jyggalag"],
    favoredMagicSchool: "alteration",
  },
  {
    key: "hearth",
    label: "Hearth",
    ritualSkillName: "Ritual [Hearth]",
    governingCharacteristics: ["end", "prs"],
    aspects: ["Community", "Fertility", "Compassion", "Nurture", "Hospitality"],
    favoredSkills: ["Commerce", "Restoration", "Performance", "Persuade", "Profession [Medicine]"],
    deities: ["Mara", "Morwha", "Fadomai", "Almalexia"],
    favoredMagicSchool: "restoration",
  },
  {
    key: "grace",
    label: "Grace",
    ritualSkillName: "Ritual [Grace]",
    governingCharacteristics: ["prs", "agi"],
    aspects: ["Beauty", "Art", "Creativity", "Courtship", "Refinement"],
    favoredSkills: ["Illusion", "Performance", "Persuade", "Acrobatics", "Enchant"],
    deities: ["Dibella", "Druagaa", "Vivec", "Sanguine", "Sheogorath"],
    favoredMagicSchool: "illusion",
  },
  {
    key: "nature",
    label: "Nature",
    ritualSkillName: "Ritual [Nature]",
    governingCharacteristics: ["prc", "int"],
    aspects: ["Weather", "Wild", "Growth", "Balance", "Hunt"],
    favoredSkills: ["Ride", "Survival", "Navigate", "Conjuration", "Alchemy"],
    deities: ["Kynareth", "Tava", "Y'ffre/Jephre", "Phynaster", "Ius", "Wilderking", "Hircine"],
    favoredMagicSchool: "conjuration",
  },
  {
    key: "exchange",
    label: "Exchange",
    ritualSkillName: "Ritual [Exchange]",
    governingCharacteristics: ["lck", "prs"],
    aspects: ["Labor", "Trade", "Craft", "Contract", "Prosperity"],
    favoredSkills: ["Conjuration", "Investigate", "Commerce", "Profession [Craft]", "Logic"],
    deities: ["Zenithar", "Xen", "Zeht", "Zeqqi", "Sai", "Rajhin", "Clavicus Vile"],
    favoredMagicSchool: "conjuration",
  },
  {
    key: "knowledge",
    label: "Knowledge",
    ritualSkillName: "Ritual [Knowledge]",
    governingCharacteristics: ["int", "prc"],
    aspects: ["Wisdom", "Magic", "Mind", "Pattern", "Insight"],
    favoredSkills: ["Enchant", "Mysticism", "Lore", "Logic", "Investigate"],
    deities: ["Julianos", "Jhunal", "Magnus", "Xarxes", "Syrabane", "Sotha Sil", "Riddle'Thar", "Hermaeus Mora"],
    favoredMagicSchool: "mysticism",
  },
  {
    key: "victory",
    label: "Victory",
    ritualSkillName: "Ritual [Victory]",
    governingCharacteristics: ["str", "agi"],
    aspects: ["War", "Valor", "Challenge", "Might", "Legacy"],
    favoredSkills: ["Evade", "Combat Style [Offense]", "Command", "Destruction", "Ride"],
    deities: ["Trinimac (Malacath)", "Talos", "Onsi", "Morihaus", "ReYsgramorman", "Boethiah"],
    favoredMagicSchool: "destruction",
  },
  {
    key: "cycle",
    label: "Cycle",
    ritualSkillName: "Ritual [Cycle]",
    governingCharacteristics: ["int", "wp"],
    aspects: ["Mortality", "Passage", "Burial", "Ancestry", "Continuity"],
    favoredSkills: ["Restoration", "Navigate", "Lore", "Investigation", "Profession [Burial]"],
    deities: ["Arkay", "Tu'whacca", "Orkey", "Jone", "Jode", "Nerevar"],
    favoredMagicSchool: "restoration",
  },
  {
    key: "fate",
    label: "Fate",
    ritualSkillName: "Ritual [Fate]",
    governingCharacteristics: ["lck", "end"],
    aspects: ["Sacrifice", "Ordeal", "Rebellion", "Prophecy", "Revelation"],
    favoredSkills: ["Acrobatics", "Athletics", "Survival", "Alteration", "Navigate"],
    deities: ["Lorkhan", "Shezarr", "Shor", "Sep", "Lorkhaj", "Ithelia", "Mephala"],
    favoredMagicSchool: "alteration",
  },
  {
    key: "twilight",
    label: "Twilight",
    ritualSkillName: "Ritual [Twilight]",
    governingCharacteristics: ["prc", "agi"],
    aspects: ["Shadow", "Dream", "Omen", "Secrecy", "Night"],
    favoredSkills: ["Mysticism", "Illusion", "Deceive", "Stealth", "Subterfuge"],
    deities: ["Azura", "Nocturnal", "Jone", "Jode", "Vaermina", "Baan Dar", "Rajhin"],
    favoredMagicSchool: "mysticism",
  },
  {
    key: "ruin",
    label: "Ruin",
    ritualSkillName: "Ritual [Ruin]",
    governingCharacteristics: ["str", "lck"],
    aspects: ["Annihilation", "Chaos", "Spite", "Curse", "Subversion"],
    favoredSkills: ["Destruction", "Athletics", "Deceive", "Subterfuge", "Alchemy"],
    deities: ["Mehrunes Dagon", "Sep", "Sithis", "Peryite", "Molag Bal", "Namira"],
    favoredMagicSchool: "destruction",
  },
];

const byKey = Object.freeze(
  DOMAIN_DEFINITIONS.reduce((acc, domain) => {
    acc[domain.key] = Object.freeze({
      ...domain,
      governingCharacteristics: Object.freeze([...domain.governingCharacteristics]),
      aspects: Object.freeze([...domain.aspects]),
      favoredSkills: Object.freeze([...domain.favoredSkills]),
      deities: Object.freeze([...domain.deities]),
    });
    return acc;
  }, {})
);

export const RELIGION_DOMAINS = Object.freeze(RELIGION_DOMAIN_KEYS.map((key) => byKey[key]).filter(Boolean));
export const RELIGION_DOMAIN_REGISTRY = byKey;
export const DOMAIN_FAVORED_MAGIC_SCHOOLS = Object.freeze(
  RELIGION_DOMAINS.reduce((acc, domain) => {
    acc[domain.key] = domain.favoredMagicSchool ?? "";
    return acc;
  }, {})
);

export function getReligionDomain(domainKey) {
  return RELIGION_DOMAIN_REGISTRY[String(domainKey ?? "").trim().toLowerCase()] ?? null;
}

export function getReligionDomains() {
  return RELIGION_DOMAINS;
}

export function getDomainFavoredMagicSchool(domainKey) {
  return DOMAIN_FAVORED_MAGIC_SCHOOLS[String(domainKey ?? "").trim().toLowerCase()] || "";
}

