/** Read-only projections of saved damage evidence. No Documents, globals or rules evaluation. */

/** Message Roll fields only; callers establish native visibility and an unambiguous card lane. */
export function projectRecordedMessageRolls(input) {
  return (Array.isArray(input) ? input : []).map(roll => ({
    formula: text(roll?.formula), total: recordedDamageNumber(roll?.total),
  }));
}

/** Exact standalone lane/receipt matching; an inconsistent receipt never authorizes historical fallback. */
export function projectStandaloneDamageEvidence({
  outcomes, outcomeId, targetUuid, messageId, expectedReceiptId, receiptTargetUuid = targetUuid, receipt = null,
} = {}) {
  const unavailable = () => projectGmDamageExplanation();
  if (![outcomeId, targetUuid, messageId, expectedReceiptId, receiptTargetUuid].every(value => text(value))) return unavailable();
  const matches = (Array.isArray(outcomes) ? outcomes : []).filter(entry => entry?.id === outcomeId);
  if (matches.length !== 1 || matches[0].targetUuid !== targetUuid || matches[0].kind !== "damage"
    || matches[0].adapter === "combat.inline") return unavailable();
  const outcome = matches[0];
  if (receipt !== null && receipt !== undefined) {
    if (receipt.id !== expectedReceiptId || receipt.outcomeId !== outcomeId || receipt.messageId !== messageId
      || receipt.targetUuid !== receiptTargetUuid) return unavailable();
    return projectGmDamageExplanation({ receipt, status: outcome.status });
  }
  return projectGmDamageExplanation({ report: record(outcome.result).gmDamageReport, status: outcome.status });
}


function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Accept recorded decimal numbers, including zero; never manufacture a numeric default. */
export function recordedDamageNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Public fields only. In particular, never traverse applyPayload, reports or receipts. */
export function projectWeaponDamageExplanation(input) {
  const damage = record(input);
  return {
    formula: text(damage.damageString),
    rollA: recordedDamageNumber(damage.rollATotal),
    rollB: recordedDamageNumber(damage.rollBTotal),
    result: recordedDamageNumber(damage.finalDamage),
    hitLocation: text(damage.hitLocation),
    components: (Array.isArray(damage.damageComponents) ? damage.damageComponents : [])
      .filter(component => component && typeof component === "object" && !Array.isArray(component))
      .map(component => ({
        label: text(component.displayLabel) ?? text(component.sourceLabel) ?? text(component.source),
        damageType: text(component.damageType),
        amount: recordedDamageNumber(component.amount),
      })),
  };
}

/** All supplied identity constraints must agree, and exactly one source lane must remain. */
export function selectDamageExplanationLane(candidates, identity = {}) {
  identity = record(identity);
  const targetUuid = text(identity.targetUuid);
  const tokenUuid = text(identity.tokenUuid);
  const outcomeId = text(identity.outcomeId);
  const panelKey = text(identity.panelKey);
  if (!targetUuid && !tokenUuid && !outcomeId && !panelKey) return null;
  const matches = (Array.isArray(candidates) ? candidates : []).filter(candidate => {
    if (!candidate || typeof candidate !== "object") return false;
    // A counterattack can target the attacker, so the declared application target
    // takes precedence over the original defender's Actor/Token aliases.
    if (targetUuid && (text(candidate.targetUuid) ? candidate.targetUuid !== targetUuid
      : ![candidate.actorUuid, candidate.tokenUuid].includes(targetUuid))) return false;
    if (tokenUuid && candidate.tokenUuid !== tokenUuid) return false;
    if (outcomeId && candidate.outcomeId !== outcomeId) return false;
    if (panelKey && record(candidate.damage?.gmDamageReport).panelKey !== panelKey) return false;
    return true;
  });
  return matches.length === 1 ? matches[0] : null;
}

function resource(snapshot, before, after) {
  if (!snapshot && recordedDamageNumber(before) === null && recordedDamageNumber(after) === null) return null;
  const saved = record(snapshot);
  return {
    before: recordedDamageNumber(before),
    value: recordedDamageNumber(after) ?? recordedDamageNumber(saved.value),
    max: recordedDamageNumber(saved.max),
    delta: recordedDamageNumber(saved.delta),
    absorbed: recordedDamageNumber(saved.absorbed),
  };
}

function segment(input, structured) {
  const saved = record(input);
  const reductions = record(saved.reductions);
  return {
    label: structured ? text(saved.displayLabel) ?? text(saved.sourceLabel) : null,
    damageType: text(saved.damageType),
    raw: recordedDamageNumber(saved.rawDamage),
    dosBonus: structured ? recordedDamageNumber(saved.dosBonus) : null,
    weaponBonus: structured ? recordedDamageNumber(saved.weaponBonus) : null,
    armor: structured ? recordedDamageNumber(reductions.armor) : null,
    resistance: structured ? recordedDamageNumber(reductions.resistance) : null,
    toughness: structured ? recordedDamageNumber(reductions.toughness) : null,
    penetrated: structured ? recordedDamageNumber(reductions.penetrated) : null,
    reduction: recordedDamageNumber(structured ? reductions.total : saved.reductionTotal),
    finalDamage: structured ? recordedDamageNumber(saved.finalDamage) : null,
    applied: recordedDamageNumber(structured ? saved.finalApplied : saved.applied),
  };
}

/**
 * The caller has already matched identity and checked GM/content visibility.
 * A present receipt is authoritative even when incomplete: never fill its gaps from another report.
 * Opaque source/reduction/trait notes are deliberately not projected as evaluated inputs.
 */
export function projectGmDamageExplanation({ receipt = null, report = null, status = null, panelKey = null } = {}) {
  const hasReceipt = receipt !== null && receipt !== undefined;
  const savedReceipt = record(receipt);
  const savedResult = hasReceipt ? record(savedReceipt.result ?? savedReceipt.stages?.health?.result) : {};
  const savedSnapshot = record(hasReceipt ? savedResult.gmDamageReport : report);
  const conflict = Boolean(text(panelKey) && text(savedSnapshot.panelKey) && panelKey !== savedSnapshot.panelKey);
  const result = conflict ? {} : savedResult;
  const snapshot = conflict ? {} : savedSnapshot;
  const components = Array.isArray(result.components) ? result.components : null;
  const segments = components ?? (Array.isArray(snapshot.segments) ? snapshot.segments : []);
  const buffers = Array.isArray(result.bufferAbsorbedDetail) ? result.bufferAbsorbedDetail : snapshot.buffers;
  const tempHp = resource(snapshot.tempHp, result.oldTempHP, result.settledTempHP ?? result.newTempHP);
  if (tempHp && tempHp.absorbed === null) tempHp.absorbed = recordedDamageNumber(result.tempHPAbsorbed);
  return {
    source: conflict ? "unavailable" : hasReceipt ? "receipt" : report && typeof report === "object" && !Array.isArray(report) ? "historical" : "unavailable",
    status: conflict ? null : text(savedReceipt.status) ?? text(status),
    total: recordedDamageNumber(result.damage) ?? recordedDamageNumber(snapshot.totalDamage),
    hitLocation: text(snapshot.hitLocation),
    hp: resource(snapshot.hp, result.oldHP, result.settledHP ?? result.newHP),
    tempHp,
    buffers: (Array.isArray(buffers) ? buffers : []).map(buffer => ({
      pool: text(buffer?.pool),
      remaining: recordedDamageNumber(buffer?.remaining),
      absorbed: recordedDamageNumber(buffer?.absorbed),
    })),
    woundTriggered: typeof snapshot.woundTriggered === "boolean" ? snapshot.woundTriggered : null,
    woundThreshold: recordedDamageNumber(snapshot.woundThreshold),
    defeated: typeof snapshot.defeated === "boolean" ? snapshot.defeated : null,
    segments: segments.filter(value => value && typeof value === "object" && !Array.isArray(value))
      .map(value => segment(value, components !== null)),
  };
}
