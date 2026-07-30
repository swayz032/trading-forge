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
import { compileBindingPlan, FAMILY_META } from "../src/server/lib/spec-family-bindings.js";

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
  // ★ The pass line states its own limits. A green that does not name its gaps
  //   is the shape this gate exists to stop.
  console.log(
    `PASS: TS and Python binding plans AGREE, and both CONFORM to the frozen oracle ` +
      `on every ADJUDICATED cell (${declaredGaps.length} cell(s) explicitly NOT adjudicated — see above).`,
  );
}

main();
