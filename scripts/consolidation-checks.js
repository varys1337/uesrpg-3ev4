"use strict";

const fs = require("node:fs");
const path = require("node:path");
const espree = require("espree");
const { Linter } = require("eslint");

const RAW_DAMAGE = new Map([
  ["src/core/combat/damage/apply.js", new Set(["applyDamage", "applyHealing"])],
  ["src/core/combat/damage/resolver/resolve.js", new Set(["applyDamageResolved"])],
]);
const DAMAGE_OWNER = "src/application/combat/apply-damage-service.js";
const BOUNDARY_OBSERVERS = new Set([
  "src/core/documents/combat/hooks.js", // Dynamic initiative summary, after consumers.
  "src/ui/sheets/v2/shared/combat-tracker-refresh.js", // AppV2 presentation refresh.
]);
const SHARED_FUNCTIONS = new Map([
  ["calculateHealthDamage", "src/core/combat/damage/post-application.js"],
  ["normalizeArmorLocationKey", "src/core/combat/damage/resolver/normalize.js"],
  ["normalizeDiceExpression", "src/core/documents/item-utils.js"],
  ["parseRangeTriplet", "src/core/documents/item-utils.js"],
  ["emitSuppressedSubRollDice", "src/utils/dice-visualization.js"],
  ["getOwnerAndGmRecipientIds", "src/utils/chat-recipients.js"],
  ["resolveEffectCastLevel", "src/core/active-effects/effect-duration-v14.js"],
  ["pushAdvantageMarker", "src/core/combat/opposed/schema.js"],
]);

function walk(node, visit, parent = null) {
  if (!node || typeof node !== "object") return;
  if (node.type) visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (["tokens", "comments", "parent", "loc", "range"].includes(key)) continue;
    if (Array.isArray(value)) for (const child of value) walk(child, visit, node);
    else if (value && typeof value === "object") walk(value, visit, node);
  }
}

function listModules(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? listModules(path.join(dir, entry.name)) : entry.name.endsWith(".js") ? [path.join(dir, entry.name)] : []);
}

function checkConsolidation(root, { resolveModule, onBindingReport } = {}) {
  const errors = [];
  const functions = [];
  const sources = new Map();
  const linter = new Linter();
  for (const file of listModules(path.join(root, "src"))) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const source = fs.readFileSync(file, "utf8");
    const messages = linter.verify(source, [{ languageOptions: {
      parser: espree, ecmaVersion: "latest", sourceType: "module",
    }, rules: {} }], { filename: "runtime.js", allowInlineConfig: false });
    const fatal = messages.find((message) => message.fatal);
    if (fatal) { errors.push(relative + ":" + fatal.line + " " + fatal.message); continue; }
    const sourceCode = linter.getSourceCode();
    sources.set(file, sourceCode);
    const ast = sourceCode.ast;
    walk(ast, (node) => {
      if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(node.type) && node.source?.value?.startsWith(".")) {
        const dependency = path.relative(root, path.resolve(path.dirname(file), node.source.value)).replaceAll("\\", "/");
        const raw = RAW_DAMAGE.get(dependency);
        if (raw && relative !== DAMAGE_OWNER) {
          const accessesRaw = !node.specifiers?.length || node.specifiers.some((specifier) =>
            specifier.type === "ImportNamespaceSpecifier" || raw.has(specifier.imported?.name ?? specifier.local?.name));
          if (accessesRaw) errors.push(`${relative}:${node.loc.start.line} bypasses ApplyDamageService via ${dependency}.`);
        }
      }
      if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type) && node.body?.type === "BlockStatement") {
        const tokens = ast.tokens.filter((token) => token.range[0] >= node.body.range[0] && token.range[1] <= node.body.range[1]);
        if (tokens.length >= 40 || SHARED_FUNCTIONS.has(node.id?.name)) functions.push({ relative, name: node.id?.name, line: node.loc.start.line,
          signature: tokens.map((token) => `${token.type}:${token.value}`).join("|") });
      }
      if (node.type === "FunctionDeclaration" && ["_handleBoundaryLegacy", "runLegacyFeatureAutomation"].includes(node.id?.name)) {
        errors.push(`${relative}:${node.loc.start.line} reintroduces a retired execution pipeline.`);
      }
      if (node.type === "CallExpression" && node.callee?.object?.name === "Hooks" && node.callee?.property?.name === "on"
          && node.arguments[0]?.value === "uesrpg.combatTimeChanged" && !BOUNDARY_OBSERVERS.has(relative)) {
        errors.push(`${relative}:${node.loc.start.line} registers a parallel combat boundary listener; register an ordered consumer instead.`);
      }
    });
  }
  for (const [name, owner] of SHARED_FUNCTIONS) {
    const canonical = functions.find((entry) => entry.relative === owner && entry.name === name);
    if (!canonical) { errors.push(`Missing canonical helper ${name} in ${owner}.`); continue; }
    for (const duplicate of functions) {
      if (duplicate === canonical || duplicate.signature !== canonical.signature) continue;
      errors.push(`${duplicate.relative}:${duplicate.line} duplicates ${name}; import it from ${owner}.`);
    }
  }
  const report = checkModuleBindings(sources, resolveModule, root);
  errors.push(...report.errors);
  onBindingReport?.(report);
  return errors;
}

function bindingName(node) {
  return node?.name ?? node?.value;
}

function literalString(node) {
  if (typeof node?.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && !node.expressions.length) return node.quasis[0].value.cooked;
  return null;
}

function propertyName(node) {
  return node?.computed ? literalString(node.property ?? node.key) : bindingName(node?.property ?? node?.key);
}

function boundNames(pattern) {
  if (!pattern) return [];
  if (pattern.type === "Identifier") return [pattern.name];
  if (pattern.type === "ObjectPattern") return pattern.properties.flatMap((entry) =>
    boundNames(entry.type === "RestElement" ? entry.argument : entry.value));
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(boundNames);
  if (pattern.type === "AssignmentPattern") return boundNames(pattern.left);
  if (pattern.type === "RestElement") return boundNames(pattern.argument);
  return [];
}

/**
 * Inspect already-parsed ES modules without evaluating Foundry code.
 * The caller supplies the release validator's resolver; no second path policy.
 * SourceCode scope data keeps namespace checks bound to the actual variable.
 */
function checkModuleBindings(sources, resolveModule, root = process.cwd()) {
  if (typeof resolveModule !== "function") throw new TypeError("Module binding validation requires a relative-module resolver.");
  const modules = new Map();
  const checks = [];
  const errors = [];
  const warnings = new Set();
  let dynamicImports = 0;
  let checkedBindings = 0;
  const display = (file) => path.relative(root, file).replaceAll("\\", "/");
  const warn = (file, node, reason) => warnings.add(display(file) + ":" + node.loc.start.line + " " + reason);
  const request = (file, target, name, node, kind) => checks.push({ file, target, name, node, kind });

  for (const [file, sourceCode] of sources) {
    const data = { file, sourceCode, nodes: [], parents: new WeakMap(), imports: new Map(), exports: new Map(),
      stars: [], unknownStars: false, variables: new WeakMap(), references: new WeakMap() };
    modules.set(file, data);
    walk(sourceCode.ast, (node, parent) => {
      data.nodes.push(node);
      if (parent) data.parents.set(node, parent);
    });
    for (const scope of sourceCode.scopeManager.scopes) {
      for (const variable of scope.variables) {
        for (const identifier of variable.identifiers) data.variables.set(identifier, variable);
      }
      for (const reference of scope.references) data.references.set(reference.identifier, reference.resolved);
    }
    const locals = new Set(sourceCode.scopeManager.scopes.find((scope) => scope.type === "module")?.variables.map((variable) => variable.name));
    const targetOf = (specifier, node) => {
      if (!specifier?.startsWith(".")) return null;
      const target = resolveModule(file, specifier);
      if (!target) errors.push(display(file) + ":" + node.loc.start.line + " has unresolved relative module " + specifier + ".");
      return target;
    };
    for (const node of sourceCode.ast.body) {
      if (node.type === "ImportDeclaration") {
        const target = targetOf(node.source.value, node);
        for (const specifier of node.specifiers) {
          const name = specifier.type === "ImportNamespaceSpecifier" ? "*"
            : specifier.type === "ImportDefaultSpecifier" ? "default" : bindingName(specifier.imported);
          data.imports.set(specifier.local.name, { target, name, node: specifier });
          if (name !== "*") request(file, target, name, specifier, "import");
        }
      } else if (node.type === "ExportDefaultDeclaration") {
        // A default expression creates its own binding, even when it is an identifier.
        const declaration = node.declaration;
        const local = ["FunctionDeclaration", "ClassDeclaration"].includes(declaration.type) && declaration.id
          ? declaration.id.name : "#default";
        data.exports.set("default", { local });
      } else if (node.type === "ExportNamedDeclaration") {
        if (node.declaration) {
          const declaration = node.declaration;
          const names = declaration.type === "VariableDeclaration"
            ? declaration.declarations.flatMap((entry) => boundNames(entry.id)) : [declaration.id.name];
          for (const local of names) data.exports.set(local, { local });
        }
        const target = node.source ? targetOf(node.source.value, node) : null;
        for (const specifier of node.specifiers) {
          const name = bindingName(specifier.local);
          const exported = bindingName(specifier.exported);
          if (node.source) {
            data.exports.set(exported, { target, name });
            request(file, target, name, specifier, "re-export");
          } else {
            data.exports.set(exported, { local: name });
            if (!locals.has(name)) errors.push(display(file) + ":" + specifier.loc.start.line
              + " exports undeclared local binding " + name + ".");
          }
        }
      } else if (node.type === "ExportAllDeclaration") {
        const target = targetOf(node.source.value, node);
        if (node.exported) data.exports.set(bindingName(node.exported), { namespace: target });
        else if (target) data.stars.push(target);
        else data.unknownStars = true;
      }
    }
  }

  function resolveExport(file, name, visited = new Set()) {
    const key = file + "::" + name;
    if (visited.has(key)) return { bindings: new Set(), unknown: false };
    const data = modules.get(file);
    if (!data) return { bindings: new Set(), unknown: true };
    const next = new Set(visited);
    next.add(key);
    const own = data.exports.get(name);
    if (own) {
      if (Object.hasOwn(own, "namespace")) return own.namespace
        ? { bindings: new Set([own.namespace + "::#namespace"]), unknown: !modules.has(own.namespace) }
        : { bindings: new Set(), unknown: true };
      if (Object.hasOwn(own, "target")) return resolveExport(own.target, own.name, next);
      const imported = data.imports.get(own.local);
      if (imported) return imported.name === "*"
        ? { bindings: new Set(imported.target ? [imported.target + "::#namespace"] : []), unknown: !modules.has(imported.target) }
        : resolveExport(imported.target, imported.name, next);
      return { bindings: new Set([file + "::" + own.local]), unknown: false };
    }
    if (name === "default") return { bindings: new Set(), unknown: false };
    const bindings = new Set();
    let unknown = data.unknownStars;
    for (const target of data.stars) {
      const result = resolveExport(target, name, next);
      for (const binding of result.bindings) bindings.add(binding);
      unknown ||= result.unknown;
    }
    return { bindings, unknown };
  }

  function namespaceExport(target, name) {
    const resolved = resolveExport(target, name);
    if (resolved.unknown || resolved.bindings.size !== 1) return null;
    const binding = resolved.bindings.values().next().value;
    return binding.endsWith("::#namespace") ? binding.slice(0, -"::#namespace".length) : null;
  }

  for (const data of modules.values()) {
    const { file, sourceCode, nodes, parents, variables, references } = data;
    const namespaces = new Map();
    const consumed = new Set();
    const unwrap = (node) => node?.type === "AwaitExpression" ? node.argument : node;
    const importOf = (node) => {
      const expression = unwrap(node);
      if (expression?.type !== "ImportExpression") return null;
      consumed.add(expression);
      const specifier = literalString(expression.source);
      return specifier?.startsWith(".") ? resolveModule(file, specifier) : null;
    };
    const associate = (pattern, target) => {
      if (!pattern || !target) return;
      if (pattern.type === "Identifier") {
        const variable = variables.get(pattern);
        if (!variable) return;
        if (variable.defs.length > 1 || variable.references.some((reference) =>
          reference.isWrite() && !variable.identifiers.includes(reference.identifier))) {
          warn(file, pattern, "mutable namespace binding is outside static export checks.");
          return;
        }
        namespaces.set(variable, target);
      } else if (pattern.type === "ObjectPattern") {
        for (const property of pattern.properties) {
          if (property.type === "RestElement") {
            warn(file, property, "namespace rest destructuring is outside static export checks.");
            continue;
          }
          const name = propertyName(property);
          if (typeof name !== "string") {
            warn(file, property, "computed namespace destructuring is outside static export checks.");
            continue;
          }
          request(file, target, name, property, "dynamic/namespace destructuring");
          const value = property.value.type === "AssignmentPattern" ? property.value.left : property.value;
          const nested = namespaceExport(target, name);
          if (nested) associate(value, nested);
        }
      } else {
        warn(file, pattern, "namespace binding pattern is outside static export checks.");
      }
    };
    const inspectUse = (node, target) => {
      let parent = parents.get(node);
      if (parent?.type === "ChainExpression") { node = parent; parent = parents.get(node); }
      if (parent?.type === "MemberExpression" && parent.object === node) {
        const name = propertyName(parent);
        if (typeof name !== "string") warn(file, parent, "computed namespace member is outside static export checks.");
        else {
          request(file, target, name, parent, "namespace member");
          const nested = namespaceExport(target, name);
          if (nested) inspectUse(parent, nested);
        }
      } else if (parent?.type === "VariableDeclarator" && parent.init === node) {
        associate(parent.id, target);
      } else if (parent?.type !== "ExpressionStatement") {
        warn(file, node, "namespace passed beyond a direct binding/access is outside static export checks.");
      }
    };
    for (const node of sourceCode.ast.body) {
      if (node.type !== "ImportDeclaration") continue;
      for (const specifier of node.specifiers) {
        const imported = data.imports.get(specifier.local.name);
        const target = imported.name === "*" ? imported.target : namespaceExport(imported.target, imported.name);
        if (target) associate(specifier.local, target);
      }
    }
    for (const node of nodes) {
      if (node.type === "VariableDeclarator") {
        const target = importOf(node.init);
        if (target) associate(node.id, target);
        const init = unwrap(node.init);
        const promise = init?.callee?.object;
        const variable = promise?.type === "Identifier" ? references.get(promise) : null;
        if (node.id.type === "ArrayPattern" && init?.type === "CallExpression"
            && promise?.name === "Promise" && !variable?.defs.length && propertyName(init.callee) === "all"
            && init.arguments[0]?.type === "ArrayExpression") {
          node.id.elements.forEach((pattern, index) => {
            const target = importOf(init.arguments[0].elements[index]);
            if (target) associate(pattern, target);
          });
        }
      } else if (node.type === "CallExpression" && propertyName(node.callee) === "then") {
        const target = importOf(node.callee.object);
        const callback = node.arguments[0];
        if (target && ["ArrowFunctionExpression", "FunctionExpression"].includes(callback?.type)) associate(callback.params[0], target);
        else if (target) warn(file, node, "dynamic-import callback is outside static export checks.");
      }
    }
    // Map iteration also visits immutable namespace aliases discovered by inspectUse.
    for (const [variable, target] of namespaces) {
      for (const reference of variable.references) if (reference.isRead()) inspectUse(reference.identifier, target);
    }
    for (const node of nodes) {
      if (node.type !== "ImportExpression") continue;
      dynamicImports++;
      const specifier = literalString(node.source);
      if (specifier === null) {
        warn(file, node, "computed dynamic-import path is outside static export checks.");
        continue;
      }
      if (consumed.has(node)) continue;
      const target = specifier.startsWith(".") ? resolveModule(file, specifier) : null;
      if (!target) {
        warn(file, node, "dynamic import outside the inspected module set has no export-binding coverage.");
        continue;
      }
      const parent = parents.get(node);
      if (parent?.type === "AwaitExpression") inspectUse(parent, target);
      else if (parent?.type !== "ExpressionStatement") warn(file, node, "dynamic-import promise is outside static export checks.");
    }
  }

  const reported = new Set();
  for (const check of checks) {
    const { file, target, name, node, kind } = check;
    if (!modules.has(target)) {
      warn(file, node, "export source is outside the inspected module set.");
      continue;
    }
    const result = resolveExport(target, name);
    if (result.bindings.size > 1 || (!result.bindings.size && !result.unknown)) {
      const key = file + ":" + node.range[0] + ":" + target + ":" + name;
      if (reported.has(key)) continue;
      reported.add(key);
      errors.push(display(file) + ":" + node.loc.start.line + " " + kind + " requests "
        + JSON.stringify(name) + " from " + display(target) + ", which "
        + (result.bindings.size > 1 ? "has ambiguous exports for that name." : "does not export that name."));
    } else if (result.unknown) warn(file, node, "export forwarding outside the inspected module set has incomplete binding coverage.");
    else checkedBindings++;
  }
  return { errors, warnings: [...warnings], moduleCount: modules.size, checkedBindings, dynamicImports };
}


module.exports = { checkConsolidation, checkModuleBindings };
