/**
 * check-spec-binding-plan-parity.ts — Band C Ledger E parity gate.
 *
 * Mirrors scripts/wave26-ts-python-exit-parity.ts's exact methodology
 * (spawn a Python subprocess, feed identical inputs, diff outputs) but for
 * the NEW parity surface this band introduces: the condition-family
 * BINDING PLAN, not an exit plan. Per the task brief: "if all new evaluators
 * are Python-only with TS only doing dispatch metadata, the parity surface
 * is the binding plan — parity-test THAT."
 *
 * For every real sample spec in the 25-sample generalization corpus, this
 * script:
 *   1. Computes the binding plan via TS compileBindingPlan() (in-process).
 *   2. Computes the binding plan via Python compile_binding_plan() (subprocess,
 *      dumped as JSON to stdout via a tiny inline driver script).
 *   3. Asserts EXACT agreement on: compiled, triggerBound, spineTotal,
 *      spineBound, confluenceTotal, confluenceBound, approximationUsed, and
 *      the per-condition (bindable, primitive, approximation) tuple for
 *      every condition id.
 *
 * FLAG-MATCHED DRIVER (AR-083 Finding 2 fix, docs/designs/AGENT-REPORTS.md):
 * the Python driver used to spawn without ever setting TF_LEVELZONE_ROUTING_
 * ENABLED, relying on whatever the CALLING shell's ambient env happened to
 * hold (unset in the common case). That meant the gate had no explicit,
 * declared "state under test" — it could not deliberately exercise the
 * flag=true state, and if a concurrent shell/CI runner happened to export the
 * flag, the comparison would silently run under an undeclared state instead
 * of failing loud. Two things follow from `src/engine/spec_family_bindings.py`
 * and `src/server/lib/spec-family-bindings.ts`, verified before writing this:
 *   - Python's `compile_binding_plan` reads TF_LEVELZONE_ROUTING_ENABLED live
 *     (spec_family_bindings.py:135-139) and, when true, routes level/zone-
 *     classified WAIT_STRUCTURE/VERIFY_STRUCTURE conditions to primitive
 *     "levelzone_routing.retest_touch_check" (same file, lines 565-580).
 *   - TS's `compileBindingPlan` has NO env-flag read anywhere (grep across
 *     spec-family-bindings.ts: zero hits for TF_LEVELZONE_ROUTING_ENABLED) —
 *     it is a static table lookup, always "structure_engine.compute_structure_
 *     state" for WAIT_STRUCTURE/VERIFY_STRUCTURE regardless of the flag.
 * So flag=false is a genuine parity claim (TS's only representable state);
 * flag=true is a KNOWN, BOUNDED divergence the gate must now explicitly
 * exercise and verify stays bounded to exactly that shape — not a state TS
 * is expected to match. This script therefore runs BOTH states, explicitly,
 * each with its own env passed straight to spawnSync (never inherited):
 *   PASS 1 (flag=false): hard parity gate, 0 mismatches allowed (unchanged
 *     from before this fix — this is the standing CI gate).
 *   PASS 2 (flag=true): every mismatch must be EXACTLY the expected shape
 *     (field=="primitive", ts=="structure_engine.compute_structure_state",
 *     py=="levelzone_routing.retest_touch_check", condition type WAIT_
 *     STRUCTURE/VERIFY_STRUCTURE) — anything else is unexplained drift and
 *     hard-fails. Zero expected divergences found across the whole corpus
 *     ALSO hard-fails (anti-vacuity: an axis that never engages is exactly
 *     the "could not detect a divergence" defect this fix exists to close).
 *
 * Exit codes:
 *   0 — pass 1 full parity AND pass 2 divergence is bounded + non-vacuous
 *   1 — CI hard-gate FAIL (unexplained drift in either pass, or pass-2 vacuity)
 *
 * Usage:
 *   npx tsx scripts/check-spec-binding-plan-parity.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { compileBindingPlan } from "../src/server/lib/spec-family-bindings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SAMPLES_DIR =
  "C:\\Users\\tonio\\Projects\\trading-forge\\trading-forge\\.claude\\worktrees\\extraction-100\\tmp\\generalization";

const PY_DRIVER = `
import json, sys
from src.engine.spec_family_bindings import compile_binding_plan
spec = json.loads(sys.stdin.read())
plan = compile_binding_plan(spec)
print(json.dumps(plan.to_dict()))
`;

// The exact known-divergence signature (verified against spec_family_bindings.py
// before writing this script — see module docstring above).
const LEVELZONE_ROUTED_TYPES = new Set(["WAIT_STRUCTURE", "VERIFY_STRUCTURE"]);
const BASELINE_STRUCTURE_PRIMITIVE = "structure_engine.compute_structure_state";
const LEVELZONE_NATIVE_PRIMITIVE = "levelzone_routing.retest_touch_check";

type LevelzoneFlag = "true" | "false";

function pyBindingPlan(spec: unknown, levelzoneFlag: LevelzoneFlag): Record<string, unknown> {
  const result = spawnSync("python", ["-c", PY_DRIVER], {
    input: JSON.stringify(spec),
    encoding: "utf-8",
    cwd: join(__dirname, ".."),
    // Explicit, never inherited-by-accident: the python subprocess's flag state is
    // ALWAYS exactly what this call declares as "the state under test" — this is the
    // fix. (Node's spawnSync inherits process.env when `env` is omitted, which is how
    // the old blind version could silently run under whatever ambient state a caller's
    // shell happened to hold.)
    env: { ...process.env, TF_LEVELZONE_ROUTING_ENABLED: levelzoneFlag },
  });
  if (result.status !== 0) {
    throw new Error(`Python driver failed (TF_LEVELZONE_ROUTING_ENABLED=${levelzoneFlag}): ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function tsBindingPlanAsPyShape(spec: { entry_conditions?: unknown[]; invalidations?: unknown[]; entry_trigger_id?: string }) {
  const plan = compileBindingPlan(spec as never);
  return {
    bindings: plan.bindings.map((b) => ({
      condition_id: b.conditionId,
      type: b.type,
      role: b.role,
      object: b.object,
      bindable: b.bindable,
      primitive: b.primitive,
      approximation: b.approximation,
      executed: b.executed,
      reason: b.reason,
      session_zone: b.sessionZone,
    })),
    trigger_condition_id: plan.triggerConditionId,
    trigger_bound: plan.triggerBound,
    spine_total: plan.spineTotal,
    spine_bound: plan.spineBound,
    confluence_total: plan.confluenceTotal,
    confluence_bound: plan.confluenceBound,
    approximation_used: plan.approximationUsed,
    compiled: plan.compiled,
  };
}

const SCALAR_FIELDS = [
  "trigger_condition_id",
  "trigger_bound",
  "spine_total",
  "spine_bound",
  "confluence_total",
  "confluence_bound",
  "approximation_used",
  "compiled",
] as const;

const BINDING_FIELDS = ["condition_id", "bindable", "primitive", "approximation", "session_zone"] as const;

type Mismatch =
  | { scope: "scalar"; field: string; ts: unknown; py: unknown }
  | { scope: "binding_count"; ts: number; py: number }
  | { scope: "binding"; index: number; field: string; ts: unknown; py: unknown; condType: unknown };

function diffPlans(
  tsPlan: ReturnType<typeof tsBindingPlanAsPyShape>,
  pyPlan: Record<string, unknown>,
): Mismatch[] {
  const mismatches: Mismatch[] = [];

  for (const field of SCALAR_FIELDS) {
    const tsVal = (tsPlan as Record<string, unknown>)[field];
    const pyVal = pyPlan[field];
    if (JSON.stringify(tsVal) !== JSON.stringify(pyVal)) {
      mismatches.push({ scope: "scalar", field, ts: tsVal, py: pyVal });
    }
  }

  const tsBindings = tsPlan.bindings as Array<Record<string, unknown>>;
  const pyBindings = (pyPlan.bindings as Array<Record<string, unknown>>) ?? [];
  if (tsBindings.length !== pyBindings.length) {
    mismatches.push({ scope: "binding_count", ts: tsBindings.length, py: pyBindings.length });
    return mismatches; // index-aligned comparison below is meaningless if lengths differ
  }

  for (let i = 0; i < tsBindings.length; i++) {
    const t = tsBindings[i];
    const p = pyBindings[i];
    for (const key of BINDING_FIELDS) {
      if (JSON.stringify(t[key]) !== JSON.stringify(p[key])) {
        mismatches.push({ scope: "binding", index: i, field: key, ts: t[key], py: p[key], condType: t["type"] });
      }
    }
  }
  return mismatches;
}

function formatMismatch(m: Mismatch): string {
  if (m.scope === "scalar") return `${m.field}: ts=${JSON.stringify(m.ts)} py=${JSON.stringify(m.py)}`;
  if (m.scope === "binding_count") return `binding count: ts=${m.ts} py=${m.py}`;
  return `binding[${m.index}].${m.field} (type=${JSON.stringify(m.condType)}): ts=${JSON.stringify(m.ts)} py=${JSON.stringify(m.py)}`;
}

/** True iff `m` is EXACTLY the known, bounded flag=true divergence: the `primitive`
 * field flipping from the shared structure signal to the level-aware native primitive,
 * on a WAIT_STRUCTURE/VERIFY_STRUCTURE binding. Any other shape (a different field, a
 * different value pair, a non-routable condition type) is real, unexplained drift. */
function isExpectedLevelzoneDivergence(m: Mismatch): boolean {
  return (
    m.scope === "binding" &&
    m.field === "primitive" &&
    m.ts === BASELINE_STRUCTURE_PRIMITIVE &&
    m.py === LEVELZONE_NATIVE_PRIMITIVE &&
    LEVELZONE_ROUTED_TYPES.has(String(m.condType))
  );
}

function main() {
  const files = readdirSync(SAMPLES_DIR).filter((f) => f.endsWith(".spec.json"));
  const specs = files.map((file) => ({
    file,
    spec: JSON.parse(readFileSync(join(SAMPLES_DIR, file), "utf-8")).spec,
  }));

  let hardFail = false;

  // ── PASS 1: flag=false — the production default and the standing CI gate. ──────────
  console.log("=== PASS 1/2 — TF_LEVELZONE_ROUTING_ENABLED=false (production default) ===");
  let offDriftSpecs = 0;
  for (const { file, spec } of specs) {
    const tsPlan = tsBindingPlanAsPyShape(spec);
    const pyPlan = pyBindingPlan(spec, "false");
    const mismatches = diffPlans(tsPlan, pyPlan);
    if (mismatches.length > 0) {
      offDriftSpecs += 1;
      hardFail = true;
      console.error(`DRIFT (flag=false) in ${file}:`);
      for (const m of mismatches) console.error(`  - ${formatMismatch(m)}`);
    }
  }
  console.log(
    `Checked ${specs.length} sample specs at flag=false. ` +
      (offDriftSpecs === 0 ? "PASS: full parity." : `FAIL: ${offDriftSpecs} spec(s) drifted.`),
  );

  // ── PASS 2: flag=true — TS has no flag-aware routing (verified, module docstring), ──
  // so this MUST show the known/bounded divergence and NOTHING else, on at least one
  // condition somewhere in the corpus (else the axis is unexercised — vacuous).
  console.log(
    "\n=== PASS 2/2 — TF_LEVELZONE_ROUTING_ENABLED=true (documents the known TS/Python divergence) ===",
  );
  let expectedDivergences = 0;
  let unexpectedMismatches = 0;
  for (const { file, spec } of specs) {
    const tsPlan = tsBindingPlanAsPyShape(spec);
    const pyPlan = pyBindingPlan(spec, "true");
    const mismatches = diffPlans(tsPlan, pyPlan);
    for (const m of mismatches) {
      if (isExpectedLevelzoneDivergence(m)) {
        expectedDivergences += 1;
      } else {
        unexpectedMismatches += 1;
        hardFail = true;
        console.error(`UNEXPECTED DRIFT (flag=true) in ${file}: ${formatMismatch(m)}`);
      }
    }
  }
  console.log(
    `Checked ${specs.length} sample specs at flag=true. ` +
      `${expectedDivergences} known/expected primitive divergence(s), ${unexpectedMismatches} unexpected mismatch(es).`,
  );
  if (expectedDivergences === 0) {
    hardFail = true;
    console.error(
      "FAIL (anti-vacuity): flag=true pass found ZERO level/zone-routed conditions in the corpus — " +
        "this parity axis is UNEXERCISED, not proven. A gate that never observes the state it claims " +
        "to check is exactly the 'could not detect a divergence' defect this fix exists to close.",
    );
  }

  if (hardFail) {
    console.error("\nFAIL: binding-plan parity gate failed — see DRIFT/UNEXPECTED entries above.");
    process.exit(1);
  }
  console.log(
    "\nPASS: flag=false is byte-identical parity; flag=true shows ONLY the known, bounded " +
      "TS/Python divergence (primitive field, level/zone-routed WAIT_STRUCTURE/VERIFY_STRUCTURE " +
      "conditions only), and that divergence is non-vacuous.",
  );
}

main();
