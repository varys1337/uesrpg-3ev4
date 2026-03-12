/**
 * src/core/combat/chat-handlers/combat-chat-apply.js
 *
 * Damage / healing application handlers for chat card buttons.
 * Also exports resolveActor and getWhisperRecipients for use by other chat-handler modules.
 */

import { applyHealing, DAMAGE_TYPES } from "../damage-automation.js";
import { applyDamageResolved } from "../damage-resolver.js";
import { doesUserOwnActor, requestUpdateChatMessage, requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { cloneFlagState } from "../../../utils/clone.js";
import {
  getMessageState as getMagicMessageState,
  isMultiDefender as isMagicMultiDefender,
  getMagicDefenderDamage, setMagicDefenderDamage,
  getDefenderEntries as getMagicDefenderEntries,
} from "../../magic/opposed/schema.js";
import { renderCard as renderMagicCard } from "../../magic/opposed/render.js";
import { applyMagicDamage, applyMagicHealing } from "../../magic/damage-application.js";
import { applySpellEffectsToTarget } from "../../magic/effects/spell-effects.js";
import { safeUpdateChatMessage } from "../../../utils/chat-message-socket.js";
import {
  _isMultiDefender, _getDefenderDamage, _setDefenderDamage,
  _getDefenderEntries, _isBankChoicesEnabledForData, _getBankCommitState,
  _anyActiveGMOnline, _allDefendersCommitted,
  _getDefenderOutcome, _getDefenderAdvantage, _getDefenderResolutionState,
} from "../opposed/schema.js";
import { renderSingleDefenderCard, renderMultiDefenderCard } from "../opposed/cards/renderers.js";
import { updateCard } from "../opposed/cards/updater.js";
import { _safeGetSetting } from "../opposed/helpers/util.js";
import { resolveActorFromUuidSync, resolveUuidSync } from "../../../utils/uuid-cache.js";
import { FLAG_SCOPE } from "../../system/namespace.js";

const _FLAG_NS = FLAG_SCOPE;

// ── Shared helpers (exported for use by other chat-handler modules) ───────────

/**
 * Resolve an Actor from a UUID or speaker.
 * @param {ChatMessage} message
 * @param {string|null} uuid
 * @returns {Actor|null}
 */
export function resolveActor(message, uuid) {
  if (uuid) {
    const actor = resolveActorFromUuidSync(uuid);
    if (actor) return actor;
  }
  const sp = message?.speaker;
  if (sp?.token) return canvas?.tokens?.get(sp.token)?.actor ?? null;
  if (sp?.actor) return game.actors?.get(sp.actor) ?? null;
  return null;
}

/**
 * Build the whisper recipient list for a given actor (all GMs + actor owners).
 * @param {Actor} actor
 * @returns {string[]}
 */
export function getWhisperRecipients(actor) {
  const out = new Set();
  const users = game.users?.contents ?? [];
  for (const user of users) {
    if (!user) continue;
    if (user.isGM) {
      out.add(user.id);
      continue;
    }
    if (doesUserOwnActor(user, actor)) out.add(user.id);
  }
  return Array.from(out);
}

// ── Opposed card inline-damage marking ──────────────────────────────────────

async function _markInlineDamageApplied(message, targetUuid, { gmDamageReport = null } = {}) {
  const raw = message?.flags?.[_FLAG_NS]?.opposed;
  if (!raw) return;
  const data = foundry.utils.deepClone(raw);

  let defender = null;
  if (_isMultiDefender(data)) {
    const list = data.defenders ?? [];
    defender = list.find(d =>
      (d.actorUuid && d.actorUuid === targetUuid) ||
      (d.tokenUuid && d.tokenUuid === targetUuid)
    ) ?? null;
  } else {
    defender = data.defender ?? null;
  }
  if (!defender) return;

  const dmg = _getDefenderDamage(data, defender);
  if (!dmg || dmg.applied) return;

  dmg.applied = true;
  if (gmDamageReport && typeof gmDamageReport === "object") {
    dmg.gmDamageReport = foundry.utils.deepClone(gmDamageReport);
  }
  _setDefenderDamage(data, defender, dmg);

  const helpers = {
    _getDefenderEntries, _isBankChoicesEnabledForData, _anyActiveGMOnline,
    _getBankCommitState, _getDefenderOutcome, _getDefenderAdvantage,
    _getDefenderResolutionState, _allDefendersCommitted, _isMultiDefender,
    _safeGetSetting,
  };
  const _renderCard = (d, msgId) =>
    _isMultiDefender(d) ? renderMultiDefenderCard(d, msgId, helpers) : renderSingleDefenderCard(d, msgId, helpers);
  await updateCard(message, data, _renderCard);
}

async function _markMagicInlineDamageApplied(message, targetUuid, { gmDamageReport = null } = {}) {
  const raw = message?.flags?.["uesrpg-3ev4"]?.magicOpposed;
  if (!raw) return;
  const data = cloneFlagState(raw.state ?? raw);

  let defender = null;
  if (isMagicMultiDefender(data)) {
    const list = getMagicDefenderEntries(data);
    defender = list.find(d =>
      (d.actorUuid && d.actorUuid === targetUuid) ||
      (d.tokenUuid && d.tokenUuid === targetUuid)
    ) ?? null;
  } else {
    defender = data.defender ?? null;
  }
  if (!defender) return;

  const dmg = getMagicDefenderDamage(data, defender);
  if (!dmg || dmg.applied) return;

  dmg.applied = true;
  if (gmDamageReport && typeof gmDamageReport === "object") {
    dmg.gmDamageReport = foundry.utils.deepClone(gmDamageReport);
  }
  setMagicDefenderDamage(data, defender, dmg);

  const _FLAG_KEY = "magicOpposed";
  const version = Number(raw.version ?? 2);
  const content = renderMagicCard(data, message.id);
  const payload = {
    content,
    flags: { [_FLAG_NS]: { [_FLAG_KEY]: { version, state: data } } },
  };
  await safeUpdateChatMessage(message, payload);
}

// ── Magic inline damage / healing ────────────────────────────────────────────

async function _onApplyMagicDamage(ev, message, btn) {
  const targetUuid = btn.dataset.targetUuid || null;

  const targetActor = resolveActor(message, targetUuid);
  if (!targetActor) {
    ui.notifications.warn("No valid target actor found for magic damage application.");
    return;
  }

  const data = getMagicMessageState(message);
  if (!data) {
    ui.notifications.warn("Could not read magic opposed card state.");
    return;
  }

  let defender = null;
  if (isMagicMultiDefender(data)) {
    const list = getMagicDefenderEntries(data);
    defender = list.find(d =>
      (d.actorUuid && d.actorUuid === targetUuid) ||
      (d.tokenUuid && d.tokenUuid === targetUuid)
    ) ?? null;
  } else {
    defender = data.defender ?? null;
  }

  const dmgData = getMagicDefenderDamage(data, defender);
  if (!dmgData || dmgData.applied) return;

  const mp = dmgData._magicPayload;
  if (!mp) {
    ui.notifications.warn("No stored magic payload found for deferred damage application.");
    return;
  }

  const spell = mp.spellUuid ? resolveUuidSync(mp.spellUuid) : null;
  const casterActor = mp.casterUuid ? resolveActorFromUuidSync(mp.casterUuid) : null;

  if (mp.isDamaging === false && !mp.isHealing) {
    if (mp.needsEffects && spell) {
      try {
        await applySpellEffectsToTarget(casterActor, targetActor, spell, {
          actualCost: Number(mp.actualCost ?? 0),
          originalCastWorldTime: Number(mp.originalCastWorldTime ?? 0),
          casterTokenUuid: mp.casterTokenUuid ?? null,
        });
      } catch (err) {
        console.error("UESRPG | Failed to apply spell effects (effects-only):", err);
      }
    }
    try {
      Hooks.callAll("uesrpg.spellHitTarget", {
        caster: casterActor,
        target: targetActor,
        spell,
        hitLocation: mp.hitLocation ?? "Body",
        defenseType: mp.defenseType ?? "",
        isCritical: Boolean(mp.isCritical),
        isDamaging: false,
      });
    } catch (_e) { /* no-op */ }

    await _markMagicInlineDamageApplied(message, targetUuid);
    return;
  }

  const damageResult = await applyMagicDamage(targetActor, Number(mp.damage ?? 0), mp.damageType || "magic", spell, {
    hitLocation: mp.hitLocation ?? "Body",
    isCritical: Boolean(mp.isCritical),
    source: mp.source ?? "Spell",
    rollHTML: mp.rollHTML ?? "",
    isOverloaded: Boolean(mp.isOverloaded),
    overloadBonus: Number(mp.overloadBonus ?? 0),
    isOvercharged: Boolean(mp.isOvercharged),
    overchargeTotals: mp.overchargeTotals ?? null,
    elementalBonus: Number(mp.elementalBonus ?? 0),
    elementalBonusLabel: mp.elementalBonusLabel ?? "",
    casterActor,
    magicCost: Number(mp.magicCost ?? 0),
    skipChatMessage: true,
  });

  if (damageResult?.spellAbsorbed) {
    await _markMagicInlineDamageApplied(message, targetUuid);
    return;
  }

  if (mp.needsEffects && spell) {
    try {
      await applySpellEffectsToTarget(casterActor, targetActor, spell, {
        actualCost: Number(mp.actualCost ?? 0),
        originalCastWorldTime: Number(mp.originalCastWorldTime ?? 0),
        casterTokenUuid: mp.casterTokenUuid ?? null,
      });
    } catch (err) {
      console.error("UESRPG | Failed to apply deferred spell effects:", err);
    }
  }

  try {
    Hooks.callAll("uesrpg.spellHitTarget", {
      caster: casterActor,
      target: targetActor,
      spell,
      hitLocation: mp.hitLocation ?? "Body",
      defenseType: mp.defenseType ?? "",
      isCritical: Boolean(mp.isCritical),
      isDamaging: true,
    });
  } catch (_e) { /* no-op */ }

  await _markMagicInlineDamageApplied(message, targetUuid, {
    gmDamageReport: damageResult?.gmDamageReport ?? null
  });
}

async function _onApplyMagicHealing(ev, message, btn) {
  const targetUuid = btn.dataset.targetUuid || null;

  const targetActor = resolveActor(message, targetUuid);
  if (!targetActor) {
    ui.notifications.warn("No valid target actor found for magic healing.");
    return;
  }

  const data = getMagicMessageState(message);
  if (!data) {
    ui.notifications.warn("Could not read magic opposed card state.");
    return;
  }

  let defender = null;
  if (isMagicMultiDefender(data)) {
    const list = getMagicDefenderEntries(data);
    defender = list.find(d =>
      (d.actorUuid && d.actorUuid === targetUuid) ||
      (d.tokenUuid && d.tokenUuid === targetUuid)
    ) ?? null;
  } else {
    defender = data.defender ?? null;
  }

  const dmgData = getMagicDefenderDamage(data, defender);
  if (!dmgData || dmgData.applied) return;

  const mp = dmgData._magicPayload;
  if (!mp) {
    ui.notifications.warn("No stored magic payload found for deferred healing.");
    return;
  }

  const spell = mp.spellUuid ? resolveUuidSync(mp.spellUuid) : null;
  const casterActor = mp.casterUuid ? resolveActorFromUuidSync(mp.casterUuid) : null;

  const healResult = await applyMagicHealing(targetActor, Number(mp.damage ?? 0), spell, {
    source: mp.source ?? "Spell",
    rollHTML: mp.rollHTML ?? "",
    isTemporary: Boolean(mp.isTemporary),
    casterActor,
    magicCost: Number(mp.magicCost ?? 0),
  });

  if (healResult?.spellAbsorbed) {
    await _markMagicInlineDamageApplied(message, targetUuid);
    return;
  }

  if (mp.needsEffects && spell) {
    try {
      await applySpellEffectsToTarget(casterActor, targetActor, spell, {
        actualCost: Number(mp.actualCost ?? 0),
        originalCastWorldTime: Number(mp.originalCastWorldTime ?? 0),
        casterTokenUuid: mp.casterTokenUuid ?? null,
      });
    } catch (err) {
      console.error("UESRPG | Failed to apply deferred spell effects after healing:", err);
    }
  }

  await _markMagicInlineDamageApplied(message, targetUuid);
}

// ── Public handlers ───────────────────────────────────────────────────────────

export async function onApplyDamage(ev, message) {
  ev.preventDefault();

  const btn = ev.currentTarget;

  if (String(btn.dataset.magic ?? "0") === "1") {
    return _onApplyMagicDamage(ev, message, btn);
  }

  const targetUuid = btn.dataset.targetUuid || null;
  const rawDamage = Number(btn.dataset.damage || 0);
  const damageType = btn.dataset.damageType || DAMAGE_TYPES.PHYSICAL;
  const dosBonus = Number(btn.dataset.dosBonus || 0);
  const penetration = Number(btn.dataset.penetration || 0);
  const hitLocation = btn.dataset.hitLocation || "Body";
  const damagedValue = Number(btn.dataset.damagedValue || 0);
  const source = btn.dataset.source || (message?.speaker?.alias ?? "Unknown");
  const penetrateArmorForTriggers = String(btn.dataset.penetrateArmor ?? "0") === "1";
  const forcefulImpact = String(btn.dataset.forcefulImpact ?? "0") === "1";
  const pressAdvantage = String(btn.dataset.pressAdvantage ?? "0") === "1";
  const ignoreReduction = String(btn.dataset.ignoreReduction ?? "0") === "1";
  const magicSource = String(btn.dataset.magicSource ?? "0") === "1";
  const sourceItemUuid = btn.dataset.sourceItemUuid || null;
  const attackMode = String(btn.dataset.attackMode ?? "").trim() || null;
  const movementAction = String(btn.dataset.movementAction ?? "").trim() || null;
  const attackFromHidden = (String(btn.dataset.attackHidden ?? "").trim() === "1")
    ? true
    : (String(btn.dataset.attackHidden ?? "").trim() === "0" ? false : null);
  const ammoUuid = String(btn.dataset.ammoUuid ?? "").trim() || null;
  let damageComponents = null;
  {
    const raw = String(btn.dataset.damageComponents ?? "").trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) damageComponents = parsed;
      } catch (_e) {
        damageComponents = null;
      }
    }
  }

  const attackerActorUuid = btn.dataset.attackerActorUuid || null;
  const weaponUuid = btn.dataset.weaponUuid || null;

  const targetActor = resolveActor(message, targetUuid);
  if (!targetActor) {
    ui.notifications.warn("No valid target actor found for damage application.");
    return;
  }

  const attackerActor = attackerActorUuid ? resolveActorFromUuidSync(attackerActorUuid) : null;
  const weapon = weaponUuid ? resolveUuidSync(weaponUuid) : null;

  const damageResult = await applyDamageResolved(targetActor, {
    rawDamage,
    damageType,
    dosBonus,
    penetration,
    hitLocation,
    damagedValue,
    source,
    ignoreReduction,
    penetrateArmorForTriggers,
    forcefulImpact,
    pressAdvantage,
    weapon,
    attackerActor,
    magicSource,
    sourceItemUuid,
    attackMode,
    movementAction,
    attackFromHidden,
    ammoUuid,
    damageComponents,
    chatContext: {
      parentMessageId: message?.id ?? null,
      suppressStandaloneSummary: true,
    },
  });

  await _markInlineDamageApplied(message, targetUuid, {
    gmDamageReport: damageResult?.gmDamageReport ?? null
  });
}

export async function onApplyHealing(ev, message) {
  ev.preventDefault();

  const btn = ev.currentTarget;

  if (String(btn.dataset.magic ?? "0") === "1") {
    return _onApplyMagicHealing(ev, message, btn);
  }

  const targetUuid = btn.dataset.targetUuid || null;
  const healing = Number(btn.dataset.healing || 0);
  const source = btn.dataset.source || (message?.speaker?.alias ?? "Healing");
  const isTemporary = String(btn.dataset.tempHp ?? "0") === "1";

  const targetActor = resolveActor(message, targetUuid);
  if (!targetActor) {
    ui.notifications.warn("No valid target actor found for healing.");
    return;
  }

  await applyHealing(targetActor, healing, { source, isTemporary });

  await _markInlineDamageApplied(message, targetUuid);
}
