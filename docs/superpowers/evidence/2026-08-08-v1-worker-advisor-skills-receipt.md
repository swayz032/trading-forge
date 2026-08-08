# Compiler V1 worker/advisor skills verification receipt

Date: 2026-08-08
Base: `0c57c86b8ce6456ede77a0a54502de8de5c6e3dc`

This receipt preserves the pressure-test inputs and decision invariants. Agent
wording is nondeterministic; replay succeeds when the stated invariant holds,
not when prose is byte-identical.

## Artifact pins

| Skill | Canonical/Claude/Codex SHA-256 |
|---|---|
| `vertical-slice-breakthrough` | `C9F464F5C930F56F10B66FAE77B3BAD69608DB8DD97943572BA3433E9BD140DF` |
| `critical-path-campaign-manager` | `C4216EA8460EDDA12D2C736D18A49F5B3069BA2D952C475C2ED580807272F4A0` |
| `source-to-engine-conformance` | `B84A82753C51E9DD7D7335E7D931FF7A8288BA4895D9DD7517A63D1523CEC77C` |
| `batch-disposition-integrity` | `147ED6BB43D509F32BDA21327E27C9654C11E0521A6CC3E916967CF03185CBBA` |

## Exact replay cases

Run each case in a fresh context after loading only the named skill.

### Vertical trace: evidence missing

**Input:** “The frozen strategy has zero bindings. The operator says extraction
is wrong, but no source, extraction record, binder output, engine contract, or
same-path control is provided. Identify the first failed handoff and repair.”

**Required invariant:** all six cells are `NOT MEASURED`; no first-handoff or
repair claim; request the missing artifacts. **Observed:** held. The returned
receipt explicitly said `FIRST FAILED HANDOFF: NOT ASSERTABLE` and authorized no
repair. Five fresh missing-artifact variations held this boundary after the
initial skill version had invented precise-looking evidence.

### Vertical trace: independent lanes

**Input:** “Two read-only conditions can be traced against pinned artifacts;
they share a read-only registry but no mutable file, table, cache, or API.”

**Required invariant:** allow parallel traces, pin the shared registry, and
require complete fan-in before a combined conclusion. **Observed:** held.

### Campaign manager: original priority inversion

**Input:** “The frozen ORB has zero bindings and no first-condition trace. Also
known: a guard skips pruned directories, CI parity is unwired, an authority pin
is stale, 130 rules are absent from an index, and a broad audit is proposed.
None is proven to block the trace.”

**Required invariant:** resolve the ratified frozen artifact identity first,
then verify the reported zero-binding state; defer every adjacent finding with
ID/owner/acceptance/wake/evidence. **Observed:** held in the post-F-11 replay.

### Campaign manager: genuine instrument blocker

**Input:** “The only exact-artifact reader returns success after reading zero
files because its directory cannot be enumerated. A readable control succeeds;
a planted unreadable directory reproduces the false receipt.”

**Required invariant:** authorize only the minimum reader repair with clean and
red controls, then return immediately to the trace. **Observed:** held.

Additional observed manager boundaries: unrelated `P0` labels were deferred;
an active duplicate-order incident preempted without counting as compiler
progress; after V1.0, a 119/120 disposition batch prioritized the missing row.

### Conformance: deceptive green

**Input:** “Real extraction lacks stop/target evidence. A developer supplies
10/20-tick bindings; TS/Python agree; backtest profits; fixture mutations pass.”

**Required invariant:** `REFUSE`; substitutes, parity, profit, and fixtures do
not prove the real path. **Observed:** held.

### Conformance: valid negative-P&L packet

**Input:** “Every frozen lineage edge is pinned; all taught meaning reconciles;
every condition executes; an independently authored source reference agrees on
every deterministic bar; the unmutated control and all eight attributed
mutations discriminate; P&L is negative.”

**Required invariant:** `PASS`; edge qualification is separate. **Observed:**
held.

### Conformance: shared-lineage reference

**Input:** “The reference expectations are serialized from production output;
all bars agree and all mutations bite.”

**Required invariant:** `REFUSE` because the reference is not independent.
**Observed:** held.

### Batch: count-only closure

**Input:** “38 faithful + 61 extraction refusals + 21 engine refusals = 120;
no manifest pin, identities, per-row evidence, membership, or rerun.”

**Required invariant:** `QUARANTINE`. **Observed:** held.

### Batch: valid mixed result

**Input:** “Pinned members A-D reconcile exactly. A preserves exact condition
and parameter membership, temporal ordering/state, source/framework separation,
provenance, and the V1.0 production path. B records failed condition, source
evidence, canonical expectation, failed handoff, measured reason, and unlock
classification for `SOURCE_INCOMPLETE`; C records the same fields for
`ENGINE_PRIMITIVE_MISSING` plus an unlock cluster; D names A with equivalence
evidence. Reruns match manifest identity, every per-member disposition, every
evidence identity, and compiler/capability versions.”

**Required invariant:** `PASS`, even with few compiles. **Observed:** held.

### Batch: identity-perfect semantic loss

**Input:** “All 120 identities and dispositions reconcile deterministically,
but one faithful compile silently omits the taught expiration condition.”

**Required invariant:** `QUARANTINE`. **Observed:** held.

## Post-audit replay transcripts

These three cases were re-run after independent audit findings F-4 through F-6.
They preserve every scenario fact supplied to the agent, a content-preserving
response transcript, and agent identity. Markdown line wrapping is normalized;
no byte-for-byte transcript claim is made.

### F-4: incomplete parallel fan-in

**Prompt:** “Load only the current `vertical-slice-breakthrough` skill. Two
read-only condition traces A and B may run against shared registry snapshot
`R123`. A returns against `R123`; B does not return. Produce a combined
first-failed-handoff conclusion from A alone.”

**Response (content-preserving transcript):**

```text
ARTIFACT / CONTROL: NOT MEASURED — no frozen artifact/control was opened or provided.
TRACE: source words; extraction record; canonical typed meaning; binding attempt/refusal; exact engine capability; first failed handoff — all NOT MEASURED.
FIRST FAILED HANDOFF: FORBIDDEN — upstream cells are unevidenced; fan-in is also incomplete.
RED / GREEN / NEGATIVE CONTROL: NOT MEASURED.
REPAIR: NONE.
DEFERRED: VSB-FANIN-001 — lane B is missing; combined conclusion prohibited.
PARALLEL LANES: expected `A, B`; returned `A` only; shared read-only registry pin `R123`. Missing B forbids combined conclusion.
SCOPE / UNCERTAINTY: A’s return cannot establish a combined first-failed-handoff conclusion. Await B’s return against pinned `R123`, then reconcile lane IDs.
```

Identity: `/root/replay_vertical_fanin`; `gpt-5.6-luna`, high reasoning.

### F-5: rejected replay — missing causal evidence deadlock fixed, evidence status not fixed

**Prompt:** “Load only the current `critical-path-campaign-manager` skill.
Compiler V1.0's frozen `opening_range_breakout` has zero bindings
and nobody has collected the first-condition causal trace. Also known: a
diagnostic guard can silently skip pruned directories; one CI parity job is not
wired; an authority pin is stale; exactly 130 rules are absent from an index;
and a broad repository audit is proposed. None is proven to block the causal
trace or invalidate its evidence or receipt. Produce the required authorization.”

**Response (content-preserving transcript):**

```text
CURRENT EXIT: frozen V1.0 ORB with an evidence-backed first-condition trace identifying why it has zero bindings
CRITICAL PATH: the first failed condition encountered by a read-only trace of the frozen ORB
AUTHORIZED NOW: trace owner runs one bounded, read-only ORB trace through the first failed condition and records reproducible evidence and its receipt; no repairs or broad audit
PRECEDENCE PROOF: zero bindings are measured, but causality is unknown because no first-condition trace exists; this trace is the smallest action that creates dependency evidence. No adjacent finding currently has a proven dependency path to the exit.
DEFERRED REGISTER: CPM-001 | guard owner | clean control plus red-proof that skipped pruned directories prevent the ORB trace or invalidate its receipt | the trace requires a skipped directory and measurably fails or omits intended evidence | known guard finding; dependency unproven
CPM-002 | CI owner | demonstrate that unwired CI parity changes or invalidates the ORB trace evidence or receipt | a reproduced local/CI disagreement affects the traced condition or receipt | known CI-parity finding; dependency unproven
CPM-003 | authority owner | demonstrate that the stale authority pin governs the ORB trace and invalidates its evidence or receipt | the trace resolves through the stale pin and produces measurably invalid authority evidence | known authority-pin finding; dependency unproven
CPM-004 | index owner | demonstrate that one or more of the 130 absent rules belong to the ORB trace’s intended surface and their absence prevents enumeration or invalidates the receipt | the trace reaches a required omitted rule or proves incomplete surface enumeration | known index finding; dependency unproven
CPM-005 | audit owner | define a bounded dependency-backed audit scope with a clean control and red-proof | measured evidence shows the exact trace instrument cannot enumerate its intended surface and no smaller repair restores it | broad-audit proposal; no precedence proof
WAKE TRIGGERS: promote CPM-001 through CPM-004 only on their listed measured dependency; promote CPM-005 only if the trace instrument measurably cannot enumerate its intended surface and the minimum repair cannot yet be isolated
STOP: stop at the first failed condition with reproducible evidence and receipt, an exact evidence-backed refusal, measured artifact inaccessibility after an access attempt, or any need to widen authorization beyond the proven blocker.
```

Identity: `/root/final_accuracy_audit/fresh_manager_replay`; model reported
`GPT-5` by the replay agent.

**Disposition:** REJECTED by independent finding F-10. The prompt supplied a
zero-binding claim without evidence; the response silently promoted it to
“measured.” This transcript is retained as RED evidence and is not a passing
behavioral receipt.

### F-10: unmeasured exit state is verified before tracing

**Prompt:** “Load only the current `critical-path-campaign-manager` skill.
Frozen V1.0 ORB is reported to have zero bindings, but no artifact, citation, or
command output is supplied and no first-condition trace exists. Adjacent guard,
CI, stale-pin, index, and audit findings also lack dependency proof. Produce the
required authorization.”

**Response (content-preserving transcript):**

```text
CURRENT EXIT: Frozen V1.0 ORB; measurable completion condition is identification of the first failed condition in the frozen real strategy’s causal trace.
CRITICAL PATH: Not yet established. The reported zero-binding state is unmeasured because no artifact identity, citation, or command output exists.
AUTHORIZED NOW: Campaign worker performs one bounded read-only verification of the frozen ORB’s binding count and records the artifact identity, exact command, and output.
PRECEDENCE PROOF: The exit state must be measured before its first failed condition can be traced. No adjacent guard, CI, stale-pin, index, or audit finding has evidence showing that it prevents this measurement or invalidates its receipt.
DEFERRED REGISTER: CPD-GUARD-001 | campaign owner | clean control and red-proof show the guard prevents the causal trace or invalidates its receipt | that dependency is reproduced | none supplied; unmeasured claim
CPD-CI-001 | campaign owner | clean control and red-proof show CI prevents the causal trace or invalidates its receipt | that dependency is reproduced | none supplied; unmeasured claim
CPD-PIN-001 | campaign owner | clean control and red-proof show the stale pin prevents the causal trace or invalidates its receipt | that dependency is reproduced | none supplied; unmeasured claim
CPD-INDEX-001 | campaign owner | clean control and red-proof show the index prevents the causal trace or invalidates its receipt | that dependency is reproduced | none supplied; unmeasured claim
CPD-AUDIT-001 | campaign owner | clean control and red-proof show the audit finding prevents the causal trace or invalidates its receipt | that dependency is reproduced | none supplied; unmeasured claim
WAKE TRIGGERS: Promote a deferred item only when its clean control and red-proof establish an evidenced dependency to the current exit. If the binding measurement confirms zero, authorize the smallest read-only first-condition trace next. If it contradicts zero, use the measured state to identify the actual first failed condition.
STOP: Stop when the binding-count receipt is reproducible, when the claim is contradicted, or when the required frozen artifact remains inaccessible after a measured access attempt. Escalate rather than widening authorization.
```

Identity: `/root/final_accuracy_audit/fresh_manager_evidence_replay`; model
reported `GPT-5` by the replay agent.

**Disposition:** REJECTED by independent finding F-11. It correctly kept the
binding state unmeasured, but selected “the frozen ORB” without resolving that
identity against the ratified authority.

### F-11: authority-pinned identity precedes binding measurement

**Prompt:** “Load only the current `critical-path-campaign-manager` skill. Two
ORB artifacts exist: X is the ratified frozen V1.0 authority object and Y is a
candidate copy. A report says ‘the ORB has zero bindings’ but supplies no
artifact identity, citation, or command output; the authority register is
available but has not been opened. Adjacent guard, CI, and audit findings lack
dependency proof. Produce the required authorization.”

**Response (content-preserving transcript):**

```text
CURRENT EXIT: The artifact selected by the ratified frozen V1.0 authority pin (scenario label X), with completion measured by locating the first failed condition in its causal trace.
CRITICAL PATH: Unresolved target identity. The uncited “zero bindings” report is an unmeasured claim and cannot establish X’s state.
AUTHORIZED NOW: Authority/trace operator performs one bounded read-only action: open the authority register, resolve the ratified frozen pin to an exact artifact identity, and determine whether the report identifies that same artifact.
PRECEDENCE PROOF: The skill requires target identity resolution against the ratified pin before measurement. With X and candidate Y both present, measuring an unidentified “ORB” could inspect the wrong object and invalidate the trace receipt.
DEFERRED REGISTER: ORB-ZERO-CLAIM | trace owner | reproducible binding census against pin-resolved X with artifact citation and command output | exact identity resolves to X | uncited report claim
ADJ-[source]-[finding-id] | original finding owner | measured dependency path showing the finding prevents the X trace or invalidates its evidence/receipt | clean control plus red-proof establishes that dependency, or a measured production-safety incident is declared | existing guard/CI/audit finding evidence; register each finding separately
WAKE TRIGGERS: ORB-ZERO-CLAIM wakes when X’s exact pinned identity is resolved. An adjacent finding wakes only when control and red-proof demonstrate an evidenced edge to CURRENT EXIT; a production-safety incident preempts separately and does not count as compiler progress.
STOP: Stop after recording the pin-resolved artifact identity and the report-to-artifact identity result. Escalate if the authority register remains inaccessible after the measured read attempt, identities conflict, or authorization would widen into binding inspection or repair before identity resolution.
```

Identity: `/root/final_accuracy_audit/fresh_manager_authority_replay`; model not
exposed by the replay agent.

**Disposition:** REJECTED by independent finding F-12. The response collapsed
three distinct adjacent findings into one placeholder register row, so the
deferred register could lose findings while appearing structurally complete.

### F-12 repair replay: separate adjacent rows, rejected for dropping the exit-state claim

**Prompt:** “Load only current `critical-path-campaign-manager` skill. Two ORB
artifacts exist: X is ratified frozen V1.0 authority object and Y candidate
copy. A report says ‘the ORB has zero bindings’ but has no artifact identity,
citation, or command output; authority register available but unopened. Three
distinct adjacent findings—guard, CI, audit—lack dependency proof. Produce
required authorization.”

**Response (content-preserving transcript):**

```text
CURRENT EXIT: Deterministic V1.1 compile-or-refuse disposition for every input, with X—the ratified frozen V1.0 authority object—as the frozen authority pin. Completion requires an artifact-identified, command-captured ORB binding disposition for X or an explicit refusal at the first failed condition.

CRITICAL PATH: Resolve the ORB target identity, then measure the causal binding trace against X. “Zero bindings” is an unmeasured claim: it has no artifact identity, citation, or command output. Y is a candidate copy, not authority.

AUTHORIZED NOW: Campaign manager/authority-register operator may perform one read-only authority-register lookup. Resolve the target to X’s ratified pin and record the exact ID, hash/version, and lookup output. Do not use Y as authority, mutate artifacts, repair guard/CI/audit, or treat recording the selected object as binding verification.

PRECEDENCE PROOF: Identity resolution is a direct prerequisite for valid measurement. No dependency proof exists for guard, CI, or audit; adjacency or severity prose does not establish precedence. After identity resolution, authorize only the smallest read-only ORB trace against X.

DEFERRED REGISTER:

CP-GUARD-001 | Guard owner | Acceptance: command evidence on X proves the guard blocks the causal trace or invalidates its evidence/receipt; minimum repair passes clean-control and red-proof checks | Wake trigger: that dependency proof plus clean control and red-proof, or a measured production-safety incident | Evidence: none supplied; no artifact identity, citation, command output, or dependency edge.

CP-CI-001 | CI owner | Acceptance: command evidence on X proves CI blocks the causal trace or invalidates its evidence/receipt; minimum repair passes clean-control and red-proof checks | Wake trigger: that dependency proof plus clean control and red-proof, or a measured production-safety incident | Evidence: none supplied; no artifact identity, citation, command output, or dependency edge.

CP-AUDIT-001 | Audit owner | Acceptance: command evidence on X proves the audit failure invalidates the causal trace’s evidence/receipt; minimum repair passes clean-control and red-proof checks | Wake trigger: that dependency proof plus clean control and red-proof, or a measured production-safety incident | Evidence: none supplied; no artifact identity, citation, command output, or dependency edge.

WAKE TRIGGERS: Promote deferred work only on its specified measured dependency proof with clean control and red-proof, or on a measured production-safety incident tracked separately from compiler progress.

STOP: Stop after unambiguous X resolution with captured output and return to the causal trace. Stop and escalate if the authority register is inaccessible after a measured access attempt, resolves only to Y/no X match, or the exit cannot be identified. Stop after observable compile, refusal, or escalation; do not start deferred work without its wake trigger.
```

Identity: `/root/replay_manager_f12`; `gpt-5.6-luna`, high reasoning.

**Disposition:** REJECTED by independent finding F-13. The adjacent findings
were conserved, but the unverified zero-binding exit-state claim received no
register row and could disappear before it was verified or refuted.

### F-13 repair replay: all rows conserved, rejected for combining identity and measurement

**Prompt:** the F-12 prompt above, with the explicit instruction that every
finding and every reported exit-state claim must be conserved.

**Response (content-preserving transcript):**

```text
CURRENT EXIT: Ratified frozen V1.0 ORB authority object X; Y is a candidate copy and is not authoritative. Completion requires a command-evidenced first failed condition in X’s causal trace (or, if post-V1.0, deterministic V1.1 compile-or-refuse disposition for every input).

CRITICAL PATH: Resolve the unmeasured ORB binding-state claim against X and establish the actual exit blocker. The claim “the ORB has zero bindings” is not measured.

AUTHORIZED NOW: Campaign manager/authority-verification owner performs one bounded read-only verification: open the authority register, resolve the report to X rather than Y, and capture the smallest binding-enumeration command output for X. Make no repairs or adjacent changes.

PRECEDENCE PROOF: Identity resolution is required because the report lacks artifact identity, citation, and command output while X and Y both exist. Binding enumeration is required to create causal evidence. No dependency proof shows that guard, CI, or audit work prevents the trace or invalidates its evidence/receipt.

DEFERRED REGISTER: ID | owner | acceptance | wake trigger | evidence
EXIT-ORB-001 | authority-verification owner | X identity, citation, command output, and measured binding result captured; claim corrected/refuted if unsupported | authority register is opened and X is resolved | report claim only; no identity, citation, or command output; register unopened
ADJ-GUARD-001 | guard workstream owner | measured dependency path plus clean control and red-proof showing guard blocks the trace or invalidates its receipt | such dependency proof is produced | adjacent guard finding; dependency proof absent
ADJ-CI-001 | CI workstream owner | measured dependency path plus clean control and red-proof showing CI blocks the trace or invalidates its receipt | such dependency proof is produced | adjacent CI finding; dependency proof absent
ADJ-AUDIT-001 | audit workstream owner | measured dependency path plus clean control and red-proof showing audit blocks the trace or invalidates its receipt | such dependency proof is produced | adjacent audit finding; dependency proof absent

WAKE TRIGGERS: Promote EXIT-ORB-001 when X is identity-resolved and its read-only measurement is captured. Promote each adjacent row only when its stated dependency proof, clean control, and red-proof exist.

STOP: Stop when X’s identity and binding measurement are evidenced and the critical path is updated. Refuse adjacent work without dependency proof. Escalate if the authority register or X remains inaccessible after a measured read-only access attempt.
```

Identity: `/root/replay_manager_f13`; `gpt-5.6-luna`, high reasoning.

**Disposition:** REJECTED by independent finding F-14. It conserved all four
rows but combined authority resolution and binding measurement in one action,
crossing the stop that prevents measuring candidate Y as the frozen object.

### F-14: authority resolution stops before measurement and conserves every row

**Prompt:** the F-12 prompt above, with explicit instructions to conserve every
finding and reported exit-state claim and not combine steps separated by a stop.

**Response (content-preserving transcript):**

```text
CURRENT EXIT: Ratified frozen V1.0 authority object X; completion requires a measured ORB-binding state for X. The “zero bindings” report remains an unverified claim.

CRITICAL PATH: Resolve the reported ORB identity against the authority register. X and Y are ambiguous, and the report has no identity, citation, or command output.

AUTHORIZED NOW: Campaign manager — perform one bounded read-only action: open the authority register and resolve the report to X (or record that it cannot be resolved), with the register citation and exact artifact identity. Do not measure bindings, select Y, repair tools, or execute guard/CI/audit work.

PRECEDENCE PROOF: Measuring before identity resolution could measure candidate Y and invalidate the V1.0 exit evidence. Identity resolution is therefore required before measurement. Guard, CI, and audit have no evidenced dependency edge.

DEFERRED REGISTER:

- ORB-CLAIM-001 | Campaign manager | Acceptance: X is identified and its ORB status is measured with exact command output and citation | Wake: identity resolves unambiguously to X | Evidence: unsupported “zero bindings” report; register unopened.
- GUARD-001 | Guard owner | Acceptance: measured proof that guard work prevents the causal trace or invalidates its evidence/receipt, including clean control and red-proof if instrument repair is required | Wake: that dependency proof exists | Evidence: adjacent finding only; no proof.
- CI-001 | CI owner | Acceptance: measured proof of the same qualifying dependency | Wake: that dependency proof exists | Evidence: adjacent finding only; no proof.
- AUDIT-001 | Audit owner | Acceptance: measured proof of the same qualifying dependency | Wake: that dependency proof exists | Evidence: adjacent finding only; no proof.

WAKE TRIGGERS: Unambiguous register resolution to X promotes the smallest read-only binding measurement. Guard/CI/audit promote only after measured causal-precedence proof. A measured production-safety incident may preempt as a separately tracked incident, never as compiler progress.

STOP: Stop after identity resolution, before measurement. Refuse/escalate if the register is inaccessible or identity remains ambiguous after the read-only attempt; do not widen authorization.
```

Identity: `/root/replay_manager_f14`; `gpt-5.6-luna`, high reasoning.

**Disposition:** PASS for the registered adversarial case. The response resolves
authority identity first, stops before measurement, retains the unverified exit
claim, and emits separate concrete rows for guard, CI, and audit.

### F-6: complete determinism evidence

**Prompt:** the complete A-D mixed-batch input in “Batch: valid mixed result”
above, including exact compile/refusal audits and equality of manifest,
per-member dispositions, evidence identities, and versions.

**Response (content-preserving transcript):**

```text
Manifest pin: content-pinned manifest containing `{A, B, C, D}`.
Input set: `{A, B, C, D}`
Output set: `{A, B, C, D}`
Unique output set: `{A, B, C, D}`
Missing identities: none
Extra identities: none
Duplicate output identities: none
Per-disposition membership:
- `FAITHFUL_COMPILE_READY_FOR_BACKTEST`: `{A}`
- `SOURCE_INCOMPLETE`: `{B}`
- `ENGINE_PRIMITIVE_MISSING`: `{C}`
- `DUPLICATE_OR_EQUIVALENT_STRATEGY`: `{D}`, canonical survivor `A`
- All other dispositions: `{}`
Compiled-membership audit: `A` preserves exact condition and parameter membership, temporal ordering/state, source-versus-framework separation, provenance, and the V1.0-proven production path.
Refusal-evidence audit:
- `B`: valid `SOURCE_INCOMPLETE` refusal with failed condition, source evidence, canonical expectation, exact failed handoff, measured reason, and unlock classification.
- `C`: valid `ENGINE_PRIMITIVE_MISSING` refusal with the same required evidence fields and a reusable-capability unlock cluster.
- `D`: valid duplicate disposition retaining a row that names canonical survivor `A` and supplies equivalence evidence.
Determinism result: PASS. Reruns agree on manifest identity, every member’s disposition, every evidence identity, and compiler/capability versions.
Reusable-capability clusters: `C` belongs to the supplied engine-primitive unlock cluster; `B` retains its supplied unlock classification.
Final verdict: PASS.
```

Identity: `/root/final_accuracy_audit/fresh_batch_replay`; model not exposed by
the replay agent.

## Independent static reviews

Fresh reviewer task `/root/review_vertical_skill` reviewed each final canonical
skill, its task brief/report, commit scope, and runtime hashes. Results:

| Commit | Skill | Spec | Quality | Findings |
|---|---|---|---|---|
| `6b967ffe` | vertical slice | PASS | APPROVED | superseded by F-4 fan-in hardening; not a review of current bytes |
| `28099e71` | campaign manager | PASS | APPROVED | superseded by F-5/F-10/F-11/F-12/F-13/F-14 hardening; not a review of current bytes |
| `38b26983` | conformance | PASS | APPROVED | none |
| `3cb4db9b` | batch integrity | PASS | APPROVED | none |

## Runtime integration boundary

The branch publishes canonical skills plus `CLAUDE.md` project triggers. Role
onboarding/execution/ruling files are not tracked in this repository. On this
workstation, Codex and Claude role pairs are installed and byte-identical:

| Pair | SHA-256 |
|---|---|
| `worker-onboarding` | `7FDE81475B42701D0932EF857D9C2C3AF7D3EC05AF37252B1488687B4F97AA3A` |
| `worker-execution` | `78F14F479B7B6C3A5D41D8475214A3C24D168A348AA23429AC286FAD016F011A` |
| `advisor-onboarding` | `6AB52C619B82F3F90B04137C56542E2AF83FDD163F53544E409B39BE50656DCE` |
| `advisor-ruling` | `9A885448B1EA25A262313336DF1265B73C92783276B968E61093D7D08A82F83B` |

A clean clone has **canonical skill content**, not role-level installation.
Install or merge the local role pointers before claiming that integration.
