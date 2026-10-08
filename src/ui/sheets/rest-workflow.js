import { createDamageAftermathBundle } from "../../core/combat/damage/aftermath-bundle.js";
import { measurePerfStage } from "../../utils/perf-tracker.js";
import { hasTalent } from "../../core/traits/talents-api.js";
import { clearRacialTalentUsageOnRest } from "../../core/traits/racial-talents.js";
import { _num } from "../../utils/coerce.js";
import { _canPromptForActor } from "../../core/traits/index.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { requestAtomicUpdateDocument, requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { hasStuntedMagicka } from "../../core/magic/magic-modifiers.js";
import { getRecoveryAEModifiers } from "../../core/actors/ae/modifiers.js";
import { isReligionWorshipEnabled } from "../../core/homebrew/settings.js";
import {
  buildInvocationGroupEntries,
  getActorRitualDomainEntries,
  getDomainPreparationLimit,
} from "../../core/religion/ritual-domains.js";
import {
  getNaturalHealingStarsignProfile,
  getRitualBlessingNames,
  hasRitualBirthsign,
  hasStarCursedRitualBirthsign,
  isRitualBlessingItem,
} from "../../core/traits/starsigns/index.js";
import {
  actorHasActiveFasting,
  setPreparedInvocations,
} from "../../core/religion/worship-service.js";
import birthsignSigns from "./racemenu/data/birthsign-signs.js";
import { findIndexEntryByNormalizedName, getDocumentById } from "../../core/compendium/access-service.js";

// Chapter 5: Untreated wounds block natural HP regeneration.
// Reuse the authoritative helper from the wounds subsystem when available.
function hasUntreatedWounds(actor) {
  const api = game?.uesrpg?.wounds;
  if (api?.canNaturalHeal) return !api.canNaturalHeal(actor);
  // Fallback: use wound effects directly when API is unavailable.
  const effects = actor?.effects?.contents ?? [];
  return effects.some((e) => String(e?.getFlag?.("uesrpg-3ev4", "wounds")?.kind ?? "") === "wound");
}

const _hpHealSkipNotify = new Map();

function _notifyHpHealingSkipped(actor) {
  try {
    if (!ui?.notifications?.warn) return;
    const key = String(actor?.uuid ?? actor?.id ?? "");
    const now = Date.now();
    const last = _hpHealSkipNotify.get(key) ?? 0;
    // Avoid rapid duplicate toasts (e.g., group rest runs).
    if (now - last < 1000) return;
    _hpHealSkipNotify.set(key, now);
    ui.notifications.warn(`${actor?.name ?? "Actor"}: Natural HP healing skipped due to untreated wounds.`);
  } catch (_) {
    // Intentionally ignore notification failures.
  }
}

function _resolveRecoveryLane(baseValue, lane, { defaultValue = 0 } = {}) {
  const base = _num(baseValue, defaultValue);
  const add = _num(lane?.add, 0);
  if (lane?.override != null) return Math.max(0, _num(lane.override, defaultValue));
  return Math.max(0, base + add);
}

function _resolveResourceRecoveryProfile(actor) {
  const ae = getRecoveryAEModifiers(actor);
  return {
    naturalHealing: {
      multiplier: _resolveRecoveryLane(actor?.system?.recovery?.naturalHealing?.multiplier, ae?.naturalHealing?.multiplier, { defaultValue: 1 }),
      flatBonus: _resolveRecoveryLane(actor?.system?.recovery?.naturalHealing?.flatBonus, ae?.naturalHealing?.flatBonus, { defaultValue: 0 }),
    },
    magicka: {
      multiplier: _resolveRecoveryLane(actor?.system?.recovery?.magickaRecovery?.multiplier, ae?.magicka?.multiplier, { defaultValue: 1 }),
    },
    stamina: {
      multiplier: _resolveRecoveryLane(actor?.system?.recovery?.staminaRecovery?.multiplier, ae?.stamina?.multiplier, { defaultValue: 1 }),
    }
  };
}

function _resolveNaturalHealingProfile(actor, { endBonus = 0 } = {}) {
  const baseHealing = Math.max(0, _num(endBonus, 0));
  const recoveryProfile = _resolveResourceRecoveryProfile(actor);
  const starsignProfile = getNaturalHealingStarsignProfile(actor);
  const hasRapidRecovery = hasTalent(actor, "rapidrecovery");
  const aeMultiplier = Math.max(1, _num(recoveryProfile?.naturalHealing?.multiplier, 1));
  const aeFlatBonus = _num(recoveryProfile?.naturalHealing?.flatBonus, 0);

  const multiplier = Math.max(
    1,
    Math.max(1, _num(starsignProfile?.multiplier, 1)),
    aeMultiplier,
    hasRapidRecovery ? 2 : 1
  );
  const flatBonus = _num(starsignProfile?.flatBonus, 0) + aeFlatBonus;

  const sources = [];
  if (Array.isArray(starsignProfile?.sources) && starsignProfile.sources.length) {
    sources.push(...starsignProfile.sources.map((source) => String(source ?? "").trim()).filter(Boolean));
  }
  if (aeMultiplier !== 1 || aeFlatBonus !== 0) sources.push("AE recovery");
  if (hasRapidRecovery) sources.push("Rapid Recovery");

  return {
    baseHealing,
    multiplier,
    flatBonus,
    finalHealing: Math.max(0, Math.floor(baseHealing * multiplier) + flatBonus),
    sources
  };
}

function _appendRestLineNote(line, note) {
  const text = String(note ?? "").trim();
  if (!text) return String(line ?? "");
  const current = String(line ?? "");
  if (current.endsWith("</li>")) return current.replace("</li>", `; ${foundry.utils.escapeHTML(text)}</li>`);
  return `${current}; ${foundry.utils.escapeHTML(text)}`;
}

function _getRitualBlessingSource(name) {
  const desired = String(name ?? "").trim().toLowerCase();
  if (!desired) return null;
  const candidates = [
    ...(Array.isArray(birthsignSigns?.ritual?.items) ? birthsignSigns.ritual.items : []),
    ...(Array.isArray(birthsignSigns?.ritual?.starCursed) ? birthsignSigns.ritual.starCursed : []),
  ];
  return candidates.find((entry) => entry?.pack && String(entry?.name ?? "").trim().toLowerCase() === desired) ?? null;
}

async function _loadBirthsignGrantCreateData(ref) {
  const packId = String(ref?.pack ?? "").trim();
  const itemName = String(ref?.name ?? "").trim();
  if (!packId || !itemName) return null;

  const entry = await findIndexEntryByNormalizedName(packId, itemName, { fields: ["name"] });
  if (!entry?._id) return null;

  const itemDoc = await getDocumentById(packId, entry._id);
  if (!itemDoc) return null;

  const itemData = itemDoc.toObject();
  delete itemData.ownership;
  return itemData;
}

async function _promptRitualBlessingChoice(actor, { currentName = "" } = {}) {
  const selectedName = String(currentName ?? "").trim().toLowerCase();
  const options = getRitualBlessingNames()
    .map((name) => {
      const selected = selectedName === String(name).trim().toLowerCase() ? "selected" : "";
      return `<option value="${foundry.utils.escapeHTML(name)}" ${selected}>${foundry.utils.escapeHTML(name)}</option>`;
    })
    .join("");

  return customDialog({
    layout: "workflow",
    title: "The Ritual",
    content: `
      <div class="uesrpg-ritual-refresh">
        <p><b>${foundry.utils.escapeHTML(actor?.name ?? "Actor")}</b> must choose one Ritual blessing for the new day.</p>
        <div class="form-group">
          <label for="uesrpg-ritual-blessing">Blessing</label>
          <select id="uesrpg-ritual-blessing" name="uesrpg-ritual-blessing">${options}</select>
        </div>
      </div>
    `,
    buttons: {
      choose: {
        label: "Choose Blessing",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return String(root?.querySelector?.('select[name="uesrpg-ritual-blessing"]')?.value ?? "").trim() || null;
        }
      },
      cancel: {
        label: "Keep Current",
        callback: () => null
      }
    },
    default: "choose",
    width: 420
  });
}

async function _applyRitualBlessingRefresh(actor) {
  if (!actor || !hasRitualBirthsign(actor) || hasStarCursedRitualBirthsign(actor)) {
    return { changed: false, chosen: null };
  }

  const existingBlessings = Array.from(actor?.items ?? []).filter((item) => isRitualBlessingItem(item));
  const currentName = String(existingBlessings[0]?.name ?? "").trim() || null;

  if (!_canPromptForActor(actor)) {
    return { changed: false, chosen: currentName };
  }

  let chosen = null;
  try {
    chosen = await _promptRitualBlessingChoice(actor, { currentName });
  } catch (_e) {
    chosen = null;
  }

  if (!chosen) return { changed: false, chosen: currentName };

  const sourceRef = _getRitualBlessingSource(chosen);
  const itemData = await _loadBirthsignGrantCreateData(sourceRef);
  if (!itemData) throw new Error("The selected Ritual blessing could not be loaded.");

  delete itemData._id;
  const created = await requestCreateEmbeddedDocuments(actor, "Item", [itemData]);
  const replacement = created?.[0];
  if (!replacement?.id) throw new Error("Ritual blessing creation was not confirmed; the previous blessing was retained.");
  const idsToDelete = existingBlessings.map(item => item.id).filter(id => actor.items?.get?.(id));
  if (idsToDelete.length && !await requestDeleteEmbeddedDocuments(actor, "Item", idsToDelete)) {
    const cleaned = await requestDeleteEmbeddedDocuments(actor, "Item", [replacement.id]);
    throw new Error(cleaned
      ? "Previous Ritual blessing removal failed; the new blessing was removed. Check the remaining blessings."
      : "Ritual blessing replacement is partial: removal and rollback were not confirmed. Check for duplicate blessings.");
  }

  return { changed: true, chosen };
}

export function buildRestChatContent(title, lines) {
  const safeLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
  return `<h3>${title}</h3><ul>${safeLines.join("")}</ul>`;
}

async function _promptMeditationChoice(actor) {
  return await customDialog({
    layout: "workflow",
    title: "Meditation",
    content: `
      <div class="uesrpg-meditation-short-rest">
        <p><b>${foundry.utils.escapeHTML(actor?.name ?? "Actor")}</b> has <b>Meditation</b>.</p>
        <p>Spend this short rest in uninterrupted meditation to <b>double</b> normal Magicka and Stamina regeneration?</p>
      </div>
    `,
    buttons: {
      yes: { label: "Meditate", callback: () => true },
      no: { label: "Normal Rest", callback: () => false }
    },
    default: "yes",
    width: 420
  });
}

async function _promptLongRestInvocationPreparation(actor) {
  if (!actor || actor.type !== "Player Character" || !_canPromptForActor(actor) || !isReligionWorshipEnabled()) {
    return { updatedDomains: [] };
  }

  const domainEntries = getActorRitualDomainEntries(actor);
  if (!domainEntries.length) return { updatedDomains: [] };

  const shouldPrepare = await customDialog({
    layout: "workflow",
    title: "Invocation Preparation",
    content: `
      <div class="uesrpg-long-rest-invocations">
        <p><b>${foundry.utils.escapeHTML(actor?.name ?? "Actor")}</b> may re-prepare invocations for the next day.</p>
        <p>Choose <b>Re-prepare</b> to review each ritual domain. Choose <b>Keep Current</b> to preserve the existing prepared lists.</p>
      </div>
    `,
    buttons: {
      prepare: { label: "Re-prepare", callback: () => true },
      keep: { label: "Keep Current", callback: () => false },
    },
    default: "keep",
    width: 460,
  });

  if (!shouldPrepare) return { updatedDomains: [] };

  const groups = buildInvocationGroupEntries(actor);
  const updatedDomains = [];

  for (const domainEntry of domainEntries) {
    const domainKey = String(domainEntry?.key ?? "").trim().toLowerCase();
    if (!domainKey) continue;

    const rows = groups.flatMap((group) =>
      group.invocations
        .filter((entry) => Array.isArray(entry.accessibleStores) && entry.accessibleStores.includes(domainKey))
        .map((entry) => ({
          id: entry.id,
          label: entry.label,
          groupLabel: group.label,
          circle: entry.circle,
          pietyCost: entry.pietyCost,
          prepared: Array.isArray(entry.preparedIn) && entry.preparedIn.includes(domainKey),
        }))
    );

    if (!rows.length) continue;

    const prepLimit = getDomainPreparationLimit(actor, domainKey);
    const picked = await customDialog({
      layout: "workflow",
      title: `Prepare Invocations: ${foundry.utils.escapeHTML(domainEntry.label)}`,
      content: `<div style="display:flex; flex-direction:column; gap:8px;">
        <p style="margin:0;">Preparation limit: <b>${prepLimit}</b></p>
        <div style="max-height:420px; overflow:auto;">${rows.map((row) => `
          <label class="uesrpg-adv-choice uesrpg-choice-bar">
            <input type="checkbox" name="invocationId" value="${row.id}" ${row.prepared ? "checked" : ""} />
            <span class="uesrpg-adv-choice__label"><b>${foundry.utils.escapeHTML(row.label)}</b> (${foundry.utils.escapeHTML(row.groupLabel)}, Circle ${row.circle}, ${row.pietyCost} PP)</span>
          </label>
        `).join("")}</div>
      </div>`,
      buttons: {
        save: {
          label: "Save",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.[0];
            return Array.from(root?.querySelectorAll('input[name="invocationId"]:checked') ?? []).map((el) => el.value);
          },
        },
        skip: { label: "Keep Current", callback: () => null },
      },
      defaultButton: "save",
      width: 520,
    });

    if (!picked) continue;
    if (picked.length > prepLimit) {
      ui.notifications?.warn?.(`You can only prepare ${prepLimit} invocation(s) for ${domainEntry.label}.`);
      continue;
    }

    await setPreparedInvocations(actor, domainKey, picked, { strict: true });
    updatedDomains.push(domainEntry.label);
  }

  return { updatedDomains };
}

const _pendingRests = new Map();

function _runRest(actor, type, opts, run) {
  const key = actor?.uuid;
  if (!key) return run(actor, opts);
  // A pending rest on this client is joined; a later deliberate rest remains available.
  if (_pendingRests.has(key)) return _pendingRests.get(key);
  const operationId = foundry.utils.randomID();
  const pending = measurePerfStage("rest", "settlement", { actorUuid: key, restType: type, operationId },
    () => run(actor, { ...opts, operationId })).finally(() => _pendingRests.delete(key));
  _pendingRests.set(key, pending);
  return pending;
}

export function applyShortRest(actor, opts = {}) {
  return _runRest(actor, "short", opts, _applyShortRest);
}

export function applyLongRest(actor, opts = {}) {
  return _runRest(actor, "long", opts, _applyLongRest);
}

function _restResult(actor, meta, confirmed, summary = null) {
  const settled = meta.calculated && (!meta.hasUpdates || confirmed);
  const failures = summary?.failed ?? [];
  const status = !settled ? "failed" : failures.length ? "partial" : "completed";
  let line = settled ? meta.line : `<li><b>${foundry.utils.escapeHTML(actor?.name ?? "Actor")}</b>: Rest recovery was not confirmed; follow-ups were skipped.</li>`;
  if (failures.length) line = _appendRestLineNote(line, `Partial completion: ${failures.map(entry => `${entry.label}: ${entry.error}`).join("; ")}`);
  return {
    line, updatesApplied: Boolean(settled && confirmed && meta.hasUpdates),
    recovery: settled ? (meta.recovered ? "confirmed" : "none") : "failed",
    hpHealed: settled ? meta.hpHealed : 0,
    execution: { status, committed: Boolean(confirmed), operationId: meta.operationId },
    aftermathSummary: summary,
  };
}

async function _applyShortRest(actor, opts = {}) {
  if (!actor) return { line: "", updatesApplied: false };

  // ── Phase 1: async operations that do NOT need current resource values ──────
  // Run these before re-reading the actor, so the re-read is as fresh as possible
  // at write time. The only state needed at this stage is talent presence (stable).

  const actorName = foundry.utils.escapeHTML(actor.name);
  const actorUuid = actor.uuid;
  const stuntedMagicka = hasStuntedMagicka(actor);
  const fastingFactor = actorHasActiveFasting(actor) ? 0.5 : 1;

  // Meditation (Chapter 4): optional short rest mode that doubles MP/SP regeneration.
  const allowPrompt = opts?.allowPrompt !== false;
  let useMeditation = false;
  if (hasTalent(actor, "meditation")) {
    if (typeof opts?.useMeditation === "boolean") {
      useMeditation = opts.useMeditation;
    } else if (allowPrompt && _canPromptForActor(actor)) {
      try {
        useMeditation = await _promptMeditationChoice(actor);
      } catch (_e) {
        useMeditation = false;
      }
    }
  }

  // Rapid Recovery (Chapter 4): roll 1d4 HP. Independent of current HP value.
  const canRapidRecover = hasTalent(actor, "rapidrecovery");
  let rapidRecoveryRoll = 0;
  if (canRapidRecover) {
    try {
      const roll = await new Roll("1d4").evaluate();
      rapidRecoveryRoll = Math.max(0, Number(roll.total ?? 0) || 0);
    } catch (_e) {
      // Non-blocking.
    }
  }

  // ── Phase 2: atomic read-compute-write ───────────────────────────────────
  // requestAtomicUpdateDocument re-reads the actor fresh inside a per-document
  // lock before calling this mutator. Current resource values read here are
  // therefore the latest server state, not the snapshot from Phase 1.
  //
  // Side-effects (writing to `meta`) inside the mutator are safe because the
  // mutator is called exactly once per invocation.

  const meta = { hpHealed: 0, line: `<li><b>${actorName}</b>: `, hasUpdates: false, hadUntreatedWounds: false, calculated: false, recovered: false, operationId: opts.operationId };

  const confirmed = await requestAtomicUpdateDocument(actorUuid, (freshActor) => {
    meta.calculated = true;
    const resourceRecovery = _resolveResourceRecoveryProfile(freshActor);
    const fatigueBonus = _num(freshActor.system?.fatigue?.bonus ?? 0);
    const currentSP = _num(freshActor.system?.stamina?.value ?? 0);
    const maxSP = _num(freshActor.system?.stamina?.max ?? 0);
    const currentMP = _num(freshActor.system?.magicka?.value ?? 0);
    const maxMP = _num(freshActor.system?.magicka?.max ?? 0);
    const currentHP = _num(freshActor.system?.hp?.value ?? 0);
    const maxHP = _num(freshActor.system?.hp?.max ?? 0);

    const updateData = {};

    // RAW: Remove 1 fatigue OR recover 1 SP.
    if (fatigueBonus > 0) {
      updateData["system.fatigue.bonus"] = Math.max(0, fatigueBonus - 1);
      meta.line += `Removed 1 fatigue (now ${Math.max(0, fatigueBonus - 1)})`;
    } else if (currentSP < maxSP) {
      const deltaSP = Math.max(0, Math.floor((useMeditation ? 2 : 1) * Math.max(0, _num(resourceRecovery?.stamina?.multiplier, 1)) * fastingFactor));
      if (deltaSP > 0) {
        const newSP = Math.min(currentSP + deltaSP, maxSP);
        updateData["system.stamina.value"] = newSP;
        meta.line += `Recovered ${newSP - currentSP} SP (now ${newSP}/${maxSP})`;
      } else {
        meta.line += "No recovery needed";
      }
    } else {
      meta.line += "No recovery needed";
    }

    // RAW: Recover MP = floor(maxMP / 10).
    const mpRecoverBase = Math.floor(maxMP / 10);
    const mpRecover = stuntedMagicka
      ? 0
      : Math.max(0, Math.floor(mpRecoverBase * Math.max(0, _num(resourceRecovery?.magicka?.multiplier, 1)) * (useMeditation ? 2 : 1) * fastingFactor));
    if (stuntedMagicka) {
      meta.line += " (MP recovery skipped due to Stunted Magicka)";
    } else if (mpRecover > 0 && currentMP < maxMP) {
      const newMP = Math.min(currentMP + mpRecover, maxMP);
      updateData["system.magicka.value"] = newMP;
      meta.line += ` (+${newMP - currentMP} MP)`;
    }

    // Rapid Recovery HP heal applied to fresh current HP.
    if (rapidRecoveryRoll > 0 && currentHP < maxHP) {
      const hpRecovered = Math.max(0, Math.floor(rapidRecoveryRoll * fastingFactor));
      meta.hpHealed = Math.min(hpRecovered, maxHP - currentHP);
      const newHP = Math.min(maxHP, currentHP + hpRecovered);
      updateData["system.hp.value"] = newHP;
      meta.line += ` (+${meta.hpHealed} HP)`;
    }

    for (const [key, value] of Object.entries(updateData)) {
      if (value === foundry.utils.getProperty(freshActor, key)) delete updateData[key];
    }
    meta.recovered = Object.entries(updateData).some(([key, value]) => key.startsWith("system.") && value !== foundry.utils.getProperty(freshActor, key));
    meta.hasUpdates = Object.keys(updateData).length > 0;
    return meta.hasUpdates ? updateData : null;
  }, { perfKind: "rest", operationId: opts.operationId });

  if (useMeditation) meta.line += " (Meditation)";
  if (fastingFactor < 1) meta.line += " (Fasting halved recovery)";
  meta.line += "</li>";

  if (!meta.calculated || (meta.hasUpdates && !confirmed)) return _restResult(actor, meta, confirmed);
  const aftermath = createDamageAftermathBundle({ targetActor: actor, applicationId: opts.operationId, source: "Short Rest", kind: "rest" });
  if (meta.hpHealed > 0) aftermath.stage({ key: "naturalHealing", label: "Natural wound healing", run: async () => {
    const applyNatural = game?.uesrpg?.wounds?.applyNaturalHealingToWounds;
    if (typeof applyNatural !== "function") throw new Error("Wound automation is unavailable.");
    return applyNatural(actor, meta.hpHealed, { source: "shortRest", strict: true });
  } });
  aftermath.stage({ key: "racialUsage", label: "Racial usage reset", run: () => clearRacialTalentUsageOnRest(actor, { restType: "short", strict: true }) });
  return _restResult(actor, meta, confirmed, await aftermath.commit());
}

async function _applyLongRest(actor, opts = {}) {
  if (!actor) return { line: "", updatesApplied: false };

  // ── Phase 1: resolve stable derived values and async side-reads ─────────
  // These are characteristics and talent checks that do not change mid-rest.
  // Run them before re-reading, so the re-read is as fresh as possible at write time.

  const actorName = foundry.utils.escapeHTML(actor.name);
  const actorUuid = actor.uuid;
  // END bonus is stable over the course of a rest (no equipment swaps expected mid-rest).
  const endBonus = Math.floor(_num(actor.system?.characteristics?.end?.total ?? 0) / 10);
  const stuntedMagicka = hasStuntedMagicka(actor);
  const fastingFactor = actorHasActiveFasting(actor) ? 0.5 : 1;

  // ── Phase 2: atomic read-compute-write ───────────────────────────────────
  // requestAtomicUpdateDocument re-reads the actor fresh inside a per-document
  // lock before calling this mutator, ensuring current resource values are the
  // latest server state.

  const meta = { hpHealed: 0, line: "", hasUpdates: false, untreatedWoundsNoHeal: false, calculated: false, recovered: false, operationId: opts.operationId };

  const confirmed = await requestAtomicUpdateDocument(actorUuid, (freshActor) => {
    meta.calculated = true;
    const fatigueBonus = _num(freshActor.system?.fatigue?.bonus ?? 0);
    const currentHP = _num(freshActor.system?.hp?.value ?? 0);
    const maxHP = _num(freshActor.system?.hp?.max ?? 0);
    const currentSP = _num(freshActor.system?.stamina?.value ?? 0);
    const maxSP = _num(freshActor.system?.stamina?.max ?? 0);
    const currentMP = _num(freshActor.system?.magicka?.value ?? 0);
    const maxMP = _num(freshActor.system?.magicka?.max ?? 0);
    const untreatedWounds = hasUntreatedWounds(freshActor);
    const longRestCounter = Number(freshActor?.getFlag?.("uesrpg-3ev4", "wounds.longRestCounter") ?? 0) || 0;

    const updateData = {};
    const recoveryParts = [];

    // RAW: Remove fatigue levels first; remaining recovery applies to SP.
    let recoveryPool = Math.max(0, Math.floor(endBonus * fastingFactor));

    if (fatigueBonus > 0 && recoveryPool > 0) {
      const fatigueRemoved = Math.min(fatigueBonus, recoveryPool);
      const newFatigue = Math.max(0, fatigueBonus - fatigueRemoved);
      updateData["system.fatigue.bonus"] = newFatigue;
      recoveryParts.push(`Removed ${fatigueRemoved} fatigue`);
      recoveryPool -= fatigueRemoved;
    }

    if (recoveryPool > 0 && currentSP < maxSP) {
      const spRecovered = Math.min(recoveryPool, Math.max(0, maxSP - currentSP));
      const newSP = Math.min(maxSP, currentSP + spRecovered);
      updateData["system.stamina.value"] = newSP;
      recoveryParts.push(`Recovered ${spRecovered} SP (${newSP}/${maxSP})`);
    }

    // RAW: Heal END bonus HP on long rest only if there are no untreated wounds.
    if (!untreatedWounds && currentHP < maxHP && endBonus > 0) {
      const healingProfile = _resolveNaturalHealingProfile(freshActor, { endBonus: Math.floor(endBonus * fastingFactor) });
      meta.hpHealed = Math.min(healingProfile.finalHealing, maxHP - currentHP);
      updateData["system.hp.value"] = currentHP + meta.hpHealed;
      let healText = `Healed ${meta.hpHealed} HP`;
      if (healingProfile.sources.length) healText += ` (${healingProfile.sources.join("; ")})`;
      recoveryParts.push(healText);
    } else if (untreatedWounds && currentHP < maxHP) {
      recoveryParts.push("HP not healed (untreated wounds)");
      meta.untreatedWoundsNoHeal = true;
    }

    // RAW: Regenerate all missing MP.
    if (stuntedMagicka) {
      recoveryParts.push("MP recovery skipped due to Stunted Magicka");
    } else if (currentMP < maxMP) {
      const recoveredMp = Math.max(0, Math.floor((maxMP - currentMP) * fastingFactor));
      updateData["system.magicka.value"] = Math.min(maxMP, currentMP + recoveredMp);
      recoveryParts.push(`Recovered ${recoveredMp} MP (${Math.min(maxMP, currentMP + recoveredMp)}/${maxMP})`);
    }

    updateData["flags.uesrpg-3ev4.wounds.longRestCounter"] = longRestCounter + 1;

    if (!recoveryParts.length) recoveryParts.push("No recovery needed");

    meta.line = `<li><b>${actorName}</b>: ${recoveryParts.join("; ")}</li>`;
    for (const [key, value] of Object.entries(updateData)) {
      if (value === foundry.utils.getProperty(freshActor, key)) delete updateData[key];
    }
    meta.recovered = Object.entries(updateData).some(([key, value]) => key.startsWith("system.") && value !== foundry.utils.getProperty(freshActor, key));
    meta.hasUpdates = Object.keys(updateData).length > 0;
    return meta.hasUpdates ? updateData : null;
  }, { perfKind: "rest", operationId: opts.operationId });

  if (!meta.calculated || (meta.hasUpdates && !confirmed)) return _restResult(actor, meta, confirmed);
  const aftermath = createDamageAftermathBundle({ targetActor: actor, applicationId: opts.operationId, source: "Long Rest", kind: "rest" });
  if (meta.hpHealed > 0) aftermath.stage({ key: "naturalHealing", label: "Natural wound healing", run: async () => {
    const applyNatural = game?.uesrpg?.wounds?.applyNaturalHealingToWounds;
    if (typeof applyNatural !== "function") throw new Error("Wound automation is unavailable.");
    return applyNatural(actor, meta.hpHealed, { source: "longRest", strict: true });
  } });
  aftermath.stage({ key: "blessing", label: "Ritual blessing", run: async () => {
    const result = await _applyRitualBlessingRefresh(actor);
    if (result?.changed && result.chosen) meta.line = _appendRestLineNote(meta.line, `Ritual blessing: ${result.chosen}`);
    return result;
  } });
  aftermath.stage({ key: "woundReconciliation", label: "Wound reconciliation", run: async () => {
    const reconcile = game?.uesrpg?.wounds?.reconcileWoundState;
    if (typeof reconcile !== "function") throw new Error("Wound automation is unavailable.");
    return reconcile(actor, { reason: "longRest", strict: true });
  } });
  if (opts?.allowPrompt !== false) aftermath.stage({ key: "invocations", label: "Invocation preparation", run: async () => {
    const result = await _promptLongRestInvocationPreparation(actor);
    if (result?.updatedDomains?.length) meta.line = _appendRestLineNote(meta.line, `Invocations prepared for ${result.updatedDomains.join(", ")}`);
    return result;
  } });
  aftermath.stage({ key: "racialUsage", label: "Racial usage reset", run: () => clearRacialTalentUsageOnRest(actor, { restType: "long", strict: true }) });
  const summary = await aftermath.commit();
  if (meta.untreatedWoundsNoHeal) _notifyHpHealingSkipped(actor);
  if (fastingFactor < 1) meta.line = _appendRestLineNote(meta.line, "Fasting halved HP/SP/MP recovery");

  return _restResult(actor, meta, confirmed, summary);
}
