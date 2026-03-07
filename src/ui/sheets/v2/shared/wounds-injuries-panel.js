import { requestDeleteEmbeddedDocuments } from "../../../../utils/authority-proxy.js";
import { canonicalizeShockKind, isShockKind } from "../../../../core/wounds/wound-schema.js";

const FLAG_SCOPE = "uesrpg-3ev4";

const LOST_KINDS = new Set(["shockLostLimb", "shockLostEye", "shockLostEar"]);
const WOUND_EFFECT_KINDS = new Set(["wound", "bloodLoss", "forestall", "firstAid"]);

function _readWoundsFlag(effect) {
  if (!effect) return null;
  const getFlag = typeof effect.getFlag === "function" ? effect.getFlag.bind(effect) : null;
  if (!getFlag) return null;
  return getFlag(FLAG_SCOPE, "wounds") ?? null;
}

function _inferHitLocation(name) {
  const raw = String(name ?? "");
  const match = raw.match(/\(([^)]+)\)\s*$/);
  if (!match?.[1]) return "";
  return String(match[1]).trim();
}

function _normalizeKind(kind) {
  const raw = String(kind ?? "").trim();
  if (!raw) return "";
  return canonicalizeShockKind(raw);
}

function _chip(type, label, tone = "neutral") {
  return { type, label, tone };
}

function _buildWoundRecord(effect, wf) {
  const progress = Math.max(0, Number(wf?.progress ?? 0) || 0);
  return {
    id: String(effect?.id ?? ""),
    hitLocation: String(wf?.hitLocation ?? "Body"),
    damage: Number(wf?.damage ?? 0) || 0,
    progress,
    treated: wf?.treated === true,
    shockResolved: wf?.shockResolved === true,
    shockPassed: wf?.shockPassed === true,
    createdAt: Number(wf?.createdAt ?? 0) || null,
    treatedAt: Number(wf?.treatedAt ?? 0) || null,
    maimed: wf?.maimed === true,
    applicationId: String(wf?.applicationId ?? ""),
    canEditProgress: Boolean(game?.user?.isGM),
    progressInputValue: progress
  };
}

function _buildInjuryRecord(effect, wf, kind) {
  const hitLocation = String(wf?.hitLocation ?? "").trim()
    || _inferHitLocation(effect?.name)
    || "-";
  return {
    id: String(effect?.id ?? ""),
    kind,
    name: String(effect?.name ?? (kind || "Marker")),
    hitLocation,
    applicationId: String(wf?.applicationId ?? ""),
    permanent: wf?.permanent === true || wf?.maimed === true,
  };
}

function _kindChip(kind, injury) {
  if (kind === "shockCripple" || kind === "shockCrippledLimb") return _chip("crippled", "Crippled", injury.permanent ? "danger" : "warn");
  if (kind === "shockCrippleBody") return _chip("crippled-body", injury.permanent ? "Maimed Body" : "Crippled Body", injury.permanent ? "danger" : "warn");
  if (kind === "shockLostLimb") return _chip("lost-limb", "Lost Limb", "danger");
  if (kind === "shockLostEye") return _chip("lost-eye", "Lost Eye", "danger");
  if (kind === "shockLostEar") return _chip("lost-ear", "Lost Ear", "danger");
  if (kind === "shockStunned") return _chip("stunned", "Stunned", "warn");
  return _chip(kind, injury.name, "neutral");
}

function _rowSort(a, b) {
  const ta = Number(a?.wound?.createdAt ?? 0) || 0;
  const tb = Number(b?.wound?.createdAt ?? 0) || 0;
  if (ta !== tb) return tb - ta;
  return String(a?.applicationId ?? "").localeCompare(String(b?.applicationId ?? ""));
}

function _pushGlobalChip(rowsByApp, type, label, tone = "neutral") {
  const key = "__global__";
  if (!rowsByApp.has(key)) {
    rowsByApp.set(key, {
      rowType: "synthetic",
      applicationId: "",
      hitLocation: "Global",
      wound: null,
      injuries: [],
      chips: [],
      actions: [],
      syntheticKey: key,
    });
  }
  rowsByApp.get(key).chips.push(_chip(type, label, tone));
}

function _finalizeRow(row, { isGM = false } = {}) {
  const chips = [];
  const actions = [];

  if (row?.wound) {
    const w = row.wound;
    const shockLabel = !w.shockResolved
      ? "Shock Pending"
      : (w.shockPassed === false ? "Shock Failed" : "Shock Passed");
    const shockTone = !w.shockResolved
      ? "warn"
      : (w.shockPassed === false ? "danger" : "ok");
    chips.push(_chip("shock", shockLabel, shockTone));
    if (w.maimed) chips.push(_chip("maimed", "Maimed", "danger"));
    else chips.push(_chip(w.treated ? "treated" : "untreated", w.treated ? "Treated" : "Untreated", w.treated ? "ok" : "warn"));

    actions.push({ type: "treat", label: "Treat", wiAction: "treatWound", effectId: w.id, disabled: w.treated === true, gmOnly: false });
    actions.push({ type: "remove-wound", label: "Remove", wiAction: "removeWound", effectId: w.id, disabled: false, gmOnly: false });
  }

  for (const injury of row.injuries) {
    chips.push(_kindChip(injury.kind, injury));
    if (row?.wound) continue;
    const gmOnly = LOST_KINDS.has(injury.kind);
    actions.push({
      type: "remove-marker",
      label: "Remove",
      wiAction: "removeMarker",
      effectId: injury.id,
      disabled: gmOnly && !isGM,
      gmOnly,
      title: gmOnly && !isGM ? "GM only" : "",
    });
  }

  row.chips = chips;
  row.actions = actions;
  return row;
}

export function buildWoundsInjuriesPanelContext(actor, { enabled } = {}) {
  const isEnabled = Boolean(enabled);
  const panel = {
    enabled: isEnabled,
    rows: [],
    hasRows: false,
  };
  if (!isEnabled || !actor?.effects?.contents?.length) return panel;

  const rowsByApp = new Map();
  const syntheticByKey = new Map();

  for (const effect of actor.effects.contents) {
    const wf = _readWoundsFlag(effect);
    if (!wf) continue;
    const rawKind = String(wf?.kind ?? "").trim();
    if (!rawKind) continue;

    if (rawKind === "wound") {
      const record = _buildWoundRecord(effect, wf);
      const appId = String(record.applicationId || record.id);
      const existing = rowsByApp.get(appId) ?? {
        rowType: "wound",
        applicationId: appId,
        hitLocation: record.hitLocation,
        wound: null,
        injuries: [],
        chips: [],
        actions: [],
      };
      existing.wound = record;
      existing.hitLocation = record.hitLocation || existing.hitLocation || "Body";
      rowsByApp.set(appId, existing);
      continue;
    }

    if (rawKind === "bloodLoss") {
      _pushGlobalChip(rowsByApp, "blood-loss", "Blood Loss", "danger");
      continue;
    }
    if (rawKind === "forestall") {
      _pushGlobalChip(rowsByApp, "forestall", "Forestall", "ok");
      continue;
    }
    if (rawKind === "firstAid") {
      _pushGlobalChip(rowsByApp, "first-aid", "First Aid", "ok");
      continue;
    }

    const kind = _normalizeKind(rawKind);
    if (!kind || !isShockKind(kind)) continue;

    const injury = _buildInjuryRecord(effect, wf, kind);
    const appId = String(injury.applicationId ?? "").trim();
    if (appId) {
      const existing = rowsByApp.get(appId) ?? {
        rowType: "wound",
        applicationId: appId,
        hitLocation: injury.hitLocation || "-",
        wound: null,
        injuries: [],
        chips: [],
        actions: [],
      };
      existing.injuries.push(injury);
      if (!existing.hitLocation || existing.hitLocation === "-") existing.hitLocation = injury.hitLocation;
      rowsByApp.set(appId, existing);
      continue;
    }

    const syntheticKey = `${injury.hitLocation}|${kind}`;
    const row = syntheticByKey.get(syntheticKey) ?? {
      rowType: "synthetic",
      syntheticKey,
      applicationId: "",
      hitLocation: injury.hitLocation || "-",
      wound: null,
      injuries: [],
      chips: [],
      actions: [],
    };
    row.injuries.push(injury);
    syntheticByKey.set(syntheticKey, row);
  }

  const rows = [];
  for (const row of rowsByApp.values()) rows.push(_finalizeRow(row, { isGM: Boolean(game?.user?.isGM) }));
  for (const row of syntheticByKey.values()) rows.push(_finalizeRow(row, { isGM: Boolean(game?.user?.isGM) }));

  rows.sort(_rowSort);

  panel.rows = rows;
  panel.hasRows = rows.length > 0;
  return panel;
}

export function isWoundsOrShockEffect(effect) {
  const wf = _readWoundsFlag(effect);
  const rawKind = String(wf?.kind ?? "").trim();
  if (!rawKind) return false;
  if (WOUND_EFFECT_KINDS.has(rawKind)) return true;
  return isShockKind(rawKind);
}

export async function onWoundsInjuriesControl(event, target) {
  event?.preventDefault?.();

  const action = String(target?.dataset?.wiAction ?? "").trim();
  const effectId = String(target?.dataset?.effectId ?? "").trim();
  if (!action || !effectId) return;

  const actor = this?.document;
  if (!actor) return;

  const isOwner = Boolean(actor?.isOwner);
  const isGM = Boolean(game?.user?.isGM);
  if (!isOwner && !isGM) {
    ui.notifications?.warn?.("You do not have permission to manage this actor's wounds or injuries.");
    return;
  }

  if (action === "treatWound") {
    const attempt = game?.uesrpg?.wounds?.attemptTreatWound;
    if (typeof attempt === "function") {
      const result = await attempt(actor, effectId, {});
      if (result?.ok === false) {
        if (result?.suppressUiWarning === true) return;
        const reasonText = String(result?.reasonText ?? "").trim();
        if (reasonText) {
          ui.notifications?.warn?.(reasonText);
        } else {
          const reason = String(result?.reason ?? "").trim();
          const fallbackByReason = {
            invalidWound: "Invalid wound target.",
            missingKit: "Missing healer's kit/supplies.",
            invalidTestTarget: "No valid Profession[Medicine] / Survival test target.",
            longRestLimit: "This cripple-related wound can only be treated once per long rest.",
            failedTest: "Treat Wound test failed.",
            dramaticFailure: "Dramatic failure: body part immediately maimed."
          };
          const msg = fallbackByReason[reason] ?? "Treat Wound failed.";
          ui.notifications?.warn?.(msg);
        }
      }
      return;
    }
    const fn = game?.uesrpg?.wounds?.treatWound;
    if (typeof fn === "function") await fn(actor, effectId);
    return;
  }

  if (action === "setProgress") {
    if (!isGM) {
      ui.notifications?.warn?.("Only the GM can edit wound progress.");
      return;
    }
    const rowEl = target?.closest?.("tr") ?? null;
    const input = target?.matches?.("input[data-wi-action='setProgress'][data-wi-progress-input]")
      ? target
      : (rowEl?.querySelector?.(`[data-wi-progress-input="${effectId}"]`) ?? null);
    const next = Math.max(0, Number.parseInt(String(input?.value ?? "0"), 10) || 0);
    const fn = game?.uesrpg?.wounds?.setWoundProgress;
    if (typeof fn === "function") {
      const result = await fn(actor, effectId, next, { by: game?.user?.id ?? "gm", reason: "panel-edit" });
      if (result?.ok === false) ui.notifications?.warn?.("Failed to set wound progress.");
    }
    return;
  }

  if (action === "setDamage") {
    if (!isGM) {
      ui.notifications?.warn?.("Only the GM can edit wound damage.");
      return;
    }
    const rowEl = target?.closest?.("tr") ?? null;
    const input = target?.matches?.("input[data-wi-action='setDamage'][data-wi-damage-input]")
      ? target
      : (rowEl?.querySelector?.(`[data-wi-damage-input="${effectId}"]`) ?? null);
    const next = Math.max(0, Number.parseInt(String(input?.value ?? "0"), 10) || 0);
    const fn = game?.uesrpg?.wounds?.setWoundDamage;
    if (typeof fn === "function") {
      const result = await fn(actor, effectId, next, { by: game?.user?.id ?? "gm", reason: "panel-edit" });
      if (result?.ok === false) ui.notifications?.warn?.("Failed to set wound damage.");
    }
    return;
  }

  if (action === "removeWound" || action === "clearWound") {
    const fn = game?.uesrpg?.wounds?.clearWound;
    if (typeof fn === "function") await fn(actor, effectId);
    return;
  }

  if (action !== "removeMarker") return;

  const effect = actor.effects?.get?.(effectId) ?? null;
  if (!effect) return;

  const wf = _readWoundsFlag(effect);
  const kind = _normalizeKind(wf?.kind);
  if (!kind) return;

  if (kind.startsWith("shockLost") && !isGM) {
    ui.notifications?.warn?.("Only the GM can remove lost injury markers.");
    return;
  }

  await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [effectId]);
}
