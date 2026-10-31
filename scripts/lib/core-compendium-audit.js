"use strict";

const fs = require("node:fs");
const path = require("node:path");

const cell = value => String(value ?? "—").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const sourceLabel = entry => entry.source ? `Ch. ${entry.source.chapter}, p. ${entry.source.page}: ${entry.source.rule}` : "No verified exact Core profile";

/** Compare authored armor fields directly with the recorded Core table row. */
function compareArmorTable(item, reference, cleanKey) {
  if (item?.type !== "armor") return null;
  const match = String(item.name ?? "").match(/^(.+?) (Partial|Full) Armor(?: (Head|Body|Left Arm|Right Arm|Left Leg|Right Leg))?$/);
  if (!match) return null;
  const [, material, lane, location] = match;
  const table = `${lane} Armor Types`;
  const row = reference.tables?.[table]?.slice(1)
    .find(entry => cleanKey(entry[0]) === cleanKey(`${lane} ${material}`));
  if (!row) return null;

  const [, armor, magic, qualities, enc, enchantment, price] = row;
  const [pieceEnc, suitEnc] = (enc.match(/\d+/g) ?? []).map(Number);
  const [limbPrice, bodyPrice, suitPrice] = (price.match(/\d+/g) ?? []).map(Number);
  if ([pieceEnc, suitEnc, limbPrice, bodyPrice, suitPrice].some(value => !Number.isFinite(value))) return null;
  const magicMatch = magic.match(/(\d+)\s+(\w+)/);
  const magicArmor = magicMatch?.[2] === "magic" ? Number(magicMatch[1]) : 0;
  const specialArmor = magicMatch && magicMatch[2] !== "magic" ? Number(magicMatch[1]) : 0;
  const weight = cleanKey(qualities.split(",")[0]);
  const expectedCoverage = Object.fromEntries(["Head", "Body", "LeftArm", "RightArm", "LeftLeg", "RightLeg"]
    .map(key => [key, !location || cleanKey(key) === cleanKey(location)]));
  const system = item.system ?? {};
  const magicQuality = qualities.split(",").some(value => cleanKey(value) === "magic");
  const storedMagic = (system.qualitiesStructured ?? []).some(value => cleanKey(value?.key ?? value) === "magic")
    || (system.qualitiesTraits ?? []).some(value => cleanKey(value) === "magic")
    || String(system.qualities ?? "").split(",").some(value => cleanKey(value) === "magic");
  const expected = {
    armor: Number(armor), magic_ar: magicArmor, special_ar: specialArmor,
    special_ar_type: specialArmor ? magicMatch[2] : "",
    weightClass: ["light", "medium", "heavy", "superheavy"].includes(weight) ? weight : "none",
    enc: location ? pieceEnc : suitEnc,
    price: location ? (location === "Body" ? bodyPrice : limbPrice) : suitPrice,
    enchant_level: Number(enchantment), armorClass: lane.toLowerCase(), hitLocations: expectedCoverage,
    magicQuality,
  };
  const actual = Object.fromEntries(Object.keys(expected).map(key => [key, key === "magicQuality" ? storedMagic : system[key]]));
  const nativeLane = system.armorValues?.[lane.toLowerCase()] ?? {};
  for (const field of ["armor", "magic_ar", "special_ar", "special_ar_type"]) {
    expected[`armorValues.${lane.toLowerCase()}.${field}`] = expected[field];
    actual[`armorValues.${lane.toLowerCase()}.${field}`] = nativeLane[field];
  }
  const differences = Object.keys(expected).filter(key => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]));
  return {
    source: { chapter: 7, page: 178, table, row: row[0] },
    status: differences.length ? "source-fields-differ" : "selected-source-fields-match",
    actual, expected, differences,
    limitations: "Static comparison only. Derived equipment behavior, coverage, quality changes and live damage still require review."
  };
}

/** Compare source-listed weapon base fields without treating derived material values as stored values. */
function compareWeaponTable(item, reference, cleanKey) {
  if (item?.type !== "weapon") return null;
  const sourceRule = String(item.flags?.["uesrpg-3ev4"]?.coreSource?.rule ?? "");
  const separator = sourceRule.indexOf(": ");
  if (separator < 0) return null;
  let table = sourceRule.slice(0, separator);
  let name = sourceRule.slice(separator + 2);
  if (name === "Dagger" && /(?:^| )punch dagger$/i.test(item.name)) {
    table = "Exotic Weapons table";
    name = "Punch Dagger / Talons";
  }
  const row = reference.tables?.[table]?.find(entry => entry[0] === name);
  if (!row) return null;

  const [, damage, hands, distance, qualities, enc, price] = row;
  const pair = damage.match(/^(\S+)\s*\(([^)]+)\)/);
  const reach = distance.match(/(\d+)(?:[–-](\d+))?m/);
  const thrown = qualities.match(/Thrown\s*\(([^)]+)\)/i);
  const expectedQualities = qualities.split(/,\s*(?![^()]*\))/).map(label => {
    const parsed = label.match(/^([^()]+?)(?:\s*\(([^)]+)\))?$/);
    if (!parsed) return null;
    const raw = cleanKey(parsed[1]);
    const key = raw === "duelingweapon" ? "dueling" : raw;
    const value = ["slashing", "splitting", "crushing", "reload"].includes(key) ? parsed[2]?.match(/\d+/)?.[0] : null;
    return value == null ? key : `${key}=${value}`;
  }).filter(Boolean).sort();
  const system = item.system ?? {};
  const storedQualities = [
    ...(system.qualitiesStructured ?? []).map(value => {
      const key = cleanKey(value?.key ?? value);
      return value?.value == null ? key : `${key}=${value.value}`;
    }),
    ...(system.qualitiesTraits ?? []).map(cleanKey),
  ].sort();
  const expected = {
    sourceRule: `${table}: ${name}`,
    damage: pair?.[1] ?? (/\d/.test(damage) ? damage : "0"), damage2: pair?.[2] ?? "0",
    hands: Number(hands.replace("H", "")), enc: Number(enc), price: Number(price),
    reach: reach ? Number(reach[2] ?? reach[1]) : 0, reachMin: reach?.[2] ? Number(reach[1]) : 0,
    range: thrown?.[1]?.includes("/") ? thrown[1] : distance.includes("/") ? distance : "",
    attackMode: table === "Ranged Weapons" || ["Sling", "Bola"].includes(name) ? "ranged" : "melee",
    qualities: expectedQualities,
  };
  const actual = Object.fromEntries(Object.keys(expected).map(key => [key,
    key === "sourceRule" ? sourceRule : key === "qualities" ? storedQualities : system[key]]));
  const differences = Object.keys(expected).filter(key => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]));
  return {
    source: { chapter: 7, page: table === "Ranged Weapons" ? 175 : ["Sling", "Net", "Bola"].includes(name) ? 174 : 173, table, row: name },
    status: differences.length ? "source-fields-differ" : "selected-source-fields-match", actual, expected, differences,
    limitations: damage === "Uses Nat. Weapon"
      ? "Zero damage is a placeholder, not a natural-weapon profile. Configure the wielder's base damage; material, quality and live behavior require review."
      : "Stored values are the source base profile. Material and quality adjustments, other clauses and live behavior require review."
  };
}

/** Compare ammunition against its recorded per-ten material row. */
function compareAmmunitionTable(item, reference, cleanKey) {
  if (item?.type !== "ammunition") return null;
  const name = String(item.name ?? "");
  if (!/(?:Arrows|Bolts)$/i.test(name)) return null;
  let stem = name.replace(/(?:Arrows|Bolts)$/i, "").trim();
  const arrowType = stem.match(/(?:^|\s)(Slashing|Splitting)$/i)?.[1]?.toLowerCase() ?? "none";
  if (arrowType !== "none") stem = stem.replace(/(?:^|\s)(Slashing|Splitting)$/i, "").trim();
  const assumedMaterial = !stem;
  const row = reference.tables?.["Ammunition Materials"]?.slice(1)
    .find(entry => cleanKey(entry[0]) === cleanKey(stem || "Iron"));
  if (!row) return null;
  const [, damage, qualities, enchantment, price] = row;
  const expectedQualities = cleanKey(qualities) === "silvered" ? ["silver"] : cleanKey(qualities) === "magic" ? ["magic"] : [];
  const system = item.system ?? {};
  const actualQualities = [...(system.qualitiesTraits ?? []).map(cleanKey),
    ...(system.qualitiesStructured ?? []).map(value => cleanKey(value?.key ?? value))].sort();
  const expected = { quantity: 10, enc: 0, damage: Number(damage.replace(/[−–—]/g, "-").replace(/[^0-9.+-]/g, "")) || 0,
    enchant_level: Number(enchantment), price: Number(price), arrowType, qualities: expectedQualities };
  const actual = Object.fromEntries(Object.keys(expected).map(key => [key, key === "qualities" ? actualQualities : system[key]]));
  const differences = Object.keys(expected).filter(key => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]));
  return {
    source: { chapter: 7, page: 175, table: "Ammunition Materials", row: row[0], assumedMaterial },
    status: differences.length ? "source-fields-differ" : assumedMaterial ? "fields-match-assumed-iron" : "selected-source-fields-match",
    actual, expected, differences,
    limitations: "Price is per ten shots. Purchase handling, partial quantities, damage, qualities and live attack behavior still require review."
  };
}

/** Compare a normal shield's stored values with its source table row. */
function compareShieldTable(item, reference, cleanKey) {
  if (item?.type !== "shield") return null;
  const row = reference.tables?.Shields?.slice(1).find(entry => cleanKey(entry[0]) === cleanKey(item.name));
  if (!row) return null;
  const [, block, magic, qualities, enc, enchantment, price] = row;
  const generic = Number(magic.match(/\((\d+)\)/)?.[1] ?? magic.match(/^\d+/)?.[0]);
  const typed = magic.match(/(\d+)\s+vs\s+(\w+)/i);
  const weight = cleanKey(qualities.split(",")[0]);
  const system = item.system ?? {};
  const magicQuality = qualities.split(",").some(value => cleanKey(value) === "magic");
  const storedMagic = (system.qualitiesStructured ?? []).some(value => cleanKey(value?.key ?? value) === "magic")
    || (system.qualitiesTraits ?? []).some(value => cleanKey(value) === "magic")
    || String(system.qualities ?? "").split(",").some(value => cleanKey(value) === "magic");
  const expected = { blockRating: Number(block), magic_br: generic,
    magic_brSpecial: typed ? { type: typed[2].toLowerCase(), value: Number(typed[1]), base: generic } : null,
    weightClass: ["light", "medium", "heavy", "superheavy"].includes(weight) ? weight : "none",
    enc: Number(enc), enchant_level: Number(enchantment), price: Number(price), shieldType: "normal", magicQuality };
  const actual = Object.fromEntries(Object.keys(expected).map(key => [key, key === "magicQuality" ? storedMagic : system[key]]));
  const differences = Object.keys(expected).filter(key => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]));
  return { source: { chapter: 7, page: 179, table: "Shields", row: row[0] },
    status: differences.length ? "source-fields-differ" : "selected-source-fields-match", actual, expected, differences,
    limitations: "Static comparison of the normal shield profile only. Blocking, typed protection, shield types and live behavior require review." };
}

const GEAR_SOURCE_ALIASES = Object.freeze({
  meat: "Meat (serving)", pole3m: "Pole (3 meter)", chain3m: "Chain (3 meters)",
  ladderrope3m: "Ladder (rope, 3 meters)", ropehempen20m: "Rope (hempen, 20 meters)",
  ropesilken20m: "Rope (silk, 20 meters)", minerspick: "Pick (miner)", merchantsscale: "Scale (merchant’s)",
  backpacksmall: "Backpack (small) (holds 10 ENC)", backpacklarge: "Backpack (large) (holds 20 ENC)",
  chest20enc: "Chest (holds 20 ENC)", pouch5enc: "Pouch (holds 5 ENC)",
  quiver: "Quiver (holds 30 arrows/bolts)", sack30enc: "Sack (holds 30 ENC, must be carried in at least one hand)",
  hammer: "Hammer/Saw/Mallet/Chisel", saw: "Hammer/Saw/Mallet/Chisel",
  mallet: "Hammer/Saw/Mallet/Chisel", chisel: "Hammer/Saw/Mallet/Chisel",
  torch: "Torch (includes oil)", tent: "Tent (per person)", lock: "Lock (per success threshold)",
  survivalkit: "Survival Kit (tinderbox, knife, etc)", rations: "Rations (2 days)",
  lute: "Lute/Harp", harp: "Lute/Harp", tickets: "Tickets to local Event", booknovel: "Book",
  alchemyfieldkit: "Alchemist (Field) (max depth 4 ingredients)", thievestools: "Thief (lockpicks, probes, etc)",
  cookingtraveltools: "Cooking (travel)", delicatecrafttools: "Delicate Craft (jeweler, cartographer, etc)",
  simplecrafttools: "Simple Craft (potter, carpenter, etc)",
});

/** Compare only unambiguously named gear rows from the recorded Core extracts. */
function compareSimpleGear(item, coreReference, cleanKey) {
  if (!["item", "container"].includes(item?.type)) return null;
  const aliases = GEAR_SOURCE_ALIASES[cleanKey(item.name)];
  const requested = cleanKey(aliases ?? item.name);
  const sections = (coreReference.sections ?? []).filter(section =>
    ["Food & Drink", "Adventuring Gear", "To o l s", "Entertainment & Recreation"].includes(section.name)
      && section.text.startsWith("Type ENC Price"));
  let found = null;
  for (const section of sections) {
    const text = section.text.replace(/must be carried\s*\n\s*in at least one hand/g, "must be carried in at least one hand");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^(.*?)\s+(\d+|\*)\s+(\d+)$/);
      if (match && cleanKey(match[1]) === requested) {
        if (found) return null;
        found = { section, label: match[1], enc: match[2], price: Number(match[3]) };
      }
    }
  }
  if (!found) return null;
  const divisor = cleanKey(item.name) === "rations" ? 2 : 1;
  const expected = { price: found.price / divisor };
  if (found.enc !== "*") expected.enc = Number(found.enc) / divisor;
  const capacity = item.type === "container" && item.name !== "Quiver"
    ? found.label.match(/holds\s+(\d+)\s+ENC/i)?.[1] : null;
  if (capacity) expected.capacityENC = Number(capacity);
  if (item.name === "Quiver") expected.capacityQuantity = 30;
  if (found.enc === "*") expected.portable = false;
  const system = item.system ?? {};
  const inventoryRules = item.flags?.["uesrpg-3ev4"]?.inventoryRules ?? {};
  const actual = Object.fromEntries(Object.keys(expected).map(key => [key,
    key === "capacityENC" ? system.container_enc?.max : key === "capacityQuantity" ? inventoryRules.capacity?.maxQuantity
      : key === "portable" ? inventoryRules.portable : system[key]]));
  const differences = Object.keys(expected).filter(key => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]));
  return { source: { chapter: 7, page: found.section.page, table: found.section.name, row: found.label },
    status: differences.length ? "source-fields-differ" : "selected-source-fields-match", actual, expected, differences,
    limitations: item.name === "Quiver"
      ? "The source limits capacity to arrows or bolts; the current generic ammunition check requires GM judgment. Inventory and live use remain unverified."
      : divisor === 2 ? "Values are per day, half the source's two-day bundle. Quantity, consumption and inventory behavior remain unverified."
        : "Only the stated ENC, price and any listed capacity are compared. Unit interpretation, use, derived values and live behavior require review." };
}

/** Compare common potion prices and their stored catalog selection with Core. */
function compareCommonPotion(item, coreReference, cleanKey) {
  if (item?.type !== "item") return null;
  const match = String(item.name ?? "").match(/^Potion of (Healing|Replenishment|Armor|Magic Armor|Levitation) (I|II|III|IV|V|VI|VII)$/);
  if (!match) return null;
  const [, family, roman] = match;
  const level = ["I", "II", "III", "IV", "V", "VI", "VII"].indexOf(roman) + 1;
  const sectionName = family === "Armor" || family === "Magic Armor"
    ? cleanKey("Potion of Armor or Potion of Magic Armor") : cleanKey(`Potion of ${family}`);
  const section = (coreReference.sections ?? []).find(row => row.page === 185 && cleanKey(row.name) === sectionName);
  const values = section?.text.match(/(?:Price|Cost):\s*([\d ]+)/i)?.[1]?.trim().split(/\s+/).map(Number);
  if (!section || values?.length !== 7) return null;
  const key = { Healing: "heal", Replenishment: "replenish", Armor: "armor", "Magic Armor": "magicArmor", Levitation: "levitate" }[family];
  const system = item.system ?? {};
  const potion = item.flags?.["uesrpg-3ev4"]?.alchemy;
  const effect = potion?.effects?.[0];
  const expected = { enc: 0, price: values[level - 1], kind: "potion", effectCount: 1, effectKey: key, spellLevel: level };
  const actual = { enc: system.enc, price: system.price, kind: potion?.kind, effectCount: potion?.effects?.length,
    effectKey: effect?.effectKey, spellLevel: effect?.spellLevel };
  const differences = Object.keys(expected).filter(field => JSON.stringify(actual[field]) !== JSON.stringify(expected[field]));
  return { source: { chapter: 7, page: 185, table: section.name, row: `${family} ${roman}` },
    status: differences.length ? "source-fields-differ" : "selected-source-fields-match", actual, expected, differences,
    limitations: "This compares price, ENC and catalog identity only. Effect strength, duration, drinking costs, expiry and live behavior still require review." };
}

const CLOTHING_SOURCE_ALIASES = Object.freeze({
  clothingcommon: "Common Clothes (EL 100)", clothingelegant: "Fine Clothes (EL 400)",
  clothingdressgown: "Fine Clothes (EL 400)", travelersclothing: "Traveler’s Clothes (EL 100)", robes: "Robes (EL 400)",
  ringsimple: "Ring (simple, EL 250)", ringelegant: "Ring (fine, EL 500)", ringjeweled: "Ring (jeweled, EL 1000)",
  ringextravagant: "Ring (extravagant, EL 1500)", amuletsimple: "Necklace/Amulet (simple, EL 250)",
  amuletelegant: "Necklace/Amulet (fine, EL 500)", amuletjeweled: "Necklace/Amulet (jeweled, EL 1000)",
  amuletextravagant: "Necklace/Amulet (extravagant, EL 1500)", gemstone: "Gemstone", gemstoneflawless: "Gemstone (Flawless)",
});

/** Compare selected trade-goods fields while preserving values absent from the source. */
function compareTradeGoods(item, coreReference, cleanKey) {
  if (item?.type !== "item") return null;
  const system = item.system ?? {};
  const flags = item.flags?.["uesrpg-3ev4"] ?? {};
  const key = cleanKey(item.name);
  let source = null;
  let expected = null;
  let actual = null;
  let limitations = "Static field comparison only; item use and live behavior remain unverified.";
  const clothingRow = CLOTHING_SOURCE_ALIASES[key];
  if (clothingRow) {
    const section = (coreReference.sections ?? []).find(row => row.name === "Clothing & Jewelry" && row.text.startsWith("Type Price"));
    const line = section?.text.split(/\r?\n/).find(value => cleanKey(value.replace(/\s+\d+$/, "")) === cleanKey(clothingRow));
    const price = line?.match(/\s+(\d+)$/)?.[1];
    if (!price) return null;
    expected = { price: Number(price) };
    actual = { price: system.price };
    const el = clothingRow.match(/EL\s+(\d+)/)?.[1];
    if (el) { expected.enchant_level = Number(el); actual.enchant_level = system.enchant_level; }
    if (!key.startsWith("gemstone")) {
      expected.enc = /^(?:ring|amulet)/.test(key) ? 0 : 1;
      expected.wearable = true;
      actual.enc = system.enc;
      actual.wearable = system.wearable;
      if (expected.enc === 1) { expected.wornEnc = 0; actual.wornEnc = flags.inventoryRules?.wornEnc; }
    } else limitations = "The table establishes price but not loose-gemstone ENC. The existing ENC is preserved as an assumption.";
    source = { chapter: 7, page: 182, table: "Clothing & Jewelry", row: clothingRow };
  } else if (/soul gem/i.test(item.name)) {
    const tier = String(item.name).match(/\b(Petty|Lesser|Common|Greater|Grand|Black)\b/i)?.[1];
    const section = (coreReference.sections ?? []).find(row => row.name === "Soul Gems" && row.page === 183);
    const line = section?.text.split(/\r?\n/).find(value => tier && new RegExp(`^${tier}\\s+(?:White|Any)\\s+\\d+\\s+\\d+$`, "i").test(value));
    const values = line?.match(/^(\w+)\s+(White|Any)\s+(\d+)\s+(\d+)$/i);
    if (!values) return null;
    const filled = /^Filled /i.test(item.name);
    const energy = Number(values[3]);
    expected = { enc: 0, price: Number(values[4]) * (filled ? 2 : 1), maxSoulEnergy: energy,
      soulEnergy: filled ? energy : 0, soulType: values[2].toLowerCase() === "any" ? "black" : "white" };
    actual = { enc: system.enc, price: system.price, maxSoulEnergy: flags.maxSoulEnergy,
      soulEnergy: flags.soulEnergy, soulType: flags.soulType };
    source = { chapter: 7, page: 183, table: "Soul Gems", row: values[1] };
    limitations = "The listed filled variant is treated as completely full. Partial filling, soul eligibility and live use require review.";
  } else if (item.name.startsWith("Alchemy Ingredient - ")) {
    const tier = item.name.slice("Alchemy Ingredient - ".length);
    const section = (coreReference.sections ?? []).find(row => row.name === "Alchemical Ingredients" && row.page === 184);
    const line = section?.text.split(/\r?\n/).find(value => value.startsWith(`${tier} `) && /\s\d+\s+\d+\s+\d+$/.test(value));
    const values = line?.match(/\s(\d+)\s+(\d+)\s+(\d+)$/);
    if (!values) return null;
    expected = { strength: Number(values[1]), depth: Number(values[2]), price: Number(values[3]), kind: "ingredient" };
    actual = { strength: flags.alchemy?.strengthBase, depth: flags.alchemy?.depthBase, price: system.price, kind: flags.alchemy?.kind };
    source = { chapter: 7, page: 184, table: "Alchemical Ingredients", row: tier };
    limitations = "The source extract does not establish ingredient ENC. Retain the existing value as an assumption and select a school before brewing.";
  } else if (item.name === "Potion of Rejuvenate") {
    const section = (coreReference.sections ?? []).find(row => row.page === 185 && /Potion of Rejuvenate\s*\nSpell Level 3, Cost 50 drakes/.test(row.text));
    if (!section) return null;
    expected = { enc: 0, price: 50, effectKey: "rejuvenate", spellLevel: 3 };
    actual = { enc: system.enc, price: system.price, effectKey: flags.alchemy?.effects?.[0]?.effectKey,
      spellLevel: flags.alchemy?.effects?.[0]?.spellLevel };
    source = { chapter: 7, page: 185, table: "Potion of Rejuvenate", row: item.name };
    limitations = "The Stamina-or-Fatigue choice, consumption and live behavior require review.";
  }
  if (!source) return null;
  const differences = Object.keys(expected).filter(field => JSON.stringify(actual[field]) !== JSON.stringify(expected[field]));
  return { source, status: differences.length ? "source-fields-differ" : "selected-source-fields-match", actual, expected, differences, limitations };
}

/** Compare the explicitly listed beast-form natural weapon profiles. */
function compareBeastWeapon(item, coreReference, cleanKey) {
  if (item?.type !== "weapon") return null;
  const profiles = {
    "Werewolf Bite": ["Werewolf", "Fangs", "1d8", ["splitting"]],
    "Were(wolf/boar) Claw": ["Werewolf and Wereboar", "Claws", "1d10", ["slashing"]],
    "Werebear Bite": ["Werebear", "Fangs", "1d10", ["splitting", "crushing"]],
    "Werebear Claw": ["Werebear", "Claws", "1d12", ["slashing", "crushing"]],
    "Wereboar Tusks": ["Wereboar", "Tusks", "1d8", ["slashing"]],
  };
  const profile = profiles[item.name];
  const section = (coreReference.sections ?? []).find(row => row.name === "The Beast Form" && row.page === 123);
  if (!profile || !section || !cleanKey(section.text).includes(cleanKey(`Natural Weapons (${profile[1]}, ${profile[2]} ${profile[3][0]}`))) return null;
  const selected = (item.system?.qualitiesStructured ?? []).map(value => cleanKey(value?.key ?? value))
    .filter(value => profile[3].includes(value));
  const actual = { damage: item.system?.damage, selectedQualities: selected };
  const expected = { damage: profile[2], allowedQualities: profile[3], selectedQualityCount: 1 };
  const differences = [];
  if (actual.damage !== expected.damage) differences.push("damage");
  if (selected.length !== 1 || !profile[3].includes(selected[0])) differences.push("qualityChoice");
  return { source: { chapter: 5, page: 123, table: "The Beast Form", row: `${profile[0]} ${profile[1]}` },
    status: differences.length ? "source-fields-differ" : "selected-source-fields-match", actual, expected, differences,
    limitations: "A listed alternative must be selected in the Item sheet. Shape-change prerequisites, range and live use require review." };
}

/** The general potion ENC rule does not establish a legacy recipe or price. */
function compareLegacyPotion(item, finding) {
  if (item?.type !== "item" || finding?.rule !== "Potions have ENC 0 (general rule)") return null;
  const actual = { enc: item.system?.enc };
  const expected = { enc: 0 };
  const differences = actual.enc === 0 ? [] : ["enc"];
  return { source: { chapter: 7, page: 185, table: "General potion rule", row: item.name },
    status: differences.length ? "source-fields-differ" : "general-rule-only", actual, expected, differences,
    limitations: "The exact legacy potion's recipe, level, effect and price are not established; a retained zero price is not verified as free." };
}

/** Record what the Core extract does and does not establish for special templates and stones. */
function compareSpecialSource(item, coreReference) {
  const rule = item?.flags?.["uesrpg-3ev4"]?.coreSource?.rule;
  const arcane = ["Dark Welkynd Stones", "Varla Stones", "Welkynd Stones", "Welkynd Lanterns"].includes(rule);
  if (arcane) {
    const section = (coreReference.sections ?? []).find(row => row.name === rule && row.chapter === 8);
    if (!section) return null;
    const expected = rule === "Welkynd Lanterns" ? { enc: 1 } : {};
    const actual = { enc: item.system?.enc, price: item.system?.price };
    const differences = Object.keys(expected).filter(key => actual[key] !== expected[key]);
    return { source: { chapter: 8, page: section.page, table: rule, row: item.name },
      status: differences.length ? "source-fields-differ" : "partly-source-supported", actual, expected, differences,
      limitations: rule === "Welkynd Lanterns"
        ? "The source establishes ENC 1 but not a market price. Activation and retained price need GM review."
        : "The source extract does not establish exact market price or numeric ENC. Retain both values as assumptions; activation remains manual." };
  }
  if (rule === "Spell Scrolls") {
    const expected = { consumeOnCast: true };
    const actual = { consumeOnCast: item.system?.consumeOnCast, price: item.system?.price };
    const differences = actual.consumeOnCast === true ? [] : ["consumeOnCast"];
    return { source: { chapter: 7, page: 183, table: rule, row: item.name },
      status: differences.length ? "source-fields-differ" : "intentional-template", actual, expected, differences,
      limitations: "Assign a spell before use. Price depends on the selected spell and Binding Strength; casting, consumption and live use require review." };
  }
  if (rule === "Spell Tomes & Training") return {
    source: { chapter: 7, page: 184, table: rule, row: item.name }, status: "intentional-template",
    actual: { enc: item.system?.enc, price: item.system?.price }, expected: {}, differences: [],
    limitations: "Assign the spell and confirm source-specific price and study time. The retained template price is not a verified universal price."
  };
  return null;
}

/** Check available extracted feature text and talent metadata; execution is separate. */
function compareFeatureExtract(item, source) {
  if (!["talent", "trait", "power"].includes(item?.type)) return null;
  if (!source) return {
    status: "no-unambiguous-extracted-section", source: null,
    limitations: "The feature may have a separately identified parent source; its complete clauses and execution still require review."
  };
  const normalizeText = value => String(value ?? "").replace(/<[^>]+>/g, " ")
    .replace(/&#39;|&#x27;/gi, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/\u0002\s*\n/g, "").replace(/\u0002/g, "")
    .replace(/\uFFFD/g, "'").replace(/\s+/g, " ").trim();
  const descriptionContainsExtract = normalizeText(item.system?.description).includes(normalizeText(source.text));
  const rank = source.text.match(/\b(Novice|Apprentice|Journeyman|Adept|Expert|Master)\s*\(([^)]+)\)/);
  const costs = { novice: 100, apprentice: 200, journeyman: 300, adept: 400, expert: 500, master: 800 };
  const expected = item.type === "talent" && rank
    ? { level: rank[1], governingCharacteristics: rank[2], xpCost: costs[rank[1].toLowerCase()] } : null;
  const actual = expected ? Object.fromEntries(Object.keys(expected).map(key => [key, item.system?.[key]])) : null;
  const differences = expected ? Object.keys(expected).filter(key => actual[key] !== expected[key]) : [];
  return {
    status: descriptionContainsExtract && !differences.length ? "extract-and-selected-metadata-match" : "extract-or-metadata-needs-review",
    source: { chapter: source.chapter, page: source.page, section: source.name },
    descriptionContainsExtract, actual, expected, differences,
    limitations: "A matching extract can contain unrelated text or omit clauses. This comparison does not establish activation, passive effects, costs, choices, outcomes, expiry or runtime execution."
  };
}

/** Human-readable views of the same per-document ledger used by reconciliation. */
function writeReadableAudit(root, ledger, verification, plans, coreReference, cleanKey) {
  const directory = path.join(root, "entries");
  fs.mkdirSync(directory, { recursive: true });
  const groups = Map.groupBy(ledger.entries, entry => entry.pack);
  const documents = new Map(plans.flatMap(plan => plan.output.documents.map(item => [`${plan.output.pack}.${item._id}`, item])));
  const reviewQuestion = entry => {
    const item = documents.get(`${entry.pack}.${entry.id}`);
    if (!item) return "Which source and runtime path establish this Item's behavior?";
    if (entry.unmatchedItemReview) return `${entry.unmatchedItemReview.unresolved} Manual: ${entry.unmatchedItemReview.manual}`;
    if (entry.featureReview) return `Clause review: ${entry.featureReview.clauses.map(clause => clause.manual).join(" ")} See feature-clause-reviews.md for source, configuration, paths and unresolved behavior.`;
    if (!entry.source) return `Which exact Core entry establishes ${entry.name}? ${entry.preservationReason ?? "The existing profile is preserved pending evidence."}`;
    if (entry.pack.endsWith(".powers-talents-traits")) {
      const section = (coreReference.sections ?? []).find(row => row.chapter === entry.source.chapter
        && row.page === entry.source.page && cleanKey(row.name) === cleanKey(entry.name));
      const sourceText = String(section?.text ?? "").replace(/\s+/g, " ").trim();
      const mechanics = sourceText.match(/(?:Novice|Apprentice|Journeyman|Adept|Expert|Master)\s*\([^)]*\)\s*(.*)/i)?.[1] ?? sourceText;
      const excerpt = mechanics.length > 140 ? mechanics.slice(0, 140).replace(/\s+\S*$/, "") + "…" : mechanics;
      return `For ${entry.name} on p. ${entry.source.page}, how are ${excerpt ? `“${excerpt}” and its remaining clauses` : "its source clauses"} implemented, including choices, costs, passive effects and expiry?`;
    }
    const system = item.system ?? {};
    const fields = [];
    for (const key of ["quantity", "enc", "price"]) {
      if (system[key] != null) fields.push(`${key} ${system[key]}`);
    }
    if (item.type === "weapon") {
      for (const key of ["damage", "damage2", "damage3", "hands", "reach", "range", "material"]) {
        if (system[key] != null && system[key] !== "") fields.push(`${key} ${system[key]}`);
      }
    }
    if (["armor", "shield"].includes(item.type)) {
      for (const key of ["armor", "magic_ar", "blockRating"]) if (system[key] != null) fields.push(`${key} ${system[key]}`);
    }
    if (Array.isArray(system.qualitiesTraits) && system.qualitiesTraits.length) fields.push(`qualities ${system.qualitiesTraits.join(", ")}`);
    if (Array.isArray(system.qualitiesStructured) && system.qualitiesStructured.length) fields.push(`structured qualities ${JSON.stringify(system.qualitiesStructured)}`);
    const capacity = item.flags?.["uesrpg-3ev4"]?.inventoryRules?.capacity;
    if (capacity) fields.push(`capacity ${JSON.stringify(capacity)}`);
    return `For ${entry.name} (${entry.source.rule}, p. ${entry.source.page}), do the authored ${fields.join(", ") || "profile"}, purchase unit, material adjustments and applicable qualities match the Core source, and which usage steps remain manual?`;
  };
  const lines = [
    "# Core compendium reconciliation audit", "",
    "**Implementation in progress. This audit is not a completion or release certification.**", "",
    "The immutable baseline contains all 1,715 original entries. Every original identity remains present. The ledger records each field's old and current authored value, additions, source locations, reference repairs, and verification limits.", "",
    "## Scope and source", "",
    "Core Markdown chapters and the complete UESRPG 3e v4 Rules Compendium PDF supplied by the user are the rule sources. The full PDF resolves clipped equipment and spell tables in the extracts. PDF text is reference data; its contents do not provide development instructions.", "",
    "Only the five core Item packs are changed. Creature packs, Homebrew, existing world Items, and existing actor Items are outside the data reconciliation. Reimport corrected compendium entries to update existing imports. Shared runtime calculations can change derived results of existing imports.", "",
    "Current JSON sources contain fields supported by the existing Item models. Obsolete, discarded top-level system fields are removed from those sources and remain recorded in the immutable baseline and field ledger. Native primitive coercions are made explicit; fractional weapon handedness is retained by its corrected numeric field. See [the repeatable authoring workflow](reconciliation-workflow.md).", "",
    "## Inventory of entries", "",
    "| Pack | Original | Current | Added | Original entries changed |", "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const [pack, entries] of groups) {
    const name = pack.split(".").at(-1);
    const showReviewQuestions = ["items-revised", "powers-talents-traits"].includes(name);
    lines.push(`| [${name}](entries/${name}.md) | ${entries.filter(row => row.original).length} | ${entries.length} | ${entries.filter(row => !row.original).length} | ${entries.filter(row => row.original && row.changes.length).length} |`);
    const rows = [`# ${name}`, "", "Configuration reconciliation and native persistence are separate from proof that every mechanical clause executes correctly. The automation column records the remaining limitation; it is not a passing test result.", "",
      ...(showReviewQuestions ? ["The final column is an open, per-Item review question generated from the current authoring data and recorded source reference. It does not claim that the comparison or execution review has been completed.", ""] : []),
      `| ID | Item | Classification | Source | Changed fields | Automation / verification |${showReviewQuestions ? " Open review question |" : ""}`,
      `| --- | --- | --- | --- | --- | --- |${showReviewQuestions ? " --- |" : ""}`];
    for (const entry of entries) {
      const fields = entry.original ? entry.changes.map(change => change.path).filter(field => !field.includes("description")) : ["new source-listed entry"];
      const compact = fields.length > 9 ? fields.slice(0, 9).join(", ") + `; ${fields.length - 9} more (ledger)` : fields.join(", ") || "description/references only or unchanged";
      const comparison = entry.sourceComparison ? `; table fields: ${entry.sourceComparison.status}${entry.sourceComparison.differences.length ? ` (${entry.sourceComparison.differences.join(", ")})` : ""}`
        : entry.featureSourceComparison ? `; extract: ${entry.featureSourceComparison.status}` : "";
      rows.push(`| \`${entry.id}\` | ${cell(entry.name)} | ${cell(entry.status)} | ${cell(sourceLabel(entry))} | ${cell(compact)} | ${cell(entry.automation)}${cell(comparison)}; ${cell(entry.verification.native)}; live: ${cell(entry.verification.live)}${entry.verification.observations.length ? ` (${cell(entry.verification.observations.join(", "))})` : ""}${entry.clauseTrace?.length ? `; ${entry.clauseTrace.length} selected clause trace(s)` : ""}${entry.unmatchedItemReview ? "; unmatched profile reviewed; exact source unresolved" : ""}${entry.featureReview ? "; static clause review; manual or unresolved" : ""} |${showReviewQuestions ? ` ${cell(reviewQuestion(entry))} |` : ""}`);
    }
    fs.writeFileSync(path.join(directory, `${name}.md`), rows.join("\n") + "\n");
  }
  lines.push("", "## Classification counts", "", "| Classification | Entries |", "| --- | ---: |");
  for (const [status, entries] of Map.groupBy(ledger.entries, entry => entry.status)) lines.push(`| ${status} | ${entries.length} |`);
  lines.push("", "## Added source-listed entries", "", "| Pack / ID | Item | Source |", "| --- | --- | --- |");
  for (const entry of ledger.entries.filter(row => !row.original)) lines.push(`| ${entry.pack} / \`${entry.id}\` | ${cell(entry.name)} | ${cell(sourceLabel(entry))} |`);
  lines.push("", "## Preserved entries requiring source review", "",
    "These entries are retained because an exact source-supported profile or recipe has not been established. General rules applied to a legacy variant are identified separately in the ledger. A generic gemstone price, creature trait, or alchemy recipe rule does not establish the price and parameters of every named legacy example.", "",
    "| Pack / ID | Item | Reason |", "| --- | --- | --- |");
  for (const entry of ledger.entries.filter(row => !row.source)) lines.push(`| ${entry.pack} / \`${entry.id}\` | ${cell(entry.name)} | ${cell(entry.preservationReason)} |`);
  const unmatched = ledger.entries.filter(entry => entry.unmatchedItemReview);
  if (unmatched.length) {
    const detail = ["# Unmatched equipment: individual static reviews", "", "The stored profiles are preserved. Each review considers related Core evidence, the actual Item data and its applicable execution path; exact source and native/live behavior remain unresolved.", ""];
    for (const entry of unmatched) {
      const review = entry.unmatchedItemReview;
      detail.push(`## ${entry.name} (\`${entry.id}\`)`, "", `- Source considered: ${review.sourceConsidered}`,
        `- Stored fields: \`${JSON.stringify(review.stored)}\``, `- Paths: ${review.paths.map(path => `\`${path}\``).join(", ")}`, `- Execution: ${review.behavior}`,
        `- Unresolved: ${review.unresolved}`, `- Manual handling: ${review.manual}`, "");
    }
    fs.writeFileSync(path.join(directory, "unmatched-item-reviews.md"), detail.join("\n") + "\n");
    lines.push("", `${unmatched.length} individually identified Items have a static review of the available evidence and stored usage; exact profiles are still unresolved. See [unmatched equipment reviews](entries/unmatched-item-reviews.md).`, "");
  }
  const features = ledger.entries.filter(entry => entry.featureReview);
  if (features.length) {
    const detail = ["# Feature clause reviews", "", "These static reviews record each examined clause and its execution path. Manual procedures and outstanding questions remain; no current change is live verified.", ""];
    for (const entry of features) {
      const review = entry.featureReview;
      const activation = review.workspaceConfiguration.activation ?? {};
      detail.push(`## ${entry.name} (\`${entry.id}\`)`, "", `Source: Chapter ${review.source.chapter}, p. ${review.source.page}. ${String(review.sourceText).replace(/\s+/g, " ").trim()}`, "",
        `Workspace configuration: activation ${activation.enabled ? "enabled" : "disabled"}, type ${activation.actionType ?? "unknown"}, costs ${JSON.stringify(activation.costs ?? {})}, usage ${JSON.stringify(activation.usage ?? {})}, ${review.workspaceConfiguration.effects.length} embedded effect(s). ${review.followupConfiguration ? "The source-only follow-up differs; see the machine-readable review." : "The reviewed follow-up configuration matches these fields."}`, "");
      for (const clause of review.clauses) detail.push(`- **Clause:** ${clause.rule}`, `  - Paths: ${clause.paths.map(path => `\`${path}\``).join(", ")}`, `  - Finding: ${clause.result}`, `  - Manual handling: ${clause.manual}`);
      detail.push("", review.liveVerification, "");
    }
    fs.writeFileSync(path.join(directory, "feature-clause-reviews.md"), detail.join("\n") + "\n");
    lines.push("", `${features.length} features have an individual clause review, with manual or unresolved behavior noted; see [feature clause reviews](entries/feature-clause-reviews.md). This is separate from selected diagnostic traces and does not claim live verification.`, "");
  }
  lines.push("", "## Actual live verification", "",
    `Environment: Foundry ${verification.environment.foundry}, disposable world \`${verification.environment.world}\`. Only selected scenarios have been exercised; native pack persistence does not prove every mechanical clause.`, "",
    "| Scenario | Status | Observation / limitation |", "| --- | --- | --- |");
  for (const observation of verification.observations) lines.push(`| ${cell(observation.id)} | ${cell(observation.status)} | ${cell(observation.observed ?? observation.scope ?? observation.method)}${observation.limitations ? ` ${cell(observation.limitations)}` : ""} |`);
  lines.push("", "Remaining live scenarios:", "");
  for (const pending of verification.pending) lines.push(`- ${pending}`);
  lines.push("", "The additional character-generation log repair and instructions for existing blocked records are documented in [chargen-log-fix.md](chargen-log-fix.md).", "");
  lines.push("", "## Compatibility and unresolved verification", "",
    "Document identities, embedded-effect identities, and pack names are retained. Subtype replacements occur only in the disposable authoring copy through native Item document operations. Bundled databases are copied only after the authoring world closes its databases cleanly; LevelDB bytes are never edited.", "",
    "The worn-armor policy rounds each inventory unit's halved ENC down before multiplying by quantity. A whole suit is one inventory unit. Shields retain their full ENC. Intrinsically zero-ENC objects retain the actor-wide ten-for-one rule; worn ENC-1 clothing does not become an intrinsic-zero object. Existing containment behavior applies one halving to contained physical ENC; the source does not establish additional nested stacking rules.", "",
    "The machine-readable change ledger is [change-ledger.json](change-ledger.json). Selected source-to-configuration and workflow evidence is recorded in [clause-traces.json](clause-traces.json), with the same traces exposed by the Chapter 4 and Chapter 6 diagnostics. Untraced clauses remain unverified. Actual live observations and outstanding scenarios are recorded in [verification.json](verification.json). No automated test suite is created or run. Syntax, lint, schema/catalog, reference, source reconciliation, and release validation are static checks.", "",
    "The overall request remains open until deterministic feature and spell clauses have an executing workflow and manual verification, remaining manual cases have specific source-supported instructions, and all final pack/source comparisons pass. A source match or a catalog status label alone is not execution evidence.", "");
  fs.writeFileSync(path.join(root, "audit.md"), lines.join("\n") + "\n");
}

module.exports = { compareArmorTable, compareWeaponTable, compareAmmunitionTable, compareShieldTable, compareSimpleGear, compareCommonPotion, compareTradeGoods, compareBeastWeapon, compareLegacyPotion, compareSpecialSource, compareFeatureExtract, writeReadableAudit };
