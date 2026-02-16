/**
 * src/core/combat/opposed/banking/external-roll.js
 *
 * GM-side banking of externally-created roll messages into opposed chat cards.
 * Phase 18.3 extraction - massive applyExternalRollMessage function.
 *
 * Rationale: players can always create their own roll messages, but Foundry's ChatMessage
 * update permissions can prevent that player from updating the *parent* opposed card (which
 * is authored by another user). When an active GM is present, this method is intended to be
 * executed on the active GM client from a createChatMessage hook.
 */

import { computeResultFromRollTotal } from "../../../../utils/degree-roll-helper.js";
import { applyRuntimePostRollToResult } from "../../../traits/features/rule-element-runtime.js";
import { _resolveItemViaActor } from "../helpers/docs.js";

/**
 * Bank an externally-created roll message (attacker-roll / defender-roll / defender-nodefense)
 * into the originating opposed chat card.
 *
 * @param {ChatMessage} rollMessage - The externally created roll message
 * @param {Object} deps - Dependency injection object with all required helpers
 */
export async function applyExternalRollMessage(rollMessage, deps) {
  const {
    resolveDefenderIndex,
    getDefenderEntries,
    resolveActor,
    userHasActorOwnership,
    selectDefenderEntry,
    getDefenderOutcome,
    setDefenderOutcome,
    setDefenderAdvantage,
    resolveOutcomeRAW,
    computeAdvantageRAW,
    applyAoEEvadeOutcome,
    isMultiDefender,
    cleanupAutoRollContext,
    applyDefenderCommitToData,
    applyAttackerCommitToData,
    updateCard,
    getPreferredWeaponUuid,
    weaponHasQuality,
    hasEquippedShieldType,
    applyCombatTalentDoSAdjustments,
    applyHyperAwarenessToResult,
    maybeSetAoEEvadeEscape,
    markPendingSneakAttack,
    resolveToken
  } = deps;

  const meta = rollMessage?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
  const parentId = meta?.parentMessageId ?? null;
  const stage = meta?.stage ?? null;

  const rollId = rollMessage?.id ?? rollMessage?._id ?? null;
  if (!parentId || !stage) return;

  const parent = game.messages.get(parentId) ?? null;
  if (!parent) return;

  const current = parent?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
  if (!current || typeof current !== "object") return;

  // When the banking orchestrator is running (autoRollStarted), the roll handlers
  // write results directly and the orchestrator resolves outcomes after all rolls
  // complete. Skip redundant external-roll banking to prevent race conditions
  // and duplicate card updates.
  if (current?.context?.autoRollStarted === true) return;

  // Anti-spoof + consistency checks: only bank roll messages that match the expected side.
  // This prevents other users from posting a roll message that is incorrectly attributed.
  const defenderIndex = resolveDefenderIndex(current, meta ?? {});
  const defenderEntry = (defenderIndex != null) ? getDefenderEntries(current)[defenderIndex] : current.defender;
  const expectedSide = (stage === "attacker-roll")
    ? current.attacker
    : ((stage === "defender-roll" || stage === "defender-nodefense") ? defenderEntry : null);

  if (!expectedSide?.actorUuid) return;

  const expectedActor = resolveActor(expectedSide.actorUuid);
  if (!expectedActor) return;

  const speakerActorId = rollMessage?.speaker?.actor ?? null;
  if (speakerActorId && speakerActorId !== expectedActor.id) return;

  const authorId =
    rollMessage?.author?.id ??
    rollMessage?._source?.author ??
    rollMessage?._source?.user ??
    rollMessage?.data?.author ??
    rollMessage?.data?.user ??
    null;
  const authorUser = authorId ? (game.users.get(String(authorId)) ?? null) : null;
  if (!authorUser) return;

  if (!authorUser.isGM && !userHasActorOwnership(authorUser, expectedActor)) return;

  // Clone so we never mutate message.flags directly.
  const data = foundry.utils.deepClone(current);
  selectDefenderEntry(data, { defenderIndex, defenderTokenUuid: meta?.defenderTokenUuid, defenderActorUuid: meta?.defenderActorUuid });

  let dirty = false;

  const applyResult = async (side) => {
    if (!side?.actorUuid) return null;
    let actor = null;
    try {
      const doc = fromUuidSync(side.actorUuid);
      actor = (doc?.documentName === "Actor") ? doc : (doc?.actor ?? null);
    } catch (_e) {
      actor = null;
    }
    if (!actor) return null;

    const roll = rollMessage?.rolls?.[0] ?? null;
    const rollTotal = Number(roll?.total ?? NaN);
    if (!Number.isFinite(rollTotal)) return null;

    const res = computeResultFromRollTotal(actor, {
      rollTotal,
      target: Number(side.target ?? side?.tn?.finalTN ?? 0),
      allowLucky: true,
      allowUnlucky: true
    });

    return {
      rollTotal: res.rollTotal,
      target: res.target,
      isSuccess: res.isSuccess,
      degree: res.degree,
      textual: res.textual,
      isCriticalSuccess: res.isCriticalSuccess,
      isCriticalFailure: res.isCriticalFailure
    };
  };

  // If the roll message includes a commit payload (computed TN, labels, etc.),
  // apply it to the parent card before computing success/DoS/DoF.
  // This is required when the roller lacks permission to update the parent chat card.
  if (stage === "defender-roll") {
    const c = meta?.commit?.defender ?? null;
    if (c && typeof c === "object") {
      applyDefenderCommitToData(data, c);
    }
  }

  if (stage === "attacker-roll") {
    const c = meta?.commit?.attacker ?? null;
    if (c && typeof c === "object") {
      applyAttackerCommitToData(data, c);
    }
  }

  if (stage === "attacker-roll") {
    if (data.attacker?.result) {
      if (!data.attacker.rollMessageId && rollId) {
        data.attacker.rollMessageId = rollId;
        data.attacker.rolledAt = Date.now();
        dirty = true;
      } else {
        return;
      }
    } else {
      const r = await applyResult(data.attacker);
      if (!r) return;
      data.attacker.result = r;
      if (rollId) {
        data.attacker.rollMessageId = rollId;
        data.attacker.rolledAt = Date.now();
      }
      dirty = true;
    }
  } else if (stage === "defender-roll") {
    if (data.defender?.noDefense) return;
    if (data.defender?.result) {
      if (!data.defender.rollMessageId && rollId) {
        data.defender.rollMessageId = rollId;
        data.defender.rolledAt = Date.now();
        dirty = true;
      } else {
        return;
      }
    } else {
      const r = await applyResult(data.defender);
      if (!r) return;
      data.defender.result = r;
      if (rollId) {
        data.defender.rollMessageId = rollId;
        data.defender.rolledAt = Date.now();
      }
      dirty = true;
    }
  } else if (stage === "defender-nodefense") {
    if (data.defender?.result || data.defender?.noDefense) return;
    if (rollId) {
      data.defender.noDefenseMessageId = rollId;
      data.defender.noDefenseAt = Date.now();
    }
    dirty = true;
    data.defender.noDefense = true;
    data.defender.defenseType = "none";
    data.defender.label = data.defender.label || "No Defense";
    data.defender.testLabel = "No Defense";
    data.defender.defenseLabel = "No Defense";
    data.defender.target = 0;
    data.defender.tn = data.defender.tn || { finalTN: 0, baseTN: 0, totalMod: 0, breakdown: [{ key: "base", label: "No Defense", value: 0, source: "base" }] };
    data.defender.result = { rollTotal: 100, target: 0, isSuccess: false, degree: 1, textual: "1 DoF", isCriticalSuccess: false, isCriticalFailure: false };
  } else {
    return;
  }

  // Post-roll adjustments (schema-safe).
  // Dueling Weapon: grants +1 Degree of Success on successful Parry or Counter-Attack.
  if (stage === "defender-roll" && data.defender?.result?.isSuccess && !Number(data.defender.result.duelingBonus)) {
    const dt = String(data.defender?.defenseType ?? "");
    if (dt === "parry" || dt === "counter") {
      try {
        const defWUuid = getPreferredWeaponUuid(expectedActor, { meleeOnly: true }) || "";
        if (defWUuid) {
          const defW = _resolveItemViaActor(defWUuid, expectedActor);
          if (defW?.type === "weapon" && weaponHasQuality(defW, "dueling")) {
            data.defender.result.degree = Math.max(1, (Number(data.defender.result.degree) || 1) + 1);
            data.defender.result.duelingBonus = 1;
            data.defender.result.textual = data.defender.result.isSuccess
              ? `${data.defender.result.degree} DoS`
              : `${data.defender.result.degree} DoF`;
            dirty = true;
          }
        }
      } catch (err) {
        console.warn("UESRPG | opposed-workflow | dueling weapon bonus lookup failed", err);
      }
    }
  }

  // Buckler: +1 DoS on successful Parry.
  if (stage === "defender-roll" && data.defender?.result?.isSuccess && !Number(data.defender.result.bucklerBonus)) {
    const dt = String(data.defender?.defenseType ?? "");
    if (dt === "parry") {
      try {
        if (hasEquippedShieldType(expectedActor, "buckler")) {
          data.defender.result.degree = Math.max(1, (Number(data.defender.result.degree) || 1) + 1);
          data.defender.result.bucklerBonus = 1;
          data.defender.result.textual = data.defender.result.isSuccess
            ? `${data.defender.result.degree} DoS`
            : `${data.defender.result.degree} DoF`;
          dirty = true;
        }
      } catch (err) {
        console.warn("UESRPG | opposed-workflow | buckler bonus lookup failed", err);
      }
    }
  }

  // Combat talents: post-roll DoS adjustments (bonus DoS / skill-rank replacement).
  // In banking/external roll commit, do NOT prompt; use stored choices if present.
  try {
    const aActor = resolveActor(data?.attacker?.actorUuid);
    const dActor = resolveActor(data?.defender?.actorUuid);
    const aTok = resolveToken(data?.attacker?.tokenUuid);
    const dTok = resolveToken(data?.defender?.tokenUuid);
    const runtimeWeapon = (() => {
      const weaponUuid = String(data?.context?.weaponUuid ?? "").trim();
      if (!weaponUuid) return null;
      try {
        const doc = _resolveItemViaActor(weaponUuid, aActor);
        return doc?.documentName === "Item" ? doc : null;
      } catch (_e) {
        return null;
      }
    })();

    if (stage === "attacker-roll" && data?.attacker?.result && aActor && dActor) {
      const storedChoice = meta?.commit?.attacker?.talentDoSChoice ?? null;
      const storedSource = meta?.commit?.attacker?.talentDoSChoiceSource ?? null;
      if (storedChoice) data.attacker.result.talentDoSChoice = storedChoice;
      if (storedSource) data.attacker.result.talentDoSChoiceSource = storedSource;

      const adj = await applyCombatTalentDoSAdjustments({
        attacker: aActor,
        defender: dActor,
        attackerToken: aTok,
        defenderToken: dTok,
        side: "attacker",
        result: data.attacker.result,
        defenseType: "",
        styleUuid: data.attacker.itemUuid ?? null,
        testLabel: data.attacker.label ?? data.attacker.testLabel ?? null,
        allowPrompt: false,
        weaponUuid: data?.context?.weaponUuid ?? null
      });
      if (adj?.changed) dirty = true;
      if (Array.isArray(adj?.notes) && adj.notes.length) data.attacker.result.talentNotes = adj.notes;

      const runtimeAdj = await applyRuntimePostRollToResult({
        actor: aActor,
        targetActor: dActor,
        targetToken: dTok,
        item: runtimeWeapon,
        rollContext: data?.context?.rollContext,
        workflow: "combat",
        side: "attacker",
        attackMode: String(data?.context?.attackMode ?? ""),
        attackVariant: String(data?.attacker?.variant ?? ""),
        testLabel: String(data?.attacker?.label ?? data?.attacker?.testLabel ?? ""),
        result: data.attacker.result,
        allowPrompt: false
      });
      if (runtimeAdj?.changed) dirty = true;
    }

    if (stage === "defender-roll" && data?.defender?.result && aActor && dActor) {
      const storedChoice = meta?.commit?.defender?.talentDoSChoice ?? null;
      const storedSource = meta?.commit?.defender?.talentDoSChoiceSource ?? null;
      if (storedChoice) data.defender.result.talentDoSChoice = storedChoice;
      if (storedSource) data.defender.result.talentDoSChoiceSource = storedSource;

      const adj = await applyCombatTalentDoSAdjustments({
        attacker: aActor,
        defender: dActor,
        attackerToken: aTok,
        defenderToken: dTok,
        side: "defender",
        result: data.defender.result,
        defenseType: data.defender.defenseType,
        styleUuid: data.defender?.styleUuid ?? null,
        testLabel: data.defender.testLabel ?? data.defender.label ?? null,
        allowPrompt: false,
        weaponUuid: data?.context?.weaponUuid ?? null
      });
      if (adj?.changed) dirty = true;
      if (Array.isArray(adj?.notes) && adj.notes.length) data.defender.result.talentNotes = adj.notes;

      // Hyper Awareness: apply stored choice for Evade results without prompting.
      if (String(data.defender.defenseType ?? "") === "evade") {
        if (meta?.commit?.defender?.hyperAwarenessChoice) {
          data.defender.result.hyperAwarenessChoice = meta.commit.defender.hyperAwarenessChoice;
        }
        await applyHyperAwarenessToResult(dActor, "Evade", data.defender.result, { allowPrompt: false });
      }

      const runtimeAdj = await applyRuntimePostRollToResult({
        actor: dActor,
        targetActor: aActor,
        targetToken: aTok,
        item: runtimeWeapon,
        rollContext: data?.context?.rollContext,
        workflow: "combat",
        side: "defender",
        attackMode: String(data?.context?.attackMode ?? ""),
        defenseType: String(data?.defender?.defenseType ?? ""),
        testLabel: String(data?.defender?.testLabel ?? data?.defender?.label ?? ""),
        result: data.defender.result,
        allowPrompt: false
      });
      if (runtimeAdj?.changed) dirty = true;
    }
  } catch (err) {
    console.warn("UESRPG | combat talent DoS adjustment (external roll commit) failed", err);
  }

  if (stage === "defender-roll") {
    await maybeSetAoEEvadeEscape(data, data.defender, expectedActor);
    dirty = true;
  }

  // Phase tracking (non-breaking; used for diagnostics).
  data.context = data.context ?? {};
  if (stage === "attacker-roll") {
    data.context.phase = "waitingDefender";
    if (!data.context.waitingSince) data.context.waitingSince = Date.now();
  }
  if (stage === "defender-roll" || stage === "defender-nodefense") {
    if (!data.context.phase || data.context.phase === "pending") data.context.phase = "resolving";
  }

  // Resolve if ready.
  const currentOutcome = getDefenderOutcome(data, data.defender);
  if (data.attacker?.result && (data.defender?.result || data.defender?.noDefense) && !currentOutcome) {
    const baseOutcome = resolveOutcomeRAW(data, data.defender) ?? { winner: "tie", text: "" };
    const outcome = applyAoEEvadeOutcome(data, baseOutcome);
    setDefenderOutcome(data, data.defender, outcome);
    setDefenderAdvantage(data, data.defender, computeAdvantageRAW(data, outcome, data.defender));

    if (data.context?.attackFromHidden === true && outcome?.winner === "attacker") {
      await markPendingSneakAttack(expectedActor, {
        weaponUuid: data.context?.weaponUuid ?? null,
        attackMode: data.context?.attackMode ?? null
      });
    }

    const allResolved = getDefenderEntries(data).every(def => Boolean(getDefenderOutcome(data, def)));
    if (allResolved) {
      data.status = "resolved";
      data.context = data.context ?? {};
      data.context.phase = "resolved";
      if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
      cleanupAutoRollContext(data.context);
    }
    dirty = true;
  }

  // Multi-defender: when the attacker roll arrives, resolve every committed defender lane.
  if (stage === "attacker-roll" && isMultiDefender(data) && data.attacker?.result) {
    const originalDefender = data.defender;
    const defenders = getDefenderEntries(data);
    let resolvedAny = false;

    for (const def of defenders) {
      if (!def) continue;
      if (!(def.result || def.noDefense)) continue;
      if (getDefenderOutcome(data, def)) continue;

      data.defender = def;
      const baseOutcome = resolveOutcomeRAW(data, def) ?? { winner: "tie", text: "" };
      const outcome = applyAoEEvadeOutcome(data, baseOutcome, def);
      setDefenderOutcome(data, def, outcome);
      setDefenderAdvantage(data, def, computeAdvantageRAW(data, outcome, def));
      resolvedAny = true;
    }

    if (resolvedAny) {
      const allResolved = defenders.every(def => Boolean(getDefenderOutcome(data, def)));
      if (allResolved) {
        data.status = "resolved";
        data.context = data.context ?? {};
        data.context.phase = "resolved";
        if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
        cleanupAutoRollContext(data.context);
      }
      dirty = true;
    }

    data.defender = originalDefender;
  }

  // Multi-defender: when a defender roll arrives, also resolve other defenders who have already rolled.
  // This ensures that when Defender A rolls after Defender B has already rolled, both get resolved.
  if ((stage === "defender-roll" || stage === "defender-nodefense") && isMultiDefender(data) && data.attacker?.result) {
    const originalDefender = data.defender;
    const defenders = getDefenderEntries(data);
    let resolvedAny = false;

    for (const def of defenders) {
      if (!def) continue;
      if (!(def.result || def.noDefense)) continue;
      if (getDefenderOutcome(data, def)) continue;

      data.defender = def;
      const baseOutcome = resolveOutcomeRAW(data, def) ?? { winner: "tie", text: "" };
      const outcome = applyAoEEvadeOutcome(data, baseOutcome, def);
      setDefenderOutcome(data, def, outcome);
      setDefenderAdvantage(data, def, computeAdvantageRAW(data, outcome, def));
      resolvedAny = true;
    }

    if (resolvedAny) {
      const allResolved = defenders.every(def => Boolean(getDefenderOutcome(data, def)));
      if (allResolved) {
        data.status = "resolved";
        data.context = data.context ?? {};
        data.context.phase = "resolved";
        if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
        cleanupAutoRollContext(data.context);
      }
      dirty = true;
    }

    data.defender = originalDefender;
  }

  // ── Merge-on-write: prevent stale-snapshot race condition ──
  // The orchestrator dispatches attacker + defender rolls concurrently.
  // Each banking call deep-clones the parent flags, sets only its own lane,
  // then writes the entire object. Without merging, the second writer
  // overwrites the first writer's result with a stale snapshot.
  //
  // Fix: right before persisting, re-read the parent's *current* flags
  // (which may have been updated by the other lane since our initial read)
  // and merge our changes onto the freshest snapshot.
  const freshParent = game.messages.get(parentId) ?? parent;
  const freshFlags = freshParent?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
  if (freshFlags && typeof freshFlags === "object") {
    const merged = JSON.parse(JSON.stringify(freshFlags));

    // Re-select the correct defender entry on the merged snapshot so that
    // defender-lane writes target the right sub-object.
    selectDefenderEntry(merged, {
      defenderIndex,
      defenderTokenUuid: meta?.defenderTokenUuid,
      defenderActorUuid: meta?.defenderActorUuid
    });

    if (stage === "attacker-roll") {
      // Overlay our attacker data onto the fresh snapshot.
      merged.attacker = JSON.parse(JSON.stringify(data.attacker));
    } else if (stage === "defender-roll" || stage === "defender-nodefense") {
      // Overlay our defender data onto the fresh snapshot.
      merged.defender = JSON.parse(JSON.stringify(data.defender));
      // For multi-defender, also merge the defenders array.
      if (isMultiDefender(data) && Array.isArray(data.defenders)) {
        merged.defenders = JSON.parse(JSON.stringify(data.defenders));
      }
    }

    // Merge context, status, and outcome fields that may have been set by
    // either lane (e.g., phase tracking, resolution status).
    if (data.context) {
      merged.context = foundry.utils.mergeObject(
        merged.context ?? {},
        JSON.parse(JSON.stringify(data.context)),
        { overwrite: true, inplace: false }
      );
    }
    if (data.status) merged.status = data.status;

    // Merge any outcome/advantage that was resolved in this banking call.
    // Only overwrite with a non-null value to avoid clobbering the other lane's resolution.
    if (data.outcome && !merged.outcome) merged.outcome = JSON.parse(JSON.stringify(data.outcome));
    if (data.advantage != null && merged.advantage == null) merged.advantage = data.advantage;

    await updateCard(freshParent, merged);
  } else {
    // Fallback: fresh read failed, persist our snapshot directly (original behavior).
    await updateCard(parent, data);
  }
}
