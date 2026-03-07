/**
 * @module magic/casting-service
 *
 * src/core/magic/casting-service.js
 *
 * Unified spell casting service for UESRPG 3ev4.
 * Single ingress API for all casting entry points (sheets, TokenHUD, macros, favorites).
 *
 * **Design Goals**:
 * - Unified API: All entry points route through SpellCastingService.cast()
 * - Consistent UX: Same spell options dialog, cost handling, chat output
 * - Permission-safe: Uses authority proxy for multiplayer
 * - Extensible: Supports targeted/untargeted/direct/AoE workflows
 *
 * Target: Foundry VTT v13.351
 */

import { resolveSpellProfile } from "./spell-profile.js";
import { getActorMagicka, isActorTrainedInMagicSchool } from "./magicka-utils.js";
import { MagicOpposedWorkflow } from "./opposed-workflow.js";
import { showSpellOptionsDialog } from "./dialogs/spell-options-dialog.js";
import { emitPreCast } from "./spell-runtime.js";

/**
 * Unified spell casting service.
 * All casting entry points should delegate to this API.
 */
export const SpellCastingService = {
  
  /**
   * Cast a spell with unified workflow routing.
   *
   * @param {object} cfg - Casting configuration
   * @param {string} cfg.spellUuid - Spell item UUID
   * @param {string} cfg.casterActorUuid - Caster actor UUID
   * @param {string} [cfg.casterTokenUuid] - Caster token UUID (for range validation)
   * @param {string[]} [cfg.targetTokenUuids] - Target token UUIDs (if targeted)
   * @param {object} [cfg.spellOptions] - Spell options override (skips dialog if provided)
   * @param {boolean} [cfg.spellOptions.isRestrained] - Spell Restraint (refund WPB on success)
   * @param {boolean} [cfg.spellOptions.isOverloaded] - Overload (2× cost, enhanced effect)
   * @param {string} [cfg.spellOptions.difficultyKey] - Difficulty modifier key
   * @param {number} [cfg.spellOptions.manualModifier] - Manual TN modifier
   * @param {string} [cfg.castActionType] - "primary" | "secondary" (default: "primary")
   * @param {object} [cfg.aoeConfig] - AoE configuration (if AoE spell)
   * @param {boolean} [cfg.skipDialog] - Skip spell options dialog (use defaults or provided options)
   * @returns {Promise<object|null>} - { success: boolean, messageId: string|null, error: string|null }
   */
  async cast(cfg) {
    try {
      // 1. Validate and resolve entities
      const spell = await fromUuid(cfg.spellUuid);
      if (!spell || spell.type !== "spell") {
        ui.notifications.error("Invalid spell UUID");
        return { success: false, messageId: null, error: "Invalid spell UUID" };
      }
      
      const actor = await fromUuid(cfg.casterActorUuid);
      if (!actor || !["Player Character", "NPC"].includes(actor.type)) {
        ui.notifications.error("Invalid caster actor");
        return { success: false, messageId: null, error: "Invalid caster actor" };
      }
      
      // 2. Resolve spell profile (for validation and routing)
      const profile = resolveSpellProfile(spell, actor, {
        level: cfg.spellOptions?.castLevel ?? null, // Use selected variant level if provided
        isRestrained: cfg.spellOptions?.isRestrained ?? false,
        isOverloaded: cfg.spellOptions?.isOverloaded ?? false
      });
      
      // 3. Validate prerequisites
      const validationResult = await this._validateCastPrerequisites(actor, spell, profile, cfg);
      if (!validationResult.valid) {
        ui.notifications.warn(validationResult.reason);
        return { success: false, messageId: null, error: validationResult.reason };
      }
      
      // 4. Show spell options dialog if needed
      let spellOptions = cfg.spellOptions;
      if (!cfg.skipDialog && !spellOptions) {
        const dialogResult = await this._showSpellOptionsDialog(actor, spell, profile, cfg);
        if (!dialogResult || dialogResult.cancelled) {
          return { success: false, messageId: null, error: "Casting cancelled by user" };
        }
        spellOptions = dialogResult.options;
      }
      
      // Use defaults if still no options provided
      spellOptions = spellOptions ?? {
        isRestrained: false,
        isOverloaded: false,
        difficultyKey: "average",
        manualModifier: 0
      };
      
      // 5. Fire preCast hook (cancellable)
      const preCastAllowed = emitPreCast({
        caster: actor,
        spell,
        spellOptions,
        targetUuids: cfg.targetTokenUuids ?? []
      });
      if (!preCastAllowed) {
        return { success: false, messageId: null, error: "Casting cancelled by hook" };
      }
      
      // 6. Route to appropriate workflow
      const castResult = await this._routeToWorkflow(actor, spell, profile, {
        ...cfg,
        spellOptions
      });
      
      return castResult;
      
    } catch (err) {
      console.error("uesrpg-3ev4 | SpellCastingService.cast error:", err);
      ui.notifications.error(`Spell casting failed: ${err.message}`);
      return { success: false, messageId: null, error: err.message };
    }
  },
  
  /**
   * Validate casting prerequisites (AP, Magicka, etc.).
   * @private
   * @param {Actor} actor
   * @param {Item} spell
   * @param {object} profile - Spell profile from resolveSpellProfile()
   * @param {object} cfg - Casting config
   * @returns {Promise<{valid: boolean, reason: string|null}>}
   */
  async _validateCastPrerequisites(actor, spell, profile, cfg) {
    const isScrollMode = cfg.scrollMode === true;
    const ignoreTraining = cfg.ignoreTraining === true;
    const consumeMagicka = cfg.consumeMagicka !== false; // default true; scrolls may pass false

    // RAW: untrained casters cannot cast from that school.
    // Scrolls bypass training when ignoreTraining is set (controlled by setting).
    if (!ignoreTraining && !isActorTrainedInMagicSchool(actor, spell?.system?.school)) {
      return { valid: false, reason: `${actor.name} is untrained in ${spell?.system?.school ?? "this school"} and cannot cast ${spell.name}.` };
    }

    // Check if actor has the spell.
    // Scroll casts reference an external spell item, so skip this check in scroll mode.
    if (!isScrollMode) {
      const actorHasSpell = actor.items.some(i => i.id === spell.id || i.uuid === spell.uuid);
      if (!actorHasSpell && actor.type === "Player Character") {
        // NPCs can cast any spell, PCs must have it in their spellbook
        return { valid: false, reason: `${actor.name} does not have ${spell.name} in their spellbook` };
      }
    }

    // Check Magicka availability (using attempt cost, not final cost).
    // Scrolls bypass magicka when consumeMagicka is false.
    if (consumeMagicka) {
      const currentMagicka = getActorMagicka(actor);
      const attemptCost = profile.cost.attempt;
      if (currentMagicka < attemptCost) {
        return { valid: false, reason: `Insufficient magicka: ${attemptCost} MP required, ${currentMagicka} available` };
      }
    }

    // Check Action Point availability (if not instant + secondary)
    const castActionType = cfg.castActionType ?? "primary";
    const requiresAP = !(profile.classification.isInstant && castActionType === "secondary");

    if (requiresAP) {
      const currentAP = Number(actor.system?.action_points?.value ?? 0);
      if (currentAP < 1) {
        return { valid: false, reason: "Insufficient Action Points: 1 AP required" };
      }
    }

    // All prerequisites met
    return { valid: true, reason: null };
  },
  
  /**
   * Show spell options dialog (restrain, overload, difficulty, etc.).
   * @private
   * @param {Actor} actor
   * @param {Item} spell
   * @param {object} profile
   * @param {object} cfg
   * @returns {Promise<{options: object, cancelled: boolean}|null>}
   */
  async _showSpellOptionsDialog(actor, spell, profile, cfg) {
    // Use the existing shared spell options dialog from UI layer
    const result = await showSpellOptionsDialog(actor, spell);
    
    if (!result) {
      return { options: null, cancelled: true };
    }
    
    // Transform the result into the format expected by casting workflows
    return {
      options: {
        isRestrained: result.isRestrained ?? false,
        isOverloaded: result.isOverloaded ?? false,
        difficultyKey: result.difficultyKey ?? "average",
        manualModifier: result.manualModifier ?? 0,
        useOvercharge: result.useOvercharge ?? false,
        useMagickaCycling: result.useMagickaCycling ?? false
      },
      cancelled: false
    };
  },
  
  /**
   * Route to appropriate casting workflow based on spell classification.
   * @private
   * @param {Actor} actor
   * @param {Item} spell
   * @param {object} profile
   * @param {object} cfg
   * @returns {Promise<object>}
   */
  async _routeToWorkflow(actor, spell, profile, cfg) {
    const { spellOptions, targetTokenUuids, aoeConfig } = cfg;

    // Propagate scroll-mode flags (consumeMagicka) into spellOptions so workflow
    // methods and magicka-utils can honour them without needing cfg access.
    const effectiveSpellOptions = cfg.consumeMagicka === false
      ? { ...spellOptions, consumeMagicka: false }
      : spellOptions;

    // Determine workflow type
    const hasTargets = targetTokenUuids && targetTokenUuids.length > 0;
    const isAoE = profile.range.type === "aoe";
    const isDirect = profile.classification.isDirect;

    // Get target tokens
    let targetTokens = [];
    if (hasTargets) {
      for (const uuid of targetTokenUuids) {
        const token = await fromUuid(uuid);
        if (token) targetTokens.push(token);
      }
    }

    // Route to appropriate workflow
    if (isDirect) {
      // Direct spells (no opposed test)
      return await this._castDirect(actor, spell, profile, effectiveSpellOptions, cfg);
    } else if (hasTargets || isAoE) {
      // Opposed workflow (uses MagicOpposedWorkflow.createPending)
      return await this._castOpposed(actor, spell, profile, effectiveSpellOptions, targetTokens, cfg);
    } else {
      // Unopposed (attack spell with no targets yet, or non-targeted utility)
      return await this._castUnopposed(actor, spell, profile, effectiveSpellOptions, cfg);
    }
  },
  
  /**
   * Cast direct spell (no opposed test).
   * @private
   */
  async _castDirect(actor, spell, profile, spellOptions, cfg = {}) {
    try {
      const defenderTokenUuid = Array.isArray(cfg.targetTokenUuids) && cfg.targetTokenUuids.length
        ? cfg.targetTokenUuids[0]
        : null;
      // Direct casting uses MagicOpposedWorkflow.castDirectTargeted(cfg)
      const result = await MagicOpposedWorkflow.castDirectTargeted({
        attackerActorUuid: actor.uuid,
        attackerTokenUuid: cfg.casterTokenUuid ?? null,
        defenderTokenUuid,
        spellUuid: spell.uuid,
        spellOptions,
        castActionType: cfg.castActionType ?? "primary",
      });
      
      return {
        success: result !== null,
        messageId: result?.messageId ?? null,
        error: result ? null : "Direct cast failed"
      };
    } catch (err) {
      console.error("uesrpg-3ev4 | Direct cast error:", err);
      return { success: false, messageId: null, error: err.message };
    }
  },
  
  /**
   * Cast opposed spell (targets defend).
   * @private
   */
  async _castOpposed(actor, spell, profile, spellOptions, targetTokens, cfg = {}) {
    try {
      // Opposed casting uses MagicOpposedWorkflow.createPending(cfg)
      const result = await MagicOpposedWorkflow.createPending({
        attackerActorUuid: actor.uuid,
        attackerTokenUuid: cfg.casterTokenUuid ?? null,
        defenderTokenUuids: Array.isArray(cfg.targetTokenUuids)
          ? cfg.targetTokenUuids
          : (targetTokens ?? [])
              .map((t) => t?.document?.uuid ?? t?.uuid)
              .filter(Boolean),
        spellUuid: spell.uuid,
        spellOptions,
        castActionType: cfg.castActionType ?? "primary",
        aoe: cfg.aoeConfig ?? null,
        isAoE: Boolean(cfg.aoeConfig),
      });
      
      return {
        success: result !== null,
        messageId: result?.messageId ?? null,
        error: result ? null : "Opposed cast failed"
      };
    } catch (err) {
      console.error("uesrpg-3ev4 | Opposed cast error:", err);
      return { success: false, messageId: null, error: err.message };
    }
  },
  
  /**
   * Cast unopposed spell (no targets, no defense).
   * @private
   */
  async _castUnopposed(actor, spell, profile, spellOptions, cfg = {}) {
    try {
      // Unopposed casting uses MagicOpposedWorkflow.castUnopposed(cfg)
      const result = await MagicOpposedWorkflow.castUnopposed({
        attackerActorUuid: actor.uuid,
        attackerTokenUuid: cfg.casterTokenUuid ?? null,
        spellUuid: spell.uuid,
        spellOptions,
        castActionType: cfg.castActionType ?? "primary",
      });
      
      return {
        success: result !== null,
        messageId: result?.messageId ?? null,
        error: result ? null : "Unopposed cast failed"
      };
    } catch (err) {
      console.error("uesrpg-3ev4 | Unopposed cast error:", err);
      return { success: false, messageId: null, error: err.message };
    }
  }
};
