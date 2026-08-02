# SURVIVOR-FORENSICS PRE-REGISTRATION (Tooth-1 + full protocol) — 2026-07-19 (amended post-red-team, same day)

> **Status: FROZEN if and only if ruling R-070 exists in `ADVISOR-RULINGS.md` naming this file and its content hash.** If R-070 is absent on disk, this document is a DRAFT and binds nothing — the freeze claim is never self-attested. Authored under R-062 #4 ("survivor-forensics logs its hypotheses BEFORE running confirming analyses — anti-rationalization; same law as everything"), BEFORE: any survivor candidate exists · the post-wire DoD binding-approximation distribution is measured · the first real-fidelity battery wave dispatches. That temporal position is the document's entire value.
>
> **Two-path law (binding):** every anchor below is cited to a frozen source; at Tooth-1 build time the working agent RE-VERIFIES each against the artifact on disk before treating it as binding. Frozen sources outrank this document. Advisor verified anchors from disk 2026-07-19; that verification does not transfer — re-derive.
>
> **Red-team record (standing rule, R-062):** a fresh-context adversarial pass ran BEFORE presentation and returned 2 CRITICAL / 7 MAJOR / 1 MINOR findings — all ten accepted and folded into this amended version (see §7). The two CRITICALs would have permitted exactly the false survivor this protocol exists to prevent.

## §0 LOAD-BEARING — THE DEFINITION THIS PROTOCOL RUNS ON (frozen now; it was the gameable hole)

R-042 §5 makes survivor eligibility turn on "load-bearing conditions concretely bound" but no artifact in the pipeline defines or carries the term. Frozen here:

- **DEFAULT: every taught condition is LOAD-BEARING.** A condition is non-load-bearing ONLY by a written per-condition disposition produced at compile time, stating why the taught trade logic survives without it (e.g., narration/commentary, redundant restatement of another bound condition — the disposition names which one). The EXCEPTION carries the paperwork; the rule needs none. This is the conservative direction: over-inclusion makes eligibility harder, never easier.
- **The artifact carries it:** the compiled spec's per-condition records gain a `load_bearing: true|false` field plus `non_lb_disposition` where false. No field → treated as `true`.
- **Leg A verifies the CLASSIFICATION itself, not just the classified:** a taught condition marked non-load-bearing without a disposition, or with a disposition that does not survive reading (Leg B countersign, §1-B), is a FAIL. The party that assigns the label never gets to be the only party that audits it.

## §1 THE QUESTION AND THE FOUR LEGS

A candidate arrives here having passed every battery gate. Forensics answers one question: **did the ENGINE test what the TRADER taught, and is the surviving result attributable to that teaching?** Legs A–C block; D records.

**LEG A — COMPILE-FIDELITY (Tooth-1 proper).** Anchor: R-040 pin 2(iv). Per-condition verdict table over the candidate's spec:
- (i) type-family assignment matches the taught semantics of that condition;
- (ii) **every load-bearing condition (per §0) is concretely bound — `approximation=False` — CATEGORICALLY; no threshold.** The flag is verified against the binding's actual code path, never trusted from the spec record (§4's m4 mutation exists because a mislabeled flag is how this leg gets gamed). **Runtime companion:** because wires fall back per-bar (read-when-present/proxy-when-absent), the static flag is necessary but not sufficient — the candidate's own verdict window must show load-bearing families ran REAL (not fallback) at or above the engagement bar (§2 T1), reported per-family, not only per-spec;
- (iii) polarity/direction preserved, including both-directions/mirror handling per the standing direction law;
- (iv) parameters carry taught values verbatim, or house defaults bearing the provenance stamp (`exit: house-default (trader taught none)` — R-038 pin (b), R-039 §5(c)); an unstamped house value is a FAIL;
- (v) no silent drops: every taught condition present, degraded-with-disposition, or explicitly classified — absent-without-disposition is a FAIL; §0's classification audit rides here;
- (vi) provenance chain unbroken: compiled spec ↔ certificate ID ↔ extraction artifacts (R-038 pin (e)).

**LEG B — FRESH BLIND RE-ADJUDICATION + SPEC COUNTERSIGN.** Anchor: R-037 §3 ("levels all tiers") and R-040 pin 2(iv) — whose assignment is to FRESH EYES, honored here, not moved to same-lane code:
- **Phase 1 (blind):** a fresh reader (vintage pinned per §5) re-reads the candidate's SOURCE VIDEO blind to the certified extraction; the fresh read is SEALED, then compared against the certified extraction via the campaign's established fidelity instruments.
- **Phase 2 (countersign, after Phase 1 seals):** the same fresh reader then receives the compiled spec's per-condition table and countersigns Leg A's semantic rows — (i) typing, (iii) polarity, (v) drops/dispositions, and §0's non-LB dispositions — against what the video taught. This closes the shared-blind-spot risk: compiler and Tooth-1 come from the same lane and heuristic vocabulary; the countersign is the only spec-vs-taught comparison made by eyes that share neither.
- **Transcript independence:** Phase 1 derives its transcript INDEPENDENTLY of the sealed pipeline's cached artifact (fresh fetch). If only the cached transcript exists, that dependency is DISCLOSED in the leg's receipt and the shared-transcript risk carried in the verdict's scope line.
- **Source attrition (pre-committed):** if no independently-derived source access exists at candidacy (video gone, no hash-pinned archive captured at seal time), the candidate is **permanently Leg-B-blocked** — named honest ineligibility. A mirror/re-upload of unverifiable provenance is never an acceptable substitute.
- **Rate-N decoupling:** Leg B re-certification serves CANDIDACY only. It never feeds rate-N by itself — Leg B runs only on battery-passers, so letting it grow N would survivorship-bias the rate upward by construction. Tier-(b) rate-N entry remains the outcome-blind act R-037 §3 defined: a video promotes into N with ALL its strategies' battery outcomes, passes and fails together, or not at all.

**LEG C — ATTRIBUTION (the result belongs to the teaching, not the plumbing).** Four checks:
- **Active-proxy ablation:** for conditions bound to an ACTIVE proxy (`approximation=True` with real discriminating logic — e.g., the EMA fallback, confirmation_native), disable the proxy; if the headline result materially changes (bar below), the proxy was carrying the result → FAIL (proxy-carried).
- **Pass-through accounting (ablation is structurally a NO-OP here — never claim it):** a pass-through binding (`np.ones`) gates nothing; disabling it changes nothing by construction, so no ablation "pass" may ever be cited for it. Instead: every taught condition bound pass-through is enumerated; load-bearing pass-throughs are already dead at Leg A(ii); a NON-load-bearing pass-through must carry its §0 disposition, countersigned in Leg B. A taught condition that is pass-through and disposition-less blocks the candidate.
- **Overlay attribution:** for taught-exit specs, read the pre-registered OVERLAY A/B dual-arm (R-061 §2: house Style-C exits vs taught exits; effective-N tuples distinguish arms). Edge existing ONLY in the house-exit arm → FAIL as survivor (recorded overlay-carried — a different, honest object). House-default-exit specs (taught none) have no A/B; their scope-line carries the provenance stamp instead. If the A/B arm was due (taught-exit spec) and never ran, that is a missing input → fail-closed BLOCK (§3) — schedule it, don't waive it.
- **Engaged-fraction check:** per-spec AND per-load-bearing-family engagement on the candidate's verdict window meets the T1 bar (R-068 §5 made engagement part of the scope-line; this makes it part of the verdict).
- **MATERIALITY (frozen NOW as a relative form — no T1 number needed, no invented constant):** an ablation delta is material iff the headline metric moves by more than that spec's own fold-level dispersion (the walk-forward per-fold standard error already computed by the battery). Self-scaling, identity-blind, derivable from artifacts that exist.

**LEG D — REGIME/SEASON ATTRIBUTION (records, does not block).** Name the regime(s)/session(s) the edge concentrated in — feeds deploy-in-season (R-054 §4 / carried forward under Blueprint v3.1). The DECAY-SLOPE read (OOS-window performance trend — R-054 §4) is RECORDED-NOT-GATED at first candidacy; its promotion to a blocking gate is an intake-scale decision, prospective only.

## §2 THE TEMPORAL FIREWALL (the anti-rationalization core)

- **T0 (now):** this protocol freezes — before any candidate, before the post-wire distribution exists.
- **T1 (named decision point):** AFTER the DoD re-measure lands, BEFORE the first real-fidelity wave's verdicts are read — a ruling sets the numeric bars **using pre-named derivation forms with the arithmetic shown**, from the DoD distribution artifact:
  - **Engagement bar** (per-spec and per-LB-family): a named percentile of the measured engaged-fraction distribution with an absolute floor — percentile and floor chosen in the T1 ruling with the derivation written out, never eyeballed off per-spec identities. The T1 ruling states in one line that no bar was chosen by reasoning about which named spec it passes or fails.
  - **Eligibility screen bar** (the R-042 §5 deferral, honored precisely): R-042 §5's deferred threshold governs the cheap pre-forensics ELIGIBILITY SCREEN — which specs are worth candidacy — over overall binding quality. It never dilutes Leg A(ii), which is categorical on load-bearing conditions. Screen and verdict are different instruments; the screen can be generous, the verdict cannot.
  - **Leg C materiality** needs no T1 number — frozen in §1-C as a relative form.
  - Once the first wave's verdicts are read, the bars are FROZEN for every candidate of that wave.
- **T2 (each candidacy):** before any leg runs, the runner logs the PRE-REGISTERED HYPOTHESES — which legs are expected to pass/fail and why, from the spec's known scope-line — BEFORE the confirming analyses run (R-062 #4 verbatim). Expectation-vs-outcome disagreement is surfaced, never smoothed.
- **RE-ENTRY RATCHET (blocked candidates):** a BLOCKED candidate re-enters only after its named remediation, and faces bars AT LEAST AS STRICT as those in force at its first candidacy — bars never soften for a re-entrant, whatever amendments happened in between.
- **Amendment rule:** before the first candidacy run — by ruling. After it — prospective only, and **the no-feedback clause covers blocked and pending candidates, not just survivors**: an amendment that would change the outcome of any already-judged, blocked, or in-flight candidate does not apply to that candidate. No amendment is motivated by, or timed to, a known candidate's situation — the amending ruling states this affirmatively.
- **The survivor list — and the blocked list — NEVER feed back into the bars.** No threshold moves because of who it would pass or fail. This sentence is the document.

## §3 BLOCK/PASS SEMANTICS (pre-registered)

- **Leg A fail → BLOCK.** Spec returns to the wiring queue with the failing family named. Not a demotion of the strategy — a statement that the engine has not yet tested it.
- **Leg B fail → BLOCK + READER-ESCAPE ALARM** (feeds the R-062 #3 vintage question; handled before further candidacies from that vintage). Permanent Leg-B-block per §1-B attrition rule is its own named terminal state.
- **Leg C fail → BLOCK,** dispositioned honestly: proxy-carried / overlay-carried / under-engaged / pass-through-undispositioned. Each names its remediation (re-run post-wire; taught-exit arm; re-run with pre-window warmup seeding; produce the disposition and re-enter under the ratchet).
- **Leg D → records into the scope-line.** Cannot block at first candidacy (pre-registered).
- **FAIL-CLOSED:** a leg that cannot run (missing artifact, missing data, missing due A/B arm) is a BLOCK, never a skip — the tooth2 law applied to the forensics gate itself.
- **Every run writes the conditional gate-class ledger row** (R-042 §2; reserved slot `passage_ledger.py:107-110`), pass or fail, with per-leg receipts. Absence on non-candidates is expected (conditional class); absence on a candidate is an alarm.
- **PASS = all blocking legs pass → ROBUST SURVIVOR,** scope-line carrying: tier + certificate class (R-037 §3), approximation profile, per-family engaged fractions, overlay disposition, regime attribution, and any disclosed Leg-B transcript dependency.

## §4 CALIBRATION BATTERY (the can-this-detector-lie audit — required before first live use)

Anchor: the R-065 doctrine and the Blueprint Phase-1 exit condition — **R-055 §5** ("Phase 1 completes when ≥1 tier-A spec compiles with ALL load-bearing conditions concretely bound AND the compile-fidelity forensics gate passes calibration"), carried forward under Blueprint v3.1 (confirmed in R-070). This battery IS that calibration:
- A known-good spec must PASS whole.
- Grader-authored mutations (doer≠grader — the gate's builder does not author them; the tooth2 precedent), each of which Tooth-1 must CONVICT:
  - **m1** mis-typed family (taught structure condition typed as filter);
  - **m2** silently-dropped taught condition;
  - **m3** flipped polarity/direction;
  - **m4** proxy-bound load-bearing condition MISLABELED `approximation=False` — the false-flag case (AR-063's defect class, now a permanent fixture);
  - **m5** house-default exit missing its provenance stamp;
  - **m6** broken spec↔certificate chain;
  - **m7** taught condition mislabeled non-load-bearing WITHOUT a disposition (§0's gameable seam, made a fixture).
- Every mutation-conviction test carries its ANTI-VACUITY COMPANION (house pattern, R-069 §2): prove the test distinguishes the mutant from the clean spec.
- Independent grade of the gate build includes re-running this battery from the grader's own hands.

## §5 HONEST NEGATIVE SPACE (decided later, on purpose — decider and trigger named)

- **Numeric bars** (engagement per-spec/per-family; eligibility screen): T1, by ruling, pre-named forms, arithmetic shown.
- **Leg B reader vintage:** pinned by ruling BEFORE the first candidacy run, informed by the R-062 #3 cross-audit; never chosen per-candidate.
- **Decay-slope gating bar:** intake-scale, prospective (R-054 §4).
- **RETEST / full-CONFIRMATION families:** deferred builds (packet §4); with §0's default, a spec whose taught logic load-bears on those families cannot pass Leg A(ii) until the builds land — no forensics workaround exists or will be granted.
- This document touches nothing sealed: the 77 stay sealed; H1 is closed and not reopened by any leg here.

## §6 OWNERSHIP + SEQUENCE

Tooth-1 (Leg A + §4 battery) is built by the working agent AFTER the binding-primitives packet lands and BEFORE first survivor candidacy (packet §SEQUENCE — the frozen order). The build ships under its own ratify packet referencing THIS document; the independent grade includes §4. Legs B–D are protocol (dispatch + read + ledger), not new engine code — standing conductor discipline. The passage-ledger RESERVED slot is replaced by the real invocation site at build time; the gate-class annotation stays `conditional: expected only at survivor candidacy` (R-042 §2). The `load_bearing` field (§0) lands with the Tooth-1 build or earlier — it is a spec-artifact addition, not an engine change.

## §6a ★ AMENDMENT 1 (2026-07-20, R-082 §4 — pre-first-candidacy, permitted by §2's amendment rule)

**T1 may not set bars from `binding_approximation_rate` alone.** Advisor-side ceiling census (R-082, two-path verification ordered) established that the rate is computed over EXECUTED-BINDABLE conditions only — so a taught condition the compiler could not bind at all does not appear as approximated, it VANISHES from the denominator (measured: 26 of 155 conditions, 16.8%, across 10 of 16 shakedown specs; worst case 7 of 19). Perverse consequence: a spec's score can improve by having MORE conditions the engine cannot bind.

Binding on T1 and on every fidelity read that feeds it:
- The artifact reports the **UNBOUND COUNT alongside the rate**, and preferably a third number — **taught-condition coverage = bound-and-concrete ÷ ALL taught conditions** (denominator = every extracted condition, nothing dropped).
- The **§2 T1 derivation forms consume the coverage-honest figures**, not the bindable-only rate.
- This composes with §0 (default-load-bearing) and Leg A(v) (no silent drops): an unbound taught condition is an UNENFORCED taught condition and is treated as such at candidacy — never as a neutral absence.

Amendment made BEFORE any candidate exists and BEFORE T1 runs; no candidate's outcome was known or knowable when it was written. Freeze re-pinned at the new content hash in R-082.

## §7 RED-TEAM DISPOSITION RECORD (all ten folded)

1. CRIT load-bearing undefined/unassigned → §0 frozen (default-LB, disposition-carrying exceptions, classification audited, m7 fixture).
2. CRIT pass-through ablation is a no-op → §1-C restructured (active-proxy vs pass-through accounting; no vacuous "pass" claimable).
3. MAJ freeze anchor self-attested → header now conditions freeze on R-070 existing with content hash.
4. MAJ mis-citations (Phase-1 gate is R-055 §5; decay-slope/deploy-in-season is R-054 §4, not R-061) → corrected throughout; R-070 confirms carry-forward under v3.1.
5. MAJ A(ii)-categorical vs T1-threshold contradiction + static flag vs per-bar fallback → §2 T1 re-scoped (screen vs verdict); A(ii) runtime companion added.
6. MAJ T1 lacks derivation rules; materiality under-determined → pre-named forms + arithmetic-shown + identity-blind statement; materiality frozen as relative form.
7. MAJ no re-entry rule; threshold-shopping via prospective amendments → re-entry ratchet + no-feedback extended to blocked/pending.
8. MAJ no fresh eyes on spec-vs-taught → Leg B Phase-2 countersign (post-seal), restoring R-040 pin 2(iv)'s actual assignment.
9. MAJ tier-(b) rate-N via Leg B is survivorship-selected → rate-N decoupled; outcome-blind entry preserved.
10. MIN source attrition + transcript provenance → pre-committed attrition rule (permanent block; no unverifiable mirrors) + independent-transcript requirement with disclosed-dependency fallback.

*Authored by the money-path advisor (Fable) under R-062 #4; frozen at R-070 (see header condition). Red-teamed pre-presentation per the standing rule. Amendments per §2.*
