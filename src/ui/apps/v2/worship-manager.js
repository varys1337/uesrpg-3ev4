import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { templatePath } from "../../constants.js";
import { isReligionWorshipEnabled } from "../../../core/homebrew/settings.js";
import { getReligionDomain } from "../../../core/religion/domain-registry.js";
import {
  getActorRitualDomainEntries,
  getDomainPreparationLimit,
  buildInvocationGroupEntries,
} from "../../../core/religion/ritual-domains.js";
import {
  setPreparedInvocations,
  setWorshipPrimaryDomain,
} from "../../../core/religion/worship-service.js";
import { getWorshipDomainState } from "../../../core/religion/worship-store.js";
import { t, tf } from "../../../utils/i18n.js";
import { activateOpenApplication } from "./application-focus.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function asKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function promptPreparedInvocations(actor, domainEntry) {
  const domainKey = asKey(domainEntry?.key);
  const rows = buildInvocationGroupEntries(actor).flatMap((group) =>
    group.invocations
      .filter((entry) => entry.accessibleStores.includes(domainKey))
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        groupLabel: group.label,
        circle: entry.circle,
        pietyCost: entry.pietyCost,
        prepared: entry.preparedIn.includes(domainKey),
      }))
  );
  if (!rows.length) {
    ui.notifications?.info?.(tf("UESRPG.Notifications.Worship.NoInvocationsAvailable", { domain: domainEntry.label }));
    return;
  }

  const prepLimit = getDomainPreparationLimit(actor, domainKey);
  const picked = await customDialog({
    layout: "workflow",
    title: tf("UESRPG.Dialogs.Worship.PrepareInvocationsTitle", { domain: domainEntry.label }),
    content: `<div style="display:flex; flex-direction:column; gap:8px;">
      <p style="margin:0;">${tf("UESRPG.Dialogs.Worship.PreparationLimit", { limit: prepLimit })}</p>
      <div style="max-height:420px; overflow:auto;">${rows.map((row) => `
        <label style="display:flex; gap:8px; align-items:flex-start; padding:4px 0;">
          <input type="checkbox" name="invocationId" value="${row.id}" ${row.prepared ? "checked" : ""} />
          <span><b>${escapeHtml(row.label)}</b> (${escapeHtml(row.groupLabel)}, Circle ${row.circle}, ${row.pietyCost} PP)</span>
        </label>
      `).join("")}</div>
    </div>`,
    buttons: {
      save: {
        label: t("UESRPG.UI.Save"),
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return Array.from(root?.querySelectorAll('input[name="invocationId"]:checked') ?? []).map((el) => el.value);
        },
      },
      cancel: { label: t("UESRPG.UI.Cancel"), callback: () => null },
    },
    defaultButton: "save",
    width: 520,
  });
  if (!picked) return;
  if (picked.length > prepLimit) {
    ui.notifications?.warn?.(tf("UESRPG.Notifications.Worship.PreparationLimitExceeded", { limit: prepLimit, domain: domainEntry.label }));
    return;
  }
  await setPreparedInvocations(actor, domainKey, picked);
}

export class WorshipManagerAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static #openByActor = new Map();
  #actor;

  constructor(actor, options = {}) {
    super(options);
    this.#actor = actor;
  }

  static DEFAULT_OPTIONS = {
    id: "uesrpg-worship-manager-v2",
    classes: ["worldbuilding", "uesrpg", "uesrpg-worship-manager"],
    position: { width: 640, height: 460 },
    window: { resizable: true },
    actions: {
      close: WorshipManagerAppV2.prototype._onCloseClick,
      saveDomainPiety: WorshipManagerAppV2.prototype._onSaveDomainPiety,
      trackPietyDomain: WorshipManagerAppV2.prototype._onTrackPietyDomain,
      prepareInvocations: WorshipManagerAppV2.prototype._onPrepareInvocations,
    },
  };

  static PARTS = {
    main: {
      template: templatePath("v2/apps/worship-manager.hbs"),
      scrollable: [".uesrpg-worship-manager__scroll"],
    },
  };

  static async prompt(actor, options = {}) {
    if (!isReligionWorshipEnabled()) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.Worship.Disabled"));
      return null;
    }
    const key = String(actor?.uuid ?? actor?.id ?? "");
    const existing = this.#openByActor.get(key);
    if (existing?.rendered) {
      return activateOpenApplication(existing, { render: true });
    }
    const app = new WorshipManagerAppV2(actor, options);
    this.#openByActor.set(key, app);
    await app.render(true);
    return app;
  }

  get actor() {
    return this.#actor;
  }

  get title() {
    return t("UESRPG.Dialogs.Worship.ManagePietyTitle", "Manage Piety Points");
  }

  async close(options = {}) {
    const key = String(this.actor?.uuid ?? this.actor?.id ?? "");
    WorshipManagerAppV2.#openByActor.delete(key);
    return super.close(options);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const trackedDomainKey = asKey(this.actor?.system?.worship?.primaryDomainKey);
    const ritualDomains = getActorRitualDomainEntries(this.actor).map((entry) => {
      const state = getWorshipDomainState(this.actor, entry.key);
      return {
        key: entry.key,
        label: entry.label,
        pietyValue: asNumber(state?.piety?.value, 0),
        pietyMax: state?.piety?.max == null ? asNumber(entry.pietyMax, 0) : asNumber(state?.piety?.max, 0),
        deityName: String(state?.deityName ?? "").trim(),
        initiated: state?.initiated === true,
        penanceBlocked: state?.penance?.blocked === true,
        fastingActive: state?.observances?.fasting?.active === true,
        prepLimit: getDomainPreparationLimit(this.actor, entry.key),
        preparedCount: Array.isArray(state?.preparation?.preparedInvocationIds) ? state.preparation.preparedInvocationIds.length : 0,
        isTracked: entry.key === trackedDomainKey,
      };
    });
    return {
      ...context,
      actorName: this.actor?.name ?? t("UESRPG.UI.Unknown"),
      actorType: this.actor?.type ?? "",
      trackedDomainKey,
      trackedDomainLabel: getReligionDomain(trackedDomainKey)?.label ?? "",
      showTrackedDomainSummary: ritualDomains.length > 1,
      ritualDomains,
    };
  }

  _onCloseClick(event) {
    event?.preventDefault?.();
    return this.close();
  }

  async _onSaveDomainPiety(event, target) {
    event?.preventDefault?.();
    const domainKey = asKey(target?.closest?.("[data-domain-key]")?.dataset?.domainKey);
    if (!domainKey) return;

    const article = target?.closest?.("[data-domain-key]");
    const currentPP = Math.max(0, asNumber(article?.querySelector?.('input[name="domainCurrentPP"]')?.value, 0));
    const maxPP = Math.max(0, asNumber(article?.querySelector?.('input[name="domainMaxPP"]')?.value, 0));

    await requestUpdateDocument(this.actor, {
      [`system.worship.domains.${domainKey}.piety.value`]: Math.min(currentPP, maxPP),
      [`system.worship.domains.${domainKey}.piety.max`]: maxPP,
    });
    await this.render();
  }

  async _onTrackPietyDomain(event, target) {
    event?.preventDefault?.();
    const domainKey = asKey(target?.dataset?.domainKey);
    if (!domainKey) return;
    await setWorshipPrimaryDomain(this.actor, domainKey);
    await this.render();
  }

  async _onPrepareInvocations(event, target) {
    event?.preventDefault?.();
    const domainKey = asKey(target?.dataset?.domainKey);
    const entry = getActorRitualDomainEntries(this.actor).find((row) => row.key === domainKey);
    if (!entry) return;
    await promptPreparedInvocations(this.actor, entry);
    await this.render();
  }
}
