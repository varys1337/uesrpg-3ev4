export const QUALITIES_CATALOG = Object.freeze([
  { key: "slashing", hasValue: false },
  { key: "splitting", hasValue: false },
  { key: "crushing", hasValue: false },
  { key: "piercing", hasValue: false },
  { key: "magic", hasValue: false },
  { key: "silver", hasValue: false },
  { key: "primitive", hasValue: false },
  { key: "proven", hasValue: false },
  { key: "reload", hasValue: true },
  { key: "damaged", hasValue: true },
]);

export const QUALITIES_CORE_BY_TYPE = Object.freeze({
  weapon: Object.freeze([
    { key: "slashing", hasValue: false, optionalValue: true },
    { key: "splitting", hasValue: false, optionalValue: true },
    { key: "crushing", hasValue: false, optionalValue: true },
    { key: "piercing", hasValue: false },
    { key: "magic", hasValue: false },
    { key: "silver", hasValue: false },
    { key: "primitive", hasValue: false },
    { key: "proven", hasValue: false },
    { key: "reload", hasValue: true },
    { key: "damaged", hasValue: true },
  ]),
  armor: Object.freeze([
    { key: "magic", hasValue: false },
    { key: "silver", hasValue: false },
    { key: "damaged", hasValue: true },
  ]),
  ammunition: Object.freeze([
    { key: "slashing", hasValue: false, optionalValue: true },
    { key: "splitting", hasValue: false, optionalValue: true },
    { key: "magic", hasValue: false },
    { key: "silver", hasValue: false },
    { key: "damaged", hasValue: true },
  ]),
});

export const TRAITS_BY_TYPE = Object.freeze({
  weapon: Object.freeze([
    { key: "concealable" },
    { key: "concussive" },
    { key: "complex" },
    { key: "dueling" },
    { key: "entangling" },
    { key: "exploitWeakness" },
    { key: "flail" },
    { key: "focus" },
    { key: "handToHand" },
    { key: "hooked" },
    { key: "impaling" },
    { key: "mounted" },
    { key: "shieldSplitter" },
    { key: "sling" },
    { key: "small" },
    { key: "snare" },
    { key: "thrown" },
    { key: "twoHanded" },
    { key: "unwieldy" },
  ]),
  armor: Object.freeze([
    { key: "shield" },
    { key: "helmet" },
  ]),
  ammunition: Object.freeze([]),
});

export const QUALITIES_ALIASES = {
  slashing: "slashing",
  splitting: "splitting",
  crushing: "crushing",
  piercing: "piercing",
  magic: "magic",
  silver: "silver",
  silvered: "silver",
  primitive: "primitive",
  proven: "proven",
  reload: "reload",
  damaged: "damaged",
};
