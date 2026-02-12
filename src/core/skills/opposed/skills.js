/**
 * src/core/skills/opposed/skills.js
 * Skill selection and listing helpers
 */

import { _esc } from "./util.js";

/* ─── Characteristic pseudo-UUID helpers ──────────────────────────────────── */

const _CHA_KEYS = ["str", "end", "agi", "int", "wp", "prc", "prs", "lck"];
const _CHA_LABELS = {
  str: "Strength", end: "Endurance", agi: "Agility", int: "Intelligence",
  wp: "Willpower", prc: "Perception", prs: "Personality", lck: "Luck"
};

/**
 * Build a pseudo-skill item for a characteristic, suitable for computeSkillTN.
 * @param {Actor} actor
 * @param {string} chaKey  e.g. "str"
 * @returns {object|null}
 */
export function _buildCharacteristicPseudoItem(actor, chaKey) {
  if (!actor || !_CHA_LABELS[chaKey]) return null;
  const value = Number(actor.system?.characteristics?.[chaKey]?.total ?? 0);
  return {
    uuid: `cha:${chaKey}`,
    id: `cha:${chaKey}`,
    type: "characteristic",
    name: _CHA_LABELS[chaKey],
    system: { value },
    _characteristicKey: chaKey
  };
}

export function _hasSpecializations(skillItem) {
  const raw = String(skillItem?.system?.trainedItems ?? "").trim();
  return raw.length > 0;
}

export function _listSkills(actor, { allowCombatStyle = false } = {}) {
  const out = [];
  
  // Add ALL Combat Styles if allowed (not just active one)
  if (allowCombatStyle && actor?.type !== "NPC") {
    const combatStyles = actor?.itemTypes?.combatStyle ?? actor?.items?.filter(i => i.type === "combatStyle") ?? [];
    for (const cs of combatStyles) {
      out.push({ 
        uuid: cs.uuid, 
        name: `${cs.name} (Combat Style)`, 
        hasSpec: false, 
        isCombatStyle: true
      });
    }
  }
  
  const items = actor?.itemTypes?.skill ?? actor?.items?.filter(i => i.type === "skill") ?? [];
  for (const i of items) out.push({ uuid: i.uuid, name: i.name, item: i, hasSpec: _hasSpecializations(i) });

  if (actor?.type === "NPC") {
    const professions = _listProfessions(actor);
    
    // For NPCs with Combat Style allowed, add Combat profession at the top
    if (allowCombatStyle) {
      const combatProf = professions.find(p => p._professionKey === "combat");
      if (combatProf) {
        out.unshift({ 
          uuid: combatProf.uuid, 
          name: combatProf.name, 
          hasSpec: false, 
          isProfession: true,
          isCombatProfession: true
        });
      }
    }
    
    // Add remaining professions
    for (const p of professions) {
      if (p._professionKey !== "combat" || !allowCombatStyle) {
        out.push({ uuid: p.uuid, name: p.name, item: p, hasSpec: false, isProfession: true });
      }
    }
  }

  // Add characteristics for all actor types
  for (const chaKey of _CHA_KEYS) {
    const chaItem = _buildCharacteristicPseudoItem(actor, chaKey);
    if (chaItem) {
      out.push({
        uuid: chaItem.uuid,
        name: `${chaItem.name} (Characteristic)`,
        item: chaItem,
        hasSpec: false,
        isCharacteristic: true
      });
    }
  }

  return out;
}

export function _listProfessions(actor) {
  const out = [];
  const sys = actor?.system ?? {};
  const prof = sys?.professions ?? {};

  const labelFor = (key) => {
    if (key === "profession1" || key === "profession2" || key === "profession3") {
      const spec = String(sys?.skills?.[key]?.specialization ?? "").trim();
      return spec || key.replace("profession", "Profession ");
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  };

  for (const key of Object.keys(prof)) {
    out.push({
      uuid: `prof:${key}`,
      id: `prof:${key}`,
      type: "profession",
      name: labelFor(key),
      system: { value: Number(prof[key] ?? 0) },
      _professionKey: key
    });
  }
  return out;
}

export function _findSkillByUuid(actor, uuid) {
  if (!uuid) return null;
  
  // Handle characteristic pseudo-UUIDs (cha:key format)
  if (uuid.startsWith("cha:")) {
    const key = uuid.slice(4);
    return _buildCharacteristicPseudoItem(actor, key);
  }
  
  // Handle profession pseudo-UUIDs (prof:key format)
  if (uuid.startsWith("prof:")) {
    const key = uuid.slice(5);
    const sys = actor?.system ?? {};
    const value = Number(sys?.professions?.[key] ?? 0);
    
    if (value !== undefined && sys?.professions?.[key] !== undefined) {
      const labelFor = (k) => {
        if (k === "profession1" || k === "profession2" || k === "profession3") {
          const spec = String(sys?.skills?.[k]?.specialization ?? "").trim();
          return spec || k.replace("profession", "Profession ");
        }
        return k.charAt(0).toUpperCase() + k.slice(1);
      };
      
      return {
        uuid,
        id: uuid,
        type: "profession",
        name: labelFor(key),
        system: { value },
        _professionKey: key
      };
    }
  }
  
  // Handle regular skill items
  const items = actor?.itemTypes?.skill ?? actor?.items?.filter(i => i.type === "skill") ?? [];
  for (const i of items) {
    if (i.uuid === uuid) return i;
  }
  return null;
}

export function _resolveCombatStyleOrSkill(actor, skillUuid) {
  if (!skillUuid) return null;
  
  // Characteristic pseudo-UUID (cha:key format)
  if (skillUuid.startsWith("cha:")) {
    const key = skillUuid.slice(4);
    const item = _buildCharacteristicPseudoItem(actor, key);
    if (!item) return null;
    return {
      type: "characteristic",
      item,
      name: item.name,
      value: item.system?.value ?? 0,
      characteristicKey: key
    };
  }
  
  // Combat Style
  if (actor?.type !== "NPC") {
    const combatStyles = actor?.itemTypes?.combatStyle ?? actor?.items?.filter(i => i.type === "combatStyle") ?? [];
    const style = combatStyles.find(cs => cs.uuid === skillUuid);
    if (style) {
      return {
        type: "combatStyle",
        item: style,
        name: style.name,
        value: 0
      };
    }
  }
  
  // NPC profession (including combat)
  if (skillUuid.startsWith("prof:")) {
    const key = skillUuid.slice(5);
    const sys = actor?.system ?? {};
    const value = Number(sys?.professions?.[key] ?? 0);
    
    const labelFor = (k) => {
      if (k === "profession1" || k === "profession2" || k === "profession3") {
        const spec = String(sys?.skills?.[k]?.specialization ?? "").trim();
        return spec || k.replace("profession", "Profession ");
      }
      return k.charAt(0).toUpperCase() + k.slice(1);
    };
    
    const item = {
      uuid: skillUuid,
      id: skillUuid,
      type: "profession",
      name: labelFor(key),
      system: { value },
      _professionKey: key
    };
    
    return {
      type: "profession",
      item,
      name: item.name,
      value: item.system?.value ?? 0,
      professionKey: item._professionKey
    };
  }
  
  // Regular skill item
  const skillItem = _findSkillByUuid(actor, skillUuid);
  if (skillItem) {
    return {
      type: "skill",
      item: skillItem,
      name: skillItem.name,
      value: skillItem.system?.value ?? 0
    };
  }
  
  return null;
}
