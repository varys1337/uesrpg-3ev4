export function prepareModSkillItems(actorData, itemData) {
  if (!Array.isArray(itemData.skillArray) || itemData.skillArray.length === 0) { return; }

  const professions = actorData?.system?.professions;
  const professionsWound = actorData?.system?.professionsWound;

  for (let entry of itemData.skillArray) {
    if (!entry || !entry.name) continue;
    const value = Number(entry.value || 0);

    if (itemData.equipped && professions) {
      professions[entry.name] = Number(professions[entry.name] || 0) + value;
      if (professionsWound) {
        professionsWound[entry.name] = Number(professionsWound[entry.name] || 0) + value;
      }
    }
  }
}