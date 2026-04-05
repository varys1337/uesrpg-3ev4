import { SYSTEM_ID } from "../system/namespace.js";
import { getReligionDomain } from "./domain-registry.js";
import { resolveTalentSlug } from "../traits/talents-api.js";

function asKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getReligionTalentFlags(item) {
  const raw = item?.flags?.[SYSTEM_ID]?.religion;
  return (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
}

function getTalentItemsBySlug(actor, slug) {
  const desired = asKey(slug);
  return Array.from(actor?.items ?? []).filter((item) =>
    item?.type === "talent" && resolveTalentSlug(item?.name) === desired
  );
}

function getActorRitualDomainKeys(actor) {
  const out = new Set();
  for (const item of Array.from(actor?.items ?? [])) {
    if (item?.type !== "magicSkill") continue;
    const religionFlags = item?.flags?.[SYSTEM_ID]?.religion ?? {};
    const kind = asKey(religionFlags?.kind);
    const domainKey = asKey(religionFlags?.domainKey);
    if (kind === "ritualdomain" && domainKey) out.add(domainKey);
  }
  return out;
}

export function getReligionTalentFlagsForItem(item) {
  return getReligionTalentFlags(item);
}

export function getBoundDomainKeysForTalent(actor, slug, flagKey = "domainKey") {
  return getTalentItemsBySlug(actor, slug)
    .map((item) => asKey(getReligionTalentFlags(item)?.[flagKey]))
    .filter(Boolean);
}

export function getOrdainedInitiateBindings(actor) {
  return getBoundDomainKeysForTalent(actor, "ordainedinitiate");
}

export function getOrthodoxFaithBindings(actor) {
  return getBoundDomainKeysForTalent(actor, "orthodoxfaith");
}

export function getSeasonedTheurgeBindings(actor) {
  return getBoundDomainKeysForTalent(actor, "seasonedtheurge");
}

export function getDomainInitiateCount(actor) {
  return getTalentItemsBySlug(actor, "domaininitiate").length;
}

export function hasShrineWarden(actor) {
  return getTalentItemsBySlug(actor, "shrinewarden").length > 0;
}

export function hasChosenIntercessor(actor) {
  return getTalentItemsBySlug(actor, "chosenintercessor").length > 0;
}

export function getSplinterFaithBindings(actor) {
  return getTalentItemsBySlug(actor, "splinterfaith")
    .map((item) => {
      const flags = getReligionTalentFlags(item);
      return {
        itemId: item.id,
        primaryDomainKey: asKey(flags.primaryDomainKey),
        splinterDomainKey: asKey(flags.splinterDomainKey),
      };
    })
    .filter((entry) => entry.primaryDomainKey && entry.splinterDomainKey);
}

export function getSplinterFaithPrimaryForDomain(actor, domainKey) {
  const targetKey = asKey(domainKey);
  for (const entry of getSplinterFaithBindings(actor)) {
    if (entry.splinterDomainKey === targetKey) return entry.primaryDomainKey;
  }
  return "";
}

export function getSplinterFaithAccessibleDomains(actor) {
  return getSplinterFaithBindings(actor).map((entry) => entry.splinterDomainKey);
}

export function getOrthodoxFaithBonus(actor, domainKey) {
  const targetKey = asKey(domainKey);
  if (!targetKey) return 0;
  if (!getOrthodoxFaithBindings(actor).includes(targetKey)) return 0;

  const domain = getReligionDomain(targetKey);
  const keys = Array.isArray(domain?.governingCharacteristics) ? domain.governingCharacteristics : [];
  if (keys.length < 2) return 0;

  const bonuses = keys.map((key) => Number(actor?.system?.characteristics?.[key]?.bonus ?? 0));
  if (bonuses.length < 2) return 0;
  return Math.max(0, Math.min(...bonuses.filter(Number.isFinite)));
}

export function getOrdainedInitiateExtraPreparation(actor, domainKey, { hasCircleOneDomainInvocation = false } = {}) {
  const targetKey = asKey(domainKey);
  if (!targetKey) return 0;
  const universalFallbackKey = "universal";
  let extra = 0;

  for (const boundDomainKey of getOrdainedInitiateBindings(actor)) {
    if (boundDomainKey === targetKey) extra += 1;
    if (!hasCircleOneDomainInvocation && targetKey === universalFallbackKey && boundDomainKey) extra += 1;
  }

  return extra;
}

export function validateSplinterFaithBinding(actor, primaryDomainKey, splinterDomainKey) {
  const primaryKey = asKey(primaryDomainKey);
  const splinterKey = asKey(splinterDomainKey);
  if (!primaryKey || !splinterKey || primaryKey === splinterKey) return false;

  const ritualDomainKeys = getActorRitualDomainKeys(actor);
  if (!ritualDomainKeys.has(primaryKey)) return false;

  const primaryDomain = getReligionDomain(primaryKey);
  const splinterDomain = getReligionDomain(splinterKey);
  if (!primaryDomain || !splinterDomain) return false;

  const primaryChars = new Set(primaryDomain.governingCharacteristics ?? []);
  return (splinterDomain.governingCharacteristics ?? []).some((key) => primaryChars.has(key));
}
