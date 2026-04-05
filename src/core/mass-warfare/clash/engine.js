/**
 * Mass Warfare v2 clash resolution.
 */

import { doTestRoll } from "../../../utils/degree-roll-helper.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { buildWarfareDisciplineTN } from "../tn.js";
import { hasHoldNextDefend } from "../actions.js";
import { resolveWarfareConditionTarget, markWarfareConditionInitialized } from "../condition-target.js";

function _num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _categoryKey(actor) {
  return String(actor?.system?._derived?.categoryKey ?? "").toLowerCase();
}

function _traditionKey(actor) {
  return String(actor?.system?._derived?.traditionKey ?? "").toLowerCase();
}

function _baseResolve(actor) {
  return _num(actor?.system?.stats?.resolve?.max ?? actor?.system?.stats?.condition?.max, 0);
}

function _currentResolve(actor) {
  return _num(actor?.system?.stats?.resolve?.value ?? actor?.system?.stats?.condition?.value, 0);
}

function _bulkLossFromSingleSource(actor, damage) {
  const db = Math.max(1, _num(actor?.system?._derived?.baseDb ?? actor?.system?._derived?.db, 1));
  const appliedDamage = Math.max(0, _num(damage, 0));
  if (appliedDamage <= db) return 0;
  return 1 + Math.floor((appliedDamage - db) / db);
}

function _buildTnData(actor, {
  modifier = 0,
  joinFray = false,
  charged = false,
  incomingChargeSide = "none",
  opponentContactSide = "front",
  opponentHolding = false,
} = {}) {
  const extraBreakdown = [];
  const traditionKey = _traditionKey(actor);
  if (opponentHolding) extraBreakdown.push({ label: "Opponent Holding", value: -20 });
  if (opponentContactSide === "flank") extraBreakdown.push({ label: "Flanked", value: -20 });
  if (incomingChargeSide === "rear") extraBreakdown.push({ label: "Charged in the Rear", value: -10 });
  if (traditionKey === "orc-strongholds" && incomingChargeSide !== "none") extraBreakdown.push({ label: "Relentless Endurance", value: 10 });
  if (traditionKey === "hammerfell" && charged) extraBreakdown.push({ label: "Warrior Wave", value: 10 });
  return buildWarfareDisciplineTN(actor, {
    manualModifier: modifier,
    joinFray,
    extraBreakdown,
  });
}

function _buildDamagePlan(side) {
  if (side.role === "none") return { formula: "0", entries: [] };
  const entries = [];
  const parts = [];
  const gearFormula = String(side.actor?.system?.gear?.dmg ?? "0").trim() || "0";
  if (gearFormula !== "0") {
    parts.push(gearFormula);
    entries.push({ label: "Gear DMG", value: gearFormula, type: "formula" });
  }

  if (side.charged && side.actor?.system?._derived?.mountChargeDie) {
    parts.push(side.actor.system._derived.mountChargeDie);
    entries.push({ label: "Mount Charge", value: side.actor.system._derived.mountChargeDie, type: "formula" });
  }

  if (side.role === "attack" && _categoryKey(side.actor) === "warriors") {
    const dos = Math.max(0, _num(side.effectiveDos, 0));
    if (dos) {
      parts.push(String(dos));
      entries.push({ label: "Attacking Stance DoS", value: dos, type: "flat" });
    }
  }

  if (side.role === "attack" && side.features?.shockAssault) {
    const currentAr = _num(side.actor?.system?.gear?.ar, 0);
    const halvedAr = Math.floor(currentAr / 2);
    const arLost = Math.max(0, currentAr - halvedAr);
    side.shockAssaultLostAr = arLost;
    if (arLost) {
      parts.push(String(arLost));
      entries.push({ label: "Shock Assault", value: arLost, type: "flat" });
    }
  }

  return {
    formula: parts.length ? parts.join(" + ") : "0",
    entries,
  };
}

function _adjustOutgoingDamage(side, opponent, rawTotal, { attackType = "melee" } = {}) {
  const categoryKey = _categoryKey(side.actor);
  let total = Math.max(0, _num(rawTotal, 0));
  const adjustments = [];
  if (categoryKey === "skirmishers" && attackType !== "ranged") {
    const next = Math.floor(total / 2);
    adjustments.push({ label: "Skirmisher Melee Penalty", value: next - total, note: "Half damage in melee" });
    total = next;
  }
  return { total, adjustments };
}

function _buildArmorBreakdown(side, {
  magical = false,
  attackType = "melee",
} = {}) {
  const entries = [];
  let total = _num(magical ? side.actor?.system?.gear?.mar : side.actor?.system?.gear?.ar, 0);
  entries.push({ label: magical ? "Base MAR" : "Base AR", value: total });

  if (_categoryKey(side.actor) === "skirmishers" && attackType !== "ranged") {
    const next = Math.floor(total / 2);
    entries.push({ label: "Skirmisher Melee Penalty", value: next - total, note: "Half armor in melee" });
    total = next;
  }

  if (side.role === "defend" && _categoryKey(side.actor) === "warriors" && side.effectiveDos > 0) {
    entries.push({ label: "Defending Stance DoS", value: side.effectiveDos });
    total += side.effectiveDos;
  }

  if (side.shockAssaultLostAr) {
    const next = Math.floor(total / 2);
    entries.push({ label: "Shock Assault", value: next - total, note: "AR halved for this Clash" });
    total = next;
  }

  return { total, entries };
}

function _buildMitigationBreakdown(targetSide, sourceSide, incomingDamage) {
  const armor = _num(targetSide.ar, 0);
  const working = Math.max(0, _num(incomingDamage, 0));
  return {
    incomingDamage: working,
    damageAfterMitigation: Math.max(0, working - armor),
    entries: [
      { label: "Armor", value: -Math.min(working, armor), note: `${armor} AR` },
    ],
    conditionLoss: Math.max(0, working - armor),
  };
}

async function _rollDiscipline(actor, tnData, role) {
  if (role === "none") return null;
  return doTestRoll(actor, {
    target: tnData.finalTN,
    allowLucky: false,
    allowUnlucky: false,
  });
}

function _buildSideState(actor, {
  role,
  joinFray,
  modifier,
  features,
  charged = false,
  incomingChargeSide = "none",
  opponentContactSide = "front",
  tokenDoc = null,
  opponentHolding = false,
  skipTest = false,
}) {
  const holdApplied = hasHoldNextDefend(actor) && opponentContactSide === "front";
  const effectiveRole = skipTest ? "none" : (holdApplied && role === "none" ? "defend" : role);
  const tnData = _buildTnData(actor, {
    modifier,
    joinFray,
    charged,
    incomingChargeSide,
    opponentContactSide,
    opponentHolding,
  });
  return {
    actor,
    tokenDoc,
    role: effectiveRole,
    originalRole: role,
    joinFray,
    modifier,
    features: features ?? {},
    charged: Boolean(charged),
    incomingChargeSide: String(incomingChargeSide ?? "none"),
    opponentContactSide: String(opponentContactSide ?? "front"),
    holdApplied,
    tnData,
    tn: tnData.finalTN,
    shockAssaultLostAr: 0,
  };
}

function _determineClashLoser(side1, side2) {
  const s1 = Boolean(side1.testResult?.isSuccess);
  const s2 = Boolean(side2.testResult?.isSuccess);
  if (s1 && !s2) return side2;
  if (!s1 && s2) return side1;
  if (!s1 && !s2) return null;
  if (side1.effectiveDos > side2.effectiveDos) return side2;
  if (side2.effectiveDos > side1.effectiveDos) return side1;
  return null;
}

async function _resolveBreakTest(side, currentResolveAfterDamage) {
  const baseTn = _num(side.actor?.system?.stats?.discipline?.value, 0);
  let breakTn = baseTn;
  if (_baseResolve(side.actor) > 0 && currentResolveAfterDamage < Math.ceil(_baseResolve(side.actor) / 2)) {
    breakTn -= 10;
  }
  if (_num(side.actor?.system?._derived?.breakScoutBonus, 0) > 0) {
    breakTn += _num(side.actor.system._derived.breakScoutBonus, 0);
  }
  const result = await doTestRoll(side.actor, {
    target: Math.max(0, breakTn),
    allowLucky: false,
    allowUnlucky: false,
  });
  return {
    tn: Math.max(0, breakTn),
    result,
    broken: !result?.isSuccess,
  };
}

export async function resolveClash({
  attacker,
  defender,
  attackerTokenDoc = null,
  defenderTokenDoc = null,
  attackerRole = "attack",
  defenderRole = "defend",
  attackerJoinFray = false,
  defenderJoinFray = false,
  attackerModifier = 0,
  defenderModifier = 0,
  attackerFeatures = {},
  defenderFeatures = {},
  attackerCharged = false,
  defenderCharged = false,
  attackerIncomingChargeSide = "none",
  defenderIncomingChargeSide = "none",
  attackerContactSide = "front",
  defenderContactSide = "front",
  attackType = "melee",
  applyDamage = true,
} = {}) {
  const attackerHolding = hasHoldNextDefend(attacker);
  const defenderHolding = hasHoldNextDefend(defender);

  const side1 = _buildSideState(attacker, {
    role: attackerRole,
    joinFray: attackerJoinFray,
    modifier: Number(attackerModifier ?? 0),
    features: attackerFeatures,
    charged: attackerCharged,
    incomingChargeSide: attackerIncomingChargeSide,
    opponentContactSide: defenderContactSide,
    tokenDoc: attackerTokenDoc,
    opponentHolding: defenderHolding && attackerContactSide === "front",
    skipTest: defenderContactSide === "rear",
  });
  const side2 = _buildSideState(defender, {
    role: defenderRole,
    joinFray: defenderJoinFray,
    modifier: Number(defenderModifier ?? 0),
    features: defenderFeatures,
    charged: defenderCharged,
    incomingChargeSide: defenderIncomingChargeSide,
    opponentContactSide: attackerContactSide,
    tokenDoc: defenderTokenDoc,
    opponentHolding: attackerHolding && defenderContactSide === "front",
    skipTest: attackerContactSide === "rear",
  });

  const [test1, test2] = await Promise.all([
    _rollDiscipline(side1.actor, side1.tnData, side1.role),
    _rollDiscipline(side2.actor, side2.tnData, side2.role),
  ]);
  side1.testResult = test1;
  side2.testResult = test2;
  side1.effectiveDos = test1?.isSuccess ? _num(test1.degree, 0) : 0;
  side2.effectiveDos = test2?.isSuccess ? _num(test2.degree, 0) : 0;

  const plan1 = _buildDamagePlan(side1);
  const plan2 = _buildDamagePlan(side2);
  const [roll1, roll2] = await Promise.all([
    new Roll(plan1.formula).evaluate(),
    new Roll(plan2.formula).evaluate(),
  ]);
  const raw1 = Math.max(0, _num(roll1.total, 0));
  const raw2 = Math.max(0, _num(roll2.total, 0));
  const outgoing1 = _adjustOutgoingDamage(side1, side2, raw1, { attackType });
  const outgoing2 = _adjustOutgoingDamage(side2, side1, raw2, { attackType: "melee" });

  side1.dmgFormula = plan1.formula;
  side2.dmgFormula = plan2.formula;
  side1.dmgRoll = roll1;
  side2.dmgRoll = roll2;
  side1.dmgRawTotal = raw1;
  side2.dmgRawTotal = raw2;
  side1.dmgTotal = outgoing1.total;
  side2.dmgTotal = outgoing2.total;
  side1.damageBreakdown = { entries: plan1.entries, rollFormula: plan1.formula, rawTotal: raw1, adjustments: outgoing1.adjustments, total: outgoing1.total };
  side2.damageBreakdown = { entries: plan2.entries, rollFormula: plan2.formula, rawTotal: raw2, adjustments: outgoing2.adjustments, total: outgoing2.total };

  side1.armorBreakdown = _buildArmorBreakdown(side1, { attackType });
  side2.armorBreakdown = _buildArmorBreakdown(side2, { attackType: "melee" });
  side1.ar = side1.armorBreakdown.total;
  side2.ar = side2.armorBreakdown.total;

  const [target1, target2] = await Promise.all([
    resolveWarfareConditionTarget({ actor: side1.actor, tokenDoc: side1.tokenDoc }),
    resolveWarfareConditionTarget({ actor: side2.actor, tokenDoc: side2.tokenDoc }),
  ]);
  side1.conditionTarget = target1;
  side2.conditionTarget = target2;
  side1.conditionBefore = _num(target1.currentResolve, 0);
  side2.conditionBefore = _num(target2.currentResolve, 0);

  side1.mitigationBreakdown = _buildMitigationBreakdown(side1, side2, side2.dmgTotal);
  side2.mitigationBreakdown = _buildMitigationBreakdown(side2, side1, side1.dmgTotal);
  side1.conditionLoss = side1.mitigationBreakdown.conditionLoss;
  side2.conditionLoss = side2.mitigationBreakdown.conditionLoss;
  side1.conditionAfter = Math.max(0, side1.conditionBefore - side1.conditionLoss);
  side2.conditionAfter = Math.max(0, side2.conditionBefore - side2.conditionLoss);
  side1.resolveBefore = side1.conditionBefore;
  side2.resolveBefore = side2.conditionBefore;
  side1.resolveLoss = side1.conditionLoss;
  side2.resolveLoss = side2.conditionLoss;
  side1.resolveAfter = side1.conditionAfter;
  side2.resolveAfter = side2.conditionAfter;
  side1.bulkLoss = _bulkLossFromSingleSource(side1.actor, side1.resolveLoss);
  side2.bulkLoss = _bulkLossFromSingleSource(side2.actor, side2.resolveLoss);

  const loser = _determineClashLoser(side1, side2);
  if (loser) {
    loser.breakTest = await _resolveBreakTest(loser, loser.resolveAfter);
    loser.broken = Boolean(loser.breakTest?.broken);
  }
  const winner = loser === side1 ? side2 : loser === side2 ? side1 : null;
  if (winner && loser?.broken) winner.enemyBecameBroken = true;

  if (applyDamage) {
    const updates = [];
    for (const side of [side1, side2]) {
      if (!side.conditionTarget?.updateTarget) continue;
      const currentLossTotal = _num(side.conditionTarget.updateTarget?.system?.stats?.resolve?.lossTotal, Math.max(0, _baseResolve(side.actor) - side.resolveBefore));
      const nextLossTotal = currentLossTotal + side.resolveLoss;
      const currentBulk = Math.max(0, _num(side.conditionTarget.updateTarget?.system?.stats?.bulk?.value, _num(side.conditionTarget.updateTarget?.system?.stats?.bulk?.max, 0)));
      const currentBulkLossTotal = Math.max(0, _num(side.conditionTarget.updateTarget?.system?.stats?.bulk?.lossTotal, Math.max(0, _num(side.conditionTarget.updateTarget?.system?.stats?.bulk?.max, currentBulk) - currentBulk)));
      const nextBulk = Math.max(0, currentBulk - side.bulkLoss);
      const patch = {
        "system.stats.resolve.value": side.resolveAfter,
        "system.stats.resolve.lossTotal": nextLossTotal,
        "system.stats.condition.value": side.resolveAfter,
      };
      if (side.bulkLoss > 0) {
        patch["system.stats.bulk.value"] = nextBulk;
        patch["system.stats.bulk.lossTotal"] = currentBulkLossTotal + side.bulkLoss;
      }
      if (side.broken) patch["system.status.battle.broken"] = true;
      if (nextBulk <= 0) patch["system.status.battle.defeated"] = true;
      if (side.enemyBecameBroken) patch["system.modifiers.discipline.battle.enemyBrokenBonus"] = true;
      updates.push(requestUpdateDocument(side.conditionTarget.updateTarget, patch));
      if (side.conditionTarget.actor && side.conditionTarget.actor !== side.conditionTarget.updateTarget) {
        updates.push(markWarfareConditionInitialized(side.conditionTarget.actor));
      }
    }
    await Promise.all(updates);
  }

  return {
    unit1: side1,
    unit2: side2,
  };
}
