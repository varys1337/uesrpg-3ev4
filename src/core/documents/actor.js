/**
 * Extend the base Actor entity by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */


import { isTransferEffectActive } from "../active-effects/transfer.js";
import { evaluateAEModifierKeys } from "../active-effects/modifier-evaluator.js";
import { applyTraitDerived, collectTraitDamageModifiers, getResistanceKeyForTraitType, getActorTraitValue, isActorUndead } from "../traits/trait-registry.js";
import { isNPC } from "../rules/npc-rules.js";
import { ensureSystemData } from "../actors/prepare/ensure-system-data.js";
import { prepareCharacterData } from "../actors/prepare/character.js";
import { prepareNPCData } from "../actors/prepare/npc.js";
import { prepareGroupData } from "../actors/prepare/group.js";
import { prepareWarfareUnitData } from "../actors/prepare/warfare-unit.js";
import { aggregateItemStats } from "../actors/rules/item-aggregation.js";
import { getArmorMobilityPenalties, flyCalc } from "../actors/rules/armor-mobility.js";
import {
  hasVampireLordForm,
  hasWereWolfForm,
  hasWereBatForm,
  hasWereBoarForm,
  hasWereBearForm,
  hasWereCrocodileForm,
  hasWereVultureForm
} from "../actors/rules/forms.js";
import {
  collectAEModifiersForKeys,
  collectAEModifiersForKeySetMerged,
  getResourceAEModifiers,
  getInitiativeAEModifiers,
  getSpeedAEModifiers,
  getActionPointsAEModifiers,
  getLuckyUnluckySlotAEModifiers,
  getCarryAEModifiers,
  getFatigueAEModifiers,
  applyResistanceAEModifiers,
  hasWoundPenaltySuppression,
  applyWoundThresholdAEs
} from "../actors/ae/modifiers.js";
import { FLAG_SCOPE } from "../constants.js";
import { ensureIndex, getDocumentsByIds } from "../compendium/access-service.js";
import { getCachedPrepareContext, invalidateActorDerivedCache, setCachedPrepareContext } from "../actors/derived-cache/actor-derived-cache.js";
import { buildActorPrepareContext, hasTalentCached } from "./actor/prepare-context.js";
import {
  calculateAddedHalfSpeed,
  calculateFatiguePenalty,
  calculateInitiative,
  calculateSpeed,
  calculateWoundThreshold,
  determineIbToMp,
  hasHalfWoundPenalty,
} from "./actor/derived.js";
import { applyMovementRestrictionSemantics, getActorConditionKeySet } from "./actor/conditions.js";
import { wouldCreateCircularGroupReference } from "./actor/group-membership.js";

/** Item types that carry a TN via baseCha and implement _prepareCombatStyleData. */
const TN_ITEM_TYPES = new Set(["skill", "combatStyle", "magicSkill"]);
let _coreSkillsCachePromise = null;

async function _getCoreSkillSourcesSorted() {
  if (_coreSkillsCachePromise) return _coreSkillsCachePromise;

  _coreSkillsCachePromise = (async () => {
    const index = await ensureIndex("uesrpg-3ev4.core-skills", { fields: ["name"] });
    if (!index.length) {
      console.warn("uesrpg-3ev4 | Core skills compendium pack not found; skipping skill pre-population.");
      return [];
    }
    const sorted = [...index].sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")));
    const collection = await getDocumentsByIds("uesrpg-3ev4.core-skills", sorted.map((entry) => entry?._id));
    return collection.map(i => i.toObject());
  })();

  return _coreSkillsCachePromise;
}

export class SimpleActor extends Actor {
  async _preCreate(data, options, user) {

    if (this.type === 'Player Character') {
      // Updates token default settings for Character types
      this.prototypeToken.updateSource({
        'sight.enabled': true,
        actorLink: true,
        disposition: 1
      })
    }

    if (this.type === 'Group') {
      // Updates token default settings for Group types
      this.prototypeToken.updateSource({
        'sight.enabled': false,
        actorLink: true,
        disposition: 0,
        'displayName': CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        'displayBars': CONST.TOKEN_DISPLAY_MODES.NONE
      })
    }

    if (this.type === 'Warfare Unit') {
      // Token defaults for Warfare Unit: unlinked, visible name, neutral disposition.
      // Bar1 shows Resolve, with Condition preserved as a mirrored compatibility lane.
      this.prototypeToken.updateSource({
        'sight.enabled': false,
        actorLink: false,
        disposition: 0,
        'displayName': CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        'displayBars': CONST.TOKEN_DISPLAY_MODES.OWNER,
        'bar1.attribute': 'stats.resolve'
      })
    }


    // Preps and adds standard skill items to Character types
    await super._preCreate(data, options, user);
    // Warfare Unit: do not auto-populate skills or any PC items.
    if (this.type === 'Warfare Unit') return;
    if (this.type === 'Player Character') {
      if (Array.isArray(data?.items) && data.items.length > 0) return;
      const sources = await _getCoreSkillSourcesSorted();
      if (!Array.isArray(sources) || sources.length === 0) return;

      this.updateSource({
        items: sources.map(s => foundry.utils.deepClone(s)),
        'system.size': 'standard'
      })
    }
  }

  async _onCreate(data, options, userId) {
    await super._onCreate(data, options, userId);
    if (this.type !== "Warfare Unit") return;
    if (!this.isOwner) return;

    const maxResolve = Number(this.system?.stats?.resolve?.max ?? this.system?.stats?.condition?.max ?? this.system?._derived?.resolveMax ?? this.system?._derived?.conditionMax ?? 0) || 0;
    const currentResolve = Number(this.system?.stats?.resolve?.value ?? this.system?.stats?.condition?.value ?? 0) || 0;
    if (maxResolve <= 0 || currentResolve !== 0) return;

    await this.update({
      "system.stats.resolve.value": maxResolve,
      "system.stats.condition.value": maxResolve,
      [`flags.${FLAG_SCOPE}.warfareConditionInitialized`]: true,
    });
  }
  prepareBaseData() {
    // Ensure minimum scaffolding before base prep to tolerate partial/corrupt actor payloads.
    this._ensureSystemData();
    // Prepare-lane invalidation is now handled by targeted hooks (Patch 1)
    // This allows prepare-context to persist across renders until relevant changes occur
    super.prepareBaseData();
  }

  prepareDerivedData() {
    super.prepareDerivedData();

    try {
      const actorData = this;

      if (actorData.type === "Player Character") {
        this._prepareCharacterData(actorData);
        // Re-derive embedded item TNs now that characteristics are finalized.
        // Items' initial prepareData() ran before _prepareCharacterData computed
        // final characteristic totals + AE bonuses.
        this._recomputeItemTNs();
      } else if (actorData.type === "NPC") {
        this._prepareNPCData(actorData);
        this._recomputeItemTNs();
      } else if (actorData.type === "Group") {
        this._prepareGroupData(actorData);
      } else if (actorData.type === "Warfare Unit") {
        this._prepareWarfareUnitData(actorData);
      }
    } catch (err) {
      console.error(`uesrpg-3ev4 | Error during prepareDerivedData for ${this.name || this.id}:`, err);
      // Re-ensure minimum safe defaults after a failure to prevent cascading errors in rendering.
      this._ensureSystemData();
    }
  }


  /**
   * Re-derive TN values for embedded skill/combatStyle/magicSkill items.
   *
   * Item.prepareData() runs during super.prepareData() before
   * _prepareCharacterData/_prepareNPCData computes final characteristic
   * totals (including AE bonuses). This second pass re-computes
   * system.value with the now-finalized characteristic data, keeping
   * the live DataProxy in sync for both roll handlers and sheet rendering.
   *
   * Side-effect free: only mutates in-memory derived fields on the live
   * DataProxy; no document updates are issued.
   */
  _recomputeItemTNs() {
    for (const item of this.items) {
      if (!TN_ITEM_TYPES.has(item.type)) continue;
      if (!item?.system || !Object.prototype.hasOwnProperty.call(item.system, "baseCha")) continue;
      if (typeof item._prepareCombatStyleData !== "function") continue;
      item._prepareCombatStyleData(this, item.system);
    }
  }

  _getPrepareCtx() {
    const cached = getCachedPrepareContext(this);
    if (cached) return cached;
    return setCachedPrepareContext(this, buildActorPrepareContext(this));
  }

  _hasTalentCached(key) {
    return hasTalentCached(this, key);
  }

  /**
   * Ensure required system data objects exist with safe defaults.
   *
   * IMPORTANT:
   *  - This only initializes missing objects/fields; it should not perform computations.
   *  - It must not replace embedded collections (e.g. this.items, this.effects).
   *  - This is derived-data scaffolding only; schema changes must occur in migrations.
   */
  _ensureSystemData() {
    ensureSystemData(this);
  }

  /**
   * Get the total value of a characteristic by name.
   * @param {object} actorData - Actor data object
   * @param {string} name - Characteristic key (str, end, agi, int, wp, prc, prs, lck)
   * @returns {number} The total value, or 0 if not found
   */
  _getCharacteristicTotal(actorData, name) {
    return Number(actorData?.system?.characteristics?.[name]?.total ?? 0);
  }

  /**
   * Aggregate item stats in a single pass to avoid repeated item.filter() work.
   * The result is cached on the actor instance for the duration of a prepare cycle.
   */
  _aggregateItemStats(actorData) {
    return aggregateItemStats(this, actorData);
  }

  /**
   * Determine the heaviest *effective* armor weight class currently worn.
   */
  _getArmorMobilityPenalties(actorData) {
    return getArmorMobilityPenalties(actorData);
  }


  _flyCalc(actorData) {
    return flyCalc(actorData);
  }



  /**
   * Collect numeric Active Effect modifiers for a set of target keys.
   */
  _collectAEModifiersForKeys(targetKeys = []) {
    return collectAEModifiersForKeys(this, targetKeys);
  }
  
  
  
  /**
   * Collect deterministic AE modifiers where multiple keys should be treated as a single semantic lane.
   */
  _collectAEModifiersForKeySetMerged(keySet = []) {
    return collectAEModifiersForKeySetMerged(this, keySet);
  }
  
  /**
   * Read deterministic AE modifiers for a resource modifier namespace.
   */
  _getResourceAEModifiers(resourceKey) {
    return getResourceAEModifiers(this, resourceKey);
  }
  
  

  /**
   * Read deterministic AE modifiers for Initiative Rating (IR).
   */
  _getInitiativeAEModifiers() {
    return getInitiativeAEModifiers(this);
  }

  /**
   * Read deterministic AE modifiers for Speed.
   */
  _getSpeedAEModifiers() {
    return getSpeedAEModifiers(this);
  }

  /**
   * Read deterministic AE modifiers for Action Points.
   */
  _getActionPointsAEModifiers() {
    return getActionPointsAEModifiers(this);
  }

  /**
   * Read deterministic AE modifiers for Lucky/Unlucky active slot counts.
   */
  _getLuckyUnluckySlotAEModifiers() {
    return getLuckyUnluckySlotAEModifiers(this);
  }

  /**
   * Read deterministic AE modifiers for Carry/Encumbrance.
   */
  _getCarryAEModifiers() {
    return getCarryAEModifiers(this);
  }
  
  
  
  /**
   * Read deterministic AE modifiers for Fatigue / Exhaustion.
   */
  _getFatigueAEModifiers() {
    return getFatigueAEModifiers(this);
  }
  
  /**
   * Apply Active Effect modifiers to resistance values.
   */
  _applyResistanceAEModifiers(resistanceData) {
    return applyResistanceAEModifiers(this, resistanceData);
  }
  
  
  
  
  
  
    /**
     * Chapter 5: magical healing / first aid can temporarily remove passive wound penalties.
     */
    _hasWoundPenaltySuppression(actorData) {
      return hasWoundPenaltySuppression(this, actorData);
    }
  /**
   * Apply deterministic Active Effect modifiers to Wound Threshold.
   */
  _applyWoundThresholdAEs(actorSystemData) {
    applyWoundThresholdAEs(this, actorSystemData);
  }

  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData(actorData) {
    // Delegate to extracted module
    prepareCharacterData(this, actorData);
  }

  /**
   * Prepare NPC type specific data
   */
   _prepareNPCData(actorData) {
    // Delegate to extracted module
    prepareNPCData(this, actorData);
  }

 /**
   * Prepare Group type specific data
   * Groups are simple containers with no calculations needed
   */
  _prepareGroupData(actorData) {
    // Delegate to extracted module
    prepareGroupData(this, actorData);
  }

  /**
   * Prepare Warfare Unit type specific data.
   * Isolated from humanoid prep — no combat, magic, encumbrance, or skill paths.
   */
  _prepareWarfareUnitData(actorData) {
    prepareWarfareUnitData(this, actorData);
  }


  /**
   * Check if adding an actor would create a circular reference
   * @param {String} actorUuid - UUID of actor to potentially add
   * @returns {Promise<Boolean>} - True if circular, false if safe
   */
  async _wouldCreateCircularReference(actorUuid) {
    return wouldCreateCircularGroupReference(this, actorUuid);
  }
    
   _calculateItemSkillModifiers(actorData, agg) {
    // If aggregator is provided, apply skillModifiers from it (fast, no item.filter)
    if (agg && agg.skillModifiers && Object.keys(agg.skillModifiers).length > 0) {
      for (let [name, value] of Object.entries(agg.skillModifiers)) {
        actorData.system.professions[name] = Number(actorData?.system?.professions?.[name] || 0) + Number(value);
        actorData.system.professionsWound[name] = Number(actorData?.system?.professionsWound?.[name] || 0) + Number(value);
      }
      return;
    }

    // Fallback: original behavior (safer)
    let modItems = (actorData.items || []).filter(i =>
      i && i?.system && Object.prototype.hasOwnProperty.call(i.system, 'skillArray')
      && Array.isArray(i.system.skillArray) && i.system.skillArray.length > 0
      && i.system.equipped
    )

    for (let item of modItems) {
      for (let entry of item?.system?.skillArray || []) {
        if (!entry?.name) continue;
        let moddedSkill = actorData?.system?.professions?.[entry.name] || 0;
        actorData.system.professions[entry.name] = Number(moddedSkill) + Number(entry?.value || 0);
        actorData.system.professionsWound[entry.name] = Number(moddedSkill) + Number(entry?.value || 0);
      }
    }
  }

  _speedCalc(actorData) {
    return calculateSpeed(this, actorData);
  }

  _iniCalc(actorData) {
    return calculateInitiative(this, actorData);
  }

  _woundThresholdCalc(actorData) {
    return calculateWoundThreshold(this, actorData);
  }

  _calcFatiguePenalty(actorData) {
    return calculateFatiguePenalty(this, actorData);
  }

  _halfWoundPenalty(actorData) {
    return hasHalfWoundPenalty(this, actorData);
  }

  _determineIbMp(actorData) {
    return determineIbToMp(this, actorData);
  }

  _isMechanical(actorData) {
    const cached = actorData?._aggCache?.agg?.actorFlags?.isMechanical;
    if (cached != null) return cached === true;
    return (actorData.items || []).some(item => item?.system?.mechanical === true);
  }

  _dwemerSphere(actorData) {
    const cached = actorData?._aggCache?.agg?.actorFlags?.dwemerSphere;
    if (cached != null) return cached === true;
    return (actorData.items || []).some(item => item?.system?.shiftForm === true && item?.system?.dailyUse === true);
  }

  _vampireLordForm(actorData) {
    return hasVampireLordForm(actorData);
  }

  _wereWolfForm(actorData) {
    return hasWereWolfForm(actorData);
  }

  _wereBatForm(actorData) {
    return hasWereBatForm(actorData);
  }

  _wereBoarForm(actorData) {
    return hasWereBoarForm(actorData);
  }

  _wereBearForm(actorData) {
    return hasWereBearForm(actorData);
  }

  _wereCrocodileForm(actorData) {
    return hasWereCrocodileForm(actorData);
  }

  _wereVultureForm(actorData) {
    return hasWereVultureForm(actorData);
  }

  _painIntolerant(actorData) {
    const cached = actorData?._aggCache?.agg?.actorFlags?.painIntolerant;
    if (cached != null) return cached === true;
    return (actorData.items || []).some(item => item?.system?.painIntolerant === true);
  }

  /**
   * Collect all uesrpg-3ev4 condition keys applied via ActiveEffects.
   * This is a derived-data helper only; it does not mutate document data.
   */
  _getUesConditionKeySet(actorData) {
    return getActorConditionKeySet(actorData);
  }

  /**
   * Chapter 5 (Package 4): enforce movement restriction semantics via derived Speed.
   * This does not block token movement in the canvas; it deterministically adjusts derived speed values.
   */
  _applyMovementRestrictionSemantics(actorData, actorSystemData) {
    applyMovementRestrictionSemantics(actorData, actorSystemData);
  }

  _addHalfSpeed(actorData) {
    return calculateAddedHalfSpeed(this, actorData);
  }

  /**
   * Apply damage to this actor with automatic reductions and tracking
   * @param {number} damage - Raw damage amount
   * @param {string} damageType - Type of damage (physical, fire, frost, etc.)
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Damage application result
   */
  async applyDamage(damage, damageType = 'physical', options = {}) {
    const { ApplyDamageService } = await import('../../application/combat/apply-damage-service.js');
    return ApplyDamageService.applySimple(this, damage, damageType, options);
  }

  /**
   * Apply healing to this actor
   * @param {number} healing - Amount of HP to restore
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Healing result
   */
  async applyHealing(healing, options = {}) {
    const { ApplyDamageService } = await import('../../application/combat/apply-damage-service.js');
    return ApplyDamageService.applyHealing(this, healing, options);
  }

  /**
   * Get damage reduction values for this actor
   * @param {string} damageType - Type of damage
   * @returns {Object} - Damage reduction breakdown
   */
  async getDamageReduction(damageType = 'physical') {
    const { getDamageReduction: getDamageReductionFunc } = await import('../combat/damage-automation.js');
    return getDamageReductionFunc(this, damageType);
  }

}
