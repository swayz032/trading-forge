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
import { createHash } from "node:crypto";
import { compileBindingPlan, FAMILY_META, refusedSessionZone } from "../src/server/lib/spec-family-bindings.js";
import type { BindingPlan, ConditionBinding } from "../src/server/lib/spec-family-bindings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ★★★ DEFAULT CORPUS CHANGED (R-485 item 1): was `spec-binding-parity`, a
//     ONE-fixture directory with no oracle. That corpus IS the false-green this
//     packet exists to close — `A GATE THAT PASSES EVERY FIXTURE IT WAS GIVEN
//     CERTIFIES ITS FIXTURES, NOT ITS DOMAIN.` Wiring the gate into CI while it
//     still defaulted there would have shipped a green that proves one fixture.
//
// ★ NOTHING IS LOST: `spec-binding-parity-expanded/00-control-shipped.spec.json`
//   is a byte copy of the old corpus's single fixture and is a REQUIRED member of
//   the manifest — so the shipped case still runs, and it can no longer be
//   silently dropped. The legacy directory is left in place, untouched.
const SAMPLES_DIR = process.env.TF_SPEC_BINDING_SAMPLES_DIR
  ? join(process.env.TF_SPEC_BINDING_SAMPLES_DIR)
  : join(__dirname, "..", "ci", "fixtures", "spec-binding-parity-expanded");

const PY_DRIVER = `
import json, sys
from src.engine.spec_family_bindings import compile_binding_plan
spec = json.loads(sys.stdin.read())
plan = compile_binding_plan(spec)
print(json.dumps(plan.to_dict()))
`;

const PY_FAMILY_META_DRIVER = `
import json
from dataclasses import asdict
from src.engine.spec_family_bindings import FAMILY_META
print(json.dumps({k: asdict(v) for k, v in FAMILY_META.items()}))
`;

/**
 * QUEUE-REASON DIVERGENCE TRIPWIRE (R-485 §4, option (iii)).
 *
 * THE LATENT DEFECT IT GUARDS — measured, not hypothesised:
 *   spec-family-bindings.ts:  `triggerBinding.reason ?? "unbindable"`  => "unbindable"
 *   spec_family_bindings.py:  `trigger_binding.reason`                 => None
 * TS has a fallback Python does not, so the lanes emit DIFFERENT queue-reason
 * payloads for the same plan — but only when a binding is `bindable=false` AND
 * `reason=null` at the same time.
 *
 * ★★★ NEITHER LANE IS CHANGED HERE. R-485 §54 refused both directions: the parity
 *     direction for this field is UNRULED (R-483 §72 ruled Python correct on
 *     ORPHAN-ZONE refusal, which is not this field), and a fix would edit a
 *     queue-reason payload whose downstream readers are [UNENUMERATED — OPEN].
 *
 * ★★★★★ SO THIS ASSERTS THE PRECONDITION IS EMPTY, NOT THAT SOME FIXTURES PASS.
 *     Today no FAMILY_META entry can produce that state: every unbindable return
 *     path sets a non-null reason, and the only way to reach `bindable=false` with
 *     `reason=null` is an entry with `unsupported: true` and NO unbound reason. A
 *     future entry like that ARMS the divergence silently — and once armed the
 *     whole-plan comparator WILL go red. That is the repair working, not breaking
 *     (ratified in advance, R-485 §57).
 *
 * ★★★★★ AND IT OWES A PATH TO RED, which is why the DISCRIMINATES control below
 *     runs in this same function on every execution: `A GREEN CHECK WITH NO PATH
 *     TO RED IS NOT A CHECK`, and a tripwire over an already-empty condition is
 *     the easiest place in this repo to ship a permanent green.
 */
interface FamilyMetaLike {
  unsupported?: boolean;
  unboundReason?: string | null;
  unbound_reason?: string | null;
}

/** Family names that ARM the divergence. Empty = the precondition holds. */
export function armedQueueReasonFamilies(table: Record<string, FamilyMetaLike>): string[] {
  return Object.entries(table)
    .filter(([, m]) => {
      const unsupported = m.unsupported === true;
      // Accept either lane's key spelling; a missing key and an explicit null are
      // the same hazard.
      const reason = m.unboundReason !== undefined ? m.unboundReason : m.unbound_reason;
      return unsupported && (reason === null || reason === undefined || reason === "");
    })
    .map(([name]) => name);
}

function pyFamilyMeta(): Record<string, FamilyMetaLike> {
  const result = spawnSync("python", ["-c", PY_FAMILY_META_DRIVER], {
    encoding: "utf-8",
    cwd: join(__dirname, ".."),
  });
  if (result.status !== 0) throw new Error(`Python FAMILY_META driver failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function checkQueueReasonTripwire(out: string[], notes: string[]): void {
  // ─── DISCRIMINATES CONTROL, RUN FIRST, IN THE SAME EXECUTION.
  // A planted entry that MUST be detected, beside a same-shape safe neighbour
  // that must NOT be. If this comes back wrong the detector is broken and every
  // "precondition holds" result below is worthless — so the control failing is
  // itself a hard failure, never a warning.
  const planted: Record<string, FamilyMetaLike> = {
    SYNTHETIC_ARMED_FAMILY: { unsupported: true, unboundReason: null },
    SYNTHETIC_SAFE_FAMILY: { unsupported: true, unboundReason: "control_flow_reset_unsupported" },
  };
  const detected = armedQueueReasonFamilies(planted);
  if (detected.length !== 1 || detected[0] !== "SYNTHETIC_ARMED_FAMILY") {
    out.push(
      `TRIPWIRE SELF-CONTROL FAILED: planted an armed family and the detector returned ` +
        `${JSON.stringify(detected)} instead of ["SYNTHETIC_ARMED_FAMILY"]. The tripwire cannot fire, ` +
        `so its green means nothing. A GREEN CHECK WITH NO PATH TO RED IS NOT A CHECK.`,
    );
    return;
  }
  notes.push(
    `tripwire DISCRIMINATES control: planted 1 armed + 1 same-shape safe family; detector returned ` +
      `exactly ["SYNTHETIC_ARMED_FAMILY"] — it CAN fire, and does NOT fire on the safe neighbour`,
  );

  // ─── The real assertion, over BOTH lanes' live tables.
  const tsArmed = armedQueueReasonFamilies(FAMILY_META as unknown as Record<string, FamilyMetaLike>);
  const pyTable = pyFamilyMeta();
  const pyArmed = armedQueueReasonFamilies(pyTable);
  const tsKeys = Object.keys(FAMILY_META).sort();
  const pyKeys = Object.keys(pyTable).sort();

  // Assert non-empty BEFORE believing any comparison over these tables.
  // A DIFF OF TWO EMPTY SETS IS ALWAYS GREEN.
  if (tsKeys.length === 0 || pyKeys.length === 0) {
    out.push(
      `TRIPWIRE: a FAMILY_META table read as EMPTY (ts=${tsKeys.length}, py=${pyKeys.length}) — ` +
        `that is an extractor defect, not a clean result.`,
    );
    return;
  }
  if (JSON.stringify(tsKeys) !== JSON.stringify(pyKeys)) {
    out.push(
      `TRIPWIRE: FAMILY_META KEY SETS DIVERGE — ts only: ` +
        `${JSON.stringify(tsKeys.filter((k) => !pyKeys.includes(k)))} · py only: ` +
        `${JSON.stringify(pyKeys.filter((k) => !tsKeys.includes(k)))}`,
    );
  }
  for (const [lane, armed] of [
    ["ts", tsArmed],
    ["py", pyArmed],
  ] as const) {
    if (armed.length > 0) {
      out.push(
        `TRIPWIRE ARMED in ${lane}: FAMILY_META entr${armed.length === 1 ? "y" : "ies"} ${JSON.stringify(armed)} ` +
          `set unsupported=true with NO unbound reason, which makes a binding bindable=false with reason=null ` +
          `and activates the TS/Python queue-reason divergence (ts "unbindable" vs py null). The parity ` +
          `direction for this field is UNRULED (R-485 §4) — escalate, do not pick a side.`,
      );
    }
  }
  notes.push(
    `queue-reason precondition: EMPTY in both lanes across ${tsKeys.length} FAMILY_META families ` +
      `(ts armed=${tsArmed.length}, py armed=${pyArmed.length}) — the divergence is UNREACHABLE, not fixed`,
  );
}

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

// ─── R-496 CORRECTION A: EXHAUSTIVE NORMALIZATION *BEFORE* COMPARISON ────────
//
// ⚠️★★★★★ WHAT WAS HERE BEFORE, AND WHY ITS CAPTION WAS THE DANGEROUS PART.
//   The previous version of this function was a HAND-WRITTEN WHITELIST — 10
//   literal binding fields and 11 literal plan fields — and its doc comment
//   asserted it was "deliberately TOTAL rather than selective", claiming the
//   bidirectional key-set check turned any omission into a hard failure.
//
//   THAT WAS FALSE BY CONSTRUCTION, and this comment replaces it rather than
//   softening it. `diffDeep()` consumes this function's OUTPUT, so it can only
//   ever compare keys that SURVIVED the projection. A TS-only field was dropped
//   here, was absent from Python, the two sides agreed on what remained, and the
//   gate exited 0. `A BIDIRECTIONAL COMPARATOR IS ONLY AS WIDE AS THE OBJECT
//   THAT REACHES IT — A LOSSY PROJECTION MAKES A PERFECT DIFF PERFECTLY BLIND.`
//   `THE REMEDY IS THE MECHANISM, NEVER A SOFTER CAPTION.`
//
// THE MECHANISM NOW HAS TWO INDEPENDENT DOORS, AND THEY CATCH DIFFERENT DRIFT:
//   1. COMPILE TIME — `satisfies Record<keyof …, string>` below. Add a field to
//      `BindingPlan`/`ConditionBinding` and the BUILD fails until the mapping is
//      extended. Excess and missing keys are BOTH rejected.
//   2. RUN TIME — `projectExhaustively()`. A field that appears on the object
//      WITHOUT being declared on the interface (a cast, a spread, a widened
//      return) is invisible to door 1. So the RAW object's own enumerable keys
//      are compared against the mapping's keys BEFORE any projection happens,
//      and any mismatch is a NAMED failure at an exact path.
//   ★★★ Door 1 alone is what a reader would assume `satisfies` buys them. It is
//       not enough, and assuming it is how the first hole was argued for.

/** camelCase (TS) → snake_case (Python wire). EXHAUSTIVE, compile-time checked. */
const PLAN_KEY_MAP = {
  bindings: "bindings",
  invalidationBindings: "invalidation_bindings",
  triggerConditionId: "trigger_condition_id",
  triggerBound: "trigger_bound",
  spineTotal: "spine_total",
  spineBound: "spine_bound",
  confluenceTotal: "confluence_total",
  confluenceBound: "confluence_bound",
  approximationUsed: "approximation_used",
  compiled: "compiled",
  queueReasons: "queue_reasons",
} as const satisfies Record<keyof BindingPlan, string>;

/** Same, for a single binding row. EXHAUSTIVE, compile-time checked. */
const BINDING_KEY_MAP = {
  conditionId: "condition_id",
  type: "type",
  role: "role",
  object: "object",
  bindable: "bindable",
  primitive: "primitive",
  approximation: "approximation",
  executed: "executed",
  reason: "reason",
  sessionZone: "session_zone",
} as const satisfies Record<keyof ConditionBinding, string>;

/**
 * Project `raw` through `map`, but ONLY after proving the two agree exactly.
 *
 * ★★★ THE ORDER IS THE WHOLE POINT: validate the RAW key set FIRST, project
 *     SECOND. Projecting first is what made an unknown field unobservable.
 *
 * Four rejections, each naming the exact path:
 *   - EXTRA RAW KEY      — present on the object, absent from the mapping
 *   - MISSING MAPPED KEY — mapping declares it, the object does not carry it
 *   - DUPLICATE DESTINATION — two source keys collide on one wire name, which
 *                             would silently overwrite one of them
 *   - UNCONSUMED KEY     — a mapping entry that never consumed a source key
 */
function projectExhaustively(
  raw: Record<string, unknown>,
  map: Record<string, string>,
  path: string,
  out: string[],
): Record<string, unknown> {
  const rawKeys = Object.keys(raw);
  const mapKeys = Object.keys(map);

  for (const k of rawKeys) {
    if (!Object.prototype.hasOwnProperty.call(map, k)) {
      out.push(
        `${path}.${k}: UNMAPPED TS FIELD — present on the raw TypeScript object and ABSENT from the ` +
          `normalization mapping. It would have been DROPPED before comparison, so the lanes would have ` +
          `agreed about a field one of them never emitted. A NEW FIELD IS A NEW DRIFT BY DEFAULT.`,
      );
    }
  }
  for (const k of mapKeys) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) {
      out.push(
        `${path}.${k}: MISSING SOURCE FIELD — the mapping declares it, the raw TypeScript object does not ` +
          `carry it. The projection would have emitted \`undefined\` under a name Python does populate.`,
      );
    }
  }
  const seen = new Map<string, string[]>();
  for (const k of mapKeys) {
    const dest = map[k]!;
    seen.set(dest, [...(seen.get(dest) ?? []), k]);
  }
  for (const [dest, sources] of seen) {
    if (sources.length > 1) {
      out.push(
        `${path} → ${dest}: DUPLICATE DESTINATION — source keys ${JSON.stringify(sources)} all map to one ` +
          `wire name. All but one would be silently overwritten.`,
      );
    }
  }

  const projected: Record<string, unknown> = {};
  const consumed = new Set<string>();
  for (const k of mapKeys) {
    if (Object.prototype.hasOwnProperty.call(raw, k)) {
      projected[map[k]!] = raw[k];
      consumed.add(k);
    }
  }
  for (const k of mapKeys) {
    if (!consumed.has(k)) {
      out.push(`${path}.${k}: UNCONSUMED MAPPING ENTRY — declared in the mapping, never read from the source.`);
    }
  }
  return projected;
}

/**
 * Emit the TS plan in Python's wire shape.
 *
 * ★★★ EVERY key Python's `to_dict()` produces must appear in `PLAN_KEY_MAP` /
 *     `BINDING_KEY_MAP`. This function is NOT trusted to be total — it is PROVEN
 *     total per call by `projectExhaustively()`, which fails the run and names
 *     the path when the raw object and the mapping disagree in either direction.
 */
function tsBindingPlanAsPyShape(spec: unknown, schemaFailures: string[], label: string): Record<string, unknown> {
  const plan = compileBindingPlan(spec as never) as unknown as Record<string, unknown>;
  const binding = (b: unknown, path: string) =>
    projectExhaustively(b as Record<string, unknown>, BINDING_KEY_MAP, path, schemaFailures);

  const projected = projectExhaustively(plan, PLAN_KEY_MAP, `${label}.plan`, schemaFailures);
  projected.bindings = (plan.bindings as unknown[]).map((b, i) => binding(b, `${label}.plan.bindings[${i}]`));
  projected.invalidation_bindings = (plan.invalidationBindings as unknown[]).map((b, i) =>
    binding(b, `${label}.plan.invalidation_bindings[${i}]`),
  );
  return projected;
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
  /**
   * PER-FIELD DECLARED GAPS: { fieldName: reason }.
   *
   * ★★★ "ASSERTING THE IMPLEMENTATION'S VALUE AND ASSERTING NOTHING ARE
   *      DIFFERENT ACTS." A field named here carries NO expectation — it is not
   *      asserted equal to whatever the lanes emit, it is declared UNADJUDICATED
   *      and printed as such on every run.
   *
   * ★ A field may not be BOTH expected and declared-unadjudicated. That
   *   contradiction is itself a hard failure below, because a row quietly holding
   *   both would let a stale expectation sit next to its own withdrawal.
   */
  unadjudicated?: Record<string, string>;
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
  declaredGaps: string[],
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

    // ─── Declared per-field gaps. Recorded for printing, and CONTRADICTION with
    // a live expectation is a hard failure: a withdrawn assertion must not sit
    // beside the value it withdrew.
    const gapFields = Object.keys(want.unadjudicated ?? {});
    for (const f of gapFields) {
      const hasExpectation =
        (f === "approximation" && want.approximation !== undefined) ||
        (f === "bindable" && want.bindable !== undefined) ||
        (f === "session_zone" && want.session_zone !== undefined) ||
        (f === "primitive" && want.primitive_null !== undefined) ||
        (f === "reason" && (want.reason_null !== undefined || want.reason_names !== undefined || want.reason_excludes !== undefined));
      if (hasExpectation) {
        out.push(
          `${lane}: ORACLE ${condId}.${f} is declared UNADJUDICATED *and* carries an expectation — ` +
            `contradiction. Asserting a value and asserting nothing are different acts; pick one. ${cite}`,
        );
      }
      if (lane === "ts") {
        // Record once, not per lane — a gap is a property of the oracle, not of a run.
        declaredGaps.push(`${fixtureName} · ${condId}.${f} — ${want.unadjudicated![f]}`);
      }
    }
    const isGap = (f: string) => gapFields.includes(f);
    if (!isGap("bindable") && want.bindable !== undefined && got.bindable !== want.bindable) {
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
    if (!isGap("approximation") && want.approximation !== undefined && got.approximation !== want.approximation) {
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

/**
 * ─── STEP D (R-492 §5-D / R-493 §5-D): AXIS-4 SELF-CONTROLS.
 *
 * ★★★★★ WHY THESE ARE TRANSIENT AND IN-RUN RATHER THAN CORPUS FIXTURES, which is
 *   a correctness point and not a convenience: a fixture carrying a duplicate
 *   `condition_id` would be a PERMANENTLY INVALID declared member — the gate
 *   would exit 1 forever and the corpus would encode a defect as a requirement.
 *   `duplicateConditionIds` and `diffDeep` are pure functions, so they can be
 *   driven with planted input inside the run and nothing is written to disk.
 *   There are no bytes to restore, which is the strongest form of "restore the
 *   bytes afterwards".
 *
 * ★★★ R-488 §3 froze BOTH of these checks as `[UNPROVEN]` and UNCITABLE because
 *   NO fixture made either of them FIRE. This is what makes them citable: each
 *   planted defect must be detected AND NAMED, and each is paired with a
 *   SAME-SHAPE CLEAN NEIGHBOUR that must stay silent. A detector that fires on
 *   everything is as useless as one that fires on nothing —
 *   `A CONTROL MUST DISCRIMINATE, NOT MERELY TRIGGER.`
 */
function checkAxis4SelfControls(out: string[], notes: string[]): void {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    condition_id: id, type: "FILTER", role: "confluence", object: "volume", bindable: true,
    primitive: "p", approximation: false, executed: true, reason: null, session_zone: null, ...extra,
  });

  // ─── D-1: DUPLICATE condition_id. Planted vs same-shape clean neighbour.
  const planted: string[] = [];
  duplicateConditionIds(
    { bindings: [row("alpha"), row("PLANTED_DUP"), row("PLANTED_DUP")], invalidation_bindings: [] },
    "selfcontrol", planted,
  );
  const clean: string[] = [];
  duplicateConditionIds(
    // SAME SHAPE, SAME LENGTH — differing only in that the ids are distinct.
    { bindings: [row("alpha"), row("PLANTED_DUP"), row("PLANTED_DUP_2")], invalidation_bindings: [] },
    "selfcontrol", clean,
  );
  if (planted.length !== 1 || !planted[0].includes("PLANTED_DUP") || !planted[0].includes("2x")) {
    out.push(
      `AXIS-4 SELF-CONTROL FAILED (duplicate id): planted one duplicated condition_id and the detector ` +
        `returned ${JSON.stringify(planted)} — expected exactly one finding NAMING "PLANTED_DUP" and its ` +
        `multiplicity. A detector that cannot name what it caught is half a green.`,
    );
  }
  if (clean.length !== 0) {
    out.push(
      `AXIS-4 SELF-CONTROL FAILED (duplicate id, clean neighbour): a same-shape plan with DISTINCT ids ` +
        `produced ${JSON.stringify(clean)} — the detector fires on innocent input, so its silence proves nothing.`,
    );
  }

  // ─── D-2: ARRAY MULTIPLICITY and ORDER, through the CLAIM 1 comparator.
  // `A REORDER IS NOT A NO-OP`: length equality alone was an old blind spot, so
  // the reorder case matters as much as the duplication case.
  const base = { bindings: [row("a"), row("b")] };
  const cases: Array<[string, unknown, (m: string[]) => boolean]> = [
    ["MULTIPLICITY (element duplicated)", { bindings: [row("a"), row("b"), row("b")] },
      (m) => m.some((x) => x.includes("length") && x.includes("ts=2") && x.includes("py=3"))],
    ["ORDER (same elements, swapped)", { bindings: [row("b"), row("a")] },
      (m) => m.some((x) => x.includes("condition_id"))],
  ];
  for (const [label, mutated, accepts] of cases) {
    const found: string[] = [];
    diffDeep(base, mutated, "plan", found);
    if (found.length === 0 || !accepts(found)) {
      out.push(
        `AXIS-4 SELF-CONTROL FAILED (${label}): the comparator returned ${JSON.stringify(found)} for a plan ` +
          `that differs from its baseline in exactly that way. The check cannot see this defect class, so ` +
          `every green it has ever produced about that class is vacuous.`,
      );
    }
  }
  // The clean neighbour for the comparator: identical input must stay silent.
  const identical: string[] = [];
  diffDeep(base, { bindings: [row("a"), row("b")] }, "plan", identical);
  if (identical.length !== 0) {
    out.push(
      `AXIS-4 SELF-CONTROL FAILED (comparator, clean neighbour): two IDENTICAL plans produced ` +
        `${JSON.stringify(identical)}. A comparator that reports drift on identical input makes every ` +
        `drift it reports uninterpretable.`,
    );
  }

  notes.push(
    `axis-4 self-controls: duplicate-condition_id DETECTED and NAMED ("PLANTED_DUP", 2x) with a same-shape ` +
      `distinct-id neighbour SILENT · array MULTIPLICITY and ORDER both detected, identical plans SILENT — ` +
      `all planted in-run, no corpus member is permanently invalid (R-488 §3's two [UNPROVEN] checks now fire)`,
  );
}

// ─── STEP C (R-492 §5-C / R-493 §5): THE P-7 OVER-REFUSAL PROPERTY CHECK.
//
// ★★★★★ THE CIRCULARITY SPLIT, WHICH IS THE WHOLE DESIGN CONSTRAINT:
//   `FAMILY_META` MAY ENUMERATE MEMBERSHIP — which families exist is an engine
//   fact. `P-7` SUPPLIES THE EXPECTED SEMANTICS — what they must DO. Reading the
//   population from the implementation is legitimate; reading the EXPECTATION
//   from it is the defect the oracle exists to prevent.
//
// ★★★ SO BOTH LISTS BELOW ARE FROZEN AND PRE-REGISTERED (AR-504 §2, committed at
//     `8d676394` BEFORE this code existed). They are not derived at runtime. A
//     family or phrase that appears or disappears in the implementation without
//     this list changing must go RED — `A SURFACE IS NOT FAIL-CLOSED UNTIL ITS
//     ENUMERATION IS`. A generated grid that silently resizes itself certifies
//     nothing, because it can only ever cover what the code already does.

/** PRE-REGISTERED (AR-504 §1). The 13 families that do NOT require a session keyword. */
const P7_DECLARED_NON_SESSION_FAMILIES = [
  "CONFIRM_DIRECTION", "ENABLE_ENTRY", "ENTER", "EXCEPTION", "EXIT_HINT", "FILTER",
  "INVALIDATE", "RESET", "VERIFY_STRUCTURE", "WAIT_BIAS", "WAIT_CONFIRMATION",
  "WAIT_RETEST", "WAIT_STRUCTURE",
] as const;

/** PRE-REGISTERED (AR-504 §1). Phrases that MUST still name a refused zone. */
const P7_DECLARED_REFUSED_PHRASES = [
  "lunch", "midday", "noon session", "overnight", "globex", "asia session", "pre market", "premarket",
] as const;

/** The object text a probe and its adjacent control BOTH carry — identical on purpose. */
const p7ObjectText = (phrase: string) => `volume ${phrase}`;

/**
 * The NEUTRAL twin: same sentence frame, NO refused-zone phrase. Asserted to
 * carry no refusal label before use, so the differential below cannot degenerate
 * into comparing two refused rows.
 */
const P7_NEUTRAL_OBJECT = "volume elevated";

/**
 * Asserts P-7 over the FULL non-session family × refused-phrase grid, in BOTH
 * lanes, against an expectation derived from the authority rather than from
 * either lane.
 *
 * ★★★★★ WHY A PROPERTY CHECK AND NOT TEN MORE FIXTURES: a fixture corpus asserts
 *   CLAIM 1 (the lanes agree) plus whatever the oracle adjudicates. This asserts
 *   P-7 DIRECTLY on every member of the population, so a defect appearing
 *   IDENTICALLY IN BOTH LANES still fails. AR-499 measured that the two-lane case
 *   printed `EXIT 0 · PASS`; `AGREEMENT IS NOT A DEFENCE`.
 */
function checkOverRefusalProperty(out: string[], notes: string[]): void {
  // ─── CONTROL 1: MEMBERSHIP. Addition AND deletion must both DENY.
  const liveNonSession = Object.entries(FAMILY_META)
    .filter(([, m]) => !(m as { requiresSessionKeyword?: boolean }).requiresSessionKeyword)
    .map(([name]) => name)
    .sort();
  // Widened to string[] deliberately: the literal-union type would make
  // `includes` reject any name NOT already declared — i.e. the compiler would
  // refuse to express the very comparison this control exists to perform.
  const declared: string[] = [...P7_DECLARED_NON_SESSION_FAMILIES].sort();
  const added = liveNonSession.filter((f) => !declared.includes(f));
  const removed = declared.filter((f) => !liveNonSession.includes(f));
  if (added.length > 0 || removed.length > 0) {
    out.push(
      `P-7 PROPERTY MEMBERSHIP FAILURE — the non-session family population changed and the ` +
        `pre-registered list did not. UNDECLARED (present in FAMILY_META, never probed): ` +
        `${JSON.stringify(added)} · MISSING (declared, no longer in FAMILY_META): ${JSON.stringify(removed)}. ` +
        `★ A new family would otherwise enter the engine with ZERO over-refusal coverage while this ` +
        `check stayed green. Update the pre-registered list in a dated report, never silently.`,
    );
    return; // A grid over the wrong population proves nothing; do not run it.
  }

  // ─── CONTROL 2: THE PROBES MUST STILL PROBE, AND THE NEUTRAL TWIN MUST STAY NEUTRAL.
  // A phrase that no longer names a refused zone cannot test an OVER-refusal —
  // the row would pass trivially. This asserts the test's PRECONDITION, which is
  // a different act from asserting its expected output.
  const deadPhrases = P7_DECLARED_REFUSED_PHRASES.filter(
    (p) => refusedSessionZone(p7ObjectText(p)) === null,
  );
  if (deadPhrases.length > 0) {
    out.push(
      `P-7 PROPERTY PRECONDITION FAILURE — ${JSON.stringify(deadPhrases)} no longer name a refused ` +
        `zone, so probes built from them would pass VACUOUSLY. A green here would mean "nothing was ` +
        `refused", not "nothing was over-refused". Fix the phrase list or the table, do not ignore this.`,
    );
    return;
  }
  if (refusedSessionZone(P7_NEUTRAL_OBJECT) !== null) {
    out.push(
      `P-7 PROPERTY PRECONDITION FAILURE — the NEUTRAL twin ${JSON.stringify(P7_NEUTRAL_OBJECT)} now names a ` +
        `refused zone. The differential below compares "with a refused phrase" against "without one"; if the ` +
        `twin is itself refused the comparison is two refused rows and passes VACUOUSLY.`,
    );
    return;
  }

  // ─── The generated grid. Probe rows + an ADJACENT positive control per phrase,
  //     carrying byte-identical object text so the check separates "refuses the
  //     right thing" from "refuses anything containing the word".
  interface Row { id: string; type: string; object: string; role: string }
  const conditions: Row[] = [{ id: "trigger", type: "ENTER", object: "market", role: "spine" }];
  /** family -> its NEUTRAL-twin row id. One per family, shared by all phrases. */
  const twinIds = new Map<string, string>();
  for (const family of [...P7_DECLARED_NON_SESSION_FAMILIES, "WAIT_SESSION"]) {
    const id = `p7_twin_${family}`;
    conditions.push({ id, type: family, object: P7_NEUTRAL_OBJECT, role: "confluence" });
    twinIds.set(family, id);
  }
  const probeIds = new Map<string, { family: string; phrase: string }>();
  const controlIds = new Map<string, { phrase: string; zone: string }>();
  for (let pi = 0; pi < P7_DECLARED_REFUSED_PHRASES.length; pi++) {
    const phrase = P7_DECLARED_REFUSED_PHRASES[pi];
    const object = p7ObjectText(phrase);
    for (const family of P7_DECLARED_NON_SESSION_FAMILIES) {
      const id = `p7_${family}_${pi}`;
      conditions.push({ id, type: family, object, role: "confluence" });
      probeIds.set(id, { family, phrase });
    }
    const cid = `p7_control_${pi}`;
    conditions.push({ id: cid, type: "WAIT_SESSION", object, role: "confluence" });
    controlIds.set(cid, { phrase, zone: refusedSessionZone(object)! });
  }
  const spec = { entry_trigger_id: "trigger", entry_conditions: conditions, invalidations: [] };

  const lanes: Array<[string, Record<string, unknown>]> = [
    ["ts", tsBindingPlanAsPyShape(spec, out, "p7")],
    ["py", pyBindingPlan(spec)],
  ];

  let probesChecked = 0;
  let controlsChecked = 0;
  for (const [lane, plan] of lanes) {
    const rows = (plan.bindings as Array<Record<string, unknown>>) ?? [];
    const byId = new Map(rows.map((r) => [String(r.condition_id), r]));

    for (const [id, { family, phrase }] of probeIds) {
      const got = byId.get(id);
      if (!got) {
        out.push(`${lane}: P-7 PROPERTY — generated probe ${id} (${family} / "${phrase}") MISSING from the plan`);
        continue;
      }
      const twin = byId.get(twinIds.get(family)!);
      if (!twin) {
        out.push(`${lane}: P-7 PROPERTY — neutral twin for ${family} MISSING from the plan`);
        continue;
      }
      probesChecked++;
      // ─── P-7 AS AN INDEPENDENCE PROPERTY, WHICH IS WHAT IT ACTUALLY SAYS:
      //     "its bindability is INDEPENDENT of which zones are evaluable or
      //     refused". So the assertion is that this row is IDENTICAL to its
      //     neutral twin in `bindable` and `reason` — the refused phrase must
      //     make no difference.
      //
      // ★★★★★ IT IS DELIBERATELY *NOT* `bindable === true`. That absolute was my
      //     first formulation and the control run REFUTED IT: `EXCEPTION` and
      //     `RESET` are `unsupported: true` and emit bindable=false with
      //     `control_flow_*_unsupported` for a reason that has nothing to do with
      //     sessions. The engine was right and the expectation was wrong.
      //     `P-7 CONSTRAINS THE EFFECT OF THE SESSION REFUSAL, NOT THE ROW'S
      //     ABSOLUTE VALUE` — and an absolute would have forced either a weakened
      //     test or an invented behaviour change to two innocent families.
      //
      // ★★★ AND IT IS NOT CIRCULAR: neither side of this comparison is an
      //     expected value read out of the implementation. The EXPECTATION is the
      //     INVARIANCE, and that comes from the authority. An engine that
      //     over-refuses cannot satisfy it, and — unlike a two-lane diff — it
      //     cannot satisfy it by being wrong consistently either.
      if (got.bindable !== twin.bindable || JSON.stringify(got.reason) !== JSON.stringify(twin.reason)) {
        out.push(
          `${lane}: P-7 VIOLATION — ${family} is NOT independent of session-zone evaluability. ` +
            `With the refused phrase "${phrase}": bindable=${JSON.stringify(got.bindable)} ` +
            `reason=${JSON.stringify(got.reason)} · with neutral text ${JSON.stringify(P7_NEUTRAL_OBJECT)}: ` +
            `bindable=${JSON.stringify(twin.bindable)} reason=${JSON.stringify(twin.reason)}. ` +
            `This family never consults a session window, so a session-scoped refusal may not reach it. ` +
            `[authority §4d / P-7]`,
        );
      }
    }

    // ─── THE ADJACENT POSITIVE CONTROL. Without it `bindable=true` everywhere
    //     satisfies all 104 probes — including an engine that deleted the refusal
    //     entirely. The authority mandates this control at §4d.
    for (const [id, { phrase, zone }] of controlIds) {
      const got = byId.get(id);
      if (!got) {
        out.push(`${lane}: P-7 POSITIVE CONTROL — control row ${id} ("${phrase}") MISSING from the plan`);
        continue;
      }
      controlsChecked++;
      if (got.bindable !== false || typeof got.reason !== "string" || !got.reason.includes(zone)) {
        out.push(
          `${lane}: P-7 POSITIVE CONTROL FAILED — WAIT_SESSION carrying the SAME text "${p7ObjectText(phrase)}" ` +
            `emitted bindable=${JSON.stringify(got.bindable)} reason=${JSON.stringify(got.reason)}; expected ` +
            `bindable=false with a reason naming ${JSON.stringify(zone)}. ★ The refusal that MUST happen did ` +
            `not, so every "no over-refusal" result above is VACUOUS — they pass because nothing is refused ` +
            `at all. This is a HARD failure, never a warning.`,
        );
      }
      // ★★★ AND THE CONTROL MUST BE MOVED BY THE PHRASE, not merely be refused
      //     for some standing reason of its own. If WAIT_SESSION emitted the same
      //     row with and without the phrase, the independence assertions above
      //     would be comparing a constant against itself and could never fail.
      const ctlTwin = byId.get(twinIds.get("WAIT_SESSION")!);
      if (ctlTwin && got.bindable === ctlTwin.bindable && JSON.stringify(got.reason) === JSON.stringify(ctlTwin.reason)) {
        out.push(
          `${lane}: P-7 CONTROL DISCRIMINATION FAILED — WAIT_SESSION emits an IDENTICAL row with the refused ` +
            `phrase "${phrase}" and with neutral text (bindable=${JSON.stringify(got.bindable)} ` +
            `reason=${JSON.stringify(got.reason)}). The phrase moves nothing, so the differential above has no ` +
            `signal to detect and every green in it is meaningless. ` +
            `A CONTROL THAT DOES NOT DISCRIMINATE CANNOT LICENCE THE TEST BESIDE IT.`,
        );
      }
    }
  }

  notes.push(
    `P-7 over-refusal property: ${P7_DECLARED_NON_SESSION_FAMILIES.length} declared non-session families × ` +
      `${P7_DECLARED_REFUSED_PHRASES.length} refused phrases = ${probesChecked} probe assertions and ` +
      `${controlsChecked} adjacent WAIT_SESSION positive-control assertions across BOTH lanes — expectation ` +
      `from authority §4d/P-7, population from FAMILY_META, membership frozen against AR-504's list`,
  );
}

/** What the authority check COMPUTED — never what ORACLE.json asserted. */
interface AuthorityProvenance {
  path: string;
  bytes: number;
  /** SHA-256 this process computed over the bytes it actually read. */
  computedSha256: string;
}

/**
 * ─── STEP A (R-492 §5-A): AUTHORITY FRESHNESS, EXECUTABLE RATHER THAN DECORATIVE.
 *
 * ★★★ WHY THIS EXISTS, stated as the defect it replaces rather than as a feature:
 *     until this function, the gate printed `sha256=${oracle.authority_sha256}` —
 *     a value ORACLE.json ASSERTS ABOUT ITSELF, for a file that was not even in
 *     this branch. R-485 §1 then read that stdout line and concluded a
 *     verification had happened, and R-485 §8 minted the conclusion as a standard
 *     for every graded instrument here. R-491 struck both.
 *
 *     `A LINE RENDERED IN THE GRAMMAR OF A VERIFICATION IS NOT A VERIFICATION.`
 *
 * ★★★ AND WHY IT FAILS CLOSED INSTEAD OF LABELLING: R-491 §4 offered
 *     "print it labelled ASSERTED-NOT-VERIFIED" as an acceptable alternative.
 *     R-492 §2 withdrew that and the withdrawal is right — a label makes the
 *     weakness legible, it does not make the gate FAIL on staleness. A P0
 *     ratification gate must fail closed, not annotate.
 *
 * ★★ ON THE COMMITTED COPY: `DO NOT COMMIT A SECOND COPY` (the classify.py law)
 *    does not reach this case, per R-492 §2's discriminator — that hazard was a
 *    duplicate with NOTHING VERIFYING THE TWO COPIES AGREE. A copy whose raw
 *    bytes are hashed against a pin on EVERY RUN cannot silently drift; the check
 *    IS the anti-drift mechanism.
 *
 * ★★ WHAT THIS DOES NOT CLOSE, named so no reader over-reads it: the check is
 *    hermetic ABOUT ITS OWN TREE. It proves the committed copy matches the pin;
 *    it CANNOT see the campaign original drifting away from both. That residual
 *    is closed by R-492 §2's binding desk rule (amend the copy and the pin in the
 *    same motion), not by anything in this file.
 *
 * Exits NON-ZERO on missing / unreadable / mismatched, BEFORE any plan compiles.
 */
function verifyAuthorityFreshnessOrExit(oracle: Oracle): AuthorityProvenance {
  const declaredPath = oracle.authority_file;
  const pinned = oracle.authority_sha256;

  // ★ A pin that is absent or malformed is a FAILURE, not a skip. An authority
  //   check that quietly does nothing when its input is missing is the same
  //   false green in a new costume.
  if (typeof declaredPath !== "string" || declaredPath.length === 0) {
    console.error(
      `AUTHORITY FAILURE: ORACLE.json declares no 'authority_file'. ` +
        `An oracle that cannot name its authority cannot be verified against one.`,
    );
    process.exit(1);
  }
  if (typeof pinned !== "string" || !/^[0-9a-f]{64}$/.test(pinned)) {
    console.error(
      `AUTHORITY FAILURE: ORACLE.json's 'authority_sha256' is absent or not a 64-hex SHA-256: ${JSON.stringify(pinned)}. ` +
        `Refusing to treat an unpinned oracle as verified.`,
    );
    process.exit(1);
  }

  const authorityPath = join(__dirname, "..", declaredPath);
  let bytes: Buffer;
  try {
    bytes = readFileSync(authorityPath);
  } catch (err) {
    // MISSING and UNREADABLE are reported as one class deliberately: both mean
    // "this process did not read the authority", and both must deny the run.
    console.error(
      `AUTHORITY FAILURE: cannot read the frozen authority this oracle is transcribed from.\n` +
        `  declared by ORACLE.json : ${declaredPath}\n` +
        `  resolved to             : ${authorityPath}\n` +
        `  error                   : ${(err as Error).message}\n` +
        `  ★ The oracle's every expected value is transcribed from this file. Unread, the corpus is\n` +
        `    unverifiable provenance — NOT a pass with a caveat. Commit the authority into this branch.`,
    );
    process.exit(1);
  }

  const computedSha256 = createHash("sha256").update(bytes).digest("hex");
  if (computedSha256 !== pinned) {
    console.error(
      `AUTHORITY FAILURE: the frozen authority does NOT match the hash ORACLE.json pins.\n` +
        `  authority file : ${declaredPath}\n` +
        `  bytes read     : ${bytes.length}\n` +
        `  COMPUTED       : ${computedSha256}\n` +
        `  PINNED         : ${pinned}\n` +
        `  ★ One of two things is true and the gate cannot tell which, which is why it refuses BOTH:\n` +
        `    the authority was amended and this corpus was never re-pointed at it (a STALE ORACLE — every\n` +
        `    expected value below may transcribe a superseded ruling), or the committed copy has drifted.\n` +
        `    ★ DO NOT edit the pin to match the file. Re-derive the expectations from the amended authority,\n` +
        `      THEN re-pin. Editing the pin to silence this is HARDCODED TEST COPY IS A FABRICATED SAFETY CLAIM.`,
    );
    process.exit(1);
  }

  return { path: declaredPath, bytes: bytes.length, computedSha256 };
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

  // ★★★ FIRST, BEFORE A SINGLE PLAN IS COMPILED. Placed here on purpose: a
  //     result graded against a stale authority is not a weaker result, it is an
  //     UNINTERPRETABLE one, and producing it at all invites someone to read it.
  const authority = verifyAuthorityFreshnessOrExit(oracle);

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
  /** Per-field oracle gaps, collected for mandatory rendering. */
  const declaredGaps: string[] = [];

  // ─── MEMBERSHIP: declared corpus, fail-closed, as a THREE-WAY BIJECTION.
  //
  // ⚠️★★★★★ R-496 CORRECTION B. THE PREVIOUS COMMENT HERE READ: "A deleted
  //   fixture must DENY the claim, never silently shrink the denominator." IT
  //   SILENTLY SHRANK THE DENOMINATOR, and that false caption is replaced rather
  //   than reworded. The old code built `new Set(files)` and filtered
  //   `required_members` against it WITHOUT EVER CHECKING THAT
  //   `required_members` CONTAINS 12 DISTINCT IDENTITIES. Replace member `24`
  //   with a second copy of `23` and delete fixture `24`: `missing` is empty
  //   (both copies of `23` are present), `undeclared` is empty, and the gate
  //   exits 0 on an 11-fixture corpus that claims 12.
  //   ★★★ `A MEMBERSHIP ARRAY IS NOT A SET UNTIL DUPLICATES ARE REJECTED.
  //       "12 DECLARED" CAN MEAN 11 IDENTITIES.`
  //
  // ★★ THE RIGHT CHECK ALREADY EXISTED IN THE WRONG PLACE: `duplicateConditionIds`
  //    counts multiplicity per lane and NAMES what it caught. This is the same
  //    idiom applied to corpus membership — deliberately not a second invention.
  //
  // THREE SURFACES MUST AGREE, and each disagreement is printed SEPARATELY:
  //   declared  = ORACLE.required_members (unique identities)
  //   onDisk    = *.spec.json actually present
  //   adjudicated = Object.keys(ORACLE.fixtures)
  const membership: string[] = [];

  // (1) DUPLICATES FIRST — before any Set is built, because building the Set is
  //     exactly the step that destroys the evidence.
  const declaredCounts = new Map<string, number>();
  for (const m of oracle.required_members) declaredCounts.set(m, (declaredCounts.get(m) ?? 0) + 1);
  for (const [name, n] of [...declaredCounts].sort()) {
    if (n > 1) {
      membership.push(
        `MEMBERSHIP: DUPLICATE required_members identity ${JSON.stringify(name)} appears ${n}x — the array ` +
          `declares ${oracle.required_members.length} entries but only ${declaredCounts.size} distinct identities. ` +
          `A duplicate silently frees a slot: another required fixture can be deleted while the counts still look right.`,
      );
    }
  }

  // (2) BOTH CARDINALITIES, asserted. NEITHER SUBSTITUTES FOR THE OTHER — the
  //     attack above keeps the ARRAY length at 12 while the UNIQUE count is 11.
  if (oracle.required_members.length !== declaredCounts.size) {
    membership.push(
      `MEMBERSHIP: required_members ARRAY cardinality ${oracle.required_members.length} != UNIQUE cardinality ` +
        `${declaredCounts.size}. A COUNT OF ENTRIES IS NOT A COUNT OF IDENTITIES.`,
    );
  }

  // (3) THREE-WAY EQUALITY over unique keys, each direction reported separately.
  const declaredSet = new Set(oracle.required_members);
  const onDiskSet = new Set(files);
  const adjudicatedSet = new Set(Object.keys(oracle.fixtures ?? {}));
  const pairs: Array<[string, Set<string>, string, Set<string>]> = [
    ["declared (ORACLE.required_members)", declaredSet, "on disk (*.spec.json)", onDiskSet],
    ["declared (ORACLE.required_members)", declaredSet, "adjudicated (ORACLE.fixtures keys)", adjudicatedSet],
    ["on disk (*.spec.json)", onDiskSet, "adjudicated (ORACLE.fixtures keys)", adjudicatedSet],
  ];
  for (const [aName, aSet, bName, bSet] of pairs) {
    for (const k of [...aSet].sort()) {
      if (!bSet.has(k)) {
        membership.push(`MEMBERSHIP: ${JSON.stringify(k)} is in ${aName} but MISSING from ${bName} — the claim is DENIED, not re-scoped to the survivors`);
      }
    }
    for (const k of [...bSet].sort()) {
      if (!aSet.has(k)) {
        membership.push(`MEMBERSHIP: ${JSON.stringify(k)} is in ${bName} but MISSING from ${aName} (an unadjudicated or undeclared fixture cannot pass)`);
      }
    }
  }

  // ★★★★★ PRINTED UNCONDITIONALLY, AND IT IS NOW A COMPARED COUNT RATHER THAN A
  //   RENDERED ONE. R-496 §0: a previous reader cited "Checked 12 … against 12"
  //   as evidence; it was a console.log that could print 11-against-12 and still
  //   exit 0. Both cardinalities appear here BECAUSE both are asserted above.
  console.log(
    `MEMBERSHIP CENSUS: required_members entries=${oracle.required_members.length} unique=${declaredCounts.size} · ` +
      `on disk=${onDiskSet.size} · adjudicated=${adjudicatedSet.size} · three-way agreement=${membership.length === 0 ? "YES" : "NO"}`,
  );

  // ★ PRINT every membership failure, do not merely count it. First version of
  //   this script pushed these into `failures` without a console.error, so a
  //   deleted fixture produced `FAIL: 4` while naming only 3 causes — a failure
  //   the reader cannot act on, found by red-proofing this gate rather than by
  //   reading it. `A COUNTED FAILURE THAT IS NOT NAMED IS HALF A GREEN.`
  if (membership.length > 0) {
    console.error(
      `MEMBERSHIP FAILURE (required_members entries = ${oracle.required_members.length}, unique = ${declaredCounts.size}, ` +
        `on disk = ${files.length}, adjudicated = ${adjudicatedSet.size}):`,
    );
    for (const m of membership) console.error(`  - ${m}`);
  }
  failures.push(...membership);

  // ─── Queue-reason divergence tripwire, with its DISCRIMINATES control inside.
  // Asserts a PRECONDITION over both lanes' FAMILY_META, not that fixtures pass.
  const tripwireFailures: string[] = [];
  const tripwireNotes: string[] = [];
  checkQueueReasonTripwire(tripwireFailures, tripwireNotes);
  if (tripwireFailures.length > 0) {
    console.error(`QUEUE-REASON TRIPWIRE FAILURE:`);
    for (const m of tripwireFailures) console.error(`  - ${m}`);
    failures.push(...tripwireFailures);
  }

  // ─── P-7 over-refusal property, over the WHOLE non-session population.
  // Counted into `oracleFailures` rather than `failures` on purpose: a P-7
  // violation is a CLAIM 2 CORRECTNESS defect, not a membership or plumbing one,
  // and the summary line's whole value is that it says WHICH claim failed.
  // ─── Axis-4 self-controls run BEFORE the corpus, same rationale as the
  // tripwire's own control: if the duplicate-id or multiplicity detectors cannot
  // fire, every clean result they produce below is worthless.
  const axis4Failures: string[] = [];
  checkAxis4SelfControls(axis4Failures, tripwireNotes);
  if (axis4Failures.length > 0) {
    console.error(`AXIS-4 SELF-CONTROL FAILURE:`);
    for (const m of axis4Failures) console.error(`  - ${m}`);
    failures.push(...axis4Failures);
  }

  const p7Failures: string[] = [];
  checkOverRefusalProperty(p7Failures, tripwireNotes);
  if (p7Failures.length > 0) {
    console.error(`P-7 OVER-REFUSAL PROPERTY FAILURE (authority §4d — CLAIM 2, correctness):`);
    for (const m of p7Failures) console.error(`  - ${m}`);
    oracleFailures.push(...p7Failures);
  }

  // Collected so cross-fixture reason-distinctness (oracle P-4/P-6) can be
  // asserted after every plan exists.
  const observedReasons = new Map<string, string | null>();
  let checked = 0;

  for (const file of files.sort()) {
    const raw = JSON.parse(readFileSync(join(SAMPLES_DIR, file), "utf-8"));
    const spec = raw.spec;
    checked += 1;

    // ★★★★★ R-496 CORRECTION A: the schema sink is per-fixture and its messages
    //   are NAMED and pushed into `failures`, so an unmapped TS field cannot be
    //   swallowed by the projection it would otherwise have been dropped by.
    const schemaFails: string[] = [];
    const tsPlan = tsBindingPlanAsPyShape(spec, schemaFails, file);
    const pyPlan = pyBindingPlan(spec);
    if (schemaFails.length > 0) {
      console.error(`TS PLAN SCHEMA EXHAUSTIVENESS FAILURE in ${file}:`);
      for (const m of schemaFails) console.error(`  - ${m}`);
      failures.push(...schemaFails.map((m) => `${file}: ${m}`));
    }

    // CLAIM 1 — agreement.
    const drift: string[] = [];
    diffDeep(tsPlan, pyPlan, "plan", drift);
    duplicateConditionIds(tsPlan, "ts", drift);
    duplicateConditionIds(pyPlan, "py", drift);

    // CLAIM 2 — correctness, asserted against BOTH lanes independently.
    // Checking only one lane would let a wrong-but-agreeing pair through on the
    // unchecked side.
    const oracleFails: string[] = [];
    checkOracle(file, oracle, tsPlan, "ts", oracleFails, declaredGaps);
    checkOracle(file, oracle, pyPlan, "py", oracleFails, declaredGaps);

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
        // ⚠️★★★★★ R-496 GRADE FINDING 4. THIS LINE USED TO READ:
        //     `if (a === undefined || b === undefined) continue; // membership already reported it`
        //   THAT COMMENT WAS FALSE AND IT IS DELETED, NOT REWORDED. Membership
        //   operates at FIXTURE-FILE granularity and never at `condition_id`
        //   granularity, so it reports NOTHING about a pair naming a condition
        //   that does not exist. A typo'd or renamed `condition_id` made the
        //   file's self-described "sharpest assertion" silently do nothing and
        //   the gate exited 0.
        //   ★★★ `A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED`, and this is
        //       the same class as the membership hole this delivery exists to
        //       close: a check satisfied by ABSENCE rather than by verification.
        if (a === undefined || b === undefined) {
          const missing = [
            a === undefined ? `${fixtureName}.${pair.condition}` : null,
            b === undefined ? `${pair.fixture}.${pair.other_condition}` : null,
          ].filter(Boolean);
          const m =
            `${lane}: ORACLE REFERENCE UNRESOLVABLE — reasons_must_differ_from names ${JSON.stringify(missing)}, ` +
            `which produced NO observed reason in this lane. The P-4/P-6 distinctness assertion for ` +
            `${fixtureName}.${pair.condition} therefore never executed. A typo, a renamed condition_id or a ` +
            `dropped row silently disarms this check; it is DENIED rather than skipped. [${expect.authority}]`;
          console.error(`  - ${m}`);
          failures.push(m);
          continue;
        }
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
  // ★★★ THIS LINE NOW REPORTS WHAT THIS PROCESS COMPUTED, NOT WHAT ORACLE.json
  //     CLAIMED. The previous form printed `oracle.authority_sha256` — a field the
  //     file asserts about itself — and a desk reading it concluded a verification
  //     had occurred. The word VERIFIED is only legible here because
  //     verifyAuthorityFreshnessOrExit() already exited non-zero on any mismatch;
  //     if you ever weaken that function, delete this word in the same edit.
  console.log(
    `Oracle authority: ${authority.path} — ${authority.bytes} bytes read, ` +
      `sha256=${authority.computedSha256} (COMPUTED here, VERIFIED equal to ORACLE.json's pin)`,
  );

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

  // ─── Tripwire notes ALWAYS print, including its DISCRIMINATES control result.
  // A tripwire that reports nothing on a passing run is indistinguishable from a
  // tripwire that did not run.
  if (tripwireNotes.length > 0) {
    console.log(`QUEUE-REASON TRIPWIRE (asserts the PRECONDITION is empty, not that fixtures pass):`);
    for (const n of tripwireNotes) console.log(`  ✓ ${n}`);
  }

  // ─── PER-FIELD gaps, rendered so they CANNOT be mistaken for checked rows.
  //
  // ★★★ A declared gap must not render like a verified row. These are prefixed
  //     [NOT ADJUDICATED], grouped under their own banner, and counted in the
  //     final line — because a reader who cannot tell "verified correct" from
  //     "nobody has ruled on this" has been handed a false green with extra
  //     words. "NO EXPECTATION" is a different state from "expectation met".
  if (declaredGaps.length > 0) {
    console.log(
      `\n★ ${declaredGaps.length} ORACLE CELL(S) CARRY *NO EXPECTATION* — NOT ADJUDICATED, NOT VERIFIED, NOT A PASS:`,
    );
    for (const g of declaredGaps) console.log(`  [NOT ADJUDICATED] ${g}`);
    console.log(
      `  ^ these cells were NOT compared against any authority. Whatever the lanes emit there is` +
        ` UNJUDGED — the lanes are still required to AGREE on them, which is a separate and weaker claim.`,
    );
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
        // ⚠️★★★★★ R-496 GRADE FINDING 3: this bucket was labelled `MEMBERSHIP`,
        //   but it is fed by FIVE checks — membership, the queue-reason tripwire,
        //   the axis-4 self-controls, TS-schema exhaustiveness, and P-4/P-6
        //   reason-distinctness. A schema leak printed `MEMBERSHIP: 12 failure(s)`
        //   on a run whose own census said `three-way agreement=YES`, sending a
        //   reader to the wrong subsystem. It never produced a false PASS — the
        //   count was right and the NOUN was wrong. `A CAPTION IS A CLAIM, AND A
        //   COUNT UNDER THE WRONG NOUN IS A FALSE ONE.`
        `GATE CHECKS (membership · tripwire · axis-4 · TS-schema · reason-distinctness): ` +
        `${failures.length === 0 ? "PASS" : `${failures.length} failure(s)`}`,
    );
    if (driftFailures.length === 0 && oracleFailures.length > 0) {
      console.error(
        `  ★ NOTE: the lanes AGREE and are BOTH WRONG against the frozen oracle. ` +
          `This is the exact case a two-lane diff can never detect. Per the oracle authority §5-3 this is a FINDING to file — DO NOT edit the oracle to match the output.`,
      );
    }
    process.exit(1);
  }
  // ★ The pass line states its own limits. A green that does not name its gaps
  //   is the shape this gate exists to stop.
  console.log(
    `PASS: TS and Python binding plans AGREE, and both CONFORM to the frozen oracle ` +
      `on every ADJUDICATED cell (${declaredGaps.length} cell(s) explicitly NOT adjudicated — see above).`,
  );
}

main();
