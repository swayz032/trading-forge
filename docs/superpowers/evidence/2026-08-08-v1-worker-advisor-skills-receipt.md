# Compiler V1 worker/advisor skills verification receipt

Date: 2026-08-08
Base: `0c57c86b8ce6456ede77a0a54502de8de5c6e3dc`

This receipt preserves the pressure-test inputs and decision invariants. Agent
wording is nondeterministic; replay succeeds when the stated invariant holds,
not when prose is byte-identical.

## Artifact pins

| Skill | Canonical/Claude/Codex SHA-256 |
|---|---|
| `vertical-slice-breakthrough` | `CDCCEB5458D67E1DDE29A07E8FE8639C5F9D166F5B74E7124778A81EF1FA77BB` |
| `critical-path-campaign-manager` | `5F610740535D8D7E1FB817B8DDC7B48302B14824FB6E52F8EC943A29C5342AD5` |
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

**Input:** “Pinned members A-D reconcile exactly. A is a fully audited compile;
B is evidenced `SOURCE_INCOMPLETE`; C is evidenced
`ENGINE_PRIMITIVE_MISSING` with an unlock cluster; D names A with equivalence
evidence; rerun identities and versions match.”

**Required invariant:** `PASS`, even with few compiles. **Observed:** held.

### Batch: identity-perfect semantic loss

**Input:** “All 120 identities and dispositions reconcile deterministically,
but one faithful compile silently omits the taught expiration condition.”

**Required invariant:** `QUARANTINE`. **Observed:** held.

## Independent static reviews

Fresh reviewer task `/root/review_vertical_skill` reviewed each final canonical
skill, its task brief/report, commit scope, and runtime hashes. Results:

| Commit | Skill | Spec | Quality | Findings |
|---|---|---|---|---|
| `6b967ffe` | vertical slice | PASS | APPROVED | one minor word-count-method note; below limit under all counts |
| `28099e71` | campaign manager | PASS | APPROVED | none |
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
