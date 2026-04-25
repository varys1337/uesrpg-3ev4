/**
 * src/core/skills/opposed-workflow/actions/defender.js
 *
 * Defender commit and roll handler for skill opposed tests.
 *
 * Handles both:
 *  - "defender-roll"           -> dialog -> bank declaration, return early
 *  - "defender-roll-committed" -> use banked declaration, compute TN, roll, persist
 */

import { doTestRoll } from "../../../../utils/degree-roll-helper.js";
import { requireUserCanRollActor } from "../../../../utils/permissions.js";
import { buildSkillRollRequest, normalizeSkillRollOptions, skillRollDebug, validateSkillRollRequest } from "../../roll-request.js";
import { buildResistanceBonusMods } from "../../../traits/trait-resistance-ui.js";
import { consumePhysicalExertionForSkill } from "../../../stamina/stamina-integration-hooks.js";
import { applyKeenIntuitionToResult, applyHyperAwarenessToResult } from "../../../traits/awareness-talents.js";
import { applyIntellectualTalentDoSOverrides } from "../../../traits/intellectual-talents.js";
import { _getMessageState } from "../core/schema.js";
import { _getLastSkillRollOptions, _setLastSkillRollOptions, _mergeLastSkillRollOptions } from "../core/settings.js";
import { _emitSuppressedSubRollDice, _getCoreRollMode, _isQuickShiftRequested } from "../core/util.js";
import { _updateCard } from "../core/card-updater.js";
import { _listSkills } from "../core/skills.js";
import { _skillRollDialog } from "../core/dialogs.js";
import {
  _defaultSelectedCharacteristicForSkill,
  _filterSkillsForSpecialAction,
  _getSpecialActionLegalityForSide,
  _isSpecialActionSelectionLegal
} from "../context.js";
import { resolveSelectionAndComputeTN } from "../helpers/selection-and-tn.js";
import { buildQuickDeclaration, commitDeclarationToCardState, readCommittedDeclaration } from "../helpers/declaration-state.js";
import { commitLaneResult } from "../helpers/result-commit.js";

/**
 * Handle the defender roll action (commit or committed roll).
 *
 * @param {object} ctx   { message, data, attacker, defender, aToken, dToken, event, batchedUpdate }
 * @param {string} action
 * @returns {Promise<object|undefined>}  Updated data when batchedUpdate, else undefined
 */
export async function handleDefenderRoll(ctx, action) {
  const { message, data, attacker, defender, aToken, dToken, event, batchedUpdate } = ctx;

  if (data.defender.result) return;

  const isCommittedRoll = (action === "defender-roll-committed");

  // Committing choices requires roll permission for this actor.
  if (!requireUserCanRollActor(game.user, defender, { message: "You do not have permission to roll for the target actor." })) return;

  // Always respect allowCombatStyle from state (default to true for universal access)
  const allowCombatStyle = Boolean(data?.allowCombatStyle ?? true);

  const baseSkills = _listSkills(defender, { allowCombatStyle });
  const specialLegality = _getSpecialActionLegalityForSide(data, defender, "defender");
  const skills = _filterSkillsForSpecialAction(baseSkills, specialLegality);
  if (!skills.length) {
    if (specialLegality) {
      ui.notifications.warn("No legal test options are available for this Special Action.");
      return;
    }
    ui.notifications.warn("Target actor has no skills to roll.");
    return;
  }

  const last = _getLastSkillRollOptions();
  const perActorLastSkill = last?.lastSkillUuidByActor?.[defender.uuid] ?? null;

  // Default selection: use locked-in skill if available, else same-named skill if present, else last-used on this actor, else first.
  const lockedSkillUuid = data.defender.skillUuid;
  const wantedName = String(data.attacker.skillLabel ?? "").trim().toLowerCase();
  const sameName = skills.find(s => String(s.name).trim().toLowerCase() === wantedName) ?? null;
  const preferredLockedSkill = String(lockedSkillUuid ?? "").trim();
  const preferredLastSkill = String(perActorLastSkill ?? "").trim();
  const selectedSkillUuid = (
    skills.find(s => String(s?.uuid ?? "") === preferredLockedSkill)?.uuid
    ?? sameName?.uuid
    ?? skills.find(s => String(s?.uuid ?? "") === preferredLastSkill)?.uuid
    ?? skills[0].uuid
  );

  const defaultCharacteristic = _defaultSelectedCharacteristicForSkill(skills, selectedSkillUuid);
  const defaults = normalizeSkillRollOptions(last, {
    difficultyKey: "average",
    circumstanceMod: 0,
    manualMod: 0,
    useSpec: false,
    selectedCharacteristicKey: defaultCharacteristic
  });

  let decl = null;
  const quick = _isQuickShiftRequested(event);

  if (isCommittedRoll) {
    decl = readCommittedDeclaration(data.defender, "Defender");
    if (!decl) return;
  } else {
    if (quick) {
      decl = buildQuickDeclaration({ selectedSkillUuid, defaults, defaultCharacteristic });
    } else {
      // Always show skill selection dropdown (removed pre-choice dialog dependency)
      decl = await _skillRollDialog({
        title: "Oppose - Choose Skill",
        actor: defender,
        showSkillSelect: true,
        skills,
        selectedSkillUuid,
        allowSpecialization: true,
        defaultUseSpec: defaults.useSpec,
        defaultDifficultyKey: defaults.difficultyKey,
        defaultCircumstanceMod: defaults.circumstanceMod,
        defaultManualMod: defaults.manualMod,
        defaultApplyBlinded: (defaults.applyBlinded ?? true),
        defaultApplyDeafened: (defaults.applyDeafened ?? true),
        defaultSelectedCharacteristicKey: defaults.selectedCharacteristicKey
      });
    }
    if (!decl) return;

    // Normalize + clamp UI inputs.
    decl = { ...decl, ...normalizeSkillRollOptions(decl, defaults) };
    if (!_isSpecialActionSelectionLegal(decl, specialLegality)) {
      ui.notifications.warn("Selected test is not legal for this Special Action.");
      return;
    }

    // Bank choices into the parent card; do not roll until both sides have committed.
    // Re-read fresh state to prevent stale-snapshot overwrites when both sides commit
    // near-simultaneously from different clients.
    const freshMsgD = game.messages.get(message.id) ?? message;
    const freshDataD = _getMessageState(freshMsgD) ?? data;
    commitDeclarationToCardState({ data: freshDataD, side: "defender", declaration: decl });
    await _updateCard(freshMsgD, freshDataD);
    return;
  }

  // Normalize + clamp UI inputs.
  decl = { ...decl, ...normalizeSkillRollOptions(decl, defaults) };
  if (!_isSpecialActionSelectionLegal(decl, specialLegality)) {
    ui.notifications.warn("Selected test is not legal for this Special Action.");
    return;
  }

  const resMods = buildResistanceBonusMods(decl?.resistanceSelected ?? []);
  const computed = resolveSelectionAndComputeTN({
    side: "defender",
    actor: defender,
    opponentActor: attacker,
    decl,
    defaultCharacteristic,
    data,
    resMods,
    includeInvisibleTrackingPenalty: false,
    includeHistskin: true,
    includeResModsForCombatStyle: false
  });
  if (computed.error) {
    ui.notifications.warn("Selected defender skill or combat style could not be found.");
    return;
  }

  const { tn, skillLabel, skillItem: defSkill } = computed;

  const request = defSkill ? buildSkillRollRequest({
    actor: defender,
    skillItem: defSkill,
    targetToken: aToken,
    options: {
      difficultyKey: decl.difficultyKey,
      circumstanceMod: decl.circumstanceMod,
      manualMod: decl.manualMod,
      useSpec: Boolean(decl.useSpec),
      selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
      applyBlinded: Boolean(decl.applyBlinded),
      applyDeafened: Boolean(decl.applyDeafened)
    },
    context: { source: "chat", quick, messageId: message.id, groupId: data.context?.groupId ?? null }
  }) : null;

  if (request) {
    const v = validateSkillRollRequest(request);
    if (!v.ok) {
      ui.notifications.warn(v.error || "Invalid skill roll request.");
      return;
    }
    skillRollDebug("opposed defender request", request);
    data.defender.request = request;
  }

  data.defender.skillUuid = decl.skillUuid;
  data.defender.skillLabel = skillLabel;
  data.defender.declared = {
    difficultyKey: decl.difficultyKey,
    circumstanceMod: decl.circumstanceMod,
    manualMod: decl.manualMod,
    useSpec: Boolean(decl.useSpec),
    selectedCharacteristicKey: String(decl.selectedCharacteristicKey ?? defaultCharacteristic),
    isInterrogationTest: Boolean(decl?.isInterrogationTest),
    histskinUnderwater: Boolean(decl?.histskinUnderwater)
  };

  await _setLastSkillRollOptions(_mergeLastSkillRollOptions({
    difficultyKey: decl.difficultyKey,
    circumstanceMod: decl.circumstanceMod,
    manualMod: decl.manualMod,
    useSpec: Boolean(decl.useSpec),
    lastSkillUuidByActor: { [defender.uuid]: decl.skillUuid }
  }));

  data.defender.tn = tn;
  skillRollDebug("opposed defender TN", { finalTN: tn.finalTN, breakdown: tn.breakdown });

  const rollMode = _getCoreRollMode();
  const res = await doTestRoll(defender, { rollFormula: "1d100", target: tn.finalTN, allowLucky: true, allowUnlucky: true });

  // Awareness talent automation: Keen Intuition (Observe) / Hyper Awareness (Evade).
  await applyKeenIntuitionToResult(defender, skillLabel, res, { allowPrompt: true });
  await applyHyperAwarenessToResult(defender, skillLabel, res, { allowPrompt: true });

  // Intellectual talent automation: Businessman / Interrogator DoS substitutions (Commerce / Persuade).
  await applyIntellectualTalentDoSOverrides({
    actor: defender,
    skillName: skillLabel,
    result: res,
    isInterrogationTest: Boolean(decl?.isInterrogationTest),
    allowPrompt: true
  });

  skillRollDebug("opposed defender result", { rollTotal: res.rollTotal, target: res.target, isSuccess: res.isSuccess, degree: res.degree, critS: res.isCriticalSuccess, critF: res.isCriticalFailure });

  _emitSuppressedSubRollDice(res.roll, { rollMode });

  if (defSkill) {
    await consumePhysicalExertionForSkill(defender, defSkill, {
      selectedCharacteristicKey: decl.selectedCharacteristicKey ?? defaultCharacteristic
    });
  }

  const { freshMessage: freshMsgDR, freshData: freshDataDR } = await commitLaneResult({
    message,
    data,
    side: "defender",
    res,
    lanePatch: {
      skillUuid: data.defender.skillUuid,
      skillLabel: data.defender.skillLabel,
      declared: data.defender.declared,
      tn: data.defender.tn,
      request: data.defender.request
    },
    attacker,
    defender,
    batchedUpdate,
    isCommittedRoll
  });

  if (batchedUpdate && isCommittedRoll) return freshDataDR;
  await _updateCard(freshMsgDR, freshDataDR);
  return freshDataDR;
}
