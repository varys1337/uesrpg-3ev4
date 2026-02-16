/**
 * src/core/combat/chat-handlers.js
 * Foundry VTT v13-compatible chat card handlers for UESRPG 3ev4.
 *
 * Exports expected by init.js:
 *  - initializeChatHandlers()
 *  - registerCombatChatHooks()
 *
 * Notes:
 *  - Uses Hooks.on("renderChatMessageHTML") (v13) instead of deprecated renderChatMessage
 *  - Registers only once (guards against double-calls from init.js)
 */

import { applyHealing, DAMAGE_TYPES } from "./damage-automation.js";
import { applyDamageResolved } from "./damage-resolver.js";
import { OpposedWorkflow } from "./opposed-workflow.js";
import { SkillOpposedWorkflow } from "../skills/opposed-workflow.js";
import { CharOpposedWorkflow } from "../characteristics/opposed-workflow.js";
import { canUserRollActor } from "../../utils/permissions.js";
import { resolveShockTestFromChat } from "../wounds/wound-engine.js";
import { requestUpdateChatMessage, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { getDiseaseResistancePercent, isActorImmuneToDamageType } from "../traits/trait-registry.js";
import { getGeneralTalentRerollEligibility, rerollSkillTestFromChatMessage } from "../traits/general-talents.js";
import { hasTalent } from "../traits/talents-api.js";
import { canApplyCharGenGatedImperialTalents } from "../traits/racial-talents.js";
import { canRetargetOpposedMessage, retargetOpposedMessage } from "./opposed/retarget.js";
import { registerLuckContextMenuOptions } from "../luck/luck-workflow.js";
import { isDebugEnabled } from "../../utils/debug.js";
import {
  getMessageState as getMagicMessageState,
  isMultiDefender as isMagicMultiDefender,
  getMagicDefenderDamage, setMagicDefenderDamage,
  getDefenderEntries as getMagicDefenderEntries,
} from "../magic/opposed/schema.js";
import { renderCard as renderMagicCard } from "../magic/opposed/render.js";
import { applyMagicDamage, applyMagicHealing } from "../magic/damage-application.js";
import { applySpellEffectsToTarget } from "../magic/effects/spell-effects.js";
import { spellNeedsEffectApplication } from "../magic/opposed/spell-helpers.js";
import { safeUpdateChatMessage } from "../../utils/chat-message-socket.js";
import {
  _isMultiDefender, _getDefenderDamage, _setDefenderDamage,
  _getDefenderEntries, _isBankChoicesEnabledForData, _getBankCommitState,
  _anyActiveGMOnline, _allDefendersCommitted,
  _getDefenderOutcome, _getDefenderAdvantage, _getDefenderResolutionState
} from "./opposed/schema.js";
import { renderSingleDefenderCard, renderMultiDefenderCard } from "./opposed/cards/renderers.js";
import { updateCard } from "./opposed/cards/updater.js";
import { _safeGetSetting } from "./opposed/helpers/util.js";

let _chatHooksRegistered = false;
let _chatContextHooksRegistered = false;
let _ctxMenuDebugHelperRegistered = false;
let _chatLogContextProbeRegistered = false;

function _ctxMenuDebugEnabled() {
  const runtimeToggle = Boolean(globalThis?.__UESRPG_CTX_MENU_DEBUG__ === true);
  return isDebugEnabled("opposedDebug", { runtimeToggle });
}

function _ctxMenuDebug(event, payload = {}) {
  if (!_ctxMenuDebugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.log(`UESRPG | ContextMenuDebug | ${event}`, payload);
  } catch (_e) {
    // no-op
  }
}

function _registerChatLogContextProbe() {
  if (_chatLogContextProbeRegistered) return;
  _chatLogContextProbeRegistered = true;

  Hooks.on("renderChatLog", (_app, html) => {
    const host = html?.[0] ?? html;
    if (!(host instanceof HTMLElement)) return;
    if (host.dataset.uesrpgCtxProbe === "1") return;
    host.dataset.uesrpgCtxProbe = "1";

    host.addEventListener("contextmenu", (ev) => {
      if (!_ctxMenuDebugEnabled()) return;
      const target = ev.target instanceof HTMLElement ? ev.target : null;
      const li = target?.closest?.(".message");
      const messageId = li ? _getMessageIdFromContextLi(li) : null;
      _ctxMenuDebug("dom.contextmenu", {
        hasMessageLi: Boolean(li),
        messageId,
        targetClass: String(target?.className ?? ""),
        targetTag: String(target?.tagName ?? "")
      });
    }, true);

    _ctxMenuDebug("probe.renderChatLog.bound", { bound: true });
  });
}

/**
 * Resolve an Actor from a UUID or speaker.
 * @param {ChatMessage} message
 * @param {string|null} uuid
 * @returns {Actor|null}
 */
async function _maybeConsumeAmmoFromMessage(message) {
  const opposed = message?.flags?.["uesrpg-3ev4"]?.opposed;
  const pendingAmmo = opposed?.pendingAmmo ?? null;
  if (!pendingAmmo) return;
  if (opposed?.ammoConsumed) return;

  // Ensure exactly one client performs consumption.
  const activeGM = game.users.activeGM;
  const shouldRun = activeGM ? (game.user.id === activeGM.id) : message.isAuthor;
  if (!shouldRun) return;

  const ok = await OpposedWorkflow.consumePendingAmmo(pendingAmmo);
  await requestUpdateChatMessage(message, {
    "flags.uesrpg-3ev4.opposed.ammoConsumed": true,
    "flags.uesrpg-3ev4.opposed.ammoConsumedOk": !!ok,
    "flags.uesrpg-3ev4.opposed.ammoConsumedAt": Date.now(),
  });
}

function _resolveActor(message, uuid) {
  if (uuid) {
    const doc = fromUuidSync(uuid);
    if (doc?.actor) return doc.actor;
    if (doc?.documentName === "Actor") return doc;
  }
  const sp = message?.speaker;
  if (sp?.token) return canvas?.tokens?.get(sp.token)?.actor ?? null;
  if (sp?.actor) return game.actors?.get(sp.actor) ?? null;
  return null;
}

function _getWhisperRecipients(actor) {
  const out = new Set();
  const users = game.users?.contents ?? [];
  for (const user of users) {
    if (!user) continue;
    if (user.isGM) {
      out.add(user.id);
      continue;
    }
    const hasOwner = typeof actor?.testUserPermission === "function"
      ? actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
      : Number(actor?.ownership?.[user.id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    if (hasOwner) out.add(user.id);
  }
  return Array.from(out);
}

function _getSkillTestFlags(message) {
  const st = message?.flags?.uesrpg?.skillTest ?? null;
  if (st && typeof st === "object") return st;
  const st2 = message?.flags?.["uesrpg-3ev4"]?.skillTest ?? null;
  return (st2 && typeof st2 === "object") ? st2 : null;
}

function _isTalentRerollUsed(message) {
  const r = message?.flags?.uesrpg?.reroll ?? null;
  return Boolean(r?.used === true || r?.isReroll === true);
}

function _canUserExecuteTalentReroll(message) {
  return Boolean(game.user?.isGM) || Boolean(message?.isAuthor);
}

function _injectTalentRerollButton(message, root) {
  try {
    if (!message || !root) return;
    if (root.querySelector('[data-uesrpg-action="reroll-talent"]')) return;

    const st = _getSkillTestFlags(message);
    if (!st) return;
    if (st.isReroll === true) return;
    if (st.isSuccess !== false) return;
    if (_isTalentRerollUsed(message)) return;

    const actorUuid = String(st.actorUuid ?? "").trim();
    if (!actorUuid) return;
    const actor = _resolveActor(message, actorUuid);
    if (!actor) return;

    const skillName = String(st.skillName ?? "").trim();
    if (!skillName) return;

    const eligibility = getGeneralTalentRerollEligibility(actor, {
      skillName,
      useSpecialization: Boolean(st.useSpecialization)
    });
    if (!eligibility) return;

    const canExec = _canUserExecuteTalentReroll(message);

    const wrap = document.createElement("div");
    wrap.className = "uesrpg-chat-actions";
    wrap.style.marginTop = "6px";
    wrap.style.display = "flex";
    wrap.style.gap = "8px";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.uesrpgAction = "reroll-talent";
    btn.className = "uesrpg-btn uesrpg-reroll-talent-btn";
    btn.textContent = "Reroll (Talent)";

    if (!canExec) {
      btn.setAttribute("disabled", "disabled");
      btn.setAttribute("title", "Only the roll author or a GM can execute a talent reroll.");
    } else {
      btn.setAttribute("title", `Talent reroll: ${eligibility.source === "grandmaster" ? "Grandmaster" : "Expert"}`);
    }

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const ok = await rerollSkillTestFromChatMessage(message);
        if (!ok) {
          ui.notifications?.warn?.("Talent reroll could not be executed.");
          btn.disabled = false;
        }
      } catch (err) {
        console.error("UESRPG | Talent reroll failed", err);
        ui.notifications?.error?.("Talent reroll failed. Check console for details.");
        btn.disabled = false;
      }
    });

    wrap.appendChild(btn);

    const anchor =
      root.querySelector(".dice-roll .dice-result") ??
      root.querySelector(".message-content") ??
      root;
    anchor.appendChild(wrap);
  } catch (_e) {
    // Do not hard-fail chat rendering.
  }
}

function _getImperialLuckSpentLp(message) {
  const a = Number(message?.flags?.uesrpg?.imperialLuck?.lpSpent ?? 0) || 0;
  const b = Number(message?.flags?.["uesrpg-3ev4"]?.imperialLuck?.lpSpent ?? 0) || 0;
  return Math.max(0, Math.max(a, b));
}

function _canUserSpendLuckForActor(actor) {
  return canUserRollActor(game.user, actor);
}

function _injectImperialLuckDoSButton(message, root) {
  try {
    if (!message || !root) return;
    if (root.querySelector('[data-uesrpg-action="imperialluck-dos"]')) return;

    const st = _getSkillTestFlags(message);
    if (!st) return;
    if (st.isSuccess !== true) return;

    const actorUuid = String(st.actorUuid ?? "").trim();
    if (!actorUuid) return;
    const actor = _resolveActor(message, actorUuid);
    if (!actor) return;

    if (!hasTalent(actor, "imperialluck")) return;
    if (!canApplyCharGenGatedImperialTalents(actor, { warnTalentName: "Imperial Luck" })) return;

    const canSpend = _canUserSpendLuckForActor(actor);
    const currentLp = Number(actor.system?.luck_points?.value ?? 0) || 0;
    if (currentLp <= 0) return;

    const lpSpent = _getImperialLuckSpentLp(message);
    const nextBonus = (lpSpent === 0) ? 2 : 1;

    const wrap = document.createElement("div");
    wrap.className = "uesrpg-chat-actions";
    wrap.style.marginTop = "6px";
    wrap.style.display = "flex";
    wrap.style.gap = "8px";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.uesrpgAction = "imperialluck-dos";
    btn.className = "uesrpg-btn uesrpg-imperialluck-dos-btn";
    btn.textContent = `Spend 1 LP (+${nextBonus} DoS)`;

    if (!canSpend) {
      btn.setAttribute("disabled", "disabled");
      btn.setAttribute("title", "You do not have permission to spend Luck Points for this actor.");
    } else {
      btn.setAttribute("title", "Imperial Luck: first LP spent on this test adds +2 DoS, then +1 per LP.");
    }

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      let succeeded = false;
      try {
        const freshActor = _resolveActor(message, actorUuid) ?? actor;
        if (!freshActor) return;
        if (!hasTalent(freshActor, "imperialluck")) return;
        if (!canApplyCharGenGatedImperialTalents(freshActor, { warnTalentName: "Imperial Luck" })) return;
        if (!_canUserSpendLuckForActor(freshActor)) return;

        const lpNow = Number(freshActor.system?.luck_points?.value ?? 0) || 0;
        if (lpNow <= 0) {
          ui.notifications?.warn?.("No Luck Points remaining.");
          return;
        }

        // Re-read message flags at click time (prevents double-counting if the card was already updated).
        const freshMsg = game.messages?.get?.(message.id) ?? message;
        const spent = _getImperialLuckSpentLp(freshMsg);
        const add = (spent === 0) ? 2 : 1;

        await requestUpdateDocument(freshActor, { "system.luck_points.value": Math.max(0, lpNow - 1) });

        const stNow = _getSkillTestFlags(freshMsg) ?? st;
        const currentDegree = Number(stNow?.degree ?? 0) || 0;
        const alreadyAdded = Number(freshMsg?.flags?.uesrpg?.imperialLuck?.dosAdded ?? freshMsg?.flags?.["uesrpg-3ev4"]?.imperialLuck?.dosAdded ?? 0) || 0;
        const nextDegree = Math.max(0, currentDegree + add);

        await requestUpdateChatMessage(message, {
          "flags.uesrpg.imperialLuck.lpSpent": spent + 1,
          "flags.uesrpg.imperialLuck.dosAdded": alreadyAdded + add,
          "flags.uesrpg.skillTest.degree": nextDegree,
          "flags.uesrpg.skillTest.textual": `${nextDegree} DoS`,
          "flags.uesrpg-3ev4.imperialLuck.lpSpent": spent + 1,
          "flags.uesrpg-3ev4.imperialLuck.dosAdded": alreadyAdded + add,
          "flags.uesrpg-3ev4.skillTest.degree": nextDegree,
          "flags.uesrpg-3ev4.skillTest.textual": `${nextDegree} DoS`,
        });

        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: freshActor }),
          content: `<div class="uesrpg"><b>Imperial Luck</b>: spent 1 LP, +${add} DoS (now ${nextDegree} DoS).</div>`,
          whisper: _getWhisperRecipients(freshActor),
          style: CONST.CHAT_MESSAGE_STYLES.OTHER
        });
        succeeded = true;
      } catch (err) {
        console.error("UESRPG | Imperial Luck spend failed", err);
        ui.notifications?.error?.("Imperial Luck spend failed. Check console for details.");
      } finally {
        if (!succeeded) btn.disabled = false;
      }
    });

    wrap.appendChild(btn);

    const anchor =
      root.querySelector(".dice-roll .dice-result") ??
      root.querySelector(".message-content") ??
      root;
    anchor.appendChild(wrap);
  } catch (_e) {
    // Do not hard-fail chat rendering.
  }
}

/**
 * After damage/healing is applied via an inline panel button on an opposed card,
 * mark the damage as "applied" on the card flags and re-render.
 * No-ops silently if the message is not an opposed card.
 */
async function _markInlineDamageApplied(message, targetUuid) {
  const raw = message?.flags?.["uesrpg-3ev4"]?.opposed;
  if (!raw) return;
  const data = foundry.utils.deepClone(raw);

  // Locate the matching defender entry.
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
  _setDefenderDamage(data, defender, dmg);

  const helpers = {
    _getDefenderEntries, _isBankChoicesEnabledForData, _anyActiveGMOnline,
    _getBankCommitState, _getDefenderOutcome, _getDefenderAdvantage,
    _getDefenderResolutionState, _allDefendersCommitted, _isMultiDefender,
    _safeGetSetting
  };
  const _renderCard = (d, msgId) =>
    _isMultiDefender(d) ? renderMultiDefenderCard(d, msgId, helpers) : renderSingleDefenderCard(d, msgId, helpers);
  await updateCard(message, data, _renderCard);
}

// ── Magic Inline Damage / Healing Handlers ──────────────────────────────────

/**
 * Mark a magic inline damage panel as "applied" on the magic opposed card
 * and re-render the card.
 * @param {ChatMessage} message
 * @param {string} targetUuid
 */
async function _markMagicInlineDamageApplied(message, targetUuid) {
  const raw = message?.flags?.["uesrpg-3ev4"]?.magicOpposed;
  if (!raw) return;
  const data = JSON.parse(JSON.stringify(raw.state ?? raw));

  // Locate the matching defender entry.
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
  setMagicDefenderDamage(data, defender, dmg);

  // Re-render the magic opposed card
  const _FLAG_NS = "uesrpg-3ev4";
  const _FLAG_KEY = "magicOpposed";
  const version = Number(raw.version ?? 2);
  const content = renderMagicCard(data, message.id);
  const payload = {
    content,
    flags: { [_FLAG_NS]: { [_FLAG_KEY]: { version, state: data } } }
  };
  await safeUpdateChatMessage(message, payload);
}

/**
 * Handle Apply button click on a magic inline damage panel.
 * Reconstructs the full magic damage call from stored _magicPayload in flags.
 * @param {Event} ev
 * @param {ChatMessage} message
 * @param {HTMLElement} btn
 */
async function _onApplyMagicDamage(ev, message, btn) {
  const targetUuid = btn.dataset.targetUuid || null;

  const targetActor = _resolveActor(message, targetUuid);
  if (!targetActor) {
    ui.notifications.warn("No valid target actor found for magic damage application.");
    return;
  }

  // Retrieve stored magic payload from card flags
  const data = getMagicMessageState(message);
  if (!data) {
    ui.notifications.warn("Could not read magic opposed card state.");
    return;
  }

  // Find the defender entry matching the target
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

  // Resolve spell and caster from UUIDs
  let spell = null;
  let casterActor = null;
  try { spell = mp.spellUuid ? fromUuidSync(mp.spellUuid) : null; } catch (_e) { /* no-op */ }
  try {
    if (mp.casterUuid) {
      const c = fromUuidSync(mp.casterUuid);
      casterActor = c?.documentName === "Actor" ? c : (c?.actor ?? null);
    }
  } catch (_e) { /* no-op */ }

  // Handle effects-only spells (non-damaging hits)
  if (mp.isDamaging === false && !mp.isHealing) {
    // Apply spell effects only, no damage
    if (mp.needsEffects && spell) {
      try {
        await applySpellEffectsToTarget(casterActor, targetActor, spell, {
          actualCost: Number(mp.actualCost ?? 0),
          originalCastWorldTime: Number(mp.originalCastWorldTime ?? 0),
        });
      } catch (err) {
        console.error("UESRPG | Failed to apply spell effects (effects-only):", err);
      }
    }
    // Emit the hook for non-damaging spell hits
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

  // Apply magic damage
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
  });

  // If the spell was absorbed, mark applied but skip effects
  if (damageResult?.spellAbsorbed) {
    await _markMagicInlineDamageApplied(message, targetUuid);
    return;
  }

  // Apply spell effects if applicable
  if (mp.needsEffects && spell) {
    try {
      await applySpellEffectsToTarget(casterActor, targetActor, spell, {
        actualCost: Number(mp.actualCost ?? 0),
        originalCastWorldTime: Number(mp.originalCastWorldTime ?? 0),
      });
    } catch (err) {
      console.error("UESRPG | Failed to apply deferred spell effects:", err);
    }
  }

  // Emit spellHitTarget hook
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

  await _markMagicInlineDamageApplied(message, targetUuid);
}

/**
 * Handle Apply button click on a magic inline healing panel.
 * @param {Event} ev
 * @param {ChatMessage} message
 * @param {HTMLElement} btn
 */
async function _onApplyMagicHealing(ev, message, btn) {
  const targetUuid = btn.dataset.targetUuid || null;

  const targetActor = _resolveActor(message, targetUuid);
  if (!targetActor) {
    ui.notifications.warn("No valid target actor found for magic healing.");
    return;
  }

  // Retrieve stored magic payload from card flags
  const data = getMagicMessageState(message);
  if (!data) {
    ui.notifications.warn("Could not read magic opposed card state.");
    return;
  }

  // Find the defender entry matching the target
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

  // Resolve spell and caster from UUIDs
  let spell = null;
  let casterActor = null;
  try { spell = mp.spellUuid ? fromUuidSync(mp.spellUuid) : null; } catch (_e) { /* no-op */ }
  try {
    if (mp.casterUuid) {
      const c = fromUuidSync(mp.casterUuid);
      casterActor = c?.documentName === "Actor" ? c : (c?.actor ?? null);
    }
  } catch (_e) { /* no-op */ }

  // Apply magic healing
  const healResult = await applyMagicHealing(targetActor, Number(mp.damage ?? 0), spell, {
    source: mp.source ?? "Spell",
    rollHTML: mp.rollHTML ?? "",
    isTemporary: Boolean(mp.isTemporary),
    casterActor,
    magicCost: Number(mp.magicCost ?? 0),
  });

  // If spell was absorbed, mark applied but skip effects
  if (healResult?.spellAbsorbed) {
    await _markMagicInlineDamageApplied(message, targetUuid);
    return;
  }

  // Apply spell effects if applicable
  if (mp.needsEffects && spell) {
    try {
      await applySpellEffectsToTarget(casterActor, targetActor, spell, {
        actualCost: Number(mp.actualCost ?? 0),
        originalCastWorldTime: Number(mp.originalCastWorldTime ?? 0),
      });
    } catch (err) {
      console.error("UESRPG | Failed to apply deferred spell effects after healing:", err);
    }
  }

  await _markMagicInlineDamageApplied(message, targetUuid);
}

// ── Combat Inline Damage / Healing Handlers ─────────────────────────────────

async function _onApplyDamage(ev, message) {
  ev.preventDefault();

  const btn = ev.currentTarget;

  // Route magic damage to dedicated magic handler
  if (String(btn.dataset.magic ?? "0") === "1") {
    return _onApplyMagicDamage(ev, message, btn);
  }

  const targetUuid = btn.dataset.targetUuid || null;
  const rawDamage = Number(btn.dataset.damage || 0);
  const damageType = btn.dataset.damageType || DAMAGE_TYPES.PHYSICAL;
  const dosBonus = Number(btn.dataset.dosBonus || 0);
  const penetration = Number(btn.dataset.penetration || 0);
  const hitLocation = btn.dataset.hitLocation || "Body";
  const source = btn.dataset.source || (message?.speaker?.alias ?? "Unknown");
  const penetrateArmorForTriggers = String(btn.dataset.penetrateArmor ?? "0") === "1";
	const forcefulImpact = String(btn.dataset.forcefulImpact ?? "0") === "1";
  const pressAdvantage = String(btn.dataset.pressAdvantage ?? "0") === "1";
  const ignoreReduction = String(btn.dataset.ignoreReduction ?? "0") === "1";
  const magicSource = String(btn.dataset.magicSource ?? "0") === "1";
  const sourceItemUuid = btn.dataset.sourceItemUuid || null;
  const attackMode = String(btn.dataset.attackMode ?? "").trim() || null;
  const attackFromHidden = (String(btn.dataset.attackHidden ?? "").trim() === "1")
    ? true
    : (String(btn.dataset.attackHidden ?? "").trim() === "0" ? false : null);
  const ammoUuid = String(btn.dataset.ammoUuid ?? "").trim() || null;

  // Optional enrichment for RAW weapon trait bonuses.
  // If present, these are resolved safely and passed through to applyDamage().
  const attackerActorUuid = btn.dataset.attackerActorUuid || null;
  const weaponUuid = btn.dataset.weaponUuid || null;

  const targetActor = _resolveActor(message, targetUuid);
  if (!targetActor) {
    ui.notifications.warn("No valid target actor found for damage application.");
    return;
  }

  let attackerActor = null;
  let weapon = null;

  try {
    if (attackerActorUuid) {
      const a = fromUuidSync(attackerActorUuid);
      attackerActor = (a?.documentName === "Actor") ? a : (a?.actor ?? null);
    }
  } catch (_e) {
    attackerActor = null;
  }

  try {
    if (weaponUuid) {
      weapon = fromUuidSync(weaponUuid) ?? null;
    }
  } catch (_e) {
    weapon = null;
  }

  await applyDamageResolved(targetActor, {
    rawDamage,
    damageType,
    dosBonus,
    penetration,
    hitLocation,
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
    attackFromHidden,
    ammoUuid,
  });

  // Mark inline damage as applied on the opposed card (no-op if not an opposed card)
  await _markInlineDamageApplied(message, targetUuid);
}

async function _onApplyHealing(ev, message) {
  ev.preventDefault();

  const btn = ev.currentTarget;

  // Route magic healing to dedicated magic handler
  if (String(btn.dataset.magic ?? "0") === "1") {
    return _onApplyMagicHealing(ev, message, btn);
  }

  const targetUuid = btn.dataset.targetUuid || null;
  const healing = Number(btn.dataset.healing || 0);
  const source = btn.dataset.source || (message?.speaker?.alias ?? "Healing");
  const isTemporary = String(btn.dataset.tempHp ?? "0") === "1";

  const targetActor = _resolveActor(message, targetUuid);
  if (!targetActor) {
    ui.notifications.warn("No valid target actor found for healing.");
    return;
  }

  await applyHealing(targetActor, healing, { source, isTemporary });

  // Mark inline healing as applied on the opposed card (no-op if not an opposed card)
  await _markInlineDamageApplied(message, targetUuid);
}



async function _onSkillOpposedAction(ev, message) {
  ev.preventDefault();
  const btn = ev.currentTarget;
  const action = btn.dataset.uesSkillOpposedAction;
  await SkillOpposedWorkflow.handleAction(message, action, { event: ev });
}

async function _onCharOpposedAction(ev, message) {
  ev.preventDefault();
  const btn = ev.currentTarget;
  const action = btn.dataset.uesCharOpposedAction;
  await CharOpposedWorkflow.handleAction(message, action);
}

function _getSkillOpposedState(message) {
  const raw = message?.flags?.["uesrpg-3ev4"]?.skillOpposed;
  if (!raw) return null;
  if (raw && typeof raw === "object" && Number(raw.version) >= 1 && raw.state) return raw.state;
  if (raw && typeof raw === "object" && raw.attacker && raw.defender) return raw;
  return null;
}

function _getCharOpposedState(message) {
  const raw = message?.flags?.["uesrpg-3ev4"]?.charOpposed;
  if (!raw) return null;
  if (raw && typeof raw === "object" && Number(raw.version) >= 1 && raw.state) return raw.state;
  if (raw && typeof raw === "object" && raw.attacker && raw.defender) return raw;
  return null;
}

function _getMessageIdFromContextLi(li) {
  if (!li) return null;
  const el = li instanceof HTMLElement ? li : li?.[0];
  if (el?.dataset?.messageId) {
    const out = String(el.dataset.messageId);
    _ctxMenuDebug("resolveMessageId.dataset", { out });
    return out;
  }
  if (el?.getAttribute) {
    const attrId = String(el.getAttribute("data-message-id") ?? "").trim();
    if (attrId) {
      _ctxMenuDebug("resolveMessageId.data-message-id", { out: attrId });
      return attrId;
    }
    const elId = String(el.id ?? "").trim();
    const m = /^chat-message-(.+)$/.exec(elId);
    if (m?.[1]) {
      const out = String(m[1]);
      _ctxMenuDebug("resolveMessageId.element-id", { elementId: elId, out });
      return out;
    }
  }
  if (typeof li?.data === "function") {
    const id = li.data("messageId");
    if (id != null) {
      const out = String(id);
      _ctxMenuDebug("resolveMessageId.jquery-data", { out });
      return out;
    }
  }
  if (typeof li?.attr === "function") {
    const attrId = String(li.attr("data-message-id") ?? "").trim();
    if (attrId) {
      _ctxMenuDebug("resolveMessageId.jquery-attr-data-message-id", { out: attrId });
      return attrId;
    }
    const elId = String(li.attr("id") ?? "").trim();
    const m = /^chat-message-(.+)$/.exec(elId);
    if (m?.[1]) {
      const out = String(m[1]);
      _ctxMenuDebug("resolveMessageId.jquery-id", { elementId: elId, out });
      return out;
    }
  }
  _ctxMenuDebug("resolveMessageId.failed", {
    hasElement: Boolean(el),
    elementId: String(el?.id ?? ""),
    dataMessageId: String(el?.dataset?.messageId ?? "")
  });
  return null;
}

function _getSingleUserSelectedToken() {
  const controlled = Array.from(canvas?.tokens?.controlled ?? []);
  if (controlled.length !== 1) return null;
  return controlled[0] ?? null;
}

async function _executeContextRetarget(li, { role = "attacker" } = {}) {
  const messageId = _getMessageIdFromContextLi(li);
  const message = messageId ? (game.messages?.get?.(messageId) ?? null) : null;
  if (!message) {
    _ctxMenuDebug(`callback.change${role === "defender" ? "Defender" : "Attacker"}.noMessage`, { messageId });
    return;
  }

  const selected = _getSingleUserSelectedToken();
  if (!selected) {
    const selectedCount = Array.from(canvas?.tokens?.controlled ?? []).length;
    _ctxMenuDebug(`callback.change${role === "defender" ? "Defender" : "Attacker"}.badSelectedCount`, { count: selectedCount });
    ui.notifications?.warn?.(`Select exactly 1 token to change the ${role}.`);
    return;
  }

  const selectedTokenUuid = selected.document?.uuid ?? selected.uuid ?? null;
  _ctxMenuDebug(`callback.change${role === "defender" ? "Defender" : "Attacker"}.execute`, {
    messageId,
    selectedTokenId: selected.id ?? null,
    selectedTokenUuid
  });

  if (role === "defender") {
    await retargetOpposedMessage(
      message,
      { defenderTokenUuid: selectedTokenUuid },
      { userId: game.user?.id ?? null, reason: "context-change-defender" }
    );
    return;
  }

  await retargetOpposedMessage(
    message,
    { attackerTokenUuid: selectedTokenUuid },
    { userId: game.user?.id ?? null, reason: "context-change-attacker" }
  );
}

function _isOpposedCardMessage(message) {
  const flags = message?.flags?.["uesrpg-3ev4"] ?? {};
  const isOpposed = Boolean(flags?.opposed || flags?.skillOpposed || flags?.magicOpposed);
  _ctxMenuDebug("isOpposedCardMessage", {
    messageId: message?.id ?? null,
    opposed: Boolean(flags?.opposed),
    skillOpposed: Boolean(flags?.skillOpposed),
    magicOpposed: Boolean(flags?.magicOpposed),
    isOpposed
  });
  return isOpposed;
}


async function _onShockAction(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  const action = el?.dataset?.uesShockAction;
  if (!action) return;

  const actorUuid = el?.dataset?.actorUuid;
  const woundEffectId = el?.dataset?.woundEffectId;
  if (!actorUuid || !woundEffectId) {
    ui.notifications?.warn?.("Shock: missing actor or wound reference.");
    return;
  }

  let actor = null;
  try {
    actor = fromUuidSync(actorUuid);
  } catch (_e) {
    actor = null;
  }

  if (!actor) {
    ui.notifications?.warn?.("Shock: actor not found.");
    return;
  }

  if (!canUserRollActor(game.user, actor)) {
    ui.notifications?.warn?.("You do not have permission to roll for this actor.");
    return;
  }

  try {
    await resolveShockTestFromChat({ actorUuid, woundEffectId, action });
  } catch (err) {
    console.error("UESRPG | Shock roll handler failed", err);
    ui.notifications?.error?.("Shock roll failed. Check console for details.");
  }
}

async function _onDiseaseAction(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  const action = el?.dataset?.uesDiseaseAction;
  if (action !== "roll") return;

  const state = message?.flags?.["uesrpg-3ev4"]?.diseaseCheck ?? {};
  if (state?.resolved) return;

  const actorUuid = el?.dataset?.actorUuid ?? state?.actorUuid;
  const actor = actorUuid ? _resolveActor(message, actorUuid) : null;
  if (!actor) {
    ui.notifications?.warn?.("Disease check: actor not found.");
    return;
  }

  if (!canUserRollActor(game.user, actor)) {
    ui.notifications?.warn?.("You do not have permission to roll for this actor.");
    return;
  }

  const traitValue = Number(el?.dataset?.traitValue ?? state?.traitValue ?? 0) || 0;
  const sourceLabel = String(el?.dataset?.sourceLabel ?? state?.sourceLabel ?? "Disease").trim() || "Disease";

  if (isActorImmuneToDamageType(actor, "disease")) {
    await requestUpdateChatMessage(message, {
      "flags.uesrpg-3ev4.diseaseCheck.resolved": true,
      "flags.uesrpg-3ev4.diseaseCheck.resolvedAt": Date.now(),
      "flags.uesrpg-3ev4.diseaseCheck.result": { passed: true, resisted: true, immune: true }
    });

    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="uesrpg-disease-result"><h3>Disease Check</h3><div><b>Source:</b> ${sourceLabel}</div><div><b>Outcome:</b> Immune to disease.</div></div>`,
      whisper: _getWhisperRecipients(actor),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
    return;
  }

  const endTotal = Number(actor.system?.characteristics?.end?.total ?? 0);
  const woundPenalty = Number(actor.system?.woundPenalty ?? 0);
  const fatiguePenalty = Number(actor.system?.fatigue?.penalty ?? 0);
  const carryPenalty = Number(actor.system?.carry_rating?.penalty ?? 0);
  const tn = endTotal + woundPenalty + fatiguePenalty + carryPenalty + traitValue;

  const roll = new Roll("1d100");
  await roll.evaluate();

  const passed = Number(roll.total ?? 0) <= tn;
  const resistPercent = getDiseaseResistancePercent(actor);
  let resisted = false;
  let resistRoll = null;

  if (!passed && resistPercent > 0) {
    resistRoll = new Roll("1d100");
    await resistRoll.evaluate();
    resisted = Number(resistRoll.total ?? 0) <= resistPercent;
  }

  await requestUpdateChatMessage(message, {
    "flags.uesrpg-3ev4.diseaseCheck.resolved": true,
    "flags.uesrpg-3ev4.diseaseCheck.resolvedAt": Date.now(),
    "flags.uesrpg-3ev4.diseaseCheck.result": { passed, resisted }
  });

  const outcome = passed
    ? "Success - no disease."
    : (resisted ? "Failed test, but Disease Resistance prevented infection." : "Failed test - contracts disease.");

  const lines = [
    `<div><b>Source:</b> ${sourceLabel}</div>`,
    `<div><b>Endurance TN:</b> ${tn}</div>`,
    `<div><b>Roll:</b> ${roll.total}</div>`,
    `<div><b>Outcome:</b> ${outcome}</div>`
  ];
  if (!passed && resistPercent > 0 && resistRoll) {
    lines.push(`<div><b>Disease Resistance:</b> ${resistPercent}% - roll ${resistRoll.total}</div>`);
  }

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="uesrpg-disease-result"><h3>Disease Check</h3>${lines.join("")}</div>`,
    whisper: _getWhisperRecipients(actor),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

async function _onRegenerationAction(event, message) {
  event.preventDefault();
  const el = event.currentTarget;
  const action = el?.dataset?.uesRegenerationAction;
  if (action !== "roll") return;

  const state = message?.flags?.["uesrpg-3ev4"]?.regenerationPrompt ?? {};
  if (state?.resolved) return;

  const actorUuid = el?.dataset?.actorUuid ?? state?.actorUuid;
  const actor = actorUuid ? _resolveActor(message, actorUuid) : null;
  if (!actor) {
    ui.notifications?.warn?.("Regeneration: actor not found.");
    return;
  }

  if (!canUserRollActor(game.user, actor)) {
    ui.notifications?.warn?.("You do not have permission to roll for this actor.");
    return;
  }

  const value = Number(el?.dataset?.regenValue ?? state?.value ?? 0) || 0;
  if (value <= 0) return;

  const endTotal = Number(actor.system?.characteristics?.end?.total ?? 0);
  const woundPenalty = Number(actor.system?.woundPenalty ?? 0);
  const fatiguePenalty = Number(actor.system?.fatigue?.penalty ?? 0);
  const carryPenalty = Number(actor.system?.carry_rating?.penalty ?? 0);
  const tn = endTotal + woundPenalty + fatiguePenalty + carryPenalty;

  const roll = new Roll("1d100");
  await roll.evaluate();
  const passed = Number(roll.total ?? 0) <= tn;

  await requestUpdateChatMessage(message, {
    "flags.uesrpg-3ev4.regenerationPrompt.resolved": true,
    "flags.uesrpg-3ev4.regenerationPrompt.resolvedAt": Date.now(),
    "flags.uesrpg-3ev4.regenerationPrompt.result": { passed }
  });

  if (passed) {
    await applyHealing(actor, value, { source: "Regeneration" });
  }

  const content = `
    <div class="uesrpg-regeneration-result">
      <h3>Regeneration</h3>
      <div><b>Endurance TN:</b> ${tn}</div>
      <div><b>Roll:</b> ${roll.total}</div>
      <div><b>Outcome:</b> ${passed ? `Success - healed ${value} HP` : "Failed - no healing"}</div>
    </div>
  `;

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    whisper: _getWhisperRecipients(actor),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

async function _onOpposedAction(ev, message) {
  ev.preventDefault();
  const btn = ev.currentTarget;
  const action = btn.dataset.uesOpposedAction;
  const defenderIndexRaw = btn.dataset.defenderIndex;
  const defenderIndex = Number.isFinite(Number(defenderIndexRaw)) ? Number(defenderIndexRaw) : null;
  await OpposedWorkflow.handleAction(message, action, { defenderIndex });
}

/**
 * Determine whether an updateChatMessage change object is relevant for banked-choice opposed auto-rolling.
 * We only care about updates that affect the opposed flags or the chat content of an opposed card.
 *
 * @param {object} changes
 * @returns {boolean}
 */
function _isRelevantOpposedUpdate(changes) {
  if (!changes || typeof changes !== "object") return false;

  // Direct top-level content update.
  if (Object.prototype.hasOwnProperty.call(changes, "content")) return true;

  // Dot-path style updates (defensive; some update payloads may include these).
  for (const k of Object.keys(changes)) {
    if (k === "content") return true;
    if (typeof k === "string" && k.startsWith("flags.uesrpg-3ev4.opposed")) return true;
    if (typeof k === "string" && k.startsWith("flags.uesrpg-3ev4.skillOpposed")) return true;
    if (typeof k === "string" && k.startsWith("flags.uesrpg-3ev4.charOpposed")) return true;
    if (typeof k === "string" && k.startsWith("flags.uesrpg-3ev4.magicOpposed")) return true;
  }

  // Nested flags update payloads.
  const flags = changes.flags;
  if (flags && typeof flags === "object") {
    const ns = flags["uesrpg-3ev4"];
    if (ns && typeof ns === "object") {
      if (Object.prototype.hasOwnProperty.call(ns, "opposed")) return true;
      if (Object.prototype.hasOwnProperty.call(ns, "skillOpposed")) return true;
      if (Object.prototype.hasOwnProperty.call(ns, "charOpposed")) return true;
      if (Object.prototype.hasOwnProperty.call(ns, "magicOpposed")) return true;
    }
  }

  return false;
}

/**
 * Register chat handlers (v13).
 */
export function initializeChatHandlers() {
  if (_chatHooksRegistered) {
    _ctxMenuDebug("initializeChatHandlers.skipAlreadyRegistered", {
      chatHooksRegistered: _chatHooksRegistered,
      contextHooksRegistered: _chatContextHooksRegistered
    });
    return;
  }
  _chatHooksRegistered = true;
  _ctxMenuDebug("initializeChatHandlers.start", { chatHooksRegistered: _chatHooksRegistered });
  _registerChatLogContextProbe();

  Hooks.on("createChatMessage", (message) => {
    _maybeConsumeAmmoFromMessage(message).catch((err) => console.error("UESRPG | Ammo consumption hook failed", err));

    // Opposed workflows: bank attacker/defender roll results into the parent opposed card.
    // This is intentionally executed only by the active GM when present (or by the parent
    // message author when no GM is active) to avoid concurrent updates.
    try {
      const meta = message?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
      const parentId = meta?.parentMessageId ?? null;
      const stage = meta?.stage ?? null;

      if (parentId && stage) {
        const parent = game.messages.get(parentId) ?? null;
        if (parent) {
          const activeGM = game.users.activeGM;
          const shouldRun = activeGM ? (game.user.id === activeGM.id) : parent.isAuthor;
          if (shouldRun) {
            OpposedWorkflow.applyExternalRollMessage(message).catch((err) => console.error("UESRPG | Opposed external roll banking failed", err));
          }
        }
      }
    } catch (err) {
      console.error("UESRPG | Opposed external roll banking hook failed", err);
    }

    // Skill opposed workflows use a separate workflow card; the roll messages include
    // a lightweight meta flag that identifies the parent card.
    try {
      const meta = message?.flags?.["uesrpg-3ev4"]?.skillOpposedMeta ?? null;
      const parentId = meta?.parentMessageId ?? null;
      if (parentId) {
        const parent = game.messages.get(parentId) ?? null;
        if (parent) {
          const activeGM = game.users.activeGM;
          const shouldRun = activeGM ? (game.user.id === activeGM.id) : parent.isAuthor;
          if (shouldRun) {
            SkillOpposedWorkflow.applyExternalRollMessage(message).catch((err) => console.error("UESRPG | Skill opposed external roll banking failed", err));
          }
        }
      }
    } catch (err) {
      console.error("UESRPG | Skill opposed external roll banking hook failed", err);
    }

    // Characteristic opposed workflow external roll banking
    try {
      const meta = message?.flags?.["uesrpg-3ev4"]?.charOpposedMeta ?? null;
      const parentId = meta?.parentMessageId ?? null;
      if (parentId) {
        const parent = game.messages.get(parentId) ?? null;
        if (parent) {
          const activeGM = game.users.activeGM;
          const shouldRun = activeGM ? (game.user.id === activeGM.id) : parent.isAuthor;
          if (shouldRun) {
            CharOpposedWorkflow.applyExternalRollMessage(message).catch((err) => console.error("UESRPG | Char opposed external roll banking failed", err));
          }
        }
      }
    } catch (err) {
      console.error("UESRPG | Char opposed external roll banking hook failed", err);
    }
  });



  Hooks.on("updateChatMessage", (message, changes, _options, _userId) => {
    // Banked-choice opposed workflows: once both sides have committed, rolling proceeds automatically.
    // Guard against unrelated message updates to minimize hook overhead.
    try {
      // Check for combat opposed workflow
      const opposed = message?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
      if (opposed) {
        if (!_isRelevantOpposedUpdate(changes)) return;
        const activeGM = game.users.activeGM ?? null;
        if (activeGM) {
          OpposedWorkflow.maybeAutoRollBanked(message).catch((err) => console.error("UESRPG | Opposed banked GM auto-roll hook failed", err));
        } else {
          OpposedWorkflow.maybeAutoRollBankedNoGM(message).catch((err) => console.error("UESRPG | Opposed banked no-GM auto-roll hook failed", err));
        }
        return;
      }

      // Check for skill opposed workflow
      const skillOpposed = message?.flags?.["uesrpg-3ev4"]?.skillOpposed ?? null;
      if (skillOpposed) {
        if (!_isRelevantOpposedUpdate(changes)) return;
        const activeGM = game.users.activeGM ?? null;
        // Import SkillOpposedWorkflow dynamically to avoid circular dependencies
        import("../skills/opposed-workflow.js").then(({ SkillOpposedWorkflow }) => {
          if (activeGM) {
            SkillOpposedWorkflow.maybeAutoRollBanked?.(message).catch((err) => console.error("UESRPG | Skill opposed banked GM auto-roll hook failed", err));
          } else {
            SkillOpposedWorkflow.maybeAutoRollBankedNoGM?.(message).catch((err) => console.error("UESRPG | Skill opposed banked no-GM auto-roll hook failed", err));
          }
        }).catch((err) => console.error("UESRPG | Failed to load SkillOpposedWorkflow for banked auto-roll", err));
        return;
      }

      // Check for magic opposed workflow
      const magicOpposed = message?.flags?.["uesrpg-3ev4"]?.magicOpposed ?? null;
      if (magicOpposed) {
        if (!_isRelevantOpposedUpdate(changes)) return;
        const activeGM = game.users.activeGM ?? null;
        // Import MagicOpposedWorkflow dynamically to avoid circular dependencies
        import("../magic/opposed-workflow.js").then(({ MagicOpposedWorkflow }) => {
          if (activeGM) {
            MagicOpposedWorkflow.maybeAutoRollBanked?.(message).catch((err) => console.error("UESRPG | Magic opposed banked GM auto-roll hook failed", err));
          } else {
            MagicOpposedWorkflow.maybeAutoRollBankedNoGM?.(message).catch((err) => console.error("UESRPG | Magic opposed banked no-GM auto-roll hook failed", err));
          }
        }).catch((err) => console.error("UESRPG | Failed to load MagicOpposedWorkflow for banked auto-roll", err));
      }

      // Check for characteristic opposed workflow
      const charOpposed = message?.flags?.["uesrpg-3ev4"]?.charOpposed ?? null;
      if (charOpposed) {
        if (!_isRelevantOpposedUpdate(changes)) return;
        const activeGM = game.users.activeGM ?? null;
        if (activeGM) {
          CharOpposedWorkflow.maybeAutoRollBanked?.(message).catch((err) => console.error("UESRPG | Char opposed banked GM auto-roll hook failed", err));
        } else {
          CharOpposedWorkflow.maybeAutoRollBankedNoGM?.(message).catch((err) => console.error("UESRPG | Char opposed banked no-GM auto-roll hook failed", err));
        }
      }
    } catch (err) {
      console.error("UESRPG | Opposed banked auto-roll update hook failed", err);
    }
  });

  Hooks.on("renderChatMessageHTML", (message, html) => {
    // html is an HTMLElement in v13, but some modules provide a jQuery wrapper.
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    root.querySelectorAll(".apply-damage-btn").forEach((el) => {
      el.addEventListener("click", (ev) => _onApplyDamage(ev, message));
    });

    root.querySelectorAll(".apply-healing-btn").forEach((el) => {
      el.addEventListener("click", (ev) => _onApplyHealing(ev, message));
    });

    root.querySelectorAll("[data-ues-opposed-action]").forEach((el) => {
      el.addEventListener("click", (ev) => _onOpposedAction(ev, message));
    });

    // Skill opposed-roll chat card buttons
    root.querySelectorAll("[data-ues-skill-opposed-action]").forEach((el) => {
      const action = el.dataset.uesSkillOpposedAction;
      const data = _getSkillOpposedState(message);
      let actor = null;
      try {
        const actorUuid = (action === "attacker-roll") ? data?.attacker?.actorUuid : (action === "defender-roll") ? data?.defender?.actorUuid : null;
        actor = actorUuid ? fromUuidSync(actorUuid) : null;
      } catch (_e) {
        actor = null;
      }

      // Permission-aware button state
      if (actor && !canUserRollActor(game.user, actor)) {
        el.setAttribute("disabled", "disabled");
        el.setAttribute("title", "You do not have permission to roll for this actor.");
      }

      el.addEventListener("click", (ev) => _onSkillOpposedAction(ev, message));
    });

    // Hide GM-only elements for non-GM users (client-local visibility)
    if (!game.user.isGM) {
      root.querySelectorAll("[data-ues-gm-only]").forEach((el) => {
        el.style.display = "none";
      });
    }

    // Characteristic opposed-roll chat card buttons
    root.querySelectorAll("[data-ues-char-opposed-action]").forEach((el) => {
      const action = el.dataset.uesCharOpposedAction;
      const data = _getCharOpposedState(message);
      let actor = null;
      try {
        const actorUuid = (action === "attacker-roll") ? data?.attacker?.actorUuid : (action === "defender-roll") ? data?.defender?.actorUuid : null;
        actor = actorUuid ? fromUuidSync(actorUuid) : null;
      } catch (_e) {
        actor = null;
      }

      // Permission-aware button state
      if (actor && !canUserRollActor(game.user, actor)) {
        el.setAttribute("disabled", "disabled");
        el.setAttribute("title", "You do not have permission to roll for this actor.");
      }

      el.addEventListener("click", (ev) => _onCharOpposedAction(ev, message));
    });

    // Shock Test chat card buttons (Wounds).
    root.querySelectorAll("[data-ues-shock-action]").forEach((el) => {
      const actorUuid = el.dataset.actorUuid;
      let actor = null;
      try {
        actor = actorUuid ? fromUuidSync(actorUuid) : null;
      } catch (_e) {
        actor = null;
      }

      if (actor && !canUserRollActor(game.user, actor)) {
        el.setAttribute("disabled", "disabled");
        el.setAttribute("title", "You do not have permission to roll for this actor.");
      }

      el.addEventListener("click", (ev) => _onShockAction(ev, message));
    });

    // Disease check buttons
    root.querySelectorAll("[data-ues-disease-action]").forEach((el) => {
      const actorUuid = el.dataset.actorUuid;
      let actor = null;
      try {
        actor = actorUuid ? fromUuidSync(actorUuid) : null;
      } catch (_e) {
        actor = null;
      }

      if (actor && !canUserRollActor(game.user, actor)) {
        el.setAttribute("disabled", "disabled");
        el.setAttribute("title", "You do not have permission to roll for this actor.");
      }

      el.addEventListener("click", (ev) => _onDiseaseAction(ev, message));
    });

    // Regeneration check buttons
    root.querySelectorAll("[data-ues-regeneration-action]").forEach((el) => {
      const actorUuid = el.dataset.actorUuid;
      let actor = null;
      try {
        actor = actorUuid ? fromUuidSync(actorUuid) : null;
      } catch (_e) {
        actor = null;
      }

      if (actor && !canUserRollActor(game.user, actor)) {
        el.setAttribute("disabled", "disabled");
        el.setAttribute("title", "You do not have permission to roll for this actor.");
      }

      el.addEventListener("click", (ev) => _onRegenerationAction(ev, message));
    });

    // Special Action opposed test card buttons
    root.querySelectorAll("[data-ues-special-action]").forEach((el) => {
      const action = el.dataset.uesSpecialAction;
      
      // Get actor from message flags for permission check
      let actor = null;
      try {
        const state = message.flags?.["uesrpg-3ev4"]?.specialActionOpposed?.state;
        const actorUuid = (action === "attacker-roll") 
          ? state?.attacker?.actorUuid 
          : (action === "defender-roll") 
            ? state?.defender?.actorUuid 
            : null;
        actor = actorUuid ? fromUuidSync(actorUuid) : null;
      } catch (_e) {
        actor = null;
      }

      // Permission-aware button state
      if (actor && !canUserRollActor(game.user, actor)) {
        el.setAttribute("disabled", "disabled");
        el.setAttribute("title", "You do not have permission to roll for this actor.");
      }
      
      el.addEventListener("click", async (ev) => {
        ev.preventDefault();
        try {
          const { handleSpecialActionCardAction } = await import("./special-actions-helper.js");
          await handleSpecialActionCardAction(message, action);
        } catch (err) {
          console.error("UESRPG | Special Action button handler failed", err);
        }
      });
    });

    // Collapsible action cards (sheet quick-actions).
    // IMPORTANT: Foundry chat sanitization may strip the `hidden` attribute.
    // We therefore enforce the default collapsed state at render time and
    // toggle via inline `style.display`.
	    root.querySelectorAll(".uesrpg-action-card[data-ues-action-card]").forEach((card) => {
      const body = card.querySelector("[data-ues-action-card-body]");
      const btn = card.querySelector("[data-ues-action-card-toggle]");
      if (!body || !btn) return;

      // One-time initialization per rendered DOM instance.
      if (!card.dataset.uesActionCardInit) {
        card.dataset.uesActionCardInit = "1";

        // Default collapsed unless explicitly marked expanded.
        const isExpanded = String(card.dataset.uesActionCardExpanded ?? "0") === "1";
        body.style.display = isExpanded ? "" : "none";
        body.setAttribute("aria-hidden", isExpanded ? "false" : "true");
        btn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
        btn.textContent = isExpanded ? "Collapse" : "Expand";
      }

      // Ensure consistent button styling (prevents wrap like "Expan\nd").
      if (!btn.style.whiteSpace) btn.style.whiteSpace = "nowrap";
      if (!btn.style.display) btn.style.display = "inline-flex";
      if (!btn.style.alignItems) btn.style.alignItems = "center";
      if (!btn.style.justifyContent) btn.style.justifyContent = "center";

      if (btn.dataset.uesActionCardToggleInit) return;
      btn.dataset.uesActionCardToggleInit = "1";

      btn.addEventListener("click", (ev) => {
        ev.preventDefault();

        const currentlyCollapsed = (body.style.display === "none");
        const nextExpanded = currentlyCollapsed;

        body.style.display = nextExpanded ? "" : "none";
        body.setAttribute("aria-hidden", nextExpanded ? "false" : "true");

        // Persist state on the DOM dataset (survives subsequent hook re-renders
        // for the same message render instance).
        card.dataset.uesActionCardExpanded = nextExpanded ? "1" : "0";

        btn.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
        btn.textContent = nextExpanded ? "Collapse" : "Expand";
      });
	    });

	    // General talents: Expert / Grandmaster reroll affordance on failed skill tests.
	    _injectTalentRerollButton(message, root);

	    // Imperial racial talent: Imperial Luck (Chapter 4) spend LP for extra DoS on successful tests.
	    _injectImperialLuckDoSButton(message, root);

	  });

  if (!_chatContextHooksRegistered) {
    _chatContextHooksRegistered = true;
    _ctxMenuDebug("register.getChatLogEntryContext", { registered: true });

    if (!_ctxMenuDebugHelperRegistered) {
      _ctxMenuDebugHelperRegistered = true;
      game.uesrpg = game.uesrpg || {};
      game.uesrpg.debugContextMenu = {
        enable() {
          globalThis.__UESRPG_CTX_MENU_DEBUG__ = true;
          // eslint-disable-next-line no-console
          console.log("UESRPG | ContextMenuDebug enabled");
        },
        disable() {
          globalThis.__UESRPG_CTX_MENU_DEBUG__ = false;
          // eslint-disable-next-line no-console
          console.log("UESRPG | ContextMenuDebug disabled");
        },
        status() {
          const enabled = _ctxMenuDebugEnabled();
          // eslint-disable-next-line no-console
          console.log("UESRPG | ContextMenuDebug status", { enabled, runtime: Boolean(globalThis?.__UESRPG_CTX_MENU_DEBUG__ === true) });
          return enabled;
        },
        inspectMessage(messageId) {
          const id = String(messageId ?? "").trim();
          const msg = id ? (game.messages?.get?.(id) ?? null) : null;
          const report = {
            messageId: id || null,
            found: Boolean(msg),
            isOpposed: Boolean(msg ? _isOpposedCardMessage(msg) : false),
            canRetarget: Boolean(msg ? canRetargetOpposedMessage(msg, game.user) : false),
            userId: game.user?.id ?? null,
            flags: msg?.flags?.["uesrpg-3ev4"] ?? null
          };
          // eslint-disable-next-line no-console
          console.log("UESRPG | ContextMenuDebug inspectMessage", report);
          return report;
        },
        inspectLi(li) {
          const messageId = _getMessageIdFromContextLi(li);
          const report = this.inspectMessage(messageId);
          // eslint-disable-next-line no-console
          console.log("UESRPG | ContextMenuDebug inspectLi", {
            messageId,
            hasElement: Boolean(li instanceof HTMLElement ? li : li?.[0])
          });
          return report;
        },
        inspectLatest() {
          const selectors = [
            "#chat-log li.chat-message:last-of-type",
            "#chat-log li.message:last-of-type",
            "#chat-log .chat-message:last-of-type",
            "#chat-log .message:last-of-type"
          ];
          let el = null;
          let matchedSelector = null;
          for (const sel of selectors) {
            const found = document.querySelector(sel);
            if (found) {
              el = found;
              matchedSelector = sel;
              break;
            }
          }
          if (!el) {
            // eslint-disable-next-line no-console
            console.log("UESRPG | ContextMenuDebug inspectLatest", { found: false, selectors });
            return this.inspectLi(null);
          }
          // eslint-disable-next-line no-console
          console.log("UESRPG | ContextMenuDebug inspectLatest", { found: true, matchedSelector, className: el.className, id: el.id });
          return this.inspectLi(el);
        }
      };
    }

    const addOpposedContextOptions = (hookName, options) => {
      if (!Array.isArray(options)) return;
      _ctxMenuDebug(`hook.${hookName}.fired`, { optionsCountBefore: options.length });

      const alreadyHasAttacker = options.some((opt) => String(opt?.name ?? "").trim() === "Change attacker");
      const alreadyHasDefender = options.some((opt) => String(opt?.name ?? "").trim() === "Change defender");

      if (!alreadyHasAttacker) {
        options.push({
          name: "Change attacker",
          icon: '<i class="fas fa-user-pen"></i>',
          condition: (li) => {
            const messageId = _getMessageIdFromContextLi(li);
            if (!messageId) {
              _ctxMenuDebug("condition.changeAttacker.noMessageId");
              return false;
            }
            const message = game.messages?.get?.(messageId) ?? null;
            if (!message || !_isOpposedCardMessage(message)) {
              _ctxMenuDebug("condition.changeAttacker.notOpposed", { messageId, hasMessage: Boolean(message) });
              return false;
            }
            const allowed = canRetargetOpposedMessage(message, game.user);
            _ctxMenuDebug("condition.changeAttacker.result", { messageId, allowed, userId: game.user?.id ?? null });
            return allowed;
          },
          callback: async (li) => {
            await _executeContextRetarget(li, { role: "attacker" });
          }
        });
      }

      if (!alreadyHasDefender) {
        options.push({
          name: "Change defender",
          icon: '<i class="fas fa-user-shield"></i>',
          condition: (li) => {
            const messageId = _getMessageIdFromContextLi(li);
            if (!messageId) {
              _ctxMenuDebug("condition.changeDefender.noMessageId");
              return false;
            }
            const message = game.messages?.get?.(messageId) ?? null;
            if (!message || !_isOpposedCardMessage(message)) {
              _ctxMenuDebug("condition.changeDefender.notOpposed", { messageId, hasMessage: Boolean(message) });
              return false;
            }
            const allowed = canRetargetOpposedMessage(message, game.user);
            _ctxMenuDebug("condition.changeDefender.result", { messageId, allowed, userId: game.user?.id ?? null });
            return allowed;
          },
          callback: async (li) => {
            await _executeContextRetarget(li, { role: "defender" });
          }
        });
      }
      _ctxMenuDebug(`hook.${hookName}.optionsPushed`, { optionsCountAfter: options.length });
    };

    Hooks.on("getChatMessageContextOptions", (_html, options) => {
      addOpposedContextOptions("getChatMessageContextOptions", options);
      registerLuckContextMenuOptions("getChatMessageContextOptions", options);
    });
    Hooks.on("getChatLogEntryContext", (_html, options) => {
      addOpposedContextOptions("getChatLogEntryContext", options);
      registerLuckContextMenuOptions("getChatLogEntryContext", options);
    });
  }
	}

/**
 * Backwards-compatible export expected by some init scripts.
 */
export function registerCombatChatHooks() {
  initializeChatHandlers();
}
