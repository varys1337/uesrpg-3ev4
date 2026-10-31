"use strict";

// Offline authoring only. Source lookup never runs in an active game world.
const normalize = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const baseName = value => normalize(String(value).replace(/\([^)]*\)/g, ""));
const prose = value => String(value).replace(/\u0002\r?\n/g, "").replace(/\u0002/g, "")
  .replace(/\s+\n/g, "\n").replace(/\uFFFD/g, "'").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
const parameterNote = "Template: supply the source-granted parameter(s) before use. X = 0 applies no numeric benefit.";

function findFeatureReference(item, reference) {
  const aliases = { addictions: "addiction", starwoad: "woad", unnaturalsenses: "unnaturalsenses",
    vampiricdisease: "vampiricdiseases", lycanthropicdisease: "lycanthropicdiseases" };
  const key = aliases[baseName(item.name)] ?? baseName(item.name);
  let matches = reference.sections.filter(section => baseName(section.name) === key);
  const diseaseCategory = item.flags?.["uesrpg-3ev4"]?.disease?.category;
  if (matches.length > 1 && diseaseCategory) matches = matches.filter(section => diseaseCategory === "common"
    ? section.chapter === 5 && /Common/.test(section.name) : section.chapter === 5 && !/Common/.test(section.name));
  if (item.type === "talent") matches = matches.filter(section => section.chapter === 4 || section.chapter === 8);
  else if (item._id === "7HBkNmACmPKESDsf") matches = matches.filter(section => section.chapter === 2);
  else {
    const coreTrait = matches.filter(section => section.page >= 92 && section.page <= 95);
    if (coreTrait.length) matches = coreTrait;
  }
  return matches.length === 1 ? matches[0] : null;
}

function reconcileBookFeatures(pack, findings, { reference, mark, flags, paragraph }) {
  const costs = { novice: 100, apprentice: 200, journeyman: 300, adept: 400, expert: 500, master: 800 };
  const componentRules = [
    ["wsvRIb5sXGBJFc3X", 123, "The Beast Form: Werewolf — Latch On", "free", 0, 1,
      "After a successful werewolf bite results in a grapple, spend 1 SP to treat the bitten hit location as Crippled until that grapple is broken."],
    ["N6Faw6oo9svWrutk", 123, "The Beast Form: Feeding", "secondary", 2, 0,
      "Consuming a creature's corpse takes an extended Secondary Action costing 2 AP. On completion, regain HP equal to that creature's Endurance Bonus. A sufficient feeding requires two standard living creatures, or one black-souled creature's heart, killed by the lycanthrope during the current transformation."],
    ["bDgkogJMl8xSavAG", 123, "The Beast Form: Feeding", "secondary", 3, 0,
      "Consuming a creature's heart takes an extended Secondary Action costing 3 AP. On completion, regain HP equal to twice that creature's Endurance Bonus. This counts as a sufficient feeding only if the creature has a black soul and was killed by the lycanthrope during the current transformation."],
    ["a4X1nyuii5pGvK7T", 124, "Vampirism: The Thirst", "action", 1, 0,
      "To feed, make a standard Fangs attack against a black-souled creature that is restrained, helpless, enthralled, or otherwise susceptible as determined by the GM. Regain HP equal to damage dealt after mitigation. If at least 1 damage is dealt, reduce the target's Endurance score by 10 until after its next long rest and satisfy the vampire's need to feed for one day. Dealing no damage does not count as feeding."],
    ["9oStHySORcA7g0JV", 124, "Vampirism: The Thirst — Exsanguination", "action", 2, 0,
      "If a feeding target meets the conditions for a Coup de Grâce, spend 2 AP to kill it by exsanguination and regain HP equal to its remaining HP. Then lose all remaining AP. This satisfies the vampire's thirst for two days."],
    ["wJ083gfm612PvOUr", 210, "Disarm: Zun (Weapon)", "action", 1, 0,
      "Use the Cast Magic Primary Action and test Thu'um at +0. On success, all characters in a 15-meter cone must pass an Agility test or drop held weapons and shields. The first word has no SP cost; each additional word costs 1 SP. After using a one-word shout, wait one round before using that shout again. Shouting does not provoke an Attack of Opportunity."],
  ];
  for (const [id, page, rule, actionType, ap, sp, text] of componentRules) {
    const item = pack.documents.find(document => document._id === id);
    if (!item) throw new Error(`Missing component power ${id}.`);
    item.system.description = paragraph(text) + paragraph("Manual resolution remains required for the attack or tests, eligibility, and listed consequences. The activation control records the configured cost; it does not confirm that these outcomes occurred.");
    item.system.activation.actionType = actionType;
    Object.assign(item.system.activation.costs, { action_points: ap, stamina: sp });
    item.system.activation.text = { short: text, full: "Resolve the source procedure and confirm all consequences manually." };
    findings.set(id, { ...mark(item, page, rule, "cost configuration corrected; deterministic consequence workflow still requires implementation and live verification", page === 210 ? 8 : 5),
      classification: "source-component-with-pending-automation" });
  }
  for (const item of pack.documents) {
    const source = findFeatureReference(item, reference);
    if (!source) continue;
    const level = source.text.match(/\b(Novice|Apprentice|Journeyman|Adept|Expert|Master)\s*\(([^)]+)\)/);
    if (item.type === "talent" && level) {
      Object.assign(item.system, { level: level[1], governingCharacteristics: level[2], xpCost: costs[level[1].toLowerCase()] });
      const requirements = source.text.match(/Requires(?:\/Replaces)?\s+([^\n]+)/);
      if (requirements) item.system.talentReq = prose(requirements[1]);
    }
    const parameterized = /\((?:[^)]*\b[XxYy]\b[^)]*)\)/.test(source.name);
    if (item.type === "trait") {
      const root = baseName(source.name);
      const keys = { powerwell: "powerWell", naturaltoughness: "naturalToughness", spellabsorption: "spellAbsorption",
        resistnormalweapons: "resistNormalWeapons", silverscarred: "silverScarred", sunscarred: "sunScarred",
        weakbones: "weakBones", stuntedmagicka: "stuntedMagicka", diseaseresistance: "diseaseResistance",
        unnaturalsenses: "unnaturalSenses", naturalweapons: "naturalWeapons" };
      item.system.traitKey = keys[root] ?? root;
      const specific = item.name.match(/^(Resistance|Weakness|Immunity)\s*\(([^)]+)\)/i);
      if (specific) item.system.traitParam = specific[2].toLowerCase();
      if (parameterized) {
        item.system.traitValue = 0;
        for (const field of ["hpBonus", "mpBonus", "spBonus", "lpBonus", "wtBonus", "speedBonus", "iniBonus", "flyBonus", "swimBonus",
          "natToughnessR", "fireR", "frostR", "shockR", "poisonR", "magicR", "diseaseR", "silverR", "sunlightR"]) item.system[field] = 0;
        if (specific && specific[1].toLowerCase() === "immunity") item.system.traitValue = 1;
      }
    }
    // Keep authored effect identities. Parameterized examples must not apply a
    // hardcoded example magnitude before the owning source supplies X.
    if (parameterized && item.type === "trait") for (const effect of item.effects ?? []) effect.disabled = true;
    item.system.description = paragraph(prose(source.text))
      + (parameterized ? paragraph(parameterNote) : "");
    flags(item).featureConfig = { ...(flags(item).featureConfig ?? {}), enabled: true };
    const disease = flags(item).disease;
    if (disease) {
      disease.curable = true;
      disease.stage = Number(item.name.match(/\(Stage (\d)\)/)?.[1] ?? 1);
      // Social Stigma is conditional on the reaction of others. A blanket social
      // test penalty incorrectly affects allies and unrelated situations.
      for (const effect of item.effects ?? []) {
        const changes = effect.system?.changes ?? effect.changes ?? [];
        const filtered = changes.filter(change => change.key !== "system.modifiers.tests.social");
        effect.system = { ...effect.system, changes: filtered };
        delete effect.changes;
        if (baseName(source.name) === "astralvapors") {
          flags(effect).magic = { ...flags(effect).magic, stuntedMagicka: true };
        }
      }
    }
    findings.set(item._id, mark(item, source.page, source.name,
      parameterized ? "parameterized template; runtime clauses require explicit parameter and live verification"
        : "source description and configuration reconciled; executing workflows require live verification", source.chapter));
  }

  // These confirmed source discrepancies remain in the current matching pack
  // and authoring files until a native Foundry rebuild can be completed.
  const pendingPackCorrections = [
    ["Ww7rr26aXuLzr8bV", "Description contains unrelated Chapter 3 text, the Primary Action lacks its 1 AP cost, and the short activation text incorrectly implies every failed Panic test causes flight. Staging revision 20261029-3 corrects the source; a native pack rebuild is still required."],
    ["6fMqxbAYgrajQFCL", "The source's Free Action is configured as Passive; correct the action type in the next native pack rebuild."],
    ["DHdkDCCguwiTDVLW", "The source's Free Action is configured as Passive; correct the action type in the next native pack rebuild."],
    ["FrMBvu2WVLEvHhF0", "The source's Free Action is configured as Passive; correct the action type in the next native pack rebuild."],
    ["HVKf22nMGAtacGLe", "The source's Free Action is configured as Passive and its description includes a separate page quotation; correct both in the next native pack rebuild."],
    ["mxoaAwBJcysTRfAE", "The source's Free Action is configured as Passive; correct the action type in the next native pack rebuild."],
    ["rYvFH2FV4UUPshZD", "The source's Free Action is configured as Passive; correct the action type in the next native pack rebuild."],
    ["sbcOPLJMM61v3a0E", "The source's Free Action is configured as Passive; correct the action type in the next native pack rebuild."],
    ["BfWJnlMiKly0UAf7", "Description contains unrelated Chapter 5 text; remove the spillover in the next native pack rebuild."],
    ["GEcPz5K1B9qjnBFf", "Description contains unrelated Chapter 5 text; remove the spillover in the next native pack rebuild."],
    ["JXmmoHj9R7Q0kA5C", "Description contains unrelated Chapter 5 text; remove the spillover in the next native pack rebuild."],
    ["NxnRdAULVCkG2rwU", "Description contains unrelated Chapter 5 text; remove the spillover in the next native pack rebuild."],
    ["O00VOKv5Kuyb5ZKj", "Description contains unrelated Chapter 5 text; remove the spillover in the next native pack rebuild."],
    ["rJefaGZFsTrCJuX3", "Description contains unrelated Chapter 5 text; remove the spillover in the next native pack rebuild."],
    ["xrpzc0xhIVs8ohVJ", "The Cast Magic action lacks its 1 AP activation cost; correct it in the next native pack rebuild."],
    ["Iw7kDoxEeQaFB6o6", "Description includes a separate page quotation; remove it in the next native pack rebuild."],
    ["9nYtHje0hcLgKIGB", "Description includes a separate page quotation; remove it in the next native pack rebuild."],
  ];
  for (const [id, discrepancy] of pendingPackCorrections) {
    const finding = findings.get(id);
    if (!finding) throw new Error(`Missing source finding for pending pack correction ${id}.`);
    findings.set(id, { ...finding, classification: "confirmed-discrepancy-pending-native-rebuild", automation: discrepancy });
  }
}

function reconcileOtherCoreItems(pack, findings, { reference, mark, flags, paragraph, retype, addItem }) {
  const notes = [
    ["wKyBvxACbg2iP0KT", "Welkynd Stones"], ["6Xh9f6VR31JhdmHE", "Varla Stones"],
    ["12yL60uck70PzoHY", "Dark Welkynd Stones"], ["yKL1Ppw7q0rKaORE", "Welkynd Lanterns"],
  ];
  for (const [id, name] of notes) {
    const item = pack.documents.find(document => document._id === id);
    const source = reference.sections.find(section => section.name === name);
    if (!item || !source) throw new Error(`Missing Core arcane reference ${name}.`);
    item.system.description = paragraph(prose(source.text))
      + paragraph("The Core entry does not specify a market price or numeric ENC (except the lantern's ENC 1). Retained legacy values require GM review.");
    if (name === "Welkynd Lanterns") item.system.enc = 1;
    findings.set(id, { ...mark(item, source.page, name, "source instructions corrected; activation requires implementation and live verification", 8),
      classification: "source-supported-description-with-legacy-values" });
  }
  const scroll = pack.documents.find(item => item._id === "hnZV6JKzLzhGnbNC");
  retype(scroll, "scroll");
  Object.assign(scroll.system, { requireSchoolTraining: false, consumeMagicka: false, consumeOnCast: true });
  scroll.system.description += paragraph("Template: assign the stored spell in the scroll sheet before use. Price is per scroll at the selected spell level and Binding Strength; the table above assumes Binding Strength 3.");
  // Idempotent authored prose; avoid accumulating the template instruction.
  scroll.system.description = scroll.system.description.replace(/(<p>Template: assign the stored spell[\s\S]*?<\/p>)(?:\1)+/g, "$1");
  findings.set(scroll._id, { ...mark(scroll, 183, "Spell Scrolls", "native scroll cast/quantity workflow; select the bound spell before use"), classification: "intentional-template" });
  const tome = pack.documents.find(item => item._id === "gW5hgzbGAffxPXLd");
  const tomeText = "Template: select a conventional spell. Learning from a tome takes days equal to the spell level, spent in practice and study. Training with a teacher takes one fewer day, to a minimum of one hour. The price table also gives training costs.";
  if (!tome.system.description.includes(tomeText)) tome.system.description += paragraph(tomeText);
  findings.set(tome._id, { ...mark(tome, 184, "Spell Tomes & Training", "spell advancement; study/training elapsed time requires GM confirmation"), classification: "intentional-template" });
  const gown = pack.documents.find(item => item._id === "otCmOV4TTcV132jF");
  Object.assign(gown.system, { enc: 1, wearable: true, enchant_level: 400 });
  flags(gown).inventoryRules = { ...flags(gown).inventoryRules, wornEnc: 0 };
  findings.set(gown._id, { ...mark(gown, 182, "Clothing & Jewelry: elegant clothing variant", "shared worn clothing ENC"), classification: "intentional-variant" });
  for (const item of pack.documents) {
    if (!/^Potion of /.test(item.name) || findings.has(item._id)) continue;
    item.system.enc = 0;
    findings.set(item._id, { ...mark(item, 185, "Potions have ENC 0 (general rule)", "legacy potion effect, level and price remain unverified"),
      classification: "legacy-variant-with-general-rule-correction", sourceFields: ["system.enc"] });
  }
  const naturalProfiles = [
    ["ERq3OHWn6tRLOqUe", "Werewolf Bite", "1d8", "splitting", null],
    ["NE7aGY7QAL8ARjWb", "Were(wolf/boar) Claw", "1d10", "slashing", null],
    ["GyLmp8hW70yoTjSi", "Werebear Bite", "1d10", "splitting", "crushing"],
    ["XyNYiQBZKGqznarl", "Werebear Claw", "1d12", "slashing", "crushing"],
  ];
  for (const [id, name, damage, quality, alternative] of naturalProfiles) {
    const item = pack.documents.find(document => document._id === id);
    item.name = name;
    Object.assign(item.system, { damage, enc: 0, hands: 0, isPhysicalObject: false, material: "standard", qualities: "", qualitiesTraits: ["handToHand"],
      qualitiesStructured: [{ key: quality, enabled: true }, ...(alternative ? [{ key: alternative, enabled: false }] : [])] });
    item.system.description = paragraph(`The Beast Form: ${damage} ${quality}${alternative ? " or " + alternative : ""}.`
      + (alternative ? " Choose one of these qualities in the weapon's quality controls; do not apply both to the same attack." : ""));
    findings.set(id, { ...mark(item, 123, "The Beast Form: " + name, "natural weapon qualities; shape-change prerequisites and optional quality choice require confirmation", 5),
      sourceFields: ["system.damage", "system.enc", "system.hands", "system.qualitiesStructured", "system.qualitiesTraits"] });
  }
  const tusks = addItem(pack, "Wereboar Tusks", "weapon", { damage: "1d8", enc: 0, hands: 0, isPhysicalObject: false, attackMode: "melee", material: "standard",
    reloadState: { isLoaded: true, reloadAPCost: 0, requiresReload: false, reloadProgress: 0 },
    reach: 1, qualitiesTraits: ["handToHand"], qualitiesStructured: [{ key: "slashing", enabled: true }],
    description: paragraph("The Beast Form: Wereboar natural weapons (Tusks, 1d8 Slashing). Requires the appropriate beast form.") }, null);
  findings.set(tusks._id, mark(tusks, 123, "The Beast Form: Wereboar", "natural weapon; beast form prerequisite", 5));
}

function resolveSpellSource(item, reference) {
  const name = item.name;
  let wanted = name;
  const aliases = { "Etheral Form": "Ethereal Form", "Conjure Armor": "Conjure [Armor]", "Conjure Weapon": "Conjure [Weapon]",
    "Spell Absorption (Mysticism)": "Spell Absorption", "Resist Magic": "Resistance to Magic" };
  wanted = aliases[name] ?? wanted;
  if (/^Spell Resistance \((Fire|Frost|Shock|Poison)\)$/.test(name) || /^(Fire|Frost|Shock|Poison) Armor$/.test(name)) wanted = "[Type] Armor";
  else if (/^(Fire|Frost|Shock|Poison) Shield$/.test(name)) wanted = "[Type] Shield";
  else if (/^(Fire|Frost|Shock) (Ball|Beam|Bite|Bolt|Cloak|Cone|Rune|Storm)$/.test(name)) wanted = "[Type] " + name.split(" ")[1];
  else if (/^Weakness to (Fire|Frost|Shock|Poison)$/.test(name)) wanted = "Weakness to [Type]";
  else if (/^Resist (Fire|Frost|Shock|Poison)$/.test(name)) wanted = "Resistance to [Type]";
  else if (/^(Fortify|Absorb) (Strength|Endurance|Agility|Intelligence|Willpower|Perception|Personality)$/.test(name)) wanted = name.split(" ")[0] + " [Characteristic]";
  else if (/^Detect (Life|Undead|Magic|Key)$/.test(name)) wanted = "Detect [Type]";
  else if (/^Summon Daedra(?: - )?/.test(name)) wanted = "Summon Daedra";
  else if (/^Summon Construct(?: - )?/.test(name)) wanted = "Summon Construct";
  else if (/^Rite of Undeath:/.test(name)) wanted = "Rite of Undeath";
  let matches = reference.sections.filter(section => normalize(section.name) === normalize(wanted)
    && (section.chapter === 6 || section.chapter === 8));
  const chapter6 = matches.filter(section => section.chapter === 6);
  if (chapter6.length) matches = chapter6;
  if (matches.length > 1) {
    const preferred = matches.filter(section => item.system.school === "conjuration" ? section.page === 134
      : item.system.school === "restoration" ? section.page === 144 : section.page !== 134 && section.page !== 144);
    if (preferred.length === 1) matches = preferred;
  }
  return matches.length === 1 ? matches[0] : null;
}

function parseSpellTable(section) {
  const lines = section.text.split("\n");
  const tableIndex = lines.findIndex(line => /^Level:/.test(line));
  if (tableIndex < 0) return null;
  const levels = lines[tableIndex].slice(6).trim().split(/\s+/).map(Number);
  const costs = lines[tableIndex + 1]?.match(/^Cost:\s*(.*)/)?.[1]?.split(/\s+/).map(Number);
  const strengths = lines[tableIndex + 2]?.match(/^\[Spell Str\]\s*(.*)/)?.[1]?.split(/\s+/) ?? null;
  if (!costs || costs.length !== levels.length || costs.some(value => !Number.isFinite(value))
    || levels.some(value => !Number.isInteger(value) || value < 1 || value > 7)
    || strengths && strengths.length !== levels.length) return null;
  const firstAttribute = lines.slice(0, tableIndex).findIndex(line => /^(Upkeep|Instant|Direct|Ranged\s*\(|Melee\s*\(|AoE\s*\(|Reinforce|Mindlock\s*\(|Attack(?:,|$))/.test(line));
  return { levels, costs, strengths,
    attributes: firstAttribute < 0 ? "" : lines.slice(firstAttribute, tableIndex).join(" "),
    rules: lines.slice(tableIndex + (strengths ? 3 : 2)).join("\n") };
}

function spellDuration(rules, upkeep, strength, fallback) {
  const duration = rules.match(/\b(?:for|within)\s+(1|one|2|two|3|three)\s+(minute|round|hour|day)s?\b/i);
  if (duration) return { value: ({ one: 1, two: 2, three: 3 })[duration[1]] ?? Number(duration[1]), unit: duration[2].toLowerCase() + "s" };
  const scaled = rules.match(/\bfor\s+\[Spell\s*Strength\]\s+(round|minute|hour|day)s?/i);
  if (scaled && Number.isFinite(Number(strength))) return { value: Number(strength), unit: scaled[1].toLowerCase() + "s" };
  if (upkeep) return { value: 1, unit: "rounds" };
  if (fallback?.unit === "permanent") return { value: 0, unit: "permanent" };
  return { value: 0, unit: "instant" };
}

function reconcileBookSpells(pack, findings, { reference, mark, flags, paragraph, stableId, clone, seeds }) {
  for (const [name, templateName] of [
    ["Fire Shield", "Magic Shield"], ["Frost Shield", "Magic Shield"], ["Shock Shield", "Magic Shield"], ["Poison Shield", "Magic Shield"],
    ["Curing Touch", "Cure Disease"], ["Rite of Morpholithic Inscription", "Rite of Focus"], ["Rite of Princely Summoning", "Rite of Conjuring"],
  ]) {
    if (pack.documents.some(item => item.name === name)) continue;
    const source = clone(pack.documents.find(item => item.name === templateName));
    source._id = stableId(pack.pack + ":" + name);
    source.name = name;
    delete source._stats;
    source.flags = {};
    for (const [index, effect] of (source.effects ?? []).entries()) {
      effect._id = stableId(`new-spell:${name}:effect:${index}`);
      delete effect._stats;
    }
    pack.documents.push(source);
  }
  const setPrimaryEffect = (item, changes) => {
    let effect = item.effects?.[0];
    if (!effect) {
      effect = { _id: stableId(`core-spell:${item._id}:effect`), type: "base", img: item.img,
        transfer: false, disabled: false, duration: {}, statuses: [], system: {} };
      item.effects ??= [];
      item.effects.push(effect);
    }
    Object.assign(effect, { name: item.name.replace(/ \(Mysticism\)$/, "") + " — Spell Effect", transfer: false, disabled: false,
      duration: { value: 0, units: "seconds", expiry: null }, system: { ...effect.system, changes } });
    delete effect.changes;
    // Keep original embedded-effect identities while disabling duplicated,
    // obsolete implementations of this same semantic operation.
    for (const duplicate of item.effects.slice(1)) duplicate.disabled = true;
    item.system.engine.effects.recipes = [];
  };
  for (const item of pack.documents) {
    item.system.engine ??= {};
    item.system.engine.resourceRestore ??= clone(seeds.spell.engine.resourceRestore);
    const source = resolveSpellSource(item, reference);
    if (!source) continue;
    if (item._id === "DuhDMjLPq2DuDodg" && source.chapter === 6 && source.page === 152 && source.name === "Soulsnare") {
      // Source is now established, but this workspace's compiled pack still
      // contains the old spell configuration. Keep its authoring data matched
      // until a separate native rebuild can replace both as a set.
      findings.set(item._id, { chapter: 6, page: 152, rule: "Soulsnare",
        classification: "source-identified-configuration-pending-native-rebuild",
        automation: "Ritual identified; old ordinary-spell cost and effect are incorrect. Source-identified runtime copies use the manual ritual route; unrecognized legacy copies require GM review." });
      continue;
    }
    const table = parseSpellTable(source);
    const system = item.system;
    system.engine.stackingPolicy = source.name === "Burden" || /^Summon (Daedra|Construct|Ghost|Wraith)$/.test(source.name) ? "stack" : "replace";
    if (table) {
      const attributes = table.attributes;
      for (const [field, word] of [["isInstant", "Instant"], ["hasUpkeep", "Upkeep"], ["hasReinforce", "Reinforce"],
        ["hasOverload", "Overload"], ["isDirect", "Direct"], ["isAttackSpell", "Attack"]]) system[field] = new RegExp(`\\b${word}\\b`, "i").test(attributes);
      system.attributes = attributes;
      const currentLevels = new Map((system.scaling?.levels ?? []).map(level => [Number(level.level), level]));
      const levels = table.levels.map((level, index) => ({ ...(currentLevels.get(level) ?? {}), level,
        known: currentLevels.get(level)?.known ?? true, cost: table.costs[index],
        ...(table.strengths ? { spellStrengthFormula: table.strengths[index], spellStrength: table.strengths[index] } : {}),
        duration: spellDuration(table.rules, system.hasUpkeep, table.strengths?.[index], system.duration) }));
      system.scaling = { ...system.scaling, levels };
      const selected = levels.find(level => level.level === Number(system.level)) ?? levels[0];
      system.level = selected.level;
      system.cost = selected.cost;
      if (table.strengths) system.spell_str = selected.spellStrengthFormula;
      system.duration = { ...selected.duration, units: clone(seeds.spell.duration.units) };
      if (Object.hasOwn(system.scaling, "costs")) system.scaling.costs = [...table.costs];
      if (Object.hasOwn(system.scaling, "spellStrengths")) system.scaling.spellStrengths = table.strengths?.map(value => Number.isFinite(Number(value)) ? Number(value) : value) ?? [];
      if (Object.hasOwn(system.scaling, "defaultLevel")) Object.assign(system.scaling,
        { defaultLevel: selected.level, defaultCost: selected.cost, defaultSpellStrength: selected.spellStrengthFormula });
      // Source tables are shown explicitly, avoiding stale tables embedded in old prose.
      item.system.description = paragraph(prose(table.rules)) + paragraph(`Attributes: ${attributes || "none"}.`)
        + "<table><thead><tr><th>Level</th><th>MP cost</th><th>Spell Strength</th></tr></thead><tbody>"
        + levels.map(level => `<tr><td>${level.level}</td><td>${level.cost}</td><td>${level.spellStrengthFormula ?? "—"}</td></tr>`).join("")
        + "</tbody></table>";
      const ranged = attributes.match(/Ranged\s*\((\d+)m\)/i);
      const melee = attributes.match(/Melee\s*\((\d+)m\)/i);
      if (ranged || melee) { system.rangeType = ranged ? "ranged" : "melee"; system.range = (ranged ?? melee)[1] + "m"; }
    }
    if (item.name === "Etheral Form") item.name = "Ethereal Form";
    const typeArmor = item.name.match(/^Spell Resistance \((Fire|Frost|Shock|Poison)\)$/);
    if (typeArmor) item.name = typeArmor[1] + " Armor";
    const typedArmor = item.name.match(/^(Fire|Frost|Shock|Poison) Armor$/);
    const resistance = item.name.match(/^Resist (Fire|Frost|Shock|Poison|Magic)$/);
    const strengthValue = "{{effect.flags.uesrpg-3ev4.spellStrengthValue}}";
    const modifier = key => [{ key, type: "add", value: strengthValue, priority: 20 }];
    if (system.engine?.defenseModel === "characteristic" && table?.strengths?.some(value => /^[-+]\d+$/.test(value))) {
      system.engine.characteristicDefense = { ...system.engine.characteristicDefense, modifierMode: "add", modifierFormula: "",
        defenderCharacteristic: item.name === "Fatigue" ? "end" : item.name === "Burden" ? "str" : "wp" };
      system.range = "50m";
      system.rangeType = "none";
    }
    const condition = { Blind: "blinded", Silence: "silenced", Paralyze: "paralyzed", Frenzy: "frenzied", Calm: "calmed" }[item.name];
    if (condition) {
      setPrimaryEffect(item, [{ key: `system.traits.condition.${condition}`, type: "override", value: "true", priority: 50 }]);
      flags(item.effects[0]).condition = { key: condition, value: 1, source: item.name };
      // The timed spell AE owns the condition. A second condition consequence
      // would create a permanent, unlinked duplicate.
      system.engine.consequences.applyCondition = "";
      system.engine.consequences.description = prose(table.rules);
    }
    const characteristic = item.name.match(/^(Fortify|Absorb) (Strength|Endurance|Agility|Intelligence|Willpower|Perception|Personality)$/);
    if (characteristic) {
      const key = { Strength: "str", Endurance: "end", Agility: "agi", Intelligence: "int", Willpower: "wp", Perception: "prc", Personality: "prs" }[characteristic[2]];
      setPrimaryEffect(item, [{ key: characteristic[1] === "Fortify" ? `system.modifiers.characteristics.${key}`
        : `system.modifiers.tests.characteristics.${key}`, type: "add", value: (characteristic[1] === "Absorb" ? "-" : "") + strengthValue, priority: 20 }]);
      if (characteristic[1] === "Fortify") system.engine.targeting = { ...system.engine.targeting, mode: "self", maxTargets: 1 };
    }
    if (item.name === "Burden") {
      system.engine.defenseModel = "characteristic";
      system.engine.characteristicDefense = { ...system.engine.characteristicDefense,
        defenderCharacteristic: "str", modifierMode: "add", modifierFormula: "", onSuccess: "negate", onFailure: "consequences" };
      system.engine.stackingPolicy = "stack";
      system.range = "50m";
      system.rangeType = "none";
      setPrimaryEffect(item, [{ key: "system.modifiers.encumbrance.level", type: "add", value: "1", priority: 20 }]);
    }
    if (item.name === "Feather") {
      setPrimaryEffect(item, [
        { key: "system.modifiers.encumbrance.level", type: "add", value: "-1", priority: 20 },
        { key: "system.modifiers.encumbrance.armorWeightClass", type: "add", value: "-1", priority: 20 },
      ]);
      system.engine.targeting = { ...system.engine.targeting, mode: "self", maxTargets: 1 };
    }
    if (item.name === "Chameleon") {
      setPrimaryEffect(item, []);
      flags(item.effects[0]).condition = { key: "chameleon", value: "-" + strengthValue, source: item.name };
    }
    if (["Armor", "Magic Armor"].includes(item.name) || typedArmor) {
      setPrimaryEffect(item, modifier(typedArmor ? `system.modifiers.combat.magicArmorRating.${typedArmor[1].toLowerCase()}`
        : item.name === "Armor" ? "system.modifiers.combat.armorRating" : "system.modifiers.combat.magicArmorRating"));
    }
    if (resistance) setPrimaryEffect(item, modifier(`system.modifiers.resistance.${resistance[1].toLowerCase()}R`));
    if (/^Spell Absorption(?: \(Mysticism\))?$/.test(item.name) || item.name === "Reflect") {
      setPrimaryEffect(item, [{ key: `system.modifiers.magic.${item.name === "Reflect" ? "spellReflect" : "spellAbsorption"}`,
        type: "override", value: strengthValue, priority: 20 }]);
    }
    if (item.name === "Levitate") setPrimaryEffect(item, [{ key: "system.modifiers.speed.flySpeed", type: "override", value: strengthValue, priority: 20 }]);
    const typedShield = item.name.match(/^(Fire|Frost|Shock|Poison) Shield$/);
    if (typedShield) {
      Object.assign(system, { school: "alteration", hasBuffer: true, buffer: { ...system.buffer,
        type: typedShield[1].toLowerCase(), formula: "SS", freeUpkeepIfRemains: true } });
      setPrimaryEffect(item, []);
    }
    if (item.name === "Curing Touch") {
      system.rangeType = "none";
      system.range = "1m";
      system.engine.targeting = { ...system.engine.targeting, mode: "single", maxTargets: 1 };
      flags(item).chapter6Utility = { kind: "cure-disease", target: "target" };
      for (const effect of item.effects ?? []) effect.disabled = true;
      system.engine.effects.recipes = [];
    }
    if (item.name === "Cure Disease") {
      Object.assign(system, { rangeType: "none", range: "self" });
      system.engine.targeting = { ...system.engine.targeting, mode: "self", maxTargets: 1 };
      flags(item).chapter6Utility = { kind: "cure-disease", target: "self" };
      // An instant cure has no lingering symptom effect of its own.
      for (const effect of item.effects ?? []) effect.disabled = true;
      system.engine.effects.recipes = [];
    }
    if (item.name === "Replenish" || item.name === "Rejuvenate") {
      system.engine.resourceRestore = { enabled: true, kind: item.name === "Rejuvenate" ? "restoreStaminaOrRemoveFatigue" : "restoreResource",
        resource: item.name === "Rejuvenate" ? "stamina" : "magicka", target: "target", amount: item.name === "Rejuvenate" ? "1" : "SS",
        capMode: item.name === "Replenish" ? "castingCost" : "none", cap: "COST", removeFatigueLevels: 1, chat: true };
    }
    const specificSummon = item.name.match(/^Summon (Daedra|Construct) - (.+)$/);
    if (specificSummon) {
      const profileLine = source.text.split("\n").find(line => line.startsWith(specificSummon[2] + " ") && /\d+ \d+ \d+$/.test(line));
      if (profileLine) {
        const [level, cost, strength] = profileLine.match(/(\d+) (\d+) (\d+)$/).slice(1).map(Number);
        Object.assign(system, { level, cost, spell_str: String(strength), mindlockValue: strength,
          isInstant: false, isDirect: false, hasUpkeep: true, isAttackSpell: false,
          attributes: "Upkeep, Mindlock (Spell Strength)", duration: { ...system.duration, value: 1, unit: "rounds" } });
        system.scaling = { ...system.scaling, levels: [{ level, cost, spellStrengthFormula: String(strength), known: true,
          duration: { value: 1, unit: "rounds" } }] };
        if (system.engine?.conjure) system.engine.conjure.summonActors = null;
        if (flags(item).summonProfiles) flags(item).summonProfiles = flags(item).summonProfiles.filter(profile => profile.creature === specificSummon[2]);
      }
    }
    findings.set(item._id, mark(item, source.page, source.name,
      table ? "source table/attributes/duration reconciled; effect and service clauses need live verification"
        : "source-listed ritual or summon profile; service-level verification required", source.chapter));
    flags(item).coreSource.family = baseName(source.name);
    if (item.name.startsWith("Rite of ")) {
      flags(item).coreSource.kind = "ritual";
      item.system.description = paragraph(prose(source.text))
        + paragraph("Ritual procedure: learning requires 25 XP and a book or teacher, with GM permission. Resolve the stated preparations, resources, tests, and consequences; this entry is a ritual reference and does not automatically complete those steps.");
    }
  }
}

module.exports = { findFeatureReference, resolveSpellSource, parseSpellTable, reconcileBookFeatures, reconcileBookSpells, reconcileOtherCoreItems };
