# H1 Pilot — CONDUCTOR mechanical pre-commitments (FROZEN before unseal + before any adjudication)

> Frozen by the fresh-context conductor BEFORE the sealed 16 is opened and BEFORE any rater is dispatched.
> These fix the mechanical seams the frozen pre-reg + its 7 addenda leave to the executor, using the
> strictest defensible reading (Law 4). They do NOT re-interpret the §1 bar or §2 outcomes — they only
> pin how rater outputs are turned into the `Tier3Verdict` / `Tier3SupportVerdict` inputs the frozen
> instrument (`finalize_certificate`) consumes. Recorded so the read is auditable and un-tunable.

## R1 — Two independent raters, control-gated (pre-reg §3, shakedown protocol)
Two fresh-context blind rater agents. Each first adjudicates Set-A (10 controls) Stage-1 role, then all
Stage-1 targets, then (in a SEPARATE later turn — read-order lock) Stage-2 support. A rater's target calls
COUNT only if its Set-A clears >= 4/5 gate direction AND >= 4/5 context direction against the verifier
answer key (gate controls: W1-0001/0003/0005/0007/0009; context controls: W1-0002/0004/0006/0008/0010).
A rater who fails the control gate has ALL target calls dropped; if two control-gate-passing raters cannot
be obtained, that is a tripwire → HALT (not silently proceed on one rater).

## R2 — Stage-1 role → tier-3 classification (what makes a fallthrough "classified tier-3")
Per fallthrough span, a `Tier3Verdict` is fed to `finalize_certificate` IFF the two control-gate-passing
raters return the SAME role AND that role ∈ {gate-strength, context} (a determinate surface classification).
- **Agreement on a determinate role** → `Tier3Verdict(role, role, control_gate_passed=True)`; the span
  classifies tier-3.
- **Agreement on `cannot-determine`** → NO verdict passed → span stays `classifying_tier=None` (UNRESOLVED).
  Rationale: `cannot-determine` is definitionally "could not classify"; the assembler's own un-adjudicated
  bucket is literally `surface_class="cannot-determine-at-tier-1", classifying_tier=None`. Feeding a
  cannot-determine as a tier-3 classification would inflate pilot-grade against the §1 bar's plain meaning
  ("classifies … with a quote anchor"). Strictest reading kept; no inflation.
- **Disagreement on role** → CONTESTED → NO verdict passed → span stays UNRESOLVED. (Recorded as contested;
  never averaged.)

## R3 — Stage-2 support → fidelity downgrade (only for spans that got a determinate agreed role in R2)
`Tier3SupportVerdict` is fed IFF the span classified tier-3 under R2. Value:
- **Both raters `confirmed`** → support=`confirmed` (no downgrade; the anchor faithfully grounds the rule).
- **Both `denied`** → support=`denied` (downgrade). **Both `partial`** → support=`partial` (downgrade).
- **Any disagreement** (e.g. confirmed vs denied/partial, or denied vs partial) → support=`partial`,
  justification = `"contested support (raterA=<x>, raterB=<y>)"` → downgrade. Strictest fidelity reading:
  a faithfully-grounded gate requires CLEAN two-rater `confirmed`; anything less is not clean support.
  (Contested recorded; not averaged — the non-confirmed downgrade is the honest floor, not a mean.)

## R4 — Axis-3 audit items (monitoring, never a gate)
Audit item_ids (`…-AUDIT`) sample a CLASSIFIED tier-1 fire. Their Stage-1 role is NOT used (the condition
already classified tier-1; the audit span is not a fallthrough, so any `Tier3Verdict` for it is ignored by
the assembler). Their Stage-2 support IS collected and lands in `cert["axis3_audit"]` (a `denied`/`partial`
here is a RECORDED monitoring signal on the named residual, never a mechanical downgrade — Addendum 5).
Support value uses the same R3 confirmed/else mapping for recording only.

## R5 — Economics counting (Addendum 6 + 7, per-video AGGREGATE)
Adjudications/video = (# Set-B fallthrough items) + (# axis-3 audit items), SUMMED across all of that
video's strategies. Compared to the ~15 affordability CEILING as a per-video aggregate (Law 4, Addendum 7 —
no per-strategy re-derivation after the number). Per-strategy normalization recorded as ANNOTATION only.
This count is deterministic at Phase 1 (it is the packet target-item count) and does not depend on rater
outputs.

## R6 — Video certificate-grade (Addendum 6)
A VIDEO is certificate-grade (pilot-grade) IFF >= 1 of its extracted strategies reaches `pilot_grade=True`
from `finalize_certificate`. The §1 fidelity fraction = (# certificate-grade videos) / 16 vs the >= 60% bar.
Per-strategy grades all recorded (the per-strategy table is the product). `full_grade` is unreachable in
this topology-less conveyor (correct, addendum §C) and is NOT the pilot's bar.

## R7 — One extraction pass per video, read-once (Addendum 2 clause 2)
Each video: fetch (production youtube-transcript path) → one real-extractor pass (vaulted atomically) →
locator (real gemma) → prepare. A crash mid-video re-runs and REPLACES that whole video's pass; no
cherry-picking. The §1 bar is read ONCE in Phase 3 from this first valid run.
