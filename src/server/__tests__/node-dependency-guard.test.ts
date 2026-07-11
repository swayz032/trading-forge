/**
 * node-dependency-guard.test.ts
 *
 * 2026-07-11 dep-wipe boot-guard. Verifies the critical-module resolution logic
 * the boot preflight uses: every REQUIRED_NODE_MODULES entry must be resolvable
 * from the server tree (if one is missing on the tower, the preflight surfaces it
 * in /api/health.nodeDependencies instead of a silent tsx crash-loop).
 *
 * This is a pure resolution check — it does not boot the server (which would pull
 * the DATABASE_URL guard). It mirrors the exact REQUIRED_NODE_MODULES list and the
 * createRequire(import.meta.url).resolve() mechanism used in index.ts.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

// Must stay in sync with REQUIRED_NODE_MODULES in src/server/index.ts.
const REQUIRED_NODE_MODULES = ["drizzle-orm", "postgres", "express", "openai", "pino", "zod"] as const;

describe("node dependency boot-guard", () => {
  it("every critical node module resolves in the current tree (a miss would flag a partial node_modules wipe)", () => {
    const require = createRequire(import.meta.url);
    const missing: string[] = [];
    for (const mod of REQUIRED_NODE_MODULES) {
      try {
        require.resolve(mod);
      } catch {
        missing.push(mod);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the resolution mechanism actually detects a missing module (guard isn't a no-op)", () => {
    const require = createRequire(import.meta.url);
    let threw = false;
    try {
      require.resolve("@trading-forge/definitely-not-a-real-module-xyz");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
