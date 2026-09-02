const ROOT_NAMESPACE = "UESRPG.";

function _hasI18n() {
  return Boolean(game?.i18n);
}

export function isLocalizationKey(value, { prefix = ROOT_NAMESPACE } = {}) {
  return typeof value === "string" && value.startsWith(prefix);
}

export function t(key, fallback = null) {
  const safeKey = String(key ?? "").trim();
  if (!safeKey) return String(fallback ?? "");

  if (!_hasI18n()) return String(fallback ?? safeKey);

  try {
    const localized = game.i18n.localize(safeKey);
    if (localized !== safeKey) return localized;
  } catch (_err) {
    // Ignore and use fallback below.
  }

  return String(fallback ?? safeKey);
}

export function tf(key, data = {}, fallback = null) {
  const safeKey = String(key ?? "").trim();
  if (!safeKey) return String(fallback ?? "");

  if (!_hasI18n()) return String(fallback ?? safeKey);

  try {
    if (typeof game.i18n.has === "function" && !game.i18n.has(safeKey)) {
      return String(fallback ?? safeKey);
    }
    const localized = (typeof game.i18n.format === "function")
      ? game.i18n.format(safeKey, data ?? {})
      : game.i18n.localize(safeKey);
    if (localized !== safeKey) return localized;
  } catch (_err) {
    // Ignore and use fallback below.
  }

  return String(fallback ?? safeKey);
}

export function maybeT(value, fallback = null) {
  const safeValue = String(value ?? "").trim();
  if (!safeValue) return String(fallback ?? "");
  if (!isLocalizationKey(safeValue)) return String(fallback ?? safeValue);
  return t(safeValue, fallback ?? safeValue);
}

export function localizeChoiceObject(source, prefix, { fallbackMap = null } = {}) {
  const out = {};
  const entries = Object.entries(source ?? {});
  for (const [key, value] of entries) {
    const fallback = fallbackMap?.[key] ?? maybeT(value, value);
    out[key] = t(`${prefix}.${key}`, fallback);
  }
  return out;
}

export function localizeChoiceRecords(
  source,
  prefix,
  {
    keyField = "id",
    labelField = "label",
  } = {},
) {
  const rows = Array.isArray(source) ? source : [];
  return rows.map((row) => {
    const key = String(row?.[keyField] ?? "").trim();
    const fallback = maybeT(row?.[labelField], row?.[labelField]);
    return {
      ...row,
      [labelField]: key ? t(`${prefix}.${key}`, fallback) : fallback,
    };
  });
}

export function localizeSettingConfig(group, settingKey, config) {
  const basePath = `UESRPG.Settings.${group}.${settingKey}`;
  const out = { ...config };
  out.name = t(`${basePath}.Name`, config?.name ?? settingKey);
  if (config?.hint != null) out.hint = t(`${basePath}.Hint`, config.hint);
  if (config?.choices && typeof config.choices === "object" && !Array.isArray(config.choices)) {
    out.choices = localizeChoiceObject(config.choices, `${basePath}.Choices`);
  }
  return out;
}

export function localizeMenuConfig(group, menuKey, config) {
  const basePath = `UESRPG.Apps.${group}.${menuKey}`;
  const out = { ...config };
  out.name = t(`${basePath}.Name`, config?.name ?? menuKey);
  if (config?.label != null) out.label = t(`${basePath}.Label`, config.label);
  if (config?.hint != null) out.hint = t(`${basePath}.Hint`, config.hint);
  return out;
}

export function getSettingPresentation(namespace, settingKey, {
  fallbackName = null,
  fallbackHint = "",
  fallbackChoices = null,
} = {}) {
  const registration = game.settings?.settings?.get?.(`${namespace}.${settingKey}`) ?? null;
  return {
    key: settingKey,
    value: game.settings.get(namespace, settingKey),
    name: String(registration?.name ?? fallbackName ?? settingKey),
    hint: String(registration?.hint ?? fallbackHint ?? ""),
    choices: registration?.choices ?? fallbackChoices ?? {},
  };
}
