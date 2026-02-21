/**
 * @file Chat card rendering for weapon and manual effect damage in opposed combat.
 * @module opposed/damage-chat-cards
 *
 * Extracted from monolithic opposed-workflow.js Phase 16 (2025-01-27).
 * Provides chat card posting functions for:
 * - Weapon damage with quality pills
 * - Manual effect damage
 *
 * Dependencies:
 * - Weapon pills inline builder (_buildWeaponPillsInline from monolith)
 * - Opposed flags helper (_opposedFlags from monolith)
 * - Foundry VTT ChatMessage API
 *
 * All functions are async and return the created ChatMessage for strict ordering.
 */

import { buildWeaponPillsInline as _buildWeaponPillsInline } from "../helpers/weapon-quality-display.js";
import { _opposedFlags } from "../helpers/util.js";

/**
 * Post a weapon damage chat card showing damage, hit location, and weapon qualities.
 *
 * @param {Object} params - Damage card parameters
 * @param {Actor} params.attacker - Actor dealing damage
 * @param {Token} [params.aToken] - Token for speaker
 * @param {Item} params.weapon - Weapon item
 * @param {Object} params.dmg - Damage result object
 * @param {number} params.dmg.finalDamage - Final damage value
 * @param {string} params.dmg.damageString - Damage breakdown string
 * @param {Roll} params.dmg.rollA - Primary damage roll
 * @param {Roll} [params.dmg.rollB] - Secondary damage roll (qualities)
 * @param {boolean} [params.dmg.usedAltDamage] - If 2H damage was used
 * @param {string} params.hitLocation - Hit location text
 * @param {string} [params.applyButtonHtml=""] - HTML for apply buttons
 * @param {string} [params.extraNoteHtml=""] - HTML for additional notes
 * @param {string} [params.parentMessageId=null] - Parent message for threading
 * @param {string} [params.stage="damage"] - Workflow stage for flags
 * @returns {Promise<ChatMessage>} Created chat message
 */
export async function postWeaponDamageChatCard({
  attacker,
  aToken,
  weapon,
  dmg,
  hitLocation,
  applyButtonHtml = "",
  extraNoteHtml = "",
  parentMessageId = null,
  stage = "damage",
} = {}) {
  if (!attacker || !weapon || !dmg) return;

  const pillsInline = _buildWeaponPillsInline(weapon);

  const altTag = dmg?.usedAltDamage ? ` <span style="opacity:0.85; font-size:12px;">(2H)</span>` : "";

  const cardHtml = `
    <div class="uesrpg-weapon-damage-card">
      <h2 style="display:flex;gap:0.5rem;align-items:center;">
        <img src="${weapon.img}" style="height:32px;width:32px;">
        <div>${weapon.name}</div>
      </h2>

      <table class="uesrpg-weapon-damage-table">
        <thead>
          <tr>
            <th>Damage</th>
            <th class="tableCenterText">Result</th>
            <th class="tableCenterText">Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="tableAttribute">Damage</td>
            <td class="tableCenterText">${dmg.finalDamage}${altTag}</td>
            <td class="tableCenterText">
              <div>${dmg.damageString}</div>
              <div style="margin-top:0.35rem;">${pillsInline}</div>
            </td>
          </tr>
          <tr>
            <td class="tableAttribute">Hit Location</td>
            <td class="tableCenterText">${hitLocation}</td>
            <td class="tableCenterText">from attack roll</td>
          </tr>
        </tbody>
      </table>
      ${extraNoteHtml ? `<div style="margin-top:0.5rem; opacity:0.9;">${extraNoteHtml}</div>` : ""}
      ${applyButtonHtml ? `<div style="margin-top:0.4rem;display:flex;flex-wrap:wrap;gap:0.5rem;">${applyButtonHtml}</div>` : ""}
    </div>
  `;

  const msgFlags = parentMessageId ? _opposedFlags(parentMessageId, stage) : undefined;
  // Ammunition is consumed at attack time (prior to the attack roll), not when the damage card is posted.
  // Keep flags lane clean: do not schedule post-hoc consumption here.

  // Return the created message so callers can enforce strict ordering when multiple
  // chat cards are posted in sequence (e.g., Resolve Block -> weapon card -> block result).
  const created = await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: attacker, token: aToken?.document ?? null }),
    content: cardHtml,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    rolls: [dmg.rollA, dmg.rollB].filter(Boolean),
    rollMode: game.settings.get("core", "rollMode"),
    flags: msgFlags,
  });
  return created;
}

/**
 * Post a manual effect damage chat card (generic damage/healing from non-weapon sources).
 *
 * @param {Object} params - Manual effect card parameters
 * @param {Actor} params.attacker - Actor applying effect
 * @param {Token} [params.aToken] - Token for speaker
 * @param {string} [params.itemLabel] - Effect/item label
 * @param {string} [params.itemImg] - Effect/item image
 * @param {Object} params.dmg - Damage result object
 * @param {number} params.dmg.finalDamage - Final damage value
 * @param {string} params.dmg.damageString - Damage breakdown string
 * @param {Roll} params.dmg.rollA - Primary damage roll
 * @param {Roll} [params.dmg.rollB] - Secondary damage roll
 * @param {string} [params.hitLocation] - Hit location text (optional for non-weapon)
 * @param {string} [params.effectLabel="Damage"] - Label for effect type
 * @param {string} [params.pillsInline=""] - HTML for quality pills
 * @param {string} [params.applyButtonHtml=""] - HTML for apply buttons
 * @param {string} [params.extraNoteHtml=""] - HTML for additional notes
 * @param {string} [params.parentMessageId=null] - Parent message for threading
 * @param {string} [params.stage="damage"] - Workflow stage for flags
 * @returns {Promise<ChatMessage>} Created chat message
 */
export async function postManualEffectChatCard({
  attacker,
  aToken,
  itemLabel,
  itemImg,
  dmg,
  hitLocation,
  effectLabel = "Damage",
  pillsInline = "",
  applyButtonHtml = "",
  extraNoteHtml = "",
  parentMessageId = null,
  stage = "damage",
} = {}) {
  if (!attacker || !dmg) return;

  const headerImg = itemImg ? `<img src="${itemImg}" style="height:32px;width:32px;">` : "";
  const headerLabel = itemLabel ?? "Effect";

  const cardHtml = `
    <div class="uesrpg-weapon-damage-card">
      <h2 style="display:flex;gap:0.5rem;align-items:center;">
        ${headerImg}
        <div>${headerLabel}</div>
      </h2>

      <table class="uesrpg-weapon-damage-table">
        <thead>
          <tr>
            <th>${effectLabel}</th>
            <th class="tableCenterText">Result</th>
            <th class="tableCenterText">Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="tableAttribute">${effectLabel}</td>
            <td class="tableCenterText">${dmg.finalDamage}</td>
            <td class="tableCenterText">
              <div>${dmg.damageString}</div>
              <div style="margin-top:0.35rem;">${pillsInline}</div>
            </td>
          </tr>
          ${hitLocation ? `
          <tr>
            <td class="tableAttribute">Hit Location</td>
            <td class="tableCenterText">${hitLocation}</td>
            <td class="tableCenterText">from attack roll</td>
          </tr>` : ""}
        </tbody>
      </table>
      ${extraNoteHtml ? `<div style="margin-top:0.5rem; opacity:0.9;">${extraNoteHtml}</div>` : ""}
      ${applyButtonHtml ? `<div style="margin-top:0.4rem;display:flex;flex-wrap:wrap;gap:0.5rem;">${applyButtonHtml}</div>` : ""}
    </div>
  `;

  const msgFlags = parentMessageId ? _opposedFlags(parentMessageId, stage) : undefined;
  const created = await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: attacker, token: aToken?.document ?? null }),
    content: cardHtml,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    rolls: [dmg.rollA, dmg.rollB].filter(Boolean),
    rollMode: game.settings.get("core", "rollMode"),
    flags: msgFlags,
  });
  return created;
}
