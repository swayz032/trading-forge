# ALGO-093 — E1 passes every pre-registered check and is **still not a repair**; Z1 closes

**Strategy head:** `70ebb3e59db4027e9d8f9a0b98ec9345b6dd678b` (pushed, `ls-remote` verified)
**PR #38:** DRAFT / DO NOT MERGE · **Nothing landed**, no number moved, R2 untouched.
**Suite:** enumerated → **1662 passed, 7 failed.** Membership vs baseline: **zero added, zero
removed.** **Your ruling is ALGO-094.**

---

## 1. E1 — every check passes, and it must not land

| N | control survives | convicted refused | approvals | **sessions that stop trading** |
|---|---|---|---|---|
| **3** *(primary)* | ✔ 1/1 | ✔ **5/5** | 40 → **8** | **9 of 13** |
| 5 | ✔ | ✔ 5/5 | 40 → 10 | — |
| 7 | ✔ | ✔ 5/5 | 40 → 10 | — |

Convicted test counts: **129 · 18 · 10 · 10 · 142**. `LANE_VERDICT: RATIFIABLE_AT_N3`.

> **At N=3, nine of thirteen trading sessions stop trading entirely** — 03-23, 03-24, 03-25,
> 03-31, 04-02, 04-06, 04-07, 04-09, 04-13. Only 03-26, 04-01, 04-08 and the control still trade.

**Your pre-registration cannot catch this.** (a) asks whether the control survives, (b) whether
the convicted are refused. Both pass. **Neither asks what happens to the other eleven sessions**,
and 32 of 40 approvals are removed.

**And it is not equivalence.** On all five convicted days **he did trade**. Refusing the early
entry does **not** free the bullet for his later setup — at N=3 there is no surviving approval on
those sessions at all. **E1 converts five wrong-*time* trades into nine *no*-trades**, and against
a day+direction exam a no-trade where he entered is still a miss. So E1 cannot *raise* agreement;
it can only change the reason for the miss. He asked for equivalence of trades at day grain —
**silence is not equivalence.**

**On N's provenance, precisely rather than overclaimed.** The *direction* was genuinely
pre-registered in ALGO-082 §4 (13:42, before the census). The *counts* come from ALGO-092's
second pass, which **postdates** the census — on its own that ordering would be fittable, and I
won't claim otherwise. What actually protects N is your other point, which I verified: the census
separates at **every N from 2 to 10** (control 1 test; convicted 10/10/18/129/142), so no N in
that range is distinguishable on these sessions.

Sensitivity band as ordered: only **2** approvals removed at N=3 carried 3–4 tests (04-01 09:17,
04-13 09:37). The distribution is **bimodal** — a handful at 4, then a jump to 8+ with a tail to
142 — which is why N=3, 5 and 7 give nearly the same answer.

## 2. Z1 — `CLOSED_AS_A_REPLACEMENT_CONTROL_UNSUPPORTED`

Built every completed 5m/15m rejection candle into a `[wick extreme, close]` band with a role
(~260–370 zones per session) and asked — generously: fill price inside the band **or within one
stop-width**, role consistent with direction — whether any zone supports each trade.

| | supported |
|---|---|
| **CONTROL 04-14 09:38 L** | **NO** → Z1 closed as a replacement, as pre-registered |
| the five convicted early trades | **YES, 5/5** |
| his own entries | 5/7 (03-31 09:49 and 04-14 09:36 unsupported) |

**The irony is the finding:** his construction would authorise exactly the trades we want refused,
and **not** the one day the machine agrees. Per his directive this is **context, not a blocker**,
and not a reason to force the universe his way.

## 3. What I think this round establishes

Three predicates have now been built and measured against the same control — freshness-from-birth,
freshness-from-definer, and exhaustion-by-test-count. **All three fail, and each fails
differently**: one spends the zone with its own defining candle, one is undefined on the control,
and this one silences the book. That is three independent shapes of "refuse the early trade",
none of which produces *his* trade.

The pattern I'd put to you: **refusing the bot's early entry never yields his later entry.** The
bullet is not the binding constraint — on those sessions there is no approved candidate at his
clock to promote. If that reading is right, the timing conviction is not repairable by *any*
entry-refusal predicate, and the open question moves to why no candidate exists at his clock at
all.

## 4. Asks

1. E1: reject despite passing, on blast radius? Or land with the nine silenced sessions
   explicitly accepted?
2. Is the §3 reading right — and if so, should the next lane ask why no candidate exists at his
   clock, rather than which candidates to refuse?

Artifacts at `70ebb3e5`: `..._e1_exhaustion_report_2026_08_24.json`,
`..._z1_his_rule_universe_2026_08_24.json`.

---

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
