import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { buildEncumbranceBreakdown } from "../../../../core/actors/rules/item-aggregation.js";

function _toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _escapeHtml(value) {
  return foundry?.utils?.escapeHTML?.(String(value ?? "")) ?? String(value ?? "");
}

function _getVisibleBucketItems(sheetContextActorBuckets) {
  const actorBuckets = sheetContextActorBuckets ?? {};
  const out = [];

  const pushArray = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) out.push(item);
  };

  pushArray(actorBuckets.container);

  for (const key of ["weapon", "armor", "ammunition", "gear"]) {
    const bucket = actorBuckets[key];
    if (!bucket) continue;
    pushArray(bucket.equipped);
    pushArray(bucket.unequipped);
  }

  return out;
}

export function annotateEncumbranceHighlights(sheetContextActorBuckets, breakdown, { topN = 5 } = {}) {
  const visibleItems = _getVisibleBucketItems(sheetContextActorBuckets);
  const byId = new Map();
  for (const item of visibleItems) {
    const id = String(item?._id ?? item?.id ?? "").trim();
    if (id) byId.set(id, item);
  }

  for (const item of visibleItems) {
    item._encContrib = 0;
    item._encIsTopContributor = false;
  }

  const rows = Array.isArray(breakdown?.rows) ? breakdown.rows : [];
  const candidates = [];
  for (const row of rows) {
    const itemId = String(row?.itemId ?? "").trim();
    if (!itemId || !byId.has(itemId)) continue;
    const countedContrib = _toFiniteNumber(row?.contributedEnc, 0);
    const item = byId.get(itemId);
    item._encContrib = countedContrib;
    candidates.push({ itemId, contrib: countedContrib });
  }

  const maxTop = Math.max(0, Math.floor(Number(topN) || 0));
  if (maxTop <= 0) return;

  const topIds = candidates
    .filter((c) => c.contrib > 0)
    .sort((a, b) => b.contrib - a.contrib)
    .slice(0, maxTop)
    .map((c) => c.itemId);

  const topIdSet = new Set(topIds);
  for (const item of visibleItems) {
    const id = String(item?._id ?? item?.id ?? "").trim();
    item._encIsTopContributor = topIdSet.has(id);
  }
}

export async function openEncumbranceBreakdownDialog(actor) {
  const breakdown = buildEncumbranceBreakdown(actor);
  const rows = Array.isArray(breakdown?.rows) ? breakdown.rows : [];
  const totals = breakdown?.totals ?? {};

  const bodyRows = rows
    .slice()
    .sort((a, b) => _toFiniteNumber(b?.contributedEnc, 0) - _toFiniteNumber(a?.contributedEnc, 0))
    .map((row) => {
      const countable = _toFiniteNumber(row?.contributedEnc, 0);
      const flags = [];
      if (row?.isContained) flags.push("Contained");
      if (row?.isWornArmor) flags.push("Worn Armor");
      if (row?.isShield) flags.push("Shield");
      return `<tr>
        <td>${_escapeHtml(row?.name ?? "")}</td>
        <td>${_escapeHtml(row?.type ?? "")}</td>
        <td class="num">${_toFiniteNumber(row?.qty, 0)}</td>
        <td class="num">${_toFiniteNumber(row?.enc, 0).toFixed(1)}</td>
        <td class="num">${_toFiniteNumber(row?.contributedEnc, 0).toFixed(1)}</td>
        <td class="num">${countable.toFixed(1)}</td>
        <td>${_escapeHtml(flags.join(", "))}</td>
      </tr>`;
    })
    .join("");

  const countedTotal = _toFiniteNumber(totals?.totalEnc, 0);
  const content = `<div class="uesrpg-enc-breakdown">
    <div class="hint">ENC contribution breakdown for ${_escapeHtml(actor?.name ?? "Actor")}.</div>
    <div class="uesrpg-enc-breakdown__table-wrap">
      <table class="uesrpg-enc-breakdown__table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Type</th>
            <th>Qty</th>
            <th>ENC</th>
            <th>Effective ENC</th>
            <th>Counted ENC</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>${bodyRows || '<tr><td colspan="7">No items.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="uesrpg-enc-breakdown__totals">
      <div><strong>Total Effective ENC:</strong> ${_toFiniteNumber(totals?.totalEnc, 0).toFixed(1)}</div>
      <div><strong>Excluded ENC:</strong> ${_toFiniteNumber(totals?.excludedEnc, 0).toFixed(1)}</div>
      <div><strong>Counted ENC:</strong> ${countedTotal.toFixed(1)}</div>
      <div><strong>Worn Armor ENC (Raw):</strong> ${_toFiniteNumber(totals?.armorEncRaw, 0).toFixed(1)}</div>
      <div><strong>Zero-ENC Item Count:</strong> ${_toFiniteNumber(totals?.zeroEncItemCount, 0)}</div>
      <div><strong>Zero-ENC Effective ENC:</strong> ${_toFiniteNumber(totals?.zeroEncEffectiveEnc, 0).toFixed(1)}</div>
    </div>
  </div>`;

  return customDialog({
    title: "Encumbrance Breakdown",
    content,
    classes: ["uesrpg-enc-breakdown-dialog"],
    width: 840,
    buttons: {
      close: {
        label: "Close",
        icon: "fas fa-check",
        callback: () => true,
      },
    },
    defaultButton: "close",
  });
}
