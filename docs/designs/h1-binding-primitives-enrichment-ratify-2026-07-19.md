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

## 5. VERIFICATION (R-042 pin 4c + 4d)
- **Both-polarity engagement proof PER WIRED FAMILY (pin 4c):** each wired binding SEEN failing a wrong condition AND passing a right one on real multi-TF data — a binding that cannot fail is the vacuous class (we do not ship it twice in one week). Not a code-path-exists check: a fixture where the real bias is bullish must PASS a "with-trend long" condition and FAIL a "counter-trend" one, distinct from what the EMA proxy would have done (ablation: proxy vs wired differ on the same bars).
- **DoD (pin 4d) — THE SUCCESS METRIC:** re-measure the binding-approximation distribution over the 16 compilable specs, per-family before/after. **The 0.99 MUST MOVE, measurably** — the movement IS the packet's success. Report the per-family before/after `approximation=False` counts + the new corpus distribution.
- Independent grade (doer≠grader) per family: the wire is REAL (ablation proves proxy≠wired), the approximation genuinely dropped (not a relabel), no evaluator was duplicated (gate-layer reuse), no drift introduced.

## ROLLBACK
Each family wire is flag-gated (default OFF until its both-polarity proof + independent grade land, per the ship-gates-STRICT-default-OFF convention) so a wire that regresses is disabled without reverting the plumbing. The plumbing itself is additive (new columns / new in-scope data), revertible by dropping the feed.

## SEQUENCE (parallel with the shakedown)
Design-spike the plumbing seam on WIRE 1 → land WIRE 1 (both-polarity + grade + DoD movement) → WIRE 2 (same) → confirmation_native win → re-measure the full distribution. Tooth-1 (`compile_fidelity_forensics`, R-043 §3) builds AFTER this packet lands + BEFORE first survivor candidacy. The 77 stay sealed; no survivor claim until specs bind at real fidelity AND pass the forensics leg.
