# GPT EXTERNAL ADVISOR RULING — AR-1351A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Type:** Governance / operating-model amendment  
**Prior technical ruling carried forward:** AR-1350A  
**Disposition:** **AUTHORIZED — GPT LEAPFROG ENGINEERING OPERATING MODEL V2 IS NOW ACTIVE PROSPECTIVELY. ALL PRIOR TECHNICAL RULINGS AND BLUEPRINT V4 + REVISION 5 REMAIN IN FORCE. AR-1350A REMAINS THE CURRENT STAGE-3 TECHNICAL WORK ORDER.**

---

## 1. WHY THIS RULING EXISTS

The prior operating model made GPT primarily an external reviewer: Claude built, GPT inspected, GPT wrote instructions, Claude repaired, and GPT inspected again.

That separation protected independence, but it also created avoidable latency when GPT had already located the root cause, production path, required invariants, and exact controls.

This ruling changes the **execution method**, not the engineering standard or roadmap.

GPT may now work as a bounded second engineering lane while preserving independent challenge and formal ruling authority.

---

## 2. ROADMAP / PRIOR AUTHORITY ARE NOT REPLACED

This ruling does not replace or reopen:

- Blueprint V4 base;
- Blueprint V4 Revision 5;
- the authoritative six-stage chain;
- prior evidence-backed GPT rulings;
- settled Gemma-vs-Opus role authority;
- already-closed compiler/certification findings;
- current Strategy Factory measurements;
- PAPER/live locks.

The six stages remain:

```text
GRAPH ENGINEERING
-> COMPILER
-> STRATEGY FACTORY
-> CONTEXT OBSERVER
-> QUALIFICATION
-> AUTONOMOUS RUNTIME
```

The change is that GPT may now actively help knock down authorized Blueprint blockers instead of being limited to prose-only review.

---

## 3. AUTHORIZED GPT MODES

Effective prospectively, GPT may operate as:

1. External Advisor;
2. Preflight Engineer;
3. Active bounded GPT Engineer;
4. Adversarial Reviewer;
5. Architecture / Authority Operator;
6. Tooling Engineer.

The detailed contract is frozen in:

```text
docs/governance/GPT-LEAPFROG-ENGINEERING-OPERATING-MODEL-V2-2026-08-19.md
```

The startup card is updated in:

```text
GPT-EXTERNAL-ADVISOR-ONBOARDING.md
```

---

## 4. GPT ENGINEERING BRANCH

Dedicated branch:

```text
external-advisor/gpt-engineering
```

This branch is the only normal location for GPT-authored code/tests/prototypes before independent review and integration.

GPT must not silently edit Worker 1 or Worker 2 branches.

Formal rulings/governance continue on:

```text
external-advisor/gpt-rulings
```

---

## 5. LEAPFROG EXECUTION IS AUTHORIZED

Preferred pattern:

```text
GPT gets ahead
 -> traces next dependency
 -> identifies blocker
 -> defines invariants/tests
 -> builds bounded patch when safe

Claude catches up
 -> independently attacks / integrates / improves

GPT goes behind Claude
 -> inspects exact landed code
 -> verifies evidence
 -> rules

GPT then preflights the next dependency when safe
```

This is intended to reduce dead time and repeated rediscovery.

---

## 6. NON-CONFLICT / OWNERSHIP RULE

GPT may not blindly compete with an active Claude implementation on the same unstable production surface.

Before direct code changes GPT must determine whether:

- Claude currently owns the same files/contracts;
- unfinished work may exist;
- the change is bounded and independently mergeable;
- the implementation would prematurely assume an unresolved result.

If collision risk is material, GPT stays in preflight/adversarial mode instead of writing a competing patch.

---

## 7. NO SELF-CERTIFICATION

GPT-authored load-bearing work requires independent challenge before authorization.

Minimum pattern:

```text
GPT authors exact blobs
 -> independent Claude / accuracy-validator / fresh grader attacks them
 -> defects repaired if any
 -> GPT reviews independent evidence + exact landed implementation
 -> formal ruling
```

GPT's own mechanical tests may prove development behavior but do not substitute for an independent grade where the change is load-bearing.

---

## 8. CURRENT TECHNICAL WORK ORDER REMAINS AR-1350A

This governance ruling becomes the newest procedural authority, but it does **not** replace AR-1350A's current technical closeout order.

Stage remains:

```text
STAGE 3 — STRATEGY FACTORY
```

The active technical blockers remain:

### A. Stage-1 / Stage-2 semantic adjudication provenance binding

Need exact binding across:

- frozen unit identity;
- Tier-3 packet hash;
- exact task/prompt hash;
- expected item-ID set/hash;
- actual backend/invocation identity;
- raw response hash;
- parsed output identity;
- exact key-set equality;
- finalization consumption chain.

### B. Multi-strategy manifest projection identity

Need removal of unconditional position/index-based selection for multi-strategy videos. Use a durable proven crosswalk or fail closed.

### C. One bundled independent post-fix re-grade

Do not split into ceremonial repeated grades and do not mass-rerun the historical 42 Opus units unless new evidence proves their authority/semantics invalid.

If A-C are green under independent evidence, Step 12 may close.

---

## 9. HOW GPT MAY HELP ON THE CURRENT AR-1350A WORK

GPT is now authorized to:

- inspect whether Worker 1 has already started or landed the AR-1350A repairs;
- preflight exact implementation/testing seams;
- prepare deterministic negative/mutation controls;
- implement a bounded non-conflicting repair on `external-advisor/gpt-engineering` if that is faster than waiting;
- hand exact commits/blobs to Claude for independent attack/integration;
- audit the exact version that ultimately lands;
- pre-audit the immediately downstream Strategy Factory handoff while current repairs are underway, provided no gate is bypassed.

GPT is **not** authorized to run ahead into broad uncertified backtests, PAPER, broker/live, or semantic invention.

---

## 10. PREVIOUS RULINGS STAY VALID

The V2 role upgrade is prospective.

It does not invalidate earlier rulings merely because those rulings were written under the old reviewer-only model.

A prior technical conclusion may be reopened only by:

- new repository evidence demonstrating the conclusion is wrong or stale; or
- an explicit later authority ruling superseding it.

Do not restart settled campaigns for ceremony.

---

## 11. SUCCESS CRITERION

This operating change earns its keep only if it makes the Blueprint faster **without** increasing false-green risk.

Expected benefits:

- fewer Claude<->GPT correction loops;
- earlier production-path diagnosis;
- fewer duplicate investigations;
- bounded fixes completed in parallel;
- reusable invariant tooling;
- independent review preserved;
- faster movement from blocker -> repair -> verified closure.

---

# FINAL RULING

**AUTHORIZED. TRADING FORGE NOW USES GPT LEAPFROG ENGINEERING OPERATING MODEL V2. GPT MAY PREFLIGHT, BUILD BOUNDED FIXES/TESTS/TOOLS ON `external-advisor/gpt-engineering`, WORK ONE SAFE DEPENDENCY AHEAD, AND THEN AUDIT CLAUDE'S LANDED WORK. CLAUDE/AN INDEPENDENT GRADER MUST CHALLENGE GPT-AUTHORED LOAD-BEARING WORK BEFORE GPT CAN AUTHORIZE IT.**

**THE BLUEPRINT, ALL PRIOR EVIDENCE-BACKED RULINGS, SOURCE-FIDELITY RULES, AND MONEY-PATH LOCKS REMAIN IN FORCE. AR-1350A REMAINS THE ACTIVE TECHNICAL STAGE-3 WORK ORDER: FINISH ADJUDICATION PROVENANCE BINDING, FIX MULTI-STRATEGY MANIFEST IDENTITY, RUN ONE BUNDLED INDEPENDENT RE-GRADE, THEN CLOSE STEP 12 IF GREEN.**
