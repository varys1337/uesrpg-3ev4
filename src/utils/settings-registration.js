import { SYSTEM_ID } from "../core/system/namespace.js";
import { localizeMenuConfig, localizeSettingConfig } from "./i18n.js";

function hasRegisteredSetting(namespace, key) {
  return Boolean(game.settings?.settings?.has?.(`${namespace}.${key}`));
}

export function readSettingIfRegistered(key, fallback = null, { namespace = SYSTEM_ID } = {}) {
  try {
    if (!hasRegisteredSetting(namespace, String(key ?? "").trim())) return fallback;
    return game.settings.get(namespace, key);
  } catch (_error) {
    return fallback;
  }
}

function hasRegisteredMenu(namespace, key) {
  return Boolean(game.settings?.menus?.has?.(`${namespace}.${key}`));
}

export function registerSystemSetting(section, key, config, { namespace = SYSTEM_ID } = {}) {
  if (hasRegisteredSetting(namespace, key)) {
    console.warn(`UESRPG | Settings: duplicate key "${namespace}.${key}" — skipping.`);
    return false;
  }

  game.settings.register(namespace, key, localizeSettingConfig(section, key, config));
  return true;
}

export function createSystemSettingRegistrar(section, { namespace = SYSTEM_ID } = {}) {
  return (key, config) => registerSystemSetting(section, key, config, { namespace });
}

export function registerSystemMenu(key, config, { namespace = SYSTEM_ID, section = "Menus" } = {}) {
  if (hasRegisteredMenu(namespace, key)) return false;

  game.settings.registerMenu(namespace, key, localizeMenuConfig(section, key, config));
  return true;
}
