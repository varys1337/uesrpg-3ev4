"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const SYSTEM_PREFIX = "systems/uesrpg-3ev4/";
const RELEASE_FOLDER_NAME = "uesrpg-3ev4";
const RELEASE_REPOSITORY_URL = "https://github.com/varys1337/uesrpg-3ev4";
const RELEASE_MANIFEST_URL = `${RELEASE_REPOSITORY_URL}/releases/latest/download/system.json`;
const RELEASE_ARCHIVE_NAME = "uesrpg-3ev4.zip";
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
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

  for (const [key, value] of Object.entries(directSeed)) {
    if (!Object.hasOwn(generatedSeed, key) || !equalData(value, generatedSeed[key])) {
      fail(`${documentName}.${type} generated defaults differ from template.json at ${key}`);
    }
  }

  const referencedTemplates = (Array.isArray(directSeed.templates) ? directSeed.templates : [])
    .map((name) => documentTemplate?.templates?.[name])
    .filter(isPlainObject);
  for (const [key, value] of Object.entries(generatedSeed)) {
    if (Object.hasOwn(directSeed, key)) continue;
    const matchesTemplate = referencedTemplates.some((templateSeed) =>
      Object.hasOwn(templateSeed, key) && equalData(templateSeed[key], value));
    if (!matchesTemplate) {
      fail(`${documentName}.${type} generated-only default ${key} is not supplied by a referenced template`);
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

  notes.push(`Checked ${jsFiles.length} JavaScript files for relative imports and template references.`);
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
  }
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

  const expectedDownloadUrl = `${RELEASE_REPOSITORY_URL}/releases/download/v${manifest.version}/${RELEASE_ARCHIVE_NAME}`;
  if (manifest.manifest !== RELEASE_MANIFEST_URL) {
    fail(`Manifest update URL must be ${RELEASE_MANIFEST_URL}`);
  }
  if (manifest.download !== expectedDownloadUrl) {
    fail(`Manifest download URL must match version ${manifest.version}: ${expectedDownloadUrl}`);
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

  validateSourceLayout(manifest, packageJson, packageLock);
  validateImportsAndTemplates();
  validateCoreIntegrationSafety();
  validateSchemaDrift(manifest, template);

  if (argv.includes("--build-folder") && !errors.length) buildReleaseFolder(manifest);

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
