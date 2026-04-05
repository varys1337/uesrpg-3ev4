import { getReligionDomain } from "./domain-registry.js";

function cloneData(data) {
  try {
    return structuredClone(data);
  } catch (_e) {
    return JSON.parse(JSON.stringify(data));
  }
}

export function buildDefaultWorshipDomainState() {
  return {
    deityName: "",
    initiated: false,
    piety: {
      value: 0,
      max: 0,
      bonus: 0,
    },
    penance: {
      blocked: false,
      note: "",
      appliedAt: 0,
    },
    preparation: {
      preparedInvocationIds: [],
      lastPreparedAt: 0,
    },
    intervention: {
      lastLongRestUsage: 0,
      lastRequestAt: 0,
      lastResolvedAt: 0,
      lastOutcome: "",
      retributionNote: "",
    },
    history: [],
    observances: {
      fasting: {
        active: false,
        streakDays: 0,
        lastAccrualAt: 0,
        lastSourceLabel: "",
      },
    },
  };
}

export function buildDefaultWorshipData() {
  return {
    primaryDomainKey: "",
    domains: {},
  };
}

export function cloneDefaultWorshipData() {
  return cloneData(buildDefaultWorshipData());
}

export function cloneDefaultWorshipDomainState() {
  return cloneData(buildDefaultWorshipDomainState());
}

export function getWorshipSystemData(actorOrSystem) {
  const system = actorOrSystem?.system && typeof actorOrSystem.system === "object"
    ? actorOrSystem.system
    : actorOrSystem;
  const worship = system?.worship;
  return (worship && typeof worship === "object" && !Array.isArray(worship))
    ? worship
    : buildDefaultWorshipData();
}

export function getWorshipDomainState(worshipData, domainKey) {
  const worship = getWorshipSystemData(worshipData);
  const key = String(domainKey ?? "").trim().toLowerCase();
  if (!key) return buildDefaultWorshipDomainState();
  const state = worship?.domains?.[key];
  return (state && typeof state === "object" && !Array.isArray(state))
    ? state
    : buildDefaultWorshipDomainState();
}

export function getDomainGoverningCharacteristicKeys(domainKey) {
  return [...(getReligionDomain(domainKey)?.governingCharacteristics ?? [])];
}

export function getDomainGoverningChaString(domainKey) {
  return getDomainGoverningCharacteristicKeys(domainKey).join(", ");
}

export function getHigherGoverningCharacteristicBonus(actor, domainKey) {
  const keys = getDomainGoverningCharacteristicKeys(domainKey);
  if (!keys.length) return 0;

  let best = Number.NEGATIVE_INFINITY;
  for (const key of keys) {
    const bonus = Number(actor?.system?.characteristics?.[key]?.bonus ?? 0);
    if (bonus > best) best = bonus;
  }

  return Number.isFinite(best) ? best : 0;
}

export function getDefaultPietyMax(actor, domainKey) {
  return Math.max(0, getHigherGoverningCharacteristicBonus(actor, domainKey) * 2);
}
