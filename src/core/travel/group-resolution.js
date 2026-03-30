import { customDialog } from "../../utils/dialog-v2-helper.js";

const LAST_GROUP_SCOPE = "uesrpg-3ev4";
const LAST_GROUP_KEY = "travelPlannerLastGroupUuid";

function isGroupActor(actor) {
  return actor?.documentName === "Actor" && String(actor?.type ?? "") === "Group";
}

function canObserveGroup(actor) {
  return isGroupActor(actor) && actor.testUserPermission(game.user, "OBSERVER");
}

async function rememberLastGroupUuid(groupUuid) {
  try {
    await game.user?.setFlag?.(LAST_GROUP_SCOPE, LAST_GROUP_KEY, String(groupUuid || ""));
  } catch (_e) {
    // Non-blocking user preference.
  }
}

async function getRememberedGroupActor() {
  let uuid = "";
  try {
    uuid = String(game.user?.getFlag?.(LAST_GROUP_SCOPE, LAST_GROUP_KEY) ?? "");
  } catch (_e) {
    uuid = "";
  }
  if (!uuid) return null;
  const actor = await fromUuid(uuid);
  if (!canObserveGroup(actor)) return null;
  return actor;
}

async function pickGroupActorDialog(groupActors) {
  const options = groupActors
    .map((a) => `<option value="${a.uuid}">${a.name}</option>`)
    .join("");

  const content = `
    <div class="uesrpg-travel-picker">
      <p>Select the Group actor for the Travel Planner.</p>
      <div class="form-group">
        <select name="groupUuid" style="width:100%;">${options}</select>
      </div>
    </div>
  `;

  const pickedUuid = await customDialog({
    title: "Travel Planner - Select Group",
    content,
    buttons: {
      ok: {
        label: "Open",
        callback: (root) => String(root?.querySelector('select[name="groupUuid"]')?.value ?? ""),
      },
      cancel: { label: "Cancel", callback: () => "" },
    },
    default: "ok",
    width: 420,
  });

  if (!pickedUuid) return null;
  return groupActors.find((a) => String(a.uuid) === String(pickedUuid)) ?? null;
}

function findOpenGroupFromSheets() {
  const windows = Object.values(ui.windows ?? {});
  for (let i = windows.length - 1; i >= 0; i -= 1) {
    const win = windows[i];
    const actor = win?.document ?? win?.actor ?? null;
    if (isGroupActor(actor)) return actor;
  }
  return null;
}

function findOpenTravelPlannerGroupUuid() {
  const windows = Object.values(ui.windows ?? {});
  for (let i = windows.length - 1; i >= 0; i -= 1) {
    const win = windows[i];
    const appId = String(win?.id ?? win?.options?.id ?? "");
    if (appId !== "uesrpg-travel-planner") continue;
    const uuid = String(win?._groupUuid ?? "");
    if (uuid) return uuid;
  }
  return "";
}

export async function resolveGroupActorForTravel(opts = {}) {
  const rememberSelection = opts?.rememberSelection !== false;

  if (opts?.groupUuid) {
    const actor = await fromUuid(String(opts.groupUuid));
    if (canObserveGroup(actor)) {
      if (rememberSelection) await rememberLastGroupUuid(actor.uuid);
      return actor;
    }
  }

  if (opts?.groupId) {
    const actor = game.actors.get(String(opts.groupId));
    if (canObserveGroup(actor)) {
      if (rememberSelection) await rememberLastGroupUuid(actor.uuid);
      return actor;
    }
  }

  if (opts?.reuseOpenWindow !== false) {
    const openPlannerGroupUuid = findOpenTravelPlannerGroupUuid();
    if (openPlannerGroupUuid) {
      const actor = await fromUuid(openPlannerGroupUuid);
      if (canObserveGroup(actor)) {
        if (rememberSelection) await rememberLastGroupUuid(actor.uuid);
        return actor;
      }
    }
  }

  const remembered = rememberSelection ? await getRememberedGroupActor() : null;
  if (remembered) return remembered;

  const controlled = canvas?.tokens?.controlled ?? [];
  if (controlled.length === 1) {
    const actor = controlled[0]?.actor ?? null;
    if (canObserveGroup(actor)) {
      if (rememberSelection) await rememberLastGroupUuid(actor.uuid);
      return actor;
    }
  }

  const openGroup = findOpenGroupFromSheets();
  if (canObserveGroup(openGroup)) {
    if (rememberSelection) await rememberLastGroupUuid(openGroup.uuid);
    return openGroup;
  }

  const userChar = game.user?.character ?? null;
  if (canObserveGroup(userChar)) {
    if (rememberSelection) await rememberLastGroupUuid(userChar.uuid);
    return userChar;
  }

  const groups = game.actors
    .filter((a) => isGroupActor(a) && a.testUserPermission(game.user, "OBSERVER"))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  if (!groups.length) {
    ui.notifications.warn("Travel Planner: no Group actors available.");
    return null;
  }

  const picked = await pickGroupActorDialog(groups);
  if (picked) {
    if (rememberSelection) await rememberLastGroupUuid(picked.uuid);
    return picked;
  }

  if (remembered) return remembered;
  return null;
}
