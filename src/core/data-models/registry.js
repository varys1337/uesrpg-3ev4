import { SYSTEM_ID } from "../constants.js";
import { ACTOR_TYPE_MODEL_SEEDS, ITEM_TYPE_MODEL_SEEDS } from "./defaults.generated.js";

export const ACTOR_DOCUMENT_TYPES = [
  "Player Character",
  "NPC",
  "Group",
  "Warfare Unit",
];

export const ITEM_DOCUMENT_TYPES = [
  "equipment",
  "item",
  "container",
  "armor",
  "shield",
  "weapon",
  "spell",
  "trait",
  "power",
  "talent",
  "combatStyle",
  "skill",
  "magicSkill",
  "ammunition",
  "invocation",
  "scroll",
];

const ACTOR_HTML_FIELDS = {
  "Player Character": ["bio", "journal", "notes"],
  "NPC": ["bio", "journal", "notes"],
  "Group": ["description", "notes"],
  "Warfare Unit": ["description", "notes"],
};

const ITEM_HTML_FIELDS = {
  equipment: ["description"],
  item: ["description"],
  container: ["description"],
  armor: ["description"],
  shield: ["description"],
  weapon: ["description"],
  spell: ["description"],
  trait: ["description"],
  power: ["description"],
  talent: ["description"],
  combatStyle: ["description"],
  skill: ["description"],
  magicSkill: ["description"],
  ammunition: ["description"],
  invocation: ["description", "effect"],
  scroll: ["description"],
};

const ACTOR_MODEL_SEEDS = Object.freeze({ ...ACTOR_TYPE_MODEL_SEEDS });
const ITEM_MODEL_SEEDS = Object.freeze({ ...ITEM_TYPE_MODEL_SEEDS });

function cloneValue(value) {
  try {
    return foundry.utils.deepClone(value);
  } catch (_err) {
    return JSON.parse(JSON.stringify(value));
  }
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getFieldsApi() {
  return foundry.data.fields;
}

function createFieldFromDefault(key, value, htmlFieldSet) {
  const fields = getFieldsApi();

  if (value === null) {
    return new fields.AnyField({ initial: () => null });
  }

  if (Array.isArray(value)) {
    return new fields.ArrayField(new fields.AnyField(), {
      initial: () => cloneValue(value),
    });
  }

  if (isPlainObject(value)) {
    return new fields.ObjectField({
      initial: () => cloneValue(value),
    });
  }

  if (typeof value === "boolean") {
    return new fields.BooleanField({ initial: value });
  }

  if (typeof value === "number") {
    return new fields.NumberField({
      initial: value,
      integer: Number.isInteger(value),
    });
  }

  if (htmlFieldSet.has(key)) {
    return new fields.HTMLField({ initial: String(value ?? "") });
  }

  return new fields.StringField({ initial: String(value ?? "") });
}

function createSchema(seed, htmlFields = []) {
  const schema = {};
  const htmlFieldSet = new Set(htmlFields);

  for (const [key, value] of Object.entries(seed ?? {})) {
    schema[key] = createFieldFromDefault(key, value, htmlFieldSet);
  }

  return schema;
}

function createTypedSystemDataModel(seed, htmlFields = []) {
  return class extends foundry.abstract.TypeDataModel {
    static defineSchema() {
      return createSchema(seed, htmlFields);
    }
  };
}

const PlayerCharacterActorSystemModel = createTypedSystemDataModel(
  ACTOR_MODEL_SEEDS["Player Character"],
  ACTOR_HTML_FIELDS["Player Character"]
);

const NpcActorSystemModel = createTypedSystemDataModel(
  ACTOR_MODEL_SEEDS.NPC,
  ACTOR_HTML_FIELDS.NPC
);

const GroupActorSystemModel = createTypedSystemDataModel(
  ACTOR_MODEL_SEEDS.Group,
  ACTOR_HTML_FIELDS.Group
);

const WarfareUnitActorSystemModel = createTypedSystemDataModel(
  ACTOR_MODEL_SEEDS["Warfare Unit"],
  ACTOR_HTML_FIELDS["Warfare Unit"]
);

const EquipmentItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.equipment,
  ITEM_HTML_FIELDS.equipment
);

const ItemItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.item,
  ITEM_HTML_FIELDS.item
);

const ContainerItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.container,
  ITEM_HTML_FIELDS.container
);

const ArmorItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.armor,
  ITEM_HTML_FIELDS.armor
);

const ShieldItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.shield,
  ITEM_HTML_FIELDS.shield
);

const WeaponItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.weapon,
  ITEM_HTML_FIELDS.weapon
);

const SpellItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.spell,
  ITEM_HTML_FIELDS.spell
);

const TraitItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.trait,
  ITEM_HTML_FIELDS.trait
);

const PowerItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.power,
  ITEM_HTML_FIELDS.power
);

const TalentItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.talent,
  ITEM_HTML_FIELDS.talent
);

const CombatStyleItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.combatStyle,
  ITEM_HTML_FIELDS.combatStyle
);

const SkillItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.skill,
  ITEM_HTML_FIELDS.skill
);

const MagicSkillItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.magicSkill,
  ITEM_HTML_FIELDS.magicSkill
);

const AmmunitionItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.ammunition,
  ITEM_HTML_FIELDS.ammunition
);

const InvocationItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.invocation,
  ITEM_HTML_FIELDS.invocation
);

const ScrollItemSystemModel = createTypedSystemDataModel(
  ITEM_MODEL_SEEDS.scroll,
  ITEM_HTML_FIELDS.scroll
);

const ACTOR_MODELS = Object.freeze({
  "Player Character": PlayerCharacterActorSystemModel,
  "NPC": NpcActorSystemModel,
  "Group": GroupActorSystemModel,
  "Warfare Unit": WarfareUnitActorSystemModel,
});

const ITEM_MODELS = Object.freeze({
  equipment: EquipmentItemSystemModel,
  item: ItemItemSystemModel,
  container: ContainerItemSystemModel,
  armor: ArmorItemSystemModel,
  shield: ShieldItemSystemModel,
  weapon: WeaponItemSystemModel,
  spell: SpellItemSystemModel,
  trait: TraitItemSystemModel,
  power: PowerItemSystemModel,
  talent: TalentItemSystemModel,
  combatStyle: CombatStyleItemSystemModel,
  skill: SkillItemSystemModel,
  magicSkill: MagicSkillItemSystemModel,
  ammunition: AmmunitionItemSystemModel,
  invocation: InvocationItemSystemModel,
  scroll: ScrollItemSystemModel,
});

function getManifestTypeKeys(documentName) {
  return documentName === "Actor" ? ACTOR_DOCUMENT_TYPES : ITEM_DOCUMENT_TYPES;
}

function getModelRegistry(documentName) {
  return documentName === "Actor" ? ACTOR_MODELS : ITEM_MODELS;
}

function getSeedRegistry(documentName) {
  return documentName === "Actor" ? ACTOR_MODEL_SEEDS : ITEM_MODEL_SEEDS;
}

function getConfigRegistry(documentName) {
  if (documentName === "Actor") {
    CONFIG.Actor.dataModels ??= {};
    return CONFIG.Actor.dataModels;
  }

  CONFIG.Item.dataModels ??= {};
  return CONFIG.Item.dataModels;
}

export function isTypeDataModelsEnabled() {
  try {
    return game.settings.get(SYSTEM_ID, "enableTypeDataModels") === true;
  } catch (_err) {
    return false;
  }
}

export function registerTypeDataModels() {
  if (!isTypeDataModelsEnabled()) {
    return {
      enabled: false,
      actorTypes: [],
      itemTypes: [],
    };
  }

  const actorRegistry = getConfigRegistry("Actor");
  const itemRegistry = getConfigRegistry("Item");

  for (const type of ACTOR_DOCUMENT_TYPES) {
    actorRegistry[type] = ACTOR_MODELS[type];
  }

  for (const type of ITEM_DOCUMENT_TYPES) {
    itemRegistry[type] = ITEM_MODELS[type];
  }

  return {
    enabled: true,
    actorTypes: Object.keys(actorRegistry),
    itemTypes: Object.keys(itemRegistry),
  };
}

export function getTypeDataModelClass(documentName, type) {
  return getModelRegistry(documentName)?.[type] ?? null;
}

export function getTypeDataModelDefaults(documentName, type) {
  const Model = getTypeDataModelClass(documentName, type);
  if (!Model) return null;

  try {
    return new Model({}).toObject();
  } catch (_err) {
    return cloneValue(getSeedRegistry(documentName)?.[type] ?? null);
  }
}

export function cleanSystemDataWithModel(documentName, type, sourceData) {
  const Model = getTypeDataModelClass(documentName, type);
  if (!Model) return null;

  const defaults = getTypeDataModelDefaults(documentName, type);
  const source = isPlainObject(sourceData) ? cloneValue(sourceData) : {};
  const merged = foundry.utils.mergeObject(cloneValue(defaults ?? {}), source, {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true,
    recursive: true,
  });

  try {
    return new Model(merged).toObject();
  } catch (err) {
    console.warn(`UESRPG | Failed to clean ${documentName}.${type} system data via TypeDataModel`, err);
    return cloneValue(defaults ?? merged);
  }
}

function getRegisteredTypeDataModelKeys(documentName) {
  const registry = documentName === "Actor" ? CONFIG?.Actor?.dataModels : CONFIG?.Item?.dataModels;
  return Object.keys(registry ?? {}).sort((a, b) => a.localeCompare(b));
}

export function getTypeDataModelDiagnosticsReport() {
  const report = {
    enabled: isTypeDataModelsEnabled(),
    Actor: {
      manifest: [...getManifestTypeKeys("Actor")],
      registered: getRegisteredTypeDataModelKeys("Actor"),
    },
    Item: {
      manifest: [...getManifestTypeKeys("Item")],
      registered: getRegisteredTypeDataModelKeys("Item"),
    },
  };

  for (const documentName of ["Actor", "Item"]) {
    const manifest = new Set(report[documentName].manifest);
    const registered = new Set(report[documentName].registered);
    report[documentName].missing = report[documentName].manifest.filter((type) => !registered.has(type));
    report[documentName].extra = report[documentName].registered.filter((type) => !manifest.has(type));
  }

  return report;
}
