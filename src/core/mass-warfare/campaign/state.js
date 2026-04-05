import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { cloneFlagState, clonePlain } from "../../../utils/clone.js";
import { FLAG_SCOPE } from "../../system/namespace.js";

export const WARFARE_ARMY_FLAG_KEY = "massWarfareArmy";
export const WARFARE_ARMY_STATE_VERSION = 1;
export const WARFARE_ARMY_ACTIONS_PER_TURN = 2;

export function createDefaultArmyCampaignState() {
  return {
    version: WARFARE_ARMY_STATE_VERSION,
    active: true,
    campaignTurn: 1,
    remainingArmyActions: WARFARE_ARMY_ACTIONS_PER_TURN,
    marshalActorUuid: "",
    locationNote: "",
    supply: {
      reserve: 0,
      capacity: 1,
      inSupply: true,
      consecutiveOutOfSupplyTurns: 0,
      sourceNote: "",
    },
    campaignState: {
      forcedMarchUsed: false,
      scoutedThisTurn: false,
      concealedThisTurn: false,
      contactState: "none",
      surpriseState: "none",
      battleRole: "",
    },
    siege: {
      activeSiegeSceneUuid: "",
      role: "",
    },
    notes: "",
    history: [],
  };
}

export function migrateArmyCampaignState(rawState) {
  const base = createDefaultArmyCampaignState();
  if (!rawState || typeof rawState !== "object") return base;
  const next = foundry.utils.mergeObject(base, cloneFlagState(rawState), {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true,
  });
  next.version = WARFARE_ARMY_STATE_VERSION;
  next.campaignTurn = Math.max(1, Number(next.campaignTurn ?? 1) || 1);
  next.remainingArmyActions = Math.max(
    0,
    Math.min(
      WARFARE_ARMY_ACTIONS_PER_TURN,
      Number(next.remainingArmyActions ?? WARFARE_ARMY_ACTIONS_PER_TURN) || 0,
    ),
  );
  next.supply.reserve = Math.max(0, Number(next.supply?.reserve ?? 0) || 0);
  next.supply.capacity = Math.max(1, Number(next.supply?.capacity ?? 1) || 1);
  next.supply.consecutiveOutOfSupplyTurns = Math.max(0, Number(next.supply?.consecutiveOutOfSupplyTurns ?? 0) || 0);
  next.history = Array.isArray(next.history) ? next.history : [];
  return next;
}

export function getArmyCampaignState(groupActor) {
  if (!groupActor) return createDefaultArmyCampaignState();
  const raw = groupActor.flags?.[FLAG_SCOPE]?.[WARFARE_ARMY_FLAG_KEY] ?? null;
  return migrateArmyCampaignState(raw);
}

export async function getArmyCampaignMemberActors(groupActor) {
  const resolved = [];
  for (const member of Array.isArray(groupActor?.system?.members) ? groupActor.system.members : []) {
    const uuid = String(member?.id ?? member?.uuid ?? "").trim();
    if (!uuid) continue;
    try {
      const actor = await fromUuid(uuid);
      if (actor?.documentName === "Actor") resolved.push(actor);
    } catch (_err) {
      // Ignore missing or stale member references.
    }
  }
  return resolved;
}

export async function getArmyCampaignWarfareMembers(groupActor) {
  const members = await getArmyCampaignMemberActors(groupActor);
  return members.filter((actor) => String(actor?.type ?? "") === "Warfare Unit");
}

export function isAuxiliaryWarfareUnit(actor) {
  if (String(actor?.type ?? "") !== "Warfare Unit") return false;
  if (actor?.system?._derived?.isAuxiliary === true) return true;
  return String(actor?.system?.identity?.category ?? "").trim().toLowerCase() === "auxiliaries";
}

export async function deriveArmyCampaignStateForGroup(groupActor, rawState = null) {
  const state = migrateArmyCampaignState(rawState ?? getArmyCampaignState(groupActor));
  const warfareMembers = await getArmyCampaignWarfareMembers(groupActor);
  const auxiliaryCount = warfareMembers.filter((actor) => isAuxiliaryWarfareUnit(actor)).length;
  state.supply.capacity = Math.min(4, 1 + auxiliaryCount);
  if (state.supply.reserve > state.supply.capacity) {
    state.supply.reserve = state.supply.capacity;
  }
  return state;
}

export async function updateArmyCampaignState(groupActor, updater) {
  if (!groupActor) throw new Error("Missing Group actor for army campaign update.");
  const current = getArmyCampaignState(groupActor);
  const next = typeof updater === "function"
    ? await updater(clonePlain(current))
    : foundry.utils.mergeObject(current, clonePlain(updater ?? {}), {
      inplace: false,
      overwrite: true,
      insertKeys: true,
      insertValues: true,
    });
  const migrated = await deriveArmyCampaignStateForGroup(groupActor, next);
  await requestUpdateDocument(groupActor, {
    [`flags.${FLAG_SCOPE}.${WARFARE_ARMY_FLAG_KEY}`]: migrated,
  });
  return migrated;
}

export function getArmyCampaignFlagPath() {
  return `flags.${FLAG_SCOPE}.${WARFARE_ARMY_FLAG_KEY}`;
}
