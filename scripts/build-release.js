"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");
const { buildSchemaSeeds } = require("./schema-seeds.js");
const { checkJavaScriptSyntax } = require("./javascript-syntax.js");
const { checkDataCatalogs } = require("./generate-data-catalogs.js");
const { checkConsolidation } = require("./consolidation-checks.js");
const { getReleaseMetadata } = require("../automation/release-metadata.js");

const ROOT = path.resolve(__dirname, "..");
const SYSTEM_PREFIX = "systems/uesrpg-3ev4/";
const RELEASE_FOLDER_NAME = "uesrpg-3ev4";
const GITHUB_SOURCE_FOLDER_NAME = "github-source";
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const RELEASE_DIRECTORIES = Object.freeze(["docs", "fonts", "images", "lang", "packs", "src", "styles", "templates"]);
const RELEASE_FILES = Object.freeze(["system.json", "template.json"]);
const OPTIONAL_RELEASE_FILES = Object.freeze(["CHANGELOG.md", "LICENSE.txt", "README.md"]);
const GITHUB_SOURCE_DIRECTORIES = Object.freeze([
  ".github",
  "automation",
  "docs",
  "fonts",
  "images",
  "lang",
  "packs",
  "scripts",
  "src",
  "styles",
  "templates",
]);
const GITHUB_SOURCE_FILES = Object.freeze([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "build-dist.cmd",
  "build-release-folder.cmd",
  "CHANGELOG.md",
  "eslint.config.mjs",
  "LICENSE.txt",
  "package-lock.json",
  "package.json",
  "README.md",
  "system.json",
  "template.json",
]);
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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function equalData(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function validateGeneratedSeed(documentName, type, expectedSeed, generatedSeed) {
  if (!isPlainObject(expectedSeed) || !isPlainObject(generatedSeed)) {
    fail(`${documentName}.${type} is missing a template or generated seed`);
    return;
  }
  if (!equalData(expectedSeed, generatedSeed)) {
    fail(`${documentName}.${type} generated defaults do not exactly match resolved template inheritance`);
  }
  if (Object.hasOwn(generatedSeed, "templates")) {
    fail(`${documentName}.${type} persists the declarative templates key as system data`);
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
  let expected;
  try {
    expected = buildSchemaSeeds(template);
  } catch (error) {
    fail(`Could not resolve template.json schema inheritance: ${error.message}`);
    return;
  }

  const configurations = [
    ["Actor", generated.ACTOR_TYPE_MODEL_SEEDS, expected.actor],
    ["Item", generated.ITEM_TYPE_MODEL_SEEDS, expected.item],
  ];

  for (const [documentName, generatedSeeds, expectedSeeds] of configurations) {
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
      validateGeneratedSeed(documentName, type, expectedSeeds?.[type], generatedSeed);

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

function validateJavaScriptSyntax() {
  const checked = checkJavaScriptSyntax(ROOT);
  for (const error of checked.errors) fail(`${normalizePackagePath(error)} failed node --check`);
  notes.push(`Syntax-checked ${checked.files.length} JavaScript files.`);
}

function loadMigrationRegistry() {
  const relative = "src/core/migrations/revisions.js";
  try {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8")
      .replace(/^export\s+const\s+/gm, "const ");
    return vm.runInNewContext(
      `(() => { ${source}\nreturn { MIGRATION_REVISIONS, STARTUP_PENDING_MIGRATION_KEYS }; })()`,
      Object.create(null),
      { filename: relative, timeout: 1000 }
    );
  } catch (error) {
    fail(`Could not evaluate migration revision registry: ${error.message}`);
    return null;
  }
}

function validateMigrationRegistry() {
  const registry = loadMigrationRegistry();
  if (!registry) return;
  const revisions = registry.MIGRATION_REVISIONS ?? {};
  const startupKeys = registry.STARTUP_PENDING_MIGRATION_KEYS ?? [];
  const settingsOnly = new Set(["timeDefaultsCompositeOrchestratorV1", "automationProfileRemovalDefaultsV2"]);
  const startupSet = new Set(startupKeys);

  if (startupSet.size !== startupKeys.length) fail("STARTUP_PENDING_MIGRATION_KEYS contains duplicates");
  for (const key of startupKeys) {
    if (!Object.hasOwn(revisions, key)) fail(`Startup migration key ${key} is missing from MIGRATION_REVISIONS`);
  }
  for (const key of Object.keys(revisions)) {
    if (!startupSet.has(key) && !settingsOnly.has(key)) {
      fail(`Document migration ${key} is not listed for startup/pending reporting`);
    }
  }

  const migrationFiles = walkDirectoryFiles(path.join(ROOT, "src", "core", "migrations"))
    .filter((file) => file.endsWith(".js") && path.basename(file) !== "revisions.js");
  for (const file of migrationFiles) {
    const relative = normalizePackagePath(path.relative(ROOT, file));
    const source = fs.readFileSync(file, "utf8");
    if (/const\s+[A-Za-z0-9_$]*REVISION[A-Za-z0-9_$]*\s*=\s*\d+\s*;/.test(source)) {
      fail(`${relative} declares a numeric migration revision outside the central registry`);
    }
    const literalKeyPatterns = [
      /isMigrationRevisionApplied\s*\(\s*["']([^"']+)["']/g,
      /markMigrationRevisionApplied\s*\(\s*[^,]+,\s*["']([^"']+)["']/g,
    ];
    for (const pattern of literalKeyPatterns) {
      for (const match of source.matchAll(pattern)) {
        if (!Object.hasOwn(revisions, match[1])) {
          fail(`${relative} uses unregistered migration key ${match[1]}`);
        }
      }
    }
  }
  notes.push(`Validated ${Object.keys(revisions).length} centralized migration revisions.`);
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

function buildImportGraph({ includeDynamic = false } = {}) {
  const sourceRoot = path.join(ROOT, "src");
  const files = walkDirectoryFiles(sourceRoot).filter((file) => file.endsWith(".js"));
  const fileSet = new Set(files.map((file) => path.normalize(file)));
  const graph = new Map(files.map((file) => [path.normalize(file), []]));
  const staticImportPatterns = [
    /^\s*import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']\s*;?/gm,
    /^\s*export\s+[^;]*?\s+from\s+["']([^"']+)["']\s*;?/gm,
  ];
  const importPatterns = includeDynamic
    ? [...staticImportPatterns, /\bimport\(\s*["']([^"']+)["']\s*\)/g]
    : staticImportPatterns;

  for (const file of files) {
    const normalizedFile = path.normalize(file);
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of importPatterns) {
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
  const staticGraph = buildImportGraph();
  const cyclicComponents = findStronglyConnectedComponents(staticGraph).filter((component) => (
    component.length > 1 || (staticGraph.get(component[0]) ?? []).includes(component[0])
  ));

  for (const component of cyclicComponents) {
    const cycle = findShortestCycle(staticGraph, component) ?? component;
    const display = cycle.map((file) => normalizePackagePath(path.relative(ROOT, file))).join(" -> ");
    fail(`Static JavaScript import cycle: ${display}`);
  }

  const graph = buildImportGraph({ includeDynamic: true });
  const entry = path.normalize(path.join(ROOT, "src", "system.js"));
  const reachable = new Set();
  const pending = graph.has(entry) ? [entry] : [];
  while (pending.length) {
    const node = pending.pop();
    if (reachable.has(node)) continue;
    reachable.add(node);
    for (const target of graph.get(node) ?? []) pending.push(target);
  }

  const publicEntrypointAllowlist = new Set([
    "src/api/index.js",
    "src/application/index.js",
    "src/core/enchanting/index.js",
    "src/core/homebrew/index.js",
    "src/core/magic/index.js",
    "src/ui/sheets/v2/_delegated-bindings.js", // Retained public ESM helper; native sheets no longer need it.
  ]);
  const unreachable = [...graph.keys()]
    .filter((file) => !reachable.has(file))
    .map((file) => normalizePackagePath(path.relative(ROOT, file)))
    .filter((relative) => !publicEntrypointAllowlist.has(relative));
  for (const relative of unreachable) fail(`Unreachable runtime JavaScript module: ${relative}`);

  const edgeCount = Array.from(graph.values()).reduce((total, edges) => total + edges.length, 0);
  notes.push(`Import graph contains ${graph.size} modules and ${edgeCount} static or literal-dynamic edges; ${reachable.size} modules are reachable from src/system.js.`);
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

    if (file.endsWith(".hbs")) {
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
  }

  notes.push("Validated static localization references and template image alternatives.");
}

function validateIncrementalUiSafety() {
  const templateFiles = walkDirectoryFiles(path.join(ROOT, "templates"))
    .filter((file) => file.endsWith(".hbs"));
  const voidHtmlElements = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
  ]);
  const singletonSettingsTemplates = new Set([
    "templates/v2/apps/combat-settings.hbs",
    "templates/v2/apps/debug-settings.hbs",
    "templates/v2/apps/homebrew-settings.hbs",
    "templates/v2/apps/interface-settings.hbs",
    "templates/v2/apps/migration-settings.hbs",
    "templates/v2/apps/reach-visualizer-settings.hbs",
    "templates/v2/apps/talents-settings.hbs",
  ]);
  const mechanicalAbbreviationPattern = /\b(?:AP|BR|ENC|HP|LP|MP|SA|SL|SP|TE|TN|XP)\b/g;
  const visualRolePattern = /\b(?:uesrpg-plain-control|uesrpg-image-action|uesrpg-icon-action|uesrpg-styled-action)\b/;

  for (const file of templateFiles) {
    const relative = normalizePackagePath(path.relative(ROOT, file));
    const source = fs.readFileSync(file, "utf8");
    const isAppV2Surface = relative.startsWith("templates/v2/") || relative.startsWith("templates/partials/sheets/");

    if (isAppV2Surface) {
      const markup = source
        .replace(/{{!--[\s\S]*?--}}/g, "")
        .replace(/<!--[\s\S]*?-->/g, "");
      const stack = [];
      let rootElements = 0;
      let structureFailed = false;
      for (const tagMatch of markup.matchAll(/<\/?([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g)) {
        const tagSource = tagMatch[0];
        const tagName = tagMatch[1].toLowerCase();
        const line = markup.slice(0, tagMatch.index).split(/\r?\n/).length;
        if (tagSource.startsWith("</")) {
          const openTag = stack.pop();
          if (openTag?.name !== tagName) {
            fail(`${relative}:${line} closes <${openTag?.name ?? "none"}> with </${tagName}>`);
            structureFailed = true;
            break;
          }
          continue;
        }
        if (stack.length === 0) rootElements += 1;
        if (!tagSource.endsWith("/>") && !voidHtmlElements.has(tagName)) {
          stack.push({ name: tagName, line });
        }
      }
      if (!structureFailed && stack.length) {
        const openTag = stack.at(-1);
        fail(`${relative}:${openTag.line} contains an unclosed <${openTag.name}> element`);
        structureFailed = true;
      }

      if (relative.startsWith("templates/v2/") && !structureFailed) {
        const isSinglePartialRoot = rootElements === 0 && /^\s*{{>[^}]+}}\s*$/.test(markup);
        if (rootElements !== 1 && !isSinglePartialRoot) {
          fail(`${relative} renders ${rootElements} top-level HTML elements; an ApplicationV2 part must render exactly one`);
        }
      }
    }

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

    if (!isAppV2Surface) continue;

    for (const match of source.matchAll(/<([A-Za-z0-9-]+)\b[^>]*\bdata-action\s*=/g)) {
      const tagName = match[1].toLowerCase();
      if (!new Set(["button", "input", "select"]).has(tagName)) {
        fail(`${relative} contains a non-semantic <${tagName}> action; use a native control`);
      }
    }

    const isSheetControlSurface = relative.startsWith("templates/v2/sheets/")
      || relative.startsWith("templates/partials/sheets/");
    if (isSheetControlSurface) {
      for (const match of source.matchAll(/<button\b[^>]*\bdata-action\s*=[^>]*>/gi)) {
        if (!visualRolePattern.test(match[0])) {
          fail(`${relative} contains an Actor/Item action button without a recognized visual role: ${match[0]}`);
        }
      }

      for (const match of source.matchAll(/<button\b[^>]*\buesrpg-semantic-control\b[^>]*>/gi)) {
        if (!visualRolePattern.test(match[0])) {
          fail(`${relative} contains a semantic control without an explicit visual role: ${match[0]}`);
        }
      }
    }

    for (const match of source.matchAll(/<([A-Za-z0-9-]+)\b[^>]*\bdata-tab\s*=[^>]*>/g)) {
      const tagName = match[1].toLowerCase();
      const isTabButton = tagName === "button";
      const isTabPanel = new Set(["div", "section", "article"]).has(tagName)
        && /\bclass\s*=(["'])[^"']*\btab\b/.test(match[0]);
      if (!isTabButton && !isTabPanel) {
        fail(`${relative} contains a non-semantic tab control: ${match[0]}`);
      }
    }

    if (!singletonSettingsTemplates.has(relative)) {
      for (const match of source.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)) {
        if (!match[2].includes("{{")) {
          fail(`${relative} contains a fixed control id (${match[2]}); use an application-prefixed id or a scoped data-role`);
        }
      }
    }

    for (const match of source.matchAll(/<(button)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const full = match[0];
      const open = full.slice(0, full.indexOf(">") + 1);
      const body = match[2]
        .replace(/{{!--[\s\S]*?--}}/g, "")
        .replace(/<(?:i|svg)\b[\s\S]*?<\/(?:i|svg)>/gi, "")
        .replace(/<img\b[^>]*>/gi, "")
        .replace(/<[^>]*>/g, "")
        .trim();
      if (!body && !/\baria-label\s*=/.test(open)) {
        fail(`${relative} contains an icon-only button without an accessible name: ${open}`);
      }

      for (const attribute of open.matchAll(/\b(?:aria-label|placeholder|data-tooltip-text)\s*=\s*(["'])(.*?)\1/gi)) {
        const value = attribute[2].replace(mechanicalAbbreviationPattern, "").trim();
        if (value && !value.includes("{{") && /[A-Za-z]{2,}/.test(value)) {
          fail(`${relative} embeds a raw ${attribute[0].split("=")[0].trim()} string in a button`);
        }
      }

      const rawText = body
        .replace(/{{[\s\S]*?}}/g, " ")
        .replace(mechanicalAbbreviationPattern, " ");
      if (/[A-Za-z]{2,}/.test(rawText)) {
        fail(`${relative} embeds raw visible action text: ${rawText.trim()}`);
      }
    }

    for (const match of source.matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)) {
      for (const attribute of match[0].matchAll(/\b(?:aria-label|placeholder|data-tooltip-text)\s*=\s*(["'])(.*?)\1/gi)) {
        const value = attribute[2].replace(mechanicalAbbreviationPattern, "").trim();
        if (value && !value.includes("{{") && /[A-Za-z]{2,}/.test(value)) {
          fail(`${relative} embeds a raw ${attribute[0].split("=")[0].trim()} string in a form control`);
        }
      }
    }
  }

  const stylesheet = fs.readFileSync(path.join(ROOT, "styles", "uesrpg.css"), "utf8");
  const plainControlBlock = stylesheet.match(/button\.uesrpg-plain-control\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const requiredNeutralDeclarations = [
    "appearance", "width", "height", "min-width", "min-height", "margin", "padding",
    "border", "border-radius", "background", "box-shadow", "font", "line-height", "text-align",
  ];
  for (const declaration of requiredNeutralDeclarations) {
    if (!new RegExp(`(?:^|\\n)\\s*${declaration}\\s*:`, "m").test(plainControlBlock)) {
      fail(`styles/uesrpg.css plain semantic-control reset is missing ${declaration}`);
    }
  }
  if (/\.worldbuilding\s+button:not\([^\n{]*\)\s*\{/.test(stylesheet)
      && !/\.worldbuilding\s+button[^\n{]*:not\(\.uesrpg-plain-control\)[^\n{]*\{/.test(stylesheet)) {
    fail("styles/uesrpg.css has a broad system button selector which does not exclude neutral semantic controls");
  }
  for (const block of stylesheet.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const selectors = String(block[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((selector) => selector.trim());
    for (const selector of selectors) {
      const isBroadSheetButton = /^(?:\.worldbuilding(?:\.sheet\.(?:actor|item))?|\.uesrpg\.sheet\.(?:actor|item))\s+button\s*$/.test(selector)
        || /\.sheet-fixed-container\s+button\s*$/.test(selector);
      if (isBroadSheetButton && !selector.includes(":not(.uesrpg-plain-control)")) {
        fail(`styles/uesrpg.css has a broad sheet button selector which can restyle neutral controls: ${selector}`);
      }
    }
  }
  if (/\.tab\.magic\s+:is\(\s*button\s*,/m.test(stylesheet)) {
    fail("styles/uesrpg.css applies Magic form-field chrome to every descendant button");
  }
  const applicationContainerRules = stylesheet.slice(stylesheet.indexOf("/* Application-owned inline-size containment."));
  if (/\.application\.uesrpg-dialog\s+\.form-group/.test(applicationContainerRules)
      || /\.uesrpg-dialog--layout-workflow[^\n{]*\.uesrpg-adv-grid/.test(applicationContainerRules)) {
    fail("styles/uesrpg.css reintroduces scaled-DPI dialog stacking into application-width container rules");
  }
  const baselineContracts = [
    [/\.item-compact-header\s*>\s*button\.uesrpg-image-action[\s\S]*?width:\s*var\(--item-img,\s*64px\)[\s\S]*?height:\s*var\(--item-img,\s*64px\)/, "64px compact Item portrait button"],
    [/\.spell-header\s*>\s*button\.uesrpg-image-action[\s\S]*?width:\s*88px[\s\S]*?height:\s*88px/, "88px Spell portrait button"],
    [/\.resource-controls\s*>\s*button\.uesrpg-icon-button[\s\S]*?width:\s*16px[\s\S]*?height:\s*16px/, "16px resource-control button"],
    [/\.uesrpg-group-toggle-button[\s\S]*?min-height:\s*24px[\s\S]*?height:\s*24px/, "24px equipment disclosure lane"],
  ];
  for (const [pattern, label] of baselineContracts) {
    if (!pattern.test(stylesheet)) fail(`styles/uesrpg.css is missing the ${label} baseline contract`);
  }

  const tabsTemplate = fs.readFileSync(path.join(ROOT, "templates", "v2", "sheets", "item-parts", "tabs.hbs"), "utf8");
  if (!/<button\b[^>]*\bdata-action="tab"[^>]*\buesrpg-plain-control\b/.test(tabsTemplate)
      && !/<button\b[^>]*\buesrpg-plain-control\b[^>]*\bdata-action="tab"/.test(tabsTemplate)) {
    fail("templates/v2/sheets/item-parts/tabs.hbs lacks the plain-control role on native Item tab buttons");
  }

  const itemSheetSource = fs.readFileSync(path.join(ROOT, "src", "ui", "sheets", "v2", "item-sheet.js"), "utf8");
  if (!/filterAllowedFormPaths\(formData\.object,\s*ALLOW_ITEM_FORM_PATH\)/.test(itemSheetSource)) {
    fail("src/ui/sheets/v2/item-sheet.js does not allow-list submit-on-close document fields");
  }
  if (!/exact:\s*\["name"\]/.test(itemSheetSource)
      || !/"system\."/.test(itemSheetSource)
      || !/"flags\."/.test(itemSheetSource)
      || /exact:\s*\[[^\]]*"img"/.test(itemSheetSource)) {
    fail("src/ui/sheets/v2/item-sheet.js has an unsafe Item form path allow-list");
  }

  const localizedNotificationSources = [
    ...walkDirectoryFiles(path.join(ROOT, "src/ui/apps/v2")),
    ...walkDirectoryFiles(path.join(ROOT, "src/ui/sheets/v2")),
  ].filter((file) => file.endsWith(".js"));
  const literalNotificationPattern = /ui\.notifications(?:\?\.)?\.(?:info|warn|error)(?:\?\.)?\(\s*(?:["'`])/g;
  for (const file of localizedNotificationSources) {
    const relative = normalizePackagePath(path.relative(ROOT, file));
    const source = fs.readFileSync(file, "utf8");
    if (literalNotificationPattern.test(source)) {
      fail(`${relative} contains a directly embedded runtime notification string`);
    }
    literalNotificationPattern.lastIndex = 0;
  }

  const javascriptFiles = walkDirectoryFiles(path.join(ROOT, "src"))
    .filter((file) => file.endsWith(".js"));
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

    if (relative.startsWith("src/ui/apps/v2/") || relative.startsWith("src/ui/sheets/v2/")) {
      if (/\bget\s+form\s*\(/.test(source)) {
        fail(`${relative} reintroduces a redundant form accessor; use ApplicationV2#form`);
      }
      if (/_onClose\s*\([^)]*\)\s*\{[\s\S]{0,800}(?:requestSubmit|\._onSubmit|\.submit\s*\()/m.test(source)) {
        fail(`${relative} performs manual close-time form submission; flush pending edits in _preClose`);
      }
    }

    // Generated options also live in core-owned DialogV2 workflows.
    for (const option of source.matchAll(/<option\b[\s\S]*?<\/option>/g)) {
      for (const interpolation of option[0].matchAll(/\$\{([^}]*)\}/g)) {
        const expression = interpolation[1];
        if (/\.(?:label|name)\b/.test(expression) && !/(?:escapeHTML|escapeHtml|escapeLuckHtml|\b_?esc)\s*\(/.test(expression)) {
          fail(`${relative} interpolates an unescaped label or name into generated option markup`);
        }
      }
    }
  }

  notes.push("Validated well-formed single-root AppV2 parts, semantic controls and visual roles, 14.1.1 control geometry contracts, explicit button types, accessible names, instance-safe ids, localized actions and notifications, safe option markup, and deterministic form lifecycle safeguards.");
}

function validateFoundryPatchCompatibility() {
  // The manifest targets 14.368+. APIs documented in v14 are not rejected
  // merely because the previous compatibility floor was 14.363.
  const files = walkDirectoryFiles(path.join(ROOT, "src"));
  for (const file of files.filter((entry) => entry.endsWith(".js"))) {
    if (normalizePackagePath(path.relative(ROOT, file)) === "src/utils/compat.js") continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bbuildEffectChange\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
      if (!/\bpriority\s*:/.test(match[1])) {
        fail(`${path.relative(ROOT, file)} creates an Active Effect change without explicit priority`);
      }
    }
  }

  notes.push("Validated explicit priorities for system-built Active Effect changes (Foundry 14.368+ target).");
}

function validateModernRuntimeSafety() {
  const jsFiles = walkDirectoryFiles(path.join(ROOT, "src")).filter((file) => file.endsWith(".js"));
  const serializedDataCleanupAllowlist = new Set([
    "src/core/enchanting/stored-spell-doc.js",
    "src/core/religion/content-sync.js",
    "src/data/religion/content-builders.js",
    "src/ui/shared/stored-spell-options.js",
  ]);

  for (const file of jsFiles) {
    const relative = normalizePackagePath(path.relative(ROOT, file));
    const source = fs.readFileSync(file, "utf8");

    if (relative !== "src/utils/authority-intents.js" && /\bCONFIG\.queries\b/.test(source)) {
      fail(`${relative} registers or accesses raw document queries outside the sealed authority service`);
    }
    if (/\bgame\.socket\.(?:emit|on)\s*\(/.test(source)) {
      fail(`${relative} uses a raw system socket; use a requester-bound authority intent or a documented Foundry query`);
    }
    if (/\bui\.chat\.render\s*\(/.test(source)) {
      fail(`${relative} forces a full ChatLog render after a document update`);
    }
    if (/\b(?:startTime|startRound|startTurn)\s*:/.test(source)) {
      fail(`${relative} creates or copies a legacy Active Effect duration anchor`);
    }
    if (/\beffect(?:\?\.|\.)duration(?:\?\.|\.)(?:seconds|rounds|turns|startTime|startRound|startTurn|combat)\b/.test(source)
        || /\b(?:duration|dur|live)(?:\?\.|\.)(?:seconds|rounds|turns|startTime|startRound|startTurn|combat)\b/.test(source)) {
      fail(`${relative} reads a deprecated Active Effect duration compatibility property`);
    }
    if (/\._(?:source|object|stats)\b/.test(source) && !serializedDataCleanupAllowlist.has(relative)) {
      fail(`${relative} accesses a private Foundry document property`);
    }
    if (/\._(?:total|formula|evaluated|dice|root|resolver)\b/.test(source)) {
      fail(`${relative} accesses a private Foundry Roll property`);
    }
  }

  notes.push("Validated sealed authority boundaries, canonical Active Effect duration access, public document APIs, and render discipline.");
}

function validateUiArchitectureAndTextEncoding() {
  const sourceFiles = walkDirectoryFiles(path.join(ROOT, "src"))
    .filter((file) => file.endsWith(".js"));
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
    ...walkDirectoryFiles(path.join(ROOT, "docs")).filter((file) => file.endsWith(".md")),
    path.join(ROOT, "lang", "en.json"),
    path.join(ROOT, "README.md"),
  ];
  for (const file of englishSourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    if (/\uFFFD|[\u0400-\u04FF]/u.test(source)) {
      fail(`${path.relative(ROOT, file)} contains replacement or mojibake characters`);
    }
  }

  notes.push("Validated ApplicationV2-only UI patterns and English-source text encoding.");
}

function validateDocumentationLinks() {
  const markdownFiles = [
    path.join(ROOT, "README.md"),
    ...walkDirectoryFiles(path.join(ROOT, "docs")).filter((file) => file.endsWith(".md")),
  ].filter((file) => fs.existsSync(file));

  for (const file of markdownFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = String(match[1] ?? "").trim().replace(/^<|>$/g, "");
      if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
      const withoutFragment = target.split("#", 1)[0];
      if (!withoutFragment) continue;
      const documentPath = normalizePackagePath(path.relative(ROOT, file));
      let localPath;
      try {
        localPath = decodeURIComponent(withoutFragment);
      } catch (_error) {
        fail(`${documentPath} links to an invalid encoded local path ${target}`);
        continue;
      }
      // Check both path conventions before resolving against the host filesystem.
      if (path.win32.isAbsolute(localPath) || path.posix.isAbsolute(localPath)
        || /^[A-Za-z]:|^file:/i.test(localPath) || localPath.includes("\\")) {
        fail(`${documentPath} links to a non-portable local path ${target}; use a repository-relative link`);
        continue;
      }
      const resolved = path.resolve(path.dirname(file), localPath);
      const relative = path.relative(ROOT, resolved);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        fail(`${documentPath} links outside the repository: ${target}`);
        continue;
      }
      if (SOURCE_EXCLUDES.has(relative.split(path.sep)[0])) {
        fail(`${documentPath} links to an excluded local artifact ${target}; record its path as plain text`);
        continue;
      }
      if (!fs.existsSync(resolved)) {
        // Source links may append :line or :line:column to an existing file.
        const sourceFile = resolved.replace(/:[1-9]\d*(?::[1-9]\d*)?$/, "");
        if (sourceFile === resolved || !fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
          fail(`${documentPath} links to missing local path ${target}`);
        }
      }
    }
  }

  notes.push(`Validated portable repository-relative links in ${markdownFiles.length} Markdown documentation files.`);
}

function validateStylesheetReferences(manifest) {
  for (const stylesheet of manifest?.styles ?? []) {
    const normalized = normalizePackagePath(stylesheet);
    const absolutePath = path.join(ROOT, ...normalized.split("/"));
    if (!fs.existsSync(absolutePath)) continue;
    const source = fs.readFileSync(absolutePath, "utf8");
    for (const match of source.matchAll(/\/\*#\s*sourceMappingURL=([^*\s]+)\s*\*\//g)) {
      const mapPath = path.resolve(path.dirname(absolutePath), match[1]);
      if (!fs.existsSync(mapPath)) {
        fail(`${normalized} references missing source map ${match[1]}`);
      }
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

function validateReleaseAutomation() {
  const releaseWorkflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "main.yml"), "utf8");
  const validationWorkflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "validate.yml"), "utf8");
  const requiredReleaseFragments = [
    "tags:",
    "Validate tag, commit, and release identity",
    "--draft",
    "verify-github-release.js --draft",
    "verify-github-release.js --published",
    "npm audit --audit-level=high",
    "npm run schema:check",
  ];
  for (const fragment of requiredReleaseFragments) {
    if (!releaseWorkflow.includes(fragment)) fail(`Release workflow is missing ${fragment}`);
  }
  if (/workflow_dispatch|--clobber/.test(releaseWorkflow)) {
    fail("Release workflow permits a manual or mutable release path");
  }
  for (const fragment of ["npm run syntax:check", "npm run lint", "npm audit --audit-level=high", "npm run schema:check", "npm run validate", "npm run build:folder"]) {
    if (!validationWorkflow.includes(fragment)) fail(`Validation workflow is missing ${fragment}`);
  }
  notes.push("Validated immutable tag-release and pull-request workflow safeguards.");
}

function validateSourceLayout(manifest, packageJson, packageLock) {
  if (!manifest || !packageJson || !packageLock) return;

  if (manifest.id !== packageJson.name) fail(`Manifest id ${manifest.id} does not match package name ${packageJson.name}`);
  if (manifest.version !== packageJson.version) fail(`Manifest version ${manifest.version} does not match package version ${packageJson.version}`);
  if (packageLock.name !== packageJson.name || packageLock.packages?.[""]?.name !== packageJson.name) {
    fail(`package-lock.json package name does not match package.json name ${packageJson.name}`);
  }
  if (packageLock.version !== packageJson.version || packageLock.packages?.[""]?.version !== packageJson.version) {
    fail(`package-lock.json version does not match package.json version ${packageJson.version}`);
  }
  if (!SEMVER_PATTERN.test(String(manifest.version ?? ""))) fail(`Manifest version ${manifest.version} is not plain SemVer`);
  try {
    const metadata = getReleaseMetadata(packageJson.version);
    if (manifest.manifest !== metadata.manifestUrl) fail(`Manifest URL must be ${metadata.manifestUrl}`);
    if (manifest.download !== metadata.downloadUrl) fail(`Download URL must be ${metadata.downloadUrl}`);
  } catch (error) {
    fail(`Release metadata is invalid: ${error.message}`);
  }
  if (manifest?.compatibility?.minimum !== "14.368"
      || manifest?.compatibility?.verified !== "14.368"
      || String(manifest?.compatibility?.maximum ?? "") !== "14") {
    fail("system.json compatibility must remain minimum 14.368, verified 14.368, maximum 14");
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

function collectSourceFiles({ requiredFiles, optionalFiles = [], requiredDirectories, label }) {
  const files = [];
  for (const relativePath of requiredFiles) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      fail(`Required ${label} file is missing: ${relativePath}`);
      continue;
    }
    files.push(absolutePath);
  }
  for (const relativePath of optionalFiles) {
    const absolutePath = path.join(ROOT, relativePath);
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) files.push(absolutePath);
  }
  for (const relativePath of requiredDirectories) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
      fail(`Required ${label} directory is missing: ${relativePath}`);
      continue;
    }
    files.push(...walkDirectoryFiles(absolutePath).filter((file) => !isTransientPackPath(file)));
  }
  return files.sort((left, right) => normalizePackagePath(path.relative(ROOT, left))
    .localeCompare(normalizePackagePath(path.relative(ROOT, right))));
}

function collectReleaseSourceFiles() {
  return collectSourceFiles({
    requiredFiles: RELEASE_FILES,
    optionalFiles: OPTIONAL_RELEASE_FILES,
    requiredDirectories: RELEASE_DIRECTORIES,
    label: "release",
  });
}

function collectGithubSourceFiles() {
  return collectSourceFiles({
    requiredFiles: GITHUB_SOURCE_FILES,
    requiredDirectories: GITHUB_SOURCE_DIRECTORIES,
    label: "GitHub source",
  });
}

function cleanDistFolder(destination, folderName) {
  if (![RELEASE_FOLDER_NAME, GITHUB_SOURCE_FOLDER_NAME].includes(folderName)) {
    throw new Error(`Refusing to clean unregistered dist folder ${folderName}`);
  }
  const expected = path.resolve(ROOT, "dist", folderName);
  const resolved = path.resolve(destination);
  if (resolved !== expected) throw new Error(`Refusing to clean unexpected dist path ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}

function validateCopiedSourceFolder(destination, sourceFiles, label) {
  const expectedFiles = new Map(sourceFiles.map((source) => [
    normalizePackagePath(path.relative(ROOT, source)),
    source,
  ]));
  const actualFiles = walkDirectoryFiles(destination).map((file) =>
    normalizePackagePath(path.relative(destination, file)));

  for (const relativePath of expectedFiles.keys()) {
    if (!actualFiles.includes(relativePath)) fail(`${label} is missing ${relativePath}`);
  }
  for (const relativePath of actualFiles) {
    if (!expectedFiles.has(relativePath)) fail(`${label} contains unexpected file ${relativePath}`);
  }
  for (const [relativePath, source] of expectedFiles) {
    const output = path.join(destination, ...relativePath.split("/"));
    if (!fs.existsSync(output)) continue;
    if (!fs.readFileSync(source).equals(fs.readFileSync(output))) {
      fail(`${label} file differs from its source: ${relativePath}`);
    }
  }

  notes.push(`Verified ${actualFiles.length} files in ${normalizePackagePath(path.relative(ROOT, destination))}.`);
}

function validateBuiltReleaseFolder(destination, sourceFiles, manifest) {
  validateCopiedSourceFolder(destination, sourceFiles, "Ready release folder");

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

}

function validateBuiltGithubSourceFolder(destination, sourceFiles, manifest) {
  validateCopiedSourceFolder(destination, sourceFiles, "GitHub source folder");

  for (const relativePath of SOURCE_EXCLUDES) {
    if (fs.existsSync(path.join(destination, relativePath))) {
      fail(`GitHub source folder contains local-only directory ${relativePath}`);
    }
  }

  const stagedFiles = walkDirectoryFiles(destination);
  for (const file of stagedFiles) {
    const relativePath = normalizePackagePath(path.relative(destination, file));
    if (relativePath.endsWith(".zip") || isTransientPackPath(path.join(ROOT, relativePath))) {
      fail(`GitHub source folder contains excluded file ${relativePath}`);
    }
  }

  try {
    const stagedManifest = JSON.parse(fs.readFileSync(path.join(destination, "system.json"), "utf8"));
    const stagedPackage = JSON.parse(fs.readFileSync(path.join(destination, "package.json"), "utf8"));
    const stagedLock = JSON.parse(fs.readFileSync(path.join(destination, "package-lock.json"), "utf8"));
    const versions = [stagedManifest.version, stagedPackage.version, stagedLock.version, stagedLock.packages?.[""]?.version];
    if (versions.some((version) => version !== manifest?.version)) {
      fail(`GitHub source version metadata must consistently equal ${manifest?.version}`);
    }
  } catch (error) {
    fail(`GitHub source version metadata is missing or invalid: ${error.message}`);
  }
}

function buildSourceFolder({ folderName, sourceFiles, validateFolder, description }) {
  const destination = path.resolve(ROOT, "dist", folderName);
  if (errors.length) return null;

  try {
    cleanDistFolder(destination, folderName);
    fs.mkdirSync(destination, { recursive: true });
    for (const source of sourceFiles) {
      const relativePath = normalizePackagePath(path.relative(ROOT, source));
      const output = path.join(destination, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(source, output);
    }
    validateFolder(destination, sourceFiles);
  } catch (error) {
    try {
      cleanDistFolder(destination, folderName);
    } catch (_cleanupError) {
      // Preserve the original build failure below.
    }
    fail(`Could not build ${description}: ${error.message}`);
    return null;
  }

  notes.push(`Built ${description} ${normalizePackagePath(path.relative(ROOT, destination))}.`);
  return destination;
}

function buildReleaseFolder(manifest) {
  return buildSourceFolder({
    folderName: RELEASE_FOLDER_NAME,
    sourceFiles: collectReleaseSourceFiles(),
    validateFolder: (destination, sourceFiles) => validateBuiltReleaseFolder(destination, sourceFiles, manifest),
    description: "ready release folder",
  });
}

function buildGithubSourceFolder(manifest) {
  return buildSourceFolder({
    folderName: GITHUB_SOURCE_FOLDER_NAME,
    sourceFiles: collectGithubSourceFiles(),
    validateFolder: (destination, sourceFiles) => validateBuiltGithubSourceFolder(destination, sourceFiles, manifest),
    description: "GitHub source folder",
  });
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
    if (archivedManifest.id !== manifest?.id) {
      fail(`Archived manifest id ${archivedManifest.id} does not match source manifest id ${manifest?.id}`);
    }
    if (archivedManifest.version !== manifest?.version) {
      fail(`Archived manifest version ${archivedManifest.version} does not match source manifest version ${manifest?.version}`);
    }
    if (!SEMVER_PATTERN.test(String(archivedManifest.version ?? ""))) {
      fail(`Archived manifest version ${archivedManifest.version} is not plain SemVer`);
    }
  } catch (error) {
    fail(`Archived system.json is missing or invalid: ${error.message}`);
  }

  notes.push(`Checked ${entries.size} release archive entries in ${path.basename(archivePath)}.`);
}

function parseArchiveArgument(argv) {
  const index = argv.indexOf("--archive");
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail("--archive requires a ZIP path");
    return null;
  }
  return value;
}

function main() {
  const argv = process.argv.slice(2);
  const manifest = readJson("system.json");
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const template = readJson("template.json");
  const language = readJson("lang/en.json");

  validateSourceLayout(manifest, packageJson, packageLock);
  validateJavaScriptSyntax();
  validateImportsAndTemplates();
  validateStaticImportGraph();
  validateLocalizationAndTemplates(language);
  validateIncrementalUiSafety();
  validateFoundryPatchCompatibility();
  validateModernRuntimeSafety();
  validateUiArchitectureAndTextEncoding();
  validateDocumentationLinks();
  validateStylesheetReferences(manifest);
  validateCoreIntegrationSafety();
  validateReleaseAutomation();
  validateSchemaDrift(manifest, template);
  validateMigrationRegistry();
  try {
    notes.push(...checkDataCatalogs({ root: ROOT }));
    const consolidationErrors = checkConsolidation(ROOT, {
      resolveModule: resolveRelativeModule,
      onBindingReport: (report) => {
        notes.push("Validated " + report.checkedBindings + " import/export bindings across " + report.moduleCount
          + " runtime modules, including " + report.dynamicImports + " literal/computed dynamic imports.");
        for (const warning of report.warnings) notes.push("Module binding coverage limit: " + warning);
      },
    });
    for (const error of consolidationErrors) fail(error);
    if (!consolidationErrors.length) notes.push("Validated canonical damage entry points, shared helper ownership and ordered combat dispatch.");
  } catch (error) {
    fail(`Consolidation validation failed: ${error.message}`);
  }

  if (argv.includes("--build-folder") && !errors.length) buildReleaseFolder(manifest);
  if (argv.includes("--build-github-source") && !errors.length) buildGithubSourceFolder(manifest);

  const archiveArgument = parseArchiveArgument(argv);
  if (archiveArgument) validateArchive(archiveArgument, manifest);

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
