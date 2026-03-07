import { hasTalent } from "../../core/traits/talents-api.js";
import { isWithinMeleeRange } from "../../core/traits/combat-proximity.js";
import { ActionEconomy } from "../../core/combat/action-economy.js";
import { requestUpdateDocument } from "../authority-proxy.js";
import { confirmDialog, customDialog } from "../dialog-v2-helper.js";

function _asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _escapeHtml(str) {
  const s = String(str ?? "");
  try {
    return foundry.utils.escapeHTML(s);
  } catch (_e) {
    return s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}

function _isHiddenOrNeutral(token) {
  const disp = token?.document?.disposition;
  const hidden = token?.document?.hidden === true;
  return hidden || disp === 0;
}

function _collectDefenderCandidates(defenderToken, { rangeMeters = 2 } = {}) {
  if (!defenderToken || !canvas?.tokens?.placeables) return [];

  const disp = defenderToken?.document?.disposition;
  if (disp == null || disp === 0) return [];

  const out = [];
  for (const t of canvas.tokens.placeables) {
    if (!t || t.id === defenderToken.id) continue;
    if (_isHiddenOrNeutral(t)) continue;
    if (t.document?.disposition !== disp) continue;
    if (!t.actor) continue;
    if (!hasTalent(t.actor, "defender")) continue;
    if (!isWithinMeleeRange(defenderToken, t, rangeMeters)) continue;

    const ap = _asNumber(t.actor.system?.action_points?.value, 0);
    if (ap < 1) continue;
    if (!(game.user?.isGM || t.actor.isOwner === true)) continue;

    out.push({ token: t, actor: t.actor, ap });
  }

  out.sort((a, b) => {
    const an = String(a.actor?.name ?? "");
    const bn = String(b.actor?.name ?? "");
    return an.localeCompare(bn);
  });

  return out;
}

async function _promptDefenderInterceptChoice(defenderToken, candidates) {
  if (!defenderToken || !Array.isArray(candidates) || !candidates.length) return null;

  if (candidates.length === 1) {
    const c = candidates[0];
    const ok = await confirmDialog({
      title: "Defender",
      content: `
        <div class="uesrpg">
          <p><b>${_escapeHtml(c.actor.name)}</b> can intercept this attack on <b>${_escapeHtml(defenderToken.actor?.name ?? defenderToken.name)}</b>.</p>
          <p>Cost: <b>1 AP</b>. After intercepting: <b>Block/Parry/Counter</b> for <b>0 AP</b>.</p>
        </div>
      `,
      yesLabel: "Intercept (1 AP)",
      noLabel: "Do Not Intercept",
      yesIcon: "fas fa-shield-alt",
      noIcon: "fas fa-times",
      rejectClose: false,
    });
    return ok ? c : null;
  }

  const options = candidates
    .map((c, idx) => `<option value="${idx}">${_escapeHtml(`${c.actor.name} (${c.ap} AP)`)}</option>`)
    .join("");

  const pickedIdx = await customDialog({
    title: "Defender",
    content: `
      <div class="uesrpg">
        <p>Select which ally intercepts the attack on <b>${_escapeHtml(defenderToken.actor?.name ?? defenderToken.name)}</b>.</p>
        <p>Cost: <b>1 AP</b>. After intercepting: <b>Block/Parry/Counter</b> for <b>0 AP</b>.</p>
        <div style="margin-top:8px;">
          <label style="display:block; font-weight:600; margin-bottom:4px;">Interceptor</label>
          <select name="ues-defender-interceptor" style="width:100%;">${options}</select>
        </div>
      </div>
    `,
    buttons: {
      yes: {
        label: "Intercept (1 AP)",
        icon: "fas fa-shield-alt",
        callback: (html) => {
          const el = html instanceof HTMLElement ? html : html?.[0];
          const v = el?.querySelector?.('select[name="ues-defender-interceptor"]')?.value;
          const idx = Number(v);
          return Number.isFinite(idx) ? idx : 0;
        }
      },
      no: { label: "Do Not Intercept", icon: "fas fa-times", callback: () => null }
    },
    default: "no",
    rejectClose: false,
  });

  if (pickedIdx == null) return null;
  const idx = Math.max(0, Math.min(candidates.length - 1, Number(pickedIdx)));
  return candidates[idx] ?? null;
}

async function _swapTokenPositions(tokenA, tokenB) {
  if (!tokenA?.document || !tokenB?.document) return false;
  const aPos = { x: _asNumber(tokenA.document.x, 0), y: _asNumber(tokenA.document.y, 0) };
  const bPos = { x: _asNumber(tokenB.document.x, 0), y: _asNumber(tokenB.document.y, 0) };

  const ok1 = await requestUpdateDocument(tokenA.document, { x: bPos.x, y: bPos.y });
  if (!ok1) return false;

  const ok2 = await requestUpdateDocument(tokenB.document, { x: aPos.x, y: aPos.y });
  if (!ok2) {
    try {
      await requestUpdateDocument(tokenA.document, { x: aPos.x, y: aPos.y });
    } catch (_e) {
      // no-op
    }
    return false;
  }

  return true;
}

export async function maybeApplyDefenderIntercept({ data, defenderData, defenderToken, options = {} } = {}) {
  try {
    if (!data || !defenderData || !defenderToken) return false;
    if (defenderData?.defenderIntercept?.applied === true) return false;

    const candidates = _collectDefenderCandidates(defenderToken, { rangeMeters: _asNumber(options?.rangeMeters, 2) });
    if (!candidates.length) return false;

    const picked = await _promptDefenderInterceptChoice(defenderToken, candidates);
    if (!picked) return false;

    const paid = await ActionEconomy.spendAP(picked.actor, 1, { reason: "reaction:defender-intercept", silent: true });
    if (!paid) {
      ui.notifications?.warn?.(`${picked.actor.name} does not have enough Action Points to intercept.`);
      return false;
    }

    const swapped = await _swapTokenPositions(defenderToken, picked.token);
    if (!swapped) {
      ui.notifications?.warn?.("Failed to swap token positions for Defender intercept.");
      return false;
    }

    const original = {
      actorUuid: defenderData.actorUuid ?? defenderToken.actor?.uuid ?? null,
      tokenUuid: defenderData.tokenUuid ?? defenderToken.document?.uuid ?? null,
      name: defenderToken.actor?.name ?? defenderToken.name
    };
    const interceptor = {
      actorUuid: picked.actor.uuid,
      tokenUuid: picked.token.document.uuid,
      name: picked.actor.name
    };

    defenderData.actorUuid = interceptor.actorUuid;
    defenderData.tokenUuid = interceptor.tokenUuid;
    defenderData.defenderIntercept = {
      applied: true,
      original,
      interceptor,
      freeDefense: true,
      allowedDefenseTypes: ["block", "parry", "counter"],
      appliedAt: Date.now()
    };

    data.context = data.context ?? {};
    data.context.defenderIntercept = Array.isArray(data.context.defenderIntercept) ? data.context.defenderIntercept : [];
    data.context.defenderIntercept.push({
      defenderOriginalActorUuid: original.actorUuid,
      interceptorActorUuid: interceptor.actorUuid,
      at: Date.now()
    });

    return true;
  } catch (err) {
    console.warn("UESRPG | maybeApplyDefenderIntercept failed", err);
    return false;
  }
}
