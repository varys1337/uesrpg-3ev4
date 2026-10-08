import globals from "globals";

const foundryGlobals = Object.fromEntries([
  "ActiveEffect", "Actor", "ActorSheetV2", "ApplicationV2", "ChatMessage", "Combat", "Combatant",
  "CONST", "CONFIG", "DialogV2", "DocumentSheetV2", "FilePicker", "Folder", "FormDataExtended",
  "Handlebars", "Hooks", "ImagePopout", "Item", "ItemSheetV2", "JournalEntry", "Macro", "PIXI",
  "Ray", "Roll", "RollTable", "Scene", "SearchFilter", "SettingsConfig", "TextEditor", "Token",
  "TokenDocument", "User", "VideoHelper", "canvas", "fromUuid", "fromUuidSync", "game", "loadTemplates",
  "renderTemplate", "ui",
].map((name) => [name, "readonly"]));

const correctnessRules = {
  "constructor-super": "error",
  "getter-return": "error",
  "no-class-assign": "error",
  "no-const-assign": "error",
  "no-dupe-args": "error",
  "no-dupe-class-members": "error",
  "no-dupe-keys": "error",
  "no-duplicate-case": "error",
  "no-duplicate-imports": "error",
  "no-func-assign": "error",
  "no-import-assign": "error",
  "no-loss-of-precision": "error",
  "no-new-native-nonconstructor": "error",
  "no-obj-calls": "error",
  "no-self-assign": "error",
  "no-setter-return": "error",
  "no-this-before-super": "error",
  "no-undef": "error",
  "no-unreachable": "error",
  "no-unreachable-loop": "error",
  "no-unsafe-finally": "error",
  "no-unsafe-negation": "error",
  "no-unsafe-optional-chaining": "error",
  "no-with": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
};

export default [
  {
    ignores: ["dist/**", "node_modules/**", "packs/**", "release/**"],
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2025,
        ...foundryGlobals,
        foundry: "readonly",
      },
    },
    rules: correctnessRules,
  },
  {
    files: ["scripts/**/*.js", "automation/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: correctnessRules,
  },
  {
    // Ratchet unused-code checks around consolidated owners without imposing a
    // repository-wide cleanup on unrelated mechanics.
    files: [
      "src/application/combat/apply-damage-service.js",
      "src/core/combat/damage/post-application.js",
      "src/core/combat/damage/aftermath-bundle.js",
      "src/core/combat/opposed/dialogs/advantage-options.js",
      "src/core/opposed/shared/card-persistence.js",
      "src/core/opposed/shared/card-rendering.js",
      "src/core/opposed/shared/fresh-commit.js",
      "src/core/opposed/shared/message-queue.js",
      "src/core/system/resource-updates.js",
      "src/core/time/combat-boundary-orchestrator.js",
      "src/core/magic/services/drain-service.js",
      "src/core/magic/services/resource-restoration-service.js",
      "src/utils/chat-recipients.js",
      "src/utils/dice-visualization.js",
      "src/utils/html.js",
      "scripts/consolidation-checks.js",
      "scripts/generate-data-catalogs.js",
    ],
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
    },
  },
  {
    files: ["eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: correctnessRules,
  },
];
