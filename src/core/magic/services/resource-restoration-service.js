/**
 * @module magic/services/resource-restoration-service
 *
 * Direct current-resource restoration for spell workflows.
 */

import { FLAG_SCOPE } from "../../system/namespace.js";
import { getSpellCost, getSpellScalingEntry } from "../magicka-utils.js";
import { resolveNumericSpellStrength } from "../opposed/cast-context.js";
import { evaluateNumericExpression } from "../../../utils/numeric-expression.js";
import { requestAtomicUpdateDocument } from "../../../utils/authority-proxy.js";

const RESOURCE_RESTORE_DEFAULTS = Object.freeze({
  enabled: false,
  kind: "restoreResource",
  resource: "hp",
  target: "target",
  amount: "SS",
  capMode: "none",
  cap: "COST",
  removeFatigueLevels: 1,
  chat: true
});

const RESOURCE_SPECS = Object.freeze({
  hp: Object.freeze({ path: "system.hp.value", maxPath: "system.hp.max", label: "HP" }),
  health: Object.freeze({ path: "system.hp.value", maxPath: "system.hp.max", label: "HP" }),
  hitpoints: Object.freeze({ path: "system.hp.value", maxPath: "system.hp.max", label: "HP" }),
  magicka: Object.freeze({ path: "system.magicka.value", maxPath: "system.magicka.max", label: "MP" }),
  magickapoints: Object.freeze({ path: "system.magicka.value", maxPath: "system.magicka.max", label: "MP" }),
  mp: Object.freeze({ path: "system.magicka.value", maxPath: "system.magicka.max", label: "MP" }),
  stamina: Object.freeze({ path: "system.stamina.value", maxPath: "system.stamina.max", label: "SP" }),
  staminapoints: Object.freeze({ path: "system.stamina.value", maxPath: "system.stamina.max", label: "SP" }),
  sp: Object.freeze({ path: "system.stamina.value", maxPath: "system.stamina.max", label: "SP" })
});

const RESOURCE_PATHS = Object.freeze({
  "system.hp.value": "hp",
  "system.magicka.value": "magicka",
  "system.stamina.value": "stamina"
});

function _norm(value) {
  return String(value ?? "").trim();
}

function _normKey(value) {
  return _norm(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function _isTruthy(value) {
  return value === true || value === "true" || value === "on" || value === 1 || value === "1";
}

function _positiveInt(value, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function _getCastLevel(spell, payload = {}) {
  return _positiveInt(
    payload?.castContext?.castLevel
      ?? payload?.spellOptions?.castLevel
      ?? payload?.scalingChoices?.level
      ?? getSpellScalingEntry(spell, null)?.level
      ?? spell?.system?.level,
    1
  );
}

function _getSpellStrength(spell, caster, payload = {}) {
  const castLevel = _getCastLevel(spell, payload);
  const raw = payload?.castContext?.spellStrengthValue
    ?? resolveNumericSpellStrength(spell, castLevel, caster)
    ?? spell?.system?.spell_str
    ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function _getCastingCost(spell, payload = {}) {
  const castLevel = _getCastLevel(spell, payload);
  const raw = payload?.actualCost
    ?? payload?.magickaSpend?.consumed
    ?? payload?.magickaSpend?.actualCost
    ?? getSpellCost(spell, castLevel)
    ?? spell?.system?.cost
    ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function _splitFunctionArgs(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      return [text.slice(0, i), text.slice(i + 1)];
    }
  }
  return null;
}

function _resolveAmount(value, spell, caster, payload = {}) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const ss = _getSpellStrength(spell, caster, payload);
  const cost = _getCastingCost(spell, payload);
  const level = _getCastLevel(spell, payload);
  let text = _norm(value) || "SS";

  text = text
    .replace(/\{\{\s*spellStrengthValue\s*\}\}/gi, String(ss))
    .replace(/\{\{\s*castingCost\s*\}\}/gi, String(cost))
    .replace(/\bSS\b/gi, String(ss))
    .replace(/\bCOST\b/gi, String(cost))
    .replace(/\bCASTING_COST\b/gi, String(cost))
    .replace(/\bLEVEL\b/gi, String(level));

  const fnMatch = text.match(/^(min|max)\((.*)\)$/i);
  if (fnMatch) {
    const args = _splitFunctionArgs(fnMatch[2]);
    if (!args) return 0;
    const left = _resolveAmount(args[0], spell, caster, payload);
    const right = _resolveAmount(args[1], spell, caster, payload);
    return fnMatch[1].toLowerCase() === "min" ? Math.min(left, right) : Math.max(left, right);
  }

  const evaluated = evaluateNumericExpression(text);
  if (Number.isFinite(evaluated)) return evaluated;

  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function _getResourceSpec(resourceKey) {
  return RESOURCE_SPECS[_normKey(resourceKey)] ?? null;
}

function _normalizeResourceKey(resourceKey) {
  const spec = _getResourceSpec(resourceKey);
  if (!spec) return "";
  if (spec.path === "system.hp.value") return "hp";
  if (spec.path === "system.magicka.value") return "magicka";
  if (spec.path === "system.stamina.value") return "stamina";
  return "";
}

function _normalizeKind(value) {
  const raw = _norm(value);
  return raw === "restoreStaminaOrRemoveFatigue" ? raw : "restoreResource";
}

function _normalizeTarget(value) {
  return _norm(value).toLowerCase() === "self" ? "self" : "target";
}

function _normalizeCapMode(value) {
  const raw = _norm(value);
  if (raw === "castingCost" || raw === "custom") return raw;
  return "none";
}

function _normalizeConfiguredOperation(spell) {
  const raw = spell?.system?.engine?.resourceRestore;
  if (!raw || typeof raw !== "object" || !_isTruthy(raw.enabled)) return null;

  const kind = _normalizeKind(raw.kind);
  const resource = kind === "restoreStaminaOrRemoveFatigue"
    ? "stamina"
    : _normalizeResourceKey(raw.resource || "hp");
  if (!resource) return null;

  return {
    ...RESOURCE_RESTORE_DEFAULTS,
    enabled: true,
    source: "system",
    kind,
    resource,
    target: _normalizeTarget(raw.target),
    amount: _norm(raw.amount) || "SS",
    capMode: _normalizeCapMode(raw.capMode),
    cap: _norm(raw.cap) || "COST",
    removeFatigueLevels: _positiveInt(raw.removeFatigueLevels, 1),
    chat: raw.chat !== false
  };
}

function _normalizeLegacyOperation(spell, payload = {}) {
  if (payload?.isHealing === true) return null;

  const raw = spell?.flags?.[FLAG_SCOPE]?.restorationAutomation?.operation;
  if (!raw || typeof raw !== "object") return null;

  const kind = _normalizeKind(raw.kind);
  const resource = kind === "restoreStaminaOrRemoveFatigue"
    ? "stamina"
    : _normalizeResourceKey(raw.resource || "hp");
  if (!resource) return null;

  const capMode = raw.capByCastingCost === true
    ? "castingCost"
    : _normalizeCapMode(raw.capMode);

  return {
    ...RESOURCE_RESTORE_DEFAULTS,
    enabled: true,
    source: "legacyFlag",
    kind,
    resource,
    target: _normalizeTarget(raw.target),
    amount: _norm(raw.amount) || "SS",
    capMode,
    cap: _norm(raw.cap) || (raw.capByCastingCost === true ? "COST" : RESOURCE_RESTORE_DEFAULTS.cap),
    removeFatigueLevels: _positiveInt(raw.removeFatigueLevels ?? raw.removeConditionLevels, 1),
    chat: raw.chat !== false
  };
}

function _normalizeRecipeOperation(spell, payload = {}) {
  const recipes = spell?.system?.engine?.effects?.recipes;
  if (!Array.isArray(recipes) || payload?.isHealing === true) return null;

  const recipe = recipes.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (_norm(entry.mode || "add").toLowerCase() !== "add") return false;
    return RESOURCE_PATHS[_norm(entry.key)] != null;
  });
  if (!recipe) return null;

  const resource = RESOURCE_PATHS[_norm(recipe.key)];
  if (!resource) return null;

  return {
    ...RESOURCE_RESTORE_DEFAULTS,
    enabled: true,
    source: "legacyRecipe",
    kind: "restoreResource",
    resource,
    target: _normalizeTarget(recipe.target),
    amount: _norm(recipe.value) || "SS",
    chat: true
  };
}

function _getOperation(spell, payload = {}) {
  return _normalizeConfiguredOperation(spell)
    ?? _normalizeLegacyOperation(spell, payload)
    ?? _normalizeRecipeOperation(spell, payload);
}

function _readNumber(doc, path, fallback = 0) {
  const value = foundry.utils.getProperty(doc, path);
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function _restoreResource(actor, resourceKey, amount, lines) {
  const spec = _getResourceSpec(resourceKey);
  if (!actor || !spec) return false;

  const delta = Math.max(0, Math.floor(Number(amount) || 0));
  if (delta <= 0) return false;

  let actualDelta = 0;
  const ok = await requestAtomicUpdateDocument(actor, (fresh) => {
    const current = _readNumber(fresh, spec.path, 0);
    const maxRaw = _readNumber(fresh, spec.maxPath, current);
    const max = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : current;
    const next = Math.max(0, Math.min(max, current + delta));
    actualDelta = next - current;
    return actualDelta > 0 ? { [spec.path]: next } : null;
  });

  if (!ok || actualDelta <= 0) return false;
  lines.push(`${actor.name} gains ${actualDelta} ${spec.label}`);
  return true;
}

async function _removeFatigueOrRestoreStamina(actor, operation, spell, caster, payload, lines) {
  if (!actor) return false;

  let actualReduction = 0;
  const removeLevels = _positiveInt(operation.removeFatigueLevels, 1);
  const fatigueOk = await requestAtomicUpdateDocument(actor, (fresh) => {
    const current = _readNumber(fresh, "system.fatigue.level", 0);
    if (current <= 0) return null;
    const next = Math.max(0, current - removeLevels);
    actualReduction = current - next;
    return actualReduction > 0 ? { "system.fatigue.level": next } : null;
  });

  if (fatigueOk && actualReduction > 0) {
    lines.push(`${actor.name} reduces Fatigue by ${actualReduction}`);
    return true;
  }

  const amount = _resolveAmount(operation.amount || "SS", spell, caster, payload);
  return _restoreResource(actor, "stamina", amount, lines);
}

async function _postReport({ caster, spell, lines }) {
  if (!Array.isArray(lines) || !lines.length) return;

  const escapedLines = lines.map((line) => `<li>${_escapeHtml(line)}</li>`).join("");
  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: caster ?? null }),
      content: `<div class="uesrpg"><p><strong>${_escapeHtml(spell?.name ?? "Spell")} resource restoration</strong></p><ul>${escapedLines}</ul></div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  } catch (err) {
    console.warn("UESRPG | resource-restoration-service | Failed to post restoration report", err);
  }
}

function _escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function applySpellResourceRestoration({ caster, target, spell, payload = {}, message = null } = {}) {
  if (!spell) return false;

  const operation = _getOperation(spell, payload);
  if (!operation) return false;

  const actor = operation.target === "self" ? caster : target;
  if (!actor) return false;

  const lines = [];
  let applied = false;

  if (operation.kind === "restoreStaminaOrRemoveFatigue") {
    applied = await _removeFatigueOrRestoreStamina(actor, operation, spell, caster, payload, lines);
  } else {
    let amount = _resolveAmount(operation.amount || "SS", spell, caster, payload);
    if (operation.capMode === "castingCost") {
      amount = Math.min(amount, _getCastingCost(spell, payload));
    } else if (operation.capMode === "custom") {
      amount = Math.min(amount, _resolveAmount(operation.cap || "COST", spell, caster, payload));
    }
    applied = await _restoreResource(actor, operation.resource, amount, lines);
  }

  if (applied && operation.chat !== false) {
    await _postReport({ caster, spell, lines, message });
  }
  return applied;
}

let _initialized = false;

export function initializeResourceRestorationService() {
  if (_initialized) return;
  _initialized = true;
}
