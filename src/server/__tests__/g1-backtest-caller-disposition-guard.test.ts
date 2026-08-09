/**
 * G-1 — the call-site disposition guard (R-772 §5, arms pre-registered in §6).
 *
 * THE PROPERTY UNDER TEST: a new production caller of `runBacktest()` must make the
 * build RED until its refusal disposition is explicitly registered.
 *
 * 🛑 FILENAME NOTE, DELIBERATE: this file is NOT named `d10-*`. The D-10 acceptance
 * population is defined by `find src -name 'd10-*.test.ts'` + shadow-rerun, and
 * `R-771 §6` pre-registered "DO NOT SEAL IF the population size does not match 8".
 * A `d10-` prefix here would silently move a pre-registered population from 8 to 9
 * — a goalpost move dressed as a naming convention. Whether this guard should JOIN
 * that population is the desk's call, after the seal.
 *
 * Every arm below manipulates the scanner's INPUT (an in-memory identity list) or a
 * SCRATCH COPY of a file. No production file is edited by any arm, and nothing is
 * left mutated on disk.
 */
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  auditBacktestCallers,
  identityKey,
  scanBacktestCallers,
  type CallerIdentity,
} from "../lib/backtest-caller-scan.js";
import { APPROVED_BACKTEST_CALLERS } from "../lib/backtest-caller-registry.js";

const REPO = process.cwd();
const EXPECTED_OBSERVED = 14;

/** Scan once; every arm derives its input from this. */
const OBSERVED: CallerIdentity[] = scanBacktestCallers(REPO, "src");

describe("G-1 §6 arm 1 — POSITIVE CONTROL: the real tree, unmodified", () => {
  it("the scan root is real and the scanner is looking at production source", () => {
    // Positive witness that the path RAN. Without it, every 'no violations' result
    // below is also satisfied by a scanner pointed at an empty directory.
    expect(() => readFileSync(join(REPO, "src/server/services/backtest-service.ts"), "utf8")).not.toThrow();
  });

  it("observes EXACTLY 14 callers, and the number is STATED, not implied", () => {
    // R-772 §6-1: "a green with an unstated observation count is a printout".
    // eslint-disable-next-line no-console
    console.log(`[G-1 arm 1] OBSERVED COUNT = ${OBSERVED.length}`);
    expect(OBSERVED.length).toBe(EXPECTED_OBSERVED);
  });

  it("is GREEN against the frozen registry, with no violations of any kind", () => {
    const a = auditBacktestCallers(OBSERVED, APPROVED_BACKTEST_CALLERS);
    expect(a.violations).toEqual([]);
    expect(a.ok).toBe(true);
    expect(a.observedCount).toBe(EXPECTED_OBSERVED);
    expect(a.registryCount).toBe(EXPECTED_OBSERVED);
  });

  it("clause E — every registry entry carries an EXPLICIT refusal disposition", () => {
    const a = auditBacktestCallers(OBSERVED, APPROVED_BACKTEST_CALLERS);
    expect(a.undispositioned).toEqual([]);
    for (const c of APPROVED_BACKTEST_CALLERS) {
      expect(["HANDLES_REFUSAL", "PROPAGATES", "DISCARDS"]).toContain(c.disposition);
      expect(c.evidence.length).toBeGreaterThan(20);
    }
  });
});

describe("G-1 §6 arm 2 — FAKE FIFTEENTH SITE: an unregistered caller fails CLOSED", () => {
  const fake: CallerIdentity = {
    file: "src/server/services/brand-new-service.ts",
    fn: "someNewProductionPath",
    ordinal: 0,
  };

  it("goes RED when a synthetic caller appears that the registry does not know", () => {
    const a = auditBacktestCallers([...OBSERVED, fake], APPROVED_BACKTEST_CALLERS);
    expect(a.ok).toBe(false);
    expect(a.observedCount).toBe(EXPECTED_OBSERVED + 1);
    expect(a.unregistered).toEqual([identityKey(fake)]);
  });

  it("NAMES the fake caller in the failure, so the message is actionable", () => {
    const a = auditBacktestCallers([...OBSERVED, fake], APPROVED_BACKTEST_CALLERS);
    const named = a.violations.filter((v) => v.includes(identityKey(fake)));
    expect(named.length).toBeGreaterThan(0);
    expect(named[0]).toContain("UNREGISTERED CALLER");
    // fails CLOSED: no default classification is invented for it
    expect(named[0]).toContain("no default disposition");
  });
});

describe("G-1 arm 2b — END-TO-END: a real new source file, scanned, reddens the guard", () => {
  /**
   * Arm 2 as pre-registered injects an identity into the scanner's INPUT. That proves
   * the COMPARATOR. It does not prove the SCANNER would ever see a real new caller —
   * and a guard whose scanner cannot detect the event it exists for is a habit.
   *   A CONTROL THAT FEEDS THE COMPARATOR ITS ANSWER IS TESTING THE COMPARATOR, NOT THE GUARD.
   * So this arm writes REAL TypeScript containing a REAL call into a scratch tree and
   * makes the scanner find it from source text. No production file is touched.
   */
  it("the scanner FINDS a genuinely new call site and the guard goes RED naming it", () => {
    const scratch = mkdtempSync(join(tmpdir(), "g1-newcaller-"));
    try {
      const rel = "src/server/services/brand-new-service.ts";
      const dest = join(scratch, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(
        dest,
        [
          'import { runBacktest } from "./backtest-service.js";',
          "",
          "export async function someNewProductionPath(strategyId: string) {",
          "  const result = await runBacktest(strategyId, {} as never);",
          "  return result;",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      const scanned = scanBacktestCallers(scratch, "src");
      // POSITIVE WITNESS: the scanner actually parsed and found it.
      expect(scanned.map(identityKey)).toEqual([`${rel}::someNewProductionPath#0`]);

      const a = auditBacktestCallers([...OBSERVED, ...scanned], APPROVED_BACKTEST_CALLERS);
      expect(a.ok).toBe(false);
      expect(a.unregistered).toEqual([`${rel}::someNewProductionPath#0`]);
      expect(a.violations.some((v) => v.includes("someNewProductionPath"))).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("NEGATIVE CONTROL: a new file that does NOT call runBacktest changes nothing", () => {
    // Without this, the arm above is satisfied by a scanner that flags every new file.
    const scratch = mkdtempSync(join(tmpdir(), "g1-nocall-"));
    try {
      const dest = join(scratch, "src/server/services/unrelated-service.ts");
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, "export function unrelated() {\n  return 1;\n}\n", "utf8");
      expect(scanBacktestCallers(scratch, "src")).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("NEGATIVE CONTROL: a doc-comment mention is NOT a call site (AST, not grep)", () => {
    // The 6 real doc-comment mentions of runBacktest() in production are why this
    // guard is an AST walk. A text scanner would register them as callers.
    const scratch = mkdtempSync(join(tmpdir(), "g1-comment-"));
    try {
      const dest = join(scratch, "src/server/services/commented-service.ts");
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(
        dest,
        [
          "/** This function is a sibling of runBacktest() and never calls it. */",
          "export function notACaller() {",
          '  const s = "runBacktest(fake)";',
          "  return s;",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );
      expect(scanBacktestCallers(scratch, "src")).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("G-1 §6 arm 3 — DELETION: an approved caller that disappears is RED", () => {
  it("goes RED, and names the caller that vanished", () => {
    const removed = OBSERVED[0];
    const a = auditBacktestCallers(OBSERVED.slice(1), APPROVED_BACKTEST_CALLERS);
    expect(a.ok).toBe(false);
    expect(a.missing).toEqual([identityKey(removed)]);
    expect(a.violations.some((v) => v.includes("APPROVED CALLER NOT OBSERVED"))).toBe(true);
  });
});

describe("G-1 §6 arm 4 — SUBSTITUTION: the arm a count-based guard would pass", () => {
  it("goes RED on delete-one + add-one even though the COUNT is still 14", () => {
    const victim = OBSERVED[0];
    const substituted: CallerIdentity[] = [
      ...OBSERVED.slice(1),
      { file: victim.file, fn: `${victim.fn}Renamed`, ordinal: victim.ordinal },
    ];

    // The discriminator: cardinality is UNCHANGED. `observed.length === 14` would pass.
    expect(substituted.length).toBe(EXPECTED_OBSERVED);

    const a = auditBacktestCallers(substituted, APPROVED_BACKTEST_CALLERS);
    expect(a.ok).toBe(false);
    expect(a.observedCount).toBe(EXPECTED_OBSERVED);
    expect(a.unregistered).toEqual([identityKey({ ...victim, fn: `${victim.fn}Renamed` })]);
    expect(a.missing).toEqual([identityKey(victim)]);
  });
});

describe("G-1 §6 arm 5 — EMPTY SCAN: zero callers is never a pass (§4)", () => {
  it("goes RED when the scanner observes ZERO callers", () => {
    const a = auditBacktestCallers([], APPROVED_BACKTEST_CALLERS);
    expect(a.ok).toBe(false);
    expect(a.violations.some((v) => v.startsWith("EMPTY SCAN"))).toBe(true);
  });

  it("goes RED on an empty world even when membership would VACUOUSLY match", () => {
    // The hole §4 is really about: empty observed + empty registry MATCH each other.
    // A pure membership comparison would report zero differences and go green over
    // nothing at all.
    const a = auditBacktestCallers([], []);
    expect(a.unregistered).toEqual([]);
    expect(a.missing).toEqual([]);
    expect(a.ok).toBe(false);
    expect(a.violations.some((v) => v.startsWith("EMPTY SCAN"))).toBe(true);
    expect(a.violations.some((v) => v.startsWith("EMPTY REGISTRY"))).toBe(true);
  });

  it('"zero unknown callers" and "zero callers" do NOT produce the same verdict', () => {
    expect(auditBacktestCallers(OBSERVED, APPROVED_BACKTEST_CALLERS).ok).toBe(true);
    expect(auditBacktestCallers([], APPROVED_BACKTEST_CALLERS).ok).toBe(false);
  });
});

describe("G-1 §6 arm 6 — REFORMAT: the identity is not line-pinning (clause B)", () => {
  it("survives a whitespace-only reformat that moves every line in a caller file", () => {
    const rel = "src/server/services/matrix-backtest-service.ts";
    const original = readFileSync(join(REPO, rel), "utf8");

    const scratch = mkdtempSync(join(tmpdir(), "g1-reformat-"));
    try {
      const dest = join(scratch, rel);
      mkdirSync(dirname(dest), { recursive: true });

      // Whitespace-only: 40 leading blank lines, then a blank line after every '{'.
      // Every original line number moves; no token, name or nesting changes.
      const reformatted = "\n".repeat(40) + original.split("\n").map((l) => (l.trimEnd().endsWith("{") ? `${l}\n` : l)).join("\n");
      writeFileSync(dest, reformatted, "utf8");

      const scratchIds = scanBacktestCallers(scratch, "src");

      // POSITIVE WITNESS FIRST: the scratch scan must actually FIND the call.
      // Without this, an empty scratch scan would "match" a filtered-empty baseline
      // and this arm would pass while proving nothing.
      expect(scratchIds.length).toBeGreaterThan(0);

      const baseline = OBSERVED.filter((c) => c.file === rel).map((c) => `${c.fn}#${c.ordinal}`);
      const after = scratchIds.filter((c) => c.file === rel).map((c) => `${c.fn}#${c.ordinal}`);
      expect(baseline.length).toBeGreaterThan(0);
      expect(after).toEqual(baseline);

      // and the reformat really did move things
      expect(reformatted).not.toEqual(original);
      expect(reformatted.split("\n").length).toBeGreaterThan(original.split("\n").length);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("NEGATIVE CONTROL: a SEMANTIC change to the same file DOES redden", () => {
    // Proves arm 6 is not vacuously green — the identity is insensitive to layout
    // and sensitive to meaning, which is the whole of clause B.
    const rel = "src/server/services/matrix-backtest-service.ts";
    const original = readFileSync(join(REPO, rel), "utf8");

    const scratch = mkdtempSync(join(tmpdir(), "g1-semantic-"));
    try {
      const dest = join(scratch, rel);
      mkdirSync(dirname(dest), { recursive: true });
      // rename the enclosing function: a real semantic move, not a layout change
      const mutated = original.replace("async function runNext(", "async function runNextRenamed(");

      // 🛑 THE MUTATION MUST ACTUALLY APPLY, ASSERTED BEFORE IT IS TRUSTED.
      // First run of this arm, a `.replace()` whose search string did not exist in
      // the source silently returned the ORIGINAL text, so the "semantic change"
      // was a no-op and the arm reported the scanner as broken. The scanner was fine.
      //   A MUTATION CONTROL OWES PROOF THAT IT MUTATED — AN UNAPPLIED `replace()`
      //   IS INDISTINGUISHABLE FROM A GUARD THAT FAILED TO NOTICE.
      expect(mutated).not.toEqual(original);
      writeFileSync(dest, mutated, "utf8");

      const after = scanBacktestCallers(scratch, "src").filter((c) => c.file === rel);
      expect(after.length).toBeGreaterThan(0);
      expect(after.map((c) => c.fn)).not.toContain("runNext");
      expect(after.map((c) => c.fn)).toContain("runNextRenamed");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
