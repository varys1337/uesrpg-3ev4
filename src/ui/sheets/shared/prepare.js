/**
 * Data preparation helpers shared across PC and NPC actor sheets.
 *
 * All functions are pure: no document mutations, no persistent state.
 * These helpers transform Actor document data into sheet-ready display objects.
 *
 * Merged from actor/prepare.js and npc/prepare.js — identical logic consolidated.
 */

import { buildCombatQuickContext as buildCombatQuick } from "../combat-actions-utils.js";
import {
  getActiveCombatStyleId,
  getExplicitActiveCombatStyleItem,
  buildSpecialActionsForActor,
  isSpecialActionUsableNow
} from "../../../core/combat/combat-style-utils.js";
import { getLoadoutsForActor } from "../sheet-ui-state.js";
import { cachedEnrichHTML } from "../../../utils/enrich-cache.js";

/**
 * Build combat quick-action context for the combat tab.
 *
 * @param {object} actorData - Prepared actor data object from getData()
 * @returns {object} Combat quick context
 */
export function buildCombatQuickContext(actorData) {
  try {
    return buildCombatQuick(actorData);
  } catch (e) {
    return {
      combatStyleName: null,
      meleeWeaponId: null,
      meleeWeaponName: null,
      rangedWeaponId: null,
      rangedWeaponName: null,
      equippedAmmo: [],
      equippedArmor: [],
      equippedShields: [],
    };
  }
}

/**
 * Build combat actions context (active style, special actions).
 *
 * Works for both PC and NPC actors — uses `itemTypes.combatStyle` when
 * available (NPC fast-path), otherwise falls back to `items.filter`.
 *
 * @param {Actor} actor - The Actor document
 * @returns {object} Combat actions context
 */
export function buildCombatActionsContext(actor) {
  try {
    const combatStyles = actor?.itemTypes?.combatStyle
      ?? actor?.items?.filter?.(i => i.type === "combatStyle")
      ?? [];
    const activeCombatStyleId = getActiveCombatStyleId(actor);
    const activeStyleItem = getExplicitActiveCombatStyleItem(actor);

    const specialActions = buildSpecialActionsForActor(actor).map(sa => ({
      ...sa,
      usableNow: isSpecialActionUsableNow(actor, sa.actionType),
      usableAsAdvantage: Boolean(sa.known)
    }));

    return {
      activeCombatStyleId: activeCombatStyleId ?? "",
      combatStyles: combatStyles.map(cs => ({
        id: cs.id,
        name: cs.name,
        isActive: Boolean(activeCombatStyleId && cs.id === activeCombatStyleId)
      })),
      activeCombatStyleName: activeStyleItem?.name ?? null,
      specialActions,
      canCastMagic: Boolean(
        actor?.itemTypes?.spell?.length
        ?? actor?.items?.some?.(i => i.type === "spell")
      ),
      canCastInstantMagic: Boolean(
        actor?.itemTypes?.spell?.some?.(s => s?.system?.isInstant === true)
        ?? actor?.items?.some?.(i => i.type === "spell" && i?.system?.isInstant === true)
      )
    };
  } catch (_e) {
    return {
      activeCombatStyleId: "",
      combatStyles: [],
      activeCombatStyleName: null,
      specialActions: [],
      canCastMagic: false,
      canCastInstantMagic: false
    };
  }
}

/**
 * Apply Defensive Stance attack disabling to combat quick context.
 *
 * @param {Actor} actor - The Actor document
 * @param {object} combatQuickContext - The combat quick context object
 */
export function applyDefensiveStanceDisabling(actor, combatQuickContext) {
  try {
    const hasDefensiveStance = actor?.effects?.some((e) => !e.disabled && e?.flags?.uesrpg?.key === "defensiveStance");
    if (hasDefensiveStance && combatQuickContext) {
      combatQuickContext.quickAttacksDisabled = true;
      combatQuickContext.quickAttacksDisabledReason = "Defensive Stance: attacks disabled until your next Turn.";
    }
  } catch (_e) {
    /* no-op */
  }
}

/**
 * Build sheet UI state (loadouts, diagnostics, settings).
 *
 * @param {Actor} actor - The Actor document
 * @returns {Promise<object>} Sheet UI state
 */
export async function buildSheetUiState(actor) {
  const enableLoadouts = Boolean(game?.settings?.get?.("uesrpg-3ev4", "enableLoadouts"));
  const showDiagnostics = Boolean(game?.settings?.get?.("uesrpg-3ev4", "sheetDiagnostics"));
  const loadouts = enableLoadouts ? await getLoadoutsForActor(actor.id) : [];

  return {
    enableLoadouts,
    showDiagnostics,
    loadouts,
  };
}

/**
 * Enrich biography HTML, with optional per-sheet caching.
 *
 * @param {string} bio - Raw biography text
 * @param {object} [sheet] - Sheet instance for caching (omit to skip cache).
 * @returns {Promise<string>} Enriched HTML
 */
export async function enrichBiography(bio, sheet) {
  const enrichFn = foundry.applications.ux.TextEditor.implementation.enrichHTML;
  const _enrich = (raw) => enrichFn(raw || "");
  if (sheet) return cachedEnrichHTML(sheet, "bio", bio ?? "", _enrich);
  return _enrich(bio);
}

/**
 * Normalize rank values for rendering (prevents UI defaulting to 'untrained' due to legacy typos).
 * PC-only — NPC sheets do not display combat style rank values.
 *
 * @param {object[]} items - Array of item data objects
 */
export function normalizeItemRanks(items) {
  const normalizeRankValue = (rank) => {
    if (rank == null) return rank;
    const r = String(rank).toLowerCase();
    if (r === "journeymain") return "journeyman";
    return r;
  };

  try {
    for (const it of items || []) {
      if (it?.type === "combatStyle" && it?.system) {
        it.system.rank = normalizeRankValue(it.system.rank);
      }
    }
  } catch (e) {
    /* no-op */
  }
}
