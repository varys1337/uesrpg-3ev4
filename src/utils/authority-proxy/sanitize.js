import { channelSystemId } from "./shared.js";

function deepClonePlain(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (_e) {
    try {
      return structuredClone(obj);
    } catch (_e2) {
      return obj;
    }
  }
}

export function sanitizeChatMessageUpdatePayload(payload) {
  if (!payload || typeof payload !== "object") return {};

  const sysId = channelSystemId();
  const out = {};

  if (typeof payload.content === "string") out.content = payload.content;

  const flags = payload.flags;
  const sysFlags = (flags && typeof flags === "object") ? flags[sysId] : null;
  if (sysFlags && typeof sysFlags === "object") {
    const cleanedSysFlags = {};
    if (Object.prototype.hasOwnProperty.call(sysFlags, "opposed")) cleanedSysFlags.opposed = deepClonePlain(sysFlags.opposed);
    if (Object.prototype.hasOwnProperty.call(sysFlags, "skillOpposed")) cleanedSysFlags.skillOpposed = deepClonePlain(sysFlags.skillOpposed);
    if (Object.prototype.hasOwnProperty.call(sysFlags, "magicOpposed")) cleanedSysFlags.magicOpposed = deepClonePlain(sysFlags.magicOpposed);
    if (Object.prototype.hasOwnProperty.call(sysFlags, "charOpposed")) cleanedSysFlags.charOpposed = deepClonePlain(sysFlags.charOpposed);
    if (Object.prototype.hasOwnProperty.call(sysFlags, "warfareClash")) cleanedSysFlags.warfareClash = deepClonePlain(sysFlags.warfareClash);
    if (Object.keys(cleanedSysFlags).length > 0) out.flags = { [sysId]: cleanedSysFlags };
  }

  return out;
}

export function isChatMessageUpdateFresh(message, payload) {
  try {
    const sysId = channelSystemId();
    const incoming = payload?.flags?.[sysId] ?? null;
    if (!incoming || typeof incoming !== "object") return true;

    const current = message?.flags?.[sysId] ?? null;
    if (!current || typeof current !== "object") return true;

    const lanes = [];
    if (Object.prototype.hasOwnProperty.call(incoming, "opposed")) lanes.push("opposed");
    if (Object.prototype.hasOwnProperty.call(incoming, "skillOpposed")) lanes.push("skillOpposed");
    if (Object.prototype.hasOwnProperty.call(incoming, "magicOpposed")) lanes.push("magicOpposed");
    if (Object.prototype.hasOwnProperty.call(incoming, "charOpposed")) lanes.push("charOpposed");
    if (Object.prototype.hasOwnProperty.call(incoming, "warfareClash")) lanes.push("warfareClash");
    if (lanes.length === 0) return true;

    const extract = (obj, lane) => {
      if (lane === "opposed") {
        return {
          ts: Number(obj?.opposed?.context?.updatedAt ?? 0),
          seq: Number(obj?.opposed?.context?.updatedSeq ?? 0)
        };
      }
      if (lane === "skillOpposed") {
        return {
          ts: Number(obj?.skillOpposed?.state?.context?.updatedAt ?? 0),
          seq: Number(obj?.skillOpposed?.state?.context?.updatedSeq ?? 0)
        };
      }
      if (lane === "magicOpposed") {
        return {
          ts: Number(obj?.magicOpposed?.state?.context?.updatedAt ?? 0),
          seq: Number(obj?.magicOpposed?.state?.context?.updatedSeq ?? 0)
        };
      }
      if (lane === "charOpposed") {
        return {
          ts: Number(obj?.charOpposed?.state?.context?.updatedAt ?? 0),
          seq: Number(obj?.charOpposed?.state?.context?.updatedSeq ?? 0)
        };
      }
      return { ts: 0, seq: 0 };
    };

    const incSeq = Math.max(...lanes.map(l => extract(incoming, l).seq));
    const curSeq = Math.max(...lanes.map(l => extract(current, l).seq));

    if (incSeq && curSeq) {
      if (incSeq < curSeq) return false;
      if (incSeq > curSeq) return true;
    }

    const incTs = Math.max(...lanes.map(l => extract(incoming, l).ts));
    const curTs = Math.max(...lanes.map(l => extract(current, l).ts));
    if (!incTs || !curTs) return true;
    return incTs >= curTs;
  } catch (_e) {
    return true;
  }
}

export function sanitizeGenericUpdatePayload(doc, payload) {
  if (!payload || typeof payload !== "object") return {};

  const docName = doc?.documentName ?? "";
  const out = {};
  const allowTopLevel = new Set(["system", "flags", "name", "img", "icon"]);

  if (docName === "Token") {
    const allowedTokenKeys = new Set(["x", "y", "overlayEffect", "statuses", "effects"]);
    for (const [k, v] of Object.entries(payload)) {
      if (allowedTokenKeys.has(k)) {
        out[k] = deepClonePlain(v);
        continue;
      }
      if (k === "flags" && v && typeof v === "object") {
        out.flags = deepClonePlain(v);
        continue;
      }
      if (k.startsWith("flags.")) out[k] = deepClonePlain(v);
    }
    return out;
  }

  if (docName === "Combatant") {
    const allowedCombatantKeys = new Set(["defeated", "hidden", "initiative", "flags", "name", "img", "icon"]);
    for (const [k, v] of Object.entries(payload)) {
      if (allowedCombatantKeys.has(k)) {
        if (k === "icon" && payload.img === undefined) out.img = deepClonePlain(v);
        else out[k] = deepClonePlain(v);
        continue;
      }
      if (k.startsWith("flags.")) out[k] = deepClonePlain(v);
    }
    if (out.icon !== undefined) delete out.icon;
    return out;
  }

  if (docName === "ActiveEffect") {
    const allowed = new Set(["changes", "duration", "disabled", "name", "img", "icon", "flags", "statuses", "tint", "origin", "transfer"]);
    for (const [k, v] of Object.entries(payload)) {
      if (allowed.has(k)) {
        if (k === "icon" && payload.img === undefined) out.img = deepClonePlain(v);
        else out[k] = deepClonePlain(v);
        continue;
      }
      if (k.startsWith("flags.") || k.startsWith("duration.")) {
        out[k] = deepClonePlain(v);
      }
    }
    if (out.icon !== undefined) delete out.icon;
    return out;
  }

  for (const [k, v] of Object.entries(payload)) {
    if (allowTopLevel.has(k)) {
      if (k === "icon" && payload.img === undefined) out.img = deepClonePlain(v);
      else out[k] = deepClonePlain(v);
      continue;
    }

    if (k.startsWith("system.") || k.startsWith("flags.")) {
      out[k] = deepClonePlain(v);
    }
  }

  if (out.icon !== undefined) delete out.icon;
  return out;
}

export function sanitizeEmbeddedDocData(embeddedName, data) {
  if (!data || typeof data !== "object") return null;

  if (embeddedName === "ActiveEffect") {
    const allowed = new Set(["name", "img", "icon", "origin", "disabled", "duration", "changes", "flags", "statuses", "tint", "transfer"]);
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (!allowed.has(k) && !k.startsWith("flags.") && !k.startsWith("duration.")) continue;
      if (k === "icon") {
        if (out.img === undefined && data.img === undefined) out.img = deepClonePlain(v);
        continue;
      }
      out[k] = deepClonePlain(v);
    }
    return out;
  }

  if (embeddedName === "Item") {
    const allowed = new Set(["name", "img", "type", "system", "flags"]);
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (!allowed.has(k) && !k.startsWith("system.") && !k.startsWith("flags.")) continue;
      out[k] = deepClonePlain(v);
    }
    return out;
  }

  return null;
}

export function sanitizeActorCreateData(actorData) {
  if (!actorData || typeof actorData !== "object") return null;

  const out = {};
  if (typeof actorData.name === "string") out.name = actorData.name.trim() || "New Character";
  if (typeof actorData.type === "string") out.type = actorData.type;
  if (typeof actorData.img === "string") out.img = actorData.img;
  if (actorData.system && typeof actorData.system === "object") out.system = deepClonePlain(actorData.system);
  if (actorData.flags && typeof actorData.flags === "object") out.flags = deepClonePlain(actorData.flags);

  if (!out.name) out.name = "New Character";
  if (!out.type) out.type = "Player Character";

  delete out.ownership;
  delete out.permission;
  delete out.folder;
  delete out.sort;
  delete out._id;

  return out;
}
