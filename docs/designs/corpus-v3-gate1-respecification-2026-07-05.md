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

## GATE 3 FAIL — MILESTONE FREEZE + 3 framing corrections (Fable-5, 2026-07-06)
The Gate 3 FAIL (7/9 vs ≥8/9, no relief) is CERTIFIED and STANDS. Three corrections to my write-up framing, locked:

**Correction 1 — "demotion certified 9/9 as the working mechanism" OVERSTATED (retracted).** The reference
re-derivation was a YARDSTICK (it established N so the classifier had an honest denominator) — NOT a certification
of demotion-as-a-production-mechanism. A single run can't be both the yardstick and a certified result (the
yardstick can't certify itself). **What is TRUE + freezable:** runtime demotion revives **9/9 on the corrected
engine**, confirming + extending `1ab7321` (7/9 last cycle → 9/9 now with the MCL pairs resolved). That is the
mechanism-level answer to the corpus collapse — real, bankable. **What is NOT yet true:** "corpus revival is
achievable today via demotion" is a PRODUCTION claim it hasn't earned — runtime demotion applies first-pass
single-rater DRI labels (57.7% inter-rater), covers only the 14 audited concepts, and **has never been through
Gate 1′** (nobody has adjudicated whether DEMOTION's own role changes are transcript-faithful — it escaped that
exam by being the reference, not the candidate). If promoted from yardstick to shipping path, it inherits the
IDENTICAL certification stack the classifier just faced. Otherwise we'd certify the classifier's competitor by
exempting it from the exam the classifier failed.

**Correction 2 — the 2 regressions are PENDING adjudication, NOT characterized.** `jlShztsY3oA` was written as
BOTH "the unrelated already-profitable ORB" AND "likely correctly re-roled" — those can't both stand. The frozen
regression clause: a new death is acceptable ONLY with a specific promoted-spine condition + transcript-anchored
justification. **Gate 1′ adjudicates this — it is not pre-judged here.** If upheld → fidelity corrections (demotion
was keeping a mis-roled strategy alive), regression clause satisfied, score reads differently. If overturned →
real classifier errors. **Structural irony (logged):** if Gate 1′ upholds the jlShztsY3oA re-roling, then on that
strategy it is DEMOTION that is unfaithful to the transcript — the reference beat the classifier on a pair where
the reference was WRONG.

**Correction 3 — the miss pattern is a FINGERPRINT.** `snNkQSyWX4k` revives on MES but not MNQ/MCL — yet the
classifier assigns roles from transcript semantics, which are SYMBOL-INVARIANT. Same spec, same roles, three
symbols, split behavior → the divergence is almost certainly NOT "classifier misread the transcript on MNQ"; it's
that the classifier's role set differs from demotion's by a condition whose behavioral consequence only binds on
MNQ/MCL (tick size / vol regime / session microstructure × a guard). Checkable in MINUTES (tower-free): diff the
role assignments (classifier vs demotion) on snNkQSyWX4k + jlShztsY3oA, isolate the differing condition(s) → know
whether it's one condition's semantics (Gate 1′ adjudicates) or a genuine symbol-conditional structure the
extraction layer can't express (architecture-boundary finding, kin to B2).

**SEQUENCING (next session's openers):** (1) freeze THIS milestone [done]. (2) role-diff analysis (classifier vs
demotion roles on snNkQSyWX4k + jlShztsY3oA — cheap, tower-free). (3) **Gate 1′ on all FOUR deltas** (2 misses +
2 regressions) — it was always the 2nd leg of the AND; a Gate 3 FAIL does NOT cancel it (its output is the
diagnosis the path-forward needs). (4) Path-forward (iterate classifier / productionize demotion-through-full-cert
/ hybrid) is OPEN but MALFORMED until Gate 1′ reports — every branch's cost-benefit turns on whether the 4 deltas
are classifier errors or classifier corrections.

**Integrity note for the record:** this chain survived six instrument defects (run_class_backtest sibling-parity),
a rate-limited agent death, a power outage + git-ref corruption, and a near-miss verdict — with zero laundered
numbers. The no-relief line held on a 7/9 near-miss. The system reported against itself at every fork.

## ROLE-DIFF ANALYSIS (Fable-5 Correction 3 resolved — condition-semantics, NOT symbol-structure) 2026-07-06
Diffed classifier (v3-shadow) vs demotion-effective (v2 role, DRI-CONTEXTUAL→context) roles on the 4-delta concepts.
**Both deltas: the classifier assigned ZERO spine** (over-contextualized); demotion retained the v2 spine minus CONTEXTUAL.
- **`snNkQSyWX4k` (2 MISSES):** classifier moved 7 v2-spine conditions to `context`, INCLUDING **4 the DRI gold marks
  `JUSTIFIED_MANDATORY`** (candles-retest, us-session, price-retest, consolidation) + 3 UNRESOLVED. Demotion kept them
  spine. → Divergence = classifier mis-demoting GOLD GATES → looks like CLASSIFIER ERRORS (consistent with Gate 1's
  ~67% margin accuracy). Gate 1′ adjudicates: if the transcript-mandatory reading is upheld, the misses are classifier mistakes.
- **`jlShztsY3oA` (2 REGRESSIONS):** classifier moved 3 v2-spine conditions to `context` — 2 `OPTIONAL` + 1 UNRESOLVED
  (NOT mandatory). Demotion kept them spine. → The classifier's demotion is DEFENSIBLE (optional ≠ gate); the kill is
  either a fidelity correction (demotion over-kept a soft-gated strategy) OR over-demotion. Genuine coin-in-air for Gate 1′.
- **NOT the architecture-boundary case:** roles are symbol-invariant; the divergence is WHICH conditions are gates
  (semantics, adjudicable) — not a symbol-conditional structure the extraction layer can't express. Gate 1′ is the
  right + sufficient next instrument. The MES-vs-MNQ/MCL symbol split is a secondary execution effect of the shared
  0-spine role set, downstream of the role divergence.
**→ Gate 1′ target sharpened:** adjudicate whether the DIFFERING conditions are transcript-mandatory gates —
snNkQSyWX4k's 4 JUSTIFIED_MANDATORY (upheld → classifier erred) + jlShztsY3oA's OPTIONAL/UNRESOLVED (if genuinely
optional → classifier's kill is a fidelity correction, demotion the unfaithful one — the structural irony realized).

## GATE 1′ ADJUDICATION — DIAGNOSED (2026-07-06, load-bearing anchors independently re-verified)
Gate 1′ multi-pass transcript adjudication of the 10 differing conditions (+ parent independent anchor re-verify).
**INDEPENDENCE CAVEAT:** the adjudication was a two-pass SELF adjudication (single session, 2nd pass adversarial),
NOT a fully-independent second rater — a CLAIM, not certification. BUT the parent independently re-verified the
load-bearing transcript anchors (below), and the top-level dispositions are robust to the 4 self-disagreements.
- **MISSES (snNkQSyWX4k_MNQ + MCL) = CLASSIFIER ERROR (verified).** The classifier moved the LITERAL ENTRY TRIGGER
  to context: transcript "candles retest one or both of the averages... **that is our signal to sell**" +
  "price came back down right here to retest the average **so that is our entry**"; plus consolidation avoid-rule
  "we're **not doing anything during consolidation**." 3 of 7 conditions confirm mandatory-gate → classifier
  under-assigned real gates (most seriously the entry trigger). (Side: even DRI gold's "us session"
  JUSTIFIED_MANDATORY was OVERTURNED — "I only trade us session... you want to practice at different sessions" =
  personal habit, not requirement — gold is not immune to doer≠grader either.)
- **REGRESSIONS (jlShztsY3oA_MNQ + MCL) = FIDELITY CORRECTION (verified).** 0 of 3 conditions mandatory (all
  OPTIONAL/UNRESOLVED); the transcript calls the naive ORB "'n vals strategie ... die meeste handelaars verloor
  geld daarmee" (a false strategy most traders lose money with) and frames fibonacci/structure as improvement
  SUGGESTIONS. Classifier's context assignment is FAITHFUL → the death is a correct fidelity kill → **regression
  clause SATISFIED (zero unexplained regressions).** STRUCTURAL IRONY REALIZED: demotion (the N=9 reference) is the
  transcript-UNFAITHFUL arm on these pairs (kept soft conditions as hard gates).

## FINAL GATE 3 DISPOSITION (fully diagnosed)
- **Revival 7/9 < 8/9 → Gate 3 FAILS** (stands, no relief). The 2 misses are REAL classifier errors (verified),
  not adjudicable away.
- **Regression clause SATISFIED** (2 regressions = fidelity corrections, upheld).
- **Root cause DIAGNOSED:** the classifier OVER-CONTEXTUALIZES — it moves genuine gates (incl. the literal entry
  trigger) to context. Specific + FIXABLE, consistent with Gate 1's ~67% margin accuracy. The classifier is close
  (7/9) and MORE transcript-faithful than demotion on jlShztsY3oA. Demotion is NOT clearly better (over-keeps; never
  went through Gate 1′; single-rater labels).

## PATH-FORWARD (now well-formed)
Recommended: **ITERATE THE CLASSIFIER** — the fix is diagnosed: stop over-contextualizing entry-trigger/gate
conditions (keep WAIT_CONFIRMATION "retest→signal" type as spine). On snNkQSyWX4k, restoring the entry trigger to
spine would likely revive MNQ/MCL → 8-9/9. Alternatives (productionize demotion / hybrid) are weaker given demotion
is the less-faithful arm where they differ. OPEN for operator/advisor ruling.

## ⚠ b4812c5 RE-MARKED PROVISIONAL — Gate 1′ ran ≠ Gate 1′ locked (Fable-5, 2026-07-06)
The Gate 1′ that ran was a TWO-PASS SELF adjudication (passes disagreed 4/10) + parent anchor spot-check. The
LOCKED Gate 1′ specified MULTI-RATER independent adjudication — the whole reason it exists is that single-rater
labels at 57.7% were what made Gate 1 uncertifiable. **Disclosure does not downgrade a requirement.** Also: the
parent's anchor re-verify made the parent the second rater — doer≠grader strained (the certifier supplied the
independence). **The Gate 1′ dispositions in this doc are PROVISIONAL until one genuinely INDEPENDENT rater
(fresh context; NO classifier output, NO demotion labels, NO DRI gold, NO prior-pass verdicts) blind-adjudicates
the ~10 conditions from transcript quotes alone.** The chain that refused to certify against single-rater gold
does not close on a self-adjudication.
- **Two-sided risk (live both ways):** REGRESSIONS lean on translated Afrikaans speaker-intent — if the framing is
  "naive ORB is false BUT with these additions it works," the fib/structure conditions are mandatory-to-the-FIXED
  strategy and the disposition FLIPS. MISSES feed the iteration design; the fix is a rule from N=2 misses and the
  deterministic rules already overfit 2.00× — a rule that only moves the 2 known misses is memorization.
- **CORRECTION to the record:** STRIKE "demotion is the less-faithful arm" as a GENERAL claim — established on ONE
  strategy (jlShztsY3oA), and only IF the independent rater upholds it. What is certified about demotion:
  mechanism-level revival 9/9 on the corrected engine; transcript-fidelity UNEXAMINED (it never went through
  Gate 1′), except where it lost to the classifier once (pending confirmation). The comparison table has ONE row.

## ITERATION PROTOCOL (LOCKED before any classifier code — Fable-5)
1. **INDEPENDENT RATER FIRST.** If misses hold as errors + regressions as corrections → proceed. If either FLIPS →
   the design input changes; know before writing the fix.
2. **Fix designed against the RULES-DESIGN set (143), NOT against snNkQSyWX4k.** Implement the
   "wait-for/retest/trigger → gate" pattern; measure on the HELD-OUT 70 BEFORE any Gate 3 re-run: (a) held-out
   margin agreement improves-or-holds, (b) rule-coverage overfit ratio stays sane. A fix that only moves the 2
   known misses = memorization wearing a rule's clothes → rejected.
3. **Gate 3 re-run = SINGLE-SHOT** vs certified N=9, frozen ≥8/9 + zero unexplained regressions (jlShztsY3oA deaths
   count explained ONLY if the independent rater upheld them). Same validity-before-verdict read order.
   **PRE-COMMIT: if the iterated classifier returns 7/9 with a DIFFERENT miss pattern → NOT "one more iteration" →
   evidence the ~67% margin ceiling binds at the strategy level → the decision REOPENS honestly.**
4. **ITERATION BUDGET: this is pass TWO of TWO.** A third pass requires NEW EVIDENCE about why the margin is hard,
   NOT another targeted rule. Locked now, while the temptation is invisible.

## GATE 1′ CERTIFIED (independent blind rater ran — PROVISIONAL LIFTED) 2026-07-06
Independent blind rater (fresh context; NO classifier/demotion/gold/prior-verdict access; transcripts only) adjudicated
the 10 conditions. Parent independently verified the load-bearing Afrikaans anchor (line 33). The multi-rater
requirement is now MET → the PROVISIONAL mark on the Gate 1′ dispositions is LIFTED, with ONE correction:

- **MISSES (snNkQSyWX4k) = CLASSIFIER ERROR — CONFIRMED (both raters agree).** Independent rater: #1 candle-close,
  #2 candles-retest, #5 price-retest, #7 consolidation = MANDATORY_GATE (the entry trigger + avoid-rule). Classifier
  put all in context. (#4 us-session independently = CONTEXTUAL, confirming even DRI gold's JUSTIFIED_MANDATORY there
  was wrong.)
- **REGRESSIONS (jlShztsY3oA) = FLIPPED: CLASSIFIER ERROR, not fidelity correction.** The independent rater read the
  Afrikaans framing correctly — "dit benodig net meer konteks hier is hoe om dit reg te stel" ("it just needs more
  context, here's how to FIX it") = false-in-naive-form-BUT-viable-WITH-additions, NOT a disavowal. So Fibonacci (#9)
  sits in the flat "how to fix it" list → **MANDATORY_GATE**. The classifier moved it to context = ERROR. (#8
  structure = OPTIONAL via "selfs/even add"; #10 tendency-line = CONTEXTUAL narrated example.)
  **The self-adjudication's "fidelity correction" + "structural irony (demotion unfaithful)" claims are RETRACTED.**
  On jlShztsY3oA, demotion keeping Fibonacci as spine was CORRECT; the classifier dropping it was the error — demotion
  was the MORE faithful arm here (still ONE strategy; demotion's general fidelity remains unexamined).

## CORRECTED FINAL DIAGNOSIS (certified)
- **Gate 3 FAILS** on BOTH clauses now: revival 7/9 < 8/9 AND the 2 jlShztsY3oA regressions are UNEXPLAINED (classifier
  dropped a mandatory gate, not a justified promotion). Certified, no relief.
- **UNIFORM failure mode (all 4 deltas):** the classifier OVER-CONTEXTUALIZES real gates — the entry trigger +
  consolidation avoid-rule (snNkQSyWX4k) and the Fibonacci fix-gate (jlShztsY3oA). Diagnosis is CLEANER and STRONGER
  (one mechanism, 4 examples) than the pre-flip split.
- **Fix direction CONFIRMED + strengthened** (iterate the classifier to stop over-contextualizing gates). The flip
  changed the framing (both deltas are the same error; demotion faithful on the one pair they differ), NOT the fix.
- **Iteration protocol point 1 satisfied:** misses HOLD as errors → proceed. The regression flip strengthens rather
  than blocks (still a classifier error to fix), but the design must generalize from the 143 — Fibonacci is a
  confirming example, NOT a design input.

## ITERATED CLASSIFIER GATE 3 — CERTIFIED (2026-07-06, single-shot, recovered from 2 infra deaths)
Single-shot iterated Gate 3 (classifier fix `15abe2d`) survived a rate-limit agent death (specs re-emitted OK) +
a tower freeze at 39/42 (Option-A resume of 3 concepts, harness crashed on the filter's KeyError but ALL pairs
backtested — verdict hand-assembled from both logs, deterministic per-pair backtester stdout; parent-recomputed).
- **VALIDITY (read first): 42/42 pairs measurable, 0 None, all 9 reference pairs clean.** The pre-fix
  `sVkmZklJDHI_MES` `None` was a TRANSIENT (fresh run: v2=3309) — not an engine fault. Resolved.
- **REVIVAL: 9/9** (rule ≥8/9). ALL reference pairs revive under the iterated classifier: snNkQSyWX4k (0→2809/2396/2977),
  m-G1ag77aVc (0→1230/1036/2314), oDLt9zh33LE (0→2856/2455/2926). **The 2 snNkQSyWX4k target misses are FIXED
  (7/9→9/9)** — the entry-trigger escalation worked exactly as designed + validated (held-out margin improved, not memorized).
- **REGRESSIONS: 2, STILL UNEXPLAINED — `jlShztsY3oA` MNQ/MCL (2424→0, 3021→0).** Verified: iterated jlShztsY3oA
  spine count PRE=0 → ITERATED=0; **Fibonacci retracement level is STILL `context`** (the fix's wait-for/retest/trigger
  pattern does NOT match retracement-level language). Per the certified Gate 1′ (independent rater), Fibonacci is a
  MANDATORY gate the classifier wrongly demoted → these deaths remain CLASSIFIER ERRORS = UNEXPLAINED regressions.
- **CERTIFIED VERDICT: Gate 3 FAILS.** Frozen rule = ≥8/9 revival AND zero unexplained regressions (AND, no relief).
  9/9 revival PASSES; 2 unexplained regressions FAIL → the AND fails. 9/9 does NOT rescue it — no relief for a passing
  revival when the regression clause fails.
- **REFINED DIAGNOSIS (the genuinely new evidence):** the classifier over-contextualizes ≥2 DISTINCT gate sub-classes.
  Pass-2 cured sub-class 1 (entry-trigger/retest → snNkQSyWX4k 9/9). Sub-class 2 (retracement-level gates → jlShztsY3oA
  Fibonacci) is UNTOUCHED. Fixing one gate-class does not fix the other — a scope finding, not a margin-ceiling finding.
- **ITERATION BUDGET / path-forward (operator+advisor decision):** pass 2 of 2 spent. The pre-commit forbade a 3rd
  targeted rule "without new evidence about why the margin is hard." The 2nd gate-class discovery is arguably that new
  evidence (a scope-refinement, distinct from the pre-committed 7/9-margin-ceiling-reopen which did NOT occur — revival
  is 9/9). Open branches: (a) scoped pass-3 extending the pattern to retracement/level gates [needs advisor ruling on
  whether that's "new evidence" or budget-violation]; (b) accept Gate 3 FAIL, productionize the revival win separately;
  (c) reopen on gold-quality/architecture. Malformed to pick until the advisor rules on the budget question.

## ★★ INTEGRITY FINDING (FROZEN) — the independent rater INVERTED the verdict, not refined it (2026-07-06)
The most consequential integrity event of the chain, surfaced from where it was buried ("per the certified Gate 1′"):
- **Provisional self-adjudication** ruled the jlShztsY3oA regressions FIDELITY CORRECTIONS. Under THAT disposition,
  the iterated run = 9/9 revival + EXPLAINED regressions → **Gate 3 PASSES.**
- **Certified independent rater** ruled Fibonacci MANDATORY → the regressions are classifier errors → **Gate 3 FAILS.**
- The cheap (hours-not-days) blind rater did not refine the answer — **it INVERTED it.** Without it, this program
  would have announced a FALSE CERTIFICATION of a classifier that demotes mandatory gates. **Independence was not
  procedural hygiene; it was the difference between a true FAIL and a false PASS.** Freeze as a standalone
  methodological finding.
- **Verbatim rater rationale (the reading the verdict turned on), recorded because a verdict-deciding adjudication
  owes the record its why:** framing is "false in naive/retail form BUT viable WITH specific additions," NOT a
  disavowal. Decisive lines — "die kleinhandel is die meeste van die tyd 'n vals strategie" (the retail version is a
  false strategy most of the time — indicts the naive application, not the concept); **"dit beteken nie dat die bol
  nutteloos is nie, dit benodig net meer konteks"** (this doesn't mean the ORB is useless, it just needs more context
  — the PIVOT that rejects "disavowed, period"); **"hier is hoe om dit reg te stel"** (here's how to fix it — frames
  what follows as the required fix). Fibonacci sits in that fix-list: "gereedskap soos Fibonacci te gebruik, gaan jou
  uit hierdie nuttelose ambagte hou" (using tools like Fibonacci will keep you out of these useless trades) → MANDATORY.
- **COROLLARY (permanent inversion):** "the classifier was the more faithful arm" (struck provisionally earlier) is
  now PERMANENTLY INVERTED — where the arms disagreed and adjudication is certified, the CLASSIFIER was wrong.

## PASS-3 LICENSED — escape clause fires (Fable-5 ruling, counterargument faced)
The sub-class finding ALONE would NOT license pass-3 (every miss can be christened a sub-class → infinite taxonomy,
one-rule-per-funeral = the whack-a-mole the budget forbids). What carries the license is the CONJUNCTION:
1. Pass-2's held-out margin IMPROVED — direct counter-evidence to the 2.00× memorization fear that motivated the
   budget; pattern-class rules generalize.
2. The pre-registered ceiling-binding trigger (7/9 with a SHIFTED miss pattern) did NOT fire — the miss set did not
   shift, it SHRANK, and the residue PREDATES pass-2.
3. The residue is certified-diagnosed with transcript anchors — the highest-grade gold this program owns.
Together = genuine evidence the margin is COVERAGE-structured (enumerable idiom families), not noise-structured.
**Honest dependency:** the license leans on the held-out improvement + the certified diagnosis, NOT the 9/9 — same
ruling at 8/9; OPPOSITE ruling had held-out degraded. **Branch (c) NOT indicated** (coverage gap with clean anchors,
not gold-noise; Gate 1′ is the gold-quality instrument and it is working).

## PASS-3 PRE-REGISTRATION (LOCKED before any code — Fable-5)
1. **Verify the held-out-improvement claim INDEPENDENTLY** — the ruling is CONDITIONAL on it; currently self-reported.
2. **Design-input quarantine.** FIRST enumerate retracement/level idioms in the 143-condition DESIGN set; design the
   rule from THOSE. **jlShztsY3oA's 3 conditions are EXCLUDED from design inputs — they are the TEST.** If the design
   set contains ZERO instances → STOP + ESCALATE (quarantine impossible; restate epistemics before writing anything).
3. **Pass-2's rule is FROZEN.** Additive coverage only; NO joint re-tuning.
4. **Same tripwire:** held-out margin improves-or-holds, checked BEFORE any Gate 3 dispatch.
5. **Single-shot Gate 3, frozen rule, validity-before-verdict.** The regression's cure is BEHAVIORAL not explanatory —
   certified adjudication says Fibonacci is mandatory, so a CORRECT classifier REVIVES jlShztsY3oA; its death cannot
   be explained, only fixed.
6. **The escape is SPENT.** If pass-3 fails Gate 3 for ANY reason → the classifier-iteration track CLOSES →
   pre-committed landing = (b) productionize DEMOTION on its own cert track (which it still owes: it has NEVER passed a
   fidelity adjudication and covers only 14 concepts). NO pass-4 argument entertained. Written now, while pass-3 looks
   promising and the temptation is invisible.
7. **Reuse named honestly:** this is the 3rd adaptive evaluation against the SAME 9 pairs; Gate 3's independence DECAYS
   each pass. The genuinely fresh data is the post-flip corpus re-baseline (null-cal → Mode A/B); any anomaly there
   REOPENS certification.

## PASS-3 ENUMERATION (pre-reg point 2) — quarantine POSSIBLE, launch clean (2026-07-06)
Retracement/level idioms in the 143-condition DESIGN set (jlShztsY3oA's 3 conditions EXCLUDED = the test):
- **Focused (fib/retracement/premium-discount): 4 (2 JUSTIFIED_MANDATORY, 2 CONTEXTUAL).**
- **Broad (+level/support/resistance/zone/retest): 36 (14 JUSTIFIED_MANDATORY, 14 CONTEXTUAL, 4 UNRESOLVED, 3 OPTIONAL, 1 ALTERNATIVE).**
- **NON-ZERO → the pre-registered STOP+ESCALATE trigger does NOT fire → pass-3 launches CLEAN.** The rule can be
  designed from design-set retracement/level-gate instances (incl. mandatory ones), jlShztsY3oA held as the test.
- **INTEGRITY (self-caught near-miss):** the first 2 enumeration passes returned 0 — a JOIN BUG (split key format is
  `video||condition_id`, matched on bare `condition_id`). Caught by an implausibility check (a trading corpus cannot
  have 0 level/retest idioms), not trusted. Same discipline as the rater flip: verify decision-gating numbers; a
  false-0 here would have triggered a false escalate. Fixed join → 143/143 rows matched → real count above.
- **REMAINING pre-reg gate before rule code:** point-1 independent verification of the pass-2 held-out-improvement
  (67.24%→67.92% margin, 2.00×→1.70× overfit) — currently parent-recomputed from the pass-2 agent's heldout-result.json
  artifact; a fully-fresh re-measurement (live gemma) is the stronger independence and is the next gate. Design-instance
  vetting (confirm the 4 focused matches are genuine retracement-level GATES, not loose quote-matches) happens during
  rule design.

## PASS-3 DETERMINISM ENVELOPE (pre-reg point 1 comparison rule — PINNED tonight, before the fresh run lands)
The independent held-out re-measurement uses LIVE GEMMA on the margin stratum; the frozen nondeterminism finding
(gemma is NOT run-to-run deterministic at temp 0.1) means the comparison rule MUST be pinned now, not improvised
when the number lands. **CONFIRM iff ALL three hold:**
1. **Deterministic rule-covered stratum: EXACT (bit-identical) reproduction** vs pass-2. The rules are deterministic —
   ANY diff means a broken instrument → STOP-AND-DIAGNOSE, not a pass/fail on the number.
2. **Gemma margin point estimate within ±3.0 pp of pass-2's 67.92%** (band = [64.92%, 70.92%]).
3. **Directional verdicts BOTH hold:** (a) margin improved-or-held = fresh margin point ≥ 66.24% (pass-1 67.24% − 1pp
   noise floor); (b) overfit ratio ≤ 1.85× (pass-2 1.70× + 0.15 tolerance).
**Outside ANY of the three = STOP-AND-DIAGNOSE.** Record BOTH numbers; do NOT pick-the-better-run. An out-of-band
gemma margin is NOT automatically a pass-2 indictment — it may be the nondeterminism finding getting its number —
but it is a stop, never a shop. Rule-covered EXACT-diff is always a broken-instrument stop.
**Enumeration frozen as data:** `docs/replay-results/corpus-v3-pass3-enumeration-frozen-2026-07-06.json` (focused 4 /
broad 36, matched conditions, vetting-PENDING on the 4). Pass-3's rule design provably draws only from this
pre-enumerated set — the quarantine is only as good as the timestamp on the fence.
**Standing order (fatigue = instrument-validity problem, not a virtue test):** anything the pre-reg does not cover
gets WRITTEN DOWN AND PARKED, never resolved on the spot. Point 1 is the load-bearing gate for the whole pass-3
license; a claim conditionally accepted because everyone's tired defeats the purpose of making the ruling conditional.

## PASS-3 VETTING FINDING — PARKED for fresh eyes (standing order applied, 2026-07-07 ~00:xx)
Vetted the frozen design-set retracement/level instances (transcript anchors, design-side, quarantine-safe):
- **The 4 FOCUSED:** 2 JUSTIFIED_MANDATORY (HfZTCZTDfWk "wait for a retrace back to the 5 SMA" ×2) are genuine gates
  but **IMPERATIVE** ("wait for a retrace") — pass-2's rule ALREADY fires on this language. 2 CONTEXTUAL ("cross down
  and retrace" = narration; "retracement opportunity" = soft "looking for") correctly contextual.
- **BROAD-set mandatory (14):** predominantly IMPERATIVE retest/tap gates — "waiting for price to... retest it as
  resistance before we can", "as soon as the key level is tapped", "wait for the market to retest that high or low",
  "wait for that retest into that fair value gap". Pass-2 covers this "wait-for/retest/as-soon-as" family.
- **jlShztsY3oA's Fibonacci is DESCRIPTIVE/PREDICTIVE** — "price WILL LIKELY retrace to a Fibonacci retracement level"
  in a "here's how to fix it" list, NO imperative marker. That is WHY pass-2 (imperative-anchored) does not fire on it.
- **THE CRUX (parked, needs fresh eyes):** pass-3's rule must escalate a retracement/level gate stated DESCRIPTIVELY,
  a distinct linguistic sub-pattern from the imperative gates pass-2 covers. **Open question the pre-reg did not
  anticipate:** does the design set contain a CLEAN descriptive-retracement-gate instance to derive that rule from? If
  the design instances are all imperative (covered), a rule drawn "from those instances" would re-cover pass-2 without
  touching jlShztsY3oA — and designing the descriptive-pattern rule would risk drawing from the test (quarantine breach)
  or from thin air. This is a SUBSTANTIVE design call, NOT mechanical → PARKED per the standing order (fatigue corrupts
  improvised judgment; this is improvised judgment). Resolve NEXT session with fresh eyes: re-vet the full broad-36 for
  any descriptive-retracement-gate design instance; if none exists, the quarantine may be effectively empty for THIS
  sub-pattern and the epistemics need restating (a softer sibling of the pre-reg-2 escalate trigger).
- **NOT resolved tonight. NOT drafted tonight.** The held-out re-measurement (pre-reg point 1) continues to grind
  independently; its pinned-rule comparison is mechanical and tired-safe. Rule design waits for morning.

## PASS-3 PRE-REG POINT 1 — CONFIRMED (independent held-out re-measurement, 2026-07-07)
Fresh live-gemma re-measurement (66 real gemma calls, NOT cached) via `tmp/gate-iter/heldout-measure.mts`, compared
against the PASS-2 backup + the PINNED determinism envelope, applied MECHANICALLY:
- (1) rule-covered stratum EXACT: fresh (45,12,54,17) == pass2 (45,12,54,17) — deterministic instrument sound. PASS.
- (2) gemma margin point 67.9245% within ±3pp of 67.92%: delta +0.0000pp. PASS.
- (3a) margin improved-or-held: 67.92% ≥ 66.24%. PASS. (3b) overfit ratio 1.70× ≤ 1.85×. PASS.
- **VERDICT: CONFIRM → pre-reg point 1 CLEARS → the pass-3 license is UNCONDITIONAL.**
- **Transparency (recorded, not hidden):** the fresh run reproduced pass-2 to four decimals (67.9245% both), so the
  ±3pp band was NOT stressed; N=2 gemma runs cannot distinguish "gemma stable on this set" from "band generous." The
  frozen nondeterminism finding stands in general; on THIS 66-call margin set it did not flip aggregate agreement. The
  CONFIRM holds on the pinned rule as written; a 3rd run would stress the band but is not required by the pre-reg.
**STATUS after tonight:** pass-3 pre-reg MECHANICAL gates are complete — point 1 CONFIRMED (license unconditional),
point 2 enumeration done (non-zero, launch clean). The REMAINING pass-3 work is the rule design, which is GATED by the
PARKED imperative-vs-descriptive vetting blocker (fresh-eyes work). No mechanical pass-3 work remains tonight.
