import { escapeHtml as _escapeHtml } from '../../../../utils/html.js';
import { promptSelectToken, promptYesNo } from "../helpers/workflow.js";
export { promptSelectToken };

export { promptYesNo };
/**
 * src/core/combat/opposed/dialogs/common.js
 * Dialog prompt functions for opposed workflow
 * Extracted from opposed-workflow.js monolith (Phase 4)
 */


import { confirmDialog } from "../../../../utils/dialog-v2-helper.js";
import { t, tf } from "../../../../utils/i18n.js";


import { promptWeaponAndAdvantages as _promptWeaponAndAdvantagesImpl } from "./attacker.js";


// ====== HELPER: EXPLOIT ADVANTAGE CHECK ======


// ====== BASIC PROMPTS ======

/**
 * Generic Yes/No confirmation dialog
 */


/**
 * Token selection dialog from a list
 */


// ====== COMBAT-SPECIFIC PROMPTS ======

/**
 * Prompt for Unstoppable Might talent usage (special wield mode)
 */
export async function promptUnstoppableMightUsage({ actorName = "Actor", purpose = "attack" } = {}) {
  const details = purpose === "defense"
    ? `<p>${t("UESRPG.Dialogs.Opposed.UnstoppableDefenseDetail", "If yes, Parry and Counter-Attack are unavailable while wielding this way.")}</p>`
    : `<p>${t("UESRPG.Dialogs.Opposed.UnstoppableAttackDetail", "If yes, two-handed damage will be used for this attack.")}</p>`;
  return await promptYesNo({
    title: t("UESRPG.Dialogs.Opposed.UnstoppableMight", "Unstoppable Might"),
    content: `
      <div class="uesrpg">
        <p>${tf("UESRPG.Dialogs.Opposed.UnstoppableBody", { actor: _escapeHtml(actorName) }, `<b>${_escapeHtml(actorName)}</b> is using a special wield mode?`)}</p>
        <ul>
          <li>${t("UESRPG.Dialogs.Opposed.UnstoppableDualWield", "Dual wielding hand-and-a-half weapons (use two-handed damage)")}</li>
          <li>${t("UESRPG.Dialogs.Opposed.UnstoppableOneHandTwoHanded", "Wielding a two-handed weapon in one hand")}</li>
        </ul>
        ${details}
      </div>
    `,
    yesLabel: t("UESRPG.Dialogs.Opposed.UsingSpecialWield", "Using Special Wield"),
    noLabel: t("UESRPG.Dialogs.Opposed.NormalWield", "Normal Wield")
  });
}

/**
 * Prompt for AoE Evade escape (can defender move 1m to exit template?)
 */
export async function promptAoEEvadeEscape({ defenderName = "Defender", attackLabel = "the attack" } = {}) {
  try {
    return await confirmDialog({
      title: t("UESRPG.Dialogs.Opposed.AoeEvade", "AoE Evade"),
      content: `<p>${tf("UESRPG.Dialogs.Opposed.AoeEvadeBody", { defender: _escapeHtml(defenderName), attack: _escapeHtml(attackLabel) }, `${_escapeHtml(defenderName)} successfully evaded ${_escapeHtml(attackLabel)}. Can they move 1m to exit the area?`)}</p>`,
      yesLabel: t("UESRPG.Dialogs.Opposed.EscapesAoe", "Escapes AoE"),
      noLabel: t("UESRPG.Dialogs.Opposed.StillInAoe", "Still in AoE"),
    });
  } catch (_e) {
    return null;
  }
}

// ====== ADVANTAGE SPENDING DIALOGS ======

/**
 * Attacker Advantage spending dialog (Weapon selection + Precision Strike, Penetrate Armor, Forceful Impact, Press Advantage, Special Actions)
 */
export async function promptWeaponAndAdvantages({
  attackerActor,
  advantageCount = 0,
  attackMode = "melee",
  defaultWeaponUuid = null,
  defaultHitLocation = "Body",
  allowNoWeapon = false,
  attackerTokenUuid = null,
  opponentTokenUuid = null,
  styleUuidForKnown = null
}) {
  return _promptWeaponAndAdvantagesImpl({
    attackerActor,
    advantageCount,
    attackMode,
    defaultWeaponUuid,
    defaultHitLocation,
    allowNoWeapon,
    attackerTokenUuid,
    opponentTokenUuid,
    styleUuidForKnown
  });
}
