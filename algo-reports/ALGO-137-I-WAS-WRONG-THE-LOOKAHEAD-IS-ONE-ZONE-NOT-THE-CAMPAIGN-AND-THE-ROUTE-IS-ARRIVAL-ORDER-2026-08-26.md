# ALGO-137 — **I WAS WRONG, AND I TOLD THE OPERATOR BEFORE IT WAS CHECKED.** I put a lookahead hypothesis to him as *"this might be it"* and as the explanation for four of five bullet clocks. **The largest half is REFUTED at a line: `kernel.py:269` recomputes `zone_state_at_v24(loc.zone, full5, ts, p)` at every BUCKET, not at 09:30 — active/broken/flipped is causal. Only WHICH ZONES EXIST is fixed at 09:30.** **And the direct test I named as proof is NEGATIVE 0 of 5: no authorising zone postdates its own trade — they predate by 1h18m to 23 days.** **What survives is real and has a footprint of ONE ZONE, in ONE SESSION, which authorised nothing.** ⇒ **It does not explain the negative band result, and *"so is the rank, so is everything we repaired for a week"* is unsupported.** **The route is what ALGO-125 already said and my bad hypothesis displaced for two messages: ARRIVAL ORDER.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Retracts my own hypothesis as put to
the operator.** **Channel head at drafting:** `614dd846`. **Strategy head `4e09ecd8`.**
**PR #38: DRAFT. No repair ordered. The anchor was not touched by anyone.**

---

## 1. WHAT IS REFUTED  **[VERIFIED HERE at the line, after the worker's refutation]**

`kernel.py:269`, inside `for ts in bucket_starts:` at `:243`:
```python
before = zone_state_at_v24(loc.zone, full5, ts, p)     # ts = the BUCKET START
```
**Zone state — active, broken, flipped — is recomputed at every bucket from bars completed by
then**, and `last_side` / `flipped_at` are maintained off it. **My claim that the bot trades "against
a 09:30 view of the world" is false.**

**And the direct evidence I named as decisive is negative: 0 of 5.** No authorising zone postdates its
own trade. **The proof I said would exist does not.**

⇒ **The four pre-09:30 clocks are not explained by this. The band re-land moved nothing for some other
reason.** ⇒ **and the sentence I put in front of the operator — that this sits upstream of the rank,
the band and everything repaired this week — is withdrawn in full.**

## 2. WHAT SURVIVES, AND ITS SIZE

**The mechanism is real:** the zone **SET** is built once at `kernel.py:229` with `open_ts = 09:30`,
`authorized` filters on authorization and never on time, and no creation/confirm re-filter exists
anywhere in the chain — **the worker attacked that claim with a positive control and could not break
it.** So a pre-09:30 decision *can* see a zone confirmed later.

**Measured footprint, both denominators reported because they disagree on which sessions traded:**

| denominator | exposed sessions | exposed zones |
|---|---|---|
| the five 08:00-window bullet-spends | **1** — 03-31, a zone confirmed 09:15 against a 09:03 bullet | **1** |
| the scorecard's 12 traded sessions | **1 of 12** — 04-07, a zone confirmed 09:30 against a 09:23 entry | **1** |

**Under either: one zone, and in neither case was it the authorising zone.** **Reporting both rather
than the one that flatters the hypothesis is the correct handling of a disagreeing denominator, and
the disagreement is `session_first_entry_time` being arm-relative — the same fact measured on 03-24.**

**ONE THREAD OPEN, and it is a lookup not a re-run:** whether that single future zone changed anything
through overlap suppression, dedup, confluence or as a blocker. **Untested. Named, not claimed.**

## 3. 🛑 HOW I GOT IT WRONG — the shape matters more than the error

**The finding arrived with a story attached and I shipped the story.** Four pre-09:30 clocks · a map
anchored at 09:30 · no time filter — three true facts, and **I joined them into a mechanism without
measuring the join**, then said *"this might be it"* to the operator **while he is working to a
deadline.**

> ## **I HAVE MINTED THIS LAW TWICE TODAY AND BROKEN IT A THIRD TIME: A CHAIN OF CORRECTLY-MEASURED FACTS CAN CARRY AN UNTESTED JOINT, AND THE JOINT IS INVISIBLE BECAUSE EVERY FACT AROUND IT HAS A NUMBER ATTACHED.**

ALGO-126 §Lesson said exactly this about the clutter story. **The difference tonight is the audience:
a wrong story on the ladder costs a ruling; a wrong story told to the operator under a deadline costs
his time, and he has one day.** ⇒ **NOTHING GOES TO HIM AS A LEAD UNTIL ITS JOIN IS MEASURED.** The
facts were checkable in under ten minutes and I spent those minutes writing instead.

**And the worker's line is the one that should have stopped me before I sent it:** *"I would have
liked it to be — it is the tidiest story available tonight — and the measurement does not carry it."*

## 4. THE ROUTE — unchanged from ALGO-125, and my hypothesis displaced it for two messages

> **One candidate per decision clock. `_rank_and_yield` is called per minute. The trade is simply THE FIRST ROUTE THAT QUALIFIES IN TIME.**

**The bot takes breaks because break routes qualify EARLIER, not because they win a comparison.** The
rank never fires. The band is downstream. This lookahead is one zone. **Arrival order is the
mechanism and nothing repaired this week reaches it.**

**And the qualifier that is supposed to gate it is `location + candle story + sustained force` —
which he ratified today — and which every break route also satisfies.** ⇒ **the open question is not
*"what is A+"* but *"what does he require that the break routes have and his rejections do not — or
what does he see at 08:14 that makes it not A+."***

**AUTHORIZED, and it is the only thing worth the remaining time:** measure, for each of the five
bullet-spends, **what his own setup was doing at that clock** — was a zone rejection candidate even
available, and if so what refused it. **`ARTIFACT-SOURCED` from the X-ray; report by key; derive
nothing.** **If his setup was NOT yet available at 08:14, the answer is arrival order and no clause
repairs it. If it WAS available and something refused it, that refusal is the finding.**

**RAILS unchanged:** no number · no time filter (rail 11) · the anchor untouched
(`v2_2_engine.py:39-41`'s warning stands) · one-bullet budget untouched · **and no repair proposed
before that measurement lands.**

---

**LESSON, minted:**

> **THE TIDIEST STORY AVAILABLE IS THE ONE TO DISTRUST, AND A DEADLINE IS EXACTLY WHEN IT ARRIVES
> LOOKING LIKE A BREAKTHROUGH.**

I have spent the day ruling that a striking result is the state in which one more read feels
unnecessary. **Tonight the striking result was mine, the operator was waiting, and I skipped the read
to give him something.** **Giving him a lead I had not checked is not urgency — it is spending his
last day on my hypothesis.** The worker measured it in one pass and it collapsed to one zone that
authorised nothing.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
