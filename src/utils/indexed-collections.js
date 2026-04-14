/**
 * Indexed collection classes for optimized item and effect lookups.
 * 
 * These classes maintain indexes (Maps) for O(1) lookups by various keys,
 * reducing the need for linear scans through large arrays.
 * 
 * @module indexed-collections
 */

/**
 * ItemCollection maintains indexes for actor items for fast lookups.
 * 
 * Indexes:
 * - byId: Map<item._id -> item>
 * - byType: Map<item.type -> Set<item>>
 * - byName: Map<normalizedName -> item> (for talents, skills, etc.)
 * - bySystemKey: Map<system.key -> item> (for talents with key property)
 * 
 * Usage:
 * const collection = new ItemCollection(actor.items);
 * const talent = collection.getTalentByKey('swashbuckler');
 * const weapons = collection.getByType('weapon');
 */
export class ItemCollection {
  constructor(items = []) {
    this.items = Array.isArray(items) ? items : [];
    this.byId = new Map();
    this.byType = new Map();
    this.byName = new Map();
    this.bySystemKey = new Map();
    this.talentSlugSet = new Set();
    
    this._buildIndexes();
  }
  
  /**
   * Build all indexes from current items.
   * @private
   */
  _buildIndexes() {
    this.byId.clear();
    this.byType.clear();
    this.byName.clear();
    this.bySystemKey.clear();
    this.talentSlugSet.clear();
    
    for (const item of this.items) {
      if (!item) continue;
      
      // Index by ID
      if (item._id) {
        this.byId.set(item._id, item);
      }
      
      // Index by type
      if (item.type) {
        if (!this.byType.has(item.type)) {
          this.byType.set(item.type, new Set());
        }
        this.byType.get(item.type).add(item);
      }
      
      // Index by normalized name
      if (item.name) {
        const normalizedName = this._normalizeKey(item.name);
        this.byName.set(normalizedName, item);
        
        // Special handling for talents
        if (item.type === 'talent') {
          this.talentSlugSet.add(normalizedName);
          
          // Also index by system.key if present
          if (item.system?.key) {
            const key = this._normalizeKey(item.system.key);
            this.bySystemKey.set(key, item);
            this.talentSlugSet.add(key);
          }
        }
      }
    }
  }
  
  /**
   * Normalize a key for case-insensitive comparison.
   * @private
   */
  _normalizeKey(key) {
    return String(key ?? '').trim().toLowerCase().replace(/\s+/g, '');
  }
  
  /**
   * Get item by ID.
   * @param {string} id - Item ID
   * @returns {Item|null}
   */
  getById(id) {
    return this.byId.get(id) || null;
  }
  
  /**
   * Get all items of a specific type.
   * @param {string} type - Item type
   * @returns {Item[]}
   */
  getByType(type) {
    const set = this.byType.get(type);
    return set ? Array.from(set) : [];
  }
  
  /**
   * Get item by normalized name.
   * @param {string} name - Item name
   * @returns {Item|null}
   */
  getByName(name) {
    const normalized = this._normalizeKey(name);
    return this.byName.get(normalized) || null;
  }
  
  /**
   * Get talent item by key (system.key or name).
   * @param {string} key - Talent key
   * @returns {Item|null}
   */
  getTalentByKey(key) {
    const normalized = this._normalizeKey(key);
    
    // Try system.key index first
    const bySystemKey = this.bySystemKey.get(normalized);
    if (bySystemKey) return bySystemKey;
    
    // Try name index
    return this.getByName(key);
  }
  
  /**
   * Check if actor has a talent by key.
   * @param {string} key - Talent key
   * @returns {boolean}
   */
  hasTalent(key) {
    const normalized = this._normalizeKey(key);
    return this.talentSlugSet.has(normalized);
  }
  
  /**
   * Get all talents.
   * @returns {Item[]}
   */
  getTalents() {
    return this.getByType('talent');
  }
  
  /**
   * Get all equipped items.
   * @returns {Item[]}
   */
  getEquippedItems() {
    return this.items.filter(item => item?.system?.equipped === true);
  }
  
  /**
   * Get items matching a predicate with early exit.
   * @param {Function} predicate - (item) -> boolean
   * @param {Object} options - Options
   * @param {boolean} options.returnFirst - Return first match (default: false)
   * @param {number} options.maxScan - Maximum items to scan (default: all)
   * @returns {Item|Item[]|null}
   */
  find(predicate, options = {}) {
    const { returnFirst = false, maxScan = Infinity } = options;
    
    const results = returnFirst ? null : [];
    const limit = Math.min(this.items.length, maxScan);
    
    for (let i = 0; i < limit; i++) {
      const item = this.items[i];
      if (item && predicate(item)) {
        if (returnFirst) {
          return item;
        }
        results.push(item);
      }
    }
    
    return results;
  }
  
  /**
   * Update the collection with new items.
   * @param {Item[]} items - New items array
   */
  update(items) {
    this.items = Array.isArray(items) ? items : [];
    this._buildIndexes();
  }
  
  /**
   * Add a single item to the collection.
   * @param {Item} item - Item to add
   */
  add(item) {
    if (!item) return;
    
    this.items.push(item);
    
    // Update indexes
    if (item._id) {
      this.byId.set(item._id, item);
    }
    
    if (item.type) {
      if (!this.byType.has(item.type)) {
        this.byType.set(item.type, new Set());
      }
      this.byType.get(item.type).add(item);
    }
    
    if (item.name) {
      const normalizedName = this._normalizeKey(item.name);
      this.byName.set(normalizedName, item);
      
      if (item.type === 'talent') {
        this.talentSlugSet.add(normalizedName);
        
        if (item.system?.key) {
          const key = this._normalizeKey(item.system.key);
          this.bySystemKey.set(key, item);
          this.talentSlugSet.add(key);
        }
      }
    }
  }
  
  /**
   * Remove an item from the collection by ID.
   * @param {string} id - Item ID to remove
   */
  remove(id) {
    const item = this.byId.get(id);
    if (!item) return;
    
    // Remove from items array
    const index = this.items.findIndex(i => i._id === id);
    if (index !== -1) {
      this.items.splice(index, 1);
    }
    
    // Remove from indexes
    this.byId.delete(id);
    
    if (item.type) {
      const set = this.byType.get(item.type);
      if (set) {
        set.delete(item);
        if (set.size === 0) {
          this.byType.delete(item.type);
        }
      }
    }
    
    if (item.name) {
      const normalizedName = this._normalizeKey(item.name);
      this.byName.delete(normalizedName);
      
      if (item.type === 'talent') {
        this.talentSlugSet.delete(normalizedName);
        
        if (item.system?.key) {
          const key = this._normalizeKey(item.system.key);
          this.bySystemKey.delete(key);
          this.talentSlugSet.delete(key);
        }
      }
    }
  }
  
  /**
   * Get statistics about the collection.
   * @returns {Object}
   */
  getStats() {
    return {
      totalItems: this.items.length,
      byType: Object.fromEntries(
        Array.from(this.byType.entries()).map(([type, set]) => [type, set.size])
      ),
      talentCount: this.getTalents().length,
      equippedCount: this.getEquippedItems().length,
      indexSizes: {
        byId: this.byId.size,
        byType: this.byType.size,
        byName: this.byName.size,
        bySystemKey: this.bySystemKey.size,
        talentSlugSet: this.talentSlugSet.size
      }
    };
  }
}

/**
 * EffectCollection maintains indexes for active effects.
 * 
 * Indexes:
 * - byId: Map<effect._id -> effect>
 * - bySourceId: Map<sourceId -> Set<effect>> (source item/actor ID)
 * - byKey: Map<key -> effect> (for effects with uesrpg key)
 * - byFlag: Map<flagName -> Set<effect>> (for effects with specific flags)
 * 
 * Usage:
 * const collection = new EffectCollection(actor.effects);
 * const aimEffect = collection.getByKey('aim');
 * const itemEffects = collection.getBySourceId(itemId);
 */
export class EffectCollection {
  constructor(effects = []) {
    this.effects = Array.isArray(effects) ? effects : [];
    this.byId = new Map();
    this.bySourceId = new Map();
    this.byKey = new Map();
    this.byFlag = new Map();
    
    this._buildIndexes();
  }
  
  /**
   * Build all indexes from current effects.
   * @private
   */
  _buildIndexes() {
    this.byId.clear();
    this.bySourceId.clear();
    this.byKey.clear();
    this.byFlag.clear();
    
    for (const effect of this.effects) {
      if (!effect) continue;
      
      // Index by ID
      if (effect._id) {
        this.byId.set(effect._id, effect);
      }
      
      // Index by source ID
      const sourceId = effect.sourceId || effect.parent?.id;
      if (sourceId) {
        if (!this.bySourceId.has(sourceId)) {
          this.bySourceId.set(sourceId, new Set());
        }
        this.bySourceId.get(sourceId).add(effect);
      }
      
      // Index by uesrpg key
      const key = effect.flags?.['uesrpg-3ev4']?.key;
      if (key) {
        this.byKey.set(key, effect);
      }
      
      // Index by flags
      if (effect.flags) {
        for (const [namespace, flagObj] of Object.entries(effect.flags)) {
          if (typeof flagObj === 'object') {
            for (const [flagName, flagValue] of Object.entries(flagObj)) {
              if (flagValue !== undefined && flagValue !== null && flagValue !== false) {
                const flagKey = `${namespace}.${flagName}`;
                if (!this.byFlag.has(flagKey)) {
                  this.byFlag.set(flagKey, new Set());
                }
                this.byFlag.get(flagKey).add(effect);
              }
            }
          }
        }
      }
    }
  }
  
  /**
   * Get effect by ID.
   * @param {string} id - Effect ID
   * @returns {ActiveEffect|null}
   */
  getById(id) {
    return this.byId.get(id) || null;
  }
  
  /**
   * Get effects by source ID (item or actor ID).
   * @param {string} sourceId - Source ID
   * @returns {ActiveEffect[]}
   */
  getBySourceId(sourceId) {
    const set = this.bySourceId.get(sourceId);
    return set ? Array.from(set) : [];
  }
  
  /**
   * Get effect by uesrpg key.
   * @param {string} key - Effect key
   * @returns {ActiveEffect|null}
   */
  getByKey(key) {
    return this.byKey.get(key) || null;
  }
  
  /**
   * Get effects by flag.
   * @param {string} flag - Flag name (e.g., 'uesrpg-3ev4.key')
   * @returns {ActiveEffect[]}
   */
  getByFlag(flag) {
    const set = this.byFlag.get(flag);
    return set ? Array.from(set) : [];
  }
  
  /**
   * Get all enabled (non-disabled) effects.
   * @returns {ActiveEffect[]}
   */
  getEnabledEffects() {
    return this.effects.filter(effect => !effect.disabled);
  }
  
  /**
   * Get effects matching a predicate with early exit.
   * @param {Function} predicate - (effect) -> boolean
   * @param {Object} options - Options
   * @param {boolean} options.returnFirst - Return first match (default: false)
   * @param {number} options.maxScan - Maximum effects to scan (default: all)
   * @returns {ActiveEffect|ActiveEffect[]|null}
   */
  find(predicate, options = {}) {
    const { returnFirst = false, maxScan = Infinity } = options;
    
    const results = returnFirst ? null : [];
    const limit = Math.min(this.effects.length, maxScan);
    
    for (let i = 0; i < limit; i++) {
      const effect = this.effects[i];
      if (effect && predicate(effect)) {
        if (returnFirst) {
          return effect;
        }
        results.push(effect);
      }
    }
    
    return results;
  }
  
  /**
   * Update the collection with new effects.
   * @param {ActiveEffect[]} effects - New effects array
   */
  update(effects) {
    this.effects = Array.isArray(effects) ? effects : [];
    this._buildIndexes();
  }
  
  /**
   * Add a single effect to the collection.
   * @param {ActiveEffect} effect - Effect to add
   */
  add(effect) {
    if (!effect) return;
    
    this.effects.push(effect);
    
    // Update indexes
    if (effect._id) {
      this.byId.set(effect._id, effect);
    }
    
    const sourceId = effect.sourceId || effect.parent?.id;
    if (sourceId) {
      if (!this.bySourceId.has(sourceId)) {
        this.bySourceId.set(sourceId, new Set());
      }
      this.bySourceId.get(sourceId).add(effect);
    }
    
    const key = effect.flags?.['uesrpg-3ev4']?.key;
    if (key) {
      this.byKey.set(key, effect);
    }
    
    if (effect.flags) {
      for (const [namespace, flagObj] of Object.entries(effect.flags)) {
        if (typeof flagObj === 'object') {
          for (const [flagName, flagValue] of Object.entries(flagObj)) {
            if (flagValue !== undefined && flagValue !== null && flagValue !== false) {
              const flagKey = `${namespace}.${flagName}`;
              if (!this.byFlag.has(flagKey)) {
                this.byFlag.set(flagKey, new Set());
              }
              this.byFlag.get(flagKey).add(effect);
            }
          }
        }
      }
    }
  }
  
  /**
   * Remove an effect from the collection by ID.
   * @param {string} id - Effect ID to remove
   */
  remove(id) {
    const effect = this.byId.get(id);
    if (!effect) return;
    
    // Remove from effects array
    const index = this.effects.findIndex(e => e._id === id);
    if (index !== -1) {
      this.effects.splice(index, 1);
    }
    
    // Remove from indexes
    this.byId.delete(id);
    
    const sourceId = effect.sourceId || effect.parent?.id;
    if (sourceId) {
      const set = this.bySourceId.get(sourceId);
      if (set) {
        set.delete(effect);
        if (set.size === 0) {
          this.bySourceId.delete(sourceId);
        }
      }
    }
    
    const key = effect.flags?.['uesrpg-3ev4']?.key;
    if (key) {
      this.byKey.delete(key);
    }
    
    if (effect.flags) {
      for (const [namespace, flagObj] of Object.entries(effect.flags)) {
        if (typeof flagObj === 'object') {
          for (const [flagName] of Object.entries(flagObj)) {
            const flagKey = `${namespace}.${flagName}`;
            const set = this.byFlag.get(flagKey);
            if (set) {
              set.delete(effect);
              if (set.size === 0) {
                this.byFlag.delete(flagKey);
              }
            }
          }
        }
      }
    }
  }
  
  /**
   * Get statistics about the collection.
   * @returns {Object}
   */
  getStats() {
    return {
      totalEffects: this.effects.length,
      enabledEffects: this.getEnabledEffects().length,
      bySourceCount: this.bySourceId.size,
      byKeyCount: this.byKey.size,
      byFlagCount: this.byFlag.size,
      indexSizes: {
        byId: this.byId.size,
        bySourceId: this.bySourceId.size,
        byKey: this.byKey.size,
        byFlag: this.byFlag.size
      }
    };
  }
}

/**
 * Collection manager for actor data with automatic cache invalidation.
 * 
 * Maintains ItemCollection and EffectCollection for an actor and
 * provides methods for batch operations and cache management.
 */
export class ActorCollectionManager {
  constructor(actor) {
    this.actor = actor;
    this.items = new ItemCollection(actor?.items ?? []);
    this.effects = new EffectCollection(actor?.effects ?? []);
    this.lastUpdate = Date.now();
    this.updateCount = 0;
  }
  
  /**
   * Update all collections from the actor.
   */
  refresh() {
    if (!this.actor) return;
    
    this.items.update(this.actor.items ?? []);
    this.effects.update(this.actor.effects ?? []);
    this.lastUpdate = Date.now();
    this.updateCount++;
  }
  
  /**
   * Get talent by key with caching.
   * @param {string} key - Talent key
   * @returns {Item|null}
   */
  getTalent(key) {
    return this.items.getTalentByKey(key);
  }
  
  /**
   * Check if actor has talent with caching.
   * @param {string} key - Talent key
   * @returns {boolean}
   */
  hasTalent(key) {
    return this.items.hasTalent(key);
  }
  
  /**
   * Get effect by key with caching.
   * @param {string} key - Effect key
   * @returns {ActiveEffect|null}
   */
  getEffectByKey(key) {
    return this.effects.getByKey(key);
  }
  
  /**
   * Get effects by source item.
   * @param {Item} item - Source item
   * @returns {ActiveEffect[]}
   */
  getEffectsByItem(item) {
    if (!item?._id) return [];
    return this.effects.getBySourceId(item._id);
  }
  
  /**
   * Get all equipped items with caching.
   * @returns {Item[]}
   */
  getEquippedItems() {
    return this.items.getEquippedItems();
  }
  
  /**
   * Get items by type with caching.
   * @param {string} type - Item type
   * @returns {Item[]}
   */
  getItemsByType(type) {
    return this.items.getByType(type);
  }
  
  /**
   * Get statistics about all collections.
   * @returns {Object}
   */
  getStats() {
    return {
      actorId: this.actor?.id,
      actorName: this.actor?.name,
      lastUpdate: this.lastUpdate,
      updateCount: this.updateCount,
      items: this.items.getStats(),
      effects: this.effects.getStats()
    };
  }
}

/**
 * Global registry for actor collection managers.
 * Provides caching and reuse of collection managers.
 */
export class CollectionRegistry {
  constructor() {
    this.managers = new Map(); // actorId -> ActorCollectionManager
    this.hits = 0;
    this.misses = 0;
  }
  
  /**
   * Get or create collection manager for an actor.
   * @param {Actor} actor - The actor
   * @returns {ActorCollectionManager}
   */
  getManager(actor) {
    if (!actor?.id) {
      return new ActorCollectionManager(actor);
    }
    
    let manager = this.managers.get(actor.id);
    if (!manager || manager.actor !== actor) {
      manager = new ActorCollectionManager(actor);
      this.managers.set(actor.id, manager);
      this.misses++;
    } else {
      this.hits++;
    }
    
    return manager;
  }
  
  /**
   * Refresh manager for an actor.
   * @param {Actor} actor - The actor
   */
  refresh(actor) {
    if (!actor?.id) return;
    
    const manager = this.managers.get(actor.id);
    if (manager) {
      manager.refresh();
    }
  }
  
  /**
   * Remove manager for an actor.
   * @param {string} actorId - Actor ID
   */
  remove(actorId) {
    this.managers.delete(actorId);
  }
  
  /**
   * Clear all managers.
   */
  clear() {
    this.managers.clear();
    this.hits = 0;
    this.misses = 0;
  }
  
  /**
   * Get registry statistics.
   * @returns {Object}
   */
  getStats() {
    return {
      totalManagers: this.managers.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0
    };
  }
}

// Global singleton instance
export const globalCollectionRegistry = new CollectionRegistry();