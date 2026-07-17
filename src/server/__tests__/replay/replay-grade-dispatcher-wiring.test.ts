/**
 * Fix-wave telemetry-honesty-registry-dashboards (2026-07-17) — HIGH finding:
 * scripts/replay-grade.ts's unified dispatcher had three independent, silent
 * wiring bugs discovered on inspection while closing the wave's named
 * "stale import-failure fallback" + "discarded --output flag" findings:
 *
 *   1. --output <path> was parsed by parseCLIArgs into `customOutput` but the
 *      single-tool dispatch call site spread `...(customOutput ? {} : {})` —
 *      BOTH ternary branches are `{}`, so the flag was silently discarded on
 *      every single-tool `--apply --output <path>` invocation; the report
 *      always landed at the standard buildOutputPath() location instead.
 *   2. `runPatternAggregatorTool` / `runConsistencyTool` called
 *      `mod.buildPatternAggregatorReport(...)` / `mod.buildConsistencyReport(...)`
 *      — functions that have NEVER existed on either module. The real
 *      exports are `buildPatternAggregatorMarkdownReport` /
 *      `buildConsistencyMarkdownReport` in the pure-function libraries under
 *      src/server/lib/replay/. Both `--tool=pattern-aggregator` and
 *      `--tool=consistency` have thrown a TypeError on every invocation
 *      since Pass 3.G1 landed, wrapped in a try/catch that only guarded the
 *      *import* (not these calls) and mislabeled any import-time failure as
 *      "script not yet available (Pass 3.G1 pending)" — a stale fallback
 *      message for scripts that have been live for a long time.
 *   3. `runConsistencyTool` called `runConsistencyAnalysis(opts.sql, opts.limit)`
 *      but the real signature is `(sql, daysReplayed = 90, limitObservations?)`
 *      — `opts.limit` was landing in the `daysReplayed` slot, silently
 *      replaying over the wrong day-window (e.g. `--limit 5` replayed 5 DAYS
 *      of history, not 5 observations) while `limitObservations` stayed
 *      permanently unbounded.
 *
 * scripts/replay-grade.ts cannot be imported directly in this test suite:
 * every replay-grade-*.ts CLI script (including this one) calls its `main()`
 * unconditionally at module-eval time with no `import.meta.url` entry guard,
 * so importing it for its exported `dispatchTool`/`runAllTools` symbols also
 * *executes* the CLI, which calls `process.exit(1)` the instant
 * `DATABASE_URL` is unset (confirmed empirically — every existing
 * replay-grade-*.test.ts in this directory independently avoids importing
 * its corresponding scripts/replay-grade-*.ts for the same reason, per each
 * file's own "avoid crossing the TS rootDir boundary" comment, which
 * understates the actual cause). This suite therefore verifies the fix two
 * ways that don't require executing main():
 *
 *   (a) the CORRECT export names are proven to exist as real, live,
 *       importable functions on the pure-function libraries the dispatcher
 *       now references (this is what would have failed loudly, immediately,
 *       had the old code's assumption been checked at all);
 *   (b) a static contract scan of scripts/replay-grade.ts's SOURCE TEXT
 *       (comments stripped, so this file's own explanatory prose mentioning
 *       the old buggy call shapes for documentation purposes cannot
 *       false-positive the check) proves the dispatcher's actual code wires
 *       to the correct names/arguments and no longer contains the three
 *       broken patterns above.
 *
 * RED-PROOF (manual, recorded here since the check itself IS the regression
 * test): each static-scan assertion below was run against this fix-wave's
 * pre-fix source and confirmed to FAIL before the corresponding edit landed:
 *   - assertion (1) failed against the literal `...(customOutput ? {} : {})`
 *   - assertion (2) failed because the pre-fix source called
 *     `mod.buildPatternAggregatorReport(` / `mod.buildConsistencyReport(`
 *   - assertion (3) failed because the pre-fix source called
 *     `runConsistencyAnalysis(opts.sql, opts.limit)` (two args, no
 *     daysReplayed slot)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DISPATCHER_PATH = path.join(__dirname, "..", "..", "..", "..", "scripts", "replay-grade.ts");

/**
 * Strip /** ... *\/ block comments and // line comments from TS source so
 * substring checks below can't false-positive against this test file's own
 * (and the source file's own) explanatory prose about the bug being fixed.
 * Not a full tokenizer — good enough for a source file with no string
 * literals containing "//" or "/*" sequences that matter here (verified by
 * eyeballing the diff; if this ever mis-strips, the assertions below would
 * fail loudly rather than silently pass, since they check for PRESENCE of
 * the fixed pattern too).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function loadDispatcherCode(): string {
  return stripComments(readFileSync(DISPATCHER_PATH, "utf-8"));
}

describe("scripts/replay-grade.ts dispatcher wiring (static source contract)", () => {
  const code = loadDispatcherCode();

  it("sanity: the dispatcher source file is non-trivial (fixture is really loading the real file)", () => {
    expect(code.length).toBeGreaterThan(5000);
    expect(code).toContain("async function main()");
  });

  describe("finding 1 — --output flag no longer discarded on single-tool dispatch", () => {
    it("does NOT contain the discarded-flag pattern `...(customOutput ? {} : {})`", () => {
      expect(code).not.toContain("...(customOutput ? {} : {})");
    });

    it("threads customOutput into the single-tool dispatchTool() call", () => {
      // The single-tool dispatch object literal must actually pass
      // customOutput as a field so dispatchTool -> run*Tool ->
      // resolveReportOutputPath can see it. Anchor on the call itself
      // (not a comment) — comments are stripped from `code` above, so a
      // comment-text anchor would silently find nothing.
      const anchor = code.indexOf("dispatchTool(tool as ToolName");
      expect(anchor).toBeGreaterThan(-1);
      const singleToolDispatchRegion = code.slice(anchor, anchor + 200);
      expect(singleToolDispatchRegion).toContain("customOutput");
      // Must be a bare field reference (shorthand `customOutput,`) or an
      // explicit `customOutput: customOutput` — not the discarded ternary.
      expect(singleToolDispatchRegion).not.toContain("? {} : {}");
    });

    it("imports resolveReportOutputPath and uses it (not inline buildOutputPath) in every run*Tool wrapper", () => {
      expect(code).toContain("resolveReportOutputPath");
      // All 7 tool wrappers should route through the shared helper rather
      // than each hand-rolling `if (opts.apply) { outputFile = buildOutputPath(...) }`,
      // which is what silently ignored customOutput in the first place.
      const applyBuildOutputPathInline = /if\s*\(opts\.apply\)\s*\{\s*outputFile\s*=\s*buildOutputPath/;
      expect(applyBuildOutputPathInline.test(code)).toBe(false);
    });
  });

  describe("finding 2 — pattern-aggregator / consistency call real exports, not the never-existed placeholder names", () => {
    it("does NOT call the placeholder mod.buildPatternAggregatorReport(...)", () => {
      expect(code).not.toContain("mod.buildPatternAggregatorReport(");
    });

    it("does NOT call the placeholder mod.buildConsistencyReport(...)", () => {
      expect(code).not.toContain("mod.buildConsistencyReport(");
    });

    it("does NOT use the untyped `let mod: any` graceful-degrade pattern for these two tools", () => {
      // The `any`-typed dynamic-import escape hatch is exactly what let the
      // wrong function names compile without error in the first place.
      expect(code).not.toContain("let mod: any");
    });

    it("does NOT contain the stale 'Pass 3.G1 pending' fallback message", () => {
      expect(code).not.toContain("Pass 3.G1 pending");
    });

    it("imports the real buildPatternAggregatorMarkdownReport from the pure-function library", () => {
      // Dynamic `await import("...")`, not a static `from "..."` statement —
      // check for the module specifier string literal directly.
      expect(code).toContain("../src/server/lib/replay/pattern-aggregator-disagreement.js");
      expect(code).toContain("buildPatternAggregatorMarkdownReport");
    });

    it("imports the real buildConsistencyMarkdownReport from the pure-function library", () => {
      expect(code).toContain("../src/server/lib/replay/consistency-disagreement.js");
      expect(code).toContain("buildConsistencyMarkdownReport");
    });
  });

  describe("finding 3 — consistency tool passes daysReplayed, not opts.limit, as runConsistencyAnalysis's 2nd arg", () => {
    it("does NOT call the two-arg buggy form runConsistencyAnalysis(opts.sql, opts.limit)", () => {
      expect(code).not.toContain("runConsistencyAnalysis(opts.sql, opts.limit)");
    });

    it("calls the three-arg correct form with a daysReplayed variable in the middle slot", () => {
      expect(code).toMatch(
        /runConsistencyAnalysis\(opts\.sql,\s*daysReplayed,\s*opts\.limit\)/,
      );
    });

    it("derives daysReplayed from opts.lookbackDays with the tool's own 90-day default", () => {
      const consistencyToolRegion = code.slice(
        code.indexOf("async function runConsistencyTool"),
        code.indexOf("async function runConsistencyTool") + 1500,
      );
      expect(consistencyToolRegion).toContain("opts.lookbackDays ?? 90");
    });
  });
});

describe("real exports the fixed dispatcher now depends on (live-import proof)", () => {
  it("pattern-aggregator-disagreement.ts exports a callable buildPatternAggregatorMarkdownReport", async () => {
    const mod = await import("../../lib/replay/pattern-aggregator-disagreement.js");
    expect(typeof mod.buildPatternAggregatorMarkdownReport).toBe("function");
    // The removed placeholder name must NOT exist either — if it did, the
    // dispatcher's old code would have compiled-and-crashed instead of
    // failing outright, which is worse (a real function silently accepting
    // wrong arguments).
    expect((mod as Record<string, unknown>).buildPatternAggregatorReport).toBeUndefined();
  });

  it("consistency-disagreement.ts exports a callable buildConsistencyMarkdownReport", async () => {
    const mod = await import("../../lib/replay/consistency-disagreement.js");
    expect(typeof mod.buildConsistencyMarkdownReport).toBe("function");
    expect((mod as Record<string, unknown>).buildConsistencyReport).toBeUndefined();
  });
});
