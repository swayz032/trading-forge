# WORKER REPORT — AR-1209 · 2026-08-15 · AR-1208 LANES 1 + 2

## LANE 1: **YOUR STRIKE IS RIGHT AND I VERIFIED IT AGAINST MYSELF.** On MNQ there is no breach at all, and the engine SKIPS rather than CLAMPS. My AR-1207 finding and the plain-English version I gave the operator are both **WITHDRAWN**.
## LANE 2: 🛑 **THE WITNESS DOES NOT PASS.** A ceiling refusal does **NOT** survive onboarding for an unregistered strategy — and the name it fails on is the one the extractor itself emitted for sVkm.

```
RULING : AR-1208 §6 LANE 1 + LANE 2. (AR-1208 accepted as governing authority; the
         AR-1206 collision is resolved by it and I am proceeding on AR-1208 alone.)
PIN    : worker head eeda148078c67b01efeca7762c2727dec449d4be
         branch claude/worker1-h1-20260815 — pushed, verified on origin
CHANGED: scripts/svkm_stop_ceiling_witness.py            (NEW, read-only diagnostic)
         grade/stop_ceiling_witness.json                 (artifact)
         docs/designs/SYSTEM-INVENTORY.md                (regenerated)
🛑 ZERO production-logic changes. Nothing in the stop or eligibility path was edited.
TESTS  : 47 passed across the four relevant suites (local evidence; no CI for this SHA).
```

---

## 1. LANE 1 — THE STRIKE, VERIFIED ON MERIT

Identical structural geometry, each symbol judged by **its own** ceiling:

```
MES  risk=15.750pt  skip_trade=True   stop=5015.750  preserved_unclamped=True  fvg_exceeds_ceiling_14.00pt
MNQ  risk=16.250pt  skip_trade=False  stop=5016.250  preserved_unclamped=True  fvg
MCL  risk=15.500pt  skip_trade=True   stop=5015.500  preserved_unclamped=True  fvg_exceeds_ceiling_1.00pt
```

**Both of your reasons hold:**

**(A) Wrong instrument.** The breach existed only because I passed `symbol="MES"` for a
Nasdaq source. On **MNQ**, `skip_trade=False` — no breach at all. My "collision" was an
artifact of my own test configuration.

**(B) Skip, not clamp.** `stop_price` is **preserved un-clamped in every row**, including
both breaching ones. `StopPlan.skip_trade` exists precisely for this and the code says
*"skip-not-clamp per CLAUDE.md §4"*.

### 1.1 How I got it wrong, precisely

I read `stop_reason == "fvg_exceeds_ceiling_14.00pt"` — **a label** — and concluded the
stop had been capped. I never read `skip_trade`, which is the field the claim actually
depends on, and I never compared `stop_price` against the un-clamped level. Both were one
line away.

**That is the fourth instance this session of the same error**: measuring the field next to
the claim. The previous three I caught myself. **This one reached the operator as a
money-path alarm** — I told him the system "quietly shrinks the teacher's stop." It does
not. **Withdrawn, and corrected to him in the same turn as this report.**

---

## 2. LANE 2 — THE WITNESS YOU DEMANDED. IT FAILS.

You wrote that the comment claiming framework gates are enforced elsewhere *"must have an
executable witness before money-path authorization."* Here it is:

```
breaker                    registered=True   -> action=SKIP   ends_in_no_order=True   (CONTROL)
fvg_breakout_range_1m_5m   registered=False  -> action=TAKE   ends_in_no_order=False  🛑
```

Both rows carry `stop_plan.skip_trade=True`. The registered control proves the gate works;
the unregistered row proves it is bypassed.

**`fvg_breakout_range_1m_5m` is not a name I chose.** It is what the production extractor
itself emitted for sVkm (AR-1137), and it is **not in `ALL_STRATS`**. So the strategy this
entire campaign is trying to certify is, by name, in exactly the class that takes the bypass.

The returned reason is the bypass itself:

> `Strategy 'fvg_breakout_range_1m_5m' unregistered (not in playbook_router.ALL_STRATS) — eligibility overlay bypassed for backtest parity (framework + Stage-2 gates still apply)`

### 2.1 The comment's claim, measured

The comment asserts *"framework + Stage-2 gates still apply"*, naming the structural-stop
ceiling among them. **For that gate the claim does not hold**, because:

```
non-test readers of `skip_trade` in all of src/:
  src/engine/context/eligibility_gate.py:119    <- THE ONLY ONE
```

Check 0 at line 119 **is** the ceiling gate, and the bypass returns `TAKE` at line 108,
before it. There is no second reader anywhere to enforce it downstream.

### 2.2 Why the green suite never caught this

Every existing test in `test_skip_trade_propagation.py` passes `strategy_name="breaker"` —
**registered**. The suite proves the gate works on the path that was never at risk, and
never exercises the bypass. A passing suite here meant "the registered path is fine", not
"the ceiling is enforced".

### 2.3 🛑 SCOPE — WHAT I HAVE **NOT** PROVEN

- **PROVEN:** `evaluate_signal` returns `TAKE`; `skip_trade` has exactly one non-test reader.
- **NOT PROVEN:** that any order would reach a broker. **I did not enumerate** DLL, position
  sizing, the egress chokepoint, or Stage-2 confluence, any of which might independently
  refuse. Broker egress is OFF by standing configuration.
- ⇒ **The honest claim is "a named safety check is bypassed and nothing else reads it",
  NOT "the bot would place a bad trade."** I am deliberately not upgrading it.

### 2.4 NOT FIXED, deliberately

The bypass is intentional — it exists for backtest/paper parity, and removing it would
re-introduce the promotion-breaking divergence its comment describes. **Changing eligibility
semantics on the money path is not a worker call.** I measured it and stopped.

---

## 3. FINDINGS AGAINST MYSELF

1. §1.1 — the fourth field-next-to-the-claim error this session, and the first to reach the
   operator. Withdrawn and corrected to him directly.
2. AR-1207 §4.1 asked you to rule a "source-vs-framework precedence" question that **did not
   exist**. Your §5.3 answer (preserve geometry, evaluate risk separately, refuse the setup,
   never clamp) is already what the code does. **I spent a ruling on a false premise**, which
   is the exact failure `prior-art-check` exists to prevent.
3. I have not run Lane 3 (paired visual) or Lane 4 (integration) — reporting Lanes 1+2 first
   because Lane 2 is a safety finding and should not wait behind two larger lanes.

---

```
STOP   : Reporting before starting Lane 3/4. Lane 2 turned up a money-path safety gap that
         outranks queue order.
NEXT   : GPT's call:
         (1) **THE BYPASS.** A newly certified strategy is unregistered by construction, so
             every strategy this campaign produces enters through the bypassed path. Options
             I can see, none of which I am taking: register on certification; move Check 0
             ahead of the bypass; or re-check `skip_trade` at a downstream chokepoint. Each
             changes money-path semantics.
         (2) Lane 3 paired visual proof — still authorized under §6, not started.
         (3) Lane 4 integration of the antecedent + detector into the versioned grade path.
         My recommendation: (1), and specifically the narrow version — whatever else is
         decided, `skip_trade` having exactly ONE reader is fragile for a refusal that
         protects real capital. A second, independent enforcement point is cheap.
```
