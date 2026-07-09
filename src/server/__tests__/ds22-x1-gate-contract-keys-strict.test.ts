/**
 * deep-scan #22 Track X1 — failure-injection for the STRICT gate-contract-keys check.
 *
 * Proves the check is AST-strict (not a regex canary):
 *   • a bare `passed` variable / a token in a comment / a token in a log string does NOT satisfy
 *     a surface (the exact false-PASS the old `\bpassed\b`-anywhere regex allowed);
 *   • a producer-side key rename in a fixture makes the surface go RED;
 *   • a consumer-side member rename in a fixture makes the surface go RED.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  tsReadsKeyAsMember,
  tsReadsAnchoredMember,
  tsEmitsKeyAsProperty,
  pyEmitsKey,
  stripPythonCommentsAndDocstrings,
  checkSurface,
  type GateSurface,
} from "../../../scripts/check-gate-contract-keys.js";

const tmp = mkdtempSync(path.join(tmpdir(), "ds22-x1-gck-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("tsReadsKeyAsMember — member access only, not bare tokens", () => {
  it("matches a real dot member access", () => {
    expect(tsReadsKeyAsMember(`const x = wfr.wfe_overall;`, "wfe_overall")).toBe(true);
  });
  it("matches a real element (bracket-string) access", () => {
    expect(tsReadsKeyAsMember(`const x = wfr["pbo_overall"] ?? null;`, "pbo_overall")).toBe(true);
  });
  it("REGRESSION: a bare identifier variable named like the key does NOT count", () => {
    // The old regex `\bpassed\b` matched this; the strict AST check must NOT.
    expect(tsReadsKeyAsMember(`const passed = runBattery(); return passed;`, "passed")).toBe(false);
  });
  it("REGRESSION: the key appearing only in a comment does NOT count", () => {
    expect(tsReadsKeyAsMember(`// reads wfr.wfe_overall then compares\nconst y = 1;`, "wfe_overall")).toBe(false);
  });
  it("REGRESSION: the key appearing only in a string literal does NOT count", () => {
    expect(tsReadsKeyAsMember(`const msg = "wfe_overall unavailable (legacy)";`, "wfe_overall")).toBe(false);
  });
});

describe("tsReadsAnchoredMember — b15.passed vs unrelated .passed", () => {
  it("matches when the object expression contains the anchor", () => {
    expect(tsReadsAnchoredMember(`if (b15.passed === false) block();`, "b15", "passed")).toBe(true);
    expect(tsReadsAnchoredMember(`if (b15Battery.passed) ok();`, "b15", "passed")).toBe(true);
  });
  it("REGRESSION: an unrelated `.passed` on a different object does NOT satisfy the b15 surface", () => {
    expect(tsReadsAnchoredMember(`if (dsrResult.passed) ok();`, "b15", "passed")).toBe(false);
    expect(tsReadsAnchoredMember(`if (survivalTwin.passed === false) block();`, "b15", "passed")).toBe(false);
  });
});

describe("tsEmitsKeyAsProperty — object-literal / member emit", () => {
  it("matches an object-literal property emit (Drizzle set)", () => {
    expect(tsEmitsKeyAsProperty(`await db.update(strategies).set({ frozenPolicyHash: hash });`, "frozenPolicyHash")).toBe(true);
  });
  it("does NOT match a token only in a comment", () => {
    expect(tsEmitsKeyAsProperty(`// frozenPolicyHash is computed elsewhere\nconst x = 1;`, "frozenPolicyHash")).toBe(false);
  });
});

describe("pyEmitsKey — dict-key / subscript emit, docstrings stripped", () => {
  it("matches a dict-key emit", () => {
    expect(pyEmitsKey(`    return {\n        "wfe_overall": wfe_overall,\n    }`, "wfe_overall")).toBe(true);
  });
  it("matches a subscript assignment emit", () => {
    expect(pyEmitsKey(`results["probability_of_ruin_ci"] = results["probability_of_ruin"]`, "probability_of_ruin_ci")).toBe(true);
  });
  it("REGRESSION: a docstring mention does NOT count", () => {
    const src = `def f():\n    """B14 reads probability_of_ruin_ci.ci_high as the bound."""\n    return 1`;
    expect(pyEmitsKey(src, "probability_of_ruin_ci")).toBe(false);
  });
  it("REGRESSION: a # comment mention does NOT count", () => {
    expect(pyEmitsKey(`# emit wfe_overall here later\nx = 1`, "wfe_overall")).toBe(false);
  });
  it("stripPythonCommentsAndDocstrings blanks docstrings but keeps real dict keys", () => {
    const src = `"""doc wfe_overall"""\nd = {"wfe_overall": 1}`;
    const cleaned = stripPythonCommentsAndDocstrings(src);
    expect(cleaned.includes('"""doc')).toBe(false);
    expect(cleaned.includes('"wfe_overall": 1')).toBe(true);
  });
});

describe("checkSurface — failure injection on a temp fixture tree", () => {
  const write = (rel: string, content: string): void => {
    const p = path.join(tmp, rel);
    writeFileSync(p, content);
  };

  it("GREEN: real emit + real member read → no problems", () => {
    write("prod.py", `def f():\n    return {"wfe_overall": v}`);
    write("cons.ts", `const w = wfr?.wfe_overall != null ? Number(wfr.wfe_overall) : null;`);
    const surface: GateSurface = {
      key: "wfe_overall",
      producer: { file: "prod.py", lang: "py" },
      consumer: { file: "cons.ts" },
    };
    expect(checkSurface(surface, { rootDir: tmp })).toEqual([]);
  });

  it("RED: producer-side key rename → problem cites producer", () => {
    write("prod_renamed.py", `def f():\n    return {"wfe_overall_RENAMED": v}`);
    write("cons.ts", `const w = wfr?.wfe_overall;`);
    const surface: GateSurface = {
      key: "wfe_overall",
      producer: { file: "prod_renamed.py", lang: "py" },
      consumer: { file: "cons.ts" },
    };
    const problems = checkSurface(surface, { rootDir: tmp });
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("NOT emitted");
  });

  it("RED: consumer-side member rename → problem cites consumer", () => {
    write("prod.py", `def f():\n    return {"pbo_overall": v}`);
    write("cons_renamed.ts", `const p = backtestResult.pbo_overall_RENAMED;`);
    const surface: GateSurface = {
      key: "pbo_overall",
      producer: { file: "prod.py", lang: "py" },
      consumer: { file: "cons_renamed.ts" },
    };
    const problems = checkSurface(surface, { rootDir: tmp });
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("NOT read");
  });

  it("RED: b15 surface not satisfied by an unrelated `.passed` (regex-canary would false-PASS)", () => {
    write("prod.py", `def f():\n    return {"passed": len(failures) == 0}`);
    // consumer has a bare `passed` var AND an unrelated dsr.passed — old regex passes, strict fails.
    write("cons_bare.ts", `const passed = true;\nif (dsrResult.passed) ok();`);
    const surface: GateSurface = {
      key: "passed",
      anchor: "b15",
      producer: { file: "prod.py", lang: "py" },
      consumer: { file: "cons_bare.ts" },
    };
    const problems = checkSurface(surface, { rootDir: tmp });
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("anchored");
  });
});
