import { requestCreateEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { doTestRoll, formatResultSummary } from "../../utils/degree-roll-helper.js";
import { SYSTEM_ID } from "../system/namespace.js";
import { getReligionDomain } from "./domain-registry.js";
import {
  canActorAccessDomainSpell,
  canActorAccessInvocationDomain,
  getDomainPreparationLimit,
  getDomainSpellDomainKey,
  getInvocationEligibleStoreDomainKeys,
  getPreparedInvocationStoreKeys,
  isDomainSpellItem,
  isInvocationItem,
} from "./ritual-domains.js";
import {
  getDomainInitiateCount,
  getOrthodoxFaithBonus,
  getReligionTalentFlagsForItem,
  getSplinterFaithBindings,
  getOrdainedInitiateBindings,
  getOrthodoxFaithBindings,
  getSeasonedTheurgeBindings,
  hasChosenIntercessor,
} from "./clerical-talents.js";
import { getDefaultPietyMax, getWorshipDomainState, getWorshipSystemData } from "./worship-store.js";
import { canActorCastSpell, getMagicSkillLevel } from "../magic/magicka-utils.js";
import { buildKnownSpellIndex, spellSignature } from "../advancement/spell-learning.js";
import { isActorInsideMatchingConsecratedRegion } from "./consecration.js";

const RELIGION_ACTOR_FLAG_PATH = `flags.${SYSTEM_ID}.religion`;
const DIVINE_INTERVENTION_REQUEST_PATH = `${RELIGION_ACTOR_FLAG_PATH}.pendingDivineIntervention`;
const CHOSEN_INTERCESSOR_USAGE_PATH = `${RELIGION_ACTOR_FLAG_PATH}.chosenIntercessorUsage`;

export const WORSHIP_SOURCE_PRESETS = Object.freeze({
  prayer: { label: "Prayer", difficultyKey: "challenging", pp: 1, cadenceMs: 24 * 60 * 60 * 1000 },
  fasting: { label: "Fasting", difficultyKey: "average", pp: 2, cadenceMs: 30 * 24 * 60 * 60 * 1000 },
  templeMass: { label: "Temple Mass", difficultyKey: "average", pp: 2, cadenceMs: 7 * 24 * 60 * 60 * 1000 },
  monthlyHighMass: { label: "Monthly High Mass", difficultyKey: "easy", pp: 4, cadenceMs: 30 * 24 * 60 * 60 * 1000 },
  festivalMass: { label: "Festival Mass", difficultyKey: "easy", pp: 6, cadenceMs: 365 * 24 * 60 * 60 * 1000 },
  donation: { label: "Donation / Sacrifice", difficultyKey: "simple", pp: 1, cadenceMs: 7 * 24 * 60 * 60 * 1000 },
  templeService: { label: "Temple Service", difficultyKey: "simple", pp: 3, cadenceMs: 0 },
  quest: { label: "Quest", difficultyKey: "effortless", pp: 3, cadenceMs: 0 },
  pilgrimage: { label: "Pilgrimage", difficultyKey: "effortless", pp: 3, cadenceMs: 0 },
});

const DIFFICULTY_MODIFIERS = Object.freeze({
  effortless: 20,
  simple: 10,
  easy: 10,
  average: 0,
  challenging: -10,
  hard: -20,
  veryhard: -30,
});

function asKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cloneData(value) {
  try {
    return structuredClone(value);
  } catch (_err) {
    return JSON.parse(JSON.stringify(value ?? {}));
  }
}

function getDomainPath(domainKey) {
  return `system.worship.domains.${asKey(domainKey)}`;
}

function getLongRestMarker(actor) {
  return Number(actor?.getFlag?.(SYSTEM_ID, "wounds.longRestCounter") ?? 0) || 0;
}

function buildHistoryEntry(type, payload = {}) {
  return {
    id: foundry.utils.randomID(),
    type: String(type ?? "").trim(),
    createdAt: Date.now(),
    ...payload,
  };
}

function getDifficultyModifier(key) {
  return asNumber(DIFFICULTY_MODIFIERS[asKey(key)], 0);
}

function getSourcePreset(sourceKeyOrLabel) {
  const target = asKey(sourceKeyOrLabel);
  return Object.entries(WORSHIP_SOURCE_PRESETS).find(([key, preset]) =>
    key === target || asKey(preset.label) === target
  )?.[1] ?? null;
}

function getActorItemsOfType(actor, type) {
  return Array.from(actor?.items ?? []).filter((item) => item?.type === type);
}

export function getDomainEffectivePietyMax(actor, domainKey) {
  return Math.max(
    0,
    getDefaultPietyMax(actor, domainKey) + getOrthodoxFaithBonus(actor, domainKey),
  );
}

export function actorHasActiveFasting(actor) {
  const worship = getWorshipSystemData(actor);
  return Object.values(worship?.domains ?? {}).some((state) => state?.observances?.fasting?.active === true);
}

export function buildClericalTalentBindingContext(actor) {
  const ritualDomainChoices = getActorItemsOfType(actor, "magicSkill")
    .map((item) => {
      const domainKey = asKey(item?.flags?.[SYSTEM_ID]?.religion?.domainKey);
      const domain = getReligionDomain(domainKey);
      return domain ? { value: domainKey, label: domain.label } : null;
    })
    .filter(Boolean);

  return {
    domainChoices: ritualDomainChoices,
    ordainedInitiate: getActorItemsOfType(actor, "talent")
      .filter((item) => asKey(item?.name) === "ordained initiate" || asKey(item?.name) === "ordained-initiate")
      .map((item) => ({
        itemId: item.id,
        name: item.name,
        domainKey: asKey(getReligionTalentFlagsForItem(item)?.domainKey),
      })),
    orthodoxFaith: getActorItemsOfType(actor, "talent")
      .filter((item) => asKey(item?.name) === "orthodox faith" || asKey(item?.name) === "orthodox-faith")
      .map((item) => ({
        itemId: item.id,
        name: item.name,
        domainKey: asKey(getReligionTalentFlagsForItem(item)?.domainKey),
      })),
    seasonedTheurge: getActorItemsOfType(actor, "talent")
      .filter((item) => asKey(item?.name) === "seasoned theurge" || asKey(item?.name) === "seasoned-theurge")
      .map((item) => ({
        itemId: item.id,
        name: item.name,
        domainKey: asKey(getReligionTalentFlagsForItem(item)?.domainKey),
      })),
    splinterFaith: getSplinterFaithBindings(actor),
  };
}

export async function setWorshipPrimaryDomain(actor, domainKey) {
  await requestUpdateDocument(actor, {
    "system.worship.primaryDomainKey": asKey(domainKey),
  });
}

export async function updateWorshipDomain(actor, domainKey, updater) {
  const key = asKey(domainKey);
  const current = cloneData(getWorshipDomainState(actor, key));
  const next = typeof updater === "function"
    ? await updater(current)
    : foundry.utils.mergeObject(current, cloneData(updater ?? {}), {
      inplace: false,
      insertKeys: true,
      insertValues: true,
      overwrite: true,
    });

  const computedMax = getDomainEffectivePietyMax(actor, key);
  const currentValue = asNumber(next?.piety?.value, 0);
  const authoredMax = asNumber(next?.piety?.max, 0);
  next.piety = next.piety ?? {};
  next.piety.max = Math.max(authoredMax, computedMax);
  next.piety.value = Math.max(0, Math.min(currentValue, next.piety.max));

  await requestUpdateDocument(actor, {
    [getDomainPath(key)]: next,
  });
  return next;
}

export async function setPreparedInvocations(actor, storeDomainKey, invocationIds = []) {
  const key = asKey(storeDomainKey);
  const uniqueIds = Array.from(new Set((Array.isArray(invocationIds) ? invocationIds : []).map((value) => String(value ?? "").trim()).filter(Boolean)));
  return updateWorshipDomain(actor, key, (state) => ({
    ...state,
    preparation: {
      ...(state?.preparation ?? {}),
      preparedInvocationIds: uniqueIds,
      lastPreparedAt: Date.now(),
    },
  }));
}

export async function setClericalTalentBinding(actor, itemId, patch = {}) {
  const item = actor?.items?.get?.(String(itemId ?? ""));
  if (!item || item.type !== "talent") throw new Error("Missing clerical talent item.");
  const next = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    next[`flags.${SYSTEM_ID}.religion.${key}`] = value;
  }
  await requestUpdateDocument(item, next);
  return item;
}

export function getPietyCadenceWarning(actor, domainKey, sourceLabel) {
  const preset = getSourcePreset(sourceLabel);
  if (!preset?.cadenceMs) return "";

  const state = getWorshipDomainState(actor, domainKey);
  const history = Array.isArray(state?.history) ? state.history : [];
  const now = Date.now();
  const targetLabel = asKey(preset.label);

  if (targetLabel === "prayer" && isActorInsideMatchingConsecratedRegion(actor, domainKey)) {
    return "";
  }

  const recent = history.find((entry) => {
    if (asKey(entry?.sourceLabel) !== targetLabel) return false;
    const createdAt = asNumber(entry?.createdAt, 0);
    return createdAt > 0 && (now - createdAt) < preset.cadenceMs;
  });
  if (!recent) return "";

  return `${preset.label} was already recorded within its cadence window for ${getReligionDomain(domainKey)?.label ?? domainKey}.`;
}

export async function applyPietyEvent(actor, {
  domainKey,
  mode = "gain",
  sourceLabel = "",
  difficultyKey = "average",
  ppDelta = null,
  manualSuccess = null,
  note = "",
} = {}) {
  const key = asKey(domainKey);
  const domain = getReligionDomain(key);
  if (!domain) throw new Error("Unknown worship domain.");

  const preset = getSourcePreset(sourceLabel);
  const ritualDomainItem = actor?.items?.find?.((item) => item?.type === "magicSkill" && asKey(item?.flags?.[SYSTEM_ID]?.religion?.domainKey) === key);
  const baseTN = asNumber(ritualDomainItem?.system?.value, 0);
  const target = Math.max(0, baseTN + getDifficultyModifier(difficultyKey));
  const cadenceWarning = getPietyCadenceWarning(actor, key, sourceLabel);
  const result = (manualSuccess === null && mode === "gain")
    ? await doTestRoll(actor, { target })
    : null;
  const success = manualSuccess === null ? (result?.isSuccess === true || mode !== "gain") : Boolean(manualSuccess);
  const rawDelta = ppDelta == null ? asNumber(preset?.pp, 0) : asNumber(ppDelta, 0);

  const historyEntry = buildHistoryEntry(mode, {
    domainKey: key,
    sourceLabel: String(sourceLabel ?? preset?.label ?? "").trim(),
    difficultyKey: asKey(difficultyKey),
    rollSummary: result ? formatResultSummary(result, { uppercase: true, includeDegree: true, degreeStyle: "dash" }) : "",
    success,
    ppDelta: rawDelta,
    note: String(note ?? "").trim(),
  });

  const nextState = await updateWorshipDomain(actor, key, (state) => {
    const currentValue = asNumber(state?.piety?.value, 0);
    const currentMax = Math.max(asNumber(state?.piety?.max, 0), getDomainEffectivePietyMax(actor, key));
    const history = Array.isArray(state?.history) ? [...state.history, historyEntry].slice(-50) : [historyEntry];
    const fasting = cloneData(state?.observances?.fasting ?? {});

    let nextValue = currentValue;
    let penanceBlocked = state?.penance?.blocked === true;

    if (mode === "minorLoss") nextValue = 0;
    else if (mode === "majorLoss") {
      nextValue = 0;
      penanceBlocked = true;
    } else if (mode === "gain" && success) {
      nextValue = Math.min(currentMax, currentValue + Math.max(0, rawDelta));
      if (preset && asKey(preset.label) === "fasting") {
        fasting.active = true;
        fasting.streakDays = Math.max(1, asNumber(fasting.streakDays, 0) + 1);
        fasting.lastAccrualAt = Date.now();
        fasting.lastSourceLabel = preset.label;
      }
    }

    return {
      ...state,
      piety: {
        ...(state?.piety ?? {}),
        value: nextValue,
        max: currentMax,
      },
      penance: {
        ...(state?.penance ?? {}),
        blocked: penanceBlocked,
      },
      history,
      observances: {
        ...(state?.observances ?? {}),
        fasting,
      },
    };
  });

  return {
    domain,
    cadenceWarning,
    result,
    success,
    ppDelta: rawDelta,
    nextState,
  };
}

function getChosenIntercessorUsage(actor) {
  const raw = actor?.flags?.[SYSTEM_ID]?.religion?.chosenIntercessorUsage ?? {};
  const currentRest = getLongRestMarker(actor);
  const restMarker = asNumber(raw?.restMarker, -1);
  if (restMarker !== currentRest) return { restMarker: currentRest, used: 0 };
  return {
    restMarker: currentRest,
    used: Math.max(0, Math.min(2, asNumber(raw?.used, 0))),
  };
}

async function setChosenIntercessorUsage(actor, usage) {
  await requestUpdateDocument(actor, {
    [CHOSEN_INTERCESSOR_USAGE_PATH]: usage,
  });
}

function getPendingDivineIntervention(actor) {
  const raw = actor?.flags?.[SYSTEM_ID]?.religion?.pendingDivineIntervention ?? null;
  return (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : null;
}

function getWhisperRecipientsForGms() {
  return game.users?.filter?.((user) => user.isGM)?.map?.((user) => user.id) ?? [];
}

async function whisperGm(content) {
  const whisper = getWhisperRecipientsForGms();
  if (!whisper.length) return null;
  return ChatMessage.create({
    whisper,
    speaker: ChatMessage.getSpeaker(),
    content,
  });
}

export async function requestDivineIntervention(actor, {
  domainKey,
  ppCommitted = 1,
  requestText = "",
} = {}) {
  const key = asKey(domainKey);
  const state = getWorshipDomainState(actor, key);
  const currentPiety = asNumber(state?.piety?.value, 0);
  const pietyMax = Math.max(asNumber(state?.piety?.max, 0), getDomainEffectivePietyMax(actor, key));
  if (currentPiety < Math.ceil(pietyMax / 2)) {
    throw new Error("Divine Intervention requires at least half of the domain's maximum Piety Points available.");
  }

  const payload = {
    id: foundry.utils.randomID(),
    domainKey: key,
    ppCommitted: Math.max(1, Math.min(currentPiety, asNumber(ppCommitted, 1))),
    requestText: String(requestText ?? "").trim(),
    requestedByUserId: game.user?.id ?? "",
    requestedByName: game.user?.name ?? "",
    createdAt: Date.now(),
  };

  await requestUpdateDocument(actor, {
    [DIVINE_INTERVENTION_REQUEST_PATH]: payload,
    [`${getDomainPath(key)}.intervention.lastRequestAt`]: payload.createdAt,
  });

  const domainLabel = getReligionDomain(key)?.label ?? key;
  await whisperGm(`
    <div>
      <h3 style="margin:0 0 6px 0;">Divine Intervention Request</h3>
      <div><b>Actor:</b> ${foundry.utils.escapeHTML(actor.name)}</div>
      <div><b>Domain:</b> ${foundry.utils.escapeHTML(domainLabel)}</div>
      <div><b>Committed PP:</b> ${payload.ppCommitted}</div>
      <div style="margin-top:6px;">${foundry.utils.escapeHTML(payload.requestText || "(No request text provided)")}</div>
    </div>
  `);

  return payload;
}

export async function resolveDivineIntervention(actor, {
  worthyState = "neutral",
  revealDetails = false,
  retributionNote = "",
} = {}) {
  const request = getPendingDivineIntervention(actor);
  if (!request?.domainKey) throw new Error("No pending Divine Intervention request.");

  const key = asKey(request.domainKey);
  const domain = getReligionDomain(key);
  const state = getWorshipDomainState(actor, key);
  const currentPiety = asNumber(state?.piety?.value, 0);
  const ppCommitted = Math.max(1, Math.min(currentPiety, asNumber(request.ppCommitted, 1)));
  const worthMod = worthyState === "worthy" ? 10 : worthyState === "unworthy" ? -20 : 0;
  const baseTN = asNumber(actor?.items?.find?.((item) => item?.type === "magicSkill" && asKey(item?.flags?.[SYSTEM_ID]?.religion?.domainKey) === key)?.system?.value, 0);
  const usage = getChosenIntercessorUsage(actor);
  const intercessorBonusSteps = hasChosenIntercessor(actor) ? Math.max(0, Math.min(2 - usage.used, ppCommitted)) : 0;
  const intercessorBonus = intercessorBonusSteps * 10;
  const target = Math.max(0, baseTN + (ppCommitted * 5) + worthMod + intercessorBonus);
  const rollResult = await doTestRoll(actor, { target });
  const gmWhisper = getWhisperRecipientsForGms();

  if (rollResult?.roll) {
    await rollResult.roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<b>${actor.name}</b> - Divine Intervention (${domain?.label ?? key})`,
      whisper: gmWhisper,
      rollMode: "blindroll",
    });
  }

  let retributionResult = null;
  if (!rollResult.isSuccess) {
    retributionResult = await doTestRoll(actor, { target });
    if (retributionResult?.roll) {
      await retributionResult.roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `<b>${actor.name}</b> - Divine Retribution (${domain?.label ?? key})`,
        whisper: gmWhisper,
        rollMode: "blindroll",
      });
    }
  }

  const retainedPiety = rollResult.isSuccess && hasChosenIntercessor(actor) ? 1 : 0;
  const nextState = await updateWorshipDomain(actor, key, (current) => ({
    ...current,
    piety: {
      ...(current?.piety ?? {}),
      value: rollResult.isSuccess ? retainedPiety : Math.max(0, asNumber(current?.piety?.value, 0) - ppCommitted),
    },
    intervention: {
      ...(current?.intervention ?? {}),
      lastResolvedAt: Date.now(),
      lastOutcome: rollResult.isSuccess ? "success" : "failure",
      retributionNote: String(retributionNote ?? "").trim(),
    },
    history: [
      ...(Array.isArray(current?.history) ? current.history : []),
      buildHistoryEntry("divineIntervention", {
        domainKey: key,
        ppCommitted,
        worthyState,
        target,
        success: rollResult.isSuccess,
        rollSummary: formatResultSummary(rollResult, { uppercase: true, includeDegree: true, degreeStyle: "dash" }),
        retributionSummary: retributionResult ? formatResultSummary(retributionResult, { uppercase: true, includeDegree: true, degreeStyle: "dash" }) : "",
        note: String(retributionNote ?? "").trim(),
      }),
    ].slice(-50),
  }));

  await setChosenIntercessorUsage(actor, {
    restMarker: usage.restMarker,
    used: Math.max(0, Math.min(2, usage.used + intercessorBonusSteps)),
  });

  await requestUpdateDocument(actor, {
    [DIVINE_INTERVENTION_REQUEST_PATH]: null,
  });

  const publicContent = rollResult.isSuccess
    ? `<p><b>${foundry.utils.escapeHTML(actor.name)}</b>'s plea is answered by the ${foundry.utils.escapeHTML(domain?.label ?? key)} powers.</p>`
    : `<p><b>${foundry.utils.escapeHTML(actor.name)}</b>'s plea goes unanswered, and the rites demand a price.</p>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: publicContent,
  });

  if (revealDetails) {
    await whisperGm(`
      <div>
        <h3 style="margin:0 0 6px 0;">Divine Intervention Resolved</h3>
        <div><b>Actor:</b> ${foundry.utils.escapeHTML(actor.name)}</div>
        <div><b>Domain:</b> ${foundry.utils.escapeHTML(domain?.label ?? key)}</div>
        <div><b>Target:</b> ${target}</div>
        <div><b>Outcome:</b> ${foundry.utils.escapeHTML(formatResultSummary(rollResult, { uppercase: true, includeDegree: true, degreeStyle: "dash" }))}</div>
        ${retributionResult ? `<div><b>Retribution:</b> ${foundry.utils.escapeHTML(formatResultSummary(retributionResult, { uppercase: true, includeDegree: true, degreeStyle: "dash" }))}</div>` : ""}
        ${retributionNote ? `<div style="margin-top:6px;"><b>GM Note:</b> ${foundry.utils.escapeHTML(retributionNote)}</div>` : ""}
      </div>
    `);
  }

  return {
    request,
    target,
    rollResult,
    retributionResult,
    nextState,
  };
}

export function getAvailableDomainSpellSlots(actor) {
  const totalInitiates = getDomainInitiateCount(actor);
  const learnedDomainSpells = getActorItemsOfType(actor, "spell").filter((item) => isDomainSpellItem(item)).length;
  return Math.max(0, totalInitiates - learnedDomainSpells);
}

export async function learnDomainSpell(actor, spellLike) {
  const itemData = typeof spellLike?.toObject === "function" ? spellLike.toObject() : cloneData(spellLike);
  itemData.type = "spell";
  itemData.flags = itemData.flags ?? {};
  itemData.flags[SYSTEM_ID] = itemData.flags[SYSTEM_ID] ?? {};
  itemData.flags[SYSTEM_ID].religion = itemData.flags[SYSTEM_ID].religion ?? {};
  itemData.flags[SYSTEM_ID].religion.domainSpell = true;

  const domainKey = getDomainSpellDomainKey(itemData);
  if (!domainKey || !canActorAccessDomainSpell(actor, itemData)) {
    throw new Error("Actor does not have access to this domain spell.");
  }
  if (getAvailableDomainSpellSlots(actor) <= 0) {
    throw new Error("No Domain Initiate spell picks remain.");
  }
  if (!canActorCastSpell(actor, itemData)) {
    throw new Error("Actor does not meet the favored-school training requirements for this domain spell.");
  }

  const known = buildKnownSpellIndex(actor);
  const signature = spellSignature(itemData);
  if (known.bySignature.has(signature)) {
    throw new Error("Actor already knows this spell.");
  }

  const created = await requestCreateEmbeddedDocuments(actor, "Item", [itemData]);
  return created?.[0] ?? null;
}
