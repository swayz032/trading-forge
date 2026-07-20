import { defineConfig } from "vitest/config";

// ── Runner split (ops-experience, 2026-07-19, OR-009 §3/§4) ──────────────────────────────────
// The scripts/ test estate is written in TWO incompatible styles and used to be globbed into
// vitest wholesale, so `scripts/rails/**/*.test.mjs` swept up three node:test files that vitest
// cannot execute — they failed as "No test suite found", making this lane RED-by-construction
// (3 failed / 4 passed) on a runner that happened to be dead, so nobody ever saw it.
//
// The split is deliberately ASYMMETRIC and fail-loud:
//   • vitest lane  = the explicit list below (files that `import ... from "vitest"`).
//   • node:test lane = everything else under scripts/ (see the `test:scripts` npm script),
//     which is the CATCH-ALL, so a newly added node:test file is picked up automatically.
// A new vitest-style file that is NOT added here fails loudly in the node:test lane (that is
// exactly how divergence-check/worktree-ttl were found) rather than silently running nowhere.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "ci/**/*.test.mjs",
      // vitest-style files under scripts/ — add new ones HERE, not by widening the glob.
      "scripts/rails/__tests__/divergence-check.test.mjs",
      "scripts/rails/__tests__/worktree-ttl.test.mjs",
    ],
  },
});
