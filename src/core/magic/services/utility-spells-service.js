import { escapeHtml } from "../../../utils/html.js";
/**
 * @module magic/services/utility-spells-service
 *
 * Runtime utility spell handlers for Chapter 6 singleton spells where
 * deterministic outcomes require contextual prompts.
 */

import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { createDebugLogger } from "../_primitives.js";
import {
  requestDeleteEmbeddedDocuments,
  requestUpdateDocument
} from "../../../utils/authority-proxy.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { hasCoreCompendiumSource } from "../../compendium/access-service.js";

const _FLAG_NS = FLAG_SCOPE;
const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][UtilitySpells]");

let _initialized = false;

function _norm(s) {
  return String(s ?? "").trim().toLowerCase();
}

function _isSpell(spell, names = []) {
  const n = _norm(spell?.name);
  if (!n) return false;
  return names.some((x) => n === _norm(x));
}

function _isDetectSpell(spell) {
  const utilityKind = _norm(spell?.flags?.[_FLAG_NS]?.chapter6Utility?.kind);
  if (utilityKind === "detect") return true;
  return _norm(spell?.name).startsWith("detect ");
}

function _getCasterToken(caster) {
  try {
    const active = (canvas?.tokens?.placeables ?? []).find((t) => t?.actor?.uuid === caster?.uuid);
    if (active) return active;
    return caster?.getActiveTokens?.(true, true)?.[0] ?? null;
  } catch (_e) {
    return null;
  }
}

function _getTargetActors(caster) {
  const targets = Array.from(game.user?.targets ?? []);
  const actors = targets.map((t) => t.actor ?? t.document?.actor).filter(Boolean);
  if (actors.length > 0) return actors;
  return caster ? [caster] : [];
}

async function _handleRecall(caster, spell) {
  const token = _getCasterToken(caster);
  if (!token?.document) {
    ui.notifications?.warn?.("Recall requires the caster to have an active token.");
    return;
  }

  const anchor = caster?.flags?.[_FLAG_NS]?.magic?.recallAnchor ?? null;
  const action = await customDialog({
    layout: "workflow",
    title: "Recall",
    content: `<p>Choose how to resolve <b>${spell.name}</b>.</p><p>Anchor currently ${anchor ? "exists" : "does not exist"}.</p>`,
    buttons: {
      anchor: { label: "Set Anchor", icon: "fas fa-map-pin", callback: () => "anchor" },
      recall: { label: "Recall", icon: "fas fa-location-arrow", callback: () => "recall" },
      cancel: { label: "Cancel", icon: "fas fa-times", callback: () => null }
    },
    default: "anchor"
  });
  if (!action) return;

  if (action === "anchor") {
    await requestUpdateDocument(caster, {
      [`flags.${_FLAG_NS}.magic.recallAnchor`]: {
        sceneId: token.document.parent?.id ?? canvas?.scene?.id ?? null,
        x: Number(token.document.x ?? 0) || 0,
        y: Number(token.document.y ?? 0) || 0,
        at: Date.now()
      }
    });
    ui.notifications?.info?.(`${caster.name} sets a Recall anchor.`);
    return;
  }

  const a = caster?.flags?.[_FLAG_NS]?.magic?.recallAnchor ?? null;
  if (!a?.sceneId) {
    ui.notifications?.warn?.("No Recall anchor is set.");
    return;
  }
  if (String(a.sceneId) !== String(canvas?.scene?.id ?? "")) {
    ui.notifications?.warn?.("Recall anchor is in a different scene.");
    return;
  }

  await requestUpdateDocument(token.document, {
    x: Number(a.x ?? token.document.x),
    y: Number(a.y ?? token.document.y)
  });
  ui.notifications?.info?.(`${caster.name} recalls to their anchor.`);
}

async function _handleDetect(caster, spell) {
  const pick = await customDialog({
    layout: "workflow",
    title: "Detect Type",
    content: `<p>Select what ${spell.name} is detecting.</p>`,
    buttons: {
      life: { label: "Life", callback: () => "life" },
      undead: { label: "Undead", callback: () => "undead" },
      magic: { label: "Magic", callback: () => "magic" },
      other: { label: "Other", callback: () => "other" },
      cancel: { label: "Cancel", callback: () => null }
    },
    default: "life"
  });
  if (!pick) return;

  await requestUpdateDocument(caster, {
    [`flags.${_FLAG_NS}.magic.detect.active`]: {
      type: pick,
      spellUuid: spell.uuid,
      spellName: spell.name,
      startedAt: Date.now()
    }
  });
  ui.notifications?.info?.(`${caster.name} is now detecting ${pick}.`);
}

async function _handleTelepathy(caster, spell) {
  const targets = _getTargetActors(caster).filter((a) => a?.uuid !== caster?.uuid);
  const byUuid = new Map(targets.map((a) => [String(a.uuid), a]));
  if (!targets.length) {
    ui.notifications?.warn?.("Telepathy requires at least one selected target.");
    return;
  }

  const options = targets.map((a) => `<option value="${a.uuid}">${escapeHtml(a.name)}</option>`).join("");
  const selectedUuid = await customDialog({
    layout: "workflow",
    title: "Telepathy Target",
    content: `<div class="form-group"><label><b>Target</b></label><select name="target" style="width:100%;">${options}</select></div>`,
    buttons: {
      ok: {
        label: "Confirm",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.element ?? html;
          return String(root?.querySelector('select[name="target"]')?.value ?? "");
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    default: "ok"
  });
  if (!selectedUuid) return;

  const target = byUuid.get(String(selectedUuid));
  if (!target) return;

  await requestUpdateDocument(caster, {
    [`flags.${_FLAG_NS}.magic.telepathy.active`]: {
      spellUuid: spell.uuid,
      spellName: spell.name,
      targetUuid: target.uuid,
      targetName: target.name,
      startedAt: Date.now()
    }
  });
  ui.notifications?.info?.(`${caster.name} establishes telepathic contact with ${target.name}.`);
}

async function _handleOpen(caster, spell) {
  const result = await customDialog({
    layout: "workflow",
    title: "Open Resolution",
    content: `<div class="uesrpg"><p>Resolve <b>${spell.name}</b> target manually.</p><div class="form-group"><label><b>Object/Lock Label</b></label><input type="text" name="label" placeholder="Door, chest, seal..." /></div><div class="form-group"><label><b>Result</b></label><select name="result"><option value="opened">Opened</option><option value="failed">Failed</option></select></div></div>`,
    buttons: {
      ok: {
        label: "Post Result",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.element ?? html;
          return {
            label: String(root?.querySelector('input[name="label"]')?.value ?? "").trim() || "Unknown Object",
            result: String(root?.querySelector('select[name="result"]')?.value ?? "opened")
          };
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    default: "ok"
  });
  if (!result) return;

  await ChatMessage.create({
    content: `<div class="uesrpg"><h3>Open</h3><p><b>${escapeHtml(caster.name)}</b> attempts to open <b>${escapeHtml(result.label)}</b>.</p><p>Outcome: <b>${result.result === "opened" ? "Opened" : "Failed"}</b></p></div>`,
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

export function isDiseaseCureSpell(spell) {
  return _norm(spell?.flags?.[_FLAG_NS]?.chapter6Utility?.kind) === "cure-disease"
    || _isSpell(spell, ["Cure Disease", "Curing Touch"]);
}

/** Only explicit disease records are curable; the Diseased carrier trait is unrelated. */
function _curableDisease(record, strength) {
  const disease = record?.flags?.[_FLAG_NS]?.disease;
  if (!disease || disease.curable === false || disease.curse === true) return false;
  const category = _norm(disease.category);
  return category === "common" || category === "magical" && strength >= 2;
}

/** Executed once by the authoritative chat outcome, with its stored recipient and strength. */
export async function applyDiseaseCure({ caster, target, spell, payload = {} } = {}) {
  if (!isDiseaseCureSpell(spell)) return { skipped: true };
  const self = spell?.flags?.[_FLAG_NS]?.chapter6Utility?.target === "self" || _isSpell(spell, ["Cure Disease"]);
  const actor = self ? caster : target;
  const strength = Number(payload.castContext?.spellStrengthValue);
  if (!actor || ![1, 2].includes(strength)) {
    throw Object.assign(new Error("Disease cure requires a confirmed recipient and Spell Strength of 1 or 2."), { committed: false });
  }
  const items = Array.from(actor.items ?? []).filter(item => _curableDisease(item, strength));
  const itemUuids = new Set(items.map(item => item.uuid));
  // Transferred item effects disappear with their authoritative Item. Do not delete
  // the same symptom a second time, or remove unrelated effects by their names.
  const effects = Array.from(actor.effects ?? []).filter(effect => _curableDisease(effect, strength)
    && !itemUuids.has(effect.origin));
  let committed = false;
  try {
    for (const [documentName, records] of [["Item", items], ["ActiveEffect", effects]]) {
      if (!records.length) continue;
      const ids = records.map(record => record.id);
      const ok = await requestDeleteEmbeddedDocuments(actor, documentName, ids, { requireDeleted: true });
      committed ||= records.some(record => !actor.getEmbeddedDocument(documentName, record.id));
      if (!ok) throw new Error(`Disease cure did not confirm every ${documentName} removal.`);
    }
    const cured = [...items, ...effects].map(record => record.name);
    const followup = items.some(item => item.flags?.[_FLAG_NS]?.coreSource?.rule === "Rust Chancre")
      ? " Rust Chancre also requires an Endurance test; on failure, add Ugly permanently (Core p.119)." : "";
    const report = await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: caster }),
      content: `<div class="uesrpg"><p><b>${escapeHtml(spell.name)}</b> — ${escapeHtml(actor.name)}: ${cured.length
        ? `cured ${cured.map(escapeHtml).join(", ")}` : "no eligible classified diseases"}.</p><p>${escapeHtml(followup
          + " Unclassified illness records and completed curses require GM review.")}</p></div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
    if (!report) throw new Error("Disease cure report was not confirmed.");
    return { cured, execution: { committed } };
  } catch (error) {
    error.committed ||= committed;
    throw error;
  }
}

async function _handleStabilize(caster) {
  const stabilizeFn = game?.uesrpg?.wounds?.stabilize;
  if (typeof stabilizeFn !== "function") {
    ui.notifications?.warn?.("Wounds stabilize API is unavailable.");
    return;
  }
  const targets = _getTargetActors(caster);
  const lines = [];

  for (const actor of targets) {
    try {
      const result = await stabilizeFn(actor);
      lines.push(`${actor.name}: stabilized ${Number(result?.stabilizedWounds ?? 0)} wound(s).`);
    } catch (err) {
      lines.push(`${actor.name}: failed (${err?.message ?? err}).`);
    }
  }

  if (lines.length) {
    await ChatMessage.create({
      content: `<div class="uesrpg"><h3>Stabilize</h3><p>${lines.join("</p><p>")}</p></div>`,
      speaker: ChatMessage.getSpeaker({ actor: caster }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  }
}

async function _onCastResolved(payload = {}) {
  if (!payload?.success) return;
  const spell = payload?.spell;
  const caster = payload?.caster;
  if (!spell || !caster) return;

  const utilityKind = _norm(spell?.flags?.[_FLAG_NS]?.chapter6Utility?.kind);
  const spellName = _norm(spell?.name);
  _debug("Utility spell cast resolved", { caster: caster.name, spell: spell.name, utilityKind });

  if (hasCoreCompendiumSource(spell, { type: "spell", packId: "uesrpg-3ev4.spells-revised", itemId: "cfGyj96X5k05drsE", rule: "Cure Paralysis" })) {
    ui.notifications?.warn?.("Cure Paralysis is manual: the GM should confirm one recipient within 1 meter, review the source of Paralyzed, and remove the condition. No condition was removed automatically; inspect any paid costs before repeating the cast.");
    return;
  }
  if (hasCoreCompendiumSource(spell, { type: "spell", packId: "uesrpg-3ev4.spells-revised", itemId: "5FBgbEktn8l9Ue0E", rule: "Stabilize" })) {
    ui.notifications?.warn?.("Stabilize is manual: to stabilize, the GM should confirm one dying recipient within 1 meter and stop their death tests. First aid is separate; an Ayleid's Flesh Shaper wound treatment also requires GM resolution. No automatic stabilization was applied; inspect any paid costs before repeating the cast.");
    return;
  }
  if (utilityKind === "recall" || _isSpell(spell, ["Recall"])) return _handleRecall(caster, spell);
  if (utilityKind === "detect" || _isDetectSpell(spell)) return _handleDetect(caster, spell);
  if (utilityKind === "telepathy" || _isSpell(spell, ["Telepathy"])) return _handleTelepathy(caster, spell);
  if (utilityKind === "open" || _isSpell(spell, ["Open"])) return _handleOpen(caster, spell);
  // Disease cures run in the confirmed chat outcome, never in this observational hook.
  if (utilityKind === "stabilize" || spellName === "stabilize") return _handleStabilize(caster);
}

export function initializeUtilitySpellsService() {
  if (_initialized) return;
  _initialized = true;
  Hooks.on("uesrpg.spell.castResolved", _onCastResolved);
  _debug("Utility spells service initialized");
}
