"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");
const {
  LEGACY_INSTALLED_VERSIONS,
  RELEASE_ARCHIVE_NAME,
  RELEASE_MANIFEST_URL,
  compareStablePackageVersions,
  getReleaseMetadata,
  isFoundryNewerVersion,
  parseReleaseTag,
  requireStablePackageVersion,
} = require("../automation/release-metadata.js");

const ROOT = path.resolve(__dirname, "..");
const SYSTEM_PREFIX = "systems/uesrpg-3ev4/";
const RELEASE_FOLDER_NAME = "uesrpg-3ev4";
const RELEASE_DIRECTORIES = Object.freeze(["fonts", "images", "lang", "packs", "src", "styles", "templates"]);
const RELEASE_FILES = Object.freeze(["system.json", "template.json"]);
const OPTIONAL_RELEASE_FILES = Object.freeze(["CHANGELOG.md", "LICENSE.txt", "README.md"]);
const SOURCE_EXCLUDES = new Set([".agents", ".codex", ".git", "dist", "node_modules", "release"]);
const ARCHIVE_EXCLUDED_PREFIXES = [
  ".agents/",
  ".codex/",
  ".git/",
  ".github/",
  "automation/",
  "dist/",
  "node_modules/",
  "release/",
  "scripts/",
];
const ARCHIVE_EXCLUDED_FILES = new Set([
  "build-release-folder.cmd",
  "package.json",
  "package-lock.json",
  "uesrpg-3ev4.zip",
]);

const errors = [];
const notes = [];

function fail(message) {
  errors.push(String(message));
}

function readJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    fail(`${relativePath} is missing or invalid JSON: ${error.message}`);
    return null;
  }
}

function normalizePackagePath(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "");
}

function sourcePathExists(packagePath) {
  const normalized = normalizePackagePath(packagePath);
  if (!normalized) return false;
  return fs.existsSync(path.join(ROOT, ...normalized.split("/")));
}

function walkFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SOURCE_EXCLUDES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(absolutePath, output);
    else if (entry.isFile()) output.push(absolutePath);
  }
  return output;
}

function walkDirectoryFiles(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walkDirectoryFiles(absolutePath, output);
    else if (entry.isFile()) output.push(absolutePath);
  }
  return output;
}

function isTransientPackPath(absolutePath) {
  const relativePath = normalizePackagePath(path.relative(ROOT, absolutePath));
  if (!relativePath.startsWith("packs/")) return false;
  const name = path.basename(absolutePath);
  return name === "LOCK" || name === "LOG" || name.startsWith("LOG.");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function getTemplateTypeSeed(documentTemplate, type) {
  const typeSeed = documentTemplate?.[type];
  if (!isPlainObject(typeSeed)) return null;
  for (const templateName of Array.isArray(typeSeed.templates) ? typeSeed.templates : []) {
    const templateSeed = documentTemplate?.templates?.[templateName];
    if (!isPlainObject(templateSeed)) {
      fail(`template.json ${type} references missing template ${templateName}`);
    }
  }
  return cloneValue(typeSeed);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function equalData(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function validateGeneratedSeed(documentName, type, documentTemplate, generatedSeed) {
  const directSeed = getTemplateTypeSeed(documentTemplate, type);
  if (!isPlainObject(directSeed) || !isPlainObject(generatedSeed)) {
    fail(`${documentName}.${type} is missing a template or generated seed`);
    return;
  }

  const expectedSeed = {};

  for (const templateName of Array.isArray(directSeed.templates) ? directSeed.templates : []) {
    const templateSeed = documentTemplate?.templates?.[templateName];
    if (!isPlainObject(templateSeed)) continue;

    for (const [key, value] of Object.entries(templateSeed)) {
      expectedSeed[key] = cloneValue(value);
    }
  }

  for (const [key, value] of Object.entries(directSeed)) {
    if (key === "templates") continue;
    expectedSeed[key] = cloneValue(value);
  }

  for (const [key, value] of Object.entries(expectedSeed)) {
    if (!Object.hasOwn(generatedSeed, key) || !equalData(value, generatedSeed[key])) {
      fail(`${documentName}.${type} generated defaults differ from template.json at ${key}`);
    }
  }

  for (const key of Object.keys(generatedSeed)) {
    if (!Object.hasOwn(expectedSeed, key)) {
      fail(`${documentName}.${type} generated defaults contain unexpected field ${key}`);
    }
  }
}

function loadGeneratedSeeds() {
  const relativePath = "src/core/data-models/defaults.generated.js";
  try {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8")
      .replace(/^export\s+const\s+/gm, "const ");
    return vm.runInNewContext(
      `(() => { ${source}\nreturn { ACTOR_TYPE_MODEL_SEEDS, ITEM_TYPE_MODEL_SEEDS }; })()`,
      Object.create(null),
      { filename: relativePath, timeout: 1000 }
    );
  } catch (error) {
    fail(`Could not evaluate generated TypeDataModel seeds: ${error.message}`);
    return null;
  }
}

function hasOwnPath(value, fieldPath) {
  const parts = String(fieldPath ?? "").split(".").filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (!isPlainObject(current) || !Object.hasOwn(current, part)) return false;
    current = current[part];
  }
  return true;
}

function validateSchemaDrift(manifest, template) {
  const generated = loadGeneratedSeeds();
  if (!manifest || !template || !generated) return;

  const configurations = [
    ["Actor", generated.ACTOR_TYPE_MODEL_SEEDS],
    ["Item", generated.ITEM_TYPE_MODEL_SEEDS],
  ];

  for (const [documentName, generatedSeeds] of configurations) {
    const documentTemplate = template?.[documentName];
    const templateTypes = Array.isArray(documentTemplate?.types) ? documentTemplate.types : [];
    const manifestTypes = Object.keys(manifest?.documentTypes?.[documentName] ?? {});
    const generatedTypes = Object.keys(generatedSeeds ?? {});

    for (const [label, types] of [["manifest", manifestTypes], ["generated seeds", generatedTypes]]) {
      const missing = templateTypes.filter((type) => !types.includes(type));
      const extra = types.filter((type) => !templateTypes.includes(type));
      if (missing.length || extra.length) {
        fail(`${documentName} ${label} types differ from template.json (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`);
      }
    }

    for (const type of templateTypes) {
      const generatedSeed = generatedSeeds?.[type];
      validateGeneratedSeed(documentName, type, documentTemplate, generatedSeed);

      const htmlFields = manifest?.documentTypes?.[documentName]?.[type]?.htmlFields ?? [];
      if (!Array.isArray(htmlFields)) {
        fail(`${documentName}.${type} htmlFields must be an array`);
        continue;
      }
      for (const fieldPath of htmlFields) {
        if (!hasOwnPath(generatedSeed, fieldPath)) {
          fail(`${documentName}.${type} htmlField ${fieldPath} is missing from its generated TypeDataModel seed`);
        }
      }
    }
  }
}

function resolveRelativeModule(importer, specifier) {
  const candidate = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(candidate)
    ? [candidate]
    : [candidate, `${candidate}.js`, path.join(candidate, "index.js")];
  return candidates.find((entry) => fs.existsSync(entry) && fs.statSync(entry).isFile()) ?? null;
}

function validateImportsAndTemplates() {
  const files = walkFiles(ROOT);
  const jsFiles = files.filter((file) => file.endsWith(".js"));
  const hbsFiles = files.filter((file) => file.endsWith(".hbs"));
  const staticImportPattern = /^\s*(?:import|export)\s+(?:[^"'\r\n]*?\s+from\s+)?["']([^"']+)["']/gm;
  const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  const templatePattern = /["'`]systems\/uesrpg-3ev4\/([^"'`]+?\.hbs)["'`]/g;

  for (const file of jsFiles) {
    const source = fs.readFileSync(file, "utf8");
    const importMatches = [
      ...source.matchAll(staticImportPattern),
      ...source.matchAll(dynamicImportPattern),
    ];
    for (const match of importMatches) {
      const lineStart = source.lastIndexOf("\n", match.index ?? 0) + 1;
      const linePrefix = source.slice(lineStart, match.index ?? 0).trimStart();
      if (linePrefix.startsWith("//") || linePrefix.startsWith("*")) continue;
      const specifier = match[1];
      if (!specifier?.startsWith(".")) continue;
      if (!resolveRelativeModule(file, specifier)) {
        fail(`${path.relative(ROOT, file)} has unresolved relative import ${specifier}`);
      }
    }
    for (const match of source.matchAll(templatePattern)) {
      const relativeTemplate = normalizePackagePath(match[1]);
      if (relativeTemplate.includes("${")) continue;
      if (!sourcePathExists(relativeTemplate)) {
        fail(`${path.relative(ROOT, file)} references missing template ${SYSTEM_PREFIX}${relativeTemplate}`);
      }
    }
  }

  const partialPattern = /{{>\s*["']systems\/uesrpg-3ev4\/([^"']+?\.hbs)["']/g;
  for (const file of hbsFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(partialPattern)) {
      if (!sourcePathExists(match[1])) {
        fail(`${path.relative(ROOT, file)} references missing partial ${SYSTEM_PREFIX}${match[1]}`);
      }
    }
  }

  notes.push(`Checked ${jsFiles.length} JavaScript files and ${hbsFiles.length} templates for resolvable references.`);
}

function buildStaticImportGraph() {
  const sourceRoot = path.join(ROOT, "src");
  const files = walkDirectoryFiles(sourceRoot).filter((file) => file.endsWith(".js"));
  const fileSet = new Set(files.map((file) => path.normalize(file)));
  const graph = new Map(files.map((file) => [path.normalize(file), []]));
  const staticImportPatterns = [
    /^\s*import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']\s*;?/gm,
    /^\s*export\s+[^;]*?\s+from\s+["']([^"']+)["']\s*;?/gm,
  ];

  for (const file of files) {
    const normalizedFile = path.normalize(file);
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of staticImportPatterns) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1];
        if (!specifier?.startsWith(".")) continue;
        const resolved = resolveRelativeModule(file, specifier);
        if (!resolved) continue;
        const normalizedResolved = path.normalize(resolved);
        if (fileSet.has(normalizedResolved) && !graph.get(normalizedFile).includes(normalizedResolved)) {
          graph.get(normalizedFile).push(normalizedResolved);
        }
      }
    }
  }

  return graph;
}

function findStronglyConnectedComponents(graph) {
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function visit(node) {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of graph.get(node) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(target)));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      onStack.delete(current);
      component.push(current);
    } while (current !== node);
    components.push(component);
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node);
  }
  return components;
}

function findShortestCycle(graph, component) {
  const allowed = new Set(component);
  let shortest = null;

  for (const start of component) {
    if ((graph.get(start) ?? []).includes(start)) return [start, start];
    const queue = [[start]];
    const visited = new Set([start]);

    while (queue.length) {
      const pathToNode = queue.shift();
      const node = pathToNode[pathToNode.length - 1];
      if (shortest && pathToNode.length + 1 >= shortest.length) continue;

      for (const target of graph.get(node) ?? []) {
        if (!allowed.has(target)) continue;
        if (target === start) {
          shortest = [...pathToNode, start];
          continue;
        }
        if (visited.has(target)) continue;
        visited.add(target);
        queue.push([...pathToNode, target]);
      }
    }
  }
  return shortest;
}

function validateStaticImportGraph() {
  const graph = buildStaticImportGraph();
  const cyclicComponents = findStronglyConnectedComponents(graph).filter((component) => (
    component.length > 1 || (graph.get(component[0]) ?? []).includes(component[0])
  ));

  for (const component of cyclicComponents) {
    const cycle = findShortestCycle(graph, component) ?? component;
    const display = cycle.map((file) => normalizePackagePath(path.relative(ROOT, file))).join(" -> ");
    fail(`Static JavaScript import cycle: ${display}`);
  }

  const entry = path.normalize(path.join(ROOT, "src", "system.js"));
  const reachable = new Set();
  const pending = graph.has(entry) ? [entry] : [];
  while (pending.length) {
    const node = pending.pop();
    if (reachable.has(node)) continue;
    reachable.add(node);
    for (const target of graph.get(node) ?? []) pending.push(target);
  }

  const edgeCount = Array.from(graph.values()).reduce((total, edges) => total + edges.length, 0);
  notes.push(`Static import graph contains ${graph.size} modules and ${edgeCount} edges; ${reachable.size} modules are reachable from src/system.js.`);
}

function getObjectPath(root, objectPath) {
  let current = root;
  for (const segment of String(objectPath ?? "").split(".").filter(Boolean)) {
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function validateLocalizationAndTemplates(language) {
  if (!language) return;
  const files = walkFiles(ROOT).filter((file) => file.endsWith(".js") || file.endsWith(".hbs"));
  const patterns = [
    /{{localize\s+["'](UESRPG\.[^"']+)["']/g,
    /(?:\bt|\btf|game\.i18n\.localize|game\.i18n\.format)\(\s*["'](UESRPG\.[^"']+)["']/g,
  ];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        if (getObjectPath(language, match[1]) === undefined) {
          fail(`${path.relative(ROOT, file)} references missing localization key ${match[1]}`);
        }
      }
    }

    if (!file.endsWith(".hbs")) continue;
    for (const attribute of source.matchAll(/\bdata-tooltip\s*=\s*(["'])(.*?)\1/gi)) {
      for (const keyMatch of attribute[2].matchAll(/\b(UESRPG\.[A-Za-z0-9_.-]+)/g)) {
        if (getObjectPath(language, keyMatch[1]) === undefined) {
          fail(`${path.relative(ROOT, file)} references missing tooltip localization key ${keyMatch[1]}`);
        }
      }
    }
    for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
      if (!/\balt\s*=/.test(match[0])) {
        fail(`${path.relative(ROOT, file)} contains an image without explicit alt text`);
      }
    }
  }

  notes.push("Validated static localization references and template image alternatives.");
}

function validateIncrementalUiSafety() {
  const templateFiles = walkDirectoryFiles(path.join(ROOT, "templates"))
    .filter((file) => file.endsWith(".hbs"));
  const localizedActionTemplates = new Set([
    "templates/v2/sheets/spell-sheet.hbs",
    "templates/v2/sheets/item-sheet.hbs",
    "templates/v2/apps/alchemy-workshop.hbs",
    "templates/v2/apps/enchanting-workshop.hbs",
  ]);

  for (const file of templateFiles) {
    const relative = normalizePackagePath(path.relative(ROOT, file));
    const source = fs.readFileSync(file, "utf8");
    if (/\btitle\s*=/i.test(source)) {
      fail(`${relative} contains a native HTML title attribute; use the shared UESRPG tooltip attributes`);
    }

    for (const attribute of source.matchAll(/\bdata-tooltip\s*=\s*(["'])(.*?)\1/gi)) {
      const value = attribute[2].trim();
      const isStaticKey = /^[A-Za-z0-9_.-]+$/.test(value);
      const isKeyConditional = /^{{#if\s+[^}]+}}[A-Za-z0-9_.-]+{{else}}[A-Za-z0-9_.-]+{{\/if}}$/.test(value);
      if (!isStaticKey && !isKeyConditional) {
        fail(`${relative} places non-key tooltip content in data-tooltip; use data-tooltip-text`);
      }
    }

    for (const match of source.matchAll(/<(?:a|button|i|summary|input|select|textarea)\b[^>]*>/gi)) {
      const control = match[0];
      if (!/\bdata-tooltip(?:-text)?\s*=/.test(control)) continue;
      if (!/\baria-label\s*=/.test(control)) {
        fail(`${relative} contains a tooltip-bearing interactive control without an accessible name: ${control}`);
      }
    }

    for (const match of source.matchAll(/<button\b[^>]*>/gi)) {
      if (!/\btype\s*=/.test(match[0])) fail(`${relative} contains a button without an explicit type`);
    }

    if (!localizedActionTemplates.has(relative)) continue;
    if (/<a\b[^>]*\bdata-action\s*=/i.test(source)) {
      fail(`${relative} contains an action anchor; use a semantic button`);
    }

    for (const match of source.matchAll(/<(button)\b[^>]*\bdata-action\s*=[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const full = match[0];
      const open = full.slice(0, full.indexOf(">") + 1);
      const body = match[2]
        .replace(/{{!--[\s\S]*?--}}/g, "")
        .replace(/<(?:i|svg)\b[\s\S]*?<\/(?:i|svg)>/gi, "")
        .replace(/<img\b[^>]*>/gi, "")
        .replace(/<[^>]*>/g, "")
        .trim();
      if (!body && !/\baria-label\s*=/.test(open)) {
        fail(`${relative} contains an icon-only action without an accessible name: ${open}`);
      }
      for (const attribute of open.matchAll(/\b(?:title|aria-label)\s*=\s*(["'])(.*?)\1/gi)) {
        if (attribute[2] && !attribute[2].includes("{{")) {
          fail(`${relative} embeds a raw ${attribute[0].split("=")[0].trim()} string in an action control`);
        }
      }
      const rawText = body
        .replace(/{{[\s\S]*?}}/g, " ")
        .replace(/\b(?:TN|MP|AP|XP|SL)\b/g, " ");
      if (/[A-Za-z]{2,}/.test(rawText)) {
        fail(`${relative} embeds raw visible action text: ${rawText.trim()}`);
      }
    }
  }

  const localizedNotificationSources = [
    "src/ui/apps/v2/alchemy-workshop-app.js",
    "src/ui/apps/v2/enchanting-workshop-app.js",
    "src/ui/apps/v2/travel-planner-app.js",
    "src/ui/sheets/v2/actor-sheet.js",
    "src/ui/sheets/v2/npc-sheet.js",
  ];
  const literalNotificationPattern = /ui\.notifications(?:\?\.)?\.(?:info|warn|error)(?:\?\.)?\(\s*(?:["'`])/g;
  for (const relative of localizedNotificationSources) {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    if (literalNotificationPattern.test(source)) {
      fail(`${relative} contains a directly embedded runtime notification string`);
    }
    literalNotificationPattern.lastIndex = 0;
  }

  const javascriptFiles = walkDirectoryFiles(path.join(ROOT, "src")).filter((file) => file.endsWith(".js"));
  const nativeTooltipPatterns = [
    [/setAttribute\(\s*["']title["']/, "sets a native title attribute"],
    [/\.\s*title\s*=/, "assigns a native title property"],
    [/\btitle=(?:["']|\$\{)/, "generates native title markup"],
  ];
  for (const file of javascriptFiles) {
    const relative = normalizePackagePath(path.relative(ROOT, file));
    const source = fs.readFileSync(file, "utf8");
    for (const [pattern, description] of nativeTooltipPatterns) {
      if (pattern.test(source)) fail(`${relative} ${description}; use the shared UESRPG tooltip utility`);
    }
  }

  notes.push("Validated explicit button types, accessible action names, shared tooltip attributes, localized action controls, and localized UI notifications for the current migration tranche.");
}

function validateFoundryPatchCompatibility() {
  const files = [
    ...walkDirectoryFiles(path.join(ROOT, "src")).filter((file) => file.endsWith(".js")),
    ...walkDirectoryFiles(path.join(ROOT, "templates")).filter((file) => file.endsWith(".hbs")),
  ];
  const forbidden = [
    [/_processSubmitData\s*\(/, "DocumentSheetV2#_processSubmitData dependency"],
    [/\._refit\s*\(/, "ApplicationV2#_refit usage"],
    [/\.getDependentTokens\s*\(/, "Actor#getDependentTokens usage"],
    [/\.getReplacementData\s*\(/, "ActiveEffect#getReplacementData usage"],
    [/<autocomplete-tags\b/i, "autocomplete-tags usage"],
    [/<file-picker\b/i, "file-picker usage"],
    [/<formula-input\b/i, "formula-input usage"],
  ];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const [pattern, label] of forbidden) {
      if (pattern.test(source)) fail(`${path.relative(ROOT, file)} contains post-14.363 ${label}`);
    }
  }

  for (const file of files.filter((entry) => entry.endsWith(".js"))) {
    if (normalizePackagePath(path.relative(ROOT, file)) === "src/utils/compat.js") continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bbuildEffectChange\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      if (!/\bpriority\s*:/.test(match[1])) {
        fail(`${path.relative(ROOT, file)} creates an Active Effect change without explicit priority`);
      }
    }
  }

  notes.push("Validated the 14.363 API floor and explicit priorities for system-built Active Effect changes.");
}

function validateUiArchitectureAndTextEncoding() {
  const sourceFiles = walkDirectoryFiles(path.join(ROOT, "src")).filter((file) => file.endsWith(".js"));
  const legacyPatterns = [
    [/extends\s+(?:Application|ActorSheet|ItemSheet|FormApplication)\b/g, "legacy ApplicationV1 inheritance"],
    [/new\s+Dialog\s*\(/g, "legacy Dialog construction"],
  ];
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const [pattern, label] of legacyPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) fail(`${path.relative(ROOT, file)} contains ${label}`);
    }
  }

  const englishSourceFiles = [
    ...sourceFiles,
    ...walkDirectoryFiles(path.join(ROOT, "templates")).filter((file) => file.endsWith(".hbs")),
    path.join(ROOT, "lang", "en.json"),
  ];
  for (const file of englishSourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    if (/\uFFFD|[\u0400-\u04FF]/u.test(source)) {
      fail(`${path.relative(ROOT, file)} contains replacement or mojibake characters`);
    }
  }

  notes.push("Validated ApplicationV2-only UI patterns and English-source text encoding.");
}

function validateStylesheetReferences(manifest) {
  for (const stylesheet of manifest?.styles ?? []) {
    const normalized = normalizePackagePath(stylesheet);
    const absolutePath = path.join(ROOT, ...normalized.split("/"));
    if (!fs.existsSync(absolutePath)) continue;
    const source = fs.readFileSync(absolutePath, "utf8");
    for (const match of source.matchAll(/\/\*#\s*sourceMappingURL=([^*\s]+)\s*\*\//g)) {
      const mapPath = path.resolve(path.dirname(absolutePath), match[1]);
      if (!fs.existsSync(mapPath)) fail(`${normalized} references missing source map ${match[1]}`);
    }
  }
}

function validateCoreIntegrationSafety() {
  const sourceDirectory = path.join(ROOT, "src");
  const jsFiles = walkFiles(sourceDirectory).filter((file) => file.endsWith(".js"));
  const forbiddenPatterns = [
    [/(?<!Object)\.prototype(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=/g, "runtime prototype assignment"],
    [/Object\.definePropert(?:y|ies)\s*\([^\r\n]*\.prototype/g, "runtime prototype property definition"],
    [/(?:globalThis\.)?foundry\.applications\.handlebars(?:\.[A-Za-z_$][\w$]*)?\s*=/g, "Foundry Handlebars namespace reassignment"],
    [/globalThis\.renderTemplate\s*=/g, "global renderTemplate reassignment"],
    [/delete\s+(?:game\.documentTypes|CONFIG\.(?:Actor|Item)\.dataModels)/g, "document type registry deletion"],
    [/(?:game\.documentTypes|CONFIG\.(?:Actor|Item)\.dataModels)(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=/g, "document type registry mutation"],
  ];

  for (const file of jsFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const [pattern, label] of forbiddenPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) {
        fail(`${path.relative(ROOT, file)} contains forbidden ${label}`);
      }
    }
    const relative = normalizePackagePath(path.relative(ROOT, file));
    if (relative !== "src/utils/settings-registration.js" && /game\.settings\.register(?:Menu)?\s*\(/.test(source)) {
      fail(`${relative} registers a setting or menu outside the shared registration helper`);
    }
  }
}

function validateUpgradeChannel(manifest, packageJson) {
  if (!manifest || !packageJson) return null;

  let release;
  try {
    release = getReleaseMetadata(packageJson.version);
  } catch (error) {
    fail(error.message);
    return null;
  }

  if (isFoundryNewerVersion("14.0.7", "v14.0.0")) {
    fail("The release-time Foundry version comparator no longer reproduces the historical v14.0.0 update failure");
  }
  for (const legacyVersion of LEGACY_INSTALLED_VERSIONS) {
    if (!isFoundryNewerVersion(release.systemVersion, legacyVersion)) {
      fail(`Foundry version ${release.systemVersion} does not upgrade legacy installation ${legacyVersion}`);
    }
  }
  if (isFoundryNewerVersion(release.systemVersion, release.systemVersion)) {
    fail(`Foundry version ${release.systemVersion} incorrectly compares as newer than itself`);
  }

  const [major, minor, patch] = release.packageVersion.split(".").map(Number);
  const futureVersion = getReleaseMetadata(`${major}.${minor}.${patch + 1}`).systemVersion;
  if (!isFoundryNewerVersion(futureVersion, release.systemVersion)) {
    fail(`Future Foundry version ${futureVersion} does not upgrade ${release.systemVersion}`);
  }

  notes.push(`Verified Foundry upgrade paths from ${LEGACY_INSTALLED_VERSIONS.join(" and ")} to ${release.systemVersion}.`);
  return release;
}

function validateSourceLayout(manifest, packageJson, packageLock) {
  if (!manifest || !packageJson || !packageLock) return;

  const release = validateUpgradeChannel(manifest, packageJson);
  if (!release) return;

  if (manifest.id !== packageJson.name) fail(`Manifest id ${manifest.id} does not match package name ${packageJson.name}`);
  if (manifest.version !== release.systemVersion) {
    fail(`Manifest version ${manifest.version} must match Foundry release version ${release.systemVersion}`);
  }
  if (packageLock.name !== packageJson.name || packageLock.packages?.[""]?.name !== packageJson.name) {
    fail(`package-lock.json package name does not match package.json name ${packageJson.name}`);
  }
  if (packageLock.version !== packageJson.version || packageLock.packages?.[""]?.version !== packageJson.version) {
    fail(`package-lock.json version does not match package.json version ${packageJson.version}`);
  }
if (manifest?.compatibility?.minimum !== "14.363"
    || manifest?.compatibility?.verified !== "14.368"
    || String(manifest?.compatibility?.maximum ?? "") !== "14") {
  fail("system.json compatibility must remain minimum 14.363, verified 14.368, maximum 14");
}

  if (manifest.manifest !== RELEASE_MANIFEST_URL) {
    fail(`Manifest update URL must be ${RELEASE_MANIFEST_URL}`);
  }
  if (manifest.download !== release.downloadUrl) {
    fail(`Manifest download URL must match release ${release.tag}: ${release.downloadUrl}`);
  }

  const requiredPaths = [
    "template.json",
    ...(manifest.esmodules ?? []),
    ...(manifest.styles ?? []),
    ...(manifest.languages ?? []).map((language) => language?.path),
  ].filter(Boolean);

  for (const requiredPath of requiredPaths) {
    if (!sourcePathExists(requiredPath)) fail(`Manifest path is missing: ${requiredPath}`);
  }

  if (!Array.isArray(manifest.packs) || manifest.packs.length === 0) {
    fail("system.json must declare at least one compiled pack");
  } else {
    for (const pack of manifest.packs) {
      const packPath = normalizePackagePath(pack?.path);
      if (!packPath) {
        fail(`Pack ${pack?.name ?? "<unnamed>"} has no path`);
        continue;
      }
      if (!sourcePathExists(`${packPath}/CURRENT`)) fail(`Pack ${pack?.name ?? "<unnamed>"} is missing ${packPath}/CURRENT`);
    }
  }
}

function collectReleaseSourceFiles() {
  const files = [];
  for (const relativePath of RELEASE_FILES) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      fail(`Required release file is missing: ${relativePath}`);
      continue;
    }
    files.push(absolutePath);
  }
  for (const relativePath of OPTIONAL_RELEASE_FILES) {
    const absolutePath = path.join(ROOT, relativePath);
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) files.push(absolutePath);
  }
  for (const relativePath of RELEASE_DIRECTORIES) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
      fail(`Required release directory is missing: ${relativePath}`);
      continue;
    }
    files.push(...walkDirectoryFiles(absolutePath).filter((file) => !isTransientPackPath(file)));
  }
  return files.sort((left, right) => normalizePackagePath(path.relative(ROOT, left))
    .localeCompare(normalizePackagePath(path.relative(ROOT, right))));
}

function cleanReleaseFolder(destination) {
  const expected = path.resolve(ROOT, "dist", RELEASE_FOLDER_NAME);
  const resolved = path.resolve(destination);
  if (resolved !== expected) throw new Error(`Refusing to clean unexpected release path ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}

function validateBuiltReleaseFolder(destination, sourceFiles, manifest) {
  const expectedFiles = new Map(sourceFiles.map((source) => [
    normalizePackagePath(path.relative(ROOT, source)),
    source,
  ]));
  const actualFiles = walkDirectoryFiles(destination).map((file) =>
    normalizePackagePath(path.relative(destination, file)));

  for (const relativePath of expectedFiles.keys()) {
    if (!actualFiles.includes(relativePath)) fail(`Ready release folder is missing ${relativePath}`);
  }
  for (const relativePath of actualFiles) {
    if (!expectedFiles.has(relativePath)) fail(`Ready release folder contains unexpected file ${relativePath}`);
  }
  for (const [relativePath, source] of expectedFiles) {
    const output = path.join(destination, ...relativePath.split("/"));
    if (!fs.existsSync(output)) continue;
    if (!fs.readFileSync(source).equals(fs.readFileSync(output))) {
      fail(`Ready release file differs from its source: ${relativePath}`);
    }
  }

  const requiredManifestPaths = [
    ...(manifest?.esmodules ?? []),
    ...(manifest?.styles ?? []),
    ...(manifest?.languages ?? []).map((language) => language?.path),
    ...(manifest?.packs ?? []).map((pack) => `${normalizePackagePath(pack?.path)}/CURRENT`),
  ].map(normalizePackagePath).filter(Boolean);
  for (const relativePath of requiredManifestPaths) {
    if (!fs.existsSync(path.join(destination, ...relativePath.split("/")))) {
      fail(`Ready release folder is missing manifest dependency ${relativePath}`);
    }
  }

  for (const relativePath of ARCHIVE_EXCLUDED_FILES) {
    if (fs.existsSync(path.join(destination, relativePath))) {
      fail(`Ready release folder contains development-only file ${relativePath}`);
    }
  }
  for (const relativePrefix of ARCHIVE_EXCLUDED_PREFIXES) {
    const relativePath = relativePrefix.replace(/\/$/, "");
    if (fs.existsSync(path.join(destination, ...relativePath.split("/")))) {
      fail(`Ready release folder contains development-only directory ${relativePath}`);
    }
  }

  notes.push(`Verified ${actualFiles.length} ready-release files in ${normalizePackagePath(path.relative(ROOT, destination))}.`);
}

function buildReleaseFolder(manifest) {
  const destination = path.resolve(ROOT, "dist", RELEASE_FOLDER_NAME);
  const sourceFiles = collectReleaseSourceFiles();
  if (errors.length) return null;

  try {
    cleanReleaseFolder(destination);
    fs.mkdirSync(destination, { recursive: true });
    for (const source of sourceFiles) {
      const relativePath = normalizePackagePath(path.relative(ROOT, source));
      const output = path.join(destination, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(source, output);
    }
    validateBuiltReleaseFolder(destination, sourceFiles, manifest);
  } catch (error) {
    try {
      cleanReleaseFolder(destination);
    } catch (_cleanupError) {
      // Preserve the original build failure below.
    }
    fail(`Could not build ready release folder: ${error.message}`);
    return null;
  }

  notes.push(`Built ready release folder ${normalizePackagePath(path.relative(ROOT, destination))}.`);
  return destination;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readZipEntries(archivePath) {
  const buffer = fs.readFileSync(archivePath);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("end-of-central-directory record was not found");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported by this validator");
  }

  const entries = new Map();
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`invalid central-directory entry ${index}`);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replaceAll("\\", "/");
    if (rawName.startsWith("/") || /^[A-Za-z]:/.test(rawName) || rawName.split("/").includes("..")) {
      throw new Error(`unsafe archive entry path ${rawName}`);
    }
    const name = normalizePackagePath(rawName);
    if (name && !rawName.endsWith("/")) {
      if (entries.has(name)) throw new Error(`duplicate archive entry ${name}`);
      entries.set(name, { compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { buffer, entries };
}

function readZipEntry(zip, name) {
  const entry = zip.entries.get(name);
  if (!entry) return null;
  const offset = entry.localHeaderOffset;
  if (zip.buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error(`invalid local header for ${name}`);
  const nameLength = zip.buffer.readUInt16LE(offset + 26);
  const extraLength = zip.buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = zip.buffer.subarray(dataStart, dataStart + entry.compressedSize);
  let output;
  if (entry.compressionMethod === 0) output = compressed;
  else if (entry.compressionMethod === 8) output = zlib.inflateRawSync(compressed);
  else throw new Error(`unsupported compression method ${entry.compressionMethod} for ${name}`);
  if (output.length !== entry.uncompressedSize) throw new Error(`size mismatch for ${name}`);
  return output;
}

function validateArchive(archiveArgument, manifest) {
  const archivePath = path.resolve(ROOT, archiveArgument);
  if (!fs.existsSync(archivePath)) {
    fail(`Release archive does not exist: ${archivePath}`);
    return;
  }

  let zip;
  try {
    zip = readZipEntries(archivePath);
  } catch (error) {
    fail(`Could not inspect release archive: ${error.message}`);
    return;
  }
  const { entries } = zip;

  const requiredEntries = [
    "system.json",
    "template.json",
    ...(manifest?.esmodules ?? []),
    ...(manifest?.styles ?? []),
    ...(manifest?.languages ?? []).map((language) => language?.path),
    ...(manifest?.packs ?? []).map((pack) => `${normalizePackagePath(pack?.path)}/CURRENT`),
  ].map(normalizePackagePath).filter(Boolean);

  for (const required of requiredEntries) {
    if (!entries.has(required)) fail(`Release archive is missing ${required}`);
  }

  for (const requiredPrefix of ["fonts/", "images/", "lang/", "packs/", "src/", "styles/", "templates/"]) {
    if (![...entries.keys()].some((entry) => entry.startsWith(requiredPrefix))) {
      fail(`Release archive has no files beneath ${requiredPrefix}`);
    }
  }

  for (const entry of entries.keys()) {
    if (ARCHIVE_EXCLUDED_FILES.has(entry) || ARCHIVE_EXCLUDED_PREFIXES.some((prefix) => entry.startsWith(prefix))) {
      fail(`Release archive contains development-only entry ${entry}`);
    }
  }

  try {
    const archivedManifest = JSON.parse(readZipEntry(zip, "system.json").toString("utf8"));
    for (const field of ["id", "version", "manifest", "download", "compatibility"]) {
      if (!equalData(archivedManifest[field], manifest?.[field])) {
        fail(`Archived manifest ${field} does not match the source manifest`);
      }
    }
  } catch (error) {
    fail(`Archived system.json is missing or invalid: ${error.message}`);
  }

  notes.push(`Checked ${entries.size} release archive entries in ${path.basename(archivePath)}.`);
}

function parseOptionArgument(argv, option) {
  const index = argv.indexOf(option);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${option} requires a value`);
    return null;
  }
  return value;
}

function validatePreviousRelease(packageJson, previousReleaseTag) {
  if (!packageJson || !previousReleaseTag) return;

  try {
    const proposedVersion = requireStablePackageVersion(packageJson.version, "Proposed package version");
    const previousVersion = parseReleaseTag(previousReleaseTag, "Latest stable release tag");
    if (compareStablePackageVersions(proposedVersion, previousVersion) <= 0) {
      fail(`Proposed release v${proposedVersion} must be newer than latest stable release ${previousReleaseTag}`);
      return;
    }
    notes.push(`Verified v${proposedVersion} is newer than latest stable release ${previousReleaseTag}.`);
  } catch (error) {
    fail(error.message);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const manifest = readJson("system.json");
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const template = readJson("template.json");
  const language = readJson("lang/en.json");

  validateSourceLayout(manifest, packageJson, packageLock);
  validateImportsAndTemplates();
  validateStaticImportGraph();
  validateLocalizationAndTemplates(language);
  validateIncrementalUiSafety();
  validateFoundryPatchCompatibility();
  validateUiArchitectureAndTextEncoding();
  validateStylesheetReferences(manifest);
  validateCoreIntegrationSafety();
  validateSchemaDrift(manifest, template);

  if (argv.includes("--build-folder") && !errors.length) buildReleaseFolder(manifest);

  const archiveArgument = parseOptionArgument(argv, "--archive");
  if (archiveArgument) validateArchive(archiveArgument, manifest);

  const previousReleaseTag = parseOptionArgument(argv, "--previous-release");
  if (previousReleaseTag) validatePreviousRelease(packageJson, previousReleaseTag);

  if (errors.length) {
    console.error(`UESRPG release validation failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  for (const note of notes) console.log(`UESRPG | ${note}`);
  console.log(`UESRPG | Release validation passed for ${manifest.version}.`);
}

main();
