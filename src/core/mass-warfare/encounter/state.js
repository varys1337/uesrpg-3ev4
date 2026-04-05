import { SYSTEM_ID } from "../../constants.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { synchronizeBattlefieldStateForScene } from "../battlefield/state.js";

export const WARFARE_ENCOUNTER_FLAG = "warfareEncounter";
export const WARFARE_ENCOUNTER_VERSION = 1;

export const WARFARE_ENCOUNTER_PHASES = Object.freeze({
  CHARGE: "charge",
  STRATEGIC: "strategic",
  CLASH: "clash",
});

export const WARFARE_ENCOUNTER_SIDES = Object.freeze({
  ALLIES: "allies",
  ENEMIES: "enemies",
  NEUTRAL: "neutral",
});

function _clone(value) {
  return foundry.utils.deepClone(value);
}

function _toSide(value) {
  const side = String(value ?? "").trim().toLowerCase();
  if (side === WARFARE_ENCOUNTER_SIDES.ALLIES) return WARFARE_ENCOUNTER_SIDES.ALLIES;
  if (side === WARFARE_ENCOUNTER_SIDES.ENEMIES) return WARFARE_ENCOUNTER_SIDES.ENEMIES;
  return WARFARE_ENCOUNTER_SIDES.NEUTRAL;
}

function _toPhase(value) {
  const phase = String(value ?? "").trim().toLowerCase();
  if (phase === WARFARE_ENCOUNTER_PHASES.STRATEGIC) return WARFARE_ENCOUNTER_PHASES.STRATEGIC;
  if (phase === WARFARE_ENCOUNTER_PHASES.CLASH) return WARFARE_ENCOUNTER_PHASES.CLASH;
  return WARFARE_ENCOUNTER_PHASES.CHARGE;
}

function _emptyChargeEntry() {
  return {
    attackerTokenUuid: "",
    targetTokenUuid: "",
    round: 1,
    pathCost: 0,
    targetContactSide: "front",
    clashGroupId: "",
    messageId: "",
  };
}

function _normalizeChargeEntry(attackerTokenUuid, entry = {}) {
  const normalized = {
    ..._emptyChargeEntry(),
    attackerTokenUuid: String(entry?.attackerTokenUuid ?? attackerTokenUuid ?? ""),
    targetTokenUuid: String(entry?.targetTokenUuid ?? ""),
    round: Math.max(1, Number(entry?.round ?? 1) || 1),
    pathCost: Math.max(0, Number(entry?.pathCost ?? 0) || 0),
    targetContactSide: new Set(["front", "flank", "rear"]).has(String(entry?.targetContactSide ?? "").trim().toLowerCase())
      ? String(entry.targetContactSide).trim().toLowerCase()
      : "front",
    clashGroupId: String(entry?.clashGroupId ?? ""),
    messageId: String(entry?.messageId ?? ""),
  };
  if (!normalized.attackerTokenUuid || !normalized.targetTokenUuid) return null;
  return normalized;
}

function _emptyClashLogEntry() {
  return {
    id: foundry.utils.randomID(),
    round: 1,
    attackerTokenUuid: "",
    defenderTokenUuid: "",
    attackType: "melee",
    clashGroupId: "",
    groupMembers: [],
    attackerContactSide: "front",
    defenderContactSide: "front",
    commanderJoinFray: {
      unit1: null,
      unit2: null,
    },
    messageId: "",
    status: "pending-card",
  };
}

function _normalizeClashLogEntry(entry = {}) {
  const base = _emptyClashLogEntry();
  const attackType = String(entry?.attackType ?? base.attackType).trim().toLowerCase() === "ranged"
    ? "ranged"
    : "melee";
  const status = new Set(["pending-card", "resolved", "cancelled"]).has(String(entry?.status ?? ""))
    ? String(entry.status)
    : "pending-card";
  const normalized = {
    ...base,
    id: String(entry?.id ?? base.id),
    round: Math.max(1, Number(entry?.round ?? 1) || 1),
    attackerTokenUuid: String(entry?.attackerTokenUuid ?? ""),
    defenderTokenUuid: String(entry?.defenderTokenUuid ?? entry?.targetTokenUuid ?? ""),
    attackType,
    clashGroupId: String(entry?.clashGroupId ?? ""),
    groupMembers: Array.isArray(entry?.groupMembers)
      ? entry.groupMembers.map((value) => String(value ?? "")).filter(Boolean)
      : [],
    attackerContactSide: new Set(["front", "flank", "rear"]).has(String(entry?.attackerContactSide ?? "").trim().toLowerCase())
      ? String(entry.attackerContactSide).trim().toLowerCase()
      : "front",
    defenderContactSide: new Set(["front", "flank", "rear"]).has(String(entry?.defenderContactSide ?? "").trim().toLowerCase())
      ? String(entry.defenderContactSide).trim().toLowerCase()
      : "front",
    commanderJoinFray: {
      unit1: entry?.commanderJoinFray?.unit1 ?? null,
      unit2: entry?.commanderJoinFray?.unit2 ?? null,
    },
    messageId: String(entry?.messageId ?? ""),
    status,
  };
  if (!normalized.attackerTokenUuid || !normalized.defenderTokenUuid) return null;
  return normalized;
}

function _normalizeActivations(raw, round) {
  const activations = {};
  if (!raw || typeof raw !== "object") return activations;
  for (const [tokenUuid, value] of Object.entries(raw)) {
    const normalizedRound = Math.max(1, Number(value ?? round) || round);
    if (!tokenUuid || normalizedRound !== round) continue;
    activations[String(tokenUuid)] = normalizedRound;
  }
  return activations;
}

function _normalizeCharges(raw) {
  const charges = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const normalized = _normalizeChargeEntry(entry?.attackerTokenUuid, entry);
      if (!normalized) continue;
      charges[normalized.attackerTokenUuid] = normalized;
    }
    return charges;
  }
  if (!raw || typeof raw !== "object") return charges;
  for (const [attackerTokenUuid, entry] of Object.entries(raw)) {
    const normalized = _normalizeChargeEntry(attackerTokenUuid, entry);
    if (!normalized) continue;
    charges[normalized.attackerTokenUuid] = normalized;
  }
  return charges;
}

function _normalizeClashLog(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => _normalizeClashLogEntry(entry))
    .filter(Boolean);
}

function _activationsFromLegacyRoster(roster, round) {
  const activations = {};
  for (const entry of Array.from(roster ?? [])) {
    const tokenUuid = String(entry?.tokenUuid ?? "");
    if (!tokenUuid) continue;
    const activatedRound = Math.max(0, Number(entry?.activatedRound ?? 0) || 0);
    const activatedPhase = String(entry?.activatedPhase ?? "").trim().toLowerCase();
    if (activatedRound === round && activatedPhase === WARFARE_ENCOUNTER_PHASES.STRATEGIC) {
      activations[tokenUuid] = round;
    }
  }
  return activations;
}

export function createDefaultWarfareEncounterState() {
  return {
    version: WARFARE_ENCOUNTER_VERSION,
    active: false,
    round: 1,
    phase: WARFARE_ENCOUNTER_PHASES.CHARGE,
    prioritySide: WARFARE_ENCOUNTER_SIDES.ALLIES,
    currentSide: WARFARE_ENCOUNTER_SIDES.ALLIES,
    activations: {},
    charges: {},
    clashLog: [],
    battlefield: {
      units: {},
    },
  };
}

export function getWarfareEncounterFlagPath() {
  return `flags.${SYSTEM_ID}.${WARFARE_ENCOUNTER_FLAG}`;
}

export function defaultEncounterSideFromDisposition(tokenDoc) {
  const disposition = Number(tokenDoc?.disposition ?? tokenDoc?._source?.disposition ?? 0) || 0;
  if (disposition > 0) return WARFARE_ENCOUNTER_SIDES.ALLIES;
  if (disposition < 0) return WARFARE_ENCOUNTER_SIDES.ENEMIES;
  return WARFARE_ENCOUNTER_SIDES.NEUTRAL;
}

export function getWarfareUnitTokenDocs(scene) {
  const tokenDocs = Array.from(scene?.tokens?.contents ?? []);
  return tokenDocs.filter((tokenDoc) => tokenDoc?.actor?.type === "Warfare Unit");
}

export function migrateWarfareEncounterState(rawState = null) {
  const base = createDefaultWarfareEncounterState();
  if (!rawState || typeof rawState !== "object") return base;

  const round = Math.max(1, Number(rawState?.round ?? 1) || 1);
  const activations = _normalizeActivations(
    rawState?.activations ?? _activationsFromLegacyRoster(rawState?.roster, round),
    round,
  );
  const charges = _normalizeCharges(rawState?.charges ?? rawState?.declaredCharges);
  const clashLog = _normalizeClashLog(rawState?.clashLog ?? rawState?.scheduledClashes);
  const prioritySide = (() => {
    const side = _toSide(rawState?.prioritySide);
    return side === WARFARE_ENCOUNTER_SIDES.ENEMIES ? side : WARFARE_ENCOUNTER_SIDES.ALLIES;
  })();
  const currentSide = (() => {
    const side = _toSide(rawState?.currentSide ?? rawState?.activeSide ?? prioritySide);
    return side === WARFARE_ENCOUNTER_SIDES.NEUTRAL ? prioritySide : side;
  })();

  return {
    ...base,
    version: WARFARE_ENCOUNTER_VERSION,
    active: Boolean(rawState?.active),
    round,
    phase: _toPhase(rawState?.phase),
    prioritySide,
    currentSide,
    activations,
    charges,
    clashLog,
    battlefield: synchronizeBattlefieldStateForScene(null, { battlefield: rawState?.battlefield ?? {} }),
  };
}

export function getSceneWarfareEncounterState(scene) {
  if (!scene) return createDefaultWarfareEncounterState();
  const raw = scene.flags?.[SYSTEM_ID]?.[WARFARE_ENCOUNTER_FLAG] ?? null;
  const migrated = migrateWarfareEncounterState(raw);
  migrated.battlefield = synchronizeBattlefieldStateForScene(scene, migrated);
  return migrated;
}

export async function updateSceneWarfareEncounterState(scene, updater) {
  if (!scene) throw new Error("A Scene is required for warfare encounter updates.");
  const current = getSceneWarfareEncounterState(scene);
  const next = typeof updater === "function"
    ? updater(_clone(current))
    : foundry.utils.mergeObject(current, _clone(updater ?? {}), {
      inplace: false,
      insertKeys: true,
      insertValues: true,
      overwrite: true,
    });
  const migrated = migrateWarfareEncounterState(next);
  migrated.battlefield = synchronizeBattlefieldStateForScene(scene, migrated);
  await requestUpdateDocument(scene, {
    [getWarfareEncounterFlagPath()]: migrated,
  });
  return migrated;
}

export function getEncounterSceneForActor(actor) {
  const syntheticScene = actor?.token?.document?.parent ?? actor?.token?.parent ?? null;
  if (syntheticScene?.documentName === "Scene") return syntheticScene;
  return game?.scenes?.current ?? null;
}

export function resolveEncounterTokenUuidForActor(scene, actor) {
  const tokenUuid = String(actor?.token?.document?.uuid ?? actor?.token?.uuid ?? "");
  if (tokenUuid && scene?.tokens?.get?.(actor?.token?.document?.id ?? actor?.token?.id ?? "")) return tokenUuid;

  const activeTokens = Array.from(actor?.getActiveTokens?.(true, true) ?? []);
  const sceneToken = activeTokens.find((token) => String(token?.document?.parent?.id ?? token?.parent?.id ?? "") === String(scene?.id ?? ""));
  if (sceneToken?.document?.uuid) return String(sceneToken.document.uuid);

  const fallback = Array.from(scene?.tokens?.contents ?? []).find((tokenDoc) => String(tokenDoc?.actor?.id ?? "") === String(actor?.id ?? ""));
  return String(fallback?.uuid ?? "");
}

export function getEncounterTokenDocForActor(scene, actor) {
  const tokenUuid = resolveEncounterTokenUuidForActor(scene, actor);
  if (!tokenUuid) return null;
  return Array.from(scene?.tokens?.contents ?? []).find((tokenDoc) => String(tokenDoc?.uuid ?? "") === tokenUuid) ?? null;
}

export function getEncounterRosterEntryForActor(scene, state, actor) {
  const tokenDoc = getEncounterTokenDocForActor(scene, actor);
  if (!tokenDoc) return null;
  const tokenUuid = String(tokenDoc.uuid ?? "");
  return {
    tokenUuid,
    actorUuid: String(tokenDoc.actor?.uuid ?? actor?.uuid ?? ""),
    actorId: String(tokenDoc.actor?.id ?? actor?.id ?? ""),
    name: String(tokenDoc.actor?.name ?? tokenDoc.name ?? actor?.name ?? ""),
    side: defaultEncounterSideFromDisposition(tokenDoc),
    defeated: Boolean(tokenDoc.actor?.system?.status?.battle?.defeated),
    activatedRound: Math.max(0, Number(state?.activations?.[tokenUuid] ?? 0) || 0),
  };
}

export function isSceneWarfareEncounterActive(scene) {
  return Boolean(getSceneWarfareEncounterState(scene)?.active);
}
