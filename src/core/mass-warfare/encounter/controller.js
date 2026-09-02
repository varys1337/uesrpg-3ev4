import { FLAG_SCOPE } from "../../constants.js";
import {
  requestBatchUpdateDocuments,
  requestDeleteEmbeddedDocuments,
} from "../../../utils/authority-proxy.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { readClashState } from "../clash/pending.js";
import {
  WARFARE_ENCOUNTER_PHASES,
  WARFARE_ENCOUNTER_SIDES,
  defaultEncounterSideFromDisposition,
  getEncounterSceneForActor,
  getEncounterTokenDocForActor,
  getSceneWarfareEncounterState,
  getWarfareUnitTokenDocs,
  updateSceneWarfareEncounterState,
} from "./state.js";
import {
  areTokensInBaseContact,
  getDistanceToBattlefieldEdge,
  getEnemyContactTokenDocs,
  getNearestBattlefieldEdge,
  validateChargeRoute,
} from "../battlefield/geometry.js";
import { createDefaultBattlefieldUnitState } from "../battlefield/state.js";
import { buildClashGroupForPair } from "../battlefield/groups.js";
import { getWarfareTerrainAtPoint } from "../battlefield/terrain.js";

const ONE_ROUND_WARFARE_EFFECT_KEYS = new Set([
  "joinFrayNextClash",
  "holdNextDefend",
  "charge",
]);

function _uiWarn(message) {
  ui.notifications?.warn?.(message);
}

function _resolveScene(scene) {
  return scene ?? game?.scenes?.current ?? null;
}

function _oppositeSide(side) {
  return side === WARFARE_ENCOUNTER_SIDES.ENEMIES
    ? WARFARE_ENCOUNTER_SIDES.ALLIES
    : WARFARE_ENCOUNTER_SIDES.ENEMIES;
}

function _roundValue(value) {
  return Math.max(1, Number(value ?? 1) || 1);
}

function _getClashLogStatus(messageId) {
  const message = messageId ? game.messages?.get?.(String(messageId)) ?? null : null;
  if (!message) return messageId ? "cancelled" : "pending-card";
  const clashState = readClashState(message);
  return clashState?.phase === "resolved" ? "resolved" : "pending-card";
}

function _normalizeClashLogStatuses(state) {
  const next = foundry.utils.deepClone(state);
  next.clashLog = Array.from(next.clashLog ?? []).map((entry) => ({
    ...entry,
    status: _getClashLogStatus(entry?.messageId ?? ""),
  }));
  return next;
}

function _resolveTargetedWarfareToken() {
  const targets = Array.from(game?.user?.targets ?? []);
  if (targets.length !== 1) {
    _uiWarn("Target exactly one opposing Warfare Unit token.");
    return null;
  }
  const token = targets[0];
  if (token?.actor?.type !== "Warfare Unit") {
    _uiWarn("The targeted token must belong to a Warfare Unit.");
    return null;
  }
  return token.document ?? null;
}

async function _promptChargeSide(actorName, defenderName) {
  return customDialog({
    layout: "workflow",
    title: `${actorName} - Declare Charge`,
    content: `
      <div class="warfare-discipline-dialog">
        <p>Choose which side of <b>${foundry.utils.escapeHTML(defenderName)}</b> this charge will target.</p>
        <div class="form-group">
          <label>Target Side</label>
          <select name="targetContactSide">
            <option value="front">Front</option>
            <option value="flank">Flank</option>
            <option value="rear">Rear</option>
          </select>
        </div>
      </div>`,
    buttons: {
      declare: {
        label: "Declare",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return String(root?.querySelector('[name="targetContactSide"]')?.value ?? "front");
        },
      },
      cancel: { label: "Cancel" },
    },
    defaultButton: "declare",
  });
}

function _getActorEncounterContext(scene, actor) {
  const tokenDoc = getEncounterTokenDocForActor(scene, actor);
  if (!tokenDoc) {
    return {
      tokenDoc: null,
      tokenUuid: "",
      side: WARFARE_ENCOUNTER_SIDES.NEUTRAL,
      defeated: false,
    };
  }
  return {
    tokenDoc,
    tokenUuid: String(tokenDoc.uuid ?? ""),
    side: defaultEncounterSideFromDisposition(tokenDoc),
    defeated: Boolean(tokenDoc.actor?.system?.status?.battle?.defeated),
  };
}

function _tokenCenterPoint(scene, tokenDoc) {
  const gridSize = Math.max(1, Number(scene?.grid?.size ?? canvas?.scene?.grid?.size ?? 100) || 100);
  return {
    x: (Number(tokenDoc?.x ?? 0) || 0) + ((Number(tokenDoc?.width ?? 1) || 1) * gridSize * 0.5),
    y: (Number(tokenDoc?.y ?? 0) || 0) + ((Number(tokenDoc?.height ?? 1) || 1) * gridSize * 0.5),
    elevation: Number(tokenDoc?.elevation ?? 0) || 0,
  };
}

function _isFriendlyDisposition(aTokenDoc, bTokenDoc) {
  const aDisposition = Number(aTokenDoc?.disposition ?? 0) || 0;
  const bDisposition = Number(bTokenDoc?.disposition ?? 0) || 0;
  if (!aDisposition || !bDisposition) return false;
  return Math.sign(aDisposition) === Math.sign(bDisposition);
}

function _currentChargeForTarget(state, defenderTokenUuid) {
  return Object.values(state?.charges ?? {}).filter((entry) =>
    String(entry?.targetTokenUuid ?? "") === String(defenderTokenUuid ?? "")
    && _roundValue(entry?.round ?? 1) === _roundValue(state?.round ?? 1)
  );
}

async function _synchronizeBattlefieldStateAndModifiers(scene) {
  if (!scene) return null;
  const state = getSceneWarfareEncounterState(scene);
  const actorUpdates = [];
  let battlefieldChanged = false;

  const nextBattlefieldUnits = foundry.utils.deepClone(state?.battlefield?.units ?? {});
  for (const tokenDoc of getWarfareUnitTokenDocs(scene)) {
    const tokenUuid = String(tokenDoc?.uuid ?? "");
    if (!tokenUuid) continue;
    const actor = tokenDoc.actor ?? null;
    const currentUnitState = nextBattlefieldUnits[tokenUuid] ?? createDefaultBattlefieldUnitState(tokenDoc);
    const routeState = actor?.system?.status?.battle?.routed
      ? "routed"
      : actor?.system?.status?.battle?.broken
        ? "broken"
        : "none";
    const routingEdge = routeState === "none"
      ? ""
      : String(currentUnitState?.routingEdge ?? "") || getNearestBattlefieldEdge(scene, tokenDoc);
    const normalizedUnitState = {
      routingEdge,
      routeState,
    };
    if (!foundry.utils.isEmpty(foundry.utils.diffObject(currentUnitState, normalizedUnitState))) {
      nextBattlefieldUnits[tokenUuid] = normalizedUnitState;
      battlefieldChanged = true;
    }

    const adjacentFriendlyBroken = getWarfareUnitTokenDocs(scene).some((candidate) => {
      if (!candidate || String(candidate.uuid ?? "") === tokenUuid) return false;
      if (!_isFriendlyDisposition(tokenDoc, candidate)) return false;
      if (!candidate.actor?.system?.status?.battle?.broken) return false;
      return areTokensInBaseContact(tokenDoc, candidate);
    });
    const rearCharged = _currentChargeForTarget(state, tokenUuid).some((entry) => String(entry?.targetContactSide ?? "") === "rear");
    const terrainAtPoint = getWarfareTerrainAtPoint(scene, _tokenCenterPoint(scene, tokenDoc));
    const defendingFortification = Array.from(terrainAtPoint?.features ?? []).some((feature) =>
      feature?.kind === "fortification" && feature?.intact && !feature?.breached && Number(feature?.defenseBonus ?? 0) > 0
    );
    const updateData = {};
    if (Boolean(actor?.system?.modifiers?.discipline?.battle?.adjacentFriendlyBroken) !== adjacentFriendlyBroken) {
      updateData["system.modifiers.discipline.battle.adjacentFriendlyBroken"] = adjacentFriendlyBroken;
    }
    if (Boolean(actor?.system?.modifiers?.discipline?.battle?.rearCharged) !== rearCharged) {
      updateData["system.modifiers.discipline.battle.rearCharged"] = rearCharged;
    }
    if (Boolean(actor?.system?.modifiers?.discipline?.campaign?.defendingAlliedSettlement) !== defendingFortification) {
      updateData["system.modifiers.discipline.campaign.defendingAlliedSettlement"] = defendingFortification;
    }
    if (Object.keys(updateData).length) actorUpdates.push({ docOrUuid: actor, updateData });
  }

  if (actorUpdates.length) await requestBatchUpdateDocuments(actorUpdates);
  if (battlefieldChanged) {
    return updateSceneWarfareEncounterState(scene, {
      battlefield: { units: nextBattlefieldUnits },
    });
  }
  return getSceneWarfareEncounterState(scene);
}

async function _processBrokenAndRoutedUnits(scene, state) {
  const actorUpdates = [];
  let battlefieldChanged = false;
  const nextUnits = foundry.utils.deepClone(state?.battlefield?.units ?? {});

  for (const tokenDoc of getWarfareUnitTokenDocs(scene)) {
    const actor = tokenDoc.actor ?? null;
    if (!actor) continue;
    const tokenUuid = String(tokenDoc.uuid ?? "");
    const unitState = nextUnits[tokenUuid] ?? createDefaultBattlefieldUnitState(tokenDoc);
    const edge = String(unitState.routingEdge ?? "") || getNearestBattlefieldEdge(scene, tokenDoc);
    const speedPixels = Math.max(1, Number(actor?.system?.stats?.speed?.value ?? 0) || 0)
      * Math.max(1, Number(scene?.grid?.size ?? canvas?.scene?.grid?.size ?? 100) || 100);
    const distanceToEdge = getDistanceToBattlefieldEdge(scene, tokenDoc, edge);
    const isOutside = Number(tokenDoc?.x ?? 0) < 0
      || Number(tokenDoc?.y ?? 0) < 0
      || Number(tokenDoc?.x ?? 0) > Number(scene?.width ?? canvas?.scene?.width ?? 0)
      || Number(tokenDoc?.y ?? 0) > Number(scene?.height ?? canvas?.scene?.height ?? 0);

    if (actor.system?.status?.battle?.broken && !actor.system?.status?.battle?.routed) {
      actorUpdates.push({
        docOrUuid: actor,
        updateData: { "system.status.battle.routed": true },
      });
      nextUnits[tokenUuid] = { ...unitState, routingEdge: edge, routeState: "routed" };
      battlefieldChanged = true;
      continue;
    }

    if (actor.system?.status?.battle?.routed) {
      nextUnits[tokenUuid] = { ...unitState, routingEdge: edge, routeState: "routed" };
      battlefieldChanged = true;
      if (isOutside && distanceToEdge > speedPixels && !actor.system?.status?.battle?.defeated) {
        actorUpdates.push({
          docOrUuid: actor,
          updateData: { "system.status.battle.defeated": true },
        });
      }
    }
  }

  if (actorUpdates.length) await requestBatchUpdateDocuments(actorUpdates);
  if (battlefieldChanged) {
    await updateSceneWarfareEncounterState(scene, {
      battlefield: { units: nextUnits },
    });
  }
}

async function _clearWarfareActorRoundState(actor, {
  clearRallyBonus = false,
  clearEnemyBrokenBonus = false,
  clearRearCharged = false,
  clearOneRoundEffects = false,
} = {}) {
  if (!actor) return;

  const updateData = {};
  if (clearRallyBonus && actor.system?.modifiers?.discipline?.battle?.rallyBonus) {
    updateData["system.modifiers.discipline.battle.rallyBonus"] = false;
  }
  if (clearEnemyBrokenBonus && actor.system?.modifiers?.discipline?.battle?.enemyBrokenBonus) {
    updateData["system.modifiers.discipline.battle.enemyBrokenBonus"] = false;
  }
  if (clearRearCharged && actor.system?.modifiers?.discipline?.battle?.rearCharged) {
    updateData["system.modifiers.discipline.battle.rearCharged"] = false;
  }

  if (Object.keys(updateData).length) {
    await requestBatchUpdateDocuments([{ docOrUuid: actor, updateData }]);
  }

  if (!clearOneRoundEffects) return;
  const ids = Array.from(actor.effects ?? [])
    .filter((effect) => !effect.disabled && ONE_ROUND_WARFARE_EFFECT_KEYS.has(String(effect?.flags?.[FLAG_SCOPE]?.key ?? "")))
    .map((effect) => effect.id)
    .filter(Boolean);
  if (ids.length) await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", ids);
}

async function _clearEncounterCleanupState(scene) {
  for (const tokenDoc of getWarfareUnitTokenDocs(scene)) {
    const actor = tokenDoc.actor ?? null;
    if (!actor) continue;
    await _clearWarfareActorRoundState(actor, {
      clearEnemyBrokenBonus: true,
      clearRearCharged: true,
      clearOneRoundEffects: true,
    });
  }
}

async function _showEncounterGateWarning(scene, message, { openAppOnFail = false } = {}) {
  _uiWarn(message);
  if (openAppOnFail && scene) await openWarfareEncounterApp(scene);
}

export function getWarfareEncounterState(scene) {
  const resolvedScene = _resolveScene(scene);
  return getSceneWarfareEncounterState(resolvedScene);
}

export async function synchronizeWarfareEncounter(scene) {
  const resolvedScene = _resolveScene(scene);
  if (!resolvedScene) return null;
  const synchronized = await updateSceneWarfareEncounterState(resolvedScene, (current) => _normalizeClashLogStatuses(current));
  await _synchronizeBattlefieldStateAndModifiers(resolvedScene);
  return synchronized;
}

export async function startWarfareEncounter(scene) {
  const resolvedScene = _resolveScene(scene);
  if (!resolvedScene) return null;
  const started = await updateSceneWarfareEncounterState(resolvedScene, (current) => ({
    ...current,
    active: true,
    round: 1,
    phase: WARFARE_ENCOUNTER_PHASES.CHARGE,
    prioritySide: current.prioritySide === WARFARE_ENCOUNTER_SIDES.ENEMIES
      ? WARFARE_ENCOUNTER_SIDES.ENEMIES
      : WARFARE_ENCOUNTER_SIDES.ALLIES,
    currentSide: current.prioritySide === WARFARE_ENCOUNTER_SIDES.ENEMIES
      ? WARFARE_ENCOUNTER_SIDES.ENEMIES
      : WARFARE_ENCOUNTER_SIDES.ALLIES,
    activations: {},
    charges: {},
    clashLog: [],
  }));
  await _synchronizeBattlefieldStateAndModifiers(resolvedScene);
  return started;
}

export async function endWarfareEncounter(scene) {
  const resolvedScene = _resolveScene(scene);
  if (!resolvedScene) return null;
  const ended = await updateSceneWarfareEncounterState(resolvedScene, (current) => ({
    ...current,
    active: false,
    round: 1,
    phase: WARFARE_ENCOUNTER_PHASES.CHARGE,
    currentSide: current.prioritySide === WARFARE_ENCOUNTER_SIDES.ENEMIES
      ? WARFARE_ENCOUNTER_SIDES.ENEMIES
      : WARFARE_ENCOUNTER_SIDES.ALLIES,
    activations: {},
    charges: {},
    clashLog: [],
  }));
  await _synchronizeBattlefieldStateAndModifiers(resolvedScene);
  return ended;
}

export async function advanceWarfareEncounter(scene) {
  const resolvedScene = _resolveScene(scene);
  if (!resolvedScene) return null;

  const current = await synchronizeWarfareEncounter(resolvedScene);
  if (!current?.active) {
    _uiWarn("Start the warfare encounter before advancing phases.");
    return current;
  }

  if (current.phase === WARFARE_ENCOUNTER_PHASES.CHARGE) {
    return updateSceneWarfareEncounterState(resolvedScene, {
      phase: WARFARE_ENCOUNTER_PHASES.STRATEGIC,
      currentSide: current.prioritySide,
    });
  }

  if (current.phase === WARFARE_ENCOUNTER_PHASES.STRATEGIC) {
    return updateSceneWarfareEncounterState(resolvedScene, {
      phase: WARFARE_ENCOUNTER_PHASES.CLASH,
    });
  }

  await _processBrokenAndRoutedUnits(resolvedScene, current);
  await _clearEncounterCleanupState(resolvedScene);
  const advanced = await updateSceneWarfareEncounterState(resolvedScene, (state) => {
    const nextPrioritySide = _oppositeSide(state.prioritySide);
    state.round = _roundValue(state.round) + 1;
    state.phase = WARFARE_ENCOUNTER_PHASES.CHARGE;
    state.prioritySide = nextPrioritySide;
    state.currentSide = nextPrioritySide;
    state.activations = {};
    state.charges = {};
    return state;
  });
  await _synchronizeBattlefieldStateAndModifiers(resolvedScene);
  return advanced;
}

export async function passWarfareEncounterStrategic(scene) {
  const resolvedScene = _resolveScene(scene);
  if (!resolvedScene) return null;
  const current = getSceneWarfareEncounterState(resolvedScene);
  if (!current?.active) return current;
  if (current.phase !== WARFARE_ENCOUNTER_PHASES.STRATEGIC) {
    _uiWarn("Passing is only available during the Strategic phase.");
    return current;
  }
  return updateSceneWarfareEncounterState(resolvedScene, {
    currentSide: _oppositeSide(current.currentSide),
  });
}

export async function ensureEncounterAllowsUtilityAction(actor, {
  actionLabel = "This action",
  openAppOnFail = false,
} = {}) {
  const scene = getEncounterSceneForActor(actor);
  if (!scene) return { allowed: true, scene: null, state: null };

  const state = getSceneWarfareEncounterState(scene);
  if (!state?.active) return { allowed: true, scene, state };

  await _showEncounterGateWarning(
    scene,
    `${actionLabel} is blocked during an active warfare encounter.`,
    { openAppOnFail },
  );
  return { allowed: false, scene, state };
}

export async function ensureEncounterAllowsActorAction(actor, {
  actionLabel = "This action",
  openAppOnFail = false,
} = {}) {
  const scene = getEncounterSceneForActor(actor);
  if (!scene) return { allowed: true, scene: null, state: null, tokenDoc: null, tokenUuid: "", side: null };

  const state = getSceneWarfareEncounterState(scene);
  if (!state?.active) return { allowed: true, scene, state, tokenDoc: null, tokenUuid: "", side: null };

  const context = _getActorEncounterContext(scene, actor);
  if (!context.tokenUuid) {
    await _showEncounterGateWarning(
      scene,
      `${actionLabel} requires this Warfare Unit to have a token on the active encounter scene.`,
      { openAppOnFail },
    );
    return { allowed: false, scene, state, ...context };
  }
  if (context.side === WARFARE_ENCOUNTER_SIDES.NEUTRAL) {
    await _showEncounterGateWarning(
      scene,
      `${actionLabel} is blocked because neutral Warfare Unit tokens do not participate in encounter sequencing.`,
      { openAppOnFail },
    );
    return { allowed: false, scene, state, ...context };
  }
  if (context.defeated) {
    await _showEncounterGateWarning(
      scene,
      `${actionLabel} is blocked because this Warfare Unit is defeated.`,
      { openAppOnFail },
    );
    return { allowed: false, scene, state, ...context };
  }
  if (state.phase !== WARFARE_ENCOUNTER_PHASES.STRATEGIC) {
    await _showEncounterGateWarning(
      scene,
      `${actionLabel} can only be used during the Strategic phase of an active warfare encounter.`,
      { openAppOnFail },
    );
    return { allowed: false, scene, state, ...context };
  }
  if (context.side !== state.currentSide) {
    await _showEncounterGateWarning(
      scene,
      `${actionLabel} is blocked because it is currently ${state.currentSide === WARFARE_ENCOUNTER_SIDES.ENEMIES ? "the Enemies" : "the Allies"} side's turn to act.`,
      { openAppOnFail },
    );
    return { allowed: false, scene, state, ...context };
  }
  if (Math.max(0, Number(state.activations?.[context.tokenUuid] ?? 0) || 0) === Math.max(1, Number(state.round ?? 1) || 1)) {
    await _showEncounterGateWarning(
      scene,
      `${actionLabel} is blocked because this Warfare Unit has already acted during the current Strategic phase.`,
      { openAppOnFail },
    );
    return { allowed: false, scene, state, ...context };
  }

  return { allowed: true, scene, state, ...context };
}

export async function commitWarfareEncounterStrategicActivation(actor, {
  gate = null,
} = {}) {
  const resolvedGate = gate?.allowed ? gate : await ensureEncounterAllowsActorAction(actor, { openAppOnFail: false });
  if (!resolvedGate?.allowed || !resolvedGate.scene || !resolvedGate.tokenUuid) return false;

  await _clearWarfareActorRoundState(actor, { clearRallyBonus: true });
  await updateSceneWarfareEncounterState(resolvedGate.scene, (state) => {
    state.activations = {
      ...(state.activations ?? {}),
      [resolvedGate.tokenUuid]: Math.max(1, Number(state.round ?? 1) || 1),
    };
    state.currentSide = _oppositeSide(resolvedGate.side);
    return state;
  });
  return true;
}

export async function declareWarfareEncounterChargeForActor(actor, {
  actionLabel = "Charge",
  targetTokenDoc = null,
} = {}) {
  const scene = getEncounterSceneForActor(actor);
  if (!scene) return { handled: false, declared: false, scene: null, state: null };

  const state = getSceneWarfareEncounterState(scene);
  if (!state?.active) return { handled: false, declared: false, scene, state };

  const context = _getActorEncounterContext(scene, actor);
  if (!context.tokenUuid) {
    await _showEncounterGateWarning(
      scene,
      `${actionLabel} requires this Warfare Unit to have a token on the active encounter scene.`,
    );
    return { handled: true, declared: false, scene, state };
  }
  if (context.side === WARFARE_ENCOUNTER_SIDES.NEUTRAL || context.defeated) {
    await _showEncounterGateWarning(scene, `${actionLabel} is blocked for neutral or defeated Warfare Units.`);
    return { handled: true, declared: false, scene, state };
  }
  if (state.phase !== WARFARE_ENCOUNTER_PHASES.CHARGE) {
    await _showEncounterGateWarning(scene, `${actionLabel} can only be declared during the Charge phase.`);
    return { handled: true, declared: false, scene, state };
  }
  if (actor?.system?.status?.battle?.broken || actor?.system?.status?.battle?.routed) {
    await _showEncounterGateWarning(scene, `${actionLabel} is blocked because Broken or Routed units cannot declare charges.`);
    return { handled: true, declared: false, scene, state };
  }
  if (getEnemyContactTokenDocs(scene, context.tokenDoc).length) {
    await _showEncounterGateWarning(scene, `${actionLabel} is blocked because the unit is already in enemy contact.`);
    return { handled: true, declared: false, scene, state };
  }
  if (state?.charges?.[context.tokenUuid] && _roundValue(state.charges[context.tokenUuid]?.round) === _roundValue(state.round)) {
    await _showEncounterGateWarning(scene, `${actionLabel} is blocked because this unit has already declared a charge this round.`);
    return { handled: true, declared: false, scene, state };
  }

  const defenderTokenDoc = targetTokenDoc ?? _resolveTargetedWarfareToken();
  if (!defenderTokenDoc) return { handled: true, declared: false, scene, state };
  if (String(defenderTokenDoc?.parent?.id ?? "") !== String(scene.id ?? "")) {
    await _showEncounterGateWarning(scene, "The charge target must be a token on the active encounter scene.");
    return { handled: true, declared: false, scene, state };
  }
  if (String(defenderTokenDoc?.uuid ?? "") === context.tokenUuid) {
    _uiWarn("A unit cannot declare a charge against itself.");
    return { handled: true, declared: false, scene, state };
  }
  if (defenderTokenDoc?.actor?.type !== "Warfare Unit") {
    _uiWarn("The charge target must be a Warfare Unit token.");
    return { handled: true, declared: false, scene, state };
  }

  const defenderSide = defaultEncounterSideFromDisposition(defenderTokenDoc);
  const defenderDefeated = Boolean(defenderTokenDoc.actor?.system?.status?.battle?.defeated);
  if (defenderSide === WARFARE_ENCOUNTER_SIDES.NEUTRAL || defenderDefeated || defenderSide === context.side) {
    _uiWarn("Charge requires one targeted opposing, non-neutral, undefeated Warfare Unit token.");
    return { handled: true, declared: false, scene, state };
  }

  const targetContactSide = await _promptChargeSide(actor?.name ?? "Unit", defenderTokenDoc.actor?.name ?? defenderTokenDoc.name ?? "Target");
  if (!targetContactSide) return { handled: true, declared: false, scene, state };

  const route = validateChargeRoute({
    scene,
    attackerTokenDoc: context.tokenDoc,
    defenderTokenDoc,
    targetContactSide,
    maxCost: Math.max(0, Number(actor?.system?.stats?.speed?.value ?? 0) || 0),
  });
  if (!route.ok) {
    _uiWarn(route.reason || "No legal charge path could be found for that target side.");
    return { handled: true, declared: false, scene, state };
  }

  const clashGroup = buildClashGroupForPair(scene, state?.battlefield?.units ?? {}, {
    attackerTokenDoc: context.tokenDoc,
    defenderTokenDoc,
  });

  await updateSceneWarfareEncounterState(scene, (next) => {
    next.charges = {
      ...(next.charges ?? {}),
      [context.tokenUuid]: {
        attackerTokenUuid: context.tokenUuid,
        targetTokenUuid: String(defenderTokenDoc.uuid ?? ""),
        round: _roundValue(next.round),
        pathCost: Math.max(0, Number(route.pathCost ?? 0) || 0),
        targetContactSide,
        clashGroupId: String(clashGroup.clashGroupId ?? ""),
        messageId: "",
      },
    };
    return next;
  });

  await _synchronizeBattlefieldStateAndModifiers(scene);

  return {
    handled: true,
    declared: true,
    scene,
    state,
    attackerTokenUuid: context.tokenUuid,
    targetTokenUuid: String(defenderTokenDoc.uuid ?? ""),
    pathCost: Math.max(0, Number(route.pathCost ?? 0) || 0),
    targetContactSide,
    clashGroupId: String(clashGroup.clashGroupId ?? ""),
  };
}

export async function validateWarfareEncounterClash(actor, {
  actionLabel = "Initiate Clash",
  targetTokenDoc = null,
} = {}) {
  const scene = getEncounterSceneForActor(actor);
  if (!scene) return { active: false, allowed: true, scene: null, state: null };

  const state = getSceneWarfareEncounterState(scene);
  if (!state?.active) return { active: false, allowed: true, scene, state };

  const context = _getActorEncounterContext(scene, actor);
  if (!context.tokenUuid) {
    await _showEncounterGateWarning(
      scene,
      `${actionLabel} requires this Warfare Unit to have a token on the active encounter scene.`,
    );
    return { active: true, allowed: false, scene, state };
  }
  if (context.side === WARFARE_ENCOUNTER_SIDES.NEUTRAL || context.defeated) {
    await _showEncounterGateWarning(scene, `${actionLabel} is blocked for neutral or defeated Warfare Units.`);
    return { active: true, allowed: false, scene, state };
  }
  if (state.phase !== WARFARE_ENCOUNTER_PHASES.CLASH) {
    await _showEncounterGateWarning(scene, `${actionLabel} can only be used during the Clash phase of an active warfare encounter.`);
    return { active: true, allowed: false, scene, state };
  }
  if (actor?.system?.status?.battle?.broken || actor?.system?.status?.battle?.routed) {
    await _showEncounterGateWarning(scene, `${actionLabel} is blocked because Broken or Routed units cannot initiate clashes.`);
    return { active: true, allowed: false, scene, state };
  }

  const defenderToken = targetTokenDoc ?? _resolveTargetedWarfareToken();
  if (!defenderToken) return { active: true, allowed: false, scene, state };
  if (String(defenderToken?.parent?.id ?? "") !== String(scene.id ?? "")) {
    _uiWarn("The targeted Warfare Unit must be on the active encounter scene.");
    return { active: true, allowed: false, scene, state };
  }
  if (defenderToken?.actor?.type !== "Warfare Unit") {
    _uiWarn("The targeted token must be a Warfare Unit.");
    return { active: true, allowed: false, scene, state };
  }

  const defenderSide = defaultEncounterSideFromDisposition(defenderToken);
  const defenderDefeated = Boolean(defenderToken.actor?.system?.status?.battle?.defeated);
  if (String(defenderToken.uuid ?? "") === context.tokenUuid || defenderSide === WARFARE_ENCOUNTER_SIDES.NEUTRAL || defenderDefeated || defenderSide === context.side) {
    _uiWarn("Clash requires one targeted opposing, non-neutral, undefeated Warfare Unit token.");
    return { active: true, allowed: false, scene, state };
  }

  const declaration = state.charges?.[context.tokenUuid] ?? null;
  if (declaration?.targetTokenUuid && String(declaration.targetTokenUuid) !== String(defenderToken.uuid ?? "")) {
    _uiWarn("This Warfare Unit declared a charge this round and must clash the declared target.");
    return { active: true, allowed: false, scene, state };
  }

  const attackerDeclaration = declaration && _roundValue(declaration.round) === _roundValue(state.round) ? declaration : null;
  const defenderDeclaration = state?.charges?.[String(defenderToken.uuid ?? "")] ?? null;
  const activeDefenderDeclaration = defenderDeclaration && _roundValue(defenderDeclaration.round) === _roundValue(state.round)
    ? defenderDeclaration
    : null;
  const clashGroup = buildClashGroupForPair(scene, state?.battlefield?.units ?? {}, {
    attackerTokenDoc: context.tokenDoc,
    defenderTokenDoc: defenderToken,
  });

  return {
    active: true,
    allowed: true,
    scene,
    state,
    attackerTokenDoc: context.tokenDoc,
    defenderTokenDoc: defenderToken,
    attackerTokenUuid: context.tokenUuid,
    defenderTokenUuid: String(defenderToken.uuid ?? ""),
    attackerCharged: Boolean(attackerDeclaration && String(attackerDeclaration.targetTokenUuid ?? "") === String(defenderToken.uuid ?? "")),
    defenderCharged: Boolean(activeDefenderDeclaration && String(activeDefenderDeclaration.targetTokenUuid ?? "") === String(context.tokenUuid ?? "")),
    attackerChargeSide: String(attackerDeclaration?.targetContactSide ?? clashGroup.attackerContactSide ?? "front"),
    defenderChargeSide: String(activeDefenderDeclaration?.targetContactSide ?? clashGroup.defenderContactSide ?? "front"),
    clashGroupId: String(clashGroup.clashGroupId ?? ""),
    groupMembers: Array.from(clashGroup.groupMembers ?? []),
    attackerContactSide: String(clashGroup.attackerContactSide ?? "front"),
    defenderContactSide: String(clashGroup.defenderContactSide ?? "front"),
  };
}

export async function recordWarfareEncounterClash(actor, {
  attackerTokenUuid = "",
  defenderTokenUuid = "",
  attackType = "melee",
  clashGroupId = "",
  groupMembers = [],
  attackerContactSide = "front",
  defenderContactSide = "front",
  commanderJoinFray = { unit1: null, unit2: null },
  messageId = "",
} = {}) {
  const scene = getEncounterSceneForActor(actor);
  if (!scene || !messageId || !attackerTokenUuid || !defenderTokenUuid) return null;

  const state = getSceneWarfareEncounterState(scene);
  if (!state?.active) return state;

  return updateSceneWarfareEncounterState(scene, (next) => {
    const round = Math.max(1, Number(next.round ?? 1) || 1);
    const normalizedAttackType = String(attackType ?? "").trim().toLowerCase() === "ranged" ? "ranged" : "melee";
    next.clashLog = Array.from(next.clashLog ?? []);

    const existingIndex = next.clashLog.findIndex((entry) => String(entry.messageId ?? "") === String(messageId));
    const clashEntry = {
      id: existingIndex >= 0 ? String(next.clashLog[existingIndex]?.id ?? foundry.utils.randomID()) : foundry.utils.randomID(),
      round,
      attackerTokenUuid: String(attackerTokenUuid),
      defenderTokenUuid: String(defenderTokenUuid),
      attackType: normalizedAttackType,
      clashGroupId: String(clashGroupId ?? ""),
      groupMembers: Array.isArray(groupMembers) ? groupMembers.map((value) => String(value ?? "")).filter(Boolean) : [],
      attackerContactSide: new Set(["front", "flank", "rear"]).has(String(attackerContactSide ?? "").trim().toLowerCase())
        ? String(attackerContactSide).trim().toLowerCase()
        : "front",
      defenderContactSide: new Set(["front", "flank", "rear"]).has(String(defenderContactSide ?? "").trim().toLowerCase())
        ? String(defenderContactSide).trim().toLowerCase()
        : "front",
      commanderJoinFray: {
        unit1: commanderJoinFray?.unit1 ?? null,
        unit2: commanderJoinFray?.unit2 ?? null,
      },
      messageId: String(messageId),
      status: _getClashLogStatus(messageId),
    };

    if (existingIndex >= 0) next.clashLog[existingIndex] = clashEntry;
    else next.clashLog.push(clashEntry);

    const existingCharge = next.charges?.[attackerTokenUuid] ?? null;
    if (existingCharge && String(existingCharge.targetTokenUuid ?? "") === String(defenderTokenUuid)) {
      next.charges = {
        ...(next.charges ?? {}),
        [attackerTokenUuid]: {
          ...existingCharge,
          messageId: String(messageId),
        },
      };
    }
    return next;
  });
}

export async function syncWarfareEncounterForChatMessage(message) {
  if (!message?.id) return false;
  const scenes = Array.from(game?.scenes?.contents ?? []);
  let updated = false;
  for (const scene of scenes) {
    const current = getSceneWarfareEncounterState(scene);
    if (!Array.from(current?.clashLog ?? []).some((entry) => String(entry.messageId ?? "") === String(message.id))) continue;
    await updateSceneWarfareEncounterState(scene, (state) => _normalizeClashLogStatuses(state));
    await _synchronizeBattlefieldStateAndModifiers(scene);
    updated = true;
  }
  return updated;
}

export async function openWarfareEncounterApp(scene = null) {
  const resolvedScene = _resolveScene(scene);
  if (!resolvedScene) {
    _uiWarn("Open a scene before launching the warfare encounter app.");
    return null;
  }
  const module = await import("../../../ui/apps/v2/warfare-encounter-app.js");
  return module.openWarfareEncounterApp(resolvedScene);
}
