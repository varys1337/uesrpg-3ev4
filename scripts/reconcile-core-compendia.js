"use strict";

// Development-only source reconciliation. This writes JSON authoring sources and
// audit artifacts; compiled compendia are written by Foundry's Document APIs.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { parse } = require("espree");
const { readLiteral } = require("./generate-data-catalogs.js");
const { buildSchemaSeeds } = require("./schema-seeds.js");
const { readPack } = require("./lib/compendium-read.js");
const { findFeatureReference, reconcileBookFeatures, reconcileBookSpells, reconcileOtherCoreItems } = require("./lib/core-rules-reconciliation.js");
const { compareArmorTable, compareWeaponTable, compareAmmunitionTable, compareShieldTable, compareSimpleGear, compareCommonPotion, compareTradeGoods, compareBeastWeapon, compareLegacyPotion, compareSpecialSource, compareFeatureExtract, writeReadableAudit } = require("./lib/core-compendium-audit.js");

const ROOT = path.resolve(__dirname, "..");
const REPORT = path.join(ROOT, "docs/compendium-cleanup");
const CORE = path.join(REPORT, "source-extracts");
const SYSTEM = "uesrpg-3ev4";
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
const seeds = buildSchemaSeeds(JSON.parse(fs.readFileSync(path.join(ROOT, "template.json"), "utf8"))).item;
const reference = JSON.parse(fs.readFileSync(path.join(REPORT, "equipment-reference.json"), "utf8"));
const coreReference = JSON.parse(fs.readFileSync(path.join(REPORT, "core-reference.json"), "utf8"));
const verification = JSON.parse(fs.readFileSync(path.join(REPORT, "verification.json"), "utf8"));
const liveByIdentity = new Map((verification.entryResults ?? []).map(row => [`${row.pack}.${row.id}`, row]));
const observationsById = new Map((verification.observations ?? []).map(row => [row.id, row]));
const nativeVerification = verification.observations.find(row => row.id === "native-pack-write-readback" && row.status === "passed");
const cleanKey = value => String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const clone = value => structuredClone(value);
const number = value => Number(String(value).replace(/[−–—]/g, "-").replace(/[^0-9.+-]/g, "")) || 0;
const stableId = key => crypto.createHash("sha256").update(SYSTEM + ":core:" + key).digest("hex").slice(0, 16);
const html = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const paragraph = value => `<p>${html(value)}</p>`;
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");

function moduleLiteral(relative, name) {
  const ast = parse(fs.readFileSync(path.join(ROOT, relative), "utf8"), { ecmaVersion: "latest", sourceType: "module" });
  const declarations = ast.body.flatMap(statement => statement.declaration?.declarations ?? statement.declarations ?? []);
  const bindings = {};
  for (const node of declarations) {
    if (node.id.name === name) return readLiteral(node.init, bindings);
    // Literal dependencies are resolved without executing the source module.
    try { bindings[node.id.name] = readLiteral(node.init, bindings); } catch { /* unrelated code */ }
  }
  throw new Error(`Missing ${name} in ${relative}`);
}

// The diagnostic module is the single authored source for selected clause
// evidence. Parse its literal data without executing browser runtime code.
const clauseTraces = moduleLiteral("src/utils/dev/core-clause-traces.js", "TRACES");
const tracesByIdentity = new Map(clauseTraces.map(row => [`${row.pack}.${row.id}`, row]));
if (tracesByIdentity.size !== clauseTraces.length) throw new Error("Duplicate clause-trace identity.");
for (const trace of clauseTraces) for (const clause of trace.clauses ?? []) {
  if (!verification.observations.some(row => row.id === clause.verification)) throw new Error(`Missing clause observation: ${clause.verification}`);
  for (const workflow of clause.workflows ?? []) {
    if (!fs.existsSync(path.join(ROOT, workflow.split("#")[0]))) throw new Error(`Missing clause workflow: ${workflow}`);
  }
}

const equipment = Object.fromEntries([
  "ARMOR_PROFILES", "SHIELD_PROFILES", "WEAPON_MATERIAL_RULES_MELEE", "WEAPON_MATERIAL_RULES_RANGED",
  "WEAPON_MATERIAL_RULES_SLING", "AMMO_MATERIAL_RULES",
].map(name => [name, moduleLiteral("src/core/constants/equipment.js", name)]));

function flags(item) {
  item.flags ??= {};
  return item.flags[SYSTEM] ??= {};
}

function mark(item, page, rule, automation = "existing-workflow; manual-runtime-review-required", chapter = 7) {
  flags(item).coreSource = { book: "UESRPG 3e v4 - Rules Compendium", chapter, page, rule };
  return { chapter, page, rule, automation };
}

function retype(item, type) {
  if (item.type === type) return;
  const prior = item.system ?? {};
  item.type = type;
  item.system = clone(seeds[type]);
  for (const key of Object.keys(item.system)) if (Object.hasOwn(prior, key)) item.system[key] = clone(prior[key]);
}

/** Author only fields owned by the current Item models. Old fields remain in the
 * immutable baseline and field ledger, never in a silently discarded authoring lane. */
function normalizeAuthoringData(item) {
  const model = seeds[item.type];
  if (!model) throw new Error(`No Item model for ${item.type}`);
  for (const [key, value] of Object.entries(item.system ?? {})) {
    if (!Object.hasOwn(model, key)) { delete item.system[key]; continue; }
    if (item.type === "armor" && key === "item_cat") continue; // Existing AnyField.
    const initial = model[key];
    if (typeof initial === "string" && value != null && typeof value !== "string") item.system[key] = String(value);
    else if (typeof initial === "number" && typeof value !== "number") {
      if (value == null || value === "") { item.system[key] = null; continue; }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw new Error(`Invalid numeric source ${item._id}.system.${key}`);
      item.system[key] = numeric;
    }
  }
  // v14 ActiveEffect changes persist primitive numeric and boolean values as
  // those types. Keep formulas and parameter expressions as strings.
  for (const effect of item.effects ?? []) for (const change of effect.system?.changes ?? []) {
    if (typeof change.value !== "string") continue;
    const value = change.value.trim();
    if (value === "true" || value === "false") change.value = value === "true";
    else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(Number(value))) change.value = Number(value);
  }
}

function addItem(pack, name, type, system, folder, key = name) {
  let item = pack.documents.find(document => document.name === name);
  if (!item) {
    item = { _id: stableId(pack.pack + ":" + key), name, type, img: "icons/svg/item-bag.svg", folder,
      sort: 0, ownership: { default: 0 }, effects: [], flags: {}, system: clone(seeds[type]) };
    pack.documents.push(item);
  }
  Object.assign(item.system, clone(system));
  return item;
}

function reconcileSkills(pack, findings) {
  const text = fs.readFileSync(path.join(CORE, "Chapter 3 - Skills.md"), "utf8");
  const table = text.match(/\| Skill \| Governing Characteristics \|\r?\n([\s\S]*?)(?:\r?\n){2}/)?.[1];
  if (!table) throw new Error("The Chapter 3 governing-characteristics table is unavailable.");
  const characteristic = { Strength: "str", Endurance: "end", Agility: "agi", Intelligence: "int",
    Willpower: "wp", Perception: "prc", Personality: "prs", Luck: "lck" };
  for (const line of table.split(/\r?\n/).filter(line => line.startsWith("| ") && !line.includes("---"))) {
    const [name, governing] = line.split("|").slice(1, 3).map(value => value.trim());
    const keys = governing.split(/, */).map(value => characteristic[value]).filter(Boolean);
    const type = name === "Combat Style [Field]" ? "combatStyle" : "skill";
    const item = pack.documents.find(document => document.name === name)
      ?? addItem(pack, name, type, {}, pack.folders.find(folder => folder.name === "Skills")?._id ?? null);
    item.system.governingCha = keys.map(key => key.toUpperCase()).join(", ");
    if (!keys.includes(item.system.baseCha)) item.system.baseCha = keys[0] ?? "";
    const heading = text.split(/\r?\n/).find(value => value.startsWith("#### ") && value.includes(name + " ("));
    if (heading) {
      const start = text.indexOf(heading) + heading.length;
      const section = text.slice(start).split(/\r?\n#{1,4} /)[0].trim();
      // The readable Markdown is kept as source prose, escaped as HTML paragraphs.
      item.system.description = paragraph(`Governing characteristics: ${governing}.`)
        + section.split(/(?:\r?\n){2,}/).map(paragraph).join("");
    }
    const finding = mark(item, null, `Skills table: ${name}; ${governing}`,
      name === "Profession [Field]" ? "field template; select field and governing characteristic before use"
        : "skill TN/governing-characteristic selector/advancement; live verification pending", 3);
    if (["bh3tusY3KpEHksaP", "5ylPj9FtdbIgPwSi"].includes(item._id)) {
      findings.set(item._id, { ...finding, classification: "confirmed-discrepancy-pending-native-rebuild",
        automation: "The governing characteristic is source-backed, but the description retains broad legacy specialization examples. Follow-up revision 20261030-5 authors the page 68 correction; its native rebuild is pending." });
    } else findings.set(item._id, finding);
  }
  const eliteSkills = [
    ["4GutgOf9vIdUcm1u", 206, "Skill: Thu’um (Wp)", ["wp"]],
    ["6O7yQlytNPQLcvcf", 225, "Hemomancy (Wp)", ["wp"]],
    ["AIfZ7DoZ38pxhYMl", 193, "New Skill: Flesh Magic (Int, Wp)", ["int", "wp"]],
    ["BDjfqAKdNCKIGt99", 123, "Bestial Instinct (Str, Ag, Prc)", ["str", "agi", "prc"]],
    ["FFuY3C13QHJ6KSTC", 199, "Skill: Shehai Shen She Ru (Str, Ag, Wp)", ["str", "agi", "wp"]],
    ["FcNvImNhrbTCpnkL", 219, "Skill: Conte Y’ffre (Willpower, Personality)", ["wp", "prs"]],
    ["q3dLIOgUERyZDQ6V", 224, "Nox Arcana (Wp)", ["wp"]],
    ["seLT52UmSzr4r4HY", 219, "Skill: Conte Frostfall (Willpower, Personality)", ["wp", "prs"]],
  ];
  for (const [id, page, rule, governing] of eliteSkills) {
    const item = pack.documents.find(document => document._id === id);
    const source = coreReference.sections.find(section => section.page === page && cleanKey(section.name) === cleanKey(rule));
    if (!item || !source) throw new Error(`Missing verified special skill source: ${rule} (p.${page})`);
    item.system.governingCha = governing.map(key => key.toUpperCase()).join(", ");
    if (!governing.includes(item.system.baseCha)) item.system.baseCha = governing[0];
    item.system.description = paragraph(source.text.replace(/\u0002\n/g, "").replace(/\u0002/g, "").replace(/\n/g, " "));
    findings.set(id, mark(item, page, rule, "governing characteristics and source instructions; elite advancement workflow requires live verification", page === 123 ? 5 : 8));
  }
}

function reconcileBirthsigns(pack, findings) {
  const signs = moduleLiteral("src/ui/sheets/racemenu/data/birthsign-signs.js", "birthsignSigns");
  const assignPath = (target, pathKey, value) => {
    const keys = pathKey.replace(/^system\./, "").split(".");
    let cursor = target;
    for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
    cursor[keys.at(-1)] = clone(value);
  };
  for (const [key, sign] of Object.entries(signs)) for (const cursed of [false, true]) {
    const grants = cursed ? sign.starCursed : sign.items;
    const marker = pack.documents.find(item => item.name === grants[0].name);
    if (!marker) throw new Error(`Missing birthsign marker ${grants[0].name}`);
    const details = [];
    for (const grant of grants) {
      if (grant.desc) details.push(paragraph(grant.desc));
      else if (grant.pack) details.push(paragraph(`Grants ${grant.name}; acquire this power or trait through the birthsign selector.`));
      if (grant.type === "trait") for (const [field, value] of Object.entries(grant.data ?? {})) {
        // Atronach's absorption is configured below alongside its magicka grant.
        if (!field.startsWith("system.trait")) assignPath(marker.system, field, value);
      }
    }
    if (cursed && sign.starCursedChoices) details.push(paragraph(
      `Choose one: ${sign.starCursedChoices.attributes.join(" or ")}; apply ${sign.starCursedChoices.modifier}. The birthsign selector records this choice as a separate penalty trait.`));
    marker.system.description = details.join("");
    if (key === "apprentice" || (key === "lord" && cursed)) {
      Object.assign(marker.system, { traitKey: "weakness", traitParam: key === "lord" ? "fire" : "magic",
        traitValue: key === "lord" ? 2 : cursed ? 3 : 2, fireR: 0, magicR: 0 });
    }
    if (key === "atronach") {
      Object.assign(marker.system, { traitKey: "spellAbsorption", traitValue: 5 });
      const effectId = stableId("birthsign-stunted:" + marker._id);
      if (!marker.effects.some(effect => effect._id === effectId)) marker.effects.push({
        _id: effectId, name: "Stunted Magicka", img: "icons/magic/control/debuff-chains-ropes-purple.webp",
        transfer: true, disabled: false, system: { changes: [] }, statuses: [], duration: {},
        flags: { [SYSTEM]: { magic: { stuntedMagicka: true } } },
      });
      const stuntedEffect = marker.effects.find(effect => effect._id === effectId);
      stuntedEffect.system = { ...stuntedEffect.system, changes: [] };
      delete stuntedEffect.changes;
    }
    if (key === "thief" && cursed) marker.system.description += paragraph(
      "The birthsign selector replaces rolled Luck with 50. This sign is available only after naturally rolling The Thief and cannot be selected by spending Luck.");
    flags(marker).featureConfig = { ...(flags(marker).featureConfig ?? {}), enabled: true };
    findings.set(marker._id, mark(marker, ["warrior", "lady", "steed", "lord"].includes(key) ? 49 : 50,
      `${cursed ? "Star-Cursed " : ""}${sign.name}`,
      "derived bonuses/traits; character-creation grant workflow; live verification pending", 2));
  }
}

function reconcileFeatures(pack, findings, originals) {
  const identities = {
    "7HBkNmACmPKESDsf": ["blind", 0, 92],
    Bkf01VPm7lvsbQ7f: ["powerWell", 0, 93],
    BzHDvzjBD4IaI8Wh: ["starCursed", 0, 94],
    FJnMMla8HqpIjqGK: ["resistNormalWeapons", 0, 93],
    kMoprukjN6r2aeOh: ["summoned", 0, 94],
  };
  for (const [id, [traitKey, traitValue, page]] of Object.entries(identities)) {
    const item = pack.documents.find(document => document._id === id);
    if (!item) throw new Error(`Missing known feature identity ${id}`);
    retype(item, "trait");
    Object.assign(item.system, { traitKey, traitValue });
    flags(item).featureConfig = { ...(flags(item).featureConfig ?? {}), enabled: true };
    const needsParameter = ["powerWell", "resistNormalWeapons"].includes(traitKey);
    if (needsParameter) item.system.description = originals.find(document => document._id === id).system.description
      + paragraph("Template: set X for the specific source that grants this trait before use. A zero value applies no numeric benefit.");
    findings.set(id, mark(item, page, item.name, needsParameter ? "parameterized template; X must be supplied" : "trait identity; runtime verification pending", 4));
  }
  const stunted = pack.documents.find(document => document._id === "tIdDBKkOogirf5eb");
  stunted.name = "Stunted Magicka";
  stunted.system.traitKey = "stuntedMagicka";
  findings.set(stunted._id, mark(stunted, 94, "Stunted Magicka", "natural recovery and spell restraint; saved spelling alias retained in runtime", 4));
}

const qualityNames = {
  slashing: "slashing", splitting: "splitting", crushing: "crushing", reload: "reload",
  concussive: "concussive", duelingweapon: "dueling", exploitweakness: "exploitWeakness",
  small: "small", unwieldy: "unwieldy", shieldsplitter: "shieldSplitter", flail: "flail",
  impaling: "impaling", mounted: "mounted", hooked: "hooked", handtohand: "handToHand",
  entangling: "entangling", thrown: "thrown", snare: "snare", sling: "sling", complex: "complex",
};

function setWeaponProfile(item, row, family) {
  const [name, damage, hands, distance, qualities, enc, price] = row;
  const system = item.system;
  const twoDamages = damage.match(/^(\S+)\s*\(([^)]+)\)/);
  Object.assign(system, { damage: twoDamages?.[1] ?? (/\d/.test(damage) ? damage : "0"),
    damage2: twoDamages?.[2] ?? "0", weapon2H: Boolean(twoDamages), hands: number(hands),
    enc: number(enc), price: number(price), reach: 0, reachMin: 0, range: "", qualities: "",
    qualitiesStructured: [], qualitiesTraits: [], damageInstances: [], qualityLevel: "common" });
  const isRanged = family === "Ranged Weapons" || name === "Sling" || name === "Bola";
  system.attackMode = isRanged ? "ranged" : "melee";
  if (distance.includes("/")) system.range = distance;
  else {
    const reach = distance.match(/(\d+)(?:[–-](\d+))?m/);
    if (reach) { system.reach = Number(reach[2] ?? reach[1]); system.reachMin = reach[2] ? Number(reach[1]) : 0; }
  }
  for (const label of qualities.split(/,\s*(?![^()]*\))/)) {
    const parsed = label.match(/^([^()]+?)(?:\s*\(([^)]+)\))?$/);
    if (!parsed) continue;
    const key = qualityNames[cleanKey(parsed[1])];
    if (!key) throw new Error(`Unknown book weapon quality: ${label}`);
    if (["slashing", "splitting", "crushing", "reload"].includes(key)) {
      const value = parsed[2] ? Number(parsed[2].match(/\d+/)?.[0]) : undefined;
      system.qualitiesStructured.push({ key, enabled: true, ...(value === undefined ? {} : { value }) });
    } else system.qualitiesTraits.push(key);
    if (key === "thrown" && parsed[2]?.includes("/")) system.range = parsed[2];
  }
  const material = String(system.material ?? "standard");
  const ruleTable = name === "Sling" ? equipment.WEAPON_MATERIAL_RULES_SLING
    : (family === "Ranged Weapons" && !system.qualitiesTraits.includes("thrown")
      ? equipment.WEAPON_MATERIAL_RULES_RANGED : equipment.WEAPON_MATERIAL_RULES_MELEE);
  const rule = ruleTable[material];
  if (rule?.enchantLevel !== undefined) system.enchant_level = rule.enchantLevel;
  const reload = system.qualitiesStructured.find(quality => quality.key === "reload")?.value ?? 0;
  system.reloadState = { isLoaded: true, reloadAPCost: reload, requiresReload: reload > 0, reloadProgress: 0 };
  system.description = paragraph(`${name}. Damage ${damage}; ${hands}; ${distance}; ENC ${enc}; base price ${price} drakes.`)
    + paragraph(`Qualities: ${qualities}. Material and quality modifiers are applied to these base statistics once.`);
  return mark(item, family === "Ranged Weapons" ? 175 : name === "Sling" || name === "Net" || name === "Bola" ? 174 : 173,
    `${family}: ${name}`, name === "Bola"
      ? "weapon-profile/material/qualities/reload; Snare sheet, Special Advantage and legacy opposed workflows; selected live scenarios only"
      : "weapon-profile/material/qualities/reload; manual-runtime-review-required");
}

function armorLane(profile) {
  return { armor: profile?.ar ?? 0, magic_ar: profile?.magicARType === "magic" ? profile.magicAR : 0,
    special_ar: profile?.magicARType && profile.magicARType !== "magic" ? profile.magicAR : 0,
    special_ar_type: profile?.magicARType && profile.magicARType !== "magic" ? profile.magicARType : "" };
}

function reconcilePhysical(pack, findings) {
  const folder = name => pack.folders.find(entry => entry.name === name)?._id ?? null;
  const gearFolder = folder("Equipment");
  const weaponRows = ["Melee Weapons table", "Exotic Weapons table", "Utility Weapons", "Ranged Weapons"]
    .flatMap(family => reference.tables[family].slice(1).map(row => ({ row, family })));
  weaponRows.sort((a, b) => b.row[0].length - a.row[0].length);
  const slingMaterials = { "Cloth Sling": "cloth", "Hemp Sling": "hemp", "Leather Sling": "leatherStraps",
    "Netch Leather Sling": "netchLeatherStraps", "Silk Sling": "silk", "Dreugh Hide Sling": "dreughHide", Sling: "cloth" };
  const ammunitionRows = reference.tables["Ammunition Materials"].slice(1);
  const ammoByName = new Map(ammunitionRows.map(row => [cleanKey(row[0]), row]));
  const shieldRows = new Map(reference.tables.Shields.slice(1).map(row => [cleanKey(row[0]), row]));

  for (const item of pack.documents) {
    let result;
    if (item.type === "weapon") {
      item.system.reloadState ??= {};
      item.system.reloadState.reloadProgress ??= 0;
    }
    if (item.type === "armor" && item.system.hitLocations && !flags(item).coverageMode) {
      flags(item).coverageMode = "manual";
    }
    if (["NE7aGY7QAL8ARjWb", "XyNYiQBZKGqznarl"].includes(item._id)) {
      // Preserve the legacy 1–2m range in the system's numeric reach fields.
      Object.assign(item.system, { reachMin: 1, reach: 2 });
    }
    if (["bKfjZAEWub3jK9Oa", "lGdMavApcwJyoEle"].includes(item._id)) {
      item.system.magic_ar = item._id === "bKfjZAEWub3jK9Oa" ? 1 : 2;
    }
    if (item._id === "sboNel7tyDzCdTi2") { item.name = "Dragonbone Halberd"; item.system.material = "dragonbone"; }
    if (item.type === "weapon") {
      if (slingMaterials[item.name]) item.system.material = slingMaterials[item.name];
      const match = weaponRows.find(({ row }) => {
        const names = row[0] === "Throwing Star/Dart" ? ["Throwing Star", "Throwing Dart"] : [row[0]];
        return names.some(name => cleanKey(item.name) === cleanKey(name) || cleanKey(item.name).endsWith(cleanKey(name)));
      });
      if (match) result = setWeaponProfile(item, match.row, match.family);
    }
    const armor = item.name.match(/^(.+?) (Partial|Full) Armor(?: (Head|Body|Left Arm|Right Arm|Left Leg|Right Leg))?$/);
    if (item.type === "armor" && armor) {
      const lane = armor[2].toLowerCase();
      const material = Object.keys(equipment.ARMOR_PROFILES[lane]).find(key => cleanKey(key) === cleanKey(armor[1]));
      const profile = equipment.ARMOR_PROFILES[lane][material];
      if (profile) {
        const location = armor[3];
        Object.assign(item.system, armorLane(profile), { armorClass: lane, material, weightClass: profile.weightClass,
          enc: profile.enc * (location ? 1 : 6), enchant_level: profile.enchantLevel,
          price: location ? (location === "Body" ? profile.priceBody : profile.priceLimb) : profile.priceLimb * 5 + profile.priceBody,
          armorValues: { full: armorLane(equipment.ARMOR_PROFILES.full[material]), partial: armorLane(equipment.ARMOR_PROFILES.partial[material]) },
          hitLocations: Object.fromEntries(["Head", "Body", "LeftArm", "RightArm", "LeftLeg", "RightLeg"].map(key => [key, !location || cleanKey(key) === cleanKey(location)])) });
        result = mark(item, 178, `${armor[2]} ${armor[1]} armor`, "armor-lanes/coverage/ENC; manual-runtime-review-required");
      }
    }
    const shield = shieldRows.get(cleanKey(item.name));
    if (shield) {
      retype(item, "shield");
      const [, br, magic, qualities, enc, el, price] = shield;
      const materialName = cleanKey(item.name.replace(/ Shield$/, "")).replace(/^dreugh$/, "dreughhide");
      const material = Object.keys(equipment.SHIELD_PROFILES).find(key => cleanKey(key) === materialName);
      const profile = equipment.SHIELD_PROFILES[material];
      const genericMagic = profile?.magicBR ?? profile?.magicBRHalf ?? Math.ceil(number(br) / 2);
      Object.assign(item.system, { shieldType: "normal", blockRating: number(br), magic_br: genericMagic,
        enc: number(enc), enchant_level: number(el), price: number(price), material: material ?? "standard",
        weightClass: profile?.weightClass ?? "none", qualities: "", qualitiesStructured: [],
        qualitiesTraits: qualities.includes("Magic") ? ["magic"] : [] });
      delete flags(item).shieldMagicBR;
      item.system.magic_brSpecial = profile?.magicBRSpecial ? { ...profile.magicBRSpecial, base: genericMagic } : null;
      item.system.description = paragraph(`${item.name}: BR ${br}; magic BR ${magic}; ENC ${enc}; EL ${el}; price ${price} drakes.`)
        + paragraph(`Qualities: ${qualities}. Shields do not receive the worn-armor ENC reduction.`);
      result = mark(item, 179, item.name, "shield-BR/typed-BR/ENC; manual-runtime-review-required");
    }
    if (item.type === "ammunition") {
      const name = item.name.replace(/ (?:Slashing|Splitting)?\s*(?:Arrows|Bolts)$/, "");
      const materialRow = ammoByName.get(cleanKey(name));
      const row = materialRow ?? ammunitionRows.find(entry => entry[0] === "Iron");
      const material = Object.keys(equipment.AMMO_MATERIAL_RULES).find(key => cleanKey(key) === cleanKey(row[0]));
      Object.assign(item.system, { enc: 0, damage: number(row[1]), enchant_level: number(row[3]), price: number(row[4]),
        ammoMaterial: material, damageType: "physical", arrowType: /Slashing/.test(item.name) ? "slashing" : /Splitting/.test(item.name) ? "splitting" : "none",
        qualitiesStructured: [], qualitiesTraits: (equipment.AMMO_MATERIAL_RULES[material]?.autoQualities ?? []).map(quality => quality.key) });
      item.system.description = paragraph(`${item.name}. Each shot is ENC 0; ten zero-ENC objects contribute ENC 1 under the bulk rule. Price: ${row[4]} drakes per ten shots. Damage modifier: ${row[1]}; EL ${row[3]}.`);
      result = mark(item, 175, "Ammunition and material table", "ammunition-consumption/material/zero-ENC; manual-runtime-review-required");
    }
    if (result?.rule === "Melee Weapons table: Dagger" && /(?:^| )punch dagger$/i.test(item.name)) {
      // Keep the current source and compiled pack matched until a native rebuild.
      result = { ...result, rule: "Exotic Weapons table: Punch Dagger / Talons",
        classification: "confirmed-discrepancy-pending-native-rebuild",
        automation: "The current Item was matched to the ordinary Dagger row. Its damage, qualities and origin are wrong; source-only revision 20261031-core-review-v7 corrects the profile. Resolve manually until the correction is rebuilt and imported, then configure the wielder's natural-weapon damage." };
    } else if (result?.rule === "Exotic Weapons table: Cestus") {
      result = { ...result, automation: "The source uses the wielder's natural-weapon damage. The zero damage is an unconfigured placeholder; enter the appropriate natural-weapon damage before attacking. Material, quality and talent interactions require live review." };
    }
    if (result) findings.set(item._id, result);
  }

  const gear = [
    ["Ale (Mug)",0,1,180],["Ale (Gallon)",1,3,180],["Meat",0,4,180],["Wine (Common, Pitcher)",1,2,180],["Wine (Fine, Bottle)",1,100,180],
    ["Bread (Loaf)",0,1,180],["Cheese (Hunk)",0,2,180],["Abacus",1,10],["Bedroll",1,20],["Blanket",1,10],
    ["Bottle, Glass",0,20],["Caltrops (Bag of 20)",0,10],["Candle",0,1],["Case (Map/Scroll)",1,10],["Chain (3m)",1,50],
    ["Chalk (Piece)",0,1],["Climber's Kit",2,150],["Crowbar",1,35],["Flask",1,5],["Grappling Hook",0,25],
    ["Hammer",1,15],["Saw",1,15],["Mallet",1,15],["Chisel",1,15],["Healer's Kit",1,75],["Holy Symbol",0,40],
    ["Hourglass",0,250],["Hunting Trap (Small Cage)",4,40],["Hunting Trap (Large Jaws)",6,80],["Ink Bottle",0,50],["Ink Pen",0,1],
    ["Iron Spike",0,1],["Jug",1,1],["Ladder (Rope, 3m)",3,20],["Lantern, Bullseye",1,120],["Lantern, Hooded",1,60],
    ["Lock",0,25],["Magnifying Glass",0,800],["Manacles",1,30],["Mirror (Small)",0,45],["Oil Flask",1,1],
    ["Paper (10 Sheets)",0,3],["Parchment (10 Sheets)",0,2],["Miner's Pick",1,20],["Pole (3m)",1,1],["Pot",2,30],
    ["Rations",0.5,20],["Rope (hempen, 20m)",2,10],["Rope (Silken, 20m)",2,100],["Merchant's Scale",1,65],
    ["Shovel",1,20],["Spyglass",1,1000],["Survival Kit",1,50],["Tent",1,35],["Torch",1,2],["Vial (1 potion)",0,2],
    ["Waterskin (2 Liters)",1,3],["Whistle",0,1],["Alchemy Field Kit",1,500],["Thieves Tools",0,25],
    ["Cooking (Travel) Tools",3,30],["Delicate Craft Tools",1,300],["Simple Craft Tools",5,100],
    ["Dice",0,1,182],["Game Set",1,10,182],["Deck of Cards",0,5,182],["Tickets",0,15,182],["Book",1,100,182],
    ["Book, Novel",1,100,182],["Lute",1,80,182],["Harp",1,80,182],["Drum",2,30,182],["Flute",1,50,182],["Horn",2,100,182],
    ["Gemstone",0,50,182],["Gemstone (Flawless)",0,200,182],
  ];
  for (const [name, enc, price, page = 181] of gear) {
    const item = addItem(pack, name, "item", { enc, price }, gearFolder);
    if (name === "Rations") {
      item.system.consumable = true;
      item.system.description = paragraph("One day of rations. ENC 0.5 and price 20 drakes per day; two days total ENC 1 and cost 40 drakes (book bundle).");
    } else if (/Tools$|Field Kit/.test(name)) {
      item.system.description = paragraph(`${name}. ENC ${enc}; price ${price} drakes. Superior tools grant +10 and inferior tools impose -10 on associated tests; the GM determines applicability.`)
        + (name === "Alchemy Field Kit" ? paragraph("A field kit permits ingredients with a maximum depth of 4.") : "");
    }
    const finding = mark(item, page, name);
    if (["Iron Spike", "Gemstone", "Gemstone (Flawless)"].includes(name) && !String(item.system.description ?? "").trim()) {
      findings.set(item._id, { ...finding, classification: "confirmed-discrepancy-pending-native-rebuild",
        automation: "Source-listed item has an empty description; add the table price and distinguish any unspecified ENC in the next native pack rebuild." });
    } else findings.set(item._id, finding);
  }

  for (const [name, enc, price, maximum] of [
    ["Backpack (Small)",1,20,10],["Backpack (Large)",2,30,20],["Chest (20 ENC)",6,75,20],
    ["Sack (30 ENC)",1,1,30],["Pouch (5 ENC)",0,10,5],["Quiver",1,15,0],
  ]) {
    const item = pack.documents.find(document => document.name === name);
    if (!item) throw new Error(`Expected existing container ${name}`);
    retype(item, "container");
    Object.assign(item.system, { enc, price, container_enc: { ...(item.system.container_enc ?? {}), max: maximum } });
    if (name === "Quiver") flags(item).inventoryRules = { capacity: { maxQuantity: 30, itemTypes: ["ammunition"] } };
    item.system.description = paragraph(name === "Quiver" ? "Holds 30 arrows or bolts. ENC 1; price 15 drakes."
      : `Holds ${maximum} ENC. Halves the effective ENC of contents that reasonably fit. The container's own ENC is ${enc}.`)
      + (name.startsWith("Sack") ? paragraph("The sack must be carried in at least one hand.") : "");
    findings.set(item._id, mark(item, 181, name, "containment/capacity; manual-runtime-review-required"));
  }
  for (const [name, price] of [["Alchemist (Lab)",500],["Smithy",200]]) {
    const item = addItem(pack, name, "item", { price, description: paragraph("This tool set is too large for one person to carry and requires a small space of its own. ENC is not specified numerically by the book.") }, gearFolder);
    flags(item).inventoryRules = { portable: false };
    findings.set(item._id, mark(item,181,name,"workspace reference; not actor-carried"));
  }

  for (const [name, price, el] of [["Clothing - Common",20,100],["Clothing - Elegant",100,400],["Traveler's Clothing",80,100],["Robes",40,400]]) {
    const item = addItem(pack,name,"item",{enc:1,price,enchant_level:el,wearable:true},gearFolder);
    flags(item).inventoryRules = { wornEnc: 0 };
    item.system.wtBonus = 0;
    item.system.description = paragraph(`${name}. ENC 1 when carried, ENC 0 when worn. EL ${el}; price ${price} drakes.`);
    findings.set(item._id,mark(item,182,"Clothing & Jewelry","worn-ENC override; manual-runtime-review-required"));
  }
  const jewelry = [
    ["Ring - Simple",100,250],["Ring - Elegant",300,500],["Ring - Jeweled",1000,1000],["Ring - Extravagant",5000,1500],
    ["Amulet - Simple",200,250],["Amulet - Elegant",600,500],["Amulet - Jeweled",1500,1000],["Amulet - Extravagant",7500,1500],
  ];
  for (const [name,price,el] of jewelry) {
    const item=pack.documents.find(document=>document.name===name);
    Object.assign(item.system,{enc:0,price,enchant_level:el,wearable:true});
    findings.set(item._id,mark(item,182,"Clothing & Jewelry"));
  }
  const gemTiers = { petty:[100,25], lesser:[250,100], common:[500,250], greater:[1000,1000], grand:[1500,2500], black:[1500,5000] };
  for (const item of pack.documents.filter(document=>/soul gem/i.test(document.name))) {
    const tier=Object.keys(gemTiers).find(key=>new RegExp("\\b"+key+"\\b","i").test(item.name));
    if (!tier) continue;
    const [capacity,price]=gemTiers[tier];const filled=/Filled/.test(item.name);
    Object.assign(item.system,{enc:0,price:filled?price*2:price});
    Object.assign(flags(item),{isSoulGem:true,soulTier:tier,soulSize:tier[0].toUpperCase()+tier.slice(1),maxSoulEnergy:capacity,soulEnergy:filled?capacity:0,soulType:tier==="black"?"black":"white"});
    item.system.description=paragraph(`Soul gem: maximum energy ${capacity}; ${tier==="black"?"accepts any soul":"accepts white souls"}. ENC 0. Empty price ${price}; filled price equals empty price plus empty price multiplied by the fraction full.`);
    findings.set(item._id,mark(item,183,"Soul Gems"));
  }
  const ingredientTiers=[["Ubiquitous",2,1,1],["Plentiful",5,2,5],["Common",10,3,10],["Uncommon",15,4,35],["Rare",25,5,100],["Very Rare",50,6,250],["Extremely Rare",100,7,500],["Legendary",200,8,1000]];
  for (const [tier,strength,depth,price] of ingredientTiers) {
    const item=pack.documents.find(document=>document.name==="Alchemy Ingredient - "+tier);
    if (!item) continue;
    item.system.price=price;
    flags(item).alchemy={...(flags(item).alchemy??{}),kind:"ingredient",quality:tier[0].toLowerCase()+tier.slice(1).replace(/ /g,""),strengthBase:strength,depthBase:depth};
    findings.set(item._id,mark(item,184,"Alchemical Ingredients; school must be selected before brewing","ingredient normalization; manual school selection"));
  }

  const roman=["I","II","III","IV","V","VI","VII"];
  const potionFamilies=[
    ["Healing","heal","restoration",[6,15,35,75,200,500,1000],2,0],
    ["Replenishment","replenish","restoration",[10,20,35,75,200,500,1000],3,0],
    ["Armor","armor","alteration",[15,35,125,150,350,500,1000],5,1],
    ["Magic Armor","magicArmor","alteration",[15,35,125,150,350,500,1000],6,1],
    ["Levitation","levitate","alteration",[15,35,125,150,350,500,1000],6,1],
  ];
  for (const [family,effectKey,school,prices,costMultiplier,minutes] of potionFamilies) for (let i=0;i<7;i++) {
    const level=i+1,name=`Potion of ${family} ${roman[i]}`;
    const duration=minutes?{value:minutes,unit:"minutes"}:null;
    const item=addItem(pack,name,"item",{enc:0,price:prices[i],consumable:true},gearFolder);
    flags(item).alchemy={kind:"potion",effects:[{effectSource:"catalog",effectKey,school,spellLevel:level,attributes:minutes?["potion","upkeep"]:["potion"],cost:level*costMultiplier,baseDuration:duration,finalDuration:duration,params:{},toxinOverrides:{}}],backfired:false,backfire:{}};
    const effect=family==="Healing"?`Restores ${2*level} HP.`:family==="Replenishment"?`Restores ${2*level} MP.`
      :family==="Levitation"?`Grants Flyer (${3*level}) for 1 minute.`:`Grants ${level} ${family==="Armor"?"standard":"magic"} AR for 1 minute.`;
    item.system.description=paragraph(effect)+paragraph(`Spell level ${level}. ENC 0; price ${prices[i]} drakes. Consumed when drunk.`);
    findings.set(item._id,mark(item,185,"Common Potions: "+family,"alchemy runtime; manual-runtime-review-required"));
  }
  const rejuvenate=pack.documents.find(item=>item.name==="Potion of Rejuvenate");
  Object.assign(rejuvenate.system,{enc:0,price:50,consumable:true});
  flags(rejuvenate).alchemy={kind:"potion",effects:[{effectSource:"catalog",effectKey:"rejuvenate",school:"restoration",spellLevel:3,attributes:["potion","instant"],cost:16,baseDuration:null,finalDuration:null,params:{},toxinOverrides:{}}],backfired:false,backfire:{}};
  findings.set(rejuvenate._id,mark(rejuvenate,185,"Potion of Rejuvenate","fatigue-or-stamina restoration; manual-runtime-review-required"));

  for (const row of ammunitionRows) {
    const material=row[0],key=Object.keys(equipment.AMMO_MATERIAL_RULES).find(candidate=>cleanKey(candidate)===cleanKey(material));
    const rule=equipment.AMMO_MATERIAL_RULES[key];
    const item=addItem(pack,material+" Bolts","ammunition",{quantity:10,ammoMaterial:key,enc:0,price:number(row[4]),damage:number(row[1]),enchant_level:number(row[3]),arrowType:"none",damageType:"physical",qualitiesTraits:(rule?.autoQualities??[]).map(quality=>quality.key),description:paragraph(`Crossbow ammunition. Price ${row[4]} drakes per ten shots; ENC 0 per shot. EL ${row[3]}; damage modifier ${row[1]}.`)},folder("Ammunition"));
    findings.set(item._id,mark(item,175,"Ammunition: bolts"));
  }
}

function differences(before, after, prefix = "", rows = []) {
  if (JSON.stringify(before) === JSON.stringify(after)) return rows;
  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of new Set([...Object.keys(before),...Object.keys(after)])) differences(before[key],after[key],prefix?prefix+"."+key:key,rows);
  } else rows.push({path:prefix,before:before===undefined?null:before,after:after===undefined?null:after});
  return rows;
}

function buildReferenceIndex(plans) {
  const byUuid = new Map();
  const byName = new Map();
  const legacyUuids = new Map();
  const add = (uuid, name, documentName, pack) => {
    byUuid.set(uuid, { uuid, name, documentName, pack });
    if (["Item", "Actor", "JournalEntry", "Macro", "RollTable"].includes(documentName)) {
      legacyUuids.set(uuid.replace(`.${documentName}.`, "."), uuid);
    }
    const key = cleanKey(name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(byUuid.get(uuid));
  };
  for (const pack of manifest.packs) {
    const plan = plans.find(plan => plan.manifest.name === pack.name);
    const packId = SYSTEM + "." + pack.name;
    if (plan) {
      for (const item of plan.output.documents) {
        const uuid = `Compendium.${packId}.Item.${item._id}`;
        add(uuid, item.name, "Item", packId);
        for (const effect of item.effects ?? []) add(`${uuid}.ActiveEffect.${effect._id}`, effect.name, "ActiveEffect", packId);
      }
      continue;
    }
    for (const row of readPack(pack.path).docs) {
      if (row.key.startsWith("!folders!")) continue;
      const parts = row.key.split("!")[2]?.split(".") ?? [];
      if (row.key.startsWith("!journal.pages!")) {
        add(`Compendium.${packId}.JournalEntry.${parts[0]}.JournalEntryPage.${parts[1]}`, row.name, "JournalEntryPage", packId);
      } else if (parts.length === 1) add(`Compendium.${packId}.${pack.type}.${row._id}`, row.name, pack.type, packId);
    }
  }
  return { byUuid, byName, legacyUuids };
}

function reconcileReferences(item, index, packId) {
  const report = { verified: 0, repaired: [], unresolved: [] };
  const visit = (value, field = "") => {
    if (typeof value === "string") {
      if (field.split(".").includes("_stats")) return value; // Historical import provenance is not a live reference.
      if (value.startsWith("Compendium.") && index.legacyUuids.has(value)) {
        const corrected = index.legacyUuids.get(value);
        report.repaired.push({ field, before: value, after: corrected });
        return corrected;
      }
      if (value.startsWith("Compendium.") && index.byUuid.has(value)) report.verified += 1;
      else if (value.startsWith("Compendium.")) {
        if (/^effects\.\d+\.origin$/.test(field)) {
          const corrected = `Compendium.${packId}.Item.${item._id}`;
          report.repaired.push({ field, before: value, after: corrected });
          return corrected;
        }
        report.unresolved.push({ field, address: value, label: "", candidates: [] });
      }
      return value.replace(/@(UUID|Compendium)\[([^\]]+)\](?:\{([^}]+)\})?/g, (original, kind, address, label) => {
      const uuid = kind === "UUID" ? address : "Compendium." + address;
      if (!uuid.startsWith("Compendium.")) return original;
      if (index.byUuid.has(uuid)) { report.verified += 1; return original; }
      if (index.legacyUuids.has(uuid)) {
        const corrected = index.legacyUuids.get(uuid);
        report.repaired.push({ field, before: address, after: corrected, label });
        return `@UUID[${corrected}]${label === undefined ? "" : `{${label}}`}`;
      }
      const text = (label ?? "").trim();
      let candidates = index.byName.get(cleanKey(text)) ?? [];
      const journalLink = uuid.includes(".JournalEntry.");
      if (journalLink) candidates = candidates.filter(candidate => candidate.documentName.startsWith("JournalEntry"));
      else candidates = candidates.filter(candidate => candidate.documentName === "Item");
      if (candidates.length > 1) {
        const originalPack = uuid.split(".").slice(1, 3).join(".");
        const samePack = candidates.filter(candidate => candidate.pack === originalPack);
        if (samePack.length === 1) candidates = samePack;
      }
      if (candidates.length === 1) {
        report.repaired.push({ field, before: address, after: candidates[0].uuid, label: text });
        return `@UUID[${candidates[0].uuid}]{${text || candidates[0].name}}`;
      }
      // Preserve the visible rule label without retaining a nonworking link.
      report.unresolved.push({ field, address, label: text, candidates: candidates.map(candidate => candidate.uuid) });
      return text || `[unavailable reference: ${address}]`;
    });
    }
    if (Array.isArray(value)) return value.map((entry, index) => visit(entry, `${field}.${index}`));
    if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) {
      value[key] = visit(entry, field ? `${field}.${key}` : key);
    }
    return value;
  };
  visit(item);
  return report;
}

function main() {
  const writeMode=process.argv.includes("--write");
  fs.mkdirSync(REPORT,{recursive:true});
  const packs=manifest.packs.filter(pack=>pack.type==="Item").map(pack=>({manifest:pack,file:path.join(ROOT,"packs/_source",pack.name,"pack.json")}));
  const baselinePath=path.join(REPORT,"baseline.json.gz");
  let baseline;
  if (fs.existsSync(baselinePath)) baseline=JSON.parse(zlib.gunzipSync(fs.readFileSync(baselinePath)).toString("utf8"));
  else {
    baseline=Object.fromEntries(packs.map(pack=>[pack.manifest.name,JSON.parse(fs.readFileSync(pack.file,"utf8"))]));
    if (writeMode) fs.writeFileSync(baselinePath,zlib.gzipSync(JSON.stringify(baseline)));
  }
  const entries=[];
  const preservation = JSON.parse(fs.readFileSync(path.join(REPORT, "legacy-source-review.json"), "utf8"));
  const unmatchedReviews = JSON.parse(fs.readFileSync(path.join(REPORT, "unmatched-item-reviews.json"), "utf8")).entries;
  const unmatchedByIdentity = new Map(unmatchedReviews.map(row => [`${row.pack}.${row.id}`, row]));
  if (unmatchedByIdentity.size !== unmatchedReviews.length) throw new Error("Duplicate unmatched Item review identity.");
  const featureReviews = JSON.parse(fs.readFileSync(path.join(REPORT, "feature-clause-reviews.json"), "utf8")).entries;
  const featureReviewsByIdentity = new Map(featureReviews.map(row => [`${row.pack}.${row.id}`, row]));
  if (featureReviewsByIdentity.size !== featureReviews.length) throw new Error("Duplicate feature review identity.");
  for (const review of unmatchedReviews) for (const workflow of review.paths ?? []) {
    if (!fs.existsSync(path.join(ROOT, workflow.split("#")[0]))) throw new Error(`Missing unmatched Item workflow: ${workflow}`);
  }
  for (const review of featureReviews) for (const clause of review.clauses ?? []) for (const workflow of clause.paths ?? []) {
    if (!fs.existsSync(path.join(ROOT, workflow.split("#")[0]))) throw new Error(`Missing feature review workflow: ${workflow}`);
  }
  const plans = packs.map(pack => {
    const input=JSON.parse(fs.readFileSync(pack.file,"utf8"));const output=clone(input);const findings=new Map();
    if (pack.manifest.name==="items-revised") {
      reconcilePhysical(output,findings);
      reconcileOtherCoreItems(output, findings, { reference: coreReference, mark, flags, paragraph, retype, addItem });
      for (const id of ["GyLmp8hW70yoTjSi", "XyNYiQBZKGqznarl"]) {
        const finding = findings.get(id);
        if (finding) findings.set(id, { ...finding, classification: "confirmed-discrepancy-pending-native-rebuild",
          automation: "Both alternative qualities are present; the Item sheet and damage preparation treat both as selected. Choose exactly one on the Item before attacking. Source-only revision 20261031-core-review-v7 removes the second default quality." });
      }
    }
    if (pack.manifest.name==="core-skills") reconcileSkills(output,findings);
    if (pack.manifest.name==="signs") reconcileBirthsigns(output,findings);
    if (pack.manifest.name==="powers-talents-traits") {
      reconcileFeatures(output,findings,baseline[pack.manifest.name].documents);
      reconcileBookFeatures(output, findings, { reference: coreReference, mark, flags, paragraph });
      const ancestorWrath = findings.get("4BavHaWi0LX93Tgh");
      if (ancestorWrath) findings.set("4BavHaWi0LX93Tgh", { ...ancestorWrath,
        classification: "confirmed-discrepancy-pending-native-rebuild",
        automation: "The current activation is labeled Passive, and its short text misleadingly calls Fire Cloak free. Source-only revision 20261031-core-review-v7 corrects the Secondary Cast Magic label; the source-recognized activation now stops before consuming a use and provides manual instructions." });
      for (const [id, note] of [
        ["X8hD6hE67XwpWlr3", "Bat Form is configured as a Primary instead of a Secondary Action. Source-only revision 20261031-core-review-v7 corrects the action label; the guarded activation requires manual resolution before any cost."],
        ["vaWWvyhufBM7m2GK", "Call of the Wolf is configured to consume a use without the source's 1 AP cost or Panic outcomes. Source-only revision 20261031-core-review-v7 records the AP cost; the guarded activation requires manual resolution and daily tracking before any cost or use."],
        ["CX0JiP2BEJirBvgj", "The Ataxia effect applies its -10 Subterfuge modifier to Intelligence-based tests as well as Agility-based tests. Source-only revision 20261031-core-review-v7 removes that broad modifier and instructs the GM to apply -10 manually only for Agility-based Subterfuge. Existing Items remain unchanged and need GM review."],
        ["zhBCYHTK8gRNQVCE", "The Rockjoint effect reduces the Strength characteristic by 10 instead of reducing Strength Bonus by 1. Source-only revision 20261031-core-review-v7 changes the embedded effect to the bonus modifier; existing Items remain unchanged and need GM review."],
        ["XhVVqW354NKQ0cji", "Common Black Heart Blight stores fixed encumbrance penalties instead of increasing the encumbrance level by 1. Source-only revision 20261031-core-review-v7 changes the effect to the existing encumbrance-level modifier; existing Items remain unchanged and need GM review."]
      ]) {
        const finding = findings.get(id);
        if (finding) findings.set(id, { ...finding, classification: "confirmed-discrepancy-pending-native-rebuild", automation: note });
      }
    }
    if (pack.manifest.name==="spells-revised") {
      reconcileBookSpells(output, findings, { reference: coreReference, mark, flags, paragraph, stableId, clone, seeds });
      const rejuvenate = findings.get("jvx8x8uJTajYCqhV");
      if (rejuvenate) findings.set("jvx8x8uJTajYCqhV", { ...rejuvenate,
        classification: "confirmed-discrepancy-pending-native-rebuild",
        automation: "Runtime now records the source's Stamina-or-Fatigue choice, pending live verification. The current authored legacy preference and recipe text still claim Fatigue is always chosen; follow-up revision 20261030-6 corrects them and awaits a native pack rebuild." });
    }
    for (const item of output.documents) normalizeAuthoringData(item);
    return { ...pack, input, output, findings };
  });
  const referenceIndex = buildReferenceIndex(plans);
  for (const pack of plans) {
    const { input, output, findings } = pack;
    for (const item of output.documents) reconcileReferences(item, referenceIndex, output.pack);
    const sourceHash = crypto.createHash("sha256").update(JSON.stringify(output, null, 2) + "\n").digest("hex");
    const nativeVerified = nativeVerification?.sourceHashes?.[pack.manifest.name] === sourceHash;
    const originals=new Map(baseline[pack.manifest.name].documents.map(item=>[item._id,item]));
    const seen=new Set();
    for (const item of output.documents) {
      if (!item._id || seen.has(item._id)) throw new Error("Duplicate or absent source ID in "+output.pack);
      seen.add(item._id);
      const original=originals.get(item._id);let finding=findings.get(item._id);
      const sourceComparison = compareArmorTable(item, reference, cleanKey)
        ?? compareWeaponTable(item, reference, cleanKey) ?? compareAmmunitionTable(item, reference, cleanKey)
        ?? compareShieldTable(item, reference, cleanKey) ?? compareSimpleGear(item, coreReference, cleanKey)
        ?? compareCommonPotion(item, coreReference, cleanKey) ?? compareTradeGoods(item, coreReference, cleanKey)
        ?? compareBeastWeapon(item, coreReference, cleanKey) ?? compareLegacyPotion(item, finding)
        ?? compareSpecialSource(item, coreReference);
      const featureSourceComparison = pack.manifest.name === "powers-talents-traits"
        ? compareFeatureExtract(item, findFeatureReference(item, coreReference)) : null;
      const unmatchedItemReview = unmatchedByIdentity.get(`${output.pack}.${item._id}`);
      if (unmatchedItemReview && (unmatchedItemReview.name !== item.name
        || unmatchedItemReview.itemSha256 !== crypto.createHash("sha256").update(JSON.stringify(item)).digest("hex"))) {
        throw new Error(`Unmatched Item review is stale: ${output.pack}.${item._id}`);
      }
      const featureReview = featureReviewsByIdentity.get(`${output.pack}.${item._id}`);
      if (featureReview && (featureReview.name !== item.name || ![featureReview.workspaceItemSha256, featureReview.followupItemSha256]
        .includes(crypto.createHash("sha256").update(JSON.stringify(item)).digest("hex")))) {
        throw new Error(`Feature review is stale: ${output.pack}.${item._id}`);
      }
      if (item.type === "armor" && finding && sourceComparison?.differences.includes("magicQuality")) {
        finding = { ...finding, classification: "confirmed-discrepancy-pending-native-rebuild",
          automation: "The stored Magic quality differs from the Core armor table. Source-only revision 20261031-core-review-v7 corrects it; review current imported armor manually against incorporeal attacks until a verified rebuild and reimport." };
      }
      const finalReferences = reconcileReferences(clone(item), referenceIndex, output.pack);
      const baselineReferences = original ? reconcileReferences(clone(original), referenceIndex, output.pack) : null;
      const references = { verifiedFinal: finalReferences.verified, invalidRemaining: finalReferences.unresolved,
        baselineReview: baselineReferences ? { resolvable: baselineReferences.repaired, unavailable: baselineReferences.unresolved } : null };
      const liveEvidence = liveByIdentity.get(`${output.pack}.${item._id}`);
      const currentUnverified = liveEvidence?.observations?.some(id => observationsById.get(id)?.status === "not-run") === true;
      entries.push({pack:output.pack,id:item._id,name:item.name,original:!!original,
        source:finding?{chapter:finding.chapter,page:finding.page,rule:finding.rule}:null,
        status:finding?.classification ?? (finding?"source-configuration-reconciled":"preserved-no-verified-core-counterpart"),
        preservationReason: finding ? null : preservation[`${output.pack}.${item._id}`],
        sourceFields: finding?.sourceFields ?? null,
        ...(sourceComparison ? { sourceComparison } : {}),
        ...(featureSourceComparison ? { featureSourceComparison } : {}),
        ...(unmatchedItemReview ? { unmatchedItemReview } : {}),
        ...(featureReview ? { featureReview } : {}),
        automation:finding?.automation??"not-verified; existing behavior retained",
        clauseTrace: tracesByIdentity.get(`${output.pack}.${item._id}`)?.clauses ?? [],
        references,
        verification:{static: finding?.classification === "source-identified-configuration-pending-native-rebuild"
          ? "source identified; configuration correction pending"
          : finding?.classification === "confirmed-discrepancy-pending-native-rebuild"
            ? "source reviewed; confirmed field correction pending" : finding?"source transformation applied":"not semantically reconciled",
          native: nativeVerified
            ? "native Item API persistence and readback verified" : "NOT VERIFIED for current source hash",
          live: currentUnverified ? "EARLIER SCENARIOS PASSED; CURRENT CHANGES NOT LIVE VERIFIED"
            : liveEvidence ? "SELECTED SCENARIOS PASSED; other clauses NOT RUN" : "NOT RUN",
          observations: liveEvidence?.observations ?? []},
        changes:original?differences(original,item):[{path:"",before:null,after:item}]});
    }
    for (const id of originals.keys()) if(!seen.has(id)) throw new Error("Original item removed: "+id);
    if(writeMode) write(pack.file,output);
    else if(JSON.stringify(input)!==JSON.stringify(output)) throw new Error(pack.manifest.name+" requires source reconciliation; run with --write");
  }
  const summary={originalItems:entries.filter(item=>item.original).length,totalItems:entries.length,
    addedItems:entries.filter(item=>!item.original).length,changedOriginals:entries.filter(item=>item.original&&item.changes.length).length,
    sourceReconciled:entries.filter(item=>item.source && item.status !== "source-identified-configuration-pending-native-rebuild").length,
    sourceIdentifiedPendingConfiguration:entries.filter(item=>item.status === "source-identified-configuration-pending-native-rebuild").length,
    requiresSourceReview:entries.filter(item=>!item.source).length,
    nativePersistenceVerified:entries.filter(item=>item.verification.native.startsWith("native Item API")).length,
    entriesWithSelectedLiveScenarios:entries.filter(item=>item.verification.observations.length).length,
    entriesWithClauseTraces:entries.filter(item=>item.clauseTrace.length).length,
    unmatchedItemsWithStaticReview:entries.filter(item=>item.unmatchedItemReview).length,
    featuresWithClauseReview:entries.filter(item=>item.featureReview).length,
    liveVerification:verification.status === "in-progress" ? "IN PROGRESS; see verification.json for selected scenarios and limits" : "NOT RUN",
    automatedTests:"NOT RUN (user instruction)"};
  for (const entry of entries.filter(row => !row.source)) if (!entry.preservationReason) throw new Error(`Missing explicit preservation classification: ${entry.pack}.${entry.id}`);
  for (const review of unmatchedReviews) if (!entries.some(entry => entry.pack === review.pack && entry.id === review.id && entry.unmatchedItemReview)) {
    throw new Error(`Unmatched Item review refers to an unavailable Item: ${review.pack}.${review.id}`);
  }
  for (const review of featureReviews) if (!entries.some(entry => entry.pack === review.pack && entry.id === review.id && entry.featureReview)) {
    throw new Error(`Feature review refers to an unavailable Item: ${review.pack}.${review.id}`);
  }
  for (const trace of clauseTraces) if (!entries.some(entry => entry.pack === trace.pack && entry.id === trace.id)) {
    throw new Error(`Clause trace refers to an unavailable Item: ${trace.pack}.${trace.id}`);
  }
  const clauseReport = { revision: 1, scope: "Selected clauses only; untraced clauses remain unverified.", entries: clauseTraces };
  const clausePath = path.join(REPORT, "clause-traces.json");
  if(writeMode) {
    const ledger = { revision: 1, summary, entries };
    write(path.join(REPORT,"change-ledger.json"), ledger);
    write(clausePath, clauseReport);
    writeReadableAudit(REPORT, ledger, verification, plans, coreReference, cleanKey);
  } else if (!fs.existsSync(clausePath) || JSON.stringify(JSON.parse(fs.readFileSync(clausePath, "utf8"))) !== JSON.stringify(clauseReport)) {
    throw new Error("Clause trace report requires reconciliation; run with --write.");
  }
  console.log(JSON.stringify(summary,null,2));
}

if(require.main===module)main();
module.exports={differences};
