const BUFFER_SIZE = 500;

const _buf = new Array(BUFFER_SIZE).fill(null);
let _head = 0;
let _total = 0;

export function recordPerfEntry(record) {
  _buf[_head % BUFFER_SIZE] = Object.assign({}, record, { _wallMs: Date.now() });
  _head++;
  _total++;
}

export function readPerfEntries() {
  const count = Math.min(_total, BUFFER_SIZE);
  if (count === 0) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const entry = _buf[(_head - count + i + BUFFER_SIZE) % BUFFER_SIZE];
    if (entry != null) out.push(entry);
  }
  return out;
}

export function resetPerfEntries() {
  _buf.fill(null);
  _head = 0;
  _total = 0;
}

export function summarizePerfEntries(records) {
  const src = records ?? readPerfEntries();

  const byEvent = new Map();
  for (const r of src) {
    if (!r) continue;
    const ev = String(r.event ?? "unknown");
    const dur = Number(r.durationMs ?? 0);
    let arr = byEvent.get(ev);
    if (!arr) {
      arr = [];
      byEvent.set(ev, arr);
    }
    arr.push(dur);
  }

  const result = {};
  for (const [ev, durations] of byEvent) {
    const sorted = durations.slice().sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const p95Idx = Math.min(Math.floor(count * 0.95), count - 1);
    const middle = Math.floor(count / 2);
    const median = count % 2
      ? sorted[middle]
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
    result[ev] = {
      count,
      min: +(sorted[0] ?? 0).toFixed(3),
      median: +median.toFixed(3),
      mean: +(count > 0 ? sum / count : 0).toFixed(3),
      p95: +(count > 0 ? sorted[p95Idx] : 0).toFixed(3),
      max: +(sorted[count - 1] ?? 0).toFixed(3),
    };
  }
  return result;
}

export function summarizeRenderImpact(records, windowMs = 500) {
  const src = (records ?? readPerfEntries()).slice().sort((a, b) => Number(a?._wallMs ?? 0) - Number(b?._wallMs ?? 0));
  const mutationEvents = new Set([
    "authorityProxy.updateDocument",
    "authorityProxy.createEmbedded",
    "authorityProxy.updateEmbedded",
    "authorityProxy.deleteEmbedded",
  ]);
  const boundedWindow = Math.max(50, Math.min(Number(windowMs) || 500, 5000));
  const rows = [];

  for (const [index, entry] of src.entries()) {
    const event = String(entry?.event ?? "");
    if (event === "settings.sheetRefresh") {
      rows.push({
        event,
        reason: entry?.reason ?? null,
        renderCount: Number(entry?.renderCount ?? 0),
        windowMs: 0,
      });
      continue;
    }
    if (!mutationEvents.has(event)) continue;

    const startedAt = Number(entry?._wallMs ?? 0);
    let renderCount = 0;
    const renderedDocuments = new Set();
    for (let cursor = index + 1; cursor < src.length; cursor += 1) {
      const candidate = src[cursor];
      const elapsed = Number(candidate?._wallMs ?? 0) - startedAt;
      if (elapsed > boundedWindow) break;
      if (!String(candidate?.event ?? "").startsWith("sheet.render.") || candidate?.stage !== "_onRender") continue;
      renderCount += 1;
      renderedDocuments.add(String(candidate?.documentId ?? candidate?.actorId ?? "unknown"));
    }
    rows.push({
      event,
      docType: entry?.docType ?? null,
      embeddedName: entry?.embeddedName ?? null,
      renderCount,
      renderedDocumentCount: renderedDocuments.size,
      windowMs: boundedWindow,
    });
  }
  return rows;
}

export function getPerfHelpText(systemId) {
  return (
    "[UESRPG][TimePref] Perf API reference:\n\n" +
    "  game.uesrpg.perf.enabled()           — true when recording is on\n" +
    "  game.uesrpg.perf.reset()             — clear the ring buffer\n" +
    "  game.uesrpg.perf.records()           — dump raw event records (array)\n" +
    "  game.uesrpg.perf.summarize()         — mean/max/p95 per event (console.table)\n" +
    "  game.uesrpg.perf.runBenchmark(n=5)   — N Next Turn advances + summary\n\n" +
    `Enable:   game.settings.set('${systemId}', 'timePerformanceDebug', true)\n` +
    `Disable:  game.settings.set('${systemId}', 'timePerformanceDebug', false)\n\n` +
    "Key event names:\n" +
    "  timeService.emit / timeService.worldTimeUpdate / timeService.combatIntent / timeService.combatTurnChange\n" +
    "  spellTick.dispatch / spellTick.handler\n" +
    "  overtime.ensureIndex / overtime.collect / overtime.process\n" +
    "  turnTicker.endTurnTick / turnTicker.expireEffects / turnTicker.regenPrompts / turnTicker.silencedCheck / turnTicker.round\n" +
    "  combat.startCombat / combat.nextRound / combat.resetAllAP\n" +
    "  authorityProxy.updateDocument / authorityProxy.deleteEmbedded"
  );
}
