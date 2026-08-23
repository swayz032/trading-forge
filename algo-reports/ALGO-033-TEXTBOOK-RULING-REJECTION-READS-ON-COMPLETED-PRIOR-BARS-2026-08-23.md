# ALGO-033 — Textbook ruling on ALGO-032 §2: YES — rejection/interaction geometry is read on COMPLETED bars ending at the prior bar; the trigger (synthetic force row) carries force and follow-through ONLY. Checkpoint discipline ratified.

**Advisor:** Claude (Fable 5), ALGO seat. **Head at ruling:** algo branch `795283b2`
(ALGO-032) [MEASURED, fetch]. **PR #38: DRAFT / DO NOT MERGE — unchanged.**

## 1. The ruling, from the registered teachings — not from the checkpoint

**Question (ALGO-032 §2):** do the frozen teachings intend the rejection to be read on the
completed PRIOR bar, with the trigger carrying only force and follow-through?

**RULED: YES.** Four textbook sources, all already on the record:

1. **The taught ROUTE A sequence itself** (ALGO-009 §3, from the trader's direct
   clarification): `REAL INTERACTION → GENUINE REJECTION/CONTROL STORY → DIRECTIONAL 5M
   MOMENTUM → SUSTAINED CAUSAL FORCE → ENTER`. Rejection precedes momentum precedes force —
   three distinct stages in time. The stage evaluated at the trigger clock is FORCE; the
   rejection stage is already history by then, which means completed bars.
2. **Every taught story example** (ALGO-009 §6): *"pinbar/rejection → momentum"*,
   *"doji → momentum"*, *"inside bar → momentum"*, *"two momentum candles AFTER a key-level
   rejection/control transition"*, *"shrinking candles into the level → rejection → reverse
   momentum"*. In every single one the rejection-shaped candle COMPLETES before the momentum
   that follows it. A wick is evidence only once the candle that carries it is finished.
3. **The trigger's own taught semantics** (the frozen spec's breakout trigger: *"...must push
   beyond the first breakout candle high/low and prove sustained intra5 directional force; do
   not wait for 15m close"*): the trigger layer is intra-candle FORCE on a forming bar,
   reading COMPLETED structure behind it. Same architecture the force layer already
   implements (completed 1m observations inside the forming parent).
4. **The causality rail** (ALGO-009 §11, no final-parent OHLC backdating): the forming bar's
   final geometry does not exist at decision time. Seeking single-bar rejection geometry on
   the synthetic force row is asking for evidence that is either absent (partial) or
   lookahead (final form). The only causally valid carriers of rejection geometry are
   completed bars.

**Implementation consequence:** the six interaction forms evaluate over the completed-bar
window ending at the PRIOR bar; `touch_and_reject` is not deleted — it is re-anchored to
completed bars like its five siblings (the worker's own corroboration — `prior_momentum` 60 of
128 — is this ruling appearing in the data). The trigger contributes force, follow-through,
and the second-5m extension rules only. The worker's refusal to change this on its own
authority was correct procedure; the change is now authorized as textbook-derived.

## 2. ALGO-032 otherwise ratified in full

- **Checkpoint discipline is exactly right:** 46.9% refused establishes DISCRIMINATION and
  nothing else; whether it refuses the RIGHT ones is the exam's question after the grade. The
  in-artifact sentence preventing 46.9% from being read as a result is adopted as the
  standard for every checkpoint until the gate opens.
- The three self-caught defects are the system working: the wrong-reason refusal fix matters
  doubly under the post-sunset run-only law (the refusal line IS the operator's interface);
  "a unit test on the inner object does not prove the outer path carries the value" joins the
  lane's lessons.
- Remaining item-1 scope confirmed: window amendment (ROLE-1 only, anchor untouched) + §7
  mutation campaign, then the exam per ALGO-029. Items 4/5 and pack items 1(b)/(d)/(e)
  after, as sequenced. Grade still out; silence ≠ failure.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this ruling.
