const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

import { templatePath } from "../../constants.js";
import { confirmDialog, customDialog } from "../../../utils/dialog-v2-helper.js";
import { requestBatchUpdateDocuments } from "../../../utils/authority-proxy.js";
import {
  createArmyCampaignHistoryEntry,
  deriveArmyCampaignStateForGroup,
  getArmyCampaignMemberActors,
  getArmyCampaignState,
  getArmyCampaignWarfareMembers,
  updateArmyCampaignState,
  WARFARE_ARMY_ACTIONS_PER_TURN,
} from "../../../core/mass-warfare/campaign/state.js";
import {
  createDefaultWarfareSiegeState,
  getRegionWarfareFeatureState,
  getSceneWarfareSiegeState,
  updateRegionWarfareFeatureState,
  updateSceneWarfareSiegeState,
  WARFARE_FEATURE_TYPES,
} from "../../../core/mass-warfare/siege/state.js";
import { getActorSkillOptions, performTravelAssignmentRoll } from "../../../core/travel/rolls.js";
import { openWarfareEncounterApp } from "./warfare-encounter-app.js";
import { startWarfareEncounter } from "../../../core/mass-warfare/encounter/controller.js";
import { t, tf } from "../../../utils/i18n.js";
import { AdvanceCampaignTurnService } from "../../../application/campaign/advance-campaign-turn-service.js";
import { activateOpenApplication } from "./application-focus.js";

const TEMPLATE_PATH = templatePath("v2/apps/army-campaign/app.hbs");
const _openApps = new Map();
let _hooksRegistered = false;

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function titleCase(value, fallback = "Unset") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return text.split("-").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "").join(" ");
}

function normalizeGroup(groupActorOrUuid) {
  if (!groupActorOrUuid) return null;
  if (groupActorOrUuid?.documentName === "Actor" && String(groupActorOrUuid?.type ?? "") === "Group") return groupActorOrUuid;
  const raw = String(groupActorOrUuid?.uuid ?? groupActorOrUuid).trim();
  if (!raw) return null;
  if (typeof fromUuidSync === "function") {
    const resolved = fromUuidSync(raw);
    if (resolved?.documentName === "Actor" && String(resolved?.type ?? "") === "Group") return resolved;
  }
  return game.actors?.get?.(raw.split(".").pop()) ?? null;
}

function _registerHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;
  Hooks.on("updateActor", (actor, changed) => {
    if (String(actor?.type ?? "") !== "Group") return;
    const stateChanged = changed?.flags?.["uesrpg-3ev4"]?.massWarfareArmy !== undefined
      || foundry.utils.hasProperty(changed, "flags.uesrpg-3ev4.massWarfareArmy")
      || foundry.utils.hasProperty(changed, "system.members");
    if (!stateChanged) return;
    const app = _openApps.get(String(actor?.uuid ?? ""));
    if (app) void app.render();
  });
  Hooks.on("updateScene", (scene, changed) => {
    const siegeChanged = changed?.flags?.["uesrpg-3ev4"]?.warfareSiege !== undefined
      || foundry.utils.hasProperty(changed, "flags.uesrpg-3ev4.warfareSiege");
    if (!siegeChanged) return;
    for (const app of _openApps.values()) {
      if (String(app?._activeSiegeSceneUuid ?? "") === String(scene?.uuid ?? "")) void app.render();
    }
  });
}

async function chooseMember(group, title, { includeWarfareUnits = false } = {}) {
  const members = await getArmyCampaignMemberActors(group);
  const choices = members
    .filter((actor) => includeWarfareUnits || String(actor?.type ?? "") !== "Warfare Unit")
    .map((actor) => `<option value="${esc(actor.uuid)}">${esc(actor.name)} (${esc(actor.type)})</option>`)
    .join("");
  if (!choices) return null;
  const picked = await customDialog({
    layout: "workflow",
    title,
    content: `<div class="form-group"><label><b>${t("UESRPG.UI.Actor")}</b></label><select name="actorUuid">${choices}</select></div>`,
    buttons: {
      confirm: { label: t("UESRPG.UI.Continue"), callback: (html) => String(html?.querySelector('[name="actorUuid"]')?.value ?? "").trim() },
      cancel: { label: t("UESRPG.UI.Cancel") },
    },
    defaultButton: "confirm",
    width: 440,
  });
  if (!picked) return null;
  return await fromUuid(picked);
}

async function chooseScene(title, extraContent = "") {
  const choices = Array.from(game.scenes?.contents ?? [])
    .map((scene) => `<option value="${esc(scene.uuid)}">${esc(scene.name)}</option>`)
    .join("");
  if (!choices) return null;
  return customDialog({
    layout: "workflow",
    title,
    content: `<div class="form-group"><label><b>${t("UESRPG.UI.Scene")}</b></label><select name="sceneUuid">${choices}</select></div>${extraContent}`,
    buttons: {
      confirm: {
        label: t("UESRPG.UI.Continue"),
        callback: (html) => ({
          sceneUuid: String(html?.querySelector('[name="sceneUuid"]')?.value ?? "").trim(),
          root: html,
        }),
      },
      cancel: { label: t("UESRPG.UI.Cancel") },
    },
    defaultButton: "confirm",
    width: 520,
  });
}

async function chooseRegion(scene, title, filter = null) {
  const regions = Array.from(scene?.regions?.contents ?? [])
    .filter((region) => typeof filter === "function" ? filter(region) : true);
  const choices = regions.map((region) => `<option value="${esc(region.uuid)}">${esc(region.name || region.id)}</option>`).join("");
  if (!choices) return null;
  const picked = await customDialog({
    layout: "workflow",
    title,
    content: `<div class="form-group"><label><b>${t("UESRPG.UI.Region")}</b></label><select name="regionUuid">${choices}</select></div>`,
    buttons: {
      confirm: { label: t("UESRPG.UI.Select"), callback: (html) => String(html?.querySelector('[name="regionUuid"]')?.value ?? "").trim() },
      cancel: { label: t("UESRPG.UI.Cancel") },
    },
    defaultButton: "confirm",
    width: 440,
  });
  if (!picked) return null;
  return await fromUuid(picked);
}

async function performArmySkillTest(actor, skillNames, difficultyKey = "average", manualMod = 0) {
  const lowered = new Map(getActorSkillOptions(actor).map((entry) => [String(entry.name ?? "").trim().toLowerCase(), entry]));
  let skill = null;
  for (const name of skillNames) {
    skill = lowered.get(String(name ?? "").trim().toLowerCase()) ?? null;
    if (skill?.uuid) break;
  }
  if (!skill?.uuid) {
    throw new Error(`${actor.name} is missing one of the required skills: ${skillNames.join(", ")}.`);
  }
  return performTravelAssignmentRoll({
    actor,
    assignment: {
      testMode: "skill",
      skillUuid: skill.uuid,
      difficultyKey,
      manualMod,
      useSpec: false,
    },
  });
}

export class ArmyCampaignAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["uesrpg", "uesrpg-army-campaign"],
    position: { width: 760, height: 720 },
    tag: "section",
    window: { resizable: true },
    actions: {
      advanceTurn: ArmyCampaignAppV2.prototype._onAdvanceTurn,
      setMarshal: ArmyCampaignAppV2.prototype._onSetMarshal,
      openMarshal: ArmyCampaignAppV2.prototype._onOpenMarshal,
      toggleSupply: ArmyCampaignAppV2.prototype._onToggleSupply,
      armyAction: ArmyCampaignAppV2.prototype._onArmyAction,
      siegeAction: ArmyCampaignAppV2.prototype._onSiegeAction,
      configureFeature: ArmyCampaignAppV2.prototype._onConfigureFeature,
    },
  };

  static PARTS = {
    app: {
      template: TEMPLATE_PATH,
      scrollable: [".uesrpg-army-campaign__body"],
    },
  };

  constructor(group, options = {}) {
    super(options);
    this._groupUuid = String(group?.uuid ?? options?.groupUuid ?? "");
    this._activeSiegeSceneUuid = "";
    _registerHooks();
  }

  get _group() {
    return normalizeGroup(this._groupUuid);
  }

  get title() {
    const baseTitle = t("UESRPG.Apps.ArmyCampaign.Title", "Army Campaign");
    return this._group ? `${baseTitle} - ${this._group.name}` : baseTitle;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const group = this._group;
    if (!group || String(group?.type ?? "") !== "Group") {
      return { ...context, error: "Group actor not found." };
    }

    const state = await deriveArmyCampaignStateForGroup(group, getArmyCampaignState(group));
    const members = await getArmyCampaignMemberActors(group);
    const warfareMembers = members.filter((actor) => String(actor?.type ?? "") === "Warfare Unit");
    const marshal = state.marshalActorUuid ? await fromUuid(String(state.marshalActorUuid)) : null;
    const siegeScene = state.siege?.activeSiegeSceneUuid ? await fromUuid(String(state.siege.activeSiegeSceneUuid)) : null;
    const siegeState = siegeScene?.documentName === "Scene" ? getSceneWarfareSiegeState(siegeScene) : createDefaultWarfareSiegeState();
    this._activeSiegeSceneUuid = String(siegeScene?.uuid ?? "");

    const recentHistory = Array.from(state.history ?? [])
      .sort((a, b) => Number(b?.at ?? 0) - Number(a?.at ?? 0))
      .slice(0, 12)
      .map((entry) => ({ ...entry, when: new Date(Number(entry?.at ?? Date.now())).toLocaleString() }));

    return {
      ...context,
      group,
      state,
      editable: Boolean(group.isOwner),
      marshal,
      warfareMemberCount: warfareMembers.length,
      nonWarfareMemberCount: Math.max(0, members.length - warfareMembers.length),
      remainingActionsLabel: `${state.remainingArmyActions}/${WARFARE_ARMY_ACTIONS_PER_TURN}`,
      contactStateLabel: titleCase(state.campaignState?.contactState, "None"),
      surpriseStateLabel: titleCase(state.campaignState?.surpriseState, "None"),
      battleRoleLabel: titleCase(state.campaignState?.battleRole, "Unset"),
      siegeRoleLabel: titleCase(state.siege?.role, "Unset"),
      siegeScene,
      siegeState,
      hasActiveSiege: Boolean(state.siege?.activeSiegeSceneUuid && siegeScene),
      recentHistory,
      featureTypes: WARFARE_FEATURE_TYPES,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    _openApps.set(String(this._groupUuid ?? ""), this);
  }

  _onClose(options) {
    _openApps.delete(String(this._groupUuid ?? ""));
    return super._onClose(options);
  }

  async _spendAction(next, label, summary, consume = true) {
    next.history = Array.isArray(next.history) ? next.history : [];
    if (consume && Number(next.remainingArmyActions ?? 0) <= 0) {
      throw new Error(t("UESRPG.Notifications.ArmyCampaign.NoArmyActionsRemaining"));
    }
    if (consume) next.remainingArmyActions = Math.max(0, Number(next.remainingArmyActions ?? 0) - 1);
    next.history.unshift(createArmyCampaignHistoryEntry(label, summary, { consumesAction: consume }));
    next.history = next.history.slice(0, 50);
    return next;
  }

  async _resolveMarshal(actionLabel) {
    const group = this._group;
    if (!group) return null;
    const state = getArmyCampaignState(group);
    if (state?.marshalActorUuid) {
      const actor = await fromUuid(String(state.marshalActorUuid));
      if (actor?.documentName === "Actor") return actor;
    }
    return chooseMember(group, `${actionLabel} - Choose Acting Character`);
  }

  async _resolveSiegeScene() {
    const group = this._group;
    if (!group) return null;
    const state = getArmyCampaignState(group);
    if (!state?.siege?.activeSiegeSceneUuid) return null;
    const scene = await fromUuid(String(state.siege.activeSiegeSceneUuid));
    return scene?.documentName === "Scene" ? scene : null;
  }

  async _onAdvanceTurn(event) {
    event?.preventDefault?.();
    const group = this._group;
    if (!group) return;
    await AdvanceCampaignTurnService.advanceTurn({ groupActorOrUuid: group });
    await this.render();
  }

  async _onSetMarshal(event) {
    event?.preventDefault?.();
    const group = this._group;
    if (!group) return;
    const marshal = await chooseMember(group, "Assign Army Marshal");
    if (!marshal?.uuid) return;
    await updateArmyCampaignState(group, (next) => {
      next.marshalActorUuid = marshal.uuid;
      next.history.unshift(createArmyCampaignHistoryEntry("Marshal Assigned", marshal.name, { consumesAction: false }));
      return next;
    });
    await this.render();
  }

  async _onOpenMarshal(event) {
    event?.preventDefault?.();
    const marshal = await this._resolveMarshal("Open Marshal");
    if (!marshal?.sheet) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.ArmyCampaign.NoMarshalAssigned"));
      return;
    }
    marshal.sheet.render(true);
  }

  async _onToggleSupply(event) {
    event?.preventDefault?.();
    const group = this._group;
    if (!group) return;
    await updateArmyCampaignState(group, (next) => {
      next.supply.inSupply = !Boolean(next.supply?.inSupply);
      next.history.unshift(createArmyCampaignHistoryEntry(
        "Supply State Changed",
        next.supply.inSupply ? "Army restored to supply." : "Army marked out of supply.",
        { consumesAction: false },
      ));
      return next;
    });
    await this.render();
  }

  async _onArmyAction(event, target) {
    event?.preventDefault?.();
    const action = String(target?.dataset?.armyAction ?? "").trim();
    if (!action) return;
    if (action === "march") return this.#handleMarch();
    if (action === "scout") return this.#handleSkillAction("Scout", ["Observe", "Survival", "Command"], (next, rolled, actor) => {
      next.campaignState.scoutedThisTurn = Boolean(rolled?.result?.isSuccess);
      next.campaignState.concealedThisTurn = Boolean(rolled?.result?.isSuccess && Number(rolled?.result?.degree ?? 0) >= 2);
      return this._spendAction(next, "Scout", rolled?.result?.isSuccess ? `${actor.name} scouted successfully.` : `${actor.name} failed to scout effectively.`);
    });
    if (action === "forage") return this.#handleSkillAction("Forage / Requisition", ["Survival", "Command", "Observe"], async (next, rolled) => {
      const gained = rolled?.result?.isSuccess ? Math.max(1, Number(rolled?.result?.degree ?? 1)) : 0;
      next.supply.reserve = Math.min(Math.max(1, Number(next.supply.capacity ?? 1) || 1), Math.max(0, Number(next.supply.reserve ?? 0) + gained));
      return this._spendAction(next, "Forage / Requisition", gained > 0 ? `Supply reserve increased by ${gained}.` : "No useful supplies secured.");
    });
    if (action === "raid") return this.#handleSkillAction("Raid", ["Observe", "Command", "Stealth"], (next, rolled, actor) => this._spendAction(next, "Raid", rolled?.result?.isSuccess ? `${actor.name} led a successful raid.` : `${actor.name}'s raid met resistance.`));
    if (action === "reinforce") return this.#handleReinforce();
    if (action === "fortify") return this.#handleSkillAction("Fortify Camp", ["Survival", "Command"], (next, rolled) => this._spendAction(next, "Fortify Camp", rolled?.result?.isSuccess ? "Camp fortifications improved." : "Camp fortification effort fell short."));
    if (action === "besiege") return this.#handleBesiege();
    if (action === "special") return this.#handleSpecialOperation();
    if (action === "contact") return this.#handleResolveContact();
  }

  async _onSiegeAction(event, target) {
    event?.preventDefault?.();
    const action = String(target?.dataset?.siegeAction ?? "").trim();
    if (!action) return;
    if (action === "blockade") return this.#handleBlockade();
    if (action === "repair") return this.#handleRepair();
    if (action === "sap") return this.#handleSap();
    if (action === "smuggle") return this.#handleSmuggle();
    if (action === "assault") return this.#handleEncounterLaunch("attacker");
    if (action === "sally") return this.#handleEncounterLaunch("defender");
  }

  async _onConfigureFeature(event) {
    event?.preventDefault?.();
    const group = this._group;
    const scene = await this._resolveSiegeScene();
    if (!group || !scene) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.ArmyCampaign.LinkSiegeSceneFirst"));
      return;
    }
    const region = await chooseRegion(scene, t("UESRPG.Dialogs.ArmyCampaign.ConfigureFeatureRegionTitle"));
    if (!region) return;
    const current = getRegionWarfareFeatureState(region);
    const picked = await customDialog({
      layout: "workflow",
      title: tf("UESRPG.Dialogs.ArmyCampaign.ConfigureFeatureTitle", { region: region.name || region.id }),
      content: `
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.FeatureKind")}</b></label><select name="kind"><option value="fortification" ${current.kind === "fortification" ? "selected" : ""}>${t("UESRPG.Dialogs.ArmyCampaign.FeatureKindFortification")}</option><option value="deployable" ${current.kind === "deployable" ? "selected" : ""}>${t("UESRPG.Dialogs.ArmyCampaign.FeatureKindDeployable")}</option></select></div>
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.FeatureType")}</b></label><select name="type">${WARFARE_FEATURE_TYPES.map((type) => `<option value="${type}" ${type === current.type ? "selected" : ""}>${titleCase(type)}</option>`).join("")}</select></div>
        <div class="form-group"><label><b>${t("UESRPG.UI.HP")}</b></label><input type="number" name="hp" value="${Number(current.hp ?? 0)}" min="0"></div>
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.HPMax")}</b></label><input type="number" name="hpMax" value="${Number(current.hpMax ?? 0)}" min="0"></div>
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.MovementCost")}</b></label><input type="number" name="movementCost" value="${Number(current.movementCost ?? 1)}" min="1"></div>
        <div class="form-group"><label><input type="checkbox" name="blocksCharge" ${current.blocksCharge ? "checked" : ""}> ${t("UESRPG.Dialogs.ArmyCampaign.BlocksCharge")}</label></div>
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.CoverBonus")}</b></label><input type="number" name="coverBonus" value="${Number(current.coverBonus ?? 0)}"></div>
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.DefenseBonus")}</b></label><input type="number" name="defenseBonus" value="${Number(current.defenseBonus ?? 0)}"></div>
      `,
      buttons: {
        confirm: {
          label: t("UESRPG.UI.Save"),
          callback: (html) => ({
            kind: String(html?.querySelector('[name="kind"]')?.value ?? "deployable"),
            type: String(html?.querySelector('[name="type"]')?.value ?? ""),
            hp: Math.max(0, Number(html?.querySelector('[name="hp"]')?.value ?? 0) || 0),
            hpMax: Math.max(0, Number(html?.querySelector('[name="hpMax"]')?.value ?? 0) || 0),
            movementCost: Math.max(1, Number(html?.querySelector('[name="movementCost"]')?.value ?? 1) || 1),
            blocksCharge: Boolean(html?.querySelector('[name="blocksCharge"]')?.checked),
            coverBonus: Number(html?.querySelector('[name="coverBonus"]')?.value ?? 0) || 0,
            defenseBonus: Number(html?.querySelector('[name="defenseBonus"]')?.value ?? 0) || 0,
          }),
        },
        cancel: { label: t("UESRPG.UI.Cancel") },
      },
      defaultButton: "confirm",
      width: 480,
    });
    if (!picked) return;
    await updateRegionWarfareFeatureState(region, {
      kind: picked.kind,
      type: picked.type,
      sourceArmyUuid: group.uuid,
      hp: picked.hp,
      hpMax: picked.hpMax,
      intact: picked.hp > 0,
      breached: picked.hp <= 0 && picked.kind === "fortification",
      movementCost: picked.movementCost,
      blocksCharge: picked.blocksCharge,
      coverBonus: picked.coverBonus,
      defenseBonus: picked.defenseBonus,
    });
    await this.render();
  }

  async #handleSkillAction(label, skillNames, applyResult) {
    const group = this._group;
    if (!group) return;
    const actor = await this._resolveMarshal(label);
    if (!actor) return;
    try {
      const rolled = await performArmySkillTest(actor, skillNames);
      await updateArmyCampaignState(group, (next) => applyResult(next, rolled, actor));
      await this.render();
    } catch (err) {
      ui.notifications?.warn?.(String(err?.message ?? err));
    }
  }

  async #handleMarch() {
    const group = this._group;
    if (!group) return;
    const picked = await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.ArmyCampaign.MarchTitle"),
      content: `
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.LocationNote")}</b></label><input type="text" name="locationNote" value="${esc(getArmyCampaignState(group).locationNote || "")}"></div>
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.SupplySourceNote")}</b></label><input type="text" name="sourceNote" value="${esc(getArmyCampaignState(group).supply?.sourceNote || "")}"></div>
        <div class="form-group"><label><input type="checkbox" name="forcedMarch"> ${t("UESRPG.Dialogs.ArmyCampaign.ApplyForcedMarch")}</label></div>
      `,
      buttons: {
        confirm: {
          label: t("UESRPG.Dialogs.ArmyCampaign.March"),
          callback: (html) => ({
            locationNote: String(html?.querySelector('[name="locationNote"]')?.value ?? "").trim(),
            sourceNote: String(html?.querySelector('[name="sourceNote"]')?.value ?? "").trim(),
            forcedMarch: Boolean(html?.querySelector('[name="forcedMarch"]')?.checked),
          }),
        },
        cancel: { label: t("UESRPG.UI.Cancel") },
      },
      defaultButton: "confirm",
      width: 520,
    });
    if (!picked) return;
    if (picked.forcedMarch) {
      const warfareMembers = await getArmyCampaignWarfareMembers(group);
      await requestBatchUpdateDocuments(warfareMembers.map((actor) => ({
        docOrUuid: actor,
        updateData: { "system.modifiers.discipline.campaign.forcedMarch": true },
      })));
    }
    try {
      await updateArmyCampaignState(group, async (next) => {
        next.locationNote = picked.locationNote;
        next.supply.sourceNote = picked.sourceNote;
        next.campaignState.forcedMarchUsed = Boolean(picked.forcedMarch);
        return this._spendAction(next, "March", picked.locationNote || "Army marched.");
      });
      await this.render();
    } catch (err) {
      ui.notifications?.warn?.(String(err?.message ?? err));
    }
  }

  async #handleReinforce() {
    const group = this._group;
    if (!group) return;
    const picked = await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.ArmyCampaign.ReinforceTitle"),
      content: `
        <div class="form-group"><label><input type="checkbox" name="clearForcedMarch" checked> ${t("UESRPG.Dialogs.ArmyCampaign.ClearForcedMarch")}</label></div>
        <div class="form-group"><label><input type="checkbox" name="clearPoorClimate" checked> ${t("UESRPG.Dialogs.ArmyCampaign.ClearPoorClimate")}</label></div>
      `,
      buttons: {
        confirm: {
          label: t("UESRPG.UI.Apply"),
          callback: (html) => ({
            clearForcedMarch: Boolean(html?.querySelector('[name="clearForcedMarch"]')?.checked),
            clearPoorClimate: Boolean(html?.querySelector('[name="clearPoorClimate"]')?.checked),
          }),
        },
        cancel: { label: t("UESRPG.UI.Cancel") },
      },
      defaultButton: "confirm",
      width: 420,
    });
    if (!picked) return;
    const warfareMembers = await getArmyCampaignWarfareMembers(group);
    const updates = warfareMembers.map((actor) => ({
      docOrUuid: actor,
      updateData: {
        ...(picked.clearForcedMarch ? { "system.modifiers.discipline.campaign.forcedMarch": false } : {}),
        ...(picked.clearPoorClimate ? { "system.modifiers.discipline.campaign.poorClimate": false } : {}),
      },
    })).filter((entry) => Object.keys(entry.updateData).length);
    if (updates.length) await requestBatchUpdateDocuments(updates);
    try {
      await updateArmyCampaignState(group, (next) => this._spendAction(next, "Reinforce / Muster", "Temporary campaign penalties reviewed."));
      await this.render();
    } catch (err) {
      ui.notifications?.warn?.(String(err?.message ?? err));
    }
  }

  async #handleBesiege() {
    const group = this._group;
    if (!group) return;
    const picked = await chooseScene(t("UESRPG.Dialogs.ArmyCampaign.BesiegeTitle"), `
      <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.Role")}</b></label><select name="role"><option value="attacker">${t("UESRPG.Dialogs.ArmyCampaign.RoleAttacker")}</option><option value="defender">${t("UESRPG.Dialogs.ArmyCampaign.RoleDefender")}</option></select></div>
      <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.SettlementName")}</b></label><input type="text" name="settlementName"></div>
      <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.FortificationRating")}</b></label><input type="number" name="rating" value="1" min="1" max="4"></div>
    `);
    if (!picked?.sceneUuid) return;
    const scene = await fromUuid(String(picked.sceneUuid));
    if (scene?.documentName !== "Scene") return;
    const role = String(picked.root?.querySelector('[name="role"]')?.value ?? "attacker").trim();
    const settlementName = String(picked.root?.querySelector('[name="settlementName"]')?.value ?? "").trim();
    const rating = Math.max(1, Math.min(4, Number(picked.root?.querySelector('[name="rating"]')?.value ?? 1) || 1));
    await updateSceneWarfareSiegeState(scene, (next) => {
      next.active = true;
      next.settlementName = settlementName;
      next.fortificationRating = rating;
      next.fortificationHpMax = rating * 8;
      next.fortificationHp = Math.min(next.fortificationHpMax, Math.max(0, Number(next.fortificationHp ?? next.fortificationHpMax) || next.fortificationHpMax));
      if (role === "attacker") next.attackerArmyUuid = group.uuid;
      else next.defenderArmyUuid = group.uuid;
      next.history.unshift(createArmyCampaignHistoryEntry("Siege Linked", `${group.name} joined as ${role}.`));
      return next;
    });
    try {
      await updateArmyCampaignState(group, (next) => {
        next.siege.activeSiegeSceneUuid = scene.uuid;
        next.siege.role = role;
        return this._spendAction(next, "Besiege", `${scene.name} linked as ${role}.`);
      });
      await this.render();
    } catch (err) {
      ui.notifications?.warn?.(String(err?.message ?? err));
    }
  }

  async #handleSpecialOperation() {
    const group = this._group;
    if (!group) return;
    const picked = await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.ArmyCampaign.SpecialOperationTitle"),
      content: `
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.OperationNote")}</b></label><input type="text" name="note"></div>
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.Outcome")}</b></label><select name="outcome"><option value="none">${t("UESRPG.Dialogs.ArmyCampaign.OutcomeUnresolved")}</option><option value="success">${t("UESRPG.Dialogs.ArmyCampaign.OutcomeSuccess")}</option><option value="failure">${t("UESRPG.Dialogs.ArmyCampaign.OutcomeFailure")}</option></select></div>
      `,
      buttons: {
        confirm: {
          label: t("UESRPG.Dialogs.ArmyCampaign.Record"),
          callback: (html) => ({
            note: String(html?.querySelector('[name="note"]')?.value ?? "").trim(),
            outcome: String(html?.querySelector('[name="outcome"]')?.value ?? "none").trim(),
          }),
        },
        cancel: { label: t("UESRPG.UI.Cancel") },
      },
      defaultButton: "confirm",
      width: 460,
    });
    if (!picked) return;
    try {
      await updateArmyCampaignState(group, (next) => this._spendAction(next, "Special Operation", picked.note || `Outcome: ${picked.outcome}`));
      await this.render();
    } catch (err) {
      ui.notifications?.warn?.(String(err?.message ?? err));
    }
  }

  async #handleResolveContact() {
    const group = this._group;
    if (!group) return;
    const otherArmies = Array.from(game.actors?.contents ?? [])
      .filter((actor) => String(actor?.type ?? "") === "Group" && String(actor?.uuid ?? "") !== String(group.uuid))
      .map((actor) => `<option value="${esc(actor.uuid)}">${esc(actor.name)}</option>`)
      .join("");
    if (!otherArmies) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.ArmyCampaign.NoOtherArmies"));
      return;
    }
    const marshal = await this._resolveMarshal(t("UESRPG.Dialogs.ArmyCampaign.ResolveContactTitle"));
    if (!marshal) return;
    const picked = await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.ArmyCampaign.ResolveContactTitle"),
      content: `
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.OpposingArmy")}</b></label><select name="armyUuid">${otherArmies}</select></div>
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.ResultState")}</b></label><select name="contactState"><option value="shadowing">${t("UESRPG.Dialogs.ArmyCampaign.ContactStateShadowing")}</option><option value="avoiding">${t("UESRPG.Dialogs.ArmyCampaign.ContactStateAvoiding")}</option><option value="forcing">${t("UESRPG.Dialogs.ArmyCampaign.ContactStateForcing")}</option><option value="engaged">${t("UESRPG.Dialogs.ArmyCampaign.ContactStateEngaged")}</option></select></div>
      `,
      buttons: {
        confirm: {
          label: t("UESRPG.Dialogs.ArmyCampaign.Resolve"),
          callback: (html) => ({
            armyUuid: String(html?.querySelector('[name="armyUuid"]')?.value ?? "").trim(),
            contactState: String(html?.querySelector('[name="contactState"]')?.value ?? "shadowing").trim(),
          }),
        },
        cancel: { label: t("UESRPG.UI.Cancel") },
      },
      defaultButton: "confirm",
      width: 460,
    });
    if (!picked?.armyUuid) return;
    const opposingArmy = await fromUuid(String(picked.armyUuid));
    try {
      const rolled = await performArmySkillTest(marshal, ["Observe", "Survival", "Command"]);
      await updateArmyCampaignState(group, (next) => {
        next.campaignState.contactState = rolled?.result?.isSuccess ? picked.contactState : "avoiding";
        return this._spendAction(next, "Resolve Contact", `Contact with ${opposingArmy?.name ?? "Unknown"}: ${next.campaignState.contactState}.`);
      });
      await this.render();
    } catch (err) {
      ui.notifications?.warn?.(String(err?.message ?? err));
    }
  }

  async #handleBlockade() {
    const scene = await this._resolveSiegeScene();
    if (!scene) return ui.notifications?.warn?.(t("UESRPG.Notifications.ArmyCampaign.NoActiveSiegeScene"));
    const picked = await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.ArmyCampaign.BlockadeTitle"),
      content: `
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.BlockadeState")}</b></label><select name="blockadeState"><option value="partial">${t("UESRPG.Dialogs.ArmyCampaign.BlockadePartial")}</option><option value="full">${t("UESRPG.Dialogs.ArmyCampaign.BlockadeFull")}</option><option value="none">${t("UESRPG.UI.None")}</option></select></div>
        <div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.SupplyPressure")}</b></label><input type="number" name="supplyPressure" value="1" min="0"></div>
      `,
      buttons: {
        confirm: {
          label: t("UESRPG.UI.Apply"),
          callback: (html) => ({
            blockadeState: String(html?.querySelector('[name="blockadeState"]')?.value ?? "partial").trim(),
            supplyPressure: Math.max(0, Number(html?.querySelector('[name="supplyPressure"]')?.value ?? 0) || 0),
          }),
        },
        cancel: { label: t("UESRPG.UI.Cancel") },
      },
      defaultButton: "confirm",
      width: 420,
    });
    if (!picked) return;
    await updateSceneWarfareSiegeState(scene, (next) => {
      next.blockadeState = picked.blockadeState;
      next.supplyPressure = picked.supplyPressure;
      next.history.unshift(createArmyCampaignHistoryEntry("Blockade", `${scene.name}: ${picked.blockadeState} blockade.`));
      return next;
    });
    await this.render();
  }

  async #handleRepair() {
    const scene = await this._resolveSiegeScene();
    if (!scene) return ui.notifications?.warn?.(t("UESRPG.Notifications.ArmyCampaign.NoActiveSiegeScene"));
    const region = await chooseRegion(scene, t("UESRPG.Dialogs.ArmyCampaign.RepairRegionTitle"), (entry) => getRegionWarfareFeatureState(entry).kind === "fortification");
    const amount = await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.ArmyCampaign.RepairTitle"),
      content: `<div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.RepairAmount")}</b></label><input type="number" name="amount" value="1" min="1"></div>`,
      buttons: {
        confirm: { label: t("UESRPG.Dialogs.ArmyCampaign.Repair"), callback: (html) => Math.max(1, Number(html?.querySelector('[name="amount"]')?.value ?? 1) || 1) },
        cancel: { label: t("UESRPG.UI.Cancel") },
      },
      defaultButton: "confirm",
      width: 360,
    });
    if (!amount) return;
    await updateSceneWarfareSiegeState(scene, (next) => {
      next.fortificationHp = Math.min(Number(next.fortificationHpMax ?? 0) || 0, Math.max(0, Number(next.fortificationHp ?? 0) || 0) + amount);
      next.repairProgress = Math.max(0, Number(next.repairProgress ?? 0) || 0) + amount;
      next.history.unshift(createArmyCampaignHistoryEntry("Repair", `Fortification HP restored by ${amount}.`));
      return next;
    });
    if (region) {
      await updateRegionWarfareFeatureState(region, (next) => {
        next.hp = Math.min(Number(next.hpMax ?? next.hp ?? 0) || 0, Math.max(0, Number(next.hp ?? 0) || 0) + amount);
        next.intact = next.hp > 0;
        if (next.hp > 0) next.breached = false;
        return next;
      });
    }
    await this.render();
  }

  async #handleSap() {
    const scene = await this._resolveSiegeScene();
    if (!scene) return ui.notifications?.warn?.(t("UESRPG.Notifications.ArmyCampaign.NoActiveSiegeScene"));
    const region = await chooseRegion(scene, t("UESRPG.Dialogs.ArmyCampaign.TargetFortificationRegionTitle"), (entry) => getRegionWarfareFeatureState(entry).kind === "fortification");
    const amount = await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.ArmyCampaign.SapTitle"),
      content: `<div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.BreachDamage")}</b></label><input type="number" name="amount" value="1" min="1"></div>`,
      buttons: {
        confirm: { label: t("UESRPG.UI.Apply"), callback: (html) => Math.max(1, Number(html?.querySelector('[name="amount"]')?.value ?? 1) || 1) },
        cancel: { label: t("UESRPG.UI.Cancel") },
      },
      defaultButton: "confirm",
      width: 380,
    });
    if (!amount) return;
    await updateSceneWarfareSiegeState(scene, (next) => {
      next.sapProgress = Math.max(0, Number(next.sapProgress ?? 0) || 0) + amount;
      next.breachProgress = Math.max(0, Number(next.breachProgress ?? 0) || 0) + amount;
      next.fortificationHp = Math.max(0, (Number(next.fortificationHp ?? 0) || 0) - amount);
      next.history.unshift(createArmyCampaignHistoryEntry("Sap / Breach", `Fortification damaged by ${amount}.`));
      return next;
    });
    if (region) {
      await updateRegionWarfareFeatureState(region, (next) => {
        next.hp = Math.max(0, (Number(next.hp ?? 0) || 0) - amount);
        next.intact = next.hp > 0;
        next.breached = next.hp <= 0;
        return next;
      });
    }
    await this.render();
  }

  async #handleSmuggle() {
    const group = this._group;
    const scene = await this._resolveSiegeScene();
    if (!group || !scene) return ui.notifications?.warn?.(t("UESRPG.Notifications.ArmyCampaign.NoActiveSiegeScene"));
    const amount = await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.ArmyCampaign.SmuggleTitle"),
      content: `<div class="form-group"><label><b>${t("UESRPG.Dialogs.ArmyCampaign.SupplyReserveChange")}</b></label><input type="number" name="amount" value="1"></div>`,
      buttons: {
        confirm: { label: t("UESRPG.UI.Apply"), callback: (html) => Number(html?.querySelector('[name="amount"]')?.value ?? 0) || 0 },
        cancel: { label: t("UESRPG.UI.Cancel") },
      },
      defaultButton: "confirm",
      width: 360,
    });
    if (amount === null || amount === undefined) return;
    await updateArmyCampaignState(group, (next) => {
      next.supply.reserve = Math.max(0, Math.min(Number(next.supply.capacity ?? 1) || 1, Number(next.supply.reserve ?? 0) + amount));
      next.history.unshift(createArmyCampaignHistoryEntry("Smuggle / Supply", `Supply reserve adjusted by ${amount}.`, { consumesAction: false }));
      return next;
    });
    await updateSceneWarfareSiegeState(scene, (next) => {
      next.history.unshift(createArmyCampaignHistoryEntry("Smuggle / Supply", `Supply change ${amount >= 0 ? "+" : ""}${amount}.`));
      return next;
    });
    await this.render();
  }

  async #handleEncounterLaunch(expectedRole) {
    const group = this._group;
    const scene = await this._resolveSiegeScene();
    if (!group || !scene) return ui.notifications?.warn?.(t("UESRPG.Notifications.ArmyCampaign.NoActiveSiegeScene"));
    const state = getArmyCampaignState(group);
    if (expectedRole && String(state?.siege?.role ?? "") !== expectedRole) {
      ui.notifications?.warn?.(tf("UESRPG.Notifications.ArmyCampaign.SiegeActionRoleOnly", { role: expectedRole }));
      return;
    }
    await openWarfareEncounterApp(scene);
    const startNow = await confirmDialog({
      title: t("UESRPG.Dialogs.ArmyCampaign.OpenSiegeEncounterTitle"),
      content: `<p>${tf("UESRPG.Dialogs.ArmyCampaign.OpenSiegeEncounterContent", { scene: esc(scene.name) })}</p>`,
      yesLabel: t("UESRPG.Dialogs.ArmyCampaign.OpenAndStart"),
      noLabel: t("UESRPG.Dialogs.ArmyCampaign.OpenOnly"),
    });
    if (startNow === true) await startWarfareEncounter(scene);
  }
}

export async function openArmyCampaignApp(groupActorOrUuid) {
  const group = normalizeGroup(groupActorOrUuid);
  if (!group || String(group?.type ?? "") !== "Group") return null;
  const key = String(group.uuid ?? "");
  const existing = _openApps.get(key);
  if (existing) {
    return activateOpenApplication(existing, { render: true });
  }
  const app = new ArmyCampaignAppV2(group, { id: `uesrpg-army-campaign-${group.id}` });
  await app.render(true);
  return app;
}
