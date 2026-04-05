import { templatePath } from "../../constants.js";
import {
  advanceWarfareEncounter,
  endWarfareEncounter,
  getWarfareEncounterState,
  passWarfareEncounterStrategic,
  startWarfareEncounter,
} from "../../../core/mass-warfare/encounter/controller.js";
import {
  WARFARE_ENCOUNTER_PHASES,
  WARFARE_ENCOUNTER_SIDES,
  defaultEncounterSideFromDisposition,
  getWarfareUnitTokenDocs,
} from "../../../core/mass-warfare/encounter/state.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const APP_TEMPLATE = templatePath("v2/apps/warfare-encounter/app.hbs");
const _openApps = new Map();
let _hooksRegistered = false;

function _sideLabel(side) {
  if (side === WARFARE_ENCOUNTER_SIDES.ALLIES) return "Allies";
  if (side === WARFARE_ENCOUNTER_SIDES.ENEMIES) return "Enemies";
  return "Neutral";
}

function _phaseLabel(phase) {
  if (phase === WARFARE_ENCOUNTER_PHASES.STRATEGIC) return "Strategic";
  if (phase === WARFARE_ENCOUNTER_PHASES.CLASH) return "Clash";
  return "Charge";
}

function _nextPhaseLabel(phase) {
  if (phase === WARFARE_ENCOUNTER_PHASES.CHARGE) return "Strategic";
  if (phase === WARFARE_ENCOUNTER_PHASES.STRATEGIC) return "Clash";
  return "Next Round: Charge";
}

function _registerHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;

  Hooks.on("updateScene", (scene, changed) => {
    const sceneFlagsChanged = changed?.flags?.["uesrpg-3ev4"]?.warfareEncounter !== undefined
      || foundry.utils.hasProperty(changed, "flags.uesrpg-3ev4.warfareEncounter");
    if (!sceneFlagsChanged) return;
    const app = _openApps.get(String(scene?.uuid ?? ""));
    if (app) void app.render();
  });

  Hooks.on("updateChatMessage", () => {
    for (const app of _openApps.values()) void app.render();
  });
}

function _sceneUnitSummary(scene) {
  const summary = {
    total: 0,
    allies: 0,
    enemies: 0,
    neutral: 0,
    defeated: 0,
  };

  for (const tokenDoc of getWarfareUnitTokenDocs(scene)) {
    summary.total += 1;
    const side = defaultEncounterSideFromDisposition(tokenDoc);
    if (side === WARFARE_ENCOUNTER_SIDES.ALLIES) summary.allies += 1;
    else if (side === WARFARE_ENCOUNTER_SIDES.ENEMIES) summary.enemies += 1;
    else summary.neutral += 1;
    if (tokenDoc.actor?.system?.status?.battle?.defeated) summary.defeated += 1;
  }

  return summary;
}

export class WarfareEncounterAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["uesrpg", "uesrpg-warfare-encounter"],
    position: { width: 640, height: 520 },
    window: {
      title: "Warfare Encounter",
      resizable: true,
    },
    tag: "section",
    actions: {
      startEncounter: WarfareEncounterAppV2.prototype._onStartEncounter,
      advanceEncounter: WarfareEncounterAppV2.prototype._onAdvanceEncounter,
      passStrategic: WarfareEncounterAppV2.prototype._onPassStrategic,
      endEncounter: WarfareEncounterAppV2.prototype._onEndEncounter,
    },
  };

  static PARTS = {
    app: {
      template: APP_TEMPLATE,
      scrollable: [".uesrpg-warfare-encounter__body"],
    },
  };

  constructor(scene, options = {}) {
    super(options);
    this._sceneUuid = String(scene?.uuid ?? options?.sceneUuid ?? "");
    _registerHooks();
  }

  get title() {
    return this._scene ? `Warfare Encounter - ${this._scene.name}` : "Warfare Encounter";
  }

  get _scene() {
    if (!this._sceneUuid) return null;
    const resolved = typeof fromUuidSync === "function" ? fromUuidSync(this._sceneUuid) : null;
    return resolved ?? game.scenes?.get?.(this._sceneUuid.split(".").pop()) ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const scene = this._scene;
    if (!scene || scene.documentName !== "Scene") {
      return {
        ...context,
        error: "Scene not found.",
      };
    }

    const state = getWarfareEncounterState(scene);
    const unitSummary = _sceneUnitSummary(scene);
    const activations = Object.entries(state.activations ?? {})
      .filter(([, round]) => Math.max(0, Number(round ?? 0) || 0) === Math.max(1, Number(state.round ?? 1) || 1));
    const declaredCharges = Object.values(state.charges ?? {})
      .filter((entry) => Math.max(0, Number(entry?.round ?? 0) || 0) === Math.max(1, Number(state.round ?? 1) || 1));
    const latestClashes = Array.from(state.clashLog ?? [])
      .sort((a, b) => Number(b?.round ?? 0) - Number(a?.round ?? 0))
      .slice(0, 5)
      .map((entry) => ({
        ...entry,
        attackerName: _findTokenName(scene, entry.attackerTokenUuid),
        defenderName: _findTokenName(scene, entry.defenderTokenUuid),
      }));

    return {
      ...context,
      scene,
      state,
      editable: Boolean(game.user?.isGM),
      phaseLabel: _phaseLabel(state.phase),
      nextPhaseLabel: _nextPhaseLabel(state.phase),
      prioritySideLabel: _sideLabel(state.prioritySide),
      currentSideLabel: _sideLabel(state.currentSide),
      unitSummary,
      activationCount: activations.length,
      declaredChargeCount: declaredCharges.length,
      latestClashes,
      latestClashCount: latestClashes.length,
      isStrategicPhase: state.phase === WARFARE_ENCOUNTER_PHASES.STRATEGIC,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    _openApps.set(String(this._sceneUuid ?? ""), this);
  }

  _onClose(options) {
    _openApps.delete(String(this._sceneUuid ?? ""));
    return super._onClose(options);
  }

  async _onStartEncounter(event) {
    event?.preventDefault?.();
    const scene = this._scene;
    if (!scene) return;
    await startWarfareEncounter(scene);
    await this.render();
  }

  async _onAdvanceEncounter(event) {
    event?.preventDefault?.();
    const scene = this._scene;
    if (!scene) return;
    await advanceWarfareEncounter(scene);
    await this.render();
  }

  async _onPassStrategic(event) {
    event?.preventDefault?.();
    const scene = this._scene;
    if (!scene) return;
    await passWarfareEncounterStrategic(scene);
    await this.render();
  }

  async _onEndEncounter(event) {
    event?.preventDefault?.();
    const scene = this._scene;
    if (!scene) return;
    await endWarfareEncounter(scene);
    await this.render();
  }
}

function _findTokenName(scene, tokenUuid) {
  const tokenDoc = Array.from(scene?.tokens?.contents ?? []).find((entry) => String(entry?.uuid ?? "") === String(tokenUuid ?? ""));
  return tokenDoc?.actor?.name ?? tokenDoc?.name ?? "Unknown";
}

export async function openWarfareEncounterApp(scene) {
  if (!scene) return null;
  const sceneUuid = String(scene.uuid ?? "");
  const existing = _openApps.get(sceneUuid);
  if (existing) {
    await existing.render(true);
    return existing;
  }

  const app = new WarfareEncounterAppV2(scene, {
    id: `uesrpg-warfare-encounter-${scene.id}`,
  });
  await app.render(true);
  return app;
}
