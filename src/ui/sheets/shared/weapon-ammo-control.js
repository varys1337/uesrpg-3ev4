function _normalizeQuantity(value) {
  const qty = Number(value);
  return Number.isFinite(qty) ? qty : null;
}

export function formatAmmoOptionLabel(ammo, { includeUnequippedHint = false } = {}) {
  const name = String(ammo?.name ?? "(Unnamed)");
  const qty = _normalizeQuantity(ammo?.system?.quantity);
  const qtyLabel = qty === null ? "" : ` (${qty})`;
  const unequippedLabel = includeUnequippedHint && ammo?.system?.equipped !== true ? " [unequipped]" : "";
  return `${name}${qtyLabel}${unequippedLabel}`;
}

function _getActorAmmoItems(actor) {
  const items = actor?.items?.contents ?? actor?.items ?? [];
  return Array.from(items)
    .filter((item) => item?.type === "ammunition");
}

export function buildWeaponAmmoControlState(actor, weapon) {
  const ammoItems = _getActorAmmoItems(actor);
  const currentAmmoId = String(weapon?.system?.ammoId ?? "").trim();
  const currentAmmo = currentAmmoId ? ammoItems.find((ammo) => String(ammo?.id ?? "") === currentAmmoId) ?? null : null;
  const equippedAmmo = ammoItems.filter((ammo) => ammo?.system?.equipped === true);

  const options = [{
    value: "",
    label: "-",
    selected: currentAmmoId === "",
  }];

  for (const ammo of equippedAmmo) {
    options.push({
      value: String(ammo.id),
      label: formatAmmoOptionLabel(ammo),
      selected: String(ammo.id) === currentAmmoId,
    });
  }

  if (currentAmmo && !options.some((option) => option.value === currentAmmoId)) {
    options.push({
      value: currentAmmoId,
      label: formatAmmoOptionLabel(currentAmmo, { includeUnequippedHint: true }),
      selected: true,
    });
  }

  return {
    currentAmmoId,
    currentAmmoLabel: currentAmmo ? formatAmmoOptionLabel(currentAmmo) : "-",
    options,
  };
}
