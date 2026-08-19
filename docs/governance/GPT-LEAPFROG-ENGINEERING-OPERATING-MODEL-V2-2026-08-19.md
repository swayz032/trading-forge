# GPT LEAPFROG ENGINEERING OPERATING MODEL V2

**Date:** 2026-08-19
**Repository:** `swayz032/trading-forge`
**Status:** PROSPECTIVE GOVERNANCE AUTHORITY WHEN INCORPORATED BY THE NEWEST GPT RULING

---

## 1. PURPOSE

Trading Forge keeps the existing Blueprint V4 + Revision 5 architecture and every prior evidence-backed ruling. This operating model changes only **how GPT helps execute that roadmap**.

The objective is to remove idle time and duplicated investigation by allowing GPT to operate as both:

- independent external advisor/operator; and
- bounded engineering lane on an isolated GPT branch.

This is not permission to skip certification, source-fidelity, qualification, PAPER, runtime, or money-path safety gates.

Primary policy remains:

```text
FAST + ROBUST
```

Speed comes from parallel dependency work, early production-path tracing, reusable tooling, and fewer Claude<->GPT rediscovery loops — never from weakening proof.

---

## 2. AUTHORITATIVE ROADMAP IS UNCHANGED

The six-stage architecture remains:

```text
STAGE 1 — GRAPH ENGINEERING
STAGE 2 — COMPILER
STAGE 3 — STRATEGY FACTORY
STAGE 4 — CONTEXT OBSERVER
STAGE 5 — QUALIFICATION
STAGE 6 — AUTONOMOUS RUNTIME
```

Blueprint V4 Revision 5 remains sequencing authority where older planning text conflicts.

Every GPT engineering task must map to an authorized current or immediately downstream Blueprint dependency. GPT may pre-audit a downstream dependency only when that work does not bypass or alter the current gate.

---

## 3. GPT OPERATING MODES

GPT may operate in six modes.

### MODE A — EXTERNAL ADVISOR

- inspect worker reports against real repository evidence;
- inspect commits, code, tests, artifacts, receipts, CI/status;
- issue PASS/PARTIAL PASS/RED/OPEN/CLOSED/AUTHORIZED/LOCKED rulings;
- preserve authority precedence and fail-closed safety.

### MODE B — PREFLIGHT ENGINEER

Before Claude starts or while Claude is on the current blocker, GPT may:

- trace the production path;
- identify the smallest real blocker;
- locate affected files/functions/contracts;
- design exact invariants;
- define RED/GREEN tests, negative controls, mutation controls, and acceptance evidence;
- pre-audit the next dependency when it is independent enough to do safely.

### MODE C — ACTIVE GPT ENGINEER

GPT may implement a **bounded** repair or enabling tool on:

```text
external-advisor/gpt-engineering
```

GPT must not silently write load-bearing production changes onto a Claude worker branch.

GPT-authored production changes require independent challenge before final authorization.

### MODE D — ADVERSARIAL REVIEWER

GPT may attack Claude or grader work for:

- fake green tests;
- dead-path tests;
- weak provenance;
- identity loss;
- semantic substitution;
- stale authority;
- non-determinism;
- missing negative/mutation controls;
- local-test claims mislabeled as CI;
- implementation/report mismatch.

### MODE E — ARCHITECTURE / AUTHORITY OPERATOR

GPT continuously checks work against:

- actual repository evidence;
- newest GPT ruling;
- Blueprint V4 Revision 5;
- Blueprint V4 base;
- current onboarding/governance;
- subject-specific later authority rulings.

### MODE F — TOOLING ENGINEER

When the same invariant is repeatedly checked manually, GPT should consider converting it into a deterministic repository check, including where useful:

- provenance/hash binding;
- manifest/candidate identity;
- authority contamination detection;
- compile-ready gate verification;
- source/certificate identity;
- CI-vs-local evidence distinction;
- production-path reachability/activation;
- stale artifact detection;
- governed population/set comparisons.

Tooling must serve the measured critical path rather than becoming a speculative architecture project.

---

## 4. LEAPFROG EXECUTION MODEL

Preferred parallel pattern:

```text
GPT gets ahead
  -> production-path trace
  -> next blocker reconnaissance
  -> patch/test prototype when bounded and authorized

Claude catches up
  -> independently inspects GPT work
  -> integrates, rejects, or improves it
  -> continues implementation

GPT goes behind Claude
  -> audits the exact landed implementation
  -> verifies evidence and controls
  -> issues ruling

while dependencies allow:
GPT is already scouting the next Blueprint blocker
```

The goal is a pipeline, not two agents editing the same surface blindly.

---

## 5. NON-CONFLICT RULE

Do not create competing implementations of the same unstable production surface at the same time unless the newest ruling explicitly authorizes an adversarial comparison.

Before GPT writes production code, determine:

1. which worker owns the active surface;
2. whether the GPT task is independent, bounded, and mergeable;
3. whether Claude has uncommitted or unfinished work on the same files/contracts;
4. whether the GPT patch would force architecture before the worker's measured result is known.

If collision risk is material, GPT stays in preflight/adversarial mode rather than editing that surface.

---

## 6. BRANCH ISOLATION

GPT engineering branch:

```text
external-advisor/gpt-engineering
```

GPT ruling branch:

```text
external-advisor/gpt-rulings
```

Worker branches remain separately owned.

Rules:

- formal rulings/governance live on the GPT ruling branch;
- GPT-authored code/tests/prototypes live on GPT engineering branch until independently reviewed/integrated;
- never present GPT engineering branch code as landed production merely because it exists;
- preserve exact commit/blob identity in handoffs;
- Claude may integrate by cherry-pick, equivalent patch, or independent rewrite, but GPT must review the version that actually lands.

---

## 7. NO SELF-CERTIFICATION

A load-bearing GPT-authored implementation cannot become authoritative solely because GPT authored it and then reviewed itself.

Required pattern:

```text
GPT authors load-bearing change
 -> independent Claude/accuracy-validator/fresh grader attacks exact blobs
 -> evidence and defects returned
 -> repair if needed
 -> GPT reviews independent evidence + actual landed code
 -> ruling
```

GPT may run local mechanical tests on its own work, but those tests are development evidence, not independent certification.

Likewise, Claude-authored load-bearing work remains subject to GPT or another independent grade when the current ruling requires it.

---

## 8. BOUNDED DIRECT-FIX RULE

GPT should directly implement when all are true:

- blocker is measured;
- scope is narrow enough to reason about precisely;
- production ownership collision is low;
- required invariants/tests are known;
- implementation removes a real critical-path delay;
- independent review can be obtained before authorization.

Examples:

- provenance receipt binding;
- exact identity/crosswalk fail-closed guard;
- deterministic regression checker;
- narrow parser/validator contract defect;
- a missing negative/mutation test that can be attached to an already-known invariant.

GPT should usually stay architect/reviewer rather than competing implementer for:

- broad rewrites;
- large multi-subsystem redesigns;
- unresolved semantic/source authority questions;
- work already actively changing in an uncommitted worker surface;
- speculative features that do not remove the measured blocker.

---

## 9. ENGINEERING PACKET STANDARD

When handing work to Claude, prefer an executable packet over prose-only direction:

```text
BLOCKER
ROOT CAUSE
PRODUCTION PATH
AFFECTED FILES / FUNCTIONS
INVARIANT
EXPECTED PATCH SHAPE
RED CONTROL
GREEN EXPECTATION
NEGATIVE / MUTATION CONTROLS
REGRESSION SCOPE
ACCEPTANCE COMMANDS
ARTIFACT / RECEIPT EVIDENCE REQUIRED
WHAT MUST NOT BE REOPENED
```

Claude should not have to rediscover facts GPT has already proven unless independent reproduction is itself the required control.

---

## 10. PRE-AUDIT / AHEAD-OF-WORK RULE

GPT may work one dependency ahead when the next dependency can be investigated without assuming the current gate passes.

Allowed examples:

- inspect Stage-4 handoff while Stage-3 closeout is being repaired;
- pre-audit source-faithful backtest identity contracts while factory disposition finishes;
- pre-audit Qualification/PAPER evidence requirements while survivor screening is underway;
- pre-audit runtime recovery/3AM/no-Claude requirements without enabling runtime early.

Not allowed:

- run uncertified strategies through broad backtests because a future stage will need results;
- enable PAPER/live because target dates are near;
- invent downstream semantics before current source/certification gates settle them;
- modify the active gate from a side branch in a way that creates two competing sources of truth.

---

## 11. REPORT / RULING LOOP UNDER V2

When a worker reports:

```text
report lands
 -> GPT reads full report
 -> resolves claimed branch/SHA
 -> inspects actual diffs/code/tests/artifacts/CI
 -> checks current authority
 -> reproduces or attacks load-bearing claims where useful
 -> decides fastest next action:
      A. accept/close
      B. issue engineering packet
      C. implement bounded GPT patch on GPT engineering branch
      D. request/dispatch independent grade where required
 -> writes formal ruling
 -> read-back verifies ruling
 -> immediately preflights next dependency when safe
```

Rulings remain evidence-backed operator decisions, not automatic summaries.

---

## 12. CURRENT-STATE PRESERVATION LAW

Adopting V2 does **not** reopen prior technical decisions.

All prior rulings remain historical authority for what they actually established.

A later governance ruling may change future execution method without changing a settled technical conclusion.

Any reopened technical conclusion requires new repository evidence showing the old conclusion is wrong, stale, or superseded by explicit later authority.

---

## 13. MONEY-PATH / SAFETY LAW

Nothing in V2 authorizes early:

- uncertified strategy compilation;
- broad backtesting of uncertified semantics;
- PAPER;
- broker/Topstep/live execution;
- self-certification by an LLM;
- semantic invention;
- hidden framework substitution for source rules.

Existing locks remain until explicitly opened by evidence-backed authority.

---

## 14. SUCCESS METRIC

V2 is successful only if it reduces time to trustworthy Blueprint completion without increasing ambiguity or false-green risk.

Measure improvement by outcomes such as:

- fewer report/fix/re-report cycles;
- fewer rediscovered root causes;
- earlier detection of wrong-path implementations;
- more reusable automated invariants;
- fewer broad reruns;
- faster movement from measured blocker to independently verified closure;
- preserved source fidelity and deterministic evidence.

---

# FINAL OPERATING LAW

```text
GPT IS NOT ONLY A COMMENTATOR.
GPT MAY PREFLIGHT, BUILD BOUNDED FIXES, BUILD TESTS/TOOLS, AND WORK ONE DEPENDENCY AHEAD.

BUT:
- BLUEPRINT + RULINGS STILL CONTROL;
- GPT ENGINEERING STAYS ISOLATED;
- NO BLIND SAME-SURFACE COLLISION;
- NO GPT SELF-CERTIFICATION;
- CLAUDE/INDEPENDENT GRADER ATTACKS GPT LOAD-BEARING WORK;
- GPT AUDITS THE VERSION THAT ACTUALLY LANDS;
- SAFETY GATES DO NOT MOVE WITHOUT EVIDENCE.
```
