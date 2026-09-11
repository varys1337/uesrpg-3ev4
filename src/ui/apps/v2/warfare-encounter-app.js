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
import { activateOpenApplication } from "./application-focus.js";
import { t } from "../../../utils/i18n.js";
import { isMassCombatEnabled, requireMassCombatEnabled } from "../../../core/homebrew/settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const APP_TEMPLATE = templatePath("v2/apps/warfare-encounter/app.hbs");
const _openApps = new Map();
const _hookIds = [];

function _sideLabel(side) {
  if (side === WARFARE_ENCOUNTER_SIDES.ALLIES) return t("UESRPG.Apps.WarfareEncounter.Allies", "Allies");
  if (side === WARFARE_ENCOUNTER_SIDES.ENEMIES) return t("UESRPG.Apps.WarfareEncounter.Enemies", "Enemies");
  return t("UESRPG.Apps.WarfareEncounter.Neutral", "Neutral");
}

function _phaseLabel(phase) {
  if (phase === WARFARE_ENCOUNTER_PHASES.STRATEGIC) return t("UESRPG.Apps.WarfareEncounter.Strategic", "Strategic");
  if (phase === WARFARE_ENCOUNTER_PHASES.CLASH) return t("UESRPG.Apps.WarfareEncounter.Clash", "Clash");
  return t("UESRPG.Apps.WarfareEncounter.Charge", "Charge");
}

function _nextPhaseLabel(phase) {
  if (phase === WARFARE_ENCOUNTER_PHASES.CHARGE) return t("UESRPG.Apps.WarfareEncounter.Strategic", "Strategic");
  if (phase === WARFARE_ENCOUNTER_PHASES.STRATEGIC) return t("UESRPG.Apps.WarfareEncounter.Clash", "Clash");
  return t("UESRPG.Apps.WarfareEncounter.NextRoundCharge", "Next Round: Charge");
}

function _registerHooks() {
  if (_hookIds.length) return;

  _hookIds.push(Hooks.on("updateScene", (scene, changed) => {
    if (!isMassCombatEnabled()) return;
    const sceneFlagsChanged = changed?.flags?.["uesrpg-3ev4"]?.warfareEncounter !== undefined
      || foundry.utils.hasProperty(changed, "flags.uesrpg-3ev4.warfareEncounter");
    if (!sceneFlagsChanged) return;
    const app = _openApps.get(String(scene?.uuid ?? ""));
    app?._queueRender?.();
  }));
}

function _unregisterHooksIfIdle() {
  if (_openApps.size) return;
  for (const hookId of _hookIds.splice(0)) Hooks.off("updateScene", hookId);
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
  _renderFrameId = null;

  static DEFAULT_OPTIONS = {
    classes: ["uesrpg", "uesrpg-warfare-encounter"],
    position: { width: 640, height: 520 },
    window: {
      title: "UESRPG.Apps.WarfareEncounter.Title",
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
  }

  _queueRender() {
    if (this._renderFrameId != null) return;
    this._renderFrameId = requestAnimationFrame(() => {
      this._renderFrameId = null;
      void this.render();
    });
  }

  get title() {
    const baseTitle = t("UESRPG.Apps.WarfareEncounter.Title", "Warfare Encounter");
    return this._scene ? `${baseTitle} - ${this._scene.name}` : baseTitle;
  }

  get _scene() {
    if (!this._sceneUuid) return null;
    const resolved = typeof fromUuidSync === "function" ? fromUuidSync(this._sceneUuid) : null;
    return resolved ?? game.scenes?.get?.(this._sceneUuid.split(".").pop()) ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (!isMassCombatEnabled()) {
      return {
        ...context,
        error: t(
          "UESRPG.Notifications.MassCombatMechanicsDisabled",
          "Enable Warfare in Configure Homebrew before using Warfare mechanics.",
        ),
      };
    }
    const scene = this._scene;
    if (!scene || scene.documentName !== "Scene") {
      return {
        ...context,
        error: t("UESRPG.Apps.WarfareEncounter.SceneNotFound", "Scene not found."),
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
    _registerHooks();
  }

  _onClose(options) {
    _openApps.delete(String(this._sceneUuid ?? ""));
    if (this._renderFrameId != null) cancelAnimationFrame(this._renderFrameId);
    this._renderFrameId = null;
    _unregisterHooksIfIdle();
    return super._onClose(options);
  }

  async _onStartEncounter(event) {
    event?.preventDefault?.();
    if (!requireMassCombatEnabled()) return;
    const scene = this._scene;
    if (!scene) return;
    await startWarfareEncounter(scene);
    await this.render();
  }

  async _onAdvanceEncounter(event) {
    event?.preventDefault?.();
    if (!requireMassCombatEnabled()) return;
    const scene = this._scene;
    if (!scene) return;
    await advanceWarfareEncounter(scene);
    await this.render();
  }

  async _onPassStrategic(event) {
    event?.preventDefault?.();
    if (!requireMassCombatEnabled()) return;
    const scene = this._scene;
    if (!scene) return;
    await passWarfareEncounterStrategic(scene);
    await this.render();
  }

  async _onEndEncounter(event) {
    event?.preventDefault?.();
    if (!requireMassCombatEnabled()) return;
    const scene = this._scene;
    if (!scene) return;
    await endWarfareEncounter(scene);
    await this.render();
  }
}

function _findTokenName(scene, tokenUuid) {
  const tokenDoc = Array.from(scene?.tokens?.contents ?? []).find((entry) => String(entry?.uuid ?? "") === String(tokenUuid ?? ""));
  return tokenDoc?.actor?.name ?? tokenDoc?.name ?? t("UESRPG.UI.Unknown", "Unknown");
}

export async function openWarfareEncounterApp(scene) {
  if (!requireMassCombatEnabled()) return null;
  if (!scene) return null;
  const sceneUuid = String(scene.uuid ?? "");
  const existing = _openApps.get(sceneUuid);
  if (existing) {
    return activateOpenApplication(existing, { render: true });
  }

  const app = new WarfareEncounterAppV2(scene, {
    id: `uesrpg-warfare-encounter-${scene.id}`,
  });
  await app.render(true);
  return app;
}

export async function closeOpenWarfareEncounterApps() {
  const apps = Array.from(_openApps.values());
  await Promise.allSettled(apps.map((app) => app.close()));
}
