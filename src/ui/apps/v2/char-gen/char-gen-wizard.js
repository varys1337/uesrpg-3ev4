import { requestCreateActor, requestCreateEmbeddedDocuments, requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { RaceMenuAppV2, BirthSignMenuAppV2, rollBirthsignSelection, applyBirthsignSelection } from "../character-creation-menus.js";
import { onSetBaseCharacteristics, onLuckyMenu } from "../../../sheets/shared/listeners/characteristics-handlers.js";
import { onStartingResourcesMenu } from "../../../sheets/shared/dialogs/character-menus.js";
import { SpendXpMenuAppV2 } from "./spend-xp-menu.js";
import { SpellLearningMenuAppV2 } from "./spell-learning-menu.js";
import { confirmDialog, customDialog } from "../../../../utils/dialog-v2-helper.js";
import { appendChargenAudit, buildChargenSummary, buildChargenSummaryChatHtml } from "./audit-log.js";
import { SPECIAL_ACTIONS } from "../../../../core/config/special-actions.js";
import { TRAINING_RANK_LABELS } from "../../../../core/config/label-catalog.js";
import { SYSTEM_ID, templatePath } from "../../../constants.js";
import {
  SKILL_RANK_ORDER,
  SKILL_RANK_XP_COST,
  normalizeRank,
  discountCostIfFavored,
  isFavoredSkillForActor,
} from "../../../../core/advancement/skill-advancement.js";
import {
  extractConfiguredLuckyNumbers,
  extractConfiguredUnluckyNumbers,
} from "../../../../core/luck/lucky-numbers.js";
import { t, tf } from "../../../../utils/i18n.js";
import { activateOpenApplication } from "../application-focus.js";
import {
  buildAdministrativeCorrectionAudit,
  getRacialGrantReview,
  isChargenCompleted,
  promptAdministrativeCorrectionReason,
  promptAndApplyRacialGrant,
  promptAndApplyAllMissingRacialGrants,
} from "./racial-grants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STAGES = ["actor", "race", "stats", "birthsign", "resources", "combatstyle", "spendxp", "spells", "luck", "finish"];
const STAGE_LABELS = {
  actor: "UESRPG.UI.Actor",
  race: "UESRPG.UI.Race",
  stats: "UESRPG.Dialogs.CharGen.StageCharacteristics",
  birthsign: "UESRPG.Dialogs.CharGen.StageBirthsign",
  resources: "UESRPG.Dialogs.CharGen.StageResources",
  combatstyle: "UESRPG.Dialogs.CharGen.StageCombatStyle",
  spells: "UESRPG.Dialogs.CharGen.StageSpells",
  spendxp: "UESRPG.Dialogs.CharGen.StageSpendXp",
  luck: "UESRPG.Dialogs.CharGen.StageLuckyNumbers",
  finish: "UESRPG.UI.Finish",
};
const RANK_OPTIONS = ["untrained", "novice", "apprentice", "journeyman", "adept", "expert", "master"];

function _defaultWizardState(name = "") {
  return {
    actorUuid: null,
    stage: "actor",
    tokenActorFreeNavigation: false,
    completion: {
      actor: false,
      race: false,
      stats: false,
      birthsign: false,
      resources: false,
      combatstyle: false,
      spells: false,
      spendxp: false,
      luck: false,
      finish: false,
    },
    newActorName: String(name ?? "").trim(),
    createdByWizard: false,
    reviewMode: false,
  };
}

function _eventStub() {
  return { preventDefault() {} };
}

function _dialogRoot(ref) {
  const el = ref?.element ?? ref;
  const node = el instanceof HTMLElement ? el : el?.[0];
  if (!(node instanceof HTMLElement)) return null;
  return node;
}

function _asNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export class CharGenWizardAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static #openByKey = new Map();

  constructor(options = {}) {
    super(options);
    this._openKey = String(options.actorUuid ?? "global");
    this._resumeKey = `uesrpg.charGen.v1.${game.user?.id ?? "unknown"}`;
    this._ws = _defaultWizardState(options.name ?? "");
    this._resumeCandidate = this.#readResumeCandidate();
    this._resumePromptClosed = false;

    if (options.actorUuid) {
      this._ws.actorUuid = String(options.actorUuid);
      this._ws.completion.actor = true;
      this._resumeCandidate = null;
      const actor = fromUuidSync(this._ws.actorUuid);
      if (isChargenCompleted(actor)) this.#enableReviewMode();
    }
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-char-gen-wizard",
    classes: ["uesrpg", "uesrpg-char-gen", "uesrpg-creation-app"],
    tag: "form",
    position: { width: 720, height: 520 },
    window: {
      resizable: true,
    },
    form: {
      submitOnChange: false,
      closeOnSubmit: false,
    },
    actions: {
      next: CharGenWizardAppV2._onNext,
      back: CharGenWizardAppV2._onBack,
      goStage: CharGenWizardAppV2._onGoStage,
      cancel: CharGenWizardAppV2._onCancel,
      resume: CharGenWizardAppV2._onResume,
      restart: CharGenWizardAppV2._onRestart,
      dismissResume: CharGenWizardAppV2._onDismissResume,
      useAssignedCharacter: CharGenWizardAppV2._onUseAssignedCharacter,
      useSelectedTokenActor: CharGenWizardAppV2._onUseSelectedTokenActor,
      createActor: CharGenWizardAppV2._onCreateActor,
      chooseRace: CharGenWizardAppV2._onChooseRace,
      openStats: CharGenWizardAppV2._onOpenStats,
      chooseBirthsign: CharGenWizardAppV2._onChooseBirthsign,
      openStartingResources: CharGenWizardAppV2._onOpenStartingResources,
      openCombatStyleSetup: CharGenWizardAppV2._onOpenCombatStyleSetup,
      openSpellLearning: CharGenWizardAppV2._onOpenSpellLearning,
      openSpendXp: CharGenWizardAppV2._onOpenSpendXp,
      openLuckyNumbers: CharGenWizardAppV2._onOpenLuckyNumbers,
      finish: CharGenWizardAppV2._onFinish,
      reconcileGrant: CharGenWizardAppV2._onReconcileGrant,
    },
  };

  static PARTS = {
    main: {
      template: templatePath("v2/apps/char-gen-wizard.hbs"),
      scrollable: [".uesrpg-char-gen__content"],
    },
  };

  static getOpenInstance(key = "global") {
    return this.#openByKey.get(String(key)) ?? null;
  }

  static findOpenInstance(predicate = null) {
    const matcher = typeof predicate === "function" ? predicate : () => true;
    for (const app of this.#openByKey.values()) {
      if (app?.rendered && matcher(app)) return app;
    }
    return null;
  }

  static async prompt(options = {}) {
    const key = String(options.actorUuid ?? "global");
    const existing = this.getOpenInstance(key);
    if (existing?.rendered) {
      return activateOpenApplication(existing);
    }
    const app = new CharGenWizardAppV2(options);
    this.#openByKey.set(key, app);
    await app.render(true);
    return app;
  }

  get title() {
    return t("UESRPG.Dialogs.CharGen.WizardTitle", "Character Generation Wizard");
  }

  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    const actor = await this.#resolveActor();
    const stage = this._ws.stage;

    const stageData = STAGES.map((id) => {
      const clickable = this.#isStageUnlocked(id);
      return {
      id,
      label: t(STAGE_LABELS[id]),
      complete: Boolean(this._ws.completion[id]),
      active: id === stage,
      clickable,
      locked: !clickable,
      };
    });

    const stageMeta = {
      actor: {
        title: t("UESRPG.Dialogs.CharGen.ActorStageTitle"),
        body: t("UESRPG.Dialogs.CharGen.ActorStageBody"),
      },
      race: {
        title: t("UESRPG.Dialogs.CharGen.RaceStageTitle"),
        body: t("UESRPG.Dialogs.CharGen.RaceStageBody"),
      },
      stats: {
        title: t("UESRPG.Dialogs.CharGen.StatsStageTitle"),
        body: t("UESRPG.Dialogs.CharGen.StatsStageBody"),
      },
      birthsign: {
        title: t("UESRPG.Dialogs.CharGen.BirthsignStageTitle"),
        body: t("UESRPG.Dialogs.CharGen.BirthsignStageBody"),
      },
      resources: {
        title: t("UESRPG.Dialogs.CharGen.ResourcesStageTitle"),
        body: t("UESRPG.Dialogs.CharGen.ResourcesStageBody"),
      },
      combatstyle: {
        title: t("UESRPG.Dialogs.CharGen.CombatStyleStageTitle"),
        body: t("UESRPG.Dialogs.CharGen.CombatStyleStageBody"),
      },
      spells: {
        title: t("UESRPG.Dialogs.CharGen.SpellsStageTitle"),
        body: t("UESRPG.Dialogs.CharGen.SpellsStageBody"),
      },
      spendxp: {
        title: t("UESRPG.Dialogs.CharGen.SpendXpStageTitle"),
        body: t("UESRPG.Dialogs.CharGen.SpendXpStageBody"),
      },
      luck: {
        title: t("UESRPG.Dialogs.CharGen.LuckStageTitle"),
        body: t("UESRPG.Dialogs.CharGen.LuckStageBody"),
      },
      finish: {
        title: t("UESRPG.Dialogs.CharGen.FinishStageTitle"),
        body: t("UESRPG.Dialogs.CharGen.FinishStageBody"),
      },
    };

    const canBack = STAGES.indexOf(stage) > 0;
    const canNext = STAGES.indexOf(stage) < (STAGES.length - 1) && this.#canAdvanceFromStage(stage);
    const resumeActorName = this._resumeCandidate?.actorName ?? t("UESRPG.Dialogs.CharGen.UnknownActor");
    const completed = isChargenCompleted(actor);
    const racialGrants = actor
      ? getRacialGrantReview(actor).map((grant) => ({
          ...grant,
          canChange: grant.applied && (!completed || Boolean(game.user?.isGM)),
        }))
      : [];

    return {
      ...base,
      ws: this._ws,
      actor,
      actorName: actor?.name ?? t("UESRPG.Dialogs.CharGen.NoneSelected"),
      stage,
      stageData,
      stageTitle: stageMeta[stage]?.title ?? t("UESRPG.Dialogs.CharGen.WizardTitle"),
      stageBody: stageMeta[stage]?.body ?? "",
      canBack,
      canNext,
      isStage: Object.fromEntries(STAGES.map((id) => [id, stage === id])),
      hasAssignedCharacter: Boolean(game.user?.character),
      hasSingleControlledToken: (canvas?.tokens?.controlled?.length ?? 0) === 1,
      hasResumeCandidate: Boolean(this._resumeCandidate) && !this._resumePromptClosed,
      resumeActorName,
      reviewMode: completed || Boolean(this._ws.reviewMode),
      canEditFoundations: !completed || Boolean(game.user?.isGM),
      racialGrants,
      hasRacialGrants: racialGrants.length > 0,
    };
  }

  async close(options = {}) {
    this.#persistState();
    CharGenWizardAppV2.#openByKey.delete(this._openKey);
    return super.close(options);
  }

  _onChangeForm(formConfig, event) {
    super._onChangeForm(formConfig, event);
    const target = event?.target;
    if (!(target instanceof HTMLElement)) return;
    const name = String(target.getAttribute("name") ?? "").trim();
    if (!name) return;

    if (name === "newActorName") {
      // Keep wizard state authoritative for actor naming to avoid ad-hoc DOM reads on submit.
      this._ws.newActorName = String(target.value ?? "").trimStart();
      this.#persistState();
    }
  }

  #normalizeWizardState(raw) {
    const normalized = _defaultWizardState(raw?.newActorName ?? "");
    if (!raw || typeof raw !== "object") return normalized;

    if (typeof raw.actorUuid === "string" && raw.actorUuid.trim()) {
      normalized.actorUuid = raw.actorUuid.trim();
      normalized.completion.actor = true;
    }

    if (STAGES.includes(String(raw.stage ?? ""))) {
      normalized.stage = String(raw.stage);
    }

    normalized.tokenActorFreeNavigation = Boolean(raw.tokenActorFreeNavigation);

    const completion = raw.completion;
    if (completion && typeof completion === "object") {
      for (const stage of STAGES) {
        normalized.completion[stage] = Boolean(completion[stage]);
      }
    }

    normalized.createdByWizard = Boolean(raw.createdByWizard);
    normalized.reviewMode = Boolean(raw.reviewMode);

    if (!normalized.actorUuid) {
      normalized.completion.actor = false;
      normalized.stage = "actor";
      normalized.tokenActorFreeNavigation = false;
    }

    if (normalized.stage !== "actor" && !normalized.completion.actor) {
      normalized.stage = "actor";
    }

    return normalized;
  }

  async #resolveActor() {
    if (!this._ws.actorUuid) return null;
    try {
      const actor = await fromUuid(this._ws.actorUuid);
      if (!actor || actor.documentName !== "Actor") {
        this._ws.actorUuid = null;
        this._ws.completion.actor = false;
        this._ws.stage = "actor";
        this.#persistState();
        return null;
      }
      if (isChargenCompleted(actor) && !this._ws.reviewMode) this.#enableReviewMode();
      return actor;
    } catch (_err) {
      this._ws.actorUuid = null;
      this._ws.completion.actor = false;
      this._ws.stage = "actor";
      this.#persistState();
      return null;
    }
  }

  #persistState() {
    try {
      localStorage.setItem(this._resumeKey, JSON.stringify(this._ws));
    } catch (_err) {
      /* no-op */
    }
  }

  #clearPersistedState() {
    try {
      localStorage.removeItem(this._resumeKey);
    } catch (_err) {
      /* no-op */
    }
  }

  #readResumeCandidate() {
    try {
      const raw = localStorage.getItem(this._resumeKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const ws = this.#normalizeWizardState(parsed);

      const actor = ws.actorUuid ? fromUuidSync(ws.actorUuid) : null;
      if (ws.actorUuid && (!actor || actor.documentName !== "Actor")) {
        return null;
      }

      return {
        ws,
        actorName: actor?.name ?? null,
      };
    } catch (_err) {
      return null;
    }
  }

  #setActor(actor, { tokenActorFreeNavigation = false } = {}) {
    if (!actor || actor.documentName !== "Actor") return;
    this._ws.actorUuid = actor.uuid;
    this._ws.completion.actor = true;
    const completed = isChargenCompleted(actor);
    this._ws.tokenActorFreeNavigation = Boolean(tokenActorFreeNavigation) || completed;
    if (completed) this.#enableReviewMode();
    if (this._ws.stage === "actor") this._ws.stage = "race";
    this.#persistState();
  }

  #isStageUnlocked(stage) {
    if (!STAGES.includes(stage)) return false;
    if (this._ws.reviewMode) return true;
    if (stage === this._ws.stage) return true;
    if (Boolean(this._ws.completion[stage])) return true;
    if (!this._ws.tokenActorFreeNavigation) return false;
    return stage !== "finish";
  }

  #canAdvanceFromStage(stage) {
    if (stage === "finish") return false;
    if (this._ws.reviewMode) return true;
    return Boolean(this._ws.completion[stage]);
  }

  #enableReviewMode() {
    this._ws.reviewMode = true;
    this._ws.tokenActorFreeNavigation = true;
    for (const stage of STAGES) this._ws.completion[stage] = true;
    if (this._ws.stage === "actor" || this._ws.stage === "finish") this._ws.stage = "race";
  }

  #advance() {
    const idx = STAGES.indexOf(this._ws.stage);
    if (idx < 0 || idx >= (STAGES.length - 1)) return;
    if (!this.#canAdvanceFromStage(this._ws.stage)) return;
    this._ws.stage = STAGES[idx + 1];
    this.#persistState();
    void this.render();
  }

  #retreat() {
    const idx = STAGES.indexOf(this._ws.stage);
    if (idx <= 0) return;
    this._ws.stage = STAGES[idx - 1];
    this.#persistState();
    void this.render();
  }

  static async _onNext(event, target) {
    event?.preventDefault?.();
    this.#advance();
  }

  static async _onBack(event, target) {
    event?.preventDefault?.();
    this.#retreat();
  }

  static async _onGoStage(event, target) {
    event?.preventDefault?.();
    const stage = String(target?.dataset?.stage ?? "").trim();
    if (!STAGES.includes(stage)) return;
    if (this.#isStageUnlocked(stage)) {
      this._ws.stage = stage;
      this.#persistState();
      await this.render();
      return;
    }
    ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.StageLocked"));
  }

  static async _onCancel(event, target) {
    event?.preventDefault?.();
    await this.close();
  }

  static async _onDismissResume(event, target) {
    event?.preventDefault?.();
    this._resumePromptClosed = true;
    await this.render();
  }

  static async _onResume(event, target) {
    event?.preventDefault?.();
    const candidate = this._resumeCandidate?.ws;
    if (!candidate) return;
    this._ws = this.#normalizeWizardState(foundry.utils.deepClone(candidate));
    await this.#resolveActor();
    this._resumePromptClosed = true;
    this.#persistState();
    await this.render();
  }

  static async _onRestart(event, target) {
    event?.preventDefault?.();
    const confirmed = await confirmDialog({
      title: t("UESRPG.Dialogs.CharGen.RestartTitle"),
      classes: ["uesrpg-chargen-dialog"],
      content: `<p>${t("UESRPG.Dialogs.CharGen.RestartContent")}</p>`,
      yesLabel: t("UESRPG.Apps.CharGen.Restart"),
      noLabel: t("UESRPG.UI.Cancel"),
    });
    if (!confirmed) return;

    this._ws = _defaultWizardState(this._ws.newActorName);
    this._resumeCandidate = null;
    this._resumePromptClosed = true;
    this.#clearPersistedState();
    await this.render();
  }

  static async _onUseAssignedCharacter(event, target) {
    event?.preventDefault?.();
    const actor = game.user?.character ?? null;
    if (!actor) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.NoAssignedCharacter"));
      return;
    }
    this.#setActor(actor, { tokenActorFreeNavigation: false });
    await this.render();
  }

  static async _onUseSelectedTokenActor(event, target) {
    event?.preventDefault?.();
    const controlled = canvas?.tokens?.controlled ?? [];
    if (controlled.length !== 1) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.SelectOneToken"));
      return;
    }
    const actor = controlled[0]?.actor ?? null;
    if (!actor) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.SelectedTokenNoActor"));
      return;
    }
    this.#setActor(actor, { tokenActorFreeNavigation: true });
    await this.render();
  }

  static async _onCreateActor(event, target) {
    event?.preventDefault?.();
    const requestedName = String(this._ws.newActorName ?? "").trim();
    this._ws.newActorName = requestedName;

    const actor = await requestCreateActor({
      name: requestedName || t("UESRPG.Apps.CharGen.NewCharacter"),
      type: "Player Character",
      flags: {
        uesrpg: {
          charGen: {
            inProgress: true,
            completed: false,
          },
        },
        [SYSTEM_ID]: {
          chargen: {
            inProgress: true,
            completed: false,
          },
        },
      },
    });

    if (!actor) {
      ui.notifications?.error?.(t("UESRPG.Notifications.CharGen.CreateActorFailed"));
      return;
    }

    this._ws.createdByWizard = true;
    this.#setActor(actor, { tokenActorFreeNavigation: false });
    await this.render();
  }

  static async _onChooseRace(event, target) {
    event?.preventDefault?.();
    const actor = await this.#resolveActor();
    if (!actor) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.SelectOrCreateActorFirst"));
      return;
    }

    let administrativeReason = null;
    if (isChargenCompleted(actor)) {
      if (!game.user?.isGM) {
        ui.notifications?.warn?.(t("UESRPG.DefectUpdate.GmCorrectionRequired", "A GM Administrative Correction is required after character generation."));
        return;
      }
      administrativeReason = await promptAdministrativeCorrectionReason();
      if (!administrativeReason) return;
    }

    const result = await RaceMenuAppV2.prompt(actor, { administrativeReason });
    if (!result) return;
    this._ws.completion.race = true;
    await appendChargenAudit(actor, {
      step: "race",
      action: "apply",
      payload: { race: actor.system?.race ?? "" },
    });
    this.#persistState();
    await this.render();
  }

  static async _onReconcileGrant(event, target) {
    event?.preventDefault?.();
    const actor = await this.#resolveActor();
    if (!actor) return;
    const grantId = String(target?.dataset?.grantId ?? "").trim();
    if (!grantId) return;
    const applied = getRacialGrantReview(actor).find((grant) => grant.id === grantId)?.applied === true;
    let administrativeReason = null;
    if (applied && isChargenCompleted(actor)) {
      if (!game.user?.isGM) {
        ui.notifications?.warn?.(t("UESRPG.DefectUpdate.GmCorrectionRequired", "A GM Administrative Correction is required after character generation."));
        return;
      }
      administrativeReason = await promptAdministrativeCorrectionReason();
      if (!administrativeReason) return;
    }
    const result = await promptAndApplyRacialGrant(actor, grantId, { administrativeReason });
    if (!result?.ok && !result?.cancelled) ui.notifications?.warn?.(result?.error ?? t("UESRPG.DefectUpdate.GrantApplyFailed", "Unable to apply racial grant."));
    if (result?.ok && result?.changed) {
      if (administrativeReason) {
        await appendChargenAudit(actor, buildAdministrativeCorrectionAudit(administrativeReason, {
          field: "racialGrant",
          grantId,
          optionId: result.record?.optionId ?? null,
        }));
      }
      ui.notifications?.info?.(t("UESRPG.DefectUpdate.GrantApplied", "Racial grant applied."));
    }
    await this.render();
  }

  static async _onOpenStats(event, target) {
    event?.preventDefault?.();
    const actor = await this.#resolveActor();
    if (!actor) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.SelectOrCreateActorFirst"));
      return;
    }

    let administrativeReason = null;
    if (isChargenCompleted(actor)) {
      if (!game.user?.isGM) {
        ui.notifications?.warn?.(t("UESRPG.DefectUpdate.GmCorrectionRequired", "A GM Administrative Correction is required after character generation."));
        return;
      }
      administrativeReason = await promptAdministrativeCorrectionReason();
      if (!administrativeReason) return;
    }
    await onSetBaseCharacteristics.call({ actor }, _eventStub(), target);
    this._ws.completion.stats = true;
    await appendChargenAudit(actor, {
      step: "stats",
      action: "apply",
      payload: {
        favored: Object.entries(actor.system?.characteristics ?? {})
          .filter(([, value]) => Boolean(value?.favored))
          .map(([key]) => key),
      },
    });
    if (administrativeReason) await appendChargenAudit(actor, buildAdministrativeCorrectionAudit(administrativeReason, { field: "characteristics" }));
    this.#persistState();
    await this.render();
  }

  static async _onChooseBirthsign(event, target) {
    event?.preventDefault?.();
    const actor = await this.#resolveActor();
    if (!actor) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.SelectOrCreateActorFirst"));
      return;
    }

    let administrativeReason = null;
    if (isChargenCompleted(actor)) {
      if (!game.user?.isGM) {
        ui.notifications?.warn?.(t("UESRPG.DefectUpdate.GmCorrectionRequired", "A GM Administrative Correction is required after character generation."));
        return;
      }
      administrativeReason = await promptAdministrativeCorrectionReason();
      if (!administrativeReason) return;
    }

    const choice = await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.CharGen.BirthsignRawTitle"),
      classes: ["uesrpg-chargen-dialog"],
      content: `<div class="uesrpg-cg-dialog uesrpg-cg-stack">
        <p class="uesrpg-cg-intro">${t("UESRPG.Dialogs.CharGen.BirthsignRawContent")}</p>
        <label class="uesrpg-cg-field uesrpg-cg-field--stacked">
          <span>${t("UESRPG.Dialogs.CharGen.Charge")}</span>
          <select id="uesrpgBirthsignCharge">
            <option value="warrior">${t("UESRPG.Dialogs.CharGen.ChargeWarrior")}</option>
            <option value="mage">${t("UESRPG.Dialogs.CharGen.ChargeMage")}</option>
            <option value="thief">${t("UESRPG.Dialogs.CharGen.ChargeThief")}</option>
          </select>
        </label>
        <label class="uesrpg-cg-check">
          <input type="checkbox" id="uesrpgLuckCostToggle">
          <span>${t("UESRPG.Dialogs.CharGen.OptionalLuckRule")}</span>
        </label>
      </div>`,
      buttons: {
        roll: {
          label: t("UESRPG.Dialogs.CharGen.Roll"),
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            return {
              mode: "roll",
              charge: String(root?.querySelector("#uesrpgBirthsignCharge")?.value ?? "warrior"),
              luckCostToggle: Boolean(root?.querySelector("#uesrpgLuckCostToggle")?.checked),
            };
          },
        },
        manual: {
          label: t("UESRPG.Dialogs.CharGen.ManualMenu"),
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            return {
              mode: "manual",
              luckCostToggle: Boolean(root?.querySelector("#uesrpgLuckCostToggle")?.checked),
            };
          },
        },
        cancel: { label: t("UESRPG.UI.Cancel") },
      },
      default: "roll",
    });
    if (!choice || choice === "cancel") return;

    let ok = false;
    if (choice.mode === "manual") {
      let pendingLuckCost = 0;
      if (choice.luckCostToggle) {
        const spendLuck = await confirmDialog({
          title: t("UESRPG.Dialogs.CharGen.OptionalRuleTitle"),
          classes: ["uesrpg-chargen-dialog"],
          content: `<p>${t("UESRPG.Dialogs.CharGen.OptionalRuleContent")}</p>`,
          yesLabel: t("UESRPG.Dialogs.CharGen.Spend5Luck"),
          noLabel: t("UESRPG.Dialogs.CharGen.NoLuckCost"),
        });
        if (spendLuck) pendingLuckCost = 5;
      }
      ok = await BirthSignMenuAppV2.prompt(actor, { administrativeReason });
      if (ok && pendingLuckCost > 0) {
        await requestUpdateDocument(actor, {
          "system.characteristics.lck.base": Math.max(0, Number(actor.system?.characteristics?.lck?.base ?? 0) - pendingLuckCost),
        });
        await appendChargenAudit(actor, {
          step: "birthsign",
          action: "manualLuckCost",
          payload: { luckCost: pendingLuckCost },
        });
      }
    } else {
      const rollResult = rollBirthsignSelection(choice.charge);
      if (!rollResult?.signKey) return;
      const review = await customDialog({
        layout: "workflow",
        title: t("UESRPG.Dialogs.CharGen.BirthsignRollResultTitle"),
        classes: ["uesrpg-chargen-dialog"],
        content: `<div class="uesrpg-cg-dialog uesrpg-cg-stack uesrpg-cg-summary">
          <p>${tf("UESRPG.Dialogs.CharGen.RollResultCharge", { charge: rollResult.charge })}</p>
          <p>${tf("UESRPG.Dialogs.CharGen.RollResultD5", { roll: rollResult.d5Roll, extra: rollResult.d5Roll === 5 ? ` (${t("UESRPG.Dialogs.CharGen.StarCursedReroll")} ${rollResult.resolvedRoll})` : "" })}</p>
          <p>${tf("UESRPG.Dialogs.CharGen.RollResultSelected", { sign: rollResult.signKey, suffix: rollResult.starCursed ? ` (${t("UESRPG.Dialogs.CharGen.StarCursed")})` : "" })}</p>
        </div>`,
        buttons: {
          accept: { label: t("UESRPG.Dialogs.CharGen.Accept") },
          manual: { label: t("UESRPG.Dialogs.CharGen.ManualInstead") },
          cancel: { label: t("UESRPG.UI.Cancel") },
        },
        default: "accept",
      });
      if (review === "manual") {
        ok = await BirthSignMenuAppV2.prompt(actor, { administrativeReason });
      } else if (review === "accept") {
        ok = await applyBirthsignSelection(actor, {
          signKey: rollResult.signKey,
          starCursed: rollResult.starCursed,
          mode: "roll",
          charge: rollResult.charge,
          d5Roll: rollResult.d5Roll,
          administrativeReason,
        });
      }
    }

    if (!ok) return;
    if (administrativeReason) await appendChargenAudit(actor, buildAdministrativeCorrectionAudit(administrativeReason, { field: "birthsign" }));
    this._ws.completion.birthsign = true;
    this.#persistState();
    await this.render();
  }

  static async _onOpenLuckyNumbers(event, target) {
    event?.preventDefault?.();
    const actor = await this.#resolveActor();
    if (!actor) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.SelectOrCreateActorFirst"));
      return;
    }

    const luckResult = await onLuckyMenu.call({ actor }, _eventStub(), target);
    if (!luckResult?.ok) {
      await this.render();
      return;
    }
    const refreshedActor = (await fromUuid(actor.uuid)) ?? actor;
    this._ws.completion.luck = true;
    await appendChargenAudit(actor, {
      step: "luck",
      action: "apply",
      payload: {
        mode: luckResult.mode ?? "manual",
        luckyCount: Number(luckResult.luckyCount ?? 0),
        unluckyCount: Number(luckResult.unluckyCount ?? 0),
        luckyNumbers: extractConfiguredLuckyNumbers(refreshedActor),
        unluckyNumbers: extractConfiguredUnluckyNumbers(refreshedActor),
        rollTrace: luckResult.rollTrace ?? null,
      },
    });
    this.#persistState();
    await this.render();
  }

  static async _onOpenStartingResources(event, target) {
    event?.preventDefault?.();
    const actor = await this.#resolveActor();
    if (!actor) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.SelectOrCreateActorFirst"));
      return;
    }

    await onStartingResourcesMenu.call({ actor }, _eventStub(), target);
    const grantResults = await promptAndApplyAllMissingRacialGrants(actor);
    const failedGrant = grantResults.find((result) => result && !result.ok && !result.cancelled);
    if (failedGrant) ui.notifications?.warn?.(failedGrant.error ?? t("UESRPG.DefectUpdate.GrantApplyFailed", "Unable to apply racial grant."));
    this._ws.completion.resources = true;
    await appendChargenAudit(actor, {
      step: "resources",
      action: "apply",
      payload: {
        wealth: Number(actor.system?.wealth ?? 0),
        xpTotal: Number(actor.system?.xpTotal ?? 0),
        xp: Number(actor.system?.xp ?? 0),
      },
    });
    this.#persistState();
    await this.render();
  }

  static async _onOpenCombatStyleSetup(event, target) {
    event?.preventDefault?.();
    const actor = await this.#resolveActor();
    if (!actor) {
      ui.notifications?.warn?.("Select or create an actor first.");
      return;
    }

    let administrativeReason = null;
    if (isChargenCompleted(actor)) {
      if (!game.user?.isGM) {
        ui.notifications?.warn?.(t("UESRPG.DefectUpdate.GmCorrectionRequired", "A GM Administrative Correction is required after character generation."));
        return;
      }
      administrativeReason = await promptAdministrativeCorrectionReason();
      if (!administrativeReason) return;
    }

    const styles = actor.items.filter((it) => it.type === "combatStyle");
    const styleOptions = [
      `<option value="__new__">${t("UESRPG.Dialogs.CharGen.CreateNewCombatStyle")}</option>`,
      ...styles.map((it) => `<option value="${it.id}">${it.name}</option>`),
    ].join("");
    const rankOptions = RANK_OPTIONS.map((rank) => {
      const label = foundry.utils.escapeHTML(t(TRAINING_RANK_LABELS[rank] ?? rank));
      return `<option value="${rank}" ${rank === "novice" ? "selected" : ""}>${label}</option>`;
    }).join("");
    const saChecks = SPECIAL_ACTIONS.map((sa) => `<label class="uesrpg-cg-check">
      <input type="checkbox" class="cg-sa" value="${sa.id}">
      <span>${sa.name}</span>
    </label>`).join("");

    const computeCombatSetupCost = (input) => {
      if (!input || !RANK_OPTIONS.includes(input.rank)) {
        return { ok: false, reason: t("UESRPG.Notifications.CharGen.InvalidCombatStyleRank") };
      }

      const styleIsNew = input.styleId === "__new__";
      const style = styleIsNew ? null : (actor.items.get(input.styleId) ?? null);
      if (!styleIsNew && !style) {
        return { ok: false, reason: t("UESRPG.Notifications.CharGen.CombatStyleMissing") };
      }

      const currentRank = styleIsNew ? "untrained" : normalizeRank(style.system?.rank ?? "untrained");
      const targetRank = normalizeRank(input.rank);
      const currentIdx = SKILL_RANK_ORDER.indexOf(currentRank);
      const targetIdx = SKILL_RANK_ORDER.indexOf(targetRank);
      if (targetIdx < currentIdx) {
        return { ok: false, reason: t("UESRPG.Notifications.CharGen.CombatStyleCannotDecrease") };
      }

      const favored = styleIsNew
        ? isFavoredSkillForActor(actor, "str,agi")
        : isFavoredSkillForActor(actor, style.system?.governingCha ?? style.system?.baseCha ?? "");
      let rankCost = 0;
      if (targetIdx > currentIdx) {
        for (let idx = currentIdx + 1; idx <= targetIdx; idx += 1) {
          const rankKey = SKILL_RANK_ORDER[idx];
          const base = _asNum(SKILL_RANK_XP_COST[rankKey], 0);
          rankCost += discountCostIfFavored(base, favored);
        }
      }

      const currentTe = styleIsNew
        ? Array.from({ length: 10 }, () => "")
        : (Array.isArray(style.system?.trainedEquipment)
          ? style.system.trainedEquipment.map((v) => String(v ?? "").trim()).slice(0, 10)
          : Array.from({ length: 10 }, () => ""));
      while (currentTe.length < 10) currentTe.push("");
      const desiredTe = Array.from({ length: 10 }, (_, idx) => String(input.trainedEquipment[idx] ?? "").trim());
      const currentTeCount = currentTe.filter(Boolean).length;
      const desiredTeCount = desiredTe.filter(Boolean).length;
      const freeTe = styleIsNew ? 5 : currentTeCount;
      const teDeltaPaid = Math.max(0, desiredTeCount - freeTe);
      const teCost = teDeltaPaid > 0 ? 25 * teDeltaPaid : 0;

      const currentSa = styleIsNew ? {} : (style.system?.specialAdvantages ?? {});
      const currentSaCount = Object.values(currentSa).filter(Boolean).length;
      const nextSa = { ...currentSa };
      for (const sa of input.specialAdvantages) nextSa[sa] = true;
      const nextSaCount = Object.values(nextSa).filter(Boolean).length;
      const freeSa = styleIsNew ? 1 : currentSaCount;
      const saDeltaPaid = Math.max(0, nextSaCount - freeSa);
      const saCost = saDeltaPaid > 0 ? 25 * saDeltaPaid : 0;

      return {
        ok: true,
        styleIsNew,
        style,
        targetRank,
        favored,
        desiredTe,
        nextSa,
        actualXpCost: rankCost + teCost + saCost,
        xpCost: input.freeCombatStyle ? 0 : (rankCost + teCost + saCost),
        freeCombatStyle: Boolean(input.freeCombatStyle),
        breakdown: { rankCost, teCost, saCost },
      };
    };

    const readCombatFormState = (root) => ({
      styleId: String(root?.querySelector("#cgCombatStyleSelect")?.value ?? "__new__"),
      styleName: String(root?.querySelector("#cgCombatStyleName")?.value ?? "").trim(),
      rank: String(root?.querySelector("#cgCombatStyleRank")?.value ?? "novice"),
      trainedEquipment: [
        root?.querySelector("#cgTe1")?.value,
        root?.querySelector("#cgTe2")?.value,
        root?.querySelector("#cgTe3")?.value,
        root?.querySelector("#cgTe4")?.value,
        root?.querySelector("#cgTe5")?.value,
        root?.querySelector("#cgTe6")?.value,
        root?.querySelector("#cgTe7")?.value,
        root?.querySelector("#cgTe8")?.value,
        root?.querySelector("#cgTe9")?.value,
        root?.querySelector("#cgTe10")?.value,
      ],
      specialAdvantages: [...(root?.querySelectorAll(".cg-sa:checked") ?? [])].map((el) => String(el.value)),
      setActive: Boolean(root?.querySelector("#cgSetActiveStyle")?.checked),
      freeCombatStyle: Boolean(root?.querySelector("#cgFreeCombatStyle")?.checked),
    });

    const result = await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.CharGen.CombatStyleSetupTitle"),
      width: 820,
      height: 680,
      resizable: true,
      classes: ["uesrpg-cg-compact-dialog", "uesrpg-cg-combat-style-dialog", "uesrpg-chargen-dialog"],
      content: `<div class="uesrpg-cg-dialog uesrpg-cg-stack">
        <div class="uesrpg-cg-dialog__note uesrpg-cg-intro">${t("UESRPG.Dialogs.CharGen.CombatStyleSetupNote")}</div>
        <label class="uesrpg-cg-field uesrpg-cg-field--stacked">
          <span>${t("UESRPG.Dialogs.CharGen.CombatStyle")}</span>
          <select id="cgCombatStyleSelect">${styleOptions}</select>
        </label>
        <label class="uesrpg-cg-field uesrpg-cg-field--stacked">
          <span>${t("UESRPG.Dialogs.CharGen.NewStyleName")}</span>
          <input type="text" id="cgCombatStyleName" value="${t("UESRPG.Dialogs.CharGen.CombatStyleName")}">
        </label>
        <label class="uesrpg-cg-field uesrpg-cg-field--stacked">
          <span>${t("UESRPG.Dialogs.CharGen.Rank")}</span>
          <select id="cgCombatStyleRank">${rankOptions}</select>
        </label>
        <div class="uesrpg-cg-dialog__note">${t("UESRPG.Dialogs.CharGen.TrainedEquipmentSetup")}</div>
        <div class="uesrpg-cg-option-grid">
          <input type="text" id="cgTe1" placeholder="e.g., Long Blade">
          <input type="text" id="cgTe2" placeholder="e.g., Shield">
          <input type="text" id="cgTe3" placeholder="e.g., Bow">
          <input type="text" id="cgTe4" placeholder="e.g., Dagger">
          <input type="text" id="cgTe5" placeholder="e.g., Unarmed">
        </div>
        <div class="uesrpg-cg-dialog__note">${t("UESRPG.Dialogs.CharGen.CombatStyleExpansions")}</div>
        <div class="uesrpg-cg-option-grid">
          <input type="text" id="cgTe6" placeholder="Expansion slot 6">
          <input type="text" id="cgTe7" placeholder="Expansion slot 7">
          <input type="text" id="cgTe8" placeholder="Expansion slot 8">
          <input type="text" id="cgTe9" placeholder="Expansion slot 9">
          <input type="text" id="cgTe10" placeholder="Expansion slot 10">
        </div>
        <div class="uesrpg-cg-dialog__note">${t("UESRPG.Dialogs.CharGen.SpecialAdvantagesNote")}</div>
        <div class="uesrpg-cg-option-grid">
          ${saChecks}
        </div>
        <div class="uesrpg-cg-dialog__note"><b>${t("UESRPG.Dialogs.CharGen.EstimatedCost")}:</b> <span id="cgCombatStyleCost">0</span> XP <span id="cgCombatStyleCostBreakdown"></span></div>
        <label class="uesrpg-cg-check">
          <input type="checkbox" id="cgFreeCombatStyle" ${administrativeReason ? "checked disabled" : ""}>
          <span>${t("UESRPG.Dialogs.CharGen.FreeCombatStyle")}</span>
        </label>
        <label class="uesrpg-cg-check">
          <input type="checkbox" id="cgSetActiveStyle" checked>
          <span>${t("UESRPG.Dialogs.CharGen.SetActiveCombatStyle")}</span>
        </label>
      </div>`,
      buttons: {
        submit: {
          label: t("UESRPG.UI.Submit"),
          callback: (html) => {
            const root = _dialogRoot(html);
            return readCombatFormState(root);
          },
        },
        cancel: { label: t("UESRPG.UI.Cancel") },
      },
      default: "submit",
      render: (_event, html) => {
        const root = _dialogRoot(html);
        if (!root) return;
        const hydrateFromStyleSelection = () => {
          const styleId = String(root.querySelector("#cgCombatStyleSelect")?.value ?? "__new__");
          if (styleId === "__new__") {
            const rank = root.querySelector("#cgCombatStyleRank");
            if (rank) rank.value = "novice";
            for (let i = 1; i <= 10; i += 1) {
              const te = root.querySelector(`#cgTe${i}`);
              if (te) te.value = "";
            }
            root.querySelectorAll(".cg-sa").forEach((el) => { el.checked = false; });
            return;
          }
          const style = actor.items.get(styleId);
          if (!style) return;
          const name = root.querySelector("#cgCombatStyleName");
          if (name) name.value = style.name ?? "";
          const rank = root.querySelector("#cgCombatStyleRank");
          if (rank) rank.value = normalizeRank(style.system?.rank ?? "untrained");
          const te = Array.isArray(style.system?.trainedEquipment) ? style.system.trainedEquipment : [];
          for (let i = 1; i <= 10; i += 1) {
            const field = root.querySelector(`#cgTe${i}`);
            if (field) field.value = String(te[i - 1] ?? "");
          }
          const saSet = new Set(
            Object.entries(style.system?.specialAdvantages ?? {})
              .filter(([, enabled]) => Boolean(enabled))
              .map(([k]) => k)
          );
          root.querySelectorAll(".cg-sa").forEach((el) => {
            el.checked = saSet.has(String(el.value));
          });
        };

        const updateEstimate = () => {
          const out = computeCombatSetupCost(readCombatFormState(root));
          const valueEl = root.querySelector("#cgCombatStyleCost");
          const breakEl = root.querySelector("#cgCombatStyleCostBreakdown");
          if (valueEl) valueEl.textContent = String(out.ok ? out.xpCost : 0);
          if (breakEl) {
            breakEl.textContent = out.ok
              ? (out.freeCombatStyle
                ? tf("UESRPG.Dialogs.CharGen.FreeCombatStyleBreakdown", { xp: out.actualXpCost })
                : tf("UESRPG.Dialogs.CharGen.CombatStyleCostBreakdown", { rank: out.breakdown.rankCost, te: out.breakdown.teCost, sa: out.breakdown.saCost }))
              : `(${out.reason ?? t("UESRPG.UI.Invalid")})`;
          }
        };

        const watched = [
          "#cgCombatStyleSelect",
          "#cgCombatStyleRank",
          "#cgCombatStyleName",
          "#cgTe1",
          "#cgTe2",
          "#cgTe3",
          "#cgTe4",
          "#cgTe5",
          "#cgTe6",
          "#cgTe7",
          "#cgTe8",
          "#cgTe9",
          "#cgTe10",
          "#cgFreeCombatStyle",
          "#cgSetActiveStyle",
        ];
        for (const sel of watched) {
          const el = root.querySelector(sel);
          if (!el) continue;
          el.addEventListener("change", updateEstimate);
          el.addEventListener("input", updateEstimate);
        }
        root.querySelector("#cgCombatStyleSelect")?.addEventListener("change", () => {
          hydrateFromStyleSelection();
          updateEstimate();
        });
        root.querySelectorAll(".cg-sa").forEach((el) => el.addEventListener("change", updateEstimate));
        hydrateFromStyleSelection();
        updateEstimate();
      },
    });
    if (!result || result === "cancel") return;
    if (!Array.isArray(result.specialAdvantages) || result.specialAdvantages.length < 1) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.SelectStartingSpecialAdvantage"));
      return;
    }
    if (!RANK_OPTIONS.includes(result.rank)) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.InvalidCombatStyleRank"));
      return;
    }

    const computed = computeCombatSetupCost(result);
    if (!computed.ok) {
      ui.notifications?.warn?.(computed.reason ?? t("UESRPG.Notifications.CharGen.InvalidCombatStyleSetup"));
      return;
    }

    let style = computed.style;
    if (result.styleId === "__new__") {
      const name = result.styleName || t("UESRPG.Dialogs.CharGen.CombatStyleName");
      const seed = {
        name,
        type: "combatStyle",
        img: "systems/uesrpg-3ev4/images/Icons/backToBack.webp",
        "system.rank": "untrained",
        "system.trainedEquipment": Array.from({ length: 10 }, () => ""),
        "system.specialAdvantages": {},
        "system.governingCha": "Str, Agi",
        "system.baseCha":
          (actor.system?.characteristics?.str?.total ?? 0) >= (actor.system?.characteristics?.agi?.total ?? 0)
            ? "str"
            : "agi",
      };
      const created = await requestCreateEmbeddedDocuments(actor, "Item", [seed]);
      style = created?.[0] ?? null;
      if (!style) {
        ui.notifications?.error?.(t("UESRPG.Notifications.CharGen.CreateCombatStyleFailed"));
        return;
      }
    }

    const targetRank = computed.targetRank;
    const desiredTe = computed.desiredTe;
    const nextSa = computed.nextSa;
    const xpCost = computed.xpCost;
    const freeCombatStyle = Boolean(computed.freeCombatStyle);

    const currentXp = _asNum(actor.system?.xp, 0);
    if (!freeCombatStyle && xpCost > currentXp) {
      ui.notifications?.warn?.(tf("UESRPG.Notifications.CharGen.NotEnoughXpCombatStyle", { required: xpCost, available: currentXp }));
      return;
    }

    await requestUpdateDocument(style, {
      name: result.styleId === "__new__" ? (result.styleName || style.name) : style.name,
      "system.rank": targetRank,
      "system.trainedEquipment": desiredTe,
      "system.specialAdvantages": nextSa,
    });
    if (!freeCombatStyle && xpCost > 0) {
      await requestUpdateDocument(actor, { "system.xp": currentXp - xpCost });
    }

    if (result.setActive) {
      await requestUpdateDocument(actor, { "flags.uesrpg-3ev4.activeCombatStyleId": style.id });
    }

    await requestUpdateDocument(actor, {
      "flags.uesrpg-3ev4.chargen.combatStyleSetup": {
        styleId: style.id,
        styleName: style.name,
        rank: targetRank,
        trainedEquipment: desiredTe.filter(Boolean),
        specialAdvantages: result.specialAdvantages,
        activeStyleId: result.setActive ? style.id : (actor.getFlag(SYSTEM_ID, "activeCombatStyleId") ?? null),
        spentXp: xpCost,
        waivedXp: freeCombatStyle ? _asNum(computed.actualXpCost, 0) : 0,
        freeCombatStyle,
      },
    });
    await appendChargenAudit(actor, {
      step: "combatstyle",
      action: "submit",
      payload: {
        styleId: style.id,
        styleName: style.name,
        rank: targetRank,
        trainedEquipment: desiredTe.filter(Boolean),
        specialAdvantages: result.specialAdvantages,
        setActive: result.setActive,
        spentXp: xpCost,
        waivedXp: freeCombatStyle ? _asNum(computed.actualXpCost, 0) : 0,
        freeCombatStyle,
      },
    });
    if (administrativeReason) {
      await appendChargenAudit(actor, buildAdministrativeCorrectionAudit(administrativeReason, {
        field: "combatStyle",
        itemUuid: style.uuid,
        waivedXp: freeCombatStyle ? _asNum(computed.actualXpCost, 0) : 0,
      }));
    }
    this._ws.completion.combatstyle = true;
    this.#persistState();
    await this.render();
  }

  static async _onOpenSpellLearning(event, target) {
    event?.preventDefault?.();
    const actor = await this.#resolveActor();
    if (!actor) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.SelectOrCreateActorFirst"));
      return;
    }

    await appendChargenAudit(actor, {
      step: "spells",
      action: "open",
      payload: {},
    });

    await SpellLearningMenuAppV2.prompt(actor, {
      onClose: async () => {
        this._ws.completion.spells = true;
        await appendChargenAudit(actor, {
          step: "spells",
          action: "close",
          payload: {
            learnedCount: Number(actor.getFlag(SYSTEM_ID, "chargen")?.spellLearning?.lastSummary?.learnedCount ?? 0),
          },
        });
        this.#persistState();
        await this.render();
      },
    });
  }

  static async _onOpenSpendXp(event, target) {
    event?.preventDefault?.();
    const actor = await this.#resolveActor();
    if (!actor) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.SelectOrCreateActorFirst"));
      return;
    }

    await SpendXpMenuAppV2.prompt(actor, {
      onClose: async () => {
        this._ws.completion.spendxp = true;
        await appendChargenAudit(actor, {
          step: "spendxp",
          action: "close",
          payload: {
            remainingXp: Number(actor.system?.xp ?? 0),
          },
        });
        this.#persistState();
        await this.render();
      },
    });
  }

  static async _onFinish(event, target) {
    event?.preventDefault?.();
    const actor = await this.#resolveActor();
    if (!actor) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.CharGen.SelectOrCreateActorFirst"));
      return;
    }

    await requestUpdateDocument(actor, {
      "flags.uesrpg.charGen.completed": true,
      "flags.uesrpg.charGen.inProgress": false,
      [`flags.${SYSTEM_ID}.chargen.completed`]: true,
      [`flags.${SYSTEM_ID}.chargen.inProgress`]: false,
    });

    const chargenFlags = actor.getFlag(SYSTEM_ID, "chargen") ?? {};
    const auditLog = Array.isArray(chargenFlags.auditLog) ? chargenFlags.auditLog : [];
    const summary = buildChargenSummary(actor, auditLog);
    const alreadyPosted = Boolean(chargenFlags.finalSummary?.postedAt);
    await requestUpdateDocument(actor, {
      "flags.uesrpg-3ev4.chargen.finalSummary": {
        ...summary,
        postedAt: alreadyPosted ? chargenFlags.finalSummary.postedAt : new Date().toISOString(),
      },
    });

    if (!alreadyPosted) {
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content: buildChargenSummaryChatHtml(summary),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      });
    }

    this._ws.completion.finish = true;
    this.#clearPersistedState();
    await this.close();
    actor.sheet?.render?.(true);
  }
}
