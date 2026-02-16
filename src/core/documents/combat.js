/**
 * Handles system-specific combat functionality.
 * @extends {Combat}
 */
import { hasTalent } from "../traits/talents-api.js";
import { listTacticianInitiativeProvidersForActor } from "../traits/intellectual-talents.js";
import { isDebugEnabled } from "../../utils/debug.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { requestUpdateDocument, requestUpdateEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { resolveSurpriseState } from "../combat/surprise-state.js";

function _initiativeDebug(...args) {
  try {
    if (isDebugEnabled("skillRollDebug")) {
      // eslint-disable-next-line no-console
      console.log("[UESRPG][Initiative]", ...args);
    }
  } catch (_e) {
    // Ignore debug errors.
  }
}

function _numericOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _luckBonus(actor) {
  if (!actor) return 0;
  const rawBonus = actor?.system?.characteristics?.lck?.bonus;
  const fromBonus = Number(rawBonus);
  if (rawBonus !== undefined && rawBonus !== null && Number.isFinite(fromBonus)) return fromBonus;

  // Chapter 5 default: NPC luck bonus is 0 when not explicitly present.
  if (String(actor?.type ?? "").toLowerCase() === "npc") return 0;

  return Math.floor(_numericOr(actor?.system?.characteristics?.lck?.total, 0) / 10);
}

function _pcPrecedence(actor) {
  return String(actor?.type ?? "") === "Player Character" ? 1 : 0;
}

export function getInitiativeTieBreakTuple(combatant) {
  const actor = combatant?.actor ?? null;
  const initiativeTotal = _numericOr(combatant?.initiative, Number.NEGATIVE_INFINITY);
  const initiativeRating = _numericOr(actor?.system?.initiative?.value, 0);
  const luckBonus = _luckBonus(actor);
  const pcPrecedence = _pcPrecedence(actor);
  const stableId = String(combatant?.id ?? combatant?._id ?? "");

  return [initiativeTotal, initiativeRating, luckBonus, pcPrecedence, stableId];
}

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
    try {
      return game.settings.get("uesrpg-3ev4", "actionPointAutomation");
    } catch (_e) {
      return "off";
    }
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
    if (!actor) return;

    const maxRaw = Number(actor?.system?.action_points?.max ?? 0);
    const max = Number.isFinite(maxRaw) ? maxRaw : 0;

    // Chapter 5: Stunned -> do not regain AP at the start of rounds/turns.
    if (this._actorHasCondition(actor, "stunned")) {
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
    const debtRaw = Number(actor.getFlag("uesrpg-3ev4", "wounds.apDebtNextRefresh") ?? 0);
    const debt = Number.isFinite(debtRaw) ? debtRaw : 0;
    const updateData = { "system.action_points.value": next };
    if (debt > 0) {
      next = Math.max(min, next - debt);
      updateData["system.action_points.value"] = next;
      // Clear debt once consumed.
      updateData["flags.uesrpg-3ev4.wounds.-=apDebtNextRefresh"] = null;
    }

    await requestUpdateDocument(actor, updateData).catch(err => {
      console.warn("UESRPG | Failed to refresh action points for", actor?.name, err);
    });
  }

  async resetAllActionPoints() {
    const promises = [];
    for (const combatant of this.turns) {
      promises.push(this._refreshActionPoints(combatant?.actor));
    }
    await Promise.all(promises);
  }

  /** @override */
  async startCombat() {
    if (["round", "turn"].includes(this.apAutomationType)) {
      await this.resetAllActionPoints();
    }

    return await super.startCombat();
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
    if (this.apAutomationType === "round") {
      await this.resetAllActionPoints();
    }

    return await super.nextRound();
  }

  /** @override */
  _onDelete(options, userId) {
    // Clean up session-scoped initiative choice cache for this combat.
    for (const key of SystemCombat._initiativeChoiceCache.keys()) {
      if (key.endsWith(`|${this.id}`)) {
        SystemCombat._initiativeChoiceCache.delete(key);
      }
    }
    super._onDelete(options, userId);
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

    if (ta[0] !== tb[0]) return tb[0] - ta[0];
    if (ta[1] !== tb[1]) return tb[1] - ta[1];
    if (ta[2] !== tb[2]) return tb[2] - ta[2];
    if (ta[3] !== tb[3]) return tb[3] - ta[3];
    return String(ta[4]).localeCompare(String(tb[4]), undefined, { numeric: true, sensitivity: "base" });
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
	      const ir = useCombatSenses ? combatSensesIR : normalIR;

	      // Lightning Reflexes: roll initiative twice and take the higher.
	      // Combat Senses: use the custom Initiative Rating only (no die).
	      const dice = hasTalent(actor, "lightningreflexes") ? "2d6kh" : "1d6";
	      const initiativeFormula = tacticianChoice?.mode === "provider"
	        ? `${Number(tacticianChoice.initiative)}`
	        : (isSurprised ? `${normalIR}` : (useCombatSenses ? `${ir}` : `${dice} + ${ir}`));
	
	      const finalRoll = combatant.getInitiativeRoll(initiativeFormula);
	      await finalRoll.evaluate();
	
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
	        rollTotal: finalRoll?.total
	      });
	
	      // Update initiative.
	      updateBucket.push({ _id: combatant.id, initiative: Number(finalRoll.total) });
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
	      await requestUpdateEmbeddedDocuments(this, "Combatant", earlyUpdates);
	    }
	
	    for (const id of otherIds) {
	      await rollOne(id, { updateBucket: updates, allowTacticianChoice: true });
	    }
	
	    if (updates.length) {
	      await requestUpdateEmbeddedDocuments(this, "Combatant", updates);
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
    // Chapter 4: Combat Senses formula (as specified in the rules text):
    // IR = (2x Perception Bonus) + 2
    const prcBonus = Number(actor?.system?.characteristics?.prc?.bonus ?? 0) || 0;
    return (2 * prcBonus) + 2;
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
