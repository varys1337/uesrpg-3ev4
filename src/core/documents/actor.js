/**
 * Extend the base Actor entity by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */


import { isTransferEffectActive } from "../active-effects/transfer.js";
import { evaluateAEModifierKeys } from "../active-effects/modifier-evaluator.js";
import { applyTraitDerived, collectTraitDamageModifiers, getResistanceKeyForTraitType, getActorTraitValue, isActorUndead } from "../traits/trait-registry.js";
import { hasTalent } from "../traits/talents-api.js";
import { isNPC } from "../rules/npc-rules.js";
import { ensureSystemData } from "../actors/prepare/ensure-system-data.js";
import { prepareCharacterData } from "../actors/prepare/character.js";
import { prepareNPCData } from "../actors/prepare/npc.js";
import { prepareGroupData } from "../actors/prepare/group.js";
import { prepareWarfareUnitData } from "../actors/prepare/warfare-unit.js";
import { aggregateItemStats } from "../actors/rules/item-aggregation.js";
import { getArmorMobilityPenalties, flyCalc } from "../actors/rules/armor-mobility.js";
import { isShieldItem } from "../items/shield-utils.js";
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

/** Item types that carry a TN via baseCha and implement _prepareCombatStyleData. */
const TN_ITEM_TYPES = new Set(["skill", "combatStyle", "magicSkill"]);
let _coreSkillsCachePromise = null;

async function _getCoreSkillSourcesSorted() {
  if (_coreSkillsCachePromise) return _coreSkillsCachePromise;

  _coreSkillsCachePromise = (async () => {
    const skillPack = game.packs.get("uesrpg-3ev4.core-skills");
    if (!skillPack) {
      console.warn("uesrpg-3ev4 | Core skills compendium pack not found; skipping skill pre-population.");
      return [];
    }
    const collection = await skillPack.getDocuments();
    collection.sort((a, b) => a.name.localeCompare(b.name));
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
    this._uesrpgPrepareCtx = null;
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
    if (this._uesrpgPrepareCtx) return this._uesrpgPrepareCtx;

    const items = Array.from(this?.items?.contents ?? this?.items ?? []);
    const equippedItems = items.filter(item => item?.system?.equipped === true);
    const talents = items.filter(item => item?.type === "talent");
    const traitsAndTalents = items.filter(item => item && (item.type === "trait" || item.type === "talent"));
    const talentSlugSet = new Set();
    for (const t of talents) {
      const sys = t?.system ?? {};
      const slug = String(sys.slug ?? sys.key ?? sys.id ?? "").trim().toLowerCase();
      const name = String(t?.name ?? "").trim().toLowerCase().replace(/\s+/g, "");
      if (slug) talentSlugSet.add(slug);
      if (name) talentSlugSet.add(name);
    }

    this._uesrpgPrepareCtx = { items, equippedItems, talents, traitsAndTalents, talentSlugSet };
    return this._uesrpgPrepareCtx;
  }

  _hasTalentCached(key) {
    const k = String(key ?? "").trim().toLowerCase();
    if (!k) return false;
    const normalized = k.replace(/\s+/g, "");
    const set = this._getPrepareCtx()?.talentSlugSet;
    if (set instanceof Set) {
      if (set.has(k) || set.has(normalized)) return true;
    }
    try { return hasTalent(this, key); } catch (_e) { return false; }
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
    // Can't add self
    if (actorUuid === this.uuid) return true;

    // Recursively check if actorUuid contains this group
    const checkActor = async (uuid, visited = new Set()) => {
      if (visited.has(uuid)) return false;
      visited.add(uuid);

      const actor = await fromUuid(uuid);
      if (!actor || actor.type !== 'Group') return false;

      for (const member of actor.system.members || []) {
        if (member.id === this.uuid) return true;
        if (await checkActor(member.id, visited)) return true;
      }

      return false;
    };

    return checkActor(actorUuid);
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
    const items = this._getPrepareCtx().items;
    const attribute = items.filter(item => item?.system?.halfSpeed === true);
    let speed = Number(actorData?.system?.speed?.base ?? 0);
    if (attribute.length >= 1) speed = Math.ceil(speed / 2);

    // Wall of Steel (Chapter 4): ignore speed penalty from any armor worn.
    // Current system models an explicit -1 Speed penalty for tower shields in this method;
    // armor weight-class speed penalties are tracked elsewhere. Apply the RAW override to this lane.
    let ignoreArmorSpeedPenalty = false;
    try { ignoreArmorSpeedPenalty = this._hasTalentCached("wallofsteel"); } catch (_e) { ignoreArmorSpeedPenalty = false; }
    const hasTowerShield = items.some(item => {
      if (!item || !isShieldItem(item, { allowLegacy: true })) return false;
      const sys = item.system ?? {};
      if (sys.equipped !== true) return false;
      return String(sys.shieldType ?? "normal").toLowerCase() === "tower";
    });
    if (!ignoreArmorSpeedPenalty && hasTowerShield) speed = Math.max(0, speed - 1);
    return speed;
  }

  _iniCalc(actorData) {
    const attribute = this._getPrepareCtx().traitsAndTalents;
    let init = Number(actorData?.system?.initiative?.base ?? 0);
    const validChars = ["str", "end", "agi", "int", "wp", "prc", "prs", "lck"];
    const chaCalc = (ch) => Math.floor(this._getCharacteristicTotal(actorData, ch) / 10) * 3;

    // Rule Element: overrideValue for initiative characteristic replacement.
    const reIniChar = actorData?.system?._reOverrides?.["system.initiative.replaceCharacteristic"] ?? null;
    if (reIniChar && reIniChar !== "none") {
      const ch = String(reIniChar).toLowerCase();
      if (validChars.includes(ch)) return chaCalc(ch);
    }

    for (const item of attribute) {
      if (item?.system?.replace?.ini && item.system.replace.ini.characteristic !== "none") {
        const ch = item.system.replace.ini.characteristic;
        if (validChars.includes(ch)) init = chaCalc(ch);
      }
    }
    return init;
  }

  _woundThresholdCalc(actorData) {
    const attribute = this._getPrepareCtx().traitsAndTalents;
    let wound = Number(actorData?.system?.wound_threshold?.base ?? 0);
    const validChars = ["str", "end", "agi", "int", "wp", "prc", "prs", "lck"];
    const chaCalc = (ch) => Math.floor(this._getCharacteristicTotal(actorData, ch) / 10) * 3;

    // Rule Element: overrideValue for wound threshold characteristic replacement.
    const reWtChar = actorData?.system?._reOverrides?.["system.wound_threshold.replaceCharacteristic"] ?? null;
    if (reWtChar && reWtChar !== "none") {
      const ch = String(reWtChar).toLowerCase();
      if (validChars.includes(ch)) return chaCalc(ch);
    }

    for (const item of attribute) {
      if (item?.system?.replace?.wt && item.system.replace.wt.characteristic !== "none") {
        const ch = item.system.replace.wt.characteristic;
        if (validChars.includes(ch)) wound = chaCalc(ch);
      }
    }
    return wound;
  }

  _calcFatiguePenalty(actorData) {
    const attribute = this._getPrepareCtx().items.filter(item => item?.system?.halfFatiguePenalty === true);
    let penalty = 0;
    // Enduring (Chapter 4): halve penalties imposed by levels of fatigue.
    let hasEnduring = false;
    try { hasEnduring = this._hasTalentCached("enduring"); } catch (_e) { hasEnduring = false; }
    // Rule Element: booleanFlag halfFatiguePenalty via passive RE.
    const reHalfFatigue = Boolean(actorData?.system?._reFlags?.halfFatiguePenalty);
    if (attribute.length >= 1 || hasEnduring || reHalfFatigue) {
      penalty = Number(actorData?.system?.fatigue?.level || 0) * -5;
    } else {
      penalty = Number(actorData?.system?.fatigue?.level || 0) * -10;
    }
    return penalty
  }

  _halfWoundPenalty(actorData) {
    const hasItem = this._getPrepareCtx().items.some(item => item?.system?.halfWoundPenalty === true);
    // Unstoppable (Chapter 4): halve the passive effects of wounds.
    let hasUnstoppable = false;
    try { hasUnstoppable = this._hasTalentCached("unstoppable"); } catch (_e) { hasUnstoppable = false; }
    // Rule Element: booleanFlag halfWoundPenalty via passive RE.
    const reHalfWound = Boolean(actorData?.system?._reFlags?.halfWoundPenalty);
    return hasItem || hasUnstoppable || reHalfWound;
  }

  _determineIbMp(actorData) {
    const actorIntBonus = Number(actorData?.system?.characteristics?.int?.bonus || 0);
    let total = 0;

    // Item-based Power Well (legacy: addIBToMP checkbox on talent/trait items).
    let addIbItems = this._getPrepareCtx().items.filter(item => item?.system?.addIBToMP === true);
    if (addIbItems.length >= 1) {
      total = addIbItems.reduce(
        (acc, item) => actorIntBonus * Number(item?.system?.addIntToMPMultiplier || 0) + acc,
        0
      );
    }

    // Depth of Understanding (Chapter 4): grants Power Well (IB × 5) trait.
    // RAW: "The character gains the Power Well (IB × 5) Trait."
    // Coded directly to avoid requiring a manual Power Well item on the character.
    try {
      if (this._hasTalentCached("depthofunderstanding")) {
        total += actorIntBonus * 5;
      }
    } catch (_e) { /* graceful degradation during init */ }

    return total;
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
    const out = new Set();
    const effects = actorData?.effects?.contents ?? actorData?.effects ?? [];
    for (const e of effects) {
      const flagged = e?.getFlag?.("uesrpg-3ev4", "condition") ?? e?.flags?.["uesrpg-3ev4"]?.condition ?? null;
      const key = flagged?.key ? String(flagged.key).trim().toLowerCase() : "";
      if (key) out.add(key);

      // Fallback: some conditions may exist as named effects without our flags.
      const nm = String(e?.name ?? "").trim().toLowerCase();
      if (nm) {
        const first = nm.split("(")[0].trim().split(/\s+/)[0];
        if (first) out.add(first);
      }
    }
    return out;
  }

  /**
   * Chapter 5 (Package 4): enforce movement restriction semantics via derived Speed.
   * This does not block token movement in the canvas; it deterministically adjusts derived speed values.
   */
  _applyMovementRestrictionSemantics(actorData, actorSystemData) {
    try {
      if (!actorSystemData?.speed) return;

      const keys = this._getUesConditionKeySet(actorData);

      const clamp = (n) => {
        const v = Number(n);
        return Number.isFinite(v) ? Math.max(0, v) : 0;
      };

      let ground = clamp(actorSystemData.speed.value);
      let swim = clamp(actorSystemData.speed.swimSpeed);
      let fly = clamp(actorSystemData.speed.flySpeed);

      const immobile = keys.has("immobilized") || keys.has("restrained") || keys.has("paralyzed") || keys.has("unconscious");
      if (immobile) {
        ground = 0;
        swim = 0;
        fly = 0;
      } else {
        // Slowed / Entangled: halve (round up)
        if (keys.has("slowed")) {
          ground = Math.ceil(ground / 2);
          swim = Math.ceil(swim / 2);
          fly = Math.ceil(fly / 2);
        }
        if (keys.has("entangled")) {
          ground = Math.ceil(ground / 2);
          swim = Math.ceil(swim / 2);
          fly = Math.ceil(fly / 2);
        }

        // Prone: movement costs double, so effective ground speed is halved (round down).
        if (keys.has("prone")) {
          ground = Math.floor(ground / 2);
        }

        // Hidden: movement costs double, so effective movement speeds are halved (round down).
        if (keys.has("hidden")) {
          ground = Math.floor(ground / 2);
          swim = Math.floor(swim / 2);
          fly = Math.floor(fly / 2);
        }
      }

      actorSystemData.speed.value = ground;
      actorSystemData.speed.swimSpeed = swim;

      // Some actors may not define flySpeed in their schema; guard defensively.
      if (Object.prototype.hasOwnProperty.call(actorSystemData.speed, "flySpeed")) {
        actorSystemData.speed.flySpeed = fly;
      }
    } catch (err) {
      console.warn("uesrpg-3ev4 | Movement restriction semantics failed", err);
    }
  }

  _addHalfSpeed(actorData) {
    const items = this._getPrepareCtx().items;
    let halfSpeedItems = items.filter(item => item?.system?.addHalfSpeed === true);
    let isWereCroc = items.filter(item => item?.system?.shiftFormStyle === "shiftFormWereCrocodile");
    let speed = Number(actorData?.system?.speed?.value || 0);
    if (isWereCroc.length > 0 && halfSpeedItems.length > 0) {
      speed = Number(actorData?.system?.speed?.base || 0);
    } else if (isWereCroc.length === 0 && halfSpeedItems.length > 0) {
      speed = Math.ceil(Number(actorData?.system?.speed?.value || 0)/2) + Number(actorData?.system?.speed?.base || 0);
    } else if (isWereCroc.length > 0 && halfSpeedItems.length === 0) {
      speed = Math.ceil(Number(actorData?.system?.speed?.base || 0)/2);
    } else {
      speed = Number(actorData?.system?.speed?.value || 0);
    }
    return speed
  }

  /**
   * Apply damage to this actor with automatic reductions and tracking
   * @param {number} damage - Raw damage amount
   * @param {string} damageType - Type of damage (physical, fire, frost, etc.)
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Damage application result
   */
  async applyDamage(damage, damageType = 'physical', options = {}) {
    // Import damage automation module dynamically to avoid circular dependencies
    const { applyDamage: applyDamageFunc } = await import('../combat/damage-automation.js');
    return await applyDamageFunc(this, damage, damageType, options);
  }

  /**
   * Apply healing to this actor
   * @param {number} healing - Amount of HP to restore
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Healing result
   */
  async applyHealing(healing, options = {}) {
    const { applyHealing: applyHealingFunc } = await import('../combat/damage-automation.js');
    return await applyHealingFunc(this, healing, options);
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
