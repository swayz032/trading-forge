/**
 * D-10 N-4 — the auto-backtest enqueue must NAME a refusal, never record it as success.
 *
 * RULING: R-766 §4 lane 2 (Option B).
 *
 * WHY THIS FILE EXISTS AT ALL
 * ───────────────────────────
 * The FIX-3 enqueue block's only previous coverage was `runFix3Logic()` in
 * `auto-recovery-debt1-4.test.ts` — a RE-IMPLEMENTATION of the logic, in a file whose
 * only `import` is vitest and which `vi.mock`s `lifecycle-service.js` outright.
 *
 *   `THE ONE-GREP TEST FOR A REAL HARNESS: IS THE SUBJECT IN ITS OWN MOCK LIST?`
 *   `A REPLICA THAT MOCKS THE MODULE IT IS NAMED AFTER HAS DECLARED, IN EXECUTABLE
 *    CODE, THAT IT IS NOT TESTING IT.`                                   (R-766 §1)
 *
 * Deleting production would not have reddened a single one of those five tests.
 *
 * WIRING GUARD (this section)
 * ───────────────────────────
 * R-766 §4 requires "a structural call-site guard proving exactly one invocation".
 * The extraction is only legitimate if `checkAutoPromotions()` still calls the helper
 * ONCE, fire-and-forget, at the same point. A behavioural end-to-end fixture for that
 * call site is Option A, which R-764 §3 REFUSED on measured cost (the block sits
 * ~3,900 lines inside `checkAutoPromotions()`, behind the full PAPER → DEPLOY_READY
 * chain plus `incompleteCount >= 3`). So the wiring is asserted STRUCTURALLY, over the
 * production source, in the same shape `deepscan-wiring-fixes.test.ts` uses.
 *
 * ⚠️ A structural guard proves WIRING, not BEHAVIOUR. It is deliberately paired with
 * the behavioural controls over the extracted helper — a source assertion alone would
 * be the "grep matched a comment" failure this campaign has convicted before, which is
 * why every assertion below reads an EXECUTABLE line and the comment-only forms are
 * explicitly excluded.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIFECYCLE_SRC = resolve(HERE, "../services/lifecycle-service.ts");

function sourceLines(): string[] {
  return readFileSync(LIFECYCLE_SRC, "utf8").split("\n");
}

/** Executable lines only — strips `//` line comments and `*` block-comment bodies. */
function executableLines(): string[] {
  return sourceLines().filter((l) => {
    const t = l.trim();
    return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  });
}

describe("D-10 N-4 wiring guard: the extracted FIX-3 helper is invoked exactly once", () => {
  it("POSITIVE CONTROL: the production source is readable and non-trivial", () => {
    // Without this, every "exactly N" assertion below would also pass on an empty
    // read — an absence claim needs a positive witness that the path ran.
    const lines = sourceLines();
    expect(lines.length).toBeGreaterThan(5000);
    expect(executableLines().length).toBeGreaterThan(3000);
  });

  it("declares the helper exactly once", () => {
    const decls = executableLines().filter((l) =>
      /async runEvidenceAutoBacktestEnqueue\(/.test(l),
    );
    expect(decls).toHaveLength(1);
  });

  it("invokes it exactly once, from executable code, fire-and-forget", () => {
    const calls = executableLines().filter((l) =>
      /this\.runEvidenceAutoBacktestEnqueue\(/.test(l),
    );
    expect(calls).toHaveLength(1);
    // fire-and-forget: `void`-prefixed, never awaited — the lifecycle cycle must not
    // block on backtest duration. `await` here would be a real behaviour change.
    expect(calls[0].trim().startsWith("void this.runEvidenceAutoBacktestEnqueue(")).toBe(true);
    expect(calls[0]).not.toMatch(/await\s+this\.runEvidenceAutoBacktestEnqueue/);
  });

  it("NEGATIVE CONTROL: the comment-stripper does not simply erase everything", () => {
    // If `executableLines()` were over-aggressive, all three counts above would be 0
    // and "exactly one" would fail loudly rather than silently — but a token that is
    // ONLY ever mentioned in prose must still be absent, or the filter is inert.
    const exec = executableLines().join("\n");
    expect(exec).toContain("async checkAutoPromotions(");
    // this phrase exists only inside the helper's doc comment
    expect(exec).not.toContain("BEHAVIOUR-PRESERVING");
  });
});
