import { shouldHideFromMainInventory } from "./sheet-inventory.js";
import { isShieldItem } from "../../core/items/shield-utils.js";
import { NPC_MAGIC_RANK_LABELS } from "../../core/config/label-catalog.js";
import { createDebugLogger } from "../../utils/debug.js";
import { buildWeaponAmmoControlState } from "./shared/weapon-ammo-control.js";
import { getWeaponCombatCapabilities } from "../../core/combat/combat-utils.js";
import { isReligionWorshipEnabled } from "../../core/homebrew/settings.js";
import { getReligionDomain } from "../../core/religion/domain-registry.js";
import {
  buildInvocationGroupEntries,
  getActorRitualDomainItems,
  getDomainPreparationLimit,
  getPreparedInvocationStoreKeys,
  getRitualDomainKey,
  isDomainSpellItem,
  isInvocationItem,
  isRitualDomainItem,
} from "../../core/religion/ritual-domains.js";
import { getDefaultPietyMax, getWorshipDomainState, getWorshipSystemData } from "../../core/religion/worship-store.js";
import { getOrthodoxFaithBonus } from "../../core/religion/clerical-talents.js";

const _debug = createDebugLogger("shieldDebug", "[UESRPG][ShieldDebug][PrepareItems]");

function _resolveWeaponDistanceDisplay(system = {}) {
  const capabilities = getWeaponCombatCapabilities({ type: "weapon", system });
  if (capabilities.rangedCapable) {
    const range = String(system?.rangeBandsDerivedEffective?.display ?? system?.range ?? "").trim();
    return range || "-";
  }
  const reach = String(system?.reachResolvedLabel ?? system?.reach ?? "").trim();
  return reach || "-";
}

function _buildCastEnchantmentChargeDisplay(item) {
  const systemCharge = item?.system?.charge ?? {};
  const value = Math.max(0, Number(systemCharge?.value ?? 0) || 0);
  const max = Math.max(0, Number(systemCharge?.max ?? 0) || 0);
  if (max <= 0) return "";
  return `${value}/${max}`;
}

/**
 * Categorize Actor-owned Items into sheet-ready buckets.
 *
 * This helper is intentionally pure with respect to document data:
 * it only mutates the transient sheet item objects produced by Foundry's sheet data pipeline.
 *
 * @param {object} sheetData The sheet data object returned by ActorSheet#getData
 * @param {object} [options]
 * @param {boolean} [options.includeSkills=false] Whether to collect "skill" items.
 * @param {boolean} [options.includeMagicSkills=false] Whether to collect "magicSkill" items.
 */
function _buildTraitStackingInfo(traits) {
  const groups = new Map();

  for (const t of traits ?? []) {
    if (!t || t.type !== "trait") continue;
    const key = String(t.system?.traitKey ?? "").trim();
    if (!key) continue;

    const id = t._id ?? t.id;
    if (!id) continue;

    const value = Number(t.system?.traitValue);
    const unit = String(t.system?.traitUnit ?? "").trim();

    const group = groups.get(key) ?? { key, items: [], highestValue: null, unit: "" };
    group.items.push({ id, value, unit });
    if (Number.isFinite(value)) {
      group.highestValue = (group.highestValue == null) ? value : Math.max(group.highestValue, value);
    }
    if (!group.unit && unit) group.unit = unit;
    groups.set(key, group);
  }

  const byId = {};
  for (const group of groups.values()) {
    if (group.items.length < 2) continue;
    for (const entry of group.items) {
      byId[entry.id] = {
        key: group.key,
        count: group.items.length,
        highest: group.highestValue,
        unit: group.unit
      };
    }
  }

  return byId;
}

export function prepareCharacterItems(sheetData, { includeSkills = false, includeMagicSkills = false } = {}) {
  const actorData = sheetData.actor;
  const actorDoc = sheetData?.document ?? null;
  const religionEnabled = isReligionWorshipEnabled();

  // Initialize containers
  const gear = { equipped: [], unequipped: [] };
  const weapon = { equipped: [], unequipped: [] };
  const armor = { equipped: [], unequipped: [] };
  const shield = { equipped: [], unequipped: [] };
  const power = [];
  const trait = [];
  const talent = [];
  const combatStyle = [];
  const spell = [];
  const spellsBySchool = Object.create(null); // Use null prototype to avoid conflicts
  const ammunition = { equipped: [], unequipped: [] };
  const container = [];
  const ritualDomain = religionEnabled ? [] : null;
  const invocation = religionEnabled ? [] : null;

  // Optional categories (PC sheet only)
  const skill = includeSkills ? [] : null;
  const magicSkill = includeMagicSkills ? [] : null;


  // Iterate through items, allocating to containers
  for (const i of sheetData.items ?? []) {
    // Ensure rendering has an image fallback (safe: sheet-only object)
    i.img = i.img || CONST.DEFAULT_TOKEN;
    i.system = i.system ?? {};
    const enchanting = i.flags?.["uesrpg-3ev4"]?.enchanting;
    const extension = i.flags?.["uesrpg-3ev4"]?.itemSpellcasting ?? {};
    const extensionEnabled = extension?.enabled === true;
    const extensionSlots = Array.isArray(extension?.slots) ? extension.slots : [];
    const extensionCanCast = extensionEnabled && extensionSlots.some((s) => s?.enabled !== false);

    const workshopCast = enchanting?.cast ?? {};
    const workshopCanCast = enchanting?.version === 2
      && enchanting?.enchantType === "cast"
      && Array.isArray(workshopCast?.spells)
      && workshopCast.spells.some((s) => s?.enabled !== false);

    i.system.uiHasCastEnchantment = extensionCanCast || workshopCanCast;
    i.system.uiCastEnchantmentCharge = i.system.uiHasCastEnchantment
      ? _buildCastEnchantmentChargeDisplay(i)
      : "";

    // If an item is inside a container, hide it from the main inventory lists.
    // Contained items remain owned by the Actor and are surfaced through the container sheet UI.
    if (shouldHideFromMainInventory(i)) {
      if (String(i?.type ?? "").toLowerCase() === "shield" || isShieldItem(i, { allowLegacy: true })) {
        const cs = i?.system?.containerStats ?? {};
        _debug("shield filtered from main inventory", {
          actorId: actorData?._id ?? actorData?.id ?? null,
          actorName: actorData?.name ?? null,
          itemId: i?._id ?? i?.id ?? null,
          itemName: i?.name ?? null,
          itemType: i?.type ?? null,
          containerStats: {
            contained: cs?.contained === true,
            container_id: String(cs?.container_id ?? ""),
            container_name: String(cs?.container_name ?? ""),
          },
        });
      }
      continue;
    }

    if (i.type === "equipment" || i.type === "item" || i.type === "scroll") {
      i.system?.equipped ? gear.equipped.push(i) : gear.unequipped.push(i);
    } else if (i.type === "weapon") {
      i.system.resolvedDistanceDisplay = _resolveWeaponDistanceDisplay(i.system);
      i.system?.equipped ? weapon.equipped.push(i) : weapon.unequipped.push(i);
    } else if (i.type === "armor") {
      if (isShieldItem(i, { allowLegacy: true })) {
        i.system?.equipped ? shield.equipped.push(i) : shield.unequipped.push(i);
      } else {
        i.system?.equipped ? armor.equipped.push(i) : armor.unequipped.push(i);
      }
    } else if (i.type === "shield") {
      i.system?.equipped ? shield.equipped.push(i) : shield.unequipped.push(i);
    } else if (i.type === "power") {
      power.push(i);
    } else if (i.type === "trait") {
      trait.push(i);
    } else if (i.type === "talent") {
      talent.push(i);
    } else if (i.type === "combatStyle") {
      combatStyle.push(i);
    } else if (i.type === "spell") {
      if (religionEnabled && isDomainSpellItem(i)) {
        i.system.domainSpell = true;
        i.system.domainKey = i.flags?.["uesrpg-3ev4"]?.religion?.domainKey ?? "";
      }
      spell.push(i);
    } else if (includeSkills && i.type === "skill") {
      // Annotate profession metadata (non-persistent, sheet-only).
      // Only the explicit system.isProfession flag governs profession classification;
      // bracket notation in the name must not affect skill visibility.
      i._isProfession = Boolean(i.system?.isProfession);
      i._professionField = i.system?.field ?? "";
      skill.push(i);
    } else if (i.type === "magicSkill") {
      if (religionEnabled && isRitualDomainItem(i)) {
        ritualDomain?.push(i);
      } else if (includeMagicSkills) {
        magicSkill.push(i);
      }
    } else if (religionEnabled && isInvocationItem(i)) {
      invocation?.push(i);
    } else if (i.type === "ammunition") {
      i.system?.equipped ? ammunition.equipped.push(i) : ammunition.unequipped.push(i);
    } else if (i.type === "container") {
      container.push(i);
    }
  }

  // Alphabetically sort all item lists
  /** @type {Array<Array<object>>} */
  const itemCats = [
    gear.equipped,
    gear.unequipped,
    weapon.equipped,
    weapon.unequipped,
    armor.equipped,
    armor.unequipped,
    shield.equipped,
    shield.unequipped,
    power,
    trait,
    talent,
    combatStyle,
    spell,
    ammunition.equipped,
    ammunition.unequipped,
    container,
  ];

  if (includeSkills) itemCats.push(skill);
  if (includeMagicSkills) itemCats.push(magicSkill);
  if (ritualDomain) itemCats.push(ritualDomain);
  if (invocation) itemCats.push(invocation);

  for (const category of itemCats) {
    if (!Array.isArray(category) || category.length <= 1) continue;

    // Spells sort by school; everything else by name.
    if (category === spell) {
      category.sort((a, b) => {
        const nameA = a?.system?.school ?? "";
        const nameB = b?.system?.school ?? "";
        if (nameA > nameB) return 1;
        if (nameA < nameB) return -1;
        return 0;
      });
    } else if (category === invocation) {
      category.sort((a, b) => {
        const circleA = Number(a?.system?.circle ?? 1);
        const circleB = Number(b?.system?.circle ?? 1);
        if (circleA !== circleB) return circleA - circleB;
        const nameA = (a?.name ?? "").toLowerCase();
        const nameB = (b?.name ?? "").toLowerCase();
        if (nameA > nameB) return 1;
        if (nameA < nameB) return -1;
        return 0;
      });
    } else {
      category.sort((a, b) => {
        const nameA = (a?.name ?? "").toLowerCase();
        const nameB = (b?.name ?? "").toLowerCase();
        if (nameA > nameB) return 1;
        if (nameA < nameB) return -1;
        return 0;
      });
    }
  }

  for (const weaponItem of [...weapon.equipped, ...weapon.unequipped]) {
    if (!getWeaponCombatCapabilities(weaponItem).usesAmmo) continue;
    const ammoSource = sheetData?.document ?? sheetData?.actorDocument ?? { items: sheetData.items ?? [] };
    const ammoControl = buildWeaponAmmoControlState(ammoSource, weaponItem);
    weaponItem.system.inlineAmmoLabel = ammoControl.currentAmmoLabel;
    weaponItem.system.inlineAmmoOptions = ammoControl.options;
  }

  // Group spells by school
  for (const s of spell) {
    const school = String(s?.system?.school ?? "").toLowerCase().trim() || "unknown";
    if (!spellsBySchool[school]) {
      spellsBySchool[school] = [];
    }
    spellsBySchool[school].push(s);
  }

  // Sort spells within each school.
  for (const schoolKey in spellsBySchool) {
    spellsBySchool[schoolKey].sort((a, b) => {
      const nameA = (a?.name ?? "").toLowerCase();
      const nameB = (b?.name ?? "").toLowerCase();
      if (nameA > nameB) return 1;
      if (nameA < nameB) return -1;
      return 0;
    });
  }

  // Convert spellsBySchool object to array for proper Handlebars iteration
  const isNpc = actorData?.type === "NPC";
  const normalizeNpcMagicRank = (rank) => {
    const key = String(rank ?? "untrained").trim().toLowerCase();
    if (key === "grandmaster" || key === "legendary") return "master";
    return Object.prototype.hasOwnProperty.call(NPC_MAGIC_RANK_LABELS, key) ? key : "untrained";
  };
  const spellSchools = Object.keys(spellsBySchool).map(school => {
    const spells = spellsBySchool[school];
    const entry = {
      key: school,
      label: school.charAt(0).toUpperCase() + school.slice(1),
      spells: spells,
      count: spells.length
    };
    // NPC-only: attach the per-school effective rank for the dropdown
    if (isNpc) {
      entry.effectiveRank = normalizeNpcMagicRank(actorData?.flags?.["uesrpg-3ev4"]?.npcMagicSchoolRanks?.[school]);
    }
    return entry;
  });

  // NPC-only: provide rank dropdown options for the template (idempotent)
  if (isNpc) {
    actorData.ui = actorData.ui || {};
    if (!actorData.ui.npcMagicRankOptions) {
      actorData.ui.npcMagicRankOptions = NPC_MAGIC_RANK_LABELS;
    }
  }

  // Assign
  actorData.gear = gear;
  actorData.weapon = weapon;
  actorData.armor = armor;
  actorData.shield = shield;
  actorData.power = power;
  actorData.trait = trait;
  actorData.talent = talent;
  actorData.combatStyle = combatStyle;
  actorData.spell = spell;
  // Store spellsBySchool in ui namespace to avoid conflicts with Foundry's mergeObject
  actorData.ui = actorData.ui || {};
  actorData.ui.spellsBySchool = spellsBySchool;
  actorData.ui.traitStackingById = _buildTraitStackingInfo(trait);
  actorData.spellSchools = spellSchools; // Array format for template iteration
  actorData.ammunition = ammunition;
  actorData.container = container;

  if (includeSkills) {
    actorData.skill = skill.filter(i => !i._isProfession);
    actorData.professionSkill = skill.filter(i => i._isProfession);
  }
  if (includeMagicSkills) actorData.magicSkill = magicSkill;

  if (religionEnabled) {
    const worshipData = getWorshipSystemData(actorDoc ?? actorData);
    const primaryDomainKey = String(worshipData?.primaryDomainKey ?? "").trim().toLowerCase()
      || "";
    const ritualDomainItems = actorDoc ? getActorRitualDomainItems(actorDoc) : {};
    const ritualDomainEntries = Array.from(ritualDomain ?? []).map((item) => {
      const domainKey = getRitualDomainKey(item);
      const domain = getReligionDomain(domainKey);
      const storedState = worshipData?.domains?.[domainKey] ?? null;
      const worshipState = storedState ?? getWorshipDomainState(worshipData, domainKey);
      const computedPietyMax = actorDoc
        ? (getDefaultPietyMax(actorDoc, domainKey) + getOrthodoxFaithBonus(actorDoc, domainKey))
        : 0;
      const storedPietyMax = Number(storedState?.piety?.max);
      const effectivePietyMax = Number.isFinite(storedPietyMax)
        ? Math.max(0, storedPietyMax)
        : computedPietyMax;
      const preparedInvocationIds = Array.isArray(worshipState?.preparation?.preparedInvocationIds)
        ? worshipState.preparation.preparedInvocationIds
        : [];
      item.key = domainKey;
      item.label = domain?.label ?? item?.name ?? domainKey;
      item.deityName = String(worshipState?.deityName ?? "").trim();
      item.initiated = worshipState?.initiated === true;
      item.pietyValue = Number(worshipState?.piety?.value ?? 0) || 0;
      item.pietyMax = effectivePietyMax;
      item.pietyBonus = Number(worshipState?.piety?.bonus ?? 0) || 0;
      item.prepLimit = actorDoc ? getDomainPreparationLimit(actorDoc, domainKey) : 0;
      item.preparedCount = preparedInvocationIds.length;
      item.penanceBlocked = worshipState?.penance?.blocked === true;
      item.fastingActive = worshipState?.observances?.fasting?.active === true;
      return item;
    });
    const combinedMagicSkills = includeMagicSkills
      ? [
          ...(Array.isArray(magicSkill) ? magicSkill : []),
          ...ritualDomainEntries,
        ]
      : null;
    if (Array.isArray(combinedMagicSkills) && combinedMagicSkills.length > 1) {
      combinedMagicSkills.sort((a, b) => {
        const labelA = String(a?.name ?? "").toLowerCase();
        const labelB = String(b?.name ?? "").toLowerCase();
        if (labelA > labelB) return 1;
        if (labelA < labelB) return -1;
        return 0;
      });
    }

    const itemById = new Map((sheetData.items ?? []).map((item) => [String(item?._id ?? item?.id ?? ""), item]));
    const invocationGroups = actorDoc
      ? buildInvocationGroupEntries(actorDoc).map((group) => ({
          ...group,
          invocations: group.invocations.map((entry) => {
            const view = itemById.get(String(entry.id)) ?? entry.item ?? {};
            return {
              ...entry,
              ...view,
              _id: view?._id ?? view?.id ?? entry.id,
              id: view?.id ?? entry.id,
              img: view?.img ?? CONST.DEFAULT_TOKEN,
              system: {
                ...(view?.system ?? {}),
                circle: entry.circle,
                pietyCost: entry.pietyCost,
                tnDomainKey: entry.tnDomainKey,
              },
              preparedStoreLabels: entry.preparedIn.map((domainKey) => getReligionDomain(domainKey)?.label ?? domainKey),
              tnDomainKey: entry.tnDomainKey,
              tnDomainLabel: entry.tnDomainLabel,
            };
          }),
        }))
      : [];

    const primaryDomainEntry = ritualDomainEntries.find((entry) => entry.key === primaryDomainKey) ?? null;
    actorData.ritualDomain = ritualDomainEntries;
    actorData.invocation = invocation ?? [];
    actorData.invocationGroups = invocationGroups;
    if (includeMagicSkills) actorData.magicSkill = combinedMagicSkills ?? [];
    actorData.ui.worship = {
      enabled: true,
      available: ritualDomainEntries.length > 0,
      domainCount: ritualDomainEntries.length,
      primaryDomainKey,
      primaryDomainLabel: getReligionDomain(primaryDomainKey)?.label ?? "",
      displayDomainLabel: ritualDomainEntries.length > 1 ? (primaryDomainEntry?.label ?? "No Primary Domain") : "",
      displayPietyValue: primaryDomainEntry?.pietyValue ?? 0,
      displayPietyMax: primaryDomainEntry?.pietyMax ?? 0,
      hasPrimaryDomain: Boolean(primaryDomainEntry),
      invocationCount: invocation?.length ?? 0,
      preparedCount: Array.from(new Set(
        invocationGroups.flatMap((group) => group.invocations.filter((entry) => entry.prepared).map((entry) => entry.id))
      )).length,
      domains: ritualDomainEntries.map((entry) => ({
        key: entry.key,
        label: entry.label,
        deityName: entry.deityName,
        pietyValue: entry.pietyValue,
        pietyMax: entry.pietyMax,
        preparedCount: entry.preparedCount,
        prepLimit: entry.prepLimit,
        initiated: entry.initiated,
        penanceBlocked: entry.penanceBlocked,
        fastingActive: entry.fastingActive,
      })),
      ritualDomainKeys: Object.keys(ritualDomainItems),
      hasConsecrationCandidate: Boolean(actorDoc?.getActiveTokens?.()?.length),
    };
  } else {
    actorData.ritualDomain = [];
    actorData.invocation = [];
    actorData.invocationGroups = [];
    if (includeMagicSkills && !actorData.magicSkill) actorData.magicSkill = [];
    actorData.ui.worship = {
      enabled: false,
      available: false,
      hasPrimaryDomain: false,
      displayDomainLabel: "",
      displayPietyValue: 0,
      displayPietyMax: 0,
      domains: [],
      ritualDomainKeys: [],
    };
  }
}
