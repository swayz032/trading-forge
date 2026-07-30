/**
 * check-spec-binding-plan-parity.ts — Band C Ledger E parity gate.
 *
 * TWO INDEPENDENT CLAIMS, ASSERTED SEPARATELY. Conflating them is the defect
 * this rewrite closes:
 *
 *   CLAIM 1 — AGREEMENT.  TS compileBindingPlan() and Python
 *     compile_binding_plan() emit the SAME plan for the same spec. Proven by
 *     whole-plan deep equality with key-set equality asserted in BOTH
 *     directions. This can NEVER prove either lane is right: two identically
 *     wrong lanes compare equal.
 *
 *   CLAIM 2 — CORRECTNESS.  Each lane's plan matches a desk-frozen ORACLE whose
 *     authority is external to both lanes
 *     (docs/designs/ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md, sha256
 *     09e016fd8b4cfc6739f33ecc49e300cb3d06e5f5e8d8813446cb31b62a8cf086).
 *     Every expectation cites a row of that file. Nothing here is copied from an
 *     emitted plan.
 *
 * ★★★ WHY THE OLD VERSION WAS A FALSE GREEN — recorded so it is not rebuilt:
 *   - It compared a HAND-PICKED FIVE of the ten fields it collected. `reason`
 *     was collected and never compared — the field the entire Gate-B population
 *     is defined by (R-481 F-G).
 *   - Worse, its TS shape function never EMITTED `invalidation_bindings` or
 *     `queue_reasons` at all, while Python's to_dict() emits both. Those two
 *     keys were not under-compared, they were structurally absent from one side,
 *     so no field-list change could ever have reached them. Bidirectional
 *     KEY-SET equality is what catches a missing key rather than a differing
 *     value — hence: no field enumeration anywhere below.
 *   - It shipped pointed at a ONE-fixture corpus while its docstring claimed a
 *     25-sample corpus. `A GATE THAT PASSES EVERY FIXTURE IT WAS GIVEN CERTIFIES
 *     ITS FIXTURES, NOT ITS DOMAIN.` Hence the membership manifest.
 *
 * Exit codes:
 *   0 — agreement AND oracle conformance AND membership complete
 *   1 — any drift, any oracle violation, or any missing corpus member
 *
 * Usage:
 *   npx tsx scripts/check-spec-binding-plan-parity.ts
 *   TF_SPEC_BINDING_SAMPLES_DIR=<abs windows path> npx tsx scripts/...
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

/**
 * Emit the TS plan in Python's wire shape.
 *
 * ★ EVERY key Python's to_dict() produces must appear here, including
 *   `invalidation_bindings` and `queue_reasons`. This function is deliberately
 *   TOTAL rather than selective — the bidirectional key-set check below turns any
 *   omission into a hard failure instead of a silent pass, which is exactly what
 *   the previous version's two missing keys demonstrate.
 */
function tsBindingPlanAsPyShape(spec: unknown): Record<string, unknown> {
  const plan = compileBindingPlan(spec as never);
  const binding = (b: (typeof plan.bindings)[number]) => ({
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
  });
  return {
    bindings: plan.bindings.map(binding),
    invalidation_bindings: plan.invalidationBindings.map(binding),
    trigger_condition_id: plan.triggerConditionId,
    trigger_bound: plan.triggerBound,
    spine_total: plan.spineTotal,
    spine_bound: plan.spineBound,
    confluence_total: plan.confluenceTotal,
    confluence_bound: plan.confluenceBound,
    approximation_used: plan.approximationUsed,
    compiled: plan.compiled,
    queue_reasons: plan.queueReasons,
  };
}

// ─── CLAIM 1: whole-plan structural comparison ──────────────────────────────
//
// Recurses. Reports the first divergence per path rather than a summary. Arrays
// compare ELEMENTWISE AT INDEX, so a reordered or duplicated binding does NOT
// compare equal — length equality alone was one of the old gate's blind spots.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function diffDeep(ts: unknown, py: unknown, path: string, out: string[]): void {
  if (isPlainObject(ts) && isPlainObject(py)) {
    const tsKeys = Object.keys(ts).sort();
    const pyKeys = Object.keys(py).sort();
    // BIDIRECTIONAL key-set equality: a field added to either lane and not the
    // other is itself a drift. A NEW FIELD IS A NEW DRIFT BY DEFAULT.
    const onlyTs = tsKeys.filter((k) => !pyKeys.includes(k));
    const onlyPy = pyKeys.filter((k) => !tsKeys.includes(k));
    for (const k of onlyTs) out.push(`${path}.${k}: PRESENT in ts, ABSENT in py`);
    for (const k of onlyPy) out.push(`${path}.${k}: ABSENT in ts, PRESENT in py`);
    for (const k of tsKeys.filter((k) => pyKeys.includes(k))) {
      diffDeep(ts[k], py[k], `${path}.${k}`, out);
    }
    return;
  }
  if (Array.isArray(ts) && Array.isArray(py)) {
    if (ts.length !== py.length) {
      out.push(`${path}: length ts=${ts.length} py=${py.length}`);
      return;
    }
    for (let i = 0; i < ts.length; i++) diffDeep(ts[i], py[i], `${path}[${i}]`, out);
    return;
  }
  if (JSON.stringify(ts) !== JSON.stringify(py)) {
    out.push(`${path}: ts=${JSON.stringify(ts)} py=${JSON.stringify(py)}`);
  }
}

/**
 * Duplicate-condition_id detection. A plan carrying the same condition_id twice
 * is malformed regardless of whether the lanes agree about it — so this is
 * checked per-lane, not as a diff. Two lanes agreeing on a duplicate is still a
 * defect.
 */
function duplicateConditionIds(plan: Record<string, unknown>, lane: string, out: string[]): void {
  for (const key of ["bindings", "invalidation_bindings"]) {
    const rows = (plan[key] as Array<Record<string, unknown>>) ?? [];
    const seen = new Map<string, number>();
    for (const r of rows) {
      const id = String(r.condition_id);
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    for (const [id, n] of seen) {
      if (n > 1) out.push(`${lane}.${key}: duplicate condition_id ${JSON.stringify(id)} appears ${n}x`);
    }
  }
}

// ─── CLAIM 2: the oracle ────────────────────────────────────────────────────

interface OracleRow {
  authority: string;
  bindable?: boolean;
  primitive_null?: boolean;
  session_zone?: string | null;
  approximation?: boolean;
  reason_null?: boolean;
  /** Reason must be non-null AND contain this substring (P-4 zone attribution). */
  reason_names?: string;
  /**
   * Reason must be non-null and must NOT contain this substring — the shape-
   * specified form the oracle authority §5-5 mandates for the two
   * unrecognized-vocabulary rows, which must stay DISTINCT from an orphan
   * refusal without this repo freezing a literal the desk never derived.
   */
  reason_excludes?: string;
}

interface OracleFixture {
  authority: string;
  /**
   * Plan-level expectations. OPTIONAL — but omitting them requires
   * `scalars_unadjudicated` to say WHY, so a gap is always DECLARED and printed
   * rather than read as coverage. The oracle authority §6 leaves non-session
   * families unadjudicated, so the membership manifest is deliberately WIDER
   * than the oracle and the difference must be visible.
   */
  spine_total?: number;
  spine_bound?: number;
  compiled?: boolean;
  /** Required iff any of the three scalars above is omitted. */
  scalars_unadjudicated?: string;
  /** Conditions the authority does NOT adjudicate, named so the gap is explicit. */
  conditions_unadjudicated?: string;
  conditions: Record<string, OracleRow>;
  /**
   * Pairs of condition keys whose `reason` strings MUST differ. Encodes oracle
   * authority §110-112: "if row 21's and row 10's reason strings are equal, P-4
   * is violated and the repair is incomplete even with every other field green."
   */
  reasons_must_differ_from?: Array<{ condition: string; fixture: string; other_condition: string }>;
}

interface Oracle {
  authority_file: string;
  authority_sha256: string;
  required_members: string[];
  fixtures: Record<string, OracleFixture>;
}

function checkOracle(
  fixtureName: string,
  oracle: Oracle,
  plan: Record<string, unknown>,
  lane: string,
  out: string[],
): void {
  const expect = oracle.fixtures[fixtureName];
  if (!expect) {
    out.push(`${lane}: NO ORACLE ROW for fixture ${fixtureName} — an unadjudicated fixture cannot pass`);
    return;
  }
  const rows = (plan.bindings as Array<Record<string, unknown>>) ?? [];
  const byId = new Map(rows.map((r) => [String(r.condition_id), r]));

  const scalars: Array<[string, unknown, unknown]> = [
    ["spine_total", expect.spine_total, plan.spine_total],
    ["spine_bound", expect.spine_bound, plan.spine_bound],
    ["compiled", expect.compiled, plan.compiled],
  ];
  const omitted = scalars.filter(([, want]) => want === undefined).map(([f]) => f);
  if (omitted.length > 0 && !expect.scalars_unadjudicated) {
    // An undeclared gap is the failure mode, not the gap itself. A fixture that
    // silently checks nothing is worse than one that says what it does not check.
    out.push(
      `${lane}: ORACLE ${fixtureName} omits [${omitted.join(", ")}] with NO 'scalars_unadjudicated' reason — ` +
        `an undeclared coverage gap reads as coverage. Declare it or adjudicate it.`,
    );
  }
  for (const [field, want, got] of scalars) {
    if (want === undefined) continue;
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      out.push(`${lane}: ORACLE ${field}: expected=${JSON.stringify(want)} observed=${JSON.stringify(got)} [${expect.authority}]`);
    }
  }

  for (const [condId, want] of Object.entries(expect.conditions)) {
    const got = byId.get(condId);
    if (!got) {
      out.push(`${lane}: ORACLE condition ${condId} MISSING from plan [${want.authority}]`);
      continue;
    }
    const cite = `[${want.authority}]`;
    if (want.bindable !== undefined && got.bindable !== want.bindable) {
      out.push(`${lane}: ORACLE ${condId}.bindable: expected=${want.bindable} observed=${JSON.stringify(got.bindable)} ${cite}`);
    }
    if (want.primitive_null !== undefined) {
      const isNull = got.primitive === null;
      if (isNull !== want.primitive_null) {
        out.push(`${lane}: ORACLE ${condId}.primitive: expected ${want.primitive_null ? "null" : "non-null"} observed=${JSON.stringify(got.primitive)} ${cite}`);
      }
    }
    if (want.session_zone !== undefined && JSON.stringify(got.session_zone) !== JSON.stringify(want.session_zone)) {
      out.push(`${lane}: ORACLE ${condId}.session_zone: expected=${JSON.stringify(want.session_zone)} observed=${JSON.stringify(got.session_zone)} ${cite}`);
    }
    if (want.approximation !== undefined && got.approximation !== want.approximation) {
      out.push(`${lane}: ORACLE ${condId}.approximation: expected=${want.approximation} observed=${JSON.stringify(got.approximation)} ${cite}`);
    }
    if (want.reason_null === true && got.reason !== null) {
      out.push(`${lane}: ORACLE ${condId}.reason: expected null observed=${JSON.stringify(got.reason)} ${cite}`);
    }
    if (want.reason_null === false && got.reason === null) {
      out.push(`${lane}: ORACLE ${condId}.reason: expected non-null observed null ${cite}`);
    }
    if (want.reason_names !== undefined) {
      const r = got.reason;
      if (typeof r !== "string" || !r.includes(want.reason_names)) {
        out.push(`${lane}: ORACLE ${condId}.reason must NAME the zone ${JSON.stringify(want.reason_names)} (P-4 attribution) observed=${JSON.stringify(r)} ${cite}`);
      }
    }
    if (want.reason_excludes !== undefined) {
      const r = got.reason;
      if (typeof r !== "string" || r.length === 0) {
        out.push(`${lane}: ORACLE ${condId}.reason: expected a non-empty unrecognized-vocabulary reason observed=${JSON.stringify(r)} ${cite}`);
      } else if (r.includes(want.reason_excludes)) {
        out.push(`${lane}: ORACLE ${condId}.reason must NOT be an orphan-refusal reason (P-6: unrecognized vocabulary, not a missing window) observed=${JSON.stringify(r)} ${cite}`);
      }
    }
  }
}

function main() {
  if (!existsSync(SAMPLES_DIR)) {
    throw new Error(`Binding-plan parity corpus does not exist: ${SAMPLES_DIR}`);
  }
  const oraclePath = join(SAMPLES_DIR, "ORACLE.json");
  if (!existsSync(oraclePath)) {
    throw new Error(
      `Corpus has no ORACLE.json: ${SAMPLES_DIR}\n` +
        `A corpus without an oracle can only prove the lanes AGREE, never that either is RIGHT. Refusing to report a pass.`,
    );
  }
  const oracle = JSON.parse(readFileSync(oraclePath, "utf-8")) as Oracle;

  const files = readdirSync(SAMPLES_DIR).filter((f) => f.endsWith(".spec.json"));
  if (files.length === 0) {
    throw new Error(`Binding-plan parity corpus has no .spec.json files: ${SAMPLES_DIR}`);
  }

  // Kept separate so the summary can report WHICH CLAIM failed. "the lanes
  // disagree" and "the lanes agree but are both wrong" are different findings and
  // a single total would hide the difference.
  const driftFailures: string[] = [];
  const oracleFailures: string[] = [];
  const failures: string[] = [];

  // ─── MEMBERSHIP: declared corpus, fail-closed.
  // `A SURFACE IS NOT FAIL-CLOSED UNTIL ITS ENUMERATION IS` (R-474). A deleted
  // fixture must DENY the claim, never silently shrink the denominator.
  const present = new Set(files);
  const missing = oracle.required_members.filter((m) => !present.has(m));
  const undeclared = files.filter((f) => !oracle.required_members.includes(f));
  // ★ PRINT every membership failure, do not merely count it. First version of
  //   this script pushed these into `failures` without a console.error, so a
  //   deleted fixture produced `FAIL: 4` while naming only 3 causes — a failure
  //   the reader cannot act on, found by red-proofing this gate rather than by
  //   reading it. `A COUNTED FAILURE THAT IS NOT NAMED IS HALF A GREEN.`
  const membership: string[] = [];
  for (const m of missing) {
    membership.push(`MEMBERSHIP: required corpus member ABSENT: ${m} — the claim is DENIED, not re-scoped to the survivors`);
  }
  for (const f of undeclared) {
    membership.push(`MEMBERSHIP: fixture present but NOT DECLARED in ORACLE.required_members: ${f} (an unadjudicated fixture cannot pass)`);
  }
  if (membership.length > 0) {
    console.error(`MEMBERSHIP FAILURE (declared corpus = ${oracle.required_members.length}, found = ${files.length}):`);
    for (const m of membership) console.error(`  - ${m}`);
  }
  failures.push(...membership);

  // Collected so cross-fixture reason-distinctness (oracle P-4/P-6) can be
  // asserted after every plan exists.
  const observedReasons = new Map<string, string | null>();
  let checked = 0;

  for (const file of files.sort()) {
    const raw = JSON.parse(readFileSync(join(SAMPLES_DIR, file), "utf-8"));
    const spec = raw.spec;
    checked += 1;

    const tsPlan = tsBindingPlanAsPyShape(spec);
    const pyPlan = pyBindingPlan(spec);

    // CLAIM 1 — agreement.
    const drift: string[] = [];
    diffDeep(tsPlan, pyPlan, "plan", drift);
    duplicateConditionIds(tsPlan, "ts", drift);
    duplicateConditionIds(pyPlan, "py", drift);

    // CLAIM 2 — correctness, asserted against BOTH lanes independently.
    // Checking only one lane would let a wrong-but-agreeing pair through on the
    // unchecked side.
    const oracleFails: string[] = [];
    checkOracle(file, oracle, tsPlan, "ts", oracleFails);
    checkOracle(file, oracle, pyPlan, "py", oracleFails);

    for (const lane of [
      ["ts", tsPlan],
      ["py", pyPlan],
    ] as const) {
      for (const r of ((lane[1].bindings as Array<Record<string, unknown>>) ?? [])) {
        observedReasons.set(`${lane[0]}|${file}|${String(r.condition_id)}`, (r.reason ?? null) as string | null);
      }
    }

    if (drift.length > 0) {
      console.error(`DRIFT in ${file}:`);
      for (const m of drift) console.error(`  - ${m}`);
      // Push EVERY message, not one summary per fixture. The first version
      // pushed a single string per fixture while the final line read
      // "FAIL: N condition(s) failed" — so N counted FIXTURES and the caption
      // said CONDITIONS. A caption is a claim; the count now matches the noun.
      driftFailures.push(...drift.map((m) => `${file}: ${m}`));
    }
    if (oracleFails.length > 0) {
      console.error(`ORACLE VIOLATION in ${file}:`);
      for (const m of oracleFails) console.error(`  - ${m}`);
      oracleFailures.push(...oracleFails.map((m) => `${file}: ${m}`));
    }
  }

  // ─── Cross-fixture reason distinctness — the oracle's sharpest assertion.
  // "If row 21's and row 10's reason strings are equal, P-4 is violated and the
  // repair is incomplete even with every other field green."
  for (const [fixtureName, expect] of Object.entries(oracle.fixtures)) {
    for (const pair of expect.reasons_must_differ_from ?? []) {
      for (const lane of ["ts", "py"]) {
        const a = observedReasons.get(`${lane}|${fixtureName}|${pair.condition}`);
        const b = observedReasons.get(`${lane}|${pair.fixture}|${pair.other_condition}`);
        if (a === undefined || b === undefined) continue; // membership already reported it
        if (a === b) {
          const m =
            `${lane}: ORACLE P-4/P-6 VIOLATION — ${fixtureName}.${pair.condition} and ` +
            `${pair.fixture}.${pair.other_condition} have the SAME reason ${JSON.stringify(a)}. ` +
            `"refused deliberately" and "never recognized" must be distinguishable; they need opposite remedies. [${expect.authority}]`;
          console.error(`  - ${m}`);
          failures.push(m);
        }
      }
    }
  }

  console.log(`Checked ${checked} sample specs against ${oracle.required_members.length} declared members.`);
  console.log(`Oracle authority: ${oracle.authority_file} sha256=${oracle.authority_sha256}`);

  // ─── NO SILENT CAPS. Every declared coverage gap is PRINTED on a passing run,
  // not only on failure — a green line that hides what it did not check is the
  // shape this whole gate exists to stop.
  const gaps: string[] = [];
  for (const [name, f] of Object.entries(oracle.fixtures)) {
    if (f.scalars_unadjudicated) gaps.push(`  ${name}: plan-level NOT oracle-checked — ${f.scalars_unadjudicated}`);
    if (f.conditions_unadjudicated) gaps.push(`  ${name}: conditions NOT oracle-checked — ${f.conditions_unadjudicated}`);
  }
  if (gaps.length > 0) {
    console.log(`DECLARED ORACLE COVERAGE GAPS (agreement still enforced on these; CORRECTNESS is not):`);
    for (const g of gaps) console.log(g);
  }
  const total = failures.length + driftFailures.length + oracleFailures.length;
  if (total > 0) {
    // Report the two claims SEPARATELY. `AGREEMENT ok / CORRECTNESS failed` is a
    // completely different engineering situation from `AGREEMENT failed`, and a
    // single number cannot say which.
    console.error(
      `FAIL: ${total} failure(s) — ` +
        `CLAIM 1 AGREEMENT: ${driftFailures.length === 0 ? "PASS (lanes emit identical plans)" : `${driftFailures.length} drift(s)`} · ` +
        `CLAIM 2 ORACLE CORRECTNESS: ${oracleFailures.length === 0 ? "PASS" : `${oracleFailures.length} violation(s)`} · ` +
        `MEMBERSHIP: ${failures.length === 0 ? "PASS" : `${failures.length} failure(s)`}`,
    );
    if (driftFailures.length === 0 && oracleFailures.length > 0) {
      console.error(
        `  ★ NOTE: the lanes AGREE and are BOTH WRONG against the frozen oracle. ` +
          `This is the exact case a two-lane diff can never detect. Per the oracle authority §5-3 this is a FINDING to file — DO NOT edit the oracle to match the output.`,
      );
    }
    process.exit(1);
  }
  console.log("PASS: TS and Python binding plans AGREE, and both CONFORM to the frozen oracle.");
}

main();
