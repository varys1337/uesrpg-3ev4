/**
 * src/core/traits/features/rule-element-runtime.js
 *
 * Runtime evaluator for Rule Elements in staged roll workflows.
 */

import { RULE_PHASES, normalizeRulePhase } from "../../rules/phases.js";
import { evaluatePredicate } from "../../rules/predicate.js";
import { addRollOption, addRollOptions, buildBaseRollOptions } from "../../rules/roll-options.js";
import { isDebugEnabled } from "../../../utils/debug.js";
import { _num } from "../../../utils/coerce.js";
import { getActorCanvasToken } from "../combat-proximity.js";
import { hasTalent } from "../talents-api.js";
import { doTestRoll } from "../../../utils/degree-roll-helper.js";
import { compileConditionsToPredicate } from "./conditions-to-predicate.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { getFeatureConfig } from "./feature-config.js";
import {
  getRuleElements,
  getRuleElementRuntimeSupport,
  normalizeRuleElement,
  validateRuleElement
} from "./rule-elements.js";

const SYSTEM_ID = "uesrpg-3ev4";
const RUNTIME_SETTING = "enableRuleElementsRuntime";
const WORKFLOW_SETTINGS = Object.freeze({
  skill: "enableRuleElementsRuntimeSkill",
  characteristic: "enableRuleElementsRuntimeCharacteristic",
  combat: "enableRuleElementsRuntimeCombat",
  magic: "enableRuleElementsRuntimeMagic"
});
const FEATURE_ITEM_TYPES = new Set(["trait", "talent", "power"]);
const SUPPORT_MATRIX = getRuleElementRuntimeSupport();

function _slug(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9:_-]/g, "");
}



function _safeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value == null) return fallback;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (!text) return fallback;
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return fallback;
}

function _safeGetSetting(scope, key, fallback = false) {
  try {
    return Boolean(game?.settings?.get?.(scope, key));
  } catch (_e) {
    return fallback;
  }
}

function _safeSetSetting(scope, key, value) {
  try {
    return game?.settings?.set?.(scope, key, value);
  } catch (_e) {
    return null;
  }
}

function _debug(message, data = null) {
  if (!isDebugEnabled("ruleElementDebug")) return;
  if (data == null) console.debug(`UESRPG | rule-element-runtime | ${message}`);
  else console.debug(`UESRPG | rule-element-runtime | ${message}`, data);
}

function _normalizeWorkflow(workflow) {
  const wf = _slug(workflow);
  return ["skill", "characteristic", "combat", "magic"].includes(wf) ? wf : "";
}

function _resolveWorkflow({
  workflow = "",
  testType = "",
  attackMode = "",
  characteristicKey = "",
  skillName = "",
  item = null,
  rollContext = null
} = {}) {
  const explicit = _normalizeWorkflow(workflow);
  if (explicit) return explicit;
  const fromContext = _normalizeWorkflow(rollContext?.workflow ?? "");
  if (fromContext) return fromContext;
  const mode = _slug(attackMode || rollContext?.attackMode || "");
  if (mode === "magic") return "magic";
  const test = _slug(testType || rollContext?.testType || "");
  if (test === "skill") return "skill";
  if (test === "characteristic") return "characteristic";
  if (test === "attack") return "combat";
  if (test === "spell") return "magic";
  if (_slug(characteristicKey || rollContext?.characteristicKey || "")) return "characteristic";
  if (_slug(skillName || rollContext?.skillSlug || "")) return "skill";
  const itemType = _slug(item?.type || rollContext?.itemType || "");
  if (itemType === "spell") return "magic";
  if (itemType === "weapon") return "combat";
  return "";
}

function _normalizeSupportPhases(phases) {
  const list = Array.isArray(phases) ? phases : [];
  const out = [];
  for (const phase of list) {
    const canonical = normalizeRulePhase(phase, { fallback: "" });
    if (!canonical) continue;
    if (!out.includes(canonical)) out.push(canonical);
  }
  return out;
}

function _isFeatureItem(item) {
  return Boolean(item && FEATURE_ITEM_TYPES.has(String(item.type ?? "")));
}

function _collectFeatureItems(actor, item = null) {
  const items = [];
  for (const it of Array.from(actor?.items ?? [])) {
    if (_isFeatureItem(it)) items.push(it);
  }
  if (_isFeatureItem(item) && !items.some((it) => it.id === item.id)) items.push(item);
  return items;
}

function _resolveActorFromUuid(uuid) {
  const u = String(uuid ?? "").trim();
  if (!u) return null;
  try {
    const doc = fromUuidSync(u);
    if (doc?.documentName === "Actor") return doc;
    return doc?.actor ?? null;
  } catch (_e) {
    return null;
  }
}

function _resolveTokenFromUuid(uuid) {
  const u = String(uuid ?? "").trim();
  if (!u) return null;
  try {
    const doc = fromUuidSync(u);
    if (!doc) return null;
    if (doc?.documentName === "Token") return doc.object ?? null;
    if (doc?.object?.documentName === "Token") return doc.object;
    if (doc?.documentName === "TokenDocument") return doc.object ?? null;
    return null;
  } catch (_e) {
    return null;
  }
}

export function getRuleElementRuntimeSettingsState() {
  const master = _safeGetSetting(SYSTEM_ID, RUNTIME_SETTING, false);
  const workflows = {
    skill: _safeGetSetting(SYSTEM_ID, WORKFLOW_SETTINGS.skill, false),
    characteristic: _safeGetSetting(SYSTEM_ID, WORKFLOW_SETTINGS.characteristic, false),
    combat: _safeGetSetting(SYSTEM_ID, WORKFLOW_SETTINGS.combat, false),
    magic: _safeGetSetting(SYSTEM_ID, WORKFLOW_SETTINGS.magic, false)
  };
  return {
    master,
    workflows,
    enabled: {
      skill: master && workflows.skill,
      characteristic: master && workflows.characteristic,
      combat: master && workflows.combat,
      magic: master && workflows.magic
    }
  };
}

export function isRuleElementRuntimeEnabled({ workflow = "" } = {}) {
  const state = getRuleElementRuntimeSettingsState();
  const wf = _normalizeWorkflow(workflow);
  if (!wf) return false;
  return Boolean(state.master && state.workflows[wf]);
}

function _collectAppliedEntry({ sourceItem, element, type, lane, value, phase }) {
  return {
    sourceItemId: sourceItem?.id ?? null,
    sourceItemName: sourceItem?.name ?? "",
    sourceItemType: sourceItem?.type ?? "",
    elementId: element?.id ?? null,
    elementLabel: element?.label ?? type,
    type,
    lane,
    value,
    phase
  };
}

function _extractRuntimeTnDeltaFromBreakdown(tn) {
  const list = Array.isArray(tn?.breakdown) ? tn.breakdown : [];
  return list.filter((row) => String(row?.source ?? "") === "ruleElementRuntime")
    .reduce((acc, row) => acc + _num(row?.value, 0), 0);
}

function _clearRuntimeTnBreakdown(tn) {
  if (!Array.isArray(tn?.breakdown)) return;
  tn.breakdown = tn.breakdown.filter((row) => String(row?.source ?? "") !== "ruleElementRuntime");
}

function _buildRuntimeRollOptions({
  actor = null,
  targetActor = null,
  item = null,
  testType = "",
  testLabel = "",
  skillSlug = "",
  characteristicKey = "",
  attackMode = "",
  attackVariant = "",
  defenseType = "",
  side = "",
  workflow = "",
  phase = "",
  rollContext = null,
  rollOptions = null
} = {}) {
  const options = buildBaseRollOptions({
    actor,
    target: targetActor,
    item,
    testType,
    testLabel,
    skillItem: skillSlug ? { name: skillSlug } : null,
    characteristicKey,
    attackMode,
    attackVariant,
    defenseType
  });
  addRollOptions(options, Array.isArray(rollContext?.rollOptions) ? rollContext.rollOptions : []);
  addRollOptions(options, Array.isArray(rollOptions) ? rollOptions : []);
  if (side) addRollOption(options, `side:${_slug(side)}`);
  if (workflow) addRollOption(options, `workflow:${_slug(workflow)}`);
  if (phase) addRollOption(options, `phase:${_slug(phase)}`);
  return options;
}

function _distanceMeters(tokenA, tokenB) {
  try {
    if (!canvas?.grid || !tokenA?.center || !tokenB?.center) return Infinity;
    const gridImpl = canvas.grid;
    if (typeof gridImpl?.measurePath === "function") {
      const measured = gridImpl.measurePath([tokenA.center, tokenB.center]);
      const distance = Number(measured?.distance);
      return Number.isFinite(distance) ? distance : Infinity;
    }
    const fallback = Number(canvas.grid.measureDistance?.(tokenA.center, tokenB.center));
    return Number.isFinite(fallback) ? fallback : Infinity;
  } catch (_e) {
    return Infinity;
  }
}

function _isHiddenOrNeutral(token) {
  const disposition = token?.document?.disposition;
  const hidden = token?.document?.hidden === true;
  return hidden || disposition === 0;
}

function _isOpponentToken(selfToken, otherToken) {
  if (!selfToken || !otherToken) return false;
  if (String(selfToken.id ?? "") === String(otherToken.id ?? "")) return false;
  if (_isHiddenOrNeutral(otherToken)) return false;
  const selfDisposition = selfToken?.document?.disposition;
  const otherDisposition = otherToken?.document?.disposition;
  if (selfDisposition == null || otherDisposition == null) return true;
  if (selfDisposition === 0 || otherDisposition === 0) return false;
  return selfDisposition !== otherDisposition;
}

function _sameDisposition(aToken, bToken) {
  const a = aToken?.document?.disposition;
  const b = bToken?.document?.disposition;
  return a != null && b != null && a === b;
}

function _iterSceneTokens() {
  try {
    return Array.from(canvas?.tokens?.placeables ?? []);
  } catch (_e) {
    return [];
  }
}

function _resolveRangeMeters(range, actor) {
  const mode = _slug(range || "melee");
  if (mode === "any") return Infinity;
  if (mode === "close") return 10;
  if (mode === "medium") return 25;
  if (mode === "melee") return Math.max(0, _num(actor?.system?.meleeReachMeters, 2) || 2);
  return 2;
}

function _compareCount(operator, left, right) {
  const op = String(operator ?? ">=").trim();
  if (op === "==") return left === right;
  if (op === "<=") return left <= right;
  if (op === ">") return left > right;
  if (op === "<") return left < right;
  return left >= right;
}

function _countOpponentsInRange(actorToken, actor, range) {
  if (!actorToken) return 0;
  const meters = _resolveRangeMeters(range, actor);
  let count = 0;
  for (const token of _iterSceneTokens()) {
    if (!_isOpponentToken(actorToken, token)) continue;
    if (_distanceMeters(actorToken, token) <= meters) count += 1;
  }
  return count;
}

function _hasAllyWithTalentInRangeOfTarget(actorToken, targetToken, talentSlug, range) {
  if (!actorToken || !targetToken || !talentSlug) return false;
  const meters = _resolveRangeMeters(range, actorToken?.actor);
  for (const token of _iterSceneTokens()) {
    if (!token || String(token.id ?? "") === String(actorToken.id ?? "")) continue;
    if (!token.actor || _isHiddenOrNeutral(token)) continue;
    if (!_sameDisposition(actorToken, token)) continue;
    if (!hasTalent(token.actor, talentSlug)) continue;
    if (_distanceMeters(token, targetToken) <= meters) return true;
  }
  return false;
}

function _evaluateResidualCondition(condition, context) {
  const type = _slug(condition?.type || "");
  if (!type) return { pass: true, warnings: [] };

  if (type === "proximity") {
    if (!context.actorToken) {
      return { pass: false, warnings: ["Condition proximity requires an active token on canvas."] };
    }
    const count = _countOpponentsInRange(context.actorToken, context.actor, condition?.range);
    const min = Math.max(0, _num(condition?.value, 0));
    const pass = _compareCount(condition?.operator || ">=", count, min);
    return { pass, warnings: [] };
  }

  if (type === "allyhastalent") {
    if (!context.actorToken || !context.targetToken) {
      return { pass: false, warnings: ["Condition allyHasTalent requires actor and target tokens on canvas."] };
    }
    const talentSlug = _slug(condition?.talentName || "");
    if (!talentSlug) {
      return { pass: false, warnings: ["Condition allyHasTalent requires a talent name."] };
    }
    const pass = _hasAllyWithTalentInRangeOfTarget(
      context.actorToken,
      context.targetToken,
      talentSlug,
      condition?.range
    );
    return { pass, warnings: [] };
  }

  return {
    pass: false,
    warnings: [`Residual condition type "${condition?.type ?? "unknown"}" is not supported in runtime.`]
  };
}

function _evaluateResidualConditions(residualConditions, context) {
  const list = Array.isArray(residualConditions) ? residualConditions : [];
  const warnings = [];
  for (const condition of list) {
    const evaluated = _evaluateResidualCondition(condition, context);
    if (Array.isArray(evaluated?.warnings) && evaluated.warnings.length) {
      warnings.push(...evaluated.warnings);
    }
    if (!evaluated?.pass) return { pass: false, warnings };
  }
  return { pass: true, warnings };
}

function _matchesSkillName(ruleSkillName, activeSkillSlug) {
  const expected = _slug(ruleSkillName);
  if (!expected) return true;
  return expected === _slug(activeSkillSlug);
}

function _resolveRankFromCombatStyle(actor) {
  const activeStyleId = String(actor?.getFlag?.("uesrpg-3ev4", "activeCombatStyleId") ?? "").trim();
  if (activeStyleId) {
    const style = Array.from(actor?.items ?? []).find((i) => i?.type === "combatStyle" && String(i.id ?? "") === activeStyleId);
    if (style) return _num(style?.system?.value, 0);
  }
  const anyStyle = Array.from(actor?.items ?? []).find((i) => i?.type === "combatStyle");
  if (anyStyle) return _num(anyStyle?.system?.value, 0);
  return _num(actor?.system?.professions?.combat, 0);
}

function _resolveRankFromSkill(actor, skillName = "") {
  const wanted = _slug(skillName);
  if (!wanted) return 0;
  const item = Array.from(actor?.items ?? []).find((i) => {
    if (!i || i.type !== "skill") return false;
    const n1 = _slug(i.name);
    const n2 = _slug(i?.system?.skillName ?? "");
    return wanted === n1 || wanted === n2;
  });
  return item ? _num(item?.system?.value, 0) : 0;
}

function _evaluateFormulaValue(formula, actor) {
  const text = String(formula ?? "").trim();
  if (!text) return 0;
  try {
    const data = actor?.getRollData?.() ?? actor?.system ?? {};
    const replaced = Roll.replaceFormulaData(text, data, { missing: 0 });
    const value = Roll.safeEval(replaced);
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  } catch (_e) {
    return 0;
  }
}

function _newOutput({ enabled = false, workflow = "", phase = "" } = {}) {
  return {
    enabled,
    workflow,
    phase,
    tnDelta: 0,
    dosDelta: 0,
    dosReplacement: null,
    pendingDosReplacements: [],
    damageBonus: [],
    wtDelta: 0,
    defenseOverrides: [],
    rerollGrants: [],
    spellModifiers: { restraintWbDelta: 0, effectDelta: 0, costDelta: 0 },
    passiveMods: [],
    informational: [],
    applied: [],
    skipped: { disabled: 0, unsupportedType: 0, unsupportedPhase: 0, workflowScope: 0, typeGate: 0, predicate: 0, residual: 0, invalid: 0 },
    warnings: [],
    rollOptions: []
  };
}

function _incrementSkip(output, key) {
  output.skipped[key] = _num(output?.skipped?.[key], 0) + 1;
}

const HANDLER_REGISTRY = Object.freeze({
  tnModifier({ element, context, output, sourceItem, phase }) {
    const appliesTo = _slug(element?.appliesTo || "attacker");
    const gate = (appliesTo === "skill")
      ? (context.testType === "skill" && _matchesSkillName(element?.skillName, context.skillSlug))
      : (appliesTo === "attacker" || appliesTo === "defender")
        ? (context.side === appliesTo)
        : true;
    if (!gate) return false;
    const value = _num(element?.value, 0);
    if (!value) return false;
    output.tnDelta += value;
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "tnModifier", lane: "tn", value, phase }));
    return true;
  },
  dosBonus({ element, context, output, sourceItem, phase }) {
    if (!context.result || context.result.isSuccess !== true) return false;
    const scope = _slug(element?.testType || "any");
    const gate = (scope === "any")
      || (scope === "combatstyle" && (context.testType === "attack" || context.workflow === "combat"))
      || (scope === "skill" && context.testType === "skill" && _matchesSkillName(element?.skillName, context.skillSlug));
    if (!gate) return false;
    const value = _num(element?.bonus, 0);
    if (!value) return false;
    output.dosDelta += value;
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "dosBonus", lane: "dos", value, phase }));
    return true;
  },
  dosReplacement({ element, context, output, sourceItem, phase }) {
    if (!context.result || context.result.isSuccess !== true) return false;
    const source = _slug(element?.useRankOf || "combatStyle");
    const rank = source === "skill" ? _resolveRankFromSkill(context.actor, element?.skillName) : _resolveRankFromCombatStyle(context.actor);
    const current = _num(context.result?.degree, 0);
    const next = Math.max(current, _num(rank, 0));
    if (!next || next === current) return false;

    // Collect as pending replacement — do NOT auto-apply.
    // The applyRuntimePostRollToResult wrapper will present a prompt
    // (respecting player agency per RAW) or auto-pick max.
    output.pendingDosReplacements.push({
      source,
      rank,
      previous: current,
      next,
      title: String(sourceItem?.name ?? element?.label ?? "Talent"),
      rankLabel: source === "skill" ? `${String(element?.skillName || "Skill")} Rank` : "Combat Style Rank",
      sourceItemId: sourceItem?.id ?? null,
      elementId: element?.id ?? null
    });
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "dosReplacement", lane: "dosReplacement", value: next - current, phase }));
    return true;
  },
  damageBonus({ element, context, output, sourceItem, phase }) {
    if (!(context.workflow === "combat" || context.workflow === "magic")) return false;
    const value = _evaluateFormulaValue(element?.formula, context.actor) || _num(element?.flatValue, 0);
    if (!value) return false;
    output.damageBonus.push({ value, damageType: _slug(element?.damageType || "physical") || "physical", ignoresAR: _safeBoolean(element?.ignoresAR, false), sourceItemId: sourceItem?.id ?? null, elementId: element?.id ?? null });
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "damageBonus", lane: "damage", value, phase }));
    return true;
  },
  wtDelta({ element, context, output, sourceItem, phase }) {
    if (!(context.workflow === "combat" || context.workflow === "magic")) return false;
    const value = _num(element?.delta, 0);
    if (!value) return false;
    output.wtDelta += value;
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "wtDelta", lane: "wt", value, phase }));
    return true;
  },
  defenseOverride({ element, context, output, sourceItem, phase }) {
    const against = _slug(element?.against || "any");
    if (against !== "any" && context.attackMode && _slug(context.attackMode) !== against) return false;
    output.defenseOverrides.push({ allow: _slug(element?.allow || ""), against, tnMod: _num(element?.tnMod, 0), sourceItemId: sourceItem?.id ?? null, elementId: element?.id ?? null });
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "defenseOverride", lane: "defense", value: _num(element?.tnMod, 0), phase }));
    return true;
  },
  rerollEligibility({ element, context, output, sourceItem, phase }) {
    const scope = _slug(element?.scope || "any");
    const gate = (scope === "any")
      || (scope === "specific" && _matchesSkillName(element?.skillName, context.skillSlug))
      || (scope === "endurance" && context.characteristicKey === "end")
      || (scope === "willpower" && context.characteristicKey === "wp");
    if (!gate) return false;
    output.rerollGrants.push({ scope, skillName: String(element?.skillName ?? ""), maxUses: Math.max(1, _num(element?.maxUses, 1)), sourceItemId: sourceItem?.id ?? null, elementId: element?.id ?? null });
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "rerollEligibility", lane: "reroll", value: Math.max(1, _num(element?.maxUses, 1)), phase }));
    return true;
  },
  spellModifier({ element, context, output, sourceItem, phase }) {
    if (context.workflow !== "magic") return false;
    const wb = _num(element?.restraintWbDelta, 0);
    const effect = _num(element?.effectDelta, 0);
    const cost = _num(element?.costDelta, 0);
    if (!wb && !effect && !cost) return false;
    output.spellModifiers.restraintWbDelta += wb;
    output.spellModifiers.effectDelta += effect;
    output.spellModifiers.costDelta += cost;
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "spellModifier", lane: "spell", value: wb + effect + cost, phase }));
    return true;
  },
  flatModifier({ element, output, sourceItem, phase }) {
    const value = _num(element?.value, 0);
    if (!value) return false;
    output.passiveMods.push({ type: "flatModifier", target: String(element?.target ?? ""), value, stacking: _slug(element?.stacking || "add"), sourceItemId: sourceItem?.id ?? null, elementId: element?.id ?? null });
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "flatModifier", lane: "passive", value, phase }));
    return true;
  },
  booleanFlag({ element, output, sourceItem, phase }) {
    output.passiveMods.push({ type: "booleanFlag", target: String(element?.target ?? ""), value: Boolean(element?.value), sourceItemId: sourceItem?.id ?? null, elementId: element?.id ?? null });
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "booleanFlag", lane: "passive", value: Boolean(element?.value) ? 1 : 0, phase }));
    return true;
  },
  overrideValue({ element, output, sourceItem, phase }) {
    if (!_slug(element?.characteristic || "")) return false;
    output.passiveMods.push({ type: "overrideValue", target: String(element?.target ?? ""), characteristic: _slug(element?.characteristic), sourceItemId: sourceItem?.id ?? null, elementId: element?.id ?? null });
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "overrideValue", lane: "passive", value: 1, phase }));
    return true;
  },
  senseLossReduction({ element, output, sourceItem, phase }) {
    output.passiveMods.push({ type: "senseLossReduction", mode: _slug(element?.mode || "halve"), sourceItemId: sourceItem?.id ?? null, elementId: element?.id ?? null });
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "senseLossReduction", lane: "passive", value: 1, phase }));
    return true;
  },
  note({ element, output, sourceItem, phase }) {
    const text = String(element?.text ?? "").trim();
    if (!text) return false;
    output.informational.push({ text, sourceItemId: sourceItem?.id ?? null, elementId: element?.id ?? null });
    output.applied.push(_collectAppliedEntry({ sourceItem, element, type: "note", lane: "info", value: 1, phase }));
    return true;
  }
});

export function evaluateRuleElementsRuntime({
  actor = null,
  targetActor = null,
  targetToken = null,
  item = null,
  rollContext = null,
  rollOptions = null,
  phase = RULE_PHASES.PRE_ROLL,
  result = null,
  side = "",
  workflow = "",
  testType = "",
  testLabel = "",
  skillName = "",
  characteristicKey = "",
  attackMode = "",
  attackVariant = "",
  defenseType = ""
} = {}) {
  const resolvedWorkflow = _resolveWorkflow({
    workflow,
    testType,
    attackMode,
    characteristicKey,
    skillName,
    item,
    rollContext
  });
  const enabled = isRuleElementRuntimeEnabled({ workflow: resolvedWorkflow });
  const resolvedPhase = normalizeRulePhase(phase, { fallback: String(phase ?? "").trim() });
  const output = _newOutput({ enabled, workflow: resolvedWorkflow, phase: resolvedPhase });
  if (!enabled || !actor) {
    if (!enabled) _incrementSkip(output, "disabled");
    return output;
  }

  const resolvedTargetActor = targetActor ?? targetToken?.actor ?? _resolveActorFromUuid(rollContext?.targetUuid ?? null);
  const resolvedTargetToken = targetToken ?? _resolveTokenFromUuid(rollContext?.targetTokenUuid ?? null) ?? (resolvedTargetActor ? getActorCanvasToken(resolvedTargetActor) : null);
  const actorToken = getActorCanvasToken(actor);

  let resolvedTestType = _slug(testType || rollContext?.testType || "");
  if (!resolvedTestType) {
    if (resolvedWorkflow === "skill") resolvedTestType = "skill";
    else if (resolvedWorkflow === "characteristic") resolvedTestType = "characteristic";
    else if (resolvedWorkflow === "combat") resolvedTestType = "attack";
    else if (resolvedWorkflow === "magic") resolvedTestType = "spell";
  }
  const resolvedSkillSlug = _slug(skillName || rollContext?.skillSlug || "");
  const resolvedCharKey = _slug(characteristicKey || rollContext?.characteristicKey || "");
  const resolvedAttackMode = _slug(attackMode || rollContext?.attackMode || "");
  const resolvedAttackVariant = _slug(attackVariant || rollContext?.attackVariant || "");
  const resolvedDefenseType = _slug(defenseType || rollContext?.defenseType || "");
  const resolvedTestLabel = _slug(testLabel || rollContext?.testLabel || "");
  const resolvedSide = _slug(side || "");
  const resolvedPhaseOption = _slug(resolvedPhase || "");

  const options = _buildRuntimeRollOptions({
    actor,
    targetActor: resolvedTargetActor,
    item,
    testType: resolvedTestType,
    testLabel: resolvedTestLabel,
    skillSlug: resolvedSkillSlug,
    characteristicKey: resolvedCharKey,
    attackMode: resolvedAttackMode,
    attackVariant: resolvedAttackVariant,
    defenseType: resolvedDefenseType,
    side: resolvedSide,
    workflow: resolvedWorkflow,
    phase: resolvedPhaseOption,
    rollContext,
    rollOptions
  });
  output.rollOptions = Array.from(options.values());

  const context = {
    actor,
    actorToken,
    targetActor: resolvedTargetActor,
    targetToken: resolvedTargetToken,
    item,
    result,
    side: resolvedSide,
    workflow: resolvedWorkflow,
    testType: resolvedTestType,
    skillSlug: resolvedSkillSlug,
    characteristicKey: resolvedCharKey,
    attackMode: resolvedAttackMode,
    attackVariant: resolvedAttackVariant,
    defenseType: resolvedDefenseType
  };

  const featureItems = _collectFeatureItems(actor, item);
  for (const sourceItem of featureItems) {
    const featureConfig = getFeatureConfig(sourceItem);
    if (featureConfig?.enabled === false) {
      _incrementSkip(output, "disabled");
      continue;
    }
    if (featureConfig?.combatOnly && !game?.combat?.started) {
      _incrementSkip(output, "disabled");
      continue;
    }
    if (featureConfig?.outOfCombatAllowed === false && !game?.combat?.started) {
      _incrementSkip(output, "disabled");
      continue;
    }

    const elements = getRuleElements(sourceItem);
    for (const rawElement of elements) {
      const element = normalizeRuleElement(rawElement);
      if (!element?.enabled) {
        _incrementSkip(output, "disabled");
        continue;
      }

      const type = String(element?.type ?? "");
      const support = SUPPORT_MATRIX[type] ?? null;
      if (!support || !HANDLER_REGISTRY[type]) {
        _incrementSkip(output, "unsupportedType");
        continue;
      }

      const validation = validateRuleElement(element, { workflow: resolvedWorkflow, phase: resolvedPhase });
      if (!validation.valid) {
        _incrementSkip(output, "invalid");
        for (const err of validation.errors) output.warnings.push({ level: "error", message: err, elementId: element.id, sourceItemId: sourceItem.id });
        continue;
      }
      for (const warn of validation.warnings) output.warnings.push({ level: "warning", message: warn, elementId: element.id, sourceItemId: sourceItem.id });

      const workflows = Array.isArray(element.workflows) ? element.workflows : ["all"];
      const workflowOk = !resolvedWorkflow || workflows.includes("all") || workflows.includes(resolvedWorkflow);
      const supportWorkflowOk = !resolvedWorkflow || (Array.isArray(support.workflows) && (support.workflows.includes("all") || support.workflows.includes(resolvedWorkflow)));
      if (!workflowOk || !supportWorkflowOk) {
        _incrementSkip(output, "workflowScope");
        continue;
      }

      if (support.status !== "informational") {
        const phases = _normalizeSupportPhases(support.phases);
        if (!phases.includes(resolvedPhase)) {
          _incrementSkip(output, "unsupportedPhase");
          continue;
        }
      }

      const compiled = compileConditionsToPredicate(element?.conditions ?? []);
      const compiledPredicate = Array.isArray(compiled?.predicate) && compiled.predicate.length ? compiled.predicate : null;
      const explicitPredicate = element?.predicate ?? null;
      const predicate = (compiledPredicate && explicitPredicate != null)
        ? { and: [compiledPredicate, explicitPredicate] }
        : (compiledPredicate ?? explicitPredicate);

      if (!evaluatePredicate(predicate, options)) {
        _incrementSkip(output, "predicate");
        continue;
      }
      const residual = Array.isArray(compiled?.residualConditions) ? compiled.residualConditions : [];
      if (residual.length) {
        const residualResult = _evaluateResidualConditions(residual, context);
        if (Array.isArray(residualResult?.warnings)) {
          for (const message of residualResult.warnings) {
            output.warnings.push({
              level: "warning",
              message,
              elementId: element.id,
              sourceItemId: sourceItem.id
            });
          }
        }
        if (!residualResult?.pass) {
          _incrementSkip(output, "residual");
          continue;
        }
      }

      const applied = HANDLER_REGISTRY[type]({ element, context, output, sourceItem, phase: resolvedPhase });
      if (!applied) _incrementSkip(output, "typeGate");
    }
  }

  if (output.applied.length || output.warnings.length) {
    _debug("runtime evaluated", {
      actor: actor?.name,
      workflow: resolvedWorkflow,
      phase,
      summary: {
        tnDelta: output.tnDelta,
        dosDelta: output.dosDelta,
        applied: output.applied.length,
        warnings: output.warnings.length,
        skipped: output.skipped
      }
    });
  }

  return output;
}

export function getRuntimeTnDelta(params = {}) {
  const runtime = evaluateRuleElementsRuntime({ ...params, phase: RULE_PHASES.PRE_ROLL });
  return _num(runtime?.tnDelta, 0);
}

export function applyRuntimePreRollToTN({
  tn = null,
  target = null,
  ...params
} = {}) {
  const runtime = evaluateRuleElementsRuntime({ ...params, phase: RULE_PHASES.PRE_ROLL });
  const delta = _num(runtime?.tnDelta, 0);
  let changed = false;
  let nextTarget = _num(target, _num(tn?.finalTN, 0));

  if (tn && typeof tn === "object") {
    const currentFinal = _num(tn?.finalTN, 0);
    const currentTotalMod = _num(tn?.totalMod, 0);
    const previousRuntime = _extractRuntimeTnDeltaFromBreakdown(tn);
    if (previousRuntime !== 0) {
      tn.finalTN = Math.max(0, currentFinal - previousRuntime);
      tn.totalMod = currentTotalMod - previousRuntime;
      _clearRuntimeTnBreakdown(tn);
      changed = true;
    }
    if (delta !== 0) {
      tn.breakdown = Array.isArray(tn.breakdown) ? tn.breakdown : [];
      tn.breakdown.push({ key: "rule-elements-runtime", label: "Rule Elements", value: delta, source: "ruleElementRuntime" });
      tn.totalMod = _num(tn.totalMod, 0) + delta;
      tn.finalTN = Math.max(0, _num(tn.finalTN, 0) + delta);
      changed = true;
    }
    nextTarget = _num(tn.finalTN, 0);
  } else {
    nextTarget = Math.max(0, _num(nextTarget, 0) + delta);
    changed = delta !== 0;
  }

  return { ...runtime, tn, target: nextTarget, tnDelta: delta, changed };
}

/**
 * Evaluate Rule Elements for defense overrides before the defense dialog is shown.
 *
 * When the legacy talent interceptor (e.g. Lightning Reflexes) yields to RE, this function
 * provides the RE-sourced defense overrides (e.g. allowParryRanged) that the dialog needs.
 *
 * @param {object} params
 * @param {Actor} params.defender
 * @param {string} [params.attackMode="melee"]
 * @returns {{ allowParryRanged: boolean, parryRangedTNMod: number }}
 */
export function evaluateREDefenseOverrides({ defender, attackMode } = {}) {
  const result = { allowParryRanged: false, parryRangedTNMod: 0 };
  if (!defender) return result;
  try {
    const runtime = evaluateRuleElementsRuntime({
      actor: defender,
      workflow: "combat",
      side: "defender",
      phase: RULE_PHASES.PRE_ROLL,
      attackMode: String(attackMode ?? "")
    });
    const overrides = Array.isArray(runtime?.defenseOverrides) ? runtime.defenseOverrides : [];
    for (const ov of overrides) {
      const allow = String(ov.allow ?? "").toLowerCase().replace(/[-_\s]/g, "");
      if (allow === "allowparryranged" || allow === "parryranged") {
        result.allowParryRanged = true;
        result.parryRangedTNMod = _num(ov.tnMod, -20);
      }
    }
  } catch (_e) {
    // Non-critical: fall back to no overrides.
    if (isDebugEnabled("activationDebug")) {
      console.debug("uesrpg | evaluateREDefenseOverrides failed", _e);
    }
  }
  return result;
}

export async function applyRuntimePostRollToResult({
  result = null,
  allowPrompt = false,
  ...params
} = {}) {
  if (!result) {
    const resolvedWorkflow = _resolveWorkflow(params);
    return { enabled: isRuleElementRuntimeEnabled({ workflow: resolvedWorkflow }), workflow: resolvedWorkflow, phase: RULE_PHASES.POST_ROLL, dosDelta: 0, applied: [], changed: false, result };
  }

  if (result?.ruleElementRuntime?.postRollApplied === true) {
    const resolvedWorkflow = _resolveWorkflow(params);
    return { enabled: isRuleElementRuntimeEnabled({ workflow: resolvedWorkflow }), workflow: resolvedWorkflow, phase: RULE_PHASES.POST_ROLL, dosDelta: _num(result?.ruleElementRuntime?.dosDelta, 0), applied: Array.isArray(result?.ruleElementRuntime?.applied) ? result.ruleElementRuntime.applied : [], changed: false, result };
  }

  const runtime = evaluateRuleElementsRuntime({ ...params, phase: RULE_PHASES.POST_ROLL, result });
  const delta = _num(runtime?.dosDelta, 0);
  let changed = false;

  // Handle pending dosReplacement choices.
  // If multiple replacements apply, use the best (highest rank).
  const pendingReplacements = Array.isArray(runtime?.pendingDosReplacements) ? runtime.pendingDosReplacements : [];
  if (pendingReplacements.length > 0 && result.isSuccess === true) {
    const best = pendingReplacements.reduce((a, b) => (b.next > a.next ? b : a));
    const rolledDoS = _num(result.degree, 1);

    // Check for a stored choice on the result (from a prior prompt pass or banking).
    const storedChoice = String(result?.talentDoSChoice ?? "").trim().toLowerCase();
    const hasStored = (storedChoice === "rank" || storedChoice === "roll" || storedChoice === "rolled");

    if (!hasStored && allowPrompt && (game?.user?.isGM || params?.actor?.isOwner)) {
      // Present a DoS replacement prompt matching the interceptor pattern.
      const picked = await _promptDoSReplacementRE({
        title: `${best.title} — Degrees of Success`,
        rolledDoS,
        rankDoS: best.next,
        rankLabel: best.rankLabel
      });
      result.talentDoSChoice = (picked?.choice === "rank") ? "rank" : "roll";
      result.talentDoSChoiceSource = best.sourceItemId;
    }

    const choice = String(result?.talentDoSChoice ?? "").trim().toLowerCase();
    if (choice === "rank" && best.next > rolledDoS) {
      result.degree = best.next;
      result.textual = `${best.next} DoS`;
      changed = true;
      runtime.dosReplacement = best;
    }
  }

  // Backward compat: handle dosReplacement already resolved in the handler (legacy path).
  if (!pendingReplacements.length && runtime?.dosReplacement && result.isSuccess === true) {
    const next = _num(runtime.dosReplacement.next, _num(result.degree, 1));
    if (next !== _num(result.degree, 1)) {
      result.degree = next;
      result.textual = `${next} DoS`;
      changed = true;
    }
  }

  if (result.isSuccess === true && delta !== 0) {
    const nextDegree = Math.max(1, _num(result.degree, 1) + delta);
    result.degree = nextDegree;
    result.textual = `${nextDegree} DoS`;
    changed = true;
  }

  // Reroll eligibility: if the test FAILED and there are reroll grants, offer a prompt.
  // Follows the Iron Will pattern: prompt Reroll / Keep Failure, overwrite result in-place.
  const rerollGrants = Array.isArray(runtime?.rerollGrants) ? runtime.rerollGrants : [];
  if (!result.isSuccess && rerollGrants.length > 0 && allowPrompt && !result._reRerolled) {
    const canPrompt = Boolean(game?.user?.isGM || params?.actor?.isOwner);
    if (canPrompt) {
      const grant = rerollGrants[0];
      const grantLabel = String(grant.skillName || "Rule Element").trim() || "Rule Element";
      const actorName = foundry.utils.escapeHTML(params?.actor?.name ?? "Actor");
      let wantsReroll = false;
      try {
        wantsReroll = await customDialog({
          title: `${grantLabel} — Reroll`,
          content: `<div class="uesrpg"><p><b>${actorName}</b> failed the test (rolled ${result.rollTotal} vs TN ${result.target}).</p><p>Use <b>${grantLabel}</b> to reroll (once per test)?</p></div>`,
          buttons: {
            reroll: { icon: '<i class="fas fa-dice"></i>', label: "Reroll", callback: () => true },
            keep: { icon: '<i class="fas fa-times"></i>', label: "Keep Failure", callback: () => false }
          },
          default: "reroll"
        });
      } catch (_e) {
        wantsReroll = false;
      }
      if (wantsReroll === true) {
        const target = _num(result.target, 0);
        const newRes = await doTestRoll(params.actor, { rollFormula: "1d100", target, allowLucky: true, allowUnlucky: true });
        result.isSuccess = newRes.isSuccess;
        result.degree = newRes.degree;
        result.textual = newRes.textual;
        result.rollTotal = newRes.rollTotal;
        result.roll = newRes.roll;
        result.isCriticalSuccess = newRes.isCriticalSuccess;
        result.isCriticalFailure = newRes.isCriticalFailure;
        result._reRerolled = true;
        changed = true;
      }
    }
  }

  result.ruleElementRuntime = {
    postRollApplied: true,
    workflow: runtime.workflow,
    dosDelta: delta,
    dosReplacement: runtime.dosReplacement,
    pendingDosReplacements: pendingReplacements,
    rerollGrants: runtime.rerollGrants,
    defenseOverrides: runtime.defenseOverrides,
    spellModifiers: runtime.spellModifiers,
    warnings: runtime.warnings,
    applied: runtime.applied
  };

  return { ...runtime, dosDelta: delta, result, changed };
}

/**
 * Prompt the player/GM to choose between rolled DoS and talent rank DoS.
 * Mirrors the dialog in combat-talents.js promptDoSReplacement.
 * @private
 */
function _promptDoSReplacementRE({ title, rolledDoS, rankDoS, rankLabel } = {}) {
  return customDialog({
    title: title || "Rule Element: Degrees of Success",
    content: `
      <div class="uesrpg">
        <p>Choose which Degrees of Success to use for this test:</p>
        <ul>
          <li><b>Rolled</b>: ${rolledDoS} DoS</li>
          <li><b>${rankLabel}</b>: ${rankDoS} DoS</li>
        </ul>
      </div>
    `,
    buttons: {
      rolled: {
        icon: '<i class="fas fa-dice"></i>',
        label: `Use Rolled (${rolledDoS})`,
        callback: () => ({ choice: "rolled" })
      },
      rank: {
        icon: '<i class="fas fa-star"></i>',
        label: `Use ${rankLabel} (${rankDoS})`,
        callback: () => ({ choice: "rank" })
      }
    },
    default: "rolled"
  }).then(r => r ?? { choice: "rolled" });
}

export function selfTestRuleElementRuntime() {
  const support = getRuleElementRuntimeSupport();
  const knownWorkflows = new Set(["all", "skill", "characteristic", "combat", "magic"]);
  const knownStatuses = new Set(["active", "planned", "informational"]);
  const supportEntries = Object.entries(support ?? {});
  const workflowsToCheck = ["skill", "characteristic", "combat", "magic"];
  const phasesToCheck = Object.values(RULE_PHASES);

  function _buildProbeElement(type) {
    const probe = normalizeRuleElement({ type, enabled: true });
    if (type === "rerollEligibility") probe.scope = "any";
    if (type === "tnModifier") probe.appliesTo = "attacker";
    if (type === "dosBonus") probe.testType = "any";
    if (type === "dosReplacement") probe.useRankOf = "combatStyle";
    return probe;
  }

  const matrixChecks = supportEntries.map(([type, cfg]) => {
    const status = String(cfg?.status ?? "");
    const phases = _normalizeSupportPhases(cfg?.phases);
    const workflows = Array.isArray(cfg?.workflows) ? cfg.workflows : [];
    const handlerExists = Boolean(HANDLER_REGISTRY[type]);
    const validStatus = knownStatuses.has(status);
    const validWorkflows = workflows.every((wf) => knownWorkflows.has(String(wf)));
    const nonInfoHasPhase = status === "informational" || phases.length > 0;
    return {
      type,
      pass: validStatus && validWorkflows && nonInfoHasPhase && handlerExists
    };
  });

  const eligibilitySweep = [];
  for (const [type, cfg] of supportEntries) {
    const probe = _buildProbeElement(type);
    const status = String(cfg?.status ?? "");
    const phases = _normalizeSupportPhases(cfg?.phases);
    const workflows = Array.isArray(cfg?.workflows) && cfg.workflows.length ? cfg.workflows : ["all"];
    for (const workflow of workflowsToCheck) {
      for (const phase of phasesToCheck) {
        const validation = validateRuleElement(probe, { workflow, phase });
        const expected = status !== "informational"
          && (workflows.includes("all") || workflows.includes(workflow))
          && phases.includes(phase);
        eligibilitySweep.push({
          type,
          workflow,
          phase,
          expected,
          actual: validation.eligible,
          pass: validation.eligible === expected
        });
      }
    }
  }

  const tests = [
    { name: "support matrix present", pass: Boolean(support && typeof support === "object" && Object.keys(support).length > 0) },
    { name: "tnModifier supports preRoll", pass: Array.isArray(support?.tnModifier?.phases) && support.tnModifier.phases.includes("preRoll") },
    { name: "dosBonus supports postRoll", pass: Array.isArray(support?.dosBonus?.phases) && support.dosBonus.phases.includes("postRoll") },
    { name: "note is informational", pass: String(support?.note?.status ?? "") === "informational" },
    { name: "workflow settings state shape", pass: Boolean(getRuleElementRuntimeSettingsState()?.workflows) },
    { name: "phase normalization alias pre-roll", pass: normalizeRulePhase("pre-roll", { fallback: "" }) === RULE_PHASES.PRE_ROLL },
    { name: "phase normalization alias post_damage", pass: normalizeRulePhase("post_damage", { fallback: "" }) === RULE_PHASES.POST_DAMAGE },
    { name: "support matrix entries are executable contracts", pass: matrixChecks.every((t) => t.pass) },
    { name: "support matrix eligibility sweep", pass: eligibilitySweep.every((t) => t.pass) }
  ];
  const passed = tests.filter((t) => t.pass).length;
  return {
    total: tests.length,
    passed,
    failed: tests.length - passed,
    results: tests,
    matrix: matrixChecks,
    eligibilitySweep
  };
}
