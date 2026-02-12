/**
 * Extend the base Actor entity by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */


import { isTransferEffectActive } from "../active-effects/transfer.js";
import { evaluateAEModifierKeys } from "../active-effects/modifier-evaluator.js";
import { applyTraitDerived, collectTraitDamageModifiers, getResistanceKeyForTraitType, getActorTraitValue, isActorUndead } from "../traits/trait-registry.js";
import { hasTalent } from "../traits/talents-api.js";
import { isNPC } from "../rules/npc-rules.js";
import { ensureSystemData, applyLegacyCharacteristicBonuses } from "../actors/prepare/ensure-system-data.js";
import { prepareCharacterData } from "../actors/prepare/character.js";
import { prepareNPCData } from "../actors/prepare/npc.js";
import { prepareGroupData } from "../actors/prepare/group.js";
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

    
    // Preps and adds standard skill items to Character types
    await super._preCreate(data, options, user);
    if (this.type === 'Player Character') {
      let skillPack = game.packs.get("uesrpg-3ev4.core-skills");
      let collection = await skillPack.getDocuments();
      collection.sort(function (a, b) {
        let nameA = a.name.toUpperCase();
        let nameB = b.name.toUpperCase();
        if (nameA < nameB) {
          return -1;
        } if (nameA > nameB) {
          return 1;
        }
        return 0
      });

      this.updateSource({
        _id: this._id,
        items: collection.map(i => i.toObject()),
        'system.size': 'standard'
      })
    }
  }
  prepareData() {
    super.prepareData();

    // Ensure required data structures exist so downstream derived-data logic is resilient,
    // even when actors are partially migrated or have inconsistent embedded item data.
    this._ensureSystemData();

    // Apply legacy characteristic bonuses from talents/traits/powers
    this._applyLegacyCharacteristicBonuses();

    try {
      const actorData = this;

      if (actorData.type === "Player Character" && typeof this._prepareCharacterData === "function") {
        this._prepareCharacterData(actorData);
      } else if (actorData.type === "NPC" && typeof this._prepareNPCData === "function") {
        this._prepareNPCData(actorData);
      } else if (actorData.type === "Group" && typeof this._prepareGroupData === "function") {
        this._prepareGroupData(actorData);
      }
    } catch (err) {
      console.error(`uesrpg-3ev4 | Error during prepareData for ${this.name || this.id}:`, err);
      // Re-ensure minimum safe defaults after a failure to prevent cascading errors in rendering.
      this._ensureSystemData();
    }
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
   * Apply legacy characteristic bonuses from talents/traits/powers.
   * This ensures items with characteristicBonus fields apply their effects.
   */
  _applyLegacyCharacteristicBonuses() {
    applyLegacyCharacteristicBonuses(this);
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
   * Repair Frenzied effects that have empty changes arrays.
   * This ensures effects created before fixes were applied get their changes populated.
   * 
   * NOTE: This should NOT be called during prepareData as it can cause timing issues.
   * Use the hook-based repair mechanism in frenzied.js instead.
   */
  _repairFrenziedEffectsIfNeeded() {
    // Defer to next tick to avoid prepareData timing issues
    setTimeout(() => {
      try {
        const frenziedEffects = Array.from(this.effects ?? []).filter(e => {
          const isFrenzied = e?.flags?.["uesrpg-3ev4"]?.condition?.key === "frenzied" ||
                             e?.flags?.core?.statusId === "frenzied";
          return isFrenzied && (!Array.isArray(e.changes) || e.changes.length === 0);
        });

        if (frenziedEffects.length > 0) {
          // Import the frenzied module dynamically to avoid circular dependencies
          import("../conditions/frenzied.js").then(({ _mkFrenziedChanges }) => {
            for (const effect of frenziedEffects) {
              try {
                const changes = _mkFrenziedChanges(this);
                const changesToApply = changes.map(c => ({
                  key: String(c.key ?? ""),
                  mode: Number(c.mode ?? CONST.ACTIVE_EFFECT_MODES.ADD),
                  value: String(c.value ?? ""),
                  priority: Number(c.priority ?? 20)
                }));

                if (changesToApply.length > 0) {
                  // Use update without diff to force the changes
                  effect.update({ changes: changesToApply }, { diff: false }).catch(err => {
                    console.warn("UESRPG | Failed to repair Frenzied effect", { effectId: effect.id, err });
                  });
                }
              } catch (err) {
                console.warn("UESRPG | Error generating changes for Frenzied effect repair", { effectId: effect.id, err });
              }
            }
          }).catch(err => {
            console.warn("UESRPG | Failed to import frenzied module for repair", err);
          });
        }
      } catch (err) {
        // Silently fail - this is a repair mechanism, not critical path
        console.debug("UESRPG | Frenzied effect repair check failed", err);
      }
    }, 0);
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

  _calculateENC(actorData) {
    let weighted = (actorData.items || []).filter(item => item?.system && Object.prototype.hasOwnProperty.call(item.system, "enc"));
    let totalWeight = 0.0;
    for (let item of weighted) {
      let containerAppliedENC = item.type == 'container' ? (item?.system?.container_enc?.applied_enc ? Number(item.system.container_enc.applied_enc) : 0) : 0
      let containedItemReduction = item.type != 'container' && item?.system?.containerStats?.contained ? (Number(item?.system?.enc || 0) * Number(item?.system?.quantity || 0)) : 0
      totalWeight = totalWeight + (Number(item?.system?.enc || 0) * Number(item?.system?.quantity || 0)) + containerAppliedENC - containedItemReduction;
    }
    return totalWeight
  }


  _armorWeight(actorData) {
    const itemsRaw = actorData?.items;
    const items = Array.isArray(itemsRaw) ? itemsRaw : (itemsRaw ? Array.from(itemsRaw) : []);

    const wornArmor = items.filter(item => {
      if (item?.type !== "armor") return false;
      const sys = item.system ?? {};
      if (sys.equipped !== true) return false;
      const isShield = Boolean(sys?.isShieldEffective ?? sys?.isShield);
      return !isShield;
    });

    let armorENC = 0;
    for (const item of wornArmor) {
      const sys = item.system ?? {};
      const enc = Number(sys.enc ?? 0);
      const qty = Number(sys.quantity ?? 0);
      armorENC += ((enc / 2) * qty);
    }
    return armorENC;
  }

  _excludeENC(actorData) {
    let excluded = (actorData.items || []).filter(item => item?.system && item.system.excludeENC == true);
    let totalWeight = 0.0;
    for (let item of excluded) {
      totalWeight = totalWeight + (Number(item?.system?.enc || 0) * Number(item?.system?.quantity || 0));
    }
    return totalWeight
  }

  _speedCalc(actorData) {
    const itemsRaw = actorData?.items;
    const items = Array.isArray(itemsRaw) ? itemsRaw : (itemsRaw ? Array.from(itemsRaw) : []);
    const attribute = items.filter(item => item?.system?.halfSpeed === true);
    let speed = Number(actorData?.system?.speed?.base ?? 0);
    if (attribute.length >= 1) speed = Math.ceil(speed / 2);

    // Wall of Steel (Chapter 4): ignore speed penalty from any armor worn.
    // Current system models an explicit -1 Speed penalty for tower shields in this method;
    // armor weight-class speed penalties are tracked elsewhere. Apply the RAW override to this lane.
    let ignoreArmorSpeedPenalty = false;
    try { ignoreArmorSpeedPenalty = hasTalent(this, "wallofsteel"); } catch (_e) { ignoreArmorSpeedPenalty = false; }
    const hasTowerShield = items.some(item => {
      if (!item || item.type !== "armor") return false;
      const sys = item.system ?? {};
      if (sys.equipped !== true) return false;
      const isShield = Boolean(sys.isShieldEffective ?? sys.isShield);
      if (!isShield && String(sys.item_cat ?? "").toLowerCase() !== "shield") return false;
      return String(sys.shieldType ?? "normal").toLowerCase() === "tower";
    });
    if (!ignoreArmorSpeedPenalty && hasTowerShield) speed = Math.max(0, speed - 1);
    return speed;
  }

  _iniCalc(actorData) {
    const itemsRaw = actorData?.items;
    const items = Array.isArray(itemsRaw) ? itemsRaw : (itemsRaw ? Array.from(itemsRaw) : []);
    const attribute = items.filter(item => item && (item.type === "trait" || item.type === "talent"));
    let init = Number(actorData?.system?.initiative?.base ?? 0);

    // Rule Element: overrideValue for initiative characteristic replacement.
    const reIniChar = actorData?.system?._reOverrides?.["system.initiative.replaceCharacteristic"] ?? null;
    if (reIniChar && reIniChar !== "none") {
      const ch = String(reIniChar).toLowerCase();
      const validChars = ["str", "end", "agi", "int", "wp", "prc", "prs", "lck"];
      if (validChars.includes(ch)) {
        return Math.floor(this._getCharacteristicTotal(actorData, ch) / 10) * 3;
      }
    }

    for (let item of attribute) {
      if (item?.system?.replace?.ini && item.system.replace.ini.characteristic !== "none") {
        const ch = item.system.replace.ini.characteristic;
        if (ch === "str") init = Math.floor(this._getCharacteristicTotal(actorData, "str") / 10) * 3;
        else if (ch === "end") init = Math.floor(this._getCharacteristicTotal(actorData, "end") / 10) * 3;
        else if (ch === "agi") init = Math.floor(this._getCharacteristicTotal(actorData, "agi") / 10) * 3;
        else if (ch === "int") init = Math.floor(this._getCharacteristicTotal(actorData, "int") / 10) * 3;
        else if (ch === "wp") init = Math.floor(this._getCharacteristicTotal(actorData, "wp") / 10) * 3;
        else if (ch === "prc") init = Math.floor(this._getCharacteristicTotal(actorData, "prc") / 10) * 3;
        else if (ch === "prs") init = Math.floor(this._getCharacteristicTotal(actorData, "prs") / 10) * 3;
        else if (ch === "lck") init = Math.floor(this._getCharacteristicTotal(actorData, "lck") / 10) * 3;
      }
    }
    return init;
  }

  _woundThresholdCalc(actorData) {
    const itemsRaw = actorData?.items;
    const items = Array.isArray(itemsRaw) ? itemsRaw : (itemsRaw ? Array.from(itemsRaw) : []);
    const attribute = items.filter(item => item && (item.type === "trait" || item.type === "talent"));
    let wound = Number(actorData?.system?.wound_threshold?.base ?? 0);

    // Rule Element: overrideValue for wound threshold characteristic replacement.
    const reWtChar = actorData?.system?._reOverrides?.["system.wound_threshold.replaceCharacteristic"] ?? null;
    if (reWtChar && reWtChar !== "none") {
      const ch = String(reWtChar).toLowerCase();
      const validChars = ["str", "end", "agi", "int", "wp", "prc", "prs", "lck"];
      if (validChars.includes(ch)) {
        return Math.floor(this._getCharacteristicTotal(actorData, ch) / 10) * 3;
      }
    }

    for (let item of attribute) {
      if (item?.system?.replace?.wt && item.system.replace.wt.characteristic !== "none") {
        const ch = item.system.replace.wt.characteristic;
        if (ch === "str") wound = Math.floor(this._getCharacteristicTotal(actorData, "str") / 10) * 3;
        else if (ch === "end") wound = Math.floor(this._getCharacteristicTotal(actorData, "end") / 10) * 3;
        else if (ch === "agi") wound = Math.floor(this._getCharacteristicTotal(actorData, "agi") / 10) * 3;
        else if (ch === "int") wound = Math.floor(this._getCharacteristicTotal(actorData, "int") / 10) * 3;
        else if (ch === "wp") wound = Math.floor(this._getCharacteristicTotal(actorData, "wp") / 10) * 3;
        else if (ch === "prc") wound = Math.floor(this._getCharacteristicTotal(actorData, "prc") / 10) * 3;
        else if (ch === "prs") wound = Math.floor(this._getCharacteristicTotal(actorData, "prs") / 10) * 3;
        else if (ch === "lck") wound = Math.floor(this._getCharacteristicTotal(actorData, "lck") / 10) * 3;
      }
    }
    return wound;
  }

  _calcFatiguePenalty(actorData) {
    let attribute = (actorData.items || []).filter(item => item?.system?.halfFatiguePenalty == true);
    let penalty = 0;
    // Enduring (Chapter 4): halve penalties imposed by levels of fatigue.
    let hasEnduring = false;
    try { hasEnduring = hasTalent(this, "enduring"); } catch (_e) { hasEnduring = false; }
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
    let attribute = (actorData.items || []).filter(item => item?.system?.halfWoundPenalty == true);
    let woundReduction = false;
    // Unstoppable (Chapter 4): halve the passive effects of wounds.
    let hasUnstoppable = false;
    try { hasUnstoppable = hasTalent(this, "unstoppable"); } catch (_e) { hasUnstoppable = false; }
    // Rule Element: booleanFlag halfWoundPenalty via passive RE.
    const reHalfWound = Boolean(actorData?.system?._reFlags?.halfWoundPenalty);
    if (attribute.length >= 1 || hasUnstoppable || reHalfWound) {
      woundReduction = true;
    } else {
      woundReduction = false;
    }
    return woundReduction
  }

  _determineIbMp(actorData) {
    const actorIntBonus = Number(actorData?.system?.characteristics?.int?.bonus || 0);
    let total = 0;

    // Item-based Power Well (legacy: addIBToMP checkbox on talent/trait items).
    let addIbItems = (actorData.items || []).filter(item => item?.system?.addIBToMP == true);
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
      if (hasTalent(this, "depthofunderstanding")) {
        total += actorIntBonus * 5;
      }
    } catch (_e) { /* graceful degradation during init */ }

    return total;
  }
  _untrainedException(actorData) {
    const items = actorData.items || [];
    const attribute = items.filter(item => item?.system?.untrainedException == true);

    // Chapter 4 (Arms Master): ignore the usual -20 untrained penalty for Combat Styles.
    const hasArmsMaster = Array.isArray(items) && items.some((i) => {
      if (String(i?.type ?? "") !== "talent") return false;
      const slug = String(i?.system?.slug ?? i?.system?.key ?? i?.system?.id ?? "").toLowerCase();
      const name = String(i?.name ?? "").toLowerCase();
      return slug === "armsmaster" || name === "arms master";
    });

    return (attribute.length >= 1 || hasArmsMaster) ? 20 : 0;
  }

  _isMechanical(actorData) {
    let attribute = (actorData.items || []).filter(item => item?.system?.mechanical == true);
    let isMechanical = false;
    if (attribute.length >= 1) {
      isMechanical = true;
    } else {
      isMechanical = false;
    }
    return isMechanical
  }

  _dwemerSphere(actorData) {
    let attribute = (actorData.items || []).filter(item => item?.system?.shiftForm == true);
    let shift = false;
    if (attribute.length >= 1) {
      for (let item of attribute) {
        if (item?.system?.dailyUse == true) {
          shift = true;
        }
      }
    } else {
      shift = false;
    }
    return shift
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
    let attribute = (actorData.items || []).filter(item => item?.system?.painIntolerant == true);
    let pain = false;
    if (attribute.length >= 1) {
      pain = true;
    }
    return pain
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
    let halfSpeedItems = (actorData.items || []).filter(item => item?.system?.addHalfSpeed === true);
    let isWereCroc = (actorData.items || []).filter(item => item?.system?.shiftFormStyle === "shiftFormWereCrocodile");
    let speed = Number(actorData?.system?.speed?.value || 0);
    if (isWereCroc.length > 0 && halfSpeedItems.length > 0) {
      speed = Number(actorData?.system?.speed?.base || 0);
    } else if (isWereCroc.length == 0 && halfSpeedItems.length > 0) {
      speed = Math.ceil(Number(actorData?.system?.speed?.value || 0)/2) + Number(actorData?.system?.speed?.base || 0);
    } else if (isWereCroc.length > 0 && halfSpeedItems.length == 0) {
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
