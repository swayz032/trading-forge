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
 * Exit codes:
 *   0 — full parity across every sample spec
 *   1 — one or more specs drifted (CI hard-gate FAIL)
 *
 * Usage:
 *   npx tsx scripts/check-spec-binding-plan-parity.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { compileBindingPlan } from "../src/server/lib/spec-family-bindings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SAMPLES_DIR = process.env.TF_SPEC_BINDING_SAMPLES_DIR
  ? join(process.env.TF_SPEC_BINDING_SAMPLES_DIR)
  : join(__dirname, "..", "ci", "fixtures", "spec-binding-parity");

const PY_DRIVER = `
import json, sys
from src.engine.spec_family_bindings import compile_binding_plan
spec = json.loads(sys.stdin.read())
plan = compile_binding_plan(spec)
print(json.dumps(plan.to_dict()))
`;

function pyBindingPlan(spec: unknown): Record<string, unknown> {
  const result = spawnSync("python", ["-c", PY_DRIVER], {
    input: JSON.stringify(spec),
    encoding: "utf-8",
    cwd: join(__dirname, ".."),
  });
  if (result.status !== 0) {
    throw new Error(`Python driver failed: ${result.stderr}`);
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

function main() {
  if (!existsSync(SAMPLES_DIR)) {
    throw new Error(`Binding-plan parity corpus does not exist: ${SAMPLES_DIR}`);
  }
  const files = readdirSync(SAMPLES_DIR).filter((f) => f.endsWith(".spec.json"));
  if (files.length === 0) {
    throw new Error(`Binding-plan parity corpus has no .spec.json files: ${SAMPLES_DIR}`);
  }
  let drift = 0;
  let checked = 0;

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(SAMPLES_DIR, file), "utf-8"));
    const spec = raw.spec;
    checked += 1;

    const tsPlan = tsBindingPlanAsPyShape(spec);
    const pyPlan = pyBindingPlan(spec);

    const scalarFields = [
      "trigger_condition_id",
      "trigger_bound",
      "spine_total",
      "spine_bound",
      "confluence_total",
      "confluence_bound",
      "approximation_used",
      "compiled",
    ] as const;

    const mismatches: string[] = [];
    for (const field of scalarFields) {
      if (JSON.stringify((tsPlan as Record<string, unknown>)[field]) !== JSON.stringify((pyPlan as Record<string, unknown>)[field])) {
        mismatches.push(`${field}: ts=${JSON.stringify((tsPlan as Record<string, unknown>)[field])} py=${JSON.stringify((pyPlan as Record<string, unknown>)[field])}`);
      }
    }

    const tsBindings = tsPlan.bindings as Array<Record<string, unknown>>;
    const pyBindings = (pyPlan.bindings as Array<Record<string, unknown>>) ?? [];
    if (tsBindings.length !== pyBindings.length) {
      mismatches.push(`binding count: ts=${tsBindings.length} py=${pyBindings.length}`);
    } else {
      for (let i = 0; i < tsBindings.length; i++) {
        const t = tsBindings[i];
        const p = pyBindings[i];
        for (const key of ["condition_id", "bindable", "primitive", "approximation", "session_zone"]) {
          if (JSON.stringify(t[key]) !== JSON.stringify(p[key])) {
            mismatches.push(`binding[${i}].${key}: ts=${JSON.stringify(t[key])} py=${JSON.stringify(p[key])}`);
          }
        }
      }
    }

    if (mismatches.length > 0) {
      drift += 1;
      console.error(`DRIFT in ${file}:`);
      for (const m of mismatches) console.error(`  - ${m}`);
    }
  }

  console.log(`Checked ${checked} sample specs.`);
  if (drift > 0) {
    console.error(`FAIL: ${drift} spec(s) show TS<->Python binding-plan drift.`);
    process.exit(1);
  }
  console.log("PASS: TS and Python binding plans agree on every sample spec.");
}

main();
