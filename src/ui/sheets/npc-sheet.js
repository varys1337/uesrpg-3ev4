/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
import { getAttackModeFromWeapon, getDamageTypeFromWeapon, recordDashStart } from "../../core/combat/combat-utils.js";
import { hasCondition } from "../../core/conditions/condition-engine.js";
import { requireUserCanRollActor } from "../../utils/permissions.js";
import { doTestRoll, formatDegree } from "../../utils/degree-roll-helper.js";
import { applyKeenIntuitionToResult, applyHyperAwarenessToResult } from "../../core/traits/awareness-talents.js";
import { hasTalent } from "../../core/traits/talents-api.js";
import { hasOpponentWithTalentInMeleeRange } from "../../core/traits/combat-proximity.js";
import { computeSkillTN, SKILL_DIFFICULTIES } from "../../core/skills/skill-tn.js";
import { buildSkillRollRequest, normalizeSkillRollOptions } from "../../core/skills/roll-request.js";
import { SkillOpposedWorkflow } from "../../core/skills/opposed-workflow.js";
import { OpposedWorkflow } from "../../core/combat/opposed-workflow.js";
import { setLastMeleeWeaponForActor } from "../canvas/reach-visualizer-state.js";
import { postItemToChat } from "./shared-handlers.js";
import { registerHPButtonHandler } from "./actor-sheet-hp-integration.js";
import { registerStaminaButtonHandler } from "./actor-sheet-stamina-integration.js";
import { registerMagickaButtonHandler } from "./actor-sheet-magicka-integration.js";
import {
  buildCombatQuickContext,
  buildCollapsedActionCardHtml,
  getAimStateFromEffect,
  getEnabledEffectByKey,
  resolveTokenForActor,
  resolveRangeGatedTokenForActor,
  spendActionPoints
} from "./combat-actions-utils.js";
import { AimAudit } from "../../core/combat/aim-audit.js";
import { createOrUpdateStatusEffect } from "../../core/active-effects/status-effect.js";
import { buildEffectDuration } from "../../core/time/effect-duration.js";
import { getSpecialActionById } from "../../core/config/special-actions.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { AttackTracker } from "../../core/combat/attack-tracker.js";
import {
  getCollapsedGroups,
} from "./sheet-ui-state.js";
import { registerNpcSheetListeners } from "./npc/listeners/index.js";
import { buildCombatQuickContext as prepBuildCombatQuickContext, buildCombatActionsContext, applyDefensiveStanceDisabling, buildSheetUiState, enrichBiography } from "./npc/prepare.js";
import { createItemFilterOptions, filterItems, setDefaultItemFilter, createStatusTags } from "./npc/ui/filters.js";
import { bindCommonSheetListeners, bindCommonEditableInventoryListeners } from "./sheet-listeners.js";
import { shouldHideFromMainInventory } from "./sheet-inventory.js";
import { prepareCharacterItems } from "./sheet-prepare-items.js";
import { onToggle2H as sharedOnToggle2H, onPlusQty as sharedOnPlusQty, onMinusQty as sharedOnMinusQty, onItemEquip as sharedOnItemEquip } from "./shared/listeners/inventory-handlers.js";
import { onWealthCalc as sharedOnWealthCalc, onCarryBonus as sharedOnCarryBonus } from "./shared/listeners/economy-handlers.js";
import { onItemCreate as sharedOnItemCreate, onEquipItems as sharedOnEquipItems } from "./shared/dialogs/equipment-dialogs.js";
import { onToggleGroupCollapse as sharedOnToggleGroupCollapse, onItemSearch as sharedOnItemSearch, onLoadoutSave as sharedOnLoadoutSave, onLoadoutApply as sharedOnLoadoutApply, onLoadoutDelete as sharedOnLoadoutDelete } from "./shared/helpers/ui-state-handlers.js";
import { onDamageRoll as sharedOnDamageRoll, onResistanceRoll as sharedOnResistanceRoll, onSkillRoll as sharedOnSkillRoll, onCombatRoll as sharedOnCombatRoll } from "./shared/listeners/rolls.js";
import { onCastMagicAction as sharedOnCastMagicAction, castAttackSpell as sharedCastAttackSpell, showSpellOptionsDialog as sharedShowSpellOptionsDialog } from "./shared/listeners/magic-cast.js";
import { onCombatQuickAction as sharedOnCombatQuickAction } from "./shared/listeners/combat-actions.js";
import { onSetBaseCharacteristics as sharedOnSetBaseCharacteristics, onClickCharacteristic as sharedOnClickCharacteristic } from "./shared/listeners/characteristics-handlers.js";
import { getUserSpellTargets, shouldUseTargetedSpellWorkflow, shouldUseModernSpellWorkflow, debugMagicRoutingLog } from "../../core/magic/spell-runtime.js";
import { applyShortRest, applyLongRest, buildRestChatContent } from "./rest-workflow.js";
import { executeActivation, buildSpecialActionActivation } from "../../core/system/activation/activation-executor.js";
import { resolveCriticalFlags } from "../../core/rules/npc-rules.js";
import { buildResistanceBonusSection, readResistanceBonusSelections, buildResistanceBonusMods } from "../../core/traits/trait-resistance-ui.js";

export class npcSheet extends foundry.appv1.sheets.ActorSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["worldbuilding", "sheet", "actor", "NPC"],
      width: 780,
      height: 860,
      tabs: [
        {
          navSelector: ".sheet-tabs",
          contentSelector: ".sheet-body",
          initial: "description",
        },
      ],
      dragDrop: [
        {
          dragSelector: [
            ".armor-table .item",
            ".ammunition-table .item",
            ".weapon-table .item",
            ".spellList .item",
            ".skillList .item",
            ".factionContainer .item",
            ".languageContainer .item",
            ".talent-container .item",
            ".trait-container .item",
            ".power-container .item",
            ".equipmentList .item",
            ".containerList .item",
          ],
          dropSelector: null,
        },
      ],
    });
  }

  /* -------------------------------------------- */

  /** @override */
  async getData(options = {}) {
    const data = await super.getData(options);
    data.dtypes = ["String", "Number", "Boolean"];
    data.isGM = game.user.isGM;

    data.editable =
      this.isEditable ??
      this.options?.editable ??
      data.options?.editable ??
      false;

    // Prepare Items
    if (this.actor.type === "NPC") {
      this._prepareCharacterItems(data);
    }

    // Combat tab quick actions + equipped summary (template-friendly)
    data.actor.sheetCombatQuick = prepBuildCombatQuickContext(data.actor);

    // Combat tab: Active Combat Style selection + Special Actions registry
    data.actor.sheetCombatActions = buildCombatActionsContext(this.actor);
    data.actor.attackTrackerUi = {
      current: AttackTracker.getAttackCount(this.actor),
      max: AttackTracker.getAttackLimit(this.actor),
      overrides: AttackTracker.getOverrides(this.actor)
    };

    // Disable attack quick actions while Defensive Stance is active (RAW: Attack limit 0 until next Turn).
    applyDefensiveStanceDisabling(this.actor, data.actor.sheetCombatQuick);

    // Sheet UI toggles (no actor schema changes)
    data.sheetUi = await buildSheetUiState(this.actor);

    // Enrich biography using Foundry v13 namespaced TextEditor API (AppV1-safe)
    const bio =
      (data.actor && data.actor.system && typeof data.actor.system.bio === "string")
        ? data.actor.system.bio
        : "";
    data.actor.system.enrichedBio = await enrichBiography(bio, this);

    // Active Effects (for Effects tab templates)
    if (this.actor && this.actor.effects) {
      data.effects = this.actor.effects.contents.map(e => e.toObject());
    } else {
      data.effects = [];
    }

    // Feature Inspector (Chapter 4 provenance debug panel)
    try {
      const { buildFeatureInspectorContext } = await import("./shared/feature-inspector.js");
      data.featureInspector = buildFeatureInspectorContext(this.actor);
    } catch (_e) {
      data.featureInspector = null;
    }

    return data;
  }

  _prepareCharacterItems(sheetData) {
    return prepareCharacterItems(sheetData, { includeSkills: false, includeMagicSkills: false });
  }

  get template() {
    const path = "systems/uesrpg-3ev4/templates";
    return `${path}/${this.actor.type.toLowerCase()}-sheet.html`;
  }

  /* -------------------------------------------- */

  /** @override */
  async activateListeners(html) {
    super.activateListeners(html);

    // Resource button dialogs (HP, Stamina, Magicka)
    registerHPButtonHandler(this, html);
    registerStaminaButtonHandler(this, html);
    registerMagickaButtonHandler(this, html);

    // Rollable Buttons
    html.find(".characteristic-roll").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onClickCharacteristic.bind(this));
    if (typeof this._onProfessionsRoll === "function") {
      html.find(".professions-roll").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onProfessionsRoll.bind(this));
    }
    html.find(".damage-roll").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onDamageRoll.bind(this));
    html.find(".magic-roll").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onMagicSkillRoll.bind(this));
    html.find(".magic-roll").off("contextmenu.uesrpgNpc").on("contextmenu.uesrpgNpc", this._postSpellDescriptionToChat.bind(this));
    html.find(".resistance-roll").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onResistanceRoll.bind(this));
    html.find(".ammo-roll").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onAmmoRoll.bind(this));
    html.find(".defend-roll").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onDefendRoll.bind(this));
    html.find(".uesrpg-cast-magic").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onCastMagicAction.bind(this));
  
  // Item image click handler with debounce protection for talents/traits/powers
    html.find(".item-img").off("click.uesrpgNpc").on("click.uesrpgNpc", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    
    const li = $(event.currentTarget).closest(".item, tr, li");
    const itemId = li.data("itemId");
    const item = this.actor.items.get(itemId);
    
    if (!item) return;
    
    // For talent, trait, and power: send to chat ONCE (use shared handler)
    if (["talent", "trait", "power"].includes(item.type)) {
      // Debounce protection
      const sendKey = `_sending_${itemId}`;
      if (this[sendKey]) return;
      this[sendKey] = true;
      
      try {
        await postItemToChat(event, this.actor, { includeImage: this.actor.type === "Player Character" });
      } finally {
        setTimeout(() => delete this[sendKey], 500);
      }
      return;
    }
    
    // For other items, show the sheet
    if (item.sheet) item.sheet.render(true);
  });

  // Spell item click to open sheet (matching PC behavior)
    html.find('.spell-row .item-img, .spell-row .item-name').off('click.uesrpgNpc').on('click.uesrpgNpc', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const row = ev.currentTarget.closest('.spell-row');
    const itemId = row?.dataset?.itemId;
    if (!itemId) return;
    
    const item = this.actor.items.get(itemId);
    if (item) {
      item.sheet.render(true);
    }
  });

  // Update Item Attributes from Actor Sheet
    html.find(".toggle2H").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onToggle2H.bind(this));
    html.find(".plusQty").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onPlusQty.bind(this));
    html.find(".minusQty").off("contextmenu.uesrpgNpc").on("contextmenu.uesrpgNpc", this._onMinusQty.bind(this));
    html.find(".itemEquip").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onItemEquip.bind(this));
    html.find(".uesrpg-attack-input").off("change.uesrpgNpc").on("change.uesrpgNpc", this._onAttackTrackerInputChange.bind(this));

    html.find(".itemTabInfo .wealthCalc").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onWealthCalc.bind(this));
    html.find(".setBaseCharacteristics, .characteristics-config").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onSetBaseCharacteristics.bind(this));
    html.find(".characteristics-config").off("keydown.uesrpgNpc").on("keydown.uesrpgNpc", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      this._onSetBaseCharacteristics(ev);
    }
    });
    html.find(".carryBonus").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onCarryBonus.bind(this));
    html.find(".wealthCalc").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onWealthCalc.bind(this));
    html.find("#itemFilter").off("click.uesrpgNpc").on("click.uesrpgNpc", this._filterItems.bind(this));
    html.find(".equip-items").off("click.uesrpgNpc").on("click.uesrpgNpc", this._onEquipItems.bind(this));

    // Initialize UI filters and status tags
    createItemFilterOptions(this);
    setDefaultItemFilter(this);
    createStatusTags(this);

  // Common listener binding (PC + NPC)
    bindCommonSheetListeners(this, html);
    bindCommonEditableInventoryListeners(this, html);

    // Feature Inspector: copy debug JSON to clipboard
    html.find(".uesrpg-feature-inspector-copy").off("click.uesrpgNpc").on("click.uesrpgNpc", (ev) => {
      ev.preventDefault();
      const json = ev.currentTarget.dataset.json ?? "[]";
      navigator.clipboard.writeText(json).then(() => {
        ui.notifications?.info?.("Feature Inspector data copied to clipboard.");
      }).catch((err) => {
        console.warn("uesrpg | Failed to copy feature inspector data", err);
      });
    });
  
  // New modular listener registration (Phase 3-4 refactor)
  // This will gradually replace the above listeners as handlers are moved to modules
    registerNpcSheetListeners(this, html);
  }

  /**
   * Handle Combat tab quick-action buttons.
   * Delegates to shared combat-actions module.
   */
  async _onCombatQuickAction(event) {
    return sharedOnCombatQuickAction(this, event);
  }

  /**
   * Handle clicking spell dice icon on Magic tab.
   * Routes to new magic casting engine instead of legacy rolling.
   */
  async _onMagicSkillRoll(event) {
    event.preventDefault();
    
    const button = event.currentTarget;
    const li = button.closest(".item");
    const spell = li ? this.actor.items.get(li.dataset.itemId) : null;
    
    if (!spell) {
      ui.notifications.warn("Spell not found.");
      return;
    }
    
    // Route to new casting engine
    await this._onCastMagicAction(event, spell);
  }

  /**
   * Handle right-click on spell dice icon to post spell description to chat.
   */
  async _postSpellDescriptionToChat(event) {
    event.preventDefault();
    
    const button = event.currentTarget;
    const li = button.closest(".item");
    const spell = li ? this.actor.items.get(li.dataset.itemId) : null;
    
    if (!spell) {
      ui.notifications.warn("Spell not found.");
      return;
    }
    
    // Post spell description to chat (NPC format without image in header)
    const contentString = `<h2>${spell.name}</h2><p>
    <i><b>Spell (${spell.system.school} L${spell.system.level}, ${spell.system.cost} MP)</b></i><p>
      <i>${spell.system.description || "No description available."}</i>`;
    
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: contentString
    });
  }

  /**
   * Handle Cast Magic button click.
   * Delegates to shared magic-cast module.
   */
  async _onCastMagicAction(event, preselectedSpell = null) {
    return sharedOnCastMagicAction(this, event, preselectedSpell);
  }

  /**
   * Show spell options dialog for Restraint/Overload.
   * Delegates to shared magic-cast module.
   */
  async _showSpellOptionsDialog(spell) {
    return sharedShowSpellOptionsDialog(this.actor, spell);
  }

  /**
   * Cast an attack spell using the magic opposed workflow.
   * Delegates to shared magic-cast module.
   */
  async _castAttackSpell(spell, targets, spellOptions = {}, castActionType = "primary", { aoeTemplateUuid = null, aoeTemplateId = null } = {}) {
    return sharedCastAttackSpell(this, spell, targets, spellOptions, castActionType, { aoeTemplateUuid, aoeTemplateId });
  }

async _onSpellRoll(event) {
  let spellToCast;

  if (
    event.currentTarget.closest(".item") != null ||
    event.currentTarget.closest(".item") != undefined
  ) {
    spellToCast = this.actor.items.get(
      event.currentTarget.closest(".item").dataset.itemId
    );
  } else {
    const fav = this.actor?.system?.favorites?.[event.currentTarget.dataset.hotkey];
    spellToCast = this.actor.getEmbeddedDocument?.("Item", fav?.id);
  }

	  // Centralized routing for targeted spells invoked via legacy entry points (e.g. favorites/hotkeys).
	  const targets = getUserSpellTargets();
	  debugMagicRoutingLog({ source: "NpcSheet._onSpellRoll", actor: this.actor, spell: spellToCast, targets });
	  if (shouldUseTargetedSpellWorkflow(spellToCast, targets)) {
	    const spellOptions = await this._showSpellOptionsDialog(spellToCast);
	    if (spellOptions === null) return;
	    await this._castAttackSpell(spellToCast, targets, spellOptions, "primary");
	    return;
	  }
	  if (shouldUseModernSpellWorkflow(spellToCast)) {
	    const spellOptions = await this._showSpellOptionsDialog(spellToCast);
	    if (spellOptions === null) return;
	    const { MagicOpposedWorkflow } = await import("../../core/magic/opposed-workflow.js");
	    await MagicOpposedWorkflow.castUnopposed({
	      attackerActorUuid: this.actor.uuid,
	      attackerTokenUuid: this.token?.document?.uuid ?? this.token?.uuid ?? null,
	      spellUuid: spellToCast.uuid,
	      spellOptions,
	      castActionType: "primary"
	    });
	    return;
	  }
    // Legacy spell casting path removed - all spells now use modern pipeline via shouldUseModernSpellWorkflow()
}

  async _onResistanceRoll(event) {
    return sharedOnResistanceRoll(this, event);
  }

  async _onDamageRoll(event) {
    return sharedOnDamageRoll(this, event);
  }

  async _onClickCharacteristic(event) {
    return sharedOnClickCharacteristic(this, event);
  }

  async _onDefendRoll(event) {
    // Defend action - route through combat roll
    return sharedOnCombatRoll(this, event);
  }

  async _onProfessionsRoll(event) {
    // NPC professions are stored in system.professions, not as Items
    // We need a custom handler rather than routing through item-based skill roll
    event.preventDefault();

    if (!requireUserCanRollActor(game.user, this.actor)) {
      return;
    }

    // Try to get profession key from event
    const button = event.currentTarget;
    let profKey = null;
    
    if (button && typeof button.closest === "function") {
      const li = button.closest(".item");
      profKey = li?.dataset?.professionKey ?? li?.dataset?.itemId;
    }
    
    // Try button id or dataset
    if (!profKey && button) {
      profKey = button.id ?? button.dataset?.professionKey ?? button.dataset?.itemId;
    }
    
    // Fallback for synthetic events from modules
    if (!profKey) {
      profKey = event?.data?.professionKey ?? 
                event?.data?.itemId ?? 
                event?.currentTarget?.id ??
                null;
    }

    if (!profKey) {
      ui.notifications.warn("Profession not found.");
      return;
    }

    const profValue = Number(this.actor.system?.professions?.[profKey] ?? 0);
    
    // Get profession label
    let profLabel = profKey;
    if (profKey === "profession1" || profKey === "profession2" || profKey === "profession3") {
      const spec = String(this.actor.system?.skills?.[profKey]?.specialization ?? "").trim();
      profLabel = spec || profKey.replace("profession", "Profession ");
    } else {
      profLabel = profKey.charAt(0).toUpperCase() + profKey.slice(1);
    }

    // Create profession pseudo-UUID for opposed workflow
    const profUuid = `prof:${profKey}`;

    // --- TARGETED -> Opposed Workflow ---
    const targets = [...(game.user.targets ?? [])];
    if (targets.length > 0) {
      const attackerToken =
        canvas?.tokens?.controlled?.find(t => t.actor?.id === this.actor.id) ??
        this.actor.getActiveTokens?.()?.[0] ??
        null;

      if (!attackerToken) {
        ui.notifications.warn("No attacker token found on the canvas. Select your token and try again.");
        return;
      }

      const created = [];
      for (const defenderToken of targets) {
        const msg = await SkillOpposedWorkflow.createPending({
          attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
          defenderTokenUuid: defenderToken.document?.uuid ?? defenderToken.uuid,
          attackerActorUuid: this.actor.uuid,
          defenderActorUuid: defenderToken.actor?.uuid ?? null,
          attackerSkillUuid: profUuid,
          attackerSkillLabel: profLabel
        });
        if (msg) created.push(msg);

        // Quick shift auto-roll
        const quickShift = Boolean(event.shiftKey) && game.settings.get("uesrpg-3ev4", "skillRollQuickShift");
        if (msg && quickShift) {
          await SkillOpposedWorkflow.handleAction(msg, "attacker-roll", { event });
        }
      }

      return;
    }

    // --- UNTARGETED -> Simple Profession Roll ---
    const resistanceSection = buildResistanceBonusSection(this.actor);

    const difficultyOptions = SKILL_DIFFICULTIES.map(d => {
      const selected = d.key === "average" ? "selected" : "";
      const sign = d.mod >= 0 ? "+" : "";
      return `<option value="${d.key}" ${selected}>${d.label} (${sign}${d.mod})</option>`;
    }).join("\n");

    const dialogContent = `
      <form class="uesrpg-skill-roll">
        <div class="form-group">
          <label><b>Difficulty</b></label>
          <select name="difficultyKey" style="width:100%;">${difficultyOptions}</select>
        </div>
        <div class="form-group" style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <label style="margin:0;"><b>Manual Modifier</b></label>
          <input name="manualMod" type="number" value="0" style="width:120px;" />
        </div>
        ${resistanceSection.html}
      </form>`;

    let decl = null;
    try {
      decl = await Dialog.wait({
        title: `${profLabel} — Roll Options`,
        content: dialogContent,
        buttons: {
          ok: {
            label: "Roll",
            callback: (html) => {
              const root = html instanceof HTMLElement ? html : html?.[0];
              const difficultyKey = root?.querySelector('select[name="difficultyKey"]')?.value ?? "average";
              const rawManual = root?.querySelector('input[name="manualMod"]')?.value ?? "0";
              const manualMod = Number.parseInt(String(rawManual), 10) || 0;
              const selectedRes = readResistanceBonusSelections(root, resistanceSection.options);
              return { difficultyKey, manualMod, resistanceSelected: selectedRes };
            }
          },
          cancel: { label: "Cancel", callback: () => null }
        },
        default: "ok"
      }, { width: 420 });
    } catch (_e) {
      return;
    }

    if (!decl) return;

    const resMods = buildResistanceBonusMods(decl.resistanceSelected ?? []);
    const resBonus = resMods.reduce((sum, m) => sum + Number(m.value ?? 0), 0);
    const situationalMods = [...resMods];

    // Build a pseudo-skill item so computeSkillTN can apply the full modifier pipeline
    // (fatigue, encumbrance, wounds, armor penalties, AE modifiers, item bonuses).
    const profSkillItem = {
      name: profLabel,
      type: "profession",
      system: { value: profValue },
      _professionKey: profKey
    };
    const tn = computeSkillTN({
      actor: this.actor,
      skillItem: profSkillItem,
      difficultyKey: decl.difficultyKey,
      manualMod: decl.manualMod,
      situationalMods
    });

    // Build tags
    const tags = [];
    if (Number(this.actor.system?.woundPenalty ?? 0) !== 0) tags.push(`<span class="tag wound-tag">Wounded ${this.actor.system.woundPenalty}</span>`);
    if (this.actor.system.fatigue.penalty != 0) tags.push(`<span class="tag fatigue-tag">Fatigued ${this.actor.system.fatigue.penalty}</span>`);
    if (this.actor.system.carry_rating.penalty != 0) tags.push(`<span class="tag enc-tag">Encumbered ${this.actor.system.carry_rating.penalty}</span>`);

    const armorMods = (tn.breakdown ?? []).filter(b => String(b.label || "").startsWith("Armor:") && Number(b.value) !== 0);
    for (const m of armorMods) {
      const v = Number(m.value) || 0;
      tags.push(`<span class="tag armor-tag">${m.label} ${v}</span>`);
    }

    if (tn?.difficulty?.mod) tags.push(`<span class="tag">${tn.difficulty.label} ${tn.difficulty.mod >= 0 ? "+" : ""}${tn.difficulty.mod}</span>`);
    if (decl.manualMod) tags.push(`<span class="tag">Mod ${decl.manualMod >= 0 ? "+" : ""}${decl.manualMod}</span>`);
    if (resBonus) {
      const labels = resMods.map(m => m.label).join(", ");
      tags.push(`<span class="tag">Resistance Bonus ${resBonus >= 0 ? "+" : ""}${resBonus}${labels ? ` (${labels})` : ""}</span>`);
    }

    // Perform roll
    const result = await doTestRoll(this.actor, {
      target: tn.finalTN,
      allowLucky: true,
      allowUnlucky: true
    });

    // Apply awareness talents
    await applyKeenIntuitionToResult(this.actor, profLabel, result, { allowPrompt: true });
    await applyHyperAwarenessToResult(this.actor, profLabel, result, { allowPrompt: true });

    // Format result (match PC skill roll layout)
    const degreeLine = result.isSuccess
      ? `<b style="color:green;">SUCCESS — ${formatDegree(result)}</b>`
      : `<b style="color:rgb(168, 5, 5);">FAILURE — ${formatDegree(result)}</b>`;

    // Build breakdown HTML
    const breakdownRows = (tn.breakdown ?? []).map(b => {
      const v = Number(b.value ?? 0);
      const sign = v >= 0 ? "+" : "";
      return `<div style="display:flex; justify-content:space-between; gap:10px;"><span>${b.label}</span><span>${sign}${v}</span></div>`;
    }).join("");

    const declaredParts = [];
    if (tn?.difficulty?.label) declaredParts.push(`${tn.difficulty.label} (${tn.difficulty.mod >= 0 ? "+" : ""}${tn.difficulty.mod})`);
    if (decl.manualMod) declaredParts.push(`Mod ${decl.manualMod >= 0 ? "+" : ""}${decl.manualMod}`);

    const flavor = `
      <div>
        <h2 style="margin:0 0 6px 0;">${profLabel}</h2>
        <div><b>Target Number:</b> ${tn.finalTN}</div>
        ${declaredParts.length ? `<div style="margin-top:2px; font-size:12px; opacity:0.85;"><b>Options:</b> ${declaredParts.join("; ")}</div>` : ""}
        <div style="margin-top:4px;">${degreeLine}${result.isCriticalSuccess ? ' <span style="color:green;">(CRITICAL)</span>' : ''}${result.isCriticalFailure ? ' <span style="color:red;">(CRITICAL FAIL)</span>' : ''}</div>
        <details style="margin-top:6px;"><summary style="cursor:pointer; user-select:none;">TN breakdown</summary><div style="margin-top:4px; font-size:12px; opacity:0.9;">${breakdownRows}</div></details>
        <div class="tag-container" style="margin-top:6px;">${tags.join("")}</div>
      </div>`;

    const rollMode = game.settings.get("core", "rollMode");

    const skillTest = {
      actorUuid: this.actor.uuid,
      skillUuid: profUuid,
      skillName: profLabel,
      target: tn.finalTN,
      isSuccess: Boolean(result.isSuccess),
      degree: Number(result.degree ?? 0) || 0,
      textual: String(result.textual ?? "")
    };

    await result.roll.toMessage({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor,
      flags: {
        uesrpg: {
          skillTest,
          reroll: { used: false, source: null }
        },
        "uesrpg-3ev4": {
          skillTest
        }
      },
      rollMode
    });
  }

  async _onSetBaseCharacteristics(event) {
    return sharedOnSetBaseCharacteristics(this, event);
  }

  async _onAmmoRoll(event) {
    event.preventDefault();
    let button = $(event.currentTarget);
    const li = button.parents(".item");
    const item = this.actor.getEmbeddedDocument("Item", li.data("itemId"));

    const contentString = `<h2 style='font-size: large;'>${item.name}</h2><p>
      <b>Damage Bonus:</b> ${item.system.damage}<p>
      <b>Qualities</b> ${item.system.qualities}`;

    if (item.system.quantity > 0) {
      ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker(),
        content: contentString,
      });
    }

    const currentQty = Number(item.system?.quantity ?? 0);
    const newQty = Math.max(currentQty - 1, 0);
    if (newQty === 0 && currentQty > 0) ui.notifications.info("Out of Ammunition!");
    await requestUpdateDocument(item, { "system.quantity": newQty });
  }

  _onToggle2H(event) {
    return sharedOnToggle2H(this, event);
  }

  _onPlusQty(event) {
    return sharedOnPlusQty(this, event);
  }

  async _onMinusQty(event) {
    return sharedOnMinusQty(this, event);
  }

  async _onItemEquip(event) {
    return sharedOnItemEquip(this, event);
  }

  async _onItemCreate(event) {
    return sharedOnItemCreate(this, event, {
      baseCha: null,
      includeCombatStyleSeed: false,
      includeMagicSkillSeed: false,
    });
  }

  async _onTalentRoll(event) {
    await postItemToChat(event, this.actor, { includeImage: false });
  }

  async _onWealthCalc(event) {
    return sharedOnWealthCalc(this, event);
  }

  async _onCarryBonus(event) {
    return sharedOnCarryBonus(this, event);
  }

  async _onAttackTrackerInputChange(event) {
    event.preventDefault();
    if (!game.user?.isGM) {
      ui.notifications?.warn?.("Only the GM can adjust attack tracker values.");
      return;
    }
    const el = event.currentTarget;
    const kind = String(el?.dataset?.kind ?? "").trim().toLowerCase();
    const value = Number(el?.value ?? NaN);
    if (!Number.isFinite(value)) return;
    if (kind === "max") {
      await AttackTracker.setAttackLimitOverride(this.actor, value);
      return;
    }
    await AttackTracker.setCurrentAttacks(this.actor, value);
  }

  _setResourceBars() {
    const data = this.actor.system;

    if (data) {
      for (let bar of [...this.form.querySelectorAll(".currentBar")]) {
        let resource = data[bar.dataset.resource];

        if (resource.max !== 0) {
          let resourceElement = this.form.querySelector(`#${bar.id}`);
          let proportion = Number(
            (100 * (resource.value / resource.max)).toFixed(0)
          );

          // if greater than 100 or lower than 20, set values to fit bars correctly
          proportion < 100 ? (proportion = proportion) : (proportion = 100);
          proportion < 0 ? (proportion = 0) : (proportion = proportion);

          // Apply the proportion to the width of the resource bar
          resourceElement.style.width = `${proportion}%`;
        }
      }
    }
  }

 _onIncrementResource(event) {
  event.preventDefault();
  const actorSys = this.actor?.system || {};
  const resourceKey = event.currentTarget.dataset.resource;
  const action = event.currentTarget.dataset.action;
  const resource = actorSys?.[resourceKey] || { value: 0 };
  const dataPath = `system.${resourceKey}.value`;

  if (action === "increase") {
    this.actor.update({ [dataPath]: Number(resource.value ?? 0) + 1 });
  } else {
    this.actor.update({ [dataPath]: Number(resource.value ?? 0) - 1 });
  }
}

_onResetResource(event) {
  event.preventDefault();
  const actorSys = this.actor?.system || {};
  const resourceLabel = event.currentTarget.dataset.resource;
  const resource = actorSys?.[resourceLabel] || { value: 0, max: 0 };
  const dataPath = `system.${resourceLabel}.value`;
  this.actor.update({ [dataPath]: Number(resource.max ?? 0) });
}

  async _onShortRest(event) {
    event.preventDefault();
    if (!this.actor) return;
    if (!this.actor.isOwner && !game.user.isGM) {
      ui.notifications.warn("You do not have permission to rest this actor.");
      return;
    }

    const { line } = await applyShortRest(this.actor);
    const content = buildRestChatContent("Short Rest (1 hour)", [line]);

    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content
    });

    await this.render(false);
    ui.notifications.info("Short rest completed.");
  }

  async _onLongRest(event) {
    event.preventDefault();
    if (!this.actor) return;
    if (!this.actor.isOwner && !game.user.isGM) {
      ui.notifications.warn("You do not have permission to rest this actor.");
      return;
    }

    const { line } = await applyLongRest(this.actor);
    const content = buildRestChatContent("Long Rest (8 hours)", [line]);

    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content
    });

    await this.render(false);
    ui.notifications.info("Long rest completed.");
  }

  _createItemFilterOptions() {
    return createItemFilterOptions(this);
  }

  _filterItems(event) {
    return filterItems(this, event);
  }

  _setDefaultItemFilter() {
    return setDefaultItemFilter(this);
  }

  _incrementFatigue(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let action = element.dataset.action;
    const actorSys = this.actor?.system || {};
    let fatigueLevel = Number(actorSys?.fatigue?.level ?? 0);
    let fatigueBonus = Number(actorSys?.fatigue?.bonus ?? 0);

    if (action === "increase" && fatigueLevel < 5) {
      this.actor.update({ "system.fatigue.bonus": fatigueBonus + 1 });
    } else if (action === "decrease" && fatigueLevel > 0) {
      this.actor.update({ "system.fatigue.bonus": fatigueBonus - 1 });
    }
  }

  async _onEquipItems(event) {
    return sharedOnEquipItems(this, event);
  }

  /**
   * @override
   * Handle drops onto the NPC sheet.
   * Intercepts items being dragged from containers to properly unlink them.
   */
  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);

    // Handle Item drops - check if coming from a container
    if (data.type === "Item") {
      let item;
      try {
        item = await fromUuid(data.uuid);
      } catch (err) {
        // Fall back to default handler
        return super._onDrop(event);
      }

      if (item && item.actor?.id === this.actor.id) {
        // Item is being moved within the same actor
        const cs = item.system?.containerStats;
        if (cs?.contained && cs?.container_id) {
          // Item is currently in a container - unlink it
          const containerId = cs.container_id;
          const container = this.actor.items.get(containerId);

          // Update the item to clear containerStats
          await item.update({
            "system.containerStats.contained": false,
            "system.containerStats.container_id": "",
            "system.containerStats.container_name": ""
          });

          // Update the container's contained_items list
          if (container && Array.isArray(container.system?.contained_items)) {
            const nextContained = container.system.contained_items.filter(
              (ci) => ci?._id !== item.id
            );
            await container.update({ "system.contained_items": nextContained });
          }

          ui.notifications?.info(`${item.name} removed from ${cs.container_name || "container"}.`);
          
          // Force a fresh sheet render to show the unlinked item in main inventory
          // (prepareCharacterItems filters by containerStats.contained, so we need fresh data)
          this.render(false);
          return;
        }
      }
    }

    // Continue with default drop behavior for new items or sorting
    return super._onDrop(event);
  }

_createStatusTags() {
  return createStatusTags(this);
}

/* -------------------------------------------- */
/* Active Effects                                */
/* -------------------------------------------- */

/**
 * Handle Active Effect controls from the Effects tab.
 */
async _onEffectControl(event) {
  event.preventDefault();
  const el = event.currentTarget;
  if (!el || !el.dataset) return;

  const action = el.dataset.action;
  const effectId = el.dataset.effectId;
  if (!action) return;
  if (!this.actor || !this.actor.effects) return;

  if (action === "create") {
    const effectData = {
      name: "New Effect",
      img: "icons/svg/aura.svg",
      changes: [],
      disabled: false,
      transfer: false,
      duration: {}
    };
    const created = await this.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
    const eff = (created && created.length) ? created[0] : null;
    if (eff && eff.sheet) eff.sheet.render(true);
    return;
  }

  const effect = this.actor.effects.get(effectId);
  if (!effect) return;

  switch (action) {
    case "edit":
      if (effect.sheet) effect.sheet.render(true);
      break;
    case "delete":
      await effect.delete();
      break;
    case "toggle":
      await effect.update({ disabled: !effect.disabled });
      break;
    default:
      break;
  }
}
}
