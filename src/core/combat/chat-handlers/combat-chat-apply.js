import { updateCard as updateMagicCard } from "../../magic/opposed/updater.js";
import { _renderCard as renderCombatCard } from "../opposed/render.js";
import { getOwnerAndGmRecipientIds as getWhisperRecipients } from '../../../utils/chat-recipients.js';
export { getWhisperRecipients };
/**
 * src/core/combat/chat-handlers/combat-chat-apply.js
 *
 * Damage / healing application handlers for chat card buttons.
 * Also exports resolveActor and getWhisperRecipients for use by other chat-handler modules.
 */

import { DAMAGE_TYPES } from "../damage-automation.js";
import { doesUserOwnActor } from "../../../utils/authority-proxy.js";

import {
  getMessageState as getMagicMessageState,
  isMultiDefender as isMagicMultiDefender,
  getMagicDefenderDamage, setMagicDefenderDamage,
  getDefenderEntries as getMagicDefenderEntries,
} from "../../magic/opposed/schema.js";
import { renderCard as renderMagicCard } from "../../magic/opposed/render.js";
import { applyMagicDamage, applyMagicHealing } from "../../magic/damage-application.js";
import { applyResolvedSpellEffects } from "../../magic/effects/spell-effects.js";
import { applySpellResourceRestoration } from "../../magic/services/resource-restoration-service.js";

import { _isMultiDefender, _getDefenderDamage, _setDefenderDamage, _getDefenderEntries } from "../opposed/schema.js";

import { updateCard } from "../opposed/cards/updater.js";

import { resolveActorFromUuidSync, resolveUuidSync } from "../../../utils/uuid-cache.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { ApplyDamageService } from "../../../application/combat/apply-damage-service.js";
import {
  AUTHORITY_RESULT_CODES,
  registerAuthorityIntentCommand,
  registerAuthorityIntentService,
  requestAuthorityIntent,
} from "../../../utils/authority-intents.js";
import { acquireLock, releaseLock } from "../../../utils/authority-proxy/shared.js";
import { getActiveGMUser } from "../../../utils/users.js";

const _FLAG_NS = FLAG_SCOPE;
const COMBAT_OUTCOME_INTENT = "combat.applyOutcome";
let _combatOutcomeIntentRegistered = false;

function _getCanonicalOutcome(message, targetUuid, requestedKind = null) {
  const normalizedTarget = String(targetUuid ?? "").trim();
  if (!message || !normalizedTarget) return null;

  const magicData = getMagicMessageState(message);
  if (magicData) {
    const defender = isMagicMultiDefender(magicData)
      ? getMagicDefenderEntries(magicData).find((entry) => (
          entry?.actorUuid === normalizedTarget || entry?.tokenUuid === normalizedTarget
        ))
      : magicData.defender;
    const damage = getMagicDefenderDamage(magicData, defender);
    const payload = damage?._magicPayload;
    const applyPayload = damage?.applyPayload;
    const kind = payload?.isHealing === true ? "healing" : "damage";
    if (!defender || !damage || damage.applied || !payload || applyPayload?.targetUuid !== normalizedTarget) return null;
    if (requestedKind && requestedKind !== kind) return null;
    return {
      kind,
      sourceActorUuid: String(payload.casterUuid ?? magicData?.attacker?.actorUuid ?? "").trim(),
      targetUuid: normalizedTarget,
      revision: Number(magicData?.context?.updatedSeq ?? magicData?.context?.updatedAt ?? 0) || 0,
      dataset: foundry.utils.deepClone(applyPayload),
    };
  }

  const data = message?.flags?.[_FLAG_NS]?.opposed;
  if (!data || typeof data !== "object") return null;
  const defender = _isMultiDefender(data)
    ? _getDefenderEntries(data).find((entry) => (
        entry?.actorUuid === normalizedTarget || entry?.tokenUuid === normalizedTarget
      ))
    : data.defender;
  const damage = _getDefenderDamage(data, defender);
  const applyPayload = damage?.applyPayload;
  const kind = String(damage?.mode ?? "").toLowerCase() === "healing" ? "healing" : "damage";
  if (!defender || !damage || damage.applied || !applyPayload || applyPayload.targetUuid !== normalizedTarget) return null;
  if (requestedKind && requestedKind !== kind) return null;
  return {
    kind,
    sourceActorUuid: String(applyPayload.attackerActorUuid ?? data?.attacker?.actorUuid ?? "").trim(),
    targetUuid: normalizedTarget,
    revision: Number(data?.context?.updatedSeq ?? data?.context?.updatedAt ?? 0) || 0,
    dataset: foundry.utils.deepClone(applyPayload),
  };
}

function _requesterOwnsOutcomeSource(requester, message, outcome) {
  if (requester?.isGM) return true;
  const sourceActor = outcome?.sourceActorUuid
    ? resolveActorFromUuidSync(outcome.sourceActorUuid)
    : null;
  if (sourceActor) return doesUserOwnActor(requester, sourceActor);
  const targetActor = resolveActor(message, outcome?.targetUuid);
  return doesUserOwnActor(requester, targetActor);
}

async function _requestCombatOutcome(message, targetUuid, kind) {
  const outcome = _getCanonicalOutcome(message, targetUuid, kind);
  if (!outcome) return false;
  const result = await requestAuthorityIntent(COMBAT_OUTCOME_INTENT, {
    messageId: message.id,
    targetUuid: outcome.targetUuid,
    kind: outcome.kind,
  }, { expectedRevision: outcome.revision });
  if (!result?.ok) {
    const warning = result?.code === AUTHORITY_RESULT_CODES.NO_ACTIVE_GM
      ? "An active GM is required to apply this outcome."
      : "The GM rejected this combat outcome.";
    ui.notifications?.warn?.(warning);
  }
  return result?.ok === true;
}

export function registerCombatOutcomeAuthorityIntent() {
  if (_combatOutcomeIntentRegistered) return;
  _combatOutcomeIntentRegistered = true;
  registerAuthorityIntentService();
  registerAuthorityIntentCommand(COMBAT_OUTCOME_INTENT, async ({ requester, data, expectedRevision }) => {
    const messageId = String(data?.messageId ?? "").trim();
    const targetUuid = String(data?.targetUuid ?? "").trim();
    const kind = String(data?.kind ?? "").trim();
    if (!messageId || !targetUuid || !["damage", "healing"].includes(kind)) {
      return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
    }

    const lockKey = `CombatOutcome:${messageId}:${targetUuid}`;
    let acquired = false;
    try {
      await acquireLock(lockKey);
      acquired = true;
      const message = game.messages?.get?.(messageId) ?? null;
      const outcome = _getCanonicalOutcome(message, targetUuid, kind);
      if (!outcome) return { ok: false, code: AUTHORITY_RESULT_CODES.CONFLICT };
      if (Number(expectedRevision ?? outcome.revision) !== outcome.revision) {
        return { ok: false, code: AUTHORITY_RESULT_CODES.STALE_REVISION };
      }
      if (!_requesterOwnsOutcomeSource(requester, message, outcome)) {
        return { ok: false, code: AUTHORITY_RESULT_CODES.UNAUTHORIZED };
      }

      await _updateInlineApplication(message, targetUuid, (damage) => { damage.applicationStatus = 'pending'; });
      const event = { preventDefault() {}, currentTarget: { dataset: outcome.dataset } };
      if (kind === "healing") await onApplyHealing(event, message, { authoritative: true });
      else await onApplyDamage(event, message, { authoritative: true });

      const unapplied = _getCanonicalOutcome(game.messages?.get?.(messageId), targetUuid, kind);
      if (unapplied) {
        await _updateInlineApplication(message, targetUuid, (damage) => { damage.applicationStatus = 'failed'; });
        return { ok: false, code: AUTHORITY_RESULT_CODES.FAILED };
      }
      return { ok: true };
    } catch (error) {
      console.error("UESRPG | combat outcome authority intent failed", error);
      const message = game.messages?.get?.(messageId);
      if (message) {
        try { await _updateInlineApplication(message, targetUuid, (damage) => { if (!damage.applied) damage.applicationStatus = 'failed'; }); }
        catch (reportError) { console.warn('UESRPG | Could not save failed application feedback', reportError); }
      }
      return { ok: false, code: AUTHORITY_RESULT_CODES.FAILED };
    } finally {
      if (acquired) releaseLock(lockKey);
    }
  });
}

function _mergeSupplementalGmDamageReport(existing, supplemental) {
  if (!supplemental || typeof supplemental !== "object") return existing ? foundry.utils.deepClone(existing) : null;
  if (!existing || typeof existing !== "object") return foundry.utils.deepClone(supplemental);

  const merged = foundry.utils.deepClone(existing);
  const extra = foundry.utils.deepClone(supplemental);

  merged.panelKey = String(existing?.panelKey ?? supplemental?.panelKey ?? "").trim() || `gm-damage:${Date.now()}`;
  merged.totalDamage = Math.max(0, Number(existing?.totalDamage ?? 0) || 0) + Math.max(0, Number(extra?.totalDamage ?? 0) || 0);

  const existingHp = existing?.hp ?? {};
  const extraHp = extra?.hp ?? {};
  merged.hp = {
    value: Number(extraHp?.value ?? existingHp?.value ?? 0) || 0,
    max: Number(existingHp?.max ?? extraHp?.max ?? 0) || 0,
    delta: Math.max(0, Number(existingHp?.delta ?? 0) || 0) + Math.max(0, Number(extraHp?.delta ?? 0) || 0),
  };

  if (existing?.tempHp || extra?.tempHp) {
    const existingTemp = existing?.tempHp ?? {};
    const extraTemp = extra?.tempHp ?? {};
    merged.tempHp = {
      value: Number(extraTemp?.value ?? existingTemp?.value ?? 0) || 0,
      absorbed: Math.max(0, Number(existingTemp?.absorbed ?? 0) || 0) + Math.max(0, Number(extraTemp?.absorbed ?? 0) || 0),
    };
  } else {
    merged.tempHp = null;
  }

  merged.buffers = Array.isArray(extra?.buffers) ? extra.buffers : (Array.isArray(existing?.buffers) ? existing.buffers : []);
  merged.defeated = Boolean(existing?.defeated) || Boolean(extra?.defeated);
  merged.woundTriggered = Boolean(existing?.woundTriggered) || Boolean(extra?.woundTriggered);
  merged.woundThreshold = Number(extra?.woundThreshold ?? existing?.woundThreshold ?? 0) || 0;

  const traitNotes = [
    ...(Array.isArray(existing?.traitNotes) ? existing.traitNotes : []),
    ...(Array.isArray(extra?.traitNotes) ? extra.traitNotes : []),
  ].map((note) => String(note ?? "").trim()).filter(Boolean);
  merged.traitNotes = Array.from(new Set(traitNotes));

  const extraSegments = (Array.isArray(extra?.segments) ? extra.segments : []).map((segment) => {
    const cloned = foundry.utils.deepClone(segment);
    const sourceLabel = String(extra?.source ?? "Follow-up").trim();
    cloned.sourceNotes = [
      `Follow-up: ${sourceLabel}`,
      ...(Array.isArray(cloned?.sourceNotes) ? cloned.sourceNotes : []),
    ];
    return cloned;
  });
  merged.segments = [
    ...(Array.isArray(existing?.segments) ? foundry.utils.deepClone(existing.segments) : []),
    ...extraSegments,
  ];

  return merged;
}

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


// ── Opposed card inline-damage marking ──────────────────────────────────────

function _resolvedDamageComponents(components) {
  if (!Array.isArray(components)) return null;
  const normalized = components
    .map((component) => ({
      kind: String(component?.kind ?? "external"),
      sourceLabel: String(component?.sourceLabel ?? "").trim() || null,
      displayLabel: String(component?.displayLabel ?? "").trim() || null,
      damageType: String(component?.damageType ?? "physical").trim().toLowerCase() || "physical",
      amount: Math.max(0, Number(component?.rawDamage ?? component?.amount ?? 0) || 0),
    }))
    .filter((component) => component.amount > 0);
  return normalized.length ? normalized : null;
}

async function _updateInlineApplication(message, targetUuid, mutate) {
  const magic = Boolean(getMagicMessageState(message));
  const updater = magic ? updateMagicCard : updateCard;
  return updater(message, (data) => {
    const entries = magic ? getMagicDefenderEntries(data) : _getDefenderEntries(data);
    const defender = entries.find((entry) => entry.actorUuid === targetUuid || entry.tokenUuid === targetUuid)
      ?? ((!targetUuid || entries.length <= 1) ? data.defender : null);
    if (!defender) throw new Error('Application target is no longer on this card.');
    const damage = magic ? getMagicDefenderDamage(data, defender) : _getDefenderDamage(data, defender);
    if (!damage) throw new Error('No resolved outcome is available for this target.');
    mutate(damage);
    if (magic) setMagicDefenderDamage(data, defender, damage);
    else _setDefenderDamage(data, defender, damage);
    return data;
  }, magic ? renderMagicCard : renderCombatCard);
}

async function _markInlineDamageApplied(message, targetUuid, { gmDamageReport = null, components = null, execution = null } = {}) {
  return _updateInlineApplication(message, targetUuid, (damage) => {
    damage.applied = true;
    damage.applicationStatus = execution?.status === 'partial' ? 'partial' : 'applied';
    const resolvedComponents = _resolvedDamageComponents(components);
    if (resolvedComponents) damage.damageComponents = resolvedComponents;
    if (gmDamageReport) damage.gmDamageReport = foundry.utils.deepClone(gmDamageReport);
  });
}

const _markMagicInlineDamageApplied = _markInlineDamageApplied;

export async function appendSupplementalDamageReportToMessage(message, targetUuid, { gmDamageReport = null } = {}) {
  if (!message || !targetUuid || !gmDamageReport || typeof gmDamageReport !== "object") return false;
  if (!message.flags?.[_FLAG_NS]?.opposed && !getMagicMessageState(message)) return false;
  await _updateInlineApplication(message, targetUuid, (damage) => {
    damage.applied = true;
    damage.gmDamageReport = _mergeSupplementalGmDamageReport(damage.gmDamageReport, gmDamageReport);
  });
  return true;
}

/** Record the start before any secondary write; interrupted work requires review. */
async function _applyMagicFollowups({ message, targetUuid, damage, casterActor, targetActor, spell, payload, emitHit = false }) {
  if (damage.followupsStarted) return { status: "partial", committed: true };
  let claimed = false;
  await _updateInlineApplication(message, targetUuid, (current) => {
    if (current.followupsStarted) return;
    current.followupsStarted = true;
    claimed = true;
  });
  if (!claimed) return { status: "partial", committed: true };
  const execution = { status: "applied", committed: true };
  if (payload.needsEffects) {
    try {
      if (!spell || !casterActor) throw new Error("The spell or caster is no longer available.");
      await applyResolvedSpellEffects({ casterActor, targetActor, spell, payload });
    } catch (error) {
      execution.status = "partial";
      console.error("UESRPG | Deferred spell effects failed", error);
    }
  }
  if (emitHit) Hooks.callAll("uesrpg.spellHitTarget", {
    caster: casterActor, target: targetActor, spell,
    hitLocation: payload.hitLocation ?? "Body", defenseType: payload.defenseType ?? "",
    isCritical: Boolean(payload.isCritical), isDamaging: payload.isDamaging !== false,
  });
  try {
    await applySpellResourceRestoration({ caster: casterActor, target: targetActor, spell, payload, message });
  } catch (error) {
    execution.status = "partial";
    console.error("UESRPG | Spell resource restoration failed", error);
  }
  return execution;
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
    const execution = await _applyMagicFollowups({ message, targetUuid, damage: dmgData, casterActor, targetActor, spell, payload: mp, emitHit: true });
    await _markMagicInlineDamageApplied(message, targetUuid, { execution });
    return;
  }

  const damageResult = await applyMagicDamage(targetActor, Number(mp.damage ?? 0), mp.damageType || "magic", spell, {
    receiptId: `${message.id}:${targetActor.uuid}:damage`,
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
    damageComponents: Array.isArray(mp.damageComponents) ? mp.damageComponents : null,
    casterActor,
    magicCost: Number(mp.magicCost ?? 0),
    skipChatMessage: true,
  });

  if (!damageResult) return;
  let execution = damageResult.execution;
  if (!damageResult.spellAbsorbed) {
    // HP receipts prevent duplicate damage; they cannot prove that subsequent
    // multi-document effects completed if the final chat write was interrupted.
    execution = execution?.replayed || execution?.status === "partial"
      ? { ...execution, status: "partial" }
      : await _applyMagicFollowups({ message, targetUuid, damage: dmgData, casterActor, targetActor, spell, payload: mp, emitHit: true });
  }
  await _markMagicInlineDamageApplied(message, targetUuid, { gmDamageReport: damageResult.gmDamageReport, execution });
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
    receiptId: `${message.id}:${targetActor.uuid}:healing`,
    source: mp.source ?? "Spell",
    rollHTML: mp.rollHTML ?? "",
    isTemporary: Boolean(mp.isTemporary),
    casterActor,
    magicCost: Number(mp.magicCost ?? 0),
  });

  if (!healResult) return;
  let execution = healResult.execution;
  if (!healResult.spellAbsorbed) {
    execution = execution?.replayed || execution?.status === "partial"
      ? { ...execution, status: "partial" }
      : await _applyMagicFollowups({ message, targetUuid, damage: dmgData, casterActor, targetActor, spell, payload: mp });
  }
  await _markMagicInlineDamageApplied(message, targetUuid, { execution });
}

// ── Public handlers ───────────────────────────────────────────────────────────

export async function onApplyDamage(ev, message, { authoritative = false } = {}) {
  ev.preventDefault();

  const btn = ev.currentTarget;
  const targetUuid = btn.dataset.targetUuid || null;
  const targetActor = resolveActor(message, targetUuid);
  if (!targetActor) {
    ui.notifications.warn("No valid target actor found for damage application.");
    return;
  }
  if (!authoritative && (!doesUserOwnActor(game.user, targetActor)
    || (getActiveGMUser() && _getCanonicalOutcome(message, targetUuid, "damage")))) {
    await _requestCombatOutcome(message, targetUuid, "damage");
    return;
  }

  if (String(btn.dataset.magic ?? "0") === "1") {
    return _onApplyMagicDamage(ev, message, btn);
  }

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

  const attackerActor = attackerActorUuid ? resolveActorFromUuidSync(attackerActorUuid) : null;
  const weapon = weaponUuid ? resolveUuidSync(weaponUuid) : null;

  const targetDomain = String(btn.dataset.targetDomain ?? "").trim().toLowerCase();
  const resolvedDamage = await ApplyDamageService.applyChatCard({
    receiptId: `${message.id}:${targetActor.uuid}:damage`,
    targetActor,
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
    targetDomain,
    chatContext: {
      parentMessageId: message?.id ?? null,
      suppressStandaloneSummary: true,
    },
  });

  if (!resolvedDamage) return;
  await _markInlineDamageApplied(message, targetUuid, {
    gmDamageReport: resolvedDamage?.gmDamageReport ?? null,
    components: resolvedDamage?.components ?? null,
    execution: resolvedDamage.execution,
  });
}

export async function onApplyHealing(ev, message, { authoritative = false } = {}) {
  ev.preventDefault();

  const btn = ev.currentTarget;
  const targetUuid = btn.dataset.targetUuid || null;
  const targetActor = resolveActor(message, targetUuid);
  if (!targetActor) {
    ui.notifications.warn("No valid target actor found for healing.");
    return;
  }
  if (!authoritative && (!doesUserOwnActor(game.user, targetActor)
    || (getActiveGMUser() && _getCanonicalOutcome(message, targetUuid, "healing")))) {
    await _requestCombatOutcome(message, targetUuid, "healing");
    return;
  }

  if (String(btn.dataset.magic ?? "0") === "1") {
    return _onApplyMagicHealing(ev, message, btn);
  }

  const healing = Number(btn.dataset.healing || 0);
  const source = btn.dataset.source || (message?.speaker?.alias ?? "Healing");
  const isTemporary = String(btn.dataset.tempHp ?? "0") === "1";

  const result = await ApplyDamageService.applyHealing(targetActor, healing, {
    source, isTemporary, receiptId: `${message.id}:${targetActor.uuid}:healing`,
  });
  if (!result) return;

  await _markInlineDamageApplied(message, targetUuid, { execution: result.execution });
}
