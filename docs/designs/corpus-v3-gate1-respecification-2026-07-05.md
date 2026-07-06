# Corpus v3 — Gate 1 Re-Specification (PRE-REGISTERED before computation, 2026-07-05)

**Trigger:** Gate 1 FAILED at the pre-registered overall ≥85% (verified 70.0%, 49/70 held-out). Fable-5 (advisor)
ruling. This doc is locked BEFORE the human-vs-gold threshold is computed — the classifier's known scores cannot
be blinded, but the threshold is an empirical, non-tunable quantity nobody has computed yet.

## Record correction (parent-agent errors, stated plainly — not laundered)
1. The ceiling arithmetic `0.17×0.83 + 0.83×0.672 ≈ 70%` used the CLASSIFIER'S OWN margin score (67.2%) as the
   ceiling term — that computes where the classifier landed, NOT where the ceiling is. Circular.
2. `67.2% > 57.7%` compared classifier-vs-gold against human-vs-human INTER-RATER — different quantities/units.
3. The 57.7% figure was KNOWN at pin time (in the Fable-5 briefing); it was not a discovery. **The ONLY genuinely
   new fact is STRATUM COMPOSITION:** the design assumed deterministic rules would cover most conditions; instead
   82.9% of held-out (58/70) landed in the gemma margin. That surprise is the legitimate basis for re-examining
   the pin. The label-noise implication was foreseeable and we failed to foresee it — recorded as a miss.

## Gate role change
- **Gate 1 DEMOTED: certifying-proxy → NECESSARY SCREEN.**
- **Gate 3 (behavioral revival) is now the explicit DECISIVE gate**, UNCHANGED at its frozen rule (≥8/9 revival
  + zero unexplained regressions).
- **Pure-(c) REJECTED:** Gate 3 is small-N (9 strategies); dropping the semantic screen would let a classifier
  that is right for compensating reasons pass behaviorally. Keep BOTH, weight correctly.

## Re-specified Gate 1 pass criterion (LOCKED, threshold uncomputed)
Gate 1 (necessary screen) PASSES iff:
> the classifier's **margin-stratum agreement 95% binomial-CI LOWER BOUND (= 54.42%, known)** ≥ the empirical
> **human-vs-gold-on-margin agreement rate** (threshold, NOT yet computed).

Operationalization (fixed now):
- **human-vs-gold-on-margin** = agreement of the independent SECOND-pass rater's labels vs the FIRST-pass GOLD
  labels, restricted to the second-pass-subsample conditions that the DETERMINISTIC classifier routes to the
  margin (i.e. fall through rules 1-5 to gemma). Computed from `dri-audit-2026-07-05.json`
  `full_classification_table_second_pass_subsample` (71 conds) vs `full_classification_table_first_pass` (gold),
  intersected with the deterministic classifier's margin routing. NO new gemma calls — pure label comparison.
- **Gold construction MUST be documented** in the same record (single-rater first-pass / adjudicated / majority).
  If gold was adjudicated/reconciled, human-vs-gold rises and the bar rises with it — this is the honest risk.
- If human-vs-gold-on-margin comes back **> 54.42%**, Gate 1 stays FAILED and that verdict STANDS.
- If the human-vs-gold margin sample is itself too small for a stable rate, report LOW_POWER on the ceiling and
  do NOT certify (same discipline as the classifier-side LOW_POWER pin).
- The overall-≥85% condition is RETIRED as the Gate-1 pass gate (mis-specified relative to now-known stratum
  composition) — RETAINED only as a reported diagnostic, never as a pass/fail.

## Gate 3 NO-RELIEF pre-commitment (LOCKED, before Gate 3 runs)
The ceiling-relief reasoning applied to Gate 1 here is **NOT available to Gate 3.** If the revival proof fails
its frozen rule (≥8/9 revival AND zero unexplained regressions), **it fails — there is no "the pin was mis-formed"
argument in reserve.** Written down NOW so today's re-specification is honest, not precedent for the next miss.

## Also required (Fable-5 ruling)
- **(a) regardless:** expand deterministic rule coverage using ONLY the 143 rules-design conditions (non-circular),
  single re-test on held-out. Diagnostic FIRST: rule coverage on the design set vs the held-out 17%. If design-set
  coverage is much higher, the rules OVERFIT the design split — a separate finding to freeze.
- **Record notes:** rule-covered stratum 83.3% is N=12 — quote with its (wide) CI or not at all. The Gate 1 FAIL
  was self-reported honestly against the pre-registered pin — the pre-registration did its job; logged.

## CERTIFIED RESULT (independently re-verified 2026-07-05)
- **human-vs-gold-on-margin = 29/43 = 67.44%** (95% Wilson CI [52.52%, 79.51%]; not LOW_POWER). Gold = single-rater
  first-pass (documented; NOT adjudicated) → same units as classifier-vs-gold. Overall inter-rater independently
  re-verified 41/71 = 57.75% (matches audit).
- **Locked criterion:** classifier margin CI-lower 54.42% ≥ 67.44%? **FALSE → Gate 1 STAYS FAILED (certified).**
- **The failure mode (finding, not relief):** classifier margin POINT 67.24% vs human ceiling POINT 67.44% —
  **statistically indistinguishable (~67% both, overlapping CIs). The classifier is HUMAN-EQUIVALENT on the margin.**
  It fails only the *demonstrable strict beat* the criterion required, which a human-equivalent classifier cannot
  satisfy against single-rater gold whose own inter-rater ceiling is 57.7%.
- **Overfit finding (frozen separately):** deterministic-rule coverage design-set 34.35% vs held-out 17.14% =
  **2.00× → rules OVERFIT the design split.** Option-(a) rule expansion is therefore weakly motivated — more rules
  likely overfit further rather than generalize on held-out.
- **Rule-covered stratum:** 10/12 = 83.33%, 95% Wilson CI [55.20%, 95.30%] (N=12, wide — cited with CI per ruling).

## DISCIPLINE NOTE (do NOT re-specify Gate 1 a third time)
Gate 1 was re-specified ONCE with a coin-in-the-air threshold; it failed honestly. Arguing now that "the screen is
unsatisfiable by a human-equivalent classifier, so relax it again" is the exact goalpost-move precedent the Gate-3
no-relief pre-commitment was written to forbid. **Gate 1 stays FAILED. The classifier does not clear the necessary
screen. Per the plan we do NOT proceed to Gate 3.** The path forward is an operator/advisor decision on a DIFFERENT
lever (gold quality / classifier approach / fallback), not a third re-spec.

## PATH FORWARD — Gate 1 RETIRED, replaced by Gate 1′ (Fable-5 ruling, LOCKED 2026-07-05)
Gate 1 (semantic bulk-screen) stays FAILED and UNCURED — the classifier never passes it. It is RETIRED, not
relaxed: the record shows the semantic bulk-certification was gold-noise-limited and replaced by a
behaviorally-anchored screen. (Diagnosis-not-appeal note: the locked criterion was asymmetric — classifier
CI-lower 54.42% vs human POINT 67.44%; under that test a second human rater would likely fail the first too.
That confirms "human-equivalent" is the right read of 67.24% vs 67.44%; it changes nothing about the certified FAIL.)

### Gate 1′ — targeted adjudication (LOCKED before any adjudication happens)
The screen function (catch a classifier wrong for compensating reasons) does NOT require certifying against 221
noisy labels — it requires high-quality adjudication of exactly the conditions that are BEHAVIORALLY DECISIVE.
- **Scope:** for every strategy whose trading behavior CHANGES between v2 and v3-shadow (revivals AND deaths),
  every condition whose ROLE ASSIGNMENT DIFFERS (v2 role ≠ v3 classifier role) gets fresh MULTI-RATER,
  transcript-anchored adjudication.
- **LOCKED pass rule:** every revival-driving role change must be UPHELD by adjudication; any OVERTURNED change
  is treated as an UNEXPLAINED REGRESSION under Gate 3's frozen clause and FAILS certification.
- **Can fail:** adjudicators have not looked; the classifier's known scores do NOT predetermine their verdicts.
- **doer≠grader extends to adjudicators:** their labels are CLAIMS until the transcript anchors are independently
  checked; multi-rater, independent, transcript-anchored.

### AND-certification pre-commitment (LOCKED before Gate 3 runs — knowledge-ordering hazard)
Running Gate 3 in the shadow namespace is legitimate (shadow prevents baseline contamination; "Gate 1 before
Gate 3" was flip-safety, not information). But if Gate 3 passes first, pressure builds to wave off adjudication.
**Certification for the flip requires Gate 3 (frozen rule: ≥8/9 revival + zero unexplained regressions, NO relief)
AND Gate 1′ (adjudication rule above) — regardless of the order results arrive or how good either looks alone.**

### Two freezes
1. **Rules-overfit CLOSED:** design 34.35% vs held-out 17.14% = 2.00× → option-(a) rule expansion is not merely
   capped but likely COUNTERPRODUCTIVE (more rules → more overfit). Closed; not pursued.
2. **Structural finding + gold-strengthening DEFERRED:** semantic bulk-certification is gold-noise-limited at
   ~57.7% single-rater label reliability; the classifier is at human parity on the margin. Gold-strengthening is
   NOT rejected — DEFERRED to corpus-scale, scoped to the MARGIN stratum only, if/when the classifier certifies
   via Gate 1′+Gate 3 and 117-strategy confidence is actually needed.

## PATH-PARITY CHECK (LOCKED certification condition — Fable-5, emerged from Step-5 verification)
Gate 1 certified the ASYNC `classifyGateStrength()` path; Gate 3 runs specs produced by the SYNC emit-spec compiler
path (`graph-to-engine.ts` + the Step-5 `gateStrengthOverrides` async pre-pass in `atomize-transcript.ts`). These
are TWO implementations of what we claim is ONE classifier. If they diverge (prompt assembly, margin routing,
deterministic-rule pass), Gate 1's FAIL and Gate 1′/Gate 3's verdicts describe DIFFERENT artifacts and the
AND-certification silently becomes an AND across two classifiers.
- **LOCKED:** before certification, run the SYNC emit-spec path on the 70 held-out (or all 221) conditions and
  confirm role assignments are **IDENTICAL** to the async path's already-recorded Gate 1 outputs (on disk).
  Identical means identical; any mismatch is enumerated and explained, or path-parity FAILS. Cheap: async outputs
  exist, one sync re-run compared offline after the tower frees.
- **Certification for flip now requires Gate 3 ∧ Gate 1′ ∧ path-parity** (updated AND-certification).

## Session-close record notes (Fable-5, verbatim-worthy)
- The `24f57ee` resolution is the pinning manifest doing its EXACT job: it flagged real engine drift, forced a read
  of the actual diff, and the drift was certified benign BY INSPECTION, not by trust. Manifest discipline works.
- HONEST CAVEAT: check #2's "byte-identical when flag OFF" is STRUCTURAL inspection only — the full worktree test
  re-run confirming the additive-wiring claim is DEFERRED to next session (on the pending list, not silently dropped).

## GATE 3 RE-RUN PROTOCOL (Fable-5, LOCKED before dispatch 2026-07-06)
Gate 3's first run produced an INVALID measurement — 3 classifier-independent instrument defects crashed/masked
the exact transitions under test. Re-run authorized (three-leg blade holds: defect real+verified, fix result-
independent, frozen rule can still fail). Protocol:

### VALIDITY-BEFORE-VERDICT (strict ordering — closes the asymmetric-stopping hazard the 6/9 peek created)
The re-run harness reports **instrument validity FIRST**: zero crashes, zero exceptions, ALL 9 revival pairs AND
ALL v2-traded pairs measurable, no timeouts.
- Validity FAILS → verdict numbers **QUARANTINED UNREAD**; the new defect gets the same three-leg treatment; re-run.
- Validity PASSES → verdict read **ONCE**; frozen rule applies — FINAL, no relief, **no post-hoc instrument claims.**
This makes "go find one more instrument bug" structurally impossible, not merely resisted.

### DENOMINATOR: option (i) LOCKED — fix all instruments so all 9 are measurable
(ii) re-scope the "9" to measurable pairs = REJECTED (goalpost-adjacent even with sign-off; frozen rule said 9,
9 it stays). (iii) accept MCL indeterminate = REJECTED (caps max at 6/9, forces FAIL on instrument grounds —
inverts the same error). Only (i) preserves the rule as written.

### MCL: DIAGNOSE BEFORE FIX
The demotion experiment (commit `1ab7321`) measured MCL revivals on this same data → strong prior that the Gate 3
MCL gate failure is a harness-loads-an-unneeded-TF artifact, NOT corrupt data. **If diagnosis shows the MCL data
is genuinely corrupt → STOP:** that contradicts a certified prior result and becomes a FROZEN FINDING of its own
before anything re-runs.

### SCOPE LOCK on the fix commit (instrument-only)
ONLY: the winners/losers hoist + zero-signal regression test (mirror of the C2 fix), the MCL gate resolution, the
timeout envelope (limit/chunking — never the computation). ZERO changes to classifier / specs / roles / the
harness logic that computes revival/regression. Commit message enumerates exactly these 3 defects and nothing
else. **Any classifier-side "while I'm in here" change VOIDS the re-run.**

### QUARANTINE the 6/9 reconstruction
The agent's hand-reconstructed 6/9 is DIAGNOSTIC ONLY — never citable in certification. The valid re-run verdict
SUPERSEDES it in BOTH directions (if the re-run says 8/9 PASS, the recon didn't earn it; if 6/9 FAIL, the recon
doesn't rescue it).

### RECORD
- The Step-5 agent's conduct — refused to certify a crash-masked result, reconstructed diagnostically, did NOT
  self-patch the engine — is doer≠grader culture working at the subagent level. Logged.
- **METHODOLOGY FREEZE (standing requirement):** a harness that can crash on the transition it is measuring will
  systematically mask exactly the effect under test (zero-signal crashes hide zero→nonzero revivals). ALL future
  gate harnesses must include an instrument-validity self-check as a standing requirement.

## GATE 3 RE-RUN — SYSTEMATIC SIBLING-PARITY AUDIT (Fable-5, LOCKED 2026-07-06)
Gate 3 run 2 hit a 4th instrument defect (roll-cost omitted from `run_class_backtest`'s bar-level equity loop
while `net_pnl` subtracts it → reconciliation raise at `backtester.py:7268`). Root pattern: `run_class_backtest`
(the compiled-spec path the whole corpus uses) is an under-maintained sibling of `run_backtest`, missing
hardening fixes the latter has. Authorized: enumerate the defect CLASS once via a systematic audit rather than
discover it one re-run at a time.

### Audit scope discipline (prevents hardening-pass → uncontrolled rewrite)
Diff `run_class_backtest` vs `run_backtest`; classify EVERY divergence:
- **(a) hardening fix present in one, absent in the other → FIX** (each defect its own three-leg verification +
  regression test where feasible). ONLY class (a) enters the commit.
- **(b) intentional divergence → DOCUMENT why, leave it.**
- **(c) cannot determine → ESCALATE, do NOT guess.**

### Blade wording correction (goes in commit + log)
Defect 1's fix is behaviorally byte-identical. **Defect 4's fix is NOT** — it changes equity curves and every
equity-derived metric. It does NOT change trade signals or counts, and Gate 3's frozen rule (revival, regression)
is defined ENTIRELY on trade counts. So the leg is **"verdict-variable-preserving," NOT "computation-preserving"**
— corrects P&L plumbing without touching anything Gate 3 measures.

### Parity-guard test (durable output, IN SCOPE this commit)
Add a test that runs both paths on identical inputs and asserts agreement on all shared outputs, so the NEXT
un-mirrored fix is caught by CI, not by a four-defect Gate 3 postmortem. (Deeper cure — factor out the duplicated
logic so there's nothing to mirror — is REGISTERED as post-certification engineering, NOT started now.)

### "Re-run once" = cap on VERDICT READS, not runs (clarification, locked)
If the re-run's validity gate fails on a defect 5 the audit missed → verdict numbers stay QUARANTINED UNREAD and
the protocol loops (same blade, same scope lock). Verdict numbers are read EXACTLY ONCE, from the first
validity-passing run, and the frozen rule applies to those numbers with no relief.

MCL diagnosis (harness-loads-unneeded-30min-TF artifact, fixed) + timeout envelope stay in scope — everything
lands before the single re-run.

## FROZEN FINDING (corrected, bounded + stratified — Fable-5) 2026-07-06
**Class-path equity curves omit roll cost from the bar-level loop** (`run_class_backtest` deducts slippage +
commission into `bar_dollar_pnls` but not `RollSpreadCost`, while `net_pnl` subtracts all three). **For all
historically COMPLETED class-path runs, the resulting equity overstatement is BOUNDED by the $1 reconciliation
tolerance** (`backtester.py:7263` raises above it — so any completed run had ≤$1 bar-vs-trade divergence).
**Trade-level P&L was ALWAYS correct** (`net_pnl` includes roll cost). **Trade-count and signal-based findings
are UNAFFECTED** — demotion revivals (`1ab7321`), null-calibration, DRI, and Gate 3's revival/regression counts
all rest on trade counts / signals, not equity curves. **Companion action:** check the historical record for any
run that DID raise this reconciliation error and was waved off as flaky; if any, flag them.

## DEFECT 5 + RULINGS (Fable-5, LOCKED 2026-07-06) — verdict-variable defect + reference re-derivation
Audit found **Defect 5 (verified): `run_class_backtest` — the compiled-spec path the WHOLE corpus uses — never
applied the core framework guards** (E.3 ATR stop-ceiling entry-skip, E.5 15:55 time-stop, E.4 67%/95% DLL halt).
Every historical class-backtest ran guard-less. Smoke test: 535 DLL halts fired on ONE spec where zero ever did.
Fixed in `8cd2885` (scope-clean: backtester.py + 4 tests only). This fix SUPPRESSES/SKIPS entries → verdict-VARIABLE.

### Ruling 1 — legitimate (blade leg re-worded)
Blade-leg-2 for Defect 5 = **"result-independent AND reference-specified"** (fix content determined ENTIRELY by
run_backtest's existing guard code — nothing tunable toward any revival count), NOT "verdict-variable-preserving."
A guard-less engine measures a DIFFERENT strategy than the spec defines; a verdict from it certifies a fantasy.
**Direction check: guards suppress entries → the fix pushes the gate toward FAIL, not PASS** — the opposite
signature of goalpost-moving. CONSEQUENCE: the quarantined 6/9 reconstruction is now DOUBLE-DEAD (hand-computed
AND measured on the guard-less engine) — predicts nothing about the re-run.

### Ruling 2 — the frozen "9" is re-derived on the fixed engine (LOCKED, in order)
The frozen rule means "classifier extraction-time roles REPRODUCE what runtime demotion achieved" — a comparison,
defined only on a COMMON engine. The 9 was measured on a now-certified-broken instrument; keeping the literal
denominator while fixing the engine silently swaps the hypothesis. So:
1. **RE-DERIVE THE REFERENCE:** run the runtime-demotion arm (v2 + `TF_ROLE_DEMOTION_MODE=struct_ctx`) on the
   GUARD-FIXED engine, same pinned everything. Strategies reviving under demotion there = **N** = the new
   reference set. A reference measurement — read BEFORE and SEPARATELY from the verdict.
2. **Rule transforms STRUCTURALLY, not numerically:** ≥**(N−1)/N** classifier revivals (one miss only with
   audited explanation) + zero unexplained regressions — identical FORM, re-derived denominator. **If N < 5 →
   LOW_POWER, cannot certify alone** (same handling as Gate 1's margin stratum) → escalate, do not trivially pass.
3. **Dropouts are a FINDING, not a deletion:** any of the original 9 that don't revive under demotion on the
   correct engine = contradicting evidence against the SCOPE of `1ab7321` → annotate that frozen finding
   re-scoped ("on the then-current, guard-LESS engine"), the re-derivation quantifying what survives.
**READ ORDER LOCKED: reference → validity → verdict.** The current v2/v3 run keeps grinding (its arms are needed
regardless); NO verdict read until the reference lands.

### Ruling 3 — defer 7/8/9, CONDITIONAL on code-verified entry-suppression floors
Deferral of Defects 7 (VIX sizing) / 8 (partial-fill) / 9 (margin expansion) holds ONLY IF none can change
whether an entry OCCURS — verify IN CODE, not by category: (7) VIX sizing cannot round position size to 0
contracts, or sizing is downstream of entry counting; (8) partial-fill cannot produce a zero fill that voids a
trade; (9) margin expansion cannot cap contracts below 1. If ALL floors hold → verdict-irrelevant, defer +
register. **If ANY can suppress an entry → promotes to pre-verdict, joins the audit commit.** Regardless, all
three MUST land before any corpus-level re-baseline (they move equity metrics that null-cal + Mode A/B consume).

### Record
- The regression clause's denominator ("traded in v2") is computed from the fixed-engine v2 arm INSIDE this run
  → internally consistent by construction, needs no separate re-derivation.

## DEFECT 6 (MCL reconciliation) — Ruling (a), diagnosis-before-fix (Fable-5, LOCKED 2026-07-06)
Reference re-derivation validity FAILED: 8 pairs (ALL MCL, 0 non-MCL) raise `reconciliation_failed` on the
guard-fixed engine — the engine detecting its OWN two P&L computations (equity-curve vs summed-trade) disagree at
MCL's $100/point scale. **Ruling (a): fix Defect 6, re-derive, complete the reference. (b) rejected** — internal
arm-consistency ≠ instrument validity (was ALSO symmetric on the guard-less engine we refused to certify); a
`reconciliation_failed` is self-reported wrongness, not an unmeasurable pair; excluding the blocked pairs right
after an encouraging reference is textbook asymmetric-stopping; and "near-certain revivals we can't measure" is a
CLAIM, not a verdict — forbidden in a certification.

### Diagnosis-before-fix (PRE-REGISTERED — the tolerance path is abuse-prone)
Two hypotheses, different fixes:
- **H-A: real P&L omission the guards introduced** (Defect-4-class) → mirror the missing deduction, verify, and
  confirm the fix does NOT touch entry logic (guards changing P&L don't move trade counts — verdict-variable check).
- **H-B: the $1 ABSOLUTE tolerance is mis-scaled for MCL's point value** (computations correct, threshold wrong) →
  fix = relative tolerance or per-contract scaling. **GUARDRAIL: a validity-check threshold change is exactly what
  gets abused — it MUST be derived from contract specs (point_value × positions), justified in the commit
  INDEPENDENT of any Gate 3 number, and applied UNIFORMLY across symbols.** Not tuned to make any pair pass.
Diagnose FIRST; the diagnosis selects the fix.

### READ ORDER for the next cycle (mechanical)
defect-#6 diagnosis → fix under scope lock → re-derive reference → reference VALIDITY (MCL under microscope) →
final N + original-9 disposition (the 2 indeterminates RESOLVE to survive/dropout) → unseal classifier verdict
against **≥(N−1)/N**. If N=9 → rule is ≥8/9, landing exactly where the original freeze started, now on an
instrument that earns the number.

## FROZEN ANNOTATION (banked now, independent of the verdict) 2026-07-06
**`1ab7321`'s core finding — runtime demotion revives dead strategies — is CONFIRMED ROBUST TO THE FRAMEWORK GUARDS**
on 7 of 9 pairs (all MES/MNQ: snNkQSyWX4k, m-G1ag77aVc, oDLt9zh33LE + oDLt9zh33LE_MCL; baseline 0 → demotion
1,000–2,400 trades on the guard-FIXED engine). The 2 MCL pairs (m-G1ag77aVc_MCL, snNkQSyWX4k_MCL) are
instrument-blocked pending Defect 6, NOT dropouts (0 confirmed non-survivals). **The biggest standing threat to the
whole arc — that the demotion revivals were guard-less-engine artifacts — is now dead: they survive a correct
instrument.** Independent of whether the classifier (Gate 3) reproduces them.
**ORB disambiguation frozen:** `oDLt9zh33LE` is the genuine zero-baseline ORB (baseline 0 all 3 symbols, matches the
frozen signature); `jlShztsY3oA` is an UNRELATED already-profitable strategy that shares the ORB tag (baseline
2851/2424 on MES/MNQ) — excluded from the reference correctly.
**Floors 7/8/9 VERIFIED (deferral confirmed):** VIX-sizing / partial-fill / margin-expansion all floor position size
≥1 and cannot suppress an entry (sizing.py:1250, fill_model.py:442, margin_expansion.py:97). Registered as
mandatory before any corpus re-baseline (they move equity metrics null-cal + Mode A/B consume).

## REFERENCE CERTIFIED — N=9 (independently re-verified 2026-07-06, on Defect-6-fixed engine)
Reference re-derivation re-run on the guard-fixed + Defect-6-fixed engine (`75208e1`/`84471ee`). Independently
re-verified from `corpus-v3-reference-rederivation-2026-07-06.json`:
- **VALIDITY: 0 crashes / 0 exceptions / 0 timeouts / all 42 pairs measurable = TRUE.** The 8 previously-failing
  MCL `reconciliation_failed` pairs all reconcile now → Defect-6 fix RUNTIME-CONFIRMED. Defect-6 regression test
  `test_gate3_defect6_class_backtest_mcl_reconciliation.py` verified FAILS-pre-fix / PASSES-post-fix (`75208e1`).
- **N = 9** (LOW_POWER=False), 0 error pairs. Revival set = {snNkQSyWX4k, m-G1ag77aVc, oDLt9zh33LE} × {MES,MNQ,MCL}.
- **Original-9 disposition RESOLVED:** 9 survive / 3 dropout. The 2 previously-indeterminate MCL pairs both REVIVE
  (snNkQSyWX4k_MCL 0→2484, m-G1ag77aVc_MCL 0→1974). The 3 dropouts are jlShztsY3oA×3 (unrelated profitable ORB).
- **FROZEN ANNOTATION UPGRADED:** `1ab7321`'s demotion finding is now confirmed robust to the framework guards on
  **9 of 9** pairs (was 7/9 with 2 instrument-blocked; the block was Defect 6, now fixed). The guard-less-artifact
  threat is FULLY dead, not merely mostly.
- **FROZEN RULE denominator = N=9 → ≥8/9 classifier revivals + zero unexplained regressions.** Exactly where the
  original freeze started, now on an instrument that earns the number.

## VERDICT STEP (next, per read-order): classifier Gate 3 must RE-RUN on the fixed engine
The prior classifier Gate 3 run (`corpus-v3-gate3-shadow-results-2026-07-05.json`) executed on the PRE-fix engine
(crash-masked / MCL-broken — it's the run that surfaced Defects 1/4/5/6). It is INVALID and stays sealed/quarantined.
The verdict = re-run v2-baseline vs v3-shadow (classifier roles, fixed-atom) on the Defect-4/5/6-fixed engine,
validity-first, then classifier revival count over the N=9 set vs ≥8/9, + regression enumeration for Gate 1′.

## CLASSIFIER GATE 3 VERDICT — CERTIFIED FAIL (independently re-verified 2026-07-06, fixed engine)
Classifier Gate 3 re-run on the Defect-1/4/5/6-fixed engine (`corpus-v3-gate3-shadow-results-2026-07-06.json`,
engine_sha 7c1ec994). Read-order followed: reference (N=9, certified) → validity (PASSED) → verdict.
- **VALIDITY PASSED:** 0 crashes / 0 exceptions / 0 timeouts; all_9_revival_pairs_measurable=true;
  all_v2_traded_pairs_measurable=true; 42/42 per-pair "ok" (independently confirmed).
- **VERDICT (independently recomputed = agent's report):** classifier revival **7 / 9** (rule ≥8/9). The classifier
  reproduces demotion's revival on 7 of the 9 reference strategies: m-G1ag77aVc×3, oDLt9zh33LE×3, snNkQSyWX4k_MES.
  **MISSES: snNkQSyWX4k_MNQ + snNkQSyWX4k_MCL** (the crossover strategy revives under the classifier on MES but not
  MNQ/MCL). **2 misses > the 1-miss allowance → FAILS the revival criterion.**
- **REGRESSIONS: 2** — jlShztsY3oA_MNQ (v2 2424→v3 0) + jlShztsY3oA_MCL (v2 3021→v3 0). (jlShztsY3oA = the
  unrelated already-profitable ORB; the classifier's roles zero it on MNQ/MCL.)
- **5m_support_level (B1) spine non-empty = TRUE** — the bidirectional fix DID cure B1 (under-assignment); the
  classifier gives it a real spine.
- **CERTIFIED VERDICT: Gate 3 FAILS the frozen rule (≥8/9 revival + zero unexplained regressions).** 7/9 revival is
  below the bar. **Per the LOCKED no-relief pre-commitment, this stands — 7/9 < 8/9, no ceiling-relief argument in
  reserve.** The classifier's extraction-time roles reproduce MOST (7/9) but not all of runtime demotion's effect,
  and introduce 2 regressions.
- **CONTRAST (positive, already certified):** runtime demotion itself is **9/9** on the same fixed engine (the
  certified reference). So the WORKING mechanism is runtime demotion (DRI labels applied at runtime); the
  extraction-level classifier is close-but-not-equivalent.
