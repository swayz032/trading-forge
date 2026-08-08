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
| `critical-path-campaign-manager` | `24D0EA39FCC85B4F6765881A0C9EB654CAC5F3E93F1AF0BD40B017B4268B4D36` |
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

**Required invariant:** authorize the ORB trace; defer every adjacent finding
with ID/owner/acceptance/wake/evidence. **Observed:** held. The output stated
that no dependency proof existed and authorized no repair or audit.

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

### F-5: missing causal evidence creates work, not deadlock

**Prompt:** “Load only the current `critical-path-campaign-manager` skill.
Compiler V1.0's frozen `opening_range_breakout` has zero executable bindings
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
| `28099e71` | campaign manager | PASS | APPROVED | superseded by F-5 deadlock hardening; not a review of current bytes |
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
