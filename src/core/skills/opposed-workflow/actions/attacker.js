/**
 * src/core/skills/opposed-workflow/actions/attacker.js
 *
 * Attacker commit and roll handler for skill opposed tests.
 *
 * Handles both:
 *  - "attacker-roll"           → dialog → bank declaration, return early
 *  - "attacker-roll-committed" → use banked declaration, compute TN, roll, persist
 */

import { doTestRoll } from "../../../../utils/degree-roll-helper.js";
import { requireUserCanRollActor } from "../../../../utils/permissions.js";
import { buildSkillRollRequest, normalizeSkillRollOptions, skillRollDebug, validateSkillRollRequest } from "../../roll-request.js";
import { buildResistanceBonusMods } from "../../../traits/trait-resistance-ui.js";
import { consumePhysicalExertionForSkill } from "../../../stamina/stamina-integration-hooks.js";
import { applyKeenIntuitionToResult, applyHyperAwarenessToResult } from "../../../traits/awareness-talents.js";
import { applyIntellectualTalentDoSOverrides } from "../../../traits/intellectual-talents.js";
import { applyRuntimePreRollToTN, applyRuntimePostRollToResult } from "../../../traits/features/rule-element-runtime.js";
import { _getMessageState } from "../core/schema.js";
import { _emitSuppressedSubRollDice, _esc, _safeGetSetting, _getCoreRollMode, _isQuickShiftRequested } from "../core/util.js";
import { _updateCard } from "../core/card-updater.js";
import { _listSkills } from "../core/skills.js";
import { _skillRollDialog } from "../core/dialogs.js";
import { _getLastSkillRollOptions, _setLastSkillRollOptions, _mergeLastSkillRollOptions } from "../core/settings.js";
import {
  _defaultSelectedCharacteristicForSkill,
  _filterSkillsForSpecialAction,
  _getSpecialActionLegalityForSide,
  _isSpecialActionSelectionLegal
} from "../context.js";
import { consumeConcussiveNextBash } from "../helpers.js";
import { resolveSelectionAndComputeTN } from "../helpers/selection-and-tn.js";
import { buildQuickDeclaration, commitDeclarationToCardState, readCommittedDeclaration } from "../helpers/declaration-state.js";
import { buildSkillOpposedRollFlags } from "../helpers/roll-flags.js";
import { commitLaneResult } from "../helpers/result-commit.js";

/**
 * Handle the attacker roll action (commit or committed roll).
 *
 * @param {object} ctx   { message, data, attacker, defender, aToken, dToken, event, batchedUpdate }
 * @param {string} action
 * @returns {Promise<object|undefined>}  Updated data when batchedUpdate, else undefined
 */
export async function handleAttackerRoll(ctx, action) {
  const { message, data, attacker, defender, aToken, dToken, event, batchedUpdate } = ctx;

  if (data.attacker.result) return;

  const isCommittedRoll = (action === "attacker-roll-committed");

  if (!requireUserCanRollActor(game.user, attacker)) return;

  const allowCombatStyle = Boolean(data?.allowCombatStyle ?? true);
  const baseSkills = _listSkills(attacker, { allowCombatStyle });
  const specialLegality = _getSpecialActionLegalityForSide(data, attacker, "attacker");
  const skills = _filterSkillsForSpecialAction(baseSkills, specialLegality);
  if (!skills.length) {
    ui.notifications.warn(specialLegality
      ? "No legal test options are available for this Special Action."
      : "Actor has no skills to roll.");
    return;
  }

  const last = _getLastSkillRollOptions();
  const perActorLastSkill = last?.lastSkillUuidByActor?.[attacker.uuid] ?? null;
  const preferredAttackerSkill = String(data.attacker.skillUuid ?? "").trim();
  const preferredLastSkill = String(perActorLastSkill ?? "").trim();
  const selectedSkillUuid = (
    skills.find(s => String(s?.uuid ?? "") === preferredAttackerSkill)?.uuid
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
    decl = readCommittedDeclaration(data.attacker, "Attacker");
    if (!decl) return;
  } else {
    if (quick) {
      decl = buildQuickDeclaration({ selectedSkillUuid, defaults, defaultCharacteristic });
    } else {
      decl = await _skillRollDialog({
        title: "Opposed Skill Test — Attacker",
        actor: attacker,
        showSkillSelect: (!data.attacker.skillUuid || Boolean(specialLegality)),
        skills,
        selectedSkillUuid,
        allowSpecialization: Boolean(skills.find(s => String(s?.uuid ?? "") === String(selectedSkillUuid ?? ""))?.hasSpec),
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

    decl = { ...decl, ...normalizeSkillRollOptions(decl, defaults) };
    if (!_isSpecialActionSelectionLegal(decl, specialLegality)) {
      ui.notifications.warn("Selected test is not legal for this Special Action.");
      return;
    }

    // Bank choices into the parent card; do not roll until both sides have committed.
    const freshMsgA = game.messages.get(message.id) ?? message;
    const freshDataA = _getMessageState(freshMsgA) ?? data;
    commitDeclarationToCardState({ data: freshDataA, side: "attacker", declaration: decl });
    await _updateCard(freshMsgA, freshDataA);
    return;
  }

  // Normalize declaration for committed roll path.
  decl = { ...decl, ...normalizeSkillRollOptions(decl, defaults) };
  if (!_isSpecialActionSelectionLegal(decl, specialLegality)) {
    ui.notifications.warn("Selected test is not legal for this Special Action.");
    return;
  }

  const resMods = buildResistanceBonusMods(decl?.resistanceSelected ?? []);
  const computed = resolveSelectionAndComputeTN({
    side: "attacker",
    actor: attacker,
    opponentActor: defender,
    decl,
    defaultCharacteristic,
    data,
    resMods,
    includeInvisibleTrackingPenalty: true,
    includeHistskin: true,
    includeResModsForCombatStyle: true
  });
  if (computed.error) {
    ui.notifications.warn("Selected actor skill or combat style could not be found.");
    return;
  }
  const {
    tn,
    skillLabel,
    skillItem,
    concussiveApplied
  } = computed;

  const request = skillItem ? buildSkillRollRequest({
    actor: attacker,
    skillItem,
    targetToken: dToken,
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
    skillRollDebug("opposed attacker request", request);
    data.attacker.request = request;
  }

  data.attacker.skillUuid = decl.skillUuid;
  data.attacker.skillLabel = skillLabel;
  data.attacker.declared = {
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
    lastSkillUuidByActor: { [attacker.uuid]: decl.skillUuid }
  }));

  data.attacker.tn = tn;
  applyRuntimePreRollToTN({
    actor: attacker,
    targetActor: defender,
    targetToken: dToken ?? null,
    item: skillItem ?? null,
    rollContext: data?.context?.rollContext,
    workflow: "skill",
    side: "attacker",
    skillName: skillLabel,
    tn
  });
  skillRollDebug("opposed attacker TN", { finalTN: tn.finalTN, breakdown: tn.breakdown });

  const rollFormula = "1d100";
  const rollMode = _getCoreRollMode();
  const res = await doTestRoll(attacker, { rollFormula, target: tn.finalTN, allowLucky: true, allowUnlucky: true });

  await applyKeenIntuitionToResult(attacker, skillLabel, res, { allowPrompt: true });
  await applyHyperAwarenessToResult(attacker, skillLabel, res, { allowPrompt: true });
  await applyIntellectualTalentDoSOverrides({ actor: attacker, skillName: skillLabel, result: res, isInterrogationTest: Boolean(decl?.isInterrogationTest), allowPrompt: true });
  await applyRuntimePostRollToResult({
    actor: attacker,
    targetActor: defender,
    targetToken: dToken ?? null,
    item: skillItem ?? null,
    rollContext: data?.context?.rollContext,
    workflow: "skill",
    side: "attacker",
    skillName: skillLabel,
    result: res,
    allowPrompt: true
  });

  if (concussiveApplied > 0) {
    await consumeConcussiveNextBash(attacker);
  }

  skillRollDebug("opposed attacker result", { rollTotal: res.rollTotal, target: res.target, isSuccess: res.isSuccess, degree: res.degree, critS: res.isCriticalSuccess, critF: res.isCriticalFailure });
  const rollFlags = buildSkillOpposedRollFlags({
    side: "attacker",
    messageId: message.id,
    request,
    laneData: data.attacker,
    decl,
    tn,
    res,
    actorUuid: attacker.uuid,
    skillLabel
  });

  const postSubRolls = _safeGetSetting("opposedPostSubRollMessages", true);
  if (postSubRolls) {
    await res.roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: attacker, token: aToken?.document ?? null }),
    flavor: `${_esc(data.attacker.skillLabel)} — Opposed Skill (Actor)`,
    flags: rollFlags,
    rollMode
    });
  } else {
    _emitSuppressedSubRollDice(res.roll, { rollMode });
  }

  if (skillItem) {
    await consumePhysicalExertionForSkill(attacker, skillItem, {
      selectedCharacteristicKey: decl.selectedCharacteristicKey ?? defaultCharacteristic
    });
  }

  const { freshMessage: freshMsgAR, freshData: freshDataAR } = await commitLaneResult({
    message,
    data,
    side: "attacker",
    res,
    lanePatch: {
      skillUuid: data.attacker.skillUuid,
      skillLabel: data.attacker.skillLabel,
      declared: data.attacker.declared,
      tn: data.attacker.tn,
      request: data.attacker.request
    },
    attacker,
    defender,
    batchedUpdate,
    isCommittedRoll
  });

  if (batchedUpdate && isCommittedRoll) return freshDataAR;
  await _updateCard(freshMsgAR, freshDataAR);
  return freshDataAR;
}

