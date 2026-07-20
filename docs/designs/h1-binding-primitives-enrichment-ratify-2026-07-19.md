# BINDING-PRIMITIVES ENRICHMENT — the real fidelity lever. RATIFY PACKET (2026-07-19)

GO'd by **R-043 §2** ("R-042 pin 4 IS the scope — build it now, in parallel with the shakedown"). Scope pins from **R-042 pin 4**. Engine instrument (touches how spec conditions BIND to primitives → changes measured backtest behavior) → own ratify + independent grade, family-by-family. The mission's real bottleneck: today the compiled specs run ~0.99 binding-approximation (near-ungated → LOOSER than taught); this packet moves that number.

## 1. WHAT & WHY NOW — receipts
The spec-condition evaluator substitutes cheap proxies for institutional signals the engine ALREADY computes:
- `SpecConditionStrategy.compute(self, df)` (`spec_condition_compiler.py:563`) receives ONLY the exec-TF frame — no HTF/session/bias context.
- WAIT_BIAS/CONFIRM_DIRECTION bind to an EMA-slope PROXY (`spec_condition_compiler.py:363` `_eval_wait_bias`) instead of `bias_engine.compute_bias`.
- WAIT_STRUCTURE calls `structure_engine.compute_structure_state` (`spec_condition_compiler.py:341`) but with `htf_bars = exec window` (self-referential single-TF) — DEPTH gap, not existence gap.
- The REAL per-bar adapter (`load_n_timeframes` → `htf_cache` → per-bar `compute_session_context`+`compute_bias`) ALREADY RUNS in the eligibility gate (`backtester.py:400-414`, `htf_cache` at `:1195/:1627`, `compute_htf_context` at `:4390`).
Measured consequence: 16/16 compilable specs at ~0.99 binding-approximation (`packet2-inventory-22.json`).

## 2. BLAST RADIUS
- Changes MEASURED backtest behavior for spec-onboarded strategies (the wired families stop passing-through). INVALIDATES no frozen cert (pre-live). The shakedown wave (running in parallel on the pre-wire engine) is honestly labeled framework-measurement — its verdicts were never edge evidence, so a mid-campaign fidelity improvement doesn't corrupt a survivor claim (there are none until post-wire per R-042 §5).
- Downstream: survivor eligibility becomes reachable for structure/bias-bound specs (R-042 §5, computable per-spec).
- Consumed read-only: the evaluators themselves (`structure_engine`, `bias_engine`, `compute_htf_context`, `compute_session_context`, `session_windows`) — this packet WIRES them, never rebuilds them.

## 3. ARCHITECTURE DECISION — GATE-LAYER ROUTE (R-042 pin 4b, decided WITH EVIDENCE)
**Decision: route the real HTF/session/bias signals to the spec-condition bindings via the GATE-LAYER adapter that already computes them, NOT by duplicating multi-TF plumbing into the `SpecConditionStrategy` instance.**
- Evidence FOR: the per-bar HTF/session/bias computation already exists and runs in the eligibility-gate path (`backtester.py:400-414`); `htf_cache` + `load_n_timeframes` + `compute_htf_context` are already threaded there. Re-implementing that inside `compute(df)` would DUPLICATE an audited pipeline (drift liability — the repo's named anti-duplication disease) and require re-plumbing the ≥200-daily-bar / `load_n_timeframes` dependency into every `BaseStrategy` instance.
- The plumbing work-item (concrete): make the real per-bar signal columns (bias sign / structure state / session flags), computed once by the existing adapter, AVAILABLE to the spec-condition bindings — either by precomputing them onto the bars the evaluator reads, or by moving the spec-condition family evaluation to where `htf_cache` is in scope. The DESIGN sub-phase of the FIRST family wire fixes the exact seam WITH a spike (a wired binding that reads the real column vs the proxy) before generalizing — guidance from R-042 pin 4b, confirmed.
- Caveat pinned (scoping honesty): the adapter builds `HTFContext` per-day and needs ≥200 daily bars + `load_n_timeframes(symbol, tfs, start, end)`; the DoD harness must supply real multi-TF data (not the single synthetic exec frame the Packet-2 DoD used) for the wired families to engage. This is the real work item, not a one-line hookup.

## 4. THE EXACT CHANGES, SCOPE-LOCKED (R-042 pin 4a)
- **Plumbing work-item:** thread the existing gate-layer HTF/session/bias per-bar signals to the spec-condition family bindings (gate-layer route, §3).
- **WIRE 1 — WAIT_STRUCTURE / VERIFY_STRUCTURE** (~217 occ, largest): feed `compute_structure_state` a REAL HTF frame (not the self-referential exec window) + honor the condition's object text where a structural object is named; binding `approximation=False` when the real frame is present.
- **WIRE 2 — WAIT_BIAS / CONFIRM_DIRECTION** (~130 occ): replace the EMA-slope proxy with `compute_bias`'s `DailyBiasState.net_bias`/`institutional_regime` sign per bar (via the gate-layer adapter); `approximation=False` when bias context is present.
- **Opportunistic win:** make `confirmation_native.compute_confirmation_signal` the default for WAIT_CONFIRMATION directional correctness (a partial win, still `approximation=True` — NOT a faithfulness claim).
- **DEFERRED with named-owner carry + trigger** (R-042 pin 4a): WAIT_RETEST (rejection-of-a-real-level BUILD) + full WAIT_CONFIRMATION (per-object pattern BUILD) + FILTER's heavier feature-column enrichment — all trigger POST-packet once the wiring pattern is proven. Owner: this working agent.
- **OUT OF SCOPE:** the evaluators' internals; the extractor/reader; the classifier (heuristic stays, R-041); `FAMILY_META` for the deferred families.

## 4b. ★ CAUSALITY LAW FOR MATERIALIZED COLUMNS (R-066 §2 — mandatory, ratified)

Materialized columns are the classic silent LOOK-AHEAD vector: a bar-`t` column
computed using information from bars `> t` (e.g. stamping a SAME-day daily context
onto that day's intraday bars) fake-improves every backtest, and **the error
direction is OPTIMISTIC** — it would make the 0.99's fall look like recovered edge
when it is time-travel. Non-negotiable requirements:

- **DAY-KEY DISCIPLINE (the law the columns ride):** the HTF/daily context visible
  to bar `t` is the **PRIOR COMPLETED period** — never the in-progress one. This is
  the existing mtf_join no-look-ahead law, already implemented in the gate's cache
  build (`backtester.py:4391-4401`): `htf_cache[day_key]` for day `D` is computed
  from `daily_df.slice(0, _day_idx)` (STRICTLY the days before `D`) with
  `current_price = close[_day_idx - 1]` (the prior day's close), and
  `compute_htf_context`'s own contract is "COMPLETED bars only (shift-1 safe)"
  (`htf_context.py:66`). The materialized columns REUSE this exact cache and law —
  they never re-derive a looser one.
- **TRUNCATED-REPLAY CAUSALITY CHECK (required in the spike AND in WIRE-1's grade):**
  for a sample of bars, recompute each column value from data `≤ t` ONLY and
  **BYTE-MATCH** it against the materialized value (the pattern that validated
  breaker/unicorn). A column value must be a provable function of the past. Any
  mismatch is a look-ahead defect, not a tolerance.

## 4b-i. ★ THE INTRA-DAY COMPLETED-BAR PIN (R-067 §3 — the leak class §4b does NOT cover)

§4b's verified causality is **DAILY ONLY** (`slice(0, day_idx)` strictly-prior days,
`close[day_idx-1]` prior close). That discipline does **not** automatically extend to
the 4h/1h frames the STRUCTURE wire reads. `_four_h_data` in scope is the WHOLE frame;
materializing per-bar columns by slicing it `timestamp ≤ t` **LEAKS** wherever bars are
stamped by OPEN time — a 4h bar stamped 08:00 covering 08:00–12:00 must NOT be visible
at 10:30, because its OHLC is computed from the bar-`t` FUTURE.

- **BINDING RULE (stamping-convention-agnostic):** an HTF bar is available to exec bar
  `t` **iff that HTF bar's CLOSE time ≤ t** (completed bars only). The implementation
  resolves the stamp convention FROM CODE, never assumption.
- **STAMP CONVENTION — resolved from code (2026-07-19):** the repo's one explicit
  resample convention is **OPEN-stamped** — `data_loader.py:1237`
  `group_by_dynamic("ts_event", every="1w", closed="left", label="left")`. Under
  open-stamping, "close ≤ t" means **`stamp + period ≤ t`**, i.e. `stamp ≤ t - period`
  — a naive `stamp ≤ t` filter is exactly the leak. (Path 1 proves the in-engine WEEKLY
  resample only.)
- **★ S3-NATIVE CONVENTION — RESOLVED, TWO-PATH AGREEMENT (R-068 §4).** Receipt:
  `docs/replay-results/h1-battery/s3-htf-stamp-convention-receipt.json`. Path 2
  (EMPIRICAL): resample MES 5m→4h on the UTC grid and value-match against the S3-native
  4h frame. **H1 open-stamped matches EXACTLY — 0.0000 max abs diff on O/H/L/C across
  67/67 bars; H2 close-stamped is off by ~70 points.** Code says open-stamped, data
  confirms open-stamped → **no alarm**.
  - **Grid-anchor trap found:** the S3 4h grid is anchored to **UTC** boundaries, not ET
    midnight (first 4h bar 03:00 ET = 08:00 UTC). A naive ET-anchored resample joins
    **ZERO** rows — an alignment bug that would have silently produced an empty or
    mis-stamped column.
  - **"Different instruments" check REFUTED:** once anchored, S3-native 4h == exec-resampled
    4h exactly. No fidelity decision is forced about which frame feeds structure.
  - **THEREFORE, concretely for the structure wire:** a 4h bar stamped `T` is available to
    exec bar `t` **iff `T + 4h ≤ t`** (i.e. `T ≤ t - 4h`). Scope: MES, one window; 1h not
    separately aligned — align it before it is used.
- **Why the existing daily path is safe:** `compute_htf_context` applies the completed-bar
  discipline INTERNALLY ("All HTF data uses PREVIOUS completed bar (shift(1)) — no
  look-ahead", `htf_context.py:3/66`) and has a bar_date lookahead filter
  (`context_runner.py:162`). Slicing the 4h frame ourselves BYPASSES that protection —
  which is precisely why the structure wire needs its own proof.
- **TWO GRANULARITIES (name them, do not conflate):**
  - **bias columns = per-DAY constants** — causal via the day-key (what the spike built).
  - **structure columns = STEP FUNCTIONS advancing per COMPLETED HTF bar.** A
    daily-frozen structure column would UNDER-shoot fidelity; a forming-bar leak would
    FAKE it. Both failures are silent.
- **PROOF OBLIGATION:** the §4b truncated-replay MUST include an **intra-day straddle**
  case — an exec bar mid-way through a forming 4h bar — before the structure wire lands.
- **Standing caveat (R-067 §3):** code-inspection of a builder's causality is a CLAIM
  until truncated-replay proves it; inspection catches the obvious slice, not the
  stamp-convention leak.

## 4c. ★ EQUIVALENCE TWO-PATH (R-066 §3 — free and decisive)

The same evaluator functions now run at TWO call sites: the new upstream column
materialization and the existing downstream eligibility gate. For overlapping
sample windows, the upstream column value and the gate-phase value must **AGREE
BYTE-FOR-BYTE** — that is the proof the reuse is real and un-drifted (no second
implementation crept in). **A disagreement is an ALARM, not a tolerance.**

## 4d. ★ THE TWO-COMMIT LAW — MANDATORY CHECKLIST (R-068 §2, pattern-class fix)

Failure mode minted 2026-07-19: **momentum collapses a mandated two-commit sequence
into one.** The extraction+wire pair shipped as a single commit, so extraction drift
could have masqueraded as the wire's effect and the ablation would have read a lie.
This is a CHECKLIST, not a memory — every refactor+wire pair below ticks it EXPLICITLY:

- [ ] **DSL-site conversion** (`backtester.py:4391-4401` → shared builder) — licensed by
      the byte-proof in `1aaaa673`, **NOT DONE**. Ships as its OWN result-neutral commit
      with its OWN byte-proof, BEFORE anything reads through it.
- [ ] **WIRE-1 structure columns** — any refactor they require is a separate prior commit.
- [ ] **WIRE-2 (bias family generalization)** — same.
- [x] ~~shared-builder extraction~~ — VIOLATED (extraction+wire in `3b91fcf6`);
      remediated by `1aaaa673`; defense assigned to the independent grader per R-068 §2,
      NOT self-accepted.

**Rule:** a refactor that touches live commissioned machinery lands ALONE, proven
byte-neutral against every original it replaces, before any consumer reads through it.
No exceptions for momentum.

## 4e. ★ ENGAGED-FRACTION IS PART OF THE DoD SCOPE-LINE (R-068 §5)

The spike's window ran ~49% engaged: the 200-daily-bar cache spin-up consumed the front
of the exec window, so those bars fell back to the proxy. **Law: the 0.99 per-family
re-measure REPORTS per-spec engaged-fraction ALONGSIDE the approximation distribution.**
Otherwise engagement is a hidden confound across specs/windows and the DoD numbers are
non-comparable (a spec that looks "less approximate" may simply have been more engaged).

- **Preferred fix:** seed the daily cache from PRE-WINDOW daily history (S3 daily data
  predating the exec window) so warmup stops eating the measurement window.
- **If not feasible:** the scope-line carries the engaged-fraction explicitly.
- A half-engaged window is an honest SPIKE; an UNLABELED half-engaged DoD read is not.

## 5. VERIFICATION (R-042 pin 4c + 4d)
- **Both-polarity engagement proof PER WIRED FAMILY (pin 4c):** each wired binding SEEN failing a wrong condition AND passing a right one on real multi-TF data — a binding that cannot fail is the vacuous class (we do not ship it twice in one week). Not a code-path-exists check: a fixture where the real bias is bullish must PASS a "with-trend long" condition and FAIL a "counter-trend" one, distinct from what the EMA proxy would have done (ablation: proxy vs wired differ on the same bars).
- **DoD (pin 4d) — THE SUCCESS METRIC:** re-measure the binding-approximation distribution over the 16 compilable specs, per-family before/after. **The 0.99 MUST MOVE, measurably** — the movement IS the packet's success. Report the per-family before/after `approximation=False` counts + the new corpus distribution.
- Independent grade (doer≠grader) per family: the wire is REAL (ablation proves proxy≠wired), the approximation genuinely dropped (not a relabel), no evaluator was duplicated (gate-layer reuse), no drift introduced.

## ROLLBACK
Each family wire is flag-gated (default OFF until its both-polarity proof + independent grade land, per the ship-gates-STRICT-default-OFF convention) so a wire that regresses is disabled without reverting the plumbing. The plumbing itself is additive (new columns / new in-scope data), revertible by dropping the feed.

## SEQUENCE (parallel with the shakedown)
Design-spike the plumbing seam on WIRE 1 → land WIRE 1 (both-polarity + grade + DoD movement) → WIRE 2 (same) → confirmation_native win → re-measure the full distribution. Tooth-1 (`compile_fidelity_forensics`, R-043 §3) builds AFTER this packet lands + BEFORE first survivor candidacy. The 77 stay sealed; no survivor claim until specs bind at real fidelity AND pass the forensics leg.
