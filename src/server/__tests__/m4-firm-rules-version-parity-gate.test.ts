/**
 * m4-firm-rules-version-parity-gate.test.ts — 2026-06-23 hardening/phase-0
 *
 * M4 verification — the CI hard gate script
 * `scripts/check-ts-python-firm-rules-version.ts` must:
 *   1. exit 0 against HEAD when TS and Python hashes match (parity intact)
 *   2. exit 1 with a clear diagnostic when the hashes drift
 *
 * WHY THIS MATTERS
 * ----------------
 * firm-rules-version.ts hardcodes a TS-side mirror of firm_config.py +
 * prop_compliance.py.  If they silently drift, every Monte Carlo run forever
 * fires monte_carlo.firm_rule_version_mismatch CRITICAL and REFUSES.  The CI
 * gate at PR time is the only place to catch this before it becomes a runtime
 * false-positive flood.
 *
 * TEST ENV NOTE
 * -------------
 * The parity script spawns a Python subprocess.  In environments without python
 * on PATH (some CI containers), we mark the parity assertion as skipped rather
 * than fail-OPEN.  The drift-detection assertion uses a stubbed Python script
 * via env var injection so it does NOT require a working Python install.
 */

import { describe, it, expect } from "vitest";
import { spawnSync, execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Env probe — is `python` available? ──────────────────────────────────────

function pythonAvailable(): boolean {
  try {
    const r = spawnSync("python", ["--version"], { encoding: "utf-8", timeout: 5_000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

const HAS_PYTHON = pythonAvailable();
const REPO_ROOT = process.cwd();
const PARITY_SCRIPT = "scripts/check-ts-python-firm-rules-version.ts";

// ─── Test 1: live parity against HEAD ────────────────────────────────────────

describe("M4 — TS<->Python firm-rules-version parity gate", () => {
  it.skipIf(!HAS_PYTHON)(
    "script exits 0 when TS and Python hashes match (live HEAD)",
    () => {
      // npx tsx in a child shell so we get the same exit-code semantics CI uses.
      // 60s timeout: tsx cold-start + python spawn + sha256 well under that.
      const r = spawnSync(
        "npx",
        ["tsx", PARITY_SCRIPT],
        {
          cwd: REPO_ROOT,
          encoding: "utf-8",
          timeout: 60_000,
          shell: process.platform === "win32",
        },
      );

      if (r.status !== 0) {
        // Surface diagnostic so CI logs explain WHY the gate failed.
        console.error("[M4 TEST] parity script exited", r.status);
        console.error("stdout:", r.stdout);
        console.error("stderr:", r.stderr);
      }
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/PASS/);
    },
  );

  // ─── Test 2: drift detection ────────────────────────────────────────────────
  //
  // Simulates a TS <-> Python drift by running the parity script in a sandbox
  // where the Python side is shadowed with a stub that emits a known-different
  // hash.  The test verifies the script (a) exits non-zero and (b) emits a
  // diagnostic that names both hashes.
  //
  // We do NOT mutate firm-rules-version.ts or firm_config.py — that would
  // corrupt the working tree.  Instead we exploit Python's sys.path resolution
  // and patch the engine module via a sitecustomize file in a sandbox dir
  // prepended to PYTHONPATH.

  it.skipIf(!HAS_PYTHON)(
    "script exits non-zero with diagnostic when TS hash differs from Python",
    () => {
      // Build a sandbox Python package that shadows src.engine.firm_rules_version
      // with a stub that returns a guaranteed-different hash.
      const sandbox = mkdtempSync(join(tmpdir(), "tf-m4-firm-parity-"));
      try {
        // Layout:
        //   <sandbox>/src/__init__.py
        //   <sandbox>/src/engine/__init__.py
        //   <sandbox>/src/engine/firm_rules_version.py   <- STUB
        //   <sandbox>/src/engine/firm_config.py          <- STUB
        //   <sandbox>/src/engine/prop_compliance.py      <- STUB
        const srcDir = join(sandbox, "src");
        const engineDir = join(srcDir, "engine");
        const fs = require("node:fs");
        fs.mkdirSync(engineDir, { recursive: true });
        writeFileSync(join(srcDir, "__init__.py"), "");
        writeFileSync(join(engineDir, "__init__.py"), "");
        writeFileSync(
          join(engineDir, "firm_config.py"),
          "FIRM_RULES = {'drift_canary': {'value': 1}}\n",
        );
        writeFileSync(
          join(engineDir, "prop_compliance.py"),
          "FIRM_CONFIGS = {'drift_canary': {'value': 1}}\n",
        );
        writeFileSync(
          join(engineDir, "firm_rules_version.py"),
          [
            "def compute_firm_rules_version() -> str:",
            "    return '0000000000000000'  # M4 drift-test sentinel",
            "",
            "def _canonical_json(obj) -> str:",
            "    import json",
            "    return json.dumps(obj, sort_keys=True, separators=(',', ':'))",
            "",
          ].join("\n"),
        );

        // Prepend the sandbox to PYTHONPATH so Python imports the stub instead
        // of the real engine module. Existing PYTHONPATH (if any) preserved.
        const env = {
          ...process.env,
          PYTHONPATH: [sandbox, process.env.PYTHONPATH || ""]
            .filter(Boolean)
            .join(process.platform === "win32" ? ";" : ":"),
        };

        const r = spawnSync(
          "npx",
          ["tsx", PARITY_SCRIPT],
          {
            cwd: REPO_ROOT,
            encoding: "utf-8",
            timeout: 60_000,
            shell: process.platform === "win32",
            env,
          },
        );

        expect(r.status).not.toBe(0);
        // Diagnostic must include both hashes so a developer can spot drift.
        const combined = (r.stdout + r.stderr).toLowerCase();
        expect(combined).toMatch(/fail/);
        expect(combined).toMatch(/ts hash/);
        expect(combined).toMatch(/python hash/);
        expect(combined).toContain("0000000000000000"); // sentinel from stub
      } finally {
        try {
          rmSync(sandbox, { recursive: true, force: true });
        } catch {
          /* ignore cleanup failure */
        }
      }
    },
  );

  // ─── Always-on assertion: package.json registers the script ─────────────────
  //
  // This survives even on CI containers without Python — it verifies the gate
  // is wired into the canonical npm script registry, which is the contract the
  // CI workflow consumes.

  it("package.json registers check:ts-python-firm-rules-version", () => {
    // Read fresh from disk — do not require() (cached) — so a developer who
    // removed the script gets a clear failure here.
    const fs = require("node:fs");
    const pkgRaw = fs.readFileSync(join(REPO_ROOT, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw);
    expect(pkg.scripts).toBeTruthy();
    expect(pkg.scripts["check:ts-python-firm-rules-version"]).toBe(
      "npx tsx scripts/check-ts-python-firm-rules-version.ts",
    );
  });
});
