# GATE-RECALIBRATION CHECKPOINTS PRE-REGISTRATION (lifetime effective-N = 200 / 500) — 2026-07-19 (amended post-red-team 2026-07-20)

> **Status: FROZEN if and only if ruling R-072 exists in `ADVISOR-RULINGS.md` naming this file and its content hash.** Absent that, this is a DRAFT binding nothing. Authored under R-062 #2 ("pre-registered re-derivation of the luck-correction thresholds (DSR/PBO/BIF calibration) at lifetime trial counts 200 and 500 — the gates were tuned for a smaller corpus; factory scale must not age them silently").
>
> **Lifetime effective-N at freeze time: 32** (raw 48 = 16 complete-tuple wave-1R groups + 16 incomplete-tuple shakedown-1 singletons, each its own group per R-048 F-2), computed as `TrialCounter.effective_n(wave=None)["effective_n"]` on the canonical counter `docs/replay-results/h1-battery/trial-counter.json`. **Correction on the record:** the pre-red-team draft said 16 — the author conflated the wave-scoped receipt call with the lifetime call, in the very document that governs lifetime counting. The red-team executed the code and caught it (§7 F1). The trigger formula is now pinned BECAUSE that error is reproducible by any future checker who isn't told which call to make.
>
> **Two-path law (binding):** anchors cited to frozen sources; the executing agent RE-VERIFIES each against disk at checkpoint time. Frozen sources outrank this document. File:line facts verified 2026-07-19/20 (advisor + red-team execution); verification does not transfer — re-derive.
>
> **Red-team record (standing rule, R-062):** pre-presentation adversarial pass returned 1 CRITICAL / 3 HIGH / 5 MEDIUM — all nine folded (§7).

## §1 WHAT AGES, AND THE TWO DIFFERENT MULTIPLICITY PROBLEMS (never conflate)

The luck-correction gates answer: "is this result better than what the best of N junk strategies would show by chance?" Their honesty depends on N — and N GROWS for the life of the factory. Two distinct N's:

- **Per-spec multiplicity** — how many times THIS strategy (its paths, folds, its own re-runs/mutations) was sampled. Corrected inside the per-spec gates today: DSR runs at CPCV with `effective_n_trials = max(n_paths, trial_n_total)` under `DSR_USE_NTOTAL=true` default (`walk_forward.py:61-70, :591-604`).
- **Selection pressure** — how many DIFFERENT strategies the campaign has tried when it promotes its best. The honest denominator is the trial counter's **lifetime effective-N** (dedup by spec×engine×dataset×config per R-048 §3; replicates are not new draws). **Acknowledged bias (honest negative space):** this tuple OVERCOUNTS true selection pressure — an engine-SHA re-validation sweep of the same corpus mints new groups without new strategy ideas. The error direction is CONSERVATIVE (over-deflation). Checkpoint derivations MAY therefore stratify by `survivor_eligible` and engine-epoch, arithmetic shown; such stratification is NOT §5 loosening — it is the pre-registered honest path to the true count, and it is the ONLY such path (any other reduction proposal is §5 loosening).

## §2 ★ THE WIRING GAP — NAMED NOW, STATIONED BEFORE FIRST SURVIVOR CANDIDACY (not deferred to N=200)

Verified from disk: `trial_n_total` is the CRITIC-lane cumulative mutation count for one strategy, arriving via engine config with **default 1** (`config.py:662-666`; `parameter_evolver.py:133-147`). The battery lane never sets it. Consequence: **battery-lane DSR deflates for path multiplicity only (~n_paths), carrying zero campaign selection pressure.** The F-4 wiring is real but serves the critic lane's question, not the battery's.

- **The fix's station:** a SELECTION-SIDE deflation check joins survivor candidacy — computed AT candidacy, consuming the trial counter's lifetime effective-N **current as of the candidacy run** (per the §3a epoch boundary; never a stale registration-time snapshot). Implementation is an instrument change in the working agent's lane (own packet + independent grade), stationed WITH or BEFORE the Tooth-1 build and BEFORE first survivor candidacy.
- **Forward-recording stationed with it (F9):** from that build onward, each trial's summary Sharpe rides the counter/ledger row, so the null-distribution inputs accumulate as first-class artifacts instead of being scraped from heterogeneous replay outputs later.
- **Statistical architecture frozen (where each correction lives):** per-spec gates correct per-spec multiplicity — unchanged. SURVIVOR CANDIDACY corrects selection pressure. Neither substitutes for the other; conflating them (inflating every per-spec gate by global N) over-corrects honest specs and is equally wrong.

## §3 CHECKPOINT MECHANICS (frozen)

- **Trigger quantity, pinned exactly:** `TrialCounter.effective_n(wave=None)["effective_n"]` on the canonical counter file `docs/replay-results/h1-battery/trial-counter.json`, incomplete-tuple rows counting as their own groups (R-048 F-2). Every registration check RECORDS: the N observed, the raw_n, the counter-file hash, and the effective-N code identity (file hash of `trial_counter.py`).
- **Projected-N fail-closed (F2):** a wave FAILS registration when `N_at_registration + wave_trial_budget` crosses an un-receipted checkpoint — the wave declares its trial budget (it knows its spec count), and the remedy is AUTO-SPLIT: register the sub-wave that fits under the mark, recalibrate, then register the remainder. No wave may straddle an un-receipted checkpoint by construction.
- **The obligation LATCHES (F3):** the FIRST registration-check observation of `effective_n ≥ checkpoint` (or projected crossing) creates a persistent obligation recorded in the check log; later effective-N DECREASES (e.g., backfill annotation collapsing groups) do NOT un-cross it. Raw_n (append-only, monotone) is co-recorded as the tamper-evident companion; an effective-N that moves DOWN between checks without a named annotation event is itself an alarm.
- **§3a THE EPOCH BOUNDARY (one sentence, F5):** battery EXECUTION and per-spec gate verdicts are epoch-pinned to their wave's registration; **survivor candidacy and promotion transitions ALWAYS run under CURRENT calibration and CURRENT lifetime-N** — no candidate ever gets to choose between the two answers.

## §4 WHAT A CHECKPOINT RE-DERIVES (per gate, arithmetic shown in the receipt)

- **DSR** (`DSR_HONEST_THRESHOLD` default 1.645, `backtester.py:6024`; CPCV DSR per §1): re-derive expected-maximum-Sharpe-under-null at current lifetime effective-N (stratified per §1 if invoked, arithmetic shown) and verify the threshold still separates skill from selection at that N; confirm the §2 selection-side check consumes current N; confirm `DSR_USE_NTOTAL` posture. **Null-distribution inputs (F9):** the per-trial SR summaries recorded per §2 forward-recording; for trials predating that build, the per-wave replay outputs assembled into a hashed input list named in the receipt — the receipt enumerates any unreadable trials rather than silently deriving from a subset.
- **PBO** — thresholds pinned to the ENFORCING code (F8): promotion bar `PBO_PROMOTION_THRESHOLD` default 0.5 (`backtester.py:5967`); wave audit `PBO_OVERFIT_THRESHOLD` default 0.5 (`walk_forward.py:56-59`); **the stricter 0.15 TESTING→SHADOW/PAPER bar lives in `src/server/lib/pbo-gate.ts` (TS side, authoritative; default 0.15)** with the `pbo_gate.py:29-30` docstring as a cross-check that must agree — disagreement is an alarm. PBO's probability semantics are scale-free; what ages is ADEQUACY: partition counts and the CPCV `n_paths` floor (15, proven live when n_paths=14 correctly FAILED in wave-1R) versus corpus window lengths and spec diversity at scale.
- **BIF — baseline PINNED (F4, and the precedent is why):** `src/server/lib/bif-gate.ts`, `BIF_WARN_THRESHOLD` default **2.0**, `BIF_BLOCK_THRESHOLD` default **4.0**, BLOCK posture (not warn-only) — verified from code at freeze. The deepscan-b episode already demonstrated BIF hardening silently reverted once on a false premise; a checkpoint that verifies against "current code" without this recorded baseline would launder exactly that drift. At checkpoint: re-verify current code AGAINST this baseline first, then re-derive adequacy; any divergence from baseline found at checkpoint is a drift alarm predating the checkpoint, handled before recalibration proceeds.
- **Each receipt records:** the N that triggered, every input artifact hash, the arithmetic, resulting posture per gate (UNCHANGED / TIGHTENED / restructured-with-derivation), and two-path signatures (§5).

## §5 ANTI-GAMING LAWS (frozen)

- **Formula-governed, identity-blind:** re-derivations follow the frozen forms with arithmetic shown; the receipt affirms no posture was chosen by reasoning about which pending or anticipated spec it would pass or fail.
- **Direction expectation named:** selection-pressure corrections TIGHTEN monotonically with N by construction. Any re-derivation that would LOOSEN a gate halts the checkpoint and requires an operator-visible ruling to adopt — never silent. §1's pre-registered stratification is the sole exempted reduction path, and it must show its arithmetic.
- **Prospective-only, with the honest bridge (composed with §3a):** per-spec verdicts already read are never regraded; specs still live in the pipeline hit CURRENT calibration at candidacy/promotion (§3a), flagged with which calibration their historical verdicts carried.
- **Two-path derivation:** agent derives; independent grader re-derives blind from the same frozen inputs; disagreement is an alarm, never averaged; advisor ratifies by ruling; operator gets the plain-English line.
- **Amendment law:** this document may not be loosened after the first checkpoint fires; post-fire amendments are prospective to the NEXT checkpoint. **Beyond-500 cadence is CEILINGED now (F7): each subsequent checkpoint lands no later than 2× the N of the last receipt** — a ruling may tighten the cadence, never exceed the ceiling. A schedule is a gate.

## §6 HONEST NEGATIVE SPACE

- Exact E[max-SR] functional forms and threshold arithmetic: derived AT the checkpoint from then-current artifacts, arithmetic in the receipt (pre-guessing them against unknowable corpus shape is the disease this law prevents). The INPUTS are named now (§4-DSR); only the arithmetic waits.
- The §1 stratification option is pre-registered but not pre-computed; invoking it requires showing both the stratified and unstratified numbers.
- Nothing here touches the in-flight WIRE-1 sequence, the frozen forensics pre-registration (`d3665c577347b70c`), or the sealed 77.

## §7 RED-TEAM DISPOSITION RECORD (all nine folded, 2026-07-20)

1. CRIT freeze-time N wrong 2× (16 = wave-scoped call, not lifetime 32) → header corrected visibly; trigger formula + canonical file pinned in §3 precisely because the error is reproducible.
2. HIGH registration-time trigger gamed by unbounded wave size (N=199 mega-wave) → projected-N fail-closed + auto-split (§3).
3. HIGH effective-N non-monotone (backfill can un-cross); nothing latched → obligation latch + raw_n co-record + counter/code hashes per check (§3).
4. HIGH BIF empty IOU (no baseline; drift precedent deepscan-b) → baseline pinned 2.0/4.0/BLOCK from bif-gate.ts; checkpoint verifies against baseline before re-deriving (§4).
5. MED epoch law vs bridge contradiction at candidacy → §3a boundary: execution epoch-pinned; candidacy/promotion always current (§2 snapshot wording also fixed).
6. MED effective-N overcounts true selection pressure; monotone presumption foreclosed correction → §1 acknowledged bias + pre-registered stratification as sole exempt path.
7. MED beyond-500 cadence unbounded (50,000 dodge) → 2× ceiling frozen (§5).
8. MED 0.15 bar anchored to docstring, not enforcing code → repointed to pbo-gate.ts authoritative; docstring demoted to cross-check (§4).
9. MED E[max-SR] inputs not guaranteed to exist → inputs named now + per-trial SR forward-recording stationed with the §2 build; unreadable trials enumerated, never silently dropped (§2/§4).

*Authored by the money-path advisor (Fable) under R-062 #2; frozen at R-072 (see header condition). Amendments per §5.*
