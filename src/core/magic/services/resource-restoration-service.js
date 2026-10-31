/**
 * @module magic/services/resource-restoration-service
 *
 * Direct current-resource restoration for spell workflows.
 */

import { FLAG_SCOPE } from "../../system/namespace.js";
import { getSpellCost, getSpellScalingEntry } from "../magicka-utils.js";
import { resolveNumericSpellStrength, resolveMagicCastContext } from "../opposed/cast-context.js";
import { evaluateNumericExpression } from "../../../utils/numeric-expression.js";
import { requestAtomicUpdateDocument } from "../../../utils/authority-proxy.js";
import { adjustCurrentResource } from "../../system/resource-updates.js";
import { escapeHtml as _escapeHtml } from "../../../utils/html.js";
import { isCoreRejuvenateSpell, requireRejuvenateChoice } from "../rejuvenate-choice.js";
import { hasCoreCompendiumSource } from "../../compendium/access-service.js";

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
  if (!raw || raw === "restoreResource") return "restoreResource";
  if (raw === "restoreStaminaOrRemoveFatigue") return raw;
  // Legacy restoration metadata also describes cures, traits and other
  // operations. An unrelated kind must never become a default HP restore.
  return null;
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
  if (!kind) return null;
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
  if (!kind) return null;
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

export function isCoreReplenishSpell(spell) {
  return hasCoreCompendiumSource(spell, { type: "spell", packId: "uesrpg-3ev4.spells-revised", itemId: "IXw80OpptWLYbZVy", rule: "Replenish" });
}

export function getCoreReplenishConfigurationIssue(spell, payload = {}) {
  if (!isCoreReplenishSpell(spell)) return null;
  if (payload?.castSource?.type === "enchantment" || payload?.spellOptions?.consumeMagicka === false) {
    return "Replenish from an enchanted Item or a no-Magicka cast needs GM resolution of its Casting Cost. No automatic restoration was applied.";
  }
  const operation = _getOperation(spell, payload);
  if (!operation || operation.kind !== "restoreResource" || operation.resource !== "magicka"
    || operation.target !== "target" || operation.amount !== "SS" || operation.capMode !== "castingCost") {
    return "This Core Replenish Item has altered or incomplete restoration settings. The GM must inspect it and resolve the effect manually.";
  }
  return null;
}

/** A source identity does not guarantee that an imported Item kept its rule fields. */
export function getCoreRejuvenateConfigurationIssue(spell, payload = {}) {
  if (!isCoreRejuvenateSpell(spell)) return null;
  const operation = _getOperation(spell, payload);
  if (!operation || operation.kind !== "restoreStaminaOrRemoveFatigue" || operation.target !== "target"
    || operation.amount !== "1" || operation.removeFatigueLevels !== 1) {
    return "This Core Rejuvenate Item has altered or incomplete restoration settings. The GM must inspect it and resolve the effect manually.";
  }
  return null;
}

/** Use the same canonical operation resolution as application, including legacy rules. */
export function hasSpellResourceRestoration(spell, payload = {}) {
  return Boolean(_getOperation(spell, payload));
}

export function getSpellResourceRestorationRecipient({ caster, target, spell, payload = {} }) {
  const operation = _getOperation(spell, payload);
  return operation ? (operation.target === "self" ? caster : target) : null;
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

  const result = await adjustCurrentResource(actor, RESOURCE_PATHS[spec.path], delta, { requirePositiveMax: true });
  if (!result) throw new Error(`Resource restoration failed for ${actor.name}.`);
  if (result.delta <= 0) return false;
  lines.push(`${actor.name} gains ${result.delta} ${spec.label}`);
  return true;
}

/** Shared restoration operation for spells and fixed-effect consumables. */
export async function restoreStaminaOrRemoveFatigue(actor, { removeFatigueLevels = 1, amount = 1, lines = [], fallbackToStamina = true, choice = "auto" } = {}) {
  if (!actor) return false;
  if (choice !== "auto") requireRejuvenateChoice(choice);
  if (choice === "stamina") return _restoreResource(actor, "stamina", amount, lines);
  if (choice === "fatigue") fallbackToStamina = false;

  let actualReduction = 0;
  let previousLevel = 0;
  const removeLevels = _positiveInt(removeFatigueLevels, 1);
  const fatigueOk = await requestAtomicUpdateDocument(actor, (fresh) => {
    const current = _readNumber(fresh, "system.fatigue.level", 0);
    previousLevel = current;
    if (current <= 0) return null;
    const next = Math.max(0, current - removeLevels);
    actualReduction = current - next;
    // Level is derived from negative Stamina, the authored bonus and active
    // modifiers. Change the same authored counter as the sheet's Fatigue control;
    // persisting the derived level is overwritten by the next preparation pass.
    const sourceBonus = Number(fresh.toObject(true).system?.fatigue?.bonus ?? 0) || 0;
    return actualReduction > 0 ? { "system.fatigue.bonus": sourceBonus - actualReduction } : null;
  });

  if (!fatigueOk && actualReduction > 0) throw new Error(`Fatigue reduction failed for ${actor.name}.`);
  if (fatigueOk && actualReduction > 0) {
    if (_readNumber(actor, "system.fatigue.level", 0) !== previousLevel - actualReduction) {
      throw Object.assign(new Error(`The Fatigue counter changed, but active modifiers prevent the requested reduction for ${actor.name}.`), {
        committed: true, uncertain: true,
      });
    }
    lines.push(`${actor.name} reduces Fatigue by ${actualReduction}`);
    return true;
  }

  return fallbackToStamina ? _restoreResource(actor, "stamina", amount, lines) : false;
}

async function _postReport({ caster, spell, lines, strict = false }) {
  if (!Array.isArray(lines) || !lines.length) return;

  const escapedLines = lines.map((line) => `<li>${_escapeHtml(line)}</li>`).join("");
  try {
    const message = await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: caster ?? null }),
      content: `<div class="uesrpg"><p><strong>${_escapeHtml(spell?.name ?? "Spell")} resource restoration</strong></p><ul>${escapedLines}</ul></div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
    if (strict && !message) throw new Error("Resource restoration report was not created.");
  } catch (err) {
    if (strict) throw err;
    console.warn("UESRPG | resource-restoration-service | Failed to post restoration report", err);
  }
}

export async function applySpellResourceRestoration({ caster, target, spell, payload = {}, message = null, strict = false } = {}) {
  if (!spell) return false;

  const configurationIssue = getCoreRejuvenateConfigurationIssue(spell, payload) ?? getCoreReplenishConfigurationIssue(spell, payload);
  if (configurationIssue) throw Object.assign(new Error(configurationIssue), { committed: false });
  const operation = _getOperation(spell, payload);
  if (!operation) return false;
  const coreChoice = isCoreRejuvenateSpell(spell) && operation.kind === "restoreStaminaOrRemoveFatigue";
  const rejuvenateChoice = payload?.spellOptions?.rejuvenateChoice;
  if (coreChoice) requireRejuvenateChoice(rejuvenateChoice);

  const actor = operation.target === "self" ? caster : target;
  if (!actor) {
    if (strict) throw new Error("The resource restoration recipient is unavailable.");
    return false;
  }

  payload = { ...payload, castContext: await resolveMagicCastContext({
    castContext: payload.castContext, spellOptions: payload.spellOptions, scalingChoices: payload.scalingChoices,
  }, spell, { actor: caster, message }) };
  const lines = [];
  let applied = false;

  if (operation.kind === "restoreStaminaOrRemoveFatigue") {
    applied = await restoreStaminaOrRemoveFatigue(actor, {
      removeFatigueLevels: operation.removeFatigueLevels,
      amount: _resolveAmount(operation.amount || "SS", spell, caster, payload), lines,
      choice: coreChoice ? rejuvenateChoice : "auto",
    });
  } else {
    let amount = _resolveAmount(operation.amount || "SS", spell, caster, payload);
    if (operation.capMode === "castingCost") {
      amount = Math.min(amount, _getCastingCost(spell, payload));
    } else if (operation.capMode === "custom") {
      amount = Math.min(amount, _resolveAmount(operation.cap || "COST", spell, caster, payload));
    }
    applied = await _restoreResource(actor, operation.resource, amount, lines);
  }

  if (coreChoice && !applied) lines.push(rejuvenateChoice === "fatigue"
    ? `${actor.name} has no Fatigue to remove` : `${actor.name}'s Stamina is already full`);
  if (isCoreReplenishSpell(spell) && !applied) lines.push(`${actor.name} regains no MP (full Magicka or no restoration amount)`);
  if (lines.length && operation.chat !== false) {
    await _postReport({ caster, spell, lines, message, strict });
  }
  return applied;
}

let _initialized = false;

export function initializeResourceRestorationService() {
  if (_initialized) return;
  _initialized = true;
}
