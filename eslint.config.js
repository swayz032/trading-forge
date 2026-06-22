import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
      // Phase 0 hardening (2026-06-22): the eslint 9 -> 10 bump (required to clear the
      // @eslint/js@10 ERESOLVE that was breaking `npm ci` on every CI push) promoted three
      // rules into eslint:recommended. They surface ~31 pre-existing findings across service
      // code that are NOT in scope for the CI-wiring workstream. Demote to "warn" so the bump
      // stays net-neutral on the lint job (lint was never reached in CI before because npm ci
      // died first). Re-promote to "error" and burn down in a dedicated lint-hardening pass.
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
      "no-unassigned-vars": "warn",
    },
  },
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "src/engine/**",
      "src/dashboard/**",
      "Trading_forge_frontend/**",
      "**/*.d.ts",
      "**/*.js",
      "**/*.mjs",
    ],
  },
);
