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

  const options = targets.map((a) => `<option value="${a.uuid}">${a.name}</option>`).join("");
  const selectedUuid = await customDialog({
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
    content: `<div class="uesrpg"><h3>Open</h3><p><b>${caster.name}</b> attempts to open <b>${result.label}</b>.</p><p>Outcome: <b>${result.result === "opened" ? "Opened" : "Failed"}</b></p></div>`,
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

async function _handleCureDisease(caster, spell) {
  const targets = _getTargetActors(caster);
  let removedTotal = 0;

  for (const actor of targets) {
    const diseased = (actor.effects?.contents ?? []).filter((ef) => {
      const name = _norm(ef?.name);
      const cond = _norm(ef?.flags?.[_FLAG_NS]?.condition?.key);
      return cond === "disease" || name.includes("disease") || name.includes("plague") || name.includes("blight") || name.includes("infect");
    });
    if (!diseased.length) continue;
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", diseased.map((e) => e.id));
    removedTotal += diseased.length;
  }

  ui.notifications?.info?.(`${spell.name}: removed ${removedTotal} disease-related effect(s).`);
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

  if (utilityKind === "recall" || _isSpell(spell, ["Recall"])) return _handleRecall(caster, spell);
  if (utilityKind === "detect" || _isDetectSpell(spell)) return _handleDetect(caster, spell);
  if (utilityKind === "telepathy" || _isSpell(spell, ["Telepathy"])) return _handleTelepathy(caster, spell);
  if (utilityKind === "open" || _isSpell(spell, ["Open"])) return _handleOpen(caster, spell);
  if (utilityKind === "cure-disease" || _isSpell(spell, ["Cure Disease"])) return _handleCureDisease(caster, spell);
  if (utilityKind === "stabilize" || spellName === "stabilize") return _handleStabilize(caster);
}

export function initializeUtilitySpellsService() {
  if (_initialized) return;
  _initialized = true;
  Hooks.on("uesrpg.spell.castResolved", _onCastResolved);
  _debug("Utility spells service initialized");
}
