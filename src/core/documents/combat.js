/**
 * Handles system-specific combat functionality.
 * @extends {Combat}
 */
import { hasTalent } from "../traits/talents-api.js";

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

  constructor(...args) {
    super(...args);
    this.apAutomationType = game.settings.get("uesrpg-3ev4", "actionPointAutomation");
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

  _refreshActionPoints(actor) {
    if (!actor) return;

    const maxRaw = Number(actor?.system?.action_points?.max ?? 0);
    const max = Number.isFinite(maxRaw) ? maxRaw : 0;

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
    if (debt > 0) {
      next = Math.max(min, next - debt);
      // Clear debt once consumed.
      actor.unsetFlag("uesrpg-3ev4", "wounds.apDebtNextRefresh").catch(() => {});
    }

    actor.update({ "system.action_points.value": next });
  }

  resetAllActionPoints() {
    this.turns.forEach((combatant) => {
      this._refreshActionPoints(combatant?.actor);
    });
  }

  /** @override */
  startCombat() {
    if (["round", "turn"].includes(this.apAutomationType)) {
      this.resetAllActionPoints();
    }

    super.startCombat();
  }

  /** @override */
  nextTurn() {
    if (this.apAutomationType === "turn") {
      if (this.round !== 1 || (this.turn + 1) === this.turns.length) {
        this._refreshActionPoints(this.nextCombatant()?.actor);
      }
    }

    super.nextTurn();
  }

  /** @override */
  nextRound() {
    if (this.apAutomationType === "round") {
      this.resetAllActionPoints();
    }

    super.nextRound();
  }

  nextCombatant() {
    const nextTurnIndex = (this.turn + 1) % this.turns.length;
    return this.turns[nextTurnIndex];
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

    for (const id of idList) {
      const combatant = this.combatants?.get(id) ?? null;
      const actor = combatant?.actor ?? null;
      if (!combatant || !actor) continue;

      let useCombatSenses = false;
      const canPromptSingle = idList.length === 1 && (game.user?.isGM === true || actor.isOwner);
      if (canPromptSingle && hasTalent(actor, "combatsenses")) {
        useCombatSenses = await this._promptCombatSensesChoice(actor);
      } else if (batchCombatSensesChoice?.useCombatSenses === true && hasTalent(actor, "combatsenses")) {
        useCombatSenses = true;
      }

      const ir = useCombatSenses
        ? this._combatSensesInitiativeRating(actor)
        : (Number(actor?.system?.initiative?.value ?? 0) || 0);

      // Lightning Reflexes: roll initiative twice and take the higher.
      // Implementation: 2d6kh + IR (equivalent distribution and no dialog spam).
      const dice = hasTalent(actor, "lightningreflexes") ? "2d6kh" : "1d6";
      const initiativeFormula = `${dice} + ${ir}`;

      const finalRoll = combatant.getInitiativeRoll(initiativeFormula);
      await finalRoll.evaluate();

      // Update initiative.
      updates.push({ _id: combatant.id, initiative: Number(finalRoll.total) });
      rolls.push(finalRoll);

      // Chat message.
      try {
        const tokenDoc = (combatant?.token && typeof combatant.token === "object" && combatant.token.documentName === "Token")
          ? combatant.token
          : null;
        const speaker = ChatMessage.getSpeaker({ actor, token: tokenDoc });
        const flavorParts = ["Initiative"]; 
        if (useCombatSenses) flavorParts.push("(Combat Senses)");
        if (hasTalent(actor, "lightningreflexes")) flavorParts.push("(Lightning Reflexes)");
        await finalRoll.toMessage({
          speaker,
          flavor: `${actor.name} — ${flavorParts.join(" ")}`,
          rollMode: game.settings.get("core", "rollMode"),
          ...messageOptions
        });
      } catch (err) {
        console.warn("UESRPG | initiative roll message failed", err);
      }
    }

    if (updates.length) {
      await this.updateEmbeddedDocuments("Combatant", updates);
    }

    // Preserve the currently active combatant turn index where possible.
    if (updateTurn && currentId) {
      const idx = this.turns?.findIndex(c => c?.id === currentId) ?? -1;
      if (idx >= 0 && idx !== this.turn) {
        try {
          await this.update({ turn: idx });
        } catch (_e) {
          // Non-critical.
        }
      }
    }

    return rolls;
  }

  _combatSensesInitiativeRating(actor) {
    // Chapter 4: Combat Senses formula (as specified in the rules text):
    // IR = (2 × Perception Bonus) + 2 + initiative.bonus
    // We also include trait/talent bonus lanes if present, since they are part of the
    // system's initiative modifier model and may be influenced by Active Effects.
    const prcBonus = Number(actor?.system?.characteristics?.prc?.bonus ?? 0) || 0;
    const bonus = Number(actor?.system?.initiative?.bonus ?? 0) || 0;
    const traitBonus = Number(actor?.system?.initiative?.traitBonus ?? 0) || 0;
    const talentBonus = Number(actor?.system?.initiative?.talentBonus ?? 0) || 0;
    return (2 * prcBonus) + 2 + bonus + traitBonus + talentBonus;
  }

  async _promptCombatSensesChoice(actor) {
    return new Promise((resolve) => {
      const title = "Combat Senses";
      const content = `
        <p><b>${actor?.name ?? "Actor"}</b> can calculate Initiative Rating using an alternate formula.</p>
        <p>Choose which Initiative Rating to use for this roll.</p>
      `;
      new Dialog({
        title,
        content,
        buttons: {
          normal: {
            label: "Use Normal Initiative",
            callback: () => resolve(false)
          },
          senses: {
            label: "Use Combat Senses",
            callback: () => resolve(true)
          }
        },
        default: "normal",
        close: () => resolve(false)
      }).render(true);
    });
  }

  /**
   * Batch Combat Senses choice used by Combat Tracker "Roll All".
   *
   * This prompt is shown at most once per user per combat (session-cached).
   * The selected option is applied only to combatants who actually have the
   * Combat Senses talent.
   */
  async _promptCombatSensesBatchChoice() {
    return new Promise((resolve) => {
      const title = "Combat Senses";
      const content = `
        <p>One or more combatants have <b>Combat Senses</b>.</p>
        <p>Choose which Initiative Rating to use for this <b>Roll All</b> operation.</p>
        <p><i>This choice is remembered for this combat for the current browser session.</i></p>
      `;
      new Dialog({
        title,
        content,
        buttons: {
          normal: {
            label: "Use Normal Initiative",
            callback: () => resolve(false)
          },
          senses: {
            label: "Use Combat Senses",
            callback: () => resolve(true)
          }
        },
        default: "normal",
        close: () => resolve(false)
      }).render(true);
    });
  }
}
