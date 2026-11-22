// Cheap lint for a small vanilla-JS plugin: the recommended rule set plus Node
// globals. No formatting rules, so the existing code passes unchanged.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
];
