# R2c — the taught momentum-after stage, derived. N1 of ALGO-098's graph.

**Status: DERIVED, GUARDED, and it does NOT land — it fails its own pre-registration by killing
one of the two hits it was required to preserve.** Reported here in full so the next attempt
starts from the measurement rather than from the idea.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this derivation.

---

## 1. Why the stage exists — the over-grant names it

ALGO-099 measured the §5 batch as **additions 103, removals 0, target moves 0** — purely
additive. A repair that only ever adds has removed a constraint and put nothing back. R2/R2b
retired four untaught fractions (`0.62`, `0.78`, `0.35`, and `0.30/0.40`) from the Route A
rejection test, leaving *"traded into the band and closed back out on the near side"* as the
entire test.

The clause walk (now answerable, ALGO-099 §2) says the additions are **not malformed**:
**0** are Route A on a BROKEN zone, and **all 103** carry one of the spec's own named rejection
forms — `touch_and_reject` 67, `prior_momentum_after_rejection` 28,
`sweep_and_reclaim_with_control` 6, `failed_breakout_back_inside_with_control` 2. So the
retired fractions were not filtering *wrong* stories. **They were doing the narrowing work of a
taught stage that Route A's implementation had never really carried.**

## 2. The stage, one clause per citation

| # | citation | clause |
|---|---|---|
| 1 | **ALGO-009 Route A** | the sequence is `REJECTION/CONTROL STORY -> DIRECTIONAL 5M MOMENTUM -> SUSTAINED CAUSAL FORCE` — three stages in time, not two |
| 2 | **ALGO-052** | *"rejection, then momentum candles formed"* |
| 3 | **ALGO-071 §3** | retiring the rejection magnitudes explicitly left this clause standing: the momentum-after clause *"remains the next stage of Route A exactly as taught"* |
| 4 | **ALGO-068 §3** | the authorized magnitude-free geometry: *"a momentum candle that takes out the prior candle's EXTREME — the same extreme test Route B already uses at `normal_breakout`"* |
| 5 | **ALGO-033** | stage placement: the completed window carries the story, the forming trigger carries follow-through only |

**No magnitude is introduced.** A test asserts the clause contains no `body_frac`, `close_loc`,
`reject_wick`, `min_each`, `max_body` or numeric literal.

## 3. The four questions a derivation must answer

- **Which bar's extreme?** The **last COMPLETED bar** — the rejection bar the story has just
  read. Not an arbitrary lookback bar, and not the trigger's own prior.
- **Close or trade?** **Trade.** The running high/low, i.e. what price has already done.
- **Completed or forming?** The **forming trigger's running extreme** against the completed
  bar's final extreme. This is the identical field on the identical bar that
  `normal_breakout` §7.7 already reads, so R2c introduces **no new lookahead surface**
  (ALGO-033's rail is unmoved).
- **Where in the story?** The DECISION stage of `derive_story`, which previously read
  `trigger.close > last.close` — the weakest possible reading of "momentum", and the reason
  this stage was carrying no narrowing at all.

## 4. The change

```python
# before
follow = (float(trigger.close) > float(last.close)) if direction == "L" \
    else (float(trigger.close) < float(last.close))

# R2c
follow = (float(trigger.high) > float(last.high)) if direction == "L" \
    else (float(trigger.low) < float(last.low))
```

Two lines, in `derive_story` only. Route A's rejection forms, force stage, and every break-family
gate are untouched.

## 5. Red-proof — `tests/test_algo_r2c_momentum_after.py`

RED at `5bf5170c`/`5b488564` before the change, on the claim itself, then GREEN:

- a trigger that closes past the prior CLOSE (103.4 > 103.2) but never exceeds its HIGH
  (103.45 < 103.5) must be **refused** — the close-only test accepts it, the taught test does
  not. That disagreement is the proof.
- the positive witness: a trigger taking out 103.5 completes the story.
- the no-magnitude assertion above.

R2c suite 3/3. **Full v2.4 suite in the R2c worktree: 849 passed, 0 failed** — no regression.

## 6. THE GUARD — and the verdict

Same instrument, same 40 baseline, 08:00 pin, compared BY KEY.

| arm | approvals | new Route-A before his clock (convicted days) |
|---|---|---|
| baseline `56d9360d` | 40 | — |
| R2+R2b+F1 (the §5 batch) | 143 | 37 |
| **+ R2c** | **111** | **26** |

R2c removes **32** approvals and **11** of the early Route-A grants, adds **0**. It is a real
narrowing, in the right direction, from a cited magnitude-free clause.

**It still does not land, on two pre-registered lines:**

| line | measured | verdict |
|---|---|---|
| 5.1 control by key | 04-14 identical to baseline by key AND target; clock `09:38` unmoved | **PASS** |
| 5.2 sessions silenced | 0 | **PASS** |
| **5.3 the two hits must survive** | 03-24 `09:32` @ `S:2026-03-24T00:15…96923` **SURVIVES**; 04-09 `11:37` @ `SWING:S:2026-03-17T22:30…100322` **KILLED** (survivors 1 → 0) | **FAIL** |
| 5.4 no new early Route A | **26** remain | **FAIL** |

ALGO-098 was explicit: *"a narrowing that kills the two hits fails"*. It killed one. **R2c does
not land.**

## 7. What this buys the next attempt

1. **The direction is right and the size is measured.** One cited, magnitude-free clause removes
   a third of the over-grant. Whatever lands will be a stage like this one, not a fraction.
2. **The 04-09 hit is the constraint that binds.** That candidate reaches the story gate only
   because force opens first, and it survives on a zone whose momentum-after does not take the
   prior completed bar's extreme. Any momentum-after stage strong enough to cut 26 further will
   have to distinguish that bar from the ones it is cutting — which is a question about WHICH
   completed bar the momentum is measured against, and ALGO-009's *"two momentum candles"*
   (ALGO-068 §3's own list) is the untried reading.
3. **Refusal-only narrowing is not the lane.** 26 early Route-A approvals survive R2c, and the
   additions are all well-formed taught stories on non-broken zones. The remaining difference
   between his setup and theirs is not "malformed vs well-formed" — the entry layer alone may
   not separate them, and the one-bullet budget is what actually turns approvals into the
   wrong trade.

## 8. What was NOT done

No fraction anywhere. No break-family gate touched. `entries.py`, `breakout_derivation.py`,
`target_policy.py`, `MIN_COMPLETED_1M_OBSERVATIONS`, the 17.25-pt stop, targets and the exam
rules are untouched. R2c is **not** committed to the strategy head — the head already carries one
unratified batch and stacking a second failed repair on it would hand the next seat two
unratified changes wearing one head. The two-line diff is in §4 and the worktree is reproducible
from this document alone.
