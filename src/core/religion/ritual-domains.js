import { getReligionDomain } from "./domain-registry.js";
import {
  RELIGION_FLAG_SCOPE,
  RELIGION_FLAG_KEY,
  RELIGION_INVOCATION_DOMAIN_UNIVERSAL,
  RELIGION_ITEM_KIND,
} from "./constants.js";
import {
  getDefaultPietyMax,
  getHigherGoverningCharacteristicBonus,
  getWorshipDomainState,
  getWorshipSystemData,
} from "./worship-store.js";
import {
  getOrdainedInitiateExtraPreparation,
  getOrthodoxFaithBonus,
  getSplinterFaithPrimaryForDomain,
} from "./clerical-talents.js";
import { getLocalizedInvocationName } from "./religion-i18n.js";

const RANK_TO_NUMBER = Object.freeze({
  untrained: 0,
  novice: 0,
  apprentice: 1,
  journeyman: 2,
  adept: 3,
  expert: 4,
  master: 5,
  grandmaster: 6,
  legendary: 7,
});

function asKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function getReligionItemFlags(item) {
  const raw = item?.flags?.[RELIGION_FLAG_SCOPE]?.[RELIGION_FLAG_KEY];
  return (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
}

function inferRitualDomainKeyFromName(name) {
  const match = String(name ?? "").match(/^ritual\s*\[(.+?)\]$/i);
  if (!match) return "";
  return asKey(match[1]);
}

export function getRitualDomainKey(item) {
  if (!item || item.type !== "magicSkill") return "";
  const flags = getReligionItemFlags(item);
  const explicitKey = asKey(flags.domainKey);
  if (flags.kind === RELIGION_ITEM_KIND.ritualDomain && explicitKey && getReligionDomain(explicitKey)) {
    return explicitKey;
  }
  const inferredKey = inferRitualDomainKeyFromName(item.name);
  return getReligionDomain(inferredKey) ? inferredKey : "";
}

export function isRitualDomainItem(item) {
  return Boolean(getRitualDomainKey(item));
}

export function isInvocationItem(item) {
  return item?.type === "invocation";
}

export function getInvocationCircle(item) {
  const circle = Number(item?.system?.circle ?? item?.system?.pietyCost ?? 1);
  return Math.max(1, Math.min(4, Number.isFinite(circle) ? circle : 1));
}

export function getInvocationDomainKey(item) {
  if (!isInvocationItem(item)) return "";
  const rawKey = asKey(item?.system?.domainKey);
  return rawKey || RELIGION_INVOCATION_DOMAIN_UNIVERSAL;
}

export function getInvocationTNDomainKey(item) {
  if (!isInvocationItem(item)) return "";
  return asKey(item?.system?.tnDomainKey);
}

export function isUniversalInvocation(item) {
  return getInvocationDomainKey(item) === RELIGION_INVOCATION_DOMAIN_UNIVERSAL;
}

export function isDomainSpellItem(item) {
  return item?.type === "spell" && item?.flags?.[RELIGION_FLAG_SCOPE]?.[RELIGION_FLAG_KEY]?.domainSpell === true;
}

export function getDomainSpellDomainKey(item) {
  if (!isDomainSpellItem(item)) return "";
  return asKey(item?.flags?.[RELIGION_FLAG_SCOPE]?.[RELIGION_FLAG_KEY]?.domainKey);
}

export function getActorRitualDomainItems(actor) {
  const out = {};
  for (const item of Array.from(actor?.items ?? [])) {
    const domainKey = getRitualDomainKey(item);
    if (!domainKey) continue;
    out[domainKey] = item;
  }
  return out;
}

export function getActorRitualDomainEntries(actor) {
  const itemsByKey = getActorRitualDomainItems(actor);
  const worship = getWorshipSystemData(actor);
  return Object.entries(itemsByKey).map(([domainKey, item]) => {
    const domain = getReligionDomain(domainKey);
    const pietyMax = getDefaultPietyMax(actor, domainKey) + getOrthodoxFaithBonus(actor, domainKey);
    const worshipState = getWorshipDomainState(worship, domainKey);
    return {
      key: domainKey,
      label: domain?.label ?? item?.name ?? domainKey,
      domain,
      item,
      pietyMax,
      preparationLimitBase: getHigherGoverningCharacteristicBonus(actor, domainKey),
      worship: worshipState,
    };
  });
}

export function getRitualSkillRankNumber(item) {
  const rankKey = asKey(item?.system?.rank) || "untrained";
  return Number(RANK_TO_NUMBER[rankKey] ?? 0);
}

export function getInvocationEligibleStoreDomainKeys(actor, invocationOrDomainKey) {
  const ritualDomainItems = getActorRitualDomainItems(actor);
  const domainKey = typeof invocationOrDomainKey === "string"
    ? asKey(invocationOrDomainKey)
    : getInvocationDomainKey(invocationOrDomainKey);

  if (!domainKey) return [];
  if (domainKey === RELIGION_INVOCATION_DOMAIN_UNIVERSAL) return Object.keys(ritualDomainItems);
  if (ritualDomainItems[domainKey]) return [domainKey];

  const splinterPrimary = getSplinterFaithPrimaryForDomain(actor, domainKey);
  if (splinterPrimary && ritualDomainItems[splinterPrimary]) return [splinterPrimary];
  return [];
}

export function canActorAccessInvocationDomain(actor, domainKey) {
  return getInvocationEligibleStoreDomainKeys(actor, domainKey).length > 0;
}

export function canActorAccessDomainSpell(actor, spell) {
  if (!isDomainSpellItem(spell)) return true;
  return canActorAccessInvocationDomain(actor, getDomainSpellDomainKey(spell));
}

export function getPreparedInvocationStoreKeys(actor, invocationId) {
  const targetId = String(invocationId ?? "").trim();
  if (!targetId) return [];
  const worship = getWorshipSystemData(actor);
  return Object.entries(worship?.domains ?? {})
    .filter(([, state]) => Array.isArray(state?.preparation?.preparedInvocationIds) && state.preparation.preparedInvocationIds.includes(targetId))
    .map(([domainKey]) => domainKey);
}

export function getDomainPreparationLimit(actor, domainKey, { includeOrdainedBonus = true } = {}) {
  const base = Math.max(0, getHigherGoverningCharacteristicBonus(actor, domainKey));
  if (!includeOrdainedBonus) return base;

  const actorInvocations = Array.from(actor?.items ?? []).filter((item) =>
    isInvocationItem(item) && getInvocationDomainKey(item) === asKey(domainKey) && getInvocationCircle(item) === 1
  );
  const hasCircleOneDomainInvocation = actorInvocations.length > 0;
  const ordainedBonus = getOrdainedInitiateExtraPreparation(actor, domainKey, { hasCircleOneDomainInvocation });
  const universalBonus = getOrdainedInitiateExtraPreparation(actor, RELIGION_INVOCATION_DOMAIN_UNIVERSAL, { hasCircleOneDomainInvocation });
  return Math.max(0, base + ordainedBonus + universalBonus);
}

export function buildInvocationGroupEntries(actor) {
  const worship = getWorshipSystemData(actor);
  const groupsByKey = new Map();

  for (const item of Array.from(actor?.items ?? [])) {
    if (!isInvocationItem(item)) continue;
    const domainKey = getInvocationDomainKey(item);
    const stores = getInvocationEligibleStoreDomainKeys(actor, domainKey);
    if (!stores.length) continue;

    const group = groupsByKey.get(domainKey) ?? {
      key: domainKey,
      label: domainKey === RELIGION_INVOCATION_DOMAIN_UNIVERSAL
        ? "Universal"
        : (getReligionDomain(domainKey)?.label ?? domainKey),
      isUniversal: domainKey === RELIGION_INVOCATION_DOMAIN_UNIVERSAL,
      invocations: [],
    };

    const preparedIn = getPreparedInvocationStoreKeys(actor, item.id);
    group.invocations.push({
      item,
      id: item.id,
      key: domainKey,
      label: getLocalizedInvocationName(item),
      tnDomainKey: getInvocationTNDomainKey(item),
      tnDomainLabel: (() => {
        const tnDomainKey = getInvocationTNDomainKey(item);
        return tnDomainKey
          ? (getReligionDomain(tnDomainKey)?.label ?? tnDomainKey)
          : "Prepared Domain";
      })(),
      circle: getInvocationCircle(item),
      pietyCost: Math.max(1, Number(item?.system?.pietyCost ?? getInvocationCircle(item)) || getInvocationCircle(item)),
      prepared: preparedIn.length > 0,
      preparedIn,
      accessibleStores: stores,
      deityNames: stores.map((storeKey) => String(getWorshipDomainState(worship, storeKey)?.deityName ?? "").trim()).filter(Boolean),
      aspects: Array.isArray(item?.system?.aspects) ? item.system.aspects : [],
    });
    groupsByKey.set(domainKey, group);
  }

  const groups = Array.from(groupsByKey.values());
  groups.sort((a, b) => a.label.localeCompare(b.label));
  for (const group of groups) {
    group.invocations.sort((a, b) => a.circle - b.circle || a.label.localeCompare(b.label));
    group.count = group.invocations.length;
  }
  return groups;
}

export function buildRitualDomainItemSeed(actor, domainKey) {
  const key = asKey(domainKey);
  const domain = getReligionDomain(key);
  if (!domain) throw new Error(`Unknown religion domain: ${domainKey}`);

  const [firstKey = "", secondKey = ""] = domain.governingCharacteristics ?? [];
  const firstTotal = Number(actor?.system?.characteristics?.[firstKey]?.total ?? 0);
  const secondTotal = Number(actor?.system?.characteristics?.[secondKey]?.total ?? 0);
  const baseCha = firstTotal >= secondTotal ? firstKey : secondKey;

  return {
    name: domain.ritualSkillName,
    type: "magicSkill",
    img: "systems/uesrpg-3ev4/images/spell-compendium/mysticism_spellbook.webp",
    "system.governingCha": domain.governingCharacteristics.map((keyPart) => {
      const value = String(keyPart ?? "");
      return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
    }).filter(Boolean).join(", "),
    "system.baseCha": baseCha,
    [`flags.${RELIGION_FLAG_SCOPE}.${RELIGION_FLAG_KEY}.kind`]: RELIGION_ITEM_KIND.ritualDomain,
    [`flags.${RELIGION_FLAG_SCOPE}.${RELIGION_FLAG_KEY}.domainKey`]: key,
  };
}
