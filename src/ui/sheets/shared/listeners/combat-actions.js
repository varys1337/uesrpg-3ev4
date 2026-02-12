/**
 * Combat quick action handlers for actor sheets.
 * 
 * Foundry VTT v13 / AppV1-compatible.
 * 
 * This module contains the large combat quick action handler that was extracted
 * from actor-sheet.js for better maintainability and performance.
 */

import { buildCollapsedActionCardHtml, getAimStateFromEffect, getEnabledEffectByKey, resolveTokenForActor, spendActionPoints } from "../../combat-actions-utils.js";
import { createOrUpdateStatusEffect } from "../../../../core/active-effects/status-effect.js";
import { buildEffectDuration } from "../../../../core/time/effect-duration.js";
import { getSpecialActionById } from "../../../../core/config/special-actions.js";
import { executeActivation, buildSpecialActionActivation } from "../../../../core/system/activation/activation-executor.js";
import { SkillOpposedWorkflow } from "../../../../core/skills/opposed-workflow.js";
import { getActiveCombatStyleId, getExplicitActiveCombatStyleItem, isSpecialActionUsableNow } from "../../../../core/combat/combat-style-utils.js";
import { OpposedWorkflow } from "../../../../core/combat/opposed-workflow.js";
import { setLastMeleeWeaponForActor } from "../../../canvas/reach-visualizer-state.js";
import { hasOpponentWithTalentInMeleeRange } from "../../../../core/traits/combat-proximity.js";
import { recordDashStart } from "../../../../core/combat/combat-utils.js";
import { hasTalent } from "../../../../core/traits/talents-api.js";
import { AimAudit } from "../../../../core/combat/aim-audit.js";
import { isActorBlockedFromAoOAgainstTarget } from "../../../../core/traits/mobility-talents.js";

/**
 * Handle Combat tab quick-action buttons.
 * 
 * Supported actions:
 * - specialAction (requires specialId + targeted token for most)
 * - attack (requires weaponId + targeted token)
 * - disengage, delay, defensive-stance, aim, dash, hide, use-item, reload-weapon, attack-of-opportunity
 * 
 * @param {SimpleActorSheet} sheet - The actor sheet instance
 * @param {Event} event - The click event
 * @returns {Promise<void>}
 */
export async function onCombatQuickAction(sheet, event) {
  event.preventDefault();

  const btn = event.currentTarget;
  const action = btn?.dataset?.action;
  if (!action) return;

  const actor = sheet.actor;

  // Preserve the currently selected Actions subtab across any actor updates
  try {
    const active = sheet.element?.find?.(".uesrpg-actions-subtab.active")?.[0];
    const tab = active?.dataset?.actionstab;
    if (tab) sheet._uesrpgActionsSubtab = tab;
  } catch (_e) {
    // no-op
  }

  // Local helpers
  const postActionCard = async (title, bodyHtml) => {
    const speaker = ChatMessage.getSpeaker({ actor });
    const content = buildCollapsedActionCardHtml(title, bodyHtml);
    return ChatMessage.create({ user: game.user.id, speaker, content });
  };

  const requireAP = async (title, apCost = 1) => {
    return spendActionPoints(actor, apCost, { reason: title });
  };

  const upsertSimpleEffect = async ({ key, name, icon, changes, flags = {}, statusId = null, duration = null }) => {
    const mergedFlags = {
      ...(flags ?? {}),
      uesrpg: { ...(flags?.uesrpg ?? {}), key }
    };

    return createOrUpdateStatusEffect(actor, {
      statusId,
      name,
      img: icon,
      duration: duration ?? {},
      changes: Array.isArray(changes) ? changes : [],
      flags: mergedFlags
    });
  };

  const buildTemporaryDuration = ({ rounds = null, turns = null, seconds = null } = {}) => {
    return buildEffectDuration({ actor, rounds, turns, seconds });
  };

  const _deleteEffect = async (effect) => {
    if (!effect) return;
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
    } catch (err) {
      console.warn("UESRPG | Sheet quick action failed to delete effect", { actor: actor?.uuid, effectId: effect?.id, err });
    }
  };

  const breakAimChainIfPresent = async () => {
    const ef = getEnabledEffectByKey(actor, "aim");
    if (!ef) return;
    await _deleteEffect(ef);
  };

  const ADD = globalThis?.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
  const actorType = String(actor?.type ?? "");

  const resolveCombatStyleForAttack = () => {
    // RAW: NPCs do not use Combat Style items; they use their Combat profession for combat workflows.
    if (actorType === "NPC") {
      const base = Number(actor.system?.professions?.combat ?? 0) || 0;
      return { styleUuid: "prof:combat", styleName: "Combat (Profession)", base };
    }

    // PCs: prefer explicit active style, fallback to first owned combat style item.
    const explicit = getExplicitActiveCombatStyleItem(actor);
    const style = explicit ?? (actor.itemTypes?.combatStyle?.[0]) ?? null;
    if (!style) return null;

    const base = Number(style.system?.value ?? 0) || 0;
    return { styleUuid: style.uuid, styleName: style.name, base };
  };

  switch (action) {
    case "specialAction": {
      const specialId = btn?.dataset?.specialId;
      const at = String(btn?.dataset?.actionType ?? "").toLowerCase();
      const def = getSpecialActionById(specialId);
      const title = def ? `Special Action: ${def.name}` : "Special Action";

      if (!def) {
        ui.notifications?.warn?.("Unknown Special Action.");
        return;
      }

      if (at === "primary" && !isSpecialActionUsableNow(actor, "primary")) {
        ui.notifications?.warn?.("This Primary Special Action is only available on your Turn.");
        return;
      }

      const requiresTarget = specialId !== "arise";
      const activation = buildSpecialActionActivation({
        actionType: at === "secondary" ? "secondary" : "action",
        apCost: 1,
        requiresTarget
      });

      const activationResult = await executeActivation({
        actor,
        activation,
        label: title,
        renderChat: false,
        context: { targets: game.user?.targets }
      });
      if (!activationResult.ok) return;

      let actorToken = canvas.tokens?.controlled?.[0] ?? null;
      if (!actorToken) {
        actorToken = canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;
      }

      const targets = Array.from(game.user.targets ?? []);
      const targetToken = targets[0] ?? null;

      if (!targetToken && requiresTarget) return;

      if (specialId === "arise") {
        const { executeSpecialAction } = await import("../../../../core/combat/special-actions-helper.js");
        const result = await executeSpecialAction({
          specialActionId: specialId,
          actor,
          target: null,
          isAutoWin: false,
          opposedResult: { winner: "attacker" }
        });

        if (result.success) {
          await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="uesrpg-special-action-outcome"><b>Special Action:</b><p>${result.message}</p></div>`,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
          });
        }
        return;
      }

      const activeCombatStyle = getExplicitActiveCombatStyleItem(actor);
      const attackerSkillUuid = activeCombatStyle?.uuid ?? null;

      const message = await SkillOpposedWorkflow.createPending({
        attackerTokenUuid: actorToken?.document?.uuid ?? actorToken?.uuid,
        defenderTokenUuid: targetToken?.document?.uuid ?? targetToken?.uuid,
        attackerSkillUuid,
        attackerSkillLabel: `${def.name} (Special Action)`
      });

      const state = message?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state;
      if (state) {
        state.specialActionId = specialId;
        state.allowCombatStyle = true;

        await message.update({
          flags: {
            "uesrpg-3ev4": {
              skillOpposed: {
                version: state.version ?? 1,
                state
              }
            }
          }
        });
      }

      return;
    }

    case "attack": {
      if (actor?.effects?.some((e) => !e.disabled && e?.flags?.uesrpg?.key === "defensiveStance")) {
        ui.notifications?.warn?.("Defensive Stance is active: you cannot attack until your next Turn.");
        return;
      }

      const weaponId = btn?.dataset?.weaponId;
      if (!weaponId) {
        ui.notifications.warn("No weapon configured for this action.");
        return;
      }

      const weapon = actor.items.get(weaponId);
      if (!weapon) {
        ui.notifications.warn("Selected weapon could not be found on this actor.");
        return;
      }

      const attackerToken = resolveTokenForActor(actor);
      if (!attackerToken) {
        ui.notifications.warn("Please place and select a token for this actor.");
        return;
      }

      const defenderTokens = Array.from(game?.user?.targets ?? []);
      if (!defenderTokens.length) {
        ui.notifications.warn("Please target an enemy token.");
        return;
      }

      const styleCtx = resolveCombatStyleForAttack();
      if (!styleCtx) {
        ui.notifications.warn("No Combat Style found on this actor.");
        return;
      }

      const base = Number(styleCtx.base ?? 0) || 0;
      const fatiguePenalty = Number(actor.system?.fatigue?.penalty ?? 0) || 0;
      const carryPenalty = Number(actor.system?.carry_rating?.penalty ?? 0) || 0;
      const woundPenalty = Number(actor.system?.woundPenalty ?? 0) || 0;
      const tn = base + fatiguePenalty + carryPenalty + woundPenalty;

      const label = String(btn?.dataset?.label ?? "Attack");
      const weaponItem = actor?.items?.get?.(weaponId);
      const attackMode = String(weaponItem?.system?.attackMode ?? "melee").toLowerCase();

      if (attackMode === "melee") {
        try { void setLastMeleeWeaponForActor(actor.id, weaponId); } catch (_e) { /* no-op */ }
      }

      await OpposedWorkflow.createPending({
        attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
        defenderTokenUuids: defenderTokens.map(t => t?.document?.uuid ?? t?.uuid).filter(Boolean),
        attackerActorUuid: actor.uuid,
        attackerItemUuid: styleCtx.styleUuid,
        attackerLabel: `${label} - ${styleCtx.styleName}`,
        attackerTarget: tn,
        mode: "attack",
        attackMode,
        weaponUuid: weapon.uuid
      });
      return;
    }

    case "disengage": {
      const selfToken = resolveTokenForActor(actor);
      if (selfToken && hasOpponentWithTalentInMeleeRange(selfToken, "unrelenting")) {
        ui.notifications.warn("Disengage is prevented by Unrelenting (opponent in melee range).");
        return;
      }
      if (!(await requireAP("Disengage", 1))) return;
      await breakAimChainIfPresent();
      await postActionCard(
        "Disengage",
        "<p>The character can use this action to retreat from combat with an enemy. If they move out of an enemy's engagement range during this Turn then the attack of opportunity reaction or other delayed actions/reactions may not be taken against them.</p>"
      );
      return;
    }

    case "delay": {
      if (!(await requireAP("Delay Turn", 1))) return;
      await breakAimChainIfPresent();
      await postActionCard(
        "Delay Turn",
        "<p>The character declares a set of circumstances in which they will act. The character then skips their Turn and may insert their delayed Turn into the order as a reaction if the conditions are met.</p>"
      );
      return;
    }

    case "defensive-stance": {
      if (!(await requireAP("Defensive Stance", 1))) return;
      await breakAimChainIfPresent();
      await postActionCard(
        "Defensive Stance",
        "<p><strong>Effect:</strong> +10 on defensive tests until your next Turn. Your Attack limit is reduced to 0 until your next Turn.</p>"
      );

      const combat = game.combat ?? null;
      const combatant = combat?.combatants?.find?.((c) => c?.actor?.id === actor.id) ?? null;
      const expiresFlags = (() => {
        if (!(combat && combat.started && combatant)) return {};
        const combatId = String(combat.id ?? "");
        const combatantId = String(combatant.id ?? "");
        const turns = Array.isArray(combat.turns) ? combat.turns : [];
        const idx = turns.findIndex((t) => String(t?.id ?? "") === combatantId);
        const currentTurn = Number(combat.turn ?? 0);
        const currentRound = Number(combat.round ?? 0);

        const expiresTurn = idx >= 0 ? idx : currentTurn;
        const expiresRound =
          (idx >= 0 && Number.isFinite(currentTurn) && Number.isFinite(currentRound) && idx <= currentTurn)
            ? (currentRound + 1)
            : currentRound;

        return {
          expiresOnTurnStart: true,
          expiresCombatId: combatId,
          expiresRound,
          expiresTurn,
          expiresCombatantId: combatantId
        };
      })();
      const duration = {};
      await upsertSimpleEffect({
        key: "defensiveStance",
        name: "Defensive Stance",
        icon: "systems/uesrpg-3ev4/images/Icons/heroicDefense.webp",
        statusId: "uesrpg-action-defensive-stance",
        duration,
        changes: [
          { key: "system.modifiers.combat.defenseTN.total", mode: ADD, value: 10, priority: 20 },
        ],
        flags: {
          uesrpg: {
            source: "action",
            ...expiresFlags
          }
        }
      });
      return;
    }

    case "aim": {
      const candidates = [];
      try {
        const weapons = (actor.itemTypes?.weapon ?? []).filter((w) => Boolean(w?.system?.equipped));

        const isThrownWeapon = (w) => {
          try {
            const kind = String(w?.system?.rangeBandsDerivedEffective?.kind ?? w?.system?.rangeBandsDerived?.kind ?? "").toLowerCase();
            if (kind === "thrown") return true;

            const norm = (v) => String(v ?? "").toLowerCase().replace(/[\s_-]+/g, "");
            const target = "thrown";

            const structured = Array.isArray(w?.system?.qualitiesStructuredInjected)
              ? w.system.qualitiesStructuredInjected
              : Array.isArray(w?.system?.qualitiesStructured)
                ? w.system.qualitiesStructured
                : null;
            if (structured) {
              for (const q of structured) {
                const k = norm(q?.key ?? q);
                if (k && k == target) return true;
              }
            }

            const traits = Array.isArray(w?.system?.qualitiesTraitsInjected)
              ? w.system.qualitiesTraitsInjected
              : Array.isArray(w?.system?.qualitiesTraits)
                ? w.system.qualitiesTraits
                : null;
            if (traits) {
              for (const t of traits) {
                const k = norm(t);
                if (k && k == target) return true;
              }
            }

            const legacy = Array.isArray(w?.system?.qualities) ? w.system.qualities : null;
            if (legacy) {
              for (const q of legacy) {
                const k = norm(q?.key ?? q);
                if (k && k == target) return true;
              }
            }

            const legacyTraits = Array.isArray(w?.system?.qualitiesTraitsLegacy) ? w.system.qualitiesTraitsLegacy : null;
            if (legacyTraits) {
              for (const t of legacyTraits) {
                const k = norm(t);
                if (k && k == target) return true;
              }
            }
          } catch (_e) {
            // no-op
          }
          return false;
        };

        const rangedOrThrownWeapons = weapons.filter((w) => {
          const mode = String(w?.system?.attackMode ?? "").toLowerCase();
          if (mode === "ranged") return true;
          return isThrownWeapon(w);
        });

        for (const w of rangedOrThrownWeapons) {
          const labelPrefix = isThrownWeapon(w) && String(w?.system?.attackMode ?? "").toLowerCase() !== "ranged" ? "Weapon (Thrown)" : "Weapon";
          candidates.push({ uuid: w.uuid, label: `${labelPrefix}: ${w.name}`, kind: "weapon" });
        }
      } catch (_e) {
        // no-op
      }

      try {
        const spells = actor.itemTypes?.spell ?? [];
        const boltSpells = spells.filter((s) => String(s.system?.form ?? "").toLowerCase().includes("bolt"));
        for (const s of boltSpells) candidates.push({ uuid: s.uuid, label: `Bolt Spell: ${s.name}`, kind: "spell" });
      } catch (_e) {
        // no-op
      }

      if (!candidates.length) {
        ui.notifications?.warn?.("No ranged weapons or Bolt spells are available to Aim.");
        return;
      }

      const existing = getEnabledEffectByKey(actor, "aim");
      const prevState = getAimStateFromEffect(existing);
      const prevItemUuid = String(prevState.itemUuid ?? "");
      const prevStacks = Number(prevState.stacks ?? 0) || 0;

      const options = candidates.map((c) => {
        const selected = prevItemUuid && c.uuid === prevItemUuid ? " selected" : "";
        return `<option value="${c.uuid}"${selected}>${c.label}</option>`;
      }).join("");

      const content = `
        <form class="uesrpg-aim-form">
          <div class="form-group">
            <label>Aim At</label>
            <select name="aimItemUuid">${options}</select>
          </div>
        </form>
      `;

      const selectedUuid = await new Promise((resolve) => {
        new Dialog({
          title: "Aim",
          content,
          buttons: {
            ok: {
              label: "Aim",
              callback: (html) => {
                const uuid = html.find("select[name='aimItemUuid']").val();
                resolve(String(uuid ?? "").trim() || null);
              }
            },
            cancel: { label: "Cancel", callback: () => resolve(null) }
          },
          default: "ok",
          close: () => resolve(null)
        }).render(true);
      });

      if (!selectedUuid) return;

      if (!(await requireAP("Aim", 1))) return;

      const isContinuingSame = prevItemUuid && selectedUuid === prevItemUuid;
      const nextStacks = Math.min(3, (isContinuingSame ? prevStacks : 0) + 1);
      const nextBonus = nextStacks * 10;

      AimAudit.applyStack(actor, { stacks: nextStacks, itemUuid: selectedUuid });

      await postActionCard(
        "Aim",
        `<p><strong>Effect:</strong> +${nextBonus} to the next ranged attack with the aimed weapon/spell (stacks up to +30 if you continue aiming consecutively). If you take any other action or reaction (other than continuing to Aim or firing the aimed weapon/spell), the Aim chain is broken and the bonus is lost.</p>`
      );

      const duration = buildTemporaryDuration({ rounds: 9999, seconds: 604800 });
      await upsertSimpleEffect({
        key: "aim",
        name: "Aim",
        icon: "systems/uesrpg-3ev4/images/Icons/hardTarget.webp",
        statusId: "uesrpg-action-aim",
        duration,
        changes: [
          { key: "system.modifiers.combat.attackTN", mode: ADD, value: nextBonus, priority: 20 },
        ],
        flags: {
          uesrpg: {
            source: "action",
            aim: { stacks: nextStacks, itemUuid: selectedUuid },
            conditions: { attackMode: "ranged", itemUuid: selectedUuid }
          }
        }
      });
      return;
    }

    case "dash": {
      if (!(await requireAP("Dash", 1))) return;
      await breakAimChainIfPresent();
      
      const { applySprintBonus } = await import("../../../../core/stamina/stamina-integration-hooks.js");
      const sprintEffect = await applySprintBonus(actor);
      const speed = actor.system?.speed?.value ?? 0;
      const movement = sprintEffect ? speed * 2 : speed;
      
      const baseDescription = "The character can use this action in order to move up to their Speed";
      const sprintNote = sprintEffect ? " (2× Speed from Sprint effect)" : "";
      const turnDescription = "If this is done on their Turn, this movement is added to their base movement for that Turn. This action can be used to allow a character to move several times their Speed during a round.";
      const sprintDetails = sprintEffect ? `<p><b>Sprint Active:</b> Movement up to ${movement} meters</p>` : "";
      
      await postActionCard(
        "Dash",
        `<p>${baseDescription}${sprintNote}. ${turnDescription}</p>${sprintDetails}`
      );
      await recordDashStart(actor);
      return;
    }

    case "hide": {
      if (!(await requireAP("Hide", 1))) return;
      await breakAimChainIfPresent();
      await postActionCard(
        "Hide",
        "<p>The character can use this action to attempt to hide from foes. If anyone might detect them while they do this, they must make a Stealth skill test opposed by the Observe of anyone who might spot them. On success, they gain the Hidden condition.</p>"
      );
      return;
    }

    case "use-item": {
      const candidates = actor.items.filter(i => {
        const consumable = Boolean(i?.system?.consumable);
        const type = String(i?.type ?? "");
        const isPhysical = type === "item" || type === "container";
        return consumable && isPhysical;
      });

      if (!candidates.length) {
        await postActionCard(
          "Use Item",
          "<p>No consumable Items were found on this actor.</p>"
        );
        return;
      }

      const options = candidates.map(i => `<option value="${i.id}">${i.name}</option>`).join("");
      const content = `
        <form class="uesrpg-use-item-form">
          <div class="form-group">
            <label>Item</label>
            <select name="itemId">${options}</select>
          </div>
        </form>
      `;

      return new Dialog({
        title: "Use Item",
        content,
        buttons: {
          use: {
            label: "Use",
            callback: async (html) => {
              const itemId = html.find("select[name='itemId']").val();
              const item = actor.items.get(itemId);
              if (!item) {
                ui.notifications.warn("Selected item could not be found.");
                return;
              }
              if (!(await spendActionPoints(actor, 1, { reason: "Use Item" }))) return;
              await breakAimChainIfPresent();
              await postActionCard("Use Item", `<p>${item.name}</p>`);
            }
          },
          cancel: { label: "Cancel" }
        },
        default: "use"
      }).render(true);
    }

    case "reload-weapon": {
      event.preventDefault();
      
      const rangedWeapon = actor.items.find(i => 
        i.type === "weapon" && 
        i.system?.equipped === true && 
        String(i.system?.attackMode ?? "").toLowerCase() === "ranged"
      );
      
      if (!rangedWeapon) {
        ui.notifications.warn("No equipped ranged weapon to reload.");
        return;
      }
      
      const reloadState = rangedWeapon.system?.reloadState ?? {};
      const reloadCost = Number(reloadState.reloadAPCost ?? 0);
      
      if (!reloadState.requiresReload || reloadCost === 0) {
        ui.notifications.info(`${rangedWeapon.name} does not require reloading.`);
        return;
      }
      
      if (reloadState.isLoaded) {
        ui.notifications.info(`${rangedWeapon.name} is already loaded.`);
        return;
      }
      
      const { applyPowerDrawBonus } = await import("../../../../core/stamina/stamina-integration-hooks.js");
      const powerDrawReduction = await applyPowerDrawBonus(actor, rangedWeapon);
      const hasRapidReload = hasTalent(actor, "rapidreload") || hasTalent(actor, "dualrapidreloadfighter");
      const talentReloadReduction = hasRapidReload ? 1 : 0;
      let effectiveReloadCost = Math.max(0, reloadCost - powerDrawReduction - talentReloadReduction);
      
      const currentAP = Number(actor.system?.action_points?.value ?? 0);
      if (currentAP < effectiveReloadCost) {
        ui.notifications.warn(`Reload requires ${effectiveReloadCost} AP, but you only have ${currentAP} AP remaining.`);
        return;
      }
      
      const newAP = currentAP - effectiveReloadCost;
      await actor.update({
        "system.action_points.value": newAP
      });
      
      await rangedWeapon.update({
        "system.reloadState.isLoaded": true
      });
      
      const powerDrawNote = powerDrawReduction > 0 
        ? `<p><em>Power Draw bonus: -${powerDrawReduction} AP</em></p>` 
        : "";
      const talentNote = talentReloadReduction > 0
        ? `<p><em>Rapid Reload: -${talentReloadReduction} AP</em></p>`
        : "";

      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
          <div class="uesrpg-chat-card">
            <header class="card-header">
              <img src="${rangedWeapon.img}" width="36" height="36"/>
              <h3>Reload Weapon</h3>
            </header>
            <div class="card-content">
              <p><strong>${actor.name}</strong> reloads <strong>${rangedWeapon.name}</strong>.</p>
              <p><em>AP Cost: ${effectiveReloadCost}${(powerDrawReduction > 0 || talentReloadReduction > 0) ? ` (${reloadCost}${powerDrawReduction > 0 ? ` - ${powerDrawReduction}` : ""}${talentReloadReduction > 0 ? ` - ${talentReloadReduction}` : ""})` : ""}</em></p>
              ${powerDrawNote}
              ${talentNote}
              <p>Remaining AP: ${newAP}</p>
            </div>
          </div>
        `,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });
      
      ui.notifications.info(`${rangedWeapon.name} reloaded for ${effectiveReloadCost} AP.`);
      return;
    }

    case "attack-of-opportunity": {
      const weaponId = actor.sheetCombatQuick?.meleeWeaponId ?? null;
      if (!weaponId) {
        ui.notifications.warn("No melee weapon equipped for Attack of Opportunity.");
        return;
      }

      const weapon = actor.items.get(weaponId);
      if (!weapon) {
        ui.notifications.warn("Equipped weapon could not be found.");
        return;
      }

      const attackerToken = resolveTokenForActor(actor);
      if (!attackerToken) {
        ui.notifications.warn("Please place and select a token for this actor.");
        return;
      }

	      const defenderTokens = Array.from(game?.user?.targets ?? []);
	      if (!defenderTokens.length) {
	        ui.notifications.warn("Please target an enemy token for Attack of Opportunity.");
	        return;
	      }

	      const allowedTargets = defenderTokens.filter((t) => {
	        const targetActor = t?.actor ?? null;
	        if (!targetActor) return false;
	        if (isActorBlockedFromAoOAgainstTarget(actor, targetActor)) {
	          ui.notifications?.warn?.(`${actor.name} cannot make an Attack of Opportunity against ${targetActor.name} right now.`);
	          return false;
	        }
	        return true;
	      });

	      if (!allowedTargets.length) return;

      const currentAP = Number(actor?.system?.action_points?.value ?? 0);
      if (currentAP < 1) {
        ui.notifications.warn(`${actor.name} does not have enough Action Points (${currentAP}/1).`);
        return;
      }

      const attackMode = "melee";
      
      const styleCtx = resolveCombatStyleForAttack();
      if (!styleCtx) {
        ui.notifications.warn("No Combat Style found on this actor.");
        return;
      }

      const base = Number(styleCtx.base ?? 0) || 0;
      const fatiguePenalty = Number(actor.system?.fatigue?.penalty ?? 0) || 0;
      const carryPenalty = Number(actor.system?.carry_rating?.penalty ?? 0) || 0;
      const woundPenalty = Number(actor.system?.woundPenalty ?? 0) || 0;
      const tn = base + fatiguePenalty + carryPenalty + woundPenalty;

	      await OpposedWorkflow.createPending({
	        attackerTokenUuid: attackerToken.document?.uuid ?? attackerToken.uuid,
	        defenderTokenUuids: allowedTargets.map(t => t?.document?.uuid ?? t?.uuid).filter(Boolean),
	        attackerActorUuid: actor.uuid,
	        attackerItemUuid: styleCtx.styleUuid,
	        attackerLabel: `Attack of Opportunity - ${styleCtx.styleName}`,
	        attackerTarget: tn,
        mode: "attack",
        attackMode,
        weaponUuid: weapon.uuid,
        skipAttackerAPDeduction: false
      });
      return;
    }

    default:
      return;
  }
}
