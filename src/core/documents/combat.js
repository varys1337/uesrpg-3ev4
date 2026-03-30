/**
 * Handles system-specific combat functionality.
 * @extends {Combat}
 */
import { hasTalent } from "../traits/talents-api.js";
import { listTacticianInitiativeProvidersForActor } from "../traits/intellectual-talents.js";
import { createDebugLogger } from "../../utils/debug.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { resolveSurpriseState } from "../combat/surprise-state.js";
import { isPerfEnabled, monoMs, perfRecord } from "../../utils/perf-tracker.js";
import { prepareDynamicRoundInitiativeUpdate, resolveCombatantInitiative } from "../combat/dynamic-initiative.js";
import {
  compareInitiativeTuples,
  getCombatSensesInitiativeRating,
  getInitiativeTieBreakTuple,
} from "./combat/initiative-helpers.js";
import { getActionPointAutomationSetting, getCombatRollModeMessageOptions, isDynamicInitiativeEnabledSetting } from "./combat/settings.js";
import { emitDynamicInitiativeRoundSummary } from "./combat/initiative-ui.js";
import { refreshActionPointsForCombatActor, resetAllActionPointsForCombat } from "./combat/ap-automation.js";
import { registerCombatApHooks } from "./combat/hooks.js";

export { getInitiativeTieBreakTuple } from "./combat/initiative-helpers.js";

const _initiativeDebug = createDebugLogger("skillRollDebug", "[UESRPG][Initiative]");

export class SystemCombat extends Combat {
  /**
   * In-session initiative choice cache (per user, per combat).
   *
   * Goal: When using Combat Tracker "Roll All", avoid spamming a dialog per
   * combatant. We cache the user's choice for the current combat only.
   *
   * IMPORTANT:
   * - This is NOT persisted to documents (no flags).
   * - Cache scope is per browser session and per combat id.
   *
   * Key: `${userId}|${combatId}`
   * Value: { useCombatSenses: boolean }
   */
  static _initiativeChoiceCache = new Map();

  /**
   * Deduplication map for round-based AP restoration.
   * Prevents double-processing when both the nextRound() override and the
   * updateCombat hook fire for the same round advancement.
   * Key: combatId, Value: last round number for which AP was restored.
   */
  static _apLastProcessedRound = new Map();
  static _dynamicInitiativeExpectedFirstByBoundary = new Map();
  static _dynamicInitiativePendingSummaryByBoundary = new Map();

  static _resolveRollModeMessageOptions() {
    return getCombatRollModeMessageOptions();
  }

  static async _emitDynamicInitiativeRoundSummary(summary, { combatId = null, round = null } = {}) {
    return emitDynamicInitiativeRoundSummary(summary, { combatId, round });
  }

  static _initiativeCacheKey(combat, user) {
    const uid = user?.id ?? "";
    const cid = combat?.id ?? "";
    return `${uid}|${cid}`;
  }

  static _getInitiativeChoice(combat, user) {
    const key = SystemCombat._initiativeCacheKey(combat, user);
    return SystemCombat._initiativeChoiceCache.get(key) ?? null;
  }

  static _setInitiativeChoice(combat, user, choice) {
    const key = SystemCombat._initiativeCacheKey(combat, user);
    SystemCombat._initiativeChoiceCache.set(key, choice);
  }

  /**
   * Lazy-read action-point automation setting to avoid accessing game.settings
   * before the setting is registered during early initialization.
   */
  get apAutomationType() {
    return getActionPointAutomationSetting();
  }

  get dynamicInitiativeEnabled() {
    return isDynamicInitiativeEnabledSetting();
  }

  _actorHasCondition(actor, key) {
    if (!actor || !key) return false;
    const k = String(key).trim().toLowerCase();

    // Prefer the system condition API (ActiveEffect flags)
    const api = game?.uesrpg?.conditions;
    if (api?.hasCondition && typeof api.hasCondition === "function") {
      try {
        return !!api.hasCondition(actor, k);
      } catch (_e) {
        // Fall through to name-based detection.
      }
    }

    const effects = actor?.effects?.contents ?? [];
    return effects.some((e) => {
      const n = String(e?.name ?? "").trim().toLowerCase();
      return n === k || n.startsWith(`${k} `) || n.startsWith(`${k}(`);
    });
  }

  async _refreshActionPoints(actor) {
    await refreshActionPointsForCombatActor(actor);
    return;

    if (!actor) return;

    const maxRaw = Number(actor?.system?.action_points?.max ?? 0);
    const max = Number.isFinite(maxRaw) ? maxRaw : 0;

    // Chapter 5: Stunned -> do not regain AP at the start of rounds/turns.
    if (this._actorHasCondition(actor, "stunned")) {
      const currentAP = Number(actor?.system?.action_points?.value ?? -1);
      if (currentAP === 0) return; // Already suppressed — skip the write.
      await requestUpdateDocument(actor, {
        "system.action_points.value": 0
      }).catch(err => {
        console.warn("UESRPG | Failed to suppress AP refresh for stunned actor", actor?.name, err);
      });
      return;
    }

    // Chapter 5: Dazed -> gain 1 fewer AP at the beginning of each round (minimum 1).
    // We implement this by reducing action_points.max via ActiveEffects, then clamping
    // the refresh to at least 1 while Dazed is present.
    const min = this._actorHasCondition(actor, "dazed") ? 1 : 0;
    let next = Math.max(min, max);

    // Chapter 5: Wounds to the body cause the target to lose 1 AP, or start next refresh
    // with 1 fewer AP if already at 0. We implement the "next refresh" rule as a debt flag
    // that is consumed on the next AP refresh.
    const debtRaw = Number(actor.getFlag(FLAG_SCOPE, "wounds.apDebtNextRefresh") ?? 0);
    const debt = Number.isFinite(debtRaw) ? debtRaw : 0;
    const updateData = { "system.action_points.value": next };
    if (debt > 0) {
      next = Math.max(min, next - debt);
      updateData["system.action_points.value"] = next;
      // Clear debt once consumed.
      updateData[`flags.${FLAG_SCOPE}.wounds.-=apDebtNextRefresh`] = null;
    }

    // Skip the write entirely if AP is already at the target value and there is no debt
    // to clear. This avoids a document update for actors that started the round at max AP
    // with no conditions or debt — the common case in a healthy party.
    if (!debt) {
      const currentAP = Number(actor?.system?.action_points?.value ?? -1);
      if (currentAP === next) return;
    }

    await requestUpdateDocument(actor, updateData).catch(err => {
      console.warn("UESRPG | Failed to refresh action points for", actor?.name, err);
    });
  }

  async resetAllActionPoints() {
    await resetAllActionPointsForCombat(this);
    return;

    const _perf = isPerfEnabled();
    const _t0 = _perf ? monoMs() : 0;
    const BATCH_SIZE = 25;
    const turns = Array.from(this.turns ?? []);
    let _updatesAttempted = 0;
    for (let i = 0; i < turns.length; i += BATCH_SIZE) {
      const slice = turns.slice(i, i + BATCH_SIZE);
      _updatesAttempted += slice.filter(c => c?.actor).length;
      const promises = slice.map(combatant => this._refreshActionPoints(combatant?.actor));
      await Promise.allSettled(promises);
    }
    if (_perf) {
      perfRecord({
        event: "combat.resetAllAP",
        combatId: this.id,
        round: this.round,
        combatantsTotal: turns.length,
        documentUpdatesAttempted: _updatesAttempted,
        durationMs: monoMs() - _t0,
      });
    }
  }

  /** @override */
  async startCombat() {
    const _perf = isPerfEnabled();
    const _t0 = _perf ? monoMs() : 0;
    const _combatantsTotal = Array.from(this.turns ?? []).length;

    if (["round", "turn"].includes(this.apAutomationType)) {
      // Stamp round 1 so the updateCombat hook (which fires when super.startCombat()
      // broadcasts { started: true, round: 1 }) knows this round was already handled.
      SystemCombat._apLastProcessedRound.set(this.id, 1);
      await this.resetAllActionPoints();
    }

    const result = await super.startCombat();
    if (_perf) {
      perfRecord({
        event: "combat.startCombat",
        combatId: this.id,
        combatantsTotal: _combatantsTotal,
        apAutomationType: this.apAutomationType,
        durationMs: monoMs() - _t0,
      });
    }
    return result;
  }

  /** @override */
  async nextTurn() {
    if (this.apAutomationType === "turn") {
      if (this.round !== 1 || (this.turn + 1) === this.turns.length) {
        await this._refreshActionPoints(this.nextCombatant()?.actor);
      }
    }

    return await super.nextTurn();
  }

  /** @override */
  async nextRound() {
    const _perf = isPerfEnabled();
    const _t0 = _perf ? monoMs() : 0;
    const _combatantsTotal = Array.from(this.turns ?? []).length;
    const _nextRound = this.round + 1;

    if (this.apAutomationType === "round") {
      // Stamp the NEW round BEFORE restoring so the updateCombat hook (which fires
      // when super.nextRound() broadcasts the round increment) recognises this round
      // was already handled and skips the supplementary hook path.
      SystemCombat._apLastProcessedRound.set(this.id, this.round + 1);
      await this.resetAllActionPoints();
    }

    const result = await super.nextRound();
    if (_perf) {
      perfRecord({
        event: "combat.nextRound",
        combatId: this.id,
        round: _nextRound,
        combatantsTotal: _combatantsTotal,
        apAutomationType: this.apAutomationType,
        durationMs: monoMs() - _t0,
      });
    }
    return result;
  }

  /** @override */
  async _preUpdate(data, options, user) {
    await super._preUpdate(data, options, user);

    if (!game.user?.isGM) return;
    if (!this.dynamicInitiativeEnabled) return;
    if (!this.started) return;

    const nextRound = Number(data?.round ?? NaN);
    if (!Number.isFinite(nextRound)) return;
    if (nextRound <= Number(this.round ?? 0)) return;
    if (Array.isArray(data?.combatants) && data.combatants.length > 0) return;

    const _perf = isPerfEnabled();
    const _t0 = _perf ? monoMs() : 0;

    const prepared = await prepareDynamicRoundInitiativeUpdate(this, {
      interactive: false,
      suppressChat: true
    });

    data.combatants = prepared.combatantUpdates;
    data.turn = Number(prepared.startingTurn ?? 0);

    const boundaryKey = `${String(this.id)}:${nextRound}`;
    SystemCombat._dynamicInitiativeExpectedFirstByBoundary.set(boundaryKey, String(prepared.projectedFirstCombatantId ?? ""));
    SystemCombat._dynamicInitiativePendingSummaryByBoundary.set(boundaryKey, prepared.summary);

    if (_perf) {
      perfRecord({
        event: "dynamicInitiative.prepare",
        combatId: this.id,
        round: nextRound,
        enabled: true,
        combatantCount: prepared.combatantUpdates.length,
        projectedFirstCombatantId: prepared.projectedFirstCombatantId ?? null,
        durationMs: monoMs() - _t0,
      });
    }
  }

  /** @override */
  _onDelete(options, userId) {
    // Clean up session-scoped initiative choice cache for this combat.
    for (const key of SystemCombat._initiativeChoiceCache.keys()) {
      if (key.endsWith(`|${this.id}`)) {
        SystemCombat._initiativeChoiceCache.delete(key);
      }
    }
    // Clean up AP dedup map for this combat.
    SystemCombat._apLastProcessedRound.delete(this.id);
    for (const key of SystemCombat._dynamicInitiativeExpectedFirstByBoundary.keys()) {
      if (key.startsWith(`${this.id}:`)) SystemCombat._dynamicInitiativeExpectedFirstByBoundary.delete(key);
    }
    for (const key of SystemCombat._dynamicInitiativePendingSummaryByBoundary.keys()) {
      if (key.startsWith(`${this.id}:`)) SystemCombat._dynamicInitiativePendingSummaryByBoundary.delete(key);
    }
    super._onDelete(options, userId);
  }

  /**
   * Registers global Foundry hooks for AP automation.
   * Must be called once during system init (after SystemCombat is set as CONFIG.Combat.documentClass).
   *
   * Handles two supplementary cases:
   *  - Round-based AP restore triggered by any path that changes combat.round
   *    (macros, modules, socket events) — not only the nextRound() method override.
   *  - Cleanup of the dedup map when a combat document is deleted.
   */
  static registerAPHooks() {
    registerCombatApHooks(SystemCombat);
    return;

    Hooks.on("updateCombat", (combat, changed, _options, _userId) => {
      if (!game.user?.isGM) return;
      if (!("round" in changed)) return;

      let apType;
      try { apType = game.settings.get("uesrpg-3ev4", "actionPointAutomation"); }
      catch (_e) { return; }
      if (apType !== "round") return;

      const newRound = Number(combat.round ?? 0);
      const lastRound = SystemCombat._apLastProcessedRound.get(combat.id) ?? -1;
      // Already handled by nextRound() override or an earlier hook call for this round.
      if (newRound <= lastRound) return;

      SystemCombat._apLastProcessedRound.set(combat.id, newRound);
      combat.resetAllActionPoints?.().catch(err =>
        console.warn("UESRPG | AP round-restore hook failed", err)
      );
    });

    Hooks.on("deleteCombat", (combat) => {
      SystemCombat._apLastProcessedRound.delete(String(combat.id ?? ""));
    });

    // Keep direct ingress for now: this observes committed dynamic-initiative results and
    // emits validation/perf summaries rather than acting as a subsystem boundary consumer.
    Hooks.on("uesrpg.combatTimeChanged", (payload) => {
      if (!game.user?.isGM) return;
      if (payload?.source !== "combat") return;
      if (payload?.combat?.phase && payload.combat.phase !== "post") return;

      const combat = game?.combat ?? null;
      if (!combat?.id) return;
      if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;

      const round = Number(payload?.combat?.round ?? combat.round ?? 0);
      const boundaryKey = `${String(combat.id)}:${round}`;
      const expectedFirstCombatantId = String(SystemCombat._dynamicInitiativeExpectedFirstByBoundary.get(boundaryKey) ?? "");
      if (!expectedFirstCombatantId) return;
      const pendingSummary = SystemCombat._dynamicInitiativePendingSummaryByBoundary.get(boundaryKey) ?? null;

      const committedCombatantId = String(combat.combatant?.id ?? combat.combatantId ?? "");
      const match = committedCombatantId === expectedFirstCombatantId;

      if (isPerfEnabled()) {
        perfRecord({
          event: "dynamicInitiative.commitObserved",
          combatId: combat.id,
          round,
          enabled: (() => {
            try { return Boolean(game.settings.get("uesrpg-3ev4", "dynamicInitiativeEnabled")); }
            catch (_e) { return false; }
          })(),
          expectedFirstCombatantId,
          committedFirstCombatantId: committedCombatantId || null,
          match,
        });
      }

      if (pendingSummary) {
        SystemCombat._emitDynamicInitiativeRoundSummary(pendingSummary, {
          combatId: combat.id,
          round,
        }).catch((err) => console.warn("UESRPG | Dynamic initiative summary chat failed", err));
      }

      SystemCombat._dynamicInitiativeExpectedFirstByBoundary.delete(boundaryKey);
      SystemCombat._dynamicInitiativePendingSummaryByBoundary.delete(boundaryKey);
    });
  }

  nextCombatant() {
    const nextTurnIndex = (this.turn + 1) % this.turns.length;
    return this.turns[nextTurnIndex];
  }

  /**
   * Chapter 5 initiative tie-break order:
   *  1) Initiative total
   *  2) Initiative Rating
   *  3) Luck bonus
   *  4) PC precedence over NPC
   *  5) Stable combatant id
   *
   * @override
   */
  _sortCombatants(a, b) {
    const ta = getInitiativeTieBreakTuple(a);
    const tb = getInitiativeTieBreakTuple(b);
    return compareInitiativeTuples(ta, tb);
  }

  /**
   * Talent-aware initiative rolling.
   *
   * Supported combat talents (Chapter 4):
   *  - Combat Senses: may choose an alternate Initiative Rating formula.
   *  - Lightning Reflexes: roll initiative twice and take the higher result.
   *
   * IMPORTANT:
   *  - We keep this implementation self-contained and conservative.
   *  - Combat Senses selection is an assisted player choice.
   *  - When rolling multiple combatants at once ("Roll All"), we prompt at most once per user per combat
   *    and cache the selection for the browser session.
   *
   * @override
   */
  async rollInitiative(ids, { formula = null, updateTurn = true, messageOptions = {} } = {}) {
    const idList = Array.isArray(ids) ? ids : [ids];
    const currentId = this.combatant?.id ?? null;

    // If a specific formula was provided by the caller, defer to core behavior.
    // This avoids unexpected interactions with external modules/macros.
    if (formula) {
      return super.rollInitiative(idList, { formula, updateTurn, messageOptions });
    }

    const updates = [];
    const rolls = [];

    // Important: The system expects initiative to derive from actor.system.initiative.value
    // so Active Effects can influence initiative deterministically.

    // Combat Senses: for multi-combatant rolls, prompt once (per user session) and apply to eligible combatants.
    let batchCombatSensesChoice = null;

    // "Roll All" in the combat tracker is usually GM-driven, but players can also roll
    // initiative for multiple owned combatants. The prompt should be per-user.
    const anyOwnedInBatch = idList.some((id) => {
      const c = this.combatants?.get(id);
      return !!(c?.actor && (game.user?.isGM === true || c.actor.isOwner));
    });
    const canBatchPrompt = idList.length > 1 && anyOwnedInBatch;
    if (canBatchPrompt) {
      const cached = SystemCombat._getInitiativeChoice(this, game.user);
      if (cached && typeof cached.useCombatSenses === "boolean") {
        batchCombatSensesChoice = cached;
      } else {
        // Only prompt if at least one combatant has Combat Senses.
        const hasAnyCombatSenses = idList.some((id) => {
          const c = this.combatants?.get(id);
          const a = c?.actor;
          return !!(c && a && hasTalent(a, "combatsenses"));
        });
        if (hasAnyCombatSenses) {
          const useCombatSenses = await this._promptCombatSensesBatchChoice();
          batchCombatSensesChoice = { useCombatSenses };
          SystemCombat._setInitiativeChoice(this, game.user, batchCombatSensesChoice);
        }
      }
    }

	    const isTactician = (id) => {
	      const c = this.combatants?.get(id);
	      const a = c?.actor;
	      return !!(c && a && hasTalent(a, "tactician"));
	    };
	
	    const orderedIds = idList.slice().sort((a, b) => {
	      const aT = isTactician(a) ? 0 : 1;
	      const bT = isTactician(b) ? 0 : 1;
	      if (aT !== bT) return aT - bT;
	      const aName = String(this.combatants?.get(a)?.actor?.name ?? "");
	      const bName = String(this.combatants?.get(b)?.actor?.name ?? "");
	      if (aName !== bName) return aName.localeCompare(bName);
	      return String(a).localeCompare(String(b));
	    });
	
	    const tacticianIds = orderedIds.filter((id) => isTactician(id));
	    const otherIds = orderedIds.filter((id) => !isTactician(id));
	
	    const earlyUpdates = [];
	
	    const rollOne = async (id, { updateBucket, allowTacticianChoice } = {}) => {
	      const combatant = this.combatants?.get(id) ?? null;
	      const actor = combatant?.actor ?? null;
	      if (!combatant || !actor) return;
	
	      // Tactician (Chapter 4): allies may use a tactician's initiative result in place of their own.
	      let tacticianChoice = null;
	      if (allowTacticianChoice) {
	        const providers = listTacticianInitiativeProvidersForActor(actor, this);
	        const canPrompt = providers.length > 0 && (game.user?.isGM === true || actor.isOwner);
	        if (canPrompt) {
	          tacticianChoice = await this._promptTacticianInitiativeChoice(actor, providers);
	        }
	      }
	
	      let useCombatSenses = false;
	      const surpriseState = resolveSurpriseState(actor, { combatContext: this });
	      const isSurprised = surpriseState?.onlyReactions === true;
	      const canPromptSingle = idList.length === 1 && (game.user?.isGM === true || actor.isOwner);
	      if (!isSurprised && !tacticianChoice && canPromptSingle && hasTalent(actor, "combatsenses")) {
	        useCombatSenses = await this._promptCombatSensesChoice(actor);
	      } else if (!isSurprised && !tacticianChoice && batchCombatSensesChoice?.useCombatSenses === true && hasTalent(actor, "combatsenses")) {
	        useCombatSenses = true;
	      }

	      const normalIR = Number(actor?.system?.initiative?.value ?? 0) || 0;
	      const combatSensesIR = this._combatSensesInitiativeRating(actor);
	      const resolved = await resolveCombatantInitiative(this, combatant, {
	        useCombatSenses,
	        tacticianChoice,
	        deterministicTactician: false
	      });
	      const initiativeFormula = resolved.formula;
	      const finalRoll = resolved.roll;
	
	      _initiativeDebug("initiative roll", {
	        actor: actor?.name,
	        combatantId: combatant?.id,
	        choice: tacticianChoice?.mode === "provider" ? "tactician" : (useCombatSenses ? "combatSenses" : "normal"),
	        source: tacticianChoice?.mode === "provider"
	          ? `Tactician (${tacticianChoice.tacticianName ?? "Ally"})`
	          : (isSurprised
	            ? "Surprised (initiative rating only)"
	            : (useCombatSenses ? "Combat Senses (2\u00D7PrcBonus + 2)" : "Normal (initiative.value)")),
	        prcBonus: Number(actor?.system?.characteristics?.prc?.bonus ?? 0) || 0,
	        normalIR,
	        combatSensesIR,
	        isSurprised,
	        formula: initiativeFormula,
	        rollTotal: resolved.initiative
	      });
	
	      // Update initiative.
	      updateBucket.push({ _id: combatant.id, initiative: Number(resolved.initiative) });
	      rolls.push(finalRoll);
	
	      // Chat message.
	      try {
	        const tokenDoc = (combatant?.token && typeof combatant.token === "object" && combatant.token.documentName === "Token")
	          ? combatant.token
	          : null;
	        const speaker = ChatMessage.getSpeaker({ actor, token: tokenDoc });
	        const flavorParts = ["Initiative"];
	        if (tacticianChoice?.mode === "provider") flavorParts.push(`(Tactician: ${tacticianChoice.tacticianName})`);
	        if (useCombatSenses) flavorParts.push("(Combat Senses)");
	        if (!tacticianChoice?.mode && hasTalent(actor, "lightningreflexes")) flavorParts.push("(Lightning Reflexes)");
	        await finalRoll.toMessage({
	          speaker,
	          flavor: `${actor.name} \u2014 ${flavorParts.join(" ")}`,
	          rollMode: game.settings.get("core", "rollMode"),
	          ...messageOptions
	        });
	      } catch (err) {
	        console.warn("UESRPG | initiative roll message failed", err);
	      }
	    };
	
	    // Roll tacticians first so their initiatives exist for ally selection.
	    for (const id of tacticianIds) {
	      await rollOne(id, { updateBucket: earlyUpdates, allowTacticianChoice: true });
	    }
	
	    if (earlyUpdates.length) {
	      try {
	        await this.updateEmbeddedDocuments("Combatant", earlyUpdates);
	      } catch (err) {
	        console.error("UESRPG | initiative update failed", {
	          combatId: this.id,
	          phase: "early",
	          updates: earlyUpdates,
	          err
	        });
	        ui.notifications?.error?.("Failed to apply initiative updates.");
	        return rolls;
	      }
	    }
	
	    for (const id of otherIds) {
	      await rollOne(id, { updateBucket: updates, allowTacticianChoice: true });
	    }
	
	    if (updates.length) {
	      try {
	        await this.updateEmbeddedDocuments("Combatant", updates);
	      } catch (err) {
	        console.error("UESRPG | initiative update failed", {
	          combatId: this.id,
	          phase: "main",
	          updates,
	          err
	        });
	        ui.notifications?.error?.("Failed to apply initiative updates.");
	        return rolls;
	      }
	    }

    // Preserve the currently active combatant turn index where possible.
    if (updateTurn && currentId) {
      const idx = this.turns?.findIndex(c => c?.id === currentId) ?? -1;
      if (idx >= 0 && idx !== this.turn) {
        try {
          await requestUpdateDocument(this, { turn: idx });
        } catch (_e) {
          // Non-critical.
        }
      }
    }

    return rolls;
  }

  _combatSensesInitiativeRating(actor) {
    return getCombatSensesInitiativeRating(actor);
  }

  async _promptCombatSensesChoice(actor) {
    const title = "Combat Senses";
    const content = `
        <p><b>${actor?.name ?? "Actor"}</b> can calculate Initiative Rating using an alternate formula.</p>
        <p>Choose which Initiative Rating to use for this roll.</p>
      `;
    const result = await customDialog({
      title,
      content,
      buttons: {
        normal: {
          label: "Use Normal Initiative",
          callback: () => {
            _initiativeDebug("combat senses choice", { actor: actor?.name, choice: "normal" });
            return false;
          }
        },
        senses: {
          label: "Use Combat Senses",
          callback: () => {
            _initiativeDebug("combat senses choice", { actor: actor?.name, choice: "combatSenses" });
            return true;
          }
        }
      },
      defaultButton: "normal",
    });
    return result === true;
  }

  /**
   * Batch Combat Senses choice used by Combat Tracker "Roll All".
   *
   * This prompt is shown at most once per user per combat (session-cached).
   * The selected option is applied only to combatants who actually have the
   * Combat Senses talent.
   */
	  async _promptCombatSensesBatchChoice() {
	    const title = "Combat Senses";
	    const content = `
        <p>One or more combatants have <b>Combat Senses</b>.</p>
        <p>Choose which Initiative Rating to use for this <b>Roll All</b> operation.</p>
        <p><i>This choice is remembered for this combat for the current browser session.</i></p>
      `;
      const result = await customDialog({
        title,
        content,
        buttons: {
          normal: {
            label: "Use Normal Initiative",
            callback: () => {
              _initiativeDebug("combat senses batch choice", { choice: "normal" });
              return false;
            }
          },
          senses: {
            label: "Use Combat Senses",
            callback: () => {
              _initiativeDebug("combat senses batch choice", { choice: "combatSenses" });
              return true;
            }
          }
        },
        defaultButton: "normal",
      });
      return result === true;
	  }

	  /**
	   * Tactician (Chapter 4): allies may use a tactician's initiative result in place of their own.
	   *
	   * @param {Actor} actor
	   * @param {Array<{tactician: Actor, initiative: number, group: Actor}>} providers
	   * @returns {Promise<{mode:"provider", initiative:number, tacticianName:string}|null>}
	   */
	  async _promptTacticianInitiativeChoice(actor, providers = []) {
	    const a = actor;
	    const list = Array.isArray(providers) ? providers : [];
	    if (!a || !list.length) return null;

	    const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
	    const options = list.map((p, idx) => {
	      const name = esc(p?.tactician?.name ?? "Tactician");
	      const ini = Number(p?.initiative ?? 0) || 0;
	      return `<option value="${idx}">${name} (Initiative ${ini})</option>`;
	    }).join("\n");

	    const content = `
	      <div class="uesrpg-tactician-initiative-choice">
	        <p><b>${esc(a.name ?? "Actor")}</b> may use an ally tactician's initiative result in place of their own.</p>
	        <div class="form-group" style="margin-top:8px;">
	          <label><b>Tactician</b></label>
	          <select name="provider" style="width:100%;">${options}</select>
	        </div>
	      </div>
	    `;

	    return await customDialog({
	      title: "Tactician",
	      content,
	      buttons: {
	        normal: { label: "Roll Normally", callback: () => null },
	        use: {
	          label: "Use Tactician",
	          callback: (html) => {
	            const root = html instanceof HTMLElement ? html : html?.[0];
	            const raw = root?.querySelector('select[name="provider"]')?.value ?? "0";
	            const idx = Number.parseInt(String(raw), 10) || 0;
	            const chosen = list[Math.clamp(idx, 0, list.length - 1)] ?? null;
	            if (!chosen) return null;
	            return {
	              mode: "provider",
	              initiative: Number(chosen.initiative ?? 0) || 0,
	              tacticianName: String(chosen?.tactician?.name ?? "Tactician")
	            };
	          }
	        }
	      },
	      defaultButton: "normal",
	    });
	  }
	}
