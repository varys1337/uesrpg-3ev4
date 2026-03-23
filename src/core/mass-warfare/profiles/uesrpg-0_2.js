/**
 * src/core/mass-warfare/profiles/uesrpg-0_2.js
 *
 * Runtime Warfare profile for the Mass Warfare v2 rules draft.
 *
 * The profile id remains "uesrpg-0_2" for backward compatibility, but the
 * underlying tables and derivation now follow the v2 rules update.
 */

export const RANKS = Object.freeze({
  rabble: { label: "Rabble / Slaves", baseDiscipline: 20, upkeepMultiplier: 1 },
  militia: { label: "Militia / Irregular", baseDiscipline: 30, upkeepMultiplier: 6 },
  regular: { label: "Regular", baseDiscipline: 40, upkeepMultiplier: 8 },
  veteran: { label: "Veteran", baseDiscipline: 50, upkeepMultiplier: 12 },
  elite: { label: "Elite", baseDiscipline: 60, upkeepMultiplier: 18 },
});

/**
 * @typedef {object} CategoryFeature
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {boolean} isPassive
 * @property {boolean} appliesInClash
 */

export const CATEGORIES = Object.freeze({
  warriors: {
    label: "Warriors",
    typeMultiplier: 3,
    equipmentSlots: 1,
    canRangedAttack: false,
    isRangedUnit: false,
    fieldcraftActive: false,
    features: [
      {
        id: "shockAssault",
        label: "Shock Assault",
        description: "Halve AR for this Clash and add the lost amount to DMG.",
        isPassive: false,
        appliesInClash: true,
      },
    ],
  },
  skirmishers: {
    label: "Skirmishers",
    typeMultiplier: 4,
    equipmentSlots: 1,
    canRangedAttack: true,
    isRangedUnit: true,
    rangedRange: 8,
    fieldcraftActive: true,
    features: [
      {
        id: "fieldcraft",
        label: "Fieldcraft",
        description: "+10 TN to Scout and Set Ambush tests while the unit retains Fieldcraft.",
        isPassive: true,
        appliesInClash: false,
      },
    ],
  },
  auxiliaries: {
    label: "Auxiliaries",
    typeMultiplier: 2,
    equipmentSlots: 3,
    canRangedAttack: false,
    isRangedUnit: false,
    fieldcraftActive: false,
    features: [
      {
        id: "battlefieldSupport",
        label: "Battlefield Support",
        description: "Reduce Equipment deployment time by 1, to a minimum of 1.",
        isPassive: true,
        appliesInClash: false,
      },
      {
        id: "supplyLines",
        label: "Supply Lines",
        description: "Auxiliaries carry 3 Equipment slots and replenish expended Equipment between battles.",
        isPassive: true,
        appliesInClash: false,
      },
    ],
  },
});

export const APPAREL = Object.freeze({
  light: { label: "Light", dmg: "2d4", ar: 4, mar: 2, speed: 5, cost: 250 },
  medium: { label: "Medium", dmg: "2d6", ar: 6, mar: 3, speed: 4, cost: 500 },
  heavy: { label: "Heavy", dmg: "2d8", ar: 8, mar: 4, speed: 3, cost: 800 },
  "super-heavy": { label: "Super-Heavy", dmg: "2d10", ar: 10, mar: 5, speed: 2, cost: 1500 },
});

export const GEAR_TIERS = APPAREL;

export const MOUNTS = Object.freeze({
  none: { label: "None", speedBonus: 0, upkeepMultiplier: 0, trait: "", chargeDie: "" },
  light: { label: "Light Mounts", speedBonus: 3, upkeepMultiplier: 5, trait: "Sure-Footed", chargeDie: "" },
  heavy: { label: "Heavy Mounts", speedBonus: 2, upkeepMultiplier: 10, trait: "Trampling Charge", chargeDie: "extra" },
  flying: { label: "Flying Mounts", speedBonus: 1, upkeepMultiplier: 15, trait: "Flyer", chargeDie: "" },
});

export const EQUIPMENT_CATALOG = Object.freeze({
  fieldDressings: { label: "Field Dressings", deployTime: 1, effect: "Restore this unit's DMG in Resolve to an adjacent unit.", cost: 150 },
  spareAmmunition: { label: "Spare Ammunition", deployTime: 1, effect: "Next ranged attack gains one additional damage die.", cost: 150 },
  reserveShields: { label: "Reserve Shields", deployTime: 1, effect: "Gain +3 AR for the next Clash.", cost: 150 },
  signalBanners: { label: "Signal Banners", deployTime: 1, effect: "Gain +20 Current Discipline until the start of this unit's next Activation.", cost: 150 },
  mantlets: { label: "Mantlets", deployTime: 2, effect: "Gain +2 AR and +2 MAR against ranged attacks; Speed is halved while active.", cost: 300 },
  caltrops: { label: "Caltrops", deployTime: 2, effect: "Enemies treat the target grid as Difficult Terrain.", cost: 300 },
  spikes: { label: "Spikes", deployTime: 2, effect: "Mounted units test Discipline to enter; charging units in the grid suffer this unit's DMG.", cost: 300 },
  sapperTools: { label: "Sapper Tools", deployTime: 2, effect: "Target adjacent fortifications or prepared positions.", cost: 300 },
  bridgingGear: { label: "Fascines & Bridging Gear", deployTime: 3, effect: "Turns Impassable into Difficult and Difficult into Normal in a small area.", cost: 300 },
  defensiveMounds: { label: "Defensive Mounds", deployTime: 3, effect: "Increase ranged attack maximum range by half.", cost: 300 },
  palisadeSections: { label: "Palisade Sections", deployTime: 3, effect: "Place a palisade with 8 HP on one front.", cost: 300 },
  battleScrolls: { label: "Battle Scrolls", deployTime: 1, effect: "Resolve one preselected Magic Implement effect during the Strategic Phase.", cost: 300 },
});

export const IMPLEMENT_CATALOG = Object.freeze({
  fireChannels: {
    label: "Fire Channels",
    family: "assault",
    cost: 500,
    passive: false,
    effect: "Damage becomes magical and uses MAR. On damage, all Clash tests against the target gain +10 until the next Strategic Phase.",
  },
  frostChannels: {
    label: "Frost Channels",
    family: "assault",
    cost: 500,
    passive: false,
    effect: "Damage becomes magical and uses MAR. On damage, the target becomes Suppressed until the next Strategic Phase.",
  },
  shockChannels: {
    label: "Shock Channels",
    family: "assault",
    cost: 500,
    passive: false,
    effect: "Damage becomes magical and uses MAR. On damage, the target cannot use Unit Actions until the next Strategic Phase.",
  },
  poisonChannels: {
    label: "Poison Channels",
    family: "assault",
    cost: 500,
    passive: false,
    effect: "Damage becomes magical and uses MAR. On damage, the target suffers -10 Discipline until the next Strategic Phase.",
  },
  armorChannel: {
    label: "Armor Channel",
    family: "defense",
    cost: 500,
    passive: true,
    effect: "Gain +2 AR.",
    arBonus: 2,
  },
  magicChannel: {
    label: "Magic Channel",
    family: "defense",
    cost: 500,
    passive: true,
    effect: "Gain +1 MAR.",
    marBonus: 1,
  },
  wardChannel: {
    label: "Ward Channel",
    family: "defense",
    cost: 500,
    passive: true,
    effect: "Add +1 to Bulk DB for determining Bulk loss.",
    bulkLossDbBonus: 1,
  },
  vigilanceChannel: {
    label: "Vigilance Channel",
    family: "defense",
    cost: 500,
    passive: true,
    effect: "Gain +10 TN to Break and Scout Ahead tests.",
    breakScoutBonus: 10,
  },
  healingChannels: {
    label: "Healing Channels",
    family: "support",
    cost: 500,
    passive: false,
    effect: "Restore this unit's DMG in lost Resolve to one adjacent unit.",
  },
  inspirationalChannels: {
    label: "Inspirational Channels",
    family: "support",
    cost: 500,
    passive: false,
    effect: "Restore this unit's DMG in lost Discipline to one adjacent unit.",
  },
  wayfindingChannels: {
    label: "Wayfinding Channels",
    family: "support",
    cost: 500,
    passive: false,
    effect: "Treat Difficult Terrain as Normal Terrain; two copies also downgrade Impassable Terrain to Difficult.",
  },
  veilChannel: {
    label: "Veil Channel",
    family: "support",
    cost: 500,
    passive: false,
    effect: "Gain +10 TN to Set Ambush; two copies allow plain-sight ambushes.",
  },
});

export const TRADITIONS = Object.freeze({
  skyrim: {
    label: "Skyrim",
    battleDoctrine: "Northern Shieldwall: If this unit uses Hold it gains +10 TN to Discipline Tests until the start of its next Activation.",
    campaignDoctrine: "Cold-Hardened: Ignore the first Poor Climate and Forced March penalty in Snowy or Mountain terrain.",
  },
  "high-rock": {
    label: "High Rock",
    battleDoctrine: "Ordered Banners: Once per round, when this unit uses Rally or deploys Signal Banners, one adjacent friendly unit gains +10 TN to Discipline Tests until the start of its next Activation.",
    campaignDoctrine: "Marcher Roads: Ignore the first Poor Climate and Forced March penalty in Forest or Mountain terrain.",
  },
  hammerfell: {
    label: "Hammerfell",
    battleDoctrine: "Warrior Wave: If this unit moves its full Speed during the Charge Phase, it gains +10 TN on its next Clash Test.",
    campaignDoctrine: "Desert Endurance: Ignore the first Poor Climate and Forced March penalty in Desert or Scrub terrain.",
  },
  cyrodiil: {
    label: "Cyrodiil",
    battleDoctrine: "Legion Drill: If this unit begins its Activation adjacent to a friendly unit of a different Unit Type, both gain +10 to Break and Rally Tests until the start of this unit's next Activation.",
    campaignDoctrine: "Road Discipline: Ignore the first Poor Climate and Forced March penalty in allied territory or Grassland terrain.",
  },
  summerset: {
    label: "Summerset",
    battleDoctrine: "Arcane Precision: The first time each round this unit scores 1+ DoS on Cast a Spell or a Battle Scroll, increase total DoS by 1.",
    campaignDoctrine: "Blessed Isle: Ignore the first Poor Climate and Forced March penalty in Grassland or Waterborne travel.",
  },
  valenwood: {
    label: "Valenwood",
    battleDoctrine: "Green Shadows: The first ranged or clash test after a successful ambush, or while Hidden, applies Suppressed.",
    campaignDoctrine: "Forest-Wise: Ignore the first Poor Climate and Forced March penalty in Forest or Scrub terrain.",
  },
  morrowind: {
    label: "Morrowind",
    battleDoctrine: "Ancestral Guidance: Once per round, when this unit fails a Break Test it may reroll it.",
    campaignDoctrine: "Harsh Provenance: Ignore the first Poor Climate and Forced March penalty in Swamp terrain or enemy territory.",
  },
  "black-marsh": {
    label: "Black Marsh",
    battleDoctrine: "Mire Fighters: While in Difficult Terrain, adjacent spaces count as Difficult Terrain for enemies.",
    campaignDoctrine: "Marsh-Wise: Ignore the first Poor Climate and Forced March penalty in Swamp or Waterborne travel.",
  },
  elsweyr: {
    label: "Elsweyr",
    battleDoctrine: "Predatory Pursuit: Once per round, when an enemy within this unit's Speed becomes Broken or Suppressed from this unit's attack, this unit may move up to half its Speed.",
    campaignDoctrine: "Nomadic Survival: Ignore the first Poor Climate and Forced March penalty in Desert terrain or neutral territory.",
  },
  "orc-strongholds": {
    label: "Orc Strongholds",
    battleDoctrine: "Relentless Endurance: When this unit is Charged it gains +10 TN on its next Clash Test.",
    campaignDoctrine: "Stronghold Labor: Ignore the first Poor Climate and Forced March penalty in Mountain terrain or neutral territory.",
  },
  reach: {
    label: "The Reach",
    battleDoctrine: "Crag War: If this unit begins its Activation in Difficult Terrain, it gains +10 TN to its next Clash Test or Ranged Test this Activation.",
    campaignDoctrine: "Hillwise: Ignore the first Poor Climate and Forced March penalty in Mountain or Scrub terrain.",
  },
});

export const RACIAL_PRESETS = TRADITIONS;

export const UNIT_ACTIONS = Object.freeze([
  { id: "advance", label: "Advance", summary: "Double the unit's current Speed for this Activation." },
  { id: "hold", label: "Hold", summary: "Remain stationary; enemies take -20 TN to Clash Tests against the unit and it counts as Defending in its first Clash." },
  { id: "castSpell", label: "Cast a Spell", summary: "Use a Magic Implement or Battle Scroll with a Discipline Test." },
  { id: "setAmbush", label: "Set Ambush", summary: "Make a Discipline Test to become Hidden and prepare an ambush." },
  { id: "scout", label: "Scout Ahead", summary: "Make a Discipline Test to reveal Hidden enemy units along your path." },
]);

export const LEADER_ACTIONS = Object.freeze([
  { id: "joinFray", label: "Join the Fray", summary: "The commander joins the unit's next Clash this Clash Phase." },
  { id: "rally", label: "Rally the Unit", summary: "Make a Command Test; on success restore 10 Discipline, up to Base Discipline." },
  { id: "abandon", label: "Attach to the Unit", summary: "Attach or detach a commander from this unit." },
]);

export const ECONOMY_MODEL = Object.freeze({
  supportedCadences: ["weekly"],
  supportedModes: ["gold"],
  defaultCadence: "weekly",
  defaultMode: "gold",
});

export const MAGIC_MODEL = Object.freeze({
  supportedModes: ["implements"],
  defaultMode: "implements",
  modeLabels: {
    implements: "Implements & Battle Scrolls",
  },
});

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function _toKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function _safeCategoryKey(sys, warnings) {
  const raw = _toKey(sys.identity?.category || sys.classification?.unitType);
  const mapped = {
    warrior: "warriors",
    warriors: "warriors",
    skirmisher: "skirmishers",
    skirmishers: "skirmishers",
    auxiliary: "auxiliaries",
    auxiliaries: "auxiliaries",
  }[raw] ?? "";
  if (!mapped && raw) warnings.push(`Unit Type "${raw}" does not map cleanly to v2. Choose Warriors, Skirmishers, or Auxiliaries.`);
  return mapped;
}

function _safeRankKey(sys) {
  return _toKey(sys.identity?.rank);
}

function _safeTraditionKey(sys, warnings) {
  const key = _toKey(sys.doctrine?.tradition);
  if (key) return key;
  const legacy = _toKey(sys.identity?.ancestry || sys.classification?.ancestry);
  if (legacy && !TRADITIONS[legacy]) warnings.push(`Legacy ancestry "${legacy}" was preserved but not auto-mapped to a Provincial Tradition.`);
  return key;
}

function _safeMountKey(sys, warnings) {
  const key = _toKey(sys.mounts?.primary || sys.classification?.mount || "none");
  if (MOUNTS[key]) return key;
  if (key && key !== "none") warnings.push(`Legacy mount "${key}" was preserved but not auto-mapped to Light/Heavy/Flying mounts.`);
  return "none";
}

function _safeApparelKey(sys) {
  return _toKey(sys.gear?.apparel || sys.gear?.tier || sys.classification?.tier || "light");
}

function _resolveCommanderActor(sys) {
  const uuid = String(sys.commander?.uuid ?? "");
  if (!uuid || typeof fromUuidSync !== "function") return null;
  try {
    return fromUuidSync(uuid) ?? null;
  } catch (_err) {
    return null;
  }
}

function _resolveCommanderBonus(sys) {
  const override = _num(sys.commander?.bonusOverride, NaN);
  if (Number.isFinite(override) && override !== 0) return override;

  const commander = _resolveCommanderActor(sys);
  if (!commander?.items?.size) return 0;
  const commandItem = commander.items.find((item) =>
    String(item?.type ?? "").toLowerCase() === "skill"
    && _toKey(item?.name) === "command"
  );
  if (!commandItem) return 0;

  const candidates = [
    commandItem.system?.bonus,
    commandItem.system?.total,
    commandItem.system?.value,
    commandItem.system?.rank,
    commandItem.system?.advances?.total,
  ].map((value) => _num(value, NaN)).filter(Number.isFinite);

  const bonus = candidates.find((value) => Math.abs(value) <= 30);
  return Number.isFinite(bonus) ? bonus : 0;
}

function _normalizeEquipmentEntries(sys, categoryKey) {
  const supportReduction = categoryKey === "auxiliaries" ? 1 : 0;
  const entries = Array.isArray(sys.equipment?.owned) ? sys.equipment.owned : [];
  return entries.map((entry) => {
    const key = _toKey(entry?.key);
    const catalog = EQUIPMENT_CATALOG[key] ?? null;
    const deployBase = _num(entry?.deployTime, catalog?.deployTime ?? 1);
    return {
      key,
      name: String(entry?.name ?? catalog?.label ?? ""),
      deployTime: Math.max(1, deployBase - supportReduction),
      deployProgress: Math.max(0, _num(entry?.deployProgress, 0)),
      deployed: Boolean(entry?.deployed),
      expended: Boolean(entry?.expended),
      placement: String(entry?.placement ?? ""),
      effect: String(entry?.effect ?? catalog?.effect ?? entry?.description ?? ""),
      cost: _num(entry?.cost, catalog?.cost ?? 0),
      isBattleScroll: key === "battleScrolls",
    };
  });
}

function _normalizeImplementEntries(sys) {
  const entries = Array.isArray(sys.magic?.entries) ? sys.magic.entries : [];
  return entries.map((entry) => {
    const key = _toKey(entry?.key);
    const catalog = IMPLEMENT_CATALOG[key] ?? null;
    return {
      key,
      name: String(entry?.name ?? catalog?.label ?? ""),
      family: String(entry?.family ?? catalog?.family ?? "support"),
      count: Math.max(1, _num(entry?.count, 1)),
      effect: String(entry?.effect ?? catalog?.effect ?? ""),
      passive: Boolean(catalog?.passive),
      rangedUnlocked: Math.max(1, _num(entry?.count, 1)) >= 2,
    };
  });
}

function _extraDieFromFormula(formula) {
  const match = String(formula ?? "").trim().match(/^(\d+)d(\d+)$/i);
  if (!match) return "";
  return `1d${match[2]}`;
}

function _buildDisciplineModifiers(sys, derived, currentResolve, warnings) {
  const entries = [];
  const add = (label, value) => {
    const n = _num(value, 0);
    if (!n) return;
    entries.push({ label, value: n });
  };

  const campaign = sys.modifiers?.discipline?.campaign ?? {};
  const battle = sys.modifiers?.discipline?.battle ?? {};

  add("Manual Discipline Modifier", _num(sys.modifiers?.discipline?.manual, 0));
  if (campaign.inspiringSpeech) add("Inspiring Speech", 10);
  if (campaign.forcedMarch) add("Forced March", -10);
  if (campaign.poorClimate) add("Poor Climate", -10);
  if (campaign.longCampaign) add("Long Campaign", -20);
  if (campaign.defendingAlliedSettlement) add("Defending Allied Settlements", 10);

  const unpaidWeeks = Math.max(0, _num(sys.economy?.unpaidWeeks, 0));
  if (unpaidWeeks) add("Unpaid Upkeep", -10 * unpaidWeeks);

  if (battle.rearCharged) add("Charged in the Rear", -10);
  if (battle.adjacentFriendlyBroken) add("Adjacent Friendly Broken", -10);
  if (battle.commanderLost) add("Commander Lost", -10);
  if (battle.rallyBonus) add("Rally the Unit", 10);
  if (battle.enemyBrokenBonus) add("Enemy Broken by Clash", 10);

  if (derived.startingResolve > 0 && currentResolve < Math.ceil(derived.startingResolve / 2)) {
    add("Below Half Resolve", -10);
  }

  const traditionKey = derived.traditionKey;
  if (traditionKey === "skyrim" && derived.holdActive) add("Northern Shieldwall", 10);

  if (traditionKey === "summerset") warnings.push("Summerset Arcane Precision is handled during Cast a Spell resolution, not in passive derived TN.");
  if (traditionKey === "morrowind") warnings.push("Morrowind Ancestral Guidance rerolls remain manual reminder text in this pass.");

  return entries;
}

function _sumEntries(entries) {
  return (entries ?? []).reduce((sum, entry) => sum + _num(entry?.value, 0), 0);
}

function _passiveImplementBonuses(entries) {
  const bonus = {
    ar: 0,
    mar: 0,
    bulkLossDb: 0,
    breakScout: 0,
  };
  for (const entry of entries) {
    const catalog = IMPLEMENT_CATALOG[entry.key];
    if (!catalog?.passive) continue;
    bonus.ar += _num(catalog.arBonus, 0) * entry.count;
    bonus.mar += _num(catalog.marBonus, 0) * entry.count;
    bonus.bulkLossDb += _num(catalog.bulkLossDbBonus, 0) * entry.count;
    bonus.breakScout += _num(catalog.breakScoutBonus, 0) * entry.count;
  }
  return bonus;
}

export function computeDerived(sys) {
  const warnings = [];
  const notices = [];

  const categoryKey = _safeCategoryKey(sys, warnings);
  const category = CATEGORIES[categoryKey] ?? null;
  const rankKey = _safeRankKey(sys);
  const rank = RANKS[rankKey] ?? null;
  const traditionKey = _safeTraditionKey(sys, warnings);
  const tradition = TRADITIONS[traditionKey] ?? null;
  const apparelKey = _safeApparelKey(sys);
  const apparel = APPAREL[apparelKey] ?? APPAREL.light;
  const mountKey = _safeMountKey(sys, warnings);
  const mount = MOUNTS[mountKey] ?? MOUNTS.none;

  if (categoryKey === "skirmishers" && apparelKey === "super-heavy") {
    warnings.push("Skirmishers cannot take Super-Heavy apparel in v2.");
  }
  if (categoryKey === "auxiliaries" && (apparelKey === "heavy" || apparelKey === "super-heavy")) {
    warnings.push("Auxiliaries cannot take Heavy or Super-Heavy apparel in v2.");
  }

  sys.gear.apparel = apparelKey;
  sys.gear.tier = apparelKey;
  if (sys.classification) sys.classification.tier = apparelKey;

  const baseDisciplineByRank = _num(rank?.baseDiscipline, _num(sys.stats?.discipline?.base, 0));
  sys.stats.discipline.base = baseDisciplineByRank;
  const disciplinePermanentBonus = _num(sys.stats?.discipline?.bonus, 0);
  const baseDisciplineTotal = Math.max(0, baseDisciplineByRank + disciplinePermanentBonus);
  const baseDb = Math.max(1, Math.floor(baseDisciplineTotal / 10));

  const bulkMax = Math.max(1, _num(sys.stats?.bulk?.max, _num(sys.stats?.bulk?.value, 1)));
  sys.stats.bulk.max = bulkMax;

  const startingResolve = bulkMax * baseDb;
  sys.stats.resolve ??= { value: 0, max: 0, lossTotal: 0 };
  sys.stats.resolve.max = startingResolve;

  const conditionCurrent = _num(sys.stats?.condition?.value, 0);
  const resolveStored = _num(sys.stats?.resolve?.value, conditionCurrent);
  const resolveValue = Math.max(0, Math.min(startingResolve, resolveStored));
  sys.stats.resolve.value = resolveValue;
  sys.stats.condition.max = startingResolve;
  sys.stats.condition.value = resolveValue;

  const inferredLoss = Math.max(0, startingResolve - resolveValue);
  const storedLossTotal = Math.max(inferredLoss, _num(sys.stats?.resolve?.lossTotal, inferredLoss));
  sys.stats.resolve.lossTotal = storedLossTotal;

  const implementEntries = _normalizeImplementEntries(sys);
  const equipmentEntries = _normalizeEquipmentEntries(sys, categoryKey);
  const passiveBonuses = _passiveImplementBonuses(implementEntries);

  const bulkLossThreshold = Math.max(1, baseDb + passiveBonuses.bulkLossDb);
  const inferredBulkLoss = Math.max(0, bulkMax - _num(sys.stats?.bulk?.value, bulkMax));
  const storedBulkLossTotal = Math.max(0, _num(sys.stats?.bulk?.lossTotal, inferredBulkLoss));
  const currentBulk = Math.max(0, Math.min(bulkMax, _num(sys.stats?.bulk?.value, bulkMax)));
  sys.stats.bulk.value = currentBulk;
  sys.stats.bulk.lossTotal = storedBulkLossTotal;

  const commanderBonus = _resolveCommanderBonus(sys);
  const holdActive = Boolean(sys._derived?.holdActive);
  const disciplineEntries = _buildDisciplineModifiers(sys, {
    startingResolve,
    traditionKey,
    holdActive,
  }, resolveValue, warnings);
  const currentDiscipline = Math.max(0, baseDisciplineTotal + commanderBonus + _sumEntries(disciplineEntries));
  sys.stats.discipline.value = currentDiscipline;

  const apparelAr = _num(apparel.ar, 0);
  const apparelMar = _num(apparel.mar, 0);
  const apparelCost = _num(apparel.cost, 0);
  let effectiveDmg = String(apparel.dmg);
  let effectiveAr = apparelAr;
  let effectiveMar = apparelMar;
  if (categoryKey === "auxiliaries") {
    effectiveAr = Math.floor(effectiveAr / 2);
    effectiveMar = Math.floor(effectiveMar / 2);
  }

  sys.gear.dmg = effectiveDmg;
  sys.gear.ar = Math.max(0, effectiveAr + passiveBonuses.ar);
  sys.gear.mar = Math.max(0, effectiveMar + passiveBonuses.mar);
  sys.gear.cost = apparelCost;
  sys.gear.speedPenalty = 0;

  const speedBase = Math.max(0, _num(apparel.speed, 0) + _num(mount.speedBonus, 0));
  const speedBonus = _num(sys.stats?.speed?.bonus, 0);
  let speedValue = Math.max(0, speedBase + speedBonus);
  if (sys.status?.battle?.suppressed) speedValue = Math.floor(speedValue / 2);
  sys.stats.speed.base = speedBase;
  sys.stats.speed.value = speedValue;

  sys.stats.magicka.max = 0;
  sys.stats.magicka.value = 0;

  if (mountKey === "flying") sys.status.battle.flyer = true;
  sys.status.battle.defeated = currentBulk <= 0;
  if (currentBulk <= 0) {
    notices.push("This unit has 0 Bulk and is defeated.");
  }

  const upkeepBase = _num(rank?.upkeepMultiplier, 0)
    + _num(category?.typeMultiplier, 0)
    + {
      light: 1,
      medium: 2,
      heavy: 4,
      "super-heavy": 8,
    }[apparelKey]
    + _num(mount?.upkeepMultiplier, 0)
    + _num(sys.economy?.specialModifier, 0);
  const weeklyUpkeep = currentBulk * upkeepBase;
  sys.economy.amount = weeklyUpkeep;
  sys.upkeep.weeklyGold = weeklyUpkeep;
  sys.upkeep.enslaved = Boolean(sys.economy?.enslaved ?? sys.upkeep?.enslaved);

  const equipmentSlots = _num(category?.equipmentSlots, 1);
  const fieldcraftActive = categoryKey === "skirmishers" && apparelKey !== "heavy";
  if (categoryKey === "skirmishers" && apparelKey === "heavy") {
    warnings.push("Skirmishers in Heavy apparel lose Fieldcraft.");
  }

  notices.push("Charge-phase sequencing is still manual in this pass; use clash dialog toggles for charge context.");
  notices.push("Campaign doctrines are tracked as structured text and manual modifiers, not terrain automation.");

  sys.rules.source = "UESRPG Mass Warfare 3e";
  sys.rules.version = "2.0";

  sys._derived = {
    profileId: "uesrpg-0_2",
    categoryKey,
    categoryLabel: category?.label ?? "Unassigned",
    unitTypeLabel: category?.label ?? "Unassigned",
    rankKey,
    rankLabel: rank?.label ?? "Unassigned",
    traditionKey,
    traditionLabel: tradition?.label ?? "",
    traditionBattleDoctrine: tradition?.battleDoctrine ?? "",
    traditionCampaignDoctrine: tradition?.campaignDoctrine ?? "",
    apparelKey,
    tierLabel: apparel.label,
    mountLabel: mount.label,
    mountTrait: mount.trait,
    mountChargeDie: mount.chargeDie === "extra" ? _extraDieFromFormula(apparel.dmg) : "",
    baseDiscipline: baseDisciplineTotal,
    commanderBonus,
    disciplineEntries,
    disciplineMax: baseDisciplineTotal + commanderBonus,
    currentDiscipline,
    baseDb,
    db: baseDb,
    bulk: currentBulk,
    bulkMax,
    bulkLossTotal: storedBulkLossTotal,
    bulkLossThreshold,
    startingResolve,
    resolveMax: startingResolve,
    resolveCurrent: resolveValue,
    resolveLossTotal: storedLossTotal,
    conditionMax: startingResolve,
    currentResolveBelowHalf: startingResolve > 0 && resolveValue < Math.ceil(startingResolve / 2),
    weeklyUpkeep,
    equipmentSlots,
    equipmentEntries,
    implementEntries,
    passiveImplementBonuses: passiveBonuses,
    canCastSpell: implementEntries.length > 0 || equipmentEntries.some((entry) => entry.isBattleScroll),
    canRangedAttack: Boolean(category?.canRangedAttack),
    rangedRange: _num(category?.rangedRange, 0),
    fieldcraftActive,
    breakScoutBonus: passiveBonuses.breakScout + (fieldcraftActive ? 10 : 0),
    speedBase,
    speedAfterGear: speedBase,
    isMage: false,
    isWarrior: categoryKey === "warriors",
    isSkirmisher: categoryKey === "skirmishers",
    isAuxiliary: categoryKey === "auxiliaries",
    ancestryLabel: _capitalize(String(sys.identity?.ancestry || sys.classification?.ancestry || "")),
    racialSpecial: tradition?.battleDoctrine ?? "",
    holdActive,
    warnings,
    notices,
  };

  return { warnings, notices };
}

export const UESRPG_0_2_PROFILE = Object.freeze({
  id: "uesrpg-0_2",
  label: "UESRPG Mass Warfare 3e v2",
  ranks: RANKS,
  categories: CATEGORIES,
  traditions: TRADITIONS,
  gearTiers: APPAREL,
  apparel: APPAREL,
  mounts: MOUNTS,
  racialPresets: TRADITIONS,
  equipmentCatalog: EQUIPMENT_CATALOG,
  implementCatalog: IMPLEMENT_CATALOG,
  economy: ECONOMY_MODEL,
  magic: MAGIC_MODEL,
  actions: { unitActions: UNIT_ACTIONS, leaderActions: LEADER_ACTIONS },
  computeDerived,
  sheetModel: {
    tabs: ["core", "actions", "magic", "items"],
    encounterModel: "v2 - actor/chat automation without a dedicated phase tracker",
    notices: [
      "Resolve is now the canonical warfare resource.",
      "Charge sequencing, adjacency, and terrain doctrine triggers remain manual in this pass.",
    ],
  },
});
