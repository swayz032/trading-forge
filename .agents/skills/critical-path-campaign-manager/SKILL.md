---
name: critical-path-campaign-manager
description: Use when a compiler campaign has a frozen release exit, multiple defects, audits, or tooling requests compete for attention, and work must be ranked without losing findings.
---

# Critical Path Campaign Manager

Protect the release exit through evidenced dependency.

## Admission rule

1. **Name the exit.** Before V1.0: first failed condition in the frozen real strategy. After: deterministic V1.1 compile-or-refuse disposition for every input.
2. **Demand precedence proof.** Adjacent work may run first only when measured evidence shows it prevents the causal trace or makes the trace's evidence or receipt invalid. Valid examples: the required instrument is unreadable, fabricates its receipt, or cannot enumerate its intended surface. Require a clean control and a red-proof, authorize only the minimum repair, then return immediately to the trace.
3. **Separate emergencies.** A measured production-safety incident may preempt the campaign. Track it as an incident; never count that repair as compiler progress.
4. **Defer without losing.** Every finding, including an unverified exit-state claim, gets one instantiated row with stable ID, owner, acceptance, wake trigger, and evidence. Placeholders, groups, or future-registration instructions deny authorization.

Parallel traces require disjoint writes. Rank measured work; never invent findings or authorize broad implementation.

Treat report or scenario statements as claims without artifact or command evidence. If the exit state is unmeasured, authorize its smallest read-only verification before the causal trace; never promote a claim to `measured`.

Before measuring, resolve the target identity against the ratified frozen authority pin. If identity is missing or ambiguous, authorize only that read-only resolution; stop before measurement. Recording a selected object is not verification.

## Required authorization

```text
CURRENT EXIT: frozen artifact and measurable completion condition
CRITICAL PATH: first failed condition or V1.1 disposition blocker
AUTHORIZED NOW: one bounded action and owner
PRECEDENCE PROOF: evidence-backed dependency to CURRENT EXIT
DEFERRED REGISTER: ID | owner | acceptance | wake trigger | evidence
WAKE TRIGGERS: exact conditions that promote deferred work
STOP: observable completion, refusal, or escalation condition
```

Refuse `P0`, `critical`, or similar labels without the dependency path. Missing causal evidence is work to measure, not a reason to deadlock: authorize the smallest read-only trace that can create it. Stop only if the exit cannot be identified, a required artifact remains inaccessible after a measured access attempt, or authorization widens beyond the proven blocker.

## Rationalization counters

| Rationalization | Counter |
|---|---|
| "Fix the tools first." | Only the exact broken trace instrument may precede, with control and red-proof. |
| "While we are here." | Record it and return to the authorized boundary. |
| "A broad sweep is safer." | Breadth delays the causal answer unless it invalidates the receipt. |
| "All real defects are equal." | Reality establishes validity; dependency establishes order. |

## Red flags

- Ranking by severity prose rather than an evidenced edge to the exit.
- Repairing an instrument beyond what restores the trace.
- Starting deferred work before its wake trigger fires.
- Calling incident response compiler progress.
