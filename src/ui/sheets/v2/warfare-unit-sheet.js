/**
 * src/ui/sheets/v2/warfare-unit-sheet.js
 *
 * ApplicationV2 Warfare Unit Actor Sheet.
 * Profile-driven Warfare Unit actor sheet.
 *
 * Does NOT subclass NPC/Group/PC sheet — fully independent.
 *
 * Long-form layout: overview, composition, command, combat, magic, logistics,
 * equipment, effects, notes, variant
 */

import { cachedEnrichHTML } from "../../../utils/enrich-cache.js";
import { confirmDialog, customDialog } from "../../../utils/dialog-v2-helper.js";
import {
  requestUpdateDocument,
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
} from "../../../utils/authority-proxy.js";
import { readDropData } from "../../../utils/drop-data.js";
import { onItemCreate } from "../shared/dialogs/equipment-dialogs.js";
import { postItemToChat } from "../shared-handlers.js";
import { applySheetDensityClass } from "./shared/sheet-density.js";
import { bindWindowRestoreGuard } from "./shared/window-restore-guard.js";
import {
  buildAllowedChangePatch,
  buildAllowedSubmitPatch,
  createFormPathMatcher,
} from "./shared/form-pipeline.js";
import { templatePath } from "../../constants.js";
import {
  resolveWarfareProfile,
  RANKS,
  TRADITIONS,
  createClashPending,
  rollDisciplineForUnit,
  handleWarfareAction,
  rollWarfareRangedAttack,
  castWarfareSpell,
  transformWarfareActionEntries,
  clearCommanderAttachment,
  hasWarfareActionEffect,
  WARFARE_EFFECT_KEYS,
} from "../../../core/mass-warfare/index.js";
import { maybeInitializeWarfareCondition } from "../../../core/mass-warfare/condition-target.js";
import { areTokensInBaseContact } from "../../../core/mass-warfare/battlefield/geometry.js";
import {
  recordWarfareEncounterClash,
  validateWarfareEncounterClash,
} from "../../../core/mass-warfare/encounter/controller.js";
import { getEncounterSceneForActor, getSceneWarfareEncounterState } from "../../../core/mass-warfare/encounter/state.js";
import { getRegionWarfareFeatureState, updateRegionWarfareFeatureState } from "../../../core/mass-warfare/siege/state.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ActorSheetV2 = foundry.applications.sheets.ActorSheetV2;

// ── Form path allow-list ──────────────────────────────────────────────────────
const ALLOWED_WARFARE_FORM_PATH = createFormPathMatcher({
  exact: [
    "name",
    "system.description",
    "system.notes",
    // ── Legacy lanes (backward compat; still written by migration ────────────
    "system.classification.unitType",
    "system.classification.ancestry",
    "system.classification.mount",
    "system.classification.tier",
    "system.stats.bulk.value",
    "system.stats.bulk.max",
    "system.stats.resolve.value",
    "system.stats.resolve.lossTotal",
    "system.stats.discipline.base",
    "system.stats.discipline.bonus",
    "system.stats.condition.value",
    "system.stats.condition.maxOverride",
    "system.stats.condition.useMaxOverride",
    "system.stats.magicka.value",
    "system.stats.speed.bonus",
    "system.commander.bonusOverride",
    "system.gear.sets",
    "system.gear.apparel",
    "system.racial.speedMod",
    "system.racial.magickaMod",
    "system.racial.offenseMod",
    "system.racial.offenseType",
    "system.racial.conditionMod",
    "system.racial.disciplineMod",
    "system.racial.special",
    "system.combat.hidden",
    "system.combat.deployed",
    "system.combat.leaderless",
    "system.upkeep.weeklyGold",
    "system.upkeep.enslaved",
    // ── Neutral canonical lanes ──────────────────────────────────────────────
    "system.profile.id",
    "system.identity.category",
    "system.identity.ancestry",
    "system.identity.rank",
    "system.doctrine.tradition",
    "system.gear.tier",
    "system.mounts.primary",
    "system.economy.cadence",
    "system.economy.mode",
    "system.economy.amount",
    "system.economy.enslaved",
    "system.economy.unpaidWeeks",
    "system.economy.specialModifier",
    "system.magic.mode",
    "system.status.leaderless",
    "system.status.battle.hidden",
    "system.status.battle.ambushReady",
    "system.status.battle.revealed",
    "system.status.battle.routed",
    "system.status.battle.broken",
    "system.status.battle.suppressed",
    "system.status.battle.defeated",
    "system.status.battle.frenzied",
    "system.status.battle.flyer",
    "system.modifiers.discipline.manual",
    "system.modifiers.discipline.campaign.inspiringSpeech",
    "system.modifiers.discipline.campaign.forcedMarch",
    "system.modifiers.discipline.campaign.poorClimate",
    "system.modifiers.discipline.campaign.longCampaign",
    "system.modifiers.discipline.campaign.defendingAlliedSettlement",
    "system.modifiers.discipline.battle.rearCharged",
    "system.modifiers.discipline.battle.adjacentFriendlyBroken",
    "system.modifiers.discipline.battle.commanderLost",
    "system.modifiers.discipline.battle.rallyBonus",
    "system.modifiers.discipline.battle.enemyBrokenBonus",
  ],
  prefixes: [
    // Legacy array lanes
    "system.traits.",
    "system.spells.",
    "system.deployableEquipment.",
    // Neutral canonical array lanes
    "system.magic.entries.",
    "system.equipment.owned.",
    "system.variant.tags.",
  ],
});

const RANK_OPTIONS = Object.entries(RANKS).map(([value, entry]) => ({ value, label: entry.label }));
const TRADITION_OPTIONS = Object.entries(TRADITIONS).map(([value, entry]) => ({ value, label: entry.label }));

function expandWarfareCompatibilityPatch(document, patch = {}) {
  if (!document || !patch || typeof patch !== "object") return patch;

  const expanded = { ...patch };
  const current = document.system ?? {};

  if ("system.identity.category" in patch) {
    expanded["system.classification.unitType"] = String(patch["system.identity.category"] ?? "");
  }
  if ("system.classification.unitType" in patch) {
    expanded["system.identity.category"] = String(patch["system.classification.unitType"] ?? "");
  }
  if ("system.identity.ancestry" in patch) {
    expanded["system.classification.ancestry"] = String(patch["system.identity.ancestry"] ?? "");
  }
  if ("system.classification.ancestry" in patch) {
    expanded["system.identity.ancestry"] = String(patch["system.classification.ancestry"] ?? "");
  }
  if ("system.doctrine.tradition" in patch) {
    expanded["system.identity.ancestry"] = String(patch["system.doctrine.tradition"] ?? "");
    expanded["system.classification.ancestry"] = String(patch["system.doctrine.tradition"] ?? "");
  }
  if ("system.mounts.primary" in patch) {
    expanded["system.classification.mount"] = String(patch["system.mounts.primary"] ?? "none");
  }
  if ("system.classification.mount" in patch) {
    expanded["system.mounts.primary"] = String(patch["system.classification.mount"] ?? "none");
  }
  if ("system.gear.tier" in patch) {
    expanded["system.classification.tier"] = String(patch["system.gear.tier"] ?? "light");
    expanded["system.gear.apparel"] = String(patch["system.gear.tier"] ?? "light");
  }
  if ("system.classification.tier" in patch) {
    expanded["system.gear.tier"] = String(patch["system.classification.tier"] ?? "light");
    expanded["system.gear.apparel"] = String(patch["system.classification.tier"] ?? "light");
  }
  if ("system.gear.apparel" in patch) {
    expanded["system.gear.tier"] = String(patch["system.gear.apparel"] ?? "light");
    expanded["system.classification.tier"] = String(patch["system.gear.apparel"] ?? "light");
  }

  const cadence = String(patch["system.economy.cadence"] ?? current.economy?.cadence ?? "weekly");
  const mode = String(patch["system.economy.mode"] ?? current.economy?.mode ?? "gold");
  const amountChanged =
    "system.economy.amount" in patch ||
    "system.economy.cadence" in patch ||
    "system.economy.mode" in patch;
  if (amountChanged && cadence === "weekly" && mode === "gold") {
    expanded["system.upkeep.weeklyGold"] = Number(patch["system.economy.amount"] ?? current.economy?.amount ?? 0);
  }
  if ("system.economy.enslaved" in patch) {
    expanded["system.upkeep.enslaved"] = Boolean(patch["system.economy.enslaved"]);
  }
  if ("system.upkeep.weeklyGold" in patch) {
    expanded["system.economy.cadence"] = "weekly";
    expanded["system.economy.mode"] = "gold";
    expanded["system.economy.amount"] = Number(patch["system.upkeep.weeklyGold"] ?? 0);
  }
  if ("system.upkeep.enslaved" in patch) {
    expanded["system.economy.enslaved"] = Boolean(patch["system.upkeep.enslaved"]);
  }

  if ("system.status.leaderless" in patch) {
    expanded["system.combat.leaderless"] = Boolean(patch["system.status.leaderless"]);
  }
  if ("system.combat.leaderless" in patch) {
    expanded["system.status.leaderless"] = Boolean(patch["system.combat.leaderless"]);
  }
  if ("system.status.battle.hidden" in patch) {
    const hidden = Boolean(patch["system.status.battle.hidden"]);
    expanded["system.combat.hidden"] = hidden;
    if (hidden) expanded["system.status.battle.revealed"] = false;
  }
  if ("system.combat.hidden" in patch) {
    const hidden = Boolean(patch["system.combat.hidden"]);
    expanded["system.status.battle.hidden"] = hidden;
    if (hidden) expanded["system.status.battle.revealed"] = false;
  }
  if ("system.status.battle.revealed" in patch && Boolean(patch["system.status.battle.revealed"])) {
    expanded["system.status.battle.hidden"] = false;
    expanded["system.combat.hidden"] = false;
  }

  if ("system.stats.resolve.value" in patch) {
    expanded["system.stats.condition.value"] = Number(patch["system.stats.resolve.value"] ?? 0);
  }
  if ("system.stats.condition.value" in patch && !("system.stats.resolve.value" in patch)) {
    expanded["system.stats.resolve.value"] = Number(patch["system.stats.condition.value"] ?? 0);
  }

  return expanded;
}

function resolveWarfareActorScene(actor) {
  return getEncounterSceneForActor(actor)
    ?? actor?.token?.document?.parent
    ?? actor?.getActiveTokens?.()[0]?.document?.parent
    ?? canvas?.scene
    ?? null;
}

function classifyEquipmentFeatureType(entry = {}) {
  const key = String(entry?.key ?? "").trim().toLowerCase();
  if (key.includes("mantlet")) return "mantlet";
  if (key.includes("caltrop")) return "caltrops";
  if (key.includes("spike")) return "spikes";
  if (key.includes("fascine")) return "fascines";
  if (key.includes("palisade")) return "palisade";
  if (key.includes("mound")) return "mound";
  const name = String(entry?.name ?? "").trim().toLowerCase();
  if (name.includes("mantlet")) return "mantlet";
  if (name.includes("caltrop")) return "caltrops";
  if (name.includes("spike")) return "spikes";
  if (name.includes("fascine")) return "fascines";
  if (name.includes("palisade")) return "palisade";
  if (name.includes("mound")) return "mound";
  return "";
}

async function promptClashContactSides({
  actorName = "Attacker",
  targetName = "Defender",
  attackerDefault = "front",
  defenderDefault = "front",
} = {}) {
  const normalizeSide = (value, fallback = "front") => {
    const side = String(value ?? "").trim().toLowerCase();
    return new Set(["front", "flank", "rear"]).has(side) ? side : fallback;
  };
  const selectedAttackerSide = normalizeSide(attackerDefault);
  const selectedDefenderSide = normalizeSide(defenderDefault);
  const buildOptions = (selected) => ["front", "flank", "rear"]
    .map((side) => `<option value="${side}"${side === selected ? " selected" : ""}>${side.charAt(0).toUpperCase() + side.slice(1)}</option>`)
    .join("");

  return customDialog({
    title: `${actorName} - Contact Sides`,
    content: `
      <div class="warfare-clash-commit-dialog">
        <p>Track clash position manually for <b>${foundry.utils.escapeHTML(actorName)}</b> and <b>${foundry.utils.escapeHTML(targetName)}</b>.</p>
        <div class="form-group">
          <label>Attacker Position vs Defender</label>
          <select name="attackerContactSide">${buildOptions(selectedAttackerSide)}</select>
        </div>
        <div class="form-group">
          <label>Defender Position vs Attacker</label>
          <select name="defenderContactSide">${buildOptions(selectedDefenderSide)}</select>
        </div>
      </div>`,
    buttons: {
      confirm: {
        label: "Confirm",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return {
            attackerContactSide: normalizeSide(root?.querySelector('[name="attackerContactSide"]')?.value),
            defenderContactSide: normalizeSide(root?.querySelector('[name="defenderContactSide"]')?.value),
          };
        },
      },
      cancel: { label: "Cancel" },
    },
    defaultButton: "confirm",
    width: 460,
  });
}

export class WarfareUnitSheetV2 extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["worldbuilding", "sheet", "actor", "warfare-unit", "uesrpg-sheet-root"],
    position: { width: 940, height: 900 },
    window: { resizable: true },
    form: {
      handler: WarfareUnitSheetV2.prototype._onFormSubmit,
      submitOnChange: false,
      closeOnSubmit: false,
    },
    dragDrop: [{
      dragSelector: null,
      dropSelector: ".window-content, .warfare-sidebar__commander",
    }],
    actions: {
      // Portrait / commander
      editPortrait:        WarfareUnitSheetV2.prototype._onEditPortrait,
      viewCommander:       WarfareUnitSheetV2.prototype._onViewCommander,
      clearCommander:      WarfareUnitSheetV2.prototype._onClearCommander,
      // Embedded items (trait / talent / power)
      itemCreate:          WarfareUnitSheetV2.prototype._onItemCreate,
      itemOpen:            WarfareUnitSheetV2.prototype._onItemOpen,
      itemDelete:          WarfareUnitSheetV2.prototype._onItemDelete,
      postItemToChat:      WarfareUnitSheetV2.prototype._onPostItemToChat,
      // Spells (legacy system.spells[])
      addSpell:            WarfareUnitSheetV2.prototype._onAddSpell,
      removeSpell:         WarfareUnitSheetV2.prototype._onRemoveSpell,
      // Magic entries (neutral system.magic.entries[])
      addMagicEntry:       WarfareUnitSheetV2.prototype._onAddMagicEntry,
      removeMagicEntry:    WarfareUnitSheetV2.prototype._onRemoveMagicEntry,
      // Deployable equipment (legacy system.deployableEquipment[])
      addEquipment:        WarfareUnitSheetV2.prototype._onAddEquipment,
      removeEquipment:     WarfareUnitSheetV2.prototype._onRemoveEquipment,
      // Owned equipment (neutral system.equipment.owned[])
      addOwnedEquipment:   WarfareUnitSheetV2.prototype._onAddOwnedEquipment,
      removeOwnedEquipment: WarfareUnitSheetV2.prototype._onRemoveOwnedEquipment,
      configureOwnedEquipmentRegion: WarfareUnitSheetV2.prototype._onConfigureOwnedEquipmentRegion,
      deployOwnedEquipmentToRegion: WarfareUnitSheetV2.prototype._onDeployOwnedEquipmentToRegion,
      // Warfare action buttons (Leader / Unit) and Clash automation
      rollWarfareAction:   WarfareUnitSheetV2.prototype._onRollWarfareAction,
      initiateClash:       WarfareUnitSheetV2.prototype._onInitiateClash,
      rollDiscipline:      WarfareUnitSheetV2.prototype._onRollDiscipline,
      rollRangedAttack:    WarfareUnitSheetV2.prototype._onRollRangedAttack,
      castSpellDirect:     WarfareUnitSheetV2.prototype._onCastSpellDirect,
      // Active Effects
      createEffect:        WarfareUnitSheetV2.prototype._onCreateEffect,
      editEffect:          WarfareUnitSheetV2.prototype._onEditEffect,
      deleteEffect:        WarfareUnitSheetV2.prototype._onDeleteEffect,
    },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "core" },
        { id: "actions" },
        { id: "magic" },
        { id: "items" },
      ],
      initial: "core",
    },
  };

  static PARTS = {
    sidebar: {
      template: templatePath("v2/sheets/warfare-unit/sidebar.hbs"),
      scrollable: [".warfare-sidebar__content"],
    },
    core: {
      template: templatePath("v2/sheets/warfare-unit/tab-core.hbs"),
      scrollable: [".tabContainer"],
    },
    actions: {
      template: templatePath("v2/sheets/warfare-unit/tab-actions.hbs"),
      scrollable: [".tabContainer"],
    },
    magic: {
      template: templatePath("v2/sheets/warfare-unit/tab-magic.hbs"),
      scrollable: [".tabContainer"],
    },
    items: {
      template: templatePath("v2/sheets/warfare-unit/tab-items.hbs"),
      scrollable: [".tabContainer"],
    },
    limited: {
      template: templatePath("v2/sheets/warfare-unit/limited.hbs"),
    },
  };

  get title() {
    return this.document.name;
  }

  get form() {
    return this.element;
  }

  // ── Form pipeline ─────────────────────────────────────────────────────────

  async _onChangeForm(formConfig, event) {
    if (typeof super._onChangeForm === "function") super._onChangeForm(formConfig, event);
    if (!this.isEditable || !this.document?.isOwner) return;

    const patch = buildAllowedChangePatch({
      document: this.document,
      target: event?.target,
      allowPath: ALLOWED_WARFARE_FORM_PATH,
    });
    if (!patch) return;

    await requestUpdateDocument(this.document, expandWarfareCompatibilityPatch(this.document, patch));
    await maybeInitializeWarfareCondition(this.document, {
      maxCondition: Number(this.document.system?.stats?.resolve?.max ?? this.document.system?.stats?.condition?.max ?? this.document.system?._derived?.resolveMax ?? this.document.system?._derived?.conditionMax ?? 0) || 0,
    });
  }

  async _onFormSubmit(_event, _form, formData) {
    if (!this.isEditable || !this.document?.isOwner) return;

    const patch = buildAllowedSubmitPatch({
      document: this.document,
      formDataObject: formData?.object,
      allowPath: ALLOWED_WARFARE_FORM_PATH,
    });
    if (!patch) return;
    await requestUpdateDocument(this.document, expandWarfareCompatibilityPatch(this.document, patch));
    await maybeInitializeWarfareCondition(this.document, {
      maxCondition: Number(this.document.system?.stats?.resolve?.max ?? this.document.system?.stats?.condition?.max ?? this.document.system?._derived?.resolveMax ?? this.document.system?._derived?.conditionMax ?? 0) || 0,
    });
  }

  // ── Render configuration ──────────────────────────────────────────────────

  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    if (this.document.limited && !game.user.isGM) {
      options.parts = ["limited"];
    } else {
      options.parts = ["sidebar", "core", "actions", "magic", "items"];
    }
  }

  // ── Context preparation ───────────────────────────────────────────────────

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const sys = actor.system;

    context.actor = actor;
    context.system = sys;
    context.isGM = game.user.isGM;
    context.editable = this.isEditable;
    context.limited = !game.user.isGM && actor.limited;
    context.owner = actor.isOwner;

    // ── Profile resolution ────────────────────────────────────────────────
    const profileId = String(sys.profile?.id ?? "uesrpg-0_2");
    const profile = resolveWarfareProfile(profileId);
    context.profileId = profileId;
    context.profileLabel = profile?.label ?? profileId;
    context.profileWarnings = Array.isArray(sys._derived?.warnings) ? sys._derived.warnings : [];

    // ── Category options (unit type) ──────────────────────────────────────
    const currentCategory = String(
      sys.identity?.category || sys.classification?.unitType || ""
    ).toLowerCase();
    const profileCategories = profile?.categories ?? {};
    context.categoryOptions = Object.entries(profileCategories).map(([key, cat]) => ({
      value: key,
      label: cat.label ?? (key.charAt(0).toUpperCase() + key.slice(1)),
      selected: key === currentCategory,
    }));
    context.currentCategory = currentCategory;

    // ── Ancestry options (unified with racial preset) ─────────────────────
    // racialPresetKey and identity.ancestry are kept in sync; use the first
    // non-empty value across all lanes as the canonical current selection.
    const currentRank = String(sys.identity?.rank || "").toLowerCase();
    context.rankOptions = RANK_OPTIONS.map((opt) => ({
      ...opt,
      selected: opt.value === currentRank,
    }));
    context.currentRank = currentRank;

    const currentTradition = String(sys.doctrine?.tradition || "").toLowerCase();
    context.traditionOptions = TRADITION_OPTIONS.map((opt) => ({
      ...opt,
      selected: opt.value === currentTradition,
    }));
    context.currentTradition = currentTradition;

    // ── Mount options ─────────────────────────────────────────────────────
    const currentMount = String(
      sys.mounts?.primary || sys.classification?.mount || "none"
    );
    const profileMounts = profile?.mounts ?? {};
    context.mountOptions = Object.entries(profileMounts).map(([key, data]) => ({
      value: key,
      label: data.label ?? (key.charAt(0).toUpperCase() + key.slice(1)),
      selected: key === currentMount,
    }));
    context.currentMount = currentMount;
    context.currentMountData = profileMounts[currentMount] ?? null;

    // ── Gear tier options ─────────────────────────────────────────────────
    const currentTier = String(sys.gear?.apparel || sys.gear?.tier || sys.classification?.tier || "light");
    const profileGearTiers = profile?.apparel ?? profile?.gearTiers ?? {};
    context.tierOptions = Object.entries(profileGearTiers).map(([key, data]) => ({
      value: key,
      label: data.label ?? (key.charAt(0).toUpperCase() + key.slice(1)),
      selected: key === currentTier,
    }));
    context.currentTier = currentTier;
    context.apparelOptions = context.tierOptions;

    // ── Profile action lists ──────────────────────────────────────────────
    context.unitActions = transformWarfareActionEntries(actor, profile?.actions?.unitActions ?? []);
    context.leaderActions = transformWarfareActionEntries(actor, profile?.actions?.leaderActions ?? []);

    // ── Economy lane ──────────────────────────────────────────────────────
    const economyModel = profile?.economy ?? {};
    context.economy = {
      cadence: sys.economy?.cadence ?? economyModel.defaultCadence ?? "weekly",
      mode:    sys.economy?.mode    ?? economyModel.defaultMode    ?? "gold",
      amount:  sys.economy?.amount  ?? 0,
      enslaved: Boolean(sys.economy?.enslaved ?? sys.upkeep?.enslaved ?? false),
      unpaidWeeks: Number(sys.economy?.unpaidWeeks ?? 0) || 0,
      specialModifier: Number(sys.economy?.specialModifier ?? 0) || 0,
      supportedCadences: economyModel.supportedCadences ?? ["weekly", "monthly", "campaign"],
      supportedModes:    economyModel.supportedModes    ?? ["gold", "resource", "labor"],
    };

    // ── Magic lane ────────────────────────────────────────────────────────
    const magicModel = profile?.magic ?? {};
    context.magic = {
      mode:       sys.magic?.mode    ?? magicModel.defaultMode ?? "implements",
      entries:    Array.isArray(sys.magic?.entries) ? sys.magic.entries : [],
      modeLabels: magicModel.modeLabels ?? {},
      supportedModes: magicModel.supportedModes ?? ["implements"],
    };

    // ── Equipment lane ────────────────────────────────────────────────────
    context.equipmentOwned = Array.isArray(sys.equipment?.owned) ? sys.equipment.owned : [];

    // Traits/Talents/Powers removed from Core tab — no context needed.

    // ── Legacy presence flags ─────────────────────────────────────────────
    context.hasLegacySpells = Array.isArray(sys.spells) && sys.spells.length > 0;
    context.hasLegacyDeployableEquipment = Array.isArray(sys.deployableEquipment) && sys.deployableEquipment.length > 0;
    context.hasLegacyNotes = typeof sys.notes === "string" && sys.notes.trim().length > 0;

    // ── Derived display cache ─────────────────────────────────────────────
    context.derived = sys._derived ?? {};

    // ── Fill-bar percentages for sidebar trackers ─────────────────────────
    const resolveMax = sys.stats?.resolve?.max ?? sys.stats?.condition?.max ?? 0;
    context.resolvePct = resolveMax > 0
      ? Math.min(100, Math.round((sys.stats.resolve?.value ?? sys.stats.condition.value ?? 0) / resolveMax * 100))
      : 0;
    context.conditionPct = context.resolvePct;
    // Discipline: fill proportion = effective value / unpenalized max
    const discValue = sys.stats?.discipline?.value ?? 0;
    const discMax   = sys._derived?.disciplineMax ?? 0;
    context.disciplinePct = discMax > 0
      ? Math.min(100, Math.round(discValue / discMax * 100))
      : 0;
    const magMax = sys.stats?.magicka?.max ?? 0;
    context.magickaPct = magMax > 0
      ? Math.min(100, Math.round((sys.stats.magicka.value ?? 0) / magMax * 100))
      : 0;
    const bulkVal = sys.stats?.bulk?.value ?? 0;
    const bulkMaxVal = sys._derived?.bulkMax ?? bulkVal;
    context.bulkPct = bulkMaxVal > 0
      ? Math.min(100, Math.round(bulkVal / bulkMaxVal * 100))
      : 0;

    // ── Commander resolution ──────────────────────────────────────────────
    context.commanderResolved = null;
    const cmdUuid = sys.commander?.uuid;
    if (cmdUuid) {
      try {
        const cmdActor = await fromUuid(cmdUuid);
        if (cmdActor) {
          context.commanderResolved = {
            name: cmdActor.name,
            img: cmdActor.img,
            uuid: cmdActor.uuid,
            type: cmdActor.type,
          };
        }
      } catch (_e) {
        // Stale link — cached name/img shown from commander payload
      }
    }

    // ── Effects list ──────────────────────────────────────────────────────
    context.effects = Array.from(actor.effects ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      img: e.img,
      disabled: e.disabled,
    }));

    // ── Rich text ─────────────────────────────────────────────────────────
    const enrichFn = foundry.applications.ux.TextEditor.implementation.enrichHTML;
    const _enrich = (raw) => enrichFn(raw || "");

    context.enrichedDescription = await cachedEnrichHTML(
      this, "wf:desc", sys.description ?? "", _enrich
    );

    if (!context.limited) {
      context.enrichedNotes = await cachedEnrichHTML(
        this, "wf:notes", sys.notes ?? "", _enrich
      );
    }

    return context;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    applySheetDensityClass(el);
    bindWindowRestoreGuard(this, el);

    if (context.limited) return;

    // Activate primary tab group
    const expectedPrimary = this.tabGroups.primary ?? "core";
    const activePrimary = el.querySelector('.tab[data-group="primary"].active')?.dataset?.tab ?? null;
    if (activePrimary !== expectedPrimary) {
      this.changeTab(expectedPrimary, "primary", { force: true });
    }

  }

  _onClose(options) {
    return super._onClose(options);
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────────

  _canDragDrop(_selector) {
    return this.isEditable;
  }

  async _onDrop(event) {
    const data = readDropData(event, {});
    if (data.type === "Actor") return this._onDropActor(event, data);
    return super._onDrop(event);
  }

  /**
   * Commander drop handler. Only accepts Player Character and NPC actors.
   */
  async _onDropActor(_event, data) {
    if (!this.isEditable) return;
    const actor = await fromUuid(data.uuid);
    if (!actor) {
      ui.notifications.warn("Could not find actor.");
      return;
    }

    if (actor.type === "Group") {
      ui.notifications.warn("Groups cannot be assigned as commanders.");
      return;
    }
    if (actor.type === "Warfare Unit") {
      ui.notifications.warn("Warfare Units cannot be assigned as commanders.");
      return;
    }

    await requestUpdateDocument(this.document, {
      "system.commander.uuid": actor.uuid,
      "system.commander.id":   actor.id,
      "system.commander.name": actor.name,
      "system.commander.img":  actor.img,
      "system.status.leaderless": false,
      "system.combat.leaderless": false,
      "system.modifiers.discipline.battle.commanderLost": false,
      "system.commanderAttachment.leaderActorUuid": actor.uuid,
      "system.commanderAttachment.warfareTokenUuid": "",
      "system.commanderAttachment.leaderTokenUuid": "",
      "system.commanderAttachment.sceneId": "",
    });
    ui.notifications.info(`${actor.name} assigned as commander.`);
  }

  // ── Action Handlers ───────────────────────────────────────────────────────

  async _onEditPortrait(event, _target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    const current = String(this.document?.img ?? "");
    const picker = new FilePicker({
      type: "imagevideo",
      current,
      callback: async (path) => {
        if (!path || path === current) return;
        await requestUpdateDocument(this.document, { img: path });
      },
    });
    await picker.browse();
  }

  async _onViewCommander(_event, _target) {
    const uuid = this.document.system.commander?.uuid;
    if (!uuid) return;
    const actor = await fromUuid(uuid);
    if (actor) actor.sheet.render(true);
    else ui.notifications.warn("Commander actor not found.");
  }

  async _onClearCommander(_event, _target) {
    if (!this.isEditable) return;
    await clearCommanderAttachment(this.document, { clearCommander: true });
  }

  /**
   * Legacy handler retained for compatibility. In v2 this just synchronizes the
   * selected tradition into the old ancestry lane.
   */
  async _onApplyRacialPreset(_event, _target) {
    if (!this.isEditable) return;
    const traditionKey = String(this.document.system.doctrine?.tradition ?? "").toLowerCase();
    if (!TRADITIONS[traditionKey]) {
      ui.notifications.warn("No Provincial Tradition is selected.");
      return;
    }
    await requestUpdateDocument(this.document, {
      "system.identity.ancestry": traditionKey,
      "system.classification.ancestry": traditionKey,
    });
    ui.notifications.info(`Synchronized ${traditionKey} to the legacy ancestry lane.`);
  }

  // ── Trait array management (legacy system.traits[]) ───────────────────────

  async _onAddTrait(_event, _target) {
    if (!this.isEditable) return;
    const traits = foundry.utils.deepClone(this.document.system.traits ?? []);
    traits.push({ name: "", description: "" });
    await requestUpdateDocument(this.document, { "system.traits": traits });
  }

  async _onRemoveTrait(_event, target) {
    if (!this.isEditable) return;
    const idx = Number(target?.dataset?.traitIndex ?? -1);
    if (idx < 0) return;
    const traits = foundry.utils.deepClone(this.document.system.traits ?? []);
    traits.splice(idx, 1);
    await requestUpdateDocument(this.document, { "system.traits": traits });
  }

  // ── Spell array management (legacy system.spells[]) ───────────────────────

  async _onAddSpell(_event, _target) {
    if (!this.isEditable) return;
    const spells = foundry.utils.deepClone(this.document.system.spells ?? []);
    spells.push({ name: "", effect: "" });
    await requestUpdateDocument(this.document, { "system.spells": spells });
  }

  async _onRemoveSpell(_event, target) {
    if (!this.isEditable) return;
    const idx = Number(target?.dataset?.spellIndex ?? -1);
    if (idx < 0) return;
    const spells = foundry.utils.deepClone(this.document.system.spells ?? []);
    spells.splice(idx, 1);
    await requestUpdateDocument(this.document, { "system.spells": spells });
  }

  // ── Magic entries (neutral system.magic.entries[]) ────────────────────────

  async _onAddMagicEntry(_event, _target) {
    if (!this.isEditable) return;
    const entries = foundry.utils.deepClone(this.document.system.magic?.entries ?? []);
    entries.push({ key: "", name: "", family: "support", count: 1, effect: "" });
    await requestUpdateDocument(this.document, { "system.magic.entries": entries });
  }

  async _onRemoveMagicEntry(_event, target) {
    if (!this.isEditable) return;
    const idx = Number(target?.dataset?.entryIndex ?? -1);
    if (idx < 0) return;
    const entries = foundry.utils.deepClone(this.document.system.magic?.entries ?? []);
    entries.splice(idx, 1);
    await requestUpdateDocument(this.document, { "system.magic.entries": entries });
  }

  // ── Deployable equipment (legacy system.deployableEquipment[]) ────────────

  async _onAddEquipment(_event, _target) {
    if (!this.isEditable) return;
    const equip = foundry.utils.deepClone(this.document.system.deployableEquipment ?? []);
    equip.push({ name: "", deployTime: 0, effect: "" });
    await requestUpdateDocument(this.document, { "system.deployableEquipment": equip });
  }

  async _onRemoveEquipment(_event, target) {
    if (!this.isEditable) return;
    const idx = Number(target?.dataset?.equipIndex ?? -1);
    if (idx < 0) return;
    const equip = foundry.utils.deepClone(this.document.system.deployableEquipment ?? []);
    equip.splice(idx, 1);
    await requestUpdateDocument(this.document, { "system.deployableEquipment": equip });
  }

  // ── Owned equipment (neutral system.equipment.owned[]) ────────────────────

  async _onAddOwnedEquipment(_event, _target) {
    if (!this.isEditable) return;
    const owned = foundry.utils.deepClone(this.document.system.equipment?.owned ?? []);
    owned.push({ key: "", name: "", deployTime: 1, deployProgress: 0, deployed: false, expended: false, placement: "", effect: "", cost: 0 });
    await requestUpdateDocument(this.document, { "system.equipment.owned": owned });
  }

  async _onRemoveOwnedEquipment(_event, target) {
    if (!this.isEditable) return;
    const idx = Number(target?.dataset?.ownedIndex ?? -1);
    if (idx < 0) return;
    const owned = foundry.utils.deepClone(this.document.system.equipment?.owned ?? []);
    owned.splice(idx, 1);
    await requestUpdateDocument(this.document, { "system.equipment.owned": owned });
  }

  async _onConfigureOwnedEquipmentRegion(event, target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    const scene = resolveWarfareActorScene(this.document);
    if (!scene) {
      ui.notifications.warn("Open the relevant scene before configuring warfare feature regions.");
      return;
    }
    const idx = Number(target?.dataset?.ownedIndex ?? -1);
    if (idx < 0) return;
    const owned = foundry.utils.deepClone(this.document.system.equipment?.owned ?? []);
    const entry = owned[idx];
    if (!entry) return;
    const regions = Array.from(scene?.regions?.contents ?? []);
    if (!regions.length) {
      ui.notifications.warn("This scene has no Regions to configure.");
      return;
    }
    const regionOptions = regions
      .map((region) => `<option value="${region.uuid}">${foundry.utils.escapeHTML(region.name || region.id)}</option>`)
      .join("");
    const picked = await customDialog({
      title: `${this.document.name} - Configure Warfare Region`,
      content: `
        <div class="form-group"><label><b>Region</b></label><select name="regionUuid">${regionOptions}</select></div>
        <div class="form-group"><label><b>Notes</b></label><input type="text" name="notes" value="${foundry.utils.escapeHTML(String(entry.effect ?? ""))}"></div>
      `,
      buttons: {
        confirm: {
          label: "Save",
          callback: (html) => ({
            regionUuid: String(html?.querySelector('[name="regionUuid"]')?.value ?? "").trim(),
            notes: String(html?.querySelector('[name="notes"]')?.value ?? "").trim(),
          }),
        },
        cancel: { label: "Cancel" },
      },
      defaultButton: "confirm",
      width: 460,
    });
    if (!picked?.regionUuid) return;
    const region = await fromUuid(String(picked.regionUuid));
    if (!region?.documentName || region.documentName !== "Region") return;
    const featureType = classifyEquipmentFeatureType(entry);
    await updateRegionWarfareFeatureState(region, (next) => ({
      ...next,
      kind: "deployable",
      type: featureType || next.type || "mantlet",
      sourceUnitActorUuid: this.document.uuid,
      hp: Math.max(0, Number(next.hp ?? 1) || 1),
      hpMax: Math.max(0, Number(next.hpMax ?? next.hp ?? 1) || 1),
      intact: true,
      notes: picked.notes,
    }));
    entry.placement = region.name || region.id;
    entry.effect = picked.notes;
    await requestUpdateDocument(this.document, { "system.equipment.owned": owned });
  }

  async _onDeployOwnedEquipmentToRegion(event, target) {
    event?.preventDefault?.();
    if (!this.isEditable) return;
    const scene = resolveWarfareActorScene(this.document);
    if (!scene) {
      ui.notifications.warn("Open the relevant scene before deploying support equipment.");
      return;
    }
    const encounterState = getSceneWarfareEncounterState(scene);
    if (encounterState?.active && String(encounterState.phase ?? "") !== "strategic") {
      ui.notifications.warn("Deploying warfare equipment on-scene is only available during the Strategic phase of an active encounter.");
      return;
    }
    const idx = Number(target?.dataset?.ownedIndex ?? -1);
    if (idx < 0) return;
    const owned = foundry.utils.deepClone(this.document.system.equipment?.owned ?? []);
    const entry = owned[idx];
    if (!entry) return;
    const regions = Array.from(scene?.regions?.contents ?? []);
    if (!regions.length) {
      ui.notifications.warn("This scene has no Regions available for deployment.");
      return;
    }
    const regionOptions = regions
      .map((region) => {
        const feature = getRegionWarfareFeatureState(region);
        const label = feature?.type ? `${region.name || region.id} (${feature.type})` : (region.name || region.id);
        return `<option value="${region.uuid}">${foundry.utils.escapeHTML(label)}</option>`;
      })
      .join("");
    const picked = await customDialog({
      title: `${this.document.name} - Deploy Equipment`,
      content: `<div class="form-group"><label><b>Region</b></label><select name="regionUuid">${regionOptions}</select></div>`,
      buttons: {
        confirm: { label: "Deploy", callback: (html) => String(html?.querySelector('[name="regionUuid"]')?.value ?? "").trim() },
        cancel: { label: "Cancel" },
      },
      defaultButton: "confirm",
      width: 460,
    });
    if (!picked) return;
    const region = await fromUuid(String(picked));
    if (!region?.documentName || region.documentName !== "Region") return;
    const featureType = classifyEquipmentFeatureType(entry);
    await updateRegionWarfareFeatureState(region, (next) => ({
      ...next,
      kind: "deployable",
      type: featureType || next.type || "mantlet",
      sourceUnitActorUuid: this.document.uuid,
      hp: Math.max(0, Number(next.hp ?? 1) || 1),
      hpMax: Math.max(0, Number(next.hpMax ?? next.hp ?? 1) || 1),
      intact: true,
    }));
    entry.deployed = true;
    entry.deployProgress = Number(entry.deployTime ?? 0) || 0;
    entry.placement = region.name || region.id;
    await requestUpdateDocument(this.document, { "system.equipment.owned": owned });
  }

  // ── Variant tag management (system.variant.tags[]) ────────────────────────

  async _onAddVariantTag(_event, _target) {
    if (!this.isEditable) return;
    const tags = foundry.utils.deepClone(this.document.system.variant?.tags ?? []);
    tags.push("");
    await requestUpdateDocument(this.document, { "system.variant.tags": tags });
  }

  async _onRemoveVariantTag(_event, target) {
    if (!this.isEditable) return;
    const idx = Number(target?.dataset?.tagIndex ?? -1);
    if (idx < 0) return;
    const tags = foundry.utils.deepClone(this.document.system.variant?.tags ?? []);
    tags.splice(idx, 1);
    await requestUpdateDocument(this.document, { "system.variant.tags": tags });
  }

  // ── Warfare action buttons ────────────────────────────────────────────────

  async _onRollWarfareAction(_event, target) {
    const actionId   = target?.dataset?.actionId ?? "";
    const actionType = target?.dataset?.actionType ?? "unit";
    await handleWarfareAction(this.document, { actionId, actionType });
  }

  // ── Clash automation ──────────────────────────────────────────────────────

  async _onInitiateClash(_event, _target) {
    const actor = this.document;
    if (actor?.system?.status?.battle?.broken || actor?.system?.status?.battle?.routed) {
      ui.notifications.warn("Broken or Routed warfare units cannot initiate clashes.");
      return;
    }
    const targets = [...(game.user.targets ?? [])];
    if (targets.length !== 1) {
      ui.notifications.warn("Select exactly one target Warfare Unit token before initiating a Clash.");
      return;
    }
    const targetActor = targets[0].actor;
    if (!targetActor || targetActor.type !== "Warfare Unit") {
      ui.notifications.warn("The targeted token must be a Warfare Unit.");
      return;
    }
    if (targetActor?.system?.status?.battle?.defeated) {
      ui.notifications.warn("The targeted warfare unit is defeated.");
      return;
    }
    if (targetActor.id === actor.id) {
      ui.notifications.warn("A unit cannot clash with itself.");
      return;
    }

    const encounterGate = await validateWarfareEncounterClash(actor, {
      targetTokenDoc: targets[0]?.document ?? null,
    });
    if (encounterGate?.active && !encounterGate.allowed) return;

    // Choose attack type before creating the clash card
    const attackType = await customDialog({
      title: `${actor.name} — Initiate Clash`,
      content: `<div class="warfare-clash-commit-dialog">
        <div class="form-group">
          <label>Attack Type</label>
          <select name="attackType">
            <option value="melee">Melee</option>
            <option value="ranged">Ranged</option>
          </select>
          <p class="notes">Ranged attacks waive Skirmisher Melee Penalties for the attacker.</p>
        </div>
      </div>`,
      buttons: {
        confirm: {
          label: "Initiate",
          callback: (html) => html.querySelector('[name="attackType"]')?.value ?? "melee",
        },
        cancel: { label: "Cancel" },
      },
      defaultButton: "confirm",
    });
    if (!attackType) return; // cancelled
    if (encounterGate?.active && attackType === "melee" && !areTokensInBaseContact(encounterGate?.attackerTokenDoc, encounterGate?.defenderTokenDoc)) {
      ui.notifications.warn("A melee clash requires the two warfare tokens to be in base contact on the scene.");
      return;
    }

    const manualContactSides = attackType === "ranged"
      ? {
          attackerContactSide: "front",
          defenderContactSide: "front",
        }
      : await promptClashContactSides({
          actorName: actor.name ?? "Attacker",
          targetName: targetActor.name ?? "Defender",
          attackerDefault: encounterGate?.attackerChargeSide ?? encounterGate?.attackerContactSide ?? "front",
          defenderDefault: encounterGate?.defenderChargeSide ?? encounterGate?.defenderContactSide ?? "front",
        });
    if (!manualContactSides) return;

    const commanderJoinFray = {
      unit1: hasWarfareActionEffect(actor, WARFARE_EFFECT_KEYS.JOIN_FRAY_NEXT_CLASH) && actor?.system?.commander?.uuid
        ? {
            actorUuid: String(actor.system.commander.uuid),
            name: String(actor.system.commander.name ?? ""),
          }
        : null,
      unit2: hasWarfareActionEffect(targetActor, WARFARE_EFFECT_KEYS.JOIN_FRAY_NEXT_CLASH) && targetActor?.system?.commander?.uuid
        ? {
            actorUuid: String(targetActor.system.commander.uuid),
            name: String(targetActor.system.commander.name ?? ""),
          }
        : null,
    };

    // Create the pending clash card — each side commits stance independently
    const attackerTokenDoc = encounterGate?.attackerTokenDoc ?? actor.token?.document ?? actor.getActiveTokens?.()[0]?.document ?? null;
    const defenderTokenDoc = encounterGate?.defenderTokenDoc ?? targets[0]?.document ?? null;
    const message = await createClashPending(actor, targetActor, {
      attackerTokenDoc,
      defenderTokenDoc,
      attackType,
      attackerCharged: Boolean(encounterGate?.attackerCharged),
      defenderCharged: Boolean(encounterGate?.defenderCharged),
      attackerIncomingChargeSide: encounterGate?.defenderCharged ? (encounterGate?.defenderChargeSide ?? "none") : "none",
      defenderIncomingChargeSide: encounterGate?.attackerCharged ? (encounterGate?.attackerChargeSide ?? "none") : "none",
      attackerContactSide: manualContactSides.attackerContactSide,
      defenderContactSide: manualContactSides.defenderContactSide,
      clashGroupId: encounterGate?.clashGroupId ?? "",
      groupMembers: encounterGate?.groupMembers ?? [],
      commanderJoinFray,
    });
    if (encounterGate?.active && encounterGate.allowed && message?.id) {
      await recordWarfareEncounterClash(actor, {
        attackerTokenUuid: encounterGate.attackerTokenUuid,
        defenderTokenUuid: encounterGate.defenderTokenUuid,
        attackType,
        clashGroupId: encounterGate?.clashGroupId ?? "",
        groupMembers: encounterGate?.groupMembers ?? [],
        attackerContactSide: manualContactSides.attackerContactSide,
        defenderContactSide: manualContactSides.defenderContactSide,
        commanderJoinFray,
        messageId: message.id,
      });
    }
  }

  async _onRollDiscipline(_event, _target) {
    await rollDisciplineForUnit(this.document);
  }

  async _onRollRangedAttack(_event, _target) {
    await rollWarfareRangedAttack(this.document);
  }

  async _onCastSpellDirect(_event, _target) {
    await castWarfareSpell(this.document);
  }

  // ── Active Effect management ──────────────────────────────────────────────

  async _onCreateEffect(_event, _target) {
    if (!this.isEditable) return;
    await requestCreateEmbeddedDocuments(this.document, "ActiveEffect", [{
      name: "New Effect",
      img: "icons/svg/aura.svg",
    }]);
  }

  async _onEditEffect(_event, target) {
    const id = target?.dataset?.effectId;
    if (!id) return;
    const effect = this.document.effects.get(id);
    if (effect) effect.sheet.render(true);
  }

  async _onDeleteEffect(_event, target) {
    if (!this.isEditable) return;
    const id = target?.dataset?.effectId;
    if (!id) return;
    const effect = this.document.effects.get(id);
    if (!effect) return;
    const confirmed = await confirmDialog({
      title: "Delete Effect",
      content: `<p>Delete <strong>${effect.name}</strong>?</p>`,
    });
    if (!confirmed) return;
    await requestDeleteEmbeddedDocuments(this.document, "ActiveEffect", [id]);
  }

  // ── Embedded item management (trait / talent / power) ─────────────────────

  _onItemOpen(_event, target) {
    const li = target?.closest?.(".item");
    const itemId = li?.dataset?.itemId;
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (item?.sheet) item.sheet.render(true);
  }

  async _onItemCreate(event, target) {
    return onItemCreate(this, event, {
      baseCha: null,
      includeCombatStyleSeed: false,
      includeMagicSkillSeed: false,
      target,
    });
  }

  async _onItemDelete(_event, target) {
    if (!this.isEditable) return;
    const li = target?.closest?.(".item");
    const itemId = li?.dataset?.itemId;
    if (!itemId) return;
    const item = this.document.items.get(itemId);
    if (!item) return;
    const confirmed = await confirmDialog({
      title: "Delete Item",
      content: `<p>Delete <strong>${item.name}</strong>?</p>`,
    });
    if (!confirmed) return;
    await requestDeleteEmbeddedDocuments(this.document, "Item", [itemId]);
  }

  async _onPostItemToChat(event, target) {
    event.preventDefault();
    event.stopPropagation();
    await postItemToChat(event, this.document, { includeImage: true, element: target });
  }
}
