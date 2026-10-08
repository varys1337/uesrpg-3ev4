"use strict";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function mergeSeed(target, source) {
  const output = isPlainObject(target) ? cloneValue(target) : {};
  for (const [key, value] of Object.entries(source ?? {})) {
    if (key === "templates") continue;
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergeSeed(output[key], value);
    } else {
      output[key] = cloneValue(value);
    }
  }
  return output;
}

function resolveSeed(documentTemplate, rawSeed, stack = []) {
  if (!isPlainObject(rawSeed)) throw new TypeError("Schema seed must be a plain object.");
  let resolved = {};
  for (const templateName of Array.isArray(rawSeed.templates) ? rawSeed.templates : []) {
    if (stack.includes(templateName)) {
      throw new Error(`Circular template inheritance: ${[...stack, templateName].join(" -> ")}`);
    }
    const templateSeed = documentTemplate?.templates?.[templateName];
    if (!isPlainObject(templateSeed)) throw new Error(`Missing template ${templateName}`);
    resolved = mergeSeed(resolved, resolveSeed(documentTemplate, templateSeed, [...stack, templateName]));
  }
  return mergeSeed(resolved, rawSeed);
}

function buildDocumentSeeds(documentTemplate, documentName) {
  if (!isPlainObject(documentTemplate)) throw new Error(`template.json is missing ${documentName}`);
  const types = Array.isArray(documentTemplate.types) ? documentTemplate.types : [];
  const seeds = {};
  for (const type of types) {
    const rawSeed = documentTemplate[type];
    if (!isPlainObject(rawSeed)) throw new Error(`template.json is missing ${documentName}.${type}`);
    seeds[type] = resolveSeed(documentTemplate, rawSeed, [`${documentName}.${type}`]);
  }
  return seeds;
}

function buildSchemaSeeds(templateJson) {
  return {
    actor: buildDocumentSeeds(templateJson?.Actor, "Actor"),
    item: buildDocumentSeeds(templateJson?.Item, "Item"),
  };
}

function renderGeneratedSchemaSeeds(templateJson) {
  const { actor, item } = buildSchemaSeeds(templateJson);
  return [
    "/**",
    " * AUTO-GENERATED FILE - DO NOT EDIT BY HAND.",
    " * Source: template.json",
    " * Generator: scripts/generate-schema-defaults.js",
    " */",
    "",
    `export const ACTOR_TYPE_MODEL_SEEDS = ${JSON.stringify(actor, null, 2)};`,
    "",
    `export const ITEM_TYPE_MODEL_SEEDS = ${JSON.stringify(item, null, 2)};`,
    "",
  ].join("\n");
}

module.exports = {
  buildSchemaSeeds,
  renderGeneratedSchemaSeeds,
};
