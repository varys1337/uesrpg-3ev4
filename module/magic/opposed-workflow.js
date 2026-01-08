/**
 * module/magic/opposed-workflow.js
 *
 * Magic attack opposed workflow for UESRPG 3ev4.
 * Implements RAW Chapter 6 spell attack rules:
 *  - Attack spells use casting test as attack test
 *  - Only Block/Evade allowed as defense (no Parry/Counter)
 *  - No advantages with spells
 *  - Critical success: max damage OR double restraint reduction
 *  - MP consumed regardless of hit/miss
 *  - Backfire on critical failure or conditional failure
 */

import { doTestRoll, computeResultFromRollTotal, resolveOpposed, formatDegree } from "../helpers/degree-roll-helper.js";
import { computeMagicCastingTN, consumeSpellMagicka, rollSpellDamage, getMaxSpellDamage } from "./magicka-utils.js";
import { applySpellEffect } from "./spell-effects.js";
import { shouldBackfire, triggerBackfire } from "./backfire.js";
import { safeUpdateChatMessage } from "../helpers/chat-message-socket.js";
import { requireUserCanRollActor } from "../helpers/permissions.js";
import { computeSkillTN } from "../skills/skill-tn.js";
import { renderMagicDamageButtons } from "./damage-application.js";

const _FLAG_NS = "uesrpg-3ev4";
const _FLAG_KEY = "magicOpposed";
const _CARD_VERSION = 1;

function _resolveDoc(uuid) {
  if (!uuid) return null;
  try { return fromUuidSync(uuid); } catch (_e) { return null; }
}

function _resolveActor(docOrUuid) {
  const doc = typeof docOrUuid === "string" ? _resolveDoc(docOrUuid) : docOrUuid;
  if (!doc) return null;
  if (doc.documentName === "Actor") return doc;
  if (doc.documentName === "Token") return doc.actor ?? null;
  if (doc.actor) return doc.actor;
  return null;
}

function _resolveToken(docOrUuid) {
  const doc = typeof docOrUuid === "string" ? _resolveDoc(docOrUuid) : docOrUuid;
  if (!doc) return null;
  if (doc.documentName === "Token") return doc;
  if (doc.documentName === "TokenDocument") return doc.object ?? null;
  return null;
}

function _fmtDegree(result) {
  if (!result) return "";
  const deg = Number(result.degree ?? 0);
  if (result.isSuccess) return `<span style="color: green;">${deg} DoS</span>`;
  return `<span style="color: red;">${deg} DoF</span>`;
}

function _getMessageState(message) {
  const raw = message?.flags?.[_FLAG_NS]?.[_FLAG_KEY];
  if (!raw || typeof raw !== "object") return null;
  // Support versioned structure
  if (Number(raw.version) >= 1 && raw.state) return raw.state;
  // Legacy: state stored directly
  if (raw.attacker && raw.defender) return raw;
  return null;
}

/**
 * Render the magic opposed card HTML
 */
function _renderCard(data, messageId) {
  const a = data.attacker;
  const d = data.defender;
  
  const spell = a.spellName ?? "Spell";
  const spellSchool = a.spellSchool ?? "";
  const spellLevel = a.spellLevel ?? 1;
  const spellCost = a.spellCost ?? 0;
  
  // Build TN breakdown
  const aTNLabel = a.tn?.finalTN != null ? String(a.tn.finalTN) : "—";
  const aTNBreakdown = a.tn?.modifiers ? a.tn.modifiers.map(m => 
    `<div style="font-size:11px; opacity:0.8; margin-left:10px;">${m.label}: ${m.value >= 0 ? '+' : ''}${m.value}</div>`
  ).join("") : "";
  
  // Attacker section
  const attackerActions = !a.result
    ? `<button class="uesrpg-magic-opposed-btn" data-action="attacker-roll" style="width:100%; margin-top:8px; padding:8px; background:#8a2be2; color:white; border:none; border-radius:3px; cursor:pointer; font-weight:bold;">Cast Spell (Roll 1d100)</button>`
    : "";
  
  // Defender section
  const dBlockTN = d.blockTN != null ? String(d.blockTN) : "—";
  const dEvadeTN = d.evadeTN != null ? String(d.evadeTN) : "—";
  const defenderActions = (a.result && !d.result && !d.noDefense)
    ? `
      <h4 style="margin:8px 0;">🛡️ Defender: Choose Defense</h4>
      <p class="hint" style="font-size:11px; font-style:italic; opacity:0.8; margin-bottom:8px;">Spells can only be Block or Evade (no Parry/Counter per RAW)</p>
      <div style="display:flex; gap:6px; margin-bottom:8px;">
        <button class="uesrpg-magic-opposed-btn" data-action="defender-roll-block" style="flex:1; padding:6px; background:#4169e1; color:white; border:none; border-radius:3px; cursor:pointer; font-size:12px;">Block (${dBlockTN})</button>
        <button class="uesrpg-magic-opposed-btn" data-action="defender-roll-evade" style="flex:1; padding:6px; background:#228b22; color:white; border:none; border-radius:3px; cursor:pointer; font-size:12px;">Evade (${dEvadeTN})</button>
        <button class="uesrpg-magic-opposed-btn" data-action="defender-no-defense" style="flex:1; padding:6px; background:#666; color:white; border:none; border-radius:3px; cursor:pointer; font-size:12px;">No Defense</button>
      </div>
    `
    : "";
  
  // Outcome section
  let outcomeLine = "";
  if (data.outcome) {
    const winner = data.outcome.winner;
    const attackerWins = winner === "attacker";
    const outcomeText = data.outcome.text ?? "";
    const bgColor = attackerWins ? "rgba(0, 200, 0, 0.1)" : "rgba(0, 100, 200, 0.1)";
    const borderColor = attackerWins ? "green" : "blue";
    
    let damageInfo = "";
    if (attackerWins && data.outcome.damage) {
      damageInfo = `
        <div style="margin-top:6px;">
          <b>Damage:</b> ${data.outcome.damage} ${data.outcome.damageType}
          ${a.result?.isCriticalSuccess ? '<span style="display:block; color:green; font-style:italic; margin-top:4px;">(MAX damage from critical)</span>' : ''}
        </div>
      `;
      
      // Add damage buttons if we have target info
      if (data.outcome.damageButtons) {
        damageInfo += `<div style="margin-top:8px;">${data.outcome.damageButtons}</div>`;
      }
    }
    
    const mpInfo = data.outcome.mpConsumed != null ? `
      <div style="margin-top:10px; padding:8px; background:rgba(0,0,0,0.05); border-radius:3px;">
        <b>MP Consumed:</b> ${data.outcome.mpConsumed} (${data.outcome.mpRemaining} MP remaining)
      </div>
    ` : "";
    
    outcomeLine = `
      <div style="margin-top:12px; padding:10px; background:${bgColor}; border-left:3px solid ${borderColor}; border-radius:3px;">
        <h4 style="margin:0 0 6px 0; color:${borderColor};">${attackerWins ? '✅ Spell Hit!' : '🛡️ Spell Defended!'}</h4>
        <div style="font-size:12px;">
          <div style="padding:4px 0; border-bottom:1px solid rgba(0,0,0,0.1);"><b>Caster Roll:</b> ${a.result.rollTotal} (${a.result.degree} DoS)</div>
          <div style="padding:4px 0;"><b>Defender ${d.defenseType ?? 'Defense'}:</b> ${d.result?.rollTotal ?? '—'} (${d.result?.degree ?? 0} Do${d.result?.isSuccess ? 'S' : 'F'})</div>
        </div>
        ${damageInfo}
        ${mpInfo}
      </div>
    `;
  }
  
  // Build spell options display
  let spellOptionsHTML = "";
  if (a.spellOptions) {
    const opts = [];
    if (a.spellOptions.isRestrained) {
      opts.push(`✓ Spell Restraint (-${a.spellOptions.restraintValue} MP, min 1)`);
    }
    if (a.spellOptions.isOverloaded) {
      opts.push(`⚡ Overload (2x MP cost, bonus effect)`);
    }
    if (opts.length > 0) {
      spellOptionsHTML = `<div style="margin-bottom:8px; font-size:12px;">${opts.map(o => `<div style="padding:3px 0;">${o}</div>`).join('')}</div>`;
    }
  }
  
  return `
  <div class="ues-magic-opposed-card" data-message-id="${messageId}" style="padding:8px; border:1px solid rgba(138,43,226,0.3); background:rgba(138,43,226,0.05);">
    <div class="opposed-header" style="margin-bottom:12px; padding-bottom:8px; border-bottom:2px solid rgba(138,43,226,0.4);">
      <h3 style="margin:0 0 4px 0; color:#8a2be2; font-size:16px;">🔮 ${spell} ${spellSchool ? `(${spellSchool} ${spellLevel})` : ""}</h3>
      <div style="display:flex; align-items:center; justify-content:center; gap:10px; font-size:13px;">
        <span style="font-weight:bold;">${a.tokenName ?? a.name}</span>
        <span style="opacity:0.7;">vs</span>
        <span style="font-weight:bold;">${d.tokenName ?? d.name}</span>
      </div>
    </div>
    
    ${!a.result ? `
      <div class="opposed-state-pending">
        <h4 style="margin:8px 0; color:#666;">⏳ Awaiting Caster Roll</h4>
        <div style="background:rgba(0,0,0,0.05); padding:8px; margin-bottom:8px; border-radius:3px;">
          <div style="margin-bottom:4px;"><b>Casting TN:</b> ${aTNLabel}</div>
          ${aTNBreakdown}
        </div>
        ${spellOptionsHTML}
        ${attackerActions}
      </div>
    ` : ""}
    
    ${a.result && !d.result && !d.noDefense ? `
      <div class="opposed-state-defense">
        <h4 style="margin:8px 0;">🎲 Caster Rolled: ${a.result.rollTotal}</h4>
        <div style="margin-bottom:12px;">
          ${a.result.isCriticalSuccess ? '<span style="color:green; font-weight:bold;">⭐ CRITICAL SUCCESS!</span>' : ''}
          <span style="display:block; margin-top:4px;">${a.result.degree} Degrees of Success</span>
        </div>
        ${defenderActions}
      </div>
    ` : ""}
    
    ${outcomeLine}
  </div>`;
}

async function _updateCard(message, data) {
  data.context = data.context ?? {};
  data.context.schemaVersion = data.context.schemaVersion ?? _CARD_VERSION;
  data.context.updatedAt = Date.now();
  data.context.updatedBy = game.user.id;
  data.context.updatedSeq = (Number(data.context.updatedSeq) || 0) + 1;
  
  const payload = {
    content: _renderCard(data, message.id),
    flags: { [_FLAG_NS]: { [_FLAG_KEY]: { version: _CARD_VERSION, state: data } } }
  };
  
  await safeUpdateChatMessage(message, payload);
}

/**
 * Compute defense TN (Block or Evade only for spells)
 */
function _computeDefenseTN(actor, defenseType) {
  if (defenseType === "evade") {
    // Use Evade skill
    const evadeSkill = actor.items.find(i => i.type === "skill" && i.name?.toLowerCase().includes("evade"));
    const baseTN = evadeSkill ? Number(evadeSkill.system?.value ?? 0) : 0;
    
    // Apply penalties
    const fatiguePenalty = Number(actor.system?.fatigue?.penalty ?? 0);
    const carryPenalty = Number(actor.system?.carry_rating?.penalty ?? 0);
    const woundPenalty = Number(actor.system?.woundPenalty ?? 0);
    
    return baseTN + fatiguePenalty + carryPenalty + woundPenalty;
  } else if (defenseType === "block") {
    // Use Combat profession with shield bonus
    const combatProf = Number(actor.system?.professions?.combat ?? 0);
    
    // Check for equipped shield
    let shieldBonus = 0;
    const shields = actor.items.filter(i => 
      i.type === "armor" && 
      i.system?.equipped === true &&
      (i.name?.toLowerCase().includes("shield") || i.system?.armorType?.toLowerCase().includes("shield"))
    );
    if (shields.length > 0) {
      // Simple +10 bonus for shield
      shieldBonus = 10;
    }
    
    // Apply penalties
    const fatiguePenalty = Number(actor.system?.fatigue?.penalty ?? 0);
    const carryPenalty = Number(actor.system?.carry_rating?.penalty ?? 0);
    const woundPenalty = Number(actor.system?.woundPenalty ?? 0);
    
    return combatProf + shieldBonus + fatiguePenalty + carryPenalty + woundPenalty;
  }
  
  return 0;
}

/**
 * Main workflow object
 */
export const MagicOpposedWorkflow = {
  /**
   * Create a pending magic attack opposed test
   */
  async createPending(cfg = {}) {
    const aDoc = _resolveDoc(cfg.attackerTokenUuid) ?? _resolveDoc(cfg.attackerActorUuid) ?? _resolveDoc(cfg.attackerUuid);
    const dDoc = _resolveDoc(cfg.defenderTokenUuid) ?? _resolveDoc(cfg.defenderActorUuid) ?? _resolveDoc(cfg.defenderUuid);
    
    const aToken = _resolveToken(aDoc);
    const dToken = _resolveToken(dDoc);
    const attacker = _resolveActor(aDoc);
    const defender = _resolveActor(dDoc);
    
    if (!attacker || !defender) {
      ui.notifications.warn("Magic attack requires both a caster and a target.");
      return null;
    }
    
    const spell = await fromUuid(cfg.spellUuid);
    if (!spell) {
      ui.notifications.error("Could not resolve spell.");
      return null;
    }
    
    // Compute casting TN
    const tn = computeMagicCastingTN(attacker, spell, cfg.spellOptions ?? {});
    
    // Pre-compute defense TNs for defender
    const blockTN = _computeDefenseTN(defender, "block");
    const evadeTN = _computeDefenseTN(defender, "evade");
    
    const data = {
      context: {
        schemaVersion: 1,
        createdAt: Date.now(),
        createdBy: game.user.id,
        updatedAt: Date.now(),
        updatedBy: game.user.id,
        phase: "pending",
        waitingSince: null
      },
      status: "pending",
      mode: "magic",
      attacker: {
        actorUuid: attacker.uuid,
        tokenUuid: aToken?.document?.uuid ?? aToken?.uuid ?? null,
        tokenName: aToken?.name ?? null,
        name: attacker.name,
        spellUuid: spell.uuid,
        spellName: spell.name,
        spellSchool: spell.system?.school ?? "",
        spellLevel: Number(spell.system?.level ?? 1),
        spellCost: Number(spell.system?.cost ?? 0),
        spellOptions: cfg.spellOptions ?? {},
        result: null,
        tn
      },
      defender: {
        actorUuid: defender.uuid,
        tokenUuid: dToken?.document?.uuid ?? dToken?.uuid ?? null,
        tokenName: dToken?.name ?? null,
        name: defender.name,
        defenseType: null,
        result: null,
        tn: null,
        blockTN,
        evadeTN,
        noDefense: false
      },
      outcome: null
    };
    
    const message = await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: attacker, token: aToken?.document ?? aToken ?? null }),
      content: _renderCard(data, ""),
      flags: { [_FLAG_NS]: { [_FLAG_KEY]: { version: _CARD_VERSION, state: data } } },
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
    
    await message.update({ content: _renderCard(data, message.id) });
    return message;
  },
  
  /**
   * Handle actions on the opposed card
   */
  async handleAction(message, action) {
    const data = _getMessageState(message);
    if (!data) return;
    
    const attacker = _resolveActor(data.attacker.actorUuid);
    const defender = _resolveActor(data.defender.actorUuid);
    
    if (!attacker || !defender) {
      ui.notifications.warn("Could not resolve actors.");
      return;
    }
    
    if (action === "attacker-roll") {
      if (data.attacker.result) return; // Already rolled
      if (!requireUserCanRollActor(game.user, attacker)) return;
      
      const spell = await fromUuid(data.attacker.spellUuid);
      if (!spell) {
        ui.notifications.error("Could not resolve spell.");
        return;
      }
      
      // Roll casting test
      const result = await doTestRoll(attacker, {
        target: data.attacker.tn.finalTN,
        allowLucky: true,
        allowUnlucky: true
      });
      
      // Post roll to chat with Dice So Nice
      await result.roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        flavor: `<b>${spell.name}</b> — Casting Test`,
        flags: { [_FLAG_NS]: { magicOpposedMeta: { parentMessageId: message.id, stage: "attacker" } } }
      });
      
      // Check for backfire
      const needsBackfire = shouldBackfire(spell, attacker, result.isCriticalFailure, !result.isSuccess);
      if (needsBackfire) {
        await triggerBackfire(attacker, spell);
      }
      
      // Update card with result
      data.attacker.result = result;
      data.attacker.backfire = needsBackfire;
      data.context.phase = "awaiting-defense";
      await _updateCard(message, data);
      
    } else if (action === "defender-roll-block" || action === "defender-roll-evade") {
      if (data.defender.result) return; // Already rolled
      if (!requireUserCanRollActor(game.user, defender)) return;
      
      const defenseType = action === "defender-roll-block" ? "block" : "evade";
      const defenseLabel = defenseType.charAt(0).toUpperCase() + defenseType.slice(1);
      
      // Compute defense TN
      const defenseTN = _computeDefenseTN(defender, defenseType);
      
      // Roll defense
      const result = await doTestRoll(defender, {
        target: defenseTN,
        allowLucky: true,
        allowUnlucky: true
      });
      
      // Post roll to chat with Dice So Nice
      await result.roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: defender }),
        flavor: `<b>${defenseLabel}</b> vs ${data.attacker.spellName}`,
        flags: { [_FLAG_NS]: { magicOpposedMeta: { parentMessageId: message.id, stage: "defender" } } }
      });
      
      // Update card with result
      data.defender.result = result;
      data.defender.defenseType = defenseLabel;
      data.defender.tn = defenseTN;
      data.context.phase = "resolved";
      
      // Resolve outcome
      await this._resolveOutcome(message, data, attacker, defender);
      
    } else if (action === "defender-no-defense") {
      if (!requireUserCanRollActor(game.user, defender)) return;
      
      data.defender.noDefense = true;
      data.defender.result = { rollTotal: 999, isSuccess: false, degree: 0 }; // Auto-fail
      data.context.phase = "resolved";
      
      // Resolve outcome
      await this._resolveOutcome(message, data, attacker, defender);
    }
  },
  
  /**
   * Resolve the outcome of the opposed test
   */
  async _resolveOutcome(message, data, attacker, defender) {
    const spell = await fromUuid(data.attacker.spellUuid);
    if (!spell) return;
    
    // Determine winner
    const aResult = data.attacker.result;
    const dResult = data.defender.result;
    
    const outcome = resolveOpposed(aResult, dResult);
    const attackerWins = outcome.winner === "attacker";
    
    const outcomeText = attackerWins
      ? `${spell.name} hits ${defender.name}!`
      : `${defender.name} defends against ${spell.name}!`;
    
    data.outcome = { ...outcome, text: outcomeText };
    
    // Consume magicka (happens regardless of hit/miss per RAW p.128 line 191)
    await consumeSpellMagicka(attacker, spell, data.attacker.spellOptions);
    
    // Get MP info for display
    const currentMP = Number(attacker.system?.resources?.mp?.value ?? 0);
    const consumed = Number(spell.system?.cost ?? 0);
    
    data.outcome.mpConsumed = consumed;
    data.outcome.mpRemaining = Math.max(0, currentMP - consumed);
    
    // Apply effects if attacker wins
    if (attackerWins) {
      const isDamaging = Boolean(spell.system?.damageFormula || spell.system?.damage);
      const isCritical = Boolean(aResult.isCriticalSuccess);
      
      if (isDamaging) {
        // Roll damage
        let damageRoll = await rollSpellDamage(spell, {
          isCritical,
          isOverloaded: data.attacker.spellOptions?.isOverloaded,
          wpBonus: Math.floor(Number(attacker.system?.characteristics?.wp?.total ?? 0) / 10)
        });
        
        const damageValue = Number(damageRoll.total);
        const damageType = spell.system?.damageType || "magic";
        
        // Store damage info in outcome
        data.outcome.damage = damageValue;
        data.outcome.damageType = damageType;
        
        // Generate damage application buttons
        const targets = [{
          uuid: defender.uuid,
          name: defender.name
        }];
        
        data.outcome.damageButtons = renderMagicDamageButtons(
          targets,
          damageValue,
          damageType,
          spell,
          { isCritical }
        );
      } else {
        // Apply non-damaging spell effect
        await applySpellEffect(defender, spell, {
          isCritical,
          duration: {} // TODO: parse from spell attributes
        });
      }
    }
    
    await _updateCard(message, data);
  }
};

/**
 * Hook to handle button clicks on magic opposed cards
 */
Hooks.on("renderChatMessage", (message, html) => {
  const data = _getMessageState(message);
  if (!data) return;
  
  html.find(".uesrpg-magic-opposed-btn").on("click", async (event) => {
    event.preventDefault();
    const action = event.currentTarget.dataset.action;
    if (!action) return;
    
    await MagicOpposedWorkflow.handleAction(message, action);
  });
});
