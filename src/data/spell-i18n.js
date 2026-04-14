import { t } from "../utils/i18n.js";

const SPELL_FORMS_FALLBACK = Object.freeze([
  { key: "touch", label: "Touch", description: "Spell affects a target that must be touched. No range cost modifier.", paramKey: null, paramLabel: null },
  { key: "target", label: "Target", description: "Spell affects a single target at range. Caster makes a Spell test; target may resist.", paramKey: null, paramLabel: null },
  { key: "self", label: "Self", description: "Spell affects the caster only.", paramKey: null, paramLabel: null },
  { key: "area", label: "Area (Z metres)", description: "Spell affects all targets in a Z-metre radius. Cost increases with Z per RAW area table.", paramKey: "Z", paramLabel: "Radius (metres)" },
  { key: "onTarget", label: "On Target", description: "Spell is placed at the caster's chosen point within range rather than on a specific actor.", paramKey: null, paramLabel: null },
]);

function _asKey(value, fallback = "unknown") {
  const raw = String(value ?? "").trim();
  return raw || String(fallback ?? "");
}

function _localizeCatalogRecord(prefix, key, record, fields) {
  const localized = { ...record };
  for (const [field, suffix] of fields) {
    if (!(field in localized)) continue;
    localized[field] = t(`${prefix}.${key}.${suffix}`, localized[field]);
  }
  return localized;
}

export function localizeSpellForm(record) {
  const key = _asKey(record?.key);
  return _localizeCatalogRecord("UESRPG.Spells.Forms", key, record, [
    ["label", "Label"],
    ["description", "Description"],
    ["paramLabel", "ParamLabel"],
  ]);
}

export function getLocalizedSpellFormsCatalog() {
  return SPELL_FORMS_FALLBACK.map((record) => localizeSpellForm(record));
}

export function localizeSpellAttribute(record) {
  const key = _asKey(record?.key);
  return _localizeCatalogRecord("UESRPG.Spells.Attributes", key, record, [
    ["label", "Label"],
    ["description", "Description"],
  ]);
}

export function localizeSpellEffect(record) {
  const key = _asKey(record?.key);
  return _localizeCatalogRecord("UESRPG.Spells.Effects", key, record, [
    ["label", "Label"],
    ["description", "Description"],
  ]);
}

export function localizeStrikeEnchantment(record) {
  const key = _asKey(record?.key);
  const localized = _localizeCatalogRecord("UESRPG.Enchantments.Strike", key, record, [
    ["label", "Label"],
    ["description", "Description"],
  ]);

  if (record?.paramLabels && typeof record.paramLabels === "object" && !Array.isArray(record.paramLabels)) {
    localized.paramLabels = Object.fromEntries(
      Object.entries(record.paramLabels).map(([paramKey, fallbackLabel]) => [
        paramKey,
        t(`UESRPG.Enchantments.Strike.${key}.ParamLabels.${paramKey}`, fallbackLabel),
      ]),
    );
  }

  return localized;
}
