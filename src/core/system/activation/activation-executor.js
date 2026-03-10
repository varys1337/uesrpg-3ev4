import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { OpposedWorkflow } from "../../combat/opposed-workflow.js";
import { getHitLocationFromRoll } from "../../combat/combat-utils.js";
import { getExplicitActiveCombatStyleItem } from "../../combat/combat-style-utils.js";
import { isActorUndead } from "../../traits/trait-registry.js";
import { normalizeTalentKey, resolveTalentSlug } from "../../traits/talents-api.js";
import { activateHardTargetEffect } from "../../traits/mobility-talents.js";
import { handleRacialPowerActivation, handleRacialTalentActivation, validateRacialActivationAvailability } from "../../traits/racial-talents.js";
import { handleInspireHeroismActivation, validateInspireHeroismAvailability } from "../../traits/social-talents.js";
import { activateSpellcastingTalent, isActivatableSpellcastingTalent } from "../../traits/spellcasting-talents.js";
import { filterTargetsBySpellRange, getSpellAoEConfig, getSpellRangeType, getSpellMaxRangeMeters } from "../../magic/spell-range.js";
import { AoEService, AOE_SOURCE_TYPES } from "../../aoe/index.js";
import { findLatestOpposedMessageByDefender, retargetOpposedMessage } from "../../combat/opposed/retarget.js";
import { grantFreeNextDefenseCommit, registerActivationStateHooks } from "../../combat/activation-state-flags.js";
import { createSeverityDebugLogger } from "../../../utils/debug.js";
import { _num } from "../../../utils/coerce.js";
import { safeUpdateChatMessage } from "../../../utils/chat-message-socket.js";
import { getFeatureConfig } from "../../traits/features/feature-config.js";
import { runFeatureAutomation } from "../../traits/features/feature-dispatcher.js";
import { featureNeedsEffectTransfer, applyFeatureEffectsToTargets } from "./feature-effects.js";
import { customDialog, confirmDialog } from "../../../utils/dialog-v2-helper.js";
import { SYSTEM_ID } from "../system-id.js";
import { getRoundTimeSecondsSafe } from "../time/round-time.js";
const ACTION_TYPE_LABELS = {
  passive: "Passive",
  free: "Free",
  reaction: "Reaction",
  secondary: "Secondary",
  action: "Action",
  special: "Special"
};

const AUTOMATION_TALENT_KEYS = new Set(["defender", "hardtarget", "thundercharge", "inspireheroism"]);

const _activationDebug = createSeverityDebugLogger("activationDebug", "", "debug");

function _resolveTalentAutomationKey(item) {
  const raw = normalizeTalentKey(item?.name ?? "");
  const slug = resolveTalentSlug(item?.name ?? "");
  if (AUTOMATION_TALENT_KEYS.has(slug)) return slug;
  if (raw.startsWith("defender")) return "defender";
  if (raw.startsWith("hard-target") || raw.startsWith("hardtarget")) return "hardtarget";
  if (raw.startsWith("thunder-charge") || raw.startsWith("thundercharge")) return "thundercharge";
  return slug || raw;
}

function _firstNonEmptyString(...values) {
  for (const v of values) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (s) return s;
  }
  return "";
}

function _getActorResource(actor, path) {
  try {
    return _num(foundry.utils.getProperty(actor?.system, path));
  } catch {
    return 0;
  }
}

function _getTargetsFromContext(context) {
  const provided = context?.targets;
  if (provided instanceof Set) return Array.from(provided);
  if (Array.isArray(provided)) return provided;
  if (provided) return [provided];
  const targets = game?.user?.targets;
  if (targets instanceof Set) return Array.from(targets);
  return [];
}

function _resolveTokenForActor(actor) {
  const id = actor?.id ?? null;
  if (!id) return null;
  const controlled = canvas?.tokens?.controlled ?? [];
  const match = controlled.find(t => t?.actor?.id === id);
  if (match) return match;
  return canvas?.tokens?.placeables?.find(t => t?.actor?.id === id) ?? null;
}

function _resolveTokenTarget(target) {
  if (!target) return null;
  // Token object (PlaceableObject)
  if (target?.document?.documentName === "Token") return target;
  // TokenDocument
  if (target?.documentName === "TokenDocument") return target.object ?? canvas?.tokens?.get?.(target.id) ?? null;
  // Legacy Token document-like
  if (target?.documentName === "Token") return target.object ?? canvas?.tokens?.get?.(target.id) ?? null;
  // Wrapped object
  if (target?.object?.document?.documentName === "Token") return target.object;
  // UUID string fallback
  if (typeof target === "string") {
    try {
      const doc = fromUuidSync(target);
      if (doc?.documentName === "TokenDocument") return doc.object ?? canvas?.tokens?.get?.(doc.id) ?? null;
      if (doc?.documentName === "Token") return doc.object ?? canvas?.tokens?.get?.(doc.id) ?? null;
    } catch (_e) {
      // no-op
    }
  }
  return null;
}

function _isAllyTokenPair(aToken, bToken) {
  const aDisp = Number(aToken?.document?.disposition ?? NaN);
  const bDisp = Number(bToken?.document?.disposition ?? NaN);
  if (!Number.isFinite(aDisp) || !Number.isFinite(bDisp)) return false;
  if (aDisp === 0 || bDisp === 0) return false;
  return aDisp === bDisp;
}

async function _swapTokenPositions(tokenA, tokenB) {
  const aDoc = tokenA?.document ?? null;
  const bDoc = tokenB?.document ?? null;
  if (!aDoc || !bDoc) return false;

  const aPos = { x: Number(aDoc.x ?? 0) || 0, y: Number(aDoc.y ?? 0) || 0 };
  const bPos = { x: Number(bDoc.x ?? 0) || 0, y: Number(bDoc.y ?? 0) || 0 };

  const okA = await requestUpdateDocument(aDoc, { x: bPos.x, y: bPos.y });
  if (!okA) return false;
  const okB = await requestUpdateDocument(bDoc, { x: aPos.x, y: aPos.y });
  if (!okB) {
    await requestUpdateDocument(aDoc, { x: aPos.x, y: aPos.y });
    return false;
  }
  return true;
}

async function _activateDefenderTalent({ item, actor, context }) {
  _activationDebug("UESRPG | DefenderActivation | start", {
    actor: actor?.name ?? null,
    actorUuid: actor?.uuid ?? null,
    item: item?.name ?? null,
    contextTargets: Array.isArray(context?.targets) ? context.targets.length : null,
    userTargets: Number(game?.user?.targets?.size ?? 0)
  });
  let targets = (_getTargetsFromContext(context) ?? []).map(_resolveTokenTarget).filter(Boolean);
  // Legacy fallback path: use raw user targets exactly as the previously working behavior relied on.
  if (targets.length !== 1) {
    targets = Array.from(game?.user?.targets ?? [])
      .map((t) => _resolveTokenTarget(t) ?? t?.object ?? null)
      .filter((t) => Boolean(t?.actor));
  }
  if (targets.length !== 1) {
    _activationDebug("UESRPG | DefenderActivation | invalidTargets", { targetCount: targets.length });
    ui.notifications?.warn?.("Defender requires exactly one targeted ally token.");
    return;
  }

  const activatorToken = _resolveTokenForActor(actor);
  if (!activatorToken) {
    _activationDebug("UESRPG | DefenderActivation | missingActivatorToken", { actorUuid: actor?.uuid ?? null });
    ui.notifications?.warn?.("Defender requires the activating actor to have a placed token.");
    return;
  }

  const originalDefenderToken = targets[0];
  if (!_isAllyTokenPair(activatorToken, originalDefenderToken)) {
    _activationDebug("UESRPG | DefenderActivation | notAlly", {
      activator: activatorToken?.name ?? null,
      target: originalDefenderToken?.name ?? null,
      activatorDisposition: activatorToken?.document?.disposition ?? null,
      targetDisposition: originalDefenderToken?.document?.disposition ?? null
    });
    ui.notifications?.warn?.("Defender target must be an ally.");
    return;
  }

  let latest = findLatestOpposedMessageByDefender({
    actorUuid: originalDefenderToken.actor?.uuid ?? null,
    tokenUuid: originalDefenderToken.document?.uuid ?? null,
    mode: "any"
  });
  // Legacy fallback lookup order to preserve previously working behavior.
  if (!latest) {
    latest = findLatestOpposedMessageByDefender({
      actorUuid: originalDefenderToken.actor?.uuid ?? null,
      tokenUuid: originalDefenderToken.document?.uuid ?? null,
      mode: "combat"
    });
  }
  if (!latest) {
    latest = findLatestOpposedMessageByDefender({
      actorUuid: originalDefenderToken.actor?.uuid ?? null,
      tokenUuid: originalDefenderToken.document?.uuid ?? null,
      mode: "any",
      activeOnly: false
    });
  }
  if (!latest) {
    _activationDebug("UESRPG | DefenderActivation | noOpposed", {
      targetActorUuid: originalDefenderToken.actor?.uuid ?? null,
      targetTokenUuid: originalDefenderToken.document?.uuid ?? null
    });
    ui.notifications?.warn?.("No active opposed card found for the targeted defender.");
    return;
  }

  let swapped = await retargetOpposedMessage(
    latest,
    {
      defenderTokenUuid: activatorToken.document?.uuid ?? null,
      defenderTokenId: activatorToken.id ?? activatorToken.document?.id ?? null
    },
    { userId: game.user?.id ?? null, reason: "defender-talent-activation" }
  );
  if (!swapped) {
    swapped = await retargetOpposedMessage(
      latest,
      {
        defenderTokenUuid: activatorToken.document?.uuid ?? null,
        defenderTokenId: activatorToken.id ?? activatorToken.document?.id ?? null
      },
      {
        userId: game.user?.id ?? null,
        reason: "defender-talent-activation",
        automationActorUuid: actor?.uuid ?? null,
        forceAutomation: true
      }
    );
  }
  if (!swapped) return;
  _activationDebug("UESRPG | DefenderActivation | retargeted", { messageId: latest?.id ?? null });

  const positionsSwapped = await _swapTokenPositions(activatorToken, originalDefenderToken);
  if (!positionsSwapped) {
    _activationDebug("UESRPG | DefenderActivation | swapFailed", {
      activatorTokenId: activatorToken?.id ?? null,
      targetTokenId: originalDefenderToken?.id ?? null
    });
    ui.notifications?.warn?.("Defender activated, but token position swap failed.");
  }

  const now = Date.now();
  const worldTime = Number(game?.time?.worldTime ?? 0) || 0;
  const combat = (game?.combat && game.combat.started) ? game.combat : null;
  const freeFlag = {
    source: "Defender",
    messageId: latest.id,
    createdAt: now,
    expiresAt: now + 60000,
    createdWorldTime: worldTime,
    expiresWorldTime: worldTime + Math.max(1, getRoundTimeSecondsSafe()),
    combatId: combat?.id ?? null,
    round: combat ? Number(combat.round ?? 0) : null,
    turn: combat ? Number(combat.turn ?? 0) : null,
    expireOnStepAdvance: true
  };

  const granted = await grantFreeNextDefenseCommit(actor, freeFlag);
  _activationDebug("UESRPG | DefenderActivation | freeDefenseState", {
    granted,
    actorUuid: actor?.uuid ?? null,
    messageId: latest?.id ?? null
  });
  if (!granted) {
    ui.notifications?.warn?.("Defender activated, but free defense state could not be applied.");
  }

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor, token: activatorToken?.document ?? null }),
    content: `<div class="uesrpg"><b>Defender</b>: ${actor.name} intercepts for ${originalDefenderToken.actor?.name ?? "ally"}, swaps position, and gains a free next defense commit.</div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

async function _activateThunderChargeTalent({ item, actor }) {
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="uesrpg"><b>Thunder Charge</b>: passive talent active. Use the attack dialog toggle on All Out Attack to waive the surcharge.</div>`,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

async function runTalentActivationAutomation({ item, actor, context = {} } = {}) {
  if (!item || item.type !== "talent") return;
  const k = _resolveTalentAutomationKey(item);
  _activationDebug("UESRPG | TalentAutomation | dispatch", {
    item: item?.name ?? null,
    key: k,
    actor: actor?.name ?? null,
    activationEnabled: Boolean(item?.system?.activation?.enabled)
  });
  try {
    if (k === "hardtarget") await activateHardTargetEffect(actor);
    if (k === "defender") await _activateDefenderTalent({ item, actor, context });
    if (k === "thundercharge") await _activateThunderChargeTalent({ item, actor });
    if (k === "inspireheroism") await handleInspireHeroismActivation({ actor, item });
    if (isActivatableSpellcastingTalent(item)) await activateSpellcastingTalent(actor, item);
    await handleRacialTalentActivation({ actor, item, itemKey: k });
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Talent activation automation failed`, { item: item?.name, key: k, err });
  }
}

function _hasEquippedWeapon(actor) {
  if (!actor) return false;
  return actor.items?.some?.(i => i.type === "weapon" && i.system?.equipped === true) ?? false;
}

function _hasEquippedMeleeWeapon(actor) {
  if (!actor) return false;
  return actor.items?.some?.(i => i.type === "weapon" && i.system?.equipped === true && String(i.system?.attackMode ?? "melee").toLowerCase() !== "ranged") ?? false;
}

function _hasEquippedRangedWeapon(actor) {
  if (!actor) return false;
  return actor.items?.some?.(i => i.type === "weapon" && i.system?.equipped === true && String(i.system?.attackMode ?? "").toLowerCase() === "ranged") ?? false;
}

function _getActivationCostValues(costs = {}) {
  return {
    ap: Math.max(0, _num(costs.action_points)),
    sp: Math.max(0, _num(costs.stamina)),
    mp: Math.max(0, _num(costs.magicka)),
    lp: Math.max(0, _num(costs.luck_points)),
    hp: Math.max(0, _num(costs.health))
  };
}

function _normalizeUsage(activation = {}) {
  const usage = activation.usage ?? null;
  const usagePeriod = String(usage?.period ?? "").trim().toLowerCase();
  const usageHasData =
    (usage?.max != null && _num(usage.max) > 0) ||
    (usage?.current != null && _num(usage.current) > 0) ||
    (usagePeriod.length > 0 && usagePeriod !== "none");
  if (usage && usageHasData) {
    return {
      source: "usage",
      max: usage.max == null ? null : _num(usage.max),
      period: usagePeriod || null,
      current: _num(usage.current)
    };
  }

  const uses = activation.uses ?? null;
  const usesReset = String(uses?.reset ?? "").trim().toLowerCase();
  const usesHasData =
    (uses?.max != null && _num(uses.max) > 0) ||
    (uses?.value != null && _num(uses.value) > 0) ||
    (usesReset.length > 0 && usesReset !== "none");
  if (uses && usesHasData) {
    return {
      source: "uses",
      max: uses.max == null ? null : _num(uses.max),
      period: uses.reset ?? null,
      current: _num(uses.value)
    };
  }

  return { source: null, max: null, period: null, current: 0 };
}

function _formatUsagePeriod(period) {
  const key = String(period ?? "").trim();
  if (!key) return "";
  const labels = {
    encounter: "Encounter",
    shortRest: "Short Rest",
    longRest: "Long Rest",
    day: "Day",
    daily: "Daily",
    none: ""
  };
  return labels[key] ?? key;
}

function _shouldConsumeUsage(activation = {}) {
  return activation.consumeUse === true;
}

function _isAttackActivation(activation = {}) {
  const mode = String(activation?.roll?.mode ?? "").toLowerCase().trim();
  return mode === "attack" || activation?.roll?.isAttack === true;
}

function _getHitLocationMode(activation = {}) {
  const mode = String(activation?.roll?.hitLocationMode ?? "roll").toLowerCase().trim();
  return mode === "manual" ? "manual" : "roll";
}

function _getAttackModeFromActivation(activation = {}) {
  const explicit = String(activation?.roll?.attackMode ?? "").toLowerCase().trim();
  if (explicit === "melee" || explicit === "ranged") return explicit;

  const req = activation?.requirements ?? {};
  if (req.requiresRanged) return "ranged";
  if (req.requiresMelee) return "melee";
  return "melee";
}

function _normalizeActivationDamage(activation = {}) {
  const dmg = activation?.damage ?? {};
  const mode = String(dmg.mode ?? "weapon").toLowerCase().trim();
  const allowed = new Set(["weapon", "manual", "healing", "temporary"]);
  if (!allowed.has(mode) || mode === "weapon") return null;
  const structuredRaw = Array.isArray(dmg.qualitiesStructured) ? dmg.qualitiesStructured : [];
  const traitsRaw = Array.isArray(dmg.qualitiesTraits) ? dmg.qualitiesTraits : [];

  const qualitiesStructured = structuredRaw.map((q) => {
    if (!q) return null;
    if (typeof q === "string") {
      const key = String(q).trim();
      return key ? { key } : null;
    }
    const key = String(q.key ?? q.name ?? q.label ?? "").trim();
    if (!key) return null;
    const out = { key };
    if (q.value != null && q.value !== "") {
      const num = Number(q.value);
      if (Number.isFinite(num)) out.value = num;
    }
    return out;
  }).filter(Boolean);

  const qualitiesTraits = traitsRaw
    .map(t => String(t ?? "").trim())
    .filter(Boolean);
  return {
    mode,
    formula: String(dmg.formula ?? "").trim(),
    type: String(dmg.type ?? "").trim().toLowerCase(),
    qualitiesStructured,
    qualitiesTraits
  };
}

function _normalizeActivationTags(activation = {}) {
  const tags = Array.isArray(activation?.roll?.tags) ? activation.roll.tags : [];
  return tags.map(t => String(t ?? "").trim()).filter(Boolean);
}

async function _promptHitLocationChoice({ title = "Select Hit Location", defaultValue = "Body" } = {}) {
  const locations = ["Head", "Body", "Right Arm", "Left Arm", "Right Leg", "Left Leg"];
  const options = locations.map((loc) => {
    const selected = loc === defaultValue ? " selected" : "";
    return `<option value="${loc}"${selected}>${loc}</option>`;
  }).join("\n");

  const content = `
    <div class="uesrpg-hit-location-choice">
      <div class="form-group">
        <label><b>Hit Location</b></label>
        <select name="hitLocation">${options}</select>
      </div>
    </div>
  `;

  return customDialog({
    title,
    content,
    buttons: {
      ok: {
        label: "Confirm",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const val = root?.querySelector('select[name="hitLocation"]')?.value;
          return String(val ?? "").trim() || null;
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    defaultButton: "ok",
  });
}

function _buildActivationHeader({ label, img, actor, includeImage }) {
  const title = String(label ?? "Activation");
  const header = includeImage && img
    ? `<h2><img src="${img}" />${title}</h2>`
    : `<h2>${title}</h2>`;

  const actorLine = actor ? `<div class="uesrpg-activation-actor"><i>${actor.name}</i></div>` : "";
  return `${header}
  ${actorLine}`;
}

function _buildActivationCostsHtml(costs) {
  const costPairs = [];
  const { ap, sp, mp, lp, hp } = _getActivationCostValues(costs);
  if (ap) costPairs.push(`AP: ${ap}`);
  if (sp) costPairs.push(`SP: ${sp}`);
  if (mp) costPairs.push(`MP: ${mp}`);
  if (lp) costPairs.push(`LP: ${lp}`);
  if (hp) costPairs.push(`HP: ${hp}`);

  return costPairs.length
    ? `<div class="uesrpg-activation-costs"><b>Costs:</b> ${costPairs.join(", ")}</div>`
    : "";
}

function _buildItemDescriptionHtml({ item, includeImage }) {
  if (!item) return "";
  if (includeImage) {
    return `<h2><img src="${item.img}" />${item.name}</h2>
    <i><b>${item.type}</b></i><p>
      <i>${item.system.description}</i>`;
  }
  return `<h2>${item.name}</h2><p>
  <i><b>${item.type}</b></i><p>
    <i>${item.system.description}</i>`;
}

async function _applyActivationActorFlags({ item, actor, activation } = {}) {
  if (!item || !actor) return { ok: true, applied: false };
  if (item.type !== "trait") return { ok: true, applied: false };
  if (String(actor?.type ?? "").toLowerCase().trim() !== "npc") return { ok: true, applied: false };

  const flags = activation?.flags ?? {};
  const updateData = {};

  if (flags.npcLuckAllowed === true) {
    updateData[`flags.${SYSTEM_ID}.npcLuckAllowed`] = true;
  }
  if (flags.npcEliteAllowed === true) {
    updateData[`flags.${SYSTEM_ID}.npcEliteAllowed`] = true;
  }

  if (!Object.keys(updateData).length) return { ok: true, applied: false };

  const ok = await requestUpdateDocument(actor, updateData);
  if (!ok) {
    ui.notifications?.warn?.(`Failed to apply NPC rule flags for ${item.name}.`);
    return { ok: false, applied: false };
  }

  return { ok: true, applied: true };
}

function getActivationActionTypeLabel(actionType) {
  const key = String(actionType ?? "action");
  return ACTION_TYPE_LABELS[key] ?? key;
}

function validateActivationContext({ actor, activation, context = {} } = {}) {
  const req = activation?.requirements ?? {};
  const targets = _getTargetsFromContext(context);

  if (req.requiresTarget && targets.length === 0) {
    ui.notifications?.warn?.("This ability requires a target.");
    return { ok: false, reason: "requiresTarget" };
  }

  if (req.requiresEquippedWeapon && !_hasEquippedWeapon(actor)) {
    ui.notifications?.warn?.("This ability requires an equipped weapon.");
    return { ok: false, reason: "requiresEquippedWeapon" };
  }

  if (req.requiresMelee && !_hasEquippedMeleeWeapon(actor)) {
    ui.notifications?.warn?.("This ability requires an equipped melee weapon.");
    return { ok: false, reason: "requiresMelee" };
  }

  if (req.requiresRanged && !_hasEquippedRangedWeapon(actor)) {
    ui.notifications?.warn?.("This ability requires an equipped ranged weapon.");
    return { ok: false, reason: "requiresRanged" };
  }

  if (req.requiresHitLocation && !context?.hitLocation) {
    ui.notifications?.warn?.("This ability requires a hit location.");
    return { ok: false, reason: "requiresHitLocation" };
  }

  return { ok: true };
}

async function applyActivationCosts({ actor, activation, label = "Ability" } = {}) {
  if (!activation?.spendCosts) return { ok: true, spent: false };
  if (!actor) return { ok: false, spent: false };

  const { ap: apCost, sp: spCost, mp: mpCost, lp: lpCost, hp: hpCost } = _getActivationCostValues(activation.costs ?? {});
  if (!apCost && !spCost && !mpCost && !lpCost && !hpCost) return { ok: true, spent: false };

  const ap = _getActorResource(actor, "action_points.value");
  const sp = _getActorResource(actor, "stamina.value");
  const mp = _getActorResource(actor, "magicka.value");
  const lp = _getActorResource(actor, "luck_points.value");
  const hp = _getActorResource(actor, "hp.value");

  const missing = [];
  if (ap < apCost) missing.push("AP");
  if (sp < spCost) missing.push("SP");
  if (!missing.length && spCost > 0 && isActorUndead(actor) && (sp - spCost) < 0) {
    ui.notifications?.warn?.(`Undead cannot spend SP below 0 for ${label}.`);
    return { ok: false, spent: false };
  }
  if (mp < mpCost) missing.push("MP");
  if (lp < lpCost) missing.push("LP");
  if (hp < hpCost) missing.push("HP");

  if (missing.length) {
    ui.notifications?.warn?.(`Insufficient resources to activate ${label}: ${missing.join(", ")}`);
    return { ok: false, spent: false };
  }

  const updateData = {};
  if (apCost) updateData["system.action_points.value"] = ap - apCost;
  if (spCost) updateData["system.stamina.value"] = sp - spCost;
  if (mpCost) updateData["system.magicka.value"] = mp - mpCost;
  if (lpCost) updateData["system.luck_points.value"] = lp - lpCost;
  if (hpCost) updateData["system.hp.value"] = hp - hpCost;

  const ok = await requestUpdateDocument(actor, updateData);
  if (!ok) {
    ui.notifications?.warn?.(`Failed to spend activation costs for ${label}.`);
    return { ok: false, spent: false };
  }
  return { ok: true, spent: true };
}

async function consumeActivationUsage({ item, activation } = {}) {
  if (!item) return { ok: true, consumed: false, previous: null, current: null, source: null };
  if (!_shouldConsumeUsage(activation)) return { ok: true, consumed: false, previous: null, current: null, source: null };

  const usage = _normalizeUsage(activation);
  if (!usage.source) return { ok: true, consumed: false, previous: null, current: null, source: null };

  // If no max is configured and current is 0, treat as unconfigured (no usage tracking).
  if (_num(usage.max) <= 0 && _num(usage.current) <= 0) {
    return { ok: true, consumed: false, previous: null, current: null, source: null };
  }

  const current = Math.max(0, _num(usage.current));
  if (current <= 0) {
    ui.notifications?.warn?.(`No uses remaining for ${item.name}.`);
    return { ok: false, consumed: false, previous: null, current: null, source: usage.source };
  }

  const nextValue = current - 1;
  const updateData = {};
  const rollbackData = {};

  if (usage.source === "usage") {
    updateData["system.activation.usage.current"] = nextValue;
    rollbackData["system.activation.usage.current"] = current;

    const legacy = activation?.uses ?? null;
    const hasLegacy = legacy && (legacy.max != null || legacy.reset != null || legacy.value != null);
    if (hasLegacy) {
      updateData["system.activation.uses.value"] = nextValue;
      rollbackData["system.activation.uses.value"] = _num(legacy.value);
      if (usage.max != null) {
        updateData["system.activation.uses.max"] = usage.max;
        rollbackData["system.activation.uses.max"] = legacy.max ?? 0;
      }
      const p = String(usage.period ?? "").trim();
      const legacyReset = (p === "shortRest" || p === "longRest" || p === "daily" || p === "none")
        ? p
        : (p === "day" ? "daily" : null);
      if (legacyReset) {
        updateData["system.activation.uses.reset"] = legacyReset;
        rollbackData["system.activation.uses.reset"] = legacy.reset ?? "none";
      }
    }
  } else {
    updateData["system.activation.uses.value"] = nextValue;
    rollbackData["system.activation.uses.value"] = current;

    const prevUsage = activation?.usage ?? {};
    updateData["system.activation.usage.current"] = nextValue;
    rollbackData["system.activation.usage.current"] = _num(prevUsage.current);
    if (usage.max != null) {
      updateData["system.activation.usage.max"] = usage.max;
      rollbackData["system.activation.usage.max"] = prevUsage.max ?? 0;
    }
    if (usage.period != null) {
      updateData["system.activation.usage.period"] = usage.period;
      rollbackData["system.activation.usage.period"] = prevUsage.period ?? "";
    }
  }

  const ok = await requestUpdateDocument(item, updateData);
  if (!ok) {
    ui.notifications?.warn?.(`Failed to consume a use for ${item.name}.`);
    return { ok: false, consumed: false, previous: null, current: null, source: usage.source };
  }

  return { ok: true, consumed: true, previous: current, current: nextValue, source: usage.source, rollback: rollbackData };
}

function renderActivationCard({
  item = null,
  actor = null,
  activation = {},
  label = "",
  includeImage = false,
  usageOverride = null,
  textOverride = null,
  resultNotes = []
} = {}) {
  const renderSimple = Boolean(item && activation?.renderFullCard !== true);
  if (renderSimple) {
    const baseHtml = _buildItemDescriptionHtml({ item, includeImage });
    const notes = Array.isArray(resultNotes)
      ? resultNotes.map((note) => String(note ?? "").trim()).filter(Boolean)
      : [];
    if (!notes.length) return baseHtml;
    return `${baseHtml}
    <div class="uesrpg-activation-results" style="margin-top:8px;padding:8px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;background:rgba(0,0,0,0.03);">
      <div><b>Result</b></div>
      <ul style="margin:6px 0 0 18px;">${notes.map((note) => `<li>${foundry.utils.escapeHTML(note)}</li>`).join("")}</ul>
    </div>`;
  }

  const actionType = getActivationActionTypeLabel(activation?.actionType ?? "action");
  const header = _buildActivationHeader({
    label: label || item?.name || "Activation",
    img: item?.img ?? null,
    actor,
    includeImage
  });

  const typeLine = item?.type
    ? `<div class="uesrpg-activation-type"><i><b>${item.type}</b></i></div>`
    : "";

  const costsHtml = _buildActivationCostsHtml(activation.costs ?? {});
  const usage = _normalizeUsage(activation);
  const usageCurrent = (usageOverride && usageOverride.consumed && usageOverride.current != null)
    ? usageOverride.current
    : usage.current;
  const usageMax = usage.max;
  const usagePeriod = _formatUsagePeriod(usage.period);

  let usesHtml = "";
  if (usageMax != null && usageMax > 0) {
    usesHtml = `<div class="uesrpg-activation-uses"><b>Uses:</b> ${usageCurrent}/${usageMax}</div>`;
  } else if (usageCurrent > 0) {
    usesHtml = `<div class="uesrpg-activation-uses"><b>Uses:</b> ${usageCurrent}</div>`;
  }

  const resetHtml = usagePeriod
    ? `<div class="uesrpg-activation-reset"><b>Reset:</b> ${usagePeriod}</div>`
    : "";

  const textBlock = textOverride ?? {};
  const shortText = _firstNonEmptyString(textBlock.short, activation?.text?.short);
  const fullText = _firstNonEmptyString(textBlock.full, activation?.text?.full, item?.system?.description);
  const notes = Array.isArray(resultNotes)
    ? resultNotes.map((note) => String(note ?? "").trim()).filter(Boolean)
    : [];

  const shortHtml = shortText ? `<div class="uesrpg-activation-summary"><i>${shortText}</i></div>` : "";
  const fullHtml = fullText ? `<div class="uesrpg-activation-desc"><i>${fullText}</i></div>` : "";
  const notesHtml = notes.length
    ? `<div class="uesrpg-activation-results" style="margin-top:8px;padding:8px;border:1px solid rgba(0,0,0,0.15);border-radius:6px;background:rgba(0,0,0,0.03);">
      <div><b>Result</b></div>
      <ul style="margin:6px 0 0 18px;">${notes.map((note) => `<li>${foundry.utils.escapeHTML(note)}</li>`).join("")}</ul>
    </div>`
    : "";

  return `${header}
  ${typeLine}
  <div class="uesrpg-activation-meta"><b>Activation:</b> ${actionType}</div>
  ${costsHtml}
  ${usesHtml}
  ${resetHtml}
  ${shortHtml}
  <hr />
  ${fullHtml}
  ${notesHtml}`;
}

async function _appendActivationResultToMessage(message, {
  item = null,
  actor = null,
  activation = {},
  label = "",
  includeImage = false,
  usageOverride = null,
  note = ""
} = {}) {
  const text = String(note ?? "").trim();
  if (!message || !text) return false;
  const existingNotes = foundry.utils.getProperty(message, `flags.${SYSTEM_ID}.activationCard.resultNotes`);
  const notes = Array.isArray(existingNotes)
    ? existingNotes.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
  notes.push(text);
  const resultNotes = notes.slice(-8);
  return safeUpdateChatMessage(message, {
    content: renderActivationCard({
      item,
      actor,
      activation,
      label,
      includeImage,
      usageOverride,
      resultNotes
    }),
    [`flags.${SYSTEM_ID}.activationCard.resultNotes`]: resultNotes
  });
}

export async function executeActivation({
  actor,
  activation,
  label = "Ability",
  includeImage = false,
  event = null,
  renderChat = true,
  context = {},
  textOverride = null
} = {}) {
  if (!activation) return { ok: false };
  if (activation.enabled === false) return { ok: false };

  const validation = validateActivationContext({ actor, activation, context });
  if (!validation.ok) return { ok: false };

  const spendResult = await applyActivationCosts({ actor, activation, label });
  if (!spendResult.ok) return { ok: false };

  if (renderChat) {
    const content = renderActivationCard({
      item: null,
      actor,
      activation,
      label,
      includeImage,
      textOverride
    });
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  return { ok: true };
}

async function _prepareAttackActivationContext({ actor, item, activation, context = {} } = {}) {
  if (!actor) {
    ui.notifications?.warn?.("Attack activation requires an owning actor.");
    return { ok: false };
  }

  let rangeType = item ? getSpellRangeType(item) : "none";
  const attackerToken = _resolveTokenForActor(actor);
  let workingTargets = _getTargetsFromContext(context);
  let aoeTemplateUuid = null;
  let aoeTemplateId = null;

  // ── Target policy override (powers only) ───────────────────────
  if (item?.type === "power") {
    const _fcfg = getFeatureConfig(item);
    const tp = _fcfg.targetPolicy;
    if (tp && tp !== "self") {
      if (tp === "single") {
        // Enforce single-target: keep only the first target
        if (workingTargets.length > 1) {
          ui.notifications?.info?.(`${item.name}: target policy limits to a single target.`);
          workingTargets = [workingTargets[0]];
        }
      } else if (tp === "template") {
        // Force AoE template path regardless of item rangeType
        rangeType = "aoe";
      }
      // "multi" → passthrough (no change needed)
      // "ask"   → future: prompt-based target selection; passthrough for now
    } else if (tp === "self") {
      // Self-target: override targets to caster's own token
      if (attackerToken) {
        workingTargets = [attackerToken];
        // Skip normal range filtering by treating as "none"
        rangeType = "none";
      }
    }
  }

  // Detect AoE from the item's AoE config fields, regardless of rangeType.
  // Many AoE spells/powers use rangeType="ranged" for max-range gating
  // but still need AoE template placement via aoeShape + aoeSize.
  const aoeSpec = getSpellAoEConfig(item);
  const hasValidAoe = aoeSpec && (aoeSpec.sizeMeters > 0 || aoeSpec.pulse);

  if ((rangeType === "ranged" || rangeType === "melee" || rangeType === "aoe" || hasValidAoe) && !attackerToken) {
    ui.notifications?.warn?.("Please place and select a token for this actor.");
    return { ok: false };
  }

  if (hasValidAoe) {
    const includeCaster = Boolean(item?.system?.aoeIncludeCaster);
    const maxRange = getSpellMaxRangeMeters(item);
    const sourceType = (item?.type === "power") ? AOE_SOURCE_TYPES.POWER
      : (item?.type === "weapon") ? AOE_SOURCE_TYPES.WEAPON
      : (item?.type === "spell") ? AOE_SOURCE_TYPES.SPELL
      : AOE_SOURCE_TYPES.ITEM;
    const placed = await AoEService.place({
      sourceType,
      actor,
      token: attackerToken,
      item,
      aoe: {
        shape: aoeSpec?.shape ?? "circle",
        distance: aoeSpec.sizeMeters || 1,
        width: aoeSpec?.widthMeters,
        pulse: Boolean(aoeSpec?.pulse),
        includeCaster,
      },
      options: { maxRange: maxRange ?? undefined, collectTargets: true },
    });
    if (!placed) return { ok: false };
    aoeTemplateId = placed.templateId ?? null;
    aoeTemplateUuid = placed.templateUuid ?? null;
    if (placed.targets?.length) {
      workingTargets = placed.targets;
    } else {
      if (!workingTargets.length) {
        ui.notifications?.info?.("No tokens are affected by the template.");
        workingTargets = [];
      }
    }
  } else if (rangeType === "ranged" || rangeType === "melee") {
    if (workingTargets.length) {
      const res = filterTargetsBySpellRange({
        casterToken: attackerToken,
        targets: workingTargets,
        spell: item
      }) ?? {};

      const validTargets = Array.isArray(res.validTargets) ? res.validTargets : [];
      const rejected = Array.isArray(res.rejected) ? res.rejected : [];
      const maxRange = Number.isFinite(Number(res.maxRange)) ? Number(res.maxRange) : null;

      if (rejected.length) {
        const names = rejected.map((r) => r?.token?.name ?? r?.token?.document?.name ?? "Target").join(", ");
        const rangeLabel = (maxRange != null) ? `${maxRange}m` : "range";
        ui.notifications?.warn?.(`Targets out of range (${rangeLabel}): ${names}`);
      }

      workingTargets = validTargets;
    }
  }

  workingTargets = Array.from(workingTargets ?? []).filter(t => t?.actor);
  if (!workingTargets.length) {
    ui.notifications?.warn?.("This attack requires a target.");
    return { ok: false };
  }

  const hitLocationMode = _getHitLocationMode(activation);
  let hitLocationRaw = null;
  if (hasValidAoe) {
    hitLocationRaw = "Body";
  } else if (hitLocationMode === "manual") {
    hitLocationRaw = await _promptHitLocationChoice({ title: "Select Hit Location" });
    if (!hitLocationRaw) return { ok: false };
  } else {
    const roll = new Roll("1d10");
    await roll.evaluate();
    hitLocationRaw = getHitLocationFromRoll(roll.total);
  }

  const attackMode = _getAttackModeFromActivation(activation);
  const aoeConfig = hasValidAoe
    ? {
        ...(aoeSpec ?? {}),
        isAoE: true,
        templateUuid: aoeTemplateUuid ?? null,
        templateId: aoeTemplateId ?? null
      }
    : null;

  return {
    ok: true,
    attackerToken,
    defenderToken: workingTargets[0] ?? null,
    defenderActor: workingTargets[0]?.actor ?? null,
    targets: workingTargets,
    attackMode,
    hitLocation: hitLocationRaw,
    isAoE: hasValidAoe,
    aoe: aoeConfig,
    context: {
      targets: workingTargets,
      hitLocation: hitLocationRaw,
      isAoE: hasValidAoe,
      aoe: aoeConfig
    }
  };
}

async function _startAttackWorkflow({ actor, item, activation, attackContext } = {}) {
  const attackerToken = attackContext?.attackerToken ?? _resolveTokenForActor(actor);
  if (!attackerToken) {
    ui.notifications?.warn?.("Please place and select a token for this actor.");
    return false;
  }

  const defenderTokens = Array.isArray(attackContext?.targets)
    ? attackContext.targets
    : (attackContext?.defenderToken ? [attackContext.defenderToken] : []);
  if (!defenderTokens.length) {
    ui.notifications?.warn?.("Please target an enemy token.");
    return false;
  }

  const attackMode = attackContext?.attackMode ?? _getAttackModeFromActivation(activation);
  const fatiguePenalty = Number(actor?.system?.fatigue?.penalty ?? 0) || 0;
  const carryPenalty = Number(actor?.system?.carry_rating?.penalty ?? 0) || 0;
  const woundPenalty = Number(actor?.system?.woundPenalty ?? 0) || 0;

  let attackerItemUuid = null;
  let attackerLabel = item?.name ?? "Attack";
  let attackerTarget = 0;

  if (String(actor?.type ?? "") === "NPC") {
    const base = Number(actor?.system?.professions?.combat ?? 0) || 0;
    attackerTarget = base + fatiguePenalty + carryPenalty + woundPenalty;
    attackerItemUuid = "prof:combat";
  } else {
    const style = getExplicitActiveCombatStyleItem(actor) ?? actor?.items?.find?.(i => i.type === "combatStyle") ?? null;
    if (!style) {
      ui.notifications?.warn?.("No Combat Style found on this actor.");
      return false;
    }
    const base = Number(style?.system?.value ?? 0) || 0;
    attackerTarget = base + fatiguePenalty + carryPenalty + woundPenalty;
    attackerItemUuid = style.uuid;
    attackerLabel = `${attackerLabel} - ${style.name}`;
  }

  const activationDamage = _normalizeActivationDamage(activation);
  const activationTags = _normalizeActivationTags(activation);
  const activationContext = (activationDamage || activationTags.length)
    ? {
        itemUuid: item?.uuid ?? null,
        itemName: item?.name ?? null,
        itemImg: item?.img ?? null,
        damage: activationDamage,
        tags: activationTags
      }
    : null;

  await OpposedWorkflow.createPending({
    attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
    defenderTokenUuids: defenderTokens.map(t => t?.document?.uuid ?? t?.uuid).filter(Boolean),
    attackerActorUuid: actor.uuid,
    attackerItemUuid,
    attackerLabel,
    attackerTarget,
    mode: "attack",
    attackMode,
    forcedHitLocation: attackContext?.hitLocation ?? null,
    aoe: attackContext?.aoe ?? null,
    isAoE: Boolean(attackContext?.isAoE),
    activation: activationContext
  });

  return true;
}

export async function executeItemActivation({
  item,
  actor,
  includeImage = false,
  event = null,
  renderChat = true,
  context = {}
} = {}) {
  registerActivationStateHooks();

  if (!item) return { ok: false };

  // ── Feature Config pre-checks (traits/talents/powers) ──────────
  // featureConfig.enabled only gates advanced automation (rule elements,
  // feature-automation dispatch).  Basic activation — chat card, effect
  // transfer, macros — always proceeds so that clicking an item icon on
  // the actor sheet always produces visible results.
  const _featureTypes = new Set(["trait", "talent", "power"]);
  let featureConfig = null;
  let featureAutomationEnabled = true;
  if (_featureTypes.has(item.type)) {
    const fcfg = getFeatureConfig(item);
    featureConfig = fcfg;

    // Master toggle — demoted from hard block to automation-only gate.
    if (fcfg.enabled === false) {
      featureAutomationEnabled = false;
      _activationDebug(`${SYSTEM_ID} | activation: featureConfig.enabled=false, automation disabled but chat+effects will proceed`, item.name);
    }

    // Combat-only gating
    if (fcfg.combatOnly && !game.combat?.started) {
      ui.notifications?.warn?.(`${item.name} can only be used during combat.`);
      return { ok: false };
    }

    // Out-of-combat gating
    if (!fcfg.outOfCombatAllowed && !game.combat?.started) {
      ui.notifications?.warn?.(`${item.name} cannot be used outside of combat.`);
      return { ok: false };
    }

    // Confirm mode: show dialog before proceeding (only when automation is enabled)
    if (featureAutomationEnabled && fcfg.applyMode === "confirm") {
      const confirmed = await _showFeatureConfirmDialog(item, fcfg);
      if (!confirmed) {
        _activationDebug(`${SYSTEM_ID} | activation: CANCELLED by user confirmation`, item.name);
        return { ok: false };
      }
    }
  }

  const activation = item?.system?.activation ?? {};
  // For feature types (trait/talent/power), activation.enabled only controls
  // whether costs are spent and attack workflows run — NOT whether the item
  // can produce a chat card, transfer effects, or trigger automation.
  const isFeatureType = _featureTypes.has(item.type);
  if (activation.enabled === false && !isFeatureType) return { ok: false };

  const activationEnabled = Boolean(activation.enabled);
  const isAttack = activationEnabled && _isAttackActivation(activation);
  const label = item?.name ?? "Ability";

  let attackContext = null;
  let mergedContext = context;
  let usageResult = { ok: true };
  let activationMessage = null;

  // ── Activation mechanics (costs, validation, attack workflow) ──
  // Only run when activation.enabled is true; non-activated features skip
  // straight to the chat card + effect transfer + automation sections.
  if (activationEnabled) {
    if (isAttack) {
      attackContext = await _prepareAttackActivationContext({ actor, item, activation, context });
      if (!attackContext?.ok) return { ok: false };
      mergedContext = { ...(context ?? {}), ...(attackContext.context ?? {}) };
    }

    const validation = validateActivationContext({ actor, activation, context: mergedContext });
    if (!validation.ok) return { ok: false };

    // Racial talent/power gating (Chapter 4): per-rest limits and legacy-safe constraints.
    try {
      if (item?.type === "talent" || item?.type === "power") {
        const itemKey = _resolveTalentAutomationKey(item);
        const v = validateRacialActivationAvailability({ actor, item, itemKey });
        if (!v.ok) {
          ui.notifications?.warn?.(String(v.reason ?? "Activation blocked."));
          return { ok: false };
        }
        // Inspire Heroism (Chapter 4): once-per-round gating.
        if (itemKey === "inspireheroism") {
          const ih = validateInspireHeroismAvailability({ actor });
          if (!ih.ok) {
            ui.notifications?.warn?.(String(ih.reason ?? "Activation blocked."));
            return { ok: false };
          }
        }
      }
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Racial activation preflight failed`, err);
    }

    usageResult = await consumeActivationUsage({ item, activation });
    if (!usageResult.ok) return { ok: false };

    const spendResult = await applyActivationCosts({ actor, activation, label });
    if (!spendResult.ok) {
      if (usageResult.consumed && usageResult.rollback && Object.keys(usageResult.rollback).length) {
        const rolledBack = await requestUpdateDocument(item, usageResult.rollback);
        if (!rolledBack) ui.notifications?.warn?.(`Failed to restore uses for ${item.name}.`);
      }
      return { ok: false };
    }

    await _applyActivationActorFlags({ item, actor, activation });
  }

  if (renderChat) {
    const content = renderActivationCard({
      item,
      actor,
      activation,
      label,
      includeImage,
      usageOverride: usageResult
    });
    const whisper = (featureConfig?.visibility === "gmOnly")
      ? (game.users?.filter((u) => u?.isGM).map((u) => u.id) ?? [])
      : [];
    activationMessage = await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      whisper,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }

  // Unified feature automation entrypoint (traits/talents/powers).
  // Feature-config checks are already enforced above in executeItemActivation.
  let dispatchedByFeatureAutomation = false;

  // ── Feature Effect Transfer to Targets ───────────────────────────
  // If the item has non-disabled AEs and the user has targets selected,
  // clone those effects onto the targeted actors automatically.
  // No opt-in flag required — having AEs + targets = transfer.
  if (item?.type === "trait" || item?.type === "talent" || item?.type === "power") {
    if (featureNeedsEffectTransfer(item)) {
      const fcfg = featureConfig ?? getFeatureConfig(item);
      const rawTargets = _getTargetsFromContext(mergedContext);
      const targetActors = rawTargets
        .map(t => t?.actor ?? t?.document?.actor ?? null)
        .filter(Boolean)
        // Exclude self (the activating actor) unless no other targets exist
        .filter(ta => ta.id !== actor?.id);

      if (targetActors.length) {
        try {
          const result = await applyFeatureEffectsToTargets(actor, item, targetActors, { featureConfig: fcfg });
          if (result.targets.length) {
            const names = result.targets.join(", ");
            const note = `Applied ${result.applied} effect(s) to ${names}.`;
            const updated = activationMessage
              ? await _appendActivationResultToMessage(activationMessage, {
                  item,
                  actor,
                  activation,
                  label,
                  includeImage,
                  usageOverride: usageResult,
                  note
                })
              : false;
            if (!updated) {
              await ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker({ actor }),
                content: `<div class="uesrpg"><b>${item.name}</b>: ${note}</div>`,
                style: CONST.CHAT_MESSAGE_STYLES.OTHER,
              });
            }
          }
        } catch (err) {
          console.warn(`${SYSTEM_ID} | Feature effect transfer failed`, { item: item?.name, err });
        }
      } else if (rawTargets.length > 0) {
        // Targets existed but all were self-excluded
        ui.notifications?.info?.(`${item.name}: Cannot transfer effects to self \u2014 select a different target.`);
        _activationDebug(`${SYSTEM_ID} | feature-effects: item has AEs but no valid targets (self excluded)`, item.name);
      } else {
        // No targets selected at all — prompt user
        ui.notifications?.info?.(`${item.name} has activation effects \u2014 select target token(s) to transfer them.`);
        _activationDebug(`${SYSTEM_ID} | feature-effects: item has activation AEs but no targets selected`, item.name);
      }
    }
  }

  // Feature automation dispatch — only runs when featureConfig.enabled is true.
  // When disabled via the Automation tab, basic activation (chat + effects + macro)
  // still proceeds above, but rule-element automation is skipped.
  if (featureAutomationEnabled && (item?.type === "trait" || item?.type === "talent" || item?.type === "power")) {
    try {
      dispatchedByFeatureAutomation = await runFeatureAutomation({
        actor,
        item,
        context: mergedContext,
        enforceFeatureConfig: false
      });
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Feature automation dispatch failed`, err);
    }
  }

  // Legacy activation handlers remain authoritative until dispatcher migration is complete.
  if (featureAutomationEnabled && !dispatchedByFeatureAutomation && item?.type === "talent") {
    await runTalentActivationAutomation({ item, actor, context: mergedContext });
  } else if (featureAutomationEnabled && !dispatchedByFeatureAutomation && item?.type === "power") {
    try {
      const k = _resolveTalentAutomationKey(item);
      await handleRacialPowerActivation({ actor, item, itemKey: k });
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Talent activation automation failed`, err);
    }
  }

  if (item) await executeItemMacroBestEffort(item, { event });
  if (isAttack) {
    const ok = await _startAttackWorkflow({ actor, item, activation, attackContext });
    if (!ok) return { ok: false };
  }
  return { ok: true };
}

export async function executeItemMacroBestEffort(item, { event } = {}) {
  try {
    const itemMacroActive = game.modules.get("itemacro")?.active;
    const canExecute = itemMacroActive && typeof item.executeMacro === "function" && typeof item.hasMacro === "function" && item.hasMacro();
    if (canExecute) await item.executeMacro({ event });
  } catch (err) {
    console.warn(`${SYSTEM_ID} | ItemMacro execution failed`, err);
  }
}

export function buildSpecialActionActivation({ actionType = "action", apCost = 1, requiresTarget = true } = {}) {
  const mappedType = (actionType === "secondary" || actionType === "reaction" || actionType === "free")
    ? actionType
    : "action";

  return {
    enabled: true,
    actionType: mappedType,
    spendCosts: true,
    consumeUse: false,
    costs: {
      action_points: Math.max(0, _num(apCost)),
      stamina: 0,
      magicka: 0,
      luck_points: 0,
      health: 0
    },
    requirements: {
      requiresTarget: Boolean(requiresTarget),
      requiresEquippedWeapon: false,
      requiresMelee: false,
      requiresRanged: false,
      requiresHitLocation: false
    }
  };
}


// ─── Feature Config Confirmation Dialog ──────────────────────────────

/**
 * Show a confirmation dialog when a feature's applyMode is "confirm".
 * Routes visibility based on promptMode.
 *
 * @param {Item} item
 * @param {object} fcfg - Feature config from getFeatureConfig
 * @returns {Promise<boolean>} true if confirmed
 */
async function _showFeatureConfirmDialog(item, fcfg) {
  const promptMode = fcfg.promptMode ?? "owner";
  const isGM = game.user.isGM;
  const isOwner = item.isOwner;

  let shouldPrompt = false;
  switch (promptMode) {
    case "gm":    shouldPrompt = isGM; break;
    case "owner": shouldPrompt = isOwner; break;
    case "both":  shouldPrompt = isGM || isOwner; break;
    case "never": return true;
    default:      shouldPrompt = isOwner; break;
  }

  if (!shouldPrompt) return true;

  try {
    const confirmed = await confirmDialog({
      title: `Confirm: ${item.name}`,
      content: `<p>Activate <strong>${item.name}</strong>?</p>`,
      yesLabel: "Activate",
      noLabel: "Cancel",
      yesIcon: "fas fa-bolt",
      noIcon: "fas fa-times",
      rejectClose: false,
    });
    return confirmed === true;
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Feature confirm dialog error`, err);
    return false;
  }
}
