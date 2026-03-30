import { buildActorAETotalsMap } from "../../ae/modifiers.js";

const CHARACTERISTIC_BONUS_KEYS = Object.freeze([
  ["system.characteristics.str.bonus", "str"],
  ["system.characteristics.end.bonus", "end"],
  ["system.characteristics.agi.bonus", "agi"],
  ["system.characteristics.int.bonus", "int"],
  ["system.characteristics.wp.bonus", "wp"],
  ["system.characteristics.prc.bonus", "prc"],
  ["system.characteristics.prs.bonus", "prs"],
  ["system.characteristics.lck.bonus", "lck"],
]);

export function applyHumanoidCharacteristicsStage(stage) {
  const { actorContext, actorSystemData, agg } = stage;

  actorSystemData.characteristics.str.total = actorSystemData.characteristics.str.base + agg.charBonus.str;
  actorSystemData.characteristics.end.total = actorSystemData.characteristics.end.base + agg.charBonus.end;
  actorSystemData.characteristics.agi.total = actorSystemData.characteristics.agi.base + agg.charBonus.agi;
  actorSystemData.characteristics.int.total = actorSystemData.characteristics.int.base + agg.charBonus.int;
  actorSystemData.characteristics.wp.total = actorSystemData.characteristics.wp.base + agg.charBonus.wp;
  actorSystemData.characteristics.prc.total = actorSystemData.characteristics.prc.base + agg.charBonus.prc;
  actorSystemData.characteristics.prs.total = actorSystemData.characteristics.prs.base + agg.charBonus.prs;
  actorSystemData.characteristics.lck.total = actorSystemData.characteristics.lck.base + agg.charBonus.lck;

  {
    const cMods = actorSystemData.modifiers?.characteristics ?? {};
    actorSystemData.characteristics.str.total += Number(cMods.str ?? 0);
    actorSystemData.characteristics.end.total += Number(cMods.end ?? 0);
    actorSystemData.characteristics.agi.total += Number(cMods.agi ?? 0);
    actorSystemData.characteristics.int.total += Number(cMods.int ?? 0);
    actorSystemData.characteristics.wp.total += Number(cMods.wp ?? 0);
    actorSystemData.characteristics.prc.total += Number(cMods.prc ?? 0);
    actorSystemData.characteristics.prs.total += Number(cMods.prs ?? 0);
    actorSystemData.characteristics.lck.total += Number(cMods.lck ?? 0);
  }

  const bonuses = {
    str: Math.floor(actorSystemData.characteristics.str.total / 10),
    end: Math.floor(actorSystemData.characteristics.end.total / 10),
    agi: Math.floor(actorSystemData.characteristics.agi.total / 10),
    int: Math.floor(actorSystemData.characteristics.int.total / 10),
    wp: Math.floor(actorSystemData.characteristics.wp.total / 10),
    prc: Math.floor(actorSystemData.characteristics.prc.total / 10),
    prs: Math.floor(actorSystemData.characteristics.prs.total / 10),
    lck: Math.floor(actorSystemData.characteristics.lck.total / 10),
  };

  actorSystemData.characteristics.str.bonus = bonuses.str;
  actorSystemData.characteristics.end.bonus = bonuses.end;
  actorSystemData.characteristics.agi.bonus = bonuses.agi;
  actorSystemData.characteristics.int.bonus = bonuses.int;
  actorSystemData.characteristics.wp.bonus = bonuses.wp;
  actorSystemData.characteristics.prc.bonus = bonuses.prc;
  actorSystemData.characteristics.prs.bonus = bonuses.prs;
  actorSystemData.characteristics.lck.bonus = bonuses.lck;

  const totalsMap = stage.aeTotalsMap ?? buildActorAETotalsMap(actorContext);
  stage.aeTotalsMap = totalsMap;

  for (const [key, characteristicKey] of CHARACTERISTIC_BONUS_KEYS) {
    if (!characteristicKey || !actorSystemData.characteristics?.[characteristicKey]) continue;
    const modifier = totalsMap[key] ?? { add: 0, override: null };
    if (modifier.override != null) {
      actorSystemData.characteristics[characteristicKey].bonus = Number(modifier.override);
    } else if (modifier.add) {
      actorSystemData.characteristics[characteristicKey].bonus =
        Number(actorSystemData.characteristics[characteristicKey].bonus ?? 0) + Number(modifier.add);
    }
  }

  stage.characteristicBonuses = bonuses;
}
