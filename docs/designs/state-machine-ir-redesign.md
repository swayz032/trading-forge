# State-Machine IR Redesign — DESIGN (the spine, scope-before-build)

> **Status:** DESIGN ONLY. Supersedes the event-centric compiler (`event → trade`), now FROZEN as the control
> baseline `fidelity-baseline-event-centric`. Driven by two blind measurements (n=38): entry-timing taxonomy
> (**92% of educators require a wait-state**, 8% event-coincident) + 8-role instruction taxonomy (validated
> the lifecycle vocabulary; surfaced ONE missing role = eligibility/precondition). Acceptance = the SAME blind
> generalization suite the baseline scored 0% STRONG on — apples-to-apples, improvement attributable to the
> architecture, not the evaluator.

## 1. Why (the falsification chain)

`event → trade` fits **8%** of how trading is taught. The other 92% delay entry into a wait-state:
`bias → structural event → execution zone → WAIT → confirmation-in-zone → entry`. The event-centric compiler
fired on the *event* (systematic divergence) and refused when it found a wait/confirmation instead of a
trigger (false quarantine). This is ONE architectural mismatch, not N missing primitives. Fix: make the IR
represent **state over time**, not instantaneous events.

## 2. The state machine (explicit states; every instruction creates / modifies / consumes state)

```
S0 Neutral
 └creates→ S1 Bias Established        (state_creator: HTF bias / direction)
   └creates→ S2 Structural Event       (state_creator: BOS / sweep / displacement / breakout — the trigger that ALREADY happened)
     └creates→ S3 Execution Context     (state_creator: the zone/level drawn — OB / FVG / S-D / range edge)
       └enters→ S4 Waiting              (wait_state object — first-class, §4)
         └consumes→ S5 Confirmation     (confirmation: the 5 existing axes live HERE, §5)
           └consumes→ S6 Entry          (entry: how the position opens)
             └→ S7 Position Managed      (management: stop/scale/BE — framework-overlay authoritative)
               └→ S8 Exit               (exit — framework-overlay authoritative)
```
- **Precondition (eligibility) gate** wraps S1→S6: the new role from the taxonomy = existing 3A `context_gates`
  (session/regime/news/trend-permission "don't trade at all right now"). DISTINCT from invalidation. Promoted
  to a precondition node: if an eligibility gate fails, the machine never advances past S1.
- **Invalidation** (`invalidated_by`) lives on the wait_state (§4): cancels THIS pending setup (S2-S5 → S0),
  not the regime. Optional node (present in ICT/SMC, absent in simple ORB).
- **Immediate / continuous** entries = the **zero-wait degenerate**: S2 and S4 collapse (the event IS the
  confirmation; wait_state.until is "now"). The event-centric baseline becomes a special case — nothing regresses.

Every educator instruction is one of: **creates** a state (S1/S2/S3), **modifies** a state (state_modifier —
rare: bias flip, zone redraw), or **consumes** a state to advance (wait→confirm→entry). Replaces the flat
"trigger, trigger, trigger" model.

## 3. Existing work is RE-ROOTED, not discarded (operator mandate)

The 5 shipped axes become the internals of the **S5 Confirmation node**; the WHERE-gate becomes the
precondition + S3 zone:
```
Confirmation (S5)
 ├── selection        (specificity-score.ts — pick the most-specific confirmation)
 ├── multi-leg        (compound IR — A AND/SEQUENCE B)
 ├── strength         (confirmation-strength.ts — clean vs weak)
 ├── anchor           (couple the confirmation to the S3 zone/level)
 └── alternatives     (OR-operator — the secondary gap from blind-gen; first-class here)
Precondition gate + S3 zone
 └── context_gates    (context-gate.ts — eligibility (session/regime) as precondition; zone (OB/FVG) as S3 execution context)
```
No module is rewritten; each executes LATER in the lifecycle. The compound-IR enforcement principle
(`primary_plus_confluence`) carries into S5.

## 4. `wait_state` — first-class object (the highest-leverage piece)

The waiting BEHAVIOR becomes DATA, not compiler logic — represents retests / pullbacks / sweeps / reclaims /
delayed entries / multi-day waits without new primitives:
```
wait_state: {
  active: true,
  until:         price_reenters(execution_zone),   // the progression condition (zone-return, retest, sweep, reclaim)
  confirmation:  <S5 Confirmation node>,            // what validates once `until` is met
  invalidated_by: close_below(execution_zone),      // cancels the setup before entry → S0
  expires:       session_end,                       // hard scope
  timeout:       30 bars,                            // soft scope
}
```
`until` predicates (open vocabulary, from the corpus): `price_reenters(zone)`, `retest(level)`,
`sweep(liquidity)`, `reclaim(level)`, `close_back_inside(band)`, `tap(zone_edge)`. The zone-return "primitive"
is just `until: price_reenters(zone)` — DATA, exactly as predicted.

## 5. Four independently-testable pipeline stages (each its own acceptance metric)

| stage | transform | metric (acceptance) |
|---|---|---|
| 1 Semantic extraction | transcript → semantic graph | did we capture EVERY educator statement? (recall vs blind enumeration) |
| 2 IR | semantic graph → state-machine IR | did every semantic node SURVIVE? (no node dropped in lowering) |
| 3 Compilation | IR → executable strategy | did compilation PRESERVE meaning? (no invented / dropped condition) |
| 4 Replay parity | executable → historical bars | did execution match the educator's DEMONSTRATED trades? |

A failure localizes to ONE stage → no "everything failed" black-box debugging. Stages 1-3 are deterministic /
gradeable offline; stage 4 needs the engine (the live-proof, gated on the engine-attach work).

## 6. Bidirectional traceability (the long-term investment)

Every node carries provenance both ways:
```
transcript lines ↔ semantic node ↔ IR node ↔ compiled rule ↔ engine signal
```
- Forward: every transcript instruction maps to ≥1 IR node (nothing dropped — Stage 1/2 metric).
- Reverse: every IR node + compiled rule + engine signal traces to ≥1 transcript span (nothing invented).
- Payoff: click an unexpected backtest trade → reconstruct the exact transcript statements that caused it →
  distinguish EXTRACTION error from COMPILER error from ENGINE error. Worth more than squeezing model %.

## 7. Gemma multi-pass (extraction must not do extraction + compilation in one shot)

P1 extract every explicit rule VERBATIM (no interpretation) → P2 normalize to structured semantic rules →
P3 compile to the state-machine IR → P4 validate every IR node ↔ ≥1 transcript span AND no transcript rule
omitted. Gives the bidirectional traceability of §6 by construction.

## 8. Acceptance (apples-to-apples vs the frozen control)

Run the SAME blind generalization suite (the 32 unseen videos) against the new architecture. Compare to the
`fidelity-baseline-event-centric` control (0 STRONG / 6 SYSTEMATIC / 3-of-3 false-quarantine). Success =
STRONG-rate materially up AND systematic/false-quarantine down, on the SAME evaluator — so improvement is
attributable to the architecture, not evaluation drift. Target reflects the 92% wait-state reality, not the
calibration-set 6-STRONG.

## 9. Build order (after this design is approved)

1. State-machine IR types + the `wait_state` object (pure; no engine).
2. Stage-2 lowering (semantic graph → IR) + the per-stage metric harness (§5).
3. Re-root the 5 axes into the S5 Confirmation node + promote context_gates to precondition/S3 (§3) — move, don't rewrite.
4. OR-operator (alternatives) + reclaim-direction (the 2 secondary blind-gen gaps).
5. Gemma multi-pass + bidirectional traceability (§6/§7).
6. Re-run the blind suite as the acceptance bar (§8).
Parallel (non-blocking): expand the unseen corpus toward ~100 to firm up multi_stage/zone_return proportions
for priority tuning (NOT to re-decide the architecture — the 92/8 split already settled that).

## 10. FORWARD ARCHITECTURE (operator's reframe — the north star, built incrementally)

> **Mission, restated:** not "YouTube → extract → backtest" but **"compile a human decision process into a
> deterministic executable specification with NO semantic loss."** Backtesting is the *verification*; the
> product is *semantic compilation*. This reframes every component and is the standard each checkpoint serves.

**Five compilers (separated permanently — most projects collapse them; separating localizes every failure):**
| # | compiler | transform | maps to |
|---|---|---|---|
| 1 | Instruction | NL → instructional units (no trading logic) | CP6 Gemma Pass 1 (verbatim extraction) |
| 2 | Semantic | instruction graph → semantic state graph | the state-machine IR (CP1-4) |
| 3 | Execution | semantic graph → runtime predicates | the runtime (CP3) + confirmation evaluator (CP4) |
| 4 | Engine | executable graph → Python / Pine / Lean / … | the engine-attach (future; a correct IR makes this near-trivial / multi-target) |
| 5 | Replay | historical bars → semantic events → compare to educator | the blind suite + real-bar replay (validation) |

**Architectural evolutions to fold in as checkpoints reach them (NOT all at once):**
- **IR as a GRAPH, not a chain.** bias / eligibility / execution-zone / confirmation / invalidation are nodes
  with edges (AND / OR / optional / parallel-prereq / timeout). The current linear S0-S8 is the spine; the
  graph generalizes it (handles OR-alternatives — the blind-gen secondary gap — natively). Evolve when CP4's
  `alternatives` + multi-prereq cases demand it.
- **Waiting → a SCHEDULER.** Generalize `wait_state` to an event scheduler: an ExecutionContext has
  `created / expires / watch[] / confirmation / cancel[]`. The runtime becomes an event loop over active
  contexts. CP3's runtime is the seed; this is its mature form.
- **Provenance gains an INTENT level.** transcript → INTENT → semantic → IR. "I want buyers to prove they're
  stepping in" (intent: demand confirmation) vs "bullish engulfing" (literal). Different educators express the
  same intent differently — intent is the transferable layer. Builds on the existing `origin`/provenance.
- **Semantic FINGERPRINT.** Every strategy compiles to {bias, confirmation, execution, risk, management, exit}
  → compare strategies mathematically, not transcripts. Enables dedup / clustering / "is this novel?".
- **Explainable REPLAY.** A trade reconstructs its causal chain to transcript lines (bias@L82 → CHoCH@L91 →
  OB@L94 → wait-satisfied@L103 → engulf@L108 → strength 0.82 → entry). The CP4 confirmation-provenance
  (contributors/blocked_by) + bidirectional traceability (CP5) are the substrate.
- **ADVERSARIAL validator.** Don't only ask "what did we miss?" — ask "what would make this trade ILLEGAL?"
  (missing invalidations, contradictory rules, impossible states, ambiguity, inferred assumptions). Property-
  testing for strategies. Extends `conserveOrThrow` + `inferredNodes`.
- **Decision-theory extraction (the deepest shift).** Today: "what does the educator DO?" Eventually: "what
  must be TRUE before the educator is willing to act?" — extract the decision, not just the procedure. Most transferable.

These are the map. The checkpoints are the steps. Each is built only when the prior one's data demands it,
measured against the frozen control, on the same blind suite.
